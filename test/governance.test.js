// Testes da governança on-chain (feature #9): propostas + votação de parâmetros.
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

test('#9: proposta aprovada por 2/3+1 aplica o parâmetro on-chain', () => {
  const saved = CHAIN.GOVERNANCE_HEIGHT; CHAIN.GOVERNANCE_HEIGHT = 1;
  try {
    const { s, vals } = govState(4); // quórum = floor(8/3)+1 = 3
    assert.equal(s.validators().length, 4);
    assert.equal(s.param('BLOCK_REWARD'), CHAIN.BLOCK_REWARD); // default antes
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'BLOCK_REWARD', value: (5n * U).toString() } });
    s.applyTransaction(prop, 5, now());
    assert.equal(s.proposals[prop.id].status, 'VOTING'); // 1 voto < 3
    s.applyTransaction(buildTransaction(vals[1], { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), 5, now());
    assert.equal(s.proposals[prop.id].status, 'VOTING'); // 2 < 3
    s.applyTransaction(buildTransaction(vals[2], { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), 5, now());
    assert.equal(s.proposals[prop.id].status, 'EXECUTED'); // 3 >= 3
    assert.equal(s.param('BLOCK_REWARD'), 5n * U); // override aplicado
  } finally { CHAIN.GOVERNANCE_HEIGHT = saved; }
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
    s.applyTransaction(prop, 5, now()); // proponente já votou
    assert.throws(() => s.applyTransaction(buildTransaction(vals[0], { type: 'GOV_VOTE', nonce: 2, data: { proposalId: prop.id } }), 5, now()), /já votou/);
  } finally { CHAIN.GOVERNANCE_HEIGHT = saved; }
});

test('#9: governança pode alterar MAX_VALIDATORS e o conjunto ativo reflete', () => {
  const saved = CHAIN.GOVERNANCE_HEIGHT; CHAIN.GOVERNANCE_HEIGHT = 1;
  try {
    const { s, vals } = govState(4);
    // aprova MAX_VALIDATORS = 2 (quórum 3 dos 4 atuais)
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'MAX_VALIDATORS', value: '2' } });
    s.applyTransaction(prop, 5, now());
    s.applyTransaction(buildTransaction(vals[1], { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), 5, now());
    s.applyTransaction(buildTransaction(vals[2], { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), 5, now());
    assert.equal(s.proposals[prop.id].status, 'EXECUTED');
    assert.equal(s.validators().length, 2, 'conjunto ativo agora limitado a 2');
  } finally { CHAIN.GOVERNANCE_HEIGHT = saved; }
});
