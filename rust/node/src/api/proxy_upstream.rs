//! REVERSE PROXY para os serviços de apresentação que rodam ao lado do nó:
//! o frontend Next.js (`proxyToWeb`, api.js:159) e o serviço de fulfillment
//! "Comprar EAV7" (`proxyToBuy`, api.js:175).
//!
//! # Por que o nó faz isto
//!
//! O nó está NA FRENTE do domínio (`eavscan.com` chega aqui). Navegação do
//! browser, payloads RSC e assets do app pertencem ao Next; a API JSON, o P2P e
//! o RPC continuam sendo servidos pelo próprio nó. Sem esta camada, o binário
//! Rust não pode substituir o nó JS em produção: o domínio responderia API onde
//! deveria responder site.
//!
//! # A ordem importa
//!
//! Espelha `api.js:274-290`, e cada posição tem motivo:
//!   1. `/buy/*` é repassado ANTES de qualquer roteamento — o caminho não existe
//!      na API do nó e cair no roteador só produziria 404;
//!   2. `/gateway` NUNCA vai ao Next: é endpoint de API sem página no front, e
//!      encaminhá-lo faria o Next responder "não existe" para a rota que diz a
//!      saúde deste nó;
//!   3. só então a requisição de navegação/asset vai ao Next.
//!
//! Esta camada roda DEPOIS da admissão (o proxy não pode virar rota livre de
//! rate limit) e ANTES do proxy de leitura do gateway (uma navegação do browser
//! é do Next, não de um peer).
//!
//! # Upstream fora do ar não derruba o nó
//!
//! Falha de conexão vira 502 com a mesma mensagem do JS — `text/plain` para o
//! Next (é o browser que lê) e JSON para o `/buy` (é uma API). O nó continua
//! servindo a API normalmente.

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, Uri};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use http_body_util::{BodyExt, Limited};
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;

/// Teto do corpo repassado em cada direção. O JS faz *streaming* sem teto; aqui
/// o corpo é bufferizado, então o teto é o que impede um upload (ou uma resposta
/// do upstream) de estourar a memória do nó.
const MAX_CORPO_BYTES: usize = 32 * 1024 * 1024;

/// Prefixos de diretório do app Next (`WEB_PREFIXES`, api.js:149). Casam por
/// `starts_with` — `/_next/image` não tem extensão e só é pego assim.
const PREFIXOS_WEB: &[&str] = &["/_next/", "/bg/", "/brand/"];

/// Arquivos de raiz do Next (`WEB_FILES_RE`, api.js:150). Comparação por
/// prefixo e em minúsculas — a regex do JS é `/…/i` e ancorada no início.
const ARQUIVOS_WEB: &[&str] = &[
    "/favicon.ico",
    "/icon.svg",
    "/icon.png",
    "/apple-icon",
    "/opengraph-image",
    "/twitter-image",
    "/robots.txt",
    "/sitemap.xml",
    "/manifest",
    "/sw.js",
];

/// Extensões de asset (`WEB_EXT_RE`, api.js:151).
const EXTENSOES_WEB: &[&str] = &[
    "js", "mjs", "css", "map", "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "woff",
    "woff2", "ttf", "eot", "mp4", "webm", "ogg", "wasm",
];

/// Cabeçalhos que o Next usa para marcar navegação do App Router (api.js:155).
const CABECALHOS_RSC: &[&str] = &["rsc", "next-router-prefetch", "next-router-state-tree"];

/// Onde cada upstream vive. Configurável por ambiente como no JS: um servidor
/// pode rodar uma segunda instância (testnet em 3001), e o `/buy` é INSTÂNCIA
/// ÚNICA — nos demais nós `EAV7_BUY_HOST` aponta para o IP privado de quem o roda.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Upstreams {
    pub web_host: String,
    pub web_port: u16,
    pub buy_host: String,
    pub buy_port: u16,
}

