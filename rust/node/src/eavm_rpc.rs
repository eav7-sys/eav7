//! Servidor JSON-RPC do protocolo EAVM — porte de `src/eavm/rpc.js` (396 linhas).
//!
//! É o endpoint no dialeto Ethereum ("eth_*") que MetaMask/Trust Wallet falam
//! quando adicionam a EAV7 como "rede customizada" (Chain ID 72020). NÃO é
//! consenso — é TRANSPORTE — mas serve dados de consenso e SUBMETE transações,
//! então a fidelidade de FORMATO importa: quantities em hex `0x` sem zeros à
//! esquerda, e objetos de tx/bloco/recibo no formato Ethereum campo a campo.
//!
//! # Arquitetura do porte (igual à de `api/mod.rs`)
//!
//! A LÓGICA é uma função pura despachante — [`dispatch`] / [`dispatch_read`] —
//! `(&Node|&mut Node, method, params) -> Result<Value, RpcError>`, testável sem
//! abrir socket. A CASCA axum lê o lock (write SÓ no método que submete —
//! `eth_sendRawTransaction`; read nos demais), chama o despachante e embrulha em
//! JSON-RPC 2.0. O lock NUNCA atravessa um `await`: cada `handle_one` pega o
//! guard, despacha (síncrono, CPU-curto) e o solta antes de a resposta ser
//! serializada.
//!
//! `eth_call`/`eth_estimateGas` simulam a VM, que pode rodar até o teto de gas —
//! longo demais para segurar QUALQUER lock exclusivo (o produtor de blocos usa o
//! write lock a cada slot). A casca pega o READ lock só o bastante para CLONAR o
//! estado (o mesmo `state.clone()` barato que a produção de bloco e o reorg
//! fazem) e roda a simulação no clone, sem lock nenhum.
//!
//! # JSON de APRESENTAÇÃO, nunca de consenso
//!
//! Toda resposta aqui usa `serde_json` (política do crate `eav7-node`): nada
//! disto é hasheado, assinado nem volta ao estado. O ÚNICO ponto que toca
//! consenso é `eth_sendRawTransaction`, e mesmo ele delega ao
//! [`build_eavm_envelope`], que re-deriva a `Tx` canônica do `raw` assinado.
//!
//! # Recibos e eventos
//!
//! `eth_getTransactionReceipt` e `eth_getLogs` leem os índices NODE-LOCAIS da
//! `Blockchain` (`receipts`, `log_index`) — não o estado de consenso. Enquanto
//! esses índices não existiam no porte, o recibo saía em modo degradado
//! (`status: 0x1` e `gasUsed` fixo para tudo) e `eth_getLogs` devolvia `[]`: uma
//! chamada REVERTIDA aparecia como sucesso na carteira, e nenhum indexador ou
//! subgraph conseguia acompanhar a cadeia.

use std::collections::BTreeMap;
use std::sync::PoisonError;

use axum::body::Bytes;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};

use eav7::block::Block;
use eav7::config as c;
use eav7::eavm::envelope::build_eavm_envelope;
use eav7::state::contracts::{eavm_to_e7, is_eavm_address, EavmCallParams};
use eav7::state::Amount;
use eav7::transaction::{JsonValue, Tx};

use crate::api::AppState;
use crate::node::Node;

// ---------------------------------------------------------------------------
// Constantes de preço — `rpc.js:16-18`
// ---------------------------------------------------------------------------

/// `GAS_PRICE = (CHAIN.FEES.EAVM_TRANSFER * CHAIN.EAVM_WEI_PER_E7) / 21000n`
/// (`rpc.js:17`). 21000 gas × este preço ≈ a taxa de protocolo (0,01 EAV7) que a
/// carteira exibe. Divisão inteira (floor) igual à `BigInt / BigInt` do JS.
/// 10000 × 10¹² / 21000 = 476190476190476.
const GAS_PRICE: u128 = (c::fees::EAVM_TRANSFER * c::EAVM_WEI_PER_E7) / 21000;

/// `ZERO_BLOOM = '0x' + '0'.repeat(512)` (`rpc.js:18`) — 256 bytes de bloom
/// vazio. Construído em runtime (um `const` de String não é possível).
fn zero_bloom() -> String {
    format!("0x{}", "0".repeat(512))
}

// ---------------------------------------------------------------------------
// Erro JSON-RPC — espelha o `rpcError` de `rpc.js:329-336`
// ---------------------------------------------------------------------------

/// Um erro JSON-RPC 2.0. `data` carrega o `returnData` de um revert — é dele que
/// o ethers.js decodifica a razão (Error(string)/erro customizado do contrato),
/// como no `err.rpcData` do JS (`rpc.js:334`).
#[derive(Debug, Clone)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

impl RpcError {
    /// `rpcError(message, code = -32000)` (`rpc.js:329`).
    fn new(message: impl Into<String>) -> Self {
        RpcError { code: -32000, message: message.into(), data: None }
    }
    fn with_code(message: impl Into<String>, code: i64) -> Self {
        RpcError { code, message: message.into(), data: None }
    }
    /// Revert com `returnData` — vira o campo `data` do erro (`rpc.js:334`).
    fn revert(message: impl Into<String>, data: impl Into<String>) -> Self {
        RpcError { code: -32000, message: message.into(), data: Some(Value::String(data.into())) }
    }
    /// -32602 (Invalid params): parâmetro obrigatório ausente ou com tipo errado.
    /// O JS não distingue este código (cai no -32000 genérico do `rpcError`), mas
    /// o padrão JSON-RPC reserva -32602 exatamente para isto e o adotamos.
    fn invalid_params(message: impl Into<String>) -> Self {
        RpcError { code: -32602, message: message.into(), data: None }
    }
    /// Serializa como o objeto `error` do JSON-RPC (`rpc.js:345`).
    fn to_json(&self) -> Value {
        match &self.data {
            Some(d) => json!({ "code": self.code, "message": self.message, "data": d }),
            None => json!({ "code": self.code, "message": self.message }),
        }
    }
}

// ---------------------------------------------------------------------------
// Auxiliares de formatação — quantities em hex `0x` (`rpc.js:20`)
// ---------------------------------------------------------------------------

/// `toHex(value) = '0x' + BigInt(value).toString(16)` (`rpc.js:20`): hex minúsculo
/// SEM zeros à esquerda; `0x0` para zero (o `{:x}` do Rust dá exatamente isso).
fn to_hex(value: u128) -> String {
    format!("0x{value:x}")
}

/// `BigInt(value)` do JS sobre uma string de quantity: aceita `0x…` (hex) OU
/// decimal. Devolve `None` em vazio/malformado — quem chama decide o erro.
fn parse_quantity(s: &str) -> Option<u128> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        if hex.is_empty() {
            return None;
        }
        u128::from_str_radix(hex, 16).ok()
    } else {
        s.parse::<u128>().ok()
    }
}

/// Relógio de parede em ms — o `timestamp` do envelope construído por
/// `eth_sendRawTransaction` (a referência usa `Date.now()`). SÓ apresentação/uso
/// local: `verify_eavm_envelope` exige apenas `timestamp > 0` e inteiro seguro.
fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Leitura de `data` da Tx EAVM
// ---------------------------------------------------------------------------

/// O mapa `data` de uma Tx, quando é objeto. Toda Tx EAVM o carrega
/// (`envelope.js:105-114`).
fn data_map(tx: &Tx) -> Option<&BTreeMap<String, JsonValue>> {
    match &tx.data {
        Some(JsonValue::Map(m)) => Some(m),
        _ => None,
    }
}

