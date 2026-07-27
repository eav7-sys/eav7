// Permissões v2 — pré-requisitos (docs/permissoes-v2.md, passos 1-3).
//
// O ponto destes testes é o motivo REAL da trava `staked == 0`: sem VOTE como operação
// multisig, um validador que virasse multisig ficaria com stake e voto presos para sempre.
// Aqui provamos que acima do fork isso deixa de acontecer — e que abaixo dele nada mudou.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { buildTransaction } from '../src/core/transaction.js';

const H = CHAIN.PERMISSIONS_V2_HEIGHT;
const BELOW = CHAIN.PERMISSIONS_V2_HEIGHT - 1;

function conta(state, { saldo = 10_000n, stake = 0n } = {}) {
  const w = generateKeyPair();
  const addr = walletAddress(w);
  const a = state.getAccount(addr);
  a.balance = saldo * CHAIN.UNIT;
  a.staked = stake * CHAIN.UNIT;
  return { w, addr };
}

// Monta uma conta multisig 1-de-1 (chave `dono` autoriza) já com stake.
function multisigComStake(state, height) {
  const alvo = conta(state, { saldo: 10_000n, stake: 5_000n });
  const dono = conta(state);
  state.applyTransaction(
    buildTransaction(alvo.w, {
      type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
      data: { permission: { threshold: 1, keys: { [dono.addr]: 1 } } },
    }),
    height,
  );
  return { alvo, dono };
}

// Executa uma operação multisig 1-de-1: propor já atinge o limiar e aplica.
// Lê o nonce REAL do proponente: uma tx que lança NÃO incrementa nonce, então numerar
// à mão quebra assim que um caso de erro entra no meio.
function opMultisig(state, dono, alvo, op, height) {
  const nonce = (state.accounts[dono.addr]?.nonce ?? 0) + 1;
  return state.applyTransaction(
    buildTransaction(dono.w, {
      type: 'MULTISIG_PROPOSE', amount: 0, nonce,
      data: { account: alvo.addr, op },
    }),
    height,
  );
}

test('v2: ABAIXO do fork, conta com stake continua proibida de virar multisig', () => {
  const state = new State();
  const alvo = conta(state, { stake: 5_000n });
  const dono = conta(state);
  assert.throws(
    () => state.applyTransaction(
      buildTransaction(alvo.w, {
        type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
        data: { permission: { threshold: 1, keys: { [dono.addr]: 1 } } },
      }),
      BELOW,
    ),
    /conta com stake não pode virar multisig/,
  );
});

test('v2: ACIMA do fork, validador pode virar multisig', () => {
  const state = new State();
  const { alvo } = multisigComStake(state, H);
  assert.ok(state.permissions[alvo.addr], 'permissão configurada');
  assert.equal(state.accounts[alvo.addr].staked, 5_000n * CHAIN.UNIT, 'stake preservado');
});

test('v2: conta multisig VOTA por operação — o voto deixa de ficar preso', () => {
  const state = new State();
  const { alvo, dono } = multisigComStake(state, H);
  const cand = conta(state, { stake: 2_000n }); // elegível: self-stake >= mínimo

  opMultisig(state, dono, alvo, { type: 'VOTE', votes: { [cand.addr]: (1_000n * CHAIN.UNIT).toString() } }, H);

  assert.equal(state.votes[alvo.addr][cand.addr], (1_000n * CHAIN.UNIT).toString());
  assert.equal(state.candidateVotes[cand.addr], 1_000n * CHAIN.UNIT);
});

test('v2: VOTE multisig respeita as MESMAS regras da transação VOTE', () => {
  const state = new State();
  const { alvo, dono } = multisigComStake(state, H);
  const inelegivel = conta(state, { stake: 0n });

  // candidato sem self-stake mínimo
  assert.throws(
    () => opMultisig(state, dono, alvo, { type: 'VOTE', votes: { [inelegivel.addr]: '1' } }, H),
    /candidato não elegível/,
  );
  // votar em si mesmo
  assert.throws(
    () => opMultisig(state, dono, alvo, { type: 'VOTE', votes: { [alvo.addr]: '1' } }, H),
    /votar em si mesmo/,
  );
  // acima do poder de voto
  const cand = conta(state, { stake: 2_000n });
  assert.throws(
    () => opMultisig(state, dono, alvo, { type: 'VOTE', votes: { [cand.addr]: (99_999n * CHAIN.UNIT).toString() } }, H),
    /excedem o poder de voto/,
  );
});

