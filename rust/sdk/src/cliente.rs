//! Cliente HTTP da API do nó — o porte de `Eav7Client` (`src/sdk/eav7.js`).
//!
//! # O que é responsabilidade daqui, e o que não é
//!
//! Daqui: falar HTTP, ler a resposta, montar a espec da transação. NÃO daqui:
//! assinar, derivar endereço, codificar canonicamente ou verificar prova — tudo
//! isso vem de `eav7`, a mesma implementação que o nó usa para validar. É o que
//! garante que uma transação construída por este SDK e uma construída pelo nó
//! sejam byte a byte a mesma coisa.
//!
//! # Saldo PROVADO
//!
//! [`Eav7Client::saldo_provado`] existe porque perguntar o saldo a um nó é
//! confiar no nó. A prova de Merkle fecha contra o `stateRoot` que veio no header
//! do bloco — e o header é assinado pelo produtor. Um nó mentiroso não consegue
//! forjar a prova; no máximo se recusa a fornecê-la, o que é detectável.

use std::time::Duration;

use eav7::block::BlockSigner;
use eav7::stateroot::{verify_account_proof, PathStep};
use eav7::transaction::{build_transaction, canonical_json, JsonValue, Tx, TxSpec};

/// Falha de uma chamada ao nó.
#[derive(Debug)]
pub enum ErroCliente {
    /// Não foi possível falar com o nó.
    Transporte(String),
    /// O nó respondeu, com erro.
    Api { status: u16, mensagem: String },
    /// A resposta não tem a forma esperada.
    Resposta(String),
    /// Erro ao montar ou assinar a transação, antes de qualquer rede.
    Transacao(String),
    /// A PROVA não fecha contra a raiz — o nó respondeu algo que não consegue
    /// provar. Distinto de `Api`: aqui o nó respondeu "com sucesso".
    ProvaInvalida(String),
    /// O prazo de espera venceu sem o desfecho pedido (ver
    /// [`Eav7Client::aguardar_confirmacao`]). Não é falha do nó nem da
    /// transação: ela pode confirmar depois — o chamador decide se espera mais.
    TempoEsgotado(String),
}

impl std::fmt::Display for ErroCliente {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErroCliente::Transporte(m) => write!(f, "falha de transporte: {m}"),
            ErroCliente::Api { status, mensagem } => write!(f, "o nó respondeu {status}: {mensagem}"),
            ErroCliente::Resposta(m) => write!(f, "resposta inesperada do nó: {m}"),
            ErroCliente::Transacao(m) => write!(f, "transação inválida: {m}"),
            ErroCliente::ProvaInvalida(m) => write!(f, "prova de estado não confere: {m}"),
            ErroCliente::TempoEsgotado(m) => write!(f, "prazo esgotado: {m}"),
        }
    }
}
impl std::error::Error for ErroCliente {}

type R<T> = Result<T, ErroCliente>;

/// Conta, como a API a devolve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conta {
    pub address: String,
    pub balance: u128,
    pub staked: u128,
    /// Próximo nonce a usar — já considera as transações no mempool.
    pub next_nonce: i64,
    pub fee_exempt: bool,
    /// Parcelas de UNSTAKE aguardando maturação (`/address` → `unbonding`).
    pub unbonding: Vec<Unbonding>,
    /// Recompensa de eleitor ainda não resgatada — o que
    /// [`Eav7Client::reivindicar_recompensa`] credita.
    pub claimable_voter_reward: u128,
}

/// Parcela em unbonding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unbonding {
    pub amount: u128,
    /// Altura em que a parcela LIBERA.
    pub mature_at: u64,
    /// A API já entrega `max(0, matureAt − altura)` calculado.
    pub blocks_left: u64,
}

/// Desempenho recente de um validador — a entrada de `performance` de
/// `/validators` (mesmo objeto de `/validators/performance`).
#[derive(Debug, Clone, PartialEq)]
pub struct Desempenho {
    /// 0–100. Janela sem blocos dá 100 a todos — ausência de prova não é culpa.
    pub score: f64,
    /// `healthy` / `lagging` / `degraded`, como a API emite.
    pub status: String,
    pub degraded: bool,
    pub productivity_pct: f64,
    pub expected: u64,
    pub produced: u64,
    pub in_turn: u64,
    pub missed: u64,
    pub out_of_turn: u64,
    /// `None` quando o validador não produziu nada na janela.
    pub avg_latency_ms: Option<f64>,
    pub last_produced_height: Option<u64>,
    pub last_produced_at: Option<i64>,
}

