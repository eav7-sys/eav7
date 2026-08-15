"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n/provider";
import { getStatus, getValidators, type Status, type Validators } from "@/lib/api";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Reveal } from "@/components/ui/reveal";
import { ListaShell } from "@/components/scan/lists/table";
import { fmt, fmtCompact } from "@/lib/format";
import {
  IconReward,
  IconLayers,
  IconEnergy,
  IconQuantumKey,
  IconValidator,
  IconPulse,
  IconNetwork,
} from "@/components/icons";

interface Initial {
  status: Status | null;
  validators: Validators | null;
}

const BLOCKS_PER_DAY = 86_400; // blocos de 1s

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

export function MiningLive({ initial }: { initial: Initial }) {
  const t = useT();
  const sQ = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 1500,
    initialData: initial.status ?? undefined,
  });
  const vQ = useQuery({
    queryKey: ["validators"],
    queryFn: getValidators,
    refetchInterval: 4000,
    initialData: initial.validators ?? undefined,
  });

  const status = sQ.data;
  const v = vQ.data;

  const rewardE7 = status ? BigInt(status.blockReward) : 0n;
  const dailyE7 = rewardE7 * BigInt(BLOCKS_PER_DAY);
  const annualE7 = dailyE7 * 365n;
  const totalStaked = v ? v.current.reduce((s, x) => s + BigInt(x.staked), 0n) : 0n;

  return (
    <ListaShell
      titulo={t("mining_live.title")}
      eyebrow={t("mining_live.badge_consensus")}
      subtitle={<span className="font-mono text-[12.5px]">{t("mining_live.subtitle")}</span>}
      live
      titleExtra={
        <span className="ml-3 inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-panel/70 px-2.5 py-1 align-middle text-[11px] font-semibold tracking-normal text-muted">
          <span className="livedot" style={{ width: 6, height: 6 }} /> {t("mining_live.live_badge")}
        </span>
      }
    >
      {/* cards de emissão */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<IconReward size={16} />}
          chip="chip-gold"
          label={t("mining_live.stat_reward_block")}
          value={<span>{status ? fmt(status.blockReward) : "—"} <span className="text-faint text-[13px]">EAV7</span></span>}
        />
        <StatCard
          icon={<IconLayers size={16} />}
          chip="chip-violet"
          label={t("mining_live.stat_blocks_day")}
          value={<AnimatedNumber value={BLOCKS_PER_DAY} />}
        />
        <StatCard
          icon={<IconEnergy size={16} />}
          chip="chip-teal"
          label={t("mining_live.stat_daily_emission")}
          value={<span>{fmtCompact(dailyE7)} <span className="text-faint text-[13px]">EAV7</span></span>}
        />
        <StatCard
          icon={<IconNetwork size={16} />}
          chip="chip-blue"
          label={t("mining_live.stat_already_mined")}
          value={<span>{status ? fmtCompact(status.minted) : "—"} <span className="text-faint text-[13px]">EAV7</span></span>}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        {/* produção da rede */}
        <Reveal>
          <div className="card card-glow relative h-full overflow-hidden p-6">
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{ background: "radial-gradient(560px 200px at 12% 0%, rgba(245,196,81,.12), transparent 60%)" }}
            />
            <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-gold">
              <IconReward size={14} /> {t("mining_live.network_production")}
            </div>
            <div className="relative mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
              <div>
                <div className="font-display tnum text-[clamp(30px,5vw,46px)] font-extrabold leading-none">
                  {status ? fmt(status.blockReward) : "—"}
                  <span className="ml-1 text-[16px] font-bold text-muted">EAV7</span>
                </div>
                <div className="mt-1.5 font-mono text-[11px] uppercase tracking-wide text-faint">
                  {t("mining_live.reward_per_block_caption")}
                </div>
              </div>
              <div className="h-10 w-px bg-line-2" />
              <div>
                <div className="font-display tnum text-[22px] font-bold text-ink">
                  {fmtCompact(annualE7)} <span className="text-[13px] text-muted">EAV7</span>
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-faint">
                  {t("mining_live.annual_emission_caption")}
                </div>
              </div>
            </div>

            {/* barra de bloco ao vivo */}
            <div className="relative mt-6">
              <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-wide text-faint">
                <span>{t("mining_live.next_block")}</span>
                <span className="text-violet">#{status ? (status.height + 1).toLocaleString("pt-BR") : "—"}</span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-line/60">
                <div className="slot-fill h-full rounded-full bg-gradient-to-r from-gold to-violet" />
              </div>
            </div>

            <div className="relative mt-5 grid grid-cols-3 gap-3 border-t border-line/60 pt-4">
              <div>
                <div className="font-display tnum text-[18px] font-bold text-ink">
                  {v ? v.current.length : "—"}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wide text-faint">{t("mining_live.miners_label")}</div>
              </div>
              <div>
                <div className="font-display tnum text-[18px] font-bold text-ink">
                  {fmtCompact(totalStaked)}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wide text-faint">{t("mining_live.staked_label")}</div>
              </div>
              <div>
                <div className="font-display tnum text-[18px] font-bold text-ink">
                  {status ? status.blockTimeMs / 1000 : 1}s
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wide text-faint">{t("mining_live.block_time_label")}</div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* sentinela de segurança IA 24h */}
        <Reveal delay={80}>
          <div className="card relative h-full overflow-hidden p-6">
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{ background: "radial-gradient(500px 220px at 85% 0%, rgba(69,214,160,.14), transparent 60%)" }}
            />
            <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-ok">
              <span className="livedot" style={{ width: 7, height: 7, background: "var(--ok)" }} /> {t("mining_live.ai_sentinel_badge")}
            </div>

            <div className="relative mt-4 flex items-center gap-3.5">
              <IconQuantumKey size={38} className="flex-none text-ok" />
              <div>
                <div className="font-display text-[15px] font-bold text-ink">{t("mining_live.network_protected")}</div>
                <div className="text-[12.5px] text-muted">{t("mining_live.ai_monitoring_desc")}</div>
              </div>
            </div>

            <div className="relative mt-5 space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-line bg-panel/50 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-[12.5px] text-muted">
                  <IconPulse size={14} className="text-ok" /> {t("mining_live.alerts_analyzed")}
                </span>
                <span className="font-display tnum text-[15px] font-bold text-ink">
                  <AnimatedNumber value={status?.security.alerts ?? 0} />
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-panel/50 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-[12.5px] text-muted">
                  <IconNetwork size={14} className="text-teal" /> {t("mining_live.active_oracles")}
                </span>
                <span className="font-display tnum text-[15px] font-bold text-ink">
                  <AnimatedNumber value={status?.ai.oracles ?? 0} />
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-line bg-panel/50 px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-[12.5px] text-muted">
                  <IconEnergy size={14} className="text-gold" /> {t("mining_live.pending_ai_tasks")}
                </span>
                <span className="font-display tnum text-[15px] font-bold text-ink">
                  <AnimatedNumber value={status?.ai.pendingTasks ?? 0} />
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      {/* comece a minerar */}
      <Reveal>
        <div className="card relative mt-4 overflow-hidden p-6 sm:p-8">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full blur-[90px]"
            style={{ background: "radial-gradient(circle, rgba(99,54,196,.4), transparent 70%)" }}
          />
          <div className="relative flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div className="max-w-[560px]">
              <h2 className="font-display text-[clamp(20px,3vw,28px)] font-extrabold tracking-tight">
                {t("mining_live.cta_title")}
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">
                {t("mining_live.cta_description")}
              </p>
            </div>
            <div className="flex flex-none flex-wrap gap-3">
              <Link href="/wallet" className="btn-primary btn-lg">
                <IconQuantumKey size={17} /> {t("mining_live.cta_lock_button")}
              </Link>
              <Link href="/validators" className="btn-ghost btn-lg">
                <IconValidator size={16} /> {t("mining_live.cta_view_validators")}
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </ListaShell>
  );
}
