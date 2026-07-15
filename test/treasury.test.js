// Testes da tesouraria + gastos por governança.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

function govState(n = 4) {
  const s = new State();
  const vals = Array.from({ length: n }, () => generateKeyPair());
  for (const w of vals) { const a = walletAddress(w); s.getAccount(a).staked = 2n * CHAIN.MIN_VALIDATOR_STAKE; s.credit(a, 1n * U); }
  return { s, vals };
}
function pass(s, vals, prop, h) {
  const q = Math.floor((2 * s.validators().length) / 3) + 1;
  s.applyTransaction(prop, h, now());
  for (let i = 1; i < q; i++) s.applyTransaction(buildTransaction(vals[i], { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), h, now());
}

test('tesouraria: recebe o corte da recompensa quando TREASURY_PCT > 0', () => {
  const s = new State();
  s.params.TREASURY_PCT = 10; // 10%
  const producer = walletAddress(generateKeyPair());
  s.distributeBlockReward(producer, 100n * U);
  assert.equal(s.treasury, 10n * U, 'tesouraria recebe 10%');
  assert.equal(s.balanceOf(producer), 90n * U, 'produtor recebe o resto (sem eleitores)');
});

test('tesouraria: governança gasta via TREASURY_SPEND (após timelock)', () => {
  const sG = CHAIN.GOVERNANCE_HEIGHT, sT = CHAIN.GOV_TIMELOCK_BLOCKS;
  CHAIN.GOVERNANCE_HEIGHT = 1; CHAIN.GOV_TIMELOCK_BLOCKS = 0;
  try {
    const { s, vals } = govState(4);
    s.treasury = 1000n * U; // cofre com fundos
    const dest = walletAddress(generateKeyPair());
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'TREASURY_SPEND', value: { recipient: dest, amount: (300n * U).toString() } } });
    pass(s, vals, prop, 5);
    s.blockTick(5); // aplica o gasto
    assert.equal(s.balanceOf(dest), 300n * U);
    assert.equal(s.treasury, 700n * U);
  } finally { CHAIN.GOVERNANCE_HEIGHT = sG; CHAIN.GOV_TIMELOCK_BLOCKS = sT; }
});

test('tesouraria: gasto acima do saldo não tem efeito', () => {
  const sG = CHAIN.GOVERNANCE_HEIGHT, sT = CHAIN.GOV_TIMELOCK_BLOCKS;
  CHAIN.GOVERNANCE_HEIGHT = 1; CHAIN.GOV_TIMELOCK_BLOCKS = 0;
  try {
    const { s, vals } = govState(4);
    s.treasury = 100n * U;
    const dest = walletAddress(generateKeyPair());
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'TREASURY_SPEND', value: { recipient: dest, amount: (500n * U).toString() } } });
    pass(s, vals, prop, 5);
    s.blockTick(5);
    assert.equal(s.balanceOf(dest), 0n, 'gasto acima do cofre não ocorre');
    assert.equal(s.treasury, 100n * U);
  } finally { CHAIN.GOVERNANCE_HEIGHT = sG; CHAIN.GOV_TIMELOCK_BLOCKS = sT; }
});
