# Plano: Launch · checklist único (congelar desenho → implementar)

**Status:** aceito em desenho (2026-08-09) — **mapa mestre de launch/ops**  
**Premissa:** tese 12–20 está madura; **não** abrir plano de feature nova sem releitura deste doc.  
**Contexto:** lançamento (não relaunch); sem mainnet econômica ainda.  
**Código pendente:** o que programar e em que sprint → **[22-fechar-desenvolvimento.md](22-fechar-desenvolvimento.md)** (gênese só no T7).

## Em uma frase

Um único trilho: **gênese coerente → pacotes 12–20 na ordem → testnet/faucet → auditoria focada → mainnet**; vesting + bloco enxuto entram no escopo; EAV721/EAV-NS só se forem pitch.

## Congelamento

| Faz | Não faz (até G0 verde) |
|---|---|
| Implementar checklists dos planos linkados | Novo “plano 22” de feature por hype |
| Decisões já fechadas em [06](06-decisoes-abertas.md) | Holder gov, IA com poder, Tendermint, tip market |
| Adiados só via gates [15](15-longo-prazo-adiados.md) | Encher 51 nós fundação |

---

## Pacote A — Escopo que faltava (agora explícito)

### A1 — Vesting na gênese

- [ ] Generator popula **tabela de vesting** (cliff ≥ 12 meses nos buckets não-públicos) — whitepaper §12  
- [ ] Treasury / fundação / equipe **não** recebem supply líquido sem lock on-chain  
- [ ] Teste: gênese → vesting leaves no `stateRoot`; saque antes do cliff falha  
- [ ] Doc: tabela pública de buckets + cliffs  

### A2 — Bloco enxuto (PQ no fio) — **sim, no launch**

Fecha [06](06-decisoes-abertas.md) §3 / [05](05-pendencias.md) §3.

- [x] Formato de bloco: SPKI-base64 (não PEM) após `COMPACT_BLOCK_HEIGHT`  
- [x] **Omitir** `publicKey`/`pqPublicKey` no fio quando já vistas (`producer_keys` na cadeia)  
- [x] Medir: baseline + omit documentados em teste `tamanho_fio_bloco_ocioso_documentado`  

- [ ] Vetores de bloco atualizados; height = **0** na gênese (não fork tardio com usuários)  
- [ ] Spec curta em `docs/` ou anexo whitepaper §4/armazenamento  

### A3 — EAV721 e EAV-NS

| Se… | Então… |
|---|---|
| Entram no pitch de launch | Checklist mínimo: mint/transfer viewable no explorer + 1 guia portal; senão **não** anunciar |
| Não são pitch | **Fora** do G0 — só depois; tirar de homepage/hero |

Decisão default deste plano: **fora do G0** (foco EAV20-contrato + Âncora). Reabrir só com ordem explícita.

### A4 — Testnet + faucet

- [ ] Chain id testnet **72021** (ou o da config) com gênese = regras de launch  
- [ ] Faucet rate-limited (SDK já tem base — amarrar deploy)  
- [ ] Seeds / 1–2 peers públicos documentados  
- [ ] Script “primeira Âncora” + “primeiro EAV20 via factory”  
- [ ] Explorador apontando à testnet (local ou público)  

### A5 — Auditoria focada (não reauditar o universo)

Trilhos novos / amarrados no launch:

- [ ] Gov × witness ([14](14-governanca-ancora.md))  
- [ ] Multisig ops incl. `GOV_*`  
- [ ] Bridge breaker + committee ≥3 ([18](18-ponte-committee-breaker.md)) se ponte ligada  
- [ ] EAV20 factory / Managed (whitepaper §9.2)  
- [ ] Skip/miss **só** se C do [20](20-consenso-liveness-finality.md) entrar no mesmo release  

Entrega: lista de achados + testes de regressão; sem “AI audit theater” sem PoC.

---

## Pacote B — Ordem de implementação (ondas)

Cada onda = mergeable; não começar a seguinte se a anterior quebrar gênese/testes.

### Onda 0 — Gênese e heights

