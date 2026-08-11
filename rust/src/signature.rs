//! Esquema de assinatura `eav7-hybrid-1` — verificação.
//!
//! Toda transação e bloco carrega DUAS assinaturas sobre a MESMA carga:
//!
//!   • ECDSA secp256k1 sobre SHA-256 da carga — a curva da TRON/Bitcoin;
//!   • ML-DSA-44 (FIPS 204) sobre a carga crua — pós-quântica, padronizada pelo NIST.
//!
//! As duas precisam verificar. O ganho não é somar segurança clássica: é que um
//! adversário com computador quântico quebra a secp256k1 e ainda assim não
//! consegue forjar a ML-DSA. E, no sentido inverso, se a ML-DSA (primitiva jovem,
//! reticulados) cair por criptanálise clássica, a ECDSA — trinta anos de
//! escrutínio — ainda segura a transação. Nenhuma das duas é ponto único de falha.
//!
//! Este módulo só VERIFICA. Assinar exige material secreto e pertence à carteira,
//! não ao cliente de consenso; um validador nunca precisa de chave privada de
//! usuário e não deve conseguir manipulá-la nem por acidente.
//!
//! Equivalência com a referência: `src/crypto/keys.js` (`hybridVerify`).

use k256::ecdsa::signature::Verifier as _;
use k256::ecdsa::{Signature as EcdsaSignature, VerifyingKey as EcdsaVerifyingKey};
use k256::pkcs8::DecodePublicKey;
use ml_dsa::{EncodedSignature, MlDsa44, Signature as MlDsaSignature, VerifyingKey as MlDsaVerifyingKey};

use crate::hash::eav_hash;

/// Nome do esquema, como aparece nas carteiras e no campo `scheme`.
pub const SIGNATURE_SCHEME: &str = "eav7-hybrid-1";

/// Identificador do algoritmo pós-quântico, como o Node o nomeia.
pub const PQ_ALGORITHM: &str = "ml-dsa-44";

/// Tamanho de uma assinatura ML-DSA-44 em bytes (FIPS 204, tabela 2).
pub const PQ_SIGNATURE_LEN: usize = 2420;

/// Tamanho da chave pública ML-DSA-44 crua em bytes.
pub const PQ_PUBLIC_KEY_LEN: usize = 1312;

/// Por que uma verificação falhou.
///
/// Distinguir chave malformada de assinatura inválida importa para operação: a
/// primeira é bug de cliente ou dado corrompido em disco, a segunda é uma
/// transação legitimamente rejeitada. Colapsar as duas em `false` faria um nó com
/// carteira corrompida parecer um nó sob ataque.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignatureError {
    /// A chave pública ECDSA não é um SPKI secp256k1 válido.
    ChaveEcdsaInvalida,
    /// A chave pública ML-DSA não é um SPKI `id-ml-dsa-44` válido.
    ChavePqInvalida,
    /// A assinatura ECDSA não é um DER bem formado.
    AssinaturaEcdsaMalformada,
    /// A assinatura ML-DSA não tem 2420 bytes ou não decodifica.
    AssinaturaPqMalformada,
    /// Base64 inválido em um dos campos.
    Base64Invalido,
    /// Tudo bem formado, mas a ECDSA não fecha com a chave e a carga.
    EcdsaNaoConfere,
    /// Tudo bem formado, mas a ML-DSA não fecha com a chave e a carga.
    PqNaoConfere,
}

impl core::fmt::Display for SignatureError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let t = match self {
            Self::ChaveEcdsaInvalida => "chave pública ECDSA secp256k1 inválida",
            Self::ChavePqInvalida => "chave pública ML-DSA-44 inválida",
            Self::AssinaturaEcdsaMalformada => "assinatura ECDSA malformada (DER)",
            Self::AssinaturaPqMalformada => "assinatura ML-DSA-44 malformada",
            Self::Base64Invalido => "base64 inválido",
            Self::EcdsaNaoConfere => "assinatura ECDSA não confere",
            Self::PqNaoConfere => "assinatura ML-DSA-44 não confere",
        };
        f.write_str(t)
    }
}

