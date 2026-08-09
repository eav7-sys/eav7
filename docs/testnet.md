# EAV7 — Testnet e gênese-ativo

Ambiente para ensaiar o gênese novo com **todas as features do bloco 0** antes do relaunch
real. É o mesmo modo que a mainnet nova vai usar.

## Atalho local (recomendado)

```bash
# 3 validadores JS + faucet (+ Core Rust opcional + demo stake)
bash bin/eav7-testnet-up.sh --fresh
bash bin/eav7-testnet-up.sh --fresh --with-core --demo

bash bin/eav7-testnet-down.sh
```

| Serviço | URL padrão |
|---|---|
| Nós | http://127.0.0.1:6070 … 6072 |
| Faucet | http://127.0.0.1:16090/ (`POST /faucet`) |
| Core (com `--with-core`) | http://127.0.0.1:6073 |

Dados em `data/testnet/` (gitignored). Endpoints gravados em `data/testnet/endpoints.env`.

Com `--with-core`, o script compila o Rust em **gênese-ativo**, sobe o `eav7-core`
em listen e restaura `rust/src/config.rs` ao modo padrão (o flag fica só no binário).
`--demo` faz faucet → `stake 1000` → `set-mode candidate` e mostra `score`.

npm: `npm run testnet:up` / `testnet:down` / `testnet:demo`.

## Gênese-ativo

`EAV7_GENESIS_ACTIVE=1` zera todas as alturas de fork (`FORK_HEIGHTS` em `config.js`), então
stateRoot (#1), finalidade BFT (#2), ponte trustless (#3), votação (#4), multisig (#5),
recursos (#6), governança (#9), timelock+poda (a), slashing+unbonding (b) e rotação de
comitê (d) ficam **ativos desde a altura 0**. Sem o flag, a cadeia usa as alturas de fork
padrão (a cadeia atual segue intacta).

No cliente **Rust** o mesmo flag é **build-time** (`GENESIS_ACTIVE_BUILD`): compile com
`EAV7_GENESIS_ACTIVE=1 node bin/eav7-config-rs.js && cargo build`, rode com
`EAV7_GENESIS_ACTIVE=1`, e restaure o `config.rs` depois se não quiser sujar o git.

## Passo a passo manual

### 1) Gerar a gênese

```
EAV7_GENESIS_ACTIVE=1 node bin/eav7-genesis.js ./testnet-genesis 3
```

### 2) Subir os nós

```
EAV7_GENESIS_ACTIVE=1 node bin/eav7.js mine \
  --port 6070 --data ./data/node-A --genesis ./testnet-genesis/genesis.json \
  --genesis-hash <hash> \
  --validator ./testnet-genesis/validator-0-wallet.json \
  --peers http://127.0.0.1:6071,http://127.0.0.1:6072 \
  --allow-private-peers
```

Repita nas portas 6071/6072.

### 3) Faucet

```
EAV7_FAUCET_ENABLED=1 EAV7_NODE_URL=http://127.0.0.1:6070 \
  EAV7_FAUCET_KEY=./testnet-genesis/treasury-wallet.json PORT=16090 \
  node bin/eav7-faucet.js
```

### 4) Core candidato

Ver [core.md](core.md) — ou use `--with-core --demo` acima.

## Cobertura automatizada

`node --test` inclui integração multi-validador in-process. Rode antes de qualquer
deploy da rede nova.
