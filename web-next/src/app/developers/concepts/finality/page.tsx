import type { Metadata } from "next";
import { CodeTabs } from "@/components/developers/code-tabs";
import { DevPager } from "@/components/developers/dev-pager";
import {
  Callout,
  DevLinkList,
  DevPageHead,
  DevSection,
  DevSections,
  Mono,
  SpecList,
} from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

const RULE = `# n = validadores ativos; quórum = 2n/3 + 1
# varre da cabeça para trás juntando PRODUTORES DISTINTOS

n < 3                       ──►  finalizedHeight = -1   (sem garantia BFT)
produtores distintos ≥ 2n/3+1 em [h, cabeça]  ──►  finalizedHeight = h - 1`;

const CHECK_CURL = `curl -s https://eavscan.com/status -H 'Accept: application/json' \\
  | jq '{ height, finalizedHeight }'

{
  "height": 1284391,
  "finalizedHeight": 1284389
}`;

const CHECK_RUST = `let recibo = cliente.transferir("E7DEST…9A02", 5 * UNIT)?;
let bloco = cliente.aguardar_confirmacao(&recibo.id, Duration::from_secs(30))?;

// crédito só depois da FINALIDADE, não da inclusão
loop {
    let s = cliente.status()?;
    let fin = s["finalizedHeight"].as_i64().unwrap_or(-1);
    if fin >= bloco.block_height as i64 {
        break;
    }
    std::thread::sleep(Duration::from_secs(1));
}`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.finality.title"), description: t("dev.finality.lede") };
}

export default async function FinalityPage() {
  const t = await getT();

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.finality.eyebrow")}
        title={t("dev.finality.title")}
        lede={t("dev.finality.lede")}
      />

      <DevSections>
        <DevSection
          id="regra"
          kicker={t("dev.finality.ruleKicker")}
          title={t("dev.finality.ruleTitle")}
          intro={t("dev.finality.ruleIntro")}
        >
          <CodeTabs
            id="fin-rule"
            samples={[
              { label: t("dev.finality.ruleLabel"), code: RULE },
              { label: "curl", code: CHECK_CURL },
            ]}
          />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: "FINALITY_MIN_VALIDATORS", v: <Mono>3</Mono>, note: t("dev.finality.constMin") },
                { k: "MAX_VALIDATORS", v: <Mono>27</Mono>, note: t("dev.finality.constMax") },
                { k: "BLOCK_TIME_MS", v: <Mono>1 000</Mono>, note: t("dev.finality.constBlock") },
              ]}
            />
          </div>
          <div className="mt-5">
            <Callout title={t("dev.finality.minusOneTitle")}>{t("dev.finality.minusOneBody")}</Callout>
          </div>
        </DevSection>

        <DevSection
          id="reorg"
          kicker={t("dev.finality.reorgKicker")}
          title={t("dev.finality.reorgTitle")}
          intro={t("dev.finality.reorgIntro")}
        >
          <SpecList
            rows={[
              { k: "REORG_WINDOW", v: <Mono>5 000</Mono>, note: t("dev.finality.reorgWindow") },
              { k: t("dev.finality.reorgBft"), v: t("dev.finality.reorgBftBody") },
              { k: "STRICT_PRODUCER_HEIGHT", v: <Mono>49 500</Mono>, note: t("dev.finality.reorgStrict") },
              { k: "SNAPSHOT_INTERVAL_BLOCKS", v: <Mono>5 000</Mono>, note: t("dev.finality.reorgSnapshot") },
            ]}
          />
        </DevSection>

        <DevSection
          id="creditar"
          kicker={t("dev.finality.creditKicker")}
          title={t("dev.finality.creditTitle")}
          intro={t("dev.finality.creditIntro")}
        >
          <CodeTabs id="fin-credit" samples={[{ label: "Rust", code: CHECK_RUST }]} />
          <div className="mt-5">
            <Callout tone="ok" title={t("dev.finality.creditCalloutTitle")}>
              {t("dev.finality.creditCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/integrations", label: t("dev.nav.integrations"), desc: t("dev.nav.integrationsDesc") },
              { href: "/developers/guides/light-client", label: t("dev.nav.lightClient"), desc: t("dev.nav.lightClientDesc") },
              { href: "/developers/api", label: t("dev.nav.api"), desc: t("dev.nav.apiDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
