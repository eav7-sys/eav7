# Plano: Longo prazo · o que ficou de fora (consciente)

**Status:** aceito em desenho (2026-08-09) — mapa de maturidade, **não** backlog de launch  
**Contexto:** lançamento ainda em amadurecimento; sem mainnet econômica.  
**Launch (dia 1)** vive em [12](12-gb-assinatura-livre.md) · [13](13-ancora-pq-multisig.md) · [14](14-governanca-ancora.md).  
**Este doc** só trata do que **deliberadamente** não entra no gênese — e **quando** (ou se) revisitar.

## Em uma frase

Nada do que ficou fora é “esquecido”: cada item tem **pré-condição**, **risco se antecipar** e **forma consciente** — ou fica marcado como pesquisa / provavelmente nunca.

## Princípio

| Regra | Significado |
|---|---|
| Launch primeiro | Alma Âncora + gov owner-only + taxa GB (se fechada) na gênese |
| Pré-condição explícita | Sem gate batido, o item **não** sobe de prioridade por hype |
| Um soberano por vez | Não adicionar segundo eixo de poder (holders, council, IA) antes do primeiro ser real |
| Fork só com motivo | Mudança de consenso depois do launch exige usuários/valor → anúncio + height; até lá, preferir gênese limpa |
| Honestidade | Whitepaper e produto admitem o estágio; não maquiar descentralização |

## Portões de maturidade (gates)

Usar estes gates como chave dos itens abaixo. Números são **ordem de grandeza**, não SLA.

| Gate | Condição (aproximada) | O que desbloqueia |
|---|---|---|
| **G0** | Gênese de launch: Âncora M-of-N, gov=[14], v2 ativo, set fundação 3–7 | Rede nasce coerente |
| **G1** | ≥ **15** Âncoras distintas operando; multisig observável na maioria do top set; runbooks usados de verdade | Ops HSM; classes de timelock se não foram no dia 1; cert de época “bom ter” |
| **G2** | ≥ **~40** no set ativo (caminho aos **51**); top 101 com diversidade; stake/votos **não** dominados por uma entidade; ponte com committee real + breaker ligado | Cert de época como dependência de ponte/light client; gov “dura” bem exercitada; cogitar 101 ativos via gov — ver [17](17-set-51-banco-101.md) |
| **G3** | Diversidade de holders + Âncoras; métricas públicas de concentração (ex. top-1 / top-5 stake e votos) abaixo de limiar a definir; auditoria externa de gov | Debater **veto/signal** de holders (não substituir Âncoras de cara) |
| **G4** | Pesquisa PQ / HSM com suporte ML-DSA (ou padrão NIST estável em hardware) comprovado em PoC interno | HSM nativo PQ; aggregação/threshold **só** com paper + PoC |
| **G∞** | Premissa inválida ou risco > benefício permanente | **Não fazer** (ou só off-chain sem poder) |

Medir gates no explorador/Core (contagem de Âncoras, % com owner limiar ≥ 2, concentração de votos) — sem isso o longo prazo vira achismo.

---

## Inventário do que ficou fora

### A — Quase-launch / v1.1 (logo após G0, sem segundo soberano)

| ID | Item | Origem | Pré-condição | Forma consciente | Risco se fizer cedo |
|---|---|---|---|---|---|
| A1 | **Classes de proposta leve/dura** (timelock maior no duro) | [14](14-governanca-ancora.md) | G0; se não entrou no dia 1 | Fork ou param gov: `GOV_TIMELOCK_HARD_BLOCKS` + mapa de params | Baixo — só atrasa se virar blocker de launch |
| A2 | **UX timelock** (texto humano, countdown) | [14](14-governanca-ancora.md) | G0 | Só produto; sem consenso | Nenhum de protocolo |
| A3 | **Score público da Âncora** (uptime, comissão, multisig, idade) | [13](13-ancora-pq-multisig.md) | G0–G1 | Off-chain / indexer; **zero** poder de consenso | Virar ranking que “elege” sem voto = teatro |
| A4 | **Sponsor GB / tetos** finos | [12](12-gb-assinatura-livre.md) | G0 + uso real de apps | Ajuste de param / tipo já previsto no 12 | Over-design sem demanda |

### B — Custódia e ops (sem mudar quem manda)

| ID | Item | Origem | Pré-condição | Forma consciente | Risco se fizer cedo |
|---|---|---|---|---|---|
| B1 | **HSM** para owner e/ou witness | [13](13-ancora-pq-multisig.md) | G1 + PoC: HSM assina híbrido ou seed wrapped + máquina isolada | Runbook + integração Core; **não** exige fork | Comprar HSM que não fala ML-DSA → falsa segurança |
| B2 | **Recovery M-of-N** | [13](13-ancora-pq-multisig.md) / permissoes-v2 | G2 + desenho anti-trava | Fork de permissões (v2 fechou recovery = 1) | Complica recovery sem benefício se owner já é 2-de-3 |
| B3 | **SLH-DSA (ou similar) só na recovery** | permissoes-v2 “fora” | G4 | Opcional por chave | Fragmentação de clientes |

### C — Provas de rede e ponte (fase 2 técnica)

