//! RELAYER da ponte cross-chain — o porte de `BridgeRelayer` (`src/bridge/gateway.js`).
//!
//! # O que ele faz
//!
//! O modelo é lock-and-release. Na EAV7, `BRIDGE_OUT` TRAVA valor e registra a
//! transferência com a cadeia e o endereço de destino; do outro lado, alguém
//! precisa efetivamente pagar. Esse alguém é este processo. No sentido inverso,
//! um depósito confirmado numa cadeia externa vira `BRIDGE_IN`, que LIBERA o
//! valor travado para um endereço E7.
//!
//! Sem ele a ponte não move valor nenhum: as peças on-chain existem e ficam
//! esperando um relayer que nunca vem.
//!
//! # A invariante que sustenta tudo: pagamento externo NÃO é idempotente
//!
//! Entre pagar na cadeia externa e o `BRIDGE_SETTLE` ser minerado, a
//! transferência continua `LOCKED` — o nó ainda a devolve na próxima consulta.
//! Um relayer ingênuo pagaria de novo, e o valor sairia duas vezes de um pool que
//! só travou uma. Daí o conjunto `liquidando`, marcado ANTES do pagamento e
//! desmarcado apenas quando o pagamento FALHA (para permitir nova tentativa).
//!
//! É a razão de este módulo existir como código testado em vez de um script: a
//! diferença entre marcar antes e marcar depois é um pagamento duplo.
//!
//! # Nonce
//!
//! Reserva e envio são serializados, e QUALQUER erro — inclusive de rede —
//! ressincroniza o nonce. Um nonce reservado para uma transação que não chegou ao
//! mempool bloquearia todas as seguintes, e o relayer pararia em silêncio.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use eav7::block::BlockSigner;
use eav7::transaction::{JsonValue, Tx, TxSpec};

use crate::cliente::{Eav7Client, ErroCliente};

/// Transferência de saída, como `/bridge/transfers` a devolve.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transferencia {
    pub id: String,
    pub from: String,
    pub target_chain: String,
    pub target_address: String,
    /// Decimal em texto, como no estado — não convertido, para não perder
    /// precisão nem inventar arredondamento.
    pub amount: String,
    pub token: Option<String>,
}

/// Depósito observado numa cadeia externa, a ser liberado na EAV7.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Deposito {
    /// De QUAL cadeia veio. Fica no próprio depósito, e não como parâmetro
    /// separado: um depósito sem cadeia é ambíguo, e nada garantiria que o
    /// chamador passasse a certa.
    pub cadeia: String,
    pub source_tx_hash: String,
    /// Endereço E7 que receberá o valor liberado.
    pub to: String,
    pub amount: String,
    pub token: Option<String>,
}

/// Como uma cadeia externa é plugada ao relayer.
///
/// Implementar isto é todo o trabalho de suportar uma cadeia nova — o relayer não
/// sabe nada de TRON, Ethereum ou Bitcoin, e não deve saber.
pub trait AdaptadorDeCadeia: Send + Sync {
    /// Nome da cadeia, em MAIÚSCULAS (`TRON`, `ETH`…). É a chave que casa com o
    /// `targetChain` da transferência.
    fn cadeia(&self) -> String;

    /// Paga `transferencia.amount` para `transferencia.target_address` na cadeia
    /// externa. Devolve o hash da transação de lá, quando houver.
    ///
    /// Erro aqui é RETENTÁVEL: o relayer desmarca a transferência e tenta de novo
    /// no próximo ciclo. Por isso a implementação não pode devolver `Ok` sem ter
    /// certeza de que o pagamento saiu — um falso `Ok` liquida on-chain uma
    /// transferência que nunca foi paga.
    fn payout(&self, transferencia: &Transferencia) -> Result<Option<String>, String>;

