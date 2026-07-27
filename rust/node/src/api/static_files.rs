//! Estáticos e SPA do explorer — porte da fatia de serviço de arquivos de
//! `src/node/api.js`.
//!
//! # O que este módulo serve
//!
//! Duas famílias, exatamente como o JS:
//!
//! * **`public/` (legado)** — páginas HTML autocontidas servidas do disco:
//!   `app.html`, `explorer.html`, `wallet.html`, o JS/CSS da carteira e os
//!   ícones (api.js:111-117, rotas em api.js:355-393). O `P()` do JS resolve
//!   `../../public/` a partir de `src/node/` → o `public/` na RAIZ do repo JS.
//! * **`web/dist/` (SPA React/Vite)** — `index.html` + `/assets/*` com hash no
//!   nome (api.js:120-131, rotas em api.js:301-316). O `DIST()` resolve
//!   `../../web/dist/`.
//!
//! # Onde os diretórios ficam NESTE porte (decisão + relato)
//!
//! O JS resolve os caminhos RELATIVOS AO ARQUIVO-FONTE (`import.meta.url`). Um
//! binário Rust não tem esse ancoradouro em produção (o executável é *rsync*-ado
//! para os validadores), então a origem é CONFIGURÁVEL por ambiente:
//!
//! * `EAV7_PUBLIC_DIR`   → default `"public"`   (relativo ao CWD do processo)
//! * `EAV7_WEB_DIST_DIR` → default `"web/dist"` (relativo ao CWD do processo)
//!
//! No layout do repositório os arquivos REAIS existem em
//! `/Users/jonathancardinalle/Blockchain/public/` e
//! `/Users/jonathancardinalle/Blockchain/web/dist/` (raiz do nó JS, NÃO dentro de
//! `rust/`). O operador aponta as env vars para lá (ou coloca as pastas no CWD).
//! Sem os diretórios, cada rota devolve **404 gracioso** (nunca pânico) — o JS
//! também 404-ava quando o arquivo faltava.
//!
//! # Precedência de rotas (regra do `mod.rs`)
//!
//! Este roteador é mesclado por ÚLTIMO no `api::router()`: as rotas de API têm
//! precedência e o estático é o *fallback*. O `fallback` do axum captura tudo o
//! que a API não casou — é onde o SPA (`dist/index.html`) responde à navegação
//! do browser (api.js:311-316).
//!
//! # Sem hot-reload por mtime (divergência relatada)
//!
//! O JS cacheia por `mtime` e relê só quando o arquivo muda (api.js:96-109). Aqui
//! LEMOS DO DISCO a cada requisição (`tokio::fs`, assíncrono) — mais simples e
//! sem estado compartilhado. O custo (uma leitura por hit de estático) é
//! desprezível para o volume de estáticos, e o efeito prático é o MESMO: um
//! *rsync* do frontend é servido sem reiniciar o nó.
//!
//! # Relação com os proxies de upstream
//!
//! `proxyToWeb` (api.js:159) e `proxyToBuy` (api.js:175) vivem em
//! [`super::proxy_upstream`], como camada ANTES do roteador: uma navegação do
//! browser vai ao Next e nunca chega aqui. Este módulo continua servindo o SPA
//! legado de `web/dist` — que é o que responde quando o Next está fora.

use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::extract::Path as AxPath;
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde_json::json;

use super::{into_response, reply, AppState};

// ---------------------------------------------------------------- config de dir

