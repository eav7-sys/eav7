//! Conformidade de TRANSIÇÃO DE ESTADO contra `vectors/state.json`.
//!
//! # Por que este arquivo existe
//!
//! `vectors/state.json` é o maior arquivo de conformidade do projeto — 19 casos
//! de `applyTransaction` com a raiz do estado ANTES e DEPOIS, gerados pelo nó de
//! referência. Ele era gerado a cada `npm run verificar` e **nenhum teste do Rust
//! o lia**. Não estava nem na lista de "domínios ainda não portados": ficava no
//! disco, atualizado, e ninguém o conferia.
//!
//! O efeito prático é o pior possível numa migração: o arquivo que deveria provar
//! que os dois clientes aplicam a mesma transição existia, parecia cobrir, e não
//! cobria nada. Uma divergência de estado passaria por aqui em silêncio — que é
//! exatamente o modo de falha que os vetores foram criados para impedir.
//!
//! # O que é conferido em cada caso
//!
//! * a raiz ANTES (o `setup` monta o mesmo estado nos dois clientes);
//! * aceitar ou rejeitar — e, quando rejeita, que a raiz NÃO mudou (rejeição é
//!   no-op, a invariante que o próprio gerador afirma);
//! * a raiz DEPOIS, que é a checagem que pega qualquer divergência de efeito;
//! * a TAXA cobrada, que não aparece na raiz como número isolado e por isso
//!   merece asserção própria.
//!
//! Regerar:  use frozen vectors/ fixtures

use std::collections::BTreeMap;

use eav7::state::State;
use eav7::stateroot::compute_state_root;
use eav7::transaction::{parse_json, JsonValue};

fn vetores() -> JsonValue {
    let caminho = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("raiz do repositório")
        .join("vectors")
        .join("state.json");
    let texto = std::fs::read_to_string(&caminho).unwrap_or_else(|e| {
        panic!("não consegui ler {}: {e}\nrode: use frozen vectors/ fixtures", caminho.display())
    });
    parse_json(&texto).expect("vetor de estado é JSON válido")
}

fn campo<'a>(v: &'a JsonValue, chave: &str) -> Option<&'a JsonValue> {
    match v {
        JsonValue::Map(m) => m.get(chave),
        _ => None,
    }
}

fn texto<'a>(v: &'a JsonValue, chave: &str) -> Option<&'a str> {
    match campo(v, chave)? {
        JsonValue::Str(s) => Some(s.as_str()),
        _ => None,
    }
}

fn inteiro(v: &JsonValue, chave: &str) -> Option<i64> {
    match campo(v, chave)? {
        JsonValue::Int(n) => Some(*n),
        _ => None,
    }
}

fn quantia(v: &JsonValue, chave: &str) -> Option<u128> {
    match campo(v, chave)? {
        JsonValue::Str(s) => s.parse().ok(),
        JsonValue::Int(n) => u128::try_from(*n).ok(),
        _ => None,
    }
}

fn mapa<'a>(v: &'a JsonValue, chave: &str) -> Option<&'a BTreeMap<String, JsonValue>> {
    match campo(v, chave)? {
        JsonValue::Map(m) => Some(m),
        _ => None,
    }
}

