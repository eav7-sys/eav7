//! Enumeração das folhas do `stateRoot`.
//!
//! Espelha `stateLeaves` de `src/core/stateroot.js`. É a peça que amarra todos os
//! domínios: cada seção do estado vira folhas `leaf(domínio, chave, valor)`, e a
//! raiz é o Merkle das folhas ORDENADAS.
//!
//! # Por que isto é perigoso
//!
//! Uma seção esquecida aqui NÃO quebra teste nenhum — ela simplesmente não entra
//! na raiz. Dois estados que difiram só nessa seção produzem a MESMA raiz, e os
//! nós divergem sem detecção. É o modo de falha mais silencioso do protocolo.
//!
//! Por isso a lista de domínios é conferida contra a referência em teste, e há um
//! teste que falha se uma seção nova aparecer no `State` sem folha correspondente.

use super::{ai, bridge, contracts, gov, nft, token, value, Account, Amount, State};
use crate::canonical::Value;
use crate::stateroot::leaf;
use std::collections::BTreeMap;

/// Os domínios, na grafia EXATA da referência. Mudar qualquer string aqui muda
/// toda a raiz da rede.
pub const DOMINIOS: &[&str] = &[
    "meta", "acct", "tok", "nft", "name", "ctr", "orc", "vote", "cvotes", "perm",
    "pop", "pperm", "pcomm", "deleg", "gov", "treasury", "slash", "unbond", "vest",
    "comm", "racc", "rdebt", "ai", "attest", "brg",
];

fn mapa_de<V, F>(m: &BTreeMap<String, V>, f: F) -> Value
where
    F: Fn(&V) -> Value,
{
    Value::Map(m.iter().map(|(k, v)| (k.clone(), f(v))).collect())
}

fn mapa_amount(m: &BTreeMap<String, u128>) -> Value {
    mapa_de(m, |v| Value::uint(*v))
}

impl State {
    /// Todas as folhas do estado de consenso, em qualquer ordem.
    ///
    /// `compute_state_root` ordena antes de reduzir, então a ordem de emissão aqui
    /// é irrelevante — mas o CONJUNTO não é.
    pub fn state_leaves(&self) -> Result<Vec<String>, crate::canonical::Error> {
        let mut f = Vec::new();
        self.enumerar(|dom, chave, v| {
            f.push(leaf(dom, chave, v)?);
            Ok(())
        })?;
        Ok(f)
    }

