//! A cadeia: encadeamento, rodízio DPoS, aplicação de blocos e reorganização.
//!
//! Porte de `src/core/blockchain.js`. Enquanto [`crate::block`] decide o que dá
//! para saber olhando UM bloco, este módulo decide tudo o que exige contexto:
//! altura em relação à cabeça, `previousHash`, de quem é o slot, se a raiz do
//! estado bate, e qual de duas cadeias concorrentes é a boa.
//!
//! # As quatro regras que sustentam o consenso
//!
//! 1. **Rodízio determinístico.** `expectedProducer(ts) = validators[slot % N]`,
//!    com `slot = floor(ts / BLOCK_TIME_MS)`. Não há eleição, sorteio nem estado
//!    escondido: qualquer nó, com o mesmo estado, calcula o mesmo produtor para o
//!    mesmo instante. É o consenso inteiro.
//! 2. **Um bloco por slot.** O slot do bloco tem de ser ESTRITAMENTE maior que o
//!    da cabeça. Sem isso um validador emitiria centenas de blocos dentro do seu
//!    próprio slot (timestamps a 1 ms), inflando a emissão e monopolizando a
//!    cadeia. Junto com a tolerância de relógio, é o que fecha o grinding de
//!    timestamp: não adianta escolher um timestamp conveniente se ele cai num slot
//!    já ocupado ou num slot que ainda não chegou.
//! 3. **Produtor estrito acima do fork.** A partir de [`STRICT_PRODUCER_HEIGHT`] o
//!    bloco só vale se vier do produtor EXATO do slot. Abaixo, basta ser validador
//!    ativo — porque o histórico foi produzido sob a regra antiga e precisa
//!    continuar verificável.
//! 4. **`stateRoot` conferido.** Acima de [`crate::block::STATEROOT_HEIGHT`] o
//!    header commita a raiz do estado APÓS o bloco, e ela é recomputada aqui.
//!    Divergência de raiz é bloco rejeitado — é a única checagem que pega
//!    divergência de ESTADO entre nós.
//!
//! # Persistência
//!
//! * [`crate::blockstore`] — append JSONL, sidecars G7 (`blocks.idx` /
//!   `hashes.bin`), truncamento de rabo, replay tolerante a rasgo.
//! * Snapshot de boot (`crate::snapshot` + [`Blockchain::load_from_snapshot`] /
//!   [`Blockchain::talvez_snapshot`]) — estado provado contra `stateRoot` do
//!   header; encode+write fora do caminho quente (G8). Reorg abaixo da altura
//!   gravada invalida o arquivo (epoch).
//! * Sem store, a janela em RAM é a cadeia inteira (ver [`Blockchain::slide_tail`]).
//!   Sem snapshot válido, o boot cai em [`Blockchain::load_from_disk`] (fonte de
//!   verdade).

use std::collections::{BTreeMap, BTreeSet};

use crate::block::{
    block_validator, build_block, verify_block_integrity, verify_block_integrity_ex, Block,
    BlockSigner, BuildParams,
    STATEROOT_HEIGHT,
};
use crate::hash::is_valid_hash;
use crate::state::{Amount, State};
use crate::stateroot::compute_state_root;
use crate::transaction::{verify_transaction, Tx};

// ============================================================================
// Constantes de consenso
//
// TODAS derivam de [`crate::config`], que é gerado de `src/config.js` — nenhuma
// cópia literal mora aqui. Os apelidos existem só para ajustar o TIPO ao uso
// local: o gerador emite tudo como `u64`/`u128`, e aqui timestamp e slot são
// `i64` (a cadeia usa `-1` para "sem cabeça"), enquanto contagem é `usize`.
// ============================================================================

/// `CHAIN.BLOCK_TIME_MS`. É o denominador do slot — mudá-lo renumera TODOS os
/// slots da história e troca o produtor de cada bloco passado.
pub const BLOCK_TIME_MS: i64 = crate::config::BLOCK_TIME_MS as i64;

/// `CHAIN.MAX_TXS_PER_BLOCK`.
pub const MAX_TXS_PER_BLOCK: usize = crate::config::MAX_TXS_PER_BLOCK as usize;

/// `CHAIN.MAX_CLOCK_DRIFT_MS` — quanto o timestamp pode passar do relógio local
/// antes de o bloco ser considerado do futuro.
pub const MAX_CLOCK_DRIFT_MS: i64 = crate::config::MAX_CLOCK_DRIFT_MS as i64;

/// `CHAIN.SLOT_FUTURE_TOLERANCE_MS` — folga de skew + propagação aplicada ao
/// SLOT (não ao timestamp).
pub const SLOT_FUTURE_TOLERANCE_MS: i64 = crate::config::SLOT_FUTURE_TOLERANCE_MS as i64;

/// `CHAIN.STRICT_PRODUCER_HEIGHT`. Acima daqui vale só o produtor escalado do
/// slot; abaixo, qualquer validador ativo (achado C1).
pub const STRICT_PRODUCER_HEIGHT: u64 = crate::config::STRICT_PRODUCER_HEIGHT;

/// `CHAIN.REORG_WINDOW`.
pub const REORG_WINDOW: u64 = crate::config::REORG_WINDOW;

/// `CHAIN.MAX_VALIDATORS`. GOVERNÁVEL.
pub const MAX_VALIDATORS: usize = crate::config::MAX_VALIDATORS as usize;

/// `CHAIN.MIN_VALIDATOR_STAKE`. GOVERNÁVEL.
pub const MIN_VALIDATOR_STAKE: Amount = crate::config::MIN_VALIDATOR_STAKE;

/// `CHAIN.DEFAULT_COMMISSION_PCT`.
pub const DEFAULT_COMMISSION_PCT: Amount = crate::config::DEFAULT_COMMISSION_PCT as Amount;

/// `CHAIN.REWARD_SCALE` — escala do acumulador de recompensa por voto, para a
/// divisão inteira não truncar a parcela de cada eleitor.
pub const REWARD_SCALE: Amount = crate::config::REWARD_SCALE;

/// `CHAIN.TREASURY_PCT`. GOVERNÁVEL.
pub const TREASURY_PCT: Amount = crate::config::TREASURY_PCT as Amount;

/// `CHAIN.BLOCK_REWARD`. GOVERNÁVEL.
pub const BLOCK_REWARD: Amount = crate::config::BLOCK_REWARD;

/// `CHAIN.HALVING_INTERVAL_BLOCKS`.
pub const HALVING_INTERVAL_BLOCKS: u64 = crate::config::HALVING_INTERVAL_BLOCKS;

/// `CHAIN.FINALITY_MIN_VALIDATORS` — abaixo disto não há garantia BFT e a
/// finalidade dinâmica fica desligada.
pub const FINALITY_MIN_VALIDATORS: usize = crate::config::FINALITY_MIN_VALIDATORS as usize;

/// `CHAIN.EAVM_OSAKA_HEIGHT` — a partir daqui o hash do PAI é gravado no anel de
/// histórico (EIP-2935). Ver [`record_block_hash`].
pub const EAVM_OSAKA_HEIGHT: u64 = crate::config::EAVM_OSAKA_HEIGHT;

/// Erro de cadeia. Texto porque a referência devolve a mensagem crua e ela
/// atravessa a API do nó — divergir na mensagem quebra ferramenta de operação.
pub type ChainError = String;

// ============================================================================
// Hooks que pertencem ao `State`
//
// As funções desta seção espelham métodos que a referência tem em `State`
// (`validators`, `param`, `distributeBlockReward`, `blockTick`, `applyGenesis`,
// `recordBlockHash`). Vivem aqui, como funções livres sobre `&mut State`, porque
// dependem de conhecimento da CADEIA — recompensa por altura, alturas de fork,
// conjunto ativo — que o `State` não tem nem deveria ter: ele é a fotografia, não
// a linha do tempo. `record_block_hash` já é a exceção que confirma a regra: é
// uma delegação de uma linha para `State::record_block_hash`, porque o anel é
// storage de contrato e portanto pertence ao estado.
// ============================================================================

/// Um validador do conjunto ativo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Validator {
    pub address: String,
    pub staked: Amount,
    pub votes: Amount,
}

/// Valor efetivo de um parâmetro governável: o override aprovado on-chain, se
/// houver; senão o padrão de compilação. Espelha `State.param`.
///
/// Ler a constante direto estaria ERRADO: uma proposta aprovada mudaria o
/// parâmetro na rede e este cliente seguiria com o valor de compilação,
/// divergindo em toda decisão que dependesse dele — inclusive quem é validador.
fn param_amount(state: &State, nome: &str, padrao: Amount) -> Result<Amount, ChainError> {
    match state.params.get(nome) {
        Some(s) => s.parse::<Amount>().map_err(|_| format!("parâmetro {nome} inválido no estado")),
        None => Ok(padrao),
    }
}

fn param_usize(state: &State, nome: &str, padrao: usize) -> Result<usize, ChainError> {
    match state.params.get(nome) {
        Some(s) => s.parse::<usize>().map_err(|_| format!("parâmetro {nome} inválido no estado")),
        None => Ok(padrao),
    }
}

/// Conjunto ativo: os top-N candidatos elegíveis por PESO = self-stake + votos
/// recebidos. Espelha `State.validators`.
///
/// A ORDEM é consenso, não apresentação: é o índice desta lista que o rodízio
/// consulta. Por isso o desempate por endereço existe — sem ele, dois validadores
/// de peso idêntico poderiam sair em ordens diferentes em dois nós e cada um
/// esperaria um produtor distinto para o mesmo slot.
///
/// Contas `eavmManaged` são EXCLUÍDAS: elas não têm par de chaves híbrido, logo não
/// conseguem assinar bloco. Se entrassem no rodízio, o slot delas seria sempre
/// pulado — perda de liveness que qualquer um provoca stakeando pela rota EVM.
pub fn validators(state: &State) -> Result<Vec<Validator>, ChainError> {
    let min_stake = param_amount(state, "MIN_VALIDATOR_STAKE", MIN_VALIDATOR_STAKE)?;
    let max = param_usize(state, "MAX_VALIDATORS", MAX_VALIDATORS)?;
    let mut lista: Vec<Validator> = state
        .accounts
        .iter()
        .filter(|(_, acc)| acc.staked >= min_stake && !acc.eavm_managed)
        .map(|(addr, acc)| Validator {
            address: addr.clone(),
            staked: acc.staked,
            votes: state.candidate_votes.get(addr).copied().unwrap_or(0),
        })
        .collect();
    lista.sort_by(|a, b| {
        // `saturating_add` e não `checked`: isto é ORDENAÇÃO, e um erro aqui não
        // teria para onde ir sem tornar `validators` falível por um caso
        // inalcançável (stake + votos passam de 2¹²⁸ apenas com estado corrompido).
        let pa = a.staked.saturating_add(a.votes);
        let pb = b.staked.saturating_add(b.votes);
        pb.cmp(&pa).then_with(|| a.address.cmp(&b.address))
    });
    lista.truncate(max);
    Ok(lista)
}

/// Banco (standby): candidatas ranqueadas após o top `MAX_VALIDATORS`.
/// Ver `docs/plano/17-set-51-banco-101.md`.
pub fn validator_bank(state: &State) -> Result<Vec<Validator>, ChainError> {
    use crate::config::VALIDATOR_BANK_SIZE;
    let min_stake = param_amount(state, "MIN_VALIDATOR_STAKE", MIN_VALIDATOR_STAKE)?;
    let max = param_usize(state, "MAX_VALIDATORS", MAX_VALIDATORS)?;
    let bank = VALIDATOR_BANK_SIZE as usize;
    let mut lista: Vec<Validator> = state
        .accounts
        .iter()
        .filter(|(_, acc)| acc.staked >= min_stake && !acc.eavm_managed)
        .map(|(addr, acc)| Validator {
            address: addr.clone(),
            staked: acc.staked,
            votes: state.candidate_votes.get(addr).copied().unwrap_or(0),
        })
        .collect();
    lista.sort_by(|a, b| {
        let pa = a.staked.saturating_add(a.votes);
        let pb = b.staked.saturating_add(b.votes);
        pb.cmp(&pa).then_with(|| a.address.cmp(&b.address))
    });
    if lista.len() <= max {
        return Ok(Vec::new());
    }
    let fim = (max + bank).min(lista.len());
    Ok(lista[max..fim].to_vec())
}

/// Distribui a recompensa do bloco: corte da tesouraria, comissão do produtor e
/// partilha com quem votou nele. Espelha `State.distributeBlockReward`.
///
/// O `dust` da divisão inteira vai ao produtor — é o que conserva o total. Sem
/// isso, cada bloco perderia alguns e7 no arredondamento e o suprimento
/// contabilizado deixaria de fechar com o distribuído.
pub fn distribute_block_reward(
    state: &mut State,
    producer: &str,
    reward: Amount,
) -> Result<(), ChainError> {
    let pct_tesouraria = param_amount(state, "TREASURY_PCT", TREASURY_PCT)?;
    let mut reward = reward;
    let corte = reward
        .checked_mul(pct_tesouraria)
        .ok_or("estouro no corte da tesouraria")?
        / 100;
    if corte > 0 {
        state.treasury = state.treasury.checked_add(corte).ok_or("estouro na tesouraria")?;
        reward -= corte;
    }

    let total_votos = state.candidate_votes.get(producer).copied().unwrap_or(0);
    if total_votos == 0 || reward == 0 {
        // Sem votos, o produtor leva tudo — retrocompatível com o modelo anterior
        // à votação de validadores.
        return state.creditar(producer, reward).map_err(|e| e.to_string());
    }
    let pct = Amount::from(
        state.commission.get(producer).copied().unwrap_or(DEFAULT_COMMISSION_PCT as u8),
    );
    let comissao = reward.checked_mul(pct).ok_or("estouro na comissão")? / 100;
    let parcela_eleitores = reward - comissao;
    let inc = parcela_eleitores
        .checked_mul(REWARD_SCALE)
        .ok_or("estouro na escala de recompensa")?
        / total_votos;
    let dust = parcela_eleitores - (inc.checked_mul(total_votos).ok_or("estouro no dust")? / REWARD_SCALE);
    state.creditar(producer, comissao + dust).map_err(|e| e.to_string())?;
    let acc = state.reward_acc_per_vote.entry(producer.to_string()).or_insert(0);
    *acc = acc.checked_add(inc).ok_or("estouro no acumulador de recompensa")?;
    Ok(())
}

/// Hook determinístico rodado UMA vez por bloco, depois das transações.
/// Espelha `State.blockTick`.
///
/// As CINCO etapas da referência, na ordem dela: (1) governança madura e poda de
/// propostas, (2) expiração de ops multiassinatura vencidas, (3) comissão
/// agendada, (4) timelock de permissão — revalidando a autorização sob a
/// permissão VIGENTE —, (5) maturação da fila de unbonding.
///
/// (1), (2) e (4) delegam a `state/gov.rs`, que é dono das regras de governança e
/// permissão: implementá-las aqui daria uma SEGUNDA versão da mesma regra de
/// consenso — o pior desfecho possível. Esta função só compõe.
///
/// A ORDEM é consenso, não organização: aplicar um override de
/// `MIN_VALIDATOR_STAKE` antes de reavaliar permissões é observável quando as
/// duas coisas maturam no mesmo bloco.
pub fn block_tick(state: &mut State, height: u64) -> Result<(), ChainError> {
    // A ORDEM espelha `state.js:blockTick` exatamente: propostas maduras → ops
    // multisig vencidas → comissão → timelock de permissão → unbonding. É consenso —
    // aplicar um override de `MIN_VALIDATOR_STAKE` antes de reavaliar permissões, por
    // exemplo, é observável se as duas coisas maturarem no mesmo bloco.

    // (1) governança madura + poda de propostas.
    crate::state::gov::matura_propostas(state, height).map_err(|e| e.to_string())?;

    // (2) ops multiassinatura pendentes cujo prazo venceu.
    crate::state::gov::expira_ops_multisig(state, height);

    // (3) comissão agendada que venceu.
    let vencidas: Vec<(String, u8)> = state
        .pending_commission
        .iter()
        .filter(|(_, (_, ativa_em))| height >= *ativa_em)
        .map(|(addr, (pct, _))| (addr.clone(), *pct))
        .collect();
    for (addr, pct) in vencidas {
        state.commission.insert(addr.clone(), pct);
        state.pending_commission.remove(&addr);
    }

    // (4) permissões v2: aplica as mudanças cujo timelock venceu, revalidando a
    // autorização e o anti-trava sob a permissão VIGENTE no momento de aplicar.
    crate::state::gov::matura_permissoes(state, height);

    // (5) unbonding maduro: o stake dessteikado volta ao saldo depois do período.
    if !state.unbonding.is_empty() {
        let mut restantes = Vec::with_capacity(state.unbonding.len());
        let mut a_creditar = Vec::new();
        for (dono, valor, matura_em) in std::mem::take(&mut state.unbonding) {
            if height >= matura_em {
                a_creditar.push((dono, valor));
            } else {
                restantes.push((dono, valor, matura_em));
            }
        }
        state.unbonding = restantes;
        for (dono, valor) in a_creditar {
            state.creditar(&dono, valor).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Aplica as alocações do bloco gênese. Espelha `State.applyGenesis`.
///
/// Lê o [`crate::transaction::JsonValue`] cru do bloco em vez de uma struct
/// tipada: as alocações entram no PAYLOAD assinado do gênese, e um campo que a
/// tipagem descartasse mudaria o hash do gênese — que é exatamente o valor fixado
/// (`expected_genesis_hash`) que impede um peer de impor outra rede.
///
/// Inclui `bridgeSourceCommittees`: um gênese que traga comitês é o desenho da
/// ponte trustless (o conjunto de assinantes da origem nasce fixado, sem depender
/// de uma governança que ainda não existe no bloco 0). Ficavam de fora sob a
/// alegação de que `bridge::Committee` estava "em porte paralelo" — o tipo existe
/// completo, com `to_value`. O efeito era: toda prova de comitê falhava, e com
/// `STATEROOT_HEIGHT = 0` o bloco 1 já não fechava a raiz.
pub fn apply_genesis(state: &mut State, alocacoes: &JsonValueRef) -> Result<(), ChainError> {
    use crate::state::value::Vesting;
    use crate::transaction::JsonValue;

    let JsonValue::Map(g) = alocacoes else {
        return Err("alocações da gênese ausentes".into());
    };
    let amount = |v: &JsonValue| -> Result<Amount, ChainError> {
        match v {
            JsonValue::Str(s) => s.parse::<Amount>().map_err(|_| "valor de gênese inválido".to_string()),
            JsonValue::Int(n) => Amount::try_from(*n).map_err(|_| "valor de gênese negativo".to_string()),
            _ => Err("valor de gênese inválido".into()),
        }
    };
    if let Some(JsonValue::Map(saldos)) = g.get("balances") {
        for (endereco, valor) in saldos {
            state.creditar(endereco, amount(valor)?).map_err(|e| e.to_string())?;
        }
    }
    if let Some(JsonValue::Map(stakes)) = g.get("stakes") {
        for (endereco, valor) in stakes {
            let v = amount(valor)?;
            let conta = state.account_mut(endereco);
            conta.staked = conta.staked.checked_add(v).ok_or("estouro no stake do gênese")?;
        }
    }
    if let Some(JsonValue::List(relayers)) = g.get("bridgeRelayers") {
        for r in relayers {
            if let JsonValue::Str(addr) = r {
                state.bridge_relayers.insert(addr.clone());
            }
        }
    }
    // Vesting semeado no gênese: distribuição de time/investidor nasce VESTIDA, não
    // líquida. `start = 0` porque o gênese é a altura 0.
    if let Some(JsonValue::List(itens)) = g.get("vesting") {
        for item in itens {
            let JsonValue::Map(v) = item else { continue };
            let (Some(JsonValue::Str(id)), Some(JsonValue::Str(benef))) =
                (v.get("id"), v.get("beneficiary"))
            else {
                return Err("vesting do gênese malformado".into());
            };
            let total = v.get("total").ok_or("vesting do gênese sem total")?;
            // `Number(v.cliff) || 0` / `Number(v.duration) || 1` (state.js:876).
            // Casava só `Int` — um gênese com `{"cliff": "100"}` (texto, que é como
            // um gerador de JSON facilmente emite) dava `cliff = 0` aqui e `100` na
            // rede: folha `vest` diferente já no bloco 0, e o beneficiário liberando
            // TUDO de imediato neste cliente.
            let inteiro = |chave: &str, padrao: u64| -> u64 {
                v.get(chave)
                    .and_then(crate::state::coercao::js_number_seguro_de)
                    .and_then(|n| u64::try_from(n).ok())
                    // `|| padrao`: no JS o zero é falsy e cai no padrão, igual ao
                    // `NaN`. É por isso que a comparação é com zero, não com `None`.
                    .filter(|n| *n != 0)
                    .unwrap_or(padrao)
            };
            state.vesting.insert(
                id.clone(),
                Vesting {
                    beneficiary: benef.clone(),
                    total: amount(total)?,
                    claimed: 0,
                    start: 0,
                    cliff: inteiro("cliff", 0),
                    // `Number(v.duration) || 1` na referência: zero vira 1, senão a
                    // divisão do vesting seria por zero.
                    duration: inteiro("duration", 1).max(1),
                },
            );
        }
    }

    // Comitês de origem da ponte (state.js:880-886). A normalização é do JS e
    // importa para a folha: a CHAVE vai em maiúsculas, os membros em minúsculas,
    // e `quorum`/`epoch` ausentes ou ilegíveis viram 0 (`Number(x) || 0`).
    if let Some(JsonValue::Map(comites)) = g.get("bridgeSourceCommittees") {
        for (cadeia, valor) in comites {
            let JsonValue::Map(c) = valor else { continue };
            // `.map((m) => String(m).toLowerCase())` (state.js:881): TODO item vira
            // texto, nenhum é descartado. Filtrar por `Str` fazia um membro
            // numérico sumir aqui e continuar na rede — listas de tamanhos
            // diferentes, folha `brg:committees` diferente já no bloco 0, e um
            // `quorum` que a rede considera atingível e este cliente não.
            let membros = match c.get("members") {
                Some(JsonValue::List(itens)) => itens
                    .iter()
                    .map(|m| crate::state::coercao::js_string_de(m).to_lowercase())
                    .collect(),
                _ => Vec::new(),
            };
            // `Number(x) || 0` (state.js:884): coage texto, hex, booleano — e o
            // zero (falsy) cai no `|| 0` do mesmo jeito que o `NaN`.
            let numero = |chave: &str| -> u64 {
                c.get(chave)
                    .and_then(crate::state::coercao::js_number_seguro_de)
                    .and_then(|n| u64::try_from(n).ok())
                    .unwrap_or(0)
            };
            let chave = cadeia.to_uppercase();
            state.bridge_source_committees.insert(
                chave.clone(),
                crate::state::bridge::Committee {
                    source_chain: chave,
                    members: membros,
                    quorum: numero("quorum"),
                    // (d) rotação: incrementa a cada handoff assinado pela origem.
                    epoch: numero("epoch"),
                },
            );
        }
    }
    Ok(())
}

/// Alias para deixar a assinatura de [`apply_genesis`] legível sem importar o tipo
/// no topo (o `JsonValue` é o do módulo de transação, não o canônico do estado).
pub type JsonValueRef = crate::transaction::JsonValue;

/// Grava o hash do PAI no anel de histórico do EIP-2935. Espelha
/// `State.recordBlockHash`.
///
/// O anel do EIP-2935 mora no STORAGE de um contrato de sistema: slot =
/// `number % BLOCKHASH_HISTORY`, valor = `0x` + hash. Delegação fina para
/// [`State::record_block_hash`], que é quem conhece a seção de contratos.
///
/// Chamada nos DOIS caminhos de aplicação de bloco (`simulate` e
/// `apply_block_to`) — grava-la só num deles fazia a re-aplicação (âncora do
/// slide, rebuild de reorg) chegar a um estado sem as entradas do anel, e a raiz
/// divergir de quem nunca reorganizou.
fn record_block_hash(state: &mut State, number: u64, hash: &str) {
    state.record_block_hash(number, hash);
}

// ============================================================================
// A cadeia
// ============================================================================

/// Bloco cuja INTEGRIDADE (hash, txRoot, assinatura híbrida) já foi verificada.
///
/// Existe para que "pular a verificação" não seja um caminho alcançável por
/// engano. O construtor é privado ao módulo e só [`Blockchain::verificar_lote`] o
/// produz; o caminho de aplicação que pula a verificação só aceita este tipo.
///
/// Um `bool ja_verificado` daria o mesmo desempenho e nenhuma dessas garantias —
/// bastaria alguém passar `true` no lugar errado, uma vez, para blocos entrarem
/// sem prova. Aqui isso não compila.
pub struct BlocoVerificado(Block);

/// Resultado de uma tentativa de reorganização.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reorg {
    /// A cadeia candidata não era melhor; nada mudou.
    Manteve,
    /// A cadeia foi substituída. Carrega as transações ÓRFÃS — as dos blocos
    /// descartados que não estão na cadeia nova — para o chamador reinserir no
    /// mempool. Devolvê-las é o que impede que um reorg engula transações
    /// legítimas de quem não tinha nada a ver com o fork.
    Adotou(Vec<Tx>),
}

/// Política de descarte no boot a partir de `blocks.jsonl`.
///
/// Default: no máximo **1** bloco (rabo típico de crash no append). Qualquer
/// descarte maior exige flag/env explícita no nó — senão o boot ABORTA e o
/// arquivo fica intacto.
#[derive(Debug, Clone, Copy)]
pub struct LoadFromDiskOpts {
    pub max_auto_discard: u64,
}

impl Default for LoadFromDiskOpts {
    fn default() -> Self {
        Self {
            max_auto_discard: 1,
        }
    }
}

impl LoadFromDiskOpts {
    /// Operador assume o risco: permite truncar rabo arbitrário (após backup).
    pub fn force_discard_tail() -> Self {
        Self {
            max_auto_discard: u64::MAX,
        }
    }
}

/// A cadeia em memória.
///
/// Os campos são públicos, como na referência: a própria `reorg` monta uma cadeia
/// candidata atribuindo `tail`/`tailStart`/`state` direto, e esconder isso atrás de
/// construtores exigiria duplicar a lógica. O preço é que quem escreve nos campos
/// tem de manter os índices coerentes — a mesma responsabilidade que o JS já tinha.
/// NÃO é `Clone`, de propósito.
///
/// O `derive` estava lá por inércia e o compilador o derrubou quando o `BlockStore`
/// entrou — um descritor de arquivo não tem clone com significado, e duas cadeias
/// escrevendo o mesmo `blocks.jsonl` corromperiam o índice.
///
/// Ninguém precisava disso: a reorganização clona o ESTADO (`self.state.clone()`),
/// não a cadeia. A candidata é construída em memória e só a vencedora escreve no
/// disco. O tipo agora diz isso.
/// Recibo de execução EAVM de uma transação já minerada.
///
/// NÃO-CONSENSO: não entra no `stateRoot` nem no bloco. É índice local que o RPC
/// usa para responder `eth_getTransactionReceipt`. Sem ele, o recibo saía
/// degradado — `status: 0x1` para TUDO, inclusive chamada que REVERTEU, o que a
/// própria referência chama de "o pior tipo de mentira num recibo": a carteira
/// mostra sucesso para uma transação que não fez nada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recibo {
    pub success: bool,
    pub gas_used: u64,
    /// Endereço do contrato criado (deploy). Sem ele, `contractAddress` sai nulo
    /// e todo `tx.wait()` de deploy em Hardhat/ethers quebra.
    pub contract: Option<String>,
    pub block_height: u64,
}

/// Evento `LOG` emitido por contrato.
///
/// NÃO-CONSENSO, anel de tamanho fixo ([`MAX_LOG_INDEX`]): serve `eth_getLogs` e
/// a aba de eventos do explorer. Um nó que perca a janela não fica inválido —
/// perde histórico de consulta, e é por isso que o teto é aceitável.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventoIndexado {
    pub tx_id: String,
    pub block_height: u64,
    pub block_time: i64,
    pub address: String,
    pub topics: Vec<String>,
    pub data: String,
}

