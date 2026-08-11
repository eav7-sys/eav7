//! Governança, permissões e multiassinatura.
//!
//! Porte de `src/core/state.js` (o nó de referência) para os tipos `GOV_*`,
//! `PERMISSION_*`, `MULTISIG_*`, `META_TX` e `ORACLE_REGISTER`.
//!
//! Este é o domínio mais perigoso do protocolo: é aqui que se decide QUEM pode
//! mover fundos de QUEM. O desenho das permissões v2 (níveis, timelock, veto,
//! recuperação) está em `docs/permissoes-v2.md` — leia antes de mexer, porque
//! quase toda regra aqui existe para fechar um vetor concreto de ataque, e não
//! por simetria estética.
//!
//! Invariante que vale para TODO manipulador deste módulo: se retornar `Err`, o
//! estado tem de estar exatamente como estava. Valide tudo ANTES de mutar. Onde a
//! aplicação tem mais de um passo (execução de operação multiassinatura), a
//! validação é uma FASE separada que devolve valores já resolvidos, e só depois
//! vem a mutação — assim não existe caminho em que metade do efeito ficou gravada.
//!
//! # Por que os tipos daqui são `enum`
//!
//! Os tipos deste módulo foram portados de um nó em JavaScript, onde `Permission`,
//! `change` e `value` são POLIMÓRFICOS: a mesma posição guarda formas diferentes
//! conforme o caso. Traduzir isso para structs com muitos `Option` deixava
//! representável o que o protocolo nunca produz — "v2 com threshold", "v1 com
//! recovery", "mudança de delay com valor de endereço" — e cada uma dessas
//! combinações serializa uma folha do `stateRoot` que a rede não reproduz.
//!
//! Por isso `Permission`, `Mudanca` e `ValorGov` são `enum`, e por isso `Nivel` e
//! `Active` são tipos separados: um `owner` não tem escopo de operações, e agora
//! não há como escrever um que tenha. A regra geral é a mesma em todo o módulo —
//! um `Option` que nunca é `None` na prática, ou dois `Option` que sempre andam
//! juntos, são invariantes que o TIPO carrega, não o comentário.
//!
//! A representação interna mudou; a folha canônica, não. `to_value` emite
//! exatamente a mesma forma que o objeto JS, e os testes de `tests_canonico`
//! travam a lista exata de chaves de cada uma.
//!
//! # Sobre falhar fechado
//!
//! Onde uma regra depende de outro domínio, este módulo CHAMA o efeito daquele
//! domínio em vez de reimplementá-lo (`token::efeito_meta_transfer`,
//! `nft::efeito_multisig_transfer`, `value::aplicar_voto`): duas versões da mesma
//! regra de consenso divergem mais cedo ou mais tarde. Onde nem isso é possível,
//! a escolha é falhar com mensagem explícita, nunca aproximar em silêncio —
//! neste domínio uma aproximação é perda de fundos.
//!
//! Havia aqui uma seção de "lacunas conhecidas" apontando marcadores `LACUNA:`
//! que não existem mais. Ela sobreviveu ao próprio motivo: os campos que dizia
//! faltarem (`Account::eavm_managed`, os domínios de token/NFT/voto) foram
//! portados, e o texto continuou afirmando o contrário.

use super::{Amount, Ctx, State, StateError};
use crate::address::is_valid_address;
use crate::canonical::Value;
use crate::transaction::{verify_transaction, JsonValue, Tx};
use std::collections::{BTreeMap, BTreeSet};

type R<T> = Result<T, StateError>;

fn erro(msg: impl Into<String>) -> StateError {
    StateError(msg.into())
}

// ============================================================================
// Constantes do protocolo
//
// Todas vêm de `crate::config`, que é GERADO a partir de `src/config.js` — são
// apelidos locais, não cópias. O comentário anterior dizia que eram repetidas
// "porque o cliente Rust ainda não tem o módulo de configuração"; tem
// (`config.rs`, gerado por `rust/src/config.rs`), e o texto sobreviveu à
// própria correção que descreve.
//
// A linha de origem fica anotada para a divergência ser auditável. Um valor
// errado aqui não dá erro de compilação: dá cisão de rede.
// ============================================================================

/// 1 EAV7 em e7. `config.js: UNIT`.
const UNIT: u128 = crate::config::UNIT;

/// A partir daqui uma conta pode virar multiassinatura. `config.js:101`.
const PERMISSIONS_HEIGHT: u64 = crate::config::PERMISSIONS_HEIGHT;
/// Permissões v2 (níveis, timelock, veto). `config.js:107`.
const PERMISSIONS_V2_HEIGHT: u64 = crate::config::PERMISSIONS_V2_HEIGHT;
/// Governança on-chain. `config.js:121`.
const GOVERNANCE_HEIGHT: u64 = crate::config::GOVERNANCE_HEIGHT;
/// Meta-transações patrocinadas. `config.js:362`.
const META_HEIGHT: u64 = crate::config::META_HEIGHT;
/// Atestação de IA (Fase 6). `config.js:214`. O override por `EAV7_AI_TEE_HEIGHT`
/// é honrado via geração do config: o valor entra no build e o nó CONFERE o
/// ambiente no boot (`config::ENV_DE_CONSENSO`), abortando se divergirem.
const AI_TEE_HEIGHT: u64 = crate::config::AI_TEE_HEIGHT;

/// Máximo de chaves num nível. `config.js:102`.
const MAX_PERMISSION_KEYS: usize = crate::config::MAX_PERMISSION_KEYS as usize;
/// Máximo de permissões `active` numa conta v2. `config.js:115`.
const MAX_ACTIVE_PERMISSIONS: usize = crate::config::MAX_ACTIVE_PERMISSIONS as usize;
/// Tamanho máximo do nome de uma `active`, em bytes. `config.js:116`.
const MAX_PERMISSION_NAME: usize = crate::config::MAX_PERMISSION_NAME as usize;

/// Faixa do timelock estrutural, em blocos. `config.js:110-112`.
const PERM_DELAY_MIN_BLOCKS: u64 = crate::config::PERM_DELAY_MIN_BLOCKS;
const PERM_DELAY_MAX_BLOCKS: u64 = crate::config::PERM_DELAY_MAX_BLOCKS;
const PERM_DELAY_DEFAULT_BLOCKS: u64 = crate::config::PERM_DELAY_DEFAULT_BLOCKS;

/// Janela máxima de votação de uma proposta. `config.js:122`.
const GOV_MAX_VOTING_BLOCKS: u64 = crate::config::GOV_MAX_VOTING_BLOCKS;
/// Timelock entre atingir quórum e aplicar. `config.js:126` — o default de
/// produção; a referência aceita override por `EAV7_GOV_TIMELOCK_BLOCKS`, que
/// NÃO é reproduzido aqui de propósito (um nó com override diferente diverge).
const GOV_TIMELOCK_BLOCKS: u64 = crate::config::GOV_TIMELOCK_BLOCKS;

/// TTL de uma operação multiassinatura pendente. `config.js:127`.
const MULTISIG_OP_TTL_BLOCKS: u64 = crate::config::MULTISIG_OP_TTL_BLOCKS;

/// Stake mínimo para registrar um oráculo. `config.js:138`.
const MIN_ORACLE_STAKE: Amount = crate::config::MIN_ORACLE_STAKE as Amount;
/// Conjunto de validadores. `config.js:61-62`.
const MAX_VALIDATORS: usize = crate::config::MAX_VALIDATORS as usize;
const MIN_VALIDATOR_STAKE: Amount = crate::config::MIN_VALIDATOR_STAKE as Amount;
/// Fila de saque de stake. `config.js:66,70`.
const UNBONDING_BLOCKS: u64 = crate::config::UNBONDING_BLOCKS;
const MAX_UNBONDING_ENTRIES: usize = crate::config::MAX_UNBONDING_ENTRIES as usize;
/// Atraso de vigência de uma nova comissão. `config.js:92`.
const COMMISSION_DELAY_BLOCKS: u64 = crate::config::COMMISSION_DELAY_BLOCKS;

/// Membros de um comitê de ponte / atestador. `config.js:215` e `state.js:674`.
const MAX_AI_ATTESTER_MEMBERS: usize = crate::config::MAX_AI_ATTESTER_MEMBERS as usize;
const MAX_COMMITTEE_MEMBERS: usize = 200;

/// Operações que uma conta multiassinatura pode executar.
///
/// É também o vocabulário do ESCOPO da permissão `active`. Espelha
/// `MULTISIG_OPS` em `state.js:17`. A ordem importa só para leitura; o que não
/// pode divergir é o CONJUNTO — um nome a mais aqui aceitaria escopo que a rede
/// recusa, e um a menos recusaria escopo que a rede aceita.
pub const MULTISIG_OPS: &[&str] = &[
    "TRANSFER",
    "STAKE",
    "UNSTAKE",
    "TOKEN_TRANSFER",
    "NFT_TRANSFER",
    "VOTE",
    "SET_COMMISSION",
    "CLAIM_VOTER_REWARD",
    "PERMISSION_CHANGE",
    // Gov da Âncora: só via owner M-of-N (ver `exige_owner` / plano 14).
    "GOV_PROPOSE",
    "GOV_VOTE",
];

/// `permissionId` sentinela: a op conta peso no **owner**, não numa `active`.
/// Usado por GOV_* e SET_COMMISSION (plano 13/14).
const OWNER_PERMISSION_ID: u64 = u64::MAX;

/// Ops de poder da Âncora — limiar do **owner**; witness/active sozinhos não bastam.
fn exige_owner(op_type: &str) -> bool {
    matches!(op_type, "GOV_PROPOSE" | "GOV_VOTE" | "SET_COMMISSION")
}

// ============================================================================
// Tipos de estado
// ============================================================================

/// Conjunto de chaves com limiar — a forma que a v1, o `owner` e cada `active`
/// compartilham (`#normalizePermission`, `state.js:199-217`).
///
/// É um tipo próprio, e não campos soltos em `Permission`, porque é exatamente o
/// que a referência trata como uma coisa só: `#meetsThreshold` recebe SEMPRE um
/// destes, nunca uma permissão inteira.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Nivel {
    pub threshold: u64,
    pub keys: BTreeMap<String, u64>,
}

/// Uma permissão `active`: nível + nome + escopo de operações.
///
/// `name` e `operations` vivem AQUI, e não em `Nivel`, porque só a `active` os tem
/// (`#normalizeActive`, `state.js:255-283`). Guardá-los no nível deixaria
/// representável um `owner` com escopo — configuração que a rede nunca produz e
/// que, se existisse, mudaria a folha do `stateRoot` de toda conta v2.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Active {
    pub nivel: Nivel,
    /// `state.js:262` — validado E guardado; a referência grava `lvl.name = a.name`
    /// e o campo participa da folha `perm`.
    pub name: Option<String>,
    pub operations: Option<Vec<String>>,
}

/// Permissão de conta. Duas formas MUTUAMENTE EXCLUSIVAS, como na referência.
///
/// A v1 é `{threshold, keys}` (`state.js:216`) e a v2 é
/// `{owner, actives, delayBlocks}` + `witness?`/`recovery?` (`state.js:251-254`) —
/// e a v2 NÃO tem `threshold`/`keys` no topo.
///
/// Ser um `enum` (e não uma struct com tudo em `Option`) é o que apaga do domínio
/// as combinações que o protocolo não produz: "v2 com threshold", "v1 com
/// recovery", "v2 sem owner", "v2 sem delayBlocks". Cada uma delas serializaria
/// uma folha que a rede não reproduz, e o sintoma seria divergência de raiz em
/// produção — não teste vermelho.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Permission {
    V1(Nivel),
    V2 {
        /// Não é `Option`: uma v2 sem owner não existe — é o próprio campo que a
        /// define (`#isV2`, `state.js:286`).
        owner: Nivel,
        actives: Vec<Active>,
        witness: Option<String>,
        recovery: Option<String>,
        /// Não é `Option`: a v2 sempre grava `delayBlocks` (o default entra na
        /// normalização, `state.js:245`).
        delay_blocks: u64,
    },
}

impl Permission {
    /// A chave `witness`, que só a v2 tem.
    ///
    /// Acessor, e não campo público, porque `witness` deixou de existir na v1 —
    /// e quem pergunta (produção de bloco, EAVM) quer justamente "há witness?",
    /// não "qual variante é esta?".
    pub fn witness(&self) -> Option<&str> {
        match self {
            Permission::V1(_) => None,
            Permission::V2 { witness, .. } => witness.as_deref(),
        }
    }
}

impl Default for Permission {
    /// Só existe para o andaime dos testes de `leaves.rs`: uma permissão v1 vazia.
    /// Nenhum caminho de consenso constrói permissão por `Default`.
    fn default() -> Self {
        Permission::V1(Nivel::default())
    }
}

/// Operação multiassinatura aguardando limiar.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PendingOp {
    pub account: String,
    /// CORPO da operação, cru como a referência guarda (`state.js:1616` grava o
    /// próprio `tx.data.op`).
    ///
    /// Sem ele, cruzar o limiar não diz destino nem valor e a operação aprovada é
    /// inexecutável — a conta trava com os fundos dentro. O tipo é o MAPA, e não um
    /// `JsonValue` qualquer, porque `MULTISIG_PROPOSE` só aceita objeto: assim não
    /// existe `PendingOp` com corpo escalar.
    pub op: BTreeMap<String, JsonValue>,
    pub approvals: BTreeMap<String, u64>,
    pub weight: u64,
    pub permission_id: u64,
    /// `state.js:1616` — `tx.timestamp` (milissegundos).
    pub created_at: i64,
    pub deadline: u64,
}

impl PendingOp {
    /// Tipo da operação, LIDO do corpo em vez de guardado ao lado dele.
    ///
    /// Um campo `op_type` separado poderia discordar de `op.type`; a referência lê
    /// `pending.op.type` na hora (`state.js:1641`), e derivar é o que impede as duas
    /// versões de divergirem.
    pub fn op_type(&self) -> Option<&str> {
        texto(self.op.get("type"))
    }
}

/// Mudança estrutural de permissão sob timelock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingPerm {
    /// O CONTEÚDO da mudança, não só o nível (`state.js:1536` grava `change`).
    /// O nível sai daqui por `change.nivel()`; guardar os dois deixaria
    /// representável uma pendência cujo rótulo não bate com o corpo.
    pub change: Mudanca,
    pub approvals: BTreeMap<String, bool>,
    pub vetoes: BTreeMap<String, bool>,
    /// `None` = timelock ainda não iniciado. A referência usa `null` LITERAL
    /// (`state.js:1536`), e o sentinela 0 que estava aqui era justamente o tipo de
    /// coisa que o Rust não precisa ter: altura 0 é um valor legítimo do domínio.
    pub execute_at: Option<u64>,
    pub proposed_at: u64,
}

impl Default for PendingPerm {
    /// Andaime de teste (ver `Permission::default`). A mudança default é a mais
    /// inerte que existe: o delay no valor que a própria normalização já usa.
    fn default() -> Self {
        PendingPerm {
            change: Mudanca::Delay(PERM_DELAY_DEFAULT_BLOCKS),
            approvals: BTreeMap::new(),
            vetoes: BTreeMap::new(),
            execute_at: None,
            proposed_at: 0,
        }
    }
}

/// Valor aprovado de um parâmetro governável.
///
/// Duas formas, porque a referência guarda duas coisas diferentes: os parâmetros
/// escalares viram `BigInt`/`Number` (`state.js:1466`), que codificam com a tag de
/// INTEIRO; os três estruturados viram um OBJETO (`state.js:1457-1462`). Guardar
/// tudo numa `String` obrigava a escolher uma tag só, e a errada em algum dos
/// casos — que é exatamente a divergência que existia.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValorGov {
    /// Decimal canônico. Não é `i64` porque `BLOCK_REWARD` chega a `1000 * UNIT`
    /// (10^21), muito além do que um inteiro de 64 bits comporta.
    Inteiro(String),
    /// `BRIDGE_COMMITTEE`, `TREASURY_SPEND` e `AI_ATTESTER`. Só a validação constrói
    /// esta variante, então o mapa nunca tem forma arbitrária.
    Objeto(BTreeMap<String, JsonValue>),
}

impl Default for ValorGov {
    fn default() -> Self {
        ValorGov::Inteiro("0".into())
    }
}

/// Proposta de governança.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Proposal {
    pub id: String,
    pub param: String,
    pub value: ValorGov,
    pub proposer: String,
    pub votes: BTreeMap<String, bool>,
    pub deadline: u64,
    pub execute_at: Option<u64>,
    /// `state.js:1472` — `tx.timestamp` (milissegundos).
    pub created_at: i64,
    pub state: String,
}

// ============================================================================
// Serialização canônica — folhas `perm`, `pop`, `pperm` e `gov` do `stateRoot`
//
// Regra que vale para os quatro tipos abaixo e que não é óbvia: no JS um campo
// AUSENTE e um campo `null` codificam DIFERENTE. `encodeCanonical` filtra
// `undefined` (a chave some do mapa) mas codifica `null` com a tag 0x00. Então
// `Option::None` só vira `Value::Null` onde a referência escreve `null` LITERAL —
// nos demais casos a chave tem de sumir. Errar isso muda a folha de todo objeto
// que não tenha o campo, e o sintoma é divergência de raiz, não teste vermelho.
// ============================================================================

/// Converte um valor vindo do `data` da transação para a forma canônica.
///
/// A referência guarda pedaços de `tx.data` CRUS no estado (o corpo da operação
/// multiassinatura, o valor estruturado de uma proposta) e depois os codifica com
/// `encodeCanonical`. Este é o mesmo caminho: número JSON vira INTEIRO (tag 0x03),
/// não texto — trocar as duas tags mudaria a folha de toda operação pendente.
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

fn mapa_json_para_valor(m: &BTreeMap<String, JsonValue>) -> Value {
    Value::Map(m.iter().map(|(k, x)| (k.clone(), json_para_valor(x))).collect())
}

/// Inverso de [`json_para_valor`] — o caminho de volta do snapshot para o `data`
/// cru que o estado guarda.
///
/// Mora aqui e é compartilhado com `state/ai.rs` (que tem a própria cópia da IDA,
/// para `Task::params`): duas cópias da VOLTA divergiriam no primeiro tipo novo, e
/// a divergência apareceria como estado restaurado errado, não como erro.
///
/// `Value::Int` é decimal em texto e `JsonValue::Int` é `i64`: um inteiro que não
/// couber em 64 bits vira `None`, nunca um valor truncado. O protocolo não grava
/// um assim — o corpo veio de um JSON que já era `i64`.
pub(crate) fn valor_para_json(v: &Value) -> Option<JsonValue> {
    Some(match v {
        Value::Null => JsonValue::Null,
        Value::Bool(b) => JsonValue::Bool(*b),
        Value::Int(_) => JsonValue::Int(v.inteiro()?),
        Value::Str(s) => JsonValue::Str(s.clone()),
        Value::List(l) => JsonValue::List(l.iter().map(valor_para_json).collect::<Option<_>>()?),
        Value::Map(m) => JsonValue::Map(
            m.iter().map(|(k, x)| Some((k.clone(), valor_para_json(x)?))).collect::<Option<_>>()?,
        ),
    })
}

fn mapa_valor_para_json(v: &Value) -> Option<BTreeMap<String, JsonValue>> {
    v.mapa()?.iter().map(|(k, x)| Some((k.clone(), valor_para_json(x)?))).collect()
}

/// Mapa `chave → booleano` — a forma de `votes`, `approvals` de permissão e
/// `vetoes` aqui, e dos votos de jurado em `state/ai.rs`.
pub(crate) fn mapa_de_bool(v: &Value) -> Option<BTreeMap<String, bool>> {
    v.mapa()?.iter().map(|(k, x)| Some((k.clone(), x.booleano()?))).collect()
}

impl Nivel {
    /// `{keys, threshold}` — `#normalizePermission` (`state.js:216`).
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert(
            "keys".into(),
            Value::Map(self.keys.iter().map(|(k, w)| (k.clone(), Value::uint(*w))).collect()),
        );
        m.insert("threshold".into(), Value::uint(self.threshold));
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 2 {
            return None;
        }
        Nivel::do_mapa(m)
    }

    /// O par `{keys, threshold}` de um mapa que pode ter MAIS chaves — é o caso da
    /// `active`, que acrescenta `id`/`name`/`operations` ao mesmo nível. A
    /// contagem de chaves fica com quem chama, que é quem sabe quantas esperar.
    fn do_mapa(m: &BTreeMap<String, Value>) -> Option<Self> {
        Some(Nivel {
            threshold: m.get("threshold")?.inteiro()?,
            keys: m
                .get("keys")?
                .mapa()?
                .iter()
                .map(|(k, w)| Some((k.clone(), w.inteiro()?)))
                .collect::<Option<_>>()?,
        })
    }
}

impl Active {
    /// `{id, keys, name?, operations?, threshold}` — `#normalizeActive`
    /// (`state.js:255-283`).
    ///
    /// O `id` vem de fora porque é POSICIONAL: a referência grava `lvl.id = i` e
    /// reindexa para ids contíguos a cada mudança, justamente para que o índice no
    /// vetor e o id gravado coincidam.
    pub fn to_value(&self, id: usize) -> Value {
        let Value::Map(mut m) = self.nivel.to_value() else { return Value::Null };
        m.insert("id".into(), Value::uint(id as u128));
        // `if (a?.name != null) lvl.name = a.name`: sem nome, a propriedade NÃO
        // EXISTE. Emitir `null` mudaria a folha de toda active sem nome.
        if let Some(n) = &self.name {
            m.insert("name".into(), Value::str(n.clone()));
        }
        // Escopo ausente = todas as operações permitidas, e a referência não grava a
        // chave nesse caso. A lista já vem ordenada da normalização.
        if let Some(ops) = &self.operations {
            m.insert(
                "operations".into(),
                Value::List(ops.iter().map(|o| Value::str(o.clone())).collect()),
            );
        }
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`] — e, como ele, recebe o `id`, porque o
    /// índice é POSICIONAL. Conferir que o `id` gravado bate com a posição é o que
    /// impede um snapshot de reordenar as actives em silêncio: a autorização de
    /// cada operação é escolhida por esse índice.
    ///
    /// `name` e `operations` AUSENTES são `None`, não vazios — escopo ausente é
    /// "todas as operações permitidas", e lê-lo como `Some(vec![])` daria uma
    /// active que não pode fazer nada.
    pub fn from_value(v: &Value, id: usize) -> Option<Self> {
        let m = v.mapa()?;
        let name = match m.get("name") {
            None => None,
            Some(x) => Some(x.texto()?.to_string()),
        };
        let operations = match m.get("operations") {
            None => None,
            Some(x) => Some(
                x.lista()?
                    .iter()
                    .map(|o| Some(o.texto()?.to_string()))
                    .collect::<Option<Vec<_>>>()?,
            ),
        };
        if m.len() != 3 + usize::from(name.is_some()) + usize::from(operations.is_some()) {
            return None;
        }
        if m.get("id")?.inteiro::<u128>()? != id as u128 {
            return None;
        }
        Some(Active { nivel: Nivel::do_mapa(m)?, name, operations })
    }
}

impl Permission {
    /// Forma canônica para a folha `perm`. Cada variante emite EXATAMENTE a forma
    /// da referência — o `enum` mudou a representação interna, não a folha.
    pub fn to_value(&self) -> Value {
        match self {
            // v1: `{threshold, keys}` (`state.js:216`).
            Permission::V1(n) => n.to_value(),
            // v2: `{owner, actives, delayBlocks}` + `witness?`/`recovery?`
            // (`state.js:251-254`). SEM `threshold`/`keys` no topo — que agora nem
            // existem nesta variante, então não há como emiti-los por engano.
            Permission::V2 { owner, actives, witness, recovery, delay_blocks } => {
                let mut m = BTreeMap::new();
                m.insert(
                    "actives".into(),
                    Value::List(
                        actives.iter().enumerate().map(|(i, a)| a.to_value(i)).collect(),
                    ),
                );
                m.insert("delayBlocks".into(), Value::uint(*delay_blocks));
                m.insert("owner".into(), owner.to_value());
                // `witness`/`recovery` entram por `if (witness) out.witness = …`:
                // quando não há chave, a propriedade NÃO EXISTE. Emitir `null`
                // mudaria a folha de toda conta v2 que não use os dois níveis, que é
                // a maioria.
                if let Some(r) = recovery {
                    m.insert("recovery".into(), Value::str(r.clone()));
                }
                if let Some(w) = witness {
                    m.insert("witness".into(), Value::str(w.clone()));
                }
                Value::Map(m)
            }
        }
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// `owner` é o discriminante da v2 — o mesmo `#isV2` da referência. Não dá para
    /// discriminar por `threshold`/`keys`: a v2 não os tem no topo, mas a v1 também
    /// não tem nenhuma chave que a v2 tenha, então a pergunta certa é uma só.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if !m.contains_key("owner") {
            return Some(Permission::V1(Nivel::from_value(v)?));
        }
        // `witness`/`recovery` AUSENTES são `None` — a maioria das contas v2 não usa
        // os dois níveis, e emiti-los como nulo mudaria a folha delas.
        let witness = match m.get("witness") {
            None => None,
            Some(x) => Some(x.texto()?.to_string()),
        };
        let recovery = match m.get("recovery") {
            None => None,
            Some(x) => Some(x.texto()?.to_string()),
        };
        if m.len() != 3 + usize::from(witness.is_some()) + usize::from(recovery.is_some()) {
            return None;
        }
        Some(Permission::V2 {
            owner: Nivel::from_value(m.get("owner")?)?,
            actives: m
                .get("actives")?
                .lista()?
                .iter()
                .enumerate()
                .map(|(i, a)| Active::from_value(a, i))
                .collect::<Option<Vec<_>>>()?,
            witness,
            recovery,
            delay_blocks: m.get("delayBlocks")?.inteiro()?,
        })
    }
}

impl PendingOp {
    /// Forma canônica para a folha `pop`.
    ///
    /// `{account, op, approvals, weight, permissionId, createdAt, deadline}` —
    /// `state.js:1616`. As sete chaves, sem sobra nem falta.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("account".into(), Value::str(self.account.clone()));
        // Os valores são os PESOS de cada chave, não booleanos: a referência faz
        // `approvals = { [tx.from]: weight }`.
        m.insert(
            "approvals".into(),
            Value::Map(self.approvals.iter().map(|(k, w)| (k.clone(), Value::uint(*w))).collect()),
        );
        m.insert("createdAt".into(), Value::int(self.created_at));
        m.insert("deadline".into(), Value::uint(self.deadline));
        // O corpo CRU, como a referência guardou: reserializá-lo a partir de uma
        // forma normalizada arriscaria perder uma chave que o proponente enviou e
        // que entra na folha.
        m.insert("op".into(), mapa_json_para_valor(&self.op));
        m.insert("permissionId".into(), Value::uint(self.permission_id));
        m.insert("weight".into(), Value::uint(self.weight));
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// `createdAt` é `tx.timestamp` e viaja COM SINAL (`Value::int`): lê-lo como
    /// `u64` recusaria qualquer folha de timestamp negativo em vez de restaurá-la.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 7 {
            return None;
        }
        Some(PendingOp {
            account: m.get("account")?.texto()?.to_string(),
            op: mapa_valor_para_json(m.get("op")?)?,
            approvals: m
                .get("approvals")?
                .mapa()?
                .iter()
                .map(|(k, w)| Some((k.clone(), w.inteiro()?)))
                .collect::<Option<_>>()?,
            weight: m.get("weight")?.inteiro()?,
            permission_id: m.get("permissionId")?.inteiro()?,
            created_at: m.get("createdAt")?.inteiro()?,
            deadline: m.get("deadline")?.inteiro()?,
        })
    }
}

impl PendingPerm {
    /// Forma canônica para a folha `pperm`.
    ///
    /// `{change, approvals, vetoes, proposedAt, executeAt}` — `state.js:1536`.
    ///
    /// `executeAt` é o ponto delicado: a referência o inicia como `null` LITERAL e
    /// só o preenche quando a autorização é satisfeita. Como `null` tem codificação
    /// própria (tag 0x00) e não é o mesmo que ausente, `None` vira `Value::Null` e a
    /// chave CONTINUA existindo.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert(
            "approvals".into(),
            Value::Map(self.approvals.iter().map(|(k, v)| (k.clone(), Value::Bool(*v))).collect()),
        );
        m.insert("change".into(), self.change.to_value());
        m.insert(
            "executeAt".into(),
            match self.execute_at {
                Some(at) => Value::uint(at),
                None => Value::Null,
            },
        );
        m.insert("proposedAt".into(), Value::uint(self.proposed_at));
        m.insert(
            "vetoes".into(),
            Value::Map(self.vetoes.iter().map(|(k, v)| (k.clone(), Value::Bool(*v))).collect()),
        );
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// `executeAt` NULO é "timelock não iniciado", e a chave existe. Confundi-lo com
    /// ausência daria uma pendência executável na altura 0 — ou seja, imediatamente.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 5 {
            return None;
        }
        Some(PendingPerm {
            change: Mudanca::from_value(m.get("change")?)?,
            approvals: mapa_de_bool(m.get("approvals")?)?,
            vetoes: mapa_de_bool(m.get("vetoes")?)?,
            execute_at: m.get("executeAt")?.inteiro_ou_nulo()?,
            proposed_at: m.get("proposedAt")?.inteiro()?,
        })
    }
}

