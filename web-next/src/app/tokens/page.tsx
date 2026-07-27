import { getTokens } from "@/lib/api";
import { TokensView } from "@/components/tokens/tokens-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tokens EAV20 · EAV7 Scan" };

export default async function TokensPage() {
  const tokens = await getTokens().catch(() => []);
  return <TokensView tokens={tokens} />;
}
