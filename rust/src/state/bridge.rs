//! Ponte cross-chain.
//!
//! Reproduz os casos `BRIDGE_*` de `src/core/state.js` (o nó de referência),
//! incluindo as checagens de altura de fork — que são o que impede este cliente de
//! aceitar o que a rede rejeita (ou o contrário, que é pior: cunhar do nada).
//!
//! # O que este módulo está defendendo
//!
//! O achado C1 da auditoria: a ponte era **1-de-N**. Um único relayer comprometido
//! atestava um depósito que nunca existiu e a liberação cunhava tokens do nada. A
//! correção tem três camadas, e as três estão aqui:
//!
//! 1. **Quórum de federação** (`BRIDGE_QUORUM_HEIGHT`) — a partir do fork exige a
//!    MAIORIA dos relayers autorizados atestando o MESMO depósito.
//! 2. **Prova de comitê** (`BRIDGE_PROOF_HEIGHT`) — a partir do fork a autoridade
//!    deixa de ser a federação e passa a ser a assinatura do comitê da cadeia de
//!    ORIGEM sobre o evento exato. Falha FECHADA: sem prova válida, não libera.
//! 3. **Circuit breaker** (`BRIDGE_BREAKER_HEIGHT`) — teto de velocidade por ativo
//!    numa janela deslizante, para que um comprometimento total dos dois primeiros
//!    vire vazamento lento e observável em vez de dreno instantâneo.
//!
//! Abaixo de cada fork vale o comportamento ANTIGO. Não é conservadorismo: o
//! histórico já produzido precisa continuar validando no replay, senão este cliente
//! não consegue sincronizar a cadeia do zero.
//!
//! Invariante que vale para TODO manipulador deste módulo: se retornar `Err`, o
//! estado tem de estar exatamente como estava. Valide tudo ANTES de mutar. Aqui a
//! regra é mais rígida do que em qualquer outro domínio — uma mutação parcial numa
//! rejeição de `BRIDGE_IN` é, literalmente, cunhagem indevida.

use super::{soma, sub, Amount, Ctx, State, StateError};
use crate::canonical::Value;
use crate::transaction::{JsonValue, Tx};
use k256::ecdsa::{RecoveryId, Signature as EcdsaSignature, VerifyingKey};
use sha3::{Digest, Keccak256};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

// ============================================================================
// Constantes — valores de `src/config.js` (objeto `CHAIN`)
// ============================================================================

/// `CHAIN.BRIDGE_MIN_ATTESTATIONS` — nº mínimo de relayers distintos que precisam
/// atestar um depósito antes da liberação. 1 é o comportamento ANTIGO (ponto único
/// de falha, achado C1) e só sobrevive abaixo de `BRIDGE_QUORUM_HEIGHT`.
pub const BRIDGE_MIN_ATTESTATIONS: u64 = crate::config::BRIDGE_MIN_ATTESTATIONS;

/// `CHAIN.BRIDGE_QUORUM_HEIGHT` — a partir daqui o quórum efetivo vira
/// `max(BRIDGE_MIN_ATTESTATIONS, maioria dos relayers)`. Fork COORDENADO.
pub const BRIDGE_QUORUM_HEIGHT: u64 = crate::config::BRIDGE_QUORUM_HEIGHT;

/// `CHAIN.BRIDGE_PROOF_HEIGHT` — a partir daqui a ponte é TRUSTLESS: `BRIDGE_IN` só
/// libera com prova do comitê da cadeia de origem, e `BRIDGE_COMMITTEE_UPDATE`
/// (rotação de comitê) passa a existir.
pub const BRIDGE_PROOF_HEIGHT: u64 = crate::config::BRIDGE_PROOF_HEIGHT;

/// `CHAIN.BRIDGE_BREAKER_HEIGHT` — circuit breaker de liberação.
///
/// ATENÇÃO: na referência este valor lê `process.env.EAV7_BRIDGE_BREAKER_HEIGHT`,
/// caindo para 100_000_000 (dormente) sem a variável. Aqui é a constante dormente,
/// e é uma DIVERGÊNCIA CONHECIDA: quando o rollout coordenado definir a altura por
/// env nos nós JS, este valor tem de ser editado junto, ou este cliente aceitaria
/// liberações que a rede passou a rejeitar. Um fork por configuração de ambiente é
/// exatamente o tipo de coisa que um segundo cliente torna visível.
pub const BRIDGE_BREAKER_HEIGHT: u64 = crate::config::BRIDGE_BREAKER_HEIGHT;

/// `CHAIN.BRIDGE_BREAKER_WINDOW_BLOCKS` — ~1h a 1 bloco/s.
pub const BRIDGE_BREAKER_WINDOW_BLOCKS: u64 = crate::config::BRIDGE_BREAKER_WINDOW_BLOCKS;

/// `CHAIN.BRIDGE_BREAKER_BPS` — 30% do pool por janela. GOVERNÁVEL: `state.params`
/// sobrescreve, e por isso a leitura passa por `param_bps`, não pela constante.
pub const BRIDGE_BREAKER_BPS: u128 = crate::config::BRIDGE_BREAKER_BPS as u128;

/// Denominador de basis points.
const BPS_DENOM: u128 = 10_000;

/// Teto de membros de um comitê (`src/core/state.js`, `BRIDGE_COMMITTEE_UPDATE`).
/// Existe para limitar o custo de `recover` secp256k1 por transação (DoS de cripto).
const MAX_COMMITTEE_MEMBERS: usize = 200;

// ============================================================================
// Tipos
// ============================================================================

/// Estado da ponte cross-chain.
///
/// Os nomes dos campos espelham `state.bridge` da referência, que entra na folha
/// `brg:state` do `stateRoot`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Bridge {
    pub transfers: BTreeMap<String, Transfer>,
    pub locked_native: Amount,
    pub locked_tokens: BTreeMap<String, Amount>,
    /// Anti-replay de ENTRADA: `CHAIN:sourceTxHash` → id da tx que liberou.
    ///
    /// Guarda o id (e não um booleano) porque é o que a referência guarda e o que
    /// entra na folha do `stateRoot`. É a estrutura que NÃO é podável: perder uma
    /// chave daqui reabre o replay de um depósito já pago.
    pub processed_inbound: BTreeMap<String, String>,
    /// Atestações em andamento, agrupadas por (depósito, destino, valor, ativo).
    pub attestations: BTreeMap<String, Attestation>,
    /// Janela do circuit breaker. Só ganha entradas a partir de
    /// `BRIDGE_BREAKER_HEIGHT` — antes do fork a chave nem existe na referência, e
    /// criá-la mudaria a serialização de `state.bridge` (logo, o `stateRoot`).
    pub release_log: Vec<Release>,
}

/// Transferência da ponte.
///
/// A referência NÃO tem um formato só: são quatro objetos literais diferentes,
/// escolhidos por DIREÇÃO e por ESTÁGIO (`src/core/state.js`) —
///
/// | literal                   | chaves exclusivas                                |
/// |---------------------------|--------------------------------------------------|
/// | saída travada (`:2386`)   | `from`, `targetChain`, `targetAddress`           |
/// | saída liquidada (`:2556`) | as acima + `settledBy`, `externalTxHash`, `settledAt` |
/// | entrada atestada (`:2513`)| `relayer`, `to`, `source*`, `attestations`, `quorum` |
/// | entrada liberada (`:2539`)| idem, MENOS `quorum`                             |
///
/// O porte guardava a UNIÃO dos quatro numa struct plana com sete `Option`, e o
/// resultado era que o tipo aceitava estados que o protocolo nunca produz: uma
/// saída com `sourceTxHash`, uma entrada `PAID`, uma liberação com `quorum`. Cada
/// uma delas é uma folha `brg:state` diferente da rede — ou seja, um fork silencioso.
///
/// Com o `enum` a forma canônica deixa de ser reconstruída por convenção ("`None`
/// ⇒ a chave some") e passa a ser uma consequência do tipo: o ramo do `match` é o
/// literal da referência, e não existe caminho que emita a chave de outro literal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Transfer {
    /// `BRIDGE_OUT`: travou na EAV7 para pagamento na cadeia de destino.
    Out(Saida),
    /// `BRIDGE_IN`: liberação (ou atestação em curso) vinda da cadeia de origem.
    In(Entrada),
}

/// Metade OUT. Não tem `sourceChain`/`sourceTxHash`/`attestations`/`quorum`, e o
/// tipo é o que garante isso — não um `Option` que alguém pode preencher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Saida {
    pub id: String,
    /// Quem travou. Obrigatório: é `tx.from`, nunca ausente.
    pub from: String,
    pub target_chain: String,
    pub target_address: String,
    /// `None` = ativo NATIVO (EAV7); `Some(id)` = token EAV20. ATENÇÃO: aqui `None`
    /// NÃO omite a chave — ver o bloco de serialização.
    pub token: Option<String>,
    pub amount: Amount,
    pub created_at: i64,
    pub liquidacao: Liquidacao,
}

/// Estágio de uma saída. Os dois estados que a referência produz, e só eles.
///
/// A referência ainda testa `status !== 'LOCKED'` depois de descartar `'PAID'` — um
/// terceiro estado que o JS admite porque o objeto é destrancado. Aqui esse ramo
/// deixou de ser alcançável, que é exatamente o ganho pretendido.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Liquidacao {
    /// `status: "LOCKED"`.
    Travada,
    /// `status: "PAID"` — `BRIDGE_SETTLE` grava os três campos DE UMA VEZ
    /// (`state.js:2556-2559`), então eles vivem juntos na variante. Era o motivo do
    /// discriminante frágil `settled_at.is_some()` na versão anterior.
    Paga {
        settled_by: String,
        /// `null` quando `data.externalTxHash` não é texto — a chave EXISTE mesmo
        /// assim, e é por isso que ela não pode ser o discriminante da liquidação.
        external_tx_hash: Option<String>,
        settled_at: i64,
    },
}

/// Metade IN. Não tem `from`/`target*`, nem liquidação: uma entrada nunca é `PAID`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entrada {
    pub id: String,
    /// O relayer que apresentou esta atestação.
    pub relayer: String,
    /// Destinatário na EAV7.
    pub to: String,
    pub source_chain: String,
    pub source_tx_hash: String,
    pub token: Option<String>,
    pub amount: Amount,
    /// Quantos relayers distintos já atestaram este depósito.
    pub attestations: u64,
    pub created_at: i64,
    pub estagio: Estagio,
}

/// Estágio de uma entrada.
///
/// A diferença entre as duas variantes é UMA chave — e é a razão de o enum existir:
/// o literal da liberação (`state.js:2539`) não escreve `quorum`, o da atestação
/// (`:2513`) escreve. Guardar `quorum: Option<u64>` numa struct plana deixava
/// "liberada com quórum" representável, e essa folha não existe na rede.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Estagio {
    /// `status: "ATTESTED"` — ainda falta quórum. Emite `quorum`.
    Atestada { quorum: u64 },
    /// `status: "RELEASED"` — pagou. NÃO emite `quorum`.
    Liberada,
}

impl Transfer {
    /// `"OUT"` ou `"IN"` — o campo `direction` da referência, derivado da variante
    /// em vez de guardado. Um texto guardado poderia contradizer a forma do objeto.
    pub fn direction(&self) -> &'static str {
        match self {
            Transfer::Out(_) => "OUT",
            Transfer::In(_) => "IN",
        }
    }

    /// `status` da referência. Também derivado: os quatro valores possíveis são
    /// exatamente os quatro estágios.
    pub fn status(&self) -> &'static str {
        match self {
            Transfer::Out(s) => match s.liquidacao {
                Liquidacao::Travada => "LOCKED",
                Liquidacao::Paga { .. } => "PAID",
            },
            Transfer::In(e) => match e.estagio {
                Estagio::Atestada { .. } => "ATTESTED",
                Estagio::Liberada => "RELEASED",
            },
        }
    }

    pub fn id(&self) -> &str {
        match self {
            Transfer::Out(s) => &s.id,
            Transfer::In(e) => &e.id,
        }
    }

    pub fn amount(&self) -> Amount {
        match self {
            Transfer::Out(s) => s.amount,
            Transfer::In(e) => e.amount,
        }
    }

    /// `None` = ativo nativo.
    pub fn token(&self) -> Option<&str> {
        match self {
            Transfer::Out(s) => s.token.as_deref(),
            Transfer::In(e) => e.token.as_deref(),
        }
    }

    pub fn created_at(&self) -> i64 {
        match self {
            Transfer::Out(s) => s.created_at,
            Transfer::In(e) => e.created_at,
        }
    }
}

/// Atestações acumuladas de um mesmo depósito de origem.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Attestation {
    pub to: String,
    /// Decimal, como na referência (lá é `amount.toString()`).
    pub amount: String,
    pub token: Option<String>,
    /// Relayers que já atestaram, na ordem de chegada. Um relayer só entra uma vez.
    pub relayers: Vec<String>,
    pub created_at: i64,
}

/// Uma liberação registrada na janela do circuit breaker.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Release {
    pub height: u64,
    /// Id do token, ou `"NATIVE"`.
    pub asset: String,
    pub amount: Amount,
}

/// Comitê de uma cadeia de origem.
///
/// `epoch` é o que impede um handoff de ser reapresentado: cada rotação assina o
/// epoch SEGUINTE, então a mesma prova não serve duas vezes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Committee {
    pub source_chain: String,
    /// Endereços `0x…` (Ethereum) dos membros, em minúsculas.
    pub members: Vec<String>,
    pub quorum: u64,
    pub epoch: u64,
}

// ============================================================================
// Serialização canônica — folhas `brg:state` e `brg:committees` do `stateRoot`
//
// Uma armadilha domina este bloco e vale a pena isolá-la antes: `token` NÃO é um
// campo omitível. A referência escreve `token: token ?? null` em TODA transferência
// e atestação (`state.js:2391`, `:2509`, `:2515`), então a chave existe sempre —
// com `null` no ativo nativo. `null` tem tag própria (0x00) na codificação
// canônica, então omitir a chave dá outra folha. É o oposto da regra que vale para
// quase todos os outros `Option` daqui, e por isso está escrito duas vezes.
// ============================================================================

/// `token ?? null` — a chave existe SEMPRE, com `null` no ativo nativo. Isolada
/// numa função porque é a inversão da regra que vale para quase todo o resto do
/// arquivo, e repeti-la à mão em quatro lugares é como o erro entra.
fn token_ou_nulo(token: &Option<String>) -> Value {
    match token {
        Some(t) => Value::str(t.clone()),
        None => Value::Null,
    }
}

