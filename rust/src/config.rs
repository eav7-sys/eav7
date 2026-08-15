//! Parâmetros do protocolo eav20.
//!
//! Fonte canônica dos parâmetros de consenso. Edite aqui e recompile.
//!
//! Toda constante de consenso mora AQUI. Módulo que declare a própria cópia
//! reintroduz o problema que este arquivo resolve.

#![allow(dead_code)]

// ---- parâmetros de topo ----
pub const NAME: &str = "EAV7";
pub const PROTOCOL: &str = "eav20";
pub const PROTOCOL_VERSION: u64 = 1;
pub const ADDRESS_PREFIX: &str = "E7";
pub const HASH_PREFIX: &str = "E7";
pub const SYMBOL: &str = "EAV7";
pub const DECIMALS: u64 = 6;
pub const UNIT: u128 = 1000000;
pub const HASH_LENGTH: u64 = 64;
pub const ADDRESS_LENGTH: u64 = 34;
pub const BLOCK_TIME_MS: u64 = 1000;
pub const MAX_TXS_PER_BLOCK: u64 = 500;
pub const MAX_CLOCK_DRIFT_MS: u64 = 2000;
pub const SLOT_FUTURE_TOLERANCE_MS: u64 = 400;
/// Launch / T7: all consensus forks active from height 0 (except AI_TEE).
pub const STRICT_PRODUCER_HEIGHT: u64 = 0;
pub const PRODUCE_LAG_TOLERANCE: u64 = 5;
pub const REORG_WINDOW: u64 = 5000;
pub const SNAPSHOT_INTERVAL_BLOCKS: u64 = 1000;
/// Âncoras ativas (≠ 27 TRON). Ver `docs/plano/17-set-51-banco-101.md`.
pub const MAX_VALIDATORS: u64 = 51;
/// Reservas após as ativas → top `MAX_VALIDATORS + VALIDATOR_BANK_SIZE` (= 101).
pub const VALIDATOR_BANK_SIZE: u64 = 50;
pub const MIN_VALIDATOR_STAKE: u128 = 1000000000;
pub const UNBONDING_BLOCKS: u64 = 604800;
pub const MAX_UNBONDING_ENTRIES: u64 = 32;
pub const SLASHING_HEIGHT: u64 = 0;
pub const SLASH_PERCENT: u64 = 10;
pub const SLASH_REPORTER_PERCENT: u64 = 10;
pub const VOTING_HEIGHT: u64 = 0;
pub const MAX_VOTE_TARGETS: u64 = 30;
pub const DEFAULT_COMMISSION_PCT: u64 = 20;
pub const COMMISSION_DELAY_BLOCKS: u64 = 21600;
pub const REWARD_SCALE: u128 = 1000000000000000000;
pub const TREASURY_PCT: u64 = 0;
pub const PERMISSIONS_HEIGHT: u64 = 0;
pub const MAX_PERMISSION_KEYS: u64 = 20;
pub const PERMISSIONS_V2_HEIGHT: u64 = 0;
pub const PERM_DELAY_MIN_BLOCKS: u64 = 3600;
pub const PERM_DELAY_MAX_BLOCKS: u64 = 2592000;
pub const PERM_DELAY_DEFAULT_BLOCKS: u64 = 43200;
pub const MAX_ACTIVE_PERMISSIONS: u64 = 8;
pub const MAX_PERMISSION_NAME: u64 = 32;
pub const GOVERNANCE_HEIGHT: u64 = 0;
pub const GOV_MAX_VOTING_BLOCKS: u64 = 200000;
pub const GOV_TIMELOCK_BLOCKS: u64 = 40000;
pub const MULTISIG_OP_TTL_BLOCKS: u64 = 100000;
pub const MIN_ORACLE_STAKE: u128 = 500000000;
pub const FEE_EXEMPT_STAKE: u128 = 100000000;
pub const BLOCK_REWARD: u128 = 16000000;
pub const HALVING_INTERVAL_BLOCKS: u64 = 126144000;
pub const GENESIS_SUPPLY: u128 = 100000000000000000;
pub const GENESIS_STAKE: u128 = 10000000000;
pub const BRIDGE_MIN_ATTESTATIONS: u64 = 1;
pub const BRIDGE_QUORUM_HEIGHT: u64 = 0;
pub const BRIDGE_PROOF_HEIGHT: u64 = 0;
pub const CANONICAL_HASH_HEIGHT: u64 = 0;
pub const STATEROOT_HEIGHT: u64 = 0;
pub const FINALITY_MIN_VALIDATORS: u64 = 3;
/// Breaker on from genesis; committee still empty until governance enables bridge.
pub const BRIDGE_BREAKER_HEIGHT: u64 = 0;
pub const BRIDGE_BREAKER_WINDOW_BLOCKS: u64 = 3600;
pub const BRIDGE_BREAKER_BPS: u64 = 3000;
/// TEE attestation stays gated until an attester is ready (not a day-1 fork).
pub const AI_TEE_HEIGHT: u64 = 100000000;
pub const MAX_AI_ATTESTER_MEMBERS: u64 = 32;
pub const RATE_LIMIT_WINDOW_MS: u64 = 10000;
pub const RATE_LIMIT_MAX: u64 = 240;
pub const MAX_DATA_BYTES: u64 = 65536;
pub const MAX_AI_PROMPT_BYTES: u64 = 8192;
pub const MAX_AI_OUTPUT_BYTES: u64 = 32768;
pub const AI_TASK_TIMEOUT_MS: u64 = 3600000;
pub const AI_ACCOUNTABILITY_HEIGHT: u64 = 0;
pub const AI_ORACLE_SLASH: u128 = 10000000;
pub const AI_QUORUM_HEIGHT: u64 = 0;
pub const AI_COMMIT_WINDOW_MS: u64 = 1800000;
pub const AI_REVEAL_WINDOW_MS: u64 = 1800000;
pub const MIN_AI_QUORUM: u64 = 2;
pub const MAX_AI_QUORUM: u64 = 21;
pub const AI_CHALLENGE_HEIGHT: u64 = 0;
pub const AI_CHALLENGE_WINDOW_MS: u64 = 1800000;
pub const AI_VERDICT_WINDOW_MS: u64 = 1800000;
pub const AI_CHALLENGE_BOND: u128 = 20000000;
pub const AI_VERDICT_QUORUM: u64 = 3;
pub const AI_MARKET_HEIGHT: u64 = 0;
pub const AI_BID_WINDOW_MS: u64 = 1800000;
pub const AI_PRIVATE_HEIGHT: u64 = 0;
pub const MAX_AI_URI_BYTES: u64 = 512;
pub const MAX_MEMPOOL: u64 = 5000;
pub const MEMPOOL_TTL_MS: u64 = 21600000;
pub const MAX_FUTURE_NONCE_GAP: u64 = 64;
pub const MAX_PEERS: u64 = 64;
pub const MAX_RPC_BATCH: u64 = 50;
pub const MAX_CHAIN_PAGE: u64 = 2000;
pub const MAX_SYNC_BLOCKS: u64 = 10000;
pub const MAX_SYNC_PAGE_BYTES: u64 = 16000000;
pub const MAX_TX_SCAN: u64 = 20000;
pub const MAX_LOG_INDEX: u64 = 100000;
pub const MAX_ALERT_CONTEXT_BYTES: u64 = 2048;
/// Mainnet `72020` · testnet pública `72021` (feature Cargo `testnet`).
/// Fixo no build — o nó confere `ENV_DE_CONSENSO` no boot e aborta se o
/// ambiente pedir outro chain id sem o binário correspondente.
#[cfg(feature = "testnet")]
pub const EAVM_CHAIN_ID: u64 = 72021;
#[cfg(not(feature = "testnet"))]
pub const EAVM_CHAIN_ID: u64 = 72020;
pub const EAVM_WEI_PER_E7: u128 = 1000000000000;
pub const RESOURCE_WINDOW_BLOCKS: u64 = 86400;
pub const RESOURCE_HEIGHT: u64 = 0;
/// GB · Assinatura Livre from genesis (T7 launch).
pub const GB_FEE_HEIGHT: u64 = 0;
/// Compact block encoding from genesis (T7 / A2).
pub const COMPACT_BLOCK_HEIGHT: u64 = 0;
/// Cota base: 1 GB/dia em bytes ponderados.
pub const GB_DAILY_BYTES: u64 = 1_000_000_000;
/// +1 MB/dia por 1 EAV7 de resource-stake.
pub const GB_PER_STAKED_EAV7_MB: u64 = 1;
/// Piso anti-dust (bytes ponderados por tx).
pub const GB_MIN_WEIGHTED: u64 = 1_024;
pub const VESTING_HEIGHT: u64 = 0;
pub const MAX_VESTING_BLOCKS: u64 = 315360000;
pub const META_HEIGHT: u64 = 0;
pub const TOKEN_ADMIN_HEIGHT: u64 = 0;
pub const NFT_HEIGHT: u64 = 0;
pub const MAX_NFT_URI_BYTES: u64 = 2048;
pub const NAME_HEIGHT: u64 = 0;
pub const NAME_REGISTER_COST: u128 = 1000000;
pub const MAX_FEE_LIMIT: u128 = 100000000;
pub const GAS_PER_ENERGY: u64 = 100;
pub const EAVM_VALUE_HEIGHT: u64 = 0;
pub const EAVM_CONTRACTS_HEIGHT: u64 = 0;
pub const EAVM_OSAKA_HEIGHT: u64 = 0;
pub const BLOCKHASH_HISTORY: u64 = 8191;
pub const BLOCKHASH_WINDOW: u64 = 256;
pub const BN254_GAS_MULTIPLIER: u128 = 13;
pub const MAX_EAVM_GAS: u64 = 5190000;
pub const MAX_CONTRACT_BYTES: u64 = 24576;
pub const MAX_EAVM_CALLDATA: u64 = 3072;
pub const MAX_LOG_RANGE: u64 = 5000;
pub const MAX_LOG_RESULTS: u64 = 10000;