impl core::error::Error for SignatureError {}

/// O par de chaves públicas que identifica uma conta EAV7.
///
/// Guardamos os DER SPKI ORIGINAIS junto das chaves já decodificadas. Não é
/// redundância: o endereço E7 é o SHA3-256 dos dois SPKI CONCATENADOS, e
/// re-serializar a partir da chave decodificada não garante os mesmos bytes —
/// para a secp256k1 o ponto pode sair comprimido onde o Node emitiu
/// descomprimido, e a codificação muda a hash, portanto o endereço. Hashear os
/// bytes que realmente chegaram elimina a classe inteira de bug.
#[derive(Debug, Clone)]
pub struct HybridPublicKey {
    ecdsa: EcdsaVerifyingKey,
    pq: MlDsaVerifyingKey<MlDsa44>,
    ecdsa_spki_der: Vec<u8>,
    pq_spki_der: Vec<u8>,
}

impl HybridPublicKey {
    /// Constrói a partir dos dois PEM, no formato em que a carteira os guarda.
    ///
    /// Também aceita SPKI em **base64 cru** (sem armadura PEM) — formato compacto
    /// do fio após `COMPACT_BLOCK_HEIGHT` (plano 21 / A2).
    pub fn from_pem(ecdsa_pem: &str, pq_pem: &str) -> Result<Self, SignatureError> {
        let ecdsa_der = chave_publica_para_der(ecdsa_pem).ok_or(SignatureError::ChaveEcdsaInvalida)?;
        let pq_der = chave_publica_para_der(pq_pem).ok_or(SignatureError::ChavePqInvalida)?;
        Self::from_der(&ecdsa_der, &pq_der)
    }

    /// Codifica a chave pública para o fio: PEM legado ou SPKI-base64 compacto.
    pub fn encode_public_key_wire(pem: &str, compact: bool) -> Result<String, SignatureError> {
        if !compact {
            return Ok(pem.to_string());
        }
        let der = chave_publica_para_der(pem).ok_or(SignatureError::ChaveEcdsaInvalida)?;
        Ok(base64_encode(&der))
    }

    /// Constrói a partir dos dois SPKI em DER.
    ///
    /// O OID do algoritmo é conferido pelas próprias bibliotecas: `k256` rejeita
    /// SPKI que não seja `id-ecPublicKey` sobre secp256k1, e `ml-dsa` rejeita OID
    /// que não seja `id-ml-dsa-44` (2.16.840.1.101.3.4.3.17). Isso importa: sem a
    /// checagem, um SPKI de ML-DSA-65 seria aceito e produziria um endereço E7
    /// que nenhuma assinatura consegue satisfazer — moeda queimada em silêncio.
    pub fn from_der(ecdsa_der: &[u8], pq_der: &[u8]) -> Result<Self, SignatureError> {
        let ecdsa = EcdsaVerifyingKey::from_public_key_der(ecdsa_der)
            .map_err(|_| SignatureError::ChaveEcdsaInvalida)?;
        let pq = MlDsaVerifyingKey::<MlDsa44>::from_public_key_der(pq_der)
            .map_err(|_| SignatureError::ChavePqInvalida)?;
        Ok(Self {
            ecdsa,
            pq,
            ecdsa_spki_der: ecdsa_der.to_vec(),
            pq_spki_der: pq_der.to_vec(),
        })
    }

    /// Endereço E7 desta conta.
    ///
    /// `SHA3-256(spki_ecdsa || spki_mldsa)`, 14 bytes, hex maiúsculo, prefixo `E7`
    /// e checksum — exatamente `addressFromPublicKeys` da referência.
    pub fn address(&self) -> String {
        let mut concatenado = Vec::with_capacity(self.ecdsa_spki_der.len() + self.pq_spki_der.len());
        concatenado.extend_from_slice(&self.ecdsa_spki_der);
        concatenado.extend_from_slice(&self.pq_spki_der);
        crate::address::derive_address_from(&concatenado)
    }

