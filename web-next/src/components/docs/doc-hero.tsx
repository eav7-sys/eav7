"use client";

import Link from "next/link";
import { useT } from "@/i18n/provider";
import { EavmConnect } from "./eavm-connect";
import { ApiReference } from "./api-reference";
import {
  IconPulse,
  IconValidator,
  IconQuantumKey,
  IconNetwork,
  IconBridge,
  IconToken,
  IconArrowUpRight,
  IconEnergy,
  IconReward,
  IconWallet,
} from "@/components/icons";

function Tile({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="card p-4">
      <span className="text-violet">{icon}</span>
      <div className="font-display mt-2 text-[18px] font-extrabold leading-none text-ink">{value}</div>
      <div className="font-mono mt-1 text-[10px] uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
}

/* ---- Sobre ---- */
function SobreHero() {
  const t = useT();
  const pilares = [
    { href: "/docs/consenso", label: t("docs_hero.sobre.pillar_consensus"), icon: <IconValidator size={15} /> },
    { href: "/docs/token", label: t("docs_hero.sobre.pillar_token_standard"), icon: <IconToken size={15} /> },
    { href: "/docs/ponte", label: t("docs_hero.sobre.pillar_bridge"), icon: <IconBridge size={15} /> },
    { href: "/docs/seguranca", label: t("docs_hero.sobre.pillar_security"), icon: <IconQuantumKey size={15} /> },
    { href: "/docs/eavm", label: t("docs_hero.sobre.pillar_eavm"), icon: <IconWallet size={15} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile icon={<IconNetwork size={20} />} value="72020" label="chain id" />
        <Tile icon={<IconPulse size={20} />} value="1s" label={t("docs_hero.sobre.stat_block_time")} />
        <Tile icon={<IconValidator size={20} />} value={t("docs_hero.sobre.stat_validators_value")} label={t("docs_hero.sobre.stat_validators_label")} />
        <Tile icon={<IconToken size={20} />} value={t("docs_hero.sobre.stat_supply_value")} label={t("docs_hero.sobre.stat_supply_label")} />
        <Tile icon={<IconReward size={20} />} value="16" label={t("docs_hero.sobre.stat_reward_label")} />
        <Tile icon={<IconQuantumKey size={20} />} value={t("docs_hero.sobre.stat_quantum_value")} label={t("docs_hero.sobre.stat_quantum_label")} />
      </div>

      {/* pilares navegáveis */}
      <div className="card p-5">
        <div className="font-mono mb-3 text-[10px] font-semibold uppercase tracking-[1.5px] text-faint">
          {t("docs_hero.sobre.pillars_title")}
        </div>
        <div className="flex flex-wrap gap-2">
          {pilares.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="group inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel/50 px-3.5 py-1.5 text-[12.5px] font-semibold text-muted transition hover:border-violet/50 hover:text-ink"
            >
              <span className="text-violet">{p.icon}</span>
              {p.label}
              <IconArrowUpRight size={13} className="-translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-70" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---- Padrão EAV20 (token) ---- */
function TokenHero() {
  const t = useT();
  const ops = ["create", "transfer", "approve", "transferFrom", "balanceOf", "totalSupply"];
  return (
    <div className="card card-glow relative overflow-hidden p-6 sm:p-7">
      <div
        className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full blur-[90px]"
        style={{ background: "radial-gradient(circle, rgba(245,196,81,.26), transparent 70%)" }}
      />
      <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-gold">
        <IconToken size={14} /> {t("docs_hero.token.badge")}
      </div>
      <h2 className="font-display relative mt-3 text-[clamp(20px,3vw,26px)] font-extrabold tracking-tight">
        {t("docs_hero.token.title")}
      </h2>
      <p className="relative mt-2 max-w-[56ch] text-[14px] leading-relaxed text-muted">
        {t("docs_hero.token.description")}
      </p>
      <div className="relative mt-4 flex flex-wrap gap-2">
        {ops.map((o) => (
          <span
            key={o}
            className="font-mono rounded-full border border-line-2 bg-panel/50 px-3 py-1 text-[11.5px] text-muted"
          >
            {o}
          </span>
        ))}
      </div>
      <div className="relative mt-5">
        <Link href="/tokens" className="btn-ghost btn-sm">
          {t("docs_hero.token.cta")} <IconArrowUpRight size={14} />
        </Link>
      </div>
    </div>
  );
}

/* ---- Consenso DPoS & nós ---- */
const SLOT_COLORS = ["var(--violet)", "var(--teal)", "var(--gold)"];

function ConsensoHero() {
  const t = useT();
  const slots = [0, 1, 2, 3, 4];
  const facts: Array<[string, string]> = [
    [t("docs_hero.consenso.fact_election_label"), t("docs_hero.consenso.fact_election_value")],
    [t("docs_hero.consenso.fact_production_label"), t("docs_hero.consenso.fact_production_value")],
    [t("docs_hero.consenso.fact_fork_choice_label"), t("docs_hero.consenso.fact_fork_choice_value")],
  ];
  return (
    <div className="card card-glow relative overflow-hidden p-6 sm:p-8">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ background: "radial-gradient(560px 200px at 12% 0%, rgba(154,108,255,.14), transparent 60%)" }}
      />
      <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-violet">
        <IconValidator size={14} /> {t("docs_hero.consenso.badge")}
      </div>
      <h2 className="font-display relative mt-3 text-[clamp(20px,3vw,26px)] font-extrabold tracking-tight">
        {t("docs_hero.consenso.title")}
      </h2>
      <p className="relative mt-2 max-w-[58ch] text-[14px] leading-relaxed text-muted">
        {t("docs_hero.consenso.description")}
      </p>

      {/* rodízio de slots → produtores */}
      <div className="relative mt-6 flex items-stretch gap-2 overflow-x-auto pb-1">
        {slots.map((s) => {
          const color = SLOT_COLORS[s % SLOT_COLORS.length];
          const active = s === 0;
          return (
            <div
              key={s}
              className={`flex min-w-[104px] flex-1 flex-col items-center gap-2 rounded-xl border px-3 py-3 ${
                active ? "border-violet/50 bg-violet/[0.07]" : "border-line bg-panel/40"
              }`}
            >
              <span className="font-mono text-[10px] uppercase tracking-wide text-faint">
                {active ? t("docs_hero.consenso.slot_now") : t("docs_hero.consenso.slot_offset", { n: s })}
              </span>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M12 2.6l8.1 4.7v9.4L12 21.4 3.9 16.7V7.3z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="2.3" fill={color} />
              </svg>
              <span className="font-mono text-[11px] font-semibold" style={{ color }}>
                V{(s % 3) + 1}
              </span>
            </div>
          );
        })}
      </div>

      {/* fatos */}
      <div className="relative mt-5 grid gap-3 border-t border-line/60 pt-4 sm:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k}>
            <div className="font-mono text-[10px] uppercase tracking-wide text-faint">{k}</div>
            <div className="mt-1 text-[13px] text-ink">{v}</div>
          </div>
        ))}
      </div>

      <div className="relative mt-5">
        <Link href="/validators" className="btn-ghost btn-sm">
          <IconValidator size={15} /> {t("docs_hero.consenso.cta")} <IconArrowUpRight size={14} />
        </Link>
      </div>
    </div>
  );
}

