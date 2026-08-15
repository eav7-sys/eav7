/**
 * Circulating para trackers / market page.
 *
 * - `gross` = status.circulating do nó = gênese + emitido − queimado
 * - `lockedCustody` = soma dos saldos das 4 custódias de gênese
 * - `freeFloat` = gross − lockedCustody
 *
 * Tokens ainda nas custódias (público não distribuído, privada, parceiro, tesouraria)
 * NÃO entram no free float até saírem on-chain para o mercado / destinatários.
 */
import { getAddress, getStatus } from "@/lib/api";
import { CUSTODY } from "@/lib/custody";
import { e7ToHuman } from "@/lib/price-market";

export type CustodyBalance = {
  id: string;
  label: string;
  labelEn: string;
  address: string;
  sharePct: number;
  role: string;
  roleEn: string;
  balanceE7: string;
  balanceEav7: number;
};

export type CirculatingSnapshot = {
  updatedAt: number;
  height: number;
  genesisE7: string;
  mintedE7: string;
  burnedE7: string;
  /** Gross: gênese + emitido − queimado (campo `circulating` do nó). */
  grossE7: string;
  grossEav7: number;
  lockedCustodyE7: string;
  lockedCustodyEav7: number;
  /** Free float estimado para mcap / trackers. */
  freeFloatE7: string;
  freeFloatEav7: number;
  formula: string;
  custody: CustodyBalance[];
  notes: string[];
};

function big(s: string | number | undefined | null): bigint {
  try {
    return BigInt(String(s ?? "0"));
  } catch {
    return 0n;
  }
}

export async function getCirculatingSnapshot(): Promise<CirculatingSnapshot> {
  const status = await getStatus();
  const balances = await Promise.all(
    CUSTODY.map(async (c) => {
      try {
        const info = await getAddress(c.address);
        const balanceE7 = String(info.balance ?? "0");
        return {
          id: c.id,
          label: c.label,
          labelEn: c.labelEn,
          address: c.address,
          sharePct: c.sharePct,
          role: c.role,
          roleEn: c.roleEn,
          balanceE7,
          balanceEav7: e7ToHuman(balanceE7),
        } satisfies CustodyBalance;
      } catch {
        return {
          id: c.id,
          label: c.label,
          labelEn: c.labelEn,
          address: c.address,
          sharePct: c.sharePct,
          role: c.role,
          roleEn: c.roleEn,
          balanceE7: "0",
          balanceEav7: 0,
        } satisfies CustodyBalance;
      }
    }),
  );

  const gross = big(status.circulating);
  const locked = balances.reduce((acc, b) => acc + big(b.balanceE7), 0n);
  const free = gross > locked ? gross - locked : 0n;

  return {
    updatedAt: Date.now(),
    height: status.height ?? 0,
    genesisE7: String(status.genesisSupply ?? status.supply ?? "0"),
    mintedE7: String(status.minted ?? "0"),
    burnedE7: String(status.burned ?? "0"),
    grossE7: gross.toString(),
    grossEav7: e7ToHuman(gross),
    lockedCustodyE7: locked.toString(),
    lockedCustodyEav7: e7ToHuman(locked),
    freeFloatE7: free.toString(),
    freeFloatEav7: e7ToHuman(free),
    formula: "freeFloat = (genesis + minted − burned) − Σ(custody balances)",
    custody: balances,
    notes: [
      "Gross circulating matches the node /status field (protocol accounting).",
      "Free float subtracts the four published genesis custody balances still on-chain.",
      "Price on /price is still sale-tier or EAV7_PRICE_USD until a DEX pool is live.",
      "Public 45% market plan: contracts/sale/public-distribution.json (LBP → LP seed → CEX buffer).",
    ],
  };
}

/** String e7 do free float — para mcap em /price. */
export async function getFreeFloatE7(): Promise<string> {
  const s = await getCirculatingSnapshot();
  return s.freeFloatE7;
}