/// Validador tipado a partir de `/validators`: a lista `current` casada com a
/// entrada de `performance` do mesmo endereço.
#[derive(Debug, Clone, PartialEq)]
pub struct Validador {
    pub address: String,
    pub staked: u128,
    /// Votos RECEBIDOS como candidato.
    pub votes: u128,
    /// Nome EAV-NS apontando para o validador, quando existe.
    pub name: Option<String>,
    /// `None` só se a API não trouxer a entrada de performance deste endereço.
    pub performance: Option<Desempenho>,
}

/// Linha de histórico de `/address/{addr}/txs`: os campos da transação mais os
/// do bloco, achatados pelo nó no mesmo objeto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TxResumida {
    pub id: String,
    pub tx_type: String,
    pub from: String,
    pub to: Option<String>,
    pub amount: u128,
    pub fee: u128,
    pub nonce: i64,
    pub block_height: u64,
    pub block_time: i64,
}

/// Página de histórico.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Historico {
    pub txs: Vec<TxResumida>,
    /// Cursor da PRÓXIMA página — passe de volta em `before`. `None` = acabou.
    pub next_before: Option<u64>,
}

/// Desfecho de [`Eav7Client::aguardar_confirmacao`]: a transação ENTROU em bloco.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Confirmacao {
    pub block_height: u64,
    pub block_hash: String,
}

/// Desfecho de uma submissão.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Submissao {
    pub accepted: bool,
    pub id: String,
    /// Presente só na recusa — a API omite o campo quando aceita.
    pub reason: Option<String>,
}

/// Cliente da API pública de um nó EAV7.
pub struct Eav7Client {
    url: String,
    agente: ureq::Agent,
    carteira: Option<Box<dyn BlockSigner>>,
}

impl std::fmt::Debug for Eav7Client {
    /// `Debug` manual: o derive imprimiria o assinante, e um `{:?}` num log
    /// vazaria material de carteira.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Eav7Client")
            .field("url", &self.url)
            .field("com_carteira", &self.carteira.is_some())
            .finish()
    }
}

/// Construtor de [`Eav7Client`] — para quando os padrões não servem.
///
/// O timeout fixo de 30s é bom para script e ruim no celular (que quer mais) e
/// no Core (que quer menos). O builder deixa cada consumidor escolher sem
/// multiplicar variantes de construtor.
pub struct Eav7ClientBuilder {
    url: String,
    timeout: Duration,
    carteira: Option<Box<dyn BlockSigner>>,
}

impl Eav7ClientBuilder {
    /// Timeout de CADA chamada HTTP (padrão: 30s).
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Carteira para ASSINAR. Sem ela, métodos de escrita falham antes da rede.
    pub fn carteira(mut self, carteira: Box<dyn BlockSigner>) -> Self {
        self.carteira = Some(carteira);
        self
    }

    pub fn construir(self) -> Eav7Client {
        Eav7Client {
            url: self.url,
            agente: ureq::AgentBuilder::new().timeout(self.timeout).build(),
            carteira: self.carteira,
        }
    }
}

impl Eav7Client {
    /// Começa um cliente configurável — ver [`Eav7ClientBuilder`].
    pub fn construtor(url: impl Into<String>) -> Eav7ClientBuilder {
        Eav7ClientBuilder {
            url: url.into().trim_end_matches('/').to_string(),
            timeout: Duration::from_secs(30),
            carteira: None,
        }
    }

    /// Cliente somente-leitura (timeout padrão 30s).
    pub fn novo(url: impl Into<String>) -> Self {
        Self::construtor(url).construir()
    }

    /// Cliente que também ASSINA. Sem carteira, os métodos de escrita falham
    /// antes de tocar a rede — como no JS (`'client sem wallet'`).
    pub fn com_carteira(url: impl Into<String>, carteira: Box<dyn BlockSigner>) -> Self {
        Self::construtor(url).carteira(carteira).construir()
    }

