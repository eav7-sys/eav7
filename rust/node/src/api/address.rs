//! Rotas de ENDEREÇO da API — porte de `src/node/api.js`:
//!
//! - `GET /address/{addr}`           → dossiê completo da conta (api.js:732-940)
//! - `GET /address/{addr}/txs`       → histórico paginado (api.js:944-985)
//! - `GET /address/{addr}/analysis`  → agregados p/ a aba de análise (api.js:990-1037)
//! - `GET /eavm/address/{addr}`      → mapeamento 0x → E7 (api.js:488-492)
//!
//! Cada handler é uma FUNÇÃO PURA `(&Node, params) -> ApiReply` — a casca axum só
//! extrai parâmetros e pega o lock (padrão do exemplar `status` em `mod.rs`).
//!
//! CONTRATO DE FORMATO: o frontend (eavscan/carteiras) casa campo a campo com o
//! JSON do nó JS — camelCase, valores monetários (u128) SEMPRE como string
//! decimal (o JS usa `toJson`, que converte BigInt em string), contadores e
//! alturas como número. Onde o JS OMITE uma chave (`undefined` some no
//! `JSON.stringify`), aqui a chave também é omitida — nunca trocada por `null`.
//!
//! `receipt` (em /txs) vem de `blockchain.receipts` — recibos de execução EAVM.
//! A ausência de recibo significa "aplicou-se com sucesso" e é o valor correto
//! para toda transação não-EAVM; era MENTIRA enquanto o índice não existia e
//! TODAS saíam `null`, porque uma chamada revertida ficava indistinguível de uma
//! transferência comum.
//!
//! (Já NÃO é lacuna: o campo `contract`. O estado Rust TEM a seção `contracts`
//! (`eav7::state::State::contracts`, ver `state/contracts.rs`), e o dossiê a lê
//! de verdade — ver [`address_dossier`]. O comentário que dizia o contrário
//! sobreviveu ao porte da estrutura de contratos e mantinha um `null` fixo.)

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde_json::{json, Map, Value};

use eav7::block::tx_to_json;
use eav7::config as c;
use eav7::state::gov::{Nivel, Permission};
use eav7::state::State as ChainState;
use eav7::transaction::{Tx, EAVM_SCHEME};
use eav7::{canonical_json, derive_address_from, format_eav7, is_valid_address, JsonValue};

use super::{bad_request, int_param, into_response, reply, ApiReply, AppState};
use crate::node::Node;

// ------------------------------------------------------------------ utilitários

/// `isEavmAddress` (`envelope.js:44`): `^0x[0-9a-fA-F]{40}$`.
fn is_eavm_address(v: &str) -> bool {
    v.len() == 42 && v.starts_with("0x") && v.as_bytes()[2..].iter().all(u8::is_ascii_hexdigit)
}

/// `eavmToE7` (`envelope.js:49`): endereço E7 determinístico da conta EAVM —
/// `deriveAddressFrom('EAV7-EAVM:' + 0x minúsculo)`. Mesma pré-imagem, mesmo E7
/// em toda a rede; a lib expõe `derive_address_from`, então não há nada a portar
/// além da concatenação.
fn eavm_to_e7(eavm: &str) -> String {
    derive_address_from(format!("EAV7-EAVM:{}", eavm.to_lowercase()))
}

/// `BigInt(t.amount ?? 0)` do JS: os valores vêm como string decimal na Tx;
/// texto inválido vira 0 (no JS lançaria, mas uma tx com amount inválido nunca
/// entra num bloco — o fallback é inalcançável e só evita um `unwrap`).
fn amount_u128(s: &str) -> u128 {
    s.parse().unwrap_or(0)
}

/// Lê um campo string não-vazio de `tx.data` (o teste de VERDADE do JS:
/// `t.data.eavmFrom` truthy ⇒ string não vazia).
fn data_str<'a>(data: &'a Option<JsonValue>, key: &str) -> Option<&'a str> {
    match data {
        Some(JsonValue::Map(m)) => match m.get(key) {
            Some(JsonValue::Str(s)) if !s.is_empty() => Some(s),
            _ => None,
        },
        _ => None,
    }
}

/// `String(t.data?.tokenId ?? '')` (api.js:976): o tokenId pode vir como string
/// ou número no `data`; o JS coage para string sempre.
fn data_token_id(data: &Option<JsonValue>) -> String {
    match data {
        Some(JsonValue::Map(m)) => match m.get("tokenId") {
            Some(JsonValue::Str(s)) => s.clone(),
            Some(JsonValue::Int(n)) => n.to_string(),
            _ => String::new(),
        },
        _ => String::new(),
    }
}

/// Transação → JSON de apresentação, campo a campo igual ao objeto do JS
/// (`{...t}` em api.js:978). Reusa `tx_to_json` (a serialização FIEL da lib —
/// `type`, `publicKey`, ausente≠nulo) e converte o JSON canônico para
/// `serde_json` — a fronteira consenso/apresentação documentada no Cargo.toml.
fn tx_json(tx: &Tx) -> Value {
    serde_json::from_str(&canonical_json(&tx_to_json(tx))).unwrap_or(Value::Null)
}

/// Identidade do ativo movido por uma tx, quando não é o EAV7 nativo
/// (api.js:966-977). Resolver aqui poupa o explorer de buscar o catálogo de
/// tokens para cada linha do histórico.
fn asset_de(st: &ChainState, t: &Tx) -> Value {
    // api.js:971: `typeof tokId === 'string' && state.tokens[tokId]`.
    if let Some(tok_id) = data_str(&t.data, "token")
        && let Some(tk) = st.tokens.get(tok_id)
    {
        return json!({
            "kind": "EAV20",
            "id": tok_id,
            "symbol": tk.symbol,
            "name": tk.name,
            "decimals": tk.decimals,
        });
    }
    // api.js:974: senão, coleção EAV721.
    if let Some(col_id) = data_str(&t.data, "collection")
        && let Some(col) = st.nfts.get(col_id)
    {
        return json!({
            "kind": "EAV721",
            "id": col_id,
            "symbol": col.symbol,
            "name": col.name,
            "tokenId": data_token_id(&t.data),
        });
    }
    Value::Null
}