| ID | Item | Origem | Pré-condição | Forma consciente | Risco se fizer cedo |
|---|---|---|---|---|---|
| C1 | **Certificado de época híbrido** | [13](13-ancora-pq-multisig.md) opção 3 | G1 desejável; **G2** se ponte custodia valor | Fork `EPOCH_CERT_*`; N sigs híbridas explícitas primeiro | Cert enorme; complexifica BFT sem light client consumidor |
| C2 | **Light client / Core ouvinte** consumindo C1 + stateRoot | [08](08-descentralizacao-core-carteira.md) · [10](10-mapa-integrado.md) | C1 + `STATEROOT` na gênese | SDK `verify_epoch_cert` + inclusion | Light client sem cert = confiança no nó de novo |
| C3 | **Ponte com valor** | whitepaper bridge · [18](18-ponte-committee-breaker.md) | Checklist [18] verde (+ C1 recomendado) | Não é “gov resolve” — handoff assinado | Mint sob committee frágil |

### D — Segundo eixo de poder (só com G3+)

| ID | Item | Origem | Pré-condição | Forma consciente | Risco se fizer cedo |
|---|---|---|---|---|---|
| D1 | **Sinal / veto de holders** (não 1:1 substituindo Âncoras) | [14](14-governanca-ancora.md) fora | **G3** + limiar de concentração publicado | Ex.: holders podem **atrasar** proposta dura no timelock, não aprovar sozinhos; ou snapshot só em params da classe dura | Plutocracia fundação; dual soberano; captura |
| D2 | **1 token = 1 voto pleno** | [14](14-governanca-ancora.md) fora | Quase **G∞** na prática atual; só com G3 **e** tese nova escrita | Se um dia: ramo separado do whitepaper, não “ligar flag” | Mentira de descentralização |
| D3 | **Conselho off-chain com poder de protocolo** | [14](14-governanca-ancora.md) fora | **G∞** para poder de consenso | Conselho **comunicado / emergência social** ok; chave mestra **não** | Teatro de governança |
| D4 | **IA com peso** (voto, veto, ranking que mexe set) | [14](14-governanca-ancora.md) fora | **G∞** para poder; advisor continua | Melhorar **draft** e explicabilidade; nunca assinatura — produto em [16](16-ia-oraculo-ops.md) | Ataque ao modelo = ataque à gov |

**Postura default em D:** D3 e D4 permanecem **não** (poder). D1 só como *upgrade consciente* pós-G3. D2 exige reescrever a tese política da rede.

### E — Pesquisa PQ / consenso (não calendário)

| ID | Item | Origem | Pré-condição | Forma consciente | Risco se fizer cedo |
|---|---|---|---|---|---|
| E1 | **Agregação / threshold Dilithium** (certs menores) | [13](13-ancora-pq-multisig.md) | G4 + paper estável + PoC | Substituir N sigs em C1 **depois** de C1 funcionar | Adiar C1 eternamente esperando research |
| E2 | **VRF pós-quântico / leader election** | [13](13-ancora-pq-multisig.md) | G4 + padrão de indústria | Só se o sorteio atual for ataque real documentado | Complexidade sem ameaça atual |
| E3 | Tip / fee market para produtor | [12](12-gb-assinatura-livre.md) fora | Demanda de congestão real | Mudança de economia = fork + política | Contradiz “100% burn” sem debate |
| E4 | Loja de pacotes GB “ouro/diamante” | [12](12-gb-assinatura-livre.md) fora | **G∞** como produto core | App pode vender UX; protocolo não vira operadora |

---

## Linha do tempo (ordem, não datas)

```
G0  Lançamento
    └─ 12 GB · 13 Âncora · 14 Gov owner-only
         │
         ├─ A1–A4  (v1.1: classes, UX, score, sponsor fino)
         │
G1  Ops madura
         ├─ B1 HSM
         └─ C1 cert época (se já houver consumidor)
         │
G2  Set + ponte sérios
         ├─ C1 obrigatório se ponte com valor
         ├─ C2 light client
         └─ B2 recovery M-of-N (só se dor real)
         │
G3  Concentração baixa
         └─ D1 veto/signal holders?  (decisão nova — não automática)
         │
G4  Hardware/pesquisa
         └─ E1 (e só então enxugar C1)
         │
G∞  Não fazer
         └─ D2 pleno · D3 poder · D4 IA-voto · E4 loja-protocolo
```

## Decisões que este plano **não** toma sozinho

Estes exigem nova rodada explícita (como 12–14), não “subir o item do backlog”:

1. **D1** — formato exato do sinal/veto de holders  
2. **C1** no gênese vs height futuro (se ponte ainda não custodia)  
3. Qualquer abandono de **100% burn** (E3)  

## Checklist de manutenção deste mapa

- [ ] Após G0: marcar A1–A4 feitos/adiados com data  
- [ ] Dashboard simples de gates (N Âncoras, % multisig, concentração)  
- [ ] Revisão semestral: algum item E virou padrão de indústria?  
- [ ] Nunca promover D3/D4/E4 sem reabrir decisão em `06-decisoes-abertas.md`

## Ligação

- Launch: [21](21-launch-checklist.md) (mestre) · [12](12-gb-assinatura-livre.md)–[20](20-consenso-liveness-finality.md)  
- Core/descentralização: [08](08-descentralizacao-core-carteira.md) · [10](10-mapa-integrado.md)  
- Decisões: [06](06-decisoes-abertas.md) · melhorias: [11](11-mapa-melhorias-projeto.md)
