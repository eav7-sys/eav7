// BLAKE2b F (função de compressão) em JS puro — precompile 0x09 do EIP-152.
// Só a compressão é exposta on-chain: o contrato passa o estado `h`, o bloco `m`,
// o contador `t` e a flag de bloco final `f`, e roda `rounds` rodadas. Isso deixa
// o *modo* (padding, encadeamento, keying) a cargo do contrato — é o que permite
// verificar provas de Equihash/Zcash na EVM sem embutir um hash inteiro.
//
// Escolha de aritmética: BigInt com máscara de 64 bits, como em keccak.js. Pares
// de uint32 seriam ~3x mais rápidos, mas as rotações à DIREITA de 63 e 24 viram
// um emaranhado de carries entre as metades; aqui a legibilidade (e portanto a
// auditabilidade do consenso) vale mais que a velocidade, e o gás de 1/rodada já
// é cobrado ANTES do trabalho (A-5), então uma entrada cara nunca é computada de
// graça. Ver o comentário sobre `rounds` em blake2f() abaixo.
import { EavmError } from './vm.js';

const MASK = (1n << 64n) - 1n;

// IV do BLAKE2b = os mesmos 8 primeiros da raiz quadrada dos primos que o SHA-512
const IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];

// permutações SIGMA (RFC 7693 §2.7). O BLAKE2b usa 12 rodadas, mas o precompile
// aceita `rounds` arbitrário — a rodada i usa SIGMA[i % 10].
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

// rotação à DIREITA de 64 bits (o BLAKE2b só usa 32, 24, 16 e 63)
const rotr = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK;

// mistura G (RFC 7693 §3.1) — opera in-place sobre o vetor de trabalho v
function G(v, a, b, c, d, x, y) {
  v[a] = (v[a] + v[b] + x) & MASK;
  v[d] = rotr(v[d] ^ v[a], 32);
  v[c] = (v[c] + v[d]) & MASK;
  v[b] = rotr(v[b] ^ v[c], 24);
  v[a] = (v[a] + v[b] + y) & MASK;
  v[d] = rotr(v[d] ^ v[a], 16);
  v[c] = (v[c] + v[d]) & MASK;
  v[b] = rotr(v[b] ^ v[c], 63);
}

/**
 * Função de compressão F do BLAKE2b (RFC 7693 §3.2), pura.
 * @param {bigint[]} h estado de 8 palavras — MUTADO in-place (é o retorno)
 * @param {bigint[]} m bloco de 16 palavras
 * @param {bigint} t0 contador (low)
 * @param {bigint} t1 contador (high)
 * @param {boolean} f flag de bloco final
 * @param {number} rounds número de rodadas
 */
export function compress(h, m, t0, t1, f, rounds) {
  const v = new Array(16);
  for (let i = 0; i < 8; i++) v[i] = h[i];
  for (let i = 0; i < 8; i++) v[i + 8] = IV[i];

  v[12] ^= t0 & MASK;
  v[13] ^= t1 & MASK;
  if (f) v[14] ^= MASK; // inverte todos os bits de v[14] no bloco final

  for (let r = 0; r < rounds; r++) {
    const s = SIGMA[r % 10];
    // colunas
    G(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
    G(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
    G(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
    G(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
    // diagonais
    G(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
    G(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
    G(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
    G(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
  }

  for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
  return h;
}

const INPUT_LEN = 213; // 4 (rounds) + 64 (h) + 128 (m) + 16 (t) + 1 (f)

/**
 * Precompile 0x09 (EIP-152) no contrato que o host espera: (Buffer) => { gas, run }.
 *
 * Layout da entrada (EXATAMENTE 213 bytes):
 *   [0,4)     rounds  uint32 BIG-endian  (único campo BE da entrada)
 *   [4,68)    h       8 × uint64 little-endian
 *   [68,196)  m       16 × uint64 little-endian
 *   [196,212) t       2 × uint64 little-endian (t0, t1)
 *   [212]     f       0x00 ou 0x01 — qualquer outro valor é inválido
 *
 * Saída: 64 bytes, o novo h em little-endian.
 */
export function blake2f(input) {
  // Validação ANTES de qualquer trabalho: o EIP exige tamanho exato (nada de
  // right-pad como nos precompiles 0x01-0x05) e f estritamente binário.
  if (input.length !== INPUT_LEN) throw new EavmError('BLAKE2F: entrada deve ter exatamente 213 bytes');
  const fByte = input[212];
  if (fByte !== 0 && fByte !== 1) throw new EavmError('BLAKE2F: flag de bloco final inválida');

  const rounds = input.readUInt32BE(0);
  // Gás = 1 por rodada (GFROUND=1). `rounds` é uint32, então o teto é 4.294.967.295
  // gás — caríssimo, mas LEGÍTIMO: nenhum limite artificial. É exatamente por isso
  // que o gás é devolvido aqui e cobrado pelo host ANTES de run() (A-5): uma entrada
  // com rounds=0xffffffff é rejeitada por falta de gás sem nunca girar o laço.
  const gas = BigInt(rounds);

  return { gas, run: () => {
    const h = new Array(8);
    for (let i = 0; i < 8; i++) h[i] = input.readBigUInt64LE(4 + i * 8);
    const m = new Array(16);
    for (let i = 0; i < 16; i++) m[i] = input.readBigUInt64LE(68 + i * 8);
    const t0 = input.readBigUInt64LE(196);
    const t1 = input.readBigUInt64LE(204);

    compress(h, m, t0, t1, fByte === 1, rounds);

    const out = Buffer.alloc(64);
    for (let i = 0; i < 8; i++) out.writeBigUInt64LE(h[i], i * 8);
    return out;
  } };
}
