//! CONTROLE DE ADMISSÃO da API pública — bloqueio de IP abusivo e rate limit.
//!
//! É a casca que faltava. `ratelimit.rs` e `guard.rs` estavam portados, testados
//! e NUNCA conectados: nenhum `.layer()` no router, nenhum call site fora dos
//! próprios testes. A API pública e o RPC EAVM aceitavam qualquer volume de
//! requisições de qualquer origem — enquanto `GET /guard` respondia
//! `{"enabled":true,"blocked":[]}`, ou seja, afirmava uma proteção inexistente.
//!
//! Sobreviveu à suíte porque os símbolos são `pub` numa biblioteca (o `dead_code`
//! não avisa) e ~25 testes verdes exercitavam a lógica desconectada. É o tipo de
//! lacuna que teste de unidade não pega: cada peça funciona, o circuito não
//! existe.
//!
//! A ordem espelha `api.js:262-272`, e ela importa:
//!   1. IP já bloqueado → 429 imediato, SEM consumir cota (senão o bloqueado
//!      ainda pagaria o custo de contabilizar);
//!   2. estourou o rate limit → conta como falta LEVE no guard (peso 1) e 429;
//!   3. passou → segue para o handler.
//!
//! O loopback nunca é bloqueado (é por onde o túnel da Cloudflare entrega o
//! tráfego público): bloqueá-lo derrubaria todo mundo de uma vez. Essa garantia
//! vive dentro do próprio `guard`/`ratelimit`, não aqui.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::{ConnectInfo, State};
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::guard::{AbuseGuard, GuardConfig};
use crate::ratelimit::{client_ip, RateLimiter};

/// Peso da falta por estourar o rate limit (`api.js:268` — `strike(ip, 1)`).
const PESO_FLOOD: u64 = 1;

/// Peso da falta por SUBMETER TRANSAÇÃO INVÁLIDA (`api.js:543` — `strike(ip, 3)`).
///
/// Vale o triplo do flood porque o custo é outro: cada tentativa faz o nó
/// verificar assinatura híbrida (ECDSA + ML-DSA) antes de recusar. Uma enxurrada
/// de transações forjadas dentro da cota de rate limit não é acidente — é sonda.
const PESO_TX_INVALIDA: u64 = 3;

/// Estado do controle de admissão.
///
/// Vive num `Mutex` PRÓPRIO, fora do `RwLock<Node>`: admissão acontece em TODA
/// requisição, e disputá-la com o lock do estado da cadeia transformaria a
/// defesa num gargalo. O `AbuseGuard` também mora aqui — e não no `Node` — pelo
/// mesmo motivo; `GET /guard` lê este mesmo handle.
#[derive(Clone)]
pub struct Admissao {
    limitador: Arc<Mutex<RateLimiter>>,
    pub guard: Arc<Mutex<AbuseGuard>>,
}

impl Admissao {
    /// Constrói a partir do ambiente, como a referência (`guard.js:15-22` lê as
    /// `EAV7_GUARD_*`; `ratelimit.js:27` usa `CHAIN.RATE_LIMIT_*`).
    pub fn from_env() -> Self {
        Admissao {
            limitador: Arc::new(Mutex::new(RateLimiter::with_config())),
            guard: Arc::new(Mutex::new(AbuseGuard::new(GuardConfig::from_env()))),
        }
    }

    /// Registra uma falta de peso arbitrário no guard.
    ///
    /// Chamado por [`controlar`] nos dois casos do JS: [`PESO_FLOOD`] ao estourar
    /// o rate limit (`api.js:268`) e [`PESO_TX_INVALIDA`] quando `POST /tx`
    /// recusa a transação (`api.js:543`).
    pub fn falta(&self, ip: &str, peso: u64, agora: u64) {
        if let Ok(mut g) = self.guard.lock() {
            g.strike(ip, peso, agora);
        }
    }
}

fn agora_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn recusa(codigo: StatusCode, retry_after: &str, mensagem: &str) -> Response {
    let mut r = (codigo, Json(json!({ "error": mensagem }))).into_response();
    if let Ok(v) = retry_after.parse() {
        r.headers_mut().insert("retry-after", v);
    }
    // A API é pública e lida do navegador; sem CORS a recusa chega como erro de
    // rede opaco, e o cliente não consegue mostrar o motivo.
    if let Ok(v) = "*".parse() {
        r.headers_mut().insert("access-control-allow-origin", v);
    }
    r
}

