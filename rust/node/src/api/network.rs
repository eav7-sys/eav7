//! Rotas de REDE/OPERAÇÃO da API — porte da fatia correspondente de
//! `src/node/api.js`: gateway (459), guarda anti-abuso (474-485), validadores
//! (1040-1068), governança (1192-1236), tesouraria (1239), camada de IA
//! (1245-1262), ponte (1266-1281), alertas de segurança (1284-1296) e peers
//! (1299-1311).
//!
//! Segue o exemplar de `mod.rs` (`status`): cada handler é uma FUNÇÃO PURA
//! `(&Node, params) -> ApiReply`; a casca axum extrai parâmetros, resolve relógio
//! (`now` em ms) e env, pega o lock (`read` para leitura, `write` só onde o JS
//! muta) e converte com `into_response`.
//!
//! # Tipos de apresentação (fidelidade ao `toJson` do JS)
//!
//! O JS serializa com `toJson` (`config.js:588`), que converte BigInt em TEXTO e
//! deixa `number` como número. Logo, campo a campo: montantes (`Amount`/u128)
//! saem como STRING decimal; contadores/alturas/timestamps saem como número.
//! As views abaixo reproduzem essa distinção à mão — um conversor uniforme do
//! `Value` canônico perderia a diferença (lá tudo inteiro tem a mesma tag).

use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use serde_json::{json, Map as JsonMap, Value as Json};

use eav7::blockchain::Blockchain;
use eav7::config as c;
use eav7::state::ai::{Challenge, Entrega, Fase, Oracle, Task, TaskKind};
use eav7::state::bridge::{Entrada, Estagio, Liquidacao, Saida, Transfer};
use eav7::state::gov::governable_bounds;
use eav7::state::gov::{Proposal, ValorGov};
use eav7::state::State as ChainState;
use eav7::transaction::JsonValue;

use crate::governance_advisor::{advise_governance, Advisory, BridgeStats, GovParams, GovStats};
use crate::node::{Node, SecurityAlert};
use crate::validator_score::{
    score_validators, BlockInput, ScoreValidatorsResult, ValidatorInput, ValidatorScore,
    DEFAULT_DEGRADED_BELOW, DEFAULT_LAGGING_BELOW,
};

use super::{bad_request, int_param, into_response, reply, ApiReply, AppState};

// ============================================================================
// Conversores de apresentação
// ============================================================================

/// `tx.data`/valores opacos (`JsonValue` da lib) → JSON de apresentação. O JS
/// serve esses pedaços CRUS (número JSON continua número), então a conversão é
/// 1:1 por variante.
fn jv(v: &JsonValue) -> Json {
    match v {
        JsonValue::Null => Json::Null,
        JsonValue::Bool(b) => Json::Bool(*b),
        JsonValue::Int(n) => Json::from(*n),
        JsonValue::Str(s) => Json::String(s.clone()),
        JsonValue::List(l) => Json::Array(l.iter().map(jv).collect()),
        JsonValue::Map(m) => Json::Object(m.iter().map(|(k, x)| (k.clone(), jv(x))).collect()),
    }
}

/// `campo ?? null` do JS — a chave existe, com `null` quando não há valor.
fn texto_ou_nulo(o: &Option<String>) -> Json {
    match o {
        Some(s) => Json::String(s.clone()),
        None => Json::Null,
    }
}

// ============================================================================
// Parâmetros governáveis — tabela de ESPÉCIE local
// ============================================================================
//
// `CHAIN.GOVERNABLE` (`config.js:129`) traz nome + kind + limites. A lib expõe os
// LIMITES em `eav7::state::gov::governable_bounds` (fonte única), mas NÃO expõe a
// lista de nomes nem o `kind` — e o kind decide o TIPO JSON de apresentação
// (`bigint` → string via toJson; `int` → número). A tabela abaixo duplica só
// (nome, kind, default) para a camada de apresentação; limites continuam vindo de
// `governable_bounds`. DUPLICAÇÃO RELATADA: se um governável novo entrar na lib,
// esta lista precisa acompanhar.

/// (nome, é bigint?) — na ORDEM de `config.js:129-137` (o JS itera
/// `Object.entries`, que preserva a ordem de inserção do objeto).
const GOVERNAVEIS: &[(&str, bool)] = &[
    ("BLOCK_REWARD", true),
    ("MIN_VALIDATOR_STAKE", true),
    ("MAX_VALIDATORS", false),
    ("FEE_EXEMPT_STAKE", true),
    ("MIN_ORACLE_STAKE", true),
    ("TREASURY_PCT", false),
    ("BRIDGE_BREAKER_BPS", false),
];

fn gov_e_bigint(param: &str) -> Option<bool> {
    GOVERNAVEIS.iter().find(|(n, _)| *n == param).map(|(_, b)| *b)
}

/// Default de compilação de cada governável, em decimal (o que `State.param`
/// devolve quando não há override em `state.params`).
fn gov_default_decimal(param: &str) -> Option<String> {
    Some(match param {
        "BLOCK_REWARD" => c::BLOCK_REWARD.to_string(),
        "MIN_VALIDATOR_STAKE" => c::MIN_VALIDATOR_STAKE.to_string(),
        "MAX_VALIDATORS" => c::MAX_VALIDATORS.to_string(),
        "FEE_EXEMPT_STAKE" => c::FEE_EXEMPT_STAKE.to_string(),
        "MIN_ORACLE_STAKE" => c::MIN_ORACLE_STAKE.to_string(),
        "TREASURY_PCT" => c::TREASURY_PCT.to_string(),
        "BRIDGE_BREAKER_BPS" => c::BRIDGE_BREAKER_BPS.to_string(),
        _ => return None,
    })
}

/// Valor EFETIVO em decimal: override on-chain (`state.params`) ou default.
/// Espelha `State.param` (`state.js:623`).
fn param_efetivo_decimal(st: &ChainState, param: &str) -> Option<String> {
    st.params.get(param).cloned().or_else(|| gov_default_decimal(param))
}

/// Decimal de um governável → JSON com o TIPO do JS: `bigint` vira string (é o
/// que `toJson` faz), `int` vira número. Param desconhecido sai como string —
/// forma segura que nunca perde precisão.
fn gov_scalar_json(param: &str, decimal: &str) -> Json {
    match gov_e_bigint(param) {
        Some(false) => decimal
            .parse::<i64>()
            .map(Json::from)
            .unwrap_or_else(|_| Json::String(decimal.to_string())),
        _ => Json::String(decimal.to_string()),
    }
}

/// Parse estrito de um parâmetro efetivo. Override ilegível é ERRO (mesma
/// política dos leitores privados da lib): mascarar com o default esconderia
/// estado corrompido. No JS o valor já vem coagido e nunca falha; aqui a falha
/// vira 400, o mesmo código que o wrapper do JS dá a um `Error` esperado.
fn param_u128(st: &ChainState, param: &str, padrao: u128) -> Result<u128, String> {
    match st.params.get(param) {
        None => Ok(padrao),
        Some(s) => s.parse::<u128>().map_err(|_| format!("parâmetro {param} corrompido")),
    }
}

fn param_u64(st: &ChainState, param: &str, padrao: u64) -> Result<u64, String> {
    match st.params.get(param) {
        None => Ok(padrao),
        Some(s) => s.parse::<u64>().map_err(|_| format!("parâmetro {param} corrompido")),
    }
}

// ============================================================================
// Views (estado → JSON de apresentação, campo a campo como o JS serve)
// ============================================================================

