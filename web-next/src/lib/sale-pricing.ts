import fs from "node:fs";
import path from "node:path";

export type SaleTier = {
  id: string;
  label: string;
  /** Preço vale enquanto raisedUsd < untilRaisedUsd. null = último patamar. */
  untilRaisedUsd: number | null;
  priceUsdPerEav7: string;
};

export type SaleQuote = {
  priceUsdPerEav7: number;
  tierId: string;
  tierLabel: string;
  tierIndex: number;
  raisedUsd: number;
  remainingInTierUsd: number | null;
  nextPriceUsdPerEav7: number | null;
  nextTierLabel: string | null;
  progressInTier: number;
  tiers: Array<{
    id: string;
    label: string;
    priceUsdPerEav7: number;
    untilRaisedUsd: number | null;
    active: boolean;
    filled: boolean;
  }>;
};

type AutoCfg = {
  priceUsdPerEav7: string;
  tiers?: SaleTier[];
  tierProgressCounts?: string[];
  channel?: string;
  windowHours?: number;
};

const PRIVATE_CFG_CANDIDATES = [
  process.env.SALE_AUTO_CFG,
  path.resolve(process.cwd(), "../contracts/sale/auto-delivery.json"),
  path.resolve(process.cwd(), "data/sale-auto-delivery.json"),
  path.resolve(process.cwd(), "contracts/sale/auto-delivery.json"),
].filter(Boolean) as string[];

const PUBLIC_CFG_CANDIDATES = [
  process.env.SALE_PUBLIC_AUTO_CFG,
  path.resolve(process.cwd(), "../contracts/sale/public-lbp-delivery.json"),
  path.resolve(process.cwd(), "data/sale-public-lbp-delivery.json"),
  path.resolve(process.cwd(), "contracts/sale/public-lbp-delivery.json"),
].filter(Boolean) as string[];

const EMBEDDED_CFG: AutoCfg = {
  priceUsdPerEav7: "0.005",
  tiers: [
    { id: "launch", label: "Launch", untilRaisedUsd: 500000, priceUsdPerEav7: "0.005" },
    { id: "early", label: "Early", untilRaisedUsd: 2000000, priceUsdPerEav7: "0.008" },
    { id: "growth", label: "Growth", untilRaisedUsd: 5000000, priceUsdPerEav7: "0.01" },
    { id: "final", label: "Final", untilRaisedUsd: 15000000, priceUsdPerEav7: "0.012" },
    { id: "last", label: "Last call", untilRaisedUsd: null, priceUsdPerEav7: "0.015" },
  ],
  tierProgressCounts: ["paid", "granted"],
};

function loadCfgFrom(candidates: string[], fallback: AutoCfg): AutoCfg {
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, "utf8");
        return JSON.parse(raw) as AutoCfg;
      }
    } catch {
      /* tenta o próximo */
    }
  }
  return fallback;
}

export function loadSaleAutoCfg(channel: "private" | "public" = "private"): AutoCfg {
  if (channel === "public") {
    return loadCfgFrom(PUBLIC_CFG_CANDIDATES, {
      priceUsdPerEav7: "0.008",
      channel: "public",
      windowHours: 72,
      tiers: [
        { id: "lbp-open", label: "LBP open", untilRaisedUsd: 750000, priceUsdPerEav7: "0.008" },
        { id: "lbp-early", label: "LBP early", untilRaisedUsd: 2500000, priceUsdPerEav7: "0.010" },
        { id: "lbp-mid", label: "LBP mid", untilRaisedUsd: 6000000, priceUsdPerEav7: "0.012" },
        { id: "lbp-late", label: "LBP late", untilRaisedUsd: 12000000, priceUsdPerEav7: "0.014" },
        { id: "lbp-final", label: "LBP final", untilRaisedUsd: null, priceUsdPerEav7: "0.015" },
      ],
      tierProgressCounts: ["paid", "granted"],
    });
  }
  return loadCfgFrom(PRIVATE_CFG_CANDIDATES, EMBEDDED_CFG);
}

export function raisedFromIntents(
  intents: Array<{ status: string; usdAmount: string }>,
  counts: string[] = ["paid", "granted"],
): number {
  const set = new Set(counts);
  let sum = 0;
  for (const i of intents) {
    if (!set.has(i.status)) continue;
    const n = Number(i.usdAmount);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}

export function resolveTier(
  raisedUsd: number,
  cfg: AutoCfg = loadSaleAutoCfg("private"),
): {
  tier: SaleTier;
  index: number;
  tiers: SaleTier[];
} {
  const tiers = cfg.tiers?.length
    ? cfg.tiers
    : [
        {
          id: "flat",
          label: "Fixed",
          untilRaisedUsd: null,
          priceUsdPerEav7: cfg.priceUsdPerEav7,
        },
      ];

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const cap = t.untilRaisedUsd;
    if (cap == null || raisedUsd < cap) {
      return { tier: t, index: i, tiers };
    }
  }
  const last = tiers[tiers.length - 1];
  return { tier: last, index: tiers.length - 1, tiers };
}

export function buildSaleQuote(
  intents: Array<{ status: string; usdAmount: string }>,
  cfg: AutoCfg = loadSaleAutoCfg("private"),
): SaleQuote {
  const counts = cfg.tierProgressCounts ?? ["paid", "granted"];
  const raisedUsd = raisedFromIntents(intents, counts);
  const { tier, index, tiers } = resolveTier(raisedUsd, cfg);
  const price = Number(tier.priceUsdPerEav7);
  const next = index + 1 < tiers.length ? tiers[index + 1] : null;
  const cap = tier.untilRaisedUsd;
  const prevCap = index > 0 ? tiers[index - 1].untilRaisedUsd ?? 0 : 0;
  const remainingInTierUsd = cap == null ? null : Math.max(0, cap - raisedUsd);
  const span = cap == null ? 1 : Math.max(1, cap - prevCap);
  const into = cap == null ? 1 : Math.min(1, Math.max(0, (raisedUsd - prevCap) / span));

  return {
    priceUsdPerEav7: price,
    tierId: tier.id,
    tierLabel: tier.label,
    tierIndex: index,
    raisedUsd,
    remainingInTierUsd,
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
