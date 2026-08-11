//! EcosystemVault — award council + release após vesting curto (teste).

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

fn encode_set_buckets(infra: u128, apps: u128, liquidity: u128, buffer: u128) -> String {
    let mut data = selector("setBuckets(uint128,uint128,uint128,uint128)").to_vec();
    data.extend_from_slice(&word_u128(infra));
    data.extend_from_slice(&word_u128(apps));
    data.extend_from_slice(&word_u128(liquidity));
    data.extend_from_slice(&word_u128(buffer));
    format!("0x{}", hex::encode(data))
}

fn encode_lock_buckets() -> String {
    format!("0x{}", hex::encode(selector("lockBuckets()")))
}

fn encode_set_defaults(cliff: u64, duration: u64) -> String {
    let mut data = selector("setDefaults(uint64,uint64)").to_vec();
    data.extend_from_slice(&word_u64(cliff));
    data.extend_from_slice(&word_u64(duration));
    format!("0x{}", hex::encode(data))
}

fn encode_award(
    category: u8,
    beneficiary: &str,
    amount: u128,
    milestone: &[u8; 32],
    reason: &str,
) -> String {
    let mut data = selector("award(uint8,address,uint256,bytes32,string)").to_vec();
    data.extend_from_slice(&word_u64(category as u64));
    data.extend_from_slice(&pad32_addr(&parse_addr20(beneficiary)));
    data.extend_from_slice(&word_u128(amount));
    data.extend_from_slice(milestone);
    data.extend_from_slice(&word_u64(160)); // offset to string (5 * 32)
    data.extend_from_slice(&word_u64(reason.len() as u64));
    let mut padded = reason.as_bytes().to_vec();
    while padded.len() % 32 != 0 {
        padded.push(0);
    }
    data.extend_from_slice(&padded);
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
fn ecosystem_vault_award_e_release() {
    let admin_e7 = "E7D91885C11BD3DAD3F2824FAD4E94BD9A";
    let builder_e7 = derive_address_from("ecosystem-builder");
    let council_e7 = derive_address_from("ecosystem-council");
    let admin_0x = encode_e7_dest(admin_e7).unwrap();
    let builder_0x = encode_e7_dest(&builder_e7).unwrap();
    let council_0x = encode_e7_dest(&council_e7).unwrap();

    let amount = 50 * UNIT;
    let infra = amount * 4;
    let apps = amount * 3;
    let liquidity = amount * 2;
    let buffer = amount;
    let height = EAVM_CONTRACTS_HEIGHT.max(EAVM_VALUE_HEIGHT);
    let mut s = State::new();
    conta_rica(&mut s, admin_e7);
    conta_rica(&mut s, &builder_e7);
    conta_rica(&mut s, &council_e7);

    let mut creation = artifact_bin("EcosystemVault");
    creation.extend_from_slice(&encode_ctor2(&admin_0x, &council_0x));
    let vault = apply_deploy(&mut s, admin_e7, 1, &creation, height, 1_900_000_000_000);
    let vault_e7 = eavm_to_e7(&vault).unwrap();
    s.account_mut(&vault_e7).balance = infra + apps + liquidity + buffer;

    assert!(
        apply_call(
            &mut s,
            admin_e7,
            2,
            &vault,
            &encode_set_defaults(0, 1),
            height,
            1_900_000_000_001,
        )
        .success,
        "setDefaults"
    );
    assert!(
        apply_call(
            &mut s,
            admin_e7,
            3,
            &vault,
            &encode_set_buckets(infra, apps, liquidity, buffer),
            height,
            1_900_000_000_002,
        )
        .success,
        "setBuckets"
    );
    assert!(
        apply_call(
            &mut s,
            admin_e7,
            4,
            &vault,
            &encode_lock_buckets(),
            height,
            1_900_000_000_003,
        )
        .success,
        "lockBuckets"
    );

    let milestone = keccak(b"milestone:rpc-v1");
    let awarded = apply_call(
        &mut s,
        &council_e7,
        1,
        &vault,
        &encode_award(0, &builder_0x, amount, &milestone, "indexer-mvp"),
        height,
        1_900_000_000_004,
    );
    assert!(awarded.success, "award {:?}", awarded);

    // duration=1 ⇒ liberável em height+1
    let release_h = height + 1;
    let bal_before = s.account(&builder_e7).balance;
    let rel = apply_call(
        &mut s,
        &builder_e7,
        1,
        &vault,
        &encode_release(),
        release_h,
        1_900_000_000_005,
    );
    assert!(rel.success, "release {:?}", rel);
    let bal_after = s.account(&builder_e7).balance;
    assert!(
        bal_after + 100_000_000 > bal_before + amount - 200_000_000,
        "builder recebeu"
    );

    // founder/admin não award
    let bad = apply_call(
        &mut s,
        admin_e7,
        5,
        &vault,
        &encode_award(1, &builder_0x, amount, &keccak(b"x"), "nope"),
        release_h,
        1_900_000_000_006,
    );
    assert!(!bad.success, "admin não é council");
}
