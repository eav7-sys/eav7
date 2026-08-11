//! Trilho de RECURSOS: energia e bandwidth (porte de `state.js:114-176`).
//!
//! Toda transação passa por aqui — não só as da EAVM. É o que decide quanta
//! energia/bandwidth a conta consome e quanto sobra para QUEIMAR como taxa, e os
//! contadores que ele grava (`energyUsed`, `energyBlock`, `bandwidthUsed`,
//! `bandwidthBlock`) entram na folha `acct` do `stateRoot`. Um cliente que não os
//! atualize chega a outra raiz mesmo acertando todos os saldos — foi exatamente
//! assim que a prova de replay pegou este módulo faltando.
//!
//! # Por que `f64`
//!
//! A referência calcula recursos com `Number` (float de 64 bits) e `Math.floor`.
//! Reproduzir em inteiro daria outro resultado nos casos-limite, então a
//! aritmética aqui espelha a ordem das operações do JS, não uma versão "melhor".

use std::collections::BTreeMap;

use crate::config::{bandwidth, energy, energy_cost, gb, UNIT};
use crate::transaction::{canonical_json, JsonValue, Tx};

use super::{soma, Account, Amount, State, StateError};

type R<T> = Result<T, StateError>;

fn erro(msg: impl Into<String>) -> StateError {
    StateError::new(msg)
}

// ============================================================================
// Recursos: energia e bandwidth (porte de state.js:118-176)
// ============================================================================

/// Resultado de `#peekEnergy`/`#peekBandwidth`: `{ shortfall, usedAfter }`.
/// Em `f64` porque a referência opera em `Number` — ver o doc do módulo.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Peek {
    pub(crate) shortfall: f64,
    pub(crate) used_after: f64,
}

/// `resourceStake(acc)` (state.js:114-116) em unidades de EAV7 inteiro, como
/// `Number(resourceStake / UNIT)` usa: BigInt pode ficar NEGATIVO no JS e a
/// divisão de BigInt trunca em direção a zero — `i128 / i128` faz o mesmo.
pub(crate) fn resource_units(acc: &Account) -> f64 {
    let rs = acc.staked as i128 - acc.delegated_out as i128 + acc.delegated_in as i128;
    (rs / UNIT as i128) as f64
}

/// `maxEnergy` (state.js:119-121): cota grátis + bônus por resourceStake.
pub(crate) fn max_energy(acc: &Account) -> f64 {
    energy::FREE as f64 + resource_units(acc) * energy::PER_STAKED_EAV7 as f64
}

/// `maxBandwidth` (state.js:124-126).
pub(crate) fn max_bandwidth(acc: &Account) -> f64 {
    bandwidth::FREE as f64 + resource_units(acc) * bandwidth::PER_STAKED_EAV7 as f64
}

/// O miolo comum de `#peekEnergy` (state.js:155-161) e `#peekBandwidth`
/// (state.js:140-146): regeneração linear preguiçosa ao longo de `regen` blocos,
/// SEM mutar. A ordem dos floats é a do JS: `(max * elapsed) / regen` e então
/// `Math.floor`.
fn peek(max: f64, used_raw: u64, used_block: u64, height: u64, regen: f64, cost: f64) -> Peek {
    // `Math.max(0, height - (acc.xBlock ?? 0))` — saturating cobre o caso de
    // altura menor que o bloco registrado (reorg profundo/estado importado).
    let elapsed = height.saturating_sub(used_block) as f64;
    let used = (used_raw as f64 - ((max * elapsed) / regen).floor()).max(0.0);
    let available = (max - used).max(0.0);
    Peek { shortfall: (cost - available).max(0.0), used_after: used + available.min(cost) }
}

pub(crate) fn peek_energy(acc: &Account, height: u64, cost: f64) -> Peek {
    peek(max_energy(acc), acc.energy_used, acc.energy_block, height, energy::REGEN_BLOCKS as f64, cost)
}

