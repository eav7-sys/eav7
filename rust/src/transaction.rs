//! Transação do protocolo eav20 — payload assinado, `id` e validação stateless.
//!
//! # Atenção: aqui o canônico NÃO é o de `canonical.rs`
//!
//! O protocolo tem DUAS serializações canônicas, e trocá-las cinde a rede:
//!
//! - `canonical.rs` (tag + comprimento, binária) é a folha do `stateRoot`.
//! - ESTE módulo usa a serialização JSON com chaves ordenadas — a `canonical()` de
//!   `src/crypto/hash.js` na referência. É o que já está assinado por toda
//!   transação em produção, então não pode ser trocado sem hard fork.
//!
//! Por isso o payload sai como `String`, não como `Vec<u8>`: é texto JSON, e é
//! exatamente sobre esses bytes que `eav_hash` roda.
//!
//! Equivalência com a referência: `vectors/transaction.json`.

use crate::address::is_valid_address;
use crate::hash::eav_hash_one;
use std::collections::BTreeMap;

/// Protocolo esperado. A referência lê de `EAV7_PROTOCOL`, mas o valor de rede é
/// fixo — um nó que aceite outro protocolo aceita transação de outra cadeia.
pub const PROTOCOL: &str = "eav20";

/// Esquema híbrido pós-quântico: secp256k1 + ML-DSA-44.
pub const SIGNATURE_SCHEME: &str = "eav7-hybrid-1";

/// Esquema do envelope EAVM (MetaMask/Trust Wallet). Autenticado pela assinatura
/// secp256k1 embutida no raw, não pelo par híbrido — rota de validação separada.
pub const EAVM_SCHEME: &str = "eav7-eavm-1";

/// Teto do limite de taxa autorizável, em e7 (100 EAV7). Anti-erro de digitação.
pub const MAX_FEE_LIMIT: u128 = 100_000_000;

/// Limite do campo `data` já serializado.
pub const MAX_DATA_BYTES: usize = 64 * 1024;

/// Maior inteiro exatamente representável em `f64` — o `Number.isSafeInteger` da
/// referência. `nonce` e `timestamp` são `number` no JS; aceitar acima disso aqui
/// criaria transações que o nó de referência nem consegue reler sem perder dígito.
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Comprimento máximo de um valor monetário em dígitos (regra de `isAmountString`).
const MAX_AMOUNT_DIGITS: usize = 30;

/// Tipos de transação, na ordem de `CHAIN.FEES` da referência.
///
/// A lista é fechada de propósito: tipo desconhecido tem de ser REJEITADO, não
/// ignorado. Um nó que aceite um tipo que não sabe executar diverge do estado.
pub const TX_TYPES: &[&str] = &[
    "TRANSFER", "STAKE", "UNSTAKE", "VOTE", "DELEGATE_RESOURCE", "UNDELEGATE_RESOURCE",
    "GOV_PROPOSE", "GOV_VOTE", "SLASH_DOUBLE_SIGN", "VESTING_CREATE", "VESTING_CLAIM",
    "SET_COMMISSION", "CLAIM_VOTER_REWARD", "META_TX", "BRIDGE_COMMITTEE_UPDATE",
    "PERMISSION_UPDATE", "PERMISSION_PROPOSE", "PERMISSION_APPROVE", "PERMISSION_VETO",
    "MULTISIG_PROPOSE", "MULTISIG_APPROVE", "TOKEN_CREATE", "TOKEN_TRANSFER",
    "TOKEN_APPROVE", "TOKEN_TRANSFER_FROM", "TOKEN_MINT", "TOKEN_BURN", "TOKEN_PAUSE",
    "TOKEN_UNPAUSE", "TOKEN_BLACKLIST", "TOKEN_FREEZE", "TOKEN_UNFREEZE", "NFT_CREATE",
    "NFT_MINT", "NFT_TRANSFER", "NFT_APPROVE", "NFT_BURN", "NAME_REGISTER", "NAME_UPDATE",
    "NAME_TRANSFER", "NAME_RELEASE", "AI_TASK", "AI_RESULT", "AI_COMMIT", "AI_REVEAL",
    "AI_CLAIM", "AI_CHALLENGE", "AI_VERDICT", "AI_BID", "AI_AWARD", "ORACLE_REGISTER",
    "BRIDGE_OUT", "BRIDGE_IN", "BRIDGE_SETTLE", "AI_REFUND", "EAVM_TRANSFER",
    "EAVM_DEPLOY", "EAVM_CALL",
];

/// Tipos em que `to` é OBRIGATÓRIO e tem de ser um endereço válido.
///
/// Fora desta lista `to` pode ser nulo (STAKE, VOTE…), mas se vier preenchido
/// ainda tem de ser válido — senão fundos seriam creditados a uma conta que
/// ninguém consegue gastar.
const REQUIRES_TO: &[&str] = &[
    "TRANSFER", "TOKEN_TRANSFER", "TOKEN_APPROVE", "TOKEN_TRANSFER_FROM", "BRIDGE_IN",
];

// ---------------------------------------------------------------- JSON canônico

/// Valor JSON do campo `data`, livre por protocolo.
///
/// Não existe variante de ponto flutuante, e a omissão é deliberada: `JSON.stringify`
/// de um `double` no V8 usa o algoritmo de menor round-trip (`0.1+0.2` vira
/// `0.30000000000000004`, `1e21` vira `1e+21`). Reproduzir isso em Rust é
/// reimplementar o V8; um dígito de diferença muda o payload, muda o `id`, e a
/// transação passa a ser outra. Quem precisa de fração no `data` a codifica como
/// texto — que é o que o resto do protocolo já faz com valores monetários.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonValue {
    Null,
    Bool(bool),
    Int(i64),
    Str(String),
    List(Vec<JsonValue>),
    Map(BTreeMap<String, JsonValue>),
}

impl JsonValue {
    pub fn str(s: impl Into<String>) -> Self {
        JsonValue::Str(s.into())
    }
    /// Mapa a partir de pares, para montar `data` sem cerimônia.
    pub fn map(pares: impl IntoIterator<Item = (String, JsonValue)>) -> Self {
        JsonValue::Map(pares.into_iter().collect())
    }
}

