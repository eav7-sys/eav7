//! Sentinela de segurança da EAV7 — porte de `src/ai/sentinel.js` (257 linhas).
//!
//! Vigilância 24h da rede por IA: processo off-chain que monitora blocos,
//! mempool e validadores em tempo real (sentinel.js:1-9):
//!
//!   • heurísticas determinísticas rodam a cada ciclo (reorg, transferências
//!     gigantes, rajadas de transações, concentração de produtores, flood);
//!   • com `ANTHROPIC_API_KEY` definida E um [`LlmClient`] injetado (ver a
//!     decisão de TLS em `ai/mod.rs`), um analista LLM (Claude) recebe
//!     periodicamente um dossiê da atividade recente e publica um parecer.
//!
//! Os alertas são enviados ao nó (`POST /security/alerts`) e ficam visíveis na
//! plataforma de mineração e via `GET /security/alerts`.
//!
//! # Lógica vs transporte
//!
//! As heurísticas vivem em [`SentinelCore`]: funções PURAS sobre dados de
//! blocos/mempool/validadores que devolvem [`Alert`]s — todos os limites
//! (`>1%` do supply, `>20` txs/bloco, `>0.8` de concentração, `>1000` no
//! mempool, `>50k` de regressão) são testáveis sem rede. O transporte
//! ([`SecuritySentinel`]) busca `/status`, `/blocks`, `/validators`,
//! `/governance/advisories` e posta os alertas — async sobre o cliente hyper
//! do P2P. Nenhum lock: a sentinela é dona exclusiva do seu estado (uma task).
//!
//! # Linha de segurança da IA (ver [[eav7-ai-roadmap]])
//!
//! PROPOSE-ONLY: a sentinela OBSERVA e ALERTA. As recomendações de governança
//! que anexa são rascunhos com `autonomous: false`
//! (`draft_validator_governance_proposal` de `crate::validator_score`) — quem
//! decide rotacionar/mexer em stake é a governança/humano. A única mitigação
//! automática do sistema é operacional/reversível (roteamento de leitura do
//! gateway) e NÃO passa por aqui.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use eav7::config::GENESIS_SUPPLY;

use crate::p2p::{make_client, HttpClient};
use crate::validator_score::{
    draft_validator_governance_proposal, ValidatorGovernanceProposal, ValidatorScore,
    ValidatorStatus,
};

use super::{
    anthropic_extract_text, anthropic_request_body, format_eav7, http_get_json, http_post_json,
    now_ms, LlmClient, ANTHROPIC_API_URL, DEFAULT_CLAUDE_MODEL,
};

// ---------------------------------------------------------------------------
// Tipos de dados das heurísticas (a visão que o JS lê do JSON do nó)
// ---------------------------------------------------------------------------

/// Um alerta produzido pelas heurísticas — o quádruplo que `alert()` do JS
/// (sentinel.js:43) recebe. `context` é JSON de APRESENTAÇÃO (vai no POST,
/// nunca é assinado/hasheado), então serde_json é adequado.
#[derive(Debug, Clone, PartialEq)]
pub struct Alert {
    pub kind: &'static str,
    /// `"critical"` | `"warning"` | `"info"` — as três severidades do JS.
    pub severity: &'static str,
    pub message: String,
    pub context: serde_json::Value,
}

/// Transação como a sentinela a enxerga no JSON de `/blocks` — só os campos
/// que `#inspectBlock` (sentinel.js:74-81) lê.
#[derive(Debug, Clone)]
pub struct TxView {
    pub id: String,
    pub tx_type: String,
    pub from: String,
    pub to: Option<String>,
    /// Decimal em e7 (texto, como no protocolo). Valor imparseável é tratado
    /// como 0 — no JS `BigInt(tx.amount)` lançaria e derrubaria o tick inteiro;
    /// aqui degradamos por transação (divergência deliberada, mais segura).
    pub amount: String,
}

/// Bloco como a sentinela o enxerga — os campos de sentinel.js:61-110.
#[derive(Debug, Clone)]
pub struct BlockView {
    pub height: i64,
    pub hash: String,
    pub producer: String,
    pub tx_count: i64,
    pub transactions: Vec<TxView>,
}

/// Advisory de governança como vem de `/governance/advisories` — os campos que
/// `#checkGovernanceAdvisories` (sentinel.js:198-214) lê.
#[derive(Debug, Clone)]
pub struct AdvisoryView {
    pub param: String,
    pub current_value: String,
    pub suggested_value: String,
    /// `"warning"` promove o alerta; qualquer outra vira `"info"` (sentinel.js:209).
    pub severity: String,
    pub reason: String,
}

// ---------------------------------------------------------------------------
// Limites das heurísticas — os números literais do JS, nomeados.
// ---------------------------------------------------------------------------

/// Janela de hashes por altura para detectar reorg (sentinel.js:69).
const REORG_HASH_WINDOW: usize = 500;
/// Txs de um MESMO remetente num bloco acima disto = rajada (sentinel.js:83).
const TX_BURST_PER_BLOCK: usize = 20;
/// Janela de produtores (sentinel.js:91) e mínimo para avaliar (js:92).
const PRODUCER_WINDOW: usize = 100;
const PRODUCER_MIN_SAMPLE: usize = 50;
/// Regressão de altura acima disto = troca de gênese/relaunch, não rollback
/// real — re-baseline em silêncio (sentinel.js:116-125).
const ROLLBACK_REBASELINE: i64 = 50_000;
/// Mempool acima disto = flood (sentinel.js:127).
const MEMPOOL_FLOOD_ABOVE: u64 = 1000;
/// Resumos por bloco retidos para o dossiê da IA (sentinel.js:110).
const ACTIVITY_WINDOW: usize = 200;
/// Ciclos consecutivos degradado para alertar — default de
/// `EAV7_DEGRADED_TICKS` (sentinel.js:27).
pub const DEFAULT_DEGRADED_TICKS: u64 = 6;

// ---------------------------------------------------------------------------
// SentinelCore — as heurísticas puras
// ---------------------------------------------------------------------------