impl ValorGov {
    /// Escalar vira INTEIRO; estruturado vira o objeto que a validação montou.
    fn to_value(&self) -> Value {
        match self {
            // `Value::Int` guarda o decimal já canônico. O único produtor desta
            // variante é `coagir_valor_gov`, que a obtém de `i128::to_string()` —
            // nunca de texto do usuário —, então não há forma não canônica a checar.
            ValorGov::Inteiro(d) => Value::Int(d.clone()),
            ValorGov::Objeto(m) => mapa_json_para_valor(m),
        }
    }

    /// Inverso exato de [`Self::to_value`]. A TAG decide: 0x03 é o parâmetro
    /// escalar, 0x06 o estruturado — não há ambiguidade porque `coagir_valor_gov`
    /// só produz essas duas formas.
    pub fn from_value(v: &Value) -> Option<Self> {
        match v {
            Value::Int(d) => Some(ValorGov::Inteiro(d.clone())),
            Value::Map(_) => Some(ValorGov::Objeto(mapa_valor_para_json(v)?)),
            _ => None,
        }
    }
}

impl Proposal {
    /// Forma canônica para a folha `gov` (uma por proposta).
    ///
    /// A referência cria `{ id, param, value, proposer, deadline, votes, status,
    /// createdAt }` (`state.js:1472`) e o `#tallyProposal` ACRESCENTA `executeAt`
    /// só ao atingir quórum (`state.js:724`) — daí `execute_at` ser `Option` e a
    /// chave sumir quando `None`, em vez de virar `null`.
    ///
    /// Note `status`, não `state`: o campo se chama `state` no Rust porque `status`
    /// não colide melhor com nada, mas a GRAFIA DA FOLHA é a da referência.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("createdAt".into(), Value::int(self.created_at));
        m.insert("deadline".into(), Value::uint(self.deadline));
        if let Some(at) = self.execute_at {
            m.insert("executeAt".into(), Value::uint(at));
        }
        m.insert("id".into(), Value::str(self.id.clone()));
        m.insert("param".into(), Value::str(self.param.clone()));
        m.insert("proposer".into(), Value::str(self.proposer.clone()));
        m.insert("status".into(), Value::str(self.state.clone()));
        m.insert("value".into(), self.value.to_value());
        m.insert(
            "votes".into(),
            Value::Map(self.votes.iter().map(|(k, v)| (k.clone(), Value::Bool(*v))).collect()),
        );
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// Ao contrário do `executeAt` de [`PendingPerm`], aqui a AUSÊNCIA da chave é
    /// que significa "sem quórum ainda" — a referência só a acrescenta ao apurar. E
    /// `status` na folha é o campo `state` no Rust.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        let execute_at = match m.get("executeAt") {
            None => None,
            Some(x) => Some(x.inteiro()?),
        };
        if m.len() != 8 + usize::from(execute_at.is_some()) {
            return None;
        }
        Some(Proposal {
            id: m.get("id")?.texto()?.to_string(),
            param: m.get("param")?.texto()?.to_string(),
            value: ValorGov::from_value(m.get("value")?)?,
            proposer: m.get("proposer")?.texto()?.to_string(),
            votes: mapa_de_bool(m.get("votes")?)?,
            deadline: m.get("deadline")?.inteiro()?,
            execute_at,
            created_at: m.get("createdAt")?.inteiro()?,
            state: m.get("status")?.texto()?.to_string(),
        })
    }
}

/// Tipos de transação que este módulo atende. O despacho em `mod.rs` usa esta
/// lista, então um tipo esquecido aqui vira erro de "tipo desconhecido" em vez de
/// falha silenciosa.
pub const TIPOS: &[&str] = &[
    "GOV_PROPOSE",
    "GOV_VOTE",
    "PERMISSION_UPDATE",
    "PERMISSION_PROPOSE",
    "PERMISSION_APPROVE",
    "PERMISSION_VETO",
    "MULTISIG_PROPOSE",
    "MULTISIG_APPROVE",
    "META_TX",
    "ORACLE_REGISTER",
];

// ============================================================================
// Leitura do campo `data`
//
// A referência lê `tx.data?.x` e deixa `undefined` cair nas validações seguintes.
// Aqui a leitura é explícita e devolve `Option`, para que "ausente" e "presente
// com tipo errado" nunca se confundam.
// ============================================================================

fn dados(tx: &Tx) -> R<&BTreeMap<String, JsonValue>> {
    match &tx.data {
        Some(JsonValue::Map(m)) => Ok(m),
        _ => Err(erro("campo data inválido")),
    }
}

fn texto(v: Option<&JsonValue>) -> Option<&str> {
    match v {
        Some(JsonValue::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

/// Coerção numérica no espírito do `Number(x)` da referência.
///
/// Aceita inteiro JSON e texto decimal — que é o que carteira e SDK realmente
/// emitem. As coerções exóticas do JS (`Number(true)`, `Number(" 1 ")`,
/// `Number("0x10")`) NÃO são reproduzidas: são formas que nenhum emissor legítimo
/// produz, e imitá-las custaria mais superfície do que fecha.
/// Coerção numérica da REFERÊNCIA (`Number`/`BigInt`), não `str::parse`.
///
/// A governança lê `quorum`, `votingBlocks`, `value` e afins do `data` da
/// transação. `"3.0"`, `"0x10"` e `" 3 "` são aceitos pela rede; recusá-los aqui
/// faria este cliente rejeitar uma proposta que a rede aprovou — e, acima do fork
/// da raiz, parar no bloco que a contém.
fn como_i128(v: Option<&JsonValue>) -> Option<i128> {
    match v {
        Some(JsonValue::Int(n)) => Some(*n as i128),
        // `BigInt` (sem teto de 2⁵³) é a coerção certa para valores monetários e
        // de parâmetro; ele rejeita fração, como a referência.
        Some(JsonValue::Str(s)) => crate::state::coercao::js_bigint(s),
        _ => None,
    }
}

fn como_u64(v: Option<&JsonValue>) -> Option<u64> {
    match como_i128(v) {
        Some(n) if n >= 0 => u64::try_from(n).ok(),
        _ => None,
    }
}

/// Valor monetário do `data`, no formato que a referência passa por `BigInt(...)`.
fn como_amount(v: Option<&JsonValue>) -> Option<Amount> {
    match como_i128(v) {
        Some(n) if n >= 0 => Amount::try_from(n).ok(),
        _ => None,
    }
}

// ============================================================================
// Helpers de permissão
// ============================================================================

/// Uma permissão é v2 quando tem o nível `owner`. Contas configuradas antes do
/// fork continuam no formato v1 e seguem funcionando — é o que mantém o histórico
/// replayável.
fn e_v2(perm: &Permission) -> bool {
    matches!(perm, Permission::V2 { .. })
}

/// O nível `owner`, quando existe. Numa v1 não existe — e agora isso é um `None`
/// que o tipo produz, não um campo opcional que alguém esqueceu de preencher.
fn owner_de(perm: &Permission) -> Option<&Nivel> {
    match perm {
        Permission::V1(_) => None,
        Permission::V2 { owner, .. } => Some(owner),
    }
}

/// Nível de gasto RESOLVIDO: o conjunto com limiar mais o escopo que se aplica a
/// ele. Existe porque as duas variantes resolvem para coisas de tipos diferentes
/// (a v1 para o próprio conjunto, sem escopo; a v2 para uma `active`, com escopo),
/// e o chamador precisa das duas informações juntas.
struct Gasto<'a> {
    nivel: &'a Nivel,
    operations: Option<&'a [String]>,
}

/// Peso somado das assinaturas presentes em `signers` para um nível com limiar.
///
/// Soma CHECADA: os pesos são entrada do usuário e um estouro aqui poderia dar a
/// volta e satisfazer um limiar que não foi atingido. Estouro conta como não
/// atingido — falha fechada.
fn atinge_limiar(nivel: Option<&Nivel>, signers: &BTreeSet<String>) -> bool {
    let Some(nivel) = nivel else { return false };
    let mut peso: u64 = 0;
    for s in signers {
        if let Some(w) = nivel.keys.get(s) {
            match peso.checked_add(*w) {
                Some(novo) => peso = novo,
                None => return false,
            }
        }
    }
    peso >= nivel.threshold
}

/// Nível que autoriza GASTO e operações do dia a dia. Em v1 é a própria permissão;
/// em v2 é a `active` indicada.
///
/// Sem esta resolução, `perm.keys` numa conta v2 é o mapa VAZIO herdado do
/// `Default` e a conta fica inutilizável — recebe fundos e nunca gasta. Foi
/// exatamente esse o bug do `MULTISIG_PROPOSE` que usava `perm.keys` direto.
///
/// O `id` da `active` é o ÍNDICE no vetor: a referência reindexa para ids
/// contíguos a cada mudança justamente para que as duas representações coincidam.
fn nivel_de_gasto(perm: &Permission, permission_id: u64) -> Option<Gasto<'_>> {
    // Owner M-of-N (gov / comissão): não é uma `active`.
    if permission_id == OWNER_PERMISSION_ID {
        return owner_de(perm).map(|nivel| Gasto { nivel, operations: None });
    }
    match perm {
        // v1: só existe o id 0, e sem escopo — a referência nunca grava
        // `operations` fora de uma `active`. Um id qualquer resolveria para a mesma
        // permissão e deixaria a aprovação contar peso num "nível" que não existe.
        Permission::V1(n) => {
            if permission_id == 0 {
                Some(Gasto { nivel: n, operations: None })
            } else {
                None
            }
        }
        Permission::V2 { actives, .. } => usize::try_from(permission_id)
            .ok()
            .and_then(|i| actives.get(i))
            .map(|a| Gasto { nivel: &a.nivel, operations: a.operations.as_deref() }),
    }
}

/// A `active` PRIMÁRIA (id 0) é a que participa da recuperação. Deliberadamente
/// não é "qualquer active": uma com escopo estreito não deve poder autorizar troca
/// de owner.
fn active_primaria(perm: &Permission) -> Option<&Nivel> {
    nivel_de_gasto(perm, 0).map(|g| g.nivel)
}

/// Toda chave que participa da permissão, em qualquer nível. Só elas podem propor,
/// aprovar ou vetar — senão qualquer conta financiada encheria a fila alheia de lixo.
fn e_chave_da_permissao(perm: &Permission, addr: &str) -> bool {
    match perm {
        Permission::V1(n) => n.keys.contains_key(addr),
        Permission::V2 { owner, actives, witness, recovery, .. } => {
            owner.keys.contains_key(addr)
                || actives.iter().any(|a| a.nivel.keys.contains_key(addr))
                || witness.as_deref() == Some(addr)
                || recovery.as_deref() == Some(addr)
        }
    }
}

/// Valida e normaliza uma permissão `{ threshold, keys:{addr:peso} }`.
///
/// A checagem que importa é a última: **soma dos pesos ≥ limiar**. Sem ela uma
/// conta pode ser configurada num estado em que NENHUM conjunto de assinaturas
/// atinge o limiar — a conta fica travada para sempre, com os fundos dentro. É um
/// tijolo de mão própria, e nada no protocolo consegue desfazer.
fn normalizar_nivel(v: Option<&JsonValue>) -> R<Nivel> {
    let JsonValue::Map(p) = v.ok_or_else(|| erro("permissão inválida"))? else {
        return Err(erro("permissão inválida"));
    };
    let threshold = como_i128(p.get("threshold")).ok_or_else(|| erro("threshold inválido"))?;
    if threshold <= 0 {
        return Err(erro("threshold inválido"));
    }
    let threshold = u64::try_from(threshold).map_err(|_| erro("threshold inválido"))?;

    let Some(JsonValue::Map(keys)) = p.get("keys") else {
        return Err(erro("keys inválidas"));
    };
    if keys.is_empty() || keys.len() > MAX_PERMISSION_KEYS {
        return Err(erro("nº de keys inválido"));
    }
    let mut total: u64 = 0;
    let mut norm = BTreeMap::new();
    for (addr, w) in keys {
        if !is_valid_address(addr) {
            return Err(erro("endereço de key inválido"));
        }
        let peso = como_i128(Some(w)).ok_or_else(|| erro("peso inválido"))?;
        if peso <= 0 {
            return Err(erro("peso inválido"));
        }
        let peso = u64::try_from(peso).map_err(|_| erro("peso inválido"))?;
        total = total.checked_add(peso).ok_or_else(|| erro("peso inválido"))?;
        norm.insert(addr.clone(), peso);
    }
    if total < threshold {
        return Err(erro("soma dos pesos < threshold (conta ficaria travada)"));
    }
    Ok(Nivel { threshold, keys: norm })
}

/// Uma permissão `active`: conjunto com limiar + nome opcional + escopo de operações.
///
/// O `id` da referência não é gravado no tipo: aqui ele É a posição no vetor
/// `actives`, e a reindexação contígua mantém as duas formas coincidindo.
fn normalizar_active(v: Option<&JsonValue>) -> R<Active> {
    let nivel = normalizar_nivel(v)?;
    let Some(JsonValue::Map(a)) = v else {
        return Err(erro("permissão inválida"));
    };
    let mut active = Active { nivel, name: None, operations: None };

    // `state.js:262`: o nome é validado E GUARDADO — ele participa da folha `perm`.
    // O limite é em BYTES (`Buffer.byteLength`), que é o que `str::len` devolve.
    if let Some(nome) = a.get("name")
        && !matches!(nome, JsonValue::Null)
    {
        let JsonValue::Str(s) = nome else {
            return Err(erro("nome da permissão inválido"));
        };
        if s.len() > MAX_PERMISSION_NAME {
            return Err(erro("nome da permissão é longo demais"));
        }
        active.name = Some(s.clone());
    }

    // ESCOPO: ausente = todas as operações permitidas (retrocompatível). Presente,
    // restringe a chave quente ao que ela realmente precisa — é o que dá sentido
    // ao nível `active`.
    match a.get("operations") {
        None | Some(JsonValue::Null) => {}
        Some(JsonValue::List(ops)) => {
            if ops.is_empty() {
                return Err(erro("operations deve ser uma lista não vazia"));
            }
            if ops.len() > MULTISIG_OPS.len() {
                return Err(erro("operations com itens demais"));
            }
            let mut norm: Vec<String> = Vec::with_capacity(ops.len());
            for op in ops {
                let JsonValue::Str(nome) = op else {
                    return Err(erro("operação desconhecida"));
                };
                if !MULTISIG_OPS.contains(&nome.as_str()) {
                    return Err(erro(format!("operação desconhecida: {nome}")));
                }
                if norm.contains(nome) {
                    return Err(erro("operação duplicada em operations"));
                }
                norm.push(nome.clone());
            }
            // `PERMISSION_CHANGE` nunca entra: conta v2 só troca permissão pelo
            // caminho com timelock e veto. Deixar entrar aqui reabriria o desvio
            // que o desenho inteiro existe para fechar.
            if norm.iter().any(|o| o == "PERMISSION_CHANGE") {
                return Err(erro("PERMISSION_CHANGE não é escopável — use PERMISSION_PROPOSE"));
            }
            norm.sort(); // ordenado: serialização determinística no stateRoot
            active.operations = Some(norm);
        }
        _ => return Err(erro("operations deve ser uma lista não vazia")),
    }
    Ok(active)
}

/// Estrutura v2: `{ owner, actives[], witness?, recovery?, delayBlocks }`.
fn normalizar_permissao_v2(v: Option<&JsonValue>) -> R<Permission> {
    let JsonValue::Map(p) = v.ok_or_else(|| erro("permissão inválida"))? else {
        return Err(erro("permissão inválida"));
    };
    let owner = normalizar_nivel(p.get("owner"))?;

    // `active` no singular é açúcar para uma lista de um item.
    let brutas: Vec<&JsonValue> = match (p.get("actives"), p.get("active")) {
        (Some(JsonValue::List(l)), _) => l.iter().collect(),
        (_, Some(v)) if !matches!(v, JsonValue::Null) => vec![v],
        _ => Vec::new(),
    };
    if brutas.is_empty() {
        return Err(erro("permissão precisa de ao menos uma active"));
    }
    if brutas.len() > MAX_ACTIVE_PERMISSIONS {
        return Err(erro(format!("no máximo {MAX_ACTIVE_PERMISSIONS} permissões active")));
    }
    let mut actives = Vec::with_capacity(brutas.len());
    for a in brutas {
        actives.push(normalizar_active(Some(a))?);
    }

    let uma_chave = |v: Option<&JsonValue>, nome: &str| -> R<Option<String>> {
        match v {
            None | Some(JsonValue::Null) => Ok(None),
            Some(JsonValue::Str(s)) if is_valid_address(s) => Ok(Some(s.clone())),
            _ => Err(erro(format!("{nome} deve ser um endereço E7 válido"))),
        }
    };
    let witness = uma_chave(p.get("witness"), "witness")?;
    let recovery = uma_chave(p.get("recovery"), "recovery")?;

    let delay = match p.get("delayBlocks") {
        None | Some(JsonValue::Null) => PERM_DELAY_DEFAULT_BLOCKS,
        outro => como_u64(outro).ok_or_else(|| {
            erro(format!(
                "delayBlocks fora da faixa ({PERM_DELAY_MIN_BLOCKS}..{PERM_DELAY_MAX_BLOCKS})"
            ))
        })?,
    };
    if !(PERM_DELAY_MIN_BLOCKS..=PERM_DELAY_MAX_BLOCKS).contains(&delay) {
        return Err(erro(format!(
            "delayBlocks fora da faixa ({PERM_DELAY_MIN_BLOCKS}..{PERM_DELAY_MAX_BLOCKS})"
        )));
    }

    Ok(Permission::V2 { owner, actives, witness, recovery, delay_blocks: delay })
}

// ============================================================================
// Mudança estrutural (permissões v2)
// ============================================================================

/// Uma mudança estrutural já validada. É o que `PendingPerm.change` guarda, e é o
/// mesmo objeto que a referência grava (`#normalizeChange`, `state.js:328-356`).
///
/// Cada variante carrega EXATAMENTE o que aquele nível admite: só `active` tem
/// `id`, só `witness`/`recovery` admitem remoção por endereço nulo, `delay` é um
/// número. Um par `(level: String, value: JsonValue)` deixaria representável
/// "delay com valor de endereço" e obrigaria toda leitura a revalidar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mudanca {
    Owner(Nivel),
    /// `valor: None` REMOVE a active de índice `id`.
    Active {
        id: usize,
        valor: Option<Box<Active>>,
    },
    /// `None` remove o nível.
    Witness(Option<String>),
    Recovery(Option<String>),
    Delay(u64),
}

impl Mudanca {
    /// Rótulo do nível, para as mensagens e para a tabela de autorização.
    pub fn nivel(&self) -> &'static str {
        match self {
            Mudanca::Owner(_) => "owner",
            Mudanca::Active { .. } => "active",
            Mudanca::Witness(_) => "witness",
            Mudanca::Recovery(_) => "recovery",
            Mudanca::Delay(_) => "delay",
        }
    }

    /// Forma canônica: `{level, value}` — e `{level, id, value}` para `active`,
    /// que é a única a gravar o `id` (`state.js:338-339`).
    ///
    /// Onde a referência devolve `value: null` LITERAL (remoção de nível, remoção
    /// de active) sai `Value::Null`: a chave existe, o valor é nulo.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("level".into(), Value::str(self.nivel()));
        let value = match self {
            Mudanca::Owner(n) => n.to_value(),
            Mudanca::Active { id, valor } => {
                m.insert("id".into(), Value::uint(*id as u128));
                // A referência normaliza o valor com `#normalizeActive(value, id)`,
                // então o `id` gravado DENTRO do valor é o da mudança, não um índice
                // de vetor.
                match valor {
                    Some(a) => a.to_value(*id),
                    None => Value::Null,
                }
            }
            Mudanca::Witness(v) | Mudanca::Recovery(v) => match v {
                Some(a) => Value::str(a.clone()),
                None => Value::Null,
            },
            Mudanca::Delay(d) => Value::uint(*d),
        };
        m.insert("value".into(), value);
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// `value: null` NÃO é campo ausente: em `witness`/`recovery` significa REMOVER
    /// o nível, e em `active` remover a active daquele `id`. Ler nulo como "nada a
    /// mudar" transformaria uma remoção aprovada num no-op — a conta ficaria com o
    /// nível que a governança mandou tirar.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        let level = m.get("level")?.texto()?;
        // Só `active` grava o `id` no topo; qualquer outra chave é campo não lido.
        if m.len() != 2 + usize::from(level == "active") {
            return None;
        }
        let valor = m.get("value")?;
        match level {
            "owner" => Some(Mudanca::Owner(Nivel::from_value(valor)?)),
            "active" => {
                let id: usize = m.get("id")?.inteiro()?;
                let valor = match valor.e_nulo() {
                    true => None,
                    false => Some(Box::new(Active::from_value(valor, id)?)),
                };
                Some(Mudanca::Active { id, valor })
            }
            "witness" => Some(Mudanca::Witness(valor.texto_ou_nulo()?)),
            "recovery" => Some(Mudanca::Recovery(valor.texto_ou_nulo()?)),
            "delay" => Some(Mudanca::Delay(valor.inteiro()?)),
            _ => None,
        }
    }
}

/// Valida o conteúdo de uma mudança estrutural ANTES de enfileirar.
fn normalizar_mudanca(v: Option<&JsonValue>) -> R<Mudanca> {
    let JsonValue::Map(c) = v.ok_or_else(|| erro("mudança inválida"))? else {
        return Err(erro("mudança inválida"));
    };
    let level = texto(c.get("level")).unwrap_or("");
    match level {
        "owner" => Ok(Mudanca::Owner(normalizar_nivel(c.get("value"))?)),
        "active" => {
            // `id` escolhe QUAL active alterar; ausente = a primária. `value: null` remove.
            let id = match c.get("id") {
                None | Some(JsonValue::Null) => 0,
                outro => como_i128(outro).ok_or_else(|| erro("id de active inválido"))?,
            };
            if id < 0 || id >= MAX_ACTIVE_PERMISSIONS as i128 {
                return Err(erro("id de active inválido"));
            }
            let id = id as usize;
            match c.get("value") {
                Some(JsonValue::Null) => Ok(Mudanca::Active { id, valor: None }),
                outro => {
                    Ok(Mudanca::Active { id, valor: Some(Box::new(normalizar_active(outro)?)) })
                }
            }
        }
        "witness" | "recovery" => match c.get("value") {
            Some(JsonValue::Null) => Ok(if level == "witness" {
                Mudanca::Witness(None)
            } else {
                Mudanca::Recovery(None)
            }),
            Some(JsonValue::Str(s)) if is_valid_address(s) => Ok(if level == "witness" {
                Mudanca::Witness(Some(s.clone()))
            } else {
                Mudanca::Recovery(Some(s.clone()))
            }),
            _ => Err(erro(format!("{level} deve ser um endereço E7 válido ou null"))),
        },
        "delay" => {
            let d = como_u64(c.get("value"))
                .ok_or_else(|| erro("delayBlocks fora da faixa"))?;
            if !(PERM_DELAY_MIN_BLOCKS..=PERM_DELAY_MAX_BLOCKS).contains(&d) {
                return Err(erro("delayBlocks fora da faixa"));
            }
            Ok(Mudanca::Delay(d))
        }
        outro => Err(erro(format!("nível de permissão desconhecido: {outro}"))),
    }
}

/// Aplica a mudança a uma CÓPIA e verifica que a conta continua operável.
///
/// Roda na PROPOSTA e de novo na EXECUÇÃO: o estado muda durante o timelock, e uma
/// configuração segura ao propor pode inutilizar a conta ao aplicar. É o trilho
/// anti-trava — sem ele, uma mudança inocente enfileirada hoje vira conta morta
/// daqui a doze horas.
fn simular_mudanca(perm: &Permission, mudanca: &Mudanca) -> R<Permission> {
    // Mudança estrutural só existe na v2. O `enum` torna isso um caso explícito em
    // vez de um `owner` que "por acaso" era `None`.
    let Permission::V2 { owner, actives, witness, recovery, delay_blocks } = perm else {
        return Err(erro("conta não usa permissões v2"));
    };
    let mut owner = owner.clone();
    let mut actives = actives.clone();
    let mut witness = witness.clone();
    let mut recovery = recovery.clone();
    let mut delay_blocks = *delay_blocks;

    match mudanca {
        Mudanca::Delay(d) => delay_blocks = *d,
        Mudanca::Owner(n) => owner = n.clone(),
        Mudanca::Witness(w) => witness = w.clone(),
        Mudanca::Recovery(r) => recovery = r.clone(),
        Mudanca::Active { id, valor } => {
            // O `id` é o índice: remover desloca os seguintes, que é exatamente a
            // reindexação contígua que a referência faz explicitamente.
            match valor {
                None => {
                    if *id < actives.len() {
                        actives.remove(*id);
                    }
                }
                Some(v) if *id < actives.len() => actives[*id] = (**v).clone(),
                Some(v) => {
                    if actives.len() >= MAX_ACTIVE_PERMISSIONS {
                        return Err(erro("limite de permissões active atingido"));
                    }
                    actives.push((**v).clone());
                }
            }
        }
    }

    // Trilho anti-trava: sem owner ou sem active a conta fica sem caminho de operação.
    if owner.keys.is_empty() {
        return Err(erro("configuração deixaria a conta sem owner"));
    }
    if actives.is_empty() {
        return Err(erro("configuração deixaria a conta sem active"));
    }
    if actives.iter().any(|a| a.nivel.keys.is_empty()) {
        return Err(erro("active sem chaves"));
    }
    Ok(Permission::V2 { owner, actives, witness, recovery, delay_blocks })
}

/// Quem precisa autorizar cada mudança estrutural. Ver a tabela em
/// `docs/permissoes-v2.md`. Devolve `false` se o conjunto NÃO satisfaz a regra.
///
/// Recebe a MUDANÇA, não um rótulo de nível: com o `enum` não existe mais o ramo
/// "nível desconhecido", porque não existe mais mudança sem nível.
fn autoriza_mudanca(perm: &Permission, mudanca: &Mudanca, signers: &BTreeSet<String>) -> bool {
    let owner = owner_de(perm);
    let tem_recovery = match perm {
        Permission::V2 { recovery: Some(r), .. } => signers.contains(r),
        _ => false,
    };
    match mudanca {
        Mudanca::Active { .. } | Mudanca::Witness(_) | Mudanca::Delay(_) => {
            atinge_limiar(owner, signers)
        }
        // A recuperação: active PRIMÁRIA + `recovery`. O recovery NÃO age sozinho —
        // só completa. É o que torna inútil o roubo isolado da chave de recuperação.
        Mudanca::Owner(_) => atinge_limiar(active_primaria(perm), signers) && tem_recovery,
        Mudanca::Recovery(_) => {
            atinge_limiar(owner, signers) && atinge_limiar(active_primaria(perm), signers)
        }
    }
}

// ============================================================================
// Parâmetros governáveis e conjunto de validadores
// ============================================================================

/// Espécie de um parâmetro governável. Espelha `CHAIN.GOVERNABLE` (`config.js:129`).
enum EspecGov {
    /// Valor monetário/grande, comparado como inteiro de precisão suficiente.
    Grande { min: i128, max: i128 },
    Inteiro { min: i64, max: i64 },
}

fn especificacao(param: &str) -> Option<EspecGov> {
    let u = UNIT as i128;
    Some(match param {
        "BLOCK_REWARD" => EspecGov::Grande { min: 0, max: 1_000 * u },
        "MIN_VALIDATOR_STAKE" => EspecGov::Grande { min: 1, max: 10_000_000 * u },
        "MAX_VALIDATORS" => EspecGov::Inteiro { min: 1, max: 101 },
        "FEE_EXEMPT_STAKE" => EspecGov::Grande { min: 0, max: 1_000_000 * u },
        "MIN_ORACLE_STAKE" => EspecGov::Grande { min: 0, max: 1_000_000 * u },
        "TREASURY_PCT" => EspecGov::Inteiro { min: 0, max: 50 },
        "BRIDGE_BREAKER_BPS" => EspecGov::Inteiro { min: 100, max: 10_000 },
        _ => return None,
    })
}

