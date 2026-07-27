//! Conformidade do esquema `eav7-hybrid-1` contra o nó de referência.
//!
//! Todos os vetores aqui foram PRODUZIDOS pelo Node 26 (`node:crypto`, OpenSSL
//! 3.5) e auto-conferidos pela referência antes de serem gravados. O que este
//! arquivo prova não é que a implementação em Rust é "razoável" — é que ela
//! aceita exatamente o conjunto de assinaturas que o nó em JS aceita, e rejeita
//! exatamente o que ele rejeita. Qualquer divergência é cisão de rede.
//!
//! Regerar:  node rust/tests/gen-signature-vectors.mjs > rust/tests/signature-vectors.json

use eav7::signature::{HybridPublicKey, SignatureError};
use serde_json::Value;

fn vetores() -> Value {
    let texto = include_str!("signature-vectors.json");
    serde_json::from_str(texto).expect("vetor com JSON inválido")
}

fn chave(caso: &Value) -> HybridPublicKey {
    HybridPublicKey::from_pem(
        caso["publicKeyPem"].as_str().expect("publicKeyPem"),
        caso["pqPublicKeyPem"].as_str().expect("pqPublicKeyPem"),
    )
    .expect("chaves do vetor têm de decodificar")
}

fn verifica(caso: &Value) -> Result<(), SignatureError> {
    chave(caso).verify_base64(
        caso["payload"].as_str().expect("payload").as_bytes(),
        caso["signature"].as_str().expect("signature"),
        caso["pqSignature"].as_str().expect("pqSignature"),
    )
}

#[test]
fn aceita_toda_assinatura_que_a_referencia_produz() {
    let v = vetores();
    let casos = v["cases"].as_array().expect("cases");
    assert!(!casos.is_empty(), "vetor vazio não prova nada");

    for caso in casos {
        let nome = caso["nome"].as_str().unwrap_or("?");
        verifica(caso).unwrap_or_else(|e| panic!("caso {nome}: {e}"));
    }
    println!("{} casos positivos conferidos", casos.len());
}

/// O teste que justifica a normalização de `s` em `verify_ecdsa`.
///
/// O OpenSSL não normaliza `s`; o `k256` rejeita `s` alto por padrão. Se a
/// implementação parar de normalizar, ESTE teste é o que quebra — e ele existe
/// porque sem ele a falha só apareceria em produção, na primeira transação com
/// `s` alto, como um nó em Rust divergindo do resto da rede.
#[test]
fn aceita_as_duas_paridades_de_s() {
    let v = vetores();
    let casos = v["cases"].as_array().expect("cases");

    let mut altos = 0;
    let mut baixos = 0;
    for caso in casos {
        match caso["paridadeS"].as_str().expect("paridadeS") {
            "s_alto" => altos += 1,
            "s_baixo" => baixos += 1,
            outro => panic!("paridade desconhecida: {outro}"),
        }
        let nome = caso["nome"].as_str().unwrap_or("?");
        assert!(verifica(caso).is_ok(), "caso {nome} recusado");
    }

    // Sem as duas paridades o teste passaria por acaso e não provaria nada.
    assert!(altos > 0, "nenhum vetor com s alto — regere os vetores");
    assert!(baixos > 0, "nenhum vetor com s baixo — regere os vetores");
    println!("{altos} vetores com s alto, {baixos} com s baixo — todos aceitos");
}

#[test]
fn rejeita_tudo_que_a_referencia_rejeita() {
    let v = vetores();
    let negativos = v["negative"].as_array().expect("negative");
    assert!(!negativos.is_empty());

    for caso in negativos {
        let nome = caso["nome"].as_str().unwrap_or("?");
        assert!(
            verifica(caso).is_err(),
            "caso negativo {nome} foi ACEITO — a verificação está frouxa"
        );
    }
    println!("{} casos negativos rejeitados", negativos.len());
}