/// Proposta de governança + `voteCount` — `api.js:1196` faz
/// `{ ...p, voteCount: Object.keys(p.votes).length }`. As chaves do objeto são
/// as do literal `state.js:1472` (o mesmo conjunto de `Proposal::to_value`);
/// `executeAt` só existe depois do quórum.
fn proposal_view(p: &Proposal) -> Json {
    let mut m = JsonMap::new();
    m.insert("id".into(), Json::String(p.id.clone()));
    m.insert("param".into(), Json::String(p.param.clone()));
    // `value` foi coagido na proposta: escalar bigint→string / int→número
    // (state.js:1466), estruturado → objeto cru (state.js:1457-1462).
    m.insert("value".into(), match &p.value {
        ValorGov::Inteiro(d) => gov_scalar_json(&p.param, d),
        ValorGov::Objeto(o) => Json::Object(o.iter().map(|(k, v)| (k.clone(), jv(v))).collect()),
    });
    m.insert("proposer".into(), Json::String(p.proposer.clone()));
    m.insert("deadline".into(), Json::from(p.deadline));
    m.insert(
        "votes".into(),
        Json::Object(p.votes.iter().map(|(k, v)| (k.clone(), Json::Bool(*v))).collect()),
    );
    // O campo se chama `state` no Rust; a grafia SERVIDA é `status` (referência).
    m.insert("status".into(), Json::String(p.state.clone()));
    m.insert("createdAt".into(), Json::from(p.created_at));
    if let Some(at) = p.execute_at {
        m.insert("executeAt".into(), Json::from(at));
    }
    m.insert("voteCount".into(), Json::from(p.votes.len()));
    Json::Object(m)
}

/// Oráculo de IA — literal de `state.js:2022`. `stake`/`slashed` são BigInt
/// (string); contadores são números; `reputation` só existe pós-Fase 1;
/// `endpoint` é `null` até ser preenchido.
fn oracle_view(o: &Oracle) -> Json {
    let mut m = JsonMap::new();
    m.insert("address".into(), Json::String(o.address.clone()));
    m.insert("stake".into(), Json::String(o.stake.to_string()));
    m.insert("registeredAt".into(), Json::from(o.registered_at));
    m.insert("tasksCompleted".into(), Json::from(o.tasks_completed));
    m.insert("completed".into(), Json::from(o.completed));
    m.insert("failed".into(), Json::from(o.failed));
    m.insert("slashed".into(), Json::String(o.slashed.to_string()));
    if let Some(r) = o.reputation {
        m.insert("reputation".into(), Json::from(r));
    }
    m.insert("bridgeTransfers".into(), Json::from(o.bridge_transfers));
    m.insert("endpoint".into(), texto_ou_nulo(&o.endpoint));
    Json::Object(m)
}

/// Entrega dos modos com oráculo entregador — espelha `escrever_entrega` da lib:
/// pendente escreve `oracle: null` (sem `resultUri`); entregue escreve os dois.
fn entrega_json(m: &mut JsonMap<String, Json>, e: &Entrega) {
    match e {
        Entrega::Pendente => {
            m.insert("oracle".into(), Json::Null);
        }
        Entrega::Entregue { oracle, result_uri } => {
            m.insert("oracle".into(), Json::String(oracle.clone()));
            m.insert("resultUri".into(), texto_ou_nulo(result_uri));
        }
    }
}

/// Tarefa de IA — o conjunto de chaves de `Task::to_value` (que espelha os
/// literais `state.js:1961/1977/1993` + fases), com os tipos do `toJson`:
/// `reward`/`budget`/`bond`/`price` (BigInt) como string; alturas/timestamps
/// como número.
fn task_view(t: &Task) -> Json {
    let mut m = JsonMap::new();
    m.insert("id".into(), Json::String(t.id.clone()));
    m.insert("requester".into(), Json::String(t.requester.clone()));
    m.insert("reward".into(), Json::String(t.reward.to_string()));
    m.insert("status".into(), Json::String(t.state.clone()));
    m.insert("expiresAt".into(), Json::from(t.deadline));
    m.insert("resultHash".into(), texto_ou_nulo(&t.result_hash));
    m.insert("output".into(), texto_ou_nulo(&t.output));
    m.insert("prompt".into(), texto_ou_nulo(&t.prompt));
    m.insert("params".into(), match &t.params {
        Some(p) => jv(p),
        None => Json::Null,
    });
    m.insert("model".into(), texto_ou_nulo(&t.model));
    m.insert("createdAt".into(), Json::from(t.created_at));
    m.insert("completedAt".into(), match t.completed_at {
        Some(ts) => Json::from(ts),
        None => Json::Null,
    });
    match &t.kind {
        TaskKind::Quorum(q) => {
            m.insert("mode".into(), Json::String("QUORUM".into()));
            m.insert("quorum".into(), Json::from(q.quorum));
            m.insert("phase".into(), Json::String(match q.phase {
                Fase::Commit => "COMMIT".into(),
                Fase::Done => "DONE".into(),
            }));
            m.insert("commitDeadline".into(), Json::from(q.commit_deadline));
            m.insert("revealDeadline".into(), Json::from(q.reveal_deadline));
            m.insert(
                "commits".into(),
                Json::Object(
                    q.commits.iter().map(|(k, v)| (k.clone(), Json::String(v.clone()))).collect(),
                ),
            );
            // Cada revelação é `{resultHash, output?}`; o output some na poda
            // (state.js:2311) — mesma condição do `to_value` da lib.
            m.insert(
                "reveals".into(),
                Json::Object(
                    q.reveals
                        .iter()
                        .map(|(quem, hash)| {
                            let mut r = JsonMap::new();
                            r.insert("resultHash".into(), Json::String(hash.clone()));
                            if let Some(out) = q.reveal_outputs.get(quem) {
                                r.insert("output".into(), Json::String(out.clone()));
                            }
                            (quem.clone(), Json::Object(r))
                        })
                        .collect(),
                ),
            );
            m.insert("winners".into(), match &q.winners {
                Some(w) => Json::Array(w.iter().map(|a| Json::String(a.clone())).collect()),
                None => Json::Null,
            });
        }
        TaskKind::Aberta(a) => {
            m.insert("mode".into(), Json::String("OPEN".into()));
            m.insert("budget".into(), Json::String(a.budget.to_string()));
            m.insert("bidDeadline".into(), Json::from(a.bid_deadline));
            // `{price, at}` (state.js:2241): price é BigInt → string; at é número.
            m.insert(
                "bids".into(),
                Json::Object(
                    a.bids
                        .iter()
                        .map(|(quem, (preco, quando))| {
                            (quem.clone(), json!({
                                "price": preco.to_string(),
                                "at": quando,
                            }))
                        })
                        .collect(),
                ),
            );
            m.insert("assignedOracle".into(), texto_ou_nulo(&a.assigned_oracle));
            entrega_json(&mut m, &a.entrega);
        }
        TaskKind::Designada(d) => {
            // Modo designado NÃO tem a chave `mode` (só os outros dois literais).
            m.insert("assignedOracle".into(), Json::String(d.assigned_oracle.clone()));
            m.insert("private".into(), Json::Bool(d.private));
            entrega_json(&mut m, &d.entrega);
        }
    }
    match &t.challenge {
        Challenge::Nenhum => {}
        Challenge::Janela { deadline } => {
            m.insert("challengeDeadline".into(), Json::from(*deadline));
        }
        Challenge::Disputa { deadline, challenger, bond, verdict_deadline, votes } => {
            m.insert("challengeDeadline".into(), Json::from(*deadline));
            m.insert("bond".into(), Json::String(bond.to_string()));
            m.insert("challenger".into(), Json::String(challenger.clone()));
            m.insert("verdictDeadline".into(), Json::from(*verdict_deadline));
            m.insert(
                "votes".into(),
                Json::Object(votes.iter().map(|(k, v)| (k.clone(), Json::Bool(*v))).collect()),
            );
        }
    }
    if let Some(v) = &t.verified {
        m.insert("verified".into(), Json::String(v.clone()));
    }
    Json::Object(m)
}

