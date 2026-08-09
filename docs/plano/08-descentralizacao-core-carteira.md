# Plano: EAV7 Core + carteira (descentralização)

Levantado para desenvolver a abrangência de validadores e eleitores.
Complementa as fases 1–6 da migração Rust — **não as substitui**.

## Em uma frase

O **celular vota e faz stake**; o **Core no PC/VPS** verifica a cadeia e, se
quiser, produz blocos. Ninguém assina bloco no telefone.

## O que já existe (não reinventar)

| Peça | Onde | Serve para |
|---|---|---|
| Nó HTTP + P2P + produtor | `eav7-node` | Motor do Core |
| Carteira / tx / cliente HTTP | `eav7-sdk` | Backend da CLI e do app |
| Cripto no browser | `eav7-wasm` | Base da carteira web; app nativo pode reutilizar lógica via SDK |
| Tela wallet no site | `web-next` `/wallet` | Protótipo de UX; não é o app |
| Lista / score de validadores | API `/validators` + explorador | Alimenta a UI de voto |

O que **não** existe ainda: instalador amigável, modo “só verificar”, fluxo
guiado de candidatura, app mobile de stake/voto, guia de operador externo.

**Dependência explícita:** a [Fase S do SDK](09-sdk-melhorias.md) (confirmação,
nonce em rajada, validadores/histórico tipados, unbonding/claim) vem **antes**
das fases B e C — senão Core e app reimplementam a mesma lógica. Mapa geral:
[10-mapa-integrado.md](10-mapa-integrado.md).

## Pré-requisitos (senão o produto mente)

Sem isto, “virar validador pelo app” é teatro:

1. **Fase 4 estável** — API nativa + explorador de pé (Rust servindo leitura).
2. **Voto ativo de verdade** — no relaunch (ou fork): `VOTING_HEIGHT = 0`.
3. **Slash só quando a evidência estiver correta** — whitepaper: slash no
   lançamento pune honesto em reorg; endurecer evidência **antes** de ligar.
4. **Gênese com buckets reais** — vesting §12.2; público líquido para stake/voto.
5. **Ordem explícita** para wipe/relaunch, se for o caminho.

Até lá, dá para construir Core e carteira em **testnet / devnet** sem fingir
que a mainnet já é aberta.

## Arquitetura alvo

```
┌─────────────────────┐         ┌──────────────────────────┐
│  App celular        │  stake  │  Rede EAV7               │
│  (eleitor)          │  voto   │                          │
│  — saldo            │────────►│  top-27 produzem blocos  │
│  — stake / unstake  │         │  demais verificam        │
│  — votar / reivindicar│◄───────│                          │
└─────────────────────┘  status └────────────▲─────────────┘
                                             │
┌─────────────────────┐                      │
│  EAV7 Core          │  sincroniza / produz │
│  (PC ou VPS 24/7)   │──────────────────────┘
│  modos:             │
│   ouvinte | candidato | validador
└─────────────────────┘
```

## Fases de desenvolvimento

### Fase S — SDK (2–3 semanas) — ver [09](09-sdk-melhorias.md)

Entregas mínimas antes de B/C: `aguardar_confirmacao`, `Remetente` (nonce),
tipos de validador + histórico, unbonding + `reivindicar_recompensa`.
Pode começar em paralelo com empacote do Core (A1–A7), mas **B1/B5 e C2
esperam S1–S4**.

### Fase A — EAV7 Core MVP (8–10 semanas)

**Objetivo:** qualquer pessoa sobe um nó sem ler o monorepo inteiro.
**Plataformas no escopo:** Windows, Linux e macOS (multiplataforma de verdade).

Rust já compila nos três; o trabalho extra é **empacotar, instalar como serviço
e documentar**, não reescrever o consenso.

