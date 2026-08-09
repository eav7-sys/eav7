# O que falta

Em ordem de **risco**, não de esforço.

## 1. Explorador público — deploy adiado de propósito

Produção derrubada para fechar o stack **local** primeiro (ver
[docs/local.md](../local.md)). Subida fica para quando o local estiver verde.

**Trava:** ordem explícita para migrar ao deploy (`deploy/nodes.env` + scripts).

## 2. Comitar o que está solto

Trabalho da sessão de auditoria/melhorias já foi commitado na branch
`security-audit-fixes`. Restam só inventários locais (`deploy/nodes.env`) fora do git.

## 3. Crescimento da cadeia: 0,51 GB/dia

Um bloco **vazio** ocupa 5.863 bytes:

| Campo | Hex | Bytes |
|---|---:|---:|
| `pqSignature` | 3.228 | 1.614 |
| `pqPublicKey` | 1.860 | 930 |
| `publicKey` | 174 | 87 |
| `signature` | 96 | 48 |

A 1 bloco/s são **86.400 blocos/dia** → **0,51 GB/dia sem uma única transação**.

Dois agravantes:

- Assinaturas / material PQ no fio vão em **base64** (e `pqPublicKey` em PEM) —
  overhead ~33% sobre binário, não “hex = dobro”. O ganho grande do fork continua
  sendo **binário + não repetir** a chave em todo bloco.
- A `pqPublicKey` se repete em **todo** bloco, sendo que o conjunto de
  validadores tem no máximo 27 endereços — poderia ser referenciada, não copiada.

**Trava:** mudança de formato de bloco = fork + rollout coordenado.

## 4. Telas de contratos e conta/login

Duas das doze telas do desenho não existem. O login do desenho é maquete
(e-mail, senha, sessões, notificações) — precisa de decisão antes de virar
código.

**Trava:** decisão de produto. Ver [06-decisoes-abertas.md](06-decisoes-abertas.md).

## 5. ~20 componentes órfãos

Nenhuma página os importa. Lista verificada:

```
coming-soon  status-badge  top-bar  energy-gauge
blocks/blocks-live   txs/txs-live   validators/validators-live
address/holdings-panel   wallet/wallet-app
ui/hover-footer  ui/kv  ui/vortex  ui/social-icons
home/hero-experience  home/wallet-cta  home/explorer-preview
home/network-pulse  home/ink-band  home/moments  home/hero-wope
```

`home/network-stats.tsx` já foi removido nesta sessão (estava no git; volta com
`git revert` se necessário).

**Custo real de deixá-los:** `txs-live.tsx` foi editado nesta sessão para a
mudança de unidade **antes** de se perceber que estava morto. Esforço em código
que ninguém renderiza.

## 6. 404 de verdade

Só uma rota tem `not-found.tsx`. As telas de detalhe respondem **200** para
recurso que não existe, o que confunde buscador e cliente de API.

## 7. Busca com resultados agrupados

O dropdown do desenho agrupa por tipo e guarda histórico (`searchGroups`,
`it.isTok`, `it.isIcon`, `it.hasSub`). O atual é mais simples.

## 8. Resto da API nativa

Falta `transfers` por token e `energyLimit` por tipo de transação.

**Já entregue** da lista original: unidade de `/stats`, `tps`, `blockSeries`
(descartado — derivável do tempo de bloco constante, seria precisão falsa),
`name` em `/validators`, `size` em `/blocks` e `/block/:h`, `decimals` e
`createdAt` em `/tokens` (já existiam; o defeito estava no tipo do cliente).

**Excluído por decisão:** preço, ≈USD, variação 24h, capitalização, APR de
validador, "próxima eleição", metadados de token (descrição, redes sociais, selo
de verificado), aba DeFi, EAV1155.

## 9. Rollout dos forks dormentes

`BRIDGE_BREAKER_HEIGHT` e `AI_TEE_HEIGHT` estão na altura 100.000.000. Ativar
exige todos os validadores atualizados ao mesmo tempo.

**Trava:** produção de pé.

## 10. Aposentar o JavaScript

Enquanto os dois existirem, toda correção é dupla — nesta sessão foram quatro
lugares corrigidos duas vezes.

**Trava:** ordem explícita do dono do projeto, depois de o Rust validar em
produção e os vetores fecharem.

## 11. Trilha Core + SDK + carteira (descentralização)

Não compete com os itens 1–2 em risco imediato, mas é o caminho para sair de
N=3. Ordem e backlog:

- [08-descentralizacao-core-carteira.md](08-descentralizacao-core-carteira.md)
- [09-sdk-melhorias.md](09-sdk-melhorias.md)
- [10-mapa-integrado.md](10-mapa-integrado.md)
- [11-mapa-melhorias-projeto.md](11-mapa-melhorias-projeto.md) — mapa transversal
  (CI, wasm, vetores, paridade API, etc.)