/// `energyOf`/`bandwidthOf` (`state.js:169`/`state.js:130`): leitura PURA do par
/// `{max, available}` com regeneração linear preguiçosa. A lib não expõe esses
/// helpers (só os campos crus da conta), mas a fórmula é aritmética inteira sobre
/// campos públicos + constantes públicas de `config` — mesmo resultado do JS
/// (lá os operandos são Numbers, mas todos inteiros < 2^53, então a divisão com
/// `Math.floor` coincide com a divisão inteira daqui).
///
/// `height` chega como `i64` porque `blockchain.height()` é −1 na cadeia vazia —
/// o `max(0)` do JS (`Math.max(0, height - block)`) já cobre esse caso.
fn recurso(free: u64, per_staked: u64, regen: u64, rstake: u128, used: u64, marco: u64, height: i64) -> (u64, u64) {
    // maxE = FREE + Number(resourceStake / UNIT) * PER_STAKED (state.js:120/125).
    let max: u128 = free as u128 + (rstake / c::UNIT) * per_staked as u128;
    let elapsed: u128 = if height >= 0 { (height as u64).saturating_sub(marco) as u128 } else { 0 };
    // used = max(0, usedCru - floor(max*elapsed/REGEN)) (state.js:174).
    let usado = (used as u128).saturating_sub(max * elapsed / regen as u128);
    let disponivel = max.saturating_sub(usado);
    (max.min(u64::MAX as u128) as u64, disponivel.min(u64::MAX as u128) as u64)
}

/// `lista(nivel)` (api.js:827-830): mapa `{addr: peso}` → lista ordenada por peso
/// decrescente. `sort_by` é estável; empates ficam na ordem do `BTreeMap` (por
/// endereço) — no JS ficam na ordem de inserção do objeto, que não sobrevive ao
/// porte (divergência apenas de ORDEM entre pesos iguais, nunca de conteúdo).
fn lista(n: &Nivel) -> Vec<Value> {
    let mut ks: Vec<(&String, &u64)> = n.keys.iter().collect();
    ks.sort_by(|a, b| b.1.cmp(a.1));
    ks.into_iter().map(|(address, weight)| json!({ "address": address, "weight": weight })).collect()
}

