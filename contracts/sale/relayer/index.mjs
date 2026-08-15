/**
 * Sale relayer — confirma pagamento nas rails e chama SaleVault.grant (entrega automática).
 *
 * Fluxo:
 *   1. POST /intent  { beneficiary0x, rail, usdAmount }
 *      → devolve payAmount exato + receive address
 *   2. Loop: poll Transfer/native → match valor → grant on-chain
 *
 * Env:
 *   EAV7_RPC          JSON-RPC EAVM (ex. http://127.0.0.1:6070)
 *   VAULT_ADDRESS     0x do SaleVault
 *   RELAYER_PRIVATE_KEY  chave secp do relayer (NÃO é a Âncora)
 *   ETH_RPC / BSC_RPC / TRON_API  endpoints de leitura
 *   STATE_PATH        arquivo JSON de intents (default ./sale-state.json)
 *   PORT              HTTP (default 8787) — comando `serve`
 *   BTC_USD           override do hint de preço BTC para cotar sats
 *
 *   node contracts/sale/relayer/index.mjs serve
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, "../..");
const rails = JSON.parse(fs.readFileSync(path.join(ROOT, "sale/payment-rails.json"), "utf8"));

/** private = SaleVault (vesting) · public = PublicVault (líquido) */
const SALE_MODE = (process.env.SALE_MODE || "private").toLowerCase() === "public" ? "public" : "private";

/** private = auto-delivery.json · public = public-lbp-delivery.json (Option A ladder) */
const autoCfgPath =
  SALE_MODE === "public"
    ? process.env.SALE_PUBLIC_AUTO_CFG || path.join(ROOT, "sale/public-lbp-delivery.json")
    : process.env.SALE_AUTO_CFG || path.join(ROOT, "sale/auto-delivery.json");
const autoCfg = JSON.parse(fs.readFileSync(autoCfgPath, "utf8"));

const abiPath =
  SALE_MODE === "public"
    ? path.join(ROOT, "artifacts/PublicVault.abi.json")
    : path.join(ROOT, "artifacts/SaleVault.abi.json");
const abi = JSON.parse(fs.readFileSync(abiPath, "utf8"));

const STATE_PATH =
  process.env.STATE_PATH ||
  path.join(__dirname, SALE_MODE === "public" ? "sale-state-public.json" : "sale-state.json");
const POLL_MS = Number(process.env.POLL_MS || 15_000);
const PORT = Number(process.env.PORT || (SALE_MODE === "public" ? 8788 : 8787));
const VAULT_ENV = SALE_MODE === "public" ? "PUBLIC_VAULT_ADDRESS" : "VAULT_ADDRESS";

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { intents: [] };
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}
function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function railById(id) {
  const r = rails.rails.find((x) => x.id === id);
  if (!r) throw new Error(`rail desconhecida: ${id}`);
  return r;
}

function isAddr0x(a) {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}

function raisedUsd(state) {
  // Only settled payments move the scarcity ladder (anti grief via unpaid intents).
  const counts = new Set(autoCfg.tierProgressCounts || ["paid", "granted"]);
  let sum = 0;
  for (const i of state.intents || []) {
    if (!counts.has(i.status)) continue;
    const n = Number(i.usdAmount);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}

function resolveTier(raised) {
  const tiers = autoCfg.tiers?.length
    ? autoCfg.tiers
    : [
        {
          id: "flat",
          label: "Fixed",
          untilRaisedUsd: null,
          priceUsdPerEav7: autoCfg.priceUsdPerEav7,
        },
      ];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (t.untilRaisedUsd == null || raised < t.untilRaisedUsd) {
      return { tier: t, index: i, tiers };
    }
  }
  return { tier: tiers[tiers.length - 1], index: tiers.length - 1, tiers };
}

function buildQuote(state = loadState()) {
  const raised = raisedUsd(state);
  const { tier, index, tiers } = resolveTier(raised);
  const next = index + 1 < tiers.length ? tiers[index + 1] : null;
  const cap = tier.untilRaisedUsd;
  const prevCap = index > 0 ? tiers[index - 1].untilRaisedUsd ?? 0 : 0;
  const span = cap == null ? 1 : Math.max(1, cap - prevCap);
  const into = cap == null ? 1 : Math.min(1, Math.max(0, (raised - prevCap) / span));
  return {
    priceUsdPerEav7: Number(tier.priceUsdPerEav7),
    tierId: tier.id,
    tierLabel: tier.label,
    tierIndex: index,
    raisedUsd: raised,
    remainingInTierUsd: cap == null ? null : Math.max(0, cap - raised),
    nextPriceUsdPerEav7: next ? Number(next.priceUsdPerEav7) : null,
    nextTierLabel: next?.label ?? null,
    progressInTier: into,
    tiers: tiers.map((t, i) => ({
      id: t.id,
      label: t.label,
      priceUsdPerEav7: Number(t.priceUsdPerEav7),
      untilRaisedUsd: t.untilRaisedUsd,
      active: i === index,
      filled: i < index,
    })),
  };
}

