# Desenvolvimento local — Core + Next

## Atalho

```bash
bash bin/eav7-dev-up.sh
# ou: npm run dev:local

bash bin/eav7-testnet-up.sh --fresh
```

| Serviço | URL |
|---|---|
| API (Core) | http://127.0.0.1:6070 |
| Explorador | http://127.0.0.1:3000 |

## Core / eav7-node

```bash
cd rust && cargo build -p eav7-core -p eav7-node
./target/debug/eav7-core init --dir ../data/core-dev --mode listen \
  --port 6072 --allow-private-peers --peers http://127.0.0.1:6070
./target/debug/eav7-core run --dir ../data/core-dev
```

Ver [`docs/core.md`](core.md).

Parâmetros de consenso: edite `rust/src/config.rs` e recompile.
`GENESIS_ACTIVE_BUILD` e alturas de fork são **build-time**.

## web-next

```bash
cp web-next/.env.example web-next/.env.local
cd web-next && npm run dev
```

| Variável | Local típico |
|---|---|
| `NEXT_PUBLIC_API_BASE` | `/api` |
| `EAV7_API_ORIGIN` | `http://127.0.0.1:6070` |
| `NEXT_PUBLIC_USE_MOCK` | omitir ou `false` |

## Testnet

Ver [testnet.md](testnet.md).

## Harness multi-nó

```bash
cd rust && cargo test -p eav7-node --test multi_node
```

## Verificação

```bash
cd rust && cargo test --workspace
cd web-next && npm run build
npm run verificar
```

## Deploy

[`go-live.md`](go-live.md):

```bash
bash bin/eav7-deploy-eavscan.sh --from-release v0.1.0
```
