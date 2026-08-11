//! SaleVault — claim Merkle + vesting on-contract (venda privada autónoma).

use eav7::config::{EAVM_CONTRACTS_HEIGHT, EAVM_VALUE_HEIGHT, UNIT};
use eav7::derive_address_from;
use eav7::state::contracts::{eavm_to_e7, encode_e7_dest};
use eav7::state::{Account, State};
use eav7::transaction::{JsonValue, Tx};
use sha3::{Digest, Keccak256};
use std::collections::BTreeMap;
use std::path::PathBuf;

fn artifact_bin(name: &str) -> Vec<u8> {
    let caminho = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo")
        .join("contracts/artifacts")
        .join(format!("{name}.bin"));
    let hex = std::fs::read_to_string(&caminho).unwrap_or_else(|e| {
        panic!("artefato ausente {}: {e}", caminho.display())
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

fn selector(sig: &str) -> [u8; 4] {
    let h = Keccak256::digest(sig.as_bytes());
    [h[0], h[1], h[2], h[3]]
}

fn keccak(data: &[u8]) -> [u8; 32] {
    Keccak256::digest(data).into()
}

/// leaf = keccak256(abi.encodePacked(index, account, amount, cliff, duration))
fn leaf(index: u128, account: &str, amount: u128, cliff: u64, duration: u64) -> [u8; 32] {
    let mut packed = Vec::with_capacity(100);
    packed.extend_from_slice(&word_u128(index));
    packed.extend_from_slice(&parse_addr20(account));
    packed.extend_from_slice(&word_u128(amount));
    packed.extend_from_slice(&cliff.to_be_bytes());
    packed.extend_from_slice(&duration.to_be_bytes());
    keccak(&packed)
}

fn sorted_parent(a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
    if a <= b {
        let mut buf = [0u8; 64];
        buf[..32].copy_from_slice(&a);
        buf[32..].copy_from_slice(&b);
        keccak(&buf)
    } else {
        let mut buf = [0u8; 64];
        buf[..32].copy_from_slice(&b);
        buf[32..].copy_from_slice(&a);
        keccak(&buf)
    }
}

fn merkle_root_and_proof(leaves: &[[u8; 32]], index: usize) -> ([u8; 32], Vec<[u8; 32]>) {
    assert!(!leaves.is_empty());
    let mut layer = leaves.to_vec();
    let mut layers = vec![layer.clone()];
    while layer.len() > 1 {
        let mut next = Vec::new();
        let mut i = 0;
        while i < layer.len() {
            if i + 1 == layer.len() {
                next.push(layer[i]);
            } else {
                next.push(sorted_parent(layer[i], layer[i + 1]));
            }
            i += 2;
        }
        layer = next;
        layers.push(layer.clone());
    }
    let root = layers.last().unwrap()[0];
    let mut proof = Vec::new();
    let mut idx = index;
    for l in 0..layers.len() - 1 {
        let pair = idx ^ 1;
        if pair < layers[l].len() {
            proof.push(layers[l][pair]);
        }
        idx /= 2;
    }
    (root, proof)
}

fn encode_ctor(admin_0x: &str, sweep_0x: &str, relayer_0x: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&pad32_addr(&parse_addr20(admin_0x)));
    out.extend_from_slice(&pad32_addr(&parse_addr20(sweep_0x)));
    out.extend_from_slice(&pad32_addr(&parse_addr20(relayer_0x)));
    out
}

fn encode_set_root(root: &[u8; 32]) -> String {
    let mut data = selector("setMerkleRoot(bytes32)").to_vec();
    data.extend_from_slice(root);
    format!("0x{}", hex::encode(data))
}

fn encode_open(deadline: u64, enable_auto: bool) -> String {
    let mut data = selector("openSale(uint64,bool)").to_vec();
    data.extend_from_slice(&word_u64(deadline));
    let mut b = [0u8; 32];
    if enable_auto {
        b[31] = 1;
    }
    data.extend_from_slice(&b);
    format!("0x{}", hex::encode(data))
}

fn encode_grant(beneficiary: &str, amount: u128, payment_id: &[u8; 32], rail: &str) -> String {
    let mut data = selector("grant(address,uint256,bytes32,string)").to_vec();
    // head: 4*32; string at offset 128
    data.extend_from_slice(&pad32_addr(&parse_addr20(beneficiary)));
    data.extend_from_slice(&word_u128(amount));
    data.extend_from_slice(payment_id);
    data.extend_from_slice(&word_u64(128)); // offset of string
    // string
    data.extend_from_slice(&word_u64(rail.len() as u64));
    let mut padded = rail.as_bytes().to_vec();
    while padded.len() % 32 != 0 {
        padded.push(0);
    }
    data.extend_from_slice(&padded);
    format!("0x{}", hex::encode(data))
}

fn encode_set_defaults(cliff: u64, duration: u64) -> String {
    let mut data = selector("setDefaults(uint64,uint64)").to_vec();
    data.extend_from_slice(&word_u64(cliff));
    data.extend_from_slice(&word_u64(duration));
    format!("0x{}", hex::encode(data))
}

fn encode_set_sale_allocated(amount: u128) -> String {
    let mut data = selector("setSaleAllocated(uint128)").to_vec();
    data.extend_from_slice(&word_u128(amount));
    format!("0x{}", hex::encode(data))
}

fn encode_claim(
    index: u128,
    amount: u128,
    cliff: u64,
    duration: u64,
    proof: &[[u8; 32]],
) -> String {
    let mut data = selector("claim(uint256,uint256,uint64,uint64,bytes32[])").to_vec();
    // head: 5 words; last is offset to dynamic array (= 160)
    data.extend_from_slice(&word_u128(index));
    data.extend_from_slice(&word_u128(amount));
    data.extend_from_slice(&word_u64(cliff));
    data.extend_from_slice(&word_u64(duration));
    data.extend_from_slice(&word_u64(5 * 32)); // offset
    data.extend_from_slice(&word_u64(proof.len() as u64));
    for p in proof {
        data.extend_from_slice(p);
    }
    format!("0x{}", hex::encode(data))
}

fn encode_release() -> String {
    format!("0x{}", hex::encode(selector("release()")))
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
    assert!(r.success, "deploy SaleVault");
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
            balance: 1_000_000 * UNIT,
            staked: 100_000 * UNIT,
            ..Default::default()
        },
    );
}

