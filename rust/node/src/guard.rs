//! Auto-mitigação OPERACIONAL: bloqueio temporário de IPs abusivos.
//!
//! # Nada aqui é consenso
//!
//! A `AbuseGuard` afeta APENAS quem pode BATER neste nó (a API pública); jamais a
//! validade de transações/blocos ou o estado da cadeia. É 100% REVERSÍVEL: todo
//! bloqueio carrega um TTL e expira sozinho, e o admin pode limpar manualmente
//! (`clear`). Guardrails rígidos, portados ao pé da letra de `src/node/guard.js`:
//!
//! - Só bloqueia depois de acumular faltas graves numa janela CURTA (flood de
//!   rate-limit, transações inválidas em série).
//! - NUNCA bloqueia o loopback — é por onde entra o túnel Cloudflare. Se o loopback
//!   pudesse ser bloqueado, um IP forjado derrubaria TODO o tráfego público do nó.
//! - Reincidentes têm o bloqueio DOBRADO (backoff exponencial) até um teto.
//!
//! A IA age sozinha aqui porque é operacional e reversível — a mesma linha do
//! balanceador de gateway ([[eav7-ai-roadmap]]).
//!
//! # Separação lógica / transporte
//!
//! Este módulo é PURO: `strike`/`blocked`/`prune`/`snapshot` recebem `now` (ms) como
//! parâmetro e não leem relógio nem env por conta própria. Na referência JS o
//! construtor lia `process.env.EAV7_GUARD_*`; aqui a leitura de env fica para a
//! camada de transporte, que monta um [`GuardConfig`] e chama [`AbuseGuard::new`].
//! O callback `log` do JS (I/O) foi omitido — é responsabilidade do transporte.

// A guarda NUNCA bloqueia o loopback (ver doc acima). A função de classificação
// vive em `ratelimit` — fonte ÚNICA da regra, para não divergir de lá. NÃO
// redefinimos `is_loopback_ip` aqui.
use crate::ratelimit::is_loopback_ip;
use std::collections::HashMap;

// ------------------------------------------------------------------ defaults
//
// Espelham os defaults do construtor JS (`src/node/guard.js:14-19`). Na referência
// vinham de env com fallback; aqui são as constantes de fallback, expostas para o
// transporte reusar ao montar o `GuardConfig`.

/// Janela de acúmulo de faltas, em ms. Origem: `EAV7_GUARD_WINDOW_MS || 60_000`.
pub const DEFAULT_WINDOW_MS: u64 = 60_000;
/// Pontos de falta na janela para disparar o bloqueio. Origem: `EAV7_GUARD_STRIKES || 40`.
pub const DEFAULT_THRESHOLD: u64 = 40;
/// Duração-base do bloqueio (1ª ofensa), em ms. Origem: `EAV7_GUARD_BLOCK_MS || 10*60_000`.
pub const DEFAULT_BLOCK_MS: u64 = 10 * 60_000;
/// Teto do bloqueio após backoff, em ms. Origem: `EAV7_GUARD_MAX_BLOCK_MS || 6*60*60_000`.
pub const DEFAULT_MAX_BLOCK_MS: u64 = 6 * 60 * 60_000;

/// Tamanho do `entries` a partir do qual a poda oportunista dispara dentro de
/// `strike` (sem timer extra). Origem: `src/node/guard.js:36`.
const PRUNE_THRESHOLD: usize = 10_000;

// ----------------------------------------------------------------- config

/// Parâmetros de configuração da guarda. O transporte lê env (`EAV7_GUARD_*`) e
/// preenche este struct; a lógica pura só consome os valores já resolvidos.
#[derive(Debug, Clone)]
pub struct GuardConfig {
    /// Janela de acúmulo de faltas (ms).
    pub window_ms: u64,
    /// Pontos de falta na janela para bloquear.
    pub threshold: u64,
    /// Duração-base do bloqueio (ms).
    pub block_ms: u64,
    /// Teto do bloqueio após backoff (ms).
    pub max_block_ms: u64,
    /// Ligado por padrão (opt-out no JS: `EAV7_GUARD !== '0'`).
    pub enabled: bool,
}

