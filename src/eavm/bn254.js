// Precompiles BN254 (alt_bn128) da EAVM: ecAdd (0x06), ecMul (0x07) e
// ecPairing (0x08), conforme EIP-196/EIP-197 com o gás do EIP-1108.
//
// Zero dependências externas: BigInt puro, no mesmo estilo de `secp256k1.js`
// (aritmética afim/Jacobiana escrita à mão, sem bibliotecas de curva).
//
// ---------------------------------------------------------------------------
// A MATEMÁTICA, EM RESUMO
// ---------------------------------------------------------------------------
// A BN254 é uma curva "pairing-friendly" com grau de mergulho (embedding degree)
// k = 12. Isso significa que o emparelhamento e(P, Q) leva pontos para o corpo
// Fp12, e por isso precisamos de uma TORRE de corpos para calcular nele:
//
//     Fp   = Z/pZ
//     Fp2  = Fp[u]  / (u² + 1)        (p ≡ 3 mod 4, logo -1 não é resíduo)
//     Fp6  = Fp2[v] / (v³ - ξ)        com ξ = 9 + u  (não-resíduo cúbico/quadrático)
//     Fp12 = Fp6[w] / (w² - v)        logo w⁶ = ξ
//
// G1 = E(Fp)  : y² = x³ + 3                (cofator 1 → estar na curva já basta)
// G2 ⊂ E'(Fp2): y² = x³ + 3/ξ              (twist de grau 6, tipo D)
//
// O "twist" existe porque trabalhar com G2 diretamente em Fp12 seria caríssimo.
// A curva torcida E'(Fp2) é isomorfa ao subgrupo de interesse de E(Fp12) via
//
//     ψ(x, y) = (x·w², y·w³)
//
// (confira: y²w⁶ = x³w⁶ + b  ⇔  y²ξ = x³ξ + b  ⇔  y² = x³ + b/ξ ✓)
//
// O emparelhamento usado é o "ate ótimo", que é o laço de Miller com o
// parâmetro m = 6x+2 (x = 4965661367192848881 é o parâmetro da curva), seguido
// de duas correções de Frobenius e da exponenciação final.
//
// ---------------------------------------------------------------------------
// SEGURANÇA
// ---------------------------------------------------------------------------
// Toda entrada inválida LANÇA (nunca é aceita silenciosamente):
//   - coordenada >= p
//   - ponto fora da curva
//   - ponto de G2 fora do subgrupo de ordem r  ← CRÍTICO: sem essa verificação
//     o emparelhamento é forjável (E'(Fp2) tem cofator grande; um ponto de
//     outra componente permite construir provas falsas que passam no ==1).
//   - tamanho de entrada não múltiplo de 192 no ecPairing
//
// O gás é cobrado ANTES do trabalho pesado (mesmo padrão anti-DoS do `host.js`):
// cada precompile devolve { gas, run } e o host só chama run() se houver gás.

// ---------------------------------------------------------------------------
// Parâmetros da curva
// ---------------------------------------------------------------------------

// Característica do corpo base.
import { CHAIN } from '../config.js';
export const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
// Ordem do subgrupo de emparelhamento (ordem de G1 e de G2).
export const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// Parâmetro `x` da família BN.
const CURVE_X = 4965661367192848881n;
// Parâmetro do laço de Miller no ate ótimo: m = 6x + 2 (positivo nesta curva).
const SIX_X_PLUS_2 = 6n * CURVE_X + 2n; // 29793968203157093288

// ---------------------------------------------------------------------------
// Fp — corpo base
// ---------------------------------------------------------------------------

const fpAdd = (a, b) => { const c = a + b; return c >= P ? c - P : c; };
const fpSub = (a, b) => { const c = a - b; return c < 0n ? c + P : c; };
const fpMul = (a, b) => (a * b) % P;
const fpNeg = (a) => (a === 0n ? 0n : P - a);

function fpPow(base, exp) {
  let r = 1n, b = base % P, e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return r;
}
// p é primo, então a⁻¹ = a^(p-2) (pequeno teorema de Fermat).
const fpInv = (a) => fpPow(a, P - 2n);

