import { getNetworkStats, getTxs } from "@/lib/api";
import { TxsList } from "@/components/scan/lists/txs-list";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("scanLists.titleTxs")} · EAV7 Scan` };
}

export default async function TxsPage() {
  const [page, stats] = await Promise.all([
    getTxs(25).catch(() => null),
    getNetworkStats().catch(() => null),
  ]);

  return <TxsList inicial={page} total={stats?.transactions ?? null} />;
}
