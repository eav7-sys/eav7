//! Boot enxuto do nó — API + P2P + produtor opcional.
//!
//! Extraído para o harness G6 (multi-nó in-process) e para não duplicar o
//! literal de [`crate::node::Node`] em cada teste. O binário `eav7-node` ainda
//! faz o boot completo em `main.rs` (EAVM, sentinel, proxies); este caminho é o
//! núcleo de rede que os testes de integração precisam.

use std::sync::{Arc, RwLock};

use eav7::blockchain::Blockchain;
use eav7_sdk::ProductionWallet;
use tokio::task::AbortHandle;

use crate::api::AppState;
use crate::node::Node;
use crate::p2p::{self, P2pConfig};

/// Opções do boot de teste / harness.
pub struct BootOpts {
    /// Cadeia já com gênese (ou vazia se `criar_genese_fundador`).
    pub blockchain: Blockchain,
    /// Carteira do validador local. `None` = ouvinte (não produz).
    pub wallet: Option<Arc<ProductionWallet>>,
    /// Seeds P2P (URLs dos peers).
    pub peers: Vec<String>,
    pub allow_private_peers: bool,
    /// Intervalo de sync (ms). Em testes use 200–500.
    pub sync_ms: u64,
    /// Se true e há carteira, sobe o produtor.
    pub produce: bool,
}

/// Nó HTTP em execução (porta efêmera).
pub struct RunningNode {
    pub state: AppState,
    pub url: String,
    pub port: u16,
    aborts: Vec<AbortHandle>,
}

impl Drop for RunningNode {
    fn drop(&mut self) {
        for a in &self.aborts {
            a.abort();
        }
    }
}

impl RunningNode {
    /// Altura atual (lock de leitura).
    pub fn height(&self) -> i64 {
        self.state
            .read()
            .map(|n| n.blockchain.height())
            .unwrap_or(-1)
    }

    pub fn head_hash(&self) -> Option<String> {
        self.state
            .read()
            .ok()
            .and_then(|n| n.blockchain.head().map(|b| b.hash.clone()))
    }

    pub fn genesis_hash(&self) -> Option<String> {
        self.state
            .read()
            .ok()
            .and_then(|n| n.blockchain.get_block(0).map(|b| b.hash.clone()))
    }
}

