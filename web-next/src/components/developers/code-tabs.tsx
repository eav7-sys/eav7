"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Copy } from "@/components/ui/copy";
import { TerminalDots, type CodeSample } from "./code-block";

/**
 * Mesmo bloco de terminal, com alternância entre alvos (curl · Rust · …).
 * O grifo do alvo ativo desliza entre as abas — `layoutId` faz o trabalho.
 */
export function CodeTabs({ samples, id }: { samples: CodeSample[]; id: string }) {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const current = samples[active] ?? samples[0];

  return (
    <div className="code-term overflow-hidden rounded-xl">
      <div className="code-term-bar flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <TerminalDots />
          <div role="tablist" aria-label={id} className="flex items-center gap-1">
            {samples.map((sample, i) => (
              <button
                key={sample.label}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`font-mono relative rounded-md px-2.5 py-1 text-[11px] uppercase tracking-[0.5px] transition-colors ${
                  i === active ? "text-[#efe9ff]" : "text-[rgba(239,233,255,.45)] hover:text-[#efe9ff]"
                }`}
              >
                {i === active && (
                  <motion.span
                    layoutId={`code-tab-${id}`}
                    aria-hidden
                    transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 38 }}
                    className="absolute inset-0 -z-0 rounded-md bg-[rgba(154,108,255,.22)]"
                  />
                )}
                <span className="relative">{sample.label}</span>
              </button>
            ))}
          </div>
        </div>
        <Copy text={current.code} icon />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed">{current.code}</pre>
    </div>
  );
}
