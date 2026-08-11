"use client";

import Link from "next/link";
import { AddrLink } from "@/components/hash-link";
import { Reveal } from "@/components/ui/reveal";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { numCompact } from "@/lib/format";
import { IconToken, IconValidator, IconReward, IconCode } from "@/components/icons";
import { TokenLogo } from "./token-logo";
import type { TokenSummary } from "@/lib/api";
import { useT } from "@/i18n/provider";

const ACCENTS = ["#9a6cff", "#45e0e6", "#f5c451", "#5ea0ff", "#ff7ac2", "#45d6a0"];

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

function TokenCard({
  token,
  accent,
  maxSupply,
  delay,
}: {
  token: TokenSummary;
  accent: string;
  maxSupply: number;
  delay: number;
}) {
  const t = useT();
  const supply = Number(token.totalSupply) || 0;
  const share = maxSupply > 0 ? Math.round((supply / maxSupply) * 100) : 0;

  return (
    <Reveal delay={delay}>
      <div className="card card-lux group relative h-full overflow-hidden p-5">
        {/* Só a identidade do token é link: o rodapé tem o AddrLink do criador, e
            âncora dentro de âncora é HTML inválido. */}
        <Link href={`/token/${token.id}`} className="relative flex items-center gap-3">
          <span
            className="grid h-12 w-12 flex-none place-items-center rounded-xl text-white"
            style={{
              background: `linear-gradient(140deg, ${accent}, color-mix(in srgb, ${accent} 45%, #1a1826))`,
              boxShadow: `0 8px 22px -8px ${accent}`,
            }}
          >
            <TokenLogo symbol={token.symbol} size={24} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-[17px] font-extrabold text-ink transition-colors group-hover:text-violet">
                {token.symbol}
              </span>
              <span className="rounded-full border border-line-2 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted">
                EAV20
              </span>
            </div>
            <div className="truncate text-[12.5px] text-muted">{token.name}</div>
          </div>
        </Link>

        {/* métricas */}
        <div className="relative mt-5 grid grid-cols-2 gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[1.2px] text-faint">{t("tokens_view.card.supply")}</div>
            <div className="font-display tnum mt-1 text-[16px] font-bold text-ink">
              {numCompact(supply)}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[1.2px] text-faint">{t("tokens_view.card.holders")}</div>
            <div className="font-display tnum mt-1 text-[16px] font-bold text-ink">
              {numCompact(token.holders)}
            </div>
          </div>
        </div>

        {/* barra de participação no suprimento */}
        <div className="relative mt-4">
          <div className="flex items-center justify-between text-[10.5px] text-muted">
            <span className="font-mono uppercase tracking-wide">{t("tokens_view.card.share")}</span>
            <span className="tnum font-semibold text-ink">{share}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${share}%`, background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 55%, transparent))` }}
            />
          </div>
        </div>

        <div className="relative mt-4 flex items-center gap-1.5 border-t border-line/60 pt-3 text-[11.5px] text-muted">
          <span className="font-mono text-faint">{t("tokens_view.card.creator")}</span>
          <AddrLink addr={token.creator} len={6} />
        </div>
      </div>
    </Reveal>
  );
}

export function TokensView({ tokens }: { tokens: TokenSummary[] }) {
  const t = useT();
  const totalHolders = tokens.reduce((s, t) => s + t.holders, 0);
  const totalSupply = tokens.reduce((s, t) => s + (Number(t.totalSupply) || 0), 0);
  const maxSupply = tokens.reduce((m, t) => Math.max(m, Number(t.totalSupply) || 0), 0);

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      {/* cabeçalho */}
      <div className="rise mb-6">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
          {t("tokens_view.header.badge")}
        </div>
        <h1 className="font-display mt-1.5 text-[clamp(24px,3.6vw,34px)] font-extrabold leading-tight tracking-tight">
          {t("tokens_view.header.title")}
        </h1>
        <div className="mt-1.5 font-mono text-[12.5px] text-muted">
          {t("tokens_view.header.subtitle")}
        </div>
      </div>

      {tokens.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
          <span className="icon-chip icon-chip-lg">
            <IconToken size={24} />
          </span>
          <div className="font-display text-[16px] font-bold">{t("tokens_view.empty.title")}</div>
          <p className="max-w-[42ch] text-[13px] text-muted">
            {t("tokens_view.empty.description")}{" "}
            <span className="font-mono text-ink">eav7 token create</span>.
          </p>
        </div>
      ) : (
        <>
          {/* cards de status */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={<IconToken size={16} />}
              chip="chip-violet"
              label={t("tokens_view.stats.tokens")}
              value={<AnimatedNumber value={tokens.length} />}
            />
            <StatCard
              icon={<IconValidator size={16} />}
              chip="chip-teal"
              label={t("tokens_view.stats.holders")}
              value={numCompact(totalHolders)}
            />
            <StatCard
              icon={<IconReward size={16} />}
              chip="chip-gold"
              label={t("tokens_view.stats.supply")}
              value={numCompact(totalSupply)}
            />
            <StatCard
              icon={<IconCode size={16} />}
              chip="chip-blue"
              label={t("tokens_view.stats.standard")}
              value="EAV20"
            />
          </div>

          {/* grid de tokens */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tokens.map((t, i) => (
              <TokenCard
                key={t.id}
                token={t}
                accent={ACCENTS[i % ACCENTS.length]}
                maxSupply={maxSupply}
                delay={i * 70}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
