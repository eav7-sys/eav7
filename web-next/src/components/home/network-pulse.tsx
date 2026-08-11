"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getStatus,
  getBlocks,
  getValidators,
  type Status,
  type Block,
  type Validators,
} from "@/lib/api";
import { fmt, fmtCompact, num } from "@/lib/format";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Reveal } from "@/components/ui/reveal";
import { BlockHeartbeat } from "./block-heartbeat";
import { ActivityBars } from "./activity-bars";
import { SlotsGauge } from "./slots-gauge";
import { useT } from "@/i18n/provider";

function BigStat({
  value,
  label,
  accent,
}: {
  value: React.ReactNode;
  label: string;
  accent: string;
}) {
  return (
    <div className="flex-1">
      <div className="font-display tnum text-[clamp(26px,4.5vw,44px)] font-extrabold leading-none" style={{ color: accent }}>
        {value}
      </div>
      <div className="font-mono mt-2 text-[10.5px] uppercase tracking-[1.5px] text-muted">{label}</div>
    </div>
  );
}

interface PulseInitial {
  status: Status | null;
  blocks: Block[];
  validators: Validators | null;
}

export function NetworkPulse({ initial }: { initial: PulseInitial }) {
  const t = useT();
  const status = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 2000,
    initialData: initial.status ?? undefined,
  });
  const blocks = useQuery({
    queryKey: ["blocks", 30],
    queryFn: () => getBlocks(30),
    refetchInterval: 2000,
    initialData: initial.blocks.length ? initial.blocks : undefined,
  });
  const validators = useQuery({
    queryKey: ["validators"],
    queryFn: getValidators,
    refetchInterval: 6000,
    initialData: initial.validators ?? undefined,
  });

  const s = status.data;
  const blockList = blocks.data ?? [];
  const activity = blockList.slice(0, 30).reverse().map((b) => b.txCount);
  const totalTx = activity.reduce((a, b) => a + b, 0);
  const v = validators.data;

  return (
    <section id="pulso" className="relative scroll-mt-16 overflow-hidden border-b border-line py-12 sm:py-16">
      <div
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[300px] w-[900px] -translate-x-1/2 rounded-full blur-[120px] opacity-60"
        style={{ background: "radial-gradient(circle, rgba(99,54,196,.3), transparent 70%)" }}
      />
      <div className="mx-auto max-w-[1180px] px-5">
        <Reveal className="mx-auto max-w-[640px] text-center">
          <div className="font-mono text-[12px] font-semibold uppercase tracking-[2px] text-violet">
            {t("home_netPulse.eyebrow")}
          </div>
          <h2 className="font-display mt-2 text-[clamp(30px,4.6vw,50px)] font-extrabold tracking-tight">
            {t("home_netPulse.title")}
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            {t("home_netPulse.subtitle")}
          </p>
        </Reveal>

        <Reveal delay={80}>
          <div className="mt-12 flex flex-wrap items-center gap-y-8 rounded-2xl border border-line bg-panel/50 px-8 py-8 backdrop-blur">
            <BigStat value={s ? <AnimatedNumber value={s.height} /> : "—"} label={t("home_netPulse.stats.blockHeight")} accent="var(--violet)" />
            <span className="hidden h-12 w-px bg-line-2 sm:block" />
            <BigStat value={<AnimatedNumber value={totalTx} />} label={t("home_netPulse.stats.txLast30")} accent="var(--teal)" />
            <span className="hidden h-12 w-px bg-line-2 sm:block" />
            <BigStat value={s ? num(s.mempool) : "—"} label={t("home_netPulse.stats.mempool")} accent="var(--pink)" />
            <span className="hidden h-12 w-px bg-line-2 sm:block" />
            <BigStat value={s ? `${fmt(s.blockReward)}` : "—"} label={t("home_netPulse.stats.rewardPerBlock")} accent="var(--gold)" />
          </div>
        </Reveal>

        {blockList.length > 0 && (
          <Reveal delay={120}>
            <div className="mt-5">
              <BlockHeartbeat blocks={blockList} />
            </div>
          </Reveal>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-[2fr_1fr]">
          <Reveal delay={80}>
            <div className="card card-glow h-full p-6">
              <h3 className="font-mono text-[12px] font-semibold uppercase tracking-wide text-muted">
                {t("home_netPulse.activity.title")}
              </h3>
              <div className="font-display tnum mt-1 text-[26px] font-extrabold tracking-tight">
                {num(totalTx)}{" "}
                <span className="text-[12px] font-semibold text-muted">
                  {t("home_netPulse.activity.txInLastBlocks", { n: activity.length || 30 })}
                </span>
              </div>
              <ActivityBars values={activity.length ? activity : [0]} />
            </div>
          </Reveal>
          <Reveal delay={140}>
            <div className="card card-glow flex h-full flex-col justify-center p-6">
              <h3 className="font-mono mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                {t("home_netPulse.slots.title")}
              </h3>
              {v ? (
                <SlotsGauge value={v.current.length} max={v.maxValidators} label={t("home_netPulse.slots.activeValidators")} sublabel={t("home_netPulse.slots.supply", { n: fmtCompact(s?.circulating ?? "0") })} />
              ) : (
                <div className="py-8 text-center text-muted">—</div>
              )}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
