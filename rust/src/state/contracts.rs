//! Contratos EAVM no estado de consenso — porte de `src/core/state.js`
//! (`#eavmWorld`, `recordBlockHash`, `codeOf`, `callEavm`, `#e7Of`) e de
//! `src/eavm/envelope.js` (`encodeE7Dest`/`decodeE7Dest`/`eavmToE7`).
//!
//! Este arquivo NÃO contém os manipuladores de transação (`EAVM_DEPLOY`/`CALL`/
//! `TRANSFER`) — só a ESTRUTURA: o tipo [`Contract`] (a folha `ctr` do
//! `stateRoot`), o anel de hashes de bloco (EIP-2935) e o [`EavmWorld`], que é a
//! implementação de [`World`] sobre o [`State`] com journaling.
//!
//! # As folhas `ctr` são consenso byte a byte
//!
//! A referência emite `leaf('ctr', addr, {code, storage, balance, nonce})`
//! (`src/core/stateroot.js:74`). Qualquer diferença de chave, tag ou forma do
//! valor muda TODA raiz de estado da rede. Ver [`Contract::to_value`].
//!
//! # Dois espaços de chave de storage — assimetria HERDADA e obrigatória
//!
//! O interpretador JS forma a chave de `SLOAD`/`SSTORE` com
//! `'0x' + hex.padStart(64, '0')` (`src/eavm/vm.js:107`), mas o anel de hashes de
//! bloco usa `'0x' + hex` SEM zeros à esquerda (`state.js:970` e `state.js:1000`).
//! São dois espaços de chave DISJUNTOS dentro do mesmo mapa `storage`: um
//! contrato que fizesse `SLOAD(n % 8191)` no endereço do anel leria a chave
//! preenchida — que não existe — e receberia zero, enquanto o opcode `BLOCKHASH`
//! lê a chave curta e enxerga o hash. "Corrigir" isso aqui divergiria da rede.
//!
//! # Journal em vez de clone (achados A-2/M-2)
//!
//! A primeira versão da referência clonava o mundo inteiro a cada `CALL`/`CREATE`
//! (`structuredClone`) — um DoS de CPU: bastava um contrato com um laço de
//! chamadas. O journal (undo-log) de `state.js:930` torna `snapshot` O(1) e
//! `revert` O(mudanças do frame). Este porte espelha o journal ENTRADA POR
//! ENTRADA — as variantes de [`J`] são as tuplas `['new'|'code'|'stor'|'bal'|
//! 'non'|'nbal'|'xfer', …]` de `state.js:931-986`.
//!
//! # Ledger unificado (achado A-3) — e por que `Contract.balance` é sempre 0
//!
//! Até `EAVM_VALUE_HEIGHT` os contratos são NON-PAYABLE: `contracts[].balance` é
//! um livro separado que começa e permanece em 0 (a ponte de valor era
//! unidirecional e prendia fundos — A-3). A PARTIR do fork, o saldo do mundo 0x
//! deixa de ser livro próprio e passa a SER o da conta nativa resolvida por
//! [`e7_of`]: um livro só, supply conservado por construção. `contracts[].balance`
//! continua 0 em ambos os regimes, então a serialização do `stateRoot` é IDÊNTICA
//! — o fork é puramente comportamental e não quebra replay (`state.js:917-923`).

use std::collections::BTreeMap;

use crate::address::{derive_address_from, is_valid_address};
use crate::canonical::Value;
use crate::config::{BLOCKHASH_HISTORY, EAVM_CHAIN_ID, EAVM_VALUE_HEIGHT, MAX_EAVM_GAS};
use crate::eavm::host::{addr_hex, EavmHost, TransferKind, World};
use crate::eavm::vm::{self, Address, BlockContext, ExecParams, Word};

use super::{Amount, State, StateError};

/// Endereço de sistema do anel de hashes de bloco (EIP-2935) — `state.js:27`.
///
/// O histórico fica no STORAGE de um endereço reservado: assim é ESTADO —
/// determinístico, replicado e coberto pelo `stateRoot` — em vez de a VM ter de
/// alcançar a camada de blocos, que ela não conhece nem deve conhecer
/// (`state.js:965-968`).
pub const BLOCKHASH_HISTORY_ADDR: &str = "0x0000f90827f1c53a10cb7a02335b175320002935";

/// Prefixo do destino E7 embutido num endereço 0x — `envelope.js:29`.
const E7_DEST_PREFIX: &str = "0xe7000000";

// ---------------------------------------------------------------------------
// O contrato — a folha `ctr`
// ---------------------------------------------------------------------------

/// Um contrato do mundo 0x. Espelha o literal de `state.js:931/999`:
/// `{ code: '', storage: {}, balance: 0n, nonce: 0 }`.
///
/// Os TIPOS de cada campo são regra de consenso (entram na folha `ctr`):
///
/// * `code` — string `''` (recém-materializado) ou `'0x…'` minúsculo. Vira tag de
///   TEXTO (0x04) na folha. Não é `Option`: a referência distingue `''` de
///   ausência de contrato, e `codeOf` trata `''` como "sem código" (`|| '0x'`).
/// * `storage` — slot (string `0x…`) → valor `'0x' + v.toString(16)`, hex SEM
///   zeros à esquerda (`state.js:945`). Slot com valor zero é REMOVIDO do mapa,
///   nunca gravado como `0x0` — guardar zero e não guardar nada têm de ser o
///   MESMO estado, senão haveria duas folhas para o mesmo mundo.
/// * `balance` — SEMPRE 0 nos dois regimes (ver o doc do módulo, achado A-3).
///   Ainda assim entra na folha, com tag de INTEIRO (0x03), porque a referência
///   serializa o campo (BigInt `0n` → `"0"`).
/// * `nonce` — `number` no JS; contador de `CREATE` do contrato. Tag de inteiro.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Contract {
    pub code: String,
    pub storage: BTreeMap<String, String>,
    pub balance: Amount,
    pub nonce: u64,
}

impl Contract {
    /// Forma canônica da folha `ctr` — byte a byte igual à referência.
    ///
    /// A referência passa o objeto JS direto ao codificador canônico, que ordena
    /// as chaves por byte: `balance` < `code` < `nonce` < `storage`. O `BTreeMap`
    /// dá a mesma ordem. `balance`/`nonce` com tag de inteiro (0x03), `code` e os
    /// valores de `storage` com tag de texto (0x04).
    pub fn to_value(&self) -> Value {
        let mut m = BTreeMap::new();
        m.insert("balance".to_string(), Value::uint(self.balance));
        m.insert("code".to_string(), Value::str(self.code.clone()));
        m.insert("nonce".to_string(), Value::uint(self.nonce));
        m.insert(
            "storage".to_string(),
            Value::Map(
                self.storage.iter().map(|(k, v)| (k.clone(), Value::str(v.clone()))).collect(),
            ),
        );
        Value::Map(m)
    }

