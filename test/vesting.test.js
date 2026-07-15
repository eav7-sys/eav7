// Testes de vesting / time-lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { State } from '../src/core/state.js';
import { Blockchain } from '../src/core/blockchain.js';
import { buildGenesisBlock } from '../src/core/block.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { buildTransaction } from '../src/core/transaction.js';

const U = CHAIN.UNIT;
const now = () => Date.now();

test('vesting: libera 0 antes do cliff, linear até o fim, só o beneficiário resgata', () => {
  const saved = CHAIN.VESTING_HEIGHT; CHAIN.VESTING_HEIGHT = 1;
  try {
    const creator = generateKeyPair();
    const benef = generateKeyPair(); const bAddr = walletAddress(benef);
    const s = new State();
    s.credit(walletAddress(creator), 2000n * U);
    // trava 1000, cliff 10, duração 100, start=5
    const create = buildTransaction(creator, { type: 'VESTING_CREATE', amount: 1000n * U, nonce: 1, data: { beneficiary: bAddr, cliffBlocks: 10, durationBlocks: 100 } });
    s.applyTransaction(create, 5, now());
    const id = create.id;
    assert.equal(s.vesting[id].total, (1000n * U).toString());

    // antes do cliff (altura 10 < start+cliff 15) → nada a resgatar
    assert.throws(() => s.applyTransaction(buildTransaction(benef, { type: 'VESTING_CLAIM', nonce: 1, data: { vestingId: id } }), 10, now()), /nada a resgatar/);
    // não-beneficiário não resgata
    assert.throws(() => s.applyTransaction(buildTransaction(creator, { type: 'VESTING_CLAIM', nonce: 2, data: { vestingId: id } }), 55, now()), /só o beneficiário/);

    // metade do caminho (altura 55): vested = 1000 * (55-5)/100 = 500
    s.applyTransaction(buildTransaction(benef, { type: 'VESTING_CLAIM', nonce: 1, data: { vestingId: id } }), 55, now());
    assert.equal(s.balanceOf(bAddr), 500n * U);
    assert.equal(s.vesting[id].claimed, (500n * U).toString());

    // ao fim (altura 105 >= start+duration): resgata o restante e o vesting é podado
    s.applyTransaction(buildTransaction(benef, { type: 'VESTING_CLAIM', nonce: 2, data: { vestingId: id } }), 105, now());
    assert.equal(s.balanceOf(bAddr), 1000n * U);
    assert.equal(s.vesting[id], undefined, 'vesting concluído é podado');
  } finally { CHAIN.VESTING_HEIGHT = saved; }
});

test('vesting: distribuição semeada na gênese nasce vestida', () => {
  const benef = walletAddress(generateKeyPair());
  const val = generateKeyPair(); const vAddr = walletAddress(val);
  const gen = buildGenesisBlock({
    timestamp: Date.now() - 60_000,
    balances: {}, stakes: { [vAddr]: (2n * CHAIN.MIN_VALIDATOR_STAKE).toString() },
    vesting: [{ id: 'VEST-team-1', beneficiary: benef, total: (10_000n * U).toString(), cliff: 100, duration: 1000 }],
  });
  const chain = new Blockchain();
  chain.adoptGenesis(gen);
  const v = chain.state.vesting['VEST-team-1'];
  assert.ok(v);
  assert.equal(v.start, 0);
  assert.equal(chain.state.vestedAmount(v, 50), 0n); // antes do cliff
  assert.equal(chain.state.vestedAmount(v, 500), 5_000n * U); // metade do caminho
  assert.equal(chain.state.vestedAmount(v, 2000), 10_000n * U); // após o fim
});
