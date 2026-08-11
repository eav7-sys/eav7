"use client";

import type { ReactNode } from "react";
import { useT } from "@/i18n/provider";
import { fmtUsd, numCompact } from "@/lib/format";
import type { PriceHistoryPoint } from "@/lib/price-market";

/**
 * Gráficos da home no layout do EAVScan.dc.html:
 * esquerda = preço EAV7 (/price/history), direita = barras de txs.
 */

function Moldura({
  title,
  right,
  children,
}: {
  title: string;
  right: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="scan-chart">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[12.5px] font-bold text-ink">{title}</div>
        <div className="flex items-baseline gap-2 text-[11px] text-faint">{right}</div>
      </div>
      {children}
    </div>
  );
}

function SemDados({ msg }: { msg: string }) {
  return <div className="flex h-24 items-center justify-center text-[13px] text-faint">{msg}</div>;
}

/** Área + linha — chartPrice do desenho com série real. */
export function PriceChart({
  points,
  priceUsd,
  changePct,
  priceFmt,
  changeFmt,
}: {
  points: PriceHistoryPoint[];
  priceUsd?: number;
  changePct?: number;
  priceFmt?: string;
  changeFmt?: string;
}) {
  const t = useT();
  const right = priceFmt ? (
    <>
      <span className="font-display text-[16px] font-bold text-ink">{priceFmt}</span>
      {changeFmt ? (
        <span className={(changePct ?? 0) >= 0 ? "font-bold text-ok" : "font-bold text-[var(--red)]"}>
          {changeFmt}
        </span>
      ) : null}
    </>
  ) : (
    t("scan.chartWindow")
  );

  if (points.length < 2) {
    return (
      <Moldura title={t("scan.chartPrice")} right={right}>
        <SemDados msg={t("scan.empty")} />
      </Moldura>
    );
  }

  const vals = points.map((p) => p.priceUsd);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(max - min, max * 0.001, 1e-9);
  const passo = 600 / (points.length - 1);
  const coords = points.map((p, i) => [i * passo, 152 - ((p.priceUsd - min) / span) * 140] as const);
  const linha = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${linha} L600,160 L0,160 Z`;
  const last = priceUsd ?? vals[vals.length - 1] ?? 0;
  const ch = changePct ?? 0;

  return (
    <Moldura
      title={t("scan.chartPrice")}
      right={
        <>
          <span className="font-display text-[16px] font-bold text-ink">{priceFmt ?? fmtUsd(last, 4)}</span>
          <span className={ch >= 0 ? "font-bold text-ok" : "font-bold text-[var(--red)]"}>
            {changeFmt ?? `${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%`}
          </span>
        </>
      }
    >
      <svg
        viewBox="0 0 600 160"
        preserveAspectRatio="none"
        className="mt-2.5 block h-24 w-full"
        role="img"
        aria-label={t("scan.chartPrice")}
      >
        <defs>
          <linearGradient id="scanPriceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6336C4" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#6336C4" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#scanPriceGrad)" />
        <path d={linha} fill="none" stroke="#9F7BFF" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
    </Moldura>
  );
}

/** Fallback de atividade (blocos/h) — ainda usado se preço falhar. */
export function ActivityChart({ series }: { series: number[] }) {
  const t = useT();
  const total = series.reduce((a, b) => a + b, 0);
  if (series.length < 2 || total === 0) {
    return (
      <Moldura title={t("scan.chartActivity")} right={t("scan.chartWindow")}>
        <SemDados msg={t("scan.empty")} />
      </Moldura>
    );
  }

  const max = Math.max(...series, 1);
  const passo = 600 / (series.length - 1);
  const pontos = series.map((v, i) => [i * passo, 152 - (v / max) * 140] as const);
  const linha = pontos.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${linha} L600,160 L0,160 Z`;
  const ultima = series[series.length - 1] ?? 0;

  return (
    <Moldura title={t("scan.chartActivity")} right={`${numCompact(ultima)}/h`}>
      <svg
        viewBox="0 0 600 160"
        preserveAspectRatio="none"
        className="mt-2.5 block h-24 w-full"
        role="img"
        aria-label={t("scan.chartActivity")}
      >
        <defs>
          <linearGradient id="scanActGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6336C4" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#6336C4" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#scanActGrad)" />
        <path d={linha} fill="none" stroke="#9F7BFF" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
    </Moldura>
  );
}

/** Barras — chartTx do desenho. */
export function TxChart({ series }: { series: number[] }) {
  const t = useT();
  const total = series.reduce((a, b) => a + b, 0);
  if (!series.length || total === 0) {
    return (
      <Moldura title={t("scan.chartTx")} right={t("scan.last30d")}>
        <SemDados msg={t("scan.empty")} />
      </Moldura>
    );
  }

  const max = Math.max(...series);
  const larguraBarra = 600 / series.length;
  const vao = Math.min(4, larguraBarra * 0.25);

  return (
    <Moldura title={t("scan.chartTx")} right={`${t("scan.last30d")} · ${numCompact(total)}`}>
      <svg
        viewBox="0 0 600 160"
        preserveAspectRatio="none"
        className="mt-2.5 block h-24 w-full"
        role="img"
        aria-label={`${t("scan.chartTx")}: ${numCompact(total)}`}
      >
        {series.map((v, i) => {
          const h = v === 0 ? 0 : Math.max(2, (v / max) * 148);
          return (
            <rect
              key={i}
              x={i * larguraBarra + vao / 2}
              y={156 - h}
              width={Math.max(1, larguraBarra - vao)}
              height={h}
              rx="3"
              fill="var(--violet-deep)"
              opacity="0.8"
            />
          );
        })}
      </svg>
    </Moldura>
  );
}

/** @deprecated use ActivityChart */
export function BlocksChart(props: { series: number[] }) {
  return <ActivityChart {...props} />;
}
