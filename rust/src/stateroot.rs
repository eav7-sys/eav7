//! Raiz do estado (`stateRoot`) — compromisso criptográfico sobre o ESTADO INTEIRO.
//!
//! Cada fatia do estado vira uma folha `eavHash(domínio \x1f chave \x1f valor)`, as
//! folhas são ORDENADAS (para que a raiz não dependa da ordem de iteração) e
//! reduzidas a uma raiz de Merkle. Duas réplicas com o mesmo estado produzem a mesma
//! raiz; qualquer divergência de saldo/stake/ponte/contrato muda a raiz e é detectada
//! na aplicação do bloco.
//!
//! A ENUMERAÇÃO das folhas (quais domínios existem, em que chaves) mora em
//! `state::leaves` — quem conhece as seções do estado. Este módulo fica com o que
//! é puramente criptográfico: a folha, a redução e as provas. A separação é o que
//! permite testar a árvore sem montar um estado inteiro.
//!
//! Equivalência com a referência: `vectors/stateroot.json` (e `src/core/stateroot.js`).

use crate::canonical::{self, Value};
use crate::hash::{eav_hash, merkle_root};

/// Separador de unidade (ASCII US, 0x1f) entre domínio, chave e valor.
///
/// Não é enfeite: é o que impede que `("acct", "AB")` e `("acctA", "B")` produzam a
/// mesma folha. Como `eav_hash` concatena as partes SEM separador (ver `hash.rs`), a
/// separação inequívoca tem de estar no conteúdo — e 0x1f foi escolhido porque não
/// ocorre em endereço, hash nem identificador de token.
const SEP: u8 = 0x1f;

/// Um passo do caminho de Merkle: a hash do IRMÃO e de que lado ele fica.
///
/// `right == true` significa que o nó que estamos carregando é o da ESQUERDA e,
/// portanto, o irmão entra à direita na concatenação. Inverter isto não quebra
/// nenhum teste local — só faz a prova falhar contra uma raiz real, que é o pior
/// tipo de bug. Espelha `{ hash, right }` da referência.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathStep {
    pub hash: String,
    pub right: bool,
}

/// A folha canônica de `(domínio, chave, valor)`.
///
/// Hasheia BYTES, sem string intermediária. A referência chegou a passar a forma
/// canônica por `Buffer.toString('latin1')` antes de hashear, o que fazia o Node
/// RE-CODIFICAR em UTF-8 e transformar todo byte >= 0x80 em dois. Foi corrigido lá,
/// e este módulo reproduz a versão corrigida.
///
/// Vale registrar como o erro sobreviveu: era invisível em ASCII — endereço, hash,
/// decimal, ou seja quase todo o estado — e os vetores da época não tinham nenhum
/// valor acentuado nem texto com 128 bytes ou mais. Os dois lados, errado e certo,
/// passavam em tudo. Só depois de acrescentar cobertura de byte alto o vetor
/// separou um do outro.
pub fn leaf(dominio: &str, chave: &str, valor: &Value) -> Result<String, canonical::Error> {
    let canonico = canonical::encode(valor)?;
    let mut buf = Vec::with_capacity(dominio.len() + chave.len() + 2 + canonico.len());
    buf.extend_from_slice(dominio.as_bytes());
    buf.push(SEP);
    buf.extend_from_slice(chave.as_bytes());
    buf.push(SEP);
    buf.extend_from_slice(&canonico);
    Ok(eav_hash(&[&buf]))
}

/// A folha de uma conta. Domínio `acct`, chave = endereço.
///
/// Exportada porque é o que a prova de estado (light client) precisa recompor sem ter
/// o estado inteiro: dado (endereço, conta) ele chega à mesma folha que o validador.
pub fn account_leaf(endereco: &str, conta: &Value) -> Result<String, canonical::Error> {
    leaf("acct", endereco, conta)
}