/// Transferência de valor movida pela EXECUÇÃO (não por transação assinada).
///
/// Tipo PRÓPRIO, e não um [`EventoIndexado`] com uma flag: os campos são outros
/// (`kind`, os dois endereços nas duas formas, `amount`) e o consumidor filtra
/// por eles (`api.js:605-613` casa E7 **e** 0x, dos dois lados). Espremê-los em
/// `address`/`topics`/`data` faria a API ter de reinventar o significado de cada
/// posição — e nenhum compilador pegaria o dia em que a ordem mudasse.
///
/// NÃO-CONSENSO, mesmo anel: valor interno é DERIVÁVEL reexecutando o bloco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferenciaInterna {
    pub tx_id: String,
    pub block_height: u64,
    pub block_time: i64,
    /// `"call"` ou `"create"` — `entry` nunca entra (state.js:959).
    pub kind: String,
    /// Endereços na forma EAVM (0x) e na forma nativa (E7): o explorer e a API
    /// aceitam as duas, e converter na consulta obrigaria a derivação a rodar a
    /// cada requisição.
    pub from: String,
    pub to: String,
    pub from_e7: String,
    pub to_e7: String,
    pub amount: crate::state::Amount,
}

/// Apara um anel ao teto, mantendo os MAIS RECENTES (o mais antigo sai).
fn aparar<T>(anel: &mut Vec<T>) {
    if anel.len() > MAX_LOG_INDEX {
        anel.drain(0..anel.len() - MAX_LOG_INDEX);
    }
}

/// `CHAIN.MAX_LOG_INDEX` — teto do anel de eventos node-local.
pub const MAX_LOG_INDEX: usize = crate::config::MAX_LOG_INDEX as usize;

#[derive(Debug, Default)]
pub struct Blockchain {
    /// Recibos de execução EAVM por id de transação (NÃO-consenso, node-local).
    /// Ver [`Recibo`].
    pub receipts: BTreeMap<String, Recibo>,
    /// Anel de eventos `LOG` de contrato (NÃO-consenso). Ver [`EventoIndexado`].
    pub log_index: Vec<EventoIndexado>,
    /// Anel de TRANSFERÊNCIAS INTERNAS (NÃO-consenso). Separado dos eventos
    /// porque o explorer os mostra em abas distintas e `eth_getLogs` não deve
    /// devolvê-los — não são `LOG` do EVM.
    pub internal_index: Vec<TransferenciaInterna>,
    /// Onde o snapshot de boot vive. `None` = sem snapshot (cadeia em memória, ou
    /// nó que não persiste).
    ///
    /// Fica AQUI, e não no chamador, para que a gravação e a invalidação não
    /// dependam de três call sites lembrarem de chamá-las. `add_block` e `reorg`
    /// cuidam disso — um caminho novo que aceite bloco herda o comportamento.
    pub snapshot_path: Option<std::path::PathBuf>,
    /// Altura do último snapshot gravado — só para espaçar as gravações.
    /// NÃO é consenso e não é persistido: um nó que reinicie grava o próximo
    /// snapshot mais cedo, o que é inofensivo.
    pub ultimo_snapshot: u64,
    /// G8: writers async abandonam se a epoch mudou (reorg / invalidar).
    pub snapshot_epoch: std::sync::Arc<std::sync::atomic::AtomicU64>,
    /// Job de gravação em voo (testes chamam [`Blockchain::flush_snapshot`]).
    snapshot_job: Option<std::thread::JoinHandle<()>>,
    /// Janela recente de blocos em RAM. `tail[i]` é a altura `tail_start + i`.
    pub tail: Vec<Block>,
    /// Altura de `tail[0]`.
    pub tail_start: u64,
    /// Estado APÓS o bloco `tail_start - 1` — a âncora de qualquer reorganização.
    pub base_state: Option<State>,
    pub state: State,
    /// altura → hash.
    ///
    /// A referência usa um ARRAY indexado por altura. Aqui é um mapa: o array
    /// obriga a alocar uma entrada por bloco desde o gênese, e a única coisa que se
    /// perde é a truncagem por `length`, que vira um `retain`. As consultas
    /// (`hash_at`, o ancestral comum de `replace_chain`) são as mesmas.
    pub hashes: BTreeMap<u64, String>,
    /// hash → altura.
    pub hash_index: BTreeMap<String, u64>,
    /// id de transação → altura do bloco.
    pub tx_index: BTreeMap<String, u64>,
    /// endereço → alturas (ascendentes) de blocos com transação desse endereço.
    pub address_tx_index: BTreeMap<String, Vec<u64>>,
    /// Alturas (ascendentes) de blocos com ao menos uma transação.
    pub blocks_with_txs: Vec<u64>,
    /// Hash do gênese fixado. Ao entrar numa rede existente, o nó só adota uma
    /// gênese cujo hash bata com este valor — impede que um peer imponha a própria
    /// gênese a um nó que ainda não tem cadeia (trust-on-first-sync).
    pub expected_genesis_hash: Option<String>,
    /// Armazenamento em disco. `None` = cadeia só em memória (testes).
    ///
    /// É o que permite a RAM ser proporcional ao ESTADO e à janela recente, não à
    /// IDADE da cadeia — a distinção que motivou o `BlockStore` depois do incidente
    /// dos 2 GiB. Sem ele, `slide_tail` não pode expulsar bloco nenhum: expulsar da
    /// RAM sem ter no disco seria perdê-lo.
    pub store: Option<crate::blockstore::BlockStore>,
    /// Replay do próprio histórico. Ver o uso em [`Blockchain::add_block`].
    pub loading: bool,
    /// Chaves de produtores já vistas no fio (bloco enxuto — omitir pubs repetidas).
    /// Não é folha de consenso; reconstruída ao carregar blocos que ainda trazem pubs.
    pub producer_keys: BTreeMap<String, (String, String)>,
}

impl Blockchain {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn com_genese_fixada(hash: impl Into<String>) -> Self {
        Blockchain { expected_genesis_hash: Some(hash.into()), ..Default::default() }
    }

    pub fn head(&self) -> Option<&Block> {
        self.tail.last()
    }

    /// Altura da cabeça, ou `-1` para cadeia vazia — como a referência.
    pub fn height(&self) -> i64 {
        self.head().map_or(-1, |b| b.height as i64)
    }

    pub fn has_genesis(&self) -> bool {
        !self.tail.is_empty()
    }

    /// Hash na altura. G7: cache em RAM; fora da janela lê `hashes.bin`.
    pub fn hash_at(&self, height: u64) -> Option<String> {
        if let Some(s) = self.hashes.get(&height) {
            return Some(s.clone());
        }
        let h = usize::try_from(height).ok()?;
        self.store.as_ref()?.hash_at(h)
    }

    /// O slot a que um instante pertence.
    ///
    /// `div_euclid` e não `/`: a divisão do Rust trunca em direção a zero e a do
    /// `Math.floor` do JS arredonda para baixo. Elas só divergem em timestamp
    /// negativo — que `verify_block_integrity` já rejeita — mas usar a operação
    /// certa custa nada e remove a pergunta.
    pub fn slot_for(&self, timestamp: i64) -> i64 {
        timestamp.div_euclid(BLOCK_TIME_MS)
    }

    /// Recompensa do bloco na altura dada, com halving periódico.
    ///
    /// A base é lida do ESTADO sendo aplicado, não de um global: é o que faz o
    /// replay e o reorg serem determinísticos mesmo depois de uma mudança de
    /// parâmetro por governança.
    pub fn block_reward(&self, height: u64, state: &State) -> Result<Amount, ChainError> {
        let base = param_amount(state, "BLOCK_REWARD", BLOCK_REWARD)?;
        let halvings = height / HALVING_INTERVAL_BLOCKS;
        // A referência corta em 64 explicitamente; em Rust, deslocar 128 bits de um
        // `u128` é comportamento de pânico em debug. O corte é a mesma regra E a
        // proteção.
        if halvings >= 64 {
            return Ok(0);
        }
        Ok(base >> halvings)
    }

    /// DPoS: o produtor PRIMÁRIO do slot. É o rodízio determinístico, e é o
    /// consenso inteiro.
    ///
    /// `None` quando não há validador ativo — a rede não tem quem produza, e o
    /// chamador tem de tratar isso como "ninguém", não como "qualquer um".
    pub fn expected_producer(&self, timestamp: i64) -> Result<Option<String>, ChainError> {
        let vals = validators(&self.state)?;
        if vals.is_empty() {
            return Ok(None);
        }
        let slot = self.slot_for(timestamp);
        // `rem_euclid` mantém o índice não-negativo mesmo com slot negativo; o
        // `%` do Rust devolveria negativo e estouraria o índice.
        let i = (slot.rem_euclid(vals.len() as i64)) as usize;
        Ok(Some(vals[i].address.clone()))
    }

