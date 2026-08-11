import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/developers/code-block";
import { DevPager } from "@/components/developers/dev-pager";
import { Callout, DevPageHead, DevSection, DevSections, SpecList } from "@/components/developers/dev-page";
import { TxCatalog } from "@/components/developers/tx-catalog";
import { TX_GROUPS, TX_TYPE_COUNT } from "@/components/developers/data/tx-types";
import { getT } from "@/i18n/server";

const ENVELOPE = `{
  "protocol": "eav20",
  "scheme": "eav7-hybrid-1",
  "type": "TRANSFER",
  "from": "E7A4B2…9F21",
  "to": "E7C910…10B8",
  "amount": "5000000",
  "fee": "10000",
  "nonce": 42,
  "timestamp": 1770000000000,
  "data": null,
  "publicKey": "0x04…",
  "pqPublicKey": "…",

  "signature": "0x…",
  "pqSignature": "…",
  "id": "0x8c1f…"
}`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.tx.title"), description: t("dev.tx.lede") };
}

export default async function TransactionsPage() {
  const t = await getT();

  const groups = TX_GROUPS.map((group) => ({
    title: t(`dev.tx.group.${group.key}`),
    types: group.types.map((type) => ({
      name: type.name,
      fee: type.fee,
      desc: t(`dev.tx.type.${type.name}`),
    })),
  }));

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.tx.eyebrow")}
        title={t("dev.tx.title")}
        lede={t("dev.tx.lede", { n: TX_TYPE_COUNT })}
      />

      <DevSections>
        <DevSection
          id="envelope"
          kicker={t("dev.tx.envelopeKicker")}
          title={t("dev.tx.envelopeTitle")}
          intro={t("dev.tx.envelopeIntro")}
        >
          <CodeBlock code={ENVELOPE} label="json" />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: "protocol · scheme", v: t("dev.tx.fieldProtocol") },
                { k: "amount · fee", v: t("dev.tx.fieldAmount") },
                { k: "nonce", v: t("dev.tx.fieldNonce") },
                { k: "data", v: t("dev.tx.fieldData") },
                { k: "signature · pqSignature", v: t("dev.tx.fieldSignature") },
                { k: "id", v: t("dev.tx.fieldId") },
              ]}
            />
          </div>
        </DevSection>

        <DevSection
          id="custo"
          kicker={t("dev.tx.costKicker")}
          title={t("dev.tx.costTitle")}
          intro={t("dev.tx.costIntro")}
        >
          <div className="space-y-3">
            <Callout tone="warn" title={t("dev.tx.costCalloutTitle")}>
              {t("dev.tx.costCalloutBody")}
            </Callout>
            <Callout title={t("dev.tx.forkCalloutTitle")}>{t("dev.tx.forkCalloutBody")}</Callout>
          </div>
        </DevSection>

        <DevSection
          id="catalogo"
          kicker={t("dev.tx.catalogKicker")}
          title={t("dev.tx.catalogTitle", { n: TX_TYPE_COUNT })}
          intro={t("dev.tx.catalogIntro")}
        >
          <TxCatalog
            groups={groups}
            labels={{
              placeholder: t("dev.tx.filterPlaceholder"),
              colType: t("dev.tx.colType"),
              colDesc: t("dev.tx.colDesc"),
              colFee: t("dev.tx.colFee"),
              empty: t("dev.tx.filterEmpty"),
              count: t("dev.tx.filterCount"),
            }}
          />
        </DevSection>

        <DevSection
          id="enviar"
          kicker={t("dev.tx.sendKicker")}
          title={t("dev.tx.sendTitle")}
          intro={t("dev.tx.sendIntro")}
        >
          <ul className="divide-y divide-line/60 border-y border-line">
            {[
              { href: "/developers/sdk", label: t("dev.nav.sdk"), desc: t("dev.tx.sendSdk") },
              { href: "/developers/api", label: "POST /tx", desc: t("dev.tx.sendRest") },
              { href: "/developers/eavm", label: "POST /eavm/tx", desc: t("dev.tx.sendEavm") },
            ].map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="group flex flex-col gap-1 py-3.5 transition-colors sm:flex-row sm:items-baseline sm:gap-6"
                >
                  <span className="font-mono w-[180px] flex-none text-[13px] font-bold text-ink transition-colors group-hover:text-violet">
                    {item.label}
                  </span>
                  <span className="text-[13.5px] leading-relaxed text-muted">{item.desc}</span>
                </Link>
              </li>
            ))}
          </ul>
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
