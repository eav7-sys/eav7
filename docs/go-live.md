# Go-live — Core + explorador

Produção = `eav7-core` / `eav7-node` + Next.

## 0. Pré-voo

```bash
bash bin/eav7-go-live-check.sh
cd rust && cargo test -p eav7-node --lib
cd web-next && npm run build
```

`deploy/nodes.env` · chave SSH · `rust/src/config.rs` em modo padrão.

## 1. Release

https://github.com/eav7-sys/eav7/releases/tag/v0.2.0

Nova tag: `git tag vX.Y.Z && git push origin vX.Y.Z`

## 2. Deploy

```bash
bash bin/eav7-deploy-eavscan.sh --from-release v0.2.0

# Túnel ainda off:
bash bin/eav7-deploy-eavscan.sh --from-release v0.2.0 --skip-public-health
```

Só Core: `bash bin/eav7-deploy-core.sh --from-release v0.2.0`  
Só front: `bash bin/eav7-deploy-frontend.sh`

## 3. Servidores

| Item | Valor |
|---|---|
| Binários | `/usr/local/bin/eav7-core`, `eav7-node` |
| Dados | `/var/lib/eav7` |
| Unit | `eav7-core.service` |
| API | `127.0.0.1:6070` atrás do túnel |
| Front | `eav7-web` (Next standalone) |

## 4. Pós-subida

- [ ] Site público → 200
- [ ] `/api/status` ou `/status` com `height`
- [ ] Backup da wallet do Core
- [ ] `EAV7_ADMIN_TOKEN` se usar admin

## 5. Local

```bash
npm run dev:local
npm run testnet:up -- --fresh
```