impl Transfer {
    /// Forma canônica de uma transferência dentro de `brg:state`.
    ///
    /// Cada variante emite EXATAMENTE o literal correspondente da referência. Não há
    /// mais a regra "`None` ⇒ a chave some" governando o resultado: a chave de um
    /// literal só é escrita no ramo daquele literal, então nenhuma combinação de
    /// campos consegue produzir uma folha que a rede não tem.
    pub fn to_value(&self) -> Value {
        match self {
            Transfer::Out(s) => s.to_value(),
            Transfer::In(e) => e.to_value(),
        }
    }

    /// Inverso exato de [`Self::to_value`]. `direction` é o discriminante — o mesmo
    /// campo que a referência grava, e o único que separa os dois pares de literais.
    pub fn from_value(v: &Value) -> Option<Self> {
        match v.mapa()?.get("direction")?.texto()? {
            "OUT" => Some(Transfer::Out(Saida::from_value(v)?)),
            "IN" => Some(Transfer::In(Entrada::from_value(v)?)),
            _ => None,
        }
    }
}

impl Saida {
    /// Literal de `BRIDGE_OUT` (`state.js:2386`), mais os três campos que
    /// `BRIDGE_SETTLE` acrescenta (`:2556-2559`).
    fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("amount".into(), Value::uint(self.amount));
        m.insert("createdAt".into(), Value::int(self.created_at));
        m.insert("direction".into(), Value::str("OUT"));
        m.insert("from".into(), Value::str(self.from.clone()));
        m.insert("id".into(), Value::str(self.id.clone()));
        m.insert("status".into(), Value::str(match self.liquidacao {
            Liquidacao::Travada => "LOCKED",
            Liquidacao::Paga { .. } => "PAID",
        }));
        m.insert("targetAddress".into(), Value::str(self.target_address.clone()));
        m.insert("targetChain".into(), Value::str(self.target_chain.clone()));
        // Ver o bloco acima: `token ?? null`, chave sempre presente.
        m.insert("token".into(), token_ou_nulo(&self.token));

        // Os três campos da liquidação vivem numa variante justamente porque a
        // referência os grava juntos. `externalTxHash` é escrito como `… : null`
        // quando não há hash externo, então a chave existe mesmo valendo nulo — o
        // que na versão anterior obrigava a escolher `settled_at` como
        // discriminante, e teria sumido com a folha se alguém tivesse "simplificado"
        // para `external_tx_hash.is_some()`.
        if let Liquidacao::Paga { settled_by, external_tx_hash, settled_at } = &self.liquidacao {
            m.insert("externalTxHash".into(), match external_tx_hash {
                Some(h) => Value::str(h.clone()),
                None => Value::Null,
            });
            m.insert("settledAt".into(), Value::int(*settled_at));
            m.insert("settledBy".into(), Value::str(settled_by.clone()));
        }
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// `status` decide a liquidação, e os três campos dela são exigidos JUNTOS:
    /// aceitar "PAID sem `settledBy`" ou "LOCKED com `settledAt`" recriaria em
    /// tempo de leitura as combinações que o enum apagou do domínio.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.get("direction")?.texto()? != "OUT" {
            return None;
        }
        let liquidacao = match m.get("status")?.texto()? {
            "LOCKED" => Liquidacao::Travada,
            "PAID" => Liquidacao::Paga {
                settled_by: m.get("settledBy")?.texto()?.to_string(),
                // A chave EXISTE mesmo valendo nulo — não é campo omitível.
                external_tx_hash: m.get("externalTxHash")?.texto_ou_nulo()?,
                settled_at: m.get("settledAt")?.inteiro()?,
            },
            _ => return None,
        };
        if m.len() != 9 + if matches!(liquidacao, Liquidacao::Paga { .. }) { 3 } else { 0 } {
            return None;
        }
        Some(Saida {
            id: m.get("id")?.texto()?.to_string(),
            from: m.get("from")?.texto()?.to_string(),
            target_chain: m.get("targetChain")?.texto()?.to_string(),
            target_address: m.get("targetAddress")?.texto()?.to_string(),
            token: m.get("token")?.texto_ou_nulo()?,
            amount: m.get("amount")?.inteiro()?,
            created_at: m.get("createdAt")?.inteiro()?,
            liquidacao,
        })
    }
}

impl Entrada {
    /// Literais de `BRIDGE_IN`: atestada (`state.js:2513`) e liberada (`:2539`). A
    /// ÚNICA diferença entre os dois é o `quorum`, e ela agora é estrutural.
    fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("amount".into(), Value::uint(self.amount));
        m.insert("attestations".into(), Value::uint(self.attestations));
        m.insert("createdAt".into(), Value::int(self.created_at));
        m.insert("direction".into(), Value::str("IN"));
        m.insert("id".into(), Value::str(self.id.clone()));
        m.insert("relayer".into(), Value::str(self.relayer.clone()));
        m.insert("sourceChain".into(), Value::str(self.source_chain.clone()));
        m.insert("sourceTxHash".into(), Value::str(self.source_tx_hash.clone()));
        m.insert("status".into(), Value::str(match self.estagio {
            Estagio::Atestada { .. } => "ATTESTED",
            Estagio::Liberada => "RELEASED",
        }));
        m.insert("to".into(), Value::str(self.to.clone()));
        m.insert("token".into(), token_ou_nulo(&self.token));
        if let Estagio::Atestada { quorum } = self.estagio {
            m.insert("quorum".into(), Value::uint(quorum));
        }
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`]. A ÚNICA diferença entre os dois
    /// literais é o `quorum`, então ele é exigido no estágio atestado e RECUSADO no
    /// liberado — "liberada com quórum" é folha que a rede não tem.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.get("direction")?.texto()? != "IN" {
            return None;
        }
        let estagio = match m.get("status")?.texto()? {
            "ATTESTED" => Estagio::Atestada { quorum: m.get("quorum")?.inteiro()? },
            "RELEASED" => Estagio::Liberada,
            _ => return None,
        };
        if m.len() != 11 + usize::from(matches!(estagio, Estagio::Atestada { .. })) {
            return None;
        }
        Some(Entrada {
            id: m.get("id")?.texto()?.to_string(),
            relayer: m.get("relayer")?.texto()?.to_string(),
            to: m.get("to")?.texto()?.to_string(),
            source_chain: m.get("sourceChain")?.texto()?.to_string(),
            source_tx_hash: m.get("sourceTxHash")?.texto()?.to_string(),
            token: m.get("token")?.texto_ou_nulo()?,
            amount: m.get("amount")?.inteiro()?,
            attestations: m.get("attestations")?.inteiro()?,
            created_at: m.get("createdAt")?.inteiro()?,
            estagio,
        })
    }
}

impl Attestation {
    /// Forma canônica de uma atestação em andamento (`state.js:2509`).
    ///
    /// `amount` é TEXTO — a referência grava `amount.toString()` aqui, enquanto
    /// `Transfer.amount` guarda o BigInt. Mesma armadilha do `frozen` do token: tags
    /// diferentes (0x04 contra 0x03) para o mesmo número. A struct já reflete isso
    /// no tipo (`String`), o que torna o erro difícil de cometer — mas o motivo
    /// precisa ficar escrito, senão a próxima refatoração "corrige" o tipo.
    fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("amount".into(), Value::str(self.amount.clone()));
        m.insert("createdAt".into(), Value::int(self.created_at));
        m.insert(
            "relayers".into(),
            // LISTA, não conjunto: a ordem é a de chegada e entra na folha.
            Value::List(self.relayers.iter().map(|r| Value::str(r.clone())).collect()),
        );
        m.insert("to".into(), Value::str(self.to.clone()));
        m.insert("token".into(), token_ou_nulo(&self.token));
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// `amount` volta como TEXTO CRU, sem converter para número: é assim que a
    /// struct o guarda, e reparsear introduziria uma segunda forma do mesmo valor.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 5 {
            return None;
        }
        Some(Attestation {
            to: m.get("to")?.texto()?.to_string(),
            amount: m.get("amount")?.texto()?.to_string(),
            token: m.get("token")?.texto_ou_nulo()?,
            relayers: m
                .get("relayers")?
                .lista()?
                .iter()
                .map(|r| Some(r.texto()?.to_string()))
                .collect::<Option<_>>()?,
            created_at: m.get("createdAt")?.inteiro()?,
        })
    }
}

impl Release {
    /// Uma entrada da janela do circuit breaker (`state.js:2533`).
    ///
    /// `amount` de novo é TEXTO (`amount.toString()`) e `height` é número. Os dois
    /// no mesmo objeto, como no `frozen` do token.
    fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("amount".into(), Value::str(self.amount.to_string()));
        m.insert("asset".into(), Value::str(self.asset.clone()));
        m.insert("height".into(), Value::uint(self.height));
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`]. `amount` está em TEXTO e `height` em
    /// inteiro, no mesmo objeto — ler os dois pelo mesmo caminho falha num deles.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 3 {
            return None;
        }
        Some(Release {
            height: m.get("height")?.inteiro()?,
            asset: m.get("asset")?.texto()?.to_string(),
            amount: m.get("amount")?.decimal_em_texto()?,
        })
    }
}

impl Bridge {
    /// Forma canônica da folha `brg:state`.
    ///
    /// O objeto nasce com cinco chaves (`state.js:39`) e `releaseLog` só APARECE na
    /// primeira liberação acima de `BRIDGE_BREAKER_HEIGHT`, via `??= []`. Por isso o
    /// log vazio tem de OMITIR a chave: emiti-la (mesmo como lista vazia) mudaria a
    /// folha `brg:state` de toda a cadeia anterior ao fork, e o replay do histórico
    /// deixaria de bater. É a mesma razão pela qual o manipulador só empurra no log
    /// acima da altura.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert(
            "attestations".into(),
            Value::Map(self.attestations.iter().map(|(k, a)| (k.clone(), a.to_value())).collect()),
        );
        m.insert("lockedNative".into(), Value::uint(self.locked_native));
        m.insert(
            "lockedTokens".into(),
            Value::Map(
                self.locked_tokens.iter().map(|(k, v)| (k.clone(), Value::uint(*v))).collect(),
            ),
        );
        m.insert(
            "processedInbound".into(),
            Value::Map(
                self.processed_inbound
                    .iter()
                    .map(|(k, v)| (k.clone(), Value::str(v.clone())))
                    .collect(),
            ),
        );
        if !self.release_log.is_empty() {
            m.insert(
                "releaseLog".into(),
                Value::List(self.release_log.iter().map(Release::to_value).collect()),
            );
        }
        m.insert(
            "transfers".into(),
            Value::Map(self.transfers.iter().map(|(k, t)| (k.clone(), t.to_value())).collect()),
        );
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// `releaseLog` AUSENTE é o log VAZIO — é a ponte de antes do fork do circuit
    /// breaker, quando a chave nem existia. Exigi-la recusaria todo snapshot de
    /// cadeia anterior ao fork.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        let release_log = match m.get("releaseLog") {
            None => Vec::new(),
            Some(l) => l.lista()?.iter().map(Release::from_value).collect::<Option<Vec<_>>>()?,
        };
        if m.len() != 5 + usize::from(!release_log.is_empty()) {
            return None;
        }
        Some(Bridge {
            transfers: m
                .get("transfers")?
                .mapa()?
                .iter()
                .map(|(k, t)| Some((k.clone(), Transfer::from_value(t)?)))
                .collect::<Option<_>>()?,
            locked_native: m.get("lockedNative")?.inteiro()?,
            locked_tokens: m
                .get("lockedTokens")?
                .mapa()?
                .iter()
                .map(|(k, x)| Some((k.clone(), x.inteiro()?)))
                .collect::<Option<_>>()?,
            processed_inbound: m
                .get("processedInbound")?
                .mapa()?
                .iter()
                .map(|(k, x)| Some((k.clone(), x.texto()?.to_string())))
                .collect::<Option<_>>()?,
            attestations: m
                .get("attestations")?
                .mapa()?
                .iter()
                .map(|(k, a)| Some((k.clone(), Attestation::from_value(a)?)))
                .collect::<Option<_>>()?,
            release_log,
        })
    }
}

impl Committee {
    /// Forma canônica de um comitê dentro da folha `brg:committees`.
    ///
    /// A referência grava `{ members, quorum, epoch }` — nos três pontos em que
    /// cria um comitê (gênese `state.js:870`, bootstrap por governança `:741`,
    /// handoff `:2427`).
    ///
    /// `source_chain` NÃO é emitido, e não é omissão: a cadeia é a CHAVE do mapa
    /// `bridgeSourceCommittees`, não um campo do objeto. Emiti-la duplicaria o dado
    /// dentro da folha e mudaria a raiz de toda ponte configurada — é o mesmo
    /// cuidado que `NameRecord` toma ao não guardar o próprio nome.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("epoch".into(), Value::uint(self.epoch));
        m.insert(
            "members".into(),
            Value::List(self.members.iter().map(|x| Value::str(x.clone())).collect()),
        );
        m.insert("quorum".into(), Value::uint(self.quorum));
        Value::Map(m)
    }

    /// Inverso de [`Self::to_value`] — e recebe a cadeia porque o `to_value` NÃO a
    /// emite: ela é a chave do mapa `bridgeSourceCommittees`. Um comitê que não
    /// sabe de que origem é não consegue validar prova nenhuma.
    pub fn from_value(v: &Value, source_chain: &str) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 3 {
            return None;
        }
        Some(Committee {
            source_chain: source_chain.to_string(),
            members: m
                .get("members")?
                .lista()?
                .iter()
                .map(|x| Some(x.texto()?.to_string()))
                .collect::<Option<_>>()?,
            quorum: m.get("quorum")?.inteiro()?,
            epoch: m.get("epoch")?.inteiro()?,
        })
    }
}

/// Tipos de transação que este módulo atende. O despacho em `mod.rs` usa esta
/// lista, então um tipo esquecido aqui vira erro de "tipo desconhecido" em vez de
/// falha silenciosa.
pub const TIPOS: &[&str] = &[
    "BRIDGE_IN",
    "BRIDGE_OUT",
    "BRIDGE_SETTLE",
    "BRIDGE_COMMITTEE_UPDATE",
];

type R<T> = Result<T, StateError>;

fn erro(msg: impl Into<String>) -> StateError {
    StateError(msg.into())
}

pub fn aplicar(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    match tx.tx_type.as_str() {
        "BRIDGE_OUT" => bridge_out(state, tx, ctx),
        "BRIDGE_IN" => bridge_in(state, tx, ctx),
        "BRIDGE_SETTLE" => bridge_settle(state, tx, ctx),
        "BRIDGE_COMMITTEE_UPDATE" => committee_update(state, tx, ctx),
        outro => Err(erro(format!("tipo de transação desconhecido: {outro}"))),
    }
}

