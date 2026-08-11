//! O nó EAV7 — a visão que a camada de API/P2P tem da cadeia.
//!
//! Espelha o `Eav7Node` de `src/node/node.js`, mas SÓ a parte que os handlers
//! consomem: cadeia, mempool, identidade do validador, peers, alertas e guarda.
//! A orquestração completa (boot, produção de blocos, timers) entra com o porte
//! de `node.js`; manter a struct enxuta agora evita inventar campos que o
//! orquestrador ainda vai definir.

use eav7::blockchain::Blockchain;
use eav7::config::{MAX_ALERT_CONTEXT_BYTES, MAX_FUTURE_NONCE_GAP, MAX_MEMPOOL};
use eav7::mempool::Mempool;
use eav7::transaction::{verify_transaction, Tx};
use sha2::{Digest, Sha256};

use crate::guard::AbuseGuard;
use crate::verify_contract::{verify_contract, VerifiedContract, VerifyParams};

/// Quantos alertas de segurança ficam retidos em memória (anel; o mais velho sai).
/// Espelha o teto do JS (500).
const MAX_SECURITY_ALERTS: usize = 500;

/// Um alerta de segurança operacional. Estado LOCAL do nó — nunca entra em
/// consenso; a API o serializa como apresentação.
#[derive(Debug, Clone)]
pub struct SecurityAlert {
    pub at: i64,
    pub source: String,
    pub kind: String,
    pub severity: String,
    pub message: String,
    /// Contexto já serializado (e truncado se necessário) — guardar o JSON pronto
    /// evita reter estruturas arbitrárias de tamanho imprevisível.
    pub context: serde_json::Value,
}

/// Índice de hash EVM -> id de transação eav20, com a altura já indexada.
///
/// Reindexa do zero quando a cadeia ENCOLHE (reorg): o JS faz o mesmo
/// (`if (indexedHeight > bc.height) indexedHeight = -1`, rpc.js:52). Sem isso um
/// reorg deixaria no índice hashes de blocos que não existem mais, e o RPC
/// devolveria recibo de transação órfã como se estivesse na cadeia.
#[derive(Debug, Default)]
pub struct EavmIndex {
    pub por_hash: std::collections::BTreeMap<String, String>,
    /// Altura já varrida. `-1` = nada indexado (ou reindexação pendente).
    pub altura_indexada: i64,
}

impl EavmIndex {
    pub fn novo() -> Self {
        EavmIndex { por_hash: Default::default(), altura_indexada: -1 }
    }
}

/// Resultado de submeter uma transação. Espelha o retorno do JS
/// (`{accepted, id, reason?}`).
#[derive(Debug, Clone)]
pub struct SubmitOutcome {
    pub accepted: bool,
    pub id: String,
    pub reason: Option<String>,
}