/// Coage/valida o valor proposto para um parâmetro governável (tipo + limites).
/// Devolve a forma DECIMAL, que é como `State::params` guarda — e que a folha
/// codifica com a tag de INTEIRO, como a referência (`BigInt`/`Number`).
fn coagir_valor_gov(spec: &EspecGov, raw: Option<&JsonValue>) -> R<ValorGov> {
    let v = como_i128(raw).ok_or_else(|| erro("valor inválido (esperado inteiro)"))?;
    match spec {
        EspecGov::Grande { min, max } => {
            if v < *min || v > *max {
                return Err(erro("valor fora dos limites permitidos"));
            }
        }
        EspecGov::Inteiro { min, max } => {
            if v < *min as i128 || v > *max as i128 {
                return Err(erro("valor inválido/fora dos limites"));
            }
        }
    }
    // `i128::to_string` já produz a forma canônica (sem zero à esquerda, sem `+`).
    Ok(ValorGov::Inteiro(v.to_string()))
}

/// Limites `(min, max)` de um parâmetro governável, como `i128`. FONTE ÚNICA: o
/// conselheiro de governança da camada de nó (`node::governance_advisor`) consome
/// isto em vez de reproduzir a tabela `CHAIN.GOVERNABLE` — duplicá-la seria abrir a
/// porta para os dois divergirem quando um limite mudar. `None` = não governável.
pub fn governable_bounds(param: &str) -> Option<(i128, i128)> {
    especificacao(param).map(|e| match e {
        EspecGov::Grande { min, max } => (min, max),
        EspecGov::Inteiro { min, max } => (min as i128, max as i128),
    })
}

/// Valor EFETIVO de um parâmetro governável: o override aprovado on-chain
/// (`state.params`) se houver, senão o default do protocolo.
///
/// Um override ilegível é ERRO, não "usa o default": se os nós discordarem de como
/// ler um parâmetro corrompido, discordam do conjunto de validadores — que é a
/// divergência mais cara que existe.
fn param_u128(state: &State, nome: &str, padrao: u128) -> R<u128> {
    match state.params.get(nome) {
        None => Ok(padrao),
        Some(s) => s.parse::<u128>().map_err(|_| erro(format!("parâmetro {nome} corrompido"))),
    }
}

fn param_usize(state: &State, nome: &str, padrao: usize) -> R<usize> {
    match state.params.get(nome) {
        None => Ok(padrao),
        Some(s) => s.parse::<usize>().map_err(|_| erro(format!("parâmetro {nome} corrompido"))),
    }
}

/// Conjunto ativo: top-N elegíveis por PESO = self-stake + votos recebidos.
///
/// `override_stake` permite perguntar "quem seriam os validadores SE esta conta
/// tivesse este stake" — usado pelo `UNSTAKE` multiassinatura para checar a
/// remoção do último validador sem mutar o estado antes da validação.
///
/// Contas `eavm_managed` ficam DE FORA, como na referência (`state.js:634`): são
/// contas mapeadas de um endereço EAVM (`0x…`), sem par de chaves híbrido — nunca
/// conseguiriam assinar um bloco. Se entrassem no conjunto ativo, receberiam slots
/// de produção que ficariam eternamente vazios.
///
/// O comentário anterior aqui dizia que `Account` não tinha o campo. Tinha:
/// `state/mod.rs:105`, e `blockchain.rs:170` e `value.rs:270` já filtravam por ele.
/// A governança era o ÚNICO lugar que não filtrava — e é justamente ela que decide
/// quem produz. Com uma conta EVM stakeada acima do mínimo, o quórum de governança
/// e o conjunto ativo deste nó divergiriam do resto da rede.
/// Ranking por weight = stake + votos (desc), desempate endereço asc.
fn ranquear_candidatos(
    state: &State,
    override_stake: Option<(&str, Amount)>,
) -> R<Vec<(Amount, String)>> {
    let min = param_u128(state, "MIN_VALIDATOR_STAKE", MIN_VALIDATOR_STAKE)?;

    let stake_de = |addr: &str, staked: Amount| match override_stake {
        Some((a, s)) if a == addr => s,
        _ => staked,
    };

    let mut elegiveis: Vec<(Amount, String)> = Vec::new();
    for (addr, conta) in &state.accounts {
        if conta.eavm_managed {
            continue;
        }
        let staked = stake_de(addr, conta.staked);
        if staked < min {
            continue;
        }
        let votos = state.candidate_votes.get(addr).copied().unwrap_or(0);
        // `saturating_add`: os dois somados não chegam perto de u128::MAX com o
        // suprimento real; saturar aqui é preferível a um erro, porque este cálculo
        // é ORDENAÇÃO — um par saturado ainda ordena no topo, que é o correto.
        elegiveis.push((staked.saturating_add(votos), addr.clone()));
    }
    elegiveis.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    Ok(elegiveis)
}

fn validadores(state: &State, override_stake: Option<(&str, Amount)>) -> R<Vec<String>> {
    let max = param_usize(state, "MAX_VALIDATORS", MAX_VALIDATORS)?;
    let mut elegiveis = ranquear_candidatos(state, override_stake)?;
    elegiveis.truncate(max);
    Ok(elegiveis.into_iter().map(|(_, a)| a).collect())
}

/// Banco (standby): posições após as ativas, até `VALIDATOR_BANK_SIZE`.
/// Ver `docs/plano/17-set-51-banco-101.md`.
pub fn banco(state: &State) -> R<Vec<String>> {
    use crate::config::VALIDATOR_BANK_SIZE;
    let max = param_usize(state, "MAX_VALIDATORS", MAX_VALIDATORS)?;
    let bank = VALIDATOR_BANK_SIZE as usize;
    let elegiveis = ranquear_candidatos(state, None)?;
    if elegiveis.len() <= max {
        return Ok(Vec::new());
    }
    let fim = (max + bank).min(elegiveis.len());
    Ok(elegiveis[max..fim].iter().map(|(_, a)| a.clone()).collect())
}

/// Conta votos de validadores ATUAIS numa proposta; devolve `Some(execute_at)` se
/// o quórum de 2/3+1 foi atingido.
///
/// Função PURA de propósito: o chamador só muta depois de saber o resultado, o que
/// mantém a invariante de "erro não altera estado" mesmo se o `checked_add` do
/// timelock estourar.
fn apurar(state: &State, votos: &BTreeMap<String, bool>, height: u64) -> R<Option<u64>> {
    let ativos: BTreeSet<String> = validadores(state, None)?.into_iter().collect();
    let n = ativos.len();
    if n == 0 {
        return Ok(None);
    }
    let quorum = (2 * n) / 3 + 1;
    let sim = votos.keys().filter(|a| ativos.contains(*a)).count();
    if sim < quorum {
        return Ok(None);
    }
    // Timelock: não aplica na hora — ENFILEIRA, dando janela para os usuários
    // reagirem antes de o parâmetro passar a valer.
    let at = height
        .checked_add(GOV_TIMELOCK_BLOCKS)
        .ok_or_else(|| erro("estouro de altura no timelock de governança"))?;
    Ok(Some(at))
}

// ============================================================================
// Despacho
// ============================================================================

pub fn aplicar(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    match tx.tx_type.as_str() {
        "GOV_PROPOSE" => gov_propose(state, tx, ctx),
        "GOV_VOTE" => gov_vote(state, tx, ctx),
        "PERMISSION_UPDATE" => permission_update(state, tx, ctx),
        "PERMISSION_PROPOSE" => permission_propose(state, tx, ctx),
        "PERMISSION_APPROVE" => permission_approve(state, tx, ctx),
        "PERMISSION_VETO" => permission_veto(state, tx, ctx),
        "MULTISIG_PROPOSE" => multisig_propose(state, tx, ctx),
        "MULTISIG_APPROVE" => multisig_approve(state, tx, ctx),
        "META_TX" => meta_tx(state, tx, ctx),
        "ORACLE_REGISTER" => oracle_register(state, tx, ctx),
        outro => Err(erro(format!("tipo de transação desconhecido: {outro}"))),
    }
}

/// Debita a taxa do remetente. Sempre o ÚLTIMO passo falível antes das mutações
/// do efeito, para que uma rejeição não deixe taxa cobrada.
fn cobrar_taxa(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if state.balance_of(&tx.from) < ctx.fee {
        return Err(erro("saldo insuficiente para a taxa"));
    }
    state.debitar(&tx.from, ctx.fee)
}

/// O `id` da transação, exigido por tudo que indexa estado por ele.
fn id_da_tx(tx: &Tx) -> R<&str> {
    tx.id.as_deref().ok_or_else(|| erro("transação sem id"))
}

// ---------------------------------------------------------------- governança

fn gov_propose(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < GOVERNANCE_HEIGHT {
        return Err(erro("governança ainda não ativa"));
    }
    if !validadores(state, None)?.iter().any(|v| v == &tx.from) {
        return Err(erro("só validador ativo pode propor"));
    }
    let d = dados(tx)?;
    let param = texto(d.get("param")).unwrap_or("");

    // Os três parâmetros ESTRUTURADOS não são escalares: o valor é um objeto, e
    // `ValorGov` carrega essa distinção em vez de achatar tudo em texto.
    let value = match param {
        "BRIDGE_COMMITTEE" => validar_comite(d.get("value"))?,
        "TREASURY_SPEND" => validar_gasto_tesouraria(d.get("value"))?,
        "AI_ATTESTER" => {
            if ctx.height < AI_TEE_HEIGHT {
                return Err(erro("atestação de IA (Fase 6) ainda não ativa"));
            }
            validar_atestador(d.get("value"))?
        }
        outro => {
            let spec =
                especificacao(outro).ok_or_else(|| erro(format!("parâmetro não governável: {outro}")))?;
            coagir_valor_gov(&spec, d.get("value"))?
        }
    };

    let vb = match d.get("votingBlocks") {
        None | Some(JsonValue::Null) => GOV_MAX_VOTING_BLOCKS,
        outro => como_u64(outro).ok_or_else(|| erro("votingBlocks inválido"))?,
    };
    if vb == 0 || vb > GOV_MAX_VOTING_BLOCKS {
        return Err(erro("votingBlocks inválido"));
    }
    let deadline = ctx
        .height
        .checked_add(vb)
        .ok_or_else(|| erro("estouro de altura na janela de votação"))?;
    let id = id_da_tx(tx)?.to_string();

    // O voto do proponente já conta; com conjunto pequeno o quórum pode ser
    // atingido na hora. Apurado ANTES de qualquer mutação.
    let mut votos = BTreeMap::new();
    votos.insert(tx.from.clone(), true);
    let execute_at = apurar(state, &votos, ctx.height)?;

    cobrar_taxa(state, tx, ctx)?;
    state.proposals.insert(
        id.clone(),
        Proposal {
            id,
            param: param.to_string(),
            value,
            proposer: tx.from.clone(),
            votes: votos,
            deadline,
            execute_at,
            // `state.js:1472` — a referência grava `tx.timestamp` cru.
            created_at: tx.timestamp,
            state: if execute_at.is_some() { "QUEUED".into() } else { "VOTING".into() },
        },
    );
    Ok(())
}

fn gov_vote(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < GOVERNANCE_HEIGHT {
        return Err(erro("governança ainda não ativa"));
    }
    let d = dados(tx)?;
    let pid = texto(d.get("proposalId")).unwrap_or("").to_string();
    let p = state
        .proposals
        .get(&pid)
        .filter(|p| p.state == "VOTING")
        .ok_or_else(|| erro("proposta inexistente ou encerrada"))?;
    if ctx.height > p.deadline {
        // A referência marca DEFEATED e então lança — mas a exceção descarta a
        // marcação junto com o resto da transação, então o efeito observável é só
        // o erro. Aqui a invariante é explícita: `Err` não muta nada.
        return Err(erro("proposta expirada"));
    }
    // Ordem das checagens igual à da referência: um validador que SAIU do conjunto
    // e já tinha votado recebe "só validador ativo", não "já votou". A mensagem é
    // observável pelo cliente, e divergir nela é divergir do nó.
    let ja_votou = p.votes.contains_key(&tx.from);
    if !validadores(state, None)?.iter().any(|v| v == &tx.from) {
        return Err(erro("só validador ativo pode votar"));
    }
    if ja_votou {
        return Err(erro("validador já votou nesta proposta"));
    }

    // Apura sobre uma cópia dos votos COM o novo voto, antes de mutar.
    let mut votos = state.proposals[&pid].votes.clone();
    votos.insert(tx.from.clone(), true);
    let execute_at = apurar(state, &votos, ctx.height)?;

    cobrar_taxa(state, tx, ctx)?;
    let p = state.proposals.get_mut(&pid).expect("verificado acima");
    p.votes = votos;
    if let Some(at) = execute_at {
        p.state = "QUEUED".into();
        p.execute_at = Some(at);
    }
    Ok(())
}

/// Comitê de ponte proposto por governança. Espelha `#validateCommitteeValue`
/// (`state.js:669`), que devolve `{ sourceChain, members, quorum }` — um OBJETO.
fn validar_comite(v: Option<&JsonValue>) -> R<ValorGov> {
    let Some(JsonValue::Map(m)) = v else {
        return Err(erro("valor de comitê inválido"));
    };
    let chain = texto(m.get("sourceChain")).unwrap_or("");
    if !(2..=32).contains(&chain.len())
        || !chain.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(erro("sourceChain inválida"));
    }
    let membros = membros_minusculos(m.get("members"), MAX_COMMITTEE_MEMBERS)?;
    let quorum = quorum_valido(m.get("quorum"), membros.len())?;
    Ok(ValorGov::Objeto(BTreeMap::from([
        (
            "members".to_string(),
            JsonValue::List(membros.into_iter().map(JsonValue::Str).collect()),
        ),
        ("quorum".to_string(), JsonValue::Int(quorum)),
        ("sourceChain".to_string(), JsonValue::str(chain.to_ascii_uppercase())),
    ])))
}

/// Gasto de tesouraria proposto por governança. Espelha `#validateTreasurySpend`
/// (`state.js:702`): `amount` é guardado como TEXTO (`amount.toString()`), e é por
/// isso que ele não pode virar inteiro aqui.
fn validar_gasto_tesouraria(v: Option<&JsonValue>) -> R<ValorGov> {
    let Some(JsonValue::Map(m)) = v else {
        return Err(erro("gasto de tesouraria inválido"));
    };
    let dest = texto(m.get("recipient")).unwrap_or("");
    if !is_valid_address(dest) {
        return Err(erro("destinatário inválido"));
    }
    let amount = como_i128(m.get("amount")).ok_or_else(|| erro("valor inválido"))?;
    if amount <= 0 {
        return Err(erro("valor deve ser positivo"));
    }
    Ok(ValorGov::Objeto(BTreeMap::from([
        ("amount".to_string(), JsonValue::str(amount.to_string())),
        ("recipient".to_string(), JsonValue::str(dest)),
    ])))
}

/// `String(x ?? '')` da referência: ausente e nulo viram `''`, o resto vira texto.
fn coagir_ou_vazio(v: Option<&JsonValue>) -> String {
    match v {
        None | Some(JsonValue::Null) => String::new(),
        Some(outro) => crate::state::coercao::js_string_de(outro),
    }
}

/// Atestador de IA (Fase 6). Espelha `#validateAttesterValue` (`state.js:684`).
fn validar_atestador(v: Option<&JsonValue>) -> R<ValorGov> {
    let Some(JsonValue::Map(m)) = v else {
        return Err(erro("valor de atestador inválido"));
    };
    // `String(v.attesterId ?? '')` (state.js:686): o coalescente trata AUSENTE e
    // NULO como `''`; qualquer outro valor vira texto. Usar `texto()` — que só
    // casa `Str` — fazia `attesterId: 12345` virar `""` e ser recusado aqui,
    // enquanto a rede o aceita como `"12345"`.
    let id = coagir_ou_vazio(m.get("attesterId"));
    if !(2..=64).contains(&crate::state::coercao::js_len(&id))
        || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || b == b'-')
    {
        return Err(erro("attesterId inválido"));
    }
    // `String(v.kind ?? 'TEE')` — o padrão `TEE` vale para AUSENTE e NULO, e só.
    // Com `texto()`, um `kind: 5` caía no padrão e a proposta era CRIADA; na rede
    // `String(5)` é `"5"` e a proposta é recusada.
    let kind = match m.get("kind") {
        None | Some(JsonValue::Null) => "TEE".to_string(),
        Some(outro) => crate::state::coercao::js_string_de(outro),
    }
    .to_uppercase();
    if kind != "TEE" && kind != "ZK" {
        return Err(erro("kind deve ser TEE ou ZK"));
    }
    let membros = membros_minusculos(m.get("members"), MAX_AI_ATTESTER_MEMBERS)?;
    // Membros de atestador são endereços ETHEREUM (0x + 40 hex), não E7: o enclave
    // assina com chave secp256k1 do lado de fora da cadeia.
    for m in &membros {
        let ok = m.len() == 42
            && m.starts_with("0x")
            && m[2..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if !ok {
            return Err(erro("endereço de membro inválido (eth 0x+40 hex)"));
        }
    }
    let quorum = quorum_valido(m.get("quorum"), membros.len())?;
    let measurement = coagir_ou_vazio(m.get("measurement"));
    // `.length` do JS: unidades UTF-16. Com `chars().count()`, 200 emoji passavam
    // aqui (200 caracteres) e eram recusados na rede (400 unidades UTF-16).
    if measurement.is_empty() || crate::state::coercao::js_len(&measurement) > 256 {
        return Err(erro("measurement inválida (1..256 chars)"));
    }
    Ok(ValorGov::Objeto(BTreeMap::from([
        ("attesterId".to_string(), JsonValue::str(&id)),
        ("kind".to_string(), JsonValue::str(&kind)),
        ("measurement".to_string(), JsonValue::str(&measurement)),
        (
            "members".to_string(),
            JsonValue::List(membros.into_iter().map(JsonValue::Str).collect()),
        ),
        ("quorum".to_string(), JsonValue::Int(quorum)),
    ])))
}

fn membros_minusculos(v: Option<&JsonValue>, max: usize) -> R<Vec<String>> {
    let lista = match v {
        Some(JsonValue::List(l)) => l,
        None | Some(JsonValue::Null) => return Err(erro("nº de membros inválido")),
        _ => return Err(erro("nº de membros inválido")),
    };
    if lista.is_empty() || lista.len() > max {
        return Err(erro("nº de membros inválido"));
    }
    let mut out = Vec::with_capacity(lista.len());
    for m in lista {
        let JsonValue::Str(s) = m else {
            return Err(erro("endereço de membro inválido (eth 0x+40 hex)"));
        };
        out.push(s.to_ascii_lowercase());
    }
    let unicos: BTreeSet<&String> = out.iter().collect();
    if unicos.len() != out.len() {
        return Err(erro("membros duplicados"));
    }
    Ok(out)
}

fn quorum_valido(v: Option<&JsonValue>, n: usize) -> R<i64> {
    let q = como_i128(v).ok_or_else(|| erro("quorum inválido"))?;
    if q <= 0 || q > n as i128 {
        return Err(erro("quorum inválido"));
    }
    i64::try_from(q).map_err(|_| erro("quorum inválido"))
}

// ---------------------------------------------------------------- permissões

fn permission_update(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < PERMISSIONS_HEIGHT {
        return Err(erro("permissões ainda não ativas"));
    }
    // A guarda de assinatura única (conta com permissão não age sozinha) vive em
    // `applyTransaction` na referência. Ver o relatório: ela AINDA NÃO existe em
    // `mod.rs`, e sem ela uma conta já multiassinatura poderia reconfigurar-se por
    // assinatura única. A checagem abaixo cobre o caso aqui, no mínimo.
    if state.permissions.contains_key(&tx.from) {
        return Err(erro(
            "conta multisig: opere via MULTISIG_PROPOSE/APPROVE, não por assinatura única",
        ));
    }
    // A trava existia porque VOTE/SET_COMMISSION/CLAIM_VOTER_REWARD não eram ops
    // multiassinatura: um validador multisig ficaria com stake e voto PRESOS. A
    // partir do fork v2 essas ops existem, então a trava cai — é o que libera
    // validador a ter `witness`. Ver `docs/permissoes-v2.md`.
    if ctx.height < PERMISSIONS_V2_HEIGHT && state.account(&tx.from).staked > 0 {
        return Err(erro("conta com stake não pode virar multisig — faça UNSTAKE primeiro"));
    }
    let d = dados(tx)?;
    let raw = d.get("permission");
    // A forma v2 é detectada pelo campo `owner`; sem ele, continua v1.
    let v2 = ctx.height >= PERMISSIONS_V2_HEIGHT
        && matches!(raw, Some(JsonValue::Map(m)) if !matches!(m.get("owner"), None | Some(JsonValue::Null)));
    let perm =
        if v2 { normalizar_permissao_v2(raw)? } else { Permission::V1(normalizar_nivel(raw)?) };

    cobrar_taxa(state, tx, ctx)?;
    state.permissions.insert(tx.from.clone(), perm);
    Ok(())
}

fn permission_propose(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < PERMISSIONS_V2_HEIGHT {
        return Err(erro("permissões v2 ainda não ativas"));
    }
    let d = dados(tx)?;
    let conta = texto(d.get("account")).unwrap_or("").to_string();
    if !is_valid_address(&conta) {
        return Err(erro("conta inválida"));
    }
    let perm = state.permissions.get(&conta).ok_or_else(|| erro("conta não usa permissões v2"))?;
    if !e_v2(perm) {
        return Err(erro("conta não usa permissões v2"));
    }
    if !e_chave_da_permissao(perm, &tx.from) {
        return Err(erro("remetente não participa desta permissão"));
    }
    let mudanca = normalizar_mudanca(d.get("change"))?;
    simular_mudanca(perm, &mudanca)?; // valida já na proposta

    let mut aprovacoes = BTreeMap::new();
    aprovacoes.insert(tx.from.clone(), true);
    let assinantes: BTreeSet<String> = aprovacoes.keys().cloned().collect();
    // A v2 sempre tem `delay_blocks` — o tipo garante, então não há default a
    // adivinhar aqui.
    let delay = match perm {
        Permission::V2 { delay_blocks, .. } => *delay_blocks,
        Permission::V1(_) => return Err(erro("conta não usa permissões v2")),
    };
    let execute_at = if autoriza_mudanca(perm, &mudanca, &assinantes) {
        Some(
            ctx.height
                .checked_add(delay)
                .ok_or_else(|| erro("estouro de altura no timelock de permissão"))?,
        )
    } else {
        None
    };

    cobrar_taxa(state, tx, ctx)?;
    // Proposta nova SUBSTITUI a anterior — UMA pendência por conta. É o que impede
    // um ladrão de re-propor em loop para renovar o timelock, e dá o caminho de
    // aborto sem inventar transação de cancelamento.
    state.pending_perm.insert(
        conta,
        PendingPerm {
            change: mudanca,
            approvals: aprovacoes,
            vetoes: BTreeMap::new(),
            // `None` = timelock ainda não iniciado, como o `executeAt: null` da
            // referência.
            execute_at,
            proposed_at: ctx.height,
        },
    );
    Ok(())
}

fn permission_approve(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < PERMISSIONS_V2_HEIGHT {
        return Err(erro("permissões v2 ainda não ativas"));
    }
    let d = dados(tx)?;
    let conta = texto(d.get("account")).unwrap_or("").to_string();
    if !is_valid_address(&conta) {
        return Err(erro("conta inválida"));
    }
    let pend = state
        .pending_perm
        .get(&conta)
        .ok_or_else(|| erro("não há mudança pendente para esta conta"))?;
    let perm = state
        .permissions
        .get(&conta)
        .ok_or_else(|| erro("remetente não participa desta permissão"))?;
    if !e_chave_da_permissao(perm, &tx.from) {
        return Err(erro("remetente não participa desta permissão"));
    }
    // Deduplicação por ENDEREÇO, jamais por bytes de assinatura: assinatura é
    // maleável (a TRON teve exatamente esse bug — a mesma chave contava peso duas
    // vezes reenviando a assinatura em forma alternativa).
    if pend.approvals.contains_key(&tx.from) {
        return Err(erro("já aprovado por esta chave"));
    }

    let mut assinantes: BTreeSet<String> = pend.approvals.keys().cloned().collect();
    assinantes.insert(tx.from.clone());
    let mudanca = pend.change.clone();
    let ja_iniciado = pend.execute_at.is_some();
    // Uma pendência estrutural só existe em conta v2; se a permissão virou v1 sob a
    // pendência, não há delay definido e a aprovação não tem o que autorizar.
    let delay = match perm {
        Permission::V2 { delay_blocks, .. } => *delay_blocks,
        Permission::V1(_) => return Err(erro("conta não usa permissões v2")),
    };
    // Só inicia a contagem do timelock quando a regra de autorização é satisfeita.
    let novo_execute_at = if !ja_iniciado && autoriza_mudanca(perm, &mudanca, &assinantes) {
        Some(
            ctx.height
                .checked_add(delay)
                .ok_or_else(|| erro("estouro de altura no timelock de permissão"))?,
        )
    } else {
        None
    };

    cobrar_taxa(state, tx, ctx)?;
    let pend = state.pending_perm.get_mut(&conta).expect("verificado acima");
    pend.approvals.insert(tx.from.clone(), true);
    if novo_execute_at.is_some() {
        pend.execute_at = novo_execute_at;
    }
    Ok(())
}

fn permission_veto(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < PERMISSIONS_V2_HEIGHT {
        return Err(erro("permissões v2 ainda não ativas"));
    }
    let d = dados(tx)?;
    let conta = texto(d.get("account")).unwrap_or("").to_string();
    if !is_valid_address(&conta) {
        return Err(erro("conta inválida"));
    }
    let pend = state
        .pending_perm
        .get(&conta)
        .ok_or_else(|| erro("não há mudança pendente para esta conta"))?;
    let owner = state
        .permissions
        .get(&conta)
        .and_then(owner_de)
        .filter(|o| o.keys.contains_key(&tx.from))
        .ok_or_else(|| erro("veto exige chave do owner"))?;
    if pend.vetoes.contains_key(&tx.from) {
        return Err(erro("já vetado por esta chave"));
    }

    let mut vetos: BTreeSet<String> = pend.vetoes.keys().cloned().collect();
    vetos.insert(tx.from.clone());
    // O veto usa o LIMIAR do owner — deliberadamente não é "qualquer chave de owner
    // sozinha". Se bastasse uma chave, um ladrão que roubou UMA das chaves de owner
    // bloquearia a recuperação legítima para sempre: comprometimento parcial viraria
    // refém eterno.
    let cancela = atinge_limiar(Some(owner), &vetos);

    cobrar_taxa(state, tx, ctx)?;
    if cancela {
        state.pending_perm.remove(&conta);
    } else {
        let pend = state.pending_perm.get_mut(&conta).expect("verificado acima");
        pend.vetoes.insert(tx.from.clone(), true);
    }
    Ok(())
}

// ------------------------------------------------------------ multiassinatura

/// Operação multiassinatura já validada, com os valores resolvidos.
///
/// A separação entre validar e aplicar não é estilo: é o que garante que uma
/// operação recusada no meio do caminho não deixe metade do efeito gravada.
#[derive(Debug, Clone, PartialEq, Eq)]
enum OpResolvida {
    Transfer { to: String, amount: Amount },
    Stake { amount: Amount },
    Unstake { amount: Amount },
    SetCommission { pct: u8 },
    PermissionChange { perm: Option<Permission> },
    TokenTransfer { token: String, to: String, amount: Amount },
    NftTransfer { colecao: String, token_id: String, to: String },
    /// O payload de votos vai INTEIRO para a aplicação: quem valida é
    /// `value::aplicar_voto`, que é a MESMA função da transação `VOTE` — e ela
    /// valida tudo antes de escrever a primeira linha. Repetir a validação aqui
    /// criaria uma segunda versão da regra, que é como duas implementações
    /// começam a divergir.
    Vote { votos: JsonValue },
    ClaimVoterReward { validador: String },
    /// Corpo cru de `GOV_PROPOSE` / `GOV_VOTE` (campos além de `type`).
    GovPropose { param: String, value: ValorGov, voting_blocks: u64 },
    GovVote { proposal_id: String },
}

