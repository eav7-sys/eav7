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
| EAVM RPC | :7070 (`port + 1000`) |
| Dados | `data/testnet/` |
| Endpoints | `data/testnet/endpoints.env` |

Compila `eav7-core` + `eav7-node` em debug. Cada nó tem carteira própria em
`data/testnet/nodeN/`. Detalhe do Core: [core.md](core.md).

## Testnet pública (hub)

Chain ID **72021** · explorer amarelo · RPC próprio. Corre **junto** da mainnet
sem partilhar estado.

```bash
bash bin/eav7-deploy-testnet.sh
# re-gênese (apaga cadeia testnet no hub):
bash bin/eav7-deploy-testnet.sh --fresh-chain
```

| | |
|---|---|
| Explorer | https://testnet.eavscan.com |
| RPC EAVM | https://rpc-testnet.eavscan.com |
| Chain ID | `72021` (`0x11955`) |
| API local (hub) | `127.0.0.1:6170` |
| RPC local (hub) | `127.0.0.1:7170` |
| Web local (hub) | `:3001` |
| Dados | `/var/lib/eav7-testnet` |
| Binários | `eav7-*-testnet` (Cargo feature `testnet`) |

O seletor de rede no topo do site aponta para estes hosts.

Faucet: https://faucet-testnet.eavscan.com · **100 EAV7 / endereço / hora**
(carteira do produtor; `bash bin/eav7-deploy-faucet-testnet.sh`).

## E2E Public LBP (local)

Valida deploy → fund → `openLbp` → intent → **ops confirm mock** → `grant`
**sem tocar na mainnet** (artefactos só em `data/testnet/lbp-e2e/`).

```bash
npm run testnet:lbp-e2e
# ou: bash bin/eav7-lbp-e2e-local.sh --keep-testnet
```

Cobre o caminho on-chain EAV7 + relayer: intent → ops confirm → **`grant`** → **`release`**.
O comprador precisa de stake/energia suficiente para `release()` (o e2e usa 7000).
Não substitui o watcher de USDT real nas rails externas.

Portas default do e2e: **6270–6272** / EAVM **7270** (evita conflito com AnyDesk em :6070 no macOS).
