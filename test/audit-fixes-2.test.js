// Regressões dos achados da 3ª auditoria (branch security-audit-fixes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { Mempool } from '../src/core/mempool.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

test('CRÍTICO: META_TX não pode agir por uma conta MULTISIG (burlava o M-de-N)', () => {
  const sM = CHAIN.META_HEIGHT, sP = CHAIN.PERMISSIONS_HEIGHT;
  CHAIN.META_HEIGHT = 1; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const owner = generateKeyPair(); const M = walletAddress(owner); // chave-dona original
    const s = new State(); s.credit(M, 1000n * U);
    const keys = { [walletAddress(generateKeyPair())]: 1, [walletAddress(generateKeyPair())]: 1 };
    s.applyTransaction(buildTransaction(owner, { type: 'PERMISSION_UPDATE', nonce: 1, data: { permission: { threshold: 2, keys } } }), 5, now());
    // a chave-dona assina uma TRANSFER como a conta multisig e um relayer embrulha
    const relayer = generateKeyPair(); s.credit(walletAddress(relayer), 10n * U);
    const dest = walletAddress(generateKeyPair());
    const inner = buildTransaction(owner, { type: 'TRANSFER', to: dest, amount: 500n * U, nonce: 2 });
    const meta = buildTransaction(relayer, { type: 'META_TX', nonce: 1, data: { inner } });
    assert.throws(() => s.applyTransaction(meta, 5, now()), /multisig/);
    assert.equal(s.balanceOf(dest), 0n);
  } finally { CHAIN.META_HEIGHT = sM; CHAIN.PERMISSIONS_HEIGHT = sP; }
});

test('ALTO: META_TX de token respeita pause/blacklist/freeze', () => {
  const sM = CHAIN.META_HEIGHT, sT = CHAIN.TOKEN_ADMIN_HEIGHT;
  CHAIN.META_HEIGHT = 1; CHAIN.TOKEN_ADMIN_HEIGHT = 1;
  try {
    const holder = generateKeyPair(); const H = walletAddress(holder);
    const ownerW = generateKeyPair(); const owner = walletAddress(ownerW);
    const s = new State();
    s.tokens.TK = { standard: 'eav20', id: 'TK', name: 'T', symbol: 'TK', decimals: 0, totalSupply: 1000n, owner, mintable: false, paused: false, blacklist: { [H]: true }, frozen: {}, balances: { [H]: 1000n }, allowances: {} };
    const relayer = generateKeyPair(); s.credit(walletAddress(relayer), 10n * U);
    const dest = walletAddress(generateKeyPair());
    const inner = buildTransaction(holder, { type: 'TOKEN_TRANSFER', to: dest, amount: 100n, nonce: 1, data: { token: 'TK' } });
    const meta = buildTransaction(relayer, { type: 'META_TX', nonce: 1, data: { inner } });
    assert.throws(() => s.applyTransaction(meta, 5, now()), /bloqueado/); // blacklist do holder
    assert.equal(s.tokens.TK.balances[dest] ?? 0n, 0n);
  } finally { CHAIN.META_HEIGHT = sM; CHAIN.TOKEN_ADMIN_HEIGHT = sT; }
});

test('CRÍTICO: mempool poda uma tx cripto-cara que falha fundo (era re-executada p/ sempre)', () => {
  const s = new State();
  const sender = generateKeyPair();
  s.getAccount(walletAddress(sender)); // saldo 0
  const dest = walletAddress(generateKeyPair());
  const mp = new Mempool();
  // TRANSFER com nonce ESPERADO (1) mas sem saldo → falha fundo no handler
  mp.add(buildTransaction(sender, { type: 'TRANSFER', to: dest, amount: 100n * U, nonce: 1 }));
  assert.equal(mp.size, 1);
  const selected = mp.selectExecutable(s, 1, 0);
  assert.equal(selected.length, 0, 'não entra em bloco');
  assert.equal(mp.size, 0, 'foi PODADA (não fica re-executando a cada bloco)');
});

