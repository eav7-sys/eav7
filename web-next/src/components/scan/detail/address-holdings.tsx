"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { avatarBg, initials } from "./shell";

export interface Holding {
  key: string;
  /** Nome legível do ativo (nome do token, coleção do NFT, nome EAV-NS). */
  name: string;
  /** Segunda linha: símbolo, contrato ou destino — o que identifica sem ambiguidade. */
  sub: string;
  /** Quantidade já formatada NA CASA DECIMAL DO PRÓPRIO ATIVO. */
  amount: string;
  /** Valor em USD formatado (quando há preço). */
  value?: string;
  href?: string;
}

export interface HoldingGroup {
  id: string;
  label: string;
  items: Holding[];
}

/**
 * Painel de participações do endereço (o cartão da direita no desenho).
 *
 * É cliente porque tem busca instantânea: filtrar 40 tokens por uma ida ao servidor
 * seria pior do que filtrar em memória o que já está na tela.
 */
export function AddressHoldings({
  groups,
  title,
  searchPh,
  emptyLabel,
  noMatchLabel,
}: {
  groups: HoldingGroup[];
  title: string;
  searchPh: string;
  emptyLabel: string;
  noMatchLabel: string;
}) {
  const [ativa, setAtiva] = useState(groups[0]?.id ?? "");
  const [busca, setBusca] = useState("");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const grupo = groups.find((g) => g.id === ativa) ?? groups[0];

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!grupo) return [];
    if (!q) return grupo.items;
    return grupo.items.filter((i) => `${i.name} ${i.sub}`.toLowerCase().includes(q));
  }, [grupo, busca]);

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const passo = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let alvo = -1;
    if (passo !== 0) alvo = (i + passo + groups.length) % groups.length;
    else if (e.key === "Home") alvo = 0;
    else if (e.key === "End") alvo = groups.length - 1;
    if (alvo < 0) return;
    e.preventDefault();
    refs.current[alvo]?.focus();
    setAtiva(groups[alvo].id);
  }

  return (
    <div className="scan-glass flex flex-col overflow-hidden">
      <div className="flex flex-wrap gap-1.5 px-4 pb-2.5 pt-3.5" role="tablist" aria-label={title}>
        {groups.map((g, i) => {
          const sel = g.id === grupo?.id;
          return (
            <button
              key={g.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`hold-tab-${g.id}`}
              aria-selected={sel}
              aria-controls="hold-panel"
              tabIndex={sel ? 0 : -1}
              onClick={() => setAtiva(g.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                sel ? "bg-[var(--scan-chip)] text-violet" : "text-faint hover:bg-[var(--scan-hover)]"
              }`}
            >
              {g.label} ({g.items.length})
            </button>
          );
        })}
      </div>

      <div className="px-4 pb-3 pt-0.5">
        <label className="scan-input flex h-9 items-center gap-2 px-3">
          <span aria-hidden className="text-faint">
            ⌕
          </span>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={searchPh}
            aria-label={searchPh}
            className="w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
          />
        </label>
      </div>

      <div
        id="hold-panel"
        role="tabpanel"
        aria-labelledby={`hold-tab-${grupo?.id ?? ""}`}
        className="max-h-[400px] min-h-[200px] flex-1 overflow-y-auto"
      >
        {lista.map((it) => (
          <div
            key={it.key}
            className="flex items-center gap-3 border-t border-[var(--scan-border-soft)] px-4 py-2.5 hover:bg-[var(--scan-hover)]"
          >
            <span
              aria-hidden
              className="grid size-[30px] shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
              style={{ background: avatarBg(it.sub || it.name) }}
            >
              {initials(it.name)}
            </span>
            <span className="min-w-0 flex-1">
              {it.href ? (
                <Link href={it.href} className="block truncate text-[13px] font-semibold text-violet hover:underline">
                  {it.name}
                </Link>
              ) : (
                <span className="block truncate text-[13px] font-semibold text-ink">{it.name}</span>
              )}
              <span className="font-mono block truncate text-[10.5px] text-faint">{it.sub}</span>
            </span>
            <span className="shrink-0 text-right">
              {it.value ? (
                <>
                  <span className="block text-[12.5px] font-semibold text-ink">{it.value}</span>
                  <span className="tnum mt-px block text-[11px] text-faint">{it.amount}</span>
                </>
              ) : (
                <span className="tnum text-[12.5px] font-semibold text-ink">{it.amount}</span>
              )}
            </span>
          </div>
        ))}
        {lista.length === 0 ? (
          <div className="px-5 py-14 text-center text-[12.5px] text-faint">
            {busca ? noMatchLabel : emptyLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}
