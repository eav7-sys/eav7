"use client";

import { useT } from "@/i18n/provider";
import { useQuery } from "@tanstack/react-query";
import { getValidators, getStatus, type Validators, type Validator, type ValidatorPerf, type ValidatorHealth, type Status } from "@/lib/api";
import { AddrLink } from "@/components/hash-link";
import { Copy } from "@/components/ui/copy";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Reveal } from "@/components/ui/reveal";
import { Identicon } from "./identicon";
import { ancoraIndex, fmt, fmtCompact, num, shortHash } from "@/lib/format";
import { IconValidator, IconReward, IconPulse, IconNetwork } from "@/components/icons";

interface Initial {
  validators: Validators | null;
  status: Status | null;
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

// Cor/rótulo por saúde do validador (score de desempenho derivado da cadeia).
const HEALTH_STYLE: Record<ValidatorHealth, { badge: string; dot: string }> = {
  healthy: { badge: "badge-green", dot: "var(--green,#39d98a)" },
  lagging: { badge: "badge-gold", dot: "var(--gold,#e6b450)" },
  degraded: { badge: "badge-red", dot: "var(--red,#ff5c72)" },
  offline: { badge: "badge-red", dot: "var(--red,#ff5c72)" },
};

function HealthBadge({ perf, label }: { perf: ValidatorPerf; label: string }) {
  const s = HEALTH_STYLE[perf.status];
  return (
    <span className={`badge ${s.badge}`} title={`produtividade ${perf.productivityPct}% · ${perf.missed} slots perdidos${perf.avgLatencyMs != null ? ` · ${perf.avgLatencyMs}ms` : ""}`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} /> {label} · {perf.score}
    </span>
  );
}

export function ValidatorsLive({ initial }: { initial: Initial }) {
  const t = useT();
  const vQ = useQuery({
    queryKey: ["validators"],
    queryFn: getValidators,
    refetchInterval: 3000,
    initialData: initial.validators ?? undefined,
  });
  const sQ = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 1000,
    initialData: initial.status ?? undefined,
  });

  const v = vQ.data;
  const status = sQ.data;

  if (!v) {
    return (
      <div className="mx-auto max-w-[1180px] px-5 py-8">
        <div className="card p-8 text-center text-muted">{t("validators_live.unavailable")}</div>
      </div>
    );
  }

  const producer = status?.producer ?? v.slotProducer;
  // Peso = self-stake + votos recebidos (#4). É o critério de eleição dos 27.
  const weightOf = (x: Validator) => BigInt(x.staked) + BigInt(x.votes ?? "0");
  // Âncoras: lista 1…N; resto por peso (stake igual + sort por addr embaralhava os nomes).
  const sorted = [...v.current].sort((a, b) => {
    const ia = ancoraIndex(a.name);
    const ib = ancoraIndex(b.name);
    if (ia != null && ib != null && ia !== ib) return ia - ib;
    if (ia != null && ib == null) return -1;
    if (ia == null && ib != null) return 1;
    const wa = weightOf(a);
    const wb = weightOf(b);
    return wb > wa ? 1 : wb < wa ? -1 : a.address.localeCompare(b.address);
  });
  const totalStaked = v.current.reduce((s, x) => s + BigInt(x.staked), 0n);
  const totalWeight = v.current.reduce((s, x) => s + weightOf(x), 0n);
  const maxWeight = v.current.reduce((m, x) => (weightOf(x) > m ? weightOf(x) : m), 0n);
  const minStakeEav7 = num(Number(BigInt(v.minStake) / 1_000_000n));
  const rewardEav7 = status ? fmt(status.blockReward) : "—";
  const producerObj = sorted.find((x) => x.address === producer);
  // Desempenho por validador (score derivado da cadeia). Mapa por endereço p/ o ranking.
  const perfByAddr = new Map<string, ValidatorPerf>((v.performance ?? []).map((p) => [p.address, p]));
  const perfSummary = v.performanceSummary;

  return (
    <div className="mx-auto max-w-[1180px] px-5 py-8">
      {/* cabeçalho */}
      <div className="rise mb-6">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
          {t("validators_live.header.eyebrow")}
        </div>
        <h1 className="font-display mt-1.5 flex items-center gap-3 text-[clamp(24px,3.6vw,34px)] font-extrabold leading-tight tracking-tight">
          {t("validators_live.header.title")}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-panel/70 px-2.5 py-1 text-[11px] font-semibold text-muted">
            <span className="livedot" style={{ width: 6, height: 6 }} /> {t("validators_live.header.live")}
          </span>
        </h1>
        <div className="mt-1.5 font-mono text-[12.5px] text-muted">
          {t("validators_live.header.subtitle", {
            active: v.current.length,
            max: v.maxValidators,
            min: minStakeEav7,
          })}
        </div>
      </div>

      {/* produtor atual + stats */}
      <div className="mb-5 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* produtor do slot atual */}
        <Reveal>
          <div className="card card-glow relative h-full overflow-hidden p-6">
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{ background: "radial-gradient(600px 200px at 15% 0%, rgba(69,224,230,.14), transparent 60%)" }}
            />
            <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
              <span className="livedot" style={{ width: 7, height: 7 }} /> {t("validators_live.producer.label")}
            </div>
            <div className="relative mt-4 flex items-center gap-4">
              <Identicon addr={producer} size={56} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display truncate text-[18px] font-extrabold text-ink">
                    {shortHash(producer, 14, 6)}
                  </span>
                  <Copy text={producer} />
                </div>
                <div className="mt-1 font-mono text-[12.5px] text-muted">
                  {t("validators_live.producer.producingBlock")}{" "}
                  <span className="font-semibold text-violet">
                    #{status ? num(status.height + 1) : "—"}
                  </span>
                </div>
              </div>
            </div>
            {/* barra do slot (1s) */}
            <div className="relative mt-5">
              <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-wide text-faint">
                <span>{t("validators_live.slot.label", { n: status ? status.blockTimeMs / 1000 : 1 })}</span>
                <span className="text-muted">
                  {producerObj ? t("validators_live.slot.staked", { n: fmtCompact(producerObj.staked) }) : ""}
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-line/60">
                <div className="slot-fill h-full rounded-full bg-gradient-to-r from-teal to-violet" />
              </div>
            </div>
            {/* rodízio de slots */}
            <div className="relative mt-5">
              <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-faint">
                {t("validators_live.rotation.label")}
              </div>
              <div className="flex flex-wrap gap-2">
                {sorted.map((val) => {
                  const active = val.address === producer;
                  return (
                    <span
                      key={val.address}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-all ${
                        active
                          ? "border-teal/60 bg-teal/15 text-ink"
                          : "border-line-2 bg-panel/50 text-muted"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${active ? "bg-teal shadow-[0_0_8px_var(--teal)]" : "bg-line-2"}`}
                      />
                      {shortHash(val.address, 5, 3)}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </Reveal>

        {/* stats */}
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            icon={<IconValidator size={16} />}
            chip="chip-violet"
            label={t("validators_live.stats.activeValidators")}
            value={<AnimatedNumber value={v.current.length} />}
          />
          <StatCard
            icon={<IconReward size={16} />}
            chip="chip-gold"
            label={t("validators_live.stats.rewardPerBlock")}
            value={<span>{rewardEav7} <span className="text-faint text-[13px]">EAV7</span></span>}
          />
          <StatCard
            icon={<IconNetwork size={16} />}
            chip="chip-teal"
            label={t("validators_live.stats.totalStaked")}
            value={<span>{fmtCompact(totalStaked)} <span className="text-faint text-[13px]">EAV7</span></span>}
          />
          <StatCard
            icon={<IconPulse size={16} />}
            chip="chip-blue"
            label={t("validators_live.stats.peers")}
            value={<AnimatedNumber value={status?.peers ?? 0} />}
          />
        </div>
      </div>

      {/* ranking de validadores */}
      <Reveal>
        <div className="card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-display flex items-center gap-2 text-[14px] font-bold">
              <IconValidator size={16} /> {t("validators_live.ranking.title")}
            </h2>
            {perfSummary && perfSummary.avgScore != null ? (
              <span className="flex items-center gap-2 font-mono text-[11px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--green,#39d98a)" }} />
                  {t("validators_live.health.summary", { avg: perfSummary.avgScore, degraded: perfSummary.degraded })}
                </span>
              </span>
            ) : (
              <span className="font-mono text-[11px] text-muted">{t("validators_live.ranking.sortedBy")}</span>
            )}
          </div>
          {/* Banner de saúde: só aparece quando a IA detecta validador degradado (propose-only). */}
          {perfSummary && perfSummary.degraded > 0 && (
            <div className="flex items-start gap-2 border-b border-line bg-red/[0.06] px-5 py-2.5 font-mono text-[11.5px] text-muted">
              <span className="mt-0.5 inline-block h-2 w-2 flex-none rounded-full" style={{ background: "var(--red,#ff5c72)" }} />
              <span>{t("validators_live.health.degradedBanner", { n: perfSummary.degraded })}</span>
            </div>
          )}
          <div className="divide-y divide-line/50">
            {sorted.map((val, i) => {
              const isProducer = val.address === producer;
              const weight = weightOf(val);
              const votes = BigInt(val.votes ?? "0");
              const share =
                totalWeight > 0n ? Number((weight * 1000n) / totalWeight) / 10 : 0;
              const barPct =
                maxWeight > 0n ? Number((weight * 100n) / maxWeight) : 0;
              return (
                <div
                  key={val.address}
                  className={`flex items-center gap-4 px-5 py-4 transition-colors hover:bg-violet/[0.05] ${
                    isProducer ? "bg-teal/[0.05]" : ""
                  }`}
                >
                  <div className="font-display tnum w-6 flex-none text-center text-[15px] font-extrabold text-faint">
                    {i + 1}
                  </div>
                  <Identicon addr={val.address} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <AddrLink addr={val.address} len={14} />
                      {isProducer ? (
                        <span className="badge badge-teal">
                          <span className="livedot" style={{ width: 5, height: 5 }} /> {t("validators_live.ranking.producing")}
                        </span>
                      ) : (
                        <span className="badge badge-green">{t("validators_live.ranking.active")}</span>
                      )}
                      {perfByAddr.get(val.address) && (
                        <HealthBadge
                          perf={perfByAddr.get(val.address)!}
                          label={t(`validators_live.health.status.${perfByAddr.get(val.address)!.status}`)}
                        />
                      )}
                    </div>
                    {/* barra de stake */}
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-1.5 max-w-[280px] flex-1 overflow-hidden rounded-full bg-line/60">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${barPct}%`,
                            background: isProducer
                              ? "linear-gradient(90deg,var(--teal),var(--violet))"
                              : "linear-gradient(90deg,var(--violet),color-mix(in srgb,var(--violet) 45%,transparent))",
                          }}
                        />
                      </div>
                      <span className="font-mono text-[10.5px] text-faint">{share}%</span>
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <div className="font-display tnum text-[15px] font-bold text-ink">
                      {fmtCompact(val.staked)}
                    </div>
                    <div className="font-mono text-[10.5px] text-faint">{t("validators_live.ranking.stakedCaption")}</div>
                    {votes > 0n && (
                      <div className="mt-1 font-mono text-[10.5px] text-teal">
                        +{fmtCompact(votes)} {t("validators_live.ranking.votesCaption")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
