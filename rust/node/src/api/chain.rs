//! Rotas de CADEIA — blocos, transações, prova de estado, busca e estatísticas.
//!
//! Porte da fatia "blocos e cadeia" + "transações" de `src/node/api.js`
//! (linhas 495-729). Cada handler é uma função PURA `(&Node, params) -> ApiReply`
//! (padrão do módulo, ver `mod.rs`); a casca axum só extrai parâmetros, pega o
//! lock e converte em resposta.
//!
//! FRONTEIRA DE JSON (ver Cargo.toml): corpos que ENTRAM no consenso (bloco de
//! peer, transação assinada) são parseados com `eav7::transaction::parse_json` +
//! `tx_from_json`/`block_from_json` — o parser canônico da lib, byte a byte igual
//! à referência. As RESPOSTAS (apresentação) saem por `serde_json`; a ponte
//! `jv()` converte a forma canônica em `serde_json::Value` sem passar por float.
//!
//! Valores monetários (`Amount`/u128) viajam SEMPRE como texto decimal — exceto
//! em `/stats`, onde o próprio JS emite Number JÁ DIVIDIDO por UNIT (EAV7
//! inteiros, para os gráficos do explorer); reproduzimos campo a campo.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

use axum::extract::{Path, Query, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde_json::json;

use eav7::block::{block_from_json, block_to_json, tx_from_json, tx_to_json};
use eav7::config::{MAX_CHAIN_PAGE, MIN_VALIDATOR_STAKE, UNIT};
use eav7::state::contracts::eavm_to_e7;
use eav7::state::Account;
use eav7::stateroot::{account_leaf, merkle_path, sort_leaves};
use eav7::transaction::{parse_json, JsonValue};
use eav7::is_valid_address;

use super::{bad_request, int_param, into_response, reply, ApiReply, AppState};
use crate::node::Node;

// ---------------------------------------------------------------- constantes

/// `STATS_BUCKETS` de api.js:26 — séries horárias de 24h para os sparklines.
const STATS_BUCKETS: usize = 24;
/// `STATS_SCAN_CAP` de api.js:27 — teto de blocos-com-tx varridos por recálculo
/// de /stats (anti-DoS: a varredura é O(blocos), não O(cadeia), e ainda assim
/// limitada).
const STATS_SCAN_CAP: usize = 5_000;
/// `SEARCH_SUBSTR_SCAN_CAP` de api.js:81 — teto da varredura por substring na
/// busca (a fase de prefixo é binária; só o complemento por substring varre).
const SEARCH_SUBSTR_SCAN_CAP: usize = 50_000;

// ------------------------------------------------------------------- pontes

/// Converte a forma canônica da lib (`JsonValue`, sem float por construção) em
/// `serde_json::Value` de apresentação. É a ÚNICA passagem entre os dois mundos
/// neste arquivo — direta, sem reserializar string no meio.
fn jv(v: &JsonValue) -> serde_json::Value {
    match v {
        JsonValue::Null => serde_json::Value::Null,
        JsonValue::Bool(b) => json!(b),
        JsonValue::Int(i) => json!(i),
        JsonValue::Str(s) => json!(s),
        JsonValue::List(l) => serde_json::Value::Array(l.iter().map(jv).collect()),
        JsonValue::Map(m) => {
            serde_json::Value::Object(m.iter().map(|(k, val)| (k.clone(), jv(val))).collect())
        }
    }
}

/// `formatEav7` de config.js:572 — apresentação de um `Amount` em EAV7:
/// parte inteira + fração de até 6 casas SEM zeros à direita.
fn format_eav7(v: u128) -> String {
    let inteiro = v / UNIT;
    let frac = v % UNIT;
    if frac == 0 {
        return inteiro.to_string();
    }
    let f = format!("{frac:06}");
    format!("{inteiro}.{}", f.trim_end_matches('0'))
}

/// A forma `stable()` de stateroot.js:21 para UMA conta: BigInt vira `"B<dec>"`
/// (para sobreviver ao transporte JSON sem perder precisão) e Number fica
/// Number; chaves em ordem alfabética (o `Map` padrão do serde_json é BTree, o
/// que já dá a ordenação que o `Object.keys(v).sort()` do JS produz).
///
/// Quais campos são BigInt no JS vem de state.js:105 (getAccount): balance,
/// staked, delegatedOut, delegatedIn. `eavmManaged` só EXISTE quando true — a
/// referência nunca grava `false` (ver o mesmo cuidado em `Account::to_value`).
fn encoded_account(acc: &Account) -> serde_json::Value {
    let mut m = serde_json::Map::new();
    m.insert("balance".into(), json!(format!("B{}", acc.balance)));
    m.insert("bandwidthBlock".into(), json!(acc.bandwidth_block));
    m.insert("bandwidthUsed".into(), json!(acc.bandwidth_used));
    m.insert("delegatedIn".into(), json!(format!("B{}", acc.delegated_in)));
    m.insert("delegatedOut".into(), json!(format!("B{}", acc.delegated_out)));
    if acc.eavm_managed {
        m.insert("eavmManaged".into(), json!(true));
    }
    m.insert("energyBlock".into(), json!(acc.energy_block));
    m.insert("energyUsed".into(), json!(acc.energy_used));
    m.insert("nonce".into(), json!(acc.nonce));
    m.insert("staked".into(), json!(format!("B{}", acc.staked)));
    serde_json::Value::Object(m)
}

// ------------------------------------------------------- GET /blocks (js:495)

/// Lista paginada de blocos. Sem `from`: os ÚLTIMOS `limit`, mais novos primeiro
/// (o JS faz `getRange(height-limit+1, limit).reverse()`); com `from`: faixa
/// ascendente a partir dele. `limit` fixado em [1, 200], default 20.
///
/// Divergência deliberada e RELATADA: o JS usa `Number(...)` cru, então um
/// `?limit=abc` vira NaN e a resposta sai vazia; aqui parâmetro inválido cai no
/// default — comportamento estritamente mais útil, sem mudar nenhum caso válido.
pub fn blocks(node: &Node, params: &HashMap<String, String>) -> ApiReply {
    let bc = &node.blockchain;
    let limit =
        params.get("limit").and_then(|s| s.parse::<i64>().ok()).unwrap_or(20).clamp(1, 200) as usize;
    // `range_at`, não `get_range`: o caminho FUNDO consulta a janela de RAM e cai
    // para o disco — blocos que deslizaram continuam servíveis, como no JS (que lê
    // o BlockStore). Corrupção de disco sobe como 500, nunca vira página vazia.
    let paginar = |from: u64, inverter: bool| -> Result<serde_json::Value, String> {
        let mut v: Vec<serde_json::Value> =
            bc.range_at(from, limit)?.iter().map(|b| jv(&block_to_json(b))).collect();
        if inverter {
            v.reverse();
        }
        Ok(serde_json::Value::Array(v))
    };
    let lista = match params.get("from") {
        // js:499 — `Math.max(Number(fromParam), 0)`
        Some(s) => paginar(s.parse::<i64>().ok().map_or(0, |n| n.max(0)) as u64, false),
        // js:502 — janela final da cadeia, invertida (mais novos primeiro)
        None => paginar((bc.height() - limit as i64 + 1).max(0) as u64, true),
    };
    match lista {
        Ok(l) => reply(200, l),
        Err(e) => reply(500, json!({ "error": e })),
    }
}

// ------------------------------------------------ GET /blocks/latest (js:507)

/// A cabeça da cadeia; `null` numa cadeia vazia (o JS serializa o `undefined`
/// de `blockchain.head` — aqui a ausência é `null` explícito).
pub fn block_latest(node: &Node) -> ApiReply {
    match node.blockchain.head() {
        Some(b) => reply(200, jv(&block_to_json(b))),
        None => reply(200, serde_json::Value::Null),
    }
}

// ---------------------------------------------- GET /blocks/{height} (js:512)

/// Um bloco por ALTURA ou por HASH — `getBlock(ref)` da referência
/// (blockchain.js:378) aceita os dois; espelhamos decidindo pelo formato.
pub fn block_by_ref(node: &Node, referencia: &str) -> ApiReply {
    let bc = &node.blockchain;
    // Caminho FUNDO (RAM + disco): um hash ou altura antigos resolvem mesmo após
    // a janela deslizar, como o `getBlock` do JS que lê o store.
    let bloco = if eav7::is_valid_hash(referencia) {
        bc.block_by_hash_at(referencia)
    } else {
        match referencia.parse::<u64>() {
            Ok(h) => bc.block_at(h),
            Err(_) => Ok(None),
        }
    };
    match bloco {
        Ok(Some(b)) => reply(200, jv(&block_to_json(&b))),
        Ok(None) => reply(404, json!({ "error": "bloco não encontrado" })),
        Err(e) => reply(500, json!({ "error": e })),
    }
}

// -------------------------------------------------------- GET /chain (js:520)

/// Página da cadeia `{height, from, blocks}` — paginado para não serializar a
/// cadeia inteira por requisição (js:519). `limit` default e teto são
/// `MAX_CHAIN_PAGE`.
pub fn chain_page(node: &Node, params: &HashMap<String, String>) -> ApiReply {
    let bc = &node.blockchain;
    let from = params.get("from").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0).max(0) as u64;
    let limit = params
        .get("limit")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(MAX_CHAIN_PAGE)
        .clamp(1, MAX_CHAIN_PAGE) as usize;
    let blocos: Vec<serde_json::Value> = match bc.range_at(from, limit) {
        Ok(bs) => bs.iter().map(|b| jv(&block_to_json(b))).collect(),
        Err(e) => return reply(500, json!({ "error": e })),
    };
    reply(200, json!({ "height": bc.height(), "from": from, "blocks": blocos }))
}