/// Ordena as folhas na MESMA ordem que a referência.
///
/// O JS faz `.sort()` sem comparador, que ordena por unidade de código UTF-16. Como
/// toda folha é hexadecimal ASCII, isso coincide com a ordem de bytes — que é o que
/// `sort()` de `String` dá em Rust. A coincidência vale para folhas, não em geral;
/// por isso a ordenação está isolada aqui, e não espalhada nas chamadas.
pub fn sort_leaves(folhas: &mut [String]) {
    folhas.sort();
}

/// Raiz de Merkle sobre as folhas, ORDENADAS antes de reduzir.
///
/// Recebe as folhas já enumeradas em vez de um estado, de propósito: a enumeração
/// (`State::state_leaves`, espelho do `stateLeaves` da referência) depende de
/// conhecer todas as seções do estado, e isso é responsabilidade de
/// `state::leaves`. A ordem em que ele empilha as folhas é irrelevante — esta
/// função ordena antes de reduzir —, o que tira dali uma fonte de divergência.
pub fn compute_state_root(folhas: &[String]) -> String {
    let mut ordenadas = folhas.to_vec();
    sort_leaves(&mut ordenadas);
    merkle_root(&ordenadas)
}

/// Caminho de Merkle da folha em `indice` até a raiz.
///
/// Espelha exatamente o pareamento de `merkle_root`, INCLUSIVE o último elemento de
/// um nível ímpar pareando consigo mesmo — se aqui e lá divergissem, a prova de uma
/// folha em posição ímpar falharia contra a sua própria raiz.
///
/// As folhas precisam já vir ordenadas (ver `sort_leaves`); `indice` é a posição da
/// folha provada NESSA lista ordenada. Índice fora da faixa devolve caminho vazio,
/// que a verificação rejeita — nunca uma prova aceita por engano.
pub fn merkle_path(folhas_ordenadas: &[String], indice: usize) -> Vec<PathStep> {
    let mut caminho = Vec::new();
    if indice >= folhas_ordenadas.len() {
        return caminho;
    }
    let mut nivel: Vec<String> = folhas_ordenadas.to_vec();
    let mut i = indice;
    while nivel.len() > 1 {
        let e_esquerda = i.is_multiple_of(2);
        let irmao = if e_esquerda {
            nivel.get(i + 1).unwrap_or(&nivel[i]) // ímpar no fim: irmão é ele mesmo
        } else {
            &nivel[i - 1]
        };
        caminho.push(PathStep { hash: irmao.clone(), right: e_esquerda });

        let mut proximo = Vec::with_capacity(nivel.len().div_ceil(2));
        for par in nivel.chunks(2) {
            let esq = &par[0];
            let dir = par.get(1).unwrap_or(esq);
            proximo.push(eav_hash(&[esq.as_bytes(), dir.as_bytes()]));
        }
        nivel = proximo;
        i >>= 1;
    }
    caminho
}

