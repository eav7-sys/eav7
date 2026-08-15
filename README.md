# EAV7

**Layer-1 blockchain** with Delegated Proof of Stake, native **EAV20 / EAV721**
assets, hybrid post-quantum signatures, and an EVM-facing JSON-RPC layer
(**EAVM**) for MetaMask and Trust Wallet.

| | |
|---|---|
| **Protocol** | eav20 |
| **Native asset** | EAV7 (6 decimals) |
| **Addresses** | `E7…` (34 chars) |
| **Chain ID (EAVM)** | `72020` |
| **Consensus** | DPoS · up to 51 active validators (+ bank 50) · ~1s blocks · BFT finality |
| **Client** | Rust (`eav7-node` / `eav7-core`) |
| **Explorer** | [eavscan.com](https://eavscan.com) (`web-next`) |
| **License** | [MIT](LICENSE) |

[![CI](https://github.com/eav7-sys/eav7/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/eav7-sys/eav7/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/eav7-sys/eav7?include_prereleases)](https://github.com/eav7-sys/eav7/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Whitepaper:** [English](docs/whitepaper.en.md) · [Português](docs/whitepaper.md) (v1.0.1) · [eavscan.com/whitepaper](https://eavscan.com/whitepaper)  
> **Docs index:** [docs/README.md](docs/README.md)

---

## Why EAV7

- **Hybrid signatures by default** — every wallet, transaction, and block requires
  secp256k1 **and** ML-DSA-44 (`eav7-hybrid-1`). Not an optional upgrade path.
- **Full L1 surface** — staking, voting, voter rewards, Anchor multisig (owners + witness),
  GB · Free Signature resources, owner-authorized governance, vesting, meta-transactions,
  EAV20 contracts on EAVM, AI task market, and a committee-attested bridge.
- **Operator-first Core** — `eav7-core` lets anyone sync, stake, run `ancora-init`, and (if elected)
  produce blocks on Linux, macOS, or Windows without reading the monorepo.
- **Wallet compatibility** — EAVM JSON-RPC (Chain ID `72020`) for existing
  Ethereum-ecosystem wallets.

---

## Architecture

```
┌──────────────┐     HTTP API / P2P      ┌─────────────────┐
│  eav7-core   │◄───────────────────────►│   Peer nodes    │
│  (operator)  │                         │   (validators)  │
└──────┬───────┘                         └────────┬────────┘
       │                                          │
       │  eav7-node (consensus + API + EAVM RPC)  │
       ▼                                          ▼
┌─────────────────────────────────────────────────────────┐
│              eav7 (Rust consensus library)              │
│   state · blocks · stateroot · EAVM · bridge · gov      │
└─────────────────────────────────────────────────────────┘
       ▲
       │  JSON API
┌──────┴───────┐
│   web-next   │  explorer · wallet · mining UI
└──────────────┘
```

| Crate / path | Role |
|---|---|
| `rust/` (`eav7`) | Consensus rules & state machine |
| `rust/node` (`eav7-node`) | Full node: API, P2P, producer, EAVM RPC |
| `rust/core` (`eav7-core`) | Operator CLI (init / run / stake / score) |
| `rust/sdk` | Wallet, HTTP client, relayer helpers |
| `rust/wasm` | Browser crypto for the explorer wallet |
| `web-next/` | Block explorer & wallet UI |
| `vectors/` | Frozen conformance fixtures |

---

## Binaries

| Binary | Description |
|---|---|
| **`eav7-core`** | Recommended operator entrypoint — listen, candidate, or validator |
| **`eav7-node`** | Full node process used under the Core |

**Prebuilt releases** (Linux x64/arm64, macOS arm64, Windows x64):

**https://github.com/eav7-sys/eav7/releases**

```bash
# From source
cd rust
cargo build --release -p eav7-core -p eav7-node

./target/release/eav7-core init --dir ./data/core \
  --mode listen --port 6072 --allow-private-peers \
  --peers http://127.0.0.1:6070
./target/release/eav7-core run --dir ./data/core
```

Operator guide: [`docs/core.md`](docs/core.md).

---

## Quick start (developers)

**Requirements:** Rust stable · Node.js 22+ (explorer only) · `cargo` / `npm`

```bash
# Core + explorer on localhost
npm run dev:local
# → API  http://127.0.0.1:6070
# → UI   http://127.0.0.1:3000

# Three-node local testnet
npm run testnet:up -- --fresh

# Verify the Rust workspace
npm run verificar
```

More: [`docs/local.md`](docs/local.md) · [`docs/testnet.md`](docs/testnet.md) · [`docs/api.md`](docs/api.md).

---

## Network parameters

| Parameter | Value |
|---|---|
| Genesis supply | 100,000,000,000 EAV7 |
| Block reward | 16 EAV7 (halving ~4y) |
| Block time | ~1 second |
| Active validators | up to 51 (+ bank 50) |
| Min stake to produce | 1,000 EAV7 |
| Unbonding | ~7 days |
| EAVM RPC | API port + 1000 (e.g. `7070`) |

---

## Security

- Report vulnerabilities privately — see [`SECURITY.md`](SECURITY.md).
- Internal adversarial review notes: [`AUDITORIA.md`](AUDITORIA.md).
- Production checklist: [`docs/go-live.md`](docs/go-live.md).

**Do not** expose the node admin API or bind validators to the public internet
without a reverse proxy / tunnel and a robust `EAV7_ADMIN_TOKEN`.

---

## Contributing

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and the
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

Pull requests should stay focused; consensus changes need tests against
`vectors/` and a clear fork-height story when applicable.

---

## Repository layout

```
rust/            consensus library, node, Core, SDK, wasm
web-next/        explorer + wallet
bin/             deploy, testnet, verification scripts
deploy/          systemd / launchd / Windows service examples
vectors/         conformance fixtures
docs/            whitepaper, API, operator & planning docs
.github/         CI, release, issue & PR templates
```

---

## License

[MIT](LICENSE) © EAV7
