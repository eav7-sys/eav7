//! Host de estado mundial da EAVM — porte de `src/eavm/host.js`.
//!
//! O interpretador ([`super::vm`]) sabe girar opcodes sobre uma pilha e nada mais.
//! Este módulo é o que lhe dá acesso ao mundo: storage, código, saldo e nonce de
//! OUTRAS contas, `CALL`/`CREATE` recursivos, e os precompiles. Ele implementa o
//! trait [`vm::Host`] que o interpretador consome, e é parametrizado por um
//! [`World`] de baixo nível — o `State` fornece um; os testes, um em memória.
//!
//! # A propriedade que este módulo existe para garantir: isolamento por snapshot
//!
//! Uma sub-chamada que reverte tem de desfazer SÓ as mudanças dela — nem as do
//! pai, nem as de um irmão que já terminou. Por isso todo caminho que muta o mundo
//! abre um [`World::snapshot`] antes e chama [`World::revert`] no fracasso.
//!
//! A referência aprendeu isso da forma cara (achados A-2/M-2): a versão anterior
//! clonava o mundo INTEIRO a cada `CALL`, o que era um DoS de CPU — bastava um
//! contrato com um laço de chamadas. O journal (undo-log) torna `snapshot` O(1) e
//! `revert` O(mudanças do frame).
//!
//! # Por que o mundo é um trait
//!
//! Parametrizar mantém a lógica de chamada e de precompile ÚNICA: a mesma que roda
//! em consenso é a que os testes exercitam. Se o host conhecesse o `State`
//! concretamente, testar `CALL` recursivo exigiria montar uma cadeia inteira — e na
//! prática ninguém testaria.
//!
//! # Precompiles: a política de dependências INVERTE aqui
//!
//! O nó em JS implementou secp256k1, ripemd160, blake2f e um pairing BN254 de 590
//! linhas à mão, porque em npm uma dependência transitiva não auditável em código
//! de consenso é risco maior que reimplementar. Em Rust a conta é outra, e o
//! `Cargo.toml` deste crate diz isso: `k256`, `sha2`, `ripemd` e `ark-bn254` vêm de
//! RustCrypto/arkworks, e usá-los REMOVE criptografia artesanal sem auditoria
//! externa. Reimplementar pairing aqui seria escolher o pior dos dois mundos.
//!
//! # O gás é cobrado ANTES do trabalho pesado
//!
//! Todo precompile é dois passos: [`precompile_gas`] calcula o custo a partir do
//! FORMATO da entrada, o host debita, e só então [`precompile_run`] faz a conta.
//! Não é organização — é anti-DoS (achado A-5). Um `blake2f` com `rounds =
//! 0xffffffff` custa 4,29 bilhões de gás e é rejeitado por falta de saldo sem nunca
//! girar o laço.

use std::collections::HashMap;

use num_bigint::BigUint;
use sha3::{Digest as _, Keccak256};

use super::vm::{
    self, Address, CallOutcome, CallRequest, CreateOutcome, CreateRequest, EavmError, ExecParams,
    Word, MAX_CALL_DEPTH,
};

/// Tamanho máximo do bytecode de runtime depositado por `CREATE` (EIP-170).
pub const MAX_CONTRACT_BYTES: usize = crate::config::MAX_CONTRACT_BYTES as usize;

/// Janela que o opcode `BLOCKHASH` realmente serve.
///
/// O anel do EIP-2935 guarda 8191 alturas, mas o opcode só enxerga 256 — como em
/// toda EVM. Servir mais aqui daria a este cliente um `BLOCKHASH` de alcance maior
/// que o do resto da rede, e um contrato que dependesse disso computaria coisas
/// diferentes em nós diferentes.
pub const BLOCKHASH_WINDOW: u64 = crate::config::BLOCKHASH_WINDOW;

/// Multiplicador de gás dos precompiles BN254 (0x06..0x08).
///
/// A tabela do EIP-1108 (150 / 6000 / 34000·k+45000) foi calibrada para pairing em
/// código NATIVO. A referência roda BigInt em JavaScript e MEDIU ~13× mais CPU por
/// unidade de gás; sem escalar, uma transação cheia de pairings ocuparia ~15 s de
/// CPU pagando gás de um bloco de 1 s, travando a produção por 15 slots. A
/// alternativa seria um teto de tempo de PAREDE (o `MAX_CPU_TIME_OF_ONE_TX` da
/// TRON), mas tempo de parede difere entre nós e o mesmo bloco passaria num e
/// falharia noutro. Gás é determinístico; tempo não é.
///
/// Este cliente é nativo e seria muito mais barato — mas o multiplicador é REGRA DE
/// CONSENSO, não característica de implementação. Baixá-lo aqui faria este nó
/// aceitar transações que a rede rejeita por falta de gás. Voltar a 1 exige fork
/// coordenado por altura, não um ajuste neste arquivo.
pub const BN254_GAS_MULTIPLIER: u64 = crate::config::BN254_GAS_MULTIPLIER as u64;

/// Custo por byte de código depositado no `CREATE`. Vem da tabela do interpretador
/// para que os dois módulos não inventem o número separadamente.
pub const CREATE_DEPOSIT_GAS_PER_BYTE: u64 = vm::GAS_CODE_DEPOSIT_BYTE;

/// A palavra zero — em storage, o valor "não existe".
pub const ZERO_WORD: Word = Word::ZERO;

const ZERO_ADDR: Address = [0u8; 20];

// ---------------------------------------------------------------------------
// O mundo
// ---------------------------------------------------------------------------

/// Por que um valor se moveu — vira "transferência interna" no explorador.
///
/// `Entry` é o valor da PRÓPRIA transação, que já aparece como `amount` na tx e
/// portanto não pode ser contado duas vezes. O mundo usa isso para filtrar; sem a
/// distinção, todo pagamento a contrato apareceria em dobro.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferKind {
    Entry,
    Call,
    Create,
}

/// Acesso de baixo nível ao estado, com journaling.
///
/// # Contrato de journaling
///
/// [`snapshot`](World::snapshot) devolve um marcador opaco e barato;
/// [`revert`](World::revert) desfaz TODA mutação feita depois dele, em ordem
/// inversa, e nada antes. Aninhamento tem de funcionar: se `s1` veio antes de `s2`,
/// `revert(s1)` desfaz também o que veio depois de `s2`. É a única propriedade da
/// qual o isolamento de sub-chamada depende — uma implementação que erre aqui não
/// falha em teste de unidade, falha em auditoria de saldo.
pub trait World {
    fn get_storage(&self, address: &Address, key: &Word) -> Word;
    fn set_storage(&mut self, address: &Address, key: Word, value: Word);

    fn get_code(&self, address: &Address) -> Vec<u8>;
    fn put_code(&mut self, address: &Address, code: &[u8]);

    fn get_balance(&self, address: &Address) -> Word;

    /// ÚNICO ponto por onde valor se move dentro da VM.
    ///
    /// Devolve `false` — SEM mutar nada — quando o saldo não cobre. Centralizar
    /// aqui é o que mantém débito e crédito atômicos sob o mesmo journal: uma
    /// implementação que debitasse e só então descobrisse que não podia creditar
    /// deixaria moeda queimada num revert parcial.
    fn move_value(&mut self, from: &Address, to: &Address, value: Word, kind: TransferKind)
        -> bool;

    /// Incrementa o nonce e devolve o valor ANTERIOR — é ele que entra no endereço.
    fn bump_nonce(&mut self, address: &Address) -> u64;

    /// Hash de um bloco passado (EIP-2935). O padrão é "não tenho histórico".
    ///
    /// A JANELA não é decidida aqui: o host já filtrou antes de chamar. Um mundo que
    /// devolvesse hash fora da janela criaria um opcode com alcance diferente do
    /// resto da rede.
    fn block_hash(&self, _number: u64) -> Word {
        ZERO_WORD
    }

    fn snapshot(&mut self) -> usize;
    fn revert(&mut self, snapshot: usize);

    /// Endereço de um `CREATE` — `keccak256("<sender>:<nonce>")[12..]`.
    ///
    /// NÃO é a fórmula do Ethereum (que é `keccak(rlp([sender, nonce]))[12..]`). A
    /// referência hasheia o TEXTO `"0xabc…:7"`, com o `0x` incluído e o nonce em
    /// decimal ASCII. Está como método PROVIDO — e não deixado a cada mundo — porque
    /// é função pura das entradas: duas implementações discordando aqui colocariam o
    /// mesmo contrato em endereços diferentes.
    fn create_address(&self, sender: &Address, nonce: u64) -> Address {
        let mut h = Keccak256::new();
        h.update(addr_hex(sender).as_bytes());
        h.update(b":");
        h.update(nonce.to_string().as_bytes());
        addr_from_slice(&h.finalize()[12..])
    }

    /// Endereço de um `CREATE2` — `keccak256(sender ‖ salt ‖ keccak(init))[12..]`.
    ///
    /// Também difere do Ethereum: NÃO há o byte `0xff` de prefixo do EIP-1014. É a
    /// forma da referência, e "corrigi-la" quebraria todo endereço de `CREATE2` já
    /// minerado — contratos vivos passariam a morar em outro lugar.
    fn create2_address(&self, sender: &Address, salt: &Word, init_code: &[u8]) -> Address {
        let init_hash = Keccak256::digest(init_code);
        let mut h = Keccak256::new();
        h.update(sender);
        h.update(salt.to_be_bytes::<32>());
        h.update(init_hash);
        addr_from_slice(&h.finalize()[12..])
    }
}

// ---------------------------------------------------------------------------
// O host
// ---------------------------------------------------------------------------

/// Ponte entre o interpretador e o mundo. É o `createHost(world)` da referência.
pub struct EavmHost<'a, W: World + ?Sized> {
    world: &'a mut W,
    /// Altura do fork de Osaka, que decide se 0x06..0x09 são precompiles.
    ///
    /// É campo e não constante global pelo mesmo motivo que
    /// [`ExecParams::osaka_height`] é: o valor tem de fluir do contexto da execução,
    /// para que o conjunto de precompiles de um bloco seja função do BLOCO e não da
    /// configuração de quem o executa.
    osaka_height: u64,
    /// Armazenamento TRANSIENTE (EIP-1153).
    ///
    /// Vive só nesta execução: some quando a transação termina e NUNCA entra no
    /// `stateRoot` — é o ponto do EIP. Por isso é um mapa aqui e não escrita no
    /// mundo.
    ///
    /// DIVERGÊNCIA CONHECIDA, herdada da referência: no EVM, `TSTORE` feito num
    /// frame que REVERTE é desfeito. Este mapa não participa do journal, logo não é
    /// revertido. Está assim de propósito, para bater com o nó de referência (ver
    /// `test/eavm-osaka.test.js`); alinhar com o EVM é mudança de regra de consenso
    /// e precisa de fork por altura.
    transient: HashMap<(Address, Word), Word>,
}

impl<'a, W: World + ?Sized> EavmHost<'a, W> {
    pub fn new(world: &'a mut W) -> Self {
        EavmHost { world, osaka_height: vm::EAVM_OSAKA_HEIGHT, transient: HashMap::new() }
    }

    /// Fixa a altura do fork de Osaka (testes de fork e replay histórico).
    pub fn with_osaka_height(mut self, height: u64) -> Self {
        self.osaka_height = height;
        self
    }

    pub fn world(&self) -> &W {
        self.world
    }

    pub fn world_mut(&mut self) -> &mut W {
        self.world
    }
}

impl<W: World + ?Sized> vm::Host for EavmHost<'_, W> {
    fn sload(&self, addr: &Address, key: &Word) -> Word {
        self.world.get_storage(addr, key)
    }

    fn sstore(&mut self, addr: &Address, key: Word, value: Word) -> Result<(), EavmError> {
        self.world.set_storage(addr, key, value);
        Ok(())
    }

    fn tload(&self, addr: &Address, key: &Word) -> Word {
        self.transient.get(&(*addr, *key)).copied().unwrap_or(ZERO_WORD)
    }

    /// Escrever zero APAGA a entrada em vez de guardá-la.
    ///
    /// Não é otimização: `tload` de chave ausente devolve zero, então guardar zero e
    /// não guardar nada têm de ser o MESMO estado observável. Deixar a entrada
    /// criaria duas representações do mesmo mundo.
    fn tstore(&mut self, addr: &Address, key: Word, value: Word) -> Result<(), EavmError> {
        let k = (*addr, key);
        if value.is_zero() {
            self.transient.remove(&k);
        } else {
            self.transient.insert(k, value);
        }
        Ok(())
    }

    fn balance(&self, addr: &Address) -> Word {
        self.world.get_balance(addr)
    }

    fn code(&self, addr: &Address) -> Vec<u8> {
        self.world.get_code(addr)
    }

    /// `BLOCKHASH` (0x40). Fora da janela de 256 blocos — ou para o bloco atual e
    /// futuros — devolve zero, como em todo EVM.
    fn block_hash(&self, n: Word, atual: u64) -> Word {
        // `n` é uma palavra de 256 bits e o número de bloco cabe em 64: uma altura
        // que não caiba está, por definição, fora da janela. Converter com
        // truncamento em vez de recusar faria `BLOCKHASH(2²⁵⁶−1)` colidir com uma
        // altura legítima.
        let Ok(n) = TryInto::<u64>::try_into(n) else {
            return ZERO_WORD;
        };
        if n >= atual || atual.saturating_sub(n) > BLOCKHASH_WINDOW {
            return ZERO_WORD;
        }
        self.world.block_hash(n)
    }

    fn call(&mut self, req: CallRequest) -> Result<CallOutcome, EavmError> {
        Ok(self.executa_call(&req))
    }

    fn create(&mut self, req: CreateRequest) -> Result<CreateOutcome, EavmError> {
        Ok(self.executa_create(&req))
    }
}

