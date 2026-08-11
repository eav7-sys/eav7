//! Deploy EAV20 (plano 19 / T4.2) na EAVM a partir do artefato solc shanghai.
//!
//! Compilar: `npx solc@0.8.26 --standard-json` com `evmVersion: shanghai`
//! → `contracts/artifacts/EAV20.bin`.

use eav7::config::{EAVM_CONTRACTS_HEIGHT, EAVM_VALUE_HEIGHT, UNIT};
use eav7::state::contracts::encode_e7_dest;
use eav7::state::{Account, State};
use eav7::transaction::{JsonValue, Tx};
use std::collections::BTreeMap;
use std::path::PathBuf;

fn artifact_bin(name: &str) -> Vec<u8> {
    let caminho = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo")
        .join("contracts/artifacts")
        .join(format!("{name}.bin"));
    let hex = std::fs::read_to_string(&caminho).unwrap_or_else(|e| {
        panic!(
            "artefato ausente {}: {e}\ncompile com solc 0.8.26 shanghai → contracts/artifacts/",
            caminho.display()
        )
    });
    let hex = hex.trim();
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex"))
        .collect()
}

fn word_u64(n: u64) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[24..].copy_from_slice(&n.to_be_bytes());
    w
}

fn word_u128(n: u128) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[16..].copy_from_slice(&n.to_be_bytes());
    w
}

fn pad32_addr(addr20: &[u8; 20]) -> [u8; 32] {
    let mut w = [0u8; 32];
    w[12..].copy_from_slice(addr20);
    w
}

fn parse_addr20(addr_0x: &str) -> [u8; 20] {
    let h = addr_0x.trim_start_matches("0x");
    let mut a = [0u8; 20];
    for i in 0..20 {
        a[i] = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16).unwrap();
    }
    a
}

fn abi_string(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&word_u64(s.len() as u64));
    out.extend_from_slice(s.as_bytes());
    let pad = (32 - (s.len() % 32)) % 32;
    out.extend(std::iter::repeat_n(0u8, pad));
    out
}

/// ABI de `(string,string,uint8,uint256,address)`.
fn encode_eav20_ctor(
    name: &str,
    symbol: &str,
    decimals: u8,
    supply: u128,
    recipient_0x: &str,
) -> Vec<u8> {
    let name_enc = abi_string(name);
    let sym_enc = abi_string(symbol);
    let head_len = 5 * 32;
    let mut head = Vec::with_capacity(head_len);
    let off_name = head_len as u64;
    let off_sym = off_name + name_enc.len() as u64;
    head.extend_from_slice(&word_u64(off_name));
    head.extend_from_slice(&word_u64(off_sym));
    let mut dec = [0u8; 32];
    dec[31] = decimals;
    head.extend_from_slice(&dec);
    head.extend_from_slice(&word_u128(supply));
    head.extend_from_slice(&pad32_addr(&parse_addr20(recipient_0x)));
    let mut out = head;
    out.extend_from_slice(&name_enc);
    out.extend_from_slice(&sym_enc);
    out
}

fn encode_transfer(to_0x: &str, amount: u128) -> String {
    let mut data = vec![0xa9, 0x05, 0x9c, 0xbb];
    data.extend_from_slice(&pad32_addr(&parse_addr20(to_0x)));
    data.extend_from_slice(&word_u128(amount));
    format!("0x{}", hex::encode(data))
}

fn selector(sig: &str) -> [u8; 4] {
    use sha3::{Digest, Keccak256};
    let h = Keccak256::digest(sig.as_bytes());
    [h[0], h[1], h[2], h[3]]
}

/// `createMinimal(string,string,uint8,uint256,address)` — mesmo head ABI do ctor EAV20.
fn encode_create_minimal(
    name: &str,
    symbol: &str,
    decimals: u8,
    supply: u128,
    recipient_0x: &str,
) -> String {
    let mut data = selector("createMinimal(string,string,uint8,uint256,address)").to_vec();
    data.extend_from_slice(&encode_eav20_ctor(name, symbol, decimals, supply, recipient_0x));
    format!("0x{}", hex::encode(data))
}

