#!/usr/bin/env node
/**
 * Abre a janela LBP: PublicVault.openLbp(deadlineBlock).
 * deadline = altura atual + windowHours * blocksPerHourHint (default 72h).
 *
 * Admin nativo (encode-e7-dest): eav7-cli + DEPLOYER_WALLET.
 * Admin eth (legacy): ADMIN_PRIVATE_KEY + eth Contract.
 *
 * Env: EAV7_RPC, EAV7_NODE, ADMIN_PRIVATE_KEY | DEPLOYER_WALLET
 * Flags: --live · --hours=72 · --native
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { keccak256, getBytes } = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../sale/relayer/node_modules/ethers"),
);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");
const live = process.argv.includes("--live");
const forceNative = process.argv.includes("--native");
const hoursArg = process.argv.find((a) => a.startsWith("--hours="));
const hours = Number(hoursArg?.split("=")[1] || 72);

const rpc = process.env.EAV7_RPC || "https://rpc.eavscan.com";
const nodeUrl = (process.env.EAV7_NODE || "http://api.eavscan.com").replace(
  /^https:\/\/api\.eavscan\.com/i,
  "http://api.eavscan.com",
);
const cli = process.env.EAV7_CLI || path.join(REPO, "rust/target/release/eav7-cli");
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "sale/public-lbp-delivery.json"), "utf8"));
const addr = JSON.parse(fs.readFileSync(path.join(ROOT, "sale/public-lbp-addresses.json"), "utf8"));
const abi = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts/PublicVault.abi.json"), "utf8"));

function encodeOpenLbp(deadline) {
  const sel = Buffer.from(getBytes(keccak256(Buffer.from("openLbp(uint64)")))).subarray(0, 4);
  const word = Buffer.alloc(32);
  let x = BigInt(deadline);
  for (let i = 31; i >= 0 && x > 0n; i--) {
    word[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return "0x" + Buffer.concat([sel, word]).toString("hex");
}

async function main() {
  const hoursEff = hours || Number(cfg.windowHours || 72);
  const bph = Number(cfg.blocksPerHourHint || 3600);
  const useNative =
    forceNative || addr.adminKind === "encode-e7-dest" || addr.deployMode === "native-hybrid";

  if (!addr.publicVault0x) {
    console.log("publicVault0x ausente — rode native-deploy-public-lbp.mjs --live primeiro");
    console.log(`planejado: openLbp(height + ${hoursEff}*${bph})`);
    if (!live) {
      console.log("Dry-run OK (sem vault ainda).");
      return;
    }
    process.exit(1);
  }

  const { JsonRpcProvider, Wallet, Contract } = require(
    path.join(ROOT, "sale/relayer/node_modules/ethers"),
  );
  const provider = new JsonRpcProvider(rpc, 72020, { staticNetwork: true });
  const height = await provider.getBlockNumber();
  const deadline = BigInt(height) + BigInt(Math.round(hoursEff * bph));

  console.log("vault", addr.publicVault0x);
  console.log("height", height);
  console.log("deadline", deadline.toString(), `(~${hoursEff}h @ ${bph} blk/h)`);
  console.log("admin path", useNative ? "native-hybrid" : "eth-secp");
  console.log("mode", live ? "LIVE" : "DRY-RUN");

  if (!live) {
    console.log(
      useNative
        ? "Dry-run OK. Para abrir: DEPLOYER_WALLET=…/deployer.wallet.json node …/open-public-lbp.mjs --live"
        : "Dry-run OK. Para abrir: ADMIN_PRIVATE_KEY=0x… node …/open-public-lbp.mjs --live",
    );
    return;
  }

  if (useNative) {
    const wallet =
      process.env.DEPLOYER_WALLET ||
      path.join(ROOT, "sale/relayer/.secrets/deployer.wallet.json");
    if (!fs.existsSync(wallet)) {
      console.error("DEPLOYER_WALLET ausente:", wallet);
      process.exit(1);
    }
    const input = encodeOpenLbp(deadline.toString());
    const r = spawnSync(
      cli,
      [
        "eavm",
        "call",
        "--wallet",
        wallet,
        "--to",
        addr.publicVault0x,
        "--input",
        input,
        "--node",
        nodeUrl,
      ],
      { encoding: "utf8" },
    );
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) process.exit(r.status || 1);
  } else {
    const pk = process.env.ADMIN_PRIVATE_KEY;
    if (!pk) {
      console.error("ADMIN_PRIVATE_KEY obrigatório");
      process.exit(1);
    }
    const wallet = new Wallet(pk, provider);
    const vault = new Contract(addr.publicVault0x, abi, wallet);
    const tx = await vault.openLbp(deadline);
    console.log("tx", tx.hash);
    await tx.wait();
  }

  addr.openedAtHeight = height;
  addr.lbpDeadlineHeight = Number(deadline);
  addr.status = "lbp-open";
  fs.writeFileSync(
    path.join(ROOT, "sale/public-lbp-addresses.json"),
    JSON.stringify(addr, null, 2) + "\n",
  );
  console.log("LBP aberta. Deadline altura", deadline.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
