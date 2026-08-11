import { Fragment } from "react";
import type { Metadata } from "next";
import { DevPager } from "@/components/developers/dev-pager";
import {
  Callout,
  DevLinkList,
  DevPageHead,
  DevRowGroup,
  DevRows,
  DevSection,
  DevSections,
  DevTable,
} from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

/**
 * O mapa por PAPEL: quem integra chega com um cargo, não com um endpoint. Cada
 * linha é uma tarefa real e a superfície exata que a resolve.
 */
const ROLES: { key: string; rows: { key: string; call: string }[] }[] = [
  {
    key: "wallet",
    rows: [
      { key: "balance", call: "GET /address/:end" },
      { key: "history", call: "GET /address/:end/txs?limit&before" },
      { key: "nonce", call: "GET /address/:end → nextNonce" },
      { key: "send", call: "POST /tx" },
      { key: "confirm", call: "GET /tx/:id → blockHeight" },
      { key: "prove", call: "GET /proof/:end" },
    ],
  },
  {
    key: "exchange",
    rows: [
      { key: "deposit", call: "GET /address/:end/txs" },
      { key: "final", call: "GET /status → finalizedHeight" },
      { key: "sweep", call: "POST /tx · Remetente" },
      { key: "tokens", call: "GET /tokens/:id/transfers" },
      { key: "internal", call: "GET /internal?address&from" },
    ],
  },
  {
    key: "indexer",
    rows: [
      { key: "range", call: "GET /chain?from&limit" },
      { key: "head", call: "GET /blocks/latest" },
      { key: "reorg", call: "GET /status → finalizedHeight" },
      { key: "logs", call: "GET /logs · eth_getLogs" },
      { key: "stats", call: "GET /stats" },
    ],
  },
  {
    key: "oracle",
    rows: [
      { key: "register", call: "ORACLE_REGISTER" },
      { key: "tasks", call: "GET /ai/tasks" },
      { key: "answer", call: "AI_COMMIT · AI_REVEAL" },
      { key: "stake", call: "MIN_ORACLE_STAKE = 500 EAV7" },
    ],
  },
];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.integrations.title"), description: t("dev.integrations.lede") };
}

export default async function IntegrationsPage() {
  const t = await getT();

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.integrations.eyebrow")}
        title={t("dev.integrations.title")}
        lede={t("dev.integrations.lede")}
      />

      <DevSections>
        <DevSection
          id="papeis"
          kicker={t("dev.integrations.mapKicker")}
          title={t("dev.integrations.mapTitle")}
          intro={t("dev.integrations.mapIntro")}
        >
          <DevTable
            columns={[
              { label: t("dev.integrations.colTask"), width: "w-[300px]" },
              { label: t("dev.integrations.colCall") },
            ]}
          >
            {ROLES.map((role) => (
              <Fragment key={role.key}>
                <DevRowGroup title={t(`dev.integrations.role.${role.key}`)} span={2} />
                <DevRows
                  monoCols={[1]}
                  rows={role.rows.map((row) => ({
                    k: `${role.key}.${row.key}`,
                    cells: [t(`dev.integrations.task.${role.key}.${row.key}`), row.call],
                  }))}
                />
              </Fragment>
            ))}
          </DevTable>
        </DevSection>

        <DevSection
          id="regras"
          kicker={t("dev.integrations.rulesKicker")}
          title={t("dev.integrations.rulesTitle")}
          intro={t("dev.integrations.rulesIntro")}
        >
          <div className="space-y-3">
            <Callout tone="warn" title={t("dev.integrations.rule1Title")}>{t("dev.integrations.rule1Body")}</Callout>
            <Callout tone="warn" title={t("dev.integrations.rule2Title")}>{t("dev.integrations.rule2Body")}</Callout>
            <Callout tone="ok" title={t("dev.integrations.rule3Title")}>{t("dev.integrations.rule3Body")}</Callout>
            <Callout title={t("dev.integrations.rule4Title")}>{t("dev.integrations.rule4Body")}</Callout>
          </div>
        </DevSection>

        <DevSection
          id="checklist"
          kicker={t("dev.integrations.checkKicker")}
          title={t("dev.integrations.checkTitle")}
          intro={t("dev.integrations.checkIntro")}
        >
          <ol className="divide-y divide-line/60 border-y border-line">
            {["units", "final", "nonce", "rate", "proof", "reorg"].map((item, i) => (
              <li key={item} className="flex gap-5 py-3.5">
                <span className="font-mono w-6 flex-none text-[11px] font-semibold tracking-[1.4px] text-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[13.5px] leading-relaxed text-muted">
                  {t(`dev.integrations.check.${item}`)}
                </span>
              </li>
            ))}
          </ol>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/concepts/finality", label: t("dev.nav.finality"), desc: t("dev.nav.finalityDesc") },
              { href: "/developers/guides/light-client", label: t("dev.nav.lightClient"), desc: t("dev.nav.lightClientDesc") },
              { href: "/developers/troubleshooting", label: t("dev.nav.troubleshooting"), desc: t("dev.nav.troubleshootingDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
