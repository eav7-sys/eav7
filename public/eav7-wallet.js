// Criptografia da carteira EAV7 para o navegador — Keccak-256, SHA3-256,
// secp256k1 (com ecrecover/sign), RLP e derivação de endereço E7.
// Módulo ES isomórfico: sem imports de Node, funciona no browser e no Node.
// Portado de src/eavm/* (que usa node:crypto) para primitivas puras.

/* ----------------------------- utilidades ----------------------------- */
const HEX = '0123456789abcdef';
export function bytesToHex(b) {
  let s = '';
  for (const x of b) s += HEX[x >> 4] + HEX[x & 15];
  return s;
}
export function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const clean = h.length % 2 ? '0' + h : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
export function utf8ToBytes(str) {
  return new TextEncoder().encode(str);
}
function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const toBytes = (v) => (v instanceof Uint8Array ? v : utf8ToBytes(String(v)));
export function randomBytes(n) {
  const b = new Uint8Array(n);
  (globalThis.crypto ?? require('node:crypto').webcrypto).getRandomValues(b);
  return b;
}

/* ----------------------------- Keccak / SHA3 ----------------------------- */
const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rotl = (v, n) => (n === 0 ? v : (((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK));

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK) & B[((x + 2) % 5) + 5 * y]);
    A[0] ^= RC[round];
  }
}
function keccak(input, padByte) {
  const data = toBytes(input);
  const rate = 136;
  const blocks = Math.floor(data.length / rate) + 1;
  const padded = new Uint8Array(blocks * rate);
  padded.set(data);
  padded[data.length] = padByte;
  padded[padded.length - 1] |= 0x80;
  const A = new Array(25).fill(0n);
  const dv = new DataView(padded.buffer);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) A[i] ^= dv.getBigUint64(off + i * 8, true);
    keccakF(A);
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) odv.setBigUint64(i * 8, A[i], true);
  return out;
}
export const keccak256 = (b) => keccak(b, 0x01);
export const sha3_256 = (b) => keccak(b, 0x06);

/* ----------------------------- secp256k1 ----------------------------- */
export const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
export const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
const G = { x: Gx, y: Gy };
const mod = (a, m) => ((a % m) + m) % m;
function modpow(base, exp, m) {
  let r = 1n; base = mod(base, m);
  while (exp > 0n) { if (exp & 1n) r = (r * base) % m; base = (base * base) % m; exp >>= 1n; }
  return r;
}
const inv = (a, m) => modpow(mod(a, m), m - 2n, m);
function pointAdd(a, b) {
  if (!a) return b; if (!b) return a;
  if (a.x === b.x) { if (mod(a.y + b.y, P) === 0n) return null; return pointDouble(a); }
  const s = mod((b.y - a.y) * inv(b.x - a.x, P), P);
  const x = mod(s * s - a.x - b.x, P);
  return { x, y: mod(s * (a.x - x) - a.y, P) };
}
function pointDouble(a) {
  if (!a || a.y === 0n) return null;
  const s = mod(3n * a.x * a.x * inv(2n * a.y, P), P);
  const x = mod(s * s - 2n * a.x, P);
  return { x, y: mod(s * (a.x - x) - a.y, P) };
}
function pointMul(k, point) {
  k = mod(k, N);
  let r = null; let addend = point;
  while (k > 0n) { if (k & 1n) r = pointAdd(r, addend); addend = pointDouble(addend); k >>= 1n; }
  return r;
}
export const bytesToBig = (b) => (b.length ? BigInt('0x' + bytesToHex(b)) : 0n);
export const bigTo32 = (v) => hexToBytes(v.toString(16).padStart(64, '0'));

export function sign(msgHash, priv) {
  const z = bytesToBig(msgHash);
  for (;;) {
    const k = mod(bytesToBig(randomBytes(32)), N - 1n) + 1n;
    const R = pointMul(k, G);
    const r = mod(R.x, N);
    if (r === 0n) continue;
    let s = mod(inv(k, N) * (z + r * priv), N);
    if (s === 0n) continue;
    let recId = (R.x >= N ? 2n : 0n) | (R.y & 1n);
    if (s > N / 2n) { s = N - s; recId ^= 1n; } // low-s (EIP-2)
    return { r, s, recId };
  }
}
export const publicKeyFromPrivate = (priv) => pointMul(priv, G);
export function ethAddressFromPoint(pt) {
  return '0x' + bytesToHex(keccak256(concat(bigTo32(pt.x), bigTo32(pt.y))).slice(12));
}
export function ethAddressFromPrivate(priv) {
  return ethAddressFromPoint(publicKeyFromPrivate(priv));
}

