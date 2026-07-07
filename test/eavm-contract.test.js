import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAIN } from '../src/config.js';
import { generateKeyPair, walletAddress } from '../src/crypto/keys.js';
import { State } from '../src/core/state.js';
import { buildTransaction } from '../src/core/transaction.js';
import { keccak256 } from '../src/eavm/keccak.js';

const RUNTIME = '6000546001018060005560005260206000f3'; // contador
const INIT = '6012600c60003960126000f3' + RUNTIME;
const slot0 = '0x' + '0'.repeat(64);
// espelha o modelo de endereço do State (0x = keccak(E7)[12:]; contrato = keccak(sender0x:nonce)[12:])
const eavmForm = (a) => '0x' + keccak256(Buffer.from(String(a))).subarray(12).toString('hex');
const createAddr = (s, n) => '0x' + keccak256(Buffer.from(s + ':' + n)).subarray(12).toString('hex');

test('EAVM on-chain: EAVM_DEPLOY cria o contrato (mundo 0x) e EAVM_CALL incrementa o storage', () => {
  const w = generateKeyPair();
  const addr = walletAddress(w);
  const state = new State();
  state.getAccount(addr).balance = 1000n * CHAIN.UNIT;
  state.getAccount(addr).staked = 1000n * CHAIN.UNIT; // energia para custear a execução

  const deploy = buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 0, nonce: 1, data: { code: '0x' + INIT } });
  state.applyTransaction(deploy, 1);

  const contract = createAddr(eavmForm(addr), 0); // nonce da conta = 0 no deploy
  assert.ok(state.contracts[contract], 'contrato existe no mundo 0x');
  assert.equal(state.contracts[contract].code, '0x' + RUNTIME);

  for (let n = 2; n <= 4; n++) {
    state.applyTransaction(buildTransaction(w, { type: 'EAVM_CALL', amount: 0, nonce: n, data: { to: contract, input: '0x' } }), 1);
  }
  assert.equal(BigInt(state.contracts[contract].storage[slot0]), 3n);
  assert.equal(state.totalBurned, 0n); // conta stakeada => energia cobre => nada queimado
});

test('EAVM on-chain: valor (amount) é rejeitado nesta fase — non-payable (correção A-3)', () => {
  const w = generateKeyPair();
  const addr = walletAddress(w);
  const state = new State();
  state.getAccount(addr).balance = 100n * CHAIN.UNIT;
  state.getAccount(addr).staked = 1000n * CHAIN.UNIT;
  assert.throws(
    () => state.applyTransaction(buildTransaction(w, { type: 'EAVM_DEPLOY', amount: 5n * CHAIN.UNIT, nonce: 1, data: { code: '0x' + INIT } }), 1),
    /não aceita valor/,
  );
  // nada foi mutado (o supply nativo permanece intacto)
  assert.equal(state.balanceOf(addr), 100n * CHAIN.UNIT);
});

test('EAVM on-chain: chamada a endereço sem contrato é rejeitada', () => {
  const w = generateKeyPair();
  const addr = walletAddress(w);
  const state = new State();
  state.getAccount(addr).balance = 100n * CHAIN.UNIT;
  assert.throws(
    () => state.applyTransaction(buildTransaction(w, { type: 'EAVM_CALL', amount: 0, nonce: 1, data: { to: '0x' + '11'.repeat(20), input: '0x' } }), 1),
    /não é um contrato/,
  );
});
