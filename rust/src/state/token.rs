//! Token nativo EAV20.
//!
//! Equivalente ao TRC20 da Tron, nativo do protocolo eav20: tokens vivem no
//! ESTADO da cadeia, sem máquina virtual. Criar e mover é transação assinada, não
//! chamada de contrato — o que remove a classe inteira de bugs de reentrância, mas
//! move a responsabilidade para cá: cada regra que um ERC20 escreveria em Solidity
//! está escrita neste arquivo, e um esquecimento é divergência de consenso.
//!
//! Referência: `src/core/state.js` (ramos `TOKEN_*`) e `src/token/eav20.js`.
//!
//! Invariante que vale para TODO manipulador deste módulo: se retornar `Err`, o
//! estado tem de estar exatamente como estava. Valide tudo ANTES de mutar.

use super::{Amount, Ctx, State, StateError};
use crate::canonical::Value;
use crate::address::is_valid_address;
use crate::hash::eav_hash_one;
use crate::transaction::{JsonValue, Tx};
use std::collections::BTreeMap;

// ---------------------------------------------------------------- constantes
//
// Valores copiados de `src/config.js` (objeto `CHAIN`). Ficam declarados aqui
// enquanto o módulo de configuração do cliente Rust não existe; quando existir,
// migram para lá SEM mudar de valor — uma altura de fork diferente da da rede faz
// este cliente aceitar o que os outros rejeitam, que é cisão de cadeia.

/// `CHAIN.TOKEN_ADMIN_HEIGHT` (src/config.js:365). Abaixo desta altura as funções
/// administrativas do token (mint, burn, pause, blacklist, freeze) NÃO existiam.
/// Aceitá-las antes do fork reescreveria o histórico já validado pela rede.
const TOKEN_ADMIN_HEIGHT: u64 = crate::config::TOKEN_ADMIN_HEIGHT;

/// `CHAIN.PERMISSIONS_V2_HEIGHT` (src/config.js:107). Marca, entre outras coisas,
/// a entrada em vigor da unicidade de SÍMBOLO em `TOKEN_CREATE`.
const PERMISSIONS_V2_HEIGHT: u64 = crate::config::PERMISSIONS_V2_HEIGHT;

/// Limite de dígitos de um valor monetário — regra de `isAmountString`
/// (src/config.js:563). Existe para que ninguém envie um decimal de milhares de
/// dígitos só para consumir CPU na conversão.
const MAX_AMOUNT_DIGITS: usize = 30;

type R<T> = Result<T, StateError>;

fn erro(msg: impl Into<String>) -> StateError {
    StateError(msg.into())
}

/// Mapa `endereço → valor monetário` com a tag de INTEIRO (0x03) — a forma de
/// `balances` e de cada linha de `allowances`.
fn mapa_de_amount(v: &Value) -> Option<BTreeMap<String, Amount>> {
    v.mapa()?.iter().map(|(k, x)| Some((k.clone(), x.inteiro()?))).collect()
}

/// Token EAV20. Os nomes de campo entram na folha do `stateRoot` — não renomeie.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Token {
    pub standard: String,
    pub id: String,
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub total_supply: Amount,
    pub creator: String,
    pub owner: String,
    pub mintable: bool,
    pub paused: bool,
    pub created_at: u64,
    pub balances: BTreeMap<String, Amount>,
    pub allowances: BTreeMap<String, BTreeMap<String, Amount>>,
    pub blacklist: BTreeMap<String, bool>,
    pub frozen: BTreeMap<String, (Amount, u64)>,
}

impl Token {
    /// Forma canônica para a folha do `stateRoot`.
    ///
    /// Duas armadilhas aqui, ambas capazes de mudar a raiz da rede em silêncio:
    ///
    /// 1. **`frozen.amount` é TEXTO, não inteiro.** A referência grava
    ///    `{ amount: amount.toString(), unlockAt }` (`state.js:1772`) enquanto
    ///    `balances` guarda BigInt. Na codificação canônica isso são tags
    ///    diferentes — 0x04 contra 0x03 — e emitir `Value::uint` aqui daria outra
    ///    folha. A struct usa `Amount` nos dois, então a distinção vive só neste
    ///    método e precisa ficar.
    /// 2. **As chaves usam a grafia da referência** (camelCase). Renomear qualquer
    ///    uma muda a folha de todo token da rede.
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("standard".into(), Value::str(self.standard.clone()));
        m.insert("id".into(), Value::str(self.id.clone()));
        m.insert("name".into(), Value::str(self.name.clone()));
        m.insert("symbol".into(), Value::str(self.symbol.clone()));
        m.insert("decimals".into(), Value::uint(self.decimals));
        m.insert("totalSupply".into(), Value::uint(self.total_supply));
        m.insert("creator".into(), Value::str(self.creator.clone()));
        m.insert("owner".into(), Value::str(self.owner.clone()));
        m.insert("mintable".into(), Value::Bool(self.mintable));
        m.insert("paused".into(), Value::Bool(self.paused));
        m.insert("createdAt".into(), Value::uint(self.created_at));
        m.insert("balances".into(), Value::Map(
            self.balances.iter().map(|(k, v)| (k.clone(), Value::uint(*v))).collect(),
        ));
        m.insert("allowances".into(), Value::Map(
            self.allowances.iter().map(|(dono, spenders)| (dono.clone(), Value::Map(
                spenders.iter().map(|(s, v)| (s.clone(), Value::uint(*v))).collect(),
            ))).collect(),
        ));
        m.insert("blacklist".into(), Value::Map(
            self.blacklist.iter().map(|(k, v)| (k.clone(), Value::Bool(*v))).collect(),
        ));
        m.insert("frozen".into(), Value::Map(
            self.frozen.iter().map(|(addr, (valor, unlock))| {
                let mut f = BTreeMap::new();
                // TEXTO — ver a armadilha 1 no doc deste método.
                f.insert("amount".to_string(), Value::str(valor.to_string()));
                f.insert("unlockAt".to_string(), Value::uint(*unlock));
                (addr.clone(), Value::Map(f))
            }).collect(),
        ));
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// As duas armadilhas do doc acima aparecem aqui invertidas: `balances` volta
    /// por `inteiro` (tag 0x03) e `frozen.amount` por `decimal_em_texto` (tag
    /// 0x04). Ler os dois pelo mesmo caminho devolveria `None` num deles e
    /// derrubaria o snapshot inteiro — falha barulhenta, ao contrário do que
    /// acontece na escrita.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 15 {
            return None;
        }
        Some(Token {
            standard: m.get("standard")?.texto()?.to_string(),
            id: m.get("id")?.texto()?.to_string(),
            name: m.get("name")?.texto()?.to_string(),
            symbol: m.get("symbol")?.texto()?.to_string(),
            decimals: m.get("decimals")?.inteiro()?,
            total_supply: m.get("totalSupply")?.inteiro()?,
            creator: m.get("creator")?.texto()?.to_string(),
            owner: m.get("owner")?.texto()?.to_string(),
            mintable: m.get("mintable")?.booleano()?,
            paused: m.get("paused")?.booleano()?,
            created_at: m.get("createdAt")?.inteiro()?,
            balances: mapa_de_amount(m.get("balances")?)?,
            allowances: m
                .get("allowances")?
                .mapa()?
                .iter()
                .map(|(dono, gastadores)| Some((dono.clone(), mapa_de_amount(gastadores)?)))
                .collect::<Option<_>>()?,
            blacklist: m
                .get("blacklist")?
                .mapa()?
                .iter()
                .map(|(k, x)| Some((k.clone(), x.booleano()?)))
                .collect::<Option<_>>()?,
            frozen: m
                .get("frozen")?
                .mapa()?
                .iter()
                .map(|(addr, f)| {
                    let f = f.mapa()?;
                    if f.len() != 2 {
                        return None;
                    }
                    let valor = f.get("amount")?.decimal_em_texto()?;
                    let unlock = f.get("unlockAt")?.inteiro()?;
                    Some((addr.clone(), (valor, unlock)))
                })
                .collect::<Option<_>>()?,
        })
    }

    /// Saldo bruto do endereço, incluindo a parte congelada.
    fn saldo(&self, addr: &str) -> Amount {
        self.balances.get(addr).copied().unwrap_or(0)
    }

    /// Saldo TRANSFERÍVEL: o bruto menos o congelado ainda não vencido.
    ///
    /// Espelha `#tokenAvailable` (src/core/state.js:584). Um detalhe merece nota:
    /// lá a conta é em `BigInt` e pode dar NEGATIVO se o congelado passar do saldo;
    /// aqui `Amount` é sem sinal e a subtração satura em zero. Os dois se comportam
    /// igual no único uso que existe — a comparação `disponível < valor`, com
    /// `valor > 0` já garantido — porque tanto um negativo quanto zero perdem para
    /// qualquer valor positivo. Saturar é o que impede o pânico que um `-` cru daria.
    fn disponivel(&self, addr: &str, height: u64) -> Amount {
        let bal = self.saldo(addr);
        match self.frozen.get(addr) {
            Some(&(congelado, unlock_at)) if height < unlock_at => bal.saturating_sub(congelado),
            _ => bal,
        }
    }

    /// Allowance concedida por `owner` a `spender`.
    fn allowance(&self, owner: &str, spender: &str) -> Amount {
        self.allowances.get(owner).and_then(|m| m.get(spender)).copied().unwrap_or(0)
    }

    /// Guarda que vale para TODA movimentação do token: pausa e lista de bloqueio.
    ///
    /// Espelha `#tokenGuard` (src/core/state.js:577). Chamar isto é o que dá sentido
    /// ao `TOKEN_PAUSE`: um único ramo que esqueça a guarda transforma a pausa em
    /// decoração, e o dono do token perde a única alavanca que tem contra um roubo
    /// em andamento. Endereço ausente (`None`) é ignorado, como no `if (a && …)`.
    fn guarda(&self, enderecos: &[Option<&str>]) -> R<()> {
        if self.paused {
            return Err(erro("token pausado"));
        }
        for addr in enderecos.iter().flatten() {
            if self.blacklist.get(*addr).copied().unwrap_or(false) {
                return Err(erro(format!("endereço bloqueado neste token: {addr}")));
            }
        }
        Ok(())
    }
}

