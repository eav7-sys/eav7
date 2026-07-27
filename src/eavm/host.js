import { CHAIN } from '../config.js';
import { ecAdd, ecMul, ecPairing } from './bn254.js';
import { blake2f } from './blake2f.js';
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
// EIP-7823: teto de 1024 bytes para CADA operando (base/expoente/módulo). Antes era
// só uma defesa nossa contra OOM; agora é regra de consenso — estourar o teto é erro
// que consome TODO o gás (o catch do host devolve gasUsed: p.gas, como manda o EIP).
const MODEXP_MAX_LEN = 1024;
const bitLen = (x) => (x === 0n ? 0 : x.toString(2).length);

// EIP-7883 (Osaka), que revisa o EIP-2565: complexidade × iterações, piso 500.
// Diferenças herdadas do 2565 que o 7883 mudou: (a) some o /3, (b) o multiplicador
// do expoente > 32 bytes vai de 8 para 16, (c) a complexidade tem piso 16 e dobra
// (2·words²) quando base/módulo passam de 32 bytes.
function modexpGas(bl, el, ml, expHead) {
  const maxLen = Math.max(bl, ml);
  const words = Math.ceil(maxLen / 8);
  const complexity = maxLen > 32 ? 2 * words * words : 16;
  // `expHead` são os PRIMEIROS 32 bytes do expoente, não o expoente inteiro: o
  // custo cresce com o COMPRIMENTO (16 por byte além de 32), não com o valor da
  // cauda. Cotar pelo valor inteiro subprecificava um expoente de 1024 bytes com
  // bits altos zerados — era o furo da versão anterior desta função.
  let iters;
  if (el <= 32) iters = expHead === 0n ? 0 : bitLen(expHead) - 1;
  else iters = 16 * (el - 32) + Math.max(0, bitLen(expHead) - 1);
  return BigInt(Math.max(500, complexity * Math.max(iters, 1)));
}

function pModexp(input) {
  const d = rightPad(input, 96);
  const bl = Number(bufBig(d.subarray(0, 32))), el = Number(bufBig(d.subarray(32, 64))), ml = Number(bufBig(d.subarray(64, 96)));
  if (bl > MODEXP_MAX_LEN || el > MODEXP_MAX_LEN || ml > MODEXP_MAX_LEN) throw new EavmError('MODEXP: operando excede o limite');
  const body = input.subarray(96);
  // gás calculado dos comprimentos + cabeça do expoente (32 bytes) ANTES de
  // materializar os operandos e rodar o laço pesado (A-5).
  const headLen = Math.min(32, el);
  const gas = modexpGas(bl, el, ml, bufBig(rightPad(body.subarray(bl, bl + headLen), headLen)));
  return { gas, run: () => {
    if (bl === 0 && ml === 0) return Buffer.alloc(0);
    const base = bufBig(rightPad(body.subarray(0, bl), bl));
    const exp = bufBig(rightPad(body.subarray(bl, bl + el), el));
    const mod = bufBig(rightPad(body.subarray(bl + el, bl + el + ml), ml));
    let out = 0n;
    if (mod !== 0n) { let b = base % mod, e = exp, r = 1n; while (e > 0n) { if (e & 1n) r = (r * b) % mod; b = (b * b) % mod; e >>= 1n; } out = r; }
    return rightPad(Buffer.from(out.toString(16).padStart(ml * 2, '0'), 'hex'), ml);
  } };
}
// Precompiles disponíveis desde sempre.
const PRECOMPILES = {
  [addrHex(1)]: pEcrecover, [addrHex(2)]: pSha256, [addrHex(3)]: pRipemd160,
  [addrHex(4)]: pIdentity, [addrHex(5)]: pModexp,
};

// Precompiles que entram em EAVM_OSAKA_HEIGHT. Antes do fork, 0x06-0x09 não são
// precompiles: chamá-los cai no caminho de conta comum e devolve sucesso vazio,
// que é EXATAMENTE o que um nó antigo faz — sem isso, nó novo e nó velho
// divergiriam no mesmo bloco.
//
// Sem ecPairing não existe zero-knowledge na EAVM: Groth16, zk-rollup e prova de
// identidade dependem dele. É a lacuna mais consequente que este fork fecha.
const PRECOMPILES_OSAKA = {
  [addrHex(6)]: ecAdd, [addrHex(7)]: ecMul, [addrHex(8)]: ecPairing,
  [addrHex(9)]: blake2f,
};

export function createHost(world) {
  // Armazenamento TRANSIENTE (EIP-1153). Vive só nesta execução: some quando a
  // transação termina e NUNCA entra no stateRoot — é o ponto do EIP. Por isso é
  // um Map aqui, e não uma escrita no mundo.
  //
  // Nota de semântica: no EVM, TSTORE feito num frame que REVERTE é desfeito.
  // Aqui o mapa não participa do journal, então não é revertido. É divergência
  // conhecida e está marcada em teste — ver test/eavm-osaka.test.js.
  const transient = new Map();
  const tkey = (a, k) => a.toLowerCase() + ':' + k;

  const host = {
    sload: (a, k) => world.getStorage(a.toLowerCase(), k),
    sstore: (a, k, v) => world.setStorage(a.toLowerCase(), k, v),
    tload: (a, k) => transient.get(tkey(a, k)) ?? 0n,
    tstore: (a, k, v) => { if (v === 0n) transient.delete(tkey(a, k)); else transient.set(tkey(a, k), v); },
    // BLOCKHASH: lê o anel de histórico que o State mantém (EIP-2935). Fora da
    // janela de 256 blocos — ou para bloco futuro/atual — devolve 0, como no EVM.
    blockHash: (n, atual) => {
      if (typeof world.blockHash !== 'function') return 0n;
      if (n >= atual || n < 0n || atual - n > BigInt(CHAIN.BLOCKHASH_WINDOW)) return 0n;
      return world.blockHash(n);
    },
    getCode: (a) => world.getCode(a.toLowerCase()),
    getBalance: (a) => world.getBalance(a.toLowerCase()),

    call(p) {
      if (p.depth >= MAX_CALL_DEPTH) return fail();
      const to = p.to.toLowerCase();
      // A altura vem do bloco em execução, nunca de config do nó — é o que mantém
      // o conjunto de precompiles idêntico em toda a rede para um dado bloco.
      const osaka = (p.block?.number ?? 0) >= CHAIN.EAVM_OSAKA_HEIGHT;
      const pre = PRECOMPILES[to] ?? (osaka ? PRECOMPILES_OSAKA[to] : undefined);
      if (pre) {
        const snap = world.snapshot();
        if (p.value > 0n && !p.delegate) {
          // L-2: credita p.execAddress (não `to`) — em CALLCODE ao precompile é self→self (soma zero)
          if (!world.moveValue(p.caller.toLowerCase(), p.execAddress.toLowerCase(), p.value, 'call')) { world.revert(snap); return fail(); }
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
          if (!world.moveValue(p.caller.toLowerCase(), p.execAddress.toLowerCase(), p.value, 'call')) { world.revert(snap); return fail(); }
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
          if (!world.moveValue(p.caller.toLowerCase(), address, p.value, 'create')) { world.revert(snap); return { success: false, address, returnData: Buffer.alloc(0), gasUsed: 0n }; }
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