/// Valida a operação contra o estado ATUAL, sem mutar nada.
fn validar_op(state: &State, account: &str, op: &BTreeMap<String, JsonValue>, height: u64) -> R<OpResolvida> {
    let tipo = texto(op.get("type")).ok_or_else(|| erro("operação inválida"))?;
    let conta = state.account(account);

    // As ops abaixo só existem a partir do fork v2. Antes dele a referência cai no
    // ramo final e recusa — reproduzir isso é o que impede este cliente de aceitar
    // abaixo da altura o que a rede rejeita.
    let v2 = height >= PERMISSIONS_V2_HEIGHT;

    match tipo {
        "TRANSFER" => {
            let to = texto(op.get("to")).unwrap_or("");
            if !is_valid_address(to) {
                return Err(erro("destino inválido"));
            }
            let amount = como_amount(op.get("amount")).ok_or_else(|| erro("valor deve ser positivo"))?;
            if amount == 0 {
                return Err(erro("valor deve ser positivo"));
            }
            if conta.balance < amount {
                return Err(erro("saldo insuficiente na conta multisig"));
            }
            // O crédito do destino é checado AQUI para que a fase de aplicação não
            // tenha como falhar.
            state
                .balance_of(to)
                .checked_add(amount)
                .ok_or_else(|| erro("estouro de saldo no destino"))?;
            Ok(OpResolvida::Transfer { to: to.to_string(), amount })
        }
        "STAKE" => {
            let amount = como_amount(op.get("amount")).ok_or_else(|| erro("valor deve ser positivo"))?;
            if amount == 0 {
                return Err(erro("valor deve ser positivo"));
            }
            if conta.balance < amount {
                return Err(erro("saldo insuficiente na conta multisig"));
            }
            conta.staked.checked_add(amount).ok_or_else(|| erro("estouro de stake"))?;
            Ok(OpResolvida::Stake { amount })
        }
        "UNSTAKE" => {
            // Contraparte do STAKE: sem ela o stake de uma conta multiassinatura
            // ficaria travado, porque a guarda de topo bloqueia UNSTAKE direto.
            let amount = como_amount(op.get("amount")).ok_or_else(|| erro("valor deve ser positivo"))?;
            if amount == 0 {
                return Err(erro("valor deve ser positivo"));
            }
            let restante = conta.staked.checked_sub(amount).ok_or_else(|| erro("stake insuficiente"))?;
            // Simulado, não mutado: a referência subtrai, checa e devolve. Aqui o
            // "e se" é feito sobre uma visão, o que dispensa desfazer.
            if validadores(state, Some((account, restante)))?.is_empty() {
                return Err(erro("não é possível remover o último validador ativo da rede"));
            }
            if v2 {
                let em_fila = state.unbonding.iter().filter(|(a, _, _)| a == account).count();
                if em_fila >= MAX_UNBONDING_ENTRIES {
                    return Err(erro(format!(
                        "limite de {MAX_UNBONDING_ENTRIES} saques simultâneos atingido"
                    )));
                }
            }
            height
                .checked_add(UNBONDING_BLOCKS)
                .ok_or_else(|| erro("estouro de altura no unbonding"))?;
            Ok(OpResolvida::Unstake { amount })
        }
        "SET_COMMISSION" if v2 => {
            let pct = como_i128(op.get("percent")).ok_or_else(|| erro("comissão deve ser 0..100"))?;
            if !(0..=100).contains(&pct) {
                return Err(erro("comissão deve ser 0..100"));
            }
            height
                .checked_add(COMMISSION_DELAY_BLOCKS)
                .ok_or_else(|| erro("estouro de altura na comissão"))?;
            Ok(OpResolvida::SetCommission { pct: pct as u8 })
        }
        // `#executeMultisigOp` chama `#normalizePermission`, que produz a forma v1 —
        // a v2 nunca entra por aqui (o `MULTISIG_PROPOSE` a barra antes).
        "PERMISSION_CHANGE" => match op.get("permission") {
            Some(JsonValue::Null) => Ok(OpResolvida::PermissionChange { perm: None }),
            outro => Ok(OpResolvida::PermissionChange {
                perm: Some(Permission::V1(normalizar_nivel(outro)?)),
            }),
        },
        // Estas quatro eram recusadas com "depende de domínio ainda não portado".
        // Os domínios ESTÃO portados (`token.rs`, `nft.rs`, `value::aplicar_voto`,
        // `value::liquidar_recompensa`) — o comentário envelheceu enquanto o código
        // avançava por baixo. E recusar aqui NÃO era conservador: a referência
        // EXECUTA (`state.js:479-507`), então a mesma operação movia token na rede e
        // era rejeitada por este cliente. Estado diferente para o mesmo bloco: fork.
        //
        // As guardas de cada domínio ficam NO domínio (pausa/blacklist/congelamento
        // do token, morte da aprovação no NFT): uma segunda cópia delas aqui seria
        // uma segunda versão da regra de consenso.
        "TOKEN_TRANSFER" => {
            // A ORDEM das checagens é a de `state.js:479-488`. Só o `amount` é
            // conferido aqui — as guardas do token vivem no domínio e rodam na
            // aplicação, que é onde a referência também as roda.
            let token = texto(op.get("token")).unwrap_or("").to_string();
            if !state.tokens.contains_key(&token) {
                return Err(erro("token inexistente"));
            }
            let to = texto(op.get("to")).unwrap_or("").to_string();
            let amount = como_amount(op.get("amount")).ok_or_else(|| erro("valor deve ser positivo"))?;
            if amount == 0 {
                return Err(erro("valor deve ser positivo"));
            }
            if !is_valid_address(&to) {
                return Err(erro("destino inválido"));
            }
            Ok(OpResolvida::TokenTransfer { token, to, amount })
        }
        "NFT_TRANSFER" => {
            // `String(op.tokenId)` da referência: o id do NFT é chave de mapa e
            // pode chegar como número — a coerção tem de ser a mesma, senão o item
            // "3" e o item 3 viram entradas diferentes.
            let colecao = texto(op.get("collection")).unwrap_or("").to_string();
            let token_id = crate::state::nft::js_string(op.get("tokenId"));
            let to = texto(op.get("to")).unwrap_or("").to_string();
            Ok(OpResolvida::NftTransfer { colecao, token_id, to })
        }
        "VOTE" if v2 => Ok(OpResolvida::Vote {
            votos: op.get("votes").cloned().unwrap_or(JsonValue::Null),
        }),
        "CLAIM_VOTER_REWARD" if v2 => {
            let validador = texto(op.get("validator")).unwrap_or("").to_string();
            if !is_valid_address(&validador) {
                return Err(erro("validador inválido"));
            }
            // `(this.votes[account]?.[op.validator] ?? null) === null` (state.js:507):
            // sem voto naquele validador não há dívida a liquidar, e resgatar
            // mesmo assim creditaria a partir de um acumulador que não é do eleitor.
            if state.votes.get(account).and_then(|m| m.get(&validador)).is_none() {
                return Err(erro("você não vota nesse validador"));
            }
            Ok(OpResolvida::ClaimVoterReward { validador })
        }
        "GOV_PROPOSE" if v2 => {
            if height < GOVERNANCE_HEIGHT {
                return Err(erro("governança ainda não ativa"));
            }
            if !validadores(state, None)?.iter().any(|v| v == account) {
                return Err(erro("só validador ativo pode propor"));
            }
            let param = texto(op.get("param")).unwrap_or("").to_string();
            let value = resolver_valor_gov(state, &param, op.get("value"), height)?;
            let vb = match op.get("votingBlocks") {
                None | Some(JsonValue::Null) => GOV_MAX_VOTING_BLOCKS,
                outro => como_u64(outro).ok_or_else(|| erro("votingBlocks inválido"))?,
            };
            if vb == 0 || vb > GOV_MAX_VOTING_BLOCKS {
                return Err(erro("votingBlocks inválido"));
            }
            Ok(OpResolvida::GovPropose { param, value, voting_blocks: vb })
        }
        "GOV_VOTE" if v2 => {
            if height < GOVERNANCE_HEIGHT {
                return Err(erro("governança ainda não ativa"));
            }
            let proposal_id = texto(op.get("proposalId")).unwrap_or("").to_string();
            let p = state
                .proposals
                .get(&proposal_id)
                .filter(|p| p.state == "VOTING")
                .ok_or_else(|| erro("proposta inexistente ou encerrada"))?;
            if height > p.deadline {
                return Err(erro("proposta expirada"));
            }
            if !validadores(state, None)?.iter().any(|v| v == account) {
                return Err(erro("só validador ativo pode votar"));
            }
            if p.votes.contains_key(account) {
                return Err(erro("validador já votou nesta proposta"));
            }
            Ok(OpResolvida::GovVote { proposal_id })
        }
        outro => Err(erro(format!("tipo de operação multisig não suportado: {outro}"))),
    }
}

/// Aplica uma operação já validada. Toda aritmética aqui foi conferida na fase de
/// validação; os `checked_*` permanecem porque um pânico num nó de consenso é
/// vetor de DoS, não um detalhe de estilo.
fn aplicar_op(
    state: &mut State,
    account: &str,
    op: OpResolvida,
    height: u64,
    op_id: Option<&str>,
) -> R<()> {
    match op {
        OpResolvida::Transfer { to, amount } => {
            state.debitar(account, amount)?;
            state.creditar(&to, amount)?;
        }
        OpResolvida::Stake { amount } => {
            state.debitar(account, amount)?;
            let c = state.account_mut(account);
            c.staked = c.staked.checked_add(amount).ok_or_else(|| erro("estouro de stake"))?;
        }
        OpResolvida::Unstake { amount } => {
            let c = state.account_mut(account);
            c.staked = c.staked.checked_sub(amount).ok_or_else(|| erro("stake insuficiente"))?;
            let matura = height
                .checked_add(UNBONDING_BLOCKS)
                .ok_or_else(|| erro("estouro de altura no unbonding"))?;
            state.unbonding.push((account.to_string(), amount, matura));
        }
        OpResolvida::SetCommission { pct } => {
            let em = height
                .checked_add(COMMISSION_DELAY_BLOCKS)
                .ok_or_else(|| erro("estouro de altura na comissão"))?;
            state.pending_commission.insert(account.to_string(), (pct, em));
        }
        OpResolvida::TokenTransfer { token, to, amount } => {
            // O MESMO efeito do META_TX: as guardas do token e a ausência de taxa
            // valem igual nos dois caminhos (state.js:604 e state.js:481 chamam o
            // mesmo `#tokenGuard`/`#tokenAvailable`). Dois efeitos separados seriam
            // duas versões da mesma regra.
            crate::state::token::efeito_meta_transfer(state, &token, account, &to, amount, height)?;
        }
        OpResolvida::NftTransfer { colecao, token_id, to } => {
            crate::state::nft::efeito_multisig_transfer(state, &colecao, &token_id, account, &to)?;
        }
        OpResolvida::Vote { votos } => {
            crate::state::value::aplicar_voto(state, account, Some(&votos))?;
        }
        OpResolvida::ClaimVoterReward { validador } => {
            crate::state::value::liquidar_recompensa(state, account, &validador)?;
        }
        OpResolvida::PermissionChange { perm } => {
            match perm {
                None => state.permissions.remove(account),
                Some(p) => state.permissions.insert(account.to_string(), p),
            };
            // Invalida ops pendentes desta conta: foram aprovadas sob a permissão
            // ANTIGA (pesos e limiar), que não vale mais. Devem ser repropostas.
            let mortas: Vec<String> = state
                .pending_ops
                .iter()
                .filter(|(_, p)| p.account == account)
                .map(|(id, _)| id.clone())
                .collect();
            for id in mortas {
                state.pending_ops.remove(&id);
            }
        }
        OpResolvida::GovPropose { param, value, voting_blocks } => {
            let id = op_id.ok_or_else(|| erro("GOV_PROPOSE multisig sem opId"))?.to_string();
            gravar_proposta_gov(
                state,
                account,
                &param,
                value,
                voting_blocks,
                height,
                id,
                0,
            )?;
        }
        OpResolvida::GovVote { proposal_id } => {
            aplicar_voto_gov(state, account, &proposal_id, height)?;
        }
    }
    Ok(())
}

/// Resolve o `value` de uma proposta de governança (mesmo critério de `gov_propose`).
fn resolver_valor_gov(
    _state: &State,
    param: &str,
    raw: Option<&JsonValue>,
    height: u64,
) -> R<ValorGov> {
    match param {
        "BRIDGE_COMMITTEE" => validar_comite(raw),
        "TREASURY_SPEND" => validar_gasto_tesouraria(raw),
        "AI_ATTESTER" => {
            if height < AI_TEE_HEIGHT {
                return Err(erro("atestação de IA (Fase 6) ainda não ativa"));
            }
            validar_atestador(raw)
        }
        outro => {
            let spec =
                especificacao(outro).ok_or_else(|| erro(format!("parâmetro não governável: {outro}")))?;
            coagir_valor_gov(&spec, raw)
        }
    }
}

fn gravar_proposta_gov(
    state: &mut State,
    proposer: &str,
    param: &str,
    value: ValorGov,
    voting_blocks: u64,
    height: u64,
    id: String,
    created_at: i64,
) -> R<()> {
    let deadline = height
        .checked_add(voting_blocks)
        .ok_or_else(|| erro("estouro de altura na janela de votação"))?;
    let mut votos = BTreeMap::new();
    votos.insert(proposer.to_string(), true);
    let execute_at = apurar(state, &votos, height)?;
    state.proposals.insert(
        id.clone(),
        Proposal {
            id,
            param: param.to_string(),
            value,
            proposer: proposer.to_string(),
            votes: votos,
            deadline,
            execute_at,
            created_at,
            state: if execute_at.is_some() { "QUEUED".into() } else { "VOTING".into() },
        },
    );
    Ok(())
}

fn aplicar_voto_gov(state: &mut State, voter: &str, proposal_id: &str, height: u64) -> R<()> {
    let mut votos = state.proposals[proposal_id].votes.clone();
    votos.insert(voter.to_string(), true);
    let execute_at = apurar(state, &votos, height)?;
    let p = state.proposals.get_mut(proposal_id).expect("verificado na validação");
    p.votes = votos;
    if let Some(at) = execute_at {
        p.execute_at = Some(at);
        p.state = "QUEUED".into();
    }
    Ok(())
}

fn multisig_propose(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < PERMISSIONS_HEIGHT {
        return Err(erro("permissões ainda não ativas"));
    }
    let d = dados(tx)?;
    let account = texto(d.get("account")).unwrap_or("").to_string();
    if !is_valid_address(&account) {
        return Err(erro("conta multisig inválida"));
    }
    let perm = state.permissions.get(&account).ok_or_else(|| erro("conta não é multisig"))?;

    let Some(JsonValue::Map(op)) = d.get("op") else {
        return Err(erro("operação inválida"));
    };
    let op_type = texto(op.get("type")).ok_or_else(|| erro("operação inválida"))?.to_string();

    // Ops de poder forçam owner (plano 14). Demais: active por permissionId.
    let permission_id = if exige_owner(&op_type) {
        if !e_v2(perm) {
            return Err(erro("GOV/comissão multisig exige permissões v2 com owner"));
        }
        OWNER_PERMISSION_ID
    } else {
        match d.get("permissionId") {
            None | Some(JsonValue::Null) => 0u64,
            outro => como_u64(outro).ok_or_else(|| erro("permissionId inválido"))?,
        }
    };
    let gasto = nivel_de_gasto(perm, permission_id).ok_or_else(|| {
        if permission_id == OWNER_PERMISSION_ID {
            erro("owner inexistente nesta conta")
        } else {
            erro(format!("permissão active {permission_id} inexistente"))
        }
    })?;
    let peso = *gasto.nivel.keys.get(&tx.from).ok_or_else(|| {
        if permission_id == OWNER_PERMISSION_ID {
            erro("remetente não é chave do owner (witness/active não autoriza gov)")
        } else {
            erro("remetente não é uma chave autorizada da conta")
        }
    })?;

    // Conta v2 troca permissão SÓ pelo caminho com timelock e veto. Sem este
    // bloqueio, uma `active` de limiar 1 reconfiguraria a conta na hora — o
    // timelock, o veto e a recuperação viram enfeite e o desenho inteiro cai.
    if op_type == "PERMISSION_CHANGE" && e_v2(perm) {
        return Err(erro("conta v2: altere permissões via PERMISSION_PROPOSE/APPROVE"));
    }
    // ESCOPO: `operations` ausente = tudo liberado. Owner não tem escopo.
    if let Some(escopo) = gasto.operations
        && !escopo.contains(&op_type)
    {
        return Err(erro(format!("operação fora do escopo desta permissão: {op_type}")));
    }

    let limiar = gasto.nivel.threshold;
    let quorum_imediato = peso >= limiar;
    // Valida a operação ANTES de cobrar a taxa: uma op inválida não pode deixar
    // taxa cobrada nem pendência gravada.
    let resolvida =
        if quorum_imediato { Some(validar_op(state, &account, op, ctx.height)?) } else { None };
    let deadline = ctx
        .height
        .checked_add(MULTISIG_OP_TTL_BLOCKS)
        .ok_or_else(|| erro("estouro de altura no TTL da operação"))?;
    let id = id_da_tx(tx)?.to_string();

    cobrar_taxa(state, tx, ctx)?;
    match resolvida {
        Some(op) => aplicar_op(state, &account, op, ctx.height, Some(id.as_str()))?,
        None => {
            let mut approvals = BTreeMap::new();
            approvals.insert(tx.from.clone(), peso);
            // O `permissionId` fica guardado: a APROVAÇÃO tem de contar peso na MESMA
            // permissão, senão chaves de níveis diferentes somariam para um limiar
            // que não é o delas.
            state.pending_ops.insert(
                id,
                PendingOp {
                    account,
                    // O CORPO inteiro, cru: é ele que a aprovação vai executar.
                    op: op.clone(),
                    approvals,
                    weight: peso,
                    permission_id,
                    created_at: tx.timestamp,
                    deadline,
                },
            );
        }
    }
    Ok(())
}

fn multisig_approve(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < PERMISSIONS_HEIGHT {
        return Err(erro("permissões ainda não ativas"));
    }
    let d = dados(tx)?;
    let op_id = texto(d.get("opId")).unwrap_or("").to_string();
    let pending = state
        .pending_ops
        .get(&op_id)
        .ok_or_else(|| erro("operação pendente inexistente"))?;
    let conta = pending.account.clone();
    // O corpo é clonado porque a execução precisa de `&mut State`, e ele vive
    // DENTRO do estado. Clonar aqui é o que permite validar contra o estado atual
    // antes de qualquer mutação.
    let corpo = pending.op.clone();
    let tipo_op = pending.op_type().unwrap_or("").to_string();
    // Permissão pode ter mudado sob a operação — reconferir é obrigatório.
    let perm = state.permissions.get(&conta).ok_or_else(|| erro("conta não é mais multisig"))?;
    let gasto = nivel_de_gasto(perm, pending.permission_id)
        .ok_or_else(|| erro("permissão active da operação não existe mais"))?;
    let peso = *gasto
        .nivel
        .keys
        .get(&tx.from)
        .ok_or_else(|| erro("remetente não é uma chave autorizada da conta"))?;
    // Dedup por ENDEREÇO. Ver a nota em `permission_approve`.
    if pending.approvals.contains_key(&tx.from) {
        return Err(erro("chave já aprovou esta operação"));
    }
    let novo_peso = pending
        .weight
        .checked_add(peso)
        .ok_or_else(|| erro("estouro no peso das aprovações"))?;
    let atingiu = novo_peso >= gasto.nivel.threshold;
    // Reconfere o escopo VIGENTE: a permissão pode ter mudado entre propor e
    // completar o limiar, e a operação não pode escapar do escopo atual.
    let fora_do_escopo =
        atingiu && gasto.operations.is_some_and(|escopo| !escopo.contains(&tipo_op));

    if fora_do_escopo {
        return Err(erro(format!("operação fora do escopo desta permissão: {tipo_op}")));
    }

    // FASE DE VALIDAÇÃO: resolve a operação contra o estado ATUAL, sem mutar. Se
    // algo aqui falhar, nem a taxa foi cobrada nem a pendência foi tocada.
    let resolvida =
        if atingiu { Some(validar_op(state, &conta, &corpo, ctx.height)?) } else { None };

    cobrar_taxa(state, tx, ctx)?;
    match resolvida {
        // Limiar cruzado: a referência executa e REMOVE a pendência
        // (`state.js:1644-1645`). A remoção vem antes da aplicação porque a própria
        // operação pode mexer em `pending_ops` (um `PERMISSION_CHANGE` invalida as
        // ops da conta) e a ordem inversa poderia ressuscitar esta.
        Some(op) => {
            state.pending_ops.remove(&op_id);
            aplicar_op(state, &conta, op, ctx.height, Some(op_id.as_str()))?;
        }
        None => {
            let pending = state.pending_ops.get_mut(&op_id).expect("verificado acima");
            pending.approvals.insert(tx.from.clone(), peso);
            pending.weight = novo_peso;
        }
    }
    Ok(())
}

// ------------------------------------------------------------------- meta-tx

/// Reconstrói uma transação a partir do JSON aninhado em `data.inner`.
fn tx_de_json(v: Option<&JsonValue>) -> R<Tx> {
    let Some(JsonValue::Map(m)) = v else {
        return Err(erro("inner inválida"));
    };
    let s = |k: &str| texto(m.get(k)).map(|x| x.to_string());
    let obrigatorio = |k: &str| s(k).ok_or_else(|| erro("inner inválida"));
    let inteiro = |k: &str| match m.get(k) {
        Some(JsonValue::Int(n)) => Ok(*n),
        _ => Err(erro("inner inválida")),
    };
    Ok(Tx {
        protocol: obrigatorio("protocol")?,
        scheme: obrigatorio("scheme")?,
        tx_type: obrigatorio("type")?,
        from: obrigatorio("from")?,
        to: match m.get("to") {
            Some(JsonValue::Str(a)) => Some(a.clone()),
            _ => None,
        },
        amount: obrigatorio("amount")?,
        fee: obrigatorio("fee")?,
        nonce: inteiro("nonce")?,
        timestamp: inteiro("timestamp")?,
        data: m.get("data").cloned(),
        public_key: s("publicKey"),
        pq_public_key: s("pqPublicKey"),
        signature: s("signature"),
        pq_signature: s("pqSignature"),
        id: s("id"),
    })
}

fn meta_tx(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < META_HEIGHT {
        return Err(erro("meta-transação ainda não ativa"));
    }
    let d = dados(tx)?;
    let inner = tx_de_json(d.get("inner"))?;
    if inner.tx_type == "META_TX" {
        return Err(erro("inner inválida")); // sem aninhamento: seria recursão sem fundo
    }
    verify_transaction(&inner).map_err(|e| erro(format!("inner inválida: {e}")))?;
    // CRÍTICO: uma conta multiassinatura NÃO pode agir por meta-tx — senão qualquer
    // chave burlaria o M-de-N patrocinando uma inner assinada como a conta multisig.
    // Foi um achado de auditoria real: a guarda existia no topo e faltava aqui.
    if state.permissions.contains_key(&inner.from) {
        return Err(erro("conta multisig: opere via MULTISIG_PROPOSE/APPROVE, não por meta-tx"));
    }
    let conta_usuario = state.account(&inner.from);
    let esperado = conta_usuario
        .nonce
        .checked_add(1)
        .ok_or_else(|| erro("estouro de nonce da inner"))?;
    let recebido = u64::try_from(inner.nonce)
        .map_err(|_| erro(format!("nonce da inner inválido (esperado {esperado})")))?;
    if recebido != esperado {
        return Err(erro(format!("nonce da inner inválido (esperado {esperado})")));
    }

    // Efeito patrocinável: a referência cobre TRANSFER e TOKEN_TRANSFER
    // (`#applyMetaEffect`, state.js:593-612). O `TOKEN_TRANSFER` era recusado aqui
    // sob a alegação de que o domínio de token não estava portado — está, e a
    // recusa virou código desligado por um motivo que deixou de existir. O efeito
    // vive em `token::efeito_meta_transfer`, para que as guardas de pausa,
    // blacklist e congelamento não ganhem uma segunda cópia nesta função.
    if inner.tx_type == "TOKEN_TRANSFER" {
        let dados = inner.data.as_ref().and_then(|d| match d {
            JsonValue::Map(m) => Some(m),
            _ => None,
        });
        let token_id = dados
            .and_then(|m| m.get("token"))
            .and_then(|v| match v {
                JsonValue::Str(s) => Some(s.as_str()),
                _ => None,
            })
            .ok_or_else(|| erro("token inexistente"))?;
        let destino = inner.to.as_deref().unwrap_or("");
        let valor: Amount = inner.amount.parse().map_err(|_| erro("valor inválido"))?;
        super::token::efeito_meta_transfer(
            state,
            token_id,
            &inner.from,
            destino,
            valor,
            ctx.height,
        )?;
        // Nonce da inner avança — o patrocinador já pagou a taxa (state.js:1269).
        state.account_mut(&inner.from).nonce = recebido;
        return Ok(());
    }
    if inner.tx_type != "TRANSFER" {
        return Err(erro(format!("tipo não patrocinável via meta-tx: {}", inner.tx_type)));
    }
    let destino = inner.to.as_deref().unwrap_or("");
    if !is_valid_address(destino) {
        return Err(erro("destino inválido"));
    }
    let amount: Amount = inner.amount.parse().map_err(|_| erro("valor deve ser positivo"))?;
    if amount == 0 {
        return Err(erro("valor deve ser positivo"));
    }
    if conta_usuario.balance < amount {
        return Err(erro("saldo insuficiente"));
    }
    state
        .balance_of(destino)
        .checked_add(amount)
        .ok_or_else(|| erro("estouro de saldo no destino"))?;

    // A referência NÃO debita a taxa do relayer neste caso (o `case 'META_TX'` de
    // `state.js` não tem `acc.balance -= fee`, ao contrário de todos os outros).
    // Reproduzido como está: divergir aqui mudaria saldos. Está no relatório como
    // achado — a taxa entra em `totalBurned` sem sair de conta nenhuma.
    state.debitar(&inner.from, amount)?;
    state.creditar(destino, amount)?;
    state.account_mut(&inner.from).nonce = recebido;
    Ok(())
}

// ------------------------------------------------------------------- oráculo

fn oracle_register(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let amount: Amount = tx.amount.parse().map_err(|_| erro("valor inválido"))?;
    let novo = !state.oracles.contains_key(&tx.from);
    // O mínimo vale só no REGISTRO: um aporte adicional pode ser de qualquer valor.
    // A referência usa a constante direta aqui, e NÃO o override governável — apesar
    // de `MIN_ORACLE_STAKE` ser governável em outros pontos. Reproduzido como está.
    if novo && amount < MIN_ORACLE_STAKE {
        return Err(erro(format!("stake mínimo de oráculo é {MIN_ORACLE_STAKE} e7")));
    }
    let total = amount.checked_add(ctx.fee).ok_or_else(|| erro("estouro aritmético na soma"))?;
    if state.balance_of(&tx.from) < total {
        return Err(erro("saldo insuficiente"));
    }
    let stake_atual = state.oracles.get(&tx.from).map(|o| o.stake).unwrap_or(0);
    let novo_stake = stake_atual.checked_add(amount).ok_or_else(|| erro("estouro de stake"))?;
    let registrado_em = u64::try_from(tx.timestamp).map_err(|_| erro("timestamp inválido"))?;

    // Lido ANTES de qualquer mutação: este módulo mantém a invariante de que uma
    // recusa não deixa rastro (ver `toda_rejeicao_deixa_o_estado_identico`), e
    // validar depois de debitar a quebraria.
    //
    // `data` ausente ou nula é caso à parte: a referência escreve
    // `tx.data.endpoint` sem guarda, o que nesses dois valores lança `TypeError` e
    // derruba a transação inteira. Aceitá-la aqui registraria um oráculo que a rede
    // não tem — divergência de consenso, não de conveniência.
    let endpoint: Option<String> = match &tx.data {
        None | Some(JsonValue::Null) => return Err(erro("campo data inválido")),
        // Só TEXTO escreve (`typeof === 'string'`, state.js:2036). Qualquer outro
        // valor não-mapa segue sem escrever: em JavaScript `"txt".endpoint` é
        // `undefined`, não uma exceção.
        Some(JsonValue::Map(d)) => match d.get("endpoint") {
            Some(JsonValue::Str(ep)) => Some(ep.clone()),
            _ => None,
        },
        Some(_) => None,
    };

    state.debitar(&tx.from, total)?;
    // O construtor vem do módulo de IA, dono do tipo: assim o registro nasce com a
    // reputação neutra da referência em vez de um `Default` silencioso.
    let o = state
        .oracles
        .entry(tx.from.clone())
        .or_insert_with(|| super::ai::Oracle::registrado(tx.from.clone(), 0, registrado_em));
    o.stake = novo_stake;
    // Só um `endpoint` que seja TEXTO escreve — a referência testa
    // `typeof tx.data.endpoint === 'string'` (state.js:2036). Número, nulo ou
    // ausente deixam o valor anterior intacto, e não o zeram: um aporte adicional
    // sem `endpoint` não pode apagar o que o registro gravou.
    if let Some(ep) = endpoint {
        o.endpoint = Some(ep);
    }
    Ok(())
}

