//! Carteira de PRODUÇÃO do nó — o lado que ASSINA do `eav7-hybrid-1`.
//!
//! Porte do PAPEL da carteira de `src/crypto/keys.js`: o arquivo JSON que
//! `generateKeyPair` (keys.js:24-33) produz e que `saveWallet`/`loadWallet` de
//! `bin/eav7.js:115-132` persistem em disco com `mode 0o600`. Os campos que
//! importam (loadWallet exige exatamente estes quatro):
//!
//!   • `privateKeyPem`   — PKCS#8 PEM da chave ECDSA secp256k1;
//!   • `publicKeyPem`    — SPKI PEM correspondente;
//!   • `pqPrivateKeyPem` — PKCS#8 PEM da chave ML-DSA-44 (FIPS 204);
//!   • `pqPublicKeyPem`  — SPKI PEM correspondente.
//!
//! `saveWallet` também grava `address`; quando presente, é CONFERIDO contra o
//! endereço derivado — divergência significa arquivo remendado à mão, e produzir
//! blocos como um endereço que o operador não espera é pior que recusar o boot.
//!
//! # Por que a lib `eav7` não faz isso
//!
//! A lib de consenso só VERIFICA (ver o cabeçalho de `rust/src/signature.rs`):
//! um validador nunca precisa de chave privada de usuário. ASSINAR pertence ao
//! nó, e por isso este módulo vive no crate de nó. O padrão-ouro de COMO assinar
//! é o `impl BlockSigner for Carteira` de `rust/src/block.rs` (teste_util,
//! ~linha 796): ECDSA em DER + ML-DSA-44 crua, ambas em base64 — exatamente o
//! par que `hybridSign` (keys.js:66-72) produz. Esta struct reproduz aquele
//! impl, com a única diferença de as chaves virem do arquivo do operador.
//!
//! # Formato PKCS#8 do ML-DSA emitido pelo Node
//!
//! O Node (OpenSSL 3.5+) exporta a privada ML-DSA na forma "seed" da RFC 9881:
//! o OCTET STRING `privateKey` do PKCS#8 contém `[0] IMPLICIT OCTET STRING`
//! com a SEMENTE de 32 bytes (`80 20 <32 bytes>` em DER — conferido byte a byte
//! contra uma carteira real gerada pelo Node v26). É exatamente o que o
//! `ml-dsa` 0.1.1 do RustCrypto parseia (`TryFrom<PrivateKeyInfoRef>` em
//! `pkcs8.rs` do crate, que faz `decode_implicit` da tag 0 e `from_seed`), então
//! NENHUM parser DER artesanal é necessário aqui.
//!
//! JSON do arquivo é lido com `serde_json`: é arquivo LOCAL do operador, nunca
//! consenso — a fronteira de política do `Cargo.toml` deste crate permanece.

use eav7::block::{BlockError, BlockSigner};
use eav7::signature::HybridPublicKey;
use k256::pkcs8::DecodePrivateKey;
use ml_dsa::MlDsa44;

/// Carteira de produção carregada do arquivo do operador (`--wallet`).
///
/// Guarda os PEM PÚBLICOS EXATAMENTE como estão no arquivo, sem re-serializar:
/// o endereço E7 é o SHA3-256 dos dois SPKI DER CONCATENADOS, e re-emitir o SPKI
/// a partir da chave decodificada não garante os mesmos bytes (o ponto EC pode
/// sair comprimido onde o Node emitiu descomprimido) — mesma razão pela qual
/// `HybridPublicKey` da lib retém os DER originais.
pub struct ProductionWallet {
    ec: k256::ecdsa::SigningKey,
    pq: ml_dsa::SigningKey<MlDsa44>,
    public_key_pem: String,
    pq_public_key_pem: String,
    address: String,
}

/// `Debug` MANUAL, e não derivado, de propósito: o derive imprimiria os campos
/// das chaves PRIVADAS, e um `{:?}` num log de erro vazaria material secreto.
/// Só o endereço identifica a carteira sem revelar nada.
impl std::fmt::Debug for ProductionWallet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProductionWallet").field("address", &self.address).finish_non_exhaustive()
    }
}

