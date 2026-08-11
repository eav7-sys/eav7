//! Interpretador da EAVM.
//!
//! Port fiel de `src/eavm/vm.js`. "Fiel" aqui não é elogio ao estilo: o gás é
//! CONSENSO. Um cliente que produza o mesmo retorno cobrando gás diferente
//! aceita um bloco que a rede rejeita (ou o contrário) e cinde a cadeia. Por
//! isso cada custo abaixo espelha a tabela `GAS` da referência byte a byte, e
//! `vectors/evm.json` traz o gás consumido de cada programa como juiz.
//!
//! Onde a referência diverge do EVM canônico (há pelo menos um caso — ver
//! `MSIZE`), este arquivo reproduz a REFERÊNCIA e diz por quê no comentário.
//! Consertar a divergência aqui, sozinho, seria criar a cisão que o port existe
//! para evitar.
//!
//! O acesso ao "mundo" (storage, código, saldo, chamadas, criação) sai pelo
//! trait [`Host`]. Este módulo não conhece o `state`.

use std::collections::{BTreeMap, HashSet};

use sha3::{Digest, Keccak256};

/// A palavra da EAVM.
///
/// `ruint` e não aritmética artesanal: a justificativa está na política de
/// dependências do `Cargo.toml`. É a mesma `U256` que o `revm` usa para executar
/// mainnet Ethereum.
pub type Word = ruint::aliases::U256;

/// Endereço de 20 bytes.
///
/// A referência carrega endereço como string `"0x…"` minúscula. Aqui são bytes:
/// string obriga a normalizar caixa em todo ponto de comparação, e uma
/// normalização esquecida vira dois endereços distintos para a mesma conta.
pub type Address = [u8; 20];

const ZERO_ADDR: Address = [0u8; 20];

// ---------------------------------------------------------------- tabela de gás
//
// Espelha `GAS` em `src/eavm/vm.js`. Não "arredonde" nada aqui.

const GAS_BASE: u64 = 2;
const GAS_VERYLOW: u64 = 3;
const GAS_LOW: u64 = 5;
const GAS_MID: u64 = 8;
const GAS_HIGH: u64 = 10;
const GAS_KECCAK: u64 = 30;
const GAS_KECCAK_WORD: u64 = 6;
const GAS_SLOAD: u64 = 100;
const GAS_SSTORE_SET: u64 = 2000;
const GAS_SSTORE_RESET: u64 = 800;
const GAS_MEM_WORD: u64 = 3;
const GAS_COPY_WORD: u64 = 3;
const GAS_LOG: u64 = 375;
const GAS_LOG_TOPIC: u64 = 375;
const GAS_LOG_DATA: u64 = 8;
const GAS_JUMPDEST: u64 = 1;
/// EIP-1153: transiente é sempre "quente" e não toca estado permanente.
const GAS_SLOAD_TRANSIENT: u64 = 100;
const GAS_SSTORE_TRANSIENT: u64 = 100;
const GAS_CALL: u64 = 100;
/// Financia o estipêndio de 2300 encaminhado à sub-chamada, como no EVM.
const GAS_CALL_VALUE: u64 = 9000;
const GAS_CREATE: u64 = 3200;
const GAS_EXTCODE: u64 = 100;
/// Custo por byte de código depositado. Cobrado pelo host na criação, não aqui —
/// declarado para a tabela ficar completa e o host não reinventar o número.
pub const GAS_CODE_DEPOSIT_BYTE: u64 = 20;

/// Altura do fork de Osaka. Espelha `CHAIN.EAVM_OSAKA_HEIGHT` em `src/config.js`.
///
/// Vem de `crate::config` (gerado de `src/config.js` — fonte única), e ALIMENTA
/// [`ExecParams::osaka_height`]: o conjunto de precompiles de um bloco tem de ser
/// função do BLOCO, não da configuração de quem o executa.
pub const EAVM_OSAKA_HEIGHT: u64 = crate::config::EAVM_OSAKA_HEIGHT;

/// Profundidade máxima de chamadas.
///
/// A referência a mantém MUITO abaixo do limite de pilha do V8 para que o limite
/// determinístico dispare antes de qualquer stack-overflow dependente do
/// ambiente. O mesmo raciocínio vale aqui, por outro motivo: um interpretador
/// recursivo em Rust estoura a pilha do SO, e o tamanho de pilha varia por
/// thread e por plataforma — seria não-determinismo puro (achado M-1).
///
/// Quem faz valer o limite é o host, no `call`/`create`, como na referência.
///
/// O limite garante DETERMINISMO — não que a pilha nativa caiba. Isso é
/// orçamento do processo, e está fixado em `eav7-node` (`PILHA_POR_WORKER`), com
/// o teste `recursao_no_limite_cabe_no_orcamento_de_pilha` medindo o consumo real
/// desta base. Subir este número exige subir aquele.
pub const MAX_CALL_DEPTH: u32 = 128;

/// Teto de expansão de memória, em bytes. Anti-OOM, igual à referência.
const LIMITE_MEMORIA: u128 = 100_000_000;

const LIMITE_PILHA: usize = 1024;

// ------------------------------------------------------------------------ erros

/// Falha de execução de um frame.
///
/// Tudo o que a referência lança como `EavmError` cai aqui. Nada disso é pânico:
/// um pânico em caminho de consenso é um nó derrubado por bytecode hostil — DoS
/// com custo de uma transação.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EavmError {
    SemGas,
    PilhaCheia,
    PilhaVazia,
    MemoriaExcessiva,
    JumpInvalido(usize),
    RetornoForaDosLimites,
    OpcodeInvalido(u8),
    OpcodeDesconhecido(u8),
    /// Opcode existe, mas não neste nível de fork. É o que impede este cliente de
    /// aceitar bytecode que a rede rejeita na altura em questão.
    OpcodeForaDoFork(u8),
    /// Escrita (SSTORE/TSTORE/LOG/CREATE/transferência) dentro de STATICCALL.
    EscritaEmChamadaEstatica(u8),
    SelfdestructNaoSuportado,
    /// Modo contrato-único: não há mundo para chamar.
    HostIndisponivel(&'static str),
    /// Erro vindo do host (profundidade, saldo, snapshot…).
    Host(String),
}

impl std::fmt::Display for EavmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EavmError::SemGas => write!(f, "sem gás (energia insuficiente)"),
            EavmError::PilhaCheia => write!(f, "stack overflow"),
            EavmError::PilhaVazia => write!(f, "stack underflow"),
            EavmError::MemoriaExcessiva => write!(f, "expansão de memória excessiva"),
            EavmError::JumpInvalido(d) => write!(f, "JUMP inválido para {d}"),
            EavmError::RetornoForaDosLimites => write!(f, "RETURNDATACOPY fora dos limites"),
            EavmError::OpcodeInvalido(op) => write!(f, "opcode inválido (0x{op:02x})"),
            EavmError::OpcodeDesconhecido(op) => write!(f, "opcode desconhecido: 0x{op:02x}"),
            EavmError::OpcodeForaDoFork(op) => {
                write!(f, "opcode 0x{op:02x} inválido nesta altura")
            }
            EavmError::EscritaEmChamadaEstatica(op) => {
                write!(f, "opcode 0x{op:02x} proibido em chamada estática")
            }
            EavmError::SelfdestructNaoSuportado => write!(f, "SELFDESTRUCT não suportado"),
            EavmError::HostIndisponivel(o) => write!(f, "{o} indisponível sem host de estado"),
            EavmError::Host(m) => write!(f, "host: {m}"),
        }
    }
}
impl std::error::Error for EavmError {}

type R<T> = Result<T, EavmError>;

// ------------------------------------------------------------------ o host

/// Um evento emitido por LOG0..LOG4.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Log {
    pub address: Address,
    pub topics: Vec<Word>,
    pub data: Vec<u8>,
}

/// Qual das quatro instruções de chamada originou a sub-chamada.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallKind {
    Call,
    CallCode,
    DelegateCall,
    StaticCall,
}

/// Pedido de sub-chamada entregue ao host.
///
/// Os campos `exec_*` já vêm RESOLVIDOS pelo interpretador — DELEGATECALL e
/// CALLCODE executam código de outro endereço no contexto (storage, `ADDRESS`)
/// do chamador, e essa resolução é regra de VM, não de estado. Deixá-la para o
/// host seria espalhar a semântica por dois módulos.
#[derive(Debug, Clone)]
pub struct CallRequest {
    pub kind: CallKind,
    /// Quem executa a instrução de chamada (o `self` do frame atual).
    pub caller: Address,
    pub to: Address,
    pub value: Word,
    pub input: Vec<u8>,
    pub gas: u64,
    pub is_static: bool,
    pub delegate: bool,
    /// De onde sai o CÓDIGO a executar.
    pub code_addr: Address,
    /// Sob qual conta o código roda (storage e `ADDRESS`).
    pub exec_address: Address,
    /// O que a sub-chamada verá em `CALLER`.
    pub exec_caller: Address,
    /// O que a sub-chamada verá em `CALLVALUE`.
    pub exec_value: Word,
    pub depth: u32,
    pub block: BlockContext,
    pub origin: Address,
    pub gas_price: Word,
}

/// Pedido de criação (CREATE/CREATE2).
#[derive(Debug, Clone)]
pub struct CreateRequest {
    pub caller: Address,
    pub value: Word,
    pub init_code: Vec<u8>,
    pub gas: u64,
    /// `Some` em CREATE2, `None` em CREATE.
    pub salt: Option<Word>,
    pub depth: u32,
    pub block: BlockContext,
    pub origin: Address,
    pub gas_price: Word,
}

/// Resultado de uma sub-chamada.
///
/// `gas_used` é o que o frame pai desconta. Não é opcional: um host que devolva
/// 0 aqui deixa a sub-chamada de graça e quebra a contabilidade do bloco inteiro.
#[derive(Debug, Clone, Default)]
pub struct CallOutcome {
    pub success: bool,
    pub return_data: Vec<u8>,
    pub gas_used: u64,
    /// Logs da sub-chamada. O pai os MESCLA (achado H-1): descartá-los aqui faria
    /// o recibo do bloco perder eventos e mudar o receiptsRoot.
    pub logs: Vec<Log>,
}