/* ----------------------------- RLP ----------------------------- */
function rlpToBytes(item) {
  if (item instanceof Uint8Array) return item;
  if (typeof item === 'string') return hexToBytes(item);
  if (typeof item === 'bigint' || typeof item === 'number') {
    let v = BigInt(item);
    if (v < 0n) throw new Error('RLP: negativo');
    if (v === 0n) return new Uint8Array(0);
    let h = v.toString(16); if (h.length % 2) h = '0' + h;
    return hexToBytes(h);
  }
  throw new Error('RLP: tipo inválido');
}
function lenPrefix(len, base) {
  if (len < 56) return new Uint8Array([base + len]);
  let h = len.toString(16); if (h.length % 2) h = '0' + h;
  const lb = hexToBytes(h);
  return concat(new Uint8Array([base + 55 + lb.length]), lb);
}
export function rlpEncode(item) {
  if (Array.isArray(item)) {
    const body = concat(...item.map(rlpEncode));
    return concat(lenPrefix(body.length, 0xc0), body);
  }
  const b = rlpToBytes(item);
  if (b.length === 1 && b[0] < 0x80) return b;
  return concat(lenPrefix(b.length, 0x80), b);
}

/* ----------------------------- endereço E7 ----------------------------- */
const HASH_PREFIX = 'E7';
function addressChecksum(body) {
  return bytesToHex(sha3_256('EAV7-ADDR:' + body).slice(0, 2)).toUpperCase();
}
export function deriveAddressFrom(dataStr) {
  const body = bytesToHex(sha3_256(dataStr).slice(0, 14)).toUpperCase();
  return HASH_PREFIX + body + addressChecksum(body);
}
// endereço E7 mapeado de uma conta EAVM (0x…), igual ao do nó
export function evmToE7(evm) {
  return deriveAddressFrom('EAV7-EAVM:' + evm.toLowerCase());
}

/* --------- cofre: cifra a chave privada em repouso (PBKDF2 + AES-GCM) --------- */
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

async function deriveAesKey(password, salt, usage) {
  const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, usage,
  );
}
export async function encryptKey(privHex, password) {
  if (!subtle()) throw new Error('WebCrypto indisponível (use https ou localhost)');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, ['encrypt']);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(privHex));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
export async function decryptKey(blob, password) {
  if (!subtle()) throw new Error('WebCrypto indisponível (use https ou localhost)');
  const key = await deriveAesKey(password, ub64(blob.salt), ['decrypt']);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: ub64(blob.iv) }, key, ub64(blob.ct));
  return new TextDecoder().decode(pt);
}

/* --------- endereços de sistema (operações nativas via EAVM) --------- */
export const EAVM_STAKE_ADDRESS = '0x0000000000000000000000000000000000007001';
export const EAVM_UNSTAKE_ADDRESS = '0x0000000000000000000000000000000000007002';

/* ----------------------------- carteira / tx ----------------------------- */
export function createAccount() {
  let priv;
  do { priv = bytesToBig(randomBytes(32)); } while (priv <= 0n || priv >= N);
  return accountFromPrivate('0x' + priv.toString(16).padStart(64, '0'));
}
export function accountFromPrivate(privHex) {
  const priv = bytesToBig(hexToBytes(privHex));
  if (priv <= 0n || priv >= N) throw new Error('chave privada inválida');
  const evm = ethAddressFromPrivate(priv);
  return { privateKey: '0x' + priv.toString(16).padStart(64, '0'), evm, eav7: evmToE7(evm) };
}

// Constrói a transação EAVM (legacy EIP-155) assinada, pronta para o nó.
// valueWei em unidades de 18 casas (a carteira exibe EAV7 com 6, converte *10^12).
export function buildSignedTx({ privateKey, nonce, to, valueWei, chainId, gasPriceWei = 476190476190n, gasLimit = 21000n }) {
  const priv = bytesToBig(hexToBytes(privateKey));
  const base = [BigInt(nonce), gasPriceWei, gasLimit, to, valueWei, '0x'];
  const signingHash = keccak256(rlpEncode([...base, BigInt(chainId), new Uint8Array(0), new Uint8Array(0)]));
  const { r, s, recId } = sign(signingHash, priv);
  const v = BigInt(chainId) * 2n + 35n + recId;
  return '0x' + bytesToHex(rlpEncode([...base, v, r, s]));
}