    /// Inverso exato de [`Self::to_value`].
    ///
    /// `storage` volta com os valores em TEXTO, sem reinterpretar o hex: o estado
    /// guarda `'0x' + v.toString(16)` como string, e converter para inteiro aqui
    /// perderia a forma exata que a folha `ctr` codifica.
    pub fn from_value(v: &Value) -> Option<Self> {
        let m = v.mapa()?;
        if m.len() != 4 {
            return None;
        }
        Some(Contract {
            code: m.get("code")?.texto()?.to_string(),
            storage: m
                .get("storage")?
                .mapa()?
                .iter()
                .map(|(k, x)| Some((k.clone(), x.texto()?.to_string())))
                .collect::<Option<_>>()?,
            balance: m.get("balance")?.inteiro()?,
            nonce: m.get("nonce")?.inteiro()?,
        })
    }
}

// ---------------------------------------------------------------------------
// Endereços: 0x ↔ E7 (porte de src/eavm/envelope.js)
// ---------------------------------------------------------------------------

/// `isEavmAddress` — `envelope.js:44`: `0x` + 40 hexadecimais, caixa livre.
pub fn is_eavm_address(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("0x")
        && value.as_bytes()[2..].iter().all(u8::is_ascii_hexdigit)
}

/// `decodeE7Dest` — `envelope.js:30-36`.
///
/// # Formato byte a byte (20 bytes do campo `to` EVM)
///
/// ```text
/// bytes 0..4   : e7 00 00 00        — o prefixo reservado 0xe7000000
/// bytes 4..20  : 16 bytes           — corpo (14 bytes) + checksum (2 bytes) do E7
/// ```
///
/// Em texto: `0xe7000000` + 32 hexadecimais minúsculos, que são os 32 caracteres
/// do endereço E7 depois do prefixo `E7` (28 de corpo + 4 de checksum), baixados
/// de caixa. A decodificação sobe a caixa de volta, antepõe `E7` e VALIDA o
/// checksum embutido: sem prefixo ou sem checksum válido, devolve `None` e vale a
/// regra padrão keccak→E7 ([`eavm_to_e7`]). Colisão com uma conta EVM real é
/// 2⁻³² e ainda exigiria checksum válido (`envelope.js:24-28`).
pub fn decode_e7_dest(eavm_address: &str) -> Option<String> {
    if !is_eavm_address(eavm_address) {
        return None;
    }
    let h = eavm_address.to_lowercase();
    let resto = h.strip_prefix(E7_DEST_PREFIX)?;
    let e7 = format!("E7{}", resto.to_uppercase());
    if is_valid_address(&e7) { Some(e7) } else { None }
}

/// `encodeE7Dest` — `envelope.js:38-41`: a inversa exata de [`decode_e7_dest`].
///
/// A referência LANÇA em endereço inválido; aqui é `Err` — sem pânico em código
/// de consenso.
pub fn encode_e7_dest(e7: &str) -> Result<String, StateError> {
    if !is_valid_address(e7) {
        return Err(StateError::new("endereço E7 inválido"));
    }
    Ok(format!("{E7_DEST_PREFIX}{}", e7[2..].to_lowercase()))
}

/// `eavmToE7` — `envelope.js:49-52`: derivação determinística padrão de uma conta
/// 0x para a conta nativa, com domínio `EAV7-EAVM:` para não colidir com nenhum
/// outro uso do hash de endereço.
pub fn eavm_to_e7(eavm_address: &str) -> Result<String, StateError> {
    if !is_eavm_address(eavm_address) {
        return Err(StateError::new("endereço EAVM inválido"));
    }
    Ok(derive_address_from(format!("EAV7-EAVM:{}", eavm_address.to_lowercase())))
}

/// `#e7Of` — `state.js:899-901`: `decodeE7Dest(addr0x) ?? eavmToE7(addr0x)`.
///
/// É a MESMA regra que o envelope usa para destino (`destE7For`): o prefixo
/// `0xe7000000` carrega um E7 literal (com checksum) e é decodificado de volta;
/// qualquer outro 0x deriva por keccak. Bidirecional — é o que permite o ledger
/// unificado sem estado novo.
pub fn e7_of(addr0x: &str) -> Result<String, StateError> {
    if let Some(e7) = decode_e7_dest(addr0x) {
        return Ok(e7);
    }
    eavm_to_e7(addr0x)
}

/// [`e7_of`] para um endereço binário do mundo da VM.
///
/// Um `Address` sempre formata como `0x` + 40 hex minúsculos ([`addr_hex`]), que
/// é sempre um endereço EAVM válido — daí não haver caminho de erro aqui.
fn e7_of_addr(a: &Address) -> String {
    let h = addr_hex(a);
    decode_e7_dest(&h).unwrap_or_else(|| derive_address_from(format!("EAV7-EAVM:{h}")))
}

// ---------------------------------------------------------------------------
// Codificações de storage
// ---------------------------------------------------------------------------

/// Chave de slot como o interpretador da referência a forma (`vm.js:107`):
/// `'0x' + hex.padStart(64, '0')` — SEMPRE 64 hexadecimais, com zeros.
fn slot_key(k: &Word) -> String {
    format!("0x{}", hex::encode(k.to_be_bytes::<32>()))
}

/// Chave de slot do ANEL de hashes (`state.js:970/1000`):
/// `'0x' + n.toString(16)` — hex minúsculo SEM zeros à esquerda. Ver o doc do
/// módulo sobre os dois espaços de chave.
fn ring_slot(number: u64) -> String {
    format!("0x{:x}", number % BLOCKHASH_HISTORY)
}

/// Valor de storage como a referência grava (`state.js:945`):
/// `'0x' + v.toString(16)` — hex minúsculo sem zeros à esquerda. Zero nunca é
/// gravado (a chave é removida), mas a forma `0x0` fica aqui por completude.
fn word_hex_min(v: &Word) -> String {
    let h = hex::encode(v.to_be_bytes::<32>());
    let t = h.trim_start_matches('0');
    if t.is_empty() { "0x0".to_string() } else { format!("0x{t}") }
}

/// `BigInt('0x…')` da referência. Valor malformado (que este código nunca grava)
/// vira zero em vez de pânico — pânico em caminho de consenso é DoS.
fn word_from_hex(s: &str) -> Word {
    let t = s.strip_prefix("0x").unwrap_or(s);
    Word::from_str_radix(t, 16).unwrap_or(Word::ZERO)
}

/// `Buffer.from(hex, 'hex')` do Node: decodifica pares até o primeiro par
/// inválido e IGNORA um nibble final solto — sem erro, sem pânico. Usado onde a
/// referência usa `Buffer.from` sobre entrada externa (calldata de `eth_call` e
/// `data.code`/`data.input` das transações EAVM — `state.js:1087/1109`).
pub(crate) fn buffer_from_hex(s: &str) -> Vec<u8> {
    // O strip do prefixo espelha `String(x).replace(/^0x/, '')` — sensível a
    // caixa: `0X…` NÃO é removido, exatamente como na referência.
    let t = s.strip_prefix("0x").unwrap_or(s);
    let b = t.as_bytes();
    let mut out = Vec::with_capacity(b.len() / 2);
    let mut i = 0;
    while i + 1 < b.len() {
        match ((b[i] as char).to_digit(16), (b[i + 1] as char).to_digit(16)) {
            (Some(hi), Some(lo)) => out.push((hi * 16 + lo) as u8),
            _ => break,
        }
        i += 2;
    }
    out
}

