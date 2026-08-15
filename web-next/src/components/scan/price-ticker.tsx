"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MarketPrice } from "@/lib/price-market";

/** Ticker EAV7/USD no cabeçalho — poll /price a cada 30s. */
export function PriceTicker() {
  const [p, setP] = useState<MarketPrice | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/price", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { data: MarketPrice };
        if (alive) setP(j.data);
      } catch {
        /* silencioso */
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!p) return null;

  const up = p.change24hPct >= 0;
  return (
    <Link
      href="/market"
      title={`${p.sourceLabel} · atualizado ${new Date(p.updatedAt).toLocaleTimeString()}`}
      className="hidden items-center gap-1.5 rounded-[10px] border border-[var(--scan-border)] bg-[var(--scan-chip)] px-2.5 py-1.5 font-mono text-[11px] font-semibold text-ink transition hover:border-[rgba(159,123,255,0.45)] min-[1100px]:inline-flex"
    >
      <span className="text-[var(--scan-link)]">EAV7</span>
      <span>{p.priceUsdFormatted}</span>
      <span className={up ? "text-ok" : "text-[var(--red)]"}>{p.change24hFormatted}</span>
    </Link>
  );
}
