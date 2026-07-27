# Cadeia de referência para a prova de replay

Gerada pelo nó de REFERÊNCIA (JavaScript) por `bin/eav7-gerar-cadeia-replay.js`.
`rust/tests/replay.rs` a reproduz pelo caminho real (`adopt_genesis` + `add_block`)
e confere a raiz de estado E as folhas em CADA altura.

É o teste mais forte do porte: os vetores provam funções isoladas; este prova a
máquina inteira contra o estado que a rede de fato produz.

## Por que está commitada

O fixture era gerado sob demanda e o teste PULAVA quando ele faltava — ou quando
o modo de fork do binário não casava com o da cadeia. No build padrão isso fazia
o teste passar como "ok. 1 passed" sem comparar nada: o teste mais forte do porte
era, na prática, um no-op. Commitar torna a execução incondicional.

## Modo de fork

Esta cadeia usa as ALTURAS REAIS de fork (o build padrão). Por ser curta, não
alcança forks altos — o `raizes-esperadas.json` lista em `pulados` o que ficou de
fora, para o resultado não sugerir cobertura que não existe.

Para exercitar TODAS as regras (o cenário do relançamento, forks em 0):

    EAV7_GENESIS_ACTIVE=1 node bin/eav7-config-rs.js
    EAV7_GENESIS_ACTIVE=1 node bin/eav7-gerar-cadeia-replay.js /tmp/cadeia-replay
    EAV7_REPLAY_DIR=/tmp/cadeia-replay cargo test -p eav7 --test replay
    node bin/eav7-config-rs.js   # restaura o modo normal

## Regenerar este fixture

    node bin/eav7-gerar-cadeia-replay.js rust/tests/fixtures/cadeia-replay

As chaves são aleatórias a cada geração, então a cadeia muda por completo — o que
não é problema: o que o teste compara é a raiz que a REFERÊNCIA produziu para
ESTA cadeia, não um valor fixo.
