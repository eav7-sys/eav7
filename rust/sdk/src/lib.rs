//! SDK EAV7 — o que um programa precisa para falar com a rede eav20.
//!
//! # Por que existe
//!
//! A capacidade já estava toda portada, e toda PRESA: os construtores de
//! transação viviam dentro do binário da CLI e do módulo de IA do nó, a geração
//! de carteira dentro da CLI, e as provas de light client em nenhum lugar
//! público. Quem quisesse escrever um programa em Rust contra a EAV7 teria de
//! depender do crate do NÓ inteiro — servidor HTTP, P2P, produção de blocos — ou
//! reimplementar a assinatura por conta própria.
//!
//! A segunda opção é a perigosa: uma segunda versão da regra que decide o que é
//! assinado e qual é o `id` de uma transação. É exatamente o tipo de duplicação
//! que esta migração vem eliminando, e um SDK ausente é um convite a criá-la.
//!
//! # A direção da dependência
//!
//! Este crate depende da lib de CONSENSO e nunca do crate do nó. Assinar,
//! codificar e provar vêm de `eav7`; daqui saem só o transporte HTTP e a
//! ergonomia. Um SDK que arrastasse o nó tornaria o custo de usá-lo maior que o
//! de copiar a assinatura — e aí a duplicação voltaria pela porta dos fundos.
//!
//! # Síncrono de propósito
//!
//! O cliente HTTP é bloqueante. Um SDK não deve impor runtime a quem o usa: quem
//! já tem tokio chama de dentro de `spawn_blocking`; quem só quer um script não
//! precisa aprender async para consultar um saldo.

pub mod bridge;
pub mod cliente;
pub mod faucet;
pub mod wallet;

pub use bridge::{AdaptadorDeCadeia, AdaptadorDeLaco, Deposito, Relayer, Transferencia};
pub use cliente::{
    Confirmacao, Conta, Desempenho, Eav7Client, Eav7ClientBuilder, ErroCliente, Historico,
    Remetente, Submissao, TxResumida, Unbonding, Validador,
};
pub use faucet::Faucet;
pub use wallet::ProductionWallet;

// Reexporta o que o SDK constrói em cima, para que o consumidor não precise
// declarar `eav7` como dependência direta só para nomear um tipo.
pub use eav7::block::BlockSigner;
pub use eav7::stateroot::{verify_account_proof, PathStep, ProvaDeConta};
pub use eav7::transaction::{build_transaction, default_fee_limit, JsonValue, Tx, TxSpec};
pub use eav7::{derive_address_from, is_valid_address};
