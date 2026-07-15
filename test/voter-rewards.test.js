// Testes de recompensa de eleitores (comissão + partilha).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

function setup() {
  const P = generateKeyPair(); const pAddr = walletAddress(P);
  const V = generateKeyPair(); const vAddr = walletAddress(V);
  const s = new State();
  s.getAccount(pAddr).staked = 2n * CHAIN.MIN_VALIDATOR_STAKE;
  s.getAccount(vAddr).staked = 1000n * U; s.credit(vAddr, 1n * U);
  return { s, P, pAddr, V, vAddr };
}

test('recompensa de eleitores: produtor leva a comissão, eleitor resgata o resto', () => {
  const saved = CHAIN.VOTING_HEIGHT; CHAIN.VOTING_HEIGHT = 1;
  try {
    const { s, pAddr, V, vAddr } = setup();
    // V vota 1000 em P
    s.applyTransaction(buildTransaction(V, { type: 'VOTE', nonce: 1, data: { votes: { [pAddr]: (1000n * U).toString() } } }), 5, now());
    // P produz um bloco com recompensa 100 (comissão padrão 20%)
    s.distributeBlockReward(pAddr, 100n * U);
    assert.equal(s.balanceOf(pAddr), 20n * U, 'produtor recebe a comissão (20%)');
    // V resgata a partilha (80%)
    s.applyTransaction(buildTransaction(V, { type: 'CLAIM_VOTER_REWARD', nonce: 2, data: { validator: pAddr } }), 6, now());
    assert.equal(s.balanceOf(vAddr), 1n * U + 80n * U, 'eleitor recebe a partilha (80%)');
    // resgatar de novo sem nova recompensa → nada
    const before = s.balanceOf(vAddr);
    s.applyTransaction(buildTransaction(V, { type: 'CLAIM_VOTER_REWARD', nonce: 3, data: { validator: pAddr } }), 7, now());
    assert.equal(s.balanceOf(vAddr), before);
  } finally { CHAIN.VOTING_HEIGHT = saved; }
});

test('recompensa de eleitores: SET_COMMISSION muda a divisão', () => {
  const saved = CHAIN.VOTING_HEIGHT; CHAIN.VOTING_HEIGHT = 1;
  try {
    const { s, P, pAddr, V, vAddr } = setup();
    s.credit(pAddr, 1n * U);
    s.applyTransaction(buildTransaction(P, { type: 'SET_COMMISSION', nonce: 1, data: { percent: 50 } }), 5, now());
    s.applyTransaction(buildTransaction(V, { type: 'VOTE', nonce: 1, data: { votes: { [pAddr]: (1000n * U).toString() } } }), 5, now());
    s.distributeBlockReward(pAddr, 100n * U);
    assert.equal(s.balanceOf(pAddr), 1n * U + 50n * U, 'comissão 50%');
    s.applyTransaction(buildTransaction(V, { type: 'CLAIM_VOTER_REWARD', nonce: 2, data: { validator: pAddr } }), 6, now());
    assert.equal(s.balanceOf(vAddr), 1n * U + 50n * U, 'eleitor 50%');
  } finally { CHAIN.VOTING_HEIGHT = saved; }
});

test('recompensa de eleitores: re-VOTE liquida o pendente antes de mudar', () => {
  const saved = CHAIN.VOTING_HEIGHT; CHAIN.VOTING_HEIGHT = 1;
  try {
    const { s, pAddr, V, vAddr } = setup();
    const P2 = walletAddress(generateKeyPair()); s.getAccount(P2).staked = 2n * CHAIN.MIN_VALIDATOR_STAKE;
    s.applyTransaction(buildTransaction(V, { type: 'VOTE', nonce: 1, data: { votes: { [pAddr]: (1000n * U).toString() } } }), 5, now());
    s.distributeBlockReward(pAddr, 100n * U); // acumula 80 para V
    // V re-vota para P2 → deve LIQUIDAR os 80 pendentes de P antes de trocar
    s.applyTransaction(buildTransaction(V, { type: 'VOTE', nonce: 2, data: { votes: { [P2]: (1000n * U).toString() } } }), 6, now());
    assert.equal(s.balanceOf(vAddr), 1n * U + 80n * U, 're-VOTE creditou o pendente');
  } finally { CHAIN.VOTING_HEIGHT = saved; }
});