impl<W: World + ?Sized> EavmHost<'_, W> {
    /// `CALL`/`CALLCODE`/`DELEGATECALL`/`STATICCALL`.
    ///
    /// Os quatro compartilham este caminho; o que muda entre eles é como o
    /// interpretador PREENCHE os campos `exec_*` de [`CallRequest`]. Resolver a
    /// diferença lá mantém aqui um único caminho de chamada — que é onde o
    /// isolamento por snapshot mora, e portanto o lugar onde ter quatro cópias seria
    /// mais caro.
    fn executa_call(&mut self, p: &CallRequest) -> CallOutcome {
        if p.depth >= MAX_CALL_DEPTH {
            return CallOutcome::default();
        }

        // A altura vem do BLOCO EM EXECUÇÃO, nunca de configuração do nó. É isso que
        // mantém o conjunto de precompiles idêntico em toda a rede para um dado
        // bloco: um operador que quisesse "adiantar" o fork na sua config
        // simplesmente não consegue.
        let osaka = p.block.number >= self.osaka_height;
        if let Some(id) = precompile_id(&p.to, osaka) {
            return self.chama_precompile(p, id);
        }

        let snap = self.world.snapshot();
        if !p.value.is_zero()
            && !p.delegate
            && !self.world.move_value(&p.caller, &p.exec_address, p.value, TransferKind::Call)
        {
            self.world.revert(snap);
            return CallOutcome::default();
        }

        let code = self.world.get_code(&p.code_addr);
        // Conta sem código é sucesso vazio de graça — e o valor já transferido NÃO é
        // revertido. É como uma transferência simples acontece na EVM.
        if code.is_empty() {
            return CallOutcome { success: true, ..CallOutcome::default() };
        }

        let params = ExecParams {
            code,
            calldata: p.input.clone(),
            gas: p.gas,
            caller: p.exec_caller,
            address: p.exec_address,
            origin: Some(p.origin),
            value: p.exec_value,
            block: p.block,
            gas_price: p.gas_price,
            depth: p.depth,
            is_static: p.is_static,
            osaka_height: self.osaka_height,
        };

        match vm::run_eavm(params, self) {
            Ok(res) => {
                if !res.success {
                    self.world.revert(snap);
                }
                CallOutcome {
                    success: res.success,
                    return_data: res.return_data,
                    gas_used: res.gas_used,
                    // H-1: log só de sub-chamada BEM-SUCEDIDA. Um `LOG` que sobrevive
                    // ao revert do frame que o emitiu é um evento que o explorador
                    // mostra e o estado nega — e contratos que ouvem eventos agiriam
                    // sobre transferências que nunca houve.
                    logs: if res.success { res.logs } else { Vec::new() },
                }
            }
            Err(_) => {
                // Parada excepcional consome TODO o gás encaminhado. É o que impede
                // usar `INVALID` como sonda barata de estado: falhar tem de custar o
                // orçamento inteiro.
                self.world.revert(snap);
                CallOutcome { success: false, gas_used: p.gas, ..CallOutcome::default() }
            }
        }
    }

    fn chama_precompile(&mut self, p: &CallRequest, id: u8) -> CallOutcome {
        let snap = self.world.snapshot();
        if !p.value.is_zero() && !p.delegate {
            // L-2: credita `exec_address`, NÃO `to`. Num `CALLCODE` a um precompile o
            // destino é o próprio chamador (soma zero); creditar `to` mandaria moeda
            // para `0x…01`, onde ela ficaria presa para sempre.
            if !self.world.move_value(&p.caller, &p.exec_address, p.value, TransferKind::Call) {
                self.world.revert(snap);
                return CallOutcome::default();
            }
        }

        // Gás ANTES do trabalho (A-5). Entrada malformada já falha aqui — e falhar
        // aqui custa TODO o gás, que é o que o EIP-7823 manda para o `modexp`.
        let gas = match precompile_gas(id, &p.input) {
            Ok(g) => g,
            Err(_) => {
                self.world.revert(snap);
                return CallOutcome { success: false, gas_used: p.gas, ..CallOutcome::default() };
            }
        };
        if gas > p.gas {
            self.world.revert(snap);
            return CallOutcome { success: false, gas_used: p.gas, ..CallOutcome::default() };
        }

        match precompile_run(id, &p.input) {
            Ok(out) => {
                CallOutcome { success: true, return_data: out, gas_used: gas, logs: Vec::new() }
            }
            Err(_) => {
                self.world.revert(snap);
                CallOutcome { success: false, gas_used: p.gas, ..CallOutcome::default() }
            }
        }
    }

    /// `CREATE` (`salt = None`) e `CREATE2` (`salt = Some`).
    fn executa_create(&mut self, p: &CreateRequest) -> CreateOutcome {
        if p.depth >= MAX_CALL_DEPTH {
            return CreateOutcome { address: ZERO_ADDR, ..CreateOutcome::default() };
        }

        // O nonce sobe ANTES de tudo e — atenção — NÃO é revertido se o `CREATE`
        // falhar logo abaixo por colisão. É o comportamento da referência e o do
        // EVM: um `CREATE` que falha ainda gastou aquele nonce, senão o mesmo
        // endereço poderia ser tentado em laço de graça.
        let nonce = self.world.bump_nonce(&p.caller);
        let address = match p.salt {
            Some(s) => self.world.create2_address(&p.caller, &s, &p.init_code),
            None => self.world.create_address(&p.caller, nonce),
        };

        // B-1: como na EVM, `CREATE` para endereço que JÁ tem código falha. Sem isso,
        // um `CREATE2` com o mesmo salt sobrescreveria um contrato vivo — e todo o
        // modelo de "endereço é compromisso" cairia.
        if !self.world.get_code(&address).is_empty() {
            return CreateOutcome { address, ..CreateOutcome::default() };
        }

        let snap = self.world.snapshot();
        if !p.value.is_zero()
            && !self.world.move_value(&p.caller, &address, p.value, TransferKind::Create)
        {
            self.world.revert(snap);
            return CreateOutcome { address, ..CreateOutcome::default() };
        }

        let params = ExecParams {
            code: p.init_code.clone(),
            calldata: Vec::new(),
            gas: p.gas,
            caller: p.caller,
            address,
            origin: Some(p.origin),
            value: p.value,
            block: p.block,
            gas_price: p.gas_price,
            depth: p.depth,
            // Um construtor NUNCA roda em modo estático: ele existe para escrever.
            is_static: false,
            osaka_height: self.osaka_height,
        };

        let res = match vm::run_eavm(params, self) {
            Ok(r) => r,
            Err(_) => {
                self.world.revert(snap);
                return CreateOutcome { address, gas_used: p.gas, ..CreateOutcome::default() };
            }
        };

        if !res.success {
            // Construtor reverteu: devolve o gás do CONSTRUTOR (não o orçamento
            // inteiro) e a razão do revert, para que `try/catch` do Solidity veja o
            // motivo em vez de um erro genérico.
            self.world.revert(snap);
            return CreateOutcome {
                success: false,
                address,
                return_data: res.return_data,
                gas_used: res.gas_used,
                logs: Vec::new(),
            };
        }

        // M-1: o gás de depósito do código (len × 20) precisa CABER no gás já
        // encaminhado ao construtor. Cobrá-lo do pai depois invadiria o 1/64
        // reservado do EIP-150 e poderia reverter a transação inteira — um vetor de
        // griefing: bastaria devolver um runtime grande para derrubar o pai.
        let deposit = (res.return_data.len() as u64).saturating_mul(CREATE_DEPOSIT_GAS_PER_BYTE);
        if res.return_data.len() > MAX_CONTRACT_BYTES || res.gas_used.saturating_add(deposit) > p.gas
        {
            self.world.revert(snap);
            return CreateOutcome { address, gas_used: p.gas, ..CreateOutcome::default() };
        }

        self.world.put_code(&address, &res.return_data);
        CreateOutcome {
            success: true,
            address,
            // O `CREATE` não propaga o runtime como `RETURNDATA` — ele vira código.
            return_data: Vec::new(),
            gas_used: res.gas_used.saturating_add(deposit),
            logs: res.logs,
        }
    }
}

// ---------------------------------------------------------------------------
// Endereços
// ---------------------------------------------------------------------------

fn addr_from_slice(b: &[u8]) -> Address {
    let mut a = ZERO_ADDR;
    let n = b.len().min(20);
    a[20 - n..].copy_from_slice(&b[b.len() - n..]);
    a
}

/// Endereço em `0x` + 40 hexadecimais MINÚSCULOS — a grafia que a referência
/// hasheia no `CREATE`. Não é cosmético: a caixa entra no digest.
pub fn addr_hex(a: &Address) -> String {
    format!("0x{}", hex::encode(a))
}

/// Endereço de sistema `0x00…0n`.
pub fn addr_from_u8(n: u8) -> Address {
    let mut a = ZERO_ADDR;
    a[19] = n;
    a
}