    /// Verifica o par de assinaturas sobre `payload`.
    ///
    /// A ordem é deliberada: a ECDSA vai primeiro porque é ~100× mais barata que a
    /// ML-DSA-44 e, com `?`, uma assinatura ECDSA inválida rejeita a transação sem
    /// nunca pagar o custo da verificação por reticulados. Numa mempool sob
    /// inundação de lixo, isso é a diferença entre filtrar e travar.
    pub fn verify(
        &self,
        payload: &[u8],
        signature: &[u8],
        pq_signature: &[u8],
    ) -> Result<(), SignatureError> {
        self.verify_ecdsa(payload, signature)?;
        self.verify_pq(payload, pq_signature)
    }

    /// Só o ramo ECDSA. Exposto para diagnóstico; o consenso usa [`Self::verify`].
    ///
    /// # Maleabilidade e o `s` alto
    ///
    /// O Node assina via OpenSSL, que NÃO normaliza o `s` — sai alto em cerca de
    /// metade das assinaturas. O `k256` rejeita `s` alto na verificação, porque
    /// para a maior parte do mundo (Bitcoin, Ethereum pós-Homestead) `s` alto é
    /// inválido por regra de consenso.
    ///
    /// Aqui não é. A referência aceita as duas formas, então este cliente TEM de
    /// aceitar também: normalizamos antes de verificar. Se não normalizássemos,
    /// um nó em Rust rejeitaria ~50% das transações que o nó em JS aceita — cisão
    /// de rede determinística, na primeira transação com `s` alto.
    ///
    /// Não há perda de segurança nisso. Maleabilidade de assinatura só é perigosa
    /// quando o IDENTIFICADOR do objeto depende da assinatura; no eav20 o txid é
    /// a hash da carga canônica SEM as assinaturas (ver `src/core/transaction.js`),
    /// então as duas formas de `s` produzem o mesmo txid e não há o que duplicar.
    ///
    /// Endurecer isso para exigir `s` baixo é uma mudança de REGRA DE CONSENSO —
    /// precisa de fork coordenado por altura, não de um ajuste aqui.
    pub fn verify_ecdsa(&self, payload: &[u8], signature: &[u8]) -> Result<(), SignatureError> {
        let assinatura = EcdsaSignature::from_der(signature)
            .map_err(|_| SignatureError::AssinaturaEcdsaMalformada)?;
        // `normalize_s` devolve a forma de `s` baixo; se já era baixo, é identidade.
        let normalizada = assinatura.normalize_s();
        // `verify` aplica SHA-256 à carga — o mesmo `sign('sha256', ...)` do Node.
        self.ecdsa
            .verify(payload, &normalizada)
            .map_err(|_| SignatureError::EcdsaNaoConfere)
    }

    /// Só o ramo pós-quântico. Exposto para diagnóstico; o consenso usa [`Self::verify`].
    ///
    /// O Node chama `sign(null, dados, chave)`, que no OpenSSL 3.5 é a ML-DSA
    /// PURA com string de contexto VAZIA — não a HashML-DSA (variante pré-hash).
    /// São esquemas diferentes e incompatíveis: a pré-hash embute o OID do digest
    /// na mensagem antes de assinar. O `Verifier` do `ml-dsa` também é a variante
    /// pura com contexto vazio, então os dois casam; se um dia a carteira passar a
    /// usar contexto, é aqui que `verify_with_context` entra.
    pub fn verify_pq(&self, payload: &[u8], pq_signature: &[u8]) -> Result<(), SignatureError> {
        let codificada = EncodedSignature::<MlDsa44>::try_from(pq_signature)
            .map_err(|_| SignatureError::AssinaturaPqMalformada)?;
        let assinatura = MlDsaSignature::<MlDsa44>::decode(&codificada)
            .ok_or(SignatureError::AssinaturaPqMalformada)?;
        // `verify` do ml-dsa é ML-DSA pura, contexto vazio — igual ao OpenSSL.
        ml_dsa::signature::Verifier::verify(&self.pq, payload, &assinatura)
            .map_err(|_| SignatureError::PqNaoConfere)
    }

