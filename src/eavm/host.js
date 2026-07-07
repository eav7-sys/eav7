// Host de estado mundial da EAVM: dá à VM (vm.js) acesso a storage/código/saldo
// de outras contas e implementa CALL/CREATE (recursivos) e os precompiles, com
// ISOLAMENTO por snapshot — uma sub-chamada que reverte desfaz suas mudanças.
//
// Parametrizado por um `world` de baixo nível (o State fornece um; os testes,
// um em memória), o que mantém a lógica de chamada/precompile testável e única.
import crypto from 'node:crypto';
import { runEavm, EavmError, MAX_CALL_DEPTH } from './vm.js';
import { recover, ethAddressFromPoint, N } from './secp256k1.js';
import { ripemd160 } from './ripemd160.js';

const bufBig = (b) => (b.length ? BigInt('0x' + b.toString('hex')) : 0n);
const pad32 = (b) => { const o = Buffer.alloc(32); b.copy(o, 32 - Math.min(b.length, 32)); return o; };
const rightPad = (b, n) => { if (b.length >= n) return b.subarray(0, n); const o = Buffer.alloc(n); b.copy(o); return o; };
const addrHex = (n) => '0x' + (typeof n === 'bigint' ? n : BigInt(n)).toString(16).padStart(40, '0');

// ---- precompiles (0x01..0x05) ----
// Cada um retorna { gas, run } — o host cobra o gás ANTES de chamar run() (A-5),
// então trabalho pesado (ex.: modexp) só é computado se houver gás suficiente.
function pIdentity(input) { return { gas: 15n + 3n * BigInt(Math.ceil(input.length / 32)), run: () => Buffer.from(input) }; }
function pSha256(input) { return { gas: 60n + 12n * BigInt(Math.ceil(input.length / 32)), run: () => crypto.createHash('sha256').update(input).digest() }; }
function pRipemd160(input) { return { gas: 600n + 120n * BigInt(Math.ceil(input.length / 32)), run: () => pad32(ripemd160(input)) }; } // impl pura (determinística entre builds)
function pEcrecover(input) {
  // secp256k1 otimizado (Jacobiano) ~2,4ms/recover. O gás elevado (rastreando o
  // CPU real) limita ~60 recovers por tx (~145ms), contendo DoS de CPU sem quebrar
  // o uso legítimo (multisig/permit costumam usar poucos ecrecovers).
  return { gas: 500_000n, run: () => {
    const d = rightPad(input, 128);
    const hashBuf = d.subarray(0, 32); // recover espera um Buffer (faz bufToBig internamente)
    const v = Number(bufBig(d.subarray(32, 64)));
    const r = bufBig(d.subarray(64, 96)), s = bufBig(d.subarray(96, 128));
    try {
      // v deve ser 27/28 e r,s ∈ [1, N-1] — senão a recuperação daria endereço espúrio.
      if ((v !== 27 && v !== 28) || r === 0n || s === 0n || r >= N || s >= N) return Buffer.alloc(0);
      const point = recover(hashBuf, r, s, BigInt(v - 27)); // recId como BigInt (recover mistura com N BigInt)
      if (!point) return Buffer.alloc(0);
      return pad32(Buffer.from(ethAddressFromPoint(point).slice(2), 'hex'));
    } catch { return Buffer.alloc(0); }
  } };
}
const MODEXP_MAX_LEN = 1024; // teto de operando (bytes) — impede OOM/DoS por length gigante
function pModexp(input) {
  const d = rightPad(input, 96);
  const bl = Number(bufBig(d.subarray(0, 32))), el = Number(bufBig(d.subarray(32, 64))), ml = Number(bufBig(d.subarray(64, 96)));
  if (bl > MODEXP_MAX_LEN || el > MODEXP_MAX_LEN || ml > MODEXP_MAX_LEN) throw new EavmError('MODEXP: operando excede o limite');
  const body = input.subarray(96);
  const base = bufBig(rightPad(body.subarray(0, bl), bl));
  const exp = bufBig(rightPad(body.subarray(bl, bl + el), el));
  const mod = bufBig(rightPad(body.subarray(bl + el, bl + el + ml), ml));
  // gás calculado dos comprimentos/expoente (barato) ANTES do laço pesado (A-5)
  const words = Math.ceil(Math.max(bl, ml) / 8);
  const expBits = exp === 0n ? 0 : exp.toString(2).length;
  const gas = BigInt(Math.max(200, words * words * Math.max(1, expBits)));
  return { gas, run: () => {
    let out = 0n;
    if (mod !== 0n) { let b = base % mod, e = exp, r = 1n; while (e > 0n) { if (e & 1n) r = (r * b) % mod; b = (b * b) % mod; e >>= 1n; } out = r; }
    return rightPad(Buffer.from(out.toString(16).padStart(ml * 2, '0'), 'hex'), ml);
  } };
}
const PRECOMPILES = {
  [addrHex(1)]: pEcrecover, [addrHex(2)]: pSha256, [addrHex(3)]: pRipemd160,
  [addrHex(4)]: pIdentity, [addrHex(5)]: pModexp,
};

