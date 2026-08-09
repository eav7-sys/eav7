//! Fase S contra um NÓ FALSO: HTTP de verdade (ureq → TcpListener), respostas
//! enlatadas. É o nível certo para estes testes — o que a fase entrega é a
//! LEITURA fiel do que a API devolve e a disciplina de nonce entre chamadas,
//! e nada disso é observável sem atravessar o cliente HTTP inteiro.
//!
//! O nó de verdade não entra aqui de propósito: o contrato das rotas já é
//! testado no crate do nó campo a campo; aqui as respostas enlatadas COPIAM
//! aquela forma (chain.rs, address.rs, network.rs do nó Rust — mesmos campos do
//! api.js), e qualquer divergência futura é falha de integração, não destes
//! testes.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use eav7_sdk::{Eav7Client, ErroCliente, ProductionWallet};
use serde_json::json;

// ============================================================================
// Nó falso
// ============================================================================

/// O que o nó falso viu de uma requisição.
struct Requisicao {
    metodo: String,
    /// Caminho COM query string, como veio na linha de requisição.
    caminho: String,
    corpo: serde_json::Value,
}

/// Sobe um servidor HTTP mínimo numa porta efêmera e devolve a URL base.
///
/// Uma conexão por requisição (`connection: close`): o ureq reabre a cada
/// chamada e o laço de accept atende em sequência — que é exatamente o padrão
/// de uso do SDK, síncrono e um pedido por vez.
fn no_falso(
    responde: impl Fn(&Requisicao) -> (u16, serde_json::Value) + Send + Sync + 'static,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("porta efêmera");
    let url = format!("http://{}", listener.local_addr().expect("addr"));
    std::thread::spawn(move || {
        for conexao in listener.incoming() {
            let Ok(stream) = conexao else { break };
            let _ = atende(stream, &responde);
        }
    });
    url
}

fn atende(
    mut stream: TcpStream,
    responde: &impl Fn(&Requisicao) -> (u16, serde_json::Value),
) -> std::io::Result<()> {
    let mut leitor = BufReader::new(stream.try_clone()?);
    let mut linha = String::new();
    leitor.read_line(&mut linha)?;
    let mut partes = linha.split_whitespace();
    let metodo = partes.next().unwrap_or_default().to_string();
    let caminho = partes.next().unwrap_or_default().to_string();

    let mut content_length = 0usize;
    loop {
        let mut h = String::new();
        leitor.read_line(&mut h)?;
        if h.trim().is_empty() {
            break;
        }
        let minuscula = h.to_ascii_lowercase();
        if let Some(v) = minuscula.strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }
    let mut bruto = vec![0u8; content_length];
    if content_length > 0 {
        leitor.read_exact(&mut bruto)?;
    }
    let corpo = serde_json::from_slice(&bruto).unwrap_or(serde_json::Value::Null);

    let (status, body) = responde(&Requisicao { metodo, caminho, corpo });
    let texto = body.to_string();
    write!(
        stream,
        "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{texto}",
        texto.len()
    )
}

/// Carteira REAL (a fixture do nó): as transações enviadas nos testes são
/// assinadas e verificadas de verdade — só o nó é falso.
fn carteira() -> ProductionWallet {
    let arquivo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/carteira-node.json");
    ProductionWallet::from_file(arquivo).expect("fixture de carteira")
}

// ============================================================================
// S1 — aguardar_confirmacao
// ============================================================================

/// O caminho feliz completo: 404 (ainda não propagou) → PENDING → CONFIRMED.
/// Os dois primeiros estados NÃO podem abortar a espera — são transitórios por
/// construção, e é para atravessá-los que o método existe.
#[test]
fn s1_aguardar_confirmacao_atravessa_404_e_pending_ate_o_bloco() {
    let chamadas = Arc::new(AtomicUsize::new(0));
    let vistas = Arc::clone(&chamadas);
    let url = no_falso(move |req| {
        assert_eq!(req.caminho, "/tx/abc123");
        match vistas.fetch_add(1, Ordering::SeqCst) {
            0 => (404, json!({ "error": "transação não encontrada" })),
            1 => (200, json!({ "status": "PENDING", "tx": {} })),
            // A forma do nó (chain.rs:559 / api.js:650): blockHeight IRMÃO de status.
            _ => (200, json!({
                "status": "CONFIRMED",
                "tx": {},
                "blockHeight": 42,
                "blockHash": "hash-do-bloco-42",
            })),
        }
    });

    let cliente = Eav7Client::novo(&url);
    let c = cliente
        .aguardar_confirmacao("abc123", Duration::from_secs(5))
        .expect("tinha de confirmar");
    assert_eq!(c.block_height, 42);
    assert_eq!(c.block_hash, "hash-do-bloco-42");
    assert!(chamadas.load(Ordering::SeqCst) >= 3, "atravessou os três estados");
}

