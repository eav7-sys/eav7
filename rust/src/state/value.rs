//! Movimento de valor e stake.
//!
//! Porte de `src/core/state.js` (o nó de referência) para os tipos de VALOR e
//! STAKE — incluindo as checagens de altura de fork, que são o que impede este
//! cliente de aceitar o que a rede rejeita.
//!
//! Invariante que vale para TODO manipulador deste módulo: se retornar `Err`, o
//! estado tem de estar exatamente como estava. Valide tudo ANTES de mutar.
//!
//! A referência consegue essa atomicidade de graça — ela opera sobre um clone que
//! é descartado quando algo lança. Aqui não há clone: cada manipulador segue o
//! mesmo desenho, em duas fases separadas por uma linha em branco e um comentário:
//! primeiro TODAS as leituras e validações, depois TODAS as escritas. Uma
//! validação que escorregue para depois da primeira escrita quebra o invariante
//! sem quebrar nenhum teste de caminho feliz — por isso a separação é explícita.

use super::{soma, sub, Amount, Ctx, State, StateError};
use crate::address::is_valid_address;
use crate::transaction::{JsonValue, Tx, EAVM_SCHEME};
use std::collections::BTreeMap;

type R<T> = Result<T, StateError>;

fn erro(msg: impl Into<String>) -> StateError {
    StateError(msg.into())
}

// ============================================================================
// Constantes de consenso
//
// O crate ainda não tem módulo de config; estes valores vêm de `src/config.js` e
// PRECISAM migrar para lá quando ele existir. Errar qualquer altura aqui não dá
// erro de compilação nem falha de teste local: dá uma cisão de cadeia no dia em
// que a rede cruzar a altura. Cada uma traz a linha de origem.
// ============================================================================

/// `CHAIN.VOTING_HEIGHT` (config.js:81) — votação de validadores (modelo dos 27 SRs).
const VOTING_HEIGHT: u64 = crate::config::VOTING_HEIGHT;
/// `CHAIN.RESOURCE_HEIGHT` (config.js:353) — delegação de recurso energia/bandwidth.
const RESOURCE_HEIGHT: u64 = crate::config::RESOURCE_HEIGHT;
/// `CHAIN.VESTING_HEIGHT` (config.js:357).
const VESTING_HEIGHT: u64 = crate::config::VESTING_HEIGHT;
/// `CHAIN.SLASHING_HEIGHT` (config.js:74). DELIBERADAMENTE fora do gênese-ativo na
/// referência (config.js:539) — a detecção de assinatura dupla ainda não rolou.
const SLASHING_HEIGHT: u64 = crate::config::SLASHING_HEIGHT;
/// `CHAIN.PERMISSIONS_V2_HEIGHT` (config.js:107). Governa DUAS regras deste módulo:
/// o enfileiramento da comissão e o teto de saques simultâneos.
const PERMISSIONS_V2_HEIGHT: u64 = crate::config::PERMISSIONS_V2_HEIGHT;

/// `CHAIN.COMMISSION_DELAY_BLOCKS` (config.js:92) — ~6 h a 1 bloco/s.
const COMMISSION_DELAY_BLOCKS: u64 = crate::config::COMMISSION_DELAY_BLOCKS;
/// `CHAIN.UNBONDING_BLOCKS` (config.js:66) — ~7 dias a 1 bloco/s.
const UNBONDING_BLOCKS: u64 = crate::config::UNBONDING_BLOCKS;
/// `CHAIN.MAX_UNBONDING_ENTRIES` (config.js:70).
const MAX_UNBONDING_ENTRIES: usize = crate::config::MAX_UNBONDING_ENTRIES as usize;
/// `CHAIN.MAX_VOTE_TARGETS` (config.js:82) — anti-DoS de `data` numa única VOTE.
const MAX_VOTE_TARGETS: usize = crate::config::MAX_VOTE_TARGETS as usize;
/// `CHAIN.MAX_VESTING_BLOCKS` (config.js:358) — ~10 anos a 1 bloco/s.
const MAX_VESTING_BLOCKS: i64 = crate::config::MAX_VESTING_BLOCKS as i64;
/// `CHAIN.SLASH_PERCENT` (config.js:75) — % do que está em risco que é penalizado.
const SLASH_PERCENT: Amount = crate::config::SLASH_PERCENT as Amount;
/// `CHAIN.SLASH_REPORTER_PERCENT` (config.js:76) — % DA PENALIDADE ao denunciante.
const SLASH_REPORTER_PERCENT: Amount = crate::config::SLASH_REPORTER_PERCENT as Amount;
/// `CHAIN.MIN_VALIDATOR_STAKE` (config.js:62) — `1_000n * UNIT`, UNIT = 1e6.
/// É GOVERNÁVEL (config.js:131): a leitura passa por `param_amount`, não por esta
/// constante direto, senão um override aprovado on-chain seria ignorado.
const MIN_VALIDATOR_STAKE: Amount = crate::config::MIN_VALIDATOR_STAKE as Amount;
/// `CHAIN.REWARD_SCALE` (config.js:93) — escala do acumulador de recompensa por voto.
const REWARD_SCALE: Amount = crate::config::REWARD_SCALE as Amount;

/// Cronograma de vesting.
///
/// Os campos são os do registro da referência (`state.js:1274`): `start`, `cliff` e
/// `duration`, não um par início/fim. A diferença NÃO é cosmética — o `cliff` é uma
/// terceira grandeza independente (quanto tempo antes de qualquer liberação) e não
/// se recupera de um `end_block`. Um esqueleto com `start_block`/`end_block` só
/// conseguiria representar vesting de cliff zero, e todo cronograma com cliff
/// liberaria cedo demais.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Vesting {
    pub beneficiary: String,
    pub total: Amount,
    pub claimed: Amount,
    pub start: u64,
    pub cliff: u64,
    pub duration: u64,
}

impl Vesting {
    /// Forma canônica para a folha do `stateRoot`.
    ///
    /// ARMADILHA: `total` e `claimed` são TEXTO na referência
    /// (`state.js:1274` faz `total: amount.toString(), claimed: '0'`), enquanto
    /// `start`, `cliff` e `duration` são inteiros. Na codificação canônica isso é
    /// tag 0x04 contra 0x03 — emitir `Value::uint` nos dois primeiros daria outra
    /// folha e outra raiz. É o mesmo caso do `frozen` do token.
    pub fn to_value(&self) -> crate::canonical::Value {
        use crate::canonical::Value;
        let mut m = std::collections::BTreeMap::new();
        m.insert("beneficiary".to_string(), Value::str(self.beneficiary.clone()));
        m.insert("total".to_string(), Value::str(self.total.to_string()));
        m.insert("claimed".to_string(), Value::str(self.claimed.to_string()));
        m.insert("start".to_string(), Value::uint(self.start));
        m.insert("cliff".to_string(), Value::uint(self.cliff));
        m.insert("duration".to_string(), Value::uint(self.duration));
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// `total` e `claimed` voltam por `decimal_em_texto` (tag 0x04) e os três
    /// prazos por `inteiro` (tag 0x03) — a mesma assimetria da escrita. Ler os dois
    /// primeiros como inteiro devolveria `None` e derrubaria o snapshot inteiro.
    pub fn from_value(v: &crate::canonical::Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 6 {
            return None;
        }
        Some(Vesting {
            beneficiary: m.get("beneficiary")?.texto()?.to_string(),
            total: m.get("total")?.decimal_em_texto()?,
            claimed: m.get("claimed")?.decimal_em_texto()?,
            start: m.get("start")?.inteiro()?,
            cliff: m.get("cliff")?.inteiro()?,
            duration: m.get("duration")?.inteiro()?,
        })
    }
}


impl Vesting {
    /// Quanto já venceu na altura `height`: zero antes do cliff, linear entre
    /// `start` e `start + duration`, total daí em diante.
    ///
    /// Só inteiros, e a ordem importa: multiplica ANTES de dividir. Inverter
    /// (`total * ((height-start)/duration)`) daria zero em toda altura antes do
    /// fim, porque a divisão inteira arredonda para baixo — o beneficiário só
    /// receberia no último bloco.
    pub fn vested(&self, height: u64) -> R<Amount> {
        if height < self.start.saturating_add(self.cliff) {
            return Ok(0);
        }
        if height >= self.start.saturating_add(self.duration) {
            return Ok(self.total);
        }
        let decorrido = Amount::from(height - self.start);
        let produto = self
            .total
            .checked_mul(decorrido)
            .ok_or_else(|| erro("estouro aritmético no cálculo do vesting"))?;
        // `duration > 0` garantido na criação; o ramo acima já cobriu `duration == 0`.
        Ok(produto / Amount::from(self.duration))
    }
}

/// Tipos de transação que este módulo atende. O despacho em `mod.rs` usa esta
/// lista, então um tipo esquecido aqui vira erro de "tipo desconhecido" em vez de
/// falha silenciosa.
pub const TIPOS: &[&str] = &[
    "TRANSFER",
    "STAKE",
    "UNSTAKE",
    "DELEGATE_RESOURCE",
    "UNDELEGATE_RESOURCE",
    "VESTING_CREATE",
    "VESTING_CLAIM",
    "CLAIM_VOTER_REWARD",
    "VOTE",
    "SET_COMMISSION",
    "SLASH_DOUBLE_SIGN",
];

pub fn aplicar(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    match tx.tx_type.as_str() {
        "TRANSFER" => transfer(state, tx, ctx),
        "STAKE" => stake(state, tx, ctx),
        "UNSTAKE" => unstake(state, tx, ctx),
        "DELEGATE_RESOURCE" => delegate_resource(state, tx, ctx),
        "UNDELEGATE_RESOURCE" => undelegate_resource(state, tx, ctx),
        "VESTING_CREATE" => vesting_create(state, tx, ctx),
        "VESTING_CLAIM" => vesting_claim(state, tx, ctx),
        "CLAIM_VOTER_REWARD" => claim_voter_reward(state, tx, ctx),
        "VOTE" => vote(state, tx, ctx),
        "SET_COMMISSION" => set_commission(state, tx, ctx),
        "SLASH_DOUBLE_SIGN" => slash_double_sign(state, tx, ctx),
        // Inalcançável pelo despacho de `mod.rs`, que só entra aqui para tipo em
        // `TIPOS`. Existe para que acrescentar um tipo à lista sem escrever o ramo
        // vire erro em tempo de execução, não aceitação silenciosa.
        outro => Err(erro(format!("tipo fora do módulo value: {outro}"))),
    }
}

// ============================================================================
// Leitura de `data` e de valores monetários
// ============================================================================

fn campo<'a>(tx: &'a Tx, chave: &str) -> Option<&'a JsonValue> {
    match tx.data.as_ref() {
        Some(JsonValue::Map(m)) => m.get(chave),
        _ => None,
    }
}