/// Monta o estado inicial descrito pelo `setup` — o espelho de `montar()` do
/// gerador (`vectors/`).
///
/// Um campo que este montador ignore produz um estado DIFERENTE do que o gerador
/// produziu, e a `rootBefore` já não bate — a divergência aparece na primeira
/// asserção, não silenciosamente na segunda.
fn montar(setup: &JsonValue) -> State {
    let mut s = State::new();

    if let Some(contas) = mapa(setup, "accounts") {
        for (end, conf) in contas {
            let c = s.account_mut(end);
            if let Some(b) = quantia(conf, "balance") {
                c.balance = b;
            }
            if let Some(st) = quantia(conf, "staked") {
                c.staked = st;
            }
            if let Some(n) = inteiro(conf, "nonce") {
                c.nonce = u64::try_from(n).unwrap_or(0);
            }
        }
    }

    if let Some(tokens) = mapa(setup, "tokens") {
        for (id, t) in tokens {
            let criador = texto(t, "creator").unwrap_or_default().to_string();
            let mut tok = eav7::state::token::Token {
                standard: "eav20".into(),
                id: id.clone(),
                name: texto(t, "name").unwrap_or_default().to_string(),
                symbol: texto(t, "symbol").unwrap_or_default().to_string(),
                decimals: u8::try_from(inteiro(t, "decimals").unwrap_or(0)).unwrap_or(0),
                total_supply: quantia(t, "totalSupply").unwrap_or(0),
                owner: texto(t, "owner").unwrap_or(&criador).to_string(),
                creator: criador,
                mintable: matches!(campo(t, "mintable"), Some(JsonValue::Bool(true))),
                created_at: TS,
                ..Default::default()
            };
            if let Some(saldos) = mapa(t, "balances") {
                for (end, v) in saldos {
                    let n = match v {
                        JsonValue::Str(x) => x.parse().unwrap_or(0),
                        JsonValue::Int(x) => u128::try_from(*x).unwrap_or(0),
                        _ => 0,
                    };
                    tok.balances.insert(end.clone(), n);
                }
            }
            s.tokens.insert(id.clone(), tok);
        }
    }

    if let Some(oraculos) = mapa(setup, "oracles") {
        for (end, o) in oraculos {
            s.oracles.insert(
                end.clone(),
                eav7::state::ai::Oracle {
                    address: end.clone(),
                    stake: quantia(o, "stake").unwrap_or(0),
                    registered_at: TS,
                    reputation: Some(u8::try_from(inteiro(o, "reputation").unwrap_or(50)).unwrap_or(50)),
                    ..Default::default()
                },
            );
        }
    }

    if let Some(tarefas) = mapa(setup, "aiTasks") {
        for (id, t) in tarefas {
            let mut q = eav7::state::ai::Quorum {
                quorum: u64::try_from(inteiro(t, "quorum").unwrap_or(0)).unwrap_or(0),
                phase: eav7::state::ai::Fase::Commit,
                commit_deadline: u64::try_from(inteiro(t, "commitDeadline").unwrap_or(0)).unwrap_or(0),
                reveal_deadline: u64::try_from(inteiro(t, "revealDeadline").unwrap_or(0)).unwrap_or(0),
                ..Default::default()
            };
            if let Some(cs) = mapa(t, "commits") {
                for (quem, c) in cs {
                    if let JsonValue::Str(h) = c {
                        q.commits.insert(quem.clone(), h.clone());
                    }
                }
            }
            // As revelações vêm como LISTA de pares, e não como mapa, justamente
            // para que o vetor possa variar a ORDEM de chegada — que é o que os
            // dois casos de quórum comparam.
            if let Some(JsonValue::List(rs)) = campo(t, "reveals") {
                for par in rs {
                    let JsonValue::List(kv) = par else { continue };
                    let (Some(JsonValue::Str(quem)), Some(r)) = (kv.first(), kv.get(1)) else {
                        continue;
                    };
                    if let Some(h) = texto(r, "resultHash") {
                        q.reveals.insert(quem.clone(), h.to_string());
                    }
                    if let Some(o) = texto(r, "output") {
                        q.reveal_outputs.insert(quem.clone(), o.to_string());
                    }
                }
            }
            s.ai_tasks.insert(
                id.clone(),
                eav7::state::ai::Task {
                    id: id.clone(),
                    requester: texto(t, "requester").unwrap_or_default().to_string(),
                    reward: quantia(t, "reward").unwrap_or(0),
                    state: "PENDING".into(),
                    created_at: TS,
                    deadline: u64::try_from(inteiro(t, "revealDeadline").unwrap_or(0)).unwrap_or(0),
                    kind: eav7::state::ai::TaskKind::Quorum(q),
                    ..Default::default()
                },
            );
        }
    }

    s
}

const TS: u64 = 1_700_000_000_000;

fn raiz(s: &State) -> String {
    compute_state_root(&s.state_leaves().expect("estado codificável"))
}

#[test]
fn transicoes_de_estado_batem_com_a_referencia() {
    let v = vetores();
    let JsonValue::List(casos) = campo(&v, "cases").expect("campo cases") else {
        panic!("cases é uma lista");
    };
    assert!(!casos.is_empty(), "vetor de estado vazio — o gerador quebrou?");

    let mut conferidos = 0usize;
    for caso in casos {
        let nome = texto(caso, "name").unwrap_or("(sem nome)");
        let setup = campo(caso, "setup").expect("setup");
        let mut s = montar(setup);

        assert_eq!(
            raiz(&s),
            texto(caso, "rootBefore").unwrap_or_default(),
            "[{nome}] o estado inicial montado difere do da referência — \
             o montador deste teste ignorou algum campo do `setup`"
        );

        let tx_json = campo(caso, "tx").expect("tx");
        let tx = eav7::block::tx_from_json(tx_json)
            .unwrap_or_else(|e| panic!("[{nome}] tx ilegível: {e}"));
        let altura = u64::try_from(inteiro(caso, "height").unwrap_or(0)).unwrap_or(0);
        let block_ts = u64::try_from(inteiro(caso, "blockTs").unwrap_or(0)).unwrap_or(0);

        let esperado_erro = texto(caso, "error");
        match s.apply_transaction(&tx, altura, block_ts) {
            Ok(aplicada) => {
                assert!(
                    esperado_erro.is_none(),
                    "[{nome}] a referência REJEITA ({}) e este cliente aceitou",
                    esperado_erro.unwrap_or_default()
                );
                assert_eq!(
                    aplicada.fee.to_string(),
                    texto(caso, "feeCharged").unwrap_or_default(),
                    "[{nome}] taxa cobrada divergiu"
                );
            }
            Err(e) => {
                assert!(
                    esperado_erro.is_some(),
                    "[{nome}] a referência ACEITA e este cliente rejeitou: {e}"
                );
                // A invariante que o próprio gerador afirma: rejeição é no-op.
                assert_eq!(
                    raiz(&s),
                    texto(caso, "rootBefore").unwrap_or_default(),
                    "[{nome}] rejeição SUJOU o estado"
                );
            }
        }

        assert_eq!(
            raiz(&s),
            texto(caso, "rootAfter").unwrap_or_default(),
            "[{nome}] a raiz APÓS a transição divergiu da referência"
        );
        conferidos += 1;
    }
    assert_eq!(conferidos, casos.len());
}
