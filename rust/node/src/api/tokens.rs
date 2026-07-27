//! Rotas de ativos e nomes — tokens EAV20, NFTs EAV721, EAV-NS e metadados de
//! contrato. Porte da fatia de `src/node/api.js`:
//!
//! - `GET  /name/{nome}`             (api.js:616)
//! - `GET  /contract/{addr}`         (api.js:622)
//! - `POST /contract/{addr}/verify`  (api.js:550)
//! - `GET  /tokens`                  (api.js:1071)
//! - `GET  /tokens/{id}`             (api.js:1076)
//! - `GET  /tokens/{id}/holders`     (api.js:1089)
//! - `GET  /tokens/{id}/transfers`   (api.js:1118)
//! - `GET  /nfts`                    (api.js:1147)
//! - `GET  /nfts/{id}`               (api.js:1159)
//! - `GET  /names`                   (api.js:1178)
//!
//! Padrão do módulo (ver `mod.rs`): handler = FUNÇÃO PURA `(&Node, params) ->
//! ApiReply`; a casca axum só extrai parâmetros, pega o lock e serializa. Os
//! formatos de resposta são os do JS CAMPO A CAMPO (camelCase) — o eavscan
//! consome isto e qualquer chave renomeada quebra o frontend em silêncio.
//! Montantes `u128` saem SEMPRE como string decimal (o `toJson` do JS faz o
//! mesmo com BigInt — config.js:588).

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use serde_json::json;

use eav7::state::nft::Collection;
use eav7::state::token::Token;
use eav7::transaction::{JsonValue, Tx};

// `bad_request` ENTRA por causa da ÚNICA rota deste arquivo que responde 400: o
// `POST /contract/{addr}/verify` (api.js:550-556 embrulha o `throw` do
// `verifyContract` num `400 {error}`). As demais rotas seguem sem 400 — as
// validações de formato delas acontecem na máquina de estado, não na leitura.
use super::{bad_request, int_param, into_response, not_found, reply, ApiReply, AppState};
use crate::node::Node;
use crate::verify_contract::params_from_json;

// A casca repete o mesmo prólogo em toda rota; um erro de lock envenenado tem a
// mesma resposta do exemplar `status_route` (mod.rs:138).
macro_rules! com_no {
    ($state:expr, $node:ident => $corpo:expr) => {{
        let $node = match $state.read() {
            Ok(n) => n,
            Err(_) => return into_response(reply(500, json!({ "error": "estado envenenado" }))),
        };
        into_response($corpo)
    }};
}

// ---------------------------------------------------------------- conversões

/// `JsonValue` (JSON canônico da lib) → `serde_json::Value` (apresentação).
///
/// Só atravessa a fronteira NESTA direção: a resposta da API nunca é hasheada
/// nem assinada, então a perda da forma canônica aqui é inofensiva (e é a
/// política de dependências do crate — ver Cargo.toml do eav7-node).
fn json_de(v: &JsonValue) -> serde_json::Value {
    match v {
        JsonValue::Null => serde_json::Value::Null,
        JsonValue::Bool(b) => json!(b),
        JsonValue::Int(i) => json!(i),
        JsonValue::Str(s) => json!(s),
        JsonValue::List(itens) => serde_json::Value::Array(itens.iter().map(json_de).collect()),
        JsonValue::Map(m) => serde_json::Value::Object(
            m.iter().map(|(k, v)| (k.clone(), json_de(v))).collect(),
        ),
    }
}

/// Uma transação como o JS a espalha (`{ ...t }`, api.js:1138): as chaves do
/// payload em camelCase, `to` presente mesmo quando nulo (o payload assinado o
/// emite como `null` literal) e os campos opcionais OMITIDOS quando ausentes —
/// `JSON.stringify` descarta `undefined`, então uma tx sem `data` não tem a
/// chave `data` no JSON do bloco, e a resposta reproduz isso.
fn tx_json(t: &Tx) -> serde_json::Value {
    let mut m = serde_json::Map::new();
    m.insert("protocol".into(), json!(t.protocol));
    m.insert("scheme".into(), json!(t.scheme));
    m.insert("type".into(), json!(t.tx_type)); // `type` é a chave do protocolo
    m.insert("from".into(), json!(t.from));
    m.insert("to".into(), match &t.to {
        Some(a) => json!(a),
        None => serde_json::Value::Null,
    });
    m.insert("amount".into(), json!(t.amount));
    m.insert("fee".into(), json!(t.fee));
    m.insert("nonce".into(), json!(t.nonce));
    m.insert("timestamp".into(), json!(t.timestamp));
    if let Some(d) = &t.data {
        m.insert("data".into(), json_de(d));
    }
    if let Some(k) = &t.public_key {
        m.insert("publicKey".into(), json!(k));
    }
    if let Some(k) = &t.pq_public_key {
        m.insert("pqPublicKey".into(), json!(k));
    }
    if let Some(s) = &t.signature {
        m.insert("signature".into(), json!(s));
    }
    if let Some(s) = &t.pq_signature {
        m.insert("pqSignature".into(), json!(s));
    }
    if let Some(id) = &t.id {
        m.insert("id".into(), json!(id));
    }
    serde_json::Value::Object(m)
}