fn texto(v: Option<&JsonValue>) -> Option<&str> {
    match v {
        Some(JsonValue::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

/// Valor monetário vindo de `data`, com a semântica de `BigInt(x)` da referência.
///
/// A referência aceita string OU number, e é isso que reproduzimos. O que NÃO
/// reproduzimos de propósito: `BigInt("")` é `0n` no JS, `BigInt(" 12 ")` é `12n`
/// (o construtor apara espaço). As duas formas são rejeitadas aqui — aceitar
/// string vazia como zero é o tipo de coerção que transforma um campo esquecido
/// num valor legítimo, e nenhum caminho do protocolo depende disso.
fn como_amount(v: Option<&JsonValue>) -> R<Amount> {
    match v {
        Some(JsonValue::Str(s)) => {
            if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
                return Err(erro("valor não é um decimal sem sinal"));
            }
            s.parse::<Amount>().map_err(|_| erro("valor fora da faixa representável"))
        }
        // `BigInt(-1)` é válido no JS e vira negativo; aqui `Amount` é sem sinal, e
        // um negativo tem de virar ERRO, não `2¹²⁸ - 1` por conversão silenciosa.
        Some(JsonValue::Int(n)) => Amount::try_from(*n).map_err(|_| erro("valor negativo")),
        _ => Err(erro("valor ausente ou de tipo inválido")),
    }
}

/// Inteiro pequeno vindo de `data`, com a semântica de `Number(x)` +
/// `Number.isSafeInteger(x)` da referência — que coage string para número, e por
/// isso `{"percent": "15"}` é aceito pelo nó de referência.
///
/// Formas exóticas que o `Number` do JS aceita e esta função rejeita: notação
/// científica (`"1e3"`), decimal com fração nula (`"15.0"`), hexadecimal (`"0xf"`)
/// e espaço em volta — TODAS reproduzidas por `coercao::js_number_seguro`. A
/// versão anterior as rejeitava e chamava isso de "lado seguro": não era. A rede
/// aceita esses valores, e recusá-los faria este nó parar num bloco válido.
fn como_i64(v: Option<&JsonValue>) -> Option<i64> {
    match v {
        Some(JsonValue::Int(n)) => Some(*n),
        // `Number(v)` + `Number.isSafeInteger` — a coerção da referência, não um
        // parser estrito. Recusar `"3.0"`/`"0xf"`/`"1e3"` era divergir: a rede
        // ACEITA, e este cliente pararia no primeiro bloco que os contivesse.
        Some(JsonValue::Str(s)) => crate::state::coercao::js_number_seguro(s),
        _ => None,
    }
}

/// O `amount` do topo da transação. `BigInt(tx.amount)` na referência.
fn amount_da_tx(tx: &Tx) -> R<Amount> {
    if tx.amount.is_empty() || !tx.amount.bytes().all(|b| b.is_ascii_digit()) {
        return Err(erro("amount inválido"));
    }
    tx.amount.parse::<Amount>().map_err(|_| erro("amount fora da faixa representável"))
}

/// Valor efetivo de um parâmetro governável: o override aprovado on-chain, se
/// houver; senão o padrão. Espelha `State.param` da referência.
///
/// Ler a constante direto seria mais curto e estaria ERRADO: uma proposta de
/// governança aprovada mudaria o mínimo de stake na rede e este cliente
/// continuaria usando o valor de compilação, divergindo em toda VOTE e UNSTAKE.
fn param_amount(state: &State, nome: &str, padrao: Amount) -> R<Amount> {
    match state.params.get(nome) {
        Some(s) => s.parse::<Amount>().map_err(|_| erro(format!("parâmetro {nome} inválido no estado"))),
        None => Ok(padrao),
    }
}

/// Existe ao menos um validador elegível? Só a EXISTÊNCIA importa nos usos deste
/// módulo, então não vale reproduzir a ordenação e o corte em `MAX_VALIDATORS`.
///
/// Exclui contas `eavm_managed` — as que stakearam pela rota EVM (`0x…`). Elas
/// não têm par de chaves híbrido e nunca conseguiriam assinar um bloco, então
/// contá-las aqui deixaria a guarda do "último validador" passar com base num
/// validador que não existe: o `UNSTAKE` seria aceito, o conjunto real ficaria
/// vazio e a cadeia travaria sem produtor.
///
/// O mesmo filtro que `blockchain::validators()` (`:169`) aplica — as duas visões
/// do conjunto de validadores precisam concordar. Estava ausente aqui sob um
/// comentário dizendo que `Account` não tinha o campo; tem
/// (`state/mod.rs:104`), e desde que `stake` passou a marcá-lo a divergência
/// virou alcançável.
fn ha_validador(state: &State, min_stake: Amount, ajuste: Option<(&str, Amount)>) -> bool {
    state.accounts.iter().any(|(addr, conta)| {
        if conta.eavm_managed {
            return false;
        }
        let staked = match ajuste {
            Some((alvo, novo)) if alvo == addr => novo,
            _ => conta.staked,
        };
        staked >= min_stake
    })
}

// ============================================================================
// Recompensa de eleitor (acumulador O(1))
// ============================================================================

/// Débito de recompensa de um par (eleitor, validador).
///
/// O mapa é ANINHADO — `voter_reward_debt[eleitor][validador]` — espelhando a
/// referência (`state.js:553`). A primeira versão da struct em `mod.rs` era plana
/// e este módulo contornava com chave composta; a forma achatada produziria uma
/// folha diferente no `stateRoot`, então a struct foi corrigida.
fn debito(state: &State, eleitor: &str, validador: &str) -> Amount {
    state.voter_reward_debt.get(eleitor).and_then(|m| m.get(validador)).copied().unwrap_or(0)
}

fn set_debito(state: &mut State, eleitor: &str, validador: &str, valor: Amount) {
    state.voter_reward_debt.entry(eleitor.to_string()).or_default()
        .insert(validador.to_string(), valor);
}

/// Liquida a recompensa pendente de um eleitor por um validador e zera a dívida.
///
/// Espelha `#settleVoterReward`. NÃO mexe em `total_minted`: a emissão já foi
/// contabilizada quando o bloco foi produzido, e contá-la de novo aqui inflaria o
/// suprimento a cada resgate.
pub(crate) fn liquidar_recompensa(state: &mut State, eleitor: &str, validador: &str) -> R<()> {
    let votos = state
        .votes
        .get(eleitor)
        .and_then(|m| m.get(validador))
        .copied()
        .unwrap_or(0);
    let acc = state.reward_acc_per_vote.get(validador).copied().unwrap_or(0);

    if votos > 0 {
        let debt = debito(state, eleitor, validador);
        // O acumulador é monotônico: `debt` nunca passa de `acc`. Se passar, o estado
        // já está corrompido — `sub` devolve erro em vez de dar a volta em u128.
        let delta = sub(acc, debt)?;
        // Sobre o estouro: `votos * delta` parece perigoso (10¹⁷ × 10²⁵), mas as duas
        // grandezas são inversamente proporcionais por construção — `inc` é
        // `voterShare * REWARD_SCALE / totalVotes`, então quanto mais votos, menor o
        // acumulado por voto. O produto é limitado pela recompensa total já
        // distribuída vezes `REWARD_SCALE` (~10³⁵), que cabe. `checked_mul` fica
        // como rede: se a hipótese furar, vira erro de transição, não pânico.
        let produto = votos
            .checked_mul(delta)
            .ok_or_else(|| erro("estouro aritmético na recompensa de eleitor"))?;
        let pendente = produto / REWARD_SCALE;
        if pendente > 0 {
            state.creditar(eleitor, pendente)?;
        }
    }
    set_debito(state, eleitor, validador, acc);
    Ok(())
}

// ============================================================================
// TRANSFER
// ============================================================================

fn transfer(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let amount = amount_da_tx(tx)?;
    // Zero é REJEITADO. Uma transferência de zero só serviria para poluir o
    // histórico ao custo da taxa — e o vetor de conformidade fixa isto.
    if amount == 0 {
        return Err(erro("valor da transferência deve ser positivo"));
    }
    let to = tx.to.clone().ok_or_else(|| erro("endereço de destino inválido"))?;
    let total = soma(amount, ctx.fee)?;
    if state.account(&tx.from).balance < total {
        return Err(erro("saldo insuficiente"));
    }
    // Estouro do destino conferido ANTES de debitar. Se `to == from` não há o que
    // conferir: o efeito líquido é `-fee`, que só diminui.
    if to != tx.from {
        soma(state.balance_of(&to), amount)?;
    }

    // --- daqui para baixo, só escrita ---
    state.debitar(&tx.from, total)?;
    state.creditar(&to, amount)
}

// ============================================================================
// STAKE
// ============================================================================

fn stake(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let amount = amount_da_tx(tx)?;
    if amount == 0 {
        return Err(erro("stake deve ser positivo"));
    }
    let total = soma(amount, ctx.fee)?;
    let conta = state.account(&tx.from);
    if conta.balance < total {
        return Err(erro("saldo insuficiente"));
    }
    let novo_stake = soma(conta.staked, amount)?;

    // --- daqui para baixo, só escrita ---
    state.debitar(&tx.from, total)?;
    let conta = state.account_mut(&tx.from);
    conta.staked = novo_stake;
    // Conta que stakeia pela rota EAVM (MetaMask/Trust, endereço de sistema
    // `0x…7001`) NÃO pode produzir bloco: ela não tem par de chaves híbrido, e um
    // slot atribuído a ela ficaria vazio para sempre. A marca é o que
    // `validators()` usa para excluí-la (blockchain.rs:169), e ela ENTRA na folha
    // `acct` — omiti-la divergiria a raiz de toda conta marcada pela rede.
    //
    // O porte recusava a transação inteira aqui, alegando que `Account` não tinha
    // o campo e que `verify_transaction` já barrava o esquema EAVM. As duas
    // afirmações deixaram de valer: o campo existe (`state/mod.rs:104`) e a
    // verificação ROTEIA o envelope EAVM em vez de barrá-lo. O efeito era um nó
    // que caía na primeira vez que alguém stakeasse pela carteira EVM — e que
    // aceitava o `UNSTAKE` correspondente, desfazendo um stake que se recusava a
    // fazer. Espelha `state.js:1210`.
    if tx.scheme == EAVM_SCHEME {
        conta.eavm_managed = true;
    }
    Ok(())
}

// ============================================================================
// UNSTAKE
// ============================================================================

fn unstake(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let amount = amount_da_tx(tx)?;
    if amount == 0 {
        return Err(erro("unstake deve ser positivo"));
    }
    let conta = state.account(&tx.from);
    if conta.staked < amount {
        return Err(erro("stake insuficiente"));
    }
    // A taxa sai do SALDO, não do stake que está saindo: os fundos do unstake não
    // voltam agora, então não há de onde pagar.
    if conta.balance < ctx.fee {
        return Err(erro("saldo insuficiente para a taxa"));
    }
    let restante = sub(conta.staked, amount)?;

    // O stake precisa continuar lastreando DUAS coisas, e as duas são checadas
    // separadamente porque as mensagens dizem ao usuário o que desfazer primeiro:
    // VOTOS alocados e RECURSO delegado. Sem isto dá para votar/delegar e
    // dessteikar em seguida, ficando com influência sem lastro econômico.
    let piso_votos = votado_total(state, &tx.from)?;
    if restante < piso_votos {
        return Err(erro("unstake deixaria votos sem lastro; refaça VOTE (reduza os votos) primeiro"));
    }
    if restante < conta.delegated_out {
        return Err(erro("unstake deixaria recurso delegado sem lastro; retire a delegação primeiro"));
    }

    // Esvaziar o conjunto de validadores é um halt PERMANENTE: sem produtor não há
    // bloco, e sem bloco não há transação que reponha o stake. A checagem simula a
    // redução em vez de aplicá-la e desfazer, para não violar o invariante.
    let min_stake = param_amount(state, "MIN_VALIDATOR_STAKE", MIN_VALIDATOR_STAKE)?;
    if !ha_validador(state, min_stake, Some((&tx.from, restante))) {
        return Err(erro("não é possível remover o último validador ativo da rede"));
    }

    // Teto de saques simultâneos — só a partir de PERMISSIONS_V2_HEIGHT. Abaixo do
    // fork a fila é ilimitada, e reproduzir isso é o que mantém o replay do
    // histórico antigo idêntico.
    if ctx.height >= PERMISSIONS_V2_HEIGHT {
        let em_fila = state.unbonding.iter().filter(|(dono, _, _)| dono == &tx.from).count();
        if em_fila >= MAX_UNBONDING_ENTRIES {
            return Err(erro(format!("limite de {MAX_UNBONDING_ENTRIES} saques simultâneos atingido")));
        }
    }
    let matura_em = ctx
        .height
        .checked_add(UNBONDING_BLOCKS)
        .ok_or_else(|| erro("estouro aritmético na altura de maturação"))?;

    // --- daqui para baixo, só escrita ---
    state.debitar(&tx.from, ctx.fee)?;
    state.account_mut(&tx.from).staked = restante;
    // Os fundos NÃO voltam ao saldo agora: entram na fila e o tick de bloco os
    // devolve depois de UNBONDING_BLOCKS. O stake, porém, já saiu — o voto e o peso
    // de validação somem na hora. É o que impede sair-e-dumpar e ataque long-range.
    state.unbonding.push((tx.from.clone(), amount, matura_em));
    Ok(())
}

/// Total de votos que um eleitor alocou. Espelha `State.votedTotal`.
fn votado_total(state: &State, endereco: &str) -> R<Amount> {
    let mut soma_votos: Amount = 0;
    if let Some(m) = state.votes.get(endereco) {
        for v in m.values() {
            soma_votos = soma(soma_votos, *v)?;
        }
    }
    Ok(soma_votos)
}

// ============================================================================
// VOTE
// ============================================================================

fn vote(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < VOTING_HEIGHT {
        return Err(erro("votação de validadores ainda não ativa"));
    }
    if state.account(&tx.from).balance < ctx.fee {
        return Err(erro("saldo insuficiente para a taxa"));
    }
    // A alocação é validada e aplicada ANTES do débito da taxa, como na referência:
    // uma alocação inválida não pode deixar taxa cobrada para trás.
    aplicar_voto(state, &tx.from, campo(tx, "votes"))?;
    state.debitar(&tx.from, ctx.fee)
}

/// Aloca poder de voto de `conta` aos candidatos.
///
/// Extraído porque a referência compartilha exatamente este código entre a
/// transação VOTE e a operação multisig VOTE. Duas implementações da mesma regra
/// de consenso divergem mais cedo ou mais tarde.
pub(crate) fn aplicar_voto(state: &mut State, conta: &str, votos: Option<&JsonValue>) -> R<()> {
    let alocacao = match votos {
        Some(JsonValue::Map(m)) => m,
        // Lista e escalar caem aqui, como o `Array.isArray` da referência: um array
        // faria toda leitura por chave virar ausência silenciosa em vez de erro.
        _ => return Err(erro("votos inválidos")),
    };
    if alocacao.is_empty() || alocacao.len() > MAX_VOTE_TARGETS {
        return Err(erro("nº de candidatos inválido"));
    }

    let min_stake = param_amount(state, "MIN_VALIDATOR_STAKE", MIN_VALIDATOR_STAKE)?;
    let mut total: Amount = 0;
    let mut analisados: Vec<(String, Amount)> = Vec::with_capacity(alocacao.len());
    for (candidato, bruto) in alocacao {
        if !is_valid_address(candidato) {
            return Err(erro("endereço de candidato inválido"));
        }
        if candidato == conta {
            return Err(erro("não pode votar em si mesmo (o self-stake já conta)"));
        }
        // O candidato precisa ser ELEGÍVEL. Sem isto, votar num endereço-lixo
        // acumularia `candidate_votes` que nunca vira validador — poeira de estado
        // permanente, criável de graça por qualquer um.
        if state.account(candidato).staked < min_stake {
            return Err(erro("candidato não elegível (self-stake abaixo do mínimo)"));
        }
        let valor = como_amount(Some(bruto))?;
        if valor == 0 {
            return Err(erro("voto deve ser positivo"));
        }
        total = soma(total, valor)?;
        analisados.push((candidato.clone(), valor));
    }
    if total > state.account(conta).staked {
        return Err(erro("votos excedem o poder de voto (stake)"));
    }

    // --- daqui para baixo, só escrita ---

    // Remove a alocação ANTERIOR. Liquidar a recompensa pendente de cada candidato
    // ANTES de mexer nos votos é obrigatório: o valor pendente é `votos × (acc -
    // debt)`, e zerar os votos primeiro faria o eleitor perder tudo o que acumulou.
    let anterior: Vec<(String, Amount)> = state
        .votes
        .get(conta)
        .map(|m| m.iter().map(|(k, v)| (k.clone(), *v)).collect())
        .unwrap_or_default();
    for (candidato, valor) in &anterior {
        liquidar_recompensa(state, conta, candidato)?;
        let atual = state.candidate_votes.get(candidato).copied().unwrap_or(0);
        let restante = sub(atual, *valor)?;
        // Zero é REMOVIDO, não guardado. Guardar zero deixaria uma entrada a mais no
        // mapa e, quando a enumeração de folhas existir, outra raiz de estado.
        if restante > 0 {
            state.candidate_votes.insert(candidato.clone(), restante);
        } else {
            state.candidate_votes.remove(candidato);
        }
    }

    // Aplica a nova alocação, zerando a dívida — o eleitor passa a acumular a partir
    // do ponto atual, e não retroativamente sobre recompensa que não lastreou.
    let mut registro: BTreeMap<String, Amount> = BTreeMap::new();
    for (candidato, valor) in analisados {
        let atual = state.candidate_votes.get(&candidato).copied().unwrap_or(0);
        state.candidate_votes.insert(candidato.clone(), soma(atual, valor)?);
        let acc = state.reward_acc_per_vote.get(&candidato).copied().unwrap_or(0);
        set_debito(state, conta, &candidato, acc);
        registro.insert(candidato, valor);
    }
    state.votes.insert(conta.to_string(), registro);
    Ok(())
}

// ============================================================================
// SET_COMMISSION
// ============================================================================

fn set_commission(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < VOTING_HEIGHT {
        return Err(erro("votação ainda não ativa"));
    }
    let pct = match como_i64(campo(tx, "percent")) {
        Some(p) if (0..=100).contains(&p) => p as u8,
        _ => return Err(erro("comissão deve ser 0..100")),
    };
    if state.account(&tx.from).balance < ctx.fee {
        return Err(erro("saldo insuficiente para a taxa"));
    }
    let ativa_em = ctx
        .height
        .checked_add(COMMISSION_DELAY_BLOCKS)
        .ok_or_else(|| erro("estouro aritmético na altura de ativação"))?;

    // --- daqui para baixo, só escrita ---
    state.debitar(&tx.from, ctx.fee)?;
    if ctx.height >= PERMISSIONS_V2_HEIGHT {
        // AGENDA em vez de aplicar. Sem o atraso, o validador sobe a comissão para
        // 100% no próprio slot, captura a recompensa dos eleitores e baixa de volta —
        // ataque verificado na auditoria. Nova mudança substitui a anterior.
        state.pending_commission.insert(tx.from.clone(), (pct, ativa_em));
    } else {
        // Abaixo do fork vale na hora. Reproduzir o comportamento ANTIGO é o que
        // mantém o replay do histórico pré-fork idêntico.
        state.commission.insert(tx.from.clone(), pct);
    }
    Ok(())
}

// ============================================================================
// CLAIM_VOTER_REWARD
// ============================================================================

fn claim_voter_reward(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < VOTING_HEIGHT {
        return Err(erro("votação ainda não ativa"));
    }
    let validador = match texto(campo(tx, "validator")) {
        Some(v) if is_valid_address(v) => v.to_string(),
        _ => return Err(erro("validador inválido")),
    };
    // A EXISTÊNCIA da entrada é o que vale, não o valor: a referência compara com
    // `null` explicitamente. Uma entrada de valor zero não deveria existir, mas se
    // existir o resgate é legítimo (liquida e zera a dívida).
    if !state.votes.get(&tx.from).is_some_and(|m| m.contains_key(&validador)) {
        return Err(erro("você não vota nesse validador"));
    }
    if state.account(&tx.from).balance < ctx.fee {
        return Err(erro("saldo insuficiente para a taxa"));
    }

    // --- daqui para baixo, só escrita ---
    state.debitar(&tx.from, ctx.fee)?;
    liquidar_recompensa(state, &tx.from, &validador)
}

// ============================================================================
// VESTING
// ============================================================================

fn vesting_create(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < VESTING_HEIGHT {
        return Err(erro("vesting ainda não ativo"));
    }
    let beneficiario = match texto(campo(tx, "beneficiary")) {
        Some(b) if is_valid_address(b) => b.to_string(),
        _ => return Err(erro("beneficiário inválido")),
    };
    let amount = amount_da_tx(tx)?;
    if amount == 0 {
        return Err(erro("valor de vesting deve ser positivo"));
    }
    let duracao = match como_i64(campo(tx, "durationBlocks")) {
        Some(d) if d > 0 && d <= MAX_VESTING_BLOCKS => d as u64,
        _ => return Err(erro("duração inválida")),
    };
    // `cliffBlocks` ausente é ZERO (`?? 0` na referência), diferente de inválido.
    let cliff_bruto = match campo(tx, "cliffBlocks") {
        None | Some(JsonValue::Null) => 0,
        v => match como_i64(v) {
            Some(c) => c,
            None => return Err(erro("cliff inválido")),
        },
    };
    if cliff_bruto < 0 || cliff_bruto as u64 > duracao {
        return Err(erro("cliff inválido"));
    }
    let total = soma(amount, ctx.fee)?;
    if state.account(&tx.from).balance < total {
        return Err(erro("saldo insuficiente para travar o vesting"));
    }
    // A referência indexa por `tx.id`. Se o `id` não estiver calculado, ela grava sob
    // a chave literal `"undefined"` — todo vesting sem id colidiria num registro só,
    // e o segundo sobrescreveria o primeiro, apagando fundos travados. Aqui é erro.
    let id = tx.id.clone().ok_or_else(|| erro("transação sem id: o vesting não tem chave"))?;

    // --- daqui para baixo, só escrita ---
    state.debitar(&tx.from, total)?;
    state.vesting.insert(
        id,
        Vesting {
            beneficiary: beneficiario,
            total: amount,
            claimed: 0,
            start: ctx.height,
            cliff: cliff_bruto as u64,
            duration: duracao,
        },
    );
    Ok(())
}

fn vesting_claim(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < VESTING_HEIGHT {
        return Err(erro("vesting ainda não ativo"));
    }
    let id = texto(campo(tx, "vestingId")).unwrap_or("").to_string();
    let v = state.vesting.get(&id).cloned().ok_or_else(|| erro("vesting inexistente"))?;
    if v.beneficiary != tx.from {
        return Err(erro("só o beneficiário resgata"));
    }
    if state.account(&tx.from).balance < ctx.fee {
        return Err(erro("saldo insuficiente para a taxa"));
    }
    let vencido = v.vested(ctx.height)?;
    // `vested` é monotônico e `claimed` nunca passa dele, então a subtração não
    // deveria dar a volta. Se der, o estado está corrompido: tratar como "nada a
    // resgatar" é o lado seguro — não credita fundo nenhum.
    let resgatavel = vencido.saturating_sub(v.claimed);
    if resgatavel == 0 {
        return Err(erro("nada a resgatar ainda (cliff/linear)"));
    }
    let novo_resgatado = soma(v.claimed, resgatavel)?;
    soma(state.balance_of(&tx.from), resgatavel)?; // estouro conferido antes de mutar

    // --- daqui para baixo, só escrita ---
    state.debitar(&tx.from, ctx.fee)?;
    state.creditar(&tx.from, resgatavel)?;
    if novo_resgatado >= v.total {
        // Poda ao terminar: um cronograma esgotado só ocuparia espaço de estado.
        state.vesting.remove(&id);
    } else if let Some(reg) = state.vesting.get_mut(&id) {
        reg.claimed = novo_resgatado;
    }
    Ok(())
}

// ============================================================================
// DELEGAÇÃO DE RECURSO
// ============================================================================

fn delegate_resource(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < RESOURCE_HEIGHT {
        return Err(erro("delegação de recurso ainda não ativa"));
    }
    let para = match texto(campo(tx, "to")) {
        Some(t) if is_valid_address(t) => t.to_string(),
        _ => return Err(erro("delegatário inválido")),
    };
    if para == tx.from {
        return Err(erro("não pode delegar para si mesmo"));
    }
    // `data.amount` ausente é `'0'` na referência, e zero é rejeitado logo abaixo —
    // então a ausência produz "valor de delegação deve ser positivo", não um erro
    // de tipo. Reproduzir a mensagem importa: ela é observável no mempool.
    let valor = match campo(tx, "amount") {
        None | Some(JsonValue::Null) => 0,
        v => como_amount(v)?,
    };
    if valor == 0 {
        return Err(erro("valor de delegação deve ser positivo"));
    }
    let conta = state.account(&tx.from);
    let novo_out = soma(conta.delegated_out, valor)?;
    // O RECURSO delegado sai do stake, mas o VOTO fica: por isso o teto é o stake
    // total, e não `resource_stake`. Confundir os dois deixaria o delegante sem voto.
    if novo_out > conta.staked {
        return Err(erro("delegação excede o stake disponível"));
    }
    if conta.balance < ctx.fee {
        return Err(erro("saldo insuficiente para a taxa"));
    }
    let novo_in = soma(state.account(&para).delegated_in, valor)?;
    let nova_aresta = soma(
        state.delegations.get(&tx.from).and_then(|m| m.get(&para)).copied().unwrap_or(0),
        valor,
    )?;

    // --- daqui para baixo, só escrita ---
    state.debitar(&tx.from, ctx.fee)?;
    state.account_mut(&tx.from).delegated_out = novo_out;
    state.account_mut(&para).delegated_in = novo_in;
    state.delegations.entry(tx.from.clone()).or_default().insert(para, nova_aresta);
    Ok(())
}

fn undelegate_resource(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < RESOURCE_HEIGHT {
        return Err(erro("delegação de recurso ainda não ativa"));
    }
    let para = match texto(campo(tx, "to")) {
        Some(t) if is_valid_address(t) => t.to_string(),
        _ => return Err(erro("delegatário inválido")),
    };
    let valor = match campo(tx, "amount") {
        None | Some(JsonValue::Null) => 0,
        v => como_amount(v)?,
    };
    if valor == 0 {
        return Err(erro("valor deve ser positivo"));
    }
    let atual = state.delegations.get(&tx.from).and_then(|m| m.get(&para)).copied().unwrap_or(0);
    if atual < valor {
        return Err(erro("delegação insuficiente para retirar"));
    }
    if state.account(&tx.from).balance < ctx.fee {
        return Err(erro("saldo insuficiente para a taxa"));
    }
    let novo_out = sub(state.account(&tx.from).delegated_out, valor)?;
    let novo_in = sub(state.account(&para).delegated_in, valor)?;
    let resto = sub(atual, valor)?;

    // --- daqui para baixo, só escrita ---
    state.debitar(&tx.from, ctx.fee)?;
    state.account_mut(&tx.from).delegated_out = novo_out;
    state.account_mut(&para).delegated_in = novo_in;
    if resto > 0 {
        state.delegations.entry(tx.from.clone()).or_default().insert(para, resto);
    } else if let Some(m) = state.delegations.get_mut(&tx.from) {
        m.remove(&para);
        // Mapa vazio é REMOVIDO, não deixado. Deixá-lo mudaria a raiz de estado em
        // relação à referência, que faz `delete this.delegations[tx.from]`.
        if m.is_empty() {
            state.delegations.remove(&tx.from);
        }
    }
    Ok(())
}

// ============================================================================
// SLASH_DOUBLE_SIGN
// ============================================================================

/// Campo de um dos blocos-evidência.
fn campo_bloco<'a>(bloco: &'a JsonValue, chave: &str) -> Option<&'a JsonValue> {
    match bloco {
        JsonValue::Map(m) => m.get(chave),
        _ => None,
    }
}

