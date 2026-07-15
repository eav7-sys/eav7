// Testes de slashing + unbonding (recomendação (b)).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';
import { buildBlock } from '../src/core/block.js';
import { eavHash } from '../src/crypto/hash.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

test('(b) unbonding: UNSTAKE reduz o stake na hora, mas os fundos só voltam após o período', () => {
  const saved = CHAIN.UNBONDING_BLOCKS; CHAIN.UNBONDING_BLOCKS = 10;
  try {
    const w = generateKeyPair(); const a = walletAddress(w);
    const s = new State();
    s.getAccount(a).staked = 5000n * U; s.credit(a, 1n * U);
    const balBefore = s.balanceOf(a);
    s.applyTransaction(buildTransaction(w, { type: 'UNSTAKE', amount: 1000n * U, nonce: 1 }), 5, now());
    assert.equal(s.getAccount(a).staked, 4000n * U, 'stake cai imediatamente (perde voto/validação)');
    assert.equal(s.balanceOf(a), balBefore, 'fundos NÃO voltam na hora');
    assert.equal(s.unbonding.length, 1);
    assert.equal(s.unbonding[0].matureAt, 15);
    s.blockTick(14); // antes de maturar → nada
    assert.equal(s.balanceOf(a), balBefore);
    s.blockTick(15); // matura → devolve
    assert.equal(s.balanceOf(a), balBefore + 1000n * U);
    assert.equal(s.unbonding.length, 0);
  } finally { CHAIN.UNBONDING_BLOCKS = saved; }
});

// Dois blocos VÁLIDOS do mesmo produtor, mesma altura, conteúdos diferentes → hashes
// diferentes (assinatura dupla). previousHash é irrelevante para a integridade interna.
function doubleSign(wallet, height) {
  const prev = eavHash('prev');
  const a = buildBlock(wallet, { height, previousHash: prev, timestamp: 1_000_000, transactions: [] });
  const b = buildBlock(wallet, { height, previousHash: prev, timestamp: 2_000_000, transactions: [] });
  return { a, b };
}

test('(b) slashing: prova de assinatura dupla queima parte do stake e premia o denunciante', () => {
  const saved = CHAIN.SLASHING_HEIGHT; CHAIN.SLASHING_HEIGHT = 1;
  try {
    const offender = generateKeyPair();
    const { a: blockA, b: blockB } = doubleSign(offender, 3);
    assert.notEqual(blockA.hash, blockB.hash);
    const s = new State();
    const offAddr = blockA.producer;
    s.getAccount(offAddr).staked = 1000n * U;
    const reporter = generateKeyPair(); const rAddr = walletAddress(reporter);
    s.credit(rAddr, 0n);
    const burnedBefore = s.totalBurned;
    s.applyTransaction(buildTransaction(reporter, { type: 'SLASH_DOUBLE_SIGN', nonce: 1, data: { blockA, blockB } }), 5, now());
    // penalidade = 10% de 1000 = 100; prêmio = 10% de 100 = 10; queima = 90
    assert.equal(s.getAccount(offAddr).staked, 900n * U);
    assert.equal(s.balanceOf(rAddr), 10n * U);
    assert.equal(s.totalBurned - burnedBefore, 90n * U);
    assert.equal(s.slashed[`${offAddr}:3`], true);
    // re-slash da mesma ofensa é rejeitado
    assert.throws(() => s.applyTransaction(buildTransaction(reporter, { type: 'SLASH_DOUBLE_SIGN', nonce: 2, data: { blockA, blockB } }), 5, now()), /já foi penalizada/);
  } finally { CHAIN.SLASHING_HEIGHT = saved; }
});

test('(b) slashing: evidência sem conflito real é rejeitada', () => {
  const saved = CHAIN.SLASHING_HEIGHT; CHAIN.SLASHING_HEIGHT = 1;
  try {
    const offender = generateKeyPair();
    const { a: blockA } = doubleSign(offender, 3);
    const s = new State();
    s.getAccount(blockA.producer).staked = 1000n * U;
    const reporter = generateKeyPair(); s.credit(walletAddress(reporter), 0n);
    // mesmo bloco dos dois lados → sem conflito
    assert.throws(() => s.applyTransaction(buildTransaction(reporter, { type: 'SLASH_DOUBLE_SIGN', nonce: 1, data: { blockA, blockB: blockA } }), 5, now()), /mesmo bloco/);
    // produtores diferentes
    const outro = generateKeyPair();
    const { a: blockOutro } = doubleSign(outro, 3);
    assert.throws(() => s.applyTransaction(buildTransaction(reporter, { type: 'SLASH_DOUBLE_SIGN', nonce: 1, data: { blockA, blockB: blockOutro } }), 5, now()), /produtores diferentes/);
  } finally { CHAIN.SLASHING_HEIGHT = saved; }
});