/// `tokenView` (src/token/eav20.js:39): o token SEM os mapas de `balances` e
/// `allowances` (grandes e privados demais para a listagem), mais a contagem de
/// holders com saldo positivo. `blacklist` e `frozen` FICAM na visão — o JS só
/// desestrutura os dois primeiros — e `frozen.amount` é texto, como no estado da
/// referência (state.js:1772).
fn token_view(t: &Token) -> serde_json::Value {
    json!({
        "standard": t.standard,
        "id": t.id,
        "name": t.name,
        "symbol": t.symbol,
        "decimals": t.decimals,
        "totalSupply": t.total_supply.to_string(),
        "creator": t.creator,
        "owner": t.owner,
        "mintable": t.mintable,
        "paused": t.paused,
        "createdAt": t.created_at,
        "blacklist": t.blacklist.iter().map(|(a, b)| (a.clone(), json!(b)))
            .collect::<serde_json::Map<_, _>>(),
        "frozen": t.frozen.iter().map(|(a, (valor, unlock))| {
            (a.clone(), json!({ "amount": valor.to_string(), "unlockAt": unlock }))
        }).collect::<serde_json::Map<_, _>>(),
        "holders": t.balances.values().filter(|b| **b > 0).count(),
    })
}

// ---------------------------------------------------------------- EAV-NS

/// `GET /name/{nome}` — resolve um nome legível (api.js:616). O nome é
/// normalizado para minúsculas ANTES da busca, como o `toLowerCase()` do JS: o
/// registro grava só a forma minúscula, então `/name/EAV7` resolve `eav7`.
pub fn name_lookup(node: &Node, nome: &str) -> ApiReply {
    let chave = nome.to_lowercase();
    match node.blockchain.state.names.get(&chave) {
        None => reply(404, json!({ "error": "nome não registrado" })),
        Some(rec) => reply(200, json!({
            "name": chave,
            "target": rec.target,
            "owner": rec.owner,
        })),
    }
}

/// `GET /names` — listagem paginada do EAV-NS (api.js:1178). Filtro opcional
/// `?owner=`, teto de 1..=1000 com default 200 (`intParam`).
///
/// A ordem é ALFABÉTICA nos dois clientes, e isso é deliberado dos dois lados: o
/// JS faz `Object.keys(state.names).sort()` (api.js:1186) justamente para que
/// "o cliente Rust, cujo BTreeMap ordena por chave", sirva a mesma página — o
/// `break` no limite decide QUAIS entradas aparecem, então iterar por ordem de
/// inserção faria dois nós responderem coisas diferentes sobre o mesmo estado.
///
/// Havia aqui um comentário afirmando exatamente o contrário — uma divergência
/// "assumida e não corrigível". Ela não existe, e o texto desencorajava a
/// verificação que a teria desmentido em dois minutos.
pub fn names_list(node: &Node, q: &HashMap<String, String>) -> ApiReply {
    let limit = int_param(q.get("limit"), 200).clamp(1, 1000);
    let owner = q.get("owner");
    let mut out = Vec::new();
    for (name, r) in &node.blockchain.state.names {
        if let Some(dono) = owner
            && &r.owner != dono
        {
            continue;
        }
        out.push(json!({
            "name": name,
            "target": r.target,
            "owner": r.owner,
            "registeredAt": r.registered_at,
        }));
        if out.len() >= limit {
            break;
        }
    }
    reply(200, serde_json::Value::Array(out))
}

// ---------------------------------------------------------------- contratos

/// `GET /contract/{addr}` — metadados de verificação de contrato (api.js:622-627).
///
/// Consulta `node.get_verified_contract` (node.js:143). Registro presente →
/// `200 { verified: true, ...rec }` (o *spread* do JS achata o registro no
/// corpo). Ausente → `404 { verified: false, error }`. O `verified` é BOOLEANO
/// (não `null`) agora que o armazenamento existe: `false` = "consultado e não
/// verificado", como na referência.
pub fn contract_get(node: &Node, addr: &str) -> ApiReply {
    match node.get_verified_contract(addr) {
        None => reply(404, json!({ "verified": false, "error": "contrato não verificado" })),
        Some(rec) => {
            // `{ verified: true, ...rec }` (api.js:625) — injeta a flag no objeto
            // do registro já serializado em camelCase.
            let mut v = rec.to_json();
            if let serde_json::Value::Object(m) = &mut v {
                m.insert("verified".into(), json!(true));
            }
            reply(200, v)
        }
    }
}

