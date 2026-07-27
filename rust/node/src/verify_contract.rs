//! Verificação de contratos EAVM — porte da lógica de `Eav7Node.verifyContract`
//! (`src/node/node.js:73-141`) e `getVerifiedContract` (`node.js:143-145`).
//!
//! # O que é (e o que NÃO é)
//!
//! Esta é a peça #8 do roadmap L1. É metadado NÃO-CONSENSUAL: o registro de
//! contratos verificados vive FORA do `stateRoot` (o comentário de `node.js:53`
//! diz isso literalmente — "metadados NÃO-consensuais, fora do stateRoot").
//! Nenhum byte daqui entra em bloco, hash ou assinatura. Ainda assim a FIDELIDADE
//! importa: o eavscan mostra o grau de casamento (`full`/`immutable`/`partial`) e
//! um verificador que divergisse da referência marcaria contratos legítimos como
//! não-verificados (ou o contrário). Por isso o porte é linha a linha.
//!
//! # Por que comparar byte a byte NÃO funciona (node.js:62-66)
//!
//! Variáveis `immutable` do Solidity são gravadas no DEPLOY, não na compilação.
//! O compilador entrega ZEROS onde o código on-chain tem o valor gravado. Um
//! único `immutable` (ex.: `decimals`) já reprovaria um contrato legítimo. O solc
//! informa os offsets em `immutableReferences`; mascaramos essas faixas com zeros
//! nos DOIS lados antes de comparar — a mesma técnica de Sourcify/Etherscan.
//!
//! # Pureza (regra do crate — ver `lib.rs`)
//!
//! Esta função NÃO lê o estado, NÃO abre socket e NÃO lê relógio. Recebe o código
//! on-chain (a casca `Node::verify_contract` o resolve de `state.contracts`) e o
//! instante `now` (a casca passa `Date.now()`), e devolve `Ok(VerifiedContract)`
//! ou `Err(mensagem)`. Toda mensagem de erro é IDÊNTICA à do `throw` do JS, pois
//! a rota (`api.js:550-557`) as repassa cruas ao cliente como `400 {error}`.

use eav7::hash::eav_hash_one;

/// Configuração do otimizador do solc, como o standard-JSON a emite.
///
/// Espelha `node.js:133`: `optimizer ? { enabled: !!optimizer.enabled, runs:
/// Number(optimizer.runs) || 0 } : null`. A presença é semântica — um
/// `{ enabled: false }` continua sendo `Some` (o objeto é *truthy* em JS), então
/// a casca só produz `None` quando o campo veio ausente/`null`/*falsy*.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Optimizer {
    pub enabled: bool,
    pub runs: u64,
}

/// Uma faixa de `immutableReferences` do solc, em BYTES. O `start`/`length`
/// chegam como `f64` DE PROPÓSITO: o JS faz `Number(r.start)` e depois
/// `Number.isInteger(...)` — um valor fracionário, `NaN` ou infinito tem de
/// REPROVAR com `immutableReferences inválido`, e só um `f64` carrega essa
/// distinção da fronteira até a validação (mantida aqui, numa peça só).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImmutableSpan {
    pub start: f64,
    pub length: f64,
}

/// Parâmetros da verificação — o corpo do `POST /contract/{addr}/verify`
/// já desestruturado. Espelha o destructuring de `node.js:73-76`. Os defaults
/// do JS (`language='solidity'`, `compiler=''`, `evmVersion=''`, `contractName=''`)
/// são aplicados pela CASCA ao montar isto (o parser do corpo), não aqui.
#[derive(Debug, Clone)]
pub struct VerifyParams {
    pub source: String,
    pub language: String,
    pub compiler: String,
    /// Bytecode submetido — pode ou não ter `0x`; a normalização acontece aqui.
    pub bytecode: String,
    pub evm_version: String,
    pub optimizer: Option<Optimizer>,
    /// `immutableReferences` do solc já ACHATADO: `{ idAST: [{start,length}] }`
    /// vira uma lista única de faixas (a casca faz o `Object.values(...).flat()`).
    /// A ordem é irrelevante — mascarar é comutativo e a validação é por-faixa.
    pub immutable_references: Vec<ImmutableSpan>,
    pub contract_name: String,
}

