import test from 'node:test';
import assert from 'node:assert/strict';
import { runEavm, EavmError } from '../src/eavm/vm.js';

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const run = (code, opts = {}) => runEavm({ code: hex(code), gas: 1_000_000, ...opts });
const retBig = (r) => (r.returnData.length ? BigInt('0x' + r.returnData.toString('hex')) : 0n);

test('EAVM: aritmética + MSTORE + RETURN (3 + 2 = 5)', () => {
  // PUSH1 3, PUSH1 2, ADD, PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN
  const r = run('6003 6002 01 6000 52 6020 6000 f3');
  assert.equal(r.success, true);
  assert.equal(retBig(r), 5n);
  assert.ok(r.gasUsed > 0n);
});

test('EAVM: SSTORE persiste e SLOAD lê de volta (storage)', () => {
  // PUSH1 42, PUSH1 1, SSTORE; PUSH1 1, SLOAD, PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN
  const r = run('602a 6001 55 6001 54 6000 52 6020 6000 f3');
  assert.equal(r.success, true);
  assert.equal(retBig(r), 42n);
  assert.equal(r.storage['0x' + '0'.repeat(63) + '1'], '0x' + '0'.repeat(62) + '2a');
});

test('EAVM: KECCAK256 do vazio bate com o valor conhecido', () => {
  // PUSH1 0, PUSH1 0, KECCAK256, PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN
  const r = run('6000 6000 20 6000 52 6020 6000 f3');
  assert.equal(r.returnData.toString('hex'), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
});

test('EAVM: CALLDATALOAD lê os argumentos da chamada', () => {
  const calldata = Buffer.from('07'.padStart(64, '0'), 'hex'); // 32 bytes = 7
  // PUSH1 0, CALLDATALOAD, PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN
  const r = run('6000 35 6000 52 6020 6000 f3', { calldata });
  assert.equal(retBig(r), 7n);
});

test('EAVM: JUMPI desvia o fluxo (condicional)', () => {
  // PUSH1 1, PUSH1 7, JUMPI, PUSH1 0xAA, ... (pulado); dest 7: JUMPDEST, PUSH1 0xBB, PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN
  const r = run('6001 6007 57 60aa 5b 60bb 6000 52 6020 6000 f3');
  assert.equal(retBig(r), 0xbbn); // desviou para o JUMPDEST, ignorou o 0xAA
});

test('EAVM: REVERT retorna success=false', () => {
  const r = run('6000 6000 fd'); // PUSH1 0, PUSH1 0, REVERT
  assert.equal(r.success, false);
});

test('EAVM: sem gás (energia insuficiente) lança e reverte', () => {
  assert.throws(() => runEavm({ code: hex('6003 6002 01 6000 52 6020 6000 f3'), gas: 5 }), EavmError);
});

test('EAVM: JUMP para destino inválido é rejeitado (não pode cair em dados de PUSH)', () => {
  // PUSH1 1 (dado 0x01 no offset 1), PUSH1 1, JUMP -> destino 1 está DENTRO do PUSH => inválido
  assert.throws(() => run('6001 6001 56'), EavmError);
});

test('EAVM: contrato de contador — incrementa storage a cada chamada', () => {
  // runtime: SLOAD(0) + 1 -> SSTORE(0); retorna o novo valor
  // PUSH1 0, SLOAD, PUSH1 1, ADD, DUP1, PUSH1 0, SSTORE, PUSH1 0, MSTORE, PUSH1 32, PUSH1 0, RETURN
  const code = hex('6000 54 6001 01 80 6000 55 6000 52 6020 6000 f3');
  const storage = {};
  const r1 = runEavm({ code, gas: 1_000_000, storage });
  assert.equal(retBig(r1), 1n);
  const r2 = runEavm({ code, gas: 1_000_000, storage: r1.storage });
  assert.equal(retBig(r2), 2n); // o estado persiste entre chamadas
  const r3 = runEavm({ code, gas: 1_000_000, storage: r2.storage });
  assert.equal(retBig(r3), 3n);
});