impl ProductionWallet {
    /// Carrega a carteira do JSON gravado por `saveWallet` (bin/eav7.js:122).
    ///
    /// Além de parsear, PROVA que o material confere: assina uma carga-sonda com
    /// as privadas e verifica com as PÚBLICAS DO ARQUIVO pelo caminho de
    /// verificação da lib (`HybridPublicKey::verify` — o mesmo que
    /// `verify_transaction`/`verify_block_integrity` usam). Um arquivo com par
    /// trocado (privada de uma carteira, pública de outra) produziria blocos que
    /// a rede inteira rejeita; melhor morrer no boot com mensagem clara.
    pub fn from_file(path: impl AsRef<std::path::Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let cru = std::fs::read_to_string(path)
            .map_err(|e| format!("não foi possível ler a carteira {}: {e}", path.display()))?;
        let json: serde_json::Value = serde_json::from_str(&cru)
            .map_err(|e| format!("carteira {} não é JSON válido: {e}", path.display()))?;

        // Os MESMOS quatro campos que `loadWallet` (bin/eav7.js:116) exige.
        let campo = |nome: &str| -> Result<&str, String> {
            json.get(nome).and_then(|v| v.as_str()).ok_or_else(|| {
                format!(
                    "arquivo de carteira inválido ou sem chaves pós-quânticas (eav7-hybrid-1): falta `{nome}`"
                )
            })
        };
        let ec_priv_pem = campo("privateKeyPem")?;
        let public_key_pem = campo("publicKeyPem")?.to_string();
        let pq_priv_pem = campo("pqPrivateKeyPem")?;
        let pq_public_key_pem = campo("pqPublicKeyPem")?.to_string();

        // --- privada ECDSA secp256k1 (PKCS#8) -------------------------------
        let ec_der = pem_privada_para_der(ec_priv_pem)
            .ok_or("privateKeyPem não é um PEM `PRIVATE KEY` (PKCS#8) válido")?;
        // `k256` confere o OID da curva dentro do PKCS#8: um PKCS#8 de outra
        // curva (P-256, por exemplo) é rejeitado aqui, não na primeira assinatura.
        let ec = k256::ecdsa::SigningKey::from_pkcs8_der(&ec_der)
            .map_err(|e| format!("chave privada ECDSA secp256k1 inválida: {e}"))?;

        // --- privada ML-DSA-44 (PKCS#8, forma "seed" da RFC 9881) -----------
        let pq_der = pem_privada_para_der(pq_priv_pem)
            .ok_or("pqPrivateKeyPem não é um PEM `PRIVATE KEY` (PKCS#8) válido")?;
        // O `ml-dsa` confere o OID `id-ml-dsa-44` (2.16.840.1.101.3.4.3.17) e lê
        // a semente `[0] IMPLICIT OCTET STRING` — o formato exato do Node (ver o
        // cabeçalho do módulo). Se um dia o arquivo vier na forma "expandedKey"
        // ou "both" da RFC 9881, isto falha ruidosamente em vez de adivinhar.
        let pq = ml_dsa::SigningKey::<MlDsa44>::from_pkcs8_der(&pq_der)
            .map_err(|e| format!("chave privada ML-DSA-44 inválida (esperada a forma seed da RFC 9881): {e}"))?;

        // --- públicas: parse + endereço pelo caminho canônico da lib --------
        let publica = HybridPublicKey::from_pem(&public_key_pem, &pq_public_key_pem)
            .map_err(|e| format!("chaves públicas da carteira inválidas: {e}"))?;
        let address = publica.address();

        // --- prova privada↔pública ------------------------------------------
        // Assina uma sonda e verifica com as públicas DO ARQUIVO. É o mesmo par
        // (DER ECDSA, ML-DSA crua) que `sign` abaixo emite em base64.
        const SONDA: &[u8] = b"eav7-carteira-prova-de-carga";
        let ass_ec: k256::ecdsa::Signature = k256::ecdsa::signature::Signer::sign(&ec, SONDA);
        let ass_pq: ml_dsa::Signature<MlDsa44> = ml_dsa::signature::Signer::sign(&pq, SONDA);
        publica
            .verify(SONDA, ass_ec.to_der().as_bytes(), ass_pq.encode().as_slice())
            .map_err(|e| {
                format!("chaves privadas não correspondem às públicas do arquivo ({e}) — carteira corrompida ou remendada")
            })?;

        // --- `address` gravado por saveWallet, quando presente --------------
        if let Some(gravado) = json.get("address").and_then(|v| v.as_str())
            && gravado != address
        {
            return Err(format!(
                "endereço gravado na carteira ({gravado}) não confere com o derivado das chaves ({address})"
            ));
        }

        Ok(Self { ec, pq, public_key_pem, pq_public_key_pem, address })
    }

