//! API HTTP pública do nó — porte de `src/node/api.js` (1.316 linhas).
//!
//! ARQUITETURA DO PORTE: cada handler é uma FUNÇÃO PURA `(&Node, params) ->
//! (StatusCode, serde_json::Value)` — testável sem abrir socket. O axum entra só
//! na casca: extrai parâmetros, pega o lock, chama o handler, devolve JSON. O
//! estado compartilhado é `Arc<RwLock<Node>>`; os handlers são CPU-curtos e
//! síncronos, então o lock nunca atravessa um `await`.
//!
//! Os grupos de rota vivem em arquivos próprios (um por família, espelhando a
//! organização do JS) e se registram aqui via `Router::merge`.

pub mod admissao;
pub mod address;
pub mod chain;
pub mod network;
pub mod proxy_leitura;
pub mod proxy_upstream;
pub mod static_files;
pub mod tokens;

use std::sync::{Arc, RwLock};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde_json as json_value;
use serde_json::json;

use crate::node::Node;

/// Estado compartilhado da API. `std::sync::RwLock` (e não o do tokio) DE
/// PROPÓSITO: os handlers são síncronos e curtos; um lock async convidaria a
/// segurar o guard através de `await`, que é exatamente o bug que queremos
/// tornar inexprimível.
pub type AppState = Arc<RwLock<Node>>;

/// Resposta padrão dos handlers puros.
pub type ApiReply = (StatusCode, serde_json::Value);

pub fn reply(code: u16, body: serde_json::Value) -> ApiReply {
    (StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), body)
}

pub fn not_found(what: &str) -> ApiReply {
    reply(404, json!({ "error": format!("{what} não encontrado") }))
}

pub fn bad_request(msg: impl Into<String>) -> ApiReply {
    reply(400, json!({ "error": msg.into() }))
}

/// Converte a resposta pura em resposta axum com os headers de CORS que o JS
/// põe em tudo (API pública de leitura).
pub fn into_response(r: ApiReply) -> Response {
    let mut resp = (r.0, Json(r.1)).into_response();
    let h = resp.headers_mut();
    h.insert("access-control-allow-origin", "*".parse().expect("header estático"));
    // `allow-methods` FALTAVA. Sem ele o preflight do navegador (`OPTIONS`)
    // falha, e nenhuma página consegue fazer `POST /tx` com
    // `content-type: application/json` — ou seja, a carteira web não submetia
    // transação alguma a um nó Rust. O JS emite os três headers (api.js:252-254).
    h.insert(
        "access-control-allow-methods",
        "GET, POST, OPTIONS".parse().expect("header estático"),
    );
    h.insert(
        "access-control-allow-headers",
        "content-type, x-admin-token".parse().expect("header estático"),
    );
    resp
}

/// `intParam` do JS: query param inteiro com default; inválido = default.
pub fn int_param(v: Option<&String>, dflt: usize) -> usize {
    v.and_then(|s| s.parse::<usize>().ok()).unwrap_or(dflt)
}

// ---------------------------------------------------------------- /status

/// Handler PURO do `GET /status` — o exemplar do padrão que os demais grupos
/// seguem. Espelha `api.js:411`.
pub fn status(node: &Node) -> ApiReply {
    use eav7::config as c;
    let bc = &node.blockchain;
    let st = &bc.state;
    let head = bc.head();
    let supply = c::GENESIS_SUPPLY + st.total_minted - st.total_burned;
    let reward = {
        let proxima = bc.height().saturating_add(1).max(0) as u64;
        bc.block_reward(proxima, st).map(|a| a.to_string()).unwrap_or_else(|_| "0".into())
    };
    reply(200, json!({
        "chain": c::NAME,
        "protocol": c::PROTOCOL,
        "symbol": c::SYMBOL,
        "blockTimeMs": c::BLOCK_TIME_MS,
        "height": bc.height(),
        "finalizedHeight": bc.finalized_height().unwrap_or(-1),
        "headHash": head.map(|b| b.hash.clone()),
        "headTime": head.map(|b| b.timestamp),
        // Valores monetários como TEXTO decimal: passam de 2^53 e o JSON de
        // apresentação não pode perder precisão (o JS usa toJson p/ BigInt).
        "supply": supply.to_string(),
        "genesisSupply": c::GENESIS_SUPPLY.to_string(),
        "minted": st.total_minted.to_string(),
        "burned": st.total_burned.to_string(),
        "treasury": st.treasury.to_string(),
        "circulating": supply.to_string(),
        "blockReward": reward,
        "energy": {
            "free": c::energy::FREE,
            "perStakedEav7": c::energy::PER_STAKED_EAV7,
            "regenBlocks": c::energy::REGEN_BLOCKS,
        },
        "mempool": node.mempool.len(),
        "validators": eav7::blockchain::validators(st).map(|v| v.len()).unwrap_or(0),
        "peers": node.peers.len(),
        "producer": node.validator_address,
        "ai": {
            "pendingTasks": st.ai_tasks.values().filter(|t| t.state == "PENDING").count(),
            "oracles": st.oracles.len(),
        },
        "bridge": {
            "transfers": st.bridge.transfers.len(),
            "lockedNative": st.bridge.locked_native.to_string(),
        },
        "security": { "alerts": node.security_alerts.len() },
        // Alturas dos forks DORMENTES (rollout coordenado) — todos os nós DEVEM
        // reportar o MESMO valor antes de a cadeia cruzá-las. docs/rollout-forks.md.
        "forkHeights": {
            "bridgeBreaker": c::BRIDGE_BREAKER_HEIGHT,
            "aiTee": c::AI_TEE_HEIGHT,
            "bridgeQuorum": c::BRIDGE_QUORUM_HEIGHT,
            "canonicalHash": c::CANONICAL_HASH_HEIGHT,
        },
        "eavm": if node.eavm_enabled {
            json!({
                "chainId": c::EAVM_CHAIN_ID,
                "rpcPort": node.eavm_port,
                "decimals": 18,
                "rpcUrl": node.public_rpc_url,
            })
        } else {
            serde_json::Value::Null
        },
    }))
}

