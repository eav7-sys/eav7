//! Ponte de IA do protocolo eav20 — porte de `src/ai/bridge.js` (104 linhas).
//!
//! Builders das transações que ligam a rede EAV7 a agentes de IA. Fluxo
//! on-chain (bridge.js:4-8):
//!
//!   1. `AI_TASK`         — usuário escrowa a recompensa e publica o prompt
//!   2. `ORACLE_REGISTER` — operador stakea EAV7 para atuar como oráculo de IA
//!   3. `AI_RESULT`       — oráculo entrega o output; a hash E7 do resultado
//!      fica gravada on-chain e a recompensa é liberada
//!
//! # Lógica PURA
//!
//! Tudo aqui é montagem + assinatura: recebe um [`BlockSigner`] (a
//! `ProductionWallet` de `crate::wallet` em produção) e parâmetros, devolve uma
//! [`Tx`] assinada cujo payload/`id` saem do serializador CANÔNICO da lib
//! (`tx_signing_payload`/`eav_hash_one`) — byte a byte o que `buildTransaction`
//! de `src/core/transaction.js:30-65` produz. Nenhum I/O, nenhum relógio:
//! `nonce` e `timestamp` vêm de fora (no JS `timestamp` tem default
//! `Date.now()`; aqui o TRANSPORTE fornece `now`, mantendo a lógica testável).
//!
//! # Linha de segurança da IA
//!
//! Estes builders só CONSTROEM transações que a máquina de estado valida como
//! qualquer outra — a IA não tem poder especial on-chain (propose-only,
//! ver [[eav7-ai-roadmap]] e o cabeçalho de `ai/mod.rs`).

use eav7::block::BlockSigner;
use eav7::config::energy::BURN_PER_ENERGY;
use eav7::hash::eav_hash_one;
use eav7::signature::address_from_public_keys;
use eav7::transaction::{canonical_json, tx_signing_payload, JsonValue, Tx};

// ---------------------------------------------------------------------------
// buildTransaction — o núcleo (src/core/transaction.js:30-65)
// ---------------------------------------------------------------------------

/// Limite de taxa padrão = queima máxima possível para o tipo (custo de energia
/// × `BURN_PER_ENERGY`) — transaction.js:39-42. Se a conta tiver energia, nada
/// é queimado; senão, no máximo este valor.
///
/// O custo de energia sai de `eav7::config::energy_cost`, o porte COMPLETO da
/// tabela `CHAIN.ENERGY.COST` (src/config.js:328-346), com o mesmo fallback
/// `?? 1` de transaction.js:42. Havia aqui um recorte manual da tabela só com os
/// tipos de IA; era duplicação de um número de consenso, mantida por um
/// comentário que descrevia a lib como se ela não tivesse a tabela.
pub fn default_fee_limit(tx_type: &str) -> u128 {
    eav7::config::energy_cost(tx_type) as u128 * BURN_PER_ENERGY
}

/// Parâmetros do núcleo — o objeto de opções de `buildTransaction`
/// (transaction.js:30-38). `fee: None` usa a tabela do protocolo
/// ([`default_fee_limit`]); `data` é sempre um mapa (o default `{}` do JS).
struct TxSpec {
    tx_type: &'static str,
    to: Option<String>,
    amount: u128,
    fee: Option<u128>,
    nonce: i64,
    timestamp: i64,
    data: JsonValue,
}