/// `CHAIN.ENERGY` da referência.
pub mod energy {
    pub const FREE: u64 = 10;
    pub const PER_STAKED_EAV7: u64 = 1;
    pub const TOTAL_LIMIT: u64 = 4484419200;
    pub const REGEN_BLOCKS: u64 = 86400;
    pub const BURN_PER_ENERGY: u128 = 20000;
}

/// `CHAIN.BANDWIDTH` da referência.
pub mod bandwidth {
    pub const FREE: u64 = 8000;
    pub const PER_STAKED_EAV7: u64 = 256;
    pub const TOTAL_LIMIT: u64 = 129600000000;
    pub const PUBLIC_LIMIT: u64 = 43200000000;
    pub const REGEN_BLOCKS: u64 = 86400;
    pub const BURN_PER_BYTE: u128 = 5;
}

/// Trilho GB (após `GB_FEE_HEIGHT`). Overflow queima com o mesmo `BURN_PER_BYTE`.
pub mod gb {
    pub const DAILY_BYTES: u64 = crate::config::GB_DAILY_BYTES;
    pub const PER_STAKED_EAV7_BYTES: u64 = crate::config::GB_PER_STAKED_EAV7_MB * 1_000_000;
    pub const REGEN_BLOCKS: u64 = 86400;
    pub const MIN_WEIGHTED: u64 = crate::config::GB_MIN_WEIGHTED;
    pub const BURN_PER_WEIGHTED_BYTE: u128 = super::bandwidth::BURN_PER_BYTE;
}

