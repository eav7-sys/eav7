import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { buildAiTaskTx, buildAiResultTx, buildOracleRegisterTx, buildAiClaimTx, aiResultHash } from '../src/ai/bridge.js';

const H = CHAIN.AI_PRIVATE_HEIGHT;

function acct(state, kp) {
  const a = walletAddress(kp);
  Object.assign(state.getAccount(a), { balance: 5_000n * CHAIN.UNIT, staked: 1_000n * CHAIN.UNIT });
  return a;
}

test('Fase 5: resultado hash-only (privado/off-chain) grava só o compromisso e é verificável', () => {
  const state = new State();
  const user = generateKeyPair(); const oracle = generateKeyPair();
  const ua = acct(state, user); const oa = acct(state, oracle);
  state.applyTransaction(buildOracleRegisterTx(oracle, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), H, 1000);

  const t0 = 10_000_000;
  // tarefa privada (o prompt iria cifrado; aqui é só bytes)
  const task = buildAiTaskTx(user, { prompt: 'CIFRADO', oracle: oa, private: true, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0 - 1000);
  assert.equal(state.aiTasks[task.id].private, true);

  // o resultado REAL fica off-chain; on-chain só o hash + ponteiro
  const outputReal = 'resposta cifrada para o solicitante';
  const hash = aiResultHash(outputReal);
  state.applyTransaction(buildAiResultTx(oracle, { taskId: task.id, resultHash: hash, resultUri: 'ipfs://QmTest', nonce: 2 }), H, t0);

  const tk = state.aiTasks[task.id];
  assert.equal(tk.output, null); // nada de plaintext on-chain
  assert.equal(tk.resultHash, hash);
  assert.equal(tk.resultUri, 'ipfs://QmTest');
  assert.equal(tk.status, 'CHALLENGE_PERIOD');
  // verificação: quem recuperar o output off-chain confere que bate com o compromisso
  assert.equal(aiResultHash(outputReal), tk.resultHash);

  // liquida (não contestado) → oráculo pago
  const balO = state.balanceOf(oa);
  state.applyTransaction(buildAiClaimTx(user, { taskId: task.id, nonce: 2 }), H, t0 + CHAIN.AI_CHALLENGE_WINDOW_MS + 1);
  assert.equal(state.aiTasks[task.id].status, 'DONE');
  assert.equal(state.balanceOf(oa), balO + 5n * CHAIN.UNIT);
});

test('Fase 5: resultHash malformado é rejeitado', () => {
  const state = new State();
  const user = generateKeyPair(); const oracle = generateKeyPair();
  const oa = acct(state, oracle); acct(state, user);
  state.applyTransaction(buildOracleRegisterTx(oracle, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), H, 1000);
  const task = buildAiTaskTx(user, { prompt: 'x', oracle: oa, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, 10_000_000);
  assert.throws(
    () => state.clone().applyTransaction(buildAiResultTx(oracle, { taskId: task.id, resultHash: 'nao-e-hash', nonce: 2 }), H, 10_000_100),
    /resultHash inválido/,
  );
});

test('grandfather: abaixo do fork, resultado hash-only é rejeitado (output obrigatório)', () => {
  const state = new State();
  const user = generateKeyPair(); const oracle = generateKeyPair();
  const oa = acct(state, oracle); acct(state, user);
  state.applyTransaction(buildOracleRegisterTx(oracle, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), 0, 1000);
  const task = buildAiTaskTx(user, { prompt: 'x', oracle: oa, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, 0, 1000);
  // só resultHash, sem output, abaixo do fork → exige output
  assert.throws(
    () => state.applyTransaction(buildAiResultTx(oracle, { taskId: task.id, resultHash: aiResultHash('z'), nonce: 2 }), 0, 1001),
    /output obrigatório/,
  );
});
