import Link from "next/link";
import type { ReactNode } from "react";
import type { AiOracle, AiTask } from "@/lib/api";
import { getT } from "@/i18n/server";
import { ago, fmt, fmtCompact, num, shortHash } from "@/lib/format";
import "@/components/scan/tokens.css";

const AVATAR = ["#6336C4", "#7A4AE8", "#9F7BFF", "#45E0E6", "#2ECC71", "#F39C12", "#E879F9", "#5EA0FF"];

function statusMeta(status: string, t: (k: string) => string): { label: string; bg: string; color: string } {
  const s = status.toUpperCase();
  if (s === "DONE") return { label: t("page_ai.stsDone"), bg: "rgba(46,204,113,0.16)", color: "var(--ok)" };
  if (s === "REFUNDED") return { label: t("page_ai.stsRefunded"), bg: "rgba(112,112,112,0.18)", color: "var(--faint)" };
  if (s === "DISPUTED" || s === "CHALLENGE_PERIOD")
    return { label: t("page_ai.stsChallenge"), bg: "rgba(243,156,18,0.16)", color: "var(--gold)" };
  if (s === "BIDDING") return { label: t("page_ai.stsBidding"), bg: "rgba(159,123,255,0.16)", color: "var(--violet)" };
  return { label: t("page_ai.stsPending"), bg: "rgba(94,160,255,0.14)", color: "var(--blue)" };
}

