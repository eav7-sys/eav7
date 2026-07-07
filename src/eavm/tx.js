// EAVM: decodificação e verificação das transações assinadas que as carteiras
// universais (MetaMask, Trust Wallet) produzem — formatos legacy e tipo 2.
// Implementação própria completa: RLP, keccak e secp256k1 deste projeto.
import { keccak256 } from './keccak.js';
import { rlpEncode, rlpDecode, rlpBufToBigInt } from './rlp.js';
import { recover, sign, ethAddressFromPoint, N } from './secp256k1.js';

const hex = (buf) => '0x' + buf.toString('hex');

// Inteiro RLP canônico: rejeita zeros à esquerda no conteúdo. Sem isto, padear
// r/s/v/value com bytes 0x00 produz um `raw` diferente (logo um eavmHash/id
// diferente) que recupera o MESMO signer — maleabilidade de txid EAVM.
function strictInt(buf, field) {
  if (buf.length > 0 && buf[0] === 0) throw new Error(`RLP: inteiro não canônico em ${field} (zero à esquerda)`);
  return rlpBufToBigInt(buf);
}

export function decodeRawTransaction(rawHex) {
  if (typeof rawHex !== 'string' || !/^0x[0-9a-fA-F]{2,}$/.test(rawHex)) {
    throw new Error('transação raw deve ser hex 0x');
  }
  const raw = Buffer.from(rawHex.slice(2), 'hex');

  let fields;
  let signingHash;
  let recId;
  let chainId;
  let type;

  if (raw[0] === 0x02) {
    // EIP-1559
    type = 2;
    const list = rlpDecode(raw.subarray(1));
    if (!Array.isArray(list) || list.length !== 12) throw new Error('transação tipo 2 malformada');
    const [cid, nonce, maxPrio, maxFee, gas, to, value, data, accessList, yParity, r, s] = list;
    if (Array.isArray(accessList) && accessList.length > 0) throw new Error('accessList não suportada');
    strictInt(nonce, 'nonce'); strictInt(maxPrio, 'maxPriorityFee'); strictInt(maxFee, 'maxFee');
    strictInt(gas, 'gas'); strictInt(value, 'value'); strictInt(r, 'r'); strictInt(s, 's');
    chainId = strictInt(cid, 'chainId');
    recId = strictInt(yParity, 'yParity');
    signingHash = keccak256(Buffer.concat([
      Buffer.from([0x02]),
      rlpEncode([cid, nonce, maxPrio, maxFee, gas, to, value, data, accessList]),
    ]));
    fields = { nonce, gasPrice: maxFee, gas, to, value, data, r, s };
  } else if (raw[0] >= 0xc0) {
    // legacy (com ou sem EIP-155)
    type = 0;
    const list = rlpDecode(raw);
    if (!Array.isArray(list) || list.length !== 9) throw new Error('transação legacy malformada');
    const [nonce, gasPrice, gas, to, value, data, v, r, s] = list;
    strictInt(nonce, 'nonce'); strictInt(gasPrice, 'gasPrice'); strictInt(gas, 'gas');
    strictInt(value, 'value'); strictInt(r, 'r'); strictInt(s, 's');
    const vBig = strictInt(v, 'v');
    if (vBig >= 35n) {
      chainId = (vBig - 35n) / 2n;
      recId = (vBig - 35n) % 2n;
      signingHash = keccak256(rlpEncode([nonce, gasPrice, gas, to, value, data, chainId, Buffer.alloc(0), Buffer.alloc(0)]));
    } else {
      chainId = null;
      recId = vBig - 27n;
      signingHash = keccak256(rlpEncode([nonce, gasPrice, gas, to, value, data]));
    }
    fields = { nonce, gasPrice, gas, to, value, data, r, s };
  } else {
    throw new Error(`tipo de transação EVM não suportado: 0x${raw[0].toString(16)}`);
  }

  const r = rlpBufToBigInt(fields.r);
  const s = rlpBufToBigInt(fields.s);
  if (s > N / 2n) throw new Error('assinatura com s alto rejeitada (EIP-2)');
  const pub = recover(signingHash, r, s, recId);
  if (!pub) throw new Error('assinatura EVM inválida (recuperação de chave falhou)');

  return {
    eavmType: type,
    chainId,
    nonce: Number(rlpBufToBigInt(fields.nonce)),
    gasPrice: rlpBufToBigInt(fields.gasPrice),
    gasLimit: rlpBufToBigInt(fields.gas),
    to: fields.to.length === 0 ? null : hex(fields.to),
    value: rlpBufToBigInt(fields.value),
    dataHex: hex(fields.data),
    from: ethAddressFromPoint(pub),
    eavmHash: hex(keccak256(raw)),
  };
}

// Cria uma transação legacy EIP-155 assinada — usada nos testes e em
// ferramentas locais; carteiras (Trust Wallet etc.) assinam do lado delas.
export function createSignedTx({ privateKey, nonce, to, valueWei, chainId, gasPriceWei = 476190476190n, gasLimit = 21000n }) {
  const base = [BigInt(nonce), gasPriceWei, gasLimit, to, valueWei, '0x'];
  const signingHash = keccak256(rlpEncode([...base, BigInt(chainId), Buffer.alloc(0), Buffer.alloc(0)]));
  const { r, s, recId } = sign(signingHash, privateKey);
  const v = BigInt(chainId) * 2n + 35n + recId;
  return '0x' + rlpEncode([...base, v, r, s]).toString('hex');
}
