"use client";

import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n/provider";
import { getNetworkStats, getStatus, type NetworkStats as Stats } from "@/lib/api";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { num, numCompact, UNIT } from "@/lib/format";
import { IconNetwork, IconTx, IconToken, IconValidator } from "@/components/icons";

type Viz = "none" | "line" | "area" | "ring";

interface Card {
  labelKey: string;
  value: keyof Stats;
  delta?: keyof Stats; // presente só quando há delta 24h REAL (ex.: transações)
  series?: "txSeries" | "volSeries"; // série horária real p/ o sparkline
  flow?: boolean; // métrica de fluxo 24h (volume) — mostra "· 24h", sem % de crescimento
  unit?: string;
  compact?: boolean;
  icon: React.ReactNode;
  chip: string;
  accent: string;
  viz: Viz;
}

const CARDS: Card[] = [
  { labelKey: "cards.accounts.label", value: "accounts", icon: <IconNetwork size={16} />, chip: "chip-violet", accent: "var(--violet)", viz: "none" },
  { labelKey: "cards.transactions.label", value: "transactions", delta: "transactionsDelta", series: "txSeries", icon: <IconTx size={16} />, chip: "chip-teal", accent: "var(--teal)", viz: "line" },
  { labelKey: "cards.volume.label", value: "volume", series: "volSeries", flow: true, unit: "EAV7", compact: true, icon: <IconToken size={16} />, chip: "chip-gold", accent: "var(--gold)", viz: "area" },
  { labelKey: "cards.staked.label", value: "staked", unit: "EAV7", compact: true, icon: <IconValidator size={16} />, chip: "chip-blue", accent: "var(--blue)", viz: "ring" },
];

// Normaliza uma série real (contagens/volumes) para 0..1 para desenhar o sparkline.
function normalize(arr: number[]): number[] {
  const max = Math.max(1, ...arr);
  return arr.map((v) => Math.max(0.04, v / max));
}

const W = 120;
const H = 46;

function points(values: number[]) {
  const n = values.length;
  return values.map((v, i) => [(i / (n - 1)) * W, H - v * (H - 6) - 3] as const);
}

