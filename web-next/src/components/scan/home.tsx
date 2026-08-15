"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ExplorerSearch } from "@/components/ui/explorer-search";
import { useT } from "@/i18n/provider";
import type { Block, NetworkStats, Status, Tx } from "@/lib/api";
import { fmtCompact, num, numCompact } from "@/lib/format";
import { TxChart, PriceChart } from "./charts";
import { LatestBlocks, LatestTxs } from "./latest";
import "./tokens.css";
import type { MarketPrice, PriceHistoryPoint } from "@/lib/price-market";

/**
 * Home EAVScan — porte fiel do `EAVScan.dc.html`.
 */
export function ScanHome({
  status,
  stats,
  blocks,
  txs,
  nomes,
  price,
  priceHistory,
}: {
  status: Status | null;
  stats: NetworkStats | null;
  blocks: Block[];
  txs: Tx[];
  nomes?: Record<string, string>;
  price?: MarketPrice | null;
  priceHistory?: PriceHistoryPoint[];
}) {
  const t = useT();

  const tps = (() => {
    const v = stats?.tps ?? 0;
    if (v <= 0) return "0";
    return v >= 1 ? v.toFixed(1) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  })();
  const tpsPct = Math.min(100, Math.round(((stats?.tps ?? 0) / 500) * 100));

  const supply = Number(status?.circulating ?? status?.supply ?? 0);
  const staked = Number(stats?.staked ?? 0);
  const stakedPct =
    supply > 0 ? `${((staked / supply) * 100).toFixed(1)}%` : "—";

  const exemploBloco = blocks[0]?.height;
  const exemploTx = txs[0]?.id;
  const exemploEndereco = blocks[0]?.producer;
  const height = status?.height ?? 0;

  return (
    <div className="scan">
      <section className="scan-hero">
        <div className="scan-hero__bg" aria-hidden>
          <div className="scan-hero__grid" />
          <div className="scan-hero__horizon" />
          <div className="scan-hero__blob" />
          <div className="scan-hero__aurora" />
        </div>

        <HeroCube
          className="scan-cube--l"
          size={128}
          z={64}
          faces={[
            { label: "7", big: true },
            { label: "eav20", rot: "ry180" },
            { label: `#${num(height)}`, rot: "ry90" },
            { label: "ML-DSA-44", rot: "ry-90" },
          ]}
        />
        <HeroCube
          className="scan-cube--r"
          size={72}
          z={36}
          faces={[
            { label: `TPS ${tps}` },
            { label: "DPoS 51", rot: "ry180" },
            { label: "1s", rot: "ry90" },
            { label: "72020", rot: "ry-90" },
          ]}
        />

        <div
          className="scan-hero-chip absolute right-[5%] top-[150px] pointer-events-none"
          style={{ animation: "scanFloatA 6s ease-in-out infinite alternate" }}
        >
          <div className="scan-glass flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 font-mono text-[10.5px] text-muted shadow-[0_14px_40px_-14px_rgba(99,54,196,0.7)]">
            <FlameIcon />
            {fmtCompact(status?.burned ?? "0")} EAV7
          </div>
        </div>
        <div
          className="scan-hero-chip absolute left-[5%] top-[344px] pointer-events-none"
          style={{ animation: "scanFloatB 7s ease-in-out infinite alternate" }}
        >
          <div className="scan-glass rounded-[10px] px-3.5 py-2 font-mono text-[10.5px] text-muted shadow-[0_14px_40px_-14px_rgba(99,54,196,0.7)]">
            STAKE {stakedPct}
          </div>
        </div>

        <div className="relative mx-auto max-w-[1280px] px-6 pb-2 pt-[58px] text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(159,123,255,0.4)] bg-[var(--scan-chip)] px-[18px] py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--scan-link)]">
            <span className="scan-live" aria-hidden />
            {t("scan.heroEyebrow")}
          </div>

          <h1 className="mt-6 font-display text-[clamp(46px,6.6vw,76px)] font-bold uppercase leading-[1.03] tracking-[-0.02em]">
            <span className="scan-title-outline">{t("scan.heroTitle")}</span>
            <br />
            <span className="scan-title-shine">{t("scan.heroTitle2")}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-[540px] text-[15.5px] leading-relaxed text-muted">
            {t("scan.heroSub")}
          </p>

          <div className="relative mx-auto mt-[30px] max-w-[720px] text-left">
            <div className="scan-search-shell">
              <ExplorerSearch hero placeholder={t("scan.searchPh")} buttonLabel={t("scan.searchBtn")} />
            </div>
          </div>

          {exemploBloco != null || exemploTx || exemploEndereco ? (
            <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted">
              <span>{t("scan.tryIt")}</span>
              {exemploBloco != null ? <Atalho href={`/block/${exemploBloco}`}>#{exemploBloco}</Atalho> : null}
              {exemploTx ? <Atalho href={`/tx/${exemploTx}`}>{exemploTx.slice(0, 10)}…</Atalho> : null}
              {exemploEndereco ? (
                <Atalho href={`/address/${exemploEndereco}`}>{exemploEndereco.slice(0, 10)}…</Atalho>
              ) : null}
            </div>
          ) : null}

          <div className="relative mt-10">
            <div className="flex items-center justify-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-faint">
              <span className="scan-live" aria-hidden />
              {t("scan.latestBlocks")} · {t("scan.liveLbl")} · 1s
            </div>
            <HeartbeatSvg />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1280px] px-6 pt-[30px]">
        <div className="scan-ribbon">
          <RibbonCell
            label={t("scan.statsHeight")}
            value={num(height)}
            live
          />
          <div className="scan-ribbon__div" />
          <RibbonCell
            label={t("scan.burnedLbl")}
            value={fmtCompact(status?.burned ?? "0")}
            danger
            icon={<FlameIcon />}
          />
          <div className="scan-ribbon__div" />
          <RibbonCell label={t("scan.stakingRate")} value={stakedPct} />
          <div className="scan-ribbon__div" />
          <RibbonCell
            label={t("scan.statsCirculating")}
            value={
              <>
                {fmtCompact(status?.circulating ?? 0)}{" "}
                <span className="text-[11px] font-medium text-faint">EAV7</span>
              </>
            }
          />
          <div className="scan-ribbon__div" />
          <RibbonCell label={t("scan.statsTotalTx")} value={numCompact(stats?.transactions ?? 0)} />
          <div className="scan-ribbon__div" />
          <RibbonCell label={t("scan.statsAccounts")} value={numCompact(stats?.accounts ?? 0)} />
          <div className="scan-ribbon__div" />
          <div className="scan-ribbon__cell">
            <div className="scan-ribbon__label">TPS</div>
            <div className="scan-ribbon__value">
              {tps} <span className="text-[11px] font-medium text-faint">/500</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded bg-[var(--input-bg)]">
              <div
                className="h-full rounded bg-gradient-to-r from-violet-deep to-violet transition-[width] duration-700"
                style={{ width: `${tpsPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="scan-charts">
          {/* Slot esquerdo é SEMPRE o de mercado: sem preço, o próprio
              PriceChart renderiza o estado vazio (SemDados). */}
          <PriceChart
            points={priceHistory ?? []}
            priceUsd={price?.priceUsd}
            changePct={price?.change24hPct}
            priceFmt={price?.priceUsdFormatted}
            changeFmt={price?.change24hFormatted}
          />
          <TxChart series={stats?.txSeries ?? []} />
        </div>

        <div className="scan-split mt-5 pb-12">
          <LatestBlocks
            blocks={blocks.slice(0, 8)}
            blockTimeMs={status?.blockTimeMs}
            blockReward={status?.blockReward}
            nomes={nomes}
          />
          <LatestTxs txs={txs.slice(0, 8)} />
        </div>
      </div>
    </div>
  );
}

function RibbonCell({
  label,
  value,
  live,
  danger,
  icon,
}: {
  label: string;
  value: ReactNode;
  live?: boolean;
  danger?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="scan-ribbon__cell">
      <div className="scan-ribbon__label">
        {live ? <span className="scan-live" aria-hidden /> : null}
        {icon}
        {label}
      </div>
      <div className={`scan-ribbon__value ${danger ? "text-[var(--red)]" : ""}`}>{value}</div>
    </div>
  );
}

function HeroCube({
  className,
  size,
  z,
  faces,
}: {
  className: string;
  size: number;
  z: number;
  faces: Array<{ label: string; big?: boolean; rot?: "ry180" | "ry90" | "ry-90" }>;
}) {
  const rot = (r?: string) => {
    if (r === "ry180") return `rotateY(180deg) translateZ(${z}px)`;
    if (r === "ry90") return `rotateY(90deg) translateZ(${z}px)`;
    if (r === "ry-90") return `rotateY(-90deg) translateZ(${z}px)`;
    return `translateZ(${z}px)`;
  };
  const faceCls = (i: number, rot?: string) => {
    if (i === 0 && !rot) return "scan-cube__face scan-cube__face--front";
    if (rot === "ry180") return "scan-cube__face scan-cube__face--back";
    return "scan-cube__face scan-cube__face--side";
  };
  return (
    <div className={`scan-cube ${className}`} style={{ width: size, height: size }} aria-hidden>
      {size >= 100 ? (
        <div className="scan-cube__ring">
          <span className="scan-cube__ring-dot" />
        </div>
      ) : null}
      <div className="scan-cube__spin">
        {faces.map((f, i) => (
          <div
            key={i}
            className={faceCls(i, f.rot)}
            style={{
              transform: rot(f.rot),
              fontSize: f.big ? undefined : size >= 100 ? (f.rot === "ry90" ? 10 : 11) : 9.5,
              letterSpacing: f.big ? undefined : f.rot === "ry90" ? "0.02em" : "0.08em",
            }}
          >
            {f.big ? <span className="scan-cube__seven">{f.label}</span> : f.label}
          </div>
        ))}
        <div
          className="scan-cube__face scan-cube__face--top"
          style={{ transform: `rotateX(90deg) translateZ(${z}px)` }}
        />
        <div
          className="scan-cube__face scan-cube__face--bottom"
          style={{ transform: `rotateX(-90deg) translateZ(${z}px)` }}
        />
      </div>
      <div className="scan-cube__glow" />
    </div>
  );
}

function HeartbeatSvg() {
  const path =
    "M0 86 L80 86 L100 86 L120 40 L140 110 L160 70 L180 86 L320 86 L340 86 L360 28 L380 120 L400 60 L420 86 L560 86 L580 86 L600 45 L620 105 L640 75 L660 86 L800 86 L820 86 L840 35 L860 115 L880 65 L900 86 L1040 86 L1060 86 L1080 50 L1100 100 L1120 80 L1140 86 L1200 86";
  return (
    <svg
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      className="mt-2 block h-[72px] w-full origin-bottom"
      style={{ transform: "perspective(900px) rotateX(26deg)" }}
      aria-hidden
    >
      <defs>
        <linearGradient id="ecgG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6336C4" stopOpacity="0" />
          <stop offset="55%" stopColor="#9F7BFF" />
          <stop offset="100%" stopColor="#C9B2FF" />
        </linearGradient>
        <filter id="ecgB" x="-20%" y="-150%" width="140%" height="400%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <line x1="0" y1="86" x2="1200" y2="86" stroke="var(--line-2)" strokeWidth="1" />
      <path d={path} fill="none" stroke="url(#ecgG)" strokeWidth="5" opacity="0.35" filter="url(#ecgB)" />
      <path d={path} fill="none" stroke="url(#ecgG)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="1140" cy="86" r="4.5" fill="#2ECC71" className="scan-live" style={{ animationDuration: "1.2s" }} />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function Atalho({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-[7px] bg-[var(--scan-chip)] px-2.5 py-[3px] font-mono text-[var(--scan-link)] hover:underline"
    >
      {children}
    </Link>
  );
}
