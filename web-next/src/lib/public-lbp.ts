import fs from "node:fs";
import path from "node:path";

export type PublicLbpAddresses = {
  version: number;
  status: string;
  network: string;
  rpc: string;
  publicCustodyEoa: string;
  admin0x: string | null;
  relayer0x: string | null;
  sweepTo0x: string | null;
  publicVault0x: string | null;
  timelockLpSeeder0x: string | null;
  ammRouter0x: string | null;
  pairToken0x: string | null;
  openedAtHeight: number | null;
  lbpDeadlineHeight: number | null;
  notes?: string;
};

export type PublicLbpTier = {
  id: string;
  label: string;
  untilRaisedUsd: number | null;
  priceUsdPerEav7: string;
};

export type PublicLbpDelivery = {
  channel?: string;
  windowHours?: number;
  priceHintUsd?: { start: string; end: string };
  tiers: PublicLbpTier[];
  lpLockMonths?: number;
};

function candidates(...parts: string[]) {
  return [
    path.resolve(process.cwd(), "..", ...parts),
    path.resolve(process.cwd(), ...parts),
  ];
}

function readJson<T>(paths: string[]): T | null {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as T;
    } catch {
      /* next */
    }
  }
  return null;
}

export function loadPublicLbpAddresses(): PublicLbpAddresses | null {
  return readJson(candidates("contracts", "sale", "public-lbp-addresses.json"));
}

export function loadPublicLbpDelivery(): PublicLbpDelivery | null {
  return readJson(candidates("contracts", "sale", "public-lbp-delivery.json"));
}

/** Vault deployed + buckets set — still may need funding / openLbp. */
export function isPublicVaultDeployed(a: PublicLbpAddresses | null): boolean {
  return Boolean(a?.publicVault0x && a.status !== "not-deployed");
}

/** LBP window marketed + accepting public buys on the site/price feed. */
export function isLbpOpen(a: PublicLbpAddresses | null): boolean {
  if (!a) return false;
  // Explicit status only — on-chain openLbp alone must not flip /price to $0.008
  // while private sale is still the public product focus.
  return a.status === "lbp-open";
}

/** Vault had openLbp on-chain (may still be true while marketing is deferred). */
export function isLbpPreparedOnChain(a: PublicLbpAddresses | null): boolean {
  if (!a) return false;
  if (a.status === "lbp-open" || a.status === "lbp-prepared") {
    return Boolean(a.openedAtHeight && a.lbpDeadlineHeight);
  }
  return Boolean(a.openedAtHeight && a.lbpDeadlineHeight);
}