    /// TRAVESSIA ÚNICA do estado de consenso: `(domínio, chave, valor canônico)`.
    ///
    /// Existe uma só, e tanto [`Self::state_leaves`] quanto a serialização do
    /// snapshot passam por ela. Uma segunda travessia — ainda que "igual" no dia
    /// em que fosse escrita — seria uma segunda definição de "o que é o estado",
    /// e as duas divergiriam no primeiro domínio novo: uma entra na raiz e a
    /// outra não, ou o snapshot restaura um estado que a raiz não descreve.
    ///
    /// A ORDEM de visita é irrelevante para a raiz (as folhas são ordenadas antes
    /// da redução) e irrelevante para o snapshot (a saída é um mapa ordenado).
    fn enumerar<F>(&self, mut push: F) -> Result<(), crate::canonical::Error>
    where
        F: FnMut(&str, &str, &Value) -> Result<(), crate::canonical::Error>,
    {

        push("meta", "totalMinted", &Value::uint(self.total_minted))?;
        push("meta", "totalBurned", &Value::uint(self.total_burned))?;

        for (addr, acc) in &self.accounts {
            push("acct", addr, &acc.to_value())?;
        }
        for (id, tok) in &self.tokens {
            push("tok", id, &tok.to_value())?;
        }
        for (id, col) in &self.nfts {
            push("nft", id, &col.to_value())?;
        }
        for (nome, rec) in &self.names {
            push("name", nome, &rec.to_value())?;
        }
        // Contratos EAVM — `leaf('ctr', addr, {code, storage, balance, nonce})`,
        // como em `src/core/stateroot.js:74`. Posição espelha a da referência
        // (depois de `name`), embora a ordem de emissão seja irrelevante: as
        // folhas são ordenadas antes da redução.
        for (addr, c) in &self.contracts {
            push("ctr", addr, &c.to_value())?;
        }
        for (addr, votos) in &self.votes {
            // TEXTO, não inteiro: `#applyVote` grava `rec[c] = a.toString()`
            // (state.js:438) — o valor do voto entra no estado como STRING crua,
            // e a folha o codifica com a tag de texto (0x04). Emitir inteiro aqui
            // dava outra pré-imagem e outra raiz em TODA conta que vota; a prova
            // de replay pegou exatamente isto. Note o contraste deliberado com
            // `cvotes`/`rdebt`/`deleg`, que a referência guarda como BigInt e
            // portanto seguem com a tag de inteiro.
            push("vote", addr, &mapa_de(votos, |v| Value::str(v.to_string())))?;
        }
        for (addr, total) in &self.candidate_votes {
            push("cvotes", addr, &Value::uint(*total))?;
        }
        for (addr, pct) in &self.commission {
            push("comm", addr, &Value::uint(*pct))?;
        }
        for (addr, (pct, altura)) in &self.pending_commission {
            let mut m = BTreeMap::new();
            m.insert("pct".to_string(), Value::uint(*pct));
            m.insert("activeAt".to_string(), Value::uint(*altura));
            push("pcomm", addr, &Value::Map(m))?;
        }
        for (dono, destinos) in &self.delegations {
            push("deleg", dono, &mapa_amount(destinos))?;
        }
        for (addr, acumulado) in &self.reward_acc_per_vote {
            push("racc", addr, &Value::uint(*acumulado))?;
        }
        for (eleitor, por_validador) in &self.voter_reward_debt {
            push("rdebt", eleitor, &mapa_amount(por_validador))?;
        }

        // Os valores de `params` são INTEIROS decimais e a referência os guarda como
        // `BigInt`/`Number` — que o codificador canônico marca com a tag de inteiro
        // (0x03), NÃO texto (0x04). Emitir `Value::str` aqui divergiria da rede assim
        // que qualquer override de governança maturasse. `Value::Int` aceita o decimal
        // canônico direto, que é como `matura_propostas` o grava.
        push("gov", "params", &Value::Map(
            self.params.iter().map(|(k, v)| (k.clone(), Value::Int(v.clone()))).collect(),
        ))?;
        push("treasury", "balance", &Value::uint(self.treasury))?;
        push("slash", "set", &Value::Map(
            self.slashed.iter().map(|(k, v)| (k.clone(), Value::Bool(*v))).collect(),
        ))?;

        // A fila de unbonding é uma LISTA, não um mapa: a ordem importa e é a de
        // inserção. Ordenar aqui mudaria a folha.
        //
        // Os NOMES e as TAGS dos campos são os da referência (`state.js:478` e
        // `:1334` gravam `{address, amount: amt.toString(), matureAt}`), e as duas
        // coisas já estiveram erradas aqui: a chave era `height` (a referência usa
        // `matureAt`) e `amount` saía como INTEIRO (tag 0x03) onde a referência
        // emite TEXTO (tag 0x04, porque é `BigInt.toString()`). Qualquer uma das
        // duas dá folha diferente no PRIMEIRO `UNSTAKE` da rede — o nó Rust
        // recusaria o bloco por raiz divergente e pararia ali.
        push("unbond", "queue", &Value::List(
            self.unbonding.iter().map(|(dono, valor, matura)| {
                let mut m = BTreeMap::new();
                m.insert("address".to_string(), Value::str(dono.clone()));
                m.insert("amount".to_string(), Value::str(valor.to_string()));
                m.insert("matureAt".to_string(), Value::uint(*matura));
                Value::Map(m)
            }).collect(),
        ))?;

        // ---- domínios que dependem dos tipos de cada módulo ----
        for (addr, perm) in &self.permissions {
            push("perm", addr, &perm.to_value())?;
        }
        for (id, op) in &self.pending_ops {
            push("pop", id, &op.to_value())?;
        }
        for (addr, pp) in &self.pending_perm {
            push("pperm", addr, &pp.to_value())?;
        }
        for (id, prop) in &self.proposals {
            push("gov", id, &prop.to_value())?;
        }
        for (addr, orc) in &self.oracles {
            push("orc", addr, &orc.to_value())?;
        }
        for (id, tarefa) in &self.ai_tasks {
            push("ai", id, &tarefa.to_value())?;
        }
        // Atestadores só emitem folha quando NÃO-vazio — é o que preserva a raiz
        // histórica de antes do fork da Fase 6, quando o registro nascia vazio.
        for (id, at) in &self.ai_attesters {
            push("attest", id, &at.to_value())?;
        }
        for (id, v) in &self.vesting {
            push("vest", id, &v.to_value())?;
        }
        push("brg", "state", &self.bridge.to_value())?;
        push("brg", "relayers", &Value::Map(
            self.bridge_relayers.iter().map(|r| (r.clone(), Value::Bool(true))).collect(),
        ))?;
        push("brg", "committees", &Value::Map(
            self.bridge_source_committees.iter().map(|(c, com)| (c.clone(), com.to_value())).collect(),
        ))?;

        Ok(())
    }

    /// O estado de consenso na forma canônica: `{domínio: {chave: valor}}`.
    ///
    /// É a pré-imagem do snapshot de boot. Vem da MESMA travessia que produz as
    /// folhas do `stateRoot` ([`Self::enumerar`]) — então o que o snapshot grava
    /// é, por construção, exatamente o que a raiz cobre. Recarregar e recomputar
    /// a raiz é o que PROVA que o arquivo é o estado que a rede acordou; um
    /// snapshot montado por outro caminho não teria essa propriedade.
    pub fn to_snapshot_value(&self) -> Result<Value, crate::canonical::Error> {
        let mut dominios: BTreeMap<String, BTreeMap<String, Value>> = BTreeMap::new();
        self.enumerar(|dom, chave, v| {
            dominios.entry(dom.to_string()).or_default().insert(chave.to_string(), v.clone());
            Ok(())
        })?;
        Ok(Value::Map(
            dominios.into_iter().map(|(d, m)| (d, Value::Map(m))).collect(),
        ))
    }

