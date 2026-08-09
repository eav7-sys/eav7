# Deploy — depois do local

Os scripts **não** carregam IPs do repositório.

1. `cp deploy/nodes.example deploy/nodes.env` e edite `EAV7_NODES`.
2. Garanta SSH com a chave em `EAV7_SSH_KEY`.
3. Pré-voo: `bash bin/eav7-go-live-check.sh`.
4. Go-live completo: `bash bin/eav7-deploy-eavscan.sh`  
   (nós `src/`+`bin/` + Next + health público).

| Script | O quê |
|---|---|
| `bin/eav7-deploy-nodes.sh` | Só backend (replay-compat + convergência) |
| `bin/eav7-deploy-frontend.sh` | Só standalone Next |
| `bin/eav7-deploy-eavscan.sh` | Tudo + healthcheck |

Checklist: [docs/go-live.md](../docs/go-live.md) · [docs/local.md](../docs/local.md) · [DEPLOY.md](../DEPLOY.md).
