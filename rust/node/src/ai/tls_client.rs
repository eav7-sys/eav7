//! Cliente HTTPS para a API da Anthropic — a ÚNICA borda TLS do nó.
//!
//! Decisão do operador (registrada em `Cargo.toml`): rustls no binário do nó, com
//! o TLS ISOLADO aqui. A malha P2P/API segue http (`p2p::make_client`); só esta
//! chamada externa usa TLS. Implementa o trait [`LlmClient`] — o resto da camada
//! de IA não sabe (nem precisa saber) que existe TLS por baixo.

use std::future::Future;
use std::pin::Pin;

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper_rustls::HttpsConnector;
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use hyper_util::rt::TokioExecutor;

use super::{LlmClient, ANTHROPIC_VERSION};

/// Cliente TLS reutilizável (pool de conexões do `hyper-util`, como o do P2P).
pub struct RustlsLlmClient {
    client: Client<HttpsConnector<HttpConnector>, Full<Bytes>>,
}

impl RustlsLlmClient {
    /// Constrói o cliente com as raízes `webpki` embutidas.
    ///
    /// HOJE NUNCA DEVOLVE `Err` — o corpo não tem nenhum caminho de falha, e o
    /// doc anterior prometia um que não existia ("falha se o provedor não
    /// instalar"). O `Result` fica porque é o contrato dos dois call sites do
    /// `main.rs` (que já degradam para heurística/eco local com um aviso) e
    /// porque o construtor é o lugar certo para uma falha futura de TLS.
    ///
    /// Em particular, o erro de `install_default` é DESCARTADO de propósito:
    /// ele só ocorre quando outro provedor já foi instalado no processo, que é
    /// sucesso disfarçado — abortar aí impediria o nó de subir por um motivo
    /// benigno.
    pub fn new() -> Result<Self, String> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let https = hyper_rustls::HttpsConnectorBuilder::new()
            .with_webpki_roots()
            .https_only() // a Anthropic é HTTPS; recusar http evita downgrade acidental
            .enable_http1()
            .build();
        let client = Client::builder(TokioExecutor::new()).build(https);
        Ok(Self { client })
    }
}

impl LlmClient for RustlsLlmClient {
    fn post_json<'a>(
        &'a self,
        url: &'a str,
        api_key: &'a str,
        body: serde_json::Value,
        timeout_ms: u64,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, String>> + Send + 'a>> {
        Box::pin(async move {
            let corpo = serde_json::to_vec(&body).map_err(|e| format!("corpo JSON inválido: {e}"))?;
            // Headers do JS (worker.js:22-24 / sentinel.js:219-221): a autenticação
            // é `x-api-key` + `anthropic-version`, não Bearer.
            let req = hyper::Request::builder()
                .method("POST")
                .uri(url)
                .header("content-type", "application/json")
                .header("x-api-key", api_key)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .body(Full::new(Bytes::from(corpo)))
                .map_err(|e| format!("request malformado: {e}"))?;

            let fut = self.client.request(req);
            let resp = tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), fut)
                .await
                .map_err(|_| "tempo esgotado na chamada à Anthropic".to_string())?
                .map_err(|e| format!("falha de conexão com a Anthropic: {e}"))?;

            let status = resp.status();
            let bytes = resp
                .into_body()
                .collect()
                .await
                .map_err(|e| format!("falha ao ler resposta: {e}"))?
                .to_bytes();
            // Status fora de 2xx vira Err com o código — worker.js:32-34 /
            // sentinel.js:239 (`if (!res.ok) throw ...`).
            if !status.is_success() {
                let corpo = String::from_utf8_lossy(&bytes);
                return Err(format!("Anthropic respondeu {status}: {}", corpo.chars().take(300).collect::<String>()));
            }
            serde_json::from_slice(&bytes).map_err(|e| format!("resposta não é JSON: {e}"))
        })
    }
}