/// Recomputa a raiz a partir da folha + caminho e compara. Não precisa do estado.
///
/// Comparação por igualdade de string — as hashes são sempre minúsculas (ver
/// `hash::is_valid_hash`), então não há caso em que caixa diferente devesse bater.
pub fn verify_state_proof(raiz: &str, folha: &str, caminho: &[PathStep]) -> bool {
    let mut h = folha.to_string();
    for passo in caminho {
        h = if passo.right {
            eav_hash(&[h.as_bytes(), passo.hash.as_bytes()])
        } else {
            eav_hash(&[passo.hash.as_bytes(), h.as_bytes()])
        };
    }
    h == raiz
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::eav_hash_one;
    use std::collections::BTreeMap;

    fn folha(d: &str, k: &str, v: &Value) -> String {
        leaf(d, k, v).unwrap()
    }

    /// A folha usa os bytes canônicos EXATOS, sem string intermediária.
    ///
    /// Este teste já foi o oposto: afirmava a dupla codificação latin1→UTF-8 que a
    /// referência fazia por acidente (`Buffer.toString('latin1')` seguido de um
    /// `hasher.update(string)` que re-codifica). O acidente foi corrigido na
    /// referência e aqui; o teste ficou como marco de que o formato é bytes.
    #[test]
    fn valor_nao_ascii_usa_os_bytes_canonicos_exatos() {
        // canônico de "café" = 04 00000005 63 61 66 c3 a9  — e é isso que é hasheado
        let mut esperado = Vec::from(b"t\x1fk\x1f".as_slice());
        esperado.extend_from_slice(&[0x04, 0, 0, 0, 5, 0x63, 0x61, 0x66, 0xc3, 0xa9]);
        assert_eq!(folha("t", "k", &Value::str("café")), eav_hash_one(&esperado));

        // O modo de falhar antigo: re-codificar cada byte alto como dois.
        let mut duplicado = Vec::from(b"t\x1fk\x1f".as_slice());
        duplicado.extend_from_slice(&[0x04, 0, 0, 0, 5, 0x63, 0x61, 0x66, 0xc3, 0x83, 0xc2, 0xa9]);
        assert_ne!(folha("t", "k", &Value::str("café")), eav_hash_one(&duplicado));
    }

    #[test]
    fn separador_impede_colisao_entre_dominio_e_chave() {
        let v = Value::int(1);
        assert_ne!(folha("acct", "AB", &v), folha("acctA", "B", &v));
        assert_ne!(folha("acct", "x", &v), folha("acc", "tx", &v));
    }

    #[test]
    fn dominio_separa_secoes_de_mesma_chave() {
        let v = Value::int(7);
        assert_ne!(folha("acct", "E7AA", &v), folha("tok", "E7AA", &v));
    }

    #[test]
    fn texto_e_inteiro_de_mesma_aparencia_dao_folhas_diferentes() {
        assert_ne!(folha("m", "k", &Value::str("123")), folha("m", "k", &Value::int(123)));
    }

    #[test]
    fn raiz_nao_depende_da_ordem_de_insercao() {
        let a = folha("acct", "E7A", &Value::int(1));
        let b = folha("acct", "E7B", &Value::int(2));
        let c = folha("acct", "E7C", &Value::int(3));
        assert_eq!(
            compute_state_root(&[a.clone(), b.clone(), c.clone()]),
            compute_state_root(&[c, b, a]),
        );
    }

    #[test]
    fn estado_vazio_tem_raiz_propria() {
        assert_eq!(compute_state_root(&[]), eav_hash_one("EAV7-EMPTY-ROOT"));
    }

    /// Prova de inclusão para TODA posição e TODO tamanho até 9 — inclusive os
    /// níveis ímpares, onde o pareamento consigo mesmo poderia sair de sincronia
    /// entre `merkle_path` e `merkle_root`.
    #[test]
    fn prova_vale_para_toda_posicao_e_todo_tamanho() {
        for n in 1..=9usize {
            let mut folhas: Vec<String> =
                (0..n).map(|i| folha("acct", &format!("E7{i}"), &Value::int(i as i64))).collect();
            sort_leaves(&mut folhas);
            let raiz = merkle_root(&folhas);
            for (i, f) in folhas.iter().enumerate() {
                let caminho = merkle_path(&folhas, i);
                assert!(verify_state_proof(&raiz, f, &caminho), "n={n} i={i}");
            }
        }
    }

    #[test]
    fn prova_de_folha_que_nao_esta_na_arvore_e_rejeitada() {
        let mut folhas: Vec<String> =
            (0..5).map(|i| folha("acct", &format!("E7{i}"), &Value::int(i))).collect();
        sort_leaves(&mut folhas);
        let raiz = merkle_root(&folhas);
        let caminho = merkle_path(&folhas, 2);
        let intrusa = folha("acct", "E7X", &Value::int(999));
        assert!(!verify_state_proof(&raiz, &intrusa, &caminho));
    }

    /// Trocar o lado do irmão tem de invalidar a prova — senão `right` seria
    /// decorativo e um atacante escolheria a ordem que lhe convém.
    #[test]
    fn lado_do_irmao_importa() {
        let mut folhas: Vec<String> =
            (0..4).map(|i| folha("acct", &format!("E7{i}"), &Value::int(i))).collect();
        sort_leaves(&mut folhas);
        let raiz = merkle_root(&folhas);
        let mut caminho = merkle_path(&folhas, 0);
        assert!(verify_state_proof(&raiz, &folhas[0], &caminho));
        caminho[0].right = !caminho[0].right;
        assert!(!verify_state_proof(&raiz, &folhas[0], &caminho));
    }

    #[test]
    fn arvore_de_uma_folha_tem_caminho_vazio() {
        let f = folha("meta", "totalMinted", &Value::int(0));
        assert!(merkle_path(std::slice::from_ref(&f), 0).is_empty());
        assert!(verify_state_proof(&f, &f, &[]));
    }

    #[test]
    fn indice_fora_da_faixa_nao_produz_prova_valida() {
        let mut folhas: Vec<String> =
            (0..3).map(|i| folha("acct", &format!("E7{i}"), &Value::int(i))).collect();
        sort_leaves(&mut folhas);
        let raiz = merkle_root(&folhas);
        let caminho = merkle_path(&folhas, 99);
        assert!(caminho.is_empty());
        assert!(!verify_state_proof(&raiz, &folhas[0], &caminho));
    }

    #[test]
    fn conta_muda_a_folha_se_qualquer_campo_muda() {
        let conta = |saldo: &str| {
            let mut m = BTreeMap::new();
            m.insert("balance".to_string(), Value::int_str(saldo).unwrap());
            m.insert("nonce".to_string(), Value::int(0));
            Value::Map(m)
        };
        let a = account_leaf("E7AA", &conta("1")).unwrap();
        let b = account_leaf("E7AA", &conta("2")).unwrap();
        assert_ne!(a, b);
        assert_ne!(a, account_leaf("E7AB", &conta("1")).unwrap());
    }

    /// Custo de RECOMPUTAR a raiz do estado — o que decide se um snapshot pode
    /// ser verificado contra o consenso em vez de contra um HMAC do operador.
    ///
    /// Medição impressa, não regressão de tempo. Rode com `--release --nocapture`.
    #[test]
    fn custo_de_recomputar_a_raiz() {
        use crate::state::{Account, State};

        // Escala reduzida em debug: derivar 100 mil endereços lá custa segundos e
        // o número medido não diria nada sobre produção. Em release a lista maior
        // é a que vale — o custo é linear nas folhas e a projeção se sustenta.
        let escalas: &[usize] = if cfg!(debug_assertions) { &[1_000] } else { &[1_000, 10_000, 100_000] };
        for &n in escalas {
            let mut s = State::new();
            for i in 0..n {
                s.accounts.insert(
                    crate::address::derive_address_from(format!("conta:{i}")),
                    Account { balance: 1_000_000 + i as u128, nonce: 3, ..Default::default() },
                );
            }
            let folhas = s.state_leaves().expect("folhas");
            let t = std::time::Instant::now();
            let raiz = compute_state_root(&folhas);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            assert_eq!(raiz.len(), 64);
            println!("{n:>7} contas: {} folhas, raiz em {ms:.0} ms", folhas.len());
        }
    }

    /// Tamanho e custo de SERIALIZAR o estado — a outra metade da decisão de
    /// formato do snapshot.
    ///
    /// Compara a codificação canônica que o crate já tem (`canonical::encode`,
    /// determinística e já usada no consenso) com o JSON que a referência grava.
    #[test]
    fn custo_de_serializar_o_estado() {
        use crate::canonical::{encode, Value};
        use crate::state::{Account, State};

        let n = if cfg!(debug_assertions) { 1_000usize } else { 100_000 };
        let mut s = State::new();
        for i in 0..n {
            s.accounts.insert(
                crate::address::derive_address_from(format!("conta:{i}")),
                Account { balance: 1_000_000 + i as u128, nonce: 3, ..Default::default() },
            );
        }

        let mapa = Value::Map(
            s.accounts.iter().map(|(a, c)| (a.clone(), c.to_value())).collect(),
        );
        let t = std::time::Instant::now();
        let bytes = encode(&mapa).expect("codifica");
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        println!("{n} contas — canônico: {:.1} MB em {ms:.0} ms", bytes.len() as f64 / 1e6);
        println!("  por conta: {} bytes", bytes.len() / n);
    }
}