/// Tipos de transação que este módulo atende. O despacho em `mod.rs` usa esta
/// lista, então um tipo esquecido aqui vira erro de "tipo desconhecido" em vez de
/// falha silenciosa.
pub const TIPOS: &[&str] = &[
    "TOKEN_CREATE",
    "TOKEN_TRANSFER",
    "TOKEN_APPROVE",
    "TOKEN_TRANSFER_FROM",
    "TOKEN_MINT",
    "TOKEN_BURN",
    "TOKEN_PAUSE",
    "TOKEN_UNPAUSE",
    "TOKEN_BLACKLIST",
    "TOKEN_FREEZE",
    "TOKEN_UNFREEZE",
];

// ------------------------------------------------------------------ leitura de `data`
//
// `tx.data` é ENTRADA NÃO CONFIÁVEL: pode faltar, vir com o tipo errado ou nem ser
// um mapa. Todo acesso passa por estes ajudantes, que devolvem `Option` — nunca
// `unwrap`. A referência sobrevive a isso porque no JS `undefined` se propaga; aqui
// a propagação é explícita, e é essa explicitação que impede o pânico.

fn dados(tx: &Tx) -> Option<&BTreeMap<String, JsonValue>> {
    match tx.data.as_ref() {
        Some(JsonValue::Map(m)) => Some(m),
        _ => None,
    }
}

fn campo<'a>(tx: &'a Tx, chave: &str) -> Option<&'a JsonValue> {
    dados(tx)?.get(chave)
}

fn campo_texto<'a>(tx: &'a Tx, chave: &str) -> Option<&'a str> {
    match campo(tx, chave)? {
        JsonValue::Str(s) => Some(s.as_str()),
        _ => None,
    }
}

/// Converte um decimal sem sinal (a forma em que o protocolo carrega dinheiro) para
/// `Amount`, rejeitando forma não canônica e comprimento abusivo.
///
/// É a mesma regra de `isAmountString` (src/config.js:563). O ponto importante é
/// que a conversão FALHA em vez de saturar: um valor que não coubesse em `u128` e
/// virasse `u128::MAX` em silêncio criaria saldo do nada.
fn parse_amount(s: &str) -> R<Amount> {
    if s.is_empty() || s.len() > MAX_AMOUNT_DIGITS || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(erro(format!("valor inválido: {s}")));
    }
    if s != "0" && s.starts_with('0') {
        return Err(erro(format!("valor inválido: {s}"))); // zero à esquerda não é forma canônica
    }
    s.parse::<Amount>().map_err(|_| erro(format!("valor inválido: {s}")))
}

/// O `amount` da transação, já convertido.
fn valor(tx: &Tx) -> R<Amount> {
    parse_amount(&tx.amount)
}

/// O destino da transação. Os tipos deste módulo que chamam isto têm `to`
/// obrigatório na validação stateless; a checagem aqui existe porque a máquina de
/// estado não pode DEPENDER de ter sido chamada depois dela — se puder entrar `None`,
/// tem de sair `Err`, nunca pânico.
fn destino(tx: &Tx) -> R<&str> {
    match tx.to.as_deref() {
        Some(to) if is_valid_address(to) => Ok(to),
        _ => Err(erro("destino inválido")),
    }
}

/// Comprimento em unidades de código UTF-16 — que é o que `String.length` mede no
/// JavaScript.
///
/// Não é preciosismo: um nome com emoji conta 2 aqui e 1 em `chars().count()`. Usar
/// a contagem errada faz este cliente aceitar um nome que a rede recusa (ou o
/// contrário) exatamente na fronteira dos 64, e a divergência só aparece quando
/// alguém cria um token com nome longo e acentuado.
fn len_utf16(s: &str) -> usize {
    // A regra vive em `coercao::js_len` — é o `.length` do JS, compartilhado com a
    // ponte e o NFT. Uma cópia por módulo é como a ponte acabou medindo em bytes.
    crate::state::coercao::js_len(s)
}

/// Parâmetros validados de `TOKEN_CREATE`.
struct ParamsToken {
    name: String,
    symbol: String,
    decimals: u8,
    total_supply: Amount,
}

/// Espelha `validateTokenParams` (src/token/eav20.js:12). Devolve a PRIMEIRA falha
/// na mesma ordem da referência: a mensagem de erro entra nos vetores de
/// conformidade, então a ordem das checagens é observável.
fn validar_params_token(tx: &Tx) -> R<ParamsToken> {
    if dados(tx).is_none() {
        return Err(erro("parâmetros do token ausentes"));
    }

    let name = campo_texto(tx, "name").unwrap_or_default();
    // `js_trim`, não `str::trim`: o valor APARADO é o que vai para a folha `tok`,
    // e os conjuntos de espaço em branco diferem (o JS apara BOM, o Rust apara
    // NEL). Um nome com BOM produzia folhas diferentes nos dois clientes.
    if len_utf16(crate::state::coercao::js_trim(name)) < 1 || len_utf16(name) > 64 {
        return Err(erro("nome do token deve ter entre 1 e 64 caracteres"));
    }

    let symbol = campo_texto(tx, "symbol").unwrap_or_default();
    let simbolo_ok = (2..=10).contains(&symbol.len())
        && symbol.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
    if !simbolo_ok {
        return Err(erro("símbolo do token deve ter 2 a 10 caracteres [A-Z0-9]"));
    }

    // `decimals` é `number` no JS e passa por `Number.isSafeInteger`. Aqui só o
    // inteiro serve, e a faixa 0..=18 é o que cabe num `u8` do estado.
    let decimals = match campo(tx, "decimals") {
        Some(JsonValue::Int(d)) if (0..=18).contains(d) => *d as u8,
        _ => return Err(erro("decimais do token devem ser um inteiro entre 0 e 18")),
    };

    // O suprimento é STRING decimal por protocolo — nunca número JSON, que perderia
    // precisão acima de 2⁵³ no lado da referência.
    let total_supply = match campo_texto(tx, "totalSupply") {
        Some(s) => match parse_amount(s) {
            Ok(v) if v > 0 => v,
            _ => return Err(erro("suprimento total deve ser uma string decimal positiva")),
        },
        None => return Err(erro("suprimento total deve ser uma string decimal positiva")),
    };

    Ok(ParamsToken {
        name: crate::state::coercao::js_trim(name).to_string(),
        symbol: symbol.to_string(),
        decimals,
        total_supply,
    })
}

// ------------------------------------------------------------------ despacho