async fn status_route(State(state): State<AppState>) -> Response {
    let node = match state.read() {
        Ok(n) => n,
        Err(_) => return into_response(reply(500, json!({ "error": "estado envenenado" }))),
    };
    into_response(status(&node))
}

/// Monta o roteador completo da API.
///
/// `static_files` é mesclado por ÚLTIMO: só o fallback 404/502 (G10 — Next é o
/// único frontend, via `proxy_upstream`).
/// Resposta ao PREFLIGHT do navegador (`OPTIONS`) — 204 com os headers de CORS.
///
/// O JS responde isto para QUALQUER rota (api.js:255-259). No axum, uma rota que
/// só declara `get`/`post` responde **405** ao `OPTIONS`, e o preflight falhando
/// significa que a página nem chega a mandar o `POST` — a carteira web ficava
/// sem conseguir submeter transação nenhuma.
async fn preflight() -> Response {
    let mut r = (StatusCode::NO_CONTENT, ()).into_response();
    let h = r.headers_mut();
    for (k, v) in [
        ("access-control-allow-origin", "*"),
        ("access-control-allow-headers", "content-type, x-admin-token"),
        ("access-control-allow-methods", "GET, POST, OPTIONS"),
        // Cacheia o preflight por 24h: sem isto o navegador repete o OPTIONS a
        // cada requisição, dobrando o tráfego da carteira.
        ("access-control-max-age", "86400"),
    ] {
        if let (Ok(nome), Ok(valor)) = (k.parse::<axum::http::HeaderName>(), v.parse()) {
            h.insert(nome, valor);
        }
    }
    r
}

/// O recibo de execução EAVM de uma transação, no formato do JS
/// (`api.js:965`/`api.js:1138`), ou `null`.
///
/// Ausência de recibo NÃO é erro: só transação EAVM tem execução, e para as
/// demais a ausência significa "aplicou-se com sucesso" — é assim que o
/// explorer lê. O que era mentira é o inverso: enquanto o índice não existia,
/// TODA transação saía com `receipt: null`, e uma chamada REVERTIDA ficava
/// indistinguível de uma transferência comum.
pub fn recibo_json(node: &Node, tx_id: Option<&str>) -> json_value::Value {
    let Some(r) = tx_id.and_then(|id| node.blockchain.receipts.get(id)) else {
        return json_value::Value::Null;
    };
    json!({
        "success": r.success,
        // TEXTO decimal, como `BigInt.toString()` no JS: acima de 2⁵³ um número
        // JSON perderia precisão no cliente.
        "gasUsed": r.gas_used.to_string(),
        "contract": r.contract.clone(),
        "blockHeight": r.block_height,
    })
}

