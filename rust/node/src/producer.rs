//! Produtor de blocos — porte de `#produce` (`src/node/node.js:259-285`) e do
//! timer de 200 ms de `start()` (`node.js:302`).
//!
//! # Arquitetura (o princípio do crate: LÓGICA separada do TRANSPORTE)
//!
//! A decisão de UM tick vive em [`tick`], uma função SÍNCRONA e pura no relógio
//! (`now` é parâmetro, nunca `SystemTime` lido por dentro) — é ela que os testes
//! exercitam. O laço [`start`] é só a casca de transporte: intervalo de 200 ms,
//! write-lock, chama `tick`, solta o lock, e SÓ então toca o canal de gossip.
//! O lock NUNCA atravessa um `await` — o guard morre no fim do bloco síncrono.
//!
//! # Broadcast (fora do escopo deste módulo)
//!
//! O JS faz `this.p2p.broadcastBlock(block)` (node.js:278) dentro do produtor.
//! Aqui o produtor não chama transporte nenhum — não por falta de P2P (ele está
//! portado em `p2p.rs` e ligado), mas para manter o laço de produção síncrono e
//! o I/O fora do lock: se o chamador passar um `UnboundedSender<String>`, cada
//! bloco produzido é enviado como a LINHA CANÔNICA de consenso
//! (`eav7::block::block_to_json_line` — byte a byte o que vai a disco e a rede).
//! Quem liga esse canal ao `p2p::broadcast_block` é o `main.rs`, e ele SEMPRE o
//! liga quando há carteira de validador; sem canal (testes), o bloco já está
//! commitado na cadeia local e os peers o puxam via sync.
//!
//! # Achados de auditoria espelhados
//!
//! • H2 — a produção NUNCA é bloqueada por altura auto-reportada de peer: as
//!   guardas abaixo são as únicas, e nenhuma consulta a rede (node.js:270,
//!   "Não há gate por altura auto-reportada de peer — evita o vetor de halt").
//! • L4 — `last_slot` é marcado SÓ depois de `produce_block` retornar sucesso
//!   (node.js:276): uma falha transitória deixa o slot em aberto e o próximo
//!   tick (200 ms depois, ainda dentro do slot de 1 s) tenta de novo.

use std::sync::Arc;
use std::time::Duration;

use eav7::block::Block;
use eav7::block::BlockSigner;
use eav7::config::{BLOCK_REWARD, MAX_TXS_PER_BLOCK, SYMBOL, UNIT};
use tokio::sync::mpsc::UnboundedSender;

use crate::api::AppState;
use crate::node::Node;
use crate::wallet::ProductionWallet;

/// Intervalo do timer de produção — `setInterval(() => this.#produce(), 200)`
/// (node.js:302). 5 tentativas por slot de 1 s: é o que dá ao L4 as janelas de
/// retry dentro do próprio slot.
const INTERVALO_MS: u64 = 200;

