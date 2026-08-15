//! Camada nativa de inteligência artificial.
//!
//! Porte de `src/core/state.js` (o nó de referência), casos `AI_*`. A camada é um
//! MERCADO de computação de IA liquidado on-chain: o solicitante escrowa uma
//! recompensa, um ou mais oráculos entregam um resultado, e o protocolo decide
//! quem é pago. As cinco fases da referência convivem no mesmo código porque cada
//! uma entrou por um FORK DE ALTURA diferente e as anteriores continuam valendo
//! para as tarefas antigas:
//!
//! | fase | fork                        | o que acrescenta                       |
//! |------|-----------------------------|----------------------------------------|
//! | 1    | `AI_ACCOUNTABILITY_HEIGHT`  | reputação + slash de quem não entrega   |
//! | 2    | `AI_QUORUM_HEIGHT`          | N oráculos com commit-reveal            |
//! | 3    | `AI_CHALLENGE_HEIGHT`       | escrow com janela de desafio + júri     |
//! | 4    | `AI_MARKET_HEIGHT`          | leilão (lance + adjudicação)            |
//! | 5    | `AI_PRIVATE_HEIGHT`         | resultado só por hash (output off-chain)|
//! | 6    | `AI_TEE_HEIGHT`             | atestação TEE/zk (portada)               |
//!
//! Invariante que vale para TODO manipulador deste módulo: se retornar `Err`, o
//! estado tem de estar exatamente como estava. A referência ganha isso de graça
//! (opera sobre um clone que descarta ao lançar); aqui cada caso está escrito em
//! duas fases explícitas — VALIDA tudo lendo, só então MUTA. Onde a referência
//! debita a taxa antes de uma checagem que ainda pode falhar, a checagem foi
//! antecipada; a ORDEM DAS MENSAGENS DE ERRO foi preservada, que é o que um
//! cliente observa de fora.
//!
//! # Fase 6 (atestação TEE/zk) — PORTADA
//!
//! `AI_RESULT` com `data.attestation` acima de `AI_TEE_HEIGHT` verifica a prova
//! com `bridge::ai_attest_digest` + `bridge::verify_committee_proof` — a MESMA
//! contagem que a ponte usa (dedup por endereço recuperado, não-membro ignorado),
//! porque a propriedade de segurança é idêntica. Quórum insuficiente derruba a
//! transação inteira; atestação válida liquida NA HORA, sem janela de desafio,
//! porque a garantia é criptográfica e não reputacional.

use super::{soma, Amount, Ctx, State, StateError};
use crate::address::is_valid_address;
use crate::canonical::Value;
use crate::hash::eav_hash_one;
use crate::transaction::{JsonValue, Tx};
use std::collections::BTreeMap;

// ============================================================================
// Constantes — valores de `src/config.js` (objeto CHAIN)
// ============================================================================

/// 1 EAV7 em e7. `const UNIT = 1_000_000n` em `src/config.js:12`.
///
/// Hoje só os testes deste módulo a usam (os valores de consenso já vêm
/// convertidos das constantes acima); fica declarada porque é a unidade em que
/// todo valor monetário do módulo é expresso.
#[allow(dead_code)]
const UNIT: Amount = crate::config::UNIT as Amount;

/// `AI_ACCOUNTABILITY_HEIGHT` — a partir daqui o oráculo designado que deixa a
/// tarefa expirar é responsabilizado (reputação + slash).
const AI_ACCOUNTABILITY_HEIGHT: u64 = crate::config::AI_ACCOUNTABILITY_HEIGHT;
/// `AI_QUORUM_HEIGHT` — habilita o modo QUÓRUM com commit-reveal.
const AI_QUORUM_HEIGHT: u64 = crate::config::AI_QUORUM_HEIGHT;
/// `AI_CHALLENGE_HEIGHT` — habilita a verificação otimista (escrow + júri).
const AI_CHALLENGE_HEIGHT: u64 = crate::config::AI_CHALLENGE_HEIGHT;
/// `AI_MARKET_HEIGHT` — habilita o leilão de oráculos.
const AI_MARKET_HEIGHT: u64 = crate::config::AI_MARKET_HEIGHT;
/// `AI_PRIVATE_HEIGHT` — habilita o resultado só-hash (output off-chain).
const AI_PRIVATE_HEIGHT: u64 = crate::config::AI_PRIVATE_HEIGHT;
/// `AI_TEE_HEIGHT` — atestação TEE/zk. A referência lê de `EAV7_AI_TEE_HEIGHT`
/// com este padrão; o override existe para um rollout coordenado entre os nós, e
/// enquanto ele não acontece a fase está efetivamente desligada.
const AI_TEE_HEIGHT: u64 = crate::config::AI_TEE_HEIGHT;

/// `MAX_AI_PROMPT_BYTES` — 8 KiB.
const MAX_AI_PROMPT_BYTES: usize = crate::config::MAX_AI_PROMPT_BYTES as usize;
/// `MAX_AI_OUTPUT_BYTES` — 32 KiB.
const MAX_AI_OUTPUT_BYTES: usize = crate::config::MAX_AI_OUTPUT_BYTES as usize;
/// `MAX_AI_URI_BYTES` — ponteiro para o resultado off-chain.
const MAX_AI_URI_BYTES: usize = crate::config::MAX_AI_URI_BYTES as usize;
/// `AI_TASK_TIMEOUT_MS` — 1 h. Depois disso a tarefa não atendida é reembolsável.
const AI_TASK_TIMEOUT_MS: u64 = crate::config::AI_TASK_TIMEOUT_MS;
/// `AI_ORACLE_SLASH` — penalidade de não-entrega, paga ao prejudicado.
const AI_ORACLE_SLASH: Amount = crate::config::AI_ORACLE_SLASH as Amount;

/// `AI_COMMIT_WINDOW_MS` / `AI_REVEAL_WINDOW_MS` — 30 min cada.
const AI_COMMIT_WINDOW_MS: u64 = crate::config::AI_COMMIT_WINDOW_MS;
const AI_REVEAL_WINDOW_MS: u64 = crate::config::AI_REVEAL_WINDOW_MS;
/// `MIN_AI_QUORUM` / `MAX_AI_QUORUM`.
const MIN_AI_QUORUM: u64 = crate::config::MIN_AI_QUORUM;
const MAX_AI_QUORUM: u64 = crate::config::MAX_AI_QUORUM;

/// `AI_CHALLENGE_WINDOW_MS` / `AI_VERDICT_WINDOW_MS` — 30 min cada.
const AI_CHALLENGE_WINDOW_MS: u64 = crate::config::AI_CHALLENGE_WINDOW_MS;
const AI_VERDICT_WINDOW_MS: u64 = crate::config::AI_VERDICT_WINDOW_MS;
/// `AI_CHALLENGE_BOND` — fiança do desafiante, perdida se o resultado for mantido.
const AI_CHALLENGE_BOND: Amount = crate::config::AI_CHALLENGE_BOND as Amount;
/// `AI_VERDICT_QUORUM` — jurados necessários para decidir a disputa.
const AI_VERDICT_QUORUM: usize = crate::config::AI_VERDICT_QUORUM as usize;

/// `AI_BID_WINDOW_MS` — janela de lances numa tarefa aberta.
const AI_BID_WINDOW_MS: u64 = crate::config::AI_BID_WINDOW_MS;

/// Reputação inicial de um oráculo. A referência escreve `reputation: 50` no
/// registro e lê em toda parte como `(oracle.reputation ?? 50)` — ver `Oracle`.
const REPUTACAO_INICIAL: u8 = 50;
/// Passos de reputação da referência: acerto, erro grave, voto com a maioria,
/// voto contra a maioria, e commit sem reveal.
const REP_ACERTO: u8 = 4;
const REP_ERRO: u8 = 12;
const REP_JURADO_CERTO: u8 = 2;
const REP_JURADO_ERRADO: u8 = 4;
const REP_NAO_REVELOU: u8 = 8;
/// Teto da reputação (`Math.min(100, …)`).
const REP_MAX: u8 = 100;

/// Comprimento máximo do salt do commit-reveal, em unidades de código UTF-16 —
/// `salt.length` no JS conta UTF-16, não bytes. Só diverge fora do BMP, mas é
/// exatamente o tipo de entrada que um atacante monta para fazer dois clientes
/// discordarem.
const MAX_SALT_LEN: usize = 128;

// ============================================================================
// Tipos de estado
// ============================================================================

/// Oráculo de IA registrado.
///
/// `reputation` é `Option<u8>` de propósito, e não `u8`: a referência lê sempre
/// como `(oracle.reputation ?? 50)`, porque oráculos registrados ANTES da Fase 1
/// simplesmente não têm o campo. `None` reproduz esse "campo ausente" — e, de
/// quebra, um `Oracle` construído por `Default` em outro módulo não vira um
/// oráculo de reputação zero por acidente.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Oracle {
    pub address: String,
    pub stake: Amount,
    pub registered_at: u64,
    /// `tasksCompleted` — contador histórico, anterior à Fase 1.
    pub tasks_completed: u64,
    /// `completed` / `failed` — placar de reputação da Fase 1 (`?? 0` na referência).
    pub completed: u64,
    pub failed: u64,
    /// `slashed` — total já confiscado do stake (`?? 0n` na referência).
    pub slashed: Amount,
    /// `reputation` 0..100. `None` == campo ausente == 50. Ver a nota do tipo.
    pub reputation: Option<u8>,
    /// `bridgeTransfers` — contador do literal de registro (`state.js:2022`).
    /// Nasce em 0 e nenhum manipulador portado o incrementa; existe porque a folha
    /// `orc` da rede o tem, e uma chave a menos muda a raiz.
    pub bridge_transfers: u64,
    /// `endpoint` — URL do serviço do oráculo. `None` == `null` (a chave EXISTE),
    /// não "campo ausente": o literal de registro escreve `endpoint: null`.
    pub endpoint: Option<String>,
}

impl Oracle {
    /// Oráculo recém-registrado, como `ORACLE_REGISTER` o cria na referência.
    ///
    /// Existe aqui porque quem trata `ORACLE_REGISTER` é OUTRO módulo: sem um
    /// construtor, aquele módulo montaria o registro por `Default` e o oráculo
    /// nasceria com reputação `None`. `None` é lido como 50, então nem isso quebra
    /// — mas o registro fica explícito, que é o que se quer.
    pub fn registrado(address: impl Into<String>, stake: Amount, registered_at: u64) -> Self {
        Oracle {
            address: address.into(),
            stake,
            registered_at,
            reputation: Some(REPUTACAO_INICIAL),
            ..Default::default()
        }
    }

    /// Reputação efetiva — o `?? 50` da referência, num lugar só.
    fn rep(&self) -> u8 {
        self.reputation.unwrap_or(REPUTACAO_INICIAL)
    }

    /// `Math.min(100, rep + passo)`. Saturante por construção: `u8` mais o passo
    /// nunca passa de 100 depois do `min`, mas `saturating_add` fecha a porta.
    fn sobe(&mut self, passo: u8) {
        self.reputation = Some(self.rep().saturating_add(passo).min(REP_MAX));
    }

    /// `Math.max(0, rep - passo)`.
    fn desce(&mut self, passo: u8) {
        self.reputation = Some(self.rep().saturating_sub(passo));
    }

    /// Registro de entrega bem-sucedida: os dois contadores da referência sobem
    /// (`tasksCompleted` é o antigo, `completed` é o da Fase 1) e a reputação sobe.
    fn creditar_acerto(&mut self) {
        self.tasks_completed = self.tasks_completed.saturating_add(1);
        self.completed = self.completed.saturating_add(1);
        self.sobe(REP_ACERTO);
    }
}

/// Tarefa da camada de IA.
///
/// A referência não tem UM formato de tarefa: tem três objetos literais, escolhidos
/// pelo modo de criação (`state.js:1961` quórum, `:1977` aberto, `:1993`
/// designado), e cada um traz um conjunto de chaves próprio. O porte guardava a
/// UNIÃO dos três numa struct plana e reconstruía a forma na serialização a partir
/// de discriminantes espalhados: `mode == ""`, `oracle.is_some()`,
/// `challenge_deadline != 0`, `challenger.is_some()`. Cada discriminante desses é
/// um invariante mantido por convenção — e "convenção" aqui significa uma folha do
/// `stateRoot` diferente da rede assim que alguém preenche o campo errado.
///
/// Aqui o núcleo comum fica na struct e o que é POLIMÓRFICO vira `TaskKind`. O que
/// deixou de ser representável:
///
/// - tarefa de quórum com `bids`/`private`/`assignedOracle` (o literal `:1961` não
///   tem nenhum dos três);
/// - `winners` fora do modo quórum;
/// - tarefa designada sem oráculo designado (o literal `:1993` valida o endereço
///   antes de escrever, então ele nunca é nulo);
/// - `resultUri` sem `oracle` — os dois nascem juntos em `AI_RESULT`;
/// - `bond`/`challenger`/`verdictDeadline`/`votes` sem janela de desafio aberta.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Task {
    pub id: String,
    pub requester: String,
    pub reward: Amount,
    /// `status` da referência: PENDING | BIDDING | CHALLENGE_PERIOD | DISPUTED |
    /// DONE | UPHELD | OVERTURNED | REFUNDED.
    pub state: String,
    /// `expiresAt` da referência — o prazo que habilita `AI_REFUND`.
    pub deadline: u64,
    /// Resultado. `output` é `None` no modo só-hash da Fase 5 e depois da poda.
    pub result_hash: Option<String>,
    pub output: Option<String>,
    /// Entrada da tarefa — podada (vira `None`) assim que a tarefa se resolve.
    pub prompt: Option<String>,
    pub params: Option<JsonValue>,
    pub model: Option<String>,
    pub created_at: u64,
    /// `completedAt` vem do `tx.timestamp` na referência, não do relógio do bloco.
    pub completed_at: Option<i64>,
    /// Fase 6: `"TEE"` | `"ZK"`. `None` == campo ausente, que é o que preserva a
    /// serialização histórica da tarefa.
    pub verified: Option<String>,
    /// O que é exclusivo de cada modo de criação.
    pub kind: TaskKind,
    /// Fase 3: a janela de desafio e a disputa. Fora dela NENHUMA das chaves da fase
    /// existe na folha, e é por isso que ela é um enum e não quatro campos zerados.
    pub challenge: Challenge,
}

/// Modo da tarefa — o literal de criação da referência, como tipo.
///
/// O `mode` transitar não era objeção: uma tarefa `OPEN` adjudicada continua sendo
/// `mode: 'OPEN'` no JS (o `AI_AWARD` só preenche `assignedOracle` e muda o
/// `status`), então o modo é imutável e a variante também.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskKind {
    /// Oráculo designado (`state.js:1993`). É o `Default` (ver o `impl` abaixo, que
    /// `#[default]` não cobre variante com campo) porque é o modo que existe desde o
    /// primeiro bloco da camada — os outros dois entraram por fork.
    ///
    /// NÃO tem a chave `mode`: a referência só a grava nos outros dois literais.
    Designada(Designada),
    /// Quórum com commit-reveal (`state.js:1961`), a partir de `AI_QUORUM_HEIGHT`.
    Quorum(Quorum),
    /// Leilão (`state.js:1977`), a partir de `AI_MARKET_HEIGHT`.
    Aberta(Aberta),
}

impl Default for TaskKind {
    fn default() -> Self {
        TaskKind::Designada(Designada::default())
    }
}

/// Modo de oráculo designado.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Designada {
    /// Sempre presente: `AI_TASK` recusa a transação se `data.oracle` não for um
    /// endereço válido, então este modo NUNCA tem `assignedOracle: null`. Era um
    /// `Option` na struct plana só porque o modo aberto precisava de um.
    pub assigned_oracle: String,
    /// Fase 5: prompt/output cifrados off-chain. Exclusivo deste literal, e sempre
    /// booleano (`tx.data.private === true`) — não é campo omitível.
    pub private: bool,
    pub entrega: Entrega,
}

/// Modo quórum. Nenhum campo de leilão nem de entrega individual: a tarefa se
/// resolve pela apuração das revelações, não por um oráculo entregador.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Quorum {
    /// Quantas revelações concordantes concluem a tarefa.
    pub quorum: u64,
    pub phase: Fase,
    pub commit_deadline: u64,
    pub reveal_deadline: u64,
    /// Compromissos: oráculo → hash. Guardado COMO VEIO (a referência não normaliza
    /// a caixa aqui); a comparação é que normaliza.
    pub commits: BTreeMap<String, String>,
    /// Revelações já apuradas: oráculo → `resultHash`. Corresponde ao `reveals` da
    /// referência DEPOIS da poda, que é a forma que sobrevive no estado.
    pub reveals: BTreeMap<String, String>,
    /// Output de cada revelação, ANTES da poda. A referência guarda
    /// `{resultHash, output}` e, ao concluir, joga o output fora; aqui o
    /// `resultHash` mora em `reveals` e o output neste mapa, que é esvaziado no
    /// mesmo momento. Estado final idêntico.
    pub reveal_outputs: BTreeMap<String, String>,
    /// ORDEM em que as revelações chegaram. `BTreeMap` ordena por endereço, e a
    /// referência itera por ordem de INSERÇÃO — a diferença decide quem recebe o
    /// resto da divisão da recompensa entre os vencedores. Um e7 de divergência
    /// ainda é divergência de consenso.
    ///
    /// Campo EXCLUSIVO deste cliente: não é emitido na folha (ver `to_value`).

    /// `winners: null` na criação, lista ao concluir. A chave existe sempre no modo
    /// quórum — e SÓ nele, que é o motivo de morar aqui dentro.
    pub winners: Option<Vec<String>>,
}

/// `phase` do modo quórum. Dois valores, e agora só dois.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Fase {
    #[default]
    Commit,
    Done,
}

impl Fase {
    fn texto(self) -> &'static str {
        match self {
            Fase::Commit => "COMMIT",
            Fase::Done => "DONE",
        }
    }
}

/// Modo aberto (leilão).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Aberta {
    /// Orçamento escrowado (teto dos lances).
    pub budget: Amount,
    pub bid_deadline: u64,
    /// Lances recebidos: oráculo → (preço, instante).
    pub bids: BTreeMap<String, (Amount, u64)>,
    /// `null` até `AI_AWARD` adjudicar — aqui o `Option` É fiel à referência.
    pub assigned_oracle: Option<String>,
    pub entrega: Entrega,
}

/// Estado da entrega nos modos que TÊM um oráculo entregador.
///
/// `AI_RESULT` grava `task.oracle` e `task.resultUri` no mesmo passo
/// (`state.js:2074`). Antes, a chave `resultUri` era emitida sob a condição
/// `oracle.is_some()` — uma dependência entre dois `Option` que o tipo não
/// registrava. Agora eles são um campo só, e "resultUri sem oracle" não existe.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum Entrega {
    /// `oracle: null` e SEM a chave `resultUri`.
    #[default]
    Pendente,
    /// `AI_RESULT` rodou. `result_uri` é `null` no modo só-hash sem ponteiro — a
    /// chave existe, com nulo, que é diferente de não existir.
    Entregue { oracle: String, result_uri: Option<String> },
}

