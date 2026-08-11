//! CLI cliente da blockchain EAV7 — porte de `bin/eav7.js` (346 linhas).
//!
//! Binário de LINHA DE COMANDO que gera carteira, consulta o nó pela API HTTP e
//! monta/submete transações assinadas. É o SEGUNDO binário do crate `eav7-node`
//! (o outro é `eav7-node`, o launcher/servidor em `main.rs`): estar no mesmo crate
//! reusa `wallet.rs` (a `ProductionWallet` que ASSINA), `ai/bridge.rs` (o
//! serializador canônico `tx_to_json`) e a lib de consenso `eav7` sem crate novo.
//!
//! # Fronteira preservada
//!
//! JSON DE CONSENSO (o payload assinado, o corpo do POST /tx) sai do serializador
//! CANÔNICO da lib (`tx_signing_payload`/`ai::bridge::tx_to_json`), byte a byte
//! igual ao que `buildTransaction` de `src/core/transaction.js:30-65` produz. JSON
//! DE APRESENTAÇÃO (as respostas do nó que só imprimimos) passa por `serde_json` —
//! nunca é hasheado nem re-assinado. É a mesma linha do `Cargo.toml` deste crate.
//!
//! # O que este binário NÃO faz
//!
//! `ai worker`, `ai sentinel`, `node start` e `mine` do JS SOBEM serviços de longa
//! duração. Aqui eles viraram FLAGS do binário `eav7-node` (`--oracle-wallet`,
//! `--sentinel`, e o próprio `eav7-node`) — reimplementar o launcher seria
//! duplicá-lo. Estes subcomandos só imprimem o comando equivalente e saem.
//!
//! # Regras herdadas do enunciado do porte
//!
//!   • parser de `--flag` MANUAL (sem `clap` — política de dependências), no mesmo
//!     estilo do `parse_args` de `main.rs`;
//!   • SEM `unwrap`/`expect`/pânico no caminho de execução — todo erro vira
//!     mensagem + saída 1 (o `fail` de bin/eav7.js:103-106);
//!   • assinatura pela `ProductionWallet` (o MESMO caminho do validador);
//!   • toda Tx montada é conferida por `verify_transaction` ANTES do envio (falha
//!     cedo, mensagem clara), como manda o enunciado;
//!   • nenhum lock é segurado — é um binário cliente, sem estado compartilhado.

use std::collections::HashMap;

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::Method;

use eav7::block::BlockSigner;
use eav7::signature::{HybridPublicKey, SIGNATURE_SCHEME};
use eav7::state::contracts::eavm_to_e7;
use eav7::transaction::{build_transaction, verify_transaction, JsonValue, Tx, TxSpec};
use eav7::{config, format_eav7, is_valid_address};

use eav7_node::ai::bridge::tx_to_json;
use eav7_node::p2p::{make_client, HttpClient};
use eav7_node::wallet::ProductionWallet;

// Geração de carteira NOVA (só neste binário — a `ProductionWallet` de wallet.rs
// apenas CARREGA). `Generate::generate()` usa o RNG do sistema (feature
// `getrandom` do crypto-common, ligada por `ml-dsa`); os PEM saem do mesmo par de
// traços `EncodePrivateKey`/`EncodePublicKey` (pkcs8/spki) que o `k256` já traz.
use k256::pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding};
use ml_dsa::{Generate, Keypair, MlDsa44};

const DEFAULT_NODE: &str = "http://127.0.0.1:6070";

const HELP: &str = "EAV7 — cliente do protocolo eav20 (hashes e carteiras E7, camada nativa de IA)

Uso: eav7-cli <comando> [opções]

Carteira
  wallet new [--out arquivo]            cria carteira E7 (secp256k1 + ML-DSA-44)
  wallet show <arquivo>                 mostra endereço e chave pública

Consulta ao nó
  status [--node url]                   status da rede
  balance <endereço> [--node url]       conta (saldo, nonce, isenção)

Moeda nativa
  send    --wallet w.json --to E7... --amount 12.5
  stake   --wallet w.json --amount 1000        (>= 100 zera taxas; >= 1000 vira minerador)
  unstake --wallet w.json --amount 500

Nomes EAV-NS
  name register --wallet w.json --name eav7-labs-ancora-1 [--target E7...]
  name list | name show <nome>

Governança & IA
  gov propose --wallet w.json --param BLOCK_REWARD --value 16000000 [--voting-blocks N]
  gov vote    --wallet w.json --id <proposalId>
  oracle register --wallet w.json --amount 500 --endpoint https://…
  ai task     --wallet w.json --prompt \"…\" --oracle E7… [--reward 1]

Tokens EAV20
  token create --wallet w.json --name \"Meu Token\" --symbol MTK --supply 1000000 [--decimals 6]
  token send   --wallet w.json --token E7… --to E7… --amount 10
  token list | token info <id>

Inteligência artificial
  ai task    --wallet w.json --prompt \"…\" --oracle E7… [--model claude-sonnet-5] [--reward 1]
  ai tasks   [--status PENDING|DONE]

Ponte cross-chain
  bridge out --wallet w.json --chain ETH --address 0x… --amount 10 [--token E7…]
  bridge transfers

Protocolo EAVM (MetaMask / Trust Wallet)
  eavm address <0x…>                  endereço E7 correspondente a uma conta EAVM

Serviços de longa duração (agora são o binário eav7-node)
  ai worker | ai sentinel | node start | mine   -> use eav7-node (veja a mensagem)

