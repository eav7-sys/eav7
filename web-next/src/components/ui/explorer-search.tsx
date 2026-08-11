"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/provider";
import { API_BASE } from "@/lib/api";

type Hit = { kind: string; label: string; detail?: string | null; to: string };

// Cores por tipo de resultado (badge por categoria).
const KIND_STYLE: Record<string, string> = {
  Endereço: "text-violet border-violet/40 bg-violet/10",
  Conta: "text-violet border-violet/40 bg-violet/10",
  Validador: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10",
  Transação: "text-sky-400 border-sky-400/40 bg-sky-400/10",
  Bloco: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  Token: "text-fuchsia-400 border-fuchsia-400/40 bg-fuchsia-400/10",
  Nome: "text-cyan-400 border-cyan-400/40 bg-cyan-400/10",
};


const KIND_ICON: Record<string, string> = {
  Endereço: "◈",
  Conta: "◈",
  Validador: "✓",
  Transação: "⇄",
  Bloco: "▣",
  Token: "◉",
  Nome: "@",
};

function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="hl">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

export function ExplorerSearch({
  placeholder,
  className = "",
  autoFocus = false,
  onSubmitted,
  hero = false,
  buttonLabel,
}: {
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onSubmitted?: () => void;
  /** variante do hero da home: pill maior + botão "Explorar" com seta */
  hero?: boolean;
  buttonLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const router = useRouter();
  const t = useT();
  const effectivePlaceholder = placeholder ?? t("ui_explorerSearch.placeholder");

  // autocomplete indexado: ≥2 caracteres, debounce 180ms, descarta respostas antigas
  useEffect(() => {
    const v = q.trim();
    if (v.length < 2) {
      setHits([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++seqRef.current;
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`${API_BASE}/search?q=${encodeURIComponent(v)}`, {
          headers: { Accept: "application/json" },
        });
        const j = (await r.json()) as { results?: Hit[] };
        if (seq !== seqRef.current) return; // resposta velha
        setHits((j.results ?? []).slice(0, 12));
        setOpen(true);
        setSel(-1);
      } catch {
        if (seq === seqRef.current) setHits([]);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(id);
  }, [q]);

  // fecha ao clicar fora
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function go(hit: Hit) {
    setOpen(false);
    setQ("");
    router.push(hit.to);
    onSubmitted?.();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sel >= 0 && hits[sel]) return go(hits[sel]);
    const v = q.trim();
    if (!v) return;
    if (hits.length === 1) return go(hits[0]); // resultado único → vai direto
    router.push(`/search?q=${encodeURIComponent(v)}`);
    setOpen(false);
    onSubmitted?.();
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open || !hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (s + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (s <= 0 ? hits.length - 1 : s - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // agrupa por tipo mantendo a ordem do índice
  const groups: [string, Hit[]][] = [];
  for (const h of hits) {
    const g = groups.find(([k]) => k === h.kind);
    if (g) g[1].push(h);
    else groups.push([h.kind, [h]]);
  }

  return (
    <div ref={boxRef} className={`relative w-full ${className}`} style={{ zIndex: open ? 120 : undefined }}>
      <form
        onSubmit={submit}
        className={
          hero
            ? /* EAVScan.dc.html: form transparente dentro do shell de 18px — sem pill aninhada */
              "flex w-full items-center gap-2.5"
            : "exp-search flex w-full items-center gap-2 rounded-full border border-line-2 bg-panel/60 py-1.5 pl-3.5 pr-1.5 backdrop-blur transition focus-within:border-violet/60"
        }
      >
        <svg
          width={hero ? 18 : 15}
          height={hero ? 18 : 15}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          className={`flex-none text-faint ${hero ? "ml-2.5" : ""}`}
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={onKey}
          placeholder={effectivePlaceholder}
          autoFocus={autoFocus}
          className={`min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-faint ${hero ? "text-[15.5px]" : "text-[13px]"}`}
        />
        {loading && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-none animate-spin text-violet">
            <path d="M21 12a9 9 0 1 1-6.2-8.56" />
          </svg>
        )}
        <button
          type="submit"
          className={
            hero
              ? "flex-none rounded-[11px] bg-[var(--scan-primary,#6336c4)] px-[26px] py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--scan-primary-h,#7242d4)]"
              : "btn-primary flex-none !px-3.5 !py-1.5 text-[12px]"
          }
        >
          {buttonLabel ?? t("ui_explorerSearch.searchButton")}
        </button>
      </form>

      {open && (
        <div className="search-suggest">
          <div className="search-suggest-scroll">
            {hits.length === 0 ? (
              <div className="sug-empty">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-faint">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                Nenhum resultado para “{q.trim()}”
              </div>
            ) : (
              groups.map(([kind, list]) => (
                <div key={kind}>
                  <div className="sug-group">{kind}</div>
                  {list.map((h) => {
                    const idx = hits.indexOf(h);
                    const st = KIND_STYLE[kind] ?? "text-muted border-line-2 bg-white/5";
                    return (
                      <button
                        key={h.to + h.label}
                        type="button"
                        data-sel={idx === sel}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          go(h);
                        }}
                        onMouseEnter={() => setSel(idx)}
                        className="sug-item"
                      >
                        <span className={`sug-kind border ${st}`}>{KIND_ICON[kind] ?? "•"}</span>
                        <span className="sug-label">
                          <span className="truncate">
                            <Highlight text={h.label} q={q.trim()} />
                          </span>
                        </span>
                        {h.detail && <span className="sug-detail">{h.detail}</span>}
                        <span className="sug-enter">↵</span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          {hits.length > 0 && (
            <div className="sug-footer">
              <span>↑↓ navegar · ↵ abrir · esc fechar</span>
              <span>{hits.length} resultado{hits.length === 1 ? "" : "s"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
