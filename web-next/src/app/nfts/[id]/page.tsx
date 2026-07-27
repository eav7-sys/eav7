import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getNftCollection } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { AddrLink } from "@/components/hash-link";
import { num } from "@/lib/format";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const col = await getNftCollection(id).catch(() => null);
  return { title: col ? `${col.name} · EAV721 · EAV7 Scan` : "EAV721 · EAV7 Scan" };
}

export default async function NftCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { id } = await params;
  const col = await getNftCollection(id).catch(() => null);
  if (!col || !col.id) notFound();

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <Link href="/nfts" className="font-mono mb-3 inline-block text-[12px] text-violet hover:text-teal">
        ← {t("page_nfts.back")}
      </Link>
      <PageHeader
        eyebrow={t("page_nfts.eyebrow")}
        title={col.name}
        sub={`${col.symbol} · ${num(col.supply)} ${t("page_nfts.supplyLabel")}`}
      />

      <h2 className="font-display mb-3 mt-6 text-[16px] font-bold">
        {t("page_nfts.tokensTitle")} <span className="text-muted">({num(col.supply)})</span>
      </h2>
      <div className="card overflow-x-auto p-5">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left">
              {[t("page_nfts.colTokenId"), t("page_nfts.colTokenOwner"), t("page_nfts.colUri")].map((h) => (
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
            {col.tokens.map((tk) => (
              <tr key={tk.tokenId} className="border-b border-line/40 hover:bg-line/30">
                <td className="tnum py-2.5 font-bold text-ink">#{tk.tokenId}</td>
                <td>
                  <AddrLink addr={tk.owner} len={12} />
                </td>
                <td className="font-mono max-w-[420px] truncate text-[12px] text-muted" title={tk.uri}>
                  {tk.uri ?? "—"}
                </td>
              </tr>
            ))}
            {col.tokens.length === 0 && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-muted">
                  {t("page_nfts.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
