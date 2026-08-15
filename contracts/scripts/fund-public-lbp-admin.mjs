#!/usr/bin/env node
/**
 * Quanto EAV7 enviar ao admin para deploy PublicVault + TimelockLpSeeder.
 * Modelo EAVM: budget_gas ≈ (energia_livre + saldo/BURN_PER_ENERGY − custo_base) × GAS_PER_ENERGY
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const addr = JSON.parse(fs.readFileSync(path.join(ROOT, "sale/public-lbp-addresses.json"), "utf8"));

const ADMIN_E7 = "E7B4DBD6F4A2B8C11532BC5808AEDDAC42";
const UNIT = 1_000_000;
const BURN_PER_ENERGY = 20_000; // e7
const GAS_PER_ENERGY = 100;
const FREE = 10;
const DEPLOY_BASE = 10; // EAVM_DEPLOY
const CALL_BASE = 5; // EAVM_CALL

// CREATE ~32k + 200×bytes; vault~2880 + seeder~1232 + margem
const GAS_NEEDED = 32_000 + 200 * 2880 + 32_000 + 200 * 1232 + 200_000;
const ENERGY_FOR_GAS = Math.ceil(GAS_NEEDED / GAS_PER_ENERGY);
const ENERGY_TOTAL = ENERGY_FOR_GAS + 2 * DEPLOY_BASE + 2 * CALL_BASE;
const PAID = Math.max(0, ENERGY_TOTAL - FREE);
const E7_BURN = PAID * BURN_PER_ENERGY;
const EAV7 = Math.ceil(E7_BURN / UNIT) + 20; // margem retries

console.log("=== fund admin p/ deploy (energia via burn) ===");
console.log("admin0x ", addr.admin0x);
console.log("admin E7", ADMIN_E7);
console.log("gas alvo", GAS_NEEDED);
console.log("energia ", ENERGY_TOTAL, "(free", FREE + ", paga", PAID + ")");
console.log("sugerido", EAV7, "EAV7 →", ADMIN_E7);
console.log("explorer https://eavscan.com/address/" + ADMIN_E7);
console.log(`
Com ~10 EAV7 o CREATE estoura o orçamento (~50k gas) e reverte (status 0).
Envie o saldo sugerido, depois:

  ADMIN_PRIVATE_KEY=$(cat contracts/sale/relayer/.secrets/admin.private.key) \\
  RELAYER_ADDRESS=${addr.relayer0x} SWEEP_TO_ADDRESS=${addr.admin0x} \\
  node contracts/scripts/deploy-public-lbp.mjs --setup --live
`);
