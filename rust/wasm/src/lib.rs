//! A EAV7 no navegador — a MESMA implementação que o nó usa para validar.
//!
//! # O problema que isto resolve
//!
//! A criptografia da carteira estava reimplementada três vezes do lado cliente:
//! `public/eav7-wallet.js`, `web/src/lib/eav7-wallet.js` (byte a byte idêntica à
//! primeira) e `web-next/src/lib/wallet-crypto.ts` (re-porte manual em
//! TypeScript). Cada uma com o próprio keccak, secp256k1, RLP e derivação de
//! endereço E7 com checksum.
//!
//! Três implementações de uma regra de consenso significam que mudar a derivação
//! de endereço são três edições em duas linguagens — e que uma divergência gera um
//! endereço que a rede não reconhece, com o usuário achando que mandou para o
//! lugar certo. É o mesmo tipo de duplicação que esta migração vem eliminando em
//! todo lugar; no navegador ela só é mais fácil de ignorar.
//!
//! # O que este módulo expõe
//!
//! Só o que a carteira do navegador precisa. Não é uma tradução da lib inteira:
//! superfície de API é dívida, e o que não for usado aqui é código que ninguém
//! confere.

use wasm_bindgen::prelude::*;

/// Preço de gás padrão da rede, em wei — o mesmo default de `createSignedTx`
/// (`eavm/tx.js:106`).
const GAS_PRICE_PADRAO: u128 = 476_190_476_190;

/// Uma conta EAVM: a chave privada e as duas formas do endereço.
#[wasm_bindgen]
pub struct Conta {
    private_key: String,
    eavm: String,
    e7: String,
}

#[wasm_bindgen]
impl Conta {
    /// Chave privada em hex `0x…`. Sai daqui uma vez; guardá-la é problema de
    /// quem chama.
    #[wasm_bindgen(getter, js_name = privateKey)]
    pub fn private_key(&self) -> String {
        self.private_key.clone()
    }

    /// Endereço EAVM (`0x…`) — a forma que MetaMask e Trust Wallet mostram.
    #[wasm_bindgen(getter)]
    pub fn eavm(&self) -> String {
        self.eavm.clone()
    }

    /// Endereço E7 correspondente — o que a rede usa nativamente.
    #[wasm_bindgen(getter)]
    pub fn e7(&self) -> String {
        self.e7.clone()
    }
}

// A CAMADA `wasm_bindgen` É FINA DE PROPÓSITO.
//
// Toda a lógica vive em funções que devolvem `Result<_, String>` e compilam em
// qualquer alvo; as funções exportadas só traduzem o erro para `JsError`. O
// motivo é prático: `JsError` entra em pânico fora do WASM, então lógica
// misturada com ele só poderia ser testada dentro de um navegador — e teste que
// exige navegador é teste que não roda.

/// Cria uma conta nova, com entropia do navegador.
#[wasm_bindgen(js_name = criarConta)]
pub fn criar_conta() -> Result<Conta, JsError> {
    nova_conta().map_err(|e| JsError::new(&e))
}

/// Recupera a conta a partir de uma chave privada em hex.
#[wasm_bindgen(js_name = contaDeChavePrivada)]
pub fn conta_de_chave_privada(hex_privada: &str) -> Result<Conta, JsError> {
    conta_de_hex(hex_privada).map_err(|e| JsError::new(&e))
}

fn nova_conta() -> Result<Conta, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("entropia indisponível: {e}"))?;
    conta_de_bytes(&bytes)
}

fn conta_de_hex(hex_privada: &str) -> Result<Conta, String> {
    let cru = hex_privada.strip_prefix("0x").unwrap_or(hex_privada);
    let bytes = hex::decode(cru).map_err(|_| "chave privada não é hexadecimal".to_string())?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "chave privada precisa ter 32 bytes".to_string())?;
    conta_de_bytes(&bytes)
}

fn conta_de_bytes(bytes: &[u8; 32]) -> Result<Conta, String> {
    // A derivação vem da LIB — a MESMA regra que `decode_raw_transaction` usa ao
    // recuperar o remetente de uma assinatura. Reimplementá-la aqui recriaria,
    // no navegador, exatamente o problema que este crate existe para resolver.
    let eavm = eav7::eavm::envelope::eavm_address_from_private(bytes)?;
    // A derivação E7 vem da LIB — é a mesma função que o nó usa para mapear uma
    // conta EAVM. Reimplementá-la aqui recriaria o problema que este crate resolve.
    let e7 = eav7::state::contracts::eavm_to_e7(&eavm)
        .map_err(|e| format!("derivação E7 falhou: {e}"))?;
    Ok(Conta { private_key: format!("0x{}", hex::encode(bytes)), eavm, e7 })
}