pub struct Node {
    pub blockchain: Blockchain,
    pub mempool: Mempool,
    /// Endereço do validador local (`--validator`); `None` num nó só-leitura.
    pub validator_address: Option<String>,
    /// URLs dos peers P2P (visão para a API; o transporte P2P real mantém isto).
    pub peers: Vec<String>,
    pub security_alerts: Vec<SecurityAlert>,
    /// Guarda anti-abuso.
    ///
    /// `Arc<Mutex<_>>` porque é COMPARTILHADA com o middleware de admissão
    /// (`api::admissao`), que a consulta em toda requisição: o `GET /guard` tem
    /// de reportar os bloqueios REAIS, não um segundo registro paralelo que
    /// ninguém alimenta — que era exatamente o que acontecia quando este campo
    /// era um `AbuseGuard` próprio do `Node` e o middleware não existia.
    pub guard: std::sync::Arc<std::sync::Mutex<AbuseGuard>>,
    /// Alvo atual do failover de leitura do gateway (`None` = servir local).
    pub gateway_target: Option<String>,
    /// Snapshot rico do gateway (self/peers/at) para observabilidade em
    /// `GET /gateway`. Vive num `Mutex` PRÓPRIO, não no `RwLock<Node>`: a task de
    /// failover o escreve a cada ciclo sem contender com as leituras da API, e a
    /// API o lê sem bloquear a task. `None` até o primeiro ciclo (ou sempre, se o
    /// failover não estiver ligado).
    pub gateway_snapshot: std::sync::Arc<std::sync::Mutex<Option<crate::gateway::Snapshot>>>,
    pub eavm_enabled: bool,
    pub eavm_port: u16,
    pub public_rpc_url: Option<String>,
    /// URL pública DESTE nó. Sem ela, `POST /peers` aceita o próprio endereço e o
    /// nó passa a fazer gossip e sync contra si mesmo (`p2p.js:26` recusa
    /// `peer === selfUrl`).
    pub self_url: Option<String>,
    /// Token de administração. `None` = endpoints de admin DESABILITADOS (o
    /// padrão seguro — igual ao JS, que nega tudo sem token configurado).
    pub admin_token: Option<String>,
    /// Registro de contratos verificados (#8). Metadado NÃO-CONSENSUAL — vive
    /// FORA do `stateRoot` (node.js:53). É o `this.verifiedContracts = new Map()`
    /// da referência (node.js:55); a chave é o endereço 0x em minúsculas.
    pub verified_contracts: std::collections::BTreeMap<String, VerifiedContract>,
    /// Índice `eavmHash -> id da transação`, para o RPC achar uma tx EVM por hash
    /// em O(1) (`ensureIndexed`, rpc.js:50-66).
    ///
    /// `Mutex` PRÓPRIO, e não um campo comum: a atualização é preguiçosa e
    /// acontece em rotas de LEITURA (`eth_getTransactionByHash`,
    /// `eth_getTransactionReceipt`), que só têm `&Node`. Sem ele, cada consulta
    /// varria `blocks_with_txs` inteiro pelo caminho fundo — disco, parse e clone
    /// por bloco, na thread do tokio, com o read lock preso. Um MetaMask fazendo
    /// polling de recibo a cada ~4s bastava para degradar o nó; um lote de 50
    /// consultas por requisição derrubava.
    pub eavm_index: std::sync::Arc<std::sync::Mutex<EavmIndex>>,
    /// Canal de RELAY de blocos aceitos vindos de peer (`p2p.broadcastBlock`,
    /// node.js:226).
    ///
    /// Sem ele a propagação morre no primeiro salto: A produz e manda para B, e B
    /// nunca repassa para C. Numa malha completa não aparece — todo mundo recebe
    /// direto do produtor —, mas em qualquer topologia parcial (a real, com peers
    /// atrás de NAT ou listas assimétricas) metade da rede fica sem o bloco.
    ///
    /// Separado do canal do PRODUTOR de propósito: aquele difunde o que este nó
    /// criou; este repassa o que recebeu. O mesmo transporte, origens distintas.
    pub relay_bloco: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    /// Pedido de SINCRONIZAÇÃO imediata (`p2p.syncOnce()`, node.js:221).
    ///
    /// Disparado quando chega um bloco À FRENTE da nossa altura: é o sinal de que
    /// este nó ficou para trás. Sem ele, um nó atrasado espera o tick periódico
    /// (5 s) enquanto rejeita todos os blocos que chegam — e, num reinício, pode
    /// levar minutos para reencontrar a cadeia.
    pub pedir_sync: Option<tokio::sync::mpsc::UnboundedSender<()>>,
    /// Canal de difusão de TRANSAÇÕES aceitas (`p2p.broadcastTx`, node.js:209).
    ///
    /// A referência difunde dentro do próprio `submitTransaction`; aqui o método
    /// é puro (nenhum I/O) e quem difunde é a casca, com o resultado em mãos. Sem
    /// este canal ligado, uma transação submetida a um nó NÃO-PRODUTOR entrava no
    /// mempool local e morria ali: nenhum peer a recebia, nenhum bloco a incluía.
    /// `None` = nó isolado (testes) — a difusão simplesmente não acontece.
    pub gossip_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
}

