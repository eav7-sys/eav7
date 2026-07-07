import { useRef, useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useSettings } from '../lib/settings';
import { isE7, is0x, short } from '../lib/format';

interface Sug { icon: string; kind: string; label: string; sub?: string; detail?: string; to: string }

const HIST_KEY = 'eav7-search-hist';
const loadHist = (): Sug[] => { try { return JSON.parse(localStorage.getItem(HIST_KEY) ?? '[]'); } catch { return []; } };
const saveHist = (items: Sug[]) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(items.slice(0, 8))); } catch { /* ok */ } };

const ICON: Record<string, string> = { Token: '🪙', Endereço: '👛', Conta: '👛', MetaMask: '🦊', Transação: '🧾', Bloco: '🧱', Validador: '⚙️' };
const iconFor = (kind: string) => ICON[kind] ?? '🧾';

export function SearchBox({ className = '' }: { className?: string }) {
  const { t } = useSettings();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [hist, setHist] = useState<Sug[]>(loadHist);
  const [sugs, setSugs] = useState<Sug[]>([]);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // busca no backend (debounce 180ms) — resultados autoritativos por token/conta/tx
  useEffect(() => {
    const query = q.trim();
    if (!query) { setSugs([]); setLoading(false); return; }
    setLoading(true);
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const r = await api.search(query);
        if (id !== seq.current) return; // resposta obsoleta
        setSugs(r.results.map((x) => ({ ...x, icon: iconFor(x.kind) })));
      } catch { if (id === seq.current) setSugs([]); }
      finally { if (id === seq.current) setLoading(false); }
    }, 180);
    return () => clearTimeout(timer);
  }, [q]);

  const showHist = q.trim() === '' && hist.length > 0;
  const list = showHist ? hist : sugs;

  const go = (s: Sug) => {
    const next = [{ icon: s.icon, kind: s.kind, label: s.label, sub: s.sub, to: s.to }, ...hist.filter((h) => h.to !== s.to)].slice(0, 8);
    setHist(next); saveHist(next);
    nav(s.to); setQ(''); setOpen(false); setSugs([]);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (list[active]) return go(list[active]);
    if (sugs[0]) return go(sugs[0]);
    const v = q.trim();
    if (!v) return;
    if (is0x(v) || isE7(v)) go({ icon: '👛', kind: 'Endereço', label: v, to: `/address/${v}` });
    else if (/^E7[0-9A-F]{40,}$/i.test(v)) go({ icon: '🧾', kind: 'Transação', label: short(v, 14), to: `/tx/${v}` });
    else if (/^\d+$/.test(v)) go({ icon: '🧱', kind: 'Bloco', label: `#${v}`, to: `/block/${v}` });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || !list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % list.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + list.length) % list.length); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const clearHist = () => { setHist([]); saveHist([]); };

  return (
    <div ref={box} className={`relative ${className}`}>
      <form onSubmit={submit} className="relative">
        <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={t('search_ph')}
          spellCheck={false}
          className="h-10 w-full rounded-xl border border-line bg-[var(--field-bg)] pl-10 pr-4 text-[12.5px] text-ink outline-none transition placeholder:text-faint focus:border-[rgba(145,101,245,.75)] focus:shadow-[var(--ring)]"
        />
      </form>
      {open && (list.length > 0 || (!showHist && q.trim() && !loading)) && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[min(65vh,440px)] overflow-y-auto rounded-xl border border-line-strong bg-bg2 py-1.5 shadow-[var(--shadow)]">
          {showHist && (
            <div className="flex items-center justify-between px-3.5 pb-1.5 pt-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-faint">{t('search_history')}</span>
              <button onClick={clearHist} className="flex items-center gap-1 !bg-transparent !p-0 !text-[11px] !font-medium !text-muted !shadow-none hover:!text-ink">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                {t('clear_hist')}
              </button>
            </div>
          )}
          {list.map((s, i) => (
            <button key={s.to + i} onMouseEnter={() => setActive(i)} onClick={() => go(s)}
              className={`flex w-full items-center gap-3 !rounded-none !bg-transparent !px-3.5 !py-2 text-left !shadow-none ${i === active ? '!bg-surfaceh' : ''}`}>
              <span className="text-sm">{showHist ? '🕘' : s.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="mono block truncate text-[12px] text-ink">{s.label}</span>
                {(s.sub || s.detail) && <span className="mono block truncate text-[10.5px] text-faint">{s.detail ?? short(s.sub!, 16)}</span>}
              </span>
              <span className="flex-none text-[10px] font-semibold uppercase tracking-wide text-muted">{s.kind}</span>
            </button>
          ))}
          {!showHist && list.length === 0 && q.trim() && !loading && (
            <div className="px-3.5 py-3 text-[12px] text-muted">Nenhum resultado. Pressione Enter para ir direto.</div>
          )}
        </div>
      )}
    </div>
  );
}
