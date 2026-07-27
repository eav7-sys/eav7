import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreValidators, draftValidatorGovernanceProposal } from '../src/node/validator-score.js';

const V = [{ address: 'A', staked: 1000n }, { address: 'B', staked: 1000n }, { address: 'C', staked: 1000n }];
const T = 1000; // blockTimeMs

// Gera blocos de rodízio perfeito (produtor = slot%N, no início do slot).
function perfectBlocks(slots) {
  const out = [];
  for (let s = 0; s < slots; s++) out.push({ height: s + 1, producer: V[s % 3].address, timestamp: s * T });
  return out;
}

test('score: rodízio perfeito → todos saudáveis, score 100', () => {
  const r = scoreValidators({ validators: V, blocks: perfectBlocks(9), blockTimeMs: T });
  for (const v of r.validators) {
    assert.equal(v.score, 100, `${v.address} score`);
    assert.equal(v.status, 'healthy');
    assert.equal(v.productivityPct, 100);
    assert.equal(v.expected, 3);
    assert.equal(v.inTurn, 3);
    assert.equal(v.missed, 0);
  }
  assert.equal(r.summary.degraded, 0);
  assert.equal(r.summary.avgScore, 100);
});

test('score: validador offline (B nunca produz) → B degradado/offline, A e C saudáveis', () => {
  // Remove os blocos dos slots de B (slot % 3 === 1: 1, 4, 7).
  const blocks = perfectBlocks(9).filter((b) => b.producer !== 'B');
  const r = scoreValidators({ validators: V, blocks, blockTimeMs: T });
  const byAddr = Object.fromEntries(r.validators.map((v) => [v.address, v]));
  assert.equal(byAddr.B.status, 'offline');
  assert.equal(byAddr.B.score, 0);
  assert.equal(byAddr.B.produced, 0);
  assert.equal(byAddr.B.missed, 3); // 3 slots vazios atribuídos a B
  assert.equal(byAddr.B.degraded, true);
  assert.equal(byAddr.A.status, 'healthy');
  assert.equal(byAddr.C.status, 'healthy');
  assert.deepEqual(r.summary.degradedAddresses, ['B']);
  assert.equal(r.summary.worst.address, 'B');
  assert.equal(r.summary.worst.score, 0);
});

test('score: latência alta dentro do slot → penaliza (lagging)', () => {
  // Todos em turno, mas 400ms atrasados dentro do slot (latFactor = 1 - 0.4*0.5 = 0.8).
  const blocks = perfectBlocks(9).map((b) => ({ ...b, timestamp: b.timestamp + 400 }));
  const r = scoreValidators({ validators: V, blocks, blockTimeMs: T });
  for (const v of r.validators) {
    assert.equal(v.avgLatencyMs, 400);
    assert.equal(v.score, 80); // 100 * 1.0 * 0.8
    assert.equal(v.status, 'lagging');
    assert.equal(v.degraded, false);
  }
});

test('score: produção fora de turno conta a favor de quem produziu e como slot perdido do esperado', () => {
  // A rouba o slot de B (slot 1): produtor A no slot 1 em vez de B.
  const blocks = perfectBlocks(9).map((b) => (b.height === 2 ? { ...b, producer: 'A' } : b));
  const r = scoreValidators({ validators: V, blocks, blockTimeMs: T });
  const byAddr = Object.fromEntries(r.validators.map((v) => [v.address, v]));
  assert.equal(byAddr.A.outOfTurn, 1);
  assert.equal(byAddr.A.produced, 4);   // 3 próprios + 1 roubado
  assert.equal(byAddr.B.inTurn, 2);     // perdeu 1 dos seus 3 slots
  assert.equal(byAddr.B.expected, 3);
  assert.ok(byAddr.B.score < 100);
});

test('score: sem blocos ou sem validadores → não quebra', () => {
  const empty = scoreValidators({ validators: V, blocks: [], blockTimeMs: T });
  assert.equal(empty.summary.count, 3);
  assert.equal(empty.window.blocks, 0);
  for (const v of empty.validators) assert.equal(v.score, 100); // sem slots atribuídos = neutro

  const noVals = scoreValidators({ validators: [], blocks: perfectBlocks(3), blockTimeMs: T });
  assert.equal(noVals.summary.count, 0);
});

test('draft: recomendação de governança é PROPOSE-ONLY (autonomous:false)', () => {
  const blocks = perfectBlocks(9).filter((b) => b.producer !== 'B');
  const r = scoreValidators({ validators: V, blocks, blockTimeMs: T });
  const bad = r.validators.find((v) => v.address === 'B');
  const draft = draftValidatorGovernanceProposal(bad, { sustainedTicks: 6 });
  assert.equal(draft.autonomous, false);
  assert.equal(draft.target, 'B');
  assert.equal(draft.evidence.sustainedTicks, 6);
  assert.match(draft.recommendation, /B/);
  assert.match(draft.recommendation, /GOVERNAN/i);
  assert.equal(draft.operationalMitigation, 'gateway-read-routing-away-from-degraded');
});
