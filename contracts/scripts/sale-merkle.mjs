#!/usr/bin/env node
/**
 * Merkle root + proofs for SaleVault.claim
 *
 * leaf = keccak256(abi.encodePacked(index, account, amount, cliff, duration))
 * Tree = sorted-pair parent (OpenZeppelin MerkleProof style)
 *
 *   npm i js-sha3   # once
 *   node contracts/scripts/sale-merkle.mjs allocations.json
 *
 * allocations.json:
 *   [{ "index": 0, "account": "0xabc…", "amount": "1000000000", "cliff": 100, "duration": 1000 }]
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let keccak256;
try {
  keccak256 = require("js-sha3").keccak256;
} catch {
  console.error("faltando js-sha3 — rode: npm i js-sha3");
  process.exit(1);
}

function hash(buf) {
  return Buffer.from(keccak256.arrayBuffer(buf));
}

function pad32(n) {
  const b = Buffer.alloc(32);
  let x = BigInt(n);
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

function addr20(a) {
  const h = String(a).replace(/^0x/i, "").toLowerCase();
  if (h.length !== 40) throw new Error(`address inválido: ${a}`);
  return Buffer.from(h, "hex");
}

function u64be(n) {
  const b = Buffer.alloc(8);
  let x = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

function leafOf(row) {
  return hash(
    Buffer.concat([
      pad32(row.index),
      addr20(row.account),
      pad32(row.amount),
      u64be(row.cliff),
      u64be(row.duration),
    ]),
  );
}

function sortedParent(a, b) {
  return Buffer.compare(a, b) <= 0 ? hash(Buffer.concat([a, b])) : hash(Buffer.concat([b, a]));
}

function build(leaves) {
  let layer = leaves.map((x) => Buffer.from(x));
  const layers = [layer];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(i + 1 === layer.length ? layer[i] : sortedParent(layer[i], layer[i + 1]));
    }
    layer = next;
    layers.push(layer);
  }
  return layers;
}

function proofFor(layers, index) {
  const proof = [];
  let i = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const pair = i ^ 1;
    if (pair < layers[l].length) proof.push("0x" + layers[l][pair].toString("hex"));
    i >>= 1;
  }
  return proof;
}

const file = process.argv[2];
if (!file) {
  console.error("uso: node contracts/scripts/sale-merkle.mjs allocations.json");
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(file, "utf8"));
const leaves = rows.map(leafOf);
const layers = build(leaves);
const out = {
  root: "0x" + layers.at(-1)[0].toString("hex"),
  claims: rows.map((row, i) => ({
    ...row,
    leaf: "0x" + leaves[i].toString("hex"),
    proof: proofFor(layers, i),
  })),
};
console.log(JSON.stringify(out, null, 2));
