#!/usr/bin/env node
/**
 * E2E Public LBP on local testnet — never touches mainnet addresses/secrets.
 *
 * Flow: deploy vault+seeder → fund → openLbp → relayer serve → intent →
 *       ops /confirm (mock payment) → grant → release → assert balance.
 *
 * Prereq: testnet up on :6070 / EAVM :7070 (bin/eav7-lbp-e2e-local.sh).
 *
 * Env:
 *   EAV7_NODE / EAV7_RPC / EAV7_CLI / EAV7_TESTNET_ROOT
 *   PRODUCER_WALLET   default <testnet>/node0/validator-wallet.json
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..");
const SALE = path.join(ROOT, "sale");
const RELAYER_DIR = path.join(SALE, "relayer");
const ethersPath = path.join(RELAYER_DIR, "node_modules/ethers");
const { Wallet, JsonRpcProvider, Contract, parseUnits, keccak256, getBytes, id } =
  require(ethersPath);

const nodeUrl = (process.env.EAV7_NODE || "http://127.0.0.1:6070").replace(/\/$/, "");
const rpcUrl = (process.env.EAV7_RPC || "http://127.0.0.1:7070").replace(/\/$/, "");
const cli =
  process.env.EAV7_CLI ||
  [
    path.join(REPO, "rust/target/debug/eav7-cli"),
    path.join(REPO, "rust/target/release/eav7-cli"),
  ].find((p) => fs.existsSync(p));
const testnetRoot =
  process.env.EAV7_TESTNET_ROOT || path.join(REPO, "data/testnet");
const outDir = path.join(testnetRoot, "lbp-e2e");
const producerWallet =
  process.env.PRODUCER_WALLET || path.join(testnetRoot, "node0/validator-wallet.json");

const GAS = 475_000_000_000n;
/** Scaled-down buckets (e7, 6 decimals) — enough for $100 grant smoke. */
const BUCKETS = {
  lbp: 2_000_000n * 1_000_000n, // 2M EAV7
  lpSeed: 1_000_000n * 1_000_000n,
  buffer: 100_000n * 1_000_000n,
};

