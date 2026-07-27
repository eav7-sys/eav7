//! Conformidade da integração EAVM <-> estado contra `vectors/eavm-state.json`,
//! gerado pelo nó de referência (`node bin/eav7-vectors-eavm.js`).
//!
//! É o teste que fecha o porte de CONSENSO dos manipuladores EAVM
//! (`rust/src/state/eavm_tx.rs`). Cada caso declara um estado inicial, aplica
//! transações CRUAS (`applyTransaction` não verifica assinatura — isso é do
//! `verifyTransaction`, stateless, que roda antes) e fixa:
//!
//! * `fees[]`     — a taxa QUEIMADA por transação (delta de `totalBurned`);
//! * `receipts[]` — o recibo `{success, gasUsed, contractAddr?, logs, xfers}`
//!   por transação EAVM (`null` para tipos sem recibo);
//! * `leaves[]`   — TODAS as folhas do stateRoot do estado FINAL, ordenadas,
//!   com `merkleRoot(leaves) == stateRoot`;
//! * `error`      — quando a transação de índice `errorTxIndex` LANÇA; nesse
//!   caso as `leaves` provam o estado INTACTO (atomicidade
//!   C-1/A-4: nada da VM sobrevive a uma rejeição).
//!
//! Regra da casa: um caso que não bata é bug DESTE cliente ou lacuna a relatar —
//! nunca motivo para ajustar vetor ou teste.

use eav7::compute_state_root;
use eav7::state::contracts::Contract;
use eav7::state::eavm_tx::EavmOutcome;
use eav7::state::token::Token;
use eav7::state::State;
use eav7::{JsonValue, Tx};
use serde_json::Value;
use std::collections::BTreeMap;
use std::{fs, path::PathBuf};

fn carrega() -> Value {
    let caminho = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("raiz do repositório")
        .join("vectors")
        .join("eavm-state.json");
    let texto = fs::read_to_string(&caminho).unwrap_or_else(|e| {
        panic!(
            "não consegui ler {}: {e}\nrode: node bin/eav7-vectors-eavm.js",
            caminho.display()
        )
    });
    serde_json::from_str(&texto).expect("vetor com JSON inválido")
}

/// `data` da transação (JSON livre) para o `JsonValue` do protocolo. Números só
/// aparecem como inteiro — float não existe no protocolo de propósito.
fn de_json(v: &Value) -> JsonValue {
    match v {
        Value::Null => JsonValue::Null,
        Value::Bool(b) => JsonValue::Bool(*b),
        Value::Number(n) => JsonValue::Int(n.as_i64().expect("inteiro; float não é do protocolo")),
        Value::String(s) => JsonValue::Str(s.clone()),
        Value::Array(itens) => JsonValue::List(itens.iter().map(de_json).collect()),
        Value::Object(campos) => {
            let mut m = BTreeMap::new();
            for (k, v) in campos {
                m.insert(k.clone(), de_json(v));
            }
            JsonValue::Map(m)
        }
    }
}

fn amount(v: &Value) -> u128 {
    v.as_str().expect("valor monetário vem como texto decimal").parse().expect("decimal válido")
}

/// Monta o estado inicial declarativo — espelho do `montar` do gerador
/// (`bin/eav7-vectors-eavm.js:120-145`).
fn montar(pre: &Value) -> State {
    let mut s = State::new();

    if let Some(contas) = pre.get("accounts").and_then(|v| v.as_object()) {
        for (end, conf) in contas {
            let a = s.account_mut(end);
            if let Some(b) = conf.get("balance") {
                a.balance = amount(b);
            }
            if let Some(st) = conf.get("staked") {
                a.staked = amount(st);
            }
            if let Some(n) = conf.get("nonce").and_then(|v| v.as_u64()) {
                a.nonce = n;
            }
        }
    }

    if let Some(contratos) = pre.get("contracts").and_then(|v| v.as_object()) {
        for (addr, c) in contratos {
            let mut storage = BTreeMap::new();
            if let Some(m) = c.get("storage").and_then(|v| v.as_object()) {
                for (k, v) in m {
                    storage.insert(k.clone(), v.as_str().expect("slot é texto 0x…").to_string());
                }
            }
            s.contracts.insert(
                addr.clone(),
                Contract {
                    code: c.get("code").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    storage,
                    balance: c.get("balance").map(amount).unwrap_or(0),
                    nonce: c.get("nonce").and_then(|v| v.as_u64()).unwrap_or(0),
                },
            );
        }
    }

    if let Some(tokens) = pre.get("tokens").and_then(|v| v.as_object()) {
        for (id, tok) in tokens {
            let mut balances = BTreeMap::new();
            if let Some(m) = tok.get("balances").and_then(|v| v.as_object()) {
                for (k, v) in m {
                    balances.insert(k.clone(), amount(v));
                }
            }
            let creator = tok["creator"].as_str().expect("creator").to_string();
            s.tokens.insert(
                id.clone(),
                Token {
                    standard: "eav20".to_string(),
                    id: id.clone(),
                    name: tok["name"].as_str().expect("name").to_string(),
                    symbol: tok["symbol"].as_str().expect("symbol").to_string(),
                    decimals: tok["decimals"].as_u64().expect("decimals") as u8,
                    total_supply: amount(&tok["totalSupply"]),
                    owner: tok
                        .get("owner")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&creator)
                        .to_string(),
                    creator,
                    mintable: tok.get("mintable").and_then(|v| v.as_bool()).unwrap_or(false),
                    paused: false,
                    // O TS fixo do gerador (`bin/eav7-vectors-eavm.js:44`).
                    created_at: 1_700_000_000_000,
                    balances,
                    ..Token::default()
                },
            );
        }
    }

    if let Some(hashes) = pre.get("blockHashes").and_then(|v| v.as_array()) {
        for par in hashes {
            let n = par[0].as_u64().expect("número do bloco");
            let h = par[1].as_str().expect("hash do bloco");
            s.record_block_hash(n, h);
        }
    }

    s
}