function Line({ values, accent, id }: { values: number[]; accent: string; id: string }) {
  const pts = points(values);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-3 h-11 w-full">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: accent, stopOpacity: 0.35 }} />
          <stop offset="1" style={{ stopColor: accent, stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      <path
        d={line}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="spark-draw"
        style={{ filter: `drop-shadow(0 0 3px color-mix(in srgb, ${accent} 55%, transparent))` }}
      />
      <circle cx={last[0]} cy={last[1]} r="2.8" className="spark-dot" style={{ fill: accent }} />
    </svg>
  );
}

function Area({ values, accent, id }: { values: number[]; accent: string; id: string }) {
  const pts = points(values);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-3 h-11 w-full">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: accent, stopOpacity: 0.5 }} />
          <stop offset="1" style={{ stopColor: accent, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        style={{ stroke: accent, filter: `drop-shadow(0 0 3px color-mix(in srgb, ${accent} 55%, transparent))` }}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="spark-draw"
      />
      <circle cx={last[0]} cy={last[1]} r="2.6" className="spark-dot" style={{ fill: accent }} />
    </svg>
  );
}

// Rótulo adaptativo da % de staking: evita mostrar "0%" para razões minúsculas
// (hoje só validadores estacam) e usa casas decimais quando < 1%.
function pctLabel(pct: number): string {
  const v = pct * 100;
  if (v <= 0) return "0%";
  if (v < 0.01) return "<0.01%";
  if (v < 1) return v.toFixed(2) + "%";
  return Math.round(v) + "%";
}

function Ring({ accent, pct }: { accent: string; pct: number | null }) {
  const t = useT();
  const R = 17;
  const C = 2 * Math.PI * R;
  const loading = pct == null;
  const p = pct ?? 0;
  // arco mínimo visível quando há stake real porém minúsculo
  const arc = p > 0 ? Math.max(C * p, 1.5) : 0;
  return (
    <div className="mt-3 flex h-11 items-center gap-3">
      <div className="relative h-11 w-11 flex-none">
        <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90">
          <circle cx="22" cy="22" r={R} fill="none" stroke="var(--line-2)" strokeWidth="4" />
          <circle
            cx="22"
            cy="22"
            r={R}
            fill="none"
            style={{ stroke: accent, filter: `drop-shadow(0 0 4px color-mix(in srgb, ${accent} 60%, transparent))`, transition: "stroke-dasharray .8s cubic-bezier(.22,1,.36,1)" }}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${arc.toFixed(1)} ${C.toFixed(1)}`}
          />
        </svg>
        <span className="font-display tnum absolute inset-0 grid place-items-center text-[10px] font-bold text-ink">
          {loading ? "—" : pctLabel(p)}
        </span>
      </div>
      <span className="text-[11.5px] leading-tight text-muted">
        {t("home_netStats.ring.supplyLine1")}
        <br />
        {t("home_netStats.ring.supplyLine2")}
      </span>
    </div>
  );
}

export function NetworkStats({ initial }: { initial: Stats | null }) {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["stats"],
    queryFn: getNetworkStats,
    refetchInterval: 5000,
    initialData: initial ?? undefined,
  });
  // Supply real (do /status) para a razão de staking do anel — sem isto o % era fixo.
  const { data: status } = useQuery({ queryKey: ["status"], queryFn: getStatus, refetchInterval: 5000 });
  const supplyEav7 = status ? Number(BigInt(status.supply) / UNIT) : 0;
  // Fração 0..1 do supply em staking; null = ainda carregando (mostra "—").
  const stakedPct = data && supplyEav7 > 0 ? Math.min(1, data.staked / supplyEav7) : null;

  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-[1180px] px-5 py-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {CARDS.map((c) => {
            const v = data ? (data[c.value] as number) : 0;
            const fmt = c.compact ? numCompact : num;
            const raw = c.series && data ? (data[c.series] as number[] | undefined) : undefined;
            const s = raw && raw.length ? normalize(raw) : null;
            const d = c.delta && data ? (data[c.delta] as number) : 0;
            // % de crescimento só para métrica CUMULATIVA com delta 24h real (ex.: transações)
            const showDelta = !c.flow && !!c.delta && d > 0;
            const growthPct = showDelta && v - d > 0 ? (d / (v - d)) * 100 : 0;
            return (
              <div key={c.labelKey} className="card card-lux group relative overflow-hidden p-5">
                <div className="relative flex items-start justify-between gap-2">
                  <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                    {t(`home_netStats.${c.labelKey}`)}
                  </span>
                  <span className={`icon-chip icon-chip-sm ${c.chip}`}>{c.icon}</span>
                </div>
                <div className="font-display tnum relative mt-2.5 text-[clamp(22px,2.6vw,30px)] font-extrabold leading-none">
                  {data ? <AnimatedNumber value={v} format={fmt} /> : "—"}
                  {c.unit && <small className="ml-1 text-[12px] font-semibold text-muted">{c.unit}</small>}
                </div>

                {/* sparkline com dados REAIS (série horária de 24h); sem série → espaçador */}
                {c.viz === "line" && (s ? <Line values={s} accent={c.accent} id={`spark-${c.value}`} /> : <div className="mt-3 h-11" />)}
                {c.viz === "area" && (s ? <Area values={s} accent={c.accent} id={`spark-${c.value}`} /> : <div className="mt-3 h-11" />)}
                {c.viz === "ring" && <Ring accent={c.accent} pct={stakedPct} />}
                {c.viz === "none" && <div className="mt-3 h-11" />}

                {/* rodapé: só mostra variação quando é REAL */}
                {showDelta ? (
                  <div className="mt-2.5 flex items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-bold text-ok"
                      style={{ background: "color-mix(in srgb, var(--ok) 14%, transparent)" }}
                    >
                      ▲ {growthPct.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                    </span>
                    <span className="font-mono text-[11px] text-faint">+{fmt(d)} · 24h</span>
                  </div>
                ) : c.flow ? (
                  <div className="mt-2.5">
                    <span className="font-mono text-[11px] text-faint">{data ? fmt(v) : "—"} · 24h</span>
                  </div>
                ) : (
                  <div className="mt-2.5 h-[19px]" />
                )}

                {/* linha de acento inferior */}
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] opacity-70"
                  style={{ background: `linear-gradient(90deg, transparent, ${c.accent}, transparent)` }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
