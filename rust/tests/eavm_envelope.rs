//! Conformidade do envelope EAVM contra `vectors/eavm-envelope.json`.
//!
//! É o teste que importa: os 5 raws do vetor foram assinados pela referência em
//! JavaScript (chave fixa 0x1111…1111, raws CONGELADOS — ver `bin/eav7-vectors.js`)
//! e aqui são decodificados, classificados e embrulhados pelo porte Rust. Cada
//! campo tem de bater byte a byte — o envelope é CONSENSO: autentica as
//! transações que MetaMask/Trust Wallet assinam no formato Ethereum.
//!
//! Regerar os vetores:  node bin/eav7-vectors.js

use eav7::eavm::envelope::{
    build_eavm_envelope, decode_raw_transaction, rlp_decode, rlp_encode, verify_eavm_envelope, Rlp,
};
use eav7::transaction::{verify_transaction, JsonValue};
use serde_json::Value;
use std::{fs, path::PathBuf};

fn casos() -> Vec<Value> {
    let caminho = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("raiz do repositório")
        .join("vectors")
        .join("eavm-envelope.json");
    let texto = fs::read_to_string(&caminho).unwrap_or_else(|e| {
        panic!("não consegui ler {}: {e}\nrode: node bin/eav7-vectors.js", caminho.display())
    });
    let v: Value = serde_json::from_str(&texto).expect("vetor com JSON inválido");
    v["cases"].as_array().expect("campo `cases`").clone()
}

/// [`JsonValue`] (o JSON de consenso do crate) → `serde_json::Value`, só para
/// comparar com o vetor. A conversão é total: as duas árvores têm as mesmas
/// formas para tudo que um envelope carrega.
fn to_serde(v: &JsonValue) -> Value {
    match v {
        JsonValue::Null => Value::Null,
        JsonValue::Bool(b) => Value::Bool(*b),
        JsonValue::Int(n) => Value::from(*n),
        JsonValue::Str(s) => Value::String(s.clone()),
        JsonValue::List(itens) => Value::Array(itens.iter().map(to_serde).collect()),
        JsonValue::Map(m) => {
            Value::Object(m.iter().map(|(k, v)| (k.clone(), to_serde(v))).collect())
        }
    }
}

#[test]
fn decodificacao_bate_com_a_referencia() {
    let casos = casos();
    assert_eq!(casos.len(), 5, "o vetor congela 5 casos; gerador mudou?");
    for caso in &casos {
        let nome = caso["name"].as_str().unwrap();
        let raw = caso["raw"].as_str().unwrap();
        let esperado = &caso["parsed"];

        let parsed = decode_raw_transaction(raw)
            .unwrap_or_else(|e| panic!("[{nome}] decode falhou: {e}"));

        // `from` é RECUPERADO da assinatura — nunca informado. É a linha que
        // autentica a carteira Ethereum na EAV7.
        assert_eq!(parsed.from, caso["recoveredFrom"].as_str().unwrap(), "[{nome}] recoveredFrom");

        assert_eq!(i64::from(parsed.eavm_type), esperado["eavmType"].as_i64().unwrap(), "[{nome}] eavmType");
        assert_eq!(
            parsed.chain_id.as_ref().map(|c| c.to_string()),
            esperado["chainId"].as_str().map(String::from),
            "[{nome}] chainId"
        );
        assert_eq!(parsed.nonce as i64, esperado["nonce"].as_i64().unwrap(), "[{nome}] nonce");
        assert_eq!(parsed.gas_price.to_string(), esperado["gasPrice"].as_str().unwrap(), "[{nome}] gasPrice");
        assert_eq!(parsed.gas_limit.to_string(), esperado["gasLimit"].as_str().unwrap(), "[{nome}] gasLimit");
        assert_eq!(parsed.value.to_string(), esperado["value"].as_str().unwrap(), "[{nome}] value");
        assert_eq!(parsed.data_hex, esperado["dataHex"].as_str().unwrap(), "[{nome}] dataHex");
        assert_eq!(parsed.eavm_hash, esperado["eavmHash"].as_str().unwrap(), "[{nome}] eavmHash");
        match esperado["to"].as_str() {
            Some(to) => assert_eq!(parsed.to.as_deref(), Some(to), "[{nome}] to"),
            None => assert_eq!(parsed.to, None, "[{nome}] to nulo (deploy)"),
        }
        assert_eq!(parsed.from, esperado["from"].as_str().unwrap(), "[{nome}] from");
    }
}

