//! Worker de oráculo de IA — porte de `src/ai/worker.js` (144 linhas).
//!
//! Processo off-chain que observa a rede EAV7, executa tarefas AI_TASK
//! pendentes e publica AI_RESULT assinado (worker.js:1-6).
//!
//! O handler é plugável ([`TaskHandler`]): por padrão responde com um eco local
//! (útil para desenvolvimento e testes sem rede). O handler que chama a API da
//! Anthropic ([`ClaudeHandler`]) recebe um [`LlmClient`]; em produção o
//! `main.rs` injeta o `RustlsLlmClient` do próprio nó assim que
//! `ANTHROPIC_API_KEY` está definida (ver o cabeçalho de `ai/mod.rs`). Sem a
//! chave, o comportamento é o do JS sem a chave (eco local).
//!
//! # Lógica vs transporte
//!
//! A seleção de tarefas ([`select_tasks`]), o eco local
//! ([`local_echo_output`]) e a checagem de saldo de registro
//! ([`check_registration_balance`]) são puras. O transporte
//! ([`AiOracleWorker`]) faz os GET/POST no nó com o cliente hyper do P2P.
//! A serialização "reserva de nonce + submit" que o JS garante com a fila de
//! promises `sendChain` (worker.js:53,77-95) sai DE GRAÇA aqui: o worker é
//! dono exclusivo do próprio estado numa única task — nenhum lock existe, logo
//! nenhum lock atravessa `await`.
//!
//! # Linha de segurança da IA
//!
//! O worker só publica AI_RESULT — transações comuns que a máquina de estado
//! valida (escrow, janela de desafio, quórum). Nenhuma autonomia além de
//! responder o que foi perguntado (propose-only, ver [[eav7-ai-roadmap]]).

use std::collections::HashSet;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use eav7::config::{fees, MIN_ORACLE_STAKE, SYMBOL};
use eav7::transaction::Tx;

use crate::p2p::{make_client, HttpClient};
use crate::wallet::ProductionWallet;

use super::bridge::{build_ai_result_tx, build_oracle_register_tx, tx_to_json, AiResultParams};
use super::{
    anthropic_extract_text, anthropic_request_body, format_eav7, http_get_json, http_post_json,
    now_ms, LlmClient, ANTHROPIC_API_URL, DEFAULT_CLAUDE_MODEL,
};

// ---------------------------------------------------------------------------
// Visão de tarefa + lógica pura
// ---------------------------------------------------------------------------

/// Tarefa como o worker a enxerga em `/ai/tasks?status=PENDING` — os campos
/// que o `tick()` e os handlers do JS leem (worker.js:113-123, 15, 27).
#[derive(Debug, Clone, PartialEq)]
pub struct TaskView {
    pub id: String,
    pub prompt: String,
    /// Modelo pedido pelo solicitante; `None` usa [`DEFAULT_CLAUDE_MODEL`]
    /// (o `task.model || DEFAULT_CLAUDE_MODEL` de worker.js:27).
    pub model: Option<String>,
    /// Oráculo designado pela tarefa (`assignedOracle`).
    pub assigned_oracle: Option<String>,
}

/// Seleção PURA de tarefas — o filtro do `tick()` (worker.js:115-119):
/// só tarefas designadas a ESTE oráculo (o solicitante o escolheu) e que ainda
/// não tiveram resultado enviado (`submitted`).
pub fn select_tasks(
    tasks: &[TaskView],
    my_address: &str,
    submitted: &HashSet<String>,
) -> Vec<TaskView> {
    tasks
        .iter()
        .filter(|t| t.assigned_oracle.as_deref() == Some(my_address))
        .filter(|t| !submitted.contains(&t.id))
        .cloned()
        .collect()
}

/// Trunca em N CARACTERES — o `slice(0, n)` do JS conta unidades UTF-16;
/// contamos `char`s (pontos de código). Diverge apenas quando o texto tem
/// caracteres fora do BMP (emoji), e só no ponto de corte de um texto de LOG —
/// nunca em nada assinado.
fn truncar(texto: &str, n: usize) -> String {
    texto.chars().take(n).collect()
}

