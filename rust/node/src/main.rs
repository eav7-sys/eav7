//! Executável do nó EAV7 — boot do disco + API HTTP.
//!
//! Espelha o `node start` de `bin/eav7.js`: boot do disco (replay completo,
//! fonte de verdade), gênese (arquivo customizado, rede, ou criada pelo
//! validador fundador), API pública, P2P (gossip + sync) e produção de blocos.
//!
//! A EAVM está LIGADA: o servidor JSON-RPC no dialeto Ethereum sobe por padrão
//! numa porta própria (`--eavm-port`, default `port + 1000`), e `--no-eavm` o
//! desliga. O texto anterior aqui dizia que "a EAVM ainda não existe e as flags
//! dela falham explícito" — contradizia a string de uso 40 linhas abaixo e o
//! bloco que dá `bind` no RPC.

use std::sync::{Arc, RwLock};

use eav7::blockchain::Blockchain;
use eav7::blockstore::BlockStore;
use eav7::mempool::Mempool;

use eav7_node::guard::{AbuseGuard, GuardConfig};
use eav7_node::node::Node;

struct Args {
    port: u16,
    host: String,
    data: Option<std::path::PathBuf>,
    genesis_hash: Option<String>,
    validator: Option<std::path::PathBuf>,
    peers: Vec<String>,
    self_url: Option<String>,
    public_rpc_url: Option<String>,
    allow_private_peers: bool,
    genesis_file: Option<std::path::PathBuf>,
    /// `--eavm-port <n>`: porta do RPC EAVM. `None` = default `port + 1000` (como
    /// o JS). Ver `eavm_enabled`/`eavm_rpc`.
    eavm_port: Option<u16>,
    /// `--no-eavm`: DESLIGA o servidor RPC EAVM.
    no_eavm: bool,
    /// `--sentinel`: sobe a sentinela de segurança (heurísticas + parecer LLM
    /// se `ANTHROPIC_API_KEY` estiver definida) como task in-process.
    sentinel: bool,
    /// `--oracle-wallet <arquivo>`: sobe o worker de oráculo de IA com esta
    /// carteira (role de operador; publica AI_RESULT).
    oracle_wallet: Option<std::path::PathBuf>,
}

const USO: &str = "uso: eav7-node [--port 6070] [--host 0.0.0.0] [--data dir] [--genesis-hash <hash>]
                 [--validator carteira.json] [--peers url,url] [--self-url url]
                 [--public-rpc url]
                 [--allow-private-peers] [--genesis genesis.json]
                 [--eavm-port <n>] [--no-eavm] [--sentinel] [--oracle-wallet w.json]

RPC EAVM (dialeto Ethereum p/ MetaMask/Trust Wallet): LIGADO por padrão na porta
port+1000; --eavm-port <n> escolhe a porta; --no-eavm desliga.";

fn parse_args() -> Result<Args, String> {
    let mut args = Args {
        port: 6070,
        host: "0.0.0.0".to_string(),
        data: None,
        genesis_hash: None,
        validator: None,
        peers: Vec::new(),
        self_url: None,
        public_rpc_url: None,
        allow_private_peers: false,
        genesis_file: None,
        eavm_port: None,
        no_eavm: false,
        sentinel: false,
        oracle_wallet: None,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut valor = |nome: &str| it.next().ok_or(format!("{nome} exige um valor"));
        match flag.as_str() {
            "--port" => {
                args.port = valor("--port")?.parse().map_err(|_| "porta inválida".to_string())?;
            }
            "--host" => args.host = valor("--host")?,
            "--data" => args.data = Some(valor("--data")?.into()),
            "--genesis-hash" => args.genesis_hash = Some(valor("--genesis-hash")?),
            "--validator" => args.validator = Some(valor("--validator")?.into()),
            // `--peers` aceita lista separada por vírgula E repetição da flag,
            // como o launcher JS.
            "--peers" => args
                .peers
                .extend(valor("--peers")?.split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty())),
            "--self-url" => args.self_url = Some(valor("--self-url")?),
            "--public-rpc" => args.public_rpc_url = Some(valor("--public-rpc")?),
            "--allow-private-peers" => args.allow_private_peers = true,
            "--genesis" => args.genesis_file = Some(valor("--genesis")?.into()),
            "--help" | "-h" => {
                println!("{USO}");
                std::process::exit(0);
            }
            // RPC EAVM PORTADO: `--eavm-port <n>` escolhe a porta (liga o RPC);
            // sem ela, o default é `port + 1000` (como o launcher JS). `--no-eavm`
            // desliga o RPC por completo.
            "--eavm-port" => {
                args.eavm_port =
                    Some(valor("--eavm-port")?.parse().map_err(|_| "porta EAVM inválida".to_string())?);
            }
            "--no-eavm" => args.no_eavm = true,
            "--sentinel" => args.sentinel = true,
            "--oracle-wallet" => args.oracle_wallet = Some(valor("--oracle-wallet")?.into()),
            outra => return Err(format!("flag desconhecida: {outra}\n\n{USO}")),
        }
    }
    Ok(args)
}

