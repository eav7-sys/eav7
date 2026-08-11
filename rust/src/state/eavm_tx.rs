//! Manipuladores de transação EAVM — porte de `src/core/state.js`:
//! `#runEavmTx` (state.js:1057-1131), o trecho EAVM de `applyTransaction`
//! (state.js:1155-1183 e 2584-2623), `EAVM_TRANSFER` (state.js:1196-1202),
//! `#senderEavmForm` (state.js:906-912) e `#eavmForm` (state.js:890-893).
//!
//! É a última peça de CONSENSO do porte: o acoplamento entre a VM de contratos e
//! a máquina de estado. Conformidade: `vectors/eavm-state.json` (gerado por
//! `vectors/`), verificado em `rust/tests/eavm_state.rs`.
//!
//! # Os pontos onde um porte diverge sem avisar (e onde cada um mora aqui)
//!
//! * **H1 — orçamento de gás limitado por energia + queima.** O gás que a VM pode
//!   consumir não é `MAX_EAVM_GAS` seco: é o que a energia disponível MAIS a
//!   queima que o saldo/feeLimit suportam pagam (`state.js:1067-1075`). Orçamento
//!   útil ≤ 0 rejeita ANTES de rodar a VM — fecha a folga do A-4 em que uma conta
//!   sem recursos fazia a rede executar bytecode de graça. Ver [`aplicar_vm`].
//! * **C-1/A-4 — atomicidade após a VM.** A VM roda ANTES da cobrança (o gás
//!   gasto vira energia). Se a checagem de taxa ou de saldo falhar DEPOIS da
//!   execução, `world.revert(0)` desfaz TUDO que a VM mutou — inclusive o valor
//!   de entrada (`state.js:1181` e `state.js:2589`).
//! * **L-2 — depósito de código.** Deploy bem-sucedido cobra `len(runtime) × 20`
//!   de gás, igual ao CREATE aninhado (`state.js:1114-1121`) — mas SÓ em sucesso:
//!   runtime acima de `MAX_CONTRACT_BYTES` ou depósito que estoura o orçamento
//!   viram `success:false` SEM o depósito no `gasUsed` (assimetria com o CREATE
//!   aninhado do host, capturada no vetor do deploy oversized).
//! * **M-1 — timestamp do BLOCO.** A VM enxerga `blockTs` validado pela camada de
//!   blocos, nunca o `tx.timestamp` arbitrário do remetente (`state.js:1081-1083`).
//!
//! # Aritmética de recursos em `f64` — de propósito
//!
//! A referência faz TODA a contabilidade de energia/bandwidth em `Number` do
//! JavaScript (`state.js:118-176`): `Math.floor`, `Math.ceil`, `Math.min` sobre
//! ponto flutuante IEEE-754. Portar para inteiros "porque é mais correto" seria
//! divergir: para produtos acima de 2⁵³ o float arredonda e o inteiro não, e a
//! energia apurada — que entra na folha `acct` do stateRoot — sairia diferente.
//! Este módulo replica as operações de float NA MESMA ORDEM que o JS as executa.
//! Todos os valores práticos são inteiros pequenos (< 2⁵³), então as contas são
//! exatas; a forma float existe para reproduzir também os casos-limite.

use super::{soma, Amount, State, StateError};
use crate::config::{
    energy, EAVM_CHAIN_ID, EAVM_CONTRACTS_HEIGHT, EAVM_VALUE_HEIGHT, GAS_PER_ENERGY,
    MAX_CONTRACT_BYTES, MAX_EAVM_GAS, MAX_FEE_LIMIT, RESOURCE_HEIGHT,
};
use crate::eavm::host::{addr_hex, EavmHost, TransferKind, World};
use crate::eavm::vm::{self, Address, BlockContext, ExecParams, ExecResult, Word};
use crate::state::contracts::{
    buffer_from_hex, e7_of, encode_e7_dest, parse_addr_strict, EavmWorld,
};
use crate::transaction::{JsonValue, Tx, EAVM_SCHEME};
use sha3::{Digest as _, Keccak256};

