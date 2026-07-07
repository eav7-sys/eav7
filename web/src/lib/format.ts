// Formatação de valores EAV7 (6 casas, padrão Tron) e utilidades de exibição.
const UNIT = 1_000_000n;

export function fmt(e7: string | number | bigint, locale = 'pt-BR'): string {
  const v = BigInt(e7 ?? 0);
  const w = v / UNIT;
  const f = (v % UNIT).toString().padStart(6, '0').replace(/0+$/, '');
  const dec = locale.startsWith('en') ? '.' : ',';
  return Number(w).toLocaleString(locale) + (f ? dec + f : '');
}

const COMPACT: Record<string, { bi: string; mi: string; mil: string }> = {
  'pt-BR': { bi: ' bi', mi: ' mi', mil: ' mil' },
  'en': { bi: 'B', mi: 'M', mil: 'K' },
  'es': { bi: ' mil M', mi: ' M', mil: ' mil' },
};

export function fmtCompact(e7: string | number | bigint, lang = 'pt-BR'): string {
  const n = Number(BigInt(e7 ?? 0) / UNIT);
  const c = COMPACT[lang] ?? COMPACT['pt-BR'];
  if (n >= 1e9) return (n / 1e9).toLocaleString(lang, { maximumFractionDigits: 2 }) + c.bi;
  if (n >= 1e6) return (n / 1e6).toLocaleString(lang, { maximumFractionDigits: 2 }) + c.mi;
  if (n >= 1e4) return (n / 1e3).toLocaleString(lang, { maximumFractionDigits: 1 }) + c.mil;
  return n.toLocaleString(lang);
}

export const short = (h: string | null | undefined, n = 10): string =>
  h ? h.slice(0, n) + '…' + h.slice(-4) : '—';

export function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const when = (ts: number, locale = 'pt-BR'): string => new Date(ts).toLocaleString(locale);

export const is0x = (s: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
export const isE7 = (s: string): boolean => /^E7[0-9A-F]{32}$/i.test(s.trim());

// custo BASE de energia por tipo de tx (espelha CHAIN.ENERGY.COST)
export const ENERGY_COST: Record<string, number> = {
  TRANSFER: 1, STAKE: 1, UNSTAKE: 1, EAVM_TRANSFER: 1, TOKEN_TRANSFER: 2, TOKEN_TRANSFER_FROM: 2,
  TOKEN_APPROVE: 1, TOKEN_CREATE: 10, AI_TASK: 5, AI_RESULT: 0, AI_REFUND: 0, ORACLE_REGISTER: 2,
  BRIDGE_OUT: 2, BRIDGE_IN: 0, BRIDGE_SETTLE: 0, EAVM_DEPLOY: 10, EAVM_CALL: 5,
};
export const energyCost = (type: string): string => {
  const base = ENERGY_COST[type] ?? 1;
  return `${base}${type === 'EAVM_DEPLOY' || type === 'EAVM_CALL' ? '+' : ''}`;
};
