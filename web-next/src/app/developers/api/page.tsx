import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
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
import { EndpointTable } from "@/components/developers/endpoint-table";
import { API_ADMIN, API_READ, API_WRITE } from "@/components/developers/data/endpoints";
import { getT } from "@/i18n/server";

/**
 * O mapa de tarefas: quem chega à referência não procura um endpoint, procura
 * uma resposta. Cada linha vai da intenção à superfície exata que a resolve.
 */
const TASK_MAP: { key: string; tasks: { key: string; call: string }[] }[] = [
  {
    key: "read",
    tasks: [
      { key: "balance", call: "GET /address/:end" },
      { key: "proveBalance", call: "GET /proof/:end" },
      { key: "history", call: "GET /address/:end/txs?limit&before" },
      { key: "tx", call: "GET /tx/:id" },
      { key: "head", call: "GET /blocks/latest" },
      { key: "range", call: "GET /chain?from&limit" },
      { key: "final", call: "GET /status → finalizedHeight" },
      { key: "search", call: "GET /search?q=" },
    ],
  },
  {
    key: "write",
    tasks: [
      { key: "send", call: "POST /tx" },
      { key: "nonce", call: "GET /address/:end → nextNonce" },
      { key: "eavmSend", call: "POST /eavm/tx · eth_sendRawTransaction" },
      { key: "verify", call: "POST /contract/:addr/verify" },
    ],
  },
  {
    key: "assets",
    tasks: [
      { key: "tokens", call: "GET /tokens · /tokens/:id" },
      { key: "holders", call: "GET /tokens/:id/holders" },
      { key: "transfers", call: "GET /tokens/:id/transfers?limit&before" },
      { key: "nfts", call: "GET /nfts · /nfts/:id" },
      { key: "name", call: "GET /name/:nome" },
    ],
  },
  {
    key: "network",
    tasks: [
      { key: "validators", call: "GET /validators" },
      { key: "governance", call: "GET /governance/proposals" },
      { key: "mempool", call: "GET /mempool" },
      { key: "stats", call: "GET /stats" },
      { key: "logs", call: "GET /logs · /internal" },
    ],
  },
];

const INTERNAL_SAMPLE = `GET /internal?address=E7A4B2…9F21&from=1280000&limit=100

{
  "internal": [
    {
      "txId": "0x8c1f…",
      "kind": "CALL",
      "from": "0x71C7…9f21",
      "to": "0x4aE2…10b8",
      "fromE7": "E7A4B2…9F21",
      "toE7": "E7C910…10B8",
      "amount": "2500000",
      "blockHeight": 1284002
    }
  ]
}`;

const PAGINATION_SAMPLE = `# feed global, mais novas primeiro
curl -s 'https://eavscan.com/txs?limit=50'

# histórico de uma carteira, paginado por cursor
curl -s 'https://eavscan.com/address/E7A4B2…9F21/txs?limit=50&before=1283900'

# faixa de blocos (teto em MAX_CHAIN_PAGE)
curl -s 'https://eavscan.com/chain?from=1283000&limit=100'`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.api.title"), description: t("dev.api.lede") };
}