/// `CHAIN.FEES` da referência.
pub mod fees {
    pub const TRANSFER: u128 = 10000;
    pub const STAKE: u128 = 10000;
    pub const UNSTAKE: u128 = 10000;
    pub const VOTE: u128 = 10000;
    pub const DELEGATE_RESOURCE: u128 = 10000;
    pub const UNDELEGATE_RESOURCE: u128 = 10000;
    pub const GOV_PROPOSE: u128 = 50000;
    pub const GOV_VOTE: u128 = 10000;
    pub const SLASH_DOUBLE_SIGN: u128 = 20000;
    pub const VESTING_CREATE: u128 = 20000;
    pub const VESTING_CLAIM: u128 = 10000;
    pub const SET_COMMISSION: u128 = 10000;
    pub const CLAIM_VOTER_REWARD: u128 = 10000;
    pub const META_TX: u128 = 30000;
    pub const BRIDGE_COMMITTEE_UPDATE: u128 = 20000;
    pub const PERMISSION_UPDATE: u128 = 20000;
    pub const PERMISSION_PROPOSE: u128 = 20000;
    pub const PERMISSION_APPROVE: u128 = 10000;
    pub const PERMISSION_VETO: u128 = 1000;
    pub const MULTISIG_PROPOSE: u128 = 20000;
    pub const MULTISIG_APPROVE: u128 = 10000;
    pub const TOKEN_CREATE: u128 = 10000000;
    pub const TOKEN_TRANSFER: u128 = 20000;
    pub const TOKEN_APPROVE: u128 = 10000;
    pub const TOKEN_TRANSFER_FROM: u128 = 20000;
    pub const TOKEN_MINT: u128 = 20000;
    pub const TOKEN_BURN: u128 = 20000;
    pub const TOKEN_PAUSE: u128 = 10000;
    pub const TOKEN_UNPAUSE: u128 = 10000;
    pub const TOKEN_BLACKLIST: u128 = 10000;
    pub const TOKEN_FREEZE: u128 = 10000;
    pub const TOKEN_UNFREEZE: u128 = 10000;
    pub const NFT_CREATE: u128 = 10000000;
    pub const NFT_MINT: u128 = 30000;
    pub const NFT_TRANSFER: u128 = 20000;
    pub const NFT_APPROVE: u128 = 10000;
    pub const NFT_BURN: u128 = 20000;
    pub const NAME_REGISTER: u128 = 1000000;
    pub const NAME_UPDATE: u128 = 10000;
    pub const NAME_TRANSFER: u128 = 10000;
    pub const NAME_RELEASE: u128 = 10000;
    pub const AI_TASK: u128 = 50000;
    pub const AI_RESULT: u128 = 0;
    pub const AI_COMMIT: u128 = 10000;
    pub const AI_REVEAL: u128 = 10000;
    pub const AI_CLAIM: u128 = 10000;
    pub const AI_CHALLENGE: u128 = 20000;
    pub const AI_VERDICT: u128 = 10000;
    pub const AI_BID: u128 = 10000;
    pub const AI_AWARD: u128 = 10000;
    pub const ORACLE_REGISTER: u128 = 10000;
    pub const BRIDGE_OUT: u128 = 20000;
    pub const BRIDGE_IN: u128 = 0;
    pub const BRIDGE_SETTLE: u128 = 0;
    pub const AI_REFUND: u128 = 0;
    pub const EAVM_TRANSFER: u128 = 10000;
    pub const EAVM_DEPLOY: u128 = 200000;
    pub const EAVM_CALL: u128 = 100000;
}

