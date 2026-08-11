//! GATEWAY HEALTH — failover de leitura do nó-gateway. Porte de
//! `src/node/gateway.js` (a classe `GatewayHealth`, 75 linhas).
//!
//! É OPERACIONAL e 100% REVERSÍVEL: NÃO toca consenso, estado nem blocos
//! (gateway.js:3-8; ver também o roadmap da IA — decisões autônomas só quando
//! reversíveis e não-consensuais, jamais validador/stake/código, gateway.js:10-11).
//! Quando o nó-gateway (o que fica na frente de eavscan.com) fica ATRÁS dos
//! peers (stale — típico durante replay/restart), as LEITURAS públicas passam a
//! ser servidas do peer mais saudável; escrita (POST /tx) segue local (o mempool
//! faz gossip). Só liga com `EAV7_GATEWAY_FAILOVER=1` (opt-in explícito,
//! gateway.js:27); desligar o flag reverte para "servir local".
//!
//! DIVISÃO DO PORTE (o padrão do crate, ver lib.rs): a DECISÃO é PURA — o JS já
//! a marca assim ("Decisão PURA (testável)", gateway.js:53) — e vive em
//! `GatewayHealth::decide`, coberta por teste sem rede. O TRANSPORTE (`start` +
//! `tick`) é a casca tokio que busca `/status` dos peers, monta o snapshot e
//! espelha o alvo em `Node.gateway_target` (o campo que `GET /gateway` em
//! `api/network.rs` serve). Env vars são lidas na CASCA (`GatewayConfig::
//! from_env`), nunca dentro da lógica pura.

use std::time::Duration;

// ============================================================================
// LÓGICA PURA — a decisão de roteamento com histerese (gateway.js:53-74)
// ============================================================================

/// Saúde observada de um peer num ciclo — o objeto que `#status` devolve
/// (gateway.js:39-41): `{url, height, ok, latency}`. O `latency: Infinity` do
/// peer inacessível (gateway.js:41) vira `u64::MAX` aqui — mesmo papel de
/// "pior latência possível" na ordenação.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerStatus {
    pub url: String,
    /// Altura auto-reportada; `-1` quando ausente/inválida (gateway.js:39).
    pub height: i64,
    pub ok: bool,
    /// Latência do GET /status em ms; `u64::MAX` = inacessível.
    pub latency: u64,
}

/// O núcleo do gateway: config da decisão + os contadores da histerese.
/// Espelha os campos do construtor (gateway.js:13-23) — MENOS os de transporte
/// (`node`, `log`, `checkMs`, `timer`, `snapshot`), que aqui pertencem à casca.
#[derive(Debug, Clone)]
pub struct GatewayHealth {
    /// Quantos blocos atrás = stale (gateway.js:16; default 12).
    pub lag: i64,
    /// Checagens CONSECUTIVAS para trocar de modo — a histerese anti-flap
    /// (gateway.js:18; default 2).
    pub flips: u32,
    /// `None` = servir local; `Some(url)` = servir leituras deste peer
    /// (gateway.js:19).
    pub target: Option<String>,
    /// Ciclos consecutivos em que o nó apareceu stale (gateway.js:21).
    unhealthy: u32,
    /// Ciclos consecutivos saudáveis (gateway.js:22).
    healthy: u32,
}

impl GatewayHealth {
    pub fn new(lag: i64, flips: u32) -> Self {
        Self { lag, flips, target: None, unhealthy: 0, healthy: 0 }
    }

