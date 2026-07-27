//! Conformidade contra os vetores gerados pelo nó de referência em JavaScript.
//!
//! Este é o teste que importa. Os testes unitários de cada módulo verificam que o
//! código faz o que EU acho que deveria fazer; este verifica que faz o que a
//! REFERÊNCIA faz. Só o segundo previne cisão de rede.
//!
//! Regerar os vetores:  node bin/eav7-vectors.js

use eav7::{derive_address_from, eav_hash, eav_hash_one, is_valid_address, is_valid_hash, merkle_root};
use serde_json::Value;
use std::{fs, path::PathBuf};

fn carrega(nome: &str) -> Value {
    let caminho = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().expect("raiz do repositório")
        .join("vectors").join(nome);
    let texto = fs::read_to_string(&caminho)
        .unwrap_or_else(|e| panic!("não consegui ler {}: {e}\nrode: node bin/eav7-vectors.js", caminho.display()));
    serde_json::from_str(&texto).expect("vetor com JSON inválido")
}

fn casos(nome: &str) -> Vec<Value> {
    carrega(nome)["cases"].as_array().expect("campo `cases`").clone()
}


#[test]
fn crypto_bate_com_a_referencia() {
    let mut conferidos = 0usize;
    for caso in casos("crypto.json") {
        let kind = caso["kind"].as_str().unwrap();
        match kind {
            "eavHash" => {
                let entrada = caso["input"].as_str().unwrap();
                assert_eq!(eav_hash_one(entrada), caso["output"].as_str().unwrap(),
                    "eavHash({entrada:?})");
            }
            "eavHash.multipart" => {
                let partes: Vec<String> = caso["input"].as_array().unwrap().iter()
                    .map(|v| v.as_str().unwrap().to_string()).collect();
                let refs: Vec<&[u8]> = partes.iter().map(|p| p.as_bytes()).collect();
                assert_eq!(eav_hash(&refs), caso["output"].as_str().unwrap(),
                    "eavHash multipartes");
            }
            "merkleRoot" => {
                let ids: Vec<String> = caso["input"].as_array().unwrap().iter()
                    .map(|v| v.as_str().unwrap().to_string()).collect();
                assert_eq!(merkle_root(&ids), caso["output"].as_str().unwrap(),
                    "merkleRoot com {} folhas", ids.len());
            }
            "deriveAddressFrom" => {
                let entrada = caso["input"].as_str().unwrap();
                assert_eq!(derive_address_from(entrada), caso["output"].as_str().unwrap(),
                    "deriveAddressFrom({entrada:?})");
            }
            "isValidAddress" => {
                let entrada = caso["input"].as_str().unwrap();
                assert_eq!(is_valid_address(entrada), caso["output"].as_bool().unwrap(),
                    "isValidAddress({entrada:?})");
            }
            "isValidHash" => {
                let entrada = caso["input"].as_str().unwrap();
                assert_eq!(is_valid_hash(entrada), caso["output"].as_bool().unwrap(),
                    "isValidHash({entrada:?})");
            }
            outro => panic!("tipo de caso não coberto por este cliente: {outro}\n\
                             o vetor cresceu e o Rust ficou para trás — implemente ou remova"),
        }
        conferidos += 1;
    }
    assert!(conferidos >= 28, "esperava ao menos 28 casos, vi {conferidos}");
}

#[test]
fn meta_descreve_a_mesma_rede() {
    let m = carrega("meta.json");
    assert_eq!(m["protocol"].as_str().unwrap(), "eav20");
    assert_eq!(m["addressPrefix"].as_str().unwrap(), eav7::ADDRESS_PREFIX);
    assert_eq!(m["hashLength"].as_u64().unwrap() as usize, eav7::HASH_LEN);
    assert_eq!(m["addressLength"].as_u64().unwrap() as usize, eav7::ADDRESS_LEN);
}

