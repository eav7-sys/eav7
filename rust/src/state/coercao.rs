//! Coerções da REFERÊNCIA — o que o JavaScript faz ao ler entrada de terceiros.
//!
//! # Por que reproduzir, e não "melhorar"
//!
//! O porte nasceu sistematicamente MAIS ESTRITO que a referência: casava tipo
//! exato onde o JS coage (`String()`, `Number()`, `??`), e usava `str::trim`
//! onde o JS usa `String.prototype.trim`. Vários comentários chamavam isso de "o
//! lado seguro".
//!
//! Em consenso não é. Cada ponto em que este cliente recusa o que a rede aceita
//! é uma CISÃO — e sempre na direção pior: o nó Rust para enquanto a rede segue.
//! A segurança de uma blockchain vem das regras de validação, não da estritez do
//! parser; um valor que a referência aceita já é, por definição, válido na rede.
//!
//! Este módulo concentra essas coerções para que fiquem num lugar só, testadas
//! contra o comportamento real do Node, em vez de reimplementadas caso a caso.

/// `String.prototype.trim` do JS.
///
/// Não é `str::trim`: os conjuntos DIFEREM. O JS apara `\u{feff}` (BOM) e o Rust
/// não; o Rust apara `\u{85}` (NEL) e o JS não. A diferença é observável porque o
/// valor APARADO é o que fica gravado no estado — logo, na folha do `stateRoot`.
///
/// Um nome de token como `"\u{feff}Foo"` ilustra: a referência grava `"Foo"`,
/// um `str::trim` gravaria `"\u{feff}Foo"`, e as duas folhas `tok` diferem.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| {
        matches!(c, '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | '\u{feff}' | '\u{2028}' | '\u{2029}')
            // WhiteSpace do JS = <TAB><VT><FF><ZWNBSP> + categoria Space_Separator.
            || matches!(c, ' ' | '\u{a0}' | '\u{1680}' | '\u{202f}' | '\u{205f}' | '\u{3000}')
            || ('\u{2000}'..='\u{200a}').contains(&c)
    })
}

/// `Number(x)` do JS, restrito a INTEIRO SEGURO — o par `Number(v)` +
/// `Number.isSafeInteger(n)` que a referência usa para validar campos numéricos.
///
/// `None` quando o JS produziria `NaN`, `Infinity`, fração, ou valor fora de 2⁵³
/// (ou seja, quando `Number.isSafeInteger` daria `false`). Casos que ele ACEITA e
/// um parser estrito recusaria — cada um foi conferido contra o Node:
///
/// | entrada  | `Number` | por quê |
/// |----------|----------|---------|
/// | `"3.0"`  | `3`      | fração nula ainda é inteiro |
/// | `" 3 "`  | `3`      | apara espaço em volta |
/// | `"0x10"` | `16`     | prefixo hexadecimal |
/// | `"0b11"` | `3`      | binário |
/// | `"0o17"` | `15`     | octal |
/// | `"1e2"`  | `100`    | notação científica |
/// | `""`     | `0`      | string VAZIA vira zero, não erro |
///
/// O último é o mais surpreendente e o mais fácil de errar: um campo presente e
/// vazio vale `0` na referência.
pub fn js_number_seguro(texto: &str) -> Option<i64> {
    // `Number` apara com o MESMO conjunto do `trim` (inclui BOM).
    let t = js_trim(texto);
    // `Number("")` é 0 — e `Number("   ")` também, porque apara antes.
    if t.is_empty() {
        return Some(0);
    }
    // Bases explícitas: o sinal NÃO é aceito junto do prefixo (`Number("-0x10")`
    // é NaN), então a checagem vem antes de qualquer tratamento de sinal.
    let base = |p: &str, radix: u32| -> Option<i64> {
        t.strip_prefix(p)
            .or_else(|| t.strip_prefix(&p.to_uppercase()))
            .filter(|corpo| !corpo.is_empty())
            .and_then(|corpo| i64::from_str_radix(corpo, radix).ok())
    };
    if t.starts_with("0x") || t.starts_with("0X") {
        return base("0x", 16);
    }
    if t.starts_with("0b") || t.starts_with("0B") {
        return base("0b", 2);
    }
    if t.starts_with("0o") || t.starts_with("0O") {
        return base("0o", 8);
    }
    // Decimal, científica e fração passam pelo parser de float — que é o que o
    // `Number` faz. `Infinity`/`NaN` caem no teste de finitude logo abaixo.
    let n: f64 = t.parse().ok()?;
    // `Number.isSafeInteger`: finito, sem fração, e dentro de ±(2⁵³−1).
    if !n.is_finite() || n.fract() != 0.0 || n.abs() > 9_007_199_254_740_991.0 {
        return None;
    }
    Some(n as i64)
}