- [ ] Config launch: heights críticos = **0** (`PERMISSIONS_V2`, `GOVERNANCE`, `VOTING`, `STRICT_PRODUCER`, `STATEROOT`, `SLASHING`, `EAVM_CONTRACTS` / `VALUE`, fases IA 1–5 se pitch IA, `BRIDGE_*` conforme [18](18-ponte-committee-breaker.md))  
- [ ] `MAX_VALIDATORS = 51` ([17](17-set-51-banco-101.md))  
- [ ] **A1** vesting + **A2** bloco enxuto  
- [ ] `cargo test` / vetores verdes  

### Onda 1 — Âncora + gov

- [ ] [13](13-ancora-pq-multisig.md) B+C (onboarding M-of-N, witness)  
- [ ] [14](14-governanca-ancora.md) B (`GOV_*` em multisig, guarda witness)  
- [ ] [17](17-set-51-banco-101.md) B (`banco()` + UI depois se preciso)  
- [ ] Launch ops: **5–7** Âncoras, não 3  

### Onda 2 — Economia + consenso duro

- [ ] [12](12-gb-assinatura-livre.md) GB na gênese  
- [ ] [20](20-consenso-liveness-finality.md) B (strict/stateRoot/slash já na onda 0; skip = v1.1)  

### Onda 3 — EAVM / EAV20

- [ ] EAV20 B+C+D (Mínimo, Managed, factory, portal/explorer)  

### Onda 4 — IA (se pitch)

- [ ] [16](16-ia-oraculo-ops.md) B+C (+ D leve)  
- [ ] Se IA **não** for pitch de launch: heights IA podem ficar, mas UI/oráculo demo **opcional**  

### Onda 5 — Ponte (só se for oferecer cross-chain)

- [ ] [18](18-ponte-committee-breaker.md) checklist valor verde  
- [ ] Senão: ponte **off** na UI  

### Onda 6 — Testnet pública + auditoria

- [ ] **A4** faucet/testnet  
- [ ] **A5** auditoria focada  
- [ ] Freeze de gênese mainnet (mesmas regras que testnet estável)  

### Onda 7 — Mainnet

- [ ] 5–7 Âncoras · keys offline testadas · monitoring  
- [ ] Explorador + portal apontando produção  
- [ ] Anúncio honesto: N pequeno, descentralização em curso ([15](15-longo-prazo-adiados.md) G0)  

---

## Pacote C — Explicitamente depois (não G0)

- Cert de época ([13](13-ancora-pq-multisig.md) D)  
- Skip/miss consensus ([20](20-consenso-liveness-finality.md) C)  
- Light client / P2P auth / seeds DNS maduros ([15](15-longo-prazo-adiados.md))  
- EAV721 / EAV-NS (default)  
- App eleitor completo ([08](08-descentralizacao-core-carteira.md))  
- `eth_subscribe` / `eth_getStorageAt`  

---

## Definição de “maduro para mainnet”

| Critério | OK quando |
|---|---|
| Gênese | Vesting real + heights 0 + bloco enxuto medido |
| Consenso | 5–7 Âncoras M-of-N; strict + stateRoot + slash |
| Token | Factory EAV20 deploy+transfer na testnet |
| Taxa | GB (ou legado documentado se 12 atrasar — **preferir 12 na onda 2**) |
| Ponte | Off **ou** checklist 18 verde |
| Ops | Faucet testnet; runbooks Âncora; sem `.env` com owner |
| Audit | A5 sem P0 aberto |

## Riscos de escopo

| Risco | Mitigação |
|---|---|
| Expandir features no meio | Voltar a este doc; novo item só com decisão em 06 |
| Bloco enxuto atrasar tudo | Pode paralelizar com onda 1 em branch; **bloquear** mainnet sem A2 |
| Pitch EAV721 sem código | Default fora; hero sem mencionar |

## Ligação (índice dos planos de launch)

| # | Tema |
|---|---|
| [12](12-gb-assinatura-livre.md) | Taxa GB |
| [13](13-ancora-pq-multisig.md) | Âncora |
| [14](14-governanca-ancora.md) | Gov |
| [15](15-longo-prazo-adiados.md) | Pós-launch |
| [16](16-ia-oraculo-ops.md) | IA |
| [17](17-set-51-banco-101.md) | Set 51 |
| [18](18-ponte-committee-breaker.md) | Ponte |
| — | EAV20 (whitepaper §9.2) |
| [20](20-consenso-liveness-finality.md) | Consenso |
| **Este** | Ordem + A1–A5 |

Mapa: [10](10-mapa-integrado.md) · [11](11-mapa-melhorias-projeto.md)