/// Estado determinístico da sentinela — os campos do construtor do JS
/// (sentinel.js:16-35) que NÃO são transporte (URL, timers, tokens).
#[derive(Debug)]
pub struct SentinelCore {
    /// Última altura vista (`lastHeight`, começa -1).
    last_height: i64,
    /// altura → hash (janela recente) para detectar reorg (`hashesByHeight`).
    hashes_by_height: BTreeMap<i64, String>,
    /// Produtores dos últimos blocos (`producerHistory`).
    producer_history: Vec<String>,
    /// Resumo por bloco para o dossiê da IA (`recentActivity`).
    recent_activity: Vec<serde_json::Value>,
    /// Ciclos consecutivos degradado para alertar (`degradedTicks`).
    degraded_ticks: u64,
    /// address → ciclos consecutivos degradado (`degradedStreak`).
    degraded_streak: HashMap<String, u64>,
    /// Já alertado nesta ocorrência — não repetir (`alertedDegraded`).
    alerted_degraded: HashSet<String>,
    /// `param:valor` já alertado — dedup até voltar ao saudável (`advisedKeys`).
    advised_keys: HashSet<String>,
}

impl SentinelCore {
    pub fn new(degraded_ticks: u64) -> Self {
        SentinelCore {
            last_height: -1,
            hashes_by_height: BTreeMap::new(),
            producer_history: Vec::new(),
            recent_activity: Vec::new(),
            degraded_ticks,
            degraded_streak: HashMap::new(),
            alerted_degraded: HashSet::new(),
            advised_keys: HashSet::new(),
        }
    }

    /// Última altura processada — o `lastHeight` que o transporte usa para
    /// paginar `/blocks?from=`.
    pub fn last_height(&self) -> i64 {
        self.last_height
    }

    /// Avança `lastHeight` após inspecionar uma página de blocos —
    /// `this.lastHeight = blocks.at(-1)?.height ?? status.height` (sentinel.js:135).
    pub fn note_synced_height(&mut self, height: i64) {
        self.last_height = height;
    }

    /// Heurísticas sobre o `/status` — o começo do `tick()` (sentinel.js:113-129):
    /// regressão de altura (rollback vs relaunch) e flood de mempool.
    pub fn check_status(&mut self, height: i64, mempool: u64) -> Vec<Alert> {
        let mut alertas = Vec::new();
        if height < self.last_height {
            // Queda além de qualquer reorg plausível (> 50k blocos) = troca de
            // gênese/relaunch da rede, não um rollback real. Re-baseline em
            // silêncio em vez de alertar para sempre (sentinel.js:116-125).
            if self.last_height - height > ROLLBACK_REBASELINE {
                self.last_height = height;
            } else {
                alertas.push(Alert {
                    kind: "CHAIN_ROLLBACK",
                    severity: "critical",
                    message: format!(
                        "altura da cadeia regrediu de {} para {}",
                        self.last_height, height
                    ),
                    context: serde_json::json!({}),
                });
            }
        }
        if mempool > MEMPOOL_FLOOD_ABOVE {
            alertas.push(Alert {
                kind: "MEMPOOL_FLOOD",
                severity: "warning",
                message: format!("mempool com {mempool} transações pendentes"),
                context: serde_json::json!({}),
            });
        }
        alertas
    }

    /// `#inspectBlock` (sentinel.js:61-111): reorg, transferência gigante,
    /// rajada por remetente, concentração de produtor, e o resumo do bloco
    /// para o dossiê da IA.
    pub fn inspect_block(&mut self, block: &BlockView, validator_count: u64) -> Vec<Alert> {
        let mut alertas = Vec::new();

        // --- reorg: mesma altura, hash diferente (sentinel.js:62-67) --------
        if let Some(conhecido) = self.hashes_by_height.get(&block.height)
            && conhecido != &block.hash
        {
            alertas.push(Alert {
                kind: "REORG",
                severity: "critical",
                message: format!(
                    "bloco na altura {} foi substituído (fork/reorganização)",
                    block.height
                ),
                context: serde_json::json!({
                    "height": block.height,
                    "antes": conhecido,
                    "depois": block.hash,
                }),
            });
        }
        self.hashes_by_height.insert(block.height, block.hash.clone());
        // Janela de 500 alturas: remove a MENOR (o `Math.min` de sentinel.js:70;
        // o BTreeMap dá o mínimo de graça).
        if self.hashes_by_height.len() > REORG_HASH_WINDOW
            && let Some((&menor, _)) = self.hashes_by_height.iter().next()
        {
            self.hashes_by_height.remove(&menor);
        }

        // --- por transação: contagem por remetente + transferência gigante ---
        // Vec de pares (não HashMap) para preservar a ORDEM DE INSERÇÃO do
        // `perSender` do JS — a ordem dos alertas de rajada é a de Object.entries.
        let mut por_remetente: Vec<(String, usize)> = Vec::new();
        for tx in &block.transactions {
            match por_remetente.iter_mut().find(|(quem, _)| quem == &tx.from) {
                Some((_, n)) => *n += 1,
                None => por_remetente.push((tx.from.clone(), 1)),
            }
            // Transferência acima de 1% do supply de gênese (sentinel.js:76-80).
            // `BigInt(tx.amount)` no JS; imparseável aqui é ignorado (ver TxView).
            if tx.tx_type == "TRANSFER"
                && let Ok(valor) = tx.amount.parse::<u128>()
                && valor > GENESIS_SUPPLY / 100
            {
                alertas.push(Alert {
                    kind: "LARGE_TRANSFER",
                    severity: "warning",
                    message: format!(
                        "transferência de {} {} (>1% do supply) no bloco {}",
                        format_eav7(valor),
                        eav7::config::SYMBOL,
                        block.height
                    ),
                    context: serde_json::json!({
                        "tx": tx.id,
                        "from": tx.from,
                        "to": tx.to,
                    }),
                });
            }
        }
        // Rajada: mais de 20 txs do MESMO remetente num bloco (sentinel.js:82-88).
        for (remetente, quantos) in &por_remetente {
            if *quantos > TX_BURST_PER_BLOCK {
                alertas.push(Alert {
                    kind: "TX_BURST",
                    severity: "warning",
                    message: format!("{remetente} enviou {quantos} transações num único bloco"),
                    context: serde_json::json!({
                        "height": block.height,
                        "sender": remetente,
                        "count": quantos,
                    }),
                });
            }
        }

        // --- concentração de produtor (sentinel.js:90-102) ------------------
        self.producer_history.push(block.producer.clone());
        if self.producer_history.len() > PRODUCER_WINDOW {
            self.producer_history.remove(0); // o `shift()` do JS
        }
        if validator_count > 1 && self.producer_history.len() >= PRODUCER_MIN_SAMPLE {
            // Contagem em ordem de primeira aparição — empate resolve como o
            // sort ESTÁVEL do V8 sobre Object.entries (primeiro visto ganha).
            let mut contagem: Vec<(&str, usize)> = Vec::new();
            for p in &self.producer_history {
                match contagem.iter_mut().find(|(quem, _)| *quem == p.as_str()) {
                    Some((_, n)) => *n += 1,
                    None => contagem.push((p.as_str(), 1)),
                }
            }
            if let Some(&(topo, topo_n)) = contagem.iter().max_by_key(|(_, n)| *n)
                && (topo_n as f64) / (self.producer_history.len() as f64) > 0.8
            {
                alertas.push(Alert {
                    kind: "PRODUCER_CONCENTRATION",
                    severity: "warning",
                    message: format!(
                        "{topo} produziu {topo_n} dos últimos {} blocos com {validator_count} validadores ativos",
                        self.producer_history.len()
                    ),
                    context: serde_json::json!({ "producer": topo }),
                });
                // Evita repetir o alerta a cada bloco (sentinel.js:100).
                self.producer_history.clear();
            }
        }

        // --- resumo para o dossiê da IA (sentinel.js:104-110) ---------------
        self.recent_activity.push(serde_json::json!({
            "height": block.height,
            "producer": block.producer,
            "txCount": block.tx_count,
            "types": block.transactions.iter().map(|t| t.tx_type.clone()).collect::<Vec<_>>(),
        }));
        if self.recent_activity.len() > ACTIVITY_WINDOW {
            self.recent_activity.remove(0);
        }

        alertas
    }