// ============================================================================
// BRIDGE_OUT — trava na EAV7 para liberação em outra cadeia
// ============================================================================

/// Trava EAV7 (ou token EAV20) para pagamento na cadeia de destino.
///
/// É a metade que ALIMENTA o pool: o que sai por `BRIDGE_IN` só pode sair do que
/// entrou aqui. A conservação é verificada na entrada, contra `locked_*`.
fn bridge_out(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let dados = dados(tx)?;
    let id = tx_id(tx)?;

    let target_chain = texto(dados, "targetChain").ok_or_else(|| erro("targetChain inválida"))?;
    if !nome_de_cadeia_valido(target_chain) {
        return Err(erro("targetChain inválida"));
    }
    let target_address =
        texto(dados, "targetAddress").ok_or_else(|| erro("targetAddress inválido"))?;
    // `.length` do JS = unidades UTF-16 (`state.js:2386`). Medir em BYTES fazia
    // este cliente ACEITAR `"éé"` (2 no JS, 4 em bytes), que a rede recusa — e
    // travar fundos numa transferência que não existe do outro lado.
    let n = crate::state::coercao::js_len(target_address);
    if !(4..=128).contains(&n) {
        return Err(erro("targetAddress inválido"));
    }
    let amount = valor(tx)?;
    if amount == 0 {
        return Err(erro("valor da ponte deve ser positivo"));
    }
    let token = token(dados)?;

    // --- validação completa ANTES de qualquer mutação ---
    let saldo = state.account(&tx.from).balance;
    match &token {
        Some(t) => {
            let tk = state.tokens.get(t).ok_or_else(|| erro("token EAV20 inexistente"))?;
            if tk.balances.get(&tx.from).copied().unwrap_or(0) < amount {
                return Err(erro("saldo do token insuficiente"));
            }
            if saldo < ctx.fee {
                return Err(erro("saldo insuficiente para a taxa"));
            }
        }
        None => {
            // A soma é checada: `amount + fee` estourando não pode virar um total
            // pequeno que o saldo "cobre".
            if saldo < soma(amount, ctx.fee)? {
                return Err(erro("saldo insuficiente"));
            }
        }
    }

    // --- mutação ---
    match &token {
        Some(t) => {
            state.debitar(&tx.from, ctx.fee)?;
            let tk = state.tokens.get_mut(t).expect("existência conferida acima");
            let atual = tk.balances.get(&tx.from).copied().unwrap_or(0);
            tk.balances.insert(tx.from.clone(), sub(atual, amount)?);
            let travado = state.bridge.locked_tokens.entry(t.clone()).or_insert(0);
            *travado = soma(*travado, amount)?;
        }
        None => {
            state.debitar(&tx.from, soma(amount, ctx.fee)?)?;
            state.bridge.locked_native = soma(state.bridge.locked_native, amount)?;
        }
    }

    state.bridge.transfers.insert(
        id.clone(),
        // Nasce TRAVADA e sem nenhum campo de entrada: a variante não tem onde
        // guardar `sourceTxHash`, então "saída com dado de entrada" deixou de ser
        // uma combinação que este código pode escrever por engano.
        Transfer::Out(Saida {
            id,
            from: tx.from.clone(),
            target_chain: target_chain.to_uppercase(),
            target_address: target_address.to_string(),
            token,
            amount,
            created_at: tx.timestamp,
            liquidacao: Liquidacao::Travada,
        }),
    );
    Ok(())
}

// ============================================================================
// BRIDGE_IN — liberação vinda de outra cadeia
// ============================================================================

/// Libera na EAV7 um depósito ocorrido na cadeia de origem.
///
/// É O manipulador crítico do módulo: é o único ponto em que valor APARECE do lado
/// de cá sem uma transferência assinada pelo dono. Três coisas o seguram, e nenhuma
/// pode cair:
///
/// - **anti-replay** (`processed_inbound`): o mesmo depósito de origem é liberado
///   UMA vez. Sem isso a ponte é uma torneira aberta.
/// - **quórum / prova** (fork-gated): quem tem autoridade para afirmar que o
///   depósito existiu.
/// - **conservação**: nunca libera mais do que está travado.
fn bridge_in(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    // Gate de relayer autorizado. Acima de `BRIDGE_PROOF_HEIGHT` já não é a
    // autoridade de cunhagem (a prova do comitê é) — mas continua sendo o anti-spam
    // que impede qualquer conta financiada de disparar centenas de `recover`
    // secp256k1 de graça.
    if !state.bridge_relayers.iter().any(|r| r == &tx.from) {
        return Err(erro("remetente não é um relayer de ponte autorizado"));
    }
    let dados = dados(tx)?;
    let id = tx_id(tx)?;
    let to = tx.to.clone().ok_or_else(|| erro("endereço de destino inválido"))?;

    let source_chain = texto(dados, "sourceChain").ok_or_else(|| erro("sourceChain inválida"))?;
    if !nome_de_cadeia_valido(source_chain) {
        return Err(erro("sourceChain inválida"));
    }
    let source_tx_hash =
        texto(dados, "sourceTxHash").ok_or_else(|| erro("sourceTxHash inválida"))?;
    // `.length` do JS (`state.js:2455`). Aqui o erro era pior que no BRIDGE_OUT:
    // aceitar um `sourceTxHash` que a rede descartou faz este nó LIBERAR valor
    // por um evento que não existe para os demais.
    let n = crate::state::coercao::js_len(source_tx_hash);
    if !(4..=128).contains(&n) {
        return Err(erro("sourceTxHash inválida"));
    }
    let amount = valor(tx)?;
    if amount == 0 {
        return Err(erro("valor da ponte deve ser positivo"));
    }
    let token = token(dados)?;
    let chain_key = source_chain.to_uppercase();
    let ativo = token.clone().unwrap_or_else(|| "NATIVE".into());

    // M-2: a chave de REPLAY (o depósito de origem, uma vez e pronto) é separada da
    // chave de ATESTAÇÃO (que inclui destino/valor/ativo). Assim um relayer que
    // atesta valores errados forma um grupo próprio, que nunca atinge quórum, sem
    // conseguir travar o quórum honesto sobre o valor certo.
    let replay_key = format!("{chain_key}:{source_tx_hash}");
    let att_key = format!("{replay_key}:{to}:{amount}:{ativo}");
    if state.bridge.processed_inbound.contains_key(&replay_key) {
        return Err(erro("depósito de origem já processado (replay)"));
    }

    // --- validações antes de QUALQUER mutação ---
    let existente = state.bridge.attestations.get(&att_key);
    if existente.is_some_and(|a| a.relayers.iter().any(|r| r == &tx.from)) {
        return Err(erro("relayer já atestou este depósito"));
    }
    let att_count = existente.map(|a| a.relayers.len() as u64).unwrap_or(0) + 1;

    // Quórum efetivo. A partir do fork exige a MAIORIA dos relayers autorizados
    // (federação M-de-N); abaixo dele mantém o quórum antigo, para o replay do
    // histórico continuar válido. `height` e a contagem de relayers são estado de
    // consenso, então a decisão é idêntica em todos os nós.
    let relayer_count = state.bridge_relayers.len() as u64;
    let quorum = if ctx.height >= BRIDGE_QUORUM_HEIGHT {
        BRIDGE_MIN_ATTESTATIONS.max(relayer_count / 2 + 1)
    } else {
        BRIDGE_MIN_ATTESTATIONS
    };

    // Ponte trustless: acima do fork a AUTORIDADE é a prova do comitê da cadeia de
    // origem sobre o evento exato (destino, valor, ativo, hash da tx de origem).
    // Forjar exige as chaves de >= quórum do comitê, não a de um relayer. Sem prova
    // válida NÃO libera — falha fechada, nunca "libera na dúvida".
    let mut proof_release = false;
    if ctx.height >= BRIDGE_PROOF_HEIGHT {
        let comite = state
            .bridge_source_committees
            .get(&chain_key)
            .filter(|c| c.quorum > 0)
            .ok_or_else(|| erro(format!("sem comitê de origem registrado para {source_chain}")))?;
        let digest = bridge_event_digest(source_chain, source_tx_hash, &to, amount, token.as_deref());
        let sigs = dados.get("proof").and_then(|p| match p {
            JsonValue::Map(m) => m.get("sigs"),
            _ => None,
        });
        let validas = verify_committee_proof(&digest, sigs, &comite.members);
        if validas < comite.quorum {
            return Err(erro(format!(
                "prova do comitê insuficiente ({validas}/{})",
                comite.quorum
            )));
        }
        proof_release = true;
    }

    let vai_liberar = proof_release || att_count >= quorum;
    if vai_liberar {
        // Conservação: só sai o que entrou. Sem esta checagem, uma atestação com
        // quórum cunharia saldo do nada — que é exatamente o achado C1.
        let travado = match &token {
            Some(t) => {
                if !state.tokens.contains_key(t) {
                    return Err(erro("token EAV20 inexistente"));
                }
                state.bridge.locked_tokens.get(t).copied().unwrap_or(0)
            }
            None => state.bridge.locked_native,
        };
        if travado < amount {
            return Err(erro(match &token {
                Some(_) => "ponte não possui tokens travados suficientes",
                None => "ponte não possui EAV7 travado suficiente",
            }));
        }

        // Circuit breaker: a soma das liberações do ativo na janela deslizante não
        // pode passar de `BRIDGE_BREAKER_BPS` do pool no INÍCIO da janela. Falha
        // fechada — transforma um dreno total (relayer ou comitê comprometido) num
        // vazamento lento e observável. Determinístico: só depende de altura e de
        // valores que já são estado de consenso.
        if ctx.height >= BRIDGE_BREAKER_HEIGHT {
            let corte = corte_da_janela(ctx.height);
            let mut soma_janela: Amount = 0;
            for r in &state.bridge.release_log {
                if i128::from(r.height) > corte && r.asset == ativo {
                    soma_janela = soma(soma_janela, r.amount)?;
                }
            }
            // `travado` já EXCLUI o que foi liberado na janela — somar de volta
            // reconstrói o pool como estava no início dela.
            let pool_inicial = soma(travado, soma_janela)?;
            let cap = pool_inicial
                .checked_mul(param_bps(state)?)
                .ok_or_else(|| erro("estouro aritmético no cap do circuit breaker"))?
                / BPS_DENOM;
            let total = soma(soma_janela, amount)?;
            if total > cap {
                return Err(erro(format!(
                    "circuit breaker da ponte: limite de velocidade atingido (janela {total} > cap {cap})"
                )));
            }
        }
    }

    // --- mutação (todas as validações passaram) ---
    let att = state.bridge.attestations.entry(att_key.clone()).or_insert(Attestation {
        to: to.clone(),
        amount: amount.to_string(),
        token: token.clone(),
        relayers: Vec::new(),
        created_at: tx.timestamp,
    });
    att.relayers.push(tx.from.clone());
    let atestacoes = att.relayers.len() as u64;

    if !vai_liberar {
        state.bridge.transfers.insert(
            id.clone(),
            Transfer::In(Entrada {
                id,
                relayer: tx.from.clone(),
                to,
                source_chain: chain_key,
                source_tx_hash: source_tx_hash.to_string(),
                token,
                amount,
                attestations: atestacoes,
                created_at: tx.timestamp,
                // ATESTADA carrega o quórum vigente — e é a única variante que o
                // emite.
                estagio: Estagio::Atestada { quorum },
            }),
        );
        return Ok(());
    }

    match &token {
        Some(t) => {
            let travado = state.bridge.locked_tokens.entry(t.clone()).or_insert(0);
            *travado = sub(*travado, amount)?;
            let tk = state.tokens.get_mut(t).expect("existência conferida acima");
            let atual = tk.balances.get(&to).copied().unwrap_or(0);
            tk.balances.insert(to.clone(), soma(atual, amount)?);
        }
        None => {
            state.bridge.locked_native = sub(state.bridge.locked_native, amount)?;
            state.creditar(&to, amount)?;
        }
    }

    // O log da janela só passa a existir A PARTIR do fork do breaker: criá-lo antes
    // mudaria a serialização de `state.bridge`, que está no `stateRoot`, e quebraria
    // o replay dos blocos já produzidos. A poda mantém o log enxuto — e é
    // determinística, porque só olha altura.
    if ctx.height >= BRIDGE_BREAKER_HEIGHT {
        state.bridge.release_log.push(Release {
            height: ctx.height,
            asset: ativo,
            amount,
        });
        let corte = corte_da_janela(ctx.height);
        state.bridge.release_log.retain(|r| i128::from(r.height) > corte);
    }

    state.bridge.processed_inbound.insert(replay_key, id.clone());
    state.bridge.attestations.remove(&att_key);
    state.bridge.transfers.insert(
        id.clone(),
        Transfer::In(Entrada {
            id,
            relayer: tx.from.clone(),
            to,
            source_chain: chain_key,
            source_tx_hash: source_tx_hash.to_string(),
            token,
            amount,
            attestations: atestacoes,
            created_at: tx.timestamp,
            // LIBERADA não tem onde guardar `quorum` — o literal `state.js:2539` não
            // o escreve, e antes disso dependia de o manipulador LEMBRAR de deixar
            // `quorum: None`. Agora é o tipo que lembra.
            estagio: Estagio::Liberada,
        }),
    );
    Ok(())
}

/// Início da janela do breaker. Em `i128` porque a referência faz a conta em
/// `Number`, onde `height - WINDOW` pode ficar NEGATIVO (e aí toda entrada do log
/// entra na janela). `saturating_sub` em `u64` daria 0 e excluiria a altura 0 —
/// diferença que só aparece numa cadeia curta, que é justamente onde um teste não
/// olharia.
fn corte_da_janela(height: u64) -> i128 {
    i128::from(height) - i128::from(BRIDGE_BREAKER_WINDOW_BLOCKS)
}

/// `BRIDGE_BREAKER_BPS` vigente: o valor de governança, se houver, senão o padrão.
/// Espelha o `param()` da referência.
fn param_bps(state: &State) -> R<u128> {
    match state.params.get("BRIDGE_BREAKER_BPS") {
        Some(v) => v.parse::<u128>().map_err(|_| erro("BRIDGE_BREAKER_BPS inválido")),
        None => Ok(BRIDGE_BREAKER_BPS),
    }
}

// ============================================================================
// BRIDGE_SETTLE — confirmação idempotente de pagamento externo
// ============================================================================

