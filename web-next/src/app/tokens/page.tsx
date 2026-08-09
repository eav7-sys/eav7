import { getTokens } from "@/lib/api";
import { TokensList } from "@/components/scan/lists/tokens-list";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("scanLists.titleTokens")} · EAV7 Scan` };
}

export default async function TokensPage() {
  // Uma requisição. O catálogo e o detalhe saem da MESMA função no nó
  // (`tokenView`), então `/tokens` já traz `decimals`, `createdAt` e o resto —
  // esta tela buscava o detalhe de cada item para ler campos que já tinha em
  // mãos, 61 requisições onde uma basta. O tipo `TokenSummary` é que declarava
  // menos do que a rota entrega; corrigido em lib/api.ts.
  const tokens = await getTokens().catch(() => []);
  return <TokensList tokens={tokens ?? []} />;
}