/// `new Date(ms).toISOString().slice(0, 10)` (api.js:1017) sem puxar chrono:
/// dias civis a partir da época (algoritmo de Howard Hinnant, `civil_from_days`).
fn iso_date(ts_ms: i64) -> String {
    let z = ts_ms.div_euclid(86_400_000) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

// ------------------------------------------------- GET /address/{addr} (dossiê)

/// Handler PURO do dossiê de endereço — `api.js:732-940`. Endereço DESCONHECIDO
/// devolve o dossiê zerado com 200 (o JS nunca dá 404 aqui); só formato inválido
/// dá 400.
pub fn address_dossier(node: &Node, raw: &str) -> ApiReply {
    let bc = &node.blockchain;
    let st = &bc.state;
    let height = bc.height(); // i64; −1 na cadeia vazia, como a referência.

    // api.js:735-742: aceita E7… nativo ou 0x… EAVM (MetaMask/Trust Wallet) —
    // o 0x é convertido para o E7 mapeado correspondente.
    let (address, eavm_address_eco) = if is_eavm_address(raw) {
        (eavm_to_e7(raw), Some(raw.to_lowercase()))
    } else if is_valid_address(raw) {
        (raw.to_string(), None)
    } else {
        return bad_request("endereço EAV7 (E7…) ou EAVM (0x…) inválido");
    };

    // `state.accounts[address]` com defaults (`acc?.x ?? 0n`): `State::account`
    // devolve a conta default para desconhecidos — mesma semântica.
    let acc = st.account(&address);
    let sem_indice: Vec<u64> = Vec::new();
    let heights: &[u64] = bc.address_tx_index.get(&address).map_or(&sem_indice, |v| v.as_slice());

    // api.js:763-775: vínculo E7 → 0x. Consulta por 0x ecoa; consulta por E7
    // resolve pelo histórico EAVM do próprio endereço (últimas 80 entradas do
    // índice — leitura, sem impacto de consenso).
    let eavm_address = 'busca: {
        if let Some(eco) = eavm_address_eco {
            break 'busca Some(eco);
        }
        for (seen, &h) in heights.iter().rev().enumerate() {
            if seen >= 80 {
                break;
            }
            // Caminho FUNDO (RAM + disco): o histórico pode ter deslizado da
            // janela. Corrupção de disco sobe como 500, como o JS (getBlock lança).
            let b = match bc.block_at(h) {
                Ok(Some(b)) => b,
                Ok(None) => continue,
                Err(e) => return reply(500, json!({ "error": e })),
            };
            for t in &b.transactions {
                if t.scheme != EAVM_SCHEME || t.data.is_none() {
                    continue;
                }
                if t.from == address
                    && let Some(s) = data_str(&t.data, "eavmFrom")
                {
                    break 'busca Some(s.to_string());
                }
                if t.to.as_deref() == Some(address.as_str())
                    && let Some(s) = data_str(&t.data, "eavmTo")
                {
                    break 'busca Some(s.to_string());
                }
            }
        }
        None
    };

    // api.js:747-754: NFTs (EAV721) da conta — varredura com teto 200 (anti-DoS).
    let mut owned_nfts: Vec<Value> = Vec::new();
    'nfts: for (cid, col) in &st.nfts {
        for (token_id, tk) in &col.tokens {
            if tk.owner == address {
                owned_nfts.push(json!({
                    "collection": cid, "symbol": col.symbol, "tokenId": token_id, "uri": tk.uri,
                }));
            }
            if owned_nfts.len() >= 200 {
                break 'nfts;
            }
        }
    }

    // api.js:755-758: nomes EAV-NS possuídos (teto 100).
    let owned_names: Vec<Value> = st
        .names
        .iter()
        .filter(|(_, r)| r.owner == address)
        .take(100)
        .map(|(name, r)| json!({ "name": name, "target": r.target }))
        .collect();

    // api.js:781-787: parcelas de UNSTAKE aguardando maturação. A fila Rust é
    // `(dono, valor, altura de liberação)`.
    let unbonding: Vec<Value> = st
        .unbonding
        .iter()
        .filter(|(dono, _, _)| *dono == address)
        .map(|(_, amount, mature_at)| {
            json!({
                "amount": amount.to_string(),
                "matureAt": mature_at,
                // Math.max(0, matureAt - height); height pode ser −1 (cadeia vazia).
                "blocksLeft": (*mature_at as i64 - height).max(0),
            })
        })
        .collect();

    // api.js:790-791: energia e banda `{max, available}` — ver `recurso`.
    // `resource_stake()` só erra se delegatedOut > staked+delegatedIn, invariante
    // que o protocolo impede; o fallback 0 nunca dispara em estado válido.
    let rstake = acc.resource_stake().unwrap_or(0);
    let (e_max, e_avail) =
        recurso(c::energy::FREE, c::energy::PER_STAKED_EAV7, c::energy::REGEN_BLOCKS, rstake, acc.energy_used, acc.energy_block, height);
    let (b_max, b_avail) = recurso(
        c::bandwidth::FREE,
        c::bandwidth::PER_STAKED_EAV7,
        c::bandwidth::REGEN_BLOCKS,
        rstake,
        acc.bandwidth_used,
        acc.bandwidth_block,
        height,
    );

    // api.js:799-811: delegações achatadas com direção; entradas com teto
    // (5000 contas varridas OU 100 itens) — anti-DoS igual ao JS.
    let delegations: Vec<Value> = {
        let mut out: Vec<Value> = Vec::new();
        if let Some(saidas) = st.delegations.get(&address) {
            for (to, amount) in saidas {
                out.push(json!({ "from": address, "to": to, "amount": amount.to_string(), "direction": "out" }));
            }
        }
        for (scanned, (from, d)) in st.delegations.iter().enumerate() {
            // JS: `if (scanned++ >= 5000 || out.length >= 100) break;`
            if scanned >= 5000 || out.len() >= 100 {
                break;
            }
            if *from == address {
                continue;
            }
            if let Some(amount) = d.get(&address) {
                out.push(json!({ "from": from, "to": address, "amount": amount.to_string(), "direction": "in" }));
            }
        }
        out
    };

    // api.js:814-815: votos EMITIDOS + total alocado (`votedTotal`, state.js:615).
    let votes_cast: Vec<Value> = st
        .votes
        .get(&address)
        .map(|m| m.iter().map(|(to, amount)| json!({ "to": to, "amount": amount.to_string() })).collect())
        .unwrap_or_default();
    let voted_total: u128 = st.votes.get(&address).map(|m| m.values().sum()).unwrap_or(0);

    // api.js:824-854: estrutura de permissões. Sem multisig configurado, sai a
    // permissão EFETIVA padrão sintetizada (limiar 1, a própria conta) com
    // `default: true`. O enum Rust {V1, V2} mapeia 1:1 nas duas formas do JS.
    let permissions = match st.permissions.get(&address) {
        None => json!({ "default": true, "threshold": 1, "keys": [{ "address": address, "weight": 1 }] }),
        Some(Permission::V1(n)) => {
            json!({ "default": false, "version": 1, "threshold": n.threshold, "keys": lista(n) })
        }
        Some(Permission::V2 { owner, actives, witness, recovery, delay_blocks }) => {
            let mut v = json!({
                "default": false,
                "version": 2,
                "owner": { "threshold": owner.threshold, "keys": lista(owner) },
                // `id` da active é o índice — o JS grava `lvl.id = id` na
                // normalização (state.js:258) com o índice da lista.
                "actives": actives.iter().enumerate().map(|(id, a)| json!({
                    "id": id,
                    "name": a.name,          // `a.name ?? null`
                    "threshold": a.nivel.threshold,
                    "keys": lista(&a.nivel),
                    "operations": a.operations, // `a.operations ?? null`
                })).collect::<Vec<_>>(),
                "witness": witness,   // `p.witness ?? null`
                "recovery": recovery, // `p.recovery ?? null`
                "delayBlocks": delay_blocks,
                // Compat: quem só conhece o formato antigo enxerga a active
                // PRIMÁRIA (api.js:849-850). `lista(undefined)` no JS dá [].
                "keys": actives.first().map(|a| lista(&a.nivel)).unwrap_or_default(),
            });
            // `threshold: p.actives?.[0]?.threshold` — undefined é OMITIDO pelo
            // JSON.stringify, então sem active primária a chave nem existe.
            if let Some(a0) = actives.first() {
                v.as_object_mut().expect("objeto").insert("threshold".into(), json!(a0.nivel.threshold));
            }
            v
        }
    };

    // api.js:856-867: mudança estrutural de permissão enfileirada (timelock).
    let pending_permission = st
        .pending_perm
        .get(&address)
        .map(|pp| {
            json!({
                "level": pp.change.nivel(),
                "approvals": pp.approvals.keys().collect::<Vec<_>>(),
                "vetoes": pp.vetoes.keys().collect::<Vec<_>>(),
                "executeAt": pp.execute_at,
                // executeAt === null → blocksLeft null; senão max(0, executeAt - height).
                "blocksLeft": pp.execute_at.map(|e| (e as i64 - height).max(0)),
            })
        })
        .unwrap_or(Value::Null);

    // api.js:869-872: vesting em que a conta é beneficiária (teto 50).
    let vesting: Vec<Value> = st
        .vesting
        .iter()
        .filter(|(_, v)| v.beneficiary == address)
        .take(50)
        .map(|(id, v)| {
            json!({
                "id": id,
                "total": v.total.to_string(),
                "claimed": v.claimed.to_string(),
                "cliff": v.cliff,
                "duration": v.duration,
            })
        })
        .collect();

    // api.js:883-915: resumo de atividade. `blocks` é exato e O(1) pelo índice;
    // `txCount` varre com teto (2000 ALTURAS do índice, contadas mesmo quando o
    // bloco saiu da janela) — `truncated` avisa quando cortou.
    const ACTIVITY_SCAN_CAP: usize = 2000;
    let activity = if heights.is_empty() {
        // O retorno vazio do JS NÃO tem transfers/transfersIn/transfersOut.
        json!({ "firstSeen": null, "lastSeen": null, "txCount": 0, "blocks": 0, "truncated": false })
    } else {
        // Caminho FUNDO: o primeiro bloco de uma conta antiga está no disco.
        let fundo = |h: u64| -> Result<Option<eav7::block::Block>, String> { bc.block_at(h) };
        let (first, last) = match (fundo(heights[0]), fundo(*heights.last().expect("não vazio"))) {
            (Ok(a), Ok(b)) => (a, b),
            (Err(e), _) | (_, Err(e)) => return reply(500, json!({ "error": e })),
        };
        let (mut tx_count, mut transfers_in, mut transfers_out) = (0u64, 0u64, 0u64);
        for &h in heights.iter().rev().take(ACTIVITY_SCAN_CAP) {
            let b = match bc.block_at(h) {
                Ok(Some(b)) => b,
                Ok(None) => continue,
                Err(e) => return reply(500, json!({ "error": e })),
            };
            for t in &b.transactions {
                let out = t.from == address;
                let inc = t.to.as_deref() == Some(address.as_str());
                if !out && !inc {
                    continue;
                }
                tx_count += 1;
                // "Transferências" no sentido do explorer: movimento de valor.
                if amount_u128(&t.amount) > 0 {
                    if out {
                        transfers_out += 1;
                    } else {
                        transfers_in += 1;
                    }
                }
            }
        }
        json!({
            "firstSeen": first.map(|b| b.timestamp),
            "lastSeen": last.map(|b| b.timestamp),
            "txCount": tx_count,
            "transfers": transfers_in + transfers_out,
            "transfersIn": transfers_in,
            "transfersOut": transfers_out,
            "blocks": heights.len(),
            "truncated": heights.len() > ACTIVITY_SCAN_CAP,
        })
    };

    // api.js:917 → `pendingVoterReward` (state.js:563-574): recompensa de eleitor
    // ainda não resgatada. A lib não expõe o método, mas a fórmula usa só campos
    // públicos (`rewardAccPerVote`, `voterRewardDebt`) + REWARD_SCALE. `acc-debt`
    // negativo no JS dá pending negativo (descartado pelo `> 0n`); aqui o
    // `checked_sub` descarta o mesmo caso.
    let claimable_voter_reward: u128 = st
        .votes
        .get(&address)
        .map(|vs| {
            vs.iter()
                .map(|(validator, amount)| {
                    if *amount == 0 {
                        return 0;
                    }
                    let acc_v = st.reward_acc_per_vote.get(validator).copied().unwrap_or(0);
                    let debt = st.voter_reward_debt.get(&address).and_then(|m| m.get(validator)).copied().unwrap_or(0);
                    match acc_v.checked_sub(debt) {
                        // Overflow do produto é impossível com os parâmetros da
                        // rede; o `unwrap_or(0)` só remove o pânico teórico.
                        Some(diff) => amount.checked_mul(diff).map(|x| x / c::REWARD_SCALE).unwrap_or(0),
                        None => 0,
                    }
                })
                .sum()
        })
        .unwrap_or(0);

    // api.js:919-929: aprovações EAV20 concedidas (allowance > 0; teto 100).
    let mut approvals: Vec<Value> = Vec::new();
    'aprov: for (token_id, tk) in &st.tokens {
        if let Some(allow) = tk.allowances.get(&address) {
            for (spender, amount) in allow {
                if *amount == 0 {
                    continue;
                }
                approvals.push(json!({
                    "token": token_id, "symbol": tk.symbol, "spender": spender, "amount": amount.to_string(),
                }));
                if approvals.len() >= 100 {
                    break 'aprov;
                }
            }
        }
    }

    // api.js:931: `state.validators().some(...)`. A lib expõe a função livre.
    let is_validator =
        eav7::blockchain::validators(st).map(|vs| vs.iter().any(|v| v.address == address)).unwrap_or(false);

    // api.js:934 → `tokenBalancesOf` (state.js:819): mapa id → {symbol, decimals, balance}.
    let mut tokens_map = Map::new();
    for (id, tk) in &st.tokens {
        let bal = tk.balances.get(&address).copied().unwrap_or(0);
        if bal > 0 {
            tokens_map
                .insert(id.clone(), json!({ "symbol": tk.symbol, "decimals": tk.decimals, "balance": bal.to_string() }));
        }
    }

    // api.js:937: o objeto cru do oráculo (literal de registro, state.js:2040-2051).
    // `reputation` só existe em oráculos pós-Fase 1 — `None` = chave AUSENTE.
    let oracle = match st.oracles.get(&address) {
        None => Value::Null,
        Some(o) => {
            let mut m = Map::new();
            m.insert("address".into(), json!(o.address));
            m.insert("stake".into(), json!(o.stake.to_string()));
            m.insert("tasksCompleted".into(), json!(o.tasks_completed));
            m.insert("bridgeTransfers".into(), json!(o.bridge_transfers));
            m.insert("registeredAt".into(), json!(o.registered_at));
            m.insert("endpoint".into(), json!(o.endpoint));
            m.insert("completed".into(), json!(o.completed));
            m.insert("failed".into(), json!(o.failed));
            m.insert("slashed".into(), json!(o.slashed.to_string()));
            if let Some(rep) = o.reputation {
                m.insert("reputation".into(), json!(rep));
            }
            Value::Object(m)
        }
    };

    // api.js:874-879 — o contrato EAVM cuja conta nativa é esta (a página de
    // endereço vira página de contrato). O JS indexa `state.contracts[eavmAddress]`
    // DIRETO, sem baixar caixa: as duas origens de `eavmAddress` já são minúsculas
    // (eco do 0x consultado, que é `toLowerCase()`ado, ou `data.eavmFrom`/`eavmTo`
    // de uma tx EAVM), e as chaves de `contracts` também — a busca crua é fiel.
    //
    // `verified` sai SEMPRE `false` porque o JS testa `!!c.source`, e `source` é um
    // campo que a referência NUNCA grava na folha de contrato: `verifyContract`
    // (node.js:135) guarda o registro em `node.verifiedContracts`, FORA do estado.
    // Reproduzimos o campo como a referência o emite; quem quer o selo real usa
    // `GET /contract/{addr}` (que lê o registro certo). Divergir aqui — lendo
    // `verified_contracts` — quebraria a comparação campo a campo com o nó JS.
    let contract = match eavm_address.as_deref().and_then(|c0x| st.contracts.get(c0x).map(|c| (c0x, c)))
    {
        None => Value::Null,
        Some((c0x, c)) => json!({
            "address": c0x,
            // `Math.max(0, (c.code?.length ?? 2) / 2 - 1)`: bytes do código, com o
            // `0x` descontado. Código vazio ("" ou "0x") dá 0 nos dois clientes.
            "codeSize": c.code.len().saturating_sub(2) / 2,
            "verified": false,
            "nonce": c.nonce,
        }),
    };

    let mut body = json!({
        "address": address,
        "eavmAddress": eavm_address,
        "balance": acc.balance.to_string(),
        "balanceFormatted": format!("{} {}", format_eav7(acc.balance), c::SYMBOL),
        "staked": acc.staked.to_string(),
        "stakedFormatted": format!("{} {}", format_eav7(acc.staked), c::SYMBOL),
        "unbonding": unbonding,
        "nonce": acc.nonce,
        "nextNonce": node.next_nonce_for(&address), // ciente do mempool (api.js:789)
        "energy": { "max": e_max, "available": e_avail },
        "bandwidth": { "max": b_max, "available": b_avail },
        // Recursos delegados (#6): capacidade emprestada a/de terceiros, sem mover voto.
        "resources": {
            "resourceStake": rstake.to_string(),
            "delegatedOut": acc.delegated_out.to_string(),
            "delegatedIn": acc.delegated_in.to_string(),
            "delegations": delegations,
        },
        "votesCast": votes_cast,
        "votedTotal": voted_total.to_string(),
        "permissions": permissions,
        "pendingPermission": pending_permission,
        "vesting": vesting,
        // api.js:874-879: só é não-nulo quando ESTA conta é a conta nativa de um
        // contrato EAVM — isto é, quando o 0x vinculado está em `state.contracts`.
        "contract": contract,
        "activity": activity,
        "claimableVoterReward": claimable_voter_reward.to_string(),
        "approvals": approvals,
        "feeExempt": st.is_fee_exempt(&address), // isFeeExempt (state.js:188)
        "isValidator": is_validator,
        "votes": st.candidate_votes.get(&address).copied().unwrap_or(0).to_string(), // recebidos como candidato
        "tokens": tokens_map,
        "nfts": owned_nfts,
        "names": owned_names,
        "oracle": oracle,
    });
    // api.js:933: `commission: state.commission[address]` — undefined é OMITIDO
    // pelo JSON.stringify, então a chave só existe quando há comissão definida.
    if let Some(cm) = st.commission.get(&address) {
        body.as_object_mut().expect("objeto").insert("commission".into(), json!(cm));
    }
    reply(200, body)
}

