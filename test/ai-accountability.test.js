import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { buildAiTaskTx, buildAiResultTx, buildAiRefundTx, buildOracleRegisterTx } from '../src/ai/bridge.js';

const H = CHAIN.AI_ACCOUNTABILITY_HEIGHT; // altura de fork (accountability ativa)

function setup() {
  const usuario = generateKeyPair();
  const oraculo = generateKeyPair();
  const state = new State();
  const ua = walletAddress(usuario), oa = walletAddress(oraculo);
  // saldo + stake (o stake dá bandwidth/energia; na altura do fork o modelo de recurso está ativo)
  Object.assign(state.getAccount(ua), { balance: 10_000n * CHAIN.UNIT, staked: 1_000n * CHAIN.UNIT });
  Object.assign(state.getAccount(oa), { balance: 2_000n * CHAIN.UNIT, staked: 1_000n * CHAIN.UNIT });
  return { usuario, oraculo, state, usuarioAddr: ua, oraculoAddr: oa };
}

test('IA que aprende: entrega bem-sucedida sobe a reputação do oráculo', () => {
  const { usuario, oraculo, state, oraculoAddr } = setup();
  state.applyTransaction(buildOracleRegisterTx(oraculo, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), H, 1000);
  assert.equal(state.oracles[oraculoAddr].reputation, 50); // começa neutro

  const task = buildAiTaskTx(usuario, { prompt: 'Resuma o gênese', oracle: oraculoAddr, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, 1000);
  state.applyTransaction(buildAiResultTx(oraculo, { taskId: task.id, output: 'resumo', nonce: 2 }), H, 1001);

  const orc = state.oracles[oraculoAddr];
  assert.equal(orc.completed, 1);
  assert.equal(orc.reputation, 54); // 50 + 4 (aprendeu com o acerto)
  assert.equal(orc.failed, 0);
});

test('IA se auto-corrige: não-entrega slasha o oráculo e compensa o solicitante (no fork)', () => {
  const { usuario, oraculo, state, usuarioAddr, oraculoAddr } = setup();
  state.applyTransaction(buildOracleRegisterTx(oraculo, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), H, 1000);
  const stakeAntes = state.oracles[oraculoAddr].stake;

  const t0 = 2_000_000;
  const task = buildAiTaskTx(usuario, { prompt: 'tarefa que vai expirar', oracle: oraculoAddr, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, t0); // expiresAt = t0 + AI_TASK_TIMEOUT_MS

  const saldoAntesRefund = state.balanceOf(usuarioAddr);
  const tExpira = t0 + CHAIN.AI_TASK_TIMEOUT_MS + 1;
  state.applyTransaction(
    buildAiRefundTx(usuario, { taskId: task.id, nonce: 2, timestamp: tExpira }),
    H, tExpira,
  );

  const orc = state.oracles[oraculoAddr];
  assert.equal(orc.failed, 1);
  assert.equal(orc.reputation, 38); // 50 - 12 (aprendeu com a falha)
  assert.equal(orc.slashed, CHAIN.AI_ORACLE_SLASH);
  assert.equal(orc.stake, stakeAntes - CHAIN.AI_ORACLE_SLASH); // slash sai do stake travado
  // solicitante recebe o reward de volta (5) + a compensação do slash (10)
  assert.equal(state.balanceOf(usuarioAddr), saldoAntesRefund + 5n * CHAIN.UNIT + CHAIN.AI_ORACLE_SLASH);
});

test('grandfather: abaixo do fork, não-entrega NÃO slasha (histórico continua válido)', () => {
  const { usuario, oraculo, state, oraculoAddr } = setup();
  state.applyTransaction(buildOracleRegisterTx(oraculo, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), 0, 1000);
  const stakeAntes = state.oracles[oraculoAddr].stake;

  const t0 = 2_000_000;
  const task = buildAiTaskTx(usuario, { prompt: 'expira sem fork', oracle: oraculoAddr, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, 0, t0);
  const tExpira = t0 + CHAIN.AI_TASK_TIMEOUT_MS + 1;
  state.applyTransaction(buildAiRefundTx(usuario, { taskId: task.id, nonce: 2, timestamp: tExpira }), 0, tExpira);

  const orc = state.oracles[oraculoAddr];
  assert.equal(orc.stake, stakeAntes); // sem slash abaixo do fork
  assert.equal(orc.slashed, 0n);
  assert.equal(orc.reputation, 50); // reputação intocada
});
