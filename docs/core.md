# EAV7 Core — operador local

Binário `eav7-core` (Fase A do [plano 08](plano/08-descentralizacao-core-carteira.md)):
qualquer pessoa sobe um nó sem ler o monorepo inteiro.

Celular **não** produz blocos. Core no PC/VPS verifica e, se quiser, produz.

## Build

```bash
cd rust
cargo build -p eav7-core -p eav7-node --release
# binários em target/release/eav7-core e eav7-node (mesmo diretório)
```

## Fluxo mínimo (ouvinte)

```bash
# 1) gera carteira + core.json (modo listen = não produz)
./target/release/eav7-core init --dir ./data/core-dev \
  --mode listen --port 6072 --allow-private-peers \
  --peers http://127.0.0.1:6070

# 2) sobe o nó (procura eav7-node ao lado / PATH / EAV7_NODE_BIN)
./target/release/eav7-core run --dir ./data/core-dev

# 3) outro terminal
./target/release/eav7-core status --dir ./data/core-dev
```

Com um minerador JS já no ar (`npm run dev:local` ou `node bin/eav7.js mine`),
o Core em **listen** sincroniza e serve API na porta configurada.

## Modos

| Modo | Comportamento |
|---|---|
| `listen` | Sync + API; sem `--validator` (não produz) |
| `candidate` | Carteira ligada; produz **se** estiver no top-27 |
| `validator` | Igual ao candidate (intenção operacional: VPS 24/7) |

Atalhos: `eav7-core listen|candidate|validator --dir …`

## Paths padrão (`init` sem `--dir`)

| SO | Diretório |
|---|---|
| Linux | `~/.eav7` |
| macOS | `~/Library/Application Support/EAV7` |
| Windows | `%APPDATA%\EAV7` |

Override: `EAV7_HOME=/caminho`.

## Serviço (Linux systemd)

Exemplo em [`deploy/eav7-core.service.example`](../deploy/eav7-core.service.example).

## Empacote multi-OS / CI de release

A1 (binários por alvo) e A7 (Actions por tag) vêm na próxima fatia.
Este MVP já fecha A2–A5 + guia local (A6 parcial).

## Relação com o stack local

Ver [local.md](local.md): `npm run dev:local` sobe JS + explorador; o Core Rust
é o caminho do **operador externo**, não substitui o minerador JS de desenvolvimento.
