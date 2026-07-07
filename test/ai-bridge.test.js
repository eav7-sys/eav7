import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { eavHash } from '../src/crypto/hash.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { buildTransaction } from '../src/core/transaction.js';
import {
  buildAiTaskTx, buildAiResultTx, buildAiRefundTx, buildOracleRegisterTx,
} from '../src/ai/bridge.js';
import { defaultHandler } from '../src/ai/worker.js';

function setup() {
  const usuario = generateKeyPair();
  const oraculo = generateKeyPair();
  const state = new State();
  state.getAccount(walletAddress(usuario)).balance = 10_000n * CHAIN.UNIT;
  state.getAccount(walletAddress(oraculo)).balance = 1_000n * CHAIN.UNIT;
  return { usuario, oraculo, state };
}

test('camada de IA: só o oráculo designado resgata a recompensa escrowada', async () => {
  const { usuario, oraculo, state } = setup();
  const usuarioAddr = walletAddress(usuario);
  const oraculoAddr = walletAddress(oraculo);
  const reward = 5n * CHAIN.UNIT;

  // AI_TASK designa explicitamente o oráculo em quem o solicitante confia
  const taskTx = buildAiTaskTx(usuario, { prompt: 'Resuma o gênese', oracle: oraculoAddr, reward, nonce: 1 });
  const antes = state.balanceOf(usuarioAddr);
  state.applyTransaction(taskTx);
  // com energia grátis suficiente (AI_TASK custa 5 de 10), a taxa é 0 (nada queimado)
  assert.equal(state.balanceOf(usuarioAddr), antes - reward);
  assert.equal(state.aiTasks[taskTx.id].assignedOracle, oraculoAddr);

  // AI_TASK sem oráculo designado é rejeitada
  assert.throws(() => state.clone().applyTransaction(
    buildAiTaskTx(usuario, { prompt: 'x', oracle: undefined, reward, nonce: 2 }),
  ), /oráculo designado/);

  // registra o oráculo designado e um segundo oráculo intruso
  state.applyTransaction(buildOracleRegisterTx(oraculo, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }));
  const intruso = generateKeyPair();
  state.getAccount(walletAddress(intruso)).balance = 1_000n * CHAIN.UNIT;
  state.applyTransaction(buildOracleRegisterTx(intruso, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }));

  // o intruso registrado NÃO consegue resgatar (não é o designado)
  assert.throws(() => state.clone().applyTransaction(
    buildAiResultTx(intruso, { taskId: taskTx.id, output: 'lixo', nonce: 2 }),
  ), /oráculo designado/);

  // o oráculo designado entrega o resultado e recebe a recompensa
  const output = await defaultHandler({ id: taskTx.id, prompt: 'Resuma o gênese', model: null });
  const saldoOraculo = state.balanceOf(oraculoAddr);
  state.applyTransaction(buildAiResultTx(oraculo, { taskId: taskTx.id, output, nonce: 2 }));
  const task = state.aiTasks[taskTx.id];
  assert.equal(task.status, 'DONE');
  assert.equal(task.resultHash, eavHash(output)); // hash E7 do resultado on-chain
  assert.equal(state.balanceOf(oraculoAddr), saldoOraculo + reward);
});

test('camada de IA: solicitante reembolsa o escrow após o prazo', () => {
  const { usuario, oraculo, state } = setup();
  const usuarioAddr = walletAddress(usuario);
  const reward = 3n * CHAIN.UNIT;
  const t0 = 1_000_000_000_000;
  const taskTx = buildAiTaskTx(usuario, {
    prompt: 'nunca respondida', oracle: walletAddress(oraculo), reward, nonce: 1, timestamp: t0,
  });
  state.applyTransaction(taskTx, 0, t0); // blockTs = t0 (expiração ancora no tempo do bloco, H-2)
  const antes = state.balanceOf(usuarioAddr);

  // antes do prazo, o reembolso falha (blockTs ainda dentro do prazo)
  assert.throws(() => state.clone().applyTransaction(
    buildAiRefundTx(usuario, { taskId: taskTx.id, nonce: 2, timestamp: t0 + 1000 }), 0, t0 + 1000,
  ), /ainda não expirou/);

  // após o prazo, o solicitante reaver o escrow (blockTs após expiresAt)
  state.applyTransaction(buildAiRefundTx(usuario, {
    taskId: taskTx.id, nonce: 2, timestamp: t0 + CHAIN.AI_TASK_TIMEOUT_MS + 1,
  }), 0, t0 + CHAIN.AI_TASK_TIMEOUT_MS + 1);
  assert.equal(state.aiTasks[taskTx.id].status, 'REFUNDED');
  assert.equal(state.balanceOf(usuarioAddr), antes + reward);
});