export async function ScanAiView({
  oracles,
  tasks,
}: {
  oracles: AiOracle[];
  tasks: AiTask[];
}) {
  const t = await getT();
  const now = Date.now();
  const day = 86_400_000;
  const tasks24 = tasks.filter((k) => (k.createdAt ?? 0) > now - day).length || tasks.length;
  const stakeTotal = oracles.reduce((acc, o) => acc + BigInt(o.stake ?? "0"), 0n);
  const avgRep =
    oracles.length === 0
      ? 0
      : Math.round(oracles.reduce((a, o) => a + (o.reputation ?? 50), 0) / oracles.length);

  const sorted = [...oracles].sort((a, b) => (b.reputation ?? 0) - (a.reputation ?? 0));

  return (
    <div className="scan mx-auto max-w-[1280px] px-6 py-9">
      <div className="mb-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(159,123,255,0.35)] bg-[var(--scan-chip)] px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--scan-link)]">
          <span className="scan-live" aria-hidden />
          {t("page_ai.eyebrow")}
        </div>
        <h1 className="mt-3.5 font-display text-[clamp(30px,3.4vw,40px)] font-bold tracking-[-0.02em] text-ink">
          {t("page_ai.title")}
        </h1>
        <p className="mt-2.5 font-mono text-[11.5px] text-faint">{t("page_ai.specLine")}</p>
        <p className="mt-3 max-w-[760px] text-[13.5px] leading-relaxed text-muted">{t("page_ai.subtitle")}</p>
      </div>

      <div className="mb-5 flex items-center gap-2.5 overflow-x-auto pb-1">
        <PipelineStep n="01" title="AI_TASK" sub={t("page_ai.stepEscrow")} />
        <PipeArrow />
        <PipelineStep n="02" title="COMMIT" sub="H(out ‖ salt)" />
        <PipeArrow />
        <PipelineStep n="03" title="REVEAL" sub="30 min" />
        <PipeArrow />
        <PipelineStep n="04" title={t("page_ai.stepChal")} sub="20 EAV7" warn />
        <PipeArrow />
        <PipelineStep n="05" title={t("page_ai.stepSettled")} sub="+4 rep" ok />
      </div>

      <div className="mb-5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("page_ai.oraclesReg")} value={num(oracles.length)} />
        <StatCard label={t("page_ai.oracleStake")} value={fmtCompact(stakeTotal.toString())} />
        <StatCard label={t("page_ai.tasks24")} value={num(tasks24)} />
        <StatCard
          label={t("page_ai.avgRep")}
          value={
            <>
              <span className="text-ok">{avgRep}</span>
              <span className="text-[14px] font-medium text-faint"> / 100</span>
            </>
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="scan-glass overflow-hidden">
          <div className="border-b border-[var(--scan-border-soft)] px-5 py-4 text-sm font-bold">
            {t("page_ai.oraclesReg")}
          </div>
          {sorted.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted">{t("page_ai.emptyOracles")}</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid min-w-[640px] grid-cols-[40px_1.3fr_1.5fr_90px_70px_110px] px-5 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                <div>#</div>
                <div>{t("page_ai.colAddress")}</div>
                <div>{t("page_ai.colRep")}</div>
                <div className="text-right">{t("page_ai.colDeliv")}</div>
                <div className="text-right">{t("page_ai.colFails")}</div>
                <div className="text-right">{t("page_ai.colStake")}</div>
              </div>
              {sorted.map((o, i) => {
                const rep = Math.max(0, Math.min(100, o.reputation ?? 50));
                const color = AVATAR[i % AVATAR.length];
                const repColor = rep >= 70 ? "var(--ok)" : rep >= 40 ? "var(--gold)" : "var(--red)";
                return (
                  <div
                    key={o.address}
                    className="scan-row grid min-w-[640px] grid-cols-[40px_1.3fr_1.5fr_90px_70px_110px] items-center px-5 py-3.5 text-[12.5px]"
                  >
                    <div className="text-faint">{i + 1}</div>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-5 w-5 flex-none rounded-[7px]" style={{ background: color }} />
                      <Link
                        href={`/address/${o.address}`}
                        className="truncate font-mono text-[var(--scan-link)] hover:underline"
                      >
                        {shortHash(o.address, 10, 6)}
                      </Link>
                    </div>
                    <div className="flex items-center gap-2.5 pr-4">
                      <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--input-bg)]">
                        <div className="h-full rounded" style={{ width: `${rep}%`, background: repColor }} />
                      </div>
                      <span className="min-w-6 text-right font-bold">{rep}</span>
                    </div>
                    <div className="text-right tnum">{num(o.completed ?? 0)}</div>
                    <div className="text-right tnum text-[var(--red)]">0</div>
                    <div className="text-right tnum text-muted">{fmtCompact(o.stake ?? "0")}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="scan-glass overflow-hidden">
          <div className="border-b border-[var(--scan-border-soft)] px-5 py-4 text-sm font-bold">
            {t("page_ai.recentTasks")}
          </div>
          {tasks.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted">{t("page_ai.emptyTasks")}</p>
          ) : (
            tasks.slice(0, 12).map((k) => {
              const meta = statusMeta(k.status, t);
              return (
                <div key={k.id} className="scan-row flex items-center gap-3 px-5 py-3.5 text-[12.5px]">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/tx/${k.id}`}
                      className="block truncate font-mono font-medium text-[var(--scan-link)] hover:underline"
                    >
                      {shortHash(k.id, 14, 8)}
                    </Link>
                    <div className="mt-1 text-[11px] text-faint">
                      {k.verified ?? "oracle"} · {k.createdAt ? ago(k.createdAt) : "—"}
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <div className="font-bold tnum">{fmt(k.reward ?? "0")} EAV7</div>
                    <div className="mt-1">
                      <span
                        className="rounded-[5px] px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: meta.bg, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="scan-glass px-[18px] py-4 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[rgba(159,123,255,0.45)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</div>
      <div className="mt-1.5 font-display text-2xl font-bold tracking-[-0.01em] text-ink">{value}</div>
    </div>
  );
}

function PipelineStep({
  n,
  title,
  sub,
  warn,
  ok,
}: {
  n: string;
  title: string;
  sub: string;
  warn?: boolean;
  ok?: boolean;
}) {
  const border = ok
    ? "border-[rgba(46,204,113,0.4)]"
    : "border-[var(--scan-border)]";
  const tone = ok ? "text-ok" : warn ? "text-gold" : "text-[var(--scan-link)]";
  return (
    <div className={`scan-glass min-w-[132px] flex-1 rounded-[13px] border px-3.5 py-2.5 ${border}`}>
      <div className={`font-mono text-[9.5px] ${tone}`}>{n}</div>
      <div className={`mt-0.5 font-mono text-[12.5px] font-bold ${ok ? "text-ok" : "text-ink"}`}>{title}</div>
      <div className="mt-0.5 text-[10.5px] text-faint">{sub}</div>
    </div>
  );
}

function PipeArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" className="flex-none" aria-hidden>
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </svg>
  );
}
