//! PartnerTrancheVault — 4 partes, releaseTo + cooldown.

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

fn encode_ctor1(a: &str) -> Vec<u8> {
    pad32_addr(&parse_addr20(a)).to_vec()
}

fn encode_set_cooldown(blocks: u64) -> String {
    let mut data = selector("setCooldown(uint64)").to_vec();
    data.extend_from_slice(&word_u64(blocks));
    format!("0x{}", hex::encode(data))
}

fn encode_arm(total: u128) -> String {
    let mut data = selector("arm(uint128)").to_vec();
    data.extend_from_slice(&word_u128(total));
    format!("0x{}", hex::encode(data))
}

fn encode_release_to(to: &str) -> String {
    let mut data = selector("releaseTo(address)").to_vec();
    data.extend_from_slice(&pad32_addr(&parse_addr20(to)));
    format!("0x{}", hex::encode(data))
}

// setCooldown / arm selectors unchanged — owner-gated on-chain

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
fn partner_tranche_release_e_cooldown() {
    let owner_e7 = "E7D91885C11BD3DAD3F2824FAD4E94BD9A";
    let a_e7 = derive_address_from("partner-a");
    let b_e7 = derive_address_from("partner-b");
    let stranger_e7 = derive_address_from("partner-stranger");
    let owner_0x = encode_e7_dest(owner_e7).unwrap();
    let a_0x = encode_e7_dest(&a_e7).unwrap();
    let b_0x = encode_e7_dest(&b_e7).unwrap();

    let total = 400 * UNIT;
    let tranche = total / 4;
    let cooldown = 1_000u64;
    let height = EAVM_CONTRACTS_HEIGHT.max(EAVM_VALUE_HEIGHT);
    let mut s = State::new();
    conta_rica(&mut s, owner_e7);
    conta_rica(&mut s, &a_e7);
    conta_rica(&mut s, &b_e7);
    conta_rica(&mut s, &stranger_e7);

    let mut creation = artifact_bin("PartnerTrancheVault");
    creation.extend_from_slice(&encode_ctor1(&owner_0x));
    let vault = apply_deploy(&mut s, owner_e7, 1, &creation, height, 1_900_000_000_000);
    let vault_e7 = eavm_to_e7(&vault).unwrap();
    s.account_mut(&vault_e7).balance = total;

    assert!(
        apply_call(
            &mut s,
            owner_e7,
            2,
            &vault,
            &encode_set_cooldown(cooldown),
            height,
            1_900_000_000_001,
        )
        .success
    );
    assert!(
        apply_call(
            &mut s,
            owner_e7,
            3,
            &vault,
            &encode_arm(total),
            height,
            1_900_000_000_002,
        )
        .success,
        "arm"
    );

    // carteira estranha não libera
    let not_owner = apply_call(
        &mut s,
        &stranger_e7,
        1,
        &vault,
        &encode_release_to(&a_0x),
        height,
        1_900_000_000_002,
    );
    assert!(!not_owner.success, "só owner");

    let bal_a0 = s.account(&a_e7).balance;
    assert!(
        apply_call(
            &mut s,
            owner_e7,
            4,
            &vault,
            &encode_release_to(&a_0x),
            height,
            1_900_000_000_003,
        )
        .success,
        "release 0"
    );
    assert!(s.account(&a_e7).balance >= bal_a0 + tranche - 200_000_000);

    // owner não pode liberar para si (endereço derivado / self-deal)
    let to_self = apply_call(
        &mut s,
        owner_e7,
        5,
        &vault,
        &encode_release_to(&owner_0x),
        height + cooldown,
        1_900_000_000_004,
    );
    assert!(!to_self.success, "no-owner self");

    let early = apply_call(
        &mut s,
        owner_e7,
        6,
        &vault,
        &encode_release_to(&b_0x),
        height,
        1_900_000_000_005,
    );
    assert!(!early.success, "cooldown");

    let later = height + cooldown;
    let bal_b0 = s.account(&b_e7).balance;
    assert!(
        apply_call(
            &mut s,
            owner_e7,
            7,
            &vault,
            &encode_release_to(&b_0x),
            later,
            1_900_000_000_006,
        )
        .success,
        "release 1"
    );
    assert!(s.account(&b_e7).balance >= bal_b0 + tranche - 200_000_000);
}