/// `POST /contract/{addr}/verify` (api.js:550-557). O corpo é o standard-JSON do
/// solc (`{source, bytecode, immutableReferences, optimizer, …}`); `verifyContract`
/// (node.js:73) mascara `immutableReferences`, compara com o código on-chain e
/// classifica em `full`/`immutable`/`partial`. TODO erro de validação/comparação
/// vira `400 {error}` com a mensagem crua (api.js:554-556). Sucesso →
/// `200 { verified: true, address, match, codeHash }` (node.js:140).
///
/// `now_ms` é injetado pela casca (o `Date.now()` do JS grava `verifiedAt`).
pub fn contract_verify(node: &mut Node, addr: &str, corpo: &str, now_ms: i64) -> ApiReply {
    // api.js:551 usa `readBody` (JSON). Corpo vazio ou malformado é entrada
    // inválida → 400 (o `verifyContract` do JS falharia ao desestruturar).
    let body: serde_json::Value = match serde_json::from_str(corpo.trim()) {
        Ok(v) => v,
        Err(_) => return bad_request("JSON inválido"),
    };
    let params = params_from_json(&body);
    match node.verify_contract(addr, params, now_ms) {
        Ok(rec) => reply(200, json!({
            "verified": true,
            "address": rec.address,
            "match": rec.match_grade,
            "codeHash": rec.code_hash,
        })),
        // O `catch` de api.js:554 devolve `400 {error: String(err.message)}`.
        Err(e) => bad_request(e),
    }
}

// ---------------------------------------------------------------- tokens EAV20

/// `GET /tokens` — todas as visões públicas (api.js:1071).
///
/// Ordem: o JS itera `Object.values(state.tokens)` (inserção = criação); aqui é
/// a ordem das chaves do `BTreeMap` (id hexadecimal). Divergência de ORDEM
/// apenas — o conjunto é o mesmo porque não há corte por limite nesta rota.
pub fn tokens_list(node: &Node) -> ApiReply {
    let lista: Vec<serde_json::Value> =
        node.blockchain.state.tokens.values().map(token_view).collect();
    reply(200, serde_json::Value::Array(lista))
}

/// `GET /tokens/{id}` — visão de um token, com `balanceOf` opcional via
/// `?address=` (api.js:1076). O saldo consultado é o BRUTO (`tokenBalanceOf`,
/// eav20.js:30) — inclui a parte congelada, exatamente como o JS.
pub fn token_get(node: &Node, id: &str, q: &HashMap<String, String>) -> ApiReply {
    let Some(token) = node.blockchain.state.tokens.get(id) else {
        return not_found("token EAV20");
    };
    let mut view = token_view(token);
    if let Some(address) = q.get("address") {
        let balance = token.balances.get(address).copied().unwrap_or(0);
        view["balanceOf"] = json!({ "address": address, "balance": balance.to_string() });
    }
    reply(200, view)
}

/// O `limit` de /holders usa `Number(...) || 100` (api.js:1092), que NÃO é o
/// `intParam` das demais rotas: ausente, vazio, inválido E ZERO caem no default;
/// não há piso 1 — um limite NEGATIVO chega ao `slice(0, n)` do JS e recorta a
/// partir do FIM. Reproduzido aqui via f64 (a coerção `Number` aceita fração e
/// notação científica; `slice` trunca em direção a zero).
fn limite_holders(q: &HashMap<String, String>) -> i64 {
    let bruto = match q.get("limit") {
        None => 0.0, // Number(null) === 0 → falsy → default
        Some(s) => {
            let t = s.trim();
            if t.is_empty() { 0.0 } else { t.parse::<f64>().unwrap_or(f64::NAN) }
        }
    };
    let n = if bruto.is_nan() || bruto == 0.0 { 100.0 } else { bruto };
    n.min(500.0).trunc() as i64
}