/// Monta e assina uma transação eav20 com o esquema híbrido pós-quântico
/// `eav7-hybrid-1` (secp256k1 + ML-DSA-44) — transaction.js:30-65:
///
///   • `from` derivado das chaves públicas do assinante (`addressFromPublicKeys`,
///     transaction.js:43 → `eav7::signature::address_from_public_keys`);
///   • payload canônico assinado pelo par híbrido (`hybridSign`, transaction.js:58);
///   • `id` = `eavHash(payload)` — derivado APENAS do payload, nunca dos bytes
///     da assinatura (anti-maleabilidade de txid, transaction.js:59-64).
fn build_transaction(signer: &dyn BlockSigner, spec: TxSpec) -> Result<Tx, String> {
    let from = address_from_public_keys(signer.public_key_pem(), signer.pq_public_key_pem())
        .map_err(|e| format!("chaves públicas do assinante inválidas: {e}"))?;
    let mut tx = Tx::new(spec.tx_type, from, spec.nonce, spec.timestamp);
    tx.to = spec.to;
    tx.amount = spec.amount.to_string();
    tx.fee = spec.fee.unwrap_or_else(|| default_fee_limit(spec.tx_type)).to_string();
    tx.data = Some(spec.data);
    tx.public_key = Some(signer.public_key_pem().to_string());
    tx.pq_public_key = Some(signer.pq_public_key_pem().to_string());

    let payload = tx_signing_payload(&tx);
    let (assinatura, assinatura_pq) =
        signer.sign(payload.as_bytes()).map_err(|e| format!("falha ao assinar transação: {e}"))?;
    tx.signature = Some(assinatura);
    tx.pq_signature = Some(assinatura_pq);
    tx.id = Some(eav_hash_one(&payload));
    Ok(tx)
}

/// Serializa a transação COMPLETA (payload + assinaturas + id) para o POST /tx.
///
/// Usa o serializador canônico da lib — chaves ordenadas, o mesmo escape do
/// `JSON.stringify` — de modo que os campos assinados saem byte a byte como o
/// payload que foi assinado. (O JS envia `JSON.stringify(tx)` em ordem de
/// inserção; a ordem das chaves não é significativa para o parser do nó.)
pub fn tx_to_json(tx: &Tx) -> String {
    let mut m = std::collections::BTreeMap::new();
    m.insert("protocol".to_string(), JsonValue::str(&tx.protocol));
    m.insert("scheme".to_string(), JsonValue::str(&tx.scheme));
    m.insert("type".to_string(), JsonValue::str(&tx.tx_type));
    m.insert("from".to_string(), JsonValue::str(&tx.from));
    m.insert(
        "to".to_string(),
        match &tx.to {
            Some(a) => JsonValue::str(a),
            None => JsonValue::Null,
        },
    );
    m.insert("amount".to_string(), JsonValue::str(&tx.amount));
    m.insert("fee".to_string(), JsonValue::str(&tx.fee));
    m.insert("nonce".to_string(), JsonValue::Int(tx.nonce));
    m.insert("timestamp".to_string(), JsonValue::Int(tx.timestamp));
    if let Some(d) = &tx.data {
        m.insert("data".to_string(), d.clone());
    }
    if let Some(k) = &tx.public_key {
        m.insert("publicKey".to_string(), JsonValue::str(k));
    }
    if let Some(k) = &tx.pq_public_key {
        m.insert("pqPublicKey".to_string(), JsonValue::str(k));
    }
    if let Some(s) = &tx.signature {
        m.insert("signature".to_string(), JsonValue::str(s));
    }
    if let Some(s) = &tx.pq_signature {
        m.insert("pqSignature".to_string(), JsonValue::str(s));
    }
    if let Some(id) = &tx.id {
        m.insert("id".to_string(), JsonValue::str(id));
    }
    canonical_json(&JsonValue::Map(m))
}

// Atalhos para montar os mapas `data` sem cerimônia.
fn s(v: &str) -> JsonValue {
    JsonValue::str(v)
}
fn opt_s(v: &Option<String>) -> JsonValue {
    match v {
        Some(t) => JsonValue::str(t),
        None => JsonValue::Null,
    }
}

// ---------------------------------------------------------------------------
// AI_TASK (bridge.js:12-21)
// ---------------------------------------------------------------------------