/// UM tick do produtor — a LÓGICA de `#produce` (node.js:259-285), na ordem
/// exata das guardas do JS. Devolve o bloco produzido (já commitado na cadeia
/// local) ou `None` se alguma guarda segurou a produção.
///
/// `last_slot` vive no TASK do laço (variável local), não no `Node` — no JS ele
/// é `this.lastSlot` (node.js:51, inicial `-1`), mas só o produtor o lê/escreve,
/// então mantê-lo fora do estado compartilhado remove uma classe de acesso
/// concorrente de graça.
///
/// Nenhum pânico no caminho de execução: toda falha vira `None` (com log, como
/// o `catch` do JS em node.js:282-284).
pub fn tick(
    node: &mut Node,
    wallet: &dyn BlockSigner,
    last_slot: &mut i64,
    now: i64,
) -> Option<Block> {
    // node.js:260 — `if (!this.validatorWallet || !this.blockchain.hasGenesis()) return;`
    // A metade `validatorWallet` é estrutural aqui: quem não tem carteira nunca
    // chama `start`/`tick`. Resta a guarda de gênese.
    if !node.blockchain.has_genesis() {
        return None;
    }

    // node.js:262-263 — `const slot = this.blockchain.slotFor(now);
    //                    if (slot === this.lastSlot) return;` (uma tentativa por
    // slot — exceto retry após falha, ver L4 abaixo).
    let slot = node.blockchain.slot_for(now);
    if slot == *last_slot {
        return None;
    }

    // node.js:265 — `if (this.blockchain.slotFor(this.blockchain.head.timestamp) >= slot) return;`
    // Slot já preenchido na cadeia? Então não produz.
    let cabeca_ts = node.blockchain.head()?.timestamp; // Some garantido pós-gênese
    if node.blockchain.slot_for(cabeca_ts) >= slot {
        return None;
    }

    // node.js:271 — `if (this.blockchain.expectedProducer(now) !== this.validatorAddress) return;`
    // Produz APENAS o próprio slot do rodízio: com a validação ESTRITA de
    // produtor no `add_block` (≥ STRICT_PRODUCER_HEIGHT), bloco fora de turno é
    // rejeitado pela rede; e um nó atrasado no próprio slot produz órfão e
    // reorganiza para a canônica (comentário de node.js:266-270). H2: nenhuma
    // guarda consulta altura de peer.
    let esperado = match node.blockchain.expected_producer(now) {
        Ok(e) => e,
        Err(e) => {
            // Estado ilegível (parâmetro de governança corrompido). No JS isto
            // lançaria fora do try; aqui vira log + slot pulado — o nó segue
            // vivo para servir a API enquanto o operador investiga.
            println!("[minerador] falha ao escalar produtor: {e}");
            return None;
        }
    };
    // O endereço local é derivado da carteira (o `validatorAddress` do JS é
    // `walletAddress(validatorWallet)`, node.js). Derivar aqui a cada tick é um
    // parse de SPKI — custo desprezível a 5 Hz — e garante que o endereço usado
    // é SEMPRE o das chaves que vão assinar, sem cache para dessincronizar.
    let nosso = match eav7::signature::address_from_public_keys(
        wallet.public_key_pem(),
        wallet.pq_public_key_pem(),
    ) {
        Ok(a) => a,
        Err(e) => {
            println!("[minerador] chaves da carteira de produção inválidas: {e}");
            return None;
        }
    };
    if esperado.as_deref() != Some(nosso.as_str()) {
        return None;
    }

    // node.js:272 — `if (now <= this.blockchain.head.timestamp) return;`
    if now <= cabeca_ts {
        return None;
    }

    // node.js:274 — `const txs = this.mempool.selectExecutable(this.blockchain.state,
    //                this.blockchain.height + 1, now);` (max = MAX_TXS_PER_BLOCK,
    // o padrão do JS em mempool.js:44). `height()` ≥ 0 pós-gênese, logo o cast
    // é seguro; `now` já passou por `> cabeca_ts`, logo é positivo em qualquer
    // cadeia real — o `unwrap_or(0)` é só o anti-pânico exigido pelo módulo.
    let altura_alvo = (node.blockchain.height() + 1).max(0) as u64;
    let txs = node.mempool.select_executable(
        &node.blockchain.state,
        altura_alvo,
        u64::try_from(now).unwrap_or(0),
        MAX_TXS_PER_BLOCK as usize,
    );

    // node.js:275 — `const block = this.blockchain.produceBlock(this.validatorWallet,
    //                txs, { timestamp: now });`. Assinatura real da lib
    // (blockchain.rs:905): produce_block(signer, transactions, timestamp,
    // producer_account, now) — `producer_account: None` porque o nó produz pela
    // própria conta (witness é rota separada), e o `now` do relógio é o mesmo
    // instante do timestamp, como no JS.
    match node.blockchain.produce_block(wallet, txs, now, None, now) {
        Ok(bloco) => {
            // node.js:276 — L4: marca o slot SÓ após produzir com sucesso
            // (permite retry no mesmo slot quando `produce_block` falha).
            *last_slot = slot;
            // node.js:277 — `this.mempool.prune(this.blockchain.state);` — as
            // transações que entraram no bloco têm nonce consumido no estado
            // novo e saem do mempool. Assinatura real: prune(&State, now_ms).
            node.mempool.prune(&node.blockchain.state, now);
            // (node.js:278, broadcastBlock — fica com o chamador; ver cabeçalho.)
            // node.js:279-281 — log de bloco com transação, ou 1 a cada 60.
            if bloco.tx_count > 0 || bloco.height.is_multiple_of(60) {
                println!(
                    "[minerador] bloco {} ({} tx) — recompensa {} {SYMBOL} + taxas",
                    bloco.height,
                    bloco.tx_count,
                    format_eav7(BLOCK_REWARD)
                );
            }
            Some(bloco)
        }
        Err(e) => {
            // node.js:283 — `this.log(`[minerador] falha ao produzir bloco: ...`)`.
            // `last_slot` fica como estava: é o retry do L4.
            println!("[minerador] falha ao produzir bloco: {e}");
            None
        }
    }
}

