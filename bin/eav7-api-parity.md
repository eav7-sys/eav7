# Golden tests de paridade API (G5)

## Objetivo

Subir o nó JS e o nó Rust sobre a **mesma** cadeia fixture e diffar JSON
rota a rota. Mensagens são contrato (`ChainError = String`).

## Rotas (primeira fatia)

```
GET /status
GET /blocks?limit=5
GET /validators
GET /stats
GET /tokens
GET /txs?limit=5
```

## Como rodar

```bash
# Automático (gera fixture, sobe, diffa, derruba):
bash bin/eav7-api-parity-boot.sh

# Com nós já no ar:
bash bin/eav7-api-parity.sh http://127.0.0.1:6070 http://127.0.0.1:6071
```

`eav7-api-parity.sh` normaliza campos voláteis (`headTime`, peers, …) e falha
com unified diff por rota.

## Estado

Harness de boot: `bin/eav7-api-parity-boot.sh` (2026-08-09). Cobertura de todas
as ~34 rotas e job CI dedicado ficam para a próxima fatia (G6 multi-nó ajuda).