/// O registro de um contrato verificado — a folha do `Map` `verifiedContracts`
/// (`node.js:127-138`). Campo a campo igual ao objeto do JS; os nomes em
/// `snake_case` viram `camelCase` na serialização (`to_json`), que é o que o
/// eavscan lê.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedContract {
    pub address: String,
    pub contract_name: String,
    pub language: String,
    pub compiler: String,
    pub evm_version: String,
    pub optimizer: Option<Optimizer>,
    /// `'full' | 'immutable' | 'partial'` — o grau, mostrado pelo explorer, não
    /// escondido atrás de um selo booleano (node.js:134).
    pub match_grade: String,
    pub source: String,
    /// SHA3-256 do código on-chain BRUTO (com `0x`, como armazenado). node.js:126
    /// faz `createHash('sha3-256').update(onchainRaw)` — a hash do protocolo eav20.
    pub code_hash: String,
    /// Timestamp (ms). `Date.now()` no JS; aqui o `now` é injetado pela casca —
    /// a lógica pura não lê relógio.
    pub verified_at: i64,
}

impl VerifiedContract {
    /// Serialização de apresentação — as chaves em `camelCase` de `node.js:127`.
    /// `optimizer` sai como objeto `{enabled,runs}` ou `null`, como no JS.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "address": self.address,
            "contractName": self.contract_name,
            "language": self.language,
            "compiler": self.compiler,
            "evmVersion": self.evm_version,
            "optimizer": match &self.optimizer {
                Some(o) => serde_json::json!({ "enabled": o.enabled, "runs": o.runs }),
                None => serde_json::Value::Null,
            },
            "match": self.match_grade,
            "source": self.source,
            "codeHash": self.code_hash,
            "verifiedAt": self.verified_at,
        })
    }
}

/// Remove UM prefixo `0x` (minúsculo, como o `replace(/^0x/, '')` do JS, que é
/// *case-sensitive*) e baixa a caixa — a ordem do JS: `replace` e depois
/// `toLowerCase`.
fn strip_and_lower(s: &str) -> String {
    let sem_prefixo = s.strip_prefix("0x").unwrap_or(s);
    sem_prefixo.to_lowercase()
}