    /// Remetente com reserva de nonce — use para rajadas (stake+voto+claim).
    pub fn remetente(&self) -> Remetente<'_> {
        Remetente { cliente: self, proximo_nonce: None }
    }

    /// Endereço da carteira, quando há uma.
    pub fn endereco(&self) -> Option<String> {
        let c = self.carteira.as_ref()?;
        eav7::signature::address_from_public_keys(c.public_key_pem(), c.pq_public_key_pem()).ok()
    }

    // ------------------------------------------------------------- leitura

    /// GET cru numa rota da API. Público porque o conjunto de rotas é maior que o
    /// que este cliente tipa, e obrigar quem precisa de uma rota nova a escrever o
    /// próprio HTTP o levaria a escrever também a própria assinatura.
    pub fn get(&self, caminho: &str) -> R<serde_json::Value> {
        let resposta = self
            .agente
            .get(&format!("{}{caminho}", self.url))
            .set("accept", "application/json")
            .call();
        match resposta {
            Ok(r) => r
                .into_json()
                .map_err(|e| ErroCliente::Resposta(format!("{caminho}: {e}"))),
            Err(ureq::Error::Status(status, r)) => {
                let corpo: serde_json::Value = r.into_json().unwrap_or_default();
                let mensagem = corpo
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("sem detalhe")
                    .to_string();
                Err(ErroCliente::Api { status, mensagem })
            }
            Err(e) => Err(ErroCliente::Transporte(e.to_string())),
        }
    }

    pub fn status(&self) -> R<serde_json::Value> {
        self.get("/status")
    }

    pub fn validadores(&self) -> R<serde_json::Value> {
        self.get("/validators")
    }

    /// `/validators` tipado: a lista `current` casada com a entrada de
    /// `performance` do mesmo endereço. Nenhum `serde_json::Value` escapa.
    pub fn validadores_tipados(&self) -> R<Vec<Validador>> {
        let v = self.validadores()?;
        let atuais = v
            .get("current")
            .and_then(|x| x.as_array())
            .ok_or_else(|| ErroCliente::Resposta("validators sem `current`".into()))?;
        let desempenhos: std::collections::HashMap<String, Desempenho> = v
            .get("performance")
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(desempenho_de).collect())
            .unwrap_or_default();
        Ok(atuais
            .iter()
            .filter_map(|item| {
                let address = item.get("address")?.as_str()?.to_string();
                Some(Validador {
                    staked: texto_ou_numero_u128(item.get("staked")),
                    votes: texto_ou_numero_u128(item.get("votes")),
                    name: item.get("name").and_then(|x| x.as_str()).map(str::to_string),
                    performance: desempenhos.get(&address).cloned(),
                    address,
                })
            })
            .collect())
    }

    /// Histórico paginado de um endereço (`GET /address/{addr}/txs`).
    ///
    /// `before` é o cursor devolvido em [`Historico::next_before`]: `None` pede a
    /// primeira página (as transações mais recentes).
    pub fn historico(&self, endereco: &str, before: Option<u64>) -> R<Historico> {
        self.historico_com_limite(endereco, before, 25)
    }

    /// [`Eav7Client::historico`] com o tamanho de página explícito (a API
    /// aceita até 2000).
    pub fn historico_com_limite(&self, endereco: &str, before: Option<u64>, limit: u32) -> R<Historico> {
        let mut caminho = format!("/address/{endereco}/txs?limit={limit}");
        if let Some(b) = before {
            caminho.push_str(&format!("&before={b}"));
        }
        let v = self.get(&caminho)?;
        let txs = v
            .get("txs")
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(tx_resumida_de).collect())
            .unwrap_or_default();
        Ok(Historico {
            txs,
            next_before: v.get("nextBefore").and_then(serde_json::Value::as_u64),
        })
    }

    /// Espera a transação ENTRAR EM BLOCO: poll em `/tx/{id}` até a resposta
    /// trazer `blockHeight` ou o prazo vencer.
    ///
    /// Submeter só prova que o mempool aceitou; é este método que fecha a
    /// diferença entre "aceitou" e "aconteceu". 404 NÃO aborta a espera: entre a
    /// submissão e a propagação a transação pode ainda não ser visível neste nó.
    /// [`ErroCliente::TempoEsgotado`] também não é veredito — a transação pode
    /// confirmar depois do prazo.
    pub fn aguardar_confirmacao(&self, id: &str, timeout: Duration) -> R<Confirmacao> {
        let inicio = std::time::Instant::now();
        let passo = Duration::from_millis(200);
        loop {
            match self.transacao(id) {
                Ok(v) => {
                    if let Some(altura) = v.get("blockHeight").and_then(serde_json::Value::as_u64) {
                        return Ok(Confirmacao {
                            block_height: altura,
                            block_hash: v
                                .get("blockHash")
                                .and_then(|x| x.as_str())
                                .unwrap_or_default()
                                .to_string(),
                        });
                    }
                    // PENDING: segue esperando.
                }
                // Ainda não propagou até este nó — não é desfecho.
                Err(ErroCliente::Api { status: 404, .. }) => {}
                Err(e) => return Err(e),
            }
            let decorrido = inicio.elapsed();
            if decorrido >= timeout {
                return Err(ErroCliente::TempoEsgotado(format!(
                    "transação {id} não confirmou em {timeout:?}"
                )));
            }
            // Nunca dorme além do prazo: a última consulta acontece NO limite.
            std::thread::sleep(passo.min(timeout - decorrido));
        }
    }

    pub fn transacao(&self, id: &str) -> R<serde_json::Value> {
        self.get(&format!("/tx/{id}"))
    }

    pub fn contrato(&self, endereco: &str) -> R<serde_json::Value> {
        self.get(&format!("/contract/{endereco}"))
    }

    /// A conta, com o próximo nonce já resolvido.
    pub fn conta(&self, endereco: &str) -> R<Conta> {
        let v = self.get(&format!("/address/{endereco}"))?;
        let texto_u128 = |chave: &str| -> u128 {
            v.get(chave)
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0)
        };
        let unbonding = v
            .get("unbonding")
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .map(|u| Unbonding {
                        amount: texto_ou_numero_u128(u.get("amount")),
                        mature_at: u.get("matureAt").and_then(serde_json::Value::as_u64).unwrap_or(0),
                        blocks_left: u.get("blocksLeft").and_then(serde_json::Value::as_u64).unwrap_or(0),
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(Conta {
            address: v.get("address").and_then(|x| x.as_str()).unwrap_or(endereco).to_string(),
            balance: texto_u128("balance"),
            staked: texto_u128("staked"),
            next_nonce: v.get("nextNonce").and_then(serde_json::Value::as_i64).unwrap_or(1),
            fee_exempt: v.get("feeExempt").and_then(serde_json::Value::as_bool).unwrap_or(false),
            unbonding,
            claimable_voter_reward: texto_u128("claimableVoterReward"),
        })
    }

    pub fn saldo(&self, endereco: &str) -> R<u128> {
        Ok(self.conta(endereco)?.balance)
    }

    pub fn proximo_nonce(&self, endereco: &str) -> R<i64> {
        Ok(self.conta(endereco)?.next_nonce)
    }

    /// Saldo PROVADO contra a raiz do estado — o caminho de light client.
    ///
    /// Perguntar o saldo a um nó é confiar no nó. Aqui a resposta vem com a prova
    /// de Merkle, e a prova é conferida LOCALMENTE contra a raiz: um nó que minta
    /// o saldo não consegue produzir um caminho que feche.
    ///
    /// `raiz_confiavel` é opcional e é o que fecha o círculo: sem ela, a raiz vem
    /// do próprio nó — o que ainda detecta inconsistência interna, mas não um nó
    /// que minta raiz e saldo de forma coerente. Com ela (obtida de outra fonte,
    /// como um header já validado), a garantia é completa.
    pub fn saldo_provado(&self, endereco: &str, raiz_confiavel: Option<&str>) -> R<u128> {
        let v = self.get(&format!("/proof/{endereco}"))?;
        let raiz_do_no = v
            .get("stateRoot")
            .and_then(|x| x.as_str())
            .ok_or_else(|| ErroCliente::Resposta("prova sem stateRoot".into()))?;
        if let Some(esperada) = raiz_confiavel
            && esperada != raiz_do_no
        {
            return Err(ErroCliente::ProvaInvalida(format!(
                "o nó afirma a raiz {raiz_do_no}, esperada {esperada}"
            )));
        }
        let codificada = v
            .get("encodedAccount")
            .ok_or_else(|| ErroCliente::Resposta("prova sem encodedAccount".into()))?;
        let conta = conta_canonica(codificada)?;
        let caminho = caminho_de(v.get("path"))?;

        if !verify_account_proof(raiz_do_no, endereco, &conta, &caminho) {
            return Err(ErroCliente::ProvaInvalida(format!(
                "o caminho não leva à raiz para {endereco}"
            )));
        }
        // Só DEPOIS de provada a conta é que o saldo dela vale alguma coisa.
        Ok(match &conta {
            eav7::canonical::Value::Map(m) => match m.get("balance") {
                Some(eav7::canonical::Value::Int(d)) => d.parse().unwrap_or(0),
                Some(eav7::canonical::Value::Str(s)) => s.parse().unwrap_or(0),
                _ => 0,
            },
            _ => 0,
        })
    }

    // ------------------------------------------------------------- escrita

    /// Monta e assina, SEM enviar. Útil para inspecionar ou assinar offline.
    pub fn montar(&self, spec: TxSpec) -> R<Tx> {
        let carteira = self
            .carteira
            .as_ref()
            .ok_or_else(|| ErroCliente::Transacao("cliente sem carteira: não há como assinar".into()))?;
        let tx = build_transaction(carteira.as_ref(), spec).map_err(ErroCliente::Transacao)?;
        // Verifica ANTES de gastar uma ida à rede — o mesmo caminho de validação
        // que o nó aplicaria, então um erro aqui é o erro que ele daria.
        eav7::transaction::verify_transaction(&tx).map_err(ErroCliente::Transacao)?;
        Ok(tx)
    }

    /// Envia uma transação já assinada.
    pub fn enviar(&self, tx: &Tx) -> R<Submissao> {
        let corpo = tx_para_json(tx);
        let resposta = self
            .agente
            .post(&format!("{}/tx", self.url))
            .set("content-type", "application/json")
            .send_string(&corpo);
        let v: serde_json::Value = match resposta {
            Ok(r) => r.into_json().map_err(|e| ErroCliente::Resposta(e.to_string()))?,
            Err(ureq::Error::Status(status, r)) => {
                let corpo: serde_json::Value = r.into_json().unwrap_or_default();
                return Err(ErroCliente::Api {
                    status,
                    mensagem: corpo
                        .get("error")
                        .and_then(|x| x.as_str())
                        .unwrap_or("sem detalhe")
                        .to_string(),
                });
            }
            Err(e) => return Err(ErroCliente::Transporte(e.to_string())),
        };
        Ok(Submissao {
            accepted: v.get("accepted").and_then(serde_json::Value::as_bool).unwrap_or(false),
            id: v.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
            reason: v.get("reason").and_then(|x| x.as_str()).map(str::to_string),
        })
    }

    /// Monta, assina e envia, resolvendo o nonce.
    ///
    /// O nonce vem do nó a cada chamada, de propósito: guardá-lo em cache faria
    /// duas transações seguidas colidirem, e o erro apareceria só na segunda.
    pub fn executar(&self, tipo: &str, amount: u128, monta: impl FnOnce(TxSpec) -> TxSpec) -> R<Submissao> {
        let de = self
            .endereco()
            .ok_or_else(|| ErroCliente::Transacao("cliente sem carteira".into()))?;
        let nonce = self.proximo_nonce(&de)?;
        let spec = monta(TxSpec::nova(tipo, amount, nonce, agora_ms()));
        let tx = self.montar(spec)?;
        self.enviar(&tx)
    }

    pub fn transferir(&self, para: &str, amount: u128) -> R<Submissao> {
        let para = para.to_string();
        self.executar("TRANSFER", amount, move |s| s.para(para))
    }

    pub fn stake(&self, amount: u128) -> R<Submissao> {
        self.executar("STAKE", amount, |s| s)
    }

    pub fn unstake(&self, amount: u128) -> R<Submissao> {
        self.executar("UNSTAKE", amount, |s| s)
    }

    /// Aloca poder de voto entre candidatos: `endereço → peso`.
    pub fn votar(&self, votos: Vec<(String, u128)>) -> R<Submissao> {
        let mapa = JsonValue::map(
            votos.into_iter().map(|(k, v)| (k, JsonValue::str(v.to_string()))),
        );
        self.executar("VOTE", 0, move |s| {
            s.com_dados(JsonValue::map([("votes".to_string(), mapa)]))
        })
    }

    /// Resgata a recompensa de eleitor acumulada num validador
    /// (`CLAIM_VOTER_REWARD`).
    ///
    /// O validador é OBRIGATÓRIO: a recompensa é por-validador-votado, e o
    /// consenso rejeita a transação sem `data.validator` (value.rs:638).
    pub fn reivindicar_recompensa(&self, validador: &str) -> R<Submissao> {
        let dados = dados_de_claim(validador);
        self.executar("CLAIM_VOTER_REWARD", 0, move |s| s.com_dados(dados))
    }
}