/// Prazo vencido é [`ErroCliente::TempoEsgotado`] — um erro PRÓPRIO, porque não
/// é veredito: a transação pode confirmar depois, e o chamador precisa
/// distinguir "esperei demais" de "o nó recusou".
#[test]
fn s1_prazo_vencido_e_tempo_esgotado() {
    let url = no_falso(|_| (200, json!({ "status": "PENDING", "tx": {} })));
    let cliente = Eav7Client::novo(&url);

    let inicio = Instant::now();
    let erro = cliente
        .aguardar_confirmacao("nunca", Duration::from_millis(400))
        .expect_err("nunca confirma");
    assert!(matches!(erro, ErroCliente::TempoEsgotado(_)), "{erro}");
    assert!(inicio.elapsed() >= Duration::from_millis(400), "esperou o prazo inteiro");
}

// ============================================================================
// S2 — Remetente com reserva de nonce
// ============================================================================

/// O critério 1 da Fase S: duas transferências seguidas da mesma carteira saem
/// com DOIS nonces consecutivos — e a segunda nem pergunta ao nó.
///
/// Sem a reserva, as duas leriam o mesmo `nextNonce` (a primeira ainda não
/// entrou no mempool quando a segunda pergunta) e a segunda seria recusada por
/// nonce repetido.
#[test]
fn s2_duas_transferencias_seguidas_usam_nonces_consecutivos() {
    let nonces = Arc::new(Mutex::new(Vec::<i64>::new()));
    let consultas_de_conta = Arc::new(AtomicUsize::new(0));
    let (nonces_srv, consultas_srv) = (Arc::clone(&nonces), Arc::clone(&consultas_de_conta));

    let url = no_falso(move |req| {
        if req.metodo == "GET" && req.caminho.starts_with("/address/") {
            consultas_srv.fetch_add(1, Ordering::SeqCst);
            return (200, json!({ "balance": "1000000000", "staked": "0", "nextNonce": 7 }));
        }
        if req.metodo == "POST" && req.caminho == "/tx" {
            nonces_srv.lock().expect("lock").push(req.corpo["nonce"].as_i64().expect("nonce"));
            return (200, json!({ "accepted": true, "id": req.corpo["id"] }));
        }
        (404, json!({ "error": "rota inesperada" }))
    });

    let cliente = Eav7Client::com_carteira(&url, Box::new(carteira()));
    let destino = eav7_sdk::derive_address_from("fase-s:destino");
    let mut remetente = cliente.remetente().expect("tem carteira");

    remetente.transferir(&destino, 1).expect("primeira");
    remetente.transferir(&destino, 2).expect("segunda");

    assert_eq!(*nonces.lock().expect("lock"), vec![7, 8], "consecutivos, sem colisão");
    assert_eq!(
        consultas_de_conta.load(Ordering::SeqCst),
        1,
        "o nonce da segunda veio da RESERVA, não de nova consulta"
    );
}

/// Recusa RESSINCRONIZA: o próximo envio pergunta o nonce ao nó de novo, em vez
/// de insistir num contador local que já provou estar errado. É a semântica que
/// o relayer da ponte sempre teve — extraída, não reinventada.
#[test]
fn s2_recusa_ressincroniza_o_nonce_com_o_no() {
    let nonces = Arc::new(Mutex::new(Vec::<i64>::new()));
    let envios = Arc::new(AtomicUsize::new(0));
    let (nonces_srv, envios_srv) = (Arc::clone(&nonces), Arc::clone(&envios));

    let url = no_falso(move |req| {
        if req.metodo == "GET" && req.caminho.starts_with("/address/") {
            // Depois da recusa o nó "anda": a ressincronização tem de VER isto.
            let n = if envios_srv.load(Ordering::SeqCst) >= 2 { 42 } else { 7 };
            return (200, json!({ "balance": "1000000000", "staked": "0", "nextNonce": n }));
        }
        if req.metodo == "POST" && req.caminho == "/tx" {
            nonces_srv.lock().expect("lock").push(req.corpo["nonce"].as_i64().expect("nonce"));
            let vez = envios_srv.fetch_add(1, Ordering::SeqCst);
            if vez == 1 {
                return (200, json!({ "accepted": false, "reason": "nonce repetido" }));
            }
            return (200, json!({ "accepted": true, "id": req.corpo["id"] }));
        }
        (404, json!({ "error": "rota inesperada" }))
    });

    let cliente = Eav7Client::com_carteira(&url, Box::new(carteira()));
    let destino = eav7_sdk::derive_address_from("fase-s:destino");
    let mut remetente = cliente.remetente().expect("tem carteira");

    remetente.transferir(&destino, 1).expect("aceita");
    let erro = remetente.transferir(&destino, 2).expect_err("recusada");
    assert!(matches!(erro, ErroCliente::Api { .. }), "{erro}");
    remetente.transferir(&destino, 3).expect("depois de ressincronizar");

    // 7 aceita → reserva 8; 8 recusada → esquece; terceira pergunta e usa 42.
    assert_eq!(*nonces.lock().expect("lock"), vec![7, 8, 42]);
}