fn slash_double_sign(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < SLASHING_HEIGHT {
        return Err(erro("slashing ainda não ativo"));
    }
    let (a, b) = match (campo(tx, "blockA"), campo(tx, "blockB")) {
        (Some(a @ JsonValue::Map(_)), Some(b @ JsonValue::Map(_))) => (a, b),
        _ => return Err(erro("evidência ausente")),
    };

    // Checagens BARATAS primeiro, na ordem da referência. As duas verificações
    // híbridas são caras, e rodá-las antes destas abriria o DoS de spammar SLASH
    // forçando criptografia cara de graça (mesma classe do achado M4 da auditoria).
    if campo_bloco(a, "producer") != campo_bloco(b, "producer") {
        return Err(erro("produtores diferentes — não é assinatura dupla"));
    }
    if campo_bloco(a, "height") != campo_bloco(b, "height") {
        return Err(erro("alturas diferentes — não é assinatura dupla"));
    }
    if campo_bloco(a, "hash") == campo_bloco(b, "hash") {
        return Err(erro("mesmo bloco — não há conflito"));
    }
    let conta_a = texto(campo_bloco(a, "producerAccount"));
    let conta_b = texto(campo_bloco(b, "producerAccount"));
    if conta_a != conta_b {
        return Err(erro("contas produtoras diferentes — não é assinatura dupla"));
    }
    // Quem ASSINA é a chave de produção; quem tem STAKE é a conta. Punir `producer`
    // cru cairia numa chave sem stake e a equivocação ficaria IMPUNE.
    let produtor = texto(campo_bloco(a, "producer")).unwrap_or("");
    let infrator = conta_a.unwrap_or(produtor).to_string();
    if let Some(ca) = conta_a {
        // Impede forjar evidência contra terceiro: só vale se a conta REALMENTE
        // delegou a produção a essa chave. Se o witness foi rotacionado desde então,
        // a evidência não é verificável e falhamos FECHADO — melhor não punir do
        // que punir inocente.
        let witness = state.permissions.get(ca).and_then(|p| p.witness());
        if witness != Some(produtor) {
            return Err(erro("chave assinante não é o witness registrado para a conta produtora"));
        }
    }
    let altura_evidencia = match campo_bloco(a, "height") {
        Some(JsonValue::Int(h)) if *h >= 0 => *h,
        _ => return Err(erro("altura da evidência inválida")),
    };
    let chave = format!("{infrator}:{altura_evidencia}");
    if state.slashed.get(&chave).copied().unwrap_or(false) {
        return Err(erro("essa assinatura dupla já foi penalizada"));
    }
    // Fundos EM UNBONDING continuam penalizáveis. Sem isso, o infrator dava UNSTAKE
    // logo após a ofensa e escapava com o grosso do stake.
    let mut em_unbonding: Amount = 0;
    for (dono, valor, _) in &state.unbonding {
        if dono == &infrator {
            em_unbonding = soma(em_unbonding, *valor)?;
        }
    }
    let em_risco = soma(state.account(&infrator).staked, em_unbonding)?;
    if em_risco == 0 {
        return Err(erro("infrator sem stake para penalizar"));
    }

    // A EVIDÊNCIA precisa ser criptograficamente válida (state.js:1375-1376). É o
    // único elo entre a acusação e o fato: sem isto, qualquer um montaria dois
    // objetos com o mesmo produtor e a mesma altura e queimaria 10% do stake de um
    // validador honesto. Os dois blocos passam pela MESMA verificação que a cadeia
    // aplica ao aceitá-los — hash canônica do cabeçalho + as duas assinaturas
    // híbridas.
    let bloco_a = crate::block::block_from_json(a)
        .map_err(|e| erro(format!("evidência A inválida: {e}")))?;
    crate::block::verify_block_integrity(&bloco_a)
        .map_err(|e| erro(format!("evidência A inválida: {e}")))?;
    let bloco_b = crate::block::block_from_json(b)
        .map_err(|e| erro(format!("evidência B inválida: {e}")))?;
    crate::block::verify_block_integrity(&bloco_b)
        .map_err(|e| erro(format!("evidência B inválida: {e}")))?;

    // -------- daqui para baixo, só mutação --------

    // MULTIPLICA ANTES DE DIVIDIR — a ordem da referência (state.js:1377-1378).
    // Inverter trunca duas vezes: com `em_risco = 1050`, `(1050*10)/100 = 105`, mas
    // `1050/100*10 = 100`. Diverge sempre que o stake em risco não é múltiplo de
    // 100 e7, o que é trivial de provocar — e a diferença cai em `staked`,
    // `total_burned` e no prêmio, ou seja, na folha `acct` e na raiz do estado.
    // `Vesting::vested` neste mesmo arquivo documenta a mesma regra.
    let penalidade = em_risco
        .checked_mul(SLASH_PERCENT as Amount)
        .ok_or_else(|| erro("estouro no cálculo da penalidade"))?
        / 100;
    let premio = penalidade
        .checked_mul(SLASH_REPORTER_PERCENT as Amount)
        .ok_or_else(|| erro("estouro no cálculo do prêmio"))?
        / 100;

    // A penalidade sai PRIMEIRO do stake e só então da fila de unbonding — a
    // ordem da referência (state.js:1380-1391). Inverter deixaria escapar quem
    // desstakeou logo após a ofensa.
    let mut restante = penalidade;
    {
        let conta = state.account_mut(&infrator);
        let do_stake = conta.staked.min(restante);
        conta.staked -= do_stake;
        restante -= do_stake;
    }
    if restante > 0 {
        let mut mantidos = Vec::with_capacity(state.unbonding.len());
        for (dono, valor, matura_em) in std::mem::take(&mut state.unbonding) {
            if dono != infrator || restante == 0 {
                mantidos.push((dono, valor, matura_em));
                continue;
            }
            let tirado = valor.min(restante);
            restante -= tirado;
            if valor - tirado > 0 {
                mantidos.push((dono, valor - tirado, matura_em));
            }
        }
        state.unbonding = mantidos;
    }

    // Se o slash deixou `delegated_out` SEM LASTRO (o stake caiu abaixo do
    // delegado), revoga o excesso: mantém `resource_stake >= 0` e não deixa o
    // delegatário com capacidade de recurso que nenhum stake real sustenta.
    //
    // ORDEM CANÔNICA POR endereço: a revogação para no primeiro destino que zera o
    // excesso (early-exit sobre recurso finito), então QUEM perde a delegação é
    // observável no estado. O `BTreeMap` itera por endereço NATIVAMENTE, e a
    // referência foi alinhada à mesma ordem (`Object.keys(dmap).sort()`,
    // state.js:1404) — endereços E7 são ASCII, então as duas coincidem.
    let (staked_apos, delegado) = {
        let c = state.account(&infrator);
        (c.staked, c.delegated_out)
    };
    if delegado > staked_apos {
        let mut excesso = delegado - staked_apos;
        let destinos: Vec<(String, Amount)> = state
            .delegations
            .get(&infrator)
            .map(|m| m.iter().map(|(k, v)| (k.clone(), *v)).collect())
            .unwrap_or_default();
        for (destino, valor) in destinos {
            if excesso == 0 {
                break;
            }
            let tirado = valor.min(excesso);
            excesso -= tirado;
            let alvo = state.account_mut(&destino);
            alvo.delegated_in = alvo.delegated_in.saturating_sub(tirado);
            if let Some(m) = state.delegations.get_mut(&infrator) {
                if valor - tirado > 0 {
                    m.insert(destino, valor - tirado);
                } else {
                    m.remove(&destino);
                }
            }
        }
        if state.delegations.get(&infrator).is_some_and(|m| m.is_empty()) {
            state.delegations.remove(&infrator);
        }
        state.account_mut(&infrator).delegated_out = staked_apos;
    }

    // O grosso da penalidade SOME do suprimento; só o prêmio muda de mãos.
    state.total_burned = soma(state.total_burned, penalidade - premio)?;
    state.creditar(&tx.from, premio)?;
    state.slashed.insert(chave, true);
    Ok(())
}