test('v2: SET_COMMISSION e CLAIM_VOTER_REWARD por operação multisig', () => {
  const state = new State();
  const { alvo, dono } = multisigComStake(state, H);
  const cand = conta(state, { stake: 2_000n });

  opMultisig(state, dono, alvo, { type: 'SET_COMMISSION', percent: 15 }, H);
  // Agendada, não imediata — mesmo trilho que fecha a captura da recompensa dos eleitores.
  assert.equal(state.pendingCommission[alvo.addr].pct, 15);
  state.blockTick(H + CHAIN.COMMISSION_DELAY_BLOCKS);
  assert.equal(state.commission[alvo.addr], 15);

  opMultisig(state, dono, alvo, { type: 'VOTE', votes: { [cand.addr]: (1_000n * CHAIN.UNIT).toString() } }, H);
  // resgatar sem recompensa acumulada é no-op, mas não pode lançar
  opMultisig(state, dono, alvo, { type: 'CLAIM_VOTER_REWARD', validator: cand.addr }, H);

  assert.throws(
    () => opMultisig(state, dono, alvo, { type: 'CLAIM_VOTER_REWARD', validator: conta(state).addr }, H),
    /não vota nesse validador/,
  );
});

test('v2: ABAIXO do fork as novas operações multisig são rejeitadas', () => {
  const state = new State();
  // configura a permissão SEM stake (abaixo do fork a trava ainda vale)
  const alvo = conta(state);
  const dono = conta(state);
  state.applyTransaction(
    buildTransaction(alvo.w, {
      type: 'PERMISSION_UPDATE', amount: 0, nonce: 1,
      data: { permission: { threshold: 1, keys: { [dono.addr]: 1 } } },
    }),
    BELOW,
  );
  assert.throws(
    () => opMultisig(state, dono, alvo, { type: 'SET_COMMISSION', percent: 10 }, BELOW),
    /não suportado/,
  );
});

test('v2: transação VOTE normal continua idêntica (mesmo código, sem regressão)', () => {
  const state = new State();
  const eleitor = conta(state, { stake: 3_000n });
  const cand = conta(state, { stake: 2_000n });

  state.applyTransaction(
    buildTransaction(eleitor.w, {
      type: 'VOTE', amount: 0, nonce: 1,
      data: { votes: { [cand.addr]: (1_500n * CHAIN.UNIT).toString() } },
    }),
    H,
  );
  assert.equal(state.candidateVotes[cand.addr], 1_500n * CHAIN.UNIT);

  // re-VOTE substitui a alocação anterior
  state.applyTransaction(
    buildTransaction(eleitor.w, {
      type: 'VOTE', amount: 0, nonce: 2,
      data: { votes: { [cand.addr]: (500n * CHAIN.UNIT).toString() } },
    }),
    H,
  );
  assert.equal(state.candidateVotes[cand.addr], 500n * CHAIN.UNIT, 'substituiu, não somou');
});

test('v2: VOTE inválido não deixa taxa cobrada nem estado sujo', () => {
  const state = new State();
  const eleitor = conta(state, { stake: 3_000n });
  const saldoAntes = state.balanceOf(eleitor.addr);

  assert.throws(
    () => state.applyTransaction(
      buildTransaction(eleitor.w, {
        type: 'VOTE', amount: 0, nonce: 1,
        data: { votes: { [conta(state).addr]: '1' } }, // candidato não elegível
      }),
      H,
    ),
    /candidato não elegível/,
  );
  assert.equal(state.balanceOf(eleitor.addr), saldoAntes, 'saldo intacto');
  assert.equal(state.votes[eleitor.addr], undefined, 'nenhum voto registrado');
});

