/**
 * Mercado EAV7 — preço oficial do explorador.
 *
 * Fonte primária: tier da venda privada (`sale-pricing` / intents).
 * Override: `EAV7_PRICE_USD` (número, ex. 0.008).
 *
 * Histórico: arquivo local de snapshots (lazy), sem inventar candles de exchange.
 */
import fs from "node:fs";
import path from "node:path";
import { buildSaleQuote, loadSaleAutoCfg } from "@/lib/sale-pricing";
import { getSaleQuoteSnapshot } from "@/lib/sale-server";

export type PriceSource = "sale-tier" | "env-override";

export type MarketPrice = {
  symbol: "EAV7";
  name: string;
  priceUsd: number;
  priceUsdFormatted: string;
  change24hPct: number;
  change24hFormatted: string;
  source: PriceSource;
  sourceLabel: string;
  updatedAt: number;
  tierId: string | null;
  tierLabel: string | null;
  circulating: string | null;
  marketCapUsd: number | null;
  volume24hUsd: null;
  quoteCurrency: "USD";
};

export type PriceHistoryPoint = { t: number; priceUsd: number };

export type PriceHistory = {
  symbol: "EAV7";
  range: string;
  intervalSec: number;
  points: PriceHistoryPoint[];
};

export type PriceConvert = {
  from: string;
  to: string;
  amount: number;
  result: number;
  priceUsd: number;
  updatedAt: number;
};

type HistFile = { points: PriceHistoryPoint[] };

const UNIT = 1_000_000;

function histPath(): string {
  return (
    process.env.EAV7_PRICE_HISTORY_PATH ||
    path.resolve(process.cwd(), "../contracts/sale/relayer/price-history.json")
  );
}

function fmtPrice(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: Math.min(2, digits),
      maximumFractionDigits: digits,
    })
  );
}

function fmtChange(pct: number): string {
  if (!Number.isFinite(pct)) return "0.00%";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function loadHistory(): HistFile {
  const p = histPath();
  try {
    if (!fs.existsSync(p)) return { points: [] };
    return JSON.parse(fs.readFileSync(p, "utf8")) as HistFile;
  } catch {
    return { points: [] };
  }
}

function saveHistory(h: HistFile) {
  const p = histPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Mantém ~90 dias de snapshots horários.
    const cut = Date.now() - 90 * 86_400_000;
    const points = h.points.filter((x) => x.t >= cut).slice(-2500);
    fs.writeFileSync(p, JSON.stringify({ points }, null, 2));
  } catch {
    /* filesystem read-only — API ainda funciona sem persistência */
  }
}

/** Grava um ponto se o último tiver >55min OU o preço mudou ≥0.1%. */
function maybeSnapshot(priceUsd: number) {
  const h = loadHistory();
  const last = h.points[h.points.length - 1];
  const now = Date.now();
  const moved = !last || Math.abs(priceUsd - last.priceUsd) / Math.max(last.priceUsd, 1e-12) >= 0.001;
  const aged = !last || now - last.t >= 55 * 60_000;
  if (moved || aged) {
    h.points.push({ t: now, priceUsd });
    saveHistory(h);
  }
}

function resolveSpot(): {
  priceUsd: number;
  source: PriceSource;
  sourceLabel: string;
  tierId: string | null;
  tierLabel: string | null;
} {
  const env = process.env.EAV7_PRICE_USD;
  if (env && Number.isFinite(Number(env)) && Number(env) > 0) {
    return {
      priceUsd: Number(env),
      source: "env-override",
      sourceLabel: "EAV7_PRICE_USD",
      tierId: null,
      tierLabel: null,
    };
  }

  try {
    const q = getSaleQuoteSnapshot("private");
    return {
      priceUsd: q.priceUsdPerEav7,
      source: "sale-tier",
      sourceLabel: `sale · ${q.tierLabel}`,
      tierId: q.tierId,
      tierLabel: q.tierLabel,
    };
  } catch {
    const cfg = loadSaleAutoCfg();
    const q = buildSaleQuote([], cfg);
    return {
      priceUsd: q.priceUsdPerEav7,
      source: "sale-tier",
      sourceLabel: `sale · ${q.tierLabel}`,
      tierId: q.tierId,
      tierLabel: q.tierLabel,
    };
  }
}