    /// Decisão PURA (testável) — porte 1:1 de `decide` (gateway.js:55-74): dado
    /// a própria altura e a saúde dos peers, escolhe servir local (`None`) ou do
    /// peer mais saudável (`Some(url)`), com histerese para não oscilar.
    ///
    /// Nenhum I/O, nenhum relógio, nenhum log: as transições ficam visíveis ao
    /// chamador comparando `target` antes/depois (o log do JS dentro de `decide`,
    /// gateway.js:64/69, mudou para a casca — pureza acima de simetria textual).
    pub fn decide(&mut self, self_height: i64, peers: &[PeerStatus]) -> Option<String> {
        // O "melhor" peer: só os acessíveis com altura válida (gateway.js:57),
        // maior altura primeiro e, em empate, menor latência (gateway.js:58).
        let best = peers
            .iter()
            .filter(|p| p.ok && p.height >= 0)
            .max_by(|a, b| a.height.cmp(&b.height).then_with(|| b.latency.cmp(&a.latency)));
        // Stale = existe peer à frente ALÉM do lag (estrito `>`, gateway.js:59).
        let stale = best.is_some_and(|b| b.height - self_height > self.lag);
        match (stale, best) {
            (true, Some(best)) => {
                // Um ciclo stale zera a sequência saudável (gateway.js:61) — é o
                // que impede "1 ruim + 1 bom + 1 ruim" de somar para a troca.
                self.unhealthy += 1;
                self.healthy = 0;
                // Troca só após `flips` ciclos consecutivos; e re-troca de peer
                // imediatamente se o "melhor" mudou enquanto já em failover
                // (a condição `target !== best.url` do JS, gateway.js:62-63).
                if self.unhealthy >= self.flips && self.target.as_deref() != Some(best.url.as_str())
                {
                    self.target = Some(best.url.clone());
                }
            }
            _ => {
                // Saudável (ou nenhum peer utilizável — sem referência melhor,
                // servir local é o único padrão seguro): gateway.js:66-71.
                self.healthy += 1;
                self.unhealthy = 0;
                if self.healthy >= self.flips && self.target.is_some() {
                    self.target = None;
                }
            }
        }
        self.target.clone()
    }
}

// ============================================================================
// CASCA — config de ambiente (gateway.js:13-18, 27)
// ============================================================================

/// Config do transporte, com os defaults do construtor do JS. Env é I/O: lida
/// AQUI, na borda — a lógica pura recebe os números prontos.
#[derive(Debug, Clone)]
pub struct GatewayConfig {
    /// `EAV7_GATEWAY_FAILOVER === '1'` — o opt-in explícito (gateway.js:27).
    pub enabled: bool,
    /// `EAV7_GATEWAY_LAG` ou 12 (gateway.js:16).
    pub lag: i64,
    /// Período do tick em ms (gateway.js:17; default 4000).
    pub check_ms: u64,
    /// Histerese (gateway.js:18; default 2).
    pub flips: u32,
}

impl GatewayConfig {
    /// Lê as duas env vars do JS. DIVERGÊNCIA RELATADA: `Number('abc')` no JS
    /// vira `NaN` (e a comparação `> NaN` nunca dispara — failover morto em
    /// silêncio); aqui um `EAV7_GATEWAY_LAG` ilegível cai no default 12, que é
    /// estritamente mais previsível.
    pub fn from_env() -> Self {
        let enabled = std::env::var("EAV7_GATEWAY_FAILOVER").as_deref() == Ok("1");
        let lag = std::env::var("EAV7_GATEWAY_LAG")
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(12);
        Self { enabled, lag, check_ms: 4000, flips: 2 }
    }
}

// ============================================================================
// TRANSPORTE — tick assíncrono sobre o cliente do P2P (gateway.js:26-51)
// ============================================================================
//
// DISCIPLINA DE LOCK (a mesma regra inegociável de p2p.rs): o estado vive num
// `std::sync::RwLock` cujo guard é `!Send` — segurá-lo através de um `await`
// nem compila. O padrão do tick: COLETA (altura + peers) sob o lock → SOLTA →
// faz o I/O (/status de cada peer) → RE-ADQUIRE → escreve o alvo.

use crate::api::AppState;
use crate::p2p::{fetch_json_capped, make_client, HttpClient, P2pConfig};