/// Endereço E7 correspondente a uma conta EAVM (`0x…`).
///
/// O nome segue o protocolo (`eavmToE7`, `envelope.js:42`). A carteira do
/// navegador chamava isto de `evmToE7` — mesma função, nome escorregado, e uma
/// das razões de aquela cópia sair de cena.
#[wasm_bindgen(js_name = eavmParaE7)]
pub fn eavm_para_e7(eavm: &str) -> Result<String, JsError> {
    eavm_para_e7_interno(eavm).map_err(|e| JsError::new(&e))
}

fn eavm_para_e7_interno(eavm: &str) -> Result<String, String> {
    eav7::state::contracts::eavm_to_e7(eavm).map_err(|e| e.to_string())
}

/// Um endereço EAVM é válido? (`0x` + 40 hexadecimais minúsculos)
#[wasm_bindgen(js_name = enderecoEavmValido)]
pub fn endereco_eavm_valido(v: &str) -> bool {
    eav7::state::contracts::is_eavm_address(v)
}

/// Um endereço E7 é válido? (inclui a conferência do CHECKSUM)
#[wasm_bindgen(js_name = enderecoE7Valido)]
pub fn endereco_e7_valido(v: &str) -> bool {
    eav7::is_valid_address(v)
}

/// Monta e ASSINA uma transação EAVM (legada, EIP-155) e devolve o `raw` `0x…`.
///
/// "Legada" e "EIP-155" são nomes do padrão do Ethereum, que é o formato de fio
/// que a EAVM fala — esses ficam. O que é nosso é a máquina que executa.
///
/// `to` vazio é implantação de contrato. `data` é hex `0x…` (calldata ou
/// bytecode). Valores em wei, como texto decimal — `u128` não atravessa a
/// fronteira JS sem perder precisão, e wei chega perto do limite de `Number`.
#[wasm_bindgen(js_name = assinarTransacao)]
#[allow(clippy::too_many_arguments)]
pub fn assinar_transacao(
    hex_privada: &str,
    nonce: u64,
    to: Option<String>,
    value_wei: &str,
    chain_id: u64,
    gas_price_wei: Option<String>,
    gas_limit: Option<String>,
    data: Option<String>,
) -> Result<String, JsError> {
    assinar(hex_privada, nonce, to, value_wei, chain_id, gas_price_wei, gas_limit, data)
        .map_err(|e| JsError::new(&e))
}

#[allow(clippy::too_many_arguments)]
fn assinar(
    hex_privada: &str,
    nonce: u64,
    to: Option<String>,
    value_wei: &str,
    chain_id: u64,
    gas_price_wei: Option<String>,
    gas_limit: Option<String>,
    data: Option<String>,
) -> Result<String, String> {
    let cru = hex_privada.strip_prefix("0x").unwrap_or(hex_privada);
    let privada: [u8; 32] = hex::decode(cru)
        .map_err(|_| "chave privada não é hexadecimal".to_string())?
        .try_into()
        .map_err(|_| "chave privada precisa ter 32 bytes".to_string())?;

    let destino = match to.as_deref().filter(|s| !s.is_empty()) {
        None => None,
        Some(s) => {
            let cru = s.strip_prefix("0x").unwrap_or(s);
            let b = hex::decode(cru).map_err(|_| "destino não é hexadecimal".to_string())?;
            Some(<[u8; 20]>::try_from(b.as_slice())
                .map_err(|_| "destino precisa ter 20 bytes".to_string())?)
        }
    };

    let decimal = |nome: &str, v: Option<String>, padrao: u128| -> Result<u128, String> {
        match v.as_deref().filter(|s| !s.is_empty()) {
            None => Ok(padrao),
            Some(s) => s.parse().map_err(|_| format!("{nome} inválido: {s}")),
        }
    };

    let bytes_data = match data.as_deref().filter(|s| !s.is_empty() && *s != "0x") {
        None => Vec::new(),
        Some(s) => hex::decode(s.strip_prefix("0x").unwrap_or(s))
            .map_err(|_| "data não é hexadecimal".to_string())?,
    };

    let tx = eav7::eavm::envelope::TxEavm {
        nonce: u128::from(nonce),
        gas_price: decimal("gasPrice", gas_price_wei, GAS_PRICE_PADRAO)?,
        gas_limit: decimal("gasLimit", gas_limit, 21_000)?,
        to: destino,
        value: value_wei.parse().map_err(|_| "value não é decimal".to_string())?,
        data: bytes_data,
        chain_id,
    };
    eav7::eavm::envelope::create_signed_tx(&tx, &privada)
}