    /// Verifica com as assinaturas em base64, como trafegam no JSON do protocolo.
    pub fn verify_base64(
        &self,
        payload: &[u8],
        signature_b64: &str,
        pq_signature_b64: &str,
    ) -> Result<(), SignatureError> {
        let ec = base64_decode(signature_b64).ok_or(SignatureError::Base64Invalido)?;
        let pq = base64_decode(pq_signature_b64).ok_or(SignatureError::Base64Invalido)?;
        self.verify(payload, &ec, &pq)
    }

    /// SPKI DER da chave ECDSA, como recebido.
    pub fn ecdsa_spki_der(&self) -> &[u8] {
        &self.ecdsa_spki_der
    }

    /// SPKI DER da chave ML-DSA-44, como recebido.
    pub fn pq_spki_der(&self) -> &[u8] {
        &self.pq_spki_der
    }
}

/// Verificação híbrida em uma chamada, a partir dos PEM.
///
/// Devolve `bool` porque é a forma que o chamador de consenso quer: uma transação
/// é válida ou não é, e o MOTIVO da invalidez não pode influenciar a decisão sob
/// pena de dois clientes discordarem. Quem precisa do motivo usa
/// [`HybridPublicKey::verify`] diretamente.
pub fn hybrid_verify(
    ecdsa_public_key_pem: &str,
    pq_public_key_pem: &str,
    payload: &[u8],
    signature_b64: &str,
    pq_signature_b64: &str,
) -> bool {
    HybridPublicKey::from_pem(ecdsa_public_key_pem, pq_public_key_pem)
        .and_then(|chave| chave.verify_base64(payload, signature_b64, pq_signature_b64))
        .is_ok()
}

/// Endereço E7 a partir dos dois PEM — equivalente a `addressFromPublicKeys`.
pub fn address_from_public_keys(
    ecdsa_public_key_pem: &str,
    pq_public_key_pem: &str,
) -> Result<String, SignatureError> {
    Ok(HybridPublicKey::from_pem(ecdsa_public_key_pem, pq_public_key_pem)?.address())
}

// ---------------------------------------------------------------------------
// Codificações auxiliares
//
// PEM e base64 estão aqui em vez de virarem dependência porque são dez linhas de
// transformação de texto sem segredo envolvido — não é criptografia, e a política
// deste crate reserva dependência para onde errar é catastrófico.
// ---------------------------------------------------------------------------

/// Extrai o DER de um PEM `-----BEGIN PUBLIC KEY-----` **ou** de SPKI em base64.
///
/// Exige o rótulo `PUBLIC KEY` no caso PEM: aceitar qualquer rótulo deixaria
/// passar uma `PRIVATE KEY` colada por engano no campo errado, e o erro só
/// apareceria na verificação — longe demais da causa.
fn chave_publica_para_der(s: &str) -> Option<Vec<u8>> {
    let t = s.trim();
    if t.contains("BEGIN PUBLIC KEY") {
        return pem_para_der(t);
    }
    // Compacto: só alfabeto base64 (sem hífens de PEM).
    if t.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
        && t.len() >= 32
    {
        return base64_decode(t);
    }
    None
}

fn pem_para_der(pem: &str) -> Option<Vec<u8>> {
    let inicio = pem.find("-----BEGIN PUBLIC KEY-----")?;
    let corpo_inicio = inicio + "-----BEGIN PUBLIC KEY-----".len();
    let fim = pem[corpo_inicio..].find("-----END PUBLIC KEY-----")? + corpo_inicio;
    let base64: String = pem[corpo_inicio..fim]
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();
    base64_decode(&base64)
}

