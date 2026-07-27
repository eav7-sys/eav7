//! Score de desempenho de validador — OBSERVACIONAL e OPERACIONAL, FORA do consenso.
//!
//! Deriva de dados já on-chain (produtor + timestamp de cada bloco) quem está cumprindo
//! os slots do rodízio DPoS (`validadores[slot % N]`) e quem está lento/faltando. NÃO lê
//! nem altera estado, stake ou blocos — é só leitura da cadeia. A camada de IA usa o score
//! para duas coisas, respeitando a linha de segurança ([[eav7-ai-roadmap]]):
//!   (a) OPERACIONAL/reversível — o gateway roteia as leituras públicas para o peer mais
//!       saudável (GatewayHealth), então um validador degradado não sobrecarrega o serviço;
//!   (b) PROPOSE-ONLY — a IA REDIGE uma recomendação de governança sobre um validador
//!       cronicamente ruim; quem decide rotacionar/mexer em stake é a GOVERNANÇA (validadores
//!       votam) ou um humano. A IA jamais remove validador nem toca stake sozinha.
//!
//! Porque este módulo é PURO (sem I/O, sem rede, sem relógio), ele espelha 1:1 o
//! `src/node/validator-score.js`: as fórmulas de produtividade, latência e score, o
//! arredondamento e o rodízio por slot têm de bater BIT A BIT com o nó em JavaScript
//! enquanto os dois clientes convivem — divergência aqui vira score divergente entre
//! peers e, pior, recomendação de governança divergente. Todo desvio do JS é comentado.

use std::collections::HashMap;

/// Limiares padrão do JS (opções `laggingBelow`/`degradedBelow`). Não são constantes de
/// consenso nem de `eav7::config` — são defaults LOCAIS da heurística observacional, então
/// vivem aqui e não em `config.rs`.
pub const DEFAULT_LAGGING_BELOW: i64 = 85;
pub const DEFAULT_DEGRADED_BELOW: i64 = 50;

/// Validador na ORDEM do rodízio (a mesma de `state.validators()`).
///
/// `staked` é `u128` e não `u64` de propósito: os saldos da EAV7 passam de 2^64 (o JS usa
/// `bigint`), e `u128` cobre a folga do supply com margem. Na saída ele vira STRING decimal
/// (ver `ValidatorScore::staked`), reproduzindo o `bigint.toString()` do JS.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatorInput {
    pub address: String,
    pub staked: u128,
}

/// Bloco já on-chain, em ordem CRESCENTE de altura. `timestamp` é `i64` (ms desde a época):
/// no JS é um `number` (double) e assume-se `< 2^53`, faixa em que `i64` é exato; `lat`
/// pode ser negativo em teoria, daí ser assinado.
#[derive(Debug, Clone, PartialEq)]
pub struct BlockInput {
    pub height: u64,
    pub producer: String,
    pub timestamp: i64,
}

/// Estado de saúde do validador na janela. No JS é uma string; aqui é um enum com
/// `as_str()` devolvendo EXATAMENTE as mesmas strings (`healthy`/`lagging`/`degraded`/
/// `offline`), porque tanto o `summarize` quanto a recomendação de governança dependem
/// dessas palavras literais.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidatorStatus {
    Healthy,
    Lagging,
    Degraded,
    Offline,
}

impl ValidatorStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ValidatorStatus::Healthy => "healthy",
            ValidatorStatus::Lagging => "lagging",
            ValidatorStatus::Degraded => "degraded",
            ValidatorStatus::Offline => "offline",
        }
    }
}

impl std::fmt::Display for ValidatorStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Score de um validador na janela — campos idênticos ao objeto do JS.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatorScore {
    pub address: String,
    /// STRING decimal (o JS faz `.toString()` porque saldos passam de 2^64).
    pub staked: String,
    pub score: i64,
    pub status: ValidatorStatus,
    pub degraded: bool,
    pub productivity_pct: i64,
    pub expected: u64,
    pub produced: u64,
    pub in_turn: u64,
    pub missed: u64,
    pub out_of_turn: u64,
    /// `null` no JS quando não houve bloco produzido com latência medível.
    pub avg_latency_ms: Option<i64>,
    pub last_produced_height: Option<u64>,
    pub last_produced_at: Option<i64>,
}

/// Janela analisada. `blocks` é a CONTAGEM de blocos; `from_height`/`to_height` são `null`
/// no JS (aqui `None`) quando a janela é vazia.
#[derive(Debug, Clone, PartialEq)]
pub struct Window {
    pub blocks: usize,
    pub from_height: Option<u64>,
    pub to_height: Option<u64>,
}

