#!/usr/bin/env node
/**
 * Gera um par secp256k1 para o relayer público (stdout only — não grava disco).
 * Uso: node contracts/scripts/gen-relayer-wallet.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { Wallet } = require(path.join(root, "sale/relayer/node_modules/ethers"));

const w = Wallet.createRandom();
console.log("Relayer wallet (save offline — never commit / never anchor key)");
console.log("address ", w.address);
console.log("private ", w.privateKey);
console.log("\nNext: set RELAYER_ADDRESS=" + w.address + " on deploy-public-lbp.mjs");
console.log("      set RELAYER_PRIVATE_KEY=… on SALE_MODE=public relayer");
