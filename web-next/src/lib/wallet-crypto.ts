/**
 * Cripto da carteira EAV7 — porta browser-only do eav7-wallet.js original.
 * Keccak/SHA3, secp256k1, RLP e AES-GCM (WebCrypto), tudo sem dependências.
 * A chave é gerada e assinada SOMENTE no navegador — nunca sai do dispositivo.
 * Carregar apenas em contexto client (ssr:false); usa `crypto` global do browser.
 */

export interface Account {
  privateKey: string;
  evm: string;
  eav7: string;
}

export interface EncryptedVault {
  v: number;
  salt: string;
  iv: string;
  ct: string;
}

type Point = { x: bigint; y: bigint } | null;

const HEX = "0123456789abcdef";

export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += HEX[x >> 4] + HEX[x & 15];
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const clean = h.length % 2 ? "0" + h : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

const toBytes = (v: Uint8Array | string): Uint8Array =>
  v instanceof Uint8Array ? v : utf8ToBytes(String(v));

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

const MASK = (1n << 64n) - 1n;
const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rotl = (v: bigint, n: number): bigint =>
  n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK;

function keccakF(A: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    const C = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D;
    }
    const B = new Array<bigint>(25);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        A[x + 5 * y] = B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK) & B[((x + 2) % 5) + 5 * y]);
    A[0] ^= RC[round];
  }
}

function keccak(input: Uint8Array | string, padByte: number): Uint8Array {
  const data = toBytes(input);
  const rate = 136;
  const blocks = Math.floor(data.length / rate) + 1;
  const padded = new Uint8Array(blocks * rate);
  padded.set(data);
  padded[data.length] = padByte;
  padded[padded.length - 1] |= 0x80;
  const A = new Array<bigint>(25).fill(0n);
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

export const keccak256 = (b: Uint8Array | string) => keccak(b, 0x01);
export const sha3_256 = (b: Uint8Array | string) => keccak(b, 0x06);

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const G: Point = { x: Gx, y: Gy };

const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

function modpow(base: bigint, exp: bigint, m: bigint): bigint {
  let r = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return r;
}
const inv = (a: bigint, m: bigint): bigint => modpow(mod(a, m), m - 2n, m);

function pointAdd(a: Point, b: Point): Point {
  if (!a) return b;
  if (!b) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y, P) === 0n) return null;
    return pointDouble(a);
  }
  const s = mod((b.y - a.y) * inv(b.x - a.x, P), P);
  const x = mod(s * s - a.x - b.x, P);
  return { x, y: mod(s * (a.x - x) - a.y, P) };
}
function pointDouble(a: Point): Point {
  if (!a || a.y === 0n) return null;
  const s = mod(3n * a.x * a.x * inv(2n * a.y, P), P);
  const x = mod(s * s - 2n * a.x, P);
  return { x, y: mod(s * (a.x - x) - a.y, P) };
}
function pointMul(k: bigint, point: Point): Point {
  k = mod(k, N);
  let r: Point = null;
  let addend = point;
  while (k > 0n) {
    if (k & 1n) r = pointAdd(r, addend);
    addend = pointDouble(addend);
    k >>= 1n;
  }
  return r;
}

const bytesToBig = (b: Uint8Array): bigint => (b.length ? BigInt("0x" + bytesToHex(b)) : 0n);
const bigTo32 = (v: bigint): Uint8Array => hexToBytes(v.toString(16).padStart(64, "0"));

interface Signature {
  r: bigint;
  s: bigint;
  recId: bigint;
}
function sign(msgHash: Uint8Array, priv: bigint): Signature {
  const z = bytesToBig(msgHash);
  for (;;) {
    const k = mod(bytesToBig(randomBytes(32)), N - 1n) + 1n;
    const R = pointMul(k, G);
    if (!R) continue;
    const r = mod(R.x, N);
    if (r === 0n) continue;
    let s = mod(inv(k, N) * (z + r * priv), N);
    if (s === 0n) continue;
    let recId = (R.x >= N ? 2n : 0n) | (R.y & 1n);
    if (s > N / 2n) {
      s = N - s;
      recId ^= 1n;
    }
    return { r, s, recId };
  }
}

const publicKeyFromPrivate = (priv: bigint): Point => pointMul(priv, G);
function ethAddressFromPoint(pt: Point): string {
  if (!pt) throw new Error("ponto inválido");
  return "0x" + bytesToHex(keccak256(concat(bigTo32(pt.x), bigTo32(pt.y))).slice(12));
}
function ethAddressFromPrivate(priv: bigint): string {
  return ethAddressFromPoint(publicKeyFromPrivate(priv));
}

type RlpItem = Uint8Array | string | bigint | number | RlpItem[];