impl GuardConfig {
    /// Lê as `EAV7_GUARD_*` do ambiente, com os mesmos nomes e defaults do
    /// construtor JS (`guard.js:15-22`).
    ///
    /// O doc do struct já prometia que "o transporte lê env e preenche este
    /// struct" — mas a função não existia, e `main.rs` usava `default()`. Todas
    /// as `EAV7_GUARD_*` que um operador definisse eram ignoradas em silêncio.
    ///
    /// A leitura fica AQUI, na borda, e não na lógica: `AbuseGuard` continua
    /// recebendo valores já resolvidos e permanece testável sem ambiente.
    pub fn from_env() -> Self {
        let num = |nome: &str, padrao: u64| {
            std::env::var(nome).ok().and_then(|v| v.parse::<u64>().ok()).unwrap_or(padrao)
        };
        GuardConfig {
            window_ms: num("EAV7_GUARD_WINDOW_MS", DEFAULT_WINDOW_MS),
            threshold: num("EAV7_GUARD_STRIKES", DEFAULT_THRESHOLD),
            block_ms: num("EAV7_GUARD_BLOCK_MS", DEFAULT_BLOCK_MS),
            max_block_ms: num("EAV7_GUARD_MAX_BLOCK_MS", DEFAULT_MAX_BLOCK_MS),
            // Opt-OUT, como o JS (`EAV7_GUARD !== '0'`): a guarda nasce ligada.
            enabled: std::env::var("EAV7_GUARD").as_deref() != Ok("0"),
        }
    }
}

impl Default for GuardConfig {
    fn default() -> Self {
        // Iguais aos defaults do construtor JS.
        GuardConfig {
            window_ms: DEFAULT_WINDOW_MS,
            threshold: DEFAULT_THRESHOLD,
            block_ms: DEFAULT_BLOCK_MS,
            max_block_ms: DEFAULT_MAX_BLOCK_MS,
            enabled: true,
        }
    }
}

// ----------------------------------------------------------------- entry

/// Estado por IP. Todos os campos em ms (exceto `score`, que é contador de pontos).
/// Espelha `{ windowStart, score, blockedUntil, offenses, lastStrike }` do JS.
#[derive(Debug, Clone)]
struct Entry {
    /// Início da janela corrente (ms).
    window_start: u64,
    /// Pontos de falta acumulados na janela.
    score: u64,
    /// Instante (ms) até o qual o IP está bloqueado; `0` = nunca bloqueado.
    blocked_until: u64,
    /// Quantas vezes já foi bloqueado — expoente do backoff.
    offenses: u32,
    /// Instante (ms) do último strike contabilizado.
    last_strike: u64,
}

// ------------------------------------------------------------- snapshot

/// Um bloqueio ativo, para observabilidade (GET /guard).
#[derive(Debug, Clone)]
pub struct BlockedIp {
    /// IP bloqueado.
    pub ip: String,
    /// Instante (ms) em que o bloqueio expira.
    pub until: u64,
    /// Quanto falta para expirar (ms).
    pub remaining_ms: u64,
    /// Reincidências acumuladas neste IP.
    pub offenses: u32,
}

/// Retrato instantâneo da guarda (contadores + lista de bloqueios ativos).
#[derive(Debug, Clone)]
pub struct GuardSnapshot {
    /// Se a guarda está ligada.
    pub enabled: bool,
    /// Limiar de pontos para bloquear.
    pub threshold: u64,
    /// Janela (ms).
    pub window_ms: u64,
    /// Duração-base do bloqueio (ms).
    pub block_ms: u64,
    /// Total de bloqueios disparados na vida do processo.
    pub total_blocks: u64,
    /// Quantidade de bloqueios ativos agora.
    pub active_blocks: usize,
    /// Bloqueios ativos, ordenados por `until` DECRESCENTE.
    pub blocked: Vec<BlockedIp>,
    /// Instante da foto (ms).
    pub at: u64,
}

// ------------------------------------------------------------- AbuseGuard

