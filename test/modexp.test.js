import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from '../src/eavm/host.js';

// Precompile 0x05 (MODEXP). Referências:
//  - EIP-198  (formato da entrada e vetores de exemplo)
//  - EIP-2565 (fórmula complexidade × iterações)
//  - EIP-7823 (Osaka: teto de 1024 bytes por operando)
//  - EIP-7883 (Osaka: piso 500, sem o /3, expoente longo ×16, complexidade ×2)
const MODEXP = '0x' + '0'.repeat(38) + '05';

// mundo mínimo: o caminho de precompile só usa snapshot/revert (e moveValue se value>0)
function makeWorld() {
  return {
    getStorage: () => 0n, setStorage: () => {}, getCode: () => Buffer.alloc(0),
    getBalance: () => 0n, moveValue: () => true, bumpNonce: () => 0,
    snapshot: () => ({}), revert: () => {},
  };
}

// chama 0x05 e devolve { success, out (hex), gasUsed }
function modexp(input, gas = 10n ** 12n) { // teto folgado: operandos de 1024 bytes chegam a ~520M de gás
  const host = createHost(makeWorld());
  const r = host.call({
    kind: 0xf1, caller: '0x' + 'ee'.repeat(20), to: MODEXP, value: 0n,
    input, gas, static: false, delegate: false,
    execAddress: MODEXP, execCaller: '0x' + 'ee'.repeat(20), execValue: 0n,
    codeAddr: MODEXP, depth: 1, block: {},
  });
  return { success: r.success, out: r.returnData.toString('hex'), gasUsed: r.gasUsed };
}

const u256 = (n) => BigInt(n).toString(16).padStart(64, '0');
// monta a entrada: 3 comprimentos de 32 bytes + base ‖ exp ‖ mod (hex já dimensionados)
const build = (bl, el, ml, baseHex, expHex, modHex) =>
  Buffer.from(u256(bl) + u256(el) + u256(ml) + baseHex + expHex + modHex, 'hex');

// Transcrição direta do pseudocódigo do EIP-7883 — o oráculo independente da
// implementação. Se os dois divergirem, um dos lados está errado.
function gasSpec(baseLen, expLen, modLen, expHead) {
  const maxLength = Math.max(baseLen, modLen);
  const words = Math.ceil(maxLength / 8);
  const multiplicationComplexity = maxLength > 32 ? 2 * words ** 2 : 16;
  let iterationCount;
  if (expLen <= 32 && expHead === 0n) iterationCount = 0;
  else if (expLen <= 32) iterationCount = expHead.toString(2).length - 1;
  else iterationCount = 16 * (expLen - 32) + Math.max(0, (expHead === 0n ? 0 : expHead.toString(2).length) - 1);
  iterationCount = Math.max(iterationCount, 1);
  return BigInt(Math.max(500, multiplicationComplexity * iterationCount));
}

const P = 'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f'; // p da secp256k1

test('EIP-198 vetor 1: 3^(p-2) mod p = 1 (inverso modular de Fermat)', () => {
  const r = modexp(build(1, 32, 32, '03', 'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2e', P));
  assert.equal(r.success, true);
  assert.equal(r.out, u256(1));
  // EIP-7883: max(bl,ml)=32 → complexidade 16; expoente de 256 bits → 255 iterações.
  // 16 × 255 = 4080. (Sob o EIP-2565 eram 1360 = 4080/3 — o /3 foi removido.)
  assert.equal(r.gasUsed, 4080n);
  assert.equal(r.gasUsed, gasSpec(1, 32, 32, BigInt('0x' + 'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2e')));
});

test('EIP-198 vetor 2: expoente 0 → resultado 1, cobrando o piso de 500', () => {
  const r = modexp(build(1, 32, 32, '03', u256(0), P));
  assert.equal(r.success, true);
  assert.equal(r.out, u256(1)); // 3^0 mod p = 1
  // iterações = max(0, 1) = 1 → 16 × 1 = 16, abaixo do piso → 500 (era 200 no 2565)
  assert.equal(r.gasUsed, 500n);
});

test('módulo 0 → saída de `mod_len` bytes zerados (sem divisão por zero)', () => {
  const r = modexp(build(1, 1, 32, '03', '05', u256(0)));
  assert.equal(r.success, true);
  assert.equal(r.out, u256(0));
});

test('base_len = 0 e mod_len = 0 → saída vazia', () => {
  const r = modexp(build(0, 1, 0, '', '05', ''));
  assert.equal(r.success, true);
  assert.equal(r.out, '');
  assert.equal(r.gasUsed, 500n);
});

test('entrada truncada é zero-preenchida à direita (semântica do EIP-198)', () => {
  // declara 32 bytes de base/exp/mod mas fornece só alguns — o resto é zero
  const r = modexp(Buffer.from(u256(1) + u256(1) + u256(1) + '05' + '02', 'hex'));
  assert.equal(r.success, true);
  assert.equal(r.out, '00'); // mod = 0 (ausente) → 1 byte zerado
});

