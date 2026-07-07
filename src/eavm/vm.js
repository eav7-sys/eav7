// EAVM — máquina virtual da EAV7 (mesmo conceito da TVM/EVM: executa bytecode de
// 256 bits), do zero em Node puro. O GÁS é medido em ENERGIA (o recurso da rede).
//
// Fase 2.1: núcleo (pilha, aritmética, memória, storage, fluxo, KECCAK, LOG, RETURN/REVERT).
// Fase 2.2: chamadas entre contratos (CALL/CALLCODE/DELEGATECALL/STATICCALL),
//           criação (CREATE/CREATE2), RETURNDATA, EXTCODE*, BALANCE e precompiles.
//
// O acesso ao "mundo" (storage de outras contas, código, saldo, chamadas e criação)
// é feito por um objeto `host` — o State fornece um host com journaling para reverter
// mudanças de sub-chamadas que falham. Sem host, opera em modo contrato-único.
import { keccak256 } from './keccak.js';

const TWO256 = 1n << 256n;
const MASK = TWO256 - 1n;
const SIGN = 1n << 255n;
const u256 = (x) => ((x % TWO256) + TWO256) & MASK;
const toSigned = (x) => ((x & SIGN) ? x - TWO256 : x);

export const GAS = {
  ZERO: 0, BASE: 2, VERYLOW: 3, LOW: 5, MID: 8, HIGH: 10,
  KECCAK: 30, KECCAK_WORD: 6, SLOAD: 100, SSTORE_SET: 2000, SSTORE_RESET: 800,
  MEM_WORD: 3, COPY_WORD: 3, LOG: 375, LOG_TOPIC: 375, LOG_DATA: 8, JUMPDEST: 1,
  CALL: 100, CALL_VALUE: 9000, CREATE: 3200, CODE_DEPOSIT_BYTE: 20, EXTCODE: 100, // CALL_VALUE financia o stipend de 2300 (como no EVM)
};
// Profundidade máxima de chamadas. MUITO abaixo do limite de pilha do JS (~780
// níveis estouram a pilha do V8), para que o limite DETERMINÍSTICO dispare em TODOS
// os nós antes de qualquer stack-overflow não-determinístico — senão nós com limites
// de pilha diferentes divergiriam (fork de consenso, achado M-1). Raiz definitiva:
// interpretador iterativo (pilha de frames em heap) — item de pré-mainnet.
export const MAX_CALL_DEPTH = 128;
export class EavmError extends Error {}

const ZERO_ADDR = '0x' + '00'.repeat(20);

