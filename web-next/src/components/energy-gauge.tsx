"use client";

// Gauge de Energia — elemento-assinatura da EAV7 (modelo de recurso DPoS).
// Anel radial mostrando energia disponível / máxima da conta.
import { useT } from "@/i18n/provider";
import { fmtEnergy } from "@/lib/format";

interface EnergyGaugeProps {
  available: number;
  max: number;
  size?: number;
}

export function EnergyGauge({ available, max, size = 132 }: EnergyGaugeProps) {
  const t = useT();
  const pct = max > 0 ? Math.max(0, Math.min(1, available / max)) : 0;
  const R = 54;
  const C = 2 * Math.PI * R;
  const gid = "energy-grad";
  const low = pct < 0.25;
  // Compacto para caber no anel (validadores têm energia = 10 + stake, ex.: 10010 → "10k").
  const availLabel = fmtEnergy(available);
  const maxLabel = fmtEnergy(max);
  const centerFont = availLabel.length >= 5 ? 22 : availLabel.length === 4 ? 26 : 30;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 130 130" role="img" aria-label={t("energyGauge.ariaLabel", { available, max })}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={low ? "var(--gold)" : "var(--teal)"} />
            <stop offset="1" stopColor={low ? "#ff8087" : "var(--violet)"} />
          </linearGradient>
        </defs>
        <circle cx="65" cy="65" r={R} fill="none" stroke="var(--line-2)" strokeWidth="10" />
        <circle
          cx="65"
          cy="65"
          r={R}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(C * pct).toFixed(2)} ${C.toFixed(2)}`}
          transform="rotate(-90 65 65)"
          style={{ transition: "stroke-dasharray .6s cubic-bezier(.22,1,.36,1)" }}
        />
        <text x="65" y="61" textAnchor="middle" className="font-display tnum" fontSize={centerFont} fontWeight="800" fill="var(--ink)">
          {availLabel}
        </text>
        <text x="65" y="80" textAnchor="middle" fontSize="11" fill="var(--faint)" fontFamily="var(--font-mono)">
          / {maxLabel}
        </text>
      </svg>
      <div>
        <div className="font-display text-[15px] font-bold text-ink">{t("energyGauge.title")}</div>
        <p className="mt-1 max-w-[30ch] text-[12.5px] leading-relaxed text-muted">
          {t("energyGauge.description")}
        </p>
      </div>
    </div>
  );
}
