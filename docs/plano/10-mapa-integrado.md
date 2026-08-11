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
[próximo] Fase C app eleitor · D (seeds/snapshot) · encher 51 / banco 101 ([17](17-set-51-banco-101.md))
```

## Como as frentes se reforçam

| Melhoria | Sozinha parece… | Combinada vira… |
|---|---|---|
| SDK S1 confirmação | detalhe de API | Core e app param de mentir “enviado = feito” |
| SDK S3 validadores tipados | cleanup de tipos | mesma lista no Core (B5), app (C2) e, se quiser, explorador sem duplicar parsing |
| SDK S5 header→stateRoot | light client | Core **ouvinte** verifica de verdade; combina com `STATEROOT_HEIGHT=0` no relaunch (08-D5) |
| Core Win/Linux/macOS | instalador | mais nós verificadores → menos dependência dos 3 IPs |
| App só eleitor | “mais um wallet” | espalha **votos** — a alavanca real das **51** / banco |
| Compactar bloco (05.3 / 08-D4) | fork chato | Core cabe em disco barato → mais operadores |
| Âncora + panic release (06.1) | ops | nó que não serve estado podre → confiança para terceiros rodarem Core |
| Mock default off (audit) | uma linha | explorador/testnet não publica ficção quando o Core aponta para ela |
| Método de teste §07 | cultura | SDK/Core novos não repetem o bug da “1ª vez” |

## O que já aprendemos e reaproveitamos

Da **auditoria / plano 01–07**:

1. Não otimizar COW/SMT agora — não trava descentralização.
2. Default agora é **51** ([17](17-set-51-banco-101.md)); não subir a **101 ativos** antes de encher os 51 com independentes.
3. Encoding do bloco é **base64/PEM**, não hex×2 — economia do fork é ~25–33%
   no encoding + ganho grande ao **referenciar** `pqPublicKey` (corrigir texto em
   [05-pendencias.md](05-pendencias.md)).
5. Produção caída e commits soltos são P0 de **ops**, não de produto Core.

Do **SDK** ([09](09-sdk-melhorias.md)):

1. Relayer já resolveu nonce em rajada — **generalizar** (S2), não reescrever.
2. `saldo_provado` já existe — falta só a raiz confiável (S5), não outra prova.
3. Manter SDK síncrono; mobile usa FFI ou HTTP, não força tokio no crate.

Do **plano Core** ([08](08-descentralizacao-core-carteira.md)):

1. Celular nunca produz bloco.
2. Multiplataforma no escopo; validador 24/7 recomendado em Linux VPS.
3. Sucesso = operadores externos no top-51 / banco 101, não “app na store”.

## Backlog unificado (próximos passos concretos)

Prioridade de **alavancagem**, assumindo que infra/commits da fase 4 avançam em
paralelo com a sua ordem:

| # | Item | Doc | Esforço |
|---|---|---|---|
| 1 | Religar / estabilizar eavscan + commit âncora isolada | 05.1–05.2 | ops + S |
| 2 | ~~Decidir panic em release na âncora~~ **feito** (`panic!`) | 06.1 | — |
| 3 | ~~**Fase S** SDK S1–S5~~ **feito** (S6 timeout também); falta integração nó vivo | 09 | — |
| 4 | ~~Inverter `USE_MOCK` default~~ **já opt-in** (`=== "true"`) | audit | — |
| 5 | Fase A Core: binários Win/Linux/macOS + `init`/`status` | 08-A | L |
| 6 | Fase B Core candidato (já em cima do SDK) | 08-B | M |
| 7 | Testnet + faucet + guia operador | 08 + SDK faucet | M |
| 8 | Decisão relaunch (voto/gênese/root) | 06 + 08 pré-reqs | dono |
| 9 | Fase C app eleitor | 08-C | L |
| 10 | D: seeds, snapshot, slash, bloco menor | 08-D | L |
| 11 | **GB · Assinatura Livre** (taxa unificada; gênese do lançamento) | [12](12-gb-assinatura-livre.md) | L |
| 12 | **Âncora** (owner M-of-N + witness; cert época fase 2) | [13](13-ancora-pq-multisig.md) | M→L |
| 13 | **Gov × Âncora** (GOV_* só owner/multisig; gênese) | [14](14-governanca-ancora.md) | M |
| — | **Longo prazo / adiados** (gates; não bloqueia launch) | [15](15-longo-prazo-adiados.md) | mapa |
| 14 | **IA oráculo + ops** (A usável; B sem poder) | [16](16-ia-oraculo-ops.md) | M |
| 15 | **Set 51 + banco 101** | [17](17-set-51-banco-101.md) | M |
| 16 | **Ponte** (committee + breaker + adapter) | [18](18-ponte-committee-breaker.md) | L |
| 17 | **EAV20** (contrato ERC-20 na EAVM) | whitepaper §9.2 | M |
| 18 | **Consenso** (liveness skip + heights) | [20](20-consenso-liveness-finality.md) | M |
| ★ | **Launch checklist** (ops/gênese) | [21](21-launch-checklist.md) | mestre |
| ★★ | **Fechar dev** (o que programar agora) | [22](22-fechar-desenvolvimento.md) | execução |

## Onde não gastar agora

- FFI mobile (S10) antes da stack do app.
- GUI desktop do Core.
- Subir a 101 ativos antes do set ~cheio ([17](17-set-51-banco-101.md)).
- COW/SMT.
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
| [12](12-gb-assinatura-livre.md) | Fork taxa GB |
| [13](13-ancora-pq-multisig.md) | Âncora PQ + multisig + época |
| [14](14-governanca-ancora.md) | Governança amarrada à Âncora |
| [15](15-longo-prazo-adiados.md) | Adiados com pré-condições (G0–G∞) |
| [16](16-ia-oraculo-ops.md) | IA: oráculo + ops |
| [17](17-set-51-banco-101.md) | Set 51 + banco 101 |
| [18](18-ponte-committee-breaker.md) | Ponte committee + breaker |
| — | EAV20 na EAVM (whitepaper §9.2) |
| [20](20-consenso-liveness-finality.md) | Consenso liveness/finality |
| [21](21-launch-checklist.md) | Checklist mestre de launch |
| [22](22-fechar-desenvolvimento.md) | Fechar desenvolvimento pendente |