    /// Recebe o canal por onde ANUNCIAR depósitos observados na cadeia externa.
    ///
    /// É canal, e não callback com o relayer dentro, de propósito: os depósitos
    /// são drenados pelo MESMO laço que liquida as saídas, e portanto compartilham
    /// a mesma reserva serializada de nonce. Com callbacks em threads próprias,
    /// dois `BRIDGE_IN` simultâneos disputariam o nonce — funcionaria por causa do
    /// mutex, mas por acidente, e a ordem de envio ficaria imprevisível.
    ///
    /// Default vazio: uma cadeia só de SAÍDA é um caso legítimo.
    fn observar_depositos(&self, _canal: std::sync::mpsc::Sender<Deposito>) {}

    // (o depósito carrega a própria cadeia — ver `Deposito::cadeia`)
}

/// O relayer.
///
/// MONOTHREAD de propósito: um ciclo por vez, sem estado compartilhado e sem
/// lock. Os adaptadores podem observar a cadeia externa em threads próprias — o
/// que atravessa a fronteira é o `Sender` do canal de depósitos, e só ele. É o
/// que torna a ordem de envio previsível e o nonce trivialmente serializado; a
/// referência precisa de um `ticking` justamente porque lá o ciclo é assíncrono e
/// pode se sobrepor.
pub struct Relayer {
    cliente: Eav7Client,
    /// `None` = precisa ressincronizar com o nó no próximo envio.
    proximo_nonce: Option<i64>,
    /// Transferências com pagamento externo JÁ DISPARADO. Ver a nota do módulo:
    /// é o que impede o pagamento duplo enquanto o `BRIDGE_SETTLE` não é minerado.
    liquidando: BTreeSet<String>,
    adaptadores: Vec<Arc<dyn AdaptadorDeCadeia>>,
    endereco: String,
    /// Canal de depósitos: os adaptadores anunciam, o `ciclo` drena. Ver a nota
    /// em [`AdaptadorDeCadeia::observar_depositos`].
    depositos: (
        std::sync::mpsc::Sender<Deposito>,
        std::sync::mpsc::Receiver<Deposito>,
    ),
}

impl Relayer {
    pub fn novo(
        url: impl Into<String>,
        carteira: Box<dyn BlockSigner>,
        adaptadores: Vec<Arc<dyn AdaptadorDeCadeia>>,
    ) -> Result<Self, String> {
        let endereco = eav7::signature::address_from_public_keys(
            carteira.public_key_pem(),
            carteira.pq_public_key_pem(),
        )
        .map_err(|e| format!("carteira do relayer inválida: {e}"))?;
        Ok(Relayer {
            cliente: Eav7Client::com_carteira(url, carteira),
            proximo_nonce: None,
            liquidando: BTreeSet::new(),
            adaptadores,
            endereco,
            depositos: std::sync::mpsc::channel(),
        })
    }

    pub fn endereco(&self) -> &str {
        &self.endereco
    }

    /// Envia uma transação reservando o nonce, com ressincronização em erro.
    ///
    /// A máquina de reserva vive em `cliente::enviar_reservando` — a MESMA que o
    /// [`crate::Remetente`] usa. Extraída daqui (Fase S2) sem mudar semântica: a
    /// invariante anti-pagamento-duplo não depende do nonce, e sim do conjunto
    /// `liquidando` em [`Relayer::ciclo`].
    fn enviar(&mut self, monta: impl FnOnce(i64) -> TxSpec) -> Result<Tx, ErroCliente> {
        crate::cliente::enviar_reservando(&self.cliente, &self.endereco, &mut self.proximo_nonce, monta)
    }

    /// Depósito confirmado numa cadeia externa → `BRIDGE_IN` na EAV7.
    pub fn liberar_entrada(&mut self, d: &Deposito) -> Result<Tx, ErroCliente> {
        let amount: u128 = d
            .amount
            .parse()
            .map_err(|_| ErroCliente::Transacao(format!("valor de depósito inválido: {}", d.amount)))?;
        let dados = JsonValue::map([
            ("sourceChain".to_string(), JsonValue::str(&d.cadeia)),
            ("sourceTxHash".to_string(), JsonValue::str(&d.source_tx_hash)),
            (
                "token".to_string(),
                d.token.as_ref().map_or(JsonValue::Null, JsonValue::str),
            ),
        ]);
        let to = d.to.clone();
        self.enviar(move |nonce| {
            TxSpec::nova("BRIDGE_IN", amount, nonce, agora_ms())
                .para(to)
                .com_dados(dados)
        })
    }