function analyzeJumpdests(code) {
  const set = new Set();
  for (let i = 0; i < code.length; i++) {
    const op = code[i];
    if (op === 0x5b) set.add(i);
    else if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  return set;
}

export function runEavm(opts) {
  const {
    code, calldata = Buffer.alloc(0), gas,
    caller = ZERO_ADDR, address = ZERO_ADDR, origin = null, value = 0n,
    block = {}, gasPrice = 0n, depth = 0, static: isStatic = false,
  } = opts;
  // host: acesso ao mundo. Em modo contrato-único (testes simples), um host padrão
  // sobre um objeto `storage` é criado; CALL/CREATE ficam indisponíveis.
  const host = opts.host ?? simpleHost(opts.storage ?? {});
  const self = normAddr(address);
  const org = origin ?? caller;

  const codeBuf = toBuf(code);
  const cd = toBuf(calldata);
  const stack = [];
  let mem = Buffer.alloc(0); // buffer físico; a capacidade (mem.length) cresce dobrando
  let memWords = 0;          // tamanho LÓGICO em palavras (base do gás), separado da capacidade
  let pc = 0;
  let gasLeft = BigInt(gas);
  let lastReturn = Buffer.alloc(0);
  const logs = [];
  const jumpdests = analyzeJumpdests(codeBuf);

  const spend = (g) => { gasLeft -= BigInt(g); if (gasLeft < 0n) throw new EavmError('sem gás (energia insuficiente)'); };
  const push = (v) => { if (stack.length >= 1024) throw new EavmError('stack overflow'); stack.push(u256(v)); };
  const pop = () => { if (stack.length === 0) throw new EavmError('stack underflow'); return stack.pop(); };
  const peek = (n) => { if (stack.length <= n) throw new EavmError('stack underflow'); return stack[stack.length - 1 - n]; };
  const memExpand = (offset, size) => {
    if (size === 0n) return;
    const end = Number(offset + size);
    if (end > 1_000_000_00) throw new EavmError('expansão de memória excessiva'); // teto anti-OOM
    const words = Math.ceil(end / 32);
    if (words > memWords) { // gás cobrado sobre o crescimento LÓGICO (termo quadrático do EVM)
      const cost = (w) => GAS.MEM_WORD * w + Math.floor((w * w) / 512);
      spend(cost(words) - cost(memWords));
      memWords = words;
    }
    // realoca só quando estoura a capacidade FÍSICA, dobrando — evita copiar toda a
    // memória a cada palavra (era O(n²) de memcpy não coberto por gás, achado H-2).
    if (end > mem.length) {
      const grown = Buffer.alloc(Math.max(words * 32, mem.length * 2));
      mem.copy(grown);
      mem = grown;
    }
  };
  const memWrite = (o, bytes) => { memExpand(BigInt(o), BigInt(bytes.length)); bytes.copy(mem, Number(o)); };
  const memRead = (o, s) => { memExpand(BigInt(o), BigInt(s)); return Buffer.from(mem.subarray(Number(o), Number(o) + Number(s))); };
  // Cópia src->memória SEM alocar um buffer temporário do tamanho `size`: expande a
  // memória (que aplica o teto anti-OOM e o gás quadrático) ANTES de copiar, e usa
  // um VIEW da fonte (subarray). Impede OOM/RangeError por size gigante (H-2).
  const copyToMem = (dest, srcBuf, srcOff, size) => {
    memExpand(BigInt(dest), BigInt(size)); // caps + cobra gás antes de qualquer cópia
    const end = Math.min(srcOff + size, srcBuf.length);
    if (end > srcOff) srcBuf.subarray(srcOff, end).copy(mem, Number(dest)); // resto fica zero
  };
  const slotKey = (k) => '0x' + u256(k).toString(16).padStart(64, '0');

  try {
  while (pc < codeBuf.length) {
    const op = codeBuf[pc];
    let np = pc + 1;
    switch (op) {
      case 0x00: return done(true);
      case 0x01: spend(GAS.VERYLOW); push(pop() + pop()); break;
      case 0x02: spend(GAS.LOW); push(pop() * pop()); break;
      case 0x03: { spend(GAS.VERYLOW); const a = pop(), b = pop(); push(a - b); break; }
      case 0x04: { spend(GAS.LOW); const a = pop(), b = pop(); push(b === 0n ? 0n : a / b); break; }
      case 0x05: { spend(GAS.LOW); const a = toSigned(pop()), b = toSigned(pop()); push(b === 0n ? 0n : a / b); break; }
      case 0x06: { spend(GAS.LOW); const a = pop(), b = pop(); push(b === 0n ? 0n : a % b); break; }
      case 0x07: { spend(GAS.LOW); const a = toSigned(pop()), b = toSigned(pop()); push(b === 0n ? 0n : a % b); break; }
      case 0x08: { spend(GAS.MID); const a = pop(), b = pop(), n = pop(); push(n === 0n ? 0n : (a + b) % n); break; }
      case 0x09: { spend(GAS.MID); const a = pop(), b = pop(), n = pop(); push(n === 0n ? 0n : (a * b) % n); break; }
      case 0x0a: { const a = pop(), e = pop(); const eB = e === 0n ? 0 : Math.ceil(e.toString(16).length / 2); spend(GAS.HIGH + 50 * eB); push(modexp(a, e)); break; }
      case 0x0b: { spend(GAS.LOW); const b = pop(), x = pop(); push(signextend(b, x)); break; }
      case 0x10: { spend(GAS.VERYLOW); const a = pop(), b = pop(); push(a < b ? 1n : 0n); break; }
      case 0x11: { spend(GAS.VERYLOW); const a = pop(), b = pop(); push(a > b ? 1n : 0n); break; }
      case 0x12: { spend(GAS.VERYLOW); const a = toSigned(pop()), b = toSigned(pop()); push(a < b ? 1n : 0n); break; }
      case 0x13: { spend(GAS.VERYLOW); const a = toSigned(pop()), b = toSigned(pop()); push(a > b ? 1n : 0n); break; }
      case 0x14: { spend(GAS.VERYLOW); const a = pop(), b = pop(); push(a === b ? 1n : 0n); break; }
      case 0x15: spend(GAS.VERYLOW); push(pop() === 0n ? 1n : 0n); break;
      case 0x16: spend(GAS.VERYLOW); push(pop() & pop()); break;
      case 0x17: spend(GAS.VERYLOW); push(pop() | pop()); break;
      case 0x18: spend(GAS.VERYLOW); push(pop() ^ pop()); break;
      case 0x19: spend(GAS.VERYLOW); push(~pop()); break;
      case 0x1a: { spend(GAS.VERYLOW); const i = pop(), x = pop(); push(i >= 32n ? 0n : (x >> (8n * (31n - i))) & 0xffn); break; }
      case 0x1b: { spend(GAS.VERYLOW); const s = pop(), v = pop(); push(s >= 256n ? 0n : v << s); break; }
      case 0x1c: { spend(GAS.VERYLOW); const s = pop(), v = pop(); push(s >= 256n ? 0n : v >> s); break; }
      case 0x1d: { spend(GAS.VERYLOW); const s = pop(), v = toSigned(pop()); push(s >= 256n ? (v < 0n ? MASK : 0n) : v >> s); break; }
      case 0x20: { spend(GAS.KECCAK); const o = pop(), l = pop(); spend(GAS.KECCAK_WORD * Math.ceil(Number(l) / 32)); push(bufToBig(keccak256(memRead(o, l)))); break; }
      case 0x30: spend(GAS.BASE); push(addrToBig(self)); break; // ADDRESS
      case 0x31: { spend(GAS.EXTCODE); push(host.getBalance(addrHexFromWord(pop()))); break; } // BALANCE
      case 0x32: spend(GAS.BASE); push(addrToBig(org)); break; // ORIGIN
      case 0x33: spend(GAS.BASE); push(addrToBig(caller)); break; // CALLER
      case 0x34: spend(GAS.BASE); push(value); break; // CALLVALUE
      case 0x35: { spend(GAS.VERYLOW); const i = Number(pop()); push(bufToBig(rightPad(cd.subarray(i, i + 32), 32))); break; }
      case 0x36: spend(GAS.BASE); push(BigInt(cd.length)); break;
      case 0x37: { spend(GAS.VERYLOW); const d = pop(), o = Number(pop()), s = Number(pop()); spend(GAS.COPY_WORD * Math.ceil(s / 32)); copyToMem(d, cd, o, s); break; }
      case 0x38: spend(GAS.BASE); push(BigInt(codeBuf.length)); break;
      case 0x39: { spend(GAS.VERYLOW); const d = pop(), o = Number(pop()), s = Number(pop()); spend(GAS.COPY_WORD * Math.ceil(s / 32)); copyToMem(d, codeBuf, o, s); break; }
      case 0x3a: spend(GAS.BASE); push(gasPrice); break;
      case 0x3b: { spend(GAS.EXTCODE); push(BigInt(host.getCode(addrHexFromWord(pop())).length)); break; } // EXTCODESIZE
      case 0x3c: { spend(GAS.EXTCODE); const a = addrHexFromWord(pop()), d = pop(), o = Number(pop()), s = Number(pop()); spend(GAS.COPY_WORD * Math.ceil(s / 32)); copyToMem(d, host.getCode(a), o, s); break; } // EXTCODECOPY
      case 0x3d: spend(GAS.BASE); push(BigInt(lastReturn.length)); break; // RETURNDATASIZE
      case 0x3e: { spend(GAS.VERYLOW); const d = pop(), o = Number(pop()), s = Number(pop()); if (o + s > lastReturn.length) throw new EavmError('RETURNDATACOPY fora dos limites'); spend(GAS.COPY_WORD * Math.ceil(s / 32)); memWrite(d, lastReturn.subarray(o, o + s)); break; } // RETURNDATACOPY
      case 0x3f: { spend(GAS.EXTCODE); const ec = host.getCode(addrHexFromWord(pop())); spend(GAS.KECCAK_WORD * Math.ceil(ec.length / 32)); push(ec.length ? bufToBig(keccak256(ec)) : 0n); break; } // EXTCODEHASH — gás por palavra (H-1: keccak não pode ser 100 fixo)
      case 0x41: spend(GAS.BASE); push(0n); break;
      case 0x42: spend(GAS.BASE); push(BigInt(block.timestamp ?? 0)); break;
      case 0x43: spend(GAS.BASE); push(BigInt(block.number ?? 0)); break;
      case 0x44: spend(GAS.BASE); push(0n); break;
      case 0x45: spend(GAS.BASE); push(BigInt(block.gasLimit ?? 0)); break;
      case 0x46: spend(GAS.BASE); push(BigInt(block.chainId ?? 0)); break;
      case 0x47: spend(GAS.LOW); push(host.getBalance(self)); break; // SELFBALANCE
      case 0x48: spend(GAS.BASE); push(0n); break;
      case 0x50: spend(GAS.BASE); pop(); break;
      case 0x51: { spend(GAS.VERYLOW); const o = pop(); push(bufToBig(memRead(o, 32))); break; }
      case 0x52: { spend(GAS.VERYLOW); const o = pop(), v = pop(); memWrite(o, big32(v)); break; }
      case 0x53: { spend(GAS.VERYLOW); const o = pop(), v = pop(); memWrite(o, Buffer.from([Number(v & 0xffn)])); break; }
      case 0x54: { spend(GAS.SLOAD); push(host.sload(self, slotKey(pop()))); break; }
      case 0x55: { // SSTORE
        if (isStatic) throw new EavmError('SSTORE proibido em chamada estática');
        const k = slotKey(pop()), v = u256(pop());
        spend(host.sload(self, k) === 0n && v !== 0n ? GAS.SSTORE_SET : GAS.SSTORE_RESET);
        host.sstore(self, k, v);
        break;
      }
      case 0x56: { spend(GAS.MID); const t = Number(pop()); if (!jumpdests.has(t)) throw new EavmError('JUMP inválido'); np = t; break; }
      case 0x57: { spend(GAS.HIGH); const t = Number(pop()), c = pop(); if (c !== 0n) { if (!jumpdests.has(t)) throw new EavmError('JUMPI inválido'); np = t; } break; }
      case 0x58: spend(GAS.BASE); push(BigInt(pc)); break;
      case 0x59: spend(GAS.BASE); push(BigInt(mem.length)); break;
      case 0x5a: spend(GAS.BASE); push(gasLeft); break;
      case 0x5b: spend(GAS.JUMPDEST); break;
      case 0x5f: spend(GAS.BASE); push(0n); break;
      case 0xa0: case 0xa1: case 0xa2: case 0xa3: case 0xa4: {
        if (isStatic) throw new EavmError('LOG proibido em chamada estática');
        const n = op - 0xa0, o = pop(), s = pop(), topics = [];
        for (let i = 0; i < n; i++) topics.push('0x' + u256(pop()).toString(16).padStart(64, '0'));
        spend(GAS.LOG + GAS.LOG_TOPIC * n + GAS.LOG_DATA * Number(s));
        logs.push({ address: self, topics, data: '0x' + memRead(o, s).toString('hex') });
        break;
      }
      // --- criação de contrato ---
      case 0xf0: case 0xf5: { // CREATE / CREATE2
        if (isStatic) throw new EavmError('CREATE proibido em chamada estática');
        spend(GAS.CREATE);
        const val = pop(), o = pop(), s = pop();
        const salt = op === 0xf5 ? pop() : null;
        const init = memRead(o, s);
        const forward = gasLeft - gasLeft / 64n; // regra 63/64
        const r = host.create({ caller: self, value: val, initCode: init, gas: forward, salt, depth: depth + 1, block, origin: org, gasPrice });
        spend(r.gasUsed);
        lastReturn = r.success ? Buffer.alloc(0) : (r.returnData ?? Buffer.alloc(0));
        if (r.logs) for (const lg of r.logs) logs.push(lg); // mescla logs do construtor (H-1)
        push(r.success ? addrToBig(r.address) : 0n);
        break;
      }
      // --- chamadas ---
      case 0xf1: case 0xf2: case 0xf4: case 0xfa: { // CALL / CALLCODE / DELEGATECALL / STATICCALL
        const kind = op;
        spend(GAS.CALL);
        const reqGas = pop(); // limite de gás pedido pelo chamador (A-1: NÃO ignorar)
        const to = addrHexFromWord(pop());
        const hasValue = (kind === 0xf1 || kind === 0xf2);
        const callValue = hasValue ? pop() : 0n;
        if (hasValue && callValue > 0n && isStatic) throw new EavmError('transferência proibida em chamada estática');
        const ao = pop(), as = pop(), ro = pop(), rs = pop();
        if (hasValue && callValue > 0n) spend(GAS.CALL_VALUE);
        const input = memRead(ao, as);
        memExpand(BigInt(ro), BigInt(rs)); // L-1: cobra a expansão da região de retorno ANTES do split 63/64
        // forward = min(pedido, tudo-menos-1/64) — respeita CALL{gas:N} (reentrancy guard)
        const cap = gasLeft - gasLeft / 64n;
        let forward = reqGas < cap ? reqGas : cap;
        if (hasValue && callValue > 0n) forward += 2300n; // estipêndio do EVM (financiado pelo GAS.CALL_VALUE=9000) — L-1
        if (forward > gasLeft) forward = gasLeft; // clamp: nunca encaminha mais que o gás disponível (evita revert duro do pai)
        const r = host.call({
          kind, caller: self, to, value: callValue, input, gas: forward,
          static: isStatic || kind === 0xfa, delegate: kind === 0xf4, codeAddr: to,
          // DELEGATECALL/CALLCODE executam no contexto (address/storage) do chamador
          execAddress: (kind === 0xf4 || kind === 0xf2) ? self : to,
          execCaller: kind === 0xf4 ? caller : self, execValue: kind === 0xf4 ? value : callValue,
          depth: depth + 1, block, origin: org, gasPrice,
        });
        spend(r.gasUsed);
        lastReturn = r.returnData ?? Buffer.alloc(0);
        const n = Math.min(Number(rs), lastReturn.length);
        if (n > 0) memWrite(ro, lastReturn.subarray(0, n));
        if (r.logs) for (const lg of r.logs) logs.push(lg); // mescla logs da sub-chamada (H-1)
        push(r.success ? 1n : 0n);
        break;
      }
      case 0xf3: { const o = pop(), s = pop(); return done(true, memRead(o, s)); } // RETURN
      case 0xfd: { const o = pop(), s = pop(); return done(false, memRead(o, s)); } // REVERT
      case 0xfe: throw new EavmError('opcode inválido (INVALID)');
      case 0xff: throw new EavmError('SELFDESTRUCT não suportado');
      default:
        if (op >= 0x60 && op <= 0x7f) { spend(GAS.VERYLOW); const n = op - 0x5f; push(bufToBig(rightPad(codeBuf.subarray(pc + 1, pc + 1 + n), n))); np = pc + 1 + n; }
        else if (op >= 0x80 && op <= 0x8f) { spend(GAS.VERYLOW); push(peek(op - 0x80)); }
        else if (op >= 0x90 && op <= 0x9f) { spend(GAS.VERYLOW); const n = op - 0x8f, i = stack.length - 1, j = stack.length - 1 - n; if (j < 0) throw new EavmError('stack underflow'); [stack[i], stack[j]] = [stack[j], stack[i]]; }
        else throw new EavmError(`opcode desconhecido: 0x${op.toString(16)}`);
    }
    pc = np;
  }
  } catch (e) {
    if (e instanceof EavmError) throw e; // out-of-gas/revert normal → tratado pelo host.call
    gasLeft = 0n; // qualquer outro erro (ex.: stack overflow) → frame falha, gás todo consumido
    return done(false);
  }
  return done(true);

  function done(success, ret = Buffer.alloc(0)) {
    // storage é exposto apenas no modo contrato-único (simpleHost) — compat com
    // os testes de opcode. No modo host de estado, o estado vive no próprio host.
    return { success, returnData: ret, gasUsed: BigInt(gas) - gasLeft, gasLeft, logs, storage: host._storage };
  }
}

// host mínimo (contrato-único) para testes que não exercem CALL/CREATE.
function simpleHost(storage) {
  return {
    sload: (_a, k) => BigInt(storage[k] ?? 0n),
    sstore: (_a, k, v) => { if (v === 0n) delete storage[k]; else storage[k] = '0x' + v.toString(16).padStart(64, '0'); },
    getCode: () => Buffer.alloc(0),
    getBalance: () => 0n,
    call: () => { throw new EavmError('CALL indisponível sem host de estado'); },
    create: () => { throw new EavmError('CREATE indisponível sem host de estado'); },
    _storage: storage,
  };
}

// ---- helpers ----
function toBuf(x) { return Buffer.isBuffer(x) ? x : Buffer.from(String(x ?? '').replace(/^0x/, ''), 'hex'); }
function bufToBig(buf) { return buf.length ? BigInt('0x' + buf.toString('hex')) : 0n; }
function big32(v) { return Buffer.from(u256(v).toString(16).padStart(64, '0'), 'hex'); }
function normAddr(a) { return typeof a === 'string' && a.startsWith('0x') ? a.toLowerCase() : ('0x' + String(a)); }
function addrToBig(a) { return BigInt(typeof a === 'string' && a.startsWith('0x') ? a : '0x' + a) & ((1n << 160n) - 1n); }
function addrHexFromWord(w) { return '0x' + (u256(w) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0'); }
function rightPad(buf, len) { if (buf.length >= len) return Buffer.from(buf.subarray(0, len)); const out = Buffer.alloc(len); buf.copy(out); return out; }
function modexp(base, exp) { let r = 1n; base = u256(base); while (exp > 0n) { if (exp & 1n) r = u256(r * base); base = u256(base * base); exp >>= 1n; } return r; }
function signextend(b, x) { if (b >= 32n) return x; const bit = b * 8n + 7n; const mask = (1n << bit) - 1n; return (x >> bit) & 1n ? x | (MASK ^ mask) : x & mask; }
