// Testes das correções de interação da auto-auditoria (slash×unbonding, multisig×validador,
// bootstrap de comitê por governança).
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

test('Fix 1: slash alcança fundos em unbonding (não dá pra escapar dando UNSTAKE)', () => {
  const sS = CHAIN.SLASHING_HEIGHT, sU = CHAIN.UNBONDING_BLOCKS;
  CHAIN.SLASHING_HEIGHT = 1; CHAIN.UNBONDING_BLOCKS = 1000;
  try {
    const offender = generateKeyPair();
    const prev = eavHash('p');
    const bA = buildBlock(offender, { height: 3, previousHash: prev, timestamp: 1_000_000, transactions: [] });
    const bB = buildBlock(offender, { height: 3, previousHash: prev, timestamp: 2_000_000, transactions: [] });
    const offAddr = bA.producer;
    const other = generateKeyPair(); // segundo validador para o UNSTAKE não esvaziar o conjunto
    const s = new State();
    s.getAccount(offAddr).staked = 1000n * U;
    s.getAccount(walletAddress(other)).staked = 1000n * U;
    // o infrator tenta escapar: dessteika 990 (vai para unbonding), sobra 10 no stake
    s.applyTransaction(buildTransaction(offender, { type: 'UNSTAKE', amount: 990n * U, nonce: 1 }), 5, now());
    assert.equal(s.getAccount(offAddr).staked, 10n * U);
    const reporter = generateKeyPair(); s.credit(walletAddress(reporter), 0n);
    const burnedBefore = s.totalBurned;
    s.applyTransaction(buildTransaction(reporter, { type: 'SLASH_DOUBLE_SIGN', nonce: 1, data: { blockA: bA, blockB: bB } }), 5, now());
    // penalidade = 10% de (10 + 990) = 100; tira 10 do stake e 90 do unbonding
    assert.equal(s.getAccount(offAddr).staked, 0n, 'stake ativo zerado');
    const unbondLeft = s.unbonding.filter((u) => u.address === offAddr).reduce((a, u) => a + BigInt(u.amount), 0n);
    assert.equal(unbondLeft, 900n * U, 'unbonding penalizado (990 - 90)');
    assert.equal(s.balanceOf(walletAddress(reporter)), 10n * U); // prêmio = 10% de 100
    assert.equal(s.totalBurned - burnedBefore, 90n * U);
  } finally { CHAIN.SLASHING_HEIGHT = sS; CHAIN.UNBONDING_BLOCKS = sU; }
});

test('Fix 2: conta com stake não pode virar multisig (evita trava de UNSTAKE/VOTE)', () => {
  const saved = CHAIN.PERMISSIONS_HEIGHT; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const w = generateKeyPair(); const a = walletAddress(w);
    const s = new State();
    s.getAccount(a).staked = 1000n * U; s.credit(a, 10n * U);
    const keys = { [walletAddress(generateKeyPair())]: 1, [walletAddress(generateKeyPair())]: 1 };
    const tx = buildTransaction(w, { type: 'PERMISSION_UPDATE', nonce: 1, data: { permission: { threshold: 1, keys } } });
    assert.throws(() => s.applyTransaction(tx, 5, now()), /com stake não pode virar multisig/);
    // sem stake → permitido
    const w2 = generateKeyPair(); const a2 = walletAddress(w2); s.credit(a2, 10n * U);
    s.applyTransaction(buildTransaction(w2, { type: 'PERMISSION_UPDATE', nonce: 1, data: { permission: { threshold: 1, keys } } }), 5, now());
    assert.ok(s.permissions[a2]);
  } finally { CHAIN.PERMISSIONS_HEIGHT = saved; }
});

test('Fix 3: governança cria (bootstrap) e depois troca um comitê de ponte', () => {
  const sG = CHAIN.GOVERNANCE_HEIGHT, sT = CHAIN.GOV_TIMELOCK_BLOCKS;
  CHAIN.GOVERNANCE_HEIGHT = 1; CHAIN.GOV_TIMELOCK_BLOCKS = 0;
  try {
    const s = new State();
    const vals = Array.from({ length: 4 }, () => generateKeyPair());
    for (const w of vals) { const a = walletAddress(w); s.getAccount(a).staked = 2n * CHAIN.MIN_VALIDATOR_STAKE; s.credit(a, 1n * U); }
    assert.equal(s.bridgeSourceCommittees.TRON, undefined, 'sem comitê no início');
    const m1 = ['0x' + 'aa'.repeat(20), '0x' + 'bb'.repeat(20), '0x' + 'cc'.repeat(20)];
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'BRIDGE_COMMITTEE', value: { sourceChain: 'TRON', members: m1, quorum: 2 } } });
    s.applyTransaction(prop, 5, now());
    s.applyTransaction(buildTransaction(vals[1], { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), 5, now());
    s.applyTransaction(buildTransaction(vals[2], { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), 5, now());
    s.blockTick(5); // timelock 0 → aplica: BOOTSTRAP do comitê
    assert.deepEqual(s.bridgeSourceCommittees.TRON.members.slice().sort(), m1.slice().sort());
    assert.equal(s.bridgeSourceCommittees.TRON.epoch, 0);
    assert.equal(s.bridgeSourceCommittees.TRON.quorum, 2);

    // troca via governança → epoch incrementa
    const m2 = ['0x' + 'dd'.repeat(20), '0x' + 'ee'.repeat(20)];
    const prop2 = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 2, data: { param: 'BRIDGE_COMMITTEE', value: { sourceChain: 'TRON', members: m2, quorum: 1 } } });
    s.applyTransaction(prop2, 6, now());
    s.applyTransaction(buildTransaction(vals[1], { type: 'GOV_VOTE', nonce: 2, data: { proposalId: prop2.id } }), 6, now());
    s.applyTransaction(buildTransaction(vals[2], { type: 'GOV_VOTE', nonce: 2, data: { proposalId: prop2.id } }), 6, now());
    s.blockTick(6);
    assert.equal(s.bridgeSourceCommittees.TRON.epoch, 1);
    assert.equal(s.bridgeSourceCommittees.TRON.quorum, 1);
  } finally { CHAIN.GOVERNANCE_HEIGHT = sG; CHAIN.GOV_TIMELOCK_BLOCKS = sT; }
});