pub fn aplicar(state: &mut State, tx: &Tx, ctx: &Ctx) -> Result<(), StateError> {
    match tx.tx_type.as_str() {
        "TOKEN_CREATE" => criar(state, tx, ctx),
        "TOKEN_TRANSFER" => transferir(state, tx, ctx),
        "TOKEN_APPROVE" => aprovar(state, tx, ctx),
        "TOKEN_TRANSFER_FROM" => transferir_de(state, tx, ctx),
        "TOKEN_MINT" => emitir(state, tx, ctx),
        "TOKEN_BURN" => queimar(state, tx, ctx),
        "TOKEN_PAUSE" | "TOKEN_UNPAUSE" => pausar(state, tx, ctx),
        "TOKEN_BLACKLIST" => bloquear(state, tx, ctx),
        "TOKEN_FREEZE" => congelar(state, tx, ctx),
        "TOKEN_UNFREEZE" => descongelar(state, tx, ctx),
        outro => Err(erro(format!("tipo de token não tratado: {outro}"))),
    }
}

/// Localiza o token de `data.token`, com a mensagem exata da referência.
fn buscar<'a>(state: &'a State, tx: &Tx) -> R<&'a Token> {
    let id = campo_texto(tx, "token").ok_or_else(|| erro("token EAV20 inexistente"))?;
    state.tokens.get(id).ok_or_else(|| erro("token EAV20 inexistente"))
}

/// Id do token de `data.token`, já confirmado como existente.
fn id_do_token(state: &State, tx: &Tx) -> R<String> {
    Ok(buscar(state, tx)?.id.clone())
}

/// Gate das funções administrativas. Um ramo que esqueça isto aceita, abaixo do
/// fork, o que a rede inteira rejeita — e o nó fica preso num estado que não
/// consegue mais reconciliar.
fn exigir_admin_ativo(ctx: &Ctx) -> R<()> {
    if ctx.height < TOKEN_ADMIN_HEIGHT {
        return Err(erro("admin de token ainda não ativo"));
    }
    Ok(())
}

/// Confere o saldo nativo para a taxa SEM mutar. Separado do débito de propósito:
/// é a última validação antes da fronteira, e nenhum ramo pode debitar sem tê-la
/// chamado.
fn conferir_taxa(state: &State, tx: &Tx, ctx: &Ctx, msg: &str) -> R<()> {
    if state.balance_of(&tx.from) < ctx.fee {
        return Err(erro(msg));
    }
    Ok(())
}

// ------------------------------------------------------------------ criação

fn criar(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let params = validar_params_token(tx)?;

    // Unicidade de SÍMBOLO. Sem isto qualquer um emite um segundo "USDT" e
    // personifica o primeiro em carteira e explorer — o usuário vê o símbolo, não o
    // id de 64 hexadecimais. A TRON usa o nome do ativo como identificador único
    // exatamente por esse motivo. Gated porque a cadeia abaixo do fork já pode
    // conter símbolos repetidos: aplicar retroativamente invalidaria blocos válidos.
    if ctx.height >= PERMISSIONS_V2_HEIGHT
        && state.tokens.values().any(|t| t.symbol == params.symbol)
    {
        return Err(erro(format!("símbolo de token já existe: {}", params.symbol)));
    }

    let tx_id = tx.id.as_deref().ok_or_else(|| erro("transação sem id"))?;
    let token_id = eav_hash_one(format!("EAV20-TOKEN:{tx_id}"));

    // Colisão de id significaria sobrescrever um token existente — e com ele todos
    // os saldos dos seus detentores. A referência não checa porque o id vem de uma
    // hash sobre o id da tx, que já é único; a checagem aqui custa nada e transforma
    // um desastre silencioso em rejeição.
    if state.tokens.contains_key(&token_id) {
        return Err(erro("token EAV20 já existe"));
    }

    let created_at = u64::try_from(tx.timestamp)
        .map_err(|_| erro("timestamp inválido"))?;

    conferir_taxa(state, tx, ctx, "saldo insuficiente para a taxa de criação")?;

    // ---- fronteira: daqui para baixo só mutação, nenhuma validação ----
    state.debitar(&tx.from, ctx.fee)?;

    let mut balances = BTreeMap::new();
    balances.insert(tx.from.clone(), params.total_supply);

    state.tokens.insert(token_id.clone(), Token {
        standard: "eav20".to_string(),
        id: token_id,
        name: params.name,
        symbol: params.symbol,
        decimals: params.decimals,
        total_supply: params.total_supply,
        creator: tx.from.clone(),
        // O criador nasce owner: é quem pode mint (se mintable), pausar e bloquear.
        owner: tx.from.clone(),
        mintable: matches!(campo(tx, "mintable"), Some(JsonValue::Bool(true))),
        paused: false,
        created_at,
        balances,
        allowances: BTreeMap::new(),
        blacklist: BTreeMap::new(),
        frozen: BTreeMap::new(),
    });
    Ok(())
}

// ------------------------------------------------------------------ movimentação

fn transferir(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let to = destino(tx)?;
    let amount = valor(tx)?;

    let id = {
        let token = buscar(state, tx)?;
        token.guarda(&[Some(tx.from.as_str()), Some(to)])?;
        if amount == 0 {
            return Err(erro("valor do token deve ser positivo"));
        }
        // A conferência é sobre o DISPONÍVEL, não sobre o saldo bruto: parte
        // congelada não é do remetente para gastar, mesmo sendo dele.
        if token.disponivel(&tx.from, ctx.height) < amount {
            return Err(erro("saldo do token insuficiente ou congelado"));
        }
        token.id.clone()
    };

    conferir_taxa(state, tx, ctx, "saldo insuficiente para a taxa")?;

    // ---- fronteira ----
    state.debitar(&tx.from, ctx.fee)?;
    mover(state, &id, &tx.from, to, amount)
}

/// Efeito de `TOKEN_TRANSFER` patrocinado por META_TX (`#applyMetaEffect`,
/// state.js:601-608).
///
/// Vive AQUI, e não em `gov.rs`, porque as guardas são do domínio de token
/// (pausa, blacklist, congelamento) e uma segunda cópia delas na governança seria
/// uma segunda versão da regra — o pior desfecho para consenso. O `gov.rs`
/// recusava `TOKEN_TRANSFER` alegando que "o token ainda não foi portado"; está
/// portado, e a recusa era código desligado por um motivo que deixou de existir.
///
/// NÃO cobra taxa nem mexe em nonce: quem patrocina já pagou, e o nonce da inner
/// é avançado pelo chamador.
pub(crate) fn efeito_meta_transfer(
    state: &mut State,
    token_id: &str,
    de: &str,
    para: &str,
    amount: Amount,
    height: u64,
) -> R<()> {
    let token = state.tokens.get(token_id).ok_or_else(|| erro("token inexistente"))?;
    // As MESMAS guardas do TOKEN_TRANSFER direto (state.js:604).
    token.guarda(&[Some(de), Some(para)])?;
    if amount == 0 {
        return Err(erro("valor do token deve ser positivo"));
    }
    if token.disponivel(de, height) < amount {
        return Err(erro("saldo do token insuficiente ou congelado"));
    }
    mover(state, token_id, de, para, amount)
}

/// Move saldo de token entre dois endereços já validados.
///
/// A ordem — debitar a origem, DEPOIS ler o destino — é a da referência e importa
/// no caso de auto-transferência: relendo o destino após a escrita, `from == to`
/// resulta em saldo inalterado. Ler os dois antes creditaria o valor duas vezes
/// menos uma, ou seja, criaria moeda do nada num caso que qualquer um pode acionar.
fn mover(state: &mut State, id: &str, from: &str, to: &str, amount: Amount) -> R<()> {
    let token = state.tokens.get_mut(id).ok_or_else(|| erro("token EAV20 inexistente"))?;

    let saldo_origem = token.saldo(from);
    let novo_origem = saldo_origem
        .checked_sub(amount)
        .ok_or_else(|| erro("saldo do token insuficiente ou congelado"))?;
    token.balances.insert(from.to_string(), novo_origem);

    let saldo_destino = token.saldo(to);
    let novo_destino = saldo_destino
        .checked_add(amount)
        .ok_or_else(|| erro("estouro aritmético no saldo do token"))?;
    token.balances.insert(to.to_string(), novo_destino);
    Ok(())
}

fn aprovar(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let spender = destino(tx)?.to_string();
    let amount = valor(tx)?;
    let id = id_do_token(state, tx)?;

    conferir_taxa(state, tx, ctx, "saldo insuficiente para a taxa")?;

    // ---- fronteira ----
    state.debitar(&tx.from, ctx.fee)?;
    let token = state.tokens.get_mut(&id).ok_or_else(|| erro("token EAV20 inexistente"))?;
    // Sobrescreve, não soma: é a semântica de `approve` do padrão, e a referência
    // faz o mesmo (`(allowances[from] ??= {})[to] = amount`). Aprovar zero revoga.
    token.allowances.entry(tx.from.clone()).or_default().insert(spender, amount);
    Ok(())
}