/// Metade OUT da ponte — literal `state.js:2386` (+ liquidação `:2556-2559`).
fn saida_view(s: &Saida) -> Json {
    let mut m = JsonMap::new();
    m.insert("id".into(), Json::String(s.id.clone()));
    m.insert("direction".into(), Json::String("OUT".into()));
    m.insert("from".into(), Json::String(s.from.clone()));
    m.insert("targetChain".into(), Json::String(s.target_chain.clone()));
    m.insert("targetAddress".into(), Json::String(s.target_address.clone()));
    m.insert("token".into(), texto_ou_nulo(&s.token));
    m.insert("amount".into(), Json::String(s.amount.to_string()));
    m.insert("createdAt".into(), Json::from(s.created_at));
    m.insert("status".into(), Json::String(match s.liquidacao {
        Liquidacao::Travada => "LOCKED".into(),
        Liquidacao::Paga { .. } => "PAID".into(),
    }));
    if let Liquidacao::Paga { settled_by, external_tx_hash, settled_at } = &s.liquidacao {
        m.insert("settledBy".into(), Json::String(settled_by.clone()));
        m.insert("externalTxHash".into(), texto_ou_nulo(external_tx_hash));
        m.insert("settledAt".into(), Json::from(*settled_at));
    }
    Json::Object(m)
}

/// Metade IN da ponte — literais `state.js:2513` (atestada, com `quorum`) e
/// `:2539` (liberada, sem).
fn entrada_view(e: &Entrada) -> Json {
    let mut m = JsonMap::new();
    m.insert("id".into(), Json::String(e.id.clone()));
    m.insert("direction".into(), Json::String("IN".into()));
    m.insert("relayer".into(), Json::String(e.relayer.clone()));
    m.insert("to".into(), Json::String(e.to.clone()));
    m.insert("sourceChain".into(), Json::String(e.source_chain.clone()));
    m.insert("sourceTxHash".into(), Json::String(e.source_tx_hash.clone()));
    m.insert("token".into(), texto_ou_nulo(&e.token));
    m.insert("amount".into(), Json::String(e.amount.to_string()));
    m.insert("attestations".into(), Json::from(e.attestations));
    m.insert("createdAt".into(), Json::from(e.created_at));
    m.insert("status".into(), Json::String(match e.estagio {
        Estagio::Atestada { .. } => "ATTESTED".into(),
        Estagio::Liberada => "RELEASED".into(),
    }));
    if let Estagio::Atestada { quorum } = e.estagio {
        m.insert("quorum".into(), Json::from(quorum));
    }
    Json::Object(m)
}

fn transfer_view(t: &Transfer) -> Json {
    match t {
        Transfer::Out(s) => saida_view(s),
        Transfer::In(e) => entrada_view(e),
    }
}

/// Alerta de segurança — `{at, source, kind, severity, message, context}`
/// (`node.js:246`).
fn alert_view(a: &SecurityAlert) -> Json {
    json!({
        "at": a.at,
        "source": a.source,
        "kind": a.kind,
        "severity": a.severity,
        "message": a.message,
        "context": a.context,
    })
}

/// Um validador do score — o objeto de `validator-score.js:45-52`. `staked` já
/// vem como STRING do módulo (fiel ao `.toString()` do JS).
fn score_view(v: &ValidatorScore) -> Json {
    json!({
        "address": v.address,
        "staked": v.staked,
        "score": v.score,
        "status": v.status.as_str(),
        "degraded": v.degraded,
        "productivityPct": v.productivity_pct,
        "expected": v.expected,
        "produced": v.produced,
        "inTurn": v.in_turn,
        "missed": v.missed,
        "outOfTurn": v.out_of_turn,
        "avgLatencyMs": v.avg_latency_ms,
        "lastProducedHeight": v.last_produced_height,
        "lastProducedAt": v.last_produced_at,
    })
}

/// `{ window, validators, summary }` — o retorno de `scoreValidators`.
fn perf_view(r: &ScoreValidatorsResult) -> Json {
    json!({
        "window": {
            "blocks": r.window.blocks,
            "fromHeight": r.window.from_height,
            "toHeight": r.window.to_height,
        },
        "validators": r.validators.iter().map(score_view).collect::<Vec<_>>(),
        "summary": {
            "count": r.summary.count,
            "healthy": r.summary.healthy,
            "degraded": r.summary.degraded,
            "degradedAddresses": r.summary.degraded_addresses,
            "avgScore": r.summary.avg_score,
            "worst": r.summary.worst.as_ref().map(|w| json!({
                "address": w.address,
                "score": w.score,
                "status": w.status.as_str(),
            })),
        },
    })
}

/// Advisory do conselheiro — `governance-advisor.js:65-78`. `currentValue`/
/// `suggestedValue` e o `value` do rascunho seguem o TIPO do parâmetro no JS:
/// bigint → string, int → número (o Rust interno guarda tudo como decimal, e a
/// conversão por espécie devolve exatamente o que o `toJson` emitiria).
fn advisory_view(a: &Advisory) -> Json {
    let atual = gov_scalar_json(&a.param, &a.current_value);
    let sugerido = gov_scalar_json(&a.param, &a.suggested_value);
    json!({
        "kind": a.kind,
        "autonomous": a.autonomous,
        "param": a.param,
        "currentValue": atual,
        "suggestedValue": sugerido,
        "severity": a.severity.as_str(),
        "reason": a.reason,
        "evidence": Json::Object(a.evidence.iter().map(|(k, v)| (k.clone(), jv(v))).collect()),
        // Reconstruído a partir de param/sugerido (mesmo conteúdo do `draft_tx`
        // interno) para aplicar o tipo por espécie — o JsonValue interno guarda o
        // valor como texto sempre.
        "draftTx": { "type": "GOV_PROPOSE", "data": { "param": a.param, "value": sugerido } },
    })
}

// ============================================================================
// Insumos derivados da cadeia
// ============================================================================

/// `blockchain.recentProducerMeta(window)` (`blockchain.js:412`): metadados
/// (altura, produtor, timestamp) dos últimos `max_count` blocos, em ordem
/// CRESCENTE, começando no bloco 1 (o gênese não tem produtor de slot). O JS
/// também respeita `tailStart` (janela em RAM); aqui `get_block` devolve `None`
/// para altura indisponível e o `filter_map` pula — mesmo efeito.
fn recent_producer_meta(bc: &Blockchain, max_count: usize) -> Vec<BlockInput> {
    if bc.height() < 1 {
        return Vec::new();
    }
    let height = bc.height() as u64;
    let lo = height.saturating_sub(max_count.saturating_sub(1) as u64).max(1);
    (lo..=height)
        .filter_map(|h| bc.get_block(h))
        .map(|b| BlockInput {
            height: b.height,
            producer: b.producer.clone(),
            timestamp: b.timestamp,
        })
        .collect()
}

/// Entradas do score na ORDEM do rodízio (`state.validators()` do JS ==
/// `eav7::blockchain::validators`).
fn validator_inputs(st: &ChainState) -> Result<Vec<ValidatorInput>, String> {
    Ok(eav7::blockchain::validators(st)?
        .into_iter()
        .map(|v| ValidatorInput { address: v.address, staked: v.staked })
        .collect())
}

// ============================================================================
// Handlers puros
// ============================================================================