/// `/^[0-9a-f]*$/` do JS (node.js:86): hex minúsculo, string VAZIA passa (`*`).
fn is_hex_lower(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Mascara com `0` (zera os bytes) as faixas dadas, em hex. Cada byte são 2 chars
/// hex, então a faixa `[start, start+length)` em BYTES vira `[start*2,
/// (start+length)*2)` em chars. Espelha `mask` de node.js:105-110 (o `b.fill(0,
/// start, start+length)` sobre um `Buffer`). Sem faixas, devolve o hex intocado.
fn mask(hex: &str, spans: &[(usize, usize)]) -> String {
    if spans.is_empty() {
        return hex.to_string();
    }
    // Hex é ASCII → índice de byte == índice de char; operar sobre os bytes é seguro.
    let mut b = hex.as_bytes().to_vec();
    for &(start, length) in spans {
        let from = start.saturating_mul(2);
        let to = start.saturating_add(length).saturating_mul(2).min(b.len());
        for byte in b.iter_mut().take(to).skip(from) {
            *byte = b'0';
        }
    }
    // Só escrevemos `b'0'` (ASCII) sobre hex ASCII → sempre UTF-8 válido; o
    // `unwrap_or_default` é cinto de segurança, jamais dispara (sem pânico).
    String::from_utf8(b).unwrap_or_default()
}

/// A verificação PURA. `onchain_raw` é `state.contracts[addr].code` cru (com `0x`,
/// caixa original); `now_ms` é o instante injetado. Erros e graus reproduzidos de
/// `node.js:77-140`.
pub fn verify_contract(
    address: &str,
    onchain_raw: &str,
    params: VerifyParams,
    now_ms: i64,
) -> Result<VerifiedContract, String> {
    let addr = address.to_lowercase();

    // node.js:78-79 — `state.contracts[addr]?.code` *falsy* (ausente OU `''`) é
    // "não encontrado on-chain". Um contrato materializado sem código cai aqui,
    // exatamente como o `if (!onchainRaw)` do JS (`''` é *falsy*).
    if onchain_raw.is_empty() {
        return Err("contrato não encontrado on-chain".to_string());
    }

    // node.js:80-82 — o `source` valida ANTES do bytecode. `.length` do JS conta
    // unidades UTF-16; `encode_utf16().count()` reproduz isso exatamente (para
    // ASCII é idêntico a contar bytes, mas emojis/acentos divergiriam).
    let source_len = params.source.encode_utf16().count();
    if source_len == 0 || source_len > 200_000 {
        return Err("source inválido (1..200000 chars)".to_string());
    }

    let onchain = strip_and_lower(onchain_raw);
    let provided = strip_and_lower(&params.bytecode);

    // node.js:86 — bytecode tem de ser hex minúsculo (vazio passa).
    if !is_hex_lower(&provided) {
        return Err("bytecode deve ser hex".to_string());
    }
    // node.js:87-89 — tamanhos em BYTES na mensagem (metade dos chars hex).
    if provided.len() != onchain.len() {
        return Err(format!(
            "tamanho do bytecode difere (on-chain {}B, enviado {}B)",
            onchain.len() / 2,
            provided.len() / 2
        ));
    }

    // node.js:93-104 — achata/valida `immutableReferences`. Aqui já chega achatado;
    // a validação por-faixa (integralidade, limites) é o que resta.
    let mut spans: Vec<(usize, usize)> = Vec::new();
    for s in &params.immutable_references {
        let (start, length) = (s.start, s.length);
        // `Number.isInteger(x)` = finito e sem parte fracionária; mais `start >= 0`
        // e `length > 0` (node.js:98).
        let inteiro = |x: f64| x.is_finite() && x.fract() == 0.0;
        if !inteiro(start) || !inteiro(length) || start < 0.0 || length <= 0.0 {
            return Err("immutableReferences inválido".to_string());
        }
        let (start, length) = (start as usize, length as usize);
        // node.js:101 — `(start + length) * 2 > onchain.length` (chars).
        if start.saturating_add(length).saturating_mul(2) > onchain.len() {
            return Err("immutableReferences fora do bytecode".to_string());
        }
        spans.push((start, length));
    }

    // node.js:112-124 — o grau do casamento, na MESMA ordem de tentativa.
    let match_grade = if provided == onchain {
        // node.js:113 — idêntico byte a byte.
        "full"
    } else if !spans.is_empty() && mask(&provided, &spans) == mask(&onchain, &spans) {
        // node.js:114 — idêntico fora das faixas `immutable`.
        "immutable"
    } else {
        // node.js:116-122 — metadados CBOR do solc ficam no FIM; os 2 últimos
        // bytes (4 chars hex) dão o TAMANHO do bloco de metadados. Código igual
        // com metadado diferente é o "partial match" do mercado.
        //
        // `parseInt(onchain.slice(-4), 16)`: `slice(-4)` pega os 4 últimos chars
        // (ou a string inteira se for menor). `from_str_radix` falho → sem corte.
        let ultimos = if onchain.len() >= 4 {
            &onchain[onchain.len() - 4..]
        } else {
            onchain.as_str()
        };
        let meta_len = u64::from_str_radix(ultimos, 16).ok();
        // node.js:118-121 — `cut` só existe se `metaLen > 0` e `(metaLen+2)*2 <
        // onchain.length`. Tudo em chars hex.
        let cut = meta_len.and_then(|m| {
            if m == 0 {
                return None;
            }
            let corte_meta = (m as usize).saturating_add(2).saturating_mul(2);
            if corte_meta < onchain.len() {
                Some(onchain.len() - corte_meta)
            } else {
                None
            }
        });
        match cut {
            Some(cut)
                if cut > 0 && mask(&provided, &spans)[..cut] == mask(&onchain, &spans)[..cut] =>
            {
                "partial"
            }
            _ => return Err("bytecode não confere com o código on-chain".to_string()),
        }
    };

    // node.js:126 — SHA3-256 do código on-chain BRUTO (com `0x`, caixa original),
    // via a hash do protocolo (eav_hash_one = sha3-256, hex minúsculo).
    let code_hash = eav_hash_one(onchain_raw.as_bytes());

    Ok(VerifiedContract {
        address: addr,
        contract_name: params.contract_name,
        language: params.language,
        compiler: params.compiler,
        evm_version: params.evm_version,
        optimizer: params.optimizer,
        match_grade: match_grade.to_string(),
        source: params.source,
        code_hash,
        verified_at: now_ms,
    })
}

// ---------------------------------------------------------------------------
// Ajuda ao parser da casca: achatar `immutableReferences` do JSON do corpo.
// ---------------------------------------------------------------------------

/// `Object.values(immutableReferences ?? {}).flat()` com a coerção `Number(...)`
/// de node.js:96-97. Recebe o valor JSON do campo (objeto, `null` ou ausente) e
/// devolve as faixas achatadas. A VALIDAÇÃO (integralidade/limites) é da função
/// pura acima — aqui só coletamos, para não duplicar as mensagens de erro.
///
/// `Number(x)`: número → ele mesmo; string → parse (`NaN` se falhar); `null` → 0;
/// resto (`undefined`, objeto, bool) → `NaN`. O `NaN` reprova na função pura.
pub fn flatten_immutable_refs(v: &serde_json::Value) -> Vec<ImmutableSpan> {
    fn js_number(v: Option<&serde_json::Value>) -> f64 {
        match v {
            Some(serde_json::Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
            Some(serde_json::Value::String(s)) => s.trim().parse::<f64>().unwrap_or(f64::NAN),
            Some(serde_json::Value::Null) | None => match v {
                None => f64::NAN,       // `undefined` (campo ausente) → NaN
                Some(_) => 0.0,         // `Number(null) === 0`
            },
            _ => f64::NAN,
        }
    }
    let mut out = Vec::new();
    if let serde_json::Value::Object(map) = v {
        for refs in map.values() {
            // `for (const r of refs ?? [])`: só arrays contribuem; outro tipo é
            // ignorado (o JS lançaria TypeError num não-iterável — entrada inválida
            // de qualquer forma; aqui degradamos para "sem faixas" em vez de pânico).
            if let serde_json::Value::Array(items) = refs {
                for r in items {
                    out.push(ImmutableSpan {
                        start: js_number(r.get("start")),
                        length: js_number(r.get("length")),
                    });
                }
            }
        }
    }
    out
}

/// Monta [`VerifyParams`] a partir do corpo JSON do `POST` — aplica os defaults de
/// `node.js:73-76`. Fica aqui (perto da lógica) para o teste do parser andar junto
/// da verificação. `bytecode` ausente vira `''` (`bytecode ?? ''`), que a função
/// pura rejeita depois só se o tamanho não bater.
pub fn params_from_json(body: &serde_json::Value) -> VerifyParams {
    let s = |k: &str| body.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let s_or = |k: &str, dflt: &str| {
        body.get(k).and_then(|v| v.as_str()).map(str::to_string).unwrap_or_else(|| dflt.to_string())
    };
    // `optimizer ? {...} : null` — objeto *truthy* vira Some; `null`/ausente/*falsy* → None.
    let optimizer = match body.get("optimizer") {
        Some(o) if o.is_object() => Some(Optimizer {
            // `!!optimizer.enabled` — truthiness do campo.
            enabled: json_truthy(o.get("enabled")),
            // `Number(optimizer.runs) || 0` — inteiro não-positivo/NaN → 0.
            runs: o.get("runs").and_then(|r| r.as_u64()).unwrap_or(0),
        }),
        _ => None,
    };
    let immutable_references = body
        .get("immutableReferences")
        .map(flatten_immutable_refs)
        .unwrap_or_default();
    VerifyParams {
        source: s("source"),
        language: s_or("language", "solidity"),
        compiler: s("compiler"),
        bytecode: s("bytecode"),
        evm_version: s("evmVersion"),
        optimizer,
        immutable_references,
        contract_name: s("contractName"),
    }
}

/// `!!x` do JS: `undefined`/`null`/`false`/`0`/`""` → false; o resto → true.
fn json_truthy(v: Option<&serde_json::Value>) -> bool {
    match v {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::Number(n)) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
        Some(serde_json::Value::String(s)) => !s.is_empty(),
        Some(_) => true, // objeto/array são truthy
    }
}

// ---------------------------------------------------------------------------
// Testes — a lógica é PURA, então cada grau é um vetor pequeno e exato.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn params(bytecode: &str) -> VerifyParams {
        VerifyParams {
            source: "contract C {}".to_string(),
            language: "solidity".to_string(),
            compiler: "0.8.24".to_string(),
            bytecode: bytecode.to_string(),
            evm_version: "cancun".to_string(),
            optimizer: None,
            immutable_references: Vec::new(),
            contract_name: "C".to_string(),
        }
    }

    #[test]
    fn full_match_identico_byte_a_byte() {
        let onchain = "0x6001600260ab";
        let r = verify_contract("0xABc", onchain, params("0x6001600260ab"), 123).unwrap();
        assert_eq!(r.match_grade, "full");
        // Endereço baixado de caixa (node.js:77).
        assert_eq!(r.address, "0xabc");
        // codeHash = sha3-256 do código on-chain BRUTO (com 0x, caixa original).
        assert_eq!(r.code_hash, eav_hash_one(onchain.as_bytes()));
        assert_eq!(r.verified_at, 123);
        // `0x` no bytecode enviado é opcional — normalizado igual ao on-chain.
        let r2 = verify_contract("0xabc", onchain, params("6001600260ab"), 1).unwrap();
        assert_eq!(r2.match_grade, "full");
    }

    #[test]
    fn immutable_match_com_faixa_mascarada() {
        // 4 bytes: o byte de índice 1 difere (bb on-chain, 00 no enviado) — é
        // exatamente uma variável `immutable` gravada no deploy.
        let onchain = "0xaabbccdd";
        let mut p = params("0xaa00ccdd");
        p.immutable_references = vec![ImmutableSpan { start: 1.0, length: 1.0 }];
        let r = verify_contract("0xc0", onchain, p, 0).unwrap();
        assert_eq!(r.match_grade, "immutable");
    }

    #[test]
    fn immutable_sem_faixa_nao_e_full_reprova() {
        // Mesmo par de bytes do teste acima, MAS sem declarar a faixa: não há
        // máscara, não bate byte a byte, e não há metadados CBOR válidos → erro.
        let onchain = "0xaabbccdd";
        let e = verify_contract("0xc0", onchain, params("0xaa00ccdd"), 0).unwrap_err();
        assert_eq!(e, "bytecode não confere com o código on-chain");
    }

    #[test]
    fn partial_match_metadado_cbor_diferente() {
        // [code=6001][meta=aa (1 byte)][len=0001] — metaLen=1, corte após "6001".
        let onchain = "0x6001aa0001";
        // Mesmo código, metadado diferente (bb) e o mesmo campo de tamanho.
        let r = verify_contract("0xc0", onchain, params("0x6001bb0001"), 7).unwrap();
        assert_eq!(r.match_grade, "partial");
        assert_eq!(r.verified_at, 7);
    }

    #[test]
    fn tamanho_diferente_da_erro_com_bytes() {
        let onchain = "0x6001600260ab"; // 6 bytes
        let e = verify_contract("0xc0", onchain, params("0x60"), 0).unwrap_err();
        assert_eq!(e, "tamanho do bytecode difere (on-chain 6B, enviado 1B)");
    }

    #[test]
    fn bytecode_nao_hex_da_erro() {
        let onchain = "0x6001";
        // 'zz' não é hex → falha ANTES da checagem de tamanho.
        let e = verify_contract("0xc0", onchain, params("0xzzzz"), 0).unwrap_err();
        assert_eq!(e, "bytecode deve ser hex");
    }

    #[test]
    fn source_vazio_ou_gigante_da_erro() {
        let onchain = "0x6001";
        let mut p = params("0x6001");
        p.source = String::new();
        let e = verify_contract("0xc0", onchain, p, 0).unwrap_err();
        assert_eq!(e, "source inválido (1..200000 chars)");

        let mut p = params("0x6001");
        p.source = "a".repeat(200_001);
        let e = verify_contract("0xc0", onchain, p, 0).unwrap_err();
        assert_eq!(e, "source inválido (1..200000 chars)");
    }

    #[test]
    fn contrato_ausente_on_chain_da_erro() {
        // Código on-chain vazio ('' é *falsy* no JS) → "não encontrado on-chain".
        let e = verify_contract("0xc0", "", params("0x6001"), 0).unwrap_err();
        assert_eq!(e, "contrato não encontrado on-chain");
    }

    #[test]
    fn immutable_references_fora_do_bytecode_da_erro() {
        let onchain = "0xaabbccdd"; // 4 bytes
        let mut p = params("0xaabbccdd");
        // start+length = 5 bytes > 4 → fora do bytecode.
        p.immutable_references = vec![ImmutableSpan { start: 3.0, length: 2.0 }];
        let e = verify_contract("0xc0", onchain, p, 0).unwrap_err();
        assert_eq!(e, "immutableReferences fora do bytecode");
    }

    #[test]
    fn immutable_references_fracionario_da_erro() {
        let onchain = "0xaabbccdd";
        let mut p = params("0xaa00ccdd");
        p.immutable_references = vec![ImmutableSpan { start: 1.5, length: 1.0 }];
        let e = verify_contract("0xc0", onchain, p, 0).unwrap_err();
        assert_eq!(e, "immutableReferences inválido");
    }

    #[test]
    fn to_json_usa_camel_case_e_optimizer_objeto() {
        let onchain = "0x6001";
        let mut p = params("0x6001");
        p.optimizer = Some(Optimizer { enabled: true, runs: 200 });
        let r = verify_contract("0xC0", onchain, p, 42).unwrap();
        let j = r.to_json();
        assert_eq!(j["address"], "0xc0");
        assert_eq!(j["contractName"], "C");
        assert_eq!(j["match"], "full");
        assert_eq!(j["optimizer"]["enabled"], true);
        assert_eq!(j["optimizer"]["runs"], 200);
        assert_eq!(j["verifiedAt"], 42);
        assert_eq!(j["codeHash"], eav_hash_one(onchain.as_bytes()));
    }

    #[test]
    fn params_from_json_aplica_defaults_e_achata_refs() {
        let body = serde_json::json!({
            "source": "x",
            "bytecode": "0xaa00",
            "immutableReferences": { "42": [{ "start": 1, "length": 1 }] },
            "optimizer": { "enabled": true, "runs": 999 },
        });
        let p = params_from_json(&body);
        assert_eq!(p.language, "solidity"); // default
        assert_eq!(p.compiler, "");         // default
        assert_eq!(p.source, "x");
        assert_eq!(p.immutable_references.len(), 1);
        assert_eq!(p.immutable_references[0].start, 1.0);
        assert_eq!(p.optimizer.as_ref().unwrap().runs, 999);
        assert!(p.optimizer.as_ref().unwrap().enabled);
    }
}