// ============================================================================
// S3 — tipos: Validador (+ performance) e histórico paginado
// ============================================================================

/// O critério 2 da Fase S: `validadores_tipados()` casa `current` com
/// `performance` pelo endereço e expõe `name` — sem `serde_json::Value`.
#[test]
fn s3_validadores_tipados_casam_nome_e_desempenho() {
    let url = no_falso(|req| {
        assert_eq!(req.caminho, "/validators");
        // A forma de network.rs:630-655 / api.js:1082-1106, reduzida ao usado.
        (200, json!({
            "maxValidators": 21,
            "minStake": "1000",
            "current": [
                { "address": "E7AAA", "staked": "2000", "votes": "5", "name": "alfa" },
                { "address": "E7BBB", "staked": "1000", "votes": "0", "name": null },
            ],
            "performance": [{
                "address": "E7AAA", "staked": "2000", "score": 87.5, "status": "healthy",
                "degraded": false, "productivityPct": 95.0, "expected": 20, "produced": 19,
                "inTurn": 19, "missed": 1, "outOfTurn": 0, "avgLatencyMs": 350.0,
                "lastProducedHeight": 123, "lastProducedAt": 1_700_000_000_000i64,
            }],
        }))
    });

    let validadores = Eav7Client::novo(&url).validadores_tipados().expect("tipa");
    assert_eq!(validadores.len(), 2);

    let a = &validadores[0];
    assert_eq!(a.address, "E7AAA");
    assert_eq!(a.staked, 2000);
    assert_eq!(a.votes, 5);
    assert_eq!(a.name.as_deref(), Some("alfa"));
    let p = a.performance.as_ref().expect("tem desempenho");
    assert_eq!(p.score, 87.5);
    assert_eq!(p.status, "healthy");
    assert_eq!(p.missed, 1);
    assert_eq!(p.avg_latency_ms, Some(350.0));
    assert_eq!(p.last_produced_height, Some(123));

    // Sem nome e sem entrada de performance: os Option ficam vazios, não inventados.
    let b = &validadores[1];
    assert_eq!(b.name, None);
    assert!(b.performance.is_none());
}

/// O critério 3 da Fase S: `historico()` pagina com o cursor `before` que a API
/// devolve em `nextBefore` — e o repassa NA QUERY da página seguinte.
#[test]
fn s3_historico_pagina_com_o_cursor_before() {
    let caminhos = Arc::new(Mutex::new(Vec::<String>::new()));
    let caminhos_srv = Arc::clone(&caminhos);

    let url = no_falso(move |req| {
        caminhos_srv.lock().expect("lock").push(req.caminho.clone());
        // A forma de address.rs:680 / api.js:983: tx com campos do bloco achatados.
        if req.caminho.contains("before=") {
            return (200, json!({
                "address": "E7AAA",
                "txs": [{
                    "id": "tx-antiga", "type": "STAKE", "from": "E7AAA", "to": null,
                    "amount": "500", "fee": "10", "nonce": 1,
                    "blockHeight": 2, "blockTime": 1_700_000_000_000i64,
                }],
                "nextBefore": null,
            }));
        }
        (200, json!({
            "address": "E7AAA",
            "txs": [{
                "id": "tx-nova", "type": "TRANSFER", "from": "E7AAA", "to": "E7BBB",
                "amount": "1000", "fee": "10", "nonce": 2,
                "blockHeight": 9, "blockTime": 1_700_000_100_000i64,
            }],
            "nextBefore": 4,
        }))
    });

    let cliente = Eav7Client::novo(&url);

    let pagina1 = cliente.historico("E7AAA", None).expect("página 1");
    assert_eq!(pagina1.next_before, Some(4));
    let t = &pagina1.txs[0];
    assert_eq!(t.id, "tx-nova");
    assert_eq!(t.tx_type, "TRANSFER");
    assert_eq!(t.to.as_deref(), Some("E7BBB"));
    assert_eq!(t.amount, 1000);
    assert_eq!(t.fee, 10);
    assert_eq!(t.block_height, 9);

    let pagina2 = cliente.historico("E7AAA", pagina1.next_before).expect("página 2");
    assert_eq!(pagina2.next_before, None, "acabou");
    assert_eq!(pagina2.txs[0].id, "tx-antiga");
    assert_eq!(pagina2.txs[0].to, None);

    let vistos = caminhos.lock().expect("lock");
    assert!(vistos[0].starts_with("/address/E7AAA/txs?limit="), "{}", vistos[0]);
    assert!(vistos[1].ends_with("&before=4"), "o cursor voltou na query: {}", vistos[1]);
}

