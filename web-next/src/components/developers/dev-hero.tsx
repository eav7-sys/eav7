"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useT } from "@/i18n/provider";

const RISE = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0 },
};

/**
 * Primeira dobra do portal: uma composição só. Marca, uma manchete, uma frase,
 * um par de ações — sobre um plano atmosférico que sangra até a borda. Nada de
 * cartões flutuando aqui; a densidade começa na seção seguinte.
 */
export function DevHero() {
  const t = useT();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const planeY = useTransform(scrollYProgress, [0, 1], ["0%", "22%"]);
  const atmosOpacity = useTransform(scrollYProgress, [0, 1], [1, 0.35]);

  const transition = reduced
    ? { duration: 0 }
    : { duration: 0.75, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <section
      ref={ref}
      className="dev-hero relative isolate flex min-h-[84svh] items-center overflow-hidden"
    >
      <motion.div
        aria-hidden
        style={reduced ? undefined : { opacity: atmosOpacity }}
        className="dev-hero-atmos pointer-events-none absolute inset-0 -z-20"
      />
      <motion.div
        aria-hidden
        style={reduced ? undefined : { y: planeY }}
        className="dev-hero-plane pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[50%]"
      >
        <span className="dev-hero-horizon" />
      </motion.div>

      <div className="mx-auto w-full max-w-[1240px] px-5 py-28 sm:py-32">
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: reduced ? 0 : 0.09 } } }}
          className="max-w-[900px]"
        >
          <motion.div variants={RISE} transition={transition} className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-violet to-violet-deep text-[16px] font-extrabold text-white shadow-[0_6px_20px_rgba(99,54,196,0.5)]">
              7
            </span>
            <span className="font-display text-[15px] font-extrabold tracking-[0.16em] text-ink">
              EAV7&nbsp;<span className="text-violet">DEVELOPERS</span>
            </span>
          </motion.div>

          <motion.h1
            variants={RISE}
            transition={transition}
            className="font-display mt-8 text-[clamp(40px,7.4vw,78px)] font-extrabold leading-[0.98] tracking-[-0.03em]"
          >
            {t("dev.hero.titleLead")}{" "}
            <span className="grad-text">{t("dev.hero.titleAccent")}</span>
          </motion.h1>

          <motion.p
            variants={RISE}
            transition={transition}
            className="mt-6 max-w-[58ch] text-[clamp(15px,1.7vw,18px)] leading-relaxed text-muted"
          >
            {t("dev.hero.lede")}
          </motion.p>

          <motion.div variants={RISE} transition={transition} className="mt-9 flex flex-wrap gap-3">
            <Link href="/developers/quickstart" className="btn-primary btn-lg">
              {t("dev.hero.ctaPrimary")}
            </Link>
            <Link href="/developers/api" className="btn-ghost btn-lg">
              {t("dev.hero.ctaSecondary")}
            </Link>
          </motion.div>

          <motion.p
            variants={RISE}
            transition={transition}
            className="font-mono mt-12 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] uppercase tracking-[0.12em] text-faint"
          >
            <span className="text-teal">Chain ID 72020</span>
            <span aria-hidden>·</span>
            <span>{t("dev.hero.factRest")}</span>
            <span aria-hidden>·</span>
            <span>{t("dev.hero.factEavm")}</span>
            <span aria-hidden>·</span>
            <span>{t("dev.hero.factTypes")}</span>
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
