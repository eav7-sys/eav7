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

const CREATE = `// 1) EAVM_DEPLOY do bytecode em contracts/artifacts/EAV20Factory.bin
// 2) EAVM_CALL createMinimal(name, symbol, decimals, supply, recipient)
//    selector = keccak256("createMinimal(string,string,uint8,uint256,address)")[:4]
// 3) leia TokenCreated.topics[1] → endereço 0x do token
//
// Teste de referência: rust/tests/eav20_contract.rs
//   eav20_factory_create_minimal_e_transfer`;

const FIND_ID = `# evento TokenCreated — topic[1] = token (address)
# explorador / eth_getLogs filtrando o endereço da factory
curl -s https://eavscan.com/eavm/logs?address=0xFACTORY… \\
  | jq '.[] | select(.topics[0] | startswith("0x")) | .topics[1]'`;

const TRANSFER = `// ERC20 transfer(address,uint256) — selector 0xa9059cbb
let input = encode_transfer("0x2222…2222", 250_000_000); // 250 tokens @ 6 decimals
cliente.executar("EAVM_CALL", 0, move |s| {
    s.com_dados(JsonValue::map([
        ("to".into(), JsonValue::str("0xTOKEN…")),
        ("input".into(), JsonValue::str(&input)),
    ]))
})?;`;

const READ = `# on-chain: balanceOf / totalSupply / allowance (eth_call)
# explorador: holders derivados de Transfer`;

const ADMIN_TYPES = [
  "TOKEN_MINT",
  "TOKEN_BURN",
  "TOKEN_APPROVE",
  "TOKEN_TRANSFER_FROM",
  "TOKEN_PAUSE",
  "TOKEN_BLACKLIST",
  "TOKEN_FREEZE",
];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.gToken.title"), description: t("dev.gToken.lede") };
}

export default async function TokenGuidePage() {
  const t = await getT();

  return (
    <>
      <DevPageHead eyebrow={t("dev.gToken.eyebrow")} title={t("dev.gToken.title")} lede={t("dev.gToken.lede")} />

      <DevSections>
        <DevSection id="legado" kicker="TOKEN_*" title={t("dev.gToken.legacyTitle")} intro={t("dev.gToken.legacyBody")}>
          <Callout tone="warn" title="TOKEN_CREATE ≠ EAV20">
            {t("dev.gToken.legacyBody")}
          </Callout>
        </DevSection>

        <DevSection
          id="requisitos"
          kicker={t("dev.common.prereqKicker")}
          title={t("dev.common.prereqTitle")}
          intro={t("dev.gToken.prereqIntro")}
        >
          <Prereqs
            title={t("dev.common.prereqLabel")}
            items={[t("dev.gToken.prereq1"), t("dev.gToken.prereq2"), t("dev.gToken.prereq3")]}
          />
        </DevSection>

        <DevSection
          id="parametros"
          kicker={t("dev.gToken.paramsKicker")}
          title={t("dev.gToken.paramsTitle")}
          intro={t("dev.gToken.paramsIntro")}
        >
          <DevTable
            columns={[{ label: t("dev.gToken.colField"), width: "w-[170px]" }, { label: t("dev.gToken.colRule") }]}
          >
            <DevRows
              rows={["name", "symbol", "decimals", "totalSupply", "mintable"].map((field) => ({
                k: field,
                cells: [field, t(`dev.gToken.param.${field}`)],
              }))}
            />
          </DevTable>
        </DevSection>

        <DevSection
          id="passos"
          kicker={t("dev.gToken.stepsKicker")}
          title={t("dev.gToken.stepsTitle")}
          intro={t("dev.gToken.stepsIntro")}
        >
          <DevSteps
            steps={[
              {
                title: t("dev.gToken.s1Title"),
                body: t("dev.gToken.s1Body"),
                children: <CodeBlock code={CREATE} label="Rust · eav7-sdk" />,
              },
              {
                title: t("dev.gToken.s2Title"),
                body: t("dev.gToken.s2Body"),
                children: <CodeBlock code={FIND_ID} label="bash" />,
              },
              {
                title: t("dev.gToken.s3Title"),
                body: t("dev.gToken.s3Body"),
                children: <CodeBlock code={TRANSFER} label="Rust" />,
              },
              {
                title: t("dev.gToken.s4Title"),
                body: t("dev.gToken.s4Body"),
                children: <CodeBlock code={READ} label="bash" />,
              },
            ]}
          />
        </DevSection>

        <DevSection
          id="custo"
          kicker={t("dev.gToken.costKicker")}
          title={t("dev.gToken.costTitle")}
          intro={t("dev.gToken.costIntro")}
        >
          <SpecList
            rows={[
              { k: "FEES.TOKEN_CREATE", v: <Mono>10 000 000 e7 · 10 EAV7</Mono>, note: t("dev.gToken.costCreate") },
              { k: "FEES.TOKEN_TRANSFER", v: <Mono>20 000 e7</Mono>, note: t("dev.gToken.costTransfer") },
              { k: t("dev.gToken.costEnergy"), v: <Mono>10 · 2</Mono>, note: t("dev.gToken.costEnergyNote") },
            ]}
          />
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.gToken.symbolTitle")}>{t("dev.gToken.symbolBody")}</Callout>
          </div>
        </DevSection>

        <DevSection
          id="admin"
          kicker={t("dev.gToken.adminKicker")}
          title={t("dev.gToken.adminTitle")}
          intro={t("dev.gToken.adminIntro")}
        >
          <DevTable
            columns={[{ label: t("dev.gToken.colType"), width: "w-[230px]" }, { label: t("dev.gToken.colEffect") }]}
          >
            <DevRows
              rows={ADMIN_TYPES.map((type) => ({ k: type, cells: [type, t(`dev.gToken.admin.${type}`)] }))}
            />
          </DevTable>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/transactions", label: t("dev.nav.transactions"), desc: t("dev.nav.transactionsDesc") },
              { href: "/developers/api", label: t("dev.nav.api"), desc: t("dev.nav.apiDesc") },
              { href: "/developers/integrations", label: t("dev.nav.integrations"), desc: t("dev.nav.integrationsDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