/* ---- Ponte cross-chain ---- */
function BridgeNode({
  icon,
  label,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span style={{ color, filter: `drop-shadow(0 6px 16px color-mix(in srgb, ${color} 45%, transparent))` }}>
        {icon}
      </span>
      <span className="text-[12px] font-semibold text-ink">{label}</span>
    </div>
  );
}

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 px-1">
      <span className="font-mono text-[9.5px] uppercase tracking-wide text-faint">{label}</span>
      <div className="flex w-full items-center">
        <span className="h-px flex-1 bg-gradient-to-r from-violet/40 to-teal/40" />
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2.5" strokeLinecap="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </div>
    </div>
  );
}

function PonteHero() {
  const t = useT();
  const chains = ["TRON", "Ethereum", "Bitcoin", "BNB"];
  const steps: Array<[string, string, string]> = [
    ["BRIDGE_OUT", t("docs_hero.ponte.step_bridge_out"), "var(--violet)"],
    ["Relayer", t("docs_hero.ponte.step_relayer"), "var(--teal)"],
    ["BRIDGE_SETTLE", t("docs_hero.ponte.step_bridge_settle"), "var(--gold)"],
    ["BRIDGE_IN", t("docs_hero.ponte.step_bridge_in"), "var(--blue)"],
  ];
  return (
    <div className="card relative overflow-hidden p-6 sm:p-8">
      <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
        <IconBridge size={14} /> lock-and-release
      </div>
      <h2 className="font-display relative mt-3 text-[clamp(20px,3vw,26px)] font-extrabold tracking-tight">
        {t("docs_hero.ponte.title")}
      </h2>

      {/* redes suportadas */}
      <div className="relative mt-3 flex flex-wrap gap-2 text-[11px]">
        {chains.map((c) => (
          <span key={c} className="rounded-full border border-line-2 bg-panel/50 px-3 py-1 font-semibold text-muted">
            {c}
          </span>
        ))}
      </div>

      {/* fluxo */}
      <div className="relative mt-6 flex items-center justify-between gap-2">
        <BridgeNode icon={<IconNetwork size={26} />} label="EAV7" color="var(--violet)" />
        <Arrow label="BRIDGE_OUT" />
        <BridgeNode icon={<IconPulse size={26} />} label="Relayer" color="var(--teal)" />
        <Arrow label={t("docs_hero.ponte.arrow_pays")} />
        <BridgeNode icon={<IconBridge size={26} />} label={t("docs_hero.ponte.node_external")} color="var(--gold)" />
      </div>

      {/* passos */}
      <div className="relative mt-6 grid gap-2 border-t border-line/60 pt-4 sm:grid-cols-2">
        {steps.map(([k, v, color]) => (
          <div key={k} className="flex items-start gap-2.5">
            <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full" style={{ background: color }} />
            <div>
              <span className="font-mono text-[11.5px] font-semibold text-ink">{k}</span>
              <span className="ml-2 text-[12.5px] text-muted">{v}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Segurança & IA ---- */
function KeyChip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="font-mono inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold"
      style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}
    >
      <IconQuantumKey size={13} /> {label}
    </span>
  );
}

function SegurancaHero() {
  const t = useT();
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* dupla assinatura */}
      <div className="card card-glow relative overflow-hidden p-6">
        <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-violet">
          <IconQuantumKey size={14} /> {t("docs_hero.seguranca.badge_hybrid")}
        </div>
        <h3 className="font-display relative mt-3 text-[16px] font-bold">{t("docs_hero.seguranca.title_hybrid")}</h3>
        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          <KeyChip label="secp256k1" color="var(--violet)" />
          <span className="text-faint">+</span>
          <KeyChip label="ML-DSA-44" color="var(--teal)" />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-ok/12 px-2.5 py-1.5 text-[11.5px] font-semibold text-ok">
            <IconQuantumKey size={13} /> {t("docs_hero.seguranca.verify_both")}
          </span>
        </div>
        <p className="relative mt-3 text-[13px] leading-relaxed text-muted">
          {t("docs_hero.seguranca.hybrid_description")}
        </p>
      </div>

      {/* camada de IA — 6 fases */}
      <div className="card relative overflow-hidden p-6">
        <div className="relative flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
          <IconEnergy size={14} /> {t("docs_hero.seguranca.badge_ai")}
        </div>
        <h3 className="font-display relative mt-3 text-[16px] font-bold">{t("docs_hero.seguranca.title_ai")}</h3>
        <div className="relative mt-4 flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <span
              key={n}
              className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-panel/60 px-2.5 py-1 font-mono text-[10.5px] text-muted"
            >
              <span className="font-bold text-teal">{n}</span> {t(`docs_hero.seguranca.phase${n}`)}
            </span>
          ))}
        </div>
        <p className="relative mt-3 text-[13px] leading-relaxed text-muted">
          {t("docs_hero.seguranca.ai_description")}
        </p>
      </div>

      {/* sentinela 24h — faixa */}
      <div className="card relative overflow-hidden p-5 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex-none text-ok" style={{ filter: "drop-shadow(0 0 6px color-mix(in srgb, var(--ok) 60%, transparent))" }}>
            <IconPulse size={30} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] font-bold text-ink">{t("docs_hero.seguranca.sentinel_title")}</div>
            <p className="mt-1 text-[13px] text-muted">
              {t("docs_hero.seguranca.sentinel_description")}
            </p>
          </div>
          <Link href="/mining" className="btn-ghost btn-sm flex-none">
            {t("docs_hero.seguranca.sentinel_cta")} <IconArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ---- Staking & recompensas ---- */
