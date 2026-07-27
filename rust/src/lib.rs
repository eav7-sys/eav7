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

// AS REGRAS — compilam em qualquer alvo, inclusive `wasm32`. É o que permite a
// carteira do navegador usar ESTA implementação em vez de manter a própria cópia
// de keccak, secp256k1 e derivação de endereço.
pub mod address;
pub mod block;
pub mod canonical;
pub mod config;
pub mod eavm;
pub mod hash;
pub mod mempool;
pub mod signature;
pub mod state;
pub mod stateroot;
pub mod transaction;

// O ARMAZENAMENTO — só onde há sistema de arquivos.
//
// `blockstore` usa `read_exact_at` (POSIX) e `snapshot` grava em disco; nenhum dos
// dois faz sentido no navegador, e `blockchain` depende dos dois. Recortar por
// alvo é o que torna a lib compilável para WASM sem inventar uma segunda lib "só
// com as regras" — que seria mais uma cópia a manter em dia.
#[cfg(not(target_arch = "wasm32"))]
pub mod blockchain;
#[cfg(not(target_arch = "wasm32"))]
pub mod blockstore;
#[cfg(not(target_arch = "wasm32"))]
pub mod snapshot;

pub use address::{derive_address_from, is_valid_address, ADDRESS_LEN, ADDRESS_PREFIX};
pub use block::{
    block_hash, block_validator, build_block, verify_block_integrity, Block, BlockSigner,
    BuildParams, GENESIS_PREVIOUS_HASH,
};
#[cfg(not(target_arch = "wasm32"))]
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