/// `GET /tokens/{id}/holders` — ranking de distribuição (api.js:1089): saldo
/// positivo, ordenado por saldo DESC, cortado no limite (máx 500).
///
/// Empates: o sort do JS é estável sobre a ordem de inserção do objeto
/// `balances` (primeiro crédito primeiro); aqui a estabilidade é sobre a ordem
/// do `BTreeMap` (endereço ascendente). Mesmo conjunto, ordem relativa dos
/// EMPATADOS pode diferir — relatado no porte.
pub fn token_holders(node: &Node, id: &str, q: &HashMap<String, String>) -> ApiReply {
    let Some(token) = node.blockchain.state.tokens.get(id) else {
        return not_found("token EAV20");
    };
    let limit = limite_holders(q);
    // `totalSupply > 0n ? totalSupply : 1n` — evita divisão por zero no shareBps
    // de um token 100% queimado.
    let supply = if token.total_supply > 0 { token.total_supply } else { 1 };
    let mut all: Vec<(&String, u128)> = token
        .balances
        .iter()
        .filter(|(_, b)| **b > 0)
        .map(|(a, b)| (a, *b))
        .collect();
    // Estável (como o sort do V8) e só por saldo — o critério do JS.
    all.sort_by_key(|t| std::cmp::Reverse(t.1));

    // `slice(0, limit)`: positivo corta do início; negativo descarta do fim.
    let recorte: &[(&String, u128)] = if limit >= 0 {
        &all[..(limit as usize).min(all.len())]
    } else {
        &all[..all.len().saturating_sub(limit.unsigned_abs() as usize)]
    };

    reply(200, json!({
        "token": token.id,
        "decimals": token.decimals,
        "totalSupply": token.total_supply.to_string(),
        "holders": all.len(),
        "list": recorte.iter().enumerate().map(|(i, (address, balance))| {
            // Participação em PONTOS-BASE: fração exata em inteiro, sem float no
            // servidor (api.js:1106). `balance <= supply` (invariante do estado)
            // e o parse limita montantes a 30 dígitos, então `*10_000` cabe em
            // u128 com folga; o saturating é cinto de segurança, não semântica.
            let share_bps = balance.saturating_mul(10_000) / supply;
            json!({
                "rank": i + 1,
                "address": address,
                "balance": balance.to_string(),
                // `String(token.frozen?.[address]?.amount ?? 0n)` — sempre texto.
                "frozen": token.frozen.get(address.as_str())
                    .map(|(v, _)| v.to_string()).unwrap_or_else(|| "0".into()),
                "blacklisted": token.blacklist.get(address.as_str()).copied().unwrap_or(false),
                "shareBps": share_bps as u64,
            })
        }).collect::<Vec<_>>(),
    }))
}

/// `data.token` de uma transação, se for texto — o id do token numa
/// `TOKEN_TRANSFER` vive em `data`, nunca no `to` (api.js:1114).
fn tx_token_id(t: &Tx) -> Option<&str> {
    match t.data.as_ref()? {
        JsonValue::Map(m) => match m.get("token")? {
            JsonValue::Str(s) => Some(s.as_str()),
            _ => None,
        },
        _ => None,
    }
}

/// `GET /tokens/{id}/transfers` — transferências DE um token (api.js:1118).
/// Varre o índice `blocksWithTxs` de trás para frente com o mesmo teto anti-DoS
/// (2000 blocos-com-tx visitados). Pagina via `?before=altura`; `nextBefore` é a
/// altura onde o limite fechou (ou null quando a varredura esgotou o índice).
///
/// `receipt` vem de `blockchain.receipts` (api.js:1138) — só transação EAVM tem
/// um; para as demais o `null` é a resposta certa.
///
/// (Já NÃO é lacuna: a leitura de blocos antigos. Havia aqui uma segunda lacuna
/// dizendo que a varredura só enxergava a janela em RAM — o laço usa
/// `Blockchain::block_at`, o caminho FUNDO, que cai no `BlockStore` em disco
/// abaixo de `tail_start`. Transfers fora da janela aparecem.)
pub fn token_transfers(node: &Node, id: &str, q: &HashMap<String, String>) -> ApiReply {
    let bc = &node.blockchain;
    let Some(token) = bc.state.tokens.get(id) else {
        return not_found("token EAV20");
    };
    let limit = int_param(q.get("limit"), 25).clamp(1, 100);
    // Default = "sem teto" (o JS usa Number.MAX_SAFE_INTEGER).
    let before = int_param(q.get("before"), usize::MAX) as u64;
    const SCAN_CAP: usize = 2000; // blocos-com-tx visitados, não blocos da cadeia

    let asset = json!({
        "kind": "EAV20",
        "id": token.id,
        "symbol": token.symbol,
        "name": token.name,
        "decimals": token.decimals,
    });

    let mut txs: Vec<serde_json::Value> = Vec::new();
    let mut next_before: Option<u64> = None;
    let mut scanned = 0usize;

    let bwt = &bc.blocks_with_txs;
    for i in (0..bwt.len()).rev() {
        if txs.len() >= limit || scanned >= SCAN_CAP {
            break;
        }
        let h = bwt[i];
        if h >= before {
            continue;
        }
        scanned += 1;
        // Caminho FUNDO (RAM + disco): transfers antigos vivem no BlockStore.
        let b = match bc.block_at(h) {
            Ok(Some(b)) => b,
            Ok(None) => continue,
            Err(e) => return reply(500, json!({ "error": e })),
        };
        for t in b.transactions.iter().rev() {
            if txs.len() >= limit {
                break;
            }
            if tx_token_id(t) != Some(token.id.as_str()) {
                continue;
            }
            // `{ ...t, blockHeight, blockTime, receipt, asset }` (api.js:1138).
            let mut v = tx_json(t);
            v["blockHeight"] = json!(h);
            v["blockTime"] = json!(b.timestamp);
            v["receipt"] = super::recibo_json(node, t.id.as_deref());
            v["asset"] = asset.clone();
            txs.push(v);
        }
        // Fechou o limite NESTE bloco e ainda há índice atrás dele → próxima
        // página começa "antes desta altura".
        if txs.len() >= limit && i > 0 {
            next_before = Some(h);
        }
    }

    reply(200, json!({
        "token": token.id,
        "txs": txs,
        "nextBefore": next_before,
        "scanned": scanned,
    }))
}