/// Resultado de uma criação.
#[derive(Debug, Clone, Default)]
pub struct CreateOutcome {
    pub success: bool,
    pub address: Address,
    pub return_data: Vec<u8>,
    pub gas_used: u64,
    pub logs: Vec<Log>,
}

/// Acesso ao mundo exterior à VM.
///
/// Implementado pelo `state` (com journaling, para reverter sub-chamadas que
/// falham). Este módulo não depende do `state` — só deste trait.
pub trait Host {
    fn sload(&self, addr: &Address, key: &Word) -> Word;
    fn sstore(&mut self, addr: &Address, key: Word, value: Word) -> R<()>;

    /// Storage TRANSIENTE (EIP-1153): vive só dentro da transação e some no fim.
    /// NÃO entra no `stateRoot` — se entrar, o root diverge de todo nó correto.
    fn tload(&self, addr: &Address, key: &Word) -> Word;
    fn tstore(&mut self, addr: &Address, key: Word, value: Word) -> R<()>;

    fn balance(&self, addr: &Address) -> Word;
    fn code(&self, addr: &Address) -> Vec<u8>;

    /// BLOCKHASH: anel de histórico do estado (EIP-2935). `n` é a altura pedida,
    /// `atual` a do bloco em execução. FORA da janela de 256 devolve zero — e o
    /// zero tem de vir do host, não de um cache local do nó, senão dois nós com
    /// históricos podados diferentes computam contratos diferentes.
    fn block_hash(&self, _n: Word, _atual: u64) -> Word {
        Word::ZERO
    }

    fn call(&mut self, _req: CallRequest) -> R<CallOutcome> {
        Err(EavmError::HostIndisponivel("CALL"))
    }
    fn create(&mut self, _req: CreateRequest) -> R<CreateOutcome> {
        Err(EavmError::HostIndisponivel("CREATE"))
    }
}

/// Host mínimo de contrato único, para testes de opcode que não exercem
/// CALL/CREATE. Equivale ao `simpleHost` da referência, mais o storage
/// transiente que o host real fornece (sem ele, TLOAD/TSTORE não teriam onde
/// escrever).
#[derive(Debug, Default, Clone)]
pub struct SimpleHost {
    pub storage: BTreeMap<Word, Word>,
    pub transient: BTreeMap<Word, Word>,
}

impl Host for SimpleHost {
    fn sload(&self, _a: &Address, key: &Word) -> Word {
        self.storage.get(key).copied().unwrap_or(Word::ZERO)
    }
    fn sstore(&mut self, _a: &Address, key: Word, value: Word) -> R<()> {
        // Zero APAGA em vez de gravar zero: gravar zero deixaria uma chave
        // presente-com-valor-zero, indistinguível em leitura mas distinta na
        // serialização do estado. A referência apaga; apagamos também.
        if value.is_zero() {
            self.storage.remove(&key);
        } else {
            self.storage.insert(key, value);
        }
        Ok(())
    }
    fn tload(&self, _a: &Address, key: &Word) -> Word {
        self.transient.get(key).copied().unwrap_or(Word::ZERO)
    }
    fn tstore(&mut self, _a: &Address, key: Word, value: Word) -> R<()> {
        if value.is_zero() {
            self.transient.remove(&key);
        } else {
            self.transient.insert(key, value);
        }
        Ok(())
    }
    fn balance(&self, _a: &Address) -> Word {
        Word::ZERO
    }
    fn code(&self, _a: &Address) -> Vec<u8> {
        Vec::new()
    }
}

// -------------------------------------------------------------- entrada e saída

/// Contexto do bloco visível ao bytecode.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BlockContext {
    pub number: u64,
    pub timestamp: u64,
    pub gas_limit: u64,
    pub chain_id: u64,
}

/// Parâmetros de execução de um frame.
#[derive(Debug, Clone)]
pub struct ExecParams {
    pub code: Vec<u8>,
    pub calldata: Vec<u8>,
    pub gas: u64,
    pub caller: Address,
    pub address: Address,
    /// `None` herda de `caller`, como na referência.
    pub origin: Option<Address>,
    pub value: Word,
    pub block: BlockContext,
    pub gas_price: Word,
    pub depth: u32,
    pub is_static: bool,
    /// Altura do fork de Osaka. Sai daqui e não de config do nó porque um nó com
    /// flag diferente executaria bytecode diferente sobre o MESMO bloco — cisão
    /// de consenso silenciosa.
    pub osaka_height: u64,
}

impl Default for ExecParams {
    fn default() -> Self {
        Self {
            code: Vec::new(),
            calldata: Vec::new(),
            gas: 0,
            caller: ZERO_ADDR,
            address: ZERO_ADDR,
            origin: None,
            value: Word::ZERO,
            block: BlockContext::default(),
            gas_price: Word::ZERO,
            depth: 0,
            is_static: false,
            osaka_height: EAVM_OSAKA_HEIGHT,
        }
    }
}

/// Saída de um frame.
///
/// `success == false` é REVERT — execução normal que desfaz o estado e devolve
/// dados. Falha dura (sem gás, opcode inválido) é `Err`, como na referência, que
/// lança `EavmError` nesses casos e retorna `{success:false}` no REVERT.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExecResult {
    pub success: bool,
    pub return_data: Vec<u8>,
    pub gas_used: u64,
    pub gas_left: u64,
    pub logs: Vec<Log>,
}

// ------------------------------------------------------- aritmética com sinal
//
// A referência converte para BigInt COM SINAL e deixa o JS decidir. Em Rust a
// conversão é explícita, e cada caso de borda abaixo é um lugar onde um port
// ingênuo erra em silêncio.

#[inline]
fn negativo(x: &Word) -> bool {
    x.bit(255)
}

/// Complemento de dois. `neg(MIN) == MIN`, e é isso que o EVM define.
#[inline]
fn neg(x: Word) -> Word {
    (!x).wrapping_add(Word::from(1u64))
}

#[inline]
fn abs(x: Word) -> Word {
    if negativo(&x) { neg(x) } else { x }
}

/// `a < b` com sinal.
fn slt(a: &Word, b: &Word) -> bool {
    match (negativo(a), negativo(b)) {
        (true, false) => true,
        (false, true) => false,
        _ => a < b, // mesmo sinal: a ordem sem sinal coincide com a ordem com sinal
    }
}

/// SDIV. Divisão por zero é 0 (não erro), e `MIN / -1` transborda de volta para
/// `MIN` — os dois casos que quebram um port feito com `i128` no meio.
fn sdiv(a: Word, b: Word) -> Word {
    if b.is_zero() {
        return Word::ZERO;
    }
    let (na, nb) = (negativo(&a), negativo(&b));
    let q = abs(a) / abs(b);
    if na != nb { neg(q) } else { q }
}

/// SMOD. O resto segue o sinal do DIVIDENDO (truncamento para zero), que é o que
/// o `%` de BigInt do JS faz — e não a semântica de piso de outras linguagens.
fn smod(a: Word, b: Word) -> Word {
    if b.is_zero() {
        return Word::ZERO;
    }
    let na = negativo(&a);
    let r = abs(a) % abs(b);
    if na { neg(r) } else { r }
}

/// SAR: deslocamento à direita ARITMÉTICO (preenche com o bit de sinal).
fn sar(shift: Word, value: Word) -> Word {
    let neg_v = negativo(&value);
    if shift >= Word::from(256u64) {
        return if neg_v { Word::MAX } else { Word::ZERO };
    }
    let s: usize = shift.to::<u64>() as usize;
    let logico = value >> s;
    if neg_v && s > 0 {
        // preenche os `s` bits do topo com 1
        logico | (Word::MAX << (256 - s))
    } else {
        logico
    }
}

/// SIGNEXTEND: estende o sinal do byte de índice `b` (contado do menos
/// significativo) para toda a palavra.
fn signextend(b: Word, x: Word) -> Word {
    if b >= Word::from(32u64) {
        return x;
    }
    let bit = b.to::<u64>() as usize * 8 + 7;
    let mask = (Word::from(1u64) << bit).wrapping_sub(Word::from(1u64));
    if x.bit(bit) { x | !mask } else { x & mask }
}

/// Exponenciação módulo 2²⁵⁶ por quadrados sucessivos.
///
/// Escrita à mão e não com `Uint::pow` de propósito: o `pow` do `ruint` tem
/// comportamento de transbordo dependente de perfil de compilação, e o
/// interpretador PRECISA embrulhar em release e em debug do mesmo jeito.
fn exp_mod2_256(mut base: Word, mut exp: Word) -> Word {
    let mut r = Word::from(1u64);
    while !exp.is_zero() {
        if exp.bit(0) {
            r = r.wrapping_mul(base);
        }
        base = base.wrapping_mul(base);
        exp >>= 1usize;
    }
    r
}

// ------------------------------------------------------------------- conversões

/// `u128` saturado. Saturar (em vez de truncar) é o que faz um deslocamento
/// absurdo virar erro de memória em vez de um índice pequeno por acidente.
#[inline]
fn u128_sat(w: &Word) -> u128 {
    if w.bit_len() > 128 { u128::MAX } else { w.to::<u128>() }
}

#[inline]
fn u64_sat(w: &Word) -> u64 {
    if w.bit_len() > 64 { u64::MAX } else { w.to::<u64>() }
}

#[inline]
fn usize_sat(w: &Word) -> usize {
    let v = u128_sat(w);
    if v > usize::MAX as u128 { usize::MAX } else { v as usize }
}

fn word_de_bytes(b: &[u8]) -> Word {
    // `from_be_slice` do ruint aceita até 32 bytes; acima disso entraria em
    // pânico. Todos os chamadores aqui passam no máximo 32, mas o corte explícito
    // torna isso verdade por construção e não por inspeção.
    let b = if b.len() > 32 { &b[b.len() - 32..] } else { b };
    Word::from_be_slice(b)
}

