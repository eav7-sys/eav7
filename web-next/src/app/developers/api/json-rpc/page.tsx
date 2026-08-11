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
  Mono,
  SpecList,
} from "@/components/developers/dev-page";
import { RPC_ERRORS, RPC_METHODS, RPC_MISSING } from "@/components/developers/data/json-rpc";
import { getT } from "@/i18n/server";

const CALL = `curl -s https://rpc.eavscan.com \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

{"jsonrpc":"2.0","id":1,"result":"0x139d67"}`;

const BATCH = `# lote: até MAX_RPC_BATCH (50) chamadas por requisição
curl -s https://rpc.eavscan.com \\
  -H 'Content-Type: application/json' \\
  -d '[
    {"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]},
    {"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}
  ]'`;

const LOGS = `{
  "jsonrpc": "2.0", "id": 1, "method": "eth_getLogs",
  "params": [{
    "fromBlock": "0x139000",
    "toBlock":   "0x139d67",
    "address":   "0x4aE2…10b8",
    "topics":    ["0xddf252ad…"]
  }]
}`;

const ERROR = `{
  "jsonrpc": "2.0",
  "id": 1,
  "error": { "code": -32601, "message": "método não suportado: eth_getStorageAt" }
}`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.jsonrpc.title"), description: t("dev.jsonrpc.lede") };
}

export default async function JsonRpcPage() {
  const t = await getT();

  const columns = [
    { label: t("dev.jsonrpc.colMethod"), width: "w-[230px]" },
    { label: t("dev.jsonrpc.colParams"), width: "w-[200px]" },
    { label: t("dev.jsonrpc.colReturns"), width: "w-[170px]" },
    { label: t("dev.jsonrpc.colDesc") },
  ];

  return (
    <>
      <DevPageHead
        eyebrow={t("dev.jsonrpc.eyebrow")}
        title={t("dev.jsonrpc.title")}
        lede={t("dev.jsonrpc.lede")}
      />

      <DevSections>
        <DevSection
          id="chamar"
          kicker={t("dev.jsonrpc.callKicker")}
          title={t("dev.jsonrpc.callTitle")}
          intro={t("dev.jsonrpc.callIntro")}
        >
          <CodeBlock code={CALL} label="bash" />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: t("dev.jsonrpc.specEndpoint"), v: <Mono>https://rpc.eavscan.com</Mono>, note: t("dev.jsonrpc.specEndpointNote") },
                { k: t("dev.jsonrpc.specLocal"), v: <Mono>http://127.0.0.1:7070</Mono>, note: t("dev.jsonrpc.specLocalNote") },
                { k: "chainId", v: <Mono>72020 · 0x11954</Mono>, note: t("dev.jsonrpc.specChainNote") },
                { k: t("dev.jsonrpc.specUnits"), v: <Mono>wei = e7 × 10¹²</Mono>, note: t("dev.jsonrpc.specUnitsNote") },
              ]}
            />
          </div>
        </DevSection>

        <DevSection
          id="metodos"
          kicker={t("dev.jsonrpc.methodsKicker")}
          title={t("dev.jsonrpc.methodsTitle")}
          intro={t("dev.jsonrpc.methodsIntro")}
        >
          <DevTable columns={columns}>
            {RPC_METHODS.map((group) => (
              <Fragment key={group.key}>
                <DevRowGroup title={t(`dev.jsonrpc.group.${group.key}`)} span={4} />
                <DevRows
                  monoCols={[0, 1, 2]}
                  rows={group.methods.map((method) => ({
                    k: method.name,
                    cells: [method.name, method.params, method.returns, t(`dev.jsonrpc.m.${method.name}`)],
                  }))}
                />
              </Fragment>
            ))}
          </DevTable>
        </DevSection>

        <DevSection
          id="gas"
          kicker={t("dev.jsonrpc.gasKicker")}
          title={t("dev.jsonrpc.gasTitle")}
          intro={t("dev.jsonrpc.gasIntro")}
        >
          <SpecList
            rows={[
              { k: "eth_gasPrice", v: <Mono>FEES.EAVM_TRANSFER × 10¹² ÷ 21 000</Mono>, note: t("dev.jsonrpc.gasFormula") },
              { k: "GAS_PER_ENERGY", v: <Mono>100</Mono>, note: t("dev.jsonrpc.gasEnergy") },
              { k: "MAX_EAVM_GAS", v: <Mono>5 190 000</Mono>, note: t("dev.jsonrpc.gasMax") },
              { k: "eth_maxPriorityFeePerGas", v: <Mono>0x0</Mono>, note: t("dev.jsonrpc.gasTip") },
            ]}
          />
        </DevSection>

        <DevSection
          id="logs"
          kicker={t("dev.jsonrpc.logsKicker")}
          title={t("dev.jsonrpc.logsTitle")}
          intro={t("dev.jsonrpc.logsIntro")}
        >
          <CodeBlock code={LOGS} label="json" />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: "MAX_LOG_RANGE", v: <Mono>5 000</Mono>, note: t("dev.jsonrpc.logsRange") },
                { k: "MAX_LOG_RESULTS", v: <Mono>10 000</Mono>, note: t("dev.jsonrpc.logsResults") },
                { k: "MAX_LOG_INDEX", v: <Mono>100 000</Mono>, note: t("dev.jsonrpc.logsIndex") },
              ]}
            />
          </div>
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.jsonrpc.logsCalloutTitle")}>
              {t("dev.jsonrpc.logsCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="lotes"
          kicker={t("dev.jsonrpc.batchKicker")}
          title={t("dev.jsonrpc.batchTitle")}
          intro={t("dev.jsonrpc.batchIntro")}
        >
          <CodeBlock code={BATCH} label="bash" />
        </DevSection>

        <DevSection
          id="erros"
          kicker={t("dev.jsonrpc.errorsKicker")}
          title={t("dev.jsonrpc.errorsTitle")}
          intro={t("dev.jsonrpc.errorsIntro")}
        >
          <CodeBlock code={ERROR} label="json" />
          <div className="mt-8">
            <DevTable
              columns={[{ label: t("dev.jsonrpc.colCode"), width: "w-[120px]" }, { label: t("dev.jsonrpc.colWhen") }]}
            >
              <DevRows
                rows={RPC_ERRORS.map((row) => ({
                  k: row.code,
                  cells: [row.code, t(`dev.jsonrpc.err.${row.key}`)],
                }))}
              />
            </DevTable>
          </div>
        </DevSection>

        <DevSection
          id="ausentes"
          kicker={t("dev.jsonrpc.missingKicker")}
          title={t("dev.jsonrpc.missingTitle")}
          intro={t("dev.jsonrpc.missingIntro")}
        >
          <div className="flex flex-wrap gap-2">
            {RPC_MISSING.map((method) => (
              <code
                key={method}
                className="font-mono rounded-full border border-line-2 px-3.5 py-1.5 text-[12px] text-faint line-through"
              >
                {method}
              </code>
            ))}
          </div>
          <div className="mt-6">
            <Callout tone="warn" title={t("dev.jsonrpc.missingCalloutTitle")}>
              {t("dev.jsonrpc.missingCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/eavm", label: t("dev.nav.eavm"), desc: t("dev.nav.eavmDesc") },
              { href: "/developers/guides/metamask", label: t("dev.nav.metamask"), desc: t("dev.nav.metamaskDesc") },
              { href: "/developers/errors", label: t("dev.nav.errors"), desc: t("dev.nav.errorsDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
