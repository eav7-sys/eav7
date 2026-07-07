import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { eavHash, isValidHash, merkleRoot } from '../src/crypto/hash.js';
import {
  generateKeyPair,
  walletAddress,
  isValidAddress,
  hybridSign,
  hybridVerify,
} from '../src/crypto/keys.js';
import { buildTransaction, verifyTransaction } from '../src/core/transaction.js';

test('endereços E7: formato de 34 caracteres com checksum', () => {
  const wallet = generateKeyPair();
  const address = walletAddress(wallet);
  assert.equal(address.length, CHAIN.ADDRESS_LENGTH);
  assert.ok(address.startsWith('E7'));
  assert.ok(isValidAddress(address));

  // adulterar qualquer caractere quebra o checksum
  const tampered = address.slice(0, 10) + (address[10] === 'A' ? 'B' : 'A') + address.slice(11);
  assert.equal(isValidAddress(tampered), false);
  assert.equal(isValidAddress('T' + address.slice(1)), false);
  assert.equal(isValidAddress('E7ABC'), false);
});

test('hashes eav20: 64 caracteres (padrão Tron), sempre iniciando com E7', () => {
  const hash = eavHash('eav7');
  assert.equal(hash.length, CHAIN.HASH_LENGTH);
  assert.ok(hash.startsWith('E7'));
  assert.ok(isValidHash(hash));
  assert.equal(hash, eavHash('eav7')); // determinística
  assert.notEqual(hash, eavHash('eav8'));

  const root = merkleRoot([eavHash('a'), eavHash('b'), eavHash('c')]);
  assert.ok(isValidHash(root));
});

test('assinatura híbrida pós-quântica (eav7-hybrid-1): exige as duas assinaturas', () => {
  const wallet = generateKeyPair();
  const outra = generateKeyPair();
  const payload = 'mensagem-eav7';
  const { signature, pqSignature } = hybridSign(wallet, payload);

  assert.ok(hybridVerify({
    publicKeyPem: wallet.publicKeyPem,
    pqPublicKeyPem: wallet.pqPublicKeyPem,
    payload, signature, pqSignature,
  }));
  // payload alterado falha
  assert.equal(hybridVerify({
    publicKeyPem: wallet.publicKeyPem,
    pqPublicKeyPem: wallet.pqPublicKeyPem,
    payload: 'outra', signature, pqSignature,
  }), false);
  // trocar só a assinatura pós-quântica por outra carteira falha
  const alheia = hybridSign(outra, payload);
  assert.equal(hybridVerify({
    publicKeyPem: wallet.publicKeyPem,
    pqPublicKeyPem: wallet.pqPublicKeyPem,
    payload, signature, pqSignature: alheia.pqSignature,
  }), false);
});

test('transações: build/verify íntegras, adulteração detectada', () => {
  const wallet = generateKeyPair();
  const destino = walletAddress(generateKeyPair());
  const tx = buildTransaction(wallet, { type: 'TRANSFER', to: destino, amount: 123n, nonce: 1 });

  assert.ok(tx.id.startsWith('E7'));
  assert.equal(tx.id.length, CHAIN.HASH_LENGTH);
  assert.equal(verifyTransaction(tx), null);

  assert.match(verifyTransaction({ ...tx, amount: '999' }), /assinatura|id/);
  assert.match(verifyTransaction({ ...tx, to: walletAddress(generateKeyPair()) }), /assinatura|id/);
  assert.match(verifyTransaction({ ...tx, pqSignature: undefined }), /assinaturas ausentes/);
  // fee agora é um LIMITE (não a tabela), mas continua no payload assinado —
  // adulterá-la quebra a assinatura/id (é detectado).
  assert.match(verifyTransaction({ ...tx, fee: '123456' }), /assinatura|id/);
});