fn word_de_endereco(a: &Address) -> Word {
    Word::from_be_slice(a)
}

fn endereco_de_word(w: &Word) -> Address {
    let bytes = w.to_be_bytes::<32>();
    let mut a = [0u8; 20];
    a.copy_from_slice(&bytes[12..]); // os 160 bits baixos
    a
}

/// Pré-varredura dos destinos válidos de salto.
///
/// O pulo do gato é o `else`: um byte 0x5b DENTRO do imediato de um PUSH não é
/// JUMPDEST. Sem esse salto, dado que por acaso valesse 0x5b viraria destino
/// legítimo e o bytecode teria fluxo que nenhum outro cliente aceita.
fn analisa_jumpdests(code: &[u8]) -> HashSet<usize> {
    let mut set = HashSet::new();
    let mut i = 0usize;
    while i < code.len() {
        let op = code[i];
        if op == 0x5b {
            set.insert(i);
        } else if (0x60..=0x7f).contains(&op) {
            i += (op - 0x5f) as usize;
        }
        i += 1;
    }
    set
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut h = Keccak256::new();
    h.update(data);
    h.finalize().into()
}

// ------------------------------------------------------------------ o intérprete

struct Interp<'a, H: Host + ?Sized> {
    host: &'a mut H,
    code: Vec<u8>,
    calldata: Vec<u8>,
    jumpdests: HashSet<usize>,

    stack: Vec<Word>,
    /// Buffer FÍSICO. `mem.len()` é a capacidade, que cresce DOBRANDO — e é o que
    /// `MSIZE` devolve. Ver o comentário do opcode 0x59.
    mem: Vec<u8>,
    /// Tamanho LÓGICO em palavras. É esta a base do gás, separada da capacidade:
    /// cobrar sobre a capacidade faria o gás depender da estratégia de
    /// realocação, que não é protocolo.
    mem_words: u64,
    pc: usize,
    gas_inicial: u64,
    gas_left: u64,
    last_return: Vec<u8>,
    logs: Vec<Log>,

    self_addr: Address,
    caller: Address,
    origin: Address,
    value: Word,
    gas_price: Word,
    block: BlockContext,
    depth: u32,
    is_static: bool,
    osaka: bool,
}

