//! Mempool — o conjunto de transações pendentes do nó.
//!
//! # Nada aqui é consenso
//!
//! O mempool é NODE-LOCAL. Dois nós com políticas diferentes de admissão e poda
//! continuam na mesma cadeia: o que entra em bloco é decidido pelo produtor, e
//! validado pela máquina de estado, que não consulta mempool nenhum.
//!
//! Isso NÃO torna o módulo inconsequente, e a assimetria importa: uma poda frouxa
//! desperdiça memória, uma poda errada DESCARTA transação legítima que o usuário
//! já assinou e pagou para propagar. Por isso as regras abaixo são portadas ao pé
//! da letra de `src/core/mempool.js`, com os operadores de comparação incluídos
//! (`<=` no nonce, `<` no timestamp — trocar um por outro muda quem sobrevive).
//!
//! # A deduplicação é por `id`, e é uma defesa
//!
//! O `id` da eav20 deriva SÓ do payload canônico (ver `transaction::tx_signing_payload`):
//! assinatura e `pqSignature` ficam de fora. A consequência é a que este módulo
//! explora: remodelar uma assinatura ECDSA de `s` para `N-s` — ou reordenar os
//! hints de uma ML-DSA — produz bytes de assinatura diferentes e o MESMO `id`.
//! A chave do mapa captura a cópia. Se o `id` incluísse a assinatura, a mesma
//! transação entraria quantas vezes o atacante quisesse remodelá-la.

use crate::state::State;
use crate::transaction::{tx_dedup_id, Tx};
use std::collections::HashSet;

// ---------------------------------------------------------------- constantes
//
// Vêm de `crate::config`, que é GERADO de `src/config.js` — a fonte única. Os
// aliases abaixo existem só para dar o TIPO que este módulo usa (o gerado é
// sempre `u64`) e para documentar o PORQUÊ de cada valor, que o arquivo gerado
// não carrega. Nenhum valor é redigitado aqui: mudar `src/config.js` e regerar
// continua sendo suficiente.

/// Tempo de vida de uma transação no mempool, em milissegundos. Origem:
/// `src/config.js:278` (`MEMPOOL_TTL_MS: 6 * 60 * 60 * 1000`).
///
/// `i64` com sinal, e não o `u64` do gerado, porque a comparação é contra
/// `Tx::timestamp`, que é `i64` por ser ENTRADA NÃO CONFIÁVEL — pode chegar
/// negativa. Misturar as larguras aqui exigiria um cast no meio da regra de
/// poda, que é o lugar onde um estouro em silêncio descarta transação legítima.
///
/// Existe por um caso que a poda por nonce NÃO cobre: uma transação com LACUNA de
/// nonce (nonce 7 quando a conta está no 4) nunca executa, portanto nunca tem o
/// nonce ultrapassado, portanto nunca é podada — fica residente para sempre,
/// ocupando a cota do mempool e podendo ser reintroduzida meses depois, num
/// contexto totalmente diferente daquele em que foi assinada.
///
/// A TRON resolve o mesmo problema com um campo `expiration` no payload, o que é
/// mudança de CONSENSO. Esta é a mitigação barata: node-local, sem fork.
pub const MEMPOOL_TTL_MS: i64 = crate::config::MEMPOOL_TTL_MS as i64;

/// Teto de transações por bloco. Origem: `src/config.js:36` (`MAX_TXS_PER_BLOCK: 500`).
pub const MAX_TXS_PER_BLOCK: usize = crate::config::MAX_TXS_PER_BLOCK as usize;

/// Teto de transações residentes. Origem: `src/config.js:272` (`MAX_MEMPOOL: 5_000`).
///
/// Declarada aqui mas NÃO aplicada em `add`, de propósito: na referência quem
/// recusa por lotação é a camada de nó (`src/node/node.js:206`), antes de chamar
/// `add`. Aplicá-la aqui também mudaria o comportamento — a classe passaria a
/// rejeitar em silêncio onde hoje o nó devolve erro ao cliente. Use `is_full`.
pub const MAX_MEMPOOL: usize = crate::config::MAX_MEMPOOL as usize;

// ------------------------------------------------------------------ o mempool