/// O pior validador da janela (menor score), tal como o JS o resume.
#[derive(Debug, Clone, PartialEq)]
pub struct Worst {
    pub address: String,
    pub score: i64,
    pub status: ValidatorStatus,
}

/// Resumo agregado da janela.
#[derive(Debug, Clone, PartialEq)]
pub struct Summary {
    pub count: usize,
    pub healthy: usize,
    pub degraded: usize,
    pub degraded_addresses: Vec<String>,
    pub avg_score: Option<i64>,
    pub worst: Option<Worst>,
}

/// Retorno de `score_validators` — struct nomeado (não tupla/map) para casar com o objeto
/// `{ window, validators, summary }` do JS.
#[derive(Debug, Clone, PartialEq)]
pub struct ScoreValidatorsResult {
    pub window: Window,
    pub validators: Vec<ValidatorScore>,
    pub summary: Summary,
}

/// Evidência on-chain anexada à recomendação de governança.
#[derive(Debug, Clone, PartialEq)]
pub struct ProposalEvidence {
    pub score: i64,
    pub status: ValidatorStatus,
    pub productivity_pct: i64,
    pub in_turn: u64,
    pub expected: u64,
    pub missed: u64,
    pub avg_latency_ms: Option<i64>,
    pub last_produced_height: Option<u64>,
    pub sustained_ticks: Option<u64>,
}

/// Rascunho de governança PROPOSE-ONLY (`autonomous: false`).
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatorGovernanceProposal {
    pub kind: String,
    pub autonomous: bool,
    pub target: String,
    pub evidence: ProposalEvidence,
    pub recommendation: String,
    pub operational_mitigation: String,
}

/// Espelha o `clamp` ternário do JS: `x < lo ? lo : x > hi ? hi : x`. Escrito com a MESMA
/// estrutura de ramos de propósito: com `NaN` os dois testes (`<` e `>`) são falsos e a
/// função devolve `x` (`NaN`), idêntico ao JS — não usamos `f64::clamp`, que entra em
/// pânico se `lo > hi` e trata `NaN` de forma diferente.
fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    if x < lo {
        lo
    } else if x > hi {
        hi
    } else {
        x
    }
}

/// Reproduz o `Math.round` do JS. É a diferença mais traiçoeira do porte: o JS arredonda a
/// metade SEMPRE para +∞ (round-half-up), enquanto o `f64::round` do Rust arredonda a
/// metade para LONGE do zero. Divergem no negativo: `Math.round(-2.5) == -2`, mas
/// `(-2.5_f64).round() == -3`. Seguimos a definição do ECMAScript (Math.round) ao pé da
/// letra para que score/produtividade/latência batam com o nó em JS.
fn js_round(x: f64) -> f64 {
    // Casos-limite do spec: NaN/±∞/±0 voltam intactos.
    if x.is_nan() || x.is_infinite() || x == 0.0 {
        return x;
    }
    // (0, 0.5) → +0 e [-0.5, 0) → -0. O intervalo negativo inclui exatamente -0.5, que é o
    // caso que diverge do Rust: Math.round(-0.5) == -0 (arredonda para +∞), não -1.
    if x > 0.0 && x < 0.5 {
        return 0.0;
    }
    if (-0.5..0.0).contains(&x) {
        return -0.0;
    }
    let r = (x + 0.5).floor();
    // Correção do caso patológico de floor(x+0.5): para o double imediatamente abaixo de
    // 0.5 (0.49999999999999994), a soma x+0.5 arredonda para 1.0 e o floor daria 1, mas o
    // inteiro mais próximo é 0. Se `r` ficou a MAIS de 0.5 de `x`, o vizinho de baixo é o
    // correto; o empate exato (.5) mantém `r`, ou seja, arredonda para +∞ como o JS.
    if r - x > 0.5 {
        r - 1.0
    } else {
        r
    }
}

/// Acumulador interno por validador (equivalente ao valor do `Map stats` do JS). Fica
/// separado da saída porque guarda somas cruas (`latency_sum`/`latency_count`) que o
/// `finalize` converte em score.
struct Stat {
    address: String,
    staked: String,
    expected: u64,
    in_turn: u64,
    produced: u64,
    missed: u64,
    out_of_turn: u64,
    latency_sum: i64,
    latency_count: u64,
    last_produced_height: Option<u64>,
    last_produced_at: Option<i64>,
}

