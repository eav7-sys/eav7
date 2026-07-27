# EAV7 — A Layer 1 Blockchain with Post-Quantum Security and a Native Artificial Intelligence Layer

**Technical Whitepaper · Version 1.0 · July 19, 2026**

Protocol `eav20` · Symbol `EAV7` · EAVM Chain ID `72020`

---

> **Preliminary notice.** This document describes a protocol at pre-launch stage. Section 13 (Maturity Status) explicitly separates what is implemented and tested, what is implemented but inactive, and what is roadmap. Section 14 (Risk Factors) and Section 15 (Legal Disclaimer) are integral parts of this document and must not be read in isolation. Nothing in this whitepaper constitutes an offer, investment recommendation, or guarantee of outcome.

---

## Contents

1. [Executive Summary](#1-executive-summary)
2. [Motivation and Positioning](#2-motivation-and-positioning)
3. [Architecture Overview](#3-architecture-overview)
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

EAV7 is a layer 1 blockchain built from scratch in pure JavaScript with zero external dependencies, combining three design decisions that are unusual when taken together:

**Mandatory hybrid post-quantum signatures.** Every wallet, transaction, and block carries **two** independent signatures — ECDSA over secp256k1 and ML-DSA-44 (NIST FIPS 204) — and both must verify for the object to be accepted. This is not an optional mode or a future migration: it is the only scheme the protocol knows, named `eav7-hybrid-1`. An adversary with a cryptographically relevant quantum computer who breaks the elliptic curve still faces the lattice; an adversary who finds a structural flaw in ML-DSA still faces the curve.

**AI as a consensus primitive, not as a narrative.** EAV7 defines native transaction types to commission, deliver, dispute, and settle artificial intelligence work, with on-chain escrow, oracle reputation, commit-reveal quorum, an optimistic challenge window with jury adjudication, reverse auctions for oracle selection, and immediate settlement upon cryptographic attestation. Equally important is what AI **cannot** do: no AI component in EAV7 holds binding power over consensus, the validator set, stake, or code. That boundary is architectural and verifiable in the source.

**Deflationary economics with minimal issuance.** One hundred billion EAV7 at genesis, one-second blocks, 16 EAV7 per block with halving roughly every four years. First-year issuance equals **0.50%** of the genesis supply, and total issuance across all halvings sums to 4,036,608,000 EAV7 — approximately 4.04% additional. Against this, **100% of transaction fees are burned**: they do not go to the validator, and they do not go to the treasury. Under meaningful usage, the network is structurally deflationary.

On this foundation EAV7 delivers the feature set expected of a mature L1: DPoS with BFT finality, validator voting with voter rewards, per-account multi-signature permissions, an energy/bandwidth resource model with delegation, on-chain governance with timelock, vesting, gasless meta-transactions, EAV20 and EAV721 token standards, a name service, and a proprietary virtual machine (EAVM) that speaks the JSON-RPC dialect understood by Ethereum-ecosystem wallets.

---

## 2. Motivation and Positioning

### 2.1 The harvest-now problem

The quantum threat to elliptic-curve cryptography is not symmetric in time. An adversary can capture a blockchain's public traffic and history today and decrypt it years later, once the hardware exists — the strategy known as *harvest now, decrypt later*. For a blockchain this is particularly severe: public keys are permanently exposed in the history the moment an account transacts, and the record is immutable and public by construction.

NIST standardized ML-DSA in August 2024 (FIPS 204). Most existing networks have responded by deferring: migrating a signature scheme on a chain carrying significant economic value is among the riskiest operations there is, because it requires coordinating an entire ecosystem of wallets, exchanges, and contracts. EAV7 starts from the premise that **being born hybrid is vastly cheaper than migrating later**, and accepts the cost — larger signatures, more expensive verification — as the price of entry.

### 2.2 Why a native AI layer

AI inference services are consumed today through centralized APIs, with three properties that are poor fits for on-chain applications: the result is not verifiable, payment is not atomic with delivery, and the provider has nothing at stake if it lies or fails to deliver.

EAV7 treats inference as an oracle market with explicit economic guarantees. A requester escrows the reward at task creation. The oracle has stake at risk. Delivery can be validated by agreement among multiple independent oracles (commit-reveal), by absence of challenge within a window (optimistic verification with a bonded jury), or by signature from a registered attester — and in the last case it settles immediately, without relying on reputation.

### 2.3 Design lineage: TRON

EAV7's economic and resource model is avowedly TRON-inspired: identical genesis supply (100 billion), an energy + bandwidth resource model instead of a gas market, DPoS with deterministic rotation, analogous token standards. EAV7 diverges deliberately in several respects: one-second blocks (against TRON's three), 27 validator slots, hybrid post-quantum signatures, a native AI layer, and **full fee burning**.

---

## 3. Architecture Overview

EAV7 is a monolithic Node.js (≥ 20) node with **zero external runtime dependencies** — all consensus cryptography comes from `node:crypto`, and the keccak-256, RLP, secp256k1, and RIPEMD-160 used by the EAVM are implemented from scratch in the repository. The protocol core is approximately 9,100 lines of JavaScript.

A node exposes three surfaces:

| Surface | Default port | Purpose |
|---|---|---|
| REST API | 6070 | State queries, transaction submission, administrative endpoints |
| EAVM JSON-RPC | 7070 | Dialect compatible with Ethereum-ecosystem wallets |
| P2P | HTTP | Block and transaction gossip, synchronization |

P2P runs over plain HTTP with only three messages: `POST /tx` (transaction gossip), `POST /blocks` (block gossip), and `GET /chain?from=&limit=` (range synchronization). Peer discovery is by mutual registration authenticated with an administrative token; the legitimate topology is seeded via `--peers`.

---

## 4. Consensus

### 4.1 DPoS with deterministic slot rotation

Time is divided into slots of `BLOCK_TIME_MS` = 1,000 ms. The slot for an instant is `floor(timestamp / 1000)`, and the expected producer for that slot is

```
validators[ slot mod N ]
```

where `validators` is the ordered active set. There is no lottery, VRF, or auction: given the clock and the validator set, the producer of any slot is a pure, universally computable function.

The active set is derived from state at every block: accounts with `staked ≥ MIN_VALIDATOR_STAKE` (1,000 EAV7), ranked by **weight = self-stake + votes received** in descending order, ties broken by ascending address, truncated at `MAX_VALIDATORS` (27). EAVM-managed accounts are excluded by construction, since they hold no hybrid keypair and therefore cannot sign blocks.

### 4.2 Block admission rules

A block is accepted only if it satisfies, in order:

1. Cryptographic integrity (both signatures verify, hash matches).
2. `height == head.height + 1` and `previousHash == head.hash`.
3. `timestamp > head.timestamp`.
4. **One block per slot**: `slot(block) > slot(head)`. This rule eliminates *slot grinding* — producing multiple candidates in the same slot to select the most favorable.
5. `txCount ≤ MAX_TXS_PER_BLOCK` (500).
6. Slot not further in the future than `SLOT_FUTURE_TOLERANCE_MS` (400 ms), and clock drift within `MAX_CLOCK_DRIFT_MS` (2,000 ms).
7. Above `STRICT_PRODUCER_HEIGHT`, the producer must be **exactly** the slot's expected producer.
8. Above `STATEROOT_HEIGHT`, the recomputed state root must match the one declared in the header.

The state transition is always simulated on a clone before being committed, and the disk write precedes the in-memory mutation.

### 4.3 Fork choice and BFT finality

The base rule is **longest chain**, constrained by two finality floors.

The dynamic floor is derived from the producers already present in the chain: a block is considered **final** once at least `floor(2N/3) + 1` **distinct** validators have produced blocks above it. There is no voting subprotocol, precommit message, or separate consensus round — finality is read from history. Reorganizations attempting to revert a finalized height are rejected.

Finality is disabled (`-1`) when the active set holds fewer than `FINALITY_MIN_VALIDATORS` = 3 validators, since below that threshold a 2/3 quorum offers no meaningful guarantee.

Reorganization depth is additionally bounded by the `REORG_WINDOW` = 5,000 blocks.

### 4.4 Storage and recovery

Blocks are persisted to `blocks.jsonl`, an append-only file with one JSON object per line, indexed in memory as `offsets[height] = [byteOffset, length]` — O(1) random access via positioned reads, without loading the entire chain. A window of recent blocks (`REORG_WINDOW + 100` = 5,100) stays in RAM; blocks leaving the window advance a base state by reapplication.

Full state snapshots are written every 5,000 blocks and can be authenticated with HMAC-SHA256 when `EAV7_SNAPSHOT_KEY` is configured — a mitigation for the vector in which an adversary with write access to the data directory injects balances or validators into a snapshot the node would load on trust. Snapshot revival rejects the `__proto__`, `constructor`, and `prototype` keys field by field.

A torn write on the file's final line is detected and truncated at boot. Invalid blocks at the end of the file are discarded and the node resynchronizes from the network.

---

## 5. Cryptography and the Post-Quantum Model

### 5.1 The `eav7-hybrid-1` scheme

| Component | Primitive | Standard |
|---|---|---|
| Classical signature | ECDSA over secp256k1, SHA-256 digest | SEC 2 / FIPS 186 |
| Post-quantum signature | ML-DSA-44 (Dilithium), no pre-hash | NIST FIPS 204 |
| Hash function | SHA3-256 truncated to 248 bits | NIST FIPS 202 |

Verification is a strict conjunction: **both** signatures must be valid. An object with only one correct signature is rejected exactly as one with no signature at all. Keys travel as PEM (private PKCS#8, public SPKI) and signatures as base64.

The cost of this choice is explicit and accepted: an ML-DSA-44 signature is substantially larger than an ECDSA one, which is why free per-account bandwidth is sized at 8,000 bytes — enough to cover approximately one hybrid transaction.

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

The signed block core contains: `protocol`, `version`, `scheme`, `height`, `timestamp`, `previousHash`, `txRoot`, `txCount`, `producer`, `publicKey`, `pqPublicKey`, and — above `STATEROOT_HEIGHT` — `stateRoot`. Excluded from the core: `signature`, `pqSignature`, `hash`, and `transactions`.

Above `CANONICAL_HASH_HEIGHT`, the block hash is computed **over the payload only**, excluding signatures. This makes the identifier immune to ECDSA signature malleability, in which an adversary rewrites `s` as `n − s`, producing an equally valid signature and therefore a different identifier for the same block.

### 6.2 Transactions

A transaction carries `protocol`, `scheme`, `type`, `from`, `to`, `amount`, `fee`, `nonce`, `timestamp`, `data`, both public keys, and both signatures. The identifier derives **exclusively from the canonical signed payload**, never from signature bytes — the same anti-malleability defense applied to blocks.

The `fee` field is a **fee limit** (a ceiling on burn authorized by the sender), not a payment, following TRON's *feeLimit* semantics. The nonce must be exactly the current value plus one.

The protocol defines **55 transaction types**, covering transfers, staking, voting, permissions, EAV20 tokens, EAV721 NFTs, the name service, governance, treasury, vesting, meta-transactions, EAVM, the bridge, and the AI layer.

### 6.3 State model and state root

The model is account-based (not UTXO), with monetary values as `BigInt` in the smallest unit, called **e7** (1 EAV7 = 10⁶ e7). State is partitioned into domains: accounts, tokens, NFTs, names, contracts, oracles, AI attesters, AI tasks, votes, permissions, delegations, governance proposals, treasury, slashing, unbonding, vesting, commissions, and bridge.

The state root is a **sorted-leaf Merkle tree** — explicitly **not** a Merkle-Patricia Trie:

```
leaf = H( domain ‖ \x1f ‖ key ‖ \x1f ‖ canonical_serialization(value) )
root = merkleRoot( sort(leaves) )
```

Canonical serialization recursively sorts object keys, encodes `BigInt` as `'B' + decimal`, and drops `undefined`, guaranteeing determinism across implementations.

This enables **account inclusion proofs** for light clients: a client knowing only the header's state root can verify an account balance from a Merkle path, without trusting the node that served the response.

> **Stated scaling limitation.** The root is recomputed over the **entire** state at every block — O(|state|) per block. An incremental structure (persistent tree or MPT) is acknowledged as necessary work before the chain reaches meaningful state size. See Section 13.

---

## 7. Resource Model and Fees

EAV7 has **no gas market**. There is no gas price, priority auction, or tip to the producer. The model is one of regenerating resources with burn as the overflow mechanism.

### 7.1 Energy and bandwidth

| Resource | Free per account | Per staked EAV7 | Regeneration | Overflow burn |
|---|---|---|---|---|
| Energy | 10 | +1 | 86,400 blocks (~24 h) | 20,000 e7 (0.02 EAV7) per unit |
| Bandwidth | 8,000 bytes | +256 bytes | 86,400 blocks (~24 h) | 5 e7 per byte |

Regeneration is linear and computed lazily, without scanning accounts. Energy is consumed per transaction type (a transfer costs 1; creating a token or NFT costs 10); bandwidth is consumed by the transaction's serialized size.

The effective fee is the shortfall converted into burn:

```
fee = energy_shortfall × 20,000 e7  +  byte_shortfall × 5 e7
```

If that fee exceeds the declared fee limit, the transaction fails. **An account with sufficient resources pays zero fee** — this is how the promise that "staking ≥ 100 EAV7 zeroes transfer fees" is realized: 100 staked EAV7 grant 100 energy units, far above a transfer's cost of 1.

Resources can be **delegated** to third parties (`DELEGATE_RESOURCE` / `UNDELEGATE_RESOURCE`) without transferring voting power — allowing an application to sponsor its users' resources.

### 7.2 Full fee burning

**Every fee collected is burned.** The producing validator receives no share of fees; its revenue is exclusively the block reward. This is a deliberate economic choice with three consequences:

1. **Deflationary pressure proportional to usage.** The more the network is used, the more supply is destroyed.
2. **Elimination of fee-driven censorship incentives.** Since the producer does not profit from the fee, there is no incentive to order or censor transactions based on it.
3. **No tip-based MEV market.** The protocol provides no channel for priority payment to the producer.

Beyond fees, the following are burned: 90% of slashing penalties (10% go to the reporter) and the cost of name registration in EAV-NS.

---

## 8. Staking, Validation, and Governance

### 8.1 Stake and unbonding

Staking moves balance from `balance` to `staked`, which simultaneously grants validator eligibility, voting power, energy and bandwidth capacity, and practical fee exemption.

`UNSTAKE` removes stake **immediately** — voting power and validator standing are lost at once — but the funds enter an *unbonding* queue for `UNBONDING_BLOCKS` = 604,800 blocks (**≈ 7 days**), credited back through each block's deterministic processing.

Three guards protect network integrity: it is impossible to unstake below the total voted, below the amount delegated to third parties, or to **empty the validator set** — the last active position cannot be removed.

### 8.2 Voting and voter rewards

EAV7 holders allocate voting power (equal to stake) to candidates, across up to 30 targets per transaction. Self-voting is forbidden, and only already-eligible candidates can receive votes.

The block reward is split in the following order: first the treasury share (`TREASURY_PCT`, **0% by default**, governable up to 50%); then, if the producer has received votes, it retains its commission (20% default, adjustable per validator) and the remainder is distributed pro rata to voters through a fixed-precision accumulator that makes claiming O(1). If the producer received no votes, it retains the whole.

### 8.3 On-chain governance

Only active validators may propose and vote. A proposal passes with **`floor(2N/3) + 1`** of the active validators, enters `QUEUED` status, and is applied only after `GOV_TIMELOCK_BLOCKS` (default 40,000 blocks, ~11 h) — giving the community a window to react to an approved change before it takes effect.

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

An **anti-brick rail** automatically reverts any change to `MIN_VALIDATOR_STAKE` or `MAX_VALIDATORS` that would result in an empty validator set — preventing governance from disabling the network through a parameterization error.

### 8.4 Slashing

The protocol implements **double-sign** slashing: two valid blocks, same producer, same height, different hashes. The penalty is 10% of the amount at risk (active stake **plus** funds in unbonding — closing the escape of unstaking after the offense), of which 10% goes to the reporter and 90% is burned. A nullifier keyed on `offender:height` prevents double punishment for the same evidence, and cheap checks precede the two expensive hybrid verifications to avoid DoS amplification.

> **Slashing is not active at launch.** This is a conscious decision, documented in the source itself: current detection cannot distinguish malicious equivocation from an honest validator re-producing a height after a reorganization, and would punish the honest party. Activating it requires hardening the anti-equivocation evidence. See Sections 13 and 14.

---

## 9. EAVM — Virtual Machine and Wallet Compatibility

The EAVM is EAV7's proprietary virtual machine — analogous to the role of the TVM in TRON. It executes bytecode and indexes logs, with keccak-256, RLP, secp256k1, and RIPEMD-160 implemented in-repository without dependencies.

To reduce adoption friction, the EAVM exposes a JSON-RPC endpoint speaking the **dialect** Ethereum-ecosystem wallets understand. Chain ID **72020**. Since wallets assume 18 decimals and the protocol uses 6, conversion applies the factor `EAVM_WEI_PER_E7` = 10¹²; values not divisible by 10¹² are rejected.

A `0x` address maps deterministically to an E7 address. Additionally, the protocol accepts an E7 destination **encoded inside the 20-byte field** of an EVM transaction, using the prefix `0xe7000000` followed by the 32 hexadecimal characters of the E7 body and checksum — allowing an ordinary wallet to send to a native address with on-chain checksum validation.

### 9.1 Compatibility — precise statement

This section exists to prevent an incorrect expectation. EAV7's JSON-RPC compatibility is **sufficient for wallets, insufficient for dApps**.

| Method | Status |
|---|---|
| `eth_chainId`, `net_version`, `eth_blockNumber` | Implemented |
| `eth_getBalance`, `eth_getTransactionCount` | Implemented |
| `eth_sendRawTransaction` | Implemented — decodes RLP/secp256k1 and converts to a native transaction |
| `eth_getTransactionByHash`, `eth_getTransactionReceipt` | Implemented (receipt carries no logs) |
| `eth_getBlockByNumber`, `eth_getBlockByHash` | Implemented (filtered to EAVM transfers) |
| `eth_gasPrice`, `eth_feeHistory` | Implemented (derived value, no real market) |
| **`eth_call`** | **Stub — always returns `0x`** |
| **`eth_getCode`** | **Stub — always returns `0x`** |
| **`eth_estimateGas`** | **Constant 21000** |
| **`eth_getLogs`, `eth_getStorageAt`, `eth_subscribe`, filters, `eth_getProof`** | **Not implemented** |

**Practical consequence:** MetaMask and Trust Wallet add the network, display the native balance, and send transfers normally. Libraries such as ethers.js, web3.js, and wagmi **cannot** read contracts, call ABI functions, or subscribe to events, because `eth_call`, `eth_getCode`, and `eth_getLogs` are non-functional. Contract interaction occurs through the native `EAVM_DEPLOY` and `EAVM_CALL` transactions, whose logs are indexed and served by the node's REST API. Completing the JSON-RPC surface is a roadmap item.

---

## 10. Native Artificial Intelligence Layer

### 10.1 The line that is not crossed

Before describing what AI does in EAV7, it is necessary to establish what it cannot do, because this is the project's central security property.

EAV7 contains two disjoint sets of components that the word "AI" could conflate:

**(A) The AI oracle protocol** — pure consensus. Transaction types, escrow, reputation, quorum, challenge, attestation. This is deterministic consensus state, replicated and verifiable by any node. No language model participates in validation: what the chain verifies are signatures and hash agreement.

**(B) The operational AI layer** — zero consensus power. Security sentinel, governance advisor, validator scoring, gateway read routing, and abusive-IP blocking.

The doctrine applied to (B) is explicit and uniform: **AI acts on its own only where the action is operational and reversible; in anything touching consensus, validators, stake, treasury, or code, it only PROPOSES.**

| Component | Autonomy | Maximum effect |
|---|---|---|
| Governance advisor | Propose-only | Drafts a proposal — no sender, no nonce, no signature |
| Validator scoring | Propose-only | Publishes performance metrics; never removes a validator or touches stake |
| Security sentinel | Alert-only | Publishes severity-classified alerts |
| Gateway (read routing) | Autonomous, non-consensual | Serves **reads** from a healthier peer; writes stay local |
| Abuse guard | Autonomous, non-consensual | Blocks an IP for a TTL with automatic expiry; never affects transaction validity |

There is no code path by which any AI component signs or submits a transaction. A draft produced by the advisor must be adopted by a human validator, signed, submitted, approved by 2/3+1 of governance, and still clear the timelock.

### 10.2 The oracle protocol

The base flow: `ORACLE_REGISTER` (oracle registers an endpoint and locks stake ≥ 500 EAV7) → `AI_TASK` (requester escrows the reward) → `AI_RESULT` (oracle delivers) → settlement. Each oracle's reputation starts at 50 and evolves on-chain: **+4** for successful delivery, **−12** for an overturned result or non-delivery, **−8** for committing without revealing, **+2/−4** for jurors voting with or against the majority.

On this base, five guarantee mechanisms coexist, each activated by fork height:

**Accountability.** Failing to deliver within the deadline, the oracle is penalized 10 EAV7 taken from its locked stake and credited to the requester as compensation — in addition to a full refund of the reward.

**Commit-reveal quorum.** A task may require N independent oracles (2 to 21). Each first publishes `H(output ‖ salt)` within a 30-minute commit window, and only afterwards reveals. This prevents an oracle from copying another's answer. When the quorum of agreeing reveals is reached, the reward is split among those in agreement; the dissenting minority loses reputation.

**Optimistic verification with a jury.** A single-oracle result enters a 30-minute challenge window. Absent a challenge, anyone may trigger settlement. If challenged — against a 20 EAV7 bond — a jury of registered oracles votes, with **interested parties explicitly excluded** from voting. Upon reaching 3 jurors, a simple majority decides: upheld, the oracle takes the reward **plus** the challenger's bond; overturned, the requester is refunded, the oracle is penalized, and the challenger recovers the bond plus a bounty.

**Reverse auction.** A task may be opened with a budget. Oracles bid on price; the requester awards; budget surplus is returned. An open, unawarded task is refundable after expiry.

**Private, verifiable results.** The oracle may publish only the `resultHash` and, optionally, a URI, keeping the output off-chain — encrypted to the requester in private tasks. Verification is `H(output) == resultHash`. The prompt and input parameters are erased from state after delivery, containing state growth.

### 10.3 Trusted-environment attestation

The strongest acceptance mechanism dispenses with both reputation and challenge window. Governance registers an **attester** — a set of public keys with a quorum and a *measurement* identifying the attested code. A result accompanied by sufficient signatures from that set over the digest

```
keccak256( "EAV7-AI-ATTEST" ‖ \x1f ‖ taskId ‖ \x1f ‖ resultHash ‖ \x1f ‖ attesterId ‖ \x1f ‖ measurement )
```

settles **immediately** and is marked on-chain as verified. The measurement used in the digest is always the one **registered on-chain**, never the one supplied by the sender — this is what binds the signature to the attested code identity. Signature counting deduplicates by recovered address and caps curve recoveries at the set's size, preventing both malleability-driven inflation and cryptographic DoS.

> **Precise statement of the trust model.** EAV7 verifies on-chain **only secp256k1 signatures from a set previously registered by governance**. The protocol contains no SGX, SEV-SNP, TDX, or Nitro code, and no DCAP quote parsing. Remote enclave attestation is verified **off-chain, once, at registration time**, by the operator and by the validators approving the governance proposal. From the chain's perspective, the measurement is an opaque string.
>
> For the same reason, the `ZK` type is accepted and verified **identically** to the `TEE` type — by signature from a registered verifier. **EAV7 does not implement zkML.** On-chain SNARK proof verification would require a pairing verifier (BN254 or BLS12-381), incompatible with the zero-dependency policy, and remains future work.

---

## 11. Cross-Chain Bridge

### 11.1 Mechanism

The bridge operates by lock-and-release. `BRIDGE_OUT` locks the native asset or token on the origin chain, recording the destination. `BRIDGE_IN` releases on the destination chain against proof.

Release authority evolved across three eras, each activated by height:

| Era | Release authority |
|---|---|
| Initial | One authorized relayer |
| Federated | Majority of authorized relayers |
| **Committee-attested** | **Quorum of origin-chain committee signatures over the event digest** |

In the final model, relayer authorization persists **only as anti-spam control** — it is no longer the minting authority. The digest binds every field of the event:

```
keccak256( "EAV7-BRIDGE-IN" ‖ \x1f ‖ CHAIN ‖ \x1f ‖ sourceTxHash ‖ \x1f ‖ destination ‖ \x1f ‖ amount ‖ \x1f ‖ token )
```

A signature harvested to release 5 EAV7 cannot release 500: the amount is in the digest.

Replay protection separates the replay key (`CHAIN:txHash`) from the attestation key (which includes destination, amount, and token). This separation has an important consequence: a malicious relayer attesting incorrect values forms its own group that never reaches quorum, **without blocking** the honest quorum on the correct value.

### 11.2 Committee rotation and the anti-capture rail

The origin-chain committee rotates by signed handoff: the **current** committee signs the transition to the new set and epoch, and the signatures must meet the **prevailing** quorum.

One security property deserves emphasis: EAV7 governance **cannot replace an active committee**. A governance proposal can only *create* a committee when none exists for that chain (bootstrap). The reason is direct — without this rail, 2/3 of EAV7's validators could swap the committee for keys of their own and drain the bridge. Replacing an operating committee requires the handoff signed by the origin.

### 11.3 Rate circuit breaker

A deterministic rate limit complements the model: the sum of releases of a given asset within a sliding window of 3,600 blocks (~1 h) may not exceed a fraction of the pool measured at window start — default **30%**, governable between 1% and 100%. Exceeded, the release is **rejected** (fail-closed). Each token holds an independent budget.

The purpose is to convert a total-drain scenario — compromised committee or relayer — into a **slow, observable leak**, buying time for human reaction.

### 11.4 Honest statement of the trust model

Three clarifications are necessary:

**The bridge is not a light client.** An internal specification for a bridge with header relay, Merkle inclusion proofs, and minimum confirmation depth exists, but is marked *proposed, not implemented*. What was built has the committee signing the **event digest directly**, with no header, no Merkle proof, and no confirmation-depth check. The correct designation is **committee-attested bridge**, not trustless bridge.

**Trust was relocated, not eliminated.** It moved from the relayer set to the origin-chain committee's key set, which is a real and substantial improvement. But a committee compromised at quorum can still mint, limited only by the circuit breaker.

**No production chain adapter exists.** The protocol defines an adapter interface and is chain-agnostic by construction — any valid identifier is accepted as origin or destination. The only implementation present in the repository is a loopback adapter for in-memory testing. TRON is the first specified target; no adapter has been implemented. See Section 13.

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

Issuance decreases geometrically and converges to zero after 64 halvings. Since every fee is burned, circulating supply is `genesis + issued − burned`, and under sufficient transaction volume burning exceeds issuance — making the network net deflationary.

### 12.2 Genesis distribution

The distribution starts from the structure TRON adopted at its genesis and deliberately shifts weight toward the open market: the public share rises from 40% to **45%**, funded by a 4-point reduction in Foundation/Treasury and a 1-point reduction in the private sale. The strategic partner's share remains aligned with the reference.

| Bucket | TRON (reference) | **EAV7** | Δ | Tokens | Vesting |
|---|---|---|---|---|---|
| **Public distribution** | 40.00% | **45.00%** | +5.00 | 45,000,000,000 | Liquid at TGE |
| **Foundation / Treasury** | 34.25% | **30.25%** | −4.00 | 30,250,000,000 | 12-month cliff + 48-month linear |
| **Private sale** | 15.75% | **14.75%** | −1.00 | 14,750,000,000 | 12-month cliff + 24-month linear |
| **Strategic partner** | 10.00% | **10.00%** | 0.00 | 10,000,000,000 | 12-month cliff + 36-month linear |
| **Total** | 100% | **100.00%** | — | **100,000,000,000** | — |

The insider-controlled share (Foundation, private sale, and partner) totals **55.00%**, against 60.00% in the reference structure.

The genesis validators' initial stake (10,000 EAV7 per validator) is debited from the Foundation/Treasury bucket.

**On vesting.** The protocol implements and tests vesting with a cliff followed by linear release, and the genesis block accepts a vesting table. It should be recorded, however, that the currently distributed genesis generator **does not populate that table** — it assigns the entire supply, less validator stake, to a single treasury wallet. Materializing the table above is a required change to the generator **before** the production genesis block is generated, and is a prerequisite for the described locks to be real and auditable on-chain. See Section 13.

**On the absence of vesting in the reference.** TRON applied no release locks to its insider buckets, which became the most persistent criticism of its launch. EAV7 deliberately diverges on this point: every non-public bucket carries a minimum 12-month cliff.

### 12.3 Treasury

The protocol supports directing a fraction of the block reward to the on-chain treasury, but the parameter starts at **0%**. Enabling it requires a governance proposal approved by 2/3+1 of validators and subject to timelock, with a hard-coded ceiling of 50%. Treasury spending likewise occurs through governance.

---

## 13. Maturity Status

This section exists so that no reader must infer what is ready. The classification is conservative by choice.

### 13.1 Implemented, tested, and active at launch

DPoS consensus with deterministic rotation and one-production-per-slot · BFT finality as a reorganization floor · `eav7-hybrid-1` signatures on wallets, transactions, and blocks · state root in headers with inclusion proofs for light clients · malleability-immune block hash and transaction identifier · energy + bandwidth resource model with delegation · validator voting with commission and voter rewards · per-account permissions and multi-signature · on-chain governance with timelock and anti-brick rail · treasury · vesting · meta-transactions · EAV20 tokens and EAV721 NFTs · EAV-NS name service · EAVM with contract execution and log indexing · phases 1 through 5 of the AI oracle protocol · bridge with committee attestation and handoff rotation · on-disk storage with authenticatable snapshots and torn-write recovery.

**Test coverage: 213 tests across 47 files**, executed by Node's native runner, including an integration test that brings up a real multi-validator chain and verifies determinism by replay.

### 13.2 Implemented and tested, but INACTIVE at launch

| Feature | Status | Activation requirement |
|---|---|---|
| **Double-sign slashing** | Complete and tested; **deliberately not activated at genesis** | Harden anti-equivocation evidence to distinguish attack from honest post-reorg re-production |
| **Bridge rate circuit breaker** | Complete and tested; activation height set to a distant value | Coordinated rollout with an identical future height on all three validators |
| **TEE attestation of AI results (Phase 6)** | Complete and tested; activation height set to a distant value | Coordinated rollout + registration of the first attester via governance |

The latter two sit outside the set of forks zeroed at genesis for a precise technical reason: activating them alters the state serialization feeding the state root, which would break replay of already-produced blocks. Activation requires all three validators to announce the **same** fork height before the chain reaches it — divergence would cause a split.

### 13.3 Roadmap — not implemented

- **Incremental state root.** Current cost is O(|state|) per block. Replacing it with a persistent tree or MPT is a prerequisite for meaningful state scale.
- **Complete JSON-RPC surface.** `eth_call`, `eth_getCode`, `eth_getLogs`, `eth_getStorageAt`, filters, and `eth_subscribe`, to enable ethers.js/web3.js/wagmi.
- **Bridge chain adapters.** No production adapter exists; TRON is the first specified target.
- **Light-client bridge.** Header relay, Merkle inclusion proofs, and minimum confirmation depth.
- **zkML.** On-chain SNARK proof verification, requiring a pairing verifier.
- **Authenticated P2P.** The current transport is plain HTTP.
- **Continuous integration.** The repository has no CI configuration; tests are run manually.
- **Independent external audit.** See Section 14.

---

## 14. Risk Factors

The risks below are material and should be read by anyone considering acquiring, custodying, or building on EAV7.

### 14.1 Regulatory risk — the most significant item in this document

**The public distribution described in Section 12.2 is a sale of tokens to the public.** An offering of this nature has a high probability of being characterized as a public offering of securities under Brazilian law, subject to the jurisdiction of the Comissão de Valores Mobiliários, and under United States law by the Howey test. This is not a remote hypothesis: in March 2023 the United States Securities and Exchange Commission filed suit against the Tron Foundation and Justin Sun involving, among other allegations, the unregistered offer and sale of TRX.

Potential consequences include prior registration requirements, restrictions on eligible jurisdictions, identity and source-of-funds verification obligations, personal liability for officers, and voidance of offerings made.

**Nothing in this whitepaper substitutes for specialized legal advice, which must be obtained before any fundraising.**

### 14.2 Centralization risks at launch

The network starts with **three validators**. With N = 3, the BFT finality quorum is 3 — meaning finality depends on all of them participating, and the unavailability of a single operator degrades the network. A set this small offers no meaningful resistance to collusion, coercion, or correlated infrastructure failure. Progressive decentralization of the validator set is a stated objective, but it is an objective, not a present state.

Additionally, slashing will not be active at launch (Section 13.2), so double-signing by a validator **will not be economically punished** until the mechanism is hardened and activated.

### 14.3 Bridge risk

The genesis generator seeds **a single relayer**. With one relayer, any majority quorum computed over the relayer set equals one. The bridge's security model becomes effective only with a properly constituted origin committee, and the rate circuit breaker — the mitigation designed to turn a drain into a leak — is **inactive** at launch. **The bridge must not custody economically meaningful value before the committee is constituted and the breaker is activated.**

### 14.4 Cryptographic and structural risks

**112-bit address space.** The address body is 14 bytes, offering birthday collision resistance on the order of 2⁵⁶ operations — below the 2⁸⁰ threshold considered comfortable today. Correcting it would invalidate every address already issued.

**Merkle tree construction.** The transaction tree duplicates the last node when the leaf count is odd and applies no domain separation between leaf and internal node. This construction is known to allow, in certain protocols, distinct transaction sets to produce identical roots. The impact on EAV7 is limited by the fact that the transaction identifier derives from the signed payload, but the construction is not the most robust available.

**ML-DSA is a recent standard.** ML-DSA was standardized in 2024 and has substantially less public cryptanalysis history than ECDSA. The hybrid choice exists precisely so that a flaw in either scheme is not fatal — but that is a mitigation, not a guarantee.

### 14.5 Audit risk

The protocol underwent multiple rounds of adversarial audit conducted internally with language-model assistance, which identified and led to the correction of significant vulnerabilities — including consensus slot manipulation, bridge drain, AI-layer escrow theft, block hash malleability, and unauthenticated snapshots. All fixes are covered by regression tests.

**No external, independent audit firm has reviewed this code.** Internal auditing, however rigorous, does not substitute for independent adversarial review, and this is a material risk for any value custodied on the network.

There is also no continuous integration pipeline: the tests exist and pass, but their execution is neither mandatory nor automated on each change.

### 14.6 Operational and scaling risks

State root recomputation is O(|state|) per block. As state grows, per-block cost grows proportionally, and there exists a point at which one-second production ceases to be sustainable. That limit has not been empirically characterized.

The P2P transport is unauthenticated HTTP. The operational AI layer depends on external services when configured to do so, and unavailability of those services degrades monitoring, never consensus.

---

## 15. Legal Disclaimer

This document is provided solely for informational and technical purposes. It does not constitute, and must not be construed as, an offer to sell, a solicitation of an offer to buy, investment advice, legal, tax, accounting, or financial advice, nor a prospectus or offering document under any legislation.

**Forward-looking statements.** This whitepaper contains statements regarding plans, roadmap, future functionality, and intended outcomes. Such statements reflect expectations as of the publication date and involve known and unknown risks and uncertainties. Actual results may differ materially. No obligation to update is assumed.

**No warranties.** The software is provided "as is", without warranty of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, availability, security, or absence of defects. No independent external audit has been performed on the code described.

**Risk of total loss.** Digital assets are high-risk and highly volatile. The value of EAV7 may fall to zero. Software failures, vulnerability exploitation, loss of private keys, regulatory action, or project discontinuation may result in total and irreversible loss. Do not acquire EAV7 with funds whose complete loss would compromise your financial situation.

**Jurisdictional restrictions.** Acquiring or holding digital assets is restricted or prohibited in certain jurisdictions. It is the reader's sole responsibility to verify the legality of their participation under applicable law.

**Independence from TRON.** References to TRON in this document are strictly comparative and descriptive of design inspiration. EAV7 is not affiliated with, sponsored by, endorsed by, or otherwise associated with the TRON Foundation, TRON DAO, or any of their related entities.

---

## Appendix A — Consensus Parameters

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
| Max validators | 27 (governable, ceiling 101) |
| Minimum validator stake | 1,000 EAV7 (governable) |
| Minimum validators for finality | 3 |
| Unbonding period | 604,800 blocks (≈ 7 days) |
| Slashing percentage | 10% of amount at risk |
| Reporter bounty | 10% of the penalty |
| Default validator commission | 20% |
| Treasury percentage | 0% (governable, ceiling 50%) |
| Block reward | 16 EAV7 (governable, ceiling 1,000) |
| Halving interval | 126,144,000 blocks (≈ 4 years) |
| Genesis supply | 100,000,000,000 EAV7 |
| Minimum oracle stake | 500 EAV7 |
| Oracle penalty | 10 EAV7 |
| Challenge bond | 20 EAV7 |
| Jury quorum | 3 jurors |
| Governance quorum | ⌊2N/3⌋ + 1 active validators |
| Governance timelock | 40,000 blocks (≈ 11 h) |
| Bridge breaker window | 3,600 blocks (≈ 1 h) |
| Bridge breaker cap | 30% of pool (governable, 1%–100%) |
| EAVM Chain ID | 72020 |
| EAVM conversion | 10¹² wei per e7 |
| Max EAVM gas | 30,000,000 |
| Max contract size | 24,576 bytes (EIP-170) |
| Max fee limit | 100 EAV7 |
| Transaction types | 55 |

---

*EAV7 · Technical Whitepaper v1.0 · July 19, 2026*
