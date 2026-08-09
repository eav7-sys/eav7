# Estado atual

Quatro coisas que importam hoje.

| Frente | Estado | Detalhe |
|---|---|---|
| **Nó em Rust** | 982 testes verdes | Paridade de rotas completa com a referência. Roda, produz blocos e sobrevive ao deslize da janela de RAM. |
| **Referência JS** | 378 testes verdes | Mantida em passo com o Rust. Ainda é o que roda em produção — não pode divergir enquanto não for aposentada. |
| **Explorador** | 10 de 12 telas | Faltam contratos e conta/login. ~20 componentes antigos viraram código morto e continuam no repositório. |
| **Produção** | **fora do ar** | `eavscan.com` devolve 530. `eav7.com` responde 200. |

## A queda do explorador

```
$ curl -o /dev/null -w "%{http_code}" https://eavscan.com/
530

$ curl https://eavscan.com/status
error code: 1033
```

O erro **1033** do Cloudflare significa que a origem não está acessível — o túnel
não está conectado. As portas `6070` dos três validadores também não respondem
do ambiente onde este levantamento foi feito.

**O que não dá para afirmar daqui:** se os validadores estão fora do ar ou apenas
com firewall bloqueando o acesso externo. As duas hipóteses produzem o mesmo
silêncio na porta.

**O que dá para afirmar:** o site público está indisponível para qualquer
visitante, independentemente de qual das duas seja.

Nenhuma ação foi tomada sobre produção. Isso é decisão do dono do projeto.

## Árvore de trabalho

Nada foi comitado. O que está solto se separa em três blocos independentes:

| Bloco | Arquivos | Observação |
|---|---|---|
| Correção da âncora de estado | `rust/src/blockchain.rs` | É consenso. Deveria ir sozinho e primeiro. |
| API nativa | `rust/node/src/api/{chain,network}.rs`, `src/node/api.js` | Mudança de contrato nas duas implementações. |
| Frontend | 18 arquivos em `web-next/src` | Inclui a redesenhada inteira do explorador, ainda solta. |

Fora desses três: `deploy-eavscan-update.sh` e `redeploy-frontend.sh`, sem commit
e contendo os IPs dos três validadores — ver
[06-decisoes-abertas.md](06-decisoes-abertas.md).
