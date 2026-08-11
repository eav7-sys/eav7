"use client";

import Link from "next/link";
import { Reveal } from "@/components/ui/reveal";
import { IconQuantumKey } from "@/components/icons";
import { useT } from "@/i18n/provider";

export function WalletCta() {
  const t = useT();
  return (
    <section className="relative overflow-hidden pb-24 pt-20 sm:pb-32 sm:pt-28">
      {/* background da seção (Pixabay dark / malha colorida no claro) */}
      <div aria-hidden className="cta-photo pointer-events-none absolute inset-0 z-0" />
      {/* bloco de texto */}
      <Reveal className="relative z-10 mx-auto max-w-[820px] px-5 text-center">
        <div className="font-mono text-[12px] font-semibold uppercase tracking-[3px] text-teal">
          {t("home_walletCta.eyebrow")}
        </div>
        <h2 className="font-display chrome-text mx-auto mt-4 max-w-[16ch] text-[clamp(36px,7vw,72px)] font-extrabold leading-[0.96] tracking-[-0.03em]">
          {t("home_walletCta.title")}
        </h2>
        <p className="mx-auto mt-5 max-w-[54ch] text-[clamp(15px,2vw,18px)] leading-relaxed text-muted">
          {t("home_walletCta.description")}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/wallet" className="btn-primary btn-lg">
            <IconQuantumKey size={17} /> {t("home_walletCta.createWallet")}
          </Link>
          <Link href="/blocks" className="btn-ghost btn-lg">
            {t("home_walletCta.exploreNetwork")}
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
