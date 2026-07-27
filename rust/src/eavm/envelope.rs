//! Envelope EAVM — porte de `src/eavm/envelope.js` + `src/eavm/tx.js` +
//! `src/eavm/rlp.js`.
//!
//! É o ponto em que uma carteira do ecossistema Ethereum (MetaMask, Trust Wallet)
//! entra na EAV7: a carteira assina uma transação Ethereum-style (RLP + keccak +
//! secp256k1) e o EAVM a embrulha numa transação eav20 validável. O `from` é
//! sempre RECUPERADO da assinatura, nunca informado — e a verificação do envelope
//! é STATELESS: tudo é re-derivado do `data.raw` assinado e comparado campo a
//! campo, de modo que um envelope adulterado nunca passa (`envelope.js:119-121`).
//!
//! # Decisão: RLP artesanal, sem crate
//!
//! A política do `Cargo.toml` autoriza dependência só para CRIPTOGRAFIA de
//! RustCrypto/arkworks ("Nada de conveniência"). RLP não é criptografia — é uma
//! serialização determinística de ~90 linhas na referência (`rlp.js`), cujo modo
//! de falha é benigno (transação rejeitada, nunca prova falsa aceita). Portá-la à
//! mão aqui é o mesmo caso do parser JSON de `transaction.rs`: gramática fechada,
//! coberta por testes de ida e volta, sem crate novo na árvore de produção. A
//! criptografia de verdade (keccak, recuperação secp256k1) REUSA `sha3`/`k256`
//! via [`super::host::recover_eth_address`] — nada reimplementado.
//!
//! # O parser é o da REFERÊNCIA, quirk a quirk — não um RLP de mercado
//!
//! `rlp.js`/`tx.js` não formam um decoder estrito de prateleira, e é o parser
//! DELES que está em consenso. Três comportamentos são preservados de propósito
//! (um decoder de mercado divergiria em todos):
//!
//! 1. **`subarray` clampa** (`rlp.js:57/71`): os bytes de comprimento de uma
//!    forma longa TRUNCADA voltam mais curtos e caem nos erros de "comprimento
//!    não canônico"/"truncado" — nunca em pânico nem em OUTRA mensagem.
//! 2. **campo escalar como LISTA**: a referência REJEITA lista nos oito campos
//!    (`tx.js:69-82`, a guarda `Buffer.isBuffer`) — mas a ORDEM dos erros passa
//!    primeiro pelo `strictInt`, que COAGE o Array como o V8 (`rlp.js:93`:
//!    `BigInt('0x' + Array.prototype.toString())`): um campo numérico com join
//!    não-hexadecimal morre ANTES da guarda, com a mensagem do `SyntaxError` do
//!    V8, reproduzida letra a letra em [`rlp_item_to_bigint`]. A guarda percorre
//!    os campos na ordem `nonce, gasPrice, gas, to, value, data, r, s`.
//! 3. **hex de comprimento ÍMPAR é aceito** (`tx.js:19-22`): a regex permite, e
//!    o `Buffer.from(hex, 'hex')` do Node DESCARTA o nibble final solto.
//!
//! # Conformidade
//!
//! `vectors/eavm-envelope.json`, consumido por `tests/eavm_envelope.rs`. Onde este
//! módulo e a referência divergirem, o certo é o que a referência faz.

use std::collections::BTreeMap;

use num_bigint::BigUint;
use sha3::{Digest as _, Keccak256};

use crate::config::{fees, EAVM_CHAIN_ID, EAVM_WEI_PER_E7, MAX_EAVM_CALLDATA, PROTOCOL};
use crate::eavm::host::{recover_eth_address, SECP256K1_N};
use crate::hash::eav_hash_one;
use crate::state::contracts::{e7_of, eavm_to_e7};
use crate::transaction::{JsonValue, Tx, EAVM_SCHEME};

// ---------------------------------------------------------------------------
// Endereços de sistema (`envelope.js:18-22`)
// ---------------------------------------------------------------------------

/// `EAVM_STAKE_ADDRESS` — `envelope.js:19`. Não é conta real: o `to` neste
/// endereço sinaliza a operação nativa STAKE, no padrão dos precompiles.
pub const EAVM_STAKE_ADDRESS: &str = "0x0000000000000000000000000000000000007001";

/// `EAVM_UNSTAKE_ADDRESS` — `envelope.js:20`.
pub const EAVM_UNSTAKE_ADDRESS: &str = "0x0000000000000000000000000000000000007002";

/// `Number.MAX_SAFE_INTEGER` (2⁵³ − 1). O nonce EAVM vira `number` no JS
/// (`tx.js:78`) e o timestamp do envelope é validado com `Number.isSafeInteger`
/// (`envelope.js:157`).
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Teto do `raw` em caracteres na VERIFICAÇÃO (`envelope.js:126`): a string
/// inteira, incluindo o prefixo `0x`.
const MAX_RAW_CHARS: usize = 8192;

// ---------------------------------------------------------------------------
// RLP (porte de `rlp.js`)
// ---------------------------------------------------------------------------

/// Um item RLP: bytes ou lista — exatamente as duas formas que `rlpDecode`
/// devolve (`Buffer` ou `Array`). Os itens decodificados são GUARDADOS e
/// re-serializados tal e qual na reconstrução do hash de assinatura, para que o
/// hash seja sobre os MESMOS bytes que a carteira assinou.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rlp {
    Bytes(Vec<u8>),
    List(Vec<Rlp>),
}

/// Profundidade máxima de aninhamento na DECODIFICAÇÃO.
///
/// A referência não tem guarda explícita — o `decodeItem` recursivo do Node vai
/// até o estouro de pilha do V8. Aqui a recursão sem guarda seria SIGSEGV, não
/// erro; o teto converte o abuso em `Err` antes de recursar.
///
/// O valor É calibrado pelo CUSTO DE PILHA, não pelo comprimento do `raw`.
///
/// A versão anterior era 4096, deduzida de `MAX_RAW_CHARS` (8192 caracteres ⇒
/// ≤ 4095 níveis) — o raciocínio fechava para o veredito, mas ignorava a pilha.
/// Medido: 4095 níveis consomem entre 1,0 e 1,25 MiB, contra os 2 MiB de uma
/// worker do tokio, e em build de desenvolvimento ~800 níveis já abortam. Como
/// `build_eavm_envelope` é chamado por `eth_sendRawTransaction` (RPC público, não
/// autenticado), ~24 KB de hexadecimal numa requisição derrubavam o PROCESSO —
/// em Rust o estouro é SIGABRT, não a exceção capturável que o V8 dá.
///
/// 64 é folgado por três ordens de grandeza: uma transação EAVM legítima aninha
/// DOIS níveis (a lista de campos, e a `accessList` dentro dela). Nada que este
/// decodificador precise aceitar chega perto disso, e o que passa de 64 é lixo
/// que a referência também recusa — não como estouro de pilha, mas porque a
/// estrutura não é uma transação. Logo o guarda continua sem mudar veredito
/// nenhum, e agora custa alguns KB de pilha em vez de mais de um megabyte.
const MAX_RLP_DEPTH: usize = 64;

/// `rlpEncode` — `rlp.js:2-10`. Determinístico: item < 0x80 sai cru; senão
/// prefixo de comprimento + corpo.
pub fn rlp_encode(item: &Rlp) -> Vec<u8> {
    match item {
        Rlp::List(itens) => {
            let mut corpo = Vec::new();
            for i in itens {
                corpo.extend_from_slice(&rlp_encode(i));
            }
            let mut fora = length_prefix(corpo.len(), 0xc0);
            fora.extend_from_slice(&corpo);
            fora
        }
        Rlp::Bytes(b) => {
            if b.len() == 1 && b[0] < 0x80 {
                return b.clone();
            }
            let mut fora = length_prefix(b.len(), 0x80);
            fora.extend_from_slice(b);
            fora
        }
    }
}

/// `lengthPrefix` — `rlp.js:29-34`.
fn length_prefix(length: usize, base: u8) -> Vec<u8> {
    if length < 56 {
        return vec![base + length as u8];
    }
    // Comprimento em big-endian mínimo (sem zeros à esquerda), como o
    // `toString(16)` da referência produz.
    let mut len_buf = Vec::new();
    let mut resto = length;
    while resto > 0 {
        len_buf.push((resto & 0xff) as u8);
        resto >>= 8;
    }
    len_buf.reverse();
    let mut fora = vec![base + 55 + len_buf.len() as u8];
    fora.extend_from_slice(&len_buf);
    fora
}

/// Inteiro (BigUint) → bytes mínimos big-endian, a forma que o `toBuffer` da
/// referência dá a `bigint` (`rlp.js:19-25`): zero vira VAZIO.
fn biguint_to_min_bytes(v: &BigUint) -> Vec<u8> {
    if v.bits() == 0 {
        return Vec::new();
    }
    v.to_bytes_be()
}

/// `rlpDecode` — `rlp.js:36-40`: decodifica UM item e recusa bytes excedentes.
pub fn rlp_decode(buffer: &[u8]) -> Result<Rlp, String> {
    let (valor, resto) = decode_item(buffer, 0)?;
    if !resto.is_empty() {
        return Err("RLP: bytes excedentes após o item".to_string());
    }
    Ok(valor)
}

/// `decodeItem` — `rlp.js:42-85`, com as MESMAS regras de canonicidade:
/// string de 1 byte < 0x80 reserializada como curta é erro, comprimento longo
/// abaixo de 56 é erro, comprimento com zero à esquerda é erro. São elas que
/// garantem UMA codificação por conteúdo — sem isso o mesmo corpo assinado teria
/// vários `raw` válidos, e vários ids.
fn decode_item(buf: &[u8], prof: usize) -> Result<(Rlp, &[u8]), String> {
    if prof >= MAX_RLP_DEPTH {
        return Err(format!("RLP: aninhamento acima de {MAX_RLP_DEPTH} níveis"));
    }
    let Some(&first) = buf.first() else {
        return Err("RLP: buffer vazio".to_string());
    };

    if first < 0x80 {
        return Ok((Rlp::Bytes(vec![first]), &buf[1..]));
    }

    if first < 0xb8 {
        let length = (first - 0x80) as usize;
        if buf.len() < 1 + length {
            return Err("RLP: truncado".to_string());
        }
        if length == 1 && buf[1] < 0x80 {
            return Err("RLP: codificação não canônica".to_string());
        }
        return Ok((Rlp::Bytes(buf[1..1 + length].to_vec()), &buf[1 + length..]));
    }

    if first < 0xc0 {
        let len_of_len = (first - 0xb7) as usize;
        // Como na referência (`subarray` tolera o corte), o pedaço pode vir mais
        // curto que `len_of_len` num buffer truncado — `buf_to_int` de um pedaço
        // vazio dá 0, que cai no "comprimento não canônico" logo abaixo.
        let pedaco = &buf[1..buf.len().min(1 + len_of_len)];
        let length = buf_to_int(pedaco)?;
        if length < 56 {
            return Err("RLP: comprimento não canônico".to_string());
        }
        let start = 1 + len_of_len;
        let fim = start.checked_add(length).ok_or("RLP: truncado")?;
        if buf.len() < fim {
            return Err("RLP: truncado".to_string());
        }
        return Ok((Rlp::Bytes(buf[start..fim].to_vec()), &buf[fim..]));
    }

    let (list_length, start) = if first < 0xf8 {
        ((first - 0xc0) as usize, 1usize)
    } else {
        let len_of_len = (first - 0xf7) as usize;
        let pedaco = &buf[1..buf.len().min(1 + len_of_len)];
        let list_length = buf_to_int(pedaco)?;
        if list_length < 56 {
            return Err("RLP: comprimento de lista não canônico".to_string());
        }
        (list_length, 1 + len_of_len)
    };
    let fim = start.checked_add(list_length).ok_or("RLP: lista truncada")?;
    if buf.len() < fim {
        return Err("RLP: lista truncada".to_string());
    }

    let mut itens = Vec::new();
    let mut corpo = &buf[start..fim];
    while !corpo.is_empty() {
        let (decodificado, resto) = decode_item(corpo, prof + 1)?;
        itens.push(decodificado);
        corpo = resto;
    }
    Ok((Rlp::List(itens), &buf[fim..]))
}

