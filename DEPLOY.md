# EAV7 — Deploy em produção

Runtime = **`eav7-core` / `eav7-node`** + explorador Next.

## Requisitos

- Ubuntu 24.04 LTS (ou Debian 12)
- Binários da [Release](https://github.com/eav7-sys/eav7/releases)
- 2–4 vCPU · 4 GB RAM · 80 GB+ SSD
- Cloudflare Tunnel (ou TLS) — API em `127.0.0.1`

## Deste repositório

```bash
bash bin/eav7-deploy-eavscan.sh --from-release v0.1.0
```

Detalhe: [`docs/go-live.md`](docs/go-live.md).

## Manual

```bash
sudo install -m 755 eav7-core eav7-node /usr/local/bin/
sudo useradd -r -s /usr/sbin/nologin eav7 || true
sudo mkdir -p /var/lib/eav7 && sudo chown eav7:eav7 /var/lib/eav7
sudo -u eav7 eav7-core init --dir /var/lib/eav7 \
  --mode validator --port 6070 --host 127.0.0.1
sudo cp deploy/eav7-core.service.example /etc/systemd/system/eav7-core.service
sudo systemctl enable --now eav7-core
```

Front: `bin/eav7-deploy-frontend.sh`.

## Túnel

```yaml
ingress:
  - hostname: rpc.SEUDOMINIO.com
    service: http://localhost:7070
  - hostname: scan.SEUDOMINIO.com
    service: http://localhost:3000
  - service: http_status:404
```

RPC EAVM = porta API + 1000. Chain ID `72020` · símbolo `EAV7`.

## Checklist

- [ ] `eav7-core` active · `/status` ok
- [ ] API só em loopback + túnel/WAF
- [ ] Backup offline da wallet
- [ ] `EAV7_ADMIN_TOKEN` se usar admin
- [ ] Ler `AUDITORIA.md` antes de custodiar valor real
