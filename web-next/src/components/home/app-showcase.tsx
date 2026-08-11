"use client";

import { useQuery } from "@tanstack/react-query";
import { getBlocks, type Block } from "@/lib/api";
import { Ago } from "@/components/ui/ago";
import { shortHash } from "@/lib/format";
import { IconPulse, IconLayers, IconTx, IconValidator, IconToken } from "@/components/icons";
import { useT } from "@/i18n/provider";

// recompensa fixa por bloco na EAV7 (16 EAV7, até o halving)
function reward(_height: number): string {
  return "16";
}

export function AppShowcase({ initial }: { initial: Block[] }) {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["blocks", 30],
    queryFn: () => getBlocks(30),
    refetchInterval: 2500,
    initialData: initial.length ? initial : undefined,
  });
  const blocks = (data ?? []).slice(0, 7);

  const NAV = [
    { label: t("home_appShowcase.nav.overview"), key: "overview", icon: <IconPulse size={14} /> },
    { label: t("home_appShowcase.nav.blocks"), key: "blocks", active: true, icon: <IconLayers size={14} /> },
    { label: t("home_appShowcase.nav.transactions"), key: "txs", icon: <IconTx size={14} /> },
    { label: t("home_appShowcase.nav.validators"), key: "validators", icon: <IconValidator size={14} /> },
    { label: t("home_appShowcase.nav.tokens"), key: "tokens", icon: <IconToken size={14} /> },
  ];

  const COLS = [
    t("home_appShowcase.cols.block"),
    t("home_appShowcase.cols.age"),
    t("home_appShowcase.cols.txs"),
    t("home_appShowcase.cols.producer"),
    t("home_appShowcase.cols.reward"),
    t("home_appShowcase.cols.hash"),
  ];

  return (
    <div className="app-window w-full">
      {/* barra de título */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="mx-auto flex items-center gap-2 rounded-lg border border-line bg-ground/60 px-3 py-1 text-[11.5px] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-[#45d6a0] shadow-[0_0_8px_#45d6a0]" />
          eavscan.com/explorer
        </div>
        <div className="hidden w-[52px] sm:block" />
      </div>

      <div className="flex">
        {/* sidebar */}
        <aside className="hidden w-[176px] flex-none border-r border-line p-3 sm:block">
          <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-faint">
            {t("home_appShowcase.sidebar.explore")}
          </div>
          <nav className="space-y-0.5">
            {NAV.map((n) => (
              <div
                key={n.key}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] ${
                  n.active ? "bg-violet/15 font-semibold text-ink" : "text-muted"
                }`}
              >
                <span className={n.active ? "text-violet" : "text-faint"}>{n.icon}</span>
                {n.label}
              </div>
            ))}
          </nav>
          <div className="mt-4 rounded-xl border border-line bg-ground/50 p-3">
            <div className="text-[10px] uppercase tracking-[1.5px] text-faint">{t("home_appShowcase.sidebar.network")}</div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-[#45d6a0] shadow-[0_0_8px_#45d6a0]" />
              EAV7 Mainnet
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-muted">chain 72020 · 1s</div>
          </div>
        </aside>

        {/* conteúdo */}
        <div className="min-w-0 flex-1">
          {/* toolbar */}
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-ground/50 px-2.5 py-1 text-[11.5px] font-semibold text-ink">
              🇧🇷 EAV7 Mainnet
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>
            </div>
            <div className="rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-muted">{t("home_appShowcase.toolbar.filter")}</div>
            <div className="rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-muted">{t("home_appShowcase.toolbar.sort")}</div>
            <div className="ml-auto hidden items-center gap-1.5 text-[11.5px] text-muted sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet" />
              {t("home_appShowcase.toolbar.live")}
            </div>
          </div>

          {/* tabela */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[12.5px]">
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th
                      key={c}
                      className="border-b border-line px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[1px] text-faint"
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
                    className={`border-b border-line/50 transition-colors hover:bg-violet/[0.05] ${
                      i === 0 ? "row-enter bg-violet/[0.05]" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5 font-semibold text-violet">
                      <span className="inline-flex items-center gap-1.5">
                        {i === 0 && (
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet shadow-[0_0_6px_var(--violet)]" />
                        )}
                        #{b.height.toLocaleString("pt-BR")}
                      </span>
                    </td>
                    <td className="tnum px-4 py-2.5 text-muted">
                      <Ago ts={b.timestamp} />
                    </td>
                    <td className="tnum px-4 py-2.5 text-ink">{b.txCount}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-muted">
                      {shortHash(b.producer, 6, 4)}
                    </td>
                    <td className="tnum px-4 py-2.5 text-ink">
                      {reward(b.height)} <span className="text-faint">EAV7</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-teal/80">
                      {shortHash(b.hash ?? b.txRoot, 8, 4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
