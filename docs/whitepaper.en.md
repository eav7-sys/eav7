# EAV7 — A Layer 1 Blockchain with Post-Quantum Security and a Native Artificial Intelligence Layer

**Technical Whitepaper · Version 1.0 · August 11, 2026**

Protocol `eav20` · Symbol `EAV7` · EAVM Chain ID `72020` (mainnet) / `72021` (testnet)

---

> **Preliminary notice.** This document describes a protocol at pre-mainnet stage. Section 13 (Maturity Status) separates what is implemented and active, what is implemented but gated behind a fork height, and what is roadmap. Section 14 (Risk Factors) and Section 15 (Legal Disclaimer) are integral parts of this document and must not be read in isolation. Nothing in this whitepaper constitutes an offer, an investment recommendation, or a guarantee of outcome.

---

## Contents

1. [Executive Summary](#1-executive-summary)
2. [Motivation and Positioning](#2-motivation-and-positioning)
3. [Architecture and Software Stack](#3-architecture-and-software-stack)
4. [Consensus](#4-consensus)
5. [Cryptography and the Post-Quantum Model](#5-cryptography-and-the-post-quantum-model)
6. [Data Structures and State Commitment](#6-data-structures-and-state-commitment)
7. [Resource Model and Fees](#7-resource-model-and-fees)
8. [Staking, Validation, and Governance](#8-staking-validation-and-governance)
9. [EAVM — Virtual Machine and Wallet Compatibility](#9-eavm--virtual-machine-and-wallet-compatibility)
10. [Native Artificial Intelligence Layer](#10-native-artificial-intelligence-layer)
11. [Cross-Chain Bridge](#11-cross-chain-bridge)
12. [Tokenomics](#12-tokenomics)
13. [Maturity Status](#13-maturity-status)
14. [Risk Factors](#14-risk-factors)
15. [Legal Disclaimer](#15-legal-disclaimer)
16. [Appendix A — Consensus Parameters](#appendix-a--consensus-parameters)

---

## 1. Executive Summary

EAV7 is a layer 1 blockchain implemented in Rust, combining three design decisions that are unusual when taken together.

**Mandatory hybrid post-quantum signatures.** Every wallet, transaction, and block carries **two** independent signatures — ECDSA over secp256k1 and ML-DSA-44 (NIST FIPS 204) — and both must verify for the object to be accepted. This is not an optional mode or a planned migration: it is the only scheme the protocol knows, named `eav7-hybrid-1`. An adversary with a cryptographically relevant quantum computer who breaks the elliptic curve still faces the lattice; an adversary who finds a structural flaw in ML-DSA still faces the curve.

**AI as a consensus primitive, not as a narrative.** EAV7 defines native transaction types to commission, deliver, dispute, and settle artificial intelligence work, with on-chain escrow, oracle reputation, commit-reveal quorum, an optimistic challenge window with jury adjudication, reverse auctions for oracle selection, and immediate settlement on cryptographic attestation. Equally important is what AI **cannot** do: no AI component in EAV7 holds binding power over consensus, the validator set, stake, or code. That boundary is architectural and verifiable in the source.

**Deflationary economics with minimal issuance.** One hundred billion EAV7 at genesis, one-second blocks, 16 EAV7 per block with halving roughly every four years. First-year issuance equals **0.50%** of the genesis supply, and total issuance across all halvings sums to 4,036,608,000 EAV7 — approximately 4.04% additional. Against this, **100% of transaction fees are burned**: they do not go to the validator, and they do not go to the treasury. Under meaningful usage, the network is structurally deflationary.

On this foundation EAV7 implements the feature set expected of a mature L1: DPoS with BFT finality, validator voting with voter rewards, per-account multi-signature permissions, a GB resource quota with delegation, owner-authorized governance with a timelock, vesting, gasless meta-transactions, and an EAVM that executes EVM bytecode and speaks the JSON-RPC dialect understood by Ethereum-ecosystem wallets. EAV20 is the product token standard: an ERC-20-compatible Solidity contract on the EAVM.

The reference implementation is a Rust workspace — a consensus library, a full node, an operator CLI, an SDK, and a WebAssembly crypto module — plus a Next.js block explorer. Section 3 describes the stack; Section 13 states precisely how far it has been taken.

---

## 2. Motivation and Positioning

### 2.1 The harvest-now problem

The quantum threat to elliptic-curve cryptography is not symmetric in time. An adversary can capture a blockchain's public traffic and history today and decrypt it years later, once the hardware exists — the strategy known as *harvest now, decrypt later*. For a blockchain this is particularly severe: public keys are permanently exposed in the history the moment an account transacts, and the record is immutable and public by construction.

NIST standardized ML-DSA in August 2024 (FIPS 204). Most existing networks have responded by deferring: migrating a signature scheme on a chain carrying significant economic value is among the riskiest operations there is, because it requires coordinating an entire ecosystem of wallets, exchanges, and contracts. EAV7 starts from the premise that **being born hybrid is substantially cheaper than migrating later**, and accepts the cost — larger signatures, more expensive verification, higher bandwidth per transaction — as the price of entry.

### 2.2 Why a native AI layer

AI inference services are consumed today through centralized APIs, with three properties that are poor fits for on-chain applications: the result is not verifiable, payment is not atomic with delivery, and the provider has nothing at stake if it lies or fails to deliver.

EAV7 treats inference as an oracle market with explicit economic guarantees. A requester escrows the reward at task creation. The oracle has stake at risk. Delivery can be validated by agreement among multiple independent oracles (commit-reveal), by absence of challenge within a window (optimistic verification with a bonded jury), or by signature from a registered attester — and in the last case it settles immediately, without relying on reputation.

### 2.3 Design principles

EAV7 is its own L1: a 100-billion genesis supply, regenerating resources (GB quota) instead of a gas market, DPoS with deterministic rotation, a token path via contracts on the EAVM (EVM bytecode), ~one-second blocks, 51 active validator seats with a 50-seat standby bank, hybrid post-quantum signatures, a native AI layer, a GB quota that does not charge signature bytes, and **full fee burning**.

---

## 3. Architecture and Software Stack

### 3.1 Crates and responsibilities

The reference implementation is a single Rust workspace. Dependencies flow in one direction — the consensus library depends on nothing above it, and no component above it re-implements a consensus rule.

| Crate / path | Role |
|---|---|
| `rust/` (`eav7`) | Consensus library: state machine, blocks, transactions, state root, EAVM, bridge, governance |
| `rust/node` (`eav7-node`) | Full node: REST API, P2P, block producer, EAVM JSON-RPC |
| `rust/core` (`eav7-core`) | Operator CLI: configuration, wallet, node supervision, stake and validator operations |
| `rust/sdk` (`eav7-sdk`) | Wallet, blocking HTTP client, light-client proof verification, relayer helpers |
| `rust/wasm` (`eav7-wasm`) | Hybrid cryptography compiled to WebAssembly for browser wallets |
| `web-next/` | Block explorer and wallet interface (Next.js) |
| `vectors/` | Frozen conformance fixtures for canonical serialization, crypto, state, and the EAVM |

Consensus cryptography uses established Rust crates (`k256`, `sha2`, `sha3`, `ripemd`, the ML-DSA implementation, and `ark-bn254` for the pairing precompile) rather than in-repository primitives. The `vectors/` fixtures pin the byte-level behaviour that any conforming implementation must reproduce: canonical JSON, transaction identifiers, address derivation, state leaves, state roots, and EAVM envelopes.

There is no JavaScript blockchain client. The explorer is a read-only front end over the node's HTTP API.

### 3.2 Client and operator path

`eav7-core` is the entry point for anyone who wants to run EAV7 without reading the monorepo. It generates and stores the hybrid keypair, writes a configuration file under a platform-native data directory, supervises an `eav7-node` process, and exposes the stake and validator operations through the SDK. Its `ancora-init` flow creates an owner backup set and a separate witness keystore, so an operator can establish an Anchor without placing owner material on the block-producing server.

| Mode | Behaviour |
|---|---|
| `listen` | Synchronize and serve the API; no wallet bound to production, no blocks produced |
| `candidate` | Wallet bound; produces blocks **if** the account ranks inside the active set |
| `validator` | Same protocol behaviour as `candidate`; the distinct name records the operator's intent to run 24/7 |

Default data directories are `~/.eav7` on Linux, `~/Library/Application Support/EAV7` on macOS, and `%APPDATA%\EAV7` on Windows, overridable with `EAV7_HOME`. Service definitions for systemd, launchd, and Windows (via `sc.exe` or NSSM) ship in `deploy/`. Release archives with SHA-256 digests are published per tag for Linux x64, Linux arm64, macOS arm64, and Windows x64.

Operational key hygiene is part of the model, not an afterthought: an Anchor's cold `owner` authority is hybrid M-of-N (the product default is 2-of-3), while its hot `witness` key is the only key used to produce blocks. The witness must not authorize governance or other power operations; owner shares remain offline. A mobile wallet stakes and votes; it never signs blocks.

This path matters beyond convenience. External operators running `eav7-core` are the only mechanism by which the validator set becomes independent of the founding entity — see Sections 13 and 14.

### 3.3 Node surfaces and peer-to-peer transport

| Surface | Default port | Purpose |
|---|---|---|
| REST API | 6070 | State queries, transaction submission, proofs, administrative endpoints |
| EAVM JSON-RPC | 7070 (API port + 1000) | Ethereum-dialect endpoint for wallets and tooling |
| P2P | Same HTTP listener | Block and transaction gossip, range synchronization |

Peer-to-peer traffic runs over HTTP with a small message set: `POST /tx` for transaction gossip, `POST /blocks` for block gossip, and a paged range query for synchronization. Peer discovery is by mutual registration authenticated with an administrative token; the legitimate topology is seeded through a peer list at startup, and the peer count is capped at `MAX_PEERS` = 64.

Outbound peer URLs pass an anti-SSRF filter that normalizes non-canonical IPv4 forms — decimal, octal, and hexadecimal encodings all resolve to the same address — before classifying them as private or public. Without that normalization, a peer could steer the node into loopback or cloud metadata services. Private-range peers are rejected unless explicitly allowed, which is the intended configuration for local testnets only.

The transport itself is not authenticated or encrypted at the protocol layer. Production deployments are expected to place validators behind a reverse proxy or tunnel and never expose the administrative API. Authenticated P2P is a roadmap item (Section 13.3).

---

## 4. Consensus

### 4.1 DPoS with deterministic slot rotation

Time is divided into slots of `BLOCK_TIME_MS` = 1,000 ms. The slot for an instant is `floor(timestamp / 1000)`, and the expected producer for that slot is

```
validators[ slot mod N ]
```

where `validators` is the ordered active set. There is no lottery, VRF, or auction: given the clock and the validator set, the producer of any slot is a pure, universally computable function.

The active set is derived from state at every block: accounts with `staked ≥ MIN_VALIDATOR_STAKE` (1,000 EAV7), ranked by **weight = self-stake + votes received** in descending order, ties broken by ascending address, truncated at `MAX_VALIDATORS` (51 in the delivery launch profile). The next 50 ranked eligible accounts form the standby bank, so the ranked ecosystem comprises the top 101. Only active Anchors produce blocks and vote; standby accounts are candidates for promotion, not block producers. EAVM-managed accounts are excluded by construction, since they hold no hybrid keypair and therefore cannot sign blocks.

The network may begin with five to seven foundation-operated Anchors and fill toward 51 as independent operators qualify. Every launch Anchor uses a cold owner M-of-N authority and a separate hot witness; the witness signs blocks without acquiring authority over governance, stake, commission, or owner permissions.

### 4.2 Block admission rules

A block is accepted only if it satisfies, in order:

1. Cryptographic integrity — both signatures verify, hash matches the canonical payload.
2. `height == head.height + 1` and `previousHash == head.hash`.
3. `timestamp > head.timestamp`.
4. **One block per slot**: `slot(block) > slot(head)`. This rule eliminates *slot grinding* — producing multiple candidates in the same slot to select the most favourable.
5. `txCount ≤ MAX_TXS_PER_BLOCK` (500).
6. Slot not further in the future than `SLOT_FUTURE_TOLERANCE_MS` (400 ms), and clock drift within `MAX_CLOCK_DRIFT_MS` (2,000 ms).
7. From `STRICT_PRODUCER_HEIGHT`, the producer must be **exactly** the slot's expected producer.
8. From `STATEROOT_HEIGHT`, the recomputed state root must match the one declared in the header.

The state transition is always simulated on a clone before being committed, and the disk write precedes the in-memory mutation.

### 4.3 Fork choice and BFT finality

The base rule is **longest chain**, constrained by two finality floors.

The dynamic floor is derived from the producers already present in the chain: a block is considered **final** once at least `floor(2N/3) + 1` **distinct** validators have produced blocks above it. There is no voting subprotocol, precommit message, or separate consensus round — finality is read from history. Reorganizations attempting to revert a finalized height are rejected.

Finality is disabled when the active set holds fewer than `FINALITY_MIN_VALIDATORS` = 3 validators, since below that threshold a two-thirds quorum offers no meaningful guarantee.

Reorganization depth is additionally bounded by `REORG_WINDOW` = 5,000 blocks.

### 4.4 Storage and recovery

Blocks are persisted to `blocks.jsonl`, an append-only file with one JSON object per line, indexed in memory as `offsets[height] = (byteOffset, length)` — O(1) random access via positioned reads, without materializing the file. A window of recent blocks stays in memory; blocks leaving the window advance a base state by reapplication. The store deals in lines and delegates parsing to the block format, so the storage layer remains correct across block-format changes.

Two failure modes are treated differently on purpose. A torn write on the file's final line — a crash mid-append — is recoverable: the file is truncated at the start of that line and the node starts one block short, resynchronizing from peers. Corruption in the middle of the file is not silently repaired, because doing so would mean starting a node on a history it cannot prove.

Full state snapshots are written every `SNAPSHOT_INTERVAL_BLOCKS` = 5,000 blocks. A loaded snapshot is accepted only if its recomputed state root matches the root committed by the corresponding block. This is a more robust guarantee than sealing the file with an operator key: a well-formed but falsified snapshot fails the root check, whereas a keyed MAC only proves that whoever wrote the file held the key.

---

## 5. Cryptography and the Post-Quantum Model

### 5.1 The `eav7-hybrid-1` scheme

| Component | Primitive | Standard |
|---|---|---|
| Classical signature | ECDSA over secp256k1, SHA-256 digest | SEC 2 / FIPS 186 |
| Post-quantum signature | ML-DSA-44 (Dilithium), no pre-hash | NIST FIPS 204 |
| Hash function | SHA3-256 truncated to 248 bits | NIST FIPS 202 |

Verification is a strict conjunction: **both** signatures must be valid. An object with only one correct signature is rejected exactly as one with no signature at all. Keys travel as PEM (private PKCS#8, public SPKI) and signatures as base64.

An adversary who breaks ECDSA alone **cannot redirect elections or block production** without also forging the PQ signature: the protocol requires both on every consensus object.

The cost of this choice is explicit and accepted: an ML-DSA-44 signature is substantially larger than an ECDSA one. The launch GB model therefore excludes signature fields from metered useful bytes rather than making a transaction's cost depend on the large, variable hybrid signature.

### 5.2 Hash and address format

Every EAV7 hash is 64 characters: the literal prefix `E7` followed by 62 uppercase hexadecimal characters, corresponding to the 248 most significant bits of the SHA3-256 digest. The prefix is a protocol identity marker, not entropy.

Addresses are 34 characters: `E7` + 28 hexadecimal + 4 hexadecimal checksum.

```
body      = SHA3-256( DER(secp256k1_key) ‖ DER(mldsa_key) )[0:14]   → 28 hex
checksum  = SHA3-256( "EAV7-ADDR:" ‖ body )[0:2]                    → 4 hex
address   = "E7" ‖ body ‖ checksum
```

The address derives from **both** concatenated public keys, binding account identity to the complete hybrid pair.

> **Stated limitation.** The address body is 14 bytes = **112 bits**. Birthday collision resistance is therefore on the order of 2⁵⁶ operations — below the 2⁸⁰ threshold considered comfortable today. This is recorded as a residual finding in the project's internal audit, with the observation that changing it invalidates every address already issued. See Section 14.

### 5.3 Domain separation

Purpose-specific digests are separated by a domain prefix and the `\x1f` separator (ASCII unit separator), preventing a signature harvested in one context from being replayed in another:

- `EAV7-BRIDGE-IN` — bridge asset release
- `EAV7-BRIDGE-COMMITTEE` — bridge committee rotation
- `EAV7-AI-ATTEST` — AI result attestation
- `EAV7-ADDR:` — address checksum

---

## 6. Data Structures and State Commitment

### 6.1 Block header

The signed block core contains `protocol`, `version`, `scheme`, `height`, `timestamp`, `previousHash`, `txRoot`, `txCount`, `producer`, `publicKey`, `pqPublicKey`, and — above `STATEROOT_HEIGHT` — `stateRoot`. Excluded from the core: `signature`, `pqSignature`, `hash`, and `transactions`.

Above `CANONICAL_HASH_HEIGHT`, the block hash is computed **over the payload only**, excluding signatures. This makes the identifier immune to ECDSA signature malleability, in which an adversary rewrites `s` as `n − s`, producing an equally valid signature and therefore a different identifier for the same block.

### 6.2 Transactions

A transaction carries `protocol`, `scheme`, `type`, `from`, `to`, `amount`, `fee`, `nonce`, `timestamp`, `data`, both public keys, and both signatures. The identifier derives **exclusively from the canonical signed payload**, never from signature bytes — the same anti-malleability defence applied to blocks.

The `fee` field is a **fee limit** (a ceiling on burn authorized by the sender), not a payment, and is capped at `MAX_FEE_LIMIT` = 100 EAV7. The nonce must be exactly the current value plus one.

The protocol defines **58 transaction types**, covering transfers, staking, voting, permissions and multi-signature, EAV20 tokens, EAV721 NFTs, the name service, governance, treasury, vesting, meta-transactions, the EAVM, the bridge, and the AI layer. The list is closed: a node must reject an unknown type rather than ignore it, because accepting a type it cannot execute diverges the state.

Canonical serialization reproduces the byte-exact JSON form the signer committed to, including string escaping and integer formatting. Floating-point values are deliberately absent from the `data` field: reproducing a JavaScript engine's shortest-round-trip double formatting in another language is a source of one-digit divergences that would change the payload, change the identifier, and make the transaction a different object. Applications that need fractions encode them as strings, which is what the rest of the protocol already does with monetary values.

### 6.3 State model and state root

The model is account-based (not UTXO), with monetary values as 128-bit integers in the smallest unit, called **e7** (1 EAV7 = 10⁶ e7). State is partitioned into domains: accounts, tokens, NFTs, names, contracts, oracles, AI attesters, AI tasks, votes, permissions, delegations, governance proposals, treasury, slashing, unbonding, vesting, commissions, and bridge.

The state root is a **sorted-leaf Merkle tree** — explicitly **not** a Merkle-Patricia Trie:

```
leaf = H( domain ‖ \x1f ‖ key ‖ \x1f ‖ canonical_serialization(value) )
root = merkleRoot( sort(leaves) )
```

This enables **account inclusion proofs** for light clients. The path is implemented end to end: the node serves a proof per account, and `eav7-sdk` verifies it locally against a state root taken from a block header whose integrity the client checked itself. A node can refuse to serve a proof — which is observable — but it cannot forge one.

> **Stated scaling limitation.** The root is recomputed over the **entire** state at every block — O(|state|) per block. An incremental structure (persistent tree, sparse Merkle tree, or copy-on-write state) is acknowledged as necessary work before the chain reaches meaningful state size. See Section 13.

---

## 7. Resource Model and Fees

EAV7 has **no gas market**. There is no gas price, priority auction, or tip to the producer. The model is one of regenerating resources with burn as the overflow mechanism.

### 7.1 GB · Free Signature

The launch model has one daily resource bar, **GB**: `1,000,000,000` weighted bytes per account, plus `1,000,000` weighted bytes for every effective staked EAV7. It regenerates across `86,400` blocks (about 24 hours) and does not accumulate beyond its daily capacity.

```
useful_bytes    = serialized_tx_bytes excluding signature, pqSignature, and id
weighted_bytes  = max(GB_MIN_WEIGHTED, useful_bytes × type_factor)
daily_quota     = 1,000,000,000 + 1,000,000 × effective_staked_EAV7
burn            = max(0, weighted_bytes − remaining_quota) × BURN_PER_BYTE
```

`GB_MIN_WEIGHTED` is `1,024` bytes. `type_factor` reuses the legacy energy-cost table, so more state-intensive transaction types consume proportionately more GB. `BURN_PER_BYTE` is `5 e7`. The `fee` field remains a **burn limit**, not a price: if the calculated shortfall burn exceeds it, the transaction fails.

Both hybrid signature fields are excluded from useful bytes. This **free-signature** rule prevents the large, variable PQ signature from becoming a fee surface and preserves transaction identifier anti-malleability; public keys remain included in useful bytes. An account within quota burns nothing. `DELEGATE_RESOURCE` / `UNDELEGATE_RESOURCE` continue to increase the recipient's effective resource stake and therefore its GB quota without transferring voting power.

The legacy separate energy-and-bandwidth accounting remains valid below `GB_FEE_HEIGHT`. In local and pre-delivery builds that height stays distant; the delivery server sets the launch profile at genesis, where the GB rule applies from height zero. That configuration is not a casual local default and does not mean a mainnet is already live.

### 7.2 Full fee burning

**Every fee collected is burned.** The producing validator receives no share of fees; its revenue is exclusively the block reward. This is a deliberate economic choice with three consequences:

1. **Deflationary pressure proportional to usage.** The more the network is used, the more supply is destroyed.
2. **Elimination of fee-driven censorship incentives.** Since the producer does not profit from the fee, there is no incentive to order or censor transactions based on it.
3. **No tip-based MEV market.** The protocol provides no channel for priority payment to the producer.

Beyond fees, the following are burned: 90% of slashing penalties (10% go to the reporter) and the cost of name registration in EAV-NS.

---

## 8. Staking, Validation, and Governance

### 8.1 Stake and unbonding

Staking moves balance from `balance` to `staked`, which simultaneously grants validator eligibility, voting power, and additional daily GB quota.

`UNSTAKE` removes stake **immediately** — voting power and validator standing are lost at once — but the funds enter an unbonding queue for `UNBONDING_BLOCKS` = 604,800 blocks (**≈ 7 days**), credited back through each block's deterministic processing. An account holds at most `MAX_UNBONDING_ENTRIES` = 32 concurrent entries.

Three guards protect network integrity: it is impossible to unstake below the total voted, below the amount delegated to third parties, or to **empty the validator set** — the last active position cannot be removed.

### 8.2 Voting and voter rewards

EAV7 holders allocate voting power (equal to stake) to candidates, across up to 30 targets per transaction. Self-voting is forbidden, and only already-eligible candidates can receive votes.

The block reward is split in the following order: first the treasury share (`TREASURY_PCT`, **0% by default**, governable up to 50%); then, if the producer has received votes, it retains its commission (20% default, adjustable per validator with a delay of `COMMISSION_DELAY_BLOCKS` = 21,600 blocks) and the remainder is distributed pro rata to voters through a fixed-precision accumulator that makes claiming O(1). If the producer received no votes, it retains the whole.

In the delivery launch profile, voting is active from genesis, so ranking uses self-stake plus votes from the outset. The active set has up to 51 Anchors; the next 50 eligible accounts are the standby bank. The bank does not vote or produce blocks until promoted.

### 8.3 On-chain governance

Only active Anchors may propose and vote. A proposal passes with **`floor(2N/3) + 1`** of the active validators, enters `QUEUED` status, and is applied only after `GOV_TIMELOCK_BLOCKS` (default 40,000 blocks, ~11 h) — giving the community a window to react to an approved change before it takes effect.

At launch, a `GOV_PROPOSE` or `GOV_VOTE` must be authorized by the Anchor account's cold `owner` authority, including its M-of-N multisig threshold where configured. Its hot `witness` key can produce a block or attest, but must not authorize governance. Governance is explicitly neither holder-weighted nor an off-chain council, and no AI has a vote, veto, signing key, or submission authority. An AI advisor may draft a proposal only; an owner-authorized Anchor must adopt and sign it.

Seven parameters are governable within hard bounds encoded in the protocol:

| Parameter | Minimum | Maximum |
|---|---|---|
| `BLOCK_REWARD` | 0 | 1,000 EAV7 |
| `MIN_VALIDATOR_STAKE` | 1 EAV7 | 10,000,000 EAV7 |
| `MAX_VALIDATORS` | 1 | 101 |
| `FEE_EXEMPT_STAKE` | 0 | 1,000,000 EAV7 |
| `MIN_ORACLE_STAKE` | 0 | 1,000,000 EAV7 |
| `TREASURY_PCT` | 0 | 50 |
| `BRIDGE_BREAKER_BPS` | 100 (1%) | 10,000 (100%) |

An **anti-brick rail** automatically reverts any change to `MIN_VALIDATOR_STAKE` or `MAX_VALIDATORS` that would result in an empty validator set, preventing governance from disabling the network through a parameterization error.

### 8.4 Slashing

The protocol implements **double-sign** slashing: two valid blocks, same producer, same height, different hashes. The penalty is 10% of the amount at risk — active stake **plus** funds in unbonding, closing the escape of unstaking after the offence — of which 10% goes to the reporter and 90% is burned. A nullifier keyed on `offender:height` prevents double punishment for the same evidence, and cheap checks precede the two expensive hybrid verifications to avoid DoS amplification.

The delivery launch profile activates double-sign slashing from genesis. It must not be inferred that this configuration has been deployed to mainnet: local and pre-delivery builds retain their guarded fork settings until the delivery server generates the launch genesis.

---

## 9. EAVM — Virtual Machine and Wallet Compatibility

The EAVM is EAV7's virtual machine. It executes EVM bytecode, meters gas, and indexes logs and receipts. The delivery launch profile activates contract deployment, execution, and value-carrying EAVM transactions from genesis.

Precompiles `0x01`–`0x09` are implemented, including `modexp`, the BN254 curve operations (`ecAdd`, `ecMul`, `ecPairing`), and `blake2f`, with gas metering charged before execution so that a hostile input cannot buy computation it has not paid for. Gas is bounded at `MAX_EAVM_GAS` = 5,190,000 per transaction; contract size is capped at 24,576 bytes (EIP-170) and calldata at 3,072 bytes.

The EAVM exposes a JSON-RPC endpoint speaking the dialect Ethereum-ecosystem wallets understand. Chain ID **72020** on mainnet, **72021** on the public testnet. Since wallets assume 18 decimals and the protocol uses 6, conversion applies the factor `EAVM_WEI_PER_E7` = 10¹²; values not divisible by 10¹² are rejected.

A `0x` address maps deterministically to an E7 address. Additionally, the protocol accepts an E7 destination **encoded inside the 20-byte field** of an EVM transaction, using the prefix `0xe7000000` followed by the 32 hexadecimal characters of the E7 body and checksum — allowing an ordinary wallet to send to a native address with on-chain checksum validation.

### 9.1 Compatibility — precise statement

| Method | Status |
|---|---|
| `eth_chainId`, `net_version`, `net_listening`, `web3_clientVersion`, `eth_syncing` | Implemented |
| `eth_blockNumber`, `eth_getBalance`, `eth_getTransactionCount`, `eth_accounts` | Implemented |
| `eth_sendRawTransaction` | Implemented — decodes RLP/secp256k1 and re-derives the canonical native transaction |
| `eth_getTransactionByHash`, `eth_getTransactionReceipt` | Implemented, with real status, gas used, and logs from the node's receipt index |
| `eth_getBlockByNumber`, `eth_getBlockByHash` | Implemented |
| `eth_call`, `eth_estimateGas` | Implemented — execute against a cloned state outside any exclusive lock |
| `eth_getCode` | Implemented |
| `eth_getLogs` | Implemented, bounded by `MAX_LOG_RANGE` = 5,000 blocks and `MAX_LOG_RESULTS` = 10,000 entries per query |
| `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory` | Implemented (derived values; there is no fee market) |
| `eth_getStorageAt`, `eth_getProof`, `eth_subscribe`, filter methods | **Not implemented** |

**Practical consequence.** Wallets add the network, display balances, send transfers, and interact with deployed contracts. Client libraries can read contract state and query historical events. What remains missing is raw storage access, EIP-1186 proofs, and subscription or filter-based streaming, so tooling that depends on `eth_subscribe` or on installing filters must poll `eth_getLogs` instead. Native `EAVM_DEPLOY` and `EAVM_CALL` transactions remain available and are the path used by the protocol's own tooling.

The range and result caps on `eth_getLogs` are deliberate: an unbounded query would scan the chain on every call, which is the classic denial-of-service vector against this method.

### 9.2 EAV20 token standard

**EAV20 is an ERC-20-compatible Solidity contract on the EAVM.** The official contracts are immutable and are deployed through `EAV20Factory`, although ordinary EAVM deployment remains permissionless. `EAV20` is the minimal contract for permissionless tokens; `EAV20Managed` adds explicit administrator functions such as minting, burning, pause, blacklist, and permit for use cases that require them. The two forms are named separately so that managed controls are never hidden behind a generic EAV20 label.

The native `TOKEN_*` transactions remain a legacy protocol path. They are not the EAV20 product path and must not be presented as the way to create an EAV20 token.

---

## 10. Native Artificial Intelligence Layer

### 10.1 The line that is not crossed

Before describing what AI does in EAV7, it is necessary to establish what it cannot do, because this is the project's central security property.

EAV7 contains two disjoint sets of components that the word "AI" could conflate:

**(A) The AI oracle protocol** — pure consensus. Transaction types, escrow, reputation, quorum, challenge, attestation. This is deterministic consensus state, replicated and verifiable by any node. No language model participates in validation: what the chain verifies are signatures and hash agreement.

**(B) The operational AI layer** — zero consensus power. Security sentinel, governance advisor, validator scoring, gateway read routing, and abusive-IP blocking.

The doctrine applied to (B) is explicit and uniform: **AI acts on its own only where the action is operational and reversible; in anything touching consensus, validators, stake, treasury, or code, it only proposes.**

| Component | Autonomy | Maximum effect |
|---|---|---|
| Governance advisor | Propose-only | Drafts a proposal — no sender, no nonce, no signature |
| Validator scoring | Propose-only | Publishes performance metrics; never removes a validator or touches stake |
| Security sentinel | Alert-only | Publishes severity-classified alerts |
| Gateway (read routing) | Autonomous, non-consensual | Serves **reads** from a healthier peer; writes stay local |
| Abuse guard | Autonomous, non-consensual | Blocks an IP for a TTL with automatic expiry; never affects transaction validity |

There is no code path by which any AI component signs or submits a transaction. A draft produced by the advisor must be adopted by a human Anchor, authorized by its owner or owner multisig, submitted, approved by two-thirds plus one of governance, and still clear the timelock.

### 10.2 The oracle protocol

The base flow: `ORACLE_REGISTER` (oracle registers an endpoint and locks stake ≥ 500 EAV7) → `AI_TASK` (requester escrows the reward) → `AI_RESULT` (oracle delivers) → settlement. Each oracle's reputation starts at 50 and evolves on-chain: **+4** for successful delivery, **−12** for an overturned result or non-delivery, **−8** for committing without revealing, **+2/−4** for jurors voting with or against the majority.

On the delivery launch profile, the five base guarantee mechanisms are active from genesis. TEE/ZK attestation remains separately gated:

**Accountability.** Failing to deliver within the deadline, the oracle is penalized 10 EAV7 taken from its locked stake and credited to the requester as compensation, in addition to a full refund of the reward.

**Commit-reveal quorum.** A task may require N independent oracles (2 to 21). Each first publishes `H(output ‖ salt)` within a 30-minute commit window, and only afterwards reveals. This prevents an oracle from copying another's answer. When the quorum of agreeing reveals is reached, the reward is split among those in agreement; the dissenting minority loses reputation.

**Optimistic verification with a jury.** A single-oracle result enters a 30-minute challenge window. Absent a challenge, anyone may trigger settlement. If challenged — against a 20 EAV7 bond — a jury of registered oracles votes, with interested parties explicitly excluded. Upon reaching 3 jurors, a simple majority decides: upheld, the oracle takes the reward **plus** the challenger's bond; overturned, the requester is refunded, the oracle is penalized, and the challenger recovers the bond plus a bounty.

**Reverse auction.** A task may be opened with a budget. Oracles bid on price; the requester awards; budget surplus is returned. An open, unawarded task is refundable after expiry.

**Private, verifiable results.** The oracle may publish only the `resultHash` and, optionally, a URI, keeping the output off-chain — encrypted to the requester in private tasks. Verification is `H(output) == resultHash`. The prompt and input parameters are erased from state after delivery, containing state growth.

### 10.3 Trusted-environment attestation

The most robust acceptance mechanism dispenses with both reputation and challenge window. Governance registers an **attester** — a set of public keys with a quorum and a *measurement* identifying the attested code. A result accompanied by sufficient signatures from that set over the digest

```
keccak256( "EAV7-AI-ATTEST" ‖ \x1f ‖ taskId ‖ \x1f ‖ resultHash ‖ \x1f ‖ attesterId ‖ \x1f ‖ measurement )
```

settles **immediately** and is marked on-chain as verified. The measurement used in the digest is always the one **registered on-chain**, never the one supplied by the sender — this is what binds the signature to the attested code identity. Signature counting deduplicates by recovered address and caps curve recoveries at the set's size, preventing both malleability-driven inflation and cryptographic denial of service.

> **Precise statement of the trust model.** EAV7 verifies on-chain **only secp256k1 signatures from a set previously registered by governance**. The protocol contains no SGX, SEV-SNP, TDX, or Nitro code, and no DCAP quote parsing. Remote enclave attestation is verified **off-chain, once, at registration time**, by the operator and by the validators approving the governance proposal. From the chain's perspective, the measurement is an opaque string.
>
> For the same reason, the `ZK` attester kind is accepted and verified **identically** to the `TEE` kind — by signature from a registered verifier. **The AI layer does not verify SNARK proofs natively.** The EAVM does expose the BN254 pairing precompiles, so a verifier deployed as a contract is technically possible; wiring that path into task settlement is future work, not a present capability.

---

## 11. Cross-Chain Bridge

### 11.1 Mechanism

The bridge operates by lock-and-release. `BRIDGE_OUT` locks the native asset or token on the origin chain, recording the destination. `BRIDGE_IN` releases on the destination chain against proof.

Release authority evolves across three eras, each activated by height:

| Era | Release authority |
|---|---|
| Initial | One authorized relayer |
| Federated (`BRIDGE_QUORUM_HEIGHT`) | Majority of authorized relayers |
| **Committee-attested** (`BRIDGE_PROOF_HEIGHT`) | **Quorum of origin-chain committee signatures over the event digest** |

In the final model, relayer authorization persists **only as anti-spam control** — it is no longer the minting authority. The digest binds every field of the event:

```
keccak256( "EAV7-BRIDGE-IN" ‖ \x1f ‖ CHAIN ‖ \x1f ‖ sourceTxHash ‖ \x1f ‖ destination ‖ \x1f ‖ amount ‖ \x1f ‖ token )
```

A signature harvested to release 5 EAV7 cannot release 500: the amount is in the digest.

Replay protection separates the replay key (`CHAIN:txHash`) from the attestation key (which includes destination, amount, and token). This separation has an important consequence: a malicious relayer attesting incorrect values forms its own group that never reaches quorum, **without blocking** the honest quorum on the correct value.

### 11.2 Committee rotation and the anti-capture rail

The origin-chain committee rotates by signed handoff: the **current** committee signs the transition to the new set and epoch, and the signatures must meet the **prevailing** quorum.

One security property deserves emphasis: EAV7 governance **cannot replace an active committee**. A governance proposal can only *create* a committee when none exists for that chain (bootstrap). The reason is direct — without this rail, two-thirds of EAV7's validators could swap the committee for keys of their own and drain the bridge. Replacing an operating committee requires the handoff signed by the origin.

### 11.3 Rate circuit breaker

A deterministic rate limit complements the model: the sum of releases of a given asset within a sliding window of 3,600 blocks (~1 h) may not exceed a fraction of the pool measured at window start — default **30%**, governable between 1% and 100%. Exceeded, the release is **rejected** (fail-closed). Each token holds an independent budget.

The purpose is to convert a total-drain scenario — compromised committee or relayer — into a slow, observable leak, buying time for human reaction. A public bridge with economic value requires the breaker to be active at genesis, a committee of at least three members, a real chain adapter, and operational confirmation and pause procedures. Until those conditions are met, the bridge is gated or off in the user interface.

### 11.4 Honest statement of the trust model

**The bridge is not a light client.** An internal specification for a bridge with header relay, Merkle inclusion proofs, and minimum confirmation depth exists, but is marked proposed, not implemented. What was built has the committee signing the **event digest directly**, with no header, no Merkle proof, and no confirmation-depth check. The correct designation is **committee-attested bridge**, not trustless bridge.

**Trust was relocated, not eliminated.** It moved from the relayer set to the origin-chain committee's key set, which is a real and substantial improvement. But a committee compromised at quorum can still mint, limited only by the circuit breaker.

**The bridge is not a launch claim by default.** The protocol defines an adapter interface and is chain-agnostic by construction. A real adapter, a constituted committee, an active breaker, and the operational checklist are required before it can custody value; a loopback adapter is only a test component. A light client remains roadmap work.

---

## 12. Tokenomics

### 12.1 Fundamental parameters

| Parameter | Value |
|---|---|
| Symbol | EAV7 |
| Decimals | 6 (smallest unit: **e7**; 1 EAV7 = 10⁶ e7) |
| Genesis supply | **100,000,000,000 EAV7** |
| Block reward | 16 EAV7 |
| Block time | 1 second |
| Halving | every 126,144,000 blocks (**≈ 4 years**) |
| First-year issuance | 504,576,000 EAV7 (**0.50%** of genesis) |
| Total issuance to exhaustion | 4,036,608,000 EAV7 (**≈ 4.04%** of genesis) |
| Theoretical supply ceiling | ≈ 104,036,608,000 EAV7, **before burns** |
| Fee destination | **100% burned** |

Issuance decreases geometrically and converges to zero after 64 halvings. Since every fee is burned, circulating supply is `genesis + issued − burned`, and under sufficient transaction volume burning exceeds issuance, making the network net deflationary.

### 12.2 Genesis distribution

Genesis distribution prioritizes the open market: the public share is **45%**, with Foundation/Treasury at **30.25%**, private sale at **14.75%**, and strategic partner at **10%**.

| Bucket | **EAV7** | Tokens | Launch destination |
|---|---|---|---|
| **Public distribution** | **45.00%** | 45,000,000,000 | `PublicVault` — liquid at TGE / LBP |
| **Foundation / Treasury** | **30.25%** | 30,250,000,000 | Protocol vesting + Anchor stakes |
| **Private sale** | **14.75%** | 14,750,000,000 | `SaleVault` — 12m cliff + 24m linear |
| **Strategic partner** | **10.00%** | 10,000,000,000 | `PartnerTrancheVault` — four private tranches |
| **Total** | **100.00%** | **100,000,000,000** | — |

The insider-controlled share (Foundation, private sale, and partner) totals **55.00%**.

#### Custody and delivery (launch profile)

Buckets do **not** mint into a single operational wallet. The delivery genesis fragment materializes:

| Bucket | On-chain custody | Release |
|---|---|---|
| Public (45%) | `PublicVault` | Buyers receive **liquid** EAV7 via relayer `grant` after rail payment; after the window, `finalizeToLp` moves remaining balance (+ LP reserve) to `TimelockLpSeeder` |
| Private (14.75%) | `SaleVault` | Relayer confirms payment and creates on-contract vesting; the buyer calls `release`. Grants are capped by `saleAllocated`, vesting defaults freeze after `openSale`, and public HTTP manual confirm is **disabled** (ops token / payment watcher only) |
| Foundation (30.25%) | Protocol vesting + stakes | **Seven** launch Anchors each receive `GENESIS_STAKE` = **10,000 EAV7** staked (debited from this bucket). The remainder (**30,249,930,000 EAV7** with seven Anchors) vests to the foundation treasury (`E7F2906EA4B2CD23D20180C8E813F2D126` in the published operational profile): 12-month cliff + 48-month linear |
| Partner (10%) | `PartnerTrancheVault` | Four equal **2.5B** EAV7 tranches. Only the **owner** (unlocked native wallet) may call `releaseTo(address)`. **12-month** cooldown between releases. The owner **cannot** be the recipient (anti self-deal); neither can the vault itself |

Private-sale product pricing uses USD-raised tiers (e.g. Launch $0.005 → … → Last call $0.015), with the price **locked at intent creation**. Tier scarcity counts only `paid`/`granted` intents (`pending` does not move the ladder).

**On-contract vesting.** After the cliff, release is linear over `(duration − cliff)`, not a lump sum at the cliff instant. The same rule applies to `SaleVault` grants and related on-contract schedules.

**Bridge at genesis.** `bridgeRelayers` starts **empty**. Launch Anchors are **not** the bridge committee on day one; the committee is enabled later through governance once adapter, quorum, and breaker readiness are met.

**On the legacy generator.** Local builds may still use a generator that concentrates supply in one wallet for development. The **delivery** path uses the bucket fragment (`alocacoes_buckets_whitepaper` / `genesis-buckets.mjs`) described above. Materializing that fragment on the delivery server remains a production prerequisite. See Section 13.

**On vesting.** Every non-public bucket carries a minimum 12-month cliff (or an equivalent 12-month tranche cooldown for the partner vault).

### 12.3 Treasury

The protocol supports directing a fraction of the block reward to the on-chain treasury, but the parameter starts at **0%**. Enabling it requires a governance proposal approved by two-thirds plus one of validators and subject to timelock, with a hard-coded ceiling of 50%. Treasury spending likewise occurs through governance.

---

## 13. Maturity Status

This section exists so that no reader must infer what is ready. The classification is conservative by choice, and it is stated as of August 2026.

### 13.1 Present posture

EAV7 is **pre-mainnet**. The Rust client is the production client: the consensus library, the full node, and the `eav7-core` operator binary build and run on Linux, macOS, and Windows, with tagged releases publishing archives and SHA-256 digests for Linux x64, Linux arm64, macOS arm64, and Windows x64. Continuous integration runs on GitHub Actions over the workspace, and conformance fixtures in `vectors/` pin canonical serialization, cryptography, state leaves, state roots, and EAVM behaviour.

The source is held in a private repository (`eav7-sys/eav7`) under the MIT licence. The public explorer deployment may be offline pending redeployment; explorer availability is an operational property and has no bearing on consensus.

**Test coverage.** Approximately 1,000 test functions across 68 files in the Rust workspace, including determinism-by-replay of a multi-validator chain and conformance against the frozen vectors.

### 13.2 Implemented for the launch profile

The codebase implements DPoS deterministic rotation and one production per slot · BFT finality as a reorganization floor · `eav7-hybrid-1` signatures on wallets, transactions, and blocks · malleability-immune block and transaction identifiers · state roots and account inclusion proofs · GB · Free Signature accounting with delegation · staking and unbonding · 51 active validator seats plus a 50-account standby bank · per-account permissions and multisig · owner-authorized Anchor governance with timelock and anti-brick rail · treasury · vesting-capable genesis · meta-transactions · EAVM execution, precompiles `0x01`–`0x09`, receipts, and logs · the EAV20/EAV20Managed/EAV20Factory contracts · launch contracts `SaleVault`, `PublicVault`, `PartnerTrancheVault`, and `TimelockLpSeeder` · genesis bucket fragment (§12.2) · the base AI oracle phases · bridge committee and breaker primitives · resilient block storage · and `eav7-core` operator modes, including `ancora-init`.

This is an implementation and delivery-profile statement, **not** a claim that a mainnet is live. The repository's local/pre-delivery configuration retains distant fork heights for safety. The delivery server, after the launch prerequisites are complete, generates the dedicated launch genesis (buckets + seven Anchors + foundation vesting) and sets the closed launch rules at height zero. `GENESIS_ACTIVE` and zeroed heights must not be treated as a casual local development default.

### 13.3 Delivery gates and roadmap

The following items remain gated or roadmap rather than assumptions of a live public network:

| Feature | Status and activation condition |
|---|---|
| **TEE/ZK attestation of AI results** | Gated until an actual attester is registered through Anchor governance; on-chain verification remains registered-signature verification, not native enclave or SNARK verification. |
| **Bridge with economic value** | Gated or off until a real adapter, committee of at least three members, an active fail-closed breaker, confirmation policy, pause process, and end-to-end testing are in place. It remains committee-attested, not trustless. |
| **Skip/miss and downtime rules** | Future consensus upgrade. Strict scheduled production, state roots, and double-sign slashing are launch rules; skip/miss do not block launch. |
| **Hybrid epoch certificates** | Phase 2 for light-client and bridge consumers; not required to start the chain. |

Fork heights are consensus data. The delivery build verifies its genesis mode against its runtime environment and refuses a mismatch, converting a silent divergence risk into a loud startup failure.

### 13.4 Decentralization posture at launch

The validator set at launch will be **small and foundation-operated**, targeted at **seven Anchors** (accepted range: five to seven), each with `GENESIS_STAKE` debited from the Foundation bucket, until external operators stake and are elected toward the 51 active seats. This is a present fact, not a criticism of the design: deterministic rotation, voting, the 50-account standby bank, and operator tooling exist, but stake distribution is what makes them meaningful, and stake distribution has not happened yet. Launch Anchors are **not** seeded as `bridgeRelayers`.

The path out is explicit and measurable. The project's internal targets include at least ten externally operated listener Cores, at least fifteen independently staked candidates in the top 101, and a majority of the active set controlled outside the founding operator group. The active-set ceiling is 51 at launch; raising it toward the governable ceiling of 101 requires a substantially filled, independently operated set and measured PQ finality performance.

### 13.5 Roadmap — not implemented

- **Incremental state root.** Current cost is O(|state|) per block. Replacing it with a persistent tree, sparse Merkle tree, or copy-on-write state is a prerequisite for meaningful state scale.
- **Remaining JSON-RPC surface.** `eth_getStorageAt`, `eth_getProof`, `eth_subscribe`, and filter methods.
- **Bridge chain adapters.** No production adapter exists; the first specified target is an external chain with a signed validator committee (typically an EVM L1).
- **Light-client bridge.** Header relay, Merkle inclusion proofs, and minimum confirmation depth.
- **Native SNARK verification in the AI layer.** The EAVM precompiles make a verifier contract feasible; the settlement path does not use one.
- **Authenticated P2P.** The current transport is plain HTTP behind operator-managed proxies.
- **Block format compaction.** Base64/PEM key material in every block is expensive on disk for operators; a binary format with public-key references is a planned fork.
- **Public seed infrastructure.** Stable DNS seeds and verifiable bootstrap snapshots, so a new operator does not synchronize from genesis.
- **Mobile voter wallet.** Staking and voting from a phone; block production stays on the Core.
- **EAV721 and EAV-NS as launch products.** They are outside the default launch scope unless their product and explorer paths are completed; they are not part of the EAV20 launch claim.
- **Independent external audit.** See Section 14.

---

## 14. Risk Factors

The risks below are material and should be read by anyone considering acquiring, custodying, or building on EAV7.

### 14.1 Regulatory risk — the most significant item in this document

**The public distribution described in Section 12.2 is a sale of tokens to the public.** An offering of this nature has a high probability of being characterized as a public offering of securities under Brazilian law, subject to the jurisdiction of the Comissão de Valores Mobiliários, and under United States law by the Howey test. This is not a remote hypothesis: the United States Securities and Exchange Commission has filed suits against token issuers involving, among other allegations, unregistered offers and sales.

Potential consequences include prior registration requirements, restrictions on eligible jurisdictions, identity and source-of-funds verification obligations, personal liability for officers, and voidance of offerings made.

**Nothing in this whitepaper substitutes for specialized legal advice, which must be obtained before any fundraising.**

### 14.2 Centralization risk at launch

The network starts with a small, foundation-operated validator set — typically three to seven nodes (Section 13.4). At N = 3, the BFT finality quorum is 3, meaning finality depends on every operator participating and the unavailability of a single one degrades the network. A set this small offers no meaningful resistance to collusion, coercion, or correlated infrastructure failure, and the entity operating it can in practice determine block production.

**EAV7 is not a decentralized network today.** Progressive decentralization is a stated objective with defined success criteria, but it is an objective, not a present state, and readers should treat governance outcomes on the early network as decisions of the founding operator.

Slashing is height-gated (Section 13.3), so double-signing by a validator will not be economically punished until the mechanism is hardened and activated.

### 14.3 Bridge risk

The bridge must not custody economically meaningful value until a real adapter is operating, an origin committee of at least three members is constituted, the rate breaker is active, and the required confirmation and pause procedures have been tested. A single relayer or loopback setup is only suitable for demos and test environments.

### 14.4 Cryptographic and structural risks

**112-bit address space.** The address body is 14 bytes, offering birthday collision resistance on the order of 2⁵⁶ operations — below the 2⁸⁰ threshold considered comfortable today. Correcting it would invalidate every address already issued.

**Merkle tree construction.** The transaction tree duplicates the last node when the leaf count is odd and applies no domain separation between leaf and internal node. This construction is known to allow, in certain protocols, distinct transaction sets to produce identical roots. The impact on EAV7 is limited by the fact that the transaction identifier derives from the signed payload, but the construction is not the most robust available.

**ML-DSA is a recent standard.** ML-DSA was standardized in 2024 and has substantially less public cryptanalysis history than ECDSA. The hybrid choice exists precisely so that a flaw in either scheme is not fatal, but that is a mitigation, not a guarantee.

### 14.5 Audit risk

The protocol underwent multiple rounds of adversarial review conducted internally with language-model assistance, which identified and led to the correction of significant vulnerabilities — including consensus slot manipulation, bridge drain, AI-layer escrow theft, block hash malleability, server-side request forgery through non-canonical peer addresses, and denial of service through unmetered precompiles and unbounded log queries. Fixes are covered by regression tests.

**No external, independent audit firm has reviewed this code.** Internal review, however rigorous, does not substitute for independent adversarial assessment, and this is a material risk for any value custodied on the network.

### 14.6 Operational and scaling risks

State root recomputation is O(|state|) per block. As state grows, per-block cost grows proportionally, and there exists a point at which one-second production ceases to be sustainable. That limit has not been empirically characterized.

The P2P transport is unauthenticated HTTP and depends on operator-managed proxies or tunnels for confidentiality and access control. An operator who exposes the administrative API without a robust admin token exposes the node.

The operational AI layer depends on external services when configured to do so; unavailability of those services degrades monitoring, never consensus.

---

## 15. Legal Disclaimer

This document is provided solely for informational and technical purposes. It does not constitute, and must not be construed as, an offer to sell, a solicitation of an offer to buy, investment advice, legal, tax, accounting, or financial advice, nor a prospectus or offering document under any legislation.

**Forward-looking statements.** This whitepaper contains statements regarding plans, roadmap, future functionality, and intended outcomes. Such statements reflect expectations as of the publication date and involve known and unknown risks and uncertainties. Actual results may differ materially. No obligation to update is assumed.

**No warranties.** The software is provided "as is", without warranty of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, availability, security, or absence of defects. No independent external audit has been performed on the code described.

**Risk of total loss.** Digital assets are high-risk and highly volatile. The value of EAV7 may fall to zero. Software failures, vulnerability exploitation, loss of private keys, regulatory action, or project discontinuation may result in total and irreversible loss. Do not acquire EAV7 with funds whose complete loss would compromise your financial situation.

**Jurisdictional restrictions.** Acquiring or holding digital assets is restricted or prohibited in certain jurisdictions. It is the reader's sole responsibility to verify the legality of their participation under applicable law.

---

## Appendix A — Consensus Parameters

Values are those declared in `rust/src/config.rs`, the canonical source of consensus parameters.

### A.1 Protocol and consensus

| Parameter | Value |
|---|---|
| Protocol / version | `eav20` / 1 |
| Signature scheme | `eav7-hybrid-1` (secp256k1 + ML-DSA-44) |
| Hash function | SHA3-256 truncated to 248 bits, prefix `E7` |
| Hash / address length | 64 / 34 characters |
| Block time | 1,000 ms |
| Max transactions per block | 500 |
| Max clock drift | 2,000 ms |
| Future slot tolerance | 400 ms |
| Reorganization window | 5,000 blocks |
| Snapshot interval | 5,000 blocks |
| Active validators | 51 at launch (governable, ceiling 101) |
| Standby bank | Next 50 eligible accounts; top 101 ranked in total |
| Minimum validator stake | 1,000 EAV7 (governable) |
| Minimum validators for finality | 3 |
| Unbonding period | 604,800 blocks (≈ 7 days) |
| Max unbonding entries per account | 32 |
| Slashing percentage | 10% of amount at risk |
| Reporter bounty | 10% of the penalty |
| Default validator commission | 20% |
| Commission change delay | 21,600 blocks |
| Treasury percentage | 0% (governable, ceiling 50%) |
| Block reward | 16 EAV7 (governable, ceiling 1,000) |
| Halving interval | 126,144,000 blocks (≈ 4 years) |
| Genesis supply | 100,000,000,000 EAV7 |
| Genesis stake per validator | 10,000 EAV7 |
| Governance quorum | ⌊2N/3⌋ + 1 active validators |
| Governance timelock | 40,000 blocks (≈ 11 h) |
| Max vote targets per transaction | 30 |
| Max fee limit | 100 EAV7 |
| Transaction types | 58 |

### A.2 Execution, resources, and networking

| Parameter | Value |
|---|---|
| GB daily base quota | 1,000,000,000 weighted bytes |
| GB per effective staked EAV7 | +1,000,000 weighted bytes |
| GB minimum weighted transaction | 1,024 bytes |
| GB weighting | Useful transaction bytes × legacy type factor; signatures and ID excluded |
| GB shortfall burn | 5 e7 per weighted byte |
| GB regeneration window | 86,400 blocks (≈ 24 h) |
| EAVM Chain ID | 72020 (mainnet) · 72021 (testnet) |
| EAVM conversion | 10¹² wei per e7 |
| Max EAVM gas per transaction | 5,190,000 |
| Gas per energy unit | 100 |
| Max contract size | 24,576 bytes (EIP-170) |
| Max EAVM calldata | 3,072 bytes |
| `eth_getLogs` range / result caps | 5,000 blocks / 10,000 entries |
| Max transaction `data` | 65,536 bytes |
| Mempool capacity / TTL | 5,000 transactions / 6 h |
| Max future nonce gap | 64 |
| Max peers | 64 |
| API rate limit | 240 requests per 10 s |

### A.3 AI layer and bridge

| Parameter | Value |
|---|---|
| Minimum oracle stake | 500 EAV7 |
| Oracle penalty | 10 EAV7 |
| Challenge bond | 20 EAV7 |
| Jury quorum | 3 jurors |
| Oracle quorum range | 2 to 21 |
| Commit / reveal / challenge / verdict windows | 30 minutes each |
| Task timeout | 1 hour |
| Max AI prompt / output / URI | 8,192 B / 32,768 B / 512 B |
| Max attester members | 32 |
| Bridge breaker window | 3,600 blocks (≈ 1 h) |
| Bridge breaker cap | 30% of pool (governable, 1%–100%) |
| Bridge minimum attestations | 1 |

### A.4 Delivery launch heights

These are the intended delivery-server genesis settings, not a claim that they are active on a mainnet or a direction to change ordinary local builds. `GENESIS_ACTIVE` and the height-zero profile are applied only when the dedicated delivery server creates the launch genesis after the relevant prerequisites and tests are complete.

| Height | Fork |
|---|---|
| 0 | `STRICT_PRODUCER_HEIGHT` · `STATEROOT_HEIGHT` · `SLASHING_HEIGHT` |
| 0 | `VOTING_HEIGHT` · `PERMISSIONS_V2_HEIGHT` · `GOVERNANCE_HEIGHT` |
| 0 | `GB_FEE_HEIGHT` — GB · Free Signature replaces legacy energy/bandwidth |
| 0 | `EAVM_CONTRACTS_HEIGHT` · `EAVM_VALUE_HEIGHT` · `EAVM_OSAKA_HEIGHT` |
| 0, if the AI oracle is a launch product | `AI_ACCOUNTABILITY_HEIGHT` · `AI_QUORUM_HEIGHT` · `AI_CHALLENGE_HEIGHT` · `AI_MARKET_HEIGHT` · `AI_PRIVATE_HEIGHT` |
| 0, only if the bridge checklist is complete | `BRIDGE_PROOF_HEIGHT` · `BRIDGE_BREAKER_HEIGHT`; otherwise bridge remains gated/off |
| Distant until attester readiness | `AI_TEE_HEIGHT` |

---

*EAV7 · Technical Whitepaper v1.0 · August 11, 2026*
