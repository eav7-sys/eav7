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

const LOCAL = `# um nó + explorador, tudo em uma linha
bash bin/eav7-dev-up.sh          # ou: npm run dev:local

# testnet de três processos: 1 validador + 2 ouvintes
bash bin/eav7-testnet-up.sh --fresh
bash bin/eav7-testnet-demo.sh
bash bin/eav7-testnet-down.sh`;

const ENV = `# web-next/.env.local
NEXT_PUBLIC_API_BASE=/api
EAV7_API_ORIGIN=http://127.0.0.1:6070`;

const PORTS = [
  { port: "6070", key: "http" },
  { port: "7070", key: "eavm" },
  { port: "6071 · 6072", key: "extra" },
  { port: "3000", key: "explorer" },
];

const PARAMS = [
  { k: "CHAIN.NAME", v: "EAV7" },
  { k: "CHAIN.PROTOCOL", v: "eav20" },
  { k: "CHAIN.SYMBOL · DECIMALS", v: "EAV7 · 6" },
  { k: "CHAIN.UNIT", v: "1 000 000 e7" },
  { k: "EAVM_CHAIN_ID", v: "72020 · 0x11954" },
  { k: "EAVM_WEI_PER_E7", v: "1 000 000 000 000" },
  { k: "BLOCK_TIME_MS", v: "1 000" },
  { k: "MAX_VALIDATORS", v: "27" },
  { k: "MIN_VALIDATOR_STAKE", v: "1 000 000 000 e7 · 1 000 EAV7" },
  { k: "UNBONDING_BLOCKS", v: "604 800" },
];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.networks.title"), description: t("dev.networks.lede") };
}

export default async function NetworksPage() {
  const t = await getT();

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.networks.eyebrow")}
        title={t("dev.networks.title")}
        lede={t("dev.networks.lede")}
      />

      <DevSections>
        <DevSection
          id="mainnet"
          kicker={t("dev.networks.mainKicker")}
          title={t("dev.networks.mainTitle")}
          intro={t("dev.networks.mainIntro")}
        >
          <SpecList
            rows={[
              { k: t("dev.networks.rowHttp"), v: <Mono>https://eavscan.com</Mono>, note: t("dev.networks.rowHttpNote") },
              { k: t("dev.networks.rowRpc"), v: <Mono>https://rpc.eavscan.com</Mono>, note: t("dev.networks.rowRpcNote") },
              { k: t("dev.networks.rowChainId"), v: <Mono>72020 · 0x11954</Mono>, note: t("dev.networks.rowChainIdNote") },
              { k: t("dev.networks.rowExplorer"), v: <Mono>https://eavscan.com</Mono>, note: t("dev.networks.rowExplorerNote") },
              { k: t("dev.networks.rowRegistry"), v: <Mono>chain-registry/eip155-72020.json</Mono>, note: t("dev.networks.rowRegistryNote") },
            ]}
          />
        </DevSection>

        <DevSection
          id="local"
          kicker={t("dev.networks.localKicker")}
          title={t("dev.networks.localTitle")}
          intro={t("dev.networks.localIntro")}
        >
          <CodeBlock code={LOCAL} label="bash" />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: t("dev.networks.localApi"), v: <Mono>http://127.0.0.1:6070</Mono> },
                { k: t("dev.networks.localExplorer"), v: <Mono>http://127.0.0.1:3000</Mono> },
                { k: t("dev.networks.localListeners"), v: <Mono>:6071 · :6072</Mono>, note: t("dev.networks.localListenersNote") },
                { k: t("dev.networks.localData"), v: <Mono>data/testnet/endpoints.env</Mono>, note: t("dev.networks.localDataNote") },
              ]}
            />
          </div>
          <div className="mt-6">
            <CodeBlock code={ENV} label=".env.local" />
          </div>
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.networks.faucetTitle")}>
              {t("dev.networks.faucetBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="portas"
          kicker={t("dev.networks.portsKicker")}
          title={t("dev.networks.portsTitle")}
          intro={t("dev.networks.portsIntro")}
        >
          <DevTable
            columns={[{ label: t("dev.networks.colPort"), width: "w-[140px]" }, { label: t("dev.networks.colUse") }]}
          >
            <DevRows
              rows={PORTS.map((row) => ({ k: row.key, cells: [row.port, t(`dev.networks.port.${row.key}`)] }))}
            />
          </DevTable>
        </DevSection>

        <DevSection
          id="parametros"
          kicker={t("dev.networks.paramsKicker")}
          title={t("dev.networks.paramsTitle")}
          intro={t("dev.networks.paramsIntro")}
        >
          <DevTable
            columns={[
              { label: t("dev.networks.colParam"), width: "w-[260px]" },
              { label: t("dev.networks.colValue") },
            ]}
          >
            <DevRows monoCols={[0, 1]} rows={PARAMS.map((row) => ({ k: row.k, cells: [row.k, row.v] }))} />
          </DevTable>
          <div className="mt-5">
            <Callout title={t("dev.networks.forkTitle")}>{t("dev.networks.forkBody")}</Callout>
          </div>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/guides/run-node", label: t("dev.nav.runNode"), desc: t("dev.nav.runNodeDesc") },
              { href: "/developers/guides/metamask", label: t("dev.nav.metamask"), desc: t("dev.nav.metamaskDesc") },
              { href: "/developers/api", label: t("dev.nav.api"), desc: t("dev.nav.apiDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