/// Guarda anti-abuso — estado NODE-LOCAL (fora de consenso), por isso `HashMap`.
#[derive(Debug, Clone)]
pub struct AbuseGuard {
    window_ms: u64,
    threshold: u64,
    block_ms: u64,
    max_block_ms: u64,
    enabled: bool,
    /// ip -> estado. `HashMap` porque é estado local, e a ordem não é observável
    /// pelo consenso (o `snapshot` reordena explicitamente por `until`).
    entries: HashMap<String, Entry>,
    /// Total de bloqueios já disparados (contador de vida do processo).
    total_blocks: u64,
}

impl AbuseGuard {
    /// Constrói a guarda a partir de uma configuração já resolvida.
    pub fn new(config: GuardConfig) -> Self {
        AbuseGuard {
            window_ms: config.window_ms,
            threshold: config.threshold,
            block_ms: config.block_ms,
            max_block_ms: config.max_block_ms,
            enabled: config.enabled,
            entries: HashMap::new(),
            total_blocks: 0,
        }
    }

    /// Registra uma falta (`weight`: rate-limit=1, tx inválida=3, etc). Retorna
    /// `true` se ESTE strike acabou de disparar o bloqueio. Puro (recebe `now`).
    ///
    /// Portado ao pé da letra de `src/node/guard.js:34`:
    /// - guarda desligada, ip vazio ou LOOPBACK nunca contam nem bloqueiam;
    /// - poda oportunista quando `entries` passa de 10_000 (sem timer extra);
    /// - se já bloqueado (`now < blocked_until`), não re-conta;
    /// - janela expirada (`now - window_start > window_ms`) reseta o score;
    /// - ao cruzar o limiar: backoff exponencial `block_ms * 2^offenses` limitado
    ///   a `max_block_ms`, incrementa `offenses`, zera o score.
    pub fn strike(&mut self, ip: &str, weight: u64, now: u64) -> bool {
        // Loopback e ip vazio JAMAIS contam — proteção crítica do túnel público.
        if !self.enabled || ip.is_empty() || is_loopback_ip(ip) {
            return false;
        }
        // Poda oportunista para manter o mapa enxuto sem um timer dedicado.
        if self.entries.len() > PRUNE_THRESHOLD {
            self.prune(now);
        }
        // Insere entrada nova zerada quando o IP aparece pela primeira vez.
        let e = self.entries.entry(ip.to_string()).or_insert(Entry {
            window_start: now,
            score: 0,
            blocked_until: 0,
            offenses: 0,
            last_strike: now,
        });
        // Já bloqueado: não re-conta enquanto o TTL não expira.
        if now < e.blocked_until {
            return false;
        }
        // Nova janela: o histórico de pontos da janela anterior não vale mais.
        if now.saturating_sub(e.window_start) > self.window_ms {
            e.window_start = now;
            e.score = 0;
        }
        e.score = e.score.saturating_add(weight);
        e.last_strike = now;
        if e.score >= self.threshold {
            // Backoff exponencial `block_ms * 2^offenses`, limitado ao teto.
            //
            // SEGURANÇA / OVERFLOW: `2^offenses` estoura o u64 para `offenses >= 64`
            // (e a multiplicação por `block_ms` pode estourar bem antes). O JS não
            // se importa porque `2 ** offenses` vira `Infinity` e `Math.min(Inf, max)`
            // devolve o teto. Aqui reproduzimos o MESMO resultado sem pânico: quando
            // o shift OU a multiplicação transbordam, o valor real seria >> teto, então
            // saturamos direto em `max_block_ms`. Como o teto (6h) é cruzado já em
            // `offenses >= 6` com os defaults, a região de overflow está SEMPRE dentro
            // da região já clampada — o resultado é idêntico ao do JS.
            let factor = 1u64.checked_shl(e.offenses); // 2^offenses; None se offenses >= 64
            let dur = match factor.and_then(|f| self.block_ms.checked_mul(f)) {
                Some(v) => v.min(self.max_block_ms),
                None => self.max_block_ms,
            };
            e.blocked_until = now.saturating_add(dur);
            e.offenses = e.offenses.saturating_add(1);
            e.score = 0;
            self.total_blocks = self.total_blocks.saturating_add(1);
            return true;
        }
        false
    }

