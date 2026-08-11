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

/// Cliff padrão (≥ 12 meses a 1 bloco/s) para buckets não-públicos na gênese.
pub const GENESIS_VESTING_CLIFF_BLOCKS: u64 = 31_536_000;
/// Duração linear após o cliff (~24 meses) — default privado / helper legado.
pub const GENESIS_VESTING_DURATION_BLOCKS: u64 = 63_072_000;
/// Fundação: última tranche aos 72 meses (12 × 1/12).
pub const GENESIS_FOUNDATION_DURATION_BLOCKS: u64 = 189_216_000;
/// Parceiro/ecossistema §12.2 (schedule on-contract no EcosystemVault):
/// cliff 12m + linear 36m ⇒ duration desde o start = 48m.
#[allow(dead_code)]
pub const GENESIS_PARTNER_DURATION_BLOCKS: u64 = 126_144_000;

/// 365d a 1 bloco/s; 12 meses = um ano civil do schedule.
pub const GENESIS_BLOCKS_PER_MONTH: u64 = GENESIS_VESTING_CLIFF_BLOCKS / 12;
/// Tesouraria em 12 partes iguais: 1/12 líquido no gênese; demais em cliffs
/// 12, 18, 24, …, 72 meses (unlock em degrau: cliff == duration).
pub const GENESIS_FOUNDATION_TRANCHES: u128 = 12;
pub const GENESIS_FOUNDATION_UNLOCK_MONTHS: &[u64] =
    &[12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72];

/// Launch: 5–7 Âncoras da fundação (plano 17). Default de gênese = 7.
pub const GENESIS_LAUNCH_ANCHORS_MIN: usize = 5;
pub const GENESIS_LAUNCH_ANCHORS_MAX: usize = 7;

/// Tesouraria da fundação (1/12 líquido + 11/12 em vesting escalonado).
/// Mesmo endereço publicado em `contracts/sale/payment-rails.json` → `eav7.address`.
pub const GENESIS_FOUNDATION_TREASURY: &str = "E7F2906EA4B2CD23D20180C8E813F2D126";

/// Fatias atômicas (e7) do whitepaper §12.2 sobre `GENESIS_SUPPLY`.
pub fn genesis_bucket_amounts() -> (u128, u128, u128, u128) {
    use eav7::config::GENESIS_SUPPLY;
    let public = GENESIS_SUPPLY * 45 / 100;
    let foundation = GENESIS_SUPPLY * 3025 / 10_000;
    let private_b = GENESIS_SUPPLY * 1475 / 10_000;
    let partner = GENESIS_SUPPLY * 10 / 100;
    (public, foundation, private_b, partner)
}

/// Alocações de gênese descentralizadas:
/// - `balances[public_vault]` = 45% líquido (PublicVault)
/// - `balances[sale_vault]` = 14,75% (SaleVault / grants privados)
/// - `balances[partner_vault]` = 10% (PartnerTrancheVault — 4 partes privadas)
/// - `balances[foundation]` = 1/12 de (30,25% − N×GENESIS_STAKE)
/// - `vesting[foundation-Nm]` = 1/12 cada, unlock em N = 12…72 meses
/// - `stakes[ancora_i]` = GENESIS_STAKE para cada Âncora (5..=7)
pub fn alocacoes_buckets_whitepaper(
    public_vault: &str,
    sale_vault: &str,
    foundation: &str,
    partner_vault: &str,
    anchors: &[&str],
) -> Result<eav7::transaction::JsonValue, String> {
    use eav7::config::{GENESIS_STAKE, GENESIS_SUPPLY};
    use eav7::transaction::JsonValue;
    use std::collections::BTreeMap;

    let n = anchors.len();
    if n < GENESIS_LAUNCH_ANCHORS_MIN || n > GENESIS_LAUNCH_ANCHORS_MAX {
        return Err(format!(
            "launch anchors must be {GENESIS_LAUNCH_ANCHORS_MIN}..={GENESIS_LAUNCH_ANCHORS_MAX}, got {n}"
        ));
    }
    let mut seen = BTreeMap::new();
    for (i, a) in anchors.iter().enumerate() {
        if a.is_empty() {
            return Err(format!("anchor[{i}] empty"));
        }
        if seen.insert(a.to_string(), i).is_some() {
            return Err(format!("duplicate anchor {a}"));
        }
    }

    let (public, foundation_total, private_b, partner_total) = genesis_bucket_amounts();
    let stake_total = GENESIS_STAKE
        .checked_mul(n as u128)
        .ok_or("stake overflow")?;
    let foundation_bag = foundation_total
        .checked_sub(stake_total)
        .ok_or("foundation < N×stake")?;
    if foundation_bag % GENESIS_FOUNDATION_TRANCHES != 0 {
        return Err(format!(
            "foundation bag {foundation_bag} not divisible by {GENESIS_FOUNDATION_TRANCHES}"
        ));
    }
    if GENESIS_FOUNDATION_UNLOCK_MONTHS.len() as u128 + 1 != GENESIS_FOUNDATION_TRANCHES {
        return Err("foundation unlock months must be TRANCHES-1".into());
    }
    let tranche = foundation_bag / GENESIS_FOUNDATION_TRANCHES;
    let sum = public
        .saturating_add(private_b)
        .saturating_add(foundation_bag)
        .saturating_add(partner_total)
        .saturating_add(stake_total);
    if sum != GENESIS_SUPPLY {
        return Err(format!("bucket sum {sum} != GENESIS_SUPPLY {GENESIS_SUPPLY}"));
    }

    let mut stakes = BTreeMap::new();
    for a in anchors {
        stakes.insert(
            (*a).to_string(),
            JsonValue::Str(GENESIS_STAKE.to_string()),
        );
    }

    // Unlock em degrau: cliff == duration ⇒ no bloco do cliff vira o total da linha.
    let vesting: Vec<JsonValue> = GENESIS_FOUNDATION_UNLOCK_MONTHS
        .iter()
        .map(|&months| {
            let blocks = months * GENESIS_BLOCKS_PER_MONTH;
            JsonValue::map([
                (
                    "id".to_string(),
                    JsonValue::Str(format!("foundation-{months}m")),
                ),
                (
                    "beneficiary".to_string(),
                    JsonValue::Str(foundation.into()),
                ),
                ("total".to_string(), JsonValue::Str(tranche.to_string())),
                ("cliff".to_string(), JsonValue::Int(blocks as i64)),
                ("duration".to_string(), JsonValue::Int(blocks as i64)),
            ])
        })
        .collect();

    Ok(JsonValue::map([
        (
            "balances".to_string(),
            JsonValue::map([
                (public_vault.to_string(), JsonValue::Str(public.to_string())),
                (sale_vault.to_string(), JsonValue::Str(private_b.to_string())),
                (
                    partner_vault.to_string(),
                    JsonValue::Str(partner_total.to_string()),
                ),
                (
                    foundation.to_string(),
                    JsonValue::Str(tranche.to_string()),
                ),
            ]),
        ),
        ("stakes".to_string(), JsonValue::Map(stakes)),
        // Do NOT seed launch Anchors as bridge relayers — early bridge mint would
        // be a 4-of-7 foundation committee. Bridge committee is enabled later via gov.
        ("bridgeRelayers".to_string(), JsonValue::List(vec![])),
        ("vesting".to_string(), JsonValue::List(vesting)),
    ]))
}