/// Guarda contra o modo de falha mais provável desta migração: o vetor ganhar
/// domínios novos (estado, bloco, EVM) e o cliente Rust seguir passando porque
/// simplesmente não os lê. Falhar aqui é o lembrete de que falta portar.
#[test]
fn dominios_ainda_nao_portados_estao_declarados() {
    // Saíram desta lista, cada um quando ganhou verificação de verdade:
    //   • `state.json` → `tests/state_vectors.rs`. Era o maior arquivo de
    //     conformidade do projeto, gerado a cada verificação e lido por NINGUÉM —
    //     e nem sequer estava declarado como pendente. Ficava no disco, atualizado,
    //     parecendo cobrir;
    //   • `eavm-envelope.json` → `tests/eavm_envelope.rs`;
    //   • `evm.json` → `eavm::vm::tests::vetores_de_evm_batem_com_a_referencia`,
    //     que confere os 14 casos INCLUSIVE o gás.
    //
    // Um domínio declarado "pendente" quando já é verificado não é inofensivo:
    // treina quem lê a suíte a ignorar o aviso, que é justamente o mecanismo que
    // deveria pegar um domínio realmente não portado.
    let pendentes: [&str; 0] = [];
    for nome in pendentes {
        let n = casos(nome).len();
        assert!(n > 0, "{nome} está vazio — o gerador quebrou?");
        eprintln!("PENDENTE: {nome} tem {n} casos que este cliente ainda não verifica");
    }
}

/// A codificação canônica é a base da folha do stateRoot. Se os bytes divergirem
/// aqui, TODA raiz de estado diverge — por isso tem vetor próprio, conferido antes
/// de qualquer coisa que dependa dele.
#[test]
fn canonical_bate_com_a_referencia() {
    use eav7::{canonical_hex, Value};
    use std::collections::BTreeMap;

    // Converte o `input` do vetor (JSON) para o nosso `Value`. O campo `kind:
    // "bigint"` marca os casos em que a referência usa BigInt e o JSON transporta
    // como texto — sem isso, um inteiro grande viraria string e mudaria a folha.
    fn de_json(v: &Value_, kind: Option<&str>) -> Value {
        match v {
            Value_::Null => Value::Null,
            Value_::Bool(b) => Value::Bool(*b),
            Value_::Number(n) => Value::int_str(n.to_string()).expect("inteiro canônico"),
            Value_::String(s) if kind == Some("bigint") => {
                Value::int_str(s.clone()).expect("bigint canônico")
            }
            Value_::String(s) => Value::str(s.clone()),
            Value_::Array(itens) => Value::List(itens.iter().map(|i| de_json(i, None)).collect()),
            Value_::Object(campos) => {
                let mut m = BTreeMap::new();
                for (k, v) in campos {
                    m.insert(k.clone(), de_json(v, None));
                }
                Value::Map(m)
            }
        }
    }
    use serde_json::Value as Value_;

    let mut conferidos = 0usize;
    for caso in casos("canonical.json") {
        let kind = caso["kind"].as_str();
        let entrada = de_json(&caso["input"], kind);
        let esperado = caso["encoded"].as_str().expect("campo `encoded`");
        assert_eq!(
            canonical_hex(&entrada).unwrap(), esperado,
            "codificação divergiu para {:?}", caso["input"],
        );
        conferidos += 1;
    }
    assert!(conferidos >= 20, "esperava ao menos 20 casos, vi {conferidos}");
}

/// O payload da transação usa a OUTRA serialização canônica — JSON com chaves
/// ordenadas, não o formato binário acima. É o que já está assinado em produção,
/// então o texto tem de sair caractere a caractere igual: um espaço, uma vírgula
/// ou uma chave a mais muda o `id` e a transação vira outra.
#[test]
fn transaction_bate_com_a_referencia() {
    use eav7::{tx_id, tx_signing_payload, JsonValue, Tx};
    use std::collections::BTreeMap;

    // O `data` do vetor é JSON livre. Números só aparecem como inteiro; float não
    // existe no protocolo justamente porque sua impressão depende do runtime.
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

    let mut conferidos = 0usize;
    for caso in casos("transaction.json") {
        let kind = caso["kind"].as_str().unwrap();
        assert_eq!(kind, "canonicalPayload+id", "tipo de caso não coberto: {kind}");
        let entrada = &caso["input"];

        let mut tx = Tx::new(
            entrada["type"].as_str().expect("type"),
            entrada["from"].as_str().expect("from"),
            entrada["nonce"].as_i64().expect("nonce"),
            entrada["timestamp"].as_i64().expect("timestamp"),
        );
        tx.protocol = entrada["protocol"].as_str().expect("protocol").to_string();
        tx.scheme = entrada["scheme"].as_str().expect("scheme").to_string();
        tx.amount = entrada["amount"].as_str().expect("amount").to_string();
        tx.fee = entrada["fee"].as_str().expect("fee").to_string();
        // `to` ausente e `to: null` têm de dar o MESMO payload — em ambos o JS
        // emite `"to":null`. Já `data` ausente é diferente de `data: {}`.
        tx.to = entrada["to"].as_str().map(str::to_string);
        tx.data = entrada.get("data").map(de_json);

        assert_eq!(
            tx_signing_payload(&tx), caso["payload"].as_str().expect("campo `payload`"),
            "payload divergiu para nonce {}", tx.nonce,
        );
        assert_eq!(
            tx_id(&tx), caso["id"].as_str().expect("campo `id`"),
            "id divergiu para nonce {}", tx.nonce,
        );
        conferidos += 1;
    }
    assert!(conferidos >= 5, "esperava ao menos 5 casos, vi {conferidos}");
}