    /// `#checkValidatorHealth` (sentinel.js:160-192): exige degradação
    /// SUSTENTADA (evita flap durante replay/restart). Quando um validador fica
    /// degradado por `degraded_ticks` ciclos, publica UM alerta com uma
    /// recomendação de governança REDIGIDA pela IA — PROPOSE-ONLY, `autonomous:
    /// false`: NÃO é executada; quem decide é a governança/humano.
    pub fn validator_health(
        &mut self,
        performance: &[ValidatorScore],
        summary_count: usize,
    ) -> Vec<Alert> {
        // Sem garantia com <2 validadores (sentinel.js:165).
        if summary_count < 2 {
            return Vec::new();
        }
        let mut alertas = Vec::new();
        let mut degradados_agora: HashSet<&str> = HashSet::new();
        for v in performance {
            if !v.degraded {
                continue;
            }
            degradados_agora.insert(v.address.as_str());
            let streak = self.degraded_streak.get(&v.address).copied().unwrap_or(0) + 1;
            self.degraded_streak.insert(v.address.clone(), streak);
            if streak >= self.degraded_ticks && !self.alerted_degraded.contains(&v.address) {
                self.alerted_degraded.insert(v.address.clone());
                let rascunho = draft_validator_governance_proposal(v, Some(streak));
                alertas.push(Alert {
                    kind: "VALIDATOR_DEGRADED",
                    severity: "warning",
                    message: format!(
                        "validador {} degradado de forma sustentada (score {}/100, \
produtividade {}%, {} slots perdidos). IA redigiu recomendação de governança (NÃO executada).",
                        v.address, v.score, v.productivity_pct, v.missed
                    ),
                    context: serde_json::json!({
                        "validator": v.address,
                        "score": v.score,
                        "status": v.status.as_str(),
                        "draftProposal": proposal_to_json(&rascunho),
                    }),
                });
            }
        }
        // Quem recuperou: zera o streak e, se havíamos alertado, publica a
        // recuperação (sentinel.js:184-191).
        let recuperados: Vec<String> = self
            .degraded_streak
            .keys()
            .filter(|a| !degradados_agora.contains(a.as_str()))
            .cloned()
            .collect();
        for addr in recuperados {
            self.degraded_streak.remove(&addr);
            if self.alerted_degraded.remove(&addr) {
                alertas.push(Alert {
                    kind: "VALIDATOR_RECOVERED",
                    severity: "info",
                    message: format!("validador {addr} voltou a operar de forma saudável"),
                    context: serde_json::json!({ "validator": addr }),
                });
            }
        }
        alertas
    }

    /// `#checkGovernanceAdvisories` (sentinel.js:198-214): publica cada
    /// advisory NOVO como alerta com o rascunho — a IA propõe, os validadores
    /// votam. Dedup por `param:valor`; esquece quando o parâmetro sai da lista
    /// (pode re-alertar depois).
    pub fn governance_advisories(&mut self, lista: &[AdvisoryView]) -> Vec<Alert> {
        let mut alertas = Vec::new();
        let mut vistos: HashSet<String> = HashSet::new();
        for a in lista {
            let chave = format!("{}:{}", a.param, a.suggested_value);
            vistos.insert(chave.clone());
            if self.advised_keys.contains(&chave) {
                continue;
            }
            self.advised_keys.insert(chave);
            alertas.push(Alert {
                kind: "GOVERNANCE_ADVISORY",
                severity: if a.severity == "warning" { "warning" } else { "info" },
                message: format!(
                    "IA redigiu proposta de governança: {} {} → {}. {}",
                    a.param, a.current_value, a.suggested_value, a.reason
                ),
                context: serde_json::json!({ "advisory": {
                    "param": a.param,
                    "currentValue": a.current_value,
                    "suggestedValue": a.suggested_value,
                    "severity": a.severity,
                    "reason": a.reason,
                }}),
            });
        }
        // Esquece o que sumiu da lista (sentinel.js:213).
        self.advised_keys.retain(|chave| vistos.contains(chave));
        alertas
    }

