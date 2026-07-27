"use client";

import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n/provider";
import { getStatus, type Status, type Block } from "@/lib/api";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { ExplorerSearch } from "@/components/ui/explorer-search";
import { AppShowcase } from "./app-showcase";

interface HeroInitial {
  status: Status | null;
  blocks: Block[];
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="text-center">
      <div className="font-display tnum text-[clamp(18px,2.6vw,24px)] font-extrabold leading-none text-ink">
        {value}
      </div>
      <div className="font-mono mt-1 text-[9.5px] uppercase tracking-[1.5px] text-muted">{label}</div>
    </div>
  );
}

export function HeroWope({ initial }: { initial: HeroInitial }) {
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: 2000,
    initialData: initial.status ?? undefined,
  });
  const t = useT();

  return (
    <section className="relative isolate z-20 -mt-[72px] overflow-hidden border-b border-line pt-[128px] sm:pt-[168px]">
      {/* fundo: foto cósmica (Pixabay) bem sutil, atrás da aurora — dá profundidade real */}
      <div aria-hidden className="hero-photo pointer-events-none absolute inset-0 z-0" />
      {/* fundo: aurora suave (blobs de gradiente fluindo) */}
      <div aria-hidden className="hero-aurora pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div
          className="aurora-a absolute -left-[12%] -top-[10%] h-[42rem] w-[42rem] rounded-full blur-[120px]"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--violet) 55%, transparent), transparent 66%)" }}
        />
        <div
          className="aurora-b absolute -right-[10%] top-[0%] h-[46rem] w-[46rem] rounded-full blur-[130px]"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--violet-deep) 50%, transparent), transparent 66%)" }}
        />
        <div
          className="aurora-c absolute bottom-[-14%] left-[28%] h-[40rem] w-[40rem] rounded-full blur-[130px]"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--teal) 42%, transparent), transparent 66%)" }}
        />
        <div
          className="aurora-a absolute right-[24%] top-[26%] h-[26rem] w-[26rem] rounded-full blur-[110px]"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--blue) 34%, transparent), transparent 66%)", animationDelay: "-6s" }}
        />
      </div>
      {/* scrim leve só atrás do texto central, pra leitura */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{ background: "radial-gradient(48% 42% at 50% 42%, color-mix(in srgb, var(--ground) 60%, transparent), transparent 72%)" }}
      />

      {/* bloco de texto */}
      <div className="hero-in relative z-30 mx-auto max-w-[900px] px-5 text-center">
        {/* moeda da marca, flutuando */}
        <div className="relative mx-auto mb-5 h-[112px] w-[112px] sm:h-[132px] sm:w-[132px]">
          <div
            className="absolute inset-0 -z-10 rounded-full blur-[38px]"
            style={{ background: "radial-gradient(circle, rgba(138,92,240,.7), transparent 70%)" }}
          />
          <div className="coin-ring absolute inset-[-14%] rounded-full" />
          <Image
            src="/brand/eav7-coin.png"
            alt={t("home_hero.coin_alt")}
            width={396}
            height={396}
            priority
            className="coin-float h-full w-full object-contain drop-shadow-[0_18px_40px_rgba(99,54,196,.6)]"
          />
        </div>

        <h1 className="font-display chrome-text mx-auto mt-2 max-w-[16ch] text-[clamp(40px,8vw,84px)] font-extrabold leading-[0.94] tracking-[-0.035em]">
          {t("home_hero.title")}
        </h1>

        <p className="mx-auto mt-6 max-w-[54ch] text-[clamp(15px,2vw,18px)] leading-relaxed text-muted">
          {t("home_hero.subtitle")}
        </p>

        {/* busca (pill) com autocomplete indexado */}
        <ExplorerSearch
          hero
          placeholder={t("home_hero.search_placeholder")}
          buttonLabel={t("home_hero.search_button")}
          className="mx-auto mt-8 max-w-[560px]"
        />

        {/* vitais */}
        <div className="mx-auto mt-8 grid max-w-[520px] grid-cols-2 items-center gap-y-4 rounded-2xl border border-line bg-panel/40 px-6 py-4 backdrop-blur sm:flex sm:justify-around sm:gap-4 sm:py-3.5">
          <Stat value={data ? <AnimatedNumber value={data.height} /> : "—"} label={t("home_hero.stat_height")} />
          <span className="hidden h-7 w-px bg-line-2 sm:block" />
          <Stat value={data ? `${data.blockTimeMs / 1000}s` : "—"} label={t("home_hero.stat_block")} />
          <span className="hidden h-7 w-px bg-line-2 sm:block" />
          <Stat value={data ? data.validators : "—"} label={t("home_hero.stat_validators")} />
          <span className="hidden h-7 w-px bg-line-2 sm:block" />
          <Stat value={data ? data.mempool : "—"} label={t("home_hero.stat_mempool")} />
        </div>
      </div>

      {/* palco: horizonte + janela do app */}
      <div className="relative mt-14 sm:mt-20">
        <div className="hz-grid" aria-hidden />
        <div className="hz-bloom" style={{ top: "8px" }} aria-hidden />
        <div className="relative z-10 mx-auto max-w-[1080px] px-5">
          <div
            style={{
              transform: "perspective(1800px) rotateX(7deg)",
              transformOrigin: "center top",
            }}
          >
            <AppShowcase initial={initial.blocks} />
          </div>
        </div>
        {/* fade para a próxima seção */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ground to-transparent" />
      </div>
    </section>
  );
}
