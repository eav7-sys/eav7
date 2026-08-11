export type SaleIntent = {
  id: string;
  status: "pending" | "paid" | "granted" | string;
  beneficiary0x: string;
  rail: string;
  chain: string;
  asset: string;
  standard: string;
  decimals?: number;
  usdAmount: string;
  payAmount: string;
  e7Amount: string;
  priceUsdPerEav7?: string | null;
  tierId?: string | null;
  receive: string;
  explorer: string;
  createdAt: string;
  paymentTx: string | null;
  paymentId: string | null;
  grantTx: string | null;
  manualConfirm: boolean;
  channel?: "private" | "public";
  liquid?: boolean;
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

type ApiOk<T> = { data: T };
type ApiErr = { error: { code: string; message: string } };

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json()) as ApiOk<T> | ApiErr;
  if (!res.ok) {
    const msg = "error" in json ? json.error.message : res.statusText;
    throw new Error(msg);
  }
  if (!("data" in json)) throw new Error("resposta inválida");
  return json.data;
}

export async function getSaleQuote(channel: "private" | "public" = "private"): Promise<SaleQuote> {
  const path = channel === "public" ? "/sale-api/public/quote" : "/sale-api/quote";
  const res = await fetch(path, { cache: "no-store" });
  return parse<SaleQuote>(res);
}

export async function createSaleIntent(
  input: {
    beneficiary0x: string;
    rail: string;
    usdAmount: number;
  },
  channel: "private" | "public" = "private",
): Promise<SaleIntent> {
  const path = channel === "public" ? "/sale-api/public/intent" : "/sale-api/intent";
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parse<SaleIntent>(res);
}

export async function getSaleIntent(
  id: string,
  channel: "private" | "public" = "private",
): Promise<SaleIntent> {
  const path =
    channel === "public" ? `/sale-api/public/intent/${id}` : `/sale-api/intent/${id}`;
  const res = await fetch(path, { cache: "no-store" });
  return parse<SaleIntent>(res);
}

export async function confirmSaleIntent(
  input: {
    intentId: string;
    txHash: string;
  },
  channel: "private" | "public" = "private",
): Promise<SaleIntent> {
  const path = channel === "public" ? "/sale-api/public/confirm" : "/sale-api/confirm";
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parse<SaleIntent>(res);
}

export function formatPayDisplay(intent: SaleIntent): string {
  const decimals = intent.decimals ?? (intent.asset === "BTC" ? 8 : 6);
  const n = BigInt(intent.payAmount);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function e7ToWhole(e7Amount: string): string {
  const n = BigInt(e7Amount);
  const whole = n / 1_000_000n;
  const frac = n % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}
