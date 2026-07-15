// Testes de meta-transações (gasless).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

test('meta-tx: relayer paga a taxa; o efeito roda como o usuário (que não gasta EAV7)', () => {
  const saved = CHAIN.META_HEIGHT; CHAIN.META_HEIGHT = 1;
  try {
    const user = generateKeyPair(); const uAddr = walletAddress(user);
    const relayer = generateKeyPair();
    const dest = walletAddress(generateKeyPair());
    const s = new State();
    s.credit(uAddr, 100n * U);          // usuário tem fundos, mas nenhuma "gas"
    s.credit(walletAddress(relayer), 10n * U);
    // usuário assina uma TRANSFER
    const inner = buildTransaction(user, { type: 'TRANSFER', to: dest, amount: 10n * U, nonce: 1 });
    // relayer embrulha e submete
    const meta = buildTransaction(relayer, { type: 'META_TX', nonce: 1, data: { inner } });
    s.applyTransaction(meta, 5, now());
    assert.equal(s.balanceOf(dest), 10n * U, 'transferência aplicada');
    assert.equal(s.balanceOf(uAddr), 90n * U, 'usuário só perdeu o valor transferido (0 de taxa)');
    assert.equal(s.getAccount(uAddr).nonce, 1, 'nonce do usuário avançou (anti-replay)');
    assert.equal(s.getAccount(walletAddress(relayer)).nonce, 1, 'nonce do relayer avançou');
  } finally { CHAIN.META_HEIGHT = saved; }
});

test('meta-tx: inner inválida ou nonce errado é rejeitada; re-submit é anti-replay', () => {
  const saved = CHAIN.META_HEIGHT; CHAIN.META_HEIGHT = 1;
  try {
    const user = generateKeyPair(); const uAddr = walletAddress(user);
    const relayer = generateKeyPair();
    const dest = walletAddress(generateKeyPair());
    const s = new State();
    s.credit(uAddr, 100n * U); s.credit(walletAddress(relayer), 10n * U);
    // nonce errado do usuário
    const badInner = buildTransaction(user, { type: 'TRANSFER', to: dest, amount: 1n * U, nonce: 5 });
    assert.throws(() => s.applyTransaction(buildTransaction(relayer, { type: 'META_TX', nonce: 1, data: { inner: badInner } }), 5, now()), /nonce da inner/);
    // aplica uma vez com nonce certo
    const inner = buildTransaction(user, { type: 'TRANSFER', to: dest, amount: 1n * U, nonce: 1 });
    s.applyTransaction(buildTransaction(relayer, { type: 'META_TX', nonce: 1, data: { inner } }), 5, now());
    // re-submeter a MESMA inner (nonce 1) de novo → rejeitada (nonce do usuário já é 1)
    assert.throws(() => s.applyTransaction(buildTransaction(relayer, { type: 'META_TX', nonce: 2, data: { inner } }), 5, now()), /nonce da inner/);
  } finally { CHAIN.META_HEIGHT = saved; }
});
