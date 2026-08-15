# Plano de publicação da EAV7

Plano operacional para tornar a rede **encontrável, verificável e listável**.
Ordem importa: trackers (CoinGecko / CoinMarketCap) vêm **depois** de liquidez e supply circulante públicos.

Última atualização: 11 de agosto de 2026.

---

## Norte

| Objetivo | Definição de “pronto” |
|---|---|
| Rede reconhecida | MetaMask/Trust adicionam 72020 com nome + ícone corretos |
| Verificável | Explorer, GitHub, whitepaper e RPC públicos batem entre si |
| Preço público | Mercado aberto (LBP/DEX) + feed estável em `eavscan.com/price` |
| Trackers | CoinGecko → CoinMarketCap com volume e circulating reais |
| Honestidade | Bridge, auditoria e N=7 declarados como estão — sem overclaim |

---

## Fase 0 — Já conquistado

| Item | Evidência |
|---|---|
| Mainnet ao vivo | Gênese `7aa09afc…e80e5fb` · 7 âncoras · ~1 s |
| ethereum-lists | [PR #8521](https://github.com/ethereum-lists/chains/pull/8521) mergeado · chain `72020` |
| Chainlist | [chainlist.org/chain/72020](https://chainlist.org/chain/72020) |
| Explorer / docs | [eavscan.com](https://eavscan.com) · [docs](https://eavscan.com/docs/sobre) |
| Código | [github.com/eav7-sys/eav7](https://github.com/eav7-sys/eav7) (MIT) |
| Whitepaper v1.0 | PT + EN · 11 ago 2026 |
| Pitch | `docs/pitch/EAV7-apresentacao.pdf` |
| Privacidade RPC | [eavscan.com/privacy#rpc](https://eavscan.com/privacy#rpc) |
| Ícone novo (live) | [icon-512](https://eavscan.com/icon-512.png) · [icon](https://eavscan.com/icon.png) |

### Em voo (fechar antes da Fase 1)

| PR | Repo | Status alvo |
|---|---|---|
| [#3040](https://github.com/DefiLlama/chainlist/pull/3040) | DefiLlama/chainlist | RPC `tracking: limited` (filtro “seguro”) |
| [#8591](https://github.com/ethereum-lists/chains/pull/8591) | ethereum-lists/chains | Ícone IPFS novo + nome `EAV7` |

**Dono:** acompanhar CI/comentários; responder em &lt;24 h; manter `ipfs daemon` pinando `QmdbLKnuZNeiPnuUE8rKS2XGuWA2TsjMG5ZiXk5r3fqPCu` até o merge do ícone.

---

## Fase 1 — Identidade da rede (esta semana)

Objetivo: qualquer pessoa adiciona a rede sem atrito e vê a marca certa.

| # | Tarefa | Status | Notas |
|---|---|---|---|
| 1.1 | Merge PRs #3040 e #8591 | Em voo | Só maintainers externos |
| 1.2 | Checklist MetaMask | Pronto p/ QA | Ver [`FASE1-QA.md`](./FASE1-QA.md) |
| 1.3 | Checklist Trust Wallet | Pronto p/ QA | Idem |
| 1.4 | Página “Add network” | **Feito** | `/developers/networks#add-network` + guia MetaMask |
| 1.5 | Espelhos locais | **Feito** | `chain-registry/`, `docs/listing/`, ícones `web-next/public` |
| 1.6 | Socials mínimos | **Feito** | X, Telegram, Discord, GitHub `eav7-sys/eav7` no footer |

**Critério de saída:** screenshot MetaMask com ícone EAV7 + link público “como adicionar a rede”.  
**Link canônico:** https://eavscan.com/developers/networks#add-network

Parâmetros canônicos no código: `web-next/src/lib/eavm-chain.ts` (`wallet_addEthereumChain` + bloco manual).

---

## Fase 2 — Mercado e supply verificável (bloqueante)

Sem isto, CoinGecko/CMC recusam ou listam como “untracked” sem valor.

| # | Tarefa | Status | Feito quando | Notas |
|---|---|---|---|---|
| 2.1 | Decisão GTM do 45% público | **Feito · A** | LBP 72h → seed AMM | [`FASE2-GTM.md`](./FASE2-GTM.md) |
| 2.2 | Deploy / operação do mercado | **LBP aberta** | Pair EAV7/USDT + LBP + LP lock | Vault funded · `openLbp` live · deadline **262603** · AMM depois do finalize · [`FASE2-OPS.md`](./FASE2-OPS.md) · [`FASE3-AMM.md`](./FASE3-AMM.md) |
| 2.3 | Circulating supply on-chain | **Feito (código)** | Página + API free float | `/market` · `GET /circulating` |
| 2.4 | Feed de preço | **LBP live** | Mercado real no `/price` | `$0.008` · tier `lbp-open` · mcap free float · pool só pós-seed |
| 2.5 | Explorer: token page | Pendente | Supply / holders / transfers | |
| 2.6 | Comunicação TGE/LBP | **Rascunho pronto** | Data, regras, links, riscos | Post manual · [`TGE-COMUNICACAO.md`](./TGE-COMUNICACAO.md) |

Custódia (referência):

| Bucket | Endereço |
|---|---|
| Público | `E7AADB…8320` |
| Venda | `E7C665…CCB0` |
| Parceiro | `E72F728…2D40` |
| Tesouraria | `E7F290…D126` |

**Fórmula free float:** `(genesis + minted − burned) − Σ(saldos das 4 custódias)`.

**Critério de saída:** URL do pool + preço de mercado em eavscan + circulating explicado (página `/market` já cobre a parte de supply).

---

## Fase 3 — Trackers (CoinGecko → CMC)

Ordem fixa: **CoinGecko primeiro**, CoinMarketCap depois (CMC costuma espelhar/exigir mais volume).

### 3.1 Pacote comum (preparar uma vez)

- [ ] Nome, símbolo, site, explorer, whitepaper, GitHub
- [ ] Logo 200×200+ (usar `icon-512.png`)
- [ ] Chain ID, RPC, contrato nativo / descrição L1
- [ ] Circulating + total supply + max supply (emissão finita documentada)
- [ ] Links sociais oficiais
- [ ] Contato equipe (e-mail tipo `contato@eav7.com`)
- [ ] Market pair(s) com volume 24h mensurável
- [ ] Declaração honesta: N=7 fundação, sem auditoria externa, ponte fechada

### 3.2 CoinGecko

| Passo | Ação |
|---|---|
| Form | Request listing (asset + se aplicável “blockchain”) |
| Anexos | Pacote 3.1 + pool + screenshots explorer |
| Pós-merge | Verificar API CG e plugar no front (`/price` pode priorizar CG) |

### 3.3 CoinMarketCap

| Passo | Ação |
|---|---|
| Form | Apply for listing |
| Pré-requisito | Preferível já ter CG + volume estável |
| Dados | Mesmo pacote; CMC é rígido em circulating e markets |

### 3.4 Paralelos úteis (não bloqueiam CMC)

| Destino | Quando |
|---|---|
| DefiLlama (chain/TVL) | Se houver TVL DeFi mensurável |
| CoinPaprika / LiveCoinWatch | Depois de CG |
| Token terminal / analytics | Opcional |

**Critério de saída:** página CG ao vivo; CMC submetido ou ao vivo.

---

## Fase 4 — Distribuição e ecossistema

| # | Tarefa | Dependência |
|---|---|---|
| 4.1 | WalletConnect / deep links | Fase 1 |
| 4.2 | Guias MetaMask oficiais no site | Fase 1 |
| 4.3 | SDKs / exemplos dApp “Hello EAV7” | — |
| 4.4 | Operadores externos (sair de N=7) | Stake + docs `eav7-core` |
| 4.5 | Auditoria externa | Antes de TVL alto / bridge com valor |
| 4.6 | Ponte com valor | Só com adaptador + comitê + checklist (hoje fechada) |
| 4.7 | CEX | Depois de CG/CMC + compliance + volume |

---

## Fase 5 — Ritmo de comunicação

| Cadência | Conteúdo |
|---|---|
| Semanal | Status mainnet (height, âncoras, uptime) |
| Por marco | Merge Chainlist/ícone · abertura LBP · CG · CMC |
| Sempre | Roadmap honesto: o que está ligado / condicionado / ausente |

Canais: eavscan · GitHub Releases · X · Discord/Telegram · pitch PDF atualizado se números mudarem.

---

## O que NÃO fazer agora

- Submeter CMC/CG **sem** mercado e circulating claros  
- Prometer bridge, auditoria ou N=51 como se já existissem  
- Multiplicar RPCs públicos sem ownership/uptime  
- Alterar Chain ID / símbolo / decimals de display sem plano de migração  

---

## Quadro de donos (preencher)

| Área | Responsável |
|---|---|
| Ops / nós / RPC | |
| Front / explorer / price API | |
| Tokenomics / mercado / LBP | |
| Jurídico / oferta pública | |
| Growth / trackers / social | |

---

## Checklist da próxima sessão de trabalho

1. [ ] Deploy do front (para `/developers/networks#add-network` ir ao ar)
2. [ ] Rodar [`FASE1-QA.md`](./FASE1-QA.md) na MetaMask e Trust
3. [ ] Checar status dos PRs #3040 e #8591
4. [ ] Decidir mecanismo do 45% público (LBP vs pool vs venda) — **Fase 2**
5. [ ] Esboçar página “Market & supply” no eavscan

Quando a Fase 2 tiver dono e data de LBP/pool, a Fase 3 vira execução mecânica — não o contrário.
