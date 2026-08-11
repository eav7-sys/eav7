//! PROVA DE REPLAY — o cliente Rust reproduz, bloco a bloco, o estado que o nó de
//! REFERÊNCIA produziu.
//!
//! É o teste mais forte do porte. Os vetores provam funções isoladas; este prova a
//! MÁQUINA INTEIRA: dado o mesmo `blocks.jsonl` que a referência escreveu, o Rust
//! tem de chegar à MESMA raiz de estado em CADA altura — que é exatamente o que a
//! rede confere entre nós.
//!
//! A cadeia é gerada por `rust/tests/fixtures/cadeia-replay` com
//! `EAV7_GENESIS_ACTIVE=1`, isto é, com TODAS as alturas de fork zeradas: é o
//! cenário do relançamento e o mais exigente, porque toda regra nova está ligada
//! desde o bloco 1. O binário precisa ter sido compilado no mesmo modo — ver
//! `config::GENESIS_ACTIVE_BUILD` e a conferência de boot em `main.rs`.

use std::path::PathBuf;

/// Relógio em ms — `add_block` valida drift, e a cadeia de referência foi gerada
/// com timestamps no passado.
fn agora_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

use eav7::blockchain::Blockchain;
use eav7::blockstore::BlockStore;
use eav7::stateroot::compute_state_root;

/// Onde está a cadeia de referência.
///
/// O DEFAULT é o fixture COMMITADO (`tests/fixtures/cadeia-replay`), para que a
/// prova rode em todo `cargo test` sem preparo. Antes o default era um caminho em
/// `/tmp` gerado sob demanda, e o teste pulava quando ele faltava: no build padrão
/// o teste mais forte do porte passava como "ok. 1 passed" sem comparar nada.
///
/// `EAV7_REPLAY_DIR` aponta para outra cadeia — é como se roda a versão
/// gênese-ativo, que exercita os forks que a cadeia curta não alcança.
fn dir_da_cadeia() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("EAV7_REPLAY_DIR") {
        let dir = PathBuf::from(dir);
        return dir.join("blocks.jsonl").exists().then_some(dir);
    }
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("cadeia-replay");
    fixture.join("blocks.jsonl").exists().then_some(fixture)
}

