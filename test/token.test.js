import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { buildTransaction } from '../src/core/transaction.js';

test('EAV20: ciclo completo create / transfer / approve / transferFrom', () => {
  const criador = generateKeyPair();
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const criadorAddr = walletAddress(criador);
  const aliceAddr = walletAddress(alice);
  const bobAddr = walletAddress(bob);

  const state = new State();
  state.getAccount(criadorAddr).balance = 1_000n * CHAIN.UNIT;
  state.getAccount(aliceAddr).balance = 10n * CHAIN.UNIT;

  // create
  state.applyTransaction(buildTransaction(criador, {
    type: 'TOKEN_CREATE',
    nonce: 1,
    data: { name: 'Token de Teste', symbol: 'TST', decimals: 2, totalSupply: '1000000' },
  }));
  const tokenId = Object.keys(state.tokens)[0];
  const token = state.tokens[tokenId];
  assert.ok(tokenId.startsWith('E7'));
  assert.equal(tokenId.length, CHAIN.HASH_LENGTH);
  assert.equal(token.standard, 'eav20');
  assert.equal(token.balances[criadorAddr], 1_000_000n);

  // transfer
  state.applyTransaction(buildTransaction(criador, {
    type: 'TOKEN_TRANSFER', to: aliceAddr, amount: 500n, nonce: 2, data: { token: tokenId },
  }));
  assert.equal(token.balances[aliceAddr], 500n);

  // approve + transferFrom
  state.applyTransaction(buildTransaction(criador, {
    type: 'TOKEN_APPROVE', to: aliceAddr, amount: 100n, nonce: 3, data: { token: tokenId },
  }));
  state.applyTransaction(buildTransaction(alice, {
    type: 'TOKEN_TRANSFER_FROM', to: bobAddr, amount: 60n, nonce: 1,
    data: { token: tokenId, owner: criadorAddr },
  }));
  assert.equal(token.balances[bobAddr], 60n);
  assert.equal(token.allowances[criadorAddr][aliceAddr], 40n);

  // estourar a allowance falha
  assert.throws(() => state.applyTransaction(buildTransaction(alice, {
    type: 'TOKEN_TRANSFER_FROM', to: bobAddr, amount: 41n, nonce: 2,
    data: { token: tokenId, owner: criadorAddr },
  })), /allowance/);

  // parâmetros inválidos falham
  assert.throws(() => state.applyTransaction(buildTransaction(criador, {
    type: 'TOKEN_CREATE', nonce: 4,
    data: { name: 'X', symbol: 'x!', decimals: 2, totalSupply: '10' },
  })), /símbolo/);
});