Opção global: --node url (padrão http://127.0.0.1:6070 ou env EAV7_NODE)";

// ---------------------------------------------------------------- ponto de entrada
//
// `main` só traduz o `Result` da execução no par (mensagem, código de saída) do
// `fail` de bin/eav7.js: erro imprime `erro: ...` em stderr e sai 1. Sucesso sai 0.

#[tokio::main]
async fn main() {
    match executa().await {
        Ok(()) => {}
        Err(e) => {
            eprintln!("erro: {e}");
            std::process::exit(1);
        }
    }
}

fn agora_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

// ---------------------------------------------------------------- parser de args
//
// Espelho do `parseArgs` do JS (bin/eav7.js:60-98), mas MANUAL: separa posicionais
// de `--flag valor`. O único booleano do cliente é `--help`/`-h`; todo outro
// `--flag` consome o token seguinte como valor (as opções do JS são todas string).

struct Cli {
    /// `[comando, subcomando, resto...]` — os `positionals` do parseArgs.
    positionals: Vec<String>,
    /// `--flag valor` já casados.
    flags: HashMap<String, String>,
    help: bool,
}

fn parse_cli<I: Iterator<Item = String>>(args: I) -> Cli {
    let mut positionals = Vec::new();
    let mut flags = HashMap::new();
    let mut help = false;
    let mut it = args.peekable();
    while let Some(tok) = it.next() {
        if tok == "--help" || tok == "-h" {
            help = true;
        } else if let Some(nome) = tok.strip_prefix("--") {
            // Valor = próximo token (as flags do cliente são todas string). Se a
            // flag vier sem valor no fim da linha, guarda vazio — `require` reclama.
            let valor = it.next().unwrap_or_default();
            flags.insert(nome.to_string(), valor);
        } else {
            positionals.push(tok);
        }
    }
    Cli { positionals, flags, help }
}

impl Cli {
    fn opt(&self, nome: &str) -> Option<&str> {
        self.flags.get(nome).map(|s| s.as_str()).filter(|s| !s.is_empty())
    }
    /// Espelho de `require_` (bin/eav7.js:108-111): opção obrigatória ausente/vazia
    /// vira erro com o NOME da flag, não uma falha opaca lá adiante.
    fn require(&self, nome: &str, rotulo: &str) -> Result<&str, String> {
        self.opt(nome).ok_or_else(|| format!("opção obrigatória: {rotulo}"))
    }
    fn node_url(&self) -> String {
        // `--node` > env EAV7_NODE > padrão; sem a barra final (bin/eav7.js:100).
        let bruta = self
            .opt("node")
            .map(String::from)
            .or_else(|| std::env::var("EAV7_NODE").ok().filter(|s| !s.is_empty()))
            .unwrap_or_else(|| DEFAULT_NODE.to_string());
        bruta.trim_end_matches('/').to_string()
    }
}

// ---------------------------------------------------------------- unidades
//
// Porte de `eav7ToE7`/`formatEav7`/`parseUnits` (src/config.js:572-586,
// bin/eav7.js:178-182). Aritmética inteira, nunca float — o mesmo motivo do resto
// do protocolo.

/// `eav7ToE7` (src/config.js:581-585): "12.5" -> 12_500_000 (6 casas). Aceita `.`
/// ou `,` como separador. Erro cita o campo, como o JS.
fn eav7_to_e7(text: &str, campo: &str) -> Result<u128, String> {
    parse_units(text, 6, campo).map_err(|_| format!("{campo} inválido: {text} (use até 6 casas decimais)"))
}

/// `parseUnits` (bin/eav7.js:178-182): inteiro + fração opcional de até `decimals`
/// casas, escalado para as unidades mínimas do token.
fn parse_units(text: &str, decimals: u32, campo: &str) -> Result<u128, String> {
    let t = text.trim();
    let (inteiro, fracao) = match t.split_once(['.', ',']) {
        Some((i, f)) => (i, Some(f)),
        None => (t, None),
    };
    if inteiro.is_empty() || !inteiro.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("{campo} inválido: {text}"));
    }
    let maxfrac = decimals.max(1) as usize;
    let fracao = match fracao {
        // Fração presente num token de 0 casas é inválida (o `match[2] && decimals===0`).
        Some(_) if decimals == 0 => return Err(format!("{campo} inválido: {text}")),
        Some(f) if f.is_empty() || f.len() > maxfrac || !f.bytes().all(|b| b.is_ascii_digit()) => {
            return Err(format!("{campo} inválido: {text}"));
        }
        Some(f) => f.to_string(),
        None => String::new(),
    };
    let base: u128 =
        inteiro.parse().map_err(|_| format!("{campo} inválido (grande demais): {text}"))?;
    let escala = 10u128.checked_pow(decimals).ok_or("decimais demais")?;
    let mut valor = base.checked_mul(escala).ok_or("valor grande demais")?;
    if decimals > 0 && !fracao.is_empty() {
        // padEnd à direita com zeros até `decimals` casas (bin/eav7.js:181).
        let mut casas = fracao;
        while casas.len() < decimals as usize {
            casas.push('0');
        }
        let frac_val: u128 = casas.parse().map_err(|_| format!("{campo} inválido: {text}"))?;
        valor = valor.checked_add(frac_val).ok_or("valor grande demais")?;
    }
    Ok(valor)
}

// ---------------------------------------------------------------- HTTP do cliente
//
// GET/POST à API do nó. Reusa `make_client()` de `p2p.rs` (o cliente hyper da
// mesma pilha do axum — nenhum ecossistema novo). Ao contrário do P2P, NÃO passa
// pelo filtro anti-SSRF `guard_peer`: aqui o alvo é o NÓ escolhido pelo operador
// (`--node`, padrão localhost), não um peer não confiável da malha.

/// Timeout de 10s sobre a chamada inteira, como o `AbortSignal.timeout(10_000)` do
/// `fetch` do JS (bin/eav7.js:135,147).
const TIMEOUT_MS: u64 = 10_000;