/// GET /gateway — `api.js:459-471`. Serve o snapshot rico do `GatewayHealth`
/// (self/peers/at) quando o failover já rodou ao menos um ciclo; senão os mesmos
/// fallbacks do JS (`?? blockchain.height` / `?? []` / `?? null`). O `lag` sai da
/// config via a casca. O snapshot vive num `Mutex` próprio no Node, escrito pela
/// task de failover — ler aqui não contende com ela nem com o `RwLock`.
pub fn gateway(node: &Node, failover: bool, lag: Option<i64>) -> ApiReply {
    // Lock envenenado do snapshot não pode derrubar a rota: cai no fallback.
    let snap = node.gateway_snapshot.lock().ok().and_then(|s| s.clone());
    let (self_height, peers, at) = match &snap {
        Some(s) => {
            let peers: Vec<Json> = s
                .peers
                .iter()
                .map(|p| json!({ "url": p.url, "height": p.height, "ok": p.ok,
                    // `Infinity` do JS (peer caído) vira `null` no JSON — `u64::MAX`
                    // é o sentinela interno, não um número que o cliente deva ver.
                    "latency": if p.latency == u64::MAX { Json::Null } else { json!(p.latency) } }))
                .collect();
            (s.self_height, Json::Array(peers), json!(s.at))
        }
        // `g?.snapshot?.self ?? blockchain.height` — sem ciclo ainda, a altura local.
        None => (node.blockchain.height(), Json::Array(vec![]), Json::Null),
    };
    reply(200, json!({
        // JS: `process.env.EAV7_GATEWAY_FAILOVER === '1'` — env lido na casca.
        "failover": failover,
        "servingLocal": node.gateway_target.is_none(),
        // peer de onde as leituras estão sendo servidas (null = local)
        "target": node.gateway_target,
        "self": self_height,
        "lag": lag.map_or(Json::Null, |l| json!(l)),
        "peers": peers,
        "at": at,
    }))
}

/// GET /guard — `api.js:474-476`. Observabilidade pública dos bloqueios ativos.
/// `now` vem da casca (o handler não lê relógio). No Rust `node.guard` sempre
/// existe (o "desligado" é `enabled:false` DENTRO do snapshot).
pub fn guard_get(node: &Node, now_ms: u64) -> ApiReply {
    // Lock envenenado não pode derrubar a rota de observabilidade.
    let Ok(g) = node.guard.lock() else {
        return reply(500, json!({ "error": "guarda indisponível" }));
    };
    let s = g.snapshot(now_ms);
    reply(200, json!({
        "enabled": s.enabled,
        "threshold": s.threshold,
        "windowMs": s.window_ms,
        "blockMs": s.block_ms,
        "totalBlocks": s.total_blocks,
        "activeBlocks": s.active_blocks,
        "blocked": s.blocked.iter().map(|b| json!({
            "ip": b.ip,
            "until": b.until,
            "remainingMs": b.remaining_ms,
            "offenses": b.offenses,
        })).collect::<Vec<_>>(),
        "at": s.at,
    }))
}

/// POST /guard/clear — `api.js:479-485`. ADMIN (default-deny sem token): sem
/// `x-admin-token` válido, 403 na hora; depois valida o campo `ip`.
pub fn guard_clear(node: &mut Node, admin_token: Option<&str>, body: &Json) -> ApiReply {
    if !node.check_admin(admin_token) {
        return reply(403, json!({ "error": "não autorizado" }));
    }
    let alvo = body.get("ip").and_then(Json::as_str).unwrap_or("");
    if alvo.is_empty() {
        return bad_request("campo ip obrigatório");
    }
    {
        let limpo = node.guard.lock().map(|mut g| g.clear(alvo)).unwrap_or(false);
        reply(200, json!({ "cleared": limpo, "ip": alvo }))
    }
}

/// GET /validators/performance — `api.js:1040-1048`. Janela clampeada em
/// [50, 5000], default 500 (`api.js:1041`).
pub fn validators_performance(node: &Node, window: usize) -> ApiReply {
    let st = &node.blockchain.state;
    let vals = match validator_inputs(st) {
        Ok(v) => v,
        Err(e) => return bad_request(e),
    };
    let blocks = recent_producer_meta(&node.blockchain, window);
    let perf =
        score_validators(&vals, &blocks, c::BLOCK_TIME_MS, DEFAULT_LAGGING_BELOW, DEFAULT_DEGRADED_BELOW);
    reply(200, perf_view(&perf))
}

/// GET /validators — `api.js:1051-1067`. `now_ms` vem da casca (o JS usa
/// `Date.now()` para o produtor do slot corrente).
pub fn validators_index(node: &Node, now_ms: i64) -> ApiReply {
    let bc = &node.blockchain;
    let st = &bc.state;
    let atuais = match eav7::blockchain::validators(st) {
        Ok(v) => v,
        Err(e) => return bad_request(e),
    };
    let inputs: Vec<ValidatorInput> = atuais
        .iter()
        .map(|v| ValidatorInput { address: v.address.clone(), staked: v.staked })
        .collect();
    let perf = score_validators(
        &inputs,
        &recent_producer_meta(bc, 500),
        c::BLOCK_TIME_MS,
        DEFAULT_LAGGING_BELOW,
        DEFAULT_DEGRADED_BELOW,
    );
    // `blockchain.blockReward(max(height+1, 0))` — recompensa do PRÓXIMO bloco.
    let proxima = (bc.height() + 1).max(0) as u64;
    let reward = match bc.block_reward(proxima, st) {
        Ok(a) => a,
        Err(e) => return bad_request(e),
    };
    let slot_producer = match bc.expected_producer(now_ms) {
        Ok(p) => p,
        Err(e) => return bad_request(e),
    };
    reply(200, json!({
        "maxValidators": c::MAX_VALIDATORS,
        // BigInt no JS → string decimal.
        "minStake": c::MIN_VALIDATOR_STAKE.to_string(),
        "blockReward": reward.to_string(),
        // `state.validators()` → `[{address, staked, votes}]` (bigints → string).
        "current": atuais.iter().map(|v| json!({
            "address": v.address,
            "staked": v.staked.to_string(),
            "votes": v.votes.to_string(),
        })).collect::<Vec<_>>(),
        "slotProducer": slot_producer,
        "performance": perf.validators.iter().map(score_view).collect::<Vec<_>>(),
        "performanceSummary": perf_view(&perf)["summary"],
        "performanceWindow": perf_view(&perf)["window"],
    }))
}

/// GET /governance/proposals — `api.js:1192-1197`. Filtro opcional por status
/// (case-insensitive, `toUpperCase` como o JS).
pub fn governance_proposals(node: &Node, status: Option<&str>) -> ApiReply {
    let filtro = status.map(str::to_uppercase);
    // NOTA de ordem: o JS itera o objeto na ordem de INSERÇÃO (criação); aqui o
    // `BTreeMap` devolve por id ordenado. Divergência de ordenação relatada.
    let lista: Vec<Json> = node
        .blockchain
        .state
        .proposals
        .values()
        .filter(|p| filtro.as_deref().is_none_or(|f| p.state == f))
        .map(proposal_view)
        .collect();
    reply(200, Json::Array(lista))
}