// ------------------------------------------------------- POST /blocks (js:531)

/// Recebe um bloco de peer. Espelha `receiveBlock` (node.js:212) por completo:
/// dedupe por hash, `add_block`, poda do mempool com o estado novo, RELAY do
/// bloco aceito (node.js:226) e pedido de SYNC quando o bloco chega à frente da
/// nossa altura (node.js:220-222).
///
/// O relay e o sync saem por CANAL, não por chamada direta: o handler é síncrono
/// e não faz I/O de rede — quem fala com os peers são as tasks do `main`. É a
/// mesma disciplina do `submit_tx`.
pub fn receive_block(node: &mut Node, corpo: &str, now_ms: i64) -> ApiReply {
    // js readBody: corpo vazio vira `{}` (que block_from_json recusa com erro
    // limpo); JSON malformado é a mensagem fixa 'JSON inválido' (api.js:246).
    let v = if corpo.trim().is_empty() {
        JsonValue::Map(Default::default())
    } else {
        match parse_json(corpo) {
            Ok(v) => v,
            Err(_) => return bad_request("JSON inválido"),
        }
    };
    let bloco = match block_from_json(&v) {
        Ok(b) => b,
        Err(e) => return bad_request(e),
    };
    // node.js:213 — bloco já conhecido não é erro, é um "não, obrigado".
    if node.blockchain.get_block_by_hash(&bloco.hash).is_some() {
        return reply(200, json!({ "accepted": false, "reason": "bloco já conhecido" }));
    }
    let hash = bloco.hash.clone();
    let altura = bloco.height;
    // A linha canônica é feita ANTES do move — é ela que vai aos peers, byte a
    // byte como o produtor assinou.
    let linha = crate::block_line(&bloco);
    match node.blockchain.add_block(bloco, now_ms) {
        // Erro de validação vai ao cliente como 400 — é o que o catch de
        // createApiServer (api.js:212-219) faz com o throw do receiveBlock.
        Err(e) => {
            // Bloco À FRENTE da nossa altura: não é bloco inválido, é este nó
            // atrasado. Pede sincronização imediata em vez de esperar o tick de
            // 5 s rejeitando tudo que chega (node.js:220-222).
            if altura as i64 > node.blockchain.height() + 1
                && let Some(s) = &node.pedir_sync
            {
                let _ = s.send(());
            }
            bad_request(e)
        }
        Ok(()) => {
            node.mempool.prune(&node.blockchain.state, now_ms);
            // RELAY (node.js:226): repassa o bloco aceito aos NOSSOS peers. Sem
            // isto a propagação morre no primeiro salto.
            if let Some(r) = &node.relay_bloco
                && let Some(l) = linha
            {
                let _ = r.send(l);
            }
            reply(200, json!({ "accepted": true, "hash": hash }))
        }
    }
}

// ----------------------------------------------------------- POST /tx (js:538)

/// Submete uma transação assinada. `Node::submit_transaction` já existe
/// (node.rs:68) e espelha node.js:193; aqui só o parse canônico + tradução do
/// resultado. Erro de validação → 400 `{error}` (o catch de api.js:212).
///
/// Difunde a transação ACEITA aos peers pelo canal `node.gossip_tx` (o
/// `p2p.broadcastTx` de node.js:209).
///
/// A falta GRAVE por transação inválida (`strike(ip, 3)`, api.js:543) é aplicada
/// pelo middleware de admissão, no pós-processamento: este handler é puro e não
/// vê o socket, logo não conhece o IP; o middleware conhece os dois — IP e
/// desfecho — e é o único lugar onde a regra fecha (ver `api::admissao`).
///
/// Não duplique a falta aqui: o comentário anterior dizia que ninguém a aplicava,
/// e induzia exatamente a essa segunda implementação, que dobraria o peso.
pub fn submit_tx(node: &mut Node, corpo: &str) -> ApiReply {
    let v = if corpo.trim().is_empty() {
        JsonValue::Map(Default::default())
    } else {
        match parse_json(corpo) {
            Ok(v) => v,
            Err(_) => return bad_request("JSON inválido"),
        }
    };
    let tx = match tx_from_json(&v) {
        Ok(t) => t,
        Err(e) => return bad_request(e),
    };
    // A linha canônica é feita ANTES do move para o mempool — é ela que vai
    // para os peers, byte a byte como o remetente assinou.
    let linha = crate::ai::bridge::tx_to_json(&tx);
    match node.submit_transaction(tx) {
        Err(e) => bad_request(e),
        Ok(r) => {
            // DIFUNDE (node.js:209 — `if (broadcast) this.p2p.broadcastTx(tx)`).
            // Só transação NOVA: reenviar uma já conhecida realimentaria o gossip
            // entre peers em laço. O `send` num canal ilimitado não bloqueia e não
            // é async, então o método continua sem I/O de rede aqui — quem fala
            // com os peers é a task do `main`.
            if r.accepted && let Some(g) = &node.gossip_tx {
                let _ = g.send(linha);
            }
            // node.js devolve `{accepted, id}` e acrescenta `reason` só na
            // recusa — reproduzimos a ausência do campo, não um `null`.
            let mut body = json!({ "accepted": r.accepted, "id": r.id });
            if let Some(motivo) = r.reason {
                body["reason"] = json!(motivo);
            }
            reply(200, body)
        }
    }
}

// ------------------------------------------------ POST /eavm/tx (js:396-409)

/// Envia uma transação EAVM assinada (o `raw` da carteira web / MetaMask) SEM
/// passar pelo JSON-RPC: embrulha em envelope eav20 e submete.
///
/// A rota não existia neste cliente, e o efeito era pior que uma lacuna comum: o
/// próprio nó Rust SERVE `/wallet` (`static_files.rs`), e a página que ele serve
/// faz `POST /eavm/tx` — que caía no `fallback` dos estáticos e voltava como
/// "arquivo não encontrado". O usuário via a carteira abrir e nenhuma transação
/// sair. `eth_sendRawTransaction` faz o mesmo trabalho, mas vive em OUTRA PORTA
/// (`port+1000`) e a carteira web não fala com ela.
pub fn submit_eavm_tx(node: &mut Node, corpo: &str) -> ApiReply {
    let raw = match parse_json(corpo) {
        Ok(JsonValue::Map(m)) => match m.get("raw") {
            Some(JsonValue::Str(s)) => s.clone(),
            // `typeof raw !== 'string'` (js:400) — inclui o campo ausente.
            _ => return bad_request("campo raw (0x…) obrigatório"),
        },
        _ => return bad_request("campo raw (0x…) obrigatório"),
    };

    // `buildEavmEnvelope(raw, { state })` (js:402): a isenção de taxa depende do
    // REMETENTE, que só é conhecido depois de decodificar o raw — por isso o
    // estado entra como predicado.
    let envelope = {
        let estado = &node.blockchain.state;
        match eav7::eavm::envelope::build_eavm_envelope(&raw, agora_ms(), |de| {
            estado.is_fee_exempt(de)
        }) {
            Ok(tx) => tx,
            // O `catch` do JS aplica `strike(ip, 3)` e relança como 400. A falta
            // é aplicada pelo middleware de admissão, que é quem conhece o IP.
            Err(e) => return bad_request(e),
        }
    };

    let linha = crate::ai::bridge::tx_to_json(&envelope);
    match node.submit_transaction(envelope) {
        Err(e) => bad_request(e),
        Ok(r) => {
            if r.accepted && let Some(g) = &node.gossip_tx {
                let _ = g.send(linha);
            }
            let mut body = json!({ "accepted": r.accepted, "id": r.id });
            if let Some(motivo) = r.reason {
                body["reason"] = json!(motivo);
            }
            reply(200, body)
        }
    }
}

