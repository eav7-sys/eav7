# Mapa de melhorias — projeto inteiro

Levantamento transversal (2026-08-09). Cruza o que **já está** nos planos
01–10 com achados novos em Rust, JS, web, wasm, vetores, deploy e higiene.

Não substitui [10-mapa-integrado.md](10-mapa-integrado.md) (ordem Core/SDK);
este arquivo é o **inventário completo** de alavancas.

## Mapa do repositório

| Frente | O que é | Estado resumido |
|---|---|---|
| `rust/src` (`eav7`) | Consenso, estado, EAVM, stateroot, store | Completo; G7/G8; `money::format_eav7` |
| `rust/node` | API, P2P, produtor, guard, RPC EAVM | 34 rotas; harness G6; `Node::novo` |
| `rust/sdk` | Cliente, carteira, relayer, faucet | Fase S (S1–S4) |
| `rust/wasm` | Cripto da carteira no browser | Usado pelo web-next |
| `src/` | Referência JS + nó | API split (`api/stats`, `api/proxy`); 1 frontend |
| `web-next/` | Explorador + wallet Next | Único front; smoke e2e + CI |
| `vectors/` | Conformidade JS→Rust | + lifecycle; checados no `verificar.sh` |
| `bin/eav7-verificar.sh` | Suíte completa local | CI job + vetores G19 |
| Deploy | rsync + `deploy/nodes.env` | Nós `src/`+`bin` + Next + health; [go-live.md](../go-live.md) |
| `.github/workflows` | CI + release-core | Parity, e2e, arm64; Core Win/Linux/macOS |

## Já planejado (não repetir aqui)

| Tema | Doc |
|---|---|
| Produção / disco / forks | [05](05-pendencias.md) · [06](06-decisoes-abertas.md) |
| Método testes | [07](07-metodo-testes.md) |
| Core + app eleitor | [08](08-descentralizacao-core-carteira.md) — **Fase C = decisão de produto** |
| SDK S5–S11 | [09](09-sdk-melhorias.md) |
| Ordem S→A→B→C→D | [10](10-mapa-integrado.md) |

## Achados — estado

### P0 / P1

| ID | Estado |
|---|---|
| G1 CI | feito |
| G2 wasm wallet | feito |
| G3 vetores ciclo | feito |
| G4 eth_call sem write lock | feito |
| G5 golden API + CI | feito (6 rotas + job `api-parity`) |
| G6 harness multi-nó | feito |
| G7 índices disco | feito |
| G8 snapshot async | feito |
| G9 sync peers paralelo | feito |
| G10 um frontend | feito |
| G11 merge-i18n | feito |
| G12 Playwright smoke | feito (6 rotas + job `e2e-smoke`) |
| G13 deploy build/checksum/health | feito |

### P2

| ID | Estado |
|---|---|
| G14 gitignore lixo | feito |
| G15 `docs/api.md` | feito |
| G16 `Node::novo` no `main` | feito |
| G17 `format_eav7` único (`eav7::money`) | feito |
| G18 header `blockchain.rs` | feito |
| G19 vetores no `verificar.sh` | feito |
| G20 monitor fora do host | feito (`EAV7_MONITOR_URL` + webhook first) |
| G21 quebrar `api.js` | feito (fatia: `api/stats.js` + `api/proxy.js`) |

### Core A4

| Item | Estado |
|---|---|
| Linux arm64 no release | feito (`ubuntu-24.04-arm`) |
| launchd example | feito |
| Windows service doc | feito |
| Fase C app eleitor | **aberto — decisão de stack/relaunch** (08) |

## O que NÃO priorizar agora

- COW/SMT · subir `MAX_VALIDATORS` · FFI mobile · Electron GUI · preço/mcap.
- Aposentadoria total do cliente JS (fase 6) — só após paridade operacional longa.
- Fase C (app eleitor) sem decisão de relaunch / Expo vs web shell.
