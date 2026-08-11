import type { Metadata } from "next";
import { CodeBlock } from "@/components/developers/code-block";
import { DevPager } from "@/components/developers/dev-pager";
import {
  Callout,
  DevLinkList,
  DevPageHead,
  DevRows,
  DevSection,
  DevSections,
  DevTable,
  Mono,
  SpecList,
} from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

const FORMULA = `resourceStake = staked - delegatedOut + delegatedIn      (em EAV7 inteiro)

maxGb = 1_000_000_000 + resourceStake × 1_000_000
#             1 GB base                 + 1 MB por EAV7 staked

# bytes ponderados = max(MIN_WEIGHTED, tamanho_útil × fator(tipo))
# tamanho_útil exclui signature / pqSignature / id (anti-maleabilidade)

# regeneração linear e preguiçosa ao longo de 86 400 blocos (~24 h a 1 bloco/s)
usado = max(0, usadoRegistrado - floor(maxGb × blocosDecorridos / 86400))
disponível = max(0, maxGb - usado)

# o que faltar vira QUEIMA, não pagamento ao produtor
taxa = shortfall_bytes × 5 e7`;

const ENERGY_SAMPLE = [
  { type: "TRANSFER", energy: 1 },
  { type: "TOKEN_TRANSFER", energy: 2 },
  { type: "NFT_MINT", energy: 3 },
  { type: "AI_TASK", energy: 5 },
  { type: "EAVM_CALL", energy: 5 },
  { type: "SLASH_DOUBLE_SIGN", energy: 8 },
  { type: "TOKEN_CREATE", energy: 10 },
  { type: "EAVM_DEPLOY", energy: 10 },
];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.resources.title"), description: t("dev.resources.lede") };
}

export default async function ResourcesPage() {
  const t = await getT();

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.resources.eyebrow")}
        title={t("dev.resources.title")}
        lede={t("dev.resources.lede")}
      />

      <DevSections>
        <DevSection
          id="trilhos"
          kicker={t("dev.resources.railsKicker")}
          title={t("dev.resources.railsTitle")}
          intro={t("dev.resources.railsIntro")}
        >
          <SpecList
            rows={[
              { k: t("dev.resources.railEnergy"), v: t("dev.resources.railEnergyBody") },
              { k: t("dev.resources.railBandwidth"), v: t("dev.resources.railBandwidthBody") },
              { k: t("dev.resources.railFee"), v: t("dev.resources.railFeeBody") },
            ]}
          />
        </DevSection>

        <DevSection
          id="cotas"
          kicker={t("dev.resources.quotaKicker")}
          title={t("dev.resources.quotaTitle")}
          intro={t("dev.resources.quotaIntro")}
        >
          <CodeBlock code={FORMULA} label={t("dev.resources.formulaLabel")} />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: "GB.DAILY_BYTES", v: <Mono>1 000 000 000</Mono>, note: t("dev.resources.constEnergyFree") },
                { k: "GB.PER_STAKED_EAV7", v: <Mono>1 000 000</Mono>, note: t("dev.resources.constEnergyPer") },
                { k: "GB.MIN_WEIGHTED", v: <Mono>1 024</Mono>, note: t("dev.resources.constBwFree") },
                { k: "BANDWIDTH.BURN_PER_BYTE", v: <Mono>5 e7</Mono>, note: t("dev.resources.constBwPer") },
                { k: "REGEN_BLOCKS", v: <Mono>86 400</Mono>, note: t("dev.resources.constRegen") },
              ]}
            />
          </div>
        </DevSection>

        <DevSection
          id="queima"
          kicker={t("dev.resources.burnKicker")}
          title={t("dev.resources.burnTitle")}
          intro={t("dev.resources.burnIntro")}
        >
          <SpecList
            rows={[
              { k: "ENERGY.BURN_PER_ENERGY", v: <Mono>20 000 e7</Mono>, note: t("dev.resources.burnEnergy") },
              { k: "BANDWIDTH.BURN_PER_BYTE", v: <Mono>5 e7</Mono>, note: t("dev.resources.burnByte") },
              { k: "MAX_FEE_LIMIT", v: <Mono>100 000 000 e7</Mono>, note: t("dev.resources.burnCeiling") },
            ]}
          />
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.resources.feeTitle")}>
              {t("dev.resources.feeBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="isencao"
          kicker={t("dev.resources.exemptKicker")}
          title={t("dev.resources.exemptTitle")}
          intro={t("dev.resources.exemptIntro")}
        >
          <SpecList
            rows={[
              { k: "FEE_EXEMPT_STAKE", v: <Mono>100 000 000 e7 · 100 EAV7</Mono>, note: t("dev.resources.exemptStake") },
              { k: "feeExempt", v: t("dev.resources.exemptFlag") },
              { k: "DELEGATE_RESOURCE", v: t("dev.resources.exemptDelegate") },
            ]}
          />
          <div className="mt-5">
            <Callout tone="ok" title={t("dev.resources.exemptCalloutTitle")}>
              {t("dev.resources.exemptCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="custo"
          kicker={t("dev.resources.costKicker")}
          title={t("dev.resources.costTitle")}
          intro={t("dev.resources.costIntro")}
        >
          <DevTable
            columns={[
              { label: t("dev.resources.colType"), width: "w-[220px]" },
              { label: t("dev.resources.colEnergy"), width: "w-[110px]" },
              { label: t("dev.resources.colNote") },
            ]}
          >
            <DevRows
              monoCols={[0, 1]}
              rows={ENERGY_SAMPLE.map((row) => ({
                k: row.type,
                cells: [row.type, row.energy, t(`dev.resources.cost.${row.type}`)],
              }))}
            />
          </DevTable>
          <p className="mt-5 text-[13.5px] leading-relaxed text-muted">{t("dev.resources.costFallback")}</p>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/concepts/transactions", label: t("dev.nav.lifecycle"), desc: t("dev.nav.lifecycleDesc") },
              { href: "/developers/guides/stake-vote", label: t("dev.nav.stakeVote"), desc: t("dev.nav.stakeVoteDesc") },
              { href: "/developers/transactions", label: t("dev.nav.transactions"), desc: t("dev.nav.transactionsDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
