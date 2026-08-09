# Vetor de ciclo de vida — âncora / expulsão (G3)

## Invariante

Depois da **primeira** expulsão do gênese (`tail_start` passa de 0 → 1):

1. `base_state` contém as alocações da gênese (saldo + stake), não estado vazio.
2. `state_root(âncora + reaplicar janela) == state_root(estado corrente)`.

## Onde está a prova executável hoje

| Cliente | Teste |
|---|---|
| Rust | `ancora_da_primeira_expulsao_preserva_as_alocacoes_da_genese` em `rust/src/blockchain.rs` |
| JS | `slideTail` / `#slideTail` já tratava gênese; falta golden cruzado exportado |

## Próximo passo (ainda aberto)

Gerar `lifecycle-anchor.json` pelo pipeline `bin/eav7-vectors*.js` com:

- blocos serializados (gênese + N vazios),
- `stateRoot` esperado após expulsão,
- folhas da âncora,

e consumir nos dois clientes — mesma forma dos outros arquivos em `vectors/`.
