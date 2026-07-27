"use client";

import { useEffect, useRef, useState } from "react";
import { ExplorerSearch } from "@/components/ui/explorer-search";
import { useT } from "@/i18n/provider";

export function HeaderSearch() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("nav_headerSearch.buscar")}
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-panel text-muted transition hover:border-line-2 hover:text-ink"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="mm-content absolute right-0 top-12 z-50 w-[min(92vw,440px)] rounded-2xl border border-line-2 bg-panel/95 p-2 shadow-[0_28px_74px_-34px_rgba(0,0,0,.85)] backdrop-blur-xl">
          <ExplorerSearch autoFocus onSubmitted={() => setOpen(false)} />
          <div className="px-2 pb-1 pt-2 font-mono text-[10.5px] text-faint">
            {t("nav_headerSearch.dica")}
          </div>
        </div>
      )}
    </div>
  );
}
