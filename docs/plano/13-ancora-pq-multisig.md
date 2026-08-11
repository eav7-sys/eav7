# Plano: Âncora · identidade PQ + multisig + época

**Status:** aceito em desenho (2026-08-09) — amadurecendo; implementação em fases  
**Nome técnico:** validador / conta produtora  
**Nome de produto:** **Âncora** (EN: **Anchor**)  
**Apoia-se em:** permissões v2 (`docs/permissoes-v2.md`, `PERMISSIONS_V2_HEIGHT`)

## Em uma frase

A Âncora não é “uma chave no VPS”: é uma **conta com owner M-of-N pós-quântico**, **witness quente** só para bloco, e (fase 2) **certificados de época híbridos** para ponte e light client.

## Por que agora

Já temos assinatura híbrida em carteira, tx e bloco — isso é base, não diferencial de validador.  
O salto é separar **alma** (owner frio, multisig) de **mão** (witness no servidor) e publicar provas de conjunto que sobrevivem a quebra de ECDSA sozinha.

Multisig **já é L1**. Exigir M-of-N só “depois do launch” enfraquece a tese: quem entrar com chave única dificilmente migra. **Padrão desde o começo** (onboarding + política de rede).

## Opções PQ em cima do validador (o que consideramos)

Além de “já assinamos bloco com híbrido”, estas foram as linhas em cima da mesa:

| # | Ideia | O que resolve | Veredito |
|---|---|---|---|
| **1** | **Identidade fria PQ + witness quente** | VPS vazado ≠ identidade/stake sequestrados; rotação de servidor sem trocar a alma | **Fase 1** — núcleo (já quase no v2) |
| **2** | **Owner M-of-N (multisig) na fria** | Uma seed/papel sozinho não é SPOF; roubo de 1 share não roda política | **Fase 1** — padrão desde o launch |
| **3** | **Certificado de época híbrido** (quórum 2/3+1 sobre set + `stateRoot`) | Ponte / light client PQ-safe; *harvest now* em ECDSA não basta | **Fase 2** — fork (`EPOCH_CERT_*`) |
| **4** | **Governança à prova de quebra de curva** — voto/comissão/saída exigem híbrido **fresco** (e caminho multisig quando a conta é M-of-N) | Se secp cair no futuro, eleição não se sequestra só com ECDSA antiga | **Fase 1.5** — regra de produto + reforço de verificação; hoje txs já são híbridas, falta amarrar narrativa/teste e ops só via owner/multisig |
| **5** | Custódia física da fria: paper/metal, pendrive air-gap, HSM | Onde mora o material de cada share | **Operacional** — ver secção completa abaixo |
| **6** | VRF pós-quântico / leader election PQ | Aleatoriedade de slot “à prova de quantum” | **Fora** — pesquisa instável |
| **7** | Threshold Dilithium / sig agregada de quórum | Cert de época menor | **Fora por ora** — fase 2 usa N sigs híbridas explícitas |
| **8** | Multisig **por bloco** | Cada header precisa M-of-N | **Rejeitado** — mata latência |
| **9** | IA elege / pontua no consenso | “Smart” ranking | **Rejeitado** — IA sem poder de consenso |

**Pacote escolhido:** **1 + 2** no launch (multisig **desde o começo**, não “depois”) · **4** no mesmo trilho · **3** fase 2 · **5** no runbook (paper+USB no launch; HSM depois) · **6–9** de fora.

Multisig on-chain (2) **não substitui** frio/quente (1) nem época (3): é a forma da identidade fria. Sem (1), multisig só complica uma chave que ainda vive no servidor. Sem (2), “PQ + cold” vira backup de uma chave só.

## Decisão

| Item | Escolha |
|---|---|
| Nome produto | **Âncora** / Anchor |
| Nome técnico / API | `validator` / conta (`producerAccount`) — sem inventar tipo novo |
| Identidade fria | `owner` **M-of-N** (default produto **2-de-3**), chaves **híbridas** — opções **1+2** |
| Produção | `witness` **1 chave** no VPS (já no consenso acima de `PERMISSIONS_V2_HEIGHT`) |
| Fundos / ops do dia | `active` (limiar configurável); pode ser 1-de-1 operacional |
| Recuperação | `recovery` v2 (1 chave) — **não** expandir para M-of-N neste plano |
| Multisig no bloco | **Não** — opção **8** rejeitada |
| Ops críticas via multisig | `VOTE`, `SET_COMMISSION`, `CLAIM_VOTER_REWARD`, rotação de `witness`, saída do ranking — opção **4** |
| Custódia da fria | paper/metal + pendrive air-gap no launch; HSM depois — opção **5** |
| Multisig na alma | **desde o dia 1** (owner 2-de-3) — não adiável como “upgrade futuro” |
| Certificado de época | **Fase 2** — opção **3** |
| Lançamento | **Gênese / heights baixos** com v2 ativa — não há mainnet econômica ainda; isto é launch, não relaunch |

