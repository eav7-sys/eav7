// Testes das funções administrativas do EAV20: mint/burn/pause/blacklist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

function withToken(mintable) {
  const owner = generateKeyPair(); const oAddr = walletAddress(owner);
  const s = new State(); s.credit(oAddr, 100n * U);
  const create = buildTransaction(owner, { type: 'TOKEN_CREATE', nonce: 1, data: { name: 'Test', symbol: 'TST', decimals: 6, totalSupply: '1000', mintable } });
  s.applyTransaction(create, 5, now());
  const id = Object.keys(s.tokens)[0];
  return { s, owner, oAddr, id, nonce: 2 };
}

test('EAV20: mint (só owner, só se mintable) e burn do próprio saldo', () => {
  const saved = CHAIN.TOKEN_ADMIN_HEIGHT; CHAIN.TOKEN_ADMIN_HEIGHT = 1;
  try {
    const { s, owner, oAddr, id } = withToken(true);
    const x = walletAddress(generateKeyPair());
    // owner mint 500 para x
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_MINT', to: x, amount: 500n, nonce: 2, data: { token: id } }), 5, now());
    assert.equal(s.tokens[id].totalSupply, 1500n);
    assert.equal(s.tokens[id].balances[x], 500n);
    // não-owner não faz mint
    const intruso = generateKeyPair(); s.credit(walletAddress(intruso), 1n * U);
    assert.throws(() => s.applyTransaction(buildTransaction(intruso, { type: 'TOKEN_MINT', to: x, amount: 1n, nonce: 1, data: { token: id } }), 5, now()), /só o owner/);
    // burn 100 do saldo do owner
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_BURN', amount: 100n, nonce: 3, data: { token: id } }), 5, now());
    assert.equal(s.tokens[id].balances[oAddr], 900n);
    assert.equal(s.tokens[id].totalSupply, 1400n);
  } finally { CHAIN.TOKEN_ADMIN_HEIGHT = saved; }
});

test('EAV20: token não-mintable rejeita mint', () => {
  const saved = CHAIN.TOKEN_ADMIN_HEIGHT; CHAIN.TOKEN_ADMIN_HEIGHT = 1;
  try {
    const { s, owner, id } = withToken(false);
    const x = walletAddress(generateKeyPair());
    assert.throws(() => s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_MINT', to: x, amount: 1n, nonce: 2, data: { token: id } }), 5, now()), /não é mintable/);
  } finally { CHAIN.TOKEN_ADMIN_HEIGHT = saved; }
});

test('EAV20: pause bloqueia transferências; unpause libera', () => {
  const saved = CHAIN.TOKEN_ADMIN_HEIGHT; CHAIN.TOKEN_ADMIN_HEIGHT = 1;
  try {
    const { s, owner, oAddr, id } = withToken(false);
    const x = walletAddress(generateKeyPair());
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_PAUSE', nonce: 2, data: { token: id } }), 5, now());
    assert.throws(() => s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_TRANSFER', to: x, amount: 10n, nonce: 3, data: { token: id } }), 5, now()), /pausado/);
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_UNPAUSE', nonce: 3, data: { token: id } }), 5, now());
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_TRANSFER', to: x, amount: 10n, nonce: 4, data: { token: id } }), 5, now());
    assert.equal(s.tokens[id].balances[x], 10n);
  } finally { CHAIN.TOKEN_ADMIN_HEIGHT = saved; }
});

test('EAV20: freeze trava parte do saldo até vencer; só o livre transfere', () => {
  const saved = CHAIN.TOKEN_ADMIN_HEIGHT; CHAIN.TOKEN_ADMIN_HEIGHT = 1;
  try {
    const { s, owner, oAddr, id } = withToken(false); // owner tem 1000
    const x = walletAddress(generateKeyPair());
    // congela 600 por 10 blocos (unlockAt = 5 + 10 = 15)
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_FREEZE', amount: 600n, nonce: 2, data: { token: id, durationBlocks: 10 } }), 5, now());
    // livre = 1000 - 600 = 400; transferir 500 falha
    assert.throws(() => s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_TRANSFER', to: x, amount: 500n, nonce: 3, data: { token: id } }), 6, now()), /congelado/);
    // transferir 300 (<= 400) ok
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_TRANSFER', to: x, amount: 300n, nonce: 3, data: { token: id } }), 6, now());
    assert.equal(s.tokens[id].balances[x], 300n);
    // unfreeze antes de vencer falha
    assert.throws(() => s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_UNFREEZE', nonce: 4, data: { token: id } }), 10, now()), /ainda não venceu/);
    // após vencer (altura 15), o congelado libera: transferir 600 do restante ok
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_TRANSFER', to: x, amount: 600n, nonce: 4, data: { token: id } }), 15, now());
    assert.equal(s.tokens[id].balances[x], 900n);
  } finally { CHAIN.TOKEN_ADMIN_HEIGHT = saved; }
});

test('EAV20: blacklist bloqueia envio/recebimento; remover libera', () => {
  const saved = CHAIN.TOKEN_ADMIN_HEIGHT; CHAIN.TOKEN_ADMIN_HEIGHT = 1;
  try {
    const { s, owner, id } = withToken(false);
    const x = walletAddress(generateKeyPair());
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_BLACKLIST', nonce: 2, data: { token: id, address: x, blocked: true } }), 5, now());
    assert.throws(() => s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_TRANSFER', to: x, amount: 10n, nonce: 3, data: { token: id } }), 5, now()), /bloqueado/);
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_BLACKLIST', nonce: 3, data: { token: id, address: x, blocked: false } }), 5, now());
    s.applyTransaction(buildTransaction(owner, { type: 'TOKEN_TRANSFER', to: x, amount: 10n, nonce: 4, data: { token: id } }), 5, now());
    assert.equal(s.tokens[id].balances[x], 10n);
  } finally { CHAIN.TOKEN_ADMIN_HEIGHT = saved; }
});
