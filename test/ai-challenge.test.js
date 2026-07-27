import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import {
  buildAiTaskTx, buildAiResultTx, buildOracleRegisterTx,
  buildAiClaimTx, buildAiChallengeTx, buildAiVerdictTx,
} from '../src/ai/bridge.js';

const H = CHAIN.AI_CHALLENGE_HEIGHT;
const CW = CHAIN.AI_CHALLENGE_WINDOW_MS;

function acct(state, kp) {
  const a = walletAddress(kp);
  Object.assign(state.getAccount(a), { balance: 5_000n * CHAIN.UNIT, staked: 1_000n * CHAIN.UNIT });
  return a;
}
function reg(state, kp) { state.applyTransaction(buildOracleRegisterTx(kp, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), H, 1000); }

test('Fase 3: resultado não contestado é liquidado (claim) e paga o oráculo', () => {
  const state = new State();
  const user = generateKeyPair(); const oracle = generateKeyPair();
  const ua = acct(state, user); const oa = acct(state, oracle);
  reg(state, oracle);

  const t0 = 10_000_000;
  const task = buildAiTaskTx(user, { prompt: 'q', oracle: oa, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0 - 1000);
  state.applyTransaction(buildAiResultTx(oracle, { taskId: task.id, output: 'r', nonce: 2 }), H, t0);
  assert.equal(state.aiTasks[task.id].status, 'CHALLENGE_PERIOD');

  const balO = state.balanceOf(oa);
  state.applyTransaction(buildAiClaimTx(user, { taskId: task.id, nonce: 2 }), H, t0 + CW + 1);
  assert.equal(state.aiTasks[task.id].status, 'DONE');
  assert.equal(state.balanceOf(oa), balO + 5n * CHAIN.UNIT);
  assert.equal(state.oracles[oa].reputation, 54);
  assert.equal(state.oracles[oa].completed, 1);
});

test('Fase 3: desafio julgado VÁLIDO (mantido) — oráculo leva reward + fiança do desafiante', () => {
  const state = new State();
  const user = generateKeyPair(); const oracle = generateKeyPair(); const chal = generateKeyPair();
  const j1 = generateKeyPair(); const j2 = generateKeyPair(); const j3 = generateKeyPair();
  const ua = acct(state, user); const oa = acct(state, oracle); const ca = acct(state, chal);
  const ja = [j1, j2, j3].map((k) => acct(state, k));
  reg(state, oracle); [j1, j2, j3].forEach((k) => reg(state, k));

  const t0 = 10_000_000;
  const task = buildAiTaskTx(user, { prompt: 'q', oracle: oa, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0 - 1000);
  state.applyTransaction(buildAiResultTx(oracle, { taskId: task.id, output: 'r', nonce: 2 }), H, t0);

  const balO = state.balanceOf(oa); const balC = state.balanceOf(ca);
  state.applyTransaction(buildAiChallengeTx(chal, { taskId: task.id, nonce: 1 }), H, t0 + 100);
  assert.equal(state.aiTasks[task.id].status, 'DISPUTED');
  [j1, j2, j3].forEach((k) => state.applyTransaction(buildAiVerdictTx(k, { taskId: task.id, valid: true, nonce: 2 }), H, t0 + 200));

  assert.equal(state.aiTasks[task.id].status, 'UPHELD');
  // oráculo: reward (5) + fiança do desafiante (20) = 25
  assert.equal(state.balanceOf(oa), balO + 25n * CHAIN.UNIT);
  assert.equal(state.balanceOf(ca), balC - CHAIN.AI_CHALLENGE_BOND); // perdeu a fiança
  assert.equal(state.oracles[oa].reputation, 54);
  assert.equal(state.oracles[ja[0]].reputation, 52); // jurado que acertou sobe
});

test('Fase 3: desafio julgado INVÁLIDO (derrubado) — oráculo slashado, desafiante premiado', () => {
  const state = new State();
  const user = generateKeyPair(); const oracle = generateKeyPair(); const chal = generateKeyPair();
  const j1 = generateKeyPair(); const j2 = generateKeyPair(); const j3 = generateKeyPair();
  const ua = acct(state, user); const oa = acct(state, oracle); const ca = acct(state, chal);
  [j1, j2, j3].forEach((k) => acct(state, k));
  reg(state, oracle); [j1, j2, j3].forEach((k) => reg(state, k));
  const stakeAntes = state.oracles[oa].stake;

  const t0 = 10_000_000;
  const task = buildAiTaskTx(user, { prompt: 'q', oracle: oa, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0 - 1000);
  state.applyTransaction(buildAiResultTx(oracle, { taskId: task.id, output: 'r', nonce: 2 }), H, t0);

  const balU = state.balanceOf(ua); const balC = state.balanceOf(ca);
  state.applyTransaction(buildAiChallengeTx(chal, { taskId: task.id, nonce: 1 }), H, t0 + 100);
  [j1, j2, j3].forEach((k) => state.applyTransaction(buildAiVerdictTx(k, { taskId: task.id, valid: false, nonce: 2 }), H, t0 + 200));

  assert.equal(state.aiTasks[task.id].status, 'OVERTURNED');
  // requester reembolsado (5); oráculo slashado AI_ORACLE_SLASH; desafiante: fiança de volta + bounty
  assert.equal(state.balanceOf(ua), balU + 5n * CHAIN.UNIT);
  assert.equal(state.oracles[oa].slashed, CHAIN.AI_ORACLE_SLASH);
  assert.equal(state.oracles[oa].stake, stakeAntes - CHAIN.AI_ORACLE_SLASH);
  assert.equal(state.oracles[oa].reputation, 38);
  // desafiante: -fiança (na hora do challenge) + fiança + bounty (no veredito) = +bounty
  assert.equal(state.balanceOf(ca), balC + CHAIN.AI_ORACLE_SLASH);
});

test('grandfather: abaixo do fork, AI_RESULT paga na hora (sem janela de desafio)', () => {
  const state = new State();
  const user = generateKeyPair(); const oracle = generateKeyPair();
  const ua = acct(state, user); const oa = acct(state, oracle);
  state.applyTransaction(buildOracleRegisterTx(oracle, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), 0, 1000);
  const task = buildAiTaskTx(user, { prompt: 'q', oracle: oa, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, 0, 1000);
  state.applyTransaction(buildAiResultTx(oracle, { taskId: task.id, output: 'r', nonce: 2 }), 0, 1001);
  assert.equal(state.aiTasks[task.id].status, 'DONE'); // pago imediatamente (Fase 1)
});