/// A transação CRUA do vetor, campo a campo. O gerador aplica o MESMO objeto que
/// serializa — inclusive `id`, que entra no cálculo de bandwidth.
fn tx_de(v: &Value) -> Tx {
    let mut tx = Tx::new(
        v["type"].as_str().expect("type"),
        v["from"].as_str().expect("from"),
        v["nonce"].as_i64().expect("nonce"),
        v["timestamp"].as_i64().expect("timestamp"),
    );
    tx.protocol = v["protocol"].as_str().expect("protocol").to_string();
    tx.scheme = v["scheme"].as_str().expect("scheme").to_string();
    tx.amount = v["amount"].as_str().expect("amount").to_string();
    tx.fee = v["fee"].as_str().expect("fee").to_string();
    // `to: null` e `to` ausente dão o mesmo None — nos vetores é sempre explícito.
    tx.to = v["to"].as_str().map(str::to_string);
    tx.data = v.get("data").map(de_json);
    tx.id = v["id"].as_str().map(str::to_string);
    tx
}

/// O recibo no formato EXATO do gerador (`bin/eav7-vectors-eavm.js:180-188`):
/// `contractAddr` só aparece em deploy bem-sucedido; `gasUsed` é texto decimal.
fn recibo_json(o: &EavmOutcome) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("success".into(), Value::Bool(o.success));
    m.insert("gasUsed".into(), Value::String(o.gas_used.to_string()));
    if o.is_deploy && o.success {
        m.insert("contractAddr".into(), Value::String(o.contract_addr.clone()));
    }
    m.insert(
        "logs".into(),
        Value::Array(
            o.logs
                .iter()
                .map(|lg| {
                    serde_json::json!({
                        "address": lg.address,
                        "topics": lg.topics,
                        "data": lg.data,
                    })
                })
                .collect(),
        ),
    );
    m.insert(
        "xfers".into(),
        Value::Array(
            o.xfers
                .iter()
                .map(|x| {
                    serde_json::json!({
                        "kind": x.kind,
                        "from": x.from,
                        "to": x.to,
                        "fromE7": x.from_e7,
                        "toE7": x.to_e7,
                        "amount": x.amount.to_string(),
                    })
                })
                .collect(),
        ),
    );
    Value::Object(m)
}

