#!/usr/bin/env node
/**
 * Native EAVM_DEPLOY for PublicVault + TimelockLpSeeder (hybrid wallet + stake energy).
 *
 * Env:
 *   EAV7_NODE          default https://api.eavscan.com
 *   EAV7_CLI           path to eav7-cli (default rust/target/release/eav7-cli)
 *   DEPLOYER_WALLET    default contracts/sale/relayer/.secrets/deployer.wallet.json
 *   RELAYER_ADDRESS    0x relayer (grant)
 *   SWEEP_TO_ADDRESS   optional
 *   --setup            setBuckets + setLpSeeder after deploy
 *   --stake-only       only stake 7000 then exit
 *   --skip-stake       assume already staked
 *   --live             required to send
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { keccak256: ethKeccak, getBytes } = require(
  path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "sale/relayer/node_modules/ethers"),
);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");
const SALE = path.join(ROOT, "sale");

const live = process.argv.includes("--live");
const doSetup = process.argv.includes("--setup");
const stakeOnly = process.argv.includes("--stake-only");
const skipStake = process.argv.includes("--skip-stake");

const nodeUrl = (process.env.EAV7_NODE || "http://api.eavscan.com").replace(
  /^https:\/\/api\.eavscan\.com/i,
  "http://api.eavscan.com",
);
const cli =
  process.env.EAV7_CLI || path.join(REPO, "rust/target/release/eav7-cli");
const wallet =
  process.env.DEPLOYER_WALLET ||
  path.join(SALE, "relayer/.secrets/deployer.wallet.json");
const addrFile = path.join(SALE, "public-lbp-addresses.json");
const cfg = JSON.parse(fs.readFileSync(path.join(SALE, "public-lbp-delivery.json"), "utf8"));
const addresses = JSON.parse(fs.readFileSync(addrFile, "utf8"));

const STAKE_EAV7 = "7000";

function keccak256(buf) {
  return Buffer.from(getBytes(ethKeccak(buf)));
}

function padAddr(addr) {
  const h = addr.toLowerCase().replace(/^0x/, "");
  if (h.length !== 40) throw new Error(`bad addr ${addr}`);
  return Buffer.concat([Buffer.alloc(12), Buffer.from(h, "hex")]);
}

function padU128(n) {
  const b = Buffer.alloc(32);
  let x = BigInt(n);
  for (let i = 31; i >= 16; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

function selector(sig) {
  return keccak256(Buffer.from(sig)).subarray(0, 4);
}

function readBin(name) {
  return fs.readFileSync(path.join(ROOT, "artifacts", `${name}.bin`), "utf8").trim().replace(/^0x/, "");
}

function encodeDest(e7) {
  const r = spawnSync(cli, ["eavm", "encode-dest", e7], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "encode-dest failed");
  return r.stdout.trim();
}

function cliRun(args, { quiet } = {}) {
  const full = [...args, "--node", nodeUrl];
  if (!quiet) console.log("+", cli, full.join(" "));
  const r = spawnSync(cli, full, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error(`eav7-cli exit ${r.status}`);
  const m =
    (r.stdout || "").match(/txId\s*:\s*(\S+)/) ||
    (r.stdout || "").match(/"id"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

async function getAccount(e7) {
  const res = await fetch(`${nodeUrl}/address/${e7}`);
  if (!res.ok) throw new Error(`address ${res.status}`);
  return res.json();
}

async function waitAccount(e7, pred, label, ms = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const a = await getAccount(e7);
    if (pred(a)) return a;
    process.stdout.write(`… waiting ${label}\n`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`timeout waiting ${label}`);
}

function createAddress(sender0x, nonce) {
  // EAVM CREATE: keccak256(utf8 `${0xsender.toLowerCase()}:${nonce}`)[12:]
  const digest = keccak256(Buffer.from(`${sender0x.toLowerCase()}:${nonce}`));
  return `0x${digest.subarray(12).toString("hex")}`;
}

async function waitConfirmed(txId, ms = 180_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const res = await fetch(`${nodeUrl}/tx/${txId}`);
    if (res.ok) {
      const j = await res.json();
      if (j.status === "CONFIRMED" && j.blockHeight != null) return j;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`timeout confirm ${txId}`);
}

async function ethGetCode(addr) {
  const rpc = addresses.rpc || "https://rpc.eavscan.com";
  const eth = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getCode",
      params: [addr, "latest"],
    }),
  }).then((r) => r.json());
  return eth.result || "0x";
}

function writeCode(tmpName, creationHex) {
  const p = path.join(SALE, "relayer/.secrets", tmpName);
  fs.writeFileSync(p, creationHex);
  return p;
}

async function main() {
  if (!fs.existsSync(cli)) {
    console.error("missing eav7-cli — build: cargo build -p eav7-node --bin eav7-cli --release");
    process.exit(1);
  }
  if (!fs.existsSync(wallet)) {
    console.error("missing wallet", wallet);
    process.exit(1);
  }

  const relayer = process.env.RELAYER_ADDRESS || addresses.relayer0x;
  if (!relayer || !/^0x[0-9a-fA-F]{40}$/.test(relayer)) {
    console.error("RELAYER_ADDRESS=0x… obrigatório");
    process.exit(1);
  }

  const show = spawnSync(cli, ["wallet", "show", wallet], { encoding: "utf8" });
  const e7 = (show.stdout || "").match(/endereço\s*:\s*(E7[0-9A-F]+)/i)?.[1];
  if (!e7) {
    console.error(show.stdout, show.stderr);
    throw new Error("wallet show failed");
  }
  const admin0x = encodeDest(e7);
  console.log("=== native-deploy-public-lbp ===");
  console.log("node", nodeUrl);
  console.log("deployerE7", e7);
  console.log("admin0x (encode-dest)", admin0x);
  console.log("relayer", relayer);
  console.log("mode", live ? "LIVE" : "DRY-RUN");

  if (!live) {
    console.log("\nDry-run OK. Para enviar:");
    console.log(
      "  RELAYER_ADDRESS=" +
        relayer +
        " node contracts/scripts/native-deploy-public-lbp.mjs --setup --live",
    );
    return;
  }

  let acct = await getAccount(e7);
  console.log("balance", acct.balanceFormatted, "staked", acct.stakedFormatted, "energy", acct.energy);

  if (!skipStake) {
    const stakedE7 = BigInt(acct.staked || "0") / 1_000_000n;
    if (stakedE7 < 7000n) {
      console.log("staking", STAKE_EAV7, "EAV7…");
      cliRun(["stake", "--wallet", wallet, "--amount", STAKE_EAV7]);
      acct = await waitAccount(
        e7,
        (a) => BigInt(a.staked || "0") >= 7000n * 1_000_000n,
        "stake confirm",
      );
      console.log("staked OK", acct.stakedFormatted, "energy", acct.energy);
    } else {
      console.log("already staked", acct.stakedFormatted);
    }
  }

  if (stakeOnly) {
    console.log("stake-only done");
    return;
  }

  const b = cfg.bucketsE7;
  const vaultBin = readBin("PublicVault");
  const seederBin = readBin("TimelockLpSeeder");
  const vaultCreation =
    vaultBin + padAddr(admin0x).toString("hex") + padAddr(relayer).toString("hex");

  acct = await getAccount(e7);
  const vaultNonce = Number(acct.nonce);
  const vaultAddr = createAddress(admin0x, vaultNonce);
  console.log("predict PublicVault", vaultAddr, "createNonce", vaultNonce);

  const vaultCodePath = writeCode("publicvault.creation.hex", vaultCreation);
  console.log("deploying PublicVault… bytes", vaultCreation.length / 2);
  const vaultTx = cliRun(["eavm", "deploy", "--wallet", wallet, "--code", vaultCodePath]);
  await waitConfirmed(vaultTx);
  const vaultCode = await ethGetCode(vaultAddr);
  if (!vaultCode || vaultCode === "0x" || vaultCode === "0x0") {
    throw new Error(`PublicVault sem código em ${vaultAddr} (tx ${vaultTx})`);
  }
  console.log("PublicVault OK", vaultAddr, "codeBytes", (vaultCode.length - 2) / 2);

  acct = await getAccount(e7);
  const seederNonce = Number(acct.nonce);
  const seederAddr = createAddress(admin0x, seederNonce);
  console.log("predict TimelockLpSeeder", seederAddr, "createNonce", seederNonce);

  const seederCreation =
    seederBin + padAddr(admin0x).toString("hex") + padAddr(vaultAddr).toString("hex");
  const seederCodePath = writeCode("timelock.creation.hex", seederCreation);
  console.log("deploying TimelockLpSeeder… bytes", seederCreation.length / 2);
  const seederTx = cliRun(["eavm", "deploy", "--wallet", wallet, "--code", seederCodePath]);
  await waitConfirmed(seederTx);
  const seederCode = await ethGetCode(seederAddr);
  if (!seederCode || seederCode === "0x" || seederCode === "0x0") {
    throw new Error(`TimelockLpSeeder sem código em ${seederAddr} (tx ${seederTx})`);
  }
  console.log("TimelockLpSeeder OK", seederAddr, "codeBytes", (seederCode.length - 2) / 2);

  if (doSetup) {
    const setBuckets = Buffer.concat([
      selector("setBuckets(uint128,uint128,uint128)"),
      padU128(b.lbp),
      padU128(b.lpSeed),
      padU128(b.buffer),
    ]);
    const setSeeder = Buffer.concat([
      selector("setLpSeeder(address)"),
      padAddr(seederAddr),
    ]);
    console.log("setBuckets…");
    const bucketsTx = cliRun([
      "eavm",
      "call",
      "--wallet",
      wallet,
      "--to",
      vaultAddr,
      "--input",
      "0x" + setBuckets.toString("hex"),
    ]);
    await waitConfirmed(bucketsTx);
    console.log("setLpSeeder…");
    const seederSetTx = cliRun([
      "eavm",
      "call",
      "--wallet",
      wallet,
      "--to",
      vaultAddr,
      "--input",
      "0x" + setSeeder.toString("hex"),
    ]);
    await waitConfirmed(seederSetTx);
  }

  const out = {
    ...addresses,
    status: doSetup ? "deployed-setup" : "deployed",
    deployerE7: e7,
    admin0x,
    adminKind: "encode-e7-dest",
    relayer0x: relayer,
    sweepTo0x: process.env.SWEEP_TO_ADDRESS || addresses.sweepTo0x || relayer,
    publicVault0x: vaultAddr,
    timelockLpSeeder0x: seederAddr,
    deployedAt: new Date().toISOString(),
    deployMode: "native-hybrid",
  };
  fs.writeFileSync(addrFile, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", addrFile);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
