# Golden tests de paridade API (G5)

## Objetivo

Subir o nó JS e o nó Rust sobre a **mesma** cadeia fixture e diffar JSON
rota a rota. Mensagens são contrato (`ChainError = String`).

## Rotas (fatia estável)

```
GET /status
GET /blocks?limit=5
GET /blocks/latest
GET /validators
GET /stats
GET /tokens
GET /txs?limit=5
GET /mempool
GET /names
GET /nfts
```

## Como rodar

```bash
# Automático (gera fixture, sobe, diffa, derruba):
bash bin/eav7-api-parity-boot.sh
# ou: npm run parity

# Com nós já no ar:
bash bin/eav7-api-parity.sh http://127.0.0.1:6070 http://127.0.0.1:6071
```

`eav7-api-parity.sh` normaliza campos voláteis (`headTime`, peers, …) e falha
com unified diff por rota.

## CI

Job `api-parity` em `.github/workflows/ci.yml` (G5).
