//! Codificação canônica do estado de consenso.
//!
//! É a base da folha do `stateRoot`. Substituiu o `JSON.stringify` da referência
//! justamente para que ESTE crate pudesse existir: reproduzir `JSON.stringify` em
//! Rust exigiria replicar o comportamento do V8, incluindo inteiro acima de 2⁵³
//! perdendo precisão em silêncio, `1e21` virando `"1e+21"` e `-0` virando `0`.
//!
//! Formato — tag + comprimento + carga:
//!
//! | tag  | tipo       | carga                                                |
//! |------|------------|------------------------------------------------------|
//! | 0x00 | nulo       | —                                                    |
//! | 0x01 | falso      | —                                                    |
//! | 0x02 | verdadeiro | —                                                    |
//! | 0x03 | inteiro    | `u32BE(n)` + n bytes ASCII em decimal                |
//! | 0x04 | texto      | `u32BE(n)` + n bytes UTF-8                           |
//! | 0x05 | lista      | `u32BE(n)` + n valores                               |
//! | 0x06 | mapa       | `u32BE(n)` + n pares (texto, valor), ordenados       |
//!
//! Equivalência com a referência: `vectors/canonical.json`.

use std::collections::BTreeMap;

const TAG_NULL: u8 = 0x00;
const TAG_FALSE: u8 = 0x01;
const TAG_TRUE: u8 = 0x02;
const TAG_INT: u8 = 0x03;
const TAG_STR: u8 = 0x04;
const TAG_LIST: u8 = 0x05;
const TAG_MAP: u8 = 0x06;

/// Valor codificável no estado de consenso.
///
/// Note o que NÃO existe aqui: ponto flutuante. Não é omissão — é o formato
/// impedindo que o estado ganhe float por descuido. Dois nós com bibliotecas
/// matemáticas diferentes arredondariam diferente e divergiriam.
///
/// Inteiro é `String` em decimal, não `i64`: os saldos passam de 2⁶⁴ e a
/// referência os guarda em `BigInt`. Guardar o decimal evita escolher um tipo de
/// precisão arbitrária agora e o mantém legível em dump.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    Null,
    Bool(bool),
    /// Decimal canônico: sem zero à esquerda, sem `-0`, sem `+`.
    Int(String),
    Str(String),
    List(Vec<Value>),
    /// `BTreeMap` já mantém as chaves ordenadas por bytes — que é exatamente a
    /// ordem que o formato exige. Usar `HashMap` aqui seria não-determinístico.
    Map(BTreeMap<String, Value>),
}

impl Value {
    /// Constrói um inteiro a partir de um tipo COM SINAL do Rust.
    pub fn int(v: impl Into<i128>) -> Self {
        Value::Int(v.into().to_string())
    }

    /// Constrói um inteiro a partir de um tipo SEM SINAL.
    ///
    /// Existe separado de `int` de propósito: `u128` não converte para `i128` sem
    /// possibilidade de perda, e forçar o cast abriria a porta para um saldo alto
    /// virar negativo em silêncio. Duas portas explícitas, nenhuma conversão tácita.
    pub fn uint(v: impl Into<u128>) -> Self {
        Value::Int(v.into().to_string())
    }

    /// Constrói um inteiro a partir do decimal, validando a forma canônica.
    ///
    /// Rejeitar forma não canônica aqui é o que impede duas codificações do mesmo
    /// número: `"007"` e `"7"` produziriam bytes diferentes para o mesmo valor, e
    /// a raiz do estado dependeria de como o número foi escrito.
    pub fn int_str(s: impl Into<String>) -> Result<Self, Error> {
        let s = s.into();
        let corpo = s.strip_prefix('-').unwrap_or(&s);
        if corpo.is_empty() || !corpo.bytes().all(|b| b.is_ascii_digit()) {
            return Err(Error::IntNaoCanonico(s));
        }
        if corpo.len() > 1 && corpo.starts_with('0') {
            return Err(Error::IntNaoCanonico(s)); // zero à esquerda
        }
        if s == "-0" {
            return Err(Error::IntNaoCanonico(s)); // menos-zero não é forma canônica
        }
        Ok(Value::Int(s))
    }

