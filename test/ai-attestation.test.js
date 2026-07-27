// Fase 6 — resultados de IA VERIFICÁVEIS por atestação (TEE / zkML).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';
import { buildAiTaskTx, buildAiResultTx, buildOracleRegisterTx, aiResultHash } from '../src/ai/bridge.js';
import { aiAttestDigest } from '../src/bridge/proof.js';
import { N, bufToBig, sign, publicKeyFromPrivate, ethAddressFromPoint } from '../src/eavm/secp256k1.js';

// Ativa a Fase 6 na mesma altura da janela de desafio (p/ mostrar que a atestação PULA a
// janela). Nessa altura o modelo de recursos está ativo → contas precisam de `staked`.
const H = CHAIN.AI_CHALLENGE_HEIGHT;

function withTee(fn) {
  const saved = CHAIN.AI_TEE_HEIGHT; CHAIN.AI_TEE_HEIGHT = H;
  try { return fn(); } finally { CHAIN.AI_TEE_HEIGHT = saved; }
}
function acct(state, kp) {
  const a = walletAddress(kp);
  Object.assign(state.getAccount(a), { balance: 5_000n * CHAIN.UNIT, staked: 1_000n * CHAIN.UNIT });
  return a;
}
// Membro atestador = par de chaves secp256k1 (a chave de atestação do enclave).
function attesterMember() {
  const priv = (bufToBig(randomBytes(32)) % (N - 1n)) + 1n;
  const addr = ethAddressFromPoint(publicKeyFromPrivate(priv)).toLowerCase();
  return { priv, addr };
}
function signDigest(member, digest) {
  const { r, s, recId } = sign(digest, member.priv);
  return { r: r.toString(), s: s.toString(), recId: Number(recId) };
}
// Monta oráculo + tarefa designada, pronta p/ AI_RESULT.
function setupTask(state) {
  const user = generateKeyPair(); const oracle = generateKeyPair();
  const oa = acct(state, oracle); acct(state, user);
  state.applyTransaction(buildOracleRegisterTx(oracle, { stake: CHAIN.MIN_ORACLE_STAKE, nonce: 1 }), H, 1000);
  const task = buildAiTaskTx(user, { prompt: 'x', oracle: oa, reward: 5n * CHAIN.UNIT, nonce: 1 });
  state.applyTransaction(task, H, 10_000_000);
  return { user, oracle, oa, taskId: task.id };
}

test('Fase 6: resultado atestado (quórum TEE) é VERIFICADO e liquida NA HORA', () => withTee(() => {
  const state = new State();
  const members = [attesterMember(), attesterMember(), attesterMember()]; // 3, quórum 2
  state.aiAttesters['sgx-eav7-oracle-v1'] = {
    kind: 'TEE', members: members.map((m) => m.addr), quorum: 2, measurement: 'mrenclave:abcdef', registeredAt: 1,
  };
  const { oracle, oa, taskId } = setupTask(state);

  const output = 'resposta computada dentro do enclave';
  const resultHash = aiResultHash(output);
  const digest = aiAttestDigest({ taskId, resultHash, attesterId: 'sgx-eav7-oracle-v1', measurement: 'mrenclave:abcdef' });
  const attestation = { attesterId: 'sgx-eav7-oracle-v1', sigs: [signDigest(members[0], digest), signDigest(members[1], digest)] };

  const balO = state.balanceOf(oa);
  state.applyTransaction(buildAiResultTx(oracle, { taskId, output, attestation, nonce: 2 }), H, 10_000_100);

  const tk = state.aiTasks[taskId];
  assert.equal(tk.verified, 'TEE', 'marcado como verificado por TEE');
  assert.equal(tk.status, 'DONE', 'liquida na hora — sem janela de desafio');
  assert.equal(state.balanceOf(oa), balO + 5n * CHAIN.UNIT, 'oráculo pago imediatamente');
}));

test('Fase 6: atestação abaixo do quórum é REJEITADA (falha fechada)', () => withTee(() => {
  const state = new State();
  const members = [attesterMember(), attesterMember(), attesterMember()];
  state.aiAttesters['a1'] = { kind: 'TEE', members: members.map((m) => m.addr), quorum: 2, measurement: 'm', registeredAt: 1 };
  const { oracle, taskId } = setupTask(state);
  const output = 'x'; const resultHash = aiResultHash(output);
  const digest = aiAttestDigest({ taskId, resultHash, attesterId: 'a1', measurement: 'm' });
  const attestation = { attesterId: 'a1', sigs: [signDigest(members[0], digest)] }; // só 1 < quórum 2
  assert.throws(
    () => state.clone().applyTransaction(buildAiResultTx(oracle, { taskId, output, attestation, nonce: 2 }), H, 10_000_100),
    /atestação insuficiente/,
  );
}));

