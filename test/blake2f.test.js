import test from 'node:test';
import assert from 'node:assert/strict';
import { blake2f, compress } from '../src/eavm/blake2f.js';

// Vetores oficiais do EIP-152 ("Test Cases", vetores 0..8), copiados verbatim de
// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-152.md
// Os vetores 1..8 compartilham o mesmo corpo de 209 bytes (h/m/t/f do exemplo
// "abc" da RFC 7693); o que muda é o prefixo `rounds` e o byte final `f`.
const BODY =
  '48c9bdf267e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5' + // h[0..3]
  'd182e6ad7f520e511f6c3e2b8c68059b6bbd41fbabd9831f79217e1319cde05b' + // h[4..7]
  '6162630000000000000000000000000000000000000000000000000000000000' + // m: "abc" + zeros
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '0300000000000000' + // t0 = 3 (LE)
  '0000000000000000';  // t1 = 0 (LE)

const hex = (s) => Buffer.from(s, 'hex');
const vec = (rounds, f) => hex(rounds + BODY + f);

test('EIP-152 vetor 0: entrada vazia é rejeitada', () => {
  assert.throws(() => blake2f(Buffer.alloc(0)), /213 bytes/);
});

test('EIP-152 vetor 1: 212 bytes (rounds truncado para 3) é rejeitado', () => {
  const input = hex('00000c' + BODY + '01');
  assert.equal(input.length, 212);
  assert.throws(() => blake2f(input), /213 bytes/);
});

test('EIP-152 vetor 2: 214 bytes (rounds com 5 bytes) é rejeitado', () => {
  const input = hex('000000000c' + BODY + '01');
  assert.equal(input.length, 214);
  assert.throws(() => blake2f(input), /213 bytes/);
});

test('EIP-152 vetor 3: flag de bloco final = 2 é rejeitada', () => {
  const input = vec('0000000c', '02');
  assert.equal(input.length, 213);
  assert.throws(() => blake2f(input), /bloco final/);
});

test('EIP-152 vetor 4: rounds = 0 (nenhuma rodada, só o feed-forward)', () => {
  const input = vec('00000000', '01');
  const { gas, run } = blake2f(input);
  assert.equal(gas, 0n); // 1 gás por rodada × 0 rodadas
  assert.equal(
    run().toString('hex'),
    '08c9bcf367e6096a3ba7ca8485ae67bb2bf894fe72f36e3cf1361d5f3af54fa5' +
    'd282e6ad7f520e511f6c3e2b8c68059b9442be0454267ce079217e1319cde05b',
  );
});

test('EIP-152 vetor 5: rounds = 12, f = 1 (o BLAKE2b canônico de "abc")', () => {
  const { gas, run } = blake2f(vec('0000000c', '01'));
  assert.equal(gas, 12n);
  assert.equal(
    run().toString('hex'),
    'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1' +
    '7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
  );
});

test('EIP-152 vetor 6: rounds = 12, f = 0 (bloco não-final muda o resultado)', () => {
  const { gas, run } = blake2f(vec('0000000c', '00'));
  assert.equal(gas, 12n);
  assert.equal(
    run().toString('hex'),
    '75ab69d3190a562c51aef8d88f1c2775876944407270c42c9844252c26d28752' +
    '98743e7f6d5ea2f2d3e8d226039cd31b4e426ac4f2d3d666a610c2116fde4735',
  );
});

test('EIP-152 vetor 7: rounds = 1', () => {
  const { gas, run } = blake2f(vec('00000001', '01'));
  assert.equal(gas, 1n);
  assert.equal(
    run().toString('hex'),
    'b63a380cb2897d521994a85234ee2c181b5f844d2c624c002677e9703449d2fb' +
    'a551b3a8333bcdf5f2f7e08993d53923de3d64fcc68c034e717b9293fed7a421',
  );
});

test('EIP-152 vetor 8: rounds = 0xffffffff cobra 4.294.967.295 de gás', () => {
  // O vetor 8 é a defesa anti-DoS em pessoa: 4,29 bilhões de rodadas. Executá-lo
  // levaria horas, e é exatamente por isso que o host cobra `gas` ANTES de run()
  // — nenhum bloco tem 4,29G de gás, então run() jamais é alcançado. Aqui
  // verificamos o contrato que importa: a cotação, sem girar o laço.
  const { gas } = blake2f(vec('ffffffff', '01'));
  assert.equal(gas, 4294967295n);
});

test('rounds altíssimo não é rejeitado por si só — só sai caro', () => {
  // uint32 é lido como não-assinado: 0x80000000 não pode virar negativo.
  assert.equal(blake2f(vec('80000000', '01')).gas, 2147483648n);
});

test('gás é cotado sem tocar no trabalho pesado (padrão A-5)', () => {
  // blake2f() só valida e lê `rounds`; nada de estado/mensagem é lido até run().
  const { gas, run } = blake2f(vec('0000000c', '01'));
  assert.equal(gas, 12n);
  assert.equal(typeof run, 'function');
});

test('toda entrada com tamanho != 213 é rejeitada', () => {
  for (const len of [1, 100, 212, 214, 256, 512]) {
    assert.throws(() => blake2f(Buffer.alloc(len)), /213 bytes/, `tamanho ${len}`);
  }
});

test('todo byte f fora de {0,1} é rejeitado', () => {
  for (const f of [2, 3, 0x7f, 0x80, 0xff]) {
    const input = vec('0000000c', f.toString(16).padStart(2, '0'));
    assert.throws(() => blake2f(input), /bloco final/, `f = ${f}`);
  }
});

test('compress() é determinístico e o precompile não vaza estado entre chamadas', () => {
  const input = vec('0000000c', '01');
  const a = blake2f(input).run();
  const b = blake2f(input).run();
  assert.deepEqual(a, b);
  assert.deepEqual(input, vec('0000000c', '01')); // entrada não foi mutada
});

test('compress(): 12 rodadas sobre o IV com bloco vazio (encadeamento BLAKE2b-512)', () => {
  // h inicial do BLAKE2b-512 sem chave = IV com IV[0] ^= 0x01010040.
  // Comprimir o bloco vazio final (t=0, f=1) deve dar o hash da string vazia.
  const h = [
    0x6a09e667f3bcc908n ^ 0x01010040n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
  ];
  compress(h, new Array(16).fill(0n), 0n, 0n, true, 12);
  const out = Buffer.alloc(64);
  for (let i = 0; i < 8; i++) out.writeBigUInt64LE(h[i], i * 8);
  // BLAKE2b-512("") — valor de referência da RFC 7693 / b2sum
  assert.equal(
    out.toString('hex'),
    '786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419' +
    'd25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce',
  );
});