type R<T> = Result<T, StateError>;

fn erro(msg: impl Into<String>) -> StateError {
    StateError(msg.into())
}

// ============================================================================
// Custos-base de energia — `CHAIN.ENERGY.COST` (config.js:328-345)
//
// Vinham TRANSCRITOS à mão aqui, sob um comentário dizendo que o gerador de
// config não emitia sub-tabelas aninhadas. Ele emite: a tabela está em
// `config::ENERGY_COST`, GERADA a partir do `src/config.js`. Constante
// transcrita é constante que envelhece — o dia em que a referência mudar o custo
// do deploy, o gerador atualiza a tabela e esta cópia fica para trás, cobrando
// energia diferente do resto da rede pelo mesmo bloco.
//
// `as f64` porque a contabilidade de energia é em ponto flutuante na referência
// (`Number`), e converter aqui mantém o arredondamento idêntico.
// ============================================================================

fn custo_energia(tipo: &str) -> f64 {
    crate::config::energy_cost(tipo) as f64
}

// ============================================================================
// Recibo de execução (o que a referência entrega ao logSink — state.js:2584-2623)
// ============================================================================

/// Um evento LOG0..LOG4, na forma textual da referência (`vm.js:238-240`):
/// `address` 0x minúsculo, `topics` `'0x' + 64 hex` (preenchidos), `data`
/// `'0x' + hex`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EavmLog {
    pub address: String,
    pub topics: Vec<String>,
    pub data: String,
}

/// Transferência interna observada pela execução, já com os dois lados mapeados
/// para E7 (`state.js:2612-2620` faz `fromE7: this.#e7Of(x.from)` na emissão).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EavmXfer {
    /// `'call'` ou `'create'` — `entry` nunca entra (state.js:959).
    pub kind: String,
    pub from: String,
    pub to: String,
    pub from_e7: String,
    pub to_e7: String,
    pub amount: Amount,
}

/// O que `#runEavmTx` devolve mais o que o recibo do logSink carrega
/// (`state.js:1130` + `state.js:2600-2608`). É o material do recibo de execução:
/// uma chamada que REVERTE continua sendo transação válida (paga taxa, avança o
/// nonce) — só a execução falhou, e sem este registro o explorador mostraria
/// "sucesso" para uma chamada revertida.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EavmOutcome {
    pub success: bool,
    pub gas_used: u64,
    pub return_data: Vec<u8>,
    /// Endereço executado/derivado (0x minúsculo). No deploy é DERIVADO na
    /// execução (nonce do momento + forma 0x do remetente, que muda com o fork) —
    /// carregá-lo aqui evita reimplementar a derivação na API (state.js:2597-2599).
    pub contract_addr: String,
    pub is_deploy: bool,
    /// Só de execução bem-sucedida (`state.js:1130`: `success ? logs : []`).
    pub logs: Vec<EavmLog>,
    /// Só de execução bem-sucedida — em falha o `revert(0)` já os despilhou.
    pub xfers: Vec<EavmXfer>,
}

// O trilho de recursos vive em `super::recursos` — é COMPARTILHADO com todas as
// transações, não só as da EAVM. Ficava aqui por acidente do porte, e o resultado
// foi o caminho genérico (`apurar_taxa`) nascer como um `Ok(0)` que não cobrava
// energia nem bandwidth de nenhuma transação não-EAVM.
use super::recursos::{
    canonical_tx_bytes, commit_bandwidth, commit_energy, commit_gb, consumo_gb, energia_disponivel,
    peek_bandwidth, peek_energy, peek_gb, taxa_de, taxa_gb,
};
// Só os testes deste módulo exercem o teto de energia e a conta crua.
#[cfg(test)]
use super::recursos::max_energy;
#[cfg(test)]
use {super::Account, crate::config::UNIT};

fn campo_texto<'a>(tx: &'a Tx, chave: &str) -> Option<&'a str> {
    match tx.data.as_ref()? {
        JsonValue::Map(m) => match m.get(chave)? {
            JsonValue::Str(s) => Some(s),
            _ => None,
        },
        _ => None,
    }
}