pub(crate) fn peek_bandwidth(acc: &Account, height: u64, bytes: f64) -> Peek {
    peek(
        max_bandwidth(acc),
        acc.bandwidth_used,
        acc.bandwidth_block,
        height,
        bandwidth::REGEN_BLOCKS as f64,
        bytes,
    )
}

/// `energyOf(address, height).available` (state.js:169-176). Conta ausente lê a
/// cota grátis — LEITURA não materializa conta (mudaria a raiz).
pub(crate) fn energia_disponivel(state: &State, address: &str, height: u64) -> f64 {
    let Some(acc) = state.accounts.get(address) else {
        return energy::FREE as f64;
    };
    let max_e = max_energy(acc);
    let elapsed = height.saturating_sub(acc.energy_block) as f64;
    let used =
        (acc.energy_used as f64 - ((max_e * elapsed) / energy::REGEN_BLOCKS as f64).floor()).max(0.0);
    (max_e - used).max(0.0)
}

/// `#commitEnergy` (state.js:163-166). Os valores são inteiros por construção
/// (ver o doc do módulo); o cast satura em vez de entrar em pânico.
pub(crate) fn commit_energy(acc: &mut Account, height: u64, p: &Peek) {
    acc.energy_block = height;
    acc.energy_used = p.used_after as u64;
}

/// `#commitBandwidth` (state.js:148-151).
pub(crate) fn commit_bandwidth(acc: &mut Account, height: u64, p: &Peek) {
    acc.bandwidth_block = height;
    acc.bandwidth_used = p.used_after as u64;
}

/// A taxa apurada: `BigInt(energy.shortfall) * BURN_PER_ENERGY + bwFee`
/// (state.js:1177-1179). A falta de recurso é QUEIMADA em EAV7 — deflacionário.
pub(crate) fn taxa_de(energia: &Peek, bw: Option<&Peek>) -> R<Amount> {
    let mut fee = (energia.shortfall as u128)
        .checked_mul(energy::BURN_PER_ENERGY)
        .ok_or_else(|| erro("estouro aritmético na soma"))?;
    if let Some(b) = bw {
        let bw_fee = (b.shortfall as u128)
            .checked_mul(bandwidth::BURN_PER_BYTE)
            .ok_or_else(|| erro("estouro aritmético na soma"))?;
        fee = soma(fee, bw_fee)?;
    }
    Ok(fee)
}

/// Cota máxima GB/dia (bytes ponderados): 1 GB + 1 MB × resource-stake EAV7.
pub(crate) fn max_gb(acc: &Account) -> f64 {
    gb::DAILY_BYTES as f64 + resource_units(acc) * gb::PER_STAKED_EAV7_BYTES as f64
}

pub(crate) fn peek_gb(acc: &Account, height: u64, cost: f64) -> Peek {
    peek(max_gb(acc), acc.gb_used, acc.gb_block, height, gb::REGEN_BLOCKS as f64, cost)
}

pub(crate) fn commit_gb(acc: &mut Account, height: u64, p: &Peek) {
    acc.gb_block = height;
    acc.gb_used = p.used_after as u64;
}

/// Taxa GB: shortfall × `BURN_PER_BYTE` (plano 12).
pub(crate) fn taxa_gb(gb_peek: &Peek) -> R<Amount> {
    (gb_peek.shortfall as u128)
        .checked_mul(gb::BURN_PER_WEIGHTED_BYTE)
        .ok_or_else(|| erro("estouro aritmético na soma"))
}

/// Bytes ponderados: `(len útil) × ENERGY_COST[tipo]`, com piso anti-dust.
pub(crate) fn consumo_gb(tx: &Tx) -> f64 {
    let uteis = useful_tx_bytes(tx) as f64;
    let fator = energy_cost(&tx.tx_type) as f64;
    (uteis * fator).max(gb::MIN_WEIGHTED as f64)
}

