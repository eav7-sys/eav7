//! Máquina de estado do protocolo eav20.
//!
//! É onde mora o consenso: dado (estado, transação, altura), qual é o estado
//! seguinte — ou qual erro. Todo o resto do crate existe para servir este módulo.
//!
//! Equivalência com a referência: `vectors/state.json`.
//!
//! # Representação de valores monetários
//!
//! A referência usa `BigInt`, que é de precisão arbitrária. Aqui é `u128` com
//! aritmética CHECADA, e a escolha merece justificativa porque um erro aqui não
//! aparece em teste: aparece em produção, num saldo errado.
//!
//! `u128` comporta ~3,4×10³⁸. Os maiores valores do protocolo:
//!
//! | grandeza                    | ordem   |
//! |-----------------------------|---------|
//! | suprimento de gênese        | 10¹⁷    |
//! | `REWARD_SCALE`              | 10¹⁸    |
//! | acumulador de recompensa    | ~10²⁵   |
//!
//! Sobra margem de treze ordens de grandeza. Ainda assim, TODA operação usa
//! `checked_*`: estouro vira `Err`, nunca pânico e nunca valor circulando em
//! silêncio. Pânico em nó de consenso é vetor de DoS — um atacante que descubra
//! a entrada que estoura derruba a rede inteira.

use crate::canonical::Value;
use crate::transaction::Tx;
use std::collections::{BTreeMap, BTreeSet};

// Domínios da máquina de estado, um módulo por área. A divisão espelha a do nó de
// referência e existe para que o trabalho seja paralelizável sem conflito: cada
// módulo só toca o próprio arquivo e conversa com o resto por `State` e `Ctx`.
pub mod ai;
pub mod bridge;
pub mod coercao;
pub mod contracts;
pub mod eavm_tx;
pub mod gov;
pub mod leaves;
pub mod nft;
pub(crate) mod recursos;
pub mod token;
pub mod value;

/// Valor monetário na menor unidade (`e7`). 1 EAV7 = 1_000_000 e7.
pub type Amount = u128;

/// Erro de transição de estado. Corresponde às mensagens que a referência lança.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateError(pub String);

impl std::fmt::Display for StateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for StateError {}

impl StateError {
    fn new(msg: impl Into<String>) -> Self {
        StateError(msg.into())
    }
}

type R<T> = Result<T, StateError>;

/// Soma checada. Estouro é erro de transição, não pânico.
fn soma(a: Amount, b: Amount) -> R<Amount> {
    a.checked_add(b).ok_or_else(|| StateError::new("estouro aritmético na soma"))
}

/// Subtração checada. Note que `Amount` é sem sinal: subtrair abaixo de zero é
/// erro, o que é exatamente a semântica que se quer para saldo.
fn sub(a: Amount, b: Amount) -> R<Amount> {
    a.checked_sub(b).ok_or_else(|| StateError::new("estouro aritmético na subtração"))
}

/// Conta do protocolo.
///
/// Os nomes dos campos são os da referência e NÃO podem mudar: eles entram na
/// folha canônica do `stateRoot` como chaves de mapa, ordenadas por byte. Renomear
/// `delegatedOut` para `delegated_out` mudaria toda raiz de estado da rede.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Account {
    pub balance: Amount,
    pub nonce: u64,
    pub staked: Amount,
    /// Contabilidade de energia: consumo e o bloco em que foi medido.
    pub energy_used: u64,
    pub energy_block: u64,
    /// Idem para largura de banda.
    pub bandwidth_used: u64,
    pub bandwidth_block: u64,
    /// Trilho GB (após `GB_FEE_HEIGHT`): só entra na folha quando ≠ 0.
    pub gb_used: u64,
    pub gb_block: u64,
    /// Stake cujo RECURSO foi cedido a outra conta (o voto continua aqui).
    pub delegated_out: Amount,
    /// Stake cujo recurso foi recebido em delegação.
    pub delegated_in: Amount,
    /// Conta gerenciada pela EAVM (stakeou por um endereço 0x).
    ///
    /// Existe para EXCLUIR a conta do conjunto de validadores: uma conta EAVM não
    /// tem par de chaves híbrido, logo não consegue assinar bloco. Se entrasse no
    /// rodízio, o slot dela seria sempre pulado — perda de liveness que qualquer um
    /// provoca stakeando pela rota EVM. Ver `state.js:634`.
    pub eavm_managed: bool,
}