/// Sobe API + P2P (+ produtor) em `127.0.0.1:0`.
pub async fn boot(mut opts: BootOpts) -> Result<RunningNode, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("bind: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?
        .port();
    let url = format!("http://127.0.0.1:{port}");

    let validator_address = opts.wallet.as_ref().map(|w| w.address().to_string());
    let node = Node::novo(opts.blockchain, validator_address.clone(), Some(url.clone()));
    let estado: AppState = Arc::new(RwLock::new(node));

    let p2p_config = P2pConfig {
        self_url: Some(url.clone()),
        allow_private_peers: opts.allow_private_peers,
        sync_ms: opts.sync_ms,
    };

    let mut aborts = Vec::new();

    let p2p_handle = p2p::start(estado.clone(), p2p_config.clone(), opts.peers);
    aborts.push(p2p_handle.abort_handle());

    // Relay de blocos + sync sob demanda (mesmo wiring do main).
    {
        let (tx_relay, mut rx_relay) = tokio::sync::mpsc::unbounded_channel::<String>();
        let estado_relay = estado.clone();
        let config_relay = p2p_config.clone();
        let h = tokio::spawn(async move {
            let client = p2p::make_client();
            while let Some(linha) = rx_relay.recv().await {
                let peers = match estado_relay.read() {
                    Ok(n) => n.peers.clone(),
                    Err(_) => continue,
                };
                p2p::broadcast_block(&client, &config_relay, &peers, linha);
            }
        });
        aborts.push(h.abort_handle());

        let (tx_sync, mut rx_sync) = tokio::sync::mpsc::unbounded_channel::<()>();
        let estado_sync = estado.clone();
        let config_sync = p2p_config.clone();
        let h = tokio::spawn(async move {
            let client = p2p::make_client();
            let guarda = tokio::sync::Mutex::new(());
            while rx_sync.recv().await.is_some() {
                while rx_sync.try_recv().is_ok() {}
                p2p::sync_once(&client, &config_sync, &estado_sync, &guarda).await;
            }
        });
        aborts.push(h.abort_handle());

        if let Ok(mut n) = estado.write() {
            n.relay_bloco.replace(tx_relay);
            n.pedir_sync.replace(tx_sync);
        }
    }

    // Gossip de txs.
    {
        let (tx_gossip, mut rx_gossip) = tokio::sync::mpsc::unbounded_channel::<String>();
        let estado_gossip = estado.clone();
        let config_gossip = p2p_config.clone();
        let h = tokio::spawn(async move {
            let client = p2p::make_client();
            while let Some(linha) = rx_gossip.recv().await {
                let peers = match estado_gossip.read() {
                    Ok(n) => n.peers.clone(),
                    Err(_) => continue,
                };
                p2p::broadcast_tx(&client, &config_gossip, &peers, linha);
            }
        });
        aborts.push(h.abort_handle());
        if let Ok(mut n) = estado.write() {
            n.gossip_tx.replace(tx_gossip);
        }
    }

    if opts.produce {
        if let Some(w) = opts.wallet.take() {
            let (bloco_gossip, mut rx_gossip) = tokio::sync::mpsc::unbounded_channel::<String>();
            let estado_gossip = estado.clone();
            let config_gossip = p2p_config.clone();
            let h = tokio::spawn(async move {
                let client = p2p::make_client();
                while let Some(linha) = rx_gossip.recv().await {
                    let peers = match estado_gossip.read() {
                        Ok(n) => n.peers.clone(),
                        Err(_) => continue,
                    };
                    p2p::broadcast_block(&client, &config_gossip, &peers, linha);
                }
            });
            aborts.push(h.abort_handle());
            let h = crate::producer::start(estado.clone(), w, Some(bloco_gossip));
            aborts.push(h.abort_handle());
        }
    }

    let admissao = crate::api::admissao::Admissao::from_env();
    if let Ok(mut n) = estado.write() {
        n.guard = admissao.guard.clone();
    }

    let router = crate::api::router()
        .with_state(estado.clone())
        .layer(axum::middleware::from_fn_with_state(
            admissao,
            crate::api::admissao::controlar,
        ));

    let h = tokio::spawn(async move {
        let servico = router.into_make_service_with_connect_info::<std::net::SocketAddr>();
        let _ = axum::serve(listener, servico).await;
    });
    aborts.push(h.abort_handle());

    // Pequena folga para o accept loop subir.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    Ok(RunningNode {
        state: estado,
        url,
        port,
        aborts,
    })
}

/// Cria gênese fundadora (supply + stake no endereço) e devolve a cadeia pronta.
pub fn cadeia_com_genese_fundadora(endereco: &str, timestamp_ms: i64) -> Result<Blockchain, String> {
    use eav7::config::{GENESIS_STAKE, GENESIS_SUPPLY};
    use eav7::transaction::JsonValue;

    let genese = eav7::block::build_genesis_block(
        timestamp_ms,
        JsonValue::map([
            (
                "balances".to_string(),
                JsonValue::map([(
                    endereco.to_string(),
                    JsonValue::Str((GENESIS_SUPPLY - GENESIS_STAKE).to_string()),
                )]),
            ),
            (
                "stakes".to_string(),
                JsonValue::map([(
                    endereco.to_string(),
                    JsonValue::Str(GENESIS_STAKE.to_string()),
                )]),
            ),
            (
                "bridgeRelayers".to_string(),
                JsonValue::List(vec![JsonValue::Str(endereco.to_string())]),
            ),
        ]),
    );
    let mut bc = Blockchain::new();
    bc.adopt_genesis(genese)?;
    Ok(bc)
}

/// Clona a gênese (bloco 0) de uma cadeia para outra vazia — mesmo hash de rede.
pub fn cadeia_com_mesma_genese(fonte: &Blockchain) -> Result<Blockchain, String> {
    let genese = fonte.get_block(0).ok_or("fonte sem gênese")?.clone();
    let mut bc = Blockchain::new();
    bc.adopt_genesis(genese)?;
    Ok(bc)
}