async fn http_request(
    client: &HttpClient,
    method: Method,
    url: &str,
    corpo: Option<String>,
    node_label: &str,
) -> Result<serde_json::Value, String> {
    let uri: hyper::Uri = url.parse().map_err(|_| format!("URL inválida: {url}"))?;
    let mut req = hyper::Request::builder().method(method).uri(uri);
    let body = match corpo {
        Some(b) => {
            req = req.header(hyper::header::CONTENT_TYPE, "application/json");
            Full::new(Bytes::from(b))
        }
        None => Full::new(Bytes::new()),
    };
    let req = req.body(body).map_err(|e| format!("request inválido: {e}"))?;

    // Falha de rede -> a mesma mensagem do `.catch(() => fail(...))` do JS
    // (bin/eav7.js:136), com o launcher atualizado para `eav7-node`.
    let indisponivel = || {
        format!("não consegui falar com o nó em {node_label} — ele está rodando? (rode o nó: eav7-node)")
    };
    let resp = tokio::time::timeout(std::time::Duration::from_millis(TIMEOUT_MS), client.request(req))
        .await
        .map_err(|_| indisponivel())?
        .map_err(|_| indisponivel())?;

    let status = resp.status();
    let bytes = resp
        .into_body()
        .collect()
        .await
        .map_err(|e| format!("erro lendo resposta do nó: {e}"))?
        .to_bytes();
    let texto = String::from_utf8_lossy(&bytes);
    let valor: serde_json::Value = if texto.trim().is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(&texto).map_err(|e| format!("resposta do nó não é JSON: {e}"))?
    };

    if status.is_success() {
        Ok(valor)
    } else {
        // `body.error ?? nó respondeu {status}` (bin/eav7.js:138,151).
        let msg = valor
            .get("error")
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| format!("nó respondeu {}", status.as_u16()));
        Err(msg)
    }
}

async fn get_json(
    client: &HttpClient,
    node: &str,
    path: &str,
) -> Result<serde_json::Value, String> {
    http_request(client, Method::GET, &format!("{node}{path}"), None, node).await
}

async fn post_json(
    client: &HttpClient,
    node: &str,
    path: &str,
    corpo: String,
) -> Result<serde_json::Value, String> {
    http_request(client, Method::POST, &format!("{node}{path}"), Some(corpo), node).await
}

fn imprime_json(v: &serde_json::Value) {
    match serde_json::to_string_pretty(v) {
        Ok(s) => println!("{s}"),
        Err(_) => println!("{v}"),
    }
}

// ---------------------------------------------------------------- montagem de Tx
//
// O núcleo de `buildTransaction` (src/core/transaction.js:30-65), o mesmo do
// `build_transaction` de `ai/bridge.rs` (que é privado lá) — mesmo padrão-ouro:
// `from` derivado das chaves, payload canônico assinado pelo par híbrido, e `id`
// derivado APENAS do payload (anti-maleabilidade de txid). Os builders de
// TRANSFER/STAKE/UNSTAKE/TOKEN_*/BRIDGE_OUT NÃO existiam na lib nem em bridge.rs,
// então são montados aqui campo a campo, assinados pela MESMA `ProductionWallet`.
/// Monta e assina pela LIB (`eav7::transaction::build_transaction`).
///
/// Havia aqui uma cópia do construtor, idêntica à do módulo de IA. Duas versões
/// da regra que decide o que é assinado e qual é o `id` da transação é o pior
/// lugar possível para divergirem: uma mudaria primeiro, e as transações de um
/// caminho deixariam de ser aceitas sem motivo aparente.
#[allow(clippy::too_many_arguments)]
fn build_and_sign(
    signer: &dyn BlockSigner,
    tx_type: &str,
    to: Option<String>,
    amount: u128,
    fee: Option<u128>,
    nonce: i64,
    timestamp: i64,
    data: JsonValue,
) -> Result<Tx, String> {
    let mut spec = TxSpec::nova(tx_type, amount, nonce, timestamp).com_dados(data);
    spec.to = to;
    spec.fee = fee;
    build_transaction(signer, spec)
}

/// `nextNonce` (bin/eav7.js:155-160): próximo nonce considerando também as
/// transações do remetente ainda no mempool; devolve também `feeExempt`.
async fn next_nonce(
    client: &HttpClient,
    node: &str,
    address: &str,
) -> Result<(i64, bool), String> {
    let account = get_json(client, node, &format!("/address/{address}")).await?;
    let mempool = get_json(client, node, "/mempool").await?;
    let mut nonce = account.get("nonce").and_then(|v| v.as_i64()).unwrap_or(0);
    if let Some(arr) = mempool.as_array() {
        for tx in arr {
            if tx.get("from").and_then(|v| v.as_str()) == Some(address)
                && let Some(n) = tx.get("nonce").and_then(|v| v.as_i64())
                && n > nonce
            {
                nonce = n;
            }
        }
    }
    let fee_exempt = account.get("feeExempt").and_then(|v| v.as_bool()).unwrap_or(false);
    Ok((nonce + 1, fee_exempt))
}