test('EIP-7883: expoente longo é cobrado pelo COMPRIMENTO, não pelo valor', () => {
  // 1024 bytes de expoente TODO ZERADO: sob a fórmula antiga (bits do expoente
  // inteiro) isso custava o piso; o EIP-7883 cobra 16 por byte além de 32.
  const el = 1024;
  const r = modexp(build(32, el, 32, u256(3), '00'.repeat(el), P));
  assert.equal(r.success, true);
  assert.equal(r.gasUsed, gasSpec(32, el, 32, 0n));
  assert.equal(r.gasUsed, 253_952n); // 16 (complexidade) × 15872 (iterações)
});

test('EIP-7883: base/módulo acima de 32 bytes dobram a complexidade (2·words²)', () => {
  // ml = 64 → words = 8 → complexidade = 2 × 64 = 128 (o 2565 daria 64)
  const mod64 = 'ff'.repeat(63) + 'fd';
  const r = modexp(build(1, 1, 64, '03', '03', mod64));
  assert.equal(r.success, true);
  // expoente 0x03 → bitLen 2 → 1 iteração → 128 × 1 = 128 < 500 → piso
  assert.equal(r.gasUsed, 500n);
  assert.equal(r.gasUsed, gasSpec(1, 1, 64, 3n));
});

test('EIP-7883: gás bate com o pseudocódigo do EIP em uma tabela de casos', () => {
  const casos = [
    [1, 1, 1, '03', '05', '07'],
    [32, 32, 32, u256(3), u256(0xffffffff), P],
    [64, 32, 64, 'ab'.repeat(64), u256(2n ** 255n), 'ff'.repeat(63) + 'fd'],
    [128, 40, 128, '01'.repeat(128), 'ff'.repeat(40), 'ff'.repeat(127) + 'fd'],
    // teto do EIP-7823 em todos os operandos: 2·128² × (16·992 + 0) = 520.093.696 de gás
    [1024, 1024, 1024, '02'.repeat(1024), '00'.repeat(1024), 'ff'.repeat(1023) + 'fd'],
  ];
  for (const [bl, el, ml, b, e, m] of casos) {
    const r = modexp(build(bl, el, ml, b, e, m));
    const expHead = BigInt('0x' + e.slice(0, 64).padEnd(Math.min(el, 32) * 2, '0'));
    assert.equal(r.success, true, `caso ${bl}/${el}/${ml}`);
    assert.equal(r.gasUsed, gasSpec(bl, el, ml, expHead), `gás do caso ${bl}/${el}/${ml}`);
  }
});

test('EIP-7823: operando acima de 1024 bytes é rejeitado e consome TODO o gás', () => {
  for (const [bl, el, ml] of [[1025, 1, 1], [1, 1025, 1], [1, 1, 1025], [4096, 4096, 4096]]) {
    const input = Buffer.from(u256(bl) + u256(el) + u256(ml), 'hex'); // corpo ausente = zeros
    const r = modexp(input, 5_000_000n);
    assert.equal(r.success, false, `${bl}/${el}/${ml} deveria ser rejeitado`);
    assert.equal(r.gasUsed, 5_000_000n, 'erro do EIP-7823 consome todo o gás');
  }
});

test('EIP-7823: comprimento gigante (não cabe em Number) também é rejeitado', () => {
  const r = modexp(Buffer.from(u256(2n ** 200n) + u256(1) + u256(1), 'hex'), 5_000_000n);
  assert.equal(r.success, false);
  assert.equal(r.gasUsed, 5_000_000n);
});

test('EIP-7823: exatamente 1024 bytes é aceito (o teto é inclusivo)', () => {
  const r = modexp(build(1024, 1, 1024, '02'.repeat(1024), '03', 'ff'.repeat(1023) + 'fd'));
  assert.equal(r.success, true);
  assert.equal(r.out.length, 1024 * 2);
});

test('A-5: sem gás suficiente o precompile falha SEM computar', () => {
  // 1024 bytes de expoente custam 253.952+; com 1.000 de gás o host recusa antes
  // de rodar o laço (o custo é cotado só a partir dos comprimentos e da cabeça).
  const el = 1024;
  const t0 = process.hrtime.bigint();
  const r = modexp(build(1024, el, 1024, '02'.repeat(1024), 'ff'.repeat(el), 'ff'.repeat(1023) + 'fd'), 1_000n);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r.success, false);
  assert.equal(r.gasUsed, 1_000n);
  assert.ok(ms < 200, `deveria recusar de imediato, levou ${ms}ms`);
});

test('resultado bate com a exponenciação modular de referência do BigInt', () => {
  const ref = (b, e, m) => { let r = 1n, x = b % m; while (e > 0n) { if (e & 1n) r = (r * x) % m; x = (x * x) % m; e >>= 1n; } return r; };
  const base = 0x1234567890abcdefn, exp = 0xdeadbeefn, mod = BigInt('0x' + P);
  const r = modexp(build(8, 4, 32, base.toString(16).padStart(16, '0'), exp.toString(16).padStart(8, '0'), P));
  assert.equal(r.success, true);
  assert.equal(BigInt('0x' + r.out), ref(base, exp, mod));
});
