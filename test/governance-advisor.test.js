import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { adviseGovernance } from '../src/node/governance-advisor.js';

// Valores efetivos padrão dos governáveis (como state.param() devolveria sem overrides).
function baseParams(over = {}) {
  return {
    BLOCK_REWARD: CHAIN.BLOCK_REWARD,
    MIN_VALIDATOR_STAKE: CHAIN.MIN_VALIDATOR_STAKE,
    MAX_VALIDATORS: CHAIN.MAX_VALIDATORS,
    FEE_EXEMPT_STAKE: CHAIN.FEE_EXEMPT_STAKE,
    MIN_ORACLE_STAKE: CHAIN.MIN_ORACLE_STAKE,
    TREASURY_PCT: CHAIN.TREASURY_PCT,
    BRIDGE_BREAKER_BPS: CHAIN.BRIDGE_BREAKER_BPS,
    ...over,
  };
}
const healthyStats = {
  eligibleValidators: 3, activeValidators: 3, finalityMinValidators: 3,
  bridge: { breakerActive: false, breakerTripsWindow: 0 },
};

test('advisor: rede saudável → nenhuma proposta', () => {
  const out = adviseGovernance({ params: baseParams(), stats: healthyStats });
  assert.deepEqual(out, []);
});

test('advisor: mais candidatos elegíveis que slots → propõe elevar MAX_VALIDATORS', () => {
  const out = adviseGovernance({
    params: baseParams({ MAX_VALIDATORS: 27 }),
    stats: { ...healthyStats, eligibleValidators: 40 },
  });
  assert.equal(out.length, 1);
  const a = out[0];
  assert.equal(a.param, 'MAX_VALIDATORS');
  assert.equal(a.autonomous, false); // PROPOSE-ONLY
  assert.equal(a.currentValue, 27);
  assert.equal(a.suggestedValue, 40); // min(40, cap 101)
  assert.equal(a.draftTx.type, 'GOV_PROPOSE');
  assert.equal(a.draftTx.data.param, 'MAX_VALIDATORS');
  assert.equal(a.draftTx.data.value, 40);
});

test('advisor: elegíveis acima do teto → sugere o teto (101), não além', () => {
  const out = adviseGovernance({
    params: baseParams({ MAX_VALIDATORS: 50 }),
    stats: { ...healthyStats, eligibleValidators: 500 },
  });
  assert.equal(out[0].suggestedValue, 101);
});

test('advisor: MAX_VALIDATORS já no teto → não propõe (nada a elevar)', () => {
  const out = adviseGovernance({
    params: baseParams({ MAX_VALIDATORS: 101 }),
    stats: { ...healthyStats, eligibleValidators: 500 },
  });
  assert.deepEqual(out, []);
});

test('advisor: validadores ativos abaixo do mínimo de finalidade → adverte + sugere baixar stake', () => {
  const out = adviseGovernance({
    params: baseParams(),
    stats: { ...healthyStats, activeValidators: 2, finalityMinValidators: 3, eligibleValidators: 2 },
  });
  const a = out.find((x) => x.param === 'MIN_VALIDATOR_STAKE');
  assert.ok(a, 'deve advertir sobre finalidade');
  assert.equal(a.severity, 'warning');
  assert.equal(a.autonomous, false);
  assert.equal(a.suggestedValue, (CHAIN.MIN_VALIDATOR_STAKE / 2n).toString()); // bigint serializado
  assert.match(a.reason, /finalidade/i);
});

test('advisor: breaker da ponte dormente → regra do breaker NÃO dispara', () => {
  const out = adviseGovernance({
    params: baseParams(),
    stats: { ...healthyStats, bridge: { breakerActive: false, breakerTripsWindow: 10 } },
  });
  assert.equal(out.find((x) => x.param === 'BRIDGE_BREAKER_BPS'), undefined);
});

test('advisor: breaker ATIVO disparando muito → propõe afrouxar BRIDGE_BREAKER_BPS', () => {
  const out = adviseGovernance({
    params: baseParams({ BRIDGE_BREAKER_BPS: 3000 }),
    stats: { ...healthyStats, bridge: { breakerActive: true, breakerTripsWindow: 5 } },
  });
  const a = out.find((x) => x.param === 'BRIDGE_BREAKER_BPS');
  assert.ok(a);
  assert.equal(a.suggestedValue, 4000); // +1000, capado em 10000
  assert.equal(a.draftTx.data.value, 4000);
});