/// Fase 3 — verificação otimista.
///
/// Os campos da fase nascem em DOIS momentos e a referência os grava em bloco:
/// `AI_RESULT` acima do fork cria `challengeDeadline`; `AI_CHALLENGE` cria
/// `bond`/`challenger`/`verdictDeadline`/`votes` de uma vez (`state.js:2154-2158`).
/// Como enum, "bond sem desafiante" e "desafiante sem janela" somem.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum Challenge {
    /// Abaixo de `AI_CHALLENGE_HEIGHT`, ou tarefa ainda não entregue: NENHUMA chave
    /// da fase aparece na folha.
    #[default]
    Nenhum,
    /// Janela aberta por `AI_RESULT`: só `challengeDeadline`.
    Janela { deadline: u64 },
    /// `AI_CHALLENGE` postou a fiança. `deadline` continua sendo emitido: a
    /// referência não apaga `challengeDeadline` ao abrir a disputa.
    Disputa {
        deadline: u64,
        challenger: String,
        bond: Amount,
        verdict_deadline: u64,
        /// jurado → "o resultado é válido?". Sobrevive VAZIO depois de resolvida a
        /// disputa: a referência faz `task.votes = {}`, não `delete`.
        votes: BTreeMap<String, bool>,
    },
}

/// Mapa vazio para os acessores devolverem quando a variante não tem o campo.
/// `const fn BTreeMap::new` permite que isto seja um `static`, sem alocação.
static SEM_VOTOS: BTreeMap<String, bool> = BTreeMap::new();
static SEM_TEXTO: BTreeMap<String, String> = BTreeMap::new();
static SEM_LANCES: BTreeMap<String, (Amount, u64)> = BTreeMap::new();

impl Task {
    /// `mode` da referência. `""` no modo designado — que é justamente a marca de
    /// "a chave `mode` não existe naquele literal".
    pub fn mode(&self) -> &'static str {
        match self.kind {
            TaskKind::Designada(_) => "",
            TaskKind::Quorum(_) => "QUORUM",
            TaskKind::Aberta(_) => "OPEN",
        }
    }

    /// Oráculo de quem se espera a entrega. `None` no modo quórum (que não tem
    /// designado nenhum) e no leilão ainda não adjudicado.
    pub fn assigned_oracle(&self) -> Option<&str> {
        match &self.kind {
            TaskKind::Designada(d) => Some(&d.assigned_oracle),
            TaskKind::Aberta(a) => a.assigned_oracle.as_deref(),
            TaskKind::Quorum(_) => None,
        }
    }

    /// Oráculo que de fato entregou.
    pub fn oracle(&self) -> Option<&str> {
        match self.entrega() {
            Some(Entrega::Entregue { oracle, .. }) => Some(oracle),
            _ => None,
        }
    }

    fn entrega(&self) -> Option<&Entrega> {
        match &self.kind {
            TaskKind::Designada(d) => Some(&d.entrega),
            TaskKind::Aberta(a) => Some(&a.entrega),
            TaskKind::Quorum(_) => None,
        }
    }

    fn entrega_mut(&mut self) -> Option<&mut Entrega> {
        match &mut self.kind {
            TaskKind::Designada(d) => Some(&mut d.entrega),
            TaskKind::Aberta(a) => Some(&mut a.entrega),
            TaskKind::Quorum(_) => None,
        }
    }

    /// Dados do modo quórum, ou `None` nos outros modos.
    pub fn quorum(&self) -> Option<&Quorum> {
        match &self.kind {
            TaskKind::Quorum(q) => Some(q),
            _ => None,
        }
    }

    fn quorum_mut(&mut self) -> Option<&mut Quorum> {
        match &mut self.kind {
            TaskKind::Quorum(q) => Some(q),
            _ => None,
        }
    }

    pub fn aberta(&self) -> Option<&Aberta> {
        match &self.kind {
            TaskKind::Aberta(a) => Some(a),
            _ => None,
        }
    }

    /// `challengeDeadline`; 0 quando a fase nem começou — o mesmo valor que o campo
    /// zerado tinha antes, para as comparações de prazo continuarem lendo igual.
    pub fn challenge_deadline(&self) -> u64 {
        match self.challenge {
            Challenge::Nenhum => 0,
            Challenge::Janela { deadline } | Challenge::Disputa { deadline, .. } => deadline,
        }
    }

    pub fn verdict_deadline(&self) -> u64 {
        match self.challenge {
            Challenge::Disputa { verdict_deadline, .. } => verdict_deadline,
            _ => 0,
        }
    }

    pub fn challenger(&self) -> Option<&str> {
        match &self.challenge {
            Challenge::Disputa { challenger, .. } => Some(challenger),
            _ => None,
        }
    }

    pub fn bond(&self) -> Amount {
        match self.challenge {
            Challenge::Disputa { bond, .. } => bond,
            _ => 0,
        }
    }

    pub fn votes(&self) -> &BTreeMap<String, bool> {
        match &self.challenge {
            Challenge::Disputa { votes, .. } => votes,
            _ => &SEM_VOTOS,
        }
    }

    pub fn commits(&self) -> &BTreeMap<String, String> {
        self.quorum().map(|q| &q.commits).unwrap_or(&SEM_TEXTO)
    }

    pub fn reveals(&self) -> &BTreeMap<String, String> {
        self.quorum().map(|q| &q.reveals).unwrap_or(&SEM_TEXTO)
    }

    pub fn reveal_outputs(&self) -> &BTreeMap<String, String> {
        self.quorum().map(|q| &q.reveal_outputs).unwrap_or(&SEM_TEXTO)
    }

    pub fn winners(&self) -> Option<&[String]> {
        self.quorum().and_then(|q| q.winners.as_deref())
    }

    pub fn bids(&self) -> &BTreeMap<String, (Amount, u64)> {
        self.aberta().map(|a| &a.bids).unwrap_or(&SEM_LANCES)
    }

    pub fn phase(&self) -> Option<Fase> {
        self.quorum().map(|q| q.phase)
    }

    pub fn result_uri(&self) -> Option<&str> {
        match self.entrega() {
            Some(Entrega::Entregue { result_uri, .. }) => result_uri.as_deref(),
            _ => None,
        }
    }
}

/// Atestador (Fase 6). Só entra na folha quando NÃO-vazio, o que preserva o
/// stateRoot histórico de antes do fork.
///
/// `id` existe na struct mas NÃO é emitido: na referência o identificador é a CHAVE
/// do mapa `aiAttesters`, não um campo do objeto.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Attester {
    pub id: String,
    pub kind: String,
    /// Membros do comitê do enclave/verificador (`state.js:749`). São eles que
    /// assinam a atestação — sem o campo, o atestador não tem como FUNCIONAR.
    pub members: Vec<String>,
    pub quorum: u64,
    pub measurement: String,
    /// `registeredAt` é a ALTURA do bloco na referência (`= height`), não o
    /// timestamp — os outros registros do estado usam timestamp, e trocar os dois
    /// aqui daria uma folha `attest` diferente.
    pub registered_at: u64,
}

// ============================================================================
// Serialização canônica — folhas `orc`, `ai` e `attest` do `stateRoot`
//
// A regra que governa tudo aqui: `encodeCanonical` OMITE `undefined` e CODIFICA
// `null` (tag 0x00). Então a pergunta a fazer em cada campo não é "está vazio?",
// e sim "a referência escreve a chave?". Onde ela escreve `null` literal — e a
// camada de IA faz isso muito, porque cria as tarefas com os campos de resultado
// já zerados — `None` tem de virar `Value::Null`. Onde a chave simplesmente não
// existe naquele modo de tarefa, ela tem de SUMIR.
// ============================================================================

/// Converte um valor de `tx.data` (que é o que `Task::params` guarda) para a forma
/// canônica. Existe porque `params` é opaco: a referência grava o objeto do usuário
/// como veio, e a folha o codifica recursivamente.
fn json_para_valor(v: &JsonValue) -> Value {
    match v {
        JsonValue::Null => Value::Null,
        JsonValue::Bool(b) => Value::Bool(*b),
        JsonValue::Int(n) => Value::int(*n),
        JsonValue::Str(s) => Value::str(s.clone()),
        JsonValue::List(l) => Value::List(l.iter().map(json_para_valor).collect()),
        JsonValue::Map(m) => {
            Value::Map(m.iter().map(|(k, x)| (k.clone(), json_para_valor(x))).collect())
        }
    }
}

/// `Option<String>` no lugar em que a referência escreve `campo ?? null`: a chave
/// EXISTE sempre, com `null` quando não há valor.
fn texto_ou_nulo(v: &Option<String>) -> Value {
    match v {
        Some(s) => Value::str(s.clone()),
        None => Value::Null,
    }
}

impl Oracle {
    /// Forma canônica para a folha `orc`.
    ///
    /// A referência cria o registro em `state.js:2022`.
    ///
    /// `reputation` é o único campo OPCIONAL de verdade: oráculos registrados antes
    /// da Fase 1 não têm o campo, e a referência lê `(o.reputation ?? 50)` sem nunca
    /// materializá-lo. Emitir `50` (ou `null`) para esses mudaria a folha deles.
    ///
    /// `bridgeTransfers` e `endpoint` são escritos no literal de registro
    /// (`state.js:2022`) e portanto existem em TODO oráculo: `endpoint` como `null`
    /// até um `ORACLE_REGISTER` trazer `data.endpoint` em texto. Estavam faltando no
    /// porte, e por isso TODA folha `orc` divergia da rede — não só a de quem tem
    /// endpoint.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("address".into(), Value::str(self.address.clone()));
        m.insert("bridgeTransfers".into(), Value::uint(self.bridge_transfers));
        m.insert("completed".into(), Value::uint(self.completed));
        // `endpoint: null` no literal de registro — chave sempre presente.
        m.insert("endpoint".into(), texto_ou_nulo(&self.endpoint));
        m.insert("failed".into(), Value::uint(self.failed));
        m.insert("registeredAt".into(), Value::uint(self.registered_at));
        if let Some(r) = self.reputation {
            m.insert("reputation".into(), Value::uint(r));
        }
        // `slashed` e `stake` são BigInt na referência; `tasksCompleted` é `number`.
        // Na forma canônica os três têm a mesma tag (0x03), então a distinção não
        // muda a folha — mas os nomes, sim.
        m.insert("slashed".into(), Value::uint(self.slashed));
        m.insert("stake".into(), Value::uint(self.stake));
        m.insert("tasksCompleted".into(), Value::uint(self.tasks_completed));
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// As duas ausências deste tipo têm sentidos OPOSTOS e é o que torna a leitura
    /// delicada: `reputation` ausente é o oráculo pré-Fase 1, cuja reputação vale
    /// 50 por leitura (`None` preserva isso — materializar 50 aqui mudaria a folha
    /// dele); `endpoint` NUNCA falta, e nulo é o valor.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        let reputation = match m.get("reputation") {
            None => None,
            Some(r) => Some(r.inteiro()?),
        };
        if m.len() != 9 + usize::from(reputation.is_some()) {
            return None;
        }
        Some(Oracle {
            address: m.get("address")?.texto()?.to_string(),
            stake: m.get("stake")?.inteiro()?,
            registered_at: m.get("registeredAt")?.inteiro()?,
            tasks_completed: m.get("tasksCompleted")?.inteiro()?,
            completed: m.get("completed")?.inteiro()?,
            failed: m.get("failed")?.inteiro()?,
            slashed: m.get("slashed")?.inteiro()?,
            reputation,
            bridge_transfers: m.get("bridgeTransfers")?.inteiro()?,
            endpoint: m.get("endpoint")?.texto_ou_nulo()?,
        })
    }
}

impl Task {
    /// Forma canônica para a folha `ai`.
    ///
    /// Este é o `to_value` mais delicado do porte, e o motivo é estrutural: no JS a
    /// tarefa NÃO tem um conjunto fixo de campos. Cada modo nasce com um objeto
    /// literal próprio (`state.js:1961` quórum, `:1977` aberto, `:1993` designado) e
    /// os manipuladores seguintes ACRESCENTAM chaves.
    ///
    /// A forma NÃO é mais reconstruída por discriminantes (`mode == ""`,
    /// `oracle.is_some()`, `challenge_deadline != 0`, `challenger.is_some()`): cada
    /// bloco de chaves mora na variante que a referência cria junto com ele, e o
    /// `match` só pode emitir o literal daquela variante. Emitir uma chave no modo
    /// errado mudaria a folha de TODAS as tarefas daquele modo — não de uma —, e
    /// agora isso exigiria mudar o tipo, não esquecer um `if`.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();

        // ---- núcleo comum aos três literais de criação ----
        m.insert("completedAt".into(), match self.completed_at {
            Some(t) => Value::int(t),
            None => Value::Null, // `completedAt: null` é escrito na criação
        });
        m.insert("createdAt".into(), Value::uint(self.created_at));
        // `expiresAt` é o nome da referência; `deadline` é o nome do campo no Rust.
        m.insert("expiresAt".into(), Value::uint(self.deadline));
        m.insert("id".into(), Value::str(self.id.clone()));
        m.insert("model".into(), texto_ou_nulo(&self.model));
        m.insert("output".into(), texto_ou_nulo(&self.output));
        m.insert("params".into(), match &self.params {
            Some(p) => json_para_valor(p),
            None => Value::Null,
        });
        m.insert("prompt".into(), texto_ou_nulo(&self.prompt));
        m.insert("requester".into(), Value::str(self.requester.clone()));
        m.insert("reward".into(), Value::uint(self.reward));
        m.insert("resultHash".into(), texto_ou_nulo(&self.result_hash));
        m.insert("status".into(), Value::str(self.state.clone()));

        // ---- o que é exclusivo do literal de criação de cada modo ----
        match &self.kind {
            TaskKind::Quorum(q) => {
                m.insert("mode".into(), Value::str("QUORUM"));
                m.insert("quorum".into(), Value::uint(q.quorum));
                m.insert("phase".into(), Value::str(q.phase.texto()));
                m.insert("commitDeadline".into(), Value::uint(q.commit_deadline));
                m.insert("revealDeadline".into(), Value::uint(q.reveal_deadline));
                m.insert(
                    "commits".into(),
                    Value::Map(
                        q.commits.iter().map(|(k, v)| (k.clone(), Value::str(v.clone()))).collect(),
                    ),
                );
                // Cada revelação é um OBJETO `{resultHash, output}` que a conclusão
                // poda para `{resultHash}` (`state.js:2311`). Aqui o `resultHash`
                // mora em `reveals` e o output em `reveal_outputs`, então a chave
                // `output` só entra quando o segundo mapa ainda tem a entrada — que
                // é exatamente a condição da referência.
                m.insert(
                    "reveals".into(),
                    Value::Map(
                        q.reveals
                            .iter()
                            .map(|(quem, hash)| {
                                let mut r = BTreeMap::new();
                                if let Some(out) = q.reveal_outputs.get(quem) {
                                    r.insert("output".to_string(), Value::str(out.clone()));
                                }
                                r.insert("resultHash".to_string(), Value::str(hash.clone()));
                                (quem.clone(), Value::Map(r))
                            })
                            .collect(),
                    ),
                );
                // `winners: null` na criação, lista ao concluir. A chave existe sempre
                // no modo quórum — e SÓ nele, porque o campo mora nesta variante.
                m.insert("winners".into(), match &q.winners {
                    Some(w) => Value::List(w.iter().map(|a| Value::str(a.clone())).collect()),
                    None => Value::Null,
                });
                // Nenhuma chave de entrega aqui: o literal `:1961` não tem `oracle`
                // nem `resultUri`, e `Quorum` não tem onde guardá-los.
            }
            TaskKind::Aberta(a) => {
                m.insert("mode".into(), Value::str("OPEN"));
                m.insert("budget".into(), Value::uint(a.budget));
                m.insert("bidDeadline".into(), Value::uint(a.bid_deadline));
                m.insert(
                    "bids".into(),
                    Value::Map(
                        a.bids
                            .iter()
                            .map(|(quem, (preco, quando))| {
                                let mut b = BTreeMap::new();
                                // `{ price, at }` — os nomes da referência
                                // (`state.js:2222`), não `amount`/`timestamp`.
                                b.insert("at".to_string(), Value::uint(*quando));
                                b.insert("price".to_string(), Value::uint(*preco));
                                (quem.clone(), Value::Map(b))
                            })
                            .collect(),
                    ),
                );
                m.insert("assignedOracle".into(), texto_ou_nulo(&a.assigned_oracle));
                escrever_entrega(&mut m, &a.entrega);
            }
            TaskKind::Designada(d) => {
                // Modo de oráculo DESIGNADO. Note que ele NÃO tem a chave `mode`: a
                // referência só a grava nos outros dois literais.
                m.insert("assignedOracle".into(), Value::str(d.assigned_oracle.clone()));
                escrever_entrega(&mut m, &d.entrega);
                // `private` é exclusivo deste literal, e é sempre booleano (nasce de
                // `tx.data.private === true`) — não é campo omitível.
                m.insert("private".into(), Value::Bool(d.private));
            }
        }

        // ---- Fase 3: nada, janela, ou disputa ----
        match &self.challenge {
            Challenge::Nenhum => {}
            Challenge::Janela { deadline } => {
                m.insert("challengeDeadline".into(), Value::uint(*deadline));
            }
            Challenge::Disputa { deadline, challenger, bond, verdict_deadline, votes } => {
                // `AI_CHALLENGE` grava os quatro de uma vez (`state.js:2154-2158`),
                // e a janela continua existindo. `votes` sobrevive VAZIO depois de
                // resolvida a disputa — a referência faz `task.votes = {}`.
                m.insert("bond".into(), Value::uint(*bond));
                m.insert("challengeDeadline".into(), Value::uint(*deadline));
                m.insert("challenger".into(), Value::str(challenger.clone()));
                m.insert("verdictDeadline".into(), Value::uint(*verdict_deadline));
                m.insert(
                    "votes".into(),
                    Value::Map(votes.iter().map(|(k, v)| (k.clone(), Value::Bool(*v))).collect()),
                );
            }
        }

        // Fase 6: `verified` só é gravado quando o resultado foi de fato atestado —
        // "abaixo do fork / sem atestação, o campo NEM existe" é o comentário da
        // própria referência, e é o que mantém a serialização histórica replay-safe.
        if let Some(v) = &self.verified {
            m.insert("verified".into(), Value::str(v.clone()));
        }