/** USD → token units + unique suffix (anti-collision among open intents). */
const PAY_SUFFIX_MOD = 1_000_000n;

function quoteAmount(rail, usdAmount, intentNonce, price) {
  if (!(price > 0)) throw new Error("priceUsdPerEav7 inválido");
  const usd = Number(usdAmount);
  if (!(usd >= 100)) throw new Error("usdAmount mínimo 100");

  let amount;
  if (rail.chain === "bitcoin" || rail.asset === "BTC") {
    const btcUsd = Number(process.env.BTC_USD || autoCfg.btcUsdHint || 95000);
    if (!(btcUsd > 0)) throw new Error("BTC_USD inválido");
    amount = BigInt(Math.round((usd / btcUsd) * 1e8));
  } else {
    const decimals = rail.decimals ?? 6;
    if (decimals === 18) {
      amount = BigInt(Math.round(usd * 1e6)) * 10n ** 12n;
    } else if (decimals === 6) {
      amount = BigInt(Math.round(usd * 1e6));
    } else {
      amount = BigInt(Math.round(usd * 10 ** decimals));
    }
  }

  const mod = amount >= PAY_SUFFIX_MOD ? PAY_SUFFIX_MOD : 10_000n;
  const suffix = BigInt(intentNonce) % mod;
  if (autoCfg.uniqueAmountMicros !== false) {
    amount = amount - (amount % mod) + suffix;
  }
  if (amount <= 0n) throw new Error("amount");
  const eav7Whole = usd / price;
  const e7 = BigInt(Math.round(eav7Whole * 1e6));
  return { payAmount: amount.toString(), e7Amount: e7.toString() };
}

function payAmountTaken(state, railId, payAmount, exceptId = null) {
  return (state.intents || []).some(
    (i) =>
      i.id !== exceptId &&
      i.status !== "granted" &&
      i.rail === railId &&
      i.payAmount === payAmount,
  );
}

function allocateUniqueQuote(state, rail, usdAmount, price) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const nonce = randomBytes(4).readUInt32BE(0);
    const q = quoteAmount(rail, usdAmount, nonce, price);
    if (!payAmountTaken(state, rail.id, q.payAmount)) return q;
  }
  throw new Error("could not allocate unique payAmount");
}

function paymentId(chainKey, txHash, logIndex = 0) {
  const h = createHash("sha256");
  h.update(`${chainKey}:${String(txHash).toLowerCase()}:${logIndex}`);
  return "0x" + h.digest("hex");
}

function publicIntent(intent) {
  const rail = railById(intent.rail);
  return {
    id: intent.id,
    status: intent.status,
    beneficiary0x: intent.beneficiary0x,
    rail: intent.rail,
    chain: intent.chain,
    asset: rail.asset,
    standard: rail.standard,
    decimals: rail.decimals ?? (rail.asset === "BTC" ? 8 : undefined),
    usdAmount: intent.usdAmount,
    payAmount: intent.payAmount,
    e7Amount: intent.e7Amount,
    priceUsdPerEav7: intent.priceUsdPerEav7 || null,
    tierId: intent.tierId || null,
    receive: intent.receive,
    explorer: rail.explorer,
    createdAt: intent.createdAt,
    paymentTx: intent.paymentTx,
    paymentId: intent.paymentId,
    grantTx: intent.grantTx,
    manualConfirm: rail.chain === "bitcoin" || rail.chain === "solana",
  };
}

function createIntent({ beneficiary0x, railId, usdAmount }) {
  if (!isAddr0x(beneficiary0x)) throw new Error("beneficiary0x inválido");
  const rail = railById(railId);
  const state = loadState();
  const quote = buildQuote(state);
  const price = quote.priceUsdPerEav7;
  const { payAmount, e7Amount } = allocateUniqueQuote(state, rail, usdAmount, price);
  const intent = {
    id: randomBytes(8).toString("hex"),
    status: "pending",
    beneficiary0x: beneficiary0x.toLowerCase(),
    rail: railId,
    usdAmount: String(usdAmount),
    payAmount,
    e7Amount,
    priceUsdPerEav7: String(price),
    tierId: quote.tierId,
    receive: rail.receive,
    token: rail.token || null,
    chain: rail.chain,
    createdAt: new Date().toISOString(),
    paymentTx: null,
    paymentId: null,
    grantTx: null,
  };
  state.intents.push(intent);
  saveState(state);
  return intent;
}