fn agora_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Pilha de cada worker do tokio.
///
/// O interpretador da EAVM é RECURSIVO: uma cadeia de `CALL` consome uma moldura
/// nativa por nível, até `MAX_CALL_DEPTH` (128). Medido nesta base: ~4,5 KiB por
/// moldura em release e ~64 KiB em debug — ou seja, até ~8 MiB no pior caso, e o
/// padrão do tokio é 2 MiB. Estourar a pilha em Rust não é exceção capturável: é
/// `SIGABRT`, o processo inteiro morre. E o caminho é público e sem autenticação
/// (`eth_call`/`eth_estimateGas`/`eth_sendRawTransaction` com um contrato que
/// chama a si mesmo).
///
/// A referência não tem esse degrau — no V8 o estouro vira `RangeError`, que o
/// `vm.js` converte em revert. Aqui a margem tem de ser explícita.
///
/// ATENÇÃO ao mexer em `MAX_CALL_DEPTH`: subir para os 1024 do Ethereum exigiria
/// ~4,6 MiB só em release, e este número teria de subir junto.
const PILHA_POR_WORKER: usize = 16 * 1024 * 1024;

fn main() {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(PILHA_POR_WORKER)
        .build()
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("eav7-node: não foi possível criar o runtime: {e}");
            std::process::exit(1);
        }
    };
    if let Err(e) = runtime.block_on(executa()) {
        eprintln!("eav7-node: {e}");
        std::process::exit(1);
    }
}

/// Confere que o binário foi COMPILADO no mesmo modo de fork em que está sendo
/// EXECUTADO.
///
/// O nó de referência zera as alturas de fork em tempo de execução quando
/// `EAV7_GENESIS_ACTIVE=1`; este cliente as tem como `const`, fixadas no build
/// (ver `config::GENESIS_ACTIVE_BUILD`). Rodar um binário de rede antiga contra
/// uma rede de gênese-ativo — ou o contrário — faria este nó aplicar regras de
/// fork DIFERENTES das da rede: rejeitaria blocos válidos, aceitaria inválidos, e
/// divergiria em silêncio. Abortar aqui troca a pior falha possível (cisão
/// silenciosa) pela melhor (recusa de subir, com a receita da correção).
fn confere_modo_de_fork() -> Result<(), String> {
    confere_env_de_consenso()?;
    let ambiente = std::env::var("EAV7_GENESIS_ACTIVE").as_deref() == Ok("1");
    if ambiente == eav7::config::GENESIS_ACTIVE_BUILD {
        return Ok(());
    }
    Err(format!(
        "modo de fork incompatível: o ambiente {} gênese-ativo, mas este binário foi \
         compilado {}.\n\
         Regenere a configuração e recompile no modo certo:\n\
         \x20 {}node bin/eav7-config-rs.js && cargo build --release",
        if ambiente { "PEDE" } else { "NÃO pede" },
        if eav7::config::GENESIS_ACTIVE_BUILD { "COM gênese-ativo" } else { "SEM gênese-ativo" },
        if ambiente { "EAV7_GENESIS_ACTIVE=1 " } else { "" },
    ))
}

