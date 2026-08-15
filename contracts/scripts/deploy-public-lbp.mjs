#!/usr/bin/env node
/**
 * Deploy PublicVault + TimelockLpSeeder on EAVM (Option A · Fase 2.2).
 *
 * Dry-run (default): prints calldata / planned steps, writes nothing on-chain.
 * Live: ADMIN_PRIVATE_KEY + --live
 *
 * Env:
 *   EAV7_RPC              default https://rpc.eavscan.com
 *   ADMIN_PRIVATE_KEY     deployer / PublicVault.admin (secp)
 *   RELAYER_ADDRESS       0x that will call grant (relayer wallet)
 *   SWEEP_TO_ADDRESS      0x residual sweep target (often multisig)
 *   --setup               after deploy: setBuckets + setLpSeeder
 *   --live                actually send txs
 *
 * Usage:
 *   node contracts/scripts/deploy-public-lbp.mjs
 *   node contracts/scripts/deploy-public-lbp.mjs --setup --live
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SALE = path.join(ROOT, "sale");

const live = process.argv.includes("--live");
const doSetup = process.argv.includes("--setup");

const rpc = process.env.EAV7_RPC || "https://rpc.eavscan.com";
const cfg = JSON.parse(fs.readFileSync(path.join(SALE, "public-lbp-delivery.json"), "utf8"));
const addrFile = path.join(SALE, "public-lbp-addresses.json");
const addresses = JSON.parse(fs.readFileSync(addrFile, "utf8"));

function readArtifact(name) {
  const bin = fs.readFileSync(path.join(ROOT, "artifacts", `${name}.bin`), "utf8").trim();
  const abi = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", `${name}.abi.json`), "utf8"));
  return { bin: bin.startsWith("0x") ? bin : `0x${bin}`, abi };
}

function buckets() {
  const b = cfg.bucketsE7;
  return {
    lbp: BigInt(b.lbp),
    lpSeed: BigInt(b.lpSeed),
    buffer: BigInt(b.buffer),
    incentives: BigInt(b.incentives),
    total: BigInt(b.totalPublic),
  };
}

async function main() {
  const { Wallet, JsonRpcProvider, ContractFactory, Contract } = require(
    path.join(ROOT, "sale/relayer/node_modules/ethers"),
  );

  const relayer = process.env.RELAYER_ADDRESS;
  const sweepTo = process.env.SWEEP_TO_ADDRESS || process.env.RELAYER_ADDRESS;
  if (!relayer || !/^0x[0-9a-fA-F]{40}$/.test(relayer)) {
    console.error("RELAYER_ADDRESS=0x… obrigatório (carteira do relayer público)");
    process.exit(1);
  }
  if (!sweepTo || !/^0x[0-9a-fA-F]{40}$/.test(sweepTo)) {
    console.error("SWEEP_TO_ADDRESS=0x… inválido");
    process.exit(1);
  }

  const b = buckets();

  console.log("=== deploy-public-lbp (Option A) ===");
  console.log("rpc", rpc);
  console.log("mode", live ? "LIVE" : "DRY-RUN");
  console.log("buckets e7", {
    lbp: b.lbp.toString(),
    lpSeed: b.lpSeed.toString(),
    buffer: b.buffer.toString(),
    incentives: b.incentives.toString(),
    total: b.total.toString(),
  });
  console.log("relayer", relayer);
  console.log("sweepTo", sweepTo);
  console.log("fund from custody EOA", addresses.publicCustodyEoa, "→ PublicVault (45B EAV7)");

  if (!live) {
    console.log("\nDry-run OK. Para enviar:");
    console.log(
      "  ADMIN_PRIVATE_KEY=0x… RELAYER_ADDRESS=0x… SWEEP_TO_ADDRESS=0x… \\",
    );
    console.log("    node contracts/scripts/deploy-public-lbp.mjs --setup --live");
    return;
  }

  const provider = new JsonRpcProvider(rpc, 72020, { staticNetwork: true });
  // EAVM: gasPrice fixo; forçar legacy evita tip/fee quirks de carteiras EIP-1559.
  provider.getFeeData = async () => ({
    gasPrice: 475000000000n,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  });
  const net = await provider.getNetwork();
  const height = await provider.getBlockNumber();
  console.log("chainId", net.chainId.toString());
  console.log("height", height);

  const pk = process.env.ADMIN_PRIVATE_KEY;
  if (!pk) {
    console.error("ADMIN_PRIVATE_KEY obrigatório com --live");
    process.exit(1);
  }
  const wallet = new Wallet(pk, provider);
  console.log("admin", wallet.address);

  const vaultArt = readArtifact("PublicVault");
  const seederArt = readArtifact("TimelockLpSeeder");

  const vaultFactory = new ContractFactory(vaultArt.abi, vaultArt.bin, wallet);
  console.log("deploying PublicVault…");
  const vault = await vaultFactory.deploy(wallet.address, relayer, {
    gasLimit: 5_000_000n,
    gasPrice: 475_000_000_000n,
  });
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("PublicVault", vaultAddr);

  const seederFactory = new ContractFactory(seederArt.abi, seederArt.bin, wallet);
  console.log("deploying TimelockLpSeeder…");
  const seeder = await seederFactory.deploy(wallet.address, vaultAddr, {
    gasLimit: 5_000_000n,
    gasPrice: 475_000_000_000n,
  });
  await seeder.waitForDeployment();
  const seederAddr = await seeder.getAddress();
  console.log("TimelockLpSeeder", seederAddr);

  if (doSetup) {
    const vaultC = new Contract(vaultAddr, vaultArt.abi, wallet);
    const incentives = b.incentives;
    const bufferOnChain = b.buffer;
    console.log("setBuckets (lbp, lpSeed, buffer)… incentives off-chain:", incentives.toString());
    await (
      await vaultC.setBuckets(b.lbp, b.lpSeed, bufferOnChain, {
        gasLimit: 500_000n,
        gasPrice: 475_000_000_000n,
      })
    ).wait();
    console.log("setLpSeeder…");
    await (
      await vaultC.setLpSeeder(seederAddr, {
        gasLimit: 500_000n,
        gasPrice: 475_000_000_000n,
      })
    ).wait();
  }

  const out = {
    ...addresses,
    status: doSetup ? "deployed-setup" : "deployed",
    admin0x: wallet.address,
    relayer0x: relayer,
    sweepTo0x: sweepTo,
    publicVault0x: vaultAddr,
    timelockLpSeeder0x: seederAddr,
    deployedAt: new Date().toISOString(),
    deployedAtHeight: await provider.getBlockNumber(),
  };
  fs.writeFileSync(addrFile, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", addrFile);

  console.log(`
Próximos passos (ops):
  1. Fundar PublicVault com ${b.total.toString()} e7 (45B EAV7) da custódia pública
  2. SALE_MODE=public PUBLIC_VAULT_ADDRESS=${vaultAddr} PORT=8788 node contracts/sale/relayer/index.mjs serve
  3. openLbp: node contracts/scripts/open-public-lbp.mjs --live
  4. Keeper: node contracts/scripts/finalize-public-keeper.mjs
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