function getIntent(id) {
  return loadState().intents.find((i) => i.id === id) || null;
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

async function scanEvmTransfer(rail, intent) {
  const url = rail.chain === "bsc" ? process.env.BSC_RPC : process.env.ETH_RPC;
  if (!url || !rail.token) return null;
  const transferTopic =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const toTopic = "0x" + rail.receive.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  const latestHex = await rpc(url, "eth_blockNumber", []);
  const latest = parseInt(latestHex, 16);
  const conf = autoCfg.minConfirmations[rail.chain] || 12;
  const fromBlock = Math.max(0, latest - 5000);
  const logs = await rpc(url, "eth_getLogs", [
    {
      address: rail.token,
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + latest.toString(16),
      topics: [transferTopic, null, toTopic],
    },
  ]);
  for (const log of logs || []) {
    const value = BigInt(log.data);
    if (value.toString() !== intent.payAmount) continue;
    const block = parseInt(log.blockNumber, 16);
    if (latest - block < conf) continue;
    return {
      txHash: log.transactionHash,
      logIndex: parseInt(log.logIndex, 16),
      paymentId: paymentId(rail.chain, log.transactionHash, parseInt(log.logIndex, 16)),
    };
  }
  return null;
}

async function scanTronTrc20(rail, intent) {
  const base = process.env.TRON_API || "https://api.trongrid.io";
  if (!rail.token) return null;
  const url = `${base}/v1/accounts/${rail.receive}/transactions/trc20?only_to=true&limit=50&contract_address=${rail.token}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  for (const tx of j.data || []) {
    if (String(tx.value) !== intent.payAmount) continue;
    if (tx.confirmed === false) continue;
    return {
      txHash: tx.transaction_id,
      logIndex: 0,
      paymentId: paymentId("tron", tx.transaction_id, 0),
    };
  }
  return null;
}

/** Placeholder: BTC/Solana exigem indexer; marque via POST /confirm. */
async function scanPayment(intent) {
  const rail = railById(intent.rail);
  if (rail.chain === "ethereum" || rail.chain === "bsc") return scanEvmTransfer(rail, intent);
  if (rail.chain === "tron") return scanTronTrc20(rail, intent);
  return null;
}

async function submitGrant(intent) {
  const rpcUrl = process.env.EAV7_RPC;
  const vault = process.env[VAULT_ENV] || process.env.VAULT_ADDRESS;
  const pk = process.env.RELAYER_PRIVATE_KEY;
  if (!rpcUrl || !vault || !pk) {
    console.warn(`[dry-run] ${SALE_MODE} grant`, intent.id, intent.e7Amount, intent.paymentId);
    return "dry-run";
  }
  const { Wallet, JsonRpcProvider, Contract } = require("ethers");
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(pk, provider);
  const c = new Contract(vault, abi, wallet);
  const { id } = require("ethers");
  const railId = id(String(intent.rail || ""));
  const tx = await c.grant(intent.beneficiary0x, intent.e7Amount, intent.paymentId, railId);
  const rec = await tx.wait();
  return rec.hash;
}

async function markPaidAndGrant(intent, txHash, logIndex = 0) {
  intent.status = "paid";
  intent.paymentTx = txHash;
  intent.paymentId = paymentId(intent.chain, txHash, logIndex);
  const grantTx = await submitGrant(intent);
  intent.grantTx = grantTx;
  intent.status = "granted";
  return intent;
}

async function tick() {
  const state = loadState();
  let dirty = false;
  for (const intent of state.intents) {
    if (intent.status !== "pending") continue;
    try {
      const collisions = state.intents.filter(
        (i) =>
          i.status === "pending" &&
          i.rail === intent.rail &&
          i.payAmount === intent.payAmount,
      );
      if (collisions.length > 1) {
        console.warn(
          "[skip] payAmount collision — use ops confirm with intentId",
          intent.payAmount,
          collisions.map((c) => c.id).join(","),
        );
        continue;
      }
      const hit = await scanPayment(intent);
      if (!hit) continue;
      await markPaidAndGrant(intent, hit.txHash, hit.logIndex);
      dirty = true;
      console.log("granted", intent.id, intent.grantTx);
    } catch (e) {
      console.error("intent", intent.id, e.message || e);
    }
  }
  if (dirty) saveState(state);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(payload);
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        send(res, 204, {});
        return;
      }
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);

      if (req.method === "GET" && url.pathname === "/health") {
        send(res, 200, { ok: true, intents: loadState().intents.length });
        return;
      }

      if (req.method === "GET" && url.pathname === "/rails") {
        const q = buildQuote();
        send(res, 200, {
          rails: rails.rails,
          priceUsdPerEav7: String(q.priceUsdPerEav7),
          quote: q,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/quote") {
        send(res, 200, { data: buildQuote() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/intent") {
        const body = await readBody(req);
        const intent = createIntent({
          beneficiary0x: body.beneficiary0x,
          railId: body.rail || body.railId,
          usdAmount: body.usdAmount,
        });
        send(res, 201, { data: publicIntent(intent) });
        return;
      }

      const intentMatch = url.pathname.match(/^\/intent\/([a-f0-9]+)$/i);
      if (req.method === "GET" && intentMatch) {
        const intent = getIntent(intentMatch[1]);
        if (!intent) {
          send(res, 404, { error: { code: "not_found", message: "intent não encontrada" } });
          return;
        }
        send(res, 200, { data: publicIntent(intent) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/confirm") {
        // Manual confirm is ops-only. Public Next.js must never proxy this unauthenticated.
        const ops = process.env.SALE_OPS_TOKEN;
        if (!ops) {
          send(res, 503, {
            error: {
              code: "confirm_disabled",
              message: "SALE_OPS_TOKEN not set — use CLI confirm on an ops host or rely on watcher",
            },
          });
          return;
        }
        const hdr =
          req.headers["x-sale-ops-token"] ||
          (String(req.headers.authorization || "").startsWith("Bearer ")
            ? String(req.headers.authorization).slice(7)
            : "");
        if (hdr !== ops) {
          send(res, 401, { error: { code: "unauthorized", message: "invalid ops token" } });
          return;
        }
        const body = await readBody(req);
        const state = loadState();
        const intent = state.intents.find((i) => i.id === body.intentId);
        if (!intent) {
          send(res, 404, { error: { code: "not_found", message: "intent not found" } });
          return;
        }
        if (intent.status === "granted") {
          send(res, 200, { data: publicIntent(intent) });
          return;
        }
        if (!body.txHash || typeof body.txHash !== "string") {
          send(res, 400, { error: { code: "bad_request", message: "txHash required" } });
          return;
        }
        await markPaidAndGrant(intent, body.txHash.trim(), Number(body.logIndex) || 0);
        saveState(state);
        send(res, 200, { data: publicIntent(intent) });
        return;
      }

      send(res, 404, { error: { code: "not_found", message: "rota" } });
    } catch (e) {
      send(res, 400, { error: { code: "bad_request", message: e.message || String(e) } });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`sale relayer [${SALE_MODE}] http://127.0.0.1:${PORT}`);
    console.log("vault env", VAULT_ENV, "abi", path.basename(abiPath));
    console.log("pricing", path.basename(autoCfgPath));
    console.log("watching…", STATE_PATH);
  });

  (async () => {
    for (;;) {
      await tick();
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  })();
}