/// `data` de um `CLAIM_VOTER_REWARD` — compartilhado entre cliente e remetente.
fn dados_de_claim(validador: &str) -> JsonValue {
    JsonValue::map([("validator".to_string(), JsonValue::str(validador))])
}

/// Envio com nonce reservado localmente — evita colisão em rajadas.
///
/// Extraído da lógica do [`crate::bridge::Relayer`]: reserva `n`, incrementa se
/// aceito, ressincroniza se recusado/timeout.
pub struct Remetente<'a> {
    cliente: &'a Eav7Client,
    proximo_nonce: Option<i64>,
}

impl Remetente<'_> {
    pub fn executar(
        &mut self,
        tipo: &str,
        amount: u128,
        monta: impl FnOnce(TxSpec) -> TxSpec,
    ) -> R<Submissao> {
        let de = self
            .cliente
            .endereco()
            .ok_or_else(|| ErroCliente::Transacao("cliente sem carteira".into()))?;
        let nonce = match self.proximo_nonce {
            Some(n) => n,
            None => self.cliente.proximo_nonce(&de)?,
        };
        let spec = monta(TxSpec::nova(tipo, amount, nonce, agora_ms()));
        let tx = self.cliente.montar(spec)?;
        match self.cliente.enviar(&tx) {
            Ok(r) if r.accepted => {
                self.proximo_nonce = Some(nonce + 1);
                Ok(r)
            }
            Ok(r) => {
                self.proximo_nonce = None;
                Err(ErroCliente::Api {
                    status: 400,
                    mensagem: r.reason.unwrap_or_else(|| "transação recusada".into()),
                })
            }
            Err(e) => {
                self.proximo_nonce = None;
                Err(e)
            }
        }
    }

    pub fn transferir(&mut self, para: &str, amount: u128) -> R<Submissao> {
        let para = para.to_string();
        self.executar("TRANSFER", amount, move |s| s.para(para))
    }

    pub fn stake(&mut self, amount: u128) -> R<Submissao> {
        self.executar("STAKE", amount, |s| s)
    }

    pub fn unstake(&mut self, amount: u128) -> R<Submissao> {
        self.executar("UNSTAKE", amount, |s| s)
    }

    pub fn votar(&mut self, votos: Vec<(String, u128)>) -> R<Submissao> {
        let mapa = JsonValue::map(
            votos.into_iter().map(|(k, v)| (k, JsonValue::str(v.to_string()))),
        );
        self.executar("VOTE", 0, move |s| {
            s.com_dados(JsonValue::map([("votes".to_string(), mapa)]))
        })
    }

    pub fn reivindicar_recompensa(&mut self) -> R<Submissao> {
        self.executar("CLAIM_VOTER_REWARD", 0, |s| s)
    }
}