function change24h(priceUsd: number): number {
  const h = loadHistory();
  const target = Date.now() - 86_400_000;
  let ref: PriceHistoryPoint | undefined;
  for (const p of h.points) {
    if (p.t <= target) ref = p;
    else break;
  }
  if (!ref) {
    // Sem histórico: se só há o preço atual, variação 0.
    const first = h.points[0];
    if (!first || first.priceUsd <= 0) return 0;
    return ((priceUsd - first.priceUsd) / first.priceUsd) * 100;
  }
  if (ref.priceUsd <= 0) return 0;
  return ((priceUsd - ref.priceUsd) / ref.priceUsd) * 100;
}

/** Converte saldo e7 (string inteira) → EAV7 humanos. */
export function e7ToHuman(e7: string | number | bigint | null | undefined): number {
  try {
    const n = typeof e7 === "bigint" ? e7 : BigInt(String(e7 ?? "0"));
    return Number(n) / UNIT;
  } catch {
    return 0;
  }
}

export function usdValue(e7Amount: string | number | bigint, priceUsd: number): number {
  return e7ToHuman(e7Amount) * priceUsd;
}

export function getMarketPrice(opts?: { circulatingE7?: string | null }): MarketPrice {
  const spot = resolveSpot();
  maybeSnapshot(spot.priceUsd);
  const ch = change24h(spot.priceUsd);
  const circ = opts?.circulatingE7 ?? null;
  const circHuman = circ != null ? e7ToHuman(circ) : null;
  const mcap = circHuman != null ? circHuman * spot.priceUsd : null;

  return {
    symbol: "EAV7",
    name: "EAV7",
    priceUsd: spot.priceUsd,
    priceUsdFormatted: fmtPrice(spot.priceUsd, spot.priceUsd < 0.01 ? 5 : 4),
    change24hPct: ch,
    change24hFormatted: fmtChange(ch),
    source: spot.source,
    sourceLabel: spot.sourceLabel,
    updatedAt: Date.now(),
    tierId: spot.tierId,
    tierLabel: spot.tierLabel,
    circulating: circ,
    marketCapUsd: mcap,
    volume24hUsd: null,
    quoteCurrency: "USD",
  };
}

export function getPriceHistory(range: string = "7d"): PriceHistory {
  const spot = resolveSpot();
  maybeSnapshot(spot.priceUsd);
  const h = loadHistory();

  const ranges: Record<string, number> = {
    "1h": 3_600_000,
    "24h": 86_400_000,
    "7d": 7 * 86_400_000,
    "30d": 30 * 86_400_000,
    "90d": 90 * 86_400_000,
  };
  const windowMs = ranges[range] ?? ranges["7d"];
  const cut = Date.now() - windowMs;
  let points = h.points.filter((p) => p.t >= cut);

  // Sem histórico persistido: série plana no preço oficial atual (sem inventar candles).
  if (points.length === 0) {
    points = [
      { t: Date.now() - windowMs, priceUsd: spot.priceUsd },
      { t: Date.now() - windowMs / 2, priceUsd: spot.priceUsd },
      { t: Date.now(), priceUsd: spot.priceUsd },
    ];
  } else if (points.length === 1) {
    points = [{ t: points[0].t - 3_600_000, priceUsd: points[0].priceUsd }, points[0]];
  }

  // Sempre termina no preço atual.
  const last = points[points.length - 1];
  if (!last || Math.abs(last.priceUsd - spot.priceUsd) > 1e-12 || Date.now() - last.t > 60_000) {
    points = [...points, { t: Date.now(), priceUsd: spot.priceUsd }];
  }

  return {
    symbol: "EAV7",
    range: ranges[range] ? range : "7d",
    intervalSec: 3600,
    points,
  };
}

export function convertAmount(amount: number, from: string, to: string): PriceConvert {
  const spot = resolveSpot();
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  let result: number;
  if (f === "EAV7" && (t === "USD" || t === "USDT" || t === "USDC")) {
    result = amount * spot.priceUsd;
  } else if ((f === "USD" || f === "USDT" || f === "USDC") && t === "EAV7") {
    result = spot.priceUsd > 0 ? amount / spot.priceUsd : 0;
  } else if (f === t) {
    result = amount;
  } else {
    throw new Error(`unsupported pair ${from}/${to}`);
  }
  return {
    from: f,
    to: t,
    amount,
    result,
    priceUsd: spot.priceUsd,
    updatedAt: Date.now(),
  };
}