/// Confere as demais variáveis de ambiente que mudam valor de CONSENSO.
///
/// Mesma lógica de [`confere_modo_de_fork`], para a lista que a referência lê em
/// tempo de execução (`EAV7_AI_TEE_HEIGHT`, `EAV7_BRIDGE_BREAKER_HEIGHT`,
/// `EAV7_EAVM_CHAIN_ID`, …). Elas não eram sequer lidas por este cliente: um nó
/// Rust num rollout coordenado da Fase 6 continuaria recusando atestação depois
/// de a rede tê-la ligado, e divergiria no primeiro `AI_RESULT` atestado.
///
/// A comparação é com o ambiente EM QUE O CONFIG FOI GERADO, não com um valor
/// esperado: quem decide o valor é a referência, e o papel daqui é só garantir
/// que o binário e a rede estão no mesmo ajuste.
fn confere_env_de_consenso() -> Result<(), String> {
    let divergentes: Vec<String> = eav7::config::ENV_DE_CONSENSO
        .iter()
        .filter_map(|(nome, no_build)| {
            let agora = std::env::var(nome).unwrap_or_default();
            if agora == *no_build {
                return None;
            }
            let mostrar = |v: &str| if v.is_empty() { "(ausente)".to_string() } else { v.to_string() };
            Some(format!("  {nome}: build={} ambiente={}", mostrar(no_build), mostrar(&agora)))
        })
        .collect();
    if divergentes.is_empty() {
        return Ok(());
    }
    Err(format!(
        "ambiente de consenso incompatível com o build:\n{}\n\
         Estas variáveis mudam valor de CONSENSO e o cliente Rust as fixa no build.\n\
         Regenere a configuração com o MESMO ambiente da rede e recompile:\n\
         \x20 node bin/eav7-config-rs.js && cargo build --release",
        divergentes.join("\n")
    ))
}