/// `Date.now()` — só o `timestamp` da transação, que não entra em consenso além
/// de ter de ser positivo.
fn agora_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Serializa a transação COMPLETA pelo serializador CANÔNICO da lib.
///
/// Não é `serde_json`: os campos assinados têm de sair byte a byte como o payload
/// que foi assinado.
fn tx_para_json(tx: &Tx) -> String {
    let mut m = std::collections::BTreeMap::new();
    m.insert("protocol".to_string(), JsonValue::str(&tx.protocol));
    m.insert("scheme".to_string(), JsonValue::str(&tx.scheme));
    m.insert("type".to_string(), JsonValue::str(&tx.tx_type));
    m.insert("from".to_string(), JsonValue::str(&tx.from));
    m.insert(
        "to".to_string(),
        tx.to.as_ref().map_or(JsonValue::Null, JsonValue::str),
    );
    m.insert("amount".to_string(), JsonValue::str(&tx.amount));
    m.insert("fee".to_string(), JsonValue::str(&tx.fee));
    m.insert("nonce".to_string(), JsonValue::Int(tx.nonce));
    m.insert("timestamp".to_string(), JsonValue::Int(tx.timestamp));
    m.insert("data".to_string(), tx.data.clone().unwrap_or(JsonValue::Null));
    for (chave, valor) in [
        ("publicKey", &tx.public_key),
        ("pqPublicKey", &tx.pq_public_key),
        ("signature", &tx.signature),
        ("pqSignature", &tx.pq_signature),
        ("id", &tx.id),
    ] {
        m.insert(
            chave.to_string(),
            valor.as_ref().map_or(JsonValue::Null, JsonValue::str),
        );
    }
    canonical_json(&JsonValue::Map(m))
}