// ============================================================================
// Maturação por bloco — a parte governança/permissão do `blockTick`
//
// Mora AQUI, e não em `blockchain.rs`, por uma razão estrutural: aplicar uma
// proposta madura e um timelock de permissão exige `validadores`,
// `autoriza_mudanca` e `simular_mudanca` — todos privados deste módulo. Expô-los só
// para o orquestrador chamá-los de fora abriria o encapsulamento que protege o
// invariante "erro não deixa rastro". O `block_tick` só compõe as etapas.
// ============================================================================

/// Extrai `Vec<String>` de um campo que a validação gravou como lista de textos.
/// Silencioso por construção: só a validação constrói estes objetos, então a forma
/// é sempre a esperada — um campo ausente vira lista vazia, nunca pânico.
fn lista_de_textos(m: &BTreeMap<String, JsonValue>, chave: &str) -> Vec<String> {
    match m.get(chave) {
        Some(JsonValue::List(itens)) => itens
            .iter()
            .filter_map(|v| match v {
                JsonValue::Str(s) => Some(s.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Governança madura + poda de propostas — espelha o primeiro laço de
/// `blockTick` (`state.js:733`).
///
/// ORDEM CANÔNICA POR id — decisão de consenso fechada, idêntica nos dois clientes.
/// Quando DUAS propostas maturam no MESMO bloco com efeitos que interferem (mesmo
/// `param` — o último a escrever vence; tesouraria que não cobre os dois
/// `TREASURY_SPEND`; dois overrides de `MIN_VALIDATOR_STAKE`/`MAX_VALIDATORS` cujo
/// trilho anti-trava depende de qual veio antes), a ORDEM de aplicação é observável
/// no estado. O `BTreeMap<String>` itera em ordem de bytes NATIVAMENTE — e a
/// referência foi alinhada a essa mesma ordem (`Object.keys(...).sort()`,
/// `state.js:blockTick`). Para ids hex ASCII, a ordem de bytes do Rust é a mesma
/// ordem de code unit UTF-16 do `.sort()` do JS, então as duas convergem sem
/// depender do frágil detalhe de "ordem de inserção" de nenhuma engine.
pub fn matura_propostas(state: &mut State, height: u64) -> R<()> {
    // `BTreeMap::keys` já entrega a ordem canônica de id. Coletadas antes de mutar:
    // aplicar uma proposta muta OUTROS mapas (params, treasury, comitês,
    // atestadores) e remove desta, então iterar sobre uma cópia das chaves é o que
    // torna a remoção durante o laço segura — e preserva a ordem canônica.
    let ids: Vec<String> = state.proposals.keys().cloned().collect();
    for id in ids {
        let p = &state.proposals[&id];
        let madura = p.state == "QUEUED" && p.execute_at.is_some_and(|e| height >= e);
        let expirada = p.state == "VOTING" && height > p.deadline;
        if madura {
            let (param, value) = (p.param.clone(), p.value.clone());
            aplica_proposta_madura(state, &param, &value, height)?;
            state.proposals.remove(&id); // poda: o registro não é mais necessário
        } else if expirada {
            state.proposals.remove(&id); // expirou sem atingir quórum
        }
    }
    Ok(())
}

/// Aplica UMA proposta cujo timelock venceu. Espelha os quatro ramos de
/// `state.js:735-758`.
fn aplica_proposta_madura(state: &mut State, param: &str, value: &ValorGov, height: u64) -> R<()> {
    match param {
        // BOOTSTRAP APENAS: governança só CRIA o primeiro comitê de uma origem.
        // Trocar um comitê ATIVO exige o handoff assinado pela origem
        // (`BRIDGE_COMMITTEE_UPDATE`) — senão 2/3 dos validadores EAV7 trocariam o
        // comitê por chaves próprias e drenariam a ponte.
        "BRIDGE_COMMITTEE" => {
            if let ValorGov::Objeto(v) = value {
                let sc = match v.get("sourceChain") {
                    Some(JsonValue::Str(s)) => s.clone(),
                    _ => return Ok(()),
                };
                if !state.bridge_source_committees.contains_key(&sc) {
                    let quorum = como_u64(v.get("quorum")).unwrap_or(0);
                    state.bridge_source_committees.insert(
                        sc.clone(),
                        super::bridge::Committee {
                            source_chain: sc,
                            members: lista_de_textos(v, "members"),
                            quorum,
                            epoch: 0,
                        },
                    );
                }
            }
        }
        // Gasta só se a tesouraria cobre; senão a proposta madura simplesmente não
        // tem efeito (a referência faz o mesmo `if this.treasury >= amt`).
        "TREASURY_SPEND" => {
            if let ValorGov::Objeto(v) = value {
                let (Some(JsonValue::Str(amt_s)), Some(JsonValue::Str(dest))) =
                    (v.get("amount"), v.get("recipient"))
                else {
                    return Ok(());
                };
                let amt: Amount = amt_s.parse().map_err(|_| erro("valor de tesouraria inválido"))?;
                if state.treasury >= amt {
                    state.treasury -= amt;
                    state.creditar(dest, amt)?;
                }
            }
        }
        // Fase 6: registra/atualiza o atestador (enclave TEE / verificador zk).
        // `registeredAt` é a ALTURA (`= height`), não timestamp.
        "AI_ATTESTER" => {
            if let ValorGov::Objeto(v) = value {
                let attester_id = match v.get("attesterId") {
                    Some(JsonValue::Str(s)) => s.clone(),
                    _ => return Ok(()),
                };
                let kind = match v.get("kind") {
                    Some(JsonValue::Str(s)) => s.clone(),
                    _ => "TEE".to_string(),
                };
                let measurement = match v.get("measurement") {
                    Some(JsonValue::Str(s)) => s.clone(),
                    _ => String::new(),
                };
                state.ai_attesters.insert(
                    attester_id.clone(),
                    super::ai::Attester {
                        id: attester_id,
                        kind,
                        members: lista_de_textos(v, "members"),
                        quorum: como_u64(v.get("quorum")).unwrap_or(0),
                        measurement,
                        registered_at: height,
                    },
                );
            }
        }
        // Override de parâmetro escalar. Guardado em `params` como o decimal
        // canônico; a folha o codifica com a tag de INTEIRO (ver `leaves.rs`).
        _ => {
            if let ValorGov::Inteiro(d) = value {
                let prev = state.params.get(param).cloned();
                state.params.insert(param.to_string(), d.clone());
                // Trilho anti-brick: uma mudança que ESVAZIARIA o conjunto de
                // validadores (MIN alto demais / MAX 0) travaria a cadeia para
                // sempre — reverte em vez de aplicar. `validadores` já lê o override
                // recém-escrito.
                let esvazia = matches!(param, "MIN_VALIDATOR_STAKE" | "MAX_VALIDATORS")
                    && validadores(state, None).map(|v| v.is_empty()).unwrap_or(true);
                if esvazia {
                    match prev {
                        None => {
                            state.params.remove(param);
                        }
                        Some(anterior) => {
                            state.params.insert(param.to_string(), anterior);
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

/// Remove as operações multiassinatura pendentes cujo prazo venceu
/// (`state.js:765`). A referência guarda `op.deadline !== undefined` como guarda
/// defensiva, mas `MULTISIG_PROPOSE` SEMPRE grava `height + MULTISIG_OP_TTL_BLOCKS`
/// — por isso o tipo é `u64`, não `Option`: não existe op pendente sem prazo.
pub fn expira_ops_multisig(state: &mut State, height: u64) {
    let vencidas: Vec<String> = state
        .pending_ops
        .iter()
        .filter(|(_, op)| height > op.deadline)
        .map(|(id, _)| id.clone())
        .collect();
    for id in vencidas {
        state.pending_ops.remove(&id);
    }
}

/// Aplica as mudanças de permissão v2 cujo timelock venceu (`state.js:772`).
///
/// REVALIDA A AUTORIZAÇÃO no momento de aplicar: as aprovações foram colhidas sob a
/// permissão VIGENTE NA ÉPOCA. Se ela mudou durante o timelock, uma chave já
/// removida não pode continuar valendo — é a mesma classe de furo que a TRON fecha
/// invalidando assinaturas colhidas sob permissão antiga. E revalida o anti-trava,
/// porque o estado pôde mudar durante a espera.
pub fn matura_permissoes(state: &mut State, height: u64) {
    let contas: Vec<String> = state.pending_perm.keys().cloned().collect();
    for conta in contas {
        // A pendência é consumida em QUALQUER desfecho — só depois de saber que o
        // timelock venceu.
        let vencido = match state.pending_perm[&conta].execute_at {
            None => false,             // timelock ainda não iniciado
            Some(e) => height >= e,
        };
        if !vencido {
            continue;
        }
        let pend = state.pending_perm.remove(&conta).expect("acabou de existir");
        // A permissão pode ter deixado de ser v2 no meio do caminho.
        let Some(perm) = state.permissions.get(&conta).cloned() else {
            continue;
        };
        if !matches!(perm, Permission::V2 { .. }) {
            continue;
        }
        let signers: BTreeSet<String> = pend.approvals.keys().cloned().collect();
        if !autoriza_mudanca(&perm, &pend.change, &signers) {
            continue; // as aprovações não bastam mais sob a permissão atual
        }
        // `simular_mudanca` revalida o anti-trava; se a mudança inutilizaria a
        // conta agora, é descartada e a permissão vigente permanece.
        if let Ok(nova) = simular_mudanca(&perm, &pend.change) {
            state.permissions.insert(conta.clone(), nova);
            // Ops multisig aprovadas sob a permissão ANTIGA não valem mais.
            let ops: Vec<String> = state
                .pending_ops
                .iter()
                .filter(|(_, p)| p.account == conta)
                .map(|(id, _)| id.clone())
                .collect();
            for id in ops {
                state.pending_ops.remove(&id);
            }
        }
    }
}

// ============================================================================
// Testes
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::address::derive_address_from;
    use crate::state::Account;

    fn end(semente: &str) -> String {
        derive_address_from(format!("TESTE:{semente}"))
    }

    fn ctx(height: u64) -> Ctx {
        Ctx { height, block_ts: 1_700_000_000_000, fee: 0 }
    }

    fn tx_com(tipo: &str, from: &str, data: Vec<(&str, JsonValue)>) -> Tx {
        let mut tx = Tx::new(tipo, from, 1, 1_700_000_000_000);
        tx.data = Some(JsonValue::map(
            data.into_iter().map(|(k, v)| (k.to_string(), v)),
        ));
        tx.id = Some(format!("id-{tipo}-{from}"));
        tx
    }

    fn perm_v1(chaves: &[(&str, i64)], limiar: i64) -> JsonValue {
        JsonValue::map([
            ("threshold".into(), JsonValue::Int(limiar)),
            (
                "keys".into(),
                JsonValue::map(chaves.iter().map(|(a, w)| (a.to_string(), JsonValue::Int(*w)))),
            ),
        ])
    }

    /// Conta com stake suficiente para ser validador ativo.
    fn com_validador(state: &mut State, addr: &str) {
        state.accounts.insert(
            addr.to_string(),
            Account { balance: 10 * UNIT, staked: MIN_VALIDATOR_STAKE, ..Default::default() },
        );
    }

    // ---------------------------------------------------------------- governança

    #[test]
    fn gov_propose_abaixo_do_fork_e_recusado() {
        let mut s = State::new();
        let v = end("v1");
        com_validador(&mut s, &v);
        let tx = tx_com(
            "GOV_PROPOSE",
            &v,
            vec![("param", JsonValue::str("TREASURY_PCT")), ("value", JsonValue::Int(10))],
        );
        let e = aplicar(&mut s, &tx, &ctx(GOVERNANCE_HEIGHT - 1)).unwrap_err();
        assert!(e.0.contains("ainda não ativa"));
        assert!(s.proposals.is_empty());
    }

    #[test]
    fn gov_propose_de_validador_unico_atinge_quorum_na_hora() {
        let mut s = State::new();
        let v = end("v1");
        com_validador(&mut s, &v);
        let tx = tx_com(
            "GOV_PROPOSE",
            &v,
            vec![("param", JsonValue::str("TREASURY_PCT")), ("value", JsonValue::Int(10))],
        );
        aplicar(&mut s, &tx, &ctx(GOVERNANCE_HEIGHT)).unwrap();
        let p = &s.proposals[tx.id.as_deref().unwrap()];
        assert_eq!(p.state, "QUEUED");
        assert_eq!(p.execute_at, Some(GOVERNANCE_HEIGHT + GOV_TIMELOCK_BLOCKS));
        // Escalar: guardado como INTEIRO, que é o que a referência codifica.
        assert_eq!(p.value, ValorGov::Inteiro("10".into()));
        assert_eq!(p.created_at, tx.timestamp);
    }

    #[test]
    fn gov_propose_recusa_nao_validador_e_parametro_nao_governavel() {
        let mut s = State::new();
        let v = end("v1");
        com_validador(&mut s, &v);
        let intruso = end("intruso");
        s.accounts.insert(intruso.clone(), Account { balance: UNIT, ..Default::default() });

        let tx = tx_com(
            "GOV_PROPOSE",
            &intruso,
            vec![("param", JsonValue::str("TREASURY_PCT")), ("value", JsonValue::Int(10))],
        );
        assert!(aplicar(&mut s, &tx, &ctx(GOVERNANCE_HEIGHT)).unwrap_err().0.contains("validador"));

        let tx = tx_com(
            "GOV_PROPOSE",
            &v,
            vec![("param", JsonValue::str("QUALQUER")), ("value", JsonValue::Int(1))],
        );
        assert!(aplicar(&mut s, &tx, &ctx(GOVERNANCE_HEIGHT))
            .unwrap_err()
            .0
            .contains("não governável"));
        assert!(s.proposals.is_empty(), "rejeição não pode gravar proposta");
    }

    #[test]
    fn gov_propose_recusa_valor_fora_dos_limites() {
        let mut s = State::new();
        let v = end("v1");
        com_validador(&mut s, &v);
        let tx = tx_com(
            "GOV_PROPOSE",
            &v,
            vec![("param", JsonValue::str("TREASURY_PCT")), ("value", JsonValue::Int(51))],
        );
        assert!(aplicar(&mut s, &tx, &ctx(GOVERNANCE_HEIGHT)).unwrap_err().0.contains("limites"));
    }

    #[test]
    fn gov_vote_conta_e_atinge_quorum_de_dois_tercos_mais_um() {
        let mut s = State::new();
        let vs: Vec<String> = (0..4).map(|i| end(&format!("val{i}"))).collect();
        for v in &vs {
            com_validador(&mut s, v);
        }
        // 4 validadores → quórum = floor(8/3)+1 = 3.
        let prop = tx_com(
            "GOV_PROPOSE",
            &vs[0],
            vec![("param", JsonValue::str("MAX_VALIDATORS")), ("value", JsonValue::Int(21))],
        );
        aplicar(&mut s, &prop, &ctx(GOVERNANCE_HEIGHT)).unwrap();
        let pid = prop.id.clone().unwrap();
        assert_eq!(s.proposals[&pid].state, "VOTING");

        for (i, v) in vs.iter().enumerate().skip(1).take(2) {
            let tx = tx_com("GOV_VOTE", v, vec![("proposalId", JsonValue::str(&pid))]);
            aplicar(&mut s, &tx, &ctx(GOVERNANCE_HEIGHT + i as u64)).unwrap();
        }
        assert_eq!(s.proposals[&pid].state, "QUEUED");
    }

    #[test]
    fn gov_vote_recusa_voto_duplicado_e_proposta_expirada() {
        let mut s = State::new();
        let vs: Vec<String> = (0..4).map(|i| end(&format!("val{i}"))).collect();
        for v in &vs {
            com_validador(&mut s, v);
        }
        let prop = tx_com(
            "GOV_PROPOSE",
            &vs[0],
            vec![
                ("param", JsonValue::str("MAX_VALIDATORS")),
                ("value", JsonValue::Int(21)),
                ("votingBlocks", JsonValue::Int(10)),
            ],
        );
        aplicar(&mut s, &prop, &ctx(GOVERNANCE_HEIGHT)).unwrap();
        let pid = prop.id.clone().unwrap();

        let dup = tx_com("GOV_VOTE", &vs[0], vec![("proposalId", JsonValue::str(&pid))]);
        assert!(aplicar(&mut s, &dup, &ctx(GOVERNANCE_HEIGHT)).unwrap_err().0.contains("já votou"));

        let tarde = tx_com("GOV_VOTE", &vs[1], vec![("proposalId", JsonValue::str(&pid))]);
        assert!(aplicar(&mut s, &tarde, &ctx(GOVERNANCE_HEIGHT + 11))
            .unwrap_err()
            .0
            .contains("expirada"));
        assert_eq!(s.proposals[&pid].votes.len(), 1, "rejeição não pode registrar voto");
    }

    #[test]
    fn gov_propose_de_gasto_de_tesouraria_guarda_o_objeto() {
        let mut s = State::new();
        let v = end("v1");
        com_validador(&mut s, &v);
        let dest = end("dest");
        let tx = tx_com(
            "GOV_PROPOSE",
            &v,
            vec![
                ("param", JsonValue::str("TREASURY_SPEND")),
                (
                    "value",
                    JsonValue::map([
                        ("recipient".into(), JsonValue::str(&dest)),
                        ("amount".into(), JsonValue::str("1000")),
                    ]),
                ),
            ],
        );
        aplicar(&mut s, &tx, &ctx(GOVERNANCE_HEIGHT)).unwrap();
        let p = &s.proposals[tx.id.as_deref().unwrap()];
        // A referência guarda um OBJETO (`state.js:708`), com `amount` em TEXTO.
        assert_eq!(
            p.value,
            ValorGov::Objeto(BTreeMap::from([
                ("amount".to_string(), JsonValue::str("1000")),
                ("recipient".to_string(), JsonValue::str(&dest)),
            ]))
        );
    }

    // ---------------------------------------------------------------- permissões

    #[test]
    fn permission_update_v1_configura_a_conta() {
        let mut s = State::new();
        let dono = end("dono");
        let k1 = end("k1");
        let k2 = end("k2");
        s.accounts.insert(dono.clone(), Account { balance: UNIT, ..Default::default() });
        let tx = tx_com(
            "PERMISSION_UPDATE",
            &dono,
            vec![("permission", perm_v1(&[(&k1, 1), (&k2, 1)], 2))],
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT)).unwrap();
        let Permission::V1(n) = &s.permissions[&dono] else { panic!("esperava v1") };
        assert_eq!(n.threshold, 2);
        assert_eq!(n.keys.len(), 2);
    }

    #[test]
    fn ataque_soma_dos_pesos_abaixo_do_limiar_trava_a_conta_e_e_recusada() {
        // Sem esta checagem a conta ficaria PERMANENTEMENTE inoperante, com os
        // fundos dentro e nenhum conjunto de assinaturas capaz de atingir o limiar.
        let mut s = State::new();
        let dono = end("dono");
        let k1 = end("k1");
        s.accounts.insert(dono.clone(), Account { balance: UNIT, ..Default::default() });
        let tx = tx_com(
            "PERMISSION_UPDATE",
            &dono,
            vec![("permission", perm_v1(&[(&k1, 1)], 5))],
        );
        let e = aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT)).unwrap_err();
        assert!(e.0.contains("soma dos pesos"));
        assert!(s.permissions.is_empty(), "rejeição não pode configurar a conta");
    }

    #[test]
    fn permission_update_recusa_conta_com_stake_antes_do_fork_v2() {
        let mut s = State::new();
        let dono = end("dono");
        let k1 = end("k1");
        s.accounts
            .insert(dono.clone(), Account { balance: UNIT, staked: 1, ..Default::default() });
        let tx = tx_com("PERMISSION_UPDATE", &dono, vec![("permission", perm_v1(&[(&k1, 1)], 1))]);
        assert!(aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT)).unwrap_err().0.contains("stake"));
        // Acima do fork v2 a trava cai — é o que libera validador a ter `witness`.
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap();
        assert!(s.permissions.contains_key(&dono));
    }

    fn perm_v2_json(owner: &[(&str, i64)], ow_lim: i64, active: &[(&str, i64)], ac_lim: i64, recovery: Option<&str>) -> JsonValue {
        let mut m = BTreeMap::new();
        m.insert("owner".to_string(), perm_v1(owner, ow_lim));
        m.insert("active".to_string(), perm_v1(active, ac_lim));
        m.insert("delayBlocks".to_string(), JsonValue::Int(PERM_DELAY_MIN_BLOCKS as i64));
        if let Some(r) = recovery {
            m.insert("recovery".to_string(), JsonValue::str(r));
        }
        JsonValue::Map(m)
    }

    /// Cenário-base: conta v2 com owner 2-de-2, active 1-de-1 e recovery.
    fn cenario_v2() -> (State, String, String, String, String, String) {
        let mut s = State::new();
        let conta = end("cofre");
        let o1 = end("owner1");
        let o2 = end("owner2");
        let a1 = end("active1");
        let rec = end("recovery");
        for a in [&conta, &o1, &o2, &a1, &rec] {
            s.accounts.insert(a.clone(), Account { balance: 100 * UNIT, ..Default::default() });
        }
        let tx = tx_com(
            "PERMISSION_UPDATE",
            &conta,
            vec![(
                "permission",
                perm_v2_json(&[(&o1, 1), (&o2, 1)], 2, &[(&a1, 1)], 1, Some(&rec)),
            )],
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap();
        (s, conta, o1, o2, a1, rec)
    }

    fn tx_perm(tipo: &str, from: &str, conta: &str, change: Option<JsonValue>) -> Tx {
        let mut campos = vec![("account", JsonValue::str(conta))];
        if let Some(c) = change {
            campos.push(("change", c));
        }
        tx_com(tipo, from, campos)
    }

    fn mudanca_owner(chaves: &[(&str, i64)], limiar: i64) -> JsonValue {
        JsonValue::map([
            ("level".into(), JsonValue::str("owner")),
            ("value".into(), perm_v1(chaves, limiar)),
        ])
    }

    #[test]
    fn permission_update_v2_configura_niveis() {
        let (s, conta, _, _, a1, rec) = cenario_v2();
        let Permission::V2 { actives, recovery, delay_blocks, .. } = &s.permissions[&conta] else {
            panic!("esperava v2")
        };
        assert_eq!(actives.len(), 1);
        assert_eq!(actives[0].nivel.keys[&a1], 1);
        assert_eq!(recovery.as_deref(), Some(rec.as_str()));
        assert_eq!(*delay_blocks, PERM_DELAY_MIN_BLOCKS);
    }

    #[test]
    fn recuperacao_exige_active_primaria_mais_recovery() {
        let (mut s, conta, _, _, a1, rec) = cenario_v2();
        let novo = end("owner_novo");
        let h = PERMISSIONS_V2_HEIGHT;

        // A `active` sozinha PROPÕE, mas não inicia o timelock: falta o recovery.
        let tx = tx_perm("PERMISSION_PROPOSE", &a1, &conta, Some(mudanca_owner(&[(&novo, 1)], 1)));
        aplicar(&mut s, &tx, &ctx(h)).unwrap();
        assert_eq!(s.pending_perm[&conta].execute_at, None, "timelock não pode iniciar sem o recovery");

        // O recovery completa — e só então o relógio começa a correr.
        let tx = tx_perm("PERMISSION_APPROVE", &rec, &conta, None);
        aplicar(&mut s, &tx, &ctx(h + 1)).unwrap();
        assert_eq!(s.pending_perm[&conta].execute_at, Some(h + 1 + PERM_DELAY_MIN_BLOCKS));
    }

    #[test]
    fn ataque_recovery_agindo_sozinho_nao_inicia_o_timelock() {
        // Ladrão que roubou SÓ a chave de recuperação não consegue nada: ela não
        // tem poder próprio, apenas completa a active.
        let (mut s, conta, _, _, _, rec) = cenario_v2();
        let novo = end("owner_ladrao");
        let tx = tx_perm("PERMISSION_PROPOSE", &rec, &conta, Some(mudanca_owner(&[(&novo, 1)], 1)));
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap();
        assert_eq!(s.pending_perm[&conta].execute_at, None);
    }

    #[test]
    fn ataque_veto_exige_o_limiar_do_owner_nao_uma_chave_sozinha() {
        // O vetor: um ladrão com UMA das duas chaves de owner bloquearia a
        // recuperação legítima para sempre se o veto valesse por chave isolada.
        let (mut s, conta, o1, o2, a1, rec) = cenario_v2();
        let novo = end("owner_novo");
        let h = PERMISSIONS_V2_HEIGHT;
        aplicar(
            &mut s,
            &tx_perm("PERMISSION_PROPOSE", &a1, &conta, Some(mudanca_owner(&[(&novo, 1)], 1))),
            &ctx(h),
        )
        .unwrap();
        aplicar(&mut s, &tx_perm("PERMISSION_APPROVE", &rec, &conta, None), &ctx(h)).unwrap();

        // Uma chave de owner veta: a pendência SOBREVIVE (limiar do owner é 2).
        aplicar(&mut s, &tx_perm("PERMISSION_VETO", &o1, &conta, None), &ctx(h + 1)).unwrap();
        assert!(s.pending_perm.contains_key(&conta), "uma chave não pode vetar sozinha");
        assert_eq!(s.pending_perm[&conta].vetoes.len(), 1);

        // A segunda chave completa o limiar e a pendência cai.
        aplicar(&mut s, &tx_perm("PERMISSION_VETO", &o2, &conta, None), &ctx(h + 2)).unwrap();
        assert!(!s.pending_perm.contains_key(&conta));
    }

    #[test]
    fn ataque_veto_repetido_pela_mesma_chave_nao_soma_peso() {
        let (mut s, conta, o1, _, a1, _) = cenario_v2();
        let novo = end("owner_novo");
        let h = PERMISSIONS_V2_HEIGHT;
        aplicar(
            &mut s,
            &tx_perm("PERMISSION_PROPOSE", &a1, &conta, Some(mudanca_owner(&[(&novo, 1)], 1))),
            &ctx(h),
        )
        .unwrap();
        aplicar(&mut s, &tx_perm("PERMISSION_VETO", &o1, &conta, None), &ctx(h)).unwrap();
        // Dedup é por ENDEREÇO — reenviar a mesma chave (ainda que com assinatura
        // em forma alternativa, que é o bug de maleabilidade da TRON) não soma.
        let e = aplicar(&mut s, &tx_perm("PERMISSION_VETO", &o1, &conta, None), &ctx(h + 1))
            .unwrap_err();
        assert!(e.0.contains("já vetado"));
        assert!(s.pending_perm.contains_key(&conta));
    }

    #[test]
    fn ataque_aprovacao_repetida_pela_mesma_chave_e_recusada() {
        let (mut s, conta, _, _, a1, _) = cenario_v2();
        let novo = end("owner_novo");
        let h = PERMISSIONS_V2_HEIGHT;
        aplicar(
            &mut s,
            &tx_perm("PERMISSION_PROPOSE", &a1, &conta, Some(mudanca_owner(&[(&novo, 1)], 1))),
            &ctx(h),
        )
        .unwrap();
        let e = aplicar(&mut s, &tx_perm("PERMISSION_APPROVE", &a1, &conta, None), &ctx(h))
            .unwrap_err();
        assert!(e.0.contains("já aprovado"));
        assert_eq!(s.pending_perm[&conta].approvals.len(), 1);
    }

    #[test]
    fn ataque_repropor_para_renovar_o_timelock_cancela_a_pendencia_anterior() {
        // Uma pendência POR CONTA: re-propor não acumula fila nem renova nada além
        // de si mesma, e o veto encerra o assunto.
        let (mut s, conta, _, _, a1, rec) = cenario_v2();
        let n1 = end("owner_a");
        let n2 = end("owner_b");
        let h = PERMISSIONS_V2_HEIGHT;
        aplicar(
            &mut s,
            &tx_perm("PERMISSION_PROPOSE", &a1, &conta, Some(mudanca_owner(&[(&n1, 1)], 1))),
            &ctx(h),
        )
        .unwrap();
        aplicar(&mut s, &tx_perm("PERMISSION_APPROVE", &rec, &conta, None), &ctx(h)).unwrap();
        assert_eq!(s.pending_perm[&conta].approvals.len(), 2);

        aplicar(
            &mut s,
            &tx_perm("PERMISSION_PROPOSE", &a1, &conta, Some(mudanca_owner(&[(&n2, 1)], 1))),
            &ctx(h + 5),
        )
        .unwrap();
        assert_eq!(s.pending_perm.len(), 1, "no máximo uma pendência estrutural por conta");
        assert_eq!(s.pending_perm[&conta].approvals.len(), 1, "a pendência anterior foi substituída");
        assert_eq!(s.pending_perm[&conta].proposed_at, h + 5);
    }

    #[test]
    fn ataque_estranho_nao_enche_a_fila_alheia() {
        let (mut s, conta, _, _, _, _) = cenario_v2();
        let estranho = end("estranho");
        s.accounts.insert(estranho.clone(), Account { balance: UNIT, ..Default::default() });
        let novo = end("owner_novo");
        let e = aplicar(
            &mut s,
            &tx_perm("PERMISSION_PROPOSE", &estranho, &conta, Some(mudanca_owner(&[(&novo, 1)], 1))),
            &ctx(PERMISSIONS_V2_HEIGHT),
        )
        .unwrap_err();
        assert!(e.0.contains("não participa"));
        assert!(s.pending_perm.is_empty());
    }

    #[test]
    fn config_que_remove_o_unico_caminho_de_gasto_e_recusada_na_proposta() {
        let (mut s, conta, _, _, a1, _) = cenario_v2();
        let remove_active = JsonValue::map([
            ("level".into(), JsonValue::str("active")),
            ("id".into(), JsonValue::Int(0)),
            ("value".into(), JsonValue::Null),
        ]);
        let e = aplicar(
            &mut s,
            &tx_perm("PERMISSION_PROPOSE", &a1, &conta, Some(remove_active)),
            &ctx(PERMISSIONS_V2_HEIGHT),
        )
        .unwrap_err();
        assert!(e.0.contains("sem active"));
        assert!(s.pending_perm.is_empty());
    }

    #[test]
    fn permission_propose_abaixo_do_fork_v2_e_recusado() {
        let (mut s, conta, _, _, a1, _) = cenario_v2();
        let novo = end("owner_novo");
        let e = aplicar(
            &mut s,
            &tx_perm("PERMISSION_PROPOSE", &a1, &conta, Some(mudanca_owner(&[(&novo, 1)], 1))),
            &ctx(PERMISSIONS_V2_HEIGHT - 1),
        )
        .unwrap_err();
        assert!(e.0.contains("v2 ainda não ativas"));
    }

    #[test]
    fn troca_de_active_e_de_delay_exigem_o_limiar_do_owner() {
        let (mut s, conta, o1, o2, _, _) = cenario_v2();
        let h = PERMISSIONS_V2_HEIGHT;
        let nova_active = end("active2");
        let mudanca = JsonValue::map([
            ("level".into(), JsonValue::str("active")),
            ("id".into(), JsonValue::Int(0)),
            ("value".into(), perm_v1(&[(&nova_active, 1)], 1)),
        ]);
        aplicar(&mut s, &tx_perm("PERMISSION_PROPOSE", &o1, &conta, Some(mudanca)), &ctx(h))
            .unwrap();
        assert_eq!(s.pending_perm[&conta].execute_at, None, "uma chave de owner não basta (limiar 2)");
        aplicar(&mut s, &tx_perm("PERMISSION_APPROVE", &o2, &conta, None), &ctx(h + 1)).unwrap();
        assert_eq!(s.pending_perm[&conta].execute_at, Some(h + 1 + PERM_DELAY_MIN_BLOCKS));
    }

    // ------------------------------------------------------------ multiassinatura

    #[test]
    fn multisig_propose_com_quorum_imediato_executa_a_transferencia() {
        let mut s = State::new();
        let cofre = end("cofre");
        let k1 = end("k1");
        let dest = end("dest");
        s.accounts.insert(cofre.clone(), Account { balance: 10 * UNIT, ..Default::default() });
        s.accounts.insert(k1.clone(), Account { balance: UNIT, ..Default::default() });
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 1, keys: [(k1.clone(), 1)].into() }),
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &k1,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("TRANSFER")),
                        ("to".into(), JsonValue::str(&dest)),
                        ("amount".into(), JsonValue::str("1000")),
                    ]),
                ),
            ],
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT)).unwrap();
        assert_eq!(s.balance_of(&dest), 1000);
        assert_eq!(s.balance_of(&cofre), 10 * UNIT - 1000);
        assert!(s.pending_ops.is_empty(), "quórum imediato não deixa pendência");
    }

    #[test]
    fn multisig_propose_sem_quorum_enfileira_e_aprovacao_soma_peso() {
        let mut s = State::new();
        let cofre = end("cofre");
        let k1 = end("k1");
        let k2 = end("k2");
        let dest = end("dest");
        s.accounts.insert(cofre.clone(), Account { balance: 10 * UNIT, ..Default::default() });
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 3, keys: [(k1.clone(), 1), (k2.clone(), 1)].into() }),
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &k1,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("TRANSFER")),
                        ("to".into(), JsonValue::str(&dest)),
                        ("amount".into(), JsonValue::str("1000")),
                    ]),
                ),
            ],
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT)).unwrap();
        let op_id = tx.id.clone().unwrap();
        assert_eq!(s.pending_ops[&op_id].weight, 1);
        assert_eq!(s.balance_of(&dest), 0);

        let ap = tx_com("MULTISIG_APPROVE", &k2, vec![("opId", JsonValue::str(&op_id))]);
        aplicar(&mut s, &ap, &ctx(PERMISSIONS_HEIGHT + 1)).unwrap();
        assert_eq!(s.pending_ops[&op_id].weight, 2);
        assert_eq!(s.pending_ops[&op_id].approvals.len(), 2);
    }

    #[test]
    fn ataque_aprovacao_repetida_da_mesma_chave_nao_conta_peso_duas_vezes() {
        // O bug da TRON: assinatura maleável fazia a MESMA chave contar peso duas
        // vezes e cruzar o limiar sozinha. A dedup é por ENDEREÇO.
        let mut s = State::new();
        let cofre = end("cofre");
        let k1 = end("k1");
        let k2 = end("k2");
        let dest = end("dest");
        s.accounts.insert(cofre.clone(), Account { balance: 10 * UNIT, ..Default::default() });
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 2, keys: [(k1.clone(), 1), (k2.clone(), 1)].into() }),
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &k1,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("TRANSFER")),
                        ("to".into(), JsonValue::str(&dest)),
                        ("amount".into(), JsonValue::str("1000")),
                    ]),
                ),
            ],
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT)).unwrap();
        let op_id = tx.id.clone().unwrap();
        let repete = tx_com("MULTISIG_APPROVE", &k1, vec![("opId", JsonValue::str(&op_id))]);
        let e = aplicar(&mut s, &repete, &ctx(PERMISSIONS_HEIGHT + 1)).unwrap_err();
        assert!(e.0.contains("já aprovou"));
        assert_eq!(s.pending_ops[&op_id].weight, 1, "o peso não pode ter mudado");
        assert_eq!(s.balance_of(&dest), 0, "a transferência não pode ter saído");
    }

    #[test]
    fn ataque_conta_v2_nao_troca_permissao_por_multisig_propose() {
        // O vetor mais perigoso do módulo: uma `active` de limiar 1 usando
        // MULTISIG_PROPOSE com PERMISSION_CHANGE reconfiguraria a conta NA HORA,
        // derrubando timelock, veto e recuperação de uma vez.
        let (mut s, conta, _, _, a1, _) = cenario_v2();
        let ladrao = end("ladrao");
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &a1,
            vec![
                ("account", JsonValue::str(&conta)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("PERMISSION_CHANGE")),
                        ("permission".into(), perm_v1(&[(&ladrao, 1)], 1)),
                    ]),
                ),
            ],
        );
        let e = aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap_err();
        assert!(e.0.contains("PERMISSION_PROPOSE"));
        assert!(e_v2(&s.permissions[&conta]), "a permissão não pode ter mudado");
        assert!(s.pending_ops.is_empty());
    }

    #[test]
    fn multisig_propose_em_conta_v2_usa_a_active_e_nao_perm_keys() {
        // Numa conta v2 `perm.keys` é vazio: sem resolver o nível de gasto, a conta
        // recebe fundos e NUNCA gasta.
        let (mut s, conta, _, _, a1, _) = cenario_v2();
        let dest = end("dest");
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &a1,
            vec![
                ("account", JsonValue::str(&conta)),
                ("permissionId", JsonValue::Int(0)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("TRANSFER")),
                        ("to".into(), JsonValue::str(&dest)),
                        ("amount".into(), JsonValue::str("500")),
                    ]),
                ),
            ],
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap();
        assert_eq!(s.balance_of(&dest), 500);
    }

    #[test]
    fn escopo_da_active_barra_operacao_fora_da_lista() {
        let mut s = State::new();
        let conta = end("cofre");
        let a1 = end("active1");
        let o1 = end("owner1");
        let dest = end("dest");
        s.accounts.insert(conta.clone(), Account { balance: 10 * UNIT, ..Default::default() });
        let active = Active {
            nivel: Nivel { threshold: 1, keys: [(a1.clone(), 1)].into() },
            name: None,
            operations: Some(vec!["VOTE".to_string()]),
        };
        s.permissions.insert(
            conta.clone(),
            Permission::V2 {
                owner: Nivel { threshold: 1, keys: [(o1.clone(), 1)].into() },
                actives: vec![active],
                witness: None,
                recovery: None,
                delay_blocks: PERM_DELAY_MIN_BLOCKS,
            },
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &a1,
            vec![
                ("account", JsonValue::str(&conta)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("TRANSFER")),
                        ("to".into(), JsonValue::str(&dest)),
                        ("amount".into(), JsonValue::str("100")),
                    ]),
                ),
            ],
        );
        let e = aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap_err();
        assert!(e.0.contains("fora do escopo"));
        assert_eq!(s.balance_of(&dest), 0);
    }

    #[test]
    fn escopo_nao_pode_conter_permission_change() {
        let mut s = State::new();
        let dono = end("dono");
        let k1 = end("k1");
        let o1 = end("owner1");
        s.accounts.insert(dono.clone(), Account { balance: UNIT, ..Default::default() });
        let active = JsonValue::map([
            ("threshold".into(), JsonValue::Int(1)),
            ("keys".into(), JsonValue::map([(k1.clone(), JsonValue::Int(1))])),
            (
                "operations".into(),
                JsonValue::List(vec![JsonValue::str("PERMISSION_CHANGE")]),
            ),
        ]);
        let tx = tx_com(
            "PERMISSION_UPDATE",
            &dono,
            vec![(
                "permission",
                JsonValue::map([
                    ("owner".into(), perm_v1(&[(&o1, 1)], 1)),
                    ("active".into(), active),
                    ("delayBlocks".into(), JsonValue::Int(PERM_DELAY_MIN_BLOCKS as i64)),
                ]),
            )],
        );
        let e = aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap_err();
        assert!(e.0.contains("não é escopável"));
        assert!(s.permissions.is_empty());
    }

    #[test]
    fn multisig_permission_change_v1_invalida_ops_pendentes_da_conta() {
        let mut s = State::new();
        let cofre = end("cofre");
        let k1 = end("k1");
        let k2 = end("k2");
        let novo = end("novo");
        s.accounts.insert(cofre.clone(), Account { balance: 10 * UNIT, ..Default::default() });
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 1, keys: [(k1.clone(), 1), (k2.clone(), 1)].into() }),
        );
        s.pending_ops.insert(
            "op-antiga".into(),
            PendingOp {
                account: cofre.clone(),
                op: BTreeMap::from([("type".to_string(), JsonValue::str("TRANSFER"))]),
                approvals: BTreeMap::new(),
                weight: 0,
                permission_id: 0,
                created_at: 0,
                deadline: u64::MAX,
            },
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &k1,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("PERMISSION_CHANGE")),
                        ("permission".into(), perm_v1(&[(&novo, 1)], 1)),
                    ]),
                ),
            ],
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT)).unwrap();
        let Permission::V1(n) = &s.permissions[&cofre] else { panic!("esperava v1") };
        assert_eq!(n.keys.len(), 1);
        assert!(s.pending_ops.is_empty(), "ops aprovadas sob a permissão antiga não valem mais");
    }

    #[test]
    fn multisig_abaixo_do_fork_de_permissoes_e_recusado() {
        let mut s = State::new();
        let cofre = end("cofre");
        let k1 = end("k1");
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 1, keys: [(k1.clone(), 1)].into() }),
        );
        let tx = tx_com("MULTISIG_PROPOSE", &k1, vec![("account", JsonValue::str(&cofre))]);
        assert!(aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT - 1))
            .unwrap_err()
            .0
            .contains("ainda não ativas"));
    }

    #[test]
    fn multisig_recusa_chave_nao_autorizada_sem_mutar() {
        let mut s = State::new();
        let cofre = end("cofre");
        let k1 = end("k1");
        let estranho = end("estranho");
        s.accounts.insert(cofre.clone(), Account { balance: 10 * UNIT, ..Default::default() });
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 1, keys: [(k1.clone(), 1)].into() }),
        );
        let antes = s.balance_of(&cofre);
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &estranho,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("TRANSFER")),
                        ("to".into(), JsonValue::str(&k1)),
                        ("amount".into(), JsonValue::str("1")),
                    ]),
                ),
            ],
        );
        assert!(aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT))
            .unwrap_err()
            .0
            .contains("não é uma chave autorizada"));
        assert_eq!(s.balance_of(&cofre), antes);
        assert!(s.pending_ops.is_empty());
    }

    #[test]
    fn multisig_transfer_sem_saldo_nao_deixa_efeito_parcial() {
        let mut s = State::new();
        let cofre = end("cofre");
        let k1 = end("k1");
        let dest = end("dest");
        s.accounts.insert(cofre.clone(), Account { balance: 10, ..Default::default() });
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 1, keys: [(k1.clone(), 1)].into() }),
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &k1,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("TRANSFER")),
                        ("to".into(), JsonValue::str(&dest)),
                        ("amount".into(), JsonValue::str("1000")),
                    ]),
                ),
            ],
        );
        assert!(aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT)).unwrap_err().0.contains("saldo"));
        assert_eq!(s.balance_of(&cofre), 10);
        assert!(!s.accounts.contains_key(&dest), "rejeição não pode materializar o destino");
    }

    #[test]
    fn ops_v2_nao_existem_abaixo_do_fork() {
        let mut s = State::new();
        let cofre = end("cofre");
        let k1 = end("k1");
        s.accounts.insert(cofre.clone(), Account { balance: 10 * UNIT, ..Default::default() });
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 1, keys: [(k1.clone(), 1)].into() }),
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &k1,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("SET_COMMISSION")),
                        ("percent".into(), JsonValue::Int(10)),
                    ]),
                ),
            ],
        );
        // SET_COMMISSION exige owner (v2) — v1 é recusada com mensagem própria.
        let err = aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT)).unwrap_err().0;
        assert!(
            err.contains("v2") || err.contains("não suportado"),
            "erro inesperado: {err}"
        );

        // Com v2 + owner, a comissão passa pelo limiar do owner (não pela active).
        s.permissions.insert(
            cofre.clone(),
            Permission::V2 {
                owner: Nivel { threshold: 1, keys: [(k1.clone(), 1)].into() },
                actives: vec![Active {
                    name: None,
                    nivel: Nivel { threshold: 1, keys: [(k1.clone(), 1)].into() },
                    operations: None,
                }],
                witness: None,
                recovery: None,
                delay_blocks: PERM_DELAY_DEFAULT_BLOCKS,
            },
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap();
        assert_eq!(
            s.pending_commission[&cofre],
            (10, PERMISSIONS_V2_HEIGHT + COMMISSION_DELAY_BLOCKS)
        );
    }

    #[test]
    fn witness_nao_autoriza_gov_nem_comissao() {
        let mut s = State::new();
        let cofre = end("cofre");
        let owner_k = end("owner");
        let witness = end("witness");
        s.accounts.insert(
            cofre.clone(),
            Account { balance: 10 * UNIT, staked: MIN_VALIDATOR_STAKE, ..Default::default() },
        );
        s.permissions.insert(
            cofre.clone(),
            Permission::V2 {
                owner: Nivel { threshold: 1, keys: [(owner_k.clone(), 1)].into() },
                actives: vec![Active {
                    name: None,
                    nivel: Nivel { threshold: 1, keys: [(owner_k.clone(), 1)].into() },
                    operations: None,
                }],
                witness: Some(witness.clone()),
                recovery: None,
                delay_blocks: PERM_DELAY_DEFAULT_BLOCKS,
            },
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &witness,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("SET_COMMISSION")),
                        ("percent".into(), JsonValue::Int(15)),
                    ]),
                ),
            ],
        );
        let err = aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT.max(GOVERNANCE_HEIGHT))).unwrap_err().0;
        assert!(err.contains("owner") || err.contains("witness"), "erro: {err}");
        assert!(!s.pending_commission.contains_key(&cofre));
    }

    #[test]
    fn multisig_unstake_nao_remove_o_ultimo_validador() {
        let mut s = State::new();
        let cofre = end("cofre");
        let k1 = end("k1");
        s.accounts.insert(
            cofre.clone(),
            Account { balance: UNIT, staked: MIN_VALIDATOR_STAKE, ..Default::default() },
        );
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 1, keys: [(k1.clone(), 1)].into() }),
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &k1,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("UNSTAKE")),
                        ("amount".into(), JsonValue::str(MIN_VALIDATOR_STAKE.to_string())),
                    ]),
                ),
            ],
        );
        assert!(aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT))
            .unwrap_err()
            .0
            .contains("último validador"));
        assert_eq!(s.account(&cofre).staked, MIN_VALIDATOR_STAKE, "o stake não pode ter mudado");
        assert!(s.unbonding.is_empty());
    }

    #[test]
    fn multisig_unstake_parcial_entra_na_fila() {
        let mut s = State::new();
        let cofre = end("cofre");
        let k1 = end("k1");
        s.accounts.insert(
            cofre.clone(),
            Account { balance: UNIT, staked: MIN_VALIDATOR_STAKE * 2, ..Default::default() },
        );
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 1, keys: [(k1.clone(), 1)].into() }),
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &k1,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("UNSTAKE")),
                        ("amount".into(), JsonValue::str(MIN_VALIDATOR_STAKE.to_string())),
                    ]),
                ),
            ],
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap();
        assert_eq!(s.account(&cofre).staked, MIN_VALIDATOR_STAKE);
        assert_eq!(
            s.unbonding,
            vec![(cofre, MIN_VALIDATOR_STAKE, PERMISSIONS_V2_HEIGHT + UNBONDING_BLOCKS)]
        );
    }

    // -------------------------------------------------------------------- meta-tx

    #[test]
    fn meta_tx_abaixo_do_fork_e_recusada() {
        let mut s = State::new();
        let relayer = end("relayer");
        let tx = tx_com("META_TX", &relayer, vec![("inner", JsonValue::Null)]);
        assert!(aplicar(&mut s, &tx, &ctx(META_HEIGHT - 1))
            .unwrap_err()
            .0
            .contains("ainda não ativa"));
    }

    #[test]
    fn ataque_conta_multisig_nao_age_por_meta_tx() {
        // Achado de auditoria real: sem esta guarda a chave-dona original burlaria o
        // M-de-N patrocinando uma inner assinada como a conta multiassinatura.
        let mut s = State::new();
        let relayer = end("relayer");
        let cofre = end("cofre");
        let k1 = end("k1");
        let dest = end("dest");
        s.accounts.insert(cofre.clone(), Account { balance: 10 * UNIT, ..Default::default() });
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 2, keys: [(k1.clone(), 1)].into() }),
        );
        let inner = JsonValue::map([
            ("protocol".into(), JsonValue::str("eav20")),
            ("scheme".into(), JsonValue::str("eav7-hybrid-1")),
            ("type".into(), JsonValue::str("TRANSFER")),
            ("from".into(), JsonValue::str(&cofre)),
            ("to".into(), JsonValue::str(&dest)),
            ("amount".into(), JsonValue::str("1000")),
            ("fee".into(), JsonValue::str("0")),
            ("nonce".into(), JsonValue::Int(1)),
            ("timestamp".into(), JsonValue::Int(1_700_000_000_000)),
        ]);
        let tx = tx_com("META_TX", &relayer, vec![("inner", inner)]);
        let e = aplicar(&mut s, &tx, &ctx(META_HEIGHT)).unwrap_err();
        // A guarda multisig é conferida DEPOIS da verificação stateless da inner;
        // o que importa é que o efeito não sai.
        assert!(e.0.contains("inner inválida") || e.0.contains("multisig"));
        assert_eq!(s.balance_of(&dest), 0);
        assert_eq!(s.balance_of(&cofre), 10 * UNIT);
    }

    #[test]
    fn meta_tx_recusa_aninhamento_de_meta_tx() {
        let mut s = State::new();
        let relayer = end("relayer");
        let u = end("usuario");
        let inner = JsonValue::map([
            ("protocol".into(), JsonValue::str("eav20")),
            ("scheme".into(), JsonValue::str("eav7-hybrid-1")),
            ("type".into(), JsonValue::str("META_TX")),
            ("from".into(), JsonValue::str(&u)),
            ("amount".into(), JsonValue::str("0")),
            ("fee".into(), JsonValue::str("0")),
            ("nonce".into(), JsonValue::Int(1)),
            ("timestamp".into(), JsonValue::Int(1_700_000_000_000)),
        ]);
        let tx = tx_com("META_TX", &relayer, vec![("inner", inner)]);
        assert!(aplicar(&mut s, &tx, &ctx(META_HEIGHT)).unwrap_err().0.contains("inner inválida"));
    }

    // -------------------------------------------------------------------- oráculo

    #[test]
    fn oracle_register_exige_stake_minimo_no_registro() {
        let mut s = State::new();
        let o = end("oraculo");
        s.accounts.insert(o.clone(), Account { balance: 10_000 * UNIT, ..Default::default() });
        let mut tx = tx_com("ORACLE_REGISTER", &o, vec![]);
        tx.amount = (MIN_ORACLE_STAKE - 1).to_string();
        assert!(aplicar(&mut s, &tx, &ctx(0)).unwrap_err().0.contains("stake mínimo"));
        assert!(s.oracles.is_empty());
        assert_eq!(s.balance_of(&o), 10_000 * UNIT, "rejeição não pode debitar");

        tx.amount = MIN_ORACLE_STAKE.to_string();
        aplicar(&mut s, &tx, &ctx(0)).unwrap();
        assert_eq!(s.oracles[&o].stake, MIN_ORACLE_STAKE);
        assert_eq!(s.balance_of(&o), 10_000 * UNIT - MIN_ORACLE_STAKE);

        // Aporte adicional pode ser de qualquer valor.
        tx.amount = "1".to_string();
        aplicar(&mut s, &tx, &ctx(0)).unwrap();
        assert_eq!(s.oracles[&o].stake, MIN_ORACLE_STAKE + 1);
    }

    #[test]
    fn oracle_register_grava_endpoint_apenas_de_texto() {
        let mut s = State::new();
        let o = end("oraculo");
        s.accounts.insert(o.clone(), Account { balance: 100_000 * UNIT, ..Default::default() });

        // Registro sem endpoint: a chave existe na folha, com valor nulo.
        let mut tx = tx_com("ORACLE_REGISTER", &o, vec![]);
        tx.amount = MIN_ORACLE_STAKE.to_string();
        tx.data = Some(JsonValue::map([]));
        aplicar(&mut s, &tx, &ctx(0)).unwrap();
        assert_eq!(s.oracles[&o].endpoint, None);

        // Texto grava.
        tx.amount = "1".to_string();
        tx.data = Some(JsonValue::map([("endpoint".into(), JsonValue::str("https://o.eav7.com"))]));
        aplicar(&mut s, &tx, &ctx(0)).unwrap();
        assert_eq!(s.oracles[&o].endpoint.as_deref(), Some("https://o.eav7.com"));

        // Não-texto NÃO apaga o que já estava: a referência só atribui sob
        // `typeof === 'string'`, então um aporte sem endpoint preserva o anterior.
        for v in [JsonValue::Null, JsonValue::Int(7)] {
            tx.data = Some(JsonValue::map([("endpoint".into(), v)]));
            aplicar(&mut s, &tx, &ctx(0)).unwrap();
            assert_eq!(s.oracles[&o].endpoint.as_deref(), Some("https://o.eav7.com"));
        }
        tx.data = Some(JsonValue::map([]));
        aplicar(&mut s, &tx, &ctx(0)).unwrap();
        assert_eq!(s.oracles[&o].endpoint.as_deref(), Some("https://o.eav7.com"));
    }

    #[test]
    fn oracle_register_sem_data_e_recusado_como_na_referencia() {
        // `tx.data.endpoint` com `data` ausente é `TypeError` na referência: a
        // transação cai inteira. Aceitá-la aqui registraria um oráculo que a rede
        // não tem.
        let mut s = State::new();
        let o = end("oraculo");
        s.accounts.insert(o.clone(), Account { balance: 100_000 * UNIT, ..Default::default() });
        let mut tx = tx_com("ORACLE_REGISTER", &o, vec![]);
        tx.amount = MIN_ORACLE_STAKE.to_string();
        tx.data = None;
        assert!(aplicar(&mut s, &tx, &ctx(0)).is_err());
        assert!(s.oracles.is_empty(), "recusa não pode deixar rastro");
        assert_eq!(s.balance_of(&o), 100_000 * UNIT);
    }

    #[test]
    fn oracle_register_sem_saldo_nao_muta() {
        let mut s = State::new();
        let o = end("oraculo");
        s.accounts.insert(o.clone(), Account { balance: 1, ..Default::default() });
        let mut tx = tx_com("ORACLE_REGISTER", &o, vec![]);
        tx.amount = MIN_ORACLE_STAKE.to_string();
        assert!(aplicar(&mut s, &tx, &ctx(0)).unwrap_err().0.contains("saldo insuficiente"));
        assert_eq!(s.balance_of(&o), 1);
        assert!(s.oracles.is_empty());
    }

    // ------------------------------------------------------- invariantes gerais

    #[test]
    fn toda_rejeicao_deixa_o_estado_identico() {
        // A invariante central do módulo, verificada de uma vez sobre um estado
        // razoavelmente rico: nenhum caminho de erro pode deixar rastro.
        let (base, conta, o1, _, a1, _) = cenario_v2();
        let estranho = end("estranho");
        let novo = end("novo");

        let casos: Vec<(Tx, Ctx)> = vec![
            // fork não ativo
            (tx_perm("PERMISSION_PROPOSE", &a1, &conta, Some(mudanca_owner(&[(&novo, 1)], 1))),
             ctx(PERMISSIONS_V2_HEIGHT - 1)),
            // remetente sem participação na permissão
            (tx_perm("PERMISSION_PROPOSE", &estranho, &conta, Some(mudanca_owner(&[(&novo, 1)], 1))),
             ctx(PERMISSIONS_V2_HEIGHT)),
            // nível de mudança desconhecido
            (tx_perm("PERMISSION_PROPOSE", &a1, &conta,
                Some(JsonValue::map([("level".into(), JsonValue::str("root"))]))),
             ctx(PERMISSIONS_V2_HEIGHT)),
            // veto sem pendência
            (tx_perm("PERMISSION_VETO", &o1, &conta, None), ctx(PERMISSIONS_V2_HEIGHT)),
            // aprovação sem pendência
            (tx_perm("PERMISSION_APPROVE", &o1, &conta, None), ctx(PERMISSIONS_V2_HEIGHT)),
            // conta inexistente
            (tx_perm("PERMISSION_PROPOSE", &a1, &estranho, Some(mudanca_owner(&[(&novo, 1)], 1))),
             ctx(PERMISSIONS_V2_HEIGHT)),
            // governança fora de altura
            (tx_com("GOV_PROPOSE", &o1,
                vec![("param", JsonValue::str("TREASURY_PCT")), ("value", JsonValue::Int(1))]),
             ctx(GOVERNANCE_HEIGHT - 1)),
            // multisig com conta que não é multisig
            (tx_com("MULTISIG_PROPOSE", &o1, vec![("account", JsonValue::str(&estranho))]),
             ctx(PERMISSIONS_HEIGHT)),
            // aprovação de operação inexistente
            (tx_com("MULTISIG_APPROVE", &o1, vec![("opId", JsonValue::str("nao-existe"))]),
             ctx(PERMISSIONS_HEIGHT)),
        ];

        for (tx, c) in casos {
            let mut s = base.clone();
            let r = aplicar(&mut s, &tx, &c);
            assert!(r.is_err(), "esperava rejeição em {}", tx.tx_type);
            assert_eq!(s.accounts, base.accounts, "contas mudaram em {}", tx.tx_type);
            assert_eq!(s.permissions, base.permissions, "permissões mudaram em {}", tx.tx_type);
            assert_eq!(s.pending_perm, base.pending_perm, "pendências mudaram em {}", tx.tx_type);
            assert_eq!(s.pending_ops, base.pending_ops, "ops mudaram em {}", tx.tx_type);
            assert_eq!(s.proposals, base.proposals, "propostas mudaram em {}", tx.tx_type);
        }
    }

    #[test]
    fn atinge_limiar_nao_estoura_com_pesos_absurdos() {
        // Pesos vêm do usuário: um estouro que desse a volta satisfaria um limiar
        // não atingido. Estouro conta como NÃO atingido — falha fechada.
        let a = end("a");
        let b = end("b");
        let nivel = Nivel { threshold: 1, keys: [(a.clone(), u64::MAX), (b.clone(), u64::MAX)].into() };
        let assinantes: BTreeSet<String> = [a, b].into_iter().collect();
        assert!(!atinge_limiar(Some(&nivel), &assinantes));
    }

    #[test]
    fn nivel_de_gasto_em_v1_so_responde_ao_id_zero() {
        let k = end("k");
        let p = Permission::V1(Nivel { threshold: 1, keys: [(k, 1)].into() });
        assert!(nivel_de_gasto(&p, 0).is_some());
        assert!(nivel_de_gasto(&p, 1).is_none());
    }

    // ------------------------------------------- execução ao cruzar o limiar

    /// Cofre 2-de-3 com uma transferência proposta e ainda sem quórum.
    fn cofre_com_op_pendente() -> (State, String, String, String, String, String) {
        let mut s = State::new();
        let cofre = end("cofre");
        let (k1, k2, k3) = (end("k1"), end("k2"), end("k3"));
        let dest = end("dest");
        s.accounts.insert(cofre.clone(), Account { balance: 10 * UNIT, ..Default::default() });
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel {
                threshold: 2,
                keys: [(k1.clone(), 1), (k2.clone(), 1), (k3.clone(), 1)].into(),
            }),
        );
        let tx = tx_com(
            "MULTISIG_PROPOSE",
            &k1,
            vec![
                ("account", JsonValue::str(&cofre)),
                (
                    "op",
                    JsonValue::map([
                        ("type".into(), JsonValue::str("TRANSFER")),
                        ("to".into(), JsonValue::str(&dest)),
                        ("amount".into(), JsonValue::str("1000")),
                    ]),
                ),
            ],
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_HEIGHT)).unwrap();
        let op_id = tx.id.clone().unwrap();
        (s, cofre, dest, op_id, k2, k3)
    }

    #[test]
    fn multisig_approve_ao_cruzar_o_limiar_executa_a_operacao() {
        // O trilho que estava bloqueado: sem o CORPO da operação guardado, cruzar o
        // limiar não tinha como saber destino nem valor e a conta travava com os
        // fundos dentro. Agora `PendingOp.op` carrega o corpo e a operação sai.
        let (mut s, cofre, dest, op_id, k2, _) = cofre_com_op_pendente();
        assert_eq!(s.pending_ops[&op_id].weight, 1);
        assert_eq!(s.balance_of(&dest), 0);

        let ap = tx_com("MULTISIG_APPROVE", &k2, vec![("opId", JsonValue::str(&op_id))]);
        aplicar(&mut s, &ap, &ctx(PERMISSIONS_HEIGHT + 1)).unwrap();

        assert_eq!(s.balance_of(&dest), 1000, "a transferência aprovada tem de sair");
        assert_eq!(s.balance_of(&cofre), 10 * UNIT - 1000);
        // A referência REMOVE a pendência depois de executar (`state.js:1645`).
        assert!(!s.pending_ops.contains_key(&op_id), "pendência executada tem de sumir");
    }

    #[test]
    fn multisig_approve_guarda_o_corpo_e_o_created_at_da_referencia() {
        let (s, cofre, dest, op_id, _, _) = cofre_com_op_pendente();
        let p = &s.pending_ops[&op_id];
        assert_eq!(p.account, cofre);
        assert_eq!(p.op_type(), Some("TRANSFER"));
        assert_eq!(p.op.get("to"), Some(&JsonValue::str(&dest)));
        assert_eq!(p.op.get("amount"), Some(&JsonValue::str("1000")));
        assert_eq!(p.created_at, 1_700_000_000_000);
    }

    #[test]
    fn multisig_approve_que_falha_na_execucao_nao_deixa_efeito_parcial() {
        // O saldo some entre propor e completar o limiar: a validação roda contra o
        // estado ATUAL, então a aprovação é recusada inteira — sem taxa, sem
        // aprovação registrada e com a pendência intacta para uma nova tentativa.
        let (mut s, cofre, dest, op_id, k2, _) = cofre_com_op_pendente();
        s.account_mut(&cofre).balance = 10;
        let antes = s.pending_ops.clone();

        let ap = tx_com("MULTISIG_APPROVE", &k2, vec![("opId", JsonValue::str(&op_id))]);
        assert!(aplicar(&mut s, &ap, &ctx(PERMISSIONS_HEIGHT + 1)).unwrap_err().0.contains("saldo"));
        assert_eq!(s.balance_of(&dest), 0);
        assert_eq!(s.pending_ops, antes, "rejeição não pode tocar a pendência");
    }

    #[test]
    fn multisig_approve_reconfere_o_escopo_vigente_na_execucao() {
        // A permissão pode mudar entre propor e completar o limiar; a operação não
        // pode escapar do escopo que vale AGORA.
        let (mut s, cofre, dest, op_id, k2, _) = cofre_com_op_pendente();
        let o1 = end("owner1");
        s.permissions.insert(
            cofre.clone(),
            Permission::V2 {
                owner: Nivel { threshold: 1, keys: [(o1, 1)].into() },
                actives: vec![Active {
                    nivel: Nivel { threshold: 2, keys: [(k2.clone(), 2)].into() },
                    name: None,
                    operations: Some(vec!["STAKE".to_string()]),
                }],
                witness: None,
                recovery: None,
                delay_blocks: PERM_DELAY_MIN_BLOCKS,
            },
        );
        let ap = tx_com("MULTISIG_APPROVE", &k2, vec![("opId", JsonValue::str(&op_id))]);
        let e = aplicar(&mut s, &ap, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap_err();
        assert!(e.0.contains("fora do escopo"));
        assert_eq!(s.balance_of(&dest), 0);
        assert!(s.pending_ops.contains_key(&op_id));
    }

    #[test]
    fn nome_da_active_e_guardado_e_nao_apenas_validado() {
        // Uma active NOMEADA divergia da rede: o nome era validado e jogado fora, e
        // a folha `perm` da conta saía sem a chave `name`.
        let mut s = State::new();
        let dono = end("dono");
        let o1 = end("owner1");
        let a1 = end("active1");
        s.accounts.insert(dono.clone(), Account { balance: UNIT, ..Default::default() });
        let active = JsonValue::map([
            ("threshold".into(), JsonValue::Int(1)),
            ("keys".into(), JsonValue::map([(a1.clone(), JsonValue::Int(1))])),
            ("name".into(), JsonValue::str("caixa")),
        ]);
        let tx = tx_com(
            "PERMISSION_UPDATE",
            &dono,
            vec![(
                "permission",
                JsonValue::map([
                    ("owner".into(), perm_v1(&[(&o1, 1)], 1)),
                    ("active".into(), active),
                    ("delayBlocks".into(), JsonValue::Int(PERM_DELAY_MIN_BLOCKS as i64)),
                ]),
            )],
        );
        aplicar(&mut s, &tx, &ctx(PERMISSIONS_V2_HEIGHT)).unwrap();
        let Permission::V2 { actives, .. } = &s.permissions[&dono] else { panic!("esperava v2") };
        assert_eq!(actives[0].name.as_deref(), Some("caixa"));
    }

    #[test]
    fn pending_perm_guarda_o_conteudo_da_mudanca_e_nao_so_o_nivel() {
        let (mut s, conta, _, _, a1, _) = cenario_v2();
        let novo = end("owner_novo");
        aplicar(
            &mut s,
            &tx_perm("PERMISSION_PROPOSE", &a1, &conta, Some(mudanca_owner(&[(&novo, 1)], 1))),
            &ctx(PERMISSIONS_V2_HEIGHT),
        )
        .unwrap();
        // Sem o corpo, a aplicação no `blockTick` não teria o que aplicar.
        let Mudanca::Owner(n) = &s.pending_perm[&conta].change else { panic!("esperava owner") };
        assert_eq!(n.threshold, 1);
        assert_eq!(n.keys[&novo], 1);
    }

    // ------------------------------- ops multisig que dependiam de outros domínios

    /// Cofre multissinatura de limiar 1 com a chave `k1`.
    fn cofre_com_uma_chave(s: &mut State) -> (String, String) {
        let cofre = end("cofre-dominio");
        let k1 = end("k1-dominio");
        s.accounts.insert(cofre.clone(), Account { balance: 10 * UNIT, ..Default::default() });
        s.accounts.insert(k1.clone(), Account { balance: UNIT, ..Default::default() });
        s.permissions.insert(
            cofre.clone(),
            Permission::V1(Nivel { threshold: 1, keys: [(k1.clone(), 1)].into() }),
        );
        (cofre, k1)
    }

    fn propor(k: &str, conta: &str, op: Vec<(&str, JsonValue)>) -> Tx {
        tx_com(
            "MULTISIG_PROPOSE",
            k,
            vec![
                ("account", JsonValue::str(conta)),
                ("op", JsonValue::map(op.into_iter().map(|(k, v)| (k.to_string(), v)))),
            ],
        )
    }

    /// `TOKEN_TRANSFER` multissinatura MOVE o token.
    ///
    /// Era recusado com "depende de domínio ainda não portado" — mas a referência
    /// EXECUTA (`state.js:479-488`). O mesmo bloco movia token na rede e era
    /// rejeitado por este cliente: estados diferentes, fork.
    #[test]
    fn multisig_token_transfer_move_o_saldo_do_token() {
        let mut s = State::new();
        let (cofre, k1) = cofre_com_uma_chave(&mut s);
        let dest = end("dest-token");
        let tk = crate::state::token::Token {
            id: "TKN".into(),
            balances: [(cofre.clone(), 500)].into(),
            ..Default::default()
        };
        s.tokens.insert("TKN".into(), tk);

        aplicar(
            &mut s,
            &propor(&k1, &cofre, vec![
                ("type", JsonValue::str("TOKEN_TRANSFER")),
                ("token", JsonValue::str("TKN")),
                ("to", JsonValue::str(&dest)),
                ("amount", JsonValue::str("200")),
            ]),
            &ctx(PERMISSIONS_HEIGHT),
        )
        .expect("a operação tem de executar");

        let t = &s.tokens["TKN"];
        assert_eq!(t.balances.get(&cofre).copied(), Some(300));
        assert_eq!(t.balances.get(&dest).copied(), Some(200));
    }

    /// As guardas do DOMÍNIO valem também pela via multissinatura: token pausado
    /// não se move. Sem isto, a multiassinatura seria uma porta lateral que
    /// contorna a única alavanca do dono do token contra um roubo em andamento.
    #[test]
    fn multisig_token_transfer_respeita_a_pausa_do_token() {
        let mut s = State::new();
        let (cofre, k1) = cofre_com_uma_chave(&mut s);
        let dest = end("dest-pausa");
        s.tokens.insert(
            "TKN".into(),
            crate::state::token::Token {
                id: "TKN".into(),
                paused: true,
                balances: [(cofre.clone(), 500)].into(),
                ..Default::default()
            },
        );

        let erro = aplicar(
            &mut s,
            &propor(&k1, &cofre, vec![
                ("type", JsonValue::str("TOKEN_TRANSFER")),
                ("token", JsonValue::str("TKN")),
                ("to", JsonValue::str(&dest)),
                ("amount", JsonValue::str("200")),
            ]),
            &ctx(PERMISSIONS_HEIGHT),
        )
        .expect_err("token pausado não se move");
        assert!(erro.to_string().contains("pausado"), "{erro}");
        assert_eq!(s.tokens["TKN"].balances.get(&cofre).copied(), Some(500), "nada mudou");
        assert!(s.pending_ops.is_empty(), "e a pendência não sobrou");
    }

    /// `NFT_TRANSFER` multissinatura troca o dono E MATA a aprovação.
    ///
    /// Manter a aprovação deixaria o aprovado do dono ANTERIOR movendo o item da
    /// carteira do novo dono — roubo com autorização válida.
    #[test]
    fn multisig_nft_transfer_troca_o_dono_e_mata_a_aprovacao() {
        let mut s = State::new();
        let (cofre, k1) = cofre_com_uma_chave(&mut s);
        let dest = end("dest-nft");
        let terceiro = end("aprovado-antigo");
        let mut col = crate::state::nft::Collection {
            id: "COL".into(),
            owner: cofre.clone(),
            ..Default::default()
        };
        col.tokens.insert(
            "1".into(),
            crate::state::nft::NftToken { owner: cofre.clone(), uri: String::new() },
        );
        col.approvals.insert("1".into(), terceiro);
        s.nfts.insert("COL".into(), col);

        aplicar(
            &mut s,
            &propor(&k1, &cofre, vec![
                ("type", JsonValue::str("NFT_TRANSFER")),
                ("collection", JsonValue::str("COL")),
                // NÚMERO, não texto: a referência faz `String(op.tokenId)`, e sem a
                // mesma coerção o item 1 e o item "1" viram entradas diferentes.
                ("tokenId", JsonValue::Int(1)),
                ("to", JsonValue::str(&dest)),
            ]),
            &ctx(PERMISSIONS_HEIGHT),
        )
        .expect("a operação tem de executar");

        let col = &s.nfts["COL"];
        assert_eq!(col.tokens["1"].owner, dest);
        assert!(col.approvals.is_empty(), "a aprovação morre na transferência");
    }

    /// A conta multissinatura tem de ser a DONA do NFT — não basta estar aprovada.
    #[test]
    fn multisig_nft_transfer_exige_que_a_conta_seja_dona() {
        let mut s = State::new();
        let (cofre, k1) = cofre_com_uma_chave(&mut s);
        let outro = end("dono-de-verdade");
        let mut col = crate::state::nft::Collection { id: "COL".into(), ..Default::default() };
        col.tokens.insert(
            "1".into(),
            crate::state::nft::NftToken { owner: outro.clone(), uri: String::new() },
        );
        // O cofre está APROVADO, mas não é dono.
        col.approvals.insert("1".into(), cofre.clone());
        s.nfts.insert("COL".into(), col);

        let erro = aplicar(
            &mut s,
            &propor(&k1, &cofre, vec![
                ("type", JsonValue::str("NFT_TRANSFER")),
                ("collection", JsonValue::str("COL")),
                ("tokenId", JsonValue::str("1")),
                ("to", JsonValue::str(end("dest-nft-2"))),
            ]),
            &ctx(PERMISSIONS_HEIGHT),
        )
        .expect_err("aprovação de terceiro não basta");
        assert!(erro.to_string().contains("não é dona"), "{erro}");
        assert_eq!(s.nfts["COL"].tokens["1"].owner, outro, "o dono não mudou");
    }

    /// `VOTE` multissinatura aloca poder de voto — sem ele o voto de uma conta
    /// multisig fica PRESO (é exatamente por isso que a referência o adicionou na v2).
    #[test]
    fn multisig_vote_aloca_o_poder_de_voto_da_conta() {
        let mut s = State::new();
        let (cofre, k1) = cofre_com_uma_chave(&mut s);
        let candidato = end("candidato");
        s.account_mut(&cofre).staked = MIN_VALIDATOR_STAKE * 2;
        s.accounts.insert(
            candidato.clone(),
            Account { staked: MIN_VALIDATOR_STAKE * 2, ..Default::default() },
        );

        aplicar(
            &mut s,
            &propor(&k1, &cofre, vec![
                ("type", JsonValue::str("VOTE")),
                ("votes", JsonValue::map([(candidato.clone(), JsonValue::str("1000"))])),
            ]),
            &ctx(PERMISSIONS_V2_HEIGHT),
        )
        .expect("a operação tem de executar");

        assert_eq!(s.votes[&cofre][&candidato], 1000);
        assert_eq!(s.candidate_votes[&candidato], 1000);
    }

    /// `VOTE` e `CLAIM_VOTER_REWARD` só existem a PARTIR do fork v2. Abaixo dele a
    /// referência cai no ramo final e recusa — aceitar antes seria aceitar o que a
    /// rede rejeita.
    #[test]
    fn vote_multisig_abaixo_do_fork_v2_e_recusado() {
        let mut s = State::new();
        let (cofre, k1) = cofre_com_uma_chave(&mut s);
        let candidato = end("candidato-cedo");
        s.account_mut(&cofre).staked = MIN_VALIDATOR_STAKE * 2;
        s.accounts.insert(
            candidato.clone(),
            Account { staked: MIN_VALIDATOR_STAKE * 2, ..Default::default() },
        );

        let erro = aplicar(
            &mut s,
            &propor(&k1, &cofre, vec![
                ("type", JsonValue::str("VOTE")),
                ("votes", JsonValue::map([(candidato, JsonValue::str("1000"))])),
            ]),
            &ctx(PERMISSIONS_V2_HEIGHT - 1),
        )
        .expect_err("abaixo do fork v2 a operação não existe");
        assert!(erro.to_string().contains("não suportado"), "{erro}");
        assert!(s.votes.is_empty());
    }

    /// `CLAIM_VOTER_REWARD` exige que a conta VOTE naquele validador: resgatar sem
    /// voto creditaria a partir de um acumulador que não é dela.
    #[test]
    fn multisig_claim_voter_reward_exige_voto_naquele_validador() {
        let mut s = State::new();
        let (cofre, k1) = cofre_com_uma_chave(&mut s);
        let validador = end("validador-alheio");
        s.accounts.insert(
            validador.clone(),
            Account { staked: MIN_VALIDATOR_STAKE * 2, ..Default::default() },
        );

        let erro = aplicar(
            &mut s,
            &propor(&k1, &cofre, vec![
                ("type", JsonValue::str("CLAIM_VOTER_REWARD")),
                ("validator", JsonValue::str(&validador)),
            ]),
            &ctx(PERMISSIONS_V2_HEIGHT),
        )
        .expect_err("sem voto não há o que resgatar");
        assert!(erro.to_string().contains("não vota"), "{erro}");
    }
}

