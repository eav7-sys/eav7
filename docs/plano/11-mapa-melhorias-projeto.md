# Mapa de melhorias — projeto inteiro

Levantamento transversal (2026-08-09). Cruza o que **já está** nos planos
01–10 com achados novos em Rust, JS, web, wasm, vetores, deploy e higiene.

Não substitui [10-mapa-integrado.md](10-mapa-integrado.md) (ordem Core/SDK);
este arquivo é o **inventário completo** de alavancas.

## Mapa do repositório

| Frente | O que é | Estado resumido |
|---|---|---|
| `rust/src` (`eav7`) | Consenso, estado, EAVM, stateroot, store | Completo; âncora corrigida (uncommitted) |
| `rust/node` | API, P2P, produtor, guard, RPC EAVM | 34 rotas; sem testes de integração |
| `rust/sdk` | Cliente, carteira, relayer, faucet | Bom núcleo; backlog em [09](09-sdk-melhorias.md) |
| `rust/wasm` | Cripto da carteira no browser | **Pronto e ocioso** — web-next não usa |
| `src/` | Referência JS + nó de produção atual | 378 testes; `api.js` monólito; 3 frontends |
| `web-next/` | Explorador + wallet Next | Fase 4; scan solto; 0 e2e |
| `web/` + `public/` | Frontends legados | Ainda servidos pelo nó |
| `vectors/` | Conformidade JS→Rust | Folhas/tx/EAVM; **sem** ciclo âncora/reorg |
| `bin/eav7-verificar.sh` | Suíte completa local | Excelente; **sem CI** |
| `docs/plano/` | Planos oficiais | 01–10 |
| Deploy scripts | rsync + IPs | Uncommitted; sem checksum de build |
| Lixo na raiz | zip/rar/Obsidian/`.DS_Store` | Incha clone e atrapalha auditoria |
| `.github/workflows` | CI | **Inexistente** |

## Já planejado (não repetir aqui)

| Tema | Doc |
|---|---|
| Produção caída, commits, disco 0,51 GB/dia, órfãos Next, 404, forks, aposentar JS | [05](05-pendencias.md) |
| Panic âncora, deploy IPs, login explorador, fork formato | [06](06-decisoes-abertas.md) |
| Método “1ª vez” / teste que falha sem fix | [07](07-metodo-testes.md) |
| Core Win/Linux/macOS + app eleitor | [08](08-descentralizacao-core-carteira.md) |
| SDK S1–S11 | [09](09-sdk-melhorias.md) |
| Ordem S→A→B→C→D | [10](10-mapa-integrado.md) |
| USE_MOCK, BlocksList `from=`, mock/CSV, etc. | auditoria / canvas |

## Achados NOVOS (fora de 08–10)

### P0 — proteção e risco de fundos

| ID | Melhoria | Por quê | Evidência | Esforço |
|---|---|---|---|---|
| G1 | **CI contínua** rodando `bin/eav7-verificar.sh` (+ `next build`) | 982+378 testes e vetores só rodam se alguém lembrar; drift JS↔Rust é o risco nº 1 do dual-client | Zero `.github/workflows` | S–M |
| G2 | **Carteira web → `eav7-wasm`** | `wallet-crypto.ts` é 3ª cópia de cripto; endereço divergente = fundo perdido; o crate existe para eliminar isso | `web-next` importa `@/lib/wallet-crypto`; `rust/wasm` ocioso | M |
| G3 | **Vetores de ciclo de vida** (gênese→expulsão→âncora→reorg→replay) | Classe dos 3 bugs do §07; fix da âncora sem prova cruzada JS↔Rust | `vectors/` sem esse ciclo | M |
| G4 | **`eth_call` / `eth_estimateGas` fora do write lock** | Simulação CPU sob lock exclusivo do `Node`; produtor (200 ms) e API de leitura competem | `rust/node/.../eavm_rpc.rs` `needs_write` | M |

### P1 — paridade, nó, front

| ID | Melhoria | Por quê | Evidência | Esforço |
|---|---|---|---|---|
| G5 | **Golden tests de paridade API** JS↔Rust (34 rotas) | Correções em dobro à mão; mensagens de erro são contrato | Sem diff automatizado de HTTP | M |
| G6 | **Harness multi-nó** (2–3 nós em processo) | Resposta estrutural ao §07 | `rust/node/tests/` vazio | M–L |
| G7 | **Índices de cadeia em disco** (`hashes` / offsets) | RAM cresce com *idade* da cadeia; fere o Core barato do plano 08; **sem fork** | `blockchain.rs` índices; distinto de 05.3 (disco do bloco) | L |
| G8 | **Snapshot async** (fora do caminho quente de `add_block`) | Encode+write sync a cada N blocos pode estourar slot de 1 s | `talvez_snapshot` no accept path | S–M |
| G9 | **Sync P2P: status dos peers em paralelo** | N peers mortos = N×3 s em série | `p2p.rs` `sync_once` | S |
| G10 | **Um frontend só** — aposentar `public/*.html` + SPA `web/dist` | Nó serve 3 UIs; superfície de validador inchada | `src/node/api.js` estáticos + proxy Next | M |
| G11 | **merge-i18n no CI/prebuild** | `generated.ts` 15k linhas diverge dos `_parts` se esquecer o script | `web-next/scripts/merge-i18n.mjs` sem hook | S |
| G12 | **Smoke Playwright** (6 rotas, mock ok) | Playwright instalado, zero specs; redesenho sem rede de segurança | `web-next` sem `*.spec.*` | M |
| G13 | **Deploy com build + checksum + healthcheck público** | rsync de `api.js` avulso / standalone pré-montado | `deploy-eavscan-update.sh` | M |

