# Golden tests de paridade API (G5) — esqueleto

## Objetivo

Subir o nó JS e o nó Rust sobre a **mesma** cadeia fixture e diffar JSON
rota a rota (status, corpo, mensagens de erro). Mensagens são contrato
(`ChainError = String`).

## Rotas mínimas (primeira fatia)

```
GET /status
GET /blocks?limit=5
GET /validators
GET /stats
GET /tokens
GET /txs?limit=5
```

## Como rodar (quando os harnesses existirem)

```bash
# 1. gerar fixture curta
node bin/eav7-gerar-cadeia-replay.js /tmp/eav7-parity-chain

# 2. subir JS e Rust apontando ao mesmo data dir (portas distintas)
# 3. bash bin/eav7-api-parity.sh http://127.0.0.1:6070 http://127.0.0.1:6071
```

O script `eav7-api-parity.sh` (a escrever) deve:

1. Normalizar campos voláteis (`headTime`, peers efêmeros) antes do diff.
2. Falhar com unified diff por rota.
3. Rodar no CI depois do job `rust` + um job que sobe os dois nós.

## Estado

Esqueleto documentado em 2026-08-09. Implementação do harness multi-nó é G6;
este golden depende dele ou de um script de boot temporário.