// ============================================================================
// Testes da serialização canônica
//
// O que estes testes travam é a LISTA EXATA DE CHAVES de cada folha. Um campo
// renomeado, acrescentado ou omitido por engano muda a raiz de estado da rede
// inteira, e nenhum teste de comportamento acusaria isso — o nó só divergiria em
// produção, no primeiro bloco com o objeto afetado.
// ============================================================================
#[cfg(test)]
mod tests_canonico {
    use super::*;

    /// As chaves emitidas, em ordem (que é a de bytes, garantida pelo `BTreeMap`).
    fn chaves(v: &Value) -> Vec<String> {
        let Value::Map(m) = v else { panic!("esperava mapa") };
        m.keys().cloned().collect()
    }

    fn valor<'a>(v: &'a Value, chave: &str) -> &'a Value {
        let Value::Map(m) = v else { panic!("esperava mapa") };
        m.get(chave).unwrap_or_else(|| panic!("chave {chave} ausente"))
    }

    fn nivel() -> Nivel {
        Nivel {
            threshold: 2,
            keys: [("E7A".to_string(), 1u64), ("E7B".to_string(), 1)].into_iter().collect(),
        }
    }

    fn active() -> Active {
        Active { nivel: nivel(), name: None, operations: None }
    }

    // ---------------------------------------------------------------- Permission

    #[test]
    fn permissao_v1_codifica_com_as_chaves_da_referencia() {
        assert_eq!(chaves(&Permission::V1(nivel()).to_value()), ["keys", "threshold"]);
    }

    #[test]
    fn permissao_v2_codifica_com_as_chaves_da_referencia() {
        let p = Permission::V2 {
            owner: nivel(),
            actives: vec![active()],
            witness: Some("E7W".into()),
            recovery: Some("E7R".into()),
            delay_blocks: PERM_DELAY_DEFAULT_BLOCKS,
        };
        assert_eq!(
            chaves(&p.to_value()),
            ["actives", "delayBlocks", "owner", "recovery", "witness"],
            "a v2 NÃO tem threshold/keys no topo — a referência não os grava lá"
        );
        // A `active` ganha o `id` (seu índice); o `owner` não tem `id` nenhum.
        let v = p.to_value();
        let Value::List(actives) = valor(&v, "actives") else { panic!("lista") };
        assert_eq!(chaves(&actives[0]), ["id", "keys", "threshold"]);
        assert_eq!(chaves(valor(&v, "owner")), ["keys", "threshold"]);
    }

    /// O `enum` é o que apaga do domínio as combinações que a rede nunca produz.
    /// Nenhuma das formas abaixo compila — e é essa a garantia que a struct com
    /// tudo em `Option` não dava:
    ///
    /// ```text
    /// // não compila: v2 com threshold/keys no topo (a referência não os grava lá)
    /// Permission::V2 { threshold: 1, keys: BTreeMap::new(), .. };
    ///
    /// // não compila: v1 com recovery (só a v2 tem níveis de recuperação)
    /// Permission::V1(Nivel { threshold: 1, keys: BTreeMap::new(), recovery: None });
    ///
    /// // não compila: v2 sem owner ou sem delayBlocks — os dois são obrigatórios
    /// Permission::V2 { actives: vec![], witness: None, recovery: None };
    ///
    /// // não compila: owner com escopo de operações (só a `active` tem escopo)
    /// Nivel { threshold: 1, keys: BTreeMap::new(), operations: Some(vec![]) };
    /// ```
    ///
    /// O que dá para verificar em tempo de execução é o COMPLEMENTO: cada variante
    /// emite só o que lhe cabe.
    #[test]
    fn cada_variante_emite_apenas_as_chaves_da_sua_forma() {
        let v1 = chaves(&Permission::V1(nivel()).to_value());
        for proibida in ["owner", "actives", "witness", "recovery", "delayBlocks", "id"] {
            assert!(!v1.contains(&proibida.to_string()), "{proibida} não existe numa v1");
        }
        let v2 = chaves(
            &Permission::V2 {
                owner: nivel(),
                actives: vec![active()],
                witness: None,
                recovery: None,
                delay_blocks: PERM_DELAY_DEFAULT_BLOCKS,
            }
            .to_value(),
        );
        for proibida in ["threshold", "keys"] {
            assert!(!v2.contains(&proibida.to_string()), "{proibida} não existe no topo de uma v2");
        }
    }

    #[test]
    fn permissao_omite_o_que_nao_se_aplica() {
        // v2 sem witness nem recovery: as duas somem, as outras três ficam. Emitir
        // `null` mudaria a folha de toda conta v2 que não use os dois níveis.
        let p = Permission::V2 {
            owner: nivel(),
            actives: vec![active()],
            witness: None,
            recovery: None,
            delay_blocks: PERM_DELAY_DEFAULT_BLOCKS,
        };
        assert_eq!(chaves(&p.to_value()), ["actives", "delayBlocks", "owner"]);
    }

    #[test]
    fn nome_e_escopo_da_active_so_aparecem_quando_definidos() {
        let mut a = active();
        a.name = Some("caixa".into());
        a.operations = Some(vec!["TRANSFER".into()]);
        assert_eq!(chaves(&a.to_value(0)), ["id", "keys", "name", "operations", "threshold"]);
        assert_eq!(valor(&a.to_value(0), "name"), &Value::str("caixa"));
        // Sem nome e sem escopo, as duas chaves somem — e "sem escopo" significa
        // justamente "todas as operações".
        assert_eq!(chaves(&active().to_value(0)), ["id", "keys", "threshold"]);
    }

    // ------------------------------------------------------------------- Mudanca

    #[test]
    fn cada_mudanca_codifica_com_a_forma_da_referencia() {
        // `#normalizeChange` (`state.js:328-356`): `{level, value}` para todos, mais
        // o `id` só na `active`.
        let m = Mudanca::Owner(nivel());
        assert_eq!(chaves(&m.to_value()), ["level", "value"]);
        assert_eq!(valor(&m.to_value(), "level"), &Value::str("owner"));
        assert_eq!(chaves(valor(&m.to_value(), "value")), ["keys", "threshold"]);

        let m = Mudanca::Active { id: 1, valor: Some(Box::new(active())) };
        assert_eq!(chaves(&m.to_value()), ["id", "level", "value"]);
        assert_eq!(valor(&m.to_value(), "id"), &Value::uint(1u64));
        // O `id` dentro do valor é o da MUDANÇA (`#normalizeActive(value, id)`).
        assert_eq!(valor(valor(&m.to_value(), "value"), "id"), &Value::uint(1u64));

        // Remoção: `value: null` LITERAL, não chave ausente.
        let m = Mudanca::Active { id: 0, valor: None };
        assert_eq!(valor(&m.to_value(), "value"), &Value::Null);

        let m = Mudanca::Witness(Some("E7W".into()));
        assert_eq!(valor(&m.to_value(), "level"), &Value::str("witness"));
        assert_eq!(valor(&m.to_value(), "value"), &Value::str("E7W"));
        assert_eq!(valor(&Mudanca::Recovery(None).to_value(), "value"), &Value::Null);

        let m = Mudanca::Delay(PERM_DELAY_MIN_BLOCKS);
        assert_eq!(valor(&m.to_value(), "level"), &Value::str("delay"));
        assert_eq!(valor(&m.to_value(), "value"), &Value::uint(PERM_DELAY_MIN_BLOCKS));
    }

    /// ```text
    /// // não compila: `delay` não tem `id` (só a `active` escolhe qual nível alterar)
    /// Mudanca::Delay { id: 0, valor: 10 };
    ///
    /// // não compila: `owner` não admite remoção — a conta ficaria sem owner
    /// Mudanca::Owner(None);
    ///
    /// // não compila: `witness` guarda um endereço, não um conjunto com limiar
    /// Mudanca::Witness(Nivel { threshold: 1, keys: BTreeMap::new() });
    /// ```
    #[test]
    fn o_nivel_da_mudanca_vem_do_tipo_e_nao_de_um_rotulo() {
        // Antes o par era `(level: String, value)`, e nada impedia um rótulo que não
        // batesse com o corpo. Agora o rótulo é DERIVADO da variante.
        assert_eq!(Mudanca::Owner(nivel()).nivel(), "owner");
        assert_eq!(Mudanca::Active { id: 0, valor: None }.nivel(), "active");
        assert_eq!(Mudanca::Witness(None).nivel(), "witness");
        assert_eq!(Mudanca::Recovery(None).nivel(), "recovery");
        assert_eq!(Mudanca::Delay(1).nivel(), "delay");
    }

    // ----------------------------------------------------------------- PendingOp

    fn pending_op() -> PendingOp {
        PendingOp {
            account: "E7A".into(),
            op: BTreeMap::from([
                ("type".to_string(), JsonValue::str("TRANSFER")),
                ("to".to_string(), JsonValue::str("E7D")),
                ("amount".to_string(), JsonValue::str("1000")),
            ]),
            approvals: [("E7K".to_string(), 3u64)].into_iter().collect(),
            weight: 3,
            permission_id: 0,
            created_at: 1_700_000_000_000,
            deadline: 100,
        }
    }

    #[test]
    fn pending_op_codifica_com_as_chaves_da_referencia() {
        // `{account, op, approvals, weight, permissionId, createdAt, deadline}` —
        // `state.js:1616`.
        assert_eq!(
            chaves(&pending_op().to_value()),
            ["account", "approvals", "createdAt", "deadline", "op", "permissionId", "weight"]
        );
        // Os valores de `approvals` são PESOS, não booleanos.
        assert_eq!(valor(valor(&pending_op().to_value(), "approvals"), "E7K"), &Value::uint(3u64));
    }

    #[test]
    fn pending_op_emite_o_corpo_cru_da_operacao() {
        // É o corpo que torna a operação executável ao cruzar o limiar; ele entra na
        // folha exatamente como o proponente o enviou.
        let v = pending_op().to_value();
        let op = valor(&v, "op");
        assert_eq!(chaves(op), ["amount", "to", "type"]);
        assert_eq!(valor(op, "amount"), &Value::str("1000"));
        // `createdAt` é o timestamp em milissegundos, e codifica como INTEIRO.
        assert_eq!(valor(&v, "createdAt"), &Value::int(1_700_000_000_000i64));
    }

    #[test]
    fn pending_op_nao_emite_chave_que_a_referencia_nao_tem() {
        let ks = chaves(&pending_op().to_value());
        for proibida in ["opType", "op_type", "type"] {
            assert!(!ks.contains(&proibida.to_string()), "{proibida} não pode ser emitida");
        }
    }

    // --------------------------------------------------------------- PendingPerm

    #[test]
    fn pending_perm_codifica_com_as_chaves_da_referencia() {
        let pp = PendingPerm {
            change: Mudanca::Owner(nivel()),
            approvals: [("E7K".to_string(), true)].into_iter().collect(),
            vetoes: BTreeMap::new(),
            execute_at: Some(4_200),
            proposed_at: 100,
        };
        assert_eq!(
            chaves(&pp.to_value()),
            ["approvals", "change", "executeAt", "proposedAt", "vetoes"]
        );
        assert_eq!(valor(&pp.to_value(), "executeAt"), &Value::uint(4_200u64));
        assert_eq!(valor(valor(&pp.to_value(), "change"), "level"), &Value::str("owner"));
    }

    #[test]
    fn pending_perm_com_timelock_nao_iniciado_emite_null_e_nao_zero() {
        // A referência cria a pendência com `executeAt: null` LITERAL. `null` (tag
        // 0x00) e o inteiro 0 (tag 0x03) codificam diferente — e `Option` é o que
        // torna a distinção impossível de errar, ao contrário do 0 sentinela.
        let pp = PendingPerm { execute_at: None, ..Default::default() };
        assert_eq!(valor(&pp.to_value(), "executeAt"), &Value::Null);
        // E a chave continua existindo: `null` não é ausência.
        assert!(chaves(&pp.to_value()).contains(&"executeAt".to_string()));
        // Altura 0 é um valor legítimo e codifica como INTEIRO, não como nulo.
        let pp = PendingPerm { execute_at: Some(0), ..Default::default() };
        assert_eq!(valor(&pp.to_value(), "executeAt"), &Value::uint(0u64));
    }

    // ------------------------------------------------------------------ Proposal

    fn proposta(value: ValorGov) -> Proposal {
        Proposal {
            id: "p1".into(),
            param: "BLOCK_REWARD".into(),
            value,
            proposer: "E7V".into(),
            votes: [("E7V".to_string(), true)].into_iter().collect(),
            deadline: 900,
            execute_at: Some(1_000),
            created_at: 1_700_000_000_000,
            state: "QUEUED".into(),
        }
    }

    #[test]
    fn proposta_codifica_com_as_chaves_da_referencia() {
        let p = proposta(ValorGov::Inteiro("1000".into()));
        assert_eq!(
            chaves(&p.to_value()),
            [
                "createdAt", "deadline", "executeAt", "id", "param", "proposer", "status",
                "value", "votes"
            ]
        );
        // `status`, não `state`: a grafia da folha é a da referência.
        assert_eq!(valor(&p.to_value(), "status"), &Value::str("QUEUED"));
    }

    #[test]
    fn valor_escalar_codifica_como_inteiro_e_nao_como_texto() {
        // `#coerceGovValue` devolve `BigInt`/`Number` (`state.js:656-666`), que
        // encodam com a tag 0x03. Guardar o decimal como TEXTO (tag 0x04) dava outra
        // folha para toda proposta de parâmetro escalar.
        let p = proposta(ValorGov::Inteiro("1000".into()));
        assert_eq!(valor(&p.to_value(), "value"), &Value::Int("1000".into()));
        // E o decimal não cabe em 64 bits: `BLOCK_REWARD` vai até `1000 * UNIT`.
        let grande = (1_000u128 * UNIT).to_string();
        let p = proposta(ValorGov::Inteiro(grande.clone()));
        assert_eq!(valor(&p.to_value(), "value"), &Value::Int(grande));
    }

    #[test]
    fn valor_estruturado_codifica_como_objeto() {
        // BRIDGE_COMMITTEE / TREASURY_SPEND / AI_ATTESTER guardam um OBJETO
        // (`state.js:1457-1462`), não o JSON dele em texto.
        let comite = validar_comite(Some(&JsonValue::map([
            ("sourceChain".into(), JsonValue::str("tron")),
            ("members".into(), JsonValue::List(vec![JsonValue::str("0xAB")])),
            ("quorum".into(), JsonValue::Int(1)),
        ])))
        .expect("comitê válido");
        let v = proposta(comite).to_value();
        let obj = valor(&v, "value");
        assert_eq!(chaves(obj), ["members", "quorum", "sourceChain"]);
        assert_eq!(valor(obj, "sourceChain"), &Value::str("TRON"));
        // `quorum` é `Number` na referência: INTEIRO, não texto.
        assert_eq!(valor(obj, "quorum"), &Value::int(1i64));
        // Membros vêm em minúsculas.
        assert_eq!(valor(obj, "members"), &Value::List(vec![Value::str("0xab")]));
    }

    /// ```text
    /// // não compila: o valor escalar não é um `i64` — `BLOCK_REWARD` chega a 10^21
    /// ValorGov::Inteiro(1000i64);
    ///
    /// // não compila: o objeto estruturado não é texto JSON
    /// ValorGov::Objeto("{\"quorum\":1}".to_string());
    /// ```
    #[test]
    fn proposta_em_votacao_omite_o_execute_at() {
        // `executeAt` só nasce no `#tallyProposal`, ao atingir quórum. Enquanto a
        // proposta está em VOTING a chave NÃO existe — e aqui ela não pode virar
        // `null`, porque a referência não escreve `null`: ela não escreve nada.
        let p = Proposal { state: "VOTING".into(), execute_at: None, ..Default::default() };
        assert_eq!(
            chaves(&p.to_value()),
            ["createdAt", "deadline", "id", "param", "proposer", "status", "value", "votes"]
        );
    }
}