/// O middleware. Aplicado ao router INTEIRO (API pública e RPC EAVM).
pub async fn controlar<B>(
    State(adm): State<Admissao>,
    ConnectInfo(remoto): ConnectInfo<SocketAddr>,
    req: Request<B>,
    next: Next,
) -> Response
where
    Request<B>: Into<Request<axum::body::Body>>,
{
    let cabecalhos = req.headers();
    // Só confia nos headers de proxy quando o socket é LOOPBACK — que é por onde
    // o túnel entrega. Acesso direto usa o IP do socket, o que impede forjar o
    // header para escapar do limite (achado H-5).
    let ip = client_ip(
        &remoto.ip().to_string(),
        cabecalhos.get("cf-connecting-ip").and_then(|v| v.to_str().ok()),
        cabecalhos.get("x-forwarded-for").and_then(|v| v.to_str().ok()),
    );
    let agora = agora_ms();

    // 1. Bloqueado? 429 sem consumir cota (api.js:262-266).
    let bloqueado = adm.guard.lock().map(|g| g.blocked(&ip, agora)).unwrap_or(false);
    if bloqueado {
        return recusa(
            StatusCode::TOO_MANY_REQUESTS,
            "600",
            "IP temporariamente bloqueado por abuso — expira automaticamente",
        );
    }

    // 2. Dentro do limite? Estourar conta como falta leve (api.js:267-271).
    let dentro = adm.limitador.lock().map(|mut l| l.allow(&ip, agora)).unwrap_or(true);
    if !dentro {
        adm.falta(&ip, PESO_FLOOD, agora);
        return recusa(
            StatusCode::TOO_MANY_REQUESTS,
            "10",
            "muitas requisições — tente novamente em instantes",
        );
    }

    // Guardadas ANTES do handler: `req` é consumido por `next.run`.
    let e_submissao = req.method() == axum::http::Method::POST && req.uri().path() == "/tx";
    let resposta = next.run(req.into()).await;

    // 3. Transação RECUSADA conta como falta GRAVE (`api.js:540-544` — o
    //    `strike(ip, 3)` no `catch` do `submitTransaction`).
    //
    //    Feito AQUI, no pós-processamento, e não dentro do handler: o handler é
    //    puro e não vê socket, logo não conhece o IP. O middleware conhece os
    //    dois — IP e desfecho — então é o único lugar onde a regra fecha sem
    //    furar a separação. O critério é o status 4xx, que é exatamente o que o
    //    `catch` do JS captura (a recusa vira 400).
    if e_submissao && resposta.status().is_client_error() {
        adm.falta(&ip, PESO_TX_INVALIDA, agora);
    }
    resposta
}

#[cfg(test)]
mod tests {
    use super::*;

    /// O rate limit corta no teto e o estouro vira falta no guard — o circuito
    /// que não existia.
    #[test]
    fn estourar_o_limite_gera_falta_no_guard() {
        let adm = Admissao::from_env();
        let ip = "203.0.113.7";
        let agora = 1_000_000;

        // Consome a cota inteira.
        let teto = eav7::config::RATE_LIMIT_MAX;
        for i in 0..teto {
            let ok = adm.limitador.lock().expect("lock").allow(ip, agora);
            assert!(ok, "requisição {i} dentro do teto");
        }
        // A seguinte estoura.
        assert!(!adm.limitador.lock().expect("lock").allow(ip, agora));

        // E a falta acumulada acaba bloqueando o IP.
        let limiar = GuardConfig::default().threshold;
        for _ in 0..limiar {
            adm.falta(ip, PESO_FLOOD, agora);
        }
        assert!(
            adm.guard.lock().expect("lock").blocked(ip, agora),
            "faltas repetidas têm de bloquear o IP"
        );
    }

    /// O loopback NUNCA é bloqueado: é por onde o túnel entrega o tráfego
    /// público, e bloqueá-lo derrubaria todos os usuários de uma vez.
    #[test]
    fn loopback_nunca_e_bloqueado() {
        let adm = Admissao::from_env();
        let agora = 1_000_000;
        for _ in 0..(GuardConfig::default().threshold * 4) {
            adm.falta("127.0.0.1", 3, agora);
        }
        assert!(!adm.guard.lock().expect("lock").blocked("127.0.0.1", agora));
    }

    /// A janela do rate limit REGENERA — o bloqueio é temporário, não permanente.
    #[test]
    fn a_cota_volta_na_janela_seguinte() {
        let adm = Admissao::from_env();
        let ip = "203.0.113.9";
        let agora = 1_000_000;
        for _ in 0..eav7::config::RATE_LIMIT_MAX {
            adm.limitador.lock().expect("lock").allow(ip, agora);
        }
        assert!(!adm.limitador.lock().expect("lock").allow(ip, agora));
        let depois = agora + eav7::config::RATE_LIMIT_WINDOW_MS + 1;
        assert!(
            adm.limitador.lock().expect("lock").allow(ip, depois),
            "passada a janela, a cota volta"
        );
    }
    /// A falta GRAVE (peso 3) por transação inválida bloqueia MAIS RÁPIDO que o
    /// flood — é o ponto de ela existir.
    ///
    /// O JS aplica `strike(ip, 3)` quando `submitTransaction` lança
    /// (`api.js:543`); este cliente não aplicava nada, então inundar o nó com
    /// transações forjadas dentro da cota de rate limit nunca acumulava falta.
    /// Cada tentativa custa uma verificação de assinatura híbrida completa.
    #[test]
    fn tx_invalida_pesa_o_triplo_do_flood() {
        let agora = 1_000_000;
        let limiar = GuardConfig::default().threshold;

        // Com peso 3, bloqueia em ceil(limiar/3) tentativas.
        let grave = Admissao::from_env();
        let ip = "203.0.113.11";
        let tentativas_graves = limiar.div_ceil(PESO_TX_INVALIDA);
        for _ in 0..tentativas_graves {
            grave.falta(ip, PESO_TX_INVALIDA, agora);
        }
        assert!(
            grave.guard.lock().expect("lock").blocked(ip, agora),
            "{tentativas_graves} transações inválidas têm de bloquear"
        );

        // Com peso 1, o MESMO número de tentativas ainda não bloqueia.
        let leve = Admissao::from_env();
        let ip2 = "203.0.113.12";
        for _ in 0..tentativas_graves {
            leve.falta(ip2, PESO_FLOOD, agora);
        }
        assert!(
            !leve.guard.lock().expect("lock").blocked(ip2, agora),
            "o mesmo volume de faltas LEVES não pode bloquear ainda"
        );
    }

}