        // NADA aqui depende de ordem de chegada — e é deliberado. Houve um campo
        // `reveal_order` neste cliente, para reproduzir a ordem de inserção com que
        // a referência iterava `reveals` ao montar `winners`. Aquela ordem NÃO
        // entra na folha (a codificação canônica ordena as chaves dos mapas), então
        // o consenso dependia de um dado que a raiz não commita: um estado
        // reconstruído a partir dela apuraria a revelação final noutra ordem.
        //
        // A regra passou a ser a ordem canônica de endereço nos DOIS clientes, o
        // campo foi removido, e com isso a raiz voltou a commitar tudo que o
        // consenso usa.
        Value::Map(m)
    }

    /// Inverso de [`Self::to_value`] — o `from_value` mais delicado do porte, pelo
    /// mesmo motivo que o `to_value`: a tarefa não tem conjunto fixo de campos.
    ///
    /// A variante é RECONHECIDA pelas chaves que a referência grava junto com ela:
    /// `mode` escolhe o modo (ausente = designado, que é o único literal sem a
    /// chave), `challenger` distingue disputa de janela, `resultUri` distingue
    /// entrega de pendência. A contagem de chaves é somada bloco a bloco e
    /// conferida no fim — uma chave a mais é campo que este decodificador não sabe
    /// ler, e restaurá-la pela metade daria uma tarefa que não recodifica na
    /// mesma folha.
    ///
    /// A volta é COMPLETA: não há mais campo que a folha deixe de cobrir. O
    /// `reveal_order` que existia aqui — e não voltava — foi removido junto com a
    /// dependência de ordem de chegada que o justificava.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        let mut esperadas = 12usize;

        let kind = match m.get("mode") {
            // Sem `mode`: modo DESIGNADO, o único literal que não grava a chave.
            None => {
                esperadas += 2;
                TaskKind::Designada(Designada {
                    assigned_oracle: m.get("assignedOracle")?.texto()?.to_string(),
                    private: m.get("private")?.booleano()?,
                    entrega: ler_entrega(m, &mut esperadas)?,
                })
            }
            Some(modo) => match modo.texto()? {
                "QUORUM" => {
                    esperadas += 8;
                    let mut reveals = BTreeMap::new();
                    let mut reveal_outputs = BTreeMap::new();
                    for (quem, r) in m.get("reveals")?.mapa()? {
                        let r = r.mapa()?;
                        // `output` some na PODA da conclusão; o `resultHash` fica.
                        let saida = match r.get("output") {
                            None => None,
                            Some(o) => Some(o.texto()?.to_string()),
                        };
                        if r.len() != 1 + usize::from(saida.is_some()) {
                            return None;
                        }
                        reveals.insert(quem.clone(), r.get("resultHash")?.texto()?.to_string());
                        if let Some(o) = saida {
                            reveal_outputs.insert(quem.clone(), o);
                        }
                    }
                    TaskKind::Quorum(Quorum {
                        quorum: m.get("quorum")?.inteiro()?,
                        phase: match m.get("phase")?.texto()? {
                            "COMMIT" => Fase::Commit,
                            "DONE" => Fase::Done,
                            _ => return None,
                        },
                        commit_deadline: m.get("commitDeadline")?.inteiro()?,
                        reveal_deadline: m.get("revealDeadline")?.inteiro()?,
                        commits: m
                            .get("commits")?
                            .mapa()?
                            .iter()
                            .map(|(k, h)| Some((k.clone(), h.texto()?.to_string())))
                            .collect::<Option<_>>()?,
                        reveals,
                        reveal_outputs,
                        // `winners: null` na criação, lista ao concluir — a chave
                        // existe sempre neste modo.
                        winners: match m.get("winners")? {
                            Value::Null => None,
                            Value::List(l) => Some(
                                l.iter()
                                    .map(|a| Some(a.texto()?.to_string()))
                                    .collect::<Option<Vec<_>>>()?,
                            ),
                            _ => return None,
                        },
                    })
                }
                "OPEN" => {
                    esperadas += 5;
                    TaskKind::Aberta(Aberta {
                        budget: m.get("budget")?.inteiro()?,
                        bid_deadline: m.get("bidDeadline")?.inteiro()?,
                        bids: m
                            .get("bids")?
                            .mapa()?
                            .iter()
                            .map(|(quem, b)| {
                                let b = b.mapa()?;
                                if b.len() != 2 {
                                    return None;
                                }
                                let preco = b.get("price")?.inteiro()?;
                                let quando = b.get("at")?.inteiro()?;
                                Some((quem.clone(), (preco, quando)))
                            })
                            .collect::<Option<_>>()?,
                        assigned_oracle: m.get("assignedOracle")?.texto_ou_nulo()?,
                        entrega: ler_entrega(m, &mut esperadas)?,
                    })
                }
                _ => return None,
            },
        };

        // `challenger` só existe na disputa; a janela sozinha tem só o prazo.
        let challenge = if m.contains_key("challenger") {
            esperadas += 5;
            Challenge::Disputa {
                deadline: m.get("challengeDeadline")?.inteiro()?,
                challenger: m.get("challenger")?.texto()?.to_string(),
                bond: m.get("bond")?.inteiro()?,
                verdict_deadline: m.get("verdictDeadline")?.inteiro()?,
                votes: super::gov::mapa_de_bool(m.get("votes")?)?,
            }
        } else if let Some(d) = m.get("challengeDeadline") {
            esperadas += 1;
            Challenge::Janela { deadline: d.inteiro()? }
        } else {
            Challenge::Nenhum
        };

        // `verified` AUSENTE é "não atestado" — o valor histórico de toda tarefa
        // anterior à Fase 6. Materializá-lo mudaria a folha delas.
        let verified = match m.get("verified") {
            None => None,
            Some(x) => {
                esperadas += 1;
                Some(x.texto()?.to_string())
            }
        };

        if m.len() != esperadas {
            return None;
        }
        Some(Task {
            id: m.get("id")?.texto()?.to_string(),
            requester: m.get("requester")?.texto()?.to_string(),
            reward: m.get("reward")?.inteiro()?,
            state: m.get("status")?.texto()?.to_string(),
            deadline: m.get("expiresAt")?.inteiro()?,
            result_hash: m.get("resultHash")?.texto_ou_nulo()?,
            output: m.get("output")?.texto_ou_nulo()?,
            prompt: m.get("prompt")?.texto_ou_nulo()?,
            // `params` NULO volta como `None`: a referência escreve `null` tanto
            // para "sem params" quanto para `params: null` do usuário, e a folha
            // não distingue os dois.
            params: match m.get("params")? {
                Value::Null => None,
                p => Some(super::gov::valor_para_json(p)?),
            },
            model: m.get("model")?.texto_ou_nulo()?,
            created_at: m.get("createdAt")?.inteiro()?,
            completed_at: m.get("completedAt")?.inteiro_ou_nulo()?,
            verified,
            kind,
            challenge,
        })
    }
}

/// Inverso de [`escrever_entrega`], somando ao orçamento de chaves do chamador.
///
/// A ausência de `resultUri` é o que diz que `AI_RESULT` ainda não rodou — e nesse
/// caso `oracle` é NULO. "Oráculo preenchido sem `resultUri`" é forma que a
/// referência nunca grava, e aceitá-la deixaria representável de novo a
/// combinação que o enum [`Entrega`] existe para apagar.
fn ler_entrega(m: &BTreeMap<String, Value>, esperadas: &mut usize) -> Option<Entrega> {
    let oracle = m.get("oracle")?;
    *esperadas += 1;
    match m.get("resultUri") {
        None => oracle.e_nulo().then_some(Entrega::Pendente),
        Some(uri) => {
            *esperadas += 1;
            Some(Entrega::Entregue {
                oracle: oracle.texto()?.to_string(),
                result_uri: uri.texto_ou_nulo()?,
            })
        }
    }
}

/// Escreve `oracle` e, se já houve entrega, `resultUri`.
///
/// `resultUri` nasce em `AI_RESULT` (`state.js:2074`) JUNTO com `task.oracle`: antes
/// disso a chave não existe; depois existe mesmo valendo `null`, porque o modo
/// hash-only pode não trazer ponteiro. Como os dois vivem na mesma variante, a
/// dependência não depende mais de ninguém lembrar dela.
fn escrever_entrega(m: &mut BTreeMap<String, Value>, e: &Entrega) {
    match e {
        Entrega::Pendente => {
            m.insert("oracle".into(), Value::Null);
        }
        Entrega::Entregue { oracle, result_uri } => {
            m.insert("oracle".into(), Value::str(oracle.clone()));
            m.insert("resultUri".into(), texto_ou_nulo(result_uri));
        }
    }
}

impl Attester {
    /// Forma canônica para a folha `attest`.
    ///
    /// A referência grava `{ kind, members, quorum, measurement, registeredAt }`
    /// (`state.js:749`). O porte trazia só `kind` e `measurement`, então a folha
    /// `attest` divergia da rede assim que QUALQUER atestador existisse — inclusive
    /// os dois que fazem o atestador funcionar (`members`, `quorum`). Isso é
    /// O REGISTRO entra no `stateRoot` mesmo antes de qualquer atestação ser
    /// verificada — são coisas independentes.
    ///
    /// `id` existe na struct mas NÃO é emitido: na referência o identificador é a
    /// CHAVE do mapa (e da folha), não um campo do objeto. Emiti-lo acrescentaria
    /// uma chave inexistente, como duplicar o nome em `NameRecord` faria.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("kind".into(), Value::str(self.kind.clone()));
        m.insert("measurement".into(), Value::str(self.measurement.clone()));
        m.insert(
            "members".into(),
            // LISTA, não conjunto: a ordem é a que a governança aprovou e entra na
            // folha.
            Value::List(self.members.iter().map(|x| Value::str(x.clone())).collect()),
        );
        m.insert("quorum".into(), Value::uint(self.quorum));
        m.insert("registeredAt".into(), Value::uint(self.registered_at));
        Value::Map(m)
    }

    /// Inverso de [`Self::to_value`] — e recebe o `id` porque o `to_value` NÃO o
    /// emite: o identificador é a chave do mapa `aiAttesters`. Sem ele o registro
    /// voltaria anônimo, e um atestador que não sabe o próprio id não é encontrável
    /// pela verificação de atestação.
    pub fn from_value(v: &Value, id: &str) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 5 {
            return None;
        }
        Some(Attester {
            id: id.to_string(),
            kind: m.get("kind")?.texto()?.to_string(),
            members: m
                .get("members")?
                .lista()?
                .iter()
                .map(|x| Some(x.texto()?.to_string()))
                .collect::<Option<_>>()?,
            quorum: m.get("quorum")?.inteiro()?,
            measurement: m.get("measurement")?.texto()?.to_string(),
            registered_at: m.get("registeredAt")?.inteiro()?,
        })
    }
}

/// Tipos de transação que este módulo atende. O despacho em `mod.rs` usa esta
/// lista, então um tipo esquecido aqui vira erro de "tipo desconhecido" em vez de
/// falha silenciosa.
pub const TIPOS: &[&str] = &[
    "AI_TASK",
    "AI_BID",
    "AI_AWARD",
    "AI_RESULT",
    "AI_COMMIT",
    "AI_REVEAL",
    "AI_VERDICT",
    "AI_CHALLENGE",
    "AI_CLAIM",
    "AI_REFUND",
];

// ============================================================================
// Leitura do campo `data` — entrada NÃO CONFIÁVEL
// ============================================================================

fn erro(msg: impl Into<String>) -> StateError {
    StateError(msg.into())
}

type R<T> = Result<T, StateError>;

/// Campo bruto de `data`. `None` cobre tanto "chave ausente" quanto "`data` não é
/// mapa" — a referência trata os dois igual, porque `undefined.x` e `{}.x` são
/// ambos `undefined` na leitura por chave.
fn campo<'a>(tx: &'a Tx, nome: &str) -> Option<&'a JsonValue> {
    match tx.data.as_ref() {
        Some(JsonValue::Map(m)) => m.get(nome),
        _ => None,
    }
}

/// Campo presente E não-nulo — o `!= null` da referência, que é falso tanto para
/// `undefined` quanto para `null`.
fn presente<'a>(tx: &'a Tx, nome: &str) -> Option<&'a JsonValue> {
    match campo(tx, nome) {
        Some(JsonValue::Null) | None => None,
        outro => outro,
    }
}

/// Campo de texto. Qualquer outro tipo devolve `None`, como o `typeof !== 'string'`.
fn texto<'a>(tx: &'a Tx, nome: &str) -> Option<&'a str> {
    match campo(tx, nome) {
        Some(JsonValue::Str(s)) => Some(s),
        _ => None,
    }
}

/// `data.x === true` — estritamente o booleano verdadeiro, sem coerção.
fn e_verdadeiro(tx: &Tx, nome: &str) -> bool {
    matches!(campo(tx, nome), Some(JsonValue::Bool(true)))
}

/// 64 hexadecimais, QUALQUER caixa — é o `/^[0-9a-fA-F]{64}$/` da referência.
///
/// Note que isto é mais frouxo que `hash::is_valid_hash`, que exige minúscula. A
/// diferença é deliberada e está no protocolo: o que ENTRA por `data` é aceito nas
/// duas caixas, e a normalização acontece na hora de guardar ou de comparar.
fn e_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// O `Number(x)` da referência, restrito ao que precisa ser inteiro.
///
/// DELEGA a `coercao::js_number_seguro_de`. A versão anterior aqui casava só
/// `Int` e `Str` com `parse::<u64>` — sob um comentário dizendo que isso era
/// fidelidade ao `Number()`. Não era: `Number("3.0")`, `Number(" 3 ")`,
/// `Number("0x10")` e `Number([3])` valem 3, 3, 16 e 3 na rede, e este cliente
/// recusava as quatro. Um `AI_TASK` com `quorum: "3.0"` criava a tarefa na rede e
/// derrubava o nó Rust — transação barata, ao alcance de qualquer um.
fn numero(v: &JsonValue) -> Option<u64> {
    u64::try_from(crate::state::coercao::js_number_seguro_de(v)?).ok()
}

/// `BigInt(x)` da referência para valores monetários vindos de `data`.
///
/// Mesma história de [`numero`]: `BigInt("0x10")` é 16 e `BigInt(true)` é 1 na
/// rede. Um `AI_BID` com `price: "0x10"` registrava o lance lá e era recusado aqui.
fn quantia(v: &JsonValue) -> Option<Amount> {
    Amount::try_from(crate::state::coercao::js_bigint_de(v)?).ok()
}

/// `BigInt(tx.amount)`. A validação stateless já garantiu o formato; aqui é só a
/// conversão, e um erro só apareceria por transação que não passou por lá.
fn valor(tx: &Tx) -> R<Amount> {
    tx.amount.parse::<Amount>().map_err(|_| erro("amount inválido"))
}

/// Soma de instantes/prazos em milissegundos, checada. Um `expiresAt` que estoura
/// silenciosamente daria uma tarefa reembolsável na hora.
fn soma_ts(a: u64, b: u64) -> R<u64> {
    a.checked_add(b).ok_or_else(|| erro("estouro aritmético no prazo"))
}

/// O `id` da transação, que é a CHAVE da tarefa criada por `AI_TASK`.
fn id_da_tx(tx: &Tx) -> R<&str> {
    tx.id.as_deref().ok_or_else(|| erro("transação sem id"))
}

/// Saldo suficiente para `valor`, sem mutar nada. Existe para que a checagem
/// aconteça na fase de validação e a mutação venha depois — a diferença entre
/// "erro" e "erro com metade do estado escrito".
fn exige_saldo(state: &State, quem: &str, valor: Amount, msg: &str) -> R<()> {
    if state.balance_of(quem) < valor {
        return Err(erro(msg));
    }
    Ok(())
}

// ============================================================================
// Despacho
// ============================================================================

pub fn aplicar(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    match tx.tx_type.as_str() {
        "AI_TASK" => ai_task(state, tx, ctx),
        "AI_RESULT" => ai_result(state, tx, ctx),
        "AI_CLAIM" => ai_claim(state, tx, ctx),
        "AI_CHALLENGE" => ai_challenge(state, tx, ctx),
        "AI_VERDICT" => ai_verdict(state, tx, ctx),
        "AI_BID" => ai_bid(state, tx, ctx),
        "AI_AWARD" => ai_award(state, tx, ctx),
        "AI_COMMIT" => ai_commit(state, tx, ctx),
        "AI_REVEAL" => ai_reveal(state, tx, ctx),
        "AI_REFUND" => ai_refund(state, tx, ctx),
        outro => Err(erro(format!("tipo de transação desconhecido: {outro}"))),
    }
}

// ---------------------------------------------------------------- AI_TASK

/// Cria uma tarefa e ESCROWA a recompensa.
///
/// Os três modos são testados na ordem da referência — quórum, aberto, designado —
/// e a ordem importa: uma `data` que traga `quorum` E `open` cria uma tarefa de
/// quórum, e trocar os ramos mudaria o resultado.
fn ai_task(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let id = id_da_tx(tx)?.to_string();
    let prompt = texto(tx, "prompt").filter(|p| !p.is_empty()).ok_or_else(|| erro("prompt obrigatório"))?;
    if prompt.len() > MAX_AI_PROMPT_BYTES {
        return Err(erro("prompt excede o limite"));
    }
    let recompensa = valor(tx)?;
    if recompensa == 0 {
        return Err(erro("recompensa da tarefa deve ser positiva"));
    }
    let prompt = prompt.to_string();
    let model = texto(tx, "model").map(str::to_string);
    let params = presente(tx, "params").cloned();
    let escrow = soma(recompensa, ctx.fee)?;

    // Fase 2: modo QUÓRUM (commit-reveal) — N oráculos independentes em vez de um
    // único designado. Elimina o ponto único de confiança.
    // Abaixo do fork o campo `quorum` é IGNORADO, não recusado: a transação cai no
    // modo de oráculo designado, exatamente como faz a rede.
    let pedido_de_quorum = match ctx.height >= AI_QUORUM_HEIGHT {
        true => presente(tx, "quorum"),
        false => None,
    };
    if let Some(q_bruto) = pedido_de_quorum {
        let q = numero(q_bruto).filter(|q| (MIN_AI_QUORUM..=MAX_AI_QUORUM).contains(q)).ok_or_else(|| {
            erro(format!("quórum inválido ({MIN_AI_QUORUM}..{MAX_AI_QUORUM})"))
        })?;
        exige_saldo(state, &tx.from, escrow, "saldo insuficiente para escrow da recompensa")?;

        let fim_commit = soma_ts(ctx.block_ts, AI_COMMIT_WINDOW_MS)?;
        let fim_reveal = soma_ts(fim_commit, AI_REVEAL_WINDOW_MS)?;
        state.debitar(&tx.from, escrow)?;
        state.ai_tasks.insert(id.clone(), Task {
            id,
            requester: tx.from.clone(),
            model,
            prompt: Some(prompt),
            params,
            reward: recompensa,
            state: "PENDING".into(),
            created_at: ctx.block_ts,
            // No modo quórum a tarefa expira junto com a janela de reveal: sem
            // consenso até lá, o escrow volta pelo AI_REFUND.
            deadline: fim_reveal,
            kind: TaskKind::Quorum(Quorum {
                quorum: q,
                phase: Fase::Commit,
                commit_deadline: fim_commit,
                reveal_deadline: fim_reveal,
                ..Default::default()
            }),
            ..Default::default()
        });
        return Ok(());
    }

    // Fase 4: modo ABERTO (leilão) — orçamento escrowado; oráculos dão lances
    // (AI_BID) e o solicitante adjudica ao melhor (AI_AWARD). Sem oráculo designado.
    if ctx.height >= AI_MARKET_HEIGHT && e_verdadeiro(tx, "open") {
        exige_saldo(state, &tx.from, escrow, "saldo insuficiente para o orçamento da tarefa")?;
        let fim_lances = soma_ts(ctx.block_ts, AI_BID_WINDOW_MS)?;
        let expira = soma_ts(ctx.block_ts, AI_TASK_TIMEOUT_MS)?;
        state.debitar(&tx.from, escrow)?;
        state.ai_tasks.insert(id.clone(), Task {
            id,
            requester: tx.from.clone(),
            model,
            prompt: Some(prompt),
            params,
            reward: recompensa,
            state: "BIDDING".into(),
            created_at: ctx.block_ts,
            deadline: expira,
            kind: TaskKind::Aberta(Aberta {
                budget: recompensa,
                bid_deadline: fim_lances,
                // `assignedOracle: null` até o AI_AWARD; `oracle: null` e SEM
                // `resultUri` até o AI_RESULT.
                ..Default::default()
            }),
            ..Default::default()
        });
        return Ok(());
    }

    // Oráculo designado obrigatório: o solicitante escolhe em quem confia; só esse
    // oráculo pode resgatar a recompensa. Impede que qualquer oráculo registrado
    // saque o escrow com um output lixo.
    let designado = texto(tx, "oracle").filter(|a| is_valid_address(a)).ok_or_else(|| {
        erro("AI_TASK exige um oráculo designado (data.oracle)")
    })?;
    let designado = designado.to_string();
    exige_saldo(state, &tx.from, escrow, "saldo insuficiente para escrow da recompensa")?;

    // H-2: a expiração ancora no timestamp REAL do bloco (validado por drift), não
    // no `tx.timestamp` que o remetente controla — senão bastaria datar a
    // transação no futuro para poder pedir refund na hora seguinte.
    let expira = soma_ts(ctx.block_ts, AI_TASK_TIMEOUT_MS)?;
    state.debitar(&tx.from, escrow)?;
    state.ai_tasks.insert(id.clone(), Task {
        id,
        requester: tx.from.clone(),
        model,
        prompt: Some(prompt),
        params,
        reward: recompensa,
        state: "PENDING".into(),
        created_at: ctx.block_ts,
        deadline: expira,
        kind: TaskKind::Designada(Designada {
            // Já validado como endereço acima — por isso `String` e não `Option`.
            assigned_oracle: designado,
            private: e_verdadeiro(tx, "private"),
            entrega: Entrega::Pendente,
        }),
        ..Default::default()
    });
    Ok(())
}