## Modelo mental

```
┌─────────────────────────────────────────┐
│  Conta Âncora (stake, votos, recompensa)│
│                                         │
│  owner  ── 2-de-3 híbrido (frio)        │  ← alma / rotação / política
│  active ── gasto / ops (configurável)   │
│  witness─ 1 chave no VPS (quente)       │  ← só assina bloco / attest
│  recovery─ trilho v2 (opcional)         │
└─────────────────────────────────────────┘
```

Frase de produto:  
**Na EAV7 a Âncora é uma identidade pós-quântica que troca o servidor sem trocar a alma.**

---

## Multisig desde o começo (decisão de produto)

Multisig **já é padrão na rede** (`PERMISSION_UPDATE` + `MULTISIG_PROPOSE` / `APPROVE`).  
Para a Âncora, **tem de ser usado desde o início** — senão a história “PQ + cold” vira só backup de uma chave só. Quem entra com chave única dificilmente migra depois.

### O que a rede já tem

Multisig de conta é L1. Acima de `PERMISSIONS_V2_HEIGHT` (`rust/src/config.rs`, `rust/src/state/gov.rs`, `docs/permissoes-v2.md`):

- [x] Níveis `owner` / `active` / `witness` / `recovery`
- [x] Produção: assinante = `witness` registrado; recompensa na **conta**
- [x] Ops multisig incluem `VOTE`, `SET_COMMISSION`, `CLAIM_VOTER_REWARD`
- [x] Trava histórica `staked == 0` para virar multisig **cai no fork v2** (abaixo do height ainda bloqueia)
- [x] Slash aponta para `producerAccount` quando há witness

### O buraco que existia (e por que o launch depende do v2)

A trava “conta com stake não pode virar multisig” existia porque `VOTE` / comissão **não** eram ops multisig — o validador ficaria com stake e voto presos.  
Documentado em `docs/permissoes-v2.md`.

**Consequência:** a tese “validador = multisig desde o dia 1” **só fecha** se o unblock v2 for **pré-requisito do launch da Âncora**, não polish. Na chain econômica: `PERMISSIONS_V2_HEIGHT` cedo (0 ou baixo) + testes e2e.

### Modelo certo (não tudo multisig)

| Papel | Como |
|---|---|
| **Owner / identidade fria** | **2-de-3** (ou 3-de-5) — rotacionar hot, comissão crítica, sair do ranking |
| **Witness / hot** | **1 chave** no VPS — só produzir bloco / attest (rápido, sem assembleia a cada slot) |

Multisig em **todo** bloco mataria latência. Multisig na **alma** da Âncora é o que importa.

### Ordem de engenharia que faz sentido

1. Ampliar ops multisig: `VOTE`, `SET_COMMISSION`, `CLAIM_VOTER_REWARD` — **feito** no v2  
2. Tirar a trava `staked == 0` — **feito** acima de `PERMISSIONS_V2_HEIGHT`  
3. Produto: “Âncora = owner M-of-N + witness hot” **obrigatório** (ou fortemente default) no onboarding — **faltando**  
4. No **lançamento**: v2 ativo desde a gênese (ou height irrelevante / 0) — **faltando amarrar na config de launch**

Sem (1)+(2) ativos na rede de launch, multisig “padrão desde o começo” **não dá** para validador real.  
Com (1)+(2) no código, o trabalho restante é tratar **gênese com v2 + onboarding Âncora** como parte do pacote, não polish.  
Ninguém usou em produção econômica: estamos **amadurecendo o lançamento**, não migrando usuários.

**Gap real hoje:** produto + política + (fase 2) época — não “inventar multisig de validador”.

---

## Como salvar a chave PQ fria

A chave **PQ fria** (identidade da Âncora / material do **owner**) **não fica no VPS**.  
O servidor só tem a **quente** (`witness`).

