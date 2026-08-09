# Desenvolvimento local — pronto para subir depois

Stack completa na máquina, sem depender de eavscan/produção.
Deploy fica para quando o local estiver verde (ver `deploy/`).

## Atalho (recomendado)

```bash
# Terminal 1 — nó JS + explorador Next apontando a ele
bash bin/eav7-dev-up.sh
```

### Core Rust (operador / ouvinte)

```bash
cd rust && cargo build -p eav7-core -p eav7-node
./target/debug/eav7-core init --dir ../data/core-dev --mode listen \
  --port 6072 --allow-private-peers --peers http://127.0.0.1:6070
./target/debug/eav7-core run --dir ../data/core-dev
```

Detalhe: [core.md](core.md).

Abre:

| Serviço | URL |
|---|---|
| API / mineração | http://127.0.0.1:6070 |
| Explorador (Next) | http://127.0.0.1:3000 |

Ctrl+C encerra o nó e o Next juntos.

## Peças soltas

### Nó JS (referência / produção atual)

```bash
node bin/eav7.js mine --port 6070 --data ./data/dev-local
```

### Nó Rust / Core

```bash
cd rust && cargo build -p eav7-core -p eav7-node
# preferível — ver docs/core.md
./target/debug/eav7-core init --dir ../data/core-dev --mode listen \
  --port 6072 --allow-private-peers --peers http://127.0.0.1:6070
./target/debug/eav7-core run --dir ../data/core-dev

# ou eav7-node direto
./target/debug/eav7-node --port 6071 --data ../data/dev-rust \
  --peers http://127.0.0.1:6070
```

`EAV7_GENESIS_ACTIVE` no Rust é **build-time**. Se mudar o modo de fork:

```bash
# regenera rust/src/config.rs e recompila
EAV7_GENESIS_ACTIVE=1 node bin/eav7-config-rs.js
cd rust && cargo build -p eav7-node
# restaura o modo padrão depois
node bin/eav7-config-rs.js
```

### web-next sozinho

```bash
cp web-next/.env.example web-next/.env.local   # se ainda não existir
cd web-next && npm run dev
```

| Variável | Local típico |
|---|---|
| `NEXT_PUBLIC_API_BASE` | `/api` (browser → rewrite) |
| `EAV7_API_ORIGIN` | `http://127.0.0.1:6070` (SSR + rewrite) |
| `NEXT_PUBLIC_USE_MOCK` | omitir ou `false` |

Em development o default de `NEXT_PUBLIC_API_BASE` é `/api` (não mais eavscan).

### Testnet 3 nós / faucet

Ver [testnet.md](testnet.md).

## Paridade API JS ↔ Rust (G5)

Sobe os dois nós sobre a **mesma** cadeia fixture, diffa rotas estáveis, derruba:

```bash
bash bin/eav7-api-parity-boot.sh
```

Ou, com nós já no ar:

```bash
bash bin/eav7-api-parity.sh http://127.0.0.1:6070 http://127.0.0.1:6071
```

## Verificação completa

```bash
npm test
bash bin/eav7-verificar.sh          # JS + Rust + clippy + vetores
cd web-next && npm run build
```

## Deploy (depois)

1. Copie `deploy/nodes.example` → `deploy/nodes.env` e preencha IPs (arquivo gitignored).
2. Build local do front: `cd web-next && npm run build` (+ copiar static/public no standalone, ver script).
3. `bash bin/eav7-deploy-eavscan.sh` (ou `redeploy-frontend` equivalente).

Nada de IP de produção no repositório — ver [06-decisoes-abertas.md](plano/06-decisoes-abertas.md) §2.