/// `BigInt(tx.amount)` com a semântica local: o protocolo só admite decimal sem
/// sinal (verify stateless). Um valor não representável rejeita com a MESMA
/// mensagem do guard `value < 0n` da referência (state.js:1066/1197) — que é o
/// único jeito de um valor "estranho" chegar até aqui no JS.
fn valor_da_tx(tx: &Tx) -> R<Amount> {
    tx.amount.parse::<Amount>().map_err(|_| erro("valor inválido"))
}

/// `#senderEavmForm` (state.js:906-912): a forma 0x do REMETENTE dentro da VM.
///
/// * abaixo de `EAVM_VALUE_HEIGHT` — `#eavmForm` legado (state.js:890-893):
///   `keccak256(E7 literal)[12:]`, NÃO reversível;
/// * acima do fork, conta EAVM (MetaMask): o `0x` real (`data.eavmFrom`) é a
///   identidade — `eavmToE7` devolve `tx.from`;
/// * acima do fork, conta E7 nativa: `encodeE7Dest(tx.from)` embute o próprio E7
///   nos 20 bytes (decodeE7Dest inverte). Reversível para `#e7Of`, senão um
///   contrato que devolvesse valor ao remetente creditaria conta que ninguém
///   controla (o achado A-3 por outra porta).
fn sender_eavm_form(tx: &Tx, height: u64) -> R<Address> {
    if height < EAVM_VALUE_HEIGHT {
        // `'0x' + keccak256(Buffer.from(String(addr))).subarray(12)` — o hash é
        // do TEXTO do endereço E7. (O ramo `addr.startsWith('0x')` do JS é
        // inalcançável aqui: `tx.from` é sempre E7.)
        let d = Keccak256::digest(tx.from.as_bytes());
        let mut a = [0u8; 20];
        a.copy_from_slice(&d[12..]);
        return Ok(a);
    }
    if tx.scheme == EAVM_SCHEME {
        // `tx.data?.eavmFrom` truthy (string vazia cai no ramo E7, como no JS).
        if let Some(f) = campo_texto(tx, "eavmFrom")
            && !f.is_empty()
        {
            let low = f.to_lowercase();
            // O JS aceitaria qualquer string como chave do mundo; o envelope
            // (stateless, roda antes) garante 0x de 40 hex, então uma forma
            // inválida aqui é inalcançável por consenso — rejeitar é o modo
            // de falha seguro, nunca pânico.
            return parse_addr_strict(&low).ok_or_else(|| erro("data.eavmFrom inválido"));
        }
    }
    let enc = encode_e7_dest(&tx.from)?;
    // `encode_e7_dest` produz sempre `0xe7000000` + 32 hex minúsculos — parse
    // não tem como falhar; o erro fica por política (sem unwrap em consenso).
    parse_addr_strict(&enc).ok_or_else(|| erro("endereço E7 inválido"))
}

// ============================================================================
// O manipulador
// ============================================================================

/// Aplica uma transação EAVM (`EAVM_DEPLOY` / `EAVM_CALL` / `EAVM_TRANSFER`).
///
/// Devolve `(taxa queimada, recibo)`. O chamador (`apply_transaction`) é quem
/// avança o nonce e soma a taxa em `total_burned` — o epílogo é único para todos
/// os tipos, como na referência (state.js:2629-2635).
///
/// # Invariante
///
/// `Err` deixa o estado EXATAMENTE como estava. Aqui isso não vem de graça (a VM
/// muta o mundo ANTES da cobrança): todo caminho de erro pós-VM passa por
/// `world.revert(0)` — é a correção C-1/A-4.
pub(crate) fn aplicar(
    state: &mut State,
    tx: &Tx,
    height: u64,
    block_ts: u64,
) -> R<(Amount, Option<EavmOutcome>)> {
    // L2 (state.js:1142): o teto do feeLimit é REAFIRMADO no estado — a validação
    // stateless pode ter sido pulada por um caminho interno. `BigInt(tx.fee)` do
    // JS lança em texto malformado; aqui vira o mesmo tipo de rejeição.
    let fee_limit: Amount = tx.fee.parse().map_err(|_| erro("fee inválida"))?;
    if fee_limit > MAX_FEE_LIMIT {
        return Err(erro("limite de taxa (fee) acima do máximo permitido"));
    }

    match tx.tx_type.as_str() {
        "EAVM_TRANSFER" => aplicar_transfer(state, tx, height, fee_limit).map(|fee| (fee, None)),
        "EAVM_DEPLOY" | "EAVM_CALL" => {
            aplicar_vm(state, tx, height, block_ts, fee_limit).map(|(fee, o)| (fee, Some(o)))
        }
        outro => Err(erro(format!("tipo de transação não suportado: {outro}"))),
    }
}