// ---------------------------------------------------------------- AI_RESULT

/// Entrega do resultado pelo oráculo designado.
///
/// Não cobra taxa: `CHAIN.FEES.AI_RESULT` é zero na referência, e o caso não tem
/// débito de `fee` nenhum. Reproduzir isso importa — cobrar aqui deixaria o saldo
/// do oráculo diferente do da rede.
fn ai_result(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if !state.oracles.contains_key(&tx.from) {
        return Err(erro("remetente não é um oráculo de IA registrado"));
    }
    let task_id = texto(tx, "taskId").unwrap_or("").to_string();
    let tarefa = state.ai_tasks.get(&task_id).ok_or_else(|| erro("tarefa de IA inexistente"))?;
    if tarefa.state != "PENDING" {
        return Err(erro("tarefa de IA já concluída"));
    }
    // Só o oráculo designado pela tarefa pode entregar o resultado. No modo quórum
    // não há designado (`assigned_oracle()` é `None` por construção), então uma
    // tarefa de quórum cai aqui — como na referência, onde `task.assignedOracle` é
    // `undefined` nesse literal.
    if tarefa.assigned_oracle() != Some(tx.from.as_str()) {
        return Err(erro("remetente não é o oráculo designado para esta tarefa"));
    }
    let recompensa = tarefa.reward;

    // Fase 5: modo HASH-ONLY (resultado verificável/privado) — o oráculo grava só o
    // compromisso (resultHash) + ponteiro opcional; o output real fica off-chain
    // (cifrado p/ o solicitante em tarefas private). Abaixo do fork, output é
    // obrigatório.
    let (output, result_hash, result_uri) = if ctx.height >= AI_PRIVATE_HEIGHT
        && presente(tx, "resultHash").is_some()
    {
        let h = texto(tx, "resultHash").filter(|h| e_hex64(h)).ok_or_else(|| erro("resultHash inválido (64 hex)"))?;
        // Canonicaliza em MINÚSCULA: é a forma que `eav_hash` produz, e sem isto o
        // mesmo resultado enviado em caixa diferente contaria como outro no quórum.
        let h = h.to_lowercase();
        let uri = match presente(tx, "resultUri") {
            None => None,
            Some(_) => {
                let u = texto(tx, "resultUri")
                    .filter(|u| u.len() <= MAX_AI_URI_BYTES)
                    .ok_or_else(|| erro("resultUri inválido"))?;
                Some(u.to_string())
            }
        };
        (None, h, uri)
    } else {
        let o = texto(tx, "output").filter(|o| !o.is_empty()).ok_or_else(|| erro("output obrigatório"))?;
        if o.len() > MAX_AI_OUTPUT_BYTES {
            return Err(erro("output excede o limite"));
        }
        let h = eav_hash_one(o);
        (Some(o.to_string()), h, None)
    };

    // Fase 6 — ATESTAÇÃO (TEE/zk), `state.js:2101`. Apurada AQUI, antes de
    // qualquer mutação: um resultado atestado liquida NA HORA (sem janela de
    // desafio, porque a prova é criptográfica), e uma atestação que não fecha
    // quórum derruba a transação inteira sem deixar rastro.
    //
    // A contagem de assinaturas é a MESMA da ponte (`verify_committee_proof`):
    // dedup por endereço recuperado, não-membro ignorado, teto no nº de membros.
    let verificado: Option<String> = if ctx.height >= AI_TEE_HEIGHT
        && let Some(att) = presente(tx, "attestation")
    {
        let att_id = match att {
            JsonValue::Map(m) => match m.get("attesterId") {
                Some(JsonValue::Str(s)) => s.clone(),
                _ => String::new(),
            },
            _ => String::new(),
        };
        let atestador = state
            .ai_attesters
            .get(&att_id)
            .ok_or_else(|| erro("atestador de IA não registrado"))?;
        let digest = crate::state::bridge::ai_attest_digest(
            &task_id,
            &result_hash,
            &att_id,
            &atestador.measurement,
        );
        let sigs = match att {
            JsonValue::Map(m) => m.get("sigs"),
            _ => None,
        };
        let validas =
            crate::state::bridge::verify_committee_proof(&digest, sigs, &atestador.members);
        if validas < atestador.quorum {
            return Err(erro(format!(
                "atestação insuficiente ({validas}/{})",
                atestador.quorum
            )));
        }
        Some(atestador.kind.clone())
    } else {
        None
    };

    // -------- daqui para baixo, só mutação --------
    let paga_agora = ctx.height < AI_CHALLENGE_HEIGHT;
    let fim_desafio = if paga_agora { 0 } else { soma_ts(ctx.block_ts, AI_CHALLENGE_WINDOW_MS)? };

    let tarefa = state.ai_tasks.get_mut(&task_id).ok_or_else(|| erro("tarefa de IA inexistente"))?;
    // `oracle` e `resultUri` entram JUNTOS, porque a variante não admite um sem o
    // outro. `entrega_mut` é `None` só no modo quórum, que a checagem do designado
    // já recusou — e a mensagem é a mesma, então uma regressão lá não vira aceitação
    // silenciosa aqui.
    let Some(entrega) = tarefa.entrega_mut() else {
        return Err(erro("remetente não é o oráculo designado para esta tarefa"));
    };
    *entrega = Entrega::Entregue { oracle: tx.from.clone(), result_uri };
    tarefa.output = output; // None no modo hash-only (resultado off-chain)
    tarefa.result_hash = Some(result_hash);
    tarefa.completed_at = Some(tx.timestamp);
    // Poda a ENTRADA (fica no tx AI_TASK) — limita o crescimento de estado.
    tarefa.prompt = None;
    tarefa.params = None;

    if let Some(kind) = verificado {
        // Fase 6: resultado ATESTADO — liquida na hora, sem janela de desafio e
        // sem depender de reputação (é criptograficamente verificado).
        tarefa.verified = Some(kind);
        tarefa.state = "DONE".into();
        if let Some(o) = state.oracles.get_mut(&tx.from) {
            o.creditar_acerto();
        }
        state.creditar(&tx.from, recompensa)?;
    } else if paga_agora {
        // Fase 1 (grandfather): paga na hora + reputação sobe. `challenge` fica em
        // `Nenhum`, e por isso NENHUMA chave da Fase 3 aparece na folha destas
        // tarefas — que é o que mantém o replay do histórico válido.
        tarefa.state = "DONE".into();
        if let Some(o) = state.oracles.get_mut(&tx.from) {
            o.creditar_acerto();
        }
        state.creditar(&tx.from, recompensa)?;
    } else {
        // Fase 3 — verificação otimista: a recompensa FICA em escrow numa janela de
        // desafio. Só é liberada por AI_CLAIM (se não contestada) ou pelo veredito
        // do júri (se contestada via AI_CHALLENGE). Reputação também fica pendente.
        tarefa.state = "CHALLENGE_PERIOD".into();
        tarefa.challenge = Challenge::Janela { deadline: fim_desafio };
    }
    Ok(())
}

// ---------------------------------------------------------------- AI_CLAIM

/// Fase 3 — liquida uma tarefa cuja janela de desafio fechou SEM contestação
/// (paga o oráculo). É permissionless de propósito: qualquer conta pode chamar, e
/// é isso que garante que o escrow nunca fique preso se o oráculo sumir. Também
/// resolve uma disputa que o júri não decidiu no prazo (inconclusiva: resultado
/// mantido, fiança devolvida).
fn ai_claim(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < AI_CHALLENGE_HEIGHT {
        return Err(erro("desafio de IA ainda não ativo"));
    }
    let task_id = texto(tx, "taskId").unwrap_or("").to_string();
    if !state.ai_tasks.contains_key(&task_id) {
        return Err(erro("tarefa de IA inexistente"));
    }
    // A referência debita a taxa ANTES de olhar o status, então esta mensagem tem
    // precedência sobre "tarefa não está liquidável". A ordem foi mantida; só o
    // débito é que desceu para depois da validação.
    exige_saldo(state, &tx.from, ctx.fee, "saldo insuficiente para a taxa")?;
    let tarefa = state.ai_tasks.get(&task_id).ok_or_else(|| erro("tarefa de IA inexistente"))?;

    let recompensa = tarefa.reward;
    let oraculo = tarefa.oracle().map(str::to_string);
    let desafiante = tarefa.challenger().map(str::to_string);
    let fianca = tarefa.bond();

    match tarefa.state.as_str() {
        "CHALLENGE_PERIOD" => {
            if ctx.block_ts < tarefa.challenge_deadline() {
                return Err(erro("janela de desafio ainda aberta"));
            }
            let oraculo = oraculo.ok_or_else(|| erro("tarefa sem oráculo entregador"))?;
            state.debitar(&tx.from, ctx.fee)?;
            state.creditar(&oraculo, recompensa)?;
            if let Some(o) = state.oracles.get_mut(&oraculo) {
                o.creditar_acerto();
            }
            if let Some(t) = state.ai_tasks.get_mut(&task_id) {
                t.state = "DONE".into();
            }
        }
        "DISPUTED" => {
            if ctx.block_ts < tarefa.verdict_deadline() {
                return Err(erro("júri ainda no prazo"));
            }
            if tarefa.votes().len() >= AI_VERDICT_QUORUM {
                return Err(erro("disputa deve ser resolvida por veredito"));
            }
            let oraculo = oraculo.ok_or_else(|| erro("tarefa sem oráculo entregador"))?;
            // `status == "DISPUTED"` sem `Challenge::Disputa` continua sendo
            // representável (o status ainda é texto), então a guarda fica.
            let desafiante = desafiante.ok_or_else(|| erro("disputa sem desafiante"))?;
            state.debitar(&tx.from, ctx.fee)?;
            state.creditar(&oraculo, recompensa)?; // inconclusiva → resultado mantido
            state.creditar(&desafiante, fianca)?; // fiança devolvida (desafio de boa-fé)
            if let Some(t) = state.ai_tasks.get_mut(&task_id) {
                t.state = "DONE".into();
                // `= {}`, não `delete`: as quatro chaves da disputa continuam na
                // folha, e a variante `Disputa` é o que garante isso.
                if let Challenge::Disputa { votes, .. } = &mut t.challenge {
                    votes.clear();
                }
            }
        }
        _ => return Err(erro("tarefa não está liquidável")),
    }
    Ok(())
}

// ---------------------------------------------------------------- AI_CHALLENGE

/// Fase 3 — qualquer conta contesta um resultado postando uma fiança. A fiança é o
/// que impede desafio gratuito em massa: se o resultado for mantido, ela vai para
/// o oráculo.
fn ai_challenge(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < AI_CHALLENGE_HEIGHT {
        return Err(erro("desafio de IA ainda não ativo"));
    }
    let task_id = texto(tx, "taskId").unwrap_or("").to_string();
    let tarefa = state.ai_tasks.get(&task_id).ok_or_else(|| erro("tarefa de IA inexistente"))?;
    if tarefa.state != "CHALLENGE_PERIOD" {
        return Err(erro("tarefa não está em janela de desafio"));
    }
    let fim_desafio = tarefa.challenge_deadline();
    if ctx.block_ts >= fim_desafio {
        return Err(erro("janela de desafio expirada"));
    }
    let custo = soma(AI_CHALLENGE_BOND, ctx.fee)?;
    exige_saldo(state, &tx.from, custo, "saldo insuficiente para a fiança do desafio")?;
    let fim_veredito = soma_ts(ctx.block_ts, AI_VERDICT_WINDOW_MS)?;

    state.debitar(&tx.from, custo)?;
    let tarefa = state.ai_tasks.get_mut(&task_id).ok_or_else(|| erro("tarefa de IA inexistente"))?;
    tarefa.state = "DISPUTED".into();
    // Os quatro campos da disputa entram DE UMA VEZ, como no literal da referência
    // (`state.js:2154-2158`), e `challengeDeadline` é preservado — a referência não
    // o apaga ao abrir a disputa.
    tarefa.challenge = Challenge::Disputa {
        deadline: fim_desafio,
        challenger: tx.from.clone(),
        bond: AI_CHALLENGE_BOND,
        verdict_deadline: fim_veredito,
        votes: BTreeMap::new(), // jurado -> resultado válido?
    };
    Ok(())
}

// ---------------------------------------------------------------- AI_VERDICT