/// Decodifica base64 padrão (RFC 4648), com ou sem `=` de preenchimento.
///
/// Rejeita caractere fora do alfabeto em vez de ignorá-lo. Ignorar criaria
/// múltiplas codificações do mesmo valor — e um campo de assinatura com duas
/// grafias válidas é exatamente o tipo de folga que vira maleabilidade.
/// Decodifica base64 EXATAMENTE como `Buffer.from(s, 'base64')` do Node.
///
/// # Por que LENIENTE, e por que isso é o seguro
///
/// A versão anterior era estrita: rejeitava caractere fora do alfabeto, `=` no
/// meio, comprimento `% 4 == 1` e bits residuais não-zero. Parecia o lado seguro
/// — e era uma CISÃO DE REDE de custo zero.
///
/// O payload assinado (`tx_signing_payload`) EXCLUI as assinaturas, então o `id`
/// da transação não muda quando se acrescenta um `!` à assinatura. Qualquer um
/// pegava uma transação legítima da rede, sujava a assinatura e a republicava:
/// mesmo `id` (a dedup do mempool não distingue), o nó de referência aceitava
/// (decodifica ignorando o lixo, a assinatura confere), e TODO nó Rust rejeitava
/// o bloco que a contivesse. Cadeia parada, sem stake e sem privilégio nenhum.
///
/// Em consenso, ser mais estrito que a referência não é ser mais seguro: é
/// divergir. A segurança vem da VERIFICAÇÃO da assinatura, não do parser — bytes
/// decodificados iguais verificam igual, e uma assinatura inválida continua
/// inválida por mais limpa que seja a sua grafia.
///
/// Comportamento reproduzido, verificado caso a caso contra o Node:
/// - caractere fora do alfabeto é IGNORADO (whitespace, `!`, acento…);
/// - `=` TERMINA a decodificação (o que vem depois é descartado);
/// - `-` e `_` valem como `+` e `/` (base64url);
/// - bits residuais são descartados sem erro, e um caractere sozinho no fim
///   também — `"SGVsb"` decodifica para 3 bytes, não é erro.
fn base64_decode(entrada: &str) -> Option<Vec<u8>> {
    fn valor(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            // `+`/`/` do base64 clássico e `-`/`_` do base64url: o Node aceita os
            // quatro na mesma chamada.
            b'+' | b'-' => Some(62),
            b'/' | b'_' => Some(63),
            _ => None,
        }
    }
    let mut saida = Vec::with_capacity(entrada.len() * 3 / 4);
    let mut acumulador: u32 = 0;
    let mut bits = 0u32;
    for &c in entrada.as_bytes() {
        if c == b'=' {
            break; // o padding encerra — o resto da cadeia é ignorado
        }
        let Some(v) = valor(c) else { continue }; // fora do alfabeto: ignora
        acumulador = (acumulador << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            saida.push((acumulador >> bits) as u8);
        }
    }
    // Bits residuais NÃO são erro (o Node os descarta) — devolver `None` aqui era
    // metade da cisão descrita acima.
    Some(saida)
}