/// `EAVM_TRANSFER` (state.js:1196-1202): transferência do protocolo EAVM
/// (MetaMask/Trust Wallet), autenticada pela assinatura secp256k1 do raw.
/// Essas carteiras permitem valor 0 — diferente do `TRANSFER` nativo.
fn aplicar_transfer(state: &mut State, tx: &Tx, height: u64, fee_limit: Amount) -> R<Amount> {
    let amount = valor_da_tx(tx)?;
    let acc = state.account(&tx.from);

    let fee = if height >= crate::config::GB_FEE_HEIGHT {
        let gb = peek_gb(&acc, height, consumo_gb(tx));
        let fee = taxa_gb(&gb)?;
        if fee > fee_limit {
            return Err(erro(
                "GB insuficiente e limite de taxa excedido — faça stake ou aumente o limite",
            ));
        }
        let total = soma(amount, fee)?;
        if acc.balance < total {
            return Err(erro("saldo insuficiente"));
        }
        state.debitar(&tx.from, total)?;
        let to = tx.to.clone().unwrap_or_else(|| "null".to_string());
        state.creditar(&to, amount)?;
        commit_gb(state.account_mut(&tx.from), height, &gb);
        return Ok(fee);
    } else {
        // Trilho de recursos (state.js:1155/1169-1179): custo-base 1, sem VM.
        let energia = peek_energy(&acc, height, custo_energia("EAVM_TRANSFER"));
        // #6: bandwidth pelo TAMANHO da tx, só a partir de RESOURCE_HEIGHT — abaixo
        // do fork o cálculo de fee é idêntico ao antigo (replay do histórico intacto).
        let bw = (height >= RESOURCE_HEIGHT)
            .then(|| peek_bandwidth(&acc, height, canonical_tx_bytes(tx) as f64));
        let fee = taxa_de(&energia, bw.as_ref())?;
        if fee > fee_limit {
            return Err(erro(
                "recursos (energia/bandwidth) insuficientes e limite de taxa excedido — faça stake ou aumente o limite",
            ));
        }
        let total = soma(amount, fee)?;
        if acc.balance < total {
            return Err(erro("saldo insuficiente"));
        }
        state.debitar(&tx.from, total)?;
        let to = tx.to.clone().unwrap_or_else(|| "null".to_string());
        state.creditar(&to, amount)?;
        let acc = state.account_mut(&tx.from);
        commit_energy(acc, height, &energia);
        if let Some(b) = &bw {
            commit_bandwidth(acc, height, b);
        }
        fee
    };
    Ok(fee)
}

