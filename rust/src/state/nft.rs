//! NFT EAV721 e serviço de nomes.
//!
//! Port de `src/core/state.js` (o nó de referência), casos `NFT_*` e `NAME_*`.
//! Inclui as checagens de altura de fork, que são o que impede este cliente de
//! aceitar o que a rede rejeita.
//!
//! Invariante que vale para TODO manipulador deste módulo: se retornar `Err`, o
//! estado tem de estar exatamente como estava. Valide tudo ANTES de mutar.
//!
//! # Por que os tipos espelham o objeto do JS campo a campo
//!
//! `Collection`, `NftToken` e `NameRecord` viram folha do `stateRoot` (domínios
//! `nft` e `name` em `src/core/stateroot.js`). A folha é o mapa canônico dos
//! campos, com as chaves em camelCase da referência: renomear `owner` para
//! `creator`, ou mover `approvals` para dentro do token, muda a raiz de estado da
//! rede inteira sem mudar comportamento nenhum — o modo de falha mais caro que
//! existe aqui, porque só aparece quando este cliente já está sincronizando.

use super::{Amount, Ctx, State, StateError};
use crate::canonical::Value;
use crate::address::is_valid_address;
use crate::hash::eav_hash_one;
use crate::transaction::{JsonValue, Tx};
use std::collections::BTreeMap;

// ---------------------------------------------------------------- constantes
//
// Re-exportadas de `crate::config` (gerado de `src/config.js` — fonte única).
// Ficam nomeadas aqui só para o corpo do módulo lê-las sem qualificar; o VALOR
// vem do gerador, então regenerar a config atualiza este módulo junto.

/// `CHAIN.NFT_HEIGHT` (src/config.js:366) — altura em que o padrão EAV721 liga.
pub const NFT_HEIGHT: u64 = crate::config::NFT_HEIGHT;

/// `CHAIN.MAX_NFT_URI_BYTES` (src/config.js:367) — teto da URI de metadados, em
/// BYTES do UTF-8 (a referência usa `Buffer.byteLength`, não `String.length`).
pub const MAX_NFT_URI_BYTES: usize = crate::config::MAX_NFT_URI_BYTES as usize;

/// `CHAIN.NAME_HEIGHT` (src/config.js:369) — altura em que o EAV-NS liga.
pub const NAME_HEIGHT: u64 = crate::config::NAME_HEIGHT;

/// `CHAIN.NAME_REGISTER_COST` (src/config.js:370) — 1 EAV7 (`1n * UNIT`, e UNIT é
/// 1_000_000 e7). É QUEIMADO no registro, não pago a ninguém: é o que torna caro
/// varrer o espaço de nomes curtos (anti-squatting).
pub const NAME_REGISTER_COST: Amount = crate::config::NAME_REGISTER_COST as Amount;

/// Rótulo do padrão, gravado em toda coleção. Entra na folha canônica.
const STANDARD: &str = "eav721";

/// Comprimento máximo do nome de uma coleção, em unidades UTF-16 — a referência
/// testa `name.length`, que em JS conta unidades UTF-16, não caracteres.
const MAX_COLLECTION_NAME_UTF16: usize = 64;

/// Coleção EAV721.
///
/// Os nomes de campo entram na folha do `stateRoot` — não renomeie. Em especial
/// `owner` (e não `creator`): é o campo que a referência grava e o que `NFT_MINT`
/// confere.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Collection {
    pub standard: String,
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub owner: String,
    pub created_at: u64,
    pub next_id: u64,
    pub tokens: BTreeMap<String, NftToken>,
    /// Aprovação por token: `tokenId` → endereço autorizado a mover aquele item.
    ///
    /// Vive na coleção, e não dentro de `NftToken`, porque é assim na referência —
    /// e a forma da folha canônica segue a estrutura, não a conveniência.
    pub approvals: BTreeMap<String, String>,
}

/// Item de uma coleção.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NftToken {
    pub owner: String,
    pub uri: String,
}

/// Registro do serviço de nomes EAV-NS.
///
/// Não guarda o próprio nome: o nome é a CHAVE em `State::names` e a chave da
/// folha canônica. Duplicá-lo aqui mudaria a folha.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NameRecord {
    pub owner: String,
    /// Endereço para o qual o nome resolve. Começa igual ao dono, mas pode
    /// apontar para outro — daí ser campo separado de `owner`.
    pub target: String,
    pub registered_at: u64,
}

impl NftToken {
    /// Forma canônica para a folha do `stateRoot`.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("owner".into(), Value::str(&self.owner));
        m.insert("uri".into(), Value::str(&self.uri));
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 2 {
            return None;
        }
        Some(NftToken {
            owner: m.get("owner")?.texto()?.to_string(),
            uri: m.get("uri")?.texto()?.to_string(),
        })
    }
}

/// Mapa `chave → texto` da forma canônica — as `approvals` da coleção.
fn mapa_de_texto(v: &Value) -> Option<BTreeMap<String, String>> {
    v.mapa()?
        .iter()
        .map(|(k, x)| Some((k.clone(), x.texto()?.to_string())))
        .collect()
}

impl Collection {
    /// Forma canônica para a folha do `stateRoot`.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert(
            "approvals".into(),
            Value::Map(
                self.approvals.iter().map(|(k, v)| (k.clone(), Value::str(v))).collect(),
            ),
        );
        m.insert("createdAt".into(), Value::uint(self.created_at));
        m.insert("id".into(), Value::str(&self.id));
        m.insert("name".into(), Value::str(&self.name));
        m.insert("nextId".into(), Value::uint(self.next_id));
        m.insert("owner".into(), Value::str(&self.owner));
        m.insert("standard".into(), Value::str(&self.standard));
        m.insert("symbol".into(), Value::str(&self.symbol));
        m.insert(
            "tokens".into(),
            Value::Map(self.tokens.iter().map(|(k, v)| (k.clone(), v.to_value())).collect()),
        );
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 9 {
            return None;
        }
        Some(Collection {
            standard: m.get("standard")?.texto()?.to_string(),
            id: m.get("id")?.texto()?.to_string(),
            name: m.get("name")?.texto()?.to_string(),
            symbol: m.get("symbol")?.texto()?.to_string(),
            owner: m.get("owner")?.texto()?.to_string(),
            created_at: m.get("createdAt")?.inteiro()?,
            next_id: m.get("nextId")?.inteiro()?,
            tokens: m
                .get("tokens")?
                .mapa()?
                .iter()
                .map(|(k, t)| Some((k.clone(), NftToken::from_value(t)?)))
                .collect::<Option<_>>()?,
            approvals: mapa_de_texto(m.get("approvals")?)?,
        })
    }
}

