"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  getTxs,
  getStatus,
  getNetworkStats,
  type TxPage,
  type Status,
  type NetworkStats,
} from "@/lib/api";
import { AddrLink, BlockLink, TxLink } from "@/components/hash-link";
import { TxBadge } from "@/components/tx-badge";
import { TxValue } from "@/components/tx-value";
import { Ago } from "@/components/ui/ago";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Reveal } from "@/components/ui/reveal";
import { ExplorerSearch } from "@/components/ui/explorer-search";
import { fmt, fmtCompact } from "@/lib/format";
import { IconTx, IconPulse, IconReward, IconEnergy } from "@/components/icons";
import { useT } from "@/i18n/provider";

interface TxsInitial {
  page: TxPage | null;
  status: Status | null;
  stats: NetworkStats | null;
  before?: number;
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
      <div className="font-display tnum mt-3 text-[clamp(20px,2.7vw,28px)] font-extrabold leading-none">
        {value}
      </div>
    </div>
  );
}

const COL_KEYS = ["hash", "block", "type", "from", "to", "value", "age"] as const;

// taxa média (e7) das txs carregadas
function avgFee(fees: string[]): string {
  if (fees.length === 0) return "0";
  let sum = 0n;
  for (const f of fees) {
    try {
      sum += BigInt(f);
    } catch {
      /* ignore */
    }
  }
  return fmt(sum / BigInt(fees.length));
}

export function TxsLive({ initial }: { initial: TxsInitial }) {
  const t = useT();
  const isLive = initial.before === undefined;

  const pageQ = useQuery({
    queryKey: ["txs", 40, initial.before ?? "head"],
    queryFn: () => getTxs(40, initial.before),
    refetchInterval: isLive ? 2500 : false,
    initialData: initial.page ?? undefined,
  });
  const statusQ = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: isLive ? 2500 : false,
    initialData: initial.status ?? undefined,
  });
  const statsQ = useQuery({
    queryKey: ["netstats"],
    queryFn: getNetworkStats,
    refetchInterval: isLive ? 5000 : false,
    initialData: initial.stats ?? undefined,
  });

  const txs = pageQ.data?.txs ?? [];
  const status = statusQ.data;
  const stats = statsQ.data;
  const nextBefore = pageQ.data?.nextBefore ?? null;

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      {/* cabeçalho */}
      <div className="rise mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
            {t("txs_live.chainLabel")}
          </div>
          <h1 className="font-display mt-1.5 flex items-center gap-3 text-[clamp(24px,3.6vw,34px)] font-extrabold leading-tight tracking-tight">
            {t("txs_live.title")}
            {isLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-panel/70 px-2.5 py-1 text-[11px] font-semibold text-muted">
                <span className="livedot" style={{ width: 6, height: 6 }} /> {t("txs_live.live")}
              </span>
            )}
          </h1>
          <div className="mt-1.5 font-mono text-[12.5px] text-muted">
            {isLive ? t("txs_live.subtitleLive") : t("txs_live.subtitleOlder")}
          </div>
        </div>
        <ExplorerSearch className="w-full max-w-[380px]" placeholder={t("txs_live.searchPlaceholder")} />
      </div>

      {/* cards de status */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<IconTx size={16} />}
          chip="chip-violet"
          label={t("txs_live.stats.totalTx")}
          value={stats ? <AnimatedNumber value={stats.transactions} /> : "—"}
        />
        <StatCard
          icon={<IconPulse size={16} />}
          chip="chip-teal"
          label={t("txs_live.stats.mempool")}
          value={status ? <AnimatedNumber value={status.mempool} /> : "—"}
        />
        {/* `volume` é MONTANTE em e7 — `fmtCompact` divide por UNIT. `numCompact`,
            que serve para CONTAGENS, mostraria os e7 crus como se fossem EAV7. */}
        <StatCard
          icon={<IconReward size={16} />}
          chip="chip-gold"
          label={t("txs_live.stats.volume")}
          value={stats ? fmtCompact(stats.volume) : "—"}
        />
        <StatCard
          icon={<IconEnergy size={16} />}
          chip="chip-blue"
          label={t("txs_live.stats.avgFee")}
          value={<span>{avgFee(txs.map((t) => t.fee))} <span className="text-faint text-[13px]">EAV7</span></span>}
        />
      </div>

      {/* tabela */}
      <Reveal>
        <div className="card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-display flex items-center gap-2 text-[14px] font-bold">
              <IconTx size={16} /> {isLive ? t("txs_live.table.latest") : t("txs_live.table.older")}
            </h2>
            {isLive && (
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet" />
                {t("txs_live.table.updating")}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[12.5px]">
              <thead>
                <tr>
                  {COL_KEYS.map((c) => (
                    <th
                      key={c}
                      className="font-mono border-b border-line px-5 py-3 text-[10px] font-semibold uppercase tracking-[1px] text-faint"
                    >
                      {t(`txs_live.cols.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {txs.map((tx, i) => (
                  <tr
                    key={tx.id}
                    className={`border-b border-line/40 transition-colors hover:bg-violet/[0.06] ${
                      isLive && i === 0 ? "row-enter" : ""
                    }`}
                  >
                    <td className="px-5 py-3">
                      <TxLink id={tx.id} />
                    </td>
                    <td className="px-5 py-3">
                      <BlockLink height={tx.blockHeight} />
                    </td>
                    <td className="px-5 py-3">
                      <TxBadge type={tx.type} />
                    </td>
                    <td className="px-5 py-3">
                      <AddrLink addr={tx.from} len={6} />
                    </td>
                    <td className="px-5 py-3">
                      <AddrLink addr={tx.to} len={6} />
                    </td>
                    <td className="px-5 py-3">
                      <TxValue tx={tx} />
                    </td>
                    <td className="tnum whitespace-nowrap px-5 py-3 text-muted">
                      <Ago ts={tx.timestamp} />
                    </td>
                  </tr>
                ))}
                {txs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted">
                      {t("txs_live.table.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            <span className="font-mono text-[11.5px] text-faint">
              {t("txs_live.table.count", { n: txs.length })}
            </span>
            {nextBefore != null ? (
              <Link href={`/txs?before=${nextBefore}`} className="btn-ghost btn-sm">
                {t("txs_live.table.loadMore")}
              </Link>
            ) : (
              <span className="text-[11.5px] text-muted">{t("txs_live.table.genesis")}</span>
            )}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
