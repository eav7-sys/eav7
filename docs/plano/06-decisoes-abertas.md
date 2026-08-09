# Decisões abertas

Quatro coisas que não dá para decidir sem o dono do projeto.

## 1. Nó com âncora corrompida: derruba ou degrada?

**Hoje:** derruba em debug (`debug_assert!` dispara) e degrada calado em release
(`debug_assert!` vira no-op, a função devolve `false`, a janela para de deslizar).

O comentário do próprio código diz que **parar é melhor que seguir com uma âncora
errada, que produziria raiz errada em silêncio**. Só que em release ele não para.

**Se você concordar com o comentário:** viro `panic!` em release também.

**O que isso significa na prática:** nó que morre em vez de nó que serve dado
velho. Para um validador, servir estado corrompido é pior que sair do ar — mas é
uma escolha operacional, não técnica.

**Estado intermediário já aplicado:** o log agora grita dizendo o que parou, em
que altura e por quê. Antes era silêncio absoluto.

## 2. Scripts de deploy vão para o repositório?

`deploy-eavscan-update.sh` e `redeploy-frontend.sh` estão sem commit e contêm os
IPs dos três validadores de produção.

| Opção | Custo |
|---|---|
| Comitar | Expõe a topologia da rede a quem tiver acesso ao repositório |
| Não comitar | O deploy fica dependendo de uma máquina específica |
| Comitar com os IPs em variável de ambiente | Trabalho extra, mas resolve os dois |

Recomendação: a terceira.

## 3. Encolher o bloco vale um fork?

Trocar hex por binário e referenciar a `pqPublicKey` em vez de repeti-la em todo
bloco corta a maior parte dos **0,51 GB/dia** de crescimento com cadeia parada.

É mudança de formato de bloco: precisa de fork e de rollout coordenado, como os
dois já dormentes.

Ver [05-pendencias.md](05-pendencias.md#3-crescimento-da-cadeia-051-gbdia) para
a medição.

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