/// GET /governance/advisories — `api.js:1201-1217`. A IA REDIGE rascunhos de
/// GOV_PROPOSE (propose-only); vazio quando tudo está saudável.
///
/// O JS cacheia `eligibleValidatorCount` por altura (`eligibleCache`, achado M2);
/// aqui a contagem é recomputada por request — otimização NÃO portada (relatada),
/// sem efeito no formato da resposta.
pub fn governance_advisories(node: &Node, now_ms: i64) -> ApiReply {
    let bc = &node.blockchain;
    let st = &bc.state;

    // Valores efetivos dos três governáveis que o conselheiro observa.
    let params = {
        let max_validators = match param_u64(st, "MAX_VALIDATORS", c::MAX_VALIDATORS) {
            Ok(v) => v,
            Err(e) => return bad_request(e),
        };
        let min_validator_stake = match param_u128(st, "MIN_VALIDATOR_STAKE", c::MIN_VALIDATOR_STAKE) {
            Ok(v) => v,
            Err(e) => return bad_request(e),
        };
        let bridge_breaker_bps = match param_u64(st, "BRIDGE_BREAKER_BPS", c::BRIDGE_BREAKER_BPS) {
            Ok(v) => v,
            Err(e) => return bad_request(e),
        };
        GovParams { max_validators, min_validator_stake, bridge_breaker_bps }
    };

    // `state.eligibleValidatorCount()` (`state.js:648`): contas com self-stake >=
    // mínimo e não-EAVM, SEM o corte de MAX_VALIDATORS (mede a DEMANDA por slots).
    let elegiveis = st
        .accounts
        .values()
        .filter(|a| a.staked >= params.min_validator_stake && !a.eavm_managed)
        .count() as u64;
    let ativos = match eav7::blockchain::validators(st) {
        Ok(v) => v.len() as u64,
        Err(e) => return bad_request(e),
    };
    let stats = GovStats {
        eligible_validators: Some(elegiveis),
        active_validators: Some(ativos),
        finality_min_validators: Some(c::FINALITY_MIN_VALIDATORS),
        bridge: Some(BridgeStats {
            // `blockchain.height >= CHAIN.BRIDGE_BREAKER_HEIGHT` (api.js:1213).
            breaker_active: bc.height() >= c::BRIDGE_BREAKER_HEIGHT as i64,
            breaker_trips_window: 0,
        }),
    };
    let advisories = advise_governance(&params, &stats);
    reply(200, json!({
        "advisories": advisories.iter().map(advisory_view).collect::<Vec<_>>(),
        "count": advisories.len(),
        "at": now_ms, // `Date.now()` no JS — relógio resolvido na casca
    }))
}

/// GET /governance — `api.js:1219-1236`: overrides + a lista COMPLETA dos
/// governáveis com valor efetivo e limites, propostas, quórum, ativação do fork.
pub fn governance_index(node: &Node) -> ApiReply {
    let bc = &node.blockchain;
    let st = &bc.state;
    let proposals: Vec<Json> = st.proposals.values().map(proposal_view).collect();

    // `state.params` — só os overrides, com o tipo coagido por espécie (o JS
    // guarda BigInt/number; a serialização vira string/número).
    let params: JsonMap<String, Json> = st
        .params
        .iter()
        .map(|(k, v)| (k.clone(), gov_scalar_json(k, v)))
        .collect();

    // `Object.entries(CHAIN.GOVERNABLE)` na ordem do config; limites vêm da
    // FONTE ÚNICA `governable_bounds` da lib.
    let governable: Vec<Json> = GOVERNAVEIS
        .iter()
        .map(|(nome, bigint)| {
            let (min, max) = governable_bounds(nome).unwrap_or((0, 0));
            let valor = param_efetivo_decimal(st, nome).unwrap_or_default();
            let limite = |x: i128| -> Json {
                if *bigint {
                    Json::String(x.to_string())
                } else {
                    Json::from(x as i64)
                }
            };
            json!({
                "param": nome,
                "kind": if *bigint { "bigint" } else { "int" },
                "value": gov_scalar_json(nome, &valor),
                "min": limite(min),
                "max": limite(max),
                "overridden": st.params.contains_key(*nome),
            })
        })
        .collect();

    let n = match eav7::blockchain::validators(st) {
        Ok(v) => v.len(),
        Err(e) => return bad_request(e),
    };
    reply(200, json!({
        "params": params,
        "governable": governable,
        "proposals": proposals,
        "validators": n,
        // `Math.floor((n * 2) / 3) + 1` (api.js:1232).
        "quorum": (n * 2) / 3 + 1,
        "governanceActive": bc.height() >= c::GOVERNANCE_HEIGHT as i64,
    }))
}

/// GET /treasury — `api.js:1244-1246`. Saldo (BigInt → string) + o percentual
/// governável efetivo (int → número).
pub fn treasury(node: &Node) -> ApiReply {
    let st = &node.blockchain.state;
    let pct = match param_u64(st, "TREASURY_PCT", c::TREASURY_PCT) {
        Ok(v) => v,
        Err(e) => return bad_request(e),
    };
    reply(200, json!({
        "balance": st.treasury.to_string(),
        "treasuryPct": pct,
    }))
}

/// GET /ai/tasks — `api.js:1245-1250`. Filtro por status em caixa alta.
pub fn ai_tasks(node: &Node, status: Option<&str>) -> ApiReply {
    let filtro = status.map(str::to_uppercase);
    let lista: Vec<Json> = node
        .blockchain
        .state
        .ai_tasks
        .values()
        .filter(|t| filtro.as_deref().is_none_or(|f| t.state == f))
        .map(task_view)
        .collect();
    reply(200, Json::Array(lista))
}

/// GET /ai/tasks/{id} — `api.js:1253-1257`.
pub fn ai_task(node: &Node, id: &str) -> ApiReply {
    match node.blockchain.state.ai_tasks.get(id) {
        Some(t) => reply(200, task_view(t)),
        None => reply(404, json!({ "error": "tarefa de IA não encontrada" })),
    }
}

/// GET /ai/oracles — `api.js:1260-1262`.
pub fn ai_oracles(node: &Node) -> ApiReply {
    let lista: Vec<Json> = node.blockchain.state.oracles.values().map(oracle_view).collect();
    reply(200, Json::Array(lista))
}

/// GET /bridge/transfers — `api.js:1266-1273`. Filtros opcionais por direção
/// (IN/OUT) e status, ambos em caixa alta.
pub fn bridge_transfers(node: &Node, direction: Option<&str>, status: Option<&str>) -> ApiReply {
    let f_dir = direction.map(str::to_uppercase);
    let f_st = status.map(str::to_uppercase);
    let lista: Vec<Json> = node
        .blockchain
        .state
        .bridge
        .transfers
        .values()
        .filter(|t| f_dir.as_deref().is_none_or(|f| t.direction() == f))
        .filter(|t| f_st.as_deref().is_none_or(|f| t.status() == f))
        .map(transfer_view)
        .collect();
    reply(200, Json::Array(lista))
}

/// GET /bridge/transfers/{id} — `api.js:1276-1280`.
pub fn bridge_transfer(node: &Node, id: &str) -> ApiReply {
    match node.blockchain.state.bridge.transfers.get(id) {
        Some(t) => reply(200, transfer_view(t)),
        None => reply(404, json!({ "error": "transferência de ponte não encontrada" })),
    }
}

/// GET /security/alerts — `api.js:1284-1286`: os 100 mais recentes, do mais novo
/// para o mais velho (`slice(-100).reverse()`).
pub fn security_alerts_get(node: &Node) -> ApiReply {
    let lista: Vec<Json> = node.security_alerts.iter().rev().take(100).map(alert_view).collect();
    reply(200, Json::Array(lista))
}

/// POST /security/alerts — `api.js:1291-1295`. ADMIN: sem token, 403 (evita
/// flood que evicta alertas reais). Defaults do JS (`node.js:230`):
/// `source='api'`, `severity='info'`, `context={}`. Responde o alerta gravado.
pub fn security_alerts_post(
    node: &mut Node,
    admin_token: Option<&str>,
    body: &Json,
    now_ms: i64,
) -> ApiReply {
    if !node.check_admin(admin_token) {
        return reply(403, json!({ "error": "requer token de admin (x-admin-token)" }));
    }
    let source = body.get("source").and_then(Json::as_str).unwrap_or("api");
    let severity = body.get("severity").and_then(Json::as_str).unwrap_or("info");
    // `typeof kind !== 'string' || typeof message !== 'string'` → o mesmo erro.
    let (Some(kind), Some(message)) = (
        body.get("kind").and_then(Json::as_str),
        body.get("message").and_then(Json::as_str),
    ) else {
        return bad_request("alerta inválido: kind e message são obrigatórios");
    };
    let context = body.get("context").cloned().unwrap_or_else(|| json!({}));
    if let Err(e) = node.add_security_alert(source, kind, severity, message, context, now_ms) {
        return bad_request(e);
    }
    // O JS devolve o objeto do alerta; aqui é o último gravado (mesmo conteúdo).
    match node.security_alerts.last() {
        Some(a) => reply(200, alert_view(a)),
        None => reply(500, json!({ "error": "alerta não registrado" })),
    }
}