// ---------------------------------------------------------------- NFTs EAV721

/// Resumo de coleção usado por `GET /nfts` (api.js:1148): `supply` é a contagem
/// ATUAL de itens (queimados não contam), `nextId` é o contador que nunca recua.
fn nft_resumo(id: &str, c: &Collection) -> serde_json::Value {
    json!({
        "id": id,
        "name": c.name,
        "symbol": c.symbol,
        "owner": c.owner,
        "supply": c.tokens.len(),
        "nextId": c.next_id,
    })
}

/// `GET /nfts` — todas as coleções (api.js:1147). Mesma nota de ordem de
/// `tokens_list`: BTreeMap (id) aqui, inserção lá; sem corte, o conjunto é igual.
pub fn nfts_list(node: &Node) -> ApiReply {
    let lista: Vec<serde_json::Value> = node
        .blockchain
        .state
        .nfts
        .iter()
        .map(|(id, c)| nft_resumo(id, c))
        .collect();
    reply(200, serde_json::Value::Array(lista))
}

/// `GET /nfts/{id}` — uma coleção com seus itens (api.js:1159). Filtro opcional
/// `?owner=`, teto 1..=1000 com default 200.
///
/// Ordem dos itens: no JS as chaves de `c.tokens` são inteiras ("1", "2"…) e
/// objetos JS iteram chaves array-like em ordem NUMÉRICA crescente; o `BTreeMap`
/// daria "1","10","2". Os ids saem todos de `next_id.to_string()`, então ordenar
/// pelo valor numérico reproduz o JS exatamente (fallback léxico só para uma
/// chave não numérica, que o protocolo não produz).
pub fn nft_get(node: &Node, id: &str, q: &HashMap<String, String>) -> ApiReply {
    let Some(c) = node.blockchain.state.nfts.get(id) else {
        return reply(404, json!({ "error": "coleção EAV721 não encontrada" }));
    };
    let limit = int_param(q.get("limit"), 200).clamp(1, 1000);
    let owner = q.get("owner");

    let mut chaves: Vec<&String> = c.tokens.keys().collect();
    chaves.sort_by_key(|k| k.parse::<u64>().unwrap_or(u64::MAX));

    let mut tokens = Vec::new();
    for token_id in chaves {
        let tk = &c.tokens[token_id];
        if let Some(dono) = owner
            && &tk.owner != dono
        {
            continue;
        }
        tokens.push(json!({ "tokenId": token_id, "owner": tk.owner, "uri": tk.uri }));
        if tokens.len() >= limit {
            break;
        }
    }

    reply(200, json!({
        "id": id,
        "name": c.name,
        "symbol": c.symbol,
        "owner": c.owner,
        "supply": c.tokens.len(),
        "nextId": c.next_id,
        "tokens": tokens,
    }))
}

// ---------------------------------------------------------------- casca axum

async fn name_route(State(state): State<AppState>, Path(nome): Path<String>) -> Response {
    com_no!(state, node => name_lookup(&node, &nome))
}

async fn contract_route(State(state): State<AppState>, Path(addr): Path<String>) -> Response {
    com_no!(state, node => contract_get(&node, &addr))
}

