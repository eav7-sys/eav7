// Testes da governança on-chain (#9) + timelock e poda de estado ((a)).
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
// Leva uma proposta ao quórum: proponente + (quorum-1) votos.
function passProposal(s, vals, prop, atHeight) {
  const N = s.validators().length;
  const quorum = Math.floor((2 * N) / 3) + 1;
  s.applyTransaction(prop, atHeight, now());
  for (let i = 1; i < quorum; i++) {
    s.applyTransaction(buildTransaction(vals[i], { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), atHeight, now());
  }
}

test('#9: proposta aprovada ENFILEIRA e só aplica após o timelock', () => {
  const sH = CHAIN.GOVERNANCE_HEIGHT, sT = CHAIN.GOV_TIMELOCK_BLOCKS;
  CHAIN.GOVERNANCE_HEIGHT = 1; CHAIN.GOV_TIMELOCK_BLOCKS = 100;
  try {
    const { s, vals } = govState(4);
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'BLOCK_REWARD', value: (5n * U).toString() } });
    passProposal(s, vals, prop, 5);
    assert.equal(s.proposals[prop.id].status, 'QUEUED');
    assert.equal(s.proposals[prop.id].executeAt, 105);
    assert.equal(s.param('BLOCK_REWARD'), CHAIN.BLOCK_REWARD, 'ainda não aplicado (timelock)');
    s.blockTick(50); // antes do executeAt → nada
    assert.equal(s.param('BLOCK_REWARD'), CHAIN.BLOCK_REWARD);
    s.blockTick(105); // no executeAt → aplica e poda
    assert.equal(s.param('BLOCK_REWARD'), 5n * U);
    assert.equal(s.proposals[prop.id], undefined, 'proposta podada após aplicar');
  } finally { CHAIN.GOVERNANCE_HEIGHT = sH; CHAIN.GOV_TIMELOCK_BLOCKS = sT; }
});

test('#9: só validador ativo propõe/vota', () => {
  const saved = CHAIN.GOVERNANCE_HEIGHT; CHAIN.GOVERNANCE_HEIGHT = 1;
  try {
    const { s, vals } = govState(4);
    const estranho = generateKeyPair(); s.credit(walletAddress(estranho), 1n * U);
    assert.throws(() => s.applyTransaction(buildTransaction(estranho, { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'BLOCK_REWARD', value: (1n * U).toString() } }), 5, now()), /só validador/);
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'BLOCK_REWARD', value: (1n * U).toString() } });
    s.applyTransaction(prop, 5, now());
    assert.throws(() => s.applyTransaction(buildTransaction(estranho, { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), 5, now()), /só validador/);
  } finally { CHAIN.GOVERNANCE_HEIGHT = saved; }
});

test('#9: parâmetro não-governável e valor fora dos limites são rejeitados', () => {
  const saved = CHAIN.GOVERNANCE_HEIGHT; CHAIN.GOVERNANCE_HEIGHT = 1;
  try {
    const { s, vals } = govState(4);
    assert.throws(() => s.applyTransaction(buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'HALVING_INTERVAL_BLOCKS', value: '1' } }), 5, now()), /não governável/);
    assert.throws(() => s.applyTransaction(buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'BLOCK_REWARD', value: (5000n * U).toString() } }), 5, now()), /fora dos limites/);
  } finally { CHAIN.GOVERNANCE_HEIGHT = saved; }
});

test('#9: validador não vota duas vezes na mesma proposta', () => {
  const saved = CHAIN.GOVERNANCE_HEIGHT; CHAIN.GOVERNANCE_HEIGHT = 1;
  try {
    const { s, vals } = govState(4);
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'MAX_VALIDATORS', value: '21' } });
    s.applyTransaction(prop, 5, now());
    assert.throws(() => s.applyTransaction(buildTransaction(vals[0], { type: 'GOV_VOTE', nonce: 2, data: { proposalId: prop.id } }), 5, now()), /já votou/);
  } finally { CHAIN.GOVERNANCE_HEIGHT = saved; }
});

test('#9+(a): governança altera MAX_VALIDATORS após o timelock; conjunto reflete', () => {
  const sH = CHAIN.GOVERNANCE_HEIGHT, sT = CHAIN.GOV_TIMELOCK_BLOCKS;
  CHAIN.GOVERNANCE_HEIGHT = 1; CHAIN.GOV_TIMELOCK_BLOCKS = 0;
  try {
    const { s, vals } = govState(4);
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'MAX_VALIDATORS', value: '2' } });
    passProposal(s, vals, prop, 5);
    s.blockTick(5); // timelock 0 → aplica já
    assert.equal(s.validators().length, 2, 'conjunto ativo limitado a 2');
  } finally { CHAIN.GOVERNANCE_HEIGHT = sH; CHAIN.GOV_TIMELOCK_BLOCKS = sT; }
});

test('(a): proposta que expira sem quórum é podada pelo tick', () => {
  const saved = CHAIN.GOVERNANCE_HEIGHT; CHAIN.GOVERNANCE_HEIGHT = 1;
  try {
    const { s, vals } = govState(4);
    // só o proponente vota; janela de votação curta
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'BLOCK_REWARD', value: (2n * U).toString(), votingBlocks: 10 } });
    s.applyTransaction(prop, 5, now());
    assert.equal(s.proposals[prop.id].status, 'VOTING');
    assert.equal(s.proposals[prop.id].deadline, 15);
    s.blockTick(16); // passou do prazo sem quórum → podada
    assert.equal(s.proposals[prop.id], undefined);
    assert.equal(s.param('BLOCK_REWARD'), CHAIN.BLOCK_REWARD, 'não aplicou');
  } finally { CHAIN.GOVERNANCE_HEIGHT = saved; }
});
