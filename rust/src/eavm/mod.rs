//! EAVM — a máquina virtual da EAV7.
//!
//! Mesmo conceito da TVM/EVM: interpreta bytecode sobre uma palavra de 256 bits.
//! O gás é medido em ENERGIA, o recurso da rede.
//!
//! A referência é `src/eavm/vm.js`. Este módulo é o port de produção, e vale aqui
//! a regra geral do crate: onde os dois divergirem, o certo é o que a referência
//! faz — porque é ela que a rede está rodando. Ver `vectors/evm.json`.

pub mod envelope;
pub mod host;
pub mod vm;

pub use vm::{
    run_eavm, Address, BlockContext, CallKind, CallOutcome, CallRequest, CreateOutcome,
    CreateRequest, EavmError, ExecParams, ExecResult, Host, Log, SimpleHost, Word,
    EAVM_OSAKA_HEIGHT, MAX_CALL_DEPTH,
};
