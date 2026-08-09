"use client";

import Link from "next/link";
import { ExplorerSearch } from "@/components/ui/explorer-search";
import { useT } from "@/i18n/provider";
import type { Block, NetworkStats, Status, Tx } from "@/lib/api";
import { StatCards } from "./stat-cards";
import { TxChart, BlocksChart } from "./charts";
import { LatestBlocks, LatestTxs } from "./latest";
import "./tokens.css";

/**
 * A home do EAVScan — porte do desenho `EAVScan.dc.html`.
 *
 * O que mudou em relação à home anterior, e por quê: ela era uma landing de
 * marketing com o explorador escondido abaixo da dobra, e repetia o mesmo dado
 * três vezes (altura no herói, na maquete e no "pulso"). Havia até uma MAQUETE de
 * navegador mostrando uma tabela de blocos, com a tabela real logo abaixo — a
 * página tinha uma foto dela mesma.
 *
 * Agora é o que um explorador é: uma ferramenta de consulta. Busca primeiro,
 * métricas numa faixa, blocos e transações lado a lado. Quem chega no eavscan
 * quer colar um hash, não ser convencido de nada.
 */
export function ScanHome({
  status,
  stats,
  blocks,
  txs,
  nomes,
}: {
  status: Status | null;
  stats: NetworkStats | null;
  blocks: Block[];
  txs: Tx[];
  nomes?: Record<string, string>;
}) {
  const t = useT();

  // Blocos por hora, derivado dos timestamps que já temos — sem chamada nova.
  const blocosPorHora = (() => {
    if (blocks.length < 2) return [];
    const agora = Date.now();
    const baldes = new Array(24).fill(0);
    for (const b of blocks) {
      const h = Math.floor((agora - b.timestamp) / 3_600_000);
      if (h >= 0 && h < 24) baldes[23 - h] += 1;
    }
    return baldes;
  })();

  const exemploBloco = blocks[0]?.height;
  const exemploTx = txs[0]?.id;
  const exemploEndereco = blocks[0]?.producer;

  return (
    <div className="scan">
      <div style={{ background: "var(--scan-glow)" }}>
        <div className="mx-auto max-w-[1280px] px-6 pb-2 pt-16 text-center">
          <h1 className="text-[40px] font-extrabold leading-[1.1] tracking-[-0.02em] text-ink">
            {t("scan.heroTitle")}
          </h1>
          <p className="mt-3 text-[15px] text-muted">{t("scan.heroSub")}</p>

          <div className="mx-auto mt-7 max-w-[760px]">
            <ExplorerSearch hero placeholder={t("scan.searchPh")} buttonLabel={t("scan.searchBtn")} />
          </div>

          {/* Atalhos com dados REAIS da cadeia: um exemplo que não abre nada
              ensina o usuário a desconfiar da ferramenta. Some quando não há. */}
          {exemploBloco != null || exemploTx || exemploEndereco ? (
            <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted">
              <span>{t("scan.tryIt")}</span>
              {exemploBloco != null ? <Atalho href={`/block/${exemploBloco}`}>#{exemploBloco}</Atalho> : null}
              {exemploTx ? <Atalho href={`/tx/${exemploTx}`}>{exemploTx.slice(0, 10)}…</Atalho> : null}
              {exemploEndereco ? (
                <Atalho href={`/address/${exemploEndereco}`}>{exemploEndereco.slice(0, 10)}…</Atalho>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mx-auto max-w-[1280px] px-6 pt-9">
          <StatCards status={status} stats={stats} />

          <div className="scan-split mt-5">
            <TxChart series={stats?.txSeries ?? []} />
            <BlocksChart series={blocosPorHora} />
          </div>

          <div className="scan-split mt-5 pb-12">
            <LatestBlocks
              blocks={blocks.slice(0, 8)}
              blockTimeMs={status?.blockTimeMs}
              blockReward={status?.blockReward}
              nomes={nomes}
            />
            <LatestTxs txs={txs.slice(0, 8)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Atalho({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md bg-[var(--scan-chip)] px-2.5 py-[3px] font-mono text-violet hover:underline"
    >
      {children}
    </Link>
  );
}
