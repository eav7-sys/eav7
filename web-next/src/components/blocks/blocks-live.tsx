"use client";

import { useT } from "@/i18n/provider";
import { useQuery } from "@tanstack/react-query";
import { getBlocks, getStatus, type Block, type Status } from "@/lib/api";
import { AddrLink, BlockLink } from "@/components/hash-link";
import { Ago } from "@/components/ui/ago";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Reveal } from "@/components/ui/reveal";
import { ExplorerSearch } from "@/components/ui/explorer-search";
import { shortHash } from "@/lib/format";
import { IconLayers, IconPulse, IconTx, IconValidator } from "@/components/icons";

interface BlocksInitial {
  blocks: Block[];
  status: Status | null;
}

// recompensa fixa por bloco: 16 EAV7 (constante até o halving em 126.144.000 blocos)
function reward(): string {
  return "16";
}

function StatCard({
  icon,
  label,
  value,
  chip,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  chip: string;
}) {
  return (
    <div className="card card-lux relative overflow-hidden p-4">
      <div className="flex items-center gap-2">
        <span className={`icon-chip ${chip}`}>{icon}</span>
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[1.5px] text-muted">
          {label}
        </span>
      </div>
      <div className="font-display tnum mt-3 text-[clamp(22px,3vw,30px)] font-extrabold leading-none">
        {value}
      </div>
    </div>
  );
}

export function BlocksLive({ initial }: { initial: BlocksInitial }) {
  const t = useT();
  const COLS = [
    t("blocks_live.columns.block"),
    t("blocks_live.columns.age"),
    t("blocks_live.columns.txs"),
    t("blocks_live.columns.producer"),
    t("blocks_live.columns.reward"),
    t("blocks_live.columns.hash"),
  ];
  const blocksQ = useQuery({
    queryKey: ["blocks", 26],
    queryFn: () => getBlocks(26),
    refetchInterval: 2000,
    initialData: initial.blocks.length ? initial.blocks : undefined,
  });
  const statusQ = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 2000,
    initialData: initial.status ?? undefined,
  });

  const blocks = blocksQ.data ?? [];
  const status = statusQ.data;

  const avgTx =
    blocks.length > 0
      ? Math.round(blocks.reduce((s, b) => s + b.txCount, 0) / blocks.length)
      : 0;
  const producers = new Set(blocks.map((b) => b.producer)).size;

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      {/* cabeçalho */}
      <div className="rise mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
            {t("blocks_live.networkLabel")}
          </div>
          <h1 className="font-display mt-1.5 flex items-center gap-3 text-[clamp(24px,3.6vw,34px)] font-extrabold leading-tight tracking-tight">
            {t("blocks_live.title")}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-panel/70 px-2.5 py-1 text-[11px] font-semibold text-muted">
              <span className="livedot" style={{ width: 6, height: 6 }} /> {t("blocks_live.live")}
            </span>
          </h1>
          <div className="mt-1.5 font-mono text-[12.5px] text-muted">
            {t("blocks_live.blockTimeInfo", { n: status ? status.blockTimeMs / 1000 : 1 })}
          </div>
        </div>
        <ExplorerSearch className="w-full max-w-[380px]" placeholder={t("blocks_live.searchPlaceholder")} />
      </div>

      {/* cards de status */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<IconLayers size={16} />}
          chip="chip-violet"
          label={t("blocks_live.stats.height")}
          value={status ? <AnimatedNumber value={status.height} /> : "—"}
        />
        <StatCard
          icon={<IconPulse size={16} />}
          chip="chip-teal"
          label={t("blocks_live.stats.blockTime")}
          value={status ? `${(status.blockTimeMs / 1000).toFixed(1)}s` : "—"}
        />
        <StatCard
          icon={<IconTx size={16} />}
          chip="chip-blue"
          label={t("blocks_live.stats.avgTx")}
          value={<AnimatedNumber value={avgTx} />}
        />
        <StatCard
          icon={<IconValidator size={16} />}
          chip="chip-gold"
          label={t("blocks_live.stats.activeProducers")}
          value={<AnimatedNumber value={producers} />}
        />
      </div>

      {/* tabela ao vivo */}
      <Reveal>
        <div className="card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-display flex items-center gap-2 text-[14px] font-bold">
              <IconLayers size={16} /> {t("blocks_live.latestBlocks")}
            </h2>
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet" />
              {t("blocks_live.updating")}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th
                      key={c}
                      className="font-mono border-b border-line px-5 py-3 text-[10px] font-semibold uppercase tracking-[1px] text-faint"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {blocks.map((b, i) => (
                  <tr
                    key={b.height}
                    className={`group border-b border-line/40 transition-colors hover:bg-violet/[0.06] ${
                      i === 0 ? "row-enter" : ""
                    }`}
                  >
                    <td className="px-5 py-3">
                      <BlockLink height={b.height} />
                    </td>
                    <td className="tnum px-5 py-3 text-muted">
                      <Ago ts={b.timestamp} />
                    </td>
                    <td className="px-5 py-3">
                      <span className="tnum inline-flex min-w-[26px] justify-center rounded-md bg-line/60 px-1.5 py-0.5 text-[11.5px] font-semibold text-ink">
                        {b.txCount}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <AddrLink addr={b.producer} len={6} />
                    </td>
                    <td className="tnum px-5 py-3 text-ink">
                      {reward()} <span className="text-faint">EAV7</span>
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px] text-teal/80">
                      {shortHash(b.hash ?? b.txRoot, 10, 6)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
