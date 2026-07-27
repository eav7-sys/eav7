import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayHealth } from '../src/node/gateway.js';

function gw() { return new GatewayHealth({ node: {}, lag: 12, flips: 2 }); }

test('gateway: serve local quando o nó está em dia com os peers', () => {
  const g = gw();
  assert.equal(g.decide(100, [{ url: 'p1', height: 105, ok: true, latency: 10 }]), null); // 5 <= lag
  assert.equal(g.target, null);
});

test('gateway: failover (com histerese) quando o nó está stale', () => {
  const g = gw();
  const peers = [{ url: 'p1', height: 130, ok: true, latency: 10 }]; // 30 atrás > lag 12
  assert.equal(g.decide(100, peers), null); // 1ª checagem: ainda não troca (histerese)
  assert.equal(g.decide(100, peers), 'p1'); // 2ª consecutiva: failover
});

test('gateway: escolhe o peer mais saudável (maior altura, ignora offline)', () => {
  const g = gw();
  const peers = [
    { url: 'p1', height: 118, ok: true, latency: 5 },
    { url: 'p2', height: 140, ok: true, latency: 30 }, // mais à frente
    { url: 'p3', height: 999, ok: false, latency: Infinity }, // offline — ignorado
  ];
  g.decide(100, peers); g.decide(100, peers);
  assert.equal(g.target, 'p2');
});

test('gateway: recupera para local quando o nó volta a alcançar a rede', () => {
  const g = gw();
  const ahead = [{ url: 'p1', height: 130, ok: true, latency: 10 }];
  g.decide(100, ahead); g.decide(100, ahead); // failover -> p1
  assert.equal(g.target, 'p1');
  const caught = [{ url: 'p1', height: 130, ok: true, latency: 10 }];
  assert.equal(g.decide(129, caught), 'p1'); // 1 atrás <= lag → 1ª saudável, ainda em p1
  assert.equal(g.decide(130, caught), null); // 2ª saudável consecutiva → volta a servir local
});
