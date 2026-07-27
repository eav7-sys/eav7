"use client";

import { Copy } from "@/components/ui/copy";
import { IconCode } from "@/components/icons";
import { useT } from "@/i18n/provider";

const BASE = "https://eavscan.com";

interface Endpoint {
  method: "GET" | "POST";
  path: string;
  key: string;
}

const READ: Endpoint[] = [
  { method: "GET", path: "/status", key: "status" },
  { method: "GET", path: "/blocks?limit=N", key: "blocks" },
  { method: "GET", path: "/blocks/:altura", key: "blockByHeight" },
  { method: "GET", path: "/txs?limit=N&before=H", key: "txs" },
  { method: "GET", path: "/tx/:id", key: "tx" },
  { method: "GET", path: "/address/:end", key: "address" },
  { method: "GET", path: "/address/:end/txs", key: "addressTxs" },
  { method: "GET", path: "/proof/:end", key: "proof" },
  { method: "GET", path: "/name/:nome", key: "name" },
  { method: "GET", path: "/logs?address=&topic=", key: "logs" },
  { method: "GET", path: "/contract/:addr", key: "contract" },
  { method: "GET", path: "/tokens", key: "tokens" },
  { method: "GET", path: "/nfts", key: "nfts" },
  { method: "GET", path: "/names", key: "names" },
  { method: "GET", path: "/validators", key: "validators" },
  { method: "GET", path: "/validators/performance", key: "validatorsPerf" },
  { method: "GET", path: "/governance", key: "governance" },
  { method: "GET", path: "/governance/advisories", key: "governanceAdvisories" },
  { method: "GET", path: "/treasury", key: "treasury" },
  { method: "GET", path: "/bridge/transfers", key: "bridgeTransfers" },
  { method: "GET", path: "/ai/tasks", key: "aiTasks" },
  { method: "GET", path: "/security/alerts", key: "securityAlerts" },
  { method: "GET", path: "/gateway", key: "gateway" },
  { method: "GET", path: "/guard", key: "guard" },
  { method: "GET", path: "/stats", key: "stats" },
];

const WRITE: Endpoint[] = [
  { method: "POST", path: "/tx", key: "sendTx" },
  { method: "POST", path: "/eavm/tx", key: "sendEavmTx" },
  { method: "POST", path: "/contract/:addr/verify", key: "verifyContract" },
];

function MethodBadge({ method }: { method: Endpoint["method"] }) {
  const cls =
    method === "GET"
      ? "bg-ok/15 text-ok"
      : "bg-gold/15 text-gold";
  return (
    <span className={`font-mono w-[46px] flex-none rounded-md px-2 py-1 text-center text-[10.5px] font-bold ${cls}`}>
      {method}
    </span>
  );
}

function Row({ ep }: { ep: Endpoint }) {
  const t = useT();
  return (
    <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-violet/[0.05]">
      <MethodBadge method={ep.method} />
      <code className="font-mono flex-none text-[12.5px] font-semibold text-ink">{ep.path}</code>
      <span className="hidden min-w-0 flex-1 truncate text-[12.5px] text-muted sm:block">
        {t(`docs_api.endpoints.${ep.key}`)}
      </span>
      <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
        <Copy text={BASE + ep.path.split("?")[0]} />
      </span>
    </div>
  );
}

function Group({ titleKey, items }: { titleKey: string; items: Endpoint[] }) {
  const t = useT();
  return (
    <div>
      <div className="font-mono border-b border-line px-4 py-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-faint">
        {t(`docs_api.groups.${titleKey}`)}
      </div>
      <div className="divide-y divide-line/50">
        {items.map((ep) => (
          <Row key={ep.path} ep={ep} />
        ))}
      </div>
    </div>
  );
}

export function ApiReference() {
  const t = useT();
  return (
    <div className="card overflow-hidden p-0">
      {/* topo: base url */}
      <div className="relative overflow-hidden border-b border-line p-6">
        <div
          className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full blur-[90px]"
          style={{ background: "radial-gradient(circle, rgba(94,160,255,.26), transparent 70%)" }}
        />
        <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-blue">
          <IconCode size={14} /> {t("docs_api.badge")}
        </div>
        <h2 className="font-display relative mt-3 text-[clamp(20px,3vw,26px)] font-extrabold tracking-tight">
          {t("docs_api.title")}
        </h2>
        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-faint">{t("docs_api.baseUrl")}</span>
          <span className="code-term font-mono flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12.5px] text-[#e8e3f5]">
            {BASE}
            <Copy text={BASE} />
          </span>
        </div>
        <div className="relative mt-3 flex flex-wrap gap-2 text-[11.5px] text-muted">
          <span className="rounded-full border border-line-2 px-3 py-1">JSON</span>
          <span className="rounded-full border border-line-2 px-3 py-1">{t("docs_api.tags.cors")}</span>
          <span className="rounded-full border border-line-2 px-3 py-1">{t("docs_api.tags.units")}</span>
          <span className="rounded-full border border-line-2 px-3 py-1">{t("docs_api.tags.noAuth")}</span>
        </div>
      </div>

      {/* endpoints */}
      <Group titleKey="read" items={READ} />
      <div className="border-t border-line" />
      <Group titleKey="write" items={WRITE} />
    </div>
  );
}
