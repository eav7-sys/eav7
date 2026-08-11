import { getBlocks, getNames, getStatus } from "@/lib/api";
import { BlocksList } from "@/components/scan/lists/blocks-list";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("scanLists.titleBlocks")} · EAV7 Scan` };
}

export default async function BlocksPage() {
  // 26 = a primeira página (25) mais o item-sonda que diz se há página seguinte.
  const [blocks, status, nomes] = await Promise.all([
    getBlocks(26).catch(() => []),
    getStatus().catch(() => null),
    getNames().catch(() => []),
  ]);

  // endereço → nome EAV-NS. O primeiro nome vence quando há vários apontando
  // para o mesmo endereço: arbitrário, mas estável entre renderizações.
  const porEndereco: Record<string, string> = {};
  for (const n of nomes ?? []) {
    if (n.target && !porEndereco[n.target]) porEndereco[n.target] = n.name;
  }

  return (
    <BlocksList
      inicial={blocks ?? []}
      altura={status?.height ?? null}
      recompensa={status?.blockReward ?? null}
      nomes={porEndereco}
    />
  );
}