impl Node {
    /// Construtor único dos campos padrão (G16) — evita literais ×N a derivar.
    pub fn novo(
        blockchain: Blockchain,
        validator_address: Option<String>,
        self_url: Option<String>,
    ) -> Self {
        Node {
            blockchain,
            mempool: Mempool::new(),
            validator_address,
            peers: Vec::new(),
            security_alerts: Vec::new(),
            guard: std::sync::Arc::new(std::sync::Mutex::new(AbuseGuard::new(
                crate::guard::GuardConfig::default(),
            ))),
            gateway_target: None,
            gateway_snapshot: Default::default(),
            eavm_enabled: false,
            eavm_port: 0,
            public_rpc_url: None,
            self_url,
            admin_token: None,
            verified_contracts: Default::default(),
            eavm_index: std::sync::Arc::new(std::sync::Mutex::new(EavmIndex::novo())),
            relay_bloco: None,
            pedir_sync: None,
            gossip_tx: None,
        }
    }

    /// Valida e aceita uma transação no mempool. Espelha `submitTransaction`
    /// (`node.js:193`) — MENOS o broadcast, que pertence ao transporte P2P: o
    /// chamador (API/P2P) decide difundir com o resultado em mãos. Manter o
    /// gossip fora daqui preserva a pureza (nenhum I/O neste método).
    pub fn submit_transaction(&mut self, tx: Tx) -> Result<SubmitOutcome, String> {
        verify_transaction(&tx)?;
        let id = tx.id.clone().ok_or("transação sem id")?;
        // `tx.nonce` é `i64` (vem do payload assinado); o da conta é `u64`. Um
        // nonce negativo nunca supera o confirmado — cai na primeira guarda.
        let confirmed_nonce = self.blockchain.state.account(&tx.from).nonce;
        if tx.nonce < 0 || (tx.nonce as u64) <= confirmed_nonce {
            return Err(format!("nonce {} já utilizado por {}", tx.nonce, tx.from));
        }
        // Rejeita nonces muito à frente: sem isto, transações que nunca ficam
        // executáveis (lacuna de nonce) se acumulariam para sempre no mempool (DoS).
        if (tx.nonce as u64) > confirmed_nonce + MAX_FUTURE_NONCE_GAP {
            return Err(format!("nonce {} muito à frente (máx +{MAX_FUTURE_NONCE_GAP})", tx.nonce));
        }
        if self.blockchain.tx_index.contains_key(&id) || self.mempool.has(&id) {
            return Ok(SubmitOutcome { accepted: false, id, reason: Some("transação já conhecida".into()) });
        }
        if self.mempool.len() as u64 >= MAX_MEMPOOL {
            return Err("mempool cheio, tente novamente mais tarde".into());
        }
        self.mempool.add(tx)?;
        Ok(SubmitOutcome { accepted: true, id, reason: None })
    }

    /// Próximo nonce utilizável considerando transações do remetente ainda no
    /// mempool. Espelha `nextNonceFor` (`node.js:185`).
    pub fn next_nonce_for(&self, address: &str) -> u64 {
        let mut nonce = self.blockchain.state.account(address).nonce;
        for tx in self.mempool.all() {
            if tx.from == address && tx.nonce > 0 && (tx.nonce as u64) > nonce {
                nonce = tx.nonce as u64;
            }
        }
        nonce + 1
    }

    /// Autoriza operações administrativas. Sem token configurado, NEGA — endpoints
    /// de admin ficam desabilitados por padrão.
    ///
    /// Comparação constant-time via SHA-256 de ambos os lados (mesmo comprimento
    /// sempre): um `==` de bytes sairia no 1º byte divergente e vazaria o token
    /// byte a byte pelo timing (achado L1 da auditoria).
    pub fn check_admin(&self, header_token: Option<&str>) -> bool {
        let (Some(token), Some(header)) = (self.admin_token.as_deref(), header_token) else {
            return false;
        };
        let a = Sha256::digest(header.as_bytes());
        let b = Sha256::digest(token.as_bytes());
        // XOR acumulado sobre os 32 bytes: sem branch dependente de dado.
        a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
    }