fn transferir_de(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    let to = destino(tx)?;
    let amount = valor(tx)?;
    let owner = campo_texto(tx, "owner").unwrap_or_default();
    // O dono é lido de `data`, então é entrada não confiável: sem esta checagem uma
    // allowance poderia ser criada sob uma chave que não corresponde a conta alguma.
    if !is_valid_address(owner) {
        return Err(erro("endereço do dono inválido"));
    }
    let owner = owner.to_string();

    let (id, allowance) = {
        let token = buscar(state, tx)?;
        // Três endereços na guarda: dono, destino e o GASTADOR. Bloquear só as duas
        // pontas deixaria um endereço na lista negra continuar movendo o token dos
        // outros via allowance previamente concedida.
        token.guarda(&[Some(owner.as_str()), Some(to), Some(tx.from.as_str())])?;
        if amount == 0 {
            return Err(erro("valor do token deve ser positivo"));
        }
        let allowance = token.allowance(&owner, &tx.from);
        if allowance < amount {
            return Err(erro("allowance insuficiente"));
        }
        if token.disponivel(&owner, ctx.height) < amount {
            return Err(erro("saldo do token insuficiente ou congelado"));
        }
        (token.id.clone(), allowance)
    };

    conferir_taxa(state, tx, ctx, "saldo insuficiente para a taxa")?;

    // ---- fronteira ----
    state.debitar(&tx.from, ctx.fee)?;
    {
        let token = state.tokens.get_mut(&id).ok_or_else(|| erro("token EAV20 inexistente"))?;
        // A allowance SEMPRE decrementa. A referência não tem o caso de "allowance
        // infinita" que alguns ERC20 usam como otimização, e inventá-lo aqui daria a
        // um gastador aprovado poder ilimitado que a rede não lhe concedeu.
        let nova = allowance
            .checked_sub(amount)
            .ok_or_else(|| erro("allowance insuficiente"))?;
        token.allowances.entry(owner.clone()).or_default().insert(tx.from.clone(), nova);
    }
    mover(state, &id, &owner, to, amount)
}

// ------------------------------------------------------------------ administração

fn emitir(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    exigir_admin_ativo(ctx)?;
    let amount = valor(tx)?;

    let id = {
        let token = buscar(state, tx)?;
        if token.owner != tx.from {
            return Err(erro("só o owner do token pode mint"));
        }
        // `mintable` é fixado na criação e nunca muda: é a promessa de suprimento
        // que o detentor leu antes de comprar. Sem esta checagem, "supply fixo" seria
        // uma etiqueta sem efeito.
        if !token.mintable {
            return Err(erro("token não é mintable (supply fixo)"));
        }
        token.id.clone()
    };
    let to = destino(tx)?.to_string();
    if amount == 0 {
        return Err(erro("valor do mint deve ser positivo"));
    }

    // Estouro do suprimento é apurado ANTES de qualquer escrita — descobri-lo no meio
    // da mutação deixaria o saldo creditado e o suprimento não.
    let (novo_supply, novo_saldo) = {
        let token = state.tokens.get(&id).ok_or_else(|| erro("token EAV20 inexistente"))?;
        let s = token
            .total_supply
            .checked_add(amount)
            .ok_or_else(|| erro("estouro aritmético no suprimento do token"))?;
        let b = token
            .saldo(&to)
            .checked_add(amount)
            .ok_or_else(|| erro("estouro aritmético no saldo do token"))?;
        (s, b)
    };

    conferir_taxa(state, tx, ctx, "saldo insuficiente para a taxa")?;

    // ---- fronteira ----
    state.debitar(&tx.from, ctx.fee)?;
    let token = state.tokens.get_mut(&id).ok_or_else(|| erro("token EAV20 inexistente"))?;
    token.total_supply = novo_supply;
    token.balances.insert(to, novo_saldo);
    Ok(())
}

fn queimar(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    exigir_admin_ativo(ctx)?;
    let amount = valor(tx)?;

    // Note que a referência NÃO aplica `#tokenGuard` aqui, e não é descuido a
    // reproduzir por acidente: queimar o PRÓPRIO saldo não move valor para ninguém,
    // então nem pausa nem lista de bloqueio têm o que proteger. Acrescentar a guarda
    // divergiria da rede num caso perfeitamente acionável (queimar com token pausado).
    let (id, novo_saldo, novo_supply) = {
        let token = buscar(state, tx)?;
        if amount == 0 {
            return Err(erro("valor do burn deve ser positivo"));
        }
        let saldo = token.saldo(&tx.from);
        // Comparação contra o saldo BRUTO, como na referência: o congelado é queimável
        // pelo próprio dono. É deliberado lá — congelar limita transferência, não
        // destruição.
        if saldo < amount {
            return Err(erro("saldo do token insuficiente para queimar"));
        }
        let novo_saldo = saldo
            .checked_sub(amount)
            .ok_or_else(|| erro("saldo do token insuficiente para queimar"))?;
        let novo_supply = token
            .total_supply
            .checked_sub(amount)
            .ok_or_else(|| erro("suprimento do token insuficiente para queimar"))?;
        (token.id.clone(), novo_saldo, novo_supply)
    };

    conferir_taxa(state, tx, ctx, "saldo insuficiente para a taxa")?;

    // ---- fronteira ----
    state.debitar(&tx.from, ctx.fee)?;
    let token = state.tokens.get_mut(&id).ok_or_else(|| erro("token EAV20 inexistente"))?;
    token.balances.insert(tx.from.clone(), novo_saldo);
    token.total_supply = novo_supply;
    Ok(())
}

fn pausar(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    exigir_admin_ativo(ctx)?;

    let id = {
        let token = buscar(state, tx)?;
        if token.owner != tx.from {
            return Err(erro("só o owner do token pode pausar"));
        }
        token.id.clone()
    };

    conferir_taxa(state, tx, ctx, "saldo insuficiente para a taxa")?;

    // ---- fronteira ----
    state.debitar(&tx.from, ctx.fee)?;
    let token = state.tokens.get_mut(&id).ok_or_else(|| erro("token EAV20 inexistente"))?;
    // Os dois tipos compartilham o ramo; o que decide é o tipo. Note que pausar já
    // pausado (ou despausar já ativo) é aceito — a referência atribui sem comparar,
    // e recusar aqui rejeitaria uma transação que a rede aceita.
    token.paused = tx.tx_type == "TOKEN_PAUSE";
    Ok(())
}

fn bloquear(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    exigir_admin_ativo(ctx)?;

    let id = {
        let token = buscar(state, tx)?;
        if token.owner != tx.from {
            return Err(erro("só o owner do token pode bloquear"));
        }
        token.id.clone()
    };
    let alvo = campo_texto(tx, "address").unwrap_or_default();
    if !is_valid_address(alvo) {
        return Err(erro("endereço inválido"));
    }
    let alvo = alvo.to_string();
    // Só `blocked === false` DESBLOQUEIA. Qualquer outro valor — ausente, nulo, texto
    // — bloqueia. Inverter o padrão (bloquear só com `true`) faria uma transação com
    // o campo omitido remover um bloqueio em vez de aplicá-lo.
    let desbloquear = matches!(campo(tx, "blocked"), Some(JsonValue::Bool(false)));

    conferir_taxa(state, tx, ctx, "saldo insuficiente para a taxa")?;

    // ---- fronteira ----
    state.debitar(&tx.from, ctx.fee)?;
    let token = state.tokens.get_mut(&id).ok_or_else(|| erro("token EAV20 inexistente"))?;
    if desbloquear {
        token.blacklist.remove(&alvo);
    } else {
        token.blacklist.insert(alvo, true);
    }
    Ok(())
}

/// Duração em blocos — o par `Number(v)` + `Number.isSafeInteger(n)` da
/// referência (`state.js:1781`).
///
/// DELEGA a `coercao::js_number_seguro_de`. Antes casava só `Int` e `Str` com
/// `parse`, sob um comentário que dizia ser fiel ao `Number()` porque
/// `Number("100")` é 100. O caso trivial estava certo e os outros não:
/// `Number("0x10")` é 16, `Number("1e2")` é 100, `Number(true)` é 1 — a rede
/// congela o saldo e este cliente recusava a mesma transação.
///
/// O teto de 2⁵³ vem do próprio `js_number_seguro_de`: acima dele o nó de
/// referência não representa a altura de destravamento sem perder dígito.
fn duracao_em_blocos(tx: &Tx) -> R<u64> {
    let bruto = campo(tx, "durationBlocks")
        .and_then(crate::state::coercao::js_number_seguro_de)
        .ok_or_else(|| erro("duração inválida"))?;
    if bruto <= 0 {
        return Err(erro("duração inválida"));
    }
    Ok(bruto as u64)
}