/// `signAndSend` (bin/eav7.js:162-176): resolve nonce/isenção, monta, VERIFICA
/// localmente (exigência do porte), envia e imprime. Devolve a Tx (o JS também a
/// retorna — `ai task` usa o `id`).
async fn sign_and_send(
    client: &HttpClient,
    node: &str,
    wallet: &ProductionWallet,
    tx_type: &str,
    to: Option<String>,
    amount: u128,
    data: JsonValue,
) -> Result<Tx, String> {
    let address = wallet.address().to_string();
    let (nonce, fee_exempt) = next_nonce(client, node, &address).await?;
    let fee = if fee_exempt { Some(0u128) } else { None };
    let tx = build_and_sign(wallet, tx_type, to, amount, fee, nonce, agora_ms(), data)?;

    // Conferência local ANTES de enviar (exigência do enunciado): uma tx que a
    // própria lib de consenso rejeita não deve nem sair da máquina — falha cedo,
    // com a razão exata. É o MESMO `verify_transaction` que o nó roda ao receber.
    verify_transaction(&tx)
        .map_err(|e| format!("transação montada não passou na verificação local ({tx_type}): {e}"))?;

    let resultado = post_json(client, node, "/tx", tx_to_json(&tx)).await?;

    // Impressão no formato do JS (bin/eav7.js:174): resposta + type + fee legível.
    let fee_e7: u128 = tx.fee.parse().unwrap_or(0);
    let fee_str = format!(
        "{} {}{}",
        format_eav7(fee_e7),
        config::SYMBOL,
        if fee_exempt { " (isento por stake)" } else { "" }
    );
    let mut obj = match resultado {
        serde_json::Value::Object(m) => m,
        outro => {
            let mut m = serde_json::Map::new();
            m.insert("resultado".to_string(), outro);
            m
        }
    };
    obj.insert("type".to_string(), serde_json::Value::String(tx_type.to_string()));
    obj.insert("fee".to_string(), serde_json::Value::String(fee_str));
    imprime_json(&serde_json::Value::Object(obj));
    Ok(tx)
}

// ---------------------------------------------------------------- geração de carteira
//
// Gera um par NOVO (o `wallet new` do JS, bin/eav7.js:192-199 -> `generateKeyPair`
// de src/crypto/keys.js:24-33). O `k256` e o `ml-dsa` produzem a mesma dupla que o
// Node: ECDSA secp256k1 PKCS#8/SPKI + ML-DSA-44 na forma "seed" da RFC 9881. O PEM
// sai dos traços `EncodePrivateKey`/`EncodePublicKey` (pkcs8/spki, feature `pem`
// que o `k256` já liga globalmente), então o mesmo arquivo é relido pela
// `ProductionWallet` sem parser artesanal.

/// (endereço, JSON da carteira) — o JSON no formato de `saveWallet`
/// (bin/eav7.js:122-132) + `generateKeyPair`.
fn gerar_carteira() -> Result<(String, String), String> {
    // ECDSA secp256k1 — RNG do sistema.
    let ec = k256::ecdsa::SigningKey::generate();
    let ec_priv_pem = ec
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| format!("exportar PKCS#8 ECDSA: {e}"))?
        .to_string();
    let ec_pub_pem = ec
        .verifying_key()
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| format!("exportar SPKI ECDSA: {e}"))?;

    // ML-DSA-44 — `generate()` sorteia uma semente de 32 bytes e deriva a chave;
    // `to_pkcs8_der`/`to_pkcs8_pem` exportam justamente essa SEMENTE (a forma
    // "seed" que o Node emite e que `ProductionWallet::from_file` já lê).
    let pq = ml_dsa::SigningKey::<MlDsa44>::generate();
    let pq_priv_pem = pq
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| format!("exportar PKCS#8 ML-DSA-44: {e}"))?
        .to_string();
    let pq_pub_pem = pq
        .verifying_key()
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| format!("exportar SPKI ML-DSA-44: {e}"))?;

    // Endereço pelo MESMO caminho canônico do carregamento (`HybridPublicKey`), de
    // modo que o `address` gravado bate com o que a releitura deriva.
    let address = HybridPublicKey::from_pem(&ec_pub_pem, &pq_pub_pem)
        .map_err(|e| format!("derivar endereço das chaves geradas: {e}"))?
        .address();

    // JSON com os campos de `saveWallet` + `generateKeyPair` (keys.js:24-33).
    let mut obj = serde_json::Map::new();
    obj.insert("chain".to_string(), serde_json::Value::String(config::NAME.to_string()));
    obj.insert("protocol".to_string(), serde_json::Value::String(config::PROTOCOL.to_string()));
    obj.insert("address".to_string(), serde_json::Value::String(address.clone()));
    obj.insert("scheme".to_string(), serde_json::Value::String(SIGNATURE_SCHEME.to_string()));
    obj.insert("privateKeyPem".to_string(), serde_json::Value::String(ec_priv_pem));
    obj.insert("publicKeyPem".to_string(), serde_json::Value::String(ec_pub_pem));
    obj.insert("pqPrivateKeyPem".to_string(), serde_json::Value::String(pq_priv_pem));
    obj.insert("pqPublicKeyPem".to_string(), serde_json::Value::String(pq_pub_pem));
    obj.insert("createdAt".to_string(), serde_json::Value::String(iso_utc(agora_ms())));
    let json = serde_json::to_string_pretty(&serde_json::Value::Object(obj))
        .map_err(|e| format!("serializar carteira: {e}"))?;
    Ok((address, json))
}