// -------------------------------------------- GET /address/{addr}/txs (histórico)

/// Handler PURO do histórico paginado — `api.js:944-985`. Usa o índice
/// endereço→alturas (todas as txs da carteira, da mais nova para a mais antiga),
/// paginado por `?before=` com teto `HARD_CAP` por requisição.
pub fn address_txs(node: &Node, raw: &str, query: &HashMap<String, String>) -> ApiReply {
    // api.js:945-947: 0x vira o E7 mapeado; E7 inválido é 400.
    let addr = if is_eavm_address(raw) {
        eavm_to_e7(raw)
    } else if is_valid_address(raw) {
        raw.to_string()
    } else {
        return bad_request("endereço inválido");
    };

    const HARD_CAP: usize = 2000;
    let limit = int_param(query.get("limit"), HARD_CAP).clamp(1, HARD_CAP);
    // Default do JS é MAX_SAFE_INTEGER — nenhuma altura real o alcança, então
    // usize::MAX cumpre o mesmo papel de "sem limite".
    let before = int_param(query.get("before"), usize::MAX) as u64;

    let bc = &node.blockchain;
    let st = &bc.state;
    let sem_indice: Vec<u64> = Vec::new();
    let heights: &[u64] = bc.address_tx_index.get(&addr).map_or(&sem_indice, |v| v.as_slice());

    let mut txs: Vec<Value> = Vec::new();
    let mut next_before: Option<u64> = None;
    for (idx, &h) in heights.iter().enumerate().rev() {
        // JS: condição do laço `txs.length < limit` — checada por ALTURA; um
        // bloco pode estourar o limite (fidelidade > elegância).
        if txs.len() >= limit {
            break;
        }
        if h >= before {
            continue;
        }
        let b = match bc.block_at(h) {
            Ok(Some(b)) => b,
            Ok(None) => continue,
            Err(e) => return reply(500, json!({ "error": e })),
        };
        let mut in_block: Vec<Value> = Vec::new();
        for t in &b.transactions {
            if t.from != addr && t.to.as_deref() != Some(addr.as_str()) {
                continue;
            }
            let mut tv = tx_json(t);
            if let Some(o) = tv.as_object_mut() {
                o.insert("blockHeight".into(), json!(h));
                o.insert("blockTime".into(), json!(b.timestamp));
                // `receipt` só existe para tx EAVM; a ausência significa que a
                // transação se aplicou com sucesso (api.js:964-965).
                o.insert("receipt".into(), super::recibo_json(node, t.id.as_deref()));
                o.insert("asset".into(), asset_de(st, t));
            }
            in_block.push(tv);
        }
        // api.js:980: dentro do bloco as txs entram em ordem INVERSA.
        for tv in in_block.into_iter().rev() {
            txs.push(tv);
        }
        // api.js:981: cursor da próxima página — só quando encheu e ainda há
        // alturas mais antigas.
        if txs.len() >= limit && idx > 0 {
            next_before = Some(h);
        }
    }
    reply(200, json!({ "address": addr, "txs": txs, "nextBefore": next_before }))
}

