# EAV7 — Testnet e gênese-ativo

Ambiente para ensaiar o gênese novo com **todas as features do bloco 0** antes do relaunch
real. É o mesmo modo que a mainnet nova vai usar.

## Gênese-ativo

`EAV7_GENESIS_ACTIVE=1` zera todas as alturas de fork (`FORK_HEIGHTS` em `config.js`), então
stateRoot (#1), finalidade BFT (#2), ponte trustless (#3), votação (#4), multisig (#5),
recursos (#6), governança (#9), timelock+poda (a), slashing+unbonding (b) e rotação de
comitê (d) ficam **ativos desde a altura 0**. Sem o flag, a cadeia usa as alturas de fork
padrão (a cadeia atual segue intacta).

## 1) Gerar a gênese

```
EAV7_GENESIS_ACTIVE=1 node bin/eav7-genesis.js ./testnet-genesis 3
```
Cria `genesis.json`, `treasury-wallet.json` e `validator-N-wallet.json`, e imprime o
**hash da gênese** — fixe-o como `expectedGenesisHash` em todos os nós.

## 2) Subir os nós (localmente ou nos servidores)

Cada nó roda com o flag e adota a mesma `genesis.json` (mesmo hash fixado):

```
EAV7_GENESIS_ACTIVE=1 node bin/eav7.js mine \
  --port 6070 --data ./data/node-A --genesis ./testnet-genesis/genesis.json \
  --validator ./testnet-genesis/validator-0-wallet.json \
  --peers http://127.0.0.1:6071,http://127.0.0.1:6072
```
Repita nas portas 6071/6072 com `validator-1/2` e `--peers` apontando aos outros. Os 3
convergem no mesmo head (finalidade BFT engaja com ≥3 validadores).

## 3) Faucet (opcional)

```
EAV7_FAUCET_ENABLED=1 EAV7_NODE_URL=http://127.0.0.1:6070 \
  EAV7_FAUCET_KEY=./testnet-genesis/treasury-wallet.json PORT=6090 node bin/eav7-faucet.js
```

## 4) Ensaiar as features

Com o SDK (`docs/api.md`) ou a CLI, exercite antes do relaunch: staking + votação de
validador, uma proposta de governança (ver o timelock aplicar), delegação de recurso,
uma conta multisig, e a ponte com prova de comitê + uma rotação de comitê. O teste
`test/integration.test.js` já faz um passe automatizado disso in-process.

## Cobertura automatizada

`node --test` roda toda a suíte, incluindo o teste de integração que dirige uma cadeia real
multi-validador com stateRoot + votação + governança/timelock + finalidade + replay
determinístico. Rode-o antes de qualquer deploy da rede nova.
