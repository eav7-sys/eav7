# Go-live — subir eavscan + Core

Checklist operacional depois do trabalho local. Código G1–G21 / A4 está no
branch; o que falta para **subir** é remoto GitHub, tag de release e deploy.

## 0. Pré-voo (máquina local)

```bash
bash bin/eav7-go-live-check.sh --full
# ou a suíte completa:
npm run verificar
cd web-next && npm run build
```

Working tree limpa · `deploy/nodes.env` com IPs reais · chave SSH ·
`rust/src/config.rs` em modo **padrão** (não gênese-ativo de testnet).

## 1. GitHub + Release Core (inclui Windows `.exe`)

Este clone **precisa** de um remote. Sem ele o Actions não publica binários.

```bash
# uma vez (ajuste a URL do repo)
git remote add origin git@github.com:ORG/eav7.git
git push -u origin security-audit-fixes   # ou main após merge

# release: tag v* dispara .github/workflows/release-core.yml
# (Linux x64, Linux arm64, macOS arm64, Windows x64)
git tag v0.1.0
git push origin v0.1.0
```

Ou, no GitHub Actions: **Run workflow** `release-core` com input `tag=v0.1.0`.

Artefatos esperados na Release:

| Arquivo | Plataforma |
|---|---|
| `eav7-core-v0.1.0-x86_64-unknown-linux-gnu.tar.gz` | Linux x64 |
| `eav7-core-v0.1.0-aarch64-unknown-linux-gnu.tar.gz` | Linux arm64 |
| `eav7-core-v0.1.0-aarch64-apple-darwin.tar.gz` | macOS Apple Silicon |
| `eav7-core-v0.1.0-x86_64-pc-windows-msvc.zip` | **Windows** (`eav7-core.exe`) |

Só no Mac local (sem Windows): `bash bin/eav7-package-core.sh 0.1.0`.

Serviço: [core.md](core.md) · `deploy/eav7-core.service.example` ·
`deploy/eav7-core.windows-service.md` · `deploy/eav7-core.launchd.plist.example`.

## 2. Deploy produção (eavscan)

`deploy/nodes.env` (gitignored) já deve ter `EAV7_NODES`, SSH e
`EAV7_PUBLIC_URL` (ex.: `https://eavscan.com`).

```bash
# Nós inteiros (src/ + bin/) + Next + health público
bash bin/eav7-deploy-eavscan.sh

# Se o DNS/túnel ainda estiver off na 1ª subida:
bash bin/eav7-deploy-eavscan.sh --skip-public-health
# religar Cloudflare / DNS, depois:
curl -fsS -o /dev/null -w '%{http_code}\n' https://eavscan.com/
curl -fsS -H 'accept: application/json' https://eavscan.com/api/status
```

Só nós: `bash bin/eav7-deploy-nodes.sh`  
Só front: `bash bin/eav7-deploy-frontend.sh`

O script antigo que mandava **só** `api.js` foi substituído — G7/G8 e o resto
do core JS precisam do `src/` completo.

## 3. Pós-subida

- [ ] `https://eavscan.com/` → 200 e UI Next (não HTML legado)
- [ ] `/api/status` (ou `/status`) com `height` avançando
- [ ] Três nós no mesmo `headHash` (o deploy já confere)
- [ ] Backup offline das `validator-wallet.json`
- [ ] `EAV7_ADMIN_TOKEN` forte nos systemd
- [ ] Monitor: `EAV7_MONITOR_URL` + webhook (ver `scripts/monitor.sh`)
- [ ] Release Core publicada; operadores Windows/Linux baixam da Release
- [ ] Não deixar `EAV7_GENESIS_ACTIVE=1` no `config.rs` de produção

## 4. Fora do escopo deste go-live

- **Fase C** (app eleitor) — decisão de produto ([08](plano/08-descentralizacao-core-carteira.md)).
- Autenticação do explorador ([06](plano/06-decisoes-abertas.md) §4).
- Fork de formato de bloco / encolher disco ([06](plano/06-decisoes-abertas.md) §3).

## Ordem curta

1. `bash bin/eav7-go-live-check.sh --full`
2. remote + push branch
3. `git tag v0.1.0 && git push origin v0.1.0` → esperar Release
4. `bash bin/eav7-deploy-eavscan.sh`
5. checklist §3
