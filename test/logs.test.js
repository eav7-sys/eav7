// Testes do índice de eventos/logs do EAVM (#33).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { buildTransaction } from '../src/core/transaction.js';
import { keccak256 } from '../src/eavm/keccak.js';

// runtime: LOG1 com topic 0x42 e data vazio, depois STOP.
const RUNTIME = '604260006000a100';
// init: copia 8 bytes (0x08) do offset 0x0c e retorna como código de runtime.
const INIT = '6008600c60003960086000f3' + RUNTIME;
const eavmForm = (a) => '0x' + keccak256(Buffer.from(String(a))).subarray(12).toString('hex');
const createAddr = (s, n) => '0x' + keccak256(Buffer.from(s + ':' + n)).subarray(12).toString('hex');

test('#33 logs: uma EAVM_CALL que emite LOG entrega o evento ao sink', () => {
  const w = generateKeyPair(); const addr = walletAddress(w);
  const state = new State();
  state.getAccount(addr).balance = 1000n * CHAIN.UNIT;
  state.getAccount(addr).staked = 1000n * CHAIN.UNIT; // energia p/ execução

  state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + INIT } }), 1);
  const contract = createAddr(eavmForm(addr), 0);
  assert.ok(state.contracts[contract], 'contrato deployado');

  const call = buildTransaction(w, { type: 'EAVM_CALL', amount: 0, nonce: 2, data: { to: contract, input: '0x' } });
  const logs = [];
  state.applyTransaction(call, 1, 0, (lg) => logs.push(lg));
  assert.equal(logs.length, 1, 'um evento emitido');
  assert.equal(logs[0].address, contract);
  assert.equal(logs[0].txId, call.id);
  assert.equal(logs[0].topics.length, 1);
  assert.equal(BigInt(logs[0].topics[0]), 0x42n, 'topic capturado');
});

test('#33 logs: sem sink, a execução segue normal (o índice é opcional/node-local)', () => {
  const w = generateKeyPair(); const addr = walletAddress(w);
  const state = new State();
  state.getAccount(addr).balance = 1000n * CHAIN.UNIT;
  state.getAccount(addr).staked = 1000n * CHAIN.UNIT;
  state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + INIT } }), 1);
  const contract = createAddr(eavmForm(addr), 0);
  // sem passar sink → não lança, contrato executa
  state.applyTransaction(buildTransaction(w, { type: 'EAVM_CALL', amount: 0, nonce: 2, data: { to: contract, input: '0x' } }), 1);
  assert.ok(state.contracts[contract]);
});