test('ponte: só relayer autorizado libera, idempotência bloqueia replay', () => {
  const { usuario, oraculo, state } = setup();
  const relayerAddr = walletAddress(oraculo);
  const destino = walletAddress(generateKeyPair());
  state.bridgeRelayers[relayerAddr] = true; // autorizado (na rede real: semeado na gênese)

  // saída: trava 10 EAV7 com destino TRON
  const out = buildTransaction(usuario, {
    type: 'BRIDGE_OUT', amount: 10n * CHAIN.UNIT, nonce: 1,
    data: { targetChain: 'TRON', targetAddress: 'TXYZa1b2c3d4e5f6g7h8', token: null },
  });
  state.applyTransaction(out);
  assert.equal(state.bridge.lockedNative, 10n * CHAIN.UNIT);

  // relayer não autorizado é rejeitado
  assert.throws(() => state.clone().applyTransaction(buildTransaction(usuario, {
    type: 'BRIDGE_IN', to: destino, amount: 1n * CHAIN.UNIT, nonce: 2,
    data: { sourceChain: 'TRON', sourceTxHash: 'deadbeef01', token: null },
  })), /relayer/);

  // relayer autorizado libera 4 EAV7 vindos de fora
  const entrada = buildTransaction(oraculo, {
    type: 'BRIDGE_IN', to: destino, amount: 4n * CHAIN.UNIT, nonce: 1,
    data: { sourceChain: 'TRON', sourceTxHash: 'deadbeef01', token: null },
  });
  state.applyTransaction(entrada);
  assert.equal(state.balanceOf(destino), 4n * CHAIN.UNIT);
  assert.equal(state.bridge.lockedNative, 6n * CHAIN.UNIT);

  // replay do MESMO sourceTxHash é bloqueado (idempotência)
  assert.throws(() => state.clone().applyTransaction(buildTransaction(oraculo, {
    type: 'BRIDGE_IN', to: destino, amount: 4n * CHAIN.UNIT, nonce: 2,
    data: { sourceChain: 'TRON', sourceTxHash: 'deadbeef01', token: null },
  })), /já processado/);

  // liberar mais do que está travado falha (hash novo)
  assert.throws(() => state.clone().applyTransaction(buildTransaction(oraculo, {
    type: 'BRIDGE_IN', to: destino, amount: 100n * CHAIN.UNIT, nonce: 2,
    data: { sourceChain: 'TRON', sourceTxHash: 'ffff0000aaaa', token: null },
  })), /travado/);

  assert.equal(walletAddress(usuario) !== relayerAddr, true);
});

test('ponte: quórum M-de-N libera só com atestações de relayers distintos', () => {
  const { usuario, oraculo, state } = setup();
  const r2 = generateKeyPair();
  const relayer1 = walletAddress(oraculo);
  const relayer2 = walletAddress(r2);
  const destino = walletAddress(generateKeyPair());
  state.bridgeRelayers[relayer1] = true;
  state.bridgeRelayers[relayer2] = true;

  // trava fundos na ponte
  state.applyTransaction(buildTransaction(usuario, {
    type: 'BRIDGE_OUT', amount: 10n * CHAIN.UNIT, nonce: 1,
    data: { targetChain: 'ETH', targetAddress: '0xabc0000000', token: null },
  }));

  const original = CHAIN.BRIDGE_MIN_ATTESTATIONS;
  CHAIN.BRIDGE_MIN_ATTESTATIONS = 2; // exige 2 relayers
  try {
    const dep = { sourceChain: 'ETH', sourceTxHash: 'aabbccdd11', token: null };
    // 1ª atestação: registra mas NÃO libera
    const a1 = buildTransaction(oraculo, { type: 'BRIDGE_IN', to: destino, amount: 3n * CHAIN.UNIT, nonce: 1, data: dep });
    state.applyTransaction(a1);
    assert.equal(state.balanceOf(destino), 0n);
    assert.equal(state.bridge.transfers[a1.id].status, 'ATTESTED');

    // mesmo relayer atestando de novo é rejeitado
    assert.throws(() => state.clone().applyTransaction(
      buildTransaction(oraculo, { type: 'BRIDGE_IN', to: destino, amount: 3n * CHAIN.UNIT, nonce: 2, data: dep }),
    ), /já atestou/);

    // 2º relayer distinto atinge o quórum -> libera
    const a2 = buildTransaction(r2, { type: 'BRIDGE_IN', to: destino, amount: 3n * CHAIN.UNIT, nonce: 1, data: dep });
    state.applyTransaction(a2);
    assert.equal(state.balanceOf(destino), 3n * CHAIN.UNIT);
    assert.equal(state.bridge.transfers[a2.id].status, 'RELEASED');

    // replay do mesmo depósito é bloqueado
    assert.throws(() => state.clone().applyTransaction(
      buildTransaction(oraculo, { type: 'BRIDGE_IN', to: destino, amount: 3n * CHAIN.UNIT, nonce: 2, data: dep }),
    ), /já processado/);
  } finally {
    CHAIN.BRIDGE_MIN_ATTESTATIONS = original;
  }
});

test('ponte: BRIDGE_SETTLE marca OUT como PAID (idempotente) e impede double-payout', () => {
  const { usuario, oraculo, state } = setup();
  const relayerAddr = walletAddress(oraculo);
  state.bridgeRelayers[relayerAddr] = true;

  const out = buildTransaction(usuario, {
    type: 'BRIDGE_OUT', amount: 2n * CHAIN.UNIT, nonce: 1,
    data: { targetChain: 'ETH', targetAddress: '0xabc0000000', token: null },
  });
  state.applyTransaction(out);
  assert.equal(state.bridge.transfers[out.id].status, 'LOCKED');

  state.applyTransaction(buildTransaction(oraculo, {
    type: 'BRIDGE_SETTLE', nonce: 1, data: { transferId: out.id, externalTxHash: '0xpaid' },
  }));
  assert.equal(state.bridge.transfers[out.id].status, 'PAID');

  // liquidar duas vezes falha
  assert.throws(() => state.clone().applyTransaction(buildTransaction(oraculo, {
    type: 'BRIDGE_SETTLE', nonce: 2, data: { transferId: out.id },
  })), /já liquidada/);
});