    /// Monta o dossiê do analista LLM — o prompt de `#aiDigest`
    /// (sentinel.js:229-234): instrução fixa + `/status` + últimos 50 resumos.
    pub fn ai_digest_prompt(&self, status_json: &str) -> String {
        let inicio = self.recent_activity.len().saturating_sub(50);
        let ultimos = serde_json::Value::Array(self.recent_activity[inicio..].to_vec());
        format!(
            "Você é o analista de segurança 24h da blockchain EAV7 (protocolo eav20, DPoS). \
Avalie a atividade recente e responda em português com um parecer curto: \
nível de risco (baixo/médio/alto), anomalias observadas e recomendações.\n\n\
Status: {status_json}\nÚltimos blocos: {ultimos}"
        )
    }
}

/// Serializa o rascunho de governança para o `context` do alerta, com as
/// MESMAS chaves camelCase do objeto que `draftValidatorGovernanceProposal`
/// (src/node/validator-score.js) devolve. Apresentação, nunca consenso.
fn proposal_to_json(p: &ValidatorGovernanceProposal) -> serde_json::Value {
    serde_json::json!({
        "kind": p.kind,
        // PROPOSE-ONLY: `false` SEMPRE — a IA não executa (ver eav7-ai-roadmap).
        "autonomous": p.autonomous,
        "target": p.target,
        "evidence": {
            "score": p.evidence.score,
            "status": p.evidence.status.as_str(),
            "productivityPct": p.evidence.productivity_pct,
            "inTurn": p.evidence.in_turn,
            "expected": p.evidence.expected,
            "missed": p.evidence.missed,
            "avgLatencyMs": p.evidence.avg_latency_ms,
            "lastProducedHeight": p.evidence.last_produced_height,
            "sustainedTicks": p.evidence.sustained_ticks,
        },
        "recommendation": p.recommendation,
        "operationalMitigation": p.operational_mitigation,
    })
}

// ---------------------------------------------------------------------------
// Transporte — SecuritySentinel
// ---------------------------------------------------------------------------

/// Configuração do transporte — os parâmetros do construtor do JS
/// (sentinel.js:16) + as variáveis de ambiente que ele lê.
#[derive(Clone)]
pub struct SentinelConfig {
    /// URL do nó (sem barra final — o `replace(/\/$/, '')` de sentinel.js:17).
    pub node_url: String,
    /// Período do ciclo, em ms (JS: 5000).
    pub poll_ms: u64,
    /// Período do parecer LLM, em ms (JS: 10 min).
    pub ai_digest_ms: u64,
    /// Período do conselheiro de governança (`EAV7_ADVISORY_MS`, JS: 10 min).
    pub advisory_ms: u64,
    /// Ciclos consecutivos p/ alertar degradação (`EAV7_DEGRADED_TICKS`, JS: 6).
    pub degraded_ticks: u64,
    /// Escrita de alertas exige token de admin (`EAV7_ADMIN_TOKEN`, sentinel.js:51).
    pub admin_token: Option<String>,
    /// `ANTHROPIC_API_KEY` — sem ela, só heurísticas (como no JS).
    pub anthropic_api_key: Option<String>,
}

impl SentinelConfig {
    /// Defaults do construtor JS + leitura das envs (sentinel.js:16-33).
    pub fn from_env(node_url: &str) -> Self {
        let env_u64 = |nome: &str, padrao: u64| {
            std::env::var(nome).ok().and_then(|v| v.parse::<u64>().ok()).unwrap_or(padrao)
        };
        SentinelConfig {
            node_url: node_url.trim_end_matches('/').to_string(),
            poll_ms: 5000,
            ai_digest_ms: 10 * 60_000,
            advisory_ms: env_u64("EAV7_ADVISORY_MS", 10 * 60_000),
            degraded_ticks: env_u64("EAV7_DEGRADED_TICKS", DEFAULT_DEGRADED_TICKS),
            admin_token: std::env::var("EAV7_ADMIN_TOKEN").ok().filter(|t| !t.is_empty()),
            anthropic_api_key: std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.is_empty()),
        }
    }
}

/// A sentinela: dona exclusiva do [`SentinelCore`] + o cliente HTTP do P2P.
/// Sem `Mutex` de propósito — roda numa única task, então nenhum lock existe
/// para atravessar `await` (regra do crate).
pub struct SecuritySentinel {
    config: SentinelConfig,
    client: HttpClient,
    core: SentinelCore,
    last_ai_digest_at: i64,
    last_advisory_at: i64,
    /// Borda TLS para a API da Anthropic (ver `ai/mod.rs`). Em produção o
    /// `main.rs` a injeta sozinho quando há `ANTHROPIC_API_KEY`; `None` ⇒ o
    /// parecer LLM fica desligado mesmo com a chave presente (é o caso dos
    /// testes, e do nó cuja construção do cliente TLS falhou).
    llm: Option<Arc<dyn LlmClient>>,
}

impl SecuritySentinel {
    pub fn new(config: SentinelConfig, llm: Option<Arc<dyn LlmClient>>) -> Self {
        let core = SentinelCore::new(config.degraded_ticks);
        SecuritySentinel {
            config,
            client: make_client(),
            core,
            last_ai_digest_at: 0,
            last_advisory_at: 0,
            llm,
        }
    }

    /// Log da sentinela — o `console.log` default do JS.
    fn log(&self, msg: &str) {
        println!("{msg}");
    }