    /// Verifica um contrato EAVM (#8). Espelha `verifyContract` (`node.js:73-141`):
    /// resolve o código on-chain de `state.contracts[addr].code` (LEITURA DIRETA,
    /// não `code_of` — o JS lê `.code` e trata `''` como "não encontrado"), delega
    /// à lógica pura de `verify_contract.rs`, e — em caso de sucesso — grava o
    /// registro no mapa em memória e o devolve. O `now_ms` (o `Date.now()` do JS)
    /// é injetado pela casca; este método não lê relógio.
    ///
    /// I/O NENHUM: a única "fonte externa" é o estado já em memória. Fica sendo
    /// `&mut self` só pela escrita no `verified_contracts`.
    pub fn verify_contract(
        &mut self,
        address: &str,
        params: VerifyParams,
        now_ms: i64,
    ) -> Result<VerifiedContract, String> {
        let addr = address.to_lowercase();
        // node.js:78 — `state.contracts[addr]?.code`. Ausente vira `''`, que a
        // lógica pura rejeita como "não encontrado on-chain" (paridade com o
        // `if (!onchainRaw)` do JS, onde `''` é *falsy*).
        let onchain_raw = self
            .blockchain
            .state
            .contracts
            .get(&addr)
            .map(|c| c.code.clone())
            .unwrap_or_default();
        let record = verify_contract(&addr, &onchain_raw, params, now_ms)?;
        // node.js:139 — `this.verifiedContracts.set(addr, record)`.
        self.verified_contracts.insert(addr, record.clone());
        Ok(record)
    }

    /// `getVerifiedContract` (`node.js:143-145`) — consulta por endereço,
    /// normalizado para minúsculas. `None` quando não há registro.
    pub fn get_verified_contract(&self, address: &str) -> Option<&VerifiedContract> {
        self.verified_contracts.get(&address.to_lowercase())
    }