impl<H: Host + ?Sized> Interp<'_, H> {
    // -- pilha e gás -------------------------------------------------------

    #[inline]
    fn spend(&mut self, g: u64) -> R<()> {
        if g > self.gas_left {
            return Err(EavmError::SemGas);
        }
        self.gas_left -= g;
        Ok(())
    }

    #[inline]
    fn push(&mut self, v: Word) -> R<()> {
        if self.stack.len() >= LIMITE_PILHA {
            return Err(EavmError::PilhaCheia);
        }
        self.stack.push(v);
        Ok(())
    }

    #[inline]
    fn pop(&mut self) -> R<Word> {
        self.stack.pop().ok_or(EavmError::PilhaVazia)
    }

    #[inline]
    fn peek(&self, n: usize) -> R<Word> {
        if self.stack.len() <= n {
            return Err(EavmError::PilhaVazia);
        }
        Ok(self.stack[self.stack.len() - 1 - n])
    }

    /// Gás de cópia: 3 por palavra de 32 bytes, arredondando para cima.
    ///
    /// Saturado de ponta a ponta: um `size` absurdo tem de virar SEM GÁS, nunca
    /// um custo pequeno por transbordo — que seria cópia gigante paga a preço de
    /// banana, exatamente o achado H-2.
    fn gas_copia(size: u64) -> u64 {
        GAS_COPY_WORD.saturating_mul(size.div_ceil(32))
    }

    // -- memória -----------------------------------------------------------

    fn mem_expand(&mut self, offset: &Word, size: &Word) -> R<()> {
        if size.is_zero() {
            return Ok(()); // tamanho zero não expande nem cobra, como na referência
        }
        let fim = u128_sat(offset).saturating_add(u128_sat(size));
        if fim > LIMITE_MEMORIA {
            return Err(EavmError::MemoriaExcessiva);
        }
        let words = (fim.div_ceil(32)) as u64;
        if words > self.mem_words {
            // termo quadrático do EVM: 3w + w²/512, cobrado sobre o CRESCIMENTO
            let custo = |w: u64| GAS_MEM_WORD * w + (w * w) / 512;
            let delta = custo(words) - custo(self.mem_words);
            self.spend(delta)?;
            self.mem_words = words;
        }
        let fim = fim as usize;
        if fim > self.mem.len() {
            // Realoca DOBRANDO, só quando estoura a capacidade física. Crescer de
            // palavra em palavra seria O(n²) de memcpy não coberto por gás (H-2).
            let novo = std::cmp::max(words as usize * 32, self.mem.len() * 2);
            self.mem.resize(novo, 0);
        }
        Ok(())
    }

    fn mem_write(&mut self, offset: &Word, bytes: &[u8]) -> R<()> {
        let n = Word::from(bytes.len() as u64);
        self.mem_expand(offset, &n)?;
        if bytes.is_empty() {
            return Ok(());
        }
        let o = usize_sat(offset);
        self.mem[o..o + bytes.len()].copy_from_slice(bytes);
        Ok(())
    }

    fn mem_read(&mut self, offset: &Word, size: &Word) -> R<Vec<u8>> {
        self.mem_expand(offset, size)?;
        if size.is_zero() {
            return Ok(Vec::new());
        }
        let (o, s) = (usize_sat(offset), usize_sat(size));
        Ok(self.mem[o..o + s].to_vec())
    }

    /// Cópia fonte→memória SEM alocar um temporário do tamanho de `size`.
    ///
    /// Expande (o que aplica o teto anti-OOM e o gás quadrático) ANTES de copiar
    /// e depois copia só o que a fonte tem — o resto fica zero, que é a semântica
    /// do EVM para leitura além do fim.
    fn copia_para_mem(&mut self, dest: &Word, src: &[u8], src_off: usize, size: usize) -> R<()> {
        self.mem_expand(dest, &Word::from(size as u64))?;
        if size == 0 {
            return Ok(());
        }
        let d = usize_sat(dest);
        let fim = src_off.saturating_add(size).min(src.len());
        if fim > src_off {
            let n = fim - src_off;
            self.mem[d..d + n].copy_from_slice(&src[src_off..fim]);
        }
        Ok(())
    }

    // -- laço principal ----------------------------------------------------

    fn executa(&mut self) -> R<ExecResult> {
        while self.pc < self.code.len() {
            let op = self.code[self.pc];
            let mut np = self.pc + 1;

            match op {
                // ---------------------------------------------- 0x00 parada
                0x00 => return Ok(self.done(true, Vec::new())),

                // ---------------------------------------- 0x01..0x0b aritmética
                0x01 => {
                    self.spend(GAS_VERYLOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(a.wrapping_add(b))?;
                }
                0x02 => {
                    self.spend(GAS_LOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(a.wrapping_mul(b))?;
                }
                0x03 => {
                    // SUB embrulha em 2²⁵⁶. `0 - 1` é MAX, não erro — e é isso que
                    // o vetor "SUB com underflow" fixa.
                    self.spend(GAS_VERYLOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(a.wrapping_sub(b))?;
                }
                0x04 => {
                    // Divisão por zero é ZERO, não erro. Um port que use o `/` do
                    // Rust direto entra em pânico aqui — DoS por bytecode.
                    self.spend(GAS_LOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(if b.is_zero() { Word::ZERO } else { a / b })?;
                }
                0x05 => {
                    self.spend(GAS_LOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(sdiv(a, b))?;
                }
                0x06 => {
                    self.spend(GAS_LOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(if b.is_zero() { Word::ZERO } else { a % b })?;
                }
                0x07 => {
                    self.spend(GAS_LOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(smod(a, b))?;
                }
                0x08 => {
                    // ADDMOD soma em precisão PLENA antes do módulo: `(a+b) % n`
                    // com a soma embrulhada daria outro resultado.
                    self.spend(GAS_MID)?;
                    let (a, b, n) = (self.pop()?, self.pop()?, self.pop()?);
                    self.push(if n.is_zero() { Word::ZERO } else { a.add_mod(b, n) })?;
                }
                0x09 => {
                    self.spend(GAS_MID)?;
                    let (a, b, n) = (self.pop()?, self.pop()?, self.pop()?);
                    self.push(if n.is_zero() { Word::ZERO } else { a.mul_mod(b, n) })?;
                }
                0x0a => {
                    // EXP: 10 + 50 por BYTE do expoente. O tamanho em bytes é o do
                    // expoente SEM zeros à esquerda — cobrar sobre 32 fixos mudaria
                    // o gás de todo contrato que exponencia.
                    let (a, e) = (self.pop()?, self.pop()?);
                    let bytes_exp = if e.is_zero() { 0 } else { e.bit_len().div_ceil(8) } as u64;
                    self.spend(GAS_HIGH + 50 * bytes_exp)?;
                    self.push(exp_mod2_256(a, e))?;
                }
                0x0b => {
                    self.spend(GAS_LOW)?;
                    let (b, x) = (self.pop()?, self.pop()?);
                    self.push(signextend(b, x))?;
                }

                // ------------------------------------ 0x10..0x1d comparação/bits
                0x10 => {
                    self.spend(GAS_VERYLOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(Word::from((a < b) as u64))?;
                }
                0x11 => {
                    self.spend(GAS_VERYLOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(Word::from((a > b) as u64))?;
                }
                0x12 => {
                    self.spend(GAS_VERYLOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(Word::from(slt(&a, &b) as u64))?;
                }
                0x13 => {
                    self.spend(GAS_VERYLOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(Word::from(slt(&b, &a) as u64))?;
                }
                0x14 => {
                    self.spend(GAS_VERYLOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(Word::from((a == b) as u64))?;
                }
                0x15 => {
                    self.spend(GAS_VERYLOW)?;
                    let a = self.pop()?;
                    self.push(Word::from(a.is_zero() as u64))?;
                }
                0x16 => {
                    self.spend(GAS_VERYLOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(a & b)?;
                }
                0x17 => {
                    self.spend(GAS_VERYLOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(a | b)?;
                }
                0x18 => {
                    self.spend(GAS_VERYLOW)?;
                    let (a, b) = (self.pop()?, self.pop()?);
                    self.push(a ^ b)?;
                }
                0x19 => {
                    self.spend(GAS_VERYLOW)?;
                    let a = self.pop()?;
                    self.push(!a)?;
                }
                0x1a => {
                    self.spend(GAS_VERYLOW)?;
                    let (i, x) = (self.pop()?, self.pop()?);
                    let v = if i >= Word::from(32u64) {
                        Word::ZERO
                    } else {
                        // byte 0 é o MAIS significativo
                        let sh = 8 * (31 - u64_sat(&i)) as usize;
                        (x >> sh) & Word::from(0xffu64)
                    };
                    self.push(v)?;
                }
                0x1b => {
                    // Deslocamento >= 256 é ZERO, não comportamento indefinido: o
                    // `<<` do Rust com deslocamento fora da faixa entra em pânico.
                    self.spend(GAS_VERYLOW)?;
                    let (s, v) = (self.pop()?, self.pop()?);
                    let r = if s >= Word::from(256u64) {
                        Word::ZERO
                    } else {
                        v << (u64_sat(&s) as usize)
                    };
                    self.push(r)?;
                }
                0x1c => {
                    self.spend(GAS_VERYLOW)?;
                    let (s, v) = (self.pop()?, self.pop()?);
                    let r = if s >= Word::from(256u64) {
                        Word::ZERO
                    } else {
                        v >> (u64_sat(&s) as usize)
                    };
                    self.push(r)?;
                }
                0x1d => {
                    self.spend(GAS_VERYLOW)?;
                    let (s, v) = (self.pop()?, self.pop()?);
                    self.push(sar(s, v))?;
                }

                // CLZ (Osaka, EIP-7939). Zeros à esquerda numa palavra de 256 bits.
                // ZERO devolve 256 — é o que a especificação define, e é o caso que
                // um port com `bit_len()` cru erra.
                0x1e => {
                    self.spend(GAS_LOW)?;
                    self.exige_osaka(op)?;
                    let v = self.pop()?;
                    self.push(Word::from(v.leading_zeros() as u64))?;
                }

                // --------------------------------------------------- 0x20 KECCAK
                0x20 => {
                    self.spend(GAS_KECCAK)?;
                    let (o, l) = (self.pop()?, self.pop()?);
                    self.spend(GAS_KECCAK_WORD.saturating_mul(u64_sat(&l).div_ceil(32)))?;
                    let dados = self.mem_read(&o, &l)?;
                    self.push(word_de_bytes(&keccak256(&dados)))?;
                }

                // ----------------------------------- 0x30..0x3f contexto e código
                0x30 => {
                    self.spend(GAS_BASE)?;
                    let a = word_de_endereco(&self.self_addr);
                    self.push(a)?;
                }
                0x31 => {
                    self.spend(GAS_EXTCODE)?;
                    let a = endereco_de_word(&self.pop()?);
                    let b = self.host.balance(&a);
                    self.push(b)?;
                }
                0x32 => {
                    self.spend(GAS_BASE)?;
                    let a = word_de_endereco(&self.origin);
                    self.push(a)?;
                }
                0x33 => {
                    self.spend(GAS_BASE)?;
                    let a = word_de_endereco(&self.caller);
                    self.push(a)?;
                }
                0x34 => {
                    self.spend(GAS_BASE)?;
                    self.push(self.value)?;
                }
                0x35 => {
                    // CALLDATALOAD: 32 bytes a partir de `i`, com ZERO à direita
                    // além do fim. Ler fora não é erro — é o padrão de todo ABI
                    // decoder, que lê 32 bytes de um calldata mais curto.
                    self.spend(GAS_VERYLOW)?;
                    let i = usize_sat(&self.pop()?);
                    let mut buf = [0u8; 32];
                    if i < self.calldata.len() {
                        let fim = (i + 32).min(self.calldata.len());
                        buf[..fim - i].copy_from_slice(&self.calldata[i..fim]);
                    }
                    self.push(word_de_bytes(&buf))?;
                }
                0x36 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::from(self.calldata.len() as u64))?;
                }
                0x37 => {
                    self.spend(GAS_VERYLOW)?;
                    let (d, o, s) = (self.pop()?, self.pop()?, self.pop()?);
                    let (o, s) = (usize_sat(&o), u64_sat(&s));
                    self.spend(Self::gas_copia(s))?;
                    let cd = std::mem::take(&mut self.calldata);
                    let r = self.copia_para_mem(&d, &cd, o, s as usize);
                    self.calldata = cd;
                    r?;
                }
                0x38 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::from(self.code.len() as u64))?;
                }
                0x39 => {
                    self.spend(GAS_VERYLOW)?;
                    let (d, o, s) = (self.pop()?, self.pop()?, self.pop()?);
                    let (o, s) = (usize_sat(&o), u64_sat(&s));
                    self.spend(Self::gas_copia(s))?;
                    let code = std::mem::take(&mut self.code);
                    let r = self.copia_para_mem(&d, &code, o, s as usize);
                    self.code = code;
                    r?;
                }
                0x3a => {
                    self.spend(GAS_BASE)?;
                    self.push(self.gas_price)?;
                }
                0x3b => {
                    self.spend(GAS_EXTCODE)?;
                    let a = endereco_de_word(&self.pop()?);
                    let n = self.host.code(&a).len() as u64;
                    self.push(Word::from(n))?;
                }
                0x3c => {
                    self.spend(GAS_EXTCODE)?;
                    let a = endereco_de_word(&self.pop()?);
                    let (d, o, s) = (self.pop()?, self.pop()?, self.pop()?);
                    let (o, s) = (usize_sat(&o), u64_sat(&s));
                    self.spend(Self::gas_copia(s))?;
                    let ec = self.host.code(&a);
                    self.copia_para_mem(&d, &ec, o, s as usize)?;
                }
                0x3d => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::from(self.last_return.len() as u64))?;
                }
                0x3e => {
                    // RETURNDATACOPY é o único COPY com verificação de limite: ler
                    // além do retorno é ERRO, não zero-padding. Relaxar isso deixaria
                    // um contrato ler lixo determinístico deste cliente que outro
                    // cliente recusa.
                    self.spend(GAS_VERYLOW)?;
                    let (d, o, s) = (self.pop()?, self.pop()?, self.pop()?);
                    let fim = u128_sat(&o).saturating_add(u128_sat(&s));
                    if fim > self.last_return.len() as u128 {
                        return Err(EavmError::RetornoForaDosLimites);
                    }
                    let (o, s) = (usize_sat(&o), usize_sat(&s));
                    self.spend(Self::gas_copia(s as u64))?;
                    let fatia = self.last_return[o..o + s].to_vec();
                    self.mem_write(&d, &fatia)?;
                }
                0x3f => {
                    // EXTCODEHASH cobra por PALAVRA do código: keccak com preço
                    // fixo de 100 seria hash de graça sobre código grande (H-1).
                    self.spend(GAS_EXTCODE)?;
                    let a = endereco_de_word(&self.pop()?);
                    let ec = self.host.code(&a);
                    self.spend(GAS_KECCAK_WORD.saturating_mul((ec.len() as u64).div_ceil(32)))?;
                    let h = if ec.is_empty() {
                        Word::ZERO
                    } else {
                        word_de_bytes(&keccak256(&ec))
                    };
                    self.push(h)?;
                }

                // BLOCKHASH — anel de histórico do estado (EIP-2935). Fora da janela
                // de 256 blocos devolve 0, como toda EVM. Note que a referência
                // condiciona a consulta ao fork de Osaka mas NÃO invalida o opcode
                // abaixo dele: lá o resultado é simplesmente 0.
                0x40 => {
                    self.spend(GAS_EXTCODE)?;
                    let n = self.pop()?;
                    let h = if self.osaka {
                        self.host.block_hash(n, self.block.number)
                    } else {
                        Word::ZERO
                    };
                    self.push(h)?;
                }
                // COINBASE: a EAV7 não credita taxa a um endereço de bloco.
                0x41 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::ZERO)?;
                }
                0x42 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::from(self.block.timestamp))?;
                }
                0x43 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::from(self.block.number))?;
                }
                // PREVRANDAO: ZERO de propósito. Uma cadeia PoS sem RANDAO que
                // devolvesse qualquer coisa "aleatória" estaria vendendo
                // aleatoriedade que não tem, e contrato de sorteio confiaria nela.
                0x44 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::ZERO)?;
                }
                0x45 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::from(self.block.gas_limit))?;
                }
                0x46 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::from(self.block.chain_id))?;
                }
                0x47 => {
                    self.spend(GAS_LOW)?;
                    let b = self.host.balance(&self.self_addr);
                    self.push(b)?;
                }
                // BASEFEE: sem EIP-1559, é 0.
                0x48 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::ZERO)?;
                }
                // Cancun. A EAV7 não tem blobs: BLOBHASH devolve 0 (índice sempre
                // fora da lista vazia) e BLOBBASEFEE devolve o mínimo de 1, que é o
                // que uma cadeia sem mercado de blob deve reportar. Existem para o
                // bytecode compilado com alvo Cancun não abortar em opcode
                // desconhecido.
                0x49 => {
                    self.spend(GAS_VERYLOW)?;
                    self.exige_osaka(op)?;
                    self.pop()?;
                    self.push(Word::ZERO)?;
                }
                0x4a => {
                    self.spend(GAS_BASE)?;
                    self.exige_osaka(op)?;
                    self.push(Word::from(1u64))?;
                }

                // --------------------------------- 0x50..0x5f pilha, memória, fluxo
                0x50 => {
                    self.spend(GAS_BASE)?;
                    self.pop()?;
                }
                0x51 => {
                    self.spend(GAS_VERYLOW)?;
                    let o = self.pop()?;
                    let b = self.mem_read(&o, &Word::from(32u64))?;
                    self.push(word_de_bytes(&b))?;
                }
                0x52 => {
                    self.spend(GAS_VERYLOW)?;
                    let (o, v) = (self.pop()?, self.pop()?);
                    self.mem_write(&o, &v.to_be_bytes::<32>())?;
                }
                0x53 => {
                    self.spend(GAS_VERYLOW)?;
                    let (o, v) = (self.pop()?, self.pop()?);
                    // Byte MENOS significativo. Via `to_be_bytes` e não `to::<u64>()`:
                    // o `to` do ruint entra em PÂNICO quando o valor não cabe, e aqui
                    // o valor é atacante-controlado — seria DoS por dois opcodes.
                    self.mem_write(&o, &[v.to_be_bytes::<32>()[31]])?;
                }
                0x54 => {
                    self.spend(GAS_SLOAD)?;
                    let k = self.pop()?;
                    let v = self.host.sload(&self.self_addr, &k);
                    self.push(v)?;
                }
                0x55 => {
                    // SSTORE. Note a ORDEM: a proibição em chamada estática vem
                    // ANTES de qualquer gasto. E o custo depende do valor ATUAL —
                    // um `sload` a mais aqui não é desperdício, é o que decide
                    // entre 2000 e 800.
                    if self.is_static {
                        return Err(EavmError::EscritaEmChamadaEstatica(op));
                    }
                    let (k, v) = (self.pop()?, self.pop()?);
                    let atual = self.host.sload(&self.self_addr, &k);
                    let custo = if atual.is_zero() && !v.is_zero() {
                        GAS_SSTORE_SET
                    } else {
                        GAS_SSTORE_RESET
                    };
                    self.spend(custo)?;
                    let a = self.self_addr;
                    self.host.sstore(&a, k, v)?;
                }
                0x56 => {
                    self.spend(GAS_MID)?;
                    let t = usize_sat(&self.pop()?);
                    if !self.jumpdests.contains(&t) {
                        return Err(EavmError::JumpInvalido(t));
                    }
                    np = t;
                }
                0x57 => {
                    self.spend(GAS_HIGH)?;
                    let (t, c) = (self.pop()?, self.pop()?);
                    if !c.is_zero() {
                        let t = usize_sat(&t);
                        if !self.jumpdests.contains(&t) {
                            return Err(EavmError::JumpInvalido(t));
                        }
                        np = t;
                    }
                }
                0x58 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::from(self.pc as u64))?;
                }
                // MSIZE — ATENÇÃO. A referência devolve `mem.length`, que é a
                // capacidade FÍSICA do buffer (dobra em potências de dois), e NÃO o
                // tamanho lógico arredondado a 32 bytes que o EVM define. É uma
                // divergência conhecida e registrada em `docs/paridade-tron.md` §6.
                //
                // Reproduzimos a REFERÊNCIA, não o EVM: consertar aqui sozinho faria
                // este cliente calcular outro valor que o resto da rede sobre o mesmo
                // bloco, que é precisamente a cisão que o port existe para evitar. O
                // conserto é um hard fork coordenado, não uma linha neste arquivo.
                0x59 => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::from(self.mem.len() as u64))?;
                }
                0x5a => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::from(self.gas_left))?;
                }
                0x5b => {
                    self.spend(GAS_JUMPDEST)?;
                }
                // Armazenamento TRANSIENTE (Cancun, EIP-1153): vive só dentro da
                // transação e some no fim — não vai para o stateRoot. É o trilho
                // barato de reentrancy guard, que hoje custa escrita permanente.
                0x5c => {
                    self.spend(GAS_SLOAD_TRANSIENT)?;
                    self.exige_osaka(op)?;
                    let k = self.pop()?;
                    let v = self.host.tload(&self.self_addr, &k);
                    self.push(v)?;
                }
                0x5d => {
                    self.spend(GAS_SSTORE_TRANSIENT)?;
                    self.exige_osaka(op)?;
                    if self.is_static {
                        return Err(EavmError::EscritaEmChamadaEstatica(op));
                    }
                    let (k, v) = (self.pop()?, self.pop()?);
                    let a = self.self_addr;
                    self.host.tstore(&a, k, v)?;
                }
                // MCOPY (Cancun, EIP-5656): cópia memória→memória.
                //
                // Origem e destino PODEM se sobrepor, e a semântica exigida é a de
                // `memmove`: `copy_within` do Rust dá exatamente isso. Um laço byte a
                // byte para a frente corromperia a região quando dest > origem, e o
                // erro só apareceria em contratos reais.
                0x5e => {
                    self.spend(GAS_VERYLOW)?;
                    self.exige_osaka(op)?;
                    let (d, o, s) = (self.pop()?, self.pop()?, self.pop()?);
                    let n = u64_sat(&s);
                    self.spend(Self::gas_copia(n))?;
                    // Expande para a LEITURA e depois para a ESCRITA, na mesma ordem
                    // da referência (`memRead` e então `memWrite`), para que o gás de
                    // expansão saia idêntico.
                    self.mem_expand(&o, &s)?;
                    self.mem_expand(&d, &s)?;
                    if !s.is_zero() {
                        let (di, oi, si) = (usize_sat(&d), usize_sat(&o), usize_sat(&s));
                        self.mem.copy_within(oi..oi + si, di);
                    }
                }
                // PUSH0 (EIP-3855).
                0x5f => {
                    self.spend(GAS_BASE)?;
                    self.push(Word::ZERO)?;
                }

                // ------------------------------------------------ 0x60..0x7f PUSHn
                0x60..=0x7f => {
                    self.spend(GAS_VERYLOW)?;
                    let n = (op - 0x5f) as usize;
                    let ini = self.pc + 1;
                    let fim = (ini + n).min(self.code.len());
                    // Imediato TRUNCADO no fim do código é preenchido com ZERO à
                    // direita, não é erro: bytecode que termina em PUSH incompleto
                    // existe e todo cliente o aceita assim.
                    let mut buf = vec![0u8; n];
                    if fim > ini {
                        buf[..fim - ini].copy_from_slice(&self.code[ini..fim]);
                    }
                    self.push(word_de_bytes(&buf))?;
                    np = ini + n;
                }
                // ------------------------------------------------- 0x80..0x8f DUPn
                0x80..=0x8f => {
                    self.spend(GAS_VERYLOW)?;
                    let v = self.peek((op - 0x80) as usize)?;
                    self.push(v)?;
                }
                // ------------------------------------------------ 0x90..0x9f SWAPn
                0x90..=0x9f => {
                    self.spend(GAS_VERYLOW)?;
                    let n = (op - 0x8f) as usize;
                    if self.stack.len() <= n {
                        return Err(EavmError::PilhaVazia);
                    }
                    let i = self.stack.len() - 1;
                    self.stack.swap(i, i - n);
                }

                // ------------------------------------------------ 0xa0..0xa4 LOGn
                0xa0..=0xa4 => {
                    if self.is_static {
                        return Err(EavmError::EscritaEmChamadaEstatica(op));
                    }
                    let n = (op - 0xa0) as usize;
                    let (o, s) = (self.pop()?, self.pop()?);
                    let mut topics = Vec::with_capacity(n);
                    for _ in 0..n {
                        topics.push(self.pop()?);
                    }
                    // Saturado até o fim: `s` é atacante-controlado e vai a 2²⁵⁶.
                    // Um `+` cru transbordaria — pânico com `overflow-checks`, e um
                    // custo RIDÍCULO sem elas. Saturar transforma os dois em SEM GÁS.
                    let custo = (GAS_LOG + GAS_LOG_TOPIC * n as u64)
                        .saturating_add(GAS_LOG_DATA.saturating_mul(u64_sat(&s)));
                    self.spend(custo)?;
                    let data = self.mem_read(&o, &s)?;
                    let address = self.self_addr;
                    self.logs.push(Log { address, topics, data });
                }

                // ------------------------------------------ 0xf0/0xf5 CREATE(2)
                0xf0 | 0xf5 => {
                    if self.is_static {
                        return Err(EavmError::EscritaEmChamadaEstatica(op));
                    }
                    self.spend(GAS_CREATE)?;
                    let (val, o, s) = (self.pop()?, self.pop()?, self.pop()?);
                    let salt = if op == 0xf5 { Some(self.pop()?) } else { None };
                    let init = self.mem_read(&o, &s)?;
                    // regra 63/64: o frame pai SEMPRE retém 1/64 do gás, para ter
                    // com que tratar a falha do filho.
                    let forward = self.gas_left - self.gas_left / 64;
                    let req = CreateRequest {
                        caller: self.self_addr,
                        value: val,
                        init_code: init,
                        gas: forward,
                        salt,
                        depth: self.depth + 1,
                        block: self.block,
                        origin: self.origin,
                        gas_price: self.gas_price,
                    };
                    let r = self.host.create(req)?;
                    self.spend(r.gas_used)?;
                    // Em SUCESSO o RETURNDATA fica VAZIO (o retorno do construtor é
                    // o código depositado, não dado); em falha, é o revert.
                    self.last_return = if r.success { Vec::new() } else { r.return_data };
                    self.logs.extend(r.logs); // mescla logs do construtor (H-1)
                    let v = if r.success {
                        word_de_endereco(&r.address)
                    } else {
                        Word::ZERO
                    };
                    self.push(v)?;
                }

                // ------------------------- 0xf1/0xf2/0xf4/0xfa chamadas
                0xf1 | 0xf2 | 0xf4 | 0xfa => {
                    let kind = match op {
                        0xf1 => CallKind::Call,
                        0xf2 => CallKind::CallCode,
                        0xf4 => CallKind::DelegateCall,
                        _ => CallKind::StaticCall,
                    };
                    self.spend(GAS_CALL)?;
                    // Limite de gás PEDIDO pelo chamador. Ignorá-lo (achado A-1)
                    // quebraria `CALL{gas: N}`, que é meio reentrancy guard em uso.
                    let req_gas = self.pop()?;
                    let to = endereco_de_word(&self.pop()?);
                    let tem_valor = matches!(kind, CallKind::Call | CallKind::CallCode);
                    let call_value = if tem_valor { self.pop()? } else { Word::ZERO };
                    if tem_valor && !call_value.is_zero() && self.is_static {
                        return Err(EavmError::EscritaEmChamadaEstatica(op));
                    }
                    let (ao, asz, ro, rsz) =
                        (self.pop()?, self.pop()?, self.pop()?, self.pop()?);
                    if tem_valor && !call_value.is_zero() {
                        self.spend(GAS_CALL_VALUE)?;
                    }
                    let input = self.mem_read(&ao, &asz)?;
                    // Cobra a expansão da região de RETORNO antes do corte 63/64
                    // (achado L-1): cobrá-la depois daria ao filho gás que o pai
                    // ainda deve.
                    self.mem_expand(&ro, &rsz)?;

                    let cap = self.gas_left - self.gas_left / 64;
                    let mut forward = std::cmp::min(u64_sat(&req_gas), cap);
                    if tem_valor && !call_value.is_zero() {
                        // estipêndio do EVM, financiado pelo GAS_CALL_VALUE (L-1)
                        forward = forward.saturating_add(2300);
                    }
                    if forward > self.gas_left {
                        // clamp: nunca encaminha mais do que existe, senão o
                        // estipêndio faria o pai reverter duro
                        forward = self.gas_left;
                    }

                    let req = CallRequest {
                        kind,
                        caller: self.self_addr,
                        to,
                        value: call_value,
                        input,
                        gas: forward,
                        is_static: self.is_static || kind == CallKind::StaticCall,
                        delegate: kind == CallKind::DelegateCall,
                        code_addr: to,
                        // DELEGATECALL e CALLCODE executam no contexto (endereço e
                        // storage) do CHAMADOR — é o que os torna proxies.
                        exec_address: match kind {
                            CallKind::DelegateCall | CallKind::CallCode => self.self_addr,
                            _ => to,
                        },
                        // DELEGATECALL preserva o caller ORIGINAL: é isso que faz
                        // `msg.sender` atravessar o proxy.
                        exec_caller: match kind {
                            CallKind::DelegateCall => self.caller,
                            _ => self.self_addr,
                        },
                        exec_value: match kind {
                            CallKind::DelegateCall => self.value,
                            _ => call_value,
                        },
                        depth: self.depth + 1,
                        block: self.block,
                        origin: self.origin,
                        gas_price: self.gas_price,
                    };
                    let r = self.host.call(req)?;
                    self.spend(r.gas_used)?;
                    self.last_return = r.return_data;
                    let n = std::cmp::min(usize_sat(&rsz), self.last_return.len());
                    if n > 0 {
                        let fatia = self.last_return[..n].to_vec();
                        self.mem_write(&ro, &fatia)?;
                    }
                    self.logs.extend(r.logs); // mescla logs da sub-chamada (H-1)
                    self.push(Word::from(r.success as u64))?;
                }

                // ------------------------------------------- 0xf3/0xfd fim do frame
                0xf3 => {
                    let (o, s) = (self.pop()?, self.pop()?);
                    let ret = self.mem_read(&o, &s)?;
                    return Ok(self.done(true, ret));
                }
                0xfd => {
                    let (o, s) = (self.pop()?, self.pop()?);
                    let ret = self.mem_read(&o, &s)?;
                    return Ok(self.done(false, ret));
                }

                0xfe => return Err(EavmError::OpcodeInvalido(op)),
                // SELFDESTRUCT não é suportado — e a recusa é DELIBERADA. A semântica
                // pós-Cancun (EIP-6780) é diferente da clássica, e implementar a
                // errada apagaria contrato que o resto da rede mantém. Falhar é a
                // única opção segura enquanto a EAV7 não escolher uma.
                0xff => return Err(EavmError::SelfdestructNaoSuportado),

                _ => return Err(EavmError::OpcodeDesconhecido(op)),
            }
            self.pc = np;
        }
        // Cair fora do fim do código é PARADA normal, não erro.
        Ok(self.done(true, Vec::new()))
    }

    /// Gate de fork. Abaixo da altura o opcode é INVÁLIDO — exatamente como era
    /// antes de existir. É isto que impede este cliente de aceitar bytecode que a
    /// rede rejeita na altura em questão.
    #[inline]
    fn exige_osaka(&self, op: u8) -> R<()> {
        if self.osaka {
            Ok(())
        } else {
            Err(EavmError::OpcodeForaDoFork(op))
        }
    }

    fn done(&mut self, success: bool, return_data: Vec<u8>) -> ExecResult {
        ExecResult {
            success,
            return_data,
            gas_used: self.gas_inicial - self.gas_left,
            gas_left: self.gas_left,
            logs: std::mem::take(&mut self.logs),
        }
    }
}

