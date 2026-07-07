import { useState } from 'react';
import { Outlet, Link, useLocation, NavLink } from 'react-router-dom';
import { useSettings } from '../lib/settings';
import { SearchBox } from './SearchBox';
import type { Lang } from '../i18n/strings';

function Logo() {
  return (
    <svg className="h-[34px] w-[34px] flex-none drop-shadow-[0_4px_16px_var(--glow)] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105" viewBox="0 0 40 40">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9d78ff" /><stop offset="1" stopColor="#6a3fd0" /></linearGradient></defs>
      <path d="M20 2 L35 11 V29 L20 38 L5 29 V11 Z" fill="url(#lg)" fillOpacity=".16" stroke="url(#lg)" strokeWidth="1.6" />
      <text x="20" y="25.5" textAnchor="middle" fontFamily="ui-monospace,monospace" fontSize="13" fontWeight="800" fill="url(#lg)">E7</text>
    </svg>
  );
}

const NAV = [
  { to: '/', key: 'nav_explorer', match: ['/', '/explorer', '/blocks', '/block', '/tx', '/address'] },
  { to: '/wallet', key: 'nav_wallet', match: ['/wallet'] },
  { to: '/app', key: 'nav_mining', match: ['/app'] },
];

export function Layout() {
  const { t, theme, setTheme, lang, setLang, timeFmt, setTimeFmt } = useSettings();
  const loc = useLocation();
  const [sheet, setSheet] = useState(false);

  const navActive = (match: string[]) => match.some((m) => (m === '/' ? loc.pathname === '/' : loc.pathname.startsWith(m)));

  const navLinks = () => NAV.map((n) => (
    <NavLink key={n.to} to={n.to} className={`whitespace-nowrap rounded-[10px] px-3 py-[7px] text-[13px] font-medium transition-colors ${navActive(n.match) ? 'bg-[rgba(120,74,224,.24)] text-[var(--clean)] shadow-[inset_0_0_0_1px_rgba(145,101,245,.3)]' : 'text-muted hover:bg-surface hover:text-ink'}`}>{t(n.key)}</NavLink>
  ));
  const themeBtn = () => (
    <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={t('theme')}
      className="glass flex h-10 w-10 flex-none items-center justify-center rounded-xl !p-0 text-base text-ink transition hover:border-line-strong hover:bg-surfaceh">
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line backdrop-blur-xl backdrop-saturate-150" style={{ background: 'var(--topbar-bg)' }}>
        <div className="mx-auto max-w-[1200px] px-4 py-2.5 sm:px-[22px] sm:py-3">
          {/* linha principal */}
          <div className="flex items-center gap-3">
            <Link to="/" className="group flex select-none items-center gap-2.5">
              <Logo />
              <div>
                <div className="text-[18px] font-extrabold leading-none tracking-tight"><b className="grad-text">EAV7</b> <span className="font-semibold text-muted">Scan</span></div>
                <div className="mt-0.5 hidden text-[10px] font-bold uppercase tracking-[1.4px] text-faint sm:block">protocolo eav20</div>
              </div>
            </Link>
            <nav className="ml-1 hidden gap-1 md:flex">{navLinks()}</nav>
            {/* grupo direito: busca + tema, alinhados como uma unidade */}
            <div className="ml-auto hidden items-center gap-2.5 md:flex">
              <SearchBox className="w-[300px] lg:w-[360px]" />
              {themeBtn()}
            </div>
            {/* mobile: só o tema no topo (a busca vai na 2ª linha) */}
            <div className="ml-auto md:hidden">{themeBtn()}</div>
          </div>
          {/* mobile: busca + nav */}
          <div className="mt-2.5 md:hidden">
            <SearchBox className="block" />
            <nav className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">{navLinks()}</nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-7 sm:px-[22px]"><Outlet /></main>

      <footer className="mt-8 border-t border-line" style={{ background: 'var(--topbar-bg)' }}>
        <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-8 px-5 py-10 sm:grid-cols-4 sm:px-[22px]">
          <div className="col-span-2 sm:col-span-1">
            <Link to="/" className="group flex select-none items-center gap-2.5"><Logo /><div className="text-[17px] font-extrabold"><b className="grad-text">EAV7</b> <span className="text-muted">Scan</span></div></Link>
            <p className="mt-3 max-w-[240px] text-[12px] leading-relaxed text-muted">Blockchain própria estilo Tron · pós-quântica eav7-hybrid-1 · camada de IA · EAVM compatível com MetaMask.</p>
          </div>
          <FootCol title="Explorador" links={[['Blocos', '/blocks'], ['Últimas txs', '/'], ['Validadores', '/app']]} />
          <FootCol title="Carteira" links={[['Carteira web', '/wallet'], ['Adicionar à MetaMask', '/app'], ['Minerar', '/app']]} />
          <FootCol title="Rede" links={[['RPC EAVM', `${location.protocol}//rpc.${location.hostname.replace(/^(www|node\d)\./, '')}`, true], ['Chain ID 72020', '/app'], ['Status', '/status', true]]} />
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-3 px-5 py-4 text-[11.5px] text-faint sm:flex-row sm:px-[22px]">
            <span>EAV7 · protocolo eav20 · DPoS · blocos de 1s</span>
            <button onClick={() => setSheet(true)} className="glass rounded-xl px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:border-line-strong">⚙ {t('customize')}</button>
          </div>
        </div>
      </footer>

      {/* painel personalizar */}
      <div className={`fixed inset-0 z-50 bg-black/55 backdrop-blur-sm transition-opacity ${sheet ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={() => setSheet(false)} />
      <div className={`fixed left-1/2 top-1/2 z-[51] w-[340px] max-w-[calc(100vw-28px)] -translate-x-1/2 rounded-[20px] border border-line-strong bg-bg2 p-[22px] shadow-[var(--shadow)] transition-all duration-200 ${sheet ? 'pointer-events-auto -translate-y-1/2 opacity-100' : 'pointer-events-none -translate-y-[46%] scale-[.98] opacity-0'}`}>
        <h3 className="text-[15px] font-bold">{t('customize')}</h3>
        <p className="mb-4 mt-0.5 text-[11.5px] text-muted">Idioma, tema e formato de hora.</p>
        <Seg label={t('language')} value={lang} options={[['pt', 'Português'], ['en', 'English'], ['es', 'Español']]} onChange={(v) => setLang(v as Lang)} />
        <Seg label={t('theme')} value={theme} options={[['dark', t('dark')], ['light', t('light')]]} onChange={(v) => setTheme(v as 'dark' | 'light')} />
        <Seg label={t('time_format')} value={timeFmt} options={[['local', 'Local'], ['utc', 'UTC']]} onChange={(v) => setTimeFmt(v as 'local' | 'utc')} />
        <button onClick={() => setSheet(false)} className="mt-1 w-full">Concluído</button>
      </div>
    </>
  );
}

function FootCol({ title, links }: { title: string; links: [string, string, boolean?][] }) {
  return (
    <div>
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[.9px] text-faint">{title}</div>
      <ul className="space-y-2 text-[12.5px]">
        {links.map(([label, to, ext], i) => (
          <li key={i}>{ext
            ? <a href={to} className="text-muted transition-colors hover:text-ink">{label}</a>
            : <Link to={to} className="text-muted transition-colors hover:text-ink">{label}</Link>}</li>
        ))}
      </ul>
    </div>
  );
}

function Seg({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[.9px] text-muted">{label}</div>
      <div className="flex gap-1.5 rounded-[13px] border border-line bg-surface p-1">
        {options.map(([v, lbl]) => (
          <button key={v} onClick={() => onChange(v)}
            className={`flex-1 rounded-[10px] px-1.5 py-[9px] text-[12.5px] font-semibold transition ${value === v ? 'text-white shadow-[0_6px_18px_-8px_var(--glow)]' : 'bg-transparent text-muted hover:bg-surfaceh hover:text-ink'}`}
            style={value === v ? { background: 'var(--grad-accent)' } : undefined}>{lbl}</button>
        ))}
      </div>
    </div>
  );
}
