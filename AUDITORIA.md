# Auditoria de segurança — EAV7 / protocolo eav20 + EAVM

## Atualização — auditoria da EAVM (Fase 2.2) + endurecimento de rede (em produção)

Rodadas adicionais focadas na EAVM (VM/host/precompiles) e em cibersegurança de rede
(Fable 5). A EAVM foi mantida **local** durante toda a auditoria e só promovida a
produção após **prova de compatibilidade de estado por replay** da cadeia viva (81k+
blocos carregados sem rejeição; `minted` idêntico ao nó vivo na mesma altura). Deploy
escalonado nos 3 validadores, convergência do mesmo head confirmada.

**Corrigido e em produção:** finalidade (anti-monopólio bizantino na janela de
grandfathering), SSRF/DNS-rebinding (peers gateados + revalidação de IP + filtro IPv6),
rate limit por loopback, teto de bytes no sync (anti-OOM), secp256k1 Jacobiano (ecrecover
~32× + reprecificado), memExpand amortizado O(n) (fim do DoS memcpy O(n²)), RIPEMD-160
puro (determinismo entre builds), atomicidade/journaling/gás da EAVM, escrow de IA/EAVM
ancorado no timestamp do bloco, chave de replay ≠ atestação na ponte.

**Residuais — exigem migração/hard fork coordenado (não hot-patch):**
- Hash de bloco inclui a assinatura ECDSA maleável — corrigir muda o hash de todos os
  blocos (hard fork). Não explorável no mesh fechado (peers gateados). Agendar upgrade.
- `BRIDGE_MIN_ATTESTATIONS = 1` (cofre vazio; elevar quórum antes de valor real).
- Endereço E7 em 14 bytes (112 bits; mudar quebra carteiras). merkleRoot sem separação
  de domínio (não explorável com txids únicos). Oráculo sem `UNSTAKE` (lacuna de feature).

Recomenda-se, para valor real significativo, auditoria externa profissional + upgrade
coordenado dos residuais de hard fork.

---

Duas rodadas de auditoria adversarial multi-agente (Claude **Fable 5**): cinco a seis
auditores independentes por rodada, cada achado **verificado por um agente que tenta
refutá-lo** lendo o código real. Só entram os que tiveram o caminho de exploração
confirmado no código.

- **Rodada 1** (núcleo do protocolo): 21 confirmados — todos corrigidos.
- **Rodada 2** (produção, cobrindo EAVM/operações nativas, carteira web, novos
  endpoints, remoção do faucet): **18 confirmados** — corrigidos abaixo.

Suíte atual: **33 testes** (`npm test`), verdes, incluindo regressões específicas das
correções, + smoke test end-to-end (produção de blocos, EAVM, stake, DoS, auth).

---

## Rodada 2 — correções de produção

### Crítico / Alto

| # | Achado | Severidade | Correção |
|---|--------|-----------|----------|
| 1 | **Double-payout da ponte**: o relayer repagava o mesmo BRIDGE_OUT enquanto o BRIDGE_SETTLE não era minerado. | crítico | `gateway.js`: Set `settling` (in-flight) marcado antes do payout + `tick()` não-reentrante. |
| 2 | **Halt permanente**: um UNSTAKE podia esvaziar o conjunto de validadores e travar a cadeia para sempre. | alto | `state.js`: UNSTAKE que zeraria os validadores é rejeitado. |
| 3 | **Trust-on-first-sync**: nó sem cadeia adotava qualquer gênese de um peer (roubo de supply/eclipse). | alto | `blockchain.js`: hash de gênese **fixável** (`--genesis-hash`) validado em `adoptGenesis`. |
| 4 | **Resync de nonce** descartava silenciosamente BRIDGE_IN/AI_RESULT após falha de rede. | alto | `gateway.js`/`worker.js`: reset de nonce em **qualquer** erro; reserva usa nonce ciente do mempool (`/address.nextNonce`). |
| 5 | **OOM no sync P2P**: peer anunciando altura enorme fazia o download crescer sem limite. | alto | `p2p.js`: teto `MAX_SYNC_BLOCKS` de blocos por ciclo. |
| 6 | **/security/alerts sem auth**: flood suprimia alertas reais. | alto | `api.js`: escrita exige `x-admin-token` (`EAV7_ADMIN_TOKEN`); sem token, negada. |
| 7 | **SSRF em /peers** (filtro só por hostname literal, bypass por DNS). | alto | `p2p.js`: resolução DNS e rejeição de **qualquer** IP privado/loopback/link-local. |
| 8 | **Chave privada em texto puro no localStorage**. | alto | `wallet.html`: chave **cifrada com senha** (PBKDF2 + AES-GCM, WebCrypto); fluxo de desbloqueio. |

