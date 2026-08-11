"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getBlocks, getTxs, type Block, type TxPage } from "@/lib/api";
import { Reveal } from "@/components/ui/reveal";
import { LatestBlocks } from "./latest-blocks";
import { LatestTxs } from "./latest-txs";
import { useT } from "@/i18n/provider";

interface ExplorerInitial {
  blocks: Block[];
  txs: TxPage | null;
}

export function ExplorerPreview({ initial }: { initial: ExplorerInitial }) {
  const t = useT();
  const blocks = useQuery({
    queryKey: ["blocks", 30],
    queryFn: () => getBlocks(30),
    refetchInterval: 2500,
    initialData: initial.blocks.length ? initial.blocks : undefined,
  });
  const txs = useQuery({
    queryKey: ["txs", 12],
    queryFn: () => getTxs(12),
    refetchInterval: 2500,
    initialData: initial.txs ?? undefined,
  });

  return (
    <section className="border-b border-line py-12 sm:py-16">
      <div className="mx-auto max-w-[1180px] px-5">
        <Reveal className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[12px] font-semibold uppercase tracking-[2px] text-violet">
              {t("home_explorerPreview.eyebrow")}
            </div>
            <h2 className="font-display mt-2 text-[clamp(28px,4vw,44px)] font-extrabold tracking-tight">
              {t("home_explorerPreview.title")}
            </h2>
            <p className="mt-2 max-w-[52ch] text-[15px] text-muted">
              {t("home_explorerPreview.description")}
            </p>
          </div>
          <div className="flex gap-2.5">
            <Link href="/blocks" className="btn-ghost">
              {t("home_explorerPreview.viewBlocks")}
            </Link>
            <Link href="/txs" className="btn-ghost">
              {t("home_explorerPreview.viewTxs")}
            </Link>
          </div>
        </Reveal>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <Reveal>
            <LatestBlocks blocks={blocks.data ?? []} />
          </Reveal>
          <Reveal delay={100}>
            <LatestTxs txs={txs.data?.txs ?? []} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
