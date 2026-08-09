//! P2P da EAV7 sobre HTTP — porte de `src/node/p2p.js`.
//!
//! Este arquivo tem as duas camadas do módulo, na mesma divisão do resto do
//! crate: a LÓGICA PURA (normalização de URL, classificação de IP privado,
//! busca do ancestral comum) vive aqui em cima, sem I/O e coberta por teste; o
//! TRANSPORTE (cliente HTTP, gossip, sync) é montado sobre ela.
//!
//! A parte pura é SEGURANÇA: o filtro anti-SSRF é o que impede um peer
//! malicioso de fazer este nó falar com serviços internos (metadata de nuvem,
//! loopback, rede privada). O detalhe que importa — e que originou o achado L3
//! da auditoria — é que IPv4 tem formas NÃO-canônicas (`2130706433`,
//! `0177.0.0.1`, `0x7f.0.0.1`) que resolvem para 127.0.0.1 e escapariam de um
//! filtro literal ingênuo. A normalização abaixo fecha exatamente isso.

use std::collections::BTreeMap;

// ---------------------------------------------------------------- URL

/// Normaliza uma URL de peer: exige esquema http/https, valida a forma e corta
/// barras finais. `None` = peer inválido. Espelha `normalize` (p2p.js:233).
pub fn normalize_url(url: &str) -> Option<String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return None;
    }
    // Validação estrutural mínima sem crate de URL: precisa ter host não vazio
    // depois do esquema. (O JS usa `new URL`; aqui a estrutura que o transporte
    // consome é `host[:porta][/caminho]`, e `host_of` rejeita o resto.)
    host_of(url)?;
    Some(url.trim_end_matches('/').to_string())
}

/// O hostname de uma URL http(s), minúsculo, sem colchetes de IPv6.
/// `None` se a URL não tem host reconhecível.
pub fn host_of(url: &str) -> Option<String> {
    let sem_esquema = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://"))?;
    let autoridade = sem_esquema.split(['/', '?', '#']).next()?;
    // Sem credenciais na URL: `user@host` é vetor de confusão de parser — o JS
    // aceitaria via `new URL`, mas nenhum peer legítimo da malha usa userinfo, e
    // rejeitar aqui é estritamente mais seguro que interpretar.
    if autoridade.is_empty() || autoridade.contains('@') {
        return None;
    }
    // IPv6 entre colchetes: `[::1]:6070`.
    if let Some(resto) = autoridade.strip_prefix('[') {
        let fim = resto.find(']')?;
        return Some(resto[..fim].to_ascii_lowercase());
    }
    // `host:porta` — corta a porta. (Um IPv6 sem colchetes não é URL válida.)
    let host = autoridade.split(':').next()?;
    if host.is_empty() {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

// ---------------------------------------------------------------- IP privado

/// Classifica um quad IPv4 como privado/loopback/link-local. `p2p.js:246`.
fn is_private_v4(a: u8, b: u8) -> bool {
    if a == 127 || a == 10 || a == 0 {
        return true;
    }
    if a == 169 && b == 254 {
        return true; // link-local / metadata cloud
    }
    if a == 172 && (16..=31).contains(&b) {
        return true;
    }
    a == 192 && b == 168
}

/// Normaliza formas NÃO-canônicas de IPv4 (inteiro `2130706433`, octal
/// `0177.0.0.1`, hex `0x7f.0.0.1`) para o quad `[a,b,c,d]`. `None` se não for
/// IPv4. Sem isso, `http://2130706433/` (= 127.0.0.1) escaparia do filtro
/// literal — o achado L3. Espelha `normalizeV4` (p2p.js:257).
fn normalize_v4(host: &str) -> Option<[u8; 4]> {
    fn parse_num(s: &str) -> Option<u64> {
        if let Some(hexa) = s.strip_prefix("0x") {
            if hexa.is_empty() || !hexa.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            return u64::from_str_radix(hexa, 16).ok();
        }
        if s.len() > 1 && s.starts_with('0') && s.bytes().all(|b| (b'0'..=b'7').contains(&b)) {
            return u64::from_str_radix(s, 8).ok();
        }
        if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) {
            return s.parse().ok();
        }
        None
    }
    let partes: Vec<&str> = host.split('.').collect();
    match partes.len() {
        1 => {
            let n = parse_num(partes[0])?;
            if n > 0xffff_ffff {
                return None;
            }
            let n = n as u32;
            Some([(n >> 24) as u8, (n >> 16) as u8, (n >> 8) as u8, n as u8])
        }
        4 => {
            let mut quad = [0u8; 4];
            for (i, p) in partes.iter().enumerate() {
                let n = parse_num(p)?;
                if n > 255 {
                    return None;
                }
                quad[i] = n as u8;
            }
            Some(quad)
        }
        _ => None,
    }
}

/// IP literal em faixa privada/loopback/link-local (inclui metadata de nuvem e
/// IPv4 embutido em IPv6). Espelha `isPrivateIp` (p2p.js:279).
pub fn is_private_ip(ip: &str) -> bool {
    let host = ip.to_ascii_lowercase();
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if let Some([a, b, _, _]) = normalize_v4(host) {
        return is_private_v4(a, b);
    }
    if host == "::1" || host == "::" {
        return true;
    }
    // ULA fc00::/7 (fc, fd) e link-local fe80::/10 (fe8..feb, não só fe8).
    if host.starts_with("fc") || host.starts_with("fd") {
        return true;
    }
    if host.len() >= 3 && host.starts_with("fe") && matches!(host.as_bytes()[2], b'8' | b'9' | b'a' | b'b')
    {
        return true;
    }
    // IPv4 mapeado/compatível em IPv6: ::ffff:a.b.c.d, ::ffff:7f00:1, ::a.b.c.d
    if let Some(cauda) = host.strip_prefix("::").map(|c| c.strip_prefix("ffff:").unwrap_or(c)) {
        if cauda.contains('.') {
            return is_private_ip(cauda);
        }
        let pedacos: Vec<&str> = cauda.split(':').collect();
        if pedacos.len() == 2
            && pedacos.iter().all(|p| {
                !p.is_empty() && p.len() <= 4 && p.bytes().all(|b| b.is_ascii_hexdigit())
            })
            && let Ok(alto) = u16::from_str_radix(pedacos[0], 16)
        {
            // Os dois octetos mais altos do IPv4 embutido decidem a faixa.
            return is_private_v4((alto >> 8) as u8, (alto & 0xff) as u8);
        }
    }
    false
}

/// Hostnames locais e IPs literais privados, ANTES da resolução DNS.
/// Espelha `isPrivateHost` (p2p.js:300). URL sem host reconhecível é PRIVADA
/// (falha fechada), como o `catch { return true }` do JS.
pub fn is_private_host(url: &str) -> bool {
    let Some(host) = host_of(url) else {
        return true;
    };
    if host == "localhost" || host == "0.0.0.0" || host.ends_with(".local") {
        return true;
    }
    is_private_ip(&host)
}

// ---------------------------------------------------------------- sync puro

/// Acha o ancestral comum entre a nossa cadeia e a janela `[from..]` baixada do
/// peer: a MAIOR altura cujo hash local coincide com o do peer. `None` = nenhum
/// hash da janela bate (fork mais fundo que a janela — irrecuperável por reorg).
/// Espelha o laço de p2p.js:185-188, como função pura para o teste alcançar.
pub fn common_ancestor(
    local_hash_at: &BTreeMap<u64, String>,
    janela: &[(u64, String)],
) -> Option<u64> {
    for (altura, hash_peer) in janela.iter().rev() {
        if local_hash_at.get(altura).is_some_and(|h| h == hash_peer) {
            return Some(*altura);
        }
    }
    None
}

// ============================================================================
// TRANSPORTE — cliente HTTP, gossip e sincronização (p2p.js:1-231)
// ============================================================================
//
// A camada abaixo é o P2P "vivo": registro mútuo de peers, gossip de transações
// e blocos, e o laço de sincronização pela cadeia válida mais longa. Ela é
// montada SOBRE a lógica pura acima — todo filtro de segurança (SSRF, DNS
// rebinding) passa pelas mesmas funções testadas.
//
// DISCIPLINA DE LOCK (a regra inegociável deste arquivo): o estado do nó vive
// num `std::sync::RwLock` — deliberadamente NÃO o do tokio (ver api/mod.rs). O
// guard é `!Send`, então segurá-lo através de um `await` nem compila num task
// tokio. O padrão em todo lugar é: COLETA o que precisa sob o lock → SOLTA →
// faz o I/O → RE-ADQUIRE → RE-CHECA e aplica. As re-checagens não são paranoia:
// entre soltar e re-adquirir, outro request (API, outro peer) pode ter mudado a
// cadeia ou a lista de peers.

use std::sync::Arc;
use std::time::Duration;

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;

use eav7::block::block_from_json;
use eav7::blockchain::Reorg;
use eav7::config::{MAX_CHAIN_PAGE, MAX_PEERS, MAX_SYNC_BLOCKS, MAX_SYNC_PAGE_BYTES, REORG_WINDOW};
use eav7::transaction::{parse_json, JsonValue};

use crate::api::AppState;

/// Cliente HTTP do P2P: a pilha legacy do hyper-util sobre `HttpConnector` —
/// mesma família do axum que já serve a API, nenhum ecossistema novo. `Clone` é
/// barato (pool compartilhado), o que permite gossip fire-and-forget em tasks.
pub type HttpClient = Client<HttpConnector, Full<Bytes>>;

/// Constrói o cliente compartilhado do transporte.
pub fn make_client() -> HttpClient {
    Client::builder(TokioExecutor::new()).build_http()
}

/// Configuração do transporte — o espelho dos parâmetros do construtor do JS
/// (p2p.js:7): `selfUrl`, `allowPrivatePeers` e `syncMs`.
#[derive(Debug, Clone)]
pub struct P2pConfig {
    /// URL pública deste nó (para não se auto-adicionar e para o `register`).
    pub self_url: Option<String>,
    /// Escape hatch do operador (dev/testnet/nós co-locados): dispensa TODOS os
    /// filtros anti-SSRF. Na mainnet fica `false` (padrão do JS).
    pub allow_private_peers: bool,
    /// Período do laço de sincronização, em ms (JS: 5000).
    pub sync_ms: u64,
}

/// Relógio local em ms — parâmetro dos métodos de consenso da lib (`add_block`,
/// `reorg`, `replace_chain` recebem `now` de fora para serem testáveis).
fn agora_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

/// Campo string de um `JsonValue::Map` — para espiar `previousHash`/`hash` dos
/// blocos crus sem convertê-los para `Block` antes da hora.
fn campo_str<'a>(v: &'a JsonValue, chave: &str) -> Option<&'a str> {
    match v {
        JsonValue::Map(m) => match m.get(chave) {
            Some(JsonValue::Str(s)) => Some(s.as_str()),
            _ => None,
        },
        _ => None,
    }
}