/// Parâmetros de [`build_ai_task_tx`] — o objeto de opções de bridge.js:15.
/// No JS os defaults são `oracle = null, quorum = null, open = false,
/// private = false, model = null, params = null`; como são `null` (e não
/// `undefined`), as chaves ENTRAM no `data` como `null` — os `Option` aqui
/// reproduzem isso via [`opt_s`].
pub struct AiTaskParams {
    pub prompt: String,
    /// Oráculo designado (Fase 1). Ignorado nos modos `quorum`/`open`.
    pub oracle: Option<String>,
    /// Quórum de N oráculos (Fase 2) — presente ⇒ modo quórum.
    pub quorum: Option<i64>,
    /// Tarefa ABERTA/leilão (Fase 4) — tem precedência sobre `quorum`/`oracle`.
    pub open: bool,
    /// Tarefa privada (Fase 5): o `prompt` deve ir cifrado (o protocolo só
    /// guarda bytes) e o resultado fica off-chain.
    pub private: bool,
    pub model: Option<String>,
    /// `params` livres do modelo; `None` vira `null` como no JS.
    pub params: Option<JsonValue>,
    /// Recompensa escrowada (o `amount` da tx).
    pub reward: u128,
    pub nonce: i64,
    pub timestamp: i64,
}

/// `buildAiTaskTx` (bridge.js:15-21): oráculo designado, quórum de N ou
/// ABERTA/leilão; `private: true` marca a tarefa como privada.
pub fn build_ai_task_tx(signer: &dyn BlockSigner, p: AiTaskParams) -> Result<Tx, String> {
    // bridge.js:16-18 — a base muda conforme o modo, na MESMA precedência:
    // open > quorum > oracle designado.
    let mut data = std::collections::BTreeMap::new();
    data.insert("prompt".to_string(), s(&p.prompt));
    data.insert(
        "model".to_string(),
        match &p.model {
            Some(m) => s(m),
            None => JsonValue::Null,
        },
    );
    data.insert("params".to_string(), p.params.clone().unwrap_or(JsonValue::Null));
    if p.open {
        data.insert("open".to_string(), JsonValue::Bool(true));
    } else if let Some(q) = p.quorum {
        data.insert("quorum".to_string(), JsonValue::Int(q));
    } else {
        data.insert("oracle".to_string(), opt_s(&p.oracle));
    }
    // bridge.js:19 — `private: true` só quando pedido (ausente no modo público).
    if p.private {
        data.insert("private".to_string(), JsonValue::Bool(true));
    }
    build_transaction(
        signer,
        TxSpec {
            tx_type: "AI_TASK",
            to: None,
            amount: p.reward,
            fee: None,
            nonce: p.nonce,
            timestamp: p.timestamp,
            data: JsonValue::Map(data),
        },
    )
}

/// Compromisso de um resultado: hash E7 do output — `aiResultHash`
/// (bridge.js:24-26), usado no modo hash-only da Fase 5.
pub fn ai_result_hash(output: &str) -> String {
    eav_hash_one(output)
}

// ---------------------------------------------------------------------------
// Fase 4 — leilão (bridge.js:28-34)
// ---------------------------------------------------------------------------

/// `buildAiBidTx` (bridge.js:29-31). `price` sai como STRING no `data`
/// (`String(price)` no JS) — valores monetários são texto no protocolo.
pub fn build_ai_bid_tx(
    signer: &dyn BlockSigner,
    task_id: &str,
    price: u128,
    nonce: i64,
    timestamp: i64,
) -> Result<Tx, String> {
    build_transaction(
        signer,
        TxSpec {
            tx_type: "AI_BID",
            to: None,
            amount: 0,
            fee: None,
            nonce,
            timestamp,
            data: JsonValue::map([
                ("taskId".to_string(), s(task_id)),
                ("price".to_string(), s(&price.to_string())),
            ]),
        },
    )
}