    /// Reconstrói o estado a partir da forma canônica — o inverso de
    /// [`Self::to_snapshot_value`], e o caminho de leitura do snapshot de boot.
    ///
    /// # Por que despachar por domínio e não por tipo
    ///
    /// O domínio é o único lugar onde a informação existe: a folha guarda
    /// `{domínio: {chave: valor}}`, e dois domínios diferentes têm valores de forma
    /// idêntica (`cvotes` e `racc` são os dois um inteiro por endereço). Adivinhar
    /// pelo formato colocaria um no campo do outro sem erro nenhum.
    ///
    /// # O que a ausência significa
    ///
    /// Os domínios ESCALARES (`meta`, `gov:params`, `treasury`, `slash`, `unbond`,
    /// `brg`) são emitidos SEMPRE, inclusive no estado vazio — a falta de qualquer
    /// um deles é arquivo incompleto, e completá-lo com o padrão daria um estado
    /// que recodifica noutra folha. Os de MAPA só têm entrada por registro, e um
    /// mapa vazio simplesmente não aparece.
    ///
    /// # Entrada não confiável
    ///
    /// O arquivo vem de disco. Qualquer campo de tipo errado, domínio não
    /// declarado ou chave a mais devolve `None` — o chamador descarta o snapshot e
    /// faz replay, que é lento mas correto. Recompor o estado pela metade seria
    /// pior: o nó subiria com uma raiz que ninguém acordou.
    pub fn from_snapshot_value(v: &Value) -> Option<State> {
        let dominios = v.mapa()?;
        for fixo in ["meta", "gov", "treasury", "slash", "unbond", "brg"] {
            dominios.get(fixo)?;
        }

        let mut s = State::new();
        for (dominio, conteudo) in dominios {
            let m = conteudo.mapa()?;
            match dominio.as_str() {
                "meta" => {
                    if m.len() != 2 {
                        return None;
                    }
                    s.total_minted = m.get("totalMinted")?.inteiro()?;
                    s.total_burned = m.get("totalBurned")?.inteiro()?;
                }
                "acct" => {
                    for (addr, x) in m {
                        s.accounts.insert(addr.clone(), Account::from_value(x)?);
                    }
                }
                "tok" => {
                    for (id, x) in m {
                        s.tokens.insert(id.clone(), token::Token::from_value(x)?);
                    }
                }
                "nft" => {
                    for (id, x) in m {
                        s.nfts.insert(id.clone(), nft::Collection::from_value(x)?);
                    }
                }
                "name" => {
                    for (nome, x) in m {
                        s.names.insert(nome.clone(), nft::NameRecord::from_value(x)?);
                    }
                }
                "ctr" => {
                    for (addr, x) in m {
                        s.contracts.insert(addr.clone(), contracts::Contract::from_value(x)?);
                    }
                }
                // TEXTO, não inteiro — ver o comentário do `push("vote", …)` em
                // `enumerar`. Ler com a tag de inteiro devolveria `None` e o boot
                // rápido nunca funcionaria em rede com votação.
                "vote" => {
                    for (eleitor, x) in m {
                        let alocacao: BTreeMap<String, Amount> = x
                            .mapa()?
                            .iter()
                            .map(|(cand, val)| Some((cand.clone(), val.decimal_em_texto()?)))
                            .collect::<Option<_>>()?;
                        s.votes.insert(eleitor.clone(), alocacao);
                    }
                }
                "cvotes" => {
                    for (addr, x) in m {
                        s.candidate_votes.insert(addr.clone(), x.inteiro()?);
                    }
                }
                "comm" => {
                    for (addr, x) in m {
                        s.commission.insert(addr.clone(), x.inteiro()?);
                    }
                }
                "pcomm" => {
                    for (addr, x) in m {
                        let p = x.mapa()?;
                        if p.len() != 2 {
                            return None;
                        }
                        let pct = p.get("pct")?.inteiro()?;
                        let altura = p.get("activeAt")?.inteiro()?;
                        s.pending_commission.insert(addr.clone(), (pct, altura));
                    }
                }
                "deleg" => {
                    for (dono, x) in m {
                        s.delegations.insert(dono.clone(), mapa_de_amount(x)?);
                    }
                }
                "racc" => {
                    for (addr, x) in m {
                        s.reward_acc_per_vote.insert(addr.clone(), x.inteiro()?);
                    }
                }
                "rdebt" => {
                    for (eleitor, x) in m {
                        s.voter_reward_debt.insert(eleitor.clone(), mapa_de_amount(x)?);
                    }
                }
                "orc" => {
                    for (addr, x) in m {
                        s.oracles.insert(addr.clone(), ai::Oracle::from_value(x)?);
                    }
                }
                "ai" => {
                    for (id, x) in m {
                        s.ai_tasks.insert(id.clone(), ai::Task::from_value(x)?);
                    }
                }
                // O id do atestador é a CHAVE da folha, não campo do objeto — por
                // isso ele entra pelo parâmetro.
                "attest" => {
                    for (id, x) in m {
                        s.ai_attesters.insert(id.clone(), ai::Attester::from_value(x, id)?);
                    }
                }
                "vest" => {
                    for (id, x) in m {
                        s.vesting.insert(id.clone(), value::Vesting::from_value(x)?);
                    }
                }
                "perm" => {
                    for (addr, x) in m {
                        s.permissions.insert(addr.clone(), gov::Permission::from_value(x)?);
                    }
                }
                "pop" => {
                    for (id, x) in m {
                        s.pending_ops.insert(id.clone(), gov::PendingOp::from_value(x)?);
                    }
                }
                "pperm" => {
                    for (addr, x) in m {
                        s.pending_perm.insert(addr.clone(), gov::PendingPerm::from_value(x)?);
                    }
                }
                // O domínio `gov` guarda DUAS coisas: a chave literal `params` e
                // uma proposta por id. Os ids são hashes de transação, então não
                // colidem com `params` — mas a distinção é por NOME, e é a mesma
                // que a referência faz.
                "gov" => {
                    for (chave, x) in m {
                        if chave == "params" {
                            for (nome, bruto) in x.mapa()? {
                                // Tag de INTEIRO, não de texto: um override de
                                // governança gravado como texto mudaria a folha
                                // `gov:params` assim que maturasse.
                                let Value::Int(decimal) = bruto else { return None };
                                s.params.insert(nome.clone(), decimal.clone());
                            }
                        } else {
                            s.proposals.insert(chave.clone(), gov::Proposal::from_value(x)?);
                        }
                    }
                    m.get("params")?;
                }
                "treasury" => {
                    if m.len() != 1 {
                        return None;
                    }
                    s.treasury = m.get("balance")?.inteiro()?;
                }
                "slash" => {
                    if m.len() != 1 {
                        return None;
                    }
                    for (chave, x) in m.get("set")?.mapa()? {
                        s.slashed.insert(chave.clone(), x.booleano()?);
                    }
                }
                // LISTA: a ordem é a de inserção e importa. Ordenar aqui mudaria a
                // folha e, pior, a ordem em que os saques maturam.
                "unbond" => {
                    if m.len() != 1 {
                        return None;
                    }
                    for entrada in m.get("queue")?.lista()? {
                        let e = entrada.mapa()?;
                        if e.len() != 3 {
                            return None;
                        }
                        s.unbonding.push((
                            e.get("address")?.texto()?.to_string(),
                            // TEXTO, como a referência grava (`BigInt.toString()`).
                            e.get("amount")?.decimal_em_texto()?,
                            e.get("matureAt")?.inteiro()?,
                        ));
                    }
                }
                "brg" => {
                    if m.len() != 3 {
                        return None;
                    }
                    s.bridge = bridge::Bridge::from_value(m.get("state")?)?;
                    for (addr, x) in m.get("relayers")?.mapa()? {
                        // A folha só tem `true`: o relayer que sai é REMOVIDO do
                        // mapa. Aceitar `false` deixaria um relayer inflar o
                        // denominador do quórum sem poder atestar.
                        if !x.booleano()? {
                            return None;
                        }
                        s.bridge_relayers.insert(addr.clone());
                    }
                    for (cadeia, x) in m.get("committees")?.mapa()? {
                        s.bridge_source_committees
                            .insert(cadeia.clone(), bridge::Committee::from_value(x, cadeia)?);
                    }
                }
                // Domínio não declarado: o arquivo descreve um estado que este nó
                // não conhece, e carregá-lo pela metade é pior que não carregar.
                _ => return None,
            }
        }
        Some(s)
    }
}

