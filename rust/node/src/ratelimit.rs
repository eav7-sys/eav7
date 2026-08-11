//! Rate-limit por IP e resolução do IP real do cliente.
//!
//! # Nada aqui é consenso
//!
//! Tanto o limitador quanto a resolução de IP são NODE-LOCAL: são política de
//! admissão da API do próprio nó. Dois nós com limites diferentes, ou até com o
//! limitador desligado, permanecem na mesma cadeia — o que entra em bloco é
//! decidido pelo produtor e validado pela máquina de estado, que não consulta
//! limitador nenhum. Por isso o mapa de hits é um `HashMap` comum: a ordem de
//! iteração não importa e o estado nunca é serializado nem entra em hash.
//!
//! # Separação lógica/transporte
//!
//! O original (`src/node/ratelimit.js`) recebe um objeto `req` HTTP e lê tanto
//! `req.socket.remoteAddress` quanto os headers `cf-connecting-ip`/`x-forwarded-for`,
//! além de chamar `Date.now()` por conta própria. Este porte NÃO conhece nenhum
//! tipo HTTP nem lê o relógio: `client_ip` recebe os dados JÁ EXTRAÍDOS e `allow`
//! recebe `now` em milissegundos como parâmetro. Extrair esses dados do `req` e
//! obter o instante é responsabilidade do transporte (`api`), a única camada que
//! depende do runtime de I/O.

use eav7::config::{RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS};
use std::collections::HashMap;

// ---------------------------------------------------------------- loopback

/// Verdadeiro se `ip` é um dos endereços de loopback reconhecidos. Espelha o
/// `LOOPBACK` do original: `{127.0.0.1, ::1, ::ffff:127.0.0.1}` — este último é a
/// forma IPv4-mapeada-em-IPv6 do loopback, que é como um socket em dual-stack pode
/// reportar uma conexão local. O conjunto é FECHADO de propósito: qualquer outra
/// coisa (incluindo `unknown`) é tratada como acesso direto não confiável.
pub fn is_loopback_ip(ip: &str) -> bool {
    matches!(ip, "127.0.0.1" | "::1" | "::ffff:127.0.0.1")
}

// ---------------------------------------------------------------- client_ip

// Resolve o IP real do cliente. Atrás da Cloudflare vem em CF-Connecting-IP; senão o
// IP do socket. Só confia nos headers de proxy quando a conexão vem do LOOPBACK — que
// é por onde o túnel cloudflared entrega o tráfego público. Acesso DIRETO usa o IP do
// socket, impedindo forja do header para furar o rate limit (achado H-5). ÚLTIMO hop do
// XFF (não o primeiro, forjável pelo cliente — achado L2).
//
// Versão PURA do `clientIp(req)` do JS: o transporte extrai `req.socket.remoteAddress`
// (com o fallback `'unknown'` quando ausente), `req.headers['cf-connecting-ip']` e
// `req.headers['x-forwarded-for']` e os passa aqui. Um header ausente vira `None`; um
// header presente porém vazio (`Some("")`) é IGNORADO, replicando o teste `&& cf` /
// `&& xff` do original, que trata string vazia como falsy.
pub fn client_ip(
    socket_ip: &str,
    cf_connecting_ip: Option<&str>,
    x_forwarded_for: Option<&str>,
) -> String {
    if is_loopback_ip(socket_ip) {
        // CF-Connecting-IP tem prioridade: é o header que o cloudflared injeta com o
        // IP de origem real. Só o aceitamos porque o socket é loopback (o túnel).
        if let Some(cf) = cf_connecting_ip
            && !cf.is_empty()
        {
            return cf.to_string();
        }
        // Sem CF, cai para o X-Forwarded-For. O ÚLTIMO hop é o inserido pelo proxy
        // imediatamente à nossa frente; os anteriores são forjáveis pelo cliente e
        // NÃO devem ser usados (achado L2). `split(',')` sempre devolve ao menos um
        // elemento, então o `last()` só falha em teoria — o fallback ao socket cobre.
        if let Some(xff) = x_forwarded_for
            && !xff.is_empty()
            && let Some(last) = xff.split(',').next_back()
        {
            return last.trim().to_string();
        }
    }
    // Acesso direto (ou loopback sem headers de proxy): o IP do socket é a verdade.
    socket_ip.to_string()
}

// ---------------------------------------------------------------- RateLimiter

/// Estado por IP dentro da janela corrente: quantos hits já contamos e o instante
/// (em ms) em que a janela expira e a contagem zera.
struct Hit {
    count: u64,
    reset_at: u64,
}