impl Stat {
    fn new(address: String, staked: String) -> Self {
        Stat {
            address,
            staked,
            expected: 0,
            in_turn: 0,
            produced: 0,
            missed: 0,
            out_of_turn: 0,
            latency_sum: 0,
            latency_count: 0,
            last_produced_height: None,
            last_produced_at: None,
        }
    }
}

/// `slotOf(ts) = floor(ts / blockTimeMs)`. `div_euclid` dá o floor para divisor positivo em
/// qualquer sinal de `ts` (igual ao `Math.floor` do JS, que arredonda para -∞), e para
/// timestamps `< 2^53` a divisão inteira coincide com a divisão em ponto flutuante do JS
/// (a lacuna até um inteiro é `>= 1/blockTimeMs`, muito acima do épsilon do double nessa
/// magnitude). Só é chamada quando `block_time_ms > 0` (garantido pelo guarda no início).
fn slot_of(ts: i64, block_time_ms: u64) -> i64 {
    ts.div_euclid(block_time_ms as i64)
}

/// Transforma os acumuladores em scores — o `finalize` do JS. PURO: mesma fórmula, mesmo
/// arredondamento, mesma ordem de operações de ponto flutuante que o JS.
fn finalize(
    stats: &[Stat],
    block_time_ms: u64,
    lagging_below: i64,
    degraded_below: i64,
) -> Vec<ValidatorScore> {
    let mut list = Vec::with_capacity(stats.len());
    for s in stats {
        // Fração dos PRÓPRIOS slots cumpridos (in-turn / atribuídos). Sem slots atribuídos,
        // 1.0 — não penaliza quem nunca esteve de turno na janela.
        let productivity: f64 = if s.expected > 0 {
            s.in_turn as f64 / s.expected as f64
        } else {
            1.0
        };
        let avg_latency_ms: Option<i64> = if s.latency_count > 0 {
            Some(js_round(s.latency_sum as f64 / s.latency_count as f64) as i64)
        } else {
            None
        };
        // Fator de latência: bloco no início do slot → 1.0; perto do fim → até -50%. Usa a
        // média JÁ ARREDONDADA (avg_latency_ms), como o JS, não a soma crua.
        let lat_factor: f64 = match avg_latency_ms {
            None => 1.0,
            Some(avg) => clamp(1.0 - (avg as f64 / block_time_ms as f64) * 0.5, 0.5, 1.0),
        };
        // Ordem de multiplicação idêntica ao JS `100 * productivity * latFactor` para
        // preservar o resultado bit a bit do ponto flutuante antes do arredondamento.
        let score: i64 = if s.expected > 0 {
            js_round(100.0 * productivity * lat_factor) as i64
        } else {
            100
        };
        let status = if s.expected > 0 && s.produced == 0 {
            ValidatorStatus::Offline
        } else if score < degraded_below {
            ValidatorStatus::Degraded
        } else if score < lagging_below {
            ValidatorStatus::Lagging
        } else {
            ValidatorStatus::Healthy
        };
        let degraded = matches!(status, ValidatorStatus::Degraded | ValidatorStatus::Offline);
        list.push(ValidatorScore {
            address: s.address.clone(),
            staked: s.staked.clone(),
            score,
            status,
            degraded,
            productivity_pct: js_round(productivity * 100.0) as i64,
            expected: s.expected,
            produced: s.produced,
            in_turn: s.in_turn,
            missed: s.missed,
            out_of_turn: s.out_of_turn,
            avg_latency_ms,
            last_produced_height: s.last_produced_height,
            last_produced_at: s.last_produced_at,
        });
    }
    list
}

/// Resumo agregado — o `summarize` do JS. `worst` é o PRIMEIRO validador com o menor score
/// (empate mantém o mais à esquerda, pois a comparação é estrita `<`).
fn summarize(list: &[ValidatorScore]) -> Summary {
    if list.is_empty() {
        return Summary {
            count: 0,
            healthy: 0,
            degraded: 0,
            degraded_addresses: Vec::new(),
            avg_score: None,
            worst: None,
        };
    }
    let degraded_addresses: Vec<String> = list
        .iter()
        .filter(|v| v.degraded)
        .map(|v| v.address.clone())
        .collect();
    let sum: i64 = list.iter().map(|v| v.score).sum();
    let avg = js_round(sum as f64 / list.len() as f64) as i64;
    let mut worst: Option<&ValidatorScore> = None;
    for v in list {
        match worst {
            None => worst = Some(v),
            Some(w) if v.score < w.score => worst = Some(v),
            _ => {}
        }
    }
    Summary {
        count: list.len(),
        healthy: list
            .iter()
            .filter(|v| v.status == ValidatorStatus::Healthy)
            .count(),
        degraded: degraded_addresses.len(),
        degraded_addresses,
        avg_score: Some(avg),
        worst: worst.map(|w| Worst {
            address: w.address.clone(),
            score: w.score,
            status: w.status,
        }),
    }
}