impl Upstreams {
    pub fn from_env() -> Self {
        let porta = |chave: &str, padrao: u16| {
            std::env::var(chave).ok().and_then(|v| v.parse().ok()).filter(|p| *p > 0).unwrap_or(padrao)
        };
        Upstreams {
            web_host: "127.0.0.1".to_string(),
            web_port: porta("EAV7_WEB_PORT", 3000),
            buy_host: std::env::var("EAV7_BUY_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            buy_port: porta("EAV7_BUY_PORT", 8790),
        }
    }
}

/// Estado da camada: os upstreams e o cliente HTTP reusado.
#[derive(Clone)]
pub struct ProxyUpstream {
    upstreams: Upstreams,
    client: Client<hyper_util::client::legacy::connect::HttpConnector, Body>,
}

impl ProxyUpstream {
    pub fn novo(upstreams: Upstreams) -> Self {
        ProxyUpstream { upstreams, client: Client::builder(TokioExecutor::new()).build_http() }
    }
}

/// `isWebRequest` — api.js:152-158.
///
/// A pergunta que ele responde é "isto é um browser navegando, ou um cliente de
/// API?". `Accept: text/html` e os cabeçalhos do App Router respondem por
/// navegação; prefixo, nome de arquivo e extensão respondem por asset.
fn e_requisicao_web(accept: Option<&str>, cabecalhos_rsc: bool, caminho: &str) -> bool {
    if accept.is_some_and(|a| a.contains("text/html") || a.contains("text/x-component")) {
        return true;
    }
    if cabecalhos_rsc {
        return true;
    }
    if PREFIXOS_WEB.iter().any(|p| caminho.starts_with(p)) {
        return true;
    }
    let minusculo = caminho.to_lowercase();
    if ARQUIVOS_WEB.iter().any(|f| minusculo.starts_with(f)) {
        return true;
    }
    // Extensão: só o trecho depois do ÚLTIMO ponto do último segmento, para que
    // `/a.js/b` não conte como asset (a regex do JS é ancorada no fim).
    minusculo
        .rsplit('/')
        .next()
        .and_then(|seg| seg.rsplit_once('.'))
        .is_some_and(|(_, ext)| EXTENSOES_WEB.contains(&ext))
}

/// Repassa a requisição a um upstream e devolve a resposta dele.
///
/// Os cabeçalhos do cliente vão inteiros (o Next depende de `accept`, `cookie` e
/// dos `next-router-*`), com o `host` REESCRITO para o do upstream — sem isso o
/// Next recebe o host público e monta URLs absolutas para um servidor que não é
/// ele.
async fn repassar(
    px: &ProxyUpstream,
    host: &str,
    porta: u16,
    req: Request,
) -> Result<Response, String> {
    let (partes, corpo) = req.into_parts();
    let caminho = partes.uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    let uri: Uri = format!("http://{host}:{porta}{caminho}")
        .parse()
        .map_err(|e| format!("URI do upstream inválida: {e}"))?;

    let bytes = Limited::new(corpo, MAX_CORPO_BYTES)
        .collect()
        .await
        // O erro do `Limited` ao estourar é indistinguível de corpo ilegível aqui
        // — os dois são "não dá para repassar", e o desfecho é o mesmo 502.
        .map_err(|_| "corpo da requisição ilegível ou acima do teto".to_string())?
        .to_bytes();

    let mut adiante = Request::from_parts(partes, Body::from(bytes));
    *adiante.uri_mut() = uri;
    if let Ok(v) = HeaderValue::from_str(&format!("{host}:{porta}")) {
        adiante.headers_mut().insert("host", v);
    }

    let resposta = px.client.request(adiante).await.map_err(|e| e.to_string())?;
    let (partes, corpo) = resposta.into_parts();
    let bytes = Limited::new(corpo, MAX_CORPO_BYTES)
        .collect()
        .await
        .map_err(|_| "resposta do upstream ilegível ou acima do teto".to_string())?
        .to_bytes();
    Ok(Response::from_parts(partes, Body::from(bytes)).into_response())
}

/// O middleware.
pub async fn proxiar_upstream(
    State(px): State<ProxyUpstream>,
    req: Request,
    next: Next,
) -> Response {
    let caminho = req.uri().path().to_string();

    // 1. `/buy/*` → serviço de fulfillment (api.js:275).
    if caminho.starts_with("/buy/") {
        let (host, porta) = (px.upstreams.buy_host.clone(), px.upstreams.buy_port);
        return match repassar(&px, &host, porta, req).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[buy] proxy indisponível: {e}");
                (
                    StatusCode::BAD_GATEWAY,
                    axum::Json(serde_json::json!({ "error": "serviço de compra indisponível" })),
                )
                    .into_response()
            }
        };
    }

    // 2. Navegação/asset → Next (api.js:286-289). `/gateway` fica de fora.
    let metodo_de_leitura = req.method() == Method::GET || req.method() == Method::HEAD;
    let tem_rsc = CABECALHOS_RSC.iter().any(|h| req.headers().contains_key(*h));
    let accept = req.headers().get("accept").and_then(|v| v.to_str().ok()).map(str::to_string);
    if metodo_de_leitura
        && caminho != "/gateway"
        && e_requisicao_web(accept.as_deref(), tem_rsc, &caminho)
    {
        let (host, porta) = (px.upstreams.web_host.clone(), px.upstreams.web_port);
        return match repassar(&px, &host, porta, req).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[web] proxy indisponível: {e}");
                let mut r = (StatusCode::BAD_GATEWAY, "EAV7 Web temporariamente indisponível")
                    .into_response();
                r.headers_mut()
                    .insert("content-type", HeaderValue::from_static("text/plain; charset=utf-8"));
                r
            }
        };
    }

    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A classificação "isto é do Next?" — a regra que decide se o domínio
    /// responde site ou API.
    #[test]
    fn classifica_navegacao_asset_e_api() {
        // Navegação do browser.
        assert!(e_requisicao_web(Some("text/html,application/xhtml+xml"), false, "/"));
        assert!(e_requisicao_web(Some("text/x-component"), false, "/address/E7ABC"));
        // App Router: o cabeçalho basta, mesmo sem `accept` de HTML.
        assert!(e_requisicao_web(Some("*/*"), true, "/blocks"));
        // Assets.
        assert!(e_requisicao_web(None, false, "/_next/static/chunk.abc.js"));
        assert!(e_requisicao_web(None, false, "/_next/image"), "sem extensão, pega pelo prefixo");
        assert!(e_requisicao_web(None, false, "/favicon.ico"));
        assert!(e_requisicao_web(None, false, "/brand/logo.svg"));
        assert!(e_requisicao_web(None, false, "/app/BUNDLE.CSS"), "caixa não importa");

        // Cliente de API: nada disto vai ao Next.
        assert!(!e_requisicao_web(Some("application/json"), false, "/status"));
        assert!(!e_requisicao_web(None, false, "/blocks/latest"));
        assert!(!e_requisicao_web(None, false, "/address/E7ABC"));
        // Extensão tem de estar NO FIM, como a regex do JS.
        assert!(!e_requisicao_web(None, false, "/a.js/b"));
    }

    /// `/gateway` é endpoint de API sem página no front: mandá-lo ao Next faria
    /// o operador receber "não existe" ao consultar a saúde DESTE nó.
    #[test]
    fn gateway_nunca_vai_ao_next_mesmo_vindo_do_browser() {
        // A regra de caminho vive no middleware; aqui fixamos a intenção: um
        // browser pedindo /gateway seria classificado como web…
        assert!(e_requisicao_web(Some("text/html"), false, "/gateway"));
        // …e é justamente por isso que o middleware o exclui por caminho.
    }

    /// Os upstreams saem do ambiente — o `/buy` é instância única e nos demais
    /// nós aponta para outro host.
    #[test]
    fn upstreams_tem_os_padroes_do_js() {
        let u = Upstreams::from_env();
        assert_eq!(u.web_host, "127.0.0.1");
        // Sem env, os padrões do JS: Next em 3000, fulfillment em 8790.
        if std::env::var("EAV7_WEB_PORT").is_err() {
            assert_eq!(u.web_port, 3000);
        }
        if std::env::var("EAV7_BUY_PORT").is_err() {
            assert_eq!(u.buy_port, 8790);
        }
    }
}
