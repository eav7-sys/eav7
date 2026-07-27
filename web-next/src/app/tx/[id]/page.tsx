import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTx } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Kv } from "@/components/ui/kv";
import { AddrLink, BlockLink } from "@/components/hash-link";
import { TxBadge } from "@/components/tx-badge";
import { TxValue } from "@/components/tx-value";
import { StatusBadge } from "@/components/status-badge";
import { Copy } from "@/components/ui/copy";
import { when, fmt, energyCost } from "@/lib/format";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await getT();
  return { title: t("page_tx.metaTitle", { id: id.slice(0, 12) }) };
}

export default async function TxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getTx(id).catch(() => null);
  if (!res || res.error || !res.tx) notFound();
  const t = await getT();

  const { tx } = res;
  const evm = tx.data as
    | { eavmFrom?: string; eavmTo?: string; eavmHash?: string }
    | undefined;

  // Campos específicos do tipo (VOTE, governança, NFT, nome, vesting, meta…) —
  // tudo que não seja a camada EAVM, que tem seção própria abaixo.
  const EAVM_KEYS = new Set(["eavmFrom", "eavmTo", "eavmHash"]);
  const detailRows = Object.entries(tx.data ?? {})
    .filter(([k, v]) => !EAVM_KEYS.has(k) && v != null && v !== "")
    .map(([k, v]) => ({
      label: k,
      value: (
        <span className="font-mono break-all text-[13px]">
          {typeof v === "object" ? JSON.stringify(v) : String(v)}
        </span>
      ),
    }));

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <PageHeader eyebrow={t("page_tx.eyebrow")} title={t("page_tx.title")} sub={tx.id} copySub={tx.id} />

      <Kv
        rows={[
          { label: t("page_tx.status"), value: <StatusBadge status={res.status} /> },
          { label: t("page_tx.type"), value: <TxBadge type={tx.type} /> },
          ...(res.blockHeight != null
            ? [{ label: t("page_tx.block"), value: <BlockLink height={res.blockHeight} /> }]
            : []),
          {
            label: t("page_tx.from"),
            value: (
              <span className="flex items-center gap-2">
                <AddrLink addr={tx.from} len={18} /> <Copy text={tx.from} />
              </span>
            ),
          },
          {
            label: t("page_tx.to"),
            value: tx.to ? (
              <span className="flex items-center gap-2">
                <AddrLink addr={tx.to} len={18} /> <Copy text={tx.to} />
              </span>
            ) : (
              <span className="text-muted">—</span>
            ),
          },
          { label: t("page_tx.value"), value: <TxValue tx={tx} /> },
          {
            label: t("page_tx.energy"),
            value: (
              <span className="tnum">
                {energyCost(tx.type)} {t("page_tx.energyUnit")}
                {BigInt(tx.fee) > 0n && <span className="text-muted"> · {fmt(tx.fee)} EAV7 queimados</span>}
              </span>
            ),
          },
          { label: t("page_tx.fee"), value: <span className="tnum">{fmt(tx.fee)} EAV7</span> },
          { label: t("page_tx.nonce"), value: <span className="tnum">{tx.nonce}</span> },
          { label: t("page_tx.date"), value: <span className="tnum">{when(tx.timestamp)}</span> },
          { label: t("page_tx.scheme"), value: <span className="font-mono">{tx.scheme ?? "eav7-hybrid-1"}</span> },
        ]}
      />

      {detailRows.length > 0 && (
        <>
          <h2 className="font-display mb-3 mt-8 text-[16px] font-bold">{t("page_tx.details")}</h2>
          <Kv rows={detailRows} />
        </>
      )}

      {evm?.eavmHash && (
        <>
          <h2 className="font-display mb-3 mt-8 text-[16px] font-bold">{t("page_tx.eavmLayer")}</h2>
          <Kv
            rows={[
              { label: "0x from", value: <span className="font-mono break-all">{evm.eavmFrom}</span> },
              { label: "0x to", value: <span className="font-mono break-all">{evm.eavmTo}</span> },
              { label: "0x hash", value: <span className="font-mono break-all">{evm.eavmHash}</span> },
            ]}
          />
        </>
      )}
    </div>
  );
}