function die(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function keccakBuf(buf) {
  return Buffer.from(getBytes(keccak256(buf)));
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

function padU64(n) {
  const b = Buffer.alloc(32);
  let x = BigInt(n);
  for (let i = 31; i >= 0 && x > 0n; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

function selector(sig) {
  return keccakBuf(Buffer.from(sig)).subarray(0, 4);
}

function createAddress(sender0x, nonce) {
  const digest = keccakBuf(Buffer.from(`${sender0x.toLowerCase()}:${nonce}`));
  return `0x${digest.subarray(12).toString("hex")}`;
}

function readBin(name) {
  return fs
    .readFileSync(path.join(ROOT, "artifacts", `${name}.bin`), "utf8")
    .trim()
    .replace(/^0x/, "");
}

function cliRun(args) {
  const full = [...args, "--node", nodeUrl];
  console.log("+", path.basename(cli), full.join(" "));
  const r = spawnSync(cli, full, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) throw new Error(`eav7-cli exit ${r.status}`);
  const m =
    (r.stdout || "").match(/"id"\s*:\s*"([^"]+)"/) ||
    (r.stdout || "").match(/txId\s*:\s*(\S+)/);
  return m ? m[1] : null;
}

async function getAccount(e7) {
  const res = await fetch(`${nodeUrl}/address/${e7}`);
  if (!res.ok) throw new Error(`address ${e7} ${res.status}`);
  return res.json();
}

async function waitConfirmed(txId, ms = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const res = await fetch(`${nodeUrl}/tx/${txId}`);
    if (res.ok) {
      const j = await res.json();
      if (j.status === "CONFIRMED" && j.blockHeight != null) return j;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`timeout confirm ${txId}`);
}

async function waitPred(label, pred, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout ${label}`);
}

function encodeDest(e7) {
  const r = spawnSync(cli, ["eavm", "encode-dest", e7], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "encode-dest failed");
  return r.stdout.trim();
}

function eavmAddress(addr0x) {
  const r = spawnSync(cli, ["eavm", "address", addr0x, "--node", nodeUrl], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "eavm address failed");
  const m = (r.stdout || "").match(/E7[0-9A-Fa-f]+/);
  if (!m) throw new Error(`no E7 in: ${r.stdout}`);
  return m[0];
}

function makeProvider(chainId) {
  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  provider.getFeeData = async () => ({
    gasPrice: GAS,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  });
  return provider;
}

async function ethRpc(method, params) {
  const j = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => r.json());
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

async function main() {
  if (!cli || !fs.existsSync(cli)) die("eav7-cli missing — cargo build -p eav7-node --bin eav7-cli");
  if (!fs.existsSync(producerWallet)) die(`producer wallet missing: ${producerWallet}`);
  if (!fs.existsSync(path.join(RELAYER_DIR, "node_modules/ethers"))) {
    die("run: cd contracts/sale/relayer && npm ci");
  }

  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const secretsDir = path.join(outDir, "secrets");
  fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });

  console.log("=== e2e public LBP (local testnet) ===");
  console.log("node", nodeUrl);
  console.log("rpc ", rpcUrl);
  console.log("out ", outDir);

  const st = await fetch(`${nodeUrl}/status`).then((r) => r.json());
  console.log("height", st.height, "chainId", st.eavm?.chainId);

  const show = spawnSync(cli, ["wallet", "show", producerWallet], { encoding: "utf8" });
  const producerE7 = (show.stdout || "").match(/endereço\s*:\s*(E7[0-9A-F]+)/i)?.[1];
  if (!producerE7) die(`wallet show failed\n${show.stdout}\n${show.stderr}`);
  const admin0x = encodeDest(producerE7);
  console.log("producer", producerE7, "admin0x", admin0x);

  const relayerEth = Wallet.createRandom();
  fs.writeFileSync(path.join(secretsDir, "relayer.private.key"), relayerEth.privateKey + "\n", {
    mode: 0o600,
  });
  const relayer0x = relayerEth.address;
  const relayerE7 = eavmAddress(relayer0x);

  // Buyer = hybrid native wallet (encode-e7-dest) — same path as rust/tests/public_vault.rs
  const buyerWalletPath = path.join(secretsDir, "buyer.wallet.json");
  {
    const r = spawnSync(cli, ["wallet", "new", "--out", buyerWalletPath], { encoding: "utf8" });
    if (r.status !== 0) die(r.stderr || r.stdout || "wallet new failed");
  }
  const buyerShow = spawnSync(cli, ["wallet", "show", buyerWalletPath], { encoding: "utf8" });
  const buyerE7 = (buyerShow.stdout || "").match(/endereço\s*:\s*(E7[0-9A-F]+)/i)?.[1];
  if (!buyerE7) die("buyer wallet show failed");
  const buyer0x = encodeDest(buyerE7);
  console.log("relayer eth", relayer0x, "e7", relayerE7);
  console.log("buyer   e7 ", buyerE7, "0x", buyer0x);

  // Fund + stake relayer (energy for grant)
  console.log("fund relayer 9000 EAV7…");
  let tx = cliRun([
    "send",
    "--wallet",
    producerWallet,
    "--to",
    relayerE7,
    "--amount",
    "9000",
  ]);
  if (tx) await waitConfirmed(tx);

  const chainId = Number(st.eavm?.chainId || 72020);
  const provider = makeProvider(chainId);
  const relayerSigner = new Wallet(relayerEth.privateKey, provider);
  await waitPred("relayer wei bal", async () => {
    const bal = await provider.getBalance(relayer0x);
    return bal >= parseUnits("8000", 18);
  });
  console.log("stake relayer 7000…");
  {
    const stakeTx = await relayerSigner.sendTransaction({
      to: "0x0000000000000000000000000000000000007001",
      value: parseUnits("7000", 18),
      gasLimit: 100000n,
      gasPrice: GAS,
      type: 0,
    });
    console.log("  stake eth tx", stakeTx.hash);
    await waitPred("relayer staked", async () => {
      const a = await getAccount(relayerE7);
      return BigInt(a.staked || "0") >= 7000n * 1_000_000n;
    });
  }

  // Ensure producer has stake energy for deploy (genesis usually enough)
  const prodAcct = await getAccount(producerE7);
  console.log("producer bal", prodAcct.balanceFormatted, "staked", prodAcct.stakedFormatted);
  if (BigInt(prodAcct.staked || "0") < 7000n * 1_000_000n) {
    tx = cliRun(["stake", "--wallet", producerWallet, "--amount", "7000"]);
    if (tx) await waitConfirmed(tx);
  }

  // Deploy PublicVault + TimelockLpSeeder
  const vaultBin = readBin("PublicVault");
  const seederBin = readBin("TimelockLpSeeder");
  let acct = await getAccount(producerE7);
  const vaultNonce = Number(acct.nonce);
  const vaultAddr = createAddress(admin0x, vaultNonce);
  const vaultCreation =
    vaultBin + padAddr(admin0x).toString("hex") + padAddr(relayer0x).toString("hex");
  const vaultCodePath = path.join(secretsDir, "publicvault.creation.hex");
  fs.writeFileSync(vaultCodePath, vaultCreation);
  console.log("deploy PublicVault →", vaultAddr);
  tx = cliRun(["eavm", "deploy", "--wallet", producerWallet, "--code", vaultCodePath]);
  await waitConfirmed(tx);
  const vaultCode = await ethRpc("eth_getCode", [vaultAddr, "latest"]);
  if (!vaultCode || vaultCode === "0x" || vaultCode === "0x0") die("PublicVault no code");

  acct = await getAccount(producerE7);
  const seederNonce = Number(acct.nonce);
  const seederAddr = createAddress(admin0x, seederNonce);
  const seederCreation =
    seederBin + padAddr(admin0x).toString("hex") + padAddr(vaultAddr).toString("hex");
  const seederCodePath = path.join(secretsDir, "timelock.creation.hex");
  fs.writeFileSync(seederCodePath, seederCreation);
  console.log("deploy TimelockLpSeeder →", seederAddr);
  tx = cliRun(["eavm", "deploy", "--wallet", producerWallet, "--code", seederCodePath]);
  await waitConfirmed(tx);

  const setBuckets = Buffer.concat([
    selector("setBuckets(uint128,uint128,uint128)"),
    padU128(BUCKETS.lbp),
    padU128(BUCKETS.lpSeed),
    padU128(BUCKETS.buffer),
  ]);
  console.log("setBuckets…");
  tx = cliRun([
    "eavm",
    "call",
    "--wallet",
    producerWallet,
    "--to",
    vaultAddr,
    "--input",
    "0x" + setBuckets.toString("hex"),
  ]);
  await waitConfirmed(tx);

  const setSeeder = Buffer.concat([selector("setLpSeeder(address)"), padAddr(seederAddr)]);
  console.log("setLpSeeder…");
  tx = cliRun([
    "eavm",
    "call",
    "--wallet",
    producerWallet,
    "--to",
    vaultAddr,
    "--input",
    "0x" + setSeeder.toString("hex"),
  ]);
  await waitConfirmed(tx);

  const vaultE7 = eavmAddress(vaultAddr);
  const fundWhole =
    (BUCKETS.lbp + BUCKETS.lpSeed + BUCKETS.buffer) / 1_000_000n; // EAV7 whole units
  console.log("fund vault", fundWhole.toString(), "EAV7 →", vaultE7);
  tx = cliRun([
    "send",
    "--wallet",
    producerWallet,
    "--to",
    vaultE7,
    "--amount",
    fundWhole.toString(),
  ]);
  await waitConfirmed(tx);
  await waitPred("vault funded", async () => {
    const a = await getAccount(vaultE7);
    return BigInt(a.balance || "0") >= BUCKETS.lbp + BUCKETS.lpSeed + BUCKETS.buffer;
  });

  const height = Number(await ethRpc("eth_blockNumber", []).then((h) => BigInt(h)));
  const deadline = height + 10_000;
  const openCall = Buffer.concat([selector("openLbp(uint64)"), padU64(deadline)]);
  console.log("openLbp deadline", deadline);
  tx = cliRun([
    "eavm",
    "call",
    "--wallet",
    producerWallet,
    "--to",
    vaultAddr,
    "--input",
    "0x" + openCall.toString("hex"),
  ]);
  await waitConfirmed(tx);

  const addrOut = {
    version: 1,
    status: "lbp-open",
    network: "eavm-local-e2e",
    rpc: rpcUrl,
    publicVault0x: vaultAddr,
    timelockLpSeeder0x: seederAddr,
    vaultE7,
    admin0x,
    relayer0x,
    deployerE7: producerE7,
    openedAtHeight: height,
    lbpDeadlineHeight: deadline,
    fundedEav7: fundWhole.toString(),
    note: "LOCAL E2E ONLY — not mainnet",
  };
  const addrPath = path.join(outDir, "addresses.json");
  fs.writeFileSync(addrPath, JSON.stringify(addrOut, null, 2) + "\n");

  // Local delivery (same tiers as public; min $100)
  const deliverySrc = path.join(SALE, "public-lbp-delivery.json");
  const deliveryPath = path.join(outDir, "public-lbp-delivery.json");
  fs.copyFileSync(deliverySrc, deliveryPath);

  const statePath = path.join(outDir, "sale-state-public.json");
  const opsToken = randomBytes(18).toString("base64url");
  fs.writeFileSync(path.join(outDir, "ops.token"), opsToken + "\n", { mode: 0o600 });

  const relayerPort = Number(process.env.E2E_RELAYER_PORT || 8799);
  const relayerLog = path.join(outDir, "relayer.log");
  const relayerEnv = {
    ...process.env,
    SALE_MODE: "public",
    PORT: String(relayerPort),
    EAV7_RPC: rpcUrl,
    PUBLIC_VAULT_ADDRESS: vaultAddr,
    RELAYER_PRIVATE_KEY: relayerEth.privateKey,
    SALE_OPS_TOKEN: opsToken,
    STATE_PATH: statePath,
    SALE_PUBLIC_AUTO_CFG: deliveryPath,
    BTC_USD: "95000",
    POLL_MS: "60000",
  };

  console.log("start relayer :", relayerPort);
  const logFd = fs.openSync(relayerLog, "w");
  const child = spawn(process.execPath, ["index.mjs", "serve"], {
    cwd: RELAYER_DIR,
    env: relayerEnv,
    stdio: ["ignore", logFd, logFd],
  });
  const stopRelayer = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  };
  process.on("exit", stopRelayer);
  process.on("SIGINT", () => {
    stopRelayer();
    process.exit(130);
  });

  await waitPred("relayer /quote", async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${relayerPort}/quote`);
      return r.ok;
    } catch {
      return false;
    }
  });

  const intentBody = {
    beneficiary0x: buyer0x,
    rail: "eth-usdt",
    usdAmount: 100,
  };
  console.log("POST /intent", intentBody);
  const intentRes = await fetch(`http://127.0.0.1:${relayerPort}/intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(intentBody),
  }).then((r) => r.json());
  if (!intentRes.data?.id) die(JSON.stringify(intentRes));
  const intent = intentRes.data;
  console.log("intent", intent.id, "pay", intent.payAmount, "e7", intent.e7Amount);

  const fakeTx = "0x" + "ab".repeat(32);
  console.log("POST /confirm (ops mock payment)…");
  const confRes = await fetch(`http://127.0.0.1:${relayerPort}/confirm`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sale-ops-token": opsToken,
    },
    body: JSON.stringify({ intentId: intent.id, txHash: fakeTx, logIndex: 0 }),
  }).then((r) => r.json());
  if (confRes.error) die(JSON.stringify(confRes));
  if (confRes.data?.status !== "granted") die(`expected granted, got ${JSON.stringify(confRes)}`);
  console.log("granted", confRes.data.grantTx);

  const abi = JSON.parse(
    fs.readFileSync(path.join(ROOT, "artifacts/PublicVault.abi.json"), "utf8"),
  );
  const vaultRo = new Contract(vaultAddr, abi, provider);
  const sold = await vaultRo.lbpSold();
  const total = await vaultRo.grantTotal(buyer0x);
  console.log("on-chain lbpSold", sold.toString(), "grantTotal", total.toString());
  if (total === 0n) die("grantTotal is 0");
  if (total.toString() !== String(intent.e7Amount)) {
    die(`grantTotal mismatch ${total} vs ${intent.e7Amount}`);
  }

  // Buyer needs enough stake/energy for release() (CALL + value). 100 is too low.
  console.log("fund+stake buyer for release…");
  tx = cliRun([
    "send",
    "--wallet",
    producerWallet,
    "--to",
    buyerE7,
    "--amount",
    "8000",
  ]);
  if (tx) await waitConfirmed(tx);
  tx = cliRun(["stake", "--wallet", buyerWalletPath, "--amount", "7000"]);
  if (tx) await waitConfirmed(tx);

  console.log("buyer release() via eav7-cli…");
  const before = await getAccount(buyerE7);
  const releaseSel = "0x" + selector("release()").toString("hex");
  tx = cliRun([
    "eavm",
    "call",
    "--wallet",
    buyerWalletPath,
    "--to",
    vaultAddr,
    "--input",
    releaseSel,
  ]);
  await waitConfirmed(tx);
  await waitPred("buyer balance up", async () => {
    const a = await getAccount(buyerE7);
    return BigInt(a.balance || "0") > BigInt(before.balance || "0");
  });
  const after = await getAccount(buyerE7);
  console.log("buyer balance", before.balanceFormatted, "→", after.balanceFormatted);
  if (BigInt(after.balance || "0") <= BigInt(before.balance || "0")) {
    die(`release did not increase buyer balance (before ${before.balance} after ${after.balance})`);
  }
  console.log(
    "release OK gained liquid e7≈",
    (BigInt(after.balance || "0") - BigInt(before.balance || "0")).toString(),
  );

  stopRelayer();
  fs.writeFileSync(
    path.join(outDir, "result.json"),
    JSON.stringify(
      {
        ok: true,
        grantOk: true,
        releaseOk: true,
        intentId: intent.id,
        grantTx: confRes.data.grantTx,
        vault: vaultAddr,
        buyer0x,
        buyerE7,
        e7Amount: intent.e7Amount,
        grantTotal: total.toString(),
        buyerBalanceAfter: after.balanceFormatted,
      },
      null,
      2,
    ) + "\n",
  );

  console.log("\nOK — local LBP e2e passed (grant+release; mainnet untouched)");
  console.log("artifacts:", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