// ---------------------------------------------------------------- add_peer

/// Adiciona um peer à malha. Espelha `addPeer` (p2p.js:24-41).
///
/// `trusted` = seed passado pelo operador (`--peers`): pode ser loopback/privado
/// para redes locais de desenvolvimento. Peers de fontes NÃO confiáveis
/// (POST /peers, listas de outros peers) passam pelo filtro anti-SSRF completo:
/// além do hostname literal (`is_private_host`), o DNS é resolvido e QUALQUER IP
/// privado/loopback/link-local rejeita o peer — sem isso, um atacante registra
/// `http://meu-dominio.com` apontando para 169.254.169.254 e usa este nó como
/// proxy para a metadata da nuvem (DNS rebinding).
pub async fn add_peer(state: &AppState, config: &P2pConfig, url: &str, trusted: bool) -> bool {
    let Some(peer) = normalize_url(url) else { return false };
    // Compara contra a PRÓPRIA URL normalizada (o JS normaliza selfUrl no
    // construtor; aqui normalizamos na comparação para não depender do chamador).
    if config.self_url.as_deref().and_then(normalize_url).as_deref() == Some(peer.as_str()) {
        return false;
    }
    // Checagem rápida de duplicado/teto sob o lock — e SOLTA antes de qualquer
    // await (a resolução DNS abaixo pode demorar segundos).
    {
        let Ok(node) = state.read() else { return false };
        if node.peers.iter().any(|p| p == &peer) || node.peers.len() as u64 >= MAX_PEERS {
            return false;
        }
    }
    if !trusted && !config.allow_private_peers {
        if is_private_host(&peer) {
            return false;
        }
        let Some(host) = host_of(&peer) else { return false };
        // A porta 80 é só para satisfazer a API do resolvedor — o que interessa
        // são os IPs. `lookup_host` com IP literal devolve o próprio IP.
        let addrs: Vec<std::net::SocketAddr> =
            match tokio::net::lookup_host((host.as_str(), 80u16)).await {
                Ok(it) => it.collect(),
                Err(_) => return false, // não resolve => não conecta (p2p.js:35)
            };
        if addrs.is_empty() || addrs.iter().any(|a| is_private_ip(&a.ip().to_string())) {
            return false;
        }
    }
    // Re-checa duplicado/teto: o lock ficou solto durante o DNS e outro caminho
    // (API, outro add_peer) pode ter preenchido a vaga — o JS faz o mesmo re-check
    // pós-await (p2p.js:37).
    let Ok(mut node) = state.write() else { return false };
    if node.peers.iter().any(|p| p == &peer) || node.peers.len() as u64 >= MAX_PEERS {
        return false;
    }
    node.peers.push(peer.clone());
    println!("[p2p] novo peer: {peer}");
    true
}

