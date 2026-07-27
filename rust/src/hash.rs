//! Hash do protocolo eav20.
//!
//! SHA3-256 COMPLETA, 64 hex minúsculos, sem prefixo — o mesmo formato de txid da
//! TRON e do Bitcoin. O prefixo `E7` pertence ao ENDEREÇO (ver `address.rs`), não
//! à hash: marcar hash custava 8 bits do digest para rotular um dado que ninguém
//! digita nem precisa atribuir a uma cadeia.
//!
//! Equivalência com a referência: `vectors/crypto.json`.

use sha3::{Digest, Sha3_256};

/// Comprimento de uma hash em caracteres hexadecimais.
pub const HASH_LEN: usize = 64;

/// Hash canônica de uma ou mais partes, concatenadas NA ORDEM e SEM separador.
///
/// A ausência de separador é parte do formato: `eav_hash(&["ab", "c"])` e
/// `eav_hash(&["a", "bc"])` produzem a mesma saída, e a referência em JS faz o
/// mesmo. Quem precisa de separação inequívoca a codifica no conteúdo — é o que
/// os domínios de `stateroot` fazem com `domínio:chave:valor`.
pub fn eav_hash(parts: &[&[u8]]) -> String {
    let mut hasher = Sha3_256::new();
    for part in parts {
        hasher.update(part);
    }
    hex::encode(hasher.finalize())
}

/// Atalho para o caso de uma parte só, que é a esmagadora maioria das chamadas.
pub fn eav_hash_one(data: impl AsRef<[u8]>) -> String {
    eav_hash(&[data.as_ref()])
}

/// Raiz de Merkle sobre uma lista de hashes já em hexadecimal.
///
/// Duas propriedades que a referência define e que um cliente PRECISA reproduzir:
///
/// 1. Lista vazia tem raiz própria (`eav_hash("EAV7-EMPTY-ROOT")`), não zero.
///    Zero seria indistinguível de uma raiz legítima que por acaso desse zero.
/// 2. Nível com quantidade ÍMPAR pareia o último elemento CONSIGO MESMO. É uma
///    escolha (Bitcoin faz igual) e não a única possível — por isso está fixada
///    em vetor: um cliente que promova o ímpar sem parear produz outra raiz.
///
/// O par é concatenado como TEXTO hexadecimal, não como bytes — a referência faz
/// `eavHash(esquerda + direita)` sobre strings. Reimplementar sobre bytes daria
/// uma raiz diferente e passaria despercebido sem o vetor.
pub fn merkle_root(ids: &[String]) -> String {
    if ids.is_empty() {
        return eav_hash_one("EAV7-EMPTY-ROOT");
    }
    let mut level: Vec<String> = ids.to_vec();
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        for pair in level.chunks(2) {
            let left = &pair[0];
            let right = pair.get(1).unwrap_or(left); // ímpar: pareia consigo mesmo
            next.push(eav_hash(&[left.as_bytes(), right.as_bytes()]));
        }
        level = next;
    }
    level.remove(0)
}

/// Uma hash é válida se — e só se — for 64 hexadecimais MINÚSCULOS.
///
/// Maiúscula é rejeitada de propósito: aceitar as duas formas criaria duas
/// representações do mesmo valor, e valores que se comparam por igualdade de
/// string (chave de índice, dedup de mempool) passariam a divergir por caixa.
pub fn is_valid_hash(value: &str) -> bool {
    value.len() == HASH_LEN && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_de_vazio_nao_e_vazio() {
        let h = eav_hash_one("");
        assert_eq!(h.len(), HASH_LEN);
        assert!(is_valid_hash(&h));
    }

    #[test]
    fn partes_concatenam_sem_separador() {
        assert_eq!(eav_hash(&[b"ab", b"c"]), eav_hash(&[b"a", b"bc"]));
        assert_eq!(eav_hash(&[b"abc"]), eav_hash(&[b"ab", b"c"]));
    }

    #[test]
    fn raiz_vazia_tem_valor_proprio() {
        assert_eq!(merkle_root(&[]), eav_hash_one("EAV7-EMPTY-ROOT"));
        assert_ne!(merkle_root(&[]), "0".repeat(HASH_LEN));
    }

    #[test]
    fn nivel_impar_pareia_o_ultimo_consigo_mesmo() {
        let a = eav_hash_one("a");
        let b = eav_hash_one("b");
        let c = eav_hash_one("c");
        // [a,b,c] -> [H(a|b), H(c|c)] -> H( H(a|b) | H(c|c) )
        let esperado = eav_hash(&[
            eav_hash(&[a.as_bytes(), b.as_bytes()]).as_bytes(),
            eav_hash(&[c.as_bytes(), c.as_bytes()]).as_bytes(),
        ]);
        assert_eq!(merkle_root(&[a, b, c]), esperado);
    }

    #[test]
    fn validacao_rejeita_maiuscula_e_comprimento_errado() {
        let h = eav_hash_one("x");
        assert!(is_valid_hash(&h));
        assert!(!is_valid_hash(&h.to_uppercase()));
        assert!(!is_valid_hash(&h[..63]));
        assert!(!is_valid_hash(&format!("E7{}", &h[..62])));
        assert!(!is_valid_hash(""));
    }
}
