#!/usr/bin/env node
/**
 * Prepara carteiras admin + relayer para o LBP público.
 * - Grava chaves em contracts/sale/relayer/.secrets/ (gitignored)
 * - Atualiza só os 0x públicos em public-lbp-addresses.json
 *
 * NÃO faz deploy. NÃO imprime private keys (só paths).
 *
 * Uso: node contracts/scripts/prepare-public-lbp-wallets.mjs
 *      node contracts/scripts/prepare-public-lbp-wallets.mjs --force  # regenera
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SALE = path.join(ROOT, "sale");
const SECRETS = path.join(SALE, "relayer", ".secrets");
const ADDR_FILE = path.join(SALE, "public-lbp-addresses.json");
const force = process.argv.includes("--force");

const { Wallet } = require(path.join(SALE, "relayer/node_modules/ethers"));

function writeSecret(name, wallet) {
  const p = path.join(SECRETS, name);
  if (fs.existsSync(p) && !force) {
    const existing = fs.readFileSync(p, "utf8").trim();
    const w = new Wallet(existing);
    return { path: p, address: w.address, created: false };
  }
  fs.writeFileSync(p, wallet.privateKey + "\n", { mode: 0o600 });
  return { path: p, address: wallet.address, created: true };
}

fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 });

const admin = writeSecret("admin.private.key", Wallet.createRandom());
const relayer = writeSecret("relayer.private.key", Wallet.createRandom());
// Sweep defaults to admin until multisig exists.
const sweepTo = admin.address;

const addr = JSON.parse(fs.readFileSync(ADDR_FILE, "utf8"));
if (addr.publicVault0x && !force) {
  console.error("Vault já deployado — não regenerar sem --force consciente.");
  process.exit(1);
}

const out = {
  ...addr,
  status: "wallets-prepared",
  admin0x: admin.address,
  relayer0x: relayer.address,
  sweepTo0x: sweepTo,
  notes:
    "Public 0x only. Private keys in contracts/sale/relayer/.secrets/ (gitignored). transferAdmin to multisig before funding 45B.",
  walletsPreparedAt: new Date().toISOString(),
};
fs.writeFileSync(ADDR_FILE, JSON.stringify(out, null, 2) + "\n");

console.log("=== public LBP wallets ===");
console.log("admin   ", admin.address, admin.created ? "(new)" : "(kept)");
console.log("relayer ", relayer.address, relayer.created ? "(new)" : "(kept)");
console.log("sweepTo ", sweepTo, "(= admin until multisig)");
console.log("secrets ", SECRETS);
console.log("addrs   ", ADDR_FILE);
console.log(`
Próximo:
  1. Fundear admin com energia/EAV7 de deploy (pouco)
  2. ADMIN_PRIVATE_KEY=$(cat ${path.join(SECRETS, "admin.private.key")}) \\
       RELAYER_ADDRESS=${relayer.address} SWEEP_TO_ADDRESS=${sweepTo} \\
       node contracts/scripts/deploy-public-lbp.mjs --setup --live
  3. Depois: transferAdmin → multisig ops
`);