    /// Endereço E7 desta carteira — derivado via
    /// `eav7::signature::address_from_public_keys` (equivalente a
    /// `walletAddress` de keys.js:54), computado uma vez no carregamento.
    pub fn address(&self) -> &str {
        &self.address
    }
}

/// IDÊNTICO ao `impl BlockSigner for Carteira` de `rust/src/block.rs` (o
/// padrão-ouro citado no cabeçalho): ECDSA sobre SHA-256 da carga em DER,
/// ML-DSA-44 pura (contexto vazio) crua, ambas base64 — o par de `hybridSign`
/// (keys.js:66-72). O `Signer` do `k256` hashea com SHA-256 por padrão, que é o
/// `sign('sha256', ...)` do Node; o do `ml-dsa` é a ML-DSA PURA com contexto
/// vazio, que é o `sign(null, ...)` do Node no OpenSSL 3.5.
impl BlockSigner for ProductionWallet {
    fn public_key_pem(&self) -> &str {
        &self.public_key_pem
    }
    fn pq_public_key_pem(&self) -> &str {
        &self.pq_public_key_pem
    }
    fn sign(&self, payload: &[u8]) -> Result<(String, String), BlockError> {
        let ec: k256::ecdsa::Signature = k256::ecdsa::signature::Signer::sign(&self.ec, payload);
        let pq: ml_dsa::Signature<MlDsa44> = ml_dsa::signature::Signer::sign(&self.pq, payload);
        Ok((b64_encode(ec.to_der().as_bytes()), b64_encode(pq.encode().as_slice())))
    }
}

// ---------------------------------------------------------------------------
// Codificações auxiliares — mesma política de `rust/src/signature.rs`: dez
// linhas de transformação de texto em vez de uma dependência. (As da lib são
// privadas de propósito; duplicá-las aqui mantém a fronteira entre crates.)
// ---------------------------------------------------------------------------

/// Base64 padrão (RFC 4648) com preenchimento — como `teste_util::b64` da lib.
fn b64_encode(dados: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::new();
    for pedaco in dados.chunks(3) {
        let b0 = pedaco[0] as u32;
        let b1 = *pedaco.get(1).unwrap_or(&0) as u32;
        let b2 = *pedaco.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        s.push(A[(n >> 18) as usize & 63] as char);
        s.push(A[(n >> 12) as usize & 63] as char);
        s.push(if pedaco.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if pedaco.len() > 2 { A[n as usize & 63] as char } else { '=' });
    }
    s
}

/// Decodifica base64 padrão. Rejeita caractere fora do alfabeto — uma chave
/// privada com lixo dentro deve falhar aqui, perto da causa.
fn b64_decode(entrada: &str) -> Option<Vec<u8>> {
    fn valor(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let dados = entrada.trim_end_matches('=').as_bytes();
    if dados.len() % 4 == 1 {
        return None;
    }
    let mut saida = Vec::with_capacity(dados.len() * 3 / 4);
    let mut acumulador: u32 = 0;
    let mut bits = 0u32;
    for &c in dados {
        acumulador = (acumulador << 6) | valor(c)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            saida.push((acumulador >> bits) as u8);
        }
    }
    Some(saida)
}