// ---------------------------------------------------------------------------
// Fp2 = Fp[u]/(u² + 1) — elementos são [c0, c1] representando c0 + c1·u
// ---------------------------------------------------------------------------

const F2_ZERO = [0n, 0n];
const F2_ONE = [1n, 0n];

const f2From = (c0, c1 = 0n) => [c0 % P, c1 % P];
const f2Add = (a, b) => [fpAdd(a[0], b[0]), fpAdd(a[1], b[1])];
const f2Sub = (a, b) => [fpSub(a[0], b[0]), fpSub(a[1], b[1])];
const f2Neg = (a) => [fpNeg(a[0]), fpNeg(a[1])];
const f2IsZero = (a) => a[0] === 0n && a[1] === 0n;
const f2Eq = (a, b) => a[0] === b[0] && a[1] === b[1];
// a^p em Fp2: u^p = u^(p-1)·u = (u²)^((p-1)/2)·u = (-1)^((p-1)/2)·u = -u,
// pois p ≡ 3 (mod 4). Ou seja, Frobenius em Fp2 é a conjugação.
const f2Conj = (a) => [a[0], fpNeg(a[1])];
// Multiplicação por escalar de Fp (usada ao avaliar retas no ponto P ∈ G1).
const f2MulFp = (a, s) => [(a[0] * s) % P, (a[1] * s) % P];

// (a0 + a1u)(b0 + b1u) = (a0b0 - a1b1) + (a0b1 + a1b0)u, via Karatsuba
// (3 multiplicações em vez de 4).
function f2Mul(a, b) {
  const t0 = (a[0] * b[0]) % P;
  const t1 = (a[1] * b[1]) % P;
  const t2 = ((a[0] + a[1]) * (b[0] + b[1])) % P;
  return [fpSub(t0, t1), (t2 - t0 - t1 + 2n * P) % P];
}

// (a0 + a1u)² = (a0 + a1)(a0 - a1) + 2a0a1·u
function f2Sqr(a) {
  const t = ((a[0] + a[1]) * ((a[0] - a[1] + P) % P)) % P;
  return [t, (2n * a[0] * a[1]) % P];
}

// Norma N(a) = a·conj(a) = a0² + a1² ∈ Fp; logo a⁻¹ = conj(a)/N(a).
function f2Inv(a) {
  const n = fpInv((a[0] * a[0] + a[1] * a[1]) % P);
  return [(a[0] * n) % P, (fpNeg(a[1]) * n) % P];
}

function f2Pow(a, exp) {
  let r = F2_ONE, b = a, e = exp;
  while (e > 0n) {
    if (e & 1n) r = f2Mul(r, b);
    b = f2Sqr(b);
    e >>= 1n;
  }
  return r;
}

// ξ = 9 + u — o não-resíduo que amarra a torre (v³ = ξ, w⁶ = ξ).
const XI = [9n, 1n];
// a·ξ = a·(9+u) = (9a0 - a1) + (a0 + 9a1)u — barato, sem multiplicação genérica.
const f2MulXi = (a) => [(9n * a[0] - a[1] + P * 9n) % P, (a[0] + 9n * a[1]) % P];

// ---------------------------------------------------------------------------
// Fp6 = Fp2[v]/(v³ - ξ) — elementos são [c0, c1, c2] = c0 + c1·v + c2·v²
// ---------------------------------------------------------------------------

const F6_ZERO = [F2_ZERO, F2_ZERO, F2_ZERO];
const F6_ONE = [F2_ONE, F2_ZERO, F2_ZERO];

const f6Add = (a, b) => [f2Add(a[0], b[0]), f2Add(a[1], b[1]), f2Add(a[2], b[2])];
const f6Sub = (a, b) => [f2Sub(a[0], b[0]), f2Sub(a[1], b[1]), f2Sub(a[2], b[2])];
const f6Neg = (a) => [f2Neg(a[0]), f2Neg(a[1]), f2Neg(a[2])];
const f6IsZero = (a) => a.every(f2IsZero);
const f6Eq = (a, b) => a.every((x, i) => f2Eq(x, b[i]));
const f6MulF2 = (a, s) => [f2Mul(a[0], s), f2Mul(a[1], s), f2Mul(a[2], s)];