/// `buildAiAwardTx` (bridge.js:32-34): o solicitante premia o lance vencedor.
pub fn build_ai_award_tx(
    signer: &dyn BlockSigner,
    task_id: &str,
    oracle: &str,
    nonce: i64,
    timestamp: i64,
) -> Result<Tx, String> {
    build_transaction(
        signer,
        TxSpec {
            tx_type: "AI_AWARD",
            to: None,
            amount: 0,
            fee: None,
            nonce,
            timestamp,
            data: JsonValue::map([
                ("taskId".to_string(), s(task_id)),
                ("oracle".to_string(), s(oracle)),
            ]),
        },
    )
}

// ---------------------------------------------------------------------------
// Commit-reveal (bridge.js:36-48)
// ---------------------------------------------------------------------------

/// Compromisso de commit-reveal: `hash(output|salt)` — `aiCommitHash`
/// (bridge.js:38-40). O oráculo commita isto e só depois revela
/// `(output, salt)` — impede copiar a resposta de outro oráculo.
pub fn ai_commit_hash(output: &str, salt: &str) -> String {
    eav_hash_one(format!("{output}|{salt}"))
}

/// `buildAiCommitTx` (bridge.js:42-44).
pub fn build_ai_commit_tx(
    signer: &dyn BlockSigner,
    task_id: &str,
    commit: &str,
    nonce: i64,
    timestamp: i64,
) -> Result<Tx, String> {
    build_transaction(
        signer,
        TxSpec {
            tx_type: "AI_COMMIT",
            to: None,
            amount: 0,
            fee: None,
            nonce,
            timestamp,
            data: JsonValue::map([
                ("taskId".to_string(), s(task_id)),
                ("commit".to_string(), s(commit)),
            ]),
        },
    )
}

/// `buildAiRevealTx` (bridge.js:46-48): revela `(output, salt)` do commit.
pub fn build_ai_reveal_tx(
    signer: &dyn BlockSigner,
    task_id: &str,
    output: &str,
    salt: &str,
    nonce: i64,
    timestamp: i64,
) -> Result<Tx, String> {
    build_transaction(
        signer,
        TxSpec {
            tx_type: "AI_REVEAL",
            to: None,
            amount: 0,
            fee: None,
            nonce,
            timestamp,
            data: JsonValue::map([
                ("taskId".to_string(), s(task_id)),
                ("output".to_string(), s(output)),
                ("salt".to_string(), s(salt)),
            ]),
        },
    )
}

// ---------------------------------------------------------------------------
// Fase 3 — janela de desafio (bridge.js:50-62)
// ---------------------------------------------------------------------------

/// `buildAiClaimTx` (bridge.js:52-54): liquida uma tarefa não contestada
/// (paga o oráculo) — permissionless.
pub fn build_ai_claim_tx(
    signer: &dyn BlockSigner,
    task_id: &str,
    nonce: i64,
    timestamp: i64,
) -> Result<Tx, String> {
    build_transaction(
        signer,
        TxSpec {
            tx_type: "AI_CLAIM",
            to: None,
            amount: 0,
            fee: None,
            nonce,
            timestamp,
            data: JsonValue::map([("taskId".to_string(), s(task_id))]),
        },
    )
}

/// `buildAiChallengeTx` (bridge.js:56-58): contesta um resultado (posta a
/// fiança `AI_CHALLENGE_BOND`).
pub fn build_ai_challenge_tx(
    signer: &dyn BlockSigner,
    task_id: &str,
    nonce: i64,
    timestamp: i64,
) -> Result<Tx, String> {
    build_transaction(
        signer,
        TxSpec {
            tx_type: "AI_CHALLENGE",
            to: None,
            amount: 0,
            fee: None,
            nonce,
            timestamp,
            data: JsonValue::map([("taskId".to_string(), s(task_id))]),
        },
    )
}

