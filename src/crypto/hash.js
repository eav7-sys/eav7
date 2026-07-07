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

// Hash do protocolo eav20: SHA3-256 truncada para 64 caracteres hex (mesmo
// comprimento do txid da Tron), sempre prefixada com "E7". Toda hash da rede
// EAV7 — blocos, transações, tokens, resultados de IA — usa este formato.
const BODY_LENGTH = CHAIN.HASH_LENGTH - CHAIN.HASH_PREFIX.length;

export function eavHash(...parts) {
  const hasher = createHash('sha3-256');
  for (const part of parts) {
    hasher.update(typeof part === 'string' || Buffer.isBuffer(part) ? part : canonical(part));
  }
  return CHAIN.HASH_PREFIX + hasher.digest('hex').toUpperCase().slice(0, BODY_LENGTH);
}

export function isValidHash(value) {
  return typeof value === 'string'
    && value.length === CHAIN.HASH_LENGTH
    && value.startsWith(CHAIN.HASH_PREFIX)
    && /^[0-9A-F]+$/.test(value.slice(CHAIN.HASH_PREFIX.length));
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
