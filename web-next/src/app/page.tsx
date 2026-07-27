import { getStatus, getBlocks, getTxs, getValidators, getNetworkStats } from "@/lib/api";
import { HeroWope } from "@/components/home/hero-wope";
import { NetworkStats } from "@/components/home/network-stats";
import { NetworkPulse } from "@/components/home/network-pulse";
import { InkBand } from "@/components/home/ink-band";
import { ExplorerPreview } from "@/components/home/explorer-preview";
import { WalletCta } from "@/components/home/wallet-cta";

export const dynamic = "force-dynamic";

async function loadHome() {
  const [status, blocks, txs, validators, stats] = await Promise.all([
    getStatus().catch(() => null),
    getBlocks(30).catch(() => []),
    getTxs(12).catch(() => null),
    getValidators().catch(() => null),
    getNetworkStats().catch(() => null),
  ]);
  return { status, blocks, txs, validators, stats };
}

export default async function HomePage() {
  const d = await loadHome();

  return (
    <>
      <HeroWope initial={{ status: d.status, blocks: d.blocks }} />
      <NetworkStats initial={d.stats} />
      <NetworkPulse initial={{ status: d.status, blocks: d.blocks, validators: d.validators }} />
      <InkBand />
      <ExplorerPreview initial={{ blocks: d.blocks, txs: d.txs }} />
      <WalletCta />
    </>
  );
}
