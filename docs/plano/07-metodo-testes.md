# Três bugs, o mesmo ponto cego

Nenhum dos três foi achado pela suíte de testes. Os três apareceram **rodando o
nó**.

A causa é a mesma nos três: **o arranjo do teste monta a pré-condição que impede
a falha**, então o caso quebrado nunca é exercitado.

## Os três casos

### 1. Folha `unbond:queue`

Errada em dois eixos: usava `height` onde o protocolo diz `matureAt`, e emitia
tag de inteiro onde a referência emite texto.

892 testes verdes na época, porque **nenhum cobria a forma daquela folha**.
Provado byte a byte contra o `encodeCanonical` do JS.

### 2. Snapshot

Exigia a ponta da cadeia, então era **recusado em todo boot real**. Todos os
testes unitários passavam porque **todos gravavam na ponta**.

Só apareceu ao subir o nó de verdade. Corrigido com replay de cauda e dupla
verificação de raiz.

### 3. Âncora de estado

Os arranjos (`cadeia_saldo`) criam toda cadeia de teste com `base_state` já
preenchido e `tail_start` diferente de zero.

O caso real — primeira expulsão, `tail_start == 0`, âncora `None` — **nunca
rodou**. Era exatamente o que o `unwrap_or_default()` transformava em estado
vazio.

## Por que acontece

O arranjo é escrito por quem **já sabe** qual estado o código espera, então
fornece esse estado. O caminho onde o estado **ainda não existe** — boot, gênese,
primeira vez — é justamente o que produção executa e o teste pula.

## O que passou a ser feito

1. Ao mexer em código que lê estado acumulado, perguntar **"qual é a PRIMEIRA vez
   que isso roda?"** e escrever o teste a partir da gênese ou do vazio, não do
   arranjo pronto.

2. **Provar que o teste novo falha sem a correção.** O da âncora só virou prova
   depois de reverter a correção e vê-lo quebrar em
   `.expect("conta da gênese na âncora")`. Teste que passa nos dois estados não
   prova nada.

3. **Rodar o nó de verdade.** Continua achando o que a suíte não acha — três
   vezes seguidas, agora.

## Corolário

Um teste verde não é evidência de que o código está certo; é evidência de que o
código está certo **para o estado que o arranjo montou**. A pergunta útil não é
"há teste para isso?", e sim "o teste chega a construir a situação em que isso
quebra?".
