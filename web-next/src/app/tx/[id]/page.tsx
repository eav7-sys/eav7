import type { Metadata } from "next";
import { getStatus, getTx } from "@/lib/api";
import { TxView } from "@/components/scan/detail/tx-view";
import { NotFoundView } from "@/components/scan/detail/shell";
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
  const t = await getT();
  // O status vem junto porque a tela precisa dele para confirmações e finalidade;
  // sem ele a tela continua de pé, só sem essas duas linhas.
  const [res, status] = await Promise.all([getTx(id).catch(() => null), getStatus().catch(() => null)]);

  if (!res || res.error || !res.tx) {
    return <NotFoundView title={t("scan_detail.nfTxTitle")} hint={t("scan_detail.nfTxHint")} query={id} t={t} />;
  }

  return <TxView res={res} status={status} t={t} />;
}