/// Extrai o DER de um PEM `-----BEGIN PRIVATE KEY-----` (PKCS#8).
///
/// Exige ESTE rótulo: é o único que o Node emite (`export({type: 'pkcs8'})`,
/// keys.js:29-31). Um `EC PRIVATE KEY` (SEC1) ou `ENCRYPTED PRIVATE KEY` no
/// campo indicaria arquivo de outra origem — melhor recusar com o erro perto da
/// causa do que falhar no parse DER com mensagem opaca.
fn pem_privada_para_der(pem: &str) -> Option<Vec<u8>> {
    let inicio = pem.find("-----BEGIN PRIVATE KEY-----")?;
    let corpo_inicio = inicio + "-----BEGIN PRIVATE KEY-----".len();
    let fim = pem[corpo_inicio..].find("-----END PRIVATE KEY-----")? + corpo_inicio;
    let base64: String =
        pem[corpo_inicio..fim].chars().filter(|c| !c.is_ascii_whitespace()).collect();
    b64_decode(&base64)
}

/// Fixture COMMITÁVEL: carteira real gerada pelo nó de referência (Node v26,
/// OpenSSL 3.5) — chaves descartáveis, existem só para o teste de
/// compatibilidade. Para regenerar:
///
/// ```sh
/// node -e 'import("/Users/jonathancardinalle/Blockchain/src/crypto/keys.js")
///   .then(async (k)=>{const w=k.generateKeyPair();w.address=k.walletAddress(w);
///   console.log(JSON.stringify(w))})' > tests/fixtures/carteira-node.json
/// ```
#[cfg(test)]
pub(crate) const FIXTURE_CARTEIRA: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/carteira-node.json");

#[cfg(test)]
mod tests {
    use super::*;
    use eav7::signature::hybrid_verify;

    /// Caminho da referência JS neste ambiente de desenvolvimento. Se o repo ou
    /// o binário `node` não estiverem disponíveis, o teste cai no fixture — que
    /// FOI gerado por este mesmo comando (ver `FIXTURE_CARTEIRA`).
    const KEYS_JS: &str = "/Users/jonathancardinalle/Blockchain/src/crypto/keys.js";

    /// Tenta gerar uma carteira NOVA com o Node real; senão, devolve o fixture.
    /// Retorna (json da carteira, veio_do_node).
    fn carteira_json() -> (String, bool) {
        if std::path::Path::new(KEYS_JS).exists() {
            let script = format!(
                "import({KEYS_JS:?}).then(async (k)=>{{const w=k.generateKeyPair();w.address=k.walletAddress(w);console.log(JSON.stringify(w))}})"
            );
            if let Ok(saida) = std::process::Command::new("node").arg("-e").arg(&script).output()
                && saida.status.success()
            {
                let texto = String::from_utf8_lossy(&saida.stdout).trim().to_string();
                if texto.starts_with('{') {
                    return (texto, true);
                }
            }
        }
        (std::fs::read_to_string(FIXTURE_CARTEIRA).expect("fixture da carteira"), false)
    }

    fn arquivo_temporario(conteudo: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "eav7-carteira-teste-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::write(&p, conteudo).expect("escrever carteira temporária");
        p
    }