// ============================================================================
// Testes da maturação por bloco (matura_propostas / matura_permissoes /
// expira_ops_multisig) e da folha gov:params. Módulo próprio, auto-contido.
// ============================================================================
#[cfg(test)]
mod maturacao_tests {
    use super::*;
    use crate::address::derive_address_from;
    use crate::canonical::Value;
    use crate::state::{Account, State};
    use crate::stateroot::leaf;

    fn e(s: &str) -> String {
        derive_address_from(format!("MAT:{s}"))
    }

    fn com_stake(state: &mut State, addr: &str, staked: Amount) {
        state.accounts.insert(addr.to_string(), Account { staked, ..Default::default() });
    }

    fn proposta_madura(param: &str, value: ValorGov) -> Proposal {
        Proposal {
            id: format!("p-{param}"),
            param: param.to_string(),
            value,
            proposer: e("prop"),
            votes: BTreeMap::new(),
            deadline: 0,
            execute_at: Some(100),
            created_at: 1_700_000_000_000,
            state: "QUEUED".into(),
        }
    }

    // ---------------------------------------------------------- folha gov:params

    #[test]
    fn folha_de_params_usa_tag_inteiro_nao_texto() {
        // A divergência que o porte tinha: `params` codificado como texto (0x04)
        // enquanto a referência usa BigInt/Number → tag inteiro (0x03). Guardado de
        // forma independente reconstruindo a folha esperada dos dois jeitos.
        let mut s = State::new();
        s.params.insert("BLOCK_REWARD".into(), "1000".into());
        let folhas = s.state_leaves().unwrap();

        let como_int = leaf(
            "gov",
            "params",
            &Value::Map([("BLOCK_REWARD".to_string(), Value::Int("1000".into()))].into()),
        )
        .unwrap();
        let como_str = leaf(
            "gov",
            "params",
            &Value::Map([("BLOCK_REWARD".to_string(), Value::Str("1000".into()))].into()),
        )
        .unwrap();

        assert!(folhas.contains(&como_int), "folha de params tem de usar a tag INTEIRO");
        assert!(!folhas.contains(&como_str), "folha de params NÃO pode usar a tag texto");
    }