/// `bufToInt` — `rlp.js:87-91`: usado só para COMPRIMENTOS; zero à esquerda é
/// erro (canonicidade da própria moldura RLP).
fn buf_to_int(buf: &[u8]) -> Result<usize, String> {
    if buf.is_empty() {
        return Ok(0);
    }
    if buf[0] == 0 {
        return Err("RLP: zeros à esquerda".to_string());
    }
    // `len_of_len` ≤ 8, então o valor cabe em u64; em usize de 64 bits idem.
    let mut n: usize = 0;
    for &b in buf {
        n = n.checked_mul(256).and_then(|v| v.checked_add(b as usize)).ok_or("RLP: comprimento excede o endereçável")?;
    }
    Ok(n)
}

/// `rlpBufToBigInt` — `rlp.js:93`: buffer vazio é zero, SEM regra de
/// canonicidade (essa fica no [`strict_int`]).
fn rlp_buf_to_biguint(buf: &[u8]) -> BigUint {
    BigUint::from_bytes_be(buf)
}

// ---------------------------------------------------------------------------
// Decodificação da transação assinada (porte de `tx.js`)
// ---------------------------------------------------------------------------

/// `.length` do JS sobre o item decodificado: Buffer conta BYTES, Array conta
/// ELEMENTOS. É o que `fields.to.length === 0` (`tx.js:81`) enxerga — e por isso
/// um `to` codificado como LISTA VAZIA (`0xc0`) também vale destino nulo (=
/// implantação de contrato), exatamente como na referência. "Corrigir" isso aqui
/// faria este cliente recusar um raw assinado que a rede aceita: cisão.
fn item_len(item: &Rlp) -> usize {
    match item {
        Rlp::Bytes(b) => b.len(),
        Rlp::List(l) => l.len(),
    }
}

/// `String(item)` do JS: Buffer → texto UTF-8 (bytes inválidos viram U+FFFD — o
/// decoder do Node e o `from_utf8_lossy` do Rust seguem ambos a substituição por
/// "maximal subparts" do Unicode, então os replacement chars saem IGUAIS);
/// Array → `Array.prototype.toString()` = filhos convertidos e unidos por
/// vírgula, recursivamente.
fn js_to_string(item: &Rlp) -> String {
    match item {
        Rlp::Bytes(b) => String::from_utf8_lossy(b).into_owned(),
        Rlp::List(itens) => itens.iter().map(js_to_string).collect::<Vec<_>>().join(","),
    }
}

/// `buf.toString('hex')` do JS: em Buffer é hexadecimal; em Array o ARGUMENTO É
/// IGNORADO (`Array.prototype.toString` não recebe encoding) e sai o join por
/// vírgula de [`js_to_string`]. O `hex()` de `tx.js:8` é `'0x' + isto` — e a
/// coerção é consenso: um `data` decodificado como lista produz um `dataHex` com
/// vírgulas e lixo UTF-8 que a referência ACEITA e compara adiante campo a campo.
fn item_hex_string(item: &Rlp) -> String {
    match item {
        Rlp::Bytes(b) => hex::encode(b),
        Rlp::List(_) => js_to_string(item),
    }
}

/// `hex()` — `tx.js:8`, sobre um item decodificado. Depois da guarda de
/// [`exige_bytes`] o braço de lista é inalcançável para `to`/`data`; fica pela
/// semântica completa do helper.
fn hex0x_item(item: &Rlp) -> String {
    format!("0x{}", item_hex_string(item))
}

/// A guarda de tipo dos campos escalares — `tx.js:78-82`: depois dos
/// `strictInt` (cuja coerção tem precedência na ordem dos erros), qualquer um
/// dos oito campos que tenha decodificado como LISTA é rejeitado, na ordem das
/// chaves do objeto `fields` do JS. Sem ela, `hex(array)` cairia no
/// `Array.toString` e um envelope casado com o lixo passaria; e uma lista VAZIA
/// num campo numérico valeria 0 em silêncio.
fn exige_bytes(campos: &[(&str, &Rlp)]) -> Result<(), String> {
    for (nome, item) in campos {
        if matches!(item, Rlp::List(_)) {
            return Err(format!("RLP: campo `{nome}` deve ser byte string, não lista"));
        }
    }
    Ok(())
}

/// `rlpBufToBigInt` — `rlp.js:93` sobre um item decodificado: comprimento zero
/// (bytes vazios OU lista vazia) → 0; senão `BigInt('0x' + toString('hex'))`.
///
/// Para bytes é o inteiro big-endian. Para LISTA não vazia o JS coage o join a
/// hexadecimal: `[Buffer('ab')]` VALE 0xab (quirk preservado — o hash de
/// assinatura re-serializa o item original, então um raw assim pode até
/// recuperar signer válido na referência); um join não-hexadecimal lança
/// `SyntaxError`, cuja mensagem do V8 é reproduzida aqui letra a letra.
fn rlp_item_to_bigint(item: &Rlp) -> Result<BigUint, String> {
    if item_len(item) == 0 {
        return Ok(BigUint::from(0u8));
    }
    match item {
        Rlp::Bytes(b) => Ok(rlp_buf_to_biguint(b)),
        Rlp::List(_) => {
            let s = js_to_string(item);
            BigUint::parse_bytes(s.as_bytes(), 16)
                .ok_or_else(|| format!("Cannot convert 0x{s} to a BigInt"))
        }
    }
}

/// `strictInt` — `tx.js:13-16`. Inteiro RLP canônico: rejeita zeros à esquerda
/// no conteúdo, e devolve o valor de `rlpBufToBigInt` (a função do JS TAMBÉM
/// converte, não só valida).
///
/// # O achado de maleabilidade que esta função fecha
///
/// Sem ela, padear `r`/`s`/`v`/`value` com bytes `0x00` produz um `raw` DIFERENTE
/// (logo um `eavmHash` e um `id` de envelope diferentes) que recupera o MESMO
/// signer — maleabilidade de txid EAVM: a mesma transferência entraria duas vezes
/// no mempool com dois ids, furando a deduplicação (`tx.js:10-12`).
///
/// Fidelidade ao quirk de tipo: o teste do JS é `buf[0] === 0`, e num ARRAY o
/// primeiro elemento é um Buffer (objeto), nunca `=== 0` — LISTA não dispara o
/// erro de zero à esquerda e segue para a coerção de [`rlp_item_to_bigint`].
fn strict_int(item: &Rlp, field: &str) -> Result<BigUint, String> {
    if let Rlp::Bytes(buf) = item
        && !buf.is_empty()
        && buf[0] == 0
    {
        return Err(format!("RLP: inteiro não canônico em {field} (zero à esquerda)"));
    }
    rlp_item_to_bigint(item)
}

/// Decodifica o hexadecimal do `raw` como o `Buffer.from(hex, 'hex')` do Node
/// (`tx.js:22`): pares completos; um NIBBLE final incompleto é DESCARTADO em
/// silêncio.
///
/// Não é gosto — é conformidade bug-a-bug: a regex da referência (`tx.js:19`)
/// aceita comprimento ímpar, e o Node trunca o nibble solto. Rejeitar aqui faria
/// este cliente recusar um `raw` que a rede aceita: cisão determinística. O
/// efeito colateral (o MESMO corpo assinado com um nibble a mais ganha outro id
/// de envelope, já que o id sai da STRING do raw e o hash sai dos BYTES) é uma
/// maleabilidade de id de envelope da referência, registrada no relatório.
fn decode_hex_como_node(hex_sem_prefixo: &str) -> Vec<u8> {
    let b = hex_sem_prefixo.as_bytes();
    let mut fora = Vec::with_capacity(b.len() / 2);
    let valor = |c: u8| -> u8 {
        match c {
            b'0'..=b'9' => c - b'0',
            b'a'..=b'f' => c - b'a' + 10,
            b'A'..=b'F' => c - b'A' + 10,
            // Inalcançável: quem chama já validou a regex `[0-9a-fA-F]`.
            _ => 0,
        }
    };
    for par in b.chunks_exact(2) {
        fora.push(valor(par[0]) * 16 + valor(par[1]));
    }
    fora
}

fn hex0x(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

/// O resultado de `decodeRawTransaction` — os mesmos campos que a referência
/// devolve (`tx.js:75-86`), nos tipos honestos: os montantes são `BigUint`
/// porque no JS são `BigInt`.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedTx {
    /// `eavmType`: 0 (legacy) ou 2 (EIP-1559).
    pub eavm_type: u8,
    /// `chainId`: `None` para legacy sem EIP-155 — que [`check_parsed`] rejeita.
    pub chain_id: Option<BigUint>,
    /// `nonce`: `f64` DE PROPÓSITO. O JS faz `Number(rlpBufToBigInt(nonce))`
    /// (`tx.js:78`) e TODA comparação posterior (`tx.nonce !== parsed.nonce + 1`,
    /// `envelope.js:156`) é aritmética de double: um nonce ≥ 2⁵³ ARREDONDA na
    /// referência, e comparar com inteiro exato aqui divergiria exatamente no
    /// raw que um atacante montaria. [`biguint_to_f64`] reproduz o `Number()`.
    pub nonce: f64,
    pub gas_price: BigUint,
    pub gas_limit: BigUint,
    /// `to`: `None` quando o campo RLP é vazio (implantação de contrato); senão
    /// `'0x' + hex` minúsculo dos bytes (a guarda de [`exige_bytes`] garante que
    /// só bytes chegam aqui). SEM validação de comprimento — quem valida é a
    /// derivação E7, como na referência.
    pub to: Option<String>,
    pub value: BigUint,
    /// `dataHex`: `'0x' + toString('hex')` — o `0x` sozinho quando vazio.
    pub data_hex: String,
    /// `from`: endereço Ethereum RECUPERADO da assinatura — nunca informado.
    pub from: String,
    /// `eavmHash`: `keccak256` dos BYTES do raw (`tx.js:85`) — com o prefixo
    /// 0x02 incluído no caso tipo 2, porque ele faz parte do buffer.
    pub eavm_hash: String,
}