### P2 — higiene e DX

| ID | Melhoria | Por quê | Esforço |
|---|---|---|---|
| G14 | Limpar raiz (zip/rar/Obsidian/`.DS_Store`/notas) | Clone e auditoria | S |
| G15 | Atualizar `docs/api.md` (`size`, `tps`, `name`, transfers) | Contrato para integradores | S |
| G16 | Construtor único de `Node` (hoje ×4 literais) | Drift de campos novos | S |
| G17 | Unificar `format_eav7` (producer vs API) | Já pagamos bug de unidade | S |
| G18 | Doc drift: cabeçalho `blockchain.rs` ainda diz snapshot “não portado” | Comentário é contrato aqui | S |
| G19 | Regenerar/checar vetores no `verificar.sh` | Vetor obsoleto passa verde | S |
| G20 | Monitor fora do host | `monitor.sh` no próprio nó fica mudo na queda total (caso 01) | S |
| G21 | Quebrar `api.js` por domínio | 1357 linhas no caminho do validador | M |

## Divergências perigosas JS ↔ Rust ↔ web

1. ~~**Cripto no browser** ainda TS manual (G2).~~ Feito (`eav7-wasm`).
2. ~~**Âncora** sem vetor cruzado (G3).~~ Feito (`vectors/lifecycle.json` + testes JS/Rust).
3. **Ordem de iteração** (JS inserção vs BTreeMap) — já mordeu `/names` e validators; sem golden (G5) volta.
4. **`size` do bloco** — igualdade de comprimento afirmada em comentário, sem teste.
5. **`/stats`** recém-alinhado a olho nos dois clientes — golden protege.

## Backlog unificado sugerido (próximas 10 ações)

Ordem por **alavancagem × risco**, misturando planos antigos e novos:

| # | Ação | Origem |
|---|---|---|
| 1 | CI = `eav7-verificar.sh` + build Next | **G1** |
| 2 | Commit âncora isolada + decisão panic release | 05.2 / 06.1 |
| 3 | Vetores ciclo de vida + prova cruzada | **G3** / 07 |
| 4 | Fase S SDK (S1–S4) | 09 |
| 5 | web-next → wasm (matar `wallet-crypto.ts`) | **G2** |
| 6 | Inverter USE_MOCK + BlocksList `from=` | audit |
| 7 | Golden paridade API | **G5** |
| 8 | `eth_call` sem write lock | **G4** |
| 9 | Core Fase A (multiplataforma) | 08 |
| 10 | Um frontend (só Next) + smoke e2e | **G10** / **G12** |

Depois: G6–G9, G13, trilha B/C/D do 08, aposentar JS (fase 6).

## O que NÃO priorizar agora

- COW/SMT (`docs/scaling.md`) — gatilho ~30–50k contas.
- Subir `MAX_VALIDATORS` antes de diversificar os 27.
- FFI mobile antes da stack do app.
- Refator cosmética de `gov.rs` / `ai.rs` monólitos.
- Electron GUI do Core.
- Preço/mcap no explorador.

## Como usar este documento

- **Ops / consenso / CI** → G1, G3, G4, G5, G6 + 05/06.
- **Produto descentralização** → 08 + 09 + 10.
- **Front trust** → G2, G10–G12 + mock.
- **Operador Core barato** → G7, G8, G9 + 08-D (disco/snapshot).

## Progresso (sessão 2026-08-09)

| Item | Estado |
|---|---|
| G1 CI `.github/workflows/ci.yml` | feito |
| USE_MOCK invertido + guard production | feito |
| BlocksList `?from=` | feito |
| CSV anti-fórmula | feito |
| G11 `prebuild` merge-i18n | feito |
| G12 smoke Playwright + config | feito (esqueleto) |
| G5 `bin/eav7-api-parity.sh` + `eav7-api-parity-boot.sh` | feito (6 rotas; CI job dedicado ainda aberto) |
| G14 gitignore zip/Obsidian/Sem título | feito |
| validators: hoist sort names (JS) | feito |
| token transfers `nextBefore` no SCAN_CAP (JS+Rust) | feito |
| G2 wasm wallet (`wallet-crypto` → eav7-wasm + `wasm:build`) | feito |
| G4 eth_call sem write lock | feito (19 testes eavm_rpc ok) |
| G9 sync peers em paralelo | feito |
| SDK Fase S (S1–S4, Remetente, timeout) | feito (`cargo test -p eav7-sdk` 16 ok) |
| G3 vetores ciclo âncora | feito: `vectors/lifecycle.json` + `bin/eav7-vectors-lifecycle.js`; Rust `vetores_de_ciclo_de_vida_batem_com_a_referencia`; JS `test/lifecycle.test.js` (vetor + caminho real assinado) |
| Local pronto → deploy depois | feito: `docs/local.md`, `npm run dev:local`, `.env.example`, deploy sem IPs (`deploy/nodes.env`) |
| Core Fase A (MVP CLI) | feito A2–A7 (3 alvos no release); falta A4 instaladores + arm64 Linux |
| Core Fase B candidatura | feito B1–B5 na CLI (`stake`/`score`/`set-mode`/`health`) |
| G6 harness / G7 RAM / G10 aposentar fronts | ainda não |