/// GET /peers — `api.js:1299-1301`: a lista de URLs (`p2p.list()`).
pub fn peers_get(node: &Node) -> ApiReply {
    reply(200, json!(node.peers))
}

/// `normalize` de `p2p.js:233`: exige `http(s)://`, host não-vazio e sem
/// espaços/controle; remove barras finais. Devolve `None` para inválido (que o
/// `addPeer` traduz em `added:false`).
fn normalize_peer(url: Option<&str>) -> Option<String> {
    let url = url?;
    let resto = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://"))?;
    if resto.is_empty() || url.chars().any(|ch| ch.is_whitespace() || ch.is_control()) {
        return None;
    }
    Some(url.trim_end_matches('/').to_string())
}

/// POST /peers — `api.js:1304-1310`. ADMIN (achado H-3: endpoint aberto era
/// vetor de SSRF): sem token, 403. Com token o peer entra como CONFIÁVEL
/// (`trusted:true`), que no JS bypassa o filtro de IP privado/DNS — então aqui é
/// só a parte de lista: normaliza, deduplica, recusa a PRÓPRIA URL e respeita
/// MAX_PEERS (`p2p.js:24-41`).
///
/// A recusa da própria URL faltava, com a justificativa de que o `Node` não
/// guardava o próprio endereço. Ele guarda (`Node::self_url`) — e sem a checagem
/// um admin adicionava o nó a si mesmo, que passava a fazer gossip e sync contra
/// o próprio estado.
pub fn peers_post(node: &mut Node, admin_token: Option<&str>, body: &Json) -> ApiReply {
    if !node.check_admin(admin_token) {
        return reply(403, json!({ "error": "requer token de admin (x-admin-token)" }));
    }
    let added = match normalize_peer(body.get("url").and_then(Json::as_str)) {
        None => false,
        Some(peer) => {
            if node.self_url.as_deref() == Some(peer.as_str())
                || node.peers.contains(&peer)
                || node.peers.len() as u64 >= c::MAX_PEERS
            {
                false
            } else {
                node.peers.push(peer);
                true
            }
        }
    };
    reply(200, json!({ "added": added }))
}

// ============================================================================
// Casca axum — extração de parâmetros, relógio, env e locking
// ============================================================================

/// Relógio da casca: ms desde a época (o `Date.now()` do JS). Os handlers puros
/// recebem o valor pronto.
fn agora_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Header `x-admin-token`, se presente e ASCII legível.
fn admin_header(headers: &HeaderMap) -> Option<&str> {
    headers.get("x-admin-token").and_then(|v| v.to_str().ok())
}

/// Corpo POST → JSON. Reproduz `readBody` (`api.js:235`): corpo vazio é `{}`;
/// JSON inválido cai no wrapper de erro do JS, que responde 400 com a mensagem
/// genérica de erro inesperado (`api.js:212-218`).
fn parse_body(body: &str) -> Result<Json, ApiReply> {
    if body.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(body)
        .map_err(|_| reply(400, json!({ "error": "erro interno ao processar a requisição" })))
}

/// Lock envenenado = bug noutro handler; responde 500 sem derrubar o servidor.
fn envenenado() -> Response {
    into_response(reply(500, json!({ "error": "estado envenenado" })))
}

type Q = Query<std::collections::HashMap<String, String>>;

async fn gateway_route(State(state): State<AppState>) -> Response {
    // Env é I/O da casca — o JS também o lê por request (`api.js:462`). O `lag`
    // é o mesmo default/override que a task de failover usa (gateway.js:14).
    let failover = std::env::var("EAV7_GATEWAY_FAILOVER").as_deref() == Ok("1");
    let lag = crate::gateway::GatewayConfig::from_env().lag;
    let Ok(node) = state.read() else { return envenenado() };
    into_response(gateway(&node, failover, Some(lag)))
}

async fn guard_get_route(State(state): State<AppState>) -> Response {
    let now = agora_ms().max(0) as u64;
    let Ok(node) = state.read() else { return envenenado() };
    into_response(guard_get(&node, now))
}

async fn guard_clear_route(State(state): State<AppState>, headers: HeaderMap, body: String) -> Response {
    let body = match parse_body(&body) {
        Ok(b) => b,
        Err(r) => return into_response(r),
    };
    // Escrita: o JS muta o Map da guarda (`guard.clear`).
    let Ok(mut node) = state.write() else { return envenenado() };
    into_response(guard_clear(&mut node, admin_header(&headers), &body))
}

async fn validators_performance_route(State(state): State<AppState>, Query(q): Q) -> Response {
    // `Math.max(50, Math.min(5000, intParam(window, 500)))` (api.js:1041).
    let window = int_param(q.get("window"), 500).clamp(50, 5000);
    let Ok(node) = state.read() else { return envenenado() };
    into_response(validators_performance(&node, window))
}

async fn validators_route(State(state): State<AppState>) -> Response {
    let now = agora_ms();
    let Ok(node) = state.read() else { return envenenado() };
    into_response(validators_index(&node, now))
}

async fn governance_proposals_route(State(state): State<AppState>, Query(q): Q) -> Response {
    let Ok(node) = state.read() else { return envenenado() };
    into_response(governance_proposals(&node, q.get("status").map(String::as_str)))
}

async fn governance_advisories_route(State(state): State<AppState>) -> Response {
    let now = agora_ms();
    let Ok(node) = state.read() else { return envenenado() };
    into_response(governance_advisories(&node, now))
}

async fn governance_route(State(state): State<AppState>) -> Response {
    let Ok(node) = state.read() else { return envenenado() };
    into_response(governance_index(&node))
}

async fn treasury_route(State(state): State<AppState>) -> Response {
    let Ok(node) = state.read() else { return envenenado() };
    into_response(treasury(&node))
}

async fn ai_tasks_route(State(state): State<AppState>, Query(q): Q) -> Response {
    let Ok(node) = state.read() else { return envenenado() };
    into_response(ai_tasks(&node, q.get("status").map(String::as_str)))
}

async fn ai_task_route(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let Ok(node) = state.read() else { return envenenado() };
    into_response(ai_task(&node, &id))
}

async fn ai_oracles_route(State(state): State<AppState>) -> Response {
    let Ok(node) = state.read() else { return envenenado() };
    into_response(ai_oracles(&node))
}

async fn bridge_transfers_route(State(state): State<AppState>, Query(q): Q) -> Response {
    let Ok(node) = state.read() else { return envenenado() };
    into_response(bridge_transfers(
        &node,
        q.get("direction").map(String::as_str),
        q.get("status").map(String::as_str),
    ))
}

async fn bridge_transfer_route(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let Ok(node) = state.read() else { return envenenado() };
    into_response(bridge_transfer(&node, &id))
}

async fn security_alerts_get_route(State(state): State<AppState>) -> Response {
    let Ok(node) = state.read() else { return envenenado() };
    into_response(security_alerts_get(&node))
}