/// Escreve uma string JSON com o MESMO escape do `JSON.stringify`.
///
/// A tabela importa byte a byte: escapar `/` (como fazem alguns serializadores) ou
/// emitir `é` em vez do UTF-8 cru de `é` produziria um payload diferente do
/// que a carteira assinou, e a assinatura deixaria de conferir.
fn escreve_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            // Só o intervalo de controle vira \u00xx, em minúsculas. 0x7f (DEL) NÃO
            // é escapado pelo JSON.stringify — escapá-lo aqui divergiria.
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Ordena chaves como o `Array.prototype.sort` do JavaScript: por unidade de
/// código UTF-16, não por byte UTF-8.
///
/// As duas ordens coincidem para todo o BMP, mas divergem acima dele: um emoji
/// (U+1F600, que em UTF-16 vira o par 0xD83D…) ordena ANTES de U+E000 no JS e
/// DEPOIS em UTF-8. Só aparece em `data` com chave exótica — e é exatamente o tipo
/// de transação que um atacante monta de propósito para fazer dois clientes
/// discordarem do `id` da mesma transação.
fn cmp_utf16(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn escreve_valor(out: &mut String, v: &JsonValue) {
    match v {
        JsonValue::Null => out.push_str("null"),
        JsonValue::Bool(true) => out.push_str("true"),
        JsonValue::Bool(false) => out.push_str("false"),
        JsonValue::Int(n) => out.push_str(&n.to_string()),
        JsonValue::Str(s) => escreve_string(out, s),
        JsonValue::List(itens) => {
            out.push('[');
            for (i, item) in itens.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                escreve_valor(out, item);
            }
            out.push(']');
        }
        JsonValue::Map(pares) => {
            let mut chaves: Vec<&String> = pares.keys().collect();
            chaves.sort_by(|a, b| cmp_utf16(a, b));
            out.push('{');
            for (i, k) in chaves.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                escreve_string(out, k);
                out.push(':');
                escreve_valor(out, &pares[*k]);
            }
            out.push('}');
        }
    }
}

/// Serialização canônica em JSON: chaves ordenadas, sem espaço nenhum.
pub fn canonical_json(v: &JsonValue) -> String {
    let mut out = String::new();
    escreve_valor(&mut out, v);
    out
}

// ------------------------------------------------------------ leitura de JSON
//
// A INVERSA de `canonical_json`. Fecha o caminho de boot: o nó grava blocos em
// `blocks.jsonl` e precisa relê-los, e sem isto a linha de texto não volta a ser
// um `JsonValue`.
//
// # Por que parser próprio e não `serde_json`
//
// A política do `Cargo.toml` autoriza dependência para CRIPTOGRAFIA de
// RustCrypto/arkworks — onde o erro é catastrófico e invisível (um pairing
// forjável) e reimplementar é o pior dos dois mundos. Ela fecha com "nada de
// conveniência", e `serde_json` já está declarado como `dev-dependency` com a
// nota explícita "não entra no binário". Promovê-lo a dependência de tempo de
// execução contrariaria as duas coisas.
//
// E a conta aqui INVERTE a da criptografia por dois motivos:
//
//   1. O modelo de números não é o nosso. `serde_json` tem variante de ponto
//      flutuante; `JsonValue` não tem, DE PROPÓSITO (ver a nota do enum). Usá-lo
//      significaria parsear para o modelo dele e depois rejeitar `f64` na
//      conversão — a regra crítica (rejeitar float, rejeitar inteiro grande
//      demais) continuaria sendo código nosso, só que agora com um passo
//      intermediário que pode arredondar antes de chegarmos a ver o número.
//   2. O modo de falha é benigno. Um erro de parser aparece como bloco recusado
//      no boot — ruidoso e imediato —, não como prova falsa que verifica em
//      silêncio. É o oposto do caso que justificou `ark-bn254`.
//
// São ~200 linhas de gramática fechada e totalmente coberta por teste, contra um
// crate inteiro na árvore de produção. A política dá este.

/// Profundidade máxima de aninhamento aceita na LEITURA.
///
/// O limite não é gosto: entrada de disco ou de rede é hostil por definição, e
/// aninhamento é o vetor clássico de estouro de pilha. O parser confere ANTES de
/// recursar, então `[[[[…` com um milhão de níveis vira `Err`, não SIGSEGV.
///
/// O teto também protege o que vem DEPOIS do parse: `escreve_valor` e o próprio
/// `Drop` de `JsonValue` (que desce por `Vec`/`BTreeMap`) são recursivos. Um valor
/// profundo demais estouraria a pilha ao ser reserializado ou até ao ser
/// destruído — pânico bem longe da causa. Aceitar só o que sabemos escrever e
/// descartar mantém o crate fechado sobre si mesmo.
///
/// 512 é folga de ordens de grandeza sobre um bloco real (profundidade ~4).
pub const MAX_JSON_DEPTH: usize = 512;

/// Lê JSON-texto para [`JsonValue`]. NUNCA entra em pânico: entrada corrompida é
/// `Err`, porque quem chama é o boot lendo o `blocks.jsonl`.
///
/// A gramática é o JSON estrito (RFC 8259), com quatro restrições deliberadas a
/// mais — cada uma justificada no ponto em que é aplicada:
///
/// - número não inteiro é REJEITADO, jamais arredondado. `JsonValue` não tem
///   variante de ponto flutuante porque dois nós com bibliotecas matemáticas
///   diferentes arredondariam diferente e divergiriam; arredondar aqui faria um
///   bloco corrompido voltar do disco parecendo válido e só se revelar como fork.
/// - inteiro fora de `i64` é REJEITADO, jamais truncado — truncar produziria um
///   valor que nunca foi gravado.
/// - chave repetida em objeto é REJEITADA, não sobrescrita. `JSON.parse` fica com
///   a última, e o `BTreeMap` também ficaria — mas então a reserialização
///   canônica emitiria UMA chave onde o disco tem duas, dando outra pré-imagem e
///   outro hash: o bloco seria lido "com sucesso" e rejeitado depois, sem nada
///   apontando a causa. Nenhum valor que este crate escreve gera chave repetida.
/// - aninhamento é limitado — ver [`MAX_JSON_DEPTH`].
///
/// A entrada é `&str`, então o UTF-8 já foi validado por Rust — é o
/// `blockstore::scan` que se recusa a decodificar bytes inválidos, e é lá que a
/// corrupção binária vira erro. Aqui sobra o UTF-8 *lógico*: escape `\uXXXX` com
/// substituto solto, que não corresponde a nenhum caractere e também é `Err`.
pub fn parse_json(texto: &str) -> Result<JsonValue, String> {
    let mut p = Leitor { b: texto.as_bytes(), i: 0 };
    p.pula_espaco();
    let v = p.valor(0)?;
    p.pula_espaco();
    // Lixo depois do valor é erro, não sobra ignorada: uma linha do `blocks.jsonl`
    // é UM bloco, e aceitar `{...}{...}` deixaria passar uma linha em que dois
    // blocos se fundiram — exatamente a corrupção que o armazém tenta detectar.
    if p.i != p.b.len() {
        return Err(format!("lixo após o valor JSON na posição {}", p.i));
    }
    Ok(v)
}

struct Leitor<'a> {
    b: &'a [u8],
    i: usize,
}

