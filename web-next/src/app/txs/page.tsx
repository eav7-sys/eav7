import { getTxs, getStatus, getNetworkStats } from "@/lib/api";
import { TxsLive } from "@/components/txs/txs-live";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("page_txs.metaTitle") };
}

export default async function TxsPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const { before } = await searchParams;
  const beforeN = before ? Number(before) : undefined;

  const [page, status, stats] = await Promise.all([
    getTxs(40, beforeN).catch(() => null),
    getStatus().catch(() => null),
    getNetworkStats().catch(() => null),
  ]);

  return <TxsLive initial={{ page, status, stats, before: beforeN }} />;
}
