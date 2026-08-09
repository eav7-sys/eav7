"use client";

import { fmtCompact, num, numCompact } from "@/lib/format";
import { useT } from "@/i18n/provider";
import type { NetworkStats, Status } from "@/lib/api";

/** Um card da faixa de métricas. `live` liga o ponto pulsante. */
function Card({ label, value, sub, live }: {
  label: string;
  value: string;
  sub?: string;
  live?: boolean;
}) {
  return (
    <div className="scan-glass px-[18px] py-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">
        {live ? <span className="scan-live" aria-hidden /> : null}
        {label}
      </div>
      <div className="mt-[7px] text-xl font-bold text-ink">
        {value}
        {sub ? <span className="ml-1.5 text-xs font-semibold text-muted">{sub}</span> : null}
      </div>
    </div>
  );
}

/**
 * A faixa de seis métricas da home.
 *
 * O desenho original trazia PREÇO e MARKET CAP nos dois primeiros cards. A EAV7
 * não tem oráculo de preço, e preço num explorador é dado FINANCEIRO: um número
 * fabricado ali vira decisão de compra tomada em cima de ficção. Os dois lugares
 * passam a mostrar o que a rede de fato publica — supply circulante e total em
 * stake — mantendo a grade de seis intacta.
 */
export function StatCards({ status, stats }: { status: Status | null; stats: NetworkStats | null }) {
  const t = useT();

  // O TPS vem MEDIDO do nó (`/stats.tps`), sobre o intervalo real dos blocos.
  // Aqui a conta era "último balde da série / 3600" — e o último balde é o da
  // hora corrente, sempre parcial: logo depois de virar a hora, uma rede em uso
  // normal aparecia com TPS perto de zero.
  const tps = (() => {
    const v = stats?.tps ?? 0;
    if (v <= 0) return "0";
    return v >= 1 ? v.toFixed(1) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  })();

  return (
    <div className="scan-stats">
      <Card label={t("scan.statsCirculating")} value={fmtCompact(status?.circulating ?? 0)} sub="EAV7" />
      <Card label={t("scan.statsStaked")} value={fmtCompact(stats?.staked ?? 0)} sub="EAV7" />
      <Card label={t("scan.statsHeight")} value={num(status?.height ?? 0)} live />
      <Card label={t("scan.statsTotalTx")} value={numCompact(stats?.transactions ?? 0)} />
      <Card label={t("scan.statsAccounts")} value={numCompact(stats?.accounts ?? 0)} />
      <Card label={t("scan.statsTps")} value={tps} />
    </div>
  );
}