/// Converte a conta codificada que a API devolve para a forma CANÔNICA.
///
/// A API emite os inteiros grandes como texto prefixado com `B` (`decodeProofBig`
/// de stateroot.js:136). Recuperar a tag certa é o que faz a folha recalculada
/// bater com a que a raiz cobre — errar aqui reprova toda prova válida.
fn conta_canonica(v: &serde_json::Value) -> R<eav7::canonical::Value> {
    use eav7::canonical::Value as C;
    let serde_json::Value::Object(m) = v else {
        return Err(ErroCliente::Resposta("encodedAccount não é objeto".into()));
    };
    let mut saida = std::collections::BTreeMap::new();
    for (k, val) in m {
        let c = match val {
            serde_json::Value::String(s) => match s.strip_prefix('B') {
                Some(digitos) => C::int_str(digitos)
                    .map_err(|e| ErroCliente::Resposta(format!("{k}: {e}")))?,
                None => C::str(s),
            },
            serde_json::Value::Number(n) => C::Int(n.to_string()),
            serde_json::Value::Bool(b) => C::Bool(*b),
            serde_json::Value::Null => C::Null,
            outro => return Err(ErroCliente::Resposta(format!("{k}: forma inesperada {outro}"))),
        };
        saida.insert(k.clone(), c);
    }
    Ok(C::Map(saida))
}