    /// `true` se o IP está bloqueado AGORA (a resposta deve ser 429/403). Loopback
    /// nunca bloqueia. Portado de `src/node/guard.js:56`.
    pub fn blocked(&self, ip: &str, now: u64) -> bool {
        if !self.enabled || ip.is_empty() || is_loopback_ip(ip) {
            return false;
        }
        match self.entries.get(ip) {
            Some(e) => now < e.blocked_until,
            None => false,
        }
    }

    /// Admin: desbloqueio manual. Retorna `true` se havia entrada para o IP
    /// (equivale ao `Map.delete` do JS). Reversibilidade explícita.
    pub fn clear(&mut self, ip: &str) -> bool {
        self.entries.remove(ip).is_some()
    }

    /// Poda entradas sem bloqueio ativo e antigas (mantém o mapa enxuto).
    /// Portado de `src/node/guard.js:65`: remove quando o bloqueio já expirou
    /// (`now >= blocked_until`) E o último strike é mais velho que a janela.
    pub fn prune(&mut self, now: u64) {
        self.entries.retain(|_ip, e| {
            let expirado_e_velho =
                now >= e.blocked_until && now.saturating_sub(e.last_strike) > self.window_ms;
            // `retain` MANTÉM quando o predicado é true — invertemos a condição de remoção.
            !expirado_e_velho
        });
    }

    /// Observabilidade (GET /guard): lista de bloqueios ativos + contadores.
    /// Portado de `src/node/guard.js:72`. A lista sai ordenada por `until` DESC.
    pub fn snapshot(&self, now: u64) -> GuardSnapshot {
        let mut active: Vec<BlockedIp> = self
            .entries
            .iter()
            .filter(|(_ip, e)| now < e.blocked_until)
            .map(|(ip, e)| BlockedIp {
                ip: ip.clone(),
                until: e.blocked_until,
                remaining_ms: e.blocked_until - now, // now < blocked_until garante não-negativo
                offenses: e.offenses,
            })
            .collect();
        // Ordena por `until` DECRESCENTE (o mais distante de expirar vem primeiro),
        // igual ao `sort((a, b) => b.until - a.until)` do JS.
        active.sort_by_key(|e| std::cmp::Reverse(e.until));
        GuardSnapshot {
            enabled: self.enabled,
            threshold: self.threshold,
            window_ms: self.window_ms,
            block_ms: self.block_ms,
            total_blocks: self.total_blocks,
            active_blocks: active.len(),
            blocked: active,
            at: now,
        }
    }
}

// ------------------------------------------------------------------- testes

#[cfg(test)]
mod tests {
    use super::*;

    fn guard() -> AbuseGuard {
        AbuseGuard::new(GuardConfig::default())
    }

    #[test]
    fn acumula_strikes_ate_o_limiar_e_bloqueia() {
        let mut g = guard();
        let now = 1_000_000;
        // threshold=40; 39 strikes de peso 1 não disparam.
        for _ in 0..39 {
            assert!(!g.strike("1.2.3.4", 1, now));
        }
        assert!(!g.blocked("1.2.3.4", now));
        // O 40º dispara.
        assert!(g.strike("1.2.3.4", 1, now));
        assert!(g.blocked("1.2.3.4", now));
    }

    #[test]
    fn peso_maior_dispara_mais_rapido() {
        let mut g = guard();
        let now = 5_000;
        // peso 3 (tx inválida): 13*3=39 < 40, 14*3=42 >= 40.
        for _ in 0..13 {
            assert!(!g.strike("9.9.9.9", 3, now));
        }
        assert!(g.strike("9.9.9.9", 3, now));
    }

    #[test]
    fn loopback_nunca_e_contado_nem_bloqueado() {
        let mut g = guard();
        let now = 1_000;
        for _ in 0..1000 {
            assert!(!g.strike("127.0.0.1", 5, now));
        }
        assert!(!g.blocked("127.0.0.1", now));
        // ::1 também é loopback (regra vive em ratelimit).
        for _ in 0..1000 {
            assert!(!g.strike("::1", 5, now));
        }
        assert!(!g.blocked("::1", now));
        // A guarda não guardou entrada nenhuma para loopback.
        assert_eq!(g.snapshot(now).active_blocks, 0);
    }

