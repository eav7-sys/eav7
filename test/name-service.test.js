// Testes do serviço de nomes EAV-NS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

test('EAV-NS: registra, resolve, atualiza alvo, transfere dono e libera', () => {
  const saved = CHAIN.NAME_HEIGHT; CHAIN.NAME_HEIGHT = 1;
  try {
    const owner = generateKeyPair(); const oAddr = walletAddress(owner);
    const s = new State(); s.credit(oAddr, 100n * U);
    const target1 = walletAddress(generateKeyPair());
    s.applyTransaction(buildTransaction(owner, { type: 'NAME_REGISTER', nonce: 1, data: { name: 'satoshi', target: target1 } }), 5, now());
    assert.equal(s.names.satoshi.target, target1);
    assert.equal(s.names.satoshi.owner, oAddr);

    // nome duplicado é rejeitado
    const outro = generateKeyPair(); s.credit(walletAddress(outro), 100n * U);
    assert.throws(() => s.applyTransaction(buildTransaction(outro, { type: 'NAME_REGISTER', nonce: 1, data: { name: 'satoshi', target: walletAddress(outro) } }), 5, now()), /já registrado/);
    // formato inválido
    assert.throws(() => s.applyTransaction(buildTransaction(owner, { type: 'NAME_REGISTER', nonce: 2, data: { name: '-bad-' } }), 5, now()), /nome inválido/);

    // dono atualiza o alvo
    const target2 = walletAddress(generateKeyPair());
    s.applyTransaction(buildTransaction(owner, { type: 'NAME_UPDATE', nonce: 2, data: { name: 'satoshi', target: target2 } }), 5, now());
    assert.equal(s.names.satoshi.target, target2);

    // transfere a posse do nome
    const novoDono = walletAddress(generateKeyPair());
    s.applyTransaction(buildTransaction(owner, { type: 'NAME_TRANSFER', to: novoDono, nonce: 3, data: { name: 'satoshi' } }), 5, now());
    assert.equal(s.names.satoshi.owner, novoDono);
    // o dono ANTIGO não atualiza mais
    assert.throws(() => s.applyTransaction(buildTransaction(owner, { type: 'NAME_UPDATE', nonce: 4, data: { name: 'satoshi', target: oAddr } }), 5, now()), /só o dono/);
  } finally { CHAIN.NAME_HEIGHT = saved; }
});

test('EAV-NS: o registro queima o custo (anti-squatting)', () => {
  const saved = CHAIN.NAME_HEIGHT; CHAIN.NAME_HEIGHT = 1;
  try {
    const owner = generateKeyPair(); const oAddr = walletAddress(owner);
    const s = new State(); s.credit(oAddr, 100n * U);
    const burnedBefore = s.totalBurned;
    s.applyTransaction(buildTransaction(owner, { type: 'NAME_REGISTER', nonce: 1, data: { name: 'alice' } }), 5, now());
    assert.equal(s.totalBurned - burnedBefore, CHAIN.NAME_REGISTER_COST);
    assert.equal(s.balanceOf(oAddr), 100n * U - CHAIN.NAME_REGISTER_COST);
    assert.equal(s.names.alice.target, oAddr, 'alvo padrão = o próprio registrante');
  } finally { CHAIN.NAME_HEIGHT = saved; }
});
