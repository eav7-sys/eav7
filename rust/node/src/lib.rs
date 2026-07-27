//! Camada de NÓ do EAV7 — tudo o que está FORA do consenso.
//!
//! Princípio estrutural do porte: a LÓGICA (pura, testável, determinística) é
//! separada do TRANSPORTE (sockets, timers, HTTP). Os módulos de lógica não abrem
//! socket nem leem relógio por conta própria: recebem `now`/dados e devolvem
//! decisões. O transporte que os liga à rede é a única parte que depende do
//! runtime de I/O (tokio/axum).

pub mod ai;
pub mod api;
pub mod eavm_rpc;
pub mod gateway;
pub mod governance_advisor;
pub mod guard;
pub mod node;
pub mod p2p;
pub mod producer;
pub mod ratelimit;
pub mod validator_score;
pub mod verify_contract;
// A carteira mudou para o crate `eav7-sdk` — geração, carregamento e assinatura
// são trabalho de cliente, e o nó é só mais um cliente quando assina. O reexport
// mantém `eav7_node::wallet::…` funcionando para quem já dependia dele.
pub use eav7_sdk::wallet;

/// Linha canônica de um bloco para difusão P2P — `None` se não serializar.
///
/// Fica aqui, e não em cada chamador, porque a serialização de CONSENSO tem uma
/// única forma certa (`eav7::block::block_to_json_line`): um bloco difundido com
/// outra grafia teria outro hash no destino. O `Option` deixa o chamador decidir
/// o que fazer com o impossível, sem `unwrap`.
pub fn block_line(bloco: &eav7::block::Block) -> Option<String> {
    eav7::block::block_to_json_line(bloco).ok()
}