/// `chainId` da EAVM, para a carteira não precisar repeti-lo.
#[wasm_bindgen(js_name = chainId)]
pub fn chain_id() -> u64 {
    eav7::config::EAVM_CHAIN_ID
}

#[cfg(test)]
mod tests {
    use super::*;

    /// O endereço EAVM e o E7 derivados aqui são os MESMOS da referência.
    ///
    /// É a razão de este crate existir: as três cópias no navegador derivam
    /// endereço cada uma por conta própria, e uma divergência produz um endereço
    /// que a rede não reconhece — com o usuário achando que mandou certo.
    ///
    /// Vetor conferido contra o cliente JS (`evmToE7` de `wallet-crypto.ts`, que é
    /// `deriveAddressFrom('EAV7-EAVM:' + minúsculo)`).
    #[test]
    fn deriva_os_mesmos_enderecos_da_referencia() {
        let c = conta_de_hex(&format!("0x{}", "07".repeat(32))).expect("conta");

        // Endereço EAVM: keccak256 da chave pública não comprimida, 20 bytes finais.
        assert!(c.eavm().starts_with("0x") && c.eavm().len() == 42);
        assert_eq!(c.eavm(), c.eavm().to_lowercase(), "forma canônica é minúscula");

        // E o E7 é o que a LIB deriva — não uma segunda regra.
        assert_eq!(
            c.e7(),
            eav7::state::contracts::eavm_to_e7(&c.eavm()).expect("deriva")
        );
        assert!(endereco_e7_valido(&c.e7()), "o E7 tem de passar no checksum");
        assert!(endereco_eavm_valido(&c.eavm()));

        // A mesma chave dá sempre a mesma conta.
        let de_novo = conta_de_hex(&c.private_key()).expect("conta");
        assert_eq!(de_novo.eavm(), c.eavm());
        assert_eq!(de_novo.e7(), c.e7());
    }

    /// Chave inválida vira ERRO, não pânico — no navegador um pânico leva o
    /// módulo inteiro junto, e a carteira para de funcionar até recarregar.
    #[test]
    fn entrada_invalida_nao_entra_em_panico() {
        assert!(conta_de_hex("não é hex").is_err());
        assert!(conta_de_hex("0x00").is_err(), "32 bytes são obrigatórios");
        assert!(conta_de_hex(&format!("0x{}", "00".repeat(32))).is_err(), "zero não é escalar");
        assert!(eavm_para_e7_interno("0xnão").is_err());
        assert!(!endereco_e7_valido(""));
        assert!(!endereco_eavm_valido("0x123"));
    }

    /// A transação assinada aqui é a mesma que o nó valida — conferida pelo
    /// decodificador da própria lib.
    #[test]
    fn transacao_assinada_no_navegador_e_lida_pelo_no() {
        let chave = format!("0x{}", "07".repeat(32));
        let c = conta_de_chave_privada(&chave).expect("conta");

        let raw = assinar(
            &chave,
            3,
            Some(format!("0x{}", "77".repeat(20))),
            "1000000000000",
            chain_id(),
            None,
            None,
            None,
        )
        .expect("assina");

        let lida = eav7::eavm::envelope::decode_raw_transaction(&raw).expect("o nó lê");
        assert_eq!(lida.from, c.eavm(), "o remetente é o dono da chave");
        assert_eq!(lida.nonce, 3.0);
        assert_eq!(lida.value.to_string(), "1000000000000");
        assert_eq!(
            lida.chain_id.map(|x| x.to_string()),
            Some(chain_id().to_string())
        );
    }

    /// Sem destino é implantação de contrato — o caminho que a carteira usa para
    /// publicar.
    #[test]
    fn sem_destino_e_implantacao() {
        let raw = assinar(
            &format!("0x{}", "05".repeat(32)),
            0,
            None,
            "0",
            chain_id(),
            None,
            Some("100000".into()),
            Some("0x6000".into()),
        )
        .expect("assina");
        let lida = eav7::eavm::envelope::decode_raw_transaction(&raw).expect("lê");
        assert_eq!(lida.to, None);
        assert_eq!(lida.data_hex, "0x6000");
    }
}