// ----------------------------------------------- GET /proof/{address} (js:561)

/// Prova de Merkle de UMA conta contra o `stateRoot` do header (light client).
///
/// A lib não expõe um `accountProof` pronto (stateroot.js:146); a composição
/// aqui usa SOMENTE peças públicas dela, na mesma ordem da referência:
/// `state.state_leaves()` (enumeração) → `sort_leaves` → índice da folha da
/// conta → `merkle_path`. `encodedAccount` é a forma `stable()` (BigInt como
/// "B<dec>") que o cliente usa para recompor a folha sem o estado inteiro.
///
/// O domínio `ctr` (contratos EAVM) ENTRA na enumeração: `state_leaves` emite
/// `leaf('ctr', addr, {code, storage, balance, nonce})` como `stateroot.js:74`
/// (ver `state/leaves.rs`, e o teste de contagem de folhas que fixa os 29
/// domínios). Ou seja, a prova composta aqui fecha contra a raiz da REDE, não só
/// contra a raiz local — o texto anterior, escrito antes do porte de
/// `state/contracts.rs`, dizia o contrário e sobreviveu ao porte.
pub fn proof(node: &Node, endereco_cru: &str) -> ApiReply {
    // js:562-564 — aceita 0x (mapeia para o E7 correspondente) ou E7 nativo.
    let endereco = if let Ok(e7) = eavm_to_e7(endereco_cru) {
        e7
    } else if is_valid_address(endereco_cru) {
        endereco_cru.to_string()
    } else {
        return bad_request("endereço inválido");
    };
    let bc = &node.blockchain;
    // js:565-566 — sem stateRoot no header não há o que provar (fork dormente).
    let Some(raiz) = bc.head().and_then(|b| b.state_root.clone()) else {
        return reply(501, json!({ "error": "stateRoot indisponível nesta altura (fork não ativo)" }));
    };
    let Some(conta) = bc.state.accounts.get(&endereco) else {
        return reply(404, json!({ "error": "conta inexistente" }));
    };
    // Folha-alvo e enumeração completa; erro de codificação canônica é
    // invariante interno quebrado (nunca entrada do usuário) → 500 genérico.
    let interno = || reply(500, json!({ "error": "erro interno ao processar a requisição" }));
    let Ok(alvo) = account_leaf(&endereco, &conta.to_value()) else { return interno() };
    let Ok(mut folhas) = bc.state.state_leaves() else { return interno() };
    sort_leaves(&mut folhas);
    // js:151-152 — indexOf sobre as ordenadas; aqui busca binária (já ordenado).
    let Ok(idx) = folhas.binary_search(&alvo) else {
        return reply(404, json!({ "error": "conta inexistente" }));
    };
    let caminho: Vec<serde_json::Value> = merkle_path(&folhas, idx)
        .into_iter()
        .map(|p| json!({ "hash": p.hash, "right": p.right }))
        .collect();
    reply(200, json!({
        "address": endereco,
        "height": bc.height(),
        "stateRoot": raiz,
        "encodedAccount": encoded_account(conta),
        "path": caminho,
    }))
}

// -------------------------------------- GET /logs (js:573) e /internal (js:593)

/// Eventos (`LOG`) emitidos por contrato, MAIS NOVOS PRIMEIRO (js:573-587).
///
/// Índice node-local: fica fora do `stateRoot` e é derivável reexecutando os
/// blocos. Estas rotas respondiam 501 enquanto o `Blockchain` do porte não
/// acumulava os índices — responder lista vazia teria MENTIDO para o eavscan
/// ("não há eventos" quando o certo era "não sei").
///
/// Filtros do JS: `address` (exato, caixa ignorada), `topic` (casa QUALQUER
/// posição — diferente do `eth_getLogs`, que é posicional), `from` (altura
/// mínima) e `limit` (1..1000, padrão 100).
pub fn logs_list(node: &Node, params: &HashMap<String, String>) -> ApiReply {
    let endereco = params.get("address").map(|a| a.to_lowercase());
    let topico = params.get("topic").map(|t| t.to_lowercase());
    let de = int_param(params.get("from"), 0) as u64;
    let limite = int_param(params.get("limit"), 100).clamp(1, 1000);

    let mut saida = Vec::new();
    for lg in node.blockchain.log_index.iter().rev() {
        if saida.len() >= limite {
            break;
        }
        if lg.block_height < de {
            continue;
        }
        if endereco.as_deref().is_some_and(|a| lg.address.to_lowercase() != a) {
            continue;
        }
        if topico.as_deref().is_some_and(|t| !lg.topics.iter().any(|x| x.to_lowercase() == t)) {
            continue;
        }
        saida.push(json!({
            "txId": lg.tx_id,
            "blockHeight": lg.block_height,
            "blockTime": lg.block_time,
            "address": lg.address,
            "topics": lg.topics,
            "data": lg.data,
        }));
    }
    reply(200, json!({ "logs": saida }))
}

/// Transferências INTERNAS — valor movido pela execução de um contrato, sem
/// transação assinada própria (js:593-616).
///
/// O filtro casa os QUATRO endereços (origem e destino, nas formas E7 e 0x):
/// quem consulta por `0x…` quer ver o mesmo movimento que quem consulta pelo E7
/// correspondente.
pub fn internal_list(node: &Node, params: &HashMap<String, String>) -> ApiReply {
    let (mut e7, mut a0x) = (None, None);
    if let Some(q) = params.get("address") {
        if let Ok(mapeado) = eavm_to_e7(q) {
            a0x = Some(q.to_lowercase());
            e7 = Some(mapeado);
        } else if is_valid_address(q) {
            e7 = Some(q.clone());
        } else {
            return bad_request("endereço EAV7 (E7…) ou EAVM (0x…) inválido");
        }
    }
    let de = int_param(params.get("from"), 0) as u64;
    let limite = int_param(params.get("limit"), 100).clamp(1, 1000);

    let mut saida = Vec::new();
    for x in node.blockchain.internal_index.iter().rev() {
        if saida.len() >= limite {
            break;
        }
        if x.block_height < de {
            continue;
        }
        if e7.is_some() {
            let casa = e7.as_deref() == Some(x.from_e7.as_str())
                || e7.as_deref() == Some(x.to_e7.as_str())
                || a0x.as_deref() == Some(x.from.as_str())
                || a0x.as_deref() == Some(x.to.as_str());
            if !casa {
                continue;
            }
        }
        saida.push(json!({
            // A referência empurra o objeto do `logSink` INTEIRO no índice
            // (blockchain.js:266) e o serve como está — e aquele objeto nasce com
            // `internal: true` (state.js:2615). O campo é o que distingue a
            // entrada de um evento para quem consome os dois índices.
            "internal": true,
            "txId": x.tx_id,
            "blockHeight": x.block_height,
            "blockTime": x.block_time,
            "kind": x.kind,
            "from": x.from,
            "to": x.to,
            "fromE7": x.from_e7,
            "toE7": x.to_e7,
            // `amount` sai como TEXTO decimal: é `BigInt.toString()` no JS, e um
            // número JSON perderia precisão acima de 2⁵³ no cliente.
            "amount": x.amount.to_string(),
        }));
    }
    reply(200, json!({ "internal": saida }))
}

// --------------------------------------------------------- GET /tx/{id} (js:629)