    /// `alert()` (sentinel.js:43-59): loga e publica no nó. Falha de publicação
    /// é LOGADA e engolida — a sentinela não pode morrer porque o nó recusou um
    /// POST.
    async fn publicar(&self, alerta: &Alert) {
        self.log(&format!(
            "[sentinela][{}] {}: {}",
            alerta.severity.to_uppercase(),
            alerta.kind,
            alerta.message
        ));
        let corpo = serde_json::json!({
            "source": "ai-sentinel",
            "kind": alerta.kind,
            "severity": alerta.severity,
            "message": alerta.message,
            "context": alerta.context,
        })
        .to_string();
        let header = self
            .config
            .admin_token
            .as_ref()
            .map(|t| ("x-admin-token", t.clone()));
        if let Err(e) = http_post_json(
            &self.client,
            &format!("{}/security/alerts", self.config.node_url),
            corpo,
            header,
            10_000,
        )
        .await
        {
            self.log(&format!("[sentinela] falha ao publicar alerta: {e}"));
        }
    }

    async fn publicar_todos(&self, alertas: &[Alert]) {
        for a in alertas {
            self.publicar(a).await;
        }
    }

    /// Um ciclo completo — `tick()` (sentinel.js:113-153). Erro de rede no
    /// `/status`/`/blocks` propaga (o laço loga, como o `.catch` do JS); as
    /// checagens secundárias degradam com log próprio.
    pub async fn tick(&mut self) -> Result<(), String> {
        let status = http_get_json(
            &self.client,
            &format!("{}/status", self.config.node_url),
            10_000,
        )
        .await?;
        let altura = status.get("height").and_then(|v| v.as_i64()).unwrap_or(-1);
        let mempool = status.get("mempool").and_then(|v| v.as_u64()).unwrap_or(0);
        let validadores = status.get("validators").and_then(|v| v.as_u64()).unwrap_or(0);

        let alertas = self.core.check_status(altura, mempool);
        self.publicar_todos(&alertas).await;

        // Blocos novos: pagina de lastHeight+1, 100 por vez (sentinel.js:131-136).
        if altura > self.core.last_height() {
            let de = (self.core.last_height() + 1).max(0);
            let blocos = http_get_json(
                &self.client,
                &format!("{}/blocks?from={de}&limit=100", self.config.node_url),
                10_000,
            )
            .await?;
            let mut ultima = None;
            if let Some(lista) = blocos.as_array() {
                for b in lista {
                    let vista = parse_block_view(b);
                    ultima = Some(vista.height);
                    let alertas = self.core.inspect_block(&vista, validadores);
                    self.publicar_todos(&alertas).await;
                }
            }
            self.core.note_synced_height(ultima.unwrap_or(altura));
        }

        // Saúde dos validadores (sentinel.js:138-139) — falha só loga.
        if let Err(e) = self.checar_validadores().await {
            self.log(&format!("[sentinela] checagem de validadores falhou: {e}"));
        }

        // Conselheiro de governança no seu próprio período (sentinel.js:141-145).
        let agora = now_ms();
        if agora - self.last_advisory_at > self.config.advisory_ms as i64 {
            self.last_advisory_at = agora;
            if let Err(e) = self.checar_advisories().await {
                self.log(&format!("[sentinela] conselheiro de governança falhou: {e}"));
            }
        }

        // Parecer LLM (sentinel.js:147-152): exige a chave E o cliente TLS
        // injetado — sem qualquer um dos dois, comporta-se como o JS sem chave.
        if let (Some(chave), Some(llm)) = (&self.config.anthropic_api_key, &self.llm)
            && agora - self.last_ai_digest_at > self.config.ai_digest_ms as i64
        {
            self.last_ai_digest_at = agora;
            let prompt = self.core.ai_digest_prompt(&status.to_string());
            let corpo = anthropic_request_body(DEFAULT_CLAUDE_MODEL, 600, &prompt);
            // Timeout de 60 s — o `AbortSignal.timeout(60_000)` de sentinel.js:237.
            match llm.post_json(ANTHROPIC_API_URL, chave, corpo, 60_000).await {
                Ok(resposta) => {
                    let texto = anthropic_extract_text(&resposta);
                    self.publicar(&Alert {
                        kind: "AI_ANALYSIS",
                        severity: "info",
                        message: texto,
                        context: serde_json::json!({ "model": DEFAULT_CLAUDE_MODEL }),
                    })
                    .await;
                }
                Err(e) => self.log(&format!("[sentinela] análise por IA falhou: {e}")),
            }
        }
        Ok(())
    }

    /// Busca `/validators` e delega a heurística pura (sentinel.js:160-165).
    async fn checar_validadores(&mut self) -> Result<(), String> {
        // O JS engole o erro do GET (`catch { return }`) — aqui propagamos até
        // o chamador, que loga; o efeito observável é o mesmo.
        let dados = http_get_json(
            &self.client,
            &format!("{}/validators", self.config.node_url),
            10_000,
        )
        .await?;
        let Some(perf) = dados.get("performance").and_then(|p| p.as_array()) else {
            return Ok(()); // `!Array.isArray(perf)` → retorno silencioso
        };
        let quantos = dados
            .get("performanceSummary")
            .and_then(|s| s.get("count"))
            .and_then(|c| c.as_u64())
            .unwrap_or(0) as usize;
        let scores: Vec<ValidatorScore> = perf.iter().filter_map(parse_validator_score).collect();
        let alertas = self.core.validator_health(&scores, quantos);
        self.publicar_todos(&alertas).await;
        Ok(())
    }

    /// Busca `/governance/advisories` e delega a heurística pura
    /// (sentinel.js:198-214).
    async fn checar_advisories(&mut self) -> Result<(), String> {
        let dados = http_get_json(
            &self.client,
            &format!("{}/governance/advisories", self.config.node_url),
            10_000,
        )
        .await?;
        let Some(lista) = dados.get("advisories").and_then(|a| a.as_array()) else {
            return Ok(());
        };
        let vistas: Vec<AdvisoryView> = lista
            .iter()
            .map(|a| AdvisoryView {
                param: texto(a, "param"),
                current_value: texto(a, "currentValue"),
                suggested_value: texto(a, "suggestedValue"),
                severity: texto(a, "severity"),
                reason: texto(a, "reason"),
            })
            .collect();
        let alertas = self.core.governance_advisories(&vistas);
        self.publicar_todos(&alertas).await;
        Ok(())
    }