    // ---------------------------------------------------------- override escalar

    #[test]
    fn override_escalar_aplica_e_poda() {
        let mut s = State::new();
        let v = e("val");
        com_stake(&mut s, &v, MIN_VALIDATOR_STAKE); // mantém o conjunto não vazio
        s.proposals.insert(
            "p-BLOCK_REWARD".into(),
            proposta_madura("BLOCK_REWARD", ValorGov::Inteiro("777".into())),
        );

        matura_propostas(&mut s, 100).unwrap();

        assert_eq!(s.params.get("BLOCK_REWARD").map(String::as_str), Some("777"));
        assert!(s.proposals.is_empty(), "proposta madura tem de ser podada");
    }

    #[test]
    fn override_ainda_nao_maduro_nao_aplica() {
        let mut s = State::new();
        s.proposals.insert(
            "p-BLOCK_REWARD".into(),
            proposta_madura("BLOCK_REWARD", ValorGov::Inteiro("777".into())),
        );
        matura_propostas(&mut s, 99).unwrap(); // execute_at = 100
        assert!(s.params.is_empty());
        assert_eq!(s.proposals.len(), 1, "proposta ainda pendente permanece");
    }

    #[test]
    fn duas_propostas_do_mesmo_param_no_mesmo_bloco_ordem_canonica() {
        // O caso que torna a ordem observável: dois overrides do MESMO param maduros
        // no mesmo bloco. A ordem canônica por id aplica "p-a" e depois "p-b" — o de
        // id MAIOR escreve por último e vence. É o mesmo resultado que o JS produz
        // após `Object.keys(...).sort()`. Este teste trava esse acordo.
        let mut s = State::new();
        let v = e("val");
        com_stake(&mut s, &v, MIN_VALIDATOR_STAKE);
        let mut mk = |id: &str, valor: &str| {
            let mut p = proposta_madura("BLOCK_REWARD", ValorGov::Inteiro(valor.into()));
            p.id = id.to_string();
            s.proposals.insert(id.to_string(), p);
        };
        mk("p-a", "111");
        mk("p-b", "222");

        matura_propostas(&mut s, 100).unwrap();

        assert_eq!(
            s.params.get("BLOCK_REWARD").map(String::as_str),
            Some("222"),
            "o id lexicograficamente maior é aplicado por último e vence"
        );
        assert!(s.proposals.is_empty(), "ambas as propostas são podadas");
    }

    #[test]
    fn anti_trava_reverte_min_validator_stake_que_esvaziaria() {
        let mut s = State::new();
        let v = e("val");
        com_stake(&mut s, &v, MIN_VALIDATOR_STAKE); // único validador
        // Override elevaria o mínimo acima do stake do único validador → conjunto
        // vazio → trilho anti-trava reverte (sem valor anterior, remove).
        s.proposals.insert(
            "p-MIN_VALIDATOR_STAKE".into(),
            proposta_madura(
                "MIN_VALIDATOR_STAKE",
                ValorGov::Inteiro((MIN_VALIDATOR_STAKE * 2).to_string()),
            ),
        );

        matura_propostas(&mut s, 100).unwrap();

        assert!(
            !s.params.contains_key("MIN_VALIDATOR_STAKE"),
            "override que travaria a cadeia tem de ser revertido"
        );
        assert!(s.proposals.is_empty(), "a proposta ainda assim é podada");
    }

    #[test]
    fn override_min_validator_stake_seguro_persiste() {
        let mut s = State::new();
        let v = e("val");
        com_stake(&mut s, &v, MIN_VALIDATOR_STAKE * 4);
        // Novo mínimo continua abaixo do stake do validador → conjunto não vazio.
        s.proposals.insert(
            "p-MIN_VALIDATOR_STAKE".into(),
            proposta_madura(
                "MIN_VALIDATOR_STAKE",
                ValorGov::Inteiro((MIN_VALIDATOR_STAKE * 2).to_string()),
            ),
        );

        matura_propostas(&mut s, 100).unwrap();

        assert_eq!(
            s.params.get("MIN_VALIDATOR_STAKE").map(String::as_str),
            Some((MIN_VALIDATOR_STAKE * 2).to_string().as_str())
        );
    }

    // ---------------------------------------------------------- treasury spend

    #[test]
    fn treasury_spend_respeita_o_saldo() {
        let dest = e("dest");
        let obj = |amt: &str| {
            ValorGov::Objeto(
                [
                    ("amount".to_string(), JsonValue::str(amt)),
                    ("recipient".to_string(), JsonValue::str(&dest)),
                ]
                .into(),
            )
        };

        // Cobre: debita a tesouraria e credita o destino.
        let mut s = State::new();
        s.treasury = 1_000;
        s.proposals.insert("p-TREASURY_SPEND".into(), proposta_madura("TREASURY_SPEND", obj("400")));
        matura_propostas(&mut s, 100).unwrap();
        assert_eq!(s.treasury, 600);
        assert_eq!(s.balance_of(&dest), 400);

        // Não cobre: nada acontece (nem débito, nem crédito), mas a proposta é podada.
        let mut s = State::new();
        s.treasury = 100;
        s.proposals.insert("p-TREASURY_SPEND".into(), proposta_madura("TREASURY_SPEND", obj("400")));
        matura_propostas(&mut s, 100).unwrap();
        assert_eq!(s.treasury, 100, "tesouraria insuficiente não é debitada");
        assert_eq!(s.balance_of(&dest), 0);
        assert!(s.proposals.is_empty());
    }

    // ---------------------------------------------------------- ai attester

    #[test]
    fn ai_attester_maduro_e_de_fato_registrado() {
        // Fecha a lacuna anotada: o handler VALIDAVA mas a aplicação vivia no tick,
        // que não estava portado. Agora matura → entra em `ai_attesters`.
        let mut s = State::new();
        let obj = ValorGov::Objeto(
            [
                ("attesterId".to_string(), JsonValue::str("tee-1")),
                ("kind".to_string(), JsonValue::str("TEE")),
                ("measurement".to_string(), JsonValue::str("0xmeasure")),
                (
                    "members".to_string(),
                    JsonValue::List(vec![JsonValue::str("0x00000000000000000000000000000000000000aa")]),
                ),
                ("quorum".to_string(), JsonValue::Int(1)),
            ]
            .into(),
        );
        s.proposals.insert("p-AI_ATTESTER".into(), proposta_madura("AI_ATTESTER", obj));

        matura_propostas(&mut s, 4242).unwrap();

        let a = s.ai_attesters.get("tee-1").expect("atestador registrado");
        assert_eq!(a.kind, "TEE");
        assert_eq!(a.quorum, 1);
        assert_eq!(a.registered_at, 4242, "registeredAt é a ALTURA, não timestamp");
        assert_eq!(a.members, vec!["0x00000000000000000000000000000000000000aa".to_string()]);
    }

    // ---------------------------------------------------------- bridge committee

    #[test]
    fn bridge_committee_so_faz_bootstrap() {
        let obj = |q: i64| {
            ValorGov::Objeto(
                [
                    (
                        "members".to_string(),
                        JsonValue::List(vec![JsonValue::str("0xaa"), JsonValue::str("0xbb")]),
                    ),
                    ("quorum".to_string(), JsonValue::Int(q)),
                    ("sourceChain".to_string(), JsonValue::str("TRON")),
                ]
                .into(),
            )
        };

        let mut s = State::new();
        s.proposals.insert("p-BRIDGE_COMMITTEE".into(), proposta_madura("BRIDGE_COMMITTEE", obj(2)));
        matura_propostas(&mut s, 100).unwrap();
        assert_eq!(s.bridge_source_committees.get("TRON").map(|c| c.quorum), Some(2));

        // Segunda proposta madura para a MESMA origem NÃO substitui o comitê ativo:
        // trocar exige o handoff assinado pela origem.
        s.proposals.insert(
            "p-BRIDGE_COMMITTEE".into(),
            proposta_madura("BRIDGE_COMMITTEE", obj(1)),
        );
        matura_propostas(&mut s, 200).unwrap();
        assert_eq!(
            s.bridge_source_committees.get("TRON").map(|c| c.quorum),
            Some(2),
            "governança não pode trocar um comitê já ativo"
        );
    }

    // ---------------------------------------------------------- voting expira

    #[test]
    fn voting_expira_apos_o_deadline() {
        let mut s = State::new();
        let mut p = proposta_madura("BLOCK_REWARD", ValorGov::Inteiro("1".into()));
        p.state = "VOTING".into();
        p.execute_at = None;
        p.deadline = 50;
        s.proposals.insert("p-BLOCK_REWARD".into(), p);

        matura_propostas(&mut s, 50).unwrap();
        assert_eq!(s.proposals.len(), 1, "no deadline exato ainda vive (height > deadline)");

        matura_propostas(&mut s, 51).unwrap();
        assert!(s.proposals.is_empty(), "expira depois do deadline");
    }

    // ---------------------------------------------------------- ops multisig

    #[test]
    fn ops_multisig_expiram_apos_o_prazo() {
        let mut s = State::new();
        let conta = e("conta");
        let mk = |deadline: u64| PendingOp {
            account: conta.clone(),
            op: BTreeMap::new(),
            approvals: BTreeMap::new(),
            weight: 0,
            permission_id: 0,
            created_at: 1_700_000_000_000,
            deadline,
        };
        s.pending_ops.insert("viva".into(), mk(100));
        s.pending_ops.insert("morta".into(), mk(40));

        expira_ops_multisig(&mut s, 50);

        assert!(s.pending_ops.contains_key("viva"), "prazo no futuro permanece");
        assert!(!s.pending_ops.contains_key("morta"), "prazo vencido é removido");
    }

    // ---------------------------------------------------------- timelock de perm

    fn perm_owner_a(a: &str) -> Permission {
        Permission::V2 {
            owner: Nivel { threshold: 1, keys: [(a.to_string(), 1u64)].into() },
            actives: vec![Active {
                nivel: Nivel { threshold: 1, keys: [(a.to_string(), 1u64)].into() },
                name: None,
                operations: None,
            }],
            witness: None,
            recovery: None,
            delay_blocks: 0,
        }
    }

    #[test]
    fn timelock_de_permissao_aplica_quando_autorizado() {
        let mut s = State::new();
        let conta = e("conta");
        let a = e("chaveA");
        s.permissions.insert(conta.clone(), perm_owner_a(&a));
        s.pending_perm.insert(
            conta.clone(),
            PendingPerm {
                change: Mudanca::Delay(50),
                approvals: [(a.clone(), true)].into(), // owner atinge o limiar
                vetoes: BTreeMap::new(),
                execute_at: Some(10),
                proposed_at: 0,
            },
        );

        matura_permissoes(&mut s, 10);

        assert!(s.pending_perm.is_empty(), "a pendência é consumida");
        match s.permissions.get(&conta) {
            Some(Permission::V2 { delay_blocks, .. }) => assert_eq!(*delay_blocks, 50),
            _ => panic!("mudança de delay deveria ter sido aplicada"),
        }
    }

    #[test]
    fn timelock_nao_aplica_sem_autorizacao_mas_consome() {
        let mut s = State::new();
        let conta = e("conta");
        let a = e("chaveA");
        s.permissions.insert(conta.clone(), perm_owner_a(&a));
        s.pending_perm.insert(
            conta.clone(),
            PendingPerm {
                change: Mudanca::Delay(50),
                approvals: BTreeMap::new(), // ninguém aprovou → não atinge o limiar
                vetoes: BTreeMap::new(),
                execute_at: Some(10),
                proposed_at: 0,
            },
        );

        matura_permissoes(&mut s, 10);

        assert!(s.pending_perm.is_empty(), "consome a pendência em qualquer desfecho");
        match s.permissions.get(&conta) {
            Some(Permission::V2 { delay_blocks, .. }) => {
                assert_eq!(*delay_blocks, 0, "sem autorização, a permissão vigente permanece")
            }
            _ => panic!("permissão sumiu"),
        }
    }

    #[test]
    fn timelock_nao_iniciado_e_ignorado() {
        let mut s = State::new();
        let conta = e("conta");
        let a = e("chaveA");
        s.permissions.insert(conta.clone(), perm_owner_a(&a));
        s.pending_perm.insert(
            conta.clone(),
            PendingPerm {
                change: Mudanca::Delay(50),
                approvals: [(a.clone(), true)].into(),
                vetoes: BTreeMap::new(),
                execute_at: None, // timelock ainda não começou
                proposed_at: 0,
            },
        );

        matura_permissoes(&mut s, 1_000_000);

        assert_eq!(s.pending_perm.len(), 1, "sem execute_at a pendência não matura");
    }

    /// Conta mapeada de EAVM (`eavm_managed`) NÃO entra no conjunto ativo da
    /// governança — como não entra em `blockchain::validators` nem na guarda do
    /// último validador.
    ///
    /// Ela não tem par de chaves híbrido: receberia slots de produção que ficariam
    /// eternamente vazios. E como o quórum é 2/3+1 dos ATIVOS, incluí-la aqui
    /// mudaria o denominador — este nó apuraria uma votação com resultado
    /// diferente do resto da rede, sobre os mesmos votos.
    #[test]
    fn conta_gerenciada_pela_eavm_fica_fora_do_conjunto_ativo() {
        let mut s = State::new();
        let humana = crate::address::derive_address_from("gov:humana");
        let evm = crate::address::derive_address_from("gov:evm");
        // A conta EVM tem MAIS stake — se entrasse, entraria no topo.
        s.accounts.insert(
            humana.clone(),
            Account { staked: MIN_VALIDATOR_STAKE * 2, ..Default::default() },
        );
        s.accounts.insert(
            evm.clone(),
            Account {
                staked: MIN_VALIDATOR_STAKE * 100,
                eavm_managed: true,
                ..Default::default()
            },
        );

        let ativos = validadores(&s, None).expect("conjunto ativo");
        assert_eq!(ativos, vec![humana.clone()], "só a conta com chaves híbridas produz");

        // E o mesmo filtro tem de valer com `override_stake` — o caminho que o
        // UNSTAKE multiassinatura usa para simular a remoção sem mutar o estado.
        let com_override = validadores(&s, Some((&evm, MIN_VALIDATOR_STAKE * 1000)))
            .expect("conjunto ativo");
        assert_eq!(com_override, vec![humana], "nem simulando stake maior ela entra");
    }

    // ------------------------------------------------- ida e volta canônica
    //
    // Cada caso preenche TODOS os campos com valores distintos: dois campos iguais
    // esconderiam uma troca de nomes no decodificador.

    fn nivel_cheio() -> Nivel {
        Nivel { threshold: 3, keys: [("E7K1".to_string(), 1u64), ("E7K2".to_string(), 2)].into() }
    }

    fn active_cheia() -> Active {
        Active {
            nivel: nivel_cheio(),
            name: Some("gastos".into()),
            operations: Some(vec!["TRANSFER".into(), "VOTE".into()]),
        }
    }

    #[test]
    fn nivel_e_active_sobrevivem_a_ida_e_volta() {
        let n = nivel_cheio();
        assert_eq!(Nivel::from_value(&n.to_value()), Some(n));

        let a = active_cheia();
        assert_eq!(Active::from_value(&a.to_value(7), 7), Some(a.clone()));
        // O `id` gravado é POSICIONAL: lido de outra posição, a active é recusada.
        assert_eq!(Active::from_value(&a.to_value(7), 8), None);

        // Sem nome e sem escopo as duas chaves SOMEM — e a ausência volta como
        // `None`, não como vazio (escopo vazio seria "nenhuma operação permitida").
        let magra = Active { nivel: nivel_cheio(), name: None, operations: None };
        assert_eq!(Active::from_value(&magra.to_value(0), 0), Some(magra));
    }

    #[test]
    fn permissao_v1_e_v2_sobrevivem_a_ida_e_volta() {
        let v1 = Permission::V1(nivel_cheio());
        assert_eq!(Permission::from_value(&v1.to_value()), Some(v1));

        let v2 = Permission::V2 {
            owner: nivel_cheio(),
            actives: vec![active_cheia(), Active { name: Some("outra".into()), ..active_cheia() }],
            witness: Some("E7WITNESS".into()),
            recovery: Some("E7RECOVERY".into()),
            delay_blocks: 4_321,
        };
        assert_eq!(Permission::from_value(&v2.to_value()), Some(v2));

        // v2 SEM witness/recovery: as chaves somem e voltam como `None`.
        let magra = Permission::V2 {
            owner: nivel_cheio(),
            actives: vec![],
            witness: None,
            recovery: None,
            delay_blocks: 1,
        };
        assert_eq!(Permission::from_value(&magra.to_value()), Some(magra));
    }

    #[test]
    fn operacao_pendente_sobrevive_a_ida_e_volta() {
        let op = PendingOp {
            account: "E7CONTA".into(),
            op: [
                ("type".to_string(), JsonValue::str("TRANSFER")),
                ("to".to_string(), JsonValue::str("E7DESTINO")),
                ("amount".to_string(), JsonValue::Int(-7)),
                ("flag".to_string(), JsonValue::Bool(true)),
                ("nada".to_string(), JsonValue::Null),
                ("lista".to_string(), JsonValue::List(vec![JsonValue::Int(1)])),
            ]
            .into(),
            approvals: [("E7K1".to_string(), 2u64)].into(),
            weight: 2,
            permission_id: 1,
            created_at: -1_700_000_000_000,
            deadline: 987,
        };
        assert_eq!(PendingOp::from_value(&op.to_value()), Some(op));
    }

    #[test]
    fn mudanca_pendente_sobrevive_a_ida_e_volta() {
        let pp = PendingPerm {
            change: Mudanca::Delay(99),
            approvals: [("E7K1".to_string(), true)].into(),
            vetoes: [("E7K2".to_string(), false)].into(),
            execute_at: Some(1_234),
            proposed_at: 1_000,
        };
        assert_eq!(PendingPerm::from_value(&pp.to_value()), Some(pp.clone()));

        // `executeAt` NULO é timelock não iniciado — a chave EXISTE valendo nulo.
        let sem = PendingPerm { execute_at: None, ..pp };
        assert_eq!(PendingPerm::from_value(&sem.to_value()), Some(sem));
    }

    #[test]
    fn toda_variante_de_mudanca_sobrevive_a_ida_e_volta() {
        let casos = vec![
            Mudanca::Owner(nivel_cheio()),
            Mudanca::Active { id: 2, valor: Some(Box::new(active_cheia())) },
            // Remoção: `value: null`, que NÃO é o mesmo que chave ausente.
            Mudanca::Active { id: 1, valor: None },
            Mudanca::Witness(Some("E7W".into())),
            Mudanca::Witness(None),
            Mudanca::Recovery(Some("E7R".into())),
            Mudanca::Recovery(None),
            Mudanca::Delay(4_000),
        ];
        for c in casos {
            assert_eq!(Mudanca::from_value(&c.to_value()), Some(c.clone()), "falhou em {c:?}");
        }
    }

    #[test]
    fn proposta_sobrevive_a_ida_e_volta_nas_duas_formas_de_valor() {
        let base = Proposal {
            id: "p-1".into(),
            param: "BLOCK_REWARD".into(),
            value: ValorGov::Inteiro("1000000000000000000000".into()),
            proposer: "E7PROPONENTE".into(),
            votes: [("E7A".to_string(), true), ("E7B".to_string(), false)].into(),
            deadline: 5_000,
            execute_at: Some(6_000),
            created_at: 1_700_000_000_001,
            state: "PASSED".into(),
        };
        assert_eq!(Proposal::from_value(&base.to_value()), Some(base.clone()));

        // Sem quórum a chave `executeAt` SOME — ao contrário de `PendingPerm`, que
        // a escreve como nulo.
        let sem = Proposal { execute_at: None, ..base.clone() };
        assert_eq!(Proposal::from_value(&sem.to_value()), Some(sem));

        // Valor ESTRUTURADO: tag de mapa em vez de inteiro.
        let objeto = Proposal {
            value: ValorGov::Objeto(
                [
                    ("quorum".to_string(), JsonValue::Int(2)),
                    ("sourceChain".to_string(), JsonValue::str("TRON")),
                ]
                .into(),
            ),
            ..base
        };
        assert_eq!(Proposal::from_value(&objeto.to_value()), Some(objeto));
    }

    #[test]
    fn forma_invalida_de_permissao_e_recusada_sem_panico() {
        assert_eq!(Permission::from_value(&Value::Null), None);
        assert_eq!(Nivel::from_value(&Value::List(vec![])), None);
        // v2 com uma chave a mais é campo que este decodificador não sabe ler.
        let Value::Map(mut m) = Permission::V2 {
            owner: nivel_cheio(),
            actives: vec![],
            witness: None,
            recovery: None,
            delay_blocks: 1,
        }
        .to_value() else {
            panic!("mapa")
        };
        m.insert("threshold".into(), Value::uint(1u128));
        assert_eq!(Permission::from_value(&Value::Map(m)), None);
    }
}
