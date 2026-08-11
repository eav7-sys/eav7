"use client";

import { useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "./icons";

type Theme = "dark" | "light";

function readTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

// Lê o tema direto do DOM (atributo data-theme, setado pelo script inline no <head>).
function subscribe(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", onChange);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", onChange);
  };
}

type DocumentVT = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> };
};

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(subscribe, readTheme, () => "dark");

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    const next: Theme = theme === "light" ? "dark" : "light";
    const apply = () => {
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("eav7-theme", next);
      } catch {
        /* ignore */
      }
    };

    const doc = document as DocumentVT;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // sem suporte a View Transitions ou com movimento reduzido → troca instantânea
    if (typeof doc.startViewTransition !== "function" || reduce) {
      apply();
      return;
    }

    // reveal circular saindo do centro do botão
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    const transition = doc.startViewTransition(apply);
    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`],
        },
        {
          duration: 520,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"}
      className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-panel text-muted transition hover:border-line-2 hover:text-ink"
    >
      <span suppressHydrationWarning>{theme === "light" ? <IconMoon size={17} /> : <IconSun size={17} />}</span>
    </button>
  );
}