fn topic_token_created() -> String {
    use sha3::{Digest, Keccak256};
    let h = Keccak256::digest(b"TokenCreated(address,address,string,uint8)");
    format!("0x{}", hex::encode(h))
}

fn apply_deploy(s: &mut State, from: &str, nonce: i64, code: &[u8], height: u64, ts: i64) -> String {
    let mut deploy = Tx::new("EAVM_DEPLOY", from, nonce, ts);
    deploy.fee = "100000000".into();
    deploy.amount = "0".into();
    deploy.data = Some(JsonValue::Map(BTreeMap::from([(
        "code".into(),
        JsonValue::Str(format!("0x{}", hex::encode(code))),
    )])));
    let applied = s.apply_transaction(&deploy, height, ts.max(0) as u64).expect("deploy");
    let r = applied.eavm.expect("recibo");
    assert!(r.success, "deploy deve suceder");
    r.contract_addr
}

fn apply_call(
    s: &mut State,
    from: &str,
    nonce: i64,
    to_0x: &str,
    input: &str,
    height: u64,
    ts: i64,
) -> eav7::state::eavm_tx::EavmOutcome {
    let mut call = Tx::new("EAVM_CALL", from, nonce, ts);
    call.fee = "100000000".into();
    call.amount = "0".into();
    call.data = Some(JsonValue::Map(BTreeMap::from([
        ("to".into(), JsonValue::Str(to_0x.into())),
        ("input".into(), JsonValue::Str(input.into())),
    ])));
    let applied = s.apply_transaction(&call, height, ts.max(0) as u64).expect("call");
    applied.eavm.expect("recibo")
}

fn conta_rica(s: &mut State, de: &str) {
    s.accounts.insert(
        de.into(),
        Account {
            balance: 100 * UNIT,
            staked: 100_000 * UNIT,
            ..Default::default()
        },
    );
}

#[test]
fn eav20_deploy_e_transfer_na_eavm() {
    let creation = artifact_bin("EAV20");
    let de = "E7D91885C11BD3DAD3F2824FAD4E94BD9A";
    let recipient_0x = encode_e7_dest(de).expect("dest");
    let supply = 1_000_000 * UNIT;

    let mut code = creation;
    code.extend_from_slice(&encode_eav20_ctor(
        "EAV Token",
        "EAV",
        6,
        supply,
        &recipient_0x,
    ));

    let mut s = State::new();
    conta_rica(&mut s, de);
    let height = EAVM_CONTRACTS_HEIGHT.max(EAVM_VALUE_HEIGHT);
    let contrato = apply_deploy(&mut s, de, 1, &code, height, 1_700_000_000_000);

    let para_0x = "0x2222222222222222222222222222222222222222";
    let recibo = apply_call(
        &mut s,
        de,
        2,
        &contrato,
        &encode_transfer(para_0x, 250_000_000),
        height,
        1_700_000_000_001,
    );
    assert!(recibo.success, "transfer EAV20 deve suceder");
    assert!(!recibo.logs.is_empty(), "evento Transfer");
}