/// Pontua cada validador numa JANELA de blocos recentes. Função PURA.
///
/// - `validators`  : na ORDEM do rodízio (a mesma de `state.validators()`).
/// - `blocks`      : em ordem CRESCENTE de altura.
/// - `block_time_ms`: `eav7::config::BLOCK_TIME_MS` (duração do slot) em uso real; mantido
///   como parâmetro (e não lido direto da constante) para o módulo ser testável com slots
///   de tamanhos diferentes, espelhando a assinatura parametrizada do JS.
/// - `lagging_below`/`degraded_below`: limiares de status (defaults 85/50 no JS — ver as
///   constantes `DEFAULT_*`).
pub fn score_validators(
    validators: &[ValidatorInput],
    blocks: &[BlockInput],
    block_time_ms: u64,
    lagging_below: i64,
    degraded_below: i64,
) -> ScoreValidatorsResult {
    let n = validators.len();

    // `order` inclui TODAS as entradas (com eventuais duplicatas), comprimento N — é o que o
    // rodízio indexa. `stats`/`index` deduplicam por endereço (como o `Map` do JS: `set` numa
    // chave existente sobrescreve o valor mantendo a POSIÇÃO da primeira inserção).
    let order: Vec<&str> = validators.iter().map(|v| v.address.as_str()).collect();
    let mut stats: Vec<Stat> = Vec::with_capacity(n);
    let mut index: HashMap<String, usize> = HashMap::with_capacity(n);
    for v in validators {
        let staked_str = v.staked.to_string();
        if let Some(&i) = index.get(&v.address) {
            stats[i] = Stat::new(v.address.clone(), staked_str);
        } else {
            index.insert(v.address.clone(), stats.len());
            stats.push(Stat::new(v.address.clone(), staked_str));
        }
    }

    // Caminho de janela vazia. Reproduz um QUIRK do JS: se N==0 (mesmo com blocos presentes)
    // OU não há blocos, `window.blocks` é fixado em 0 e from/to em null — não é a contagem
    // real de blocos. Também entramos aqui defensivamente com `block_time_ms == 0`: isso é
    // ENTRADA INVÁLIDA (o JS dividiria por zero e cairia em laço infinito com slot=Infinity);
    // aqui evitamos o pânico de divisão por zero devolvendo o resultado degenerado. Divergência
    // registrada no relatório.
    if n == 0 || blocks.is_empty() || block_time_ms == 0 {
        let out = finalize(&stats, block_time_ms, lagging_below, degraded_below);
        let summary = summarize(&out);
        return ScoreValidatorsResult {
            window: Window {
                blocks: 0,
                from_height: None,
                to_height: None,
            },
            validators: out,
            summary,
        };
    }

    // 1 bloco por slot (regra de consenso). Em colisão, o ÚLTIMO bloco vence, como o
    // `Map.set` sequencial do JS.
    let mut by_slot: HashMap<i64, usize> = HashMap::with_capacity(blocks.len());
    for (i, b) in blocks.iter().enumerate() {
        by_slot.insert(slot_of(b.timestamp, block_time_ms), i);
    }
    // Índices seguros: já checamos `!blocks.is_empty()`.
    let first_slot = slot_of(blocks[0].timestamp, block_time_ms);
    let last_slot = slot_of(blocks[blocks.len() - 1].timestamp, block_time_ms);
    let n_i64 = n as i64; // n > 0 aqui.

    let mut slot = first_slot;
    while slot <= last_slot {
        // `((slot % N) + N) % N` normaliza para [0, N) mesmo com `slot` negativo, sem
        // estourar. `slot % n_i64` no Rust tem o sinal do dividendo, daí o `+ n_i64`.
        let idx = (((slot % n_i64) + n_i64) % n_i64) as usize;
        let expected_addr = order[idx];
        let es_idx = index.get(expected_addr).copied();
        if let Some(ei) = es_idx {
            stats[ei].expected += 1;
        }
        match by_slot.get(&slot).copied() {
            None => {
                // Slot vazio = o produtor esperado faltou.
                if let Some(ei) = es_idx {
                    stats[ei].missed += 1;
                }
            }
            Some(bi) => {
                let b = &blocks[bi];
                let ps_idx = index.get(&b.producer).copied();
                if let Some(pi) = ps_idx {
                    stats[pi].produced += 1;
                    stats[pi].last_produced_height = Some(b.height);
                    stats[pi].last_produced_at = Some(b.timestamp);
                    // `slot * block_time_ms <= b.timestamp` para entrada válida (< 2^53), logo
                    // não estoura i64 nem em build de debug; `lat` fica em [0, block_time_ms).
                    let lat = b.timestamp - slot * block_time_ms as i64;
                    if lat >= 0 {
                        stats[pi].latency_sum += lat;
                        stats[pi].latency_count += 1;
                    }
                }
                if b.producer == expected_addr {
                    if let Some(ei) = es_idx {
                        stats[ei].in_turn += 1;
                    }
                } else if let Some(pi) = ps_idx {
                    stats[pi].out_of_turn += 1;
                }
            }
        }
        slot += 1;
    }

    let out = finalize(&stats, block_time_ms, lagging_below, degraded_below);
    let summary = summarize(&out);
    ScoreValidatorsResult {
        window: Window {
            blocks: blocks.len(),
            from_height: Some(blocks[0].height),
            to_height: Some(blocks[blocks.len() - 1].height),
        },
        validators: out,
        summary,
    }
}