    /// `start()` (sentinel.js:245-251): laço periódico; erro de ciclo é logado
    /// e o laço continua (o `.catch` do setInterval do JS).
    pub fn start(mut self) -> tokio::task::JoinHandle<()> {
        let com_llm = self.config.anthropic_api_key.is_some() && self.llm.is_some();
        self.log(&format!(
            "[sentinela] vigilância 24h ativa em {}{}",
            self.config.node_url,
            if com_llm {
                " (análise por Claude habilitada)"
            } else {
                " (heurísticas locais; defina ANTHROPIC_API_KEY para a análise por Claude)"
            }
        ));
        tokio::spawn(async move {
            let mut intervalo = tokio::time::interval(Duration::from_millis(self.config.poll_ms));
            intervalo.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                intervalo.tick().await;
                if let Err(e) = self.tick().await {
                    self.log(&format!("[sentinela] erro no ciclo: {e}"));
                }
            }
        })
    }
}

// ---------------------------------------------------------------- parse views

fn texto(v: &serde_json::Value, campo: &str) -> String {
    v.get(campo).and_then(|x| x.as_str()).unwrap_or_default().to_string()
}

/// JSON de `/blocks` → [`BlockView`] — apresentação, leitura leniente (campo
/// ausente vira default; o JS faria o mesmo com `undefined` até quebrar no
/// BigInt, ver a nota de [`TxView`]).
fn parse_block_view(b: &serde_json::Value) -> BlockView {
    let transactions = b
        .get("transactions")
        .and_then(|t| t.as_array())
        .map(|lista| {
            lista
                .iter()
                .map(|tx| TxView {
                    id: texto(tx, "id"),
                    tx_type: texto(tx, "type"),
                    from: texto(tx, "from"),
                    to: tx.get("to").and_then(|t| t.as_str()).map(|s| s.to_string()),
                    amount: texto(tx, "amount"),
                })
                .collect()
        })
        .unwrap_or_default();
    BlockView {
        height: b.get("height").and_then(|v| v.as_i64()).unwrap_or(0),
        hash: texto(b, "hash"),
        producer: texto(b, "producer"),
        tx_count: b.get("txCount").and_then(|v| v.as_i64()).unwrap_or(0),
        transactions,
    }
}

/// Entrada de `performance` de `/validators` → [`ValidatorScore`] do
/// `crate::validator_score`. `status` desconhecido descarta a entrada (nó de
/// outra versão) em vez de adivinhar.
fn parse_validator_score(v: &serde_json::Value) -> Option<ValidatorScore> {
    let status = match v.get("status").and_then(|s| s.as_str())? {
        "healthy" => ValidatorStatus::Healthy,
        "lagging" => ValidatorStatus::Lagging,
        "degraded" => ValidatorStatus::Degraded,
        "offline" => ValidatorStatus::Offline,
        _ => return None,
    };
    let u = |campo: &str| v.get(campo).and_then(|x| x.as_u64()).unwrap_or(0);
    Some(ValidatorScore {
        address: v.get("address").and_then(|a| a.as_str())?.to_string(),
        staked: texto(v, "staked"),
        score: v.get("score").and_then(|x| x.as_i64()).unwrap_or(0),
        status,
        degraded: v.get("degraded").and_then(|d| d.as_bool()).unwrap_or(false),
        productivity_pct: v.get("productivityPct").and_then(|x| x.as_i64()).unwrap_or(0),
        expected: u("expected"),
        produced: u("produced"),
        in_turn: u("inTurn"),
        missed: u("missed"),
        out_of_turn: u("outOfTurn"),
        avg_latency_ms: v.get("avgLatencyMs").and_then(|x| x.as_i64()),
        last_produced_height: v.get("lastProducedHeight").and_then(|x| x.as_u64()),
        last_produced_at: v.get("lastProducedAt").and_then(|x| x.as_i64()),
    })
}

