//! Fallback HTTP após a API — G10 aposentou `public/` e `web/dist`.
//!
//! O frontend único é o Next (`proxy_upstream`). Este módulo só:
//! * devolve 502 em HTML se o proxy não atendeu (Next fora);
//! * devolve 404 JSON para o resto (cliente de API em rota desconhecida).

use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Router;
use serde_json::json;

use super::{into_response, reply, AppState};

/// `Accept` contém `text/html` — espelha o antigo `wantsHtml` do JS.
pub fn wants_html(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .map(|a| a.contains("text/html"))
        .unwrap_or(false)
}

fn web_indisponivel() -> Response {
    (
        StatusCode::BAD_GATEWAY,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "EAV7 Web temporariamente indisponível",
    )
        .into_response()
}

/// HTML na raiz quando o proxy Next não atendeu.
pub async fn spa_raiz() -> Response {
    web_indisponivel()
}

fn rota_nao_encontrada(method: &Method, path: &str) -> Response {
    into_response(reply(
        404,
        json!({ "error": format!("rota não encontrada: {method} {path}") }),
    ))
}

async fn api_fallback(method: Method, uri: Uri, headers: HeaderMap) -> Response {
    if method == Method::GET && wants_html(&headers) {
        return web_indisponivel();
    }
    rota_nao_encontrada(&method, uri.path())
}

/// Só o fallback global — sem rotas de `public/` / `web/dist` (G10).
pub fn router() -> Router<AppState> {
    Router::new().fallback(api_fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wants_html_detecta_accept() {
        let mut h = HeaderMap::new();
        assert!(!wants_html(&h));
        h.insert(header::ACCEPT, header::HeaderValue::from_static("text/html,application/xhtml+xml"));
        assert!(wants_html(&h));
    }

    #[tokio::test]
    async fn fallback_404_json_sem_html() {
        let resp = api_fallback(Method::GET, "/rota/desconhecida".parse().unwrap(), HeaderMap::new()).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn fallback_502_quando_html_sem_next() {
        let mut h = HeaderMap::new();
        h.insert(header::ACCEPT, header::HeaderValue::from_static("text/html"));
        let resp = api_fallback(Method::GET, "/".parse().unwrap(), h).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
    }
}