impl Leitor<'_> {
    fn atual(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }

    fn pula_espaco(&mut self) {
        while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.atual() {
            self.i += 1;
        }
    }

    /// Consome uma palavra reservada exata. `truexyz` não é `true`.
    fn palavra(&mut self, lit: &str) -> Result<(), String> {
        if self.b[self.i..].starts_with(lit.as_bytes()) {
            self.i += lit.len();
            Ok(())
        } else {
            Err(format!("esperava `{lit}` na posição {}", self.i))
        }
    }

    fn valor(&mut self, prof: usize) -> Result<JsonValue, String> {
        let Some(c) = self.atual() else {
            return Err("JSON vazio ou truncado: esperava um valor".to_string());
        };
        match c {
            b'n' => self.palavra("null").map(|_| JsonValue::Null),
            b't' => self.palavra("true").map(|_| JsonValue::Bool(true)),
            b'f' => self.palavra("false").map(|_| JsonValue::Bool(false)),
            b'"' => self.string().map(JsonValue::Str),
            b'[' => self.lista(prof),
            b'{' => self.objeto(prof),
            b'-' | b'0'..=b'9' => self.numero(),
            _ => Err(format!("token inesperado na posição {}", self.i)),
        }
    }

    /// Números: só INTEIRO que cabe em `i64` — fração, expoente e estouro são
    /// `Err`. Ver a justificativa em [`parse_json`].
    fn numero(&mut self) -> Result<JsonValue, String> {
        let inicio = self.i;
        if self.atual() == Some(b'-') {
            self.i += 1;
        }
        let d0 = self.i;
        while matches!(self.atual(), Some(c) if c.is_ascii_digit()) {
            self.i += 1;
        }
        if self.i == d0 {
            return Err(format!("número sem dígitos na posição {inicio}"));
        }
        // `01` não é JSON válido, e `canonical_json` nunca o emite. Aceitar formas
        // não canônicas faria a ida e volta deixar de ser uma bijeção.
        if self.b[d0] == b'0' && self.i - d0 > 1 {
            return Err(format!("zero à esquerda na posição {inicio}"));
        }
        // Fração ou expoente: REJEITAR, jamais arredondar.
        if matches!(self.atual(), Some(b'.' | b'e' | b'E')) {
            return Err(format!(
                "número não inteiro na posição {inicio}: o estado de consenso não admite ponto flutuante"
            ));
        }
        let bruto = std::str::from_utf8(&self.b[inicio..self.i])
            .map_err(|_| format!("número ilegível na posição {inicio}"))?;
        // `parse` já falha no estouro — o inteiro grande demais vira erro em vez de
        // ser truncado num valor que nunca foi gravado.
        bruto
            .parse::<i64>()
            .map(JsonValue::Int)
            .map_err(|_| format!("inteiro fora da faixa de i64 na posição {inicio}: {bruto}"))
    }

    fn string(&mut self) -> Result<String, String> {
        if self.atual() != Some(b'"') {
            return Err(format!("esperava `\"` na posição {}", self.i));
        }
        self.i += 1;
        // Acumula BYTES: o trecho sem escape é copiado cru (a entrada é `&str`,
        // logo já é UTF-8 válido) e o `\uXXXX` entra recodificado. Decodificar
        // caractere a caractere só custaria mais.
        let mut out: Vec<u8> = Vec::new();
        loop {
            let Some(c) = self.atual() else {
                return Err("string sem fechamento (JSON truncado)".to_string());
            };
            self.i += 1;
            match c {
                b'"' => break,
                b'\\' => self.escape(&mut out)?,
                // Controle CRU dentro de string é inválido em JSON estrito, e
                // `escreve_string` escapa todos eles — um `\n` literal aqui só
                // pode vir de corrupção ou de outro serializador.
                0..=0x1f => {
                    return Err(format!(
                        "caractere de controle cru em string na posição {}",
                        self.i - 1
                    ));
                }
                c => out.push(c),
            }
        }
        String::from_utf8(out).map_err(|_| "string com UTF-8 inválido".to_string())
    }

    fn escape(&mut self, out: &mut Vec<u8>) -> Result<(), String> {
        let Some(e) = self.atual() else {
            return Err("escape truncado no fim da entrada".to_string());
        };
        self.i += 1;
        let simples = match e {
            b'"' => Some(b'"'),
            b'\\' => Some(b'\\'),
            // `\/` é aceito na LEITURA e nunca emitido na escrita: `JSON.stringify`
            // não escapa `/`, mas outros serializadores escapam, e um bloco vindo de
            // fora pode trazê-lo. Recusá-lo tornaria a leitura mais estrita que o
            // JSON — e o campo volta idêntico de qualquer forma.
            b'/' => Some(b'/'),
            b'b' => Some(0x08),
            b'f' => Some(0x0c),
            b'n' => Some(b'\n'),
            b'r' => Some(b'\r'),
            b't' => Some(b'\t'),
            b'u' => None,
            _ => return Err(format!("escape desconhecido `\\{}` na posição {}", e as char, self.i - 1)),
        };
        if let Some(byte) = simples {
            out.push(byte);
            return Ok(());
        }
        let alto = self.hex4()?;
        let ch = if (0xD800..=0xDBFF).contains(&alto) {
            // Substituto ALTO: o par exige o baixo logo em seguida. Fora do par ele
            // não denota caractere nenhum, e `String` do Rust não pode guardá-lo.
            if self.atual() != Some(b'\\') || self.b.get(self.i + 1) != Some(&b'u') {
                return Err(format!("substituto alto sem par na posição {}", self.i));
            }
            self.i += 2;
            let baixo = self.hex4()?;
            if !(0xDC00..=0xDFFF).contains(&baixo) {
                return Err(format!("par substituto malformado na posição {}", self.i));
            }
            let cp = 0x10000 + (((alto as u32) - 0xD800) << 10) + ((baixo as u32) - 0xDC00);
            char::from_u32(cp).ok_or_else(|| format!("ponto de código inválido: U+{cp:X}"))?
        } else if (0xDC00..=0xDFFF).contains(&alto) {
            return Err(format!("substituto baixo solto na posição {}", self.i));
        } else {
            char::from_u32(alto as u32)
                .ok_or_else(|| format!("ponto de código inválido: U+{alto:X}"))?
        };
        let mut buf = [0u8; 4];
        out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
        Ok(())
    }

    fn hex4(&mut self) -> Result<u16, String> {
        if self.i + 4 > self.b.len() {
            return Err("escape `\\u` truncado".to_string());
        }
        let mut n: u16 = 0;
        for k in 0..4 {
            let c = self.b[self.i + k];
            let d = match c {
                b'0'..=b'9' => c - b'0',
                b'a'..=b'f' => c - b'a' + 10,
                b'A'..=b'F' => c - b'A' + 10,
                _ => {
                    return Err(format!(
                        "dígito hexadecimal inválido no escape `\\u` na posição {}",
                        self.i + k
                    ));
                }
            };
            n = n * 16 + d as u16;
        }
        self.i += 4;
        Ok(n)
    }

    fn lista(&mut self, prof: usize) -> Result<JsonValue, String> {
        if prof >= MAX_JSON_DEPTH {
            return Err(format!("aninhamento acima de {MAX_JSON_DEPTH} níveis na posição {}", self.i));
        }
        self.i += 1; // `[`
        let mut itens = Vec::new();
        self.pula_espaco();
        if self.atual() == Some(b']') {
            self.i += 1;
            return Ok(JsonValue::List(itens));
        }
        loop {
            self.pula_espaco();
            itens.push(self.valor(prof + 1)?);
            self.pula_espaco();
            match self.atual() {
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    break;
                }
                // Cobre tanto o truncamento (`None`) quanto a vírgula sobrando
                // (`[1,]`, cujo valor seguinte cai no `]`).
                _ => return Err(format!("esperava `,` ou `]` na posição {}", self.i)),
            }
        }
        Ok(JsonValue::List(itens))
    }

    fn objeto(&mut self, prof: usize) -> Result<JsonValue, String> {
        if prof >= MAX_JSON_DEPTH {
            return Err(format!("aninhamento acima de {MAX_JSON_DEPTH} níveis na posição {}", self.i));
        }
        self.i += 1; // `{`
        let mut m: BTreeMap<String, JsonValue> = BTreeMap::new();
        self.pula_espaco();
        if self.atual() == Some(b'}') {
            self.i += 1;
            return Ok(JsonValue::Map(m));
        }
        loop {
            self.pula_espaco();
            let pos_chave = self.i;
            let chave = self.string()?;
            self.pula_espaco();
            if self.atual() != Some(b':') {
                return Err(format!("esperava `:` na posição {}", self.i));
            }
            self.i += 1;
            self.pula_espaco();
            let valor = self.valor(prof + 1)?;
            // Chave repetida é erro, não sobrescrita — ver a justificativa em
            // `parse_json`. É aqui que a divergência de hash seria plantada.
            if m.insert(chave.clone(), valor).is_some() {
                return Err(format!("chave repetida `{chave}` na posição {pos_chave}"));
            }
            self.pula_espaco();
            match self.atual() {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    break;
                }
                _ => return Err(format!("esperava `,` ou `}}` na posição {}", self.i)),
            }
        }
        Ok(JsonValue::Map(m))
    }
}