/// Rate limit por IP com janela fixa em memória. Defesa em camadas junto com as
/// regras de WAF da própria Cloudflare — não é a única barreira, e por isso não
/// precisa ser à prova de tudo: precisa ser barata, determinística e previsível.
///
/// Não é `Clone`: cada nó tem um único limitador vivo, e clonar duplicaria o
/// estado de contagem em vez de compartilhá-lo, o que silenciosamente dobraria o
/// teto efetivo.
pub struct RateLimiter {
    /// `ip -> (count, reset_at)`. `HashMap` porque a ordem não importa: é estado
    /// local, nunca serializado nem hasheado.
    hits: HashMap<String, Hit>,
    /// Máximo de requisições permitidas por janela.
    max: u64,
    /// Duração da janela em milissegundos.
    window_ms: u64,
}

/// Acima deste tamanho o mapa sofre poda oportunista. Espelha o `50_000` do
/// original: é um teto de MEMÓRIA, não de política — remove só entradas já
/// expiradas, então nunca afeta quem está ativo dentro da janela.
const PRUNE_THRESHOLD: usize = 50_000;

impl RateLimiter {
    /// Constrói com limites explícitos. Use quando o chamador quer sobrescrever os
    /// defaults de `eav7::config` (por exemplo, em testes ou num endpoint com
    /// política própria).
    pub fn new(max: u64, window_ms: u64) -> Self {
        Self {
            hits: HashMap::new(),
            max,
            window_ms,
        }
    }

    /// Constrói com os defaults do protocolo: `RATE_LIMIT_MAX` requisições por
    /// `RATE_LIMIT_WINDOW_MS`, ambos vindos de `eav7::config` (gerado de
    /// `src/config.js`, a fonte única). Equivale ao `createRateLimiter()` sem
    /// argumentos.
    pub fn with_config() -> Self {
        Self::new(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
    }

    /// Contabiliza uma requisição de `ip` no instante `now` (ms) e devolve `true`
    /// se AINDA está dentro do limite, `false` se excedeu (o transporte deve
    /// responder 429). `now` é parâmetro — este módulo não lê relógio.
    ///
    /// Janela fixa: a primeira requisição de um IP (ou a primeira após a janela
    /// anterior ter expirado) cria uma janela nova que vai até `now + window_ms`;
    /// as seguintes apenas incrementam a contagem até `reset_at`.
    pub fn allow(&mut self, ip: &str, now: u64) -> bool {
        // Entrada ausente OU janela já expirada => reinicia a janela. O `>=` (e não
        // `>`) casa o original: no exato milissegundo do reset a janela já é nova.
        let expired = match self.hits.get(ip) {
            Some(e) => now >= e.reset_at,
            None => true,
        };
        if expired {
            self.hits.insert(
                ip.to_string(),
                Hit {
                    count: 0,
                    reset_at: now + self.window_ms,
                },
            );
        }

        // Incrementa. A entrada existe com certeza (acabamos de inserir ou já estava
        // lá), então este acesso não entra no caminho de erro.
        let count = match self.hits.get_mut(ip) {
            Some(e) => {
                e.count += 1;
                e.count
            }
            // Inalcançável na prática — mantido sem pânico por disciplina do repo.
            None => 1,
        };

        // Poda oportunista: só quando o mapa cresceu além do teto de memória, e só
        // entradas já expiradas em `now`. Evita que IPs de uma rajada antiga fiquem
        // residentes para sempre. Feito DEPOIS de contar, como no original.
        if self.hits.len() > PRUNE_THRESHOLD {
            self.hits.retain(|_, v| now < v.reset_at);
        }

        // Dentro do limite se a contagem não passou de `max`. `<=`, não `<`: o
        // `max`-ésimo hit ainda passa; o `(max+1)`-ésimo é o primeiro a ser negado.
        count <= self.max
    }
}

impl Default for RateLimiter {
    /// Mesmo que `with_config()` — os defaults do protocolo.
    fn default() -> Self {
        Self::with_config()
    }
}

// ---------------------------------------------------------------- testes

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_reconhece_o_conjunto_fechado() {
        assert!(is_loopback_ip("127.0.0.1"));
        assert!(is_loopback_ip("::1"));
        assert!(is_loopback_ip("::ffff:127.0.0.1"));
        // Fora do conjunto: público, LAN e o sentinela `unknown`.
        assert!(!is_loopback_ip("8.8.8.8"));
        assert!(!is_loopback_ip("192.168.0.1"));
        assert!(!is_loopback_ip("::ffff:8.8.8.8"));
        assert!(!is_loopback_ip("unknown"));
        assert!(!is_loopback_ip(""));
    }

