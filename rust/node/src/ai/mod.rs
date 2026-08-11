//! Camada de IA OFF-CHAIN do nó EAV7 — porte de `src/ai/*.js`.
//!
//! São processos que rodam AO LADO do nó e NÃO são consenso:
//!
//!   • [`bridge`]   — construtores das transações de IA (`src/ai/bridge.js`):
//!                    lógica PURA que monta e assina uma `eav7::transaction::Tx`.
//!   • [`worker`]   — worker de oráculo (`src/ai/worker.js`): observa a rede,
//!                    executa AI_TASK pendentes e publica AI_RESULT assinado.
//!   • [`sentinel`] — sentinela de segurança 24h (`src/ai/sentinel.js`):
//!                    heurísticas determinísticas + parecer LLM opcional.
//!
//! # Linha de segurança da IA (ver [[eav7-ai-roadmap]])
//!
//! Tudo aqui é PROPOSE-ONLY: a IA observa, alerta e REDIGE recomendações
//! (`autonomous: false` nos rascunhos de governança) — quem decide é a
//! governança/humano. A única mitigação automática permitida é operacional e
//! reversível (roteamento de leitura do gateway), e ela NÃO vive neste módulo.
//!
//! # Estrutura do porte — lógica separada de transporte
//!
//! Como no resto do crate (ver o cabeçalho de `lib.rs`): as heurísticas, a
//! seleção de tarefas e os construtores de tx são funções puras sobre dados; o
//! transporte (GET/POST no nó, timers) é async e vive nas structs `*Worker`/
//! `SecuritySentinel`, que REUSAM o cliente hyper do P2P ([`crate::p2p::make_client`]).
//!
//! # TLS para a chamada à API da Anthropic — DECIDIDO E LIGADO
//!
//! O cliente HTTP do P2P/API é http-only DE PROPÓSITO (`p2p::make_client`): a
//! malha fala http entre nós e o público entra pela Cloudflare. A API da
//! Anthropic (`https://api.anthropic.com/v1/messages`) exige HTTPS, então o TLS
//! entrou — ISOLADO numa única borda, e não no cliente da malha: as dependências
//! `hyper-rustls` e `rustls` estão no `Cargo.toml` do nó, e
//! [`tls_client::RustlsLlmClient`]
//! implementa [`LlmClient`]. O `main.rs` o CONSTRÓI e injeta sozinho, tanto na
//! sentinela quanto no oráculo, sempre que `ANTHROPIC_API_KEY` está definida —
//! não há nada que o operador precise montar.
//!
//! O trait continua existindo por duas razões, não por falta de implementação:
//! os testes injetam um cliente falso sem abrir socket, e um operador pode
//! trocar a borda TLS pela dele. Sem `ANTHROPIC_API_KEY` (ou se a construção do
//! cliente TLS falhar, o que o `main.rs` loga e degrada), o comportamento é o
//! MESMO do JS sem a chave: só heurísticas na sentinela, eco local no worker. A
//! montagem do corpo do request e a extração do texto da resposta são puras e
//! ficam AQUI ([`anthropic_request_body`]/[`anthropic_extract_text`]) — a borda
//! TLS só transporta bytes.

pub mod tls_client;
pub mod bridge;
pub mod sentinel;
pub mod worker;

use std::time::Duration;

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;

use crate::p2p::HttpClient;

/// Modelo default do analista/oráculo — `DEFAULT_CLAUDE_MODEL` de
/// `src/ai/worker.js:11` e `src/ai/sentinel.js:13` (mesma string nos dois).
pub const DEFAULT_CLAUDE_MODEL: &str = "claude-sonnet-5";

/// Endpoint da API da Anthropic — worker.js:19 / sentinel.js:217. MESMA URL do
/// JS; é HTTPS, servido pela borda TLS de [`tls_client`] (ver o cabeçalho).
pub const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";

/// Header `anthropic-version` — worker.js:24 / sentinel.js:221.
pub const ANTHROPIC_VERSION: &str = "2023-06-01";