// ---------------------------------------------------------------- guard TOCTOU

/// Revalida, ANTES de cada fetch, que o peer não resolve para um alvo privado.
/// Espelha `#guardPeer` (p2p.js:91-103).
///
/// Fecha a janela TOCTOU do DNS rebinding (achado H-3): o peer passa no filtro
/// do `add_peer` e DEPOIS reaponta o DNS para um alvo interno — sem esta
/// re-checagem imediatamente antes do request, o filtro de admissão seria
/// decorativo. (A resolução aqui e a conexão do hyper são resoluções separadas,
/// então uma janela mínima resta — a mesma do JS, cujo fetch também re-resolve;
/// o que o guard elimina é o rebinding "lento" entre admissão e uso.)
pub async fn guard_peer(config: &P2pConfig, url: &str) -> Result<(), String> {
    // Escape hatch explícito do operador (dev/testnet/nós co-locados por
    // localhost) — sem ele o gossip entre nós na mesma máquina nunca funciona.
    // Na mainnet allow_private_peers é false e o guard segue ativo (p2p.js:96).
    if config.allow_private_peers {
        return Ok(());
    }
    if is_private_host(url) {
        return Err("peer resolve para host privado".into());
    }
    let host = host_of(url).ok_or_else(|| "peer sem host reconhecível".to_string())?;
    // Só re-resolve HOSTNAMES: um IP literal já foi classificado acima e não
    // tem DNS para rebindar (p2p.js:99 — `!/^[\d.]+$/` e sem `:`).
    let literal_v4 = !host.is_empty() && host.bytes().all(|b| b.is_ascii_digit() || b == b'.');
    let literal_v6 = host.contains(':');
    if !literal_v4 && !literal_v6 {
        let addrs: Vec<std::net::SocketAddr> =
            match tokio::net::lookup_host((host.as_str(), 80u16)).await {
                Ok(it) => it.collect(),
                Err(_) => return Err("peer não resolve".into()),
            };
        if addrs.is_empty() || addrs.iter().any(|a| is_private_ip(&a.ip().to_string())) {
            return Err("peer resolve para IP privado (possível rebinding)".into());
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- fetch capped

/// GET com TETO de bytes, devolvendo o corpo como TEXTO. Núcleo do
/// `#fetchJsonCapped` (p2p.js:107-126) — separado em "texto" porque os BLOCOS
/// baixados do peer são parseados com o parser canônico da lib
/// (`eav7::transaction::parse_json`), nunca com serde no caminho de consenso.
///
/// O teto é o achado H-4: sem ele, um peer malicioso responde um corpo gigante
/// e a materialização (`collect()`/`.json()`) estoura a memória do nó (OOM).
/// Por isso o corpo é lido FRAME A FRAME, somando bytes e ABORTANDO no momento
/// em que o teto é excedido — o corpo nunca é materializado sem limite. O
/// content-length declarado é checado antes, como atalho barato, mas não basta:
/// resposta chunked não declara tamanho.
pub async fn fetch_text_capped(
    client: &HttpClient,
    config: &P2pConfig,
    url: &str,
    max_bytes: u64,
    timeout_ms: u64,
) -> Result<String, String> {
    fetch_text_capped_com(client, config, url, max_bytes, timeout_ms, &[]).await
}

/// Como [`fetch_text_capped`], com CABEÇALHOS extras na requisição.
///
/// Existe por causa do `x-eav7-proxied` do proxy de leitura (`api.js:194`): sem
/// ele, dois nós em failover apontando um para o outro devolveriam a mesma
/// requisição em laço até estourar o timeout de ambos. O header é a única coisa
/// que corta o ciclo, então precisa CHEGAR ao peer — um `client.get` puro o
/// descartaria em silêncio.
pub async fn fetch_text_capped_com(
    client: &HttpClient,
    config: &P2pConfig,
    url: &str,
    max_bytes: u64,
    timeout_ms: u64,
    cabecalhos: &[(&str, &str)],
) -> Result<String, String> {
    // Anti-rebinding ANTES de cada fetch (H-3), como o JS (p2p.js:108).
    guard_peer(config, url).await?;
    let uri: hyper::Uri = url.parse().map_err(|_| format!("URL inválida: {url}"))?;
    let mut req = hyper::Request::builder().method("GET").uri(uri);
    for (nome, valor) in cabecalhos {
        req = req.header(*nome, *valor);
    }
    let req = req
        .body(Full::new(Bytes::new()))
        .map_err(|e| format!("requisição malformada: {e}"))?;
    let leitura = async {
        let res = client.request(req).await.map_err(|e| format!("falha ao contactar peer: {e}"))?;
        let declarado = res
            .headers()
            .get(hyper::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        if declarado > max_bytes {
            // Nem começa a ler: o próprio header já confessa o estouro
            // (p2p.js:110 — cancela o corpo e lança).
            return Err("resposta do peer excede o limite de bytes".to_string());
        }
        // ABORTA no teto (o ponto do H-4, p2p.js:122): ver `ler_corpo_capped`.
        ler_corpo_capped(res.into_body(), max_bytes).await
    };
    // Timeout sobre request + leitura do corpo inteira, como o AbortSignal do
    // fetch do JS (que cobre a conexão E o reader).
    tokio::time::timeout(Duration::from_millis(timeout_ms), leitura)
        .await
        .map_err(|_| "timeout do peer".to_string())?
}

/// Resposta de um peer com STATUS e `content-type` preservados.
///
/// Existe para o proxy de leitura do gateway: repassar só o corpo transformava
/// todo `404`/`400` do peer num `200` deste nó, e o cliente que ramifica por
/// `res.ok` passava a tratar "não encontrado" como sucesso — exatamente durante o
/// failover, quando o operador acredita que a recuperação está funcionando.
pub struct RespostaPeer {
    pub status: u16,
    pub content_type: Option<String>,
    pub corpo: String,
}

/// Como [`fetch_text_capped_com`], mas devolvendo o desfecho HTTP inteiro.
pub async fn fetch_resposta_capped_com(
    client: &HttpClient,
    config: &P2pConfig,
    url: &str,
    max_bytes: u64,
    timeout_ms: u64,
    cabecalhos: &[(&str, &str)],
) -> Result<RespostaPeer, String> {
    guard_peer(config, url).await?;
    let uri: hyper::Uri = url.parse().map_err(|_| format!("URL inválida: {url}"))?;
    let mut req = hyper::Request::builder().method("GET").uri(uri);
    for (nome, valor) in cabecalhos {
        req = req.header(*nome, *valor);
    }
    let req = req
        .body(Full::new(Bytes::new()))
        .map_err(|e| format!("requisição malformada: {e}"))?;
    let leitura = async {
        let res = client.request(req).await.map_err(|e| format!("falha ao contactar peer: {e}"))?;
        let status = res.status().as_u16();
        let content_type = res
            .headers()
            .get(hyper::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let declarado = res
            .headers()
            .get(hyper::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        if declarado > max_bytes {
            return Err("resposta do peer excede o limite de bytes".to_string());
        }
        let corpo = ler_corpo_capped(res.into_body(), max_bytes).await?;
        Ok(RespostaPeer { status, content_type, corpo })
    };
    tokio::time::timeout(Duration::from_millis(timeout_ms), leitura)
        .await
        .map_err(|_| "timeout do peer".to_string())?
}

/// Lê o corpo QUADRO A QUADRO, abortando no teto.
///
/// Abortar aqui é o ponto: soltar o corpo fecha a conexão, e o resto nunca chega
/// à memória. Bufferizar tudo e só então medir seria o mesmo que não ter teto.
async fn ler_corpo_capped(
    mut body: hyper::body::Incoming,
    max_bytes: u64,
) -> Result<String, String> {
    let mut recebido: u64 = 0;
    let mut buf: Vec<u8> = Vec::new();
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|e| format!("erro lendo corpo do peer: {e}"))?;
        if let Ok(dados) = frame.into_data() {
            recebido += dados.len() as u64;
            if recebido > max_bytes {
                return Err("resposta do peer excede o limite de bytes".to_string());
            }
            buf.extend_from_slice(&dados);
        }
    }
    String::from_utf8(buf).map_err(|_| "resposta do peer não é UTF-8".to_string())
}

/// JSON com teto, para APRESENTAÇÃO (`/status`, `/peers`): serde_json é adequado
/// aqui — nada disto é hasheado nem entra em consenso. Espelha `#fetchJsonCapped`.
pub async fn fetch_json_capped(
    client: &HttpClient,
    config: &P2pConfig,
    url: &str,
    max_bytes: u64,
    timeout_ms: u64,
) -> Result<serde_json::Value, String> {
    let texto = fetch_text_capped(client, config, url, max_bytes, timeout_ms).await?;
    serde_json::from_str(&texto).map_err(|e| format!("JSON inválido do peer: {e}"))
}

// ---------------------------------------------------------------- gossip

/// POST JSON com guard + timeout de 3s. Espelha `#post` (p2p.js:48-56). A
/// resposta é descartada — o gossip do JS também não a lê.
async fn post_json(
    client: &HttpClient,
    config: &P2pConfig,
    url: &str,
    body: String,
    header_extra: Option<(&str, &str)>,
) -> Result<(), String> {
    // Anti-rebinding antes de enviar (H-3), como p2p.js:49.
    guard_peer(config, url).await?;
    let uri: hyper::Uri = url.parse().map_err(|_| format!("URL inválida: {url}"))?;
    let mut req = hyper::Request::builder()
        .method(hyper::Method::POST)
        .uri(uri)
        .header(hyper::header::CONTENT_TYPE, "application/json");
    if let Some((k, v)) = header_extra {
        req = req.header(k, v);
    }
    let req = req
        .body(Full::new(Bytes::from(body)))
        .map_err(|e| format!("request inválido: {e}"))?;
    tokio::time::timeout(Duration::from_millis(3000), client.request(req))
        .await
        .map_err(|_| "timeout do peer".to_string())?
        .map_err(|e| format!("falha ao contactar peer: {e}"))?;
    Ok(())
}

/// Difunde um corpo para todos os peers, fire-and-forget: cada envio roda em
/// task própria e ERROS SÃO SILENCIOSAMENTE IGNORADOS — gossip é melhor-esforço,
/// um peer offline não pode atrasar nem derrubar o produtor (p2p.js:58-70, os
/// `.catch(() => {})`).
fn broadcast_to(client: &HttpClient, config: &P2pConfig, peers: &[String], path: &'static str, body: String) {
    for peer in peers {
        let client = client.clone();
        let config = config.clone();
        let url = format!("{peer}{path}");
        let body = body.clone();
        tokio::spawn(async move {
            let _ = post_json(&client, &config, &url, body, None).await;
        });
    }
}

/// Gossip de transação: POST /tx em cada peer (p2p.js:58-63). `tx_json` DEVE
/// vir serializado pelo canônico da lib — o transporte não serializa consenso.
pub fn broadcast_tx(client: &HttpClient, config: &P2pConfig, peers: &[String], tx_json: String) {
    broadcast_to(client, config, peers, "/tx", tx_json);
}

/// Gossip de bloco: POST /blocks em cada peer (p2p.js:65-70). Mesma regra: o
/// chamador passa o JSON canônico pronto.
pub fn broadcast_block(client: &HttpClient, config: &P2pConfig, peers: &[String], block_json: String) {
    broadcast_to(client, config, peers, "/blocks", block_json);
}

// ---------------------------------------------------------------- register

/// Registro mútuo com um peer. Espelha `#register` (p2p.js:72-86):
/// 1. POST /peers anunciando a nossa URL — com `x-admin-token` se configurado,
///    porque o endpoint passou a exigir admin (achado H-3: aberto era vetor de
///    poisoning da lista de peers). Nós da malha compartilham o token; peers
///    sem token não se registram (a malha legítima vem por `--peers`).
/// 2. GET /peers (teto 1 MB) e tenta adotar cada URL como peer NÃO confiável —
///    peers descobertos passam pelo filtro de IP privado inteiro.
///
/// Qualquer falha aborta em silêncio: peer offline tenta de novo no próximo sync.
pub async fn register(client: &HttpClient, config: &P2pConfig, state: &AppState, peer: &str) {
    // Coleta o token SOB o lock e solta antes de qualquer I/O.
    let admin = match state.read() {
        Ok(node) => node.admin_token.clone(),
        Err(_) => return,
    };
    let body = serde_json::json!({ "url": config.self_url }).to_string();
    let header = admin.as_deref().map(|t| ("x-admin-token", t));
    if post_json(client, config, &format!("{peer}/peers"), body, header).await.is_err() {
        return; // o try/catch do JS engole o registro inteiro (p2p.js:83)
    }
    let Ok(conhecidos) =
        fetch_json_capped(client, config, &format!("{peer}/peers"), 1_000_000, 3000).await
    else {
        return;
    };
    let Some(lista) = conhecidos.as_array() else { return };
    for url in lista {
        if let Some(u) = url.as_str() {
            // trusted = false: descobertos NÃO herdam a confiança do peer fonte.
            add_peer(state, config, u, false).await;
        }
    }
}

// ---------------------------------------------------------------- fetch_range

/// Baixa blocos `[from, ...]` de um peer, em páginas de `MAX_CHAIN_PAGE`, até
/// página vazia/incompleta ou o teto `MAX_SYNC_BLOCKS`. Espelha `#fetchRange`
/// (p2p.js:129-140).
///
/// Devolve os blocos CRUS como `JsonValue` da lib: o corpo é lido como texto e
/// parseado com `eav7::transaction::parse_json` — o parser canônico, que rejeita
/// float/estouro/chave duplicada. serde_json NUNCA toca bloco: um parser de
/// apresentação no caminho de consenso poderia aceitar (e re-arredondar) o que o
/// canônico rejeita, e o bloco re-hasheado divergiria. A conversão para `Block`
/// (`block_from_json`) fica com o sync, no ponto de aplicação.
pub async fn fetch_range(
    client: &HttpClient,
    config: &P2pConfig,
    peer: &str,
    from: u64,
) -> Result<Vec<JsonValue>, String> {
    let mut out: Vec<JsonValue> = Vec::new();
    let mut cursor = from;
    loop {
        let texto = fetch_text_capped(
            client,
            config,
            &format!("{peer}/chain?from={cursor}&limit={MAX_CHAIN_PAGE}"),
            MAX_SYNC_PAGE_BYTES,
            15_000, // o default do #fetchJsonCapped (p2p.js:107)
        )
        .await?;
        let pagina = parse_json(&texto)?;
        // Página sem `blocks` em forma de lista termina o range sem erro — o JS
        // faz `if (!Array.isArray(page?.blocks)) break` (p2p.js:134).
        let JsonValue::Map(mut mapa) = pagina else { break };
        let Some(JsonValue::List(blocos)) = mapa.remove("blocks") else { break };
        if blocos.is_empty() {
            break;
        }
        let n = blocos.len() as u64;
        out.extend(blocos);
        cursor += n;
        if n < MAX_CHAIN_PAGE || out.len() as u64 >= MAX_SYNC_BLOCKS {
            break;
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- sync

/// Um ciclo de sincronização. Espelha `syncOnce` (p2p.js:142-219).
///
/// `guarda` é a anti-reentrância: o JS usa a flag `this.syncing` (p2p.js:143) —
/// aqui um `tokio::sync::Mutex<()>` com `try_lock`, que é a mesma semântica
/// (ciclo em andamento => este retorna imediatamente) sem estado mutável solto.
/// O replay de blocos é O(blocos); dois ciclos concorrentes duplicariam trabalho
/// e log sem ganhar nada.
pub async fn sync_once(
    client: &HttpClient,
    config: &P2pConfig,
    state: &AppState,
    guarda: &tokio::sync::Mutex<()>,
) {
    let Ok(_trava) = guarda.try_lock() else { return };

    // FASE 1 (rápida): coleta a altura de cada peer via /status. A altura
    // AUTO-REPORTADA só serve para DECIDIR tentar sincronizar (baixar e validar
    // blocos de verdade). Nunca bloqueia a produção — senão um peer mentindo uma
    // altura enorme congelaria a rede inteira (achado H2 da auditoria).
    let peers: Vec<String> = match state.read() {
        Ok(node) => node.peers.clone(), // clona e SOLTA o lock antes dos fetches
        Err(_) => return,
    };
    // Os /status saem em PARALELO (G9): com N peers e timeout de 3s, a fase 1
    // serial custava até N×3s por ciclo; em paralelo o pior caso é ~3s. Clonar
    // client/config é barato (pool compartilhado + struct pequena) e permite o
    // `tokio::spawn` sem prender referências. Os resultados são colhidos na
    // ordem original da lista — a fase 2 continua determinística.
    let tarefas: Vec<_> = peers
        .into_iter()
        .map(|peer| {
            let client = client.clone();
            let config = config.clone();
            tokio::spawn(async move {
                let status =
                    fetch_json_capped(&client, &config, &format!("{peer}/status"), 1_000_000, 3000)
                        .await;
                (peer, status)
            })
        })
        .collect();
    let mut ativos: Vec<(String, i64)> = Vec::new();
    for tarefa in tarefas {
        // peer inacessível (ou task abortada): silêncio, como o catch de p2p.js:155
        if let Ok((peer, Ok(status))) = tarefa.await
            && let Some(h) = status.get("height").and_then(|v| v.as_i64())
        {
            ativos.push((peer, h));
        }
    }

    // FASE 2 (lenta): sincroniza de cada peer que esteja à frente. Cada peer tem
    // seu próprio try/catch no JS (p2p.js:212) — aqui, o erro do helper é
    // descartado e o laço segue para o próximo peer.
    for (peer, peer_height) in ativos {
        let _ = sync_with_peer(client, config, state, &peer, peer_height).await;
    }
}

/// Sincroniza deste peer específico — o corpo do laço da fase 2 (p2p.js:159-214).
/// `Err` = peer inacessível/inválido NESTE ciclo; o chamador ignora e segue.
async fn sync_with_peer(
    client: &HttpClient,
    config: &P2pConfig,
    state: &AppState,
    peer: &str,
    peer_height: i64,
) -> Result<(), String> {
    // Fotografia da cadeia local — coletada sob o lock e solta antes do I/O.
    let (altura, tem_genese) = {
        let node = state.read().map_err(|_| "lock envenenado")?;
        (node.blockchain.height(), node.blockchain.has_genesis())
    };
    if peer_height <= altura {
        return Ok(()); // peer não está à frente (p2p.js:162)
    }

    if tem_genese && altura >= 0 {
        // 2a) EXTENSÃO INCREMENTAL: o peer continua a nossa cadeia — baixa só os
        // blocos acima do nosso topo e aplica direto, O(novos) (p2p.js:165-176).
        let novos = fetch_range(client, config, peer, (altura + 1) as u64).await?;
        if !novos.is_empty() {
            let agora = agora_ms();
            let mut aplicados = 0usize;
            let mut altura_nova = altura;
            {
                // Aplica SOB o write lock, síncrono, sem await no meio: ou os
                // blocos entram em sequência ou não entram — nenhum request da
                // API observa a cadeia no meio de uma extensão parcial. A
                // comparação de previousHash usa a cabeça ATUAL (pode ter
                // avançado desde a fotografia — o JS, single-thread, não tem
                // essa janela; aqui a re-checagem sob o lock a fecha).
                let mut guard = state.write().map_err(|_| "lock envenenado")?;
                let node = &mut *guard;
                let cabeca = node.blockchain.head().map(|b| b.hash.clone());
                if campo_str(&novos[0], "previousHash") == cabeca.as_deref() {
                    for cru in &novos {
                        // Conversão OU consenso falhando = para no primeiro erro,
                        // ficando com o prefixo válido (p2p.js:170 — try/break).
                        let Ok(bloco) = block_from_json(cru) else { break };
                        if node.blockchain.add_block(bloco, agora).is_err() {
                            break;
                        }
                        aplicados += 1;
                    }
                    if aplicados > 0 {
                        // Poda transações que os blocos novos tornaram obsoletas.
                        node.mempool.prune(&node.blockchain.state, agora);
                        altura_nova = node.blockchain.height();
                    }
                }
            }
            if aplicados > 0 {
                println!("[p2p] +{aplicados} blocos de {peer} (altura {altura_nova})");
                return Ok(()); // o `continue` de p2p.js:174
            }

            // 2b) REORG DE TOPO DIVERGENTE: forkamos. Baixa a janela recente do
            // peer de uma vez (forks são recentes), acha o ancestral comum
            // LOCALMENTE e reorganiza a partir dele — O(janela), sem replay da
            // cadeia inteira (p2p.js:178-199).
            let de = (altura - REORG_WINDOW as i64).max(0) as u64;
            let janela = fetch_range(client, config, peer, de).await?;
            let agora = agora_ms();
            {
                let mut guard = state.write().map_err(|_| "lock envenenado")?;
                let node = &mut *guard;
                let altura_atual = node.blockchain.height();
                // Hashes locais da janela, para a busca pura do ancestral. Montado
                // sob o MESMO lock que aplicará o reorg — a decisão e a aplicação
                // veem a mesma cadeia.
                let mut local: BTreeMap<u64, String> = BTreeMap::new();
                if altura_atual >= 0 {
                    for h in de..=(altura_atual as u64) {
                        if let Some(hh) = node.blockchain.hash_at(h) {
                            local.insert(h, hh.to_string());
                        }
                    }
                }
                let pares: Vec<(u64, String)> = janela
                    .iter()
                    .enumerate()
                    .filter_map(|(i, b)| {
                        campo_str(b, "hash").map(|h| (de + i as u64, h.to_string()))
                    })
                    .collect();
                if let Some(comum) = common_ancestor(&local, &pares)
                    && (comum as i64) < altura_atual
                {
                    // O rabo novo começa logo acima do ancestral (p2p.js:189).
                    let inicio = (comum - de + 1) as usize;
                    let mut rabo: Vec<eav7::block::Block> = Vec::with_capacity(janela.len() - inicio);
                    for cru in &janela[inicio..] {
                        // Bloco malformado aqui = o reorg do JS lançaria na
                        // validação → o catch por peer engole. Propaga o Err.
                        rabo.push(block_from_json(cru)?);
                    }
                    match node.blockchain.reorg(comum as i64, rabo, agora)? {
                        Reorg::Adotou(orfas) => {
                            // Ordem do JS (p2p.js:192-194): poda primeiro, depois
                            // re-submete as órfãs — transações dos blocos
                            // descartados que a cadeia nova não contém; erros
                            // individuais (obsoleta, nonce usado) são ignorados.
                            node.mempool.prune(&node.blockchain.state, agora);
                            for tx in orfas {
                                let _ = node.submit_transaction(tx);
                            }
                            println!(
                                "[p2p] reorg com {peer} a partir da altura {comum} (altura {})",
                                node.blockchain.height()
                            );
                        }
                        Reorg::Manteve => {}
                    }
                    return Ok(()); // o `continue` de p2p.js:197
                }
            }
        }
    }

    // 2c) FALLBACK (bootstrap sem cadeia, ou fork mais fundo que a janela):
    // baixa desde a gênese e delega ao replace_chain (p2p.js:202-211).
    let todos = fetch_range(client, config, peer, 0).await?;
    if todos.is_empty() {
        return Ok(());
    }
    let mut blocos: Vec<eav7::block::Block> = Vec::with_capacity(todos.len());
    for cru in &todos {
        blocos.push(block_from_json(cru)?);
    }
    let agora = agora_ms();
    let mut guard = state.write().map_err(|_| "lock envenenado")?;
    let node = &mut *guard;
    match node.blockchain.replace_chain(blocos, agora)? {
        Reorg::Adotou(orfas) => {
            node.mempool.prune(&node.blockchain.state, agora);
            for tx in orfas {
                let _ = node.submit_transaction(tx);
            }
            println!(
                "[p2p] cadeia sincronizada (reorg) com {peer} (altura {})",
                node.blockchain.height()
            );
        }
        Reorg::Manteve => {}
    }
    Ok(())
}

// ---------------------------------------------------------------- start

/// Sobe o transporte P2P: adota os seeds como peers CONFIÁVEIS (podem ser
/// privados — são do operador), registra-se em cada um, roda um sync imediato e
/// entra no laço periódico. Espelha o construtor (p2p.js:17) + `start`
/// (p2p.js:221-225). Devolve o handle da task; abortá-lo é o `stop()`.
pub fn start(state: AppState, config: P2pConfig, seeds: Vec<String>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let client = make_client();
        let guarda = Arc::new(tokio::sync::Mutex::new(()));
        // Seeds do operador: trusted=true bypassa o filtro de IP privado
        // (redes locais de desenvolvimento — p2p.js:15-17).
        for seed in &seeds {
            add_peer(&state, &config, seed, true).await;
        }
        // Registro mútuo em cada peer conhecido (p2p.js:222). Clona a lista e
        // solta o lock — register faz I/O.
        let peers: Vec<String> = match state.read() {
            Ok(node) => node.peers.clone(),
            Err(_) => return,
        };
        for peer in &peers {
            register(&client, &config, &state, peer).await;
        }
        sync_once(&client, &config, &state, &guarda).await;
        // Laço periódico. `Delay` (e não o default Burst): se um sync demorar
        // mais que o período, NÃO dispara rajada de compensação — o setInterval
        // do JS também não compensa ticks perdidos.
        let mut intervalo =
            tokio::time::interval(Duration::from_millis(config.sync_ms.max(1)));
        intervalo.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        intervalo.tick().await; // o 1º tick é imediato — o sync inicial já rodou
        loop {
            intervalo.tick().await;
            sync_once(&client, &config, &state, &guarda).await;
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------- URL

    #[test]
    fn normalize_exige_esquema_http_e_corta_barras() {
        assert_eq!(normalize_url("http://peer.eav7.com/"), Some("http://peer.eav7.com".into()));
        assert_eq!(normalize_url("https://a.b:6070///"), Some("https://a.b:6070".into()));
        assert_eq!(normalize_url("ftp://a.b"), None);
        assert_eq!(normalize_url("peer.eav7.com"), None);
        assert_eq!(normalize_url("http://"), None);
        assert_eq!(normalize_url("http://user@host"), None, "userinfo é rejeitado");
    }

    #[test]
    fn host_of_extrai_hostname() {
        assert_eq!(host_of("http://Peer.EAV7.com:6070/chain?x=1"), Some("peer.eav7.com".into()));
        assert_eq!(host_of("http://[::1]:6070/x"), Some("::1".into()));
        assert_eq!(host_of("http://10.0.0.1"), Some("10.0.0.1".into()));
    }

    // ------------------------------------------------- IPv4 não-canônico (L3)

    #[test]
    fn formas_nao_canonicas_de_loopback_sao_privadas() {
        // O achado L3: todas estas formas resolvem para 127.0.0.1.
        for forma in ["127.0.0.1", "2130706433", "0177.0.0.1", "0x7f.0.0.1", "0x7f000001"] {
            assert!(is_private_ip(forma), "{forma} é loopback e tem de ser privado");
        }
    }

    #[test]
    fn faixas_privadas_e_publicas_v4() {
        for privado in ["10.1.2.3", "192.168.0.1", "172.16.0.1", "172.31.255.255", "169.254.169.254", "0.0.0.0"] {
            assert!(is_private_ip(privado), "{privado}");
        }
        for publico in ["8.8.8.8", "172.15.0.1", "172.32.0.1", "1.1.1.1", "169.253.0.1"] {
            assert!(!is_private_ip(publico), "{publico}");
        }
    }

    #[test]
    fn ipv6_privado_e_mapeado() {
        for privado in ["::1", "::", "fc00::1", "fd12::1", "fe80::1", "feb0::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::10.0.0.1", "[::1]"] {
            assert!(is_private_ip(privado), "{privado}");
        }
        for publico in ["2001:db8::1", "fe00::1", "fec0::1", "::ffff:808:808"] {
            assert!(!is_private_ip(publico), "{publico}");
        }
    }

    #[test]
    fn hostnames_locais_sao_privados() {
        assert!(is_private_host("http://localhost:6070"));
        assert!(is_private_host("http://impressora.local"));
        assert!(is_private_host("http://0.0.0.0"));
        assert!(is_private_host("http://2130706433")); // L3 via URL
        assert!(is_private_host("://malformada"));
        assert!(!is_private_host("http://peer.eav7.com"));
    }

    // ------------------------------------------------------- ancestral comum

    #[test]
    fn ancestral_comum_e_a_maior_altura_coincidente() {
        let local: BTreeMap<u64, String> =
            [(5, "a".into()), (6, "b".into()), (7, "c".into())].into();
        // Peer diverge a partir da 7.
        let janela =
            vec![(5, "a".to_string()), (6, "b".to_string()), (7, "X".to_string())];
        assert_eq!(common_ancestor(&local, &janela), Some(6));
        // Nada coincide: fork mais fundo que a janela.
        let janela = vec![(5, "y".to_string()), (6, "z".to_string())];
        assert_eq!(common_ancestor(&local, &janela), None);
    }
}

// ============================================================================
// Testes do transporte — sem rede externa: servidores TCP efêmeros locais.
// ============================================================================

#[cfg(test)]
mod transporte_tests {
    use super::*;
    use crate::guard::{AbuseGuard, GuardConfig};
    use crate::node::Node;
    use eav7::blockchain::Blockchain;
    use eav7::mempool::Mempool;
    use std::sync::RwLock;

    fn estado() -> AppState {
        Arc::new(RwLock::new(Node {
            blockchain: Blockchain::new(),
            mempool: Mempool::new(),
            validator_address: None,
            peers: Vec::new(),
            security_alerts: Vec::new(),
            guard: std::sync::Arc::new(std::sync::Mutex::new(AbuseGuard::new(GuardConfig::default()))),
            gateway_target: None,
            gateway_snapshot: Default::default(),
            eavm_enabled: false,
            eavm_port: 0,
            public_rpc_url: None,
            self_url: None,
            admin_token: None,
            verified_contracts: Default::default(),
            eavm_index: std::sync::Arc::new(std::sync::Mutex::new(crate::node::EavmIndex::novo())),
            relay_bloco: None,
            pedir_sync: None,
            gossip_tx: None,
        }))
    }

    fn cfg(allow_private: bool) -> P2pConfig {
        P2pConfig {
            self_url: Some("http://127.0.0.1:5999".into()),
            allow_private_peers: allow_private,
            sync_ms: 5000,
        }
    }

    /// Servidor HTTP mínimo em porta efêmera: aceita UMA conexão, ignora o
    /// request e escreve a resposta crua. Suficiente para exercitar o cliente
    /// (o hyper decodifica content-length e chunked normalmente).
    async fn servidor_uma_resposta(resposta: Vec<u8>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind efêmero");
        let porta = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            // O crate compila tokio SEM `io-util` (não é preciso em produção),
            // então nada de AsyncRead/WriteExt — o par readable/try_read basta
            // para um servidor de teste que fala uma resposta e fecha.
            if let Ok((sock, _)) = listener.accept().await {
                let mut buf = [0u8; 4096];
                loop {
                    if sock.readable().await.is_err() {
                        return;
                    }
                    match sock.try_read(&mut buf) {
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                        _ => break, // request lido (ou erro) — responde e sai
                    }
                }
                let mut escrito = 0;
                while escrito < resposta.len() {
                    if sock.writable().await.is_err() {
                        return; // cliente abortou (esperado no teste do teto)
                    }
                    match sock.try_write(&resposta[escrito..]) {
                        Ok(n) => escrito += n,
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                        Err(_) => return,
                    }
                }
                // O drop do socket fecha a conexão (equivale ao shutdown aqui).
            }
        });
        format!("http://127.0.0.1:{porta}")
    }

    // ------------------------------------------------- fetch com teto (H-4)

    #[tokio::test]
    async fn fetch_json_corpo_pequeno_passa() {
        let corpo = br#"{"ok":true,"height":7}"#;
        let resposta = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\ncontent-type: application/json\r\n\r\n",
            corpo.len()
        )
        .into_bytes()
        .into_iter()
        .chain(corpo.iter().copied())
        .collect::<Vec<u8>>();
        let base = servidor_uma_resposta(resposta).await;
        let v = fetch_json_capped(&make_client(), &cfg(true), &format!("{base}/status"), 1_000, 3_000)
            .await
            .expect("corpo dentro do teto deve passar");
        assert_eq!(v["height"], serde_json::json!(7));
    }

    #[tokio::test]
    async fn content_length_acima_do_teto_rejeita_sem_ler() {
        // O header já confessa o estouro: nada do corpo precisa ser lido.
        let resposta = b"HTTP/1.1 200 OK\r\ncontent-length: 99999999\r\n\r\n".to_vec();
        let base = servidor_uma_resposta(resposta).await;
        let r = fetch_json_capped(&make_client(), &cfg(true), &base, 10_000, 3_000).await;
        assert!(r.is_err_and(|e| e.contains("limite")), "content-length gigante tem de ser recusado");
    }

    #[tokio::test]
    async fn corpo_chunked_sem_content_length_aborta_no_teto() {
        // O ponto do achado H-4: SEM content-length (chunked), o teto só é
        // aplicável lendo frame a frame — 200 KiB contra um teto de 10 KB tem de
        // abortar no meio, nunca materializar o corpo inteiro.
        let mut resposta = b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n".to_vec();
        let bloco = vec![b'x'; 1024];
        for _ in 0..200 {
            resposta.extend_from_slice(b"400\r\n"); // 0x400 = 1024
            resposta.extend_from_slice(&bloco);
            resposta.extend_from_slice(b"\r\n");
        }
        resposta.extend_from_slice(b"0\r\n\r\n");
        let base = servidor_uma_resposta(resposta).await;
        let r = fetch_text_capped(&make_client(), &cfg(true), &base, 10_000, 5_000).await;
        assert!(r.is_err_and(|e| e.contains("limite")), "corpo chunked acima do teto tem de abortar");
    }

    #[tokio::test]
    async fn guard_bloqueia_host_privado_sem_allow() {
        // Com allow_private_peers=false o guard corta ANTES de conectar — nenhum
        // servidor é necessário (é o anti-SSRF/H-3 em ação).
        let r = fetch_json_capped(&make_client(), &cfg(false), "http://127.0.0.1:1/x", 1_000, 1_000).await;
        assert!(r.is_err_and(|e| e.contains("privado")));
        let r = guard_peer(&cfg(false), "http://localhost:6070").await;
        assert!(r.is_err());
        // allow=true dispensa o guard por completo.
        assert!(guard_peer(&cfg(true), "http://localhost:6070").await.is_ok());
    }

    // ------------------------------------------------------------ fetch_range

    #[tokio::test]
    async fn fetch_range_pagina_unica_parseada_pelo_canonico() {
        let corpo = br#"{"height":1,"from":0,"blocks":[{"hash":"aa","previousHash":"gg"}]}"#;
        let resposta = format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\n\r\n", corpo.len())
            .into_bytes()
            .into_iter()
            .chain(corpo.iter().copied())
            .collect::<Vec<u8>>();
        let base = servidor_uma_resposta(resposta).await;
        let blocos = fetch_range(&make_client(), &cfg(true), &base, 0)
            .await
            .expect("página válida");
        // Página menor que MAX_CHAIN_PAGE encerra o range após UMA requisição.
        assert_eq!(blocos.len(), 1);
        assert_eq!(campo_str(&blocos[0], "hash"), Some("aa"));
    }

    // --------------------------------------------------------------- add_peer

    #[tokio::test]
    async fn add_peer_com_allow_private_aceita_localhost() {
        let state = estado();
        let config = cfg(true);
        assert!(add_peer(&state, &config, "http://127.0.0.1:6071", false).await);
        // Duplicado é recusado.
        assert!(!add_peer(&state, &config, "http://127.0.0.1:6071", false).await);
        // A própria URL é recusada (self_url do cfg).
        assert!(!add_peer(&state, &config, "http://127.0.0.1:5999", false).await);
        let peers = state.read().expect("lock").peers.clone();
        assert_eq!(peers, vec!["http://127.0.0.1:6071".to_string()]);
    }

    #[tokio::test]
    async fn add_peer_sem_allow_rejeita_privado_mas_aceita_seed() {
        let state = estado();
        let config = cfg(false);
        // NÃO confiável + privado: rejeitado (anti-SSRF, p2p.js:28-38).
        assert!(!add_peer(&state, &config, "http://127.0.0.1:6071", false).await);
        assert!(!add_peer(&state, &config, "http://localhost:6071", false).await);
        assert!(!add_peer(&state, &config, "http://2130706433:6071", false).await); // L3
        // Seed do operador (trusted): bypassa o filtro.
        assert!(add_peer(&state, &config, "http://127.0.0.1:6071", true).await);
        // URL sem esquema http nunca entra, nem confiável.
        assert!(!add_peer(&state, &config, "ftp://x", true).await);
    }

    #[tokio::test]
    async fn add_peer_respeita_o_teto_de_peers() {
        let state = estado();
        let config = cfg(true);
        {
            let mut node = state.write().expect("lock");
            for i in 0..MAX_PEERS {
                node.peers.push(format!("http://peer{i}.exemplo"));
            }
        }
        assert!(!add_peer(&state, &config, "http://127.0.0.1:7000", false).await);
    }
}
