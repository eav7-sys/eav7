//! G6 — harness multi-nó in-process (2 nós: produtor + ouvinte).
//!
//! Exercita o caminho real: gênese compartilhada → HTTP API → P2P sync →
//! altura avança no peer. Sem subprocesso.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use eav7_node::boot::{
    boot, cadeia_com_genese_fundadora, cadeia_com_mesma_genese, BootOpts, RunningNode,
};
use eav7_sdk::ProductionWallet;

fn agora_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn carteira_temp() -> (tempfile::TempDir, Arc<ProductionWallet>, String) {
    let dir = tempfile::tempdir().expect("tempdir");
    let (addr, json) = ProductionWallet::gerar().expect("gerar");
    let path = dir.path().join("w.json");
    std::fs::write(&path, json).expect("write wallet");
    let w = Arc::new(ProductionWallet::from_file(&path).expect("load"));
    (dir, w, addr)
}

async fn aguarda(pred: impl Fn() -> bool, timeout_ms: u64) -> bool {
    let passos = timeout_ms / 50;
    for _ in 0..passos {
        if pred() {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    pred()
}

async fn status_json(url: &str) -> serde_json::Value {
    let corpo = ureq::get(&format!("{url}/status"))
        .set("accept", "application/json")
        .call()
        .expect("GET /status")
        .into_string()
        .expect("body");
    serde_json::from_str(&corpo).expect("json")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dois_nos_compartilham_genese_e_sincronizam_altura() {
    let (_dir_a, wallet_a, addr_a) = carteira_temp();
    let bc_a = cadeia_com_genese_fundadora(&addr_a, agora_ms()).expect("gênese A");
    let genesis_hash = bc_a.get_block(0).expect("bloco 0").hash.clone();

    let a: RunningNode = boot(BootOpts {
        blockchain: bc_a,
        wallet: Some(wallet_a),
        peers: vec![],
        allow_private_peers: true,
        sync_ms: 300,
        produce: true,
    })
    .await
    .expect("boot A");

    assert_eq!(a.genesis_hash().as_deref(), Some(genesis_hash.as_str()));
    assert_eq!(a.height(), 0);

    // Ouvinte com a MESMA gênese, peer = A.
    let bc_b = {
        let n = a.state.read().unwrap();
        cadeia_com_mesma_genese(&n.blockchain).expect("gênese B")
    };
    let b = boot(BootOpts {
        blockchain: bc_b,
        wallet: None,
        peers: vec![a.url.clone()],
        allow_private_peers: true,
        sync_ms: 300,
        produce: false,
    })
    .await
    .expect("boot B");

    assert_eq!(b.genesis_hash().as_deref(), Some(genesis_hash.as_str()));

    // A produz; B sincroniza.
    let ok = aguarda(
        || {
            let ha = a.height();
            let hb = b.height();
            ha >= 1 && hb >= 1 && a.head_hash() == b.head_hash()
        },
        15_000,
    )
    .await;

    let st_a = status_json(&a.url).await;
    let st_b = status_json(&b.url).await;
    assert!(
        ok,
        "sync falhou: A height={} head={:?} | B height={} head={:?} | statusA={} statusB={}",
        a.height(),
        a.head_hash(),
        b.height(),
        b.head_hash(),
        st_a,
        st_b
    );
    assert_eq!(
        st_a.get("headHash"),
        st_b.get("headHash"),
        "headHash HTTP diverge"
    );
}