/// Executa um frame de bytecode.
///
/// `Err` é falha DURA (sem gás, opcode inválido, salto inválido): o frame some e
/// o gás é do chamador. `Ok` com `success == false` é REVERT: dados de retorno
/// preservados. A referência faz a mesma distinção, lançando `EavmError` no
/// primeiro caso.
pub fn run_eavm<H: Host + ?Sized>(params: ExecParams, host: &mut H) -> R<ExecResult> {
    let origin = params.origin.unwrap_or(params.caller);
    let osaka = params.block.number >= params.osaka_height;
    let jumpdests = analisa_jumpdests(&params.code);

    let mut interp = Interp {
        host,
        jumpdests,
        code: params.code,
        calldata: params.calldata,
        stack: Vec::with_capacity(64),
        mem: Vec::new(),
        mem_words: 0,
        pc: 0,
        gas_inicial: params.gas,
        gas_left: params.gas,
        last_return: Vec::new(),
        logs: Vec::new(),
        self_addr: params.address,
        caller: params.caller,
        origin,
        value: params.value,
        gas_price: params.gas_price,
        block: params.block,
        depth: params.depth,
        is_static: params.is_static,
        osaka,
    };
    interp.executa()
}

// ---------------------------------------------------------------------- testes

#[cfg(test)]
mod tests {
    use super::*;

