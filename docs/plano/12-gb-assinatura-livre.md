# Plano: GB da rede · Assinatura Livre

**Status:** aceito em desenho (2026-08-09) — implementação = fork  
**Substitui:** modelo anterior de energia + bandwidth separados (`rust/src/state/recursos.rs`)

## Em uma frase

Uma barra só (**GB**): `dados_úteis × fator_da_ação`.  
Assinaturas híbridas **não entram** na conta. Estouro **queima** EAV7.

## Decisão

| Item | Escolha |
|---|---|
| Unidade UX | **GB** (bytes ponderados / 10⁹) |
| Cota base | **1,00 GB/dia** por endereço |
| Fórmula | `consumo = (len(tx) − len(sigs)) × ENERGY_COST[tipo]` |
| O que sai do len | só `signature` + `pqSignature` (chaves públicas **ficam**) |
| Fator | reusa `ENERGY_COST` atual (1 / 5 / 10 …) |
| Overflow | `5 e7 × bytes_ponderados` (igual `BURN_PER_BYTE` de hoje) |
| Stake boost | **+1 MB/dia por 1 EAV7 staked** |
| Regeneração | janela `86_400` blocos (igual hoje); **não acumula** sem teto |
| Destino da taxa | **100% burn** (validador não recebe) |
| Patrocínio | conta/app pode ceder GB a outro endereço (teto/dia a definir na impl.) |
| Piso anti-dust | mínimo **1_024** bytes ponderados por tx |

## Números de referência (medidos / derivados)

Crypto no fio (constantes em `rust/src/signature.rs`):

| Peça | Bytes |
|---|---:|
| ML-DSA-44 sig + ECDSA (Base64) | ~3 324 |
| Chaves públicas (PEM fixture) | ~2 034 |
| TRANSFER miolo (sem sig) | ~2 016–2 250 |
| TRANSFER completa | ~5 300–5 600 |
| Assinatura / tx completa | **~60%** |

Com 1 GB/dia e fatores = energia atual:

| Tipo | Ponderado (aprox.) | Tx/dia no 1 GB | Burn se cota = 0 |
|---|---:|---:|---:|
| TRANSFER | ~2 016 | ~496 000 | ~0,010 EAV7 |
| EAVM_CALL (+1 KB) | ~15 200 | ~66 000 | ~0,076 EAV7 |
| AI_TASK (+4 KB) | ~30 560 | ~33 000 | ~0,153 EAV7 |
| EAVM_DEPLOY (~12 KB) | ~140 160 | ~7 100 | ~0,70 EAV7 |

Recarga: **5 EAV7 → +1 MB** naquele dia (inverso do burn/byte).

## Por que fork

Muda apuração de taxa e estado de recursos (duas barras → uma).  
Nós com regras diferentes divergem em `stateRoot`.

**Constante nova (proposta):** `GB_FEE_HEIGHT` em `rust/src/config.rs`  
(default distante tipo `100_000_000` até rollout; ou **0 / gênese** no lançamento — não há mainnet econômica a migrar).

Abaixo do height: comportamento atual.  
No height e acima: só o trilho GB.

## Trilha de mudança (checklist)

### A — Spec / docs
- [x] Decisão registrada neste plano
- [x] Whitepaper §7 reescrito (EN + PT) com fórmula + tabela
- [x] Portal `/developers/concepts/resources` alinhado ao GB
- [x] `docs/api.md` / campos de conta (`gb` + legado energy/bandwidth)

### B — Protocolo (`eav7`)
- [x] `config.rs`: `GB_DAILY_BYTES`, `GB_PER_STAKED_EAV7_MB`, `GB_MIN_WEIGHTED`, `GB_FEE_HEIGHT`; deprecar uso dual após fork
- [x] `state/recursos.rs`: `peek_gb` / `commit_gb`; `canonical_tx_bytes` **excluindo** sigs; `taxa_de` unificada
- [x] Conta: campos `gb_used` / `gb_block` (gênese limpa no lançamento; sem migração de usuários)
- [x] `DELEGATE_RESOURCE` cede GB via `resource_units` / `max_gb` (sem `SPONSOR_GB` novo — teste `delegate_resource_aumenta_cota_gb_do_receptor`)
- [x] Testes: transfer sem burn dentro da cota; sig não altera consumo; stake aumenta cota (API)
- [ ] Vetores em `vectors/` se a taxa entrar em fixtures de estado

### C — Nó / API
- [x] `/address/:id` expõe cota GB (legado energy/bandwidth mantido)
- [ ] Mempool: rejeitar com mensagem clara se `feeLimit` < burn projetado

### D — SDK / Core / carteira
- [x] `eav7-sdk::Conta` com `gb` / `gb_remaining`
- [x] `eav7-core account` mostra barra GB
- [ ] Carteira web: uma barra “GB hoje”; CTA stake / recarga

### E — Rollout
- [ ] Mesmo `GB_FEE_HEIGHT` em todos os validadores (ver `docs/rollout-forks.md`)
- [ ] Preferível na **gênese do lançamento** (ninguém usou em produção econômica — amadurecendo, não migrando)
- [ ] Só se já houver chain viva com valor: anunciar height + janela; explorador mostra countdown

## Fora de escopo (de propósito)

- Tip / fee market para o produtor  
- Loja de “pacotes ouro/diamante” como produto principal  
- Cobrar bytes de assinatura PQ  

Longo prazo / se revisitar: [15](15-longo-prazo-adiados.md) (E3, E4, A4).

## Ligação

- Código atual: `rust/src/state/recursos.rs`, `rust/src/config.rs` (`energy` / `bandwidth`)  
- Whitepaper atual §7 (EN/PT) — a substituir  
- Mapa: [10-mapa-integrado.md](10-mapa-integrado.md) · melhorias: [11-mapa-melhorias-projeto.md](11-mapa-melhorias-projeto.md) · adiados: [15](15-longo-prazo-adiados.md)
