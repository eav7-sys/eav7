import { createHash } from 'node:crypto';
import { CHAIN } from '../config.js';

export function sha3(data) {
  return createHash('sha3-256').update(data).digest();
}

// Serialização canônica: JSON com chaves ordenadas, determinística entre nós.
export function canonical(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = sortValue(value[key]);
    }
    return out;
  }
  return value;
}

// Hash do protocolo eav20: SHA3-256 COMPLETA, 64 hex minúsculos, sem prefixo —
// o mesmo formato de txid usado por TRON, Bitcoin e (sem o 0x) Ethereum.
// Toda hash da rede usa isto: bloco, transação, token, raiz de Merkle, IA.
//
// O prefixo "E7" pertence ao ENDEREÇO, não à hash. Marcar hash custava 8 bits do
// digest (248 em vez de 256) para rotular um dado que ninguém digita nem precisa
// atribuir a uma cadeia. Removê-lo padroniza com o mercado E devolve os 8 bits.
const HEX64 = /^[0-9a-f]{64}$/;

export function eavHash(...parts) {
  const hasher = createHash('sha3-256');
  for (const part of parts) {
    hasher.update(typeof part === 'string' || Buffer.isBuffer(part) ? part : canonical(part));
  }
  return hasher.digest('hex');
}

export function isValidHash(value) {
  return typeof value === 'string' && HEX64.test(value);
}

export function merkleRoot(ids) {
  if (ids.length === 0) return eavHash('EAV7-EMPTY-ROOT');
  let level = ids.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(eavHash(level[i] + (level[i + 1] ?? level[i])));
    }
    level = next;
  }
  return level[0];
}
