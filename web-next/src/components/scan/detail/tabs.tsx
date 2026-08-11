"use client";

import Link from "next/link";
import { useRef } from "react";
import { num } from "@/lib/format";

export interface TabDef {
  id: string;
  label: string;
  /** URL da aba. É string (e não função) porque isto atravessa a fronteira
   *  servidor→cliente, que só transporta dado serializável. */
  href: string;
  /** Contagem ao lado do rótulo — só quando ela é REAL nesta requisição. */
  count?: number;
}

/**
 * Faixa de abas do desenho, com o estado na URL.
 *
 * Por que na URL e não em `useState`: cada aba busca só o seu dado no servidor
 * (a de permissões não precisa baixar mil transações), o endereço fica
 * compartilhável e o botão "voltar" do navegador funciona.
 *
 * Acessibilidade: é uma `tablist` de verdade. As setas movem o foco entre as abas
 * sem ativá-las (ativação manual, recomendada quando trocar de aba navega), e
 * Enter/Espaço abrem a aba focada — o comportamento nativo do link.
 */
export function ScanTabs({
  tabs,
  current,
  label,
  panelId,
}: {
  tabs: TabDef[];
  current: string;
  label: string;
  panelId: string;
}) {
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let next = -1;
    if (delta !== 0) next = (i + delta + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
  }

  return (
    <div className="scan-tablist mt-7" role="tablist" aria-label={label}>
      {tabs.map((tb, i) => {
        const active = tb.id === current;
        return (
          <Link
            key={tb.id}
            href={tb.href}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${panelId}-tab-${tb.id}`}
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            // Roving tabindex: a faixa inteira é UMA parada de tabulação.
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            scroll={false}
            className="scan-tab"
          >
            {tb.label}
            {tb.count != null ? (
              <span className={`tnum ml-1.5 text-[11px] ${active ? "text-violet" : "text-faint"}`}>
                {num(tb.count)}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