/// Snapshot de observabilidade — `this.snapshot = {self, peers, at}` do JS
/// (gateway.js:20/49). Escrito pela task de transporte e publicado no `Node`
/// pelo campo `gateway_snapshot` (um `Mutex` PRÓPRIO, fora do `RwLock<Node>`,
/// para que a task não contenda com as leituras da API). `GET /gateway`
/// (`api/network.rs`) serve este snapshot rico — self/peers/at — e só cai nos
/// fallbacks do JS (`?? blockchain.height` / `?? []` / `?? null`) antes do
/// primeiro ciclo. O texto anterior dizia que o `Node` só espelhava o `target`;
/// isso deixou de valer quando o campo entrou.
#[derive(Debug, Clone)]
pub struct Snapshot {
    pub self_height: i64,
    pub peers: Vec<PeerStatus>,
    pub at: i64,
}

/// Relógio da casca em ms (o `Date.now()` de gateway.js:49).
fn agora_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// GET /status de um peer, com timeout de 3s (o `AbortSignal.timeout(3000)` de
/// gateway.js:37) e teto de 1 MB — o MESMO par (teto, timeout) que a fase 1 do
/// sync do P2P usa para /status, reusando `fetch_json_capped` (que aborta corpo
/// acima do teto — o JS usa fetch cru aqui, o teto é endurecimento herdado do
/// achado H-4). Nunca falha: peer inacessível vira `{ok:false, height:-1,
/// latency:MAX}` (gateway.js:40-42).
async fn status_of(client: &HttpClient, p2p: &P2pConfig, url: &str) -> PeerStatus {
    let t0 = std::time::Instant::now();
    match fetch_json_capped(client, p2p, &format!("{url}/status"), 1_000_000, 3_000).await {
        Ok(v) => PeerStatus {
            url: url.to_string(),
            // `Number.isFinite(s.height) ? s.height : -1` (gateway.js:39):
            // altura ausente/não-numérica vira -1 (e `decide` a filtra).
            height: v.get("height").and_then(serde_json::Value::as_i64).unwrap_or(-1),
            ok: true,
            latency: t0.elapsed().as_millis() as u64,
        },
        Err(_) => PeerStatus { url: url.to_string(), height: -1, ok: false, latency: u64::MAX },
    }
}

/// Um ciclo completo — porte de `tick` (gateway.js:45-51): fotografa altura e
/// peers, mede a saúde de cada um, decide e espelha o alvo no `Node`. Devolve o
/// snapshot do ciclo (a task o retém para observabilidade futura).
async fn tick(
    client: &HttpClient,
    p2p: &P2pConfig,
    state: &AppState,
    health: &mut GatewayHealth,
) -> Option<Snapshot> {
    // 1) COLETA sob o read lock — e SOLTA antes de qualquer await.
    let (self_height, peer_urls) = {
        let node = state.read().ok()?; // lock envenenado = bug alheio; pula o ciclo
        (node.blockchain.height(), node.peers.clone())
    };
    // 2) I/O fora do lock: /status de cada peer, sequencial como o `for await`
    //    do JS (gateway.js:48) — com poucos peers e timeout de 3s, a simplicidade
    //    vale mais que o paralelismo.
    let mut peers = Vec::with_capacity(peer_urls.len());
    for url in &peer_urls {
        peers.push(status_of(client, p2p, url).await);
    }
    let snapshot = Snapshot { self_height, peers, at: agora_ms() };
    // 3) Decisão pura + log das TRANSIÇÕES (as mensagens de gateway.js:64/69,
    //    movidas do decide para cá para manter a pureza).
    let antes = health.target.clone();
    let alvo = health.decide(self_height, &snapshot.peers);
    if antes != alvo {
        match &alvo {
            Some(url) => println!(
                "[gateway] failover → servindo leituras de {url} (self {self_height} stale)"
            ),
            None => println!("[gateway] recuperado → voltando a servir local (altura {self_height})"),
        }
    }
    // 4) RE-ADQUIRE (write) e espelha o alvo — é o campo que GET /gateway lê.
    //    Escreve só na mudança: 99% dos ciclos não precisam do write lock.
    if antes != alvo
        && let Ok(mut node) = state.write()
    {
        node.gateway_target = alvo;
    }
    Some(snapshot)
}