fn congelar(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    exigir_admin_ativo(ctx)?;
    let amount = valor(tx)?;

    // A ordem é a da referência: token, duração, valor, congelamento vigente, saldo.
    // A mensagem de erro é observável nos vetores, então trocar a ordem troca o erro.
    let dur = {
        let token = buscar(state, tx)?;
        let dur = duracao_em_blocos(tx)?;
        if amount == 0 {
            return Err(erro("valor a congelar deve ser positivo"));
        }
        // Um congelamento ainda vigente não pode ser substituído: senão o detentor
        // reduziria o valor congelado (ou encurtaria o prazo) reemitindo a transação,
        // e o congelamento não travaria nada.
        if let Some(&(_, unlock_at)) = token.frozen.get(&tx.from)
            && ctx.height < unlock_at
        {
            return Err(erro("já há um congelamento ativo nesta conta"));
        }
        // Saldo BRUTO, como na referência — e é coerente, já que um congelamento
        // vigente foi descartado acima.
        if token.saldo(&tx.from) < amount {
            return Err(erro("saldo do token insuficiente para congelar"));
        }
        dur
    };
    let id = id_do_token(state, tx)?;
    let unlock_at = ctx
        .height
        .checked_add(dur)
        .ok_or_else(|| erro("duração inválida"))?;

    conferir_taxa(state, tx, ctx, "saldo insuficiente para a taxa")?;

    // ---- fronteira ----
    state.debitar(&tx.from, ctx.fee)?;
    let token = state.tokens.get_mut(&id).ok_or_else(|| erro("token EAV20 inexistente"))?;
    token.frozen.insert(tx.from.clone(), (amount, unlock_at));
    Ok(())
}

fn descongelar(state: &mut State, tx: &Tx, ctx: &Ctx) -> R<()> {
    exigir_admin_ativo(ctx)?;

    let id = {
        let token = buscar(state, tx)?;
        let (_, unlock_at) = *token
            .frozen
            .get(&tx.from)
            .ok_or_else(|| erro("nada congelado"))?;
        if ctx.height < unlock_at {
            return Err(erro("congelamento ainda não venceu"));
        }
        token.id.clone()
    };

    conferir_taxa(state, tx, ctx, "saldo insuficiente para a taxa")?;

    // ---- fronteira ----
    state.debitar(&tx.from, ctx.fee)?;
    let token = state.tokens.get_mut(&id).ok_or_else(|| erro("token EAV20 inexistente"))?;
    token.frozen.remove(&tx.from);
    Ok(())
}

