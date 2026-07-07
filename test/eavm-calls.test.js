import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createHost } from '../src/eavm/host.js';
import { keccak256 } from '../src/eavm/keccak.js';
import { sign, publicKeyFromPrivate, ethAddressFromPoint } from '../src/eavm/secp256k1.js';

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const slot0 = '0x' + '0'.repeat(64);
const A = '0x' + 'aa'.repeat(20);
const B = '0x' + 'bb'.repeat(20);
const EOA = '0x' + 'ee'.repeat(20);

// mundo em memória com snapshot/revert por deep-copy (isolamento de sub-chamadas)
function makeWorld() {
  const W = { contracts: {}, balances: {}, nonces: {} };
  const get = (a) => (W.contracts[a] ??= { code: '', storage: {} });
  const clone = () => ({
    contracts: Object.fromEntries(Object.entries(W.contracts).map(([a, c]) => [a, { code: c.code, storage: { ...c.storage } }])),
    balances: { ...W.balances }, nonces: { ...W.nonces },
  });
  return {
    setCode: (a, h) => { get(a).code = h; },
    getCode: (a) => Buffer.from((W.contracts[a]?.code ?? '').replace(/^0x/, ''), 'hex'),
    putCode: (a, buf) => { get(a).code = '0x' + Buffer.from(buf).toString('hex'); },
    getStorage: (a, k) => BigInt(W.contracts[a]?.storage[k] ?? 0n),
    setStorage: (a, k, v) => { const s = get(a).storage; if (v === 0n) delete s[k]; else s[k] = '0x' + v.toString(16); },
    getBalance: (a) => W.balances[a] ?? 0n,
    addBalance: (a, d) => { W.balances[a] = (W.balances[a] ?? 0n) + d; },
    bumpNonce: (a) => { const n = W.nonces[a] ?? 0; W.nonces[a] = n + 1; return n; },
    createAddress: (s, n) => '0x' + keccak256(Buffer.from(s + ':' + n)).subarray(12).toString('hex'),
    create2Address: (s, salt, init) => '0x' + keccak256(Buffer.concat([Buffer.from(s.slice(2), 'hex'), Buffer.from(salt.toString(16).padStart(64, '0'), 'hex'), keccak256(init)])).subarray(12).toString('hex'),
    snapshot: () => clone(),
    revert: (snap) => { W.contracts = snap.contracts; W.balances = snap.balances; W.nonces = snap.nonces; },
    _W: W,
  };
}

test('EAVM 2.2: CALL entre contratos — A grava o CALLER (que é o contrato B)', () => {
  const world = makeWorld();
  world.setCode(A, '3360005500'); // CALLER, PUSH1 0, SSTORE, STOP
  // B: CALL(g, A, 0, 0,0, 0,0) STOP
  world.setCode(B, '6000600060006000600073' + 'aa'.repeat(20) + '61ffff' + 'f1' + '00');
  const host = createHost(world);
  const r = host.call({ kind: 0xf1, caller: EOA, to: B, value: 0n, input: Buffer.alloc(0), gas: 1_000_000n, static: false, delegate: false, execAddress: B, execCaller: EOA, execValue: 0n, codeAddr: B, depth: 1, block: {} });
  assert.equal(r.success, true);
  // A guardou o endereço de B como caller
  assert.equal(world.getStorage(A, slot0), BigInt(B));
});

test('EAVM 2.2: reversão isolada — SSTORE seguido de REVERT não persiste', () => {
  const world = makeWorld();
  world.setCode(A, '6001600055 60006000fd'.replace(/\s/g, '')); // PUSH1 1, PUSH1 0, SSTORE, PUSH1 0, PUSH1 0, REVERT
  const host = createHost(world);
  const r = host.call({ kind: 0xf1, caller: EOA, to: A, value: 0n, input: Buffer.alloc(0), gas: 1_000_000n, static: false, delegate: false, execAddress: A, execCaller: EOA, execValue: 0n, codeAddr: A, depth: 1, block: {} });
  assert.equal(r.success, false);
  assert.equal(world.getStorage(A, slot0), 0n); // mudança revertida
});

test('EAVM 2.2: CREATE publica um contrato filho e retorna o endereço', () => {
  const world = makeWorld();
  const runtime = '6000546001018060005560005260206000f3'; // contador
  const init = '6012600c60003960126000f3' + runtime;
  const host = createHost(world);
  const r = host.create({ caller: EOA, value: 0n, initCode: hex(init), gas: 1_000_000n, salt: null, depth: 1, block: {} });
  assert.equal(r.success, true);
  assert.equal(world.getCode(r.address).toString('hex'), runtime); // runtime publicado
});

test('EAVM 2.2: precompile identity (0x04) devolve o input', () => {
  const world = makeWorld();
  const host = createHost(world);
  const input = Buffer.from('deadbeefcafe', 'hex');
  const r = host.call({ kind: 0xfa, caller: EOA, to: '0x' + '00'.repeat(19) + '04', value: 0n, input, gas: 100000n, static: true, delegate: false, execAddress: '0x' + '00'.repeat(19) + '04', execCaller: EOA, execValue: 0n, codeAddr: '0x' + '00'.repeat(19) + '04', depth: 1, block: {} });
  assert.equal(r.success, true);
  assert.equal(r.returnData.toString('hex'), 'deadbeefcafe');
});

