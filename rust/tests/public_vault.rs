//! PublicVault — grant líquido + finalizeToLp → TimelockLpSeeder.

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

fn encode_ctor2(a: &str, b: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&pad32_addr(&parse_addr20(a)));
    out.extend_from_slice(&pad32_addr(&parse_addr20(b)));
    out
}

fn encode_set_buckets(lbp: u128, lp: u128, buffer: u128) -> String {
    let mut data = selector("setBuckets(uint128,uint128,uint128)").to_vec();
    data.extend_from_slice(&word_u128(lbp));
    data.extend_from_slice(&word_u128(lp));
    data.extend_from_slice(&word_u128(buffer));
    format!("0x{}", hex::encode(data))
}

fn encode_set_lp_seeder(seeder: &str) -> String {
    let mut data = selector("setLpSeeder(address)").to_vec();
    data.extend_from_slice(&pad32_addr(&parse_addr20(seeder)));
    format!("0x{}", hex::encode(data))
}

fn encode_open_lbp(deadline: u64) -> String {
    let mut data = selector("openLbp(uint64)").to_vec();
    data.extend_from_slice(&word_u64(deadline));
    format!("0x{}", hex::encode(data))
}

fn encode_grant(beneficiary: &str, amount: u128, payment_id: &[u8; 32], rail: &str) -> String {
    let rail_id = keccak(rail.as_bytes());
    let mut data = selector("grant(address,uint256,bytes32,bytes32)").to_vec();
    data.extend_from_slice(&pad32_addr(&parse_addr20(beneficiary)));
    data.extend_from_slice(&word_u128(amount));
    data.extend_from_slice(payment_id);
    data.extend_from_slice(&rail_id);
    format!("0x{}", hex::encode(data))
}

fn encode_release() -> String {
    format!("0x{}", hex::encode(selector("release()")))
}

fn encode_finalize() -> String {
    format!("0x{}", hex::encode(selector("finalizeToLp()")))
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
    assert!(r.success, "deploy falhou {:?}", r);
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
fn public_vault_grant_liquido_e_finalize_lp() {
    let admin_e7 = "E7D91885C11BD3DAD3F2824FAD4E94BD9A";
    let buyer_e7 = derive_address_from("public-vault-buyer");
    let relayer_e7 = derive_address_from("public-vault-relayer");
    let admin_0x = encode_e7_dest(admin_e7).unwrap();
    let buyer_0x = encode_e7_dest(&buyer_e7).unwrap();
    let relayer_0x = encode_e7_dest(&relayer_e7).unwrap();

    let amount = 100 * UNIT;
    let lbp = amount * 2;
    let lp_seed = amount * 3;
    let buffer = amount;
    let height = EAVM_CONTRACTS_HEIGHT.max(EAVM_VALUE_HEIGHT);
    let mut s = State::new();
    conta_rica(&mut s, admin_e7);
    conta_rica(&mut s, &buyer_e7);
    conta_rica(&mut s, &relayer_e7);

    // Deploy PublicVault(admin, relayer)
    let mut creation = artifact_bin("PublicVault");
    creation.extend_from_slice(&encode_ctor2(&admin_0x, &relayer_0x));
    let vault = apply_deploy(&mut s, admin_e7, 1, &creation, height, 1_900_000_000_000);
    let vault_e7 = eavm_to_e7(&vault).unwrap();
    s.account_mut(&vault_e7).balance = lbp + lp_seed + buffer;

    // Deploy TimelockLpSeeder(admin, vault)
    let mut seeder_code = artifact_bin("TimelockLpSeeder");
    seeder_code.extend_from_slice(&encode_ctor2(&admin_0x, &vault));
    let seeder = apply_deploy(&mut s, admin_e7, 2, &seeder_code, height, 1_900_000_000_001);

    assert!(
        apply_call(
            &mut s,
            admin_e7,
            3,
            &vault,
            &encode_set_lp_seeder(&seeder),
            height,
            1_900_000_000_002,
        )
        .success
    );
    assert!(
        apply_call(
            &mut s,
            admin_e7,
            4,
            &vault,
            &encode_set_buckets(lbp, lp_seed, buffer),
            height,
            1_900_000_000_003,
        )
        .success
    );

    // openLbp: deadline = altura futura (block.number)
    let deadline = height + 50_000;
    assert!(
        apply_call(
            &mut s,
            admin_e7,
            5,
            &vault,
            &encode_open_lbp(deadline),
            height,
            1_900_000_000_004,
        )
        .success,
        "openLbp"
    );

    let payment_id = keccak(b"public:eth-usdt:0x1:0");
    let g = apply_call(
        &mut s,
        &relayer_e7,
        1,
        &vault,
        &encode_grant(&buyer_0x, amount, &payment_id, "eth-usdt"),
        height,
        1_900_000_000_005,
    );
    assert!(g.success, "grant líquido {:?}", g);

    // release imediato (sem cliff)
    s.account_mut(&buyer_e7).balance = 10_000 * UNIT;
    let bal_before = s.account(&buyer_e7).balance;
    let rel = apply_call(
        &mut s,
        &buyer_e7,
        1,
        &vault,
        &encode_release(),
        height,
        1_900_000_000_006,
    );
    assert!(rel.success, "release líquido {:?}", rel);
    let bal_after = s.account(&buyer_e7).balance;
    assert!(
        bal_after + 100_000_000 > bal_before + amount - 200_000_000,
        "buyer recebeu líquido"
    );

    // finalize cedo deve falhar
    let early = apply_call(
        &mut s,
        admin_e7,
        6,
        &vault,
        &encode_finalize(),
        height,
        1_900_000_000_007,
    );
    assert!(!early.success, "finalize early");
}