/// `^0x[0-9a-f]{40}$` — a validação ESTRITA (minúsculas) de `callEavm`
/// (`state.js:1017`) e de `EAVM_CALL` (`state.js:1093`), aplicada depois do
/// `toLowerCase()` do chamador.
pub(crate) fn parse_addr_strict(s: &str) -> Option<Address> {
    if s.len() != 42 || !s.starts_with("0x") {
        return None;
    }
    if !s.as_bytes()[2..].iter().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b)) {
        return None;
    }
    let mut a = [0u8; 20];
    hex::decode_to_slice(&s[2..], &mut a).ok()?;
    Some(a)
}

// ---------------------------------------------------------------------------
// O mundo com journal — porte de #eavmWorld (state.js:924-991)
// ---------------------------------------------------------------------------

/// Transferência interna observada: `(from0x, to0x, valor, motivo)`.
///
/// É o que o explorador mostra como "internal transfer" (`state.js:2617` mapeia
/// os 0x para E7 na saída). `kind == Entry` nunca entra aqui: o valor da própria
/// transação já aparece como `amount` na tx (`state.js:951-954`).
pub type Xfer = (String, String, Amount, TransferKind);

/// Uma entrada do undo-log. Espelho 1:1 das tuplas de `state.js:931-986`.
#[derive(Debug, Clone)]
enum J {
    /// `['new', a]` — contrato materializado por escrita (`state.js:931`).
    /// Revert: `delete C[a]` (`state.js:977`).
    New(String),
    /// `['code', a, anterior]` (`state.js:943`). Revert: restaura (`:978`).
    Code(String, String),
    /// `['stor', a, k, anterior]` (`state.js:945`); `None` = chave não existia.
    /// Revert: `undefined` apaga, senão restaura (`:979`).
    Stor(String, String, Option<String>),
    /// `['bal', a, anterior]` — saldo do LIVRO DE CONTRATO, regime legado
    /// (`state.js:949`). Revert: restaura (`:980`).
    Bal(String, Amount),
    /// `['non', a, anterior]` (`state.js:962`). Revert: restaura (`:981`).
    Non(String, u64),
    /// `['nbal', e7, saldoAnterior, existia?]` — saldo NATIVO, regime unificado
    /// (`state.js:938`). Revert (`state.js:985`): se a conta EXISTIA, restaura o
    /// saldo; se só existia por causa deste frame, REMOVE-A — senão um `CALL`
    /// revertido deixaria conta-fantasma de saldo 0 no estado e mudaria o
    /// `stateRoot` sem nenhuma transação efetiva (`state.js:982-984`).
    Nbal(String, Amount, bool),
    /// `['xfer']` (`state.js:959`). Revert: `xfers.pop()` (`:986`).
    Xfer,
}

/// O mundo de contratos (espaço 0x) para a VM, sobre um `&mut State`.
///
/// Snapshot = comprimento do journal (O(1)); revert desfaz em ordem inversa só as
/// entradas desde o snapshot (O(mudanças do frame)). Aninhamento funciona por
/// construção: `revert(s1)` desfaz também tudo que veio depois de `s2 > s1` —
/// exatamente o contrato exigido pelo trait [`World`] (achados A-2/M-2).
pub struct EavmWorld<'a> {
    state: &'a mut State,
    /// `height >= EAVM_VALUE_HEIGHT` (`state.js:926`): decide o regime do saldo.
    unified: bool,
    journal: Vec<J>,
    /// `Some` espelha o array `xfers` que `#runEavmTx` passa; `None` espelha o
    /// `null` de `callEavm` (leitura não observa transferências internas).
    xfers: Option<Vec<Xfer>>,
}

impl<'a> EavmWorld<'a> {
    /// `#eavmWorld(height)` — sem rastreio de transferências internas.
    pub fn new(state: &'a mut State, height: u64) -> Self {
        EavmWorld { state, unified: height >= EAVM_VALUE_HEIGHT, journal: Vec::new(), xfers: None }
    }

    /// `#eavmWorld(height, xfers)` — com rastreio, para o caminho de transação.
    pub fn new_rastreando_xfers(state: &'a mut State, height: u64) -> Self {
        EavmWorld {
            state,
            unified: height >= EAVM_VALUE_HEIGHT,
            journal: Vec::new(),
            xfers: Some(Vec::new()),
        }
    }

    /// As transferências internas observadas até aqui.
    pub fn xfers(&self) -> &[Xfer] {
        self.xfers.as_deref().unwrap_or(&[])
    }

    /// O estado subjacente, para LEITURA enquanto o mundo está vivo.
    ///
    /// O manipulador de transação (`state/eavm_tx.rs`) precisa apurar energia,
    /// bandwidth e saldo DEPOIS de a VM rodar — e ainda poder `revert(0)` se uma
    /// checagem posterior falhar (achados C-1/A-4, `state.js:1180-1183` e
    /// `state.js:2589`). Sem este acesso ele teria de derrubar o mundo (e o
    /// journal junto) antes da apuração, perdendo a atomicidade.
    pub(crate) fn state(&self) -> &State {
        self.state
    }

    /// Consome o rastreio (o manipulador de transação lê DEPOIS de executar).
    pub fn take_xfers(&mut self) -> Vec<Xfer> {
        self.xfers.take().unwrap_or_default()
    }

    /// `get(a)` de `state.js:931`: materializa o contrato na PRIMEIRA escrita e
    /// journaliza `['new', a]`. Leitura NUNCA materializa (`getCode`/`getStorage`
    /// usam `C[a]?.…`) — senão uma consulta mudaria o `stateRoot`.
    fn materializa_ctr(&mut self, chave: &str) {
        if !self.state.contracts.contains_key(chave) {
            self.state.contracts.insert(chave.to_string(), Contract::default());
            self.journal.push(J::New(chave.to_string()));
        }
    }