| Entrega | Detalhe |
|---|---|
| A1. Binários oficiais | `eav7-core` por alvo: **Linux x64**, **Linux arm64** (VPS/Raspberry), **macOS arm64** (Apple Silicon), **macOS x64** (Intel, se ainda valer a pena), **Windows x64** (`.exe` + zip com checksum) |
| A2. Três modos | `listen` (só sync/verificar) · `candidate` (stake + anunciado) · `validator` (produz se estiver no top-27) — iguais nos três SOs |
| A3. CLI de status | `eav7-core status` → altura, peers, modo, “no top-27?”, último bloco produzido, disco |
| A4. Instalação / serviço | **Linux:** tarball + unit `systemd`. **macOS:** tarball/`.pkg` + exemplo `launchd`. **Windows:** zip + serviço via `sc.exe` / NSSM ou Task Scheduler documentado. Docker (Linux) opcional e oficial |
| A5. Wizard | `eav7-core init` → gera chaves híbridas, pede diretório de dados, peers seed (paths nativos: `%APPDATA%\EAV7` / `~/Library/Application Support/EAV7` / `~/.eav7`) |
| A6. Guia 15 min | Um guia por SO + um guia “VPS Linux” (caso mais comum para validador 24/7) |
| A7. CI de release | GitHub Actions (ou equivalente) que gera e assina/checksuma os artefatos das três plataformas a cada tag |

**Critério de pronto:** um operador novo sobe um nó **ouvinte** em &lt; 15 minutos
em Windows **ou** macOS **ou** Linux e vê a ponta da testnet.

**Papel de cada SO (expectativa honesta):**

| SO | Ouvinte (verificar) | Validador 24/7 |
|---|---|---|
| Linux (VPS/bare metal) | sim | **recomendado** |
| macOS | sim | possível em casa; não ideal como único validador de produção |
| Windows | sim | possível; documentar energia/sleep e firewall; produção séria → VPS Linux |

**Fora de escopo nesta fase:** UI gráfica desktop (Electron etc.), app mobile,
one-click cloud, Windows on ARM (pode entrar depois se houver demanda).

### Fase B — Candidatura e operação (4–6 semanas)

**Objetivo:** o Core cobre o caminho até entrar no ranking.

| Entrega | Detalhe |
|---|---|
| B1. Fluxo stake | CLI/SDK: `stake`, `unstake`, mostra unbonding |
| B2. Candidatar | Após `MIN_VALIDATOR_STAKE`, modo `candidate`; aparece em `/validators` (ou lista de candidatos — se faltar endpoint, criar nos **dois** clientes enquanto JS viver) |
| B3. Saúde local | Alertas: peer baixo, atraso de slot, disco, falha ao assinar |
| B4. Chaves | Separar chave de produção (hot, no servidor) de chave de tesouro (cold); documentar risco |
| B5. Score | Mostrar o mesmo `performance` que a API já expõe — operador vê se a comunidade vai tirar voto |

**Critério de pronto:** em testnet com voto ativo, um Core candidato recebe votos
de carteiras de teste e entra/sai do top-27 de forma observável.

### Fase C — Carteira mobile (eleitor) (8–12 semanas)

**Objetivo:** o público move poder de escolha sem rodar servidor.

| Entrega | Detalhe |
|---|---|
| C1. Escolha de stack | Recomendação: **React Native / Expo** reutilizando tipos e fluxos da wallet web + chamadas ao `eav7-sdk` (ou API HTTP). Alternativa: app fino que abre a wallet web com deep link — mais rápido, menos nativo |
| C2. MVP telas | Criar/importar carteira · saldo · enviar · stake/unstake · **lista de validadores + votar** · histórico simples |
| C3. Segurança | Biometria no aparelho; seed nunca sobe a servidor nosso; sem “login e-mail/senha” de explorador |
| C4. Empurrão ao Core | Tela “Quer validar?” → explica VPS + link do guia; **não** tenta rodar nó no telefone |
| C5. Lojas | TestFlight / Internal testing antes de store pública (compliance à parte) |

**Critério de pronto:** usuário de teste stakeia, vota, vê o validador no explorador
com voto refletido; recupera carteira pela seed.

