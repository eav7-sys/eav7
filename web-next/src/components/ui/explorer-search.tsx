"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/provider";
import { API_BASE } from "@/lib/api";

type Hit = { kind: string; label: string; detail?: string | null; to: string };

/**
 * Id estável da categoria, independente do idioma que a API usar no rótulo.
 * A API do nó devolve `kind` em PT ("Endereço", "Transação", …); se um dia
 * passar a devolver EN ou um id cru, o mapa continua resolvendo.
 */
type KindId =
  | "address"
  | "account"
  | "validator"
  | "tx"
  | "block"
  | "token"
  | "name"
  | "contract"
  | "unknown";

const KIND_ID_BY_LABEL: Record<string, KindId> = {
  // ids crus
  address: "address",
  account: "account",
  validator: "validator",
  tx: "tx",
  transaction: "tx",
  block: "block",
  token: "token",
  name: "name",
  contract: "contract",
  // rótulos PT devolvidos pela API do nó
  Endereço: "address",
  MetaMask: "address",
  Conta: "account",
  Validador: "validator",
  Transação: "tx",
  Bloco: "block",
  Token: "token",
  Nome: "name",
  Contrato: "contract",
  // rótulos EN (caso a API mude)
  Address: "address",
  Account: "account",
  Validator: "validator",
  "Transaction": "tx",
  Block: "block",
  Name: "name",
  Contract: "contract",
};

function kindIdOf(kind: string): KindId {
  return KIND_ID_BY_LABEL[kind] ?? KIND_ID_BY_LABEL[kind.toLowerCase()] ?? "unknown";
}

// Cores por tipo de resultado (badge por categoria), indexadas pelo id estável.
const KIND_STYLE: Record<KindId, string> = {
  address: "text-violet border-violet/40 bg-violet/10",
  account: "text-violet border-violet/40 bg-violet/10",
  validator: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10",
  tx: "text-sky-400 border-sky-400/40 bg-sky-400/10",
  block: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  token: "text-fuchsia-400 border-fuchsia-400/40 bg-fuchsia-400/10",
  name: "text-cyan-400 border-cyan-400/40 bg-cyan-400/10",
  contract: "text-cyan-400 border-cyan-400/40 bg-cyan-400/10",
  unknown: "text-muted border-line-2 bg-white/5",
};

const KIND_ICON: Record<KindId, string> = {
  address: "◈",
  account: "◈",
  validator: "✓",
  tx: "⇄",
  block: "▣",
  token: "◉",
  name: "@",
  contract: "◉",
  unknown: "•",
};

/** Rótulo do grupo: usa o `kind` da API se já for um id, senão o rótulo i18n. */
function kindLabelKey(id: KindId): string {
  return `ui_explorerSearch.kind${id[0].toUpperCase()}${id.slice(1)}`;
}

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
  /** variante do hero da home: pill maior + botão de ação com seta */
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

  // Busca ampliada: cai na página /search, que varre mais índices que o
  // autocomplete. É também a saída quando o autocomplete volta vazio.
  function goSearch() {
    const v = q.trim();
    if (!v) return;
    setOpen(false);
    setQ("");
    router.push(`/search?q=${encodeURIComponent(v)}`);
    onSubmitted?.();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sel >= 0 && hits[sel]) return go(hits[sel]);
    if (!q.trim()) return;
    if (hits.length === 1) return go(hits[0]); // resultado único → vai direto
    goSearch();
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

  // agrupa por id estável mantendo a ordem do índice
  const groups: [KindId, Hit[]][] = [];
  for (const h of hits) {
    const id = kindIdOf(h.kind);
    const g = groups.find(([k]) => k === id);
    if (g) g[1].push(h);
    else groups.push([id, [h]]);
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
              <>
                <div className="sug-empty">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-faint">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  {t("ui_explorerSearch.noResults", { q: q.trim() })}
                </div>
                {/* Saída acionável do estado vazio: a busca completa em /search
                    cobre mais índices que o autocomplete. Enter faz o mesmo. */}
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    goSearch();
                  }}
                  className="sug-item"
                >
                  <span className={`sug-kind border ${KIND_STYLE.address}`}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4.3-4.3" />
                    </svg>
                  </span>
                  <span className="sug-label">
                    <span className="truncate">{t("ui_explorerSearch.searchFor", { q: q.trim() })}</span>
                  </span>
                  <span className="sug-enter">↵</span>
                </button>
              </>
            ) : (
              groups.map(([id, list]) => (
                <div key={id}>
                  <div className="sug-group">{t(kindLabelKey(id))}</div>
                  {list.map((h) => {
                    const idx = hits.indexOf(h);
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
                        <span className={`sug-kind border ${KIND_STYLE[id]}`}>{KIND_ICON[id]}</span>
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
              <span>
                ↑↓ {t("ui_explorerSearch.hintNavigate")} · ↵ {t("ui_explorerSearch.hintOpen")} · esc{" "}
                {t("ui_explorerSearch.hintClose")}
              </span>
              <span>{t("ui_explorerSearch.resultCount", { n: hits.length })}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