    pub fn str(s: impl Into<String>) -> Self {
        Value::Str(s.into())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    /// Comprimento não cabe em `u32`. Na prática inalcançável, mas falhar alto é
    /// melhor que truncar em silêncio e gravar uma folha irreproduzível.
    ComprimentoExcedido(usize),
    IntNaoCanonico(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::ComprimentoExcedido(n) => write!(f, "comprimento fora da faixa: {n}"),
            Error::IntNaoCanonico(s) => write!(f, "inteiro em forma não canônica: {s:?}"),
        }
    }
}
impl std::error::Error for Error {}

fn escreve_len(out: &mut Vec<u8>, n: usize) -> Result<(), Error> {
    let n32: u32 = n.try_into().map_err(|_| Error::ComprimentoExcedido(n))?;
    out.extend_from_slice(&n32.to_be_bytes());
    Ok(())
}

/// Codifica um valor na forma canônica.
pub fn encode(value: &Value) -> Result<Vec<u8>, Error> {
    let mut out = Vec::new();
    encode_em(value, &mut out)?;
    Ok(out)
}

fn encode_em(value: &Value, out: &mut Vec<u8>) -> Result<(), Error> {
    match value {
        Value::Null => out.push(TAG_NULL),
        Value::Bool(false) => out.push(TAG_FALSE),
        Value::Bool(true) => out.push(TAG_TRUE),
        Value::Int(d) => {
            out.push(TAG_INT);
            escreve_len(out, d.len())?;
            out.extend_from_slice(d.as_bytes());
        }
        Value::Str(s) => {
            out.push(TAG_STR);
            escreve_len(out, s.len())?;
            out.extend_from_slice(s.as_bytes());
        }
        Value::List(itens) => {
            out.push(TAG_LIST);
            escreve_len(out, itens.len())?;
            for item in itens {
                encode_em(item, out)?;
            }
        }
        Value::Map(pares) => {
            out.push(TAG_MAP);
            escreve_len(out, pares.len())?;
            // `BTreeMap` itera em ordem de chave — que para `String` é ordem de
            // bytes, exatamente o que o formato pede.
            for (k, v) in pares {
                encode_em(&Value::Str(k.clone()), out)?;
                encode_em(v, out)?;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Decodificação
// ---------------------------------------------------------------------------
//
// O formato nasceu SÓ DE ESCRITA: ele existe para produzir a pré-imagem das
// folhas do `stateRoot`, e ninguém precisava ler de volta. O snapshot de boot
// precisa — e é bom que a volta passe por AQUI, pelo mesmo formato que o
// consenso hashea, em vez de uma segunda serialização paralela.
//
// Um decodificador que lê ARQUIVO DE DISCO tem obrigações que o codificador não
// tem: o arquivo é entrada não confiável (disco corrompido, truncado, ou escrito
// por outro processo). Daí as guardas abaixo — nenhuma delas tem contraparte no
// `encode`, e todas existem para que corrupção vire `Err`, nunca pânico nem
// alocação gigante.

/// Falha ao decodificar a forma canônica.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroDecode {
    /// Acabaram os bytes no meio de um valor.
    Truncado { posicao: usize },
    /// Byte de tag que o formato não define.
    TagDesconhecida { posicao: usize, tag: u8 },
    /// Texto que não é UTF-8 válido.
    TextoInvalido { posicao: usize },
    /// Inteiro fora da forma canônica (zero à esquerda, `-0`, não-dígito).
    IntNaoCanonico(String),
    /// Chave de mapa que não é texto — o formato só admite `Str` como chave.
    ChaveNaoTextual { posicao: usize },
    /// Chaves de mapa fora de ordem, ou repetidas.
    ///
    /// O codificador emite a partir de um `BTreeMap`, então a ordem é sempre
    /// crescente. Aceitar outra ordem na leitura permitiria DUAS codificações do
    /// mesmo mapa — e o formato existe justamente para que só exista uma.
    MapaForaDeOrdem { posicao: usize },
    /// Profundidade de aninhamento acima do teto.
    MuitoProfundo { posicao: usize },
    /// Sobraram bytes depois do valor de topo.
    LixoNoFim { posicao: usize },
}

impl std::fmt::Display for ErroDecode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErroDecode::Truncado { posicao } => write!(f, "bytes acabaram na posição {posicao}"),
            ErroDecode::TagDesconhecida { posicao, tag } => {
                write!(f, "tag {tag:#04x} desconhecida na posição {posicao}")
            }
            ErroDecode::TextoInvalido { posicao } => write!(f, "texto não-UTF-8 na posição {posicao}"),
            ErroDecode::IntNaoCanonico(s) => write!(f, "inteiro em forma não canônica: {s:?}"),
            ErroDecode::ChaveNaoTextual { posicao } => {
                write!(f, "chave de mapa não é texto na posição {posicao}")
            }
            ErroDecode::MapaForaDeOrdem { posicao } => {
                write!(f, "chaves de mapa fora de ordem ou repetidas na posição {posicao}")
            }
            ErroDecode::MuitoProfundo { posicao } => {
                write!(f, "aninhamento acima do teto na posição {posicao}")
            }
            ErroDecode::LixoNoFim { posicao } => write!(f, "bytes sobrando a partir de {posicao}"),
        }
    }
}
impl std::error::Error for ErroDecode {}

