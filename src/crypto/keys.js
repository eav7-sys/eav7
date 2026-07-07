import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';
import { sha3 } from './hash.js';
import { CHAIN } from '../config.js';

// Modelo de assinatura próprio da EAV7: "eav7-hybrid-1" (segurança pós-quântica).
//
// Toda carteira, transação e bloco é assinado DUAS vezes:
//   • ECDSA secp256k1 — mesma curva da Tron/Bitcoin (maturidade e compatibilidade)
//   • ML-DSA-44 — assinatura pós-quântica padronizada pelo NIST (FIPS 204)
//
// A verificação exige as DUAS assinaturas válidas, e o endereço E7 é derivado do
// SHA3-256 das duas chaves públicas concatenadas. Para forjar uma transação, um
// atacante precisaria quebrar as duas primitivas ao mesmo tempo — inclusive a
// resistente a computadores quânticos.
export const SIGNATURE_SCHEME = 'eav7-hybrid-1';
export const PQ_ALGORITHM = 'ml-dsa-44';

export function generateKeyPair() {
  const ec = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const pq = generateKeyPairSync(PQ_ALGORITHM);
  return {
    scheme: SIGNATURE_SCHEME,
    privateKeyPem: ec.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKeyPem: ec.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    pqPrivateKeyPem: pq.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    pqPublicKeyPem: pq.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

function addressChecksum(body) {
  return sha3('EAV7-ADDR:' + body).subarray(0, 2).toString('hex').toUpperCase();
}

// Deriva um endereço E7 válido (com checksum) a partir de bytes arbitrários —
// usado para chaves híbridas e para o mapeamento de contas do protocolo EAVM.
export function deriveAddressFrom(data) {
  const body = sha3(data).subarray(0, 14).toString('hex').toUpperCase();
  return CHAIN.HASH_PREFIX + body + addressChecksum(body);
}

// Endereço EAV7: "E7" + 28 hex do SHA3-256 das duas chaves públicas + 4 hex de checksum.
export function addressFromPublicKeys(publicKeyPem, pqPublicKeyPem) {
  const ecDer = createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' });
  const pqDer = createPublicKey(pqPublicKeyPem).export({ format: 'der', type: 'spki' });
  return deriveAddressFrom(Buffer.concat([ecDer, pqDer]));
}

export function walletAddress(wallet) {
  return addressFromPublicKeys(wallet.publicKeyPem, wallet.pqPublicKeyPem);
}

export function isValidAddress(address) {
  if (typeof address !== 'string' || address.length !== CHAIN.ADDRESS_LENGTH) return false;
  if (!address.startsWith(CHAIN.HASH_PREFIX)) return false;
  if (!/^[0-9A-F]+$/.test(address.slice(CHAIN.HASH_PREFIX.length))) return false;
  const body = address.slice(2, 30);
  return address.slice(30) === addressChecksum(body);
}

export function hybridSign(wallet, payload) {
  const data = Buffer.from(payload);
  return {
    signature: sign('sha256', data, createPrivateKey(wallet.privateKeyPem)).toString('base64'),
    pqSignature: sign(null, data, createPrivateKey(wallet.pqPrivateKeyPem)).toString('base64'),
  };
}

export function hybridVerify({ publicKeyPem, pqPublicKeyPem, payload, signature, pqSignature }) {
  try {
    const data = Buffer.from(payload);
    return (
      verify('sha256', data, createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'))
      && verify(null, data, createPublicKey(pqPublicKeyPem), Buffer.from(pqSignature, 'base64'))
    );
  } catch {
    return false;
  }
}