/// Índice de endpoints na RAIZ, para clientes de API.
///
/// Um browser nunca chega aqui: `Accept: text/html` é desviado ao Next
/// (`proxy_upstream`). Sem Next, o fallback devolve 502. Quem chega é curl/SDK.
///
/// A lista é DECLARADA, não derivada do roteador: ela é contrato público (o SDK
/// e a documentação a citam), e derivá-la faria uma rota interna nova aparecer
/// sozinha na porta de entrada.
pub fn indice() -> ApiReply {
    reply(200, json!({
        "chain": eav7::config::NAME,
        "protocol": eav7::transaction::PROTOCOL,
        "version": eav7::block::PROTOCOL_VERSION,
        "symbol": eav7::config::SYMBOL,
        "decimals": eav7::config::DECIMALS,
        "tokenStandard": "EAV20",
        "miningPlatform": "/mining",
        "endpoints": [
            "GET /status", "GET /blocks", "GET /blocks/latest", "GET /blocks/:alturaOuHash",
            "GET /chain", "POST /blocks", "GET /tx/:id", "POST /tx", "GET /address/:endereco",
            "GET /mempool", "GET /validators", "GET /tokens", "GET /tokens/:id",
            "GET /tokens/:id/holders", "GET /tokens/:id/transfers",
            "GET /address/:endereco/txs", "GET /address/:endereco/analysis", "GET /proof/:endereco",
            "GET /name/:nome", "GET /logs", "GET /internal",
            "GET /nfts", "GET /nfts/:id", "GET /names",
            "GET /governance", "GET /governance/proposals", "GET /treasury",
            "GET /contract/:addr", "POST /contract/:addr/verify",
            "GET /ai/tasks", "GET /ai/tasks/:id", "GET /ai/oracles",
            "GET /bridge/transfers", "GET /bridge/transfers/:id",
            "GET /security/alerts", "POST /security/alerts",
            "GET /peers", "POST /peers",
        ],
    }))
}

/// Rota conhecida com método não suportado — ver `method_not_allowed_fallback`.
async fn rota_desconhecida(metodo: axum::http::Method, uri: axum::http::Uri) -> Response {
    into_response(reply(
        404,
        json!({ "error": format!("rota não encontrada: {metodo} {}", uri.path()) }),
    ))
}

/// `GET /` — índice para cliente de API; navegação do browser cai no Next.
async fn raiz_route(headers: axum::http::HeaderMap) -> Response {
    // HTML aqui = Next fora (proxy não atendeu) → 502, não JSON disfarçado.
    if static_files::wants_html(&headers) {
        return static_files::spa_raiz().await;
    }
    into_response(indice())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(raiz_route))
        .route("/status", get(status_route))
        .merge(chain::router())
        .merge(address::router())
        .merge(tokens::router())
        .merge(network::router())
        .merge(static_files::router())
        // MÉTODO ERRADO em rota conhecida (ex.: `POST /status`) vira 404 com a
        // mensagem da referência, e não o 405 de corpo vazio e sem CORS que o
        // roteador daria: no JS não existe roteamento por método — o caminho cai
        // no fim do `if`/`else` e sai como "rota não encontrada" (api.js:1318).
        // Um 405 opaco, sem CORS, chega ao navegador como erro de rede sem motivo.
        .method_not_allowed_fallback(rota_desconhecida)
        // O preflight responde em QUALQUER caminho — inclusive nos que não
        // existem, como no JS, que trata o `OPTIONS` antes de rotear.
        .layer(axum::middleware::from_fn(
            |req: axum::extract::Request, next: axum::middleware::Next| async move {
                if req.method() == axum::http::Method::OPTIONS {
                    return preflight().await;
                }
                next.run(req).await
            },
        ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A raiz responde o ÍNDICE a cliente de API. Antes caía no `fallback` dos
    /// estáticos e devolvia 404 — "a API não existe" na porta de entrada dela.
    #[test]
    fn a_raiz_devolve_o_indice_de_endpoints() {
        let (code, body) = indice();
        assert_eq!(code, 200);
        assert_eq!(body["chain"], json!(eav7::config::NAME));
        assert_eq!(body["protocol"], json!("eav20"));
        assert_eq!(body["symbol"], json!("EAV7"));
        assert_eq!(body["decimals"], json!(6));
        assert_eq!(body["tokenStandard"], json!("EAV20"));

        let endpoints = body["endpoints"].as_array().expect("lista de endpoints");
        for esperado in ["GET /status", "GET /logs", "GET /internal", "POST /tx", "GET /peers"] {
            assert!(
                endpoints.iter().any(|e| e == esperado),
                "o índice tem de anunciar {esperado}"
            );
        }
    }

    /// Todo endpoint anunciado tem forma `MÉTODO /caminho` — o índice é contrato
    /// público lido por SDK e documentação.
    #[test]
    fn o_indice_anuncia_metodo_e_caminho_em_toda_entrada() {
        let (_, body) = indice();
        for e in body["endpoints"].as_array().expect("lista") {
            let texto = e.as_str().expect("entrada de texto");
            let (metodo, caminho) = texto.split_once(' ').expect("MÉTODO seguido de caminho");
            assert!(
                matches!(metodo, "GET" | "POST" | "PUT" | "DELETE"),
                "método estranho em {texto}"
            );
            assert!(caminho.starts_with('/'), "caminho tem de ser absoluto em {texto}");
        }
    }
}
