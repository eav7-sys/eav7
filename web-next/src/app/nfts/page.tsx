import type { Metadata } from "next";
import Link from "next/link";
import { getNfts } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { AddrLink } from "@/components/hash-link";
import { shortHash, num } from "@/lib/format";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("page_nfts.metaTitle") };
}

export default async function NftsPage() {
  const t = await getT();
  const collections = await getNfts().catch(() => []);

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      <PageHeader eyebrow={t("page_nfts.eyebrow")} title={t("page_nfts.title")} sub={t("page_nfts.subtitle")} />

      <div className="card overflow-x-auto p-5">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left">
              {[t("page_nfts.colCollection"), t("page_nfts.colSymbol"), t("page_nfts.colSupply"), t("page_nfts.colOwner")].map((h) => (
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
            {collections.map((c) => (
              <tr key={c.id} className="border-b border-line/40 hover:bg-line/30">
                <td className="py-3">
                  <Link href={`/nfts/${c.id}`} className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-pink/15 font-mono text-[11px] font-bold text-pink">
                      {(c.symbol ?? "N").slice(0, 3)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{c.name}</span>
                      <span className="font-mono block text-[11px] text-faint">{shortHash(c.id, 10, 4)}</span>
                    </span>
                  </Link>
                </td>
                <td className="font-bold text-ink">{c.symbol}</td>
                <td className="tnum">{num(c.supply)}</td>
                <td>
                  <AddrLink addr={c.owner} len={10} />
                </td>
              </tr>
            ))}
            {collections.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted">
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
