import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { STRINGS, localeOf, type Lang } from '../i18n/strings';

type Theme = 'dark' | 'light';
type TimeFmt = 'local' | 'utc';

interface Settings {
  theme: Theme;
  lang: Lang;
  timeFmt: TimeFmt;
  setTheme: (t: Theme) => void;
  setLang: (l: Lang) => void;
  setTimeFmt: (t: TimeFmt) => void;
  t: (key: string) => string;
  locale: string;
}

const Ctx = createContext<Settings | null>(null);

function detectLang(): Lang {
  const saved = localStorage.getItem('eav7-lang') as Lang | null;
  if (saved && STRINGS[saved]) return saved;
  const nav = navigator.language.slice(0, 2);
  return (nav === 'en' || nav === 'es' ? nav : 'pt') as Lang;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('eav7-theme') as Theme) || 'dark');
  const [lang, setLangState] = useState<Lang>(detectLang);
  const [timeFmt, setTimeFmtState] = useState<TimeFmt>(() => (localStorage.getItem('eav7-timefmt') as TimeFmt) || 'local');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    const m = document.getElementById('meta-theme');
    if (m) m.setAttribute('content', theme === 'light' ? '#eceaf6' : '#0b0c12');
    localStorage.setItem('eav7-theme', theme);
  }, [theme]);
  useEffect(() => { localStorage.setItem('eav7-lang', lang); document.documentElement.setAttribute('lang', localeOf[lang]); }, [lang]);
  useEffect(() => { localStorage.setItem('eav7-timefmt', timeFmt); }, [timeFmt]);

  const t = (key: string) => STRINGS[lang][key] ?? STRINGS.pt[key] ?? key;

  return (
    <Ctx.Provider value={{ theme, lang, timeFmt, setTheme: setThemeState, setLang: setLangState, setTimeFmt: setTimeFmtState, t, locale: localeOf[lang] }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSettings(): Settings {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSettings fora do provider');
  return c;
}