/// Qual precompile este endereço é, se algum.
///
/// `osaka` decide se 0x06..0x09 contam. ABAIXO do fork eles NÃO são precompiles: o
/// chamador cai no caminho de conta comum e recebe sucesso vazio — exatamente o que
/// um nó antigo faz. Retornar `Some` aqui abaixo da altura cindiria a rede no
/// primeiro bloco em que alguém chamasse 0x08.
fn precompile_id(address: &Address, osaka: bool) -> Option<u8> {
    if address[..19].iter().any(|&b| b != 0) {
        return None;
    }
    match address[19] {
        n @ 1..=5 => Some(n),
        n @ 6..=9 if osaka => Some(n),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Precompiles
//
// Dois passos por design: `precompile_gas` só olha o FORMATO da entrada e é
// barato; `precompile_run` faz a conta. O host cobra entre um e outro (A-5).
// ---------------------------------------------------------------------------

fn erro(msg: &str) -> EavmError {
    EavmError::Host(msg.to_string())
}

/// Custo de um precompile, a partir do formato da entrada.
///
/// `Err` significa entrada inválida por REGRA (comprimento fora do EIP), e o host
/// converte isso em "consome todo o gás" — não em "sai barato".
pub fn precompile_gas(id: u8, input: &[u8]) -> Result<u64, EavmError> {
    let words = |n: usize| (n as u64).div_ceil(32);
    match id {
        // 0x01 — ecrecover. Preço FIXO e alto, deliberadamente descolado do EIP-196
        // (3000): rastreia o CPU real de uma recuperação e limita a ~60 recovers por
        // transação. Multisig e `permit` usam poucos, então o uso legítimo não
        // sente; um laço de recovers, sim.
        1 => Ok(500_000),
        2 => Ok(60 + 12 * words(input.len())),
        3 => Ok(600 + 120 * words(input.len())),
        4 => Ok(15 + 3 * words(input.len())),
        5 => modexp_gas_from_input(input),
        6 => Ok(150 * BN254_GAS_MULTIPLIER),
        7 => Ok(6000 * BN254_GAS_MULTIPLIER),
        8 => {
            // Comprimento fora do múltiplo de 192 é inválido por REGRA, e a checagem
            // mora aqui — no passo do gás — para que uma entrada malformada de 10 MB
            // seja rejeitada sem nunca ser interpretada.
            if !input.len().is_multiple_of(192) {
                return Err(erro("BN254: entrada do pairing não é múltiplo de 192"));
            }
            let k = (input.len() / 192) as u64;
            Ok((34_000u64.saturating_mul(k).saturating_add(45_000))
                .saturating_mul(BN254_GAS_MULTIPLIER))
        }
        9 => {
            // Validação ANTES de qualquer trabalho: o EIP-152 exige tamanho EXATO
            // (nada de preenchimento à direita como em 0x01..0x05) e `f` binário.
            if input.len() != BLAKE2F_INPUT_LEN {
                return Err(erro("BLAKE2F: entrada deve ter exatamente 213 bytes"));
            }
            if input[212] > 1 {
                return Err(erro("BLAKE2F: flag de bloco final inválida"));
            }
            // 1 gás por rodada (GFROUND = 1). O teto é 0xffffffff — caríssimo, mas
            // LEGÍTIMO: nenhum limite artificial. É exatamente por isso que o gás é
            // cobrado antes; `rounds = 0xffffffff` morre por falta de saldo.
            Ok(u32::from_be_bytes([input[0], input[1], input[2], input[3]]) as u64)
        }
        _ => Err(erro("precompile inexistente")),
    }
}

/// Executa um precompile. Só é chamado depois de o gás ter sido debitado.
pub fn precompile_run(id: u8, input: &[u8]) -> Result<Vec<u8>, EavmError> {
    match id {
        1 => Ok(ecrecover(input)),
        // Qualificado: `sha2` 0.11 e `sha3` 0.10 trazem traits `Digest` DIFERENTES, e
        // só um pode estar em escopo por importação.
        2 => Ok(<sha2::Sha256 as sha2::Digest>::digest(input).to_vec()),
        3 => Ok(pad32(&ripemd::Ripemd160::digest(input))),
        4 => Ok(input.to_vec()),
        5 => modexp_run(input),
        6 => bn254_ec_add(input),
        7 => bn254_ec_mul(input),
        8 => bn254_ec_pairing(input),
        9 => blake2f(input),
        _ => Err(erro("precompile inexistente")),
    }
}

// -- utilitários de codificação ---------------------------------------------

/// Alinha à DIREITA em 32 bytes.
fn pad32(b: &[u8]) -> Vec<u8> {
    let mut o = vec![0u8; 32];
    let n = b.len().min(32);
    o[32 - n..].copy_from_slice(&b[b.len() - n..]);
    o
}

/// Preenche com zeros à DIREITA até `n` bytes (ou trunca).
///
/// É a semântica de leitura de calldata da EVM: o precompile enxerga a entrada como
/// registro de tamanho fixo, e o que faltar vale zero. Só o 0x09 foge disso, por
/// exigência explícita do EIP-152 — e a exceção existe porque `rounds` fica no
/// começo da entrada, então preencher seria uma forma de esconder trabalho.
fn right_pad(b: &[u8], n: usize) -> Vec<u8> {
    let mut o = vec![0u8; n];
    let k = b.len().min(n);
    o[..k].copy_from_slice(&b[..k]);
    o
}

fn word_at(b: &[u8], off: usize) -> [u8; 32] {
    let mut w = [0u8; 32];
    let end = (off + 32).min(b.len());
    if off < end {
        w[..end - off].copy_from_slice(&b[off..end]);
    }
    w
}

// -- 0x01 ecrecover ----------------------------------------------------------

/// Ordem do grupo secp256k1. `pub(crate)` porque o envelope EAVM
/// (`super::envelope`) precisa da MESMA constante para a regra EIP-2 (`s` alto
/// rejeitado) — duplicá-la seria convidar uma divergência de um dígito.
pub(crate) const SECP256K1_N: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];

/// `ecrecover` (0x01).
///
/// # O `s` alto — o detalhe que cinde a rede se for ignorado
///
/// A referência ACEITA assinatura com `s` alto: ela só faz a álgebra, sem regra de
/// canonicidade. O `k256` REJEITA `s` alto, porque para Bitcoin e para o Ethereum
/// pós-Homestead `s` alto é inválido por consenso. Aqui não é — e cerca de 52% das
/// assinaturas que o Node produz (OpenSSL não normaliza) têm `s` alto. Passar
/// direto ao `k256` faria este cliente rejeitar metade das assinaturas que a rede
/// aceita: cisão determinística, na primeira transação.
///
/// A conversão NÃO é só baixar o `s`, como faz `signature.rs`. Lá só se VERIFICA, e
/// `(r, s)` e `(r, n − s)` verificam contra a mesma chave. Aqui se RECUPERA a chave
/// a partir de `(r, s, v)`, e trocar `s` por `n − s` corresponde a negar o ponto
/// `R` — o que inverte a PARIDADE de `R.y`, isto é, o bit 0 do `recId`.
///
/// Com `R' = −R` e `s' = n − s`:
///   `Q' = r⁻¹(s'R' − zG) = r⁻¹(−(n − s)R − zG) = r⁻¹(sR − zG) = Q`,
/// porque `nR = O`. Baixar o `s` SEM inverter o `recId` recuperaria uma chave
/// DIFERENTE — e o precompile devolveria um endereço espúrio em vez de erro, o que é
/// pior do que rejeitar: um contrato de multisig aceitaria um "signatário" que nunca
/// assinou.
fn ecrecover(input: &[u8]) -> Vec<u8> {
    let d = right_pad(input, 128);
    let Ok(hash) = TryInto::<[u8; 32]>::try_into(&d[0..32]) else {
        return Vec::new();
    };

    // `v` ocupa uma palavra inteira, mas só 27 e 28 valem: os 31 bytes altos TÊM de
    // ser zero. Aceitar lixo neles daria duas codificações do mesmo `v`.
    if d[32..63].iter().any(|&b| b != 0) {
        return Vec::new();
    }
    let v = d[63];
    if v != 27 && v != 28 {
        return Vec::new();
    }

    let n = BigUint::from_bytes_be(&SECP256K1_N);
    let r = BigUint::from_bytes_be(&d[64..96]);
    let s = BigUint::from_bytes_be(&d[96..128]);
    // r, s ∈ [1, n−1]. Fora disso a recuperação daria endereço espúrio em vez de
    // falhar — e um contrato que compare o retorno com `address(0)` para detectar
    // erro seria enganado.
    if r.bits() == 0 || s.bits() == 0 || r >= n || s >= n {
        return Vec::new();
    }

    let mut rec_id = v - 27;
    let metade = &n >> 1u32;
    let s_norm = if s > metade {
        rec_id ^= 1; // ver acima: negar R inverte a paridade
        &n - &s
    } else {
        s.clone()
    };

    match recover_eth_address(&hash, &r, &s_norm, rec_id) {
        Some(endereco) => pad32(&endereco),
        None => Vec::new(),
    }
}

/// Núcleo da recuperação ECDSA: `(hash 32B, r, s, recId)` → endereço Ethereum de
/// 20 bytes (`keccak256(X‖Y sem o prefixo SEC1 0x04)[12..]`), ou `None` quando a
/// assinatura não recupera ponto nenhum.
///
/// Partilhado entre DOIS chamadores de consenso, de propósito — a recuperação é
/// exatamente a mesma conta e escrevê-la duas vezes é abrir espaço para os dois
/// caminhos divergirem:
///
/// - o precompile 0x01 acima, que aceita `s` alto e o NORMALIZA antes de chegar
///   aqui (invertendo o `recId` — ver a nota longa do `ecrecover`);
/// - o envelope EAVM (`super::envelope`), que REJEITA `s` alto por EIP-2
///   (`tx.js:71`) antes de recuperar — como faz a referência.
///
/// Nos dois, o `s` que entra é sempre baixo, o único que o `k256` aceita em
/// recuperação. `recId` segue o `recover` da referência (`secp256k1.js:123-133`):
/// 0..=3, onde o bit 1 indica `x = r + n` — o `RecoveryId::from_byte` do `k256`
/// tem a mesma semântica. Fora de faixa, `r`/`s` nulos ou ≥ n: `None`, que é o
/// `null` da referência.
pub(crate) fn recover_eth_address(
    hash: &[u8; 32],
    r: &BigUint,
    s: &BigUint,
    rec_id: u8,
) -> Option<[u8; 20]> {
    use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

    // `from_scalars` já rejeita zero e ≥ n — os mesmos casos em que o `recover`
    // da referência devolve null (`secp256k1.js:124`).
    let sig = Signature::from_scalars(to_32_be(r), to_32_be(s)).ok()?;
    let rid = RecoveryId::from_byte(rec_id)?;
    let vk = VerifyingKey::recover_from_prehash(hash, &sig, rid).ok()?;

    // Endereço no estilo Ethereum: keccak256 das coordenadas X‖Y SEM o prefixo SEC1
    // `0x04`, últimos 20 bytes (`ethAddressFromPoint`, `secp256k1.js:167-170`).
    let ponto = vk.to_sec1_point(false);
    let bytes = ponto.as_bytes();
    if bytes.len() != 65 {
        return None;
    }
    let digest = Keccak256::digest(&bytes[1..]);
    let mut fora = [0u8; 20];
    fora.copy_from_slice(&digest[12..]);
    Some(fora)
}

fn to_32_be(v: &BigUint) -> k256::FieldBytes {
    let b = v.to_bytes_be();
    let mut out = k256::FieldBytes::default();
    let n = b.len().min(32);
    out[32 - n..].copy_from_slice(&b[b.len() - n..]);
    out
}

// -- 0x05 modexp -------------------------------------------------------------

/// EIP-7823: teto de 1024 bytes para CADA operando (base, expoente, módulo).
///
/// Começou como defesa nossa contra OOM; virou regra de consenso. Estourar é erro
/// que consome TODO o gás — daí ser `Err` e não uma saída vazia.
const MODEXP_MAX_LEN: u64 = 1024;

fn modexp_lengths(input: &[u8]) -> Result<(usize, usize, usize), EavmError> {
    let d = right_pad(input, 96);
    // Lidos como big-endian de 256 bits e comparados como tal: converter para
    // `usize` primeiro TRUNCARIA, e um comprimento absurdo passaria pelo teto —
    // exatamente o operando que o EIP-7823 existe para barrar.
    let big = |o: usize| BigUint::from_bytes_be(&d[o..o + 32]);
    let (bl, el, ml) = (big(0), big(32), big(64));
    let teto = BigUint::from(MODEXP_MAX_LEN);
    if bl > teto || el > teto || ml > teto {
        return Err(erro("MODEXP: operando excede o limite"));
    }
    // Cabem em `usize` porque acabaram de passar pelo teto de 1024.
    let como_usize = |v: BigUint| v.to_u32_digits().first().copied().unwrap_or(0) as usize;
    Ok((como_usize(bl), como_usize(el), como_usize(ml)))
}

/// EIP-7883 (Osaka), que revisa o EIP-2565: complexidade × iterações, com piso 500.
///
/// O que o 7883 mudou em relação ao 2565: (a) sumiu o `/3`, (b) o multiplicador do
/// expoente acima de 32 bytes foi de 8 para 16, (c) a complexidade ganhou piso 16 e
/// dobrou (`2·words²`) quando base ou módulo passam de 32 bytes.
fn modexp_gas(bl: usize, el: usize, ml: usize, exp_head: &BigUint) -> u64 {
    let max_len = bl.max(ml) as u64;
    let words = max_len.div_ceil(8);
    let complexity = if max_len > 32 { 2 * words * words } else { 16 };

    // `exp_head` são os PRIMEIROS 32 bytes do expoente, não o expoente inteiro: o
    // custo cresce com o COMPRIMENTO (16 por byte além de 32), não com o valor da
    // cauda. Cotar pelo valor inteiro subprecificava um expoente de 1024 bytes com
    // os bits altos zerados — era o furo da versão anterior desta função.
    let bit_len = exp_head.bits(); // 0 quando exp_head == 0
    let iters: u64 = if el <= 32 {
        if bit_len == 0 { 0 } else { bit_len - 1 }
    } else {
        16u64.saturating_mul(el as u64 - 32).saturating_add(bit_len.saturating_sub(1))
    };
    complexity.saturating_mul(iters.max(1)).max(500)
}

fn modexp_gas_from_input(input: &[u8]) -> Result<u64, EavmError> {
    let (bl, el, ml) = modexp_lengths(input)?;
    let body = input.get(96..).unwrap_or(&[]);
    let head_len = el.min(32);
    let head = BigUint::from_bytes_be(&right_pad(fatia(body, bl, bl + head_len), head_len));
    Ok(modexp_gas(bl, el, ml, &head))
}

/// Fatia tolerante: fora do fim devolve vazio, e o chamador preenche com zero.
///
/// Indexar direto seria pânico — e pânico em caminho de consenso é um nó derrubado
/// por calldata truncada, isto é, DoS ao preço de uma transação.
fn fatia(b: &[u8], ini: usize, fim: usize) -> &[u8] {
    let ini = ini.min(b.len());
    let fim = fim.min(b.len()).max(ini);
    &b[ini..fim]
}

fn modexp_run(input: &[u8]) -> Result<Vec<u8>, EavmError> {
    let (bl, el, ml) = modexp_lengths(input)?;
    if bl == 0 && ml == 0 {
        return Ok(Vec::new());
    }
    let body = input.get(96..).unwrap_or(&[]);
    let base = BigUint::from_bytes_be(&right_pad(fatia(body, 0, bl), bl));
    let exp = BigUint::from_bytes_be(&right_pad(fatia(body, bl, bl + el), el));
    let modulo = BigUint::from_bytes_be(&right_pad(fatia(body, bl + el, bl + el + ml), ml));

    let out = if modulo.bits() == 0 {
        BigUint::ZERO
    } else if exp.bits() == 0 {
        // DIVERGÊNCIA DELIBERADA do EIP, herdada da referência.
        //
        // O laço da referência começa com `r = 1` e não entra quando o expoente é
        // zero, então devolve 1 SEM reduzir pelo módulo. Para módulo 1 o EIP manda 0
        // (x⁰ mod 1 = 0) e a referência dá 1. `modpow` daria 0 e este cliente
        // divergiria justamente no caso de canto que ninguém exercita em produção —
        // até o dia em que alguém exercita. Consenso ganha do EIP: alinhar exige
        // fork por altura.
        BigUint::from(1u8)
    } else {
        base.modpow(&exp, &modulo)
    };

    // Saída com EXATAMENTE `ml` bytes, alinhada à direita.
    let mut o = vec![0u8; ml];
    if out.bits() > 0 {
        let b = out.to_bytes_be();
        let n = b.len().min(ml);
        o[ml - n..].copy_from_slice(&b[b.len() - n..]);
    }
    Ok(o)
}

// -- 0x06/0x07/0x08 BN254 ----------------------------------------------------
//
// `ark-bn254` faz a matemática. A política do crate é explícita: pairing são ~590
// linhas de corpo finito onde um erro é forjabilidade SILENCIOSA (a prova falsa
// verifica, ninguém percebe), e existe crate auditado. O que fica NOSSO aqui é só a
// codificação do EIP-196/197 e a validação de entrada — que é, não por acaso, onde
// os bugs históricos deste precompile de fato moram.

use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ec::pairing::Pairing;
use ark_ec::{AffineRepr, CurveGroup};
use ark_ff::{PrimeField, Zero};

/// Lê 32 bytes big-endian como elemento de Fp.
///
/// Coordenada ≥ p é INVÁLIDA — e isso importa: aceitar reduziria módulo p e criaria
/// múltiplas codificações do MESMO ponto. Duas grafias de um ponto é maleabilidade,
/// e qualquer esquema que dependa da unicidade da codificação (nulificador de
/// zero-knowledge, dedup de prova) deixa de valer.
fn read_fq(b: &[u8], off: usize) -> Result<Fq, EavmError> {
    let v = BigUint::from_bytes_be(&word_at(b, off));
    if v >= Fq::MODULUS.into() {
        return Err(erro("BN254: coordenada >= p"));
    }
    Ok(Fq::from(v))
}

fn write_fq(v: &Fq) -> [u8; 32] {
    let b: BigUint = (*v).into();
    let bytes = b.to_bytes_be();
    let mut o = [0u8; 32];
    let n = bytes.len().min(32);
    o[32 - n..].copy_from_slice(&bytes[bytes.len() - n..]);
    o
}

/// Ponto de G1. `(0, 0)` é a codificação canônica do infinito (EIP-196).
fn read_g1(b: &[u8], off: usize) -> Result<G1Affine, EavmError> {
    let x = read_fq(b, off)?;
    let y = read_fq(b, off + 32)?;
    if x.is_zero() && y.is_zero() {
        return Ok(G1Affine::identity());
    }
    let p = G1Affine::new_unchecked(x, y);
    if !p.is_on_curve() {
        return Err(erro("BN254: ponto G1 fora da curva"));
    }
    // G1 tem cofator 1: estar na curva JÁ implica ordem r. Por isso — e só por
    // isso — não há verificação de subgrupo aqui. Em G2 há, e é obrigatória.
    Ok(p)
}

fn write_g1(p: &G1Affine) -> Vec<u8> {
    let mut o = vec![0u8; 64];
    if let Some((x, y)) = p.xy() {
        o[..32].copy_from_slice(&write_fq(&x));
        o[32..].copy_from_slice(&write_fq(&y));
    }
    o
}

/// Ponto de G2.
///
/// ATENÇÃO À ORDEM: o EIP-197 codifica cada elemento de Fp2 com a parte IMAGINÁRIA
/// primeiro — os 128 bytes são `(x_im, x_re, y_im, y_re)`. Trocar isso é o bug
/// clássico deste precompile, e ele não aparece em teste de fumaça: pontos
/// arbitrários simplesmente caem fora da curva e tudo "parece" rejeitar direito. Só
/// um vetor oficial pega.
fn read_g2(b: &[u8], off: usize) -> Result<G2Affine, EavmError> {
    let x_im = read_fq(b, off)?;
    let x_re = read_fq(b, off + 32)?;
    let y_im = read_fq(b, off + 64)?;
    let y_re = read_fq(b, off + 96)?;
    let x = Fq2::new(x_re, x_im);
    let y = Fq2::new(y_re, y_im);
    if x.is_zero() && y.is_zero() {
        return Ok(G2Affine::identity());
    }
    let p = G2Affine::new_unchecked(x, y);
    if !p.is_on_curve() {
        return Err(erro("BN254: ponto G2 fora da curva"));
    }
    // CRÍTICO: E'(Fp2) tem cofator GRANDE, então "estar na curva" NÃO implica ordem
    // r. Sem esta checagem o pairing é FORJÁVEL — dá para montar uma prova Groth16
    // falsa que verifica. É a diferença entre um precompile de pairing e um oráculo
    // que responde "sim".
    if !p.is_in_correct_subgroup_assuming_on_curve() {
        return Err(erro("BN254: ponto G2 fora do subgrupo de ordem r"));
    }
    Ok(p)
}

fn bn254_ec_add(input: &[u8]) -> Result<Vec<u8>, EavmError> {
    let d = right_pad(input, 128);
    let a = read_g1(&d, 0)?;
    let b = read_g1(&d, 64)?;
    Ok(write_g1(&(a + b).into_affine()))
}

fn bn254_ec_mul(input: &[u8]) -> Result<Vec<u8>, EavmError> {
    let d = right_pad(input, 96);
    let p = read_g1(&d, 0)?;
    // O escalar NÃO é validado: qualquer inteiro de 256 bits vale, e a multiplicação
    // é feita módulo a ordem do grupo. `from_be_bytes_mod_order` é exatamente o
    // `k % R` da referência.
    let k = Fr::from_be_bytes_mod_order(&d[64..96]);
    Ok(write_g1(&(p * k).into_affine()))
}

fn bn254_ec_pairing(input: &[u8]) -> Result<Vec<u8>, EavmError> {
    if !input.len().is_multiple_of(192) {
        return Err(erro("BN254: entrada do pairing não é múltiplo de 192"));
    }
    let k = input.len() / 192;
    let mut g1 = Vec::with_capacity(k);
    let mut g2 = Vec::with_capacity(k);
    for i in 0..k {
        let off = i * 192;
        let p = read_g1(input, off)?;
        let q = read_g2(input, off + 64)?;
        // Um par com ponto no infinito contribui e(O, Q) = e(P, O) = 1 e pode ser
        // descartado — mas SÓ DEPOIS de validar os dois. Descartar antes deixaria um
        // G2 fora do subgrupo entrar sem checagem, emparelhado com um G1 no infinito
        // escolhido pelo atacante exatamente para pular a validação.
        if !p.is_zero() && !q.is_zero() {
            g1.push(p);
            g2.push(q);
        }
    }
    // Produto vazio (inclusive entrada vazia) é o elemento neutro ⇒ resultado 1. Em
    // arkworks o grupo alvo é escrito ADITIVAMENTE, então o neutro é `zero` — e não
    // `one`, que é o erro natural de quem vem da notação multiplicativa.
    let ok = g1.is_empty() || Bn254::multi_pairing(&g1, &g2).is_zero();
    let mut out = vec![0u8; 32];
    out[31] = u8::from(ok);
    Ok(out)
}

// -- 0x09 blake2f ------------------------------------------------------------

/// 4 (rounds) + 64 (h) + 128 (m) + 16 (t) + 1 (f).
const BLAKE2F_INPUT_LEN: usize = 213;

/// IV do BLAKE2b — os mesmos oito primeiros da raiz do primo que o SHA-512 usa.
const BLAKE2B_IV: [u64; 8] = [
    0x6a09e667f3bcc908,
    0xbb67ae8584caa73b,
    0x3c6ef372fe94f82b,
    0xa54ff53a5f1d36f1,
    0x510e527fade682d1,
    0x9b05688c2b3e6c1f,
    0x1f83d9abfb41bd6b,
    0x5be0cd19137e2179,
];

/// Permutações SIGMA (RFC 7693 §2.7).
///
/// O BLAKE2b usa 12 rodadas, mas o precompile aceita `rounds` arbitrário — a rodada
/// `i` usa `SIGMA[i % 10]`. É essa liberdade que permite verificar provas de
/// Equihash/Zcash na EVM sem embutir um hash inteiro no protocolo.
const SIGMA: [[usize; 16]; 10] = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

#[allow(clippy::too_many_arguments)]
fn mix(v: &mut [u64; 16], a: usize, b: usize, c: usize, d: usize, x: u64, y: u64) {
    // `wrapping_add` e não `+`: o perfil de release deste crate liga
    // `overflow-checks`, então uma soma comum PANICARIA — e pânico em consenso é
    // DoS. Aqui o transbordo é a DEFINIÇÃO da função, não um acidente.
    v[a] = v[a].wrapping_add(v[b]).wrapping_add(x);
    v[d] = (v[d] ^ v[a]).rotate_right(32);
    v[c] = v[c].wrapping_add(v[d]);
    v[b] = (v[b] ^ v[c]).rotate_right(24);
    v[a] = v[a].wrapping_add(v[b]).wrapping_add(y);
    v[d] = (v[d] ^ v[a]).rotate_right(16);
    v[c] = v[c].wrapping_add(v[d]);
    v[b] = (v[b] ^ v[c]).rotate_right(63);
}

/// Função de compressão F do BLAKE2b (RFC 7693 §3.2).
pub fn blake2b_compress(h: &mut [u64; 8], m: &[u64; 16], t0: u64, t1: u64, f: bool, rounds: u32) {
    let mut v = [0u64; 16];
    v[..8].copy_from_slice(h);
    v[8..].copy_from_slice(&BLAKE2B_IV);
    v[12] ^= t0;
    v[13] ^= t1;
    if f {
        v[14] = !v[14]; // bloco final inverte TODOS os bits de v[14]
    }
    for r in 0..rounds as usize {
        let s = &SIGMA[r % 10];
        // colunas
        mix(&mut v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
        mix(&mut v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
        mix(&mut v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
        mix(&mut v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
        // diagonais
        mix(&mut v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
        mix(&mut v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
        mix(&mut v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
        mix(&mut v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    for i in 0..8 {
        h[i] ^= v[i] ^ v[i + 8];
    }
}

/// Precompile 0x09 (EIP-152).
///
/// Só a COMPRESSÃO é exposta on-chain. Deixar o *modo* (padding, encadeamento,
/// keying) a cargo do contrato é o que torna o precompile útil para verificar provas
/// de outras cadeias, em vez de só calcular um hash.
///
/// Layout, EXATAMENTE 213 bytes: `[0,4)` rounds u32 BIG-endian (único campo BE),
/// `[4,68)` h 8×u64 LE, `[68,196)` m 16×u64 LE, `[196,212)` t 2×u64 LE,
/// `[212]` f ∈ {0, 1}.
fn blake2f(input: &[u8]) -> Result<Vec<u8>, EavmError> {
    // Revalidado aqui, e não só em `precompile_gas`, porque as duas funções são
    // públicas e nada obriga um chamador futuro a passar pela primeira. Um precompile
    // que confia em validação feita por OUTRA função é um índice fora de faixa
    // esperando acontecer — e índice fora de faixa em Rust é pânico, ou seja, DoS.
    if input.len() != BLAKE2F_INPUT_LEN {
        return Err(erro("BLAKE2F: entrada deve ter exatamente 213 bytes"));
    }
    let f = input[212];
    if f > 1 {
        return Err(erro("BLAKE2F: flag de bloco final inválida"));
    }
    let rounds = u32::from_be_bytes([input[0], input[1], input[2], input[3]]);

    let le = |off: usize| -> u64 {
        let mut b = [0u8; 8];
        b.copy_from_slice(&input[off..off + 8]);
        u64::from_le_bytes(b)
    };
    let mut h = [0u64; 8];
    for (i, item) in h.iter_mut().enumerate() {
        *item = le(4 + i * 8);
    }
    let mut m = [0u64; 16];
    for (i, item) in m.iter_mut().enumerate() {
        *item = le(68 + i * 8);
    }
    blake2b_compress(&mut h, &m, le(196), le(204), f == 1, rounds);

    let mut out = Vec::with_capacity(64);
    for word in h {
        out.extend_from_slice(&word.to_le_bytes());
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use vm::{BlockContext, CallKind, Host as _};

    // -- mundo em memória, com o mesmo journaling da referência ---------------

    #[derive(Default, Clone)]
    struct Conta {
        code: Vec<u8>,
        storage: HashMap<Word, Word>,
        balance: Word,
        nonce: u64,
    }

    /// Entrada do undo-log. Tradução direta do `journal` de `#eavmWorld`.
    enum Undo {
        Nova(Address),
        Codigo(Address, Vec<u8>),
        Storage(Address, Word, Option<Word>),
        Saldo(Address, Word),
        Nonce(Address, u64),
    }

    #[derive(Default)]
    struct MundoMemoria {
        contas: HashMap<Address, Conta>,
        journal: Vec<Undo>,
        hashes: HashMap<u64, Word>,
    }

    impl MundoMemoria {
        fn get(&mut self, a: &Address) -> &mut Conta {
            if !self.contas.contains_key(a) {
                self.contas.insert(*a, Conta::default());
                self.journal.push(Undo::Nova(*a));
            }
            self.contas.get_mut(a).expect("acabou de ser inserida")
        }
        fn ajusta(&mut self, a: &Address, novo: Word) {
            let atual = self.get_balance(a);
            self.journal.push(Undo::Saldo(*a, atual));
            self.get(a).balance = novo;
        }
        fn credita(&mut self, a: &Address, d: u64) {
            let novo = self.get_balance(a) + Word::from(d);
            self.ajusta(a, novo);
        }
    }

    impl World for MundoMemoria {
        fn get_storage(&self, a: &Address, k: &Word) -> Word {
            self.contas.get(a).and_then(|c| c.storage.get(k)).copied().unwrap_or(ZERO_WORD)
        }
        fn set_storage(&mut self, a: &Address, k: Word, v: Word) {
            let antigo = self.contas.get(a).and_then(|c| c.storage.get(&k)).copied();
            self.journal.push(Undo::Storage(*a, k, antigo));
            let c = self.get(a);
            if v.is_zero() {
                c.storage.remove(&k);
            } else {
                c.storage.insert(k, v);
            }
        }
        fn get_code(&self, a: &Address) -> Vec<u8> {
            self.contas.get(a).map(|c| c.code.clone()).unwrap_or_default()
        }
        fn put_code(&mut self, a: &Address, code: &[u8]) {
            let antigo = self.contas.get(a).map(|c| c.code.clone()).unwrap_or_default();
            self.journal.push(Undo::Codigo(*a, antigo));
            self.get(a).code = code.to_vec();
        }
        fn get_balance(&self, a: &Address) -> Word {
            self.contas.get(a).map(|c| c.balance).unwrap_or(ZERO_WORD)
        }
        fn move_value(&mut self, from: &Address, to: &Address, v: Word, _k: TransferKind) -> bool {
            if self.get_balance(from) < v {
                return false;
            }
            // Sequencial, e NÃO os dois novos saldos calculados do estado antigo:
            // numa transferência self → self (CALLCODE ao precompile) calcular em
            // paralelo faria a segunda escrita sobrescrever a primeira e CRIAR moeda.
            let nf = self.get_balance(from) - v;
            self.ajusta(from, nf);
            let nt = self.get_balance(to) + v;
            self.ajusta(to, nt);
            true
        }
        fn bump_nonce(&mut self, a: &Address) -> u64 {
            let n = self.contas.get(a).map(|c| c.nonce).unwrap_or(0);
            self.journal.push(Undo::Nonce(*a, n));
            self.get(a).nonce = n + 1;
            n
        }
        fn block_hash(&self, n: u64) -> Word {
            self.hashes.get(&n).copied().unwrap_or(ZERO_WORD)
        }
        fn snapshot(&mut self) -> usize {
            self.journal.len()
        }
        fn revert(&mut self, snap: usize) {
            while self.journal.len() > snap {
                match self.journal.pop() {
                    Some(Undo::Nova(a)) => {
                        self.contas.remove(&a);
                    }
                    Some(Undo::Codigo(a, c)) => {
                        if let Some(x) = self.contas.get_mut(&a) {
                            x.code = c;
                        }
                    }
                    Some(Undo::Storage(a, k, v)) => {
                        if let Some(x) = self.contas.get_mut(&a) {
                            match v {
                                Some(v) => x.storage.insert(k, v),
                                None => x.storage.remove(&k),
                            };
                        }
                    }
                    Some(Undo::Saldo(a, b)) => {
                        if let Some(x) = self.contas.get_mut(&a) {
                            x.balance = b;
                        }
                    }
                    Some(Undo::Nonce(a, n)) => {
                        if let Some(x) = self.contas.get_mut(&a) {
                            x.nonce = n;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    // -- bytecode mínimo para exercitar CALL/CREATE de verdade ----------------
    //
    // Os testes de isolamento rodam o INTERPRETADOR de verdade (`vm::run_eavm`), e
    // não um simulacro: o que se quer provar é que snapshot e revert casam com o que
    // a VM realmente faz com o estado. Um executor de brinquedo provaria só que o
    // host concorda consigo mesmo.

    /// `PUSH1 v`.
    fn push1(v: u8) -> Vec<u8> {
        vec![0x60, v]
    }
    /// `SSTORE slot <- valor`.
    fn sstore(slot: u8, valor: u8) -> Vec<u8> {
        [push1(valor), push1(slot), vec![0x55]].concat()
    }
    /// `REVERT` sem dados de retorno.
    fn revert() -> Vec<u8> {
        [push1(0), push1(0), vec![0xfd]].concat()
    }
    /// `STOP`.
    fn stop() -> Vec<u8> {
        vec![0x00]
    }
    /// Opcode inválido: parada excepcional que consome todo o gás.
    fn invalido() -> Vec<u8> {
        vec![0xfe]
    }
    /// `CALL(gas, addr, 0, 0, 0, 0, 0)` — sem valor e sem argumentos.
    fn call_para(addr: &Address, gas: u32) -> Vec<u8> {
        let mut c = Vec::new();
        // A pilha do CALL é consumida do topo: gas, addr, value, argOff, argLen,
        // retOff, retLen. Empilhamos na ordem inversa.
        for x in [0u8, 0, 0, 0, 0] {
            c.extend(push1(x)); // retLen, retOff, argLen, argOff, value
        }
        c.push(0x73); // PUSH20 <endereço>
        c.extend_from_slice(addr);
        c.push(0x62); // PUSH3 <gás encaminhado>
        c.extend_from_slice(&gas.to_be_bytes()[1..]);
        c.push(0xf1); // CALL
        c.push(0x50); // POP do indicador de sucesso
        c
    }

    const A: Address = [0xaa; 20];
    const B: Address = [0xbb; 20];
    const C: Address = [0xcc; 20];

    fn bloco() -> BlockContext {
        BlockContext { number: vm::EAVM_OSAKA_HEIGHT, timestamp: 0, gas_limit: 0, chain_id: 1 }
    }

    fn req(to: Address, gas: u64) -> CallRequest {
        CallRequest {
            kind: CallKind::Call,
            caller: A,
            to,
            value: Word::ZERO,
            input: Vec::new(),
            gas,
            is_static: false,
            delegate: false,
            code_addr: to,
            exec_address: to,
            exec_caller: A,
            exec_value: Word::ZERO,
            depth: 0,
            block: bloco(),
            origin: A,
            gas_price: Word::ZERO,
        }
    }

    fn cria(caller: Address, init: Vec<u8>, salt: Option<Word>, gas: u64) -> CreateRequest {
        CreateRequest {
            caller,
            value: Word::ZERO,
            init_code: init,
            gas,
            salt,
            depth: 0,
            block: bloco(),
            origin: caller,
            gas_price: Word::ZERO,
        }
    }

    fn w(n: u64) -> Word {
        Word::from(n)
    }

    fn hexb(s: &str) -> Vec<u8> {
        hex::decode(s).expect("hexadecimal do teste")
    }

    // -- isolamento por snapshot ---------------------------------------------

    #[test]
    fn subchamada_revertida_desfaz_so_as_mudancas_dela() {
        let mut mundo = MundoMemoria::default();
        // B escreve slot 2 e REVERTE.
        mundo.put_code(&B, &[sstore(2, 2), revert()].concat());
        // A escreve slot 1, chama B, escreve slot 3.
        mundo.put_code(&A, &[sstore(1, 1), call_para(&B, 200), sstore(3, 3), stop()].concat());
        let mut host = EavmHost::new(&mut mundo);
        let r = host.call(req(A, 1_000_000)).expect("host não propaga erro");
        assert!(r.success);

        assert_eq!(mundo.get_storage(&A, &w(1)), w(1), "escrita do pai ANTES da sub-chamada");
        assert_eq!(mundo.get_storage(&A, &w(3)), w(3), "escrita do pai DEPOIS da sub-chamada");
        assert_eq!(
            mundo.get_storage(&B, &w(2)),
            ZERO_WORD,
            "escrita do filho revertido tem de sumir"
        );
    }

    #[test]
    fn log_de_subchamada_revertida_nao_vaza() {
        // H-1: um LOG que sobrevive ao revert do frame que o emitiu é um evento que o
        // explorador mostra e o estado nega.
        let mut mundo = MundoMemoria::default();
        // LOG0(0, 0) e depois REVERT
        mundo.put_code(&B, &[push1(0), push1(0), vec![0xa0], revert()].concat());
        let mut host = EavmHost::new(&mut mundo);
        let r = host.call(req(B, 1_000_000)).unwrap();
        assert!(!r.success);
        assert!(r.logs.is_empty(), "sub-chamada revertida não pode vazar log");
    }

    #[test]
    fn log_de_subchamada_bem_sucedida_sobe_para_o_pai() {
        let mut mundo = MundoMemoria::default();
        mundo.put_code(&B, &[push1(0), push1(0), vec![0xa0], stop()].concat());
        let mut host = EavmHost::new(&mut mundo);
        let r = host.call(req(B, 1_000_000)).unwrap();
        assert!(r.success);
        assert_eq!(r.logs.len(), 1, "sucesso propaga o evento");
        assert_eq!(r.logs[0].address, B);
    }

    #[test]
    fn reversao_aninhada_preserva_o_avo() {
        let mut mundo = MundoMemoria::default();
        // C escreve slot 9 e reverte.
        mundo.put_code(&C, &[sstore(9, 9), revert()].concat());
        // B escreve slot 5, chama C, e termina BEM.
        mundo.put_code(&B, &[sstore(5, 5), call_para(&C, 200), stop()].concat());
        // A escreve slot 1 e chama B.
        mundo.put_code(&A, &[sstore(1, 1), call_para(&B, 100_000), stop()].concat());
        let mut host = EavmHost::new(&mut mundo);
        assert!(host.call(req(A, 1_000_000)).unwrap().success);
        assert_eq!(mundo.get_storage(&A, &w(1)), w(1), "avô sobrevive");
        assert_eq!(mundo.get_storage(&B, &w(5)), w(5), "pai bem-sucedido sobrevive");
        assert_eq!(mundo.get_storage(&C, &w(9)), ZERO_WORD, "só o neto revertido some");
    }

    #[test]
    fn parada_excepcional_consome_todo_o_gas_e_reverte() {
        let mut mundo = MundoMemoria::default();
        mundo.put_code(&B, &[sstore(2, 2), invalido()].concat());
        let mut host = EavmHost::new(&mut mundo);
        let r = host.call(req(B, 777)).unwrap();
        assert!(!r.success);
        assert_eq!(r.gas_used, 777, "parada excepcional custa o orçamento inteiro");
        assert_eq!(mundo.get_storage(&B, &w(2)), ZERO_WORD);
    }

    #[test]
    fn valor_move_e_reverte_junto_com_o_frame() {
        let mut mundo = MundoMemoria::default();
        mundo.credita(&A, 1_000);
        mundo.put_code(&B, &revert());
        let mut host = EavmHost::new(&mut mundo);
        let mut p = req(B, 1_000_000);
        p.value = w(400);
        assert!(!host.call(p).unwrap().success);
        assert_eq!(mundo.get_balance(&A), w(1_000), "revert devolve o valor ao chamador");
        assert_eq!(mundo.get_balance(&B), ZERO_WORD);
    }

    #[test]
    fn saldo_insuficiente_falha_sem_gastar_gas() {
        let mut mundo = MundoMemoria::default();
        mundo.put_code(&B, &sstore(1, 1));
        let mut host = EavmHost::new(&mut mundo);
        let mut p = req(B, 1_000_000);
        p.value = w(1);
        let r = host.call(p).unwrap();
        assert!(!r.success);
        assert_eq!(r.gas_used, 0, "nem chegou a executar");
        assert_eq!(mundo.get_storage(&B, &w(1)), ZERO_WORD);
    }

    #[test]
    fn delegatecall_nao_move_valor_e_escreve_no_storage_do_pai() {
        let mut mundo = MundoMemoria::default();
        mundo.credita(&A, 1_000);
        mundo.put_code(&B, &[sstore(1, 1), stop()].concat());
        let mut host = EavmHost::new(&mut mundo);
        let mut p = req(B, 1_000_000);
        p.kind = CallKind::DelegateCall;
        p.value = w(500);
        p.delegate = true;
        p.exec_address = A; // roda no contexto do pai
        assert!(host.call(p).unwrap().success);
        assert_eq!(mundo.get_balance(&A), w(1_000), "DELEGATECALL não move moeda");
        assert_eq!(mundo.get_balance(&B), ZERO_WORD);
        assert_eq!(mundo.get_storage(&A, &w(1)), w(1), "escreve no storage do PAI");
        assert_eq!(mundo.get_storage(&B, &w(1)), ZERO_WORD);
    }

    #[test]
    fn conta_sem_codigo_e_sucesso_vazio_e_mantem_a_transferencia() {
        let mut mundo = MundoMemoria::default();
        mundo.credita(&A, 100);
        let mut host = EavmHost::new(&mut mundo);
        let mut p = req(C, 50_000);
        p.value = w(30);
        let r = host.call(p).unwrap();
        assert!(r.success);
        assert_eq!(r.gas_used, 0);
        assert_eq!(mundo.get_balance(&C), w(30), "transferência simples NÃO é revertida");
    }

    #[test]
    fn profundidade_maxima_barra_a_chamada() {
        let mut mundo = MundoMemoria::default();
        mundo.put_code(&B, &sstore(1, 1));
        let mut host = EavmHost::new(&mut mundo);
        let mut p = req(B, 1_000_000);
        p.depth = MAX_CALL_DEPTH;
        let r = host.call(p).unwrap();
        assert!(!r.success);
        assert_eq!(r.gas_used, 0);
        assert_eq!(mundo.get_storage(&B, &w(1)), ZERO_WORD);
    }

    /// A recursão NO LIMITE cabe no orçamento de pilha que o nó reserva.
    ///
    /// O limite de profundidade garante determinismo, não que a pilha nativa
    /// caiba: o interpretador é RECURSIVO e consome uma moldura por nível.
    /// Estourar a pilha em Rust não é exceção capturável — é `SIGABRT`, o
    /// processo morre. E o caminho é público: um contrato que chama a si mesmo,
    /// via `eth_call`, sem autenticação.
    ///
    /// Roda numa thread com pilha EXPLÍCITA, de propósito: a do teste é grande e
    /// esconderia o problema. O valor é o mesmo que `eav7-node` reserva por
    /// worker; se um dos dois mudar sem o outro, este teste quebra — que é o
    /// ponto.
    #[test]
    fn recursao_no_limite_cabe_no_orcamento_de_pilha() {
        const PILHA_POR_WORKER: usize = 16 * 1024 * 1024;

        let filha = std::thread::Builder::new()
            .stack_size(PILHA_POR_WORKER)
            .spawn(|| {
                // Runtime que chama A SI MESMO repassando todo o gás disponível:
                // CALL(gas=GAS, self, 0, 0,0,0,0); POP; STOP.
                let mut runtime = vec![0x60, 0x00, 0x60, 0x00, 0x60, 0x00, 0x60, 0x00, 0x60, 0x00];
                runtime.push(0x73); // PUSH20 <endereço próprio>
                runtime.extend_from_slice(&B);
                runtime.push(0x5a); // GAS
                runtime.push(0xf1); // CALL
                runtime.push(0x50); // POP
                runtime.push(0x00); // STOP

                let mut mundo = MundoMemoria::default();
                mundo.put_code(&B, &runtime);
                let mut host = EavmHost::new(&mut mundo);
                // Gás alto o bastante para a recursão chegar ao teto de
                // profundidade antes de acabar o gás — é ESSE o caso a medir.
                host.call(req(B, 500_000_000)).expect("execução")
            })
            .expect("thread com pilha dimensionada");

        // O que importa é ter VOLTADO: o processo não abortou. O desfecho da
        // execução (sucesso ou revert por profundidade) é assunto do teste acima.
        //
        // O teste NÃO é vacuoso: com 256 KiB no lugar do orçamento real, este
        // mesmo caso derruba o processo com `fatal runtime error: stack overflow`
        // (SIGABRT) — foi assim que ele foi conferido.
        let r = filha.join().expect("a recursão no limite não pode derrubar a thread");
        assert!(r.gas_used > 0, "a execução chegou a rodar");
    }

    // -- CREATE ---------------------------------------------------------------

    /// Init code que devolve `n` bytes de runtime (zeros): o construtor mais simples
    /// possível que ainda exercita o depósito de código.
    fn init_que_retorna(n: u8) -> Vec<u8> {
        [push1(n), push1(0), vec![0xf3]].concat() // RETURN(0, n)
    }

    #[test]
    fn create_deposita_o_codigo_e_cobra_20_por_byte() {
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        let r = host.create(cria(A, init_que_retorna(8), None, 100_000)).unwrap();
        assert!(r.success);
        assert_eq!(mundo.get_code(&r.address).len(), 8, "runtime depositado");
        assert!(
            r.gas_used >= 8 * CREATE_DEPOSIT_GAS_PER_BYTE,
            "o depósito de 20/byte entra no gasUsed"
        );
        assert_eq!(mundo.contas.get(&A).map(|c| c.nonce), Some(1), "nonce do criador subiu");
    }

    #[test]
    fn create_com_runtime_que_nao_cabe_no_gas_falha_e_consome_tudo() {
        // M-1: o depósito tem de caber no gás JÁ encaminhado ao construtor. Se fosse
        // cobrado do pai depois, um construtor hostil derrubaria a transação inteira
        // devolvendo um runtime grande — griefing de graça.
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        // 32 bytes de runtime custam 640 de depósito; damos um orçamento apertado.
        let r = host.create(cria(A, init_que_retorna(32), None, 620)).unwrap();
        assert!(!r.success);
        assert_eq!(r.gas_used, 620, "out-of-gas do CREATE consome o orçamento");
        assert!(mundo.get_code(&r.address).is_empty(), "nada foi depositado");
    }

    #[test]
    fn create_para_endereco_com_codigo_falha() {
        // B-1: sem isso um CREATE2 com o mesmo salt sobrescreveria contrato vivo.
        let mut mundo = MundoMemoria::default();
        let esperado = mundo.create_address(&A, 0);
        mundo.put_code(&esperado, b"ja existe");
        let mut host = EavmHost::new(&mut mundo);
        let r = host.create(cria(A, init_que_retorna(4), None, 100_000)).unwrap();
        assert!(!r.success);
        assert_eq!(r.address, esperado);
        assert_eq!(mundo.get_code(&esperado), b"ja existe".to_vec(), "código intacto");
    }

    #[test]
    fn create_com_construtor_que_reverte_devolve_o_gas_do_construtor() {
        let mut mundo = MundoMemoria::default();
        mundo.credita(&A, 500);
        let mut host = EavmHost::new(&mut mundo);
        let mut c = cria(A, [sstore(1, 1), revert()].concat(), None, 100_000);
        c.value = w(200);
        let r = host.create(c).unwrap();
        assert!(!r.success);
        assert!(r.gas_used < 100_000, "gás do CONSTRUTOR, não o orçamento inteiro");
        assert_eq!(mundo.get_balance(&A), w(500), "valor devolvido");
        assert_eq!(mundo.get_storage(&r.address, &w(1)), ZERO_WORD);
    }

    #[test]
    fn create_e_create2_dao_enderecos_diferentes_e_estaveis() {
        let mundo = MundoMemoria::default();
        let a1 = mundo.create_address(&A, 0);
        let a2 = mundo.create_address(&A, 1);
        let c1 = mundo.create2_address(&A, &w(7), b"init");
        assert_ne!(a1, a2, "o nonce entra no endereço");
        assert_ne!(a1, c1);
        // CREATE2 é determinístico: mesmas entradas, mesmo endereço.
        assert_eq!(c1, mundo.create2_address(&A, &w(7), b"init"));
        assert_ne!(c1, mundo.create2_address(&A, &w(8), b"init"), "o salt importa");
        assert_ne!(c1, mundo.create2_address(&A, &w(7), b"outro"), "o initcode importa");
    }

    #[test]
    fn create_address_bate_com_a_formula_de_texto_da_referencia() {
        // A referência hasheia o TEXTO "0x…:n", com o `0x` e o nonce em decimal — NÃO
        // é o `keccak(rlp([sender, nonce]))` do Ethereum. Um porte que use a fórmula
        // "certa" coloca todo contrato em outro endereço.
        let mundo = MundoMemoria::default();
        let esperado = {
            let mut h = Keccak256::new();
            h.update(format!("{}:{}", addr_hex(&A), 7).as_bytes());
            addr_from_slice(&h.finalize()[12..])
        };
        assert_eq!(mundo.create_address(&A, 7), esperado);
    }

    #[test]
    fn create_no_teto_de_profundidade_devolve_endereco_zero() {
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        let mut c = cria(A, init_que_retorna(1), None, 100_000);
        c.depth = MAX_CALL_DEPTH;
        let r = host.create(c).unwrap();
        assert!(!r.success);
        assert_eq!(r.address, ZERO_ADDR);
    }

    // -- storage transiente ---------------------------------------------------

    #[test]
    fn tstore_de_zero_apaga_a_entrada() {
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        host.tstore(&A, w(1), w(9)).unwrap();
        assert_eq!(host.tload(&A, &w(1)), w(9));
        host.tstore(&A, w(1), ZERO_WORD).unwrap();
        assert_eq!(host.tload(&A, &w(1)), ZERO_WORD);
        assert!(host.transient.is_empty(), "zero não pode deixar entrada residual");
    }

    #[test]
    fn transiente_e_por_conta() {
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        host.tstore(&A, w(1), w(4)).unwrap();
        assert_eq!(host.tload(&B, &w(1)), ZERO_WORD, "contas não compartilham transiente");
    }

    #[test]
    fn transiente_nao_toca_o_mundo() {
        // Se `TSTORE` escrevesse no mundo, entraria no `stateRoot` — e o root
        // divergiria de todo nó correto. É o ponto inteiro do EIP-1153.
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        host.tstore(&A, w(1), w(9)).unwrap();
        assert_eq!(mundo.get_storage(&A, &w(1)), ZERO_WORD);
        assert!(mundo.journal.is_empty(), "transiente não gera entrada de journal");
    }

    // -- BLOCKHASH ------------------------------------------------------------

    #[test]
    fn blockhash_respeita_a_janela_de_256() {
        let mut mundo = MundoMemoria::default();
        mundo.hashes.insert(100, w(1));
        mundo.hashes.insert(1000, w(2));
        let host = EavmHost::new(&mut mundo);
        assert_eq!(host.block_hash(w(1000), 1001), w(2), "dentro da janela");
        assert_eq!(host.block_hash(w(100), 1000), ZERO_WORD, "fora da janela de 256");
        assert_eq!(host.block_hash(w(1000), 1000), ZERO_WORD, "o bloco atual ainda não tem hash");
        assert_eq!(host.block_hash(w(1001), 1000), ZERO_WORD, "bloco futuro");
        assert_eq!(host.block_hash(Word::MAX, 1000), ZERO_WORD, "altura que não cabe em u64");
    }

    // -- fork Osaka -----------------------------------------------------------

    #[test]
    fn precompiles_0x06_a_0x09_so_existem_acima_do_fork() {
        for n in 1..=5u8 {
            assert_eq!(precompile_id(&addr_from_u8(n), false), Some(n), "0x0{n} sempre existiu");
        }
        for n in 6..=9u8 {
            assert_eq!(
                precompile_id(&addr_from_u8(n), false),
                None,
                "0x0{n} não existe antes do fork"
            );
            assert_eq!(precompile_id(&addr_from_u8(n), true), Some(n));
        }
        assert_eq!(precompile_id(&addr_from_u8(0), true), None);
        assert_eq!(precompile_id(&addr_from_u8(10), true), None);
        assert_eq!(precompile_id(&A, true), None);
    }

    #[test]
    fn abaixo_do_fork_0x08_e_conta_comum_e_devolve_sucesso_vazio() {
        if vm::EAVM_OSAKA_HEIGHT == 0 { return; }
        // Este é o teste que impede uma cisão de rede: um nó ANTIGO no bloco
        // 1.899.999 trata 0x08 como conta sem código. Se este cliente rodasse o
        // pairing ali, os dois produziriam estados diferentes para o MESMO bloco.
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        let mut p = req(addr_from_u8(8), 1_000_000);
        p.block.number = vm::EAVM_OSAKA_HEIGHT - 1;
        let r = host.call(p).unwrap();
        assert!(r.success);
        assert!(r.return_data.is_empty(), "conta comum devolve vazio");
        assert_eq!(r.gas_used, 0, "e não cobra gás de pairing");
    }

    #[test]
    fn acima_do_fork_0x08_ja_e_o_pairing() {
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        let mut p = req(addr_from_u8(8), 10_000_000);
        p.block.number = vm::EAVM_OSAKA_HEIGHT;
        let r = host.call(p).unwrap();
        assert!(r.success);
        assert_eq!(r.gas_used, 45_000 * BN254_GAS_MULTIPLIER);
        assert_eq!(hex::encode(&r.return_data), format!("{:063}1", 0));
    }

    #[test]
    fn precompiles_0x01_a_0x05_valem_tambem_abaixo_do_fork() {
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        let mut p = req(addr_from_u8(4), 1_000_000);
        p.block.number = 0;
        p.input = b"eco".to_vec();
        let r = host.call(p).unwrap();
        assert!(r.success);
        assert_eq!(r.return_data, b"eco".to_vec());
    }

    // -- cobrança de gás dos precompiles --------------------------------------

    #[test]
    fn gas_e_cobrado_antes_do_trabalho_pesado() {
        // Um blake2f com rounds = 0xffffffff custa 4,29 bilhões de gás. Se o host
        // rodasse primeiro e cobrasse depois, seria um travamento de nó ao preço de
        // 213 bytes de calldata. Aqui ele morre por falta de gás sem girar o laço — e
        // o teste terminar rápido É a asserção.
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        let mut p = req(addr_from_u8(9), 1_000_000);
        p.input = hexb(&format!("ffffffff{}", "00".repeat(209)));
        let r = host.call(p).unwrap();
        assert!(!r.success);
        assert_eq!(r.gas_used, 1_000_000, "sem gás → falha, consumindo o que havia");
    }

    #[test]
    fn precompile_com_entrada_invalida_consome_todo_o_gas() {
        let mut mundo = MundoMemoria::default();
        let mut host = EavmHost::new(&mut mundo);
        // pairing com comprimento fora do múltiplo de 192
        let mut p = req(addr_from_u8(8), 5_000_000);
        p.input = vec![0u8; 100];
        let r = host.call(p).unwrap();
        assert!(!r.success);
        assert_eq!(r.gas_used, 5_000_000);
    }

    #[test]
    fn precompile_com_valor_credita_exec_address_e_nao_o_destino() {
        // L-2: num CALLCODE ao precompile o destino é o próprio chamador. Creditar
        // `to` mandaria moeda para 0x…04, onde ela ficaria presa para sempre.
        let mut mundo = MundoMemoria::default();
        mundo.credita(&A, 1_000);
        let mut host = EavmHost::new(&mut mundo);
        let mut p = req(addr_from_u8(4), 1_000_000);
        p.kind = CallKind::CallCode;
        p.exec_address = A; // CALLCODE: self → self
        p.value = w(100);
        p.input = b"eco".to_vec();
        let r = host.call(p).unwrap();
        assert!(r.success);
        assert_eq!(r.return_data, b"eco".to_vec());
        assert_eq!(mundo.get_balance(&A), w(1_000), "self → self soma zero");
        assert_eq!(
            mundo.get_balance(&addr_from_u8(4)),
            ZERO_WORD,
            "o precompile não recebe moeda"
        );
    }

    // -- 0x01 ecrecover -------------------------------------------------------

    // Vetor de consenso do go-ethereum, conferido contra o nó de referência.
    const EC_HASH: &str = "38d18acb67d25c8bb9942764b62f18e17054f66a817bd4295423adf9ed98873e";
    const EC_R: &str = "38d18acb67d25c8bb9942764b62f18e17054f66a817bd4295423adf9ed98873e";
    const EC_S_BAIXO: &str = "789d1dd423d25f0772d2748d60f7e4b81bb14d086eba8e8e8efb6dcff8a4ae02";
    /// `n − s`: a MESMA assinatura na forma de `s` alto.
    const EC_S_ALTO: &str = "8762e22bdc2da0f88d2d8b729f081b469efd8fde408e11ad30d6f0bcd791933f";
    const EC_ESPERADO: &str = "000000000000000000000000ceaccac640adf55b2028469bd36ba501f28b699d";

    fn ec_input(v: u8, s: &str) -> Vec<u8> {
        hexb(&format!("{EC_HASH}{:064x}{EC_R}{s}", v))
    }

    #[test]
    fn ecrecover_vetor_oficial() {
        let out = precompile_run(1, &ec_input(27, EC_S_BAIXO)).expect("sem erro");
        assert_eq!(hex::encode(out), EC_ESPERADO);
    }

    #[test]
    fn ecrecover_aceita_s_alto() {
        // ESTE é o teste que impede a cisão: o Node assina via OpenSSL, que não
        // normaliza `s`, e ~52% das assinaturas saem altas. O `k256` as rejeita. O
        // vetor é a MESMA assinatura nas duas formas, exigindo o MESMO endereço.
        let baixo = precompile_run(1, &ec_input(27, EC_S_BAIXO)).expect("sem erro");
        let alto = precompile_run(1, &ec_input(28, EC_S_ALTO)).expect("sem erro");
        assert_eq!(hex::encode(&alto), EC_ESPERADO);
        assert_eq!(alto, baixo, "as duas formas de `s` recuperam a MESMA conta");
    }

    #[test]
    fn ecrecover_s_alto_sem_inverter_o_recid_daria_outra_conta() {
        // Guarda contra a "correção" tentadora: normalizar `s` e manter o `v`. Se
        // esta desigualdade virar igualdade, a inversão de paridade foi perdida e o
        // precompile passou a devolver endereço espúrio em vez de erro.
        let certo = precompile_run(1, &ec_input(28, EC_S_ALTO)).expect("sem erro");
        let errado = precompile_run(1, &ec_input(27, EC_S_ALTO)).expect("sem erro");
        assert_ne!(certo, errado, "o recId TEM de acompanhar a normalização de `s`");
    }

    #[test]
    fn ecrecover_rejeita_v_r_e_s_fora_da_faixa() {
        let n_hex = hex::encode(SECP256K1_N);
        let vazio: Vec<u8> = Vec::new();
        assert_eq!(precompile_run(1, &ec_input(29, EC_S_BAIXO)).unwrap(), vazio, "v = 29");
        assert_eq!(precompile_run(1, &ec_input(0, EC_S_BAIXO)).unwrap(), vazio, "v = 0");
        assert_eq!(
            precompile_run(1, &hexb(&format!("{EC_HASH}{:064x}{}{EC_S_BAIXO}", 27, "00".repeat(32))))
                .unwrap(),
            vazio,
            "r = 0"
        );
        assert_eq!(
            precompile_run(1, &hexb(&format!("{EC_HASH}{:064x}{EC_R}{}", 27, "00".repeat(32))))
                .unwrap(),
            vazio,
            "s = 0"
        );
        assert_eq!(
            precompile_run(1, &hexb(&format!("{EC_HASH}{:064x}{n_hex}{EC_S_BAIXO}", 27))).unwrap(),
            vazio,
            "r = n"
        );
        assert_eq!(
            precompile_run(1, &hexb(&format!("{EC_HASH}{:064x}{EC_R}{n_hex}", 27))).unwrap(),
            vazio,
            "s = n"
        );
        assert_eq!(precompile_run(1, &[]).unwrap(), vazio, "entrada vazia");
    }

    #[test]
    fn ecrecover_rejeita_lixo_nos_bytes_altos_do_v() {
        // `v` ocupa 32 bytes mas só 27/28 valem. Aceitar lixo nos 31 bytes altos daria
        // duas codificações válidas do mesmo `v`.
        let mut e = ec_input(27, EC_S_BAIXO);
        e[32] = 1;
        assert!(precompile_run(1, &e).unwrap().is_empty());
    }

    #[test]
    fn ecrecover_tem_preco_fixo() {
        assert_eq!(precompile_gas(1, &[]).unwrap(), 500_000);
        assert_eq!(precompile_gas(1, &[0u8; 4096]).unwrap(), 500_000);
    }

    // -- 0x02/0x03/0x04 -------------------------------------------------------

    #[test]
    fn sha256_vetores_oficiais() {
        assert_eq!(
            hex::encode(precompile_run(2, b"").unwrap()),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            hex::encode(precompile_run(2, b"abc").unwrap()),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(precompile_gas(2, b"").unwrap(), 60);
        assert_eq!(precompile_gas(2, &[0u8; 32]).unwrap(), 72);
        assert_eq!(precompile_gas(2, &[0u8; 33]).unwrap(), 84, "arredonda para cima em palavras");
    }

    #[test]
    fn ripemd160_vetores_oficiais_alinhados_a_direita_em_32_bytes() {
        // Vetores do RIPEMD-160 original (Dobbertin/Bosselaers/Preneel).
        assert_eq!(
            hex::encode(precompile_run(3, b"").unwrap()),
            "0000000000000000000000009c1185a5c5e9fc54612808977ee8f548b2258d31"
        );
        assert_eq!(
            hex::encode(precompile_run(3, b"abc").unwrap()),
            "0000000000000000000000008eb208f7e05d987a9b044a8e98c6b087f15a0bfc"
        );
        assert_eq!(precompile_gas(3, b"").unwrap(), 600);
        assert_eq!(precompile_gas(3, &[0u8; 64]).unwrap(), 840);
    }

    #[test]
    fn identity_devolve_a_entrada_intacta() {
        assert_eq!(precompile_run(4, b"qualquer coisa").unwrap(), b"qualquer coisa".to_vec());
        assert!(precompile_run(4, b"").unwrap().is_empty());
        assert_eq!(precompile_gas(4, b"").unwrap(), 15);
        assert_eq!(precompile_gas(4, &[0u8; 32]).unwrap(), 18);
        assert_eq!(precompile_gas(4, &[0u8; 65]).unwrap(), 24);
    }

    // -- 0x05 modexp ----------------------------------------------------------

    fn w32(n: u64) -> String {
        format!("{:064x}", n)
    }

    #[test]
    fn modexp_vetores_do_eip198() {
        // 3^(2^256 − 2^32 − 978) mod (2^256 − 2^32 − 977) = 1
        let e1 = hexb(&format!(
            "{}{}{}03{}{}",
            w32(1),
            w32(32),
            w32(32),
            "fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2e",
            "fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"
        ));
        assert_eq!(precompile_gas(5, &e1).unwrap(), 4080);
        assert_eq!(hex::encode(precompile_run(5, &e1).unwrap()), w32(1));

        // Base de comprimento ZERO com expoente não nulo ⇒ 0.
        let e2 = hexb(&format!(
            "{}{}{}{}{}",
            w32(0),
            w32(32),
            w32(32),
            "fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2e",
            "fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"
        ));
        assert_eq!(precompile_gas(5, &e2).unwrap(), 4080);
        assert_eq!(hex::encode(precompile_run(5, &e2).unwrap()), w32(0));
    }

    #[test]
    fn modexp_casos_de_canto_batem_com_a_referencia() {
        let caso = |h: &str| {
            let e = hexb(h);
            (precompile_gas(5, &e).unwrap(), hex::encode(precompile_run(5, &e).unwrap()))
        };
        // entrada vazia: bl = ml = 0 ⇒ saída vazia, gás no piso 500
        assert_eq!(caso(""), (500, String::new()));
        // módulo ZERO ⇒ resultado 0
        assert_eq!(caso(&format!("{}{}{}030300", w32(1), w32(1), w32(1))), (500, "00".into()));
        // 3^2 mod 5 = 4
        assert_eq!(caso(&format!("{}{}{}030205", w32(1), w32(1), w32(1))), (500, "04".into()));
        // DIVERGÊNCIA DELIBERADA: expoente 0 com módulo 1. O EIP diria 0; a referência
        // devolve 1, porque o laço dela começa em r = 1 e não roda. Alinhar com o EIP
        // exige fork por altura, não um ajuste aqui.
        assert_eq!(caso(&format!("{}{}{}0301", w32(1), w32(0), w32(1))), (500, "01".into()));
    }

    #[test]
    fn modexp_gas_cresce_com_o_comprimento_do_expoente_nao_com_o_valor() {
        // Era o furo da versão anterior: um expoente de 1024 bytes com os bits altos
        // zerados era cotado como se valesse pouco, e o laço rodava quase de graça.
        let exp_grande = hexb(&format!("{}{}{}03{}07", w32(1), w32(64), w32(1), "ff".repeat(64)));
        // complexity = 16; iters = 16·(64−32) + (256−1) = 767 ⇒ 12272
        assert_eq!(precompile_gas(5, &exp_grande).unwrap(), 12272);
        assert_eq!(hex::encode(precompile_run(5, &exp_grande).unwrap()), "06");

        // Mesmo COMPRIMENTO, cauda zerada: o gás não cai por causa do valor.
        let cauda_zero = hexb(&format!(
            "{}{}{}03{}{}07",
            w32(1),
            w32(64),
            w32(1),
            "ff".repeat(32),
            "00".repeat(32)
        ));
        assert_eq!(precompile_gas(5, &cauda_zero).unwrap(), 12272);
    }

    #[test]
    fn modexp_operando_acima_de_1024_bytes_e_parada_excepcional() {
        // EIP-7823. É erro, não saída vazia: o host converte isso em "consome todo o
        // gás", que é o que o EIP manda.
        let grande = hexb(&format!("{}{}{}", w32(1025), w32(1), w32(1)));
        assert!(precompile_gas(5, &grande).is_err());
        assert!(precompile_run(5, &grande).is_err());
        // exatamente 1024 ainda passa
        let no_teto = hexb(&format!("{}{}{}", w32(1024), w32(1), w32(1)));
        assert!(precompile_gas(5, &no_teto).is_ok());
        // comprimento astronômico: tem de ser comparado como big-endian de 256 bits,
        // não truncado para usize — truncar deixaria passar pelo teto.
        let absurdo = hexb(&format!("{}{}{}", "ff".repeat(32), w32(1), w32(1)));
        assert!(precompile_gas(5, &absurdo).is_err());
    }

    #[test]
    fn modexp_complexidade_dobra_acima_de_32_bytes() {
        // maxLen = 64 ⇒ words = 8 ⇒ complexity = 2·64 = 128 (em vez do piso 16).
        // iters = bitLen(3) − 1 = 1 ⇒ 128, ainda abaixo do piso de 500.
        let e = hexb(&format!(
            "{}{}{}{}03{}",
            w32(64),
            w32(1),
            w32(64),
            "00".repeat(64),
            "01".repeat(64)
        ));
        assert_eq!(precompile_gas(5, &e).unwrap(), 500);
    }

    // -- 0x09 blake2f ---------------------------------------------------------

    // Vetores oficiais do EIP-152 ("Test vector 4".."7"), conferidos contra o nó de
    // referência: entrada = rounds ‖ h ‖ "abc" com padding ‖ t = 3 ‖ f.
    const B2_H: &str = concat!(
        "48c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5",
        "d182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b",
    );
    const B2_T: &str = "03000000000000000000000000000000";

    fn b2_input(rounds: &str, f: &str) -> Vec<u8> {
        let m = format!("616263{}", "0".repeat(250));
        hexb(&format!("{rounds}{B2_H}{m}{B2_T}{f}"))
    }

    #[test]
    fn blake2f_vetores_do_eip152() {
        let casos = [
            // rounds = 12, f = 1 → é o BLAKE2b-512("abc") completo
            ("0000000c", "01", 12u64,
             "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923"),
            // rounds = 0: nenhuma rodada, só o XOR final com o IV
            ("00000000", "01", 0,
             "08c9bcf367e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5d282e6ad7f520e511f6c3e2b8c68059b9442be0454267ce079217e1319cde05b"),
            // rounds = 12, f = 0: sem a inversão de v[14]
            ("0000000c", "00", 12,
             "75ab69d3190a562c51aef8d88f1c2775876944407270c42c9844252c26d2875298743e7f6d5ea2f2d3e8d226039cd31b4e426ac4f2d3d666a610c2116fde4735"),
            ("00000001", "01", 1,
             "b63a380cb2897d521994a85234ee2c181b5f844d2c624c002677e9703449d2fba551b3a8333bcdf5f2f7e08993d53923de3d64fcc68c034e717b9293fed7a421"),
        ];
        for (rounds, f, gas, esperado) in casos {
            let e = b2_input(rounds, f);
            assert_eq!(e.len(), 213);
            assert_eq!(precompile_gas(9, &e).unwrap(), gas, "gás = 1 por rodada");
            assert_eq!(
                hex::encode(precompile_run(9, &e).unwrap()),
                esperado,
                "rounds={rounds} f={f}"
            );
        }
    }

    #[test]
    fn blake2f_rejeita_tamanho_errado() {
        // O EIP-152 exige tamanho EXATO — nada de preenchimento à direita como nos
        // precompiles 0x01..0x05. 212 e 214 bytes são os dois vetores negativos
        // oficiais.
        for n in [0usize, 212, 214, 256] {
            let e = vec![0u8; n];
            assert!(precompile_gas(9, &e).is_err(), "{n} bytes tinha de ser rejeitado");
            assert!(precompile_run(9, &e).is_err(), "{n} bytes tinha de ser rejeitado");
        }
        assert!(precompile_gas(9, &vec![0u8; 213]).is_ok());
    }

    #[test]
    fn blake2f_rejeita_flag_final_que_nao_seja_0_ou_1() {
        let mut e = b2_input("0000000c", "01");
        e[212] = 2;
        assert!(precompile_gas(9, &e).is_err());
        assert!(precompile_run(9, &e).is_err());
    }

    #[test]
    fn blake2f_gas_e_o_numero_de_rodadas_e_o_teto_e_legitimo() {
        let e = b2_input("ffffffff", "01");
        assert_eq!(precompile_gas(9, &e).unwrap(), u32::MAX as u64, "sem limite artificial");
    }

    // -- 0x06/0x07/0x08 BN254 -------------------------------------------------

    /// Gerador canônico de G2, na codificação do EIP-197 `(x_im, x_re, y_im, y_re)`.
    const G2_GERADOR: &str = concat!(
        "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2",
        "1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed",
        "090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b",
        "12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa",
    );
    /// Gerador de G1: (1, 2).
    const G1_GERADOR: &str = concat!(
        "0000000000000000000000000000000000000000000000000000000000000001",
        "0000000000000000000000000000000000000000000000000000000000000002",
    );

    /// Vetores OFICIAIS do go-ethereum — `core/vm/testdata/precompiles/`. São os
    /// mesmos casos "chfast/cdetrio/jeff" dos testes de consenso do EIP-196/197.
    /// O gás anotado é o do EIP-1108 CRU; o teste multiplica por `BN254_GAS_MULTIPLIER`.
    ///
    /// Estão transcritos byte a byte do arquivo da referência (`test/bn254.test.js`)
    /// e não regenerados por nós: um vetor que este cliente "gera e confere" só
    /// prova que ele concorda consigo mesmo.
    const ADD_VECTORS: &[(&str, u64, &str, &str)] = &[
        ("chfast1", 150, "18b18acfb4c2c30276db5411368e7185b311dd124691610c5d3b74034e093dc9063c909c4720840cb5134cb9f59fa749755796819658d32efc0d288198f3726607c2b7f58a84bd6145f00c9c2bc0bb1a187f20ff2c92963a88019e7c6a014eed06614e20c147e940f2d70da3f74c9a17df361706a4485c742bd6788478fa17d7", "2243525c5efd4b9c3d3c45ac0ca3fe4dd85e830a4ce6b65fa1eeaee202839703301d1d33be6da8e509df21cc35964723180eed7532537db9ae5e7d48f195c915"),
        ("chfast2", 150, "2243525c5efd4b9c3d3c45ac0ca3fe4dd85e830a4ce6b65fa1eeaee202839703301d1d33be6da8e509df21cc35964723180eed7532537db9ae5e7d48f195c91518b18acfb4c2c30276db5411368e7185b311dd124691610c5d3b74034e093dc9063c909c4720840cb5134cb9f59fa749755796819658d32efc0d288198f37266", "2bd3e6d0f3b142924f5ca7b49ce5b9d54c4703d7ae5648e61d02268b1a0a9fb721611ce0a6af85915e2f1d70300909ce2e49dfad4a4619c8390cae66cefdb204"),
        ("cdetrio1", 150, "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
        ("cdetrio2", 150, "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
        ("cdetrio3", 150, "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
        ("cdetrio4", 150, "", "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
        ("cdetrio5", 150, "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
        ("cdetrio6", 150, "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002", "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002"),
        ("cdetrio7", 150, "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002"),
        ("cdetrio8", 150, "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002", "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002"),
        ("cdetrio9", 150, "0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002"),
        ("cdetrio10", 150, "000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002"),
        ("cdetrio11", 150, "0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002", "030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd315ed738c0e0a7c92e7845f96b2ae9c0a68a6a449e3538fc7ff3ebf7a5a18a2c4"),
        ("cdetrio12", 150, "000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd315ed738c0e0a7c92e7845f96b2ae9c0a68a6a449e3538fc7ff3ebf7a5a18a2c4"),
        ("cdetrio13", 150, "17c139df0efee0f766bc0204762b774362e4ded88953a39ce849a8a7fa163fa901e0559bacb160664764a357af8a9fe70baa9258e0b959273ffc5718c6d4cc7c039730ea8dff1254c0fee9c0ea777d29a9c710b7e616683f194f18c43b43b869073a5ffcc6fc7a28c30723d6e58ce577356982d65b833a5a5c15bf9024b43d98", "15bf2bb17880144b5d1cd2b1f46eff9d617bffd1ca57c37fb5a49bd84e53cf66049c797f9ce0d17083deb32b5e36f2ea2a212ee036598dd7624c168993d1355f"),
        ("cdetrio14", 150, "17c139df0efee0f766bc0204762b774362e4ded88953a39ce849a8a7fa163fa901e0559bacb160664764a357af8a9fe70baa9258e0b959273ffc5718c6d4cc7c17c139df0efee0f766bc0204762b774362e4ded88953a39ce849a8a7fa163fa92e83f8d734803fc370eba25ed1f6b8768bd6d83887b87165fc2434fe11a830cb00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
    ];

    /// Vetores OFICIAIS do go-ethereum — `core/vm/testdata/precompiles/`. São os
    /// mesmos casos "chfast/cdetrio/jeff" dos testes de consenso do EIP-196/197.
    /// O gás anotado é o do EIP-1108 CRU; o teste multiplica por `BN254_GAS_MULTIPLIER`.
    ///
    /// Estão transcritos byte a byte do arquivo da referência (`test/bn254.test.js`)
    /// e não regenerados por nós: um vetor que este cliente "gera e confere" só
    /// prova que ele concorda consigo mesmo.
    const MUL_VECTORS: &[(&str, u64, &str, &str)] = &[
        ("chfast1", 6000, "2bd3e6d0f3b142924f5ca7b49ce5b9d54c4703d7ae5648e61d02268b1a0a9fb721611ce0a6af85915e2f1d70300909ce2e49dfad4a4619c8390cae66cefdb20400000000000000000000000000000000000000000000000011138ce750fa15c2", "070a8d6a982153cae4be29d434e8faef8a47b274a053f5a4ee2a6c9c13c31e5c031b8ce914eba3a9ffb989f9cdd5b0f01943074bf4f0f315690ec3cec6981afc"),
        ("chfast2", 6000, "070a8d6a982153cae4be29d434e8faef8a47b274a053f5a4ee2a6c9c13c31e5c031b8ce914eba3a9ffb989f9cdd5b0f01943074bf4f0f315690ec3cec6981afc30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd46", "025a6f4181d2b4ea8b724290ffb40156eb0adb514c688556eb79cdea0752c2bb2eff3f31dea215f1eb86023a133a996eb6300b44da664d64251d05381bb8a02e"),
        ("chfast3", 6000, "025a6f4181d2b4ea8b724290ffb40156eb0adb514c688556eb79cdea0752c2bb2eff3f31dea215f1eb86023a133a996eb6300b44da664d64251d05381bb8a02e183227397098d014dc2822db40c0ac2ecbc0b548b438e5469e10460b6c3e7ea3", "14789d0d4a730b354403b5fac948113739e276c23e0258d8596ee72f9cd9d3230af18a63153e0ec25ff9f2951dd3fa90ed0197bfef6e2a1a62b5095b9d2b4a27"),
        ("cdetrio1", 6000, "1a87b0584ce92f4593d161480614f2989035225609f08058ccfa3d0f940febe31a2f3c951f6dadcc7ee9007dff81504b0fcd6d7cf59996efdc33d92bf7f9f8f6ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "2cde5879ba6f13c0b5aa4ef627f159a3347df9722efce88a9afbb20b763b4c411aa7e43076f6aee272755a7f9b84832e71559ba0d2e0b17d5f9f01755e5b0d11"),
        ("cdetrio2", 6000, "1a87b0584ce92f4593d161480614f2989035225609f08058ccfa3d0f940febe31a2f3c951f6dadcc7ee9007dff81504b0fcd6d7cf59996efdc33d92bf7f9f8f630644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000", "1a87b0584ce92f4593d161480614f2989035225609f08058ccfa3d0f940febe3163511ddc1c3f25d396745388200081287b3fd1472d8339d5fecb2eae0830451"),
        ("cdetrio3", 6000, "1a87b0584ce92f4593d161480614f2989035225609f08058ccfa3d0f940febe31a2f3c951f6dadcc7ee9007dff81504b0fcd6d7cf59996efdc33d92bf7f9f8f60000000000000000000000000000000100000000000000000000000000000000", "1051acb0700ec6d42a88215852d582efbaef31529b6fcbc3277b5c1b300f5cf0135b2394bb45ab04b8bd7611bd2dfe1de6a4e6e2ccea1ea1955f577cd66af85b"),
        ("cdetrio4", 6000, "1a87b0584ce92f4593d161480614f2989035225609f08058ccfa3d0f940febe31a2f3c951f6dadcc7ee9007dff81504b0fcd6d7cf59996efdc33d92bf7f9f8f60000000000000000000000000000000000000000000000000000000000000009", "1dbad7d39dbc56379f78fac1bca147dc8e66de1b9d183c7b167351bfe0aeab742cd757d51289cd8dbd0acf9e673ad67d0f0a89f912af47ed1be53664f5692575"),
        ("cdetrio5", 6000, "1a87b0584ce92f4593d161480614f2989035225609f08058ccfa3d0f940febe31a2f3c951f6dadcc7ee9007dff81504b0fcd6d7cf59996efdc33d92bf7f9f8f60000000000000000000000000000000000000000000000000000000000000001", "1a87b0584ce92f4593d161480614f2989035225609f08058ccfa3d0f940febe31a2f3c951f6dadcc7ee9007dff81504b0fcd6d7cf59996efdc33d92bf7f9f8f6"),
        ("cdetrio6", 6000, "17c139df0efee0f766bc0204762b774362e4ded88953a39ce849a8a7fa163fa901e0559bacb160664764a357af8a9fe70baa9258e0b959273ffc5718c6d4cc7cffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "29e587aadd7c06722aabba753017c093f70ba7eb1f1c0104ec0564e7e3e21f6022b1143f6a41008e7755c71c3d00b6b915d386de21783ef590486d8afa8453b1"),
        ("cdetrio7", 6000, "17c139df0efee0f766bc0204762b774362e4ded88953a39ce849a8a7fa163fa901e0559bacb160664764a357af8a9fe70baa9258e0b959273ffc5718c6d4cc7c30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000", "17c139df0efee0f766bc0204762b774362e4ded88953a39ce849a8a7fa163fa92e83f8d734803fc370eba25ed1f6b8768bd6d83887b87165fc2434fe11a830cb"),
        ("cdetrio8", 6000, "17c139df0efee0f766bc0204762b774362e4ded88953a39ce849a8a7fa163fa901e0559bacb160664764a357af8a9fe70baa9258e0b959273ffc5718c6d4cc7c0000000000000000000000000000000100000000000000000000000000000000", "221a3577763877920d0d14a91cd59b9479f83b87a653bb41f82a3f6f120cea7c2752c7f64cdd7f0e494bff7b60419f242210f2026ed2ec70f89f78a4c56a1f15"),
        ("cdetrio9", 6000, "17c139df0efee0f766bc0204762b774362e4ded88953a39ce849a8a7fa163fa901e0559bacb160664764a357af8a9fe70baa9258e0b959273ffc5718c6d4cc7c0000000000000000000000000000000000000000000000000000000000000009", "228e687a379ba154554040f8821f4e41ee2be287c201aa9c3bc02c9dd12f1e691e0fd6ee672d04cfd924ed8fdc7ba5f2d06c53c1edc30f65f2af5a5b97f0a76a"),
        ("cdetrio10", 6000, "17c139df0efee0f766bc0204762b774362e4ded88953a39ce849a8a7fa163fa901e0559bacb160664764a357af8a9fe70baa9258e0b959273ffc5718c6d4cc7c0000000000000000000000000000000000000000000000000000000000000001", "17c139df0efee0f766bc0204762b774362e4ded88953a39ce849a8a7fa163fa901e0559bacb160664764a357af8a9fe70baa9258e0b959273ffc5718c6d4cc7c"),
        ("cdetrio11", 6000, "039730ea8dff1254c0fee9c0ea777d29a9c710b7e616683f194f18c43b43b869073a5ffcc6fc7a28c30723d6e58ce577356982d65b833a5a5c15bf9024b43d98ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "00a1a234d08efaa2616607e31eca1980128b00b415c845ff25bba3afcb81dc00242077290ed33906aeb8e42fd98c41bcb9057ba03421af3f2d08cfc441186024"),
        ("cdetrio12", 6000, "039730ea8dff1254c0fee9c0ea777d29a9c710b7e616683f194f18c43b43b869073a5ffcc6fc7a28c30723d6e58ce577356982d65b833a5a5c15bf9024b43d9830644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000000", "039730ea8dff1254c0fee9c0ea777d29a9c710b7e616683f194f18c43b43b8692929ee761a352600f54921df9bf472e66217e7bb0cee9032e00acc86b3c8bfaf"),
        ("cdetrio13", 6000, "039730ea8dff1254c0fee9c0ea777d29a9c710b7e616683f194f18c43b43b869073a5ffcc6fc7a28c30723d6e58ce577356982d65b833a5a5c15bf9024b43d980000000000000000000000000000000100000000000000000000000000000000", "1071b63011e8c222c5a771dfa03c2e11aac9666dd097f2c620852c3951a4376a2f46fe2f73e1cf310a168d56baa5575a8319389d7bfa6b29ee2d908305791434"),
        ("cdetrio14", 6000, "039730ea8dff1254c0fee9c0ea777d29a9c710b7e616683f194f18c43b43b869073a5ffcc6fc7a28c30723d6e58ce577356982d65b833a5a5c15bf9024b43d980000000000000000000000000000000000000000000000000000000000000009", "19f75b9dd68c080a688774a6213f131e3052bd353a304a189d7a2ee367e3c2582612f545fb9fc89fde80fd81c68fc7dcb27fea5fc124eeda69433cf5c46d2d7f"),
        ("cdetrio15", 6000, "039730ea8dff1254c0fee9c0ea777d29a9c710b7e616683f194f18c43b43b869073a5ffcc6fc7a28c30723d6e58ce577356982d65b833a5a5c15bf9024b43d980000000000000000000000000000000000000000000000000000000000000001", "039730ea8dff1254c0fee9c0ea777d29a9c710b7e616683f194f18c43b43b869073a5ffcc6fc7a28c30723d6e58ce577356982d65b833a5a5c15bf9024b43d98"),
        ("zeroScalar", 6000, "039730ea8dff1254c0fee9c0ea777d29a9c710b7e616683f194f18c43b43b869073a5ffcc6fc7a28c30723d6e58ce577356982d65b833a5a5c15bf9024b43d980000000000000000000000000000000000000000000000000000000000000000", "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
    ];

    /// Vetores OFICIAIS do go-ethereum — `core/vm/testdata/precompiles/`. São os
    /// mesmos casos "chfast/cdetrio/jeff" dos testes de consenso do EIP-196/197.
    /// O gás anotado é o do EIP-1108 CRU; o teste multiplica por `BN254_GAS_MULTIPLIER`.
    ///
    /// Estão transcritos byte a byte do arquivo da referência (`test/bn254.test.js`)
    /// e não regenerados por nós: um vetor que este cliente "gera e confere" só
    /// prova que ele concorda consigo mesmo.
    const PAIRING_VECTORS: &[(&str, u64, &str, &str)] = &[
        ("jeff1", 113000, "1c76476f4def4bb94541d57ebba1193381ffa7aa76ada664dd31c16024c43f593034dd2920f673e204fee2811c678745fc819b55d3e9d294e45c9b03a76aef41209dd15ebff5d46c4bd888e51a93cf99a7329636c63514396b4a452003a35bf704bf11ca01483bfa8b34b43561848d28905960114c8ac04049af4b6315a416782bb8324af6cfc93537a2ad1a445cfd0ca2a71acd7ac41fadbf933c2a51be344d120a2a4cf30c1bf9845f20c6fe39e07ea2cce61f0c9bb048165fe5e4de877550111e129f1cf1097710d41c4ac70fcdfa5ba2023c6ff1cbeac322de49d1b6df7c2032c61a830e3c17286de9462bf242fca2883585b93870a73853face6a6bf411198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("jeff2", 113000, "2eca0c7238bf16e83e7a1e6c5d49540685ff51380f309842a98561558019fc0203d3260361bb8451de5ff5ecd17f010ff22f5c31cdf184e9020b06fa5997db841213d2149b006137fcfb23036606f848d638d576a120ca981b5b1a5f9300b3ee2276cf730cf493cd95d64677bbb75fc42db72513a4c1e387b476d056f80aa75f21ee6226d31426322afcda621464d0611d226783262e21bb3bc86b537e986237096df1f82dff337dd5972e32a8ad43e28a78a96a823ef1cd4debe12b6552ea5f06967a1237ebfeca9aaae0d6d0bab8e28c198c5a339ef8a2407e31cdac516db922160fa257a5fd5b280642ff47b65eca77e626cb685c84fa6d3b6882a283ddd1198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("jeff3", 113000, "0f25929bcb43d5a57391564615c9e70a992b10eafa4db109709649cf48c50dd216da2f5cb6be7a0aa72c440c53c9bbdfec6c36c7d515536431b3a865468acbba2e89718ad33c8bed92e210e81d1853435399a271913a6520736a4729cf0d51eb01a9e2ffa2e92599b68e44de5bcf354fa2642bd4f26b259daa6f7ce3ed57aeb314a9a87b789a58af499b314e13c3d65bede56c07ea2d418d6874857b70763713178fb49a2d6cd347dc58973ff49613a20757d0fcc22079f9abd10c3baee245901b9e027bd5cfc2cb5db82d4dc9677ac795ec500ecd47deee3b5da006d6d049b811d7511c78158de484232fc68daf8a45cf217d1c2fae693ff5871e8752d73b21198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("jeff4", 147000, "2f2ea0b3da1e8ef11914acf8b2e1b32d99df51f5f4f206fc6b947eae860eddb6068134ddb33dc888ef446b648d72338684d678d2eb2371c61a50734d78da4b7225f83c8b6ab9de74e7da488ef02645c5a16a6652c3c71a15dc37fe3a5dcb7cb122acdedd6308e3bb230d226d16a105295f523a8a02bfc5e8bd2da135ac4c245d065bbad92e7c4e31bf3757f1fe7362a63fbfee50e7dc68da116e67d600d9bf6806d302580dc0661002994e7cd3a7f224e7ddc27802777486bf80f40e4ca3cfdb186bac5188a98c45e6016873d107f5cd131f3a3e339d0375e58bd6219347b008122ae2b09e539e152ec5364e7e2204b03d11d3caa038bfc7cd499f8176aacbee1f39e4e4afc4bc74790a4a028aff2c3d2538731fb755edefd8cb48d6ea589b5e283f150794b6736f670d6a1033f9b46c6f5204f50813eb85c8dc4b59db1c5d39140d97ee4d2b36d99bc49974d18ecca3e7ad51011956051b464d9e27d46cc25e0764bb98575bd466d32db7b15f582b2d5c452b36aa394b789366e5e3ca5aabd415794ab061441e51d01e94640b7e3084a07e02c78cf3103c542bc5b298669f211b88da1679b0b64a63b7e0e7bfe52aae524f73a55be7fe70c7e9bfc94b4cf0da1213d2149b006137fcfb23036606f848d638d576a120ca981b5b1a5f9300b3ee2276cf730cf493cd95d64677bbb75fc42db72513a4c1e387b476d056f80aa75f21ee6226d31426322afcda621464d0611d226783262e21bb3bc86b537e986237096df1f82dff337dd5972e32a8ad43e28a78a96a823ef1cd4debe12b6552ea5f", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("jeff5", 147000, "20a754d2071d4d53903e3b31a7e98ad6882d58aec240ef981fdf0a9d22c5926a29c853fcea789887315916bbeb89ca37edb355b4f980c9a12a94f30deeed30211213d2149b006137fcfb23036606f848d638d576a120ca981b5b1a5f9300b3ee2276cf730cf493cd95d64677bbb75fc42db72513a4c1e387b476d056f80aa75f21ee6226d31426322afcda621464d0611d226783262e21bb3bc86b537e986237096df1f82dff337dd5972e32a8ad43e28a78a96a823ef1cd4debe12b6552ea5f1abb4a25eb9379ae96c84fff9f0540abcfc0a0d11aeda02d4f37e4baf74cb0c11073b3ff2cdbb38755f8691ea59e9606696b3ff278acfc098fa8226470d03869217cee0a9ad79a4493b5253e2e4e3a39fc2df38419f230d341f60cb064a0ac290a3d76f140db8418ba512272381446eb73958670f00cf46f1d9e64cba057b53c26f64a8ec70387a13e41430ed3ee4a7db2059cc5fc13c067194bcc0cb49a98552fd72bd9edb657346127da132e5b82ab908f5816c826acb499e22f2412d1a2d70f25929bcb43d5a57391564615c9e70a992b10eafa4db109709649cf48c50dd2198a1f162a73261f112401aa2db79c7dab1533c9935c77290a6ce3b191f2318d198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("jeff6", 113000, "1c76476f4def4bb94541d57ebba1193381ffa7aa76ada664dd31c16024c43f593034dd2920f673e204fee2811c678745fc819b55d3e9d294e45c9b03a76aef41209dd15ebff5d46c4bd888e51a93cf99a7329636c63514396b4a452003a35bf704bf11ca01483bfa8b34b43561848d28905960114c8ac04049af4b6315a416782bb8324af6cfc93537a2ad1a445cfd0ca2a71acd7ac41fadbf933c2a51be344d120a2a4cf30c1bf9845f20c6fe39e07ea2cce61f0c9bb048165fe5e4de877550111e129f1cf1097710d41c4ac70fcdfa5ba2023c6ff1cbeac322de49d1b6df7c103188585e2364128fe25c70558f1560f4f9350baf3959e603cc91486e110936198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa", "0000000000000000000000000000000000000000000000000000000000000000"),
        ("empty_data", 45000, "", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("one_point", 79000, "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa", "0000000000000000000000000000000000000000000000000000000000000000"),
        ("two_point_match_2", 113000, "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed275dc4a288d1afb3cbb1ac09187524c7db36395df7be3b99e673b13a075a65ec1d9befcd05a5323e6da4d435f3b617cdb3af83285c2df711ef39c01571827f9d", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("two_point_match_3", 113000, "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002203e205db4f19b37b60121b83a7333706db86431c6d835849957ed8c3928ad7927dc7234fd11d3e8c36c59277c3e6f149d5cd3cfa9a62aee49f8130962b4b3b9195e8aa5b7827463722b8c153931579d3505566b4edf48d498e185f0509de15204bb53b8977e5f92a0bc372742c4830944a59b4fe6b1c0466e2a6dad122b5d2e030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd31a76dae6d3272396d0cbe61fced2bc532edac647851e3ac53ce1cc9c7e645a83198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("two_point_match_4", 113000, "105456a333e6d636854f987ea7bb713dfd0ae8371a72aea313ae0c32c0bf10160cf031d41b41557f3e7e3ba0c51bebe5da8e6ecd855ec50fc87efcdeac168bcc0476be093a6d2b4bbf907172049874af11e1b6267606e00804d3ff0037ec57fd3010c68cb50161b7d1d96bb71edfec9880171954e56871abf3d93cc94d745fa114c059d74e5b6c4ec14ae5864ebe23a71781d86c29fb8fb6cce94f70d3de7a2101b33461f39d9e887dbb100f170a2345dde3c07e256d1dfa2b657ba5cd030427000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000021a2c3013d2ea92e13c800cde68ef56a294b883f6ac35d25f587c09b1b3c635f7290158a80cd3d66530f74dc94c94adb88f5cdb481acca997b6e60071f08a115f2f997f3dbd66a7afe07fe7862ce239edba9e05c5afff7f8a1259c9733b2dfbb929d1691530ca701b4a106054688728c9972c8512e9789e9567aae23e302ccd75", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("ten_point_match_1", 385000, "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed275dc4a288d1afb3cbb1ac09187524c7db36395df7be3b99e673b13a075a65ec1d9befcd05a5323e6da4d435f3b617cdb3af83285c2df711ef39c01571827f9d00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed275dc4a288d1afb3cbb1ac09187524c7db36395df7be3b99e673b13a075a65ec1d9befcd05a5323e6da4d435f3b617cdb3af83285c2df711ef39c01571827f9d00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed275dc4a288d1afb3cbb1ac09187524c7db36395df7be3b99e673b13a075a65ec1d9befcd05a5323e6da4d435f3b617cdb3af83285c2df711ef39c01571827f9d00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed275dc4a288d1afb3cbb1ac09187524c7db36395df7be3b99e673b13a075a65ec1d9befcd05a5323e6da4d435f3b617cdb3af83285c2df711ef39c01571827f9d00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed275dc4a288d1afb3cbb1ac09187524c7db36395df7be3b99e673b13a075a65ec1d9befcd05a5323e6da4d435f3b617cdb3af83285c2df711ef39c01571827f9d", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("ten_point_match_2", 385000, "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002203e205db4f19b37b60121b83a7333706db86431c6d835849957ed8c3928ad7927dc7234fd11d3e8c36c59277c3e6f149d5cd3cfa9a62aee49f8130962b4b3b9195e8aa5b7827463722b8c153931579d3505566b4edf48d498e185f0509de15204bb53b8977e5f92a0bc372742c4830944a59b4fe6b1c0466e2a6dad122b5d2e030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd31a76dae6d3272396d0cbe61fced2bc532edac647851e3ac53ce1cc9c7e645a83198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002203e205db4f19b37b60121b83a7333706db86431c6d835849957ed8c3928ad7927dc7234fd11d3e8c36c59277c3e6f149d5cd3cfa9a62aee49f8130962b4b3b9195e8aa5b7827463722b8c153931579d3505566b4edf48d498e185f0509de15204bb53b8977e5f92a0bc372742c4830944a59b4fe6b1c0466e2a6dad122b5d2e030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd31a76dae6d3272396d0cbe61fced2bc532edac647851e3ac53ce1cc9c7e645a83198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002203e205db4f19b37b60121b83a7333706db86431c6d835849957ed8c3928ad7927dc7234fd11d3e8c36c59277c3e6f149d5cd3cfa9a62aee49f8130962b4b3b9195e8aa5b7827463722b8c153931579d3505566b4edf48d498e185f0509de15204bb53b8977e5f92a0bc372742c4830944a59b4fe6b1c0466e2a6dad122b5d2e030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd31a76dae6d3272396d0cbe61fced2bc532edac647851e3ac53ce1cc9c7e645a83198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002203e205db4f19b37b60121b83a7333706db86431c6d835849957ed8c3928ad7927dc7234fd11d3e8c36c59277c3e6f149d5cd3cfa9a62aee49f8130962b4b3b9195e8aa5b7827463722b8c153931579d3505566b4edf48d498e185f0509de15204bb53b8977e5f92a0bc372742c4830944a59b4fe6b1c0466e2a6dad122b5d2e030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd31a76dae6d3272396d0cbe61fced2bc532edac647851e3ac53ce1cc9c7e645a83198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002203e205db4f19b37b60121b83a7333706db86431c6d835849957ed8c3928ad7927dc7234fd11d3e8c36c59277c3e6f149d5cd3cfa9a62aee49f8130962b4b3b9195e8aa5b7827463722b8c153931579d3505566b4edf48d498e185f0509de15204bb53b8977e5f92a0bc372742c4830944a59b4fe6b1c0466e2a6dad122b5d2e030644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd31a76dae6d3272396d0cbe61fced2bc532edac647851e3ac53ce1cc9c7e645a83198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa", "0000000000000000000000000000000000000000000000000000000000000001"),
        ("ten_point_match_3", 113000, "105456a333e6d636854f987ea7bb713dfd0ae8371a72aea313ae0c32c0bf10160cf031d41b41557f3e7e3ba0c51bebe5da8e6ecd855ec50fc87efcdeac168bcc0476be093a6d2b4bbf907172049874af11e1b6267606e00804d3ff0037ec57fd3010c68cb50161b7d1d96bb71edfec9880171954e56871abf3d93cc94d745fa114c059d74e5b6c4ec14ae5864ebe23a71781d86c29fb8fb6cce94f70d3de7a2101b33461f39d9e887dbb100f170a2345dde3c07e256d1dfa2b657ba5cd030427000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000021a2c3013d2ea92e13c800cde68ef56a294b883f6ac35d25f587c09b1b3c635f7290158a80cd3d66530f74dc94c94adb88f5cdb481acca997b6e60071f08a115f2f997f3dbd66a7afe07fe7862ce239edba9e05c5afff7f8a1259c9733b2dfbb929d1691530ca701b4a106054688728c9972c8512e9789e9567aae23e302ccd75", "0000000000000000000000000000000000000000000000000000000000000001"),
    ];

    #[test]
    fn bn254_ecadd_vetores_oficiais_do_go_ethereum() {
        for (nome, gas, entrada, esperado) in ADD_VECTORS {
            let e = hexb(entrada);
            assert_eq!(
                precompile_gas(6, &e).unwrap(),
                gas * BN254_GAS_MULTIPLIER,
                "gás de ecAdd {nome}"
            );
            assert_eq!(hex::encode(precompile_run(6, &e).unwrap()), *esperado, "ecAdd {nome}");
        }
    }

    #[test]
    fn bn254_ecmul_vetores_oficiais_do_go_ethereum() {
        for (nome, gas, entrada, esperado) in MUL_VECTORS {
            let e = hexb(entrada);
            assert_eq!(
                precompile_gas(7, &e).unwrap(),
                gas * BN254_GAS_MULTIPLIER,
                "gás de ecMul {nome}"
            );
            assert_eq!(hex::encode(precompile_run(7, &e).unwrap()), *esperado, "ecMul {nome}");
        }
    }

    #[test]
    fn bn254_ecpairing_vetores_oficiais_do_go_ethereum() {
        for (nome, gas, entrada, esperado) in PAIRING_VECTORS {
            let e = hexb(entrada);
            assert_eq!(
                precompile_gas(8, &e).unwrap(),
                gas * BN254_GAS_MULTIPLIER,
                "gás de ecPairing {nome}"
            );
            assert_eq!(hex::encode(precompile_run(8, &e).unwrap()), *esperado, "ecPairing {nome}");
        }
    }

    #[test]
    fn bn254_gas_e_o_do_eip1108_multiplicado_e_nao_depende_do_tamanho() {
        // O multiplicador é REGRA DE CONSENSO, não característica de implementação:
        // este cliente é nativo e seria mais barato, mas baixá-lo aqui faria o nó
        // aceitar transações que a rede rejeita.
        assert_eq!(precompile_gas(6, &[]).unwrap(), 150 * 13);
        assert_eq!(precompile_gas(6, &[0u8; 4096]).unwrap(), 150 * 13);
        assert_eq!(precompile_gas(7, &[]).unwrap(), 6000 * 13);
        assert_eq!(precompile_gas(7, &[0u8; 4096]).unwrap(), 6000 * 13);
        assert_eq!(precompile_gas(8, &[]).unwrap(), 45_000 * 13);
        assert_eq!(precompile_gas(8, &[0u8; 192]).unwrap(), (34_000 + 45_000) * 13);
        assert_eq!(precompile_gas(8, &[0u8; 1920]).unwrap(), (340_000 + 45_000) * 13);
    }

    #[test]
    fn bn254_entrada_curta_e_preenchida_com_zeros_a_direita() {
        // 0 bytes ⇒ O + O = O
        assert_eq!(hex::encode(precompile_run(6, &[]).unwrap()), "0".repeat(128));
        // só o primeiro ponto ⇒ P + O = P
        let g1 = hexb(G1_GERADOR);
        assert_eq!(hex::encode(precompile_run(6, &g1).unwrap()), G1_GERADOR);
    }

    #[test]
    fn bn254_rejeita_coordenada_maior_ou_igual_a_p() {
        // Aceitar reduziria módulo p e criaria DUAS codificações do mesmo ponto —
        // maleabilidade, que quebra qualquer esquema dependente da unicidade da
        // codificação (nulificador de zk, dedup de prova).
        let p_hex = "30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47";
        let e = hexb(&format!("{p_hex}{}", "00".repeat(32)));
        assert!(precompile_run(6, &e).is_err(), "x = p tem de ser rejeitado");
        assert!(precompile_run(7, &e).is_err());
    }

    #[test]
    fn bn254_rejeita_ponto_g1_fora_da_curva() {
        // (1, 1) não satisfaz y² = x³ + 3.
        let um = format!("{}1", "0".repeat(63));
        let e = hexb(&format!("{um}{um}"));
        assert!(precompile_run(6, &e).is_err(), "ecAdd tem de rejeitar ponto fora da curva");
        assert!(precompile_run(7, &e).is_err(), "ecMul tem de rejeitar ponto fora da curva");
    }

    #[test]
    fn bn254_rejeita_ponto_g2_fora_do_subgrupo_de_ordem_r() {
        // ESTE é o teste que separa um precompile de pairing de um oráculo de "sim".
        // E'(Fp2) tem cofator grande: um ponto pode estar NA CURVA e ainda assim
        // pertencer a outra componente. Sem a checagem de subgrupo o pairing é
        // FORJÁVEL — dá para construir uma prova Groth16 falsa que verifica.
        let valido = hexb(&format!("{G1_GERADOR}{G2_GERADOR}"));
        assert!(precompile_run(8, &valido).is_ok(), "controle: o gerador é válido");

        // Um ponto NA CURVA e FORA do subgrupo, construído — não achado por
        // perturbação cega. Tomamos x = (c, 0) e levantamos y de y² = x³ + b'. O
        // cofator de E'(Fp2) é enorme, então quase todo ponto da curva cai fora do
        // subgrupo de ordem r: é exatamente o material de forja que a checagem barra.
        let mut testados = 0;
        for c in 1u64..64 {
            let x = Fq2::new(Fq::from(c), Fq::from(0u64));
            let Some(p) = G2Affine::get_point_from_x_unchecked(x, false) else {
                continue; // x³ + b' não é resíduo quadrático: não há ponto com este x
            };
            assert!(p.is_on_curve(), "levantado da própria equação da curva");
            if p.is_in_correct_subgroup_assuming_on_curve() {
                continue; // raríssimo, mas não serve de contraexemplo
            }
            testados += 1;

            let (px, py) = (p.x, p.y);
            let enc = format!(
                "{}{}{}{}",
                hex::encode(write_fq(&px.c1)), // x_im primeiro: é a ordem do EIP-197
                hex::encode(write_fq(&px.c0)),
                hex::encode(write_fq(&py.c1)),
                hex::encode(write_fq(&py.c0)),
            );
            let entrada = hexb(&format!("{G1_GERADOR}{enc}"));
            match precompile_run(8, &entrada) {
                Err(EavmError::Host(msg)) => assert!(
                    msg.contains("subgrupo"),
                    "tem de falhar POR SUBGRUPO, não por outro motivo: {msg}"
                ),
                Ok(_) => panic!("ponto G2 fora do subgrupo NÃO pode ser aceito — pairing forjável"),
                Err(e) => panic!("erro inesperado: {e}"),
            }
        }
        assert!(testados > 0, "a construção tem de produzir ao menos um contraexemplo");
    }

    #[test]
    fn bn254_pairing_rejeita_comprimento_fora_do_multiplo_de_192() {
        for n in [1usize, 64, 191, 193, 200] {
            let e = vec![0u8; n];
            assert!(precompile_gas(8, &e).is_err(), "{n} bytes");
            assert!(precompile_run(8, &e).is_err(), "{n} bytes");
        }
    }

    #[test]
    fn bn254_pairing_de_entrada_vazia_e_1() {
        // Produto vazio é o elemento neutro. Importa: um verificador que receba zero
        // pares tem de ver "verdadeiro", não "falso".
        assert_eq!(hex::encode(precompile_run(8, &[]).unwrap()), format!("{:063}1", 0));
    }

    #[test]
    fn bn254_ecmul_reduz_o_escalar_modulo_r() {
        // r·G = infinito.
        let r_hex = "30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001";
        let por_r = precompile_run(7, &hexb(&format!("{G1_GERADOR}{r_hex}"))).unwrap();
        assert_eq!(hex::encode(por_r), "0".repeat(128), "r·G1 = infinito");
    }
}
