import test from 'node:test';
import assert from 'node:assert/strict';
import { pointMul, pointAdd, G, sign, recover, verify, publicKeyFromPrivate } from '../src/eavm/secp256k1.js';
import { keccak256 } from '../src/eavm/keccak.js';

test('secp256k1: vetores conhecidos (1G, 2G, 3G) após otimização Jacobiana', () => {
  const g1 = pointMul(1n, G);
  assert.equal(g1.x, G.x);
  assert.equal(g1.y, G.y);
  // 2G — vetor público conhecido do secp256k1
  const g2 = pointMul(2n, G);
  assert.equal(g2.x, 0xC6047F9441ED7D6D3045406E95C07CD85C778E4B8CEF3CA7ABAC09B95C709EE5n);
  assert.equal(g2.y, 0x1AE168FEA63DC339A3C58419466CEAEEF7F632653266D0E1236431A950CFE52An);
  // 3G = 2G + G (confere Jacobiano contra a soma afim)
  const g3 = pointMul(3n, G);
  const g3b = pointAdd(g2, G);
  assert.equal(g3.x, g3b.x);
  assert.equal(g3.y, g3b.y);
});

test('secp256k1: sign → recover → verify roundtrip (chaves determinísticas)', () => {
  for (const priv of [1n, 2n, 0xdeadbeefn, 0x1234567890abcdef1234567890abcdefn]) {
    const pub = publicKeyFromPrivate(priv);
    const h = keccak256(Buffer.from('EAV7 ' + priv.toString(16)));
    const { r, s, recId } = sign(h, priv);
    const rec = recover(h, r, s, recId);
    assert.ok(rec, 'recover não-nulo');
    assert.equal(rec.x, pub.x, 'recover recupera a chave pública correta');
    assert.equal(rec.y, pub.y);
    assert.equal(verify(h, r, s, pub), true, 'verify aceita a assinatura válida');
    assert.equal(verify(h, r, (s + 1n), pub), false, 'verify rejeita s adulterado');
  }
});
