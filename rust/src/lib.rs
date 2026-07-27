//! Cliente EAV7 — protocolo `eav20`.
//!
//! # Relação com o nó em JavaScript
//!
//! O nó em JS é a implementação de REFERÊNCIA: legível, auditável, no mesmo papel
//! que o `execution-specs` em Python tem para o Ethereum. Este crate é a
//! implementação de PRODUÇÃO.
//!
//! O contrato entre os dois é `vectors/` — vetores de conformidade gerados pela
//! referência (`node bin/eav7-vectors.js`). Este crate não está correto porque
//! "parece certo": está correto quando reproduz os vetores byte a byte. Onde os
//! dois divergirem, o ponto de divergência é exatamente um lugar onde o protocolo
//! não estava especificado com precisão suficiente — e o conserto é na
//! especificação, não só no código.
//!
//! Ver `tests/vectors.rs`.

pub mod address;
pub mod block;
pub mod blockchain;
pub mod blockstore;
pub mod canonical;
pub mod config;
pub mod mempool;
pub mod eavm;
pub mod hash;
pub mod signature;
pub mod state;
pub mod snapshot;
pub mod stateroot;
pub mod transaction;

pub use address::{derive_address_from, is_valid_address, ADDRESS_LEN, ADDRESS_PREFIX};
pub use block::{
    block_hash, block_validator, build_block, verify_block_integrity, Block, BlockSigner,
    BuildParams, GENESIS_PREVIOUS_HASH,
};
pub use blockchain::{Blockchain, Reorg, Validator};
pub use canonical::{encode as encode_canonical, encode_hex as canonical_hex, Value};
pub use hash::{eav_hash, eav_hash_one, is_valid_hash, merkle_root, HASH_LEN};
pub use signature::{
    address_from_public_keys, hybrid_verify, HybridPublicKey, SignatureError, PQ_ALGORITHM,
    SIGNATURE_SCHEME,
};
pub use stateroot::{
    account_leaf, compute_state_root, leaf, merkle_path, sort_leaves, verify_state_proof, PathStep,
};
pub use transaction::{
    canonical_json, tx_id, tx_signing_payload, verify_transaction, JsonValue, Tx,
};
pub use state::{Account, Amount, State, StateError};