/// Marca um `BRIDGE_OUT` como pago na cadeia externa.
///
/// Idempotência é o ponto: sem o registro on-chain, um relayer que reiniciasse
/// perderia o `Set` em memória e pagaria a mesma transferência duas vezes.
fn bridge_settle(state: &mut State, tx: &Tx, _ctx: &Ctx) -> R<()> {
    if !state.bridge_relayers.iter().any(|r| r == &tx.from) {
        return Err(erro("remetente não é um relayer de ponte autorizado"));
    }
    let dados = dados(tx)?;
    let transfer_id = texto(dados, "transferId")
        .ok_or_else(|| erro("transferência OUT inexistente"))?
        .to_string();

    // --- validação antes da mutação ---
    //
    // `Transfer::In(_)` cai no mesmo erro que "não existe", como na referência
    // (`transfer.direction !== 'OUT'`). O que MUDOU é o terceiro caso dela: o ramo
    // `status !== 'LOCKED'` → "transferência em estado inválido" tratava um terceiro
    // status que só existe porque no JS o objeto é destrancado. `Liquidacao` tem
    // duas variantes, o `match` é exaustivo, e esse estado não é mais representável —
    // logo a mensagem não tem como ser alcançada e foi removida em vez de virar um
    // ramo morto que dá falsa sensação de cobertura.
    let Some(Transfer::Out(s)) = state.bridge.transfers.get(&transfer_id) else {
        return Err(erro("transferência OUT inexistente"));
    };
    if matches!(s.liquidacao, Liquidacao::Paga { .. }) {
        return Err(erro("transferência já liquidada"));
    }
    let external = texto(dados, "externalTxHash").map(|s| s.to_string());

    // --- mutação ---
    let Some(Transfer::Out(s)) = state.bridge.transfers.get_mut(&transfer_id) else {
        // Inalcançável: a mesma chave foi conferida acima e nada mutou entre as duas
        // leituras. Um `expect` aqui seria um pânico em caminho de consenso por uma
        // conveniência de duas linhas.
        return Err(erro("transferência OUT inexistente"));
    };
    // Os três campos entram JUNTOS, porque a variante não admite metade deles.
    s.liquidacao = Liquidacao::Paga {
        settled_by: tx.from.clone(),
        external_tx_hash: external,
        settled_at: tx.timestamp,
    };
    Ok(())
}

// ============================================================================
// BRIDGE_COMMITTEE_UPDATE — rotação do comitê da cadeia de origem
// ============================================================================

/// Troca o comitê de uma cadeia de origem, com o handoff assinado pelo comitê ATUAL.
///
/// Sem isto, um comitê semeado na gênese seria eterno — e ficaria obsoleto assim que
/// os validadores da origem rodassem, deixando a ponte travada ou, pior, presa a um
/// conjunto de chaves que já não pertence a ninguém responsável.
fn committee_update(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    if ctx.height < BRIDGE_PROOF_HEIGHT {
        return Err(erro("rotação de comitê ainda não ativa"));
    }
    // Mesmo gate de relayer de `BRIDGE_IN`: sem ele, qualquer conta financiada
    // dispararia até 200 `recover` secp256k1 por ~0 de energia.
    if !state.bridge_relayers.iter().any(|r| r == &tx.from) {
        return Err(erro("remetente não é um relayer de ponte autorizado"));
    }
    let dados = dados(tx)?;
    let chain_key = dados
        .get("sourceChain")
        .and_then(escalar_como_texto)
        .unwrap_or_default()
        .to_uppercase();
    let atual = state
        .bridge_source_committees
        .get(&chain_key)
        .filter(|c| c.quorum > 0)
        .ok_or_else(|| erro("comitê de origem inexistente"))?;

    let nc = match dados.get("newCommittee") {
        Some(JsonValue::Map(m)) => m,
        _ => return Err(erro("novo comitê inválido")),
    };
    // `.map((m) => String(m).toLowerCase())` (state.js:2434): TODO item vira
    // texto — inclusive `null`, que vira o membro `"null"`. Lixo que nunca assina,
    // mas que CONTA em `members.length` e portanto no teto do `quorum`. Recusar
    // aqui (o que `escalar_como_texto` fazia, devolvendo `None` para não-escalar)
    // rejeitava um handoff que a rede aceita.
    let membros: Vec<String> = match nc.get("members") {
        Some(JsonValue::List(itens)) => itens
            .iter()
            .map(|m| crate::state::coercao::js_string_de(m).to_lowercase())
            .collect(),
        None => Vec::new(),
        _ => return Err(erro("nº de membros inválido")),
    };
    let quorum = nc.get("quorum").and_then(inteiro).ok_or_else(|| erro("quorum inválido"))?;

    if membros.is_empty() || membros.len() > MAX_COMMITTEE_MEMBERS {
        return Err(erro("nº de membros inválido"));
    }
    // Duplicata inflaria `members.length` e permitiria um quórum que, na prática,
    // uma chave só satisfaria — a contagem de assinaturas deduplica por endereço.
    if membros.iter().collect::<BTreeSet<_>>().len() != membros.len() {
        return Err(erro("membros duplicados"));
    }
    if quorum == 0 || quorum > membros.len() as u64 {
        return Err(erro("quorum inválido"));
    }

    // O epoch SEGUINTE entra no digest: é o que impede reapresentar um handoff
    // antigo para reverter o comitê a um conjunto de chaves já rotacionado.
    let novo_epoch = soma_u64(atual.epoch, 1)?;
    let digest = committee_update_digest(&chain_key, novo_epoch, &membros, quorum);
    let validas = verify_committee_proof(&digest, dados.get("sigs"), &atual.members);
    if validas < atual.quorum {
        return Err(erro(format!(
            "handoff sem quórum do comitê atual ({validas}/{})",
            atual.quorum
        )));
    }
    if state.account(&tx.from).balance < ctx.fee {
        return Err(erro("saldo insuficiente para a taxa"));
    }

    // --- mutação ---
    state.debitar(&tx.from, ctx.fee)?;
    state.bridge_source_committees.insert(
        chain_key.clone(),
        Committee {
            source_chain: chain_key,
            members: membros,
            quorum,
            epoch: novo_epoch,
        },
    );
    Ok(())
}

fn soma_u64(a: u64, b: u64) -> R<u64> {
    a.checked_add(b).ok_or_else(|| erro("estouro aritmético no epoch do comitê"))
}

// ============================================================================
// Provas de comitê — espelho de `src/bridge/proof.js`
// ============================================================================

/// Separador dos campos do digest: US (unit separator, 0x1f).
///
/// Não é decorativo. É um byte que não aparece em endereço, hash ou decimal, então
/// nenhuma combinação de campos consegue imitar outra — sem ele, `("AB","C")` e
/// `("A","BC")` assinariam o mesmo digest e uma prova de um depósito valeria para
/// outro.
const US: &str = "\u{1f}";

fn keccak256(dados: &[u8]) -> [u8; 32] {
    let mut h = Keccak256::new();
    h.update(dados);
    h.finalize().into()
}

/// Digest do evento de depósito de origem — o que o comitê assina.
///
/// Amarra TODOS os campos que definem a liberação: mudar destino, valor, ativo ou o
/// hash da tx de origem muda o digest, e a prova deixa de valer.
pub fn bridge_event_digest(
    source_chain: &str,
    source_tx_hash: &str,
    to: &str,
    amount: Amount,
    token: Option<&str>,
) -> [u8; 32] {
    let msg = [
        "EAV7-BRIDGE-IN",
        &source_chain.to_uppercase(),
        source_tx_hash,
        to,
        &amount.to_string(),
        token.unwrap_or("NATIVE"),
    ]
    .join(US);
    keccak256(msg.as_bytes())
}

/// Digest do handoff de comitê. Os membros entram ORDENADOS, para que o digest não
/// dependa da ordem em que o relayer os listou.
pub fn committee_update_digest(
    source_chain: &str,
    epoch: u64,
    members: &[String],
    quorum: u64,
) -> [u8; 32] {
    let mut ordenados: Vec<String> = members.iter().map(|m| m.to_lowercase()).collect();
    // Ordenação por unidade de código UTF-16, que é o `Array.prototype.sort` do JS.
    // Coincide com a ordem de bytes para todo o BMP (e endereços `0x…` são ASCII),
    // mas divergiria acima dele — e um digest diferente é uma prova rejeitada.
    ordenados.sort_by(|a, b| cmp_utf16(a, b));

    let mut partes = vec![
        "EAV7-BRIDGE-COMMITTEE".to_string(),
        source_chain.to_uppercase(),
        epoch.to_string(),
        quorum.to_string(),
    ];
    partes.extend(ordenados);
    keccak256(partes.join(US).as_bytes())
}

/// Digest da ATESTAÇÃO de IA (Fase 6) — `aiAttestDigest` (`bridge/proof.js:37`).
///
/// Cinco campos unidos por `\x1f` e keccak: o marcador de domínio, a tarefa, o
/// hash do resultado (MINÚSCULO — a referência força `toLowerCase()`), o id do
/// atestador e a medida do enclave. O `measurement` ausente entra como string
/// VAZIA (`?? ''`), não é omitido: omitir mudaria o número de separadores e,
/// portanto, o digest.
pub fn ai_attest_digest(
    task_id: &str,
    result_hash: &str,
    attester_id: &str,
    measurement: &str,
) -> [u8; 32] {
    let partes = [
        "EAV7-AI-ATTEST",
        task_id,
        &result_hash.to_lowercase(),
        attester_id,
        measurement,
    ];
    keccak256(partes.join(US).as_bytes())
}

fn cmp_utf16(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Conta assinaturas VÁLIDAS e DISTINTAS de membros do comitê sobre o digest.
///
/// Três propriedades que precisam sobreviver a qualquer refatoração:
///
/// - **dedup por endereço recuperado**: um membro conta UMA vez. É o que neutraliza
///   a maleabilidade de ECDSA — de `(r,s)` se deriva `(r,N−s)`, que é outra
///   assinatura válida da mesma chave; sem dedup, uma chave só encheria o quórum.
/// - **assinatura de não-membro é ignorada**, não fatal: uma sig de lixo no meio da
///   lista não derruba uma prova legítima.
/// - **teto em `members.len()`**: mais assinaturas que membros não pode agregar
///   nada, e cada uma custaria um `recover` secp256k1. Sem o teto, `sigs` vira
///   vetor de DoS de cripto.
///
/// Recebe os MEMBROS, não o comitê inteiro: a mesma contagem serve ao comitê da
/// ponte e ao atestador de IA da Fase 6 (`ai::Attester`), que têm `members`/
/// `quorum` mas são tipos distintos. Fabricar um `Committee` falso para reusar a
/// função seria o tipo de contorno que esconde a intenção.
pub fn verify_committee_proof(
    digest: &[u8; 32],
    sigs: Option<&JsonValue>,
    membros_do_comite: &[String],
) -> u64 {
    let membros: BTreeSet<String> = membros_do_comite.iter().map(|m| m.to_lowercase()).collect();
    let lista: &[JsonValue] = match sigs {
        Some(JsonValue::List(itens)) => itens,
        _ => &[],
    };
    let mut vistos: BTreeSet<String> = BTreeSet::new();
    for sig in lista.iter().take(membros.len()) {
        let Some(addr) = recuperar_endereco(digest, sig) else { continue };
        if membros.contains(&addr) {
            // O conjunto É o dedup: a segunda assinatura do mesmo membro não entra.
            vistos.insert(addr);
        }
    }
    vistos.len() as u64
}

/// Recupera o endereço `0x…` que assinou o digest, ou `None` se a assinatura for
/// inválida em qualquer aspecto.
///
/// Toda falha vira `None`, nunca pânico: `sigs` é entrada NÃO confiável, e um
/// `unwrap` aqui seria um DoS de uma linha.
fn recuperar_endereco(digest: &[u8; 32], sig: &JsonValue) -> Option<String> {
    let JsonValue::Map(m) = sig else { return None };
    let r = u256_be(m.get("r")?)?;
    let s = u256_be(m.get("s")?)?;
    let rec = u256_be(m.get("recId")?)?;
    // recId ∈ 0..=3, como na referência. Qualquer coisa acima dos 8 bits finais já
    // está fora da faixa.
    if rec[..31].iter().any(|b| *b != 0) || rec[31] > 3 {
        return None;
    }
    let rec_id = RecoveryId::from_byte(rec[31])?;
    // `from_scalars` rejeita r ou s fora de (0, N) — a mesma faixa que a referência
    // checa antes de recuperar. Note que NÃO se exige `s` baixo: a referência
    // também não exige, e a dedup por endereço já tira o proveito da maleabilidade.
    let assinatura = EcdsaSignature::from_scalars(r, s).ok()?;
    let vk = VerifyingKey::recover_from_prehash(digest, &assinatura, rec_id).ok()?;
    Some(eth_address_from_key(&vk))
}

/// Endereço Ethereum de uma chave: keccak256(x‖y) sem o prefixo SEC1, últimos 20
/// bytes, em minúsculas com `0x`.
fn eth_address_from_key(vk: &VerifyingKey) -> String {
    let ponto = vk.to_sec1_point(false);
    // 65 bytes: 0x04 ‖ x(32) ‖ y(32). O byte de prefixo NÃO entra na hash.
    let h = keccak256(&ponto.as_bytes()[1..]);
    format!("0x{}", hex::encode(&h[12..]))
}

// ============================================================================
// Leitura de `tx.data` — entrada não confiável
// ============================================================================

fn dados(tx: &Tx) -> R<&BTreeMap<String, JsonValue>> {
    match &tx.data {
        Some(JsonValue::Map(m)) => Ok(m),
        // Na referência, `const { x } = tx.data` sobre `undefined` lança TypeError e
        // a transação é rejeitada. Aqui é explícito.
        _ => Err(erro("campo data inválido")),
    }
}

/// O `id` da transação, que é a chave da transferência no estado. Ausente é erro:
/// uma transferência sem chave seria invisível para o `BRIDGE_SETTLE`.
fn tx_id(tx: &Tx) -> R<String> {
    tx.id.clone().ok_or_else(|| erro("transação sem id"))
}

/// `tx.amount` em e7. Já validado como decimal por `verify_transaction`, mas aqui é
/// reconferido: este módulo também é chamado em replay, onde a validação stateless
/// pode ter rodado noutra versão.
fn valor(tx: &Tx) -> R<Amount> {
    tx.amount.parse::<Amount>().map_err(|_| erro("amount inválido"))
}

fn texto<'a>(dados: &'a BTreeMap<String, JsonValue>, chave: &str) -> Option<&'a str> {
    match dados.get(chave) {
        Some(JsonValue::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

/// `data.token`: `None` = ativo nativo.
///
/// A referência testa `token != null`, então ausente e `null` são a mesma coisa. Um
/// escalar não-texto seria convertido por interpolação no JS (`String(123)`), e a
/// busca em `this.tokens` usaria essa forma — reproduzido aqui. Lista e mapa são
/// rejeitados: no JS virariam `"[object Object]"`, uma chave que nenhum token tem, e
/// o resultado é erro dos dois lados.
fn token(dados: &BTreeMap<String, JsonValue>) -> R<Option<String>> {
    match dados.get("token") {
        None | Some(JsonValue::Null) => Ok(None),
        Some(v) => escalar_como_texto(v)
            .map(|s| Some(s.to_string()))
            .ok_or_else(|| erro("token EAV20 inexistente")),
    }
}

/// Conversão de escalar para texto no estilo da interpolação do JS.
fn escalar_como_texto(v: &JsonValue) -> Option<std::borrow::Cow<'_, str>> {
    match v {
        JsonValue::Str(s) => Some(std::borrow::Cow::Borrowed(s)),
        JsonValue::Int(n) => Some(std::borrow::Cow::Owned(n.to_string())),
        JsonValue::Bool(b) => Some(std::borrow::Cow::Owned(b.to_string())),
        _ => None,
    }
}

/// Inteiro não-negativo vindo de `data` — o `Number(x)` da referência.
///
/// DELEGA a `coercao::js_number_seguro_de`. A versão anterior aceitava só número
/// e decimal em texto, "que é o que `Number(x)` aceita para os casos que o
/// relayer produz". A ressalva era o problema: o relayer é entrada NÃO CONFIÁVEL,
/// e `Number("0x10")` é 16 na rede. Um `BRIDGE_COMMITTEE_UPDATE` com
/// `quorum: "0x10"` era aceito lá e recusado aqui.
fn inteiro(v: &JsonValue) -> Option<u64> {
    u64::try_from(crate::state::coercao::js_number_seguro_de(v)?).ok()
}

/// Inteiro de 256 bits, big-endian, a partir de decimal, hex `0x…` ou número — as
/// formas que `BigInt(x)` aceita.
///
/// Acima de 2²⁵⁶ devolve `None`, e isso é fiel: um valor desse tamanho já está fora
/// de `(0, N)` e a referência o descartaria no `recover`.
fn u256_be(v: &JsonValue) -> Option<[u8; 32]> {
    let mut out = [0u8; 32];
    match v {
        JsonValue::Int(n) if *n >= 0 => {
            out[24..].copy_from_slice(&(*n as u64).to_be_bytes());
            Some(out)
        }
        JsonValue::Str(s) => {
            let s = s.trim();
            if let Some(h) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
                if h.is_empty() || h.len() > 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return None;
                }
                let pad = format!("{:0>64}", h);
                hex::decode_to_slice(pad, &mut out).ok()?;
                Some(out)
            } else {
                // Decimal por multiplicação sucessiva: evita trazer um bignum só para
                // isto. Estouro dos 32 bytes é `None`.
                if !s.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                for d in s.bytes() {
                    let mut carry = u32::from(d - b'0');
                    for byte in out.iter_mut().rev() {
                        let v = u32::from(*byte) * 10 + carry;
                        *byte = (v & 0xff) as u8;
                        carry = v >> 8;
                    }
                    if carry != 0 {
                        return None;
                    }
                }
                Some(out)
            }
        }
        _ => None,
    }
}

