# Decisões abertas

Quatro coisas que não dá para decidir sem o dono do projeto.

## 1. Nó com âncora corrompida: derruba ou degrada?

**Resolvido (2026-08-09):** `panic!` em debug **e** release via
`Blockchain::ancora_corrompida`. Log em stderr + abort. Servir estado corrompido
é pior que o nó sair do ar.

## 2. Scripts de deploy vão para o repositório?

**Resolvido (opção 3):** scripts em `bin/eav7-deploy-*.sh` + inventário em
`deploy/nodes.env` (gitignored). Modelo: `deploy/nodes.example`. IPs de produção
não ficam no git.

## 3. Encolher o bloco vale um fork?

**Resolvido (2026-08-09):** **sim no launch** (gênese) — binário/compacto + referenciar chaves PQ; não adiável com operadores no ar.

Checklist: [21-launch-checklist.md](21-launch-checklist.md) A2 · medição em [05-pendencias.md](05-pendencias.md#3-crescimento-da-cadeia-051-gbdia).

## 4. O explorador tem contas?

O desenho traz login por e-mail e senha, sessões com dispositivo/IP/localização e
notificações não lidas.

Ou fazemos **autenticação de verdade**, ou **tiramos a tela**. Manter maquete de
login num explorador de blockchain é pior que não ter — quem tenta entrar e não
consegue conclui que o site está quebrado.

As regras condicionais dessas telas (`isLogged`, `notLogged`, `s.current`,
`a.unread`) foram deliberadamente não portadas por esse motivo.

## 5. Forma do botão primário

Pendência menor, mas continua aberta: pílula (atual) ou o retângulo de raio 10px
do desenho.

## 6. Modelo de taxa: energia+bandwidth vs GB único?

**Resolvido (2026-08-09):** ecossistema **GB · Assinatura Livre**.

- Uma cota: **1 GB/dia** = bytes úteis × `ENERGY_COST[tipo]`
- Assinaturas híbridas **não contam**
- Estouro queima (`5 e7` / byte ponderado); stake/app aumentam cota

Plano e checklist de fork: [12-gb-assinatura-livre.md](12-gb-assinatura-livre.md).

## 7. Âncora: multisig M-of-N desde o launch?

**Resolvido (2026-08-09):** sim — identidade fria = `owner` **2-de-3** híbrido; produção = `witness` quente; certificado de época = fase 2.

Plano: [13-ancora-pq-multisig.md](13-ancora-pq-multisig.md) (assenta em permissões v2).

## 8. Governança no launch: o que muda?

**Resolvido (2026-08-09):** Âncora (`owner`/multisig) propõe e vota; `witness` não; manter quórum/timelock/anti-brick; fora holder-gov, council com poder e IA com peso.

Plano: [14-governanca-ancora.md](14-governanca-ancora.md).

## 9. Longo prazo dos adiados?

**Resolvido em mapa (2026-08-09):** inventário consciente com portões G0–G∞ — não é compromisso de data.

Plano: [15-longo-prazo-adiados.md](15-longo-prazo-adiados.md).

## 10. IA no launch: o que priorizar?

**Resolvido (2026-08-09):** mercado de oráculos (A) usável + ops (B) sem poder; TEE/ZK honestos; `AI_TEE` depois; IA sem peso.

Plano: [16-ia-oraculo-ops.md](16-ia-oraculo-ops.md).

## 11. Quantas Âncoras?

**Resolvido (2026-08-09):** **51** ativas + banco até **101**; launch **5–7**; voto na gênese.

Plano: [17-set-51-banco-101.md](17-set-51-banco-101.md).

## 12. Ponte no launch?

**Resolvido (2026-08-09):** committee-attested com committee ≥3 + breaker ativo + 1 adapter; sem valor sem checklist; light client depois.

Plano: [18-ponte-committee-breaker.md](18-ponte-committee-breaker.md).

## 13. EAV20 = contrato ERC-20 na EAVM ou nativo `TOKEN_*`?

**Resolvido (2026-08-09):** produto EAV20 = **ERC20 na EAVM**; Mínimo + Managed + **factory no MVP**; decimals **6**; imutável; `TOKEN_*` = legado.

Decisão registrada no whitepaper §9.2 (produto = EAV20 na EAVM).

## 14. Melhorias de consenso (além do DPoS atual)?

**Resolvido (2026-08-09):** manter slot DPoS; launch com strict/stateRoot/slash + set 51; v1.1 skip/miss/downtime; cert época fase 2; sem Tendermint/VRF.

Plano: [20-consenso-liveness-finality.md](20-consenso-liveness-finality.md).

## 15. Checklist mestre de launch?

**Resolvido (2026-08-09):** um trilho — vesting + bloco enxuto + ondas 12–20 + testnet/faucet + audit; EAV721/NS fora do G0 por default.

Plano: [21-launch-checklist.md](21-launch-checklist.md).

## 16. Como fechar o código pendente sem se perder?

**Resolvido (2026-08-09):** trilhos T1–T7 + sprints S1–S6; **gênese-ativa só depois** do P0.

Plano: [22-fechar-desenvolvimento.md](22-fechar-desenvolvimento.md).