#[test]
fn eavm_estado_bate_com_a_referencia() {
    let corpo = carrega();

    // As constantes do vetor têm de descrever a MESMA rede que este cliente —
    // senão o teste compararia execuções de protocolos diferentes e qualquer
    // divergência apontaria para o lugar errado.
    let consts = &corpo["constants"];
    assert_eq!(consts["GAS_PER_ENERGY"].as_u64().unwrap(), eav7::config::GAS_PER_ENERGY);
    assert_eq!(consts["MAX_EAVM_GAS"].as_u64().unwrap(), eav7::config::MAX_EAVM_GAS);
    assert_eq!(consts["MAX_CONTRACT_BYTES"].as_u64().unwrap(), eav7::config::MAX_CONTRACT_BYTES);
    assert_eq!(consts["EAVM_VALUE_HEIGHT"].as_u64().unwrap(), eav7::config::EAVM_VALUE_HEIGHT);
    assert_eq!(
        consts["EAVM_CONTRACTS_HEIGHT"].as_u64().unwrap(),
        eav7::config::EAVM_CONTRACTS_HEIGHT
    );
    assert_eq!(
        consts["BURN_PER_ENERGY"].as_str().unwrap().parse::<u128>().unwrap(),
        eav7::config::energy::BURN_PER_ENERGY
    );

    let casos = corpo["cases"].as_array().expect("campo `cases`");
    let mut conferidos = 0usize;

    for caso in casos {
        let nome = caso["name"].as_str().unwrap_or("?");
        let height = caso["height"].as_u64().expect("height");
        let block_ts = caso["blockTs"].as_u64().expect("blockTs");
        let expect = &caso["expect"];
        let fees = expect["fees"].as_array().expect("fees");
        let receipts = expect["receipts"].as_array().expect("receipts");
        let erro_esperado = expect.get("error").and_then(|v| v.as_str());
        let erro_indice = expect.get("errorTxIndex").and_then(|v| v.as_u64());

        let mut s = montar(&caso["pre"]);
        let txs = caso["txs"].as_array().expect("txs");
        let mut erro_visto: Option<(usize, String)> = None;

        for (i, tx_json) in txs.iter().enumerate() {
            let tx = tx_de(tx_json);
            let burned_antes = s.total_burned;
            match s.apply_transaction(&tx, height, block_ts) {
                Ok(aplicada) => {
                    // A taxa devolvida É o delta de totalBurned — as duas coisas
                    // têm de contar a mesma história.
                    assert_eq!(
                        aplicada.fee,
                        s.total_burned - burned_antes,
                        "{nome}: tx {i} — fee devolvida difere do delta de totalBurned"
                    );
                    assert_eq!(
                        aplicada.fee.to_string(),
                        fees[i].as_str().expect("fee é texto decimal"),
                        "{nome}: tx {i} — taxa queimada divergiu"
                    );

                    let tipo = tx_json["type"].as_str().unwrap_or("");
                    if tipo == "EAVM_DEPLOY" || tipo == "EAVM_CALL" {
                        let outcome = aplicada
                            .eavm
                            .as_ref()
                            .unwrap_or_else(|| panic!("{nome}: tx {i} EAVM sem recibo"));
                        assert_eq!(
                            recibo_json(outcome),
                            receipts[i],
                            "{nome}: tx {i} — recibo divergiu campo a campo"
                        );
                    } else {
                        assert!(
                            aplicada.eavm.is_none(),
                            "{nome}: tx {i} não-EAVM_CALL/DEPLOY emitiu recibo"
                        );
                        assert!(receipts[i].is_null(), "{nome}: tx {i} — vetor esperava recibo");
                    }
                }
                Err(e) => {
                    erro_visto = Some((i, e.0));
                    break;
                }
            }
        }

        match (erro_esperado, erro_visto) {
            (Some(msg), Some((i, visto))) => {
                assert_eq!(visto, msg, "{nome}: mensagem de erro divergiu");
                assert_eq!(
                    Some(i as u64),
                    erro_indice,
                    "{nome}: a transação errada lançou (índice {i})"
                );
            }
            (Some(msg), None) => panic!("{nome}: a referência LANÇA ({msg}); este cliente aceitou"),
            (None, Some((i, visto))) => {
                panic!("{nome}: tx {i} lançou \"{visto}\" onde a referência aceita")
            }
            (None, None) => {
                assert_eq!(fees.len(), txs.len(), "{nome}: nem toda tx foi conferida");
            }
        }

        // As folhas do estado FINAL, byte a byte. No caso com `error`, são as do
        // estado INTACTO — é a prova de atomicidade (nada da VM sobrevive).
        let mut folhas = s.state_leaves().expect("estado codificável");
        folhas.sort();
        let esperadas: Vec<&str> = expect["leaves"]
            .as_array()
            .expect("leaves")
            .iter()
            .map(|v| v.as_str().expect("folha é hex"))
            .collect();
        assert_eq!(folhas, esperadas, "{nome}: folhas do stateRoot divergiram");
        assert_eq!(
            compute_state_root(&folhas),
            expect["stateRoot"].as_str().expect("stateRoot"),
            "{nome}: raiz divergiu das próprias folhas"
        );

        conferidos += 1;
    }

    // 15 casos hoje; `>=` para que o vetor possa crescer sem tocar aqui — um
    // caso novo que este cliente não reproduza falha nas asserções acima.
    assert!(conferidos >= 15, "esperava ao menos 15 casos, vi {conferidos}");
}