/// `canonical_tx_bytes` sem `signature` / `pqSignature` (chaves públicas ficam).
pub(crate) fn useful_tx_bytes(tx: &Tx) -> usize {
    let mut m: BTreeMap<String, JsonValue> = BTreeMap::new();
    m.insert("protocol".into(), JsonValue::str(&tx.protocol));
    m.insert("scheme".into(), JsonValue::str(&tx.scheme));
    m.insert("type".into(), JsonValue::str(&tx.tx_type));
    m.insert("from".into(), JsonValue::str(&tx.from));
    m.insert(
        "to".into(),
        match &tx.to {
            Some(a) => JsonValue::str(a),
            None => JsonValue::Null,
        },
    );
    m.insert("amount".into(), JsonValue::str(&tx.amount));
    m.insert("fee".into(), JsonValue::str(&tx.fee));
    m.insert("nonce".into(), JsonValue::Int(tx.nonce));
    m.insert("timestamp".into(), JsonValue::Int(tx.timestamp));
    if let Some(d) = &tx.data {
        m.insert("data".into(), d.clone());
    }
    if let Some(k) = &tx.public_key {
        m.insert("publicKey".into(), JsonValue::str(k));
    }
    if let Some(k) = &tx.pq_public_key {
        m.insert("pqPublicKey".into(), JsonValue::str(k));
    }
    if let Some(id) = &tx.id {
        m.insert("id".into(), JsonValue::str(id));
    }
    canonical_json(&JsonValue::Map(m)).len()
}

/// `Buffer.byteLength(canonical(tx))` (state.js:1175): o tamanho em bytes da
/// serialização canônica da transação INTEIRA — inclusive `id`, assinaturas e
/// chaves públicas quando presentes, que é o que o objeto JS carrega no momento
/// da aplicação. `tx_signing_payload` NÃO serve aqui: ele exclui `signature`/
/// `pqSignature`/`id` de propósito (anti-maleabilidade), e o bandwidth cobra o
/// VOLUME trafegado, não a pré-imagem do id.
pub(crate) fn canonical_tx_bytes(tx: &Tx) -> usize {
    let mut m: BTreeMap<String, JsonValue> = BTreeMap::new();
    m.insert("protocol".into(), JsonValue::str(&tx.protocol));
    m.insert("scheme".into(), JsonValue::str(&tx.scheme));
    m.insert("type".into(), JsonValue::str(&tx.tx_type));
    m.insert("from".into(), JsonValue::str(&tx.from));
    // `to: null` é EMITIDO (null não é undefined) — igual ao sortValue do JS.
    m.insert(
        "to".into(),
        match &tx.to {
            Some(a) => JsonValue::str(a),
            None => JsonValue::Null,
        },
    );
    m.insert("amount".into(), JsonValue::str(&tx.amount));
    m.insert("fee".into(), JsonValue::str(&tx.fee));
    m.insert("nonce".into(), JsonValue::Int(tx.nonce));
    m.insert("timestamp".into(), JsonValue::Int(tx.timestamp));
    // Campos opcionais: `undefined` (None) é DESCARTADO pelo canonical do JS
    // (hash.js:16-18) — a chave nem aparece, e o byte a menos importa.
    if let Some(d) = &tx.data {
        m.insert("data".into(), d.clone());
    }
    if let Some(k) = &tx.public_key {
        m.insert("publicKey".into(), JsonValue::str(k));
    }
    if let Some(k) = &tx.pq_public_key {
        m.insert("pqPublicKey".into(), JsonValue::str(k));
    }
    if let Some(s) = &tx.signature {
        m.insert("signature".into(), JsonValue::str(s));
    }
    if let Some(s) = &tx.pq_signature {
        m.insert("pqSignature".into(), JsonValue::str(s));
    }
    if let Some(id) = &tx.id {
        m.insert("id".into(), JsonValue::str(id));
    }
    canonical_json(&JsonValue::Map(m)).len()
}

// ============================================================================
// Auxiliares de forma
// ============================================================================
