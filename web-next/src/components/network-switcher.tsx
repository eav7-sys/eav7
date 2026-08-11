"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { IconCheck } from "./icons";

// Redes EAV7. A rede ATUAL é definida em build via NEXT_PUBLIC_NETWORK
// (mainnet por padrão; o deploy da testnet usa "testnet"). O seletor navega
// entre os domínios — cada rede é servida no seu próprio host.
const NETWORKS = [
  { id: "mainnet", label: "Mainnet", url: "https://eavscan.com", dot: "var(--teal)", desc: "Live network" },
  { id: "testnet", label: "Testnet", url: "https://testnet.eavscan.com", dot: "var(--gold)", desc: "Test coins · no value" },
] as const;

const CURRENT = process.env.NEXT_PUBLIC_NETWORK === "testnet" ? "testnet" : "mainnet";

export function NetworkSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = NETWORKS.find((n) => n.id === CURRENT) ?? NETWORKS[0];

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch network"
        className="group flex h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-muted transition hover:border-line-2 hover:text-ink"
      >
        <span className="h-2 w-2 rounded-full" style={{ background: current.dot, boxShadow: `0 0 7px ${current.dot}` }} />
        <span className="text-[12px] font-bold tracking-wide">{current.label}</span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95, transition: { duration: 0.14 } }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="absolute right-0 z-50 mt-2 w-56 origin-top-right overflow-hidden rounded-2xl border border-line-2 bg-panel/95 p-1.5 shadow-2xl backdrop-blur-xl"
          >
            <div className="font-mono px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[1.2px] text-faint">
              Network
            </div>
            {NETWORKS.map((n) => {
              const active = n.id === CURRENT;
              return (
                <a
                  key={n.id}
                  href={active ? undefined : n.url}
                  onClick={() => setOpen(false)}
                  aria-selected={active}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start transition ${
                    active ? "bg-violet/12 text-ink" : "text-muted hover:bg-line/70 hover:text-ink"
                  }`}
                >
                  <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: n.dot, boxShadow: `0 0 7px ${n.dot}` }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{n.label}</span>
                    <span className="block truncate text-[11px] text-faint">{n.desc}</span>
                  </span>
                  {active && <IconCheck size={15} className="flex-none text-violet" />}
                </a>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
