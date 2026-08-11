# Plano da migração EAV7 para Rust

Levantado em **2026-07-28**, branch `security-audit-fixes`.

Os números vêm de medição direta do repositório e das suítes (`cargo test
--workspace`, `node --test`, contagem de linhas, comparação de rotas entre os
dois clientes) — não de estimativa. Onde não há medição, o texto diz que não há.

## Índice

| Arquivo | O que traz |
|---|---|
| [01-estado-atual.md](01-estado-atual.md) | As quatro coisas que importam hoje, incluindo a queda do explorador |
| [02-fases.md](02-fases.md) | O caminho em seis fases e por que estamos na quarta |
| [03-entregue.md](03-entregue.md) | O que já está de pé, com linhas e cobertura |
| [04-sessao-atual.md](04-sessao-atual.md) | As correções desta sessão, com a prova de cada uma |
| [05-pendencias.md](05-pendencias.md) | O que falta, em ordem de risco |
| [06-decisoes-abertas.md](06-decisoes-abertas.md) | O que depende de decisão sua |
| [07-metodo-testes.md](07-metodo-testes.md) | O ponto cego que já produziu três bugs |
| [08-descentralizacao-core-carteira.md](08-descentralizacao-core-carteira.md) | Plano: EAV7 Core + carteira mobile (eleitor) |
| [09-sdk-melhorias.md](09-sdk-melhorias.md) | Backlog do `eav7-sdk` (Rust) amarrado ao Core/app |
| [10-mapa-integrado.md](10-mapa-integrado.md) | Ordem única: migração + SDK + Core + descentralização |
| [11-mapa-melhorias-projeto.md](11-mapa-melhorias-projeto.md) | Inventário transversal: Rust, protocolo, web, wasm, CI, deploy |
| [12-gb-assinatura-livre.md](12-gb-assinatura-livre.md) | **Fork:** taxa unificada em GB (dados × ação); assinatura fora da conta |
| [13-ancora-pq-multisig.md](13-ancora-pq-multisig.md) | **Produto + fases:** Âncora = owner M-of-N PQ, witness quente, cert de época |
| [14-governanca-ancora.md](14-governanca-ancora.md) | **Lançamento:** gov só via owner/multisig; witness sem poder; sem holder/council/IA-voto |
| [15-longo-prazo-adiados.md](15-longo-prazo-adiados.md) | **Pós-launch:** o que ficou fora, com gates G0–G∞ e quando revisitar |
| [16-ia-oraculo-ops.md](16-ia-oraculo-ops.md) | **IA:** oráculo usável no launch; ops sem poder; TEE honesto; attester depois |
| [17-set-51-banco-101.md](17-set-51-banco-101.md) | **Set:** 51 Âncoras ativas + banco até 101; launch 5–7 |
| [18-ponte-committee-breaker.md](18-ponte-committee-breaker.md) | **Ponte:** committee ≥3, breaker on, 1 adapter; sem trustless; light client depois |
| *(removido)* | **EAV20:** contrato ERC-20 na EAVM (Mínimo/Managed + factory); decimals 6; `TOKEN_*` legado — ver whitepaper §9.2 |
| [20-consenso-liveness-finality.md](20-consenso-liveness-finality.md) | **Consenso:** heights 0, skip/miss v1.1, downtime leve; sem Tendermint |
| [21-launch-checklist.md](21-launch-checklist.md) | **Mestre launch:** vesting, bloco, ondas 0–7, testnet/audit |
| [22-fechar-desenvolvimento.md](22-fechar-desenvolvimento.md) | **Execução:** o que falta programar (T1–T7 / S1–S6); gênese só no fim |

## Resumo em cinco linhas

1. A migração protocolo→Rust está **funcionalmente completa**: 34 rotas nos dois
   clientes, quatro crates, 982 testes verdes.
2. O explorador público está **fora do ar** (Cloudflare 530/1033).
3. Estamos na **fase 4 de 6** — explorador e API nativa.
4. Um bug de consenso na âncora de estado foi achado e corrigido nesta sessão;
   ele teria produzido raiz errada em silêncio num reorg.
5. Nada será comitado, implantado ou apagado sem sua ordem explícita.

**Trilha nova (descentralização):** SDK (fase S) → Core multiplataforma → app
eleitor — ver [10-mapa-integrado.md](10-mapa-integrado.md).

**Mapa do projeto todo (melhorias):** ver
[11-mapa-melhorias-projeto.md](11-mapa-melhorias-projeto.md) — inclui o que
ainda não estava nos planos 08–10 (CI, wasm na carteira, vetores de âncora,
paridade de API, RAM dos índices, um frontend só).

## Restrições permanentes

- **Sem gambiarra.** Solução nativa, mesmo quando dá mais trabalho. A migração
  existe justamente para dar robustez ao projeto.
- **A cadeia só será limpa** após confirmação explícita de que o desenvolvimento
  está 100% concluído.
- **Nunca inventar preço ou capitalização.** Preço num explorador é dado
  financeiro; número fabricado vira decisão de compra tomada em cima de ficção.
  Fica de fora até existir oráculo de verdade.
- **Arquitetura de informação própria** — o design do produto e da documentação é nosso.
