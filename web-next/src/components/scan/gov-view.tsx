import Link from "next/link";
import type { ReactNode } from "react";
import type { Governable, GovernanceState, Treasury } from "@/lib/api";
import { getT } from "@/i18n/server";
import { fmt, fmtCompact, num, shortHash } from "@/lib/format";
import "@/components/scan/tokens.css";

const E7_PARAMS = new Set(["BLOCK_REWARD", "MIN_VALIDATOR_STAKE", "FEE_EXEMPT_STAKE", "MIN_ORACLE_STAKE"]);

function govValue(param: string, value: unknown): string {
  if (E7_PARAMS.has(param) && (typeof value === "string" || typeof value === "number")) {
    return `${fmt(String(value))} EAV7`;
  }
  if (value != null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function statusStyle(status: string): { bg: string; color: string } {
  const s = status.toUpperCase();
  if (s === "PASSED" || s === "APPLIED" || s === "QUEUED")
    return { bg: "rgba(46,204,113,0.16)", color: "var(--ok)" };
  if (s === "VOTING") return { bg: "rgba(243,156,18,0.16)", color: "var(--gold)" };
  if (s === "DEFEATED") return { bg: "rgba(255,92,114,0.14)", color: "var(--red)" };
  return { bg: "rgba(112,112,112,0.18)", color: "var(--faint)" };
}

export async function ScanGovView({
  gov,
  treasury,
}: {
  gov: GovernanceState;
  treasury: Treasury | null;
}) {
  const t = await getT();
  const governable = gov.governable ?? [];
  const active = gov.governanceActive !== false;
  const quorum = gov.quorum ?? Math.floor((2 * (gov.validators || 0)) / 3) + 1;

  return (
    <div className="scan mx-auto max-w-[1280px] px-6 py-9">
      <div className="mb-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(159,123,255,0.35)] bg-[var(--scan-chip)] px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--scan-link)]">
          <span className="scan-live" aria-hidden />
          {t("page_governance.eyebrow")}
        </div>
        <h1 className="mt-3.5 font-display text-[clamp(30px,3.4vw,40px)] font-bold tracking-[-0.02em] text-ink">
          {t("page_governance.title")}
        </h1>
        <p className="mt-2.5 max-w-[760px] text-[13.5px] leading-relaxed text-muted">
          {t("page_governance.subtitle")}
        </p>
      </div>

      <div className="mb-5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t("page_governance.statusLabel")}
          value={
            <span className={active ? "text-ok" : "text-gold"}>
              {active ? t("page_governance.statusActive") : t("page_governance.statusPending")}
            </span>
          }
        />
        <Stat
          label={t("page_governance.treasuryTitle")}
          value={
            <>
              {treasury ? fmtCompact(treasury.balance) : "—"}
              <span className="text-[14px] font-medium text-faint"> EAV7</span>
            </>
          }
        />
        <Stat
          label={t("page_governance.validators")}
          value={
            <>
              {num(gov.validators)}
              <span className="text-[14px] font-medium text-faint">
                {" "}
                · {t("page_governance.quorumN", { n: quorum })}
              </span>
            </>
          }
        />
        <Stat
          label={t("page_governance.treasuryPct")}
          value={`${treasury?.treasuryPct ?? 0}%`}
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2.5">
        <FlowChip n="01" title="GOV_PROPOSE" sub={t("page_governance.flowPropose")} />
        <Arrow />
        <FlowChip n="02" title="GOV_VOTE" sub={t("page_governance.flowVote", { n: quorum })} />
        <Arrow />
        <FlowChip n="03" title="TIMELOCK" sub={t("page_governance.flowLock")} />
        <Arrow />
        <FlowChip n="04" title="APPLY" sub={t("page_governance.flowApply")} ok />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="scan-glass overflow-hidden">
          <div className="border-b border-[var(--scan-border-soft)] px-5 py-4 text-sm font-bold">
            {t("page_governance.paramsTitle")}
          </div>
          {governable.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted">{t("page_governance.noParams")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                    <th className="px-5 py-3 text-left">{t("page_governance.colParam")}</th>
                    <th className="px-5 py-3 text-left">{t("page_governance.colValue")}</th>
                    <th className="px-5 py-3 text-right">{t("page_governance.colRange")}</th>
                  </tr>
                </thead>
                <tbody>
                  {governable.map((g: Governable) => (
                    <tr key={g.param} className="border-t border-[var(--scan-border-soft)] hover:bg-[var(--scan-hover)]">
                      <td className="px-5 py-[13px] font-mono font-semibold text-ink">
                        {g.param}
                        {g.overridden ? (
                          <span className="ml-2 rounded-md bg-[rgba(243,156,18,0.16)] px-1.5 py-0.5 text-[10px] font-semibold text-gold">
                            {t("page_governance.overridden")}
                          </span>
                        ) : null}
                      </td>
                      <td className="tnum px-5 py-[13px]">{govValue(g.param, g.value)}</td>
                      <td className="tnum whitespace-nowrap px-5 py-[13px] text-right text-muted">
                        {govValue(g.param, g.min)} – {govValue(g.param, g.max)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="scan-glass overflow-hidden">
          <div className="border-b border-[var(--scan-border-soft)] px-5 py-4 text-sm font-bold">
            {t("page_governance.proposalsTitle")}{" "}
            <span className="font-mono text-[12px] font-medium text-faint">({gov.proposals.length})</span>
          </div>
          {gov.proposals.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-[13px] text-muted">{t("page_governance.noProposals")}</p>
              <p className="mt-3 text-[12px] leading-relaxed text-faint">{t("page_governance.howToPropose")}</p>
              <Link
                href="/ai"
                className="mt-4 inline-flex text-[12.5px] font-semibold text-[var(--scan-link)] hover:underline"
              >
                {t("page_governance.linkAi")} →
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--scan-border-soft)]">
              {gov.proposals.map((p) => {
                const st = statusStyle(p.status);
                return (
                  <div key={p.id} className="px-5 py-3.5 hover:bg-[var(--scan-hover)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[13px] font-bold text-ink">{p.param}</div>
                        <div className="mt-0.5 tnum text-[12.5px] text-muted">{govValue(p.param, p.value)}</div>
                        <div className="mt-1.5 font-mono text-[11px] text-faint">
                          <Link href={`/address/${p.proposer}`} className="text-[var(--scan-link)] hover:underline">
                            {shortHash(p.proposer, 8, 4)}
                          </Link>
                          {" · "}
                          {t("page_governance.colDeadline")} #{num(p.deadline)}
                        </div>
                      </div>
                      <div className="flex flex-none flex-col items-end gap-1.5">
                        <span
                          className="rounded-md px-2 py-[3px] text-[10.5px] font-semibold"
                          style={{ background: st.bg, color: st.color }}
                        >
                          {p.status}
                        </span>
                        <span className="font-mono text-[11px] text-faint">
                          {t("page_governance.colVotes")} {p.voteCount}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="scan-glass px-[18px] py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</div>
      <div className="mt-[7px] font-display text-xl font-bold text-ink">{value}</div>
    </div>
  );
}

function FlowChip({
  n,
  title,
  sub,
  ok,
}: {
  n: string;
  title: string;
  sub: string;
  ok?: boolean;
}) {
  return (
    <div
      className={`scan-glass min-w-[120px] flex-1 rounded-[13px] px-3.5 py-2.5 ${
        ok ? "border-[rgba(46,204,113,0.4)]" : ""
      }`}
    >
      <div className={`font-mono text-[9.5px] ${ok ? "text-ok" : "text-[var(--scan-link)]"}`}>{n}</div>
      <div className={`mt-0.5 font-mono text-[12.5px] font-bold ${ok ? "text-ok" : "text-ink"}`}>{title}</div>
      <div className="mt-0.5 text-[10.5px] text-faint">{sub}</div>
    </div>
  );
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" className="flex-none self-center" aria-hidden>
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </svg>
  );
}