    /// `natAdd`/`addBalance` (`state.js:934-950`) com o delta separado em
    /// (valor, débito?) porque `Amount` é sem sinal. Devolve `false` — SEM ter
    /// mutado nada — se a aritmética não fechar (débito sem saldo é barrado antes
    /// por `move_value`; overflow de crédito é inalcançável sob o invariante de
    /// suprimento ~10¹⁷ ≪ u128::MAX, mas a checagem fica: erro silencioso em
    /// saldo é o pior modo de falha deste módulo).
    fn add_balance(&mut self, a: &Address, valor: Amount, debito: bool) -> bool {
        if self.unified {
            // Regime unificado: o saldo É o da conta nativa e7_of(a). A leitura
            // não materializa conta (`natBal`, state.js:933) — só a escrita
            // (`natAdd` chama getAccount, state.js:937).
            let e7 = e7_of_addr(a);
            let existed = self.state.accounts.contains_key(&e7);
            let antes = self.state.accounts.get(&e7).map(|c| c.balance).unwrap_or(0);
            let Some(novo) = (if debito { antes.checked_sub(valor) } else { antes.checked_add(valor) })
            else {
                return false; // nada foi mutado nem journalizado
            };
            // Ordem do JS: journal ANTES da mutação (state.js:938-939). A conta
            // materializada aqui NÃO ganha eavm_managed: o getAccount da
            // referência (state.js:102) cria a conta "crua", e eavmManaged só é
            // marcado no caminho de STAKE via envelope (state.js:1210).
            self.journal.push(J::Nbal(e7.clone(), antes, existed));
            self.state.account_mut(&e7).balance = novo;
            true
        } else {
            // Regime legado (non-payable): livro próprio do contrato, que na
            // prática permanece 0 — ver achado A-3 no doc do módulo.
            let chave = addr_hex(a);
            self.materializa_ctr(&chave);
            let antes = self.state.contracts.get(&chave).map(|c| c.balance).unwrap_or(0);
            let Some(novo) = (if debito { antes.checked_sub(valor) } else { antes.checked_add(valor) })
            else {
                return false; // o ['new'] eventual fica; o revert do chamador o desfaz
            };
            self.journal.push(J::Bal(chave.clone(), antes));
            if let Some(c) = self.state.contracts.get_mut(&chave) {
                c.balance = novo;
            }
            true
        }
    }

    /// O laço de desfazimento de `state.js:974-988`, em ordem inversa.
    fn desfaz_ate(&mut self, marca: usize) {
        while self.journal.len() > marca {
            let Some(e) = self.journal.pop() else { break };
            match e {
                J::New(a) => {
                    self.state.contracts.remove(&a);
                }
                J::Code(a, antes) => {
                    if let Some(c) = self.state.contracts.get_mut(&a) {
                        c.code = antes;
                    }
                }
                J::Stor(a, k, antes) => {
                    if let Some(c) = self.state.contracts.get_mut(&a) {
                        match antes {
                            None => {
                                c.storage.remove(&k);
                            }
                            Some(v) => {
                                c.storage.insert(k, v);
                            }
                        }
                    }
                }
                J::Bal(a, antes) => {
                    if let Some(c) = self.state.contracts.get_mut(&a) {
                        c.balance = antes;
                    }
                }
                J::Non(a, antes) => {
                    if let Some(c) = self.state.contracts.get_mut(&a) {
                        c.nonce = antes;
                    }
                }
                // A linha que fecha o achado da conta-fantasma: conta que NÃO
                // existia antes do frame é REMOVIDA, não zerada (state.js:985).
                J::Nbal(e7, antes, existia) => {
                    if existia {
                        if let Some(acc) = self.state.accounts.get_mut(&e7) {
                            acc.balance = antes;
                        }
                    } else {
                        self.state.accounts.remove(&e7);
                    }
                }
                J::Xfer => {
                    if let Some(x) = self.xfers.as_mut() {
                        x.pop();
                    }
                }
            }
        }
    }
}

impl World for EavmWorld<'_> {
    /// `getStorage` (`state.js:944`): `BigInt(C[a]?.storage?.[k] ?? 0n)`. Leitura
    /// não materializa nada. A chave é a PREENCHIDA de 64 hex (`vm.js:107`).
    fn get_storage(&self, address: &Address, key: &Word) -> Word {
        let a = addr_hex(address);
        self.state
            .contracts
            .get(&a)
            .and_then(|c| c.storage.get(&slot_key(key)))
            .map(|v| word_from_hex(v))
            .unwrap_or(Word::ZERO)
    }

    /// `setStorage` (`state.js:945`): journaliza o valor anterior; zero REMOVE a
    /// chave; não-zero grava `'0x' + hex` sem zeros à esquerda.
    fn set_storage(&mut self, address: &Address, key: Word, value: Word) {
        let a = addr_hex(address);
        self.materializa_ctr(&a);
        let slot = slot_key(&key);
        let antes = self.state.contracts.get(&a).and_then(|c| c.storage.get(&slot)).cloned();
        self.journal.push(J::Stor(a.clone(), slot.clone(), antes));
        if let Some(c) = self.state.contracts.get_mut(&a) {
            if value.is_zero() {
                c.storage.remove(&slot);
            } else {
                c.storage.insert(slot, word_hex_min(&value));
            }
        }
    }

    /// `getCode` (`state.js:942`): `''` ou `'0x…'` → bytes. Não materializa.
    fn get_code(&self, address: &Address) -> Vec<u8> {
        let a = addr_hex(address);
        let code = self.state.contracts.get(&a).map(|c| c.code.as_str()).unwrap_or("");
        // O código foi gravado por este módulo como hex par válido; decode só
        // falharia com estado corrompido — e aí bytes vazios são o modo de falha
        // seguro, nunca pânico.
        hex::decode(code.strip_prefix("0x").unwrap_or(code)).unwrap_or_default()
    }

    /// `putCode` (`state.js:943`): materializa, journaliza o código anterior,
    /// grava `'0x' + hex` minúsculo.
    fn put_code(&mut self, address: &Address, code: &[u8]) {
        let a = addr_hex(address);
        self.materializa_ctr(&a);
        let antes = self.state.contracts.get(&a).map(|c| c.code.clone()).unwrap_or_default();
        self.journal.push(J::Code(a.clone(), antes));
        if let Some(c) = self.state.contracts.get_mut(&a) {
            c.code = format!("0x{}", hex::encode(code));
        }
    }

    /// `getBalance` (`state.js:946`): unificado → saldo NATIVO de `e7_of(a)`
    /// (leitura sem materializar, `natBal`); legado → livro do contrato.
    fn get_balance(&self, address: &Address) -> Word {
        if self.unified {
            let e7 = e7_of_addr(address);
            Word::from(self.state.accounts.get(&e7).map(|c| c.balance).unwrap_or(0))
        } else {
            let a = addr_hex(address);
            Word::from(self.state.contracts.get(&a).map(|c| c.balance).unwrap_or(0))
        }
    }

    /// `moveValue` (`state.js:955-961`) — o ÚNICO ponto por onde valor se move
    /// dentro da VM. Centralizar é o que mantém débito e crédito atômicos sob o
    /// mesmo journal (C-1/A-4: nada de meia-transferência sobrevivendo a revert).
    ///
    /// Devolve `false` SEM mutar quando o saldo não cobre (`state.js:956`).
    fn move_value(
        &mut self,
        from: &Address,
        to: &Address,
        value: Word,
        kind: TransferKind,
    ) -> bool {
        // `world.getBalance(from) < value` — a guarda ANTES de qualquer mutação.
        if self.get_balance(from) < value {
            return false;
        }
        // O saldo cobre `value` e saldo cabe em u128, logo `value` também cabe.
        // A conversão falhar seria estado corrompido: recusa sem mutar.
        let Ok(v) = Amount::try_from(value) else {
            return false;
        };
        // Débito e crédito em sequência, como o JS (addBalance(from,-v) então
        // addBalance(to,+v)). Se o crédito falhar (inalcançável — ver
        // add_balance), o snapshot local desfaz o débito: `false` mantém o
        // contrato "sem mutação" do trait.
        let snap = self.journal.len();
        if !self.add_balance(from, v, true) || !self.add_balance(to, v, false) {
            self.desfaz_ate(snap);
            return false;
        }
        // `if (xfers && kind !== 'entry')` (state.js:959): `entry` é o valor da
        // própria transação — já visível como `amount` na tx, não vira
        // transferência interna.
        if kind != TransferKind::Entry
            && let Some(x) = self.xfers.as_mut()
        {
            x.push((addr_hex(from), addr_hex(to), v, kind));
            self.journal.push(J::Xfer);
        }
        true
    }

    /// `bumpNonce` (`state.js:962`): materializa, journaliza e devolve o valor
    /// ANTERIOR — é ele que entra no endereço do `CREATE`.
    fn bump_nonce(&mut self, address: &Address) -> u64 {
        let a = addr_hex(address);
        self.materializa_ctr(&a);
        let antes = self.state.contracts.get(&a).map(|c| c.nonce).unwrap_or(0);
        self.journal.push(J::Non(a.clone(), antes));
        if let Some(c) = self.state.contracts.get_mut(&a) {
            // saturating em vez de `+ 1` cru: overflow de u64 é inalcançável
            // (2⁶⁴ CREATEs), mas pânico em consenso é DoS e fica proibido.
            c.nonce = antes.saturating_add(1);
        }
        antes
    }

    /// `blockHash` (`state.js:969-972`): lê o anel EIP-2935 no storage do
    /// endereço de sistema, com a chave CURTA (sem zeros à esquerda). A janela de
    /// 256 já foi filtrada pelo host — aqui é só o anel.
    fn block_hash(&self, number: u64) -> Word {
        self.state
            .contracts
            .get(BLOCKHASH_HISTORY_ADDR)
            .and_then(|c| c.storage.get(&ring_slot(number)))
            .map(|v| word_from_hex(v))
            .unwrap_or(Word::ZERO)
    }

    /// `snapshot: () => journal.length` (`state.js:973`) — O(1).
    fn snapshot(&mut self) -> usize {
        self.journal.len()
    }

    /// `revert(n)` (`state.js:974-988`) — desfaz em ordem inversa até a marca.
    fn revert(&mut self, snapshot: usize) {
        self.desfaz_ate(snapshot);
    }
}