test('MÉDIO: governança não pode zerar o conjunto de validadores (anti-brick)', () => {
  const sG = CHAIN.GOVERNANCE_HEIGHT, sT = CHAIN.GOV_TIMELOCK_BLOCKS;
  CHAIN.GOVERNANCE_HEIGHT = 1; CHAIN.GOV_TIMELOCK_BLOCKS = 0;
  try {
    const s = new State();
    const vals = Array.from({ length: 4 }, () => generateKeyPair());
    for (const w of vals) { const a = walletAddress(w); s.getAccount(a).staked = 2n * CHAIN.MIN_VALIDATOR_STAKE; s.credit(a, 1n * U); }
    // propõe MIN_VALIDATOR_STAKE acima do stake de todos → esvaziaria o conjunto
    const prop = buildTransaction(vals[0], { type: 'GOV_PROPOSE', nonce: 1, data: { param: 'MIN_VALIDATOR_STAKE', value: (10_000_000n * U).toString() } });
    s.applyTransaction(prop, 5, now());
    s.applyTransaction(buildTransaction(vals[1], { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), 5, now());
    s.applyTransaction(buildTransaction(vals[2], { type: 'GOV_VOTE', nonce: 1, data: { proposalId: prop.id } }), 5, now());
    s.blockTick(5);
    assert.equal(s.param('MIN_VALIDATOR_STAKE'), CHAIN.MIN_VALIDATOR_STAKE, 'a mudança foi revertida');
    assert.equal(s.validators().length, 4, 'validadores intactos');
  } finally { CHAIN.GOVERNANCE_HEIGHT = sG; CHAIN.GOV_TIMELOCK_BLOCKS = sT; }
});

test('MÉDIO: op multisig UNSTAKE existe (stake não fica travado)', () => {
  const saved = CHAIN.PERMISSIONS_HEIGHT; CHAIN.PERMISSIONS_HEIGHT = 1;
  try {
    const M = generateKeyPair(); const Maddr = walletAddress(M);
    const K = [generateKeyPair(), generateKeyPair()];
    const keys = Object.fromEntries(K.map((k) => [walletAddress(k), 1]));
    const s = new State();
    s.credit(Maddr, 1000n * U);
    s.getAccount(walletAddress(generateKeyPair())).staked = 2n * CHAIN.MIN_VALIDATOR_STAKE; // outro validador (não esvazia)
    s.applyTransaction(buildTransaction(M, { type: 'PERMISSION_UPDATE', nonce: 1, data: { permission: { threshold: 2, keys } } }), 5, now());
    // STAKE via multisig, depois UNSTAKE via multisig
    const p1 = buildTransaction(K[0], { type: 'MULTISIG_PROPOSE', nonce: 1, data: { account: Maddr, op: { type: 'STAKE', amount: (500n * U).toString() } } });
    s.applyTransaction(p1, 5, now());
    s.applyTransaction(buildTransaction(K[1], { type: 'MULTISIG_APPROVE', nonce: 1, data: { opId: p1.id } }), 5, now());
    assert.equal(s.getAccount(Maddr).staked, 500n * U);
    const p2 = buildTransaction(K[0], { type: 'MULTISIG_PROPOSE', nonce: 2, data: { account: Maddr, op: { type: 'UNSTAKE', amount: (300n * U).toString() } } });
    s.applyTransaction(p2, 5, now());
    s.applyTransaction(buildTransaction(K[1], { type: 'MULTISIG_APPROVE', nonce: 2, data: { opId: p2.id } }), 5, now());
    assert.equal(s.getAccount(Maddr).staked, 200n * U);
    assert.ok(s.unbonding.some((u) => u.address === Maddr && u.amount === (300n * U).toString()));
  } finally { CHAIN.PERMISSIONS_HEIGHT = saved; }
});