// ============================================================================
// Testes
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Account;

    const ALICE: &str = "E7D36986E47AC3768974578F7CCD3123AE";
    const BOB: &str = "E74FE1240972091DE7BE392072067581DC";
    /// Altura acima de todos os forks deste módulo.
    const H: u64 = 1_901_000;

    fn ctx(height: u64) -> Ctx {
        Ctx { height, block_ts: 1_700_000_000_000, fee: 0 }
    }

    fn tx(tipo: &str, from: &str, pares: &[(&str, JsonValue)]) -> Tx {
        let mut t = Tx::new(tipo, from, 1, 1_700_000_000_000);
        t.id = Some(format!("{tipo}-{from}"));
        t.data = Some(JsonValue::map(
            pares.iter().map(|(k, v)| ((*k).to_string(), v.clone())),
        ));
        t
    }

    /// Estado com Alice e Bob providos de saldo nativo.
    fn estado() -> State {
        let mut s = State::new();
        for a in [ALICE, BOB] {
            s.accounts.insert(a.to_string(), Account { balance: 1_000_000_000, ..Default::default() });
        }
        s
    }

    fn dados_criacao(simbolo: &str, mintable: bool) -> Vec<(&'static str, JsonValue)> {
        vec![
            ("name", JsonValue::str("Vetor")),
            ("symbol", JsonValue::str(simbolo.to_string())),
            ("decimals", JsonValue::Int(6)),
            ("totalSupply", JsonValue::str("1000000000")),
            ("mintable", JsonValue::Bool(mintable)),
        ]
    }

    /// Cria um token de Alice e devolve o estado e o id.
    fn com_token(mintable: bool) -> (State, String) {
        let mut s = estado();
        let t = tx("TOKEN_CREATE", ALICE, &dados_criacao("VET", mintable));
        aplicar(&mut s, &t, &ctx(H)).expect("criação válida");
        let id = s.tokens.keys().next().unwrap().clone();
        (s, id)
    }

    /// Aplica esperando REJEIÇÃO e confere que o estado não mudou nada.
    ///
    /// É o teste que mais importa deste arquivo: um manipulador que mute antes de
    /// validar passa em todo teste de caminho feliz e só falha em produção, quando
    /// dois nós computam raízes diferentes para o mesmo bloco.
    fn rejeita_sem_mutar(s: &mut State, t: &Tx, c: &Ctx, msg: &str) {
        let antes = (s.accounts.clone(), s.tokens.clone());
        let e = aplicar(s, t, c).expect_err("deveria rejeitar");
        assert_eq!(e.0, msg);
        assert_eq!(s.accounts, antes.0, "rejeição mutou contas");
        assert_eq!(s.tokens, antes.1, "rejeição mutou tokens");
    }

    // ---------------------------------------------------------- TOKEN_CREATE

    #[test]
    fn create_da_todo_o_suprimento_ao_criador() {
        let (s, id) = com_token(false);
        let t = &s.tokens[&id];
        assert_eq!(t.standard, "eav20");
        assert_eq!(t.symbol, "VET");
        assert_eq!(t.decimals, 6);
        assert_eq!(t.total_supply, 1_000_000_000);
        assert_eq!(t.creator, ALICE);
        assert_eq!(t.owner, ALICE, "o criador nasce owner");
        assert!(!t.paused);
        assert_eq!(t.saldo(ALICE), 1_000_000_000, "o suprimento inteiro vai para o criador");
    }

    #[test]
    fn create_id_e_deterministico_a_partir_do_id_da_tx() {
        let (_s, id) = com_token(false);
        assert_eq!(id, eav_hash_one("EAV20-TOKEN:TOKEN_CREATE-E7D36986E47AC3768974578F7CCD3123AE"));
    }

    #[test]
    fn create_recusa_simbolo_duplicado_acima_do_fork() {
        // A regra que impede alguém de emitir um segundo "USDT" e se passar pelo
        // primeiro em carteira e explorer.
        let (mut s, _) = com_token(false);
        let mut t = tx("TOKEN_CREATE", BOB, &dados_criacao("VET", false));
        t.id = Some("outra-tx".into());
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "símbolo de token já existe: VET");
    }

    #[test]
    fn create_permite_simbolo_duplicado_abaixo_do_fork() {
        // Gated: a cadeia antiga pode já conter símbolos repetidos, e aplicar a regra
        // retroativamente invalidaria blocos que a rede validou.
        let mut s = estado();
        let mut t1 = tx("TOKEN_CREATE", ALICE, &dados_criacao("VET", false));
        t1.id = Some("tx-1".into());
        aplicar(&mut s, &t1, &ctx(PERMISSIONS_V2_HEIGHT - 1)).unwrap();
        let mut t2 = tx("TOKEN_CREATE", BOB, &dados_criacao("VET", false));
        t2.id = Some("tx-2".into());
        aplicar(&mut s, &t2, &ctx(PERMISSIONS_V2_HEIGHT - 1)).unwrap();
        assert_eq!(s.tokens.len(), 2);
    }

    #[test]
    fn create_valida_parametros() {
        let mut s = estado();
        let casos: &[(&str, JsonValue, &str)] = &[
            ("symbol", JsonValue::str("vet"), "símbolo do token deve ter 2 a 10 caracteres [A-Z0-9]"),
            ("symbol", JsonValue::str("V"), "símbolo do token deve ter 2 a 10 caracteres [A-Z0-9]"),
            ("name", JsonValue::str("   "), "nome do token deve ter entre 1 e 64 caracteres"),
            ("decimals", JsonValue::Int(19), "decimais do token devem ser um inteiro entre 0 e 18"),
            ("totalSupply", JsonValue::str("0"), "suprimento total deve ser uma string decimal positiva"),
            // Suprimento como NÚMERO JSON, não texto: a referência recusa porque
            // acima de 2⁵³ o número perderia precisão em silêncio.
            ("totalSupply", JsonValue::Int(1000), "suprimento total deve ser uma string decimal positiva"),
        ];
        for (chave, valor, msg) in casos {
            let mut pares = dados_criacao("VET", false);
            for p in pares.iter_mut() {
                if p.0 == *chave {
                    p.1 = valor.clone();
                }
            }
            let t = tx("TOKEN_CREATE", ALICE, &pares);
            rejeita_sem_mutar(&mut s, &t, &ctx(H), msg);
        }
    }

    #[test]
    fn create_sem_dados_e_rejeitado() {
        let mut s = estado();
        let mut t = Tx::new("TOKEN_CREATE", ALICE, 1, 1);
        t.id = Some("x".into());
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "parâmetros do token ausentes");
    }

    #[test]
    fn create_conta_o_nome_em_unidades_utf16_como_o_javascript() {
        // 33 emojis são 33 code points e 66 unidades UTF-16. A referência mede o
        // segundo número, então isto tem de ser recusado.
        let mut s = estado();
        let nome: String = "😀".repeat(33);
        let mut pares = dados_criacao("VET", false);
        pares[0].1 = JsonValue::str(nome);
        let t = tx("TOKEN_CREATE", ALICE, &pares);
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "nome do token deve ter entre 1 e 64 caracteres");
    }

    // -------------------------------------------------------- TOKEN_TRANSFER

    fn tx_transfer(from: &str, to: &str, id: &str, amount: &str) -> Tx {
        let mut t = tx("TOKEN_TRANSFER", from, &[("token", JsonValue::str(id))]);
        t.to = Some(to.to_string());
        t.amount = amount.to_string();
        t
    }

    #[test]
    fn transfer_move_o_saldo_do_token_e_nao_o_nativo() {
        let (mut s, id) = com_token(false);
        let nativo_antes = s.balance_of(ALICE);
        aplicar(&mut s, &tx_transfer(ALICE, BOB, &id, "250000"), &ctx(H)).unwrap();
        let t = &s.tokens[&id];
        assert_eq!(t.saldo(ALICE), 999_750_000);
        assert_eq!(t.saldo(BOB), 250_000);
        assert_eq!(s.balance_of(ALICE), nativo_antes, "taxa zero não mexe no saldo nativo");
    }

    #[test]
    fn transfer_acima_do_saldo_e_rejeitado() {
        let (mut s, id) = com_token(false);
        let t = tx_transfer(ALICE, BOB, &id, "2000000000");
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "saldo do token insuficiente ou congelado");
    }

    #[test]
    fn transfer_de_token_inexistente_e_rejeitado() {
        let (mut s, _) = com_token(false);
        let t = tx_transfer(ALICE, BOB, "nao-existe", "1");
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "token EAV20 inexistente");
    }

    #[test]
    fn transfer_de_valor_zero_e_rejeitado() {
        let (mut s, id) = com_token(false);
        let t = tx_transfer(ALICE, BOB, &id, "0");
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "valor do token deve ser positivo");
    }

    #[test]
    fn transfer_para_si_mesmo_nao_cria_moeda() {
        // A ordem escrita-depois-leitura da referência importa: lendo os dois saldos
        // antes, uma auto-transferência CRIARIA o valor transferido.
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_transfer(ALICE, ALICE, &id, "500"), &ctx(H)).unwrap();
        assert_eq!(s.tokens[&id].saldo(ALICE), 1_000_000_000);
    }

    #[test]
    fn transfer_com_saldo_nativo_abaixo_da_taxa_e_rejeitado() {
        let (mut s, id) = com_token(false);
        s.accounts.get_mut(ALICE).unwrap().balance = 5;
        let t = tx_transfer(ALICE, BOB, &id, "1");
        let c = Ctx { height: H, block_ts: 0, fee: 100 };
        rejeita_sem_mutar(&mut s, &t, &c, "saldo insuficiente para a taxa");
    }

    #[test]
    fn transfer_debita_a_taxa_do_saldo_nativo() {
        let (mut s, id) = com_token(false);
        let c = Ctx { height: H, block_ts: 0, fee: 1_000 };
        aplicar(&mut s, &tx_transfer(ALICE, BOB, &id, "1"), &c).unwrap();
        assert_eq!(s.balance_of(ALICE), 1_000_000_000 - 1_000);
    }

    // -------------------------------------------- pausa, bloqueio, congelamento

    fn tx_admin(tipo: &str, from: &str, id: &str, extra: &[(&str, JsonValue)]) -> Tx {
        let mut pares = vec![("token", JsonValue::str(id))];
        pares.extend(extra.iter().cloned());
        tx(tipo, from, &pares)
    }

    #[test]
    fn pause_bloqueia_toda_movimentacao() {
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_admin("TOKEN_PAUSE", ALICE, &id, &[]), &ctx(H)).unwrap();
        assert!(s.tokens[&id].paused);
        rejeita_sem_mutar(&mut s, &tx_transfer(ALICE, BOB, &id, "1"), &ctx(H), "token pausado");
    }

    #[test]
    fn unpause_devolve_a_movimentacao() {
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_admin("TOKEN_PAUSE", ALICE, &id, &[]), &ctx(H)).unwrap();
        aplicar(&mut s, &tx_admin("TOKEN_UNPAUSE", ALICE, &id, &[]), &ctx(H)).unwrap();
        assert!(!s.tokens[&id].paused);
        aplicar(&mut s, &tx_transfer(ALICE, BOB, &id, "1"), &ctx(H)).unwrap();
    }

    #[test]
    fn so_o_owner_pausa() {
        let (mut s, id) = com_token(false);
        let t = tx_admin("TOKEN_PAUSE", BOB, &id, &[]);
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "só o owner do token pode pausar");
    }

    #[test]
    fn admin_abaixo_do_fork_e_rejeitado() {
        let (mut s, id) = com_token(true);
        for tipo in ["TOKEN_PAUSE", "TOKEN_UNPAUSE", "TOKEN_MINT", "TOKEN_BURN",
                     "TOKEN_BLACKLIST", "TOKEN_FREEZE", "TOKEN_UNFREEZE"] {
            let t = tx_admin(tipo, ALICE, &id, &[]);
            rejeita_sem_mutar(&mut s, &t, &ctx(TOKEN_ADMIN_HEIGHT - 1), "admin de token ainda não ativo");
        }
    }

    #[test]
    fn blacklist_impede_receber_e_enviar() {
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_transfer(ALICE, BOB, &id, "1000"), &ctx(H)).unwrap();
        let t = tx_admin("TOKEN_BLACKLIST", ALICE, &id, &[("address", JsonValue::str(BOB))]);
        aplicar(&mut s, &t, &ctx(H)).unwrap();
        assert!(s.tokens[&id].blacklist[BOB]);

        let msg = format!("endereço bloqueado neste token: {BOB}");
        rejeita_sem_mutar(&mut s, &tx_transfer(ALICE, BOB, &id, "1"), &ctx(H), &msg);
        rejeita_sem_mutar(&mut s, &tx_transfer(BOB, ALICE, &id, "1"), &ctx(H), &msg);
    }

    #[test]
    fn blacklist_so_desbloqueia_com_blocked_falso_explicito() {
        let (mut s, id) = com_token(false);
        let bloquear = tx_admin("TOKEN_BLACKLIST", ALICE, &id, &[("address", JsonValue::str(BOB))]);
        aplicar(&mut s, &bloquear, &ctx(H)).unwrap();

        // Sem `blocked`, ou com `blocked: true`, continua bloqueando.
        aplicar(&mut s, &bloquear, &ctx(H)).unwrap();
        assert!(s.tokens[&id].blacklist.contains_key(BOB));

        let desbloquear = tx_admin("TOKEN_BLACKLIST", ALICE, &id,
            &[("address", JsonValue::str(BOB)), ("blocked", JsonValue::Bool(false))]);
        aplicar(&mut s, &desbloquear, &ctx(H)).unwrap();
        assert!(!s.tokens[&id].blacklist.contains_key(BOB));
    }

    #[test]
    fn blacklist_com_endereco_invalido_e_rejeitada() {
        let (mut s, id) = com_token(false);
        let t = tx_admin("TOKEN_BLACKLIST", ALICE, &id, &[("address", JsonValue::str("E7NAOEHENDERECO"))]);
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "endereço inválido");
    }

    #[test]
    fn saldo_congelado_nao_e_transferivel_ate_vencer() {
        let (mut s, id) = com_token(false);
        // Congela quase tudo: sobram 1000 livres.
        let mut t = tx_admin("TOKEN_FREEZE", ALICE, &id, &[("durationBlocks", JsonValue::Int(100))]);
        t.amount = "999999000".to_string();
        aplicar(&mut s, &t, &ctx(H)).unwrap();
        assert_eq!(s.tokens[&id].frozen[ALICE], (999_999_000, H + 100));

        // O congelado é do dono, mas não é dele para GASTAR antes do prazo.
        rejeita_sem_mutar(&mut s, &tx_transfer(ALICE, BOB, &id, "2000"), &ctx(H),
                          "saldo do token insuficiente ou congelado");
        aplicar(&mut s, &tx_transfer(ALICE, BOB, &id, "1000"), &ctx(H)).unwrap();

        // Vencido o prazo, o saldo inteiro volta a circular sem precisar de UNFREEZE.
        aplicar(&mut s, &tx_transfer(ALICE, BOB, &id, "500000"), &ctx(H + 100)).unwrap();
    }

    #[test]
    fn freeze_nao_pode_substituir_congelamento_vigente() {
        // Sem esta regra o dono reduziria o valor congelado reemitindo a transação, e
        // o congelamento não travaria nada.
        let (mut s, id) = com_token(false);
        let mut t = tx_admin("TOKEN_FREEZE", ALICE, &id, &[("durationBlocks", JsonValue::Int(100))]);
        t.amount = "1000".to_string();
        aplicar(&mut s, &t, &ctx(H)).unwrap();
        rejeita_sem_mutar(&mut s, &t, &ctx(H + 50), "já há um congelamento ativo nesta conta");
        // Vencido, pode recongelar.
        aplicar(&mut s, &t, &ctx(H + 100)).unwrap();
    }

    #[test]
    fn freeze_valida_duracao_e_valor() {
        let (mut s, id) = com_token(false);
        let mut t = tx_admin("TOKEN_FREEZE", ALICE, &id, &[("durationBlocks", JsonValue::Int(0))]);
        t.amount = "1000".to_string();
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "duração inválida");

        let mut t = tx_admin("TOKEN_FREEZE", ALICE, &id, &[("durationBlocks", JsonValue::Int(10))]);
        t.amount = "0".to_string();
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "valor a congelar deve ser positivo");

        let mut t = tx_admin("TOKEN_FREEZE", ALICE, &id, &[("durationBlocks", JsonValue::Int(10))]);
        t.amount = "9000000000".to_string();
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "saldo do token insuficiente para congelar");
    }

    #[test]
    fn unfreeze_so_depois_do_vencimento() {
        let (mut s, id) = com_token(false);
        rejeita_sem_mutar(&mut s, &tx_admin("TOKEN_UNFREEZE", ALICE, &id, &[]), &ctx(H), "nada congelado");

        let mut t = tx_admin("TOKEN_FREEZE", ALICE, &id, &[("durationBlocks", JsonValue::Int(100))]);
        t.amount = "1000".to_string();
        aplicar(&mut s, &t, &ctx(H)).unwrap();

        rejeita_sem_mutar(&mut s, &tx_admin("TOKEN_UNFREEZE", ALICE, &id, &[]), &ctx(H + 99),
                          "congelamento ainda não venceu");
        aplicar(&mut s, &tx_admin("TOKEN_UNFREEZE", ALICE, &id, &[]), &ctx(H + 100)).unwrap();
        assert!(s.tokens[&id].frozen.is_empty());
    }

    // ------------------------------------------------- allowance (approve/from)

    fn tx_approve(owner: &str, spender: &str, id: &str, amount: &str) -> Tx {
        let mut t = tx("TOKEN_APPROVE", owner, &[("token", JsonValue::str(id))]);
        t.to = Some(spender.to_string());
        t.amount = amount.to_string();
        t
    }

    fn tx_transfer_from(spender: &str, owner: &str, to: &str, id: &str, amount: &str) -> Tx {
        let mut t = tx("TOKEN_TRANSFER_FROM", spender,
            &[("token", JsonValue::str(id)), ("owner", JsonValue::str(owner))]);
        t.to = Some(to.to_string());
        t.amount = amount.to_string();
        t
    }

    #[test]
    fn approve_define_e_transfer_from_consome() {
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_approve(ALICE, BOB, &id, "5000"), &ctx(H)).unwrap();
        assert_eq!(s.tokens[&id].allowance(ALICE, BOB), 5_000);

        aplicar(&mut s, &tx_transfer_from(BOB, ALICE, BOB, &id, "2000"), &ctx(H)).unwrap();
        let t = &s.tokens[&id];
        assert_eq!(t.allowance(ALICE, BOB), 3_000, "a allowance SEMPRE decrementa");
        assert_eq!(t.saldo(BOB), 2_000);
        assert_eq!(t.saldo(ALICE), 999_998_000);
    }

    #[test]
    fn approve_sobrescreve_em_vez_de_somar() {
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_approve(ALICE, BOB, &id, "5000"), &ctx(H)).unwrap();
        aplicar(&mut s, &tx_approve(ALICE, BOB, &id, "100"), &ctx(H)).unwrap();
        assert_eq!(s.tokens[&id].allowance(ALICE, BOB), 100);
    }

    #[test]
    fn transfer_from_acima_da_allowance_e_rejeitado() {
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_approve(ALICE, BOB, &id, "100"), &ctx(H)).unwrap();
        let t = tx_transfer_from(BOB, ALICE, BOB, &id, "101");
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "allowance insuficiente");
    }

    #[test]
    fn transfer_from_sem_allowance_e_rejeitado() {
        let (mut s, id) = com_token(false);
        let t = tx_transfer_from(BOB, ALICE, BOB, &id, "1");
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "allowance insuficiente");
    }

    #[test]
    fn transfer_from_respeita_o_congelamento_do_dono() {
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_approve(ALICE, BOB, &id, "999999999"), &ctx(H)).unwrap();
        let mut f = tx_admin("TOKEN_FREEZE", ALICE, &id, &[("durationBlocks", JsonValue::Int(100))]);
        f.amount = "999999000".to_string();
        aplicar(&mut s, &f, &ctx(H)).unwrap();
        let t = tx_transfer_from(BOB, ALICE, BOB, &id, "2000");
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "saldo do token insuficiente ou congelado");
    }

    #[test]
    fn transfer_from_com_dono_invalido_e_rejeitado() {
        let (mut s, id) = com_token(false);
        let t = tx_transfer_from(BOB, "NAO-E-ENDERECO", BOB, &id, "1");
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "endereço do dono inválido");
    }

    #[test]
    fn transfer_from_bloqueia_o_gastador_na_lista_negra() {
        // Bloquear só as duas pontas deixaria um endereço na lista negra continuar
        // movendo o token dos outros por allowance já concedida.
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_approve(ALICE, BOB, &id, "5000"), &ctx(H)).unwrap();
        let bl = tx_admin("TOKEN_BLACKLIST", ALICE, &id, &[("address", JsonValue::str(BOB))]);
        aplicar(&mut s, &bl, &ctx(H)).unwrap();
        let t = tx_transfer_from(BOB, ALICE, ALICE, &id, "10");
        rejeita_sem_mutar(&mut s, &t, &ctx(H), &format!("endereço bloqueado neste token: {BOB}"));
    }

    #[test]
    fn transfer_from_e_barrado_pela_pausa() {
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_approve(ALICE, BOB, &id, "5000"), &ctx(H)).unwrap();
        aplicar(&mut s, &tx_admin("TOKEN_PAUSE", ALICE, &id, &[]), &ctx(H)).unwrap();
        let t = tx_transfer_from(BOB, ALICE, BOB, &id, "10");
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "token pausado");
    }

    // ----------------------------------------------------- TOKEN_MINT / BURN

    #[test]
    fn mint_aumenta_suprimento_e_saldo_do_destino() {
        let (mut s, id) = com_token(true);
        let mut t = tx_admin("TOKEN_MINT", ALICE, &id, &[]);
        t.to = Some(BOB.to_string());
        t.amount = "500".to_string();
        aplicar(&mut s, &t, &ctx(H)).unwrap();
        assert_eq!(s.tokens[&id].total_supply, 1_000_000_500);
        assert_eq!(s.tokens[&id].saldo(BOB), 500);
    }

    #[test]
    fn mint_exige_owner_e_mintable() {
        let (mut s, id) = com_token(true);
        let mut t = tx_admin("TOKEN_MINT", BOB, &id, &[]);
        t.to = Some(BOB.to_string());
        t.amount = "1".to_string();
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "só o owner do token pode mint");

        let (mut s, id) = com_token(false);
        let mut t = tx_admin("TOKEN_MINT", ALICE, &id, &[]);
        t.to = Some(BOB.to_string());
        t.amount = "1".to_string();
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "token não é mintable (supply fixo)");
    }

    #[test]
    fn mint_com_destino_invalido_e_rejeitado() {
        let (mut s, id) = com_token(true);
        let mut t = tx_admin("TOKEN_MINT", ALICE, &id, &[]);
        t.to = Some("E7NAOEHENDERECO".to_string());
        t.amount = "1".to_string();
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "destino inválido");
    }

    #[test]
    fn mint_de_valor_zero_e_rejeitado() {
        let (mut s, id) = com_token(true);
        let mut t = tx_admin("TOKEN_MINT", ALICE, &id, &[]);
        t.to = Some(BOB.to_string());
        t.amount = "0".to_string();
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "valor do mint deve ser positivo");
    }

    #[test]
    fn mint_que_estouraria_o_suprimento_e_rejeitado_sem_pancar() {
        // Um `+` cru aqui seria pânico — e pânico em nó de consenso é DoS: bastaria
        // uma transação escolhida a dedo para derrubar a rede inteira.
        let (mut s, id) = com_token(true);
        s.tokens.get_mut(&id).unwrap().total_supply = Amount::MAX;
        let mut t = tx_admin("TOKEN_MINT", ALICE, &id, &[]);
        t.to = Some(BOB.to_string());
        t.amount = "1".to_string();
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "estouro aritmético no suprimento do token");
    }

    #[test]
    fn burn_reduz_saldo_e_suprimento() {
        let (mut s, id) = com_token(false);
        let mut t = tx_admin("TOKEN_BURN", ALICE, &id, &[]);
        t.amount = "1000".to_string();
        aplicar(&mut s, &t, &ctx(H)).unwrap();
        assert_eq!(s.tokens[&id].saldo(ALICE), 999_999_000);
        assert_eq!(s.tokens[&id].total_supply, 999_999_000);
    }

    #[test]
    fn burn_acima_do_saldo_e_rejeitado() {
        let (mut s, id) = com_token(false);
        let mut t = tx_admin("TOKEN_BURN", BOB, &id, &[]);
        t.amount = "1".to_string();
        rejeita_sem_mutar(&mut s, &t, &ctx(H), "saldo do token insuficiente para queimar");
    }

    #[test]
    fn burn_nao_e_barrado_pela_pausa() {
        // A referência não aplica `#tokenGuard` no burn: queimar o próprio saldo não
        // move valor para ninguém. Acrescentar a guarda divergiria da rede.
        let (mut s, id) = com_token(false);
        aplicar(&mut s, &tx_admin("TOKEN_PAUSE", ALICE, &id, &[]), &ctx(H)).unwrap();
        let mut t = tx_admin("TOKEN_BURN", ALICE, &id, &[]);
        t.amount = "1".to_string();
        aplicar(&mut s, &t, &ctx(H)).expect("burn passa mesmo com o token pausado");
    }

    // ------------------------------------------------------------- genéricos

    #[test]
    fn valor_em_forma_nao_canonica_e_rejeitado_sem_pancar() {
        let (mut s, id) = com_token(false);
        for bruto in ["", "007", "-1", "1.5", "99999999999999999999999999999999999999999"] {
            let mut t = tx_transfer(ALICE, BOB, &id, "1");
            t.amount = bruto.to_string();
            assert!(aplicar(&mut s, &t, &ctx(H)).is_err(), "{bruto:?} deveria falhar");
        }
    }

    #[test]
    fn todo_tipo_da_lista_tem_ramo() {
        // A lista `TIPOS` e o `match` de `aplicar` têm de andar juntos: um tipo na
        // lista sem ramo vira erro genérico em vez do erro certo.
        let mut s = State::new();
        for tipo in TIPOS {
            let t = tx(tipo, ALICE, &[]);
            let e = aplicar(&mut s, &t, &ctx(H)).unwrap_err();
            assert!(!e.0.starts_with("tipo de token não tratado"), "{tipo} sem ramo");
        }
    }
    /// O efeito de META_TX sobre token: move saldo com as MESMAS guardas do
    /// `TOKEN_TRANSFER` direto, sem cobrar taxa nem tocar nonce.
    ///
    /// Este caminho estava DESLIGADO em `gov.rs` sob a alegação de que "o domínio
    /// de token ainda não foi portado" — está portado desde sempre; o comentário
    /// é que envelheceu. O efeito vive aqui, e não na governança, para que as
    /// guardas de pausa/blacklist/congelamento não ganhem uma segunda cópia.
    #[test]
    fn efeito_meta_transfer_move_saldo_e_respeita_as_guardas() {
        let (mut s, id) = com_token(false);

        // Caminho feliz: move de ALICE para BOB.
        efeito_meta_transfer(&mut s, &id, ALICE, BOB, 1_000, H).expect("transferência patrocinada");
        let tok = s.tokens.get(&id).expect("token");
        assert_eq!(tok.saldo(BOB), 1_000);

        // Valor ZERO é recusado, como no TOKEN_TRANSFER direto.
        assert!(efeito_meta_transfer(&mut s, &id, ALICE, BOB, 0, H).is_err());

        // Saldo insuficiente é recusado — e não deixa rastro.
        let antes = s.tokens.get(&id).expect("token").saldo(ALICE);
        assert!(efeito_meta_transfer(&mut s, &id, ALICE, BOB, u128::MAX, H).is_err());
        assert_eq!(s.tokens.get(&id).expect("token").saldo(ALICE), antes);

        // BLACKLIST: a guarda do domínio vale igual pela rota patrocinada — é o
        // ponto de ter o efeito aqui e não duplicado na governança.
        s.tokens.get_mut(&id).expect("token").blacklist.insert(BOB.to_string(), true);
        assert!(
            efeito_meta_transfer(&mut s, &id, ALICE, BOB, 1, H).is_err(),
            "endereço em blacklist não recebe nem por meta-tx"
        );

        // Token inexistente.
        assert!(efeito_meta_transfer(&mut s, "nao-existe", ALICE, BOB, 1, H).is_err());
    }

    /// Ida e volta com TODOS os campos preenchidos e distintos entre si.
    ///
    /// `frozen` é o caso que justifica o teste: o valor viaja com a tag de TEXTO e
    /// o `unlockAt` ao lado com a de inteiro, no MESMO objeto.
    #[test]
    fn token_sobrevive_a_ida_e_volta() {
        let t = Token {
            standard: "EAV20".into(),
            id: "tkn-1".into(),
            name: "Moeda".into(),
            symbol: "MOE".into(),
            decimals: 8,
            total_supply: 340_282_366_920_938_463_463_374_607_431_768_211_455,
            creator: "E7CRIADOR".into(),
            owner: "E7DONO".into(),
            mintable: true,
            paused: true,
            created_at: 1_700_000,
            balances: [("E7A".to_string(), 10u128), ("E7B".to_string(), 20)].into(),
            allowances: [("E7A".to_string(), [("E7B".to_string(), 30u128)].into())].into(),
            blacklist: [("E7C".to_string(), true)].into(),
            frozen: [("E7A".to_string(), (40u128, 50u64))].into(),
        };
        assert_eq!(Token::from_value(&t.to_value()), Some(t));
    }

    #[test]
    fn token_com_frozen_em_tag_errada_e_recusado() {
        let mut t = Token { standard: "EAV20".into(), ..Default::default() };
        t.frozen.insert("E7A".into(), (7, 8));
        let Value::Map(mut m) = t.to_value() else { panic!("mapa") };
        // `frozen.amount` com tag de INTEIRO: a rede o grava como texto.
        m.insert(
            "frozen".into(),
            Value::Map([("E7A".to_string(), Value::Map([
                ("amount".to_string(), Value::uint(7u128)),
                ("unlockAt".to_string(), Value::uint(8u128)),
            ].into()))].into()),
        );
        assert_eq!(Token::from_value(&Value::Map(m)), None);
    }
}