/// Uma transação por id: confirmada (com bloco), pendente (mempool) ou 404.
/// `get_transaction` da lib devolve `(tx, altura, hash do bloco)` — os campos
/// `blockHeight`/`blockHash` que o JS espalha de `getTransaction`
/// (blockchain.js:406).
pub fn tx_by_id(node: &Node, id: &str) -> ApiReply {
    let achada = match node.blockchain.transaction_at(id) {
        Ok(v) => v,
        Err(e) => return reply(500, json!({ "error": e })),
    };
    if let Some((tx, altura, hash_bloco)) = achada {
        let mut body = jv(&tx_to_json(&tx));
        // js:631 — `{ status: 'CONFIRMED', ...found }` onde found tem tx,
        // blockHeight e blockHash como IRMÃOS de status (tx é campo, não raiz).
        return reply(200, json!({
            "status": "CONFIRMED",
            "tx": std::mem::take(&mut body),
            "blockHeight": altura,
            "blockHash": hash_bloco,
        }));
    }
    if let Some(tx) = node.mempool.get(id) {
        return reply(200, json!({ "status": "PENDING", "tx": jv(&tx_to_json(tx)) }));
    }
    reply(404, json!({ "error": "transação não encontrada" }))
}

// --------------------------------------------------------- GET /mempool (js:638)

/// O mempool inteiro, em ordem de chegada (o `Vec` interno preserva a mesma
/// ordem de inserção que o `Map` do JS).
pub fn mempool_list(node: &Node) -> ApiReply {
    let lista: Vec<serde_json::Value> =
        node.mempool.all().iter().map(|t| jv(&tx_to_json(t))).collect();
    reply(200, serde_json::Value::Array(lista))
}

// ------------------------------------------------------------- GET /txs (js:645)

/// Transações recentes de TODA a cadeia, server-side, paginado por
/// `?before=altura`. Usa o índice esparso `blocks_with_txs` — carrega as últimas
/// transações REAIS mesmo com milhares de blocos vazios no fim (js:648-650).
///
/// Fidelidade ao detalhe: o JS despeja o bloco INTEIRO mesmo que ultrapasse
/// `limit` (não fatia), e `nextBefore` só aponta a próxima página quando o
/// limite foi atingido E ainda há blocos antes (js:662). Reproduzido igual.
pub fn txs_page(node: &Node, params: &HashMap<String, String>) -> ApiReply {
    let bc = &node.blockchain;
    let limit = int_param(params.get("limit"), 25).clamp(1, 100);
    let before = int_param(params.get("before"), usize::MAX) as u64;
    let mut txs: Vec<serde_json::Value> = Vec::new();
    let mut next_before: Option<u64> = None;
    for (i, &h) in bc.blocks_with_txs.iter().enumerate().rev() {
        if txs.len() >= limit {
            break;
        }
        if h >= before {
            continue;
        }
        // Caminho FUNDO: alturas antigas do índice esparso já podem ter deslizado
        // para o disco — o JS lê o store aqui (getBlock). Corrupção sobe como 500.
        let b = match bc.block_at(h) {
            Ok(Some(b)) => b,
            Ok(None) => continue,
            Err(e) => return reply(500, json!({ "error": e })),
        };
        for t in b.transactions.iter().rev() {
            // js:660 — `{ ...t, blockHeight, blockHash, blockTime }`: os campos
            // do bloco entram achatados NO MESMO objeto da transação.
            let mut o = jv(&tx_to_json(t));
            o["blockHeight"] = json!(h);
            o["blockHash"] = json!(b.hash);
            o["blockTime"] = json!(b.timestamp);
            txs.push(o);
        }
        if txs.len() >= limit && i > 0 {
            next_before = Some(h);
        }
    }
    reply(200, json!({ "txs": txs, "nextBefore": next_before, "height": bc.height() }))
}

// ----------------------------------------------------------- GET /search (js:671)

/// Índice de busca por endereço minúsculo — `searchIndex` de api.js:82.
/// Candidatos = contas nativas + holders de token (uma conta que só tem token,
/// sem EAV7 nativo, também precisa aparecer). Devolve pares `(minúsculo,
/// original)` ordenados pelo minúsculo; a casca cacheia por altura (o estado só
/// muda quando entra bloco — fecha o DoS de reindexação por request, achado M2).
pub fn search_index(node: &Node) -> Vec<(String, String)> {
    let st = &node.blockchain.state;
    let mut cand: BTreeSet<&String> = st.accounts.keys().collect();
    for tok in st.tokens.values() {
        for h in tok.balances.keys() {
            cand.insert(h);
        }
    }
    let mut sorted: Vec<(String, String)> =
        cand.into_iter().map(|a| (a.to_lowercase(), a.clone())).collect();
    // js:86 — sort SÓ pela chave minúscula (estável); ordenar pela tupla inteira
    // desempataria pelo original, o que o JS não faz.
    sorted.sort_by(|x, y| x.0.cmp(&y.0));
    sorted
}