#[test]
fn eav20_factory_create_minimal_e_transfer() {
    let de = "E7D91885C11BD3DAD3F2824FAD4E94BD9A";
    let recipient_0x = encode_e7_dest(de).expect("dest");
    let supply = 1_000_000 * UNIT;
    let height = EAVM_CONTRACTS_HEIGHT.max(EAVM_VALUE_HEIGHT);

    let mut s = State::new();
    conta_rica(&mut s, de);

    // Factory sem args de construtor.
    let factory = apply_deploy(&mut s, de, 1, &artifact_bin("EAV20Factory"), height, 1_700_000_000_000);

    let create = encode_create_minimal("Via Factory", "FAC", 6, supply, &recipient_0x);
    let recibo = apply_call(&mut s, de, 2, &factory, &create, height, 1_700_000_000_001);
    assert!(recibo.success, "createMinimal");
    let topic = topic_token_created();
    let log = recibo
        .logs
        .iter()
        .find(|l| l.topics.first().map(|t| t.eq_ignore_ascii_case(&topic)).unwrap_or(false))
        .expect("TokenCreated");
    // topic[1] = token indexed (address left-padded in 32 bytes hex)
    let token_topic = &log.topics[1];
    let token = format!("0x{}", &token_topic[token_topic.len() - 40..]);

    let para_0x = "0x2222222222222222222222222222222222222222";
    let xfer = apply_call(
        &mut s,
        de,
        3,
        &token,
        &encode_transfer(para_0x, 100_000_000),
        height,
        1_700_000_000_002,
    );
    assert!(xfer.success, "transfer do token criado pela factory");
}

/// ABI `createManaged(string,string,uint8,uint256,address,address)`.
fn encode_create_managed(
    name: &str,
    symbol: &str,
    decimals: u8,
    supply: u128,
    recipient_0x: &str,
    owner_0x: &str,
) -> String {
    let name_enc = abi_string(name);
    let sym_enc = abi_string(symbol);
    let head_len = 6 * 32;
    let mut head = Vec::with_capacity(head_len);
    let off_name = head_len as u64;
    let off_sym = off_name + name_enc.len() as u64;
    head.extend_from_slice(&word_u64(off_name));
    head.extend_from_slice(&word_u64(off_sym));
    let mut dec = [0u8; 32];
    dec[31] = decimals;
    head.extend_from_slice(&dec);
    head.extend_from_slice(&word_u128(supply));
    head.extend_from_slice(&pad32_addr(&parse_addr20(recipient_0x)));
    head.extend_from_slice(&pad32_addr(&parse_addr20(owner_0x)));
    let mut data = selector("createManaged(string,string,uint8,uint256,address,address)").to_vec();
    data.extend_from_slice(&head);
    data.extend_from_slice(&name_enc);
    data.extend_from_slice(&sym_enc);
    format!("0x{}", hex::encode(data))
}

#[test]
fn eav20_factory_create_managed() {
    let de = "E7D91885C11BD3DAD3F2824FAD4E94BD9A";
    let me = encode_e7_dest(de).expect("dest");
    let height = EAVM_CONTRACTS_HEIGHT.max(EAVM_VALUE_HEIGHT);
    let mut s = State::new();
    conta_rica(&mut s, de);
    let factory = apply_deploy(&mut s, de, 1, &artifact_bin("EAV20Factory"), height, 1_700_000_000_000);
    let create = encode_create_managed("Managed", "MGD", 6, UNIT, &me, &me);
    let recibo = apply_call(&mut s, de, 2, &factory, &create, height, 1_700_000_000_001);
    assert!(recibo.success, "createManaged");
    let topic = topic_token_created();
    let log = recibo
        .logs
        .iter()
        .find(|l| l.topics.first().map(|t| t.eq_ignore_ascii_case(&topic)).unwrap_or(false))
        .expect("TokenCreated Managed");
    let token_topic = &log.topics[1];
    let token = format!("0x{}", &token_topic[token_topic.len() - 40..]);

    // setPaused(true) — selector keccak("setPaused(bool)")[:4]
    let mut pause = selector("setPaused(bool)").to_vec();
    let mut one = [0u8; 32];
    one[31] = 1;
    pause.extend_from_slice(&one);
    let paused = apply_call(
        &mut s,
        de,
        3,
        &token,
        &format!("0x{}", hex::encode(&pause)),
        height,
        1_700_000_000_002,
    );
    assert!(paused.success, "setPaused");

    let para_0x = "0x2222222222222222222222222222222222222222";
    let xfer = apply_call(
        &mut s,
        de,
        4,
        &token,
        &encode_transfer(para_0x, 1),
        height,
        1_700_000_000_003,
    );
    assert!(!xfer.success, "transfer deve falhar com paused");
}
