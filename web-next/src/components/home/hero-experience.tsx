"use client";

import Link from "next/link";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { getStatus, type Status } from "@/lib/api";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { NetworkCanvas } from "./network-canvas";
import { useT } from "@/i18n/provider";

function Vital({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="text-center">
      <div className="font-display tnum text-[clamp(22px,3.4vw,30px)] font-extrabold leading-none">
        {value}
      </div>
      <div className="font-mono mt-1.5 text-[10.5px] uppercase tracking-[1.5px] text-muted">
        {label}
      </div>
    </div>
  );
}

export function HeroExperience({ initialStatus }: { initialStatus: Status | null }) {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 2000,
    initialData: initialStatus ?? undefined,
  });

  return (
    <section className="relative flex min-h-[540px] items-center justify-center overflow-hidden border-b border-line">
      {/* orbs de gradiente flutuando (profundidade) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: -20 }}>
        <div className="orb absolute left-[8%] top-[12%] h-72 w-72 rounded-full blur-[80px]" style={{ background: "radial-gradient(circle, rgba(138,92,240,.42), transparent 70%)" }} />
        <div className="orb-rev absolute right-[6%] top-[28%] h-80 w-80 rounded-full blur-[90px]" style={{ background: "radial-gradient(circle, rgba(99,54,196,.42), transparent 70%)" }} />
        <div className="orb absolute bottom-[6%] left-[36%] h-64 w-64 rounded-full blur-[80px]" style={{ background: "radial-gradient(circle, rgba(69,224,230,.2), transparent 70%)", animationDelay: "-8s" }} />
      </div>
      {/* fundo: rede de nós animada */}
      <div className="absolute inset-0 -z-10">
        <NetworkCanvas className="h-full w-full opacity-90" />
      </div>
      {/* glow central */}
      <div
        className="pointer-events-none absolute left-1/2 top-[38%] -z-10 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(99,54,196,.5), transparent 70%)" }}
      />
      {/* vinheta inferior para leitura */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-ground via-ground/70 to-transparent" />

      <div className="hero-in mx-auto max-w-[900px] px-5 py-12 text-center">
        {/* moeda + anel girando */}
        <div
          className="relative mx-auto mb-6 h-[150px] w-[150px] sm:h-[188px] sm:w-[188px]"
          style={{ animationDelay: "0ms" }}
        >
          <div className="coin-ring absolute inset-[-13%] rounded-full" />
          <div
            className="absolute inset-0 -z-10 rounded-full blur-[44px]"
            style={{ background: "radial-gradient(circle, rgba(138,92,240,.6), transparent 70%)" }}
          />
          <Image
            src="/brand/eav7-coin.png"
            alt={t("home_heroExp.hero.coinAlt")}
            width={464}
            height={464}
            priority
            className="coin-float h-full w-full object-contain drop-shadow-[0_22px_50px_rgba(99,54,196,.6)]"
          />
        </div>

        <h1
          className="font-display mx-auto max-w-[15ch] text-[clamp(42px,8.5vw,88px)] font-extrabold leading-[0.95] tracking-[-0.035em]"
          style={{ animationDelay: "80ms" }}
        >
          {t("home_heroExp.hero.titleBefore")} <span className="text-violet">{t("home_heroExp.hero.titleHighlight")}</span>.
        </h1>

        <p
          className="mx-auto mt-6 max-w-[56ch] text-[clamp(15px,2vw,19px)] leading-relaxed text-muted"
          style={{ animationDelay: "150ms" }}
        >
          {t("home_heroExp.hero.subtitle")}
        </p>

        <div
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "220ms" }}
        >
          <Link href="#pulso" className="btn-primary btn-lg">
            {t("home_heroExp.hero.exploreNetwork")}
          </Link>
          <Link href="/wallet" className="btn-ghost btn-lg">
            {t("home_heroExp.hero.openWallet")}
          </Link>
        </div>

        <div
          className="mx-auto mt-9 flex max-w-[560px] items-center justify-around gap-4 rounded-2xl border border-line bg-panel/50 px-6 py-4 backdrop-blur"
          style={{ animationDelay: "300ms" }}
        >
          <Vital value={data ? <AnimatedNumber value={data.height} /> : "—"} label={t("home_heroExp.vitals.height")} />
          <span className="h-8 w-px bg-line-2" />
          <Vital value={data ? `${data.blockTimeMs / 1000}s` : "—"} label={t("home_heroExp.vitals.blockTime")} />
          <span className="h-8 w-px bg-line-2" />
          <Vital value={data ? data.validators : "—"} label={t("home_heroExp.vitals.validators")} />
        </div>
      </div>

      {/* scroll cue */}
      <Link
        href="#pulso"
        className="scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 text-muted"
        aria-label={t("home_heroExp.hero.scrollAriaLabel")}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </Link>
    </section>
  );
}