/// A raiz do estado é o que o header do bloco commita. Uma folha que saia um byte
/// diferente da referência muda a raiz e cinde a rede — este é o teste que prova que
/// não sai.
#[test]
fn stateroot_bate_com_a_referencia() {
    use eav7::{account_leaf, compute_state_root, leaf, Value};
    use serde_json::Value as Json;
    use std::collections::BTreeMap;

    fn mapa(pares: Vec<(&str, Value)>) -> Value {
        Value::Map(pares.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }
    fn vazio() -> Value {
        Value::Map(BTreeMap::new())
    }

    // Reconstrói um valor a partir da forma TIPADA do vetor: `{"int": "1000"}`,
    // `{"str": "abc"}`, `{"map": {...}}`.
    //
    // O vetor carrega a tag porque decimal em texto é ambíguo: como inteiro codifica
    // com tag 0x03, como texto com 0x04, e as duas folhas diferem. Este teste já
    // manteve uma lista de campos monetários codificada à mão — o que funcionava
    // só enquanto a conta não ganhasse um campo de texto legítimo. Com o tipo vindo
    // do vetor não há nada a adivinhar, e o gerador é a única fonte de verdade.
    fn valor_tipado(json: &Json) -> Value {
        if json.is_null() {
            return Value::Null;
        }
        let obj = json.as_object().expect("valor tipado é objeto ou null");
        assert_eq!(obj.len(), 1, "valor tipado precisa de UMA tag, veio {obj:?}");
        let (tag, v) = obj.iter().next().expect("uma tag");
        match tag.as_str() {
            "int" => Value::int_str(v.as_str().expect("int vem como texto decimal"))
                .expect("decimal em forma canônica"),
            "str" => Value::str(v.as_str().expect("str vem como texto")),
            "bool" => Value::Bool(v.as_bool().expect("bool")),
            "list" => Value::List(
                v.as_array().expect("list é array").iter().map(valor_tipado).collect(),
            ),
            "map" => {
                let mut m = BTreeMap::new();
                for (k, item) in v.as_object().expect("map é objeto") {
                    m.insert(k.clone(), valor_tipado(item));
                }
                Value::Map(m)
            }
            outro => panic!("tag de tipo desconhecida no vetor: {outro:?}"),
        }
    }

    // As folhas de um `new State()` — as seções que existem mesmo com o estado vazio.
    // Toda outra seção é mapa/lista vazia e NÃO gera folha (a referência itera sobre as
    // entradas). Espelha `stateLeaves` de src/core/stateroot.js; quando o módulo `state`
    // for portado, esta função sai daqui e vira `state.leaves()`.
    fn folhas_do_estado_vazio() -> Vec<String> {
        let bridge = mapa(vec![
            ("transfers", vazio()),
            ("lockedNative", Value::int(0)),
            ("lockedTokens", vazio()),
            ("processedInbound", vazio()),
            ("attestations", vazio()),
        ]);
        [
            ("meta", "totalMinted", Value::int(0)),
            ("meta", "totalBurned", Value::int(0)),
            ("gov", "params", vazio()),
            ("treasury", "balance", Value::int(0)),
            ("slash", "set", vazio()),
            ("unbond", "queue", Value::List(vec![])),
            ("brg", "state", bridge),
            ("brg", "relayers", vazio()),
            ("brg", "committees", vazio()),
        ]
        .into_iter()
        .map(|(d, k, v)| leaf(d, k, &v).expect("folha codificável"))
        .collect()
    }

    // As contas de amostra saem dos próprios casos `accountLeaf` do vetor: assim a raiz
    // de "três contas" é conferida contra as MESMAS contas que a referência usou, sem
    // duplicar os valores neste arquivo.
    let casos = casos("stateroot.json");
    let mut folhas_de_conta = Vec::new();
    let mut conferidos = 0usize;

    for caso in &casos {
        if caso["kind"].as_str() == Some("accountLeaf") {
            let endereco = caso["input"]["address"].as_str().unwrap();
            let conta = valor_tipado(&caso["input"]["account"]);
            let folha = account_leaf(endereco, &conta).expect("folha codificável");
            assert_eq!(folha, caso["output"].as_str().unwrap(), "accountLeaf({endereco})");
            // O vetor declara o PAPEL de cada caso. `sampleState` compõe a raiz do
            // estado de amostra; `encodingCoverage` exercita só a codificação da folha
            // (byte alto, texto longo) e não pertence a estado nenhum. Sem essa
            // distinção, montar a raiz com todas daria outro valor — e o teste teria
            // de conhecer a contagem por fora, que quebra a cada caso novo.
            match caso["role"].as_str() {
                Some("sampleState") => folhas_de_conta.push(folha),
                Some("encodingCoverage") => {}
                outro => panic!(
                    "caso accountLeaf sem papel declarado ({outro:?}) — \
                     o gerador precisa dizer se a folha entra na raiz"
                ),
            }
            conferidos += 1;
        }
    }
    assert_eq!(folhas_de_conta.len(), 3, "o estado de amostra tem 3 contas");

    let raiz_vazia = compute_state_root(&folhas_do_estado_vazio());
    let mut com_contas = folhas_do_estado_vazio();
    com_contas.extend(folhas_de_conta.iter().cloned());
    let raiz_com_contas = compute_state_root(&com_contas);

    // A ordem de inserção não pode importar: a mesma lista invertida tem de dar a
    // mesma raiz. É a propriedade que permite a dois clientes chegarem ao mesmo valor
    // partindo de caminhos de enumeração diferentes.
    let mut invertida = com_contas.clone();
    invertida.reverse();
    assert_eq!(compute_state_root(&invertida), raiz_com_contas, "ordem de inserção vazou para a raiz");

    for caso in &casos {
        let esperado = caso["output"].as_str().unwrap();
        match caso["kind"].as_str().unwrap() {
            "accountLeaf" => {} // já conferido acima
            "stateRoot" => {
                let entrada = caso["input"].as_str().unwrap();
                let obtida = match entrada {
                    "estado vazio" => &raiz_vazia,
                    "três contas" => &raiz_com_contas,
                    outro => panic!("estado de amostra não reproduzido por este cliente: {outro:?}"),
                };
                assert_eq!(obtida, esperado, "computeStateRoot({entrada:?})");
                conferidos += 1;
            }
            "stateRoot.ordemNaoImporta" => {
                assert_eq!(compute_state_root(&invertida), esperado);
                conferidos += 1;
            }
            outro => panic!("tipo de caso não coberto por este cliente: {outro}\n\
                             o vetor cresceu e o Rust ficou para trás — implemente ou remova"),
        }
    }
    assert!(conferidos >= 6, "esperava ao menos 6 casos, vi {conferidos}");

    // A prova de inclusão tem de fechar contra a raiz REAL do vetor, não só contra uma
    // raiz que este mesmo código produziu num teste sintético.
    use eav7::{merkle_path, sort_leaves, verify_state_proof};
    let mut ordenadas = com_contas.clone();
    sort_leaves(&mut ordenadas);
    for folha in &folhas_de_conta {
        let idx = ordenadas.iter().position(|f| f == folha).expect("folha está na árvore");
        let caminho = merkle_path(&ordenadas, idx);
        assert!(verify_state_proof(&raiz_com_contas, folha, &caminho),
            "prova de conta não fecha contra a raiz do vetor");
    }
}
