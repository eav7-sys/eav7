// Testes da votação de validadores (feature #4): candidatura + voto de stake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const addr = () => walletAddress(generateKeyPair());

function withCandidates() {
  const s = new State();
  const A = addr(), B = addr(), C = addr();
  s.getAccount(A).staked = 2000n * U;
  s.getAccount(B).staked = 1500n * U;
  s.getAccount(C).staked = 1000n * U;
  return { s, A, B, C };
}

test('#4: sem votos, validators() é top por stake (retrocompatível)', () => {
  const { s, A, B, C } = withCandidates();
  assert.deepEqual(s.validators().map((v) => v.address), [A, B, C]);
});

test('#4: votos elevam o peso e mudam o ranking', () => {
  const saved = CHAIN.VOTING_HEIGHT; CHAIN.VOTING_HEIGHT = 1;
  try {
    const { s, A, C } = withCandidates();
    const voter = generateKeyPair(); const V = walletAddress(voter);
    s.getAccount(V).staked = 5000n * U; // poder de voto
    s.credit(V, 1n * U);
    // antes: A (2000) está acima de C (1000)
    let order = s.validators().map((v) => v.address);
    assert.ok(order.indexOf(A) < order.indexOf(C));
    // V vota 3000 em C → peso de C = 1000 + 3000 = 4000 > A (2000)
    const tx = buildTransaction(voter, { type: 'VOTE', nonce: 1, data: { votes: { [C]: (3000n * U).toString() } } });
    s.applyTransaction(tx, 5, Date.now());
    order = s.validators().map((v) => v.address);
    assert.ok(order.indexOf(C) < order.indexOf(A), 'C deve subir acima de A após os votos');
    const cRow = s.validators().find((v) => v.address === C);
    assert.equal(cRow.votes, 3000n * U);
  } finally { CHAIN.VOTING_HEIGHT = saved; }
});

test('#4: votar acima do stake e votar em si mesmo são rejeitados', () => {
  const saved = CHAIN.VOTING_HEIGHT; CHAIN.VOTING_HEIGHT = 1;
  try {
    const { s, C } = withCandidates();
    const voter = generateKeyPair(); const V = walletAddress(voter);
    s.getAccount(V).staked = 2000n * U; s.credit(V, 1n * U);
    // acima do poder de voto
    const over = buildTransaction(voter, { type: 'VOTE', nonce: 1, data: { votes: { [C]: (3000n * U).toString() } } });
    assert.throws(() => s.applyTransaction(over, 5, Date.now()), /excedem o poder de voto/);
    // em si mesmo
    const selfV = buildTransaction(voter, { type: 'VOTE', nonce: 1, data: { votes: { [V]: (100n * U).toString() } } });
    assert.throws(() => s.applyTransaction(selfV, 5, Date.now()), /si mesmo/);
  } finally { CHAIN.VOTING_HEIGHT = saved; }
});

test('#4: re-VOTE substitui a alocação anterior', () => {
  const saved = CHAIN.VOTING_HEIGHT; CHAIN.VOTING_HEIGHT = 1;
  try {
    const { s, B, C } = withCandidates();
    const voter = generateKeyPair(); const V = walletAddress(voter);
    s.getAccount(V).staked = 5000n * U; s.credit(V, 1n * U);
    s.applyTransaction(buildTransaction(voter, { type: 'VOTE', nonce: 1, data: { votes: { [C]: (3000n * U).toString() } } }), 5, Date.now());
    assert.equal(s.candidateVotes[C], 3000n * U);
    // re-vota tudo em B → C zera, B recebe
    s.applyTransaction(buildTransaction(voter, { type: 'VOTE', nonce: 2, data: { votes: { [B]: (2000n * U).toString() } } }), 6, Date.now());
    assert.equal(s.candidateVotes[C], undefined);
    assert.equal(s.candidateVotes[B], 2000n * U);
  } finally { CHAIN.VOTING_HEIGHT = saved; }
});

test('#4: UNSTAKE abaixo do total votado é rejeitado (votos precisam de lastro)', () => {
  const saved = CHAIN.VOTING_HEIGHT; CHAIN.VOTING_HEIGHT = 1;
  try {
    const { s, C } = withCandidates();
    const voter = generateKeyPair(); const V = walletAddress(voter);
    s.getAccount(V).staked = 5000n * U; s.credit(V, 1n * U);
    s.applyTransaction(buildTransaction(voter, { type: 'VOTE', nonce: 1, data: { votes: { [C]: (3000n * U).toString() } } }), 5, Date.now());
    // dessteikar 3000 deixaria staked 2000 < votado 3000 → rejeita
    const bad = buildTransaction(voter, { type: 'UNSTAKE', amount: 3000n * U, nonce: 2 });
    assert.throws(() => s.applyTransaction(bad, 6, Date.now()), /sem lastro/);
    // dessteikar 1000 (staked 4000 >= votado 3000) → ok
    s.applyTransaction(buildTransaction(voter, { type: 'UNSTAKE', amount: 1000n * U, nonce: 2 }), 6, Date.now());
    assert.equal(s.getAccount(V).staked, 4000n * U);
  } finally { CHAIN.VOTING_HEIGHT = saved; }
});

test('#4: VOTE antes de VOTING_HEIGHT é rejeitado', () => {
  const { s, C } = withCandidates();
  const voter = generateKeyPair();
  s.getAccount(walletAddress(voter)).staked = 2000n * U; s.credit(walletAddress(voter), 1n * U);
  const tx = buildTransaction(voter, { type: 'VOTE', nonce: 1, data: { votes: { [C]: (100n * U).toString() } } });
  assert.throws(() => s.applyTransaction(tx, 5, Date.now()), /ainda não ativa/); // VOTING_HEIGHT padrão é alto
});