/// Custo em ENERGIA por tipo de transação (`CHAIN.ENERGY.COST`).
///
/// Consenso: entra no trilho de recursos de TODA transação. Um tipo ausente
/// aqui vale 1 na referência (`?? 1`), e é o que `energy_cost` devolve.
pub const ENERGY_COST: &[(&str, u64)] = &[
    ("TRANSFER", 1),
    ("STAKE", 1),
    ("UNSTAKE", 1),
    ("VOTE", 1),
    ("EAVM_TRANSFER", 1),
    ("PERMISSION_UPDATE", 2),
    ("MULTISIG_PROPOSE", 2),
    ("MULTISIG_APPROVE", 1),
    ("PERMISSION_PROPOSE", 2),
    ("PERMISSION_APPROVE", 1),
    ("PERMISSION_VETO", 1),
    ("DELEGATE_RESOURCE", 1),
    ("UNDELEGATE_RESOURCE", 1),
    ("GOV_PROPOSE", 2),
    ("GOV_VOTE", 1),
    ("SLASH_DOUBLE_SIGN", 8),
    ("BRIDGE_COMMITTEE_UPDATE", 2),
    ("VESTING_CREATE", 2),
    ("VESTING_CLAIM", 1),
    ("SET_COMMISSION", 1),
    ("CLAIM_VOTER_REWARD", 1),
    ("META_TX", 3),
    ("TOKEN_TRANSFER", 2),
    ("TOKEN_TRANSFER_FROM", 2),
    ("TOKEN_APPROVE", 1),
    ("TOKEN_CREATE", 10),
    ("TOKEN_MINT", 2),
    ("TOKEN_BURN", 2),
    ("TOKEN_PAUSE", 1),
    ("TOKEN_UNPAUSE", 1),
    ("TOKEN_BLACKLIST", 1),
    ("TOKEN_FREEZE", 1),
    ("TOKEN_UNFREEZE", 1),
    ("NFT_CREATE", 10),
    ("NFT_MINT", 3),
    ("NFT_TRANSFER", 2),
    ("NFT_APPROVE", 1),
    ("NFT_BURN", 2),
    ("NAME_REGISTER", 3),
    ("NAME_UPDATE", 1),
    ("NAME_TRANSFER", 1),
    ("NAME_RELEASE", 1),
    ("AI_TASK", 5),
    ("AI_RESULT", 0),
    ("AI_REFUND", 0),
    ("ORACLE_REGISTER", 2),
    ("AI_COMMIT", 1),
    ("AI_REVEAL", 1),
    ("AI_CLAIM", 1),
    ("AI_CHALLENGE", 2),
    ("AI_VERDICT", 1),
    ("AI_BID", 1),
    ("AI_AWARD", 1),
    ("BRIDGE_OUT", 2),
    ("BRIDGE_IN", 0),
    ("BRIDGE_SETTLE", 0),
    ("EAVM_DEPLOY", 10),
    ("EAVM_CALL", 5),
];