function TierCard({
  tier,
  color,
  icon,
  title,
  desc,
}: {
  tier: string;
  color: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="card relative h-full overflow-hidden p-5">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
      <div className="flex items-center justify-between">
        <span style={{ color }}>{icon}</span>
        <span
          className="font-mono rounded-full border px-2.5 py-1 text-[11px] font-bold"
          style={{ color, borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}
        >
          {tier}
        </span>
      </div>
      <div className="font-display mt-3 text-[17px] font-bold text-ink">{title}</div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{desc}</p>
    </div>
  );
}

function StakingHero() {
  const t = useT();
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <TierCard
          tier="≥ 100 EAV7"
          color="var(--teal)"
          icon={<IconEnergy size={26} />}
          title={t("docs_hero.staking.tier_fee_title")}
          desc={t("docs_hero.staking.tier_fee_desc")}
        />
        <TierCard
          tier="≥ 1.000 EAV7"
          color="var(--violet)"
          icon={<IconValidator size={26} />}
          title={t("docs_hero.staking.tier_mine_title")}
          desc={t("docs_hero.staking.tier_mine_desc")}
        />
      </div>

      <div className="card relative overflow-hidden p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <IconReward size={30} className="flex-none text-gold" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] font-bold text-ink">{t("docs_hero.staking.reward_title")}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {t("docs_hero.staking.reward_desc")}
            </p>
          </div>
          <div className="flex flex-none flex-wrap gap-2">
            <Link href="/wallet" className="btn-primary btn-sm">
              <IconWallet size={15} /> {t("docs_hero.staking.cta_lock")}
            </Link>
            <Link href="/mining" className="btn-ghost btn-sm">
              {t("docs_hero.staking.cta_mining")} <IconArrowUpRight size={13} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const HEROES: Record<string, () => React.ReactNode> = {
  sobre: SobreHero,
  token: TokenHero,
  staking: StakingHero,
  consenso: ConsensoHero,
  ponte: PonteHero,
  seguranca: SegurancaHero,
  api: ApiReference,
  eavm: EavmConnect,
};

export function DocHero({ slug }: { slug: string }) {
  const Hero = HEROES[slug];
  if (!Hero) return null;
  return (
    <div className="rise mb-6">
      <Hero />
    </div>
  );
}