    fn roda_com(codigo: &str, altura: u64, host: &mut dyn Host) -> R<ExecResult> {
        let params = ExecParams {
            code: hex::decode(codigo.trim_start_matches("0x")).expect("hex do teste"),
            gas: 1_000_000,
            address: [0x11u8; 20],
            caller: [0x22u8; 20],
            block: BlockContext { number: altura, timestamp: 1_000, chain_id: 7, gas_limit: 0 },
            ..Default::default()
        };
        run_eavm(params, host)
    }

    fn roda(codigo: &str) -> R<ExecResult> {
        let mut h = SimpleHost::default();
        roda_com(codigo, EAVM_OSAKA_HEIGHT, &mut h)
    }

    /// `MSTORE(0, topo); RETURN(0, 32)` — o sufixo que a referência usa nos vetores.
    const RET: &str = "60005260206000f3";

    fn topo(codigo: &str) -> Word {
        let r = roda(&format!("{codigo}{RET}")).expect("execução");
        assert!(r.success);
        word_de_bytes(&r.return_data)
    }

    fn w(n: u64) -> Word {
        Word::from(n)
    }

    // ---- aritmética e casos de borda que um port erra em silêncio ----

    #[test]
    fn sub_embrulha_em_2_elevado_256() {
        // 1 - 2 = MAX. Se estourasse, seria pânico em debug e outro número em
        // release — duas implementações do mesmo protocolo.
        assert_eq!(topo("6002600103"), Word::MAX);
    }

    #[test]
    fn divisao_e_modulo_por_zero_sao_zero_e_nao_erro() {
        assert_eq!(topo("6000600104"), Word::ZERO); // DIV
        assert_eq!(topo("6000600105"), Word::ZERO); // SDIV
        assert_eq!(topo("6000600106"), Word::ZERO); // MOD
        assert_eq!(topo("6000600107"), Word::ZERO); // SMOD
        // ADDMOD/MULMOD desempilham a, b, n — o módulo é o ÚLTIMO empilhado.
        assert_eq!(topo("60006002600308"), Word::ZERO); // ADDMOD com n=0
        assert_eq!(topo("60006002600309"), Word::ZERO); // MULMOD com n=0
    }

    #[test]
    fn sdiv_de_min_por_menos_um_volta_para_min() {
        // MIN = -2^255; -MIN não cabe, e o resultado correto é o próprio MIN.
        let min = Word::from(1u64) << 255usize;
        assert_eq!(sdiv(min, Word::MAX), min); // MAX é -1 com sinal
    }

    #[test]
    fn smod_segue_o_sinal_do_dividendo() {
        // -7 % 3 = -1 (truncamento para zero), não 2 (piso).
        let menos7 = neg(w(7));
        assert_eq!(smod(menos7, w(3)), neg(w(1)));
        assert_eq!(smod(w(7), neg(w(3))), w(1));
    }

    #[test]
    fn slt_ordena_por_sinal_e_nao_por_bits() {
        // -1 (0xff..ff) é o MAIOR sem sinal e o menor entre negativos.
        assert!(slt(&Word::MAX, &w(1)));
        assert!(!slt(&w(1), &Word::MAX));
    }

    #[test]
    fn sar_preenche_com_o_bit_de_sinal() {
        assert_eq!(sar(w(1), Word::MAX), Word::MAX); // -1 >> 1 = -1
        assert_eq!(sar(w(300), Word::MAX), Word::MAX); // saturado, ainda -1
        assert_eq!(sar(w(300), w(8)), Word::ZERO); // positivo saturado é 0
        assert_eq!(sar(w(0), Word::MAX), Word::MAX); // deslocamento zero não mexe
    }

