// Testes de permissões de conta / multi-sig (feature #5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

// Monta uma conta multisig M (threshold 2 de 3 chaves) já com permissão setada.
function multisig() {
  const M = generateKeyPair(), K1 = generateKeyPair(), K2 = generateKeyPair(), K3 = generateKeyPair();
  const Maddr = walletAddress(M);
  const keys = { [walletAddress(K1)]: 1, [walletAddress(K2)]: 1, [walletAddress(K3)]: 1 };
  const s = new State();
  s.credit(Maddr, 1000n * U);
  s.applyTransaction(
    buildTransaction(M, { type: 'PERMISSION_UPDATE', nonce: 1, data: { permission: { threshold: 2, keys } } }),
    5, now(),
  );
  return { s, M, Maddr, K1, K2, K3 };
}

test('#5: transferência multisig requer threshold de aprovações', () => {
  const saved = CHAIN.PERMISSIONS_HEIGHT; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const { s, Maddr, K1, K2 } = multisig();
    const dest = walletAddress(generateKeyPair());
    // K1 propõe transferir 100 de M para dest — peso 1 < threshold 2 → fica pendente
    const prop = buildTransaction(K1, { type: 'MULTISIG_PROPOSE', nonce: 1, data: { account: Maddr, op: { type: 'TRANSFER', to: dest, amount: (100n * U).toString() } } });
    s.applyTransaction(prop, 5, now());
    assert.equal(s.balanceOf(dest), 0n, 'uma aprovação não libera');
    assert.ok(s.pendingOps[prop.id]);
    // K2 aprova → peso 2 >= threshold → executa
    s.applyTransaction(buildTransaction(K2, { type: 'MULTISIG_APPROVE', nonce: 1, data: { opId: prop.id } }), 5, now());
    assert.equal(s.balanceOf(dest), 100n * U);
    assert.equal(s.balanceOf(Maddr), 900n * U);
    assert.equal(s.pendingOps[prop.id], undefined);
  } finally { CHAIN.PERMISSIONS_HEIGHT = saved; }
});

test('#5: conta multisig NÃO move fundos por assinatura única', () => {
  const saved = CHAIN.PERMISSIONS_HEIGHT; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const { s, M, Maddr } = multisig();
    const dest = walletAddress(generateKeyPair());
    const direct = buildTransaction(M, { type: 'TRANSFER', to: dest, amount: (100n * U).toString(), nonce: 2 });
    assert.throws(() => s.applyTransaction(direct, 5, now()), /multisig/);
    assert.equal(s.balanceOf(Maddr), 1000n * U);
  } finally { CHAIN.PERMISSIONS_HEIGHT = saved; }
});

test('#5: não-chave não pode propor; chave não aprova duas vezes', () => {
  const saved = CHAIN.PERMISSIONS_HEIGHT; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const { s, Maddr, K1 } = multisig();
    const intruso = generateKeyPair();
    const dest = walletAddress(generateKeyPair());
    const badProp = buildTransaction(intruso, { type: 'MULTISIG_PROPOSE', nonce: 1, data: { account: Maddr, op: { type: 'TRANSFER', to: dest, amount: (1n * U).toString() } } });
    assert.throws(() => s.applyTransaction(badProp, 5, now()), /não é uma chave autorizada/);
    // K1 propõe e depois tenta aprovar a própria proposta → já aprovou
    const prop = buildTransaction(K1, { type: 'MULTISIG_PROPOSE', nonce: 1, data: { account: Maddr, op: { type: 'TRANSFER', to: dest, amount: (1n * U).toString() } } });
    s.applyTransaction(prop, 5, now());
    const selfAppr = buildTransaction(K1, { type: 'MULTISIG_APPROVE', nonce: 2, data: { opId: prop.id } });
    assert.throws(() => s.applyTransaction(selfAppr, 5, now()), /já aprovou/);
  } finally { CHAIN.PERMISSIONS_HEIGHT = saved; }
});

test('#5: PERMISSION_CHANGE via multisig pode remover o multisig (volta a single-sig)', () => {
  const saved = CHAIN.PERMISSIONS_HEIGHT; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const { s, M, Maddr, K1, K2 } = multisig();
    // K1 propõe remover a permissão; K2 aprova → M volta a ser single-sig
    const prop = buildTransaction(K1, { type: 'MULTISIG_PROPOSE', nonce: 1, data: { account: Maddr, op: { type: 'PERMISSION_CHANGE', permission: null } } });
    s.applyTransaction(prop, 5, now());
    s.applyTransaction(buildTransaction(K2, { type: 'MULTISIG_APPROVE', nonce: 1, data: { opId: prop.id } }), 5, now());
    assert.equal(s.permissions[Maddr], undefined, 'permissão removida');
    // agora M transfere direto (single-sig) de novo
    const dest = walletAddress(generateKeyPair());
    s.applyTransaction(buildTransaction(M, { type: 'TRANSFER', to: dest, amount: (50n * U).toString(), nonce: 2 }), 5, now());
    assert.equal(s.balanceOf(dest), 50n * U);
  } finally { CHAIN.PERMISSIONS_HEIGHT = saved; }
});

test('#5: permissão com soma de pesos < threshold é rejeitada (anti-travamento)', () => {
  const saved = CHAIN.PERMISSIONS_HEIGHT; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const M = generateKeyPair(); const s = new State(); s.credit(walletAddress(M), 10n * U);
    const keys = { [walletAddress(generateKeyPair())]: 1 };
    const tx = buildTransaction(M, { type: 'PERMISSION_UPDATE', nonce: 1, data: { permission: { threshold: 5, keys } } });
    assert.throws(() => s.applyTransaction(tx, 5, now()), /soma dos pesos < threshold/);
  } finally { CHAIN.PERMISSIONS_HEIGHT = saved; }
});
