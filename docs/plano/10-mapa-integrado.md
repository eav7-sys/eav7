# Mapa integrado — onde cada melhoria se encaixa

Uma página para ver **migração Rust + explorador + SDK + Core + carteira +
descentralização** sem ler tudo de novo. Detalhe de cada frente nos arquivos
linkados.

## Ordem que multiplica (não só empilha)

```
[hoje] Fase 4: explorador/API nativa + âncora commitável
          │
          ▼
[S] SDK P0/P1  ←── fazer cedo: barateia A/B/C
          │
          ▼
[A] Core multiplataforma (Win/Linux/macOS)  ouvinte
          │
          ▼
[B] Core candidato (stake/score)  — usa S1–S4
          │
          ├──► testnet pública (faucet do SDK)
          │
          ▼
[decisão] relaunch: voto/gênese/stateRoot  ← sem isto, mainnet continua clube de 3
          │
          ▼
[C] App eleitor (stake/voto)  — usa S1–S6; FFI (S10) só se Expo nativo
          │
          ▼
[D] seeds · snapshot · slash seguro · bloco menor
          │
          ▼
[fase 6] aposentar JS  ·  depois: teto 27→51/101 se top-27 já for diverso
```

## Como as frentes se reforçam

| Melhoria | Sozinha parece… | Combinada vira… |
|---|---|---|
| SDK S1 confirmação | detalhe de API | Core e app param de mentir “enviado = feito” |
| SDK S3 validadores tipados | cleanup de tipos | mesma lista no Core (B5), app (C2) e, se quiser, explorador sem duplicar parsing |
| SDK S5 header→stateRoot | light client | Core **ouvinte** verifica de verdade; combina com `STATEROOT_HEIGHT=0` no relaunch (08-D5) |
| Core Win/Linux/macOS | instalador | mais nós verificadores → menos dependência dos 3 IPs |
| App só eleitor | “mais um wallet” | espalha **votos** — a alavanca real dos 27 |
| Compactar bloco (05.3 / 08-D4) | fork chato | Core cabe em disco barato → mais operadores |
| Âncora + panic release (06.1) | ops | nó que não serve estado podre → confiança para terceiros rodarem Core |
| Mock default off (audit) | uma linha | explorador/testnet não publica ficção quando o Core aponta para ela |
| Método de teste §07 | cultura | SDK/Core novos não repetem o bug da “1ª vez” |

## O que já aprendemos e reaproveitamos

Da **auditoria / plano 01–07**:

1. Não otimizar COW/SMT agora — não trava descentralização.
2. Não subir `MAX_VALIDATORS` antes de encher os 27 com independentes.
3. Encoding do bloco é **base64/PEM**, não hex×2 — economia do fork é ~25–33%
   no encoding + ganho grande ao **referenciar** `pqPublicKey` (corrigir texto em
   [05-pendencias.md](05-pendencias.md)).
4. Dual-client até fase 6: rota nova = JS + Rust.
5. Produção caída e commits soltos são P0 de **ops**, não de produto Core.

Do **SDK** ([09](09-sdk-melhorias.md)):

1. Relayer já resolveu nonce em rajada — **generalizar** (S2), não reescrever.
2. `saldo_provado` já existe — falta só a raiz confiável (S5), não outra prova.
3. Manter SDK síncrono; mobile usa FFI ou HTTP, não força tokio no crate.

Do **plano Core** ([08](08-descentralizacao-core-carteira.md)):

1. Celular nunca produz bloco.
2. Multiplataforma no escopo; validador 24/7 recomendado em Linux VPS.
3. Sucesso = operadores externos no top-27, não “app na store”.

## Backlog unificado (próximos passos concretos)

Prioridade de **alavancagem**, assumindo que infra/commits da fase 4 avançam em
paralelo com a sua ordem:

| # | Item | Doc | Esforço |
|---|---|---|---|
| 1 | Religar / estabilizar eavscan + commit âncora isolada | 05.1–05.2 | ops + S |
| 2 | Decidir panic em release na âncora | 06.1 | S |
| 3 | **Fase S** SDK: S1–S4 (confirmação, nonce, tipos, unbonding/claim) | 09 | M |
| 4 | Inverter `USE_MOCK` default no web-next | audit | S |
| 5 | Fase A Core: binários Win/Linux/macOS + `init`/`status` | 08-A | L |
| 6 | Fase B Core candidato (já em cima do SDK) | 08-B | M |
| 7 | Testnet + faucet + guia operador | 08 + SDK faucet | M |
| 8 | Decisão relaunch (voto/gênese/root) | 06 + 08 pré-reqs | dono |
| 9 | Fase C app eleitor | 08-C | L |
| 10 | D: seeds, snapshot, slash, bloco menor | 08-D | L |

## Onde não gastar agora

- FFI mobile (S10) antes da stack do app.
- Electron/GUI do Core.
- Aumentar 27.
- COW/SMT.
- Aposentar JS cedo.
- Login e-mail no explorador.
- One-click cloud (D6) antes do Core manual funcionar.

## Documentos

| Arquivo | Papel |
|---|---|
| [01](01-estado-atual.md)–[07](07-metodo-testes.md) | Migração Rust, sessão, riscos |
| [08](08-descentralizacao-core-carteira.md) | Core + carteira + descentralização |
| [09](09-sdk-melhorias.md) | Backlog do `eav7-sdk` |
| Este arquivo | Ordem e sinergia |
| [11](11-mapa-melhorias-projeto.md) | Inventário de melhorias do repo inteiro (G1–G21) |
