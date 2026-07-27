import test from 'node:test';
import assert from 'node:assert/strict';
import { AbuseGuard } from '../src/node/guard.js';

function g(opts = {}) {
  return new AbuseGuard({ windowMs: 1000, threshold: 10, blockMs: 5000, maxBlockMs: 60_000, enabled: true, ...opts });
}

test('guard: bloqueia ao cruzar o limiar de faltas na janela', () => {
  const guard = g();
  const ip = '1.2.3.4';
  assert.equal(guard.blocked(ip, 0), false);
  for (let i = 0; i < 3; i++) assert.equal(guard.strike(ip, 3, 100), false); // 9 < 10
  assert.equal(guard.strike(ip, 3, 100), true); // 12 >= 10 → bloqueia
  assert.equal(guard.blocked(ip, 100), true);
  assert.equal(guard.blocked(ip, 5099), true);  // ainda dentro do bloqueio (5000ms)
  assert.equal(guard.blocked(ip, 5101), false); // TTL expirou → liberado sozinho (reversível)
});

test('guard: janela desliza — faltas antigas não somam', () => {
  const guard = g();
  const ip = '9.9.9.9';
  guard.strike(ip, 8, 0);       // score 8
  assert.equal(guard.strike(ip, 8, 2000), false); // nova janela (>1000ms): score reseta p/ 8
  assert.equal(guard.blocked(ip, 2000), false);
});

test('guard: NUNCA bloqueia loopback (túnel Cloudflare)', () => {
  const guard = g();
  for (let i = 0; i < 100; i++) guard.strike('127.0.0.1', 5, 10);
  assert.equal(guard.blocked('127.0.0.1', 10), false);
  assert.equal(guard.blocked('::1', 10), false);
});

test('guard: reincidente tem bloqueio dobrado (backoff) até o teto', () => {
  const guard = g({ blockMs: 1000, maxBlockMs: 3000 });
  const ip = '5.5.5.5';
  // 1ª ofensa: 1000ms
  guard.strike(ip, 10, 0);
  let snap = guard.snapshot(0);
  assert.equal(snap.blocked[0].remainingMs, 1000);
  // depois de expirar, 2ª ofensa: 2000ms
  guard.strike(ip, 10, 1001);
  assert.equal(guard.snapshot(1001).blocked[0].remainingMs, 2000);
  // 3ª: 4000 capado em 3000 (maxBlockMs)
  guard.strike(ip, 10, 3002);
  assert.equal(guard.snapshot(3002).blocked[0].remainingMs, 3000);
});

test('guard: clear desbloqueia manualmente (admin)', () => {
  const guard = g();
  const ip = '7.7.7.7';
  guard.strike(ip, 10, 0);
  assert.equal(guard.blocked(ip, 0), true);
  assert.equal(guard.clear(ip), true);
  assert.equal(guard.blocked(ip, 0), false);
});

test('guard: desabilitado (EAV7_GUARD=0) nunca bloqueia', () => {
  const guard = g({ enabled: false });
  for (let i = 0; i < 100; i++) guard.strike('2.2.2.2', 10, 0);
  assert.equal(guard.blocked('2.2.2.2', 0), false);
  assert.equal(guard.snapshot(0).enabled, false);
});

test('guard: snapshot lista bloqueios ativos com tempo restante', () => {
  const guard = g();
  guard.strike('a', 10, 0);
  guard.strike('b', 10, 0);
  const snap = guard.snapshot(1000);
  assert.equal(snap.activeBlocks, 2);
  assert.equal(snap.totalBlocks, 2);
  assert.ok(snap.blocked.every((b) => b.remainingMs === 4000));
});
