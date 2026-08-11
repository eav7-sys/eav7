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

const SHAPE = `# toda falha da API HTTP tem a mesma forma
{ "error": "conta inexistente" }

# a submissão é diferente: 200 com o veredito no corpo
{ "accepted": false, "id": "0x8c1f…", "reason": "transação já conhecida" }`;

const RATE = `HTTP/1.1 429 Too Many Requests
Retry-After: 10

{ "error": "limite de requisições excedido" }`;

const HTTP_CODES = ["200", "400", "404", "429", "502", "503"];
const SDK_ERRORS = ["Transporte", "Api", "Resposta", "Transacao", "ProvaInvalida", "TempoEsgotado"];
const REJECTIONS = ["nonceUsed", "nonceGap", "known", "mempoolFull", "invalidSignature", "balance"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dev.errors.title"), description: t("dev.errors.lede") };
}

export default async function ErrorsPage() {
  const t = await getT();

  return (
    <>
      <DevPageHead eyebrow={t("dev.errors.eyebrow")} title={t("dev.errors.title")} lede={t("dev.errors.lede")} />

      <DevSections>
        <DevSection
          id="forma"
          kicker={t("dev.errors.shapeKicker")}
          title={t("dev.errors.shapeTitle")}
          intro={t("dev.errors.shapeIntro")}
        >
          <CodeBlock code={SHAPE} label="json" />
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.errors.shapeCalloutTitle")}>
              {t("dev.errors.shapeCalloutBody")}
            </Callout>
          </div>
        </DevSection>

        <DevSection
          id="http"
          kicker={t("dev.errors.httpKicker")}
          title={t("dev.errors.httpTitle")}
          intro={t("dev.errors.httpIntro")}
        >
          <DevTable
            columns={[
              { label: t("dev.errors.colCode"), width: "w-[90px]" },
              { label: t("dev.errors.colMeaning"), width: "w-[210px]" },
              { label: t("dev.errors.colAction") },
            ]}
          >
            <DevRows
              rows={HTTP_CODES.map((code) => ({
                k: code,
                cells: [code, t(`dev.errors.http.${code}`), t(`dev.errors.httpFix.${code}`)],
              }))}
            />
          </DevTable>
        </DevSection>

        <DevSection
          id="recusas"
          kicker={t("dev.errors.rejectKicker")}
          title={t("dev.errors.rejectTitle")}
          intro={t("dev.errors.rejectIntro")}
        >
          <DevTable
            columns={[
              { label: t("dev.errors.colReason"), width: "w-[260px]" },
              { label: t("dev.errors.colAction") },
            ]}
          >
            <DevRows
              rows={REJECTIONS.map((key) => ({
                k: key,
                cells: [t(`dev.errors.reject.${key}Msg`), t(`dev.errors.reject.${key}Fix`)],
              }))}
            />
          </DevTable>
        </DevSection>

        <DevSection
          id="sdk"
          kicker={t("dev.errors.sdkKicker")}
          title={t("dev.errors.sdkTitle")}
          intro={t("dev.errors.sdkIntro")}
        >
          <DevTable
            columns={[
              { label: t("dev.errors.colVariant"), width: "w-[250px]" },
              { label: t("dev.errors.colMeaning") },
            ]}
          >
            <DevRows
              rows={SDK_ERRORS.map((name) => ({
                k: name,
                cells: [`ErroCliente::${name}`, t(`dev.errors.sdk.${name}`)],
              }))}
            />
          </DevTable>
          <div className="mt-5">
            <Callout tone="warn" title={t("dev.errors.timeoutTitle")}>{t("dev.errors.timeoutBody")}</Callout>
          </div>
        </DevSection>

        <DevSection
          id="limites"
          kicker={t("dev.errors.rateKicker")}
          title={t("dev.errors.rateTitle")}
          intro={t("dev.errors.rateIntro")}
        >
          <CodeBlock code={RATE} label="http" />
          <div className="mt-6">
            <SpecList
              rows={[
                { k: "RATE_LIMIT_MAX", v: <Mono>240</Mono>, note: t("dev.errors.rateMax") },
                { k: "RATE_LIMIT_WINDOW_MS", v: <Mono>10 000</Mono>, note: t("dev.errors.rateWindow") },
                { k: t("dev.errors.rateGuard"), v: t("dev.errors.rateGuardBody") },
                { k: "MAX_RPC_BATCH", v: <Mono>50</Mono>, note: t("dev.errors.rateBatch") },
                { k: "MAX_DATA_BYTES", v: <Mono>65 536</Mono>, note: t("dev.errors.rateData") },
                { k: "MAX_CHAIN_PAGE", v: <Mono>2 000</Mono>, note: t("dev.errors.ratePage") },
              ]}
            />
          </div>
        </DevSection>

        <DevSection
          id="rpc"
          kicker={t("dev.errors.rpcKicker")}
          title={t("dev.errors.rpcTitle")}
          intro={t("dev.errors.rpcIntro")}
        >
          <DevLinkList
            items={[
              { href: "/developers/api/json-rpc#erros", label: t("dev.nav.jsonRpc"), desc: t("dev.errors.rpcLink"), mono: false },
            ]}
          />
        </DevSection>

        <DevSection id="depois" kicker={t("dev.common.nextKicker")} title={t("dev.common.nextTitle")}>
          <DevLinkList
            items={[
              { href: "/developers/troubleshooting", label: t("dev.nav.troubleshooting"), desc: t("dev.nav.troubleshootingDesc") },
              { href: "/developers/guides/sign-broadcast", label: t("dev.nav.signBroadcast"), desc: t("dev.nav.signBroadcastDesc") },
              { href: "/developers/api", label: t("dev.nav.api"), desc: t("dev.nav.apiDesc") },
            ]}
          />
        </DevSection>
      </DevSections>

      <DevPager />
    </>
  );
}