    #[test]
    fn ip_vazio_e_guarda_desligada_nunca_contam() {
        let mut g = guard();
        assert!(!g.strike("", 100, 1));
        assert!(!g.blocked("", 1));

        let mut off = AbuseGuard::new(GuardConfig {
            enabled: false,
            ..GuardConfig::default()
        });
        for _ in 0..100 {
            assert!(!off.strike("1.1.1.1", 10, 1));
        }
        assert!(!off.blocked("1.1.1.1", 1));
    }

    #[test]
    fn blocked_true_durante_e_false_apos_expirar() {
        let mut g = guard();
        let now = 100_000;
        for _ in 0..40 {
            g.strike("2.2.2.2", 1, now);
        }
        assert!(g.blocked("2.2.2.2", now));
        // Ainda bloqueado 1ms antes do fim (block_ms = 10min).
        assert!(g.blocked("2.2.2.2", now + DEFAULT_BLOCK_MS - 1));
        // Exatamente no `until`: `now < blocked_until` é false -> liberado.
        assert!(!g.blocked("2.2.2.2", now + DEFAULT_BLOCK_MS));
        assert!(!g.blocked("2.2.2.2", now + DEFAULT_BLOCK_MS + 1));
    }

    #[test]
    fn backoff_dobra_na_reincidencia() {
        let mut g = guard();
        let mut now = 1_000_000;
        // 1ª ofensa: block_ms * 2^0 = 10min.
        for _ in 0..40 {
            g.strike("3.3.3.3", 1, now);
        }
        let e1 = g.entries.get("3.3.3.3").unwrap().clone();
        assert_eq!(e1.blocked_until - now, DEFAULT_BLOCK_MS);
        assert_eq!(e1.offenses, 1);

        // Avança para depois do bloqueio e reincide: 2ª ofensa = 20min.
        now = e1.blocked_until + 1;
        for _ in 0..40 {
            g.strike("3.3.3.3", 1, now);
        }
        let e2 = g.entries.get("3.3.3.3").unwrap().clone();
        assert_eq!(e2.blocked_until - now, DEFAULT_BLOCK_MS * 2);
        assert_eq!(e2.offenses, 2);

        // 3ª ofensa = 40min.
        now = e2.blocked_until + 1;
        for _ in 0..40 {
            g.strike("3.3.3.3", 1, now);
        }
        let e3 = g.entries.get("3.3.3.3").unwrap().clone();
        assert_eq!(e3.blocked_until - now, DEFAULT_BLOCK_MS * 4);
    }

    #[test]
    fn backoff_satura_no_teto_sem_overflow() {
        let mut g = guard();
        let mut now: u64 = 10_000_000;
        // Força offenses MUITO alto (40+) para exercitar a região de overflow do
        // shift/mul. Sem saturação isto entraria em pânico ('attempt to shift left
        // with overflow' / 'multiply with overflow').
        for _ in 0..70 {
            for _ in 0..40 {
                g.strike("4.4.4.4", 1, now);
            }
            let e = g.entries.get("4.4.4.4").unwrap().clone();
            let dur = e.blocked_until - now;
            // Nunca ultrapassa o teto de 6h.
            assert!(dur <= DEFAULT_MAX_BLOCK_MS);
            now = e.blocked_until + 1;
        }
        // Com offenses >= 6 (default), a duração está travada no teto exato.
        let e = g.entries.get("4.4.4.4").unwrap().clone();
        assert!(e.offenses >= 64, "offenses deve ter passado de 64 no laço");
        // Reincide mais uma vez já com offenses > 64 (shift retorna None): teto.
        for _ in 0..40 {
            g.strike("4.4.4.4", 1, now);
        }
        let ef = g.entries.get("4.4.4.4").unwrap().clone();
        assert_eq!(ef.blocked_until - now, DEFAULT_MAX_BLOCK_MS);
    }

    #[test]
    fn nova_janela_reseta_o_score() {
        let mut g = guard();
        let now = 1_000_000;
        // 39 pontos, sem bloqueio.
        for _ in 0..39 {
            g.strike("5.5.5.5", 1, now);
        }
        // Passa da janela (60s): o score reseta antes de somar este strike.
        let depois = now + DEFAULT_WINDOW_MS + 1;
        assert!(!g.strike("5.5.5.5", 1, depois));
        let e = g.entries.get("5.5.5.5").unwrap().clone();
        assert_eq!(e.score, 1); // só o strike da nova janela
        assert_eq!(e.window_start, depois);
        assert!(!g.blocked("5.5.5.5", depois));
    }

