import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import {
  buildAiTaskTx, buildAiResultTx, buildOracleRegisterTx,
  buildAiBidTx, buildAiAwardTx, buildAiClaimTx, buildAiRefundTx,
} from '../src/ai/bridge.js';

const H = CHAIN.AI_MARKET_HEIGHT;

function acct(state, kp) {
  const a = walletAddress(kp);
  Object.assign(state.getAccount(a), { balance: 5_000n * CHAIN.UNIT, staked: 1_000n * CHAIN.UNIT });
  return a;
}
function reg(state, kp) { state.applyTransaction(buildOracleRegisterTx(kp, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), H, 1000); }

test('Fase 4: leilão — lances, adjudicação ao melhor preço, excedente devolvido e entrega', () => {
  const state = new State();
  const user = generateKeyPair(); const o1 = generateKeyPair(); const o2 = generateKeyPair();
  const ua = acct(state, user); const a1 = acct(state, o1); const a2 = acct(state, o2);
  reg(state, o1); reg(state, o2);

  const t0 = 10_000_000;
  // tarefa ABERTA com orçamento de 10 EAV7
  const task = buildAiTaskTx(user, { prompt: 'faça X', open: true, reward: 10n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0);
  assert.equal(state.aiTasks[task.id].status, 'BIDDING');

  // lances: o1 = 6, o2 = 4 (mais barato)
  state.applyTransaction(buildAiBidTx(o1, { taskId: task.id, price: 6n * CHAIN.UNIT, nonce: 2 }), H, t0 + 100);
  state.applyTransaction(buildAiBidTx(o2, { taskId: task.id, price: 4n * CHAIN.UNIT, nonce: 2 }), H, t0 + 100);

  const balU = state.balanceOf(ua);
  // solicitante adjudica ao o2 (4 EAV7); excedente (10-4=6) volta
  state.applyTransaction(buildAiAwardTx(user, { taskId: task.id, oracle: a2, nonce: 2 }), H, t0 + 200);
  const tk = state.aiTasks[task.id];
  assert.equal(tk.status, 'PENDING');
  assert.equal(tk.assignedOracle, a2);
  assert.equal(tk.reward, 4n * CHAIN.UNIT);
  assert.equal(state.balanceOf(ua), balU + 6n * CHAIN.UNIT); // excedente devolvido

  // o2 entrega → janela de desafio (Fase 3, ativa nesta altura) → claim paga o oráculo
  state.applyTransaction(buildAiResultTx(o2, { taskId: task.id, output: 'ok', nonce: 3 }), H, t0 + 300);
  assert.equal(state.aiTasks[task.id].status, 'CHALLENGE_PERIOD');
  const balO2 = state.balanceOf(a2);
  state.applyTransaction(buildAiClaimTx(user, { taskId: task.id, nonce: 3 }), H, t0 + 300 + CHAIN.AI_CHALLENGE_WINDOW_MS + 1);
  assert.equal(state.aiTasks[task.id].status, 'DONE');
  assert.equal(state.balanceOf(a2), balO2 + 4n * CHAIN.UNIT); // pago o preço do lance
  assert.equal(state.oracles[a2].reputation, 54);
});

test('Fase 4: adjudicar a quem não deu lance é rejeitado', () => {
  const state = new State();
  const user = generateKeyPair(); const o1 = generateKeyPair(); const o2 = generateKeyPair();
  acct(state, user); const a1 = acct(state, o1); acct(state, o2);
  reg(state, o1); reg(state, o2);
  const t0 = 10_000_000;
  const task = buildAiTaskTx(user, { prompt: 'x', open: true, reward: 10n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0);
  state.applyTransaction(buildAiBidTx(o1, { taskId: task.id, price: 5n * CHAIN.UNIT, nonce: 2 }), H, t0 + 100);
  // tenta adjudicar ao o2 (que não deu lance)
  assert.throws(() => state.clone().applyTransaction(buildAiAwardTx(user, { taskId: task.id, oracle: walletAddress(o2), nonce: 2 }), H, t0 + 200), /não deu lance/);
});

test('Fase 4: lance por não-oráculo e preço acima do orçamento são rejeitados', () => {
  const state = new State();
  const user = generateKeyPair(); const naoOrac = generateKeyPair(); const o1 = generateKeyPair();
  acct(state, user); acct(state, naoOrac); acct(state, o1);
  reg(state, o1);
  const t0 = 10_000_000;
  const task = buildAiTaskTx(user, { prompt: 'x', open: true, reward: 10n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0);
  assert.throws(() => state.clone().applyTransaction(buildAiBidTx(naoOrac, { taskId: task.id, price: 5n * CHAIN.UNIT, nonce: 1 }), H, t0 + 100), /só oráculo registrado/);
  assert.throws(() => state.clone().applyTransaction(buildAiBidTx(o1, { taskId: task.id, price: 99n * CHAIN.UNIT, nonce: 2 }), H, t0 + 100), /preço do lance inválido/);
});

test('Fase 4: tarefa aberta sem adjudicação pode ser reembolsada após expirar', () => {
  const state = new State();
  const user = generateKeyPair();
  const ua = acct(state, user);
  const t0 = 10_000_000;
  const task = buildAiTaskTx(user, { prompt: 'x', open: true, reward: 10n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0);
  const balU = state.balanceOf(ua);
  const tExp = t0 + CHAIN.AI_TASK_TIMEOUT_MS + 1;
  state.applyTransaction(buildAiRefundTx(user, { taskId: task.id, nonce: 2, timestamp: tExp }), H, tExp);
  assert.equal(state.aiTasks[task.id].status, 'REFUNDED');
  assert.equal(state.balanceOf(ua), balU + 10n * CHAIN.UNIT); // orçamento devolvido
});

test('grandfather: abaixo do fork, AI_TASK aberta exige oráculo designado', () => {
  const state = new State();
  const user = generateKeyPair();
  acct(state, user);
  const task = buildAiTaskTx(user, { prompt: 'x', open: true, reward: 2n * CHAIN.UNIT, nonce: 1 });
  assert.throws(() => state.applyTransaction(task, 0, 1000), /oráculo designado/);
});
