"use client";

import Link from "next/link";
import type { Block } from "@/lib/api";
import { Ago } from "@/components/ui/ago";
import { useT } from "@/i18n/provider";

// Cor determinística por produtor — dá identidade visual ao validador.
const COLORS = ["#9a6cff", "#45e0e6", "#45d6a0", "#f5c451", "#ff7ac2", "#5ea0ff", "#b18cff"];
function producerColor(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

// "Batimento de bloco" — tira dos últimos N blocos, o mais novo pulsando.
export function BlockHeartbeat({ blocks }: { blocks: Block[] }) {
  const t = useT();
  const recent = blocks.slice(0, 18);
  const newest = recent[0];

  return (
    <div className="card card-glow flex items-center gap-4 overflow-hidden p-3.5 pl-4">
      <div className="flex items-center gap-2.5 pr-3">
        <span className="livedot" />
        <div className="leading-tight">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-faint">
            {t("home_heartbeat.label")}
          </div>
          <div className="text-[12px] font-bold text-ink">
            {newest ? (
              <>
                {t("home_heartbeat.blockAgoPrefix")} <Ago ts={newest.timestamp} />
              </>
            ) : (
              t("home_heartbeat.noData")
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-1 items-end gap-1.5 overflow-x-auto">
        {recent
          .slice()
          .reverse()
          .map((b, i, arr) => {
            const isNewest = i === arr.length - 1;
            const c = producerColor(b.producer);
            const h = 14 + Math.min(24, b.txCount * 4);
            return (
              <Link
                key={b.height}
                href={`/block/${b.height}`}
                title={t("home_heartbeat.blockTitle", { height: b.height, txCount: b.txCount })}
                className="group relative flex-none"
                style={{ width: 10 }}
              >
                <span
                  className="block rounded-[3px] transition-all group-hover:brightness-125"
                  style={{
                    height: h,
                    background: c,
                    opacity: isNewest ? 1 : 0.35 + (i / arr.length) * 0.5,
                    boxShadow: isNewest ? `0 0 10px ${c}` : "none",
                  }}
                />
              </Link>
            );
          })}
      </div>
      <Link
        href="/blocks"
        className="font-mono flex-none whitespace-nowrap text-[11.5px] font-semibold text-violet transition hover:text-teal"
      >
        {t("home_heartbeat.viewAll")} →
      </Link>
    </div>
  );
}
