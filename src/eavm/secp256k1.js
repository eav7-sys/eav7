// Aritmética secp256k1 em BigInt puro — necessária porque o node:crypto assina e
// verifica, mas não expõe a RECUPERAÇÃO de chave pública (ecrecover) usada pelas
// transações Ethereum que o gateway EVM da EAV7 precisa validar.
import { randomBytes } from 'node:crypto';
import { keccak256 } from './keccak.js';

export const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
export const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
export const G = { x: Gx, y: Gy };

const mod = (a, m) => ((a % m) + m) % m;

function modpow(base, exp, m) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return result;
}

const inv = (a, m) => modpow(mod(a, m), m - 2n, m); // m é primo (P e N)

// pontos em coordenadas afins; null = ponto no infinito
export function pointAdd(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y, P) === 0n) return null;
    return pointDouble(a);
  }
  const slope = mod((b.y - a.y) * inv(b.x - a.x, P), P);
  const x = mod(slope * slope - a.x - b.x, P);
  return { x, y: mod(slope * (a.x - x) - a.y, P) };
}

function pointDouble(a) {
  if (!a || a.y === 0n) return null;
  const slope = mod(3n * a.x * a.x * inv(2n * a.y, P), P);
  const x = mod(slope * slope - 2n * a.x, P);
  return { x, y: mod(slope * (a.x - x) - a.y, P) };
}

// Coordenadas Jacobianas: (X,Y,Z) com afim = (X/Z², Y/Z³); Z=0 => infinito. Cada
// dobro/soma usa só multiplicações (SEM inversão modular), e há UMA ÚNICA inversão
// no fim (toAffine). Antes eram ~384 inversões por pointMul (~77ms/recover) — agora
// ~1, uma ordem de grandeza mais rápido. Resultado afim é idêntico ao da versão
// anterior (validado por vetores conhecidos e roundtrip nos testes).
function jDouble(X1, Y1, Z1) {
  if (Z1 === 0n || Y1 === 0n) return [0n, 0n, 0n];
  const A = (X1 * X1) % P;
  const B = (Y1 * Y1) % P;
  const C = (B * B) % P;
  const t = (X1 + B) % P;
  const D = mod(2n * (((t * t) % P) - A - C), P);
  const E = (3n * A) % P; // a = 0 na secp256k1
  const F = (E * E) % P;
  const X3 = mod(F - 2n * D, P);
  const Y3 = mod(E * mod(D - X3, P) - 8n * C, P);
  const Z3 = mod(2n * Y1 * Z1, P);
  return [X3, Y3, Z3];
}
function jAdd(X1, Y1, Z1, X2, Y2, Z2) {
  if (Z1 === 0n) return [X2, Y2, Z2];
  if (Z2 === 0n) return [X1, Y1, Z1];
  const Z1Z1 = (Z1 * Z1) % P;
  const Z2Z2 = (Z2 * Z2) % P;
  const U1 = (X1 * Z2Z2) % P;
  const U2 = (X2 * Z1Z1) % P;
  const S1 = (((Y1 * Z2) % P) * Z2Z2) % P;
  const S2 = (((Y2 * Z1) % P) * Z1Z1) % P;
  if (U1 === U2) {
    if (S1 !== S2) return [0n, 0n, 0n]; // P + (-P) = infinito
    return jDouble(X1, Y1, Z1);
  }
  const H = mod(U2 - U1, P);
  const H2 = ((2n * H) % P);
  const I = (H2 * H2) % P;
  const J = (H * I) % P;
  const r = mod(2n * (S2 - S1), P);
  const V = (U1 * I) % P;
  const X3 = mod(r * r - J - 2n * V, P);
  const Y3 = mod(r * mod(V - X3, P) - 2n * S1 * J, P);
  const Zs = (Z1 + Z2) % P;
  const Z3 = mod((((Zs * Zs) % P) - Z1Z1 - Z2Z2) * H, P);
  return [X3, Y3, Z3];
}
export function pointMul(k, point) {
  k = mod(k, N);
  if (k === 0n || !point) return null;
  let RX = 0n, RY = 0n, RZ = 0n; // infinito
  let QX = point.x, QY = point.y, QZ = 1n;
  while (k > 0n) {
    if (k & 1n) [RX, RY, RZ] = jAdd(RX, RY, RZ, QX, QY, QZ);
    [QX, QY, QZ] = jDouble(QX, QY, QZ);
    k >>= 1n;
  }
  if (RZ === 0n) return null;
  const zInv = inv(RZ, P), zInv2 = (zInv * zInv) % P;
  return { x: (RX * zInv2) % P, y: (((RY * zInv2) % P) * zInv) % P };
}

function liftX(x, isOdd) {
  if (x >= P) return null;
  const y2 = mod(x * x * x + 7n, P);
  let y = modpow(y2, (P + 1n) / 4n, P); // P ≡ 3 (mod 4)
  if ((y * y) % P !== y2) return null;
  if ((y & 1n) !== (isOdd ? 1n : 0n)) y = P - y;
  return { x, y };
}

export const bufToBig = (buf) => BigInt('0x' + (buf.toString('hex') || '0'));

export function bigTo32(value) {
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

// Recupera a chave pública (ponto) a partir de hash + assinatura (r, s, recId 0..3).
export function recover(msgHash, r, s, recId) {
  if (r <= 0n || r >= N || s <= 0n || s >= N || recId < 0n || recId > 3n) return null;
  const x = r + (recId >> 1n) * N;
  const R = liftX(x, (recId & 1n) === 1n);
  if (!R) return null;
  const z = bufToBig(msgHash);
  const rInv = inv(r, N);
  const u1 = mod(-z * rInv, N);
  const u2 = mod(s * rInv, N);
  return pointAdd(pointMul(u1, G), pointMul(u2, R));
}

export function verify(msgHash, r, s, pubPoint) {
  if (r <= 0n || r >= N || s <= 0n || s >= N || !pubPoint) return false;
  const z = bufToBig(msgHash);
  const w = inv(s, N);
  const point = pointAdd(pointMul(mod(z * w, N), G), pointMul(mod(r * w, N), pubPoint));
  return point !== null && mod(point.x, N) === r;
}

// Assinatura ECDSA com s baixo (EIP-2) e recId — usada nos testes e utilitários
// do gateway; carteiras reais (Trust Wallet etc.) assinam do lado delas.
export function sign(msgHash, privateKey) {
  const z = bufToBig(msgHash);
  for (;;) {
    const k = mod(bufToBig(randomBytes(32)), N - 1n) + 1n;
    const R = pointMul(k, G);
    const r = mod(R.x, N);
    if (r === 0n) continue;
    let s = mod(inv(k, N) * (z + r * privateKey), N);
    if (s === 0n) continue;
    let recId = (R.x >= N ? 2n : 0n) | (R.y & 1n);
    if (s > N / 2n) {
      s = N - s;
      recId ^= 1n;
    }
    return { r, s, recId };
  }
}

export function publicKeyFromPrivate(privateKey) {
  return pointMul(privateKey, G);
}

export function ethAddressFromPoint(point) {
  const uncompressed = Buffer.concat([bigTo32(point.x), bigTo32(point.y)]);
  return '0x' + keccak256(uncompressed).subarray(12).toString('hex');
}
