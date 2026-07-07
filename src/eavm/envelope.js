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
import { deriveAddressFrom } from '../crypto/keys.js';
import { decodeRawTransaction } from './tx.js';

export const EAVM_SCHEME = 'eav7-eavm-1';

// Endereços de sistema (não são contas reais — sinalizam operações nativas).
export const EAVM_STAKE_ADDRESS = '0x0000000000000000000000000000000000007001';
export const EAVM_UNSTAKE_ADDRESS = '0x0000000000000000000000000000000000007002';
const SYSTEM_OPS = { [EAVM_STAKE_ADDRESS]: 'STAKE', [EAVM_UNSTAKE_ADDRESS]: 'UNSTAKE' };
const opForTo = (to) => (to ? SYSTEM_OPS[to.toLowerCase()] ?? null : null);

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
  if (!parsed.to) return 'implantação de contrato não é suportada pelo EAVM';
  if (parsed.dataHex !== '0x') return 'chamadas de contrato não são suportadas pelo EAVM';
  if (parsed.value % CHAIN.EAVM_WEI_PER_E7 !== 0n) {
    return 'valor com mais de 6 casas decimais de EAV7';
  }
  return null;
}

export function buildEavmEnvelope(rawHex, { timestamp = Date.now(), state = null } = {}) {
  const raw = rawHex.toLowerCase();
  const parsed = decodeRawTransaction(raw);
  const problem = checkParsed(parsed);
  if (problem) throw new Error(problem);

  const op = opForTo(parsed.to);
  const type = op ?? 'EAVM_TRANSFER';
  const from = eavmToE7(parsed.from);
  const feeExempt = state ? state.isFeeExempt(from) : false;
  return {
    protocol: CHAIN.PROTOCOL,
    scheme: EAVM_SCHEME,
    type,
    from,
    to: op ? null : eavmToE7(parsed.to), // operações nativas não têm destino
    amount: (parsed.value / CHAIN.EAVM_WEI_PER_E7).toString(),
    fee: (feeExempt ? 0n : CHAIN.FEES[type]).toString(),
    nonce: parsed.nonce + 1, // nonce EAVM começa em 0; nonce do protocolo, em 1
    timestamp,
    data: {
      raw,
      op: op ?? null,
      eavmFrom: parsed.from,
      eavmTo: parsed.to,
      eavmHash: parsed.eavmHash,
      eavmNonce: parsed.nonce,
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

    const op = opForTo(parsed.to);
    const expectedType = op ?? 'EAVM_TRANSFER';
    if (tx.type !== expectedType) return 'tipo não corresponde à transação assinada';
    if (tx.fee !== CHAIN.FEES[expectedType].toString() && tx.fee !== '0') return 'taxa inválida';
    if (tx.from !== eavmToE7(parsed.from)) return 'from não corresponde à assinatura recuperada';
    if (op) {
      if (tx.to !== null) return 'operação nativa não deve ter destino';
    } else if (tx.to !== eavmToE7(parsed.to)) {
      return 'to não corresponde à transação assinada';
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
