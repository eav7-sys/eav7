import { Fragment } from "react";
import type { Metadata } from "next";
import { CodeBlock } from "@/components/developers/code-block";
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

/** Sintoma → causa → conserto. Agrupado pelo lugar onde a dor aparece. */
const SYMPTOMS: { key: string; items: string[] }[] = [
  { key: "write", items: ["nonce", "timeout", "refused", "double", "feeLimit"] },
  { key: "read", items: ["empty404", "stale", "amount", "rate"] },
  { key: "eavm", items: ["decimals", "method", "wrongChain", "noReceipt"] },
  { key: "node", items: ["noSync", "notElected", "genesis", "port"] },
];

const DIAGNOSE = `# 1. o nó está vivo e em que altura?
curl -s https://eavscan.com/status -H 'Accept: application/json' | jq '{height, finalizedHeight, validators}'

# 2. a transação existe em algum lugar?
curl -s https://eavscan.com/tx/0x8c1f… -H 'Accept: application/json'

# 3. o remetente está no nonce que você acha que está?
curl -s https://eavscan.com/address/E7A4B2…9F21 -H 'Accept: application/json' | jq '{nonce, nextNonce, balance, energy}'

# 4. a transação ficou pendurada no mempool?
curl -s https://eavscan.com/mempool -H 'Accept: application/json' | jq 'length'`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.trouble.title"), description: t("dev.trouble.lede") };
}

export default async function TroubleshootingPage() {
  const t = await getT();

  return (
    <>
      <DevPageHead eyebrow={t("dev.trouble.eyebrow")} title={t("dev.trouble.title")} lede={t("dev.trouble.lede")} />

      <DevSections>
        <DevSection
          id="tabela"
          kicker={t("dev.trouble.tableKicker")}
          title={t("dev.trouble.tableTitle")}
          intro={t("dev.trouble.tableIntro")}
        >
          <DevTable
            columns={[
              { label: t("dev.trouble.colSymptom"), width: "w-[280px]" },
              { label: t("dev.trouble.colCause"), width: "w-[280px]" },
              { label: t("dev.trouble.colFix") },
            ]}
          >
            {SYMPTOMS.map((group) => (
              <Fragment key={group.key}>
                <DevRowGroup title={t(`dev.trouble.group.${group.key}`)} span={3} />
                <DevRows
                  monoCols={[]}
                  rows={group.items.map((item) => ({
                    k: `${group.key}.${item}`,
                    cells: [
                      <span key="s" className="font-medium text-ink">
                        {t(`dev.trouble.s.${item}.symptom`)}
                      </span>,
                      t(`dev.trouble.s.${item}.cause`),
                      t(`dev.trouble.s.${item}.fix`),
                    ],
                  }))}
                />
              </Fragment>
            ))}
          </DevTable>
        </DevSection>

        <DevSection
          id="diagnostico"
          kicker={t("dev.trouble.diagKicker")}
          title={t("dev.trouble.diagTitle")}
          intro={t("dev.trouble.diagIntro")}
        >
          <CodeBlock code={DIAGNOSE} label="bash" />
          <div className="mt-5">
            <Callout tone="ok" title={t("dev.trouble.diagCalloutTitle")}>
              {t("dev.trouble.diagCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/errors", label: t("dev.nav.errors"), desc: t("dev.nav.errorsDesc") },
              { href: "/developers/concepts/transactions", label: t("dev.nav.lifecycle"), desc: t("dev.nav.lifecycleDesc") },
              { href: "/developers/networks", label: t("dev.nav.networks"), desc: t("dev.nav.networksDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