/// `BigInt(x)` do JS. Difere de `Number` em dois pontos que importam:
/// **rejeita fração** (`BigInt("3.0")` lança) e não tem teto de 2⁵³.
///
/// Aceita, como o Node: decimal, `0x`/`0b`/`0o`, espaço em volta, e string vazia
/// (que vale `0`). `None` = o `BigInt` lançaria.
pub fn js_bigint(texto: &str) -> Option<i128> {
    let t = js_trim(texto);
    if t.is_empty() {
        return Some(0);
    }
    let base = |p: &str, radix: u32| -> Option<i128> {
        t.strip_prefix(p)
            .or_else(|| t.strip_prefix(&p.to_uppercase()))
            .filter(|corpo| !corpo.is_empty())
            .and_then(|corpo| i128::from_str_radix(corpo, radix).ok())
    };
    if t.starts_with("0x") || t.starts_with("0X") {
        return base("0x", 16);
    }
    if t.starts_with("0b") || t.starts_with("0B") {
        return base("0b", 2);
    }
    if t.starts_with("0o") || t.starts_with("0O") {
        return base("0o", 8);
    }
    // Decimal puro apenas — `BigInt` NÃO aceita fração nem científica.
    let corpo = t.strip_prefix(['-', '+']).unwrap_or(t);
    if corpo.is_empty() || !corpo.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    t.strip_prefix('+').unwrap_or(t).parse::<i128>().ok()
}

// ---------------------------------------------------------------------------
// Coerção de um VALOR JSON inteiro (não só de texto)
// ---------------------------------------------------------------------------
//
// As funções acima recebem `&str` — servem quando o campo já se sabe textual. Mas
// a referência aplica `String()`/`Number()`/`BigInt()` sobre o valor CRU de
// `tx.data`, que é entrada de terceiro e pode ser booleano, lista, nulo ou objeto.
// Cada módulo que reimplementou "aceito Int e Str, o resto é erro" ficou mais
// estrito que a rede num ponto diferente. Estas três concentram a regra.

use crate::transaction::JsonValue;

/// `s.length` do JS: unidades UTF-16, não bytes nem caracteres.
///
/// A diferença é observável em toda validação de comprimento. `"éé"` tem
/// `length === 2` no JS e `len() == 4` em bytes; um emoji tem `length === 2` e
/// `chars().count() == 1`. Medir errado faz este cliente ACEITAR o que a rede
/// recusa (bytes, em texto acentuado curto) ou RECUSAR o que ela aceita (bytes,
/// em texto acentuado longo) — nos dois sentidos é cisão de consenso.
pub fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `String(v)` do JS sobre um valor JSON.
///
/// Sim, `String(["ab"])` é `"ab"` e `String({})` é `"[object Object]"`. Absurdo,
/// mas é o que a rede aceita — e um cliente que recusasse rejeitaria bloco válido.
pub fn js_string_de(v: &JsonValue) -> String {
    match v {
        JsonValue::Null => "null".to_string(),
        JsonValue::Bool(b) => b.to_string(),
        JsonValue::Int(i) => i.to_string(),
        JsonValue::Str(s) => s.clone(),
        // `Array.prototype.toString` é `join(',')`, e `join` emite string VAZIA
        // para `null`/`undefined` — não `"null"`.
        JsonValue::List(itens) => itens
            .iter()
            .map(|item| match item {
                JsonValue::Null => String::new(),
                outro => js_string_de(outro),
            })
            .collect::<Vec<_>>()
            .join(","),
        JsonValue::Map(_) => "[object Object]".to_string(),
    }
}

/// `Number(v)` do JS restrito a inteiro seguro, sobre um valor JSON qualquer.
///
/// `None` = o JS produziria `NaN`/fração/fora de 2⁵³, ou seja, o
/// `Number.isSafeInteger` seguinte daria `false` e a referência recusaria.
///
/// Note os caminhos que NÃO passam por texto: `Number(null)` é `0` e
/// `Number(true)` é `1`. Os demais viram string primeiro, que é exatamente o que
/// o `ToPrimitive` do JS faz com lista e objeto.
pub fn js_number_seguro_de(v: &JsonValue) -> Option<i64> {
    match v {
        JsonValue::Int(i) => Some(*i),
        JsonValue::Null => Some(0),
        JsonValue::Bool(b) => Some(i64::from(*b)),
        outro => js_number_seguro(&js_string_de(outro)),
    }
}