/// `decodeRawTransaction` — `tx.js:18-87`. Os três formatos que carteiras
/// universais produzem:
///
/// 1. legacy sem EIP-155 (`v` 27/28) — decodifica, mas [`check_parsed`] rejeita
///    por `chainId` ausente;
/// 2. legacy EIP-155 (`v ≥ 35`, `chainId = (v-35)/2`);
/// 3. tipo 2 / EIP-1559 (prefixo `0x02`, 12 campos; `accessList` não vazia é
///    rejeitada).
pub fn decode_raw_transaction(raw_hex: &str) -> Result<ParsedTx, String> {
    // Regex da referência: `^0x[0-9a-fA-F]{2,}$` (`tx.js:19`).
    let sem_prefixo = raw_hex.strip_prefix("0x").unwrap_or("");
    if sem_prefixo.len() < 2 || !sem_prefixo.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("transação raw deve ser hex 0x".to_string());
    }
    let raw = decode_hex_como_node(sem_prefixo);
    let Some(&primeiro) = raw.first() else {
        // Inalcançável: a regex exige ao menos 2 hexadecimais → ao menos 1 byte.
        return Err("transação raw deve ser hex 0x".to_string());
    };

    // Campos comuns aos formatos. Os inteiros saem já convertidos pelo
    // `strict_int` (que, como no JS, valida E converte, na ordem exata dos
    // campos — o primeiro erro define a mensagem); `to` e `data` ficam como
    // ITENS, porque a coerção deles ('0x' + toString) acontece só no fim.
    let fields_nonce: BigUint;
    let fields_gas_price: BigUint;
    let fields_gas: BigUint;
    let fields_to: Rlp;
    let fields_value: BigUint;
    let fields_data: Rlp;
    let fields_r: BigUint;
    let fields_s: BigUint;
    let signing_hash: [u8; 32];
    // `None` = recId NEGATIVO (legacy pré-155 com v < 27: `recId = v - 27n` fica
    // abaixo de zero no JS e `recover` devolve null — `secp256k1.js:124`). A
    // falha só é sinalizada DEPOIS da regra EIP-2, na mesma ordem do JS.
    let rec_id_big: Option<BigUint>;
    let chain_id: Option<BigUint>;
    let tipo: u8;

    if primeiro == 0x02 {
        // ------------------------------------------------ EIP-1559 (`tx.js:30-45`)
        tipo = 2;
        let Rlp::List(list) = rlp_decode(&raw[1..])? else {
            return Err("transação tipo 2 malformada".to_string());
        };
        if list.len() != 12 {
            return Err("transação tipo 2 malformada".to_string());
        }
        let [cid, nonce, max_prio, max_fee, gas, to, value, data, access_list, y_parity, r, s] =
            &list[..]
        else {
            // Inalcançável: o comprimento 12 acabou de ser conferido.
            return Err("transação tipo 2 malformada".to_string());
        };
        // A referência SÓ rejeita accessList quando é um Array NÃO VAZIO
        // (`tx.js:36`): lista vazia e até uma string de bytes passam — e o item
        // original é re-serializado tal e qual no hash de assinatura. Mesma regra.
        if let Rlp::List(al) = access_list
            && !al.is_empty()
        {
            return Err("accessList não suportada".to_string());
        }
        fields_nonce = strict_int(nonce, "nonce")?;
        strict_int(max_prio, "maxPriorityFee")?;
        fields_gas_price = strict_int(max_fee, "maxFee")?; // `gasPrice: maxFee` (`tx.js:45`)
        fields_gas = strict_int(gas, "gas")?;
        fields_value = strict_int(value, "value")?;
        fields_r = strict_int(r, "r")?;
        fields_s = strict_int(s, "s")?;
        chain_id = Some(strict_int(cid, "chainId")?);
        rec_id_big = Some(strict_int(y_parity, "yParity")?);
        // signingHash = keccak(0x02 ‖ rlp([cid..accessList])) — `tx.js:41-44`,
        // re-serializando os itens DECODIFICADOS, para que canonicidade já
        // validada implique bytes idênticos aos assinados.
        let corpo = rlp_encode(&Rlp::List(vec![
            cid.clone(),
            nonce.clone(),
            max_prio.clone(),
            max_fee.clone(),
            gas.clone(),
            to.clone(),
            value.clone(),
            data.clone(),
            access_list.clone(),
        ]));
        let mut pre = Vec::with_capacity(1 + corpo.len());
        pre.push(0x02);
        pre.extend_from_slice(&corpo);
        signing_hash = Keccak256::digest(&pre).into();
        // Guarda de tipo (`tx.js:78-82`), na ordem das chaves de `fields` —
        // note `gasPrice` apontando para o item de maxFee, como no JS.
        exige_bytes(&[
            ("nonce", nonce),
            ("gasPrice", max_fee),
            ("gas", gas),
            ("to", to),
            ("value", value),
            ("data", data),
            ("r", r),
            ("s", s),
        ])?;
        fields_to = to.clone();
        fields_data = data.clone();
    } else if primeiro >= 0xc0 {
        // ------------------------------- legacy, com ou sem EIP-155 (`tx.js:46-64`)
        tipo = 0;
        let Rlp::List(list) = rlp_decode(&raw)? else {
            return Err("transação legacy malformada".to_string());
        };
        if list.len() != 9 {
            return Err("transação legacy malformada".to_string());
        }
        let [nonce, gas_price, gas, to, value, data, v, r, s] = &list[..] else {
            // Inalcançável: o comprimento 9 acabou de ser conferido.
            return Err("transação legacy malformada".to_string());
        };
        fields_nonce = strict_int(nonce, "nonce")?;
        fields_gas_price = strict_int(gas_price, "gasPrice")?;
        fields_gas = strict_int(gas, "gas")?;
        fields_value = strict_int(value, "value")?;
        fields_r = strict_int(r, "r")?;
        fields_s = strict_int(s, "s")?;
        let v_big = strict_int(v, "v")?;
        let n35 = BigUint::from(35u8);
        if v_big >= n35 {
            // EIP-155: chainId = (v-35)/2, recId = (v-35)%2, e o hash de
            // assinatura leva [.., chainId, 0, 0] (`tx.js:55-58`).
            let base = &v_big - &n35;
            let cid = &base / 2u8;
            rec_id_big = Some(&base % 2u8);
            let hash_list = Rlp::List(vec![
                nonce.clone(),
                gas_price.clone(),
                gas.clone(),
                to.clone(),
                value.clone(),
                data.clone(),
                Rlp::Bytes(biguint_to_min_bytes(&cid)),
                Rlp::Bytes(Vec::new()),
                Rlp::Bytes(Vec::new()),
            ]);
            signing_hash = Keccak256::digest(rlp_encode(&hash_list)).into();
            chain_id = Some(cid);
        } else {
            // Pré-155: v = 27/28, hash sobre os 6 campos (`tx.js:59-63`). O
            // `chainId` nulo será rejeitado por [`check_parsed`] — mas a
            // decodificação segue, como na referência, para que a ORDEM dos
            // erros seja a mesma. Um v < 27 dá recId negativo no JS (`None`
            // aqui) e só falha DEPOIS da regra EIP-2, lá embaixo.
            chain_id = None;
            let n27 = BigUint::from(27u8);
            rec_id_big = if v_big >= n27 { Some(&v_big - &n27) } else { None };
            let hash_list = Rlp::List(vec![
                nonce.clone(),
                gas_price.clone(),
                gas.clone(),
                to.clone(),
                value.clone(),
                data.clone(),
            ]);
            signing_hash = Keccak256::digest(rlp_encode(&hash_list)).into();
        }
        // Guarda de tipo (`tx.js:78-82`), na ordem das chaves de `fields`.
        exige_bytes(&[
            ("nonce", nonce),
            ("gasPrice", gas_price),
            ("gas", gas),
            ("to", to),
            ("value", value),
            ("data", data),
            ("r", r),
            ("s", s),
        ])?;
        fields_to = to.clone();
        fields_data = data.clone();
    } else {
        return Err(format!("tipo de transação EVM não suportado: 0x{primeiro:x}"));
    }

    // ----------------------------------------- assinatura e recuperação (`tx.js:69-73`)
    // (`tx.js:69-70` reconverte r/s com `rlpBufToBigInt` — os MESMOS valores que
    // o `strictInt` já devolveu acima; reusados.)
    let r = fields_r;
    let s = fields_s;
    let n = BigUint::from_bytes_be(&SECP256K1_N);
    // EIP-2: `s` alto rejeitado ANTES de recuperar (`tx.js:71`). É a metade da
    // anti-maleabilidade: sem isto, (r, n−s) seria uma segunda assinatura válida
    // do mesmo corpo — outro raw, outro id de envelope, mesmo signer. E a ordem
    // importa: um raw com v < 27 E s alto dá ESTA mensagem no JS, não a de
    // recuperação.
    if s > (&n >> 1u32) {
        return Err("assinatura com s alto rejeitada (EIP-2)".to_string());
    }
    // Faixas do `recover` da referência (`secp256k1.js:124`): r,s ∈ [1, n−1] e
    // recId ∈ [0, 3]; fora disso (inclusive recId negativo, `None` aqui) é null
    // → o mesmo erro.
    let falha = || "assinatura EVM inválida (recuperação de chave falhou)".to_string();
    if r.bits() == 0 || s.bits() == 0 || r >= n || s >= n {
        return Err(falha());
    }
    let rec_id_big = rec_id_big.ok_or_else(falha)?;
    if rec_id_big > BigUint::from(3u8) {
        return Err(falha());
    }
    let rec_id = u8::try_from(&rec_id_big).map_err(|_| falha())?;
    // REUSA a recuperação do precompile 0x01 — mesma conta, um só código.
    let from20 = recover_eth_address(&signing_hash, &r, &s, rec_id).ok_or_else(falha)?;

    // ------------------------------------------------- campos finais (`tx.js:75-86`)
    Ok(ParsedTx {
        eavm_type: tipo,
        chain_id,
        // `Number(rlpBufToBigInt(nonce))` (`tx.js:78`) — double, com o mesmo
        // arredondamento do V8 acima de 2⁵³. Ver o doc de [`ParsedTx::nonce`].
        nonce: biguint_to_f64(&fields_nonce),
        gas_price: fields_gas_price,
        gas_limit: fields_gas,
        // `fields.to.length === 0 ? null : hex(fields.to)` (`tx.js:81`): o
        // comprimento é o do JS (bytes OU elementos) e o hex é a coerção do JS.
        to: if item_len(&fields_to) == 0 { None } else { Some(hex0x_item(&fields_to)) },
        value: fields_value,
        data_hex: hex0x_item(&fields_data),
        from: hex0x(&from20),
        eavm_hash: hex0x(Keccak256::digest(&raw).as_slice()),
    })
}

/// `Number(bigint)` do JS: conversão corretamente arredondada para double. O
/// parse decimal do Rust dá a MESMA garantia (round-to-nearest), e o estouro
/// vira infinito nos dois — o `unwrap_or` é inalcançável (todo decimal de
/// `BigUint` parseia), mantido por não haver pânico em código de consenso.
fn biguint_to_f64(v: &BigUint) -> f64 {
    v.to_string().parse::<f64>().unwrap_or(f64::INFINITY)
}

// ---------------------------------------------------------------------------
// Classificação e regras do envelope (porte de `envelope.js`)
// ---------------------------------------------------------------------------

/// O tipo do envelope — o resultado fechado de [`classify`]. Enum e não string
/// para que o mapeamento de taxa ([`EnvelopeType::fee`]) seja exaustivo por
/// construção, sem `unreachable!` em código de consenso.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnvelopeType {
    Stake,
    Unstake,
    Deploy,
    Call,
    Transfer,
}

impl EnvelopeType {
    /// O `type` textual da transação eav20.
    pub fn as_str(self) -> &'static str {
        match self {
            EnvelopeType::Stake => "STAKE",
            EnvelopeType::Unstake => "UNSTAKE",
            EnvelopeType::Deploy => "EAVM_DEPLOY",
            EnvelopeType::Call => "EAVM_CALL",
            EnvelopeType::Transfer => "EAVM_TRANSFER",
        }
    }

    /// `op` do envelope: só as operações nativas têm (`envelope.js:21-22`).
    fn op(self) -> Option<&'static str> {
        match self {
            EnvelopeType::Stake => Some("STAKE"),
            EnvelopeType::Unstake => Some("UNSTAKE"),
            _ => None,
        }
    }

    /// Contrato (deploy/chamada)? O destino do PROTOCOLO fica nulo nesses casos
    /// (`envelope.js:97-100`): o alvo vive em `data.to`.
    fn is_contract(self) -> bool {
        matches!(self, EnvelopeType::Deploy | EnvelopeType::Call)
    }

    /// `CHAIN.FEES[type]` — os cinco valores de `config.rs::fees`, validados por
    /// `vectors/config.json`.
    fn fee(self) -> u128 {
        match self {
            EnvelopeType::Stake => fees::STAKE,
            EnvelopeType::Unstake => fees::UNSTAKE,
            EnvelopeType::Deploy => fees::EAVM_DEPLOY,
            EnvelopeType::Call => fees::EAVM_CALL,
            EnvelopeType::Transfer => fees::EAVM_TRANSFER,
        }
    }
}

