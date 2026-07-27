"use client";

import { useSyncExternalStore } from "react";

// Lê o tema atual (data-theme) de forma segura p/ SSR.
function useTheme(): "dark" | "light" {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return () => observer.disconnect();
    },
    () => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"),
    () => "dark",
  );
}

// No mobile o vídeo (autoplay pesado) é desligado — cai no fundo estático .wallet-bg.
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(min-width: 768px)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );
}

// Fundo animado da carteira — vídeo próprio por tema (rede blockchain no escuro, ondas no claro).
export function WalletVideoBg() {
  const theme = useTheme();
  const isDesktop = useIsDesktop();
  const base = theme === "light" ? "wallet-light" : "wallet-dark";

  if (!isDesktop) return null;
  return (
    <div aria-hidden className={`wallet-video wallet-video--${theme} pointer-events-none absolute inset-0 z-0`}>
      <video
        key={base}
        autoPlay
        muted
        loop
        playsInline
        poster={`/bg/${base}-poster.jpg`}
        className="h-full w-full object-cover"
      >
        <source src={`/bg/${base}.webm`} type="video/webm" />
        <source src={`/bg/${base}.mp4`} type="video/mp4" />
      </video>
    </div>
  );
}
