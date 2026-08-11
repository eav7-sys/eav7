# Testnet local

Três processos Core: 1 validador + 2 ouvintes.

```bash
bash bin/eav7-testnet-up.sh --fresh
bash bin/eav7-testnet-demo.sh    # status/account do produtor
bash bin/eav7-testnet-down.sh
```

| | |
|---|---|
| Produtor | http://127.0.0.1:6070 |
| Ouvintes | :6071 · :6072 |
| Dados | `data/testnet/` |
| Endpoints | `data/testnet/endpoints.env` |

Compila `eav7-core` + `eav7-node` em debug. Cada nó tem carteira própria em
`data/testnet/nodeN/`. Detalhe do Core: [core.md](core.md).