#[test]
fn sale_vault_claim_e_release_apos_cliff() {
    let admin_e7 = "E7D91885C11BD3DAD3F2824FAD4E94BD9A";
    let buyer_e7 = derive_address_from("sale-vault-buyer");
    let sweep_e7 = derive_address_from("sale-vault-sweep");
    let relayer_e7 = derive_address_from("sale-vault-relayer");
    let admin_0x = encode_e7_dest(admin_e7).expect("admin dest");
    let buyer_0x = encode_e7_dest(&buyer_e7).expect("buyer dest");
    let sweep_0x = encode_e7_dest(&sweep_e7).expect("sweep dest");
    let relayer_0x = encode_e7_dest(&relayer_e7).expect("relayer dest");

    let amount = 1_000 * UNIT; // 1000 EAV7 em e7
    let cliff = 100u64;
    let duration = 400u64;
    let index = 0u128;

    let leaf0 = leaf(index, &buyer_0x, amount, cliff, duration);
    // segunda folha dummy para árvore com 2 folhas
    let leaf1 = leaf(1, &sweep_0x, 1, cliff, duration);
    let (root, proof) = merkle_root_and_proof(&[leaf0, leaf1], 0);

    let height = EAVM_CONTRACTS_HEIGHT.max(EAVM_VALUE_HEIGHT);
    let mut s = State::new();
    conta_rica(&mut s, admin_e7);
    conta_rica(&mut s, &buyer_e7);
    conta_rica(&mut s, &relayer_e7);
    // taxa do buyer
    s.account_mut(&buyer_e7).balance = 10_000 * UNIT;

    let mut creation = artifact_bin("SaleVault");
    creation.extend_from_slice(&encode_ctor(&admin_0x, &sweep_0x, &relayer_0x));
    let vault = apply_deploy(&mut s, admin_e7, 1, &creation, height, 1_700_000_000_000);

    // Liquidez do vault = saldo E7 do contrato (ledger unificado).
    let vault_e7 = eavm_to_e7(&vault).expect("e7 do vault");
    s.account_mut(&vault_e7).balance = amount * 2;

    let r1 = apply_call(
        &mut s,
        admin_e7,
        2,
        &vault,
        &encode_set_root(&root),
        height,
        1_700_000_000_001,
    );
    assert!(r1.success, "setMerkleRoot");

    let deadline = height + 10_000;
    let r2 = apply_call(
        &mut s,
        admin_e7,
        3,
        &vault,
        &encode_open(deadline, false),
        height,
        1_700_000_000_002,
    );
    assert!(r2.success, "openSale");

    let r3 = apply_call(
        &mut s,
        &buyer_e7,
        1,
        &vault,
        &encode_claim(index, amount, cliff, duration, &proof),
        height,
        1_700_000_000_003,
    );
    assert!(r3.success, "claim {:?}", r3);

    // Antes do cliff: release deve falhar.
    let mid = height + cliff - 1;
    let r4 = apply_call(
        &mut s,
        &buyer_e7,
        2,
        &vault,
        &encode_release(),
        mid,
        1_700_000_000_004,
    );
    assert!(!r4.success, "release antes do cliff deve falhar");

    // No fim do vesting: tudo liberável.
    let end = height + duration;
    let bal_before = s.account(&buyer_e7).balance;
    let r5 = apply_call(
        &mut s,
        &buyer_e7,
        3,
        &vault,
        &encode_release(),
        end,
        1_700_000_000_005,
    );
    assert!(r5.success, "release no fim {:?}", r5);
    let bal_after = s.account(&buyer_e7).balance;
    // Buyer paga fee; líquido ≈ +amount − fee.
    assert!(
        bal_after + 100_000_000 > bal_before + amount - 200_000_000,
        "buyer recebeu o grant (antes={bal_before} depois={bal_after})"
    );
}

