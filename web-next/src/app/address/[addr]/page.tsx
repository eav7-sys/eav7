import type { Metadata } from "next";
import { getAddress, getAddressAnalysis, getAddressTxs, getContract, getInternal } from "@/lib/api";
import { getMarketPrice } from "@/lib/price-market";
import { ADDRESS_TABS, AddressView, type AddressTab } from "@/components/scan/detail/address-view";
import { NotFoundView } from "@/components/scan/detail/shell";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ addr: string }>;
}): Promise<Metadata> {
  const { addr } = await params;
  const t = await getT();
  return { title: t("page_address.metaTitle", { addr: addr.slice(0, 12) }) };
}

export default async function AddressPage({
  params,
  searchParams,
}: {
  params: Promise<{ addr: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = await getT();
  const { addr } = await params;
  const sp = await searchParams;

  const bruta = um(sp.tab);
  const tab: AddressTab = (ADDRESS_TABS as readonly string[]).includes(bruta ?? "")
    ? (bruta as AddressTab)
    : "txs";
  const dir = um(sp.dir) ?? "all";
  const std = um(sp.std) ?? "all";

  const info = await getAddress(addr).catch(() => null);
  if (!info || info.error || !info.address) {
    return <NotFoundView title={t("scan_detail.nfAddrTitle")} hint={t("scan_detail.nfAddrHint")} query={addr} t={t} />;
  }

  // Cada aba busca SÓ o que precisa — ver permissões não pode custar mil transações.
  const precisaTxs = tab === "txs" || tab === "transfers" || tab === "contracts";
  const [txr, interno, analise, contrato, price] = await Promise.all([
    precisaTxs ? getAddressTxs(addr, 1000).catch(() => ({ txs: [] })) : Promise.resolve({ txs: [] }),
    tab === "internal" ? getInternal({ address: info.address, limit: 500 }) : Promise.resolve({ internal: [] }),
    tab === "analysis" ? getAddressAnalysis(addr) : Promise.resolve(null),
    tab === "contracts" && info.contract ? getContract(info.contract.address) : Promise.resolve(null),
    Promise.resolve()
      .then(() => getMarketPrice())
      .catch(() => null),
  ]);

  return (
    <AddressView
      info={info}
      txs={txr.txs ?? []}
      internal={interno.internal ?? []}
      analysis={analise}
      contract={contrato}
      price={price}
      tab={tab}
      dir={dir}
      std={std}
      t={t}
    />
  );
}
