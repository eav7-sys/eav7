"use client";

import { useT } from "@/i18n/provider";

// Gauge radial "assinatura" da EAV7 — arco de slots DPoS ocupados.
interface SlotsGaugeProps {
  value: number;
  max: number;
  label: string;
  sublabel?: string;
}

export function SlotsGauge({ value, max, label, sublabel }: SlotsGaugeProps) {
  const t = useT();
  const pct = Math.max(0, Math.min(1, value / Math.max(1, max)));
  const R = 52;
  const C = Math.PI * R; // semicírculo
  const gid = "gauge-grad";
  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 130 78"
        className="w-full max-w-[220px]"
        role="img"
        aria-label={t("home_slotsGauge.ariaValueOf", { value, max })}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--violet)" />
            <stop offset="1" stopColor="var(--teal)" />
          </linearGradient>
        </defs>
        <path
          d="M13 68 A52 52 0 0 1 117 68"
          fill="none"
          stroke="var(--line-2)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          d="M13 68 A52 52 0 0 1 117 68"
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(C * pct).toFixed(2)} ${C.toFixed(2)}`}
          style={{ transition: "stroke-dasharray .6s cubic-bezier(.22,1,.36,1)" }}
        />
        <text
          x="65"
          y="60"
          textAnchor="middle"
          className="font-display tnum"
          fontSize="26"
          fontWeight="800"
          fill="var(--ink)"
        >
          {value}
        </text>
        <text x="65" y="73" textAnchor="middle" fontSize="9" fill="var(--faint)" fontFamily="var(--font-mono)">
          / {max}
        </text>
      </svg>
      <div className="mt-1 text-center">
        <div className="text-[13px] font-bold text-ink">{label}</div>
        {sublabel && <div className="text-[11.5px] text-muted">{sublabel}</div>}
      </div>
    </div>
  );
}