async fn security_alerts_post_route(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Response {
    let now = agora_ms();
    let body = match parse_body(&body) {
        Ok(b) => b,
        Err(r) => return into_response(r),
    };
    let Ok(mut node) = state.write() else { return envenenado() };
    into_response(security_alerts_post(&mut node, admin_header(&headers), &body, now))
}

async fn peers_get_route(State(state): State<AppState>) -> Response {
    let Ok(node) = state.read() else { return envenenado() };
    into_response(peers_get(&node))
}

async fn peers_post_route(State(state): State<AppState>, headers: HeaderMap, body: String) -> Response {
    let body = match parse_body(&body) {
        Ok(b) => b,
        Err(r) => return into_response(r),
    };
    let Ok(mut node) = state.write() else { return envenenado() };
    into_response(peers_post(&mut node, admin_header(&headers), &body))
}

/// Rotas deste grupo (axum 0.8: parâmetro de caminho `{id}`).
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/gateway", get(gateway_route))
        .route("/guard", get(guard_get_route))
        .route("/guard/clear", post(guard_clear_route))
        .route("/validators/performance", get(validators_performance_route))
        .route("/validators", get(validators_route))
        .route("/governance/proposals", get(governance_proposals_route))
        .route("/governance/advisories", get(governance_advisories_route))
        .route("/governance", get(governance_route))
        .route("/treasury", get(treasury_route))
        .route("/ai/tasks", get(ai_tasks_route))
        .route("/ai/tasks/{id}", get(ai_task_route))
        .route("/ai/oracles", get(ai_oracles_route))
        .route("/bridge/transfers", get(bridge_transfers_route))
        .route("/bridge/transfers/{id}", get(bridge_transfer_route))
        .route("/security/alerts", get(security_alerts_get_route).post(security_alerts_post_route))
        .route("/peers", get(peers_get_route).post(peers_post_route))
}