### O que guardar

- Seed / material da chave **híbrida** (ou o pacote que o SDK já exporta), **offline**
- Ideal: **duas cópias** geograficamente separadas + um **procedimento escrito** de rotação
- Com owner 2-de-3: cada share segue a mesma disciplina (offline, separado, testado)

### Onde (do mais simples ao mais duro)

**1. Paper / metal (seed)**  
Seed em papel ou placa de aço (Cryptosteel etc.), cofre.  
Barato e ok para mainnet pequeno.  
Risco: foto, umidade, alguém com acesso físico.

**2. Pendrive air-gapped**  
USB só usado num laptop **sem rede** para assinar: “nova hot key” (rotação de `witness`), troca de comissão crítica, exit, etc. Depois desliga e guarda.  
Bom equilíbrio custo/segurança.

**3. HSM / YubiHSM / Cloud HSM**  
Chave nasce e nunca sai do hardware; o HSM assina as declarações on-chain.  
Melhor para operador profissional; custo e ops maiores.  
Para Dilithium/ML-DSA: checar se o HSM **já** suporta o esquema (muitos ainda não) — aí HSM guarda seed AES-wrapped ou usa software PQ em máquina isolada.

**4. Multisig / 2-de-3 social (protocolo — desde o começo)**  
Identidade fria = 2 de 3 partes (sócio A, sócio B, cofre).  
Um VPS ou um sócio sozinho não rouba a Âncora.  
Isto **não** é “upgrade futuro”: é o padrão de produto no launch (secção acima).  
HSM continua podendo entrar depois, por volume/equipe.

### Fluxo operacional (simples)

| Ação | Quem assina |
|---|---|
| Produzir bloco / attest | **hot** (`witness`) no VPS |
| Rotacionar hot key | **fria** (owner / multisig), offline |
| Mudar comissão / sair do ranking (crítico) | **fria** (ou hybrid fresco via owner/multisig) |
| Backup perdido | recuperação pelos shares/seeds offline (2-de-3) |

### Regra de ouro

- Nunca colar a fria em `.env`, painel web ou Docker do validador  
- Hot pode ser regenerada; fria é o que o stake e o nome da Âncora **amarrram** on-chain  
- Teste de restauração **uma vez** antes de mainnet (abrir backup num air-gap e ver se deriva o mesmo endereço / completar limiar 2-de-3)

### Na prática, para o launch

- **Custódia física:** seed em **metal/papel** + **USB air-gap** para assinar rotações  
- **Identidade on-chain:** **multisig 2-de-3 desde o começo**  
- **HSM:** depois, quando houver volume e equipe (e suporte PQ claro)

## Trilha (checklist)

### A — Spec / política (sem consenso novo)

- [x] Decisão registrada neste plano
- [x] Whitepaper: secção Âncora (EN + PT) — owner M-of-N, witness, por que não multisig por bloco
- [ ] Portal `/developers`: guia “virar Âncora” (criar 3 chaves, `PERMISSION_UPDATE` v2, registrar witness, stake/voto)
- [ ] Política de rede / testnet: **candidatos ao top-N com owner limiar ≥ 2** (ou score público “multisig: sim/não”)
- [ ] Runbook operador: copiar secções “Multisig desde o começo” + “Como salvar a chave PQ fria” (paper, pendrive, HSM, fluxo, regra de ouro)

### B — Amarrar no lançamento (gênese / config)

- [ ] `PERMISSIONS_V2_HEIGHT` = **0** (ou já passado) na config de launch — sem “esperar o fork”
- [ ] Confirmar onboarding: conta com stake pode `PERMISSION_UPDATE` v2 sem unstake (já gated; cobrir com teste e2e “Âncora”)
- [x] Se ainda faltar UX de txs: templates SDK `ancora_init` / `ancora_rotate_witness` (wrappers, não novos tipos)
- [ ] Testes de ataque: 1 chave owner roubada não rota witness; VPS comprometido não move stake
- [ ] `GOV_PROPOSE` / `GOV_VOTE`: só `owner`/multisig — nunca `witness` → detalhe e checklist em [14](14-governanca-ancora.md)

### C — Produto Core / explorador / carteira

- [ ] `eav7-core`: fluxo “Âncora” — gera N seeds, imprime backup, grava só witness no keystore do nó
- [ ] Explorador: badge **Âncora** + “owner M-of-N” + endereço witness (sem expor material secreto)
- [ ] Carteira / app eleitor: votar em Âncoras; aviso se validador ainda é chave única
- [ ] Score público (opcional fase C): uptime, comissão, multisig, idade — sem IA no consenso