/// A borda de transporte do POST HTTPS à API da Anthropic. A implementação de
/// produção é [`tls_client::RustlsLlmClient`] (ver o cabeçalho); o trait existe
/// para que os testes possam substituí-la sem socket.
///
/// O contrato espelha o `fetch` do JS: envia o JSON com os
/// headers `x-api-key` + `anthropic-version` e devolve o corpo parseado; status
/// fora de 2xx vira `Err` com o status na mensagem (worker.js:32-34,
/// sentinel.js:239).
pub trait LlmClient: Send + Sync {
    fn post_json<'a>(
        &'a self,
        url: &'a str,
        api_key: &'a str,
        body: serde_json::Value,
        timeout_ms: u64,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<serde_json::Value, String>> + Send + 'a>>;
}

/// Corpo do request à API — o `body` do worker.js:26-30 e do sentinel.js:224-236:
/// `{ model, max_tokens, messages: [{ role: "user", content: prompt }] }`.
/// JSON de APRESENTAÇÃO (nunca assinado/hasheado) — serde_json é o certo aqui.
pub fn anthropic_request_body(model: &str, max_tokens: u32, prompt: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{ "role": "user", "content": prompt }],
    })
}

/// Extrai o texto da resposta — worker.js:36-39 / sentinel.js:241: filtra os
/// blocos `content` com `type == "text"` e junta com `\n`.
pub fn anthropic_extract_text(body: &serde_json::Value) -> String {
    let Some(partes) = body.get("content").and_then(|c| c.as_array()) else {
        return String::new();
    };
    partes
        .iter()
        .filter(|p| p.get("type").and_then(|t| t.as_str()) == Some("text"))
        .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("\n")
}

// ---------------------------------------------------------------------------
// Utilidades compartilhadas pelos três submódulos
// ---------------------------------------------------------------------------

pub(crate) use eav7::format_eav7;

/// Milissegundos desde a época Unix — o `Date.now()` dos timers do JS. Só o
/// TRANSPORTE o chama; a lógica pura recebe `now` como parâmetro.
pub(crate) fn now_ms() -> i64 {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(_) => 0, // relógio antes de 1970: degrada sem pânico (regra do crate)
    }
}

/// Teto de leitura das respostas do PRÓPRIO nó (o JS não capa, mas materializar
/// um corpo sem limite é o achado H-4 do P2P — aqui o interlocutor é o nosso
/// nó, então o teto é folgado: uma página de /blocks com 100 blocos cheios
/// fica ordens de grandeza abaixo).
const MAX_BODY_BYTES: u64 = 64 * 1024 * 1024;

/// Lê o corpo frame a frame com teto — o mesmo padrão de `p2p::fetch_text_capped`,
/// sem o guard anti-SSRF: a URL aqui é o PRÓPRIO nó do operador (configuração
/// local, tipicamente 127.0.0.1), não um peer hostil vindo de gossip.
async fn corpo_capado(body: hyper::body::Incoming) -> Result<Vec<u8>, String> {
    let mut body = body;
    let mut recebido: u64 = 0;
    let mut buf: Vec<u8> = Vec::new();
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|e| format!("erro lendo resposta do nó: {e}"))?;
        if let Ok(dados) = frame.into_data() {
            recebido += dados.len() as u64;
            if recebido > MAX_BODY_BYTES {
                return Err("resposta do nó excede o limite de bytes".to_string());
            }
            buf.extend_from_slice(&dados);
        }
    }
    Ok(buf)
}

