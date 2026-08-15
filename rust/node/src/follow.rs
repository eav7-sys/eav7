//! Gate de tip estilo TRON — *miss slot* se estiver atrás ou em fork.
//!
//! # Modelo TRON (adaptado)
//!
//! Na TRON, se o SR do slot está offline/desalinhado, o **slot fica vazio** e o
//! próximo SR produz no horário seguinte. Aqui: se a tip local está **atrás** ou
//! **divergente** da tip da malha, o minerador **não produz** (miss slot) e o
//! sync P2P recupera a cadeia canónica.
//!
//! Estar *à frente* dos peers (acabámos de produzir; peers a apanhar) é normal —
//! não missa. Com `EAV7_FOLLOW`, à frente do intermediário canónico sim = fork.

use std::time::Duration;

use crate::p2p::{self, P2pConfig};

/// Atraso local vs tip de referência: acima disto = miss slot (apanhar sync).
pub const MAX_LAG_BLOCKS: i64 = 3;

/// Claim de peer acima disto é ignorado (anti halt H2).
pub const MAX_CLAIM_LAG: i64 = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FollowDecision {
    Allow,
    Hold(&'static str),
}

fn cfg() -> P2pConfig {
    P2pConfig {
        self_url: None,
        allow_private_peers: true,
        sync_ms: 5000,
    }
}

/// Tip canónica explícita (`EAV7_FOLLOW` / `--follow`).
pub async fn check(
    client: &p2p::HttpClient,
    follow_url: &str,
    local_height: i64,
    local_head: Option<&str>,
) -> FollowDecision {
    decide_against(
        fetch_tip(client, follow_url).await,
        local_height,
        local_head,
        true,
    )
}

/// Tip da malha (peers). Miss se atrás/divergente; à frente dos peers = OK.
pub async fn check_peers(
    client: &p2p::HttpClient,
    peers: &[String],
    local_height: i64,
    local_head: Option<&str>,
) -> FollowDecision {
    if peers.is_empty() {
        return FollowDecision::Allow;
    }
    let cfg = cfg();
    let mut best_h: Option<i64> = None;
    let mut best_hash: Option<String> = None;
    let mut reachable = 0u32;

    for peer in peers {
        let url = format!("{}/status", peer.trim_end_matches('/'));
        let Ok(status) = p2p::fetch_json_capped(client, &cfg, &url, 1_000_000, 1500).await else {
            continue;
        };
        let Some(h) = status.get("height").and_then(|v| v.as_i64()) else {
            continue;
        };
        if h > local_height + MAX_CLAIM_LAG {
            continue;
        }
        reachable += 1;
        let hash = status
            .get("headHash")
            .and_then(|v| v.as_str())
            .map(str::to_owned);
        match best_h {
            None => {
                best_h = Some(h);
                best_hash = hash;
            }
            Some(bh) if h > bh => {
                best_h = Some(h);
                best_hash = hash;
            }
            Some(bh) if h == bh => {
                if best_hash.is_some() && hash.is_some() && best_hash != hash {
                    return FollowDecision::Hold("peer-tip-fork");
                }
            }
            _ => {}
        }
    }

    if reachable == 0 {
        return FollowDecision::Allow;
    }

    decide_against(
        best_h.map(|h| (h, best_hash)),
        local_height,
        local_head,
        false,
    )
}

async fn fetch_tip(
    client: &p2p::HttpClient,
    base: &str,
) -> Option<(i64, Option<String>)> {
    let url = format!("{}/status", base.trim_end_matches('/'));
    let status = p2p::fetch_json_capped(client, &cfg(), &url, 1_000_000, 3000)
        .await
        .ok()?;
    let h = status.get("height").and_then(|v| v.as_i64())?;
    let hash = status
        .get("headHash")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    Some((h, hash))
}

fn decide_against(
    remote: Option<(i64, Option<String>)>,
    local_height: i64,
    local_head: Option<&str>,
    strict_ahead: bool,
) -> FollowDecision {
    let Some((remote_h, remote_head)) = remote else {
        return FollowDecision::Hold("follow-unreachable");
    };
    if remote_h > local_height + MAX_LAG_BLOCKS {
        return FollowDecision::Hold("behind-canonical");
    }
    if remote_h > local_height {
        return FollowDecision::Hold("catching-up");
    }
    if remote_h < local_height {
        if strict_ahead && local_height - remote_h > MAX_LAG_BLOCKS {
            return FollowDecision::Hold("ahead-of-canonical");
        }
        return FollowDecision::Allow;
    }
    match (remote_head.as_deref(), local_head) {
        (Some(r), Some(l)) if r == l => FollowDecision::Allow,
        (Some(_), Some(_)) => FollowDecision::Hold("tip-diverged"),
        (None, _) => FollowDecision::Allow,
        (_, None) => FollowDecision::Hold("local-no-head"),
    }
}

pub struct HoldLogger {
    every: Duration,
    last: Option<std::time::Instant>,
    last_reason: Option<&'static str>,
}

impl HoldLogger {
    pub fn new(every: Duration) -> Self {
        Self {
            every,
            last: None,
            last_reason: None,
        }
    }

    pub fn maybe_log(&mut self, reason: &'static str) {
        let now = std::time::Instant::now();
        let changed = self.last_reason != Some(reason);
        let due = self
            .last
            .map(|t| now.duration_since(t) >= self.every)
            .unwrap_or(true);
        if changed || due {
            println!("[minerador] miss slot (tip): {reason}");
            self.last = Some(now);
            self.last_reason = Some(reason);
        }
    }
}