impl NameRecord {
    /// Forma canônica para a folha do `stateRoot`.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("owner".into(), Value::str(&self.owner));
        m.insert("registeredAt".into(), Value::uint(self.registered_at));
        m.insert("target".into(), Value::str(&self.target));
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`]. O NOME não está aqui, e não é omissão:
    /// ele é a chave da folha, e quem reconstrói o mapa é `from_snapshot_value`.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 3 {
            return None;
        }
        Some(NameRecord {
            owner: m.get("owner")?.texto()?.to_string(),
            target: m.get("target")?.texto()?.to_string(),
            registered_at: m.get("registeredAt")?.inteiro()?,
        })
    }
}

/// Tipos de transação que este módulo atende. O despacho em `mod.rs` usa esta
/// lista, então um tipo esquecido aqui vira erro de "tipo desconhecido" em vez de
/// falha silenciosa.
pub const TIPOS: &[&str] = &[
    "NFT_CREATE",
    "NFT_MINT",
    "NFT_TRANSFER",
    "NFT_APPROVE",
    "NFT_BURN",
    "NAME_REGISTER",
    "NAME_UPDATE",
    "NAME_TRANSFER",
    "NAME_RELEASE",
];

// ------------------------------------------------------- leitura de `tx.data`
//
// A referência lê `tx.data?.x` e deixa o JS coagir o resultado. Coerção implícita
// não existe em Rust, então ela é reproduzida EXPLICITAMENTE aqui. Não é
// preciosismo: `String(tx.data?.tokenId)` com o campo ausente devolve a string
// `"undefined"`, que o nó de referência usa como chave de busca — e não acha
// nada. Um port que rejeitasse com outro erro divergiria na mensagem; um que
// aceitasse divergiria no estado.

/// `tx.data?.chave`, ou `None` se não houver `data` ou a chave faltar.
fn campo<'a>(tx: &'a Tx, chave: &str) -> Option<&'a JsonValue> {
    match tx.data.as_ref()? {
        JsonValue::Map(m) => m.get(chave),
        _ => None,
    }
}

/// O campo, se e somente se for string. `typeof x !== 'string'` da referência.
fn texto<'a>(tx: &'a Tx, chave: &str) -> Option<&'a str> {
    match campo(tx, chave)? {
        JsonValue::Str(s) => Some(s.as_str()),
        _ => None,
    }
}

/// `String(valor)` do JS, para os tipos que o `data` pode conter.
///
/// Existe porque a referência aplica `String()` ao `tokenId` e ao `name` em vez de
/// exigir texto — e isso tem consequência observável: `{ name: ["ab-cd"] }` vira a
/// string `"ab-cd"`, que passa na validação de nome. Absurdo, mas é o que a rede
/// aceita hoje, e um cliente que recusasse rejeitaria um bloco válido.
pub(crate) fn js_string(v: Option<&JsonValue>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(JsonValue::Null) => "null".to_string(),
        Some(JsonValue::Bool(b)) => b.to_string(),
        Some(JsonValue::Int(i)) => i.to_string(),
        Some(JsonValue::Str(s)) => s.clone(),
        // `Array.prototype.toString` é `join(',')`, e `join` emite string vazia
        // para `null`/`undefined` em vez de "null".
        Some(JsonValue::List(itens)) => itens
            .iter()
            .map(|item| match item {
                JsonValue::Null => String::new(),
                outro => js_string(Some(outro)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(JsonValue::Map(_)) => "[object Object]".to_string(),
    }
}

/// `String(tx.data?.x ?? '')`: o coalescente trata ausente E nulo como `''`.
fn js_string_ou_vazio(v: Option<&JsonValue>) -> String {
    match v {
        None | Some(JsonValue::Null) => String::new(),
        outro => js_string(outro),
    }
}

// `js_trim` vive em `state::coercao` — é COMPARTILHADO. Ficava só aqui, e o
// `token.rs` acabou usando `str::trim`, com a divergência de BOM entrando na
// folha `tok`.
use crate::state::coercao::js_trim;

/// Regra de símbolo da referência: `/^[A-Z0-9]{2,10}$/`.
///
/// Maiúsculas ASCII apenas. Aceitar minúsculas ou acento deixaria dois símbolos
/// visualmente idênticos coexistirem, que é o vetor clássico de golpe em NFT.
fn simbolo_valido(s: &str) -> bool {
    let n = s.len(); // ASCII puro pelo próprio predicado: bytes == caracteres
    (2..=10).contains(&n) && s.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

/// Regra de nome do EAV-NS: `/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/`.
///
/// Ou seja: 3 a 32 caracteres, minúsculas/dígitos/hífen, e SEM hífen nas pontas.
/// A proibição nas pontas não é estética — é o que impede `-eav7` e `eav7-` de
/// serem confundidos visualmente com `eav7` numa lista.
fn nome_valido(s: &str) -> bool {
    let b = s.as_bytes();
    if !(3..=32).contains(&b.len()) {
        return false;
    }
    let alnum = |c: u8| c.is_ascii_lowercase() || c.is_ascii_digit();
    // O predicado é sobre BYTES, e é seguro: qualquer byte não-ASCII (>= 0x80)
    // falha em `alnum` e no miolo, então nome com UTF-8 multibyte é rejeitado
    // antes de qualquer fatiamento.
    alnum(b[0]) && alnum(b[b.len() - 1]) && b[1..b.len() - 1].iter().all(|&c| alnum(c) || c == b'-')
}

/// Timestamp da transação como `u64`.
///
/// `Tx.timestamp` é `i64` porque é entrada não confiável; o registro guarda `u64`.
/// A conversão é a validação, e ela falha em vez de saturar: um `createdAt` que
/// virasse 0 por saturação gravaria data errada na folha canônica.
fn ts(tx: &Tx) -> Result<u64, StateError> {
    u64::try_from(tx.timestamp).map_err(|_| StateError(format!(
        "timestamp inválido na transação ({})", tx.timestamp
    )))
}

/// Destino da transação, exigindo endereço válido. `mensagem` é a da referência,
/// que difere por tipo ("destino inválido" vs "aprovado inválido").
fn destino<'a>(tx: &'a Tx, mensagem: &str) -> Result<&'a str, StateError> {
    match tx.to.as_deref() {
        Some(t) if is_valid_address(t) => Ok(t),
        _ => Err(StateError(mensagem.to_string())),
    }
}

// ------------------------------------------------------------------ despacho

pub fn aplicar(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    match tx.tx_type.as_str() {
        "NFT_CREATE" => nft_create(state, tx, ctx),
        "NFT_MINT" => nft_mint(state, tx, ctx),
        "NFT_TRANSFER" => nft_transfer(state, tx, ctx),
        "NFT_APPROVE" => nft_approve(state, tx, ctx),
        "NFT_BURN" => nft_burn(state, tx, ctx),
        "NAME_REGISTER" => name_register(state, tx, ctx),
        "NAME_UPDATE" => name_update(state, tx, ctx),
        "NAME_TRANSFER" => name_transfer(state, tx, ctx),
        "NAME_RELEASE" => name_release(state, tx, ctx),
        outro => Err(StateError(format!("tipo de transação desconhecido: {outro}"))),
    }
}

/// Confere que o remetente cobre a taxa, SEM tocar no estado.
///
/// Separado do débito de propósito: toda validação acontece antes de qualquer
/// mutação, e ler o saldo por aqui (e não por `account_mut`) evita materializar
/// uma conta-fantasma quando a transação vai ser rejeitada — o que mudaria a raiz
/// sem que nada se aplicasse.
fn exige_saldo(state: &State, tx: &Tx, valor: Amount, mensagem: &str) -> Result<(), StateError> {
    if state.account(&tx.from).balance < valor {
        return Err(StateError(mensagem.to_string()));
    }
    Ok(())
}

// ----------------------------------------------------------------- EAV721

fn nft_create(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    if ctx.height < NFT_HEIGHT {
        return Err(StateError("NFT ainda não ativo".into()));
    }
    let name = texto(tx, "name").ok_or_else(|| StateError("nome da coleção inválido".into()))?;
    let aparado = js_trim(name);
    if aparado.is_empty() || name.encode_utf16().count() > MAX_COLLECTION_NAME_UTF16 {
        return Err(StateError("nome da coleção inválido".into()));
    }
    let symbol = texto(tx, "symbol").filter(|s| simbolo_valido(s))
        .ok_or_else(|| StateError("símbolo inválido".into()))?;
    // O id da coleção deriva do id da TRANSAÇÃO — logo é único e imprevisível sem
    // conhecer a transação inteira. Uma transação sem id não pode ser aplicada:
    // duas coleções cairiam na mesma chave.
    let txid = tx.id.as_deref().ok_or_else(|| StateError(
        "transação sem id: coleção não tem como derivar identificador".into(),
    ))?;
    let created_at = ts(tx)?;
    exige_saldo(state, tx, ctx.fee, "saldo insuficiente para a taxa de criação")?;

    // Daqui para baixo nada mais pode falhar por validação.
    let cid = eav_hash_one(format!("EAV721-COLLECTION:{txid}"));
    state.debitar(&tx.from, ctx.fee)?;
    state.nfts.insert(cid.clone(), Collection {
        standard: STANDARD.to_string(),
        id: cid,
        name: aparado.to_string(), // grava o APARADO, como a referência
        symbol: symbol.to_string(),
        owner: tx.from.clone(),
        created_at,
        next_id: 1,
        tokens: BTreeMap::new(),
        approvals: BTreeMap::new(),
    });
    Ok(())
}

fn nft_mint(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    if ctx.height < NFT_HEIGHT {
        return Err(StateError("NFT ainda não ativo".into()));
    }
    let cid = js_string(campo(tx, "collection"));
    let col = state.nfts.get(&cid).ok_or_else(|| StateError("coleção inexistente".into()))?;
    if col.owner != tx.from {
        return Err(StateError("só o owner da coleção pode mint".into()));
    }
    let para = destino(tx, "destino inválido")?.to_string();
    // `uri` ausente OU NULA vira string vazia — a referência usa `?? ''`
    // (state.js:1826), e `??` não distingue `undefined` de `null`. Tratar só a
    // ausência fazia `{"uri": null}` ser aceito pela rede e recusado aqui.
    // Presente e de outro tipo continua erro. O teto é em BYTES do UTF-8: contar
    // caracteres deixaria passar uma URI com acentos que a referência recusa.
    let uri = match campo(tx, "uri") {
        None | Some(JsonValue::Null) => String::new(),
        Some(JsonValue::Str(s)) if s.len() <= MAX_NFT_URI_BYTES => s.clone(),
        _ => return Err(StateError("uri inválida".into())),
    };
    exige_saldo(state, tx, ctx.fee, "saldo insuficiente para a taxa")?;

    let token_id = col.next_id.to_string();
    // `next_id` é `u64` e o incremento é checado: sem isso, uma coleção no teto
    // daria a volta e o mint sobrescreveria o token 0 em silêncio.
    let proximo = col.next_id.checked_add(1)
        .ok_or_else(|| StateError("estouro do contador de tokens da coleção".into()))?;

    state.debitar(&tx.from, ctx.fee)?;
    // O `get_mut` não pode falhar: a coleção foi encontrada acima e nada entre os
    // dois pontos remove coleção. Ainda assim é tratado, porque `unwrap` em nó de
    // consenso é pânico à espera de uma refatoração distraída.
    let col = state.nfts.get_mut(&cid).ok_or_else(|| StateError("coleção inexistente".into()))?;
    col.next_id = proximo;
    col.tokens.insert(token_id, NftToken { owner: para, uri });
    Ok(())
}

fn nft_transfer(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    if ctx.height < NFT_HEIGHT {
        return Err(StateError("NFT ainda não ativo".into()));
    }
    let cid = js_string(campo(tx, "collection"));
    let token_id = js_string(campo(tx, "tokenId"));
    let col = state.nfts.get(&cid).ok_or_else(|| StateError("coleção inexistente".into()))?;
    let nft = col.tokens.get(&token_id).ok_or_else(|| StateError("NFT inexistente".into()))?;
    // Dono OU aprovado para ESTE token. A aprovação é por item, não por coleção.
    if nft.owner != tx.from && col.approvals.get(&token_id).map(String::as_str) != Some(tx.from.as_str()) {
        return Err(StateError("não é dono nem aprovado".into()));
    }
    let para = destino(tx, "destino inválido")?.to_string();
    exige_saldo(state, tx, ctx.fee, "saldo insuficiente para a taxa")?;

    state.debitar(&tx.from, ctx.fee)?;
    let col = state.nfts.get_mut(&cid).ok_or_else(|| StateError("coleção inexistente".into()))?;
    if let Some(nft) = col.tokens.get_mut(&token_id) {
        nft.owner = para;
    }
    // A aprovação MORRE na transferência. Mantê-la deixaria o aprovado do dono
    // ANTERIOR continuar podendo mover o item da carteira do novo dono — que é
    // roubo com autorização válida, e o comprador não teria como saber.
    col.approvals.remove(&token_id);
    Ok(())
}

/// Efeito de `NFT_TRANSFER` disparado por operação MULTISSINATURA (`state.js:489`).
///
/// Vive AQUI, e não em `gov.rs`, porque a regra é do domínio de NFT — em especial
/// a de que a APROVAÇÃO morre na transferência. Uma segunda cópia dela na
/// governança seria uma segunda versão de uma regra de consenso.
///
/// Difere do caminho direto em dois pontos, ambos da referência: a conta
/// multissinatura tem de ser a DONA (aprovação de terceiro não serve — quem
/// aprova é a conta, e a operação já é decidida pelas chaves dela), e nada de
/// taxa (quem paga é a transação `MULTISIG_APPROVE` que a executou).
pub(crate) fn efeito_multisig_transfer(
    state: &mut State,
    colecao: &str,
    token_id: &str,
    dona: &str,
    para: &str,
) -> Result<(), StateError> {
    let col = state.nfts.get(colecao).ok_or_else(|| StateError("coleção inexistente".into()))?;
    let e_dona = col.tokens.get(token_id).is_some_and(|n| n.owner == dona);
    if !e_dona {
        return Err(StateError("a conta multisig não é dona deste NFT".into()));
    }
    if !crate::is_valid_address(para) {
        return Err(StateError("destino inválido".into()));
    }

    // ---- fronteira ----
    let col = state.nfts.get_mut(colecao).ok_or_else(|| StateError("coleção inexistente".into()))?;
    if let Some(nft) = col.tokens.get_mut(token_id) {
        nft.owner = para.to_string();
    }
    col.approvals.remove(token_id);
    Ok(())
}

fn nft_approve(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    if ctx.height < NFT_HEIGHT {
        return Err(StateError("NFT ainda não ativo".into()));
    }
    let cid = js_string(campo(tx, "collection"));
    let token_id = js_string(campo(tx, "tokenId"));
    let col = state.nfts.get(&cid).ok_or_else(|| StateError("coleção inexistente".into()))?;
    let nft = col.tokens.get(&token_id).ok_or_else(|| StateError("NFT inexistente".into()))?;
    // Só o DONO aprova — um aprovado não pode repassar a própria aprovação, senão
    // a autorização se propagaria fora do controle de quem a concedeu.
    if nft.owner != tx.from {
        return Err(StateError("só o dono aprova".into()));
    }
    let aprovado = destino(tx, "aprovado inválido")?.to_string();
    exige_saldo(state, tx, ctx.fee, "saldo insuficiente para a taxa")?;

    state.debitar(&tx.from, ctx.fee)?;
    let col = state.nfts.get_mut(&cid).ok_or_else(|| StateError("coleção inexistente".into()))?;
    col.approvals.insert(token_id, aprovado);
    Ok(())
}

fn nft_burn(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    if ctx.height < NFT_HEIGHT {
        return Err(StateError("NFT ainda não ativo".into()));
    }
    let cid = js_string(campo(tx, "collection"));
    let token_id = js_string(campo(tx, "tokenId"));
    let col = state.nfts.get(&cid).ok_or_else(|| StateError("coleção inexistente".into()))?;
    let nft = col.tokens.get(&token_id).ok_or_else(|| StateError("NFT inexistente".into()))?;
    if nft.owner != tx.from {
        return Err(StateError("só o dono queima".into()));
    }
    exige_saldo(state, tx, ctx.fee, "saldo insuficiente para a taxa")?;

    state.debitar(&tx.from, ctx.fee)?;
    let col = state.nfts.get_mut(&cid).ok_or_else(|| StateError("coleção inexistente".into()))?;
    col.tokens.remove(&token_id);
    // A aprovação some junto: deixá-la órfã sujaria a folha canônica com uma
    // entrada que nenhum token mais respalda. `next_id` NÃO recua — reaproveitar
    // id de token queimado faria dois itens diferentes terem a mesma identidade.
    col.approvals.remove(&token_id);
    Ok(())
}

// ------------------------------------------------------------------ EAV-NS

fn name_register(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    if ctx.height < NAME_HEIGHT {
        return Err(StateError("serviço de nomes ainda não ativo".into()));
    }
    let name = js_string_ou_vazio(campo(tx, "name")).to_lowercase();
    if !nome_valido(&name) {
        return Err(StateError("nome inválido (3-32, [a-z0-9-], sem hífen nas pontas)".into()));
    }
    // Unicidade: primeiro a registrar fica com o nome, e não há sobrescrita.
    // Permitir sobrescrever seria sequestro de identidade legível.
    if state.names.contains_key(&name) {
        return Err(StateError("nome já registrado".into()));
    }
    // Sem alvo explícito — ausente OU NULO — o nome resolve para quem registrou.
    // A referência usa `?? tx.from` (state.js:1888), e `??` não distingue os
    // dois: `{"target": null}` era aceito pela rede e recusado aqui.
    let target = match campo(tx, "target") {
        None | Some(JsonValue::Null) => tx.from.clone(),
        Some(JsonValue::Str(s)) if is_valid_address(s) => s.clone(),
        _ => return Err(StateError("endereço-alvo inválido".into())),
    };
    let registered_at = ts(tx)?;
    let total = ctx.fee.checked_add(NAME_REGISTER_COST)
        .ok_or_else(|| StateError("estouro aritmético no custo de registro".into()))?;
    exige_saldo(state, tx, total, "saldo insuficiente para registrar")?;

    state.debitar(&tx.from, ctx.fee)?;
    // O custo de registro é QUEIMADO, não pago a validador nem à tesouraria: some
    // do suprimento. É o que faz o squatting custar caro de verdade — quem varre o
    // espaço de nomes destrói o próprio capital em vez de transferi-lo a alguém.
    state.queimar(&tx.from, NAME_REGISTER_COST)?;
    state.names.insert(name, NameRecord { owner: tx.from.clone(), target, registered_at });
    Ok(())
}

fn name_update(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    if ctx.height < NAME_HEIGHT {
        return Err(StateError("serviço de nomes ainda não ativo".into()));
    }
    let name = js_string_ou_vazio(campo(tx, "name")).to_lowercase();
    let rec = state.names.get(&name).ok_or_else(|| StateError("nome inexistente".into()))?;
    if rec.owner != tx.from {
        return Err(StateError("só o dono do nome atualiza".into()));
    }
    // Aqui o alvo é OBRIGATÓRIO (diferente do registro, que cai no remetente):
    // um update sem alvo não teria o que fazer.
    let target = match campo(tx, "target") {
        Some(JsonValue::Str(s)) if is_valid_address(s) => s.clone(),
        _ => return Err(StateError("endereço-alvo inválido".into())),
    };
    exige_saldo(state, tx, ctx.fee, "saldo insuficiente para a taxa")?;

    state.debitar(&tx.from, ctx.fee)?;
    if let Some(rec) = state.names.get_mut(&name) {
        rec.target = target;
    }
    Ok(())
}

fn name_transfer(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    if ctx.height < NAME_HEIGHT {
        return Err(StateError("serviço de nomes ainda não ativo".into()));
    }
    let name = js_string_ou_vazio(campo(tx, "name")).to_lowercase();
    let rec = state.names.get(&name).ok_or_else(|| StateError("nome inexistente".into()))?;
    if rec.owner != tx.from {
        return Err(StateError("só o dono do nome transfere".into()));
    }
    let novo_dono = destino(tx, "novo dono inválido")?.to_string();
    exige_saldo(state, tx, ctx.fee, "saldo insuficiente para a taxa")?;

    state.debitar(&tx.from, ctx.fee)?;
    if let Some(rec) = state.names.get_mut(&name) {
        // Só o DONO muda. O `target` fica onde estava — a referência não o toca, e
        // reapontá-lo aqui redirecionaria pagamentos que o novo dono não pediu.
        rec.owner = novo_dono;
    }
    Ok(())
}

fn name_release(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    if ctx.height < NAME_HEIGHT {
        return Err(StateError("serviço de nomes ainda não ativo".into()));
    }
    let name = js_string_ou_vazio(campo(tx, "name")).to_lowercase();
    let rec = state.names.get(&name).ok_or_else(|| StateError("nome inexistente".into()))?;
    if rec.owner != tx.from {
        return Err(StateError("só o dono do nome libera".into()));
    }
    exige_saldo(state, tx, ctx.fee, "saldo insuficiente para a taxa")?;

    state.debitar(&tx.from, ctx.fee)?;
    // Liberar devolve o nome ao pool: fica registrável por qualquer um. O custo
    // queimado no registro NÃO volta — se voltasse, dava para prender nomes de
    // graça, registrando e liberando.
    state.names.remove(&name);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Account;

    const ALICE: &str = "E7F2906E0A0F13E9F19C4B0EB4D0C50D9C8A2B1E7A4D3F6C5B8E9A0D126";
    const BOB: &str = "E7A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6";

    /// Endereços de teste têm de ser VÁLIDOS de verdade: a máquina de estado
    /// confere checksum, e um endereço inventado faria o teste passar pelo motivo
    /// errado (rejeição por formato, não pela regra em exame).
    fn addr(semente: &str) -> String {
        crate::address::derive_address_from(semente)
    }

    fn estado_com_saldo(quem: &[(&str, Amount)]) -> State {
        let mut s = State::new();
        for (a, b) in quem {
            s.accounts.insert((*a).to_string(), Account { balance: *b, ..Default::default() });
        }
        s
    }

    fn tx(tipo: &str, de: &str, dados: &[(&str, JsonValue)]) -> Tx {
        let mut t = Tx::new(tipo, de, 1, 1_700_000_000_000);
        t.data = Some(JsonValue::map(
            dados.iter().map(|(k, v)| ((*k).to_string(), v.clone())),
        ));
        t.id = Some("a".repeat(64));
        t
    }

    fn ctx(altura: u64) -> Ctx {
        Ctx { height: altura, block_ts: 1_700_000_000_000, fee: 0 }
    }

    /// Altura em que TUDO deste módulo está ativo.
    fn ativo() -> Ctx {
        ctx(NAME_HEIGHT)
    }

    /// Cria uma coleção e devolve o id derivado, para os testes que precisam de
    /// uma coleção pronta.
    fn cria_colecao(s: &mut State, dono: &str) -> String {
        let mut t = tx("NFT_CREATE", dono, &[
            ("name", JsonValue::str("Coleção")),
            ("symbol", JsonValue::str("EAV")),
        ]);
        t.id = Some(eav_hash_one(format!("txid-da-colecao-de-{dono}")));
        aplicar(s, &t, &ativo()).expect("criação da coleção deveria passar");
        eav_hash_one(format!("EAV721-COLLECTION:{}", t.id.unwrap()))
    }

    // ------------------------------------------------------------ NFT_CREATE

    #[test]
    fn nft_create_grava_colecao_com_os_campos_da_referencia() {
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000)]);
        let cid = cria_colecao(&mut s, &dono);

        let col = s.nfts.get(&cid).expect("coleção gravada sob a hash do txid");
        assert_eq!(col.standard, "eav721");
        assert_eq!(col.id, cid);
        assert_eq!(col.owner, dono);
        assert_eq!(col.symbol, "EAV");
        assert_eq!(col.next_id, 1, "o primeiro token da coleção é o 1, não o 0");
        assert!(col.tokens.is_empty());
    }

    #[test]
    fn nft_create_apara_o_nome_antes_de_gravar() {
        // O nome APARADO é o que entra na folha do stateRoot — gravar com o espaço
        // daria outra raiz de estado.
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000)]);
        let t = tx("NFT_CREATE", &dono, &[
            ("name", JsonValue::str("  Arte EAV7 \u{feff}")),
            ("symbol", JsonValue::str("ART7")),
        ]);
        aplicar(&mut s, &t, &ativo()).unwrap();
        assert_eq!(s.nfts.values().next().unwrap().name, "Arte EAV7");
    }

    #[test]
    fn nft_create_recusa_simbolo_minusculo() {
        // Erro mais provável do usuário: símbolo em minúsculas. Aceitar deixaria
        // "eav" e "EAV" coexistirem — confusão explorável.
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000)]);
        let t = tx("NFT_CREATE", &dono, &[
            ("name", JsonValue::str("Arte")),
            ("symbol", JsonValue::str("eav")),
        ]);
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "símbolo inválido");
    }

    #[test]
    fn nft_create_recusa_nome_so_de_espacos() {
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000)]);
        let t = tx("NFT_CREATE", &dono, &[
            ("name", JsonValue::str("   ")),
            ("symbol", JsonValue::str("EAV")),
        ]);
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "nome da coleção inválido");
    }

    #[test]
    fn nft_create_recusa_abaixo_da_altura_do_fork() {
        if NFT_HEIGHT == 0 { return; }
        // Sem este gate, o cliente aceitaria uma transação que a rede rejeita — e
        // cindiria a cadeia sozinho.
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000)]);
        let t = tx("NFT_CREATE", &dono, &[
            ("name", JsonValue::str("Arte")),
            ("symbol", JsonValue::str("EAV")),
        ]);
        assert_eq!(aplicar(&mut s, &t, &ctx(NFT_HEIGHT - 1)).unwrap_err().0, "NFT ainda não ativo");
        assert!(s.nfts.is_empty());
    }

    // -------------------------------------------------------------- NFT_MINT

    #[test]
    fn nft_mint_numera_a_partir_de_um_e_avanca() {
        let dono = addr(ALICE);
        let para = addr(BOB);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000)]);
        let cid = cria_colecao(&mut s, &dono);

        for esperado in ["1", "2"] {
            let mut t = tx("NFT_MINT", &dono, &[
                ("collection", JsonValue::str(&cid)),
                ("uri", JsonValue::str("ipfs://x")),
            ]);
            t.to = Some(para.clone());
            aplicar(&mut s, &t, &ativo()).unwrap();
            let col = s.nfts.get(&cid).unwrap();
            assert!(col.tokens.contains_key(esperado), "token {esperado} deveria existir");
            assert_eq!(col.tokens[esperado].owner, para, "o mint credita o DESTINO, não o mintador");
        }
        assert_eq!(s.nfts[&cid].next_id, 3);
    }

    #[test]
    fn nft_mint_so_pelo_dono_da_colecao() {
        let dono = addr(ALICE);
        let intruso = addr(BOB);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000), (&intruso, 100_000_000)]);
        let cid = cria_colecao(&mut s, &dono);

        let mut t = tx("NFT_MINT", &intruso, &[("collection", JsonValue::str(&cid))]);
        t.to = Some(intruso.clone());
        assert_eq!(
            aplicar(&mut s, &t, &ativo()).unwrap_err().0,
            "só o owner da coleção pode mint"
        );
        assert!(s.nfts[&cid].tokens.is_empty());
    }

    #[test]
    fn nft_mint_recusa_uri_acima_do_teto_em_bytes() {
        // O teto é em BYTES do UTF-8: 1_025 caracteres de 2 bytes passam de 2_048.
        // Contar caracteres deixaria passar o que a referência recusa.
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000)]);
        let cid = cria_colecao(&mut s, &dono);

        let mut t = tx("NFT_MINT", &dono, &[
            ("collection", JsonValue::str(&cid)),
            ("uri", JsonValue::str("é".repeat(1_025))),
        ]);
        t.to = Some(dono.clone());
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "uri inválida");
    }

    #[test]
    fn nft_mint_em_colecao_inexistente_falha() {
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000)]);
        let mut t = tx("NFT_MINT", &dono, &[("collection", JsonValue::str("nao-existe"))]);
        t.to = Some(dono.clone());
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "coleção inexistente");
    }

    // ---------------------------------------------------- NFT_APPROVE/TRANSFER

    /// Cenário base: coleção do ALICE, token 1 do ALICE.
    fn cenario_token() -> (State, String, String, String) {
        let dono = addr(ALICE);
        let outro = addr(BOB);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000), (&outro, 100_000_000)]);
        let cid = cria_colecao(&mut s, &dono);
        let mut t = tx("NFT_MINT", &dono, &[("collection", JsonValue::str(&cid))]);
        t.to = Some(dono.clone());
        aplicar(&mut s, &t, &ativo()).unwrap();
        (s, cid, dono, outro)
    }

    #[test]
    fn nft_approve_deixa_o_aprovado_transferir() {
        let (mut s, cid, dono, operador) = cenario_token();
        let terceiro = addr("terceiro-destinatario");

        let mut ap = tx("NFT_APPROVE", &dono, &[
            ("collection", JsonValue::str(&cid)),
            ("tokenId", JsonValue::Int(1)),
        ]);
        ap.to = Some(operador.clone());
        aplicar(&mut s, &ap, &ativo()).unwrap();
        assert_eq!(s.nfts[&cid].approvals["1"], operador);

        // O aprovado move o item, mesmo não sendo dono.
        let mut tr = tx("NFT_TRANSFER", &operador, &[
            ("collection", JsonValue::str(&cid)),
            ("tokenId", JsonValue::Int(1)),
        ]);
        tr.to = Some(terceiro.clone());
        aplicar(&mut s, &tr, &ativo()).unwrap();
        assert_eq!(s.nfts[&cid].tokens["1"].owner, terceiro);
    }

    #[test]
    fn a_aprovacao_e_limpa_na_transferencia() {
        // A regra sutil: se a aprovação sobrevivesse, o aprovado do dono ANTERIOR
        // continuaria podendo tirar o item da carteira do novo dono. É roubo com
        // autorização válida, e o comprador não teria como perceber.
        let (mut s, cid, dono, operador) = cenario_token();
        let comprador = addr("comprador-do-nft");

        let mut ap = tx("NFT_APPROVE", &dono, &[
            ("collection", JsonValue::str(&cid)),
            ("tokenId", JsonValue::Int(1)),
        ]);
        ap.to = Some(operador.clone());
        aplicar(&mut s, &ap, &ativo()).unwrap();

        let mut tr = tx("NFT_TRANSFER", &dono, &[
            ("collection", JsonValue::str(&cid)),
            ("tokenId", JsonValue::Int(1)),
        ]);
        tr.to = Some(comprador.clone());
        aplicar(&mut s, &tr, &ativo()).unwrap();

        assert!(!s.nfts[&cid].approvals.contains_key("1"), "a aprovação tem de morrer na transferência");

        // E, de fato, o antigo aprovado não consegue mais mover o item.
        let mut roubo = tx("NFT_TRANSFER", &operador, &[
            ("collection", JsonValue::str(&cid)),
            ("tokenId", JsonValue::Int(1)),
        ]);
        roubo.to = Some(operador.clone());
        assert_eq!(aplicar(&mut s, &roubo, &ativo()).unwrap_err().0, "não é dono nem aprovado");
        assert_eq!(s.nfts[&cid].tokens["1"].owner, comprador);
    }

    #[test]
    fn nft_approve_so_pelo_dono() {
        let (mut s, cid, _dono, outro) = cenario_token();
        let mut t = tx("NFT_APPROVE", &outro, &[
            ("collection", JsonValue::str(&cid)),
            ("tokenId", JsonValue::Int(1)),
        ]);
        t.to = Some(outro.clone());
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "só o dono aprova");
    }

    #[test]
    fn nft_transfer_recusa_quem_nao_e_dono_nem_aprovado() {
        let (mut s, cid, dono, intruso) = cenario_token();
        let mut t = tx("NFT_TRANSFER", &intruso, &[
            ("collection", JsonValue::str(&cid)),
            ("tokenId", JsonValue::Int(1)),
        ]);
        t.to = Some(intruso.clone());
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "não é dono nem aprovado");
        assert_eq!(s.nfts[&cid].tokens["1"].owner, dono);
    }

    #[test]
    fn tokenid_ausente_cai_em_nft_inexistente() {
        // A referência faz `String(tx.data?.tokenId)`, que com o campo ausente vira
        // a chave "undefined" — e a busca não acha nada.
        let (mut s, cid, dono, _) = cenario_token();
        let mut t = tx("NFT_TRANSFER", &dono, &[("collection", JsonValue::str(&cid))]);
        t.to = Some(dono.clone());
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "NFT inexistente");
    }

    // -------------------------------------------------------------- NFT_BURN

    #[test]
    fn nft_burn_remove_token_e_aprovacao_sem_recuar_o_contador() {
        let (mut s, cid, dono, operador) = cenario_token();
        let mut ap = tx("NFT_APPROVE", &dono, &[
            ("collection", JsonValue::str(&cid)),
            ("tokenId", JsonValue::Int(1)),
        ]);
        ap.to = Some(operador.clone());
        aplicar(&mut s, &ap, &ativo()).unwrap();

        let t = tx("NFT_BURN", &dono, &[
            ("collection", JsonValue::str(&cid)),
            ("tokenId", JsonValue::Int(1)),
        ]);
        aplicar(&mut s, &t, &ativo()).unwrap();

        let col = &s.nfts[&cid];
        assert!(col.tokens.is_empty());
        assert!(col.approvals.is_empty(), "aprovação órfã sujaria a folha canônica");
        assert_eq!(col.next_id, 2, "id de token queimado NÃO é reaproveitado");
    }

    #[test]
    fn nft_burn_so_pelo_dono() {
        let (mut s, cid, _dono, outro) = cenario_token();
        let t = tx("NFT_BURN", &outro, &[
            ("collection", JsonValue::str(&cid)),
            ("tokenId", JsonValue::Int(1)),
        ]);
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "só o dono queima");
        assert!(s.nfts[&cid].tokens.contains_key("1"));
    }

    // -------------------------------------------------------- NAME_REGISTER

    #[test]
    fn name_register_grava_e_queima_o_custo() {
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 10_000_000)]);
        let t = tx("NAME_REGISTER", &dono, &[("name", JsonValue::str("eav7"))]);
        aplicar(&mut s, &t, &ativo()).unwrap();

        assert_eq!(s.names["eav7"].owner, dono);
        assert_eq!(s.names["eav7"].target, dono, "sem alvo explícito, resolve para quem registrou");
        assert_eq!(s.balance_of(&dono), 10_000_000 - NAME_REGISTER_COST);
        assert_eq!(s.total_burned, NAME_REGISTER_COST, "o custo SOME do suprimento");
    }

    #[test]
    fn name_register_normaliza_para_minusculas() {
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 10_000_000)]);
        let t = tx("NAME_REGISTER", &dono, &[("name", JsonValue::str("EAV7"))]);
        aplicar(&mut s, &t, &ativo()).unwrap();
        assert!(s.names.contains_key("eav7"), "o nome é normalizado ANTES da validação");
    }

    #[test]
    fn name_register_recusa_nome_ja_tomado() {
        let dono = addr(ALICE);
        let outro = addr(BOB);
        let mut s = estado_com_saldo(&[(&dono, 10_000_000), (&outro, 10_000_000)]);
        aplicar(&mut s, &tx("NAME_REGISTER", &dono, &[("name", JsonValue::str("eav7"))]), &ativo()).unwrap();

        let t = tx("NAME_REGISTER", &outro, &[("name", JsonValue::str("eav7"))]);
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "nome já registrado");
        assert_eq!(s.names["eav7"].owner, dono, "sobrescrever seria sequestro de identidade");
    }

    #[test]
    fn regras_de_formato_do_nome() {
        // As bordas exatas do regex da referência. Errar qualquer uma faria este
        // cliente aceitar ou recusar um registro que a rede trata ao contrário.
        assert!(nome_valido("abc"), "3 caracteres é o mínimo");
        assert!(!nome_valido("ab"), "2 é curto demais");
        assert!(nome_valido(&"a".repeat(32)), "32 é o máximo");
        assert!(!nome_valido(&"a".repeat(33)));
        assert!(nome_valido("a-b"), "hífen no miolo é permitido");
        assert!(nome_valido("a--------b"));
        assert!(!nome_valido("-abc"), "hífen na ponta é proibido");
        assert!(!nome_valido("abc-"));
        assert!(!nome_valido("a_bc"), "sublinhado não está no conjunto");
        assert!(!nome_valido("aBc"), "maiúscula não passa (o nome já chega normalizado)");
        assert!(!nome_valido("açc"), "não-ASCII é recusado sem fatiar UTF-8");
        assert!(nome_valido("1a2"), "dígitos valem inclusive nas pontas");
    }

    #[test]
    fn name_register_recusa_hifen_na_ponta() {
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 10_000_000)]);
        let t = tx("NAME_REGISTER", &dono, &[("name", JsonValue::str("-eav7"))]);
        assert_eq!(
            aplicar(&mut s, &t, &ativo()).unwrap_err().0,
            "nome inválido (3-32, [a-z0-9-], sem hífen nas pontas)"
        );
    }

    #[test]
    fn name_register_sem_saldo_para_o_custo_nao_queima_nada() {
        let pobre = addr("conta-sem-fundos");
        let mut s = estado_com_saldo(&[(&pobre, NAME_REGISTER_COST - 1)]);
        let t = tx("NAME_REGISTER", &pobre, &[("name", JsonValue::str("eav7"))]);
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "saldo insuficiente para registrar");
        assert_eq!(s.total_burned, 0);
        assert!(s.names.is_empty());
    }

    #[test]
    fn name_register_recusa_abaixo_da_altura_do_fork() {
        if NAME_HEIGHT == 0 { return; }
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 10_000_000)]);
        let t = tx("NAME_REGISTER", &dono, &[("name", JsonValue::str("eav7"))]);
        assert_eq!(
            aplicar(&mut s, &t, &ctx(NAME_HEIGHT - 1)).unwrap_err().0,
            "serviço de nomes ainda não ativo"
        );
    }

    // ------------------------------------------- NAME_UPDATE/TRANSFER/RELEASE

    fn cenario_nome() -> (State, String, String) {
        let dono = addr(ALICE);
        let outro = addr(BOB);
        let mut s = estado_com_saldo(&[(&dono, 10_000_000), (&outro, 10_000_000)]);
        aplicar(&mut s, &tx("NAME_REGISTER", &dono, &[("name", JsonValue::str("eav7"))]), &ativo()).unwrap();
        (s, dono, outro)
    }

    #[test]
    fn name_update_reaponta_o_alvo() {
        let (mut s, dono, novo_alvo) = cenario_nome();
        let t = tx("NAME_UPDATE", &dono, &[
            ("name", JsonValue::str("eav7")),
            ("target", JsonValue::str(&novo_alvo)),
        ]);
        aplicar(&mut s, &t, &ativo()).unwrap();
        assert_eq!(s.names["eav7"].target, novo_alvo);
        assert_eq!(s.names["eav7"].owner, dono, "atualizar o alvo NÃO muda o dono");
    }

    #[test]
    fn name_update_recusa_alvo_invalido() {
        let (mut s, dono, _) = cenario_nome();
        let t = tx("NAME_UPDATE", &dono, &[
            ("name", JsonValue::str("eav7")),
            ("target", JsonValue::str("E7NAOEUMENDERECO")),
        ]);
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "endereço-alvo inválido");
        assert_eq!(s.names["eav7"].target, dono);
    }

    #[test]
    fn name_update_so_pelo_dono() {
        let (mut s, dono, intruso) = cenario_nome();
        let t = tx("NAME_UPDATE", &intruso, &[
            ("name", JsonValue::str("eav7")),
            ("target", JsonValue::str(&intruso)),
        ]);
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "só o dono do nome atualiza");
        assert_eq!(s.names["eav7"].target, dono);
    }

    #[test]
    fn name_transfer_troca_o_dono_e_preserva_o_alvo() {
        let (mut s, dono, novo) = cenario_nome();
        let mut t = tx("NAME_TRANSFER", &dono, &[("name", JsonValue::str("eav7"))]);
        t.to = Some(novo.clone());
        aplicar(&mut s, &t, &ativo()).unwrap();
        assert_eq!(s.names["eav7"].owner, novo);
        assert_eq!(s.names["eav7"].target, dono, "o alvo não é reapontado pela transferência");
    }

    #[test]
    fn name_transfer_recusa_novo_dono_invalido() {
        let (mut s, dono, _) = cenario_nome();
        let mut t = tx("NAME_TRANSFER", &dono, &[("name", JsonValue::str("eav7"))]);
        t.to = Some("E7LIXO".into());
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "novo dono inválido");
        assert_eq!(s.names["eav7"].owner, dono);
    }

    #[test]
    fn name_release_devolve_o_nome_ao_pool() {
        let (mut s, dono, outro) = cenario_nome();
        aplicar(&mut s, &tx("NAME_RELEASE", &dono, &[("name", JsonValue::str("eav7"))]), &ativo()).unwrap();
        assert!(s.names.is_empty());

        // E aí qualquer um pode registrar — inclusive pagando o custo de novo.
        let queimado_antes = s.total_burned;
        aplicar(&mut s, &tx("NAME_REGISTER", &outro, &[("name", JsonValue::str("eav7"))]), &ativo()).unwrap();
        assert_eq!(s.names["eav7"].owner, outro);
        assert_eq!(s.total_burned, queimado_antes + NAME_REGISTER_COST, "o custo não é devolvido");
    }

    #[test]
    fn name_release_so_pelo_dono() {
        let (mut s, dono, intruso) = cenario_nome();
        let t = tx("NAME_RELEASE", &intruso, &[("name", JsonValue::str("eav7"))]);
        assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "só o dono do nome libera");
        assert_eq!(s.names["eav7"].owner, dono);
    }

    #[test]
    fn name_inexistente_falha_em_update_transfer_e_release() {
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 10_000_000)]);
        for tipo in ["NAME_UPDATE", "NAME_TRANSFER", "NAME_RELEASE"] {
            let mut t = tx(tipo, &dono, &[("name", JsonValue::str("naoexiste"))]);
            t.to = Some(dono.clone());
            assert_eq!(aplicar(&mut s, &t, &ativo()).unwrap_err().0, "nome inexistente", "tipo {tipo}");
        }
    }

    // ------------------------------------------------ invariante da rejeição

    #[test]
    fn rejeicao_nao_muta_o_estado_em_nenhum_tipo() {
        // A regra que vale para o módulo inteiro: se `aplicar` devolve `Err`, o
        // estado tem de estar EXATAMENTE como estava. Uma taxa cobrada, uma conta
        // materializada ou um contador avançado numa transação rejeitada muda o
        // `stateRoot` — e um nó que faça isso diverge da rede em silêncio.
        let dono = addr(ALICE);
        let intruso = addr(BOB);
        let mut base = estado_com_saldo(&[(&dono, 10_000_000), (&intruso, 10_000_000)]);
        let cid = cria_colecao(&mut base, &dono);
        let mut m = tx("NFT_MINT", &dono, &[("collection", JsonValue::str(&cid))]);
        m.to = Some(dono.clone());
        aplicar(&mut base, &m, &ativo()).unwrap();
        aplicar(&mut base, &tx("NAME_REGISTER", &dono, &[("name", JsonValue::str("eav7"))]), &ativo()).unwrap();

        // Uma rejeição plausível por tipo, com taxa NÃO nula: se algum manipulador
        // debitasse antes de validar, o saldo denunciaria.
        let com_taxa = Ctx { height: NAME_HEIGHT, block_ts: 1, fee: 25_000 };
        let mut casos: Vec<Tx> = vec![
            tx("NFT_CREATE", &dono, &[("name", JsonValue::str("X")), ("symbol", JsonValue::str("x"))]),
            tx("NFT_MINT", &intruso, &[("collection", JsonValue::str(&cid))]),
            tx("NFT_TRANSFER", &intruso, &[("collection", JsonValue::str(&cid)), ("tokenId", JsonValue::Int(1))]),
            tx("NFT_APPROVE", &intruso, &[("collection", JsonValue::str(&cid)), ("tokenId", JsonValue::Int(1))]),
            tx("NFT_BURN", &intruso, &[("collection", JsonValue::str(&cid)), ("tokenId", JsonValue::Int(1))]),
            tx("NAME_REGISTER", &intruso, &[("name", JsonValue::str("eav7"))]),
            tx("NAME_UPDATE", &intruso, &[("name", JsonValue::str("eav7")), ("target", JsonValue::str(&intruso))]),
            tx("NAME_TRANSFER", &intruso, &[("name", JsonValue::str("eav7"))]),
            tx("NAME_RELEASE", &intruso, &[("name", JsonValue::str("eav7"))]),
        ];
        for t in &mut casos {
            t.to = Some(intruso.clone());
        }

        for t in &casos {
            let mut s = base.clone();
            let erro = aplicar(&mut s, t, &com_taxa).expect_err(
                &format!("{} deveria ser rejeitada neste cenário", t.tx_type),
            );
            assert_eq!(s.accounts, base.accounts, "{}: contas mudaram ({erro})", t.tx_type);
            assert_eq!(s.nfts, base.nfts, "{}: coleções mudaram ({erro})", t.tx_type);
            assert_eq!(s.names, base.names, "{}: nomes mudaram ({erro})", t.tx_type);
            assert_eq!(s.total_burned, base.total_burned, "{}: queima mudou ({erro})", t.tx_type);
        }
    }

    #[test]
    fn rejeicao_por_fork_inativo_nao_materializa_conta() {
        // Conta-fantasma de saldo zero é mutação: entra na folha do stateRoot como
        // qualquer outra conta.
        let mut s = State::new();
        let dono = addr(ALICE);
        for tipo in TIPOS {
            let mut t = tx(tipo, &dono, &[("name", JsonValue::str("eav7"))]);
            t.to = Some(dono.clone());
            assert!(aplicar(&mut s, &t, &ctx(0)).is_err(), "{tipo} deveria falhar na altura 0");
        }
        assert!(s.accounts.is_empty(), "nenhuma conta pode ter sido materializada");
    }

    #[test]
    fn a_taxa_sai_do_saldo_de_quem_envia() {
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 10_000_000)]);
        let taxa = Ctx { height: NAME_HEIGHT, block_ts: 1, fee: 20_000 };
        let t = tx("NAME_REGISTER", &dono, &[("name", JsonValue::str("eav7"))]);
        aplicar(&mut s, &t, &taxa).unwrap();
        assert_eq!(s.balance_of(&dono), 10_000_000 - 20_000 - NAME_REGISTER_COST);
        // Só o CUSTO entra em total_burned aqui; a queima da taxa de recurso é do
        // epílogo de `apply_transaction`, como na referência (state.js:2615).
        assert_eq!(s.total_burned, NAME_REGISTER_COST);
    }

    // ------------------------------------------------------ forma canônica

    #[test]
    fn a_colecao_codifica_com_as_chaves_da_referencia() {
        // Renomear qualquer chave aqui muda TODA raiz de estado da rede.
        let Value::Map(m) = Collection::default().to_value() else { panic!("coleção é mapa") };
        let chaves: Vec<&str> = m.keys().map(|s| s.as_str()).collect();
        assert_eq!(chaves, [
            "approvals", "createdAt", "id", "name", "nextId", "owner", "standard", "symbol", "tokens",
        ]);

        let Value::Map(m) = NameRecord::default().to_value() else { panic!("registro é mapa") };
        let chaves: Vec<&str> = m.keys().map(|s| s.as_str()).collect();
        assert_eq!(chaves, ["owner", "registeredAt", "target"]);

        let Value::Map(m) = NftToken::default().to_value() else { panic!("token é mapa") };
        let chaves: Vec<&str> = m.keys().map(|s| s.as_str()).collect();
        assert_eq!(chaves, ["owner", "uri"]);
    }

    #[test]
    fn js_string_reproduz_a_coercao_da_referencia() {
        // Não é curiosidade: é a diferença entre achar e não achar a chave que o nó
        // de referência procura.
        assert_eq!(js_string(None), "undefined");
        assert_eq!(js_string(Some(&JsonValue::Null)), "null");
        assert_eq!(js_string(Some(&JsonValue::Int(7))), "7");
        assert_eq!(js_string(Some(&JsonValue::Bool(true))), "true");
        assert_eq!(js_string(Some(&JsonValue::Map(BTreeMap::new()))), "[object Object]");
        // `String(['ab-cd'])` é `'ab-cd'` — e isso PASSA na validação de nome no nó
        // de referência. Absurdo, mas recusar aqui rejeitaria um bloco válido.
        assert_eq!(js_string(Some(&JsonValue::List(vec![JsonValue::str("ab-cd")]))), "ab-cd");
        assert_eq!(js_string_ou_vazio(None), "");
        assert_eq!(js_string_ou_vazio(Some(&JsonValue::Null)), "");
    }
    /// `null` EXPLÍCITO vale o mesmo que campo ausente — o `??` da referência não
    /// distingue os dois.
    ///
    /// O porte tratava só a ausência e errava em `null`: `{"uri": null}` e
    /// `{"target": null}` eram aceitos pela rede e recusados por este cliente —
    /// uma cisão na direção pior (o nó Rust para). É a mesma classe do base64
    /// estrito: estritez que não protege nada e diverge.
    #[test]
    fn null_explicito_vale_como_campo_ausente() {
        // NFT_MINT com `uri: null` — a referência grava string vazia.
        let dono = addr(ALICE);
        let mut s = estado_com_saldo(&[(&dono, 100_000_000)]);
        let cid = cria_colecao(&mut s, &dono);
        let mut t = tx("NFT_MINT", &dono, &[
            ("collection", JsonValue::str(&cid)),
            ("uri", JsonValue::Null),
        ]);
        t.to = Some(dono.clone()); // o destino do mint vem de `tx.to`
        aplicar(&mut s, &t, &ctx(NFT_HEIGHT)).expect("uri nula tem de ser aceita");
        let col = s.nfts.get(&cid).expect("coleção");
        let (_, token) = col.tokens.iter().next().expect("token mintado");
        assert_eq!(token.uri, "", "uri nula vira string vazia, como o `?? ''`");

        // NAME_REGISTER com `target: null` — resolve para quem registrou.
        let t = tx("NAME_REGISTER", &dono, &[
            ("name", JsonValue::str("meu-nome")),
            ("target", JsonValue::Null),
        ]);
        aplicar(&mut s, &t, &ctx(NAME_HEIGHT)).expect("target nulo tem de ser aceito");
        assert_eq!(
            s.names.get("meu-nome").expect("nome registrado").target,
            dono,
            "target nulo resolve para o remetente, como o `?? tx.from`"
        );
    }

    // ------------------------------------------------- ida e volta canônica

    /// Todos os campos preenchidos e distintos: dois campos com o mesmo valor
    /// esconderiam uma troca de nomes no decodificador.
    #[test]
    fn colecao_e_item_sobrevivem_a_ida_e_volta() {
        let mut c = Collection {
            standard: "EAV721".into(),
            id: "col-1".into(),
            name: "Coleção".into(),
            symbol: "COL".into(),
            owner: "E7DONO".into(),
            created_at: 1_700,
            next_id: 9,
            tokens: BTreeMap::new(),
            approvals: BTreeMap::new(),
        };
        let item = NftToken { owner: "E7ITEM".into(), uri: "ipfs://a".into() };
        c.tokens.insert("1".into(), item.clone());
        c.approvals.insert("1".into(), "E7APROVADO".into());

        assert_eq!(NftToken::from_value(&item.to_value()), Some(item));
        assert_eq!(Collection::from_value(&c.to_value()), Some(c));
    }

    #[test]
    fn registro_de_nome_sobrevive_a_ida_e_volta() {
        let r = NameRecord {
            owner: "E7DONO".into(),
            target: "E7ALVO".into(),
            registered_at: 4_242,
        };
        assert_eq!(NameRecord::from_value(&r.to_value()), Some(r));
    }

    #[test]
    fn forma_invalida_de_colecao_e_recusada_sem_panico() {
        assert_eq!(Collection::from_value(&Value::List(vec![])), None);
        assert_eq!(NftToken::from_value(&Value::Null), None);
        let Value::Map(mut m) = NameRecord::default().to_value() else { panic!("mapa") };
        m.insert("registeredAt".into(), Value::str("7"));
        assert_eq!(NameRecord::from_value(&Value::Map(m)), None, "texto onde a folha tem inteiro");
    }
}