// --------------------------------------- GET /address/{addr}/analysis (agregados)

/// Handler PURO da análise de atividade — `api.js:990-1037`. Contagem por tipo,
/// volumes de entrada/saída, contrapartes e série diária; varredura limitada pelo
/// índice por endereço (mesmo teto anti-DoS do /txs).
pub fn address_analysis(node: &Node, raw: &str) -> ApiReply {
    let addr = if is_eavm_address(raw) {
        eavm_to_e7(raw)
    } else if is_valid_address(raw) {
        raw.to_string()
    } else {
        return bad_request("endereço inválido");
    };

    const SCAN_CAP: usize = 2000;
    let bc = &node.blockchain;
    let sem_indice: Vec<u64> = Vec::new();
    let heights: &[u64] = bc.address_tx_index.get(&addr).map_or(&sem_indice, |v| v.as_slice());

    let mut by_type: std::collections::BTreeMap<String, u64> = Default::default();
    // Contrapartes num Vec (ordem de primeira aparição, como a inserção num Map
    // do JS) — o sort estável abaixo preserva essa ordem entre empates.
    let mut counterparties: Vec<(String, u64)> = Vec::new();
    let conta = |lista: &mut Vec<(String, u64)>, quem: &str| {
        if let Some(e) = lista.iter_mut().find(|(a, _)| a == quem) {
            e.1 += 1;
        } else {
            lista.push((quem.to_string(), 1));
        }
    };
    // JS ordena `[...daily.entries()].sort()` — datas ISO ordenam lexicográfica
    // = cronologicamente, exatamente a ordem do BTreeMap.
    let mut daily: std::collections::BTreeMap<String, u64> = Default::default();
    let (mut sent, mut received, mut fees_paid) = (0u128, 0u128, 0u128);
    let (mut first_seen, mut last_seen): (Option<i64>, Option<i64>) = (None, None);
    let mut scanned = 0usize; // txs da conta contadas (o `scanned` do JS)

    for &h in heights.iter().rev() {
        // JS: `i >= 0 && scanned < SCAN_CAP` — o teto é checado por BLOCO; as txs
        // do bloco corrente entram inteiras mesmo cruzando o teto.
        if scanned >= SCAN_CAP {
            break;
        }
        let b = match bc.block_at(h) {
            Ok(Some(b)) => b,
            Ok(None) => continue,
            Err(e) => return reply(500, json!({ "error": e })),
        };
        for t in &b.transactions {
            let out = t.from == addr;
            let inc = t.to.as_deref() == Some(addr.as_str());
            if !out && !inc {
                continue;
            }
            scanned += 1;
            *by_type.entry(t.tx_type.clone()).or_insert(0) += 1;
            let amt = amount_u128(&t.amount);
            if out {
                sent += amt;
                fees_paid += amount_u128(&t.fee);
                if let Some(to) = &t.to {
                    conta(&mut counterparties, to);
                }
            }
            if inc {
                received += amt;
                conta(&mut counterparties, &t.from);
            }
            *daily.entry(iso_date(b.timestamp)).or_insert(0) += 1;
            // Varremos do mais novo para o mais antigo: lastSeen fixa na
            // primeira tx vista, firstSeen é reescrito até a mais antiga.
            if last_seen.is_none() {
                last_seen = Some(b.timestamp);
            }
            first_seen = Some(b.timestamp);
        }
    }

    // Top 10 contrapartes por contagem (sort estável ⇒ empate mantém a ordem de
    // primeira aparição, como o Map do JS).
    let mut top = counterparties;
    top.sort_by_key(|c| std::cmp::Reverse(c.1));
    let top_counterparties: Vec<Value> =
        top.into_iter().take(10).map(|(address, count)| json!({ "address": address, "count": count })).collect();

    reply(200, json!({
        "address": addr,
        "txCount": scanned,
        "truncated": scanned >= SCAN_CAP,
        "firstSeen": first_seen,
        "lastSeen": last_seen,
        "sent": sent.to_string(),
        "received": received.to_string(),
        "feesPaid": fees_paid.to_string(),
        "byType": by_type,
        "topCounterparties": top_counterparties,
        "daily": daily.iter().map(|(date, count)| json!({ "date": date, "count": count })).collect::<Vec<_>>(),
    }))
}