    #[test]
    fn deslocamento_maior_que_255_e_zero_e_nao_panico() {
        assert_eq!(topo("600161ffff1b"), Word::ZERO); // SHL 65535
        assert_eq!(topo("600161ffff1c"), Word::ZERO); // SHR 65535
    }

    #[test]
    fn clz_de_zero_e_256() {
        // O caso que o `bit_len()` cru erra: zero tem 256 zeros à esquerda.
        assert_eq!(topo("60001e"), w(256));
        assert_eq!(topo("60011e"), w(255));
    }

    #[test]
    fn signextend_estende_negativo_e_ignora_indice_grande() {
        assert_eq!(signextend(w(0), w(0xff)), Word::MAX); // byte 0 negativo
        assert_eq!(signextend(w(0), w(0x7f)), w(0x7f)); // positivo fica
        assert_eq!(signextend(w(32), w(5)), w(5)); // índice >= 32 é no-op
    }

    #[test]
    fn exp_embrulha_e_expoente_zero_da_um() {
        assert_eq!(exp_mod2_256(w(2), w(10)), w(1024));
        assert_eq!(exp_mod2_256(w(0), w(0)), w(1));
        // 2^256 embrulha para 0, não transborda
        assert_eq!(exp_mod2_256(w(2), w(256)), Word::ZERO);
    }

    #[test]
    fn byte_conta_do_mais_significativo() {
        // BYTE(31, 0xff) = 0xff; BYTE(0, 0xff) = 0 (o byte mais alto é zero)
        assert_eq!(topo("60ff601f1a"), w(0xff));
        assert_eq!(topo("60ff60001a"), Word::ZERO);
        assert_eq!(topo("60ff60201a"), Word::ZERO); // índice >= 32
    }

    // ---- gate de fork ----

    #[test]
    fn opcodes_de_osaka_sao_invalidos_abaixo_da_altura() {
        // Este é o teste que impede o cliente de aceitar bytecode que a rede
        // rejeita. Um por opcode, porque cada um tem seu próprio gate.
        for (nome, codigo) in [
            ("CLZ", "60001e"),
            ("TLOAD", "60005c"),
            ("TSTORE", "600060005d"),
            ("MCOPY", "6000600060005e"),
            ("BLOBHASH", "600049"),
            ("BLOBBASEFEE", "4a"),
        ] {
            let mut h = SimpleHost::default();
            let r = roda_com(codigo, EAVM_OSAKA_HEIGHT - 1, &mut h);
            assert!(
                matches!(r, Err(EavmError::OpcodeForaDoFork(_))),
                "{nome} deveria ser inválido abaixo do fork, veio {r:?}"
            );
            let mut h = SimpleHost::default();
            assert!(
                roda_com(codigo, EAVM_OSAKA_HEIGHT, &mut h).is_ok(),
                "{nome} deveria valer a partir do fork"
            );
        }
    }

    // ---- memória ----

    #[test]
    fn mcopy_com_sobreposicao_tem_semantica_de_memmove() {
        // Grava 0xaa.. em [0,32), copia [0,32) -> [16,48) — regiões SOBREPOSTAS —
        // e lê de volta [16,48). Um laço byte a byte para frente propagaria o
        // primeiro byte por toda a região.
        let codigo = format!(
            "7f{}600052{}{}",
            "aa".repeat(32),
            "6020600060105e", // MCOPY(dest=0x10, src=0, len=0x20)
            "60206010f3"      // RETURN(0x10, 0x20)
        );
        let r = roda(&codigo).expect("execução");
        assert!(r.success);
        assert_eq!(r.return_data, vec![0xaau8; 32]);
    }

    #[test]
    fn mcopy_para_tras_tambem_preserva_os_bytes() {
        // Sobreposição na outra direção: [16,48) -> [0,32).
        let mut codigo = String::new();
        codigo.push_str(&format!("7f{}601052", "bb".repeat(32))); // MSTORE(0x10, 0xbb..)
        codigo.push_str("6020601060005e"); // MCOPY(dest=0, src=0x10, len=0x20)
        codigo.push_str("60206000f3"); // RETURN(0, 0x20)
        let r = roda(&codigo).expect("execução");
        assert_eq!(r.return_data, vec![0xbbu8; 32]);
    }

    #[test]
    fn msize_devolve_a_capacidade_fisica_e_nao_o_tamanho_logico() {
        // Divergência DELIBERADA do EVM (docs/paridade-tron.md §6): a referência
        // devolve `mem.length`, a capacidade que dobra. Este teste existe para que
        // ninguém a "conserte" sem hard fork — se ele quebrar, o cliente cindiu.
        //
        // MSTORE em 0 leva a capacidade a 32; um MSTORE8 em 32 leva o tamanho
        // lógico a 33 bytes (2 palavras = 64) e a capacidade física a max(64, 64).
        assert_eq!(topo("6000600052 6000 6020 53 59".replace(' ', "").as_str()), w(64));
        // Só a primeira escrita: capacidade 32, que coincide com o lógico.
        assert_eq!(topo("60006000525 9".replace(' ', "").as_str()), w(32));
    }

    #[test]
    fn mstore8_com_palavra_cheia_guarda_so_o_byte_baixo() {
        // PUSH32 0xff..ff, PUSH1 0, MSTORE8 → mem[0] = 0xff, resto zero.
        // O valor é atacante-controlado: converter para u64 aqui derrubaria o nó.
        let codigo = format!("7f{}600053{}", "ff".repeat(32), "60206000f3");
        let r = roda(&codigo).expect("execução");
        assert_eq!(r.return_data[0], 0xff);
        assert!(r.return_data[1..].iter().all(|b| *b == 0));
    }

    #[test]
    fn tamanho_absurdo_vira_sem_gas_e_nunca_transbordo() {
        // Tamanhos perto de 2²⁵⁶ nos opcodes que multiplicam tamanho por preço.
        // O resultado tem de ser SEM GÁS ou MEMÓRIA EXCESSIVA — nunca um custo
        // pequeno por transbordo, que seria trabalho gigante quase de graça (H-2).
        let enorme = format!("7f{}", "ff".repeat(32));
        for (nome, codigo) in [
            ("LOG0", format!("{enorme}6000a0")),
            ("KECCAK256", format!("{enorme}600020")),
            ("CALLDATACOPY", format!("{enorme}6000600037")),
            ("CODECOPY", format!("{enorme}6000600039")),
        ] {
            let r = roda(&codigo);
            assert!(
                matches!(r, Err(EavmError::SemGas) | Err(EavmError::MemoriaExcessiva)),
                "{nome}: esperava falha controlada, veio {r:?}"
            );
        }
    }

    #[test]
    fn memoria_alem_do_teto_e_erro_e_nao_alocacao() {
        // MSTORE num offset absurdo: tem de virar erro ANTES de tentar alocar.
        // Um port que faça `Vec::resize` com o offset cru morre por OOM aqui.
        let r = roda(&format!("6001{}52", "7f".to_string() + &"ff".repeat(32)));
        assert!(matches!(r, Err(EavmError::MemoriaExcessiva) | Err(EavmError::SemGas)), "{r:?}");
    }

    #[test]
    fn expansao_de_memoria_tem_custo_quadratico() {
        // Duas expansões idênticas em tamanho não custam o mesmo: a segunda paga o
        // termo w²/512 sobre um `w` maior. Se custassem igual, o gás seria linear
        // e a memória viraria vetor de DoS barato.
        let uma = roda("60006000f3").expect("vazio");
        let _ = uma;
        let pequena = roda("600060005260006000f3").expect("1 palavra").gas_used;
        let grande = roda("6000610400525b60006000f3").expect("muitas palavras").gas_used;
        assert!(grande > pequena * 2);
    }

    // ---- pilha ----

    #[test]
    fn pilha_vazia_e_erro_e_nao_panico() {
        assert_eq!(roda("01"), Err(EavmError::PilhaVazia)); // ADD sem operandos
        assert_eq!(roda("80"), Err(EavmError::PilhaVazia)); // DUP1 sem nada
        assert_eq!(roda("90"), Err(EavmError::PilhaVazia)); // SWAP1 sem nada
    }

    #[test]
    fn pilha_estoura_em_1024() {
        // 1025 PUSH1. O limite tem de disparar como Err, nunca como alocação
        // infinita — é o vetor de DoS mais barato que existe.
        let codigo = "6001".repeat(1025);
        assert_eq!(roda(&codigo), Err(EavmError::PilhaCheia));
    }

    #[test]
    fn dup_e_swap_mexem_na_posicao_certa() {
        // PUSH1 1, PUSH1 2, SWAP1 -> topo é 1
        assert_eq!(topo("6001600290"), w(1));
        // PUSH1 1, PUSH1 2, DUP2 -> topo é 1
        assert_eq!(topo("6001600281"), w(1));
    }

    // ---- fluxo ----

    #[test]
    fn jumpdest_dentro_de_imediato_de_push_nao_vale() {
        // PUSH1 0x5b (o 0x5b é IMEDIATO, não JUMPDEST), POP, PUSH1 2, JUMP.
        // O destino 2 cai no meio do PUSH1 e tem de ser recusado.
        assert_eq!(roda("605b50600256"), Err(EavmError::JumpInvalido(2)));
    }

    #[test]
    fn jumpi_com_condicao_zero_nao_salta() {
        // PUSH1 0 (cond), PUSH1 0xff (destino inválido), JUMPI -> não salta, segue.
        let r = roda("600060ff57").expect("execução");
        assert!(r.success, "condição falsa não deve nem validar o destino");
    }

    #[test]
    fn cair_do_fim_do_codigo_e_parada_normal() {
        let r = roda("6001").expect("execução");
        assert!(r.success);
        assert!(r.return_data.is_empty());
    }