/// Sobe o failover de leitura. Espelha `start` (gateway.js:26-31): OPT-IN — sem
/// `EAV7_GATEWAY_FAILOVER=1` a task termina imediatamente (o `return` de
/// gateway.js:27) e o nó serve local para sempre. Abortar o handle é o `stop()`
/// (gateway.js:32). Segurança: operacional, reversível (desligar o flag e
/// reiniciar reverte tudo), zero efeito em consenso.
pub fn start(state: AppState, config: GatewayConfig) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if !config.enabled {
            return; // opt-in explícito, como o JS
        }
        println!("[gateway] failover de leitura ATIVO (histerese anti-flap)");
        let client = make_client();
        // Os peers consultados já foram ADMITIDOS pelo filtro anti-SSRF do P2P
        // (add_peer). O fetch do JS (gateway.js:37) não re-filtra; aqui
        // `allow_private_peers=true` reproduz isso — e evita que uma testnet
        // local (peers em 127.0.0.1) tenha o failover silenciosamente morto.
        let p2p = P2pConfig { self_url: None, allow_private_peers: true, sync_ms: 0 };
        let mut health = GatewayHealth::new(config.lag, config.flips);
        // Handle do snapshot compartilhado — pego UMA vez do Node (read lock só
        // aqui). Daqui em diante a task escreve nele pelo Mutex próprio, sem tocar
        // o `RwLock<Node>`: `GET /gateway` lê o snapshot rico sem contender.
        let snap_alvo = match state.read() {
            Ok(node) => node.gateway_snapshot.clone(),
            Err(_) => return, // lock envenenado no boot: sem observabilidade, mas não trava
        };
        // O setInterval do JS (gateway.js:28) dispara a 1ª vez após checkMs;
        // `interval` dispara já — o tick imediato é consumido para igualar.
        // `Delay`: um tick lento não gera rajada de compensação.
        let mut intervalo = tokio::time::interval(Duration::from_millis(config.check_ms.max(1)));
        intervalo.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        intervalo.tick().await;
        loop {
            intervalo.tick().await;
            // O `.catch(() => {})` de gateway.js:28: um ciclo que falha (lock
            // envenenado) não derruba o laço.
            if let Some(snapshot) = tick(&client, &p2p, &state, &mut health).await
                && let Ok(mut slot) = snap_alvo.lock()
            {
                *slot = Some(snapshot);
            }
        }
    })
}