    /// PROVA DE COMPATIBILIDADE com a referência: uma carteira gerada pelo
    /// PRÓPRIO Node (`generateKeyPair` de keys.js) é carregada, assina um
    /// payload, e a assinatura é aceita pelo caminho de verificação da lib de
    /// consenso (`hybrid_verify` — o mesmo de `verify_transaction`/
    /// `verify_block_integrity`), usando as chaves públicas COMO ESTÃO no JSON.
    /// O endereço derivado também tem de bater com o `address` que
    /// `walletAddress` (keys.js:54) calculou do lado JS.
    #[test]
    fn prova_de_compatibilidade_com_carteira_do_node() {
        let (json_texto, veio_do_node) = carteira_json();
        println!("carteira {}", if veio_do_node { "gerada pelo node agora" } else { "do fixture" });
        let arquivo = arquivo_temporario(&json_texto);
        let carteira = ProductionWallet::from_file(&arquivo).expect("carregar carteira do Node");
        let json: serde_json::Value = serde_json::from_str(&json_texto).expect("json");

        // Endereço: Rust e JS têm de derivar o MESMO E7 das mesmas chaves.
        assert_eq!(
            carteira.address(),
            json["address"].as_str().expect("address no json"),
            "endereço derivado divergiu do walletAddress do JS"
        );

        // Assina com as privadas do arquivo e verifica pelo caminho de consenso.
        let payload = b"bloco de prova: payload arbitrario \xc3\xa9 aceito";
        let (ass, ass_pq) = carteira.sign(payload).expect("assinar");
        assert!(
            hybrid_verify(
                json["publicKeyPem"].as_str().expect("publicKeyPem"),
                json["pqPublicKeyPem"].as_str().expect("pqPublicKeyPem"),
                payload,
                &ass,
                &ass_pq,
            ),
            "a verificação híbrida da lib rejeitou a assinatura da carteira de produção"
        );

        // Assinatura NÃO pode verificar para outro payload (sanidade do teste).
        assert!(!hybrid_verify(
            json["publicKeyPem"].as_str().expect("publicKeyPem"),
            json["pqPublicKeyPem"].as_str().expect("pqPublicKeyPem"),
            b"outro payload",
            &ass,
            &ass_pq,
        ));

        let _ = std::fs::remove_file(&arquivo);
    }

    #[test]
    fn fixture_commitado_sempre_carrega() {
        // Independente de o `node` existir no PATH, o fixture tem de funcionar —
        // é ele que segura o teste em CI sem Node instalado.
        let carteira = ProductionWallet::from_file(FIXTURE_CARTEIRA).expect("fixture");
        assert!(carteira.address().starts_with("E7"));
    }

    #[test]
    fn pem_invalido_da_erro_limpo() {
        // PEM com lixo: o erro tem de ser um `Err` descritivo, nunca pânico.
        let arquivo = arquivo_temporario(
            r#"{"privateKeyPem":"-----BEGIN PRIVATE KEY-----\nlixo!!!\n-----END PRIVATE KEY-----",
                "publicKeyPem":"x","pqPrivateKeyPem":"y","pqPublicKeyPem":"z"}"#,
        );
        let erro = ProductionWallet::from_file(&arquivo).expect_err("tem de falhar");
        assert!(erro.contains("privateKeyPem"), "erro pouco descritivo: {erro}");
        let _ = std::fs::remove_file(&arquivo);
    }

    #[test]
    fn campo_ausente_da_erro_do_loadwallet() {
        // Sem os 4 campos, a mensagem espelha a do `loadWallet` do JS.
        let arquivo = arquivo_temporario(r#"{"privateKeyPem":"a"}"#);
        let erro = ProductionWallet::from_file(&arquivo).expect_err("tem de falhar");
        assert!(erro.contains("eav7-hybrid-1"), "mensagem inesperada: {erro}");
        let _ = std::fs::remove_file(&arquivo);
    }

    #[test]
    fn endereco_remendado_e_recusado() {
        // `address` trocado à mão: produzir como outro endereço seria pior que
        // recusar o boot.
        let (json_texto, _) = carteira_json();
        let mut json: serde_json::Value = serde_json::from_str(&json_texto).expect("json");
        json["address"] = serde_json::json!("E7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        let arquivo = arquivo_temporario(&json.to_string());
        let erro = ProductionWallet::from_file(&arquivo).expect_err("tem de falhar");
        assert!(erro.contains("não confere"), "mensagem inesperada: {erro}");
        let _ = std::fs::remove_file(&arquivo);
    }
}