export default async function ApiPage() {
  const t = await getT();

  const readSections = API_READ.map((group) => ({
    title: t(`dev.api.group.${group.key}`),
    rows: group.items.map((item) => ({
      method: item.method,
      path: item.path,
      desc: t(`dev.api.ep.${item.key}`),
    })),
  }));

  const columns = {
    method: t("dev.api.colMethod"),
    path: t("dev.api.colPath"),
    desc: t("dev.api.colDesc"),
  };

  return (
    <>
      <DevPageHead eyebrow={t("dev.api.eyebrow")} title={t("dev.api.title")} lede={t("dev.api.lede")} />

      <DevSections>
        <DevSection
          id="superficies"
          kicker={t("dev.api.surfacesKicker")}
          title={t("dev.api.surfacesTitle")}
          intro={t("dev.api.surfacesIntro")}
        >
          <SpecList
            rows={[
              {
                k: t("dev.api.specRest"),
                v: <Mono>https://eavscan.com</Mono>,
                note: t("dev.api.specRestNote"),
              },
              {
                k: t("dev.api.specEavm"),
                v: <Mono>https://rpc.eavscan.com</Mono>,
                note: t("dev.api.specEavmNote"),
              },
              { k: t("dev.api.specFormat"), v: <Mono>Accept: application/json</Mono>, note: t("dev.api.specFormatNote") },
              { k: t("dev.api.specAuth"), v: t("dev.api.specAuthValue"), note: t("dev.api.specAuthNote") },
            ]}
          />
        </DevSection>

        <DevSection
          id="tarefas"
          kicker={t("dev.api.taskKicker")}
          title={t("dev.api.taskTitle")}
          intro={t("dev.api.taskIntro")}
        >
          <DevTable
            columns={[
              { label: t("dev.api.colTask"), width: "w-[330px]" },
              { label: t("dev.api.colCall") },
            ]}
          >
            {TASK_MAP.map((group) => (
              <Fragment key={group.key}>
                <DevRowGroup title={t(`dev.api.taskGroup.${group.key}`)} span={2} />
                <DevRows
                  monoCols={[1]}
                  rows={group.tasks.map((task) => ({
                    k: `${group.key}.${task.key}`,
                    cells: [t(`dev.api.task.${group.key}.${task.key}`), task.call],
                  }))}
                />
              </Fragment>
            ))}
          </DevTable>
        </DevSection>

        <DevSection
          id="unidades"
          kicker={t("dev.api.unitsKicker")}
          title={t("dev.api.unitsTitle")}
          intro={t("dev.api.unitsIntro")}
        >
          <SpecList
            rows={[
              { k: "CHAIN.UNIT", v: <Mono>1 EAV7 = 1 000 000 e7</Mono>, note: t("dev.api.unitUnitNote") },
              {
                k: "CHAIN.EAVM_WEI_PER_E7",
                v: <Mono>1 e7 = 1 000 000 000 000 wei</Mono>,
                note: t("dev.api.unitWeiNote"),
              },
              { k: t("dev.api.unitTypes"), v: t("dev.api.unitTypesValue"), note: t("dev.api.unitTypesNote") },
            ]}
          />
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.api.unitsCalloutTitle")}>
              {t("dev.api.unitsCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="leitura"
          kicker={t("dev.api.readKicker")}
          title={t("dev.api.readTitle")}
          intro={t("dev.api.readIntro")}
        >
          <EndpointTable sections={readSections} columns={columns} />
        </DevSection>

        <DevSection
          id="paginacao"
          kicker={t("dev.api.pageKicker")}
          title={t("dev.api.pageTitle")}
          intro={t("dev.api.pageIntro")}
        >
          <CodeBlock code={PAGINATION_SAMPLE} label="bash" />
        </DevSection>

        <DevSection
          id="escrita"
          kicker={t("dev.api.writeKicker")}
          title={t("dev.api.writeTitle")}
          intro={t("dev.api.writeIntro")}
        >
          <EndpointTable
            sections={[
              {
                title: t("dev.api.group.write"),
                rows: API_WRITE.map((item) => ({
                  method: item.method,
                  path: item.path,
                  desc: t(`dev.api.ep.${item.key}`),
                })),
              },
            ]}
            columns={columns}
          />
          <p className="mt-5 text-[13.5px] leading-relaxed text-muted">
            {t("dev.api.writeBody")}{" "}
            <Link href="/developers/sdk" className="text-violet transition-colors hover:text-teal">
              {t("dev.nav.sdk")}
            </Link>
            .
          </p>
        </DevSection>

        <DevSection
          id="admin"
          kicker={t("dev.api.adminKicker")}
          title={t("dev.api.adminTitle")}
          intro={t("dev.api.adminIntro")}
        >
          <EndpointTable
            sections={[
              {
                title: t("dev.api.group.admin"),
                rows: API_ADMIN.map((item) => ({
                  method: item.method,
                  path: item.path,
                  desc: t(`dev.api.ep.${item.key}`),
                })),
              },
            ]}
            columns={columns}
          />
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.api.adminCalloutTitle")}>
              {t("dev.api.adminCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="internas"
          kicker={t("dev.api.internalKicker")}
          title={t("dev.api.internalTitle")}
          intro={t("dev.api.internalIntro")}
        >
          <CodeBlock code={INTERNAL_SAMPLE} label="http" />
          <div className="mt-5">
            <Callout title={t("dev.api.internalCalloutTitle")}>{t("dev.api.internalCalloutBody")}</Callout>
          </div>
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/api/json-rpc", label: t("dev.nav.jsonRpc"), desc: t("dev.nav.jsonRpcDesc") },
              { href: "/developers/errors", label: t("dev.nav.errors"), desc: t("dev.nav.errorsDesc") },
              { href: "/developers/integrations", label: t("dev.nav.integrations"), desc: t("dev.nav.integrationsDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