impl Account {
    /// Forma canônica para a folha do `stateRoot`.
    ///
    /// As chaves usam a grafia da referência (camelCase), não a do Rust. É o que
    /// mantém a folha idêntica; a conversão fica isolada aqui, num lugar só.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("balance".into(), Value::uint(self.balance));
        m.insert("bandwidthBlock".into(), Value::uint(self.bandwidth_block));
        m.insert("bandwidthUsed".into(), Value::uint(self.bandwidth_used));
        m.insert("delegatedIn".into(), Value::uint(self.delegated_in));
        m.insert("delegatedOut".into(), Value::uint(self.delegated_out));
        // Só entra na folha quando VERDADEIRO. A referência nunca grava `false`:
        // ela faz `acc.eavmManaged = true` e o campo simplesmente não existe nas
        // demais contas. Emitir `false` aqui mudaria a folha de TODA conta comum.
        if self.eavm_managed {
            m.insert("eavmManaged".into(), Value::Bool(true));
        }
        m.insert("energyBlock".into(), Value::uint(self.energy_block));
        m.insert("energyUsed".into(), Value::uint(self.energy_used));
        // GB: omitir zeros preserva folhas pré-fork e contas que ainda não usaram GB.
        if self.gb_used != 0 || self.gb_block != 0 {
            m.insert("gbBlock".into(), Value::uint(self.gb_block));
            m.insert("gbUsed".into(), Value::uint(self.gb_used));
        }
        m.insert("nonce".into(), Value::uint(self.nonce));
        m.insert("staked".into(), Value::uint(self.staked));
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`] — a conta como o snapshot de boot a lê
    /// de volta do disco.
    ///
    /// `eavmManaged` AUSENTE é `false`, e é o caso de quase toda conta da rede:
    /// exigir a chave recusaria o snapshot inteiro. Um `false` EXPLÍCITO é recusado
    /// pelo motivo oposto — o codificador nunca o emite, e aceitá-lo daria duas
    /// codificações da mesma conta. `gbUsed`/`gbBlock` ausentes = 0.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        let eavm_managed = match m.get("eavmManaged") {
            None => false,
            Some(Value::Bool(true)) => true,
            Some(_) => return None,
        };
        let gb_used = match m.get("gbUsed") {
            None => 0u64,
            Some(x) => x.inteiro()?,
        };
        let gb_block = match m.get("gbBlock") {
            None => 0u64,
            Some(x) => x.inteiro()?,
        };
        let tem_gb = m.contains_key("gbUsed") || m.contains_key("gbBlock");
        // Ambos ou nenhum — evita duas folhas para o mesmo estado lógico.
        if m.contains_key("gbUsed") != m.contains_key("gbBlock") {
            return None;
        }
        // Chave a mais é campo que este decodificador não sabe ler: virar `None`
        // aqui derruba o snapshot, que é melhor que restaurar uma conta pela metade.
        let esperadas = 9 + usize::from(eavm_managed) + if tem_gb { 2 } else { 0 };
        if m.len() != esperadas {
            return None;
        }
        Some(Account {
            balance: m.get("balance")?.inteiro()?,
            nonce: m.get("nonce")?.inteiro()?,
            staked: m.get("staked")?.inteiro()?,
            energy_used: m.get("energyUsed")?.inteiro()?,
            energy_block: m.get("energyBlock")?.inteiro()?,
            bandwidth_used: m.get("bandwidthUsed")?.inteiro()?,
            bandwidth_block: m.get("bandwidthBlock")?.inteiro()?,
            gb_used,
            gb_block,
            delegated_out: m.get("delegatedOut")?.inteiro()?,
            delegated_in: m.get("delegatedIn")?.inteiro()?,
            eavm_managed,
        })
    }

    /// Stake efetivo para RECURSOS: o próprio, menos o cedido, mais o recebido.
    ///
    /// Poder de VOTO e peso de validador seguem usando `staked` — delegar recurso
    /// não transfere voto. Confundir os dois deixaria o delegante sem voto e o
    /// receptor com voto que não lastreou.
    pub fn resource_stake(&self) -> R<Amount> {
        soma(sub(self.staked, self.delegated_out)?, self.delegated_in)
    }
}

/// Estado de consenso.
///
/// `BTreeMap` em vez de `HashMap` em toda parte: a iteração precisa ser
/// determinística. Com `HashMap`, a ordem varia entre execuções (a semente é
/// aleatória por processo) e qualquer código que dependa dela divergiria entre
/// nós. A folha do `stateRoot` é ordenada de qualquer forma, mas confiar nisso
/// deixaria a armadilha armada para o próximo campo que iterar sem ordenar.
#[derive(Debug, Clone, Default)]
pub struct State {
    pub accounts: BTreeMap<String, Account>,
    pub total_minted: Amount,
    pub total_burned: Amount,
    /// Fila de saques em andamento: `(dono, valor, altura de liberação)`.
    pub unbonding: Vec<(String, Amount, u64)>,
    /// Votos alocados por eleitor: eleitor → (candidato → votos).
    pub votes: BTreeMap<String, BTreeMap<String, Amount>>,
    /// Total recebido por candidato — derivado de `votes`, mantido para leitura O(1).
    pub candidate_votes: BTreeMap<String, Amount>,
    /// Comissão vigente por validador, em porcento.
    pub commission: BTreeMap<String, u8>,
    /// Comissão agendada: validador → (porcento, altura em que passa a valer).
    pub pending_commission: BTreeMap<String, (u8, u64)>,

    // ------------------------------------------------------------------
    // Seções por domínio.
    //
    // O campo é declarado AQUI e o tipo pertence ao módulo do domínio. É o que
    // permite portar os domínios em paralelo sem conflito: cada um mexe só no
    // próprio arquivo, e o `State` já reserva o espaço.
    //
    // Toda seção que participa do consenso PRECISA entrar em `state_leaves`.
    // Uma que fique de fora produziria a mesma raiz para estados diferentes, e
    // os nós divergiriam sem detecção — é o modo de falha mais silencioso aqui.
    // ------------------------------------------------------------------
    /// Tokens EAV20.
    pub tokens: BTreeMap<String, token::Token>,
    /// Coleções EAV721.
    pub nfts: BTreeMap<String, nft::Collection>,
    /// Registro de nomes EAV-NS.
    pub names: BTreeMap<String, nft::NameRecord>,
    /// Contratos EAVM (mundo 0x): endereço `0x…` minúsculo → contrato.
    ///
    /// É o `this.contracts = {}` da referência. As chaves são a forma 0x de 40
    /// hexadecimais MINÚSCULOS — a caixa entra na folha `ctr` do `stateRoot`.
    /// Inclui o contrato de sistema do anel de hashes de bloco (EIP-2935),
    /// materializado por [`State::record_block_hash`]. Ver `state/contracts.rs`.
    pub contracts: BTreeMap<String, contracts::Contract>,
    /// Permissões de conta (multiassinatura, v1 e v2).
    pub permissions: BTreeMap<String, gov::Permission>,
    /// Operações multiassinatura pendentes, por id de transação.
    ///
    /// A entrada guarda o CORPO da operação, não só o tipo: quando a aprovação
    /// cruza o limiar é preciso saber destino e valor. Sem isso o trilho falha
    /// fechado na execução — que é o certo, mas deixa a conta travada.
    pub pending_ops: BTreeMap<String, gov::PendingOp>,
    /// Mudança estrutural de permissão pendente — no máximo UMA por conta.
    pub pending_perm: BTreeMap<String, gov::PendingPerm>,
    /// Propostas de governança.
    pub proposals: BTreeMap<String, gov::Proposal>,
    /// Parâmetros sobrescritos por governança.
    pub params: BTreeMap<String, String>,
    /// Oráculos de IA registrados.
    pub oracles: BTreeMap<String, ai::Oracle>,
    /// Tarefas da camada de IA.
    pub ai_tasks: BTreeMap<String, ai::Task>,
    /// Atestadores de IA (Fase 6).
    pub ai_attesters: BTreeMap<String, ai::Attester>,
    /// Estado da ponte cross-chain.
    pub bridge: bridge::Bridge,
    /// Relayers autorizados da ponte.
    ///
    /// CONJUNTO, não lista. A referência usa um objeto (`bridgeRelayers[addr] = true`)
    /// e conta o quórum com `Object.keys(...).length`, que é inerentemente único.
    /// Como `Vec`, uma entrada duplicada INFLARIA o denominador do quórum de maioria
    /// (`len()/2+1`) e permitiria liberar fundos com menos atestações do que a regra
    /// exige. Erro meu na primeira versão desta struct.
    pub bridge_relayers: BTreeSet<String>,
    /// Comitês por cadeia de origem.
    pub bridge_source_committees: BTreeMap<String, bridge::Committee>,
    /// Delegação de recurso: dono → (destinatário → valor).
    pub delegations: BTreeMap<String, BTreeMap<String, Amount>>,
    /// Cronogramas de vesting.
    pub vesting: BTreeMap<String, value::Vesting>,
    /// Validadores punidos por assinatura dupla.
    pub slashed: BTreeMap<String, bool>,
    /// Acumulador de recompensa por voto — o padrão O(1) de resgate.
    pub reward_acc_per_vote: BTreeMap<String, Amount>,
    /// Débito de recompensa já contabilizada: eleitor → (validador → acumulador).
    ///
    /// ANINHADO, não plano. A referência é `voterRewardDebt[eleitor][validador]`
    /// (`state.js:553`), e como este mapa entra na folha do `stateRoot`, achatá-lo
    /// numa chave composta produziria outra raiz — mesmo com o comportamento
    /// idêntico. Erro meu na primeira versão desta struct.
    pub voter_reward_debt: BTreeMap<String, BTreeMap<String, Amount>>,
    /// Cofre da tesouraria, gasto por governança.
    pub treasury: Amount,
}

impl State {
    pub fn new() -> Self {
        Self::default()
    }

    /// Conta existente, ou uma zerada. NÃO materializa: ler não pode criar conta,
    /// senão uma consulta mudaria o `stateRoot`.
    pub fn account(&self, address: &str) -> Account {
        self.accounts.get(address).cloned().unwrap_or_default()
    }

    /// Conta para escrita, materializando se preciso.
    pub fn account_mut(&mut self, address: &str) -> &mut Account {
        self.accounts.entry(address.to_string()).or_default()
    }

    pub fn balance_of(&self, address: &str) -> Amount {
        self.accounts.get(address).map(|a| a.balance).unwrap_or(0)
    }

    /// `isFeeExempt` — `state.js:188`: stake >= `FEE_EXEMPT_STAKE` isenta de taxa.
    ///
    /// Vivia copiado como comparação solta em quem precisava (`api/address.rs`,
    /// e o `eth_sendRawTransaction` nem chegava a fazê-la). Comparação copiada é
    /// comparação que envelhece: o dia em que a governança mudar o limiar, uma
    /// das cópias fica para trás.
    pub fn is_fee_exempt(&self, address: &str) -> bool {
        self.accounts.get(address).map(|a| a.staked).unwrap_or(0) >= crate::config::FEE_EXEMPT_STAKE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conta_ausente_le_como_zerada_sem_materializar() {
        let s = State::new();
        assert_eq!(s.account("E7QUALQUER").balance, 0);
        assert!(s.accounts.is_empty(), "ler NÃO pode criar conta — mudaria a raiz");
    }

    #[test]
    fn aritmetica_checada_devolve_erro_em_vez_de_estourar() {
        assert!(soma(Amount::MAX, 1).is_err());
        assert!(sub(0, 1).is_err(), "saldo não pode ficar negativo");
        assert_eq!(soma(2, 3).unwrap(), 5);
        assert_eq!(sub(5, 3).unwrap(), 2);
    }

    #[test]
    fn resource_stake_soma_recebido_e_desconta_cedido() {
        let a = Account { staked: 1000, delegated_out: 300, delegated_in: 50, ..Default::default() };
        assert_eq!(a.resource_stake().unwrap(), 750);
    }

    #[test]
    fn resource_stake_falha_se_o_cedido_passar_do_proprio() {
        // Invariante do protocolo: nunca se cede mais recurso do que se tem. Se o
        // estado chegar aqui, algo já corrompeu — erro é melhor que valor absurdo.
        let a = Account { staked: 100, delegated_out: 500, ..Default::default() };
        assert!(a.resource_stake().is_err());
    }

    #[test]
    fn a_conta_codifica_com_as_chaves_da_referencia() {
        // Renomear qualquer chave aqui muda TODA raiz de estado da rede.
        let v = Account::default().to_value();
        let Value::Map(m) = v else { panic!("conta é mapa") };
        let chaves: Vec<&str> = m.keys().map(|s| s.as_str()).collect();
        assert_eq!(chaves, [
            "balance", "bandwidthBlock", "bandwidthUsed", "delegatedIn", "delegatedOut",
            "energyBlock", "energyUsed", "nonce", "staked",
        ]);
    }


    /// Ida e volta com TODOS os campos preenchidos e distintos entre si — trocar
    /// dois deles no decodificador passaria despercebido com valores iguais.
    #[test]
    fn a_conta_sobrevive_a_ida_e_volta() {
        let a = Account {
            balance: 123_456_789_012_345_678_901_234_567_890,
            nonce: 7,
            staked: 42_000,
            energy_used: 11,
            energy_block: 22,
            bandwidth_used: 33,
            bandwidth_block: 44,
            gb_used: 77,
            gb_block: 88,
            delegated_out: 55,
            delegated_in: 66,
            eavm_managed: true,
        };
        assert_eq!(Account::from_value(&a.to_value()), Some(a));

        // E a conta COMUM, que não tem a chave `eavmManaged`, volta com `false`.
        let comum = Account { balance: 1, ..Default::default() };
        assert_eq!(Account::from_value(&comum.to_value()), Some(comum));
    }

    #[test]
    fn transferencia_no_fork_gb_consome_gb_sem_energia() {
        let mut s = State::new();
        let de = "E7DE".to_string();
        let para = "E7PARA".to_string();
        s.accounts.insert(
            de.clone(),
            Account { balance: 1_000_000_000, nonce: 0, ..Default::default() },
        );

        let mut tx = Tx::new("TRANSFER", &de, 1, 1_700_000_000_000);
        tx.to = Some(para);
        tx.amount = "1000".into();
        tx.fee = "1000000".into();
        tx.id = Some("tx-gb".into());
        // Assinaturas enormes NÃO entram no consumo GB.
        tx.signature = Some("A".repeat(4000));
        tx.pq_signature = Some("B".repeat(4000));

        let altura = crate::config::GB_FEE_HEIGHT;
        s.apply_transaction(&tx, altura, 1_700_000_000_000).expect("transferência GB");

        let acc = s.account(&de);
        assert!(acc.gb_used > 0, "TRANSFER no fork GB consome GB");
        assert_eq!(acc.gb_block, altura);
        assert_eq!(acc.energy_used, 0, "trilho legado não commitado após GB");
        assert_eq!(acc.bandwidth_used, 0);

        // Mesma tx sem sigs deve consumir o mesmo (sigs fora do len útil).
        let mut s2 = State::new();
        s2.accounts.insert(
            de.clone(),
            Account { balance: 1_000_000_000, nonce: 0, ..Default::default() },
        );
        let mut tx2 = tx.clone();
        tx2.signature = None;
        tx2.pq_signature = None;
        s2.apply_transaction(&tx2, altura, 1_700_000_000_000).expect("sem sig");
        assert_eq!(s2.account(&de).gb_used, acc.gb_used);
    }

    #[test]
    fn delegate_resource_aumenta_cota_gb_do_receptor() {
        // Plano 12: stake efetivo (incl. delegatedIn) alimenta max_gb — DELEGATE_RESOURCE
        // já cede GB sem tipo novo SPONSOR_GB.
        use crate::config::{gb, GB_DAILY_BYTES, UNIT};
        let mut receptor = Account::default();
        let base = GB_DAILY_BYTES as f64;
        assert!((recursos::max_gb(&receptor) - base).abs() < 1.0);
        receptor.delegated_in = 50 * UNIT; // +50 MB/dia
        let esperado = base + 50.0 * gb::PER_STAKED_EAV7_BYTES as f64;
        assert!((recursos::max_gb(&receptor) - esperado).abs() < 1.0);
    }

    #[test]
    fn conta_com_campo_de_tipo_errado_e_recusada_sem_panico() {
        // O snapshot vem de disco: tipo trocado tem de virar `None`, nunca pânico.
        let Value::Map(mut m) = Account::default().to_value() else { panic!("mapa") };
        m.insert("balance".into(), Value::str("100"));
        assert_eq!(Account::from_value(&Value::Map(m)), None, "texto onde a folha tem inteiro");
        assert_eq!(Account::from_value(&Value::Null), None);
        // `eavmManaged: false` é forma que o codificador NUNCA emite.
        let Value::Map(mut m) = Account::default().to_value() else { panic!("mapa") };
        m.insert("eavmManaged".into(), Value::Bool(false));
        assert_eq!(Account::from_value(&Value::Map(m)), None);
    }

    /// O trilho de RECURSOS vale para TODA transação, não só as da EAVM.
    ///
    /// `apurar_taxa` nasceu como um `Ok(0)` de placeholder: nenhuma transação
    /// não-EAVM consumia energia nem bandwidth, e os contadores `energyUsed`/
    /// `energyBlock`/`bandwidthUsed`/`bandwidthBlock` — que ENTRAM na folha
    /// `acct` — ficavam zerados. O cliente acertava todos os saldos e ainda assim
    /// chegava a outra raiz. A prova de replay pegou isto no primeiro TRANSFER.
    #[test]
    fn transferencia_comum_consome_energia_e_bandwidth() {
        let mut s = State::new();
        let de = "E7DE".to_string();
        let para = "E7PARA".to_string();
        s.accounts.insert(de.clone(), Account { balance: 1_000_000_000, nonce: 0, ..Default::default() });

        let mut tx = Tx::new("TRANSFER", &de, 1, 1_700_000_000_000);
        tx.to = Some(para.clone());
        tx.amount = "1000".into();
        tx.fee = "1000000".into();
        tx.id = Some("tx-recursos".into());

        // Altura acima do fork de recursos: bandwidth entra no cálculo.
        let altura = crate::config::RESOURCE_HEIGHT;
        s.apply_transaction(&tx, altura, 1_700_000_000_000).expect("transferência válida");

        let acc = s.account(&de);
        assert!(acc.energy_used > 0, "TRANSFER tem de consumir energia (custo 1)");
        assert_eq!(acc.energy_block, altura, "o bloco da energia acompanha a altura");
        assert!(acc.bandwidth_used > 0, "TRANSFER tem de consumir bandwidth (tamanho da tx)");
        assert_eq!(acc.bandwidth_block, altura, "o bloco do bandwidth acompanha a altura");
    }
}

/// Resultado da apuração de taxa (legado energia/bandwidth ou GB unificado).
enum TaxaApurada {
    Legado { fee: Amount, energia: recursos::Peek, banda: Option<recursos::Peek> },
    Gb { fee: Amount, gb: recursos::Peek },
}

impl TaxaApurada {
    fn fee(&self) -> Amount {
        match self {
            Self::Legado { fee, .. } | Self::Gb { fee, .. } => *fee,
        }
    }
}

// ============================================================================
// Contexto de execução e despacho
// ============================================================================

/// Tudo o que um manipulador de transação precisa além do estado.
///
/// Passar isto em vez de espalhar parâmetros evita a classe de bug mais comum
/// deste port: um manipulador esquecer de checar a ALTURA e aceitar acima do fork
/// o que a rede rejeita abaixo — ou o contrário.
#[derive(Debug, Clone, Copy)]
pub struct Ctx {
    /// Altura do bloco. Decide quais forks estão ativos.
    pub height: u64,
    /// Timestamp do BLOCO, não da transação. Usar o da transação deixaria o
    /// remetente escolher o relógio do contrato.
    pub block_ts: u64,
    /// Taxa apurada pelo trilho de recursos.
    ///
    /// ATENÇÃO — quem DEBITA é cada ramo, não este contexto. A referência faz
    /// `acc.balance -= amount + fee` dentro de cada `case` (são 52 deles), e os
    /// módulos de domínio reproduzem isso. O `Ctx` só TRANSPORTA o valor.
    ///
    /// Uma versão anterior deste comentário dizia "já cobrada do remetente", o que
    /// levaria quem portar o trilho de recursos a debitar aqui TAMBÉM — cobrança
    /// dupla, silenciosa enquanto `fee` for zero e visível só quando deixasse de
    /// ser. A queima acontece UMA vez, no epílogo de `apply_transaction`.
    pub fee: Amount,
}

/// Resultado de aplicar uma transação.
///
/// `fee` é a taxa efetivamente QUEIMADA (o delta de `totalBurned`). ATENÇÃO —
/// ela é INFORMATIVA (recibo, telemetria, vetores de conformidade) e NÃO vai ao
/// produtor: a referência retorna `0n` ao bloco (`state.js:2635`, "Retorna 0 de
/// taxa ao bloco") e a queima acontece no epílogo. Somar `fee` à recompensa do
/// bloco creditaria o produtor com valor que já saiu do suprimento — divergência
/// de consenso na primeira taxa não-zero.
///
/// `eavm` é o recibo de execução quando a transação é `EAVM_DEPLOY`/`EAVM_CALL`
/// (`state.js:2600-2608`): uma chamada que REVERTE continua sendo transação
/// válida, e sem o recibo não há como distinguir sucesso de revert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedTx {
    pub fee: Amount,
    pub eavm: Option<eavm_tx::EavmOutcome>,
}

/// Resultado de aplicar uma transação (ver [`AppliedTx`]).
pub type Applied = R<AppliedTx>;

impl State {
    /// Aplica uma transação já validada de forma stateless.
    ///
    /// # Invariante central
    ///
    /// Se retornar `Err`, o estado tem de estar EXATAMENTE como antes. A referência
    /// garante isso operando sobre um clone que é descartado; aqui é
    /// responsabilidade de cada manipulador validar tudo ANTES de mutar qualquer
    /// coisa. Há teste de conformidade para isso (`rootAfter == rootBefore` em todo
    /// caso rejeitado de `vectors/state.json`) — não é convenção, é verificado.
    pub fn apply_transaction(&mut self, tx: &Tx, height: u64, block_ts: u64) -> Applied {
        // O nonce é conferido ANTES de materializar a conta: senão uma transação
        // rejeitada deixaria conta-fantasma de saldo zero no estado, mudando a raiz
        // sem que nenhuma transação tenha se aplicado.
        // `Tx.nonce` é `i64` porque é ENTRADA NÃO CONFIÁVEL: pode chegar negativa e
        // precisa ser rejeitada, não silenciada por um cast. `Account.nonce` é `u64`
        // porque é estado já validado. A conversão abaixo É a validação — e por isso
        // acontece aqui, no limite entre os dois mundos, e não espalhada nos módulos.
        let nonce_atual = self.accounts.get(&tx.from).map(|a| a.nonce).unwrap_or(0);
        let esperado = nonce_atual + 1;
        let recebido = u64::try_from(tx.nonce).map_err(|_| {
            StateError::new(format!("nonce inválido (esperado {esperado}, recebido {})", tx.nonce))
        })?;
        if recebido != esperado {
            return Err(StateError::new(format!(
                "nonce inválido (esperado {esperado}, recebido {recebido})"
            )));
        }

        // TETO DO `fee` — SEGUNDA CAMADA.
        //
        // A validação stateless (`verify_transaction`) já o aplica, e todo bloco
        // passa por ela. A referência REPETE a checagem aqui de propósito
        // (state.js:1142), e a repetição é o ponto: quem chamar
        // `apply_transaction` por outro caminho — simulação, ferramenta, um
        // despacho novo — não perde a guarda por esquecimento.
        //
        // A ORDEM também é a da referência: antes da guarda de multiassinatura.
        // Quando as duas condições falham juntas, é este o erro que aparece.
        if tx.fee.parse::<Amount>().is_ok_and(|f| f > crate::config::MAX_FEE_LIMIT) {
            return Err(StateError::new("limite de taxa (fee) acima do máximo permitido"));
        }

        // GUARDA DE ASSINATURA ÚNICA.
        //
        // Conta com permissão configurada NÃO age por assinatura direta: todas as
        // operações dela passam por MULTISIG_PROPOSE/APPROVE, assinadas pelas chaves
        // autorizadas a partir das contas DELAS. Sem esta guarda, a chave-dona
        // original burla o M-de-N simplesmente fazendo um TRANSFER — e todo o
        // desenho de multiassinatura vira decoração.
        //
        // Fica AQUI, antes do despacho, e não em cada módulo: um domínio que
        // esquecesse a checagem abriria a porta sozinho. Espelha `state.js:1138`.
        //
        // Exceção: as próprias transações do trilho multiassinatura e de permissão
        // são assinadas por OUTRAS contas (as chaves), então nunca chegam aqui com
        // `from` sendo a conta multisig.
        if self.permissions.contains_key(&tx.from) {
            return Err(StateError::new(
                "conta multisig: opere via MULTISIG_PROPOSE/APPROVE, não por assinatura única",
            ));
        }

        // ROTA EAVM (state.js:1155-1183). Fica FORA do despacho comum porque o
        // fluxo de recursos é invertido: a VM roda ANTES da apuração da taxa — o
        // gás gasto vira energia (custo = base + ceil(gasUsed/GAS_PER_ENERGY)) e
        // só então a falta é convertida em queima. `eavm_tx::aplicar` também faz
        // o peek/commit de energia e bandwidth (o mesmo `state::recursos` que o
        // trilho genérico usa) e devolve o recibo de execução (achados H1 e
        // C-1/A-4 — ver `state/eavm_tx.rs`).
        if matches!(tx.tx_type.as_str(), "EAVM_DEPLOY" | "EAVM_CALL" | "EAVM_TRANSFER") {
            let (fee, eavm) = eavm_tx::aplicar(self, tx, height, block_ts)?;
            // O epílogo é o MESMO dos outros tipos (state.js:2629-2635): nonce
            // avança e a taxa some do suprimento — nunca vai ao produtor.
            self.account_mut(&tx.from).nonce = recebido;
            self.total_burned = soma(self.total_burned, fee)?;
            return Ok(AppliedTx { fee, eavm });
        }

        // TRILHO DE RECURSOS (state.js:1160-1183). O `peek` NÃO muta: só mede
        // quanta energia/bandwidth (ou GB) falta. O commit vem no epílogo, depois
        // de TODAS as validações passarem — uma transação que lança não pode deixar
        // contador sujo no estado.
        let apurada = self.apurar_taxa(tx, height)?;
        let fee = apurada.fee();
        let ctx = Ctx { height, block_ts, fee };

        self.despachar(tx, &ctx)?;

        // O nonce só avança DEPOIS do sucesso: transação rejeitada não consome nonce,
        // senão uma rejeição travaria todas as seguintes da mesma conta.
        // Os contadores de recurso commitam aqui, junto — e ENTRAM na folha `acct`
        // do stateRoot: um cliente que não os grave chega a outra raiz mesmo
        // acertando todos os saldos (foi assim que a prova de replay pegou isto).
        {
            let acc = self.account_mut(&tx.from);
            acc.nonce = recebido;
            match &apurada {
                TaxaApurada::Legado { energia, banda, .. } => {
                    recursos::commit_energy(acc, height, energia);
                    if let Some(b) = banda {
                        recursos::commit_bandwidth(acc, height, b);
                    }
                }
                TaxaApurada::Gb { gb, .. } => {
                    recursos::commit_gb(acc, height, gb);
                }
            }
        }

        // Epílogo: a taxa que os ramos debitaram some do suprimento. Fica AQUI, uma
        // vez só — a referência faz o mesmo (`state.js`, `totalBurned += fee` fora do
        // switch). Contabilizar dentro de cada ramo daria queima múltipla em qualquer
        // tipo que debitasse mais de uma vez, e o suprimento deixaria de fechar.
        self.total_burned = soma(self.total_burned, fee)?;
        Ok(AppliedTx { fee, eavm: None })
    }

    /// Encaminha para o módulo do domínio. A ordem dos ramos não importa; o que
    /// importa é que todo tipo tenha destino — o ramo final garante isso.
    fn despachar(&mut self, tx: &Tx, ctx: &Ctx) -> R<()> {
        match tx.tx_type.as_str() {
            t if value::TIPOS.contains(&t) => value::aplicar(self, tx, ctx),
            t if token::TIPOS.contains(&t) => token::aplicar(self, tx, ctx),
            t if nft::TIPOS.contains(&t) => nft::aplicar(self, tx, ctx),
            t if gov::TIPOS.contains(&t) => gov::aplicar(self, tx, ctx),
            t if ai::TIPOS.contains(&t) => ai::aplicar(self, tx, ctx),
            t if bridge::TIPOS.contains(&t) => bridge::aplicar(self, tx, ctx),
            // Os tipos EAVM são tratados ANTES do despacho, em `apply_transaction`
            // (a VM roda antes da apuração da taxa — ver `state/eavm_tx.rs`).
            // Chegar aqui com um deles é bug de fluxo, não tipo desconhecido:
            // falhar com mensagem própria evita mascarar o erro.
            "EAVM_DEPLOY" | "EAVM_CALL" | "EAVM_TRANSFER" => Err(StateError::new(
                "EAVM_*: rota própria em apply_transaction — despacho inalcançável",
            )),
            outro => Err(StateError::new(format!("tipo de transação desconhecido: {outro}"))),
        }
    }

    /// Apura a taxa pelo trilho de recursos e devolve também os `peek`s, para o
    /// chamador commitá-los DEPOIS de as validações passarem.
    ///
    /// APURA e DEVOLVE — não debita. O débito é de cada ramo (ver o doc de
    /// `Ctx::fee`) e a queima é do epílogo; debitar aqui cobraria duas vezes.
    ///
    /// Espelha `applyTransaction` (state.js:1160-1183): o custo em energia vem da
    /// tabela por tipo (`ENERGY.COST[type] ?? 1`); acima de `RESOURCE_HEIGHT` o
    /// bandwidth cobra o TAMANHO canônico da transação; a falta de cada recurso é
    /// QUEIMADA em EAV7. A partir de `GB_FEE_HEIGHT` só o trilho GB (plano 12).
    /// Se a queima ultrapassa o limite que o remetente autorizou (`tx.fee`), a
    /// transação é recusada — e como nada foi commitado ainda, o estado fica intacto.
    fn apurar_taxa(&mut self, tx: &Tx, height: u64) -> R<TaxaApurada> {
        // `getAccount(tx.from)` do JS materializa a conta aqui. Reproduzimos: o
        // remetente de uma transação que CHEGA a este ponto já passou pelo nonce,
        // então a conta existe de fato na referência a partir daqui.
        let acc = self.account(&tx.from);
        let limite: Amount = tx.fee.parse().map_err(|_| StateError::new("taxa inválida"))?;

        if height >= crate::config::GB_FEE_HEIGHT {
            let gb = recursos::peek_gb(&acc, height, recursos::consumo_gb(tx));
            let fee = recursos::taxa_gb(&gb)?;
            if fee > limite {
                return Err(StateError::new(
                    "GB insuficiente e limite de taxa excedido — faça stake ou aumente o limite",
                ));
            }
            return Ok(TaxaApurada::Gb { fee, gb });
        }

        let custo = crate::config::energy_cost(&tx.tx_type) as f64;
        let energia = recursos::peek_energy(&acc, height, custo);

        // #6: o bandwidth só existe a partir do fork. Abaixo dele o cálculo de
        // taxa é o antigo, e o replay do histórico continua válido.
        let banda = if height >= crate::config::RESOURCE_HEIGHT {
            Some(recursos::peek_bandwidth(&acc, height, recursos::canonical_tx_bytes(tx) as f64))
        } else {
            None
        };

        let fee = recursos::taxa_de(&energia, banda.as_ref())?;
        if fee > limite {
            return Err(StateError::new(
                "recursos (energia/bandwidth) insuficientes e limite de taxa excedido — \
                 faça stake ou aumente o limite",
            ));
        }
        Ok(TaxaApurada::Legado { fee, energia, banda })
    }

    /// Debita saldo, falhando se não cobrir. Centralizado para que nenhum
    /// manipulador implemente a checagem por conta própria e esqueça um caso.
    pub(crate) fn debitar(&mut self, endereco: &str, valor: Amount) -> R<()> {
        let conta = self.account_mut(endereco);
        conta.balance = sub(conta.balance, valor)
            .map_err(|_| StateError::new("saldo insuficiente"))?;
        Ok(())
    }

    /// Credita saldo, materializando a conta se preciso.
    pub(crate) fn creditar(&mut self, endereco: &str, valor: Amount) -> R<()> {
        let conta = self.account_mut(endereco);
        conta.balance = soma(conta.balance, valor)?;
        Ok(())
    }

    /// Queima: sai do saldo e do suprimento. Contabilizar a queima é o que mantém
    /// o suprimento auditável — sem isso, a taxa some sem rastro.
    pub(crate) fn queimar(&mut self, endereco: &str, valor: Amount) -> R<()> {
        self.debitar(endereco, valor)?;
        self.total_burned = soma(self.total_burned, valor)?;
        Ok(())
    }
}