// ---------------------------------------------------------------------------
// Métodos de State: anel de hashes, codeOf, callEavm
// ---------------------------------------------------------------------------

/// Parâmetros de [`State::call_eavm`].
///
/// Struct nomeada e não sete posicionais: a referência (`state.js:1015`) recebe um
/// OBJETO com chaves, e a forma posicional punha `value`, `height`, `block_ts` e
/// `gas` — quatro números seguidos — onde uma troca de ordem compila em silêncio e
/// só aparece como `eth_call` executando contra a altura errada.
#[derive(Debug, Clone, Default)]
pub struct EavmCallParams<'a> {
    /// Chamador; ausente/inválido vira o endereço zero (`state.js:1018-1020`).
    pub from: Option<&'a str>,
    pub to: &'a str,
    /// Calldata em hexadecimal (`"0x…"`).
    pub data: &'a str,
    pub value: Amount,
    pub height: u64,
    pub block_ts: u64,
    /// `None` usa `MAX_EAVM_GAS`; qualquer valor é limitado por ele.
    pub gas: Option<u64>,
}

/// Resultado de uma execução somente leitura ([`State::call_eavm`]) — o formato
/// que `eth_call`/`eth_estimateGas` devolvem (`state.js:1039-1043`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EavmCallResult {
    pub success: bool,
    /// `'0x' + hex` do retorno (vazio → `"0x"`).
    pub return_data: String,
    pub gas_used: u64,
}

impl State {
    /// `recordBlockHash` — `state.js:996-1002`. Chamado pela camada de blocos,
    /// que é quem conhece o hash; o `State` só guarda. Anel de tamanho fixo
    /// (8191): o custo de estado é constante, não cresce com a cadeia.
    ///
    /// O guard de tipos do JS (`Number.isInteger(number) && number >= 0` e
    /// `typeof hash === 'string'`) é dado de graça por `u64`/`&str`.
    pub fn record_block_hash(&mut self, number: u64, hash: &str) {
        // `?? (this.contracts[ADDR] = { code:'', storage:{}, balance:0n, nonce:0 })`
        let c = self.contracts.entry(BLOCKHASH_HISTORY_ADDR.to_string()).or_default();
        // slot = '0x' + (number % 8191).toString(16) — hex curto, minúsculo.
        let slot = ring_slot(number);
        // valor = '0x' + hash.replace(/^0x/,'').toLowerCase(). O hash da cadeia é
        // hex puro de 64 caracteres SEM 0x (eavHash), então normalmente nada é
        // removido — mas o strip espelha a referência ao byte, inclusive sendo
        // sensível a caixa no prefixo.
        let corpo = hash.strip_prefix("0x").unwrap_or(hash).to_lowercase();
        c.storage.insert(slot, format!("0x{corpo}"));
    }

    /// `codeOf` — `state.js:1006-1009`: bytecode de runtime na forma 0x, o que
    /// `eth_getCode` devolve. Conta que não é contrato — ou contrato com `code`
    /// vazio (o `||` do JS trata `''` como falsy) — responde `'0x'`.
    pub fn code_of(&self, address: &str) -> String {
        let addr = address.to_lowercase();
        match self.contracts.get(&addr) {
            Some(c) if !c.code.is_empty() => c.code.clone(),
            _ => "0x".to_string(),
        }
    }

