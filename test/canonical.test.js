// Codificação canônica do estado de consenso.
//
// Estes testes não verificam "o código faz o que eu escrevi" — verificam as
// PROPRIEDADES que tornam o formato utilizável como especificação por outra
// linguagem. Cada uma tem um modo de falha concreto em produção.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCanonical, canonicalHex } from '../src/core/canonical.js';

const hex = (v) => canonicalHex(v);

test('INJETIVO: valores distintos nunca produzem os mesmos bytes', () => {
  // O caso clássico: sem prefixo de comprimento, ["ab"] e ["a","b"] colidiriam
  // depois de concatenados — e uma folha do stateRoot seria forjável.
  assert.notEqual(hex(['ab']), hex(['a', 'b']));
  assert.notEqual(hex(['a', 'bc']), hex(['ab', 'c']));
  // Texto x inteiro com a mesma aparência
  assert.notEqual(hex('123'), hex(123));
  assert.notEqual(hex('123'), hex(123n));
  // Nulo x ausente x falso
  assert.notEqual(hex(null), hex(false));
  assert.notEqual(hex(0), hex(false));
  assert.notEqual(hex(0), hex(null));
  // Mapa x lista de pares
  assert.notEqual(hex({ a: 1 }), hex([['a', 1]]));
  // Aninhamento
  assert.notEqual(hex([[1], [2]]), hex([[1, 2]]));
});

test('inteiro grande NÃO perde precisão — o buraco que o JSON.stringify tinha', () => {
  // JSON.stringify(9007199254740993) devolve "9007199254740992": o número já chega
  // truncado ao stringify. Com BigInt o valor sobrevive, e é assim que o estado o
  // guarda. O formato canônico preserva os dois casos sem ambiguidade.
  const grande = 9007199254740993n;
  assert.equal(Buffer.from(encodeCanonical(grande).subarray(5)).toString('ascii'), '9007199254740993');
  assert.notEqual(hex(grande), hex(9007199254740992n));
  // E um valor gigante, muito além de qualquer float
  const gigante = 10n ** 40n + 7n;
  assert.equal(Buffer.from(encodeCanonical(gigante).subarray(5)).toString('ascii'), (10n ** 40n + 7n).toString());
});

test('inteiro tem forma canônica única', () => {
  assert.equal(hex(0), hex(0n));
  assert.equal(hex(-0), hex(0), '-0 e 0 são o mesmo valor matemático');
  assert.equal(hex(42), hex(42n), 'number e bigint do mesmo valor codificam igual');
  assert.notEqual(hex(-1n), hex(1n));
});

test('FLOAT é rejeitado — estado de consenso não pode ter ponto flutuante', () => {
  // Dois nós com bibliotecas matemáticas diferentes arredondariam diferente e
  // divergiriam. O formato impede que o estado ganhe float por descuido.
  assert.throws(() => encodeCanonical(0.1), /não inteiro/);
  assert.throws(() => encodeCanonical(1.5), /não inteiro/);
  assert.throws(() => encodeCanonical(NaN), /não inteiro/);
  assert.throws(() => encodeCanonical(Infinity), /não inteiro/);
  assert.throws(() => encodeCanonical({ taxa: 0.05 }), /não inteiro/);
});

test('tipo não codificável falha alto, em vez de virar folha irreproduzível', () => {
  assert.throws(() => encodeCanonical(Symbol('x')), /não codificável/);
  assert.throws(() => encodeCanonical(() => {}), /não codificável/);
});

test('DETERMINÍSTICO: ordem de inserção das chaves não altera os bytes', () => {
  assert.equal(hex({ a: 1, b: 2, c: 3 }), hex({ c: 3, b: 2, a: 1 }));
  assert.equal(hex({ z: 1, A: 2 }), hex({ A: 2, z: 1 }));
  // Ordenação é por BYTES: 'A' (0x41) vem antes de 'a' (0x61). `localeCompare`
  // daria outra ordem em alguns locales — e outra raiz.
  const bytes = encodeCanonical({ a: 1, A: 2 });
  const primeiraChave = bytes.subarray(10, 11).toString('ascii');
  assert.equal(primeiraChave, 'A', 'ordenação tem de ser por byte, não por locale');
});

test('undefined é OMITIDO, não codificado como nulo', () => {
  // Mantém a semântica anterior: um campo opcional adicionado no futuro não muda
  // a folha de um estado que não o tem.
  assert.equal(hex({ a: 1, b: undefined }), hex({ a: 1 }));
  assert.notEqual(hex({ a: 1, b: null }), hex({ a: 1 }));
});

test('unicode é UTF-8 cru, sem escape dependente de runtime', () => {
  const bytes = encodeCanonical('café');
  assert.equal(bytes[0], 0x04);
  assert.equal(bytes.readUInt32BE(1), 5, 'café tem 5 bytes em UTF-8');
  assert.equal(bytes.subarray(5).toString('utf8'), 'café');
});

test('estruturas vazias são distinguíveis entre si', () => {
  const vazios = [hex({}), hex([]), hex(''), hex(0), hex(null), hex(false)];
  assert.equal(new Set(vazios).size, vazios.length, 'todo vazio tem codificação própria');
});

test('a codificação é estável entre execuções', () => {
  const amostra = {
    balance: 10n ** 20n,
    nonce: 7,
    ativo: true,
    apelido: 'çãé',
    lista: [1n, 'dois', null, { aninhado: [] }],
  };
  assert.equal(hex(amostra), hex(amostra));
  assert.equal(hex(amostra), hex(JSON.parse(JSON.stringify(amostra, (k, v) =>
    typeof v === 'bigint' ? { __big: v.toString() } : v), (k, v) =>
    v && typeof v === 'object' && typeof v.__big === 'string' ? BigInt(v.__big) : v)));
});