async fn executa() -> Result<(), String> {
    let args = parse_args()?;
    // ANTES de qualquer coisa: um binário no modo de fork errado não pode nem
    // tocar o disco da cadeia.
    confere_modo_de_fork()?;

    let mut blockchain = match &args.genesis_hash {
        // Gênese FIXADA: impede um peer (ou um arquivo trocado) de impor outra
        // rede — o boot recusa qualquer linha 0 com hash diferente.
        Some(h) => Blockchain::com_genese_fixada(h.clone()),
        None => Blockchain::new(),
    };

    if let Some(dir) = &args.data {
        std::fs::create_dir_all(dir).map_err(|e| format!("criar {}: {e}", dir.display()))?;
        let arquivo = dir.join("blocks.jsonl");
        let snap = dir.join("estado.snap");

        // BOOT RÁPIDO primeiro. O estado vem do snapshot, provado contra o
        // `stateRoot` do header; a cadeia é só relida para reconstruir os índices.
        // Qualquer problema devolve `None` e cai no replay completo, que é o
        // caminho-fonte-de-verdade — snapshot é otimização, não autoridade.
        let mut store = BlockStore::new(&arquivo);
        let rapido = blockchain
            .load_from_snapshot(&mut store, &snap)
            .map_err(|e| format!("boot de {}: {e}", arquivo.display()))?;

        blockchain.snapshot_path = Some(snap.clone());
        if let Some(altura) = rapido {
            blockchain.store = Some(store);
            println!(
                "[nó] cadeia carregada do SNAPSHOT: altura {altura} ({} bloco(s)) — \
                 estado conferido contra o stateRoot do header",
                altura + 1,
            );
        } else {
            let descartados = blockchain
                .load_from_disk(store, agora_ms())
                .map_err(|e| format!("boot de {}: {e}", arquivo.display()))?;
            if descartados > 0 {
                eprintln!(
                    "[cadeia] {descartados} bloco(s) inválido(s) no fim do blocks.jsonl descartados — \
                     o restante re-sincroniza da rede"
                );
            }
            println!(
                "[nó] cadeia carregada do disco: altura {} ({} bloco(s))",
                blockchain.height(),
                blockchain.height() + 1,
            );
            // Snapshot FRESCO logo após um replay completo: o próximo boot parte
            // daqui em segundos. É o momento em que ele vale mais — a cadeia
            // acabou de ser inteiramente revalidada.
            blockchain.talvez_snapshot(&snap);
        }
    } else {
        println!("[nó] sem --data: cadeia em memória (nada persiste)");
    }

    // Carteira do validador — carregada ANTES da gênese, porque um validador
    // fundador (sem peers, sem arquivo de gênese) a usa para criar o bloco 0.
    let wallet = match &args.validator {
        Some(caminho) => Some(Arc::new(
            eav7_node::wallet::ProductionWallet::from_file(caminho)
                .map_err(|e| format!("carteira {}: {e}", caminho.display()))?,
        )),
        None => None,
    };
    let validator_address = wallet.as_ref().map(|w| w.address().to_string());

    // Gênese — espelha `ensureGenesis` (node.js:162-183), na mesma ordem:
    // 1) arquivo customizado (--genesis): TODOS os nós adotam o mesmo bloco 0;
    // 2) com peers: a gênese vem da REDE (sincronização) — um validador que
    //    ENTRA numa rede existente não cria gênese nova;
    // 3) sem peers: o validador fundador cria a gênese.
    if !blockchain.has_genesis() {
        if let Some(arquivo) = &args.genesis_file {
            let texto = std::fs::read_to_string(arquivo)
                .map_err(|e| format!("ler {}: {e}", arquivo.display()))?;
            let v = eav7::transaction::parse_json(&texto)
                .map_err(|e| format!("gênese ilegível: {e}"))?;
            let bloco = eav7::block::block_from_json(&v).map_err(|e| format!("gênese inválida: {e}"))?;
            // A persistência da linha 0 é do próprio `adopt_genesis` (como no JS):
            // fonte única do pressuposto linha N == altura N.
            blockchain.adopt_genesis(bloco).map_err(|e| format!("adotar gênese: {e}"))?;
            println!("[nó] gênese adotada do arquivo ({})", blockchain.head().map(|b| b.hash.as_str()).unwrap_or("?"));
        } else if !args.peers.is_empty() {
            println!("[nó] sem gênese local: sincronizando da rede");
        } else if let Some(w) = &wallet {
            use eav7::config::{GENESIS_STAKE, GENESIS_SUPPLY};
            use eav7::transaction::JsonValue;
            let endereco = w.address().to_string();
            let genese = eav7::block::build_genesis_block(
                agora_ms(),
                JsonValue::map([
                    ("balances".to_string(), JsonValue::map([(
                        endereco.clone(), JsonValue::Str((GENESIS_SUPPLY - GENESIS_STAKE).to_string()),
                    )])),
                    ("stakes".to_string(), JsonValue::map([(
                        endereco.clone(), JsonValue::Str(GENESIS_STAKE.to_string()),
                    )])),
                    // O endereço da gênese é o relayer de ponte inicial autorizado,
                    // como na referência (blockchain.js:121).
                    ("bridgeRelayers".to_string(), JsonValue::List(vec![JsonValue::Str(endereco.clone())])),
                ]),
            );
            blockchain.adopt_genesis(genese).map_err(|e| format!("criar gênese: {e}"))?;
            println!("[nó] gênese criada ({})", blockchain.head().map(|b| b.hash.as_str()).unwrap_or("?"));
        } else {
            return Err(
                "primeira inicialização exige uma carteira de validador (--validator) ou peers para sincronizar"
                    .into(),
            );
        }
    }

    // RPC EAVM: LIGADO por padrão (como o nó JS). `--eavm-port <n>` escolhe a
    // porta; sem ela, `port + 1000` (o default do launcher JS). `--no-eavm`
    // desliga. `saturating_add` evita estouro de u16 em porta base muito alta.
    let eavm_enabled = !args.no_eavm;
    let eavm_port = args.eavm_port.unwrap_or_else(|| args.port.saturating_add(1000));

    // A própria URL, com o MESMO default do P2P (`p2p.js`): é ela que impede o nó
    // de se adicionar como peer de si mesmo.
    let url_propria =
        args.self_url.clone().unwrap_or_else(|| format!("http://127.0.0.1:{}", args.port));

    let node = Node {
        blockchain,
        mempool: Mempool::new(),
        validator_address: validator_address.clone(),
        peers: Vec::new(),
        security_alerts: Vec::new(),
        // Placeholder: o handle REAL (o mesmo do middleware) é injetado logo
        // após a construção da admissão, abaixo.
        guard: std::sync::Arc::new(std::sync::Mutex::new(AbuseGuard::new(GuardConfig::default()))),
        gateway_target: None,
        gateway_snapshot: Default::default(),
        eavm_enabled,
        eavm_port,
        // `opts['public-rpc'] ?? process.env.EAV7_PUBLIC_RPC_URL ?? null`
        // (bin/eav7.js:233). Ficava `None` fixo: em produção o `/status` do nó JS
        // anunciava a URL do RPC e o do Rust anunciava `null`, deixando o fluxo
        // "adicionar rede ao MetaMask" do frontend sem para onde apontar.
        public_rpc_url: args
            .public_rpc_url
            .clone()
            .or_else(|| std::env::var("EAV7_PUBLIC_RPC_URL").ok())
            .filter(|u| !u.is_empty()),
        self_url: Some(url_propria.clone()),
        // Sem token configurado os endpoints de admin ficam DESABILITADOS — o
        // padrão seguro do JS, preservado.
        admin_token: std::env::var("EAV7_ADMIN_TOKEN").ok().filter(|t| !t.is_empty()),
        // Registro de contratos verificados começa vazio (#8) — metadado
        // NÃO-consensual, preenchido em runtime por POST /contract/{addr}/verify.
        verified_contracts: Default::default(),
            eavm_index: std::sync::Arc::new(std::sync::Mutex::new(eav7_node::node::EavmIndex::novo())),
            relay_bloco: None,
            pedir_sync: None,
            gossip_tx: None,
    };
    let estado: Arc<RwLock<Node>> = Arc::new(RwLock::new(node));

    // P2P: registro nos seeds + sync periódico. `self_url` default espelha o JS
    // (`http://127.0.0.1:<porta>`).
    let p2p_config = eav7_node::p2p::P2pConfig {
        self_url: Some(args.self_url.clone().unwrap_or_else(|| format!("http://127.0.0.1:{}", args.port))),
        allow_private_peers: args.allow_private_peers,
        sync_ms: 5000,
    };
    let _p2p = eav7_node::p2p::start(estado.clone(), p2p_config.clone(), args.peers.clone());

    // RELAY de blocos recebidos (node.js:226) e SYNC sob demanda (node.js:221).
    // Duas tasks pequenas em volta do mesmo transporte: o handler de `POST
    // /blocks` é síncrono e não fala com a rede, então avisa por canal.
    {
        let (tx_relay, mut rx_relay) = tokio::sync::mpsc::unbounded_channel::<String>();
        let estado_relay = estado.clone();
        let config_relay = p2p_config.clone();
        tokio::spawn(async move {
            let client = eav7_node::p2p::make_client();
            while let Some(linha) = rx_relay.recv().await {
                let peers = match estado_relay.read() {
                    Ok(n) => n.peers.clone(),
                    Err(_) => continue,
                };
                eav7_node::p2p::broadcast_block(&client, &config_relay, &peers, linha);
            }
        });

        let (tx_sync, mut rx_sync) = tokio::sync::mpsc::unbounded_channel::<()>();
        let estado_sync = estado.clone();
        let config_sync = p2p_config.clone();
        tokio::spawn(async move {
            let client = eav7_node::p2p::make_client();
            // A MESMA guarda de reentrância do laço periódico: dois `sync_once`
            // simultâneos replayariam a mesma faixa de blocos duas vezes.
            let guarda = tokio::sync::Mutex::new(());
            while rx_sync.recv().await.is_some() {
                // Drena os pedidos acumulados: uma rajada de blocos à frente
                // gera vários avisos, e um sync só já cobre todos.
                while rx_sync.try_recv().is_ok() {}
                eav7_node::p2p::sync_once(&client, &config_sync, &estado_sync, &guarda).await;
            }
        });

        if let Ok(mut n) = estado.write() {
            n.relay_bloco = Some(tx_relay);
            n.pedir_sync = Some(tx_sync);
        }
    }

    // Failover de leitura do gateway (operacional, opt-in via EAV7_GATEWAY_FAILOVER).
    // Sem o flag, a task termina de imediato — nó serve local para sempre.
    let _gateway = eav7_node::gateway::start(estado.clone(), eav7_node::gateway::GatewayConfig::from_env());

    // Sentinela de segurança (opt-in via --sentinel). Monitora o PRÓPRIO nó pela
    // API pública local (mesmo caminho HTTP do JS) e posta alertas. O parecer por
    // LLM só liga se ANTHROPIC_API_KEY estiver presente E o cliente TLS rustls for
    // injetado — a ÚNICA borda TLS do nó. Sem a chave, roda só as heurísticas
    // determinísticas, idêntico ao JS sem a chave.
    // Oráculo de IA (opt-in via --oracle-wallet): observa AI_TASK pendentes no
    // nó e publica AI_RESULT assinado. É um ROLE de operador distinto do
    // validador — carteira própria. Sem ANTHROPIC_API_KEY (ou sem TLS), usa o eco
    // local, idêntico ao JS sem a chave. Fala com o PRÓPRIO nó pela API local.
    let _oraculo = if let Some(caminho) = &args.oracle_wallet {
        let carteira = std::sync::Arc::new(
            eav7_node::wallet::ProductionWallet::from_file(caminho)
                .map_err(|e| format!("carteira do oráculo {}: {e}", caminho.display()))?,
        );
        let url = format!("http://127.0.0.1:{}", args.port);
        let handler: std::sync::Arc<dyn eav7_node::ai::worker::TaskHandler> =
            match std::env::var("ANTHROPIC_API_KEY").ok().filter(|k| !k.is_empty()) {
                Some(api_key) => match eav7_node::ai::tls_client::RustlsLlmClient::new() {
                    Ok(c) => std::sync::Arc::new(eav7_node::ai::worker::ClaudeHandler {
                        api_key,
                        llm: std::sync::Arc::new(c),
                    }),
                    Err(e) => {
                        eprintln!("[oráculo] TLS indisponível ({e}) — usando eco local");
                        std::sync::Arc::new(eav7_node::ai::worker::LocalEchoHandler)
                    }
                },
                None => std::sync::Arc::new(eav7_node::ai::worker::LocalEchoHandler),
            };
        println!("[nó] oráculo de IA como {}", carteira.address());
        Some(eav7_node::ai::worker::AiOracleWorker::new(&url, carteira, handler, 2000).start())
    } else {
        None
    };

    let _sentinela = if args.sentinel {
        let url = format!("http://127.0.0.1:{}", args.port);
        let config = eav7_node::ai::sentinel::SentinelConfig::from_env(&url);
        let llm: Option<std::sync::Arc<dyn eav7_node::ai::LlmClient>> =
            if config.anthropic_api_key.is_some() {
                match eav7_node::ai::tls_client::RustlsLlmClient::new() {
                    Ok(c) => Some(std::sync::Arc::new(c)),
                    Err(e) => {
                        eprintln!("[sentinela] TLS indisponível ({e}) — seguindo só com heurísticas");
                        None
                    }
                }
            } else {
                None
            };
        Some(eav7_node::ai::sentinel::SecuritySentinel::new(config, llm).start())
    } else {
        None
    };

    // DIFUSÃO DE TRANSAÇÕES (`p2p.broadcastTx`, node.js:209). Vale para TODO nó,
    // com ou sem carteira: uma transação submetida a um nó não-produtor precisa
    // chegar a quem produz. Sem esta task ligada ela entrava no mempool local e
    // morria ali — nenhum peer a recebia, nenhum bloco a incluía.
    {
        let (tx_gossip, mut rx_gossip) = tokio::sync::mpsc::unbounded_channel::<String>();
        let estado_gossip = estado.clone();
        let config_gossip = p2p_config.clone();
        tokio::spawn(async move {
            let client = eav7_node::p2p::make_client();
            while let Some(linha) = rx_gossip.recv().await {
                let peers = match estado_gossip.read() {
                    Ok(n) => n.peers.clone(),
                    Err(_) => continue,
                };
                eav7_node::p2p::broadcast_tx(&client, &config_gossip, &peers, linha);
            }
        });
        // O canal entra no `Node` para os handlers (API e P2P) o alcançarem.
        if let Ok(mut n) = estado.write() {
            n.gossip_tx = Some(tx_gossip);
        }
    }

    // Produtor: só com carteira. O canal de gossip liga produtor → difusão P2P:
    // o produtor manda a linha canônica do bloco; esta task a difunde aos peers
    // do momento. Difundir FORA do lock e fora do produtor mantém o laço de
    // produção síncrono e o I/O isolado.
    if let Some(w) = wallet {
        let (bloco_gossip, mut rx_gossip) = tokio::sync::mpsc::unbounded_channel::<String>();
        let estado_gossip = estado.clone();
        let config_gossip = p2p_config.clone();
        tokio::spawn(async move {
            let client = eav7_node::p2p::make_client();
            while let Some(linha) = rx_gossip.recv().await {
                let peers = match estado_gossip.read() {
                    Ok(n) => n.peers.clone(),
                    Err(_) => continue,
                };
                eav7_node::p2p::broadcast_block(&client, &config_gossip, &peers, linha);
            }
        });
        let _produtor = eav7_node::producer::start(estado.clone(), w, Some(bloco_gossip));
        println!(
            "[nó] minerando como {}",
            validator_address.as_deref().unwrap_or("?")
        );
    }

    // Servidor RPC EAVM — o dialeto Ethereum ("eth_*") que MetaMask/Trust Wallet
    // falam. Sobe como MAIS UM `axum::serve` numa tokio::task, compartilhando o
    // MESMO AppState (Arc<RwLock<Node>>) da API pública: leituras servem o mesmo
    // estado e `eth_sendRawTransaction` cai no mesmo mempool. Porta SEPARADA.
    // CONTROLE DE ADMISSÃO — compartilhado entre a API e o RPC, para que um
    // atacante não tenha duas cotas independentes batendo no mesmo nó.
    let admissao = eav7_node::api::admissao::Admissao::from_env();
    println!("[nó] admissão: rate limit {} req/{}ms por IP + guarda anti-abuso",
        eav7::config::RATE_LIMIT_MAX, eav7::config::RATE_LIMIT_WINDOW_MS);

    if eavm_enabled {
        let rpc_endereco = format!("{}:{}", args.host, eavm_port);
        let rpc_router = eav7_node::eavm_rpc::router()
            .with_state(estado.clone())
            .layer(axum::middleware::from_fn_with_state(
                admissao.clone(),
                eav7_node::api::admissao::controlar,
            ));
        let rpc_listener = tokio::net::TcpListener::bind(&rpc_endereco)
            .await
            .map_err(|e| format!("bind do RPC EAVM em {rpc_endereco}: {e}"))?;
        println!("[nó] RPC EAVM (chainId {}) em http://{rpc_endereco}", eav7::config::EAVM_CHAIN_ID);
        tokio::spawn(async move {
            // `into_make_service_with_connect_info`: o middleware de admissão
            // precisa do IP do socket, e sem isto o `ConnectInfo` não existe.
            let servico = rpc_router
                .into_make_service_with_connect_info::<std::net::SocketAddr>();
            if let Err(e) = axum::serve(rpc_listener, servico).await {
                eprintln!("[nó] servidor RPC EAVM parou: {e}");
            }
        });
    } else {
        println!("[nó] RPC EAVM desligado (--no-eavm)");
    }

    // O `Node` guarda o MESMO handle de guarda que o middleware usa, para que
    // `GET /guard` reporte os bloqueios reais em vez de uma lista sempre vazia.
    if let Ok(mut n) = estado.write() {
        n.guard = admissao.guard.clone();
    }
    // PROXY DE LEITURA do gateway: quando o failover elege um peer, os GET
    // públicos passam a ser servidos dele. Sem esta camada o `gateway.rs`
    // decidia e ninguém servia — o painel dizia "failover ativo" e o explorer
    // continuava entregando estado local obsoleto.
    let proxy = eav7_node::api::proxy_leitura::ProxyLeitura::novo(estado.clone());
    // REVERSE PROXY dos serviços de apresentação: o nó está NA FRENTE do
    // domínio, então navegação do browser e assets vão ao Next e `/buy/*` vai ao
    // serviço de fulfillment. Sem esta camada o domínio responde API onde
    // deveria responder site — e o binário Rust não substitui o nó JS.
    let upstreams = eav7_node::api::proxy_upstream::Upstreams::from_env();
    println!(
        "[nó] frontend em http://{}:{} · compra em http://{}:{}",
        upstreams.web_host, upstreams.web_port, upstreams.buy_host, upstreams.buy_port
    );
    let upstream = eav7_node::api::proxy_upstream::ProxyUpstream::novo(upstreams);
    // As camadas rodam na ORDEM INVERSA do encadeamento: admissão primeiro
    // (nenhum proxy pode ser rota livre de rate limit), depois o upstream (uma
    // navegação do browser é do Next, não de um peer) e por fim o failover de
    // leitura do gateway. É a ordem de `api.js:262-297`.
    let router = eav7_node::api::router()
        .with_state(estado)
        .layer(axum::middleware::from_fn_with_state(
            proxy,
            eav7_node::api::proxy_leitura::proxiar,
        ))
        .layer(axum::middleware::from_fn_with_state(
            upstream,
            eav7_node::api::proxy_upstream::proxiar_upstream,
        ))
        .layer(axum::middleware::from_fn_with_state(
            admissao.clone(),
            eav7_node::api::admissao::controlar,
        ));
    let endereco = format!("{}:{}", args.host, args.port);
    let listener = tokio::net::TcpListener::bind(&endereco)
        .await
        .map_err(|e| format!("bind em {endereco}: {e}"))?;
    println!("[nó] API pública em http://{endereco}");

    axum::serve(listener, router.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            eprintln!("\n[nó] encerrando");
        })
        .await
        .map_err(|e| format!("servidor: {e}"))
}