    /// `callEavm` — `state.js:1015-1052`. Execução SOMENTE LEITURA contra o
    /// estado atual: o motor de `eth_call`/`eth_estimateGas`. Roda a VM de
    /// verdade e depois desfaz TUDO pelo journal — nenhuma consulta pode alterar
    /// o estado nem o `stateRoot`.
    ///
    /// Diferenças de forma (não de comportamento) com o JS: os parâmetros nomeados
    /// da referência viram os campos de [`EavmCallParams`]; `value` chega como
    /// [`Amount`] (a referência recebe BigInt); erro de destino é `Err`, não `throw`.
    pub fn call_eavm(
        &mut self,
        p: EavmCallParams<'_>,
    ) -> Result<EavmCallResult, StateError> {
        let EavmCallParams { from, to, data, value, height, block_ts, gas } = p;
        // `const target = String(to).toLowerCase()` + regex estrita (state.js:1016-1017).
        let target = to.to_lowercase();
        let Some(target_addr) = parse_addr_strict(&target) else {
            return Err(StateError::new("destino inválido"));
        };
        // Chamador inválido/ausente vira o endereço zero (state.js:1018-1020).
        let caller_addr = from
            .map(|f| f.to_lowercase())
            .as_deref()
            .and_then(parse_addr_strict)
            .unwrap_or([0u8; 20]);

        // budget = min(gas ?? MAX_EAVM_GAS, MAX_EAVM_GAS) (state.js:1024).
        let budget = gas.unwrap_or(MAX_EAVM_GAS).min(MAX_EAVM_GAS);
        let calldata = buffer_from_hex(data);

        let mut world = EavmWorld::new(self, height);
        let code = world.get_code(&target_addr);
        let params = ExecParams {
            code,
            calldata,
            gas: budget,
            caller: caller_addr,
            address: target_addr,
            value: Word::from(value),
            origin: Some(caller_addr),
            gas_price: Word::ZERO,
            depth: 0,
            // block = { number: height, timestamp: blockTs, chainId } — a
            // referência não põe gasLimit no bloco de consulta; 0 espelha isso.
            block: BlockContext {
                number: height,
                timestamp: block_ts,
                gas_limit: 0,
                chain_id: EAVM_CHAIN_ID,
            },
            ..ExecParams::default()
        };

        // O escopo do host limita o empréstimo do mundo; depois dele, o
        // `revert(0)` roda INCONDICIONALMENTE — é o `finally` de state.js:1047-1051,
        // inclusive no caminho de erro. Sem pânico no meio (política do crate),
        // não há caminho que escape do desfazimento.
        let resultado = {
            let mut host = EavmHost::new(&mut world);
            vm::run_eavm(params, &mut host)
        };
        world.revert(0);

        match resultado {
            Ok(res) => Ok(EavmCallResult {
                success: res.success,
                return_data: format!("0x{}", hex::encode(res.return_data)),
                gas_used: res.gas_used,
            }),
            // `catch (e) { if (e instanceof EavmError) return {success:false, …} }`
            // — em Rust todo Err de run_eavm É EavmError, então não há re-lance.
            Err(_) => {
                Ok(EavmCallResult { success: false, return_data: "0x".to_string(), gas_used: budget })
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical::encode;

    fn addr(n: u8) -> Address {
        let mut a = [0u8; 20];
        a[19] = n;
        a
    }

    // -------------------------------------------------------------- journal

    #[test]
    fn snapshot_e_revert_aninhados_desfazem_tudo_ate_a_marca_externa() {
        let mut s = State::new();
        let a = addr(1);
        {
            let mut w = EavmWorld::new(&mut s, 0);
            let s1 = w.snapshot();
            w.put_code(&a, &[0x60, 0x01]);
            let s2 = w.snapshot();
            w.set_storage(&a, Word::from(1u64), Word::from(42u64));
            w.set_storage(&a, Word::from(2u64), Word::from(7u64));

            // revert(s2) desfaz só o storage, mantém o código.
            w.revert(s2);
            assert_eq!(w.get_storage(&a, &Word::from(1u64)), Word::ZERO);
            assert_eq!(w.get_code(&a), vec![0x60, 0x01]);

            // refaz mudanças depois de s2 e reverte direto para s1: TUDO some,
            // inclusive o que veio depois do snapshot interno.
            w.set_storage(&a, Word::from(1u64), Word::from(99u64));
            w.revert(s1);
        }
        assert!(s.contracts.is_empty(), "revert(s1) tem de remover o contrato materializado");
    }

    #[test]
    fn revert_restaura_valor_anterior_de_storage_e_codigo() {
        let mut s = State::new();
        let a = addr(2);
        let mut w = EavmWorld::new(&mut s, 0);
        w.put_code(&a, &[0x01]);
        w.set_storage(&a, Word::from(5u64), Word::from(10u64));
        let marca = w.snapshot();
        w.put_code(&a, &[0x02]);
        w.set_storage(&a, Word::from(5u64), Word::from(20u64));
        w.set_storage(&a, Word::from(5u64), Word::ZERO); // remove
        w.revert(marca);
        assert_eq!(w.get_code(&a), vec![0x01]);
        assert_eq!(w.get_storage(&a, &Word::from(5u64)), Word::from(10u64));
    }

    // ------------------------------------------- regime unificado / fantasma

    #[test]
    fn revert_remove_conta_fantasma_no_regime_unificado() {
        let mut s = State::new();
        let from = addr(0xAA);
        let to = addr(0xBB);
        let from_e7 = eavm_to_e7(&addr_hex(&from)).expect("endereço 0x válido");
        let to_e7 = eavm_to_e7(&addr_hex(&to)).expect("endereço 0x válido");
        s.account_mut(&from_e7).balance = 100;

        {
            let mut w = EavmWorld::new_rastreando_xfers(&mut s, EAVM_VALUE_HEIGHT);
            let snap = w.snapshot();
            assert!(w.move_value(&from, &to, Word::from(40u64), TransferKind::Call));
            assert_eq!(w.xfers().len(), 1, "kind != entry entra no rastreio");
            w.revert(snap);
            assert!(w.xfers().is_empty(), "revert tem de despilhar o xfer");
        }
        // O ponto do achado: a conta destino só existia por causa do frame
        // revertido — precisa SUMIR, não ficar com saldo 0 (state.js:982-985).
        assert!(!s.accounts.contains_key(&to_e7), "CALL revertido não pode deixar conta-fantasma");
        assert_eq!(s.accounts.get(&from_e7).map(|a| a.balance), Some(100));
        assert_eq!(s.accounts.len(), 1);
    }

    #[test]
    fn conta_materializada_pelo_mundo_nao_ganha_eavm_managed() {
        // Reproduz o JS: getAccount (state.js:102) cria conta crua; eavmManaged
        // só é marcado no caminho de STAKE (state.js:1210), que não passa aqui.
        let mut s = State::new();
        let from = addr(0x11);
        let to = addr(0x22);
        let from_e7 = eavm_to_e7(&addr_hex(&from)).expect("endereço 0x válido");
        let to_e7 = eavm_to_e7(&addr_hex(&to)).expect("endereço 0x válido");
        s.account_mut(&from_e7).balance = 10;
        {
            let mut w = EavmWorld::new(&mut s, EAVM_VALUE_HEIGHT);
            assert!(w.move_value(&from, &to, Word::from(4u64), TransferKind::Call));
        }
        let destino = s.accounts.get(&to_e7).expect("conta creditada existe");
        assert_eq!(destino.balance, 4);
        assert!(!destino.eavm_managed, "o JS não marca eavmManaged neste caminho");
    }

    #[test]
    fn entry_nao_entra_no_rastreio_de_xfers() {
        let mut s = State::new();
        let from = addr(0x31);
        let from_e7 = eavm_to_e7(&addr_hex(&from)).expect("endereço 0x válido");
        s.account_mut(&from_e7).balance = 10;
        let mut w = EavmWorld::new_rastreando_xfers(&mut s, EAVM_VALUE_HEIGHT);
        assert!(w.move_value(&from, &addr(0x32), Word::from(3u64), TransferKind::Entry));
        assert!(w.xfers().is_empty(), "o valor da própria tx já aparece como amount");
    }

    // ----------------------------------------------------------- move_value

    #[test]
    fn move_value_sem_saldo_devolve_false_sem_mutar() {
        // Regime unificado: nenhuma conta existe.
        let mut s = State::new();
        {
            let mut w = EavmWorld::new(&mut s, EAVM_VALUE_HEIGHT);
            assert!(!w.move_value(&addr(1), &addr(2), Word::from(1u64), TransferKind::Call));
        }
        assert!(s.accounts.is_empty(), "false tem de significar ZERO mutação");
        assert!(s.contracts.is_empty());

        // Regime legado: livro do contrato (sempre 0) tampouco cobre.
        {
            let mut w = EavmWorld::new(&mut s, 0);
            assert!(!w.move_value(&addr(1), &addr(2), Word::from(1u64), TransferKind::Call));
        }
        assert!(s.contracts.is_empty());
    }

    #[test]
    fn bump_nonce_devolve_o_valor_anterior() {
        let mut s = State::new();
        let a = addr(7);
        let mut w = EavmWorld::new(&mut s, 0);
        assert_eq!(w.bump_nonce(&a), 0, "primeiro bump devolve 0 — é ele que entra no CREATE");
        assert_eq!(w.bump_nonce(&a), 1);
        let marca = w.snapshot();
        assert_eq!(w.bump_nonce(&a), 2);
        w.revert(marca);
        assert_eq!(w.bump_nonce(&a), 2, "revert restaurou o nonce");
    }

    // -------------------------------------------------------------- storage

    #[test]
    fn storage_zero_remove_a_chave_em_vez_de_gravar_zero() {
        let mut s = State::new();
        let a = addr(3);
        {
            let mut w = EavmWorld::new(&mut s, 0);
            w.set_storage(&a, Word::from(5u64), Word::from(9u64));
            w.set_storage(&a, Word::from(5u64), Word::ZERO);
        }
        let c = s.contracts.get(&addr_hex(&addr(3))).expect("contrato materializado");
        assert!(c.storage.is_empty(), "slot zerado tem de SUMIR do mapa — duas formas, duas folhas");
    }

    #[test]
    fn chave_de_slot_e_preenchida_e_valor_e_hex_minimo() {
        let mut s = State::new();
        let a = addr(4);
        {
            let mut w = EavmWorld::new(&mut s, 0);
            w.set_storage(&a, Word::from(1u64), Word::from(0x2au64));
        }
        let c = s.contracts.get(&addr_hex(&addr(4))).expect("contrato materializado");
        let chave = format!("0x{}{}", "0".repeat(63), "1"); // vm.js:107: padStart(64)
        assert_eq!(c.storage.get(&chave).map(String::as_str), Some("0x2a"),
            "valor é '0x'+toString(16) — sem zeros à esquerda (state.js:945)");
    }

    // ------------------------------------------------------ anel de blockhash

    #[test]
    fn record_block_hash_grava_no_slot_certo_e_o_anel_da_a_volta() {
        let mut s = State::new();
        let h1 = "ab".repeat(32);
        let h2 = "cd".repeat(32);

        s.record_block_hash(5, &h1);
        let c = s.contracts.get(BLOCKHASH_HISTORY_ADDR).expect("contrato do anel materializado");
        // slot em hex CURTO minúsculo — não os 64 dígitos do slotKey da VM.
        assert_eq!(c.storage.get("0x5").map(String::as_str), Some(format!("0x{h1}").as_str()));
        assert_eq!(c.code, "", "o contrato do anel nasce sem código");
        assert_eq!(c.balance, 0);

        // A volta do anel: number + 8191 cai no MESMO slot e sobrescreve.
        s.record_block_hash(5 + BLOCKHASH_HISTORY, &h2);
        let c = s.contracts.get(BLOCKHASH_HISTORY_ADDR).expect("contrato do anel");
        assert_eq!(c.storage.get("0x5").map(String::as_str), Some(format!("0x{h2}").as_str()));
        assert_eq!(c.storage.len(), 1, "mesmo slot: o anel não cresce");

        // number % 8191 == 0 → slot "0x0".
        s.record_block_hash(BLOCKHASH_HISTORY, &h1);
        let c = s.contracts.get(BLOCKHASH_HISTORY_ADDR).expect("contrato do anel");
        assert!(c.storage.contains_key("0x0"));

        // Prefixo 0x é removido e o hash baixa de caixa (state.js:1001).
        s.record_block_hash(6, &format!("0x{}", "AB".repeat(32)));
        let c = s.contracts.get(BLOCKHASH_HISTORY_ADDR).expect("contrato do anel");
        assert_eq!(c.storage.get("0x6").map(String::as_str), Some(format!("0x{h1}").as_str()));
    }

    #[test]
    fn o_mundo_le_o_anel_pelo_slot_curto() {
        let mut s = State::new();
        let h = "12".repeat(32);
        s.record_block_hash(300, &h);
        let w = EavmWorld::new(&mut s, 0);
        assert_eq!(w.block_hash(300), word_from_hex(&h));
        assert_eq!(w.block_hash(301), Word::ZERO, "altura não gravada lê zero");
    }

    // ------------------------------------------------------------- folha ctr

    #[test]
    fn folha_ctr_byte_a_byte_contra_valor_montado_a_mao() {
        // Montagem manual da codificação canônica (tag + u32BE(len) + carga),
        // para que uma regressão no to_value OU no codificador apareça aqui.
        fn u32be(n: usize) -> Vec<u8> {
            (n as u32).to_be_bytes().to_vec()
        }
        fn tag_str(s: &str) -> Vec<u8> {
            let mut v = vec![0x04];
            v.extend(u32be(s.len()));
            v.extend(s.as_bytes());
            v
        }
        fn tag_int(s: &str) -> Vec<u8> {
            let mut v = vec![0x03];
            v.extend(u32be(s.len()));
            v.extend(s.as_bytes());
            v
        }

        let slot = format!("0x{}{}", "0".repeat(63), "1");
        let mut c = Contract { code: "0x6001".to_string(), nonce: 3, ..Contract::default() };
        c.storage.insert(slot.clone(), "0x2a".to_string());

        // Mapa externo: 4 pares em ordem de byte da chave.
        let mut esperado = vec![0x06];
        esperado.extend(u32be(4));
        esperado.extend(tag_str("balance"));
        esperado.extend(tag_int("0")); // BigInt 0n → inteiro "0", NUNCA texto
        esperado.extend(tag_str("code"));
        esperado.extend(tag_str("0x6001"));
        esperado.extend(tag_str("nonce"));
        esperado.extend(tag_int("3")); // number → inteiro
        esperado.extend(tag_str("storage"));
        esperado.push(0x06); // storage é MAPA slot→texto
        esperado.extend(u32be(1));
        esperado.extend(tag_str(&slot));
        esperado.extend(tag_str("0x2a")); // valor de slot é TEXTO '0x…', não inteiro

        let obtido = encode(&c.to_value()).expect("contrato codificável");
        assert_eq!(obtido, esperado, "folha ctr divergiu byte a byte da referência");
    }

    #[test]
    fn contrato_novo_tem_a_forma_do_literal_da_referencia() {
        // { code: '', storage: {}, balance: 0n, nonce: 0 } — state.js:931/999.
        let c = Contract::default();
        assert_eq!(c.code, "");
        assert!(c.storage.is_empty());
        assert_eq!(c.balance, 0);
        assert_eq!(c.nonce, 0);
    }

    // -------------------------------------------------------------- e7 ↔ 0x

    #[test]
    fn encode_e7_dest_e_decode_e7_dest_sao_inversas() {
        let e7 = derive_address_from("VETOR:contrato");
        let enc = encode_e7_dest(&e7).expect("endereço derivado é válido");
        assert_eq!(enc.len(), 42, "cabe nos 20 bytes do campo to");
        assert!(enc.starts_with("0xe7000000"));
        assert_eq!(decode_e7_dest(&enc), Some(e7.clone()));
        // e7_of prefere o E7 embutido ao derivado por keccak.
        assert_eq!(e7_of(&enc).expect("endereço EAVM válido"), e7);
    }

    #[test]
    fn decode_e7_dest_rejeita_prefixo_ou_checksum_errado() {
        // Sem o prefixo reservado: não é destino E7 embutido.
        assert_eq!(decode_e7_dest(&format!("0x11{}", "22".repeat(19))), None);
        // Prefixo certo, corpo aleatório: o checksum embutido não valida.
        assert_eq!(decode_e7_dest(&format!("0xe7000000{}", "ab".repeat(16))), None);
        // Nem endereço EAVM é.
        assert_eq!(decode_e7_dest("0x123"), None);
        assert_eq!(decode_e7_dest("E7ALGO"), None);
    }

    #[test]
    fn eavm_to_e7_deriva_com_o_dominio_da_referencia_e_normaliza_caixa() {
        let a = format!("0xab{}", "cd".repeat(19));
        let esperado = derive_address_from(format!("EAV7-EAVM:{a}"));
        assert_eq!(eavm_to_e7(&a).expect("válido"), esperado);
        // envelope.js:51 baixa a caixa ANTES de derivar.
        assert_eq!(eavm_to_e7(&a.to_uppercase().replace("0X", "0x")).expect("válido"), esperado);
        assert!(eavm_to_e7("0x123").is_err());
    }

    #[test]
    fn e7_of_cai_para_keccak_quando_nao_ha_e7_embutido() {
        let a = format!("0x11{}", "00".repeat(19));
        assert_eq!(
            e7_of(&a).expect("válido"),
            derive_address_from(format!("EAV7-EAVM:{a}"))
        );
    }

    // ----------------------------------------------------- codeOf / callEavm

    #[test]
    fn code_of_devolve_0x_para_conta_sem_contrato_ou_sem_codigo() {
        let mut s = State::new();
        assert_eq!(s.code_of("0x0000000000000000000000000000000000000001"), "0x");
        // Contrato materializado mas com code '' (o || do JS): também '0x'.
        s.contracts.insert(BLOCKHASH_HISTORY_ADDR.to_string(), Contract::default());
        assert_eq!(s.code_of(BLOCKHASH_HISTORY_ADDR), "0x");
        // Com código: devolve a string 0x guardada, e a busca baixa a caixa.
        if let Some(c) = s.contracts.get_mut(BLOCKHASH_HISTORY_ADDR) {
            c.code = "0x6001".to_string();
        }
        assert_eq!(s.code_of(&BLOCKHASH_HISTORY_ADDR.to_uppercase().replace("0X", "0x")), "0x6001");
    }

    #[test]
    fn call_eavm_nao_muta_o_estado_e_roda_o_bytecode() {
        let mut s = State::new();
        // PUSH1 0x2a PUSH1 0x00 SSTORE  (escreve no storage…)
        // PUSH1 0x2a PUSH1 0x00 MSTORE8 PUSH1 0x01 PUSH1 0x00 RETURN (…e devolve 0x2a)
        let code = "0x602a600055602a60005360016000f3";
        let alvo = "0x00000000000000000000000000000000000000aa";
        s.contracts.insert(alvo.to_string(), Contract { code: code.to_string(), ..Contract::default() });
        let raiz_antes = s.state_leaves().expect("estado codificável");

        let r = s
            .call_eavm(EavmCallParams { to: alvo, data: "0x", ..Default::default() })
            .expect("destino válido");
        assert!(r.success);
        assert_eq!(r.return_data, "0x2a");
        assert!(r.gas_used > 0);

        // O finally: TUDO desfeito — o SSTORE não pode ter sujado o estado.
        assert_eq!(s.state_leaves().expect("estado codificável"), raiz_antes,
            "eth_call jamais pode alterar o stateRoot");
    }

    #[test]
    fn call_eavm_rejeita_destino_invalido_e_normaliza_caixa() {
        let mut s = State::new();
        assert!(s.call_eavm(EavmCallParams { to: "0x123", data: "0x", ..Default::default() }).is_err());
        assert!(s.call_eavm(EavmCallParams { to: "não é endereço", data: "0x", ..Default::default() }).is_err());
        // Caixa alta é baixada antes da regex (state.js:1016): aceita.
        let alvo = "0x00000000000000000000000000000000000000AB";
        let r = s.call_eavm(EavmCallParams { to: alvo, data: "0x", ..Default::default() }).expect("normalizado");
        // Conta sem código: a VM roda código vazio e retorna sucesso vazio.
        assert!(r.success);
        assert_eq!(r.return_data, "0x");
    }

    // ------------------------------------------------------------ auxiliares

    #[test]
    fn word_hex_min_e_o_to_string_16_do_js() {
        assert_eq!(word_hex_min(&Word::from(0x2au64)), "0x2a");
        assert_eq!(word_hex_min(&Word::from(1u64)), "0x1");
        assert_eq!(word_hex_min(&Word::ZERO), "0x0");
        assert_eq!(word_from_hex("0x2a"), Word::from(0x2au64));
        assert_eq!(word_from_hex("lixo"), Word::ZERO);
    }

    #[test]
    fn buffer_from_hex_imita_o_buffer_do_node() {
        assert_eq!(buffer_from_hex("0x4a7b"), vec![0x4a, 0x7b]);
        assert_eq!(buffer_from_hex("4a7b"), vec![0x4a, 0x7b]);
        // Par inválido interrompe; nibble solto é ignorado — como Buffer.from.
        assert_eq!(buffer_from_hex("0x4azz7b"), vec![0x4a]);
        assert_eq!(buffer_from_hex("0x4a7"), vec![0x4a]);
        assert!(buffer_from_hex("0x").is_empty());
    }
    /// Ida e volta com todos os campos preenchidos e distintos.
    #[test]
    fn contrato_sobrevive_a_ida_e_volta() {
        let c = Contract {
            code: "0x6080".into(),
            storage: [
                ("0x00".to_string(), "0x1".to_string()),
                ("0x01".to_string(), "0xdeadbeef".to_string()),
            ]
            .into(),
            balance: 0,
            nonce: 3,
        };
        assert_eq!(Contract::from_value(&c.to_value()), Some(c));
    }

    #[test]
    fn contrato_com_storage_nao_textual_e_recusado() {
        let Value::Map(mut m) = Contract::default().to_value() else { panic!("mapa") };
        m.insert("storage".into(), Value::Map([("0x00".to_string(), Value::uint(1u128))].into()));
        assert_eq!(Contract::from_value(&Value::Map(m)), None);
        assert_eq!(Contract::from_value(&Value::str("nao é mapa")), None);
    }
}