    /// Verifica o lote EM PARALELO e o aplica EM SEQUÊNCIA.
    ///
    /// A ordem importa e é a única possível: a assinatura de cada bloco só depende
    /// dele, mas o estado de cada um depende do anterior.
    /// O PREFIXO VÁLIDO é preservado: se o bloco `i` do lote falha, os anteriores
    /// já entraram e o truncamento do arquivo começa exatamente em `i`. Abortar o
    /// lote inteiro descartaria blocos bons e faria o nó re-sincronizar mais do
    /// que precisa — e, pior, o ponto de truncamento dependeria do tamanho do
    /// lote, que é detalhe de implementação e não pode influenciar o que fica
    /// gravado em disco.
    fn aplicar_lote(&mut self, lote: Vec<Block>, now: i64) -> Result<(), ChainError> {
        // `producer_keys` da cadeia (já aplicados) sementeia o lote: com
        // `COMPACT_BLOCK_HEIGHT` e LOTE=512, o 1.º bloco do lote seguinte omite
        // pubs e depende das chaves vistas nos lotes anteriores.
        let (verificados, erro) = Self::verificar_lote(lote, &self.producer_keys);
        for bloco in verificados {
            self.add_block_verificado(bloco, now)?;
        }
        match erro {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    // ---------------------------------------------- verificação em lote (boot)

    /// Verifica a INTEGRIDADE de um lote de blocos EM PARALELO.
    ///
    /// Verificar assinatura é embaraçosamente paralelo: cada bloco só depende de
    /// si mesmo. Aplicar ao estado NÃO é — cada bloco depende do anterior. Este
    /// método separa as duas coisas, que é o único ganho de paralelismo honesto
    /// que existe no replay.
    ///
    /// Medido nesta base: ~6× em 16 núcleos. O replay completo de um ano de cadeia
    /// cai de ~1,5 h para ~15 min.
    ///
    /// O resultado é um [`BlocoVerificado`] — e é ele que torna isto seguro: o
    /// caminho de aplicação que PULA a verificação só aceita esse tipo, e esse
    /// tipo só sai daqui. Não é convenção nem comentário; é o compilador impedindo
    /// que alguém aplique bloco não verificado por engano.
    /// Devolve o PREFIXO que passou e o primeiro erro, se houve — nunca só o erro:
    /// os blocos anteriores ao ruim são válidos e têm de entrar na cadeia.
    ///
    /// `chaves_conhecidas` é a semente de produtores já vistos (tipicamente
    /// `self.producer_keys`). Sem ela, lotes sucessivos com blocos compactos
    /// falhariam no primeiro bloco de cada lote.
    fn verificar_lote(
        mut blocos: Vec<Block>,
        chaves_conhecidas: &BTreeMap<String, (String, String)>,
    ) -> (Vec<BlocoVerificado>, Option<ChainError>) {
        let nucleos = std::thread::available_parallelism().map_or(1, |n| n.get());
        // Cada posição recebe o erro daquele bloco (ou `None`). Guardar POR POSIÇÃO,
        // e não "o primeiro que chegou", é o que torna o resultado determinístico:
        // as threads terminam em ordem imprevisível, e o ponto de truncamento do
        // arquivo não pode depender disso.
        let mut falhas: Vec<Option<String>> = vec![None; blocos.len()];

        // Blocos sem pubs no fio precisam das chaves acumuladas na ordem — paralelo
        // quebraria a resolução (plano 21 A2).
        let precisa_seq = blocos
            .iter()
            .any(|b| b.public_key.is_none() || b.pq_public_key.is_none());

        if precisa_seq || nucleos <= 1 || blocos.len() < 8 {
            let mut keys = chaves_conhecidas.clone();
            for (i, b) in blocos.iter().enumerate() {
                let known = keys.get(&b.producer).map(|(a, c)| (a.as_str(), c.as_str()));
                falhas[i] = verify_block_integrity_ex(b, known).err();
                if falhas[i].is_none() {
                    if let (Some(pk), Some(pq)) = (&b.public_key, &b.pq_public_key) {
                        keys.insert(b.producer.clone(), (pk.clone(), pq.clone()));
                    }
                }
            }
        } else {
            let por_thread = blocos.len().div_ceil(nucleos);
            std::thread::scope(|escopo| {
                for (fatia, destino) in
                    blocos.chunks(por_thread).zip(falhas.chunks_mut(por_thread))
                {
                    escopo.spawn(move || {
                        for (b, slot) in fatia.iter().zip(destino.iter_mut()) {
                            *slot = verify_block_integrity(b).err();
                        }
                    });
                }
            });
        }

        match falhas.iter().position(Option::is_some) {
            None => (blocos.into_iter().map(BlocoVerificado).collect(), None),
            Some(i) => {
                let erro = falhas[i].clone().unwrap_or_default();
                let altura = blocos[i].height;
                blocos.truncate(i);
                (
                    blocos.into_iter().map(BlocoVerificado).collect(),
                    Some(format!("bloco {altura}: {erro}")),
                )
            }
        }
    }

    // ------------------------------------------------------------------ gênese

    /// Adota um bloco gênese, zerando estado e índices. Espelha `adoptGenesis`.
    pub fn adopt_genesis(&mut self, block: Block) -> Result<(), ChainError> {
        verify_block_integrity(&block).map_err(|e| format!("gênese inválida: {e}"))?;
        if block.height != 0 {
            return Err("bloco gênese deve ter altura 0".into());
        }
        if let Some(fixado) = &self.expected_genesis_hash
            && &block.hash != fixado
        {
            return Err(format!("gênese não confere com o hash fixado ({fixado})"));
        }
        let alocacoes = block
            .genesis
            .clone()
            .ok_or_else(|| "alocações da gênese ausentes".to_string())?;
        let mut estado = State::new();
        apply_genesis(&mut estado, &alocacoes)?;

        self.tail = vec![block];
        self.tail_start = 0;
        self.base_state = None;
        self.state = estado;
        self.hashes = BTreeMap::new();
        self.hashes.insert(0, self.tail[0].hash.clone());
        self.hash_index = BTreeMap::new();
        self.hash_index.insert(self.tail[0].hash.clone(), 0);
        self.tx_index = BTreeMap::new();
        self.address_tx_index = BTreeMap::new();
        self.blocks_with_txs = Vec::new();
        self.producer_keys = BTreeMap::new();
        // O disco nasce (ou renasce) com a linha 0 = gênese — espelha
        // blockchain.js:144-148. É AQUI, e não no chamador, que o pressuposto
        // estrutural do `block_at` (linha N == altura N) é estabelecido: adotar
        // outra gênese com um arquivo antigo no lugar leria a cadeia errada.
        if !self.loading && let Some(store) = self.store.as_mut() {
            let linha = crate::block::block_to_json_line(&self.tail[0])
                .map_err(|e| format!("serializar gênese: {e}"))?;
            store.reset([linha.as_str()]).map_err(|e| format!("gravar gênese: {e}"))?;
        }
        Ok(())
    }

    // --------------------------------------------------------------- add_block

    /// Acrescenta um bloco à cabeça da cadeia, com TODAS as regras de consenso.
    ///
    /// `now` é o relógio local em ms — parâmetro e não `SystemTime` de propósito:
    /// as checagens sensíveis a tempo precisam ser testáveis, e um nó que leia o
    /// relógio lá dentro não tem como ser exercitado de forma determinística.
    pub fn add_block(&mut self, block: Block, now: i64) -> Result<(), ChainError> {
        self.add_block_interno(block, now, None)
    }

    /// Como [`Self::add_block`], mas SEM reverificar a integridade — que já foi
    /// provada por [`Self::verificar_lote`]. Todas as demais regras de consenso
    /// (altura, encadeamento, produtor do slot, raiz do estado) continuam valendo.
    fn add_block_verificado(&mut self, block: BlocoVerificado, now: i64) -> Result<(), ChainError> {
        self.add_block_interno_com(block.0, now, None, false)
    }

    fn add_block_interno(
        &mut self,
        block: Block,
        now: i64,
        // O `presim` carrega o estado E os recibos da simulação do produtor —
        // como o `presim: { sim, logs }` da referência (blockchain.js:385). Se
        // levasse só o estado, o produtor não gravaria recibo nenhum dos SEUS
        // blocos: este caminho não re-simula, e o índice ficaria com buraco
        // exatamente nos blocos que este nó produziu.
        presim: Option<(State, Vec<(String, crate::state::eavm_tx::EavmOutcome)>)>,
    ) -> Result<(), ChainError> {
        self.add_block_interno_com(block, now, presim, true)
    }

    fn add_block_interno_com(
        &mut self,
        block: Block,
        now: i64,
        presim: Option<(State, Vec<(String, crate::state::eavm_tx::EavmOutcome)>)>,
        verificar: bool,
    ) -> Result<(), ChainError> {
        if !self.has_genesis() {
            return Err("cadeia sem bloco gênese".into());
        }
        if verificar {
            let known = self
                .producer_keys
                .get(&block.producer)
                .map(|(a, b)| (a.as_str(), b.as_str()));
            verify_block_integrity_ex(&block, known)?;
        }

        let (cabeca_altura, cabeca_hash, cabeca_ts) = {
            let h = self.head().ok_or("cadeia sem bloco gênese")?;
            (h.height, h.hash.clone(), h.timestamp)
        };
        if block.height != cabeca_altura + 1 {
            return Err(format!(
                "altura inválida (esperada {}, recebida {})",
                cabeca_altura + 1,
                block.height
            ));
        }
        if block.previous_hash != cabeca_hash {
            return Err("previousHash não aponta para a cabeça da cadeia".into());
        }
        if block.timestamp <= cabeca_ts {
            return Err("timestamp do bloco não avança".into());
        }

        // UM BLOCO POR SLOT. Sem esta regra um validador produziria centenas de
        // blocos dentro do próprio slot (timestamps a 1 ms), inflando a emissão e
        // monopolizando a cadeia. É também a metade que, junto com a tolerância de
        // relógio abaixo, fecha o grinding de timestamp.
        let slot_cabeca = self.slot_for(cabeca_ts);
        let slot_bloco = self.slot_for(block.timestamp);
        if slot_bloco <= slot_cabeca {
            return Err("slot já ocupado: no máximo um bloco por slot".into());
        }
        if block.transactions.len() > MAX_TXS_PER_BLOCK {
            return Err("bloco excede o limite de transações".into());
        }

        // Checagens sensíveis a TEMPO e a VERSÃO DA REGRA. Puladas no replay do
        // próprio disco: aqueles blocos já foram validados quando aceitos, e
        // reaplicar a regra ATUAL a blocos antigos quebraria o replay depois de
        // qualquer ajuste do rodízio. Blocos novos continuam passando por tudo.
        if !self.loading {
            if slot_bloco > self.slot_for(now + SLOT_FUTURE_TOLERANCE_MS) {
                return Err("bloco pertence a um slot futuro".into());
            }
            if block.timestamp > now + MAX_CLOCK_DRIFT_MS {
                return Err("timestamp do bloco está no futuro".into());
            }
            let vals = validators(&self.state)?;
            if vals.is_empty() {
                return Err("nenhum validador ativo na rede".into());
            }
            // `witness`: quem assinou é a chave de produção, quem produz é a conta.
            // A ligação depende do ESTADO — por isso é conferida aqui, e não em
            // `verify_block_integrity`, que permanece pura.
            let efetivo = block_validator(&block).to_string();
            if let Some(conta) = &block.producer_account {
                let witness = self.state.permissions.get(conta).and_then(|p| p.witness());
                if witness != Some(block.producer.as_str()) {
                    return Err(
                        "assinante não é a chave witness registrada para a conta produtora".into()
                    );
                }
            }
            if block.height >= STRICT_PRODUCER_HEIGHT {
                // ESTRITO: só o produtor escalado do slot. Sem isto, um validador
                // bizantino produziria fora de turno e, aproveitando os buracos
                // deixados por validadores honestos offline, forjaria a cadeia mais
                // longa (achado C1).
                let esperado = self.expected_producer(block.timestamp)?;
                if esperado.as_deref() != Some(efetivo.as_str()) {
                    return Err(format!(
                        "produtor fora do slot (esperado {}, recebido {efetivo})",
                        esperado.as_deref().unwrap_or("undefined")
                    ));
                }
            } else if !vals.iter().any(|v| v.address == efetivo) {
                // Blocos ABAIXO do fork: grandfathered — basta ser validador ativo.
                return Err(format!("produtor não é um validador ativo ({})", block.producer));
            }
        }

        // Aplica a um estado CLONADO — a menos que `produce_block` já tenha aplicado
        // e passado o `presim` (evita clonar, aplicar e computar a raiz duas vezes).
        // `recibos` é COLETADO aqui e só gravado APÓS o commit: um bloco que a
        // validação abaixo recusar não pode deixar recibo de transação que nunca
        // entrou na cadeia.
        let mut recibos: Vec<(String, crate::state::eavm_tx::EavmOutcome)> = Vec::new();
        let (sim, veio_de_presim) = match presim {
            Some((s, r)) => {
                recibos = r;
                (s, true)
            }
            None => {
                let mut s = self.state.clone();
                self.simulate(&mut s, &block, &mut recibos)?;
                (s, false)
            }
        };

        // Acima do fork o header commita a raiz do estado APÓS o bloco. Recomputar e
        // exigir igualdade é a ÚNICA checagem que pega divergência de estado entre
        // nós — sem ela, dois clientes com saldos diferentes seguiriam a mesma cadeia
        // sem perceber. Roda inclusive no replay: é o que detecta corrupção em disco.
        if !veio_de_presim && block.height >= STATEROOT_HEIGHT {
            let calculada = compute_state_root(
                &sim.state_leaves().map_err(|e| format!("estado não codificável: {e}"))?,
            );
            let recebida = block.state_root.as_deref().unwrap_or("");
            if calculada != recebida {
                return Err(format!(
                    "stateRoot não confere (esperado {calculada}, recebido {recebida})"
                ));
            }
        }

        // DISCO ANTES DA MEMÓRIA (blockchain.js:248-251). Se o append falhar, o
        // bloco é rejeitado INTEIRO e nada em memória mudou — a referência
        // inverteu esta ordem depois de um incidente de produção em que o nó
        // avançava só em RAM sob pressão de disco e o `blocks.jsonl` ficava com
        // lacuna.
        //
        // A ordem anterior aqui commitava `state` e os índices primeiro: uma
        // falha de I/O devolvia `Err` deixando estado e índices À FRENTE de
        // `tail`/`head`. O `add_block` seguinte validaria contra um estado que já
        // inclui um bloco que a cadeia não tem — e o boot seguinte leria uma
        // cadeia mais curta que o estado em memória.
        //
        // `loading` marca o replay do próprio arquivo — reescrever ali duplicaria
        // cada bloco a cada boot.
        if !self.loading
            && let Some(store) = self.store.as_mut()
        {
            let linha = crate::block::block_to_json_line(&block).map_err(|e| {
                format!("bloco {} não serializável para o disco: {e}", block.height)
            })?;
            store.append(&linha).map_err(|e| {
                format!("bloco {} recusado: falha ao persistir ({e})", block.height)
            })?;
        }

        // --- daqui para baixo, só mutação: o disco já aceitou ---
        self.state = sim;
        self.hashes.insert(block.height, block.hash.clone());
        self.hash_index.insert(block.hash.clone(), block.height);
        for tx in &block.transactions {
            if let Some(id) = &tx.id {
                self.tx_index.insert(id.clone(), block.height);
            }
        }
        self.index_address_txs(&block);
        self.registrar_recibos(&block, recibos);
        if let (Some(pk), Some(pq)) = (&block.public_key, &block.pq_public_key) {
            self.producer_keys
                .insert(block.producer.clone(), (pk.clone(), pq.clone()));
        }
        self.tail.push(block);
        self.slide_tail();
        if let Some(caminho) = self.snapshot_path.clone() {
            self.talvez_snapshot(&caminho);
        }
        Ok(())
    }

    /// Grava recibos, eventos e transferências internas nos índices NODE-LOCAIS.
    ///
    /// Espelha blockchain.js:258-270. Nada aqui entra no `stateRoot` — são
    /// índices de CONSULTA, e é por isso que podem viver num anel de tamanho
    /// fixo: um nó que perca a janela não fica inválido, só perde histórico.
    ///
    /// Chamado DEPOIS do commit: um bloco rejeitado não pode deixar recibo de
    /// transação que nunca entrou na cadeia.
    fn registrar_recibos(
        &mut self,
        block: &Block,
        recibos: Vec<(String, crate::state::eavm_tx::EavmOutcome)>,
    ) {
        for (tx_id, r) in recibos {
            // O recibo carrega `contract` só no DEPLOY — é como toda ferramenta
            // descobre o endereço de um contrato recém-implantado.
            self.receipts.insert(
                tx_id.clone(),
                Recibo {
                    success: r.success,
                    gas_used: r.gas_used,
                    contract: r.is_deploy.then(|| r.contract_addr.clone()),
                    block_height: block.height,
                },
            );
            for log in &r.logs {
                self.log_index.push(EventoIndexado {
                    tx_id: tx_id.clone(),
                    block_height: block.height,
                    block_time: block.timestamp,
                    address: log.address.clone(),
                    topics: log.topics.clone(),
                    data: log.data.clone(),
                });
            }
            for x in &r.xfers {
                // Transferência interna NÃO é `LOG` do EVM: índice próprio, para
                // que `eth_getLogs` não a devolva como evento.
                self.internal_index.push(TransferenciaInterna {
                    tx_id: tx_id.clone(),
                    block_height: block.height,
                    block_time: block.timestamp,
                    kind: x.kind.clone(),
                    from: x.from.clone(),
                    to: x.to.clone(),
                    from_e7: x.from_e7.clone(),
                    to_e7: x.to_e7.clone(),
                    amount: x.amount,
                });
            }
        }
        // Anel: o mais antigo sai. `drain` mantém a ordem dos que ficam.
        aparar(&mut self.log_index);
        aparar(&mut self.internal_index);
    }

    /// Caminho ÚNICO de aplicação de um bloco a um estado clonado. Espelha
    /// `#simulate`.
    ///
    /// Ser o caminho único importa: `add_block` e `produce_block` PRECISAM computar
    /// exatamente o mesmo estado a partir do mesmo bloco, senão o produtor commita
    /// uma raiz que ele próprio não reproduz na validação.
    /// `recibos` COLETA os resultados de execução EAVM em vez de gravá-los: esta
    /// função tem `&self` (a cadeia ainda não aceitou o bloco), e quem grava é o
    /// `add_block`, DEPOIS do commit. É o mesmo desenho do `blockLogs` da
    /// referência (blockchain.js:280) — e o que impede um bloco rejeitado de
    /// deixar recibo de transação que nunca entrou.
    fn simulate(
        &self,
        sim: &mut State,
        block: &Block,
        recibos: &mut Vec<(String, crate::state::eavm_tx::EavmOutcome)>,
    ) -> Result<(), ChainError> {
        // A referência soma os RETORNOS de applyTransaction (blockchain.js:296),
        // que são SEMPRE 0n: a taxa é queimada no epílogo da máquina de estado
        // (state.js:2633-2635) e nunca vai ao produtor. `AppliedTx.fee` (a taxa
        // queimada, informativa) NÃO entra aqui — somá-la creditaria o produtor
        // com valor que já saiu do suprimento.
        let fees: Amount = 0;
        let mut vistas: BTreeSet<&str> = BTreeSet::new();

        // EIP-2935: o hash do PAI é gravado ANTES de qualquer transação — é o mais
        // recente que `BLOCKHASH` pode enxergar, já que o bloco atual, por
        // definição, ainda não tem hash. Fork-gated: abaixo da altura o anel nem
        // existe. Ver [`record_block_hash`] para o estado deste porte.
        // As DUAS condições são da referência e as duas ficam. `height > 0` parece
        // redundante hoje porque `EAVM_OSAKA_HEIGHT` é 1.9M — mas o gerador de
        // config emite a altura de fork da REDE, e numa rede de gênese-ativo (todos
        // os forks em 0) ela deixa de ser redundante e passa a ser o que impede o
        // gênese de tentar gravar o hash de um pai que não existe.
        #[allow(clippy::redundant_comparisons)]
        if block.height > 0 && block.height >= EAVM_OSAKA_HEIGHT {
            record_block_hash(sim, block.height - 1, &block.previous_hash);
        }

        let block_ts =
            u64::try_from(block.timestamp).map_err(|_| "timestamp inválido".to_string())?;
        for tx in &block.transactions {
            verify_transaction(tx).map_err(|e| {
                format!("transação {} inválida: {e}", tx.id.as_deref().unwrap_or("?"))
            })?;
            let id = tx.id.as_deref().unwrap_or("?");
            if vistas.contains(id) || self.tx_index.contains_key(id) {
                return Err(format!("transação duplicada: {id}"));
            }
            vistas.insert(id);
            let aplicada =
                sim.apply_transaction(tx, block.height, block_ts).map_err(|e| e.to_string())?;
            if let Some(outcome) = aplicada.eavm {
                recibos.push((id.to_string(), outcome));
            }
        }

        let recompensa = self.block_reward(block.height, sim)?;
        // A recompensa vai para a CONTA validadora, nunca para a chave `witness` —
        // ela não tem stake nem autoridade de gasto, e creditá-la perderia o valor.
        let total = recompensa.checked_add(fees).ok_or("estouro na recompensa do bloco")?;
        distribute_block_reward(sim, block_validator(block), total)?;
        sim.total_minted =
            sim.total_minted.checked_add(recompensa).ok_or("estouro no total emitido")?;
        block_tick(sim, block.height)?;
        Ok(())
    }

    /// Re-executa um bloco JÁ VALIDADO sobre um estado, sem clone e sem verificação.
    ///
    /// Usado para avançar a âncora quando a janela desliza e para reconstruir o
    /// estado no ponto de fork. Tem de seguir EXATAMENTE a mesma sequência de
    /// [`Blockchain::simulate`] — se as duas divergirem, um reorg produz um estado
    /// diferente do que a aplicação normal produziria para a mesma cadeia.
    fn apply_block_to(&self, state: &mut State, block: &Block) -> Result<(), ChainError> {
        // Mesma nota do `simulate`: o retorno da referência ao bloco é sempre 0n
        // (state.js:2635) — a taxa queimada de `AppliedTx.fee` não é do produtor.
        let fees: Amount = 0;
        // EIP-2935: o MESMO registro do `simulate`. Este caminho RE-APLICA blocos
        // já aceitos (âncora do slide, rebuild do ponto de fork no reorg) e tem de
        // chegar a estado IDÊNTICO ao da aplicação original — sem isto, acima de
        // EAVM_OSAKA_HEIGHT a raiz reconstruída perderia as entradas do anel.
        // Mesma classe do bug produtor/validador; a referência tinha o mesmo furo
        // em `#applyBlockTo` e foi corrigida junto (blockchain.js:309).
        #[allow(clippy::redundant_comparisons)]
        if block.height > 0 && block.height >= EAVM_OSAKA_HEIGHT {
            record_block_hash(state, block.height - 1, &block.previous_hash);
        }
        let block_ts =
            u64::try_from(block.timestamp).map_err(|_| "timestamp inválido".to_string())?;
        for tx in &block.transactions {
            state.apply_transaction(tx, block.height, block_ts).map_err(|e| e.to_string())?;
        }
        let recompensa = self.block_reward(block.height, state)?;
        let total = recompensa.checked_add(fees).ok_or("estouro na recompensa do bloco")?;
        distribute_block_reward(state, block_validator(block), total)?;
        state.total_minted =
            state.total_minted.checked_add(recompensa).ok_or("estouro no total emitido")?;
        block_tick(state, block.height)?;
        Ok(())
    }

    /// Desliza a janela em RAM, expulsando blocos antigos e avançando a âncora.
    ///
    /// Enquanto `tail.len() > REORG_WINDOW + 100`, tira o mais antigo, aplica-o em
    /// `base_state` e avança `tail_start` — o corpo de `#slideTail`.
    ///
    /// SEM disco a função não faz nada, como na referência
    /// (`if (!this.store) return`): expulsar um bloco da RAM sem tê-lo gravado o
    /// perderia. Uma cadeia sem store (testes, candidata de reorg) mantém tudo em
    /// memória de propósito.
    fn slide_tail(&mut self) {
        // Sem disco, expulsar um bloco da RAM o perderia — a referência faz a mesma
        // guarda (`if (!this.store) return`).
        if self.store.is_none() {
            return;
        }
        // A janela precisa cobrir a REORG_WINDOW: o ancestral comum de qualquer
        // reorganização legítima cai dentro dela. A folga de 100 evita ficar
        // deslizando a cada bloco no limite exato.
        let limite = (REORG_WINDOW + 100) as usize;
        while self.tail.len() > limite {
            if !self.evict_oldest() {
                return;
            }
        }
    }

    /// Expulsa o bloco MAIS VELHO da janela de RAM, avançando a âncora de estado.
    /// É o passo unitário de [`Self::slide_tail`], separado para que o teste do
    /// caminho de leitura em disco exercite ESTE código — não uma cópia dele.
    ///
    /// Âncora inconsistente: **derruba o processo** (debug e release).
    ///
    /// Degradar em silêncio (só `debug_assert!`) fazia `slide_tail` parar de
    /// deslizar, a RAM crescer sem limite e um reorg reconstruir estado errado.
    /// Servir raiz podre é pior que sair do ar — ver `docs/plano/06-decisoes-abertas.md`.
    fn ancora_corrompida(&self, motivo: &str) -> ! {
        eprintln!(
            "[cadeia] ÂNCORA DE ESTADO CORROMPIDA em tail_start={}: {motivo} — \
             abortando. Reinicie o nó para reconstruir do disco; não continue com \
             esta âncora.",
            self.tail_start,
        );
        panic!(
            "âncora de estado corrompida em tail_start={}: {motivo}",
            self.tail_start
        );
    }

    fn evict_oldest(&mut self) -> bool {
        let Some(saindo) = (!self.tail.is_empty()).then(|| self.tail.remove(0)) else {
            return false;
        };
        // O estado-âncora avança junto: `base_state` é sempre o estado APÓS o
        // bloco `tail_start - 1`. Deixar de aplicar aqui faria a reorganização
        // reconstruir a partir de um estado velho e chegar a outro resultado.
        // A âncora que ENTRA. `unwrap_or_default()` estava aqui e era um desastre
        // silencioso: na PRIMEIRA vez que a janela desliza, `tail_start` é 0 e a
        // âncora ainda é `None`, então ela nascia como estado VAZIO e o bloco 0
        // era aplicado em cima do nada.
        //
        // As alocações do gênese não são transações — vivem em `block.genesis` e
        // entram por `apply_genesis`. Aplicar o bloco 0 a um estado vazio perde a
        // distribuição inteira: todo saldo, todo stake, o tesouro. Daí em diante a
        // âncora está errada, e como ela só é lida num REORG, o erro dorme até o
        // dia em que a rede reorganiza — e aí o nó reconstrói um estado que nunca
        // existiu e sai da cadeia com raiz errada, em silêncio.
        //
        // O caminho de reorg já trata isto (`tail_start == 0` → `apply_genesis`,
        // SEM aplicar o bloco 0: o estado depois do gênese É a alocação). Aqui
        // seguimos o mesmo, senão os dois discordariam sobre o mesmo ponto.
        let base_entrada = match self.base_state.take() {
            Some(s) => Some(s),
            // Expulsando o PRÓPRIO gênese: a âncora que sai não é "vazio + bloco 0",
            // é a alocação. Tratado abaixo, sem passar por `apply_block_to`.
            None if self.tail_start == 0 => None,
            // Âncora ausente com a janela já deslocada é corrupção, não um estado
            // vazio. Recusar preserva a cadeia; inventar `default()` a destrói.
            None => {
                self.tail.insert(0, saindo);
                self.ancora_corrompida("âncora ausente com a janela já deslocada");
            }
        };

        let Some(mut base) = base_entrada else {
            let alocacoes = match saindo.genesis.clone() {
                Some(a) => a,
                None => {
                    self.tail.insert(0, saindo);
                    self.ancora_corrompida("bloco gênese sem alocações");
                }
            };
            let mut genese = State::new();
            if let Err(e) = apply_genesis(&mut genese, &alocacoes) {
                self.tail.insert(0, saindo);
                self.ancora_corrompida(&format!("alocações da gênese não aplicam: {e}"));
            }
            self.base_state = Some(genese);
            // G7: libera o hex da altura expulsa — hash_at_owned cai no hashes.bin.
            self.hashes.remove(&saindo.height);
            self.tail_start += 1;
            return true;
        };

        if let Err(e) = self.apply_block_to(&mut base, &saindo) {
            // Um bloco que já está na cadeia não pode falhar ao ser reaplicado.
            // Se falhar, o estado em memória está corrompido — parar é melhor que
            // seguir com uma âncora errada, que produziria raiz errada em silêncio.
            //
            // A mensagem IDENTIFICA o bloco e o que ele carregava. Sem isso o
            // operador recebe "o estado está corrompido" e nenhum ponto de
            // partida — foi exatamente o que aconteceu na primeira vez que isto
            // disparou, e a altura teve de ser deduzida do relógio do log.
            let tipos: Vec<&str> =
                saindo.transactions.iter().map(|t| t.tx_type.as_str()).collect();
            let onde = format!(
                "bloco {} ({} tx: {}) hash {}",
                saindo.height,
                saindo.transactions.len(),
                if tipos.is_empty() { "—".to_string() } else { tipos.join(",") },
                saindo.hash,
            );
            self.base_state = Some(base);
            self.tail.insert(0, saindo);
            self.ancora_corrompida(&format!("{onde} não reaplica: {e}"));
        }
        self.base_state = Some(base);
        // G7: libera o hex da altura expulsa — hash_at_owned cai no hashes.bin.
        self.hashes.remove(&saindo.height);
        self.tail_start += 1;
        true
    }

    /// Índice de transações por endereço: para cada endereço tocado (`from`/`to`),
    /// registra a altura do bloco. É o que permite listar todas as transações de uma
    /// carteira sem varrer a cadeia.
    fn index_address_txs(&mut self, block: &Block) {
        if !block.transactions.is_empty() {
            self.blocks_with_txs.push(block.height);
        }
        for tx in &block.transactions {
            for endereco in [Some(&tx.from), tx.to.as_ref()].into_iter().flatten() {
                let alturas = self.address_tx_index.entry(endereco.clone()).or_default();
                // Uma entrada por BLOCO, não por transação: duas transações do mesmo
                // endereço no mesmo bloco não podem duplicar a altura, senão a poda
                // do reorg (que remove por valor) deixaria sobra.
                if alturas.last() != Some(&block.height) {
                    alturas.push(block.height);
                }
            }
        }
    }

    // ----------------------------------------------------------- produce_block

    /// Produz, assina e acrescenta um bloco. Espelha `produceBlock`.
    ///
    /// Aplica o bloco UMA vez: o `sim` que produziu a raiz do header é o mesmo que o
    /// `add_block` commita, em vez de clonar, aplicar e computar a raiz duas vezes.
    pub fn produce_block(
        &mut self,
        signer: &dyn BlockSigner,
        transactions: Vec<Tx>,
        timestamp: i64,
        producer_account: Option<String>,
        now: i64,
    ) -> Result<Block, ChainError> {
        if !self.has_genesis() {
            return Err("cadeia sem bloco gênese".into());
        }
        let produtor =
            crate::signature::address_from_public_keys(signer.public_key_pem(), signer.pq_public_key_pem())
                .map_err(|e| format!("chave pública do produtor inválida: {e}"))?;
        // Com `witness`, quem detém o slot é a CONTA; a carteira apenas assina por ela.
        let efetivo = producer_account.clone().unwrap_or_else(|| produtor.clone());
        let esperado = self.expected_producer(timestamp)?;
        if esperado.as_deref() != Some(efetivo.as_str()) {
            return Err(format!(
                "slot pertence a {}, não a {efetivo}",
                esperado.as_deref().unwrap_or("ninguém")
            ));
        }
        let (altura, hash_anterior) = {
            let h = self.head().ok_or("cadeia sem bloco gênese")?;
            (h.height + 1, h.hash.clone())
        };

        // O bloco-esboço serve só para alimentar `simulate`: ele precisa de altura,
        // timestamp, produtor efetivo, transações e o hash do PAI. O hash e as
        // assinaturas ainda não existem, por definição.
        //
        // NOTA SOBRE A REFERÊNCIA: `produceBlock` monta esse esboço SEM
        // `previousHash`, e com isso o `recordBlockHash` do EIP-2935 vira no-op só
        // no caminho de produção — o validador, que passa o bloco completo, grava o
        // anel. Acima de `EAVM_OSAKA_HEIGHT` isso daria duas raízes diferentes para
        // o mesmo bloco, e o produtor commitaria uma raiz que a rede rejeita. Aqui o
        // esboço LEVA o `previousHash`, que é o comportamento coerente; a divergência
        // é inerte enquanto `record_block_hash` for no-op, mas está registrada porque
        // é um bug da referência, não uma escolha deste porte.
        let esboco = Block {
            protocol: crate::transaction::PROTOCOL.to_string(),
            version: crate::block::PROTOCOL_VERSION,
            scheme: crate::signature::SIGNATURE_SCHEME.to_string(),
            height: altura,
            timestamp,
            previous_hash: hash_anterior.clone(),
            tx_root: crate::block::block_tx_root(&transactions),
            tx_count: transactions.len(),
            producer: produtor,
            public_key: Some(signer.public_key_pem().to_string()),
            pq_public_key: Some(signer.pq_public_key_pem().to_string()),
            state_root: None,
            producer_account: producer_account.clone(),
            genesis: None,
            signature: String::new(),
            pq_signature: String::new(),
            hash: String::new(),
            transactions: transactions.clone(),
        };
        let mut sim = self.state.clone();
        // Os recibos desta simulação viajam junto com o `sim` até o `add_block`:
        // aquele caminho não re-simula quando recebe `presim`, então descartá-los
        // aqui deixaria os blocos PRODUZIDOS por este nó sem recibo nenhum.
        let mut recibos = Vec::new();
        self.simulate(&mut sim, &esboco, &mut recibos)?;
        let state_root = if altura >= STATEROOT_HEIGHT {
            Some(compute_state_root(
                &sim.state_leaves().map_err(|e| format!("estado não codificável: {e}"))?,
            ))
        } else {
            None
        };

        let omit_public_keys = altura >= crate::config::COMPACT_BLOCK_HEIGHT
            && self.producer_keys.contains_key(
                esboco.producer.as_str(),
            );
        let bloco = build_block(
            signer,
            BuildParams {
                height: altura,
                previous_hash: hash_anterior,
                timestamp,
                transactions,
                state_root,
                producer_account,
                omit_public_keys,
            },
        )?;
        // Valida o próprio bloco contra o relógio real e commita o `sim` já pronto.
        self.add_block_interno(bloco.clone(), now, Some((sim, recibos)))?;
        Ok(bloco)
    }

    // ------------------------------------------------------------------- boot

    /// Reconstrói a cadeia do disco — o REPLAY COMPLETO da referência
    /// (`#fullReplay`, blockchain.js:672). O snapshot de boot rápido é uma
    /// otimização posterior; este é o caminho-fonte-de-verdade que ele sempre
    /// pode cair de volta.
    ///
    /// Semântica de recuperação:
    /// • linha 0 → `adopt_genesis`; demais → `add_block` (a contiguidade de altura
    ///   que o `add_block` exige é o que garante linha N == altura N);
    /// • bloco INVÁLIDO no fim → o prefixo válido fica; o rabo só é TRUNCADO se
    ///   couber em [`LoadFromDiskOpts::max_auto_discard`] (default **1**, tipicamente
    ///   crash no último append). Descartar milhares de blocos **aborta o boot** e
    ///   **não** altera o arquivo — evita o incidente em que todos os nós
    ///   truncavam a tip e a rede ficava sem fonte de verdade;
    /// • JSON ilegível no MEIO do arquivo → fatal (`LinhaCorrompida`) — corrupção
    ///   real não se mascara;
    /// • última linha rasgada (crash no append) → truncada pela varredura.
    ///
    /// Devolve quantos blocos foram descartados do fim (0 = arquivo íntegro).
    pub fn load_from_disk(
        &mut self,
        store: crate::blockstore::BlockStore,
        now: i64,
    ) -> Result<u64, ChainError> {
        self.load_from_disk_with(store, now, LoadFromDiskOpts::default())
    }

    /// Como [`Self::load_from_disk`], com política explícita de descarte.
    pub fn load_from_disk_with(
        &mut self,
        mut store: crate::blockstore::BlockStore,
        now: i64,
        opts: LoadFromDiskOpts,
    ) -> Result<u64, ChainError> {
        self.loading = true;
        let mut ruim: Option<String> = None;
        // Blocos acumulam num LOTE, e o lote é verificado em paralelo antes de ser
        // aplicado em sequência. Verificar assinatura é o que domina o replay
        // (~168 µs contra ~17 µs de leitura) e é a única parte paralelizável: a
        // aplicação ao estado é encadeada por definição.
        //
        // O tamanho é um meio-termo: grande o bastante para as threads pagarem o
        // próprio custo, pequeno o bastante para o lote caber na memória sem
        // pesar (~512 × 6 KB ≈ 3 MB).
        const LOTE: usize = 512;
        let mut lote: Vec<Block> = Vec::with_capacity(LOTE);

        let scan = store.scan_json(0, |altura, v| {
            if ruim.is_some() {
                // Depois do primeiro bloco ruim nada mais aplica, mas a linha ainda
                // é INDEXADA (true) — o truncamento abaixo remove tudo de uma vez,
                // como o `#discardInvalidTail` da referência.
                return true;
            }
            let bloco = match crate::block::block_from_json(&v) {
                Ok(b) => b,
                Err(e) => {
                    ruim = Some(e.to_string());
                    return true;
                }
            };
            // O gênese vai sozinho: `adopt_genesis` zera estado e índices, e não
            // faz sentido dentro de um lote.
            if altura == 0 {
                if let Err(e) = self.adopt_genesis(bloco) {
                    ruim = Some(e);
                }
                return true;
            }
            lote.push(bloco);
            if lote.len() >= LOTE
                && let Err(e) = self.aplicar_lote(std::mem::take(&mut lote), now)
            {
                ruim = Some(e);
            }
            true
        });
        // O resto do lote, que não fechou o tamanho.
        if ruim.is_none()
            && !lote.is_empty()
            && let Err(e) = self.aplicar_lote(lote, now)
        {
            ruim = Some(e);
        }
        self.loading = false;
        let relatorio = scan.map_err(|e| format!("blocks.jsonl ilegível: {e}"))?;

        let mut descartados = 0u64;
        if let Some(e) = ruim {
            // O prefixo válido termina na altura atual; tudo além seria descartado.
            let manter = usize::try_from(self.height() + 1).unwrap_or(0);
            descartados = relatorio.count.saturating_sub(manter) as u64;
            if descartados > opts.max_auto_discard {
                // NÃO truncar: o arquivo permanece intacto para forense / restore.
                return Err(format!(
                    "boot abortado: replay falhou na altura {} ({e}); \
                     {descartados} bloco(s) seguintes NÃO foram descartados \
                     (limite auto-discard={}). \
                     O blocks.jsonl permanece intacto. \
                     Com backup e peers que tenham a tip, use \
                     EAV7_FORCE_DISCARD_INVALID_TAIL=1. \
                     Sem isso, restaure de backup — não suba o nó a truncar a cadeia.",
                    self.height(),
                    opts.max_auto_discard
                ));
            }
            if descartados > 0 {
                let bak = store
                    .backup_before_truncate("pre-discard")
                    .map_err(|err| format!("falha ao backup antes do discard ({e}): {err}"))?;
                eprintln!(
                    "[cadeia] backup pré-discard: {} ({descartados} bloco(s); causa: {e})",
                    bak.display()
                );
            }
            store
                .truncate_from(manter)
                .map_err(|err| format!("falha ao truncar rabo inválido ({e}): {err}"))?;
        }
        // G7: garante sidecars após boot (cadeia antiga sem .idx/.bin).
        if self.height() >= 0 {
            let n = (self.height() + 1) as u64;
            let hashes: Vec<Option<&str>> = (0..n)
                .map(|h| self.hashes.get(&h).map(|s| s.as_str()))
                .collect();
            if let Err(e) = store.persist_sidecars(&hashes) {
                eprintln!("[cadeia] sidecars não gravados após boot: {e}");
            }
        }
        self.store = Some(store);
        Ok(descartados)
    }


    /// BOOT RÁPIDO: o estado vem do snapshot, PROVADO contra a raiz do header, e
    /// a cadeia é apenas RELIDA para reconstruir os índices.
    ///
    /// A diferença para [`Self::load_from_disk`] é o que NÃO acontece: nenhuma
    /// assinatura é verificada e nenhuma transação é reaplicada. Medido nesta base,
    /// ler e parsear um bloco custa ~17 µs contra ~168 µs para validá-lo — 10× — e
    /// é essa razão que transforma 1,5 hora de boot num ano de cadeia em ~9
    /// minutos.
    ///
    /// # O que é confiado, e o que não é
    ///
    /// Do arquivo, SÓ o estado — e mesmo ele só depois de recomputar a raiz e
    /// bater com o `stateRoot` que o bloco commita. Os índices (`tx_index`,
    /// `address_tx_index`, `blocks_with_txs`, `hashes`) são RECONSTRUÍDOS da
    /// cadeia, nunca lidos do arquivo: `tx_index` é consultado na validação
    /// (rejeição de transação duplicada), e um índice adulterado com uma entrada a
    /// menos faria o nó aceitar um pagamento repetido.
    ///
    /// # Falha é sempre para o lado seguro
    ///
    /// Qualquer problema — arquivo ausente, truncado, versão desconhecida, raiz
    /// divergente, altura fora da cadeia — devolve `Ok(None)` e o chamador cai no
    /// [`Self::load_from_disk`], que é o caminho-fonte-de-verdade. Um snapshot é
    /// otimização: quando não dá para provar, não se usa.
    ///
    /// Devolve `Some(altura)` quando o boot rápido valeu.
    pub fn load_from_snapshot(
        &mut self,
        store: &mut crate::blockstore::BlockStore,
        caminho: &std::path::Path,
    ) -> Result<Option<u64>, ChainError> {
        let snap = match crate::snapshot::Snapshot::ler(caminho) {
            Ok(s) => s,
            Err(e) => {
                // Ausência não é notícia; o resto é.
                if !matches!(&e, crate::snapshot::Erro::Io(io) if io.kind() == std::io::ErrorKind::NotFound)
                {
                    eprintln!("[cadeia] snapshot descartado ({e}) — replay completo");
                }
                return Ok(None);
            }
        };

        // A RELEITURA da cadeia: reconstrói offsets (no store), a janela em RAM e
        // os índices. Nada aqui valida — a validação já aconteceu quando estes
        // blocos foram aceitos, e é a raiz do snapshot que prova o estado.
        let janela = (REORG_WINDOW + 100) as usize;
        let mut tail: std::collections::VecDeque<Block> = std::collections::VecDeque::new();
        let mut hashes: BTreeMap<u64, String> = BTreeMap::new();
        let mut hash_index: BTreeMap<String, u64> = BTreeMap::new();
        let mut tx_index: BTreeMap<String, u64> = BTreeMap::new();
        let mut address_tx_index: BTreeMap<String, Vec<u64>> = BTreeMap::new();
        let mut blocks_with_txs: Vec<u64> = Vec::new();
        // altura → LINHA do arquivo. O store fala em linha; o consenso, em altura.
        // As duas coincidem enquanto o arquivo for um prefixo contíguo, mas anotar
        // o mapa aqui dispensa depender disso para localizar um bloco.
        let mut linha_por_altura: BTreeMap<u64, usize> = BTreeMap::new();
        // Blocos compactos (COMPACT_BLOCK_HEIGHT=0) omitem pubs; o sync P2P
        // precisa das chaves já vistas. O replay via add_block as enche — o
        // boot por snap tem de as recolher NA MESMA varredura, senão o nó fica
        // mudo à frente de peers (add_block rejeita, sync engole o erro).
        let mut producer_keys: BTreeMap<String, (String, String)> = BTreeMap::new();
        let mut ilegivel: Option<String> = None;

        let scan = store.scan_json(0, |altura, v| {
            let bloco = match crate::block::block_from_json(&v) {
                Ok(b) => b,
                Err(e) => {
                    ilegivel = Some(format!("bloco {altura} ilegível: {e}"));
                    return false;
                }
            };
            if let (Some(pk), Some(pq)) = (&bloco.public_key, &bloco.pq_public_key) {
                if !pk.is_empty() && !pq.is_empty() {
                    producer_keys.insert(bloco.producer.clone(), (pk.clone(), pq.clone()));
                }
            }
            hashes.insert(bloco.height, bloco.hash.clone());
            hash_index.insert(bloco.hash.clone(), bloco.height);
            linha_por_altura.insert(bloco.height, altura);
            if !bloco.transactions.is_empty() {
                blocks_with_txs.push(bloco.height);
            }
            for tx in &bloco.transactions {
                if let Some(id) = tx.id.as_deref() {
                    tx_index.insert(id.to_string(), bloco.height);
                }
                for endereco in [Some(&tx.from), tx.to.as_ref()].into_iter().flatten() {
                    let alturas = address_tx_index.entry(endereco.clone()).or_default();
                    if alturas.last() != Some(&bloco.height) {
                        alturas.push(bloco.height);
                    }
                }
            }
            // Janela deslizante: só os últimos blocos ficam em RAM.
            tail.push_back(bloco);
            if tail.len() > janela {
                tail.pop_front();
            }
            true
        });
        let relatorio = scan.map_err(|e| format!("blocks.jsonl ilegível: {e}"))?;
        if let Some(e) = ilegivel {
            eprintln!("[cadeia] {e} — replay completo");
            return Ok(None);
        }

        if relatorio.count == 0 {
            return Ok(None);
        }
        let Some(cabeca) = tail.back().cloned() else {
            return Ok(None);
        };

        // O snapshot fica NATURALMENTE ATRÁS da ponta: ele é gravado a cada
        // `SNAPSHOT_INTERVAL_BLOCKS` e a cadeia continua andando. Exigir que
        // descrevesse a ponta o tornaria inútil na prática — só serviria se o nó
        // parasse exatamente num múltiplo do intervalo. (Foi o que aconteceu: a
        // primeira versão deste caminho exigia a ponta e era recusada em todo boot
        // real.)
        //
        // Então o rabo é REAPLICADO: os blocos depois do snapshot já foram
        // validados quando entraram na cadeia, e reaplicá-los é o mesmo trabalho
        // que o `slide_tail` e o reorg já fazem. São no máximo um intervalo de
        // blocos — 5.000 a ~168 µs, menos de um segundo.
        if snap.altura > cabeca.height {
            eprintln!(
                "[cadeia] snapshot na altura {} à FRENTE da cadeia ({}) — replay completo",
                snap.altura, cabeca.height
            );
            return Ok(None);
        }
        // A janela em RAM só guarda ~REORG_WINDOW blocos. O snap pode estar atrás
        // disso (ex.: tip 93k, snap 86k, janela começa em ~88k). Antes isto caía
        // em replay completo desde o génese. Agora lemos o bloco do snap (e o
        // delta) do disco — O(tip−snap), não O(tip).
        let inicio_janela = cabeca.height + 1 - tail.len() as u64;
        let bloco_do_snapshot = if snap.altura >= inicio_janela {
            match tail.get((snap.altura - inicio_janela) as usize).cloned() {
                Some(b) => b,
                None => return Ok(None),
            }
        } else {
            let Some(linha) = linha_por_altura.get(&snap.altura).copied() else {
                eprintln!(
                    "[cadeia] snapshot na altura {} sem bloco no store — replay completo",
                    snap.altura
                );
                return Ok(None);
            };
            let Some(jv) = store
                .get_json(linha)
                .map_err(|e| format!("ler bloco do snapshot: {e}"))?
            else {
                eprintln!(
                    "[cadeia] snapshot na altura {} ausente no store — replay completo",
                    snap.altura
                );
                return Ok(None);
            };
            match crate::block::block_from_json(&jv) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!(
                        "[cadeia] bloco do snapshot ilegível ({e}) — replay completo"
                    );
                    return Ok(None);
                }
            }
        };
        if bloco_do_snapshot.hash != snap.head_hash {
            // Checagem BARATA antes da cara: hash diferente = outra cadeia, e nem
            // vale recomputar a raiz.
            eprintln!("[cadeia] snapshot é de outra cadeia (hash difere na altura {}) — replay completo", snap.altura);
            return Ok(None);
        }

        // A PROVA: o estado do arquivo tem de reproduzir a raiz que o bloco daquela
        // altura commita.
        let mut estado = match crate::snapshot::Snapshot::estado_verificado(
            &snap.estado,
            snap.altura,
            bloco_do_snapshot.state_root.as_deref(),
        ) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[cadeia] {e} — replay completo");
                return Ok(None);
            }
        };

        // REAPLICA o rabo: do bloco seguinte ao do snapshot até a ponta. Blocos já
        // validados, mesmo caminho determinístico do reorg — não há assinatura a
        // reverificar aqui, só estado a avançar. Fora da janela RAM = ler do disco.
        if snap.altura < inicio_janela {
            eprintln!(
                "[cadeia] snapshot na altura {} atrás da janela ({inicio_janela}) — reaplicando delta do disco",
                snap.altura
            );
        }
        for h in (snap.altura + 1)..=cabeca.height {
            let bloco = if h >= inicio_janela {
                match tail.get((h - inicio_janela) as usize) {
                    Some(b) => b.clone(),
                    None => {
                        eprintln!(
                            "[cadeia] falta bloco {h} na janela ao reaplicar rabo — replay completo"
                        );
                        return Ok(None);
                    }
                }
            } else {
                let Some(linha) = linha_por_altura.get(&h).copied() else {
                    eprintln!(
                        "[cadeia] falta bloco {h} no store ao reaplicar rabo — replay completo"
                    );
                    return Ok(None);
                };
                let Some(jv) = store
                    .get_json(linha)
                    .map_err(|e| format!("ler bloco {h}: {e}"))?
                else {
                    eprintln!("[cadeia] bloco {h} ausente no store — replay completo");
                    return Ok(None);
                };
                match crate::block::block_from_json(&jv) {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("[cadeia] bloco {h} ilegível ({e}) — replay completo");
                        return Ok(None);
                    }
                }
            };
            if let Err(e) = self.apply_block_to(&mut estado, &bloco) {
                eprintln!(
                    "[cadeia] rabo do snapshot não reaplica no bloco {} ({e}) — replay completo",
                    bloco.height
                );
                return Ok(None);
            }
        }
        // E a raiz final tem de bater com a da CABEÇA. Sem esta segunda conferência,
        // um erro na reaplicação entraria sem prova — o snapshot estaria provado, o
        // rabo não.
        if let Some(raiz_cabeca) = cabeca.state_root.as_deref() {
            let obtida = crate::stateroot::compute_state_root(
                &estado.state_leaves().map_err(|e| format!("estado não codificável: {e}"))?,
            );
            if obtida != raiz_cabeca {
                eprintln!("[cadeia] raiz após reaplicar o rabo não confere com a cabeça — replay completo");
                return Ok(None);
            }
        }

        // A âncora de reorganização segue a mesma regra: provada contra o header do
        // bloco `tail_start - 1`. Sem ela não há reorg possível dentro da janela, e
        // aceitar uma âncora não provada seria aceitar um estado sem prova por uma
        // porta lateral.
        //
        // A altura usada é a REAL — derivada do que foi relido do disco —, não a que
        // o arquivo declara. O `tailStart` do snapshot é entrada não confiável como
        // qualquer outro campo dele: provar a âncora contra a altura que o próprio
        // arquivo escolheu deixaria um atacante escolher contra qual header ser
        // conferido.
        // A ÂNCORA de reorganização: o estado após o bloco `tail_start - 1`.
        //
        // Vem do arquivo e é provada contra o header DAQUELE bloco — localizado por
        // ALTURA, não pela posição que o arquivo declara. Deixar o snapshot escolher
        // a linha contra a qual é conferido daria ao atacante a escolha do juiz.
        //
        // Sem âncora não há reorganização possível dentro da janela, e o
        // `slide_tail` não tem de onde partir: por isso, âncora que não prova
        // derruba o boot rápido inteiro em vez de virar `None`.
        //
        // Caso comum (lab): o snap foi gravado na altura H com tail_start=H−janela;
        // no boot a ponta já é B>H e a janela em RAM começa depois do tail_start
        // antigo. Antes isto forçava replay completo (~minutos). Agora avançamos a
        // âncora até `inicio_janela` reaplicando do disco os blocos entretanto
        // deslizados — O(intervalo), tipicamente <1 s.
        let mut tail_start = snap.tail_start;
        if tail_start > snap.altura {
            eprintln!(
                "[cadeia] janela do snapshot ({tail_start}) inválida (acima da altura do snap) — replay completo"
            );
            return Ok(None);
        }

        let primeira_no_arquivo = linha_por_altura.keys().next().copied();

        let base_state = if tail_start < inicio_janela {
            // Âncora velha: avançar até ao início da janela relida.
            if inicio_janela == 0 {
                None
            } else if snap.base_estado.is_none() {
                // Snap sem baseEstado (Null): NÃO bootar sem âncora — `slide_tail`
                // panica em "âncora ausente". Reconstruímos a âncora a partir do
                // estado do snap (provado acima).
                let mut base = match crate::snapshot::Snapshot::estado_verificado(
                    &snap.estado,
                    snap.altura,
                    bloco_do_snapshot.state_root.as_deref(),
                ) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("[cadeia] estado do snap inválido ao reconstruir âncora ({e}) — replay completo");
                        return Ok(None);
                    }
                };
                if snap.altura >= cabeca.height {
                    eprintln!(
                        "[cadeia] snapshot na ponta sem baseEstado — replay completo"
                    );
                    return Ok(None);
                }
                if snap.altura < inicio_janela {
                    for h in (snap.altura + 1)..inicio_janela {
                        let Some(linha) = linha_por_altura.get(&h).copied() else {
                            eprintln!(
                                "[cadeia] falta bloco {h} ao reconstruir âncora — replay completo"
                            );
                            return Ok(None);
                        };
                        let Some(jv) = store
                            .get_json(linha)
                            .map_err(|e| format!("ler bloco {h}: {e}"))?
                        else {
                            eprintln!("[cadeia] bloco {h} ausente no store — replay completo");
                            return Ok(None);
                        };
                        let bloco = match crate::block::block_from_json(&jv) {
                            Ok(b) => b,
                            Err(e) => {
                                eprintln!(
                                    "[cadeia] bloco {h} ilegível ({e}) — replay completo"
                                );
                                return Ok(None);
                            }
                        };
                        if let Err(e) = self.apply_block_to(&mut base, &bloco) {
                            eprintln!(
                                "[cadeia] falha ao reconstruir âncora no bloco {h} ({e}) — replay completo"
                            );
                            return Ok(None);
                        }
                    }
                    let anterior = linha_por_altura
                        .get(&(inicio_janela - 1))
                        .and_then(|linha| store.get_json(*linha).ok().flatten())
                        .and_then(|jv| crate::block::block_from_json(&jv).ok());
                    if let Some(raiz) = anterior.as_ref().and_then(|b| b.state_root.as_deref()) {
                        let obtida = crate::stateroot::compute_state_root(
                            &base
                                .state_leaves()
                                .map_err(|e| format!("estado não codificável: {e}"))?,
                        );
                        if obtida != raiz {
                            eprintln!(
                                "[cadeia] âncora reconstruída não confere na altura {} — replay completo",
                                inicio_janela - 1
                            );
                            return Ok(None);
                        }
                    }
                    eprintln!(
                        "[cadeia] snapshot: âncora reconstruída do estado do snap → {inicio_janela} (boot rápido)"
                    );
                    tail_start = inicio_janela;
                } else {
                    // Snap dentro da janela RAM: âncora = estado do snap; janela de
                    // reorg encurtada até a cadeia crescer (melhor que panic).
                    eprintln!(
                        "[cadeia] snapshot sem baseEstado — âncora @{} (reorg até a cadeia andar)",
                        snap.altura
                    );
                    tail_start = snap.altura + 1;
                }
                Some(base)
            } else {
                let mut base = match snap.base_estado.as_ref() {
                    Some(_v) if tail_start == 0 => {
                        eprintln!("[cadeia] snapshot inconsistente (base com tail_start=0) — replay completo");
                        return Ok(None);
                    }
                    Some(v) => {
                        let anterior = linha_por_altura
                            .get(&(tail_start - 1))
                            .and_then(|linha| store.get_json(*linha).ok().flatten())
                            .and_then(|jv| crate::block::block_from_json(&jv).ok());
                        let raiz_anterior = anterior.as_ref().and_then(|b| b.state_root.clone());
                        match crate::snapshot::Snapshot::estado_verificado(
                            v,
                            tail_start - 1,
                            raiz_anterior.as_deref(),
                        ) {
                            Ok(s) => s,
                            Err(e) => {
                                eprintln!(
                                    "[cadeia] âncora do snapshot não confere ({e}) — replay completo"
                                );
                                return Ok(None);
                            }
                        }
                    }
                    None => unreachable!(),
                };
                for h in tail_start..inicio_janela {
                    let Some(linha) = linha_por_altura.get(&h).copied() else {
                        eprintln!(
                            "[cadeia] falta bloco {h} ao avançar âncora do snapshot — replay completo"
                        );
                        return Ok(None);
                    };
                    let Some(jv) = store.get_json(linha).map_err(|e| format!("ler bloco {h}: {e}"))? else {
                        eprintln!("[cadeia] bloco {h} ausente no store — replay completo");
                        return Ok(None);
                    };
                    let bloco = match crate::block::block_from_json(&jv) {
                        Ok(b) => b,
                        Err(e) => {
                            eprintln!("[cadeia] bloco {h} ilegível ({e}) — replay completo");
                            return Ok(None);
                        }
                    };
                    if let Err(e) = self.apply_block_to(&mut base, &bloco) {
                        eprintln!(
                            "[cadeia] falha ao avançar âncora no bloco {h} ({e}) — replay completo"
                        );
                        return Ok(None);
                    }
                }
                let anterior = linha_por_altura
                    .get(&(inicio_janela - 1))
                    .and_then(|linha| store.get_json(*linha).ok().flatten())
                    .and_then(|jv| crate::block::block_from_json(&jv).ok());
                if let Some(raiz) = anterior.as_ref().and_then(|b| b.state_root.as_deref()) {
                    let obtida = crate::stateroot::compute_state_root(
                        &base
                            .state_leaves()
                            .map_err(|e| format!("estado não codificável: {e}"))?,
                    );
                    if obtida != raiz {
                        eprintln!(
                            "[cadeia] âncora avançada não confere na altura {} — replay completo",
                            inicio_janela - 1
                        );
                        return Ok(None);
                    }
                }
                eprintln!(
                    "[cadeia] snapshot: âncora avançada {} → {} (boot rápido)",
                    snap.tail_start, inicio_janela
                );
                tail_start = inicio_janela;
                Some(base)
            }
        } else {
            // "Existe bloco antes da janela?" é pergunta sobre o ARQUIVO, não sobre a
            // altura zero: uma cadeia cujo arquivo comece acima do gênese (nó que
            // sincronizou de um ponto, fixture de teste) tem `tail_start > 0` e mesmo
            // assim não tem nada atrás. Perguntar `tail_start == 0` recusaria o boot
            // rápido nesses casos por um motivo que não existe.
            let ha_bloco_antes = primeira_no_arquivo.is_some_and(|p| tail_start > p);
            match (ha_bloco_antes, snap.base_estado.as_ref()) {
                (false, _) => None,
                (_, None) => {
                    eprintln!("[cadeia] snapshot sem âncora para a janela — replay completo");
                    return Ok(None);
                }
                (true, Some(v)) => {
                    let anterior = linha_por_altura
                        .get(&(tail_start - 1))
                        .and_then(|linha| store.get_json(*linha).ok().flatten())
                        .and_then(|v| crate::block::block_from_json(&v).ok());
                    let raiz_anterior = anterior.as_ref().and_then(|b| b.state_root.clone());
                    match crate::snapshot::Snapshot::estado_verificado(
                        v,
                        tail_start - 1,
                        raiz_anterior.as_deref(),
                    ) {
                        Ok(s) => Some(s),
                        Err(e) => {
                            eprintln!("[cadeia] âncora do snapshot não confere ({e}) — replay completo");
                            return Ok(None);
                        }
                    }
                }
            }
        };

        // A janela relida pode ser MAIOR que a do snapshot; recorta para casar com
        // a âncora, senão `tail[0]` não seria o bloco `tail_start`.
        let tail: Vec<Block> = tail
            .into_iter()
            .skip((tail_start - inicio_janela) as usize)
            .collect();

        // ---- daqui para baixo, só escrita: tudo já foi provado ----
        self.tail_start = tail_start;
        self.tail = tail;
        self.state = estado;
        self.base_state = base_state;
        self.hashes = hashes;
        self.hash_index = hash_index;
        self.tx_index = tx_index;
        self.address_tx_index = address_tx_index;
        self.blocks_with_txs = blocks_with_txs;
        self.producer_keys = producer_keys;
        eprintln!(
            "[cadeia] snapshot: {} chave(s) de produtor recuperada(s) da varredura",
            self.producer_keys.len()
        );
        // O arquivo acabou de ser lido e ainda descreve a ponta: não há por que
        // reescrevê-lo no primeiro bloco que chegar.
        self.ultimo_snapshot = snap.altura;
        Ok(Some(snap.altura))
    }

    /// Grava o snapshot quando a cadeia andou o bastante desde o último.
    ///
    /// Chamado após cada bloco aceito. O intervalo é `SNAPSHOT_INTERVAL_BLOCKS` —
    /// a constante existia no config e não tinha nenhum uso.
    ///
    /// G8: encode+write correm numa thread dedicada — o caminho quente de
    /// `add_block` só clona o estado e agenda o job. Falha de escrita é
    /// REGISTRADA e engolida: o snapshot é otimização, e um disco cheio não pode
    /// derrubar um validador que está produzindo blocos.
    pub fn talvez_snapshot(&mut self, caminho: &std::path::Path) {
        let altura = self.height();
        if altura < 0 {
            return;
        }
        let altura = altura as u64;
        if altura.saturating_sub(self.ultimo_snapshot) < crate::config::SNAPSHOT_INTERVAL_BLOCKS {
            return;
        }
        self.disparar_snapshot(caminho, altura);
    }

    /// Grava snapshot agora (shutdown limpo / ops). Best-effort; espera o job.
    pub fn forcar_snapshot(&mut self, caminho: &std::path::Path) {
        let altura = self.height();
        if altura < 0 {
            return;
        }
        let altura = altura as u64;
        self.disparar_snapshot(caminho, altura);
        if let Some(j) = self.snapshot_job.take() {
            let _ = j.join();
        }
    }

    fn disparar_snapshot(&mut self, caminho: &std::path::Path, altura: u64) {
        // Um job ainda em voo: não empilhar (o intervalo já foi reservado).
        if self.snapshot_job.as_ref().is_some_and(|j| !j.is_finished()) {
            return;
        }
        if let Some(j) = self.snapshot_job.take() {
            let _ = j.join();
        }
        let Some(cabeca) = self.head() else { return };
        // Sem `stateRoot` no header não há como provar o arquivo no boot — gravar
        // seria produzir algo que sempre será recusado.
        if cabeca.state_root.is_none() {
            return;
        }
        let file_bytes = self.store.as_ref().map(|s| s.file_bytes()).unwrap_or(0);
        let estado = self.state.clone();
        let base = self.base_state.clone();
        let head_hash = cabeca.hash.clone();
        let block_height = cabeca.height;
        let tail_start = self.tail_start;
        let path = caminho.to_path_buf();
        let epoch = self.snapshot_epoch.load(std::sync::atomic::Ordering::SeqCst);
        let epoch_arc = std::sync::Arc::clone(&self.snapshot_epoch);
        // Reserva o intervalo no caminho quente — o write é best-effort.
        self.ultimo_snapshot = altura;

        self.snapshot_job = Some(std::thread::spawn(move || {
            let snap = match crate::snapshot::Snapshot::montar(
                block_height,
                head_hash,
                tail_start,
                file_bytes,
                &estado,
                base.as_ref(),
            ) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[cadeia] estado não codificável na altura {altura}: {e}");
                    return;
                }
            };
            if epoch_arc.load(std::sync::atomic::Ordering::SeqCst) != epoch {
                return; // reorg invalidou enquanto montávamos
            }
            if let Err(e) = snap.gravar(&path) {
                eprintln!("[cadeia] snapshot não gravado na altura {altura}: {e}");
                return;
            }
            // Corrida: invalidate pode ter corrido entre o check e o rename.
            if epoch_arc.load(std::sync::atomic::Ordering::SeqCst) != epoch {
                crate::snapshot::remover(&path);
            }
        }));
    }

    /// Espera o writer G8 (testes / shutdown limpo).
    pub fn flush_snapshot(&mut self) {
        if let Some(j) = self.snapshot_job.take() {
            let _ = j.join();
        }
    }

    /// Invalida o snapshot em disco.
    ///
    /// Chamado quando a cadeia muda por baixo dele — uma reorganização que desça
    /// abaixo da altura gravada. Um arquivo que descreve um estado que a cadeia
    /// abandonou é PIOR que arquivo nenhum: ele bate com a raiz de um bloco que
    /// existiu, então o boot seguinte o aceitaria e o nó seguiria de um passado.
    pub fn invalidar_snapshot(&mut self, caminho: &std::path::Path) {
        self.snapshot_epoch
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        crate::snapshot::remover(caminho); // apaga arquivo + .tmp
        self.ultimo_snapshot = 0;
    }

    // ---------------------------------------------------------------- consulta

    pub fn get_block(&self, height: u64) -> Option<&Block> {
        if self.height() < 0 || height > self.height() as u64 || height < self.tail_start {
            return None;
        }
        self.tail.get((height - self.tail_start) as usize)
    }

    pub fn get_block_by_hash(&self, hash: &str) -> Option<&Block> {
        if !is_valid_hash(hash) {
            return None;
        }
        self.hash_index.get(hash).and_then(|h| self.get_block(*h))
    }

    /// Faixa contígua `[from, from + limit)`.
    pub fn get_range(&self, from: u64, limit: usize) -> Vec<&Block> {
        (from..from.saturating_add(limit as u64)).filter_map(|h| self.get_block(h)).collect()
    }

    /// O bloco da altura, consultando a JANELA DE RAM e caindo para o DISCO.
    ///
    /// `get_block` enxerga só o `tail` — blocos abaixo de `tail_start` já
    /// deslizaram para o `BlockStore` e são invisíveis para ele. Este é o caminho
    /// que a referência usa em `getBlock` (lê o store), e é o que a API serve. O
    /// retorno é POSSUÍDO porque o bloco de disco é reconstruído da linha JSON.
    ///
    /// Linha ilegível é `Err`, não `None`: `None` significa "altura não existe";
    /// corrupção de disco tem de subir ruidosa, nunca fingir ausência.
    ///
    /// PRESSUPOSTO ESTRUTURAL: a linha N do arquivo é o bloco de altura N. Vale
    /// porque o arquivo nasce na gênese (linha 0) e o `add_block` grava em ordem;
    /// o boot NÃO assume — valida `altura == índice da linha` durante a varredura
    /// e recusa o arquivo se divergir.
    pub fn block_at(&self, height: u64) -> Result<Option<Block>, ChainError> {
        if self.height() < 0 || height > self.height() as u64 {
            return Ok(None);
        }
        if height >= self.tail_start {
            return Ok(self.tail.get((height - self.tail_start) as usize).cloned());
        }
        let Some(store) = self.store.as_ref() else {
            // Sem disco a janela é a cadeia inteira; abaixo dela não há nada.
            return Ok(None);
        };
        let altura = usize::try_from(height).map_err(|_| "altura fora da faixa".to_string())?;
        match store.get_json(altura) {
            Ok(None) => Ok(None),
            Ok(Some(v)) => crate::block::block_from_json(&v)
                .map(Some)
                .map_err(|e| format!("bloco {height} ilegível no disco: {e}")),
            Err(e) => Err(format!("bloco {height} ilegível no disco: {e}")),
        }
    }

    /// Faixa contígua `[from, from + limit)` pelo caminho FUNDO (RAM + disco).
    /// Blocos possuídos, pela mesma razão de [`Self::block_at`].
    pub fn range_at(&self, from: u64, limit: usize) -> Result<Vec<Block>, ChainError> {
        let mut out = Vec::new();
        for h in from..from.saturating_add(limit as u64) {
            match self.block_at(h)? {
                Some(b) => out.push(b),
                None => break, // faixa contígua: o primeiro buraco encerra
            }
        }
        Ok(out)
    }

    /// O bloco pelo hash, pelo caminho FUNDO (RAM + disco). O `hash_index` cobre a
    /// cadeia inteira (não desliza com a janela), então um hash antigo resolve a
    /// altura e a leitura cai no disco.
    pub fn block_by_hash_at(&self, hash: &str) -> Result<Option<Block>, ChainError> {
        if !is_valid_hash(hash) {
            return Ok(None);
        }
        match self.hash_index.get(hash) {
            None => Ok(None),
            Some(&h) => self.block_at(h),
        }
    }

    /// A transação, a altura e o hash do bloco, pelo caminho FUNDO (RAM + disco).
    /// Espelha o `getTransaction` da referência, que lê o store para tx antiga.
    pub fn transaction_at(&self, id: &str) -> Result<Option<(Tx, u64, String)>, ChainError> {
        let Some(&altura) = self.tx_index.get(id) else {
            return Ok(None);
        };
        let Some(bloco) = self.block_at(altura)? else {
            return Ok(None);
        };
        let Some(tx) = bloco.transactions.into_iter().find(|t| t.id.as_deref() == Some(id)) else {
            return Ok(None);
        };
        Ok(Some((tx, altura, bloco.hash)))
    }

    /// A transação, a altura e o hash do bloco que a contém.
    pub fn get_transaction(&self, id: &str) -> Option<(&Tx, u64, &str)> {
        let altura = *self.tx_index.get(id)?;
        let bloco = self.get_block(altura)?;
        let tx = bloco.transactions.iter().find(|t| t.id.as_deref() == Some(id))?;
        Some((tx, altura, bloco.hash.as_str()))
    }

    /// Maior altura FINALIZADA por BFT: aquela sobre a qual 2/3+1 validadores
    /// DISTINTOS já produziram. Espelha `finalizedHeight`.
    ///
    /// É determinística da própria cadeia — os produtores estão nos blocos — e não
    /// precisa de subprotocolo de votos. Devolve `-1` (sem finalidade) quando há
    /// validadores de menos para garantia BFT: com poucos, "2/3 distintos" seria
    /// trivial de alcançar sozinho e a finalidade viraria teatro.
    pub fn finalized_height(&self) -> Result<i64, ChainError> {
        let n = validators(&self.state)?.len();
        if n < FINALITY_MIN_VALIDATORS {
            return Ok(-1);
        }
        let quorum = (2 * n) / 3 + 1;
        let mut produtores: BTreeSet<&str> = BTreeSet::new();
        let piso = self.tail_start.max(1);
        let mut h = self.height();
        while h >= piso as i64 {
            let Some(b) = self.get_block(h as u64) else { break };
            produtores.insert(b.producer.as_str());
            if produtores.len() >= quorum {
                return Ok(h - 1); // [h, cabeça] tem quórum → h-1 está final
            }
            h -= 1;
        }
        Ok(-1)
    }

    // ------------------------------------------------------------------ reorg

    /// Escolha de forquilha a partir de um ANCESTRAL COMUM.
    ///
    /// Valida e aplica o rabo novo sobre o estado reconstruído no ponto de fork, e
    /// adota se a cadeia ficar mais longa. O custo é O(janela), nunca O(cadeia).
    ///
    /// As duas guardas de finalidade abaixo NÃO são redundantes entre si: a
    /// primeira é estática (a janela de validação fraca, anterior ao produtor
    /// estrito, congela assim que a cadeia passa dela) e a segunda é dinâmica (o
    /// que 2/3+1 dos validadores atuais já endossaram).
    pub fn reorg(
        &mut self,
        common: i64,
        new_blocks: Vec<Block>,
        now: i64,
    ) -> Result<Reorg, ChainError> {
        if !self.has_genesis() {
            return Err("cadeia sem bloco gênese".into());
        }
        if common < 0 || common > self.height() {
            return Err("ponto de fork inválido".into());
        }
        let common_u = common as u64;
        if common + new_blocks.len() as i64 <= self.height() {
            return Ok(Reorg::Manteve);
        }

        // Uma vez que a cadeia PASSOU de STRICT_PRODUCER_HEIGHT, os blocos até esse
        // ponto (a janela de grandfathering, de validação fraca) ficam imutáveis. Sem
        // isto, um validador bizantino forjaria uma cadeia mais densa naquela janela
        // e a rede a adotaria (achado C1).
        let fin = STRICT_PRODUCER_HEIGHT;
        if fin > 0 && self.height() >= fin as i64 && common_u < fin {
            return Err(
                "reorg rejeitado: tentaria substituir histórico finalizado (< STRICT_PRODUCER_HEIGHT)"
                    .into(),
            );
        }
        let finalizada = self.finalized_height()?;
        if common < finalizada {
            return Err(format!(
                "reorg rejeitado: tentaria reverter bloco finalizado por BFT (comum {common} < final {finalizada})"
            ));
        }
        if common < self.tail_start as i64 - 1 {
            return Err("reorg além da janela de reorganização".into());
        }

        // Estado no ponto de fork: âncora + re-execução dos blocos da janela até
        // `common`. São blocos já validados — só re-execução determinística.
        let fork_state = if common == self.tail_start as i64 - 1 {
            self.base_state.clone().ok_or("âncora de estado ausente para o reorg")?
        } else if self.tail_start == 0 {
            let genese = self.tail.first().ok_or("cadeia sem bloco gênese")?;
            let alocacoes =
                genese.genesis.clone().ok_or_else(|| "alocações da gênese ausentes".to_string())?;
            let mut s = State::new();
            apply_genesis(&mut s, &alocacoes)?;
            for h in 1..=common_u {
                let b = self.tail.get(h as usize).ok_or("bloco fora da janela")?.clone();
                self.apply_block_to(&mut s, &b)?;
            }
            s
        } else {
            let mut s = self.base_state.clone().ok_or("âncora de estado ausente para o reorg")?;
            for h in self.tail_start..=common_u {
                let b = self
                    .tail
                    .get((h - self.tail_start) as usize)
                    .ok_or("bloco fora da janela")?
                    .clone();
                self.apply_block_to(&mut s, &b)?;
            }
            s
        };

        // Cadeia CANDIDATA, descartável: ancorada no bloco do fork. O `add_block`
        // dela aplica todas as regras de consenso vivas ao rabo novo — é o que
        // impede que um reorg entre por uma porta com validação mais fraca.
        let mut candidato = Blockchain::new();
        candidato.expected_genesis_hash = self.expected_genesis_hash.clone();
        candidato.tail = vec![self.get_block(common_u).ok_or("bloco do fork fora da janela")?.clone()];
        candidato.tail_start = common_u;
        candidato.state = fork_state;
        // O `tx_index` do candidato é o histórico ≤ common: mantém a rejeição de
        // transação duplicada contra a cadeia INTEIRA, não só contra o rabo novo.
        candidato.tx_index =
            self.tx_index.iter().filter(|(_, h)| **h <= common_u).map(|(k, v)| (k.clone(), *v)).collect();
        for bloco in &new_blocks {
            candidato.add_block(bloco.clone(), now)?;
        }
        if candidato.height() <= self.height() {
            return Ok(Reorg::Manteve);
        }

        // Órfãs: transações dos blocos descartados que não estão na cadeia nova.
        let descartados: Vec<Block> =
            self.tail.split_off((common_u + 1 - self.tail_start) as usize);
        let mut orfas = Vec::new();
        for bloco in &descartados {
            for tx in &bloco.transactions {
                let id = tx.id.as_deref().unwrap_or("");
                if !candidato.tx_index.contains_key(id) {
                    orfas.push(tx.clone());
                }
            }
        }

        // DISCO ANTES DA MEMÓRIA, como no `add_block`: se a troca de rabo não
        // couber no disco, a reorganização é recusada INTEIRA e o estado em RAM
        // continua na cadeia antiga. Commitar primeiro deixava memória e disco
        // divergentes num erro de I/O — e é justamente no reorg que essa
        // divergência é mais cara, porque o boot seguinte leria uma cadeia que
        // não corresponde a nenhum estado que existiu.
        //
        // Trunca no fork e re-appenda o rabo novo: o prefixo comum nunca é
        // reescrito — reorg O(rabo), não O(cadeia). Espelha blockchain.js:507-510.
        if !self.loading && let Some(store) = self.store.as_mut() {
            let manter = usize::try_from(common + 1).unwrap_or(0);
            store
                .truncate_from(manter)
                .map_err(|e| format!("truncar o rabo antigo no disco: {e}"))?;
            for bloco in &new_blocks {
                let linha = crate::block::block_to_json_line(bloco)
                    .map_err(|e| format!("serializar bloco {}: {e}", bloco.height))?;
                store
                    .append(&linha)
                    .map_err(|e| format!("persistir bloco {}: {e}", bloco.height))?;
            }
        }

        // ---- commit ----
        self.state = candidato.state;
        self.tx_index = candidato.tx_index;
        for bloco in &descartados {
            for tx in &bloco.transactions {
                for endereco in [Some(&tx.from), tx.to.as_ref()].into_iter().flatten() {
                    if let Some(alturas) = self.address_tx_index.get_mut(endereco) {
                        while alturas.last().is_some_and(|h| *h > common_u) {
                            alturas.pop();
                        }
                        if alturas.is_empty() {
                            self.address_tx_index.remove(endereco);
                        }
                    }
                }
            }
            self.hash_index.remove(&bloco.hash);
        }
        while self.blocks_with_txs.last().is_some_and(|h| *h > common_u) {
            self.blocks_with_txs.pop();
        }
        for (addr, alturas) in candidato.address_tx_index {
            self.address_tx_index.entry(addr).or_default().extend(alturas);
        }
        self.blocks_with_txs.extend(candidato.blocks_with_txs);
        // Recibos/eventos/internas: poda o que veio dos blocos descartados e
        // adota o que o candidato produziu — o mesmo tratamento do índice por
        // endereço, logo acima.
        //
        // DIVERGE DA REFERÊNCIA DE PROPÓSITO: `blockchain.js:530-551` poda o
        // índice por endereço e esquece estes três, então um nó que reorganiza
        // fica com recibo de transação ÓRFÃ (o explorer a mostra minerada e com
        // sucesso, quando ela voltou para o mempool) e sem recibo nenhum das
        // transações do rabo novo. É seguro corrigir: nada disto entra no
        // `stateRoot` — dois nós discordando aqui seguem a MESMA cadeia.
        self.receipts.retain(|_, r| r.block_height <= common_u);
        self.receipts.extend(candidato.receipts);
        self.log_index.retain(|e| e.block_height <= common_u);
        self.log_index.extend(candidato.log_index);
        self.internal_index.retain(|x| x.block_height <= common_u);
        self.internal_index.extend(candidato.internal_index);
        aparar(&mut self.log_index);
        aparar(&mut self.internal_index);
        self.hashes.retain(|h, _| *h <= common_u);
        for bloco in &new_blocks {
            self.hashes.insert(bloco.height, bloco.hash.clone());
            self.hash_index.insert(bloco.hash.clone(), bloco.height);
        }
        self.tail.extend(new_blocks);
        self.slide_tail();
        // O snapshot descreve uma altura que a cadeia acabou de abandonar. Mantê-lo
        // é pior que não ter nenhum: ele bate com a raiz de um bloco que EXISTIU,
        // então o boot seguinte o aceitaria e o nó seguiria a partir de um passado
        // que a rede descartou. Espelha `blockchain.js:525-528`.
        if self.ultimo_snapshot > common_u && let Some(caminho) = self.snapshot_path.clone() {
            self.invalidar_snapshot(&caminho);
        }
        Ok(Reorg::Adotou(orfas))
    }

    /// Recebe uma cadeia completa, acha o ancestral comum e delega ao reorg.
    /// Espelha `replaceChain`. Sem gênese, adota a cadeia recebida.
    pub fn replace_chain(&mut self, blocos: Vec<Block>, now: i64) -> Result<Reorg, ChainError> {
        if blocos.is_empty() {
            return Ok(Reorg::Manteve);
        }
        if !self.has_genesis() {
            let mut iter = blocos.into_iter();
            let genese = iter.next().ok_or("cadeia vazia")?;
            self.adopt_genesis(genese)?;
            for bloco in iter {
                self.add_block(bloco, now)?;
            }
            return Ok(Reorg::Adotou(Vec::new()));
        }
        if blocos.len() as i64 - 1 <= self.height() {
            return Ok(Reorg::Manteve);
        }
        if Some(blocos[0].hash.clone()) != self.hash_at(0) {
            return Err("gênese divergente: a cadeia recebida pertence a outra rede".into());
        }
        let mut common: i64 = -1;
        let topo = self.height().min(blocos.len() as i64 - 1);
        for h in (0..=topo).rev() {
            if Some(blocos[h as usize].hash.clone()) == self.hash_at(h as u64) {
                common = h;
                break;
            }
        }
        let novos = blocos.into_iter().skip((common + 1) as usize).collect();
        self.reorg(common, novos, now)
    }
}