/// Liga o laço de produção — o equivalente de `start()` armar o
/// `productionTimer` (node.js:301-303). Só deve ser chamado quando o nó TEM
/// carteira de validador, como no JS (`if (this.validatorWallet)`).
///
/// `gossip`: ver o cabeçalho do módulo — `Some(sender)` recebe cada bloco
/// produzido como linha JSON canônica (`block_to_json_line`); `None` desliga a
/// difusão ativa (peers sincronizam por pull). O `main.rs` liga o canal ao P2P.
pub fn start(
    state: AppState,
    wallet: Arc<ProductionWallet>,
    gossip: Option<UnboundedSender<String>>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut intervalo = tokio::time::interval(Duration::from_millis(INTERVALO_MS));
        // `setInterval` do Node NÃO acumula ticks perdidos em rajada; `Delay` é
        // a semântica equivalente (o padrão `Burst` dispararia vários ticks
        // seguidos após uma pausa longa — inofensivo pela guarda de slot, mas
        // diferente da referência sem motivo).
        intervalo.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // node.js:51 — `this.lastSlot = -1`. Vive no task, não no Node.
        let mut last_slot: i64 = -1;
        loop {
            intervalo.tick().await;
            let now = agora_ms();
            // Bloco SÍNCRONO sob o write-lock: pega o guard, decide, solta. O
            // guard não existe depois da chave — impossível atravessar `await`.
            let bloco = {
                let mut guarda = match state.write() {
                    Ok(g) => g,
                    Err(_) => {
                        // Lock envenenado = um handler entrou em pânico com o
                        // write-lock. O estado compartilhado não é mais
                        // confiável; parar o produtor é o único desfecho seguro
                        // (produzir sobre estado meio-escrito seria pior).
                        println!("[minerador] lock do nó envenenado — produção interrompida");
                        return;
                    }
                };
                tick(&mut guarda, wallet.as_ref(), &mut last_slot, now)
            };
            // Fora do lock: serializa e entrega ao gossip, se houver canal.
            if let (Some(b), Some(canal)) = (bloco.as_ref(), gossip.as_ref()) {
                match eav7::block::block_to_json_line(b) {
                    Ok(linha) => {
                        // Receptor derrubado = P2P desligando; não é erro do
                        // produtor, o bloco já está commitado localmente.
                        let _ = canal.send(linha);
                    }
                    Err(e) => {
                        // Inalcançável para um bloco que `produce_block` acabou
                        // de aceitar, mas a política do módulo é log, não pânico.
                        println!("[minerador] bloco produzido não serializável: {e}");
                    }
                }
            }
        }
    })
}

