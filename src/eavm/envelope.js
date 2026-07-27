// EAVM — a máquina de contas externa própria da EAV7 (como a TVM é da Tron).
//
// Carteiras universais (MetaMask, Trust Wallet) e a carteira web da EAV7 assinam
// transações Ethereum-style (secp256k1 + RLP + keccak, implementados do zero
// neste projeto) e o EAVM as embrulha numa transação eav20 validável.
//
// Operações nativas (STAKE/UNSTAKE) são expostas via ENDEREÇOS DE SISTEMA — a
// carteira envia uma transação normal cujo `to` é um endereço reservado, e o
// EAVM a traduz para a operação correspondente sobre a conta E7 mapeada. É o
// mesmo padrão dos "precompiles" do Ethereum.
import { CHAIN } from '../config.js';
import { eavHash } from '../crypto/hash.js';
import { deriveAddressFrom, isValidAddress } from '../crypto/keys.js';
import { decodeRawTransaction } from './tx.js';

export const EAVM_SCHEME = 'eav7-eavm-1';

// Endereços de sistema (não são contas reais — sinalizam operações nativas).
export const EAVM_STAKE_ADDRESS = '0x0000000000000000000000000000000000007001';
export const EAVM_UNSTAKE_ADDRESS = '0x0000000000000000000000000000000000007002';
const SYSTEM_OPS = { [EAVM_STAKE_ADDRESS]: 'STAKE', [EAVM_UNSTAKE_ADDRESS]: 'UNSTAKE' };
const opForTo = (to) => (to ? SYSTEM_OPS[to.toLowerCase()] ?? null : null);

// Destino E7 NATIVO no envelope: a carteira codifica um endereço E7 no campo `to`
// EVM (20 bytes) com o prefixo 0xe7000000 + 16 bytes (corpo + checksum do E7).
// A derivação valida o checksum embutido; sem prefixo/checksum válido, vale a
// regra padrão keccak→E7. Prefixo reservado: colisão com uma conta EVM real é
// 2^-32 e ainda exigiria checksum válido — na prática, impossível.
const E7_DEST_PREFIX = '0xe7000000';
export function decodeE7Dest(eavmAddress) {
  if (!isEavmAddress(eavmAddress)) return null;
  const h = eavmAddress.toLowerCase();
  if (!h.startsWith(E7_DEST_PREFIX)) return null;
  const e7 = 'E7' + h.slice(E7_DEST_PREFIX.length).toUpperCase();
  return isValidAddress(e7) ? e7 : null;
}
// Codificação inversa (para carteiras/ferramentas locais).
export function encodeE7Dest(e7) {
  if (!isValidAddress(e7)) throw new Error('endereço E7 inválido');
  return E7_DEST_PREFIX + e7.slice(2).toLowerCase();
}
const destE7For = (to) => decodeE7Dest(to) ?? eavmToE7(to);

export function isEavmAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

// Endereço E7 correspondente a uma conta EAVM (determinístico em toda a rede).
export function eavmToE7(eavmAddress) {
  if (!isEavmAddress(eavmAddress)) throw new Error('endereço EAVM inválido');
  return deriveAddressFrom('EAV7-EAVM:' + eavmAddress.toLowerCase());
}

function checkParsed(parsed) {
  if (parsed.chainId !== BigInt(CHAIN.EAVM_CHAIN_ID)) {
    return `chainId incorreto (a rede EAV7 usa ${CHAIN.EAVM_CHAIN_ID})`;
  }
  if (parsed.value % CHAIN.EAVM_WEI_PER_E7 !== 0n) {
    return 'valor com mais de 6 casas decimais de EAV7';
  }
  // Um endereço de sistema é uma OPERAÇÃO NATIVA (stake/unstake), não um contrato.
  // Aceitar calldata aqui deixaria dois significados para a mesma transação.
  if (opForTo(parsed.to) && parsed.dataHex !== '0x') {
    return 'endereço de sistema não aceita calldata';
  }
  if (parsed.dataHex.length > 2 + CHAIN.MAX_EAVM_CALLDATA * 2) {
    return `calldata acima do máximo (${CHAIN.MAX_EAVM_CALLDATA} bytes)`;
  }
  return null;
}

// Classifica a transação assinada. É a função que decide se um raw vira
// transferência, operação nativa, deploy ou chamada de contrato — e é usada
// IDÊNTICA na construção e na verificação, para não haver como divergirem.
function classify(parsed) {
  const op = opForTo(parsed.to);
  if (op) return { type: op, op };
  if (!parsed.to) return { type: 'EAVM_DEPLOY', op: null };
  if (parsed.dataHex !== '0x') return { type: 'EAVM_CALL', op: null };
  return { type: 'EAVM_TRANSFER', op: null };
}