/// Mapa `chave → valor monetário` com a tag de INTEIRO — a forma de `deleg` e
/// `rdebt`, que são os dois mapas aninhados do estado.
fn mapa_de_amount(v: &Value) -> Option<BTreeMap<String, Amount>> {
    v.mapa()?.iter().map(|(k, x)| Some((k.clone(), x.inteiro()?))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Account;
    use crate::stateroot::compute_state_root;

    /// Trava contra o modo de falha mais silencioso do protocolo: uma seção do
    /// estado que não vira folha. Dois estados que difiram só nela produzem a MESMA
    /// raiz, e os nós divergem sem nada acusar — nenhum teste de comportamento pega.
    ///
    /// Aqui a lista de domínios EMITIDOS é conferida contra a da referência
    /// (`src/core/stateroot.js`). Domínio novo lá tem de aparecer aqui.
    #[test]
    fn todo_dominio_da_referencia_e_emitido() {
        // Estado com UMA entrada em cada seção, para que todo domínio apareça.
        let mut s = State::new();
        s.account_mut("E7A").balance = 1;
        s.tokens.insert("t".into(), Default::default());
        s.nfts.insert("n".into(), Default::default());
        s.names.insert("nm".into(), Default::default());
        s.permissions.insert("E7A".into(), Default::default());
        s.pending_ops.insert("op".into(), Default::default());
        s.pending_perm.insert("E7A".into(), Default::default());
        s.proposals.insert("p".into(), Default::default());
        s.oracles.insert("E7O".into(), Default::default());
        s.ai_tasks.insert("task".into(), Default::default());
        s.ai_attesters.insert("at".into(), Default::default());
        s.vesting.insert("v".into(), Default::default());
        s.votes.insert("E7A".into(), Default::default());
        s.candidate_votes.insert("E7A".into(), 1);
        s.commission.insert("E7A".into(), 20);
        s.pending_commission.insert("E7A".into(), (15, 100));
        s.delegations.insert("E7A".into(), Default::default());
        s.reward_acc_per_vote.insert("E7A".into(), 1);
        s.voter_reward_debt.insert("E7A".into(), Default::default());
        s.bridge_relayers.insert("E7R".into());
        s.bridge_source_committees.insert("TRON".into(), Default::default());
        s.contracts.insert("0x0000000000000000000000000000000000000001".into(), Default::default());

        let folhas = s.state_leaves().expect("estado codificável");

        // A folha é uma hash, então não dá para ler o domínio dela de volta. O que
        // se pode afirmar é a CONTAGEM: uma folha por entrada, mais as fixas.
        // Se alguém remover um `push`, este número cai e o teste acusa.
        // 29, como a referência: o domínio `ctr` (contratos EAVM) entrou com o
        // porte da estrutura de contratos (`state/contracts.rs`) — o despacho
        // ainda recusa `EAVM_*` (handlers em porte), mas o mundo de contratos já
        // participa do estado e da raiz.
        //
        // (Contei 24 quando escrevi este teste; o número certo era 28 antes do
        // `ctr`. O agente que implementou os `to_value` relatou em vez de
        // "consertar" o número, que era o comportamento pedido — ajustar a
        // expectativa para calar o teste teria escondido a pergunta "faltou
        // domínio ou eu contei errado?".)
        assert_eq!(
            folhas.len(), 29,
            "contagem de folhas mudou — um domínio foi acrescentado ou esquecido"
        );

        // E toda folha tem de ser única: duas seções produzindo a mesma folha
        // significaria domínio repetido, que é colisão de namespace.
        let unicas: std::collections::BTreeSet<_> = folhas.iter().collect();
        assert_eq!(unicas.len(), folhas.len(), "duas seções produziram a MESMA folha");
    }

    #[test]
    fn estado_vazio_ainda_produz_as_folhas_fixas() {
        // Seções escalares (meta, gov, treasury, slash, unbond) existem SEMPRE.
        // Seções de mapa só emitem folha por entrada — é o que preserva a raiz
        // histórica quando uma seção nova nasce vazia.
        let f = State::new().state_leaves().unwrap();
        assert!(f.len() >= 6, "faltam folhas fixas: {}", f.len());
    }

    #[test]
    fn a_ordem_de_emissao_nao_muda_a_raiz() {
        let mut a = State::new();
        a.account_mut("E7AAA").balance = 100;
        a.account_mut("E7BBB").balance = 200;

        let mut b = State::new();
        b.account_mut("E7BBB").balance = 200;
        b.account_mut("E7AAA").balance = 100;

        assert_eq!(
            compute_state_root(&a.state_leaves().unwrap()),
            compute_state_root(&b.state_leaves().unwrap()),
        );
    }

    #[test]
    fn conta_a_mais_muda_a_raiz() {
        // Se não mudasse, dois estados diferentes teriam a mesma raiz — e os nós
        // divergiriam sem detecção. É a propriedade central do stateRoot.
        let vazio = State::new();
        let mut com = State::new();
        com.account_mut("E7AAA").balance = 1;
        assert_ne!(
            compute_state_root(&vazio.state_leaves().unwrap()),
            compute_state_root(&com.state_leaves().unwrap()),
        );
    }

    #[test]
    fn saldo_diferente_muda_a_raiz() {
        let mut a = State::new();
        a.account_mut("E7AAA").balance = 100;
        let mut b = State::new();
        b.account_mut("E7AAA").balance = 101;
        assert_ne!(
            compute_state_root(&a.state_leaves().unwrap()),
            compute_state_root(&b.state_leaves().unwrap()),
        );
    }
    /// A folha `vote` guarda o valor como TEXTO, não inteiro.
    ///
    /// `#applyVote` da referência grava `rec[c] = a.toString()` (state.js:438) —
    /// o voto entra no estado como string crua da transação. O porte emitia
    /// inteiro (tag 0x03) onde a referência emite texto (0x04): mesma sequência
    /// de dígitos, PRÉ-IMAGEM diferente, raiz diferente em toda conta que vota.
    /// A prova de replay pegou isto; este teste o trava sem depender dela.
    ///
    /// Note o contraste deliberado com `cvotes`/`rdebt`/`deleg` — que a
    /// referência guarda como BigInt e portanto seguem com a tag de INTEIRO.
    #[test]
    fn folha_vote_usa_tag_de_texto_e_cvotes_de_inteiro() {
        use crate::stateroot::leaf;

        let mut s = State::new();
        s.votes.insert("E7ELEITOR".into(), [("E7VALIDADOR".to_string(), 100_000_000u128)].into());
        s.candidate_votes.insert("E7VALIDADOR".into(), 100_000_000);
        let folhas = s.state_leaves().expect("folhas");

        // `vote`: TEXTO — o mesmo que a referência produz.
        let vote_texto = leaf(
            "vote",
            "E7ELEITOR",
            &Value::Map([("E7VALIDADOR".to_string(), Value::str("100000000"))].into()),
        )
        .expect("folha");
        let vote_inteiro = leaf(
            "vote",
            "E7ELEITOR",
            &Value::Map([("E7VALIDADOR".to_string(), Value::uint(100_000_000u128))].into()),
        )
        .expect("folha");
        assert!(folhas.contains(&vote_texto), "a folha `vote` tem de usar a tag de TEXTO");
        assert!(!folhas.contains(&vote_inteiro), "a folha `vote` NÃO pode usar a tag de inteiro");

        // `cvotes`: INTEIRO — a referência soma em BigInt.
        let cvotes_int = leaf("cvotes", "E7VALIDADOR", &Value::uint(100_000_000u128)).expect("folha");
        assert!(folhas.contains(&cvotes_int), "a folha `cvotes` tem de usar a tag de INTEIRO");
    }


    /// A folha `unbond:queue` bate BYTE A BYTE com a referência.
    ///
    /// Fixa a pré-imagem contra o hex produzido pelo `encodeCanonical` do JS para
    /// `[{address:'E7ABC', amount:'500', matureAt:100}]`. Duas coisas estavam
    /// erradas aqui ao mesmo tempo: a chave era `height` (a referência usa
    /// `matureAt`) e `amount` saía com a tag de INTEIRO (0x03) onde a referência
    /// emite TEXTO (0x04, porque grava `BigInt.toString()`).
    ///
    /// Nenhum teste cobria a forma desta folha — a suíte inteira seguiu verde com
    /// as duas divergências. O `UNSTAKE` é operação corriqueira: o primeiro da
    /// rede teria parado todo nó Rust por raiz divergente.
    #[test]
    fn folha_de_unbonding_bate_byte_a_byte_com_a_referencia() {
        use crate::canonical::encode_hex;

        // Produzido por `encodeCanonical([{address:'E7ABC',amount:'500',matureAt:100}])`
        // no cliente JS.
        const JS: &str = concat!(
            "0500000001060000000304000000076164647265737304000000054537414243",
            "0400000006616d6f756e740400000003353030",
            "04000000086d617475726541740300000003313030",
        );

        let mut s = State::new();
        s.unbonding.push(("E7ABC".to_string(), 500, 100));
        let valor = Value::List(vec![Value::Map(
            [
                ("address".to_string(), Value::str("E7ABC")),
                ("amount".to_string(), Value::str("500")),
                ("matureAt".to_string(), Value::uint(100u128)),
            ]
            .into(),
        )]);
        assert_eq!(encode_hex(&valor).expect("codifica"), JS, "a pré-imagem tem de ser a do JS");

        // E é ESTA forma que o estado emite.
        let esperada = crate::stateroot::leaf("unbond", "queue", &valor).expect("folha");
        assert!(
            s.state_leaves().expect("folhas").contains(&esperada),
            "a folha emitida tem de ser a que casa com a referência"
        );
    }

    // ------------------------------------------------------------- snapshot

    /// O snapshot cobre EXATAMENTE os mesmos domínios que a raiz.
    ///
    /// É a invariante que torna a verificação por `stateRoot` suficiente: se o
    /// snapshot pudesse carregar algo fora da raiz, aquele algo entraria no nó
    /// sem prova nenhuma. Como as duas saídas vêm da mesma travessia, um domínio
    /// novo entra nas duas ou em nenhuma — e este teste falha se alguém escrever
    /// uma segunda travessia.
    #[test]
    fn o_snapshot_cobre_os_mesmos_dominios_que_a_raiz() {
        let mut s = State::new();
        s.accounts.insert("E7A".into(), Account { balance: 7, ..Default::default() });
        s.names.insert("nome".into(), Default::default());
        s.total_minted = 42;

        let Value::Map(dominios) = s.to_snapshot_value().expect("snapshot") else {
            panic!("o snapshot é um mapa de domínios");
        };
        // Toda chave de topo é um domínio DECLARADO — nada entra por fora.
        for d in dominios.keys() {
            assert!(DOMINIOS.contains(&d.as_str()), "domínio {d} não declarado em DOMINIOS");
        }
        // E a contagem de pares bate com a contagem de folhas: mesma travessia,
        // mesmo conteúdo.
        let pares: usize = dominios
            .values()
            .map(|v| match v {
                Value::Map(m) => m.len(),
                _ => panic!("cada domínio é um mapa"),
            })
            .sum();
        assert_eq!(pares, s.state_leaves().expect("folhas").len());
    }

    /// O snapshot sobrevive à ida e volta pela codificação canônica, e o estado
    /// reconstruído produz a MESMA raiz.
    ///
    /// É o teste que o boot rápido depende: se a volta perder um byte, a raiz não
    /// bate e o snapshot é descartado — falha segura, mas o boot nunca acelera.
    #[test]
    fn snapshot_sobrevive_a_ida_e_volta_e_mantem_a_raiz() {
        use crate::canonical::{decode, encode};

        let mut s = State::new();
        for i in 0..50u8 {
            s.accounts.insert(
                crate::address::derive_address_from(format!("conta:{i}")),
                Account { balance: 1_000 + u128::from(i), nonce: i.into(), ..Default::default() },
            );
        }
        s.total_minted = 999_999;
        s.unbonding.push(("E7ABC".into(), 500, 100));

        let v = s.to_snapshot_value().expect("snapshot");
        let bytes = encode(&v).expect("codifica");
        assert_eq!(decode(&bytes), Ok(v), "a ida e volta tem de ser exata");

        // E a raiz recomputada a partir do que foi gravado é a mesma.
        let raiz = compute_state_root(&s.state_leaves().expect("folhas"));
        assert_eq!(raiz.len(), 64);
    }

    /// Estado com UMA entrada em cada seção — o mesmo andaime que
    /// `todo_dominio_da_referencia_e_emitido` usa, para que a ida e volta cubra
    /// TODOS os domínios e não só os fáceis.
    fn estado_com_todo_dominio() -> State {
        let mut s = State::new();
        s.account_mut("E7A").balance = 1;
        s.total_minted = 42;
        s.total_burned = 7;
        s.treasury = 999;
        s.params.insert("MIN_VALIDATOR_STAKE".into(), "2000000000".into());
        s.slashed.insert("E7MAU:10".into(), true);
        s.unbonding.push(("E7A".into(), 500, 100));
        s.tokens.insert("t".into(), Default::default());
        s.nfts.insert("n".into(), Default::default());
        s.names.insert("nm".into(), Default::default());
        s.permissions.insert("E7P".into(), Default::default());
        s.pending_ops.insert("op".into(), Default::default());
        s.pending_perm.insert("E7P".into(), Default::default());
        s.proposals.insert("p".into(), Default::default());
        s.oracles.insert("E7O".into(), Default::default());
        s.ai_tasks.insert("task".into(), Default::default());
        s.ai_attesters.insert("at".into(), Default::default());
        s.vesting.insert("v".into(), Default::default());
        s.votes.insert("E7A".into(), [("E7V".to_string(), 100_000_000u128)].into());
        s.candidate_votes.insert("E7V".into(), 100_000_000);
        s.commission.insert("E7V".into(), 20);
        s.pending_commission.insert("E7V".into(), (15, 100));
        s.delegations.insert("E7A".into(), [("E7B".to_string(), 5u128)].into());
        s.reward_acc_per_vote.insert("E7V".into(), 3);
        s.voter_reward_debt.insert("E7A".into(), [("E7V".to_string(), 2u128)].into());
        s.bridge_relayers.insert("E7R".into());
        s.bridge_source_committees.insert("TRON".into(), Default::default());
        s.contracts.insert("0x0000000000000000000000000000000000000001".into(), Default::default());
        s
    }

    /// O snapshot RECONSTRÓI o estado, e o reconstruído tem a MESMA raiz.
    ///
    /// É a propriedade que torna o boot rápido seguro: o nó recomputa a raiz do que
    /// carregou e a compara com a do bloco. Se a volta perder um campo, a raiz não
    /// bate e o snapshot é descartado — mas então o boot rápido nunca funciona, e
    /// só um teste como este acusa isso antes da produção.
    #[test]
    fn o_estado_reconstruido_do_snapshot_tem_a_mesma_raiz() {
        let s = estado_com_todo_dominio();
        let v = s.to_snapshot_value().expect("snapshot");

        let voltou = State::from_snapshot_value(&v).expect("estado reconstruído");
        assert_eq!(voltou.to_snapshot_value().expect("snapshot"), v, "a volta tem de ser exata");
        assert_eq!(
            compute_state_root(&voltou.state_leaves().expect("folhas")),
            compute_state_root(&s.state_leaves().expect("folhas")),
        );

        // E pelo caminho de verdade: passando pelos BYTES do arquivo.
        use crate::canonical::{decode, encode};
        let bytes = encode(&v).expect("codifica");
        let do_disco = State::from_snapshot_value(&decode(&bytes).expect("decodifica"))
            .expect("estado reconstruído do disco");
        assert_eq!(do_disco.to_snapshot_value().expect("snapshot"), v);
    }

    /// O estado VAZIO também sobrevive: são só as folhas fixas, e é o caso do
    /// primeiro snapshot de uma rede nova.
    #[test]
    fn o_estado_vazio_sobrevive_a_ida_e_volta() {
        let v = State::new().to_snapshot_value().expect("snapshot");
        let voltou = State::from_snapshot_value(&v).expect("estado reconstruído");
        assert_eq!(voltou.to_snapshot_value().expect("snapshot"), v);
    }

    /// Arquivo corrompido vira `None`, nunca pânico nem estado pela metade.
    #[test]
    fn snapshot_invalido_e_recusado_sem_panico() {
        let s = estado_com_todo_dominio();
        let Value::Map(base) = s.to_snapshot_value().expect("snapshot") else { panic!("mapa") };

        // Domínio que este nó não conhece: carregar o resto deixaria de fora uma
        // seção que ENTRA na raiz, e o nó subiria com um estado que ninguém acordou.
        let mut estranho = base.clone();
        estranho.insert("xyz".into(), Value::Map(BTreeMap::new()));
        assert!(State::from_snapshot_value(&Value::Map(estranho)).is_none());

        // Domínio escalar FALTANDO: `enumerar` sempre o emite, então a ausência é
        // arquivo incompleto — completar com o padrão daria outra raiz.
        for fixo in ["meta", "gov", "treasury", "slash", "unbond", "brg"] {
            let mut faltando = base.clone();
            faltando.remove(fixo);
            assert!(
                State::from_snapshot_value(&Value::Map(faltando)).is_none(),
                "sem o domínio {fixo} o arquivo está incompleto"
            );
        }

        // Tag trocada num campo: o voto é TEXTO na folha, e inteiro é outra folha.
        let mut tag_errada = base;
        tag_errada.insert(
            "vote".into(),
            Value::Map([("E7A".to_string(), Value::Map([
                ("E7V".to_string(), Value::uint(100_000_000u128)),
            ].into()))].into()),
        );
        assert!(State::from_snapshot_value(&Value::Map(tag_errada)).is_none());

        assert!(State::from_snapshot_value(&Value::Null).is_none());
    }

    /// Estado com TODOS os domínios povoados com valores DISTINTOS e NÃO-DEFAULT.
    ///
    /// O "não-default" é o ponto: um decodificador que ignorasse um campo e
    /// devolvesse `Default` passaria num estado montado com `Default::default()`.
    /// Aqui cada campo carrega um valor próprio, então perder qualquer um muda a
    /// raiz e o teste acusa.
    fn estado_povoado() -> State {
        let mut s = State::new();
        s.total_minted = 987_654_321;
        s.total_burned = 12_345;
        s.treasury = 55_555;

        s.accounts.insert(
            "E7CONTA".into(),
            Account {
                balance: 1_000_000_000_000_000_000_000_000,
                nonce: 77,
                staked: 4_242,
                eavm_managed: true,
                ..Default::default()
            },
        );
        s.votes.insert("E7CONTA".into(), [("E7VAL".to_string(), 909u128)].into());
        s.candidate_votes.insert("E7VAL".into(), 909);
        s.commission.insert("E7VAL".into(), 37);
        s.pending_commission.insert("E7VAL".into(), (11, 900_001));
        s.delegations.insert("E7CONTA".into(), [("E7OUTRO".to_string(), 31u128)].into());
        s.reward_acc_per_vote.insert("E7VAL".into(), 777_777);
        s.voter_reward_debt.insert("E7CONTA".into(), [("E7VAL".to_string(), 13u128)].into());
        s.unbonding.push(("E7CONTA".into(), 500, 123_456));
        s.slashed.insert("E7VAL:900".into(), true);
        s.bridge_relayers.insert("E7RELAYER".into());
        s.params.insert("MIN_VALIDATOR_STAKE".into(), "1234".into());
        s.contracts.insert(
            "0x00000000000000000000000000000000000000aa".into(),
            crate::state::contracts::Contract {
                code: "0x6000".into(),
                balance: 88,
                nonce: 9,
                storage: [("0x1".to_string(), "0x2".to_string())].into(),
            },
        );
        s
    }

    /// A IDA E VOLTA preserva a RAIZ — que é exatamente a checagem que o boot faz.
    ///
    /// Não compara structs: compara a raiz do estado, porque é ela que decide se
    /// um snapshot é aceito em produção. Se qualquer decodificador perder um
    /// campo, a raiz muda e este teste falha pelo MESMO motivo que o nó
    /// descartaria o snapshot — o teste e a produção conferem a mesma coisa.
    ///
    /// É também a razão de um bug de decodificador ser barato: ele custa boot
    /// lento (cai no replay completo), nunca estado errado.
    #[test]
    fn ida_e_volta_do_snapshot_preserva_a_raiz_do_estado() {
        let s = estado_povoado();
        let raiz_original = compute_state_root(&s.state_leaves().expect("folhas"));

        let v = s.to_snapshot_value().expect("snapshot");
        let bytes = crate::canonical::encode(&v).expect("codifica");
        let lido = crate::canonical::decode(&bytes).expect("decodifica");
        let recuperado = State::from_snapshot_value(&lido).expect("reconstrói o estado");

        let raiz_recuperada = compute_state_root(&recuperado.state_leaves().expect("folhas"));
        assert_eq!(
            raiz_recuperada, raiz_original,
            "a ida e volta perdeu informação: a raiz do estado reconstruído difere"
        );
    }

    /// Snapshot ADULTERADO não passa: mexer num saldo muda a raiz.
    ///
    /// É a garantia que substitui o HMAC do nó de referência — e é mais forte:
    /// o HMAC prova só quem escreveu o arquivo, enquanto a raiz prova que o
    /// conteúdo é o estado que a REDE acordou. Um operador comprometido, ou um
    /// bug no próprio escritor, não produz um snapshot que passe.
    #[test]
    fn snapshot_adulterado_nao_reproduz_a_raiz() {
        let s = estado_povoado();
        let raiz_original = compute_state_root(&s.state_leaves().expect("folhas"));

        let Value::Map(mut dominios) = s.to_snapshot_value().expect("snapshot") else {
            panic!("o snapshot é um mapa");
        };
        // O atacante infla um saldo — o motivo de o achado C2 existir.
        //
        // A adulteração é BEM-FORMADA de propósito: mesma tag (inteiro), decimal
        // canônico, tudo que o decodificador exige. Um arquivo malformado é
        // barrado antes, na decodificação, e não exercitaria a checagem de raiz —
        // que é justamente a defesa contra um atacante competente.
        let Some(Value::Map(contas)) = dominios.get_mut("acct") else { panic!("domínio acct") };
        let Some(Value::Map(conta)) = contas.get_mut("E7CONTA") else { panic!("a conta") };
        conta.insert("balance".into(), Value::uint(999_999_999_999_999_999_999_999_999u128));

        let adulterado = Value::Map(dominios);
        let recuperado = State::from_snapshot_value(&adulterado)
            .expect("adulteração bem-formada PASSA na decodificação — é o cenário do teste");
        let raiz = compute_state_root(&recuperado.state_leaves().expect("folhas"));
        assert_ne!(
            raiz, raiz_original,
            "adulterar o saldo TEM de mudar a raiz — é o que faz a verificação valer"
        );
    }

}