/// `/^[A-Z0-9_-]{2,32}$/i` da referência.
fn nome_de_cadeia_valido(s: &str) -> bool {
    (2..=32).contains(&s.len())
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

// ============================================================================
// Testes
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::token::Token;
    use k256::ecdsa::SigningKey;

    const RELAYER_A: &str = "E7AAAA";
    const RELAYER_B: &str = "E7BBBB";
    const RELAYER_C: &str = "E7CCCC";
    const DESTINO: &str = "E7DEST";

    /// Estado com pool travado e três relayers autorizados — o cenário em que o
    /// quórum de maioria (2-de-3) tem efeito.
    fn estado() -> State {
        let mut s = State::new();
        s.bridge_relayers = [RELAYER_A.into(), RELAYER_B.into(), RELAYER_C.into()].into_iter().collect();
        s.bridge.locked_native = 1_000_000;
        s
    }

    fn ctx(height: u64) -> Ctx {
        Ctx { height, block_ts: 1_700_000_000_000, fee: 0 }
    }

    fn tx_in(de: &str, id: &str, source_tx: &str, amount: &str) -> Tx {
        let mut tx = Tx::new("BRIDGE_IN", de, 1, 1_700_000_000_000);
        tx.to = Some(DESTINO.into());
        tx.amount = amount.into();
        tx.data = Some(JsonValue::map([
            ("sourceChain".into(), JsonValue::str("TRON")),
            ("sourceTxHash".into(), JsonValue::str(source_tx)),
        ]));
        tx.id = Some(id.into());
        tx
    }

    // ---------------------------------------------------------------- anti-replay

    #[test]
    fn a_mesma_prova_nunca_e_processada_duas_vezes() {
        if BRIDGE_QUORUM_HEIGHT == 0 { return; }
        // É a diferença entre ponte e torneira aberta: sem `processed_inbound`, o
        // mesmo depósito de origem pagaria infinitas vezes.
        let mut s = estado();
        let c = ctx(BRIDGE_QUORUM_HEIGHT - 1); // quórum antigo: 1 relayer basta

        aplicar(&mut s, &tx_in(RELAYER_A, "id1", "0xdep", "1000"), &c).expect("primeira libera");
        assert_eq!(s.balance_of(DESTINO), 1000);
        assert_eq!(s.bridge.locked_native, 999_000);

        // Mesma tx de origem, outro id de transação, outro relayer: continua replay.
        let antes = s.bridge.clone();
        let e = aplicar(&mut s, &tx_in(RELAYER_B, "id2", "0xdep", "1000"), &c).unwrap_err();
        assert_eq!(e.0, "depósito de origem já processado (replay)");
        assert_eq!(s.bridge, antes, "rejeição não pode mutar o estado");
        assert_eq!(s.balance_of(DESTINO), 1000, "não pode pagar duas vezes");
    }

    #[test]
    fn replay_ignora_destino_e_valor_alegados() {
        if BRIDGE_QUORUM_HEIGHT == 0 { return; }
        // A chave de replay é (cadeia, tx de origem) — não inclui destino nem valor.
        // Senão bastaria mudar 1 e7 no valor para "outro depósito" e sacar de novo.
        let mut s = estado();
        let c = ctx(BRIDGE_QUORUM_HEIGHT - 1);
        aplicar(&mut s, &tx_in(RELAYER_A, "id1", "0xdep", "1000"), &c).unwrap();

        let mut tx = tx_in(RELAYER_B, "id2", "0xdep", "999");
        tx.to = Some("E7OUTRO".into());
        assert!(aplicar(&mut s, &tx, &c).is_err());
        assert_eq!(s.balance_of("E7OUTRO"), 0);
    }

    // -------------------------------------------------------------------- quórum

    #[test]
    fn quorum_insuficiente_nao_libera() {
        if BRIDGE_PROOF_HEIGHT == 0 { return; }
        // Acima do fork, 3 relayers ⇒ quórum 2. Uma atestação só NÃO pode pagar.
        let mut s = estado();
        let c = ctx(BRIDGE_QUORUM_HEIGHT);

        aplicar(&mut s, &tx_in(RELAYER_A, "id1", "0xdep", "1000"), &c).unwrap();
        assert_eq!(s.balance_of(DESTINO), 0, "1-de-3 não pode cunhar (achado C1)");
        assert_eq!(s.bridge.locked_native, 1_000_000, "o pool não pode ter sido tocado");
        assert_eq!(s.bridge.transfers["id1"].status(), "ATTESTED");
        assert!(
            matches!(&s.bridge.transfers["id1"], Transfer::In(e) if e.estagio == Estagio::Atestada { quorum: 2 }),
            "3 relayers ⇒ quórum 2, gravado na variante ATESTADA"
        );
        assert!(s.bridge.processed_inbound.is_empty(), "sem liberação, sem replay key");

        // O segundo relayer fecha o quórum e aí sim libera.
        aplicar(&mut s, &tx_in(RELAYER_B, "id2", "0xdep", "1000"), &c).unwrap();
        assert_eq!(s.balance_of(DESTINO), 1000);
        assert_eq!(s.bridge.transfers["id2"].status(), "RELEASED");
        // A atestação é consumida na liberação.
        assert!(s.bridge.attestations.is_empty());
    }

    #[test]
    fn o_mesmo_relayer_nao_conta_duas_vezes() {
        if BRIDGE_PROOF_HEIGHT == 0 { return; }
        // Sem isto, o "quórum de N" seria satisfeito por UM relayer repetindo — que é
        // o achado C1 com outra roupa.
        let mut s = estado();
        let c = ctx(BRIDGE_QUORUM_HEIGHT);
        aplicar(&mut s, &tx_in(RELAYER_A, "id1", "0xdep", "1000"), &c).unwrap();
        let e = aplicar(&mut s, &tx_in(RELAYER_A, "id2", "0xdep", "1000"), &c).unwrap_err();
        assert_eq!(e.0, "relayer já atestou este depósito");
        assert_eq!(s.balance_of(DESTINO), 0);
    }

    #[test]
    fn atestacao_de_valor_errado_nao_bloqueia_o_quorum_honesto() {
        if BRIDGE_PROOF_HEIGHT == 0 { return; }
        // M-2: grupos de atestação separados por (destino, valor, ativo). Um relayer
        // mentiroso forma o próprio grupo, que nunca fecha quórum.
        let mut s = estado();
        let c = ctx(BRIDGE_QUORUM_HEIGHT);
        aplicar(&mut s, &tx_in(RELAYER_C, "id0", "0xdep", "999999"), &c).unwrap(); // mentira
        aplicar(&mut s, &tx_in(RELAYER_A, "id1", "0xdep", "1000"), &c).unwrap();
        aplicar(&mut s, &tx_in(RELAYER_B, "id2", "0xdep", "1000"), &c).unwrap();
        assert_eq!(s.balance_of(DESTINO), 1000, "o valor honesto passou");
    }

    #[test]
    fn abaixo_do_fork_vale_o_comportamento_antigo() {
        if BRIDGE_QUORUM_HEIGHT == 0 { return; }
        // O histórico já produzido precisa continuar validando: abaixo de
        // BRIDGE_QUORUM_HEIGHT, uma atestação basta mesmo com 3 relayers.
        let mut s = estado();
        aplicar(
            &mut s,
            &tx_in(RELAYER_A, "id1", "0xdep", "1000"),
            &ctx(BRIDGE_QUORUM_HEIGHT - 1),
        )
        .unwrap();
        assert_eq!(s.balance_of(DESTINO), 1000);

        // E na altura EXATA do fork já vale a regra nova — o limite é `>=`. Errar o
        // lado deste comparador é o bug clássico de port: o cliente aceitaria no
        // bloco do fork exatamente o que a rede rejeita.
        let mut s2 = estado();
        aplicar(&mut s2, &tx_in(RELAYER_A, "id1", "0xdep", "1000"), &ctx(BRIDGE_QUORUM_HEIGHT))
            .unwrap();
        assert_eq!(s2.balance_of(DESTINO), 0, "na altura do fork o quórum novo já vale");
    }

    // -------------------------------------------------------------- conservação

    #[test]
    fn nao_libera_mais_do_que_esta_travado() {
        if BRIDGE_QUORUM_HEIGHT == 0 { return; }
        let mut s = estado();
        s.bridge.locked_native = 500;
        let e = aplicar(
            &mut s,
            &tx_in(RELAYER_A, "id1", "0xdep", "1000"),
            &ctx(BRIDGE_QUORUM_HEIGHT - 1),
        )
        .unwrap_err();
        assert_eq!(e.0, "ponte não possui EAV7 travado suficiente");
        assert_eq!(s.balance_of(DESTINO), 0);
        assert_eq!(s.bridge.locked_native, 500);
    }

    #[test]
    fn saida_e_entrada_se_conservam() {
        if BRIDGE_PROOF_HEIGHT == 0 { return; }
        let mut s = State::new();
        s.bridge_relayers = [RELAYER_A.into()].into_iter().collect();
        s.account_mut("E7ALICE").balance = 5_000;

        let mut out = Tx::new("BRIDGE_OUT", "E7ALICE", 1, 1_700_000_000_000);
        out.amount = "3000".into();
        out.data = Some(JsonValue::map([
            ("targetChain".into(), JsonValue::str("tron")),
            ("targetAddress".into(), JsonValue::str("TXYZ12345")),
        ]));
        out.id = Some("out1".into());
        aplicar(&mut s, &out, &ctx(10)).unwrap();

        assert_eq!(s.balance_of("E7ALICE"), 2_000);
        assert_eq!(s.bridge.locked_native, 3_000);
        let Transfer::Out(saida) = &s.bridge.transfers["out1"] else { panic!("esperava OUT") };
        assert_eq!(saida.target_chain, "TRON");
        assert_eq!(saida.liquidacao, Liquidacao::Travada);

        // O que voltar pela entrada sai do que foi travado, e só até esse limite.
        aplicar(&mut s, &tx_in(RELAYER_A, "in1", "0xdep", "3000"), &ctx(10)).unwrap();
        assert_eq!(s.bridge.locked_native, 0);
        assert_eq!(s.balance_of(DESTINO), 3_000);
    }

    #[test]
    fn saida_de_token_trava_e_entrada_devolve() {
        if BRIDGE_PROOF_HEIGHT == 0 { return; }
        let mut s = State::new();
        s.bridge_relayers = [RELAYER_A.into()].into_iter().collect();
        let mut t = Token::default();
        t.balances.insert("E7ALICE".into(), 900);
        s.tokens.insert("TKN".into(), t);

        let mut out = Tx::new("BRIDGE_OUT", "E7ALICE", 1, 1);
        out.amount = "900".into();
        out.data = Some(JsonValue::map([
            ("targetChain".into(), JsonValue::str("TRON")),
            ("targetAddress".into(), JsonValue::str("TXYZ12345")),
            ("token".into(), JsonValue::str("TKN")),
        ]));
        out.id = Some("out1".into());
        aplicar(&mut s, &out, &ctx(10)).unwrap();
        assert_eq!(s.tokens["TKN"].balances["E7ALICE"], 0);
        assert_eq!(s.bridge.locked_tokens["TKN"], 900);

        let mut inb = tx_in(RELAYER_A, "in1", "0xdep", "900");
        inb.data = Some(JsonValue::map([
            ("sourceChain".into(), JsonValue::str("TRON")),
            ("sourceTxHash".into(), JsonValue::str("0xdep")),
            ("token".into(), JsonValue::str("TKN")),
        ]));
        aplicar(&mut s, &inb, &ctx(10)).unwrap();
        assert_eq!(s.tokens["TKN"].balances[DESTINO], 900);
        assert_eq!(s.bridge.locked_tokens["TKN"], 0);
    }

    // ------------------------------------------------- rejeição não muta o estado

    /// Um caso de rejeição: rótulo + fábrica da tx que deve ser recusada.
    type CasoDeRejeicao = (&'static str, Box<dyn Fn(&mut State) -> Tx>);

    #[test]
    fn rejeicao_nao_muta_o_estado() {
        if BRIDGE_PROOF_HEIGHT == 0 { return; }
        let casos: Vec<CasoDeRejeicao> = vec![
            (
                "remetente não é relayer",
                Box::new(|_s: &mut State| tx_in("E7INTRUSO", "idx", "0xdep", "1000")),
            ),
            (
                "cadeia inválida",
                Box::new(|_s: &mut State| {
                    let mut tx = tx_in(RELAYER_A, "idx", "0xdep", "1000");
                    tx.data = Some(JsonValue::map([
                        ("sourceChain".into(), JsonValue::str("T")),
                        ("sourceTxHash".into(), JsonValue::str("0xdep")),
                    ]));
                    tx
                }),
            ),
            (
                "valor zero",
                Box::new(|_s: &mut State| tx_in(RELAYER_A, "idx", "0xdep", "0")),
            ),
            (
                "acima do travado",
                Box::new(|_s: &mut State| tx_in(RELAYER_A, "idx", "0xdep", "99999999")),
            ),
            (
                "sem data",
                Box::new(|_s: &mut State| {
                    let mut tx = tx_in(RELAYER_A, "idx", "0xdep", "1000");
                    tx.data = None;
                    tx
                }),
            ),
            (
                "sem id",
                Box::new(|_s: &mut State| {
                    let mut tx = tx_in(RELAYER_A, "idx", "0xdep", "1000");
                    tx.id = None;
                    tx
                }),
            ),
        ];

        for (nome, montar) in casos {
            let mut s = estado();
            // Um pouco de história para que "não mutou" seja afirmação forte.
            aplicar(&mut s, &tx_in(RELAYER_A, "id0", "0xanterior", "10"), &ctx(1)).unwrap();

            let bridge_antes = s.bridge.clone();
            let contas_antes = s.accounts.clone();
            let tx = montar(&mut s);
            assert!(aplicar(&mut s, &tx, &ctx(1)).is_err(), "deveria rejeitar: {nome}");
            assert_eq!(s.bridge, bridge_antes, "{nome}: estado da ponte mudou numa rejeição");
            assert_eq!(s.accounts, contas_antes, "{nome}: contas mudaram numa rejeição");
        }
    }

    // ------------------------------------------------------ prova de comitê (#3)

    /// Chave de teste determinística.
    fn chave(seed: u8) -> SigningKey {
        let mut bytes = [0u8; 32];
        bytes[31] = seed;
        SigningKey::from_bytes(&bytes.into()).expect("semente válida")
    }

    fn endereco(sk: &SigningKey) -> String {
        eth_address_from_key(sk.verifying_key())
    }

    fn assinar(sk: &SigningKey, digest: &[u8; 32]) -> JsonValue {
        let (sig, rec) = sk.sign_prehash_recoverable(digest);
        let (r, s) = sig.split_bytes();
        JsonValue::map([
            ("r".into(), JsonValue::str(format!("0x{}", hex::encode(r)))),
            ("s".into(), JsonValue::str(format!("0x{}", hex::encode(s)))),
            ("recId".into(), JsonValue::Int(i64::from(rec.to_byte()))),
        ])
    }

    /// Estado com comitê de origem registrado — o cenário acima de
    /// `BRIDGE_PROOF_HEIGHT`, em que a autoridade é a prova, não a federação.
    fn estado_provado(ks: &[SigningKey]) -> State {
        let mut s = estado();
        s.bridge_relayers = [RELAYER_A.into()].into_iter().collect();
        s.bridge_source_committees.insert("TRON".into(), comite(ks, ks.len() as u64, 0));
        s
    }

    /// `BRIDGE_IN` acompanhado da prova do comitê sobre o evento exato.
    fn tx_in_provado(id: &str, source_tx: &str, amount: &str, ks: &[SigningKey]) -> Tx {
        let mut tx = tx_in(RELAYER_A, id, source_tx, amount);
        let digest = bridge_event_digest(
            "TRON",
            source_tx,
            DESTINO,
            amount.parse().expect("valor decimal"),
            None,
        );
        tx.data = Some(JsonValue::map([
            ("sourceChain".into(), JsonValue::str("TRON")),
            ("sourceTxHash".into(), JsonValue::str(source_tx)),
            (
                "proof".into(),
                JsonValue::map([(
                    "sigs".into(),
                    JsonValue::List(ks.iter().map(|k| assinar(k, &digest)).collect()),
                )]),
            ),
        ]));
        tx
    }

    fn comite(chaves: &[SigningKey], quorum: u64, epoch: u64) -> Committee {
        Committee {
            source_chain: "TRON".into(),
            members: chaves.iter().map(endereco).collect(),
            quorum,
            epoch,
        }
    }

    #[test]
    fn acima_do_fork_de_prova_libera_so_com_quorum_do_comite() {
        let ks = [chave(1), chave(2), chave(3)];
        let mut s = estado();
        s.bridge_source_committees.insert("TRON".into(), comite(&ks, 2, 7));
        let c = ctx(BRIDGE_PROOF_HEIGHT);

        let digest = bridge_event_digest("TRON", "0xdep", DESTINO, 1000, None);

        // Uma assinatura só: abaixo do quórum do comitê ⇒ NÃO libera (falha fechada),
        // mesmo que a federação de relayers já bastasse.
        let mut tx = tx_in(RELAYER_A, "id1", "0xdep", "1000");
        tx.data = Some(JsonValue::map([
            ("sourceChain".into(), JsonValue::str("TRON")),
            ("sourceTxHash".into(), JsonValue::str("0xdep")),
            (
                "proof".into(),
                JsonValue::map([(
                    "sigs".into(),
                    JsonValue::List(vec![assinar(&ks[0], &digest)]),
                )]),
            ),
        ]));
        let e = aplicar(&mut s, &tx, &c).unwrap_err();
        assert_eq!(e.0, "prova do comitê insuficiente (1/2)");
        assert_eq!(s.balance_of(DESTINO), 0);

        // Duas assinaturas de membros distintos: libera NA HORA, sem esperar quórum
        // de relayers (a autoridade passou a ser o comitê).
        let mut tx = tx_in(RELAYER_A, "id2", "0xdep", "1000");
        tx.data = Some(JsonValue::map([
            ("sourceChain".into(), JsonValue::str("TRON")),
            ("sourceTxHash".into(), JsonValue::str("0xdep")),
            (
                "proof".into(),
                JsonValue::map([(
                    "sigs".into(),
                    JsonValue::List(vec![assinar(&ks[0], &digest), assinar(&ks[1], &digest)]),
                )]),
            ),
        ]));
        aplicar(&mut s, &tx, &c).unwrap();
        assert_eq!(s.balance_of(DESTINO), 1000);
    }

    #[test]
    fn assinatura_de_nao_membro_nao_conta() {
        let ks = [chave(1), chave(2), chave(3)];
        let intruso = chave(9);
        let com = comite(&ks, 2, 0);
        let digest = bridge_event_digest("TRON", "0xdep", DESTINO, 1000, None);
        let sigs = JsonValue::List(vec![
            assinar(&intruso, &digest),
            assinar(&ks[0], &digest),
        ]);
        assert_eq!(verify_committee_proof(&digest, Some(&sigs), &com.members), 1);
    }

    #[test]
    fn o_mesmo_membro_assinando_duas_vezes_conta_uma() {
        // Maleabilidade de ECDSA: (r, N−s) é outra assinatura VÁLIDA da mesma chave.
        // Sem dedup por endereço recuperado, uma chave só encheria qualquer quórum.
        let ks = [chave(1), chave(2), chave(3)];
        let com = comite(&ks, 2, 0);
        let digest = bridge_event_digest("TRON", "0xdep", DESTINO, 1000, None);
        let sigs = JsonValue::List(vec![assinar(&ks[0], &digest), assinar(&ks[0], &digest)]);
        assert_eq!(verify_committee_proof(&digest, Some(&sigs), &com.members), 1);
    }

    #[test]
    fn prova_de_outro_evento_nao_serve() {
        // O digest amarra destino, valor e ativo: assinar um depósito de 1 e7 não
        // autoriza a liberação de 1000.
        let ks = [chave(1), chave(2)];
        let mut s = estado();
        s.bridge_source_committees.insert("TRON".into(), comite(&ks, 2, 0));
        let outro = bridge_event_digest("TRON", "0xdep", DESTINO, 1, None);

        let mut tx = tx_in(RELAYER_A, "id1", "0xdep", "1000");
        tx.data = Some(JsonValue::map([
            ("sourceChain".into(), JsonValue::str("TRON")),
            ("sourceTxHash".into(), JsonValue::str("0xdep")),
            (
                "proof".into(),
                JsonValue::map([(
                    "sigs".into(),
                    JsonValue::List(vec![assinar(&ks[0], &outro), assinar(&ks[1], &outro)]),
                )]),
            ),
        ]));
        assert!(aplicar(&mut s, &tx, &ctx(BRIDGE_PROOF_HEIGHT)).is_err());
        assert_eq!(s.balance_of(DESTINO), 0);
    }

    #[test]
    fn sem_comite_registrado_nao_libera_acima_do_fork() {
        let mut s = estado();
        let e = aplicar(
            &mut s,
            &tx_in(RELAYER_A, "id1", "0xdep", "1000"),
            &ctx(BRIDGE_PROOF_HEIGHT),
        )
        .unwrap_err();
        assert_eq!(e.0, "sem comitê de origem registrado para TRON");
        assert_eq!(s.balance_of(DESTINO), 0);
    }

    #[test]
    fn lixo_no_campo_de_prova_nao_causa_panico() {
        // `sigs` é entrada não confiável. Nada aqui pode entrar em pânico: um pânico
        // no manipulador de consenso derruba o nó, e o nó é a rede.
        let ks = [chave(1)];
        let com = comite(&ks, 1, 0);
        let digest = [7u8; 32];
        let lixos = [
            JsonValue::Null,
            JsonValue::Int(3),
            JsonValue::str("nada"),
            JsonValue::List(vec![JsonValue::Null, JsonValue::Int(-1)]),
            JsonValue::List(vec![JsonValue::map([
                ("r".into(), JsonValue::str("0")),
                ("s".into(), JsonValue::str("0")),
                ("recId".into(), JsonValue::Int(0)),
            ])]),
            JsonValue::List(vec![JsonValue::map([
                ("r".into(), JsonValue::str("9".repeat(100))),
                ("s".into(), JsonValue::str("-5")),
                ("recId".into(), JsonValue::Int(99)),
            ])]),
        ];
        for lixo in lixos {
            assert_eq!(verify_committee_proof(&digest, Some(&lixo), &com.members), 0);
        }
    }

    #[test]
    fn o_teto_de_assinaturas_limita_o_custo_de_cripto() {
        // Mais assinaturas que membros não pode agregar nada — e cada `recover`
        // custa. Sem o teto, `sigs` seria um DoS de cripto por ~0 de energia.
        let ks = [chave(1)];
        let com = comite(&ks, 1, 0);
        let digest = bridge_event_digest("TRON", "0xdep", DESTINO, 1, None);
        let mut sigs = vec![JsonValue::str("lixo"); 500];
        sigs.push(assinar(&ks[0], &digest)); // legítima, mas além do teto
        assert_eq!(verify_committee_proof(&digest, Some(&JsonValue::List(sigs)), &com.members), 0);
    }

    // -------------------------------------------------------- rotação de comitê

    fn tx_update(de: &str, membros: &[String], quorum: u64, sigs: Vec<JsonValue>) -> Tx {
        let mut tx = Tx::new("BRIDGE_COMMITTEE_UPDATE", de, 1, 1);
        tx.data = Some(JsonValue::map([
            ("sourceChain".into(), JsonValue::str("tron")),
            (
                "newCommittee".into(),
                JsonValue::map([
                    (
                        "members".into(),
                        JsonValue::List(membros.iter().map(JsonValue::str).collect()),
                    ),
                    ("quorum".into(), JsonValue::Int(quorum as i64)),
                ]),
            ),
            ("sigs".into(), JsonValue::List(sigs)),
        ]));
        tx.id = Some("upd1".into());
        tx
    }

    #[test]
    fn rotacao_de_comite_exige_handoff_do_comite_atual() {
        if BRIDGE_PROOF_HEIGHT == 0 { return; }
        let atuais = [chave(1), chave(2)];
        let novos = [chave(4), chave(5), chave(6)];
        let mut s = estado();
        s.bridge_source_committees.insert("TRON".into(), comite(&atuais, 2, 7));

        let membros: Vec<String> = novos.iter().map(endereco).collect();
        let digest = committee_update_digest("TRON", 8, &membros, 2);

        // Abaixo do fork a rotação nem existe.
        let tx = tx_update(RELAYER_A, &membros, 2, vec![assinar(&atuais[0], &digest), assinar(&atuais[1], &digest)]);
        let e = aplicar(&mut s, &tx, &ctx(BRIDGE_PROOF_HEIGHT - 1)).unwrap_err();
        assert_eq!(e.0, "rotação de comitê ainda não ativa");

        // Com uma assinatura só, não fecha o quórum do comitê ATUAL.
        let tx1 = tx_update(RELAYER_A, &membros, 2, vec![assinar(&atuais[0], &digest)]);
        let e = aplicar(&mut s, &tx1, &ctx(BRIDGE_PROOF_HEIGHT)).unwrap_err();
        assert_eq!(e.0, "handoff sem quórum do comitê atual (1/2)");
        assert_eq!(s.bridge_source_committees["TRON"].epoch, 7, "comitê intacto");

        // Handoff completo: rotaciona e avança o epoch.
        aplicar(&mut s, &tx, &ctx(BRIDGE_PROOF_HEIGHT)).unwrap();
        let c = &s.bridge_source_committees["TRON"];
        assert_eq!(c.epoch, 8);
        assert_eq!(c.quorum, 2);
        assert_eq!(c.members, membros);
    }

    #[test]
    fn handoff_nao_pode_ser_reapresentado() {
        // O epoch entra no digest: depois de rotacionar, a MESMA prova assina o epoch
        // anterior e já não confere. Sem isso, um handoff antigo reverteria o comitê
        // para chaves possivelmente comprometidas.
        let atuais = [chave(1), chave(2)];
        let novos = [chave(4), chave(5)];
        let mut s = estado();
        s.bridge_source_committees.insert("TRON".into(), comite(&atuais, 2, 0));

        let membros: Vec<String> = novos.iter().map(endereco).collect();
        let digest = committee_update_digest("TRON", 1, &membros, 2);
        let sigs = vec![assinar(&atuais[0], &digest), assinar(&atuais[1], &digest)];
        let tx = tx_update(RELAYER_A, &membros, 2, sigs);

        aplicar(&mut s, &tx, &ctx(BRIDGE_PROOF_HEIGHT)).unwrap();
        // Reapresentada: agora o comitê é o NOVO, e as assinaturas são do antigo.
        assert!(aplicar(&mut s, &tx, &ctx(BRIDGE_PROOF_HEIGHT)).is_err());
    }

    #[test]
    fn rotacao_rejeita_comite_malformado() {
        let atuais = [chave(1)];
        let mut s = estado();
        s.bridge_source_committees.insert("TRON".into(), comite(&atuais, 1, 0));
        let c = ctx(BRIDGE_PROOF_HEIGHT);
        let m = endereco(&chave(4));

        // Quórum maior que o nº de membros: seria um comitê que nunca decide.
        let tx = tx_update(RELAYER_A, std::slice::from_ref(&m), 2, vec![]);
        assert_eq!(aplicar(&mut s, &tx, &c).unwrap_err().0, "quorum inválido");
        // Zero membros.
        let tx = tx_update(RELAYER_A, &[], 1, vec![]);
        assert_eq!(aplicar(&mut s, &tx, &c).unwrap_err().0, "nº de membros inválido");
        // Duplicados inflariam o denominador do quórum.
        let tx = tx_update(RELAYER_A, &[m.clone(), m.clone()], 2, vec![]);
        assert_eq!(aplicar(&mut s, &tx, &c).unwrap_err().0, "membros duplicados");
        // Não-relayer nem chega a verificar assinatura.
        let tx = tx_update("E7INTRUSO", &[m], 1, vec![]);
        assert_eq!(
            aplicar(&mut s, &tx, &c).unwrap_err().0,
            "remetente não é um relayer de ponte autorizado"
        );
        assert_eq!(s.bridge_source_committees["TRON"].epoch, 0);
    }

    #[test]
    fn digest_de_handoff_independe_da_ordem_dos_membros() {
        let a = "0xaaaa".to_string();
        let b = "0xbbbb".to_string();
        assert_eq!(
            committee_update_digest("TRON", 1, &[a.clone(), b.clone()], 2),
            committee_update_digest("TRON", 1, &[b, a], 2)
        );
    }

    // ----------------------------------------------------------- BRIDGE_SETTLE

    fn tx_settle(de: &str, transfer_id: &str) -> Tx {
        let mut tx = Tx::new("BRIDGE_SETTLE", de, 1, 42);
        tx.data = Some(JsonValue::map([
            ("transferId".into(), JsonValue::str(transfer_id)),
            ("externalTxHash".into(), JsonValue::str("0xext")),
        ]));
        tx.id = Some("set1".into());
        tx
    }

    #[test]
    fn liquidacao_e_idempotente_e_so_de_relayer() {
        let mut s = estado();
        s.account_mut("E7ALICE").balance = 5_000;
        let mut out = Tx::new("BRIDGE_OUT", "E7ALICE", 1, 1);
        out.amount = "3000".into();
        out.data = Some(JsonValue::map([
            ("targetChain".into(), JsonValue::str("TRON")),
            ("targetAddress".into(), JsonValue::str("TXYZ12345")),
        ]));
        out.id = Some("out1".into());
        aplicar(&mut s, &out, &ctx(10)).unwrap();

        assert_eq!(
            aplicar(&mut s, &tx_settle("E7INTRUSO", "out1"), &ctx(10)).unwrap_err().0,
            "remetente não é um relayer de ponte autorizado"
        );
        aplicar(&mut s, &tx_settle(RELAYER_A, "out1"), &ctx(10)).unwrap();
        let Transfer::Out(saida) = &s.bridge.transfers["out1"] else { panic!("esperava OUT") };
        assert_eq!(
            saida.liquidacao,
            Liquidacao::Paga {
                settled_by: RELAYER_A.into(),
                external_tx_hash: Some("0xext".into()),
                settled_at: 42,
            }
        );

        // Segunda liquidação é rejeitada — é o que impede o pagamento duplo do lado
        // de fora depois de um reinício do relayer.
        assert_eq!(
            aplicar(&mut s, &tx_settle(RELAYER_A, "out1"), &ctx(10)).unwrap_err().0,
            "transferência já liquidada"
        );
        assert_eq!(
            aplicar(&mut s, &tx_settle(RELAYER_A, "inexistente"), &ctx(10)).unwrap_err().0,
            "transferência OUT inexistente"
        );
    }

    #[test]
    fn nao_se_liquida_uma_transferencia_de_entrada() {
        if BRIDGE_PROOF_HEIGHT == 0 { return; }
        let mut s = estado();
        aplicar(&mut s, &tx_in(RELAYER_A, "in1", "0xdep", "10"), &ctx(1)).unwrap();
        assert_eq!(
            aplicar(&mut s, &tx_settle(RELAYER_A, "in1"), &ctx(1)).unwrap_err().0,
            "transferência OUT inexistente"
        );
    }

    // --------------------------------------------------------- circuit breaker

    #[test]
    fn o_breaker_limita_a_velocidade_de_liberacao_acima_do_fork() {
        // O fork do breaker está ACIMA do fork de prova, então toda liberação aqui
        // já precisa da prova do comitê — é o cenário real, com as três camadas
        // ligadas ao mesmo tempo.
        let ks = [chave(1)];
        let mut s = estado_provado(&ks);
        s.bridge.locked_native = 1_000;
        let h = BRIDGE_BREAKER_HEIGHT;

        // Cap = 30% de 1.000 = 300. Uma liberação de 400 já estoura.
        let e = aplicar(&mut s, &tx_in_provado("id1", "0xdepa", "400", &ks), &ctx(h)).unwrap_err();
        assert!(e.0.starts_with("circuit breaker da ponte"), "{}", e.0);
        assert_eq!(s.bridge.locked_native, 1_000);
        assert!(s.bridge.release_log.is_empty(), "rejeição não registra liberação");

        // 300 passa exatamente no limite.
        aplicar(&mut s, &tx_in_provado("id2", "0xdepb", "300", &ks), &ctx(h)).unwrap();
        assert_eq!(s.bridge.release_log.len(), 1);

        // A seguinte, dentro da mesma janela, é medida contra o pool do INÍCIO dela
        // (700 travados + 300 já liberados = 1.000, cap 300) e não cabe mais nada.
        let e = aplicar(&mut s, &tx_in_provado("id3", "0xdepc", "1", &ks), &ctx(h + 1)).unwrap_err();
        assert!(e.0.starts_with("circuit breaker da ponte"));

        // Passada a janela, a liberação antiga sai da conta e o fluxo volta.
        aplicar(
            &mut s,
            &tx_in_provado("id4", "0xdepd", "200", &ks),
            &ctx(h + BRIDGE_BREAKER_WINDOW_BLOCKS + 1),
        )
        .unwrap();
        assert_eq!(s.balance_of(DESTINO), 500);
        assert_eq!(s.bridge.release_log.len(), 1, "a janela antiga foi podada");
    }

    #[test]
    fn abaixo_do_fork_do_breaker_nao_existe_release_log() {
        if BRIDGE_BREAKER_HEIGHT == 0 { return; }
        // Criar o log antes do fork mudaria a serialização de `state.bridge`, que
        // está no `stateRoot` — e quebraria o replay dos blocos já produzidos.
        let ks = [chave(1)];
        let mut s = estado_provado(&ks);
        let h = BRIDGE_BREAKER_HEIGHT - 1;
        // 900.000 de 1.000.000 travados é MUITO acima do cap de 30% — passa só
        // porque abaixo do fork o breaker não existe.
        aplicar(&mut s, &tx_in_provado("id2", "0xdepb", "900000", &ks), &ctx(h)).unwrap();
        assert_eq!(s.balance_of(DESTINO), 900_000);
        assert!(s.bridge.release_log.is_empty(), "sem log abaixo do fork");
    }

    #[test]
    fn o_limite_do_breaker_e_governavel() {
        let ks = [chave(1)];
        let mut s = estado_provado(&ks);
        s.bridge.locked_native = 1_000;
        s.params.insert("BRIDGE_BREAKER_BPS".into(), "10000".into()); // 100%
        aplicar(&mut s, &tx_in_provado("id1", "0xdepa", "1000", &ks), &ctx(BRIDGE_BREAKER_HEIGHT))
            .unwrap();
        assert_eq!(s.balance_of(DESTINO), 1_000);
    }

    // --------------------------------------------------------------- utilitários

    #[test]
    fn o_digest_do_evento_amarra_todos_os_campos() {
        let base = bridge_event_digest("TRON", "0xdep", DESTINO, 1000, None);
        assert_ne!(base, bridge_event_digest("ETH", "0xdep", DESTINO, 1000, None));
        assert_ne!(base, bridge_event_digest("TRON", "0xoutro", DESTINO, 1000, None));
        assert_ne!(base, bridge_event_digest("TRON", "0xdep", "E7X", 1000, None));
        assert_ne!(base, bridge_event_digest("TRON", "0xdep", DESTINO, 1001, None));
        assert_ne!(base, bridge_event_digest("TRON", "0xdep", DESTINO, 1000, Some("TKN")));
        // A cadeia entra sempre em MAIÚSCULAS: "tron" e "TRON" são o mesmo evento.
        assert_eq!(base, bridge_event_digest("tron", "0xdep", DESTINO, 1000, None));
    }

    #[test]
    fn o_separador_impede_ambiguidade_entre_campos() {
        // Sem o separador, ("AB","C") e ("A","BC") assinariam o mesmo digest, e uma
        // prova de um depósito valeria para outro.
        assert_ne!(
            bridge_event_digest("TRON", "0xAB", "C", 1, None),
            bridge_event_digest("TRON", "0xA", "BC", 1, None)
        );
    }

    #[test]
    fn u256_le_as_formas_que_o_bigint_aceita() {
        assert_eq!(u256_be(&JsonValue::str("1")).unwrap()[31], 1);
        assert_eq!(u256_be(&JsonValue::str("0x01")).unwrap()[31], 1);
        assert_eq!(u256_be(&JsonValue::Int(255)).unwrap()[31], 255);
        assert_eq!(u256_be(&JsonValue::str("256")).unwrap()[30], 1);
        // Acima de 2²⁵⁶ não existe — e já estaria fora de (0, N) de qualquer forma.
        assert!(u256_be(&JsonValue::str("9".repeat(78))).is_none());
        assert!(u256_be(&JsonValue::str("-1")).is_none());
        assert!(u256_be(&JsonValue::str("zz")).is_none());
        assert!(u256_be(&JsonValue::Null).is_none());
    }

    #[test]
    fn nome_de_cadeia_segue_a_regex_da_referencia() {
        assert!(nome_de_cadeia_valido("TRON"));
        assert!(nome_de_cadeia_valido("bsc-testnet_1"));
        assert!(!nome_de_cadeia_valido("T"));
        assert!(!nome_de_cadeia_valido(&"A".repeat(33)));
        assert!(!nome_de_cadeia_valido("TRON!"));
        assert!(!nome_de_cadeia_valido("TR ON"));
    }
    /// Comprimento é medido em unidades UTF-16, como o `.length` do JS.
    ///
    /// Medir em BYTES tinha efeito nos dois sentidos, e o pior deles é o
    /// `BRIDGE_IN`: aceitar um `sourceTxHash` que a rede DESCARTOU faz este nó
    /// liberar valor por um evento que não existe para os demais.
    #[test]
    fn comprimento_de_endereco_e_hash_segue_o_length_do_js() {
        // `"éé"`: 2 no JS (recusado, < 4) e 4 em bytes (seria aceito).
        let curto = "éé";
        assert_eq!(crate::state::coercao::js_len(curto), 2);
        assert_eq!(curto.len(), 4);

        let mut s = State::new();
        let de = crate::address::derive_address_from("ponte:origem");
        s.accounts.insert(
            de.clone(),
            crate::state::Account { balance: 100 * crate::config::UNIT, ..Default::default() },
        );

        let mut tx = Tx::new("BRIDGE_OUT", &de, 1, 1_700_000_000_000);
        tx.amount = crate::config::UNIT.to_string();
        tx.data = Some(JsonValue::map([
            ("targetChain".to_string(), JsonValue::str("TRON")),
            ("targetAddress".to_string(), JsonValue::str(curto)),
        ]));
        tx.id = Some(crate::transaction::tx_id(&tx));
        let erro = aplicar(&mut s, &tx, &ctx(BRIDGE_QUORUM_HEIGHT)).expect_err("curto demais");
        assert!(erro.to_string().contains("targetAddress"), "{erro}");

        // E o inverso: 65 `"é"` tem length 65 (aceito) e 130 bytes (seria recusado).
        let longo = "é".repeat(65);
        assert_eq!(crate::state::coercao::js_len(&longo), 65);
        assert!(longo.len() > 128);
        tx.data = Some(JsonValue::map([
            ("targetChain".to_string(), JsonValue::str("TRON")),
            ("targetAddress".to_string(), JsonValue::str(&longo)),
        ]));
        tx.id = Some(crate::transaction::tx_id(&tx));
        assert!(
            aplicar(&mut s, &tx, &ctx(BRIDGE_QUORUM_HEIGHT)).is_ok(),
            "65 unidades UTF-16 cabem no teto de 128, como na rede"
        );
    }
}

// ============================================================================
// Testes da serialização canônica
//
// Travam a LISTA EXATA DE CHAVES das folhas `brg:state` e `brg:committees`. Duas
// coisas são vigiadas com insistência aqui: o `token`, que é `null` e NÃO ausente
// no ativo nativo; e o `releaseLog`, cuja mera existência antes do fork do circuit
// breaker mudaria a folha `brg:state` de toda a cadeia histórica.
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

    fn saida() -> Saida {
        Saida {
            id: "out1".into(),
            from: "E7A".into(),
            target_chain: "TRON".into(),
            target_address: "TXYZ".into(),
            token: None,
            amount: 1_000,
            created_at: 1_700_000_000_000,
            liquidacao: Liquidacao::Travada,
        }
    }

    fn out() -> Transfer {
        Transfer::Out(saida())
    }

    fn entrada(estagio: Estagio) -> Transfer {
        Transfer::In(Entrada {
            id: "in1".into(),
            relayer: "E7R".into(),
            to: "E7D".into(),
            source_chain: "TRON".into(),
            source_tx_hash: "0xdep".into(),
            token: None,
            amount: 1_000,
            attestations: 1,
            created_at: 1_700_000_000_000,
            estagio,
        })
    }

    // ------------------------------------------------------------------ Transfer

    #[test]
    fn transferencia_de_saida_codifica_com_as_chaves_da_referencia() {
        assert_eq!(
            chaves(&out().to_value()),
            [
                "amount", "createdAt", "direction", "from", "id", "status",
                "targetAddress", "targetChain", "token",
            ]
        );
    }

    #[test]
    fn transferencia_de_entrada_atestada_codifica_com_as_chaves_da_referencia() {
        assert_eq!(
            chaves(&entrada(Estagio::Atestada { quorum: 2 }).to_value()),
            [
                "amount", "attestations", "createdAt", "direction", "id", "quorum",
                "relayer", "sourceChain", "sourceTxHash", "status", "to", "token",
            ]
        );
        assert_eq!(
            valor(&entrada(Estagio::Atestada { quorum: 2 }).to_value(), "status"),
            &Value::str("ATTESTED")
        );
    }

    #[test]
    fn a_entrada_liberada_nao_tem_quorum() {
        // O literal da LIBERAÇÃO (`state.js:2539`) omite `quorum`, ao contrário do da
        // atestação. Antes isso dependia de o manipulador deixar `quorum: None`;
        // agora `Estagio::Liberada` não tem onde guardar um quórum, então a folha
        // errada não é construível.
        //
        // não compila: `Estagio::Liberada { quorum: 2 }` — a variante não tem campos,
        // e é exatamente a combinação "liberada com quórum" que a rede nunca produz.
        let v = entrada(Estagio::Liberada).to_value();
        let ks = chaves(&v);
        assert!(!ks.contains(&"quorum".to_string()));
        assert_eq!(ks.len(), 11);
        assert_eq!(valor(&v, "status"), &Value::str("RELEASED"));
    }

    #[test]
    fn transferencia_omite_os_campos_da_outra_direcao() {
        // Uma OUT não pode trazer `relayer`/`to`/`source*`, nem uma IN trazer
        // `from`/`target*`. Deixou de ser uma regra de serialização e virou uma
        // propriedade do tipo: cada variante só conhece os campos do seu literal.
        //
        // não compila: `Saida { source_tx_hash: … }` ou `Transfer::Out(…)` com
        // `attestations` — a struct não tem esses campos, e "saída com dado de
        // entrada" (ou uma entrada liquidada) deixou de ser representável.
        let saida = chaves(&out().to_value());
        for proibida in ["relayer", "to", "sourceChain", "sourceTxHash", "attestations", "quorum"] {
            assert!(!saida.contains(&proibida.to_string()), "{proibida} numa OUT");
        }
        let entra = chaves(&entrada(Estagio::Liberada).to_value());
        for proibida in ["from", "targetChain", "targetAddress", "settledAt", "settledBy"] {
            assert!(!entra.contains(&proibida.to_string()), "{proibida} numa IN");
        }
    }

    #[test]
    fn o_ativo_nativo_e_token_null_e_nao_token_ausente() {
        // A referência escreve `token: token ?? null` — a chave existe SEMPRE. `null`
        // (tag 0x00) e ausência dão folhas diferentes, e como quase toda transferência
        // da ponte é nativa, errar isto mudaria a folha `brg:state` inteira.
        assert_eq!(valor(&out().to_value(), "token"), &Value::Null);
        let com_token = Transfer::Out(Saida { token: Some("TKN".into()), ..saida() });
        assert_eq!(valor(&com_token.to_value(), "token"), &Value::str("TKN"));
        // Vale nas duas direções e também na atestação em andamento.
        let entra = Transfer::In(match entrada(Estagio::Liberada) {
            Transfer::In(e) => Entrada { token: Some("TKN".into()), ..e },
            Transfer::Out(_) => panic!("esperava IN"),
        });
        assert_eq!(valor(&entra.to_value(), "token"), &Value::str("TKN"));
        assert_eq!(valor(&entrada(Estagio::Liberada).to_value(), "token"), &Value::Null);
    }

    #[test]
    fn a_liquidacao_traz_o_external_tx_hash_mesmo_quando_nulo() {
        // `BRIDGE_SETTLE` grava `externalTxHash: … : null`, então a chave existe
        // sempre que houve liquidação. Se o discriminante fosse o próprio hash, ela
        // sumiria exatamente no caso em que vale `null`.
        let t = Transfer::Out(Saida {
            // Os três campos entram juntos: a variante não admite `settledAt` sem
            // `settledBy`, nem "PAID" sem liquidação nenhuma.
            liquidacao: Liquidacao::Paga {
                settled_by: "E7R".into(),
                external_tx_hash: None,
                settled_at: 1_700_000_000_001,
            },
            ..saida()
        });
        let v = t.to_value();
        assert_eq!(valor(&v, "status"), &Value::str("PAID"));
        assert_eq!(valor(&v, "externalTxHash"), &Value::Null);
        assert!(chaves(&v).contains(&"settledBy".to_string()));
        assert!(chaves(&v).contains(&"settledAt".to_string()));

        // Antes da liquidação, nenhuma das três existe.
        let ks = chaves(&out().to_value());
        for proibida in ["externalTxHash", "settledAt", "settledBy"] {
            assert!(!ks.contains(&proibida.to_string()), "{proibida} antes do SETTLE");
        }
    }

    // -------------------------------------------------------------------- Bridge

    #[test]
    fn a_ponte_codifica_com_as_chaves_da_referencia() {
        let b = Bridge::default();
        assert_eq!(
            chaves(&b.to_value()),
            ["attestations", "lockedNative", "lockedTokens", "processedInbound", "transfers"]
        );
    }

    #[test]
    fn o_release_log_vazio_nao_cria_a_chave() {
        // A referência cria `releaseLog` com `??= []` na PRIMEIRA liberação acima de
        // BRIDGE_BREAKER_HEIGHT. Emitir a chave (mesmo como lista vazia) mudaria a
        // folha `brg:state` de toda a cadeia anterior ao fork, e o replay do
        // histórico deixaria de bater.
        assert!(!chaves(&Bridge::default().to_value()).contains(&"releaseLog".to_string()));

        let b = Bridge {
            release_log: vec![Release { height: 10, asset: "NATIVE".into(), amount: 5 }],
            ..Default::default()
        };
        let v = b.to_value();
        assert!(chaves(&v).contains(&"releaseLog".to_string()));
        let Value::List(log) = valor(&v, "releaseLog") else { panic!("lista") };
        assert_eq!(chaves(&log[0]), ["amount", "asset", "height"]);
        // `amount` é TEXTO no log (`amount.toString()`) e INTEIRO na transferência.
        // Tags diferentes na codificação canônica — a mesma armadilha do `frozen`.
        assert_eq!(valor(&log[0], "amount"), &Value::str("5"));
        assert_eq!(valor(&log[0], "height"), &Value::uint(10u64));
    }

    #[test]
    fn a_atestacao_guarda_o_valor_como_texto() {
        let mut b = Bridge::default();
        b.attestations.insert("k".into(), Attestation {
            to: "E7D".into(),
            amount: "1000".into(),
            token: None,
            relayers: vec!["E7R".into()],
            created_at: 7,
        });
        let v = b.to_value();
        let att = valor(valor(&v, "attestations"), "k");
        assert_eq!(chaves(att), ["amount", "createdAt", "relayers", "to", "token"]);
        assert_eq!(valor(att, "amount"), &Value::str("1000"));
        assert_eq!(valor(att, "token"), &Value::Null, "nativo é null, não ausente");
    }

    // ----------------------------------------------------------------- Committee

    #[test]
    fn o_comite_codifica_com_as_chaves_da_referencia() {
        let c = Committee {
            source_chain: "TRON".into(),
            members: vec!["0xaa".into()],
            quorum: 1,
            epoch: 0,
        };
        assert_eq!(chaves(&c.to_value()), ["epoch", "members", "quorum"]);
    }

    #[test]
    fn o_comite_nao_duplica_a_cadeia_que_ja_e_a_chave_do_mapa() {
        // `sourceChain` é a chave de `bridgeSourceCommittees`, não um campo do
        // objeto. Emiti-la mudaria a folha de toda ponte configurada.
        let c = Committee { source_chain: "TRON".into(), ..Default::default() };
        let ks = chaves(&c.to_value());
        for proibida in ["sourceChain", "source_chain"] {
            assert!(!ks.contains(&proibida.to_string()), "{proibida}");
        }
    }

    // ------------------------------------------------- ida e volta canônica

    /// Ida e volta nos QUATRO literais da ponte, com todos os campos preenchidos.
    ///
    /// São quatro objetos diferentes e não quatro estados de um só: o que este
    /// teste trava é que a volta escolha o mesmo literal que a ida escreveu.
    #[test]
    fn as_quatro_formas_de_transferencia_sobrevivem_a_ida_e_volta() {
        let travada = Transfer::Out(Saida {
            id: "out-1".into(),
            from: "E7DONO".into(),
            target_chain: "TRON".into(),
            target_address: "TX...".into(),
            token: Some("tkn-1".into()),
            amount: 123_456,
            created_at: 1_700_000_000_001,
            liquidacao: Liquidacao::Travada,
        });
        assert_eq!(Transfer::from_value(&travada.to_value()), Some(travada.clone()));

        let Transfer::Out(base) = travada else { panic!("saída") };
        let paga = Transfer::Out(Saida {
            // Ativo NATIVO: `token` é NULO, e a chave existe assim mesmo.
            token: None,
            liquidacao: Liquidacao::Paga {
                settled_by: "E7RELAYER".into(),
                external_tx_hash: Some("0xabc".into()),
                settled_at: -42,
            },
            ..base.clone()
        });
        assert_eq!(Transfer::from_value(&paga.to_value()), Some(paga));

        // Liquidação SEM hash externo: a chave existe valendo nulo.
        let sem_hash = Transfer::Out(Saida {
            liquidacao: Liquidacao::Paga {
                settled_by: "E7RELAYER".into(),
                external_tx_hash: None,
                settled_at: 7,
            },
            ..base
        });
        assert_eq!(Transfer::from_value(&sem_hash.to_value()), Some(sem_hash));

        let atestada = Transfer::In(Entrada {
            id: "in-1".into(),
            relayer: "E7RELAYER".into(),
            to: "E7DESTINO".into(),
            source_chain: "TRON".into(),
            source_tx_hash: "0xdead".into(),
            token: Some("tkn-2".into()),
            amount: 999,
            attestations: 2,
            created_at: 1_700_000_000_002,
            estagio: Estagio::Atestada { quorum: 3 },
        });
        assert_eq!(Transfer::from_value(&atestada.to_value()), Some(atestada.clone()));

        let Transfer::In(entrada) = atestada else { panic!("entrada") };
        let liberada = Transfer::In(Entrada { estagio: Estagio::Liberada, ..entrada });
        assert_eq!(Transfer::from_value(&liberada.to_value()), Some(liberada));
    }

    #[test]
    fn estado_da_ponte_sobrevive_a_ida_e_volta() {
        let mut b = Bridge {
            locked_native: 10_000,
            locked_tokens: [("tkn-1".to_string(), 500u128)].into(),
            processed_inbound: [("TRON:0xdead".to_string(), "tx-que-pagou".to_string())].into(),
            ..Default::default()
        };
        b.transfers.insert(
            "out-1".into(),
            Transfer::Out(Saida {
                id: "out-1".into(),
                from: "E7DONO".into(),
                target_chain: "TRON".into(),
                target_address: "TX...".into(),
                token: None,
                amount: 7,
                created_at: 1,
                liquidacao: Liquidacao::Travada,
            }),
        );
        b.attestations.insert(
            "TRON:0xdead:E7D:5:NATIVE".into(),
            Attestation {
                to: "E7D".into(),
                amount: "5".into(),
                token: None,
                relayers: vec!["E7R1".into(), "E7R2".into()],
                created_at: 2,
            },
        );
        // Log VAZIO: a chave `releaseLog` some, e a ausência volta como vazio.
        assert_eq!(Bridge::from_value(&b.to_value()), Some(b.clone()));

        b.release_log.push(Release { height: 100, asset: "NATIVE".into(), amount: 5 });
        assert_eq!(Bridge::from_value(&b.to_value()), Some(b));
    }

    #[test]
    fn comite_sobrevive_a_ida_e_volta_com_a_cadeia_vinda_da_chave() {
        let c = Committee {
            source_chain: "TRON".into(),
            members: vec!["0xaa".into(), "0xbb".into()],
            quorum: 2,
            epoch: 9,
        };
        assert_eq!(Committee::from_value(&c.to_value(), "TRON"), Some(c));
    }

    #[test]
    fn formas_que_a_rede_nao_produz_sao_recusadas() {
        let entrada = Entrada {
            id: "in".into(),
            relayer: "E7R".into(),
            to: "E7D".into(),
            source_chain: "TRON".into(),
            source_tx_hash: "0x1".into(),
            token: None,
            amount: 1,
            attestations: 1,
            created_at: 1,
            estagio: Estagio::Liberada,
        };
        // "Liberada COM quórum" — a folha que o enum existe para apagar.
        let Value::Map(mut m) = entrada.to_value() else { panic!("mapa") };
        m.insert("quorum".into(), Value::uint(2u128));
        assert_eq!(Entrada::from_value(&Value::Map(m)), None);

        // `direction` desconhecida não tem literal correspondente.
        let Value::Map(mut m) = entrada.to_value() else { panic!("mapa") };
        m.insert("direction".into(), Value::str("LADO"));
        assert_eq!(Transfer::from_value(&Value::Map(m)), None);

        assert_eq!(Release::from_value(&Value::Null), None);
        assert_eq!(Bridge::from_value(&Value::List(vec![])), None);
    }
}
