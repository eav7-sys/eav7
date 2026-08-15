#!/usr/bin/env node
/**
 * Fund PublicVault from genesis public custody (TRANSFER → E7 of vault 0x).
 *
 * On-chain buckets (lbp+lpSeed+buffer) = 42.75B. Incentives 2.25B stay in custody.
 * Leaves a small fee buffer on custody (default 1 EAV7).
 *
 * Env:
 *   EAV7_NODE           default http://api.eavscan.com
 *   EAV7_CLI            default rust/target/release/eav7-cli
 *   CUSTODY_WALLET      path to hybrid wallet for E7AADB…8320 (required for --live)
 *   FUND_EAV7           override amount (default 42750000000)
 *
 * Usage:
 *   node contracts/scripts/fund-public-vault.mjs
 *   CUSTODY_WALLET=/path/to/public.json node contracts/scripts/fund-public-vault.mjs --live
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");
const SALE = path.join(ROOT, "sale");
const live = process.argv.includes("--live");

const nodeUrl = (process.env.EAV7_NODE || "http://api.eavscan.com").replace(
  /^https:\/\/api\.eavscan\.com/i,
  "http://api.eavscan.com",
);
const cli = process.env.EAV7_CLI || path.join(REPO, "rust/target/release/eav7-cli");
const addr = JSON.parse(fs.readFileSync(path.join(SALE, "public-lbp-addresses.json"), "utf8"));
const cfg = JSON.parse(fs.readFileSync(path.join(SALE, "public-lbp-delivery.json"), "utf8"));

const DEFAULT_FUND =
  BigInt(cfg.bucketsE7.lbp) + BigInt(cfg.bucketsE7.lpSeed) + BigInt(cfg.bucketsE7.buffer); // e7
const fundE7Whole = process.env.FUND_EAV7
  ? process.env.FUND_EAV7
  : (DEFAULT_FUND / 1_000_000n).toString();

async function getAccount(e7) {
  const res = await fetch(`${nodeUrl}/address/${e7}`);
  if (!res.ok) throw new Error(`address ${res.status}`);
  return res.json();
}

function cliRun(args) {
  const full = [...args, "--node", nodeUrl];
  console.log("+", cli, full.join(" "));
  const r = spawnSync(cli, full, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error(`eav7-cli exit ${r.status}`);
  const m =
    (r.stdout || "").match(/"id"\s*:\s*"([^"]+)"/) ||
    (r.stdout || "").match(/txId\s*:\s*(\S+)/);
  return m ? m[1] : null;
}

async function waitBalance(e7, minE7, label) {
  const need = BigInt(minE7) * 1_000_000n;
  for (let i = 0; i < 60; i++) {
    const a = await getAccount(e7);
    if (BigInt(a.balance || "0") >= need) return a;
    console.log(`… waiting ${label} (have ${a.balanceFormatted})`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`timeout ${label}`);
}

async function main() {
  if (!addr.publicVault0x) {
    console.error("publicVault0x ausente");
    process.exit(1);
  }

  const map = spawnSync(cli, ["eavm", "address", addr.publicVault0x, "--node", nodeUrl], {
    encoding: "utf8",
  });
  const vaultE7 = (map.stdout || "").match(/EAV7\s*:\s*(E7[0-9A-F]+)/i)?.[1];
  if (!vaultE7) {
    console.error(map.stdout, map.stderr);
    throw new Error("falha a mapear vault 0x → E7");
  }

  const custodyE7 = addr.publicCustodyEoa;
  console.log("=== fund-public-vault ===");
  console.log("custody", custodyE7);
  console.log("vault0x", addr.publicVault0x);
  console.log("vaultE7", vaultE7);
  console.log("amount", fundE7Whole, "EAV7 (lbp+lpSeed+buffer; incentives ficam na custódia)");
  console.log("mode", live ? "LIVE" : "DRY-RUN");

  const custody = await getAccount(custodyE7);
  const vaultAcc = await getAccount(vaultE7);
  console.log("custody balance", custody.balanceFormatted);
  console.log("vault balance", vaultAcc.balanceFormatted);

  if (!live) {
    console.log("\nDry-run OK. Para enviar:");
    console.log(
      `  CUSTODY_WALLET=/path/to/E7AADB….json node contracts/scripts/fund-public-vault.mjs --live`,
    );
    return;
  }

  const wallet = process.env.CUSTODY_WALLET;
  if (!wallet || !fs.existsSync(wallet)) {
    console.error("CUSTODY_WALLET=caminho/para/carteira.json da E7AADB…8320 é obrigatório");
    process.exit(1);
  }

  const show = spawnSync(cli, ["wallet", "show", wallet], { encoding: "utf8" });
  const from = (show.stdout || "").match(/endereço\s*:\s*(E7[0-9A-F]+)/i)?.[1];
  if (from !== custodyE7) {
    console.error(`carteira é ${from}, esperava ${custodyE7}`);
    process.exit(1);
  }

  const have = BigInt(custody.balance || "0");
  const want = BigInt(fundE7Whole) * 1_000_000n;
  if (have < want + 1_000_000n) {
    console.error(
      `saldo insuficiente: preciso ${fundE7Whole}+1 EAV7 (taxa), tenho ${custody.balanceFormatted}`,
    );
    process.exit(1);
  }

  const txId = cliRun([
    "send",
    "--wallet",
    wallet,
    "--to",
    vaultE7,
    "--amount",
    fundE7Whole,
  ]);
  console.log("tx", txId);
  await waitBalance(vaultE7, fundE7Whole, "vault funded");

  addr.status = "vault-funded";
  addr.vaultE7 = vaultE7;
  addr.fundedEav7 = fundE7Whole;
  addr.fundedAt = new Date().toISOString();
  fs.writeFileSync(path.join(SALE, "public-lbp-addresses.json"), JSON.stringify(addr, null, 2) + "\n");
  console.log("wrote addresses · status vault-funded");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