/// Diretório dos estáticos legado (`public/`). Env `EAV7_PUBLIC_DIR`, default
/// `"public"`. Reproduz o `P()` de api.js:99 — a origem aqui é o CWD, não o
/// arquivo-fonte (ver o doc do módulo).
fn public_dir() -> PathBuf {
    std::env::var_os("EAV7_PUBLIC_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("public"))
}

/// Diretório do build SPA (`web/dist/`). Env `EAV7_WEB_DIST_DIR`, default
/// `"web/dist"`. Reproduz o `DIST()` de api.js:120.
fn dist_dir() -> PathBuf {
    std::env::var_os("EAV7_WEB_DIST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("web/dist"))
}

// ------------------------------------------------------------ tipos de conteúdo

/// `MIME` de api.js:132 mais os tipos das rotas HTML/JS/CSS dedicadas. Extensão
/// SEM o ponto. Desconhecida → `application/octet-stream` (o default do JS).
fn content_type(ext: &str) -> &'static str {
    match ext {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "json" | "map" => "application/json",
        _ => "application/octet-stream",
    }
}

/// Extensão (minúscula, sem ponto) de um caminho relativo.
fn ext_of(rel: &str) -> &str {
    rel.rsplit_once('.').map(|(_, e)| e).unwrap_or("")
}

// ------------------------------------------------------------ junção segura

/// Junta `dir` + `rel` REJEITANDO travessia de diretório. O JS faz um
/// `replace(/\.\./g, '')` frouxo (api.js:303); aqui somos estritos: qualquer
/// componente `..`, raiz absoluta, prefixo de volume ou `\0` → `None` (404). Um
/// componente vazio (`//`) é ignorado. Função PURA — testável sem tocar o disco.
fn safe_join(dir: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = dir.to_path_buf();
    for comp in rel.split('/') {
        if comp.is_empty() || comp == "." {
            continue;
        }
        if comp == ".." || comp.contains('\0') || comp.contains('\\') {
            return None;
        }
        // Um componente que o SO leria como raiz/absoluto também é recusado.
        let p = Path::new(comp);
        if p.is_absolute() || p.components().count() != 1 {
            return None;
        }
        out.push(comp);
    }
    Some(out)
}

// ------------------------------------------------------------ leitura + resposta

/// 404 JSON gracioso — a mesma forma que os handlers de API usam (com CORS).
///
/// Usado quando o ARQUIVO pedido não existe. Para uma rota desconhecida quem
/// responde é [`rota_nao_encontrada`], com a mensagem da referência.
fn nao_encontrado() -> Response {
    into_response(reply(404, json!({ "error": "arquivo não encontrado" })))
}

/// 404 de ROTA — `api.js:1318`: `rota não encontrada: <MÉTODO> <caminho>`.
///
/// A mensagem carrega método e caminho de propósito: é o que permite a quem
/// depura distinguir "errei o caminho" de "errei o verbo". Este cliente
/// respondia sempre "arquivo não encontrado", que sugere problema de estático
/// mesmo quando o pedido era de API.
fn rota_nao_encontrada(metodo: &Method, caminho: &str) -> Response {
    into_response(reply(404, json!({ "error": format!("rota não encontrada: {metodo} {caminho}") })))
}

/// Núcleo assíncrono e TESTÁVEL: lê `dir/rel` e devolve a resposta pronta.
/// Arquivo ausente, travessia ou erro de I/O → 404 gracioso (nunca pânico).
/// `cache` é o `Cache-Control` (as rotas de asset com hash pedem `immutable`);
/// `None` = sem o header.
async fn read_static(dir: &Path, rel: &str, ctype: &str, cache: Option<&str>) -> Response {
    let Some(caminho) = safe_join(dir, rel) else {
        return nao_encontrado();
    };
    let bytes = match tokio::fs::read(&caminho).await {
        Ok(b) => b,
        Err(_) => return nao_encontrado(),
    };
    let mut builder = Response::builder().status(StatusCode::OK).header(header::CONTENT_TYPE, ctype);
    if let Some(cc) = cache {
        builder = builder.header(header::CACHE_CONTROL, cc);
    }
    match builder.body(Body::from(bytes)) {
        Ok(resp) => resp,
        // Só falharia com header inválido (aqui são constantes) — cinto de segurança.
        Err(_) => into_response(reply(500, json!({ "error": "erro ao montar resposta" }))),
    }
}

/// Serve um arquivo do `public/` legado com o `Cache-Control` que o JS aplica em
/// cada rota (api.js:375/380/386/391) — `None` para as páginas HTML (sem cache).
async fn serve_public(rel: &str, ctype: &str, cache: Option<&str>) -> Response {
    read_static(&public_dir(), rel, ctype, cache).await
}

// --------------------------------------------------------------- rotas públicas

// api.js:355 — GET /app → public/app.html
async fn app_route() -> Response {
    serve_public("app.html", content_type("html"), None).await
}

// api.js:362 — GET /explorer e /scan → public/explorer.html
async fn explorer_route() -> Response {
    serve_public("explorer.html", content_type("html"), None).await
}

// api.js:369 — GET /wallet → public/wallet.html
async fn wallet_route() -> Response {
    serve_public("wallet.html", content_type("html"), None).await
}

// api.js:374 — GET /js/eav7-wallet.js → public/eav7-wallet.js (cache 1h).
async fn wallet_js_route() -> Response {
    serve_public("eav7-wallet.js", content_type("js"), Some("public, max-age=3600")).await
}

// api.js:379 — GET /css/eav7.css → public/eav7-theme.css (o NOME do arquivo
// difere do caminho da rota; reproduzido fielmente). Cache 1h.
async fn wallet_css_route() -> Response {
    serve_public("eav7-theme.css", content_type("css"), Some("public, max-age=3600")).await
}

// api.js:385 — GET /icon.png → public/icon.png (binário, cache 1 dia).
async fn icon_png_route() -> Response {
    serve_public("icon.png", content_type("png"), Some("public, max-age=86400")).await
}

// api.js:390 — GET /icon.svg → public/icon.svg (cache 1 dia).
async fn icon_svg_route() -> Response {
    serve_public("icon.svg", content_type("svg"), Some("public, max-age=86400")).await
}

// api.js:301-309 — GET /assets/{*rel} → web/dist/assets/{rel}. Hash no nome →
// `Cache-Control: immutable` de 1 ano. `content_type` por extensão; travessia
// barrada por `safe_join`.
async fn assets_route(AxPath(rel): AxPath<String>) -> Response {
    let ctype = content_type(ext_of(&rel));
    let alvo = format!("assets/{rel}");
    read_static(&dist_dir(), &alvo, ctype, Some("public, max-age=31536000, immutable")).await
}

// ------------------------------------------------------------ fallback SPA

/// Rotas do frontend (React Router) — `isFrontendRoute` de api.js:135-138. Path
/// vazio (`/`) conta; senão o primeiro segmento tem de estar na lista.
fn is_frontend_route(path: &str) -> bool {
    let mut parts = path.split('/').filter(|s| !s.is_empty());
    match parts.next() {
        None => true, // raiz
        Some(primeiro) => matches!(
            primeiro,
            "explorer" | "blocks" | "block" | "tx" | "address" | "wallet" | "app" | "scan"
                | "mining"
        ),
    }
}

/// `wantsHtml` de api.js:134 — o `Accept` contém `text/html`.
pub fn wants_html(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .map(|a| a.contains("text/html"))
        .unwrap_or(false)
}

/// *Fallback* de tudo o que a API não casou. Reproduz a navegação do browser:
///
/// 1. GET + `Accept: text/html` + rota de frontend + `dist/index.html` existe →
///    serve o SPA (api.js:311-316).
/// 2. Sem o SPA, mas ainda GET+html+rota-de-frontend → serve o `explorer.html`
///    legado do `public/` (o caminho de raiz/`/explorer` do JS, api.js:323-325 /
///    362-365, quando o build Vite não está presente).
/// 3. Qualquer outra coisa (cliente de API, método não-GET, rota desconhecida) →
///    404 JSON gracioso.
///
/// NÃO PORTADO aqui (relato): o índice de endpoints em JSON que o JS devolve na
/// RAIZ para clientes de API (`Accept: application/json`, api.js:328-352) é da
/// camada de API, não dos estáticos — fica de fora deste módulo de propósito.
async fn spa_fallback(method: Method, uri: Uri, headers: HeaderMap) -> Response {
    if method == Method::GET && wants_html(&headers) && is_frontend_route(uri.path()) {
        // Caminho 1: SPA do build Vite, se presente.
        let dist = dist_dir();
        if tokio::fs::try_exists(dist.join("index.html")).await.unwrap_or(false) {
            return read_static(&dist, "index.html", content_type("html"), None).await;
        }
        // Caminho 2: explorer legado do public/ (fallback quando não há build).
        let publico = public_dir();
        if tokio::fs::try_exists(publico.join("explorer.html")).await.unwrap_or(false) {
            return read_static(&publico, "explorer.html", content_type("html"), None).await;
        }
    }
    rota_nao_encontrada(&method, uri.path())
}

/// O caminho HTML da RAIZ, reusado pelo `GET /` da API.
///
/// Existe para que a rota `/` (que precisa existir para o índice JSON) não
/// TIRE do browser o SPA que o `fallback` servia: as duas respostas continuam
/// saindo do mesmo lugar.
pub async fn spa_raiz() -> Response {
    spa_fallback(Method::GET, "/".parse().unwrap_or_default(), {
        let mut h = HeaderMap::new();
        h.insert(header::ACCEPT, header::HeaderValue::from_static("text/html"));
        h
    })
    .await
}

// ------------------------------------------------------------ montagem

/// Roteador dos estáticos. Mesclado por ÚLTIMO em `api::router()`; o `fallback`
/// vira o *fallback* global (a API não define um, então não há conflito).
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/app", get(app_route))
        .route("/explorer", get(explorer_route))
        .route("/scan", get(explorer_route))
        .route("/wallet", get(wallet_route))
        .route("/js/eav7-wallet.js", get(wallet_js_route))
        .route("/css/eav7.css", get(wallet_css_route))
        .route("/icon.png", get(icon_png_route))
        .route("/icon.svg", get(icon_svg_route))
        .route("/assets/{*rel}", get(assets_route))
        .fallback(spa_fallback)
}