/// Conjunto de transações pendentes, indexado por `id`.
///
/// A referência usa um `Map` do JavaScript, que preserva ORDEM DE INSERÇÃO — e a
/// seleção depende disso: `selectExecutable` ordena por `(nonce, timestamp)` com
/// `Array.prototype.sort`, que é estável por especificação, então o desempate
/// final entre duas transações de remetentes diferentes com o mesmo par é a ordem
/// de chegada. Um `BTreeMap` por `id` daria ordem por hash — determinística, mas
/// OUTRA, e a seleção divergiria da referência em bloco cheio. Daí o vetor
/// ordenado + conjunto de ids, em vez do mapa direto.
#[derive(Debug, Default)]
pub struct Mempool {
    /// `(id, transação)` em ordem de chegada.
    entradas: Vec<(String, Tx)>,
    /// Espelho dos ids para `has`/`add` em O(1).
    ids: HashSet<String>,
}

impl Mempool {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.entradas.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entradas.is_empty()
    }

    /// Lotado segundo `MAX_MEMPOOL`. Quem decide o que fazer é o chamador — ver a
    /// nota na constante.
    pub fn is_full(&self) -> bool {
        self.entradas.len() >= MAX_MEMPOOL
    }

    pub fn has(&self, id: &str) -> bool {
        self.ids.contains(id)
    }

    /// Todas as pendentes, em ordem de chegada.
    pub fn all(&self) -> Vec<&Tx> {
        self.entradas.iter().map(|(_, tx)| tx).collect()
    }

    pub fn get(&self, id: &str) -> Option<&Tx> {
        self.entradas.iter().find(|(i, _)| i == id).map(|(_, tx)| tx)
    }

    /// Insere se ainda não houver transação com o mesmo `id`. `Ok(false)` é a
    /// duplicata — não é erro, é o caso normal quando dois pares propagam a mesma
    /// transação.
    ///
    /// # Por que o `id` é RECALCULADO e não lido do campo
    ///
    /// A referência confia no `tx.id` que já vem no objeto — e pode confiar: o
    /// caminho que alimenta o mempool (`node.js:194`) roda `verifyTransaction`
    /// ANTES, e essa função confere o `id` contra o payload canônico. Não há
    /// buraco lá.
    ///
    /// Aqui o `id` é recomputado mesmo assim, como DEFESA EM PROFUNDIDADE, não
    /// como correção: este módulo é uma biblioteca e não controla quem o chama.
    /// Um chamador futuro que esqueça a verificação abriria a porta para um par
    /// enviar a mesma transação com N ids inventados, ocupando N entradas e
    /// derrotando a deduplicação — que é o mecanismo que este módulo existe para
    /// ter. Com a conferência aqui, esquecer lá deixa de ser fatal.
    ///
    /// Para entrada válida o resultado é idêntico ao da referência: o `id` sempre
    /// bate, e nada muda. O custo é uma SHA3-256 por
    /// inserção, e a alternativa (confiar no campo) só é segura se todo chamador
    /// tiver rodado `verify_transaction` antes, o que não é verificável aqui.
    pub fn add(&mut self, tx: Tx) -> Result<bool, String> {
        // Id recomputado CIENTE DO ESQUEMA: o padrão deriva do payload
        // (`tx_id`), o EAVM do RAW assinado (`tx_dedup_id`). Recomputar sempre
        // pelo payload rejeitaria toda tx EAVM — cujo id legítimo é o hash do raw.
        let id = tx_dedup_id(&tx);
        if tx.id.as_deref() != Some(id.as_str()) {
            return Err("id da transação não confere com o payload".into());
        }
        if self.ids.contains(&id) {
            return Ok(false);
        }
        self.ids.insert(id.clone());
        self.entradas.push((id, tx));
        Ok(true)
    }

    /// Remove por `id`. Ids ausentes são ignorados, como o `Map.delete` da referência.
    pub fn remove<I, S>(&mut self, ids: I)
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let alvo: HashSet<String> = ids.into_iter().map(|s| s.as_ref().to_string()).collect();
        if alvo.is_empty() {
            return;
        }
        self.entradas.retain(|(id, _)| !alvo.contains(id));
        self.ids.retain(|id| !alvo.contains(id));
    }

    /// PODA. Duas regras que só funcionam JUNTAS — ver `src/core/mempool.js:34`.
    ///
    /// 1. Nonce já consumido no estado (`tx.nonce <= nonce da conta`): a transação
    ///    ou já entrou em bloco, ou foi substituída por outra do mesmo nonce.
    ///    Reexecutá-la é impossível, mantê-la é puro desperdício.
    ///
    /// 2. Mais velha que `MEMPOOL_TTL_MS` (`tx.timestamp < agora - TTL`): fecha o
    ///    caso da lacuna de nonce, que a regra 1 nunca alcança. Ver a constante.
    ///
    /// `now_ms` é parâmetro e não `SystemTime::now()` para que a regra seja
    /// testável e para que o chamador use o mesmo relógio do resto do nó.
    pub fn prune(&mut self, state: &State, now_ms: i64) {
        // Em `i128` porque `now_ms` vem de fora: um relógio absurdo (ou zero, num
        // teste) faria `now - TTL` estourar por baixo em `i64`. Estouro em release
        // com `overflow-checks = true` seria pânico — e pânico no caminho de poda
        // derruba o nó por causa de um relógio torto.
        let limite = i128::from(now_ms) - i128::from(MEMPOOL_TTL_MS);
        let vencida = |tx: &Tx| i128::from(tx.timestamp) < limite;
        let consumida = |tx: &Tx| {
            let nonce = state.accounts.get(&tx.from).map(|a| a.nonce).unwrap_or(0);
            i128::from(tx.nonce) <= i128::from(nonce)
        };
        let mut removidos: HashSet<String> = HashSet::new();
        self.entradas.retain(|(id, tx)| {
            if consumida(tx) || vencida(tx) {
                removidos.insert(id.clone());
                false
            } else {
                true
            }
        });
        self.ids.retain(|id| !removidos.contains(id));
    }

    /// Seleciona um conjunto EXECUTÁVEL simulando as transações num clone do estado.
    ///
    /// O laço externo repete enquanto houver progresso porque a ordem de `(nonce,
    /// timestamp)` é global e não por remetente: a transação de nonce 2 do Bob
    /// pode aparecer antes da de nonce 1 da Alice na lista ordenada, falhar por
    /// nonce fora de ordem, e só passar na varredura seguinte, depois que a
    /// anterior DELE entrar. Sem a repetição, uma sequência de um mesmo remetente
    /// entraria a um bloco por transação.
    ///
    /// Falha na simulação não é descarte imediato — pode ser só nonce-futuro
    /// esperando as anteriores. Quem decide é a varredura final, abaixo.
    pub fn select_executable(
        &mut self,
        state: &State,
        height: u64,
        block_ts: u64,
        max: usize,
    ) -> Vec<Tx> {
        let mut sim = state.clone();
        // Estável (`sort_by` do Rust é): empate em `(nonce, timestamp)` mantém a
        // ordem de chegada, como o `Array.prototype.sort` da referência.
        let mut pendentes: Vec<(String, Tx)> = self.entradas.clone();
        pendentes.sort_by(|(_, a), (_, b)| {
            a.nonce.cmp(&b.nonce).then(a.timestamp.cmp(&b.timestamp))
        });

        let mut selecionadas: Vec<Tx> = Vec::new();
        let mut escolhidos: HashSet<String> = HashSet::new();

        let mut progresso = true;
        while progresso && selecionadas.len() < max {
            progresso = false;
            for (id, tx) in &pendentes {
                if selecionadas.len() >= max {
                    break;
                }
                if escolhidos.contains(id) {
                    continue;
                }
                // `apply_transaction` garante que um `Err` deixa o estado
                // EXATAMENTE como estava (ver o doc dele) — é isso que permite
                // continuar simulando sobre o mesmo `sim` depois de uma falha,
                // em vez de reclonar o estado a cada tentativa.
                if sim.apply_transaction(tx, height, block_ts).is_ok() {
                    selecionadas.push(tx.clone());
                    escolhidos.insert(id.clone());
                    progresso = true;
                }
            }
        }

        // Convergiu (nenhum progresso na última varredura). Agora qualquer não
        // escolhida cujo nonce seja <= próximo-esperado é PERMANENTEMENTE inválida
        // neste ponto: ou o nonce já foi consumido, ou ela É a próxima esperada e
        // falhou no manipulador (saldo, prova, regra de domínio). Podar é o que
        // impede uma transação cripto-cara que sempre lança (prova inválida,
        // slash forjado, atestação de ponte quebrada) de ser reexecutada a cada
        // bloco, de graça — que é um DoS de CPU sem custo para quem o monta.
        let mut obsoletas: Vec<String> = Vec::new();
        for (id, tx) in &pendentes {
            if escolhidos.contains(id) {
                continue;
            }
            let nonce = sim.accounts.get(&tx.from).map(|a| a.nonce).unwrap_or(0);
            if i128::from(tx.nonce) <= i128::from(nonce) + 1 {
                obsoletas.push(id.clone());
            }
        }
        self.remove(obsoletas);
        selecionadas
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::address::derive_address_from;
    use crate::transaction::{tx_id, JsonValue};

    const AGORA: i64 = 1_800_000_000_000;

    fn alice() -> String {
        derive_address_from("MEMPOOL:alice")
    }
    fn bob() -> String {
        derive_address_from("MEMPOOL:bob")
    }

    /// TRANSFER pronta para entrar no mempool, com o `id` já calculado.
    fn tx(de: &str, para: &str, nonce: i64, timestamp: i64) -> Tx {
        let mut t = Tx::new("TRANSFER", de, nonce, timestamp);
        t.to = Some(para.to_string());
        t.amount = "1000000".into();
        t.data = Some(JsonValue::map([]));
        t.public_key = Some("pk".into());
        t.pq_public_key = Some("pqpk".into());
        t.signature = Some("sig".into());
        t.pq_signature = Some("pqsig".into());
        t.id = Some(tx_id(&t));
        t
    }

    fn estado_com_saldo() -> State {
        let mut s = State::new();
        s.account_mut(&alice()).balance = 1_000_000_000;
        s.account_mut(&bob()).balance = 1_000_000_000;
        s
    }

    #[test]
    fn a_mesma_transacao_so_entra_uma_vez() {
        let mut m = Mempool::new();
        let t = tx(&alice(), &bob(), 1, AGORA);
        assert_eq!(m.add(t.clone()), Ok(true));
        assert_eq!(m.add(t.clone()), Ok(false), "duplicata exata");
        assert_eq!(m.len(), 1);
        assert!(m.has(t.id.as_deref().unwrap_or("")));
    }

    #[test]
    fn assinatura_remodelada_nao_burla_a_deduplicacao() {
        // O caso que a dedup por `id` existe para cobrir: mesmos bytes de payload,
        // assinatura diferente. O `id` não muda, então a cópia não entra.
        let mut m = Mempool::new();
        let t = tx(&alice(), &bob(), 1, AGORA);
        let mut remodelada = t.clone();
        remodelada.signature = Some("OUTRA-ASSINATURA-MESMO-PAYLOAD".into());
        remodelada.pq_signature = Some("OUTRA-PQ".into());
        assert_eq!(remodelada.id, t.id, "o id não pode depender da assinatura");
        assert_eq!(m.add(t), Ok(true));
        assert_eq!(m.add(remodelada), Ok(false));
        assert_eq!(m.len(), 1);
    }

    #[test]
    fn id_forjado_e_recusado_na_entrada() {
        let mut m = Mempool::new();
        let mut t = tx(&alice(), &bob(), 1, AGORA);
        t.id = Some("0".repeat(64));
        assert!(m.add(t).is_err(), "id inventado ocuparia entrada extra no mapa");
        assert_eq!(m.len(), 0);
    }

    #[test]
    fn poda_por_nonce_ultrapassado() {
        let mut m = Mempool::new();
        let mut estado = estado_com_saldo();
        estado.account_mut(&alice()).nonce = 5;

        let consumida = tx(&alice(), &bob(), 5, AGORA); // == nonce da conta
        let antiga = tx(&alice(), &bob(), 3, AGORA); // < nonce da conta
        let futura = tx(&alice(), &bob(), 6, AGORA); // ainda executável
        assert_eq!(m.add(consumida.clone()), Ok(true));
        assert_eq!(m.add(antiga.clone()), Ok(true));
        assert_eq!(m.add(futura.clone()), Ok(true));

        m.prune(&estado, AGORA);

        assert_eq!(m.len(), 1, "só a de nonce futuro sobrevive");
        assert!(m.has(futura.id.as_deref().unwrap_or("")));
        assert!(!m.has(consumida.id.as_deref().unwrap_or("")));
        assert!(!m.has(antiga.id.as_deref().unwrap_or("")));
    }

    #[test]
    fn poda_por_ttl_alcanca_a_lacuna_de_nonce() {
        let mut m = Mempool::new();
        let estado = estado_com_saldo(); // nonce da conta = 0

        // Lacuna de nonce: nunca executa, logo a regra do nonce NUNCA a alcança.
        let residente = tx(&alice(), &bob(), 99, AGORA - MEMPOOL_TTL_MS - 1);
        let recente = tx(&alice(), &bob(), 98, AGORA - MEMPOOL_TTL_MS + 1);
        assert_eq!(m.add(residente.clone()), Ok(true));
        assert_eq!(m.add(recente.clone()), Ok(true));

        m.prune(&estado, AGORA);

        assert!(!m.has(residente.id.as_deref().unwrap_or("")), "vencida sai");
        assert!(m.has(recente.id.as_deref().unwrap_or("")), "dentro do TTL fica");
        assert_eq!(m.len(), 1);
    }

    #[test]
    fn a_borda_do_ttl_e_inclusiva() {
        // A referência usa `<` estrito: exatamente no limite a transação FICA.
        let mut m = Mempool::new();
        let no_limite = tx(&alice(), &bob(), 42, AGORA - MEMPOOL_TTL_MS);
        assert_eq!(m.add(no_limite.clone()), Ok(true));
        m.prune(&estado_com_saldo(), AGORA);
        assert!(m.has(no_limite.id.as_deref().unwrap_or("")));
    }

    #[test]
    fn poda_com_relogio_zerado_nao_entra_em_panico() {
        // `now - TTL` fica negativo; em `i64` com overflow-checks isso seria pânico
        // se a conta não fosse feita em largura maior.
        let mut m = Mempool::new();
        assert_eq!(m.add(tx(&alice(), &bob(), 1, 1)), Ok(true));
        m.prune(&estado_com_saldo(), 0);
        m.prune(&estado_com_saldo(), i64::MIN);
        assert_eq!(m.len(), 1, "timestamp 1 não é anterior a um limite negativo");
    }

    #[test]
    fn selecao_respeita_a_ordem_de_nonce_do_mesmo_remetente() {
        let mut m = Mempool::new();
        let estado = estado_com_saldo();
        // Inseridas fora de ordem de propósito.
        assert_eq!(m.add(tx(&alice(), &bob(), 3, AGORA)), Ok(true));
        assert_eq!(m.add(tx(&alice(), &bob(), 1, AGORA)), Ok(true));
        assert_eq!(m.add(tx(&alice(), &bob(), 2, AGORA)), Ok(true));

        let sel = m.select_executable(&estado, 1, AGORA as u64, MAX_TXS_PER_BLOCK);

        assert_eq!(sel.len(), 3);
        assert_eq!(sel.iter().map(|t| t.nonce).collect::<Vec<_>>(), vec![1, 2, 3]);
    }

    #[test]
    fn selecao_poda_a_permanentemente_invalida() {
        let mut m = Mempool::new();
        let mut estado = State::new();
        estado.account_mut(&alice()).balance = 1; // não cobre o `amount`

        let sem_fundo = tx(&alice(), &bob(), 1, AGORA);
        assert_eq!(m.add(sem_fundo.clone()), Ok(true));

        let sel = m.select_executable(&estado, 1, AGORA as u64, MAX_TXS_PER_BLOCK);

        assert!(sel.is_empty());
        assert_eq!(m.len(), 0, "sempre falha no nonce esperado: reexecutá-la a cada bloco é DoS");
    }

    #[test]
    fn selecao_preserva_a_de_nonce_futuro() {
        // Lacuna: nonce 3 com a conta no 0. Não é permanentemente inválida — as
        // anteriores podem chegar depois. Só o TTL a remove.
        let mut m = Mempool::new();
        let futura = tx(&alice(), &bob(), 3, AGORA);
        assert_eq!(m.add(futura.clone()), Ok(true));
        let sel = m.select_executable(&estado_com_saldo(), 1, AGORA as u64, MAX_TXS_PER_BLOCK);
        assert!(sel.is_empty());
        assert_eq!(m.len(), 1, "nonce-futuro espera, não é podada");
    }

    #[test]
    fn selecao_respeita_o_teto_do_bloco() {
        let mut m = Mempool::new();
        for n in 1..=5 {
            assert_eq!(m.add(tx(&alice(), &bob(), n, AGORA)), Ok(true));
        }
        let sel = m.select_executable(&estado_com_saldo(), 1, AGORA as u64, 2);
        assert_eq!(sel.len(), 2);
    }

    #[test]
    fn remove_ignora_id_inexistente() {
        let mut m = Mempool::new();
        let t = tx(&alice(), &bob(), 1, AGORA);
        assert_eq!(m.add(t.clone()), Ok(true));
        m.remove(["nao-existe"]);
        assert_eq!(m.len(), 1);
        m.remove([t.id.clone().unwrap_or_default()]);
        assert_eq!(m.len(), 0);
        assert!(!m.has(t.id.as_deref().unwrap_or("")));
    }
}