// --- Endurecimentos de paridade com a TRON (mesma altura de fork) ----------------------

test('paridade: teto de saques simultâneos por conta (a TRON usa 32)', () => {
  const state = new State();
  const v = conta(state, { saldo: 1_000n, stake: 10_000n });
  conta(state, { stake: 10_000n }); // segundo validador, p/ não travar a rede
  let n = 1;
  for (let i = 0; i < CHAIN.MAX_UNBONDING_ENTRIES; i++) {
    state.applyTransaction(buildTransaction(v.w, { type: 'UNSTAKE', amount: '1', nonce: n++ }), H);
  }
  const stakeAntes = state.accounts[v.addr].staked;
  assert.throws(
    () => state.applyTransaction(buildTransaction(v.w, { type: 'UNSTAKE', amount: '1', nonce: n }), H),
    /saques simultâneos/,
  );
  assert.equal(state.accounts[v.addr].staked, stakeAntes, 'stake devolvido ao rejeitar');
  assert.equal(state.unbonding.length, CHAIN.MAX_UNBONDING_ENTRIES, 'fila não cresceu');
});

test('paridade: ABAIXO do fork o teto de saques não vale (comportamento antigo)', () => {
  const state = new State();
  const v = conta(state, { saldo: 1_000n, stake: 10_000n });
  conta(state, { stake: 10_000n });
  let n = 1;
  for (let i = 0; i < CHAIN.MAX_UNBONDING_ENTRIES + 5; i++) {
    state.applyTransaction(buildTransaction(v.w, { type: 'UNSTAKE', amount: '1', nonce: n++ }), BELOW);
  }
  assert.equal(state.unbonding.length, CHAIN.MAX_UNBONDING_ENTRIES + 5);
});

test('paridade: símbolo de token é único', () => {
  const state = new State();
  const a = conta(state);
  const b = conta(state);
  const params = { name: 'Dolar Digital', symbol: 'USDX', decimals: 6, totalSupply: '1000000' };
  state.applyTransaction(buildTransaction(a.w, { type: 'TOKEN_CREATE', amount: 0, nonce: 1, data: params }), H);
  assert.throws(
    () => state.applyTransaction(buildTransaction(b.w, { type: 'TOKEN_CREATE', amount: 0, nonce: 1, data: params }), H),
    /símbolo de token já existe/,
  );
});

test('paridade: comissão só vale após atraso — fecha a captura da recompensa dos eleitores', () => {
  const state = new State();
  const val = conta(state, { saldo: 100n, stake: 5_000n });
  const el = conta(state, { saldo: 100n, stake: 5_000n });
  state.applyTransaction(buildTransaction(el.w, { type: 'VOTE', amount: 0, nonce: 1, data: { votes: { [val.addr]: (5_000n * CHAIN.UNIT).toString() } } }), H);

  // validador tenta subir para 100% e produzir no mesmo instante
  state.applyTransaction(buildTransaction(val.w, { type: 'SET_COMMISSION', amount: 0, nonce: 1, data: { percent: 100 } }), H);
  assert.equal(state.commission[val.addr], undefined, 'comissão ainda não vale');
  assert.ok(state.pendingCommission[val.addr], 'ficou agendada');

  const antes = state.balanceOf(el.addr);
  state.distributeBlockReward(val.addr, 16n * CHAIN.UNIT);
  state.applyTransaction(buildTransaction(el.w, { type: 'CLAIM_VOTER_REWARD', amount: 0, nonce: 2, data: { validator: val.addr } }), H);
  assert.ok(state.balanceOf(el.addr) > antes, 'eleitor recebeu sob a comissão ANTIGA');

  // depois do atraso, a nova comissão vale
  state.blockTick(H + CHAIN.COMMISSION_DELAY_BLOCKS);
  assert.equal(state.commission[val.addr], 100, 'aplicada após o atraso');
});