function rlpToBytes(item: Uint8Array | string | bigint | number): Uint8Array {
  if (item instanceof Uint8Array) return item;
  if (typeof item === "string") return hexToBytes(item);
  if (typeof item === "bigint" || typeof item === "number") {
    const v = BigInt(item);
    if (v < 0n) throw new Error("RLP: negativo");
    if (v === 0n) return new Uint8Array(0);
    let h = v.toString(16);
    if (h.length % 2) h = "0" + h;
    return hexToBytes(h);
  }
  throw new Error("RLP: tipo inválido");
}
function lenPrefix(len: number, base: number): Uint8Array {
  if (len < 56) return new Uint8Array([base + len]);
  let h = len.toString(16);
  if (h.length % 2) h = "0" + h;
  const lb = hexToBytes(h);
  return concat(new Uint8Array([base + 55 + lb.length]), lb);
}
function rlpEncode(item: RlpItem): Uint8Array {
  if (Array.isArray(item)) {
    const body = concat(...item.map(rlpEncode));
    return concat(lenPrefix(body.length, 0xc0), body);
  }
  const b = rlpToBytes(item);
  if (b.length === 1 && b[0] < 0x80) return b;
  return concat(lenPrefix(b.length, 0x80), b);
}

const HASH_PREFIX = "E7";
function addressChecksum(body: string): string {
  return bytesToHex(sha3_256("EAV7-ADDR:" + body).slice(0, 2)).toUpperCase();
}
function deriveAddressFrom(dataStr: string): string {
  const body = bytesToHex(sha3_256(dataStr).slice(0, 14)).toUpperCase();
  return HASH_PREFIX + body + addressChecksum(body);
}
function evmToE7(evm: string): string {
  return deriveAddressFrom("EAV7-EAVM:" + evm.toLowerCase());
}

const b64 = (u8: Uint8Array): string => btoa(String.fromCharCode(...u8));
const ub64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const subtle = (): SubtleCrypto | null => (globalThis.crypto && globalThis.crypto.subtle) || null;
// Uint8Array é um BufferSource válido em runtime; a lib do TS 5.9 é estrita
// quanto ao generic do buffer — este cast reconcilia sem copiar bytes.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  usage: KeyUsage[]
): Promise<CryptoKey> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto indisponível (use https ou localhost)");
  const base = await s.importKey("raw", bs(new TextEncoder().encode(password)), "PBKDF2", false, [
    "deriveKey",
  ]);
  return s.deriveKey(
    { name: "PBKDF2", salt: bs(salt), iterations: 210000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usage
  );
}

export async function encryptKey(privHex: string, password: string): Promise<EncryptedVault> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto indisponível (use https ou localhost)");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, ["encrypt"]);
  const ct = await s.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(new TextEncoder().encode(privHex)));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function decryptKey(blob: EncryptedVault, password: string): Promise<string> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto indisponível (use https ou localhost)");
  const key = await deriveAesKey(password, ub64(blob.salt), ["decrypt"]);
  const pt = await s.decrypt({ name: "AES-GCM", iv: bs(ub64(blob.iv)) }, key, bs(ub64(blob.ct)));
  return new TextDecoder().decode(pt);
}

export const EAVM_STAKE_ADDRESS = "0x0000000000000000000000000000000000007001";
export const EAVM_UNSTAKE_ADDRESS = "0x0000000000000000000000000000000000007002";

export function createAccount(): Account {
  let priv: bigint;
  do {
    priv = bytesToBig(randomBytes(32));
  } while (priv <= 0n || priv >= N);
  return accountFromPrivate("0x" + priv.toString(16).padStart(64, "0"));
}

export function accountFromPrivate(privHex: string): Account {
  const priv = bytesToBig(hexToBytes(privHex));
  if (priv <= 0n || priv >= N) throw new Error("chave privada inválida");
  const evm = ethAddressFromPrivate(priv);
  return { privateKey: "0x" + priv.toString(16).padStart(64, "0"), evm, eav7: evmToE7(evm) };
}

interface BuildTxArgs {
  privateKey: string;
  nonce: number;
  to: string;
  valueWei: bigint;
  chainId: number;
  gasPriceWei?: bigint;
  gasLimit?: bigint;
}
export function buildSignedTx({
  privateKey,
  nonce,
  to,
  valueWei,
  chainId,
  gasPriceWei = 476190476190n,
  gasLimit = 21000n,
}: BuildTxArgs): string {
  const priv = bytesToBig(hexToBytes(privateKey));
  const base: RlpItem[] = [BigInt(nonce), gasPriceWei, gasLimit, to, valueWei, "0x"];
  const signingHash = keccak256(
    rlpEncode([...base, BigInt(chainId), new Uint8Array(0), new Uint8Array(0)])
  );
  const { r, s, recId } = sign(signingHash, priv);
  const v = BigInt(chainId) * 2n + 35n + recId;
  return "0x" + bytesToHex(rlpEncode([...base, v, r, s]));
}