/// `tx.data[key]` quando é string.
fn data_str<'a>(tx: &'a Tx, key: &str) -> Option<&'a str> {
    match data_map(tx)?.get(key) {
        Some(JsonValue::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

/// `tx.data.eavmNonce` (inteiro) — `envelope.js:110`.
fn data_nonce(tx: &Tx) -> i64 {
    match data_map(tx).and_then(|m| m.get("eavmNonce")) {
        Some(JsonValue::Int(n)) => *n,
        _ => 0,
    }
}

/// `isEavmTx` — `rpc.js:24`: tipo do esquema EAVM E `data.eavmHash` string. Toda
/// tx EAVM (transferência, deploy, chamada) tem hash EVM própria e portanto é
/// encontrável por hash.
fn is_eavm_tx(tx: &Tx) -> bool {
    matches!(tx.tx_type.as_str(), "EAVM_TRANSFER" | "EAVM_DEPLOY" | "EAVM_CALL")
        && data_str(tx, "eavmHash").is_some()
}

// ---------------------------------------------------------------------------
// Objetos no formato Ethereum — tx, bloco, recibo
// ---------------------------------------------------------------------------

/// `eavmTxObject` — `rpc.js:77-95`: uma tx EAVM no formato Ethereum. `block`
/// `None` = ainda no mempool (campos de posição ficam `null`, como no JS).
fn eavm_tx_object(tx: &Tx, block: Option<&Block>) -> Value {
    // `value: toHex(BigInt(tx.amount) * EAVM_WEI_PER_E7)` (`rpc.js:82`). O amount
    // é decimal em unidades E7; ×10¹² dá o WEI. `saturating_mul` só por higiene —
    // supply (~10¹⁷) × 10¹² ≪ u128::MAX.
    let amount = tx.amount.parse::<u128>().unwrap_or(0);
    let value = to_hex(amount.saturating_mul(c::EAVM_WEI_PER_E7));
    // `input: tx.data.code ?? tx.data.input ?? '0x'` (`rpc.js:87`): bytecode no
    // deploy, calldata na chamada, `0x` na transferência.
    let input = data_str(tx, "code").or_else(|| data_str(tx, "input")).unwrap_or("0x");
    json!({
        "hash": data_str(tx, "eavmHash"),
        "from": data_str(tx, "eavmFrom"),
        "to": data_str(tx, "eavmTo"), // deploy não tem destino → null
        "value": value,
        "nonce": to_hex(data_nonce(tx) as u128),
        "gas": "0x5208",
        "gasPrice": to_hex(GAS_PRICE),
        "input": input,
        "blockHash": block.map(|b| format!("0x{}", b.hash.to_lowercase())),
        "blockNumber": block.map(|b| to_hex(b.height as u128)),
        "transactionIndex": block.map(|_| "0x0"),
        "type": "0x0",
        "chainId": to_hex(c::EAVM_CHAIN_ID as u128),
        "v": "0x0", "r": "0x0", "s": "0x0",
    })
}

/// `eavmBlock` — `rpc.js:97-122`: um bloco no formato Ethereum. Só as tx do
/// esquema EAVM entram (`filter(isEavmTx)`), com hash ou objeto conforme
/// `include_txs`.
fn eavm_block(block: &Block, include_txs: bool) -> Value {
    let eavm_txs: Vec<&Tx> = block.transactions.iter().filter(|t| is_eavm_tx(t)).collect();
    // `gasUsed: toHex(BigInt(eavmTxs.length) * 21000n)` (`rpc.js:107`).
    let gas_used = to_hex(eavm_txs.len() as u128 * 21000);
    let txs: Vec<Value> = eavm_txs
        .iter()
        .map(|tx| {
            if include_txs {
                eavm_tx_object(tx, Some(block))
            } else {
                // Só o hash EAVM (`rpc.js:120`).
                Value::String(data_str(tx, "eavmHash").unwrap_or_default().to_string())
            }
        })
        .collect();
    json!({
        "number": to_hex(block.height as u128),
        "hash": format!("0x{}", block.hash.to_lowercase()),
        "parentHash": format!("0x{}", block.previous_hash.to_lowercase()),
        // `timestamp: toHex(floor(block.timestamp / 1000))` (`rpc.js:104`): ms→s.
        "timestamp": to_hex((block.timestamp / 1000).max(0) as u128),
        "miner": format!("0x{}", "0".repeat(40)),
        "gasLimit": to_hex(30_000_000),
        "gasUsed": gas_used,
        "baseFeePerGas": to_hex(GAS_PRICE),
        "difficulty": "0x0",
        "totalDifficulty": "0x0",
        "extraData": "0x",
        "nonce": "0x0000000000000000",
        "logsBloom": zero_bloom(),
        "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
        "transactionsRoot": format!("0x{}", block.tx_root.to_lowercase()),
        "stateRoot": format!("0x{}", "0".repeat(64)),
        "receiptsRoot": format!("0x{}", "0".repeat(64)),
        "size": "0x400",
        "uncles": [],
        "transactions": txs,
    })
}

// ---------------------------------------------------------------------------
// Resolução de tx por hash EAVM e de bloco por tag
// ---------------------------------------------------------------------------

/// `findEavmTx` — `rpc.js:151-160`: acha a tx (minerada OU pendente) cujo
/// `data.eavmHash` casa. Devolve a tx possuída e o bloco possuído (`None` =
/// pendente no mempool).
///
/// Usa o índice INCREMENTAL `eavmHash -> id` (`node.eavm_index`), como o
/// `ensureIndexed` do JS. A versão anterior varria `blocks_with_txs` inteiro a
/// CADA chamada, pelo caminho fundo — disco, parse e clone por bloco, na thread
/// do tokio e com o read lock preso. Isso não era "só performance": o MetaMask
/// faz polling de recibo a cada ~4s enquanto uma tx está pendente, e um lote de
/// 50 consultas numa requisição multiplicava o custo. Era DoS remoto não
/// autenticado. Um erro de leitura de disco é pulado (a tx some do resultado),
/// nunca derruba o RPC.
fn garantir_indexado(node: &Node) {
    let bc = &node.blockchain;
    let altura = bc.height();
    let Ok(mut idx) = node.eavm_index.lock() else { return };
    // Cadeia ENCOLHEU (reorg): o índice pode conter hashes de blocos órfãos —
    // reindexa do zero (`rpc.js:52`). Sem isto o RPC devolveria recibo de
    // transação descartada como se estivesse na cadeia.
    if idx.altura_indexada > altura {
        idx.por_hash.clear();
        idx.altura_indexada = -1;
    }
    if idx.altura_indexada >= altura {
        return;
    }
    // Só os blocos COM transação, e só os ainda não vistos.
    for &h in &bc.blocks_with_txs {
        if (h as i64) <= idx.altura_indexada {
            continue;
        }
        let Ok(Some(block)) = bc.block_at(h) else { continue };
        for tx in &block.transactions {
            // TODA tx do esquema EAVM tem hash EVM — não só a transferência.
            // Deploy e chamada também precisam ser encontráveis, senão a
            // ferramenta que acabou de enviar a tx nunca acha o recibo dela.
            if is_eavm_tx(tx)
                && let (Some(hash), Some(id)) = (data_str(tx, "eavmHash"), tx.id.as_deref())
            {
                idx.por_hash.insert(hash.to_string(), id.to_string());
            }
        }
    }
    idx.altura_indexada = altura;
}

// ---------------------------------------------------------------------------
// Eventos (`LOG`) — índice node-local
// ---------------------------------------------------------------------------

/// `String(v).toLowerCase()` do JS sobre um valor JSON de filtro.
fn lc(v: &Value) -> String {
    match v {
        Value::String(s) => s.to_lowercase(),
        outro => outro.to_string().to_lowercase(),
    }
}

/// `topicsMatch` (`rpc.js:32-44`): filtro POSICIONAL. `null` numa posição casa
/// com qualquer coisa, um array casa com qualquer um dos valores (OU), e um
/// filtro mais longo que os tópicos do log nunca casa.
fn topicos_casam(do_log: &[String], filtro: Option<&Value>) -> bool {
    let Some(Value::Array(f)) = filtro else { return true };
    if f.is_empty() {
        return true;
    }
    if f.len() > do_log.len() {
        return false;
    }
    for (i, quer) in f.iter().enumerate() {
        let tem = do_log[i].to_lowercase();
        match quer {
            Value::Null => continue,
            Value::Array(opcoes) => {
                if !opcoes.iter().any(|o| lc(o) == tem) {
                    return false;
                }
            }
            outro => {
                if lc(outro) != tem {
                    return false;
                }
            }
        }
    }
    true
}

/// O que um bloco acrescenta a cada log dele: o hash do bloco e o hash EVM de
/// cada transação (o `transactionHash` que as ferramentas casam com o recibo).
struct ContextoDoBloco {
    hash: Value,
    /// id da tx eav20 → `data.eavmHash`.
    hashes_evm: BTreeMap<String, String>,
}

impl ContextoDoBloco {
    fn do_bloco(bloco: Option<&Block>) -> Self {
        let hash = bloco.map_or(Value::Null, |b| json!(format!("0x{}", b.hash.to_lowercase())));
        let mut hashes_evm = BTreeMap::new();
        if let Some(b) = bloco {
            for tx in &b.transactions {
                if let (Some(id), Some(h)) = (tx.id.as_deref(), data_str(tx, "eavmHash")) {
                    hashes_evm.insert(id.to_string(), h.to_string());
                }
            }
        }
        ContextoDoBloco { hash, hashes_evm }
    }
}

/// Objetos `log` no formato Ethereum, de uma FAIXA de alturas, já filtrados.
///
/// A referência (`blockLogObjects`, `rpc.js:127-149`) percorre o anel INTEIRO uma
/// vez por altura consultada; com o anel em `MAX_LOG_INDEX` e a faixa em
/// `MAX_LOG_RANGE`, uma única chamada de `eth_getLogs` varreria centenas de
/// milhões de entradas — o método é público e sem custo para quem chama. Aqui a
/// varredura é ÚNICA e o `logIndex` sai de um contador por altura, o que produz
/// exatamente a mesma lista na mesma ordem (o anel é cronológico).
///
/// `teto` corta a lista como o `MAX_LOG_RESULTS` do JS: assim que enche, para.
fn logs_da_faixa(
    node: &Node,
    de: u64,
    ate: u64,
    enderecos: Option<&std::collections::BTreeSet<String>>,
    topicos: Option<&Value>,
    teto: usize,
) -> Vec<Value> {
    let bc = &node.blockchain;
    let mut saida = Vec::new();
    // Contador POR ALTURA: o `logIndex` é a posição do log DENTRO do bloco, e
    // conta inclusive os que o filtro descarta (como no JS, que numera primeiro e
    // filtra depois) — senão duas consultas com filtros diferentes devolveriam
    // `logIndex` diferentes para o MESMO log.
    let mut contador: BTreeMap<u64, u128> = BTreeMap::new();
    let mut contexto: BTreeMap<u64, ContextoDoBloco> = BTreeMap::new();

    for lg in &bc.log_index {
        if lg.block_height < de || lg.block_height > ate {
            continue;
        }
        let indice = {
            let c = contador.entry(lg.block_height).or_insert(0);
            let atual = *c;
            *c += 1;
            atual
        };
        // `or_insert_with` = UMA leitura de bloco por altura, e só na primeira
        // vez. Bloco ilegível não vira erro: o log vem do índice em RAM e
        // continua sendo verdade — sai com `blockHash: null`, como no JS quando o
        // bloco já deslizou da janela.
        let ctx = contexto.entry(lg.block_height).or_insert_with(|| {
            ContextoDoBloco::do_bloco(bc.block_at(lg.block_height).ok().flatten().as_ref())
        });

        let endereco = lg.address.to_lowercase();
        if enderecos.is_some_and(|set| !set.contains(&endereco)) {
            continue;
        }
        if !topicos_casam(&lg.topics, topicos) {
            continue;
        }
        saida.push(json!({
            "address": endereco,
            "topics": lg.topics.iter().map(|t| t.to_lowercase()).collect::<Vec<_>>(),
            "data": lg.data,
            "blockNumber": to_hex(lg.block_height as u128),
            "blockHash": ctx.hash,
            "transactionHash": ctx.hashes_evm.get(&lg.tx_id).map_or(Value::Null, |h| json!(h)),
            "transactionIndex": "0x0",
            "logIndex": to_hex(indice),
            // Sem log de cadeia reorganizada: o índice é RECONSTRUÍDO no reorg
            // (os órfãos saem), então nunca há log marcado como removido.
            "removed": false,
        }));
        if saida.len() >= teto {
            break;
        }
    }
    saida
}

fn find_eavm_tx(node: &Node, eavm_hash: &str) -> Option<(Tx, Option<Block>)> {
    garantir_indexado(node);
    // Minerada: o índice dá o id, e `transaction_at` resolve pelo caminho fundo
    // (RAM + disco) lendo UM bloco, não a cadeia.
    let id = node.eavm_index.lock().ok().and_then(|i| i.por_hash.get(eavm_hash).cloned());
    if let Some(id) = id
        && let Ok(Some((tx, altura, _))) = node.blockchain.transaction_at(&id)
        && let Ok(Some(block)) = node.blockchain.block_at(altura)
    {
        return Some((tx, Some(block)));
    }
    // Pendente: `node.mempool.all().find(...)` (`rpc.js:158`).
    for tx in node.mempool.all() {
        if is_eavm_tx(tx) && data_str(tx, "eavmHash") == Some(eavm_hash) {
            return Some((tx.clone(), None));
        }
    }
    None
}

/// `blockByTag` — `rpc.js:68-75`: resolve a tag Ethereum para um bloco possuído.
/// `latest`/`pending`/`safe`/`finalized`/ausente → topo; `earliest` → 0; senão
/// `Number(BigInt(tag))`.
fn block_by_tag(node: &Node, tag: Option<&Value>) -> Option<Block> {
    let bc = &node.blockchain;
    let numero: Option<u64> = match tag {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => match s.as_str() {
            "latest" | "pending" | "safe" | "finalized" => None,
            "earliest" => Some(0),
            outra => parse_quantity(outra).map(|n| n as u64),
        },
        Some(Value::Number(n)) => n.as_u64(),
        _ => None,
    };
    match numero {
        // Topo: `blockchain.head` (`rpc.js:70`) — sempre na janela de RAM.
        None => bc.head().cloned(),
        // `blockchain.getBlock(n)` do JS lê o store; aqui `block_at` (RAM+disco).
        // Err de disco vira "não encontrado" (`None`), como o `null` do JS.
        Some(n) => bc.block_at(n).ok().flatten(),
    }
}

// ---------------------------------------------------------------------------
// Despacho READ-ONLY — tudo que só precisa de `&Node` (read lock)
// ---------------------------------------------------------------------------

/// Métodos que NÃO mutam o estado. Erro em método desconhecido é -32601
/// (`rpc.js:325`). Recebe `&Node` (read lock na casca).
pub fn dispatch_read(node: &Node, method: &str, params: &Value) -> Result<Value, RpcError> {
    let bc = &node.blockchain;
    // `params[i]` como no destructuring do JS: ausente = `undefined`.
    let param = |i: usize| params.get(i);
    let param_str = |i: usize| param(i).and_then(Value::as_str);

    match method {
        // --------------------------------------------------- identidade / rede
        "web3_clientVersion" => Ok(json!(format!("EAV7/eavm/v{}", c::PROTOCOL_VERSION))),
        // `eth_chainId = toHex(EAVM_CHAIN_ID)` (hex); `net_version` = DECIMAL.
        "eth_chainId" => Ok(json!(to_hex(c::EAVM_CHAIN_ID as u128))),
        "net_version" => Ok(json!(c::EAVM_CHAIN_ID.to_string())),
        "net_listening" => Ok(json!(true)),
        "eth_syncing" => Ok(json!(false)),
        "eth_accounts" => Ok(json!([])),

        // ---------------------------------------------------------- cadeia
        // `toHex(BigInt(Math.max(blockchain.height, 0)))` (`rpc.js:171`).
        "eth_blockNumber" => Ok(json!(to_hex(bc.height().max(0) as u128))),
        "eth_gasPrice" => Ok(json!(to_hex(GAS_PRICE))),
        "eth_maxPriorityFeePerGas" => Ok(json!("0x0")),

        // -------------------------------------------------------- conta 0x
        "eth_getCode" => {
            // `isEavmAddress(address)` antes de tudo (`rpc.js:205`).
            let address = param_str(0).ok_or_else(|| RpcError::invalid_params("address ausente"))?;
            if !is_eavm_address(address) {
                return Err(RpcError::new("endereço inválido"));
            }
            // `state.codeOf(address)` (`rpc.js:206`) — já vem `0x…` ou `0x`.
            Ok(json!(bc.state.code_of(address)))
        }
        "eth_getBalance" => {
            let address = param_str(0).ok_or_else(|| RpcError::invalid_params("address ausente"))?;
            if !is_eavm_address(address) {
                return Err(RpcError::new("endereço inválido"));
            }
            // `balanceOf(eavmToE7(address)) * EAVM_WEI_PER_E7` (`rpc.js:212-213`):
            // saldo da conta E7 mapeada, em WEI.
            let e7 = eavm_to_e7(address).map_err(|e| RpcError::new(e.to_string()))?;
            let saldo = bc.state.balance_of(&e7);
            Ok(json!(to_hex(saldo.saturating_mul(c::EAVM_WEI_PER_E7))))
        }
        "eth_getTransactionCount" => {
            let address = param_str(0).ok_or_else(|| RpcError::invalid_params("address ausente"))?;
            if !is_eavm_address(address) {
                return Err(RpcError::new("endereço inválido"));
            }
            // `nextNonceFor(eavmToE7(address)) - 1` (`rpc.js:220`): nonce EAVM
            // esperado = nonce do protocolo (inclui pendentes) menos 1. O nonce
            // EAVM começa em 0, o do protocolo em 1 — daí o `-1`. `next_nonce_for`
            // devolve ≥ 1, então nunca vai a negativo.
            let e7 = eavm_to_e7(address).map_err(|e| RpcError::new(e.to_string()))?;
            Ok(json!(to_hex(node.next_nonce_for(&e7).saturating_sub(1) as u128)))
        }

        // ------------------------------------------------------ fee history
        "eth_feeHistory" => {
            // count = clamp(1, 32, floor(Number(BigInt(params[0] ?? '0x1'))))
            // (`rpc.js:224-226`). Malformado → 1, como o `catch` do JS.
            let raw = param_str(0).and_then(parse_quantity).unwrap_or(1);
            let count = raw.clamp(1, 32) as usize;
            // percentiles: `params[2]` se for array, senão vazio (`rpc.js:227`).
            let percentiles = param(2).and_then(Value::as_array).map(Vec::len).unwrap_or(0);
            let base_fee: Vec<String> = std::iter::repeat_n(to_hex(GAS_PRICE), count + 1).collect();
            let gas_ratio: Vec<f64> = std::iter::repeat_n(0.05_f64, count).collect();
            let reward_row: Vec<&str> = std::iter::repeat_n("0x0", percentiles).collect();
            let reward: Vec<Vec<&str>> = std::iter::repeat_n(reward_row, count).collect();
            let oldest = (bc.height() - count as i64 + 1).max(0) as u128;
            Ok(json!({
                "oldestBlock": to_hex(oldest),
                "baseFeePerGas": base_fee,
                "gasUsedRatio": gas_ratio,
                "reward": reward,
            }))
        }

        // -------------------------------------------------------- consultas
        "eth_getTransactionByHash" => {
            let hash = param_str(0).ok_or_else(|| RpcError::invalid_params("hash ausente"))?;
            match find_eavm_tx(node, hash) {
                Some((tx, block)) => Ok(eavm_tx_object(&tx, block.as_ref())),
                None => Ok(Value::Null),
            }
        }
        "eth_getTransactionReceipt" => {
            let hash = param_str(0).ok_or_else(|| RpcError::invalid_params("hash ausente"))?;
            // `if (!found || !found.block) return null` (`rpc.js:249`): sem bloco
            // (pendente) não há recibo.
            let Some((tx, Some(block))) = find_eavm_tx(node, hash) else {
                return Ok(Value::Null);
            };
            // Recibo REAL. Antes saía degradado — `status: 0x1` e `gasUsed`
            // fixo para TUDO, então uma chamada que reverteu na mineração
            // aparecia como sucesso, que é o pior tipo de mentira num recibo.
            //
            // Transação SEM recibo registrado é transferência simples (não passou
            // pela EAVM): sucesso, custo de 21000 (`rpc.js:253-255`).
            let recibo = tx.id.as_deref().and_then(|id| bc.receipts.get(id));
            let gas = recibo.map_or(21000, |r| r.gas_used as u128);
            let ok = recibo.is_none_or(|r| r.success);
            // Execução que falhou não emite log — o `revert` já os despilhou.
            let logs = if ok {
                let meu = data_str(&tx, "eavmHash");
                logs_da_faixa(node, block.height, block.height, None, None, usize::MAX)
                    .into_iter()
                    .filter(|l| l["transactionHash"].as_str() == meu)
                    .collect()
            } else {
                Vec::new()
            };
            Ok(json!({
                "transactionHash": data_str(&tx, "eavmHash"),
                "transactionIndex": "0x0",
                "blockHash": format!("0x{}", block.hash.to_lowercase()),
                "blockNumber": to_hex(block.height as u128),
                "from": data_str(&tx, "eavmFrom"),
                "to": data_str(&tx, "eavmTo"),
                "gasUsed": to_hex(gas),
                "cumulativeGasUsed": to_hex(gas),
                "effectiveGasPrice": to_hex(GAS_PRICE),
                // Só o DEPLOY carrega endereço: é como toda ferramenta descobre
                // onde o contrato foi parar.
                "contractAddress": recibo.and_then(|r| r.contract.clone()),
                "logs": logs,
                "logsBloom": zero_bloom(),
                "status": if ok { "0x1" } else { "0x0" },
                "type": "0x0",
            }))
        }

        // Consulta de eventos — o método sem o qual não existe indexador, subgraph
        // nem histórico de transferência de token. Serve do índice node-local.
        "eth_getLogs" => {
            let filtro = param(0).cloned().unwrap_or_else(|| json!({}));
            let topo = bc.height().max(0) as u64;
            // `tag()` (`rpc.js:280-284`): as tags de ponta viram o TOPO, `earliest`
            // vira 0, e um número malformado cai no padrão em vez de virar erro.
            let tag = |v: Option<&Value>, padrao: u64| -> u64 {
                match v {
                    None | Some(Value::Null) => padrao,
                    Some(Value::String(s)) => match s.as_str() {
                        "latest" | "pending" | "safe" | "finalized" => padrao,
                        "earliest" => 0,
                        outro => parse_quantity(outro).map_or(padrao, |n| n as u64),
                    },
                    Some(Value::Number(n)) => n.as_u64().unwrap_or(padrao),
                    _ => padrao,
                }
            };
            let (mut de, mut ate) = (tag(filtro.get("fromBlock"), topo), tag(filtro.get("toBlock"), topo));
            if let Some(h) = filtro.get("blockHash").and_then(Value::as_str) {
                let interno = h.strip_prefix("0x").unwrap_or(h).to_lowercase();
                let bloco = bc
                    .block_by_hash_at(&interno)
                    .map_err(|e| RpcError::new(format!("leitura da cadeia falhou: {e}")))?
                    .ok_or_else(|| RpcError::new("bloco não encontrado"))?;
                de = bloco.height;
                ate = bloco.height;
            }
            if de > ate {
                return Err(RpcError::new("fromBlock maior que toBlock"));
            }
            // Teto de faixa: sem ele uma consulta de 0 até o topo varre a cadeia
            // inteira a cada chamada — o vetor de DoS clássico do `eth_getLogs`.
            if ate - de > c::MAX_LOG_RANGE {
                return Err(RpcError::new(format!(
                    "faixa de blocos acima do máximo ({})",
                    c::MAX_LOG_RANGE
                )));
            }
            // `f.address` aceita um endereço OU uma lista (`rpc.js:298-299`).
            let enderecos = match filtro.get("address") {
                None | Some(Value::Null) => None,
                Some(Value::Array(a)) => Some(a.iter().map(lc).collect()),
                Some(um) => Some(std::collections::BTreeSet::from([lc(um)])),
            };
            Ok(json!(logs_da_faixa(
                node,
                de,
                ate,
                enderecos.as_ref(),
                filtro.get("topics"),
                c::MAX_LOG_RESULTS as usize,
            )))
        }

        "eth_getBlockByNumber" => {
            let include = param(1) == Some(&Value::Bool(true));
            Ok(match block_by_tag(node, param(0)) {
                Some(b) => eavm_block(&b, include),
                None => Value::Null,
            })
        }
        "eth_getBlockByHash" => {
            let include = param(1) == Some(&Value::Bool(true));
            let hash = param_str(0).ok_or_else(|| RpcError::invalid_params("hash ausente"))?;
            // `String(params[0]).slice(2)` (tira o `0x`). A referência faz
            // `.toUpperCase()` porque os hashes internos DELA são maiúsculos; os
            // do porte Rust são MINÚSCULOS (`is_valid_hash` exige `[0-9a-f]`),
            // então baixamos a caixa — mesma intenção, formato interno diferente.
            let interno = hash.strip_prefix("0x").unwrap_or(hash).to_lowercase();
            Ok(match bc.block_by_hash_at(&interno).ok().flatten() {
                Some(b) => eavm_block(&b, include),
                None => Value::Null,
            })
        }

        _ => Err(RpcError::with_code(format!("método não suportado: {method}"), -32601)),
    }
}

// ---------------------------------------------------------------------------
// Despacho COMPLETO — métodos que executam/submetem precisam de `&mut Node`
// ---------------------------------------------------------------------------

/// Só `eth_sendRawTransaction` precisa do WRITE lock no `Node` inteiro.
///
/// `eth_call` / `eth_estimateGas` clonam o `State` sob READ lock e executam fora
/// do lock — a VM ainda usa journal/`&mut`, mas no clone. Antes eles competiam
/// com o produtor (write a cada ~200 ms) e um lote RPC podia travar a API.
pub fn needs_write(method: &str) -> bool {
    matches!(method, "eth_sendRawTransaction")
}

/// Despacho completo: os métodos de escrita direto, o resto delegado a
/// [`dispatch_read`]. Recebe `&mut Node`. Testável sem socket.
pub fn dispatch(node: &mut Node, method: &str, params: &Value) -> Result<Value, RpcError> {
    let param = |i: usize| params.get(i);
    match method {
        // As simulações rodam direto no estado do `Node` aqui (o journal da VM
        // desfaz tudo) — este caminho é o dos testes/chamadas diretas. A casca
        // HTTP NÃO passa por aqui: ela clona o estado e chama [`dispatch_sim`]
        // sem segurar lock nenhum.
        "eth_call" | "eth_estimateGas" => {
            let height = node.blockchain.height().max(0) as u64;
            let block_ts = node.blockchain.head().map(|b| b.timestamp.max(0) as u64).unwrap_or(0);
            dispatch_sim(&mut node.blockchain.state, height, block_ts, method, params)
        }
        // `eth_sendRawTransaction` — `rpc.js:236-245`: constrói o envelope a
        // partir do raw assinado e o submete. Retorna o `data.eavmHash` (keccak256
        // dos bytes do raw, `0x…` minúsculo) — NÃO o `id` do envelope eav20.
        "eth_sendRawTransaction" => {
            let raw = param(0)
                .and_then(Value::as_str)
                .ok_or_else(|| RpcError::invalid_params("raw ausente"))?;
            // `buildEavmEnvelope(raw, { state })` (`rpc.js:237`): a isenção de
            // taxa depende do REMETENTE, que só é conhecido depois de decodificar
            // o raw — por isso o estado entra como predicado, avaliado lá dentro.
            // Enquanto era um `false` fixo, uma conta isenta recebia envelope com
            // o teto da tabela onde a referência põe "0". `fee` é TETO de queima e
            // não entra no `id` do esquema EAVM (que sai do raw), então nunca foi
            // divergência de consenso — mas era teto autorizado a mais.
            let estado = &node.blockchain.state;
            let envelope = build_eavm_envelope(raw, now_ms(), |de| estado.is_fee_exempt(de))
                .map_err(RpcError::new)?;
            // O hash a devolver sai do envelope ANTES do move para o mempool.
            let eavm_hash = data_str(&envelope, "eavmHash")
                .ok_or_else(|| RpcError::new("envelope sem eavmHash"))?
                .to_string();
            // `node.submitTransaction` + regra do `rpc.js:240-242`: só é erro se
            // NÃO foi aceita E o motivo não é "transação já conhecida" (reenvio da
            // mesma tx devolve o hash normalmente — idempotente).
            match node.submit_transaction(envelope) {
                Ok(outcome) => {
                    if !outcome.accepted && outcome.reason.as_deref() != Some("transação já conhecida") {
                        return Err(RpcError::new(outcome.reason.unwrap_or_else(|| "transação rejeitada".into())));
                    }
                }
                Err(e) => return Err(RpcError::new(e)),
            }
            Ok(json!(eavm_hash))
        }
        // Tudo o mais é somente leitura.
        _ => dispatch_read(node, method, params),
    }
}

/// Miolo de `eth_call`/`eth_estimateGas` sobre um `State` qualquer — o próprio
/// do `Node` (em [`dispatch`], sob lock) ou um CLONE (na casca HTTP, sem lock).
/// Um corpo só para os dois caminhos: a margem de gas e a propagação do revert
/// não podem divergir entre eles.
fn dispatch_sim(
    state: &mut eav7::state::State,
    height: u64,
    block_ts: u64,
    method: &str,
    params: &Value,
) -> Result<Value, RpcError> {
    let call = params.get(0);
    match method {
        // `eth_call` — `rpc.js:176-187`: executa de verdade contra o estado atual
        // e DESFAZ tudo (`State::call_eavm`). Revert propaga o `returnData` como
        // erro, que é o que faz o ethers.js decodificar a razão.
        "eth_call" => {
            let out = executa_call_em(state, height, block_ts, call, None)?;
            if !out.success {
                return Err(RpcError::revert("execução revertida", out.return_data));
            }
            Ok(json!(out.return_data))
        }
        // `eth_estimateGas` — `rpc.js:189-201`. Sem `to` é DEPLOY: custo fixo de
        // config. Com `to`, executa e devolve `ceil(gasUsed × 1.25) + 21000` — a
        // margem de 25% que a referência aplica (o custo real depende do estado no
        // momento da inclusão; subestimar reverte a tx).
        "eth_estimateGas" => {
            let tem_to = call.and_then(|c| c.get("to")).and_then(Value::as_str).is_some();
            if !tem_to {
                // `CHAIN.ENERGY.COST.EAVM_DEPLOY * CHAIN.GAS_PER_ENERGY` (`rpc.js:191`).
                // O custo BASE de energia do deploy (10, `config.js:344` — distinto
                // do FEE de 200000) sai da tabela da lib, `eav7::config::energy_cost`
                // (o porte de `CHAIN.ENERGY.COST`). 10 × 100 = 1000 (0x3e8).
                return Ok(json!(to_hex(c::energy_cost("EAVM_DEPLOY") as u128 * c::GAS_PER_ENERGY as u128)));
            }
            let out = executa_call_em(state, height, block_ts, call, None)?;
            if !out.success {
                return Err(RpcError::revert("execução revertida", out.return_data));
            }
            // `Math.ceil(gasUsed * 1.25) + 21000` em f64, para reproduzir o
            // arredondamento do JS ao byte.
            let estimado = ((out.gas_used as f64) * 1.25).ceil() as u128 + 21000;
            Ok(json!(to_hex(estimado)))
        }
        _ => Err(RpcError::with_code(format!("método não suportado: {method}"), -32601)),
    }
}

/// Extrai `{from,to,data,value}` de um objeto de chamada e roda `State::call_eavm`
/// (execução que a própria VM reverte pelo journal). Recebe o `State` e o contexto
/// de bloco já separados do `Node`, para servir tanto o caminho sob lock quanto o
/// clone sem lock.
fn executa_call_em(
    state: &mut eav7::state::State,
    height: u64,
    block_ts: u64,
    call: Option<&Value>,
    gas: Option<u64>,
) -> Result<eav7::state::contracts::EavmCallResult, RpcError> {
    let obj_str = |key: &str| call.and_then(|c| c.get(key)).and_then(Value::as_str);
    // `data ?? input ?? '0x'` (`rpc.js:179`).
    let data = obj_str("data").or_else(|| obj_str("input")).unwrap_or("0x").to_string();
    // `to` é obrigatório para executar; ausente cai como destino inválido dentro
    // de `call_eavm` (mesma mensagem da referência).
    let to = obj_str("to").unwrap_or("").to_string();
    let from = obj_str("from").map(str::to_string);
    // `call.value ? BigInt(call.value) : 0n` (`rpc.js:181`).
    let value: Amount = obj_str("value").and_then(parse_quantity).unwrap_or(0);
    state
        .call_eavm(EavmCallParams {
            from: from.as_deref(),
            to: &to,
            data: &data,
            value,
            height,
            block_ts,
            gas,
        })
        .map_err(|e| RpcError::new(e.to_string()))
}

// ---------------------------------------------------------------------------
// Casca axum — JSON-RPC 2.0 sobre HTTP
// ---------------------------------------------------------------------------

/// Corpo máximo aceito (`rpc.js:379`): 1 MB.
const MAX_BODY: usize = 1024 * 1024;

/// Roteador do servidor RPC. Uma única rota `/` que despacha por `method` — o
/// modelo JSON-RPC. GET devolve a ficha da rede (para humanos que abrem a URL no
/// navegador); OPTIONS responde o preflight de CORS.
pub fn router() -> Router<AppState> {
    Router::new().route("/", post(handle_post).get(handle_get).options(handle_options))
}

/// Headers de CORS que o JS põe em TODA resposta (`rpc.js:350-352`).
fn cors() -> [(&'static str, &'static str); 3] {
    [
        ("access-control-allow-origin", "*"),
        ("access-control-allow-headers", "content-type"),
        ("access-control-allow-methods", "GET, POST, OPTIONS"),
    ]
}

/// Resposta JSON com status 200 e os headers de CORS.
fn json_ok(v: Value) -> Response {
    (cors(), Json(v)).into_response()
}

/// `OPTIONS` → 204 sem corpo (`rpc.js:353-357`).
async fn handle_options() -> Response {
    (axum::http::StatusCode::NO_CONTENT, cors()).into_response()
}

/// `GET` → ficha da rede para adicionar na carteira (`rpc.js:363-372`).
async fn handle_get() -> Response {
    json_ok(json!({
        "chain": c::NAME,
        "protocolo": "EAVM (protocolo próprio da EAV7)",
        "chainId": c::EAVM_CHAIN_ID,
        "currency": { "symbol": c::SYMBOL, "decimals": 18 },
        "dica": "adicione esta URL como RPC de rede customizada na MetaMask ou Trust Wallet",
    }))
}

/// `POST` — o corpo JSON-RPC (objeto único OU lote). Espelha `rpc.js:374-394`.
async fn handle_post(State(state): State<AppState>, body: Bytes) -> Response {
    // Teto de corpo ANTES de parsear (`rpc.js:378-380`).
    if body.len() > MAX_BODY {
        return json_ok(erro_parse("corpo excede 1 MB"));
    }
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        // `catch` → -32700 (parse error), id null (`rpc.js:391-393`).
        Err(e) => return json_ok(erro_parse(e.to_string())),
    };

    // Lote: `Array.isArray(body)` (`rpc.js:386`). Teto de lote (`rpc.js:383`).
    if let Value::Array(itens) = &parsed {
        if itens.len() as u64 > c::MAX_RPC_BATCH {
            return json_ok(erro_parse(format!("lote JSON-RPC excede {} chamadas", c::MAX_RPC_BATCH)));
        }
        // Cada item é despachado com seu próprio lock (read/write conforme o
        // método) — o lock nunca cruza `await` porque `handle_one` é síncrono.
        let respostas: Vec<Value> = itens.iter().map(|req| handle_one(&state, req)).collect();
        return json_ok(Value::Array(respostas));
    }

    json_ok(handle_one(&state, &parsed))
}

/// Um `{jsonrpc, id, error}` de parse/entrada — id sempre `null` (`rpc.js:393`).
fn erro_parse(msg: impl Into<String>) -> Value {
    json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": msg.into() } })
}

/// Processa UMA requisição JSON-RPC — pega o lock certo, despacha, embrulha em
/// `{jsonrpc, id, result|error}` (`rpc.js:338-347`). Síncrono: o guard do lock é
/// pego e solto aqui dentro, sem `await` no meio.
fn handle_one(state: &AppState, req: &Value) -> Value {
    // `request?.id ?? null` (`rpc.js:339`).
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    // `typeof request.method !== 'string'` → -32600 (`rpc.js:341`).
    let Some(method) = req.get("method").and_then(Value::as_str) else {
        return json!({ "jsonrpc": "2.0", "id": id, "error": RpcError::with_code("requisição inválida", -32600).to_json() });
    };
    let vazio = Value::Array(vec![]);
    let params = req.get("params").unwrap_or(&vazio);

    // Read lock para leitura; write lock só em submissão ao mempool.
    // `eth_call` / `eth_estimateGas`: clona o State sob read e executa FORA do lock.
    // Lock envenenado → -32603 (internal error).
    let resultado = if matches!(method, "eth_call" | "eth_estimateGas") {
        // READ lock só para o snapshot (estado + contexto de bloco, capturados no
        // MESMO guard — em guards separados o timestamp poderia ser de outra
        // altura). O guard é solto ANTES da simulação: a VM pode rodar até o teto
        // de gas, e segurar qualquer lock aqui bloquearia o produtor de blocos.
        match state.read() {
            Ok(node) => {
                let mut st = node.blockchain.state.clone();
                let height = node.blockchain.height().max(0) as u64;
                let block_ts = node.blockchain.head().map(|b| b.timestamp.max(0) as u64).unwrap_or(0);
                drop(node);
                dispatch_sim(&mut st, height, block_ts, method, params)
            }
            Err(PoisonError { .. }) => Err(RpcError::with_code("estado envenenado", -32603)),
        }
    } else if needs_write(method) {
        match state.write() {
            Ok(mut node) => dispatch(&mut node, method, params),
            Err(PoisonError { .. }) => Err(RpcError::with_code("estado envenenado", -32603)),
        }
    } else {
        match state.read() {
            Ok(node) => dispatch_read(&node, method, params),
            Err(PoisonError { .. }) => Err(RpcError::with_code("estado envenenado", -32603)),
        }
    };

    match resultado {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e.to_json() }),
    }
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, RwLock};

    use eav7::blockchain::{Blockchain, EventoIndexado, Recibo};
    use eav7::mempool::Mempool;

    use crate::guard::{AbuseGuard, GuardConfig};

    /// Um `Node` montado à mão, como no teste de `node.rs`.
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
            eavm_enabled: true,
            eavm_port: 7070,
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

    // Um raw EAVM_TRANSFER válido, extraído de `vectors/eavm-envelope.json`
    // ("transferência simples"). eavmHash conhecido, from E7 conhecido.
    const RAW_TRANSFER: &str = "0xf86d80856edf2a079e832dc6c094777777777777777777777777777777777777777785e8d4a5100080830232cba0550fe727de2fb864a6f1691e38476cbdd7b86973635bfa6d2805b53368f9bcf5a04d6f03ff12fca1087dc6788278005ae289208039a985f043b8436ae2a8c06952";
    const RAW_EAVM_HASH: &str = "0x8694744505343ca930cdc569aca403225b863ab972443398763341901d2852b7";

    #[test]
    fn chain_id_em_hex_e_net_version_decimal() {
        let n = node();
        assert_eq!(dispatch_read(&n, "eth_chainId", &json!([])).unwrap(), json!("0x11954"));
        assert_eq!(dispatch_read(&n, "net_version", &json!([])).unwrap(), json!("72020"));
    }

    #[test]
    fn block_number_e_gas_price() {
        let n = node();
        // Cadeia recém-criada (só gênese): altura 0.
        assert_eq!(dispatch_read(&n, "eth_blockNumber", &json!([])).unwrap(), json!("0x0"));
        // GAS_PRICE = 10000 * 1e12 / 21000 = 476190476190476 = 0x1b1ae4d6e2ef4.
        assert_eq!(
            dispatch_read(&n, "eth_gasPrice", &json!([])).unwrap(),
            json!(to_hex(GAS_PRICE))
        );
    }

    #[test]
    fn get_code_de_conta_sem_contrato_e_0x() {
        let n = node();
        let addr = "0x0000000000000000000000000000000000000001";
        assert_eq!(dispatch_read(&n, "eth_getCode", &json!([addr])).unwrap(), json!("0x"));
        // Endereço malformado → erro -32000 "endereço inválido" (fidelidade JS).
        let err = dispatch_read(&n, "eth_getCode", &json!(["0x123"])).unwrap_err();
        assert_eq!(err.code, -32000);
    }

    #[test]
    fn get_balance_converte_para_wei() {
        let n = node();
        // Conta 0x sem saldo → 0x0.
        let addr = "0x00000000000000000000000000000000000000aa";
        assert_eq!(dispatch_read(&n, "eth_getBalance", &json!([addr])).unwrap(), json!("0x0"));
    }

    #[test]
    fn send_raw_transaction_entra_no_mempool_e_devolve_o_eavm_hash() {
        let mut n = node();
        let out = dispatch(&mut n, "eth_sendRawTransaction", &json!([RAW_TRANSFER])).unwrap();
        // O retorno é o eavmHash (keccak dos bytes do raw), NÃO o id do envelope.
        assert_eq!(out, json!(RAW_EAVM_HASH));
        assert_eq!(n.mempool.len(), 1, "a tx tem de entrar no mempool");
        // E fica encontrável por hash (pendente, sem bloco).
        let porh = dispatch_read(&n, "eth_getTransactionByHash", &json!([RAW_EAVM_HASH])).unwrap();
        assert_eq!(porh["hash"], json!(RAW_EAVM_HASH));
        assert_eq!(porh["blockNumber"], Value::Null, "pendente não tem bloco");
    }

    /// G4: `eth_call`/`eth_estimateGas` NÃO seguram o write lock do `Node`
    /// durante a simulação. O teste estaciona um READ guard e despacha as duas
    /// chamadas em outra thread: na versão antiga (write lock pela simulação
    /// inteira) elas ficariam bloqueadas atrás do leitor — exatamente como o
    /// produtor de blocos ficava bloqueado atrás delas — e o teste estouraria o
    /// timeout. Com o snapshot sob read lock, completam em paralelo.
    #[test]
    fn eth_call_e_estimate_gas_simulam_sem_write_lock() {
        let estado: AppState = Arc::new(RwLock::new(node()));
        let _leitor = estado.read().unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        let estado2 = estado.clone();
        std::thread::spawn(move || {
            let alvo = format!("0x{}", "77".repeat(20));
            let call = json!({ "jsonrpc": "2.0", "id": 1, "method": "eth_call",
                               "params": [{ "to": alvo, "data": "0x" }] });
            let gas = json!({ "jsonrpc": "2.0", "id": 2, "method": "eth_estimateGas",
                              "params": [{ "to": alvo, "data": "0x" }] });
            let _ = tx.send((handle_one(&estado2, &call), handle_one(&estado2, &gas)));
        });

        let (r_call, r_gas) = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("simulação não pode esperar write lock: bloquearia atrás de qualquer leitor");
        // Destino sem código: execução vazia bem-sucedida, retorno "0x".
        assert_eq!(r_call["result"], json!("0x"));
        // gasUsed 0 → ceil(0 × 1.25) + 21000 = 21000 (0x5208).
        assert_eq!(r_gas["result"], json!("0x5208"));
    }

    #[test]
    fn metodo_desconhecido_e_menos_32601() {
        let n = node();
        let err = dispatch_read(&n, "eth_naoExiste", &json!([])).unwrap_err();
        assert_eq!(err.code, -32601);
    }

    #[test]
    fn params_malformados_sao_menos_32602() {
        let n = node();
        // eth_getBalance SEM o parâmetro de endereço → invalid params.
        let err = dispatch_read(&n, "eth_getBalance", &json!([])).unwrap_err();
        assert_eq!(err.code, -32602);
    }

    #[test]
    fn transaction_by_hash_inexistente_e_null() {
        let n = node();
        let out = dispatch_read(&n, "eth_getTransactionByHash", &json!(["0xdead"])).unwrap();
        assert_eq!(out, Value::Null);
    }

    /// Sobe o servidor RPC numa porta efêmera e faz um POST `eth_chainId` real,
    /// falando HTTP/1.1 por um TcpStream cru. O cliente é BLOQUEANTE (`std::net`,
    /// via `spawn_blocking`) porque o crate não habilita a feature `io-util` do
    /// tokio — e adicionar dependência num teste seria mudar a árvore por engano.
    #[tokio::test]
    async fn servidor_responde_eth_chain_id_de_verdade() {
        let estado: AppState = Arc::new(RwLock::new(node()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = router().with_state(estado);
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let v = tokio::task::spawn_blocking(move || {
            use std::io::{Read, Write};
            let corpo = r#"{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}"#;
            let req = format!(
                "POST / HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                corpo.len(),
                corpo
            );
            let mut stream = std::net::TcpStream::connect(addr).unwrap();
            stream.write_all(req.as_bytes()).unwrap();
            let mut resposta = String::new();
            stream.read_to_string(&mut resposta).unwrap();
            let corpo_json = resposta.split("\r\n\r\n").nth(1).expect("corpo HTTP").trim().to_string();
            serde_json::from_str::<Value>(&corpo_json).expect("JSON de resposta")
        })
        .await
        .unwrap();

        assert_eq!(v["result"], json!("0x11954"));
        assert_eq!(v["id"], json!(1));
    }
    /// O índice REINDEXA quando a cadeia encolhe (reorg).
    ///
    /// Sem isto, um reorg deixaria no índice hashes de blocos que não existem
    /// mais, e `eth_getTransactionReceipt` devolveria recibo de transação órfã
    /// como se estivesse na cadeia — a ferramenta confirmaria um pagamento que
    /// foi descartado. É a razão de o JS zerar `indexedHeight` (`rpc.js:52`).
    #[test]
    fn indice_eavm_reindexa_quando_a_cadeia_encolhe() {
        let n = node();

        // Simula um índice já construído numa altura à frente da cadeia atual —
        // exatamente o estado em que um reorg deixa o nó.
        {
            let mut idx = n.eavm_index.lock().expect("lock");
            idx.por_hash.insert("0xorfã".into(), "id-de-bloco-descartado".into());
            idx.altura_indexada = 999;
        }
        assert!(n.blockchain.height() < 999, "a cadeia de teste é menor que o índice");

        garantir_indexado(&n);

        let idx = n.eavm_index.lock().expect("lock");
        assert!(
            !idx.por_hash.contains_key("0xorfã"),
            "o hash órfão tem de sair do índice na reindexação"
        );
        assert_eq!(idx.altura_indexada, n.blockchain.height());
    }

    /// Consulta por hash desconhecido não varre a cadeia nem inventa resultado.
    #[test]
    fn hash_desconhecido_nao_encontra_nada() {
        let n = node();
        assert!(find_eavm_tx(&n, "0xnaoexiste").is_none());
    }


    // ------------------------------------------- recibo real e eventos minerados

    /// Nó com UM bloco minerado contendo uma tx EAVM, e os índices node-locais
    /// (`receipts`/`log_index`) povoados como o `add_block` os povoa.
    ///
    /// Monta a cadeia pelos campos em vez de produzir bloco assinado: o que está
    /// sob teste aqui é a LEITURA feita pelo RPC. A gravação tem teste próprio na
    /// lib (`blockchain.rs`), sobre contratos que executam de verdade.
    fn node_com_tx_minerada(
        eavm_hash: &str,
        recibo: Option<Recibo>,
        logs: Vec<EventoIndexado>,
    ) -> Node {
        use eav7::block::Block;

        let mut tx = Tx::new("EAVM_CALL", "E7ORIGEM", 1, 1_700_000_000_000);
        tx.scheme = "eavm-eip155-1".into();
        tx.id = Some("id-da-tx".into());
        tx.data = Some(JsonValue::map([
            ("eavmHash".to_string(), JsonValue::str(eavm_hash)),
            ("eavmFrom".to_string(), JsonValue::str(format!("0x{}", "11".repeat(20)))),
            ("eavmTo".to_string(), JsonValue::str(format!("0x{}", "22".repeat(20)))),
        ]));

        let bloco = Block {
            protocol: "eav20".into(),
            version: 1,
            scheme: "eav7-hybrid-1".into(),
            height: 7,
            timestamp: 1_700_000_000_000,
            previous_hash: "00".repeat(32),
            tx_root: "00".repeat(32),
            tx_count: 1,
            producer: "E7PRODUTOR".into(),
            public_key: None,
            pq_public_key: None,
            state_root: None,
            producer_account: None,
            genesis: None,
            signature: String::new(),
            pq_signature: String::new(),
            hash: "ab".repeat(32),
            transactions: vec![tx],
        };

        let mut n = node();
        n.blockchain.tail = vec![bloco.clone()];
        n.blockchain.tail_start = 7;
        n.blockchain.hashes.insert(7, bloco.hash.clone());
        n.blockchain.hash_index.insert(bloco.hash.clone(), 7);
        n.blockchain.tx_index.insert("id-da-tx".into(), 7);
        // O índice EAVM só varre blocos COM transação — sem esta entrada, o bloco
        // é pulado e o RPC não acharia a tx.
        n.blockchain.blocks_with_txs.push(7);
        if let Some(r) = recibo {
            n.blockchain.receipts.insert("id-da-tx".into(), r);
        }
        n.blockchain.log_index = logs;
        n
    }

    fn evento(topico: &str, endereco: &str) -> EventoIndexado {
        EventoIndexado {
            tx_id: "id-da-tx".into(),
            block_height: 7,
            block_time: 1_700_000_000_000,
            address: endereco.into(),
            topics: vec![topico.into()],
            data: "0x2a".into(),
        }
    }

    /// Chamada REVERTIDA sai com `status: 0x0`.
    ///
    /// É o motivo de o índice de recibos existir: enquanto ele não havia, o RPC
    /// respondia `0x1` para tudo e a carteira mostrava sucesso para uma
    /// transação que não fez nada.
    #[test]
    fn recibo_de_chamada_revertida_sai_com_status_zero() {
        let hash = format!("0x{}", "cd".repeat(32));
        let n = node_com_tx_minerada(
            &hash,
            Some(Recibo { success: false, gas_used: 31_337, contract: None, block_height: 7 }),
            vec![evento(&format!("0x{}", "aa".repeat(32)), &format!("0x{}", "33".repeat(20)))],
        );
        let r = dispatch_read(&n, "eth_getTransactionReceipt", &json!([hash])).expect("recibo");
        assert_eq!(r["status"], json!("0x0"), "reverteu — não pode sair como sucesso");
        assert_eq!(r["gasUsed"], json!(to_hex(31_337)), "o gás consumido é REAL");
        assert_eq!(r["cumulativeGasUsed"], json!(to_hex(31_337)));
        assert_eq!(r["logs"], json!([]), "execução revertida não emite evento");
        assert_eq!(r["contractAddress"], Value::Null);
        assert_eq!(r["blockNumber"], json!("0x7"));
    }

    /// Recibo de DEPLOY carrega `contractAddress` — é como `tx.wait()` do
    /// ethers/Hardhat descobre o endereço do contrato recém-publicado.
    #[test]
    fn recibo_de_deploy_carrega_o_contract_address() {
        let hash = format!("0x{}", "ce".repeat(32));
        let contrato = format!("0x{}", "44".repeat(20));
        let n = node_com_tx_minerada(
            &hash,
            Some(Recibo {
                success: true,
                gas_used: 200_000,
                contract: Some(contrato.clone()),
                block_height: 7,
            }),
            Vec::new(),
        );
        let r = dispatch_read(&n, "eth_getTransactionReceipt", &json!([hash])).expect("recibo");
        assert_eq!(r["status"], json!("0x1"));
        assert_eq!(r["contractAddress"], json!(contrato));
    }

    /// Transação SEM recibo registrado é transferência simples: sucesso e 21000.
    /// É o fallback do JS (`rpc.js:253-255`) — e o único caso em que o valor fixo
    /// está certo.
    #[test]
    fn transferencia_simples_mantem_o_fallback_de_21000() {
        let hash = format!("0x{}", "cf".repeat(32));
        let n = node_com_tx_minerada(&hash, None, Vec::new());
        let r = dispatch_read(&n, "eth_getTransactionReceipt", &json!([hash])).expect("recibo");
        assert_eq!(r["status"], json!("0x1"));
        assert_eq!(r["gasUsed"], json!("0x5208"), "21000");
    }

    /// O recibo leva SÓ os eventos da própria transação, no formato Ethereum.
    #[test]
    fn recibo_leva_os_eventos_da_propria_transacao() {
        let hash = format!("0x{}", "da".repeat(32));
        let topico = format!("0x{}", "aa".repeat(32));
        let contrato = format!("0x{}", "33".repeat(20));
        let mut logs = vec![evento(&topico, &contrato)];
        // Evento de OUTRA transação do mesmo bloco: numera junto, mas não entra
        // neste recibo.
        logs.push(EventoIndexado { tx_id: "outra-tx".into(), ..evento(&topico, &contrato) });
        let n = node_com_tx_minerada(
            &hash,
            Some(Recibo { success: true, gas_used: 60_000, contract: None, block_height: 7 }),
            logs,
        );
        let r = dispatch_read(&n, "eth_getTransactionReceipt", &json!([hash])).expect("recibo");
        let logs = r["logs"].as_array().expect("lista de logs");
        assert_eq!(logs.len(), 1, "só o evento da própria transação");
        assert_eq!(logs[0]["address"], json!(contrato));
        assert_eq!(logs[0]["topics"], json!([topico]));
        assert_eq!(logs[0]["data"], json!("0x2a"));
        assert_eq!(logs[0]["logIndex"], json!("0x0"));
        assert_eq!(logs[0]["transactionHash"], json!(hash));
        assert_eq!(logs[0]["blockHash"], json!(format!("0x{}", "ab".repeat(32))));
        assert_eq!(logs[0]["removed"], json!(false));
    }

    /// `eth_getLogs` devolve os eventos da faixa — antes era `[]` para sempre, o
    /// que impedia qualquer indexador ou subgraph de acompanhar a cadeia.
    #[test]
    fn get_logs_devolve_os_eventos_da_faixa() {
        let contrato = format!("0x{}", "33".repeat(20));
        let topico = format!("0x{}", "aa".repeat(32));
        let n = node_com_tx_minerada(
            &format!("0x{}", "db".repeat(32)),
            None,
            vec![evento(&topico, &contrato)],
        );
        let r = dispatch_read(&n, "eth_getLogs", &json!([{ "fromBlock": "0x7", "toBlock": "0x7" }]))
            .expect("logs");
        assert_eq!(r.as_array().expect("lista").len(), 1);
        assert_eq!(r[0]["address"], json!(contrato));
        assert_eq!(r[0]["blockNumber"], json!("0x7"));
    }

    /// O filtro por endereço e por tópico é POSICIONAL, com `null` casando com
    /// qualquer coisa e array casando com qualquer um dos valores.
    #[test]
    fn get_logs_filtra_por_endereco_e_por_topico() {
        let a = format!("0x{}", "33".repeat(20));
        let b = format!("0x{}", "44".repeat(20));
        let t1 = format!("0x{}", "aa".repeat(32));
        let t2 = format!("0x{}", "bb".repeat(32));
        let n = node_com_tx_minerada(
            &format!("0x{}", "dc".repeat(32)),
            None,
            vec![evento(&t1, &a), evento(&t2, &b)],
        );
        let consulta = |f: Value| {
            dispatch_read(&n, "eth_getLogs", &json!([f])).expect("logs").as_array().expect("lista").len()
        };
        assert_eq!(consulta(json!({ "address": a })), 1, "um endereço");
        assert_eq!(consulta(json!({ "address": [a.clone(), b.clone()] })), 2, "lista de endereços");
        assert_eq!(consulta(json!({ "address": a.to_uppercase() })), 1, "caixa não importa");
        assert_eq!(consulta(json!({ "topics": [t1.clone()] })), 1, "tópico posicional");
        assert_eq!(consulta(json!({ "topics": [[t1.clone(), t2.clone()]] })), 2, "array = OU");
        assert_eq!(consulta(json!({ "topics": [Value::Null] })), 2, "null casa com tudo");
        assert_eq!(consulta(json!({ "topics": [t1.clone(), t2.clone()] })), 0, "filtro mais longo que os tópicos do log");
    }

    /// Faixa acima do teto é RECUSADA — sem isso, `eth_getLogs` de 0 até o topo
    /// varre a cadeia inteira a cada chamada, que é o DoS clássico do método.
    #[test]
    fn get_logs_recusa_faixa_acima_do_teto_e_invertida() {
        let n = node_com_tx_minerada(&format!("0x{}", "dd".repeat(32)), None, Vec::new());
        let erro = dispatch_read(
            &n,
            "eth_getLogs",
            &json!([{ "fromBlock": "0x0", "toBlock": to_hex(c::MAX_LOG_RANGE as u128 + 1) }]),
        )
        .expect_err("faixa grande demais");
        assert!(erro.message.contains("faixa de blocos acima do máximo"), "{}", erro.message);

        let erro = dispatch_read(&n, "eth_getLogs", &json!([{ "fromBlock": "0x9", "toBlock": "0x1" }]))
            .expect_err("faixa invertida");
        assert!(erro.message.contains("fromBlock maior que toBlock"), "{}", erro.message);
    }

    /// `logIndex` é a posição DENTRO do bloco e não muda com o filtro: duas
    /// consultas diferentes têm de devolver o mesmo índice para o mesmo evento.
    #[test]
    fn log_index_nao_depende_do_filtro() {
        let a = format!("0x{}", "33".repeat(20));
        let b = format!("0x{}", "44".repeat(20));
        let t = format!("0x{}", "aa".repeat(32));
        let n = node_com_tx_minerada(
            &format!("0x{}", "de".repeat(32)),
            None,
            vec![evento(&t, &a), evento(&t, &b)],
        );
        let so_b = dispatch_read(&n, "eth_getLogs", &json!([{ "address": b }])).expect("logs");
        assert_eq!(so_b[0]["logIndex"], json!("0x1"), "o segundo log do bloco continua sendo o 1");
    }
}