// ------------------------------------------------------------------ a transação

/// Transação eav20.
///
/// Os campos `Option` NÃO são todos a mesma coisa, e a diferença é justamente onde
/// o JS era ambíguo — ver a nota em `tx_signing_payload`:
///
/// - `to`: SEMPRE aparece no payload. `None` vira `null` literal.
/// - `data`, `public_key`, `pq_public_key`: `None` significa AUSENTE — a chave nem
///   é emitida, porque `JSON.stringify` descarta `undefined`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tx {
    pub protocol: String,
    pub scheme: String,
    /// `type` é palavra reservada em Rust; o nome do campo no payload continua `type`.
    pub tx_type: String,
    pub from: String,
    /// `None` é emitido como `null`, não omitido.
    pub to: Option<String>,
    /// Decimal sem sinal, em e7. Texto e não inteiro porque os saldos passam de 2⁶⁴.
    pub amount: String,
    /// LIMITE de queima autorizado (feeLimit), não a taxa efetiva: a queima real
    /// sai da energia da conta e é calculada pela máquina de estado.
    pub fee: String,
    pub nonce: i64,
    /// Milissegundos desde a época Unix.
    pub timestamp: i64,
    /// Omitido do payload quando `None`.
    pub data: Option<JsonValue>,
    /// Omitido do payload quando `None`.
    pub public_key: Option<String>,
    /// Omitido do payload quando `None`.
    pub pq_public_key: Option<String>,

    // --- fora do payload assinado ---
    pub signature: Option<String>,
    pub pq_signature: Option<String>,
    /// `eav_hash(tx_signing_payload(tx))`.
    pub id: Option<String>,
}

impl Tx {
    /// Transação mínima com os campos obrigatórios; o resto fica em `None`.
    pub fn new(tx_type: impl Into<String>, from: impl Into<String>, nonce: i64, timestamp: i64) -> Self {
        Tx {
            protocol: PROTOCOL.to_string(),
            scheme: SIGNATURE_SCHEME.to_string(),
            tx_type: tx_type.into(),
            from: from.into(),
            to: None,
            amount: "0".to_string(),
            fee: "0".to_string(),
            nonce,
            timestamp,
            data: None,
            public_key: None,
            pq_public_key: None,
            signature: None,
            pq_signature: None,
            id: None,
        }
    }
}

/// O payload canônico que é assinado — e a única pré-imagem do `id`.
///
/// `signature`, `pqSignature` e `id` são excluídos: o `id` derivar só do payload
/// é o que elimina a maleabilidade de txid. Remodelar uma assinatura ECDSA de
/// `s` para `N-s` produz bytes diferentes mas o MESMO payload, logo o mesmo `id`,
/// e a deduplicação do mempool captura a cópia. Se o `id` incluísse a assinatura,
/// a mesma transação entraria duas vezes com dois ids.
///
/// # Onde a referência era ambígua
///
/// `txSigningPayload` faz desestruturação por resto sobre um objeto JS qualquer:
/// o payload é o que o objeto TIVER, não um conjunto de campos declarado. Uma
/// transação sem `data` e uma com `data: undefined` dão o mesmo payload, mas uma
/// com `data: {}` dá outro — e as duas passam pela mesma validação. Pior, um campo
/// EXTRA não previsto entra no payload em silêncio e muda o `id`. Aqui a struct é
/// fechada, o que remove o campo extra; a distinção ausente/nulo foi preservada
/// nos `Option` porque os próprios vetores dependem dela (os casos 1–3 não têm
/// `data`, os 4–5 têm).
pub fn tx_signing_payload(tx: &Tx) -> String {
    let mut campos: BTreeMap<String, JsonValue> = BTreeMap::new();
    campos.insert("protocol".into(), JsonValue::str(&tx.protocol));
    campos.insert("scheme".into(), JsonValue::str(&tx.scheme));
    campos.insert("type".into(), JsonValue::str(&tx.tx_type));
    campos.insert("from".into(), JsonValue::str(&tx.from));
    campos.insert(
        "to".into(),
        match &tx.to {
            Some(a) => JsonValue::str(a),
            None => JsonValue::Null,
        },
    );
    campos.insert("amount".into(), JsonValue::str(&tx.amount));
    campos.insert("fee".into(), JsonValue::str(&tx.fee));
    campos.insert("nonce".into(), JsonValue::Int(tx.nonce));
    campos.insert("timestamp".into(), JsonValue::Int(tx.timestamp));
    if let Some(d) = &tx.data {
        campos.insert("data".into(), d.clone());
    }
    if let Some(k) = &tx.public_key {
        campos.insert("publicKey".into(), JsonValue::str(k));
    }
    if let Some(k) = &tx.pq_public_key {
        campos.insert("pqPublicKey".into(), JsonValue::str(k));
    }
    canonical_json(&JsonValue::Map(campos))
}

/// O `id` da transação: `eav_hash` sobre o payload canônico. É o id das
/// transações do esquema padrão (`core/transaction.js:64/121`: `eavHash(payload)`).
///
/// ATENÇÃO: NÃO cobre o esquema EAVM, cujo id sai do RAW assinado
/// (`envelope.js:115`) — para deduplicar/verificar id de forma ciente do esquema,
/// use [`tx_dedup_id`].
pub fn tx_id(tx: &Tx) -> String {
    eav_hash_one(tx_signing_payload(tx))
}

