// Testes das ops multisig mais ricas (STAKE, TOKEN_TRANSFER, NFT_TRANSFER).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

function multisig() {
  const M = generateKeyPair(); const Maddr = walletAddress(M);
  const K = [generateKeyPair(), generateKeyPair(), generateKeyPair()];
  const keys = Object.fromEntries(K.map((k) => [walletAddress(k), 1]));
  const s = new State();
  s.credit(Maddr, 1000n * U);
  s.applyTransaction(buildTransaction(M, { type: 'PERMISSION_UPDATE', nonce: 1, data: { permission: { threshold: 2, keys } } }), 5, now());
  return { s, Maddr, K };
}
function exec(s, K, account, op, nonceBase) {
  const prop = buildTransaction(K[0], { type: 'MULTISIG_PROPOSE', nonce: nonceBase, data: { account, op } });
  s.applyTransaction(prop, 5, now());
  s.applyTransaction(buildTransaction(K[1], { type: 'MULTISIG_APPROVE', nonce: nonceBase, data: { opId: prop.id } }), 5, now());
}

test('multisig rico: STAKE via op (conta de custódia pode estacar)', () => {
  const saved = CHAIN.PERMISSIONS_HEIGHT; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const { s, Maddr, K } = multisig();
    exec(s, K, Maddr, { type: 'STAKE', amount: (500n * U).toString() }, 1);
    assert.equal(s.getAccount(Maddr).staked, 500n * U);
    assert.equal(s.balanceOf(Maddr), 500n * U);
  } finally { CHAIN.PERMISSIONS_HEIGHT = saved; }
});

test('multisig rico: TOKEN_TRANSFER via op (custódia de token)', () => {
  const saved = CHAIN.PERMISSIONS_HEIGHT; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const { s, Maddr, K } = multisig();
    s.tokens.TK = { standard: 'eav20', id: 'TK', name: 'T', symbol: 'TK', decimals: 0, totalSupply: 1000n, owner: Maddr, mintable: false, paused: false, blacklist: {}, balances: { [Maddr]: 1000n }, allowances: {} };
    const dest = walletAddress(generateKeyPair());
    exec(s, K, Maddr, { type: 'TOKEN_TRANSFER', token: 'TK', to: dest, amount: '300' }, 1);
    assert.equal(s.tokens.TK.balances[dest], 300n);
    assert.equal(s.tokens.TK.balances[Maddr], 700n);
  } finally { CHAIN.PERMISSIONS_HEIGHT = saved; }
});

test('multisig rico: NFT_TRANSFER via op (custódia de NFT)', () => {
  const saved = CHAIN.PERMISSIONS_HEIGHT; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const { s, Maddr, K } = multisig();
    s.nfts.COL = { standard: 'eav721', id: 'COL', name: 'C', symbol: 'C', owner: Maddr, nextId: 2, tokens: { 1: { owner: Maddr, uri: '' } }, approvals: {} };
    const dest = walletAddress(generateKeyPair());
    exec(s, K, Maddr, { type: 'NFT_TRANSFER', collection: 'COL', tokenId: 1, to: dest }, 1);
    assert.equal(s.nfts.COL.tokens['1'].owner, dest);
  } finally { CHAIN.PERMISSIONS_HEIGHT = saved; }
});