#[test]
fn envelope_construido_bate_campo_a_campo() {
    for caso in casos() {
        let nome = caso["name"].as_str().unwrap();
        let raw = caso["raw"].as_str().unwrap();
        let esperado = &caso["envelope"];

        // O timestamp não entra no vetor (o gerador o omite de propósito: é o
        // único campo não determinístico do envelope).
        let tx = build_eavm_envelope(raw, 1_700_000_000_000, |_| false)
            .unwrap_or_else(|e| panic!("[{nome}] build falhou: {e}"));

        assert_eq!(tx.tx_type, esperado["type"].as_str().unwrap(), "[{nome}] type");
        assert_eq!(tx.from, esperado["from"].as_str().unwrap(), "[{nome}] from");
        match esperado["to"].as_str() {
            Some(to) => assert_eq!(tx.to.as_deref(), Some(to), "[{nome}] to"),
            None => assert_eq!(tx.to, None, "[{nome}] to nulo"),
        }
        assert_eq!(tx.amount, esperado["amount"].as_str().unwrap(), "[{nome}] amount");
        assert_eq!(tx.fee, esperado["fee"].as_str().unwrap(), "[{nome}] fee");
        assert_eq!(tx.nonce, esperado["nonce"].as_i64().unwrap(), "[{nome}] nonce");
        assert_eq!(tx.id.as_deref(), esperado["id"].as_str(), "[{nome}] id");

        // O `data` INTEIRO, como árvore: raw, op, eavmFrom, eavmTo, eavmHash,
        // eavmNonce e code/to/input conforme o tipo. Comparar a árvore fecha
        // também as chaves — uma a mais ou a menos falha.
        let data = tx.data.as_ref().expect("envelope sempre tem data");
        assert_eq!(to_serde(data), esperado["data"], "[{nome}] data");

        // E o envelope recém-construído VERIFICA — pelas duas portas: a direta e
        // a rota de `verify_transaction` (o ponto editado em `transaction.rs`).
        assert_eq!(verify_eavm_envelope(&tx), Ok(()), "[{nome}] verify");
        assert_eq!(verify_transaction(&tx), Ok(()), "[{nome}] verify_transaction");
    }
}

#[test]
fn envelope_adulterado_e_rejeitado_pela_rota_do_protocolo() {
    // Adulterações sobre TODOS os casos do vetor: cada campo trocado tem de ser
    // pego pela verificação stateless — o envelope re-deriva tudo do raw.
    for caso in casos() {
        let nome = caso["name"].as_str().unwrap();
        let raw = caso["raw"].as_str().unwrap();
        let base = build_eavm_envelope(raw, 1_700_000_000_000, |_| false).expect("constrói");

        let mut amount = base.clone();
        amount.amount = (amount.amount.parse::<u128>().unwrap() + 1).to_string();
        assert!(verify_transaction(&amount).is_err(), "[{nome}] amount inflado passou");

        let mut nonce = base.clone();
        nonce.nonce += 1;
        assert!(verify_transaction(&nonce).is_err(), "[{nome}] nonce fora do passo passou");

        let mut from = base.clone();
        from.from = "E70000000000000000000000000000FFFF".into();
        assert!(verify_transaction(&from).is_err(), "[{nome}] from trocado passou");

        let mut id = base.clone();
        id.id = Some("0".repeat(64));
        assert!(verify_transaction(&id).is_err(), "[{nome}] id forjado passou");
    }
}

/// Re-monta um raw legacy do vetor com uma mutação nos itens RLP — é assim que
/// se fabrica o negativo de MALEABILIDADE: os vetores congelados só têm casos
/// positivos, então o teste reconstrói os bytes adversariais a partir deles.
fn remonta(raw: &str, muda: impl Fn(&mut Vec<Rlp>)) -> String {
    let bytes = hex::decode(&raw[2..]).expect("raw do vetor é hex par");
    let Ok(Rlp::List(mut itens)) = rlp_decode(&bytes) else {
        panic!("raw do vetor tem de decodificar como lista");
    };
    muda(&mut itens);
    format!("0x{}", hex::encode(rlp_encode(&Rlp::List(itens))))
}

#[test]
fn zero_a_esquerda_em_r_e_rejeitado_em_todos_os_casos() {
    // O achado anti-maleabilidade (`tx.js:10-16`): padear `r` com 0x00 mantém o
    // MESMO signer mas muda o raw — logo o eavmHash e o id. `strictInt` tem de
    // rejeitar em TODOS os formatos do vetor (índice 7 = `r` na lista legacy).
    for caso in casos() {
        let nome = caso["name"].as_str().unwrap();
        let raw = caso["raw"].as_str().unwrap();
        let adulterado = remonta(raw, |itens| {
            let Rlp::Bytes(r) = &mut itens[7] else { panic!("r é bytes") };
            r.insert(0, 0x00);
        });
        let erro = decode_raw_transaction(&adulterado)
            .expect_err(&format!("[{nome}] zero à esquerda em r deveria falhar"));
        assert!(erro.contains("zero à esquerda"), "[{nome}] erro inesperado: {erro}");
        assert!(build_eavm_envelope(&adulterado, 1, |_| false).is_err(), "[{nome}] build aceitou");
    }
}

#[test]
fn chain_id_errado_e_rejeitado() {
    // v = chainId·2 + 35 + recId (EIP-155). chainId 72021 (≠ 72020 da rede) com
    // recId 0 → v = 144077 = 0x0232cd. O hash de assinatura muda junto, então a
    // recuperação pode dar outro signer ou falhar — nos dois casos a transação é
    // REJEITADA, que é o que o consenso exige.
    for caso in casos() {
        let nome = caso["name"].as_str().unwrap();
        let raw = caso["raw"].as_str().unwrap();
        let adulterado = remonta(raw, |itens| {
            itens[6] = Rlp::Bytes(vec![0x02, 0x32, 0xcd]);
        });
        assert!(
            build_eavm_envelope(&adulterado, 1, |_| false).is_err(),
            "[{nome}] chainId de outra rede deveria ser rejeitado"
        );
    }
}