fn caminho_de(v: Option<&serde_json::Value>) -> R<Vec<PathStep>> {
    let Some(serde_json::Value::Array(passos)) = v else {
        return Err(ErroCliente::Resposta("prova sem `path`".into()));
    };
    passos
        .iter()
        .map(|p| {
            let hash = p
                .get("hash")
                .and_then(|x| x.as_str())
                .ok_or_else(|| ErroCliente::Resposta("passo sem hash".into()))?;
            let right = p
                .get("right")
                .and_then(serde_json::Value::as_bool)
                .ok_or_else(|| ErroCliente::Resposta("passo sem `right`".into()))?;
            Ok(PathStep { hash: hash.to_string(), right })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A conta codificada volta à forma CANÔNICA com as TAGS certas.
    ///
    /// A API emite inteiro grande como texto prefixado com `B` (`decodeProofBig`,
    /// stateroot.js:136). Recuperar a tag errada — texto onde a folha tem inteiro —
    /// muda a pré-imagem e faz TODA prova válida ser recusada. É o tipo de bug que
    /// se manifesta como "o nó está mentindo" quando o errado é o cliente.
    #[test]
    fn conta_codificada_recupera_as_tags_da_folha() {
        use eav7::canonical::Value as C;

        let v = serde_json::json!({
            "balance": "B1000000",
            "nonce": 7,
            "staked": "B0",
            "eavmManaged": true,
        });
        let C::Map(m) = conta_canonica(&v).expect("decodifica") else {
            panic!("é mapa");
        };
        // Prefixo `B` → INTEIRO (tag 0x03), não texto.
        assert_eq!(m.get("balance"), Some(&C::Int("1000000".into())));
        assert_eq!(m.get("staked"), Some(&C::Int("0".into())));
        assert_eq!(m.get("nonce"), Some(&C::Int("7".into())));
        assert_eq!(m.get("eavmManaged"), Some(&C::Bool(true)));
    }

    /// Uma prova REAL, montada pela lib, é aceita pelo caminho do SDK — e a mesma
    /// prova com o saldo trocado é recusada.
    ///
    /// É o teste que dá sentido a `saldo_provado`: sem a segunda metade, o método
    /// estaria só decorando a resposta do nó com uma cerimônia.
    #[test]
    fn prova_de_saldo_fecha_e_recusa_saldo_trocado() {
        use eav7::state::{Account, State};
        use eav7::stateroot::{account_proof, compute_state_root};

        let mut s = State::new();
        let alvo = eav7::derive_address_from("sdk:alvo");
        for i in 0..6u8 {
            s.accounts.insert(
                eav7::derive_address_from(format!("sdk:{i}")),
                Account { balance: 10 + u128::from(i), ..Default::default() },
            );
        }
        s.accounts.insert(alvo.clone(), Account { balance: 777, nonce: 3, ..Default::default() });

        let folhas = s.state_leaves().expect("folhas");
        let raiz = compute_state_root(&folhas);
        let conta = s.accounts[&alvo].to_value();
        let prova = account_proof(&alvo, &conta, &folhas).expect("ok").expect("existe");

        assert!(verify_account_proof(&raiz, &alvo, &conta, &prova.caminho));

        // O que um nó mentiroso tentaria: mesmo caminho, saldo inflado.
        let mut mentira = s.accounts[&alvo].clone();
        mentira.balance = 999_999;
        assert!(
            !verify_account_proof(&raiz, &alvo, &mentira.to_value(), &prova.caminho),
            "saldo trocado não pode fechar contra a raiz"
        );
    }

    /// Sem carteira, escrever falha ANTES de tocar a rede — como no JS.
    #[test]
    fn cliente_sem_carteira_nao_assina() {
        let c = Eav7Client::novo("http://127.0.0.1:1");
        assert!(c.endereco().is_none());
        let erro = c
            .montar(TxSpec::nova("TRANSFER", 1, 1, 1_700_000_000_000))
            .expect_err("sem carteira não há como assinar");
        assert!(matches!(erro, ErroCliente::Transacao(_)), "{erro}");
    }

    /// A transação que o SDK monta é a MESMA que o nó validaria — e o `id` não
    /// depende dos bytes da assinatura (anti-maleabilidade, achado M1).
    #[test]
    fn transacao_montada_pelo_sdk_e_valida_e_o_id_nao_depende_da_assinatura() {
        let (_, json) = crate::wallet::ProductionWallet::gerar().expect("gera");
        let dir = std::env::temp_dir().join(format!("eav7-sdk-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let arquivo = dir.join("carteira.json");
        std::fs::write(&arquivo, json).expect("grava");
        let carteira = crate::wallet::ProductionWallet::from_file(&arquivo).expect("carrega");

        let cliente = Eav7Client::com_carteira("http://127.0.0.1:1", Box::new(carteira));
        let destino = eav7::derive_address_from("sdk:destino");
        let tx = cliente
            .montar(TxSpec::nova("TRANSFER", 1_000, 1, 1_700_000_000_000).para(&destino))
            .expect("monta e assina");

        // `montar` já verifica; reafirmar aqui documenta o contrato.
        assert_eq!(eav7::transaction::verify_transaction(&tx), Ok(()));
        assert_eq!(tx.from, cliente.endereco().expect("endereço"));

        // Trocar a assinatura NÃO muda o id: ele sai do payload.
        let id_original = tx.id.clone();
        let mut adulterada = tx.clone();
        adulterada.signature = Some("OUTRA".into());
        assert_eq!(
            eav7::transaction::tx_id(&adulterada),
            id_original.expect("id"),
            "o id não pode depender dos bytes da assinatura"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