/// Grava a carteira com permissão 0600 (bin/eav7.js:130 — `mode 0o600`).
///
/// O modo vai no `open(O_CREAT)`, NÃO num `chmod` posterior. A versão anterior
/// fazia `write` (0644, pelo umask) e só então `set_permissions`: nesse intervalo
/// as duas chaves PRIVADAS ficavam legíveis por qualquer usuário da máquina — e
/// se o `chmod` falhasse, ficavam assim para sempre, com a função devolvendo
/// `Err` e o arquivo já em disco. Em VPS de validador ou runner de CI a janela é
/// real. O `create_new` também recusa sobrescrever uma carteira existente, que é
/// a outra forma de perder chave.
fn salvar_carteira(arquivo: &str, json: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(arquivo)
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::AlreadyExists => {
                    format!("{arquivo} já existe — recuse-se a sobrescrever uma carteira")
                }
                _ => format!("gravar {arquivo}: {e}"),
            })?;
        f.write_all(json.as_bytes()).map_err(|e| format!("gravar {arquivo}: {e}"))?;
        // `sync_all` antes de sair: uma carteira que o usuário acha que salvou e
        // some num corte de energia é uma chave perdida.
        f.sync_all().map_err(|e| format!("sincronizar {arquivo}: {e}"))?;
    }
    #[cfg(not(unix))]
    {
        // Sem modo de arquivo POSIX: grava e avisa que a proteção é do sistema.
        if std::path::Path::new(arquivo).exists() {
            return Err(format!("{arquivo} já existe — recuse-se a sobrescrever uma carteira"));
        }
        std::fs::write(arquivo, json).map_err(|e| format!("gravar {arquivo}: {e}"))?;
        eprintln!("[aviso] proteja {arquivo}: este sistema não aplica permissão POSIX");
    }
    Ok(())
}