/// `lowerBound` de api.js:90 — primeira posição cujo minúsculo não é menor que
/// `ql`. A fase de PREFIXO da busca é uma faixa contígua a partir daqui.
pub fn lower_bound(sorted: &[(String, String)], ql: &str) -> usize {
    let (mut lo, mut hi) = (0usize, sorted.len());
    while lo < hi {
        let mid = (lo + hi) >> 1;
        if sorted[mid].0.as_str() < ql {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

/// Busca universal estilo TronScan (js:671-711): endereço exato (E7 ou 0x), tx,
/// bloco, token por nome/símbolo/id, e endereço PARCIAL (prefixo binário +
/// substring limitada). Até 25 resultados, deduplicados pelo destino `to`.
/// `index` vem de `search_index` (cacheado por altura pela casca).
pub fn search(node: &Node, q_cru: &str, index: &[(String, String)]) -> ApiReply {
    let bc = &node.blockchain;
    let st = &bc.state;
    let q = q_cru.trim();
    let mut results: Vec<serde_json::Value> = Vec::new();
    // js:674 — dedupe por `to` e teto de 25, aplicados NA INSERÇÃO (a ordem das
    // fases decide quem entra quando o teto aperta).
    fn push(results: &mut Vec<serde_json::Value>, r: serde_json::Value) {
        if results.len() < 25 && !results.iter().any(|x| x["to"] == r["to"]) {
            results.push(r);
        }
    }
    if !q.is_empty() {
        let ql = q.to_lowercase();
        // js:677-678 — endereço exato nativo OU EAVM (else if: nunca os dois).
        if is_valid_address(q) {
            let detail = st
                .accounts
                .get(q)
                .map_or("conta".to_string(), |a| format!("{} EAV7", format_eav7(a.balance)));
            push(&mut results, json!({
                "kind": "Endereço", "label": q, "to": format!("/address/{q}"), "detail": detail,
            }));
        } else if let Ok(e7) = eavm_to_e7(q) {
            let detail = st
                .accounts
                .get(&e7)
                .map_or("conta EAVM".to_string(), |a| format!("{} EAV7", format_eav7(a.balance)));
            push(&mut results, json!({
                "kind": "MetaMask", "label": q, "to": format!("/address/{q}"), "detail": detail,
            }));
        }
        // js:679 — id de transação: 20-64 hex E existente (lookup O(1)).
        if (20..=64).contains(&q.len())
            && q.chars().all(|c| c.is_ascii_hexdigit())
            && bc.tx_index.contains_key(q)
        {
            push(&mut results, json!({ "kind": "Transação", "label": q, "to": format!("/tx/{q}") }));
        }
        // js:680 — altura de bloco: só dígitos e dentro da cadeia.
        if q.chars().all(|c| c.is_ascii_digit())
            && let Ok(n) = q.parse::<u64>()
            && bc.height() >= 0
            && n <= bc.height() as u64
        {
            push(&mut results, json!({
                "kind": "Bloco", "label": format!("#{q}"), "to": format!("/block/{q}"),
            }));
        }
        // js:681-684 — tokens por símbolo/nome/id (substring, registro pequeno).
        for (id, tok) in &st.tokens {
            if tok.symbol.to_lowercase().contains(&ql)
                || tok.name.to_lowercase().contains(&ql)
                || id.to_lowercase().contains(&ql)
            {
                push(&mut results, json!({
                    "kind": "Token",
                    "label": format!("{} · {}", tok.symbol, tok.name),
                    "sub": id,
                    "to": format!("/address/{id}"),
                }));
            }
        }
        // js:689-707 — endereço PARCIAL (≥ 2 chars): prefixo por busca binária
        // primeiro (faixa contígua no índice ordenado), depois substring com
        // teto de varredura anti-DoS para completar até 20 candidatos.
        if ql.len() >= 2 {
            let mut found: Vec<&str> = Vec::new();
            let mut seen: BTreeSet<&str> = BTreeSet::new();
            let mut i = lower_bound(index, &ql);
            while i < index.len() && index[i].0.starts_with(&ql) && found.len() < 20 {
                found.push(&index[i].1);
                seen.insert(&index[i].1);
                i += 1;
            }
            let scan = index.len().min(SEARCH_SUBSTR_SCAN_CAP);
            for entry in &index[..scan] {
                if found.len() >= 20 {
                    break;
                }
                if !seen.contains(entry.1.as_str()) && entry.0.contains(&ql) {
                    found.push(&entry.1);
                }
            }
            for addr in found {
                let acc = st.accounts.get(addr);
                let staked = acc.map_or(0, |a| a.staked);
                let balance = acc.map_or(0, |a| a.balance);
                // js:704 — stake ≥ mínimo apresenta como Validador.
                let kind = if staked >= MIN_VALIDATOR_STAKE { "Validador" } else { "Conta" };
                push(&mut results, json!({
                    "kind": kind,
                    "label": addr,
                    "to": format!("/address/{addr}"),
                    "detail": format!("{} EAV7", format_eav7(balance)),
                }));
            }
        }
    }
    reply(200, json!({ "query": q, "results": results }))
}

// ------------------------------------------------------------ GET /stats (js:714)

/// `computeStats` de api.js:29 fundido com a resposta de /stats (js:716-727):
/// contas, stake total, txs indexadas e a janela REAL de 24h (volume nativo,
/// contagem e séries horárias para os sparklines), varrendo só o índice esparso
/// de blocos-com-tx, com teto `STATS_SCAN_CAP`.
///
/// ATENÇÃO ao formato: aqui os montantes saem como NUMBER já dividido por UNIT
/// (EAV7 inteiros) — é o que o JS emite (`Number(s.volume24h / CHAIN.UNIT)`) e o
/// que os gráficos do eavscan consomem. É a exceção documentada à regra
/// "Amount sempre string": nada aqui é um Amount cru em e7.
pub fn compute_stats(node: &Node) -> Result<serde_json::Value, String> {
    let bc = &node.blockchain;
    let st = &bc.state;
    let staked: u128 = st.accounts.values().fold(0u128, |acc, a| acc.saturating_add(a.staked));

    let day_ms: i64 = 86_400_000;
    let now = bc.head().map_or(0, |b| b.timestamp);
    let from = now - day_ms;
    let bucket_ms = day_ms / STATS_BUCKETS as i64;
    let mut tx_series = [0u64; STATS_BUCKETS];
    let mut vol_series = [0u64; STATS_BUCKETS];
    let mut volume24h: u128 = 0;
    let mut tx_count_24h: u64 = 0;
    let mut scanned = 0usize;
    for &h in bc.blocks_with_txs.iter().rev() {
        if scanned >= STATS_SCAN_CAP {
            break;
        }
        // 24h = 86.400 blocos — MUITO além da janela de RAM (~5.100): o grosso da
        // série vem do disco. O JS lê o store no mesmo lugar.
        let b = match bc.block_at(h) {
            Ok(Some(b)) => b,
            Ok(None) => continue,
            Err(e) => return Err(e),
        };
        scanned += 1;
        if b.timestamp < from {
            break; // js:52 — saímos da janela de 24h
        }
        // js:53 — bucket horário, saturado nas pontas (o do instante `now` cai
        // exatamente em 24 e é puxado para 23).
        let bucket = ((b.timestamp - from) / bucket_ms).clamp(0, STATS_BUCKETS as i64 - 1) as usize;
        for t in &b.transactions {
            tx_count_24h += 1;
            tx_series[bucket] += 1;
            // js:25 — só transferências NATIVAS contam volume.
            if t.tx_type == "TRANSFER" || t.tx_type == "EAVM_TRANSFER" {
                let amt: u128 = t.amount.parse().unwrap_or(0);
                volume24h = volume24h.saturating_add(amt);
                // js:60 — a série acumula a divisão POR TRANSAÇÃO (piso), não o
                // total dividido no fim; reproduzir muda centavos, mas muda.
                vol_series[bucket] += (amt / UNIT) as u64;
            }
        }
    }

    Ok(json!({
        "accounts": st.accounts.len(),
        "accountsDelta": 0,                       // js:718 — sem histórico de estado
        "transactions": bc.tx_index.len(),
        "transactionsDelta": tx_count_24h,        // js:720 — txs REAIS em 24h
        "volume": (volume24h / UNIT) as u64,      // js:721 — EAV7 inteiros (Number no JS)
        "volumeDelta": (volume24h / UNIT) as u64,
        "staked": (staked / UNIT) as u64,
        "stakedDelta": 0,                         // js:724 — sem histórico
        "txSeries": tx_series.to_vec(),
        "volSeries": vol_series.to_vec(),
    }))
}

pub fn stats(node: &Node) -> ApiReply {
    match compute_stats(node) {
        Ok(v) => reply(200, v),
        Err(e) => reply(500, json!({ "error": e })),
    }
}

// -------------------------------------------------------------------- casca axum

/// Caches invalidados por ALTURA — espelho dos de api.js:21-22: o estado só muda
/// quando entra bloco, então /stats e o índice de /search recomputam no máximo
/// UMA vez por bloco (fecha o DoS assimétrico de varredura por request, achado
/// M2). Vivem na casca (module-level, como no JS) para manter os handlers puros;
/// num processo com mais de um `Node` o cache seria compartilhado — o JS tem a
/// mesma limitação e nenhum dos dois roda assim.
static STATS_CACHE: Mutex<Option<(i64, serde_json::Value)>> = Mutex::new(None);
/// O índice de busca compartilhado: pares `(chave, rótulo)` prontos para o
/// `/search`, atrás de `Arc` para o handler clonar sem copiar o vetor.
type SearchIndex = Arc<Vec<(String, String)>>;
static SEARCH_INDEX_CACHE: Mutex<Option<(i64, SearchIndex)>> = Mutex::new(None);

fn agora_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn erro_lock() -> Response {
    into_response(reply(500, json!({ "error": "estado envenenado" })))
}

async fn blocks_route(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    into_response(blocks(&node, &params))
}

async fn block_latest_route(State(state): State<AppState>) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    into_response(block_latest(&node))
}

async fn block_by_ref_route(
    State(state): State<AppState>,
    Path(referencia): Path<String>,
) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    into_response(block_by_ref(&node, &referencia))
}

async fn chain_route(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    into_response(chain_page(&node, &params))
}

async fn receive_block_route(State(state): State<AppState>, corpo: String) -> Response {
    let Ok(mut node) = state.write() else { return erro_lock() };
    into_response(receive_block(&mut node, &corpo, agora_ms()))
}

async fn submit_tx_route(State(state): State<AppState>, corpo: String) -> Response {
    let Ok(mut node) = state.write() else { return erro_lock() };
    into_response(submit_tx(&mut node, &corpo))
}

async fn submit_eavm_tx_route(State(state): State<AppState>, corpo: String) -> Response {
    let Ok(mut node) = state.write() else { return erro_lock() };
    into_response(submit_eavm_tx(&mut node, &corpo))
}

async fn proof_route(State(state): State<AppState>, Path(endereco): Path<String>) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    into_response(proof(&node, &endereco))
}

async fn logs_route(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    into_response(logs_list(&node, &params))
}

async fn internal_route(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    into_response(internal_list(&node, &params))
}

async fn tx_by_id_route(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    into_response(tx_by_id(&node, &id))
}

async fn mempool_route(State(state): State<AppState>) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    into_response(mempool_list(&node))
}

async fn txs_route(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    into_response(txs_page(&node, &params))
}

async fn search_route(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    let q = params.get("q").map(String::as_str).unwrap_or("");
    let altura = node.blockchain.height();
    // Cache por altura do índice ordenado (api.js:83): reusar entre requests da
    // mesma altura; reconstruir quando entra bloco.
    let indice = {
        let mut cache = SEARCH_INDEX_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        match cache.as_ref() {
            Some((h, idx)) if *h == altura => Arc::clone(idx),
            _ => {
                let novo = Arc::new(search_index(&node));
                *cache = Some((altura, Arc::clone(&novo)));
                novo
            }
        }
    };
    into_response(search(&node, q, &indice))
}