/// `buildAiVerdictTx` (bridge.js:60-62): voto de oráculo-jurado numa disputa
/// (`valid = true/false`; o `!!valid` do JS vira o próprio `bool`).
pub fn build_ai_verdict_tx(
    signer: &dyn BlockSigner,
    task_id: &str,
    valid: bool,
    nonce: i64,
    timestamp: i64,
) -> Result<Tx, String> {
    build_transaction(
        signer,
        TxSpec {
            tx_type: "AI_VERDICT",
            to: None,
            amount: 0,
            fee: None,
            nonce,
            timestamp,
            data: JsonValue::map([
                ("taskId".to_string(), s(task_id)),
                ("valid".to_string(), JsonValue::Bool(valid)),
            ]),
        },
    )
}

/// `buildAiRefundTx` (bridge.js:65-72): reembolso do escrow ao solicitante
/// após o prazo da tarefa.
pub fn build_ai_refund_tx(
    signer: &dyn BlockSigner,
    task_id: &str,
    nonce: i64,
    timestamp: i64,
) -> Result<Tx, String> {
    build_transaction(
        signer,
        TxSpec {
            tx_type: "AI_REFUND",
            to: None,
            amount: 0,
            fee: None,
            nonce,
            timestamp,
            data: JsonValue::map([("taskId".to_string(), s(task_id))]),
        },
    )
}

/// `buildBridgeSettleTx` (bridge.js:75-82): confirmação on-chain de que um
/// BRIDGE_OUT foi pago na cadeia externa. `external_tx_hash: None` vira `null`
/// no `data` (o default `externalTxHash = null` do JS).
pub fn build_bridge_settle_tx(
    signer: &dyn BlockSigner,
    transfer_id: &str,
    external_tx_hash: Option<String>,
    nonce: i64,
    timestamp: i64,
) -> Result<Tx, String> {
    build_transaction(
        signer,
        TxSpec {
            tx_type: "BRIDGE_SETTLE",
            to: None,
            amount: 0,
            fee: None,
            nonce,
            timestamp,
            data: JsonValue::map([
                ("transferId".to_string(), s(transfer_id)),
                ("externalTxHash".to_string(), opt_s(&external_tx_hash)),
            ]),
        },
    )
}

/// `buildOracleRegisterTx` (bridge.js:84-92): o `stake` é o `amount`; `data`
/// leva `{ endpoint }` só quando informado (o ternário `endpoint ? {...} : {}`).
pub fn build_oracle_register_tx(
    signer: &dyn BlockSigner,
    stake: u128,
    endpoint: Option<String>,
    nonce: i64,
    timestamp: i64,
) -> Result<Tx, String> {
    let data = match &endpoint {
        Some(e) => JsonValue::map([("endpoint".to_string(), s(e))]),
        None => JsonValue::map([]),
    };
    build_transaction(
        signer,
        TxSpec {
            tx_type: "ORACLE_REGISTER",
            to: None,
            amount: stake,
            fee: None,
            nonce,
            timestamp,
            data,
        },
    )
}

// ---------------------------------------------------------------------------
// AI_RESULT (bridge.js:94-104)
// ---------------------------------------------------------------------------

/// Parâmetros de [`build_ai_result_tx`] — bridge.js:96.
pub struct AiResultParams {
    pub task_id: String,
    /// Modo padrão: `output` em plaintext on-chain. `None` vira `null` no
    /// `data` (é o default `output = null` do JS quando só `resultHash` vem).
    pub output: Option<String>,
    /// Modo hash-only da Fase 5: presente ⇒ o output real fica off-chain.
    pub result_hash: Option<String>,
    /// URI opcional do resultado off-chain — só entra no `data` quando `Some`
    /// (spread condicional de bridge.js:98).
    pub result_uri: Option<String>,
    /// Fase 6: atestação opcional (TEE/zk) — `{ attesterId, sigs:[{r,s,recId}] }`
    /// sobre o digest do resultado. Presente ⇒ o resultado liquida na hora
    /// (verificado). Passa como [`JsonValue`] livre, como o JS.
    pub attestation: Option<JsonValue>,
    pub nonce: i64,
    pub timestamp: i64,
}

