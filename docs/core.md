# EAV7 Core — operador local

Binário `eav7-core` ([plano 08](plano/08-descentralizacao-core-carteira.md) Fases A+B):
qualquer pessoa sobe um nó e opera stake/candidatura sem ler o monorepo.

Celular **não** produz blocos. Core no PC/VPS verifica e, se quiser, produz.

## Build

```bash
cd rust
cargo build -p eav7-core -p eav7-node --release
# binários em target/release/eav7-core e eav7-node (mesmo diretório)
```

Release por tag (`v*`) ou **Actions → release-core → Run workflow**:
[`.github/workflows/release-core.yml`](../.github/workflows/release-core.yml)
publica tarball/zip + `.sha256` (Linux x64, Linux arm64, macOS arm64, **Windows x64**
com `eav7-core.exe` / `eav7-node.exe`).

Pacote só nesta máquina: `bash bin/eav7-package-core.sh 0.1.0` → `rust/dist/`.
Go-live completo: [go-live.md](go-live.md).

## Fluxo mínimo (ouvinte)

```bash
./target/release/eav7-core init --dir ./data/core-dev \
  --mode listen --port 6072 --allow-private-peers \
  --peers http://127.0.0.1:6070
./target/release/eav7-core run --dir ./data/core-dev
./target/release/eav7-core status --dir ./data/core-dev
./target/release/eav7-core health --dir ./data/core-dev
```

Com um minerador JS já no ar (`npm run dev:local`), o Core em **listen** sincroniza.

## Candidatura (Fase B)

Precisa de saldo na carteira do Core (faucet/testnet ou transferência).

```bash
# ver saldo / stake / unbonding / se já atingiu o mínimo
eav7-core account --dir ./data/core-dev

# stake (valores em EAV7; ≥ 1000 para entrar na eleição)
eav7-core stake --dir ./data/core-dev --amount 1000 --wait

# gravar modo candidate e subir produzindo se eleito
eav7-core set-mode candidate --dir ./data/core-dev
eav7-core run --dir ./data/core-dev

# desempenho da lista (marca a sua carteira)
eav7-core score --dir ./data/core-dev

eav7-core unstake --dir ./data/core-dev --amount 100 --wait
eav7-core claim --dir ./data/core-dev --validator E7… --wait
```

`--url` aponta a outro nó se a API não for a porta do `core.json`.

## Modos

| Modo | Comportamento |
|---|---|
| `listen` | Sync + API; sem `--validator` (não produz) |
| `candidate` | Carteira ligada; produz **se** estiver no top-27 |
| `validator` | Igual ao candidate (intenção: VPS 24/7) |

Atalhos de run: `eav7-core listen|candidate|validator --dir …`

## Chaves (B4 — prática)

- **Hot** no servidor: `validator-wallet.json` (modo 0600) — só o necessário para assinar blocos.
- **Tesouro / seed**: fora do VPS; nunca no mesmo disco que o Core de produção.
- `init --force` regenera carteira — faça backup antes.

## Paths padrão (`init` sem `--dir`)

| SO | Diretório |
|---|---|
| Linux | `~/.eav7` |
| macOS | `~/Library/Application Support/EAV7` |
| Windows | `%APPDATA%\EAV7` |

Override: `EAV7_HOME=/caminho`.

## Serviço

| SO | Doc / unit |
|---|---|
| Linux | [`deploy/eav7-core.service.example`](../deploy/eav7-core.service.example) |
| macOS | [`deploy/eav7-core.launchd.plist.example`](../deploy/eav7-core.launchd.plist.example) |
| Windows | [`deploy/eav7-core.windows-service.md`](../deploy/eav7-core.windows-service.md) |

## Relação com o stack local

Ver [local.md](local.md): `npm run dev:local` sobe JS + explorador; o Core Rust
é o caminho do **operador externo**.