async fn stats_route(State(state): State<AppState>) -> Response {
    let Ok(node) = state.read() else { return erro_lock() };
    let altura = node.blockchain.height();
    // Cache por altura (api.js:30): sob rajada, todas as requests da mesma
    // altura reusam o mesmo resultado.
    let corpo = {
        let mut cache = STATS_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        match cache.as_ref() {
            Some((h, v)) if *h == altura => Ok(v.clone()),
            _ => match compute_stats(&node) {
                Ok(novo) => {
                    // Só resultado BOM entra no cache: um erro de disco cacheado
                    // esconderia a corrupção pelas próximas requests da altura.
                    *cache = Some((altura, novo.clone()));
                    Ok(novo)
                }
                Err(e) => Err(e),
            },
        }
    };
    match corpo {
        Ok(v) => into_response(reply(200, v)),
        Err(e) => into_response(reply(500, serde_json::json!({ "error": e }))),
    }
}

/// Rotas deste grupo. Sintaxe de parâmetro do axum 0.8: `{param}`. A rota
/// estática `/blocks/latest` tem precedência sobre `/blocks/{height}` no axum —
/// mesma ordem de decisão do JS (js:507 antes de js:512).
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/blocks", get(blocks_route).post(receive_block_route))
        .route("/blocks/latest", get(block_latest_route))
        .route("/blocks/{height}", get(block_by_ref_route))
        .route("/chain", get(chain_route))
        .route("/tx", axum::routing::post(submit_tx_route))
        .route("/eavm/tx", axum::routing::post(submit_eavm_tx_route))
        .route("/tx/{id}", get(tx_by_id_route))
        .route("/proof/{address}", get(proof_route))
        .route("/logs", get(logs_route))
        .route("/internal", get(internal_route))
        .route("/mempool", get(mempool_route))
        .route("/txs", get(txs_route))
        .route("/search", get(search_route))
        .route("/stats", get(stats_route))
}

// ------------------------------------------------------------------------ testes

#[cfg(test)]
mod tests {
    use super::*;
    use crate::guard::{AbuseGuard, GuardConfig};
    use eav7::block::Block;
    use eav7::blockchain::Blockchain;
    use eav7::derive_address_from;
    use eav7::mempool::Mempool;
    use eav7::stateroot::{compute_state_root, verify_state_proof, PathStep};
    use eav7::transaction::Tx;

    /// Mesmo construtor do teste de node.rs — nó mínimo, cadeia vazia.
    fn node() -> Node {
        Node {
            blockchain: Blockchain::new(),
            mempool: Mempool::new(),
            validator_address: None,
            peers: Vec::new(),
            security_alerts: Vec::new(),
            guard: std::sync::Arc::new(std::sync::Mutex::new(AbuseGuard::new(GuardConfig::default()))),
            gateway_target: None,
            gateway_snapshot: Default::default(),
            eavm_enabled: false,
            eavm_port: 0,
            public_rpc_url: None,
        self_url: None,
            admin_token: None,
            verified_contracts: Default::default(),
            eavm_index: std::sync::Arc::new(std::sync::Mutex::new(crate::node::EavmIndex::novo())),
            relay_bloco: None,
            pedir_sync: None,
            gossip_tx: None,
        }
    }

    /// Bloco FABRICADO (sem assinatura válida) enfiado direto nos campos
    /// públicos da `Blockchain`. Os handlers daqui são só-leitura: exercitam
    /// paginação/índice/serialização, nunca `add_block` — passar pelo consenso
    /// exigiria a carteira de teste da lib, que é `pub(crate)` lá (lacuna
    /// relatada; o caminho de escrita é coberto pelos testes da própria lib).
    fn bloco_fake(height: u64, timestamp: i64, transactions: Vec<Tx>) -> Block {
        Block {
            protocol: "eav20".into(),
            version: 1,
            scheme: "teste".into(),
            height,
            timestamp,
            previous_hash: "0".repeat(64),
            tx_root: "0".repeat(64),
            tx_count: transactions.len(),
            producer: "E7PRODUTOR".into(),
            public_key: None,
            pq_public_key: None,
            state_root: None,
            producer_account: None,
            genesis: None,
            signature: String::new(),
            pq_signature: String::new(),
            hash: format!("{:064x}", 0xead0_0000_u64 + height),
            transactions,
        }
    }

    fn adiciona(bc: &mut Blockchain, b: Block) {
        bc.hashes.insert(b.height, b.hash.clone());
        bc.hash_index.insert(b.hash.clone(), b.height);
        if !b.transactions.is_empty() {
            bc.blocks_with_txs.push(b.height);
            for t in &b.transactions {
                bc.tx_index.insert(t.id.clone().expect("tx de teste tem id"), b.height);
            }
        }
        bc.tail.push(b);
    }

    fn tx_fake(id: &str, tipo: &str, amount: &str, ts: i64) -> Tx {
        let mut t = Tx::new(tipo, "E7REMETENTE", 1, ts);
        t.amount = amount.into();
        t.id = Some(id.into());
        t
    }

    fn param(chave: &str, valor: &str) -> HashMap<String, String> {
        HashMap::from([(chave.to_string(), valor.to_string())])
    }

    /// Nó com 5 blocos (0..=4); os de altura 2 e 4 têm uma transação cada.
    fn node_com_cadeia() -> Node {
        let mut n = node();
        let base = 1_700_000_000_000i64;
        for h in 0u64..5 {
            let txs = if h == 2 || h == 4 {
                vec![tx_fake(&format!("{:040x}", h), "TRANSFER", "3000000", base + h as i64)]
            } else {
                Vec::new()
            };
            adiciona(&mut n.blockchain, bloco_fake(h, base + h as i64 * 3000, txs));
        }
        n
    }

    // ------------------------------------------------------------ /blocks

    #[test]
    fn blocks_sem_from_devolve_os_ultimos_em_ordem_decrescente() {
        let n = node_com_cadeia();
        let (code, body) = blocks(&n, &param("limit", "3"));
        assert_eq!(code.as_u16(), 200);
        let alturas: Vec<u64> =
            body.as_array().unwrap().iter().map(|b| b["height"].as_u64().unwrap()).collect();
        assert_eq!(alturas, vec![4, 3, 2]); // js:502 — janela final invertida
    }

    #[test]
    fn blocks_com_from_devolve_faixa_ascendente() {
        let n = node_com_cadeia();
        let mut p = param("from", "1");
        p.insert("limit".into(), "2".into());
        let (code, body) = blocks(&n, &p);
        assert_eq!(code.as_u16(), 200);
        let alturas: Vec<u64> =
            body.as_array().unwrap().iter().map(|b| b["height"].as_u64().unwrap()).collect();
        assert_eq!(alturas, vec![1, 2]);
    }

    #[test]
    fn blocks_em_cadeia_vazia_devolve_lista_vazia() {
        let n = node();
        let (code, body) = blocks(&n, &HashMap::new());
        assert_eq!(code.as_u16(), 200);
        assert!(body.as_array().unwrap().is_empty());
    }