/// `BigInt(v)` do JS sobre um valor JSON qualquer.
///
/// `None` = o `BigInt()` teria LANÇADO — que na referência é a transação
/// recusada, então o desfecho é o mesmo. Os casos que lançam: `null`, objeto, e
/// texto malformado. `BigInt(true)` é `1n`; `BigInt([3])` é `3n`.
pub fn js_bigint_de(v: &JsonValue) -> Option<i128> {
    match v {
        JsonValue::Int(i) => Some(i128::from(*i)),
        JsonValue::Bool(b) => Some(i128::from(*b)),
        // `BigInt(null)` e `BigInt({})` lançam.
        JsonValue::Null | JsonValue::Map(_) => None,
        outro => js_bigint(&js_string_de(outro)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// As duas diferenças em relação ao `str::trim`, nas duas direções.
    #[test]
    fn js_trim_apara_bom_e_preserva_nel() {
        // BOM (U+FEFF): o JS apara, o `str::trim` NÃO.
        assert_eq!(js_trim("\u{feff}Foo"), "Foo");
        assert_eq!("\u{feff}Foo".trim(), "\u{feff}Foo", "confirma a divergência do nativo");

        // NEL (U+0085): o `str::trim` apara, o JS NÃO.
        assert_eq!(js_trim("\u{85}Foo"), "\u{85}Foo");
        assert_eq!("\u{85}Foo".trim(), "Foo", "confirma a divergência do nativo");

        // O comum continua igual.
        assert_eq!(js_trim("  Foo\t\n"), "Foo");
        assert_eq!(js_trim("Foo"), "Foo");
        // Só BOM: vira vazio (é o que faz a referência REJEITAR o nome).
        assert_eq!(js_trim("\u{feff}"), "");
    }
    /// A tabela do `Number` do JS, conferida caso a caso contra o Node.
    #[test]
    fn js_number_reproduz_a_coercao_do_node() {
        // Aceitos — e um parser estrito recusaria TODOS estes.
        assert_eq!(js_number_seguro("3.0"), Some(3), "fração nula ainda é inteiro");
        assert_eq!(js_number_seguro(" 3 "), Some(3), "apara espaço");
        assert_eq!(js_number_seguro("0x10"), Some(16), "hexadecimal");
        assert_eq!(js_number_seguro("0b11"), Some(3), "binário");
        assert_eq!(js_number_seguro("0o17"), Some(15), "octal");
        assert_eq!(js_number_seguro("1e2"), Some(100), "científica");
        assert_eq!(js_number_seguro(""), Some(0), "string VAZIA vale zero");
        assert_eq!(js_number_seguro("   "), Some(0), "só espaço vale zero");
        assert_eq!(js_number_seguro("-5"), Some(-5));

        // Recusados — `Number.isSafeInteger` daria false.
        assert_eq!(js_number_seguro("3.5"), None, "fração não-nula");
        assert_eq!(js_number_seguro("abc"), None, "NaN");
        assert_eq!(js_number_seguro("Infinity"), None);
        assert_eq!(js_number_seguro("9007199254740992"), None, "acima de 2^53-1");
    }

    /// `BigInt` difere de `Number` em dois pontos: rejeita fração e não tem teto.
    #[test]
    fn js_bigint_rejeita_fracao_e_aceita_bases() {
        assert_eq!(js_bigint("3"), Some(3));
        assert_eq!(js_bigint("0x10"), Some(16));
        assert_eq!(js_bigint(" 3 "), Some(3));
        assert_eq!(js_bigint(""), Some(0), "string vazia vale zero");
        assert_eq!(js_bigint("9007199254740992"), Some(9_007_199_254_740_992), "sem teto de 2^53");

        // `BigInt("3.0")` LANÇA no Node — diferente de `Number("3.0")`.
        assert_eq!(js_bigint("3.0"), None, "BigInt não aceita fração, nem nula");
        assert_eq!(js_bigint("1e2"), None, "BigInt não aceita científica");
        assert_eq!(js_bigint("abc"), None);
    }


    /// A coerção de VALOR JSON cobre todas as variantes — não só texto.
    ///
    /// Cada linha aqui foi conferida contra o Node. Os módulos que reimplementaram
    /// "aceito Int e Str, o resto é erro" ficaram mais estritos que a rede em
    /// pontos diferentes: `ai.rs` no `quorum`, `token.rs` no `durationBlocks`,
    /// `bridge.rs` no `quorum` do comitê.
    #[test]
    fn numero_de_valor_json_segue_o_number_do_js() {
        use crate::transaction::JsonValue;

        let n = js_number_seguro_de;
        assert_eq!(n(&JsonValue::Int(3)), Some(3));
        assert_eq!(n(&JsonValue::Null), Some(0), "Number(null) === 0");
        assert_eq!(n(&JsonValue::Bool(true)), Some(1), "Number(true) === 1");
        assert_eq!(n(&JsonValue::Bool(false)), Some(0));
        assert_eq!(n(&JsonValue::str("3.0")), Some(3), "fração nula ainda é inteiro");
        assert_eq!(n(&JsonValue::str(" 3 ")), Some(3));
        assert_eq!(n(&JsonValue::str("0x10")), Some(16));
        assert_eq!(n(&JsonValue::str("1e2")), Some(100));
        assert_eq!(n(&JsonValue::str("")), Some(0), "string vazia vira ZERO, não erro");
        // `Number([3])` é 3: o array vira "3" pelo `toString`.
        assert_eq!(n(&JsonValue::List(vec![JsonValue::Int(3)])), Some(3));
        assert_eq!(n(&JsonValue::List(vec![])), Some(0), "Number([]) === 0");
        // `Number([1,2])` é NaN — "1,2" não é número.
        assert_eq!(n(&JsonValue::List(vec![JsonValue::Int(1), JsonValue::Int(2)])), None);
        // `Number({})` é NaN.
        assert_eq!(n(&JsonValue::map([])), None);
        assert_eq!(n(&JsonValue::str("3.5")), None, "fração real NÃO é inteiro");
    }

    /// `BigInt(v)`: `None` = o JS teria LANÇADO, que na referência é a transação
    /// recusada — mesmo desfecho.
    #[test]
    fn bigint_de_valor_json_segue_o_bigint_do_js() {
        use crate::transaction::JsonValue;

        let b = js_bigint_de;
        assert_eq!(b(&JsonValue::Int(7)), Some(7));
        assert_eq!(b(&JsonValue::Bool(true)), Some(1), "BigInt(true) === 1n");
        assert_eq!(b(&JsonValue::str("0x10")), Some(16));
        assert_eq!(b(&JsonValue::str("")), Some(0), "BigInt('') === 0n");
        assert_eq!(b(&JsonValue::List(vec![JsonValue::Int(3)])), Some(3));
        assert_eq!(b(&JsonValue::Null), None, "BigInt(null) LANÇA");
        assert_eq!(b(&JsonValue::map([])), None, "BigInt de objeto LANÇA");
        assert_eq!(b(&JsonValue::str("3.5")), None, "BigInt não aceita fração");
    }

    /// `String(v)` — inclusive os casos absurdos que a rede aceita.
    #[test]
    fn string_de_valor_json_segue_o_string_do_js() {
        use crate::transaction::JsonValue;

        assert_eq!(js_string_de(&JsonValue::Int(12345)), "12345");
        assert_eq!(js_string_de(&JsonValue::Null), "null");
        assert_eq!(js_string_de(&JsonValue::Bool(false)), "false");
        assert_eq!(js_string_de(&JsonValue::map([])), "[object Object]");
        // `join(',')` emite VAZIO para null, não "null" — é a diferença entre
        // `String(null)` e `String([null])`.
        assert_eq!(js_string_de(&JsonValue::List(vec![JsonValue::Null])), "");
        assert_eq!(
            js_string_de(&JsonValue::List(vec![JsonValue::str("a"), JsonValue::Int(2)])),
            "a,2"
        );
    }

    /// `.length` do JS conta unidades UTF-16 — nem bytes, nem caracteres.
    ///
    /// Medir em bytes fazia a ponte ACEITAR `"éé"` (2 no JS, 4 em bytes), que a
    /// rede recusa por ser curto demais; e medir em caracteres fazia a governança
    /// ACEITAR 200 emoji (400 unidades UTF-16), que a rede recusa por ser longo.
    #[test]
    fn js_len_conta_unidades_utf16() {
        assert_eq!(js_len("abc"), 3);
        assert_eq!(js_len("éé"), 2, "acentuado: 2 no JS, 4 em bytes");
        assert_eq!("éé".len(), 4, "…e é exatamente essa a diferença");
        assert_eq!(js_len("😀"), 2, "emoji fora do BMP ocupa DOIS code units");
        assert_eq!("😀".chars().count(), 1, "…enquanto `chars` conta um só");
    }
}
