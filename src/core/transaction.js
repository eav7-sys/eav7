import { CHAIN, TX_TYPES, amountToString, isAmountString } from '../config.js';
import { eavHash, canonical } from '../crypto/hash.js';
import {
  SIGNATURE_SCHEME,
  addressFromPublicKeys,
  isValidAddress,
  hybridSign,
  hybridVerify,
} from '../crypto/keys.js';
import { verifyEavmEnvelope, EAVM_SCHEME } from '../eavm/envelope.js';

const REQUIRES_TO = new Set([
  'TRANSFER',
  'TOKEN_TRANSFER',
  'TOKEN_APPROVE',
  'TOKEN_TRANSFER_FROM',
  'BRIDGE_IN',
]);

export function txSigningPayload(tx) {
  const { signature, pqSignature, id, ...core } = tx;
  return canonical(core);
}

// Monta e assina uma transação eav20 com o esquema híbrido pós-quântico
// eav7-hybrid-1 (secp256k1 + ML-DSA-44). `fee` pode ser omitida (usa a tabela
// do protocolo) ou passada como 0 quando a conta tem stake de isenção
// (CHAIN.FEE_EXEMPT_STAKE) — a regra é validada pela máquina de estado.
export function buildTransaction(wallet, {
  type,
  to = null,
  amount = 0,
  fee,
  nonce,
  data = {},
  timestamp = Date.now(),
}) {
  if (CHAIN.FEES[type] === undefined) throw new Error(`Tipo de transação desconhecido: ${type}`);
  // Limite de taxa padrão = queima máxima possível para este tipo (custo de
  // energia × BURN_PER_ENERGY). Se a conta tiver energia, nada é queimado; senão,
  // no máximo esse valor. O remetente pode passar `fee` para autorizar um teto maior.
  const defaultFeeLimit = BigInt(CHAIN.ENERGY.COST[type] ?? 1) * CHAIN.ENERGY.BURN_PER_ENERGY;
  const from = addressFromPublicKeys(wallet.publicKeyPem, wallet.pqPublicKeyPem);
  const core = {
    protocol: CHAIN.PROTOCOL,
    scheme: SIGNATURE_SCHEME,
    type,
    from,
    to,
    amount: amountToString(amount, 'amount'),
    fee: amountToString(fee ?? defaultFeeLimit, 'fee'),
    nonce,
    timestamp,
    data,
    publicKey: wallet.publicKeyPem,
    pqPublicKey: wallet.pqPublicKeyPem,
  };
  const payload = canonical(core);
  const { signature, pqSignature } = hybridSign(wallet, payload);
  // O id é derivado APENAS do payload canônico assinado — nunca dos bytes da
  // assinatura. Isso elimina a maleabilidade de txid (uma assinatura ECDSA
  // remodelada s->N-s produziria bytes diferentes, mas o mesmo payload/id, então
  // a deduplicação por id no mempool a captura).
  return { ...core, signature, pqSignature, id: eavHash(payload) };
}

// Validação stateless (formato, dupla assinatura, id). Regras de saldo/nonce/
// isenção de taxa ficam no State. Retorna null se válida, ou a string do erro.
export function verifyTransaction(tx) {
  if (!tx || typeof tx !== 'object') return 'transação ausente';
  // Transações do protocolo EAVM (MetaMask/Trust Wallet/carteira web) são
  // autenticadas pela assinatura secp256k1 embutida no raw — inclui as operações
  // nativas STAKE/UNSTAKE via endereços de sistema.
  if (tx.scheme === EAVM_SCHEME) return verifyEavmEnvelope(tx);
  if (tx.protocol !== CHAIN.PROTOCOL) return `protocolo inválido (esperado ${CHAIN.PROTOCOL})`;
  if (tx.scheme !== SIGNATURE_SCHEME) return `esquema de assinatura inválido (esperado ${SIGNATURE_SCHEME})`;
  if (!TX_TYPES.includes(tx.type)) return `tipo de transação desconhecido: ${tx.type}`;
  // EAVM_TRANSFER só é válido via esquema EAVM (destino re-derivado do raw). Na
  // rota híbrida seu `to` poderia ser nulo e os fundos seriam creditados a uma
  // conta insustável ('null'), queimando o saldo silenciosamente.
  if (tx.type === 'EAVM_TRANSFER') return 'EAVM_TRANSFER só é válido via esquema EAVM';
  if (!isAmountString(tx.amount)) return 'amount inválido';
  if (!isAmountString(tx.fee)) return 'fee inválida';
  // `fee` é o LIMITE de queima autorizado (feeLimit). A queima real é calculada
  // pela máquina de estado a partir da energia da conta; aqui só limitamos o teto.
  if (BigInt(tx.fee) > CHAIN.MAX_FEE_LIMIT) return 'limite de taxa (fee) acima do máximo permitido';
  if (!Number.isSafeInteger(tx.nonce) || tx.nonce < 1) return 'nonce inválido';
  if (!Number.isSafeInteger(tx.timestamp) || tx.timestamp <= 0) return 'timestamp inválido';
  if (!isValidAddress(tx.from)) return 'endereço de origem inválido';
  if (REQUIRES_TO.has(tx.type)) {
    if (!isValidAddress(tx.to)) return 'endereço de destino inválido';
  } else if (tx.to !== null && !isValidAddress(tx.to)) {
    return 'endereço de destino inválido';
  }
  if (!tx.data || typeof tx.data !== 'object' || Array.isArray(tx.data)) return 'campo data inválido';
  if (Buffer.byteLength(canonical(tx.data)) > CHAIN.MAX_DATA_BYTES) return 'campo data excede o limite';
  if (typeof tx.publicKey !== 'string' || typeof tx.pqPublicKey !== 'string') {
    return 'chaves públicas ausentes (esquema híbrido exige as duas)';
  }
  if (typeof tx.signature !== 'string' || typeof tx.pqSignature !== 'string') {
    return 'assinaturas ausentes (esquema híbrido exige as duas)';
  }

  let derived;
  try {
    derived = addressFromPublicKeys(tx.publicKey, tx.pqPublicKey);
  } catch {
    return 'chave pública inválida';
  }
  if (derived !== tx.from) return 'chaves públicas não correspondem ao endereço de origem';

  const payload = txSigningPayload(tx);
  const valid = hybridVerify({
    publicKeyPem: tx.publicKey,
    pqPublicKeyPem: tx.pqPublicKey,
    payload,
    signature: tx.signature,
    pqSignature: tx.pqSignature,
  });
  if (!valid) return 'assinatura híbrida inválida';
  if (tx.id !== eavHash(payload)) return 'id da transação não confere';
  return null;
}