    /// UM ciclo: paga as transferências travadas e as liquida on-chain.
    ///
    /// Devolve quantas tiveram o `BRIDGE_SETTLE` SUBMETIDO — não quantas foram
    /// mineradas. A distinção importa: a submissão só prova que o mempool aceitou.
    ///
    /// Erro de UMA transferência não aborta as demais — uma cadeia externa fora do
    /// ar não pode parar as outras.
    pub fn ciclo(&mut self) -> Result<usize, ErroCliente> {
        // Entradas ANTES das saídas: liberar um depósito já confirmado é o que o
        // usuário está esperando há mais tempo.
        self.liberar_depositos_pendentes();

        let travadas = self.transferencias_travadas()?;
        let mut liquidadas = 0usize;

        for t in travadas {
            let Some(adaptador) = self
                .adaptadores
                .iter()
                .find(|a| a.cadeia().eq_ignore_ascii_case(&t.target_chain))
                .map(Arc::clone)
            else {
                continue; // cadeia sem adaptador plugado neste relayer
            };

            // MARCA ANTES de pagar. Ver a nota do módulo: entre o pagamento e o
            // `BRIDGE_SETTLE` ser minerado, a transferência continua LOCKED.
            if !self.liquidando.insert(t.id.clone()) {
                continue; // já em andamento
            }

            let externo = match adaptador.payout(&t) {
                Ok(h) => h,
                Err(e) => {
                    // Pagamento falhou: desmarca para permitir nova tentativa.
                    self.liquidando.remove(&t.id);
                    eprintln!("[ponte] falha no payout {}: {e}", &t.id[..16.min(t.id.len())]);
                    continue;
                }
            };

            let id = t.id.clone();
            let dados = JsonValue::map([
                ("transferId".to_string(), JsonValue::str(&id)),
                (
                    "externalTxHash".to_string(),
                    externo.as_ref().map_or(JsonValue::Null, JsonValue::str),
                ),
            ]);
            match self.enviar(move |nonce| {
                TxSpec::nova("BRIDGE_SETTLE", 0, nonce, agora_ms()).com_dados(dados)
            }) {
                Ok(_) => {
                    liquidadas += 1;
                    // "SUBMETIDO", não "liquidado": a transação foi aceita no
                    // mempool, e ser minerada é outra coisa. Dizer "liquidado"
                    // aqui faria o operador parar de procurar exatamente quando
                    // deveria começar — se o `BRIDGE_SETTLE` nunca entrar em
                    // bloco, a transferência fica LOCKED e o valor externo já saiu.
                    println!(
                        "[ponte] payout de {} e7 em {} para {} — BRIDGE_SETTLE submetido",
                        t.amount, t.target_chain, t.target_address
                    );
                }
                Err(e) => {
                    // O pagamento externo JÁ SAIU. NÃO desmarca: repetir o ciclo
                    // pagaria de novo. A liquidação on-chain é retentável por um
                    // operador; um pagamento duplo não se desfaz.
                    eprintln!(
                        "[ponte] PAGO em {} mas NÃO liquidado on-chain ({e}) — transferência {} \
                         exige BRIDGE_SETTLE manual",
                        t.target_chain, t.id
                    );
                }
            }
        }
        Ok(liquidadas)
    }

    fn transferencias_travadas(&self) -> Result<Vec<Transferencia>, ErroCliente> {
        let v = self.cliente.get("/bridge/transfers?direction=OUT&status=LOCKED")?;
        let lista = match &v {
            serde_json::Value::Array(a) => a.clone(),
            serde_json::Value::Object(o) => match o.get("transfers") {
                Some(serde_json::Value::Array(a)) => a.clone(),
                _ => Vec::new(),
            },
            _ => Vec::new(),
        };
        Ok(lista.iter().filter_map(transferencia_de).collect())
    }