// Karatsuba em 3 termos, reduzindo v³ → ξ.
function f6Mul(a, b) {
  const t0 = f2Mul(a[0], b[0]);
  const t1 = f2Mul(a[1], b[1]);
  const t2 = f2Mul(a[2], b[2]);
  const c0 = f2Add(t0, f2MulXi(f2Sub(f2Sub(f2Mul(f2Add(a[1], a[2]), f2Add(b[1], b[2])), t1), t2)));
  const c1 = f2Add(f2Sub(f2Sub(f2Mul(f2Add(a[0], a[1]), f2Add(b[0], b[1])), t0), t1), f2MulXi(t2));
  const c2 = f2Add(f2Sub(f2Sub(f2Mul(f2Add(a[0], a[2]), f2Add(b[0], b[2])), t0), t2), t1);
  return [c0, c1, c2];
}

// Multiplicação por v: (c0 + c1v + c2v²)·v = ξc2 + c0v + c1v².
const f6MulV = (a) => [f2MulXi(a[2]), a[0], a[1]];

// Inversão em Fp6 (Devegili et al., "Multiplication and Squaring on
// Pairing-Friendly Fields", Alg. 17): reduz a UMA inversão em Fp2.
function f6Inv(a) {
  const t0 = f2Sqr(a[0]);
  const t1 = f2Sqr(a[1]);
  const t2 = f2Sqr(a[2]);
  const t3 = f2Mul(a[0], a[1]);
  const t4 = f2Mul(a[0], a[2]);
  const t5 = f2Mul(a[1], a[2]);
  const c0 = f2Sub(t0, f2MulXi(t5));
  const c1 = f2Sub(f2MulXi(t2), t3);
  const c2 = f2Sub(t1, t4);
  // norma = a0·c0 + ξ·(a2·c1 + a1·c2)
  const n = f2Add(f2Mul(a[0], c0), f2MulXi(f2Add(f2Mul(a[2], c1), f2Mul(a[1], c2))));
  const ni = f2Inv(n);
  return [f2Mul(c0, ni), f2Mul(c1, ni), f2Mul(c2, ni)];
}

// ---------------------------------------------------------------------------
// Fp12 = Fp6[w]/(w² - v) — elementos são [c0, c1] = c0 + c1·w
// ---------------------------------------------------------------------------

const F12_ONE = [F6_ONE, F6_ZERO];

const f12Mul1 = (a, b) => f6Mul(a, b); // alias legível
const f12Eq = (a, b) => f6Eq(a[0], b[0]) && f6Eq(a[1], b[1]);
// O automorfismo w → -w gera Gal(Fp12/Fp6); ele coincide com x ↦ x^(p⁶).
const f12Conj = (a) => [a[0], f6Neg(a[1])];

// (a0 + a1w)(b0 + b1w) = (a0b0 + v·a1b1) + ((a0+a1)(b0+b1) - a0b0 - a1b1)w
function f12Mul(a, b) {
  const t0 = f12Mul1(a[0], b[0]);
  const t1 = f12Mul1(a[1], b[1]);
  const c0 = f6Add(t0, f6MulV(t1));
  const c1 = f6Sub(f6Sub(f6Mul(f6Add(a[0], a[1]), f6Add(b[0], b[1])), t0), t1);
  return [c0, c1];
}

// Quadrado "complexo": t = a0a1; c0 = (a0+a1)(a0+v·a1) - t - v·t; c1 = 2t.
function f12Sqr(a) {
  const t = f6Mul(a[0], a[1]);
  const c0 = f6Sub(f6Sub(f6Mul(f6Add(a[0], a[1]), f6Add(a[0], f6MulV(a[1]))), t), f6MulV(t));
  return [c0, f6Add(t, t)];
}