/// `buildAiResultTx` (bridge.js:96-104): entrega o resultado. Modo padrão:
/// `output` plaintext; modo hash-only: `result_hash` (+ `result_uri` opcional).
pub fn build_ai_result_tx(signer: &dyn BlockSigner, p: AiResultParams) -> Result<Tx, String> {
    // bridge.js:97-99 — hash-only tem precedência sobre plaintext.
    let mut data = std::collections::BTreeMap::new();
    data.insert("taskId".to_string(), s(&p.task_id));
    if let Some(h) = &p.result_hash {
        data.insert("resultHash".to_string(), s(h));
        if let Some(uri) = &p.result_uri {
            data.insert("resultUri".to_string(), s(uri));
        }
    } else {
        data.insert("output".to_string(), opt_s(&p.output));
    }
    // bridge.js:102 — atestação Fase 6, quando presente.
    if let Some(a) = p.attestation {
        data.insert("attestation".to_string(), a);
    }
    build_transaction(
        signer,
        TxSpec {
            tx_type: "AI_RESULT",
            to: None,
            amount: 0,
            fee: None,
            nonce: p.nonce,
            timestamp: p.timestamp,
            data: JsonValue::Map(data),
        },
    )
}

// ---------------------------------------------------------------------------
// Testes: toda tx construída tem de VERIFICAR pela lib de consenso.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wallet::{ProductionWallet, FIXTURE_CARTEIRA};
    use eav7::signature::hybrid_verify;
    use eav7::transaction::{parse_json, verify_transaction};

    const NONCE: i64 = 1;
    const TS: i64 = 1_700_000_000_000;

    fn carteira() -> ProductionWallet {
        ProductionWallet::from_file(FIXTURE_CARTEIRA).expect("fixture da carteira")
    }

    /// Confere o contrato completo: (1) `verify_transaction` da lib aceita;
    /// (2) a assinatura híbrida verifica sobre o payload canônico; (3) o `from`
    /// é o endereço da carteira (anti-forja).
    fn confere(tx: &Tx, w: &ProductionWallet) {
        assert_eq!(verify_transaction(tx), Ok(()), "verify_transaction rejeitou {}", tx.tx_type);
        let payload = tx_signing_payload(tx);
        let (Some(pk), Some(pq), Some(sig), Some(pqs)) =
            (&tx.public_key, &tx.pq_public_key, &tx.signature, &tx.pq_signature)
        else {
            panic!("tx sem chaves/assinaturas");
        };
        assert!(
            hybrid_verify(pk, pq, payload.as_bytes(), sig, pqs),
            "assinatura híbrida inválida em {}",
            tx.tx_type
        );
        assert_eq!(tx.from, w.address(), "from não é o endereço da carteira");
    }

    #[test]
    fn todas_as_txs_da_ponte_verificam() {
        let w = carteira();
        let txs = vec![
            build_ai_task_tx(
                &w,
                AiTaskParams {
                    prompt: "qual o sentido da vida?".into(),
                    oracle: Some(w.address().to_string()),
                    quorum: None,
                    open: false,
                    private: false,
                    model: None,
                    params: None,
                    reward: 1_000_000,
                    nonce: NONCE,
                    timestamp: TS,
                },
            ),
            build_ai_bid_tx(&w, "t1", 500, NONCE, TS),
            build_ai_award_tx(&w, "t1", "E7F2906EAAAAAAAAAAAAAAAAAAAAAAAAAA", NONCE, TS),
            build_ai_commit_tx(&w, "t1", &ai_commit_hash("saida", "sal"), NONCE, TS),
            build_ai_reveal_tx(&w, "t1", "saida", "sal", NONCE, TS),
            build_ai_claim_tx(&w, "t1", NONCE, TS),
            build_ai_challenge_tx(&w, "t1", NONCE, TS),
            build_ai_verdict_tx(&w, "t1", true, NONCE, TS),
            build_ai_refund_tx(&w, "t1", NONCE, TS),
            build_bridge_settle_tx(&w, "tr1", None, NONCE, TS),
            build_oracle_register_tx(&w, eav7::config::MIN_ORACLE_STAKE, None, NONCE, TS),
            build_ai_result_tx(
                &w,
                AiResultParams {
                    task_id: "t1".into(),
                    output: Some("42".into()),
                    result_hash: None,
                    result_uri: None,
                    attestation: None,
                    nonce: NONCE,
                    timestamp: TS,
                },
            ),
        ];
        for tx in txs {
            let tx = tx.expect("builder falhou");
            confere(&tx, &w);
        }
    }

    #[test]
    fn ai_task_modos_espelham_o_ternario_do_js() {
        let w = carteira();
        let base = |oracle, quorum, open, privada| AiTaskParams {
            prompt: "p".into(),
            oracle,
            quorum,
            open,
            private: privada,
            model: None,
            params: None,
            reward: 0,
            nonce: NONCE,
            timestamp: TS,
        };
        // Designado (Fase 1): oracle=null ENTRA como null (default null do JS),
        // model/params idem; sem open/quorum/private.
        let tx = build_ai_task_tx(&w, base(None, None, false, false)).expect("designado");
        let p = tx_signing_payload(&tx);
        assert!(p.contains("\"oracle\":null"), "oracle null tem de aparecer: {p}");
        assert!(p.contains("\"model\":null") && p.contains("\"params\":null"));
        assert!(!p.contains("\"open\"") && !p.contains("\"quorum\"") && !p.contains("\"private\""));
        // Quórum (Fase 2): quorum presente, oracle AUSENTE (bridge.js:17).
        let tx = build_ai_task_tx(&w, base(Some("E7X".into()), Some(3), false, false)).expect("quorum");
        let p = tx_signing_payload(&tx);
        assert!(p.contains("\"quorum\":3") && !p.contains("\"oracle\""));
        // Aberta (Fase 4): open:true tem precedência sobre quorum/oracle (bridge.js:16).
        let tx = build_ai_task_tx(&w, base(Some("E7X".into()), Some(3), true, false)).expect("aberta");
        let p = tx_signing_payload(&tx);
        assert!(p.contains("\"open\":true") && !p.contains("\"quorum\"") && !p.contains("\"oracle\""));
        // Privada (Fase 5): private:true adicionado à base (bridge.js:19).
        let tx = build_ai_task_tx(&w, base(None, None, false, true)).expect("privada");
        assert!(tx_signing_payload(&tx).contains("\"private\":true"));
    }

    #[test]
    fn ai_result_hash_only_e_atestacao() {
        let w = carteira();
        // Hash-only (Fase 5): resultHash presente, output AUSENTE; resultUri só quando Some.
        let tx = build_ai_result_tx(
            &w,
            AiResultParams {
                task_id: "t1".into(),
                output: Some("ignorado no modo hash-only".into()),
                result_hash: Some(ai_result_hash("42")),
                result_uri: None,
                attestation: None,
                nonce: NONCE,
                timestamp: TS,
            },
        )
        .expect("hash-only");
        let p = tx_signing_payload(&tx);
        assert!(p.contains("\"resultHash\"") && !p.contains("\"output\"") && !p.contains("\"resultUri\""));
        // Com URI + atestação (Fase 6).
        let tx = build_ai_result_tx(
            &w,
            AiResultParams {
                task_id: "t1".into(),
                output: None,
                result_hash: Some(ai_result_hash("42")),
                result_uri: Some("ipfs://x".into()),
                attestation: Some(JsonValue::map([(
                    "attesterId".to_string(),
                    JsonValue::str("tee-1"),
                )])),
                nonce: NONCE,
                timestamp: TS,
            },
        )
        .expect("atestado");
        let p = tx_signing_payload(&tx);
        assert!(p.contains("\"resultUri\":\"ipfs://x\""));
        assert!(p.contains("\"attestation\":{\"attesterId\":\"tee-1\"}"));
        confere(&tx, &w);
    }

    #[test]
    fn fee_default_e_custo_de_energia_vezes_burn() {
        // transaction.js:39-42: default = ENERGY.COST[type] × BURN_PER_ENERGY.
        assert_eq!(default_fee_limit("AI_TASK"), 100_000); // 5 × 20000
        assert_eq!(default_fee_limit("AI_RESULT"), 0); // custo 0 ⇒ fee 0
        assert_eq!(default_fee_limit("ORACLE_REGISTER"), 40_000); // 2 × 20000
        assert_eq!(default_fee_limit("TIPO_DESCONHECIDO"), 20_000); // fallback `?? 1`
        let w = carteira();
        let tx = build_ai_result_tx(
            &w,
            AiResultParams {
                task_id: "t1".into(),
                output: Some("42".into()),
                result_hash: None,
                result_uri: None,
                attestation: None,
                nonce: NONCE,
                timestamp: TS,
            },
        )
        .expect("result");
        assert_eq!(tx.fee, "0");
        let tx = build_oracle_register_tx(&w, 500_000_000, None, NONCE, TS).expect("register");
        assert_eq!(tx.fee, "40000");
        assert_eq!(tx.amount, "500000000"); // stake vira amount (bridge.js:87)
    }

    #[test]
    fn commit_hash_e_o_hash_de_output_pipe_salt() {
        // bridge.js:38-40: eavHash(`${output}|${salt}`).
        assert_eq!(ai_commit_hash("out", "salt"), eav_hash_one("out|salt"));
        assert_ne!(ai_commit_hash("out", "salt"), ai_commit_hash("out", "outro"));
        // bridge.js:24-26.
        assert_eq!(ai_result_hash("42"), eav_hash_one("42"));
    }

    #[test]
    fn tx_serializada_faz_ida_e_volta_e_reverifica() {
        // O JSON que o worker POSTa em /tx tem de voltar pela rota de leitura da
        // lib (`tx_from_json`) idêntico — e continuar verificando.
        let w = carteira();
        let tx = build_ai_claim_tx(&w, "t1", NONCE, TS).expect("claim");
        let texto = tx_to_json(&tx);
        let v = parse_json(&texto).expect("JSON da tx tem de parsear");
        let volta = eav7::block::tx_from_json(&v).expect("tx_from_json");
        assert_eq!(volta, tx, "ida e volta alterou a transação");
        assert_eq!(verify_transaction(&volta), Ok(()));
    }

    #[test]
    fn bridge_settle_inclui_hash_externo_nulo() {
        let w = carteira();
        let tx = build_bridge_settle_tx(&w, "tr1", None, NONCE, TS).expect("settle");
        assert!(tx_signing_payload(&tx).contains("\"externalTxHash\":null"));
        let tx =
            build_bridge_settle_tx(&w, "tr1", Some("0xabc".into()), NONCE, TS).expect("settle");
        assert!(tx_signing_payload(&tx).contains("\"externalTxHash\":\"0xabc\""));
    }

    #[test]
    fn oracle_register_sem_endpoint_tem_data_vazio() {
        let w = carteira();
        let tx = build_oracle_register_tx(&w, 500_000_000, None, NONCE, TS).expect("register");
        assert!(tx_signing_payload(&tx).contains("\"data\":{}"));
        let tx = build_oracle_register_tx(&w, 500_000_000, Some("https://o.eav7.com".into()), NONCE, TS)
            .expect("register");
        assert!(tx_signing_payload(&tx).contains("\"endpoint\":\"https://o.eav7.com\""));
    }
}