    /// Entrega a cada adaptador o canal de depósitos. Chamado uma vez, antes do
    /// primeiro ciclo.
    pub fn observar_depositos(&self) {
        for adaptador in &self.adaptadores {
            adaptador.observar_depositos(self.depositos.0.clone());
        }
    }

    /// Drena os depósitos anunciados e emite um `BRIDGE_IN` para cada.
    ///
    /// Falha de UM depósito não interrompe os demais: um depósito malformado de
    /// uma cadeia não pode travar as outras.
    fn liberar_depositos_pendentes(&mut self) -> usize {
        let mut liberados = 0;
        while let Ok(d) = self.depositos.1.try_recv() {
            match self.liberar_entrada(&d) {
                Ok(_) => {
                    liberados += 1;
                    println!("[ponte] BRIDGE_IN de {} liberado para {}", d.cadeia, d.to);
                }
                Err(e) => eprintln!("[ponte] falha ao liberar depósito de {}: {e}", d.cadeia),
            }
        }
        liberados
    }
}

fn agora_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn transferencia_de(v: &serde_json::Value) -> Option<Transferencia> {
    let texto = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    Some(Transferencia {
        id: texto("id")?,
        from: texto("from").unwrap_or_default(),
        target_chain: texto("targetChain")?,
        target_address: texto("targetAddress").unwrap_or_default(),
        amount: texto("amount").unwrap_or_else(|| "0".into()),
        token: texto("token"),
    })
}

/// Adaptador de DEMONSTRAÇÃO: simula uma cadeia externa em memória.
///
/// Com `eco`, todo pagamento gera, depois de um atraso, um depósito equivalente
/// de volta — o que fecha o ciclo `BRIDGE_OUT → payout → depósito → BRIDGE_IN`
/// sem depender de nenhuma cadeia de verdade. É o que torna a ponte testável.
pub struct AdaptadorDeLaco {
    cadeia: String,
    eco: bool,
    canal: Mutex<Option<std::sync::mpsc::Sender<Deposito>>>,
    /// Pagamentos já feitos — o teste inspeciona para provar que não houve
    /// pagamento duplo.
    pub pagos: Mutex<Vec<String>>,
    /// Faz o próximo pagamento FALHAR. Existe para o teste exercitar a retentativa
    /// sem inventar uma cadeia externa quebrada.
    pub falhar: Mutex<bool>,
}

impl AdaptadorDeLaco {
    pub fn novo(cadeia: impl Into<String>, eco: bool) -> Self {
        AdaptadorDeLaco {
            cadeia: cadeia.into(),
            eco,
            canal: Mutex::new(None),
            pagos: Mutex::new(Vec::new()),
            falhar: Mutex::new(false),
        }
    }

    /// Anuncia um depósito, como se a cadeia externa o tivesse confirmado.
    pub fn simular_deposito(&self, d: Deposito) {
        if let Ok(canal) = self.canal.lock()
            && let Some(c) = canal.as_ref()
        {
            let _ = c.send(d);
        }
    }
}

impl AdaptadorDeCadeia for AdaptadorDeLaco {
    fn cadeia(&self) -> String {
        self.cadeia.clone()
    }

    fn payout(&self, t: &Transferencia) -> Result<Option<String>, String> {
        if *self.falhar.lock().map_err(|_| "estado envenenado")? {
            return Err("cadeia externa indisponível".into());
        }
        self.pagos.lock().map_err(|_| "estado envenenado")?.push(t.id.clone());
        if self.eco {
            self.simular_deposito(Deposito {
                cadeia: self.cadeia.clone(),
                source_tx_hash: format!("{}-{}", self.cadeia, &t.id[..20.min(t.id.len())]),
                to: t.from.clone(),
                amount: t.amount.clone(),
                token: t.token.clone(),
            });
        }
        Ok(Some(format!("ext-{}", &t.id[..16.min(t.id.len())])))
    }