/// O id CANÔNICO de deduplicação, CIENTE DO ESQUEMA.
///
/// A referência tem DUAS derivações de id: o esquema padrão usa `eavHash(payload)`
/// ([`tx_id`], `core/transaction.js:64`), e o esquema EAVM usa
/// `eavHash('EAV7-EAVM-TX:' + raw)` (`envelope.js:115`) — o id sai do RAW assinado,
/// não do payload, e os dois diferem. Quem precisa do id REAL de uma tx qualquer
/// (o mempool, para deduplicar) tem de escolher pela `scheme`; recomputar sempre
/// pelo payload rejeitaria toda tx EAVM. Um envelope EAVM sem `data.raw` cai no
/// payload — o id não vai bater, que é a rejeição correta.
pub fn tx_dedup_id(tx: &Tx) -> String {
    if tx.scheme == EAVM_SCHEME
        && let Some(JsonValue::Map(m)) = &tx.data
        && let Some(JsonValue::Str(raw)) = m.get("raw")
    {
        return eav_hash_one(format!("EAV7-EAVM-TX:{raw}"));
    }
    tx_id(tx)
}

/// Regra de `isAmountString`: decimal sem sinal, sem zero à esquerda, até 30 dígitos.
///
/// O limite de dígitos existe para que um decimal absurdo não vire um BigInt de
/// milhares de dígitos só para consumir CPU na validação.
fn e_amount_valido(s: &str) -> bool {
    if s.is_empty() || s.len() > MAX_AMOUNT_DIGITS || !s.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    s == "0" || !s.starts_with('0')
}