/// Base64 padrão (RFC 4648) com padding — inverso de [`base64_decode`] para o fio.
fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(T[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(T[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Hash de conveniência sobre a carga assinada, para logs e índices.
///
/// Não entra na verificação — a ECDSA hashea com SHA-256 e a ML-DSA consome a
/// carga crua. Está aqui só para quem precisa referenciar a carga por um
/// identificador estável do protocolo.
pub fn payload_digest(payload: &[u8]) -> String {
    eav_hash(&[payload])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PARIDADE com `Buffer.from(s, 'base64')` do Node — não "o lado seguro".
    ///
    /// Este teste fixava a rejeição estrita como comportamento desejado, e com
    /// isso CODIFICAVA uma cisão de rede: o payload assinado exclui as
    /// assinaturas, então sujar a assinatura de uma transação legítima não muda o
    /// `id`; a referência aceitava e todo nó Rust rejeitava o bloco. Os valores
    /// abaixo foram conferidos um a um contra o Node.
    #[test]
    fn base64_reproduz_a_leniencia_do_node() {
        // Casos limpos: iguais nos dois.
        assert_eq!(base64_decode("AAAA"), Some(vec![0, 0, 0]));
        assert_eq!(base64_decode("TWE="), Some(vec![b'M', b'a']));
        assert_eq!(base64_decode("TWE"), Some(vec![b'M', b'a']));

        // Caractere fora do alfabeto é IGNORADO, não fatal.
        assert_eq!(base64_decode("TWE=!"), Some(vec![b'M', b'a']));
        assert_eq!(base64_decode("T W\nE"), Some(vec![b'M', b'a']));
        assert_eq!(base64_decode("!!!!"), Some(vec![]));

        // `=` TERMINA a decodificação; o resto é descartado.
        assert_eq!(base64_decode("A=AA"), Some(vec![]));
        assert_eq!(base64_decode("TWE=bG8="), Some(vec![b'M', b'a']));

        // Um caractere sozinho no fim não forma byte — descartado, não erro.
        assert_eq!(base64_decode("A"), Some(vec![]));

        // Bits residuais não-zero são DESCARTADOS (o Node não rejeita).
        assert_eq!(base64_decode("TWH"), Some(vec![b'M', b'a']));

        // base64url: `-` e `_` valem como `+` e `/`.
        assert_eq!(base64_decode("-_8="), Some(vec![0xfb, 0xff]));
        assert_eq!(base64_decode("+/8="), Some(vec![0xfb, 0xff]));
    }

    /// A consequência que a leniência existe para evitar: uma assinatura SUJA
    /// continua verificando, como na rede.
    ///
    /// É o cenário de cisão: pegar uma transação legítima, acrescentar um
    /// caractere à assinatura e republicar. O `id` não muda (o payload assinado
    /// exclui as assinaturas), a referência aceita — e o cliente tem de aceitar
    /// também, senão para na primeira ocorrência.
    #[test]
    fn assinatura_com_lixo_no_base64_continua_valida() {
        use crate::block::teste_util::Carteira;
        use crate::block::BlockSigner;

        let carteira = Carteira::nova(3);
        let payload = b"carga qualquer";
        let (sig, pqsig) = carteira.sign(payload).expect("assina");

        let limpa = hybrid_verify(
            carteira.public_key_pem(),
            carteira.pq_public_key_pem(),
            payload,
            &sig,
            &pqsig,
        );
        assert!(limpa, "a assinatura limpa tem de valer");

        // A MESMA assinatura com um caractere fora do alfabeto no fim.
        let suja = hybrid_verify(
            carteira.public_key_pem(),
            carteira.pq_public_key_pem(),
            payload,
            &format!("{sig}!"),
            &pqsig,
        );
        assert!(suja, "assinatura com lixo no base64 tem de continuar valendo");

        // E uma assinatura de OUTRA carteira continua inválida, limpa ou suja —
        // a leniência é do PARSER, não da verificação.
        let outra = Carteira::nova(4);
        let (sig_alheia, _) = outra.sign(payload).expect("assina");
        assert!(
            !hybrid_verify(
                carteira.public_key_pem(),
                carteira.pq_public_key_pem(),
                payload,
                &sig_alheia,
                &pqsig,
            ),
            "assinatura de outra chave continua inválida"
        );
    }

    #[test]
    fn pem_exige_rotulo_de_chave_publica() {
        assert!(pem_para_der("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----").is_none());
        assert!(pem_para_der("nada aqui").is_none());
        assert_eq!(
            pem_para_der("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n"),
            Some(vec![0, 0, 0])
        );
    }

    #[test]
    fn chave_malformada_da_erro_especifico() {
        let erro = HybridPublicKey::from_pem("lixo", "lixo").unwrap_err();
        assert_eq!(erro, SignatureError::ChaveEcdsaInvalida);
    }

    #[test]
    fn constantes_batem_com_fips204() {
        assert_eq!(PQ_SIGNATURE_LEN, 2420);
        assert_eq!(PQ_PUBLIC_KEY_LEN, 1312);
        assert_eq!(SIGNATURE_SCHEME, "eav7-hybrid-1");
        assert_eq!(PQ_ALGORITHM, "ml-dsa-44");
    }
}
