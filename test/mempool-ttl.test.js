// Poda por idade no mempool (node-local, FORA do consenso).
//
// O nonce sequencial já protege contra replay em fork: um reorg reverte o nonce junto
// com o saldo. O que ele NÃO cobre é a tx de nonce-futuro que nunca executa — sem
// validade, ela fica residente para sempre, ocupa MAX_MEMPOOL e pode ser reintroduzida
// meses depois. A TRON resolve com `expiration` no payload (consenso); isto é a
// mitigação barata do mesmo problema, sem fork.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { Mempool } from '../src/core/mempool.js';
import { buildTransaction } from '../src/core/transaction.js';

function cenario() {
  const state = new State();
  const w = generateKeyPair();
  const addr = walletAddress(w);
  state.getAccount(addr).balance = 1_000n * CHAIN.UNIT;
  return { state, w, addr, pool: new Mempool() };
}

test('mempool: tx de nonce-futuro VENCIDA é podada', () => {
  const { state, w, pool } = cenario();
  const agora = Date.now();
  // nonce 50: nunca executa (lacuna), e assinada há mais tempo que o TTL
  const velha = buildTransaction(w, { type: 'TRANSFER', to: walletAddress(generateKeyPair()), amount: '1', nonce: 50, timestamp: agora - CHAIN.MEMPOOL_TTL_MS - 1 });
  pool.add(velha);
  assert.equal(pool.size, 1);

  pool.prune(state, agora);
  assert.equal(pool.size, 0, 'vencida foi removida mesmo com nonce nunca consumido');
});

test('mempool: tx de nonce-futuro RECENTE é preservada', () => {
  const { state, w, pool } = cenario();
  const agora = Date.now();
  const nova = buildTransaction(w, { type: 'TRANSFER', to: walletAddress(generateKeyPair()), amount: '1', nonce: 50, timestamp: agora - 1000 });
  pool.add(nova);
  pool.prune(state, agora);
  assert.equal(pool.size, 1, 'ainda dentro da validade — continua esperando as anteriores');
});

test('mempool: poda por nonce consumido continua funcionando', () => {
  const { state, w, addr, pool } = cenario();
  const agora = Date.now();
  const tx = buildTransaction(w, { type: 'TRANSFER', to: walletAddress(generateKeyPair()), amount: '1', nonce: 1, timestamp: agora });
  pool.add(tx);
  state.getAccount(addr).nonce = 1; // simula que já foi incluída
  pool.prune(state, agora);
  assert.equal(pool.size, 0);
});

test('mempool: spam de nonce-futuro não fica residente após o TTL', () => {
  const { state, w, pool } = cenario();
  const agora = Date.now();
  for (let i = 10; i < 60; i++) {
    pool.add(buildTransaction(w, { type: 'TRANSFER', to: walletAddress(generateKeyPair()), amount: '1', nonce: i, timestamp: agora - CHAIN.MEMPOOL_TTL_MS - 1 }));
  }
  assert.equal(pool.size, 50);
  pool.prune(state, agora);
  assert.equal(pool.size, 0, 'mempool devolvido ao operador');
});
