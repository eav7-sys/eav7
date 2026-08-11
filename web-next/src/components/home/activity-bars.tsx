"use client";

import { useT } from "@/i18n/provider";

// Barras de transações por bloco (últimos N). SVG próprio, leve.
export function ActivityBars({ values }: { values: number[] }) {
  const t = useT();
  const W = 520;
  const H = 90;
  const n = values.length || 1;
  const gap = 2.5;
  const bw = (W - gap * (n - 1)) / n;
  const max = Math.max(1, ...values);
  const gid = "act-grad";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-3 block h-[90px] w-full"
      role="img"
      aria-label={t("home_activityBars.ariaLabel")}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--violet)" />
          <stop offset="1" stopColor="var(--violet-deep)" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {values.map((v, i) => {
        const bh = Math.max(2, (v / max) * (H - 6));
        const x = i * (bw + gap);
        const last = i === n - 1;
        return (
          <rect
            key={i}
            x={x.toFixed(1)}
            y={(H - bh).toFixed(1)}
            width={Math.max(1, bw).toFixed(1)}
            height={bh.toFixed(1)}
            rx="1.5"
            fill={last ? "var(--teal)" : `url(#${gid})`}
          >
            <title>{t("home_activityBars.txsCount", { n: v })}</title>
          </rect>
        );
      })}
    </svg>
  );
}