// ---------------------------------------------------------------------------
// Testes — a junção segura é pura; o serviço de arquivo roda em runtime tokio
// contra um diretório temporário PRÓPRIO (sem env global, sem corrida).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    /// Cria um diretório temporário isolado por teste (nome com PID + contador).
    fn tempdir(nome: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static SEQ: AtomicU32 = AtomicU32::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let mut d = std::env::temp_dir();
        d.push(format!("eav7-static-{}-{}-{}", std::process::id(), nome, n));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn content_type_cobre_o_mime_do_js() {
        assert_eq!(content_type("html"), "text/html; charset=utf-8");
        assert_eq!(content_type("js"), "text/javascript; charset=utf-8");
        assert_eq!(content_type("css"), "text/css; charset=utf-8");
        assert_eq!(content_type("svg"), "image/svg+xml");
        assert_eq!(content_type("png"), "image/png");
        assert_eq!(content_type("woff2"), "font/woff2");
        assert_eq!(content_type("desconhecida"), "application/octet-stream");
    }

    #[test]
    fn safe_join_barra_travessia() {
        let base = Path::new("/srv/dist");
        // Caminho benigno junta.
        assert_eq!(
            safe_join(base, "assets/index-abc.js"),
            Some(PathBuf::from("/srv/dist/assets/index-abc.js"))
        );
        // Travessia em qualquer forma → None.
        assert!(safe_join(base, "../secret").is_none());
        assert!(safe_join(base, "assets/../../etc/passwd").is_none());
        assert!(safe_join(base, "a/..").is_none());
        assert!(safe_join(base, "a\\b").is_none());
        // Barras duplas e '.' são ignoradas, não erro.
        assert_eq!(safe_join(base, "a//b/./c"), Some(PathBuf::from("/srv/dist/a/b/c")));
    }

    #[test]
    fn is_frontend_route_espelha_a_lista_do_js() {
        assert!(is_frontend_route("/"));
        assert!(is_frontend_route(""));
        assert!(is_frontend_route("/explorer"));
        assert!(is_frontend_route("/address/E7ABC"));
        assert!(is_frontend_route("/mining"));
        assert!(!is_frontend_route("/status"));
        assert!(!is_frontend_route("/tokens/abc"));
    }

    #[tokio::test]
    async fn read_static_serve_arquivo_existente_e_404_para_ausente() {
        let dir = tempdir("serve");
        std::fs::write(dir.join("app.html"), b"<h1>oi</h1>").unwrap();

        let resp = read_static(&dir, "app.html", content_type("html"), None).await;
        assert_eq!(resp.status(), StatusCode::OK);
        assert_eq!(
            resp.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
        let corpo = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&corpo[..], b"<h1>oi</h1>");

        // Arquivo inexistente → 404 gracioso.
        let resp = read_static(&dir, "nao-existe.html", content_type("html"), None).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        // Travessia → 404, sem ler nada fora do dir.
        let resp = read_static(&dir, "../fora.html", content_type("html"), None).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn read_static_aplica_cache_control_quando_pedido() {
        let dir = tempdir("cache");
        std::fs::write(dir.join("x.js"), b"1").unwrap();
        let resp =
            read_static(&dir, "x.js", content_type("js"), Some("public, max-age=31536000, immutable"))
                .await;
        assert_eq!(
            resp.headers().get(header::CACHE_CONTROL).unwrap(),
            "public, max-age=31536000, immutable"
        );
    }

    #[tokio::test]
    async fn fallback_404_quando_nao_ha_spa_nem_html() {
        // Cliente de API (sem Accept text/html) numa rota desconhecida → 404.
        let resp = spa_fallback(Method::GET, "/rota/desconhecida".parse().unwrap(), HeaderMap::new())
            .await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
