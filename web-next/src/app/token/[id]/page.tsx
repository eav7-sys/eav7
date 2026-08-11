import type { Metadata } from "next";
import { getContract, getToken, getTokenHolders, getTokenTransfers, type Tx } from "@/lib/api";
import { TOKEN_TABS, TokenView, type TokenTab } from "@/components/scan/detail/token-view";
import { NotFoundView } from "@/components/scan/detail/shell";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [token, t] = await Promise.all([getToken(id).catch(() => null), getT()]);
  return {
    title: token
      ? t("page_token.metaTitle", { symbol: token.symbol, name: token.name })
      : t("page_token.metaTitleFallback"),
  };
}

export default async function TokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const bruta = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: TokenTab = (TOKEN_TABS as readonly string[]).includes(bruta ?? "") ? (bruta as TokenTab) : "transfers";

  const token = await getToken(id).catch(() => null);
  if (!token) {
    return <NotFoundView title={t("scan_detail.nfTokenTitle")} hint={t("scan_detail.nfTokenHint")} query={id} t={t} />;
  }

  // Detentores vêm SEMPRE: alimentam a concentração exibida no topo, visível em
  // qualquer aba. Transferências e código verificado, só nas abas delas.
  const [transferencias, detentores, contrato] = await Promise.all([
    tab === "transfers" ? getTokenTransfers(id, 50) : Promise.resolve({ txs: [] as Tx[] }),
    getTokenHolders(id, 100),
    tab === "contract" ? getContract(id) : Promise.resolve(null),
  ]);

  return (
    <TokenView
      token={token}
      holders={detentores?.list ?? []}
      transfers={transferencias.txs}
      contract={contrato}
      tab={tab}
      t={t}
    />
  );
}