    #[test]
    fn dentro_da_janela_nao_reseta() {
        let mut g = guard();
        let now = 1_000_000;
        for _ in 0..39 {
            g.strike("6.6.6.6", 1, now);
        }
        // Exatamente no limite da janela: `now - window_start > window_ms` é false
        // quando a diferença é IGUAL a window_ms (o JS usa `>`).
        let no_limite = now + DEFAULT_WINDOW_MS;
        assert!(g.strike("6.6.6.6", 1, no_limite)); // 40 -> dispara
    }

    #[test]
    fn prune_remove_velhos_sem_bloqueio() {
        let mut g = guard();
        let now = 1_000_000;
        // IP com pontos mas sem bloqueio.
        g.strike("7.7.7.7", 1, now);
        // IP bloqueado.
        for _ in 0..40 {
            g.strike("8.8.8.8", 1, now);
        }
        // Poda num instante além da janela do primeiro, mas ainda dentro do bloqueio
        // do segundo: só o primeiro sai.
        let t = now + DEFAULT_WINDOW_MS + 1;
        g.prune(t);
        assert!(!g.entries.contains_key("7.7.7.7"));
        assert!(g.entries.contains_key("8.8.8.8"));

        // Bem depois do bloqueio expirar e da janela do último strike: sai também.
        let t2 = now + DEFAULT_MAX_BLOCK_MS + DEFAULT_WINDOW_MS + 1;
        g.prune(t2);
        assert!(!g.entries.contains_key("8.8.8.8"));
    }

    #[test]
    fn snapshot_ordena_por_until_desc() {
        let mut g = guard();
        // Bloqueia três IPs em instantes distintos -> `until` distintos.
        let t_a = 1_000;
        for _ in 0..40 {
            g.strike("10.0.0.1", 1, t_a);
        }
        let t_b = 2_000;
        for _ in 0..40 {
            g.strike("10.0.0.2", 1, t_b);
        }
        let t_c = 3_000;
        for _ in 0..40 {
            g.strike("10.0.0.3", 1, t_c);
        }
        // Todos com a mesma duração (1ª ofensa), então `until` cresce com o `now`.
        let snap = g.snapshot(4_000);
        assert_eq!(snap.active_blocks, 3);
        // Ordenado por until DESC: o bloqueado por último (t_c) tem o maior until.
        assert_eq!(snap.blocked[0].ip, "10.0.0.3");
        assert_eq!(snap.blocked[1].ip, "10.0.0.2");
        assert_eq!(snap.blocked[2].ip, "10.0.0.1");
        assert!(snap.blocked[0].until >= snap.blocked[1].until);
        assert!(snap.blocked[1].until >= snap.blocked[2].until);
        assert_eq!(snap.total_blocks, 3);
        assert!(snap.enabled);
    }

    #[test]
    fn clear_desbloqueia_manualmente() {
        let mut g = guard();
        let now = 500;
        for _ in 0..40 {
            g.strike("11.11.11.11", 1, now);
        }
        assert!(g.blocked("11.11.11.11", now));
        assert!(g.clear("11.11.11.11"));
        assert!(!g.blocked("11.11.11.11", now));
        // Segundo clear não encontra nada.
        assert!(!g.clear("11.11.11.11"));
    }

    #[test]
    fn ja_bloqueado_nao_re_conta() {
        let mut g = guard();
        let now = 1_000;
        for _ in 0..40 {
            g.strike("12.12.12.12", 1, now);
        }
        let e = g.entries.get("12.12.12.12").unwrap().clone();
        assert_eq!(e.score, 0); // zerado ao bloquear
        // Strikes durante o bloqueio não mexem em nada e retornam false.
        assert!(!g.strike("12.12.12.12", 100, now + 1));
        let e2 = g.entries.get("12.12.12.12").unwrap().clone();
        assert_eq!(e2.score, 0);
        assert_eq!(e2.offenses, e.offenses);
    }
}