#[test]
fn replay_da_cadeia_de_referencia_bate_raiz_por_altura() {
    let Some(dir) = dir_da_cadeia() else {
        eprintln!(
            "PULADO: cadeia de referência ausente. Gere com:\n  \
             EAV7_GENESIS_ACTIVE=1 use rust/tests/fixtures/cadeia-replay /tmp/cadeia-replay"
        );
        return;
    };

    let esperado: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join("raizes-esperadas.json")).expect("raizes-esperadas.json"),
    )
    .expect("JSON das raízes");

    // O modo de fork do binário TEM de casar com o da cadeia — senão o teste
    // compararia regras diferentes e o vermelho seria enganoso.
    // O modo de fork do binário TEM de casar com o da cadeia. Divergência aqui é
    // INCOMPATIBILIDADE DE AMBIENTE, não bug: o teste PULA com a receita, em vez
    // de pintar de vermelho quem rodou `cargo test` no build normal. A suíte
    // completa vive no build normal (onde "abaixo do fork" existe e os ~35 testes
    // de gate fazem sentido); a prova de replay roda no build gênese-ativo.
    let genese_ativo = esperado["genesisAtivo"].as_bool().unwrap_or(false);
    if genese_ativo != eav7::config::GENESIS_ACTIVE_BUILD {
        eprintln!(
            "PULADO: a cadeia foi gerada {} gênese-ativo e este binário foi compilado {}.\n               Para rodar a prova:\n                 EAV7_GENESIS_ACTIVE=1 edit rust/src/config.rs and rebuild\n                 EAV7_GENESIS_ACTIVE=1 use rust/tests/fixtures/cadeia-replay /tmp/cadeia-replay\n                 cargo test -p eav7 --test replay",
            if genese_ativo { "COM" } else { "SEM" },
            if eav7::config::GENESIS_ACTIVE_BUILD { "COM" } else { "SEM" },
        );
        return;
    }

    // O boot REAL: o mesmo `load_from_disk` que o nó usa — mas sobre uma CÓPIA.
    // O boot TRUNCA rabo inválido (é o comportamento correto: "o arquivo é cache,
    // a rede é a fonte de verdade"), e rodar isso direto no fixture faria a
    // primeira execução vermelha destruir a cadeia de referência, tornando todas
    // as seguintes verdes-por-vacuidade. O teste opera numa cópia descartável.
    let copia = std::env::temp_dir().join(format!("eav7-replay-{}.jsonl", std::process::id()));
    std::fs::copy(dir.join("blocks.jsonl"), &copia).expect("copiar a cadeia de referência");
    let mut chain = Blockchain::new();
    let descartados = chain
        .load_from_disk(BlockStore::new(&copia), agora_ms())
        .expect("o replay do blocks.jsonl da referência tem de suceder");
    if descartados > 0 {
        // "N descartados" não diz NADA sobre a causa. Reproduzimos a aplicação do
        // primeiro bloco fora do boot para que a falha aponte o motivo real — é a
        // diferença entre um teste que acusa e um que ajuda.
        let texto = std::fs::read_to_string(dir.join("blocks.jsonl")).expect("blocks.jsonl");
        let mut diag = Blockchain::new();
        let mut motivo = String::from("(nenhum bloco falhou na reprodução isolada)");
        for (i, linha) in texto.lines().enumerate() {
            let v = match eav7::transaction::parse_json(linha) {
                Ok(v) => v,
                Err(e) => { motivo = format!("linha {i}: JSON ilegível: {e}"); break }
            };
            let b = match eav7::block::block_from_json(&v) {
                Ok(b) => b,
                Err(e) => { motivo = format!("linha {i}: bloco malformado: {e}"); break }
            };
            // Hash recalculado vs gravado: quando a causa é o hash, o valor dos
            // dois lados é a informação que resolve o caso.
            let payload_rust = eav7::block::block_payload(&b);
            let _ = std::fs::write("/tmp/payload-rust.bin", &payload_rust);
            let recalculado = eav7::block::block_hash(
                &payload_rust,
                &b.signature,
                &b.pq_signature,
                b.height,
            );
            let gravado = b.hash.clone();
            let altura_b = b.height;
            let ts_b = b.timestamp;
            let txs_do_bloco = b.transactions.clone();
            let bloco_copia = b.clone();
            // Antes de aplicar: guarda as contas, para poder mostrar o QUE mudou
            // diferente quando o estado divergir.
            let contas_antes: Vec<String> = diag
                .state
                .accounts
                .iter()
                .map(|(a, c)| format!("{}: bal={} staked={} nonce={} eUsed={} eBlock={} bwUsed={} bwBlock={}",
                    &a[..10.min(a.len())], c.balance, c.staked, c.nonce,
                    c.energy_used, c.energy_block, c.bandwidth_used, c.bandwidth_block))
                .collect();
            let r = if i == 0 { diag.adopt_genesis(b) } else { diag.add_block(b, agora_ms()) };
            if let Err(e) = r {
                if e.contains("stateRoot") {
                    eprintln!("--- contas ANTES do bloco {i} (visão Rust) ---");
                    for l in &contas_antes { eprintln!("  {l}"); }
                    // Estruturas de votação, que é onde a divergência costuma estar
                    // quando saldos batem.
                    // Reproduz o que o `simulate` faria — txs, recompensa e tick —
                    // com as funções públicas, para poder comparar as FOLHAS que o
                    // Rust produziu contra as da referência. A raiz diz que algo
                    // mudou; as folhas dizem o quê.
                    let mut s2 = diag.state.clone();
                    // O `simulate` grava o hash do PAI no anel (EIP-2935) ANTES
                    // das txs — reproduzir isso aqui é o que torna o diagnóstico
                    // fiel ao caminho real.
                    // As DUAS condições são as de `blockchain.rs:788` e ficam pelo
                    // mesmo motivo: `altura_b > 0` só parece redundante porque este
                    // build tem `EAVM_OSAKA_HEIGHT` = 1,9M. Num build de gênese-ativo
                    // (todos os forks em 0) é ela que impede o `altura_b - 1` de
                    // estourar em u64 na altura 0.
                    #[allow(clippy::redundant_comparisons)]
                    if altura_b > 0 && altura_b >= eav7::config::EAVM_OSAKA_HEIGHT {
                        s2.record_block_hash(altura_b - 1, &bloco_copia.previous_hash);
                    }
                    let mut taxas: u128 = 0;
                    for t in &txs_do_bloco {
                        if let Ok(ap) = s2.apply_transaction(t, altura_b, ts_b as u64) {
                            taxas += ap.fee;
                        }
                    }
                    if let Ok(recompensa) = diag.block_reward(altura_b, &s2) {
                        let _ = eav7::blockchain::distribute_block_reward(
                            &mut s2,
                            eav7::block::block_validator(&bloco_copia),
                            recompensa + taxas,
                        );
                        // `total_minted` sobe FORA do distribute (blockchain.rs:811)
                        // — esquecer isto aqui inventaria uma divergência que o
                        // caminho real não tem.
                        s2.total_minted += recompensa;
                    }
                    let _ = eav7::blockchain::block_tick(&mut s2, altura_b);

                    let folhas_rust: std::collections::BTreeSet<String> =
                        s2.state_leaves().unwrap_or_default().into_iter().collect();
                    let esperadas: std::collections::BTreeSet<String> = esperado["raizes"]
                        .get(i)
                        .and_then(|e| e["leaves"].as_array())
                        .map(|v| v.iter().filter_map(|x| x.as_str()).map(String::from).collect())
                        .unwrap_or_default();
                    let so_rust: Vec<&String> = folhas_rust.difference(&esperadas).collect();
                    let so_ref: Vec<&String> = esperadas.difference(&folhas_rust).collect();
                    eprintln!("--- folhas do bloco {i}: Rust {} x referência {} ---",
                        folhas_rust.len(), esperadas.len());
                    eprintln!("  SÓ no Rust ({}): {:?}", so_rust.len(), so_rust);
                    eprintln!("  SÓ na referência ({}): {:?}", so_ref.len(), so_ref);
                    eprintln!("--- contas (visão Rust, DEPOIS do bloco {i}) ---");
                    for (a, c) in &s2.accounts {
                        eprintln!("  {} bal={} staked={} eUsed={} eBlock={} bwUsed={} bwBlock={}",
                            &a[..10.min(a.len())], c.balance, c.staked,
                            c.energy_used, c.energy_block, c.bandwidth_used, c.bandwidth_block);
                    }
                    eprintln!("  totalMinted={} totalBurned={}", s2.total_minted, s2.total_burned);
                    eprintln!("  commission={:?}", s2.commission);
                    eprintln!("  reward_acc_per_vote={:?}", s2.reward_acc_per_vote);
                    eprintln!("  voter_reward_debt={:?}", s2.voter_reward_debt);
                    eprintln!("  votes={:?}", s2.votes);
                    eprintln!("  candidate_votes={:?}", s2.candidate_votes);
                    eprintln!("  unbonding={:?} treasury={}", s2.unbonding, s2.treasury);
                    // Rotula as folhas do Rust por domínio: sem isso, comparar
                    // hashes soltos não diz de onde vem a divergência.
                    let rotulo = |d: &str, k: &str, v: &eav7::canonical::Value| {
                        eav7::stateroot::leaf(d, k, v).map(|f| (f, format!("{d}:{}", &k[..12.min(k.len())])))
                    };
                    let mut mapa: std::collections::BTreeMap<String, String> = Default::default();
                    for (a, votos) in &s2.votes {
                        let m: std::collections::BTreeMap<String, eav7::canonical::Value> =
                            votos.iter().map(|(k, v)| (k.clone(), eav7::canonical::Value::uint(*v))).collect();
                        if let Ok((f, r)) = rotulo("vote", a, &eav7::canonical::Value::Map(m)) { mapa.insert(f, r); }
                    }
                    for (a, t) in &s2.candidate_votes {
                        if let Ok((f, r)) = rotulo("cvotes", a, &eav7::canonical::Value::uint(*t)) { mapa.insert(f, r); }
                    }
                    for (a, c) in &s2.accounts {
                        if let Ok((f, r)) = rotulo("acct", a, &c.to_value()) { mapa.insert(f, r); }
                    }
                    eprintln!("  identificação das folhas SÓ no Rust:");
                    for f in &so_rust {
                        eprintln!("    {} => {}", &f[..16], mapa.get(*f).map_or("(domínio não testado)", String::as_str));
                    }
                }
                motivo = format!(
                    "bloco {i}: {e}\n    hash gravado    : {gravado}\n    hash recalculado: {recalculado}\n                         CANONICAL_HASH_HEIGHT={} altura={altura_b}",
                    eav7::config::CANONICAL_HASH_HEIGHT,
                );
                break;
            }
        }
        panic!("{descartados} bloco(s) da referência foram DESCARTADOS pelo cliente Rust — {motivo}");
    }

    let raizes = esperado["raizes"].as_array().expect("lista de raízes");
    assert_eq!(
        chain.height(),
        esperado["alturaFinal"].as_i64().expect("alturaFinal"),
        "altura final tem de bater"
    );

    // A comparação altura a altura, pelo CAMINHO REAL de validação: uma cadeia
    // nova recebe cada bloco por `add_block` — a mesma porta por onde um bloco
    // entra vindo da rede. Isso valida produtor, slot, assinatura híbrida,
    // duplicidade de tx e o `stateRoot` do header, além do estado. Comparar só a
    // raiz final esconderia um erro que se cancela; por altura, o primeiro bloco
    // divergente é apontado pelo nome.
    let agora = agora_ms();
    let mut replay = Blockchain::new();
    for (i, entrada) in raizes.iter().enumerate() {
        let altura = entrada["height"].as_u64().expect("height");
        let hash_esperado = entrada["hash"].as_str().expect("hash");
        let raiz_esperada = entrada["stateRoot"].as_str().expect("stateRoot");

        let bloco = chain
            .block_at(altura)
            .expect("leitura do disco")
            .unwrap_or_else(|| panic!("bloco {altura} ausente na cadeia reconstruída"));
        assert_eq!(bloco.hash, hash_esperado, "hash do bloco {altura} diverge");

        if i == 0 {
            replay.adopt_genesis(bloco).expect("adota a gênese da referência");
        } else {
            replay
                .add_block(bloco, agora)
                .unwrap_or_else(|e| panic!("bloco {altura} REJEITADO pelo cliente Rust: {e}"));
        }

        let folhas_rust = replay.state.state_leaves().expect("folhas do estado");
        let raiz = compute_state_root(&folhas_rust);
        if raiz != raiz_esperada {
            // A raiz diz que algo mudou; as FOLHAS dizem o quê. Sem isto, cada
            // divergência custaria uma sessão de arqueologia manual.
            let nossas: std::collections::BTreeSet<&str> =
                folhas_rust.iter().map(String::as_str).collect();
            let deles: std::collections::BTreeSet<&str> = entrada["leaves"]
                .as_array()
                .map(|v| v.iter().filter_map(|x| x.as_str()).collect())
                .unwrap_or_default();
            let so_nossas: Vec<&&str> = nossas.difference(&deles).collect();
            let so_deles: Vec<&&str> = deles.difference(&nossas).collect();
            panic!(
                "RAIZ DE ESTADO DIVERGE na altura {altura}\n                   folhas: Rust {} x referência {}\n                   SÓ no Rust ({}): {:?}\n                   SÓ na referência ({}): {:?}\n                   (folhas iguais em ambos foram omitidas — a diferença acima é a causa)",
                nossas.len(), deles.len(),
                so_nossas.len(), so_nossas,
                so_deles.len(), so_deles,
            );
        }
    }

    // E a cadeia reconstruída pelo BOOT (load_from_disk) tem de chegar à mesma
    // raiz que a reconstruída bloco a bloco: são dois caminhos independentes.
    assert_eq!(
        compute_state_root(&chain.state.state_leaves().expect("folhas")),
        compute_state_root(&replay.state.state_leaves().expect("folhas")),
        "o boot do disco e a aplicação bloco a bloco divergiram entre si"
    );

    let _ = std::fs::remove_file(&copia);
    // O que esta cadeia NÃO exercita, para o verde não sugerir cobertura que não
    // existe. Uma cadeia curta em alturas reais não alcança forks altos.
    if let Some(pulados) = esperado["pulados"].as_array().filter(|p| !p.is_empty()) {
        eprintln!(
            "replay: NÃO exercitado nesta cadeia ({}): {}",
            if esperado["genesisAtivo"].as_bool().unwrap_or(false) { "gênese-ativo" } else { "forks reais" },
            pulados.iter().filter_map(|p| p.as_str()).collect::<Vec<_>>().join(", ")
        );
        eprintln!(
            "  para cobrir tudo: EAV7_GENESIS_ACTIVE=1 (ver tests/fixtures/cadeia-replay/LEIA-ME.md)"
        );
    }
    eprintln!(
        "replay OK: {} blocos, raiz final {} idêntica à da referência",
        raizes.len(),
        raizes.last().expect("último")["stateRoot"].as_str().unwrap_or("?")
    );
}