/// Cria cadeia com buckets §12.2 (vaults + 5..=7 Âncoras + fundação 12 tranches).
pub fn cadeia_com_buckets_whitepaper(
    public_vault: &str,
    sale_vault: &str,
    foundation: &str,
    partner_vault: &str,
    anchors: &[&str],
    timestamp_ms: i64,
) -> Result<Blockchain, String> {
    let alocacoes = alocacoes_buckets_whitepaper(
        public_vault,
        sale_vault,
        foundation,
        partner_vault,
        anchors,
    )?;
    let genese = eav7::block::build_genesis_block(timestamp_ms, alocacoes);
    let mut bc = Blockchain::new();
    bc.adopt_genesis(genese)?;
    Ok(bc)
}

/// Cria gênese fundadora (supply + stake no endereço) e devolve a cadeia pronta.
pub fn cadeia_com_genese_fundadora(endereco: &str, timestamp_ms: i64) -> Result<Blockchain, String> {
    cadeia_com_genese_fundadora_e_vesting(endereco, timestamp_ms, &[])
}

/// Gênese fundadora com linhas de vesting (plano 21 / T6.1).
///
/// `vesting` = `(id, beneficiary, total_atomic)`. Cliff/duration usam os defaults
/// de launch (≥ 12m). O `total` NÃO é debitado de `balances` aqui — o gerador de
/// launch deve reservar supply líquido vs vestido ao montar o JSON.
pub fn cadeia_com_genese_fundadora_e_vesting(
    endereco: &str,
    timestamp_ms: i64,
    vesting: &[(&str, &str, u128)],
) -> Result<Blockchain, String> {
    use eav7::config::{GENESIS_STAKE, GENESIS_SUPPLY};
    use eav7::transaction::JsonValue;

    let mut alocacoes = vec![
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
    ];
    if !vesting.is_empty() {
        let itens: Vec<JsonValue> = vesting
            .iter()
            .map(|(id, benef, total)| {
                JsonValue::map([
                    ("id".to_string(), JsonValue::Str((*id).into())),
                    ("beneficiary".to_string(), JsonValue::Str((*benef).into())),
                    ("total".to_string(), JsonValue::Str(total.to_string())),
                    (
                        "cliff".to_string(),
                        JsonValue::Int(GENESIS_VESTING_CLIFF_BLOCKS as i64),
                    ),
                    (
                        "duration".to_string(),
                        JsonValue::Int(GENESIS_VESTING_DURATION_BLOCKS as i64),
                    ),
                ])
            })
            .collect();
        alocacoes.push(("vesting".to_string(), JsonValue::List(itens)));
    }

    let genese = eav7::block::build_genesis_block(timestamp_ms, JsonValue::map(alocacoes));
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