/// Eco local do handler default — worker.js:15: resposta simulada, sem rede.
pub fn local_echo_output(task: &TaskView) -> String {
    format!(
        "[oráculo-local EAV7] resposta simulada para a tarefa {}…: {}",
        truncar(&task.id, 12),
        truncar(&task.prompt, 500)
    )
}

/// Custo total do registro de oráculo — worker.js:101:
/// `MIN_ORACLE_STAKE + FEES.ORACLE_REGISTER`.
pub fn registration_cost() -> u128 {
    MIN_ORACLE_STAKE + fees::ORACLE_REGISTER
}

/// Checagem PURA de saldo para o registro (worker.js:102-106): a mensagem de
/// erro espelha a do JS, com `formatEav7` dos dois valores.
pub fn check_registration_balance(balance: u128) -> Result<(), String> {
    let custo = registration_cost();
    if balance < custo {
        return Err(format!(
            "carteira do oráculo precisa de {} {} para registro (saldo: {})",
            format_eav7(custo),
            SYMBOL,
            format_eav7(balance)
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Handler plugável (worker.js:13-40)
// ---------------------------------------------------------------------------

/// Futuro devolvido por um [`TaskHandler`] — boxed para o trait ser objeto.
pub type HandlerFuture<'a> = Pin<Box<dyn Future<Output = Result<String, String>> + Send + 'a>>;

/// Handler plugável de execução de tarefa — o parâmetro `handler` do
/// construtor do JS (worker.js:43). Recebe a tarefa, devolve o output.
pub trait TaskHandler: Send + Sync {
    fn handle<'a>(&'a self, task: &'a TaskView) -> HandlerFuture<'a>;
}

/// Handler default SEM chave da Anthropic: eco local (worker.js:14-16).
pub struct LocalEchoHandler;

impl TaskHandler for LocalEchoHandler {
    fn handle<'a>(&'a self, task: &'a TaskView) -> HandlerFuture<'a> {
        Box::pin(async move { Ok(local_echo_output(task)) })
    }
}

/// Handler que chama a API da Anthropic — `claudeHandler` (worker.js:18-40).
/// Mesma URL, mesmo modelo default, mesmos `max_tokens: 1024`. O POST em si
/// passa pelo [`LlmClient`] injetado (HTTPS — ver a decisão de TLS em
/// `ai/mod.rs`).
pub struct ClaudeHandler {
    pub api_key: String,
    pub llm: Arc<dyn LlmClient>,
}

impl TaskHandler for ClaudeHandler {
    fn handle<'a>(&'a self, task: &'a TaskView) -> HandlerFuture<'a> {
        Box::pin(async move {
            let modelo = task.model.as_deref().unwrap_or(DEFAULT_CLAUDE_MODEL);
            let corpo = anthropic_request_body(modelo, 1024, &task.prompt);
            let resposta = self
                .llm
                .post_json(ANTHROPIC_API_URL, &self.api_key, corpo, 60_000)
                .await?;
            Ok(anthropic_extract_text(&resposta))
        })
    }
}

// ---------------------------------------------------------------------------
// Transporte — AiOracleWorker
// ---------------------------------------------------------------------------

/// O worker de oráculo — a classe `AiOracleWorker` (worker.js:42-144).
pub struct AiOracleWorker {
    /// URL do nó, sem barra final (o `replace(/\/$/, '')` de worker.js:44).
    node_url: String,
    wallet: Arc<ProductionWallet>,
    /// Endereço E7 da carteira (`walletAddress(wallet)`, worker.js:46) —
    /// derivado uma vez no carregamento da `ProductionWallet`.
    address: String,
    handler: Arc<dyn TaskHandler>,
    poll_ms: u64,
    client: HttpClient,
    /// Tarefas com resultado já enviado, aguardando inclusão (worker.js:50).
    submitted: HashSet<String>,
    /// Próximo nonce reservado; `None` força ressincronizar via `/address`
    /// (worker.js:51, 80-90).
    next_nonce: Option<i64>,
}

impl AiOracleWorker {
    pub fn new(
        node_url: &str,
        wallet: Arc<ProductionWallet>,
        handler: Arc<dyn TaskHandler>,
        poll_ms: u64,
    ) -> Self {
        let address = wallet.address().to_string();
        AiOracleWorker {
            node_url: node_url.trim_end_matches('/').to_string(),
            wallet,
            address,
            handler,
            poll_ms,
            client: make_client(),
            submitted: HashSet::new(),
            next_nonce: None,
        }
    }

    fn log(&self, msg: &str) {
        println!("{msg}");
    }

    /// POST /tx — `#submitTx` (worker.js:62-72): em status fora de 2xx o erro
    /// é o `error` do corpo, senão `"nó respondeu N"`.
    async fn submeter_tx(&self, tx: &Tx) -> Result<(), String> {
        let (status, corpo) = http_post_json(
            &self.client,
            &format!("{}/tx", self.node_url),
            tx_to_json(tx),
            None,
            10_000,
        )
        .await?;
        if !(200..300).contains(&status) {
            return Err(corpo
                .get("error")
                .and_then(|e| e.as_str())
                .map(|e| e.to_string())
                .unwrap_or_else(|| format!("nó respondeu {status}")));
        }
        Ok(())
    }

    /// Reserva-de-nonce + submissão — `#send` (worker.js:77-95). Em QUALQUER
    /// erro (inclusive timeout/rede) o nonce é ressincronizado (`None`); a
    /// reserva usa o nonce ciente do mempool (`nextNonce` da API) para não
    /// colidir com txs pendentes. A serialização que o JS obtém com a fila
    /// `sendChain` aqui é estrutural: `&mut self`, uma task só.
    async fn enviar<F>(&mut self, montar: F) -> Result<Tx, String>
    where
        F: FnOnce(i64, i64) -> Result<Tx, String>,
    {
        let resultado = async {
            if self.next_nonce.is_none() {
                let conta = http_get_json(
                    &self.client,
                    &format!("{}/address/{}", self.node_url, self.address),
                    10_000,
                )
                .await?;
                // `account.nextNonce ?? account.nonce + 1` (worker.js:82).
                let proximo = conta
                    .get("nextNonce")
                    .and_then(|v| v.as_i64())
                    .or_else(|| conta.get("nonce").and_then(|v| v.as_i64()).map(|n| n + 1))
                    .ok_or_else(|| "resposta de /address sem nonce".to_string())?;
                self.next_nonce = Some(proximo);
            }
            let Some(nonce) = self.next_nonce else {
                return Err("nonce indisponível".to_string()); // inalcançável
            };
            // O timestamp é o `Date.now()` default de buildTransaction — o
            // transporte fornece o relógio, a lógica (bridge) fica pura.
            let tx = montar(nonce, now_ms())?;
            self.submeter_tx(&tx).await?;
            self.next_nonce = Some(nonce + 1);
            Ok(tx)
        }
        .await;
        if resultado.is_err() {
            self.next_nonce = None; // ressincroniza no próximo envio (worker.js:89)
        }
        resultado
    }

    /// `ensureRegistered` (worker.js:97-111): se este endereço ainda não é
    /// oráculo, confere o saldo e envia ORACLE_REGISTER com o stake mínimo.
    pub async fn ensure_registered(&mut self) -> Result<(), String> {
        let oraculos = http_get_json(
            &self.client,
            &format!("{}/ai/oracles", self.node_url),
            10_000,
        )
        .await?;
        let ja_registrado = oraculos
            .as_array()
            .map(|lista| {
                lista.iter().any(|o| {
                    o.get("address").and_then(|a| a.as_str()) == Some(self.address.as_str())
                })
            })
            .unwrap_or(false);
        if ja_registrado {
            return Ok(());
        }
        let conta = http_get_json(
            &self.client,
            &format!("{}/address/{}", self.node_url, self.address),
            10_000,
        )
        .await?;
        // `BigInt(account.balance)` aceita string ou número (worker.js:102).
        let saldo: u128 = match conta.get("balance") {
            Some(serde_json::Value::String(s)) => s.parse().unwrap_or(0),
            Some(v) => v.as_u64().unwrap_or(0) as u128,
            None => 0,
        };
        check_registration_balance(saldo)?;
        let carteira = self.wallet.clone();
        let tx = self
            .enviar(move |nonce, agora| {
                build_oracle_register_tx(carteira.as_ref(), MIN_ORACLE_STAKE, None, nonce, agora)
            })
            .await?;
        self.log(&format!(
            "[oráculo] registro enviado ({})",
            tx.id.as_deref().unwrap_or("?")
        ));
        Ok(())
    }

    /// Um ciclo — `tick()` (worker.js:113-130): busca as tarefas pendentes,
    /// executa as designadas a este oráculo e publica os resultados. Falha em
    /// UMA tarefa remove-a de `submitted` (nova tentativa no próximo ciclo) e
    /// não derruba o ciclo das demais.
    pub async fn tick(&mut self) -> Result<(), String> {
        let resposta = http_get_json(
            &self.client,
            &format!("{}/ai/tasks?status=PENDING", self.node_url),
            10_000,
        )
        .await?;
        let tarefas: Vec<TaskView> = resposta
            .as_array()
            .map(|lista| lista.iter().map(parse_task_view).collect())
            .unwrap_or_default();
        let escolhidas = select_tasks(&tarefas, &self.address, &self.submitted);
        for tarefa in escolhidas {
            self.submitted.insert(tarefa.id.clone());
            self.log(&format!("[oráculo] executando tarefa {}…", truncar(&tarefa.id, 16)));
            let resultado = {
                let handler = self.handler.clone();
                let saida = handler.handle(&tarefa).await;
                match saida {
                    Ok(saida) => {
                        let carteira = self.wallet.clone();
                        let task_id = tarefa.id.clone();
                        self.enviar(move |nonce, agora| {
                            build_ai_result_tx(
                                carteira.as_ref(),
                                AiResultParams {
                                    task_id,
                                    output: Some(saida),
                                    result_hash: None,
                                    result_uri: None,
                                    attestation: None,
                                    nonce,
                                    timestamp: agora,
                                },
                            )
                        })
                        .await
                    }
                    Err(e) => Err(e),
                }
            };
            match resultado {
                Ok(tx) => self.log(&format!(
                    "[oráculo] resultado publicado para {}… (tx {}…)",
                    truncar(&tarefa.id, 16),
                    truncar(tx.id.as_deref().unwrap_or("?"), 16)
                )),
                Err(e) => {
                    // Permite nova tentativa no próximo ciclo (worker.js:126).
                    self.submitted.remove(&tarefa.id);
                    self.log(&format!(
                        "[oráculo] falha na tarefa {}…: {e}",
                        truncar(&tarefa.id, 16)
                    ));
                }
            }
        }
        Ok(())
    }

    /// `start()` (worker.js:132-138): registra-se e entra no laço periódico.
    /// Como no JS, falha no REGISTRO aborta o start (o `await` rejeitaria);
    /// erro de ciclo é logado e o laço continua.
    ///
    /// O worker sobe *antes* do bind HTTP do próprio nó — por isso o registo
    /// tenta de novo com backoff até a API local responder (até ~2 min).
    pub async fn run(mut self) -> Result<(), String> {
        let mut delay = Duration::from_millis(200);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
        loop {
            match self.ensure_registered().await {
                Ok(()) => break,
                Err(e) => {
                    if tokio::time::Instant::now() >= deadline {
                        return Err(e);
                    }
                    self.log(&format!("[oráculo] aguardando API local ({e})"));
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(Duration::from_secs(2));
                }
            }
        }
        self.log(&format!(
            "[oráculo] ativo em {} como {}",
            self.node_url, self.address
        ));
        let mut intervalo = tokio::time::interval(Duration::from_millis(self.poll_ms));
        intervalo.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            intervalo.tick().await;
            if let Err(e) = self.tick().await {
                self.log(&format!("[oráculo] erro no ciclo: {e}"));
            }
        }
    }

    /// Conveniência: `run()` numa task própria, com o erro de registro logado.
    pub fn start(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            if let Err(e) = self.run().await {
                eprintln!("[oráculo] falha ao iniciar: {e}");
            }
        })
    }
}

/// JSON de `/ai/tasks` → [`TaskView`] — leitura leniente de apresentação.
fn parse_task_view(v: &serde_json::Value) -> TaskView {
    let texto = |campo: &str| {
        v.get(campo).and_then(|x| x.as_str()).unwrap_or_default().to_string()
    };
    TaskView {
        id: texto("id"),
        prompt: texto("prompt"),
        model: v.get("model").and_then(|m| m.as_str()).map(|s| s.to_string()),
        assigned_oracle: v
            .get("assignedOracle")
            .and_then(|a| a.as_str())
            .map(|s| s.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Testes — a lógica de seleção/decisão é pura; async só no handler default.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn tarefa(id: &str, designado: Option<&str>) -> TaskView {
        TaskView {
            id: id.to_string(),
            prompt: "pergunta".to_string(),
            model: None,
            assigned_oracle: designado.map(|s| s.to_string()),
        }
    }

    #[test]
    fn seleciona_so_tarefas_designadas_a_mim_e_nao_submetidas() {
        // worker.js:115-119: só processa tarefas designadas a este oráculo e
        // ainda não submetidas.
        let minhas = "E7EU";
        let tarefas = vec![
            tarefa("t1", Some(minhas)),      // minha, nova → entra
            tarefa("t2", Some("E7OUTRO")),   // de outro → fora
            tarefa("t3", None),              // sem designado (aberta/quórum) → fora
            tarefa("t4", Some(minhas)),      // minha, já submetida → fora
        ];
        let mut submetidas = HashSet::new();
        submetidas.insert("t4".to_string());
        let escolhidas = select_tasks(&tarefas, minhas, &submetidas);
        assert_eq!(escolhidas.len(), 1);
        assert_eq!(escolhidas[0].id, "t1");
        // Sem nada submetido, t1 e t4 entram — a ordem da lista é preservada.
        let escolhidas = select_tasks(&tarefas, minhas, &HashSet::new());
        assert_eq!(
            escolhidas.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            vec!["t1", "t4"]
        );
    }

    #[test]
    fn eco_local_trunca_id_em_12_e_prompt_em_500() {
        // worker.js:15: `task.id.slice(0, 12)` + `task.prompt.slice(0, 500)`.
        let mut t = tarefa(&"a".repeat(64), Some("E7EU"));
        t.prompt = "p".repeat(600);
        let eco = local_echo_output(&t);
        assert!(eco.starts_with("[oráculo-local EAV7] resposta simulada para a tarefa "));
        assert!(eco.contains(&format!("{}…", "a".repeat(12))));
        assert!(!eco.contains(&"a".repeat(13)), "id não pode passar de 12 chars");
        assert!(eco.ends_with(&"p".repeat(500)));
        assert!(!eco.contains(&"p".repeat(501)), "prompt não pode passar de 500 chars");
    }

    #[test]
    fn custo_de_registro_e_stake_mais_taxa() {
        // worker.js:101: MIN_ORACLE_STAKE (500 EAV7) + FEES.ORACLE_REGISTER.
        assert_eq!(registration_cost(), 500_000_000 + 10_000);
        // Um e7 abaixo do custo: erro com a MESMA mensagem do JS.
        let erro = check_registration_balance(registration_cost() - 1)
            .expect_err("saldo insuficiente tem de falhar");
        assert!(erro.contains("carteira do oráculo precisa de 500.01 EAV7"), "{erro}");
        assert!(erro.contains("saldo: 500.009999"), "{erro}");
        // No custo exato: passa (o JS usa `<` estrito).
        assert_eq!(check_registration_balance(registration_cost()), Ok(()));
    }

    #[tokio::test]
    async fn handler_default_e_o_eco_local() {
        // worker.js:13-16 sem ANTHROPIC_API_KEY: eco, nunca rede.
        let t = tarefa("abcdef123456789", Some("E7EU"));
        let saida = LocalEchoHandler.handle(&t).await.expect("eco nunca falha");
        assert_eq!(saida, local_echo_output(&t));
    }

    #[test]
    fn parse_task_view_le_os_campos_do_no() {
        let v = serde_json::json!({
            "id": "t1", "prompt": "oi", "model": "claude-sonnet-5",
            "assignedOracle": "E7EU", "reward": "1000",
        });
        let t = parse_task_view(&v);
        assert_eq!(t.id, "t1");
        assert_eq!(t.prompt, "oi");
        assert_eq!(t.model.as_deref(), Some("claude-sonnet-5"));
        assert_eq!(t.assigned_oracle.as_deref(), Some("E7EU"));
        // Campos ausentes degradam para default, sem pânico.
        let t = parse_task_view(&serde_json::json!({}));
        assert_eq!(t.id, "");
        assert_eq!(t.assigned_oracle, None);
    }
}