    /// Registra um alerta de segurança. Espelha `addSecurityAlert` (`node.js:230`):
    /// valida severidade, trunca contexto grande (sem limite, 500 alertas de ~2 MB
    /// reteriam ~1 GB) e mantém no máximo `MAX_SECURITY_ALERTS` em memória.
    pub fn add_security_alert(
        &mut self,
        source: &str,
        kind: &str,
        severity: &str,
        message: &str,
        context: serde_json::Value,
        now_ms: i64,
    ) -> Result<(), String> {
        // O JS só exige que sejam STRINGS (`typeof !== 'string'`) — vazia passa.
        // Rejeitar vazia aqui seria "melhorar" a validação e divergir da referência.
        if !matches!(severity, "info" | "warning" | "critical") {
            return Err("severity deve ser info, warning ou critical".into());
        }
        let encoded = context.to_string();
        let context = if encoded.len() as u64 > MAX_ALERT_CONTEXT_BYTES {
            serde_json::json!({ "truncated": true, "bytes": encoded.len() })
        } else {
            context
        };
        self.security_alerts.push(SecurityAlert {
            at: now_ms,
            // Truncamentos IDÊNTICOS aos do JS (node.js:248-251): 40/40/4000.
            source: source.chars().take(40).collect(),
            kind: kind.chars().take(40).collect(),
            severity: severity.to_string(),
            message: message.chars().take(4000).collect(),
            context,
        });
        if self.security_alerts.len() > MAX_SECURITY_ALERTS {
            let excesso = self.security_alerts.len() - MAX_SECURITY_ALERTS;
            self.security_alerts.drain(0..excesso);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node() -> Node {
        Node {
            blockchain: Blockchain::new(),
            mempool: Mempool::new(),
            validator_address: None,
            peers: Vec::new(),
            security_alerts: Vec::new(),
            guard: std::sync::Arc::new(std::sync::Mutex::new(AbuseGuard::new(crate::guard::GuardConfig::default()))),
            gateway_target: None,
            gateway_snapshot: Default::default(),
            eavm_enabled: false,
            eavm_port: 0,
            public_rpc_url: None,
        self_url: None,
            admin_token: None,
            verified_contracts: Default::default(),
            eavm_index: std::sync::Arc::new(std::sync::Mutex::new(EavmIndex::novo())),
            // Nó de teste é isolado: sem canais, difusão/relay/sync não ocorrem.
            relay_bloco: None,
            pedir_sync: None,
            gossip_tx: None,
        }
    }

    #[test]
    fn admin_sem_token_configurado_nega_sempre() {
        let n = node();
        assert!(!n.check_admin(Some("qualquer")));
        assert!(!n.check_admin(None));
    }

    #[test]
    fn admin_compara_sem_curto_circuito() {
        let mut n = node();
        n.admin_token = Some("segredo".into());
        assert!(n.check_admin(Some("segredo")));
        assert!(!n.check_admin(Some("segred0")));
        assert!(!n.check_admin(Some("")));
        assert!(!n.check_admin(None));
    }

    #[test]
    fn alerta_valida_severidade_e_trunca_contexto() {
        let mut n = node();
        assert!(n.add_security_alert("api", "k", "fatal", "m", serde_json::json!({}), 0).is_err());
        // Contexto acima do teto vira {truncated, bytes} em vez de reter o blob.
        let grande = serde_json::json!({ "blob": "x".repeat(3000) });
        n.add_security_alert("api", "k", "info", "m", grande, 0).unwrap();
        assert_eq!(n.security_alerts[0].context["truncated"], serde_json::json!(true));
    }

    #[test]
    fn anel_de_alertas_respeita_o_teto() {
        let mut n = node();
        for i in 0..(MAX_SECURITY_ALERTS + 10) {
            n.add_security_alert("api", "k", "info", &format!("m{i}"), serde_json::json!({}), i as i64)
                .unwrap();
        }
        assert_eq!(n.security_alerts.len(), MAX_SECURITY_ALERTS);
        // Os mais velhos saíram: o primeiro retido é o de índice 10.
        assert_eq!(n.security_alerts[0].message, "m10");
    }

    #[test]
    fn next_nonce_considera_o_mempool() {
        let n = node();
        // Conta desconhecida: nonce confirmado 0 → próximo é 1.
        assert_eq!(n.next_nonce_for("E7DESCONHECIDA"), 1);
    }

    #[test]
    fn verify_contract_le_o_codigo_on_chain_e_grava_o_registro() {
        use eav7::state::contracts::Contract;
        let mut n = node();
        let addr = "0x00000000000000000000000000000000000000ab";
        let c = Contract { code: "0x6001600260ab".into(), ..Default::default() };
        n.blockchain.state.contracts.insert(addr.into(), c);

        let params = VerifyParams {
            source: "contract C {}".into(),
            language: "solidity".into(),
            compiler: "0.8.24".into(),
            bytecode: "0x6001600260ab".into(),
            evm_version: "cancun".into(),
            optimizer: None,
            immutable_references: Vec::new(),
            contract_name: "C".into(),
        };
        let rec = n.verify_contract(&addr.to_uppercase(), params, 555).unwrap();
        assert_eq!(rec.match_grade, "full");
        assert_eq!(rec.verified_at, 555);
        // Gravou sob a chave em minúsculas e a consulta case-insensitive o acha.
        assert!(n.get_verified_contract(&addr.to_uppercase()).is_some());
        assert_eq!(n.get_verified_contract(addr).unwrap().match_grade, "full");
    }

    #[test]
    fn verify_contract_de_endereco_sem_codigo_da_erro() {
        let mut n = node();
        let params = VerifyParams {
            source: "x".into(),
            language: "solidity".into(),
            compiler: String::new(),
            bytecode: "0x6001".into(),
            evm_version: String::new(),
            optimizer: None,
            immutable_references: Vec::new(),
            contract_name: String::new(),
        };
        let e = n.verify_contract("0xdead", params, 0).unwrap_err();
        assert_eq!(e, "contrato não encontrado on-chain");
        assert!(n.get_verified_contract("0xdead").is_none());
    }
}