// ============================================================================
// Testes
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::address::derive_address_from;
    use crate::state::Account;

    const ACIMA: u64 = 1_901_000; // acima de todos os forks, como `vectors/state.json`

    fn alice() -> String {
        derive_address_from("VETOR:alice")
    }
    fn bob() -> String {
        derive_address_from("VETOR:bob")
    }
    fn carol() -> String {
        derive_address_from("VETOR:carol")
    }

    fn ctx(height: u64) -> Ctx {
        Ctx { height, block_ts: 1_700_000_000_000, fee: 0 }
    }
    fn ctx_com_taxa(height: u64, fee: Amount) -> Ctx {
        Ctx { height, block_ts: 1_700_000_000_000, fee }
    }

    /// Transação mínima do tipo pedido, sem `data`.
    fn tx(tipo: &str) -> Tx {
        let mut t = Tx::new(tipo, alice(), 1, 1_700_000_000_000);
        t.id = Some("a".repeat(64));
        t
    }
    fn com_dados(tipo: &str, pares: &[(&str, JsonValue)]) -> Tx {
        let mut t = tx(tipo);
        t.data = Some(JsonValue::map(
            pares.iter().map(|(k, v)| ((*k).to_string(), v.clone())),
        ));
        t
    }

    fn conta(saldo: Amount, staked: Amount) -> Account {
        Account { balance: saldo, staked, ..Default::default() }
    }

    /// Estado com Alice e Bob, ambos com stake acima do mínimo de validador — o
    /// piso que a maioria dos casos precisa para não esbarrar em outra regra.
    fn estado_base() -> State {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(100_000_000, 5_000_000_000));
        s.accounts.insert(bob(), conta(100_000_000, 2_000_000_000));
        s
    }

    /// Impressão determinística do estado inteiro. `State` não implementa
    /// `PartialEq`, e comparar campo a campo esqueceria justamente o campo que o
    /// manipulador sujou por engano — que é o bug que estes testes caçam.
    fn impressao(s: &State) -> String {
        format!("{s:?}")
    }

    /// O invariante central: se `aplicar` devolve `Err`, NADA mudou.
    fn rejeita_sem_sujar(s: &mut State, t: &Tx, c: &Ctx, esperado: &str) {
        let antes = impressao(s);
        let r = aplicar(s, t, c);
        assert_eq!(r, Err(erro(esperado)), "mensagem de erro divergiu da referência");
        assert_eq!(impressao(s), antes, "rejeição SUJOU o estado — invariante quebrado");
    }

    // ---------------------------------------------------------------- TRANSFER

    #[test]
    fn transfer_move_saldo() {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(1_000_000_000, 0));
        let mut t = tx("TRANSFER");
        t.to = Some(bob());
        t.amount = "5000000".into();
        assert!(aplicar(&mut s, &t, &ctx(ACIMA)).is_ok());
        assert_eq!(s.balance_of(&alice()), 995_000_000);
        assert_eq!(s.balance_of(&bob()), 5_000_000);
    }

    #[test]
    fn transfer_para_si_mesmo_so_perde_a_taxa() {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(10_000_000, 0));
        let mut t = tx("TRANSFER");
        t.to = Some(alice());
        t.amount = "1000000".into();
        assert!(aplicar(&mut s, &t, &ctx_com_taxa(ACIMA, 7)).is_ok());
        assert_eq!(s.balance_of(&alice()), 10_000_000 - 7, "só a taxa sai");
    }

    #[test]
    fn transfer_sem_saldo_e_rejeitada_sem_sujar() {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(100, 0));
        let mut t = tx("TRANSFER");
        t.to = Some(bob());
        t.amount = "5000000".into();
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "saldo insuficiente");
        // E, em especial, NÃO materializou o destino: uma conta-fantasma de saldo
        // zero mudaria a raiz do estado sem que nada tivesse sido aplicado.
        assert!(!s.accounts.contains_key(&bob()));
    }

    #[test]
    fn transfer_de_zero_e_rejeitada() {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(10_000_000, 0));
        let mut t = tx("TRANSFER");
        t.to = Some(bob());
        t.amount = "0".into();
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "valor da transferência deve ser positivo");
    }

    #[test]
    fn transfer_a_taxa_entra_na_checagem_de_saldo() {
        // Saldo cobre o valor mas NÃO valor+taxa. Checar só o valor deixaria o saldo
        // negativo — em u128, daria a volta para um número astronômico.
        let mut s = State::new();
        s.accounts.insert(alice(), conta(1_000, 0));
        let mut t = tx("TRANSFER");
        t.to = Some(bob());
        t.amount = "1000".into();
        rejeita_sem_sujar(&mut s, &t, &ctx_com_taxa(ACIMA, 1), "saldo insuficiente");
    }

    // ------------------------------------------------------------------- STAKE

    #[test]
    fn stake_move_saldo_para_stake() {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(10_000_000_000, 0));
        let mut t = tx("STAKE");
        t.amount = "5000000000".into();
        assert!(aplicar(&mut s, &t, &ctx(ACIMA)).is_ok());
        assert_eq!(s.account(&alice()).balance, 5_000_000_000);
        assert_eq!(s.account(&alice()).staked, 5_000_000_000);
    }

    #[test]
    fn stake_sem_saldo_e_rejeitado_sem_sujar() {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(10, 0));
        let mut t = tx("STAKE");
        t.amount = "5000000000".into();
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "saldo insuficiente");
    }

    #[test]
    fn stake_de_zero_e_rejeitado() {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(10_000_000_000, 0));
        let t = tx("STAKE");
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "stake deve ser positivo");
    }

    /// STAKE pela rota EVM é ACEITO e marca a conta como `eavm_managed`.
    ///
    /// O porte recusava, alegando que `Account` não tinha o campo e que a
    /// verificação já barrava o esquema EAVM — as duas coisas deixaram de ser
    /// verdade. O efeito era um nó que caía na primeira vez que alguém stakeasse
    /// pela MetaMask (endereço de sistema `0x…7001`), e que ainda assim aceitava
    /// o `UNSTAKE` correspondente. Espelha `state.js:1210`.
    #[test]
    fn stake_pela_rota_eavm_marca_a_conta_como_gerenciada() {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(10_000_000_000, 0));
        let mut t = tx("STAKE");
        t.scheme = EAVM_SCHEME.into();
        t.amount = "1000000".into();
        aplicar(&mut s, &t, &ctx(ACIMA)).expect("stake pela rota EAVM tem de ser aceito");

        let c = s.account(&alice());
        assert_eq!(c.staked, 1_000_000);
        assert!(c.eavm_managed, "a conta tem de ficar marcada como gerenciada pela EAVM");

        // E o stake NATIVO não marca — a distinção é o ponto da regra.
        let mut s2 = State::new();
        s2.accounts.insert(bob(), conta(10_000_000_000, 0));
        let mut t2 = tx("STAKE");
        t2.from = bob();
        t2.amount = "1000000".into();
        aplicar(&mut s2, &t2, &ctx(ACIMA)).expect("stake nativo");
        assert!(!s2.account(&bob()).eavm_managed);
    }

    /// Conta `eavm_managed` NÃO conta como validador para a guarda do último
    /// validador — ela não tem chave híbrida e nunca assinaria um bloco.
    ///
    /// Sem este filtro, o `UNSTAKE` do único validador REAL passaria (a guarda
    /// veria a conta EVM como substituta), o conjunto ativo ficaria vazio e a
    /// cadeia travaria sem produtor. É o mesmo filtro de `validators()`.
    #[test]
    fn conta_gerenciada_pela_eavm_nao_conta_como_validador() {
        let min = MIN_VALIDATOR_STAKE;
        let mut s = State::new();
        // Único validador real.
        s.accounts.insert(alice(), conta(0, min));
        // Conta com stake suficiente, mas gerenciada pela EAVM.
        let mut evm = conta(0, min * 4);
        evm.eavm_managed = true;
        s.accounts.insert(bob(), evm);

        // Tirar todo o stake do ÚNICO validador real tem de ser recusado: a
        // conta EVM não o substitui.
        let mut t = tx("UNSTAKE");
        t.amount = min.to_string();
        let e = aplicar(&mut s, &t, &ctx(ACIMA)).unwrap_err();
        assert!(
            e.0.contains("validador"),
            "a guarda do último validador tem de barrar: {}",
            e.0
        );
    }

    // ----------------------------------------------------------------- UNSTAKE

    #[test]
    fn unstake_entra_na_fila_e_nao_volta_na_hora() {
        let mut s = estado_base();
        let mut t = tx("UNSTAKE");
        t.amount = "1000000000".into();
        assert!(aplicar(&mut s, &t, &ctx(ACIMA)).is_ok());
        assert_eq!(s.account(&alice()).staked, 4_000_000_000);
        assert_eq!(s.balance_of(&alice()), 100_000_000, "o saldo NÃO volta agora");
        assert_eq!(s.unbonding, vec![(alice(), 1_000_000_000, ACIMA + UNBONDING_BLOCKS)]);
    }

    #[test]
    fn unstake_acima_do_stake_e_rejeitado_sem_sujar() {
        let mut s = estado_base();
        let mut t = tx("UNSTAKE");
        t.amount = "9000000000".into();
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "stake insuficiente");
    }

    #[test]
    fn unstake_sem_saldo_para_a_taxa_e_rejeitado() {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(0, 5_000_000_000));
        s.accounts.insert(bob(), conta(0, 5_000_000_000));
        let mut t = tx("UNSTAKE");
        t.amount = "1000000".into();
        rejeita_sem_sujar(&mut s, &t, &ctx_com_taxa(ACIMA, 10), "saldo insuficiente para a taxa");
    }

    #[test]
    fn unstake_nao_pode_deixar_votos_sem_lastro() {
        let mut s = estado_base();
        s.votes.insert(alice(), BTreeMap::from([(bob(), 4_500_000_000)]));
        let mut t = tx("UNSTAKE");
        t.amount = "1000000000".into(); // sobraria 4e9 < 4,5e9 de votos
        rejeita_sem_sujar(
            &mut s,
            &t,
            &ctx(ACIMA),
            "unstake deixaria votos sem lastro; refaça VOTE (reduza os votos) primeiro",
        );
    }

    #[test]
    fn unstake_nao_pode_deixar_delegacao_sem_lastro() {
        let mut s = estado_base();
        s.account_mut(&alice()).delegated_out = 4_500_000_000;
        let mut t = tx("UNSTAKE");
        t.amount = "1000000000".into();
        rejeita_sem_sujar(
            &mut s,
            &t,
            &ctx(ACIMA),
            "unstake deixaria recurso delegado sem lastro; retire a delegação primeiro",
        );
    }

    #[test]
    fn unstake_nao_remove_o_ultimo_validador() {
        // Alice é a ÚNICA acima do mínimo. Deixá-la sair para o halt permanente.
        let mut s = State::new();
        s.accounts.insert(alice(), conta(100_000_000, 5_000_000_000));
        let mut t = tx("UNSTAKE");
        t.amount = "5000000000".into();
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "não é possível remover o último validador ativo da rede");
    }

    #[test]
    fn unstake_teto_de_fila_so_vale_a_partir_do_fork() {
        let encher = |altura: u64| {
            let mut s = estado_base();
            for _ in 0..MAX_UNBONDING_ENTRIES {
                s.unbonding.push((alice(), 1, altura));
            }
            let mut t = tx("UNSTAKE");
            t.amount = "1000000".into();
            let r = aplicar(&mut s, &t, &ctx(altura));
            (s, r)
        };
        // Abaixo do fork a fila é ILIMITADA — replay do histórico antigo intacto.
        let (s_antes, r_antes) = encher(PERMISSIONS_V2_HEIGHT - 1);
        assert!(r_antes.is_ok());
        assert_eq!(s_antes.unbonding.len(), MAX_UNBONDING_ENTRIES + 1);
        // Na altura do fork, o teto passa a valer.
        let (_, r_depois) = encher(PERMISSIONS_V2_HEIGHT);
        assert_eq!(r_depois, Err(erro("limite de 32 saques simultâneos atingido")));
    }

    // -------------------------------------------------------------------- VOTE

    fn tx_vote(candidato: &str, valor: &str) -> Tx {
        com_dados(
            "VOTE",
            &[("votes", JsonValue::map([(candidato.to_string(), JsonValue::str(valor))]))],
        )
    }

    #[test]
    fn vote_aloca_e_credita_o_candidato() {
        let mut s = estado_base();
        let t = tx_vote(&bob(), "3000000000");
        assert!(aplicar(&mut s, &t, &ctx(ACIMA)).is_ok());
        assert_eq!(s.candidate_votes.get(&bob()), Some(&3_000_000_000));
        assert_eq!(s.votes.get(&alice()).unwrap().get(&bob()), Some(&3_000_000_000));
    }

    #[test]
    fn vote_abaixo_da_altura_de_fork_e_rejeitado_e_aceito_acima() {
        // O caso que um cliente PRECISA acertar: a MESMA transação, duas alturas.
        let t = tx_vote(&bob(), "1000000000");
        let mut antes = estado_base();
        rejeita_sem_sujar(&mut antes, &t, &ctx(VOTING_HEIGHT - 1), "votação de validadores ainda não ativa");

        let mut depois = estado_base();
        assert!(aplicar(&mut depois, &t, &ctx(VOTING_HEIGHT)).is_ok(), "válida NA altura do fork");
    }

    #[test]
    fn vote_acima_do_stake_e_rejeitado_sem_sujar() {
        let mut s = estado_base();
        let t = tx_vote(&bob(), "9000000000");
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "votos excedem o poder de voto (stake)");
    }

    #[test]
    fn vote_em_candidato_inelegivel_e_rejeitado() {
        let mut s = estado_base();
        s.accounts.insert(carol(), conta(1, 0)); // self-stake abaixo do mínimo
        let t = tx_vote(&carol(), "1000");
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "candidato não elegível (self-stake abaixo do mínimo)");
    }

    #[test]
    fn vote_em_si_mesmo_e_rejeitado() {
        let mut s = estado_base();
        let t = tx_vote(&alice(), "1000");
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "não pode votar em si mesmo (o self-stake já conta)");
    }

    #[test]
    fn vote_vazio_ou_grande_demais_e_rejeitado() {
        let mut s = estado_base();
        let vazia = com_dados("VOTE", &[("votes", JsonValue::map([]))]);
        rejeita_sem_sujar(&mut s, &vazia, &ctx(ACIMA), "nº de candidatos inválido");

        let muitos = JsonValue::map((0..=MAX_VOTE_TARGETS).map(|i| {
            (derive_address_from(format!("VETOR:cand{i}")), JsonValue::str("1"))
        }));
        let t = com_dados("VOTE", &[("votes", muitos)]);
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "nº de candidatos inválido");
    }

    #[test]
    fn vote_realocado_liquida_a_recompensa_antes_de_mexer_nos_votos() {
        // Se a nova alocação zerasse os votos antes de liquidar, o eleitor perderia
        // tudo o que acumulou — e ninguém notaria, porque a tx teria sucesso.
        let mut s = estado_base();
        s.accounts.insert(carol(), conta(100_000_000, 2_000_000_000));
        assert!(aplicar(&mut s, &tx_vote(&bob(), "1000000000"), &ctx(ACIMA)).is_ok());
        // Bob produz blocos: o acumulador dele sobe (2 unidades por voto, escaladas).
        s.reward_acc_per_vote.insert(bob(), 2 * REWARD_SCALE);

        let saldo_antes = s.balance_of(&alice());
        assert!(aplicar(&mut s, &tx_vote(&carol(), "1000000000"), &ctx(ACIMA)).is_ok());
        assert_eq!(
            s.balance_of(&alice()),
            saldo_antes + 2_000_000_000,
            "1e9 votos × 2 por voto tinham de ser liquidados na realocação"
        );
        assert!(!s.candidate_votes.contains_key(&bob()), "zero é removido, não guardado");
        assert_eq!(s.candidate_votes.get(&carol()), Some(&1_000_000_000));
    }

    // -------------------------------------------------------- CLAIM_VOTER_REWARD

    #[test]
    fn claim_voter_reward_credita_o_pendente_e_zera_a_divida() {
        let mut s = estado_base();
        assert!(aplicar(&mut s, &tx_vote(&bob(), "1000000000"), &ctx(ACIMA)).is_ok());
        s.reward_acc_per_vote.insert(bob(), 3 * REWARD_SCALE);

        let saldo_antes = s.balance_of(&alice());
        let t = com_dados("CLAIM_VOTER_REWARD", &[("validator", JsonValue::str(bob()))]);
        assert!(aplicar(&mut s, &t, &ctx(ACIMA)).is_ok());
        assert_eq!(s.balance_of(&alice()), saldo_antes + 3_000_000_000);

        // Resgatar de novo não paga nada: a dívida foi zerada no ponto atual.
        let saldo = s.balance_of(&alice());
        assert!(aplicar(&mut s, &t, &ctx(ACIMA)).is_ok());
        assert_eq!(s.balance_of(&alice()), saldo, "resgate duplo não pode pagar duas vezes");
    }

    #[test]
    fn claim_voter_reward_sem_voto_e_rejeitado_sem_sujar() {
        let mut s = estado_base();
        let t = com_dados("CLAIM_VOTER_REWARD", &[("validator", JsonValue::str(bob()))]);
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "você não vota nesse validador");
    }

    #[test]
    fn claim_voter_reward_respeita_a_altura_de_fork() {
        let mut s = estado_base();
        let t = com_dados("CLAIM_VOTER_REWARD", &[("validator", JsonValue::str(bob()))]);
        rejeita_sem_sujar(&mut s, &t, &ctx(VOTING_HEIGHT - 1), "votação ainda não ativa");
    }

    // --------------------------------------------------------- SET_COMMISSION

    #[test]
    fn set_commission_entra_em_fila_a_partir_do_fork() {
        let mut s = estado_base();
        let t = com_dados("SET_COMMISSION", &[("percent", JsonValue::Int(15))]);
        assert!(aplicar(&mut s, &t, &ctx(PERMISSIONS_V2_HEIGHT)).is_ok());
        assert_eq!(
            s.pending_commission.get(&alice()),
            Some(&(15u8, PERMISSIONS_V2_HEIGHT + COMMISSION_DELAY_BLOCKS))
        );
        assert!(s.commission.is_empty(), "não pode valer na hora — captura a recompensa dos eleitores");
    }

    #[test]
    fn set_commission_vale_na_hora_abaixo_do_fork() {
        let mut s = estado_base();
        let t = com_dados("SET_COMMISSION", &[("percent", JsonValue::Int(15))]);
        assert!(aplicar(&mut s, &t, &ctx(PERMISSIONS_V2_HEIGHT - 1)).is_ok());
        assert_eq!(s.commission.get(&alice()), Some(&15u8));
        assert!(s.pending_commission.is_empty());
    }

    #[test]
    fn set_commission_fora_da_faixa_e_rejeitada_sem_sujar() {
        let mut s = estado_base();
        for pct in [JsonValue::Int(150), JsonValue::Int(-1)] {
            let t = com_dados("SET_COMMISSION", &[("percent", pct)]);
            rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "comissão deve ser 0..100");
        }
        // Campo ausente também: `Number(undefined)` é NaN na referência.
        let t = tx("SET_COMMISSION");
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "comissão deve ser 0..100");
    }

    #[test]
    fn set_commission_nas_pontas_da_faixa_e_aceita() {
        for pct in [0i64, 100] {
            let mut s = estado_base();
            let t = com_dados("SET_COMMISSION", &[("percent", JsonValue::Int(pct))]);
            assert!(aplicar(&mut s, &t, &ctx(ACIMA)).is_ok(), "{pct} está na faixa");
        }
    }

    #[test]
    fn set_commission_abaixo_da_altura_de_votacao_e_rejeitada() {
        let mut s = estado_base();
        let t = com_dados("SET_COMMISSION", &[("percent", JsonValue::Int(15))]);
        rejeita_sem_sujar(&mut s, &t, &ctx(VOTING_HEIGHT - 1), "votação ainda não ativa");
    }

    // ----------------------------------------------------------- DELEGAÇÃO

    fn tx_delegacao(tipo: &str, para: &str, valor: &str) -> Tx {
        com_dados(tipo, &[("to", JsonValue::str(para)), ("amount", JsonValue::str(valor))])
    }

    #[test]
    fn delegate_resource_move_capacidade_sem_mover_voto() {
        let mut s = estado_base();
        let t = tx_delegacao("DELEGATE_RESOURCE", &bob(), "1000000000");
        assert!(aplicar(&mut s, &t, &ctx(ACIMA)).is_ok());
        assert_eq!(s.account(&alice()).delegated_out, 1_000_000_000);
        assert_eq!(s.account(&bob()).delegated_in, 1_000_000_000);
        assert_eq!(s.account(&alice()).staked, 5_000_000_000, "o stake — e o voto — ficam");
        assert_eq!(s.account(&alice()).resource_stake().unwrap(), 4_000_000_000);
        assert_eq!(s.account(&bob()).resource_stake().unwrap(), 3_000_000_000);
    }

    #[test]
    fn delegate_resource_acima_do_stake_e_rejeitado_sem_sujar() {
        let mut s = estado_base();
        let t = tx_delegacao("DELEGATE_RESOURCE", &bob(), "9000000000");
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "delegação excede o stake disponível");
    }

    #[test]
    fn delegate_resource_respeita_a_altura_de_fork() {
        let mut s = estado_base();
        let t = tx_delegacao("DELEGATE_RESOURCE", &bob(), "1000");
        rejeita_sem_sujar(&mut s, &t, &ctx(RESOURCE_HEIGHT - 1), "delegação de recurso ainda não ativa");
        assert!(aplicar(&mut estado_base(), &t, &ctx(RESOURCE_HEIGHT)).is_ok());
    }

    #[test]
    fn delegate_resource_para_si_mesmo_e_rejeitado() {
        let mut s = estado_base();
        let t = tx_delegacao("DELEGATE_RESOURCE", &alice(), "1000");
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "não pode delegar para si mesmo");
    }

    #[test]
    fn undelegate_devolve_e_poda_o_mapa_vazio() {
        let mut s = estado_base();
        assert!(aplicar(&mut s, &tx_delegacao("DELEGATE_RESOURCE", &bob(), "1000"), &ctx(ACIMA)).is_ok());
        assert!(aplicar(&mut s, &tx_delegacao("UNDELEGATE_RESOURCE", &bob(), "400"), &ctx(ACIMA)).is_ok());
        assert_eq!(s.delegations[&alice()][&bob()], 600);
        assert_eq!(s.account(&alice()).delegated_out, 600);

        assert!(aplicar(&mut s, &tx_delegacao("UNDELEGATE_RESOURCE", &bob(), "600"), &ctx(ACIMA)).is_ok());
        assert!(s.delegations.is_empty(), "mapa vazio tem de ser REMOVIDO, não deixado");
        assert_eq!(s.account(&alice()).delegated_out, 0);
        assert_eq!(s.account(&bob()).delegated_in, 0);
    }

    #[test]
    fn undelegate_acima_do_delegado_e_rejeitado_sem_sujar() {
        let mut s = estado_base();
        assert!(aplicar(&mut s, &tx_delegacao("DELEGATE_RESOURCE", &bob(), "1000"), &ctx(ACIMA)).is_ok());
        let t = tx_delegacao("UNDELEGATE_RESOURCE", &bob(), "2000");
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "delegação insuficiente para retirar");
    }

    // ----------------------------------------------------------------- VESTING

    fn tx_vesting_create(valor: &str, cliff: i64, duracao: i64) -> Tx {
        let mut t = com_dados(
            "VESTING_CREATE",
            &[
                ("beneficiary", JsonValue::str(bob())),
                ("cliffBlocks", JsonValue::Int(cliff)),
                ("durationBlocks", JsonValue::Int(duracao)),
            ],
        );
        t.amount = valor.into();
        t
    }

    #[test]
    fn vesting_create_trava_o_valor() {
        let mut s = estado_base();
        let t = tx_vesting_create("1000000", 100, 1000);
        assert!(aplicar(&mut s, &t, &ctx(ACIMA)).is_ok());
        assert_eq!(s.balance_of(&alice()), 100_000_000 - 1_000_000);
        let v = &s.vesting[&t.id.clone().unwrap()];
        assert_eq!((v.total, v.claimed, v.start, v.cliff, v.duration), (1_000_000, 0, ACIMA, 100, 1000));
    }

    #[test]
    fn vesting_create_sem_saldo_e_rejeitado_sem_sujar() {
        let mut s = State::new();
        s.accounts.insert(alice(), conta(10, 0));
        let t = tx_vesting_create("1000000", 0, 1000);
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "saldo insuficiente para travar o vesting");
    }

    #[test]
    fn vesting_create_valida_duracao_e_cliff() {
        let mut s = estado_base();
        rejeita_sem_sujar(&mut s, &tx_vesting_create("1000", 0, 0), &ctx(ACIMA), "duração inválida");
        rejeita_sem_sujar(
            &mut s,
            &tx_vesting_create("1000", 0, MAX_VESTING_BLOCKS + 1),
            &ctx(ACIMA),
            "duração inválida",
        );
        // Cliff maior que a duração travaria os fundos para SEMPRE.
        rejeita_sem_sujar(&mut s, &tx_vesting_create("1000", 101, 100), &ctx(ACIMA), "cliff inválido");
        rejeita_sem_sujar(&mut s, &tx_vesting_create("1000", -1, 100), &ctx(ACIMA), "cliff inválido");
    }

    #[test]
    fn vesting_create_respeita_a_altura_de_fork() {
        let mut s = estado_base();
        let t = tx_vesting_create("1000", 0, 100);
        rejeita_sem_sujar(&mut s, &t, &ctx(VESTING_HEIGHT - 1), "vesting ainda não ativo");
    }

    #[test]
    fn vesting_libera_zero_antes_do_cliff_e_linear_depois() {
        let v = Vesting {
            beneficiary: bob(),
            total: 1_000_000,
            claimed: 0,
            start: 1_000,
            cliff: 100,
            duration: 1_000,
        };
        assert_eq!(v.vested(1_099).unwrap(), 0, "um bloco antes do cliff: nada");
        assert_eq!(v.vested(1_100).unwrap(), 100_000, "no cliff: 10% do tempo decorrido");
        assert_eq!(v.vested(1_500).unwrap(), 500_000);
        assert_eq!(v.vested(1_999).unwrap(), 999_000);
        assert_eq!(v.vested(2_000).unwrap(), 1_000_000, "no fim: total");
        assert_eq!(v.vested(9_999).unwrap(), 1_000_000, "nunca passa do total");
    }

    #[test]
    fn vesting_claim_resgata_o_vencido_e_poda_no_fim() {
        let mut s = estado_base();
        s.accounts.insert(bob(), conta(100_000_000, 2_000_000_000));
        let criar = tx_vesting_create("1000000", 0, 1000);
        assert!(aplicar(&mut s, &criar, &ctx(ACIMA)).is_ok());
        let id = criar.id.clone().unwrap();

        let mut resgatar = com_dados("VESTING_CLAIM", &[("vestingId", JsonValue::str(&id))]);
        resgatar.from = bob();

        let saldo = s.balance_of(&bob());
        assert!(aplicar(&mut s, &resgatar, &ctx(ACIMA + 500)).is_ok());
        assert_eq!(s.balance_of(&bob()), saldo + 500_000, "metade do prazo, metade do valor");
        assert_eq!(s.vesting[&id].claimed, 500_000);

        assert!(aplicar(&mut s, &resgatar, &ctx(ACIMA + 1000)).is_ok());
        assert_eq!(s.balance_of(&bob()), saldo + 1_000_000);
        assert!(!s.vesting.contains_key(&id), "cronograma esgotado tem de ser podado");
    }

    #[test]
    fn vesting_claim_so_pelo_beneficiario_e_so_com_algo_vencido() {
        let mut s = estado_base();
        let criar = tx_vesting_create("1000000", 500, 1000);
        assert!(aplicar(&mut s, &criar, &ctx(ACIMA)).is_ok());
        let id = criar.id.clone().unwrap();
        let resgatar = com_dados("VESTING_CLAIM", &[("vestingId", JsonValue::str(&id))]);

        // Alice criou, Bob é o beneficiário: Alice não resgata.
        rejeita_sem_sujar(&mut s, &resgatar, &ctx(ACIMA + 600), "só o beneficiário resgata");

        let mut de_bob = resgatar.clone();
        de_bob.from = bob();
        rejeita_sem_sujar(&mut s, &de_bob, &ctx(ACIMA + 499), "nada a resgatar ainda (cliff/linear)");

        let mut inexistente = com_dados("VESTING_CLAIM", &[("vestingId", JsonValue::str("b".repeat(64)))]);
        inexistente.from = bob();
        rejeita_sem_sujar(&mut s, &inexistente, &ctx(ACIMA), "vesting inexistente");
    }

    // ------------------------------------------------------- SLASH_DOUBLE_SIGN

    fn bloco(produtor: &str, altura: i64, hash: &str, conta_produtora: Option<&str>) -> JsonValue {
        let mut m = BTreeMap::from([
            ("producer".to_string(), JsonValue::str(produtor)),
            ("height".to_string(), JsonValue::Int(altura)),
            ("hash".to_string(), JsonValue::str(hash)),
        ]);
        if let Some(c) = conta_produtora {
            m.insert("producerAccount".to_string(), JsonValue::str(c));
        }
        JsonValue::Map(m)
    }

    fn tx_slash(a: JsonValue, b: JsonValue) -> Tx {
        com_dados("SLASH_DOUBLE_SIGN", &[("blockA", a), ("blockB", b)])
    }

    #[test]
    fn slash_respeita_a_altura_de_fork() {
        let mut s = estado_base();
        let t = tx_slash(bloco(&bob(), 10, "aa", None), bloco(&bob(), 10, "bb", None));
        rejeita_sem_sujar(&mut s, &t, &ctx(SLASHING_HEIGHT - 1), "slashing ainda não ativo");
    }

    #[test]
    fn slash_rejeita_evidencia_que_nao_e_conflito() {
        let mut s = estado_base();
        let casos: Vec<(Tx, &str)> = vec![
            (tx("SLASH_DOUBLE_SIGN"), "evidência ausente"),
            (
                tx_slash(bloco(&bob(), 10, "aa", None), bloco(&carol(), 10, "bb", None)),
                "produtores diferentes — não é assinatura dupla",
            ),
            (
                tx_slash(bloco(&bob(), 10, "aa", None), bloco(&bob(), 11, "bb", None)),
                "alturas diferentes — não é assinatura dupla",
            ),
            (
                tx_slash(bloco(&bob(), 10, "aa", None), bloco(&bob(), 10, "aa", None)),
                "mesmo bloco — não há conflito",
            ),
            (
                tx_slash(bloco(&bob(), 10, "aa", Some(&carol())), bloco(&bob(), 10, "bb", None)),
                "contas produtoras diferentes — não é assinatura dupla",
            ),
        ];
        for (t, esperado) in casos {
            rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), esperado);
        }
    }

    #[test]
    fn slash_exige_witness_registrado_para_a_conta_produtora() {
        // Sem esta guarda, qualquer um forja evidência contra a conta de terceiro
        // apontando uma chave produtora arbitrária.
        let mut s = estado_base();
        let t = tx_slash(
            bloco(&bob(), 10, "aa", Some(&carol())),
            bloco(&bob(), 10, "bb", Some(&carol())),
        );
        rejeita_sem_sujar(
            &mut s,
            &t,
            &ctx(ACIMA),
            "chave assinante não é o witness registrado para a conta produtora",
        );
    }

    #[test]
    fn slash_infrator_sem_stake_e_rejeitado_antes_da_criptografia_cara() {
        let mut s = estado_base();
        s.accounts.insert(carol(), conta(1, 0)); // sem stake e sem unbonding
        let t = tx_slash(bloco(&carol(), 10, "aa", None), bloco(&carol(), 10, "bb", None));
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "infrator sem stake para penalizar");
    }

    #[test]
    fn slash_com_evidencia_forjada_e_rejeitado_sem_mutar() {
        // Dois objetos com o mesmo produtor e a mesma altura NÃO bastam: a evidência
        // passa pela MESMA verificação de integridade que a cadeia aplica ao aceitar
        // um bloco (hash canônica + as duas assinaturas híbridas). Sem isso qualquer
        // um queimaria 10% do stake de um validador honesto montando dois mapas.
        let mut s = estado_base();
        let t = tx_slash(bloco(&bob(), 10, "aa", None), bloco(&bob(), 10, "bb", None));
        let antes = impressao(&s);
        let e = aplicar(&mut s, &t, &ctx(ACIMA)).unwrap_err();
        assert!(e.0.contains("evidência A inválida"), "{}", e.0);
        assert_eq!(impressao(&s), antes, "rejeição não pode deixar rastro");
    }

    /// A ORDEM da aritmética da penalidade — multiplicar antes de dividir.
    ///
    /// Com stake que NÃO é múltiplo de 100 e7, dividir primeiro trunca duas vezes:
    /// `1_000_000_050/100*10 = 100_000_000` contra `(1_000_000_050*10)/100 =
    /// 100_000_005`. A diferença cai em `staked`, `total_burned` e no prêmio — ou
    /// seja, na folha `acct` e na raiz do estado. Este teste usa valores LITERAIS
    /// justamente para não repetir a fórmula que deveria estar validando.
    #[test]
    fn penalidade_multiplica_antes_de_dividir() {
        use crate::block::teste_util::Carteira;
        use crate::block::{block_to_json, build_block, BuildParams};

        let infrator = Carteira::nova(31);
        let denunciante = alice();
        // 1000.000050 EAV7 — de propósito NÃO múltiplo de 100 e7.
        let stake: Amount = 1_000_000_050;

        let mut s = State::new();
        s.accounts.insert(infrator.endereco(), conta(0, stake));
        s.accounts.insert(denunciante.clone(), conta(0, 0));

        let mk = |ts: i64| {
            build_block(
                &infrator,
                BuildParams {
                    height: 10,
                    previous_hash: "a".repeat(64),
                    timestamp: ts,
                    transactions: Vec::new(),
                    state_root: None,
                    producer_account: None,
                },
            )
            .expect("bloco")
        };
        let mut t = tx_slash(block_to_json(&mk(1_000)), block_to_json(&mk(2_000)));
        t.from = denunciante.clone();
        aplicar(&mut s, &t, &ctx(ACIMA)).expect("evidência real");

        // (1_000_000_050 * 10) / 100 — não 1_000_000_050 / 100 * 10.
        assert_eq!(s.account(&infrator.endereco()).staked, stake - 100_000_005);
        // (100_000_005 * 10) / 100
        assert_eq!(s.account(&denunciante).balance, 10_000_000);
        assert_eq!(s.total_burned, 100_000_005 - 10_000_000);
    }

    /// O caminho de SUCESSO do slashing, com dois blocos REAIS assinados pela mesma
    /// carteira na mesma altura — a equivocação que a regra existe para punir.
    ///
    /// Este teste faltava porque o handler era um `Err` fixo ("módulo de bloco não
    /// portado") — mas o módulo JÁ existia; o comentário é que envelheceu. Sem o
    /// caminho quente coberto, a penalidade, o prêmio e a queima nunca foram
    /// exercitados.
    #[test]
    fn slash_com_evidencia_real_penaliza_queima_e_premia_o_denunciante() {
        use crate::block::teste_util::Carteira;
        use crate::block::{block_to_json, build_block, BuildParams};

        let infrator = Carteira::nova(21);
        let denunciante = alice();

        let mut s = State::new();
        // 1000 EAV7 de stake — a penalidade é 10% disso.
        s.accounts.insert(infrator.endereco(), conta(0, 1_000_000_000));
        s.accounts.insert(denunciante.clone(), conta(0, 0));

        // Dois blocos DE VERDADE, mesma altura, mesmo produtor, conteúdo diferente.
        let mk = |ts: i64| {
            build_block(
                &infrator,
                BuildParams {
                    height: 10,
                    previous_hash: "a".repeat(64),
                    timestamp: ts,
                    transactions: Vec::new(),
                    state_root: None,
                    producer_account: None,
                },
            )
            .expect("bloco")
        };
        let (a, b) = (mk(1_000), mk(2_000));
        assert_ne!(a.hash, b.hash, "os dois blocos têm de diferir");

        let mut t = tx_slash(block_to_json(&a), block_to_json(&b));
        t.from = denunciante.clone();
        aplicar(&mut s, &t, &ctx(ACIMA)).expect("evidência real tem de ser aceita");

        // Penalidade = 10% de 1000 EAV7; prêmio = 10% da penalidade.
        // Valores LITERAIS, não a fórmula: um teste que recalcula com a mesma
        // expressão do código valida a si mesmo, não o comportamento. 10% de
        // 1000 EAV7 = 100 EAV7; 10% disso = 10 EAV7.
        let penalidade: u128 = 100_000_000;
        let premio: u128 = 10_000_000;
        assert_eq!(s.account(&infrator.endereco()).staked, 1_000_000_000 - penalidade);
        assert_eq!(s.account(&denunciante).balance, premio, "o denunciante recebe o prêmio");
        assert_eq!(s.total_burned, penalidade - premio, "o resto some do suprimento");
        assert!(s.slashed.contains_key(&format!("{}:10", infrator.endereco())));

        // E a MESMA evidência não pode ser cobrada duas vezes.
        let e = aplicar(&mut s, &t, &ctx(ACIMA)).unwrap_err();
        assert!(e.0.contains("já foi penalizada"), "{}", e.0);
    }

    // ------------------------------------------------------------- transversais

    #[test]
    fn nenhuma_rejeicao_do_modulo_muta_o_estado() {
        // Varredura: um caso rejeitado de CADA tipo do módulo, todos contra o mesmo
        // estado, conferindo a impressão completa. É o invariante que o vetor de
        // conformidade checa como `rootAfter == rootBefore`.
        let mut s = estado_base();
        s.votes.insert(alice(), BTreeMap::from([(bob(), 1)]));
        s.candidate_votes.insert(bob(), 1);
        s.delegations.insert(alice(), BTreeMap::from([(bob(), 5)]));
        s.account_mut(&alice()).delegated_out = 5;
        s.account_mut(&bob()).delegated_in = 5;
        s.vesting.insert(
            "v".into(),
            Vesting { beneficiary: bob(), total: 10, claimed: 0, start: 1, cliff: 0, duration: 10 },
        );
        s.unbonding.push((alice(), 1, ACIMA));
        s.commission.insert(alice(), 5);
        s.reward_acc_per_vote.insert(bob(), 7);

        let inviaveis: Vec<Tx> = vec![
            {
                let mut t = tx("TRANSFER");
                t.to = Some(bob());
                t.amount = "999999999999".into();
                t
            },
            {
                let mut t = tx("STAKE");
                t.amount = "999999999999".into();
                t
            },
            {
                let mut t = tx("UNSTAKE");
                t.amount = "999999999999".into();
                t
            },
            tx_delegacao("DELEGATE_RESOURCE", &bob(), "999999999999"),
            tx_delegacao("UNDELEGATE_RESOURCE", &bob(), "999999999999"),
            tx_vesting_create("999999999999", 0, 10),
            com_dados("VESTING_CLAIM", &[("vestingId", JsonValue::str("nao-existe"))]),
            com_dados("CLAIM_VOTER_REWARD", &[("validator", JsonValue::str(carol()))]),
            tx_vote(&bob(), "999999999999"),
            com_dados("SET_COMMISSION", &[("percent", JsonValue::Int(101))]),
            tx_slash(bloco(&bob(), 10, "aa", None), bloco(&bob(), 10, "bb", None)),
        ];
        // Uma por tipo do módulo: se um tipo novo entrar em TIPOS sem entrar aqui,
        // este assert cobra.
        assert_eq!(inviaveis.len(), TIPOS.len());

        let antes = impressao(&s);
        for t in &inviaveis {
            let r = aplicar(&mut s, t, &ctx(ACIMA));
            assert!(r.is_err(), "{} devia ser rejeitada neste estado", t.tx_type);
            assert_eq!(impressao(&s), antes, "{} SUJOU o estado ao rejeitar", t.tx_type);
        }
    }

    #[test]
    fn parametro_governavel_sobrepoe_a_constante() {
        // Um override de MIN_VALIDATOR_STAKE aprovado on-chain tem de valer; ler a
        // constante direto faria este cliente divergir em toda VOTE e UNSTAKE.
        let mut s = estado_base();
        s.accounts.insert(carol(), conta(100_000_000, 10));
        let t = tx_vote(&carol(), "1000");
        rejeita_sem_sujar(&mut s, &t, &ctx(ACIMA), "candidato não elegível (self-stake abaixo do mínimo)");

        s.params.insert("MIN_VALIDATOR_STAKE".into(), "10".into());
        assert!(aplicar(&mut s, &t, &ctx(ACIMA)).is_ok(), "com o override, Carol é elegível");
    }

    #[test]
    fn como_amount_aceita_string_e_numero_e_rejeita_negativo() {
        assert_eq!(como_amount(Some(&JsonValue::str("123"))).unwrap(), 123);
        assert_eq!(como_amount(Some(&JsonValue::Int(123))).unwrap(), 123);
        assert!(como_amount(Some(&JsonValue::Int(-1))).is_err(), "negativo não pode virar 2¹²⁸-1");
        assert!(como_amount(Some(&JsonValue::str(""))).is_err(), "BigInt('') é 0n no JS — aqui é erro");
        assert!(como_amount(Some(&JsonValue::str(" 12 "))).is_err());
        assert!(como_amount(None).is_err());
    }
    /// PARIDADE de coerção numérica num caminho real de consenso.
    ///
    /// `"1000000"`, `"1000000.0"` e `"0xf4240"` são o MESMO número para a
    /// referência (`Number`/`BigInt` coagem os três). O porte recusava os dois
    /// últimos e chamava isso de "lado seguro" — não era: a rede aceita, e um
    /// bloco contendo qualquer um deles pararia este cliente enquanto os demais
    /// nós seguiriam. É a mesma classe do base64 estrito.
    #[test]
    fn coercao_numerica_aceita_o_que_a_referencia_aceita() {
        // `UNSTAKE` lê `amount` do topo — mas `data.blocks`/`quorum` e afins
        // passam pelo `como_i64`, que é o que este teste exercita via VESTING.
        let formas = ["100", "100.0", "0x64", "1e2", " 100 "];
        for forma in formas {
            let lido = como_i64(Some(&JsonValue::Str(forma.to_string())));
            assert_eq!(
                lido,
                Some(100),
                "a referência lê {forma:?} como 100; recusar aqui é divergir"
            );
        }
        // E o que a referência REJEITA continua rejeitado.
        for forma in ["100.5", "abc", "Infinity"] {
            assert_eq!(
                como_i64(Some(&JsonValue::Str(forma.to_string()))),
                None,
                "{forma:?} não é inteiro seguro nem na referência"
            );
        }
    }

    /// Ida e volta com todos os campos distintos e não-default.
    ///
    /// `total`/`claimed` viajam com a tag de TEXTO e os prazos com a de inteiro:
    /// trocar as tags no decodificador daria `None` e o snapshot seria descartado.
    #[test]
    fn vesting_sobrevive_a_ida_e_volta() {
        let v = Vesting {
            beneficiary: bob(),
            total: 987_654_321_098_765_432_109,
            claimed: 12_345,
            start: 111,
            cliff: 222,
            duration: 333,
        };
        assert_eq!(Vesting::from_value(&v.to_value()), Some(v));
    }

    #[test]
    fn vesting_com_forma_invalida_e_recusado_sem_panico() {
        use crate::canonical::Value as V;
        let Some(m) = Vesting::default().to_value().mapa().cloned() else { panic!("mapa") };
        let mut errado = m.clone();
        // `total` com a tag de INTEIRO — a folha o guarda como texto.
        errado.insert("total".into(), V::uint(5u128));
        assert_eq!(Vesting::from_value(&V::Map(errado)), None);
        let mut sobrando = m;
        sobrando.insert("zzz".into(), V::Null);
        assert_eq!(Vesting::from_value(&V::Map(sobrando)), None, "chave a mais é campo não lido");
    }
}