#[test]
fn sale_vault_relayer_grant_entrega_automatica() {
    let admin_e7 = "E7D91885C11BD3DAD3F2824FAD4E94BD9A";
    let buyer_e7 = derive_address_from("sale-auto-buyer");
    let sweep_e7 = derive_address_from("sale-auto-sweep");
    let relayer_e7 = derive_address_from("sale-auto-relayer");
    let admin_0x = encode_e7_dest(admin_e7).unwrap();
    let buyer_0x = encode_e7_dest(&buyer_e7).unwrap();
    let sweep_0x = encode_e7_dest(&sweep_e7).unwrap();
    let relayer_0x = encode_e7_dest(&relayer_e7).unwrap();

    let amount = 500 * UNIT;
    let height = EAVM_CONTRACTS_HEIGHT.max(EAVM_VALUE_HEIGHT);
    let mut s = State::new();
    conta_rica(&mut s, admin_e7);
    conta_rica(&mut s, &buyer_e7);
    conta_rica(&mut s, &relayer_e7);

    let mut creation = artifact_bin("SaleVault");
    creation.extend_from_slice(&encode_ctor(&admin_0x, &sweep_0x, &relayer_0x));
    let vault = apply_deploy(&mut s, admin_e7, 1, &creation, height, 1_800_000_000_000);
    let vault_e7 = eavm_to_e7(&vault).unwrap();
    s.account_mut(&vault_e7).balance = amount * 3;

    // Short defaults for the test (before open)
    assert!(
        apply_call(
            &mut s,
            admin_e7,
            2,
            &vault,
            &encode_set_defaults(50, 200),
            height,
            1_800_000_000_001,
        )
        .success
    );
    assert!(
        apply_call(
            &mut s,
            admin_e7,
            3,
            &vault,
            &encode_set_sale_allocated(amount * 3),
            height,
            1_800_000_000_002,
        )
        .success,
        "setSaleAllocated"
    );
    assert!(
        apply_call(
            &mut s,
            admin_e7,
            4,
            &vault,
            &encode_open(height + 50_000, true),
            height,
            1_800_000_000_003,
        )
        .success
    );

    let payment_id = keccak(b"eth-usdt:0xabc:0");
    let g = apply_call(
        &mut s,
        &relayer_e7,
        1,
        &vault,
        &encode_grant(&buyer_0x, amount, &payment_id, "eth-usdt"),
        height,
        1_800_000_000_004,
    );
    assert!(g.success, "grant {:?}", g);

    // Replay do mesmo paymentId deve falhar
    let replay = apply_call(
        &mut s,
        &relayer_e7,
        2,
        &vault,
        &encode_grant(&buyer_0x, amount, &payment_id, "eth-usdt"),
        height,
        1_800_000_000_005,
    );
    assert!(!replay.success, "replay paymentId");

    // Stranger não é relayer
    let stranger = derive_address_from("not-relayer");
    conta_rica(&mut s, &stranger);
    let other_buyer = encode_e7_dest(&derive_address_from("other-buyer")).unwrap();
    let bad = apply_call(
        &mut s,
        &stranger,
        1,
        &vault,
        &encode_grant(&other_buyer, amount, &keccak(b"other-pay"), "eth-usdt"),
        height,
        1_800_000_000_006,
    );
    assert!(!bad.success, "só relayer");

    let end = height + 200;
    s.account_mut(&buyer_e7).balance = 10_000 * UNIT;
    let rel = apply_call(
        &mut s,
        &buyer_e7,
        1,
        &vault,
        &encode_release(),
        end,
        1_800_000_000_007,
    );
    assert!(rel.success, "release após grant {:?}", rel);
}