// O `corpo: String` é extrator que CONSOME o corpo → tem de vir por ÚLTIMO na
// lista de argumentos (regra do axum). Precisa de `write()` (grava o registro).
async fn contract_verify_route(
    State(state): State<AppState>,
    Path(addr): Path<String>,
    corpo: String,
) -> Response {
    let mut node = match state.write() {
        Ok(n) => n,
        Err(_) => return into_response(reply(500, json!({ "error": "estado envenenado" }))),
    };
    into_response(contract_verify(&mut node, &addr, &corpo, agora_ms()))
}

/// Instante em ms — injetado no `verifyContract` como `verifiedAt` (o `Date.now()`
/// do JS). Isolado aqui para os handlers puros permanecerem sem relógio.
fn agora_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

async fn tokens_route(State(state): State<AppState>) -> Response {
    com_no!(state, node => tokens_list(&node))
}

async fn token_route(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    com_no!(state, node => token_get(&node, &id, &q))
}

async fn holders_route(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    com_no!(state, node => token_holders(&node, &id, &q))
}

async fn transfers_route(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    com_no!(state, node => token_transfers(&node, &id, &q))
}

async fn nfts_route(State(state): State<AppState>) -> Response {
    com_no!(state, node => nfts_list(&node))
}

async fn nft_route(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    com_no!(state, node => nft_get(&node, &id, &q))
}

async fn names_route(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    com_no!(state, node => names_list(&node, &q))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/name/{nome}", get(name_route))
        .route("/contract/{addr}", get(contract_route))
        .route("/contract/{addr}/verify", post(contract_verify_route))
        .route("/tokens", get(tokens_route))
        .route("/tokens/{id}", get(token_route))
        .route("/tokens/{id}/holders", get(holders_route))
        .route("/tokens/{id}/transfers", get(transfers_route))
        .route("/nfts", get(nfts_route))
        .route("/nfts/{id}", get(nft_route))
        .route("/names", get(names_route))
}

