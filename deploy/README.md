# Deploy — depois do local

Os scripts **não** carregam IPs do repositório.

1. `cp deploy/nodes.example deploy/nodes.env` e edite `EAV7_NODES`.
2. Garanta SSH com a chave em `EAV7_SSH_KEY`.
3. Build local do explorador: `cd web-next && npm run build`.
4. Rode um dos scripts em `bin/eav7-deploy-*.sh`.

Ver também [docs/local.md](../docs/local.md) e [DEPLOY.md](../DEPLOY.md).
