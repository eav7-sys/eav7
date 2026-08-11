# Contributing to EAV7

Thanks for helping improve the EAV7 protocol and tooling.

## Before you start

1. Read the [whitepaper](docs/whitepaper.en.md) (or [PT](docs/whitepaper.md)).
2. Skim [AUDITORIA.md](AUDITORIA.md) for residual risks.
3. Prefer small, reviewable pull requests over large mixed patches.

## Development setup

```bash
# Protocol + node + Core
cd rust && cargo build -p eav7 -p eav7-node -p eav7-core

# Local stack (Core + explorer)
npm run dev:local

# Full Rust verification
npm run verificar
```

Details: [docs/local.md](docs/local.md) · [docs/core.md](docs/core.md).

## Branching & PRs

- Base PRs on the active development branch (currently `security-audit-fixes` until merged to `main`).
- Keep commits focused; message style: `area: short imperative summary`.
- Fill the pull request template.
- CI must be green (`cargo test`, clippy, explorer build / e2e as applicable).

## Coding guidelines

### Rust (`rust/`)

- Consensus parameters live only in `rust/src/config.rs`.
- Prefer clarity over cleverness in consensus paths.
- Add or update vector-driven tests when changing state transitions.
- Do not introduce consensus constants duplicated outside `config`.

### Explorer (`web-next/`)

- TypeScript / Next.js App Router.
- Do not enable mock data for production builds (`NEXT_PUBLIC_USE_MOCK=false`).

## Security-sensitive changes

If your change touches consensus, crypto, P2P admission, bridge, or admin auth,
call it out explicitly in the PR and consider filing via [SECURITY.md](SECURITY.md)
instead of a public issue when appropriate.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