/// Teto de aninhamento.
///
/// O decodificador é RECURSIVO, e a entrada vem de disco: sem teto, um arquivo
/// com dez mil `TAG_LIST` seguidos derruba o processo por estouro de pilha antes
/// de qualquer validação. O estado real aninha 3 níveis (domínio → chave →
/// registro); 64 é folga larga sem chegar perto do limite da pilha.
const MAX_PROFUNDIDADE: usize = 64;

/// Decodifica a forma canônica. Inverso EXATO de [`encode`].
///
/// Exige a codificação canônica, não só "uma que decodifica": mapa fora de ordem
/// e inteiro com zero à esquerda são ERRO, porque aceitá-los admitiria duas
/// codificações do mesmo valor — e o formato inteiro existe para que exista uma.
pub fn decode(bytes: &[u8]) -> Result<Value, ErroDecode> {
    let mut pos = 0usize;
    let v = decode_em(bytes, &mut pos, 0)?;
    if pos != bytes.len() {
        return Err(ErroDecode::LixoNoFim { posicao: pos });
    }
    Ok(v)
}

fn le_len(bytes: &[u8], pos: &mut usize) -> Result<usize, ErroDecode> {
    let fim = pos.checked_add(4).ok_or(ErroDecode::Truncado { posicao: *pos })?;
    let campo = bytes.get(*pos..fim).ok_or(ErroDecode::Truncado { posicao: *pos })?;
    *pos = fim;
    let n = u32::from_be_bytes([campo[0], campo[1], campo[2], campo[3]]);
    Ok(n as usize)
}

fn le_bytes<'a>(bytes: &'a [u8], pos: &mut usize, n: usize) -> Result<&'a [u8], ErroDecode> {
    let fim = pos.checked_add(n).ok_or(ErroDecode::Truncado { posicao: *pos })?;
    let fatia = bytes.get(*pos..fim).ok_or(ErroDecode::Truncado { posicao: *pos })?;
    *pos = fim;
    Ok(fatia)
}

