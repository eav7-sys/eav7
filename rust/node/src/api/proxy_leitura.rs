//! PROXY DE LEITURA do gateway — serve `GET` do peer mais saudável quando este
//! nó está stale. Porte de `proxyToPeer` (`api.js:190-208`) e do gate em
//! `api.js:295-297`.
//!
//! É a metade que faltava do failover. `gateway.rs` DECIDIA (com histerese,
//! testada) e escrevia `gateway_target`, mas nada lia esse campo para servir:
//! `GET /gateway` reportava `servingLocal:false, target:"http://peer"` e todas as
//! leituras continuavam saindo do estado local obsoleto.
//!
//! Isso é pior que não ter failover. Sem ele, o operador vê o nó atrasado e age.
//! Com ele meio-implementado, o painel afirma que o failover atuou — e o
//! explorer continua servindo dados velhos com cara de recuperação.
//!
//! Regras, todas do JS:
//!   • só `GET` — escrita (`POST /tx`) segue LOCAL, porque o mempool faz gossip
//!     e mandar a transação para outro nó só acrescentaria um salto;
//!   • `/gateway` NUNCA é proxiado: é a rota que diz a saúde DESTE nó, e
//!     proxiá-la devolveria a saúde do outro — o operador ficaria cego;
//!   • `x-eav7-proxied` corta laço: um peer que também esteja em failover não
//!     devolve a requisição para cá;
//!   • falha do peer CAI PARA O LOCAL. Servir dado velho é melhor que erro.

use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::api::AppState;
use crate::p2p::{make_client, HttpClient, P2pConfig};

/// Teto do corpo repassado. O JS lê sem limite (`arrayBuffer()`); aqui o teto
/// impede que um peer comprometido — ou só grande demais — estoure a memória do
/// gateway ao responder um `/chain?limit=2000`.
const MAX_CORPO_BYTES: u64 = 16 * 1024 * 1024;

/// Tempo máximo esperando o peer (`AbortSignal.timeout(8000)`, api.js:193).
const TIMEOUT_MS: u64 = 8_000;

/// Estado do proxy: cliente HTTP reusado, config anti-SSRF e o estado do nó.
///
/// O `AppState` vem AQUI, e não das extensions do request: com
/// `from_fn_with_state` o estado chega como parâmetro do middleware, e as
/// extensions não o contêm — buscá-lo lá devolveria `None` sempre, e o proxy
/// nunca ativaria (falhando de forma silenciosa e indistinguível de "não há
/// alvo").
#[derive(Clone)]
pub struct ProxyLeitura {
    client: HttpClient,
    p2p: P2pConfig,
    estado: AppState,
}

impl ProxyLeitura {
    pub fn novo(estado: AppState) -> Self {
        ProxyLeitura {
            client: make_client(),
            // `allow_private_peers: true` — o MESMO que `gateway.rs` usa para
            // eleger o alvo, e pelo mesmo motivo: os peers já passaram pelo filtro
            // anti-SSRF na admissão (`add_peer`), e o alvo sai daquela lista, não
            // de entrada de usuário. O JS não re-filtra aqui (api.js:190-208).
            //
            // Isto já divergiu do gateway: com a flag do operador, uma testnet
            // local elegia um peer `127.0.0.1` e o proxy recusava servir dele —
            // todo GET registrava "proxy de leitura falhou" e caía no local. O
            // painel dizia failover ativo e o failover não acontecia.
            p2p: P2pConfig { self_url: None, allow_private_peers: true, sync_ms: 0 },
            estado,
        }
    }

    /// O alvo do failover, com o lock solto antes de qualquer `await`.
    fn alvo(&self) -> Option<String> {
        self.estado.read().ok().and_then(|n| n.gateway_target.clone())
    }
}

/// Middleware. Roda ANTES das rotas: se o failover estiver ativo e a requisição
/// for elegível, a resposta vem do peer e o handler local nem é chamado.
pub async fn proxiar(
    State(px): State<ProxyLeitura>,
    req: Request,
    next: Next,
) -> Response {
    let caminho = req.uri().path().to_string();
    let elegivel = req.method() == Method::GET
        && caminho != "/gateway"
        && !req.headers().contains_key("x-eav7-proxied");

    if !elegivel {
        return next.run(req).await;
    }
    // Lê o alvo e SOLTA o lock antes de qualquer I/O.
    let Some(alvo) = px.alvo() else { return next.run(req).await };

    let url = format!(
        "{alvo}{}",
        req.uri().path_and_query().map(|p| p.as_str()).unwrap_or(&caminho)
    );
    // O cabeçalho `x-eav7-proxied` vai NA REQUISIÇÃO: é ele que impede o laço
    // quando o peer também está em failover apontando para cá (api.js:194).
    match crate::p2p::fetch_resposta_capped_com(
        &px.client,
        &px.p2p,
        &url,
        MAX_CORPO_BYTES,
        TIMEOUT_MS,
        &[("x-eav7-proxied", "1"), ("accept", "application/json")],
    )
    .await
    {
        Ok(peer) => {
            // O STATUS do peer é repassado (`res.writeHead(up.status, …)`,
            // api.js:197). Fixá-lo em 200 transformava todo `404`/`400` do peer
            // num sucesso deste nó, e o cliente que ramifica por `res.ok` passava
            // a tratar "transação não encontrada" como transação encontrada —
            // justamente durante o failover, quando o operador acredita que a
            // recuperação está funcionando.
            let status =
                StatusCode::from_u16(peer.status).unwrap_or(StatusCode::BAD_GATEWAY);
            let mut r = (status, peer.corpo).into_response();
            let h = r.headers_mut();
            let tipo = peer
                .content_type
                .as_deref()
                .and_then(|t| HeaderValue::from_str(t).ok())
                .unwrap_or_else(|| HeaderValue::from_static("application/json; charset=utf-8"));
            h.insert("content-type", tipo);
            h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
            // Quem serviu, para o operador ver de onde veio a resposta.
            if let Ok(v) = HeaderValue::from_str(&alvo) {
                h.insert("x-eav7-served-by", v);
            }
            r
        }
        Err(e) => {
            // Peer fora do ar não pode virar erro para o usuário: cai no local.
            // Dado velho é melhor que 502 (api.js:204-206).
            eprintln!("[gateway] proxy de leitura falhou ({alvo}): {e} — servindo local");
            next.run(req).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// As regras de elegibilidade — o que NUNCA pode ser proxiado.
    ///
    /// Cada uma existe por um motivo distinto: escrita seguiria um salto a mais
    /// sem ganho (o mempool já faz gossip); `/gateway` proxiado devolveria a
    /// saúde do OUTRO nó, cegando o operador; e sem o header anti-laço dois nós
    /// em failover mútuo ficariam devolvendo a requisição um ao outro.
    #[test]
    fn elegibilidade_segue_as_regras_do_js() {
        let caso = |metodo: Method, caminho: &str, proxiado: bool| -> bool {
            metodo == Method::GET && caminho != "/gateway" && !proxiado
        };
        assert!(caso(Method::GET, "/status", false), "GET comum é proxiável");
        assert!(!caso(Method::POST, "/tx", false), "escrita segue local");
        assert!(!caso(Method::GET, "/gateway", false), "a saúde é sempre a DESTE nó");
        assert!(!caso(Method::GET, "/status", true), "requisição já proxiada não repassa");
    }
}