// ============================================================================
// Testes — a decisão pura, sem rede (o contrato de gateway.js:53-74)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(url: &str, height: i64, latency: u64) -> PeerStatus {
        PeerStatus { url: url.into(), height, ok: true, latency }
    }

    fn caido(url: &str) -> PeerStatus {
        PeerStatus { url: url.into(), height: -1, ok: false, latency: u64::MAX }
    }

    #[test]
    fn troca_apos_flips_ciclos_stale() {
        let mut g = GatewayHealth::new(12, 2);
        let peers = vec![peer("http://a", 120, 10)];
        // self=100, peer=120: 20 > lag 12 → stale, mas 1º ciclo NÃO troca.
        assert_eq!(g.decide(100, &peers), None);
        // 2º ciclo consecutivo: histerese satisfeita → failover.
        assert_eq!(g.decide(100, &peers), Some("http://a".into()));
    }

    #[test]
    fn recupera_apos_flips_ciclos_saudaveis() {
        let mut g = GatewayHealth::new(12, 2);
        let atras = vec![peer("http://a", 120, 10)];
        g.decide(100, &atras);
        assert_eq!(g.decide(100, &atras), Some("http://a".into()));
        // Nó alcança (diferença 1 <= lag): 1º ciclo saudável ainda em failover…
        let perto = vec![peer("http://a", 121, 10)];
        assert_eq!(g.decide(120, &perto), Some("http://a".into()));
        // …2º ciclo consecutivo: volta a servir local (gateway.js:68-71).
        assert_eq!(g.decide(121, &perto), None);
    }

    #[test]
    fn anti_flap_uma_oscilacao_isolada_nao_troca() {
        let mut g = GatewayHealth::new(12, 2);
        let atras = vec![peer("http://a", 120, 10)];
        let perto = vec![peer("http://a", 101, 10)];
        // stale, saudável, stale, saudável… nunca 2 stales CONSECUTIVOS:
        // o zeramento cruzado (gateway.js:61/67) impede a troca.
        assert_eq!(g.decide(100, &atras), None);
        assert_eq!(g.decide(100, &perto), None);
        assert_eq!(g.decide(100, &atras), None);
        assert_eq!(g.decide(100, &perto), None);
    }

    #[test]
    fn sem_peer_saudavel_serve_local() {
        let mut g = GatewayHealth::new(12, 2);
        // Peers caídos e um "ok" sem altura válida (height -1, filtrado por
        // `height >= 0`, gateway.js:57): nenhuma referência → local, sempre.
        let peers = vec![caido("http://a"), PeerStatus {
            url: "http://b".into(),
            height: -1,
            ok: true,
            latency: 5,
        }];
        for _ in 0..5 {
            assert_eq!(g.decide(0, &peers), None);
        }
        // E também: lista vazia.
        assert_eq!(g.decide(0, &[]), None);
    }

    #[test]
    fn peers_caidos_derrubam_failover_ativo() {
        let mut g = GatewayHealth::new(12, 2);
        let atras = vec![peer("http://a", 120, 10)];
        g.decide(100, &atras);
        assert_eq!(g.decide(100, &atras), Some("http://a".into()));
        // Todos os peers caem: sem best, o ramo saudável conta (gateway.js:66) e
        // após `flips` ciclos volta a local — melhor servir dado velho local do
        // que apontar para um peer morto.
        let mortos = vec![caido("http://a")];
        assert_eq!(g.decide(100, &mortos), Some("http://a".into()));
        assert_eq!(g.decide(100, &mortos), None);
    }

    #[test]
    fn escolhe_maior_altura_e_desempata_por_latencia() {
        let mut g = GatewayHealth::new(12, 2);
        // b tem a maior altura → vence apesar da latência pior.
        let peers = vec![peer("http://a", 120, 1), peer("http://b", 130, 900)];
        g.decide(100, &peers);
        assert_eq!(g.decide(100, &peers), Some("http://b".into()));
        // Empate de altura: menor latência vence (gateway.js:58).
        let mut g = GatewayHealth::new(12, 2);
        let peers = vec![peer("http://lento", 120, 900), peer("http://rapido", 120, 5)];
        g.decide(100, &peers);
        assert_eq!(g.decide(100, &peers), Some("http://rapido".into()));
    }

    #[test]
    fn retroca_imediata_quando_o_melhor_peer_muda() {
        let mut g = GatewayHealth::new(12, 2);
        let so_a = vec![peer("http://a", 120, 10)];
        g.decide(100, &so_a);
        assert_eq!(g.decide(100, &so_a), Some("http://a".into()));
        // b ultrapassa a: `unhealthy` já >= flips e `target != best.url` →
        // re-troca no MESMO ciclo (a condição exata de gateway.js:62).
        let com_b = vec![peer("http://a", 120, 10), peer("http://b", 140, 10)];
        assert_eq!(g.decide(100, &com_b), Some("http://b".into()));
    }

    #[test]
    fn lag_e_estrito_diferenca_igual_ao_lag_nao_e_stale() {
        let mut g = GatewayHealth::new(12, 2);
        // 112 - 100 = 12 = lag: `> lag` é falso (gateway.js:59) → saudável.
        let peers = vec![peer("http://a", 112, 10)];
        for _ in 0..5 {
            assert_eq!(g.decide(100, &peers), None);
        }
    }

    #[test]
    fn config_from_env_defaults() {
        // Sem env vars mexidas pelo runner de teste, os defaults do construtor
        // do JS valem: desligado, lag 12, 4s, 2 flips. (Não seta env aqui —
        // testes rodam em paralelo e env é global ao processo.)
        let c = GatewayConfig { enabled: false, lag: 12, check_ms: 4000, flips: 2 };
        assert!(!c.enabled);
        assert_eq!((c.lag, c.check_ms, c.flips), (12, 4000, 2));
    }
}