/// As DUAS assinaturas têm de valer. É a propriedade que define o esquema.
///
/// Trocar uma assinatura válida de OUTRA carteira no lugar da desta tem de
/// falhar mesmo com a outra metade correta — senão o esquema seria "uma das
/// duas", e a resistência pós-quântica evaporaria: bastaria quebrar a ECDSA.
#[test]
fn exige_as_duas_assinaturas_e_nao_uma() {
    let v = vetores();
    let casos = v["cases"].as_array().expect("cases");
    let a = &casos[0];
    // Um caso com carteira diferente: os vetores geram uma carteira por payload.
    let b = casos
        .iter()
        .find(|c| c["publicKeyPem"] != a["publicKeyPem"])
        .expect("preciso de duas carteiras distintas nos vetores");

    let chave_a = chave(a);
    let payload = a["payload"].as_str().unwrap().as_bytes();
    let ec_a = a["signature"].as_str().unwrap();
    let pq_a = a["pqSignature"].as_str().unwrap();
    let ec_b = b["signature"].as_str().unwrap();
    let pq_b = b["pqSignature"].as_str().unwrap();

    // Referência: as duas corretas passam.
    assert!(chave_a.verify_base64(payload, ec_a, pq_a).is_ok());

    // ECDSA correta + PQ alheia => inválido, e o erro tem de ser o do ramo PQ.
    assert_eq!(
        chave_a.verify_base64(payload, ec_a, pq_b),
        Err(SignatureError::PqNaoConfere)
    );

    // ECDSA alheia + PQ correta => inválido no ramo ECDSA.
    assert_eq!(
        chave_a.verify_base64(payload, ec_b, pq_a),
        Err(SignatureError::EcdsaNaoConfere)
    );
}

/// Um bit trocado em qualquer das assinaturas invalida a transação.
#[test]
fn um_bit_trocado_invalida() {
    use base64_min::{decode, encode};

    let v = vetores();
    let caso = &v["cases"].as_array().expect("cases")[1];
    let chave = chave(caso);
    let payload = caso["payload"].as_str().unwrap().as_bytes();
    let ec = decode(caso["signature"].as_str().unwrap());
    let pq = decode(caso["pqSignature"].as_str().unwrap());

    assert!(chave.verify(payload, &ec, &pq).is_ok());

    // Vira um bit no MEIO da assinatura PQ (não no cabeçalho, para que ela siga
    // bem formada e a falha seja criptográfica, não de decodificação).
    let mut pq_corrompida = pq.clone();
    let meio = pq_corrompida.len() / 2;
    pq_corrompida[meio] ^= 0x01;
    assert_eq!(
        chave.verify(payload, &ec, &pq_corrompida),
        Err(SignatureError::PqNaoConfere)
    );

    // O mesmo na ECDSA: vira um bit no último byte (dentro do inteiro `s`).
    let mut ec_corrompida = ec.clone();
    let ultimo = ec_corrompida.len() - 1;
    ec_corrompida[ultimo] ^= 0x01;
    assert_eq!(
        chave.verify(payload, &ec_corrompida, &pq),
        Err(SignatureError::EcdsaNaoConfere)
    );

    // Sanidade do auxiliar de base64 usado acima.
    assert_eq!(encode(&decode("TWE=")), "TWE=");
}

/// O endereço E7 derivado em Rust tem de bater com o que a referência calculou.
///
/// É o elo que amarra chave a conta: se divergir, um nó em Rust creditaria a
/// transação numa conta diferente da que o nó em JS credita.
#[test]
fn endereco_bate_com_a_referencia() {
    let v = vetores();
    for caso in v["cases"].as_array().expect("cases") {
        let esperado = caso["address"].as_str().expect("address");
        let obtido = chave(caso).address();
        assert_eq!(obtido, esperado, "endereço divergiu para {}", caso["nome"]);
        assert!(eav7::is_valid_address(&obtido));
    }
}

/// Os SPKI DER guardados têm de ser IDÊNTICOS aos que o Node exportou.
///
/// O endereço é a hash desses bytes; se `from_pem` os alterasse (ponto
/// comprimido, por exemplo), o endereço mudaria em silêncio.
#[test]
fn spki_der_preservado_byte_a_byte() {
    let v = vetores();
    for caso in v["cases"].as_array().expect("cases") {
        let chave = chave(caso);
        assert_eq!(
            hex::encode(chave.ecdsa_spki_der()),
            caso["ecSpkiDerHex"].as_str().unwrap(),
            "SPKI ECDSA alterado"
        );
        assert_eq!(
            hex::encode(chave.pq_spki_der()),
            caso["pqSpkiDerHex"].as_str().unwrap(),
            "SPKI ML-DSA alterado"
        );
    }
}