/// Relógio de parede em ms — o `Date.now()` de node.js:261. Isolado para o
/// `unwrap_or` de relógio anterior a 1970 ficar num lugar só (pânico jamais).
fn agora_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// `formatEav7` de config.js:572 — mesma cópia local que `api/chain.rs:84` usa
/// (a fn de lá é privada do módulo; oito linhas não justificam re-exportar).
fn format_eav7(v: u128) -> String {
    let inteiro = v / UNIT;
    let frac = v % UNIT;
    if frac == 0 {
        return inteiro.to_string();
    }
    let f = format!("{frac:06}");
    format!("{inteiro}.{}", f.trim_end_matches('0'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::guard::{AbuseGuard, GuardConfig};
    use crate::wallet::FIXTURE_CARTEIRA;
    use eav7::block::build_genesis_block;
    use eav7::blockchain::Blockchain;
    use eav7::config::{BLOCK_TIME_MS, MIN_VALIDATOR_STAKE};
    use eav7::mempool::Mempool;
    use eav7::transaction::JsonValue;

    /// Timestamp do gênese — slot inteiro, bem depois de 1970.
    const TS0: i64 = 1_700_000_000_000;

    /// `BLOCK_TIME_MS` da config é `u64`; os timestamps do protocolo são `i64`.
    const SLOT_MS: i64 = BLOCK_TIME_MS as i64;

    /// A Carteira determinística da lib é `pub(crate)` de `eav7` e inacessível
    /// daqui; a ProductionWallet com o fixture REAL do Node cumpre o papel — e
    /// de quebra exercita o caminho de produção com chaves idênticas às de um
    /// validador de verdade.
    fn carteira() -> ProductionWallet {
        ProductionWallet::from_file(FIXTURE_CARTEIRA).expect("fixture da carteira")
    }

    /// Gênese com stake suficiente para `stake_de` ser o ÚNICO validador ativo:
    /// com um só validador, todo slot pertence a ele — o rodízio fica
    /// determinístico sem depender da ordenação por endereço.
    fn genese(stake_de: &str) -> eav7::block::Block {
        build_genesis_block(
            TS0,
            JsonValue::map([(
                "stakes".to_string(),
                JsonValue::map([(
                    stake_de.to_string(),
                    JsonValue::str((MIN_VALIDATOR_STAKE * 2).to_string()),
                )]),
            )]),
        )
    }

    fn node_com_genese(stake_de: &str) -> Node {
        let mut blockchain = Blockchain::new();
        blockchain.adopt_genesis(genese(stake_de)).expect("adotar gênese");
        Node {
            blockchain,
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

    /// O instante `now` do slot seguinte ao gênese (slot(TS0)+1, começo do slot).
    fn now_do_slot_seguinte() -> i64 {
        TS0 + SLOT_MS
    }

    #[test]
    fn produz_no_proprio_slot() {
        let carteira = carteira();
        let mut node = node_com_genese(carteira.address());
        let mut last_slot = -1;
        let now = now_do_slot_seguinte();

        let bloco = tick(&mut node, &carteira, &mut last_slot, now).expect("tem de produzir");
        assert_eq!(bloco.height, 1);
        assert_eq!(bloco.producer, carteira.address());
        // O bloco já está COMMITADO na cadeia local (produce_block → add_block).
        assert_eq!(node.blockchain.height(), 1);
        // last_slot marcado com o slot produzido (node.js:276).
        assert_eq!(last_slot, node.blockchain.slot_for(now));
        // A linha canônica que iria ao gossip serializa.
        eav7::block::block_to_json_line(&bloco).expect("linha canônica");
    }

    #[test]
    fn nao_produz_fora_de_turno() {
        let carteira = carteira();
        // O único validador ativo é OUTRO endereço: nenhum slot é nosso.
        let mut node = node_com_genese("E7FFFFFFFFFFFFFFFFFFFFFFFFFFFF0000");
        let mut last_slot = -1;

        for i in 1..=5 {
            let now = TS0 + (i * SLOT_MS);
            assert!(
                tick(&mut node, &carteira, &mut last_slot, now).is_none(),
                "produziu fora de turno no slot {i}"
            );
        }
        // Guarda de turno NÃO consome o slot (só sucesso consome — L4).
        assert_eq!(last_slot, -1);
        assert_eq!(node.blockchain.height(), 0);
    }

    #[test]
    fn nao_produz_duas_vezes_no_mesmo_slot() {
        let carteira = carteira();
        let mut node = node_com_genese(carteira.address());
        let mut last_slot = -1;
        let now = now_do_slot_seguinte();

        assert!(tick(&mut node, &carteira, &mut last_slot, now).is_some());
        // Mesmo slot, 200 ms depois (o tick seguinte do timer): a guarda
        // `slot === lastSlot` (node.js:263) segura.
        assert!(tick(&mut node, &carteira, &mut last_slot, now + 200).is_none());
        assert_eq!(node.blockchain.height(), 1, "um bloco por slot");
    }

    #[test]
    fn retry_no_mesmo_slot_apos_falha() {
        let carteira = carteira();
        let mut node = node_com_genese(carteira.address());
        let mut last_slot = -1;
        let now = now_do_slot_seguinte();

        // Injeta uma falha REAL de produção adulterando o estado: com o saldo do
        // produtor em u128::MAX, o crédito da recompensa estoura e
        // `produce_block` retorna Err DEPOIS de todas as guardas do tick.
        node.blockchain
            .state
            .accounts
            .get_mut(carteira.address())
            .expect("conta do validador existe (stake do gênese)")
            .balance = u128::MAX;
        assert!(
            tick(&mut node, &carteira, &mut last_slot, now).is_none(),
            "produção tinha de falhar com o saldo estourado"
        );
        // L4 (node.js:276): a falha NÃO consome o slot.
        assert_eq!(last_slot, -1, "falha não pode marcar last_slot");

        // Falha sanada: o tick seguinte, AINDA NO MESMO SLOT, produz.
        node.blockchain
            .state
            .accounts
            .get_mut(carteira.address())
            .expect("conta do validador")
            .balance = 0;
        let bloco = tick(&mut node, &carteira, &mut last_slot, now + 200)
            .expect("retry no mesmo slot tem de produzir");
        assert_eq!(bloco.height, 1);
        assert_eq!(node.blockchain.slot_for(bloco.timestamp), node.blockchain.slot_for(now));
    }

    #[test]
    fn nao_produz_sem_genese() {
        let carteira = carteira();
        let mut node = node_com_genese(carteira.address());
        node.blockchain = Blockchain::new(); // cadeia vazia (node.js:260)
        let mut last_slot = -1;
        assert!(tick(&mut node, &carteira, &mut last_slot, now_do_slot_seguinte()).is_none());
    }

    #[test]
    fn formata_recompensa_como_o_js() {
        assert_eq!(format_eav7(BLOCK_REWARD), "16");
        assert_eq!(format_eav7(2_500_000), "2.5");
    }
}