### Médio / Baixo

| # | Achado | Correção |
|---|--------|----------|
| 9 | **Lookahead de +1 slot** permitia roubo de turno/censura entre validadores. | Removido o `+1`: bloco nunca pode exceder o slot do relógio local. |
| 10 | **Grinding do tamanho do conjunto de validadores** reordena o round-robin. | **Residual** (ver abaixo) — requer época/VRF. |
| 11 | **Reorg descartava transações órfãs** dos blocos revertidos. | `replaceChain` retorna as órfãs; o P2P as reinsere no mempool. |
| 12 | **EAVM_TRANSFER na rota híbrida** com `to` nulo queimava fundos. | `transaction.js`: EAVM_TRANSFER só é válido via esquema EAVM. |
| 13 | **STAKE via EAVM criava "validador" sem chave** (slots pulados, grief). | `state.js`: contas mapeadas de EAVM são excluídas do conjunto de validadores. |
| 14 | **GET /address/:a/txs** varria a cadeia inteira sem paginação (DoS de CPU). | Paginação `?before=` + teto `MAX_TX_SCAN`. |
| 15 | **produceBlock** validava o próprio bloco contra o próprio timestamp (checagens nulas). | Passa `now = Date.now()` real. |
| 16 | **Endereço E7 de 112 bits** (abaixo dos 128+ recomendados). | **Residual** (ver abaixo) — decisão de design, consensus-critical. |
| 17 | **Inteiros de entrada** malformados geravam exceções (RangeError/TypeError). | Validação em `eth_feeHistory` e nas rotas `/txs` (`intParam`). |
| 18 | **innerHTML sem escape** na carteira. | `wallet.html`: `esc()` na saída + validação do formato do id. |

**Produção — removido tudo "de graça":** faucet (`POST /faucet`, CLI, UIs) e geração de
chaves no servidor (`POST /wallet/new`) foram **removidos** — retornam 404. Chaves
são geradas só no cliente ou pela CLI local.

---

## Limitações residuais (exigem trabalho antes de mainnet real)

As correções fecham os vetores confirmados **no código atual**, mas ainda é um
**protótipo funcional**. Antes de custodiar valor real:

1. **Descentralização da ponte** — hoje a liberação depende de allowlist de relayers
   confiáveis. Produção exige **quórum M-de-N** + **prova leve (light-client/merkle)**
   do depósito de origem, com slashing.
2. **Finalidade de consenso e eleição** — fork-choice ainda é "cadeia mais longa"
   (limitada por slots); a eleição round-robin é sensível a grinding do tamanho do
   conjunto (#10). Produção pede **época com snapshot de validadores + VRF/semente
   fixada** e **finalidade com slashing**.
3. **Verificação de resultado de IA** — o oráculo designado remove o roubo de escrow,
   mas a *correção* do output não é verificada on-chain (quórum/disputa é o próximo passo).
4. **Comprimento de endereço (112 bits)** — abaixo dos 160 bits de BTC/ETH; sem
   exploração viável hoje, mas recomenda-se 20 bytes numa futura versão do protocolo.
5. **Low-s canônico (EIP-2)** no caminho híbrido — o id-por-payload já neutraliza a
   maleabilidade de txid; normalizar low-s é endurecimento adicional.
6. **TLS/CSP** — servir sempre por https (o túnel já entrega); adotar CSP exigirá
   mover scripts inline para arquivos externos com nonce.
7. **Auditoria externa independente + bug bounty** antes de valor real — nada substitui.

> Documento gerado no commit correspondente. Reexecute a auditoria após mudanças
> relevantes.
