//! Gênese §12.2 — vaults + 7 Âncoras + fundação em 12 tranches.

use eav7::config::{GENESIS_STAKE, GENESIS_SUPPLY};
use eav7::derive_address_from;
use eav7_node::boot::{
    alocacoes_buckets_whitepaper, cadeia_com_buckets_whitepaper, genesis_bucket_amounts,
    GENESIS_BLOCKS_PER_MONTH, GENESIS_FOUNDATION_TRANCHES, GENESIS_FOUNDATION_UNLOCK_MONTHS,
};

#[test]
fn buckets_somam_supply() {
    let (public, foundation, private_b, partner) = genesis_bucket_amounts();
    assert_eq!(public + foundation + private_b + partner, GENESIS_SUPPLY);
    let n = 7u128;
    let stake_total = GENESIS_STAKE * n;
    let foundation_bag = foundation - stake_total;
    assert_eq!(
        public + private_b + foundation_bag + partner + stake_total,
        GENESIS_SUPPLY
    );
    assert_eq!(foundation_bag % GENESIS_FOUNDATION_TRANCHES, 0);
}

#[test]
fn cadeia_adota_buckets_com_7_ancoras() {
    let public_vault = derive_address_from("genesis-public-vault");
    let sale_vault = derive_address_from("genesis-sale-vault");
    let foundation = eav7_node::boot::GENESIS_FOUNDATION_TREASURY;
    let partner_vault = derive_address_from("genesis-partner-tranche-vault");
    let anchors: Vec<String> = (1..=7)
        .map(|i| derive_address_from(format!("genesis-ancora-{i}")))
        .collect();
    let anchor_refs: Vec<&str> = anchors.iter().map(|s| s.as_str()).collect();

    let aloc = alocacoes_buckets_whitepaper(
        &public_vault,
        &sale_vault,
        foundation,
        &partner_vault,
        &anchor_refs,
    )
    .expect("aloc");
    let map = match aloc {
        eav7::transaction::JsonValue::Map(m) => m,
        _ => panic!("map"),
    };

    let foundation_bag = (GENESIS_SUPPLY * 3025 / 10_000) - GENESIS_STAKE * 7;
    let tranche = foundation_bag / GENESIS_FOUNDATION_TRANCHES;
    assert_eq!(foundation_bag, 30_249_930_000_000_000);
    assert_eq!(tranche, 2_520_827_500_000_000);

    let balances = match &map["balances"] {
        eav7::transaction::JsonValue::Map(m) => m,
        _ => panic!("balances"),
    };
    let day1 = match balances.get(foundation) {
        Some(eav7::transaction::JsonValue::Str(s)) => s.clone(),
        _ => panic!("foundation balance"),
    };
    assert_eq!(day1, tranche.to_string());

    let vesting = match &map["vesting"] {
        eav7::transaction::JsonValue::List(v) => v,
        _ => panic!("vesting list"),
    };
    assert_eq!(vesting.len(), GENESIS_FOUNDATION_UNLOCK_MONTHS.len());
    for (i, months) in GENESIS_FOUNDATION_UNLOCK_MONTHS.iter().enumerate() {
        let row = match &vesting[i] {
            eav7::transaction::JsonValue::Map(m) => m,
            _ => panic!("vesting row"),
        };
        let id = match row.get("id") {
            Some(eav7::transaction::JsonValue::Str(s)) => s.as_str(),
            _ => panic!("id"),
        };
        assert_eq!(id, format!("foundation-{months}m"));
        let blocks = (*months * GENESIS_BLOCKS_PER_MONTH) as i64;
        assert_eq!(
            row.get("cliff"),
            Some(&eav7::transaction::JsonValue::Int(blocks))
        );
        assert_eq!(
            row.get("duration"),
            Some(&eav7::transaction::JsonValue::Int(blocks))
        );
        let total = match row.get("total") {
            Some(eav7::transaction::JsonValue::Str(s)) => s.clone(),
            _ => panic!("total"),
        };
        assert_eq!(total, tranche.to_string());
    }

    let bc = cadeia_com_buckets_whitepaper(
        &public_vault,
        &sale_vault,
        foundation,
        &partner_vault,
        &anchor_refs,
        1_700_000_000_000,
    )
    .expect("cadeia");
    assert!(bc.has_genesis());
    let (public, _, private_b, partner) = genesis_bucket_amounts();
    assert_eq!(bc.state.account(&public_vault).balance, public);
    assert_eq!(bc.state.account(&sale_vault).balance, private_b);
    assert_eq!(bc.state.account(&partner_vault).balance, partner);
    assert_eq!(bc.state.account(foundation).balance, tranche);
    assert_eq!(bc.state.vesting.len(), GENESIS_FOUNDATION_UNLOCK_MONTHS.len());
    for a in &anchors {
        assert_eq!(bc.state.account(a).staked, GENESIS_STAKE);
    }
    assert!(bc.state.bridge_relayers.is_empty());
}

#[test]
fn rejeita_contagem_fora_do_launch() {
    let a = derive_address_from("a");
    let err = alocacoes_buckets_whitepaper("p", "s", "f", "v", &[&a]).unwrap_err();
    assert!(err.contains("5..=7"), "{err}");
}
