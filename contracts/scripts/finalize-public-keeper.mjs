#!/usr/bin/env node
/**
 * Keeper permissionless: chama PublicVault.finalizeToLp() após deadline ou sold-out.
 * Não precisa da chave admin — qualquer conta com gás/energia basta.
 *
 * Env:
 *   EAV7_RPC
 *   KEEPER_PRIVATE_KEY   (opcional; sem ela só reporta readiness)
 *   PUBLIC_VAULT_ADDRESS override (senão public-lbp-addresses.json)
 *   POLL_MS              default 30000
 *
 * Flags: --once · --watch · --live
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const live = process.argv.includes("--live");
const watch = process.argv.includes("--watch");
const once = process.argv.includes("--once") || !watch;
const pollMs = Number(process.env.POLL_MS || 30_000);
const rpc = process.env.EAV7_RPC || "https://rpc.eavscan.com";

const addrPath = path.join(ROOT, "sale/public-lbp-addresses.json");
const addr = JSON.parse(fs.readFileSync(addrPath, "utf8"));
const vaultAddr = process.env.PUBLIC_VAULT_ADDRESS || addr.publicVault0x;
const abi = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts/PublicVault.abi.json"), "utf8"));

async function status(provider, vault) {
  const height = await provider.getBlockNumber();
  const [lbpOpen, finalized, deadline, allocated, sold, seeder] = await Promise.all([
    vault.lbpOpen(),
    vault.finalized(),
    vault.lbpDeadline(),
    vault.lbpAllocated(),
    vault.lbpSold(),
    vault.lpSeeder(),
  ]);
  const ready =
    lbpOpen &&
    !finalized &&
    seeder !== "0x0000000000000000000000000000000000000000" &&
    ((deadline > 0n && BigInt(height) > deadline) || sold >= allocated);
  return {
    height,
    lbpOpen,
    finalized,
    deadline: deadline.toString(),
    allocated: allocated.toString(),
    sold: sold.toString(),
    seeder,
    ready,
  };
}

async function tick(provider, vault, wallet) {
  const s = await status(provider, vault);
  console.log(new Date().toISOString(), JSON.stringify(s));
  if (!s.ready) return false;
  if (!live || !wallet) {
    console.log("ready to finalize — re-run with KEEPER_PRIVATE_KEY=… --live");
    return true;
  }
  const tx = await vault.finalizeToLp();
  console.log("finalizeToLp tx", tx.hash);
  await tx.wait();
  addr.status = "finalized";
  addr.finalizedAt = new Date().toISOString();
  fs.writeFileSync(addrPath, JSON.stringify(addr, null, 2) + "\n");
  console.log("finalized → TimelockLpSeeder escrow");
  return true;
}

async function main() {
  const { Wallet, JsonRpcProvider, Contract } = require(
    path.join(ROOT, "sale/relayer/node_modules/ethers"),
  );
  if (!vaultAddr) {
    console.error("PUBLIC_VAULT_ADDRESS / publicVault0x ausente");
    process.exit(1);
  }
  const provider = new JsonRpcProvider(rpc, 72020, { staticNetwork: true });
  const pk = process.env.KEEPER_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY;
  const wallet = pk ? new Wallet(pk, provider) : null;
  const vault = new Contract(vaultAddr, abi, wallet || provider);

  console.log("keeper vault", vaultAddr, "mode", live ? "LIVE" : "check-only");

  if (once) {
    await tick(provider, vault, wallet);
    return;
  }

  for (;;) {
    const done = await tick(provider, vault, wallet);
    if (done && live) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