export function createHost(world) {
  const host = {
    sload: (a, k) => world.getStorage(a.toLowerCase(), k),
    sstore: (a, k, v) => world.setStorage(a.toLowerCase(), k, v),
    getCode: (a) => world.getCode(a.toLowerCase()),
    getBalance: (a) => world.getBalance(a.toLowerCase()),

    call(p) {
      if (p.depth >= MAX_CALL_DEPTH) return fail();
      const to = p.to.toLowerCase();
      const pre = PRECOMPILES[to];
      if (pre) {
        const snap = world.snapshot();
        if (p.value > 0n && !p.delegate) {
          if (world.getBalance(p.caller.toLowerCase()) < p.value) { world.revert(snap); return fail(); }
          // L-2: credita p.execAddress (não `to`) — em CALLCODE ao precompile é self→self (soma zero)
          world.addBalance(p.caller.toLowerCase(), -p.value); world.addBalance(p.execAddress.toLowerCase(), p.value);
        }
        try {
          const { gas, run } = pre(p.input); // gás calculado ANTES do trabalho pesado
          if (gas > p.gas) { world.revert(snap); return { success: false, returnData: Buffer.alloc(0), gasUsed: p.gas }; } // sem gás → não computa
          return { success: true, returnData: run(), gasUsed: gas };
        } catch { world.revert(snap); return { success: false, returnData: Buffer.alloc(0), gasUsed: p.gas }; }
      }
      const snap = world.snapshot();
      try {
        if (p.value > 0n && !p.delegate) {
          if (world.getBalance(p.caller.toLowerCase()) < p.value) { world.revert(snap); return fail(); }
          world.addBalance(p.caller.toLowerCase(), -p.value);
          world.addBalance(p.execAddress.toLowerCase(), p.value);
        }
        const code = world.getCode(p.codeAddr.toLowerCase());
        if (code.length === 0) return { success: true, returnData: Buffer.alloc(0), gasUsed: 0n };
        const res = runEavm({
          host, code, calldata: p.input, gas: p.gas,
          caller: p.execCaller, address: p.execAddress, value: p.execValue,
          origin: p.origin, gasPrice: p.gasPrice, depth: p.depth, static: p.static, block: p.block,
        });
        if (!res.success) world.revert(snap);
        // H-1 isolamento: logs só de sub-chamada BEM-SUCEDIDA (revertida não vaza log)
        return { success: res.success, returnData: res.returnData, gasUsed: res.gasUsed, logs: res.success ? (res.logs ?? []) : [] };
      } catch (e) {
        world.revert(snap);
        if (e instanceof EavmError) return { success: false, returnData: Buffer.alloc(0), gasUsed: p.gas };
        throw e;
      }
    },

    create(p) {
      if (p.depth >= MAX_CALL_DEPTH) return { success: false, address: addrHex(0), returnData: Buffer.alloc(0), gasUsed: 0n };
      const nonce = world.bumpNonce(p.caller.toLowerCase());
      const address = p.salt != null ? world.create2Address(p.caller.toLowerCase(), p.salt, p.initCode) : world.createAddress(p.caller.toLowerCase(), nonce);
      // B-1: como no EVM, CREATE para um endereço que já tem código falha (retorna 0).
      if (world.getCode(address).length > 0) return { success: false, address, returnData: Buffer.alloc(0), gasUsed: 0n };
      const snap = world.snapshot();
      try {
        if (p.value > 0n) {
          if (world.getBalance(p.caller.toLowerCase()) < p.value) { world.revert(snap); return { success: false, address, returnData: Buffer.alloc(0), gasUsed: 0n }; }
          world.addBalance(p.caller.toLowerCase(), -p.value); world.addBalance(address, p.value);
        }
        const res = runEavm({
          host, code: p.initCode, calldata: Buffer.alloc(0), gas: p.gas,
          caller: p.caller, address, value: p.value, origin: p.origin, gasPrice: p.gasPrice, depth: p.depth, static: false, block: p.block,
        });
        // construtor reverteu: gasUsed do construtor, com a razão do revert
        if (!res.success) { world.revert(snap); return { success: false, address, returnData: res.returnData, gasUsed: res.gasUsed, logs: [] }; }
        // M-1: o gás de depósito do código (len×20) precisa CABER no gás encaminhado ao
        // construtor — senão é out-of-gas do CREATE (consome tudo, empilha 0), sem
        // invadir o 1/64 reservado do pai (evita reverter a tx inteira / griefing).
        const deposit = BigInt(res.returnData.length) * 20n;
        if (res.returnData.length > 24576 || res.gasUsed + deposit > p.gas) {
          world.revert(snap);
          return { success: false, address, returnData: Buffer.alloc(0), gasUsed: p.gas, logs: [] };
        }
        world.putCode(address, res.returnData);
        return { success: true, address, returnData: Buffer.alloc(0), gasUsed: res.gasUsed + deposit, logs: res.logs ?? [] };
      } catch (e) {
        world.revert(snap);
        if (e instanceof EavmError) return { success: false, address, returnData: Buffer.alloc(0), gasUsed: p.gas };
        throw e;
      }
    },
  };
  return host;

  function fail() { return { success: false, returnData: Buffer.alloc(0), gasUsed: 0n }; }
}

export { PRECOMPILES };