/// ISO-8601 UTC a partir de ms Unix (o `new Date().toISOString()` de
/// bin/eav7.js:128). Calendário civil pelo algoritmo de Hinnant — sem dependência
/// de data (política deste crate). Campo cosmético do arquivo.
fn iso_utc(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let millis = ms.rem_euclid(1000);
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (h, m, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{year:04}-{month:02}-{d:02}T{h:02}:{m:02}:{s:02}.{millis:03}Z")
}

// ---------------------------------------------------------------- dispatch
//
// A cadeia de `if/else if` de bin/eav7.js:192-346, na mesma ordem. Comandos de
// consulta são GET; os que submetem montam Tx assinada + POST /tx.

async fn executa() -> Result<(), String> {
    let cli = parse_cli(std::env::args().skip(1));

    let cmd = cli.positionals.first().map(|s| s.as_str());
    let sub = cli.positionals.get(1).map(|s| s.as_str());
    let rest: &[String] = cli.positionals.get(2..).unwrap_or(&[]);

    // `--help` ou nenhum comando -> ajuda e saída 0 (bin/eav7.js:187-190).
    if cli.help || cmd.is_none() {
        println!("{HELP}");
        return Ok(());
    }
    let cmd = cmd.unwrap_or("");

    let node = cli.node_url();
    // Cliente HTTP só é usado nos comandos de rede; construí-lo é barato.
    let client = make_client();

    match (cmd, sub) {
        // ---- Carteira ----
        ("wallet", Some("new")) => {
            let (address, json) = gerar_carteira()?;
            let curto = address.get(..12).unwrap_or(&address);
            let arquivo =
                cli.opt("out").map(String::from).unwrap_or_else(|| format!("wallet-{curto}.json"));
            salvar_carteira(&arquivo, &json)?;
            // Confirma que o arquivo recém-gravado RELÊ e deriva o mesmo endereço
            // (prova o par pública↔privada pelo caminho da `ProductionWallet`).
            let relida = ProductionWallet::from_file(&arquivo)
                .map_err(|e| format!("carteira gerada não recarrega ({e}) — abortado"))?;
            if relida.address() != address {
                return Err("endereço da carteira gerada divergiu ao recarregar".into());
            }
            println!("endereço  : {address}");
            println!("segurança : {SIGNATURE_SCHEME} (secp256k1 + ML-DSA-44 pós-quântico)");
            println!("arquivo   : {arquivo} (permissão 600 — guarde com segurança)");
            Ok(())
        }
        ("wallet", Some("show")) => {
            // `rest[0] ?? --wallet` (bin/eav7.js:201).
            let arquivo = rest
                .first()
                .map(|s| s.as_str())
                .or_else(|| cli.opt("wallet"))
                .ok_or("opção obrigatória: arquivo da carteira")?;
            let wallet = ProductionWallet::from_file(arquivo)?;
            println!("endereço  : {}", wallet.address());
            println!("segurança : {SIGNATURE_SCHEME} (secp256k1 + ML-DSA-44)");
            println!("chave pública (ECDSA) :\n{}", wallet.public_key_pem());
            Ok(())
        }

        // ---- Consulta ----
        ("status", _) => {
            imprime_json(&get_json(&client, &node, "/status").await?);
            Ok(())
        }
        ("balance", _) => {
            // `balance <endereço>` — o endereço é o subcomando posicional (bin/eav7.js:245).
            let address = sub.ok_or("opção obrigatória: endereço")?;
            if !is_valid_address(address) {
                return Err("endereço EAV7 inválido".into());
            }
            imprime_json(&get_json(&client, &node, &format!("/address/{address}")).await?);
            Ok(())
        }

        // ---- Moeda nativa ----
        ("send", _) => {
            let wallet = ProductionWallet::from_file(cli.require("wallet", "--wallet")?)?;
            let to = cli.require("to", "--to")?.to_string();
            let amount = eav7_to_e7(cli.require("amount", "--amount")?, "--amount")?;
            sign_and_send(&client, &node, &wallet, "TRANSFER", Some(to), amount, JsonValue::map([]))
                .await?;
            Ok(())
        }
        ("stake", _) | ("unstake", _) => {
            let wallet = ProductionWallet::from_file(cli.require("wallet", "--wallet")?)?;
            let amount = eav7_to_e7(cli.require("amount", "--amount")?, "--amount")?;
            let tipo = if cmd == "stake" { "STAKE" } else { "UNSTAKE" };
            sign_and_send(&client, &node, &wallet, tipo, None, amount, JsonValue::map([])).await?;
            Ok(())
        }

        // ---- Nomes EAV-NS ----
        ("name", Some("register")) => {
            let wallet = ProductionWallet::from_file(cli.require("wallet", "--wallet")?)?;
            let name = cli.require("name", "--name")?.to_ascii_lowercase();
            let mut campos = vec![("name".to_string(), JsonValue::str(&name))];
            if let Some(t) = cli.opt("target") {
                if !is_valid_address(t) {
                    return Err("endereço --target inválido".into());
                }
                campos.push(("target".to_string(), JsonValue::str(t)));
            }
            sign_and_send(
                &client,
                &node,
                &wallet,
                "NAME_REGISTER",
                None,
                0,
                JsonValue::map(campos),
            )
            .await?;
            Ok(())
        }
        ("name", Some("list")) => {
            imprime_json(&get_json(&client, &node, "/names").await?);
            Ok(())
        }
        ("name", Some("show")) => {
            let nome = rest.first().ok_or("opção obrigatória: nome")?;
            imprime_json(&get_json(&client, &node, &format!("/names/{nome}")).await?);
            Ok(())
        }

        // ---- Governança ----
        ("gov", Some("propose")) => {
            let wallet = ProductionWallet::from_file(cli.require("wallet", "--wallet")?)?;
            let param = cli.require("param", "--param")?.to_string();
            let value_raw = cli.require("value", "--value")?;
            // Escalars: número se parsear, senão string. Objetos (BRIDGE_COMMITTEE etc.)
            // aceitam JSON cru.
            let value = if let Ok(n) = value_raw.parse::<i64>() {
                JsonValue::Int(n)
            } else if value_raw.starts_with('{') || value_raw.starts_with('[') {
                eav7::transaction::parse_json(value_raw)
                    .map_err(|e| format!("--value JSON inválido: {e}"))?
            } else {
                JsonValue::str(value_raw)
            };
            let mut campos = vec![
                ("param".to_string(), JsonValue::str(&param)),
                ("value".to_string(), value),
            ];
            if let Some(vb) = cli.opt("voting-blocks") {
                let n: i64 = vb
                    .parse()
                    .map_err(|_| "--voting-blocks inválido".to_string())?;
                campos.push(("votingBlocks".to_string(), JsonValue::Int(n)));
            }
            sign_and_send(
                &client,
                &node,
                &wallet,
                "GOV_PROPOSE",
                None,
                0,
                JsonValue::map(campos),
            )
            .await?;
            Ok(())
        }
        ("gov", Some("vote")) => {
            let wallet = ProductionWallet::from_file(cli.require("wallet", "--wallet")?)?;
            let id = cli.require("id", "--id")?.to_string();
            // O protocolo só registra voto a favor (quórum de aprovação).
            let data = JsonValue::map([("proposalId".to_string(), JsonValue::str(&id))]);
            sign_and_send(&client, &node, &wallet, "GOV_VOTE", None, 0, data).await?;
            Ok(())
        }

        // ---- Oráculo IA ----
        ("oracle", Some("register")) => {
            let wallet = ProductionWallet::from_file(cli.require("wallet", "--wallet")?)?;
            let amount = eav7_to_e7(cli.require("amount", "--amount")?, "--amount")?;
            let endpoint = cli.opt("endpoint").unwrap_or("");
            if endpoint.is_empty() {
                return Err("--endpoint é obrigatório (URL do worker)".into());
            }
            let data = JsonValue::map([("endpoint".to_string(), JsonValue::str(endpoint))]);
            sign_and_send(
                &client,
                &node,
                &wallet,
                "ORACLE_REGISTER",
                None,
                amount,
                data,
            )
            .await?;
            Ok(())
        }

        // ---- Tokens EAV20 ----
        ("token", Some("create")) => {
            let wallet = ProductionWallet::from_file(cli.require("wallet", "--wallet")?)?;
            let decimals: u32 = match cli.opt("decimals") {
                Some(d) => d.parse().map_err(|_| "--decimals inválido".to_string())?,
                None => 6,
            };
            let supply = parse_units(cli.require("supply", "--supply")?, decimals, "supply")?;
            let data = JsonValue::map([
                ("name".to_string(), JsonValue::str(cli.require("name", "--name")?)),
                (
                    "symbol".to_string(),
                    JsonValue::str(cli.require("symbol", "--symbol")?.to_uppercase()),
                ),
                ("decimals".to_string(), JsonValue::Int(decimals as i64)),
                ("totalSupply".to_string(), JsonValue::str(supply.to_string())),
            ]);
            sign_and_send(&client, &node, &wallet, "TOKEN_CREATE", None, 0, data).await?;
            println!("token criado — veja o id em: eav7-cli token list");
            Ok(())
        }
        ("token", Some("send")) => {
            let wallet = ProductionWallet::from_file(cli.require("wallet", "--wallet")?)?;
            let token_id = cli.require("token", "--token")?.to_string();
            // As casas do token vêm do nó (bin/eav7.js:278).
            let token = get_json(&client, &node, &format!("/tokens/{token_id}")).await?;
            let decimals = token.get("decimals").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let to = cli.require("to", "--to")?.to_string();
            let amount = parse_units(cli.require("amount", "--amount")?, decimals, "--amount")?;
            let data = JsonValue::map([("token".to_string(), JsonValue::str(&token_id))]);
            sign_and_send(&client, &node, &wallet, "TOKEN_TRANSFER", Some(to), amount, data).await?;
            Ok(())
        }
        ("token", Some("list")) => {
            imprime_json(&get_json(&client, &node, "/tokens").await?);
            Ok(())
        }
        ("token", Some("info")) => {
            let id = rest.first().ok_or("opção obrigatória: id do token")?;
            imprime_json(&get_json(&client, &node, &format!("/tokens/{id}")).await?);
            Ok(())
        }

        // ---- Inteligência artificial ----
        ("ai", Some("task")) => {
            let wallet = ProductionWallet::from_file(cli.require("wallet", "--wallet")?)?;
            let oracle = cli.require("oracle", "--oracle (endereço E7 do oráculo designado)")?;
            if !is_valid_address(oracle) {
                return Err("endereço de oráculo inválido".into());
            }
            let reward = eav7_to_e7(cli.opt("reward").unwrap_or("1"), "--reward")?;
            // Modo oráculo DESIGNADO (Fase 1) — o único que o CLI JS monta
            // (bin/eav7.js:296): { prompt, oracle, model, params: null }.
            let data = JsonValue::map([
                ("prompt".to_string(), JsonValue::str(cli.require("prompt", "--prompt")?)),
                (
                    "model".to_string(),
                    match cli.opt("model") {
                        Some(m) => JsonValue::str(m),
                        None => JsonValue::Null,
                    },
                ),
                ("params".to_string(), JsonValue::Null),
                ("oracle".to_string(), JsonValue::str(oracle)),
            ]);
            let tx = sign_and_send(&client, &node, &wallet, "AI_TASK", None, reward, data).await?;
            let id = tx.id.as_deref().unwrap_or("?");
            println!("tarefa de IA: {id}\nacompanhe com: curl {node}/ai/tasks/{id}");
            Ok(())
        }
        ("ai", Some("tasks")) => {
            let query = match cli.opt("status") {
                Some(s) => format!("?status={s}"),
                None => String::new(),
            };
            imprime_json(&get_json(&client, &node, &format!("/ai/tasks{query}")).await?);
            Ok(())
        }

        // ---- Ponte cross-chain ----
        ("bridge", Some("out")) => {
            let wallet = ProductionWallet::from_file(cli.require("wallet", "--wallet")?)?;
            // Com --token o valor está nas casas do token; senão, em EAV7 (bin/eav7.js:321).
            let amount = match cli.opt("token") {
                Some(tk) => {
                    let token = get_json(&client, &node, &format!("/tokens/{tk}")).await?;
                    let decimals = token.get("decimals").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    parse_units(cli.require("amount", "--amount")?, decimals, "--amount")?
                }
                None => eav7_to_e7(cli.require("amount", "--amount")?, "--amount")?,
            };
            let data = JsonValue::map([
                ("targetChain".to_string(), JsonValue::str(cli.require("chain", "--chain")?.to_uppercase())),
                ("targetAddress".to_string(), JsonValue::str(cli.require("address", "--address")?)),
                (
                    "token".to_string(),
                    match cli.opt("token") {
                        Some(t) => JsonValue::str(t),
                        None => JsonValue::Null,
                    },
                ),
            ]);
            sign_and_send(&client, &node, &wallet, "BRIDGE_OUT", None, amount, data).await?;
            Ok(())
        }
        ("bridge", Some("transfers")) => {
            imprime_json(&get_json(&client, &node, "/bridge/transfers").await?);
            Ok(())
        }

        // ---- EAVM ----
        ("eavm", Some("address")) => {
            // 0x -> E7 (bin/eav7.js:338-342).
            let eavm = rest.first().ok_or("opção obrigatória: endereço 0x")?;
            let e7 = eavm_to_e7(&eavm.to_lowercase()).map_err(|e| e.to_string())?;
            println!("EAVM : {}", eavm.to_lowercase());
            println!("EAV7 : {e7}");
            Ok(())
        }

        // ---- Serviços de longa duração: agora são o binário eav7-node ----
        ("ai", Some("worker")) => {
            println!(
                "`ai worker` agora é uma FLAG do binário eav7-node:\n  \
                 eav7-node --oracle-wallet {} [--port 6070]\n\
                 (o oráculo publica AI_RESULT assinado; usa ANTHROPIC_API_KEY se definida)",
                cli.opt("wallet").unwrap_or("w.json")
            );
            Ok(())
        }
        ("ai", Some("sentinel")) => {
            println!(
                "`ai sentinel` agora é uma FLAG do binário eav7-node:\n  \
                 eav7-node --sentinel [--port 6070]\n\
                 (vigilância de segurança; parecer por LLM se ANTHROPIC_API_KEY definida)"
            );
            Ok(())
        }
        ("node", Some("start")) | ("mine", _) => {
            println!(
                "`{}` agora é o binário eav7-node (o launcher/servidor):\n  \
                 eav7-node [--port 6070] [--host 0.0.0.0] [--data dir] [--validator carteira.json]\n            \
                 [--peers url,url] [--self-url url] [--genesis genesis.json] [--eavm-port n] [--no-eavm]",
                if cmd == "mine" { "mine" } else { "node start" }
            );
            Ok(())
        }

        // ---- Desconhecido ----
        _ => {
            println!("{HELP}");
            let alvo = [Some(cmd), sub].into_iter().flatten().collect::<Vec<_>>().join(" ");
            Err(format!("comando desconhecido: {alvo}"))
        }
    }
}

// ---------------------------------------------------------------- testes
//
// O grosso do binário é I/O (rede) — testável só o que é PURO: parser de args,
// unidades, e a montagem+verificação de uma TRANSFER (gerando uma carteira nova,
// o que de quebra exercita `gerar_carteira`/o export PKCS#8-ML-DSA).

#[cfg(test)]
mod tests {
    use super::*;

    fn cli(args: &[&str]) -> Cli {
        parse_cli(args.iter().map(|s| s.to_string()))
    }

    #[test]
    fn parser_separa_posicionais_de_flags() {
        let c = cli(&["send", "--wallet", "w.json", "--to", "E7ABC", "--amount", "12.5"]);
        assert_eq!(c.positionals, vec!["send"]);
        assert_eq!(c.opt("wallet"), Some("w.json"));
        assert_eq!(c.opt("to"), Some("E7ABC"));
        assert_eq!(c.opt("amount"), Some("12.5"));
        assert!(!c.help);
    }

    #[test]
    fn parser_reconhece_help_e_subcomandos() {
        assert!(cli(&["--help"]).help);
        assert!(cli(&["-h"]).help);
        let c = cli(&["wallet", "show", "arq.json"]);
        assert_eq!(c.positionals, vec!["wallet", "show", "arq.json"]);
    }

    #[test]
    fn node_url_prioriza_flag_e_tira_barra() {
        let c = cli(&["status", "--node", "http://x:6070/"]);
        assert_eq!(c.node_url(), "http://x:6070");
    }

    #[test]
    fn require_reclama_da_flag_ausente() {
        let c = cli(&["send"]);
        let erro = c.require("wallet", "--wallet").expect_err("deve faltar");
        assert!(erro.contains("--wallet"), "mensagem: {erro}");
    }

    #[test]
    fn eav7_to_e7_espelha_o_config() {
        assert_eq!(eav7_to_e7("12.5", "v").expect("12.5"), 12_500_000);
        assert_eq!(eav7_to_e7("1", "v").expect("1"), 1_000_000);
        assert_eq!(eav7_to_e7("0.000001", "v").expect("micro"), 1);
        assert_eq!(eav7_to_e7("3,25", "v").expect("virgula"), 3_250_000);
        assert!(eav7_to_e7("1.2345678", "v").is_err(), "mais de 6 casas");
        assert!(eav7_to_e7("abc", "v").is_err());
    }

    #[test]
    fn parse_units_respeita_decimais() {
        assert_eq!(parse_units("10", 0, "s").expect("inteiro"), 10);
        assert!(parse_units("10.5", 0, "s").is_err(), "fração em token de 0 casas");
        assert_eq!(parse_units("1.5", 2, "s").expect("2 casas"), 150);
        assert_eq!(parse_units("1000000", 6, "s").expect("supply"), 1_000_000_000_000);
    }

    #[test]
    fn format_eav7_tira_zeros_a_direita() {
        assert_eq!(format_eav7(1_000_000), "1");
        assert_eq!(format_eav7(12_500_000), "12.5");
        assert_eq!(format_eav7(1), "0.000001");
        assert_eq!(format_eav7(0), "0");
    }

    #[test]
    fn iso_utc_formata_epoca_conhecida() {
        // 1_700_000_000_000 ms = 2023-11-14T22:13:20.000Z (valor de referência).
        assert_eq!(iso_utc(1_700_000_000_000), "2023-11-14T22:13:20.000Z");
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00.000Z");
    }

    /// Carteira NOVA gerada pelo binário: RELÊ pela `ProductionWallet`, e uma
    /// TRANSFER montada com ela PASSA em `verify_transaction` (o mesmo caminho do
    /// nó) e o `from` é o endereço da carteira. Cobre de ponta a ponta a geração
    /// (export PKCS#8 do ML-DSA) + a montagem/assinatura da tx.
    #[test]
    fn carteira_nova_monta_transfer_que_verifica() {
        let (address, json) = gerar_carteira().expect("gerar carteira");
        assert!(address.starts_with("E7"), "endereço E7: {address}");

        let mut caminho = std::env::temp_dir();
        caminho.push(format!("eav7-cli-teste-{}.json", std::process::id()));
        std::fs::write(&caminho, &json).expect("gravar carteira temporária");

        let wallet = ProductionWallet::from_file(&caminho).expect("recarregar carteira gerada");
        assert_eq!(wallet.address(), address, "endereço divergiu ao recarregar");

        // Destino = o próprio endereço (self-transfer): um E7 com checksum VÁLIDO,
        // que `verify_transaction` exige no `to` de um TRANSFER (REQUIRES_TO).
        let tx = build_and_sign(
            &wallet,
            "TRANSFER",
            Some(address.clone()),
            12_500_000,
            None,
            1,
            1_700_000_000_000,
            JsonValue::map([]),
        )
        .expect("montar TRANSFER");

        assert_eq!(verify_transaction(&tx), Ok(()), "verify_transaction rejeitou a TRANSFER");
        assert_eq!(tx.from, address, "from não é o endereço da carteira");
        assert_eq!(tx.fee, "20000", "fee padrão do TRANSFER = 1 × BURN_PER_ENERGY");
        // O corpo canônico do POST /tx tem de reparsear na rota de leitura da lib.
        let texto = tx_to_json(&tx);
        let v = eav7::transaction::parse_json(&texto).expect("JSON canônico reparseável");
        let volta = eav7::block::tx_from_json(&v).expect("tx_from_json");
        assert_eq!(verify_transaction(&volta), Ok(()));

        let _ = std::fs::remove_file(&caminho);
    }

    #[test]
    fn fee_default_por_tipo_bate_com_a_tabela() {
        // custo de energia × BURN_PER_ENERGY (20000).
        assert_eq!(eav7::transaction::default_fee_limit("TRANSFER"), 20_000);
        assert_eq!(eav7::transaction::default_fee_limit("TOKEN_TRANSFER"), 40_000);
        assert_eq!(eav7::transaction::default_fee_limit("TOKEN_CREATE"), 200_000);
        assert_eq!(eav7::transaction::default_fee_limit("BRIDGE_OUT"), 40_000);
        assert_eq!(eav7::transaction::default_fee_limit("AI_TASK"), 100_000);
        assert_eq!(eav7::transaction::default_fee_limit("DESCONHECIDO"), 20_000); // fallback `?? 1`
    }
}