/// `EAVM_DEPLOY`/`EAVM_CALL`: `#runEavmTx` (state.js:1057-1131) + o trecho EAVM
/// de `applyTransaction` (state.js:1155-1183, 2584-2623).
fn aplicar_vm(
    state: &mut State,
    tx: &Tx,
    height: u64,
    block_ts: u64,
    fee_limit: Amount,
) -> R<(Amount, EavmOutcome)> {
    let is_deploy = tx.tx_type == "EAVM_DEPLOY";

    // GATE DO FORK (state.js:1163-1165). O envelope aceita contrato pela rota EVM
    // de forma stateless (não tem altura), então a recusa vive AQUI. Abaixo da
    // altura, nó velho (que barra no envelope) e nó novo (que barra aqui)
    // rejeitam IGUAL — sem isto a relaxação stateless abriria cisão retroativa.
    if tx.scheme == EAVM_SCHEME && height < EAVM_CONTRACTS_HEIGHT {
        return Err(erro("contratos pela rota EVM ainda não ativos nesta altura"));
    }
    let base_cost = custo_energia(if is_deploy { "EAVM_DEPLOY" } else { "EAVM_CALL" });

    // ---- #runEavmTx (state.js:1057) ----
    //
    // A referência faz `getAccount(tx.from)` (materializa). Aqui a leitura NÃO
    // materializa — diferença deliberada e invisível: todo caminho de SUCESSO
    // materializa a conta adiante (débito/nonce), e um caminho de ERRO que
    // materializasse mudaria a raiz numa tx rejeitada — exatamente o que o
    // próprio gerador de vetores confere ("tx rejeitada MUTOU o estado").
    let from_acct = state.account(&tx.from);

    // Fase 2.3 (state.js:1060-1066): acima de EAVM_VALUE_HEIGHT contratos são
    // PAGÁVEIS sobre ledger unificado; abaixo, non-payable — rejeitado ANTES de
    // rodar a VM, sem mutação.
    let payable = height >= EAVM_VALUE_HEIGHT;
    let value = valor_da_tx(tx)?;
    if !payable && value != 0 {
        return Err(erro("EAVM não aceita valor (amount) nesta fase — use 0"));
    }

    // H1 (state.js:1067-1075): orçamento de gás limitado por energia + queima que
    // o saldo suporta. `Number(BigInt)` do JS = casts para f64 na mesma ordem.
    let avail = energia_disponivel(state, &tx.from, height);
    let fee_burnable = fee_limit / energy::BURN_PER_ENERGY;
    let bal_burnable = from_acct.balance / energy::BURN_PER_ENERGY;
    let burnable = fee_burnable.min(bal_burnable) as f64;
    let budget_energy = avail + burnable - base_cost;
    // Orçamento útil <= 0 rejeita ANTES de rodar a VM (fecha a folga do A-4).
    if budget_energy <= 0.0 {
        return Err(erro("energia/saldo insuficiente para executar o contrato"));
    }
    let budget = (MAX_EAVM_GAS as f64).min(budget_energy * GAS_PER_ENERGY as f64) as u64;

    let sender0x = sender_eavm_form(tx, height)?;
    let mut world = EavmWorld::new_rastreando_xfers(state, height);

    // Endereço e código (state.js:1085-1095).
    let (contract_addr, code) = if is_deploy {
        let code = buffer_from_hex(campo_texto(tx, "code").unwrap_or(""));
        if code.is_empty() {
            return Err(erro("EAVM_DEPLOY exige data.code (bytecode)"));
        }
        // O nonce é o CONFIRMADO da conta (`from.nonce`, ANTES do incremento do
        // epílogo) — usar tx.nonce derivaria outro endereço para todo contrato.
        let ca = world.create_address(&sender0x, from_acct.nonce);
        // `this.contracts[ca]?.code` truthy — contrato materializado SEM código
        // ('') não conta como ocupado, igual ao JS.
        let ocupado = world
            .state()
            .contracts
            .get(&addr_hex(&ca))
            .is_some_and(|c| !c.code.is_empty());
        if ocupado {
            return Err(erro("endereço de contrato já ocupado"));
        }
        (ca, code)
    } else {
        let alvo = campo_texto(tx, "to").unwrap_or("").to_lowercase();
        let parsed = parse_addr_strict(&alvo);
        // As DUAS condições do JS (regex E existência) com a MESMA mensagem.
        let existe = parsed.is_some() && world.state().contracts.contains_key(&alvo);
        let Some(ca) = parsed.filter(|_| existe) else {
            return Err(erro("destino não é um contrato EAVM (use data.to = 0x…)"));
        };
        let code = world.get_code(&ca);
        (ca, code)
    };

    // Valor da PRÓPRIA transação entrando no contrato (state.js:1097-1103). Vai
    // pelo journal do mundo: se a VM reverter (ou uma checagem posterior de taxa
    // lançar), o valor volta sozinho ao remetente — semântica de revert do EVM.
    // `kind = Entry` não vira transferência interna (já é visível como `amount`).
    if value > 0
        && !world.move_value(&sender0x, &contract_addr, Word::from(value), TransferKind::Entry)
    {
        return Err(erro("saldo insuficiente para o valor enviado ao contrato"));
    }

    // M-1 (state.js:1081-1083): timestamp REAL do bloco, não o da transação.
    let params = ExecParams {
        code,
        calldata: buffer_from_hex(if is_deploy { "" } else { campo_texto(tx, "input").unwrap_or("") }),
        gas: budget,
        caller: sender0x,
        address: contract_addr,
        value: Word::from(value),
        origin: Some(sender0x),
        gas_price: Word::ZERO,
        depth: 0,
        block: BlockContext {
            number: height,
            timestamp: block_ts,
            // A referência não põe gasLimit no bloco da VM (state.js:1083).
            gas_limit: 0,
            chain_id: EAVM_CHAIN_ID,
        },
        ..ExecParams::default()
    };

    let resultado = {
        let mut host = EavmHost::new(&mut world);
        vm::run_eavm(params, &mut host)
    };
    let res = match resultado {
        Ok(mut r) => {
            if is_deploy {
                // L-2 (state.js:1113-1121): cobra o gás de depósito de código
                // (len×20), igual ao CREATE aninhado — mas SÓ quando o deploy
                // efetivamente publica. Nos demais casos `success = false` SEM o
                // depósito no gasUsed (assimetria capturada no vetor oversized).
                let deposit = (r.return_data.len() as u64).saturating_mul(vm::GAS_CODE_DEPOSIT_BYTE);
                if r.success
                    && r.return_data.len() as u64 <= MAX_CONTRACT_BYTES
                    && r.gas_used.saturating_add(deposit) <= budget
                {
                    world.put_code(&contract_addr, &r.return_data);
                    r.gas_used = r.gas_used.saturating_add(deposit);
                } else {
                    r.success = false;
                }
            }
            r
        }
        // `catch (e) { if (e instanceof EavmError) … }` (state.js:1123-1126):
        // halt excepcional (SELFDESTRUCT, sem gás, opcode inválido) no frame de
        // entrada vira falha com o ORÇAMENTO INTEIRO consumido. Todo Err de
        // run_eavm É EavmError — não há o re-lance do JS. Note que o bloco de
        // depósito acima NÃO roda neste caminho (no JS a exceção pula o
        // `if (isDeploy)` inteiro).
        Err(_) => ExecResult {
            success: false,
            return_data: Vec::new(),
            gas_used: budget,
            gas_left: 0,
            logs: Vec::new(),
        },
    };
    if !res.success {
        // Reverte TUDO no mundo de contratos (state.js:1127) — inclusive o valor
        // de entrada e as contas materializadas pelo caminho unificado.
        world.revert(0);
    }

    // ---- de volta ao applyTransaction (state.js:1167-1183) ----
    //
    // Legado: gás gasto vira energia (base + ceil(gasUsed / GAS_PER_ENERGY)).
    // GB (plano 12): taxa = bytes úteis × ENERGY_COST[tipo] (gás só limita DoS).
    let acc_pos_vm = world.state().account(&tx.from);
    let (fee, peek_legado, peek_gb_opt) = if height >= crate::config::GB_FEE_HEIGHT {
        let gb = peek_gb(&acc_pos_vm, height, consumo_gb(tx));
        let fee = taxa_gb(&gb)?;
        if fee > fee_limit {
            world.revert(0);
            return Err(erro(
                "GB insuficiente e limite de taxa excedido — faça stake ou aumente o limite",
            ));
        }
        (fee, None, Some(gb))
    } else {
        let cost = base_cost + (res.gas_used as f64 / GAS_PER_ENERGY as f64).ceil();
        let energia = peek_energy(&acc_pos_vm, height, cost);
        let bw = (height >= RESOURCE_HEIGHT)
            .then(|| peek_bandwidth(&acc_pos_vm, height, canonical_tx_bytes(tx) as f64));
        let fee = taxa_de(&energia, bw.as_ref())?;
        if fee > fee_limit {
            // C-1/A-4 (state.js:1180-1183): a checagem de fee lança DEPOIS da VM —
            // desfaz o que ela mutou antes de propagar, senão a rejeição deixaria
            // storage/código/valor no estado.
            world.revert(0);
            return Err(erro(
                "recursos (energia/bandwidth) insuficientes e limite de taxa excedido — faça stake ou aumente o limite",
            ));
        }
        (fee, Some((energia, bw)), None)
    };

    // state.js:2586-2590: o valor (amount) já foi movido dentro da VM — aqui
    // resta só a taxa (queimada). O saldo lido é o PÓS-VM (o débito do valor de
    // entrada já aconteceu pelo journal). Se não cobrir, reverte atomicamente o
    // mundo, o que também devolve o valor ao remetente.
    let saldo = world.state().account(&tx.from).balance;
    let Some(novo_saldo) = saldo.checked_sub(fee) else {
        world.revert(0);
        return Err(erro("saldo insuficiente"));
    };

    // Transferências internas para o recibo (state.js:2612-2620), com os dois
    // lados mapeados para E7. Feito ANTES do commit: `e7_of` sobre saída de
    // `addr_hex` não tem como falhar, mas se falhar o mundo ainda reverte.
    let xfers_brutos = world.take_xfers();
    let mut xfers = Vec::with_capacity(xfers_brutos.len());
    for (from0x, to0x, valor, kind) in xfers_brutos {
        let (from_e7, to_e7) = match (e7_of(&from0x), e7_of(&to0x)) {
            (Ok(f), Ok(t)) => (f, t),
            _ => {
                world.revert(0);
                return Err(erro("endereço EAVM inválido"));
            }
        };
        xfers.push(EavmXfer {
            kind: match kind {
                TransferKind::Call => "call",
                TransferKind::Create => "create",
                // `entry` nunca é registrado pelo mundo (state.js:959); o braço
                // existe para o match ser total sem pânico.
                TransferKind::Entry => "entry",
            }
            .to_string(),
            from: from0x,
            to: to0x,
            from_e7,
            to_e7,
            amount: valor,
        });
    }

    // --- todas as validações passaram: o journal não é mais necessário ---
    drop(world);

    let acc = state.account_mut(&tx.from);
    acc.balance = novo_saldo;
    // O commit dos recursos (state.js:2631-2632) grava a contabilidade na folha
    // `acct` — energy/bandwidth (legado) ou gbUsed/gbBlock (após GB_FEE_HEIGHT).
    if let Some((energia, bw)) = peek_legado {
        commit_energy(acc, height, &energia);
        if let Some(b) = &bw {
            commit_bandwidth(acc, height, b);
        }
    } else if let Some(gb) = peek_gb_opt {
        commit_gb(acc, height, &gb);
    }

    // Recibo (state.js:2591-2621): logs e xfers SÓ de execução bem-sucedida.
    let logs = if res.success {
        res.logs
            .iter()
            .map(|lg| EavmLog {
                address: addr_hex(&lg.address),
                topics: lg
                    .topics
                    .iter()
                    .map(|t| format!("0x{}", hex::encode(t.to_be_bytes::<32>())))
                    .collect(),
                data: format!("0x{}", hex::encode(&lg.data)),
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok((
        fee,
        EavmOutcome {
            success: res.success,
            gas_used: res.gas_used,
            return_data: res.return_data,
            contract_addr: addr_hex(&contract_addr),
            is_deploy,
            logs,
            xfers,
        },
    ))
}

// ============================================================================
// Testes de unidade (a conformidade de verdade mora em tests/eavm_state.rs)
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peek_energy_regenera_linearmente_e_reporta_shortfall() {
        // Conta sem stake: maxE = FREE (10). Custo 14 → shortfall 4.
        let acc = Account::default();
        let p = peek_energy(&acc, 100, 14.0);
        assert_eq!(p.shortfall, 4.0);
        assert_eq!(p.used_after, 10.0, "consome tudo o que há e o resto queima");

        // Consumo registrado regenera ao longo de REGEN_BLOCKS.
        let usada = Account { energy_used: 10, energy_block: 0, ..Default::default() };
        // Na metade da janela, metade regenerou: floor(10*43200/86400) = 5.
        let p = peek_energy(&usada, 43200, 0.0);
        assert_eq!(p.used_after, 5.0);
    }

    #[test]
    fn max_energy_soma_o_bonus_por_stake_inteiro_de_eav7() {
        let mut acc = Account { staked: 10_000 * UNIT, ..Default::default() }; // 10.000 EAV7
        assert_eq!(max_energy(&acc), 10_010.0);
        // Fração de EAV7 não conta: BigInt trunca (state.js:120).
        acc.staked = 10_000 * UNIT + UNIT - 1;
        assert_eq!(max_energy(&acc), 10_010.0);
    }

    #[test]
    fn canonical_tx_bytes_bate_com_o_json_stringify_ordenado() {
        // Espelha o exemplo do gerador de vetores: os mesmos campos, o mesmo texto.
        let mut tx = Tx::new("EAVM_DEPLOY", "E7TESTE", 1, 1_700_000_000_000);
        tx.amount = "0".into();
        tx.fee = "10000000".into();
        tx.id = Some("ab".repeat(32));
        tx.data = Some(JsonValue::map([("code".to_string(), JsonValue::str("0x00"))]));
        let esperado = format!(
            "{{\"amount\":\"0\",\"data\":{{\"code\":\"0x00\"}},\"fee\":\"10000000\",\
             \"from\":\"E7TESTE\",\"id\":\"{}\",\"nonce\":1,\"protocol\":\"eav20\",\
             \"scheme\":\"eav7-hybrid-1\",\"timestamp\":1700000000000,\"to\":null,\
             \"type\":\"EAVM_DEPLOY\"}}",
            "ab".repeat(32)
        );
        assert_eq!(canonical_tx_bytes(&tx), esperado.len());
    }

    #[test]
    fn sender_legado_e_o_keccak_do_texto_e7() {
        // Abaixo do fork de valor: keccak(E7)[12:] — state.js:890-893.
        let mut tx = Tx::new("EAVM_DEPLOY", "E7QUALQUERCOISA", 1, 1);
        tx.scheme = "eav7-hybrid-1".into();
        let a = sender_eavm_form(&tx, 0).expect("forma legada sempre deriva");
        let d = Keccak256::digest("E7QUALQUERCOISA".as_bytes());
        assert_eq!(&a[..], &d[12..]);
    }

    #[test]
    fn sender_acima_do_fork_prefere_eavm_from_e_cai_para_encode_e7() {
        use crate::address::derive_address_from;
        let e7 = derive_address_from("EAVMTX:sender");
        let mut tx = Tx::new("EAVM_DEPLOY", &e7, 1, 1);

        // Nativa: encodeE7Dest(tx.from).
        let a = sender_eavm_form(&tx, EAVM_VALUE_HEIGHT).expect("endereço válido");
        assert_eq!(addr_hex(&a), encode_e7_dest(&e7).expect("E7 derivado é válido"));

        // Rota EVM com eavmFrom: a identidade É o 0x real.
        tx.scheme = EAVM_SCHEME.into();
        tx.data = Some(JsonValue::map([(
            "eavmFrom".to_string(),
            JsonValue::str(format!("0x{}", "5A".repeat(20))),
        )]));
        let a = sender_eavm_form(&tx, EAVM_VALUE_HEIGHT).expect("eavmFrom válido");
        assert_eq!(addr_hex(&a), format!("0x{}", "5a".repeat(20)), "baixa a caixa como o JS");
    }
}