test('EAVM 2.2: precompile sha256 (0x02) bate com o node:crypto', () => {
  const world = makeWorld();
  const host = createHost(world);
  const input = Buffer.from('EAV7', 'utf8');
  const r = host.call({ kind: 0xfa, caller: EOA, to: '0x' + '00'.repeat(19) + '02', value: 0n, input, gas: 100000n, static: true, delegate: false, execAddress: '0x' + '00'.repeat(19) + '02', execCaller: EOA, execValue: 0n, codeAddr: '0x' + '00'.repeat(19) + '02', depth: 1, block: {} });
  assert.equal(r.returnData.toString('hex'), crypto.createHash('sha256').update(input).digest('hex'));
});

test('EAVM 2.2: CALL respeita o limite de gás pedido (correção A-1)', () => {
  const runA = '600160005500'; // PUSH1 1, PUSH1 0, SSTORE (2000 gás), STOP
  const bCode = (gas4) => '6000600060006000600073' + 'aa'.repeat(20) + '61' + gas4 + 'f160005260206000f3';
  const callWith = (gas4) => {
    const world = makeWorld();
    world.setCode(A, runA);
    world.setCode(B, bCode(gas4));
    const host = createHost(world);
    const r = host.call({ kind: 0xf1, caller: EOA, to: B, value: 0n, input: Buffer.alloc(0), gas: 1_000_000n, static: false, delegate: false, execAddress: B, execCaller: EOA, execValue: 0n, codeAddr: B, depth: 1, block: {} });
    return r.returnData.length ? BigInt('0x' + r.returnData.toString('hex')) : 0n;
  };
  assert.equal(callWith('ffff'), 1n); // gás amplo (65535) => A sucede => CALL retorna 1
  assert.equal(callWith('0001'), 0n); // gás pedido = 1 => A sem gás => CALL retorna 0 (limite respeitado)
});

test('EAVM 2.2: precompile ecrecover (0x01) recupera o endereço do assinante (correção B-2)', () => {
  const host = createHost(makeWorld());
  const priv = 0x1234567890abcdef1234567890abcdefn;
  const msgHash = keccak256(Buffer.from('EAV7 assina', 'utf8'));
  const { r, s, recId } = sign(msgHash, priv);
  const b32 = (x) => Buffer.from(x.toString(16).padStart(64, '0'), 'hex');
  const input = Buffer.concat([msgHash, b32(BigInt(27 + Number(recId))), b32(r), b32(s)]);
  const P = '0x' + '00'.repeat(19) + '01';
  const rr = host.call({ kind: 0xfa, caller: EOA, to: P, value: 0n, input, gas: 2_000_000n, static: true, delegate: false, execAddress: P, execCaller: EOA, execValue: 0n, codeAddr: P, depth: 1, block: {} });
  const esperado = ethAddressFromPoint(publicKeyFromPrivate(priv)).slice(2); // 40 hex
  assert.equal(rr.returnData.subarray(12).toString('hex'), esperado);
});

test('EAVM 2.2: logs de sub-chamada chegam ao recibo; de sub-chamada revertida, não (correção H-1)', () => {
  const C = '0x' + 'cc'.repeat(20);
  const emit = '60006000a000';           // LOG0 vazio, STOP
  const emitRevert = '60006000a060006000fd'; // LOG0, REVERT
  const caller = (target) => '6000600060006000600073' + target.slice(2) + '61ffff' + 'f1' + '00'; // CALL(target), STOP
  const entry = (b) => ({ kind: 0xf1, caller: EOA, to: b, value: 0n, input: Buffer.alloc(0), gas: 1_000_000n, static: false, delegate: false, execAddress: b, execCaller: EOA, execValue: 0n, codeAddr: b, depth: 1, block: {} });

  // sucesso: B chama A (que emite) => o log de A aparece no recibo
  let world = makeWorld(); world.setCode(A, emit); world.setCode(B, caller(A));
  let r = createHost(world).call(entry(B));
  assert.equal(r.logs.length, 1);
  assert.equal(r.logs[0].address.toLowerCase(), A.toLowerCase());

  // revertida: B chama C (que emite e reverte) => nenhum log vaza
  world = makeWorld(); world.setCode(C, emitRevert); world.setCode(B, caller(C));
  r = createHost(world).call(entry(B));
  assert.equal(r.logs.length, 0);
});

test('EAVM 2.2: transferência de valor no CALL move saldo entre contas', () => {
  const world = makeWorld();
  world.setCode(A, '00'); // STOP (aceita valor)
  world.addBalance(EOA, 1000n);
  const host = createHost(world);
  const r = host.call({ kind: 0xf1, caller: EOA, to: A, value: 300n, input: Buffer.alloc(0), gas: 100000n, static: false, delegate: false, execAddress: A, execCaller: EOA, execValue: 300n, codeAddr: A, depth: 1, block: {} });
  assert.equal(r.success, true);
  assert.equal(world.getBalance(EOA), 700n);
  assert.equal(world.getBalance(A), 300n);
});