function printHelp() {
  console.log(`Sale relayer [${SALE_MODE}] (auto confirm → grant)

Comandos:
  SALE_MODE=private|public node index.mjs intent <beneficiary0x> <railId> <usdAmount>
  SALE_MODE=… node index.mjs tick | watch | serve | confirm <id> <txHash>

Env vault: ${VAULT_ENV} (fallback VAULT_ADDRESS)
STATE: ${STATE_PATH}
PORT default: ${PORT}

Rails: ${rails.rails.map((r) => r.id).join(", ")}
`);
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd === "help") {
  printHelp();
  process.exit(0);
}

if (cmd === "intent") {
  const [beneficiary0x, railId, usdAmount] = args;
  const intent = createIntent({ beneficiary0x, railId, usdAmount });
  console.log(JSON.stringify(publicIntent(intent), null, 2));
} else if (cmd === "tick") {
  await tick();
} else if (cmd === "watch") {
  console.log("watching…", STATE_PATH);
  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
} else if (cmd === "serve") {
  startServer();
} else if (cmd === "confirm") {
  const [id, txHash] = args;
  const state = loadState();
  const intent = state.intents.find((i) => i.id === id);
  if (!intent) throw new Error("intent não encontrada");
  await markPaidAndGrant(intent, txHash, 0);
  saveState(state);
  console.log(JSON.stringify(publicIntent(intent), null, 2));
} else {
  printHelp();
  process.exit(1);
}