// ----------------------------------------------- GET /eavm/address/{addr} (0x→E7)

/// Handler PURO do mapeamento de conta EAVM → E7 — `api.js:488-492`. Não toca o
/// nó: a derivação é pura, mas a rota vive aqui por ser da família de endereços.
pub fn eavm_address(raw: &str) -> ApiReply {
    if !is_eavm_address(raw) {
        return bad_request("endereço EAVM inválido (use 0x + 40 hex)");
    }
    reply(200, json!({ "eavm": raw.to_lowercase(), "eav7": eavm_to_e7(raw) }))
}

// ------------------------------------------------------------------ casca axum

async fn dossier_route(State(state): State<AppState>, Path(addr): Path<String>) -> Response {
    let node = match state.read() {
        Ok(n) => n,
        Err(_) => return into_response(reply(500, json!({ "error": "estado envenenado" }))),
    };
    into_response(address_dossier(&node, &addr))
}

async fn txs_route(
    State(state): State<AppState>,
    Path(addr): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let node = match state.read() {
        Ok(n) => n,
        Err(_) => return into_response(reply(500, json!({ "error": "estado envenenado" }))),
    };
    into_response(address_txs(&node, &addr, &query))
}

async fn analysis_route(State(state): State<AppState>, Path(addr): Path<String>) -> Response {
    let node = match state.read() {
        Ok(n) => n,
        Err(_) => return into_response(reply(500, json!({ "error": "estado envenenado" }))),
    };
    into_response(address_analysis(&node, &addr))
}

async fn eavm_route(Path(addr): Path<String>) -> Response {
    into_response(eavm_address(&addr))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/address/{addr}", get(dossier_route))
        .route("/address/{addr}/txs", get(txs_route))
        .route("/address/{addr}/analysis", get(analysis_route))
        .route("/eavm/address/{addr}", get(eavm_route))
}

// ------------------------------------------------------------------------ testes

#[cfg(test)]
mod tests {
    use super::*;
    use crate::guard::{AbuseGuard, GuardConfig};
    use eav7::mempool::Mempool;
    use eav7::state::gov::{Active, Nivel, Permission};
    use eav7::state::Account;
    use eav7::{Block, Blockchain};

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

    /// Endereço E7 VÁLIDO (com checksum) determinístico a partir de uma semente.
    fn addr(seed: &str) -> String {
        derive_address_from(seed)
    }

    fn tx(from: &str, to: &str, amount: &str, fee: &str, id: &str) -> Tx {
        let mut t = Tx::new("TRANSFER", from, 1, 1_000);
        t.to = Some(to.to_string());
        t.amount = amount.to_string();
        t.fee = fee.to_string();
        t.id = Some(id.to_string());
        t
    }

    /// Bloco sintético: os handlers de leitura não verificam assinatura/hash,
    /// então basta a forma — igual ao que os testes da lib fazem.
    fn bloco(height: u64, timestamp: i64, transactions: Vec<Tx>) -> Block {
        Block {
            protocol: "eav20".into(),
            version: 1,
            scheme: "eav7-hybrid-1".into(),
            height,
            timestamp,
            previous_hash: "-".into(),
            tx_root: "-".into(),
            tx_count: transactions.len(),
            producer: addr("produtor"),
            public_key: None,
            pq_public_key: None,
            state_root: None,
            producer_account: None,
            genesis: None,
            signature: String::new(),
            pq_signature: String::new(),
            hash: format!("H{height}"),
            transactions,
        }
    }

    /// Instala blocos na cauda e mantém o índice endereço→alturas como a cadeia
    /// real faria (uma entrada por bloco em que o endereço aparece).
    fn instala(n: &mut Node, blocos: Vec<Block>) {
        for b in &blocos {
            for t in &b.transactions {
                let mut quem: Vec<&String> = vec![&t.from];
                if let Some(to) = &t.to {
                    quem.push(to);
                }
                for a in quem {
                    let e = n.blockchain.address_tx_index.entry(a.clone()).or_default();
                    if e.last() != Some(&b.height) {
                        e.push(b.height);
                    }
                }
            }
        }
        n.blockchain.tail = blocos;
        n.blockchain.tail_start = 0;
    }