**Explicitamente não fazer:** validador dentro do app; preço/mcap inventado;
conta com e-mail/senha.

### Fase D — Abrangência e endurecimento (contínuo)

| Entrega | Detalhe |
|---|---|
| D1. Seeds públicos | Lista de peers DNS/seed estável (não só IPs dos 3 nós no script) |
| D2. Snapshots | Bootstrap rápido do Core (com hash verificável) — senão ninguém espera sync do genesis |
| D3. Slash seguro | Só ativar `SLASHING_HEIGHT` após evidência anti-equivocação correta |
| D4. Compactação de bloco | Fork de formato (base64/PEM → binário + ref de `pqPublicKey`) — barateia disco do Core |
| D5. stateRoot cedo | No relaunch, `STATEROOT_HEIGHT = 0` para caminho a light client |
| D6. (Opcional) One-click VPS | Parceiro cloud; app só orquestra; Core continua sendo o binário oficial |

## Ordem no calendário (relativa ao plano Rust)

```
Fase 4 (explorador/API)
    │
    ├──► S SDK P0/P1 ──────────┐
    │                          │
    └──► A Core MVP (pack) ────┼──► B candidatura (precisa S)
                               │
                               └──► testnet com voto
                                         │
                                   relaunch (decisão)
                                         │
                                         ▼
                                   C app eleitor
                                         │
                                         ▼
                                   D seeds / slash / disco
```

O app (C) **pode** começar o design e a carteira de leitura assim que a API
estiver estável; o fluxo de voto só é “produto de mainnet” com voto ativo.
Detalhe e sinergias: [10-mapa-integrado.md](10-mapa-integrado.md).

## Papéis e esforço (ordem de grandeza)

| Frente | Perfil | Esforço |
|---|---|---|
| SDK Fase S | 1 eng. Rust | ~2–3 semanas |
| Core A+B (Win/Linux/macOS) | 1 eng. Rust/DevOps | ~3–3,5 meses (A alonga por empacote + CI triplo) |
| Carteira C | 1 eng. mobile (+ design) | ~2–3 meses (paralelo após A1 + S) |
| Docs / testnet | compartilhado | contínuo |
| Slash / fork disco | consenso (Opus-level care) | fase D, não misturar com UI |

## Riscos

| Risco | Mitigação |
|---|---|
| App promete “seja validador” e o celular falha | Copy e UX: candidato = Core; app = voto |
| Chave de validador no notebook do operador | Doc + default: VPS dedicado; backup criptografado |
| Mainnet ainda N=3 | Produto só em testnet até relaunch/voto |
| Dual JS/Rust | Enquanto JS for produção, endpoint novo nasce nos dois |
| Compliance de app store / oferta de token | Jurídico antes de store pública (whitepaper §14.1) |

## Decisões que precisam de você

1. **Relaunch com voto/slash/gênese certos?** Sem isso, o plano vira só ferramenta
   de testnet.
2. **Stack do app:** Expo nativo vs wallet web empacotada (PWA/Capacitor).
3. **Nome do binário:** `eav7` vs `eav7-core` (Core comunica melhor o papel).
4. **Testnet pública** com faucet pequeno para stake de candidatos — sim/não.

## O que não entra neste plano

- Aumentar `MAX_VALIDATORS` além de 27 (só depois de encher com independentes).
- COW/SMT (`docs/scaling.md`) — outro gatilho (~30–50k contas).
- Aposentar JS sem Rust validando em produção.
- Login e-mail/senha no explorador.

## Definição de sucesso

1. ≥ **10** Cores ouvintes de operadores externos numa testnet.
2. ≥ **7** candidatos com stake próprio (não hot-wallet da fundação).
3. Top-27 com **maioria de chaves** fora do conjunto original dos 3.
4. App: um usuário leigo stakeia e vota sem abrir o terminal.

Quando (1)–(3) forem verdade em mainnet, aí faz sentido discutir subir o teto
para 51 ou 101 via governança.