fn decode_em(bytes: &[u8], pos: &mut usize, profundidade: usize) -> Result<Value, ErroDecode> {
    if profundidade > MAX_PROFUNDIDADE {
        return Err(ErroDecode::MuitoProfundo { posicao: *pos });
    }
    let inicio = *pos;
    let tag = *bytes.get(*pos).ok_or(ErroDecode::Truncado { posicao: *pos })?;
    *pos += 1;
    match tag {
        TAG_NULL => Ok(Value::Null),
        TAG_FALSE => Ok(Value::Bool(false)),
        TAG_TRUE => Ok(Value::Bool(true)),
        TAG_INT => {
            let n = le_len(bytes, pos)?;
            let corpo = le_bytes(bytes, pos, n)?;
            let s = std::str::from_utf8(corpo)
                .map_err(|_| ErroDecode::TextoInvalido { posicao: inicio })?;
            // `int_str` é a MESMA validação de forma canônica que o construtor
            // aplica na escrita — não uma segunda versão dela.
            Value::int_str(s).map_err(|e| match e {
                Error::IntNaoCanonico(s) => ErroDecode::IntNaoCanonico(s),
                Error::ComprimentoExcedido(_) => ErroDecode::Truncado { posicao: inicio },
            })
        }
        TAG_STR => {
            let n = le_len(bytes, pos)?;
            let corpo = le_bytes(bytes, pos, n)?;
            let s = std::str::from_utf8(corpo)
                .map_err(|_| ErroDecode::TextoInvalido { posicao: inicio })?;
            Ok(Value::Str(s.to_string()))
        }
        TAG_LIST => {
            let n = le_len(bytes, pos)?;
            // NÃO pré-aloca `n`: o comprimento vem do arquivo, e um `u32` mentiroso
            // pediria 4 GB antes de o primeiro item ser lido. Cresce conforme lê —
            // o custo é reallocação, e a alternativa é OOM por entrada corrompida.
            let mut itens = Vec::new();
            for _ in 0..n {
                itens.push(decode_em(bytes, pos, profundidade + 1)?);
            }
            Ok(Value::List(itens))
        }
        TAG_MAP => {
            let n = le_len(bytes, pos)?;
            let mut pares: BTreeMap<String, Value> = BTreeMap::new();
            let mut anterior: Option<String> = None;
            for _ in 0..n {
                let chave_pos = *pos;
                let Value::Str(k) = decode_em(bytes, pos, profundidade + 1)? else {
                    return Err(ErroDecode::ChaveNaoTextual { posicao: chave_pos });
                };
                // Ordem ESTRITAMENTE crescente: cobre fora-de-ordem e repetida de
                // uma vez. Repetida é o caso perigoso — a última venceria em
                // silêncio e dois arquivos diferentes dariam o mesmo estado.
                if anterior.as_ref().is_some_and(|p| *p >= k) {
                    return Err(ErroDecode::MapaForaDeOrdem { posicao: chave_pos });
                }
                anterior = Some(k.clone());
                let v = decode_em(bytes, pos, profundidade + 1)?;
                pares.insert(k, v);
            }
            Ok(Value::Map(pares))
        }
        outra => Err(ErroDecode::TagDesconhecida { posicao: inicio, tag: outra }),
    }
}

// ---------------------------------------------------------------------------
// Acessores de leitura
// ---------------------------------------------------------------------------
//
// Reconstruir o estado a partir do `Value` é perguntar, campo a campo, "que tag é
// esta?". Sem acessores compartilhados cada `from_value` escreveria o próprio
// `match`, e bastaria UM deles aceitar `Str("7")` onde a folha tem `Int(7)` para o
// estado reconstruído codificar outra raiz — com o arquivo intacto.

