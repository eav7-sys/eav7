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
| [11-mapa-melhorias-projeto.md](11-mapa-melhorias-projeto.md) | Inventário transversal: Rust, JS, web, wasm, CI, deploy |

## Resumo em cinco linhas

1. A migração JS→Rust está **funcionalmente completa**: 34 rotas nos dois
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
- **Replicar a arquitetura de informação da TRON, não o desenho dela** — o design
  é nosso.