    #[test]
    fn revert_devolve_dados_e_nao_e_erro_duro() {
        // PUSH1 0x2a, PUSH1 0, MSTORE, PUSH1 0x20, PUSH1 0, REVERT
        let r = roda("602a60005260206000fd").expect("REVERT não é Err");
        assert!(!r.success, "REVERT tem de vir como success=false");
        assert_eq!(word_de_bytes(&r.return_data), w(0x2a));
    }

    #[test]
    fn opcode_invalido_e_desconhecido_sao_erro() {
        assert_eq!(roda("fe"), Err(EavmError::OpcodeInvalido(0xfe)));
        assert_eq!(roda("ff"), Err(EavmError::SelfdestructNaoSuportado));
        assert_eq!(roda("0c"), Err(EavmError::OpcodeDesconhecido(0x0c)));
    }

    #[test]
    fn push_truncado_no_fim_do_codigo_para_limpo() {
        // PUSH2 com só um byte de imediato. O valor empilhado (0xff00, com zero à
        // direita) é INOBSERVÁVEL por construção — o `pc` já saiu do fim do código
        // e nada mais executa. O que dá para fixar, e é o que importa, é que isso
        // é PARADA NORMAL e não erro: um port que leia o imediato com fatia crua
        // sai do vetor e entra em pânico aqui, derrubando o nó com dois bytes.
        let r = roda("61ff").expect("PUSH truncado não é erro");
        assert!(r.success);
        assert_eq!(r.gas_used, GAS_VERYLOW);
    }

    // ---- estado e host ----

    #[test]
    fn sstore_cobra_2000_para_zerado_e_800_para_reescrita() {
        // A diferença é consenso: 1200 de gás por escrita, em todo contrato.
        let zerado = roda("600160005560006000f3").expect("primeira escrita").gas_used;
        let reescrita = roda("60016000556002600055 60006000f3".replace(' ', "").as_str())
            .expect("segunda escrita")
            .gas_used;
        assert_eq!(reescrita - zerado, GAS_SSTORE_RESET + 2 * GAS_VERYLOW);
    }

    #[test]
    fn sload_le_o_que_sstore_gravou() {
        // PUSH1 0x2a, PUSH1 7, SSTORE, PUSH1 7, SLOAD
        assert_eq!(topo("602a600755600754"), w(0x2a));
    }

    #[test]
    fn escrita_em_chamada_estatica_e_recusada() {
        // STATICCALL que permitisse SSTORE quebraria toda garantia de `view`.
        let mut h = SimpleHost::default();
        let params = ExecParams {
            code: hex::decode("6001600055").unwrap(),
            gas: 1_000_000,
            is_static: true,
            block: BlockContext { number: EAVM_OSAKA_HEIGHT, ..Default::default() },
            ..Default::default()
        };
        assert_eq!(
            run_eavm(params, &mut h),
            Err(EavmError::EscritaEmChamadaEstatica(0x55))
        );
    }

    #[test]
    fn tstore_nao_encosta_no_storage_permanente() {
        // Se transiente vazasse para o storage permanente, entraria no stateRoot e
        // todo nó correto divergiria da nossa raiz.
        let mut h = SimpleHost::default();
        let r = roda_com("602a60075d60075c", EAVM_OSAKA_HEIGHT, &mut h).expect("execução");
        assert!(r.success);
        assert!(h.storage.is_empty(), "transiente não pode tocar o permanente");
        assert_eq!(h.transient.get(&w(7)), Some(&w(0x2a)));
    }

    #[test]
    fn call_sem_host_de_estado_e_erro_e_nao_panico() {
        // PUSH1 x7 zeros, CALL. O SimpleHost recusa; o importante é ser Err.
        let codigo = format!("{}f1", "6000".repeat(7));
        assert_eq!(roda(&codigo), Err(EavmError::HostIndisponivel("CALL")));
    }

    #[test]
    fn blockhash_fora_da_janela_de_256_e_zero() {
        // Host padrão devolve 0 para tudo; o teste fixa que o opcode não inventa
        // valor próprio nem entra em pânico com altura absurda.
        assert_eq!(topo("600140"), Word::ZERO);
        assert_eq!(topo(&format!("7f{}40", "ff".repeat(32))), Word::ZERO);
    }

    #[test]
    fn log_registra_topicos_e_dados() {
        // PUSH1 0x2a, PUSH1 0, MSTORE, PUSH1 0xaa (topic), PUSH1 0x20, PUSH1 0, LOG1
        let mut h = SimpleHost::default();
        let r = roda_com("602a60005260aa60206000a1", EAVM_OSAKA_HEIGHT, &mut h).expect("exec");
        assert_eq!(r.logs.len(), 1);
        assert_eq!(r.logs[0].topics, vec![w(0xaa)]);
        assert_eq!(word_de_bytes(&r.logs[0].data), w(0x2a));
        assert_eq!(r.logs[0].address, [0x11u8; 20]);
    }

    #[test]
    fn calldataload_alem_do_fim_preenche_com_zero_a_direita() {
        let mut h = SimpleHost::default();
        let params = ExecParams {
            code: hex::decode(format!("6000356000526020{}", "6000f3")).unwrap(),
            calldata: vec![0xaa, 0xbb],
            gas: 1_000_000,
            block: BlockContext { number: EAVM_OSAKA_HEIGHT, ..Default::default() },
            ..Default::default()
        };
        let r = run_eavm(params, &mut h).expect("execução");
        assert_eq!(r.return_data[0], 0xaa);
        assert_eq!(r.return_data[1], 0xbb);
        assert!(r.return_data[2..].iter().all(|b| *b == 0));
    }

    #[test]
    fn returndatacopy_alem_do_retorno_e_erro() {
        // Sem sub-chamada, RETURNDATASIZE é 0: copiar 32 bytes tem de falhar.
        assert_eq!(
            roda("602060006000 3e".replace(' ', "").as_str()),
            Err(EavmError::RetornoForaDosLimites)
        );
    }

    #[test]
    fn sem_gas_e_erro_limpo() {
        let mut h = SimpleHost::default();
        let params = ExecParams {
            code: hex::decode("6001600101").unwrap(),
            gas: 5, // não paga nem os dois PUSH
            block: BlockContext { number: EAVM_OSAKA_HEIGHT, ..Default::default() },
            ..Default::default()
        };
        assert_eq!(run_eavm(params, &mut h), Err(EavmError::SemGas));
    }

    // ---- vetores de conformidade ----

    /// O juiz. Confere RETORNO **e** GÁS dos 13 programas de `vectors/evm.json`.
    ///
    /// Se um caso falhar, o conserto é NESTE arquivo — nunca no vetor. O vetor é a
    /// rede; este crate é o candidato.
    #[test]
    fn vetores_de_evm_batem_com_a_referencia() {
        let caminho = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("raiz do repositório")
            .join("vectors")
            .join("evm.json");
        let texto = std::fs::read_to_string(&caminho).unwrap_or_else(|e| {
            panic!("não consegui ler {}: {e}\nrode: use frozen vectors/ fixtures", caminho.display())
        });
        let doc: serde_json::Value = serde_json::from_str(&texto).expect("JSON do vetor");

        // A altura do fork no vetor tem de ser a mesma que este crate compila. Se
        // divergir, todos os casos de Osaka passariam ou falhariam pelo motivo
        // errado, e o gate de fork estaria sem cobertura de verdade.
        assert_eq!(
            doc["forkHeight"].as_u64().expect("forkHeight"),
            EAVM_OSAKA_HEIGHT,
            "a altura do fork no vetor mudou; alinhe EAVM_OSAKA_HEIGHT"
        );

        let casos = doc["cases"].as_array().expect("campo `cases`");
        // PISO, não igualdade. Contagem exata obrigaria a editar este teste toda vez
        // que alguém acrescentasse cobertura — e o reflexo seria subir o número sem
        // olhar, que é pior que não ter a asserção. O piso pega vetor sumindo; o
        // contador de conferidos, logo abaixo, pega vetor sendo pulado.
        assert!(
            casos.len() >= 13,
            "o vetor encolheu: {} programas, esperava ao menos 13", casos.len(),
        );
        let mut conferidos = 0usize;

        for caso in casos {
            let nome = caso["name"].as_str().expect("name");
            let altura = caso["blockNumber"].as_u64().expect("blockNumber");
            let codigo = caso["code"].as_str().expect("code").trim_start_matches("0x");

            // O gerador (`vectors/`) usa um mundo VAZIO com 1.000.000 de
            // gás, endereço 0x11.. e chamador 0x22.. — reproduzido aqui, porque
            // qualquer um desses valores muda o resultado.
            let mut host = SimpleHost::default();
            let params = ExecParams {
                code: hex::decode(codigo).expect("hex do vetor"),
                gas: 1_000_000,
                address: [0x11u8; 20],
                caller: [0x22u8; 20],
                block: BlockContext {
                    number: altura,
                    timestamp: 1_000,
                    chain_id: 72020, // CHAIN.EAVM_CHAIN_ID
                    gas_limit: 0,
                },
                ..Default::default()
            };
            let r = run_eavm(params, &mut host)
                .unwrap_or_else(|e| panic!("{nome}: execução falhou com {e}"));

            assert_eq!(r.success, caso["success"].as_bool().expect("success"), "{nome}: success");
            assert_eq!(
                format!("0x{}", hex::encode(&r.return_data)),
                caso["returnData"].as_str().expect("returnData"),
                "{nome}: returnData"
            );
            // O GÁS. Retorno igual com gás diferente ainda é divergência.
            assert_eq!(
                r.gas_used.to_string(),
                caso["gasUsed"].as_str().expect("gasUsed"),
                "{nome}: gasUsed"
            );
            conferidos += 1;
        }

        // Todo caso do arquivo tem de ter sido conferido. Sem isto, um `continue`
        // acrescentado no futuro faria o teste passar ignorando vetores em silêncio
        // — que é exatamente o modo de falha que a conformidade existe para evitar.
        assert_eq!(
            conferidos, casos.len(),
            "{} de {} casos conferidos — algum foi pulado",
            conferidos, casos.len(),
        );
    }
}
