import type { Metadata } from "next";
import { CodeBlock } from "@/components/developers/code-block";
import { DevPager } from "@/components/developers/dev-pager";
import {
  Callout,
  DevLinkList,
  DevPageHead,
  DevSection,
  DevSections,
  DevSteps,
  Mono,
  Prereqs,
  SpecList,
} from "@/components/developers/dev-page";
import { EavmConnect } from "@/components/docs/eavm-connect";
import { EAVM_MANUAL_NETWORK } from "@/lib/eavm-chain";
import { getT } from "@/i18n/server";

const MANUAL = EAVM_MANUAL_NETWORK;

const CHECK = `curl -s https://rpc.eavscan.com \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

{"jsonrpc":"2.0","id":1,"result":"0x11954"}`;

const UNITS = `# 1 EAV7 = 1 000 000 e7           (API HTTP · CHAIN.UNIT)
# 1 e7   = 1 000 000 000 000 wei  (EAVM · CHAIN.EAVM_WEI_PER_E7)

5 EAV7 = 5 000 000 e7 = 5 000 000 000 000 000 000 wei`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.gMeta.title"), description: t("dev.gMeta.lede") };
}

export default async function MetamaskGuidePage() {
  const t = await getT();

  return (
    <>
      <DevPageHead eyebrow={t("dev.gMeta.eyebrow")} title={t("dev.gMeta.title")} lede={t("dev.gMeta.lede")} />

      <DevSections>
        <DevSection
          id="requisitos"
          kicker={t("dev.common.prereqKicker")}
          title={t("dev.common.prereqTitle")}
          intro={t("dev.gMeta.prereqIntro")}
        >
          <Prereqs
            title={t("dev.common.prereqLabel")}
            items={[t("dev.gMeta.prereq1"), t("dev.gMeta.prereq2")]}
          />
        </DevSection>

        <DevSection
          id="conectar"
          kicker={t("dev.gMeta.connectKicker")}
          title={t("dev.gMeta.connectTitle")}
          intro={t("dev.gMeta.connectIntro")}
        >
          <EavmConnect />
        </DevSection>

        <DevSection
          id="passos"
          kicker={t("dev.gMeta.stepsKicker")}
          title={t("dev.gMeta.stepsTitle")}
          intro={t("dev.gMeta.stepsIntro")}
        >
          <DevSteps
            steps={[
              {
                title: t("dev.gMeta.s1Title"),
                body: t("dev.gMeta.s1Body"),
                children: <CodeBlock code={MANUAL} label={t("dev.gMeta.manualLabel")} />,
              },
              {
                title: t("dev.gMeta.s2Title"),
                body: t("dev.gMeta.s2Body"),
                children: <CodeBlock code={CHECK} label="bash" />,
              },
              {
                title: t("dev.gMeta.s3Title"),
                body: t("dev.gMeta.s3Body"),
                children: <CodeBlock code={UNITS} label={t("dev.gMeta.unitsLabel")} />,
              },
            ]}
          />
        </DevSection>

        <DevSection
          id="enderecos"
          kicker={t("dev.gMeta.addrKicker")}
          title={t("dev.gMeta.addrTitle")}
          intro={t("dev.gMeta.addrIntro")}
        >
          <SpecList
            rows={[
              { k: t("dev.gMeta.addrDerive"), v: <Mono>0x… → E7…</Mono>, note: t("dev.gMeta.addrDeriveNote") },
              { k: t("dev.gMeta.addrLedger"), v: t("dev.gMeta.addrLedgerBody") },
              { k: t("dev.gMeta.addrSend"), v: <Mono>0xe7000000…</Mono>, note: t("dev.gMeta.addrSendNote") },
            ]}
          />
        </DevSection>

        <DevSection
          id="limites"
          kicker={t("dev.gMeta.limitsKicker")}
          title={t("dev.gMeta.limitsTitle")}
          intro={t("dev.gMeta.limitsIntro")}
        >
          <div className="space-y-3">
            <Callout tone="warn" title={t("dev.gMeta.limit1Title")}>{t("dev.gMeta.limit1Body")}</Callout>
            <Callout tone="warn" title={t("dev.gMeta.limit2Title")}>{t("dev.gMeta.limit2Body")}</Callout>
            <Callout title={t("dev.gMeta.limit3Title")}>{t("dev.gMeta.limit3Body")}</Callout>
          </div>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/api/json-rpc", label: t("dev.nav.jsonRpc"), desc: t("dev.nav.jsonRpcDesc") },
              { href: "/developers/eavm", label: t("dev.nav.eavm"), desc: t("dev.nav.eavmDesc") },
              { href: "/developers/concepts/accounts", label: t("dev.nav.accounts"), desc: t("dev.nav.accountsDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