/// `opForTo` — `envelope.js:22`: endereço de sistema → operação nativa.
fn op_for_to(to: Option<&str>) -> Option<EnvelopeType> {
    let lower = to?.to_lowercase();
    if lower == EAVM_STAKE_ADDRESS {
        Some(EnvelopeType::Stake)
    } else if lower == EAVM_UNSTAKE_ADDRESS {
        Some(EnvelopeType::Unstake)
    } else {
        None
    }
}

/// `checkParsed` — `envelope.js:54-70`. As quatro regras de admissão, na MESMA
/// ordem (a ordem decide qual erro aparece quando mais de uma falha):
///
/// 1. `chainId` tem de ser o da rede — legacy sem EIP-155 (chainId nulo) cai
///    aqui, e uma transação assinada para outra cadeia idem;
/// 2. `value` múltiplo exato de `EAVM_WEI_PER_E7` — mais de 6 casas decimais de
///    EAV7 não existem no livro nativo;
/// 3. endereço de sistema com calldata é AMBÍGUO (operação nativa ou chamada?) e
///    é rejeitado em vez de ganhar dois significados;
/// 4. calldata limitada a `MAX_EAVM_CALLDATA` bytes.
fn check_parsed(parsed: &ParsedTx) -> Result<(), String> {
    if parsed.chain_id.as_ref() != Some(&BigUint::from(EAVM_CHAIN_ID)) {
        return Err(format!("chainId incorreto (a rede EAV7 usa {EAVM_CHAIN_ID})"));
    }
    if (&parsed.value % BigUint::from(EAVM_WEI_PER_E7)).bits() != 0 {
        return Err("valor com mais de 6 casas decimais de EAV7".to_string());
    }
    if op_for_to(parsed.to.as_deref()).is_some() && parsed.data_hex != "0x" {
        return Err("endereço de sistema não aceita calldata".to_string());
    }
    // `.length` de string do JS conta unidades UTF-16 — idêntico a bytes para
    // hex puro, mas o `dataHex` de uma LISTA (quirk do parser) pode conter
    // U+FFFD, e aí as contagens diferem.
    let js_len: usize = parsed.data_hex.chars().map(char::len_utf16).sum();
    if js_len > 2 + (MAX_EAVM_CALLDATA as usize) * 2 {
        return Err(format!("calldata acima do máximo ({MAX_EAVM_CALLDATA} bytes)"));
    }
    Ok(())
}

/// `classify` — `envelope.js:75-81`. Decide se o raw vira operação nativa,
/// implantação, chamada ou transferência — e é usada IDÊNTICA na construção e na
/// verificação, para que as duas jamais divirjam (é a mesma função).
fn classify(parsed: &ParsedTx) -> EnvelopeType {
    if let Some(op) = op_for_to(parsed.to.as_deref()) {
        return op;
    }
    if parsed.to.is_none() {
        return EnvelopeType::Deploy;
    }
    if parsed.data_hex != "0x" {
        return EnvelopeType::Call;
    }
    EnvelopeType::Transfer
}

/// `destE7For` — `envelope.js:42`: `decodeE7Dest(to) ?? eavmToE7(to)`. É
/// exatamente o [`e7_of`] de `state/contracts.rs` — reusado, não recopiado.
fn dest_e7_for(to: &str) -> Result<String, String> {
    e7_of(to).map_err(|e| e.to_string())
}

/// `buildEavmEnvelope` — `envelope.js:83-117`: embrulha o raw assinado numa
/// transação eav20.
///
/// `fee_exempt` é o `state` da referência (`envelope.js:91` chama
/// `state.isFeeExempt(from)`) na forma que o Rust permite sem acoplar este
/// módulo ao estado: um PREDICADO sobre o remetente E7. Precisa ser predicado, e
/// não um `bool`, porque o remetente só é conhecido DEPOIS de decodificar o raw
/// — aqui dentro. Enquanto era `bool`, o único chamador real
/// (`eth_sendRawTransaction`) passava `false` sempre, e a conta isenta recebia
/// envelope com o teto da tabela onde a referência põe "0".
///
/// A VERIFICAÇÃO aceita as duas formas (taxa da tabela ou "0") justamente porque
/// é stateless — por isso isto nunca foi divergência de consenso.
pub fn build_eavm_envelope(
    raw_hex: &str,
    timestamp: i64,
    fee_exempt: impl Fn(&str) -> bool,
) -> Result<Tx, String> {
    // O MESMO teto que a verificação aplica (`verify_eavm_envelope`). Ficava só
    // lá, e esta função é a que o `eth_sendRawTransaction` chama — ou seja, o
    // caminho SEM teto era justamente o exposto ao RPC público. Um envelope que
    // a verificação recusaria por tamanho não deve nem ser construído.
    if raw_hex.len() > MAX_RAW_CHARS {
        return Err("transação raw inválida".into());
    }
    let raw = raw_hex.to_lowercase();
    let parsed = decode_raw_transaction(&raw)?;
    check_parsed(&parsed)?;

    let tipo = classify(&parsed);
    let from = eavm_to_e7(&parsed.from).map_err(|e| e.to_string())?;
    let fee = if fee_exempt(&from) { 0 } else { tipo.fee() };

    // Guarda SÓ do construtor (não existe no JS): `nonce` e `eavmNonce` são
    // inteiros no `JsonValue`, e acima de 2⁵³ o JS emitiria um double impreciso
    // que este cliente não representa. A VERIFICAÇÃO segue o JS à risca (compara
    // em f64) — nenhuma carteira real chega perto deste valor.
    if !(parsed.nonce >= 0.0 && parsed.nonce <= (MAX_SAFE_INTEGER - 1) as f64) {
        return Err("nonce EAVM acima do inteiro seguro (guarda do construtor)".to_string());
    }

    // Destino do PROTOCOLO: só a transferência tem (`envelope.js:97-100`) —
    // operação nativa e contrato deixam nulo (o alvo do contrato vive em
    // `data.to`). `classify` garante que Transfer tem `to`; o `else` cobre o
    // resto sem `unwrap`.
    let to = match (tipo, &parsed.to) {
        (EnvelopeType::Transfer, Some(to0x)) => Some(dest_e7_for(to0x)?),
        _ => None,
    };

    // `data` do envelope (`envelope.js:105-114`), com as chaves EXATAS — os
    // vetores comparam o mapa inteiro.
    let mut data: BTreeMap<String, JsonValue> = BTreeMap::new();
    data.insert("raw".into(), JsonValue::str(&raw));
    data.insert(
        "op".into(),
        match tipo.op() {
            Some(op) => JsonValue::str(op),
            None => JsonValue::Null,
        },
    );
    data.insert("eavmFrom".into(), JsonValue::str(&parsed.from));
    data.insert(
        "eavmTo".into(),
        match &parsed.to {
            Some(t) => JsonValue::str(t),
            None => JsonValue::Null,
        },
    );
    data.insert("eavmHash".into(), JsonValue::str(&parsed.eavm_hash));
    // Cabe em i64 e é exato: a guarda acima limitou o nonce a 2⁵³−2.
    data.insert("eavmNonce".into(), JsonValue::Int(parsed.nonce as i64));
    match tipo {
        EnvelopeType::Deploy => {
            data.insert("code".into(), JsonValue::str(&parsed.data_hex));
        }
        EnvelopeType::Call => {
            // `parsed.to` existe por classificação; `to_lowercase` espelha o
            // `.toLowerCase()` da referência (`envelope.js:113`) mesmo sendo o
            // hex já minúsculo.
            let alvo = parsed.to.as_deref().unwrap_or_default().to_lowercase();
            data.insert("to".into(), JsonValue::str(alvo));
            data.insert("input".into(), JsonValue::str(&parsed.data_hex));
        }
        _ => {}
    }

    Ok(Tx {
        protocol: PROTOCOL.to_string(),
        scheme: EAVM_SCHEME.to_string(),
        tx_type: tipo.as_str().to_string(),
        from,
        to,
        amount: (&parsed.value / BigUint::from(EAVM_WEI_PER_E7)).to_string(),
        fee: fee.to_string(),
        // Nonce EAVM começa em 0; nonce do protocolo, em 1 (`envelope.js:103`).
        nonce: parsed.nonce as i64 + 1,
        timestamp,
        data: Some(JsonValue::Map(data)),
        public_key: None,
        pq_public_key: None,
        signature: None,
        pq_signature: None,
        // O id sai do RAW, não do payload: `eavHash('EAV7-EAVM-TX:' + raw)`
        // (`envelope.js:115`).
        id: Some(eav_hash_one(format!("EAV7-EAVM-TX:{raw}"))),
    })
}

// ---------------------------------------------------------------------------
// Verificação stateless (porte de `verifyEavmEnvelope`, `envelope.js:121-167`)
// ---------------------------------------------------------------------------