/// Validação STATELESS: formato, tipo e faixas. Saldo, nonce em sequência e
/// isenção de taxa são regras de ESTADO e ficam na máquina de estado.
///
/// AUTENTICAÇÃO (`transaction.js:104-121`), na ordem da referência:
///
/// 1. as duas chaves públicas têm de DERIVAR exatamente `tx.from` — sem isso
///    qualquer um assinaria em nome de qualquer conta, bastando trocar o `from`;
/// 2. a assinatura HÍBRIDA tem de valer para AS DUAS (secp256k1 + ML-DSA-44).
///    Aceitar só a clássica reintroduziria a exposição pós-quântica que o esquema
///    `eav7-hybrid-1` existe para fechar;
/// 3. só então o `id` é conferido contra o payload.
///
/// A ordem importa: conferir o id antes da assinatura diria "id não confere" para
/// uma transação forjada, escondendo a causa real.
pub fn verify_transaction(tx: &Tx) -> Result<(), String> {
    // O envelope EAVM é autenticado pela assinatura secp256k1 embutida no raw, e
    // tem regras próprias (destino re-derivado do raw). Rota separada de
    // propósito, como na referência (`src/core/transaction.js:74`): a verificação
    // re-deriva o envelope INTEIRO de `data.raw` e compara campo a campo — o
    // envelope é stateless-verificável, e um envelope adulterado nunca passa.
    if tx.scheme == EAVM_SCHEME {
        return crate::eavm::envelope::verify_eavm_envelope(tx);
    }
    if tx.protocol != PROTOCOL {
        return Err(format!("protocolo inválido (esperado {PROTOCOL})"));
    }
    if tx.scheme != SIGNATURE_SCHEME {
        return Err(format!("esquema de assinatura inválido (esperado {SIGNATURE_SCHEME})"));
    }
    if !TX_TYPES.contains(&tx.tx_type.as_str()) {
        return Err(format!("tipo de transação desconhecido: {}", tx.tx_type));
    }
    // EAVM_TRANSFER só existe pela rota EAVM, onde o destino é re-derivado do raw.
    // Pela rota híbrida seu `to` poderia ser nulo e os fundos iriam para uma conta
    // que ninguém consegue gastar — queima silenciosa de saldo.
    if tx.tx_type == "EAVM_TRANSFER" {
        return Err("EAVM_TRANSFER só é válido via esquema EAVM".into());
    }
    if !e_amount_valido(&tx.amount) {
        return Err("amount inválido".into());
    }
    if !e_amount_valido(&tx.fee) {
        return Err("fee inválida".into());
    }
    // `fee` é o TETO de queima autorizado. Cabe em u128 porque `e_amount_valido`
    // já limitou a 30 dígitos.
    let fee: u128 = tx.fee.parse().map_err(|_| "fee inválida".to_string())?;
    if fee > MAX_FEE_LIMIT {
        return Err("limite de taxa (fee) acima do máximo permitido".into());
    }
    if tx.nonce < 1 || tx.nonce > MAX_SAFE_INTEGER {
        return Err("nonce inválido".into());
    }
    if tx.timestamp <= 0 || tx.timestamp > MAX_SAFE_INTEGER {
        return Err("timestamp inválido".into());
    }
    if !is_valid_address(&tx.from) {
        return Err("endereço de origem inválido".into());
    }
    match &tx.to {
        Some(to) if !is_valid_address(to) => return Err("endereço de destino inválido".into()),
        None if REQUIRES_TO.contains(&tx.tx_type.as_str()) => {
            return Err("endereço de destino inválido".into());
        }
        _ => {}
    }
    match &tx.data {
        Some(JsonValue::Map(_)) => {}
        // Lista e escalar são rejeitados como no JS (`Array.isArray` / `typeof`):
        // o executor lê `data` por chave, e um array faria toda leitura virar
        // `undefined` em vez de erro.
        _ => return Err("campo data inválido".into()),
    }
    let data = tx.data.as_ref().expect("verificado acima");
    if canonical_json(data).len() > MAX_DATA_BYTES {
        return Err("campo data excede o limite".into());
    }
    if tx.public_key.is_none() || tx.pq_public_key.is_none() {
        return Err("chaves públicas ausentes (esquema híbrido exige as duas)".into());
    }
    if tx.signature.is_none() || tx.pq_signature.is_none() {
        return Err("assinaturas ausentes (esquema híbrido exige as duas)".into());
    }

    // As chaves públicas TÊM de derivar o remetente declarado. É o passo que
    // amarra a assinatura à conta: sem ele, uma assinatura válida de QUALQUER
    // chave passaria com um `from` arbitrário.
    let (Some(pk), Some(pqpk)) = (tx.public_key.as_deref(), tx.pq_public_key.as_deref()) else {
        return Err("chaves públicas ausentes".into());
    };
    let derivado = crate::signature::address_from_public_keys(pk, pqpk)
        .map_err(|_| "chave pública inválida".to_string())?;
    if derivado != tx.from {
        return Err("chaves públicas não correspondem ao endereço de origem".into());
    }

    let payload = tx_signing_payload(tx);
    // As DUAS assinaturas. `hybrid_verify` só devolve `true` quando ambas
    // conferem — a clássica sozinha não basta.
    let (Some(sig), Some(pqsig)) = (tx.signature.as_deref(), tx.pq_signature.as_deref()) else {
        return Err("assinaturas ausentes (esquema híbrido exige as duas)".into());
    };
    if !crate::signature::hybrid_verify(pk, pqpk, payload.as_bytes(), sig, pqsig) {
        return Err("assinatura híbrida inválida".into());
    }

    if tx.id.as_deref() != Some(eav_hash_one(&payload).as_str()) {
        return Err("id da transação não confere".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::address::derive_address_from;

    /// Transação REALMENTE assinada com a carteira de teste do crate.
    ///
    /// Usava chaves e assinaturas de mentira (`"pk"`, `"sig"`) e passava porque
    /// `verify_transaction` ainda não autenticava nada. Com a verificação híbrida
    /// no lugar, o fixture precisa assinar de verdade — e o resultado é um teste
    /// mais forte: exercita o caminho de autenticação inteiro, não só o formato.
    fn tx_valida() -> Tx {
        use crate::block::teste_util::Carteira;
        use crate::block::BlockSigner;

        let carteira = Carteira::nova(7);
        let b = derive_address_from("VETOR:bob");
        let mut tx = Tx::new("TRANSFER", carteira.endereco(), 1, 1_700_000_000_000);
        tx.to = Some(b);
        tx.amount = "1000000".into();
        tx.fee = "10000".into();
        tx.data = Some(JsonValue::map([]));
        tx.public_key = Some(carteira.public_key_pem().to_string());
        tx.pq_public_key = Some(carteira.pq_public_key_pem().to_string());
        // A assinatura cobre o PAYLOAD (sem id nem as próprias assinaturas).
        let (sig, pqsig) = carteira.sign(tx_signing_payload(&tx).as_bytes()).expect("assina");
        tx.signature = Some(sig);
        tx.pq_signature = Some(pqsig);
        tx.id = Some(tx_id(&tx));
        tx
    }

    #[test]
    fn payload_nao_contem_assinatura_nem_id() {
        let mut tx = tx_valida();
        let antes = tx_signing_payload(&tx);
        tx.signature = Some("OUTRA".into());
        tx.pq_signature = Some("OUTRA".into());
        tx.id = Some("0".repeat(64));
        assert_eq!(tx_signing_payload(&tx), antes, "maleabilidade: o id mudaria com a assinatura");
    }

    #[test]
    fn campo_ausente_difere_de_campo_nulo() {
        let mut tx = tx_valida();
        tx.data = None;
        let sem_data = tx_signing_payload(&tx);
        tx.data = Some(JsonValue::map([]));
        assert_ne!(tx_signing_payload(&tx), sem_data);
        assert!(!sem_data.contains("\"data\""));
    }

    #[test]
    fn to_nulo_aparece_no_payload() {
        let mut tx = tx_valida();
        tx.tx_type = "STAKE".into();
        tx.to = None;
        assert!(tx_signing_payload(&tx).contains("\"to\":null"));
    }

    #[test]
    fn chaves_saem_ordenadas() {
        let p = tx_signing_payload(&tx_valida());
        let ordem = ["amount", "data", "fee", "from", "nonce", "pqPublicKey", "protocol",
                     "publicKey", "scheme", "timestamp", "to", "type"];
        let mut pos = 0;
        for chave in ordem {
            let i = p.find(&format!("\"{chave}\":")).unwrap_or_else(|| panic!("faltou {chave}"));
            assert!(i > pos || pos == 0, "{chave} fora de ordem");
            pos = i;
        }
    }

    #[test]
    fn escape_segue_o_json_stringify() {
        let mut s = String::new();
        escreve_string(&mut s, "a\"b\\c\nd\te\u{01}f/g café");
        assert_eq!(s, "\"a\\\"b\\\\c\\nd\\te\\u0001f/g café\"", "barra e UTF-8 não são escapados");
    }

    #[test]
    fn valida_a_transacao_de_referencia() {
        assert_eq!(verify_transaction(&tx_valida()), Ok(()));
    }

    #[test]
    fn id_forjado_e_rejeitado() {
        let mut tx = tx_valida();
        tx.id = Some("0".repeat(64));
        assert_eq!(verify_transaction(&tx), Err("id da transação não confere".into()));
    }

    #[test]
    fn faixas_e_formatos_sao_rejeitados() {
        let base = tx_valida();
        type Mutacao = Box<dyn Fn(&mut Tx)>;
        let casos: Vec<(&str, Mutacao)> = vec![
            ("protocolo", Box::new(|t: &mut Tx| t.protocol = "eav19".into())),
            ("esquema", Box::new(|t: &mut Tx| t.scheme = "outro".into())),
            ("tipo", Box::new(|t: &mut Tx| t.tx_type = "NAO_EXISTE".into())),
            ("eavm_transfer", Box::new(|t: &mut Tx| t.tx_type = "EAVM_TRANSFER".into())),
            ("amount com zero à esquerda", Box::new(|t: &mut Tx| t.amount = "007".into())),
            ("amount negativo", Box::new(|t: &mut Tx| t.amount = "-1".into())),
            ("fee acima do teto", Box::new(|t: &mut Tx| t.fee = (MAX_FEE_LIMIT + 1).to_string())),
            ("nonce zero", Box::new(|t: &mut Tx| t.nonce = 0)),
            ("timestamp zero", Box::new(|t: &mut Tx| t.timestamp = 0)),
            ("origem inválida", Box::new(|t: &mut Tx| t.from = "E7XX".into())),
            ("destino inválido", Box::new(|t: &mut Tx| t.to = Some("E7XX".into()))),
            ("destino ausente em TRANSFER", Box::new(|t: &mut Tx| t.to = None)),
            ("data como lista", Box::new(|t: &mut Tx| t.data = Some(JsonValue::List(vec![])))),
            ("sem chave pq", Box::new(|t: &mut Tx| t.pq_public_key = None)),
            ("sem assinatura pq", Box::new(|t: &mut Tx| t.pq_signature = None)),
        ];
        for (nome, muta) in casos {
            let mut tx = base.clone();
            muta(&mut tx);
            tx.id = Some(tx_id(&tx)); // id recalculado: o erro tem de vir da regra, não do id
            assert!(verify_transaction(&tx).is_err(), "deveria rejeitar: {nome}");
        }
    }

    /// O que a verificação de assinatura existe para impedir: FORJA.
    ///
    /// `verify_transaction` não autenticava nada — validava formato e o `id`, e
    /// devolvia `Ok`. Qualquer um podia emitir uma transação em nome de qualquer
    /// conta: bastava trocar o `from` (ou reusar chaves de outra pessoa) e
    /// recalcular o `id`, que é função pública do payload. O nó a aceitaria no
    /// mempool e a incluiria num bloco.
    #[test]
    fn transacao_forjada_e_rejeitada() {
        use crate::block::teste_util::Carteira;
        use crate::block::BlockSigner;

        let vitima = Carteira::nova(11);
        let atacante = Carteira::nova(12);

        // 1. Trocar o `from` para a conta da vítima, mantendo as chaves do
        //    atacante: a derivação não bate.
        let mut tx = tx_valida();
        tx.from = vitima.endereco();
        tx.id = Some(tx_id(&tx));
        assert_eq!(
            verify_transaction(&tx),
            Err("chaves públicas não correspondem ao endereço de origem".into()),
        );

        // 2. Usar as chaves PÚBLICAS da vítima (que são públicas mesmo) com uma
        //    assinatura do atacante: a derivação bate, a assinatura não.
        let mut tx = Tx::new("TRANSFER", vitima.endereco(), 1, 1_700_000_000_000);
        tx.to = Some(derive_address_from("VETOR:bob"));
        tx.amount = "1000000".into();
        tx.fee = "10000".into();
        tx.data = Some(JsonValue::map([]));
        tx.public_key = Some(vitima.public_key_pem().to_string());
        tx.pq_public_key = Some(vitima.pq_public_key_pem().to_string());
        let (sig, pqsig) = atacante.sign(tx_signing_payload(&tx).as_bytes()).expect("assina");
        tx.signature = Some(sig);
        tx.pq_signature = Some(pqsig);
        tx.id = Some(tx_id(&tx));
        assert_eq!(verify_transaction(&tx), Err("assinatura híbrida inválida".into()));

        // 3. Alterar o VALOR de uma transação legítima já assinada.
        let mut tx = tx_valida();
        tx.amount = "999999999".into();
        tx.id = Some(tx_id(&tx));
        assert_eq!(verify_transaction(&tx), Err("assinatura híbrida inválida".into()));
    }

    /// Assinatura clássica válida NÃO basta: o esquema é híbrido.
    ///
    /// Aceitar só a secp256k1 reintroduziria exatamente a exposição pós-quântica
    /// que o `eav7-hybrid-1` existe para fechar.
    #[test]
    fn assinatura_pos_quantica_invalida_derruba_mesmo_com_a_classica_boa() {
        use crate::block::teste_util::Carteira;
        use crate::block::BlockSigner;

        let carteira = Carteira::nova(7);
        let outra = Carteira::nova(8);
        let mut tx = tx_valida();
        // Clássica correta, pós-quântica de outra carteira.
        let (_, pq_alheia) = outra.sign(tx_signing_payload(&tx).as_bytes()).expect("assina");
        tx.pq_signature = Some(pq_alheia);
        tx.id = Some(tx_id(&tx));
        assert_eq!(verify_transaction(&tx), Err("assinatura híbrida inválida".into()));
        let _ = carteira;
    }

    #[test]
    fn fee_no_teto_exato_e_aceita() {
        use crate::block::teste_util::Carteira;
        use crate::block::BlockSigner;

        // A `fee` entra no PAYLOAD assinado: mudá-la exige RE-ASSINAR, senão o
        // que este teste mediria seria a rejeição da assinatura, não o teto.
        let carteira = Carteira::nova(7);
        let mut tx = tx_valida();
        tx.fee = MAX_FEE_LIMIT.to_string();
        let (sig, pqsig) = carteira.sign(tx_signing_payload(&tx).as_bytes()).expect("assina");
        tx.signature = Some(sig);
        tx.pq_signature = Some(pqsig);
        tx.id = Some(tx_id(&tx));
        assert_eq!(verify_transaction(&tx), Ok(()));
    }

    // ------------------------------------------------------------ parse_json

    /// Amostra que cobre TODAS as variantes de `JsonValue` e os escapes que a
    /// escrita produz — é o valor sobre o qual a ida e volta é conferida.
    fn valor_amostra() -> JsonValue {
        JsonValue::map([
            ("nulo".into(), JsonValue::Null),
            ("sim".into(), JsonValue::Bool(true)),
            ("nao".into(), JsonValue::Bool(false)),
            ("zero".into(), JsonValue::Int(0)),
            ("neg".into(), JsonValue::Int(-42)),
            ("max".into(), JsonValue::Int(i64::MAX)),
            ("min".into(), JsonValue::Int(i64::MIN)),
            ("texto".into(), JsonValue::str("a\"b\\c\nd\te\u{01}f/g café 😀")),
            ("vazia".into(), JsonValue::str("")),
            ("lista_vazia".into(), JsonValue::List(vec![])),
            ("mapa_vazio".into(), JsonValue::map([])),
            (
                "lista".into(),
                JsonValue::List(vec![
                    JsonValue::Int(1),
                    JsonValue::str("dois"),
                    JsonValue::Null,
                    JsonValue::map([("dentro".into(), JsonValue::List(vec![JsonValue::Bool(true)]))]),
                ]),
            ),
            // Chaves fora do BMP e de controle: exercitam a ordenação UTF-16 e o
            // escape na volta.
            ("\u{1F600}".into(), JsonValue::str("emoji na chave")),
            ("\u{E000}".into(), JsonValue::str("uso privado")),
            ("com\nquebra".into(), JsonValue::Int(7)),
        ])
    }

    #[test]
    fn ida_e_volta_fecha_com_o_canonical_json() {
        let v = valor_amostra();
        let texto = canonical_json(&v);
        let volta = parse_json(&texto).expect("o que escrevemos tem de voltar");
        assert_eq!(volta, v, "parse_json(canonical_json(v)) != v");
        // E a ida e volta é ESTÁVEL: reserializar dá byte a byte o mesmo texto,
        // que é o que mantém o hash do bloco relido igual ao do gravado.
        assert_eq!(canonical_json(&volta), texto);
    }

    #[test]
    fn escalares_no_topo_tambem_voltam() {
        for v in [
            JsonValue::Null,
            JsonValue::Bool(true),
            JsonValue::Bool(false),
            JsonValue::Int(0),
            JsonValue::Int(-1),
            JsonValue::str("x"),
            JsonValue::List(vec![]),
            JsonValue::map([]),
        ] {
            assert_eq!(parse_json(&canonical_json(&v)), Ok(v.clone()), "falhou em {v:?}");
        }
    }

    #[test]
    fn ponto_flutuante_e_rejeitado_e_nao_arredondado() {
        // Arredondar qualquer um destes faria um bloco corrompido voltar do disco
        // parecendo válido — é o modo de falha silencioso que o teste existe para
        // fechar. Nenhum pode virar Int.
        for entrada in [
            "1.0", "0.5", "-0.5", "1e3", "1E3", "1e+3", "1.5e-3", "3.14159",
            "{\"a\":1.0}", "[1,2.5]", "9007199254740993.0",
        ] {
            let r = parse_json(entrada);
            assert!(r.is_err(), "deveria rejeitar float: {entrada} (deu {r:?})");
        }
    }

    #[test]
    fn inteiro_grande_demais_e_rejeitado_e_nao_truncado() {
        // Uma unidade acima e abaixo da faixa de i64, e um absurdo de 40 dígitos.
        for entrada in [
            "9223372036854775808",
            "-9223372036854775809",
            "1234567890123456789012345678901234567890",
            "{\"n\":99999999999999999999}",
        ] {
            assert!(parse_json(entrada).is_err(), "deveria rejeitar: {entrada}");
        }
        // As bordas EXATAS continuam válidas — o corte é onde tem de ser.
        assert_eq!(parse_json("9223372036854775807"), Ok(JsonValue::Int(i64::MAX)));
        assert_eq!(parse_json("-9223372036854775808"), Ok(JsonValue::Int(i64::MIN)));
    }

    #[test]
    fn formas_nao_canonicas_de_numero_sao_rejeitadas() {
        for entrada in ["01", "-01", "+1", "1.", ".1", "-", "1e", "00", "0x10"] {
            assert!(parse_json(entrada).is_err(), "deveria rejeitar: {entrada}");
        }
    }

    #[test]
    fn escapes_e_unicode() {
        // Nos casos abaixo `@` marca a BARRA INVERTIDA e é trocada antes do parse:
        // escrever `\\u0001` cru dentro de string Rust duplicaria toda barra e
        // deixaria o caso de teste ilegível justo onde a legibilidade importa.
        assert_eq!(
            parse_json(&r#""a@"b@@c@/d@be@ff@ng@rh@ti""#.replace('@', "\\")),
            Ok(JsonValue::str("a\"b\\c/d\u{08}e\u{0c}f\ng\rh\ti"))
        );
        // @uXXXX simples: controle, acentuado (BMP) e símbolo de três bytes.
        assert_eq!(
            parse_json(&r#""@u0001@u00e9@u20ac""#.replace('@', "\\")),
            Ok(JsonValue::str("\u{01}\u{e9}\u{20ac}"))
        );
        // Hexadecimal em maiúscula dá o mesmo caractere que em minúscula.
        assert_eq!(
            parse_json(&r#""@u00E9""#.replace('@', "\\")),
            Ok(JsonValue::str("\u{e9}"))
        );
        // Par substituto: U+1F600 escrito como @ud83d@ude00.
        assert_eq!(
            parse_json(&r#""@ud83d@ude00""#.replace('@', "\\")),
            Ok(JsonValue::str("\u{1F600}"))
        );
        // UTF-8 cru na entrada é preservado sem tocar.
        assert_eq!(
            parse_json("\"cafe \u{1F600}\""),
            Ok(JsonValue::str("cafe \u{1F600}"))
        );
        // E o emoji lido pelo PAR volta a sair como UTF-8 cru, não reescapado: é a
        // forma que o `JSON.stringify` emite e que a rede assinou. Reescapá-lo daria
        // outra pré-imagem e outro hash para o mesmo bloco.
        let v = parse_json(&r#""@ud83d@ude00""#.replace('@', "\\")).expect("par válido");
        assert_eq!(canonical_json(&v), "\"\u{1F600}\"");
    }

    #[test]
    fn escapes_invalidos_sao_erro() {
        for cru in [
            r#""@ud83d""#,        // substituto alto sozinho
            r#""@ude00""#,        // substituto baixo solto
            r#""@ud83dx""#,       // alto seguido de caractere comum
            r#""@ud83d@u0041""#,  // alto seguido de não-substituto
            r#""@ud83d@ud83d""#,  // dois altos
            r#""@u00g1""#,        // hexadecimal inválido
            r#""@u00""#,          // @u truncado
            r#""@q""#,            // escape desconhecido
            r#""fim@"#,           // barra no fim da entrada
        ] {
            let entrada = cru.replace('@', "\\");
            assert!(parse_json(&entrada).is_err(), "deveria rejeitar: {entrada}");
        }
        // Controle CRU dentro de string (a escrita sempre o escapa).
        assert!(parse_json("\"quebra\ncrua\"").is_err());
        assert!(parse_json("\"tab\tcru\"").is_err());
    }

    #[test]
    fn chave_repetida_e_erro() {
        // Ficar com a última (como o `JSON.parse`) reserializaria UMA chave onde o
        // disco tem duas — outro hash, sem nada apontando a causa.
        let r = parse_json(r#"{"a":1,"a":2}"#);
        assert!(r.is_err(), "chave repetida tem de ser erro, deu {r:?}");
        // A repetição também é pega quando uma das cópias vem escapada: a
        // comparação é do valor decodificado, não do texto.
        let escapada = r#"{"@u0061":1,"a":2}"#.replace('@', "\\");
        assert!(parse_json(&escapada).is_err(), "`@u0061` é a mesma chave que `a`");
        // Chaves de fato distintas passam.
        assert!(parse_json(r#"{"a":1,"b":2}"#).is_ok());
    }

    #[test]
    fn aninhamento_profundo_nao_estoura_a_pilha() {
        // 200 mil níveis: um parser recursivo sem guarda morre aqui com SIGSEGV,
        // que é a diferença entre "erro" e "nó derrubado por uma linha de disco".
        let fundo = "[".repeat(200_000);
        assert!(parse_json(&fundo).is_err(), "profundo demais tem de ser Err");
        let fundo_fechado = format!("{}{}", "[".repeat(200_000), "]".repeat(200_000));
        assert!(parse_json(&fundo_fechado).is_err());
        let objetos = "{\"a\":".repeat(200_000);
        assert!(parse_json(&objetos).is_err());

        // Logo abaixo do teto ainda passa — o limite corta o abuso, não o uso.
        let n = MAX_JSON_DEPTH - 1;
        let ok = format!("{}{}", "[".repeat(n), "]".repeat(n));
        let v = parse_json(&ok).expect("abaixo do teto tem de passar");
        assert_eq!(canonical_json(&v), ok, "ida e volta fecha no limite");
    }

    #[test]
    fn truncado_lixo_e_vazio_sao_erro_sem_panico() {
        for entrada in [
            "",                       // vazio
            "   ",                    // só espaço
            "{",                      // truncado
            "{\"a\"",
            "{\"a\":",
            "{\"a\":1",
            "[1,2",
            "\"sem fim",
            "{\"a\":1}lixo",          // lixo no fim
            "{\"a\":1} {\"b\":2}",    // dois valores na mesma linha
            "nul",
            "truex",                  // palavra reservada com sufixo
            "[1,]",                   // vírgula sobrando
            "{\"a\":1,}",
            "{a:1}",                  // chave sem aspas
            "{\"a\" 1}",              // faltou `:`
            "[1 2]",                  // faltou `,`
            "}",
            "]",
            ",",
        ] {
            let r = parse_json(entrada);
            assert!(r.is_err(), "deveria rejeitar: {entrada:?} (deu {r:?})");
        }
    }

    #[test]
    fn espaco_em_branco_e_tolerado_fora_das_strings() {
        // A linha do disco é sempre compacta, mas JSON de rede/config vem espaçado.
        let v = parse_json(" { \"a\" : [ 1 , 2 ] , \"b\" : null } \n").expect("espaços");
        assert_eq!(canonical_json(&v), "{\"a\":[1,2],\"b\":null}");
    }

    #[test]
    fn payload_da_transacao_volta_e_reproduz_o_id() {
        // O caso que de fato importa: o payload assinado sai, volta e a
        // reserialização é idêntica — logo o `id` recomputado é o mesmo.
        let tx = tx_valida();
        let payload = tx_signing_payload(&tx);
        let v = parse_json(&payload).expect("o payload que assinamos tem de voltar");
        assert_eq!(canonical_json(&v), payload);
        assert_eq!(eav_hash_one(canonical_json(&v)), eav_hash_one(&payload));
    }

    #[test]
    fn ordenacao_de_chave_e_por_utf16() {
        // U+E000 vs U+1F600: em UTF-16 o emoji (0xD83D…) vem ANTES; em UTF-8, depois.
        assert_eq!(cmp_utf16("\u{E000}", "\u{1F600}"), std::cmp::Ordering::Greater);
        assert!("\u{E000}" < "\u{1F600}", "ordem de byte UTF-8 é a oposta — por isso não a usamos");
    }
}
