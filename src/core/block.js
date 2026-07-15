import { CHAIN } from '../config.js';
import { eavHash, canonical, merkleRoot, isValidHash } from '../crypto/hash.js';
import {
  SIGNATURE_SCHEME,
  addressFromPublicKeys,
  hybridSign,
  hybridVerify,
} from '../crypto/keys.js';

export const GENESIS_PREVIOUS_HASH =
  CHAIN.HASH_PREFIX + '0'.repeat(CHAIN.HASH_LENGTH - CHAIN.HASH_PREFIX.length);
const GENESIS_SIGNATURE = 'GENESIS';

export function blockCore(block) {
  const { signature, pqSignature, hash, transactions, ...core } = block;
  return core;
}

// A PARTIR de CANONICAL_HASH_HEIGHT o hash deriva SÓ do payload assinado. Assinaturas
// (ECDSA/ML-DSA) são maleáveis — reencodá-las (ex.: s → N−s) produzia um hash diferente
// para conteúdo idêntico, permitindo dois ids válidos do MESMO bloco (achado M1). Derivar
// do payload torna o id canônico, como já é o id da tx. Blocos antes do fork (incl. gênese,
// altura 0) mantêm a fórmula antiga para o replay do histórico continuar válido.
function blockHash(payload, signature, pqSignature, height) {
  return height >= CHAIN.CANONICAL_HASH_HEIGHT ? eavHash(payload) : eavHash(payload + signature + pqSignature);
}

export function buildBlock(wallet, { height, previousHash, timestamp = Date.now(), transactions = [], stateRoot = null }) {
  const core = {
    protocol: CHAIN.PROTOCOL,
    version: CHAIN.PROTOCOL_VERSION,
    scheme: SIGNATURE_SCHEME,
    height,
    timestamp,
    previousHash,
    txRoot: merkleRoot(transactions.map((tx) => tx.id)),
    txCount: transactions.length,
    producer: addressFromPublicKeys(wallet.publicKeyPem, wallet.pqPublicKeyPem),
    publicKey: wallet.publicKeyPem,
    pqPublicKey: wallet.pqPublicKeyPem,
    // stateRoot entra no core (logo, no hash + assinatura) só a partir do fork —
    // blocos anteriores não têm o campo (grandfather). O valor é o root do estado
    // APÓS aplicar este bloco; a Blockchain o calcula e o confere no addBlock (#1).
    ...(height >= CHAIN.STATEROOT_HEIGHT ? { stateRoot } : {}),
  };
  const payload = canonical(core);
  const { signature, pqSignature } = hybridSign(wallet, payload);
  return { ...core, signature, pqSignature, hash: blockHash(payload, signature, pqSignature, height), transactions };
}

// Bloco gênese: sem produtor real; carrega as alocações e stakes iniciais da rede.
export function buildGenesisBlock({ timestamp, balances, stakes, bridgeRelayers = [], bridgeSourceCommittees = {}, vesting = [] }) {
  const core = {
    protocol: CHAIN.PROTOCOL,
    version: CHAIN.PROTOCOL_VERSION,
    scheme: SIGNATURE_SCHEME,
    height: 0,
    timestamp,
    previousHash: GENESIS_PREVIOUS_HASH,
    txRoot: merkleRoot([]),
    txCount: 0,
    producer: 'GENESIS',
    publicKey: null,
    pqPublicKey: null,
    genesis: { balances, stakes, bridgeRelayers, bridgeSourceCommittees, vesting },
  };
  const payload = canonical(core);
  return {
    ...core,
    signature: GENESIS_SIGNATURE,
    pqSignature: GENESIS_SIGNATURE,
    // Mesma função de hash do verify: com CANONICAL_HASH_HEIGHT=0 (gênese-ativo) a altura
    // 0 usa payload-only; com fork alto, mantém a fórmula antiga (mesmo hash de sempre).
    hash: blockHash(payload, GENESIS_SIGNATURE, GENESIS_SIGNATURE, 0),
    transactions: [],
  };
}

// Integridade interna do bloco (hash, merkle, dupla assinatura do produtor).
// Regras de encadeamento (altura, previousHash, slot DPoS) ficam na Blockchain.
export function verifyBlockIntegrity(block) {
  if (!block || typeof block !== 'object') return 'bloco ausente';
  if (block.protocol !== CHAIN.PROTOCOL) return `protocolo inválido (esperado ${CHAIN.PROTOCOL})`;
  if (block.scheme !== SIGNATURE_SCHEME) return `esquema de assinatura inválido (esperado ${SIGNATURE_SCHEME})`;
  if (!Number.isSafeInteger(block.height) || block.height < 0) return 'altura inválida';
  if (!Number.isSafeInteger(block.timestamp) || block.timestamp <= 0) return 'timestamp inválido';
  if (!Array.isArray(block.transactions)) return 'lista de transações inválida';
  if (block.txCount !== block.transactions.length) return 'txCount não confere';
  if (block.txRoot !== merkleRoot(block.transactions.map((tx) => tx?.id))) return 'txRoot não confere';

  const payload = canonical(blockCore(block));
  if (block.hash !== blockHash(payload, block.signature, block.pqSignature, block.height)) return 'hash do bloco não confere';

  // A gênese valida por regras próprias (sem produtor, sem stateRoot) — checada ANTES
  // da regra estrutural de stateRoot, senão com STATEROOT_HEIGHT=0 (gênese-ativo) a
  // própria gênese seria rejeitada por não ter o campo.
  if (block.height === 0) {
    if (block.signature !== GENESIS_SIGNATURE || block.producer !== 'GENESIS') return 'bloco gênese malformado';
    if (!block.genesis || typeof block.genesis !== 'object') return 'alocações da gênese ausentes';
    return null;
  }

  // Estrutural: acima do fork o stateRoot é obrigatório; abaixo, proibido (o valor
  // é conferido contra o estado no addBlock, aqui só a forma). Achado/feature #1.
  if (block.height >= CHAIN.STATEROOT_HEIGHT) {
    if (!isValidHash(block.stateRoot)) return 'stateRoot ausente ou malformado';
  } else if (block.stateRoot !== undefined) {
    return 'stateRoot presente antes do fork (STATEROOT_HEIGHT)';
  }

  let derived;
  try {
    derived = addressFromPublicKeys(block.publicKey, block.pqPublicKey);
  } catch {
    return 'chave pública do produtor inválida';
  }
  if (derived !== block.producer) return 'produtor não corresponde às chaves públicas';
  const valid = hybridVerify({
    publicKeyPem: block.publicKey,
    pqPublicKeyPem: block.pqPublicKey,
    payload,
    signature: block.signature,
    pqSignature: block.pqSignature,
  });
  if (!valid) return 'assinatura híbrida do produtor inválida';
  return null;
}