// ============================================================================
// Testes
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block::teste_util::Carteira;
    use crate::block::{block_hash, block_payload, PERMISSIONS_V2_HEIGHT};
    use crate::state::Account;
    use crate::transaction::JsonValue;

    /// Altura acima de STRICT/CANONICAL/STATEROOT e ABAIXO de PERMISSIONS_V2 e de
    /// EAVM_OSAKA — a faixa em que todas as regras deste módulo estão ligadas.
    const ALTURA: u64 = 1_300_000;

    /// CINCO validadores, não três: com `FINALITY_MIN_VALIDATORS = 3` o quórum de
    /// finalidade seria 3, e uma cadeia de teste de três blocos já congelaria por
    /// finalidade BFT antes de o reorg poder ser exercitado. Com cinco, o quórum é
    /// 4 e as cadeias curtas dos testes ficam reorganizáveis — que é o que se quer
    /// MEDIR aqui; a finalidade tem teste próprio.
    const N_VALIDADORES: u8 = 5;

    fn carteiras() -> Vec<Carteira> {
        (0..N_VALIDADORES).map(Carteira::nova).collect()
    }

    /// Estado com os validadores stakeados, todos com o MESMO stake — o desempate
    /// por endereço é então o único critério, o que torna a ordem previsível.
    fn estado_validadores(cs: &[Carteira]) -> State {
        let mut s = State::new();
        for c in cs {
            s.accounts.insert(
                c.endereco(),
                Account { balance: 0, staked: MIN_VALIDATOR_STAKE * 2, ..Default::default() },
            );
        }
        s
    }

    /// Timestamp cujo slot pertence ao validador de índice `i` da lista ativa.
    fn ts_do_slot(slot: i64) -> i64 {
        slot * BLOCK_TIME_MS
    }

    /// Cadeia sintética ancorada em `altura`, com âncora de estado coerente.
    ///
    /// Monta o mesmo arranjo que a referência produz quando a janela já deslizou:
    /// `base_state` é o estado ANTES do bloco de `tail[0]`, e `state` é o de depois.
    /// Sem essa coerência o reorg reconstruiria um estado que nunca existiu.
    fn cadeia(cs: &[Carteira], altura: u64, slot: i64) -> Blockchain {
        cadeia_saldo(cs, altura, slot, 0)
    }

    /// Idem, com SALDO nas contas dos validadores — transação EAVM paga taxa, e o
    /// arranjo-padrão nasce com saldo zero.
    ///
    /// O saldo entra no estado ANTES do bloco-âncora, não depois: a âncora paga
    /// recompensa ao produtor, e injetar saldo já com ela aplicada faria
    /// `base_state + âncora != state` — divergência que só apareceria num reorg,
    /// como uma raiz de estado que não confere.
    fn cadeia_saldo(cs: &[Carteira], altura: u64, slot: i64, saldo: crate::state::Amount) -> Blockchain {
        let mut pre = estado_validadores(cs);
        if saldo > 0 {
            for c in cs {
                pre.accounts.entry(c.endereco()).or_default().balance = saldo;
            }
        }
        let mut chain = Blockchain::new();
        chain.state = pre.clone();
        let vals = validators(&pre).expect("validadores");
        let idx = (slot.rem_euclid(vals.len() as i64)) as usize;
        let dono = &vals[idx].address;
        let carteira = cs.iter().find(|c| &c.endereco() == dono).expect("dono do slot");
        let ancora = build_block(
            carteira,
            BuildParams {
                height: altura,
                previous_hash: "a".repeat(64),
                timestamp: ts_do_slot(slot),
                transactions: Vec::new(),
                state_root: Some("b".repeat(64)),
                producer_account: None,
                omit_public_keys: false,
            },
        )
        .expect("âncora");

        let mut pos = pre.clone();
        chain.apply_block_to(&mut pos, &ancora).expect("aplica âncora");
        chain.hashes.insert(altura, ancora.hash.clone());
        chain.hash_index.insert(ancora.hash.clone(), altura);
        chain.tail = vec![ancora];
        chain.tail_start = altura;
        chain.base_state = Some(pre);
        chain.state = pos;
        chain
    }

    /// Produz o bloco seguinte da cadeia no slot dado, pela carteira que o detém.
    fn proximo(chain: &Blockchain, cs: &[Carteira], slot: i64) -> Block {
        proximo_com(chain, cs, slot, Vec::new())
    }

    /// Idem, LEVANDO transações — a raiz do header é computada sobre o estado
    /// depois de aplicá-las, senão o `add_block` recusaria o próprio bloco.
    fn proximo_com(chain: &Blockchain, cs: &[Carteira], slot: i64, txs: Vec<Tx>) -> Block {
        let dono = chain.expected_producer(ts_do_slot(slot)).expect("validadores").expect("dono");
        let carteira = cs.iter().find(|c| c.endereco() == dono).expect("carteira do dono");
        let cabeca = chain.head().expect("cabeça");
        let altura = cabeca.height + 1;
        let mut sim = chain.state.clone();
        let esboco = Block {
            height: altura,
            timestamp: ts_do_slot(slot),
            previous_hash: cabeca.hash.clone(),
            producer: carteira.endereco(),
            producer_account: None,
            transactions: txs.clone(),
            ..cabeca.clone()
        };
        chain.simulate(&mut sim, &esboco, &mut Vec::new()).expect("simulação");
        let raiz = compute_state_root(&sim.state_leaves().expect("folhas"));
        build_block(
            carteira,
            BuildParams {
                height: altura,
                previous_hash: cabeca.hash.clone(),
                timestamp: ts_do_slot(slot),
                transactions: txs,
                state_root: Some(raiz),
                producer_account: None,
                omit_public_keys: false,
            },
        )
        .expect("bloco")
    }

    /// Transação EAVM REALMENTE assinada — `verify_transaction` autentica de
    /// verdade, então fixture com `"pk"`/`"sig"` de mentira não entra em bloco.
    fn tx_eavm(c: &Carteira, tipo: &str, nonce: i64, campos: Vec<(&str, JsonValue)>) -> Tx {
        use crate::block::BlockSigner;
        use crate::transaction::{tx_id, tx_signing_payload};

        let mut tx = Tx::new(tipo, c.endereco(), nonce, 1_700_000_000_000);
        tx.amount = "0".into();
        tx.fee = "10000000".into();
        tx.data = Some(JsonValue::map(campos.into_iter().map(|(k, v)| (k.to_string(), v))));
        tx.public_key = Some(c.public_key_pem().to_string());
        tx.pq_public_key = Some(c.pq_public_key_pem().to_string());
        let (sig, pqsig) = c.sign(tx_signing_payload(&tx).as_bytes()).expect("assina");
        tx.signature = Some(sig);
        tx.pq_signature = Some(pqsig);
        tx.id = Some(tx_id(&tx));
        tx
    }

    /// Bytecode de INICIALIZAÇÃO que devolve `runtime` como código do contrato.
    ///
    /// `PUSH1 n; PUSH1 <offset>; PUSH1 0; CODECOPY; PUSH1 n; PUSH1 0; RETURN` — o
    /// prólogo padrão de deploy. Montado à mão porque o teste precisa de código
    /// que EXECUTE (emita LOG, reverta), e um `0x00` não exercita nada disso.
    fn deploy_de(runtime: &[u8]) -> String {
        let n = u8::try_from(runtime.len()).expect("runtime curto");
        let mut c = vec![0x60, n, 0x60, 0x0c, 0x60, 0x00, 0x39, 0x60, n, 0x60, 0x00, 0xf3];
        debug_assert_eq!(c.len(), 12, "o offset 0x0c do CODECOPY é o tamanho do prólogo");
        c.extend_from_slice(runtime);
        format!("0x{}", c.iter().map(|b| format!("{b:02x}")).collect::<String>())
    }

    /// Relógio local generoso o bastante para o slot em questão não ser "futuro".
    fn agora(slot: i64) -> i64 {
        ts_do_slot(slot) + BLOCK_TIME_MS
    }

    // ------------------------------------------------------- rodízio de produtor

    #[test]
    fn o_produtor_roda_por_slot_e_e_universalmente_computavel() {
        let cs = carteiras();
        let mut chain = Blockchain::new();
        chain.state = estado_validadores(&cs);
        let vals = validators(&chain.state).expect("validadores");
        assert_eq!(vals.len(), N_VALIDADORES as usize);

        // Slots consecutivos percorrem a lista ATIVA na ordem, e o ciclo fecha.
        for slot in 0..(2 * vals.len() as i64) {
            let esperado = &vals[(slot as usize) % vals.len()].address;
            assert_eq!(
                chain.expected_producer(ts_do_slot(slot)).expect("ok").as_deref(),
                Some(esperado.as_str()),
                "slot {slot}"
            );
        }
        // Todo instante DENTRO do mesmo slot dá o mesmo produtor — é o que torna o
        // rodízio insensível a milissegundo e, portanto, computável por qualquer nó.
        let base = ts_do_slot(7);
        let p = chain.expected_producer(base).expect("ok");
        assert_eq!(chain.expected_producer(base + BLOCK_TIME_MS - 1).expect("ok"), p);
        assert_ne!(chain.expected_producer(base + BLOCK_TIME_MS).expect("ok"), p);
    }

    #[test]
    fn sem_validador_ativo_o_slot_nao_pertence_a_ninguem() {
        let chain = Blockchain::new();
        assert_eq!(chain.expected_producer(ts_do_slot(3)).expect("ok"), None);
    }

    #[test]
    fn o_conjunto_ativo_ordena_por_peso_e_desempata_por_endereco() {
        let cs = carteiras();
        let mut s = estado_validadores(&cs);
        // Votos entram no PESO: quem recebe votos sobe, mesmo com o mesmo stake.
        let favorito = cs[3].endereco();
        s.candidate_votes.insert(favorito.clone(), MIN_VALIDATOR_STAKE * 10);
        let vals = validators(&s).expect("validadores");
        assert_eq!(vals[0].address, favorito, "peso = stake + votos recebidos");

        // Abaixo do mínimo, a conta simplesmente não é validadora.
        let mut s2 = State::new();
        s2.accounts.insert(
            cs[0].endereco(),
            Account { staked: MIN_VALIDATOR_STAKE - 1, ..Default::default() },
        );
        assert!(validators(&s2).expect("ok").is_empty());
    }

    // ------------------------------------------- produtor fora do slot × o fork

    #[test]
    fn acima_do_fork_o_bloco_fora_do_slot_e_rejeitado() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let bloco = proximo(&chain, &cs, 101);

        // Reassina o MESMO conteúdo com outra carteira: o bloco continua íntegro,
        // só o produtor deixa de ser o do slot.
        let dono = chain.expected_producer(ts_do_slot(101)).expect("ok").expect("dono");
        let intrusa = cs.iter().find(|c| c.endereco() != dono).expect("outra carteira");
        let forjado = build_block(
            intrusa,
            BuildParams {
                height: bloco.height,
                previous_hash: bloco.previous_hash.clone(),
                timestamp: bloco.timestamp,
                transactions: Vec::new(),
                state_root: bloco.state_root.clone(),
                producer_account: None,
                omit_public_keys: false,
            },
        )
        .expect("bloco forjado");
        assert_eq!(verify_block_integrity(&forjado), Ok(()), "o bloco é íntegro — só está fora de turno");

        let erro = chain.add_block(forjado, agora(101)).expect_err("deveria rejeitar");
        assert!(erro.starts_with("produtor fora do slot"), "erro foi: {erro}");
    }

    #[test]
    fn abaixo_do_fork_basta_ser_validador_ativo() {
        if STRICT_PRODUCER_HEIGHT < 2 { return; }
        let cs = carteiras();
        // Âncora logo abaixo de STRICT_PRODUCER_HEIGHT: o bloco seguinte ainda cai
        // na janela de grandfathering.
        let altura_ancora = STRICT_PRODUCER_HEIGHT - 2;
        let mut chain = cadeia(&cs, altura_ancora, 100);
        assert!(altura_ancora + 1 < STRICT_PRODUCER_HEIGHT);

        let dono = chain.expected_producer(ts_do_slot(101)).expect("ok").expect("dono");
        let intrusa = cs.iter().find(|c| c.endereco() != dono).expect("outra carteira");
        let cabeca = chain.head().expect("cabeça").clone();
        let fora_de_turno = build_block(
            intrusa,
            BuildParams {
                height: cabeca.height + 1,
                previous_hash: cabeca.hash.clone(),
                timestamp: ts_do_slot(101),
                transactions: Vec::new(),
                // Abaixo de STATEROOT_HEIGHT o campo é proibido — `build_block` o
                // descarta sozinho, e é isso que este teste também confere.
                state_root: None,
                producer_account: None,
                omit_public_keys: false,
            },
        )
        .expect("bloco");
        assert_eq!(fora_de_turno.state_root, None);
        assert_eq!(chain.add_block(fora_de_turno, agora(101)), Ok(()));
    }

    #[test]
    fn quem_nao_e_validador_nao_produz_nem_abaixo_do_fork() {
        if STRICT_PRODUCER_HEIGHT < 2 { return; }
        let cs = carteiras();
        let mut chain = cadeia(&cs, STRICT_PRODUCER_HEIGHT - 2, 100);
        let estranha = Carteira::nova(200); // sem stake nenhum
        let cabeca = chain.head().expect("cabeça").clone();
        let bloco = build_block(
            &estranha,
            BuildParams {
                height: cabeca.height + 1,
                previous_hash: cabeca.hash.clone(),
                timestamp: ts_do_slot(101),
                transactions: Vec::new(),
                state_root: None,
                producer_account: None,
                omit_public_keys: false,
            },
        )
        .expect("bloco");
        let erro = chain.add_block(bloco, agora(101)).expect_err("deveria rejeitar");
        assert!(erro.starts_with("produtor não é um validador ativo"), "erro foi: {erro}");
    }

    // ------------------------------------------------------- um bloco por slot

    #[test]
    fn dois_blocos_no_mesmo_slot_sao_rejeitados() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let primeiro = proximo(&chain, &cs, 101);
        assert_eq!(chain.add_block(primeiro, agora(101)), Ok(()));

        // Mesmo slot, timestamp 1 ms adiante: avança o relógio, NÃO avança o slot.
        // Sem esta regra, o dono do slot emitiria mil blocos dentro do próprio
        // segundo e a emissão explodiria.
        let dono = chain.expected_producer(ts_do_slot(101)).expect("ok").expect("dono");
        let carteira = cs.iter().find(|c| c.endereco() == dono).expect("carteira");
        let cabeca = chain.head().expect("cabeça").clone();
        let mesmo_slot = build_block(
            carteira,
            BuildParams {
                height: cabeca.height + 1,
                previous_hash: cabeca.hash.clone(),
                timestamp: ts_do_slot(101) + 1,
                transactions: Vec::new(),
                state_root: Some("c".repeat(64)),
                producer_account: None,
                omit_public_keys: false,
            },
        )
        .expect("bloco");
        assert_eq!(
            chain.add_block(mesmo_slot, agora(102)),
            Err("slot já ocupado: no máximo um bloco por slot".into())
        );
    }

    #[test]
    fn bloco_de_slot_futuro_e_rejeitado() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let bloco = proximo(&chain, &cs, 500);
        // Relógio local ainda no slot 101: o bloco pertence a um slot que não chegou.
        let erro = chain.add_block(bloco, agora(101)).expect_err("deveria rejeitar");
        assert_eq!(erro, "bloco pertence a um slot futuro");
    }

    // ------------------------------------------------------------ txRoot

    #[test]
    fn adulteracao_de_transacao_e_pega_pelo_txroot() {
        use crate::transaction::{tx_id, JsonValue, Tx};
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);

        let mut tx = Tx::new("TRANSFER", cs[0].endereco(), 1, 1_700_000_000_000);
        tx.to = Some(cs[1].endereco());
        tx.amount = "1".into();
        tx.data = Some(JsonValue::map([]));
        tx.public_key = Some("pk".into());
        tx.pq_public_key = Some("pqpk".into());
        tx.signature = Some("sig".into());
        tx.pq_signature = Some("pqsig".into());
        tx.id = Some(tx_id(&tx));

        let dono = chain.expected_producer(ts_do_slot(101)).expect("ok").expect("dono");
        let carteira = cs.iter().find(|c| c.endereco() == dono).expect("carteira");
        let cabeca = chain.head().expect("cabeça").clone();
        let mut bloco = build_block(
            carteira,
            BuildParams {
                height: cabeca.height + 1,
                previous_hash: cabeca.hash.clone(),
                timestamp: ts_do_slot(101),
                transactions: vec![tx],
                state_root: Some("d".repeat(64)),
                producer_account: None,
                omit_public_keys: false,
            },
        )
        .expect("bloco");

        // O atacante troca o DESTINO de uma transação já incluída. O `txRoot` do
        // header foi assinado sobre a lista original — a troca é detectada antes de
        // qualquer regra de estado.
        bloco.transactions[0].to = Some(Carteira::nova(200).endereco());
        bloco.transactions[0].id = Some(tx_id(&bloco.transactions[0]));
        assert_eq!(verify_block_integrity(&bloco), Err("txRoot não confere".into()));
        assert_eq!(chain.add_block(bloco, agora(101)), Err("txRoot não confere".into()));
    }

    // ------------------------------------------------------------ stateRoot

    #[test]
    fn stateroot_divergente_e_rejeitado() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let bom = proximo(&chain, &cs, 101);
        let raiz_boa = bom.state_root.clone().expect("acima do fork tem raiz");

        // Mesmo bloco, mesma altura, mesmo slot, produtor certo — só a raiz mente.
        let dono = chain.expected_producer(ts_do_slot(101)).expect("ok").expect("dono");
        let carteira = cs.iter().find(|c| c.endereco() == dono).expect("carteira");
        let mentiroso = build_block(
            carteira,
            BuildParams {
                height: bom.height,
                previous_hash: bom.previous_hash.clone(),
                timestamp: bom.timestamp,
                transactions: Vec::new(),
                state_root: Some("e".repeat(64)),
                producer_account: None,
                omit_public_keys: false,
            },
        )
        .expect("bloco");
        // O bloco é internamente ÍNTEGRO: assinatura e hash cobrem a raiz falsa. Só
        // a recomputação contra o estado o desmascara.
        assert_eq!(verify_block_integrity(&mentiroso), Ok(()));
        let erro = chain.add_block(mentiroso, agora(101)).expect_err("deveria rejeitar");
        assert!(erro.starts_with("stateRoot não confere"), "erro foi: {erro}");
        assert!(erro.contains(&raiz_boa), "a mensagem tem de dizer qual era a raiz certa");

        // E o bloco honesto passa.
        assert_eq!(chain.add_block(bom, agora(101)), Ok(()));
    }

    #[test]
    fn a_recompensa_vai_para_a_conta_validadora() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let bloco = proximo(&chain, &cs, 101);
        let validador = block_validator(&bloco).to_string();
        let antes = chain.state.balance_of(&validador);
        assert_eq!(chain.add_block(bloco, agora(101)), Ok(()));
        assert_eq!(
            chain.state.balance_of(&validador) - antes,
            BLOCK_REWARD,
            "sem votos, o produtor leva a recompensa inteira"
        );
    }

    // ---------------------------------------------------------------- reorg

    /// Constrói `n` blocos consecutivos a partir da cabeça de `chain`, começando no
    /// slot `slot0`, SEM commitá-los — é o rabo candidato de um reorg.
    fn rabo(chain: &Blockchain, cs: &[Carteira], slot0: i64, n: usize) -> Vec<Block> {
        // Espelho SEM disco: o rabo candidato existe só em memória até vencer o
        // reorg. Construir em vez de clonar é o mesmo caminho da produção.
        let mut espelho = Blockchain {
            tail: chain.tail.clone(),
            tail_start: chain.tail_start,
            base_state: chain.base_state.clone(),
            state: chain.state.clone(),
            hashes: chain.hashes.clone(),
            hash_index: chain.hash_index.clone(),
            tx_index: chain.tx_index.clone(),
            address_tx_index: chain.address_tx_index.clone(),
            blocks_with_txs: chain.blocks_with_txs.clone(),
            expected_genesis_hash: chain.expected_genesis_hash.clone(),
            store: None,
            ..Default::default()
        };
        let mut out = Vec::new();
        for i in 0..n {
            let slot = slot0 + i as i64;
            let b = proximo(&espelho, cs, slot);
            espelho.add_block(b.clone(), agora(slot)).expect("bloco do rabo");
            out.push(b);
        }
        out
    }

    #[test]
    fn o_reorg_adota_a_cadeia_mais_longa_e_recusa_a_mais_curta() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let comum = ALTURA as i64;

        // Cadeia corrente: dois blocos a partir do slot 101.
        let corrente = rabo(&chain, &cs, 101, 2);
        for (i, b) in corrente.iter().enumerate() {
            chain.add_block(b.clone(), agora(101 + i as i64)).expect("bloco corrente");
        }
        assert_eq!(chain.height(), comum + 2);
        let ultimo_corrente = chain.head().expect("cabeça").hash.clone();

        // Rival mais CURTA (um bloco): não substitui.
        let curta = rabo(&chain_no_fork(&chain, comum), &cs, 201, 1);
        assert_eq!(chain.reorg(comum, curta, agora(202)).expect("reorg"), Reorg::Manteve);
        assert_eq!(chain.head().expect("cabeça").hash, ultimo_corrente, "nada pode ter mudado");

        // Rival mais LONGA (três blocos): substitui.
        let longa = rabo(&chain_no_fork(&chain, comum), &cs, 301, 3);
        let esperado = longa.last().expect("último").hash.clone();
        match chain.reorg(comum, longa, agora(303)).expect("reorg") {
            Reorg::Adotou(orfas) => assert!(orfas.is_empty(), "nenhum bloco tinha transação"),
            Reorg::Manteve => panic!("a cadeia mais longa tinha de ser adotada"),
        }
        assert_eq!(chain.height(), comum + 3);
        assert_eq!(chain.head().expect("cabeça").hash, esperado);
        // Os hashes dos blocos abandonados saem do índice — senão uma consulta por
        // hash devolveria um bloco que não está mais na cadeia.
        assert!(!chain.hash_index.contains_key(&ultimo_corrente));
        assert_eq!(chain.hash_at(comum as u64 + 3), Some(esperado));
    }

    /// Uma cópia de `chain` truncada no ponto de fork — o ponto de partida de quem
    /// constrói a cadeia rival.
    ///
    /// CONSTRÓI a candidata em vez de clonar a cadeia — que é exatamente o que a
    /// reorganização real faz. A `Blockchain` deixou de ser `Clone` quando ganhou o
    /// `BlockStore`: um descritor de arquivo não tem cópia com significado, e duas
    /// cadeias escrevendo o mesmo `blocks.jsonl` corromperiam o índice. O teste
    /// agora exercita o mesmo caminho da produção.
    fn chain_no_fork(chain: &Blockchain, comum: i64) -> Blockchain {
        let manter = (comum as u64 + 1 - chain.tail_start) as usize;
        let mut c = Blockchain {
            tail: chain.tail[..manter].to_vec(),
            tail_start: chain.tail_start,
            base_state: chain.base_state.clone(),
            hashes: chain.hashes.iter().filter(|(h, _)| **h <= comum as u64)
                .map(|(h, v)| (*h, v.clone())).collect(),
            hash_index: chain.hash_index.clone(),
            tx_index: chain.tx_index.clone(),
            address_tx_index: chain.address_tx_index.clone(),
            blocks_with_txs: chain.blocks_with_txs.clone(),
            expected_genesis_hash: chain.expected_genesis_hash.clone(),
            // A candidata NÃO possui o disco: só a vencedora escreve.
            store: None,
            ..Default::default()
        };
        // O estado precisa voltar junto: reconstruímos da âncora, como o reorg faz.
        let mut s = c.base_state.clone().expect("âncora");
        for i in 0..manter {
            let b = c.tail[i].clone();
            c.apply_block_to(&mut s, &b).expect("re-execução");
        }
        c.state = s;
        c
    }

    #[test]
    fn o_reorg_nao_pode_reverter_abaixo_do_produtor_estrito() {
        if STRICT_PRODUCER_HEIGHT == 0 { return; }
        let cs = carteiras();
        // Cadeia JÁ acima do fork tentando forquilhar ABAIXO dele: é o cenário do
        // achado C1 — a janela de validação fraca é histórico congelado.
        //
        // A âncora fica na PRÓPRIA altura do fork porque a guarda só é alcançada
        // depois do teste de comprimento: um rival mais curto sai antes, por
        // "Manteve". Dois blocos bastam para o rival ser mais longo, e o conteúdo
        // deles é irrelevante — a guarda dispara antes de qualquer validação.
        let mut chain = cadeia(&cs, STRICT_PRODUCER_HEIGHT, 100);
        let enchimento = chain.head().expect("cabeça").clone();
        let erro = chain
            .reorg(
                STRICT_PRODUCER_HEIGHT as i64 - 1,
                vec![enchimento.clone(), enchimento],
                agora(101),
            )
            .expect_err("deveria rejeitar");
        assert!(erro.contains("histórico finalizado"), "erro foi: {erro}");
    }

    #[test]
    fn ponto_de_fork_fora_da_cadeia_e_recusado() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        assert_eq!(chain.reorg(-1, Vec::new(), agora(101)), Err("ponto de fork inválido".into()));
        assert_eq!(
            chain.reorg(chain.height() + 1, Vec::new(), agora(101)),
            Err("ponto de fork inválido".into())
        );
    }

    // ------------------------------------------------------------ encadeamento

    #[test]
    fn altura_e_pai_tem_de_encadear() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let bloco = proximo(&chain, &cs, 101);

        let mut pai_errado = bloco.clone();
        pai_errado.previous_hash = "f".repeat(64);
        let payload = block_payload(&pai_errado);
        pai_errado.hash =
            block_hash(&payload, &pai_errado.signature, &pai_errado.pq_signature, pai_errado.height);
        let erro = chain.add_block(pai_errado, agora(101)).expect_err("deveria rejeitar");
        // A assinatura cobre o payload ANTIGO, então ela cai antes do encadeamento —
        // registrar isso importa: a ORDEM das checagens decide a mensagem.
        assert_eq!(erro, "assinatura híbrida do produtor inválida");

        // Pulo de altura, com o bloco reassinado para chegar íntegro na cadeia.
        let dono = chain.expected_producer(ts_do_slot(101)).expect("ok").expect("dono");
        let carteira = cs.iter().find(|c| c.endereco() == dono).expect("carteira");
        let cabeca = chain.head().expect("cabeça").clone();
        let pulado = build_block(
            carteira,
            BuildParams {
                height: cabeca.height + 5,
                previous_hash: cabeca.hash.clone(),
                timestamp: ts_do_slot(101),
                transactions: Vec::new(),
                state_root: Some("a".repeat(64)),
                producer_account: None,
                omit_public_keys: false,
            },
        )
        .expect("bloco");
        let erro = chain.add_block(pulado, agora(101)).expect_err("deveria rejeitar");
        assert!(erro.starts_with("altura inválida"), "erro foi: {erro}");
    }

    #[test]
    fn produce_block_so_funciona_no_proprio_slot() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let dono = chain.expected_producer(ts_do_slot(101)).expect("ok").expect("dono");
        let certa = cs.iter().find(|c| c.endereco() == dono).expect("carteira do slot");
        let errada = cs.iter().find(|c| c.endereco() != dono).expect("outra");

        let erro = chain
            .produce_block(errada, Vec::new(), ts_do_slot(101), None, agora(101))
            .expect_err("deveria rejeitar");
        assert!(erro.starts_with("slot pertence a"), "erro foi: {erro}");

        let bloco = chain
            .produce_block(certa, Vec::new(), ts_do_slot(101), None, agora(101))
            .expect("produção");
        assert_eq!(chain.height(), ALTURA as i64 + 1);
        assert_eq!(chain.head().expect("cabeça").hash, bloco.hash);
        // A raiz commitada pelo produtor é a que a validação recomputa — se as duas
        // rotas divergissem, o produtor emitiria blocos que a rede rejeita.
        let raiz = compute_state_root(&chain.state.state_leaves().expect("folhas"));
        assert_eq!(bloco.state_root.as_deref(), Some(raiz.as_str()));
    }

    #[test]
    fn a_recompensa_sofre_halving_e_zera_no_teto() {
        let chain = Blockchain::new();
        let s = State::new();
        assert_eq!(chain.block_reward(0, &s).expect("ok"), BLOCK_REWARD);
        assert_eq!(
            chain.block_reward(HALVING_INTERVAL_BLOCKS, &s).expect("ok"),
            BLOCK_REWARD / 2
        );
        assert_eq!(
            chain.block_reward(HALVING_INTERVAL_BLOCKS * 2, &s).expect("ok"),
            BLOCK_REWARD / 4
        );
        // O corte em 64 halvings existe também como proteção: deslocar 128 bits de
        // um u128 é pânico em debug, e pânico em consenso é DoS.
        assert_eq!(chain.block_reward(HALVING_INTERVAL_BLOCKS * 64, &s).expect("ok"), 0);
    }

    #[test]
    fn o_parametro_governavel_vence_a_constante() {
        let cs = carteiras();
        let mut s = estado_validadores(&cs);
        let chain = Blockchain::new();
        s.params.insert("BLOCK_REWARD".into(), "7".into());
        assert_eq!(chain.block_reward(0, &s).expect("ok"), 7);
        // Um mínimo de stake acima do que todos têm esvazia o conjunto ativo.
        s.params.insert("MIN_VALIDATOR_STAKE".into(), (MIN_VALIDATOR_STAKE * 100).to_string());
        assert!(validators(&s).expect("ok").is_empty());
    }

    #[test]
    fn o_unbonding_maduro_volta_ao_saldo_no_tick() {
        let cs = carteiras();
        let mut s = estado_validadores(&cs);
        let dono = cs[0].endereco();
        s.unbonding.push((dono.clone(), 500, ALTURA));
        s.unbonding.push((dono.clone(), 700, ALTURA + 10));
        block_tick(&mut s, ALTURA).expect("tick");
        assert_eq!(s.balance_of(&dono), 500, "só o maduro volta");
        assert_eq!(s.unbonding.len(), 1, "o que ainda não venceu permanece na fila");
    }

    #[test]
    fn a_comissao_agendada_entra_em_vigor_no_tick() {
        let cs = carteiras();
        let mut s = estado_validadores(&cs);
        let dono = cs[0].endereco();
        s.pending_commission.insert(dono.clone(), (33, ALTURA));
        block_tick(&mut s, ALTURA - 1).expect("tick");
        assert_eq!(s.commission.get(&dono), None, "antes da altura, nada muda");
        block_tick(&mut s, ALTURA).expect("tick");
        assert_eq!(s.commission.get(&dono).copied(), Some(33));
        assert!(s.pending_commission.is_empty());
    }

    #[test]
    fn a_finalidade_bft_exige_validadores_suficientes() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        // Cadeia curta: nenhum quórum de produtores distintos foi atingido.
        assert_eq!(chain.finalized_height().expect("ok"), -1);

        // Com menos validadores que o mínimo, a finalidade fica desligada de vez.
        chain.state = State::new();
        assert_eq!(chain.finalized_height().expect("ok"), -1);
    }

    #[test]
    fn producer_account_exige_witness_registrado_no_estado() {
        // Acima de PERMISSIONS_V2_HEIGHT a produção pode ser delegada — mas só se a
        // conta REALMENTE registrou a chave assinante como `witness`. Sem essa
        // conferência (que é de ESTADO, e por isso mora aqui e não na integridade),
        // qualquer chave reivindicaria o slot de qualquer conta.
        let cs = carteiras();
        let mut chain = cadeia(&cs, PERMISSIONS_V2_HEIGHT + 10, 100);
        let dono = chain.expected_producer(ts_do_slot(101)).expect("ok").expect("dono");
        let chave = cs.iter().find(|c| c.endereco() != dono).expect("outra carteira");
        let cabeca = chain.head().expect("cabeça").clone();
        let mut sim = chain.state.clone();
        let esboco = Block {
            height: cabeca.height + 1,
            timestamp: ts_do_slot(101),
            previous_hash: cabeca.hash.clone(),
            producer: chave.endereco(),
            producer_account: Some(dono.clone()),
            transactions: Vec::new(),
            ..cabeca.clone()
        };
        chain.simulate(&mut sim, &esboco, &mut Vec::new()).expect("simulação");
        let raiz = compute_state_root(&sim.state_leaves().expect("folhas"));
        let bloco = build_block(
            chave,
            BuildParams {
                height: cabeca.height + 1,
                previous_hash: cabeca.hash.clone(),
                timestamp: ts_do_slot(101),
                transactions: Vec::new(),
                state_root: Some(raiz),
                producer_account: Some(dono.clone()),
                omit_public_keys: false,
            },
        )
        .expect("bloco");
        assert_eq!(verify_block_integrity(&bloco), Ok(()));
        assert_eq!(
            chain.add_block(bloco, agora(101)),
            Err("assinante não é a chave witness registrada para a conta produtora".into())
        );
    }
    // ------------------------------------------------- leitura funda (RAM+disco)

    /// O caminho que a API serve: bloco que DESLIZOU da janela de RAM tem de
    /// voltar do disco IDÊNTICO — mesmo hash, mesma assinatura, mesmo payload.
    ///
    /// A expulsão usa `evict_oldest`, o MESMO código do `slide_tail` de produção
    /// (extraído exatamente para este teste não precisar de uma cópia); a única
    /// diferença é o gatilho: produção espera a janela encher (REORG_WINDOW+100
    /// blocos), o teste expulsa direto.
    #[test]
    fn bloco_expulso_da_janela_volta_do_disco_identico() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, 0, 0);

        // Store REAL em arquivo temporário próprio do teste.
        let arquivo = std::env::temp_dir().join(format!(
            "eav7-teste-leitura-funda-{}.jsonl",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&arquivo);
        chain.store = Some(crate::blockstore::BlockStore::new(&arquivo));

        // A âncora sintética da `cadeia()` não passou pelo `add_block`, então o
        // disco ainda não a tem; os blocos REAIS adicionados abaixo são gravados
        // pelo próprio `add_block` (persiste ANTES de expulsar — a ordem que o
        // comentário de produção exige).
        for slot in 1..=3 {
            let b = proximo(&chain, &cs, slot);
            chain.add_block(b, agora(slot)).expect("bloco válido");
        }
        let original = chain.tail[1].clone(); // altura 1, o primeiro gravado em disco

        // Expulsa a âncora (altura 0, sem linha no disco) e depois a altura 1.
        assert!(chain.evict_oldest(), "expulsão da âncora");
        assert!(chain.evict_oldest(), "expulsão da altura 1");
        assert_eq!(chain.tail_start, 2);
        assert!(chain.get_block(1).is_none(), "a janela de RAM não enxerga mais");

        // O store indexa por POSIÇÃO DE LINHA, e a âncora sintética não está no
        // arquivo: linha 0 = altura 1. O boot real nunca tem esse deslocamento
        // (a gênese é a linha 0); aqui ele existiria — então o teste consulta o
        // store direto pela linha e o `block_at` pela faixa que o índice cobre.
        let store = chain.store.as_ref().expect("store");
        let v = store.get_json(0).expect("linha legível").expect("linha 0 existe");
        let relido = crate::block::block_from_json(&v).expect("bloco reconstrói");
        assert_eq!(relido, original, "o bloco tem de voltar do disco IDÊNTICO");

        // E a leitura funda via cadeia: dentro da janela continua servida da RAM.
        let da_ram = chain.block_at(2).expect("sem erro").expect("altura 2 na janela");
        assert_eq!(da_ram.height, 2);

        let _ = std::fs::remove_file(&arquivo);
    }
    /// O boot do disco reconstrói a MESMA cadeia: replay completo da referência.
    /// E o rabo inválido (bloco que não aplica) é descartado com truncamento —
    /// prefixo válido fica, o nó re-sincroniza o resto da rede.
    #[test]
    fn boot_do_disco_reconstroi_e_descarta_rabo_invalido() {
        let cs = carteiras();
        let arquivo = std::env::temp_dir().join(format!(
            "eav7-teste-boot-{}.jsonl",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&arquivo);

        // Cadeia REAL nascida da gênese (não a âncora sintética): o replay começa
        // no `adopt_genesis`, então o arquivo precisa nascer lá também.
        let produtora = &cs[0];
        let mut origem = Blockchain::new();
        use crate::transaction::JsonValue;
        let (supply, stake) = (crate::config::GENESIS_SUPPLY, crate::config::GENESIS_STAKE);
        let genese = crate::block::build_genesis_block(
            ts_do_slot(1), // slot 1: timestamp 0 é inválido por regra de integridade
            JsonValue::map([
                ("balances".to_string(), JsonValue::map([
                    (produtora.endereco(), JsonValue::Str((supply - stake).to_string())),
                ])),
                ("stakes".to_string(), JsonValue::map([
                    (produtora.endereco(), JsonValue::Str(stake.to_string())),
                ])),
                ("bridgeRelayers".to_string(),
                 JsonValue::List(vec![JsonValue::Str(produtora.endereco())])),
            ]),
        );
        origem.adopt_genesis(genese).expect("adota");
        origem.store = Some(crate::blockstore::BlockStore::new(&arquivo));
        // A gênese entrou antes do store: grava a linha 0 manualmente, como o
        // `adoptGenesis` da referência faz com `store.reset([block])`.
        origem
            .store
            .as_mut()
            .expect("store")
            .append(&crate::block::block_to_json_line(&origem.tail[0]).expect("linha"))
            .expect("linha 0");
        for slot in 2..=4 {
            let b = proximo(&origem, &cs, slot);
            origem.add_block(b, agora(slot)).expect("bloco válido");
        }

        // Boot: uma cadeia NOVA, do mesmo arquivo.
        let mut boot = Blockchain::new();
        let descartados = boot
            .load_from_disk(crate::blockstore::BlockStore::new(&arquivo), agora(5))
            .expect("boot");
        assert_eq!(descartados, 0);
        assert_eq!(boot.height(), origem.height());
        assert_eq!(boot.head().map(|b| &b.hash), origem.head().map(|b| &b.hash));
        // A comparação de CONSENSO: mesma raiz de estado == mesmo estado. É mais
        // forte que um `==` de struct — é a igualdade que a rede confere.
        let raiz = |st: &State| {
            crate::stateroot::compute_state_root(&st.state_leaves().expect("folhas"))
        };
        assert_eq!(raiz(&boot.state), raiz(&origem.state), "o replay tem de chegar ao MESMO estado");

        // Rabo inválido: um bloco de altura errada (JSON legível, não aplica).
        {
            let mut lixo = origem.tail.last().expect("cabeça").clone();
            lixo.height += 7; // fura a contiguidade
            let mut store = crate::blockstore::BlockStore::new(&arquivo);
            store.scan(0, |_, _| true).expect("reindexa");
            store.append(&crate::block::block_to_json_line(&lixo).expect("linha")).expect("append");
        }
        let mut boot2 = Blockchain::new();
        let descartados = boot2
            .load_from_disk(crate::blockstore::BlockStore::new(&arquivo), agora(6))
            .expect("boot tolerante a 1 bloco no rabo");
        assert_eq!(descartados, 1, "o rabo inválido é descartado, não fatal");
        assert_eq!(boot2.height(), origem.height(), "o prefixo válido permanece");
        // E o TERCEIRO boot confirma que o truncamento persistiu no arquivo.
        let mut boot3 = Blockchain::new();
        assert_eq!(
            boot3.load_from_disk(crate::blockstore::BlockStore::new(&arquivo), agora(7)).expect("boot"),
            0,
            "depois do truncamento o arquivo está íntegro"
        );

        // Rabo GRANDE inválido: sem force, o boot ABORTA e o arquivo não muda.
        {
            let mut store = crate::blockstore::BlockStore::new(&arquivo);
            store.scan(0, |_, _| true).expect("reindexa");
            for bump in 1..=5 {
                let mut lixo = origem.tail.last().expect("cabeça").clone();
                lixo.height = lixo.height.checked_add(bump).expect("altura cabe em u64");
                store
                    .append(&crate::block::block_to_json_line(&lixo).expect("linha"))
                    .expect("append");
            }
        }
        let mut boot_safe = Blockchain::new();
        let err = boot_safe
            .load_from_disk(crate::blockstore::BlockStore::new(&arquivo), agora(8))
            .expect_err("tem de abortar sem truncar");
        assert!(
            err.contains("boot abortado") && err.contains("NÃO foram descartados"),
            "erro foi: {err}"
        );
        // Com force: descarta após backup.
        let mut boot_force = Blockchain::new();
        let n = boot_force
            .load_from_disk_with(
                crate::blockstore::BlockStore::new(&arquivo),
                agora(9),
                LoadFromDiskOpts::force_discard_tail(),
            )
            .expect("force discard");
        assert!(n >= 5, "descartou o rabo grande ({n})");
        assert_eq!(boot_force.height(), origem.height());

        let _ = std::fs::remove_file(&arquivo);
    }
    /// A âncora nasce da GÊNESE, não de um estado vazio.
    ///
    /// Este é o caso que o arranjo dos testes escondia: `cadeia_saldo` monta toda
    /// cadeia de teste com `base_state` JÁ preenchido, então a expulsão nunca via
    /// âncora ausente. Numa cadeia real ela está ausente exatamente uma vez — na
    /// PRIMEIRA vez que a janela desliza, com `tail_start` ainda em 0.
    ///
    /// O código antigo fazia `unwrap_or_default()` ali e aplicava o bloco 0 a um
    /// estado VAZIO. As alocações da gênese não são transações, então a âncora
    /// perdia saldo, stake e tesouro inteiros — e como ela só é lida num reorg, o
    /// erro dormia até a rede reorganizar.
    ///
    /// Em produção isto apareceu como uma expulsão que falhou 1.268 blocos depois,
    /// numa transação que precisava do stake da gênese para pagar a energia.
    #[test]
    fn ancora_da_primeira_expulsao_preserva_as_alocacoes_da_genese() {
        use crate::transaction::JsonValue;
        let cs = carteiras();
        let (supply, stake) = (crate::config::GENESIS_SUPPLY, crate::config::GENESIS_STAKE);
        let produtora = &cs[0];
        let mut chain = Blockchain::new();
        let genese = crate::block::build_genesis_block(
            ts_do_slot(1),
            JsonValue::map([
                ("balances".to_string(), JsonValue::map([(
                    produtora.endereco(), JsonValue::Str((supply - stake).to_string()),
                )])),
                ("stakes".to_string(), JsonValue::map([(
                    produtora.endereco(), JsonValue::Str(stake.to_string()),
                )])),
            ]),
        );
        chain.adopt_genesis(genese).expect("adota a gênese");
        assert_eq!(chain.tail_start, 0);
        assert!(chain.base_state.is_none(), "a gênese nasce SEM âncora — é o caso do bug");

        for slot in 2..=4 {
            let b = proximo(&chain, &cs, slot);
            chain.add_block(b, agora(slot)).expect("bloco válido");
        }

        // Expulsa o gênese: a âncora que sai é a ALOCAÇÃO, não "vazio + bloco 0".
        assert!(chain.evict_oldest(), "expulsão do gênese");
        let ancora = chain.base_state.as_ref().expect("âncora depois de expulsar o gênese");
        let conta = ancora.accounts.get(&produtora.endereco()).expect("conta da gênese na âncora");
        assert_eq!(conta.staked, stake, "o stake da gênese sumiria com o estado vazio");
        assert_eq!(conta.balance, supply - stake, "o saldo da gênese sumiria junto");

        // E a INVARIANTE: âncora + blocos da janela == estado corrente. É ela que o
        // reorg depende, e era ela que quebrava em silêncio.
        let mut rebuild = ancora.clone();
        for i in 0..chain.tail.len() {
            let b = chain.tail[i].clone();
            chain.apply_block_to(&mut rebuild, &b).expect("reaplica bloco da janela");
        }
        assert_eq!(
            compute_state_root(&rebuild.state_leaves().expect("folhas")),
            compute_state_root(&chain.state.state_leaves().expect("folhas")),
            "âncora + janela tem de dar a MESMA raiz do estado corrente",
        );
    }

    /// G3: vetores de CICLO DE VIDA (`vectors/lifecycle.json`) — gênese → expulsão
    /// → âncora → reorg → replay, contra o nó de REFERÊNCIA.
    ///
    /// O teste acima prova a invariante DENTRO deste cliente; este prova que os
    /// DOIS clientes concordam nos números: o hash e a raiz da gênese, a raiz após
    /// cada bloco da janela, a âncora após cada expulsão (a primeira é o caso do
    /// bug), o estado reconstruído no ponto de fork, a raiz após o rabo rival e o
    /// replay completo da cadeia adotada.
    ///
    /// Os blocos do vetor NÃO são blocos de consenso (assinatura e hash são
    /// marcadores fixos — é o que torna o gerador determinístico). O que se
    /// exercita aqui é `evict_oldest` e `apply_block_to` REAIS: exatamente o
    /// código que a âncora do slide e o rebuild do reorg usam em produção, e que
    /// ignora assinaturas por definição (blocos já validados).
    ///
    /// Regerar:  use frozen vectors/ fixtures
    #[test]
    fn vetores_de_ciclo_de_vida_batem_com_a_referencia() {
        use crate::transaction::parse_json;

        fn campo<'a>(v: &'a JsonValue, chave: &str) -> &'a JsonValue {
            match v {
                JsonValue::Map(m) => {
                    m.get(chave).unwrap_or_else(|| panic!("campo {chave} ausente no vetor"))
                }
                _ => panic!("esperava um mapa com o campo {chave}"),
            }
        }
        fn texto<'a>(v: &'a JsonValue, chave: &str) -> &'a str {
            match campo(v, chave) {
                JsonValue::Str(s) => s.as_str(),
                _ => panic!("campo {chave} não é texto"),
            }
        }
        fn lista<'a>(v: &'a JsonValue, chave: &str) -> &'a [JsonValue] {
            match campo(v, chave) {
                JsonValue::List(l) => l.as_slice(),
                _ => panic!("campo {chave} não é lista"),
            }
        }
        fn inteiro(v: &JsonValue, chave: &str) -> u64 {
            match campo(v, chave) {
                JsonValue::Int(n) => u64::try_from(*n).expect("inteiro do vetor"),
                _ => panic!("campo {chave} não é inteiro"),
            }
        }

        let caminho = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("raiz do repositório")
            .join("vectors")
            .join("lifecycle.json");
        let bruto = std::fs::read_to_string(&caminho).unwrap_or_else(|e| {
            panic!(
                "não consegui ler {}: {e}\nrode: use frozen vectors/ fixtures",
                caminho.display()
            )
        });
        let v = parse_json(&bruto).expect("lifecycle.json é JSON válido");

        // Como no replay: o modo de fork do binário TEM de casar com o do vetor —
        // divergência é incompatibilidade de ambiente, não bug.
        let genese_ativo = matches!(campo(&v, "genesisActive"), JsonValue::Bool(true));
        if genese_ativo != crate::config::GENESIS_ACTIVE_BUILD {
            eprintln!(
                "PULADO: lifecycle.json foi gerado {} gênese-ativo e este binário foi compilado {}.\n         Regenere com o mesmo modo: use frozen vectors/ fixtures",
                if genese_ativo { "COM" } else { "SEM" },
                if crate::config::GENESIS_ACTIVE_BUILD { "COM" } else { "SEM" },
            );
            return;
        }

        let raiz = |s: &State| compute_state_root(&s.state_leaves().expect("folhas"));

        // 1) GÊNESE pela porta real: valida integridade — logo, o próprio HASH do
        // bloco gênese da referência — e aplica as alocações.
        let genese = campo(&v, "genesis");
        let bloco_genese =
            crate::block::block_from_json(campo(genese, "block")).expect("gênese do vetor");
        let mut chain = Blockchain::new();
        chain.adopt_genesis(bloco_genese).expect("a gênese da referência tem de ser aceita");
        assert_eq!(
            raiz(&chain.state),
            texto(genese, "stateRoot"),
            "a raiz da ALOCAÇÃO da gênese diverge da referência"
        );

        // 2) JANELA: cada bloco entra pelo caminho da âncora/reorg
        // (`apply_block_to`) e a raiz é conferida POR ALTURA — o primeiro bloco
        // divergente é apontado, e `leavesAfter` no vetor diz o quê divergiu.
        let mut todos = Vec::new(); // cópia para o replay final (a janela desliza)
        for b_json in lista(&v, "blocks") {
            let b = crate::block::block_from_json(b_json).expect("bloco do vetor");
            let altura = b.height;
            let mut st = chain.state.clone();
            chain
                .apply_block_to(&mut st, &b)
                .unwrap_or_else(|e| panic!("bloco {altura} não aplica: {e}"));
            chain.state = st;
            todos.push(b.clone());
            chain.tail.push(b);
            assert_eq!(
                raiz(&chain.state),
                texto(b_json, "stateRootAfter"),
                "raiz na altura {altura} diverge da referência (compare com `leavesAfter` no vetor)"
            );
        }
        assert_eq!(raiz(&chain.state), texto(&v, "headRoot"), "raiz da cabeça diverge");

        // 3) EXPULSÕES com o `evict_oldest` REAL. A primeira é o caso do bug: a
        // âncora nasce da ALOCAÇÃO da gênese, nunca de "estado vazio + bloco 0".
        for e in lista(&v, "evictions") {
            assert!(chain.evict_oldest(), "expulsão do bloco mais velho");
            assert_eq!(chain.tail_start, inteiro(e, "tailStart"));
            let ancora = chain.base_state.as_ref().expect("âncora depois de expulsar");
            assert_eq!(
                raiz(ancora),
                texto(e, "anchorRoot"),
                "âncora com tail_start={} diverge da referência",
                chain.tail_start,
            );
        }

        // 4) A INVARIANTE central do G3: âncora + blocos da janela == raiz corrente.
        let mut rebuild = chain.base_state.clone().expect("âncora");
        for b in &chain.tail {
            chain.apply_block_to(&mut rebuild, b).expect("reaplica bloco da janela");
        }
        assert_eq!(
            raiz(&rebuild),
            raiz(&chain.state),
            "âncora + janela tem de dar a MESMA raiz do estado corrente"
        );

        // 5) REORG: reconstrói o estado no ponto de fork — âncora + janela até o
        // comum, o MESMO caminho de `reorg` — e aplica o rabo rival por cima.
        let reorg = campo(&v, "reorg");
        let common = inteiro(reorg, "common");
        let mut fork = chain.base_state.clone().expect("âncora");
        let ate_o_comum = usize::try_from(common - chain.tail_start + 1).expect("fork na janela");
        for b in &chain.tail[..ate_o_comum] {
            chain.apply_block_to(&mut fork, b).expect("reconstrói até o comum");
        }
        assert_eq!(
            raiz(&fork),
            texto(reorg, "rootAtFork"),
            "o estado no ponto de fork diverge da referência"
        );
        let mut rivais = Vec::new();
        for b_json in lista(reorg, "rival") {
            let b = crate::block::block_from_json(b_json).expect("bloco rival do vetor");
            let altura = b.height;
            chain
                .apply_block_to(&mut fork, &b)
                .unwrap_or_else(|e| panic!("bloco rival {altura} não aplica: {e}"));
            assert_eq!(
                raiz(&fork),
                texto(b_json, "stateRootAfter"),
                "raiz rival na altura {altura} diverge da referência"
            );
            rivais.push(b);
        }
        assert_eq!(raiz(&fork), texto(reorg, "rootAfterReorg"), "raiz pós-reorg diverge");

        // 6) REPLAY da cadeia ADOTADA de um estado NOVO (gênese + 1..comum + rival):
        // o caminho independente tem de chegar à mesma raiz do rebuild via âncora.
        let mut replay = State::new();
        apply_genesis(&mut replay, campo(campo(genese, "block"), "genesis"))
            .expect("alocações da gênese");
        for b in todos.iter().filter(|b| b.height <= common) {
            chain.apply_block_to(&mut replay, b).expect("replay do prefixo comum");
        }
        for b in &rivais {
            chain.apply_block_to(&mut replay, b).expect("replay do rabo rival");
        }
        assert_eq!(
            raiz(&replay),
            texto(reorg, "rootAfterReorg"),
            "o replay completo da cadeia adotada tem de chegar à MESMA raiz do reorg"
        );
    }

    /// A classe de bug que o nó B expôs em rede real: cadeia adotada por
    /// reorg/sync existia SÓ em RAM — o disco ficava vazio e o reboot voltava
    /// do zero. O reorg agora persiste (trunca no fork + re-appenda o rabo,
    /// blockchain.js:507-510); este teste faz o ciclo completo: reorg → boot
    /// novo do MESMO arquivo → a cadeia adotada tem de voltar.
    #[test]
    fn reorg_persiste_no_disco_e_o_boot_le_a_cadeia_adotada() {
        let cs = carteiras();
        let arquivo = std::env::temp_dir().join(format!(
            "eav7-teste-reorg-disco-{}.jsonl",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&arquivo);

        // Cadeia real nascida da gênese, com store desde o início (o
        // adopt_genesis grava a linha 0 sozinho — é o que este teste também
        // acaba provando).
        use crate::transaction::JsonValue;
        let (supply, stake) = (crate::config::GENESIS_SUPPLY, crate::config::GENESIS_STAKE);
        let produtora = &cs[0];
        let mut chain = Blockchain::new();
        chain.store = Some(crate::blockstore::BlockStore::new(&arquivo));
        let genese = crate::block::build_genesis_block(
            ts_do_slot(1),
            JsonValue::map([
                ("balances".to_string(), JsonValue::map([(
                    produtora.endereco(), JsonValue::Str((supply - stake).to_string()),
                )])),
                ("stakes".to_string(), JsonValue::map([(
                    produtora.endereco(), JsonValue::Str(stake.to_string()),
                )])),
            ]),
        );
        chain.adopt_genesis(genese).expect("adota e persiste a linha 0");
        for slot in 2..=4 {
            let b = proximo(&chain, &cs, slot);
            chain.add_block(b, agora(slot)).expect("bloco válido");
        }

        // Rabo rival: mesmo ancestral (altura 1), MAIS LONGO (slots à frente),
        // construído pelo caminho real (`rabo` espelha a cadeia e produz).
        let mut encurtada = Blockchain::new();
        encurtada.tail = chain.tail[..2].to_vec(); // gênese + altura 1
        encurtada.tail_start = 0;
        encurtada.hashes = chain.hashes.iter().filter(|(h, _)| **h <= 1).map(|(h, v)| (*h, v.clone())).collect();
        encurtada.hash_index = chain.hash_index.clone();
        let mut st = State::new();
        crate::blockchain::apply_genesis(&mut st, chain.tail[0].genesis.as_ref().expect("gênese")).expect("estado 0");
        encurtada.apply_block_to(&mut st, &chain.tail[1]).expect("altura 1");
        encurtada.state = st;
        let rival = rabo(&encurtada, &cs, 5, 4); // alturas 2..=5, slots diferentes

        let adotada_cabeca = rival.last().expect("rabo").hash.clone();
        match chain.reorg(1, rival, agora(9)).expect("reorg") {
            Reorg::Adotou(_) => {}
            Reorg::Manteve => panic!("o rabo rival é mais longo; tinha de ser adotado"),
        }
        assert_eq!(chain.head().expect("cabeça").hash, adotada_cabeca);

        // O ciclo que faltava: um BOOT NOVO do mesmo arquivo vê a cadeia ADOTADA.
        let mut boot = Blockchain::new();
        let descartados = boot
            .load_from_disk(crate::blockstore::BlockStore::new(&arquivo), agora(10))
            .expect("boot");
        assert_eq!(descartados, 0, "o arquivo pós-reorg tem de estar íntegro");
        assert_eq!(boot.height(), chain.height());
        assert_eq!(
            boot.head().expect("cabeça").hash,
            adotada_cabeca,
            "o disco tem de conter a cadeia ADOTADA, não a descartada"
        );

        let _ = std::fs::remove_file(&arquivo);
    }
    /// EIP-2935 nos DOIS caminhos de aplicação: `simulate` (add_block/produção) e
    /// `apply_block_to` (âncora do slide, rebuild de reorg) têm de produzir estado
    /// IDÊNTICO — inclusive o anel de hashes. A referência tinha o registro só no
    /// primeiro; um reorg acima de EAVM_OSAKA_HEIGHT reconstruiria estado sem o
    /// anel e a raiz divergiria de quem nunca reorganizou. Corrigido nos dois
    /// clientes; este teste trava a equivalência.
    #[test]
    fn anel_de_blockhash_e_gravado_igual_nos_dois_caminhos_de_aplicacao() {
        let cs = carteiras();
        const OSAKA: u64 = crate::blockchain::EAVM_OSAKA_HEIGHT;
        // Âncora exatamente na altura do fork: o PRÓXIMO bloco já grava o anel.
        let chain = cadeia(&cs, OSAKA, 10);
        let bloco = proximo(&chain, &cs, 11);

        // Caminho 1: simulate (o que o add_block usa).
        let mut via_simulate = chain.state.clone();
        chain.simulate(&mut via_simulate, &bloco, &mut Vec::new()).expect("simulate");

        // Caminho 2: apply_block_to (âncora/reorg).
        let mut via_apply = chain.state.clone();
        chain.apply_block_to(&mut via_apply, &bloco).expect("apply");

        let raiz = |st: &State| {
            crate::stateroot::compute_state_root(&st.state_leaves().expect("folhas"))
        };
        assert_eq!(raiz(&via_simulate), raiz(&via_apply), "os dois caminhos têm de coincidir");

        // E o anel foi de fato gravado: o slot (altura do pai % HISTORY) contém o
        // hash do pai. A folha ctr do endereço de sistema existe nos dois.
        let pai = bloco.height - 1;
        let slot = format!("0x{:x}", pai % crate::config::BLOCKHASH_HISTORY);
        let contrato = via_apply
            .contracts
            .get(crate::state::contracts::BLOCKHASH_HISTORY_ADDR)
            .expect("contrato do anel materializado");
        assert!(
            contrato.storage.contains_key(&slot),
            "o hash do pai tem de estar no slot {slot} do anel"
        );
    }
    /// Falha ao PERSISTIR rejeita o bloco inteiro — memória e disco nunca divergem.
    ///
    /// A ordem anterior commitava `state` e os índices ANTES do append: um erro de
    /// I/O devolvia `Err` deixando estado e índices à frente de `tail`/`head`. O
    /// `add_block` seguinte validaria contra um estado que já inclui um bloco que a
    /// cadeia não tem, e o boot leria uma cadeia mais curta que o estado. A
    /// referência inverteu essa ordem depois de um incidente de produção
    /// (blockchain.js:248-250); aqui o teste trava a invariante.
    ///
    /// O disco é sabotado apontando o store para um caminho IMPOSSÍVEL de abrir
    /// (um "diretório" que na verdade é arquivo), que é o que um disco cheio ou
    /// permissão perdida produzem.
    #[test]
    fn falha_ao_persistir_rejeita_o_bloco_e_nao_suja_a_memoria() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, 0, 0);

        // Um ARQUIVO onde o store espera um diretório: todo `append` falha.
        let obstaculo = std::env::temp_dir().join(format!("eav7-obstaculo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&obstaculo);
        std::fs::write(&obstaculo, b"nao sou um diretorio").expect("cria o obstáculo");
        chain.store = Some(crate::blockstore::BlockStore::new(obstaculo.join("blocks.jsonl")));

        let antes_altura = chain.height();
        let antes_raiz =
            crate::stateroot::compute_state_root(&chain.state.state_leaves().expect("folhas"));
        let antes_tx = chain.tx_index.len();

        let bloco = proximo(&chain, &cs, 1);
        let erro = chain.add_block(bloco, agora(1)).expect_err("o append tem de falhar");
        assert!(erro.contains("persistir"), "a mensagem deve citar a persistência: {erro}");

        // NADA pode ter mudado.
        assert_eq!(chain.height(), antes_altura, "a altura não pode avançar");
        assert_eq!(
            crate::stateroot::compute_state_root(&chain.state.state_leaves().expect("folhas")),
            antes_raiz,
            "o estado não pode avançar sem o disco"
        );
        assert_eq!(chain.tx_index.len(), antes_tx, "os índices não podem avançar");

        let _ = std::fs::remove_file(&obstaculo);
    }
    /// Plano 17 / T2.3: top 51 ativas; posições 52–101 no banco.
    #[test]
    fn validator_bank_corta_apos_ativas() {
        let mut st = State::new();
        // 60 elegíveis com stake decrescente → 51 ativas + 9 no banco.
        for i in 0..60u32 {
            let addr = format!("E7{:0>32}", i);
            let stake = MIN_VALIDATOR_STAKE * (100 - u128::from(i));
            st.accounts.insert(addr, Account { staked: stake, ..Default::default() });
        }
        let ativos = validators(&st).expect("ativas");
        assert_eq!(ativos.len(), MAX_VALIDATORS);
        let banco = validator_bank(&st).expect("banco");
        assert_eq!(banco.len(), 9);
        // Continuação do ranking: a 1ª do banco é a 52ª global.
        assert!(
            ativos.last().unwrap().staked > banco[0].staked
                || (ativos.last().unwrap().staked == banco[0].staked
                    && ativos.last().unwrap().address < banco[0].address),
            "banco começa depois do corte das ativas"
        );
        // Sem overlap de endereço.
        let set: std::collections::BTreeSet<_> = ativos.iter().map(|v| &v.address).collect();
        for v in &banco {
            assert!(!set.contains(&v.address));
        }
    }

    /// Vesting semeado no gênese (plano 21 / T6.1): entra na folha e cliff bloqueia claim.
    #[test]
    fn genese_carrega_vesting_com_cliff() {
        use crate::transaction::JsonValue;

        let mut st = State::new();
        apply_genesis(
            &mut st,
            &JsonValue::map([(
                "vesting".to_string(),
                JsonValue::List(vec![JsonValue::map([
                    ("id".to_string(), JsonValue::Str("team-1".into())),
                    ("beneficiary".to_string(), JsonValue::Str("E7BENEF".into())),
                    ("total".to_string(), JsonValue::Str("1000000000".into())),
                    ("cliff".to_string(), JsonValue::Int(31_536_000)),
                    ("duration".to_string(), JsonValue::Int(63_072_000)),
                ])]),
            )]),
        )
        .expect("gênese com vesting");

        let v = st.vesting.get("team-1").expect("linha vesting");
        assert_eq!(v.beneficiary, "E7BENEF");
        assert_eq!(v.total, 1_000_000_000);
        assert_eq!(v.cliff, 31_536_000);
        assert_eq!(v.duration, 63_072_000);
        assert_eq!(v.vested(0).expect("vested"), 0, "antes do cliff nada vence");
        assert_eq!(v.vested(31_535_999).expect("vested"), 0);
        assert!(v.vested(31_536_000).expect("vested") > 0);
    }

    /// A gênese carrega os COMITÊS de origem da ponte — sem eles, toda prova de
    /// comitê falha e (com o fork da raiz em 0) o bloco 1 já não fecha.
    ///
    /// Trava também a normalização, que é do JS e entra na folha: chave em
    /// MAIÚSCULAS, membros em minúsculas, `quorum`/`epoch` ausentes viram 0.
    #[test]
    fn genese_carrega_os_comites_da_ponte_normalizados() {
        use crate::transaction::JsonValue;

        let mut st = State::new();
        apply_genesis(
            &mut st,
            &JsonValue::map([(
                "bridgeSourceCommittees".to_string(),
                JsonValue::map([(
                    // minúscula na entrada: a chave tem de subir para maiúscula.
                    "tron".to_string(),
                    JsonValue::map([
                        (
                            "members".to_string(),
                            JsonValue::List(vec![
                                // maiúscula na entrada: os membros têm de descer.
                                JsonValue::Str("0xAABB".into()),
                                JsonValue::Str("0xccdd".into()),
                            ]),
                        ),
                        ("quorum".to_string(), JsonValue::Int(2)),
                        // `epoch` AUSENTE de propósito: tem de virar 0, não erro.
                    ]),
                )]),
            )]),
        )
        .expect("gênese com comitês");

        let c = st.bridge_source_committees.get("TRON").expect("comitê sob a chave MAIÚSCULA");
        assert_eq!(c.source_chain, "TRON");
        assert_eq!(c.members, vec!["0xaabb".to_string(), "0xccdd".to_string()]);
        assert_eq!(c.quorum, 2);
        assert_eq!(c.epoch, 0, "epoch ausente vale 0");
    }

    // ------------------------------------------- recibos e eventos (node-local)

    /// Runtime que emite um `LOG1` e para. Pilha do LOG1: tópico, tamanho, offset.
    const RUNTIME_EMITE_LOG: &[u8] = &[
        0x7f, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa,
        0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa,
        0xaa, 0xaa, 0xaa, // PUSH32 <tópico>
        0x60, 0x00, // PUSH1 0  (tamanho do data)
        0x60, 0x00, // PUSH1 0  (offset)
        0xa1, // LOG1
        0x00, // STOP
    ];

    /// Runtime que REVERTE sempre: `PUSH1 0; PUSH1 0; REVERT`.
    const RUNTIME_REVERTE: &[u8] = &[0x60, 0x00, 0x60, 0x00, 0xfd];

    fn cadeia_com_saldo(cs: &[Carteira], altura: u64, slot: i64) -> Blockchain {
        cadeia_saldo(cs, altura, slot, 1_000 * crate::config::UNIT)
    }

    /// O recibo de DEPLOY carrega o endereço do contrato criado.
    ///
    /// É como toda ferramenta (ethers, Hardhat) descobre onde o contrato foi
    /// parar: sem isto, `eth_getTransactionReceipt` devolve `contractAddress:
    /// null` e todo `tx.wait()` de deploy quebra.
    #[test]
    fn recibo_de_deploy_carrega_o_endereco_do_contrato() {
        let cs = carteiras();
        let mut chain = cadeia_com_saldo(&cs, ALTURA, 100);
        let tx = tx_eavm(
            &cs[0],
            "EAVM_DEPLOY",
            1,
            vec![("code", JsonValue::str(deploy_de(RUNTIME_EMITE_LOG)))],
        );
        let id = tx.id.clone().expect("id");
        let bloco = proximo_com(&chain, &cs, 101, vec![tx]);
        chain.add_block(bloco, agora(101)).expect("bloco com deploy");

        let r = chain.receipts.get(&id).expect("deploy tem de deixar recibo");
        assert!(r.success, "o deploy foi bem-sucedido");
        assert_eq!(r.block_height, ALTURA + 1);
        let endereco = r.contract.as_deref().expect("deploy carrega o endereço criado");
        assert!(endereco.starts_with("0x") && endereco.len() == 42, "endereço 0x: {endereco}");
    }

    /// Chamada que REVERTE não pode sair como sucesso.
    ///
    /// Ela continua sendo transação VÁLIDA — entra no bloco, paga taxa, avança o
    /// nonce —, mas a execução falhou. Sem o recibo, o RPC respondia `status: 0x1`
    /// para tudo, e a carteira mostrava sucesso para uma transação que não fez
    /// nada. É o motivo de este índice existir.
    #[test]
    fn chamada_revertida_nao_sai_como_sucesso() {
        let cs = carteiras();
        let mut chain = cadeia_com_saldo(&cs, ALTURA, 100);

        let deploy = tx_eavm(
            &cs[0],
            "EAVM_DEPLOY",
            1,
            vec![("code", JsonValue::str(deploy_de(RUNTIME_REVERTE)))],
        );
        let id_deploy = deploy.id.clone().expect("id");
        let bloco = proximo_com(&chain, &cs, 101, vec![deploy]);
        chain.add_block(bloco, agora(101)).expect("deploy");
        let alvo = chain.receipts[&id_deploy].contract.clone().expect("endereço do contrato");

        let chamada = tx_eavm(
            &cs[0],
            "EAVM_CALL",
            2,
            vec![("to", JsonValue::str(alvo)), ("input", JsonValue::str("0x"))],
        );
        let id_chamada = chamada.id.clone().expect("id");
        let bloco = proximo_com(&chain, &cs, 102, vec![chamada]);
        chain.add_block(bloco, agora(102)).expect("chamada");

        let r = chain.receipts.get(&id_chamada).expect("a chamada tem recibo");
        assert!(!r.success, "execução revertida NÃO pode constar como sucesso");
        assert!(r.contract.is_none(), "só o deploy carrega endereço de contrato");
        assert!(r.gas_used > 0, "reverter consome gás — e o recibo tem de dizer quanto");
    }

    /// Evento emitido por contrato entra no índice de logs — é o que alimenta
    /// `eth_getLogs`, que devolvia lista vazia para sempre.
    #[test]
    fn evento_de_contrato_entra_no_indice_de_logs() {
        let cs = carteiras();
        let mut chain = cadeia_com_saldo(&cs, ALTURA, 100);

        let deploy = tx_eavm(
            &cs[0],
            "EAVM_DEPLOY",
            1,
            vec![("code", JsonValue::str(deploy_de(RUNTIME_EMITE_LOG)))],
        );
        let id_deploy = deploy.id.clone().expect("id");
        let bloco = proximo_com(&chain, &cs, 101, vec![deploy]);
        chain.add_block(bloco, agora(101)).expect("deploy");
        let alvo = chain.receipts[&id_deploy].contract.clone().expect("endereço");
        // O deploy em si não executa o runtime — nenhum evento ainda.
        assert!(chain.log_index.is_empty(), "o construtor deste contrato não emite nada");

        let chamada = tx_eavm(
            &cs[0],
            "EAVM_CALL",
            2,
            vec![("to", JsonValue::str(alvo.clone())), ("input", JsonValue::str("0x"))],
        );
        let id_chamada = chamada.id.clone().expect("id");
        let bloco = proximo_com(&chain, &cs, 102, vec![chamada]);
        chain.add_block(bloco, agora(102)).expect("chamada");

        assert_eq!(chain.log_index.len(), 1, "um LOG1 emitido, um evento indexado");
        let e = &chain.log_index[0];
        assert_eq!(e.tx_id, id_chamada);
        assert_eq!(e.address, alvo, "o evento é do contrato que o emitiu");
        assert_eq!(e.block_height, ALTURA + 2);
        assert_eq!(e.topics.len(), 1, "LOG1 tem exatamente um tópico");
        assert_eq!(e.topics[0], format!("0x{}", "aa".repeat(32)));
    }

    /// Bloco RECUSADO não pode deixar recibo. Os recibos são coletados durante a
    /// simulação, que roda ANTES das checagens de consenso — gravá-los ali daria
    /// ao explorer uma transação "minerada" que nunca entrou em cadeia nenhuma.
    #[test]
    fn bloco_recusado_nao_deixa_recibo() {
        let cs = carteiras();
        let mut chain = cadeia_com_saldo(&cs, ALTURA, 100);
        let tx = tx_eavm(
            &cs[0],
            "EAVM_DEPLOY",
            1,
            vec![("code", JsonValue::str(deploy_de(RUNTIME_EMITE_LOG)))],
        );
        let mut bloco = proximo_com(&chain, &cs, 101, vec![tx]);
        // A raiz mente: o bloco é recusado DEPOIS de a simulação já ter produzido
        // o recibo.
        bloco.state_root = Some("f".repeat(64));
        assert!(chain.add_block(bloco, agora(101)).is_err(), "raiz divergente é recusada");
        assert!(chain.receipts.is_empty(), "bloco recusado não pode deixar recibo");
        assert!(chain.log_index.is_empty(), "nem evento");
    }

    /// Reorganização descarta os recibos das transações ÓRFÃS.
    ///
    /// A referência esquece este trecho: lá o nó que reorganiza continua
    /// mostrando "minerada com sucesso" uma transação que voltou para o mempool.
    /// É seguro divergir — índice node-local não entra no `stateRoot`.
    #[test]
    fn reorg_descarta_recibo_de_transacao_orfa() {
        let cs = carteiras();
        let mut chain = cadeia_com_saldo(&cs, ALTURA, 100);
        let tx = tx_eavm(
            &cs[0],
            "EAVM_DEPLOY",
            1,
            vec![("code", JsonValue::str(deploy_de(RUNTIME_EMITE_LOG)))],
        );
        let id = tx.id.clone().expect("id");
        let bloco = proximo_com(&chain, &cs, 101, vec![tx]);
        chain.add_block(bloco, agora(101)).expect("bloco com deploy");
        assert!(chain.receipts.contains_key(&id), "recibo existe antes do reorg");

        // Ramo concorrente MAIS LONGO a partir do bloco do fork, sem aquela tx.
        let mut alternativa = cadeia_com_saldo(&cs, ALTURA, 100);
        let b1 = proximo(&alternativa, &cs, 101);
        alternativa.add_block(b1.clone(), agora(101)).expect("b1");
        let b2 = proximo(&alternativa, &cs, 102);
        alternativa.add_block(b2.clone(), agora(102)).expect("b2");

        let r = chain.reorg(ALTURA as i64, vec![b1, b2], agora(102)).expect("reorg");
        assert!(matches!(r, Reorg::Adotou(_)), "o ramo mais longo tem de vencer: {r:?}");
        assert!(
            !chain.receipts.contains_key(&id),
            "recibo de transação órfã tem de sair do índice"
        );
        assert!(chain.log_index.is_empty(), "e os eventos dela também");
    }

    /// O anel de eventos não cresce sem limite — é memória do nó, não consenso.
    #[test]
    fn o_anel_de_eventos_respeita_o_teto_mantendo_os_mais_recentes() {
        let evento = |h: u64| EventoIndexado {
            tx_id: format!("tx{h}"),
            block_height: h,
            block_time: 0,
            address: "0x0".into(),
            topics: Vec::new(),
            data: "0x".into(),
        };
        let mut anel: Vec<EventoIndexado> = (0..(MAX_LOG_INDEX as u64 + 10)).map(evento).collect();
        aparar(&mut anel);
        assert_eq!(anel.len(), MAX_LOG_INDEX);
        assert_eq!(anel[0].block_height, 10, "os 10 mais ANTIGOS é que saem");
        assert_eq!(anel.last().expect("cheio").block_height, MAX_LOG_INDEX as u64 + 9);
    }

    // ------------------------------------------------------- snapshot de boot

    /// O snapshot de uma cadeia REAL confere contra o `stateRoot` do header.
    ///
    /// É o ciclo inteiro: produz blocos de verdade, tira o snapshot do estado
    /// resultante, grava, relê, e valida contra a raiz que o próprio bloco
    /// commitou. Se qualquer decodificador perdesse um campo, ou a folha e o
    /// snapshot divergissem, a raiz não bateria — e é exatamente esse o critério
    /// que o boot usará em produção.
    #[test]
    fn snapshot_de_cadeia_real_confere_contra_o_header() {
        use crate::snapshot::Snapshot;

        let cs = carteiras();
        let mut chain = cadeia_saldo(&cs, ALTURA, 100, 1_000 * crate::config::UNIT);
        for slot in 101..=103 {
            let b = proximo(&chain, &cs, slot);
            chain.add_block(b, agora(slot)).expect("bloco");
        }

        let cabeca = chain.head().expect("cabeça").clone();
        let raiz_do_header = cabeca.state_root.clone().expect("acima do fork o header tem raiz");

        let dir = std::env::temp_dir().join(format!("eav7-snapchain-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let arquivo = dir.join("estado.snap");

        Snapshot::montar(
            cabeca.height,
            &cabeca.hash,
            chain.tail_start,
            0,
            &chain.state,
            chain.base_state.as_ref(),
        )
        .expect("monta")
        .gravar(&arquivo)
        .expect("grava");

        let lido = Snapshot::ler(&arquivo).expect("lê");
        assert_eq!(lido.altura, cabeca.height);
        assert_eq!(lido.head_hash, cabeca.hash);

        let recuperado =
            Snapshot::estado_verificado(&lido.estado, cabeca.height, Some(&raiz_do_header))
                .expect("a raiz do snapshot TEM de bater com a do header");

        // E o estado recuperado é utilizável, não só íntegro: os saldos batem.
        for c in &cs {
            assert_eq!(
                recuperado.balance_of(&c.endereco()),
                chain.state.balance_of(&c.endereco()),
                "saldo divergiu na volta"
            );
        }
        std::fs::remove_file(&arquivo).ok();
    }

    /// Um bloco a mais na cadeia INVALIDA o snapshot anterior.
    ///
    /// A raiz é de uma altura específica. Conferir contra o header errado tem de
    /// falhar — senão o boot aceitaria um estado defasado e o nó seguiria a partir
    /// de um passado, divergindo do primeiro bloco em diante.
    #[test]
    fn snapshot_de_outra_altura_nao_confere() {
        use crate::snapshot::{Erro, Snapshot};

        let cs = carteiras();
        let mut chain = cadeia_saldo(&cs, ALTURA, 100, 1_000 * crate::config::UNIT);
        let b = proximo(&chain, &cs, 101);
        chain.add_block(b, agora(101)).expect("bloco");
        let snap_antigo = chain.state.to_snapshot_value().expect("valor");
        let altura_antiga = chain.height() as u64;

        let b = proximo(&chain, &cs, 102);
        chain.add_block(b, agora(102)).expect("bloco");
        let raiz_nova = chain.head().expect("cabeça").state_root.clone().expect("raiz");

        assert!(matches!(
            Snapshot::estado_verificado(&snap_antigo, altura_antiga, Some(&raiz_nova)),
            Err(Erro::RaizDivergente { .. })
        ));
    }

    /// O CICLO INTEIRO: cadeia em disco → snapshot → boot novo sem revalidar nada.
    ///
    /// É o teste que mede o que o snapshot promete. A cadeia é produzida e
    /// persistida; grava-se o snapshot; um `Blockchain` NOVO sobe só relendo o
    /// disco, com o estado vindo do arquivo e provado contra a raiz do header. O
    /// resultado tem de ser indistinguível do replay completo — mesma raiz, mesmos
    /// índices, mesma janela.
    #[test]
    fn boot_por_snapshot_reproduz_o_replay_completo() {
        let cs = carteiras();
        let dir = std::env::temp_dir().join(format!("eav7-boot-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        let arquivo_cadeia = dir.join("blocks.jsonl");
        let arquivo_snap = dir.join("estado.snap");

        // Cadeia de verdade, persistida.
        let mut chain = cadeia_saldo(&cs, ALTURA, 100, 1_000 * crate::config::UNIT);
        let mut store = crate::blockstore::BlockStore::new(&arquivo_cadeia);
        store
            .append(&crate::block::block_to_json_line(&chain.tail[0]).expect("linha"))
            .expect("gênese");
        chain.store = Some(store);
        for slot in 101..=104 {
            let b = proximo(&chain, &cs, slot);
            chain.add_block(b, agora(slot)).expect("bloco");
        }
        let raiz_original = compute_state_root(&chain.state.state_leaves().expect("folhas"));
        let altura_original = chain.height();

        // Grava o snapshot da ponta.
        let cabeca = chain.head().expect("cabeça").clone();
        crate::snapshot::Snapshot::montar(
            cabeca.height,
            &cabeca.hash,
            chain.tail_start,
            0,
            &chain.state,
            chain.base_state.as_ref(),
        )
        .expect("monta")
        .gravar(&arquivo_snap)
        .expect("grava");

        // BOOT NOVO, só pelo snapshot.
        let mut novo = Blockchain::new();
        let mut store = crate::blockstore::BlockStore::new(&arquivo_cadeia);
        let usado = novo
            .load_from_snapshot(&mut store, &arquivo_snap)
            .expect("boot por snapshot")
            .expect("o snapshot TEM de ser aceito");
        novo.store = Some(store);

        assert_eq!(usado, cabeca.height);
        assert_eq!(novo.height(), altura_original, "altura");
        assert_eq!(
            compute_state_root(&novo.state.state_leaves().expect("folhas")),
            raiz_original,
            "a raiz do estado tem de ser a mesma do replay completo"
        );
        assert_eq!(novo.head().map(|b| &b.hash), Some(&cabeca.hash), "cabeça");
        assert_eq!(novo.tx_index, chain.tx_index, "índice de transações reconstruído");
        assert_eq!(novo.hashes, chain.hashes, "índice de hashes reconstruído");
        assert_eq!(novo.blocks_with_txs, chain.blocks_with_txs, "índice esparso");

        // E a cadeia continua utilizável: aceita o próximo bloco normalmente.
        let b = proximo(&novo, &cs, 105);
        novo.add_block(b, agora(105)).expect("a cadeia bootada segue aceitando blocos");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Snapshot que não bate com a cadeia é RECUSADO, e o boot cai no replay.
    ///
    /// Falhar para o lado seguro é o contrato inteiro deste caminho: quando não dá
    /// para provar, não se usa — e o `load_from_disk` sempre existe.
    #[test]
    fn snapshot_de_outra_cadeia_e_recusado_no_boot() {
        let cs = carteiras();
        let dir = std::env::temp_dir().join(format!("eav7-boot-alheio-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        let arquivo_cadeia = dir.join("blocks.jsonl");
        let arquivo_snap = dir.join("estado.snap");

        let mut chain = cadeia_saldo(&cs, ALTURA, 100, 1_000 * crate::config::UNIT);
        let mut store = crate::blockstore::BlockStore::new(&arquivo_cadeia);
        store
            .append(&crate::block::block_to_json_line(&chain.tail[0]).expect("linha"))
            .expect("gênese");
        chain.store = Some(store);
        let b = proximo(&chain, &cs, 101);
        chain.add_block(b, agora(101)).expect("bloco");

        // Snapshot com o hash de cabeça de OUTRA cadeia.
        let cabeca = chain.head().expect("cabeça").clone();
        crate::snapshot::Snapshot::montar(
            cabeca.height,
            "ff".repeat(32),
            chain.tail_start,
            0,
            &chain.state,
            chain.base_state.as_ref(),
        )
        .expect("monta")
        .gravar(&arquivo_snap)
        .expect("grava");

        let mut novo = Blockchain::new();
        let mut store = crate::blockstore::BlockStore::new(&arquivo_cadeia);
        assert_eq!(
            novo.load_from_snapshot(&mut store, &arquivo_snap).expect("não pode ser erro fatal"),
            None,
            "hash de cabeça divergente tem de recusar o snapshot"
        );

        // E nada foi escrito no nó: recusar tem de ser um no-op, senão o replay
        // seguinte partiria de um estado meio montado pelo snapshot rejeitado.
        assert!(novo.tail.is_empty(), "recusa não pode deixar rastro");
        assert!(novo.tx_index.is_empty());
        assert_eq!(novo.height(), -1, "a cadeia continua vazia, pronta para o replay");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Snapshot ausente não é erro — é o caso do primeiro boot.
    #[test]
    fn snapshot_ausente_apenas_cai_no_replay() {
        let mut chain = Blockchain::new();
        let dir = std::env::temp_dir().join(format!("eav7-sem-snap-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let mut store = crate::blockstore::BlockStore::new(dir.join("blocks.jsonl"));
        assert_eq!(
            chain.load_from_snapshot(&mut store, &dir.join("nao-existe.snap")).expect("ok"),
            None
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Reorganização abaixo da altura do snapshot INVALIDA o arquivo.
    ///
    /// É o caso mais perigoso do desenho, porque o snapshot antigo continua
    /// VÁLIDO no sentido criptográfico: ele bate com a raiz de um bloco que
    /// realmente existiu. Só que aquele bloco não está mais na cadeia. Um boot que
    /// o aceitasse partiria de um passado que a rede descartou — e divergiria do
    /// primeiro bloco em diante, sem nada acusar.
    #[test]
    fn reorg_abaixo_do_snapshot_apaga_o_arquivo() {
        let cs = carteiras();
        let dir = std::env::temp_dir().join(format!("eav7-reorg-snap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        let arquivo = dir.join("estado.snap");

        let mut chain = cadeia_saldo(&cs, ALTURA, 100, 1_000 * crate::config::UNIT);
        chain.snapshot_path = Some(arquivo.clone());
        // Altura já é >> INTERVAL — sem isto o add_block agenda writer G8 e
        // corre com o gravar síncrono / remove_dir do teste.
        chain.ultimo_snapshot = chain.height() as u64;
        let b = proximo(&chain, &cs, 101);
        chain.add_block(b, agora(101)).expect("bloco");

        // Simula um snapshot já gravado nesta altura.
        let cabeca = chain.head().expect("cabeça").clone();
        crate::snapshot::Snapshot::montar(
            cabeca.height,
            &cabeca.hash,
            chain.tail_start,
            0,
            &chain.state,
            chain.base_state.as_ref(),
        )
        .expect("monta")
        .gravar(&arquivo)
        .expect("grava");
        chain.ultimo_snapshot = cabeca.height;
        assert!(arquivo.exists());

        // Ramo concorrente MAIS LONGO a partir de antes do snapshot.
        let mut alternativa = cadeia_saldo(&cs, ALTURA, 100, 1_000 * crate::config::UNIT);
        let b1 = proximo(&alternativa, &cs, 101);
        alternativa.add_block(b1.clone(), agora(101)).expect("b1");
        let b2 = proximo(&alternativa, &cs, 102);
        alternativa.add_block(b2.clone(), agora(102)).expect("b2");

        let r = chain.reorg(ALTURA as i64, vec![b1, b2], agora(102)).expect("reorg");
        assert!(matches!(r, Reorg::Adotou(_)), "o ramo mais longo vence: {r:?}");
        chain.flush_snapshot();
        assert!(
            !arquivo.exists(),
            "o snapshot descrevia uma altura abandonada — tinha de ter sido apagado"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A gravação respeita o INTERVALO: um snapshot por bloco seria caro e inútil.
    #[test]
    fn o_snapshot_e_espacado_pelo_intervalo() {
        let cs = carteiras();
        let dir = std::env::temp_dir().join(format!("eav7-intervalo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        let arquivo = dir.join("estado.snap");

        let mut chain = cadeia_saldo(&cs, ALTURA, 100, 1_000 * crate::config::UNIT);
        chain.snapshot_path = Some(arquivo.clone());
        // A cadeia acabou de nascer no teste; marcar o último snapshot na altura
        // atual reproduz o estado de "acabei de gravar".
        chain.ultimo_snapshot = ALTURA;

        for slot in 101..=103 {
            let b = proximo(&chain, &cs, slot);
            chain.add_block(b, agora(slot)).expect("bloco");
        }
        assert!(
            !arquivo.exists(),
            "3 blocos estão MUITO abaixo de SNAPSHOT_INTERVAL_BLOCKS ({}) — não deve gravar",
            crate::config::SNAPSHOT_INTERVAL_BLOCKS
        );

        // Fingindo que a cadeia andou o intervalo inteiro, o próximo bloco grava.
        chain.ultimo_snapshot = 0;
        let b = proximo(&chain, &cs, 104);
        chain.add_block(b, agora(104)).expect("bloco");
        chain.flush_snapshot(); // G8: encode+write são async
        assert!(arquivo.exists(), "passado o intervalo, o snapshot tem de ser gravado");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Snapshot ATRÁS da ponta é aceito, reaplicando o rabo.
    ///
    /// É o caso NORMAL, e a primeira versão deste caminho o recusava: exigia que o
    /// arquivo descrevesse a cabeça, o que só acontece se o nó parar exatamente
    /// num múltiplo do intervalo. Na prática o snapshot era recusado em todo boot
    /// e o boot rápido nunca acontecia — nenhum teste de unidade pegou, porque
    /// todos gravavam o snapshot na ponta. Quem pegou foi subir o nó de verdade.
    #[test]
    fn snapshot_atras_da_ponta_e_aceito_reaplicando_o_rabo() {
        let cs = carteiras();
        let dir = std::env::temp_dir().join(format!("eav7-atras-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("dir");
        let arquivo_cadeia = dir.join("blocks.jsonl");
        let arquivo_snap = dir.join("estado.snap");

        let mut chain = cadeia_saldo(&cs, ALTURA, 100, 1_000 * crate::config::UNIT);
        let mut store = crate::blockstore::BlockStore::new(&arquivo_cadeia);
        store
            .append(&crate::block::block_to_json_line(&chain.tail[0]).expect("linha"))
            .expect("gênese");
        chain.store = Some(store);

        // Dois blocos, snapshot, e MAIS TRÊS por cima — o snapshot fica 3 atrás.
        for slot in 101..=102 {
            let b = proximo(&chain, &cs, slot);
            chain.add_block(b, agora(slot)).expect("bloco");
        }
        let no_snapshot = chain.head().expect("cabeça").clone();
        crate::snapshot::Snapshot::montar(
            no_snapshot.height,
            &no_snapshot.hash,
            chain.tail_start,
            0,
            &chain.state,
            chain.base_state.as_ref(),
        )
        .expect("monta")
        .gravar(&arquivo_snap)
        .expect("grava");

        for slot in 103..=105 {
            let b = proximo(&chain, &cs, slot);
            chain.add_block(b, agora(slot)).expect("bloco");
        }
        let raiz_final = compute_state_root(&chain.state.state_leaves().expect("folhas"));
        assert_eq!(chain.height() - no_snapshot.height as i64, 3, "o snapshot ficou 3 atrás");

        let mut novo = Blockchain::new();
        let mut store = crate::blockstore::BlockStore::new(&arquivo_cadeia);
        let usado = novo
            .load_from_snapshot(&mut store, &arquivo_snap)
            .expect("boot")
            .expect("snapshot atrás da ponta TEM de ser aceito");

        assert_eq!(usado, no_snapshot.height, "o boot partiu da altura do snapshot");
        assert_eq!(novo.height(), chain.height(), "e chegou à ponta");
        assert_eq!(
            compute_state_root(&novo.state.state_leaves().expect("folhas")),
            raiz_final,
            "o estado após reaplicar o rabo tem de ser o mesmo do replay completo"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// O TAMANHO DO LOTE não influencia onde o arquivo é truncado.
    ///
    /// O replay passou a verificar assinaturas em lotes paralelos. Se um bloco ruim
    /// abortasse o lote inteiro, o ponto de truncamento passaria a depender do
    /// tamanho do lote — detalhe de implementação que não pode decidir o que fica
    /// gravado em disco. Dois nós com lotes diferentes truncariam pontos
    /// diferentes e re-sincronizariam quantidades diferentes.
    ///
    /// Exercita `verificar_lote` direto, com lotes de vários tamanhos e o bloco
    /// ruim em posições diferentes: o prefixo devolvido é SEMPRE o mesmo.
    #[test]
    fn o_tamanho_do_lote_nao_muda_o_ponto_de_corte() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let mut blocos = Vec::new();
        for slot in 101..=112 {
            let b = proximo(&chain, &cs, slot);
            chain.add_block(b.clone(), agora(slot)).expect("bloco");
            blocos.push(b);
        }

        for ruim_em in [0usize, 1, 5, 11] {
            let mut lote = blocos.clone();
            // Adultera a assinatura: o hash canônico não a cobre, então o bloco
            // continua "bem-formado" e só a verificação híbrida o pega.
            lote[ruim_em].signature = "AAAA".into();

            let vazias = BTreeMap::new();
            let (verificados, erro) = Blockchain::verificar_lote(lote, &vazias);
            assert_eq!(
                verificados.len(),
                ruim_em,
                "o prefixo válido é exatamente o que vem ANTES do bloco ruim"
            );
            let erro = erro.expect("o bloco adulterado tem de ser pego");
            assert!(
                erro.contains(&blocos[ruim_em].height.to_string()),
                "o erro tem de apontar o bloco {ruim_em}: {erro}"
            );
        }

        // E um lote inteiramente válido passa sem erro.
        let vazias = BTreeMap::new();
        let (verificados, erro) = Blockchain::verificar_lote(blocos.clone(), &vazias);
        assert_eq!(verificados.len(), blocos.len());
        assert!(erro.is_none());
    }

    /// Regressão: lotes sucessivos de blocos compactos herdam `producer_keys`.
    ///
    /// Sem a semente, o 1.º bloco do 2.º lote (após LOTE=512 na prática) falhava
    /// com «chave pública do produtor inválida» mesmo com a cadeia íntegra.
    #[test]
    fn lote_seguinte_herda_chaves_de_produtores() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let mut com_chave = Vec::new();
        let mut compactos = Vec::new();
        for slot in 101..=104 {
            let mut b = proximo(&chain, &cs, slot);
            chain.add_block(b.clone(), agora(slot)).expect("bloco");
            com_chave.push(b.clone());
            // Simula fio compacto: pubs omitidas, só assinatura.
            let signer = cs
                .iter()
                .find(|c| c.endereco() == b.producer)
                .expect("carteira produtora");
            b = build_block(
                signer,
                BuildParams {
                    height: b.height,
                    previous_hash: b.previous_hash,
                    timestamp: b.timestamp,
                    transactions: b.transactions,
                    state_root: b.state_root,
                    producer_account: b.producer_account,
                    omit_public_keys: true,
                },
            )
            .expect("bloco compacto");
            compactos.push(b);
        }
        let vazias = BTreeMap::new();
        let (ok, err) = Blockchain::verificar_lote(com_chave.clone(), &vazias);
        assert!(err.is_none());
        assert_eq!(ok.len(), 4);

        // Sem semente: compactos sozinhos falham no primeiro.
        let (prefixo, err) = Blockchain::verificar_lote(compactos.clone(), &vazias);
        assert!(prefixo.is_empty());
        assert!(err.as_deref().is_some_and(|e| e.contains("chave pública")), "erro foi: {err:?}");

        // Com as chaves do lote anterior (como `aplicar_lote` faz via self):
        let mut seeds = BTreeMap::new();
        for b in &com_chave {
            if let (Some(pk), Some(pq)) = (&b.public_key, &b.pq_public_key) {
                seeds.insert(b.producer.clone(), (pk.clone(), pq.clone()));
            }
        }
        let (ok, err) = Blockchain::verificar_lote(compactos, &seeds);
        assert!(err.is_none(), "{err:?}");
        assert_eq!(ok.len(), 4);
    }

    /// Quanto o lote paralelo economiza no termo que domina o replay.
    ///
    /// Medição impressa, não regressão de tempo. Rode com `--release --nocapture`;
    /// em debug o ML-DSA é ordens de grandeza mais lento e o número não diz nada
    /// sobre produção.
    #[test]
    fn custo_do_lote_paralelo() {
        let cs = carteiras();
        let mut chain = cadeia(&cs, ALTURA, 100);
        let n = if cfg!(debug_assertions) { 32 } else { 512 };
        let mut blocos = Vec::with_capacity(n);
        for slot in 101..(101 + n as i64) {
            let b = proximo(&chain, &cs, slot);
            chain.add_block(b.clone(), agora(slot)).expect("bloco");
            blocos.push(b);
        }

        let t = std::time::Instant::now();
        for b in &blocos {
            assert_eq!(verify_block_integrity(b), Ok(()));
        }
        let sequencial = t.elapsed().as_secs_f64() * 1000.0;

        let t = std::time::Instant::now();
        let vazias = BTreeMap::new();
        let (verificados, erro) = Blockchain::verificar_lote(blocos.clone(), &vazias);
        let paralelo = t.elapsed().as_secs_f64() * 1000.0;
        assert!(erro.is_none());
        assert_eq!(verificados.len(), n);

        let nucleos = std::thread::available_parallelism().map_or(1, |x| x.get());
        println!("{n} blocos — sequencial: {sequencial:.0} ms · lote ({nucleos} núcleos): {paralelo:.0} ms");
        println!("  ganho: {:.1}x", sequencial / paralelo.max(0.001));
        println!(
            "  projeção do replay de 1 ano (31,5M blocos): {:.1} h -> {:.1} h",
            sequencial / n as f64 * 31_536_000.0 / 3.6e6,
            paralelo / n as f64 * 31_536_000.0 / 3.6e6
        );
    }
}
