// Destino E7 nativo no envelope EAVM: to = 0xe7000000 + corpo+checksum do E7.
import test from 'node:test';
import assert from 'node:assert';
import { createSignedTx } from '../src/eavm/tx.js';
import { buildEavmEnvelope, verifyEavmEnvelope, encodeE7Dest, decodeE7Dest, eavmToE7 } from '../src/eavm/envelope.js';
import { CHAIN } from '../src/config.js';

const PRIV = 0x1111111111111111111111111111111111111111111111111111111111111111n;
const E7 = 'E7F2906EA4B2CD23D20180C8E813F2D126'; // checksum válido (real da rede)

test('envio EAVM para destino E7 nativo credita o E7 exato', () => {
  const enc = encodeE7Dest(E7);
  assert.strictEqual(enc.length, 42);
  const raw = createSignedTx({ privateKey: PRIV, nonce: 0, to: enc, valueWei: 1_000_000_000_000_000_000n, chainId: CHAIN.EAVM_CHAIN_ID });
  const tx = buildEavmEnvelope(raw);
  assert.strictEqual(tx.to, E7);            // credita o E7 digitado, não o hash do 0x
  assert.strictEqual(verifyEavmEnvelope(tx), null); // verificação simétrica passa
});

test('checksum inválido não é tratado como E7 (cai na regra padrão)', () => {
  const bad = '0xe7000000f2906ea4b2cd23d20180c8e813f2d127'; // último byte alterado
  assert.strictEqual(decodeE7Dest(bad), null);
  const raw = createSignedTx({ privateKey: PRIV, nonce: 0, to: bad, valueWei: 1_000_000_000_000_000_000n, chainId: CHAIN.EAVM_CHAIN_ID });
  const tx = buildEavmEnvelope(raw);
  assert.strictEqual(tx.to, eavmToE7(bad)); // regra keccak→E7 padrão
  assert.strictEqual(verifyEavmEnvelope(tx), null);
});

test('envelope adulterado (to trocado) é rejeitado', () => {
  const raw = createSignedTx({ privateKey: PRIV, nonce: 0, to: encodeE7Dest(E7), valueWei: 1_000_000n * CHAIN.EAVM_WEI_PER_E7, chainId: CHAIN.EAVM_CHAIN_ID });
  const tx = buildEavmEnvelope(raw);
  const forged = { ...tx, to: 'E74FB9724ECC60AC0FF33CD1A5405FABD8' };
  assert.notStrictEqual(verifyEavmEnvelope(forged), null);
});