/// Fase 3 — oráculos-jurados votam se o resultado é válido; ao atingir o quórum a
/// disputa resolve e o PERDEDOR é punido. Os jurados também aprendem: votar com a
/// maioria sobe reputação, contra ela desce — é o que dá custo a votar por votar.
fn ai_verdict(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < AI_CHALLENGE_HEIGHT {
        return Err(erro("desafio de IA ainda não ativo"));
    }
    if !state.oracles.contains_key(&tx.from) {
        return Err(erro("só oráculo registrado pode julgar"));
    }
    let task_id = texto(tx, "taskId").unwrap_or("").to_string();
    let tarefa = state
        .ai_tasks
        .get(&task_id)
        .filter(|t| t.state == "DISPUTED")
        .ok_or_else(|| erro("tarefa não está em disputa"))?;
    if ctx.block_ts >= tarefa.verdict_deadline() {
        return Err(erro("janela de veredito expirada"));
    }
    // Parte interessada não julga a própria causa.
    if Some(tx.from.as_str()) == tarefa.oracle()
        || Some(tx.from.as_str()) == tarefa.challenger()
    {
        return Err(erro("parte interessada não pode julgar"));
    }
    if tarefa.votes().contains_key(&tx.from) {
        return Err(erro("jurado já votou nesta disputa"));
    }
    // Na fase de VALIDAÇÃO, para que uma tarefa em estado corrompido (`status`
    // DISPUTED sem os campos da disputa) seja recusada ANTES do débito da taxa.
    if !matches!(tarefa.challenge, Challenge::Disputa { .. }) {
        return Err(erro("tarefa não está em disputa"));
    }
    exige_saldo(state, &tx.from, ctx.fee, "saldo insuficiente para a taxa")?;

    let recompensa = tarefa.reward;
    let fianca = tarefa.bond();
    let oraculo = tarefa.oracle().map(str::to_string);
    let desafiante = tarefa.challenger().map(str::to_string);
    let solicitante = tarefa.requester.clone();

    state.debitar(&tx.from, ctx.fee)?;
    let tarefa = state.ai_tasks.get_mut(&task_id).ok_or_else(|| erro("tarefa não está em disputa"))?;
    // Inalcançável — conferido na fase de validação, e nada entre as duas leituras
    // mexe na tarefa. Recusar em vez de `expect`: um pânico aqui derrubaria o nó.
    let Challenge::Disputa { votes, .. } = &mut tarefa.challenge else {
        return Err(erro("tarefa não está em disputa"));
    };
    votes.insert(tx.from.clone(), e_verdadeiro(tx, "valid"));
    if votes.len() < AI_VERDICT_QUORUM {
        return Ok(());
    }

    // Quórum atingido: apura e resolve.
    let votos: Vec<(String, bool)> = votes.iter().map(|(k, v)| (k.clone(), *v)).collect();
    let a_favor = votos.iter().filter(|(_, v)| *v).count();
    // `validCount > votes.length / 2` da referência, sem divisão: em inteiros,
    // `a_favor * 2 > total` é a mesma condição e não perde a metade fracionária.
    let mantido = a_favor * 2 > votos.len();

    if mantido {
        // MANTIDO: oráculo leva a recompensa + a fiança (desafio infundado).
        let oraculo = oraculo.ok_or_else(|| erro("tarefa sem oráculo entregador"))?;
        state.creditar(&oraculo, soma(recompensa, fianca)?)?;
        if let Some(o) = state.oracles.get_mut(&oraculo) {
            o.creditar_acerto();
        }
        if let Some(t) = state.ai_tasks.get_mut(&task_id) {
            t.state = "UPHELD".into();
        }
    } else {
        // DERRUBADO: solicitante reembolsado; oráculo slashado, e o confisco vira
        // bounty do desafiante (que ainda recupera a fiança). O slash sai do STAKE
        // travado, então o suprimento se conserva — não há emissão nova aqui.
        let desafiante = desafiante.ok_or_else(|| erro("disputa sem desafiante"))?;
        state.creditar(&solicitante, recompensa)?;
        let mut bounty: Amount = 0;
        if let Some(o) = oraculo.as_deref().and_then(|nome| state.oracles.get_mut(nome)) {
            o.failed = o.failed.saturating_add(1);
            o.desce(REP_ERRO);
            bounty = o.stake.min(AI_ORACLE_SLASH);
            if bounty > 0 {
                o.stake -= bounty; // `min` acima garante que não fica negativo
                o.slashed = soma(o.slashed, bounty)?;
            }
        }
        state.creditar(&desafiante, soma(fianca, bounty)?)?;
        if let Some(t) = state.ai_tasks.get_mut(&task_id) {
            t.state = "OVERTURNED".into();
        }
    }

    for (jurado, voto) in &votos {
        if let Some(jo) = state.oracles.get_mut(jurado) {
            if *voto == mantido {
                jo.sobe(REP_JURADO_CERTO);
            } else {
                jo.desce(REP_JURADO_ERRADO);
            }
        }
    }
    if let Some(t) = state.ai_tasks.get_mut(&task_id) {
        t.output = None; // poda
        if let Challenge::Disputa { votes, .. } = &mut t.challenge {
            votes.clear(); // `= {}`: a chave `votes` permanece na folha, vazia
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- AI_BID

/// Fase 4 — oráculo dá um lance (preço) numa tarefa aberta.
fn ai_bid(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < AI_MARKET_HEIGHT {
        return Err(erro("marketplace de IA ainda não ativo"));
    }
    if !state.oracles.contains_key(&tx.from) {
        return Err(erro("só oráculo registrado pode dar lance"));
    }
    let task_id = texto(tx, "taskId").unwrap_or("").to_string();
    // O `filter(mode == "OPEN")` da referência virou o próprio acesso à variante: só
    // uma tarefa `Aberta` TEM `budget` e `bids`.
    let tarefa = state.ai_tasks.get(&task_id).ok_or_else(|| erro("tarefa aberta inexistente"))?;
    let aberta = tarefa.aberta().ok_or_else(|| erro("tarefa aberta inexistente"))?;
    if tarefa.state != "BIDDING" {
        return Err(erro("lances encerrados"));
    }
    if ctx.block_ts >= aberta.bid_deadline {
        return Err(erro("janela de lances expirada"));
    }
    // `BigInt(tx.data.price)` que lança vira 'preço do lance inválido'; o valor
    // fora da faixa tem mensagem própria — as duas foram mantidas separadas.
    let preco = campo(tx, "price")
        .and_then(quantia)
        .ok_or_else(|| erro("preço do lance inválido"))?;
    if preco == 0 || preco > aberta.budget {
        return Err(erro("preço do lance inválido (0 < preço <= orçamento)"));
    }
    exige_saldo(state, &tx.from, ctx.fee, "saldo insuficiente para a taxa")?;

    state.debitar(&tx.from, ctx.fee)?;
    if let Some(TaskKind::Aberta(a)) = state.ai_tasks.get_mut(&task_id).map(|t| &mut t.kind) {
        a.bids.insert(tx.from.clone(), (preco, ctx.block_ts));
    }
    Ok(())
}

// ---------------------------------------------------------------- AI_AWARD

/// Fase 4 — o solicitante adjudica a tarefa ao melhor lance (a escolha por
/// preço × reputação é off-chain; a cadeia só confere que o escolhido deu lance).
/// O excedente do orçamento volta ao solicitante e o preço fica em escrow para o
/// oráculo, que passa a entregar via `AI_RESULT`.
fn ai_award(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < AI_MARKET_HEIGHT {
        return Err(erro("marketplace de IA ainda não ativo"));
    }
    let task_id = texto(tx, "taskId").unwrap_or("").to_string();
    let tarefa = state.ai_tasks.get(&task_id).ok_or_else(|| erro("tarefa aberta inexistente"))?;
    let aberta = tarefa.aberta().ok_or_else(|| erro("tarefa aberta inexistente"))?;
    if tarefa.requester != tx.from {
        return Err(erro("só o solicitante adjudica"));
    }
    if tarefa.state != "BIDDING" {
        return Err(erro("tarefa não está em lances"));
    }
    if ctx.block_ts >= tarefa.deadline {
        return Err(erro("tarefa expirada"));
    }
    let vencedor = texto(tx, "oracle").unwrap_or("").to_string();
    let (preco, _) = *aberta.bids.get(&vencedor).ok_or_else(|| erro("oráculo escolhido não deu lance"))?;
    exige_saldo(state, &tx.from, ctx.fee, "saldo insuficiente para a taxa")?;
    // O lance já foi limitado ao orçamento em AI_BID, então a diferença não estoura.
    let troco = aberta.budget.saturating_sub(preco);

    state.debitar(&tx.from, ctx.fee)?;
    if troco > 0 {
        state.creditar(&tx.from, troco)?;
    }
    if let Some(t) = state.ai_tasks.get_mut(&task_id) {
        t.reward = preco;
        t.state = "PENDING".into(); // vira tarefa de oráculo único…
        if let TaskKind::Aberta(a) = &mut t.kind {
            // …mas CONTINUA `mode: 'OPEN'` na referência: o AI_AWARD não reescreve o
            // modo, só preenche o designado. É por isso que a variante é imutável e
            // as chaves `budget`/`bidDeadline`/`bids` permanecem na folha.
            a.assigned_oracle = Some(vencedor);
            a.bids.clear(); // poda
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- AI_COMMIT

/// Fase 2 — o oráculo trava `hash(output|salt)` ANTES de ver as respostas dos
/// outros. É o que impede copiar a resposta alheia: quem só observa a cadeia vê
/// hashes, e uma hash não revela o output que a gerou.
fn ai_commit(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < AI_QUORUM_HEIGHT {
        return Err(erro("quórum de IA ainda não ativo"));
    }
    if !state.oracles.contains_key(&tx.from) {
        return Err(erro("remetente não é um oráculo de IA registrado"));
    }
    let task_id = texto(tx, "taskId").unwrap_or("").to_string();
    let tarefa = state.ai_tasks.get(&task_id).ok_or_else(|| erro("tarefa de quórum inexistente"))?;
    let q = tarefa.quorum().ok_or_else(|| erro("tarefa de quórum inexistente"))?;
    if tarefa.state != "PENDING" || q.phase != Fase::Commit {
        return Err(erro("fase de commit encerrada"));
    }
    if ctx.block_ts >= q.commit_deadline {
        return Err(erro("janela de commit expirada"));
    }
    if q.commits.contains_key(&tx.from) {
        return Err(erro("oráculo já commitou nesta tarefa"));
    }
    let commit = texto(tx, "commit").filter(|c| e_hex64(c)).ok_or_else(|| erro("commit inválido (64 hex)"))?;
    let commit = commit.to_string();
    exige_saldo(state, &tx.from, ctx.fee, "saldo insuficiente para a taxa")?;

    state.debitar(&tx.from, ctx.fee)?;
    if let Some(q) = state.ai_tasks.get_mut(&task_id).and_then(Task::quorum_mut) {
        // Guardado COMO VEIO — a referência não normaliza a caixa ao gravar. Quem
        // normaliza é a comparação do reveal; mudar isto aqui mudaria o estado.
        q.commits.insert(tx.from.clone(), commit);
    }
    Ok(())
}

// ---------------------------------------------------------------- AI_REVEAL

/// Fase 2 — o oráculo revela `(output, salt)` e a cadeia confere contra o commit.
/// Quando `quorum` oráculos revelam o MESMO `resultHash`, a tarefa conclui e a
/// recompensa é dividida entre eles.
///
/// # A conferência do commit
///
/// `eav_hash(output|salt)` é comparado com o commit guardado, EM MINÚSCULA dos
/// dois lados: `eav_hash` já produz minúscula, e o commit guardado é passado por
/// `to_lowercase` na hora de comparar (a referência faz
/// `String(committed).toLowerCase()`, porque aceitou o commit em qualquer caixa).
/// Errar a caixa aqui é a falha mais cara possível: NENHUM reveal jamais bateria,
/// toda tarefa de quórum expiraria, e um teste que comparasse errado nos dois
/// lados passaria feliz.
fn ai_reveal(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < AI_QUORUM_HEIGHT {
        return Err(erro("quórum de IA ainda não ativo"));
    }
    if !state.oracles.contains_key(&tx.from) {
        return Err(erro("remetente não é um oráculo de IA registrado"));
    }
    let task_id = texto(tx, "taskId").unwrap_or("").to_string();
    let tarefa = state.ai_tasks.get(&task_id).ok_or_else(|| erro("tarefa de quórum inexistente"))?;
    let q = tarefa.quorum().ok_or_else(|| erro("tarefa de quórum inexistente"))?;
    if tarefa.state != "PENDING" {
        return Err(erro("tarefa já concluída"));
    }
    let commit = q.commits.get(&tx.from).ok_or_else(|| erro("oráculo não commitou nesta tarefa"))?.clone();
    if q.reveals.contains_key(&tx.from) {
        return Err(erro("oráculo já revelou"));
    }
    if ctx.block_ts < q.commit_deadline {
        return Err(erro("a janela de reveal ainda não abriu"));
    }
    if ctx.block_ts >= q.reveal_deadline {
        return Err(erro("janela de reveal expirada"));
    }
    let output = texto(tx, "output").filter(|o| !o.is_empty()).ok_or_else(|| erro("output obrigatório"))?;
    if output.len() > MAX_AI_OUTPUT_BYTES {
        return Err(erro("output excede o limite"));
    }
    let salt = texto(tx, "salt")
        .filter(|s| !s.is_empty() && s.encode_utf16().count() <= MAX_SALT_LEN)
        .ok_or_else(|| erro("salt inválido"))?;
    // A concatenação usa o separador '|' — sem ele, (output="ab", salt="c") e
    // (output="a", salt="bc") teriam o mesmo commit e um oráculo poderia trocar a
    // resposta depois de commitada.
    if eav_hash_one(format!("{output}|{salt}")) != commit.to_lowercase() {
        return Err(erro("reveal não confere com o commit"));
    }
    exige_saldo(state, &tx.from, ctx.fee, "saldo insuficiente para a taxa")?;

    let output = output.to_string();
    let result_hash = eav_hash_one(&output);
    let alvo = q.quorum;
    let recompensa = tarefa.reward;

    state.debitar(&tx.from, ctx.fee)?;
    let tarefa = state.ai_tasks.get_mut(&task_id).ok_or_else(|| erro("tarefa de quórum inexistente"))?;
    // Inalcançável (conferido acima); recusar em vez de `expect`.
    let Some(q) = tarefa.quorum_mut() else { return Err(erro("tarefa de quórum inexistente")) };
    q.reveals.insert(tx.from.clone(), result_hash);
    q.reveal_outputs.insert(tx.from.clone(), output);

    // Apura: algum resultHash atingiu o quórum? No máximo UM pode ter atingido,
    // porque a tarefa conclui na revelação que fecha a conta — então não há
    // desempate a fazer e a ordem de varredura não muda o resultado.
    let mut contagem: BTreeMap<&str, u64> = BTreeMap::new();
    for h in q.reveals.values() {
        *contagem.entry(h.as_str()).or_insert(0) += 1;
    }
    let vencedora = contagem.iter().find(|(_, c)| **c >= alvo).map(|(h, _)| h.to_string());
    let Some(vencedora) = vencedora else { return Ok(()) };

    // ORDEM CANÔNICA (endereço crescente), não ordem de chegada.
    //
    // `reveals` é um `BTreeMap`, então iterar já dá a ordem canônica — não é
    // preciso guardar nada. A ordem de chegada NÃO entra na raiz (a folha ordena
    // as chaves do mapa), e enquanto `winners` dependia dela o consenso dependia
    // de um dado que a raiz não commita: um nó que reconstruísse o estado a
    // partir dela apuraria a revelação final noutra ordem e gravaria outro
    // `winners`. Mesma raiz antes, raízes diferentes depois.
    let mut vencedores: Vec<String> = Vec::new();
    let mut perdedores: Vec<String> = Vec::new();
    for (quem, h) in &q.reveals {
        if *h == vencedora {
            vencedores.push(quem.clone());
        } else {
            perdedores.push(quem.clone());
        }
    }
    let n = vencedores.len() as Amount;
    if n == 0 {
        // Inalcançável: a hash vencedora saiu das próprias revelações. A guarda
        // existe só para que uma divisão por zero jamais vire pânico.
        return Err(erro("quórum apurado sem vencedores"));
    }
    let quota = recompensa / n;
    let resto = recompensa - quota * n;

    // Todo vencedor tem a MESMA hash, logo o mesmo output — qual deles serve de
    // fonte é indiferente.
    let saida = vencedores.first().and_then(|a| q.reveal_outputs.get(a)).cloned();
    q.phase = Fase::Done;
    q.winners = Some(vencedores.clone());
    // Poda os outputs (mantém só os resultHash) — limita o crescimento de estado.
    q.reveal_outputs.clear();

    tarefa.state = "DONE".into();
    tarefa.result_hash = Some(vencedora);
    tarefa.output = saida;
    tarefa.completed_at = Some(tx.timestamp);
    // Poda a ENTRADA (fica no tx AI_TASK).
    tarefa.prompt = None;
    tarefa.params = None;

    // O resto vai ao MENOR endereço (o primeiro da ordem canônica). É poeira —
    // menor que o número de vencedores, no máximo 21 e7 — e o que importa é a
    // regra ser única e derivável do estado committado, não quem leva.
    for (i, quem) in vencedores.iter().enumerate() {
        let parte = if i == 0 { soma(quota, resto)? } else { quota };
        state.creditar(quem, parte)?;
        if let Some(o) = state.oracles.get_mut(quem) {
            o.creditar_acerto();
        }
    }
    for quem in &perdedores {
        if let Some(o) = state.oracles.get_mut(quem) {
            o.failed = o.failed.saturating_add(1);
            o.desce(REP_ERRO);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- AI_REFUND

/// Devolve o escrow ao solicitante quando a tarefa não foi atendida até o prazo.
///
/// Sem isto, um oráculo que simplesmente some prenderia os fundos para sempre. Não
/// tem porta de fork no caminho básico: vale desde o primeiro bloco da camada.
fn ai_refund(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let task_id = texto(tx, "taskId").unwrap_or("").to_string();
    let tarefa = state.ai_tasks.get(&task_id).ok_or_else(|| erro("tarefa de IA inexistente"))?;
    if tarefa.requester != tx.from {
        return Err(erro("apenas o solicitante pode reembolsar"));
    }
    // PENDING (oráculo não entregou) ou BIDDING (tarefa aberta sem adjudicação).
    if tarefa.state != "PENDING" && tarefa.state != "BIDDING" {
        return Err(erro("tarefa de IA não é reembolsável"));
    }
    // H-2: usa o timestamp do BLOCO. Ver a nota em `ai_task`.
    if ctx.block_ts < tarefa.deadline {
        return Err(erro("a tarefa ainda não expirou"));
    }

    let recompensa = tarefa.reward;
    let e_quorum = tarefa.quorum().is_some();
    let designado = tarefa.assigned_oracle().map(str::to_string);
    // Quem commitou e não revelou desperdiçou a tarefa dos outros. Nos outros modos
    // os dois mapas nem existem, e a lista sai vazia.
    let faltosos: Vec<String> = tarefa
        .commits()
        .keys()
        .filter(|a| !tarefa.reveals().contains_key(*a))
        .cloned()
        .collect();

    let tarefa = state.ai_tasks.get_mut(&task_id).ok_or_else(|| erro("tarefa de IA inexistente"))?;
    tarefa.state = "REFUNDED".into();
    tarefa.completed_at = Some(tx.timestamp);
    tarefa.prompt = None; // poda a ENTRADA (limita o crescimento de estado)
    tarefa.params = None;
    // A poda do commit-reveal só se aplica ao modo quórum, e agora é o próprio
    // acesso à variante que garante isso — não um `if` sobre um texto.
    if let Some(q) = tarefa.quorum_mut() {
        q.commits.clear();
        q.reveals.clear();
        q.reveal_outputs.clear();
    }
    state.creditar(&tx.from, recompensa)?;

    if e_quorum {
        // Fase 2: tarefa de quórum expirada sem consenso. Quem commitou mas NÃO
        // revelou perde reputação — a camada aprende a filtrar esses oráculos.
        // O gate de altura é reproduzido por fidelidade, ainda que redundante: uma
        // tarefa QUORUM só pode ter nascido acima dele.
        if ctx.height >= AI_QUORUM_HEIGHT {
            for quem in &faltosos {
                if let Some(o) = state.oracles.get_mut(quem) {
                    o.failed = o.failed.saturating_add(1);
                    o.desce(REP_NAO_REVELOU);
                }
            }
        }
    } else if ctx.height >= AI_ACCOUNTABILITY_HEIGHT {
        // Fase 1: o oráculo DESIGNADO que deixou a tarefa expirar sem entrega é
        // responsabilizado — perde reputação e é slashado, e o confisco vai como
        // COMPENSAÇÃO ao solicitante (além do refund). Conserva o suprimento: o
        // slash sai do stake travado do oráculo, não é emissão nova.
        if let Some(nome) = designado {
            let mut slash: Amount = 0;
            if let Some(o) = state.oracles.get_mut(&nome) {
                o.failed = o.failed.saturating_add(1);
                o.desce(REP_ERRO);
                slash = o.stake.min(AI_ORACLE_SLASH);
                if slash > 0 {
                    o.stake -= slash;
                    o.slashed = soma(o.slashed, slash)?;
                }
            }
            if slash > 0 {
                state.creditar(&tx.from, slash)?;
            }
        }
    }
    Ok(())
}

// ============================================================================
// Testes
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::address::derive_address_from;

    const ALTURA_TUDO: u64 = 2_000_000; // acima de todos os forks (menos o TEE, dormente)
    const T0: u64 = 1_700_000_000_000;

    fn addr(s: &str) -> String {
        derive_address_from(s)
    }

    fn ctx(height: u64, block_ts: u64) -> Ctx {
        Ctx { height, block_ts, fee: 0 }
    }

    /// Transação de IA com `data` montada por pares e um `id` determinístico.
    fn tx_ai(tipo: &str, de: &str, dados: &[(&str, JsonValue)]) -> Tx {
        let mut tx = Tx::new(tipo, de, 1, T0 as i64);
        tx.data = Some(JsonValue::map(dados.iter().map(|(k, v)| (k.to_string(), v.clone()))));
        tx.id = Some(crate::transaction::tx_id(&tx));
        tx
    }

    fn s(v: &str) -> JsonValue {
        JsonValue::str(v)
    }

    /// Estado com um solicitante rico e N oráculos registrados.
    fn cenario(oraculos: &[&str], saldo: Amount) -> (State, String) {
        let mut st = State::new();
        let req = addr("requester");
        st.account_mut(&req).balance = saldo;
        for o in oraculos {
            let a = addr(o);
            st.oracles.insert(a.clone(), Oracle::registrado(&a, 500 * UNIT, T0));
        }
        (st, req)
    }

    /// Cria uma tarefa de oráculo designado e devolve o id.
    fn cria_tarefa(st: &mut State, req: &str, oraculo: &str, recompensa: Amount, h: u64) -> String {
        let mut tx = tx_ai("AI_TASK", req, &[("prompt", s("qual a cotação?")), ("oracle", s(oraculo))]);
        tx.amount = recompensa.to_string();
        tx.id = Some(crate::transaction::tx_id(&tx));
        aplicar(st, &tx, &ctx(h, T0)).expect("tarefa deve ser criada");
        tx.id.unwrap()
    }

    // ------------------------------------------------------------ AI_TASK

    #[test]
    fn ai_task_escrowa_a_recompensa() {
        let (mut st, req) = cenario(&[], 100 * UNIT);
        let orc = addr("oraculo");
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, ALTURA_TUDO);
        let t = &st.ai_tasks[&id];
        assert_eq!(t.state, "PENDING");
        assert_eq!(t.reward, 10 * UNIT);
        assert_eq!(t.assigned_oracle(), Some(orc.as_str()));
        assert_eq!(t.deadline, T0 + AI_TASK_TIMEOUT_MS, "prazo ancorado no relógio do BLOCO");
        assert_eq!(st.balance_of(&req), 90 * UNIT, "a recompensa saiu do saldo");
    }

    #[test]
    fn ai_task_sem_oraculo_designado_e_rejeitada() {
        // O erro mais provável: esquecer `data.oracle` — sem ele, qualquer oráculo
        // registrado sacaria o escrow.
        let (mut st, req) = cenario(&[], 100 * UNIT);
        let mut tx = tx_ai("AI_TASK", &req, &[("prompt", s("oi"))]);
        tx.amount = (10 * UNIT).to_string();
        let e = aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).unwrap_err();
        assert!(e.0.contains("oráculo designado"), "{}", e.0);
        assert_eq!(st.balance_of(&req), 100 * UNIT, "rejeição não pode debitar");
        assert!(st.ai_tasks.is_empty());
    }

    #[test]
    fn ai_task_sem_saldo_para_o_escrow_nao_muta_nada() {
        let (mut st, req) = cenario(&[], UNIT);
        let orc = addr("oraculo");
        let mut tx = tx_ai("AI_TASK", &req, &[("prompt", s("oi")), ("oracle", s(&orc))]);
        tx.amount = (10 * UNIT).to_string();
        assert!(aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).is_err());
        assert_eq!(st.balance_of(&req), UNIT);
        assert!(st.ai_tasks.is_empty());
    }

    #[test]
    fn ai_task_de_quorum_abaixo_do_fork_cai_no_modo_designado() {
        if AI_QUORUM_HEIGHT == 0 { return; }
        // A porta de altura é o que impede este cliente de aceitar o que a rede
        // rejeita: abaixo de AI_QUORUM_HEIGHT o campo `quorum` é ignorado, e sem
        // `data.oracle` a transação tem de falhar.
        let (mut st, req) = cenario(&[], 100 * UNIT);
        let mut tx = tx_ai("AI_TASK", &req, &[("prompt", s("oi")), ("quorum", JsonValue::Int(2))]);
        tx.amount = (10 * UNIT).to_string();
        let e = aplicar(&mut st, &tx, &ctx(AI_QUORUM_HEIGHT - 1, T0)).unwrap_err();
        assert!(e.0.contains("oráculo designado"), "{}", e.0);
        // E acima do fork, cria a tarefa de quórum.
        aplicar(&mut st, &tx, &ctx(AI_QUORUM_HEIGHT, T0)).unwrap();
        assert_eq!(st.ai_tasks[tx.id.as_ref().unwrap()].mode(), "QUORUM");
    }

    #[test]
    fn ai_task_recusa_quorum_fora_da_faixa() {
        let (mut st, req) = cenario(&[], 100 * UNIT);
        for q in [1_i64, 22] {
            let mut tx = tx_ai("AI_TASK", &req, &[("prompt", s("oi")), ("quorum", JsonValue::Int(q))]);
            tx.amount = (10 * UNIT).to_string();
            let e = aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).unwrap_err();
            assert!(e.0.contains("quórum inválido"), "q={q}: {}", e.0);
        }
        assert_eq!(st.balance_of(&req), 100 * UNIT);
    }

    // ------------------------------------------------------------ AI_RESULT

    #[test]
    fn ai_result_abaixo_do_fork_de_desafio_paga_na_hora() {
        if AI_CHALLENGE_HEIGHT == 0 { return; }
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let orc = addr("o1");
        let h = AI_CHALLENGE_HEIGHT - 1;
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, h);
        let tx = tx_ai("AI_RESULT", &orc, &[("taskId", s(&id)), ("output", s("42"))]);
        aplicar(&mut st, &tx, &ctx(h, T0 + 1000)).unwrap();
        assert_eq!(st.ai_tasks[&id].state, "DONE");
        assert_eq!(st.balance_of(&orc), 10 * UNIT, "grandfather: paga na entrega");
        assert_eq!(st.oracles[&orc].rep(), REPUTACAO_INICIAL + REP_ACERTO);
        assert_eq!(st.ai_tasks[&id].result_hash.as_deref(), Some(eav_hash_one("42").as_str()));
        assert!(st.ai_tasks[&id].prompt.is_none(), "a entrada é podada");
    }

    #[test]
    fn ai_result_acima_do_fork_segura_em_escrow() {
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let orc = addr("o1");
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, ALTURA_TUDO);
        let tx = tx_ai("AI_RESULT", &orc, &[("taskId", s(&id)), ("output", s("42"))]);
        aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).unwrap();
        assert_eq!(st.ai_tasks[&id].state, "CHALLENGE_PERIOD");
        assert_eq!(st.balance_of(&orc), 0, "a recompensa fica retida na janela");
        assert_eq!(st.ai_tasks[&id].challenge_deadline(), T0 + AI_CHALLENGE_WINDOW_MS);
    }

    #[test]
    fn ai_result_de_outro_oraculo_e_rejeitado_sem_mutar() {
        let (mut st, req) = cenario(&["o1", "intruso"], 100 * UNIT);
        let (orc, intruso) = (addr("o1"), addr("intruso"));
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, ALTURA_TUDO);
        let antes = st.ai_tasks[&id].clone();
        let tx = tx_ai("AI_RESULT", &intruso, &[("taskId", s(&id)), ("output", s("lixo"))]);
        let e = aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).unwrap_err();
        assert!(e.0.contains("não é o oráculo designado"), "{}", e.0);
        assert_eq!(st.ai_tasks[&id], antes);
        assert_eq!(st.balance_of(&intruso), 0);
    }

    #[test]
    fn ai_result_so_hash_canonicaliza_em_minuscula() {
        // Sem o to_lowercase, o mesmo resultado em caixa diferente seria outro
        // resultado — e no quórum contaria duas vezes.
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let orc = addr("o1");
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, ALTURA_TUDO);
        let h_maiuscula = eav_hash_one("42").to_uppercase();
        let tx = tx_ai("AI_RESULT", &orc, &[("taskId", s(&id)), ("resultHash", s(&h_maiuscula))]);
        aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).unwrap();
        assert_eq!(st.ai_tasks[&id].result_hash.as_deref(), Some(eav_hash_one("42").as_str()));
        assert!(st.ai_tasks[&id].output.is_none(), "modo só-hash não grava output");
    }

    // ------------------------------------------------------------ commit-reveal

    /// Monta uma tarefa de quórum já na janela de reveal e devolve (estado, req, id).
    fn cenario_quorum(q: i64, oraculos: &[&str]) -> (State, String, String) {
        let (mut st, req) = cenario(oraculos, 100 * UNIT);
        let mut tx = tx_ai("AI_TASK", &req, &[("prompt", s("oi")), ("quorum", JsonValue::Int(q))]);
        tx.amount = (10 * UNIT).to_string();
        tx.id = Some(crate::transaction::tx_id(&tx));
        aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).unwrap();
        (st, req, tx.id.unwrap())
    }

    fn commit_de(output: &str, salt: &str) -> String {
        eav_hash_one(format!("{output}|{salt}"))
    }

    #[test]
    fn ai_commit_grava_o_compromisso_e_recusa_hash_malformada() {
        let (mut st, _req, id) = cenario_quorum(2, &["o1"]);
        let o1 = addr("o1");
        let ruim = tx_ai("AI_COMMIT", &o1, &[("taskId", s(&id)), ("commit", s("nao-e-hash"))]);
        let e = aplicar(&mut st, &ruim, &ctx(ALTURA_TUDO, T0)).unwrap_err();
        assert!(e.0.contains("commit inválido"), "{}", e.0);
        assert!(st.ai_tasks[&id].commits().is_empty());

        let c = commit_de("42", "sal");
        let ok = tx_ai("AI_COMMIT", &o1, &[("taskId", s(&id)), ("commit", s(&c))]);
        aplicar(&mut st, &ok, &ctx(ALTURA_TUDO, T0)).unwrap();
        assert_eq!(st.ai_tasks[&id].commits()[&o1], c);
        // Segundo commit do mesmo oráculo é recusado: trocar o compromisso depois
        // de ver a cadeia derrubaria o esquema inteiro.
        let e = aplicar(&mut st, &ok, &ctx(ALTURA_TUDO, T0)).unwrap_err();
        assert!(e.0.contains("já commitou"), "{}", e.0);
    }

    #[test]
    fn reveal_que_nao_bate_com_o_commit_e_rejeitado_sem_mutar() {
        let (mut st, _req, id) = cenario_quorum(2, &["o1"]);
        let o1 = addr("o1");
        let c = commit_de("42", "sal");
        let cm = tx_ai("AI_COMMIT", &o1, &[("taskId", s(&id)), ("commit", s(&c))]);
        aplicar(&mut st, &cm, &ctx(ALTURA_TUDO, T0)).unwrap();

        let ts = T0 + AI_COMMIT_WINDOW_MS;
        let antes = st.ai_tasks[&id].clone();
        // Output trocado: é exatamente o ataque que o esquema existe para barrar —
        // ver a resposta alheia e revelar outra coisa.
        let rv = tx_ai("AI_REVEAL", &o1, &[("taskId", s(&id)), ("output", s("99")), ("salt", s("sal"))]);
        let e = aplicar(&mut st, &rv, &ctx(ALTURA_TUDO, ts)).unwrap_err();
        assert_eq!(e.0, "reveal não confere com o commit");
        assert_eq!(st.ai_tasks[&id], antes, "rejeição não pode deixar rastro");

        // Salt trocado, mesmo output: também não bate.
        let rv = tx_ai("AI_REVEAL", &o1, &[("taskId", s(&id)), ("output", s("42")), ("salt", s("outro"))]);
        assert!(aplicar(&mut st, &rv, &ctx(ALTURA_TUDO, ts)).is_err());
        assert_eq!(st.ai_tasks[&id], antes);
    }

    #[test]
    fn commit_em_maiuscula_ainda_confere_no_reveal() {
        // A referência aceita o commit em qualquer caixa e normaliza na COMPARAÇÃO.
        // Se a normalização sumisse, nenhum commit em maiúscula jamais abriria.
        let (mut st, _req, id) = cenario_quorum(2, &["o1"]);
        let o1 = addr("o1");
        let c = commit_de("42", "sal").to_uppercase();
        let cm = tx_ai("AI_COMMIT", &o1, &[("taskId", s(&id)), ("commit", s(&c))]);
        aplicar(&mut st, &cm, &ctx(ALTURA_TUDO, T0)).unwrap();
        assert_eq!(st.ai_tasks[&id].commits()[&o1], c, "guardado como veio");

        let rv = tx_ai("AI_REVEAL", &o1, &[("taskId", s(&id)), ("output", s("42")), ("salt", s("sal"))]);
        aplicar(&mut st, &rv, &ctx(ALTURA_TUDO, T0 + AI_COMMIT_WINDOW_MS)).unwrap();
        assert_eq!(st.ai_tasks[&id].reveals()[&o1], eav_hash_one("42"));
    }

    #[test]
    fn reveal_antes_da_janela_e_recusado() {
        // Revelar enquanto o commit ainda está aberto entregaria a resposta a quem
        // ainda não commitou — o que o esquema existe para impedir.
        let (mut st, _req, id) = cenario_quorum(2, &["o1"]);
        let o1 = addr("o1");
        let c = commit_de("42", "sal");
        aplicar(&mut st, &tx_ai("AI_COMMIT", &o1, &[("taskId", s(&id)), ("commit", s(&c))]), &ctx(ALTURA_TUDO, T0)).unwrap();
        let rv = tx_ai("AI_REVEAL", &o1, &[("taskId", s(&id)), ("output", s("42")), ("salt", s("sal"))]);
        let e = aplicar(&mut st, &rv, &ctx(ALTURA_TUDO, T0)).unwrap_err();
        assert!(e.0.contains("ainda não abriu"), "{}", e.0);
    }

    #[test]
    fn quorum_com_dois_oraculos_concordantes_conclui_e_divide() {
        let (mut st, _req, id) = cenario_quorum(2, &["o1", "o2"]);
        let (o1, o2) = (addr("o1"), addr("o2"));
        let c = commit_de("42", "sal");
        for (quem, salt) in [(&o1, "sal"), (&o2, "sal2")] {
            let c = commit_de("42", salt);
            aplicar(&mut st, &tx_ai("AI_COMMIT", quem, &[("taskId", s(&id)), ("commit", s(&c))]), &ctx(ALTURA_TUDO, T0)).unwrap();
        }
        assert_eq!(commit_de("42", "sal"), c);

        let ts = T0 + AI_COMMIT_WINDOW_MS;
        let r1 = tx_ai("AI_REVEAL", &o1, &[("taskId", s(&id)), ("output", s("42")), ("salt", s("sal"))]);
        aplicar(&mut st, &r1, &ctx(ALTURA_TUDO, ts)).unwrap();
        assert_eq!(st.ai_tasks[&id].state, "PENDING", "um só reveal não fecha o quórum");

        let r2 = tx_ai("AI_REVEAL", &o2, &[("taskId", s(&id)), ("output", s("42")), ("salt", s("sal2"))]);
        aplicar(&mut st, &r2, &ctx(ALTURA_TUDO, ts + 1)).unwrap();

        let t = &st.ai_tasks[&id];
        assert_eq!(t.state, "DONE");
        assert_eq!(t.phase(), Some(Fase::Done));
        assert_eq!(t.result_hash.as_deref(), Some(eav_hash_one("42").as_str()));
        assert_eq!(t.winners(), Some(&[o1.clone(), o2.clone()][..]), "ordem de revelação");
        assert!(t.reveal_outputs().is_empty(), "os outputs são podados");
        assert_eq!(st.balance_of(&o1), 5 * UNIT);
        assert_eq!(st.balance_of(&o2), 5 * UNIT);
        assert_eq!(st.oracles[&o1].rep(), REPUTACAO_INICIAL + REP_ACERTO);
    }

    #[test]
    fn quorum_divergente_penaliza_a_minoria_e_o_resto_vai_ao_primeiro() {
        // Recompensa ímpar: o resto (1 e7) vai ao PRIMEIRO a revelar. É por isso que
        // a ordem de revelação é guardada em vez de reconstruída do BTreeMap.
        let (mut st, _req, id) = cenario_quorum(2, &["o1", "o2", "o3"]);
        st.ai_tasks.get_mut(&id).unwrap().reward = 7;
        let (o1, o2, o3) = (addr("o1"), addr("o2"), addr("o3"));
        for (quem, out) in [(&o1, "42"), (&o2, "42"), (&o3, "99")] {
            let c = commit_de(out, "sal");
            aplicar(&mut st, &tx_ai("AI_COMMIT", quem, &[("taskId", s(&id)), ("commit", s(&c))]), &ctx(ALTURA_TUDO, T0)).unwrap();
        }
        let ts = T0 + AI_COMMIT_WINDOW_MS;
        // O divergente revela primeiro; ainda assim não entra no rateio.
        for (quem, out) in [(&o3, "99"), (&o1, "42"), (&o2, "42")] {
            let rv = tx_ai("AI_REVEAL", quem, &[("taskId", s(&id)), ("output", s(out)), ("salt", s("sal"))]);
            aplicar(&mut st, &rv, &ctx(ALTURA_TUDO, ts)).unwrap();
        }
        assert_eq!(st.ai_tasks[&id].state, "DONE");
        assert_eq!(st.balance_of(&o1), 4, "primeiro vencedor a revelar leva o resto");
        assert_eq!(st.balance_of(&o2), 3);
        assert_eq!(st.balance_of(&o3), 0);
        assert_eq!(st.oracles[&o3].rep(), REPUTACAO_INICIAL - REP_ERRO);
        assert_eq!(st.oracles[&o3].failed, 1);
    }

    #[test]
    fn reveal_sem_commit_e_rejeitado() {
        let (mut st, _req, id) = cenario_quorum(2, &["o1"]);
        let o1 = addr("o1");
        let rv = tx_ai("AI_REVEAL", &o1, &[("taskId", s(&id)), ("output", s("42")), ("salt", s("sal"))]);
        let e = aplicar(&mut st, &rv, &ctx(ALTURA_TUDO, T0 + AI_COMMIT_WINDOW_MS)).unwrap_err();
        assert!(e.0.contains("não commitou"), "{}", e.0);
    }

    // ------------------------------------------------------------ Fase 3

    /// Tarefa entregue e em janela de desafio.
    fn cenario_desafio() -> (State, String, String, String) {
        let (mut st, req) = cenario(&["o1", "j1", "j2", "j3"], 100 * UNIT);
        let orc = addr("o1");
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, ALTURA_TUDO);
        let tx = tx_ai("AI_RESULT", &orc, &[("taskId", s(&id)), ("output", s("42"))]);
        aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).unwrap();
        (st, req, orc, id)
    }

    #[test]
    fn ai_claim_paga_o_oraculo_apos_a_janela() {
        let (mut st, _req, orc, id) = cenario_desafio();
        let qualquer = addr("passante");
        let tx = tx_ai("AI_CLAIM", &qualquer, &[("taskId", s(&id))]);
        // Antes do prazo, não liquida.
        let e = aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).unwrap_err();
        assert!(e.0.contains("ainda aberta"), "{}", e.0);
        assert_eq!(st.balance_of(&orc), 0);
        // Depois, qualquer conta liquida — é o que impede o escrow de ficar preso.
        aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0 + AI_CHALLENGE_WINDOW_MS)).unwrap();
        assert_eq!(st.ai_tasks[&id].state, "DONE");
        assert_eq!(st.balance_of(&orc), 10 * UNIT);
    }

    #[test]
    fn ai_claim_abaixo_do_fork_e_recusado() {
        if AI_CHALLENGE_HEIGHT == 0 { return; }
        let (mut st, _req, _orc, id) = cenario_desafio();
        let tx = tx_ai("AI_CLAIM", &addr("passante"), &[("taskId", s(&id))]);
        let e = aplicar(&mut st, &tx, &ctx(AI_CHALLENGE_HEIGHT - 1, T0 + 10_000_000)).unwrap_err();
        assert_eq!(e.0, "desafio de IA ainda não ativo");
    }

    #[test]
    fn ai_challenge_trava_a_fianca_e_abre_disputa() {
        let (mut st, _req, _orc, id) = cenario_desafio();
        let d = addr("desafiante");
        st.account_mut(&d).balance = 50 * UNIT;
        let tx = tx_ai("AI_CHALLENGE", &d, &[("taskId", s(&id))]);
        aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0 + 1)).unwrap();
        let t = &st.ai_tasks[&id];
        assert_eq!(t.state, "DISPUTED");
        assert_eq!(t.bond(), AI_CHALLENGE_BOND);
        assert_eq!(t.verdict_deadline(), T0 + 1 + AI_VERDICT_WINDOW_MS);
        assert_eq!(st.balance_of(&d), 50 * UNIT - AI_CHALLENGE_BOND);
    }

    #[test]
    fn ai_challenge_sem_saldo_para_a_fianca_nao_muta() {
        let (mut st, _req, _orc, id) = cenario_desafio();
        let d = addr("pobre");
        let antes = st.ai_tasks[&id].clone();
        let tx = tx_ai("AI_CHALLENGE", &d, &[("taskId", s(&id))]);
        let e = aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0 + 1)).unwrap_err();
        assert!(e.0.contains("fiança"), "{}", e.0);
        assert_eq!(st.ai_tasks[&id], antes);
    }

    #[test]
    fn ai_verdict_ao_quorum_derruba_o_resultado_e_slasha_o_oraculo() {
        let (mut st, req, orc, id) = cenario_desafio();
        let d = addr("desafiante");
        st.account_mut(&d).balance = 50 * UNIT;
        aplicar(&mut st, &tx_ai("AI_CHALLENGE", &d, &[("taskId", s(&id))]), &ctx(ALTURA_TUDO, T0 + 1)).unwrap();

        let saldo_req = st.balance_of(&req);
        let ts = T0 + 2;
        for j in ["j1", "j2"] {
            let tx = tx_ai("AI_VERDICT", &addr(j), &[("taskId", s(&id)), ("valid", JsonValue::Bool(false))]);
            aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, ts)).unwrap();
        }
        assert_eq!(st.ai_tasks[&id].state, "DISPUTED", "dois votos não fecham o quórum de 3");
        let tx = tx_ai("AI_VERDICT", &addr("j3"), &[("taskId", s(&id)), ("valid", JsonValue::Bool(false))]);
        aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, ts)).unwrap();

        assert_eq!(st.ai_tasks[&id].state, "OVERTURNED");
        assert_eq!(st.balance_of(&req), saldo_req + 10 * UNIT, "solicitante reembolsado");
        assert_eq!(st.balance_of(&d), 50 * UNIT + AI_ORACLE_SLASH, "fiança devolvida + bounty");
        assert_eq!(st.oracles[&orc].stake, 500 * UNIT - AI_ORACLE_SLASH);
        assert_eq!(st.oracles[&orc].slashed, AI_ORACLE_SLASH);
        assert_eq!(st.oracles[&orc].rep(), REPUTACAO_INICIAL - REP_ERRO);
        // Jurados na maioria sobem.
        assert_eq!(st.oracles[&addr("j1")].rep(), REPUTACAO_INICIAL + REP_JURADO_CERTO);
    }

    #[test]
    fn ai_verdict_mantido_paga_o_oraculo_com_a_fianca() {
        let (mut st, _req, orc, id) = cenario_desafio();
        let d = addr("desafiante");
        st.account_mut(&d).balance = 50 * UNIT;
        aplicar(&mut st, &tx_ai("AI_CHALLENGE", &d, &[("taskId", s(&id))]), &ctx(ALTURA_TUDO, T0 + 1)).unwrap();
        for j in ["j1", "j2", "j3"] {
            let tx = tx_ai("AI_VERDICT", &addr(j), &[("taskId", s(&id)), ("valid", JsonValue::Bool(true))]);
            aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0 + 2)).unwrap();
        }
        assert_eq!(st.ai_tasks[&id].state, "UPHELD");
        assert_eq!(st.balance_of(&orc), 10 * UNIT + AI_CHALLENGE_BOND);
        assert_eq!(st.balance_of(&d), 50 * UNIT - AI_CHALLENGE_BOND, "desafio infundado custa a fiança");
    }

    #[test]
    fn ai_verdict_recusa_parte_interessada() {
        let (mut st, _req, orc, id) = cenario_desafio();
        let d = addr("desafiante");
        st.account_mut(&d).balance = 50 * UNIT;
        aplicar(&mut st, &tx_ai("AI_CHALLENGE", &d, &[("taskId", s(&id))]), &ctx(ALTURA_TUDO, T0 + 1)).unwrap();
        let antes = st.ai_tasks[&id].clone();
        let tx = tx_ai("AI_VERDICT", &orc, &[("taskId", s(&id)), ("valid", JsonValue::Bool(true))]);
        let e = aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0 + 2)).unwrap_err();
        assert_eq!(e.0, "parte interessada não pode julgar");
        assert_eq!(st.ai_tasks[&id], antes);
    }

    // ------------------------------------------------------------ Fase 4

    fn cria_aberta(st: &mut State, req: &str, orcamento: Amount) -> String {
        let mut tx = tx_ai("AI_TASK", req, &[("prompt", s("oi")), ("open", JsonValue::Bool(true))]);
        tx.amount = orcamento.to_string();
        tx.id = Some(crate::transaction::tx_id(&tx));
        aplicar(st, &tx, &ctx(ALTURA_TUDO, T0)).unwrap();
        tx.id.unwrap()
    }

    #[test]
    fn leilao_do_lance_a_adjudicacao_devolve_o_excedente() {
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let o1 = addr("o1");
        let id = cria_aberta(&mut st, &req, 10 * UNIT);
        assert_eq!(st.ai_tasks[&id].state, "BIDDING");
        assert_eq!(st.balance_of(&req), 90 * UNIT);

        let lance = tx_ai("AI_BID", &o1, &[("taskId", s(&id)), ("price", s(&(4 * UNIT).to_string()))]);
        aplicar(&mut st, &lance, &ctx(ALTURA_TUDO, T0 + 1)).unwrap();
        assert_eq!(st.ai_tasks[&id].bids()[&o1].0, 4 * UNIT);

        let award = tx_ai("AI_AWARD", &req, &[("taskId", s(&id)), ("oracle", s(&o1))]);
        aplicar(&mut st, &award, &ctx(ALTURA_TUDO, T0 + 2)).unwrap();
        let t = &st.ai_tasks[&id];
        assert_eq!(t.state, "PENDING");
        assert_eq!(t.reward, 4 * UNIT);
        assert_eq!(t.assigned_oracle(), Some(o1.as_str()));
        assert!(t.bids().is_empty(), "os lances são podados");
        assert_eq!(st.balance_of(&req), 96 * UNIT, "o excedente do orçamento voltou");
    }

    #[test]
    fn ai_bid_acima_do_orcamento_e_rejeitado() {
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let o1 = addr("o1");
        let id = cria_aberta(&mut st, &req, 10 * UNIT);
        let lance = tx_ai("AI_BID", &o1, &[("taskId", s(&id)), ("price", s(&(11 * UNIT).to_string()))]);
        let e = aplicar(&mut st, &lance, &ctx(ALTURA_TUDO, T0 + 1)).unwrap_err();
        assert!(e.0.contains("preço do lance inválido"), "{}", e.0);
        assert!(st.ai_tasks[&id].bids().is_empty());
    }

    #[test]
    fn ai_award_de_quem_nao_e_solicitante_e_rejeitado() {
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let o1 = addr("o1");
        let id = cria_aberta(&mut st, &req, 10 * UNIT);
        let lance = tx_ai("AI_BID", &o1, &[("taskId", s(&id)), ("price", s(&(4 * UNIT).to_string()))]);
        aplicar(&mut st, &lance, &ctx(ALTURA_TUDO, T0 + 1)).unwrap();
        let antes = st.ai_tasks[&id].clone();
        let award = tx_ai("AI_AWARD", &o1, &[("taskId", s(&id)), ("oracle", s(&o1))]);
        let e = aplicar(&mut st, &award, &ctx(ALTURA_TUDO, T0 + 2)).unwrap_err();
        assert_eq!(e.0, "só o solicitante adjudica");
        assert_eq!(st.ai_tasks[&id], antes);
    }

    #[test]
    fn ai_bid_abaixo_do_fork_de_mercado_e_recusado() {
        if AI_MARKET_HEIGHT == 0 { return; }
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let id = cria_aberta(&mut st, &req, 10 * UNIT);
        let lance = tx_ai("AI_BID", &addr("o1"), &[("taskId", s(&id)), ("price", JsonValue::Int(1))]);
        let e = aplicar(&mut st, &lance, &ctx(AI_MARKET_HEIGHT - 1, T0 + 1)).unwrap_err();
        assert_eq!(e.0, "marketplace de IA ainda não ativo");
    }

    // ------------------------------------------------------------ AI_REFUND

    #[test]
    fn ai_refund_devolve_o_escrow_e_slasha_o_designado() {
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let orc = addr("o1");
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, ALTURA_TUDO);
        let tx = tx_ai("AI_REFUND", &req, &[("taskId", s(&id))]);
        // Antes do prazo, não reembolsa — senão bastaria pedir na hora seguinte.
        let e = aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).unwrap_err();
        assert_eq!(e.0, "a tarefa ainda não expirou");
        assert_eq!(st.balance_of(&req), 90 * UNIT);

        aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0 + AI_TASK_TIMEOUT_MS)).unwrap();
        assert_eq!(st.ai_tasks[&id].state, "REFUNDED");
        // Recompensa de volta + compensação vinda do stake do oráculo faltoso.
        assert_eq!(st.balance_of(&req), 100 * UNIT + AI_ORACLE_SLASH);
        assert_eq!(st.oracles[&orc].stake, 500 * UNIT - AI_ORACLE_SLASH);
        assert_eq!(st.oracles[&orc].rep(), REPUTACAO_INICIAL - REP_ERRO);
    }

    #[test]
    fn ai_refund_abaixo_do_fork_de_responsabilizacao_nao_slasha() {
        if AI_ACCOUNTABILITY_HEIGHT == 0 { return; }
        let h = AI_ACCOUNTABILITY_HEIGHT - 1;
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let orc = addr("o1");
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, h);
        let tx = tx_ai("AI_REFUND", &req, &[("taskId", s(&id))]);
        aplicar(&mut st, &tx, &ctx(h, T0 + AI_TASK_TIMEOUT_MS)).unwrap();
        assert_eq!(st.balance_of(&req), 100 * UNIT, "só o refund, sem compensação");
        assert_eq!(st.oracles[&orc].stake, 500 * UNIT);
    }

    #[test]
    fn ai_refund_de_terceiro_e_rejeitado_sem_mutar() {
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let orc = addr("o1");
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, ALTURA_TUDO);
        let antes = st.ai_tasks[&id].clone();
        let tx = tx_ai("AI_REFUND", &addr("intruso"), &[("taskId", s(&id))]);
        let e = aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0 + AI_TASK_TIMEOUT_MS)).unwrap_err();
        assert_eq!(e.0, "apenas o solicitante pode reembolsar");
        assert_eq!(st.ai_tasks[&id], antes);
        assert_eq!(st.balance_of(&addr("intruso")), 0);
    }

    #[test]
    fn ai_refund_de_quorum_penaliza_quem_commitou_e_nao_revelou() {
        let (mut st, req, id) = cenario_quorum(2, &["o1", "o2"]);
        let (o1, o2) = (addr("o1"), addr("o2"));
        for quem in [&o1, &o2] {
            let c = commit_de("42", "sal");
            aplicar(&mut st, &tx_ai("AI_COMMIT", quem, &[("taskId", s(&id)), ("commit", s(&c))]), &ctx(ALTURA_TUDO, T0)).unwrap();
        }
        // Só o o1 revela; o quórum de 2 não fecha e a tarefa expira.
        let ts = T0 + AI_COMMIT_WINDOW_MS;
        let rv = tx_ai("AI_REVEAL", &o1, &[("taskId", s(&id)), ("output", s("42")), ("salt", s("sal"))]);
        aplicar(&mut st, &rv, &ctx(ALTURA_TUDO, ts)).unwrap();

        let fim = T0 + AI_COMMIT_WINDOW_MS + AI_REVEAL_WINDOW_MS;
        let tx = tx_ai("AI_REFUND", &req, &[("taskId", s(&id))]);
        aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, fim)).unwrap();
        assert_eq!(st.ai_tasks[&id].state, "REFUNDED");
        assert_eq!(st.balance_of(&req), 100 * UNIT, "quórum não slasha: só devolve");
        assert_eq!(st.oracles[&o2].rep(), REPUTACAO_INICIAL - REP_NAO_REVELOU, "commitou e sumiu");
        assert_eq!(st.oracles[&o1].rep(), REPUTACAO_INICIAL, "revelou: intacto");
        assert!(st.ai_tasks[&id].commits().is_empty(), "podado");
    }

    #[test]
    fn ai_refund_de_tarefa_ja_concluida_e_rejeitado() {
        if AI_CHALLENGE_HEIGHT == 0 { return; }
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let orc = addr("o1");
        let h = AI_CHALLENGE_HEIGHT - 1;
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, h);
        let r = tx_ai("AI_RESULT", &orc, &[("taskId", s(&id)), ("output", s("42"))]);
        aplicar(&mut st, &r, &ctx(h, T0)).unwrap();
        let tx = tx_ai("AI_REFUND", &req, &[("taskId", s(&id))]);
        let e = aplicar(&mut st, &tx, &ctx(h, T0 + AI_TASK_TIMEOUT_MS)).unwrap_err();
        assert_eq!(e.0, "tarefa de IA não é reembolsável");
    }

    // ------------------------------------------------------------ transversais

    #[test]
    fn tarefa_inexistente_nunca_materializa_conta() {
        // Uma rejeição que criasse conta-fantasma mudaria o stateRoot sem que
        // nenhuma transação tivesse se aplicado.
        let mut st = State::new();
        let quem = addr("ninguem");
        for tipo in ["AI_CLAIM", "AI_CHALLENGE", "AI_REFUND", "AI_AWARD"] {
            let tx = tx_ai(tipo, &quem, &[("taskId", s("nao-existe"))]);
            assert!(aplicar(&mut st, &tx, &ctx(ALTURA_TUDO, T0)).is_err(), "{tipo}");
        }
        assert!(st.accounts.is_empty());
        assert!(st.ai_tasks.is_empty());
    }

    /// Fase 6: atestação de ATESTADOR DESCONHECIDO derruba a transação, e nada muta.
    ///
    /// É a primeira guarda de `state.js:2103` (`if (!attester) throw`). Sem ela,
    /// qualquer um citaria um `attesterId` inventado.
    #[test]
    fn atestacao_de_atestador_nao_registrado_e_recusada_sem_mutar() {
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let orc = addr("o1");
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, AI_TEE_HEIGHT);
        let att = JsonValue::map([("attesterId".to_string(), s("nao-existe"))]);
        let tx = tx_ai("AI_RESULT", &orc, &[("taskId", s(&id)), ("output", s("42")), ("attestation", att)]);
        let e = aplicar(&mut st, &tx, &ctx(AI_TEE_HEIGHT, T0)).unwrap_err();
        assert!(e.0.contains("atestador de IA não registrado"), "{}", e.0);
        assert_eq!(st.ai_tasks[&id].state, "PENDING", "nada pode mutar numa recusa");
    }

    /// Fase 6: atestação SEM assinaturas não fecha quórum — e a recusa é atômica.
    ///
    /// O ponto de segurança do módulo: quem só AFIRMA ter um enclave não liquida.
    /// A contagem é a mesma da ponte (dedup por endereço recuperado), então uma
    /// lista vazia (ou de lixo) devolve 0 e o quórum barra.
    #[test]
    fn atestacao_sem_quorum_e_recusada_sem_mutar() {
        let (mut st, req) = cenario(&["o1"], 100 * UNIT);
        let orc = addr("o1");
        let id = cria_tarefa(&mut st, &req, &orc, 10 * UNIT, AI_TEE_HEIGHT);
        st.ai_attesters.insert(
            "a1".into(),
            Attester {
                id: "a1".into(),
                kind: "TEE".into(),
                members: vec!["0x00000000000000000000000000000000000000aa".into()],
                quorum: 1,
                measurement: "medida".into(),
                registered_at: 1,
            },
        );
        let att = JsonValue::map([("attesterId".to_string(), s("a1"))]); // sem `sigs`
        let tx = tx_ai("AI_RESULT", &orc, &[("taskId", s(&id)), ("output", s("42")), ("attestation", att)]);
        let e = aplicar(&mut st, &tx, &ctx(AI_TEE_HEIGHT, T0)).unwrap_err();
        assert!(e.0.contains("atestação insuficiente (0/1)"), "{}", e.0);
        assert_eq!(st.ai_tasks[&id].state, "PENDING", "nada pode mutar numa recusa");
    }

    /// O digest da atestação é o da referência (`bridge/proof.js:37`), byte a byte.
    ///
    /// Trava a pré-imagem: cinco campos unidos por `\x1f`, com o hash do resultado
    /// em MINÚSCULO e o `measurement` vazio entrando como string vazia (não
    /// omitido — omitir mudaria o número de separadores).
    #[test]
    fn digest_da_atestacao_bate_com_a_referencia() {
        use crate::state::bridge::ai_attest_digest;
        // Maiúsculas no hash têm de dar o MESMO digest que minúsculas.
        let a = ai_attest_digest("t1", "ABCDEF", "a1", "medida");
        let b = ai_attest_digest("t1", "abcdef", "a1", "medida");
        assert_eq!(a, b, "o hash do resultado é normalizado para minúsculo");
        // `measurement` vazio é campo PRESENTE e vazio — digest diferente de outro
        // com measurement preenchido, mas estável.
        let c = ai_attest_digest("t1", "abcdef", "a1", "");
        assert_ne!(a, c);
        assert_eq!(c, ai_attest_digest("t1", "abcdef", "a1", ""));
    }

    #[test]
    fn reputacao_ausente_e_lida_como_cinquenta() {
        // Reproduz o `?? 50` da referência — oráculos anteriores à Fase 1 não têm o
        // campo, e um `Oracle::default()` vindo de outro módulo cai no mesmo caso.
        let o = Oracle::default();
        assert_eq!(o.rep(), 50);
        let mut o = Oracle::default();
        o.desce(60);
        assert_eq!(o.reputation, Some(0), "não passa por baixo de zero");
        let mut o = Oracle::default();
        o.sobe(200);
        assert_eq!(o.reputation, Some(100), "teto de 100");
    }
}