test('Fase 6: assinatura de NÃO-membro não conta (forjar exige a chave do enclave)', () => withTee(() => {
  const state = new State();
  const members = [attesterMember(), attesterMember()];
  const impostor = attesterMember();
  state.aiAttesters['a1'] = { kind: 'TEE', members: members.map((m) => m.addr), quorum: 2, measurement: 'm', registeredAt: 1 };
  const { oracle, taskId } = setupTask(state);
  const output = 'x'; const resultHash = aiResultHash(output);
  const digest = aiAttestDigest({ taskId, resultHash, attesterId: 'a1', measurement: 'm' });
  // 1 membro válido + 1 impostor → só 1 válido < quórum 2
  const attestation = { attesterId: 'a1', sigs: [signDigest(members[0], digest), signDigest(impostor, digest)] };
  assert.throws(
    () => state.clone().applyTransaction(buildAiResultTx(oracle, { taskId, output, attestation, nonce: 2 }), H, 10_000_100),
    /atestação insuficiente/,
  );
}));

test('Fase 6: atestador não registrado é REJEITADO', () => withTee(() => {
  const state = new State();
  const { oracle, taskId } = setupTask(state);
  const output = 'x';
  const attestation = { attesterId: 'inexistente', sigs: [] };
  assert.throws(
    () => state.clone().applyTransaction(buildAiResultTx(oracle, { taskId, output, attestation, nonce: 2 }), H, 10_000_100),
    /atestador de IA não registrado/,
  );
}));

test('Fase 6: digest amarra a MEDIDA do enclave — assinatura sobre outra measurement falha', () => withTee(() => {
  const state = new State();
  const members = [attesterMember(), attesterMember()];
  state.aiAttesters['a1'] = { kind: 'TEE', members: members.map((m) => m.addr), quorum: 2, measurement: 'CERTA', registeredAt: 1 };
  const { oracle, taskId } = setupTask(state);
  const output = 'x'; const resultHash = aiResultHash(output);
  // assina sobre a measurement ERRADA → o digest não bate com o registrado → não conta
  const digestErrado = aiAttestDigest({ taskId, resultHash, attesterId: 'a1', measurement: 'ERRADA' });
  const attestation = { attesterId: 'a1', sigs: members.map((m) => signDigest(m, digestErrado)) };
  assert.throws(
    () => state.clone().applyTransaction(buildAiResultTx(oracle, { taskId, output, attestation, nonce: 2 }), H, 10_000_100),
    /atestação insuficiente/,
  );
}));

test('grandfather: abaixo de AI_TEE_HEIGHT a atestação é IGNORADA (janela de desafio normal)', () => {
  // AI_TEE_HEIGHT no padrão (distante); height = AI_CHALLENGE_HEIGHT → sem Fase 6.
  const state = new State();
  const members = [attesterMember(), attesterMember()];
  state.aiAttesters['a1'] = { kind: 'TEE', members: members.map((m) => m.addr), quorum: 2, measurement: 'm', registeredAt: 1 };
  const { oracle, taskId } = setupTask(state);
  const output = 'x'; const resultHash = aiResultHash(output);
  const digest = aiAttestDigest({ taskId, resultHash, attesterId: 'a1', measurement: 'm' });
  const attestation = { attesterId: 'a1', sigs: members.map((m) => signDigest(m, digest)) };
  state.applyTransaction(buildAiResultTx(oracle, { taskId, output, attestation, nonce: 2 }), H, 10_000_100);
  const tk = state.aiTasks[taskId];
  assert.equal(tk.verified, undefined, 'sem campo verified abaixo do fork → serialização intacta');
  assert.equal(tk.status, 'CHALLENGE_PERIOD', 'segue a janela de desafio (Fase 3)');
});

test('Fase 6: registro de atestador por GOVERNANÇA (GOV_PROPOSE AI_ATTESTER)', () => withTee(() => {
  const state = new State();
  // validador único → quórum de governança 1; aplica após timelock.
  const val = generateKeyPair(); const va = walletAddress(val);
  Object.assign(state.getAccount(va), { balance: 5_000n * CHAIN.UNIT, staked: 20_000n * CHAIN.UNIT });
  const members = [attesterMember(), attesterMember()];
  const value = { attesterId: 'gov-tee', kind: 'TEE', members: members.map((m) => m.addr), quorum: 2, measurement: 'mrX' };
  const prop = buildTransaction(val, { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'AI_ATTESTER', value } });
  state.applyTransaction(prop, H, 10_000_000);
  assert.equal(state.aiAttesters['gov-tee'], undefined, 'ainda não aplicado (timelock)');
  state.blockTick(H + CHAIN.GOV_TIMELOCK_BLOCKS);
  const at = state.aiAttesters['gov-tee'];
  assert.ok(at, 'registrado após o timelock');
  assert.equal(at.kind, 'TEE');
  assert.equal(at.quorum, 2);
  assert.equal(at.measurement, 'mrX');
}));