/// Custo em energia do tipo, com o default 1 da referência (`?? 1`).
pub fn energy_cost(tipo: &str) -> u64 {
    ENERGY_COST.iter().find(|(t, _)| *t == tipo).map_or(1, |(_, c)| *c)
}

/// Alturas de fork, na ordem declarada pela referência.
///
/// Zeradas quando `EAV7_GENESIS_ACTIVE=1` — um gênese novo nasce com tudo ativo.
/// Um cliente que ignore essa variável divergiria de uma rede de testes inteira.
pub const FORK_HEIGHTS: &[(&str, u64)] = &[
    ("STRICT_PRODUCER_HEIGHT", 0),
    ("CANONICAL_HASH_HEIGHT", 0),
    ("STATEROOT_HEIGHT", 0),
    ("BRIDGE_QUORUM_HEIGHT", 0),
    ("BRIDGE_PROOF_HEIGHT", 0),
    ("VOTING_HEIGHT", 0),
    ("PERMISSIONS_HEIGHT", 0),
    ("RESOURCE_HEIGHT", 0),
    ("GB_FEE_HEIGHT", 0),
    ("COMPACT_BLOCK_HEIGHT", 0),
    ("GOVERNANCE_HEIGHT", 0),
    ("VESTING_HEIGHT", 0),
    ("META_HEIGHT", 0),
    ("TOKEN_ADMIN_HEIGHT", 0),
    ("NFT_HEIGHT", 0),
    ("NAME_HEIGHT", 0),
    ("AI_ACCOUNTABILITY_HEIGHT", 0),
    ("AI_QUORUM_HEIGHT", 0),
    ("AI_CHALLENGE_HEIGHT", 0),
    ("AI_MARKET_HEIGHT", 0),
    ("AI_PRIVATE_HEIGHT", 0),
    ("EAVM_VALUE_HEIGHT", 0),
    ("PERMISSIONS_V2_HEIGHT", 0),
    ("EAVM_CONTRACTS_HEIGHT", 0),
    ("EAVM_OSAKA_HEIGHT", 0),
];

/// EM QUE MODO ESTE BINÁRIO FOI COMPILADO.
///
/// O JavaScript zera as alturas de fork em TEMPO DE EXECUÇÃO quando
/// `EAV7_GENESIS_ACTIVE=1`; o Rust as tem como `const` (custo zero, mas fixas
/// no build). As duas coisas SÓ são equivalentes se o binário tiver sido
/// gerado no mesmo modo em que roda — senão o cliente aplica regras de fork
/// diferentes das da rede e diverge em silêncio, que é a pior falha possível.
///
/// Por isso este marcador existe e o nó o CONFERE contra o ambiente no boot,
/// abortando se divergirem. Um erro de consenso silencioso vira uma falha de
/// inicialização ruidosa.
pub const GENESIS_ACTIVE_BUILD: bool = true;

/// AMBIENTE COM QUE ESTE BINÁRIO FOI GERADO, para as variáveis que mudam valor
/// de consenso em tempo de execução na referência.
///
/// `(nome, valor)`; ausente vira string vazia. O nó compara com o ambiente REAL
/// no boot e aborta se divergirem — pelo mesmo motivo de
/// [`GENESIS_ACTIVE_BUILD`]: um binário gerado sem `EAV7_AI_TEE_HEIGHT` e rodado
/// numa rede que a define aplica um fork diferente do resto da rede, e diverge
/// em silêncio no primeiro bloco que dependa dele.
pub const ENV_DE_CONSENSO: &[(&str, &str)] = &[
    ("EAV7_NETWORK_NAME", ""),
    ("EAV7_PROTOCOL", ""),
    ("EAV7_GOV_TIMELOCK_BLOCKS", ""),
    ("EAV7_BRIDGE_BREAKER_HEIGHT", ""),
    ("EAV7_AI_TEE_HEIGHT", ""),
    ("EAV7_EAVM_CHAIN_ID", ""),
];
