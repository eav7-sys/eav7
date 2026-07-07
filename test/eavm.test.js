import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress, isValidAddress } from '../src/crypto/keys.js';
import { Blockchain } from '../src/core/blockchain.js';
import { buildTransaction, verifyTransaction } from '../src/core/transaction.js';
import { keccak256 } from '../src/eavm/keccak.js';
import {
  sign, recover, verify, publicKeyFromPrivate, ethAddressFromPoint, bufToBig,
} from '../src/eavm/secp256k1.js';
import { rlpEncode, rlpDecode } from '../src/eavm/rlp.js';
import { decodeRawTransaction, createSignedTx } from '../src/eavm/tx.js';
import { buildEavmEnvelope, verifyEavmEnvelope, eavmToE7, EAVM_STAKE_ADDRESS } from '../src/eavm/envelope.js';

const newEavmKey = () => (bufToBig(randomBytes(32)) % (2n ** 250n)) + 1n;

test('keccak-256 próprio: vetores conhecidos', () => {
  assert.equal(
    keccak256('').toString('hex'),
    'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  );
  assert.equal(
    keccak256('abc').toString('hex'),
    '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  );
});

test('secp256k1 próprio: sign -> recover -> verify roundtrip', () => {
  const priv = newEavmKey();
  const pub = publicKeyFromPrivate(priv);
  const hash = randomBytes(32);
  const { r, s, recId } = sign(hash, priv);
  assert.ok(verify(hash, r, s, pub));
  const recovered = recover(hash, r, s, recId);
  assert.equal(recovered.x, pub.x);
  assert.equal(recovered.y, pub.y);
});

test('RLP próprio: roundtrip e canonicidade', () => {
  const encoded = rlpEncode([1n, '0xdeadbeef', [Buffer.from('eav7'), 0n]]);
  const decoded = rlpDecode(encoded);
  assert.equal(decoded[1].toString('hex'), 'deadbeef');
  assert.equal(decoded[2][0].toString(), 'eav7');
  assert.equal(rlpEncode('0x7f').toString('hex'), '7f');
  assert.equal(rlpEncode('0x80').toString('hex'), '8180');
  assert.throws(() => rlpDecode(Buffer.from('8100', 'hex'))); // não canônico
});

test('transação EAVM: decodificação recupera o remetente correto', () => {
  const priv = newEavmKey();
  const from = ethAddressFromPoint(publicKeyFromPrivate(priv));
  const to = '0x' + randomBytes(20).toString('hex');
  const raw = createSignedTx({
    privateKey: priv,
    nonce: 0,
    to,
    valueWei: 1_500_000n * CHAIN.EAVM_WEI_PER_E7, // 1.5 EAV7
    chainId: CHAIN.EAVM_CHAIN_ID,
  });
  const parsed = decodeRawTransaction(raw);
  assert.equal(parsed.from, from);
  assert.equal(parsed.to, to);
  assert.equal(parsed.chainId, BigInt(CHAIN.EAVM_CHAIN_ID));
  assert.equal(parsed.value / CHAIN.EAVM_WEI_PER_E7, 1_500_000n);
});

test('envelope EAVM: válido passa, adulterado e chainId errado falham', () => {
  const priv = newEavmKey();
  const to = '0x' + randomBytes(20).toString('hex');
  const raw = createSignedTx({
    privateKey: priv, nonce: 0, to,
    valueWei: 2n * 10n ** 18n, chainId: CHAIN.EAVM_CHAIN_ID,
  });
  const envelope = buildEavmEnvelope(raw);

  assert.equal(verifyEavmEnvelope(envelope), null);
  assert.equal(verifyTransaction(envelope), null); // roteia pela validação EAVM
  assert.ok(isValidAddress(envelope.from));
  assert.ok(envelope.id.startsWith('E7'));

  // adulterar o destinatário ou o valor é detectado
  assert.match(verifyEavmEnvelope({ ...envelope, to: eavmToE7('0x' + 'a'.repeat(40)) }), /to não corresponde/);
  assert.match(verifyEavmEnvelope({ ...envelope, amount: '999' }), /amount/);

  // chainId de outra rede é rejeitado (proteção contra replay entre redes)
  const alheio = createSignedTx({ privateKey: priv, nonce: 0, to, valueWei: 10n ** 18n, chainId: 1 });
  assert.throws(() => buildEavmEnvelope(alheio), /chainId/);
});

test('EAVM: operação nativa STAKE via endereço de sistema', () => {
  const validador = generateKeyPair();
  const chain = new Blockchain();
  const t0 = Date.now() - 60_000;
  chain.createGenesis({ address: walletAddress(validador), timestamp: t0 });

  // conta EAVM fundeada
  const priv = newEavmKey();
  const evmFrom = ethAddressFromPoint(publicKeyFromPrivate(priv));
  const mapeado = eavmToE7(evmFrom);
  chain.produceBlock(validador, [buildTransaction(validador, {
    type: 'TRANSFER', to: mapeado, amount: 2_000n * CHAIN.UNIT, nonce: 1,
  })], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });

  // a carteira assina uma tx para o endereço de sistema de STAKE (1.000 EAV7)
  const raw = createSignedTx({
    privateKey: priv, nonce: 0, to: EAVM_STAKE_ADDRESS,
    valueWei: 1_000n * 10n ** 18n, chainId: CHAIN.EAVM_CHAIN_ID,
  });
  const env = buildEavmEnvelope(raw, { state: chain.state });
  assert.equal(env.type, 'STAKE');
  assert.equal(env.to, null);
  assert.equal(verifyEavmEnvelope(env), null);

  chain.produceBlock(validador, [env], { timestamp: t0 + 2 * CHAIN.BLOCK_TIME_MS });
  assert.equal(chain.state.accounts[mapeado].staked, 1_000n * CHAIN.UNIT);
  assert.equal(chain.state.isFeeExempt(mapeado), true); // >= 100 EAV7 => sem taxas
  // conta EAVM (sem chave híbrida) NÃO entra no conjunto de validadores, mesmo
  // com stake >= 1.000 — não conseguiria assinar blocos (correção da auditoria)
  assert.equal(chain.state.validators().some((v) => v.address === mapeado), false);
  assert.equal(chain.state.accounts[mapeado].eavmManaged, true);
});

test('fim a fim: carteira -> RPC EAVM -> bloco minerado com escala 10^12', () => {
  const validador = generateKeyPair();
  const chain = new Blockchain();
  const t0 = Date.now() - 60_000;
  chain.createGenesis({ address: walletAddress(validador), timestamp: t0 });

  // conta EAVM recebe fundos do validador no endereço E7 mapeado
  const priv = newEavmKey();
  const eavmFrom = ethAddressFromPoint(publicKeyFromPrivate(priv));
  const mapeado = eavmToE7(eavmFrom);
  const financia = buildTransaction(validador, {
    type: 'TRANSFER', to: mapeado, amount: 10n * CHAIN.UNIT, nonce: 1,
  });
  chain.produceBlock(validador, [financia], { timestamp: t0 + CHAIN.BLOCK_TIME_MS });
  assert.equal(chain.state.balanceOf(mapeado), 10n * CHAIN.UNIT);

  // a carteira assina uma transferência de 3 EAV7 (3e18 na escala da carteira)
  const eavmTo = '0x' + randomBytes(20).toString('hex');
  const raw = createSignedTx({
    privateKey: priv, nonce: 0, to: eavmTo,
    valueWei: 3n * 10n ** 18n, chainId: CHAIN.EAVM_CHAIN_ID,
  });
  const envelope = buildEavmEnvelope(raw, { state: chain.state });
  chain.produceBlock(validador, [envelope], { timestamp: t0 + 2 * CHAIN.BLOCK_TIME_MS });

  assert.equal(chain.state.balanceOf(eavmToE7(eavmTo)), 3n * CHAIN.UNIT);
  // energia grátis cobre o EAVM_TRANSFER (custo 1 de 10) => nada queimado
  assert.equal(
    chain.state.balanceOf(mapeado),
    10n * CHAIN.UNIT - 3n * CHAIN.UNIT,
  );

  // replay do mesmo raw é bloqueado (mesmo id -> duplicada)
  assert.throws(
    () => chain.produceBlock(validador, [buildEavmEnvelope(raw, { state: chain.state })], { timestamp: t0 + 3 * CHAIN.BLOCK_TIME_MS }),
    /nonce|duplicada/,
  );
});
