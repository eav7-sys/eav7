import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { buildAiTaskTx, buildAiCommitTx, buildAiRevealTx, buildOracleRegisterTx, aiCommitHash } from '../src/ai/bridge.js';

const H = CHAIN.AI_QUORUM_HEIGHT;

function acct(state, kp, stake = 1_000n) {
  const a = walletAddress(kp);
  Object.assign(state.getAccount(a), { balance: 5_000n * CHAIN.UNIT, staked: stake * CHAIN.UNIT });
  return a;
}

test('IA — quórum com commit-reveal: 2 oráculos concordantes concluem e dividem a recompensa', () => {
  const state = new State();
  const user = generateKeyPair(); const o1 = generateKeyPair(); const o2 = generateKeyPair(); const o3 = generateKeyPair();
  const ua = acct(state, user); const a1 = acct(state, o1); const a2 = acct(state, o2); const a3 = acct(state, o3);
  for (const [kp] of [[o1], [o2], [o3]]) {
    state.applyTransaction(buildOracleRegisterTx(kp, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), H, 1000);
  }

  const t0 = 10_000_000;
  const task = buildAiTaskTx(user, { prompt: 'quanto é 2+2?', quorum: 2, reward: 6n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0);
  assert.equal(state.aiTasks[task.id].mode, 'QUORUM');

  // COMMIT (antes de fechar a janela) — mesma resposta 'A' de o1/o2, resposta divergente 'B' de o3
  const tc = t0 + 100;
  state.applyTransaction(buildAiCommitTx(o1, { taskId: task.id, commit: aiCommitHash('A', 's1'), nonce: 2 }), H, tc);
  state.applyTransaction(buildAiCommitTx(o2, { taskId: task.id, commit: aiCommitHash('A', 's2'), nonce: 2 }), H, tc);
  state.applyTransaction(buildAiCommitTx(o3, { taskId: task.id, commit: aiCommitHash('B', 's3'), nonce: 2 }), H, tc);

  // REVEAL (após o commit fechar). o2 é quem atinge o quórum → conclui.
  const tr = t0 + CHAIN.AI_COMMIT_WINDOW_MS + 100;
  state.applyTransaction(buildAiRevealTx(o1, { taskId: task.id, output: 'A', salt: 's1', nonce: 3 }), H, tr);
  state.applyTransaction(buildAiRevealTx(o3, { taskId: task.id, output: 'B', salt: 's3', nonce: 3 }), H, tr);
  const balA1 = state.balanceOf(a1);
  state.applyTransaction(buildAiRevealTx(o2, { taskId: task.id, output: 'A', salt: 's2', nonce: 3 }), H, tr);

  const tk = state.aiTasks[task.id];
  assert.equal(tk.status, 'DONE');
  assert.deepEqual(tk.winners.sort(), [a1, a2].sort());
  // recompensa dividida (6 / 2 = 3 cada); o1 é creditado quando o2 fecha o quórum
  assert.equal(state.balanceOf(a1), balA1 + 3n * CHAIN.UNIT);
  // reputação: vencedores sobem, minoria (o3) cai
  assert.equal(state.oracles[a1].reputation, 54);
  assert.equal(state.oracles[a2].reputation, 54);
  assert.equal(state.oracles[a1].completed, 1);
  assert.equal(state.oracles[a3].reputation, 38);
  assert.equal(state.oracles[a3].failed, 1);
});

test('IA — commit-reveal impede copiar: reveal que não bate com o commit é rejeitado', () => {
  const state = new State();
  const user = generateKeyPair(); const o1 = generateKeyPair();
  acct(state, user); acct(state, o1);
  state.applyTransaction(buildOracleRegisterTx(o1, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), H, 1000);
  const t0 = 10_000_000;
  const task = buildAiTaskTx(user, { prompt: 'x', quorum: 2, reward: 2n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0);
  state.applyTransaction(buildAiCommitTx(o1, { taskId: task.id, commit: aiCommitHash('A', 's1'), nonce: 2 }), H, t0 + 100);
  const tr = t0 + CHAIN.AI_COMMIT_WINDOW_MS + 100;
  // revela output diferente do commitado → rejeitado
  assert.throws(
    () => state.clone().applyTransaction(buildAiRevealTx(o1, { taskId: task.id, output: 'OUTRO', salt: 's1', nonce: 3 }), H, tr),
    /reveal não confere/,
  );
});

test('grandfather: abaixo do fork, AI_TASK com quórum exige oráculo designado (modo antigo)', () => {
  const state = new State();
  const user = generateKeyPair();
  acct(state, user);
  const task = buildAiTaskTx(user, { prompt: 'x', quorum: 3, reward: 2n * CHAIN.UNIT, nonce: 1 });
  // height 0 (< AI_QUORUM_HEIGHT) → o modo quórum não existe; cai no caminho antigo que exige oráculo
  assert.throws(() => state.applyTransaction(task, 0, 1000), /oráculo designado/);
});
