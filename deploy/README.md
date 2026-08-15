# Deploy — Core + Next

1. `cp deploy/nodes.example deploy/nodes.env` e preencha `EAV7_NODES`.
2. Chave em `EAV7_SSH_KEY`.
3. `bash bin/eav7-go-live-check.sh`
4. `bash bin/eav7-deploy-eavscan.sh --from-release v0.2.0`

| Script | O quê |
|---|---|
| `bin/eav7-deploy-core.sh` | Binários + unit `eav7-core` |
| `bin/eav7-deploy-frontend.sh` | Standalone Next |
| `bin/eav7-deploy-eavscan.sh` | Core + Next + health |

Checklist: [docs/go-live.md](../docs/go-live.md).
