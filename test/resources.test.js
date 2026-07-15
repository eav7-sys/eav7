// Testes do modelo de recursos (feature #6): bandwidth + delegação.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

test('#6: delegação move capacidade de recurso sem tocar o poder de voto', () => {
  const saved = CHAIN.RESOURCE_HEIGHT; CHAIN.RESOURCE_HEIGHT = 1;
  try {
    const A = generateKeyPair(); const Aaddr = walletAddress(A);
    const B = walletAddress(generateKeyPair());
    const s = new State();
    s.getAccount(Aaddr).staked = 1000n * U;
    s.credit(Aaddr, 10n * U);
    const bMaxBefore = s.maxEnergy(s.getAccount(B));
    s.applyTransaction(buildTransaction(A, { type: 'DELEGATE_RESOURCE', nonce: 1, data: { to: B, amount: (500n * U).toString() } }), 5, now());
    assert.equal(s.getAccount(Aaddr).delegatedOut, 500n * U);
    assert.equal(s.getAccount(B).delegatedIn, 500n * U);
    // recurso: A perde, B ganha; VOTO de A (acc.staked) intacto
    assert.equal(s.resourceStake(s.getAccount(Aaddr)), 500n * U);
    assert.equal(s.resourceStake(s.getAccount(B)), 500n * U);
    assert.equal(s.getAccount(Aaddr).staked, 1000n * U, 'stake (poder de voto) não muda com delegação');
    assert.ok(s.maxEnergy(s.getAccount(B)) > bMaxBefore, 'B ganhou capacidade de energia');
  } finally { CHAIN.RESOURCE_HEIGHT = saved; }
});

test('#6: delegar acima do stake e para si mesmo é rejeitado; UNDELEGATE reverte', () => {
  const saved = CHAIN.RESOURCE_HEIGHT; CHAIN.RESOURCE_HEIGHT = 1;
  try {
    const A = generateKeyPair(); const Aaddr = walletAddress(A);
    const B = walletAddress(generateKeyPair());
    const s = new State();
    s.getAccount(Aaddr).staked = 1000n * U; s.credit(Aaddr, 10n * U);
    assert.throws(() => s.applyTransaction(buildTransaction(A, { type: 'DELEGATE_RESOURCE', nonce: 1, data: { to: B, amount: (1500n * U).toString() } }), 5, now()), /excede o stake/);
    assert.throws(() => s.applyTransaction(buildTransaction(A, { type: 'DELEGATE_RESOURCE', nonce: 1, data: { to: Aaddr, amount: (100n * U).toString() } }), 5, now()), /si mesmo/);
    // delega 500, depois retira 300
    s.applyTransaction(buildTransaction(A, { type: 'DELEGATE_RESOURCE', nonce: 1, data: { to: B, amount: (500n * U).toString() } }), 5, now());
    s.applyTransaction(buildTransaction(A, { type: 'UNDELEGATE_RESOURCE', nonce: 2, data: { to: B, amount: (300n * U).toString() } }), 6, now());
    assert.equal(s.getAccount(Aaddr).delegatedOut, 200n * U);
    assert.equal(s.getAccount(B).delegatedIn, 200n * U);
  } finally { CHAIN.RESOURCE_HEIGHT = saved; }
});

test('#6: UNSTAKE abaixo do recurso delegado é rejeitado', () => {
  const saved = CHAIN.RESOURCE_HEIGHT; CHAIN.RESOURCE_HEIGHT = 1;
  try {
    const A = generateKeyPair(); const Aaddr = walletAddress(A);
    const B = walletAddress(generateKeyPair());
    const s = new State();
    s.getAccount(Aaddr).staked = 1000n * U; s.credit(Aaddr, 10n * U);
    s.applyTransaction(buildTransaction(A, { type: 'DELEGATE_RESOURCE', nonce: 1, data: { to: B, amount: (500n * U).toString() } }), 5, now());
    // dessteikar 600 deixaria staked 400 < delegado 500 → rejeita
    assert.throws(() => s.applyTransaction(buildTransaction(A, { type: 'UNSTAKE', amount: 600n * U, nonce: 2 }), 6, now()), /recurso delegado sem lastro/);
  } finally { CHAIN.RESOURCE_HEIGHT = saved; }
});

test('#6: bandwidth em falta queima e7 proporcional ao tamanho da tx', () => {
  const savedH = CHAIN.RESOURCE_HEIGHT; const savedFree = CHAIN.BANDWIDTH.FREE;
  CHAIN.RESOURCE_HEIGHT = 1; CHAIN.BANDWIDTH.FREE = 100; // banda pequena: parte usada, resto queima
  try {
    const sender = generateKeyPair(); const s = new State();
    s.credit(walletAddress(sender), 10n * U);
    const dest = walletAddress(generateKeyPair());
    const burnedBefore = s.totalBurned;
    // limite de fee alto o bastante para cobrir a queima de banda
    s.applyTransaction(buildTransaction(sender, { type: 'TRANSFER', to: dest, amount: (1n * U).toString(), nonce: 1, fee: (1n * U).toString() }), 5, now());
    assert.ok(s.totalBurned > burnedBefore, 'banda em falta deve queimar e7');
    assert.ok(s.getAccount(walletAddress(sender)).bandwidthUsed > 0, 'banda usada registrada');
  } finally { CHAIN.RESOURCE_HEIGHT = savedH; CHAIN.BANDWIDTH.FREE = savedFree; }
});

test('#6: abaixo de RESOURCE_HEIGHT não há consumo de bandwidth (retrocompatível)', () => {
  const sender = generateKeyPair(); const s = new State();
  s.credit(walletAddress(sender), 10n * U);
  const dest = walletAddress(generateKeyPair());
  s.applyTransaction(buildTransaction(sender, { type: 'TRANSFER', to: dest, amount: (1n * U).toString(), nonce: 1 }), 5, now());
  assert.equal(s.getAccount(walletAddress(sender)).bandwidthUsed, 0, 'sem bandwidth antes do fork');
});