// ============================================================================
// Testes — Estado construído NA MÃO, como os testes da lib eav7 fazem.
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::guard::{AbuseGuard, GuardConfig};
    use eav7::blockchain::Blockchain;
    use eav7::mempool::Mempool;
    use eav7::state::nft::{NameRecord, NftToken};
    use std::collections::BTreeMap;

    const ALICE: &str = "E7D36986E47AC3768974578F7CCD3123AE";
    const BOB: &str = "E74FE1240972091DE7BE392072067581DC";
    const CAROL: &str = "E7AAAA240972091DE7BE392072067581DC";

    fn node() -> Node {
        Node {
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
        }
    }

    fn q(pares: &[(&str, &str)]) -> HashMap<String, String> {
        pares.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// Token de teste com a distribuição dada; o suprimento é a soma dos saldos
    /// (invariante do estado real).
    fn token(id: &str, saldos: &[(&str, u128)]) -> Token {
        let balances: BTreeMap<String, u128> =
            saldos.iter().map(|(a, b)| (a.to_string(), *b)).collect();
        Token {
            standard: "eav20".into(),
            id: id.into(),
            name: "Vetor".into(),
            symbol: "VET".into(),
            decimals: 6,
            total_supply: saldos.iter().map(|(_, b)| b).sum(),
            creator: ALICE.into(),
            owner: ALICE.into(),
            mintable: false,
            paused: false,
            created_at: 1_700_000_000_000,
            balances,
            allowances: BTreeMap::new(),
            blacklist: BTreeMap::new(),
            frozen: BTreeMap::new(),
        }
    }

    // ------------------------------------------------------------- 404 exatos

    #[test]
    fn token_inexistente_da_404_com_a_mensagem_do_js() {
        let n = node();
        for r in [
            token_get(&n, "nao-existe", &q(&[])),
            token_holders(&n, "nao-existe", &q(&[])),
            token_transfers(&n, "nao-existe", &q(&[])),
        ] {
            assert_eq!(r.0.as_u16(), 404);
            assert_eq!(r.1["error"], "token EAV20 não encontrado");
        }
    }

    #[test]
    fn nft_e_nome_inexistentes_dao_404() {
        let n = node();
        let r = nft_get(&n, "x", &q(&[]));
        assert_eq!(r.0.as_u16(), 404);
        assert_eq!(r.1["error"], "coleção EAV721 não encontrada");

        let r = name_lookup(&n, "fantasma");
        assert_eq!(r.0.as_u16(), 404);
        assert_eq!(r.1["error"], "nome não registrado");
    }

    // ---------------------------------------------------------- visão do token

    #[test]
    fn token_view_esconde_saldos_e_monta_montantes_como_texto() {
        let mut n = node();
        let mut t = token("tok-1", &[(ALICE, 750), (BOB, 250), (CAROL, 0)]);
        t.frozen.insert(BOB.into(), (100, 9_999));
        n.blockchain.state.tokens.insert("tok-1".into(), t);

        let (code, v) = token_get(&n, "tok-1", &q(&[("address", BOB)]));
        assert_eq!(code.as_u16(), 200);
        // Montantes u128 SEMPRE string decimal — o toJson do JS faz igual.
        assert_eq!(v["totalSupply"], "1000");
        assert_eq!(v["balanceOf"]["balance"], "250");
        assert_eq!(v["balanceOf"]["address"], BOB);
        // holders conta só saldo POSITIVO (Carol tem 0).
        assert_eq!(v["holders"], 2);
        // Os mapas grandes não vazam na visão…
        assert!(v.get("balances").is_none());
        assert!(v.get("allowances").is_none());
        // …mas blacklist/frozen ficam, com frozen.amount em TEXTO.
        assert_eq!(v["frozen"][BOB]["amount"], "100");
        assert_eq!(v["frozen"][BOB]["unlockAt"], 9_999);
    }

    // ------------------------------------------------------------- /holders

    #[test]
    fn holders_saem_ordenados_por_saldo_desc_com_rank_e_share() {
        let mut n = node();
        // Inserção proposital fora de ordem de saldo.
        let t = token("tok-1", &[(ALICE, 100), (BOB, 700), (CAROL, 200)]);
        n.blockchain.state.tokens.insert("tok-1".into(), t);

        let (code, v) = token_holders(&n, "tok-1", &q(&[]));
        assert_eq!(code.as_u16(), 200);
        assert_eq!(v["holders"], 3);
        let list = v["list"].as_array().unwrap();
        let ordem: Vec<&str> = list.iter().map(|h| h["address"].as_str().unwrap()).collect();
        assert_eq!(ordem, [BOB, CAROL, ALICE], "saldo DESC, não ordem de conta");
        assert_eq!(list[0]["rank"], 1);
        assert_eq!(list[2]["rank"], 3);
        assert_eq!(list[0]["balance"], "700");
        // 700/1000 em pontos-base.
        assert_eq!(list[0]["shareBps"], 7_000);
        assert_eq!(list[2]["shareBps"], 1_000);
        assert_eq!(list[0]["frozen"], "0");
        assert_eq!(list[0]["blacklisted"], false);
    }

    #[test]
    fn holders_respeita_o_limite_e_ignora_saldo_zero() {
        let mut n = node();
        let t = token("tok-1", &[(ALICE, 5), (BOB, 10), (CAROL, 0)]);
        n.blockchain.state.tokens.insert("tok-1".into(), t);

        let (_, v) = token_holders(&n, "tok-1", &q(&[("limit", "1")]));
        // `holders` é a contagem TOTAL de saldo positivo; `list` é o recorte.
        assert_eq!(v["holders"], 2);
        let list = v["list"].as_array().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["address"], BOB);

        // limit=0 cai no default (Number(...) || 100 do JS), não em lista vazia.
        let (_, v) = token_holders(&n, "tok-1", &q(&[("limit", "0")]));
        assert_eq!(v["list"].as_array().unwrap().len(), 2);
    }

    // -------------------------------------------------------------- /names

    #[test]
    fn names_pagina_pelo_limite_e_filtra_por_owner() {
        let mut n = node();
        for (nome, dono) in [("alfa", ALICE), ("beta", BOB), ("gama", ALICE), ("delta", ALICE)] {
            n.blockchain.state.names.insert(nome.into(), NameRecord {
                owner: dono.into(),
                target: dono.into(),
                registered_at: 1_700_000_000_000,
            });
        }

        // Sem filtro, corta em 2 (ordem do BTreeMap: alfa, beta, delta, gama).
        let (code, v) = names_list(&n, &q(&[("limit", "2")]));
        assert_eq!(code.as_u16(), 200);
        let out = v.as_array().unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["name"], "alfa");
        assert_eq!(out[1]["name"], "beta");
        assert_eq!(out[0]["registeredAt"], 1_700_000_000_000_i64);

        // Filtro por dono: só os do ALICE, ainda paginado.
        let (_, v) = names_list(&n, &q(&[("owner", ALICE), ("limit", "2")]));
        let out = v.as_array().unwrap();
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|r| r["owner"] == ALICE));

        // Resolução individual normaliza para minúsculas antes da busca.
        let (code, v) = name_lookup(&n, "ALFA");
        assert_eq!(code.as_u16(), 200);
        assert_eq!(v["name"], "alfa");
        assert_eq!(v["target"], ALICE);
    }

    // ---------------------------------------------------------------- NFTs

    #[test]
    fn nft_get_ordena_itens_numericamente_como_o_js() {
        let mut n = node();
        let mut c = Collection {
            standard: "eav721".into(),
            id: "col-1".into(),
            name: "Arte".into(),
            symbol: "ART".into(),
            owner: ALICE.into(),
            created_at: 1,
            next_id: 12,
            tokens: BTreeMap::new(),
            approvals: BTreeMap::new(),
        };
        // 11 itens: no BTreeMap a ordem léxica seria "1","10","11","2",… — o JS
        // itera chaves inteiras em ordem NUMÉRICA e a rota reproduz isso.
        for i in 1..=11u64 {
            c.tokens.insert(i.to_string(), NftToken { owner: ALICE.into(), uri: format!("ipfs://{i}") });
        }
        n.blockchain.state.nfts.insert("col-1".into(), c);

        let (code, v) = nft_get(&n, "col-1", &q(&[]));
        assert_eq!(code.as_u16(), 200);
        assert_eq!(v["supply"], 11);
        assert_eq!(v["nextId"], 12);
        let ids: Vec<&str> = v["tokens"].as_array().unwrap()
            .iter().map(|t| t["tokenId"].as_str().unwrap()).collect();
        assert_eq!(ids, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    }

    // ------------------------------------------------------------- contratos

    #[test]
    fn verify_route_full_match_grava_e_get_devolve_o_registro() {
        use eav7::state::contracts::Contract;
        let mut n = node();
        let addr = "0x00000000000000000000000000000000000000ab";
        let c = Contract { code: "0x6001600260ab".into(), ..Default::default() };
        n.blockchain.state.contracts.insert(addr.into(), c);

        // Antes de verificar: GET responde 404 com verified=false (não null).
        let (code, v) = contract_get(&n, addr);
        assert_eq!(code.as_u16(), 404);
        assert_eq!(v["verified"], false);

        // POST /verify com o corpo do solc (bytecode idêntico → full).
        let corpo = serde_json::json!({
            "source": "contract C {}",
            "compiler": "0.8.24",
            "bytecode": "0x6001600260ab",
            "contractName": "C",
        })
        .to_string();
        let (code, v) = contract_verify(&mut n, addr, &corpo, 999);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(v["verified"], true);
        assert_eq!(v["match"], "full");
        assert!(v["codeHash"].as_str().is_some());

        // Agora o GET achata o registro no corpo com verified=true.
        let (code, v) = contract_get(&n, addr);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(v["verified"], true);
        assert_eq!(v["match"], "full");
        assert_eq!(v["contractName"], "C");
        assert_eq!(v["verifiedAt"], 999);
        assert_eq!(v["address"], addr);
    }

    #[test]
    fn verify_route_bytecode_divergente_devolve_400() {
        use eav7::state::contracts::Contract;
        let mut n = node();
        let addr = "0x00000000000000000000000000000000000000cd";
        let c = Contract { code: "0x6001".into(), ..Default::default() };
        n.blockchain.state.contracts.insert(addr.into(), c);

        // Tamanho diferente → erro cru repassado como 400.
        let corpo = serde_json::json!({ "source": "x", "bytecode": "0x600160ab" }).to_string();
        let (code, v) = contract_verify(&mut n, addr, &corpo, 0);
        assert_eq!(code.as_u16(), 400);
        assert!(v["error"].as_str().unwrap().contains("tamanho do bytecode difere"));

        // Corpo malformado → 400 JSON inválido, sem pânico.
        let (code, _) = contract_verify(&mut n, addr, "{nao json", 0);
        assert_eq!(code.as_u16(), 400);
    }

    // ------------------------------------------------------------ /transfers

    #[test]
    fn transfers_de_cadeia_vazia_devolve_forma_completa() {
        // Sem blocos não há o que varrer, mas a FORMA da resposta (token, txs,
        // nextBefore, scanned) tem de estar lá — o eavscan lê os quatro campos.
        let mut n = node();
        let t = token("tok-1", &[(ALICE, 10)]);
        n.blockchain.state.tokens.insert("tok-1".into(), t);

        let (code, v) = token_transfers(&n, "tok-1", &q(&[]));
        assert_eq!(code.as_u16(), 200);
        assert_eq!(v["token"], "tok-1");
        assert_eq!(v["txs"].as_array().unwrap().len(), 0);
        assert!(v["nextBefore"].is_null());
        assert_eq!(v["scanned"], 0);
    }
}
