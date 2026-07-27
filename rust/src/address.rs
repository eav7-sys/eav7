//! Endereço EAV7.
//!
//! Formato: `E7` + 28 hexadecimais MAIÚSCULOS do SHA3-256 + 4 de checksum.
//! Total de 34 caracteres, o mesmo comprimento do endereço da TRON.
//!
//! Note a assimetria com `hash.rs`, que é deliberada e precisa ser preservada:
//! **hash é minúscula, endereço é MAIÚSCULO**. O endereço é o que a pessoa lê,
//! digita e confere visualmente; maiúscula com prefixo o torna inconfundível
//! numa tela cheia de hashes. Um cliente que normalize os dois para a mesma caixa
//! rejeita endereços legítimos — e o vetor pega isso.
//!
//! Equivalência com a referência: `vectors/crypto.json`.

use sha3::{Digest, Sha3_256};

/// Prefixo do endereço. Pertence ao ENDEREÇO, nunca à hash.
pub const ADDRESS_PREFIX: &str = "E7";
/// Comprimento total em caracteres: 2 de prefixo + 28 de corpo + 4 de checksum.
pub const ADDRESS_LEN: usize = 34;

const BODY_LEN: usize = 28; // 14 bytes em hexadecimal
const CHECKSUM_LEN: usize = 4; // 2 bytes em hexadecimal

fn sha3(data: &[u8]) -> [u8; 32] {
    let mut h = Sha3_256::new();
    h.update(data);
    h.finalize().into()
}

/// Checksum de 4 hexadecimais sobre o CORPO do endereço.
///
/// O domínio `EAV7-ADDR:` impede que este digest colida com qualquer outro uso de
/// SHA3 no protocolo: sem ele, um corpo de endereço poderia ser confundido com a
/// pré-imagem de outra estrutura.
fn address_checksum(body: &str) -> String {
    let digest = sha3(format!("EAV7-ADDR:{body}").as_bytes());
    hex::encode_upper(&digest[..CHECKSUM_LEN / 2]) // 4 hexadecimais = 2 bytes
}

/// Deriva um endereço válido a partir de bytes arbitrários.
///
/// Usado para o endereço de carteira (a partir das duas chaves públicas do esquema
/// híbrido) e para o mapeamento determinístico de contas 0x da EAVM.
pub fn derive_address_from(data: impl AsRef<[u8]>) -> String {
    let digest = sha3(data.as_ref());
    let body = hex::encode_upper(&digest[..14]);
    let checksum = address_checksum(&body);
    format!("{ADDRESS_PREFIX}{body}{checksum}")
}

/// Valida formato, caixa e checksum.
///
/// O checksum é o que transforma erro de digitação em rejeição em vez de perda de
/// fundos: trocar um caractere quebra a verificação com probabilidade ~1−2⁻¹⁶.
pub fn is_valid_address(address: &str) -> bool {
    if address.len() != ADDRESS_LEN || !address.starts_with(ADDRESS_PREFIX) {
        return false;
    }
    let resto = &address[ADDRESS_PREFIX.len()..];
    // Hexadecimal MAIÚSCULO apenas — minúscula é outro valor, não o mesmo.
    if !resto.bytes().all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(&b)) {
        return false;
    }
    let body = &address[2..2 + BODY_LEN];
    address[2 + BODY_LEN..] == address_checksum(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endereco_derivado_tem_formato_valido() {
        for rotulo in ["alice", "bob", "carol", ""] {
            let a = derive_address_from(format!("VETOR:{rotulo}"));
            assert_eq!(a.len(), ADDRESS_LEN);
            assert!(a.starts_with("E7"));
            assert!(is_valid_address(&a), "{a} deveria ser válido");
        }
    }

    #[test]
    fn derivacao_e_deterministica() {
        assert_eq!(derive_address_from("x"), derive_address_from("x"));
        assert_ne!(derive_address_from("x"), derive_address_from("y"));
    }

    #[test]
    fn checksum_pega_erro_de_digitacao() {
        let a = derive_address_from("VETOR:alice");
        // Troca o último caractere do corpo: o checksum deixa de bater.
        let mut errado: Vec<char> = a.chars().collect();
        let pos = 2 + BODY_LEN - 1;
        errado[pos] = if errado[pos] == 'A' { 'B' } else { 'A' };
        let errado: String = errado.into_iter().collect();
        assert!(!is_valid_address(&errado), "checksum não pegou a troca");
    }

    #[test]
    fn minuscula_e_rejeitada() {
        let a = derive_address_from("VETOR:alice");
        assert!(!is_valid_address(&a.to_lowercase()));
    }

    #[test]
    fn comprimento_e_prefixo_errados_sao_rejeitados() {
        assert!(!is_valid_address(""));
        assert!(!is_valid_address(&"E7".repeat(17)));
        assert!(!is_valid_address(&format!("X7{}", "0".repeat(32))));
        let a = derive_address_from("VETOR:alice");
        assert!(!is_valid_address(&a[..33]));
    }

    #[test]
    fn checksum_tem_o_comprimento_declarado() {
        assert_eq!(address_checksum("00").len(), CHECKSUM_LEN);
    }
}