    #[test]
    fn bloco_por_altura_e_por_hash_e_404() {
        let n = node_com_cadeia();
        let (code, body) = block_by_ref(&n, "3");
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["height"], json!(3));
        // por hash (o mesmo bloco)
        let hash = body["hash"].as_str().unwrap().to_string();
        let (code2, body2) = block_by_ref(&n, &hash);
        assert_eq!(code2.as_u16(), 200);
        assert_eq!(body2["height"], json!(3));
        // inexistente
        let (code3, body3) = block_by_ref(&n, "99");
        assert_eq!(code3.as_u16(), 404);
        assert_eq!(body3["error"], json!("bloco não encontrado"));
    }

    #[test]
    fn chain_pagina_com_height_from_blocks() {
        let n = node_com_cadeia();
        let mut p = param("from", "2");
        p.insert("limit".into(), "2".into());
        let (code, body) = chain_page(&n, &p);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["height"], json!(4));
        assert_eq!(body["from"], json!(2));
        assert_eq!(body["blocks"].as_array().unwrap().len(), 2);
    }

    // ---------------------------------------------------------------- /tx

    #[test]
    fn tx_nao_encontrada_da_404() {
        let n = node_com_cadeia();
        let (code, body) = tx_by_id(&n, "ffffffffffffffffffffffffffffffffffffffff");
        assert_eq!(code.as_u16(), 404);
        assert_eq!(body["error"], json!("transação não encontrada"));
    }

    #[test]
    fn tx_confirmada_traz_bloco_e_status() {
        let n = node_com_cadeia();
        let id = format!("{:040x}", 2u64); // tx do bloco 2
        let (code, body) = tx_by_id(&n, &id);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["status"], json!("CONFIRMED"));
        assert_eq!(body["blockHeight"], json!(2));
        assert_eq!(body["tx"]["id"], json!(id));
        assert_eq!(body["tx"]["type"], json!("TRANSFER"));
        assert_eq!(body["tx"]["amount"], json!("3000000")); // Amount = texto
    }

    #[test]
    fn corpo_invalido_no_post_e_400() {
        let mut n = node();
        let (code, _) = submit_tx(&mut n, "{isto não é json");
        assert_eq!(code.as_u16(), 400);
        let (code2, _) = receive_block(&mut n, "]]", 0);
        assert_eq!(code2.as_u16(), 400);
    }

    #[test]
    fn bloco_ja_conhecido_e_recusado_sem_erro() {
        let mut n = node_com_cadeia();
        // Reapresenta o bloco 3 da própria cadeia (dedupe por hash, node.js:213).
        let jvv = block_to_json(n.blockchain.get_block(3).unwrap());
        let corpo = eav7::canonical_json(&jvv);
        let (code, body) = receive_block(&mut n, &corpo, 0);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["accepted"], json!(false));
        assert_eq!(body["reason"], json!("bloco já conhecido"));
    }

    // ------------------------------------------------------------- /mempool, /txs

    #[test]
    fn txs_lista_global_com_metadados_de_bloco_e_paginacao() {
        let n = node_com_cadeia();
        let (code, body) = txs_page(&n, &HashMap::new());
        assert_eq!(code.as_u16(), 200);
        let txs = body["txs"].as_array().unwrap();
        assert_eq!(txs.len(), 2); // blocos 4 e 2, mais novos primeiro
        assert_eq!(txs[0]["blockHeight"], json!(4));
        assert_eq!(txs[1]["blockHeight"], json!(2));
        assert!(txs[0]["blockHash"].is_string());
        assert_eq!(body["nextBefore"], serde_json::Value::Null);
        assert_eq!(body["height"], json!(4));
        // limit=1: só a tx do bloco 4, e nextBefore aponta a página seguinte.
        let (_, body2) = txs_page(&n, &param("limit", "1"));
        assert_eq!(body2["txs"].as_array().unwrap().len(), 1);
        assert_eq!(body2["nextBefore"], json!(4));
        // before=4 pula o bloco 4.
        let (_, body3) = txs_page(&n, &param("before", "4"));
        assert_eq!(body3["txs"][0]["blockHeight"], json!(2));
    }

    // -------------------------------------------------------------- /search

    #[test]
    fn lower_bound_acha_a_primeira_posicao() {
        let idx: Vec<(String, String)> = ["e7aa", "e7ab", "e7ba"]
            .iter()
            .map(|s| (s.to_string(), s.to_uppercase()))
            .collect();
        assert_eq!(lower_bound(&idx, "e7ab"), 1);
        assert_eq!(lower_bound(&idx, "e7a"), 0);
        assert_eq!(lower_bound(&idx, "e7c"), 3);
    }

    #[test]
    fn search_vazia_devolve_zero_resultados() {
        let n = node();
        let (code, body) = search(&n, "  ", &[]);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["query"], json!(""));
        assert!(body["results"].as_array().unwrap().is_empty());
    }

    #[test]
    fn search_encontra_bloco_token_e_prefixo_de_endereco() {
        let mut n = node_com_cadeia();
        let endereco = derive_address_from("conta-de-teste"); // E7 válido
        n.blockchain.state.account_mut(&endereco).balance = 2_500_000; // 2,5 EAV7
        let tok = eav7::state::token::Token {
            symbol: "USDT".into(),
            name: "Tether USD".into(),
            ..Default::default()
        };
        n.blockchain.state.tokens.insert("1000001".into(), tok);

        let indice = search_index(&n);
        // bloco por altura
        let (_, body) = search(&n, "3", &indice);
        assert!(body["results"].as_array().unwrap().iter().any(|r| r["kind"] == json!("Bloco")));
        // token por símbolo (case-insensitive)
        let (_, body2) = search(&n, "usdt", &indice);
        let r2 = body2["results"].as_array().unwrap();
        assert!(r2.iter().any(|r| r["kind"] == json!("Token") && r["sub"] == json!("1000001")));
        // prefixo de endereço (minúsculo) acha a conta com saldo formatado
        let prefixo = endereco[..6].to_lowercase();
        let (_, body3) = search(&n, &prefixo, &indice);
        let r3 = body3["results"].as_array().unwrap();
        let conta = r3.iter().find(|r| r["label"] == json!(endereco.clone())).expect("conta");
        assert_eq!(conta["kind"], json!("Conta"));
        assert_eq!(conta["detail"], json!("2.5 EAV7"));
    }

    #[test]
    fn search_endereco_exato_valido() {
        let mut n = node();
        let endereco = derive_address_from("exata");
        n.blockchain.state.account_mut(&endereco).balance = 7 * UNIT;
        let indice = search_index(&n);
        let (_, body) = search(&n, &endereco, &indice);
        let r = &body["results"][0];
        assert_eq!(r["kind"], json!("Endereço"));
        assert_eq!(r["detail"], json!("7 EAV7"));
    }

    // --------------------------------------------------------------- /stats

    #[test]
    fn stats_de_cadeia_vazia_e_toda_zerada() {
        let n = node();
        let (code, body) = stats(&n);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["accounts"], json!(0));
        assert_eq!(body["transactions"], json!(0));
        assert_eq!(body["transactionsDelta"], json!(0));
        assert_eq!(body["volume"], json!(0));
        assert_eq!(body["staked"], json!(0));
        assert_eq!(body["txSeries"].as_array().unwrap().len(), STATS_BUCKETS);
        assert!(body["txSeries"].as_array().unwrap().iter().all(|v| v == &json!(0)));
        assert_eq!(body["volSeries"].as_array().unwrap().len(), STATS_BUCKETS);
    }

    #[test]
    fn stats_conta_janela_de_24h_e_volume_nativo() {
        let n = node_com_cadeia(); // 2 TRANSFER de 3 EAV7 (blocos 2 e 4)
        let (_, body) = stats(&n);
        assert_eq!(body["transactions"], json!(2));
        assert_eq!(body["transactionsDelta"], json!(2));
        assert_eq!(body["volume"], json!(6)); // 2 × 3_000_000 / UNIT
        // as duas txs caem no último bucket (timestamps colados na cabeça)
        let serie = body["txSeries"].as_array().unwrap();
        assert_eq!(serie[STATS_BUCKETS - 1], json!(2));
        let vol = body["volSeries"].as_array().unwrap();
        assert_eq!(vol[STATS_BUCKETS - 1], json!(6));
    }

    #[test]
    fn stats_ignora_tipos_nao_nativos_no_volume() {
        let mut n = node();
        let base = 1_700_000_000_000i64;
        let txs = vec![
            tx_fake(&"a".repeat(40), "TRANSFER", "1000000", base),
            tx_fake(&"b".repeat(40), "STAKE", "5000000", base), // não conta volume
        ];
        adiciona(&mut n.blockchain, bloco_fake(0, base, txs));
        let (_, body) = stats(&n);
        assert_eq!(body["transactionsDelta"], json!(2)); // contagem inclui as duas
        assert_eq!(body["volume"], json!(1)); // volume só a nativa
    }

    // --------------------------------------------------------------- /proof

    #[test]
    fn proof_501_sem_state_root_e_404_sem_conta() {
        let mut n = node_com_cadeia(); // blocos fake não têm stateRoot
        let endereco = derive_address_from("prova");
        n.blockchain.state.account_mut(&endereco).balance = 10;
        let (code, _) = proof(&n, &endereco);
        assert_eq!(code.as_u16(), 501);
        // agora com stateRoot no header, mas conta inexistente
        let raiz = compute_state_root(&n.blockchain.state.state_leaves().unwrap());
        n.blockchain.tail.last_mut().unwrap().state_root = Some(raiz);
        let outra = derive_address_from("sem-conta");
        let (code2, body2) = proof(&n, &outra);
        assert_eq!(code2.as_u16(), 404);
        assert_eq!(body2["error"], json!("conta inexistente"));
        // e endereço malformado é 400
        let (code3, _) = proof(&n, "nao-endereco");
        assert_eq!(code3.as_u16(), 400);
    }

    #[test]
    fn proof_gera_caminho_que_verifica_contra_a_raiz() {
        let mut n = node_com_cadeia();
        let endereco = derive_address_from("prova-valida");
        n.blockchain.state.account_mut(&endereco).balance = 123_456_789;
        n.blockchain.state.account_mut(&derive_address_from("vizinha")).balance = 1;
        let raiz = compute_state_root(&n.blockchain.state.state_leaves().unwrap());
        n.blockchain.tail.last_mut().unwrap().state_root = Some(raiz.clone());

        let (code, body) = proof(&n, &endereco);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["address"], json!(endereco.clone()));
        assert_eq!(body["stateRoot"], json!(raiz.clone()));
        assert_eq!(body["height"], json!(4));
        // Amounts na forma stable(): "B<decimal>"
        assert_eq!(body["encodedAccount"]["balance"], json!("B123456789"));
        assert_eq!(body["encodedAccount"]["nonce"], json!(0));
        // o caminho devolvido fecha contra a raiz do header
        let caminho: Vec<PathStep> = body["path"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| PathStep {
                hash: p["hash"].as_str().unwrap().to_string(),
                right: p["right"].as_bool().unwrap(),
            })
            .collect();
        let conta = n.blockchain.state.accounts.get(&endereco).unwrap();
        let folha = account_leaf(&endereco, &conta.to_value()).unwrap();
        assert!(verify_state_proof(&raiz, &folha, &caminho));
    }

    // ------------------------------------------------------------------ formato

    /// Nó SEM eventos responde 200 com lista vazia — não 404 nem 501. A rota
    /// existe e a resposta é verdadeira: não há eventos.
    #[test]
    fn logs_e_internal_de_cadeia_vazia_sao_listas_vazias() {
        let n = node();
        assert_eq!(logs_list(&n, &HashMap::new()).1["logs"], json!([]));
        assert_eq!(internal_list(&n, &HashMap::new()).1["internal"], json!([]));
    }

    #[test]
    fn format_eav7_apara_zeros_da_fracao() {
        assert_eq!(format_eav7(0), "0");
        assert_eq!(format_eav7(2_500_000), "2.5");
        assert_eq!(format_eav7(7 * UNIT), "7");
        assert_eq!(format_eav7(1_000_001), "1.000001");
    }

    /// `0X` MAIÚSCULO não é endereço EAVM — a referência usa
    /// `/^0x[0-9a-fA-F]{40}$/`, com o prefixo em minúsculo.
    ///
    /// Havia aqui uma cópia local de `isEavmAddress` que aceitava `0X`: dois
    /// nós divergiam na admissão da MESMA rota, e a mesma consulta dava 200 num
    /// e 400 no outro. A cópia saiu; quem valida agora é a lib.
    #[test]
    fn prefixo_0x_maiusculo_nao_e_endereco_eavm() {
        let n = node();
        let maiusculo = format!("0X{}", "ab".repeat(20));
        let (code, _) = proof(&n, &maiusculo);
        assert_eq!(code, 400, "0X não é endereço EAVM nem E7 — é entrada inválida");
    }

    // ------------------------------------------------------ /logs e /internal

    /// Nó com eventos e transferências internas nos índices node-locais.
    fn no_com_indices() -> Node {
        use eav7::blockchain::{EventoIndexado, TransferenciaInterna};
        let mut n = node();
        n.blockchain.log_index = vec![
            EventoIndexado {
                tx_id: "tx-a".into(),
                block_height: 3,
                block_time: 100,
                address: format!("0x{}", "11".repeat(20)),
                topics: vec![format!("0x{}", "aa".repeat(32))],
                data: "0x01".into(),
            },
            EventoIndexado {
                tx_id: "tx-b".into(),
                block_height: 5,
                block_time: 200,
                address: format!("0x{}", "22".repeat(20)),
                topics: vec![format!("0x{}", "bb".repeat(32)), format!("0x{}", "aa".repeat(32))],
                data: "0x02".into(),
            },
        ];
        n.blockchain.internal_index = vec![TransferenciaInterna {
            tx_id: "tx-c".into(),
            block_height: 4,
            block_time: 150,
            kind: "call".into(),
            from: format!("0x{}", "33".repeat(20)),
            to: format!("0x{}", "44".repeat(20)),
            from_e7: derive_address_from("interna:origem"),
            to_e7: derive_address_from("interna:destino"),
            amount: 7_000_000,
        }];
        n
    }

    fn q(pares: &[(&str, &str)]) -> HashMap<String, String> {
        pares.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// `/logs` devolve os eventos MAIS NOVOS PRIMEIRO. Respondia 501 enquanto os
    /// índices não existiam.
    #[test]
    fn logs_devolve_do_mais_novo_para_o_mais_antigo() {
        let n = no_com_indices();
        let (code, body) = logs_list(&n, &q(&[]));
        assert_eq!(code, 200);
        let logs = body["logs"].as_array().expect("lista");
        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0]["blockHeight"], json!(5), "o mais recente vem primeiro");
        assert_eq!(logs[1]["blockHeight"], json!(3));
    }

    /// O filtro por tópico de `/logs` casa QUALQUER posição — diferente do
    /// `eth_getLogs`, que é posicional. São duas rotas com semânticas distintas
    /// de propósito (js:583 usa `.some`).
    #[test]
    fn logs_filtra_por_endereco_e_por_topico_em_qualquer_posicao() {
        let n = no_com_indices();
        let conta = |p: &[(&str, &str)]| logs_list(&n, &q(p)).1["logs"].as_array().expect("lista").len();

        assert_eq!(conta(&[("address", &format!("0x{}", "11".repeat(20)))]), 1);
        assert_eq!(conta(&[("address", &format!("0X{}", "11".repeat(20)).to_uppercase())]), 1, "caixa ignorada");
        // O tópico `aa` está na posição 0 de um log e na posição 1 do outro.
        assert_eq!(conta(&[("topic", &format!("0x{}", "aa".repeat(32)))]), 2);
        assert_eq!(conta(&[("topic", &format!("0x{}", "cc".repeat(32)))]), 0);
        assert_eq!(conta(&[("from", "5")]), 1, "só do bloco 5 para cima");
        assert_eq!(conta(&[("limit", "1")]), 1);
    }

    /// `/internal` casa as QUATRO formas do endereço: quem consulta pelo `0x…`
    /// tem de ver o mesmo movimento que quem consulta pelo E7 correspondente.
    #[test]
    fn internal_casa_endereco_nas_formas_e7_e_0x() {
        let n = no_com_indices();
        let interna = &n.blockchain.internal_index[0];
        let (de_e7, de_0x) = (interna.from_e7.clone(), interna.from.clone());
        let para_e7 = interna.to_e7.clone();

        let conta = |a: &str| internal_list(&n, &q(&[("address", a)])).1["internal"].as_array().expect("lista").len();
        assert_eq!(conta(&de_e7), 1, "origem em E7");
        assert_eq!(conta(&para_e7), 1, "destino em E7");
        assert_eq!(conta(&de_0x), 1, "origem em 0x");
        assert_eq!(conta(&derive_address_from("alguem-de-fora")), 0);

        let (code, _) = internal_list(&n, &q(&[("address", "nem-uma-coisa-nem-outra")]));
        assert_eq!(code, 400, "endereço ilegível é entrada inválida, não lista vazia");
    }

    /// `amount` sai como TEXTO decimal — número JSON perderia precisão acima de
    /// 2⁵³ no cliente.
    #[test]
    fn internal_devolve_amount_como_texto() {
        let n = no_com_indices();
        let (_, body) = internal_list(&n, &q(&[]));
        assert_eq!(body["internal"][0]["amount"], json!("7000000"));
        assert_eq!(body["internal"][0]["kind"], json!("call"));
    }
}