    #[test]
    fn client_ip_direto_ignora_headers_forjados() {
        // Socket público: headers de proxy NÃO são confiáveis (achado H-5).
        let ip = client_ip(
            "8.8.8.8",
            Some("1.2.3.4"),
            Some("5.6.7.8"),
        );
        assert_eq!(ip, "8.8.8.8");
    }

    #[test]
    fn client_ip_loopback_com_cf() {
        // Atrás do túnel (socket loopback), CF-Connecting-IP tem prioridade.
        let ip = client_ip(
            "127.0.0.1",
            Some("203.0.113.7"),
            Some("9.9.9.9"),
        );
        assert_eq!(ip, "203.0.113.7");
    }

    #[test]
    fn client_ip_loopback_com_xff_multiplos_hops_pega_o_ultimo() {
        // Sem CF, usa o XFF e pega o ÚLTIMO hop (achado L2). Os anteriores são
        // forjáveis pelo cliente. Também testa o `trim()` do espaço após a vírgula.
        let ip = client_ip(
            "::1",
            None,
            Some("1.1.1.1, 2.2.2.2, 203.0.113.9"),
        );
        assert_eq!(ip, "203.0.113.9");
    }

    #[test]
    fn client_ip_loopback_header_vazio_e_ignorado() {
        // CF vazio cai para o XFF; XFF vazio cai para o socket.
        assert_eq!(
            client_ip("127.0.0.1", Some(""), Some("4.4.4.4")),
            "4.4.4.4"
        );
        assert_eq!(client_ip("127.0.0.1", Some(""), Some("")), "127.0.0.1");
    }

    #[test]
    fn client_ip_loopback_sem_headers_usa_socket() {
        assert_eq!(client_ip("::1", None, None), "::1");
    }

    #[test]
    fn dentro_do_limite() {
        // max=3: os três primeiros hits passam.
        let mut rl = RateLimiter::new(3, 10_000);
        assert!(rl.allow("1.2.3.4", 0));
        assert!(rl.allow("1.2.3.4", 1));
        assert!(rl.allow("1.2.3.4", 2));
    }

    #[test]
    fn estouro_do_limite_o_max_mais_um_esimo_retorna_false() {
        let mut rl = RateLimiter::new(3, 10_000);
        assert!(rl.allow("1.2.3.4", 0)); // 1
        assert!(rl.allow("1.2.3.4", 0)); // 2
        assert!(rl.allow("1.2.3.4", 0)); // 3 == max, ainda passa
        assert!(!rl.allow("1.2.3.4", 0)); // 4 == max+1, negado
        assert!(!rl.allow("1.2.3.4", 0)); // segue negando dentro da janela
    }

    #[test]
    fn reset_apos_a_janela_zera_a_contagem() {
        let mut rl = RateLimiter::new(2, 10_000);
        assert!(rl.allow("1.2.3.4", 0)); // 1
        assert!(rl.allow("1.2.3.4", 5_000)); // 2
        assert!(!rl.allow("1.2.3.4", 9_999)); // 3, negado (janela vai até 10_000)
        // No exato reset_at (>=) a janela é nova: contagem volta a 1.
        assert!(rl.allow("1.2.3.4", 10_000));
        assert!(rl.allow("1.2.3.4", 10_001));
        assert!(!rl.allow("1.2.3.4", 10_002));
    }

    #[test]
    fn ips_distintos_tem_janelas_independentes() {
        let mut rl = RateLimiter::new(1, 10_000);
        assert!(rl.allow("1.1.1.1", 0));
        assert!(!rl.allow("1.1.1.1", 0));
        // Outro IP não é afetado pela contagem do primeiro.
        assert!(rl.allow("2.2.2.2", 0));
        assert!(!rl.allow("2.2.2.2", 0));
    }

    #[test]
    fn defaults_vem_da_config() {
        // Sanidade: o construtor default usa os valores do protocolo.
        let mut rl = RateLimiter::default();
        for i in 0..RATE_LIMIT_MAX {
            assert!(rl.allow("1.2.3.4", i));
        }
        // O (max+1)-ésimo, ainda dentro da janela, é negado.
        assert!(!rl.allow("1.2.3.4", RATE_LIMIT_MAX));
    }
}
