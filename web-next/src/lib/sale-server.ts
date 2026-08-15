import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { SALE_RAILS, type SaleRail } from "@/lib/sale-rails";
import type { SaleIntent } from "@/lib/sale-api";
import { buildSaleQuote, loadSaleAutoCfg, type SaleQuote } from "@/lib/sale-pricing";

export type SaleChannel = "private" | "public";

type StoredIntent = {
  id: string;
  status: string;
  channel: SaleChannel;
  beneficiary0x: string;
  rail: string;
  usdAmount: string;
  payAmount: string;
  e7Amount: string;
  priceUsdPerEav7: string;
  tierId: string;
  receive: string;
  token: string | null;
  chain: string;
  createdAt: string;
  paymentTx: string | null;
  paymentId: string | null;
  grantTx: string | null;
};

type State = { intents: StoredIntent[] };

const BTC_USD = Number(process.env.BTC_USD || 95000);

function statePath(channel: SaleChannel): string {
  if (channel === "public") {
    return (
      process.env.SALE_STATE_PUBLIC_PATH ||
      path.resolve(process.cwd(), "../contracts/sale/relayer/sale-state-public.json")
    );
  }
  return (
    process.env.SALE_STATE_PATH ||
    path.resolve(process.cwd(), "../contracts/sale/relayer/sale-state.json")
  );
}

function loadState(channel: SaleChannel): State {
  const p = statePath(channel);
  if (!fs.existsSync(p)) return { intents: [] };
  return JSON.parse(fs.readFileSync(p, "utf8")) as State;
}

function saveState(channel: SaleChannel, s: State) {
  const p = statePath(channel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
}

function railById(id: string): SaleRail {
  const r = SALE_RAILS.find((x) => x.id === id);
  if (!r) throw new Error(`rail desconhecida: ${id}`);
  return r;
}

function quotePayAmount(rail: SaleRail, usdAmount: number, nonce: number): string {
  let amount: bigint;
  if (rail.chain === "bitcoin" || rail.asset === "BTC") {
    amount = BigInt(Math.round((usdAmount / BTC_USD) * 1e8));
  } else if (rail.decimals === 18) {
    amount = BigInt(Math.round(usdAmount * 1e6)) * 10n ** 12n;
  } else if ((rail.decimals ?? 6) === 6) {
    amount = BigInt(Math.round(usdAmount * 1e6));
  } else {
    amount = BigInt(Math.round(usdAmount * 10 ** (rail.decimals ?? 6)));
  }
  const mod = amount >= 1_000_000n ? 1_000_000n : 10_000n;
  const suffix = BigInt(nonce) % mod;
  amount = amount - (amount % mod) + suffix;
  if (amount <= 0n) throw new Error("amount");
  return amount.toString();
}

function allocateUniquePayAmount(
  state: State,
  rail: SaleRail,
  usdAmount: number,
): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    const nonce = randomBytes(4).readUInt32BE(0);
    const payAmount = quotePayAmount(rail, usdAmount, nonce);
    const taken = state.intents.some(
      (i) => i.status !== "granted" && i.rail === rail.id && i.payAmount === payAmount,
    );
    if (!taken) return payAmount;
  }
  throw new Error("could not allocate unique payAmount");
}

function paymentId(chainKey: string, txHash: string, logIndex = 0) {
  return (
    "0x" +
    createHash("sha256")
      .update(`${chainKey}:${txHash.toLowerCase()}:${logIndex}`)
      .digest("hex")
  );
}

function toPublic(intent: StoredIntent): SaleIntent {
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
    priceUsdPerEav7: intent.priceUsdPerEav7 ?? null,
    tierId: intent.tierId ?? null,
    receive: intent.receive,
    explorer: rail.explorer,
    createdAt: intent.createdAt,
    paymentTx: intent.paymentTx,
    paymentId: intent.paymentId,
    grantTx: intent.grantTx,
    manualConfirm: rail.chain === "bitcoin" || rail.chain === "solana",
    channel: intent.channel,
    liquid: intent.channel === "public",
  };
}

export function getSaleQuoteSnapshot(channel: SaleChannel = "private"): SaleQuote {
  return buildSaleQuote(loadState(channel).intents, loadSaleAutoCfg(channel));
}

export function createLocalIntent(
  input: { beneficiary0x: string; rail: string; usdAmount: number },
  channel: SaleChannel = "private",
): SaleIntent {
  const { beneficiary0x, rail: railId, usdAmount } = input;
  if (!/^0x[0-9a-fA-F]{40}$/.test(beneficiary0x)) throw new Error("beneficiary0x inválido");
  if (!(usdAmount >= 100)) throw new Error("usdAmount mínimo 100");
  const rail = railById(railId);
  const state = loadState(channel);
  const quote = buildSaleQuote(state.intents, loadSaleAutoCfg(channel));
  const price = quote.priceUsdPerEav7;
  if (!(price > 0)) throw new Error("preço inválido");

  const payAmount = allocateUniquePayAmount(state, rail, usdAmount);
  const e7 = BigInt(Math.round((usdAmount / price) * 1e6));
  const intent: StoredIntent = {
    id: randomBytes(8).toString("hex"),
    status: "pending",
    channel,
    beneficiary0x: beneficiary0x.toLowerCase(),
    rail: railId,
    usdAmount: String(usdAmount),
    payAmount,
    e7Amount: e7.toString(),
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
  saveState(channel, state);
  return toPublic(intent);
}

export function getLocalIntent(id: string, channel: SaleChannel = "private"): SaleIntent | null {
  const intent = loadState(channel).intents.find((i) => i.id === id);
  return intent ? toPublic(intent) : null;
}

export function confirmLocalIntent(
  _input: { intentId: string; txHash: string; logIndex?: number },
  _channel: SaleChannel = "private",
): SaleIntent {
  throw new Error(
    "confirm disabled: use the payment watcher or ops CLI with SALE_OPS_TOKEN",
  );
}

export function useRemoteRelayer(channel: SaleChannel = "private"): boolean {
  if (channel === "public") {
    return Boolean(process.env.SALE_RELAYER_PUBLIC_URL || process.env.SALE_RELAYER_URL);
  }
  return Boolean(process.env.SALE_RELAYER_URL);
}

export function relayerBase(channel: SaleChannel = "private"): string {
  if (channel === "public") {
    return (process.env.SALE_RELAYER_PUBLIC_URL || process.env.SALE_RELAYER_URL || "http://127.0.0.1:8788").replace(
      /\/$/,
      "",
    );
  }
  return (process.env.SALE_RELAYER_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
}

export function loadPublicPlan() {
  const p = path.resolve(process.cwd(), "../contracts/sale/public-distribution.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as {
    partition: Record<string, { shareOfPublic: number; tokensEav7: string }>;
    bucket: { tokensEav7: string };
  };
}