// ============================================================================
// S4 — unbonding na Conta e CLAIM_VOTER_REWARD
// ============================================================================

/// `conta()` lê as parcelas de unbonding e a recompensa reivindicável — os dois
/// campos que fecham o fluxo de stake do plano 08 (B1).
#[test]
fn s4_conta_traz_unbonding_e_recompensa_reivindicavel() {
    let url = no_falso(|_| {
        // A forma de address.rs:566-603 / api.js:805-812, reduzida ao usado.
        (200, json!({
            "address": "E7AAA",
            "balance": "5000",
            "staked": "3000",
            "nextNonce": 4,
            "feeExempt": false,
            "unbonding": [
                { "amount": "1000", "matureAt": 200, "blocksLeft": 55 },
                { "amount": "500", "matureAt": 300, "blocksLeft": 155 },
            ],
            "claimableVoterReward": "77",
        }))
    });

    let conta = Eav7Client::novo(&url).conta("E7AAA").expect("lê");
    assert_eq!(conta.unbonding.len(), 2);
    assert_eq!(conta.unbonding[0].amount, 1000);
    assert_eq!(conta.unbonding[0].mature_at, 200);
    assert_eq!(conta.unbonding[0].blocks_left, 55);
    assert_eq!(conta.unbonding[1].amount, 500);
    assert_eq!(conta.claimable_voter_reward, 77);
}

/// Conta SEM os campos novos (nó antigo, resposta enxuta) não quebra: unbonding
/// vazio e recompensa zero, sem erro.
#[test]
fn s4_conta_sem_unbonding_na_resposta_fica_vazia() {
    let url = no_falso(|_| {
        (200, json!({ "address": "E7AAA", "balance": "10", "staked": "0", "nextNonce": 1 }))
    });
    let conta = Eav7Client::novo(&url).conta("E7AAA").expect("lê");
    assert!(conta.unbonding.is_empty());
    assert_eq!(conta.claimable_voter_reward, 0);
}

/// `reivindicar_recompensa` envia `data.validator` — SEM ele o consenso rejeita
/// (value.rs:638: `validator` obrigatório e válido). O teste inspeciona o corpo
/// que chegou ao nó, porque é o corpo que decide.
#[test]
fn s4_reivindicar_recompensa_envia_o_validador_no_data() {
    let corpos = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let corpos_srv = Arc::clone(&corpos);

    let url = no_falso(move |req| {
        if req.metodo == "GET" && req.caminho.starts_with("/address/") {
            return (200, json!({ "balance": "1000000000", "staked": "0", "nextNonce": 1 }));
        }
        if req.metodo == "POST" && req.caminho == "/tx" {
            corpos_srv.lock().expect("lock").push(req.corpo.clone());
            return (200, json!({ "accepted": true, "id": req.corpo["id"] }));
        }
        (404, json!({ "error": "rota inesperada" }))
    });

    let validador = eav7_sdk::derive_address_from("fase-s:validador");
    // Pelo construtor (S6): carteira + timeout no mesmo fluxo.
    let cliente = Eav7Client::construtor(&url)
        .timeout(Duration::from_secs(5))
        .carteira(Box::new(carteira()))
        .construir();
    let r = cliente.reivindicar_recompensa(&validador).expect("aceita");
    assert!(r.accepted);

    let corpos = corpos.lock().expect("lock");
    assert_eq!(corpos.len(), 1);
    assert_eq!(corpos[0]["type"], json!("CLAIM_VOTER_REWARD"));
    assert_eq!(corpos[0]["amount"], json!("0"));
    assert_eq!(corpos[0]["data"]["validator"], json!(validador));
}

// ============================================================================
// S6 — construtor com timeout configurável
// ============================================================================

/// Timeout curto DESISTE rápido: um nó pendurado não pode segurar o chamador
/// pelos 30s do padrão. É a diferença entre "config" e "decoração".
#[test]
fn s6_timeout_do_construtor_e_respeitado() {
    let url = no_falso(|_| {
        std::thread::sleep(Duration::from_secs(3));
        (200, json!({}))
    });
    let cliente = Eav7Client::construtor(&url).timeout(Duration::from_millis(200)).construir();

    let inicio = Instant::now();
    let erro = cliente.status().expect_err("tinha de estourar o prazo");
    assert!(matches!(erro, ErroCliente::Transporte(_)), "{erro}");
    assert!(
        inicio.elapsed() < Duration::from_secs(2),
        "desistiu no timeout configurado, não no padrão de 30s"
    );
}