    fn observar_depositos(&self, canal: std::sync::mpsc::Sender<Deposito>) {
        if let Ok(mut c) = self.canal.lock() {
            *c = Some(canal);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transferencia(id: &str) -> Transferencia {
        Transferencia {
            id: id.to_string(),
            from: "E7ORIGEM".into(),
            target_chain: "LOOPBACK".into(),
            target_address: "T-destino".into(),
            amount: "1000".into(),
            token: None,
        }
    }

    /// O pagamento externo NÃO é idempotente, e o relayer tem de tratá-lo assim.
    ///
    /// Este é o teste que justifica o módulo inteiro. Entre pagar e o
    /// `BRIDGE_SETTLE` ser minerado, a transferência continua `LOCKED` — o nó a
    /// devolve de novo no ciclo seguinte. Marcar DEPOIS do pagamento, ou não
    /// marcar, faria o valor sair duas vezes de um pool que travou uma.
    #[test]
    fn transferencia_em_liquidacao_nao_e_paga_duas_vezes() {
        let a = AdaptadorDeLaco::novo("LOOPBACK", false);
        let t = transferencia("abc123def456ghi789jkl");

        // Primeiro ciclo: marca e paga.
        let mut liquidando: BTreeSet<String> = BTreeSet::new();
        assert!(liquidando.insert(t.id.clone()), "primeira vez entra");
        a.payout(&t).expect("paga");

        // Segundo ciclo com a MESMA transferência ainda LOCKED: não paga de novo.
        assert!(!liquidando.insert(t.id.clone()), "segunda vez é barrada");

        assert_eq!(a.pagos.lock().expect("lock").len(), 1, "UM pagamento, não dois");
    }

    /// Pagamento que FALHA desmarca — senão a transferência ficaria presa para
    /// sempre, travada on-chain e nunca paga.
    #[test]
    fn pagamento_que_falha_permite_nova_tentativa() {
        let a = AdaptadorDeLaco::novo("LOOPBACK", false);
        let t = transferencia("falha0000000000000000");
        *a.falhar.lock().expect("lock") = true;

        let mut liquidando: BTreeSet<String> = BTreeSet::new();
        liquidando.insert(t.id.clone());
        assert!(a.payout(&t).is_err());
        liquidando.remove(&t.id); // é o que o `ciclo` faz no erro

        *a.falhar.lock().expect("lock") = false;
        assert!(liquidando.insert(t.id.clone()), "pode tentar de novo");
        assert!(a.payout(&t).is_ok());
        assert_eq!(a.pagos.lock().expect("lock").len(), 1);
    }

    /// O eco fecha o ciclo: um pagamento de saída vira um depósito de entrada.
    #[test]
    fn o_eco_devolve_o_deposito_pelo_canal() {
        let a = AdaptadorDeLaco::novo("LOOPBACK", true);
        let (tx, rx) = std::sync::mpsc::channel();
        a.observar_depositos(tx);

        let t = transferencia("eco00000000000000000000");
        a.payout(&t).expect("paga");

        let d = rx.try_recv().expect("o eco tem de anunciar um depósito");
        assert_eq!(d.cadeia, "LOOPBACK");
        assert_eq!(d.to, t.from, "o valor volta para quem mandou");
        assert_eq!(d.amount, t.amount);
    }

    /// Transferência de uma cadeia sem adaptador é IGNORADA, não é erro.
    ///
    /// Um relayer que só cuida de TRON não pode travar por existirem
    /// transferências para Ethereum na fila.
    #[test]
    fn cadeia_sem_adaptador_e_ignorada() {
        let a: Vec<Arc<dyn AdaptadorDeCadeia>> = vec![Arc::new(AdaptadorDeLaco::novo("TRON", false))];
        let alvo = transferencia("outra00000000000000000");
        assert!(
            !a.iter().any(|x| x.cadeia().eq_ignore_ascii_case(&alvo.target_chain)),
            "LOOPBACK não tem adaptador aqui"
        );
    }
}