/// GET JSON no nó — o `#getJson` de worker.js:56-60 / sentinel.js:37-41:
/// timeout de 10 s (o `AbortSignal.timeout(10_000)`), status fora de 2xx vira
/// `Err("{path} respondeu {status}")`.
pub(crate) async fn http_get_json(
    client: &HttpClient,
    url: &str,
    timeout_ms: u64,
) -> Result<serde_json::Value, String> {
    let uri: hyper::Uri = url.parse().map_err(|_| format!("URL inválida: {url}"))?;
    let leitura = async {
        let res = client.get(uri).await.map_err(|e| format!("falha ao contactar o nó: {e}"))?;
        let status = res.status();
        // O JS lança ANTES de ler o corpo; aqui lemos (capado) e descartamos —
        // diferença invisível para quem chama.
        let corpo = corpo_capado(res.into_body()).await?;
        if !status.is_success() {
            return Err(format!("{url} respondeu {}", status.as_u16()));
        }
        serde_json::from_slice(&corpo).map_err(|e| format!("JSON inválido de {url}: {e}"))
    };
    tokio::time::timeout(Duration::from_millis(timeout_ms), leitura)
        .await
        .map_err(|_| format!("timeout em {url}"))?
}

/// POST JSON no nó, devolvendo `(status, corpo)` — o worker precisa do corpo
/// mesmo em erro (`body.error ?? "nó respondeu N"`, worker.js:69-71) e a
/// sentinela ignora a resposta (sentinel.js:46-55). Corpo não-JSON vira `Null`
/// em vez de erro: o que importa para os chamadores é o status + `error`.
pub(crate) async fn http_post_json(
    client: &HttpClient,
    url: &str,
    body: String,
    header_extra: Option<(&'static str, String)>,
    timeout_ms: u64,
) -> Result<(u16, serde_json::Value), String> {
    let uri: hyper::Uri = url.parse().map_err(|_| format!("URL inválida: {url}"))?;
    let mut req = hyper::Request::builder()
        .method(hyper::Method::POST)
        .uri(uri)
        .header(hyper::header::CONTENT_TYPE, "application/json");
    if let Some((nome, valor)) = header_extra {
        req = req.header(nome, valor);
    }
    let req = req
        .body(Full::new(Bytes::from(body)))
        .map_err(|e| format!("request inválido: {e}"))?;
    let envio = async {
        let res = client.request(req).await.map_err(|e| format!("falha ao contactar o nó: {e}"))?;
        let status = res.status().as_u16();
        let corpo = corpo_capado(res.into_body()).await?;
        let json = serde_json::from_slice(&corpo).unwrap_or(serde_json::Value::Null);
        Ok((status, json))
    };
    tokio::time::timeout(Duration::from_millis(timeout_ms), envio)
        .await
        .map_err(|_| format!("timeout em {url}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_eav7_espelha_o_js() {
        // config.js:572-578: 16000000n -> "16"; fração com zeros à direita podados.
        assert_eq!(format_eav7(16_000_000), "16");
        assert_eq!(format_eav7(2_500_000), "2.5");
        assert_eq!(format_eav7(0), "0");
        assert_eq!(format_eav7(1), "0.000001");
        assert_eq!(format_eav7(500_000_000), "500"); // MIN_ORACLE_STAKE = 500 EAV7
        assert_eq!(format_eav7(1_230_000), "1.23");
    }

    #[test]
    fn corpo_anthropic_tem_os_campos_do_js() {
        let corpo = anthropic_request_body(DEFAULT_CLAUDE_MODEL, 1024, "pergunta");
        assert_eq!(corpo["model"], "claude-sonnet-5");
        assert_eq!(corpo["max_tokens"], 1024);
        assert_eq!(corpo["messages"][0]["role"], "user");
        assert_eq!(corpo["messages"][0]["content"], "pergunta");
    }

    #[test]
    fn extrai_texto_filtrando_blocos_nao_texto() {
        // worker.js:36-39: filtra type=="text" e junta com \n.
        let corpo = serde_json::json!({ "content": [
            { "type": "text", "text": "linha 1" },
            { "type": "tool_use", "id": "x" },
            { "type": "text", "text": "linha 2" },
        ]});
        assert_eq!(anthropic_extract_text(&corpo), "linha 1\nlinha 2");
        assert_eq!(anthropic_extract_text(&serde_json::json!({})), "");
    }
}
