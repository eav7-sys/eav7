import { getTokens } from "@/lib/api";
import { getMarketPrice } from "@/lib/price-market";
import { TokensList } from "@/components/scan/lists/tokens-list";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("scanLists.titleTokens")} · EAV7 Scan` };
}

export default async function TokensPage() {
  const [tokens, price] = await Promise.all([
    getTokens().catch(() => []),
    Promise.resolve()
      .then(() => getMarketPrice())
      .catch(() => null),
  ]);
  return <TokensList tokens={tokens ?? []} eav7Price={price} />;
}
