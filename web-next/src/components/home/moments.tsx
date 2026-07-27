"use client";

import { Reveal } from "@/components/ui/reveal";
import {
  IconQuantumKey,
  IconValidator,
  IconAi,
  IconToken,
  IconBridge,
} from "@/components/icons";
import { QuantumLattice, BlockRing, NeuralOracle, BridgeFlow } from "./banners";
import { useT, type TFunc } from "@/i18n/provider";

interface Moment {
  eyebrow: string;
  title: React.ReactNode;
  desc: string;
  bullets: { icon: React.ReactNode; text: string }[];
  banner: React.ReactNode;
  accent: string;
}

function getMoments(t: TFunc): Moment[] {
  return [
    {
      eyebrow: t("home_moments.items.security.eyebrow"),
      title: (
        <>
          {t("home_moments.items.security.titlePrefix")}{" "}
          <span className="text-teal">{t("home_moments.items.security.titleHighlight")}</span>
        </>
      ),
      desc: t("home_moments.items.security.desc"),
      bullets: [
        { icon: <IconQuantumKey size={15} />, text: t("home_moments.items.security.bullet1") },
        { icon: <IconQuantumKey size={15} />, text: t("home_moments.items.security.bullet2") },
      ],
      banner: <QuantumLattice accent="var(--teal)" />,
      accent: "var(--teal)",
    },
    {
      eyebrow: t("home_moments.items.consensus.eyebrow"),
      title: (
        <>
          {t("home_moments.items.consensus.titlePrefix")}{" "}
          <span className="text-violet">{t("home_moments.items.consensus.titleHighlight")}</span>
        </>
      ),
      desc: t("home_moments.items.consensus.desc"),
      bullets: [
        { icon: <IconValidator size={15} />, text: t("home_moments.items.consensus.bullet1") },
        { icon: <IconValidator size={15} />, text: t("home_moments.items.consensus.bullet2") },
      ],
      banner: <BlockRing accent="var(--violet)" />,
      accent: "var(--violet)",
    },
    {
      eyebrow: t("home_moments.items.intelligence.eyebrow"),
      title: (
        <>
          {t("home_moments.items.intelligence.titlePrefix")}{" "}
          <span className="text-blue">{t("home_moments.items.intelligence.titleHighlight")}</span>
        </>
      ),
      desc: t("home_moments.items.intelligence.desc"),
      bullets: [
        { icon: <IconAi size={15} />, text: t("home_moments.items.intelligence.bullet1") },
        { icon: <IconAi size={15} />, text: t("home_moments.items.intelligence.bullet2") },
      ],
      banner: <NeuralOracle accent="var(--blue)" />,
      accent: "var(--blue)",
    },
    {
      eyebrow: t("home_moments.items.assets.eyebrow"),
      title: (
        <>
          {t("home_moments.items.assets.titlePrefix")}{" "}
          <span className="text-gold">{t("home_moments.items.assets.titleHighlight")}</span>
          {" "}
          {t("home_moments.items.assets.titleSuffix")}
        </>
      ),
      desc: t("home_moments.items.assets.desc"),
      bullets: [
        { icon: <IconToken size={15} />, text: t("home_moments.items.assets.bullet1") },
        { icon: <IconBridge size={15} />, text: t("home_moments.items.assets.bullet2") },
      ],
      banner: <BridgeFlow accent="var(--gold)" />,
      accent: "var(--gold)",
    },
  ];
}

function MomentCard({ eyebrow, title, desc, bullets, banner, accent }: Moment) {
  return (
    <div className="card card-hover card-lux flex h-full flex-col overflow-hidden">
      {banner}
      <div className="flex flex-1 flex-col p-6">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[2px]" style={{ color: accent }}>
          {eyebrow}
        </div>
        <h3 className="font-display mt-2.5 text-[clamp(19px,2.3vw,25px)] font-extrabold leading-tight tracking-tight">
          {title}
        </h3>
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">{desc}</p>
        <ul className="mt-4 flex flex-col gap-2.5">
          {bullets.map((b, i) => (
            <li key={i} className="flex items-center gap-2.5 text-[13px] text-ink">
              <span style={{ color: accent }}>{b.icon}</span>
              {b.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Moments() {
  const t = useT();
  const moments = getMoments(t);
  return (
    <section className="border-b border-line py-14 sm:py-20">
      <div className="mx-auto max-w-[1120px] px-5">
        <Reveal className="mx-auto max-w-[640px] text-center">
          <div className="font-mono text-[12px] font-semibold uppercase tracking-[2px] text-violet">
            {t("home_moments.sectionEyebrow")}
          </div>
          <h2 className="font-display mt-2 text-[clamp(26px,3.8vw,40px)] font-extrabold tracking-tight">
            {t("home_moments.sectionTitle")}
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {moments.map((m, i) => (
            <Reveal key={i} delay={i * 70}>
              <MomentCard {...m} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
