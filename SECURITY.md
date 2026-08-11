# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `v0.1.x` (tagged releases) | Yes |
| Development branches | Best effort |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: **security@eav7.com** (or the maintainers listed on the organization profile)

Include:

1. Description of the issue and impact
2. Steps to reproduce / proof of concept
3. Affected component (`eav7-node`, `eav7-core`, SDK, explorer, consensus crate)
4. Suggested fix if you have one

We aim to acknowledge reports within **72 hours** and provide a status update within **7 days**.

## Scope

In scope:

- Consensus / state transition bugs
- Cryptography misuse (hybrid signatures, address derivation)
- Remote DoS / auth bypass on node APIs
- Bridge / treasury / governance fund-loss paths
- Supply-chain issues in release binaries

Out of scope (unless chained into a fund-loss path):

- Social engineering
- Issues requiring physical access to a validator host
- Best-practice findings already documented in `AUDITORIA.md`

## Disclosure

We prefer coordinated disclosure. Please allow a reasonable window before public write-ups so operators can upgrade.
