// RLP (Recursive Length Prefix) — serialização das transações Ethereum.
export function rlpEncode(item) {
  if (Array.isArray(item)) {
    const body = Buffer.concat(item.map(rlpEncode));
    return Buffer.concat([lengthPrefix(body.length, 0xc0), body]);
  }
  const buf = toBuffer(item);
  if (buf.length === 1 && buf[0] < 0x80) return buf;
  return Buffer.concat([lengthPrefix(buf.length, 0x80), buf]);
}

function toBuffer(item) {
  if (Buffer.isBuffer(item)) return item;
  if (typeof item === 'string') {
    if (!/^0x[0-9a-fA-F]*$/.test(item)) throw new Error(`RLP: string deve ser hex 0x: ${item}`);
    const hex = item.slice(2);
    return Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  }
  if (typeof item === 'bigint' || typeof item === 'number') {
    const value = BigInt(item);
    if (value < 0n) throw new Error('RLP: número negativo');
    if (value === 0n) return Buffer.alloc(0);
    const hex = value.toString(16);
    return Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  }
  throw new Error(`RLP: tipo não suportado: ${typeof item}`);
}

function lengthPrefix(length, base) {
  if (length < 56) return Buffer.from([base + length]);
  const hex = length.toString(16);
  const lenBuf = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  return Buffer.concat([Buffer.from([base + 55 + lenBuf.length]), lenBuf]);
}

export function rlpDecode(buffer) {
  const { value, rest } = decodeItem(buffer);
  if (rest.length > 0) throw new Error('RLP: bytes excedentes após o item');
  return value;
}

function decodeItem(buf) {
  if (buf.length === 0) throw new Error('RLP: buffer vazio');
  const first = buf[0];

  if (first < 0x80) return { value: buf.subarray(0, 1), rest: buf.subarray(1) };

  if (first < 0xb8) {
    const length = first - 0x80;
    if (buf.length < 1 + length) throw new Error('RLP: truncado');
    if (length === 1 && buf[1] < 0x80) throw new Error('RLP: codificação não canônica');
    return { value: buf.subarray(1, 1 + length), rest: buf.subarray(1 + length) };
  }

  if (first < 0xc0) {
    const lenOfLen = first - 0xb7;
    const length = Number(bufToInt(buf.subarray(1, 1 + lenOfLen)));
    if (length < 56) throw new Error('RLP: comprimento não canônico');
    const start = 1 + lenOfLen;
    if (buf.length < start + length) throw new Error('RLP: truncado');
    return { value: buf.subarray(start, start + length), rest: buf.subarray(start + length) };
  }

  let listLength;
  let start;
  if (first < 0xf8) {
    listLength = first - 0xc0;
    start = 1;
  } else {
    const lenOfLen = first - 0xf7;
    listLength = Number(bufToInt(buf.subarray(1, 1 + lenOfLen)));
    if (listLength < 56) throw new Error('RLP: comprimento de lista não canônico');
    start = 1 + lenOfLen;
  }
  if (buf.length < start + listLength) throw new Error('RLP: lista truncada');

  const items = [];
  let body = buf.subarray(start, start + listLength);
  while (body.length > 0) {
    const decoded = decodeItem(body);
    items.push(decoded.value);
    body = decoded.rest;
  }
  return { value: items, rest: buf.subarray(start + listLength) };
}

function bufToInt(buf) {
  if (buf.length === 0) return 0n;
  if (buf[0] === 0) throw new Error('RLP: zeros à esquerda');
  return BigInt('0x' + buf.toString('hex'));
}

export const rlpBufToBigInt = (buf) => (buf.length === 0 ? 0n : BigInt('0x' + buf.toString('hex')));
