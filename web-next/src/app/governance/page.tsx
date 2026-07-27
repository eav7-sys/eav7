import type { Metadata } from "next";
import { getGovernance, getTreasury } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { AddrLink } from "@/components/hash-link";
import { fmt, fmtCompact, num, shortHash } from "@/lib/format";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

// Parâmetros governáveis cujo valor é um montante em e7 (exibir como EAV7).
const E7_PARAMS = new Set(["BLOCK_REWARD", "MIN_VALIDATOR_STAKE", "FEE_EXEMPT_STAKE", "MIN_ORACLE_STAKE"]);

function govValue(param: string, value: unknown): string {
  if (E7_PARAMS.has(param) && (typeof value === "string" || typeof value === "number")) {
    return `${fmt(String(value))} EAV7`;
  }
  if (value != null && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const STATUS_CLS: Record<string, string> = {
  PASSED: "badge-green",
  APPLIED: "badge-green",
  VOTING: "badge-gold",
  DEFEATED: "badge-pink",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("page_governance.metaTitle") };
}

export default async function GovernancePage() {
  const t = await getT();
  const [gov, treasury] = await Promise.all([
    getGovernance().catch(() => ({ params: {}, governable: [], proposals: [], validators: 0 })),
    getTreasury().catch(() => null),
  ]);
  const governable = gov.governable ?? [];

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <PageHeader
        eyebrow={t("page_governance.eyebrow")}
        title={t("page_governance.title")}
        sub={t("page_governance.subtitle")}
      />

      {/* Tesouraria */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card card-glow p-5 sm:col-span-2">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted">
            {t("page_governance.treasuryTitle")}
          </div>
          <div className="font-display tnum mt-2 text-[clamp(26px,5vw,38px)] font-extrabold leading-none">
            {treasury ? fmtCompact(treasury.balance) : "—"} <span className="text-[16px] text-muted">EAV7</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
            <span className="badge">
              {t("page_governance.treasuryPct")} <span className="ml-1 text-ink">{treasury?.treasuryPct ?? 0}%</span>
            </span>
            <span className="badge">
              {gov.validators} {t("page_governance.validators")}
            </span>
          </div>
        </div>
      </div>

      {/* Parâmetros vigentes */}
      <h2 className="font-display mb-3 text-[16px] font-bold">{t("page_governance.paramsTitle")}</h2>
      <div className="card mb-8 overflow-x-auto p-5">
        {governable.length > 0 ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left">
                {[t("page_governance.colParam"), t("page_governance.colValue"), "Faixa permitida"].map((h) => (
                  <th key={h} className="font-mono border-b border-line pb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {governable.map((g) => (
                <tr key={g.param} className="border-b border-line/40">
                  <td className="font-mono py-2.5 font-semibold text-ink">
                    {g.param}
                    {g.overridden && <span className="badge badge-gold ml-2 text-[10px]">alterado</span>}
                  </td>
                  <td className="tnum">{govValue(g.param, g.value)}</td>
                  <td className="tnum whitespace-nowrap text-muted">
                    {govValue(g.param, g.min)} – {govValue(g.param, g.max)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-2 text-center text-[13px] text-muted">{t("page_governance.noParams")}</p>
        )}
      </div>

      {/* Propostas */}
      <h2 className="font-display mb-3 text-[16px] font-bold">
        {t("page_governance.proposalsTitle")} <span className="text-muted">({gov.proposals.length})</span>
      </h2>
      <div className="card overflow-x-auto p-5">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left">
              {[
                t("page_governance.colParam"),
                t("page_governance.colValue"),
                t("page_governance.colProposer"),
                t("page_governance.colStatus"),
                t("page_governance.colVotes"),
                t("page_governance.colDeadline"),
              ].map((h) => (
                <th key={h} className="font-mono border-b border-line pb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gov.proposals.map((p) => (
              <tr key={p.id} className="border-b border-line/40 hover:bg-line/30">
                <td className="font-mono py-2.5 font-semibold text-ink" title={shortHash(p.id, 10, 6)}>
                  {p.param}
                </td>
                <td className="tnum">{govValue(p.param, p.value)}</td>
                <td>
                  <AddrLink addr={p.proposer} len={8} />
                </td>
                <td>
                  <span className={`badge ${STATUS_CLS[p.status] ?? ""}`}>{p.status.toLowerCase()}</span>
                </td>
                <td className="tnum">{p.voteCount}</td>
                <td className="tnum whitespace-nowrap text-muted">#{num(p.deadline)}</td>
              </tr>
            ))}
            {gov.proposals.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted">
                  {t("page_governance.noProposals")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