// ---------------------------------------------------------------------------
// Testes das heurísticas — cada limite dispara/não-dispara na borda exata.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn bloco(altura: i64, hash: &str, produtor: &str, txs: Vec<TxView>) -> BlockView {
        BlockView {
            height: altura,
            hash: hash.to_string(),
            producer: produtor.to_string(),
            tx_count: txs.len() as i64,
            transactions: txs,
        }
    }

    fn transfer(de: &str, valor: u128) -> TxView {
        TxView {
            id: "t".repeat(64),
            tx_type: "TRANSFER".to_string(),
            from: de.to_string(),
            to: Some("E7DEST".to_string()),
            amount: valor.to_string(),
        }
    }

    // ------------------------------------------------------------- REORG

    #[test]
    fn reorg_dispara_so_quando_o_hash_da_mesma_altura_muda() {
        let mut core = SentinelCore::new(6);
        assert!(core.inspect_block(&bloco(5, "aaa", "P1", vec![]), 3).is_empty());
        // Mesmo hash de novo: nada (re-observação inofensiva).
        assert!(core.inspect_block(&bloco(5, "aaa", "P1", vec![]), 3).is_empty());
        // Hash DIFERENTE na mesma altura: fork/reorg — crítico.
        let alertas = core.inspect_block(&bloco(5, "bbb", "P1", vec![]), 3);
        assert_eq!(alertas.len(), 1);
        assert_eq!(alertas[0].kind, "REORG");
        assert_eq!(alertas[0].severity, "critical");
        assert_eq!(alertas[0].context["antes"], "aaa");
        assert_eq!(alertas[0].context["depois"], "bbb");
    }

    // ---------------------------------------------------- LARGE_TRANSFER

    #[test]
    fn transferencia_gigante_e_estritamente_maior_que_1pct_do_supply() {
        let mut core = SentinelCore::new(6);
        let limite = GENESIS_SUPPLY / 100;
        // No limite EXATO (== 1%): NÃO dispara (o JS usa `>` estrito).
        let alertas = core.inspect_block(&bloco(1, "h1", "P1", vec![transfer("E7A", limite)]), 3);
        assert!(alertas.is_empty(), "1% exato não deveria alertar");
        // Um e7 acima: dispara.
        let alertas =
            core.inspect_block(&bloco(2, "h2", "P1", vec![transfer("E7A", limite + 1)]), 3);
        assert_eq!(alertas.len(), 1);
        assert_eq!(alertas[0].kind, "LARGE_TRANSFER");
        assert!(alertas[0].message.contains(">1% do supply"));
        // Tipo diferente de TRANSFER com o mesmo valor: nada.
        let mut nao_transfer = transfer("E7A", limite + 1);
        nao_transfer.tx_type = "STAKE".to_string();
        assert!(core.inspect_block(&bloco(3, "h3", "P1", vec![nao_transfer]), 3).is_empty());
        // Amount imparseável: ignorado (divergência documentada — o JS quebraria o tick).
        let mut podre = transfer("E7A", 1);
        podre.amount = "não-é-número".to_string();
        assert!(core.inspect_block(&bloco(4, "h4", "P1", vec![podre]), 3).is_empty());
    }

    // ---------------------------------------------------------- TX_BURST

    #[test]
    fn rajada_dispara_acima_de_20_txs_do_mesmo_remetente() {
        let mut core = SentinelCore::new(6);
        // 20 do mesmo remetente: NÃO dispara (o JS usa `> 20`).
        let txs: Vec<TxView> = (0..20).map(|_| transfer("E7A", 1)).collect();
        assert!(core.inspect_block(&bloco(1, "h1", "P1", txs), 3).is_empty());
        // 21: dispara.
        let txs: Vec<TxView> = (0..21).map(|_| transfer("E7A", 1)).collect();
        let alertas = core.inspect_block(&bloco(2, "h2", "P1", txs), 3);
        assert_eq!(alertas.len(), 1);
        assert_eq!(alertas[0].kind, "TX_BURST");
        assert_eq!(alertas[0].context["count"], 21);
        // 21 txs repartidas entre dois remetentes: nada.
        let txs: Vec<TxView> = (0..11)
            .map(|_| transfer("E7A", 1))
            .chain((0..10).map(|_| transfer("E7B", 1)))
            .collect();
        assert!(core.inspect_block(&bloco(3, "h3", "P1", txs), 3).is_empty());
    }

    // --------------------------------------------- PRODUCER_CONCENTRATION

    #[test]
    fn concentracao_de_produtor_no_limite_de_80_pct() {
        // 40/50 = 0.8 EXATO: NÃO dispara (o JS usa `> 0.8`).
        let mut core = SentinelCore::new(6);
        let mut alertas = Vec::new();
        for i in 0..50 {
            let quem = if i < 40 { "E7DOMINANTE" } else { "E7OUTRO" };
            alertas.extend(core.inspect_block(&bloco(i, &format!("h{i}"), quem, vec![]), 3));
        }
        assert!(alertas.iter().all(|a| a.kind != "PRODUCER_CONCENTRATION"));

        // 41/50 > 0.8: dispara UMA vez e limpa a janela (anti-repetição).
        let mut core = SentinelCore::new(6);
        let mut alertas = Vec::new();
        for i in 0..50 {
            let quem = if i < 41 { "E7DOMINANTE" } else { "E7OUTRO" };
            alertas.extend(core.inspect_block(&bloco(i, &format!("h{i}"), quem, vec![]), 3));
        }
        let conc: Vec<_> =
            alertas.iter().filter(|a| a.kind == "PRODUCER_CONCENTRATION").collect();
        assert_eq!(conc.len(), 1);
        assert_eq!(conc[0].context["producer"], "E7DOMINANTE");
        // Janela foi limpa: o próximo bloco sozinho não re-dispara.
        assert!(core.inspect_block(&bloco(50, "h50", "E7DOMINANTE", vec![]), 3).is_empty());
    }

    #[test]
    fn concentracao_ignorada_com_um_so_validador() {
        // validatorCount == 1: monocultura é o esperado, não anomalia (js:92).
        let mut core = SentinelCore::new(6);
        for i in 0..60 {
            let alertas = core.inspect_block(&bloco(i, &format!("h{i}"), "E7UNICO", vec![]), 1);
            assert!(alertas.iter().all(|a| a.kind != "PRODUCER_CONCENTRATION"));
        }
    }

    // -------------------------------------------- CHAIN_ROLLBACK / FLOOD

    #[test]
    fn rollback_pequeno_alerta_e_regressao_gigante_rebaselina_em_silencio() {
        let mut core = SentinelCore::new(6);
        core.note_synced_height(100_000);
        // Regressão de exatamente 50k: ainda é rollback (o JS usa `> 50_000`).
        let alertas = core.check_status(50_000, 0);
        assert_eq!(alertas.len(), 1);
        assert_eq!(alertas[0].kind, "CHAIN_ROLLBACK");
        assert_eq!(alertas[0].severity, "critical");
        // E lastHeight NÃO regride no caso de rollback (como no JS).
        assert_eq!(core.last_height(), 100_000);
        // Regressão de 50k+1: relaunch/troca de gênese — silêncio + re-baseline.
        let alertas = core.check_status(49_999, 0);
        assert!(alertas.is_empty());
        assert_eq!(core.last_height(), 49_999);
    }

    #[test]
    fn flood_de_mempool_acima_de_1000() {
        let mut core = SentinelCore::new(6);
        assert!(core.check_status(0, 1000).is_empty(), "1000 exato não alerta");
        let alertas = core.check_status(1, 1001);
        assert_eq!(alertas.len(), 1);
        assert_eq!(alertas[0].kind, "MEMPOOL_FLOOD");
    }

    // ------------------------------------------------- saúde de validador

    fn score_degradado(addr: &str, degradado: bool) -> ValidatorScore {
        ValidatorScore {
            address: addr.to_string(),
            staked: "1000000000".to_string(),
            score: if degradado { 30 } else { 95 },
            status: if degradado { ValidatorStatus::Degraded } else { ValidatorStatus::Healthy },
            degraded: degradado,
            productivity_pct: if degradado { 40 } else { 99 },
            expected: 10,
            produced: 4,
            in_turn: 4,
            missed: 6,
            out_of_turn: 0,
            avg_latency_ms: None,
            last_produced_height: Some(100),
            last_produced_at: None,
        }
    }

    #[test]
    fn degradacao_so_alerta_apos_streak_sustentado_e_nao_repete() {
        let mut core = SentinelCore::new(6);
        let perf = vec![score_degradado("E7VAL", true), score_degradado("E7OK", false)];
        // Ciclos 1..5: silêncio (anti-flap durante replay/restart, js:26-27).
        for _ in 0..5 {
            assert!(core.validator_health(&perf, 2).is_empty());
        }
        // 6º ciclo: alerta com o rascunho propose-only anexado.
        let alertas = core.validator_health(&perf, 2);
        assert_eq!(alertas.len(), 1);
        assert_eq!(alertas[0].kind, "VALIDATOR_DEGRADED");
        assert!(alertas[0].message.contains("NÃO executada"));
        // LINHA DE SEGURANÇA: o rascunho anexado é propose-only.
        assert_eq!(alertas[0].context["draftProposal"]["autonomous"], false);
        assert_eq!(alertas[0].context["draftProposal"]["evidence"]["sustainedTicks"], 6);
        // 7º ciclo: dedup — não repete enquanto a ocorrência durar.
        assert!(core.validator_health(&perf, 2).is_empty());
        // Recuperação: alerta VALIDATOR_RECOVERED uma única vez.
        let saudavel = vec![score_degradado("E7VAL", false), score_degradado("E7OK", false)];
        let alertas = core.validator_health(&saudavel, 2);
        assert_eq!(alertas.len(), 1);
        assert_eq!(alertas[0].kind, "VALIDATOR_RECOVERED");
        assert!(core.validator_health(&saudavel, 2).is_empty());
        // Nova ocorrência recomeça o streak do zero.
        assert!(core.validator_health(&perf, 2).is_empty());
    }

    #[test]
    fn saude_ignorada_com_menos_de_2_validadores() {
        // `summary.count < 2` retorna sem processar (js:165) — sem garantia.
        let mut core = SentinelCore::new(1);
        let perf = vec![score_degradado("E7VAL", true)];
        assert!(core.validator_health(&perf, 1).is_empty());
        assert!(core.validator_health(&perf, 0).is_empty());
    }

    // ------------------------------------------------ advisories de gov.

    fn advisory(param: &str, sugerido: &str, severidade: &str) -> AdvisoryView {
        AdvisoryView {
            param: param.to_string(),
            current_value: "10".to_string(),
            suggested_value: sugerido.to_string(),
            severity: severidade.to_string(),
            reason: "porque sim".to_string(),
        }
    }

    #[test]
    fn advisory_novo_alerta_repetido_deduplica_e_removido_e_esquecido() {
        let mut core = SentinelCore::new(6);
        let lista = vec![advisory("blockReward", "20", "warning")];
        let alertas = core.governance_advisories(&lista);
        assert_eq!(alertas.len(), 1);
        assert_eq!(alertas[0].kind, "GOVERNANCE_ADVISORY");
        assert_eq!(alertas[0].severity, "warning"); // warning promove (js:209)
        assert!(alertas[0].message.contains("blockReward 10 → 20"));
        // Mesmo advisory de novo: dedup por param:valor.
        assert!(core.governance_advisories(&lista).is_empty());
        // Valor sugerido MUDOU: é chave nova, alerta de novo — como info.
        let lista2 = vec![advisory("blockReward", "25", "info")];
        let alertas = core.governance_advisories(&lista2);
        assert_eq!(alertas.len(), 1);
        assert_eq!(alertas[0].severity, "info");
        // O advisory antigo sumiu da lista ⇒ esquecido ⇒ pode re-alertar.
        let alertas = core.governance_advisories(&lista);
        assert_eq!(alertas.len(), 1, "advisory esquecido tem de re-alertar");
    }

    // ------------------------------------------------------ dossiê da IA

    #[test]
    fn dossie_contem_instrucao_status_e_no_maximo_50_blocos() {
        let mut core = SentinelCore::new(6);
        for i in 0..60 {
            core.inspect_block(&bloco(i, &format!("h{i}"), "P1", vec![]), 1);
        }
        let prompt = core.ai_digest_prompt("{\"height\":60}");
        assert!(prompt.contains("analista de segurança 24h da blockchain EAV7"));
        assert!(prompt.contains("Status: {\"height\":60}"));
        // Só os ÚLTIMOS 50 resumos entram (o slice(-50) de sentinel.js:234):
        // o bloco 9 ficou de fora, o 10 é o primeiro presente.
        assert!(!prompt.contains("\"height\":9,"));
        assert!(prompt.contains("\"height\":10,"));
        assert!(prompt.contains("\"height\":59,"));
    }

    // ----------------------------------------------- janela de hashes

    #[test]
    fn janela_de_hashes_poda_a_menor_altura() {
        let mut core = SentinelCore::new(6);
        for i in 0..(REORG_HASH_WINDOW as i64 + 1) {
            core.inspect_block(&bloco(i, &format!("h{i}"), "P1", vec![]), 1);
        }
        // A altura 0 foi podada: revê-la com OUTRO hash não é mais reorg.
        let alertas = core.inspect_block(&bloco(0, "hash-diferente", "P1", vec![]), 1);
        assert!(alertas.iter().all(|a| a.kind != "REORG"));
        // Mas uma altura recente ainda está na janela.
        let alertas = core.inspect_block(&bloco(400, "hash-trocado", "P1", vec![]), 1);
        assert!(alertas.iter().any(|a| a.kind == "REORG"));
    }
}
