import { Fragment } from "react";
import type { Metadata } from "next";
import { CodeBlock } from "@/components/developers/code-block";
import { DevPager } from "@/components/developers/dev-pager";
import {
  Callout,
  DevPageHead,
  DevSection,
  DevSections,
  DevTable,
  Mono,
  SpecList,
} from "@/components/developers/dev-page";
import { EavmConnect } from "@/components/docs/eavm-connect";
import { getT } from "@/i18n/server";

// Métodos atendidos por node/src/eavm_rpc.rs. Qualquer outro devolve -32601.
const RPC_GROUPS: { key: string; methods: string[] }[] = [
  { key: "node", methods: ["web3_clientVersion", "net_version", "net_listening", "eth_chainId", "eth_syncing", "eth_accounts"] },
  { key: "state", methods: ["eth_blockNumber", "eth_getBalance", "eth_getCode", "eth_getTransactionCount"] },
  { key: "fees", methods: ["eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_estimateGas"] },
  { key: "blocks", methods: ["eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"] },
  { key: "exec", methods: ["eth_call", "eth_sendRawTransaction"] },
];

const RPC_CURL = `curl -s https://rpc.eavscan.com \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

{"jsonrpc":"2.0","id":1,"result":"0x11954"}`;

const MISSING = ["eth_sendTransaction", "eth_getStorageAt", "eth_subscribe", "eth_newFilter"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.eavm.title"), description: t("dev.eavm.lede") };
}

export default async function EavmPage() {
  const t = await getT();

  return (
    <>
      <DevPageHead eyebrow={t("dev.eavm.eyebrow")} title={t("dev.eavm.title")} lede={t("dev.eavm.lede")} />

      <DevSections>
        <DevSection
          id="conectar"
          kicker={t("dev.eavm.connectKicker")}
          title={t("dev.eavm.connectTitle")}
          intro={t("dev.eavm.connectIntro")}
        >
          <EavmConnect />
        </DevSection>

        <DevSection
          id="parametros"
          kicker={t("dev.eavm.paramsKicker")}
          title={t("dev.eavm.paramsTitle")}
          intro={t("dev.eavm.paramsIntro")}
        >
          <SpecList
            rows={[
              { k: "chainId", v: <Mono>72020 · 0x11954</Mono>, note: t("dev.eavm.paramChainId") },
              { k: t("dev.eavm.paramPort"), v: <Mono>7070</Mono>, note: t("dev.eavm.paramRpc") },
              { k: t("dev.eavm.paramDecimals"), v: <Mono>18 · 6</Mono>, note: t("dev.eavm.paramCurrency") },
            ]}
          />
        </DevSection>

        <DevSection
          id="rpc"
          kicker={t("dev.eavm.rpcKicker")}
          title={t("dev.eavm.rpcTitle")}
          intro={t("dev.eavm.rpcIntro")}
        >
          <CodeBlock code={RPC_CURL} label="bash" />
          <div className="mt-8">
            <DevTable columns={[{ label: t("dev.eavm.colMethod") }, { label: t("dev.eavm.colDesc") }]}>
              {RPC_GROUPS.map((group) => (
                <Fragment key={group.key}>
                  <tr>
                    <th
                      colSpan={2}
                      className="font-mono pb-1.5 pt-6 text-left text-[10px] font-semibold uppercase tracking-[1.6px] text-violet"
                    >
                      {t(`dev.eavm.rpcGroup.${group.key}`)}
                    </th>
                  </tr>
                  {group.methods.map((method) => (
                    <tr
                      key={method}
                      className="border-b border-line/50 transition-colors hover:bg-violet/[0.04]"
                    >
                      <td className="py-2.5 pr-6 align-top">
                        <code className="font-mono whitespace-nowrap text-[12.5px] font-semibold text-ink">
                          {method}
                        </code>
                      </td>
                      <td className="py-2.5 align-top text-[13px] leading-relaxed text-muted">
                        {t(`dev.eavm.rpc.${method}`)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </DevTable>
          </div>
        </DevSection>

        <DevSection
          id="limites"
          kicker={t("dev.eavm.gapsKicker")}
          title={t("dev.eavm.gapsTitle")}
          intro={t("dev.eavm.gapsIntro")}
        >
          <div className="flex flex-wrap gap-2">
            {MISSING.map((method) => (
              <code
                key={method}
                className="font-mono rounded-full border border-line-2 px-3.5 py-1.5 text-[12px] text-faint line-through"
              >
                {method}
              </code>
            ))}
          </div>
          <div className="mt-6 space-y-3">
            <Callout tone="warn" title={t("dev.eavm.gapsCalloutTitle")}>
              {t("dev.eavm.gapsCalloutBody")}
            </Callout>
            <Callout title={t("dev.eavm.unknownTitle")}>{t("dev.eavm.unknownBody")}</Callout>
          </div>
        </DevSection>

        <DevSection
          id="valor"
          kicker={t("dev.eavm.valueKicker")}
          title={t("dev.eavm.valueTitle")}
          intro={t("dev.eavm.valueIntro")}
        >
          <SpecList
            rows={[
              { k: t("dev.eavm.valueLedger"), v: t("dev.eavm.valueLedgerBody") },
              { k: t("dev.eavm.valueInternal"), v: t("dev.eavm.valueInternalBody") },
              { k: t("dev.eavm.valueUnits"), v: t("dev.eavm.valueUnitsBody") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