/// Redige (NÃO submete) uma recomendação de governança para um validador cronicamente
/// degradado. PROPOSE-ONLY: `autonomous:false`. Entrega o rascunho + a evidência on-chain;
/// a decisão de rotacionar/mexer em stake é da GOVERNANÇA (validadores votam via GOV_PROPOSE)
/// ou de um humano. A mitigação que a IA JÁ aplica sozinha é apenas operacional/reversível
/// (rotear leitura do gateway para longe do degradado). Ver [[eav7-ai-roadmap]].
pub fn draft_validator_governance_proposal(
    v: &ValidatorScore,
    sustained_ticks: Option<u64>,
) -> ValidatorGovernanceProposal {
    let recommendation = format!(
        "Validador {address} está {status} (score {score}/100, produtividade {pct}% \
em {expected} slots atribuídos, {missed} perdidos). Recomenda-se à GOVERNANÇA revisar: os \
delegadores podem redirecionar votos/stake para validadores saudáveis, ou abrir GOV_PROPOSE para \
reavaliação. A IA NÃO remove validador nem mexe em stake — apenas recomenda e roteia leitura pública \
para longe do nó degradado (operacional e reversível).",
        address = v.address,
        status = v.status.as_str(),
        score = v.score,
        pct = v.productivity_pct,
        expected = v.expected,
        missed = v.missed,
    );
    ValidatorGovernanceProposal {
        kind: "VALIDATOR_ROTATION_REVIEW".to_string(),
        autonomous: false, // a IA NÃO executa — só recomenda
        target: v.address.clone(),
        evidence: ProposalEvidence {
            score: v.score,
            status: v.status,
            productivity_pct: v.productivity_pct,
            in_turn: v.in_turn,
            expected: v.expected,
            missed: v.missed,
            avg_latency_ms: v.avg_latency_ms,
            last_produced_height: v.last_produced_height,
            sustained_ticks,
        },
        recommendation,
        operational_mitigation: "gateway-read-routing-away-from-degraded".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn val(addr: &str, staked: u128) -> ValidatorInput {
        ValidatorInput {
            address: addr.to_string(),
            staked,
        }
    }

    fn blk(height: u64, producer: &str, timestamp: i64) -> BlockInput {
        BlockInput {
            height,
            producer: producer.to_string(),
            timestamp,
        }
    }

    fn score(validators: &[ValidatorInput], blocks: &[BlockInput], bt: u64) -> ScoreValidatorsResult {
        score_validators(validators, blocks, bt, DEFAULT_LAGGING_BELOW, DEFAULT_DEGRADED_BELOW)
    }

    // ------- Bordas de arredondamento (Math.round do JS: metade para +∞) -------
    #[test]
    fn js_round_matches_ecmascript() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(3.5), 4.0);
        // Diverge do f64::round do Rust (que daria -3.0):
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-3.5), -3.0);
        assert_eq!(js_round(2.4), 2.0);
        assert_eq!(js_round(2.6), 3.0);
        assert_eq!(js_round(0.5), 1.0);
        // Math.round(-0.5) == -0 -> como inteiro, 0.
        assert_eq!(js_round(-0.5) as i64, 0);
        // Caso patológico: o double imediatamente abaixo de 0.5 deve dar 0, não 1.
        assert_eq!(js_round(0.499_999_999_999_999_94_f64), 0.0);
        // Confirma que o f64::round nativo REALMENTE difere (justifica js_round):
        assert_ne!((-2.5_f64).round(), js_round(-2.5));
    }

    // ------- Janela vazia: N == 0 -------
    #[test]
    fn empty_no_validators() {
        let r = score(&[], &[], 1000);
        assert_eq!(r.window, Window { blocks: 0, from_height: None, to_height: None });
        assert!(r.validators.is_empty());
        assert_eq!(
            r.summary,
            Summary {
                count: 0,
                healthy: 0,
                degraded: 0,
                degraded_addresses: vec![],
                avg_score: None,
                worst: None,
            }
        );
    }

    // ------- Janela vazia: sem blocos, mas com validadores (scored 100/healthy) -------
    #[test]
    fn empty_no_blocks_but_validators() {
        let vs = vec![val("A", 1000)];
        let r = score(&vs, &[], 1000);
        assert_eq!(r.window, Window { blocks: 0, from_height: None, to_height: None });
        assert_eq!(r.validators.len(), 1);
        let a = &r.validators[0];
        assert_eq!(a.score, 100);
        assert_eq!(a.status, ValidatorStatus::Healthy);
        assert!(!a.degraded);
        assert_eq!(a.productivity_pct, 100);
        assert_eq!(a.staked, "1000");
        assert_eq!(a.expected, 0);
        assert_eq!(a.avg_latency_ms, None);
        assert_eq!(a.last_produced_height, None);
        assert_eq!(r.summary.count, 1);
        assert_eq!(r.summary.healthy, 1);
        assert_eq!(r.summary.degraded, 0);
        assert_eq!(r.summary.avg_score, Some(100));
        assert_eq!(
            r.summary.worst,
            Some(Worst { address: "A".to_string(), score: 100, status: ValidatorStatus::Healthy })
        );
    }

    // ------- Quirk: N == 0 com blocos presentes ainda reporta window.blocks == 0 -------
    #[test]
    fn quirk_zero_validators_with_blocks_reports_zero_window() {
        let blocks = vec![blk(1, "A", 0), blk(2, "A", 1000)];
        let r = score(&[], &blocks, 1000);
        assert_eq!(r.window, Window { blocks: 0, from_height: None, to_height: None });
        assert!(r.validators.is_empty());
    }

    // ------- Validador saudável 100% -------
    #[test]
    fn healthy_full_productivity() {
        let vs = vec![val("A", 5)];
        let blocks = vec![blk(1, "A", 0), blk(2, "A", 1000), blk(3, "A", 2000)];
        let r = score(&vs, &blocks, 1000);
        assert_eq!(r.window, Window { blocks: 3, from_height: Some(1), to_height: Some(3) });
        let a = &r.validators[0];
        assert_eq!(a.expected, 3);
        assert_eq!(a.in_turn, 3);
        assert_eq!(a.produced, 3);
        assert_eq!(a.missed, 0);
        assert_eq!(a.out_of_turn, 0);
        assert_eq!(a.avg_latency_ms, Some(0));
        assert_eq!(a.score, 100);
        assert_eq!(a.productivity_pct, 100);
        assert_eq!(a.status, ValidatorStatus::Healthy);
        assert_eq!(a.last_produced_height, Some(3));
        assert_eq!(a.last_produced_at, Some(2000));
        assert_eq!(r.summary.avg_score, Some(100));
    }

    // ------- Perda de slots (missed) -> produtividade 2/3, score 67, lagging -------
    #[test]
    fn missed_slot_reduces_productivity() {
        let vs = vec![val("A", 5)];
        // Slots 0 e 2 produzidos; slot 1 vazio (missed).
        let blocks = vec![blk(1, "A", 0), blk(3, "A", 2000)];
        let r = score(&vs, &blocks, 1000);
        let a = &r.validators[0];
        assert_eq!(a.expected, 3);
        assert_eq!(a.in_turn, 2);
        assert_eq!(a.produced, 2);
        assert_eq!(a.missed, 1);
        // 100 * (2/3) = 66.666..., js_round -> 67.
        assert_eq!(a.score, 67);
        assert_eq!(a.productivity_pct, 67);
        assert_eq!(a.status, ValidatorStatus::Lagging);
        assert!(!a.degraded);
        assert_eq!(a.avg_latency_ms, Some(0));
    }

    // ------- Produção fora de turno (outOfTurn) + o esperado fica offline -------
    #[test]
    fn out_of_turn_production() {
        let vs = vec![val("A", 5), val("B", 7)];
        // Slot 0 esperava A, mas B produziu; slot 1 esperava B e B produziu.
        let blocks = vec![blk(1, "B", 0), blk(2, "B", 1000)];
        let r = score(&vs, &blocks, 1000);
        // Ordem de saída = ordem dos validadores: A, depois B.
        let a = &r.validators[0];
        let b = &r.validators[1];
        assert_eq!(a.address, "A");
        assert_eq!(a.expected, 1);
        assert_eq!(a.in_turn, 0);
        assert_eq!(a.produced, 0);
        assert_eq!(a.out_of_turn, 0);
        assert_eq!(a.score, 0);
        assert_eq!(a.status, ValidatorStatus::Offline);
        assert!(a.degraded);
        assert_eq!(a.avg_latency_ms, None);
        assert_eq!(a.last_produced_height, None);

        assert_eq!(b.address, "B");
        assert_eq!(b.expected, 1);
        assert_eq!(b.in_turn, 1);
        assert_eq!(b.produced, 2);
        assert_eq!(b.out_of_turn, 1);
        assert_eq!(b.score, 100);
        assert_eq!(b.status, ValidatorStatus::Healthy);
        assert_eq!(b.last_produced_height, Some(2));

        // Resumo: 2 validadores, 1 saudável, 1 degradado (offline), pior = A(0).
        assert_eq!(r.summary.count, 2);
        assert_eq!(r.summary.healthy, 1);
        assert_eq!(r.summary.degraded, 1);
        assert_eq!(r.summary.degraded_addresses, vec!["A".to_string()]);
        assert_eq!(r.summary.avg_score, Some(50)); // round((0+100)/2)
        assert_eq!(
            r.summary.worst,
            Some(Worst { address: "A".to_string(), score: 0, status: ValidatorStatus::Offline })
        );
    }

    // ------- Fator de latência: bloco no fim do slot reduz o score -------
    #[test]
    fn latency_factor_reduces_score() {
        let vs = vec![val("A", 5)];
        // Um único slot (0), bloco produzido a 999ms (quase o fim do slot de 1000ms).
        let blocks = vec![blk(1, "A", 999)];
        let r = score(&vs, &blocks, 1000);
        let a = &r.validators[0];
        assert_eq!(a.expected, 1);
        assert_eq!(a.in_turn, 1);
        assert_eq!(a.avg_latency_ms, Some(999));
        // latFactor = clamp(1 - (999/1000)*0.5, 0.5, 1) = 0.5005
        // score = round(100 * 1 * 0.5005) = round(50.05) = 50 -> lagging (50 !< 50).
        assert_eq!(a.score, 50);
        assert_eq!(a.productivity_pct, 100);
        assert_eq!(a.status, ValidatorStatus::Lagging);
        assert!(!a.degraded);
    }

    // ------- Latência que empurra o score para 'degraded' (< 50) -------
    #[test]
    fn latency_can_degrade_below_threshold() {
        // Produtividade 1, mas ainda assim degradado se a latência derrubar o score < 50.
        // Com productivity < 1 e latência alta o score cai abaixo de 50.
        let vs = vec![val("A", 5)];
        // Slots 0..3 esperados (4 slots). Produz só 1 (slot 0), muito tarde. -> 3 missed.
        let blocks = vec![blk(1, "A", 999), blk(2, "A", 3999)];
        // firstSlot=0, lastSlot=3. slot0: A@999 inTurn, lat999. slot1: vazio missed.
        // slot2: vazio missed. slot3: A@3999 inTurn, lat999.
        let r = score(&vs, &blocks, 1000);
        let a = &r.validators[0];
        assert_eq!(a.expected, 4);
        assert_eq!(a.in_turn, 2);
        assert_eq!(a.missed, 2);
        assert_eq!(a.avg_latency_ms, Some(999));
        // productivity = 2/4 = 0.5; latFactor = 0.5005;
        // score = round(100 * 0.5 * 0.5005) = round(25.025) = 25 -> degraded.
        assert_eq!(a.score, 25);
        assert_eq!(a.status, ValidatorStatus::Degraded);
        assert!(a.degraded);
    }

    // ------- summarize: worst mantém o primeiro em empate de menor score -------
    #[test]
    fn summarize_worst_is_leftmost_on_tie() {
        // A e B com mesmo score baixo; worst deve ser A (primeiro).
        let vs = vec![val("A", 1), val("B", 1), val("C", 1)];
        // Fazemos C produzir dois slots; A e B ficam offline (expected>0, produced 0).
        // order = [A,B,C]. Janela precisa cobrir os slots esperados de A e B.
        let blocks = vec![blk(1, "C", 2000), blk(2, "C", 5000)];
        // firstSlot=2, lastSlot=5. slots 2,3,4,5 -> expected C,A,B,C.
        let r = score(&vs, &blocks, 1000);
        // A esperado no slot 3 (vazio) -> missed 1, produced 0 -> offline, score 0.
        // B esperado no slot 4 (vazio) -> missed 1, produced 0 -> offline, score 0.
        // C esperado nos slots 2 e 5; slot2 tem C@2000 inTurn, slot5 tem C@5000 inTurn.
        let a = &r.validators[0];
        let b = &r.validators[1];
        let c = &r.validators[2];
        assert_eq!(a.status, ValidatorStatus::Offline);
        assert_eq!(a.score, 0);
        assert_eq!(b.status, ValidatorStatus::Offline);
        assert_eq!(b.score, 0);
        assert_eq!(c.status, ValidatorStatus::Healthy);
        assert_eq!(c.in_turn, 2);
        assert_eq!(c.expected, 2);
        // Empate de menor score entre A e B (0); worst = A (mais à esquerda).
        assert_eq!(r.summary.worst.as_ref().unwrap().address, "A");
        assert_eq!(r.summary.degraded_addresses, vec!["A".to_string(), "B".to_string()]);
        assert_eq!(r.summary.count, 3);
        assert_eq!(r.summary.healthy, 1);
        assert_eq!(r.summary.degraded, 2);
        // avg = round((0 + 0 + 100)/3) = round(33.33) = 33
        assert_eq!(r.summary.avg_score, Some(33));
    }

    // ------- staked vira STRING decimal, inclusive acima de 2^64 -------
    #[test]
    fn staked_is_decimal_string_above_2_pow_64() {
        let big = (1u128 << 70) + 12345; // > 2^64
        let vs = vec![val("A", big)];
        let r = score(&vs, &[], 1000);
        assert_eq!(r.validators[0].staked, big.to_string());
    }

    // ------- draftValidatorGovernanceProposal: propose-only + string exata -------
    #[test]
    fn draft_proposal_is_propose_only() {
        let vs = vec![val("A", 5), val("B", 7)];
        let blocks = vec![blk(1, "B", 0), blk(2, "B", 1000)];
        let r = score(&vs, &blocks, 1000);
        let a = &r.validators[0]; // offline
        let p = draft_validator_governance_proposal(a, Some(7));
        assert_eq!(p.kind, "VALIDATOR_ROTATION_REVIEW");
        assert!(!p.autonomous);
        assert_eq!(p.target, "A");
        assert_eq!(p.operational_mitigation, "gateway-read-routing-away-from-degraded");
        assert_eq!(p.evidence.status, ValidatorStatus::Offline);
        assert_eq!(p.evidence.score, 0);
        assert_eq!(p.evidence.sustained_ticks, Some(7));
        // missed == 0: no slot 0 (esperava A) o bloco existe (B produziu fora de turno),
        // então A não conta 'missed' — só slots VAZIOS incrementam missed.
        let expected = "Validador A está offline (score 0/100, produtividade 0% \
em 1 slots atribuídos, 0 perdidos). Recomenda-se à GOVERNANÇA revisar: os \
delegadores podem redirecionar votos/stake para validadores saudáveis, ou abrir GOV_PROPOSE para \
reavaliação. A IA NÃO remove validador nem mexe em stake — apenas recomenda e roteia leitura pública \
para longe do nó degradado (operacional e reversível).";
        assert_eq!(p.recommendation, expected);
    }

    // ------- Entrada inválida: block_time_ms == 0 não entra em pânico (divergência) -------
    #[test]
    fn zero_block_time_does_not_panic() {
        let vs = vec![val("A", 5)];
        let blocks = vec![blk(1, "A", 0), blk(2, "A", 1000)];
        let r = score(&vs, &blocks, 0);
        // Caminho degenerado: janela reportada como vazia (o JS entraria em laço infinito).
        assert_eq!(r.window, Window { blocks: 0, from_height: None, to_height: None });
        assert_eq!(r.validators[0].score, 100);
    }
}
