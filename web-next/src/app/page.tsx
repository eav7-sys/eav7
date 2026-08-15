import { getStatus, getBlocks, getTxs, getNetworkStats, getNames } from "@/lib/api";
import { getFreeFloatE7 } from "@/lib/circulating";
import { getMarketPrice, getPriceHistory } from "@/lib/price-market";
import { ScanHome } from "@/components/scan/home";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Tudo em paralelo, e cada um falha por si: uma métrica indisponível não pode
  // levar o explorador inteiro junto — a busca é o que mais importa aqui, e ela
  // não depende de nenhuma destas chamadas.
  const [status, stats, blocks, txs, nomes, freeFloat, price, hist] = await Promise.all([
    getStatus().catch(() => null),
    getNetworkStats().catch(() => null),
    getBlocks(30).catch(() => []),
    getTxs(12).catch(() => null),
    getNames().catch(() => []),
    getFreeFloatE7().catch(() => null),
    Promise.resolve()
      .then(() => getMarketPrice())
      .catch(() => null),
    Promise.resolve()
      .then(() => getPriceHistory("7d"))
      .catch(() => null),
  ]);

  // endereço → nome EAV-NS. Quando um endereço tem mais de um nome apontando
  // para ele, o primeiro vence — é arbitrário, mas estável, e a alternativa
  // (mostrar todos) não cabe numa linha de tabela.
  const porEndereco: Record<string, string> = {};
  for (const n of nomes ?? []) {
    if (n.target && !porEndereco[n.target]) porEndereco[n.target] = n.name;
  }

  const priceWithMcap = price
    ? getMarketPrice({
        circulatingE7: freeFloat ?? (status?.circulating != null ? String(status.circulating) : null),
        circulatingBasis: freeFloat ? "free-float" : status?.circulating != null ? "query" : null,
      })
    : null;

  return (
    <ScanHome
      status={status}
      stats={stats}
      blocks={blocks ?? []}
      txs={txs?.txs ?? []}
      nomes={porEndereco}
      price={priceWithMcap}
      priceHistory={hist?.points}
    />
  );
}