/// Uma chave ML-DSA de parâmetro errado não pode ser aceita como ML-DSA-44.
///
/// Sem a checagem de OID, uma carteira gerada com ml-dsa-65 produziria um
/// endereço E7 aparentemente válido cujas assinaturas nunca verificam — saldo
/// travado para sempre, e sem mensagem de erro que aponte a causa.
#[test]
fn rejeita_oid_de_parametro_errado() {
    let v = vetores();
    let caso = &v["cases"].as_array().unwrap()[0];
    let ec_pem = caso["publicKeyPem"].as_str().unwrap();

    // OID de ml-dsa-65 = 2.16.840.1.101.3.4.3.18 (o do 44 é ...3.17).
    let pq_der = hex::decode(caso["pqSpkiDerHex"].as_str().unwrap()).unwrap();
    let posicao = pq_der
        .windows(11)
        .position(|j| j == [0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x11])
        .expect("OID id-ml-dsa-44 no SPKI");
    let mut adulterado = pq_der.clone();
    adulterado[posicao + 10] = 0x12; // 17 -> 18

    let ec_der = hex::decode(caso["ecSpkiDerHex"].as_str().unwrap()).unwrap();
    assert_eq!(
        HybridPublicKey::from_der(&ec_der, &adulterado).unwrap_err(),
        SignatureError::ChavePqInvalida
    );
    // E a chave original, intacta, continua sendo aceita.
    assert!(HybridPublicKey::from_pem(ec_pem, caso["pqPublicKeyPem"].as_str().unwrap()).is_ok());
}

/// Assinatura PQ de tamanho errado é malformada, não "não confere".
#[test]
fn tamanho_errado_de_assinatura_pq() {
    let v = vetores();
    let caso = &v["cases"].as_array().unwrap()[0];
    let chave = chave(caso);
    let payload = caso["payload"].as_str().unwrap().as_bytes();
    let ec = base64_min::decode(caso["signature"].as_str().unwrap());
    let pq = base64_min::decode(caso["pqSignature"].as_str().unwrap());

    assert_eq!(pq.len(), eav7::signature::PQ_SIGNATURE_LEN);
    assert_eq!(
        chave.verify(payload, &ec, &pq[..pq.len() - 1]),
        Err(SignatureError::AssinaturaPqMalformada)
    );
    assert_eq!(
        chave.verify(payload, &ec, &[]),
        Err(SignatureError::AssinaturaPqMalformada)
    );
}

/// `hybrid_verify` (a fachada booleana) tem de concordar com `verify`.
#[test]
fn fachada_booleana_concorda() {
    let v = vetores();
    for caso in v["cases"].as_array().unwrap() {
        assert!(eav7::hybrid_verify(
            caso["publicKeyPem"].as_str().unwrap(),
            caso["pqPublicKeyPem"].as_str().unwrap(),
            caso["payload"].as_str().unwrap().as_bytes(),
            caso["signature"].as_str().unwrap(),
            caso["pqSignature"].as_str().unwrap(),
        ));
    }
    for caso in v["negative"].as_array().unwrap() {
        assert!(!eav7::hybrid_verify(
            caso["publicKeyPem"].as_str().unwrap(),
            caso["pqPublicKeyPem"].as_str().unwrap(),
            caso["payload"].as_str().unwrap().as_bytes(),
            caso["signature"].as_str().unwrap(),
            caso["pqSignature"].as_str().unwrap(),
        ));
    }
}

/// Base64 mínimo só para o teste — o crate não expõe o dele publicamente.
mod base64_min {
    const ALFABETO: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn decode(entrada: &str) -> Vec<u8> {
        let mut saida = Vec::new();
        let mut acc: u32 = 0;
        let mut bits = 0u32;
        for c in entrada.bytes().filter(|c| *c != b'=' && !c.is_ascii_whitespace()) {
            let v = ALFABETO.iter().position(|a| *a == c).expect("base64 válido") as u32;
            acc = (acc << 6) | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                saida.push((acc >> bits) as u8);
            }
        }
        saida
    }

    pub fn encode(dados: &[u8]) -> String {
        let mut s = String::new();
        for bloco in dados.chunks(3) {
            let mut b = [0u8; 3];
            b[..bloco.len()].copy_from_slice(bloco);
            let n = u32::from(b[0]) << 16 | u32::from(b[1]) << 8 | u32::from(b[2]);
            for i in 0..4 {
                if i <= bloco.len() {
                    s.push(ALFABETO[((n >> (18 - 6 * i)) & 0x3f) as usize] as char);
                } else {
                    s.push('=');
                }
            }
        }
        s
    }
}