export function buildEavmEnvelope(rawHex, { timestamp = Date.now(), state = null } = {}) {
  const raw = rawHex.toLowerCase();
  const parsed = decodeRawTransaction(raw);
  const problem = checkParsed(parsed);
  if (problem) throw new Error(problem);

  const { type, op } = classify(parsed);
  const from = eavmToE7(parsed.from);
  const feeExempt = state ? state.isFeeExempt(from) : false;
  return {
    protocol: CHAIN.PROTOCOL,
    scheme: EAVM_SCHEME,
    type,
    from,
    // Contratos não têm destino no campo do PROTOCOLO: o alvo vive em `data.to`
    // na forma 0x, que é a única que `#runEavmTx` entende. Espelha exatamente o
    // que a rota nativa EAVM_DEPLOY/EAVM_CALL já fazia.
    to: op || type === 'EAVM_DEPLOY' || type === 'EAVM_CALL' ? null : destE7For(parsed.to),
    amount: (parsed.value / CHAIN.EAVM_WEI_PER_E7).toString(),
    fee: (feeExempt ? 0n : CHAIN.FEES[type]).toString(),
    nonce: parsed.nonce + 1, // nonce EAVM começa em 0; nonce do protocolo, em 1
    timestamp,
    data: {
      raw,
      op,
      eavmFrom: parsed.from,
      eavmTo: parsed.to,
      eavmHash: parsed.eavmHash,
      eavmNonce: parsed.nonce,
      ...(type === 'EAVM_DEPLOY' ? { code: parsed.dataHex } : {}),
      ...(type === 'EAVM_CALL' ? { to: parsed.to.toLowerCase(), input: parsed.dataHex } : {}),
    },
    id: eavHash('EAV7-EAVM-TX:' + raw),
  };
}

// Validação stateless do envelope: TUDO é re-derivado do raw assinado e
// comparado campo a campo — um envelope adulterado nunca passa.
export function verifyEavmEnvelope(tx) {
  try {
    if (tx.protocol !== CHAIN.PROTOCOL) return 'protocolo inválido';
    if (tx.scheme !== EAVM_SCHEME) return `esquema inválido (esperado ${EAVM_SCHEME})`;
    const raw = tx.data?.raw;
    if (typeof raw !== 'string' || raw !== raw.toLowerCase() || !/^0x[0-9a-f]+$/.test(raw) || raw.length > 8192) {
      return 'transação raw inválida';
    }
    const parsed = decodeRawTransaction(raw);
    const problem = checkParsed(parsed);
    if (problem) return problem;

    const { type: expectedType, op } = classify(parsed);
    const isContract = expectedType === 'EAVM_DEPLOY' || expectedType === 'EAVM_CALL';
    if (tx.type !== expectedType) return 'tipo não corresponde à transação assinada';
    if (tx.fee !== CHAIN.FEES[expectedType].toString() && tx.fee !== '0') return 'taxa inválida';
    if (tx.from !== eavmToE7(parsed.from)) return 'from não corresponde à assinatura recuperada';
    if (op || isContract) {
      if (tx.to !== null) return 'operação nativa ou de contrato não deve ter destino';
    } else if (tx.to !== destE7For(parsed.to)) {
      return 'to não corresponde à transação assinada';
    }
    // O que a VM vai executar tem de vir do raw ASSINADO, byte a byte. Sem isto,
    // um relay poderia trocar o bytecode ou o calldata mantendo a assinatura.
    if (expectedType === 'EAVM_DEPLOY') {
      if (tx.data.code !== parsed.dataHex) return 'bytecode não corresponde ao raw assinado';
      if (tx.data.to != null || tx.data.input != null) return 'deploy não deve ter destino nem input';
    } else if (expectedType === 'EAVM_CALL') {
      if (tx.data.to !== parsed.to.toLowerCase()) return 'destino do contrato não corresponde ao raw';
      if (tx.data.input !== parsed.dataHex) return 'calldata não corresponde ao raw assinado';
      if (tx.data.code != null) return 'chamada não deve carregar bytecode';
    } else if (tx.data.code != null || tx.data.to != null || tx.data.input != null) {
      return 'transação simples não deve carregar dados de contrato';
    }
    if (tx.amount !== (parsed.value / CHAIN.EAVM_WEI_PER_E7).toString()) return 'amount não corresponde ao valor assinado';
    if (tx.nonce !== parsed.nonce + 1) return 'nonce não corresponde ao nonce EAVM';
    if (!Number.isSafeInteger(tx.timestamp) || tx.timestamp <= 0) return 'timestamp inválido';
    if (tx.data.eavmHash !== parsed.eavmHash || tx.data.eavmFrom !== parsed.from || tx.data.eavmTo !== parsed.to) {
      return 'metadados EAVM não conferem com o raw';
    }
    if ((tx.data.op ?? null) !== (op ?? null)) return 'operação não confere';
    if (tx.id !== eavHash('EAV7-EAVM-TX:' + raw)) return 'id da transação não confere';
    return null;
  } catch (err) {
    return `transação EAVM inválida: ${err.message}`;
  }
}