// (a0 + a1w)⁻¹ = (a0 - a1w) / (a0² - v·a1²) — a norma cai em Fp6.
function f12Inv(a) {
  const n = f6Inv(f6Sub(f6Mul(a[0], a[0]), f6MulV(f6Mul(a[1], a[1]))));
  return [f6Mul(a[0], n), f6Neg(f6Mul(a[1], n))];
}

function f12Pow(a, exp) {
  let r = F12_ONE, b = a, e = exp;
  while (e > 0n) {
    if (e & 1n) r = f12Mul(r, b);
    b = f12Sqr(b);
    e >>= 1n;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Constantes de Frobenius
// ---------------------------------------------------------------------------
// Calculadas em tempo de carga em vez de transcritas: a transcrição manual
// dessas ~10 constantes de 512 bits é uma fonte notória de bugs silenciosos.
//
// γ_i = ξ^((p^i - 1)/6). Todas as demais são potências dela:
//   ξ^((p^i-1)/3) = γ_i²   (coef. de v  em Fp6 e do x do twist)
//   ξ^((p^i-1)/2) = γ_i³   (coef. do y do twist)
//   ξ^(2(p^i-1)/3) = γ_i⁴  (coef. de v² em Fp6)
const FROB_GAMMA = [];   // γ_i, i = 0..3  (coeficiente de w em Fp12)
const FROB6_C1 = [];     // γ_i²
const FROB6_C2 = [];     // γ_i⁴
const TWIST_FROB_Y = []; // γ_i³
{
  let pPow = 1n;
  for (let i = 0; i <= 3; i++) {
    const g = f2Pow(XI, (pPow - 1n) / 6n);
    FROB_GAMMA.push(g);
    FROB6_C1.push(f2Sqr(g));
    TWIST_FROB_Y.push(f2Mul(f2Sqr(g), g));
    FROB6_C2.push(f2Sqr(f2Sqr(g)));
    pPow *= P;
  }
}

// x^(p^i) em Fp2: conjuga se i for ímpar (Frobenius tem ordem 2 aqui).
const f2FrobP = (a, i) => (i % 2 === 1 ? f2Conj(a) : a);

// (c0 + c1v + c2v²)^(p^i) = c0^(p^i) + c1^(p^i)·γ_i² v + c2^(p^i)·γ_i⁴ v²
const f6Frob = (a, i) => [
  f2FrobP(a[0], i),
  f2Mul(f2FrobP(a[1], i), FROB6_C1[i]),
  f2Mul(f2FrobP(a[2], i), FROB6_C2[i]),
];

// (a0 + a1w)^(p^i) = a0^(p^i) + a1^(p^i)·γ_i w   (pois w^(p^i) = γ_i·w)
const f12Frob = (a, i) => [f6Frob(a[0], i), f6MulF2(f6Frob(a[1], i), FROB_GAMMA[i])];

// ---------------------------------------------------------------------------
// Curvas — aritmética genérica sobre um "corpo" F (serve para Fp e para Fp2)
// ---------------------------------------------------------------------------
// Coordenadas Jacobianas (X, Y, Z) com afim = (X/Z², Y/Z³) e Z = 0 ⇒ infinito.
// Igual ao secp256k1.js: nenhuma inversão por passo, UMA no final. Usada tanto
// no ecMul de G1 quanto na verificação de subgrupo de G2 (que multiplica por r).

const FP = {
  zero: 0n, one: 1n,
  add: fpAdd, sub: fpSub, mul: fpMul, sqr: (a) => (a * a) % P,
  neg: fpNeg, inv: fpInv, isZero: (a) => a === 0n, eq: (a, b) => a === b,
  mulInt: (a, n) => (BigInt(n) * a) % P,
};

const FP2 = {
  zero: F2_ZERO, one: F2_ONE,
  add: f2Add, sub: f2Sub, mul: f2Mul, sqr: f2Sqr,
  neg: f2Neg, inv: f2Inv, isZero: f2IsZero, eq: f2Eq,
  mulInt: (a, n) => [(BigInt(n) * a[0]) % P, (BigInt(n) * a[1]) % P],
};

// dbl-2009-l (a = 0)
function jDouble(F, X, Y, Z) {
  if (F.isZero(Z) || F.isZero(Y)) return [F.zero, F.zero, F.zero];
  const A = F.sqr(X);
  const B = F.sqr(Y);
  const C = F.sqr(B);
  const t = F.add(X, B);
  const D = F.mulInt(F.sub(F.sub(F.sqr(t), A), C), 2);
  const E = F.mulInt(A, 3);
  const G = F.sqr(E);
  const X3 = F.sub(G, F.mulInt(D, 2));
  const Y3 = F.sub(F.mul(E, F.sub(D, X3)), F.mulInt(C, 8));
  const Z3 = F.mulInt(F.mul(Y, Z), 2);
  return [X3, Y3, Z3];
}

// add-2007-bl
function jAdd(F, X1, Y1, Z1, X2, Y2, Z2) {
  if (F.isZero(Z1)) return [X2, Y2, Z2];
  if (F.isZero(Z2)) return [X1, Y1, Z1];
  const Z1Z1 = F.sqr(Z1);
  const Z2Z2 = F.sqr(Z2);
  const U1 = F.mul(X1, Z2Z2);
  const U2 = F.mul(X2, Z1Z1);
  const S1 = F.mul(F.mul(Y1, Z2), Z2Z2);
  const S2 = F.mul(F.mul(Y2, Z1), Z1Z1);
  if (F.eq(U1, U2)) {
    if (!F.eq(S1, S2)) return [F.zero, F.zero, F.zero]; // P + (-P) = O
    return jDouble(F, X1, Y1, Z1);
  }
  const H = F.sub(U2, U1);
  const I = F.sqr(F.mulInt(H, 2));
  const J = F.mul(H, I);
  const r = F.mulInt(F.sub(S2, S1), 2);
  const V = F.mul(U1, I);
  const X3 = F.sub(F.sub(F.sqr(r), J), F.mulInt(V, 2));
  const Y3 = F.sub(F.mul(r, F.sub(V, X3)), F.mulInt(F.mul(S1, J), 2));
  const Zs = F.add(Z1, Z2);
  const Z3 = F.mul(F.sub(F.sub(F.sqr(Zs), Z1Z1), Z2Z2), H);
  return [X3, Y3, Z3];
}

// Multiplicação escalar; devolve null (infinito) ou ponto afim {x, y}.
function curveMul(F, k, pt) {
  if (k === 0n || pt === null) return null;
  let RX = F.zero, RY = F.zero, RZ = F.zero;
  let QX = pt.x, QY = pt.y, QZ = F.one;
  let e = k;
  while (e > 0n) {
    if (e & 1n) [RX, RY, RZ] = jAdd(F, RX, RY, RZ, QX, QY, QZ);
    [QX, QY, QZ] = jDouble(F, QX, QY, QZ);
    e >>= 1n;
  }
  if (F.isZero(RZ)) return null;
  const zi = F.inv(RZ);
  const zi2 = F.sqr(zi);
  return { x: F.mul(RX, zi2), y: F.mul(F.mul(RY, zi2), zi) };
}

function curveAdd(F, a, b) {
  if (a === null) return b;
  if (b === null) return a;
  const [X, Y, Z] = jAdd(F, a.x, a.y, F.one, b.x, b.y, F.one);
  if (F.isZero(Z)) return null;
  const zi = F.inv(Z);
  const zi2 = F.sqr(zi);
  return { x: F.mul(X, zi2), y: F.mul(F.mul(Y, zi2), zi) };
}

// b de G1 e b' do twist. b' = 3/ξ ∈ Fp2 (curva torcida tipo D).
const B_G1 = 3n;
const B_G2 = f2Mul([3n, 0n], f2Inv(XI));

const onCurveG1 = (pt) => pt === null
  || fpSub(fpMul(pt.y, pt.y), fpAdd(fpMul(fpMul(pt.x, pt.x), pt.x), B_G1)) === 0n;

const onCurveG2 = (pt) => pt === null
  || f2IsZero(f2Sub(f2Sqr(pt.y), f2Add(f2Mul(f2Sqr(pt.x), pt.x), B_G2)));

// ---------------------------------------------------------------------------
// Laço de Miller (ate ótimo)
// ---------------------------------------------------------------------------
// A reta que passa por ψ(T) e ψ(Q), avaliada em P = (xP, yP) ∈ E(Fp):
//
//   l(x,y) = y - yT' - λ'(x - xT')          (no "untwist", coordenadas Fp12)
//
// Com ψ(T) = (xT·w², yT·w³) a inclinação vira λ_untwist = λ·w (λ ∈ Fp2), logo
//
//   l(P) = yP - λ·xP·w + (λ·xT - yT)·w³
//
// Ou seja um elemento ESPARSO de Fp12: só três das seis casas de Fp2 são
// não-nulas (posições w⁰, w¹, w³) — daí a multiplicação especializada abaixo.

// Multiplica `a` ∈ Fp12 pelo esparso (c0, 0, 0) + (c3, c4, 0)·w.
function mulBy034(a, c0, c3, c4) {
  const t0 = f6MulF2(a[0], c0);
  const b = [c3, c4, F2_ZERO];
  const t1 = f6Mul(a[1], b);
  const t2 = [f2Add(c0, c3), c4, F2_ZERO];
  const t3 = f6Mul(f6Add(a[0], a[1]), t2);
  return [f6Add(t0, f6MulV(t1)), f6Sub(f6Sub(t3, t0), t1)];
}

// T ← 2T, devolvendo f · l_{T,T}(P).
function doublingStep(f, T, P1) {
  const { x, y } = T;
  const lam = f2Mul(FP2.mulInt(f2Sqr(x), 3), f2Inv(f2Add(y, y)));
  const x3 = f2Sub(f2Sqr(lam), f2Add(x, x));
  const y3 = f2Sub(f2Mul(lam, f2Sub(x, x3)), y);
  const c0 = [P1.y, 0n];
  const c3 = f2Neg(f2MulFp(lam, P1.x));
  const c4 = f2Sub(f2Mul(lam, x), y);
  T.x = x3; T.y = y3;
  return mulBy034(f, c0, c3, c4);
}

// T ← T + Q, devolvendo f · l_{T,Q}(P).
function additionStep(f, T, Q, P1) {
  if (T.inf) { T.x = Q.x; T.y = Q.y; T.inf = false; return f; }
  if (f2Eq(T.x, Q.x)) {
    if (f2Eq(T.y, Q.y)) return doublingStep(f, T, P1);
    // Reta VERTICAL (T = -Q): seu valor é xP - xT·w², que vive inteiramente em
    // Fp6. A exponenciação final eleva a p⁶-1, que aniquila todo Fp6 — é a
    // clássica "eliminação de denominadores". Então basta pular a multiplicação.
    // Isso acontece de propósito no último passo, onde T deve terminar em O.
    T.inf = true;
    return f;
  }
  const lam = f2Mul(f2Sub(Q.y, T.y), f2Inv(f2Sub(Q.x, T.x)));
  const x3 = f2Sub(f2Sub(f2Sqr(lam), T.x), Q.x);
  const y3 = f2Sub(f2Mul(lam, f2Sub(T.x, x3)), T.y);
  const c0 = [P1.y, 0n];
  const c3 = f2Neg(f2MulFp(lam, P1.x));
  const c4 = f2Sub(f2Mul(lam, T.x), T.y);
  T.x = x3; T.y = y3;
  return mulBy034(f, c0, c3, c4);
}

// π^i no twist: como π(ψ(x,y)) = ψ(x^(p^i)·γ_i², y^(p^i)·γ_i³), o Frobenius de
// E(Fp12) desce para E'(Fp2) apenas conjugando e escalando por constantes.
const twistFrobenius = (Q, i) => ({
  x: f2Mul(f2FrobP(Q.x, i), FROB6_C1[i]),
  y: f2Mul(f2FrobP(Q.y, i), TWIST_FROB_Y[i]),
  inf: false,
});

// Produto dos laços de Miller de vários pares (mais barato que um por par:
// os quadrados de Fp12 são compartilhados).
function millerLoop(pairs) {
  let f = F12_ONE;
  const T = pairs.map((pr) => ({ x: pr.Q.x, y: pr.Q.y, inf: false }));
  const bits = SIX_X_PLUS_2.toString(2);
  for (let i = 1; i < bits.length; i++) {
    f = f12Sqr(f);
    for (let j = 0; j < pairs.length; j++) f = doublingStep(f, T[j], pairs[j].P);
    if (bits[i] === '1') {
      for (let j = 0; j < pairs.length; j++) f = additionStep(f, T[j], pairs[j].Q, pairs[j].P);
    }
  }
  // Correção do ate ótimo: (6x+2) + p - p² ≡ 0 (mod r), então depois do laço
  // ainda falta somar π(Q) e subtrair π²(Q) — as duas retas correspondentes
  // entram no acumulador. Ao fim, T deve ser o ponto no infinito.
  for (let j = 0; j < pairs.length; j++) {
    const Q = pairs[j].Q;
    const Q1 = twistFrobenius(Q, 1);
    const Q2 = twistFrobenius(Q, 2);
    f = additionStep(f, T[j], Q1, pairs[j].P);
    f = additionStep(f, T[j], { x: Q2.x, y: f2Neg(Q2.y) }, pairs[j].P);
  }
  return f;
}

// Expoente da "parte difícil" da exponenciação final. Calculado como BigInt e
// aplicado com uma exponenciação genérica: existem cadeias de adição bem mais
// rápidas (Devegili/Scott), mas elas são notoriamente fáceis de transcrever
// errado e aqui o custo já está dominado pelo laço de Miller.
const HARD_EXP = (P ** 4n - P ** 2n + 1n) / R;

// f ↦ f^((p¹²-1)/r), que projeta o resultado no grupo de raízes r-ésimas da
// unidade. Fatoração: (p¹²-1)/r = (p⁶-1) · (p²+1) · (p⁴-p²+1)/r.
function finalExponentiate(f) {
  // parte fácil 1: f^(p⁶-1) = conj(f)/f  (conj = Frobenius de ordem 6)
  let t = f12Mul(f12Conj(f), f12Inv(f));
  // parte fácil 2: f^(p²+1)
  t = f12Mul(f12Frob(t, 2), t);
  // parte difícil
  return f12Pow(t, HARD_EXP);
}

// ---------------------------------------------------------------------------
// Codificação / validação de entrada
// ---------------------------------------------------------------------------

class Bn254Error extends Error {}

const rightPad = (b, n) => {
  if (b.length >= n) return b;
  const o = Buffer.alloc(n);
  b.copy(o);
  return o;
};

// Lê 32 bytes big-endian como elemento de Fp. Coordenada >= p é INVÁLIDA
// (senão haveria múltiplas codificações do mesmo ponto — maleabilidade).
function readFp(buf, off) {
  const v = BigInt('0x' + buf.subarray(off, off + 32).toString('hex'));
  if (v >= P) throw new Bn254Error('BN254: coordenada >= p');
  return v;
}

const write32 = (v) => Buffer.from(v.toString(16).padStart(64, '0'), 'hex');

// Ponto de G1: (0,0) é a codificação canônica do infinito (EIP-196).
function readG1(buf, off) {
  const x = readFp(buf, off);
  const y = readFp(buf, off + 32);
  if (x === 0n && y === 0n) return null;
  const pt = { x, y };
  if (!onCurveG1(pt)) throw new Bn254Error('BN254: ponto G1 fora da curva');
  // G1 tem cofator 1: estar na curva já implica estar no subgrupo de ordem r.
  return pt;
}

function writeG1(pt) {
  if (pt === null) return Buffer.alloc(64);
  return Buffer.concat([write32(pt.x), write32(pt.y)]);
}

// Ponto de G2. ATENÇÃO À ORDEM: o EIP-197 codifica cada elemento de Fp2 com a
// parte IMAGINÁRIA primeiro, depois a real — ou seja, os 128 bytes são
// (x_im, x_re, y_im, y_re). Trocar isso é o bug clássico deste precompile.
function readG2(buf, off) {
  const xIm = readFp(buf, off);
  const xRe = readFp(buf, off + 32);
  const yIm = readFp(buf, off + 64);
  const yRe = readFp(buf, off + 96);
  const x = [xRe, xIm]; // internamente é [real, imaginário]
  const y = [yRe, yIm];
  if (f2IsZero(x) && f2IsZero(y)) return null;
  const pt = { x, y };
  if (!onCurveG2(pt)) throw new Bn254Error('BN254: ponto G2 fora da curva');
  // CRÍTICO: E'(Fp2) tem cofator grande, então "estar na curva" NÃO implica
  // ordem r. Um ponto de outra componente permitiria forjar emparelhamentos.
  if (curveMul(FP2, R, pt) !== null) throw new Bn254Error('BN254: ponto G2 fora do subgrupo de ordem r');
  return pt;
}

// ---------------------------------------------------------------------------
// Precompiles — contrato do host: (input) => { gas, run }
// ---------------------------------------------------------------------------
// O gás é fixo/derivado só do TAMANHO da entrada, calculado antes de qualquer
// trabalho pesado; run() só é chamado se o host tiver gás para pagar (A-5).

// 0x06 — ecAdd. Entrada: 128 bytes (x1,y1,x2,y2). Saída: 64 bytes.
export function ecAdd(input) {
  return { gas: 150n * CHAIN.BN254_GAS_MULTIPLIER, run: () => {
    const d = rightPad(input, 128);
    const a = readG1(d, 0);
    const b = readG1(d, 64);
    return writeG1(curveAdd(FP, a, b));
  } };
}

// 0x07 — ecMul. Entrada: 96 bytes (x, y, escalar). Saída: 64 bytes.
export function ecMul(input) {
  return { gas: 6000n * CHAIN.BN254_GAS_MULTIPLIER, run: () => {
    const d = rightPad(input, 96);
    const pt = readG1(d, 0);
    // O escalar não é validado: qualquer inteiro de 256 bits é aceito e a
    // multiplicação é feita módulo a ordem do grupo.
    const k = BigInt('0x' + d.subarray(64, 96).toString('hex')) % R;
    return writeG1(curveMul(FP, k, pt));
  } };
}

// 0x08 — ecPairing. Entrada: k blocos de 192 bytes (G1 64B + G2 128B).
// Saída: 32 bytes, 1 se ∏ e(P_i, Q_i) == 1, senão 0.
export function ecPairing(input) {
  if (input.length % 192 !== 0) throw new Bn254Error('BN254: entrada do pairing não é múltiplo de 192');
  const k = input.length / 192;
  return { gas: (34000n * BigInt(k) + 45000n) * CHAIN.BN254_GAS_MULTIPLIER, run: () => {
    const pairs = [];
    for (let i = 0; i < k; i++) {
      const off = i * 192;
      const P1 = readG1(input, off);
      const Q = readG2(input, off + 64);
      // Um par com ponto no infinito contribui e(O, Q) = e(P, O) = 1: podemos
      // descartá-lo, mas só DEPOIS de validar ambos os pontos.
      if (P1 !== null && Q !== null) pairs.push({ P: P1, Q });
    }
    // Produto vazio (inclusive entrada vazia) = elemento neutro ⇒ resultado 1.
    const ok = pairs.length === 0 || f12Eq(finalExponentiate(millerLoop(pairs)), F12_ONE);
    return write32(ok ? 1n : 0n);
  } };
}

// Exportado só para os testes exercitarem a torre de corpos e a validação
// diretamente (a integração no host.js usa apenas as três funções acima).
export const __internals = {
  P, R, XI, B_G2, HARD_EXP, SIX_X_PLUS_2,
  f2Mul, f2Sqr, f2Inv, f2Pow, f2Eq, f2Conj,
  f6Mul, f6Inv, f6Eq, F6_ONE,
  f12Mul, f12Sqr, f12Inv, f12Pow, f12Frob, f12Eq, F12_ONE,
  FP, FP2, curveMul, curveAdd, onCurveG1, onCurveG2,
  millerLoop, finalExponentiate, readG1, readG2, Bn254Error,
};