// ============================================================================
// Testes da serialização canônica
//
// Travam a LISTA EXATA DE CHAVES de cada folha. Na camada de IA isso importa mais
// do que nos outros domínios porque a tarefa não tem forma fixa: cada modo nasce
// com um conjunto de campos diferente e os manipuladores acrescentam outros. Uma
// chave emitida no modo errado muda a folha de TODAS as tarefas daquele modo.
// ============================================================================
#[cfg(test)]
mod tests_canonico {
    use super::*;

    fn chaves(v: &Value) -> Vec<String> {
        let Value::Map(m) = v else { panic!("esperava mapa") };
        m.keys().cloned().collect()
    }

    fn valor<'a>(v: &'a Value, chave: &str) -> &'a Value {
        let Value::Map(m) = v else { panic!("esperava mapa") };
        m.get(chave).unwrap_or_else(|| panic!("chave {chave} ausente"))
    }

    /// As chaves que os TRÊS literais de criação compartilham.
    const NUCLEO: &[&str] = &[
        "completedAt", "createdAt", "expiresAt", "id", "model", "output", "params",
        "prompt", "requester", "resultHash", "reward", "status",
    ];

    fn esperado(extras: &[&str]) -> Vec<String> {
        let mut v: Vec<String> =
            NUCLEO.iter().chain(extras).map(|s| (*s).to_string()).collect();
        v.sort(); // a folha é um mapa: ordem de bytes
        v
    }

    // -------------------------------------------------------------------- Oracle

    #[test]
    fn oraculo_codifica_com_as_chaves_da_referencia() {
        let o = Oracle::registrado("E7O", 500 * UNIT, 1_700_000_000_000);
        assert_eq!(
            chaves(&o.to_value()),
            [
                "address", "bridgeTransfers", "completed", "endpoint", "failed",
                "registeredAt", "reputation", "slashed", "stake", "tasksCompleted",
            ]
        );
        // `endpoint: null` no literal de registro: a chave EXISTE, com nulo. Faltava
        // no porte junto com `bridgeTransfers`, e por isso TODA folha `orc` divergia.
        assert_eq!(valor(&o.to_value(), "endpoint"), &Value::Null);
        assert_eq!(valor(&o.to_value(), "bridgeTransfers"), &Value::uint(0u64));
        let com_endpoint = Oracle { endpoint: Some("https://o".into()), ..o };
        assert_eq!(valor(&com_endpoint.to_value(), "endpoint"), &Value::str("https://o"));
    }

    #[test]
    fn oraculo_sem_reputacao_omite_o_campo() {
        // Oráculos registrados ANTES da Fase 1 não têm `reputation`; a referência os
        // lê com `?? 50` sem nunca materializar o campo. Emitir 50 (ou `null`) daria
        // outra folha para todo oráculo antigo da rede.
        let o = Oracle { address: "E7O".into(), reputation: None, ..Default::default() };
        let ks = chaves(&o.to_value());
        assert!(!ks.contains(&"reputation".to_string()));
        assert_eq!(ks.len(), 9);
    }

    // ---------------------------------------------------------------------- Task

    /// Tarefa designada com o oráculo preenchido, que é a única forma válida deste
    /// modo (`AI_TASK` valida `data.oracle` antes de criar).
    fn designada(d: Designada) -> Task {
        Task { kind: TaskKind::Designada(d), ..Default::default() }
    }

    #[test]
    fn tarefa_de_oraculo_designado_codifica_com_as_chaves_da_referencia() {
        let t = Task {
            id: "t1".into(),
            requester: "E7R".into(),
            reward: 10,
            state: "PENDING".into(),
            created_at: 1,
            deadline: 2,
            ..designada(Designada { assigned_oracle: "E7O".into(), ..Default::default() })
        };
        assert_eq!(chaves(&t.to_value()), esperado(&["assignedOracle", "oracle", "private"]));
        // O modo designado NÃO tem a chave `mode` — a referência só a grava nos
        // outros dois literais.
        assert!(!chaves(&t.to_value()).contains(&"mode".to_string()));
        assert_eq!(valor(&t.to_value(), "assignedOracle"), &Value::str("E7O"));
        assert_eq!(valor(&t.to_value(), "oracle"), &Value::Null, "ainda não entregue");
    }

    #[test]
    fn tarefa_de_quorum_codifica_com_as_chaves_da_referencia() {
        let t = Task {
            kind: TaskKind::Quorum(Quorum { quorum: 3, phase: Fase::Commit, ..Default::default() }),
            ..Default::default()
        };
        assert_eq!(
            chaves(&t.to_value()),
            esperado(&[
                "mode", "quorum", "phase", "commitDeadline", "revealDeadline",
                "commits", "reveals", "winners",
            ])
        );
        // `winners: null` na criação — a chave EXISTE, com nulo.
        assert_eq!(valor(&t.to_value(), "winners"), &Value::Null);
        assert_eq!(valor(&t.to_value(), "phase"), &Value::str("COMMIT"));
        // E nada de `private`/`bids`/`budget`/`oracle`, que pertencem a outros modos.
        //
        // não compila: `Quorum { private: true, .. }` ou `Quorum { bids: … }` — os
        // campos dos outros dois literais não existem nesta variante, então "tarefa
        // de quórum com lances" (ou com `oracle`/`resultUri`) é inconstruível.
        for proibida in ["private", "bids", "budget", "bidDeadline", "assignedOracle", "oracle", "resultUri"] {
            assert!(!chaves(&t.to_value()).contains(&proibida.to_string()), "{proibida}");
        }
    }

    #[test]
    fn tarefa_aberta_codifica_com_as_chaves_da_referencia() {
        let t = Task {
            state: "BIDDING".into(),
            kind: TaskKind::Aberta(Aberta { budget: 100, ..Default::default() }),
            ..Default::default()
        };
        assert_eq!(
            chaves(&t.to_value()),
            esperado(&["mode", "budget", "bidDeadline", "bids", "assignedOracle", "oracle"])
        );
        assert_eq!(valor(&t.to_value(), "mode"), &Value::str("OPEN"));
        // `winners` é só do quórum — não compila: `Aberta { winners: … }`.
        assert!(!chaves(&t.to_value()).contains(&"winners".to_string()));
    }

    #[test]
    fn tarefa_omite_as_chaves_que_os_manipuladores_ainda_nao_criaram() {
        // Uma tarefa recém-criada não passou por AI_RESULT nem AI_CHALLENGE: nenhuma
        // das chaves que esses casos acrescentam pode aparecer. Emitir qualquer uma
        // (mesmo como `null` ou `0`) mudaria a folha de toda tarefa pendente.
        let t = designada(Designada { assigned_oracle: "E7O".into(), ..Default::default() });
        let ks = chaves(&t.to_value());
        for proibida in
            ["resultUri", "challengeDeadline", "bond", "challenger", "verdictDeadline", "votes", "verified"]
        {
            assert!(!ks.contains(&proibida.to_string()), "{proibida} não pode existir ainda");
        }
    }

    #[test]
    fn ai_result_cria_o_result_uri_mesmo_quando_nao_ha_ponteiro() {
        // `resultUri` nasce em AI_RESULT junto com `oracle`, e vale `null` quando o
        // oráculo não mandou ponteiro. A chave existir com nulo é diferente de ela
        // não existir — tags 0x00 e "ausente" dão folhas distintas.
        //
        // não compila: `Entrega::Entregue { result_uri: … }` sem `oracle` — os dois
        // nascem no mesmo passo, e "resultUri sem oracle" deixou de existir.
        let t = Task {
            result_hash: Some("ab".into()),
            ..designada(Designada {
                assigned_oracle: "E7O".into(),
                entrega: Entrega::Entregue { oracle: "E7O".into(), result_uri: None },
                ..Default::default()
            })
        };
        assert_eq!(valor(&t.to_value(), "resultUri"), &Value::Null);
        assert_eq!(valor(&t.to_value(), "oracle"), &Value::str("E7O"));
    }

    #[test]
    fn a_disputa_traz_as_quatro_chaves_de_uma_vez() {
        // AI_CHALLENGE grava challenger/bond/verdictDeadline/votes no mesmo passo, e
        // `votes` sobrevive vazio depois do veredito (a referência faz `= {}`, não
        // `delete`). `challengeDeadline` continua na folha — a disputa não a apaga.
        //
        // não compila: `Challenge::Janela { bond: … }` nem uma `Disputa` sem
        // `challenger` — "fiança sem desafiante" e "desafiante sem janela" saíram do
        // espaço de estados.
        let t = Task {
            state: "DISPUTED".into(),
            challenge: Challenge::Disputa {
                deadline: 50,
                challenger: "E7C".into(),
                bond: 20 * UNIT,
                verdict_deadline: 99,
                votes: BTreeMap::new(),
            },
            ..designada(Designada {
                assigned_oracle: "E7O".into(),
                entrega: Entrega::Entregue { oracle: "E7O".into(), result_uri: None },
                ..Default::default()
            })
        };
        let ks = chaves(&t.to_value());
        for esperada in ["bond", "challenger", "challengeDeadline", "verdictDeadline", "votes"] {
            assert!(ks.contains(&esperada.to_string()), "{esperada}");
        }
        assert_eq!(valor(&t.to_value(), "votes"), &Value::Map(BTreeMap::new()));
    }

    #[test]
    fn a_janela_de_desafio_nao_traz_as_chaves_da_disputa() {
        // `AI_RESULT` acima do fork cria SÓ `challengeDeadline`. As outras quatro só
        // nascem no `AI_CHALLENGE`.
        let t = Task {
            state: "CHALLENGE_PERIOD".into(),
            challenge: Challenge::Janela { deadline: 50 },
            ..designada(Designada {
                assigned_oracle: "E7O".into(),
                entrega: Entrega::Entregue { oracle: "E7O".into(), result_uri: None },
                ..Default::default()
            })
        };
        let ks = chaves(&t.to_value());
        assert!(ks.contains(&"challengeDeadline".to_string()));
        for proibida in ["bond", "challenger", "verdictDeadline", "votes"] {
            assert!(!ks.contains(&proibida.to_string()), "{proibida} sem AI_CHALLENGE");
        }
    }

    #[test]
    fn a_revelacao_e_um_objeto_e_o_output_some_com_a_poda() {
        // A referência guarda `{resultHash, output}` e, ao concluir, reescreve como
        // `{resultHash}`. Aqui o output vive num mapa paralelo, e o esvaziamento
        // dele tem de produzir exatamente a mesma folha.
        let mut q = Quorum::default();
        q.reveals.insert("E7O".into(), "h".into());
        q.reveal_outputs.insert("E7O".into(), "saida".into());
        let t = Task { kind: TaskKind::Quorum(q.clone()), ..Default::default() };
        let antes = t.to_value();
        assert_eq!(chaves(valor(valor(&antes, "reveals"), "E7O")), ["output", "resultHash"]);

        q.reveal_outputs.clear();
        let t = Task { kind: TaskKind::Quorum(q), ..Default::default() };
        assert_eq!(chaves(valor(valor(&t.to_value(), "reveals"), "E7O")), ["resultHash"]);
    }

    /// A ordem de revelação não existe mais — nem como campo, nem na folha.
    ///
    /// Houve um `reveal_order` neste cliente, que reproduzia a ordem de inserção
    /// com que a referência iterava `reveals` ao montar `winners`. A regra passou
    /// a ser a ordem canônica de endereço nos dois clientes e o campo saiu.
    ///
    /// O teste continua aqui, guardando o CAMINHO DE VOLTA: se alguém
    /// reintroduzir o campo para "otimizar" a apuração, a chave reaparece na
    /// folha e este teste acusa. É a única barreira contra o consenso voltar a
    /// depender de um dado que a raiz não commita.
    #[test]
    fn a_ordem_de_revelacao_nao_entra_na_folha() {
        let t = Task { kind: TaskKind::Quorum(Quorum::default()), ..Default::default() };
        let ks = chaves(&t.to_value());
        for proibida in ["revealOrder", "reveal_order"] {
            assert!(!ks.contains(&proibida.to_string()), "{proibida}");
        }
    }

    // ------------------------------------------------------------------ Attester

    #[test]
    fn atestador_codifica_com_as_chaves_da_referencia() {
        // `members`, `quorum` e `registeredAt` faltavam no porte (`state.js:749`), e
        // sem eles a folha `attest` divergia da rede assim que existisse UM
        // atestador — além de o registro não ter como funcionar sem o comitê.
        let a = Attester {
            id: "att1".into(),
            kind: "TEE".into(),
            members: vec!["0xaa".into(), "0xbb".into()],
            quorum: 2,
            measurement: "m".into(),
            registered_at: 1234,
        };
        let v = a.to_value();
        assert_eq!(chaves(&v), ["kind", "measurement", "members", "quorum", "registeredAt"]);
        assert_eq!(
            valor(&v, "members"),
            &Value::List(vec![Value::str("0xaa"), Value::str("0xbb")])
        );
        assert_eq!(valor(&v, "quorum"), &Value::uint(2u64));
        // ALTURA, não timestamp: a referência grava `registeredAt: height`.
        assert_eq!(valor(&v, "registeredAt"), &Value::uint(1234u64));
    }

    #[test]
    fn atestador_nao_duplica_o_id_que_ja_e_a_chave_da_folha() {
        // Na referência o identificador é a CHAVE do mapa `aiAttesters`, não um campo
        // do objeto — mesmo cuidado que `NameRecord` toma com o nome.
        let a = Attester { id: "att1".into(), ..Default::default() };
        assert!(!chaves(&a.to_value()).contains(&"id".to_string()));
    }

    // ------------------------------------------------- ida e volta canônica

    fn tarefa_base() -> Task {
        Task {
            id: "task-1".into(),
            requester: "E7PEDINTE".into(),
            reward: 777_000,
            state: "CHALLENGE_PERIOD".into(),
            deadline: 9_000,
            result_hash: Some("hash-do-resultado".into()),
            output: Some("saída".into()),
            prompt: Some("pergunta".into()),
            params: Some(JsonValue::map([
                ("t".to_string(), JsonValue::Int(3)),
                ("s".to_string(), JsonValue::str("x")),
            ])),
            model: Some("modelo-x".into()),
            created_at: 1_234,
            completed_at: Some(-1_700_000_000_000),
            verified: Some("TEE".into()),
            kind: TaskKind::default(),
            challenge: Challenge::Disputa {
                deadline: 5_555,
                challenger: "E7DESAFIANTE".into(),
                bond: 42,
                verdict_deadline: 6_666,
                votes: [("E7JURADO".to_string(), true)].into(),
            },
        }
    }

    /// Ida e volta nos TRÊS modos de criação, com todos os campos preenchidos.
    ///
    /// É o teste que trava a reconstrução por chaves: emitir `bids` no modo quórum
    /// (ou `winners` fora dele) mudaria a folha de TODAS as tarefas daquele modo.
    #[test]
    fn tarefa_sobrevive_a_ida_e_volta_nos_tres_modos() {
        let designada = Task {
            kind: TaskKind::Designada(Designada {
                assigned_oracle: "E7ORACULO".into(),
                private: true,
                entrega: Entrega::Entregue {
                    oracle: "E7ENTREGOU".into(),
                    result_uri: Some("ipfs://r".into()),
                },
            }),
            ..tarefa_base()
        };
        assert_eq!(Task::from_value(&designada.to_value()), Some(designada));

        let aberta = Task {
            kind: TaskKind::Aberta(Aberta {
                budget: 1_000_000,
                bid_deadline: 3_333,
                bids: [("E7LANCE".to_string(), (500u128, 111u64))].into(),
                assigned_oracle: Some("E7ADJUDICADO".into()),
                entrega: Entrega::Entregue { oracle: "E7ADJUDICADO".into(), result_uri: None },
            }),
            ..tarefa_base()
        };
        assert_eq!(Task::from_value(&aberta.to_value()), Some(aberta));

        let quorum = Task {
            kind: TaskKind::Quorum(Quorum {
                quorum: 3,
                phase: Fase::Done,
                commit_deadline: 100,
                reveal_deadline: 200,
                commits: [("E7A".to_string(), "c-a".to_string())].into(),
                reveals: [
                    ("E7A".to_string(), "h-a".to_string()),
                    ("E7B".to_string(), "h-b".to_string()),
                ]
                .into(),
                // Só UM tem output: a poda da conclusão tira os outros, e a chave
                // `output` da revelação some junto.
                reveal_outputs: [("E7A".to_string(), "o-a".to_string())].into(),
                winners: Some(vec!["E7A".into()]),
            }),
            ..tarefa_base()
        };
        assert_eq!(Task::from_value(&quorum.to_value()), Some(quorum));
    }

    /// As formas MAGRAS: entrega pendente, sem desafio, sem atestação — as chaves
    /// correspondentes somem da folha e a ausência tem de voltar como o padrão.
    #[test]
    fn tarefa_sem_os_campos_opcionais_sobrevive_a_ida_e_volta() {
        let t = Task {
            id: "t".into(),
            requester: "E7P".into(),
            state: "PENDING".into(),
            kind: TaskKind::Designada(Designada {
                assigned_oracle: "E7O".into(),
                private: false,
                entrega: Entrega::Pendente,
            }),
            challenge: Challenge::Nenhum,
            verified: None,
            ..Default::default()
        };
        assert_eq!(Task::from_value(&t.to_value()), Some(t));

        // Janela de desafio SEM disputa: só `challengeDeadline`.
        let janela = Task {
            id: "t2".into(),
            challenge: Challenge::Janela { deadline: 88 },
            ..Default::default()
        };
        assert_eq!(Task::from_value(&janela.to_value()), Some(janela));
    }

    /// A ida e volta de uma tarefa de quórum é COMPLETA.
    ///
    /// Já não foi: havia um `reveal_order` que guardava a ordem de chegada das
    /// revelações, não entrava na folha e portanto não voltava — e a apuração
    /// dependia dele para decidir `winners` e quem levava o resto. Um nó que
    /// reconstruísse o estado a partir da folha apuraria noutra ordem: mesma raiz
    /// antes, raízes diferentes depois.
    ///
    /// A regra passou a ser a ordem canônica de endereço nos dois clientes, o
    /// campo saiu, e este teste trava a propriedade que sobrou — a volta é exata.
    #[test]
    fn tarefa_de_quorum_volta_completa() {
        let t = Task {
            id: "t".into(),
            kind: TaskKind::Quorum(Quorum {
                reveals: [
                    ("E7A".to_string(), "h-a".to_string()),
                    ("E7B".to_string(), "h-b".to_string()),
                ]
                .into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(Task::from_value(&t.to_value()).expect("decodificável"), t);
    }

    #[test]
    fn oraculo_e_atestador_sobrevivem_a_ida_e_volta() {
        let o = Oracle {
            address: "E7ORACULO".into(),
            stake: 5_000_000,
            registered_at: 1_111,
            tasks_completed: 2,
            completed: 3,
            failed: 4,
            slashed: 5,
            reputation: Some(77),
            bridge_transfers: 6,
            endpoint: Some("https://exemplo".into()),
        };
        assert_eq!(Oracle::from_value(&o.to_value()), Some(o.clone()));

        // Oráculo pré-Fase 1: SEM a chave `reputation`, e ela volta como ausente —
        // materializar 50 aqui mudaria a folha dele.
        let antigo = Oracle { reputation: None, endpoint: None, ..o };
        assert_eq!(Oracle::from_value(&antigo.to_value()), Some(antigo));

        let a = Attester {
            id: "att-1".into(),
            kind: "TEE".into(),
            members: vec!["0xaa".into(), "0xbb".into()],
            quorum: 2,
            measurement: "medida".into(),
            registered_at: 2_222,
        };
        assert_eq!(Attester::from_value(&a.to_value(), "att-1"), Some(a));
    }

    #[test]
    fn forma_invalida_de_tarefa_e_recusada_sem_panico() {
        assert_eq!(Task::from_value(&Value::Null), None);
        // `mode` desconhecido não tem literal correspondente na referência.
        let Value::Map(mut m) = tarefa_base().to_value() else { panic!("mapa") };
        m.insert("mode".into(), Value::str("LEILAO_HOLANDES"));
        assert_eq!(Task::from_value(&Value::Map(m)), None);
        // Chave a mais: campo que este decodificador não sabe ler.
        let Value::Map(mut m) = tarefa_base().to_value() else { panic!("mapa") };
        m.insert("zzz".into(), Value::Null);
        assert_eq!(Task::from_value(&Value::Map(m)), None);
        // `oracle` preenchido SEM `resultUri` — forma que `AI_RESULT` nunca grava.
        let Value::Map(mut m) = tarefa_base().to_value() else { panic!("mapa") };
        m.insert("oracle".into(), Value::str("E7O"));
        assert_eq!(Task::from_value(&Value::Map(m)), None);
    }
}
