# EAV7 — Guia de deploy em produção

Backup pronto para subir num servidor. Node.js puro, **zero dependências**
(nada de `npm install`).

## Requisitos do servidor

- **Ubuntu Server 24.04 LTS** (ou Debian 12).
- **Node.js 22 ou 24 LTS**.
- 2–4 vCPU · 4 GB RAM · 80 GB+ SSD (NVMe). O disco importa: a cadeia cresce
  (~1 bloco/s) e o `chain.json` é reescrito por bloco — em SSD aguenta bem;
  para operação de longo prazo, migrar para um banco incremental é o próximo passo.

## 1. Subir o código

```bash
sudo mkdir -p /opt/eav7 && cd /opt/eav7
# envie o eav7-codigo-*.tar.gz e extraia:
tar xzf eav7-codigo-*.tar.gz
node --version   # deve ser >= 20
npm test         # 33 testes, todos verdes
```

## 2. Gênese: começar novo (recomendado) OU continuar a cadeia de testes

- **Novo (mainnet limpa, recomendado para produção):** ao rodar `eav7 mine` pela
  primeira vez, o nó cria uma **gênese nova**, gera a carteira do validador em
  `data/node-6070/validator-wallet.json` e aloca os **100 bilhões de EAV7** a ela.
  Essa carteira é a **chave-mestra do supply** — faça backup e guarde offline.
  A cadeia de testes local (e a transferência de teste de 50 bi) **não** vem junto.
- **Continuar a cadeia de testes:** extraia também o `eav7-estado-*.tar.gz` dentro
  de `/opt/eav7` (recria `data/` com a cadeia + a carteira do validador que já
  detém o supply). Só faça isso se quiser preservar exatamente aquele estado.

Depois de criada a gênese, **fixe o hash dela** para os próximos nós:
`node bin/eav7.js status` mostra o `headHash` da altura 0 — use em
`--genesis-hash E7...` nos demais nós.

## 3. Rodar como serviço (systemd)

`/etc/systemd/system/eav7.service`:

```ini
[Unit]
Description=EAV7 node
After=network.target

[Service]
WorkingDirectory=/opt/eav7
ExecStart=/usr/bin/node bin/eav7.js mine --port 6070 --eavm-port 7075 --data /opt/eav7/data --host 127.0.0.1
Environment=EAV7_ADMIN_TOKEN=TROQUE-por-um-token-forte
Environment=EAV7_PUBLIC_RPC_URL=https://rpc.SEUDOMINIO.com
Restart=always
RestartSec=3
User=eav7
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin eav7 && sudo chown -R eav7 /opt/eav7
sudo systemctl enable --now eav7
journalctl -u eav7 -f   # logs
```

Com Cloudflare Tunnel, mantenha `--host 127.0.0.1` (o túnel conecta localmente).

## 4. Domínio + HTTPS via Cloudflare Tunnel (recomendado)

A MetaMask exige HTTPS no RPC; o túnel entrega TLS e não abre portas no servidor.

```bash
# instalar cloudflared, autenticar e criar o túnel
cloudflared tunnel login
cloudflared tunnel create eav7
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: eav7
credentials-file: /root/.cloudflared/<ID-DO-TUNEL>.json
ingress:
  - hostname: rpc.SEUDOMINIO.com    # RPC EAVM (MetaMask/Trust)
    service: http://localhost:7075
  - hostname: scan.SEUDOMINIO.com   # explorer / carteira / mineração
    service: http://localhost:6070
  - service: http_status:404
```

```bash
cloudflared tunnel route dns eav7 rpc.SEUDOMINIO.com
cloudflared tunnel route dns eav7 scan.SEUDOMINIO.com
# rodar como serviço:
sudo cloudflared service install
```

Config da rede na MetaMask/Trust: **RPC** `https://rpc.SEUDOMINIO.com` · **Chain ID**
`72020` · **símbolo** `EAV7`. O explorador fica em `https://scan.SEUDOMINIO.com/` (Next).

## 5. Checklist de produção

- [ ] `EAV7_ADMIN_TOKEN` definido (protege os endpoints de admin — o token, não o IP).
- [ ] `EAV7_PUBLIC_RPC_URL=https://rpc.SEUDOMINIO.com` (para o botão "Adicionar à MetaMask").
- [ ] Backup **offline** de `data/node-6070/validator-wallet.json` (chave do supply).
- [ ] `--genesis-hash` fixado nos nós que entrarem depois.
- [ ] Regras de rate-limit/WAF na Cloudflare na frente de `rpc.` e `scan.`.
- [ ] Mais de um nó validador (em máquinas/provedores distintos) para descentralização.
- [ ] Ler `AUDITORIA.md` — limitações residuais antes de custodiar valor real
      (descentralização da ponte, finalidade de consenso, auditoria externa).

## 6. Go-live deste repositório

Operação com inventário SSH + scripts atuais: **[docs/go-live.md](docs/go-live.md)**.

```bash
bash bin/eav7-go-live-check.sh --full
bash bin/eav7-deploy-eavscan.sh
```

