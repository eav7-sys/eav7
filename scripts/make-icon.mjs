// Gera public/icon.png (256x256) — ícone do EAV7 (quadrado arredondado com
// degradê roxo + "E7" branco). PNG puro via node:zlib, sem dependências.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 256, H = 256;
const buf = new Uint8Array(W * H * 4); // RGBA

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
function px(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const ia = a / 255, ib = 1 - ia;
  buf[i] = Math.round(r * ia + buf[i] * ib);
  buf[i + 1] = Math.round(g * ia + buf[i + 1] * ib);
  buf[i + 2] = Math.round(b * ia + buf[i + 2] * ib);
  buf[i + 3] = Math.min(255, buf[i + 3] + a);
}

// fundo: quadrado arredondado com degradê diagonal #8a5cf0 -> #6336C4
const R = 52;
const c0 = [0x8a, 0x5c, 0xf0], c1 = [0x63, 0x36, 0xc4];
function insideRounded(x, y) {
  const cx = Math.min(Math.max(x, R), W - R);
  const cy = Math.min(Math.max(y, R), H - R);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= R * R;
}
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!insideRounded(x, y)) continue;
    const t = (x + y) / (W + H);
    px(x, y, lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t), 255);
  }
}

// hexágono (anel) branco sutil, como a marca
function inHex(x, y, size) {
  const cx = 128, cy = 128;
  const dx = Math.abs(x - cx) / size, dy = Math.abs(y - cy) / size;
  // hexágono pointy-top: teste padrão
  return dy <= 0.5 && (0.25 + 0.5) - dy * 0.5 >= dx * 0.5 && dx <= 0.5 && (dx * 0.5 + dy) <= 0.75;
}
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const outer = inHex(x, y, 210), inner = inHex(x, y, 190);
    if (outer && !inner) px(x, y, 255, 255, 255, 70); // anel tênue
  }
}

// "E7" em blocos brancos
function rect(x0, y0, x1, y1, a = 255) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px(x, y, 255, 255, 255, a);
}
// E
const ex = 60, ey = 80, eh = 96;
rect(ex, ey, ex + 18, ey + eh);           // barra vertical
rect(ex, ey, ex + 60, ey + 18);           // topo
rect(ex, ey + 39, ex + 50, ey + 57);      // meio
rect(ex, ey + eh - 18, ex + 60, ey + eh); // base
// 7
const sx = 150;
rect(sx, ey, sx + 66, ey + 18);           // topo
for (let y = ey + 18; y < ey + eh; y++) {
  const t = (y - (ey + 18)) / (eh - 18);
  const cxg = (sx + 66) - t * 32;
  rect(Math.round(cxg - 10), y, Math.round(cxg + 10), y + 1);
}

// ---- codifica PNG (RGBA, colortype 6) ----
function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
// scanlines com filtro 0
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  Buffer.from(buf.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = new URL('../public/icon.png', import.meta.url);
writeFileSync(out, png);
console.log('icon.png gerado:', png.length, 'bytes');