impl Value {
    pub fn texto(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn booleano(&self) -> Option<bool> {
        match self {
            Value::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn e_nulo(&self) -> bool {
        matches!(self, Value::Null)
    }

    pub fn lista(&self) -> Option<&[Value]> {
        match self {
            Value::List(l) => Some(l.as_slice()),
            _ => None,
        }
    }

    pub fn mapa(&self) -> Option<&BTreeMap<String, Value>> {
        match self {
            Value::Map(m) => Some(m),
            _ => None,
        }
    }

    /// Inteiro (tag 0x03) no tipo pedido. Fora da faixa — ou negativo num tipo sem
    /// sinal — é `None`, nunca um valor que deu a volta.
    pub fn inteiro<T: std::str::FromStr>(&self) -> Option<T> {
        match self {
            Value::Int(d) => d.parse::<T>().ok(),
            _ => None,
        }
    }

    /// Campo que a referência escreve como `x ?? null`: a chave EXISTE sempre, e o
    /// nulo é um valor, não uma ausência.
    ///
    /// O `Option` de fora é "a forma bate?"; o de dentro é o nulo. Achatar os dois
    /// num só faria "tipo errado" e "nulo legítimo" virarem o mesmo resultado — e o
    /// campo errado entraria no estado como `None` em vez de recusar o snapshot.
    pub fn texto_ou_nulo(&self) -> Option<Option<String>> {
        match self {
            Value::Null => Some(None),
            Value::Str(s) => Some(Some(s.clone())),
            _ => None,
        }
    }

    /// Idem para os campos numéricos escritos como `x ?? null` (`executeAt`,
    /// `completedAt`).
    pub fn inteiro_ou_nulo<T: std::str::FromStr>(&self) -> Option<Option<T>> {
        match self {
            Value::Null => Some(None),
            Value::Int(_) => Some(Some(self.inteiro()?)),
            _ => None,
        }
    }

    /// Decimal guardado com a tag de TEXTO (0x04), não de inteiro.
    ///
    /// São os campos que a referência grava com `BigInt.toString()`: `amount` da
    /// fila de unbonding, `total`/`claimed` do vesting, `frozen` do token, o voto.
    /// Ler um deles com [`Self::inteiro`] devolveria `None` e derrubaria o snapshot
    /// inteiro; confundir os dois no sentido oposto muda a tag e muda a raiz.
    ///
    /// Exige a forma canônica: `"007"` e `"7"` são o mesmo número e codificações
    /// DIFERENTES, e aceitar as duas quebraria a promessa de que o estado
    /// reconstruído reproduz o arquivo byte a byte.
    pub fn decimal_em_texto(&self) -> Option<u128> {
        let s = self.texto()?;
        let n: u128 = s.parse().ok()?;
        (n.to_string() == s).then_some(n)
    }
}

/// A forma canônica em hexadecimal, para depuração e comparação com vetores.
pub fn encode_hex(value: &Value) -> Result<String, Error> {
    Ok(hex::encode(encode(value)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(v: &Value) -> String {
        encode_hex(v).unwrap()
    }
    fn mapa(pares: &[(&str, Value)]) -> Value {
        Value::Map(pares.iter().map(|(k, v)| ((*k).to_string(), v.clone())).collect())
    }

    #[test]
    fn injetivo_lista_nao_colide_por_concatenacao() {
        // Sem prefixo de comprimento, ["ab"] e ["a","b"] colidiriam.
        assert_ne!(h(&Value::List(vec![Value::str("ab")])),
                   h(&Value::List(vec![Value::str("a"), Value::str("b")])));
    }

    #[test]
    fn texto_e_inteiro_de_mesma_aparencia_diferem() {
        assert_ne!(h(&Value::str("123")), h(&Value::int(123)));
    }

    #[test]
    fn vazios_sao_distinguiveis() {
        let vazios = [
            h(&Value::Null), h(&Value::Bool(false)), h(&Value::int(0)),
            h(&Value::str("")), h(&Value::List(vec![])), h(&mapa(&[])),
        ];
        let unicos: std::collections::HashSet<_> = vazios.iter().collect();
        assert_eq!(unicos.len(), vazios.len(), "todo vazio precisa de codificação própria");
    }

    #[test]
    fn ordem_de_insercao_nao_importa() {
        assert_eq!(h(&mapa(&[("a", Value::int(1)), ("b", Value::int(2))])),
                   h(&mapa(&[("b", Value::int(2)), ("a", Value::int(1))])));
    }

    #[test]
    fn ordenacao_e_por_byte_maiuscula_antes_de_minuscula() {
        let bytes = encode(&mapa(&[("a", Value::int(1)), ("A", Value::int(2))])).unwrap();
        // tag(1) + len(4) + tag_str(1) + len(4) = primeira chave começa no índice 10
        assert_eq!(bytes[10], b'A', "'A' (0x41) tem de vir antes de 'a' (0x61)");
    }

    #[test]
    fn inteiro_grande_sobrevive_intacto() {
        let grande = "9007199254740993"; // 2^53 + 1: o JSON.stringify truncaria
        let v = Value::int_str(grande).unwrap();
        let bytes = encode(&v).unwrap();
        assert_eq!(&bytes[5..], grande.as_bytes());
    }

    #[test]
    fn forma_nao_canonica_de_inteiro_e_rejeitada() {
        assert!(Value::int_str("007").is_err(), "zero à esquerda");
        assert!(Value::int_str("-0").is_err(), "menos-zero");
        assert!(Value::int_str("+7").is_err(), "sinal de mais");
        assert!(Value::int_str("").is_err());
        assert!(Value::int_str("1.5").is_err(), "float não é inteiro");
        assert!(Value::int_str("0").is_ok());
        assert!(Value::int_str("-1").is_ok());
    }

    #[test]
    fn unicode_e_utf8_cru() {
        let bytes = encode(&Value::str("café")).unwrap();
        assert_eq!(bytes[0], TAG_STR);
        assert_eq!(u32::from_be_bytes(bytes[1..5].try_into().unwrap()), 5);
        assert_eq!(&bytes[5..], "café".as_bytes());
    }

    // ------------------------------------------------------------ decodificação

    /// Ida e volta por todas as formas do valor, inclusive os casos de borda.
    #[test]
    fn decode_e_o_inverso_exato_de_encode() {
        let casos = vec![
            Value::Null,
            Value::Bool(true),
            Value::Bool(false),
            Value::int(0),
            Value::int(-1),
            Value::uint(u128::MAX),
            Value::str(""),
            Value::str("acentuação e 😀"),
            Value::List(vec![]),
            Value::Map(BTreeMap::new()),
            Value::List(vec![Value::int(1), Value::str("dois"), Value::Null]),
            Value::Map(
                [
                    ("a".to_string(), Value::int(1)),
                    ("b".to_string(), Value::List(vec![Value::Bool(true)])),
                    ("c".to_string(), Value::Map([("d".to_string(), Value::str("e"))].into())),
                ]
                .into(),
            ),
        ];
        for v in casos {
            let bytes = encode(&v).expect("codifica");
            assert_eq!(decode(&bytes), Ok(v.clone()), "ida e volta falhou para {v:?}");
        }
    }

    /// Uma folha REAL do estado sobrevive à ida e volta.
    ///
    /// É o caso que o snapshot depende: se a volta não reproduzir exatamente o
    /// valor, a raiz recomputada não bate e o snapshot é descartado — falha
    /// segura, mas o boot rápido nunca funcionaria.
    #[test]
    fn conta_real_sobrevive_a_ida_e_volta() {
        let conta = crate::state::Account {
            balance: 123_456_789_012_345_678_901_234_567_890,
            nonce: 42,
            staked: 1_000_000,
            ..Default::default()
        };
        let v = conta.to_value();
        let bytes = encode(&v).expect("codifica");
        assert_eq!(decode(&bytes), Ok(v));
    }

    /// Arquivo TRUNCADO vira erro, não pânico. É o caso de crash no meio da
    /// escrita — e o disco é entrada não confiável.
    #[test]
    fn truncado_e_erro_em_qualquer_ponto_do_corte() {
        let v = Value::Map(
            [
                ("chave".to_string(), Value::str("valor")),
                ("lista".to_string(), Value::List(vec![Value::int(7)])),
            ]
            .into(),
        );
        let bytes = encode(&v).expect("codifica");
        for corte in 1..bytes.len() {
            let r = decode(&bytes[..corte]);
            assert!(r.is_err(), "corte em {corte} deveria falhar, veio {r:?}");
        }
        assert_eq!(decode(&bytes), Ok(v), "e o arquivo inteiro continua válido");
    }

    /// Formas NÃO canônicas são recusadas — aceitá-las admitiria duas
    /// codificações do mesmo valor, e o formato existe para que exista uma só.
    #[test]
    fn recusa_o_que_nao_e_forma_canonica() {
        // Mapa com chaves FORA DE ORDEM: "b" antes de "a".
        let mut fora = vec![TAG_MAP];
        fora.extend_from_slice(&2u32.to_be_bytes());
        for (k, val) in [("b", 2i128), ("a", 1)] {
            fora.push(TAG_STR);
            fora.extend_from_slice(&(k.len() as u32).to_be_bytes());
            fora.extend_from_slice(k.as_bytes());
            let d = val.to_string();
            fora.push(TAG_INT);
            fora.extend_from_slice(&(d.len() as u32).to_be_bytes());
            fora.extend_from_slice(d.as_bytes());
        }
        assert!(matches!(decode(&fora), Err(ErroDecode::MapaForaDeOrdem { .. })));

        // Chave REPETIDA: a última venceria em silêncio, e dois arquivos
        // diferentes dariam o mesmo estado.
        let mut repetida = vec![TAG_MAP];
        repetida.extend_from_slice(&2u32.to_be_bytes());
        for _ in 0..2 {
            repetida.push(TAG_STR);
            repetida.extend_from_slice(&1u32.to_be_bytes());
            repetida.push(b'a');
            repetida.push(TAG_NULL);
        }
        assert!(matches!(decode(&repetida), Err(ErroDecode::MapaForaDeOrdem { .. })));

        // Inteiro com ZERO À ESQUERDA.
        let mut zero = vec![TAG_INT];
        zero.extend_from_slice(&2u32.to_be_bytes());
        zero.extend_from_slice(b"07");
        assert!(matches!(decode(&zero), Err(ErroDecode::IntNaoCanonico(_))));

        // Tag que o formato não define.
        assert!(matches!(decode(&[0x7f]), Err(ErroDecode::TagDesconhecida { .. })));

        // Bytes sobrando depois do valor de topo.
        assert!(matches!(decode(&[TAG_NULL, TAG_NULL]), Err(ErroDecode::LixoNoFim { .. })));
    }

    /// Aninhamento fundo vira erro, NÃO estouro de pilha: o decodificador é
    /// recursivo e lê de disco.
    #[test]
    fn aninhamento_fundo_e_erro_e_nao_derruba_o_processo() {
        let mut fundo = Vec::new();
        for _ in 0..(MAX_PROFUNDIDADE + 10) {
            fundo.push(TAG_LIST);
            fundo.extend_from_slice(&1u32.to_be_bytes());
        }
        fundo.push(TAG_NULL);
        assert!(matches!(decode(&fundo), Err(ErroDecode::MuitoProfundo { .. })));
    }

    /// Comprimento MENTIROSO não pré-aloca: uma lista que declara 4 bilhões de
    /// itens tem de falhar por falta de bytes, não por consumir a memória toda.
    #[test]
    fn comprimento_mentiroso_falha_sem_alocar() {
        let mut mentira = vec![TAG_LIST];
        mentira.extend_from_slice(&u32::MAX.to_be_bytes());
        mentira.push(TAG_NULL); // só UM item de verdade
        assert!(matches!(decode(&mentira), Err(ErroDecode::Truncado { .. })));
    }
}