/// Valor de `data[chave]` quando é string.
fn data_str<'a>(data: &'a BTreeMap<String, JsonValue>, chave: &str) -> Option<&'a str> {
    match data.get(chave) {
        Some(JsonValue::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

/// O `!= null` do JS: chave AUSENTE ou presente com `null` contam como "não
/// carrega o campo". É a semântica exata de `tx.data.to != null` etc.
/// (`envelope.js:147,151,152`).
fn data_nulo_ou_ausente(data: &BTreeMap<String, JsonValue>, chave: &str) -> bool {
    matches!(data.get(chave), None | Some(JsonValue::Null))
}

/// `verifyEavmEnvelope` — `envelope.js:121-167`. Validação STATELESS do
/// envelope: TUDO é re-derivado do `raw` assinado e comparado campo a campo, na
/// MESMA ordem da referência — um envelope adulterado nunca passa, e a ordem dos
/// erros coincide.
///
/// Campos comparados (a lista exata, na ordem): `protocol`, `scheme`, formato do
/// `data.raw` (minúsculo, `0x`+hex, ≤ 8192 chars), as regras de [`check_parsed`],
/// `type`, `fee` (tabela OU "0" — isenção é regra de estado), `from`
/// (re-derivado do signer recuperado), `to` (nulo para nativa/contrato; senão
/// `destE7For`), `data.code`/`data.to`/`data.input` conforme o tipo (byte a byte
/// contra o raw — sem isto um relay trocaria bytecode ou calldata mantendo a
/// assinatura), `amount`, `nonce` (= nonce EAVM + 1), `timestamp` (inteiro
/// seguro > 0), `data.eavmHash`/`data.eavmFrom`/`data.eavmTo`, `data.op` e `id`
/// (= `eavHash('EAV7-EAVM-TX:' + raw)`).
///
/// O que a referência NÃO compara — e portanto este porte também não:
/// `data.eavmNonce` (fica cravado indiretamente por `nonce = eavmNonce + 1`),
/// chaves EXTRAS em `data` (o id sai do raw, não do payload) e as assinaturas
/// híbridas (o envelope é autenticado pela assinatura secp256k1 do próprio raw).
pub fn verify_eavm_envelope(tx: &Tx) -> Result<(), String> {
    if tx.protocol != PROTOCOL {
        return Err("protocolo inválido".to_string());
    }
    if tx.scheme != EAVM_SCHEME {
        return Err(format!("esquema inválido (esperado {EAVM_SCHEME})"));
    }
    // `tx.data?.raw` — sem `data` como objeto, ou sem `raw` string, o JS cai na
    // mesma mensagem.
    let vazio = BTreeMap::new();
    let data = match &tx.data {
        Some(JsonValue::Map(m)) => m,
        _ => &vazio,
    };
    let raw = data_str(data, "raw").unwrap_or_default();
    // Formato do raw (`envelope.js:126`): minúsculo, `0x` + hex não vazio, e no
    // MÁXIMO 8192 caracteres — o teto anti-DoS da verificação.
    let corpo_raw = raw.strip_prefix("0x").unwrap_or("");
    let raw_ok = !corpo_raw.is_empty()
        && corpo_raw.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        && raw.len() <= MAX_RAW_CHARS;
    if !raw_ok {
        return Err("transação raw inválida".to_string());
    }

    // O `try/catch` da referência: o que LANÇA lá (decodificação, derivação E7)
    // sai daqui com o prefixo `transação EAVM inválida:`; o que RETORNA string
    // (checkParsed, comparações) sai puro. Mensagem não é consenso, mas a
    // paridade barateia depuração cruzada.
    let embrulha = |e: String| format!("transação EAVM inválida: {e}");
    let parsed = decode_raw_transaction(raw).map_err(embrulha)?;
    check_parsed(&parsed)?;

    let tipo = classify(&parsed);
    let op = tipo.op();
    if tx.tx_type != tipo.as_str() {
        return Err("tipo não corresponde à transação assinada".to_string());
    }
    // Taxa: da tabela OU "0" (conta isenta). Qual das duas vale é regra de
    // ESTADO — aqui só se fecha o conjunto (`envelope.js:136`).
    if tx.fee != tipo.fee().to_string() && tx.fee != "0" {
        return Err("taxa inválida".to_string());
    }
    if tx.from != eavm_to_e7(&parsed.from).map_err(|e| embrulha(e.to_string()))? {
        return Err("from não corresponde à assinatura recuperada".to_string());
    }
    if op.is_some() || tipo.is_contract() {
        if tx.to.is_some() {
            return Err("operação nativa ou de contrato não deve ter destino".to_string());
        }
    } else {
        // Transfer: `classify` garante `parsed.to` presente.
        let alvo = parsed.to.as_deref().unwrap_or_default();
        if tx.to.as_deref() != Some(dest_e7_for(alvo).map_err(embrulha)?.as_str()) {
            return Err("to não corresponde à transação assinada".to_string());
        }
    }

    // O que a VM vai executar tem de vir do raw ASSINADO, byte a byte. Sem isto,
    // um relay poderia trocar o bytecode ou o calldata mantendo a assinatura
    // (`envelope.js:143-154`).
    match tipo {
        EnvelopeType::Deploy => {
            if data_str(data, "code") != Some(parsed.data_hex.as_str()) {
                return Err("bytecode não corresponde ao raw assinado".to_string());
            }
            if !data_nulo_ou_ausente(data, "to") || !data_nulo_ou_ausente(data, "input") {
                return Err("deploy não deve ter destino nem input".to_string());
            }
        }
        EnvelopeType::Call => {
            let alvo = parsed.to.as_deref().unwrap_or_default().to_lowercase();
            if data_str(data, "to") != Some(alvo.as_str()) {
                return Err("destino do contrato não corresponde ao raw".to_string());
            }
            if data_str(data, "input") != Some(parsed.data_hex.as_str()) {
                return Err("calldata não corresponde ao raw assinado".to_string());
            }
            if !data_nulo_ou_ausente(data, "code") {
                return Err("chamada não deve carregar bytecode".to_string());
            }
        }
        _ => {
            if !data_nulo_ou_ausente(data, "code")
                || !data_nulo_ou_ausente(data, "to")
                || !data_nulo_ou_ausente(data, "input")
            {
                return Err("transação simples não deve carregar dados de contrato".to_string());
            }
        }
    }

    if tx.amount != (&parsed.value / BigUint::from(EAVM_WEI_PER_E7)).to_string() {
        return Err("amount não corresponde ao valor assinado".to_string());
    }
    // `tx.nonce !== parsed.nonce + 1` (`envelope.js:156`) é aritmética de DOUBLE
    // no JS. O `as f64` sobre `tx.nonce` reproduz inclusive a leitura com perda
    // que o `JSON.parse` da referência faria para um nonce acima de 2⁵³.
    if (tx.nonce as f64) != parsed.nonce + 1.0 {
        return Err("nonce não corresponde ao nonce EAVM".to_string());
    }
    // `Number.isSafeInteger(tx.timestamp) && tx.timestamp > 0` (`envelope.js:157`).
    if tx.timestamp <= 0 || tx.timestamp > MAX_SAFE_INTEGER as i64 {
        return Err("timestamp inválido".to_string());
    }
    // Metadados EAVM: comparação ESTRITA — para `eavmTo`, chave ausente NÃO é o
    // mesmo que `null` (no JS, `undefined !== null`), diferente da regra frouxa
    // de `code`/`to`/`input` acima.
    let eavm_to_confere = match (data.get("eavmTo"), &parsed.to) {
        (Some(JsonValue::Null), None) => true,
        (Some(JsonValue::Str(s)), Some(t)) => s == t,
        _ => false,
    };
    if data_str(data, "eavmHash") != Some(parsed.eavm_hash.as_str())
        || data_str(data, "eavmFrom") != Some(parsed.from.as_str())
        || !eavm_to_confere
    {
        return Err("metadados EAVM não conferem com o raw".to_string());
    }
    // `(tx.data.op ?? null) !== (op ?? null)`: ausente e `null` equivalem.
    let op_confere = match (data.get("op"), op) {
        (None | Some(JsonValue::Null), None) => true,
        (Some(JsonValue::Str(s)), Some(o)) => s == o,
        _ => false,
    };
    if !op_confere {
        return Err("operação não confere".to_string());
    }
    if tx.id.as_deref() != Some(eav_hash_one(format!("EAV7-EAVM-TX:{raw}")).as_str()) {
        return Err("id da transação não confere".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Testes unitários — RLP de ida e volta e regras locais. A conformidade com a
// referência vive em `tests/eavm_envelope.rs`, sobre `vectors/eavm-envelope.json`.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Assinatura de transação EAVM crua — `createSignedTx` (`eavm/tx.js:106-114`)
// ---------------------------------------------------------------------------
//
// A ponta que faltava: o porte sabia DECODIFICAR uma transação EVM assinada
// (`decode_raw_transaction`) e não sabia PRODUZIR uma. Quem quisesse assinar
// tinha de reimplementar RLP + EIP-155 por fora — e é exatamente o que as três
// cópias da carteira no navegador fazem hoje, cada uma por conta própria.

/// Campos de uma transação EAVM legada (tipo 0), antes de assinar.
///
/// "Legada" e "tipo 0" são a nomenclatura do ETHEREUM, e continuam sendo — o
/// formato de fio é o dele (RLP + EIP-155), e renomear um padrão externo só
/// atrapalharia quem for conferir contra a especificação. O que é nosso é a
/// máquina que executa: a EAVM.
///
/// `to: None` é IMPLANTAÇÃO de contrato — campo vazio no RLP, como no Ethereum.
/// `data` carrega o bytecode do deploy ou o calldata da chamada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TxEavm {
    pub nonce: u128,
    pub gas_price: u128,
    pub gas_limit: u128,
    /// Endereço `0x` de 20 bytes, ou `None` para deploy.
    pub to: Option<[u8; 20]>,
    pub value: u128,
    pub data: Vec<u8>,
    pub chain_id: u64,
}

/// Inteiro em RLP: big-endian MÍNIMO, e zero vira string VAZIA.
///
/// Não é detalhe estético — é consenso. `0` codificado como `0x00` produz outros
/// bytes, outro hash de assinatura e portanto outra transação. É a mesma regra
/// que `decode_raw_transaction` já exige na leitura.
fn rlp_uint(v: u128) -> Rlp {
    let bytes = v.to_be_bytes();
    let inicio = bytes.iter().position(|b| *b != 0).unwrap_or(bytes.len());
    Rlp::Bytes(bytes[inicio..].to_vec())
}

/// Assina uma transação EAVM legada com EIP-155 e devolve o `raw` `0x…`.
///
/// O `v` é `chainId * 2 + 35 + recId` (EIP-155): é ele que amarra a assinatura à
/// CADEIA. Sem isso, a mesma transação assinada valeria em qualquer rede com o
/// mesmo `chainId` ausente — que é o ataque de repetição entre cadeias que o
/// EIP-155 existe para fechar.
///
/// `chave_privada` é o escalar secp256k1 de 32 bytes.
pub fn create_signed_tx(tx: &TxEavm, chave_privada: &[u8; 32]) -> Result<String, String> {
    use k256::ecdsa::signature::hazmat::PrehashSigner;

    let campos = |extra: Vec<Rlp>| -> Rlp {
        let mut v = vec![
            rlp_uint(tx.nonce),
            rlp_uint(tx.gas_price),
            rlp_uint(tx.gas_limit),
            match tx.to {
                Some(a) => Rlp::Bytes(a.to_vec()),
                None => Rlp::Bytes(Vec::new()),
            },
            rlp_uint(tx.value),
            Rlp::Bytes(tx.data.clone()),
        ];
        v.extend(extra);
        Rlp::List(v)
    };

    // Pré-imagem da assinatura: os campos + (chainId, 0, 0) — EIP-155.
    let para_assinar = campos(vec![
        rlp_uint(u128::from(tx.chain_id)),
        Rlp::Bytes(Vec::new()),
        Rlp::Bytes(Vec::new()),
    ]);
    let digest = <sha3::Keccak256 as sha3::Digest>::digest(rlp_encode(&para_assinar));

    let chave = k256::ecdsa::SigningKey::from_bytes(chave_privada.into())
        .map_err(|e| format!("chave privada inválida: {e}"))?;
    let (assinatura, rec_id): (k256::ecdsa::Signature, k256::ecdsa::RecoveryId) = chave
        .sign_prehash(&digest)
        .map_err(|e| format!("falha ao assinar: {e}"))?;
    // `sign_prehash` do `k256` já normaliza `s` para a metade BAIXA da curva —
    // é o que o Ethereum exige (EIP-2) e o que `decode_raw_transaction` aceita.

    let v = u128::from(tx.chain_id) * 2 + 35 + u128::from(rec_id.to_byte());
    let assinada = campos(vec![
        rlp_uint(v),
        Rlp::Bytes(recorta_zeros(&assinatura.r().to_bytes())),
        Rlp::Bytes(recorta_zeros(&assinatura.s().to_bytes())),
    ]);
    Ok(format!("0x{}", hex::encode(rlp_encode(&assinada))))
}

/// Endereço EAVM (`0x…`) de uma chave PRIVADA secp256k1 — os 20 bytes finais do
/// keccak256 da chave pública não comprimida.
///
/// Vive aqui, e não em quem precisa: é a mesma regra que `decode_raw_transaction`
/// aplica ao RECUPERAR o remetente de uma assinatura. Duas versões dela fariam a
/// carteira mostrar um endereço e a rede creditar outro — e o usuário só
/// descobriria depois de mandar o dinheiro.
///
/// A FORMA do endereço é a do Ethereum, e a derivação também; o que ele endereça
/// é uma conta da EAVM. Daí o nome seguir o resto do crate (`is_eavm_address`,
/// `eavm_to_e7`, `EAVM_CHAIN_ID`) e não o `evmToE7` que a carteira do navegador
/// usa — lá o nome escorregou, e é um dos motivos de aquela cópia sair.
pub fn eavm_address_from_private(chave_privada: &[u8; 32]) -> Result<String, String> {
    let chave = k256::ecdsa::SigningKey::from_bytes(chave_privada.into())
        .map_err(|e| format!("chave privada inválida: {e}"))?;
    // `to_sec1_point(false)` = ponto NÃO comprimido, e o `[1..]` descarta o
    // prefixo `0x04`: é sobre as coordenadas X‖Y cruas que o keccak é calculado.
    // A mesma travessia de `recover_eth_address` (`eavm/host.rs`), que é como o
    // ecrecover deriva o endereço — é por isso que assinar e recuperar batem.
    let ponto = chave.verifying_key().to_sec1_point(false);
    let bytes = ponto.as_bytes();
    if bytes.len() != 65 {
        return Err("ponto SEC1 inesperado".into());
    }
    let d = <sha3::Keccak256 as sha3::Digest>::digest(&bytes[1..]);
    Ok(format!("0x{}", hex::encode(&d[12..])))
}

/// `r` e `s` entram no RLP como inteiros: sem zeros à esquerda.
fn recorta_zeros(b: &[u8]) -> Vec<u8> {
    let inicio = b.iter().position(|x| *x != 0).unwrap_or(b.len());
    b[inicio..].to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(b: &[u8]) -> Rlp {
        Rlp::Bytes(b.to_vec())
    }

    // ------------------------------------------------------------------- RLP

    #[test]
    fn rlp_ida_e_volta_cobre_todas_as_formas() {
        let casos = vec![
            bytes(&[]),                       // string vazia → 0x80
            bytes(&[0x00]),                   // byte único 0x00 → sai cru
            bytes(&[0x7f]),                   // maior byte que sai cru
            bytes(&[0x80]),                   // menor byte que exige prefixo
            bytes(&[0xab; 55]),               // limite da forma curta
            bytes(&[0xab; 56]),               // menor forma longa
            bytes(&[0xcd; 300]),              // comprimento em 2 bytes
            Rlp::List(vec![]),                // lista vazia → 0xc0
            Rlp::List(vec![bytes(b"gato"), bytes(b"cachorro")]),
            Rlp::List(vec![Rlp::List(vec![bytes(&[1]), Rlp::List(vec![])]), bytes(&[0x80])]),
            Rlp::List(vec![bytes(&[0x11; 60]); 4]), // lista na forma longa
        ];
        for caso in casos {
            let cod = rlp_encode(&caso);
            let volta = rlp_decode(&cod).unwrap_or_else(|e| panic!("decode falhou em {caso:?}: {e}"));
            assert_eq!(volta, caso, "ida e volta divergiu");
            // E a reserialização é byte a byte a mesma — canonicidade.
            assert_eq!(rlp_encode(&volta), cod);
        }
    }

    #[test]
    fn rlp_vetores_conhecidos_do_ethereum() {
        // Vetores clássicos da especificação RLP (wiki do Ethereum).
        assert_eq!(rlp_encode(&bytes(b"dog")), vec![0x83, b'd', b'o', b'g']);
        assert_eq!(
            rlp_encode(&Rlp::List(vec![bytes(b"cat"), bytes(b"dog")])),
            vec![0xc8, 0x83, b'c', b'a', b't', 0x83, b'd', b'o', b'g']
        );
        assert_eq!(rlp_encode(&bytes(&[])), vec![0x80]);
        assert_eq!(rlp_encode(&Rlp::List(vec![])), vec![0xc0]);
        assert_eq!(rlp_encode(&bytes(&[0x0f])), vec![0x0f]);
        assert_eq!(rlp_encode(&bytes(&[0x04, 0x00])), vec![0x82, 0x04, 0x00]);
    }

    #[test]
    fn rlp_rejeita_formas_nao_canonicas_e_truncadas() {
        for (nome, entrada) in [
            ("byte único reserializado como curto", vec![0x81u8, 0x05]),
            ("forma longa com comprimento < 56", vec![0xb8, 0x02, 0x61, 0x62]),
            ("comprimento com zero à esquerda", vec![0xb9, 0x00, 0x38]),
            ("lista longa com comprimento < 56", vec![0xf8, 0x01, 0x61]),
            ("string truncada", vec![0x83, 0x61]),
            ("lista truncada", vec![0xc3, 0x61]),
            ("bytes excedentes", vec![0x01, 0x02]),
            ("vazio", vec![]),
        ] {
            assert!(rlp_decode(&entrada).is_err(), "deveria rejeitar: {nome}");
        }
    }

    #[test]
    fn rlp_aninhamento_absurdo_e_erro_nao_estouro() {
        // 0xc1 encadeado: cada byte abre uma lista de 1 elemento. Sem a guarda de
        // profundidade isto seria estouro de pilha (SIGSEGV), não Err.
        let mut fundo = vec![0xc1u8; 5000];
        fundo.push(0xc0);
        assert!(rlp_decode(&fundo).is_err());
    }

    // ------------------------------------------- strictInt / decode negativos

    /// Raw legacy EIP-155 sintético com zero à esquerda em `r`: os vetores só
    /// têm casos positivos, então o negativo de maleabilidade é montado aqui a
    /// partir da RE-CODIFICAÇÃO de um raw válido do próprio vetor.
    const RAW_VALIDO: &str = "0xf86d80856edf2a079e832dc6c094777777777777777777777777777777777777777785e8d4a5100080830232cba0550fe727de2fb864a6f1691e38476cbdd7b86973635bfa6d2805b53368f9bcf5a04d6f03ff12fca1087dc6788278005ae289208039a985f043b8436ae2a8c06952";

    fn remonta_com(muda: impl Fn(&mut Vec<Rlp>)) -> String {
        let raw = decode_hex_como_node(&RAW_VALIDO[2..]);
        let Ok(Rlp::List(mut itens)) = rlp_decode(&raw) else {
            panic!("raw do vetor tem de decodificar");
        };
        muda(&mut itens);
        format!("0x{}", hex::encode(rlp_encode(&Rlp::List(itens))))
    }

    #[test]
    fn zero_a_esquerda_em_r_e_rejeitado_maleabilidade() {
        // Pad de 0x00 em `r`: mesmo signer, raw diferente → outro id. É o achado
        // de maleabilidade que `strictInt` fecha (`tx.js:10-14`).
        let adulterado = remonta_com(|itens| {
            let Rlp::Bytes(r) = &mut itens[7] else { panic!("r é bytes") };
            r.insert(0, 0x00);
        });
        let erro = decode_raw_transaction(&adulterado).expect_err("zero à esquerda tem de falhar");
        assert!(erro.contains("zero à esquerda"), "erro inesperado: {erro}");
        // E o original continua decodificando — o teste pega a regra, não o setup.
        assert!(decode_raw_transaction(RAW_VALIDO).is_ok());
    }

    #[test]
    fn zero_a_esquerda_em_value_e_rejeitado() {
        let adulterado = remonta_com(|itens| {
            let Rlp::Bytes(v) = &mut itens[4] else { panic!("value é bytes") };
            v.insert(0, 0x00);
        });
        assert!(decode_raw_transaction(&adulterado).is_err());
    }

    #[test]
    fn chain_id_errado_e_rejeitado_pelo_check() {
        // v = chainId*2 + 35 + recId. Trocar o v muda o chainId percebido; a
        // assinatura pode até recuperar OUTRO signer (o hash muda), mas o
        // checkParsed tem de barrar antes de qualquer uso.
        let adulterado = remonta_com(|itens| {
            // chainId 72021 com recId 0 → v = 144077 = 0x0232cd
            itens[6] = Rlp::Bytes(vec![0x02, 0x32, 0xcd]);
        });
        // Se a decodificação passar, o `check_parsed` tem de barrar. Também é
        // aceitável ela falhar antes (o hash de assinatura mudou e a recuperação
        // não fecha) — o que importa é REJEITAR nos dois caminhos.
        if let Ok(parsed) = decode_raw_transaction(&adulterado) {
            assert_eq!(parsed.chain_id, Some(BigUint::from(72021u32)));
            let erro = check_parsed(&parsed).expect_err("chainId errado tem de falhar");
            assert!(erro.contains("chainId incorreto"), "erro inesperado: {erro}");
        }
        // E o construtor rejeita de ponta a ponta.
        assert!(build_eavm_envelope(&adulterado, 1, |_| false).is_err());
    }

    #[test]
    fn s_alto_e_rejeitado_eip2() {
        // s' = n − s: assinatura algebricamente válida do MESMO corpo — a segunda
        // metade da anti-maleabilidade. (O v/recId não é ajustado de propósito:
        // a regra EIP-2 barra ANTES da recuperação.)
        let n = BigUint::from_bytes_be(&SECP256K1_N);
        let adulterado = remonta_com(|itens| {
            let Rlp::Bytes(s) = &itens[8] else { panic!("s é bytes") };
            let s_alto = &n - BigUint::from_bytes_be(s);
            itens[8] = Rlp::Bytes(s_alto.to_bytes_be());
        });
        let erro = decode_raw_transaction(&adulterado).expect_err("s alto tem de falhar");
        assert!(erro.contains("s alto"), "erro inesperado: {erro}");
    }

    #[test]
    fn tipo_evm_desconhecido_e_rejeitado_com_a_mensagem_do_js() {
        // 0x01 (EIP-2930) não é suportado — nem qualquer prefixo < 0xc0 ≠ 0x02.
        // A mensagem usa `toString(16)`: minúsculo, sem zero à esquerda.
        assert_eq!(
            decode_raw_transaction("0x01c0"),
            Err("tipo de transação EVM não suportado: 0x1".to_string())
        );
        assert_eq!(
            decode_raw_transaction("0x03c0"),
            Err("tipo de transação EVM não suportado: 0x3".to_string())
        );
    }

    #[test]
    fn hex_invalido_e_rejeitado_com_a_mensagem_do_js() {
        for raw in ["", "0x", "0xa", "0xzz", "f86d", "0x 12"] {
            assert_eq!(
                decode_raw_transaction(raw),
                Err("transação raw deve ser hex 0x".to_string()),
                "raw: {raw:?}"
            );
        }
    }

    #[test]
    fn truncamentos_dao_as_mensagens_exatas_do_js() {
        // Raw válido sem os últimos bytes: a moldura externa é uma lista.
        assert_eq!(
            decode_raw_transaction(&RAW_VALIDO[..RAW_VALIDO.len() - 8]),
            Err("RLP: lista truncada".to_string())
        );
        // Bytes sobrando depois do item (`rlp.js:38`).
        assert_eq!(
            decode_raw_transaction(&format!("{RAW_VALIDO}00")),
            Err("RLP: bytes excedentes após o item".to_string())
        );
        // Lista legacy com 8 itens (`tx.js:50`).
        let oito = Rlp::List(vec![Rlp::Bytes(vec![1]); 8]);
        assert_eq!(
            decode_raw_transaction(&format!("0x{}", hex::encode(rlp_encode(&oito)))),
            Err("transação legacy malformada".to_string())
        );
        // Tipo 2 com 11 itens (`tx.js:34`).
        let onze = Rlp::List(vec![Rlp::Bytes(vec![1]); 11]);
        assert_eq!(
            decode_raw_transaction(&format!("0x02{}", hex::encode(rlp_encode(&onze)))),
            Err("transação tipo 2 malformada".to_string())
        );
    }

    #[test]
    fn nibble_impar_e_truncado_como_no_node() {
        // Conformidade bug-a-bug com `Buffer.from(hex, 'hex')`: o nibble final
        // solto é descartado, então o raw com um hexadecimal a mais decodifica
        // IGUAL ao original (ver o relatório de maleabilidade de id no porte).
        let com_nibble = format!("{RAW_VALIDO}a");
        let a = decode_raw_transaction(RAW_VALIDO).expect("original decodifica");
        let b = decode_raw_transaction(&com_nibble).expect("nibble solto é ignorado");
        assert_eq!(a, b);
    }

    // ----------------------------------------------- verificação do envelope

    #[test]
    fn envelope_construido_verifica() {
        let tx = build_eavm_envelope(RAW_VALIDO, 1_700_000_000_000, |_| false).expect("constrói");
        assert_eq!(verify_eavm_envelope(&tx), Ok(()));
        // E a rota de `verify_transaction` delega para cá.
        assert_eq!(crate::transaction::verify_transaction(&tx), Ok(()));
    }

    #[test]
    fn envelope_isento_de_taxa_tambem_verifica() {
        let tx = build_eavm_envelope(RAW_VALIDO, 1_700_000_000_000, |_| true).expect("constrói");
        assert_eq!(tx.fee, "0");
        assert_eq!(verify_eavm_envelope(&tx), Ok(()));
    }

    #[test]
    fn envelope_adulterado_nunca_passa() {
        let base = build_eavm_envelope(RAW_VALIDO, 1_700_000_000_000, |_| false).expect("constrói");
        type Mutacao = Box<dyn Fn(&mut Tx)>;
        let muda_data = |tx: &mut Tx, chave: &str, valor: JsonValue| {
            let Some(JsonValue::Map(m)) = &mut tx.data else { panic!("data é mapa") };
            m.insert(chave.to_string(), valor);
        };
        let casos: Vec<(&str, Mutacao)> = vec![
            ("tipo trocado", Box::new(|t| t.tx_type = "STAKE".into())),
            ("from trocado", Box::new(|t| t.from = "E70000000000000000000000000000FFFF".into())),
            ("to trocado", Box::new(|t| t.to = None)),
            ("amount inflado", Box::new(|t| t.amount = "2".into())),
            ("taxa fora da tabela", Box::new(|t| t.fee = "1".into())),
            ("nonce fora do passo", Box::new(|t| t.nonce += 1)),
            ("timestamp nulo", Box::new(|t| t.timestamp = 0)),
            ("id forjado", Box::new(|t| t.id = Some("0".repeat(64)))),
            ("eavmFrom trocado", Box::new(move |t| {
                muda_data(t, "eavmFrom", JsonValue::str("0x0000000000000000000000000000000000000001"));
            })),
            ("eavmHash trocado", Box::new(move |t| {
                muda_data(t, "eavmHash", JsonValue::str(format!("0x{}", "0".repeat(64))));
            })),
            ("op inventada", Box::new(move |t| muda_data(t, "op", JsonValue::str("STAKE")))),
            ("input contrabandeado", Box::new(move |t| {
                muda_data(t, "input", JsonValue::str("0xdeadbeef"));
            })),
            ("raw trocado por outro válido", Box::new(move |t| {
                // Raw do caso STAKE do vetor: decodifica, mas não bate com NADA
                // deste envelope de transferência.
                muda_data(t, "raw", JsonValue::str(
                    "0xf86e02856edf2a079e832dc6c094000000000000000000000000000000000000700186048c2739500080830232cba0ab15f1d617e3e5f8063673b8155a9eedd48c6970be74f1a9d459bbdb50b78f23a05c52f3599a04343ef66216bfae5d899da042c31f4dff0a8ef132637e98e8c37f",
                ));
            })),
            ("raw em maiúsculas", Box::new(move |t| {
                muda_data(t, "raw", JsonValue::str(RAW_VALIDO.to_uppercase()));
            })),
            ("esquema errado", Box::new(|t| t.scheme = "eav7-hybrid-1".into())),
            ("protocolo errado", Box::new(|t| t.protocol = "eav19".into())),
        ];
        for (nome, muta) in casos {
            let mut tx = base.clone();
            muta(&mut tx);
            assert!(verify_eavm_envelope(&tx).is_err(), "deveria rejeitar: {nome}");
        }
        // O original continua passando — as mutações eram a única causa.
        assert_eq!(verify_eavm_envelope(&base), Ok(()));
    }

    #[test]
    fn eavm_to_ausente_e_diferente_de_nulo() {
        // Semântica estrita do JS: `undefined !== null`. Remover a chave eavmTo
        // de um deploy (onde parsed.to é null) tem de FALHAR.
        let raw_deploy = "0xf86803856edf2a079e832dc6c08080946008600c60003960086000f360aa60006000a100830232cca095a804c82a15a796ff6de43e80dba629cbc90e11e8bda49c652d6c37aad1eda5a01bb48f2fa6465ded572f8c24d69f4e7ab14b8be934faa9938a3e0df66656112c";
        let mut tx = build_eavm_envelope(raw_deploy, 1, |_| false).expect("constrói");
        assert_eq!(verify_eavm_envelope(&tx), Ok(()));
        let Some(JsonValue::Map(m)) = &mut tx.data else { panic!("data é mapa") };
        m.remove("eavmTo");
        assert!(verify_eavm_envelope(&tx).is_err());
    }

    #[test]
    fn op_ausente_equivale_a_nulo() {
        // A regra frouxa do `??`: remover a chave `op` de uma transferência
        // (op nulo) continua VÁLIDO — como no JS.
        let mut tx = build_eavm_envelope(RAW_VALIDO, 1, |_| false).expect("constrói");
        let Some(JsonValue::Map(m)) = &mut tx.data else { panic!("data é mapa") };
        m.remove("op");
        assert_eq!(verify_eavm_envelope(&tx), Ok(()));
    }

    // --------------------------------------- s alto: a equivalência matemática

    /// Reconstrói (hash de assinatura, r, s, recId) do raw legacy EIP-155 do
    /// vetor — os mesmos passos de `decodeRawTransaction`, expostos para os
    /// testes de recuperação.
    fn assinatura_do_raw(raw_hex: &str) -> ([u8; 32], BigUint, BigUint, u8) {
        let raw = decode_hex_como_node(&raw_hex[2..]);
        let Ok(Rlp::List(itens)) = rlp_decode(&raw) else {
            panic!("raw do vetor tem de decodificar");
        };
        let v = strict_int(&itens[6], "v").expect("v");
        let r = strict_int(&itens[7], "r").expect("r");
        let s = strict_int(&itens[8], "s").expect("s");
        let base = &v - BigUint::from(35u8);
        let cid = &base / 2u8;
        let rec_id = u8::try_from(&(&base % 2u8)).expect("recId 0/1");
        let mut pre: Vec<Rlp> = itens[..6].to_vec();
        pre.push(Rlp::Bytes(biguint_to_min_bytes(&cid)));
        pre.push(Rlp::Bytes(Vec::new()));
        pre.push(Rlp::Bytes(Vec::new()));
        let hash: [u8; 32] = Keccak256::digest(rlp_encode(&Rlp::List(pre))).into();
        (hash, r, s, rec_id)
    }

    #[test]
    fn high_s_normalizado_com_recid_invertido_recupera_a_mesma_chave() {
        // O fato verificado empiricamente NESTE projeto, fixado em teste (ver a
        // nota longa do `ecrecover` em host.rs): a forma alta `(r, n−s)` com
        // `recId ^ 1` é a MESMA assinatura — negar `s` nega o ponto `R`, o que
        // inverte a paridade de `R.y`, isto é, o bit 0 do recId.
        let (hash, r, s_baixo, rec) = assinatura_do_raw(RAW_VALIDO);
        let n = BigUint::from_bytes_be(&SECP256K1_N);
        let esperado = decode_raw_transaction(RAW_VALIDO).expect("decodifica").from;

        // 1. A forma baixa com o recId do raw recupera o signer do vetor.
        let baixo = recover_eth_address(&hash, &r, &s_baixo, rec).expect("forma baixa");
        assert_eq!(hex0x(&baixo), esperado, "forma baixa tem de dar o recoveredFrom do vetor");

        // 2. A forma ALTA equivalente (como ~52% das carteiras reais emitem, com
        //    o recId DELA) recupera a MESMA chave — a recuperação em si aceita
        //    `s` alto; é a regra EIP-2 do decode que o rejeita antes.
        let s_alto = &n - &s_baixo;
        let alto = recover_eth_address(&hash, &r, &s_alto, rec ^ 1).expect("forma alta");
        assert_eq!(hex0x(&alto), esperado, "(r, n−s, recId^1) é a MESMA assinatura");

        // 3. A ARMADILHA: normalizar o `s` SEM inverter o recId recupera OUTRO
        //    endereço válido-aparente — o bug silencioso que a nota do host.rs
        //    documenta. (Equivale a usar a forma baixa com o recId da alta.)
        let errado = recover_eth_address(&hash, &r, &s_baixo, rec ^ 1)
            .expect("também recupera — e é isso que torna o erro silencioso");
        assert_ne!(hex0x(&errado), esperado, "sem inverter o recId o endereço MUDA");
    }

    #[test]
    fn pre_eip155_segue_a_ordem_de_erros_do_js() {
        // v = 26 (< 27): no JS o recId fica NEGATIVO e a recuperação falha — mas
        // SÓ depois da regra EIP-2, porque o throw de s alto vem antes
        // (`tx.js:71` vs `tx.js:72-73`). As duas mensagens, na ordem certa:
        let n = BigUint::from_bytes_be(&SECP256K1_N);
        let v26 = remonta_com(|itens| itens[6] = Rlp::Bytes(vec![26]));
        assert_eq!(
            decode_raw_transaction(&v26),
            Err("assinatura EVM inválida (recuperação de chave falhou)".to_string())
        );
        let v26_s_alto = remonta_com(|itens| {
            itens[6] = Rlp::Bytes(vec![26]);
            let Rlp::Bytes(s) = &itens[8] else { panic!("s é bytes") };
            itens[8] = Rlp::Bytes((&n - BigUint::from_bytes_be(s)).to_bytes_be());
        });
        assert_eq!(
            decode_raw_transaction(&v26_s_alto),
            Err("assinatura com s alto rejeitada (EIP-2)".to_string()),
            "com v inválido E s alto, o erro do JS é o do EIP-2 — a ordem importa"
        );
    }

    // ------------------------------- quirks de coerção do parser da referência

    #[test]
    fn campo_como_lista_e_rejeitado_pela_guarda_com_a_mensagem_do_js() {
        // A guarda de `tx.js:78-82`: lista em qualquer um dos oito campos é
        // rejeitada com a mensagem exata — inclusive a lista VAZIA em `to`, que
        // antes da guarda valeria destino nulo (= implantação) em silêncio.
        let to_lista = remonta_com(|itens| itens[3] = Rlp::List(vec![]));
        assert_eq!(
            decode_raw_transaction(&to_lista),
            Err("RLP: campo `to` deve ser byte string, não lista".to_string())
        );
        let data_lista = remonta_com(|itens| {
            itens[5] = Rlp::List(vec![Rlp::Bytes(b"ab".to_vec())]);
        });
        assert_eq!(
            decode_raw_transaction(&data_lista),
            Err("RLP: campo `data` deve ser byte string, não lista".to_string())
        );
        // Campo numérico com join HEXADECIMAL passa pelo strictInt (coerção do
        // V8 dá 0xab) e morre na guarda, com o nome do campo.
        let nonce_lista = remonta_com(|itens| {
            itens[0] = Rlp::List(vec![Rlp::Bytes(b"ab".to_vec())]);
        });
        assert_eq!(
            decode_raw_transaction(&nonce_lista),
            Err("RLP: campo `nonce` deve ser byte string, não lista".to_string())
        );
    }

    #[test]
    fn coercao_do_strict_int_tem_precedencia_sobre_a_guarda() {
        // A ORDEM dos erros é a do JS: os `strictInt` rodam ANTES da guarda de
        // tipo, e a coerção deles sobre um Array é a do V8 (`rlp.js:93`):
        // `BigInt('0x' + Array.prototype.toString())`.
        assert_eq!(
            rlp_item_to_bigint(&Rlp::List(vec![Rlp::Bytes(b"ab".to_vec())])),
            Ok(BigUint::from(0xabu32)),
            "join hexadecimal COAGE como número na fase do strictInt"
        );
        assert_eq!(
            rlp_item_to_bigint(&Rlp::List(vec![Rlp::Bytes(b"zz".to_vec())])),
            Err("Cannot convert 0xzz to a BigInt".to_string())
        );
        // Lista VAZIA vale 0 nessa fase (`buf.length === 0` — `rlp.js:93`).
        assert_eq!(rlp_item_to_bigint(&Rlp::List(vec![])), Ok(BigUint::from(0u8)));
        // `strictInt` sobre lista NÃO acusa zero à esquerda: no JS `buf[0]` é um
        // objeto (Buffer), nunca `=== 0` — a coerção decide.
        assert_eq!(
            strict_int(&Rlp::List(vec![Rlp::Bytes(b"0ab".to_vec())]), "nonce"),
            Ok(BigUint::from(0xabu32))
        );
        // Ponta a ponta: nonce como lista NÃO-hex morre no strictInt, com a
        // mensagem do V8 — NÃO com a da guarda (que só roda depois).
        let nonce_lixo = remonta_com(|itens| {
            itens[0] = Rlp::List(vec![Rlp::Bytes(b"xy".to_vec())]);
        });
        assert_eq!(
            decode_raw_transaction(&nonce_lixo),
            Err("Cannot convert 0xxy to a BigInt".to_string())
        );
    }

    #[test]
    fn nonce_e_comparado_em_double_como_no_js() {
        // `Number(bigint)` arredonda acima de 2⁵³ — e `biguint_to_f64` tem de
        // arredondar IGUAL (round-to-nearest): 2⁵³ + 1 vira 2⁵³.
        let dois_53 = BigUint::from(1u128 << 53);
        assert_eq!(biguint_to_f64(&dois_53), 9007199254740992.0);
        assert_eq!(biguint_to_f64(&(&dois_53 + 1u8)), 9007199254740992.0, "arredonda como o V8");
        assert_eq!(biguint_to_f64(&(&dois_53 + 2u8)), 9007199254740994.0);
    }
    /// O vetor de DoS que o teto de profundidade fecha: RLP fundo pelo RPC público.
    ///
    /// `eth_sendRawTransaction` chama `build_eavm_envelope` sem autenticação. Com
    /// `MAX_RLP_DEPTH = 4096`, ~24 KB de hexadecimal aninhado consumiam mais de um
    /// megabyte de pilha — acima do orçamento de uma worker do tokio — e o processo
    /// ABORTAVA (em Rust o estouro de pilha é SIGABRT, não exceção capturável).
    /// Aqui o aninhamento fundo vira `Err` bem antes de custar pilha.
    #[test]
    fn rlp_fundo_e_recusado_sem_estourar_a_pilha() {
        // Lista aninhada: cada nível é uma lista de um elemento. `0xc1` = lista de
        // 1 byte de conteúdo; o conteúdo é o nível seguinte.
        // Cada nível envolve o anterior numa lista. O prefixo curto (0xc0+n) só
        // vale até 55 bytes de conteúdo; acima disso o RLP usa a forma longa
        // (0xf7+len_bytes), e é ela que o aninhamento fundo exige.
        let mut bytes = vec![0x80u8]; // string vazia no fundo
        for _ in 0..(MAX_RLP_DEPTH + 10) {
            let n = bytes.len();
            let mut nivel = if n <= 55 {
                vec![0xc0 + n as u8]
            } else {
                let comp = n.to_be_bytes();
                let significativos: Vec<u8> =
                    comp.iter().copied().skip_while(|b| *b == 0).collect();
                let mut cab = vec![0xf7 + significativos.len() as u8];
                cab.extend_from_slice(&significativos);
                cab
            };
            nivel.extend_from_slice(&bytes);
            bytes = nivel;
        }
        let erro = rlp_decode(&bytes).expect_err("aninhamento fundo tem de ser recusado");
        assert!(erro.contains("aninhamento"), "a mensagem deve citar o aninhamento: {erro}");

        // E o que uma transação legítima usa (2 níveis) continua passando.
        let raso = vec![0xc2, 0xc1, 0x80];
        assert!(rlp_decode(&raso).is_ok(), "aninhamento legítimo não pode ser afetado");
    }

    /// O teto de tamanho vale na CONSTRUÇÃO, não só na verificação.
    ///
    /// `build_eavm_envelope` é o que o `eth_sendRawTransaction` chama; o teto
    /// ficava só em `verify_eavm_envelope`, então o caminho exposto ao RPC público
    /// era justamente o sem limite.
    #[test]
    fn build_recusa_raw_acima_do_teto() {
        let gigante = format!("0x{}", "ab".repeat(MAX_RAW_CHARS));
        assert!(gigante.len() > MAX_RAW_CHARS);
        assert!(
            build_eavm_envelope(&gigante, 1_700_000_000_000, |_| false).is_err(),
            "raw acima do teto não pode nem ser construído"
        );
    }


    /// A isenção é decidida pelo REMETENTE — o predicado recebe o E7 derivado do
    /// raw, não um `bool` fixo do chamador.
    ///
    /// É a razão de a assinatura ter mudado: com `bool`, quem chama teria de
    /// saber o remetente ANTES de decodificar o raw, o que ninguém sabe — e o
    /// resultado prático era `false` em todo lugar.
    #[test]
    fn a_isencao_de_taxa_e_decidida_pelo_remetente_derivado_do_raw() {
        let visto = std::cell::RefCell::new(Vec::new());
        let tx = build_eavm_envelope(RAW_VALIDO, 1_700_000_000_000, |de| {
            visto.borrow_mut().push(de.to_string());
            true
        })
        .expect("constrói");
        let de = visto.into_inner();
        assert_eq!(de.len(), 1, "o predicado é consultado uma vez, com o remetente");
        assert!(de[0].starts_with("E7"), "recebe o E7 derivado do raw: {}", de[0]);
        assert_eq!(tx.from, de[0], "e é EXATAMENTE o remetente do envelope");
        assert_eq!(tx.fee, "0", "remetente isento → teto de queima zero");
    }

    // ----------------------------------------------- assinatura de tx EAVM

    /// A transação que a lib ASSINA é aceita pelo decodificador da própria lib —
    /// e o remetente recuperado é o dono da chave.
    ///
    /// É o círculo que faltava: o porte sabia ler transação EAVM e não sabia
    /// produzir uma. Sem este caminho, quem precisasse assinar reimplementaria
    /// RLP + EIP-155 por fora — que é o que as cópias da carteira no navegador
    /// fazem hoje, cada uma por conta própria.
    #[test]
    fn transacao_eavm_assinada_pela_lib_e_decodificada_pela_lib() {
        let chave = [7u8; 32];
        let tx = TxEavm {
            nonce: 3,
            gas_price: 476_190_476_190,
            gas_limit: 21_000,
            to: Some([0x77; 20]),
            value: 1_000_000_000_000,
            data: Vec::new(),
            chain_id: crate::config::EAVM_CHAIN_ID,
        };

        let raw = create_signed_tx(&tx, &chave).expect("assina");
        assert!(raw.starts_with("0x"));

        let lida = decode_raw_transaction(&raw).expect("a própria lib tem de conseguir ler");
        assert_eq!(lida.nonce, 3.0);
        assert_eq!(lida.value.to_string(), tx.value.to_string());
        assert_eq!(
            lida.chain_id.map(|c| c.to_string()),
            Some(crate::config::EAVM_CHAIN_ID.to_string())
        );
        assert_eq!(lida.to.as_deref(), Some(format!("0x{}", "77".repeat(20)).as_str()));

        // O remetente recuperado é quem tem a chave — é isso que a assinatura prova.
        // Assinar de novo com OUTRA chave tem de dar outro remetente.
        let outra = create_signed_tx(&tx, &[8u8; 32]).expect("assina");
        let lida2 = decode_raw_transaction(&outra).expect("lê");
        assert_ne!(
            lida.from, lida2.from,
            "chaves diferentes têm de recuperar remetentes diferentes"
        );
        assert!(lida.from.starts_with("0x") && lida.from.len() == 42);
    }

    /// Zero em RLP é string VAZIA, não `0x00`.
    ///
    /// Não é estética: a forma errada muda os bytes, o hash de assinatura e
    /// portanto a transação inteira. Uma transação com `value: 0` — toda chamada
    /// de contrato sem valor — passaria a ser outra.
    #[test]
    fn zero_em_rlp_e_string_vazia() {
        assert_eq!(rlp_uint(0), Rlp::Bytes(Vec::new()));
        assert_eq!(rlp_uint(1), Rlp::Bytes(vec![1]));
        assert_eq!(rlp_uint(256), Rlp::Bytes(vec![1, 0]));

        // E a transação com valor zero continua legível.
        let raw = create_signed_tx(
            &TxEavm {
                nonce: 0,
                gas_price: 1,
                gas_limit: 21_000,
                to: Some([0x11; 20]),
                value: 0,
                data: Vec::new(),
                chain_id: crate::config::EAVM_CHAIN_ID,
            },
            &[9u8; 32],
        )
        .expect("assina");
        let lida = decode_raw_transaction(&raw).expect("lê");
        assert_eq!(lida.value.to_string(), "0");
        assert_eq!(lida.nonce, 0.0);
    }

    /// Sem `to` é DEPLOY: campo vazio no RLP, e o decodificador devolve `None`.
    #[test]
    fn transacao_sem_destino_e_deploy() {
        let raw = create_signed_tx(
            &TxEavm {
                nonce: 1,
                gas_price: 1,
                gas_limit: 100_000,
                to: None,
                value: 0,
                data: vec![0x60, 0x00],
                chain_id: crate::config::EAVM_CHAIN_ID,
            },
            &[5u8; 32],
        )
        .expect("assina");
        let lida = decode_raw_transaction(&raw).expect("lê");
        assert_eq!(lida.to, None, "deploy não tem destino");
        assert_eq!(lida.data_hex, "0x6000");
    }

    /// O `chainId` entra na assinatura (EIP-155): mudá-lo muda a transação.
    ///
    /// É o que impede repetir numa rede a transação assinada para outra.
    #[test]
    fn chain_id_diferente_produz_transacao_diferente() {
        let base = |chain_id: u64| TxEavm {
            nonce: 1,
            gas_price: 1,
            gas_limit: 21_000,
            to: Some([0x22; 20]),
            value: 5,
            data: Vec::new(),
            chain_id,
        };
        let a = create_signed_tx(&base(crate::config::EAVM_CHAIN_ID), &[3u8; 32]).expect("assina");
        let b = create_signed_tx(&base(1), &[3u8; 32]).expect("assina");
        assert_ne!(a, b, "a mesma transação em outra cadeia tem de ser outra transação");
    }

    /// A transação assinada pela lib é ACEITA e recupera o MESMO remetente que a
    /// da referência — que é a equivalência que existe para ser verificada.
    ///
    /// NÃO é byte a byte, e não pode ser: a referência usa nonce ECDSA
    /// ALEATÓRIO (`randomBytes` em `secp256k1.js:148`), então duas assinaturas
    /// da mesma transação com a mesma chave já diferem entre si. A lib usa RFC
    /// 6979 (determinístico), o que é estritamente melhor — mas torna qualquer
    /// comparação de bytes sem sentido.
    ///
    /// O que TEM de bater é o que a rede enxerga: o remetente recuperado, o
    /// destino, o valor e a cadeia. O vetor abaixo veio do cliente JS.
    #[test]
    fn assinatura_eavm_recupera_o_mesmo_remetente_da_referencia() {
        // node: createSignedTx({ privateKey: BigInt('0x' + '07'.repeat(32)),
        //   nonce: 3, to: '0x'+'77'.repeat(20), valueWei: 1000000000000n,
        //   chainId: 72020, gasPriceWei: 476190476190n, gasLimit: 21000n })
        const DA_REFERENCIA: &str = concat!(
            "0xf86c03856edf2a079e82520894777777777777777777777777777777777777777785e8d4a51000",
            "80830232cca066f870c456535b563ba4da210ceee54ec106d01d057839b75975f0220bdb0423a03c",
            "49b78983d2cc7603b89bee32bf3e7c2a44b405256c7855709e8dc8486b254c"
        );

        let nossa = create_signed_tx(
            &TxEavm {
                nonce: 3,
                gas_price: 476_190_476_190,
                gas_limit: 21_000,
                to: Some([0x77; 20]),
                value: 1_000_000_000_000,
                data: Vec::new(),
                chain_id: 72_020,
            },
            &[7u8; 32],
        )
        .expect("assina");

        let deles = decode_raw_transaction(DA_REFERENCIA).expect("a nossa lib lê a deles");
        let nossa = decode_raw_transaction(&nossa).expect("e lê a nossa");

        assert_eq!(nossa.from, deles.from, "o remetente recuperado tem de ser o mesmo");
        assert_eq!(nossa.to, deles.to);
        assert_eq!(nossa.value.to_string(), deles.value.to_string());
        assert_eq!(nossa.nonce, deles.nonce);
        assert_eq!(
            nossa.chain_id.map(|c| c.to_string()),
            deles.chain_id.map(|c| c.to_string())
        );
    }
}
