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
  DevSteps,
  DevTable,
  Mono,
  Prereqs,
  SpecList,
} from "@/components/developers/dev-page";
import { getT } from "@/i18n/server";

const ROOT = `// 1) a raiz vem do HEADER, e o header é verificado antes de ser usado:
//    hash recalculada + assinatura do produtor conferida localmente
let raiz = cliente.raiz_confiavel_do_header("latest")?;`;

const PROVED = `// 2) o saldo chega com a prova de Merkle e é conferido CONTRA essa raiz
let saldo = cliente.saldo_provado("E7A4B2…9F21", Some(&raiz))?;
println!("saldo PROVADO: {saldo} e7");`;

const NAIVE = `// SEM a raiz do header, a prova fecha contra a raiz que o PRÓPRIO nó afirmou:
// pega inconsistência interna, não um nó que minta raiz e saldo de forma coerente.
let saldo = cliente.saldo_provado("E7A4B2…9F21", None)?;`;

const PROOF_JSON = `curl -s https://eavscan.com/proof/E7A4B2…9F21 -H 'Accept: application/json'

{
  "stateRoot": "e7c41f…",
  "encodedAccount": { "balance": "B12500000", "nonce": 41, … },
  "path": [ { "hash": "a91c…", "right": true }, … ]
}`;

const EXAMPLE = `cargo run -p eav7-sdk --example consulta -- \\
  https://eavscan.com E7A4B2…9F21`;

const ERRORS = ["ProvaInvalida", "Resposta", "Api"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.gLight.title"), description: t("dev.gLight.lede") };
}

export default async function LightClientGuidePage() {
  const t = await getT();

  return (
    <>
      <DevPageHead eyebrow={t("dev.gLight.eyebrow")} title={t("dev.gLight.title")} lede={t("dev.gLight.lede")} />

      <DevSections>
        <DevSection
          id="requisitos"
          kicker={t("dev.common.prereqKicker")}
          title={t("dev.common.prereqTitle")}
          intro={t("dev.gLight.prereqIntro")}
        >
          <Prereqs
            title={t("dev.common.prereqLabel")}
            items={[t("dev.gLight.prereq1"), t("dev.gLight.prereq2"), t("dev.gLight.prereq3")]}
          />
        </DevSection>

        <DevSection
          id="por-que"
          kicker={t("dev.gLight.whyKicker")}
          title={t("dev.gLight.whyTitle")}
          intro={t("dev.gLight.whyIntro")}
        >
          <SpecList
            rows={[
              { k: t("dev.gLight.whyAsk"), v: t("dev.gLight.whyAskBody") },
              { k: t("dev.gLight.whyProve"), v: t("dev.gLight.whyProveBody") },
              { k: t("dev.gLight.whyRefuse"), v: t("dev.gLight.whyRefuseBody") },
            ]}
          />
        </DevSection>

        <DevSection
          id="passos"
          kicker={t("dev.gLight.stepsKicker")}
          title={t("dev.gLight.stepsTitle")}
          intro={t("dev.gLight.stepsIntro")}
        >
          <DevSteps
            steps={[
              {
                title: t("dev.gLight.s1Title"),
                body: t("dev.gLight.s1Body"),
                children: <CodeBlock code={ROOT} label="Rust · eav7-sdk" />,
              },
              {
                title: t("dev.gLight.s2Title"),
                body: t("dev.gLight.s2Body"),
                children: <CodeBlock code={PROVED} label="Rust" />,
              },
              {
                title: t("dev.gLight.s3Title"),
                body: t("dev.gLight.s3Body"),
                children: <CodeBlock code={PROOF_JSON} label="bash" />,
              },
            ]}
          />
          <div className="mt-8">
            <CodeBlock code={NAIVE} label="Rust" />
          </div>
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.gLight.naiveTitle")}>{t("dev.gLight.naiveBody")}</Callout>
          </div>
        </DevSection>

        <DevSection
          id="limites"
          kicker={t("dev.gLight.limitsKicker")}
          title={t("dev.gLight.limitsTitle")}
          intro={t("dev.gLight.limitsIntro")}
        >
          <SpecList
            rows={[
              { k: "STATEROOT_HEIGHT", v: <Mono>1 200 000</Mono>, note: t("dev.gLight.limitHeight") },
              { k: t("dev.gLight.limitScope"), v: t("dev.gLight.limitScopeBody") },
              { k: t("dev.gLight.limitLive"), v: t("dev.gLight.limitLiveBody") },
            ]}
          />
          <div className="mt-8">
            <DevTable
              columns={[{ label: t("dev.gLight.colError"), width: "w-[190px]" }, { label: t("dev.gLight.colWhen") }]}
            >
              <DevRows
                rows={ERRORS.map((name) => ({ k: name, cells: [`ErroCliente::${name}`, t(`dev.gLight.err.${name}`)] }))}
              />
            </DevTable>
          </div>
        </DevSection>

        <DevSection
          id="exemplo"
          kicker={t("dev.gLight.exampleKicker")}
          title={t("dev.gLight.exampleTitle")}
          intro={t("dev.gLight.exampleIntro")}
        >
          <CodeBlock code={EXAMPLE} label="bash" />
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/concepts/finality", label: t("dev.nav.finality"), desc: t("dev.nav.finalityDesc") },
              { href: "/developers/sdk", label: t("dev.nav.sdk"), desc: t("dev.nav.sdkDesc") },
              { href: "/developers/integrations", label: t("dev.nav.integrations"), desc: t("dev.nav.integrationsDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
