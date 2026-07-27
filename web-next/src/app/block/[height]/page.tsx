import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBlock, getStatus } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { Kv } from "@/components/ui/kv";
import { AddrLink, TxLink } from "@/components/hash-link";
import { TxBadge } from "@/components/tx-badge";
import { TxValue } from "@/components/tx-value";
import { when, ago, fmt, shortHash } from "@/lib/format";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ height: string }>;
}): Promise<Metadata> {
  const { height } = await params;
  const t = await getT();
  return { title: t("page_block.metaTitle", { height }) };
}

export default async function BlockPage({ params }: { params: Promise<{ height: string }> }) {
  const { height } = await params;
  const t = await getT();
  const [block, status] = await Promise.all([
    getBlock(height).catch(() => null),
    getStatus().catch(() => null),
  ]);
  if (!block || block.error || block.height == null) notFound();

  const txs = block.transactions ?? [];
  // Finalidade BFT (#2): bloco final quando sua altura ≤ finalizedHeight.
  const isFinalized =
    status != null && status.finalizedHeight >= 0 && block.height <= status.finalizedHeight;

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <PageHeader
        eyebrow={t("page_block.eyebrow")}
        title={t("page_block.title", { height: block.height.toLocaleString("pt-BR") })}
        sub={t("page_block.sub", { ago: ago(block.timestamp) })}
      />

      <Kv
        rows={[
          { label: t("page_block.kv.height"), value: <span className="tnum">{block.height.toLocaleString("pt-BR")}</span> },
          ...(status != null
            ? [
                {
                  label: t("page_block.kv.finality"),
                  value: isFinalized ? (
                    <span className="badge badge-green">✓ {t("page_block.finalized")}</span>
                  ) : (
                    <span className="badge badge-gold">
                      <span className="livedot" style={{ width: 5, height: 5 }} /> {t("page_block.pending")}
                    </span>
                  ),
                },
              ]
            : []),
          { label: t("page_block.kv.date"), value: <span className="tnum">{when(block.timestamp)}</span> },
          { label: t("page_block.kv.producer"), value: <AddrLink addr={block.producer} len={16} /> },
          {
            label: t("page_block.kv.previousHash"),
            value: block.previousHash ? (
              <BlockLinkByHash hash={block.previousHash} />
            ) : (
              "—"
            ),
          },
          { label: t("page_block.kv.merkleRoot"), value: <span className="font-mono">{shortHash(block.txRoot, 20, 8)}</span> },
          { label: t("page_block.kv.txCount"), value: <span className="tnum">{block.txCount}</span> },
          {
            label: t("page_block.kv.protocol"),
            value: (
              <span>
                {block.protocol ?? "eav20"} · {t("page_block.kv.scheme")}{" "}
                <span className="font-mono">{block.scheme ?? "eav7-hybrid-1"}</span>
              </span>
            ),
          },
        ]}
      />

      <h2 className="font-display mb-3 mt-8 text-[17px] font-bold">
        {t("page_block.txSectionTitle")} <span className="text-muted">({block.txCount})</span>
      </h2>
      <div className="card overflow-x-auto p-5">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left">
              {[
                t("page_block.table.hash"),
                t("page_block.table.type"),
                t("page_block.table.from"),
                t("page_block.table.to"),
                t("page_block.table.value"),
                t("page_block.table.fee"),
              ].map((h) => (
                <th
                  key={h}
                  className="font-mono border-b border-line pb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txs.map((tx) => (
              <tr key={tx.id} className="border-b border-line/40 hover:bg-line/30">
                <td className="py-2.5">
                  <TxLink id={tx.id} />
                </td>
                <td>
                  <TxBadge type={tx.type} />
                </td>
                <td>
                  <AddrLink addr={tx.from} len={6} />
                </td>
                <td>
                  <AddrLink addr={tx.to} len={6} />
                </td>
                <td>
                  <TxValue tx={tx} />
                </td>
                <td className="tnum text-muted">{fmt(tx.fee)}</td>
              </tr>
            ))}
            {txs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  {t("page_block.emptyBlock")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BlockLinkByHash({ hash }: { hash: string }) {
  return <span className="font-mono text-[12px] text-muted">{shortHash(hash, 20, 8)}</span>;
}
