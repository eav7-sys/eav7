"use client";

import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n/provider";
import { getSecurityAlerts, getStatus, getAiOracles, getAiTasks } from "@/lib/api";
import { Ago } from "@/components/ui/ago";
import { num } from "@/lib/format";

const SEV: Record<string, { cls: string; dot: string }> = {
  critical: { cls: "badge-pink", dot: "var(--pink)" },
  warning: { cls: "badge-gold", dot: "var(--gold)" },
  info: { cls: "badge-green", dot: "var(--ok)" },
};

export function SecuritySentinel() {
  const t = useT();
  const alertsQ = useQuery({ queryKey: ["security-alerts"], queryFn: getSecurityAlerts, refetchInterval: 10_000 });
  const statusQ = useQuery({ queryKey: ["status"], queryFn: getStatus, refetchInterval: 5_000 });
  const oraclesQ = useQuery({ queryKey: ["ai-oracles"], queryFn: getAiOracles, refetchInterval: 30_000 });
  const tasksQ = useQuery({ queryKey: ["ai-tasks"], queryFn: getAiTasks, refetchInterval: 15_000 });

  const alerts = alertsQ.data ?? [];
  const status = statusQ.data;
  const oracles = oraclesQ.data ?? [];
  const tasks = tasksQ.data ?? [];

  const stat = (label: string, value: number) => (
    <div className="flex-1 rounded-xl border border-line bg-panel/50 px-3.5 py-2.5 text-center">
      <div className="font-display tnum text-[18px] font-extrabold text-ink">{num(value)}</div>
      <div className="font-mono mt-0.5 text-[10px] uppercase tracking-wide text-faint">{label}</div>
    </div>
  );

  return (
    <section className="card mb-4 p-6 sm:p-7">
      <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-ok">
        <span className="livedot" style={{ width: 7, height: 7, background: "var(--ok)" }} />
        {t("secSentinel.title")}
        <span className="ml-1 rounded-full border border-line-2 bg-panel/70 px-2 py-0.5 text-[10px] font-semibold text-muted">
          {t("secSentinel.live")}
        </span>
      </div>
      <p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-muted">{t("secSentinel.sub")}</p>

      {/* contadores ao vivo */}
      <div className="mt-4 flex gap-2.5">
        {stat(t("secSentinel.stat_reports"), status?.security.alerts ?? alerts.length)}
        {stat(t("secSentinel.stat_oracles"), status?.ai.oracles ?? oracles.length)}
        {stat(t("secSentinel.stat_tasks"), status?.ai.pendingTasks ?? tasks.length)}
      </div>

      {/* lista de reports */}
      <div className="mt-5">
        <div className="font-mono mb-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-faint">
          {t("secSentinel.reports")}
        </div>
        {alerts.length === 0 ? (
          <div className="rounded-xl border border-line bg-panel/40 px-4 py-6 text-center text-[13px] text-muted">
            {alertsQ.isLoading ? t("secSentinel.loading") : t("secSentinel.empty")}
          </div>
        ) : (
          <div className="max-h-[520px] overflow-y-auto pr-1">
            <ul className="flex flex-col gap-2">
              {alerts.slice(0, 80).map((a, i) => {
                const sev = SEV[a.severity] ?? { cls: "", dot: "var(--muted)" };
                return (
                  <li
                    key={`${a.at}-${i}`}
                    className="flex items-start gap-3 rounded-xl border border-line bg-panel/50 px-3.5 py-3"
                  >
                    <span className="mt-1 h-2 w-2 flex-none rounded-full" style={{ background: sev.dot, boxShadow: `0 0 6px ${sev.dot}` }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge ${sev.cls}`}>{t(`secSentinel.sev.${a.severity}`) || a.severity}</span>
                        <span className="font-mono text-[11px] font-semibold text-muted">{a.kind}</span>
                        <span className="font-mono ml-auto text-[10.5px] text-faint">
                          <Ago ts={a.at} />
                        </span>
                      </div>
                      <p className="mt-1 break-words text-[13px] leading-relaxed text-ink">{a.message}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