### C2 — Governança PQ (opção 4 · fase 1.5)

- [ ] Docs/produto: ops de poder da Âncora (voto próprio, comissão, rotação witness, exit) **só** via `owner`/multisig — nunca só com witness
- [ ] Teste: witness sozinho não altera comissão nem conjunto de permissões
- [ ] Teste/narrativa: tx dessas ops rejeitada sem metade híbrida válida (`eav7-hybrid-1`) — alinhar ao que o nó já exige em assinatura
- [x] Whitepaper: uma frase — “quebra de ECDSA não redireciona a eleição sem PQ”

### D — Certificado de época híbrido *(opção 3 · fork — fase 2)*

Objetivo: a cada N blocos ou mudança do conjunto eleito, emitir artefato verificável:

`epochId · validatorSetRoot · stateRoot · height` assinado por **≥ quórum** com **eav7-hybrid-1**.

- [ ] Spec: tamanho do cert, janela, o que light client exige
- [ ] `config.rs`: `EPOCH_CERT_HEIGHT`, `EPOCH_CERT_INTERVAL` (proposta)
- [ ] Produção / BFT: coletar assinaturas híbridas; persistir no store; servir na API
- [ ] SDK: `verify_epoch_cert`
- [ ] Ponte: consumir cert como âncora de conjunto — ver [18](18-ponte-committee-breaker.md) E
- [ ] Testes: quórum insuficiente rejeita; ECDSA-only não basta; rotação de set invalida cert antigo

**Constante nova (proposta):** se época não estiver pronta no dia 1, `EPOCH_CERT_HEIGHT` distante; se estiver, **gênese junto** com GB e Âncora — ainda é launch, não migração.

### E — Lançamento

- [ ] Fase A+B+C **no dia 1** do launch público (validadores = Âncoras)
- [ ] Fase D (época): no mesmo gênese se couber; senão height futuro anunciado (ainda sem usuários a migrar)
- [ ] Nunca exigir multisig por bloco
- [ ] Documentar heights de launch em `docs/rollout-forks.md` / config de gênese

## Fora de escopo no launch (de propósito)

- VRF pós-quântico / threshold Dilithium agregado  
- Multisig em cada cabeçalho de bloco  
- Recovery M-of-N (v2 fechou em 1 chave)  
- “IA elege validador”  
- Renomear tipos JSON-RPC para `Anchor` (só UX)  

Quando (ou se) voltar: [15](15-longo-prazo-adiados.md).

## Riscos

| Risco | Mitigação |
|---|---|
| Operador ignora M-of-N | Default no Core + badge / política de ranking |
| UX pesada demais | Witness e active leves; multisig só no que importa |
| Cert de época grande (sigs PQ) | Intervalo largo; talvez só mudançade set + checkpoint |
| Confusão nome Âncora vs state-root “âncora” nos docs antigos | Glossário: **Âncora** = validador produto; “âncora de estado” = termo técnico de root |

## Ordem sugerida vs outros planos

Contexto: **lançamento** — sem mainnet econômica, sem base de usuários a migrar.

1. Gênese com v2 + amarração gov/Âncora (**este plano B**)  
2. Onboarding Âncora no Core (**C**) em paralelo ao [08](08-descentralizacao-core-carteira.md)  
3. [12](12-gb-assinatura-livre.md) GB na **mesma gênese** se o modelo de taxa já estiver fechado  
4. Governança amarrada ([14](14-governanca-ancora.md)) na mesma gênese  
5. Certificado de época (**D**) no gênese se pronto; senão logo após, ainda pré-adoção

## Ligação

- Permissões: `docs/permissoes-v2.md` · `rust/src/state/gov.rs` · `rust/src/blockchain.rs` (witness)  
- Governança: [14](14-governanca-ancora.md)  
- Bridge/epoch existente (committee): `rust/src/state/bridge.rs` — reusar ideias, não misturar sem spec  
- Set / quantas Âncoras: [17](17-set-51-banco-101.md) (51 + banco 101)  
- Mapa: [10](10-mapa-integrado.md) · melhorias: [11](11-mapa-melhorias-projeto.md) · taxa: [12](12-gb-assinatura-livre.md)
