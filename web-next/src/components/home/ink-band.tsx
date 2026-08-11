"use client";

import { useSyncExternalStore } from "react";
import InkReveal from "@/components/ui/ink-reveal";
import { useT } from "@/i18n/provider";

function useIsLight(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mo = new MutationObserver(cb);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => mo.disconnect();
    },
    () => document.documentElement.getAttribute("data-theme") === "light",
    () => false
  );
}

export function InkBand() {
  const t = useT();
  const light = useIsLight();

  const artBg = light
    ? "radial-gradient(120% 120% at 50% 12%, color-mix(in srgb, var(--violet) 18%, #ffffff), #f2f0fa)"
    : "radial-gradient(120% 120% at 50% 12%, color-mix(in srgb, var(--violet) 34%, #0c0b13), #0c0b13)";
  const gridColor = light ? "rgba(35,32,50,.06)" : "rgba(255,255,255,.06)";
  // cor da "tinta" que cobre a arte (combina com o fundo da arte)
  const mask: [number, number, number] = light ? [242, 240, 250] : [12, 11, 19];

  return (
    <section className="border-b border-line py-12 sm:py-16">
      <div className="mx-auto max-w-[1120px] px-5">
        <div className="mb-5 text-center">
          <div className="font-mono text-[12px] font-semibold uppercase tracking-[2px] text-violet">
            {t("home_inkBand.eyebrow")}
          </div>
          <h2 className="font-display mt-2 text-[clamp(22px,3vw,32px)] font-extrabold tracking-tight">
            {t("home_inkBand.title")}
          </h2>
        </div>

        <div className="relative h-[300px] overflow-hidden rounded-3xl border border-line-2">
          {/* arte revelada por baixo */}
          <div className="absolute inset-0 grid place-items-center overflow-hidden" style={{ background: artBg }}>
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                backgroundImage: `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`,
                backgroundSize: "44px 44px",
              }}
            />
            <div className="relative px-6 text-center">
              <div className="font-display text-[clamp(34px,7.5vw,82px)] font-extrabold leading-[0.92] tracking-tight text-ink">
                <span className="grad-text">BLOCKCHAIN</span>
                <br />
                BEYOND
              </div>
              <p className="font-mono mt-3 text-[11.5px] uppercase tracking-[3px] text-muted">
                {t("home_inkBand.subtitle")}
              </p>
            </div>
          </div>

          {/* tinta que revela (desktop) */}
          <div className="absolute inset-0 hidden lg:block">
            <InkReveal maskColor={mask} brushSize={140} lifetime={720} />
          </div>
        </div>
        <p className="font-mono mt-3 text-center text-[11px] text-faint">
          {t("home_inkBand.mobileHint")}
        </p>
      </div>
    </section>
  );
}