// ============================================================================
// Testes — handlers puros, sem socket
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::guard::{AbuseGuard, GuardConfig};
    use eav7::mempool::Mempool;
    use eav7::state::Account;

    fn node_teste() -> Node {
        Node {
            blockchain: Blockchain::new(),
            mempool: Mempool::new(),
            validator_address: None,
            peers: Vec::new(),
            security_alerts: Vec::new(),
            guard: std::sync::Arc::new(std::sync::Mutex::new(AbuseGuard::new(GuardConfig::default()))),
            gateway_target: None,
            gateway_snapshot: Default::default(),
            eavm_enabled: false,
            eavm_port: 0,
            public_rpc_url: None,
        self_url: None,
            admin_token: None,
            verified_contracts: Default::default(),
            eavm_index: std::sync::Arc::new(std::sync::Mutex::new(crate::node::EavmIndex::novo())),
            relay_bloco: None,
            pedir_sync: None,
            gossip_tx: None,
        }
    }

    fn conta_com_stake(staked: u128) -> Account {
        Account { staked, ..Account::default() }
    }

    // ---- guarda -----------------------------------------------------------

    #[test]
    fn guard_clear_sem_admin_e_403() {
        let mut n = node_teste();
        // Sem token configurado, NEGA sempre (default-deny) — como o JS.
        let r = guard_clear(&mut n, Some("qualquer"), &json!({ "ip": "1.2.3.4" }));
        assert_eq!(r.0.as_u16(), 403);
        assert_eq!(r.1["error"], "não autorizado");
        // Mesmo com token configurado, header errado nega.
        n.admin_token = Some("segredo".into());
        let r = guard_clear(&mut n, Some("errado"), &json!({ "ip": "1.2.3.4" }));
        assert_eq!(r.0.as_u16(), 403);
    }

    #[test]
    fn guard_clear_com_admin_valida_ip_e_limpa() {
        let mut n = node_teste();
        n.admin_token = Some("segredo".into());
        // Sem campo ip → 400 com a mensagem do JS.
        let r = guard_clear(&mut n, Some("segredo"), &json!({}));
        assert_eq!(r.0.as_u16(), 400);
        assert_eq!(r.1["error"], "campo ip obrigatório");
        // IP nunca visto → cleared:false (Map.delete devolve false no JS).
        let r = guard_clear(&mut n, Some("segredo"), &json!({ "ip": "9.9.9.9" }));
        assert_eq!(r.0.as_u16(), 200);
        assert_eq!(r.1, json!({ "cleared": false, "ip": "9.9.9.9" }));
        // Bloqueia de verdade e limpa: cleared:true.
        for _ in 0..40 {
            n.guard.lock().expect("lock").strike("9.9.9.9", 1, 1_000);
        }
        assert!(n.guard.lock().expect("lock").blocked("9.9.9.9", 1_000));
        let r = guard_clear(&mut n, Some("segredo"), &json!({ "ip": "9.9.9.9" }));
        assert_eq!(r.1["cleared"], json!(true));
        assert!(!n.guard.lock().expect("lock").blocked("9.9.9.9", 1_000));
    }

    #[test]
    fn guard_snapshot_tem_as_chaves_do_js() {
        let n = node_teste();
        let (code, body) = guard_get(&n, 123);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["enabled"], json!(true));
        assert_eq!(body["activeBlocks"], json!(0));
        assert_eq!(body["blocked"], json!([]));
        assert_eq!(body["at"], json!(123));
        assert!(body.get("windowMs").is_some() && body.get("blockMs").is_some());
    }

    // ---- governança -------------------------------------------------------

    #[test]
    fn governance_vazia() {
        let n = node_teste();
        let (code, body) = governance_index(&n);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["proposals"], json!([]));
        assert_eq!(body["params"], json!({}));
        assert_eq!(body["validators"], json!(0));
        // `floor(0*2/3)+1` = 1 — o quórum mínimo do JS com zero validadores.
        assert_eq!(body["quorum"], json!(1));
        // Cadeia vazia (altura -1) está muito abaixo de GOVERNANCE_HEIGHT.
        assert_eq!(body["governanceActive"], json!(false));
        // A lista completa dos 7 governáveis, com tipo por espécie: int → número,
        // bigint → string (fiel ao toJson do JS).
        let gov = body["governable"].as_array().unwrap();
        assert_eq!(gov.len(), 7);
        let max_v = gov.iter().find(|g| g["param"] == "MAX_VALIDATORS").unwrap();
        assert_eq!(max_v["kind"], json!("int"));
        assert_eq!(max_v["value"], json!(c::MAX_VALIDATORS));
        assert_eq!(max_v["min"], json!(1));
        assert_eq!(max_v["max"], json!(101));
        assert_eq!(max_v["overridden"], json!(false));
        let min_stake = gov.iter().find(|g| g["param"] == "MIN_VALIDATOR_STAKE").unwrap();
        assert_eq!(min_stake["kind"], json!("bigint"));
        assert_eq!(min_stake["value"], json!(c::MIN_VALIDATOR_STAKE.to_string()));
        assert_eq!(min_stake["min"], json!("1"));
    }

    #[test]
    fn governance_proposals_vazia_e_advisories_saudavel() {
        let n = node_teste();
        let (code, body) = governance_proposals(&n, None);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body, json!([]));
        // Sem validadores elegíveis mas com ativos < FINALITY_MIN, a Regra 2
        // dispara — o formato do advisory é o contrato aqui.
        let (code, body) = governance_advisories(&n, 777);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["at"], json!(777));
        assert_eq!(body["count"], body["advisories"].as_array().unwrap().len());
        for a in body["advisories"].as_array().unwrap() {
            assert_eq!(a["kind"], json!("GOVERNANCE_PARAM_ADVISORY"));
            assert_eq!(a["autonomous"], json!(false));
            assert_eq!(a["draftTx"]["type"], json!("GOV_PROPOSE"));
        }
    }

    #[test]
    fn advisories_regra2_min_stake_como_string() {
        // 0 validadores ativos < FINALITY_MIN_VALIDATORS → Regra 2 sugere reduzir
        // MIN_VALIDATOR_STAKE; por ser bigint, current/suggested saem como STRING
        // (no JS `typeof bigint` → toString), e o value do rascunho idem.
        let n = node_teste();
        let (_, body) = governance_advisories(&n, 0);
        let a = body["advisories"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["param"] == "MIN_VALIDATOR_STAKE")
            .expect("regra 2 deveria disparar com 0 validadores");
        assert_eq!(a["currentValue"], json!(c::MIN_VALIDATOR_STAKE.to_string()));
        assert_eq!(a["suggestedValue"], json!((c::MIN_VALIDATOR_STAKE / 2).to_string()));
        assert_eq!(a["severity"], json!("warning"));
        assert_eq!(a["draftTx"]["data"]["value"], a["suggestedValue"]);
    }

    // ---- tesouraria -------------------------------------------------------

    #[test]
    fn treasury_saldo_string_e_pct_numero() {
        let mut n = node_teste();
        n.blockchain.state.treasury = 123_456_789_012_345_678_901_234_567_890u128;
        let (code, body) = treasury(&n);
        assert_eq!(code.as_u16(), 200);
        // Montante ACIMA de 2^53: só sobrevive como string decimal.
        assert_eq!(body["balance"], json!("123456789012345678901234567890"));
        assert_eq!(body["treasuryPct"], json!(c::TREASURY_PCT));
    }

    // ---- validadores ------------------------------------------------------

    #[test]
    fn validators_com_state_montado_na_mao() {
        let mut n = node_teste();
        let st = &mut n.blockchain.state;
        // Dois elegíveis (>= MIN_VALIDATOR_STAKE) e um abaixo do mínimo.
        st.accounts.insert("E7AAA".into(), conta_com_stake(2 * c::MIN_VALIDATOR_STAKE));
        st.accounts.insert("E7BBB".into(), conta_com_stake(c::MIN_VALIDATOR_STAKE));
        st.accounts.insert("E7CCC".into(), conta_com_stake(c::MIN_VALIDATOR_STAKE - 1));
        let (code, body) = validators_index(&n, 0);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["maxValidators"], json!(c::MAX_VALIDATORS));
        assert_eq!(body["minStake"], json!(c::MIN_VALIDATOR_STAKE.to_string()));
        // Próximo bloco = altura 0 (cadeia vazia) → recompensa-base, como string.
        assert_eq!(body["blockReward"], json!(c::BLOCK_REWARD.to_string()));
        let atuais = body["current"].as_array().unwrap();
        assert_eq!(atuais.len(), 2);
        // Ordenados por peso decrescente; montantes como string decimal.
        assert_eq!(atuais[0]["address"], json!("E7AAA"));
        assert_eq!(atuais[0]["staked"], json!((2 * c::MIN_VALIDATOR_STAKE).to_string()));
        assert_eq!(atuais[0]["votes"], json!("0"));
        assert_eq!(atuais[1]["address"], json!("E7BBB"));
        // Slot corrente tem produtor esperado (rodízio existe).
        assert!(body["slotProducer"].is_string());
        // Sem blocos: janela vazia, todos saudáveis com score 100.
        assert_eq!(body["performanceWindow"]["blocks"], json!(0));
        assert_eq!(body["performanceSummary"]["count"], json!(2));
        assert_eq!(body["performance"][0]["score"], json!(100));
        assert_eq!(body["performance"][0]["status"], json!("healthy"));
    }

    #[test]
    fn validators_performance_janela_vazia() {
        let mut n = node_teste();
        n.blockchain.state.accounts.insert("E7AAA".into(), conta_com_stake(c::MIN_VALIDATOR_STAKE));
        let (code, body) = validators_performance(&n, 500);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["window"], json!({ "blocks": 0, "fromHeight": null, "toHeight": null }));
        assert_eq!(body["validators"][0]["address"], json!("E7AAA"));
        assert_eq!(body["summary"]["healthy"], json!(1));
        assert_eq!(body["summary"]["worst"]["score"], json!(100));
    }

    // ---- IA / ponte -------------------------------------------------------

    #[test]
    fn ai_e_bridge_vazios_e_404() {
        let n = node_teste();
        assert_eq!(ai_tasks(&n, None).1, json!([]));
        assert_eq!(ai_oracles(&n).1, json!([]));
        assert_eq!(bridge_transfers(&n, None, None).1, json!([]));
        let r = ai_task(&n, "inexistente");
        assert_eq!(r.0.as_u16(), 404);
        assert_eq!(r.1["error"], "tarefa de IA não encontrada");
        let r = bridge_transfer(&n, "inexistente");
        assert_eq!(r.0.as_u16(), 404);
        assert_eq!(r.1["error"], "transferência de ponte não encontrada");
    }

    // ---- alertas de segurança ---------------------------------------------

    #[test]
    fn security_alerts_post_exige_admin_e_devolve_o_alerta() {
        let mut n = node_teste();
        let corpo = json!({ "kind": "teste", "message": "olá", "severity": "warning" });
        // Sem token → 403 com a mensagem do JS.
        let r = security_alerts_post(&mut n, None, &corpo, 1);
        assert_eq!(r.0.as_u16(), 403);
        assert_eq!(r.1["error"], "requer token de admin (x-admin-token)");
        // Com token: grava e responde o alerta (defaults source='api').
        n.admin_token = Some("s".into());
        let r = security_alerts_post(&mut n, Some("s"), &corpo, 42);
        assert_eq!(r.0.as_u16(), 200);
        assert_eq!(r.1["kind"], json!("teste"));
        assert_eq!(r.1["severity"], json!("warning"));
        assert_eq!(r.1["source"], json!("api"));
        assert_eq!(r.1["at"], json!(42));
        // Sem kind/message → 400 com a mensagem do JS.
        let r = security_alerts_post(&mut n, Some("s"), &json!({}), 1);
        assert_eq!(r.0.as_u16(), 400);
        assert_eq!(r.1["error"], "alerta inválido: kind e message são obrigatórios");
        // GET: mais novo primeiro.
        let (_, lista) = security_alerts_get(&n);
        assert_eq!(lista.as_array().unwrap().len(), 1);
    }

    // ---- peers ------------------------------------------------------------

    #[test]
    fn peers_post_admin_normaliza_e_deduplica() {
        let mut n = node_teste();
        // Sem admin → 403 (achado H-3: endpoint aberto era vetor de SSRF).
        let r = peers_post(&mut n, None, &json!({ "url": "http://1.2.3.4:8077" }));
        assert_eq!(r.0.as_u16(), 403);
        n.admin_token = Some("s".into());
        // Adiciona com barra final removida (normalize do p2p.js).
        let r = peers_post(&mut n, Some("s"), &json!({ "url": "http://1.2.3.4:8077/" }));
        assert_eq!(r.1, json!({ "added": true }));
        assert_eq!(n.peers, vec!["http://1.2.3.4:8077".to_string()]);
        // Duplicado → false.
        let r = peers_post(&mut n, Some("s"), &json!({ "url": "http://1.2.3.4:8077" }));
        assert_eq!(r.1, json!({ "added": false }));
        // URL sem esquema http(s) → false (normalize devolve null no JS).
        let r = peers_post(&mut n, Some("s"), &json!({ "url": "ftp://x" }));
        assert_eq!(r.1, json!({ "added": false }));
        let r = peers_post(&mut n, Some("s"), &json!({}));
        assert_eq!(r.1, json!({ "added": false }));
        // GET devolve a lista crua de URLs.
        assert_eq!(peers_get(&n).1, json!(["http://1.2.3.4:8077"]));
    }

    // ---- gateway ----------------------------------------------------------

    #[test]
    fn gateway_snapshot_local_e_com_alvo() {
        let mut n = node_teste();
        let (code, body) = gateway(&n, false, None);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["failover"], json!(false));
        assert_eq!(body["servingLocal"], json!(true));
        assert_eq!(body["target"], Json::Null);
        assert_eq!(body["self"], json!(-1)); // altura da cadeia vazia
        assert_eq!(body["peers"], json!([]));
        assert_eq!(body["lag"], Json::Null);
        assert_eq!(body["at"], Json::Null);
        // Com failover apontando para um peer.
        n.gateway_target = Some("http://peer:8077".into());
        let (_, body) = gateway(&n, true, Some(12i64));
        assert_eq!(body["failover"], json!(true));
        assert_eq!(body["servingLocal"], json!(false));
        assert_eq!(body["target"], json!("http://peer:8077"));
    }
}