    // ---------------------------------------------------------------- dossiê

    #[test]
    fn dossie_endereco_invalido_da_400() {
        let n = node();
        let (code, body) = address_dossier(&n, "nem-e7-nem-0x");
        assert_eq!(code.as_u16(), 400);
        assert_eq!(body["error"], "endereço EAV7 (E7…) ou EAVM (0x…) inválido");
    }

    #[test]
    fn dossie_desconhecido_devolve_zerado_com_200() {
        // O JS devolve o dossiê zerado (nunca 404) para conta que não existe.
        let n = node();
        let a = addr("ninguem");
        let (code, body) = address_dossier(&n, &a);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["address"], a.as_str());
        assert_eq!(body["balance"], "0");
        assert_eq!(body["balanceFormatted"], "0 EAV7");
        assert_eq!(body["staked"], "0");
        assert_eq!(body["nonce"], 0);
        assert_eq!(body["nextNonce"], 1);
        // Sem stake: só a cota grátis de energia/banda.
        assert_eq!(body["energy"]["max"], c::energy::FREE);
        assert_eq!(body["energy"]["available"], c::energy::FREE);
        assert_eq!(body["bandwidth"]["max"], c::bandwidth::FREE);
        // Permissão EFETIVA padrão sintetizada (api.js:826).
        assert_eq!(body["permissions"]["default"], true);
        assert_eq!(body["permissions"]["threshold"], 1);
        assert_eq!(body["permissions"]["keys"][0]["address"], a.as_str());
        assert_eq!(body["activity"]["txCount"], 0);
        assert!(body["eavmAddress"].is_null());
        assert!(body["contract"].is_null());
        assert!(body["oracle"].is_null());
        // Sem comissão definida a chave NEM EXISTE (undefined some no JS).
        assert!(body.get("commission").is_none());
        assert_eq!(body["feeExempt"], false);
        assert_eq!(body["votes"], "0");
    }

    /// O campo `contract` LÊ `state.contracts` (api.js:874-879). Ficava `null`
    /// fixo sob um comentário que dizia que o estado Rust não tinha a seção —
    /// tinha (`eav7::state::State::contracts`).
    #[test]
    fn dossie_de_conta_de_contrato_traz_o_bloco_contract() {
        use eav7::state::contracts::Contract;
        let mut n = node();
        let c0x = "0x00000000000000000000000000000000000000ab";
        let c = Contract {
            code: "0x6080604052".into(), // 5 bytes de código
            nonce: 3,
            ..Default::default()
        };
        n.blockchain.state.contracts.insert(c0x.to_string(), c);

        // Consulta pelo 0x: o dossiê ecoa `eavmAddress` e acha o contrato.
        let body = address_dossier(&n, c0x).1;
        assert_eq!(body["contract"]["address"], c0x);
        assert_eq!(body["contract"]["codeSize"], 5); // (len 12 - 2) / 2
        assert_eq!(body["contract"]["nonce"], 3);
        // `!!c.source` do JS: a referência NUNCA grava `source` na folha de
        // contrato (verifyContract guarda em node.verifiedContracts, fora do
        // estado), então o campo é sempre falso nos dois clientes.
        assert_eq!(body["contract"]["verified"], false);

        // Uma conta comum, sem 0x vinculado, segue com `null`.
        assert!(address_dossier(&n, &addr("comum")).1["contract"].is_null());
    }

    #[test]
    fn dossie_com_saldo_e_stake() {
        let mut n = node();
        let a = addr("rica");
        n.blockchain.state.accounts.insert(
            a.clone(),
            Account {
                balance: 12_500_000,             // 12.5 EAV7
                staked: c::FEE_EXEMPT_STAKE,     // 100 EAV7 → isenta de taxa
                nonce: 7,
                ..Default::default()
            },
        );
        let (code, body) = address_dossier(&n, &a);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["balance"], "12500000");
        assert_eq!(body["balanceFormatted"], "12.5 EAV7");
        assert_eq!(body["staked"], c::FEE_EXEMPT_STAKE.to_string());
        assert_eq!(body["stakedFormatted"], "100 EAV7");
        assert_eq!(body["feeExempt"], true);
        assert_eq!(body["nonce"], 7);
        assert_eq!(body["nextNonce"], 8);
        // 100 EAV7 de resource stake → 10 (grátis) + 100×1 de energia.
        assert_eq!(body["energy"]["max"], c::energy::FREE + 100);
        assert_eq!(body["resources"]["resourceStake"], c::FEE_EXEMPT_STAKE.to_string());
    }

    #[test]
    fn dossie_permissao_v2_serve_o_formato_do_js() {
        let mut n = node();
        let a = addr("multisig");
        let k1 = addr("chave-1");
        let k2 = addr("chave-2");
        let mut owner = Nivel { threshold: 2, keys: Default::default() };
        owner.keys.insert(k1.clone(), 2);
        owner.keys.insert(k2.clone(), 1);
        let active = Active {
            nivel: Nivel { threshold: 1, keys: [(k2.clone(), 1)].into_iter().collect() },
            name: Some("ops".into()),
            operations: Some(vec!["TRANSFER".into()]),
        };
        n.blockchain.state.permissions.insert(
            a.clone(),
            Permission::V2 { owner, actives: vec![active], witness: None, recovery: None, delay_blocks: 43_200 },
        );
        let (_, body) = address_dossier(&n, &a);
        let p = &body["permissions"];
        assert_eq!(p["default"], false);
        assert_eq!(p["version"], 2);
        assert_eq!(p["owner"]["threshold"], 2);
        // Ordenada por peso decrescente (api.js:830).
        assert_eq!(p["owner"]["keys"][0]["address"], k1.as_str());
        assert_eq!(p["owner"]["keys"][0]["weight"], 2);
        assert_eq!(p["actives"][0]["id"], 0);
        assert_eq!(p["actives"][0]["name"], "ops");
        assert_eq!(p["actives"][0]["operations"][0], "TRANSFER");
        assert!(p["witness"].is_null());
        assert_eq!(p["delayBlocks"], 43_200);
        // Compat v1: a active PRIMÁRIA aparece no topo (api.js:849-850).
        assert_eq!(p["threshold"], 1);
        assert_eq!(p["keys"][0]["address"], k2.as_str());
    }

    // ------------------------------------------------------------------- /txs

    #[test]
    fn txs_pagina_do_mais_novo_para_o_mais_antigo() {
        let mut n = node();
        let a = addr("carteira");
        let b_ = addr("contraparte");
        instala(&mut n, vec![
            bloco(0, 1_000, vec![tx(&a, &b_, "10", "1", "T0")]),
            bloco(1, 2_000, vec![tx(&b_, &a, "7", "1", "T1")]),
            bloco(2, 3_000, vec![tx(&a, &b_, "5", "1", "T2")]),
        ]);

        // Página 1: limit=2 → as duas mais novas, cursor apontando para a altura 1.
        let q1: HashMap<String, String> = [("limit".to_string(), "2".to_string())].into();
        let (code, body) = address_txs(&n, &a, &q1);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["address"], a.as_str());
        assert_eq!(body["txs"].as_array().unwrap().len(), 2);
        assert_eq!(body["txs"][0]["id"], "T2");
        assert_eq!(body["txs"][0]["blockHeight"], 2);
        assert_eq!(body["txs"][0]["blockTime"], 3_000);
        assert!(body["txs"][0]["receipt"].is_null(), "tx não-EAVM não tem recibo de execução");
        assert!(body["txs"][0]["asset"].is_null());
        assert_eq!(body["txs"][1]["id"], "T1");
        assert_eq!(body["nextBefore"], 1);

        // Página 2: before=1 → só a tx do bloco 0; sem próxima página.
        let q2: HashMap<String, String> =
            [("limit".to_string(), "2".to_string()), ("before".to_string(), "1".to_string())].into();
        let (_, body2) = address_txs(&n, &a, &q2);
        assert_eq!(body2["txs"].as_array().unwrap().len(), 1);
        assert_eq!(body2["txs"][0]["id"], "T0");
        assert!(body2["nextBefore"].is_null());
    }

    #[test]
    fn txs_endereco_invalido_da_400() {
        let n = node();
        let (code, body) = address_txs(&n, "invalido", &HashMap::new());
        assert_eq!(code.as_u16(), 400);
        assert_eq!(body["error"], "endereço inválido");
    }

    // -------------------------------------------------------------- /analysis

    #[test]
    fn analysis_agrega_volumes_e_contrapartes() {
        let mut n = node();
        let a = addr("carteira");
        let b_ = addr("contraparte");
        instala(&mut n, vec![
            bloco(0, 1_000, vec![tx(&a, &b_, "10", "2", "T0")]),
            bloco(1, 2_000, vec![tx(&b_, &a, "7", "1", "T1")]),
            bloco(2, 3_000, vec![tx(&a, &b_, "5", "2", "T2")]),
        ]);
        let (code, body) = address_analysis(&n, &a);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["txCount"], 3);
        assert_eq!(body["truncated"], false);
        assert_eq!(body["sent"], "15");
        assert_eq!(body["received"], "7");
        assert_eq!(body["feesPaid"], "4"); // só das txs de SAÍDA (api.js:1015)
        assert_eq!(body["byType"]["TRANSFER"], 3);
        // Varredura do mais novo p/ o mais antigo: first=bloco 0, last=bloco 2.
        assert_eq!(body["firstSeen"], 1_000);
        assert_eq!(body["lastSeen"], 3_000);
        assert_eq!(body["topCounterparties"][0]["address"], b_.as_str());
        assert_eq!(body["topCounterparties"][0]["count"], 3);
        assert_eq!(body["daily"][0]["date"], "1970-01-01");
        assert_eq!(body["daily"][0]["count"], 3);
    }

    // ---------------------------------------------------------- /eavm/address

    #[test]
    fn eavm_mapeia_0x_para_e7() {
        let hex = "0xAbCd000000000000000000000000000000001234";
        let (code, body) = eavm_address(hex);
        assert_eq!(code.as_u16(), 200);
        assert_eq!(body["eavm"], hex.to_lowercase());
        // A derivação é a MESMA do envelope.js:49 (prefixo + 0x minúsculo).
        assert_eq!(body["eav7"], derive_address_from(format!("EAV7-EAVM:{}", hex.to_lowercase())));
        // E o dossiê consultado pelo 0x ecoa o vínculo.
        let n = node();
        let (_, dossie) = address_dossier(&n, hex);
        assert_eq!(dossie["eavmAddress"], hex.to_lowercase());
        assert_eq!(dossie["address"], body["eav7"]);
    }

    #[test]
    fn eavm_invalido_da_400() {
        let (code, body) = eavm_address("0x123"); // curto demais
        assert_eq!(code.as_u16(), 400);
        assert_eq!(body["error"], "endereço EAVM inválido (use 0x + 40 hex)");
    }

    // ------------------------------------------------------------ utilitários

    #[test]
    fn format_eav7_espelha_o_js() {
        assert_eq!(format_eav7(16_000_000), "16"); // config.js:572
        assert_eq!(format_eav7(12_500_000), "12.5");
        assert_eq!(format_eav7(1), "0.000001");
        assert_eq!(format_eav7(0), "0");
    }

    #[test]
    fn iso_date_bate_com_toisostring() {
        assert_eq!(iso_date(0), "1970-01-01");
        assert_eq!(iso_date(86_400_000), "1970-01-02");
        assert_eq!(iso_date(1_753_228_800_000), "2025-07-23"); // data real p/ conferência
    }

    /// Transação EAVM leva o RECIBO junto na listagem — é o que distingue uma
    /// chamada revertida de uma transferência comum no explorer.
    #[test]
    fn txs_de_endereco_levam_o_recibo_da_execucao_eavm() {
        use eav7::blockchain::Recibo;
        let mut n = node();
        let a = addr("recibo-origem");
        let b_ = addr("recibo-destino");
        instala(&mut n, vec![bloco(0, 1_000, vec![tx(&a, &b_, "5", "1", "T1")])]);
        n.blockchain.receipts.insert(
            "T1".into(),
            Recibo { success: false, gas_used: 31_337, contract: None, block_height: 0 },
        );

        let (_, body) = address_txs(&n, &a, &HashMap::new());
        let r = &body["txs"][0]["receipt"];
        assert_eq!(r["success"], json!(false), "reverteu — o explorer tem de poder dizer isso");
        assert_eq!(r["gasUsed"], json!("31337"), "texto decimal, não número JSON");
        assert_eq!(r["blockHeight"], json!(0));
        assert!(r["contract"].is_null(), "só o deploy carrega endereço de contrato");
    }
}
