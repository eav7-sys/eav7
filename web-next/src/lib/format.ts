// EAV7 nativo: 1 EAV7 = 1.000.000 e7 (6 casas decimais).
export const UNIT = 1_000_000n;

const LOCALE = "pt-BR";

/** Converte e7 (string/bigint) para EAV7 com separador de milhar. */
export function fmt(e7: string | bigint | number | null | undefined): string {
  let v: bigint;
  try {
    v = BigInt(e7 ?? 0);
  } catch {
    return "0";
  }
  const whole = v / UNIT;
  const frac = (v % UNIT).toString().padStart(6, "0").replace(/0+$/, "");
  return Number(whole).toLocaleString(LOCALE) + (frac ? "," + frac : "");
}

/** Versão compacta: 100,0 bi / 1,72 mi / 12 mil. */
export function fmtCompact(e7: string | bigint | number | null | undefined): string {
  let v: bigint;
  try {
    v = BigInt(e7 ?? 0);
  } catch {
    return "0";
  }
  const n = Number(v / UNIT);
  if (n >= 1e9) return (n / 1e9).toLocaleString(LOCALE, { maximumFractionDigits: 2 }) + " bi";
  if (n >= 1e6) return (n / 1e6).toLocaleString(LOCALE, { maximumFractionDigits: 2 }) + " mi";
  if (n >= 1e4) return (n / 1e3).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) + " mil";
  return fmt(e7);
}

export const num = (n: number) => n.toLocaleString(LOCALE);

/** Número compacto: 35,9 bi / 15,6 mi / 12,4 mil. */
export function numCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toLocaleString(LOCALE, { maximumFractionDigits: 2 }) + " bi";
  if (n >= 1e6) return (n / 1e6).toLocaleString(LOCALE, { maximumFractionDigits: 2 }) + " mi";
  if (n >= 1e3) return (n / 1e3).toLocaleString(LOCALE, { maximumFractionDigits: 1 }) + " mil";
  return n.toLocaleString(LOCALE);
}

/** Encurta hash/endereço: E7a4b2…9f21 */
export function shortHash(h: string | null | undefined, head = 8, tail = 4): string {
  if (!h) return "—";
  if (h.length <= head + tail + 1) return h;
  return h.slice(0, head) + "…" + h.slice(-tail);
}

/** "há 3s" relativo, para feeds live. */
export function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "min";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

/** Data absoluta local. */
export function when(ts: number): string {
  return new Date(ts).toLocaleString(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Energia compacta para caber no gauge: 847 · 10k · 1,2k · 3,4M. */
export function fmtEnergy(n: number | null | undefined): string {
  const v = Math.max(0, Math.round(Number(n ?? 0)));
  if (v < 1000) return String(v);
  if (v < 1_000_000) {
    const k = v / 1000;
    return (k < 100 ? k.toFixed(1).replace(/\.0$/, "").replace(".", ",") : String(Math.round(k))) + "k";
  }
  const m = v / 1_000_000;
  return (m < 100 ? m.toFixed(1).replace(/\.0$/, "").replace(".", ",") : String(Math.round(m))) + "M";
}

export const isE7Address = (s: string) => /^E7[0-9A-F]{32}$/.test(s);
export const isE7Hash = (s: string) => /^E7[0-9A-F]{62}$/.test(s);
export const isEvm = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s);

// Custo de energia por tipo de tx (espelha CHAIN.ENERGY.COST do nó). É o "gas" da rede:
// a energia consumida é determinística pelo tipo (chamadas EAVM somam gás da VM).
export const ENERGY_COST: Record<string, number> = {
  TRANSFER: 1,
  EAVM_TRANSFER: 1,
  STAKE: 1,
  UNSTAKE: 1,
  VOTE: 1,
  DELEGATE_RESOURCE: 1,
  UNDELEGATE_RESOURCE: 1,
  PERMISSION_UPDATE: 2,
  MULTISIG_PROPOSE: 2,
  MULTISIG_APPROVE: 1,
  GOV_PROPOSE: 2,
  GOV_VOTE: 1,
  SLASH_DOUBLE_SIGN: 8,
  BRIDGE_COMMITTEE_UPDATE: 2,
  VESTING_CREATE: 2,
  VESTING_CLAIM: 1,
  SET_COMMISSION: 1,
  CLAIM_VOTER_REWARD: 1,
  META_TX: 3,
  TOKEN_TRANSFER: 2,
  TOKEN_TRANSFER_FROM: 2,
  TOKEN_APPROVE: 1,
  TOKEN_CREATE: 10,
  TOKEN_MINT: 2,
  TOKEN_BURN: 2,
  TOKEN_PAUSE: 1,
  TOKEN_UNPAUSE: 1,
  TOKEN_BLACKLIST: 1,
  TOKEN_FREEZE: 1,
  TOKEN_UNFREEZE: 1,
  NFT_CREATE: 10,
  NFT_MINT: 3,
  NFT_TRANSFER: 2,
  NFT_APPROVE: 1,
  NFT_BURN: 2,
  NAME_REGISTER: 3,
  NAME_UPDATE: 1,
  NAME_TRANSFER: 1,
  NAME_RELEASE: 1,
  AI_TASK: 5,
  AI_RESULT: 0,
  AI_COMMIT: 1,
  AI_REVEAL: 1,
  AI_CLAIM: 1,
  AI_CHALLENGE: 2,
  AI_VERDICT: 1,
  AI_BID: 1,
  AI_AWARD: 1,
  AI_REFUND: 0,
  ORACLE_REGISTER: 2,
  BRIDGE_OUT: 2,
  BRIDGE_IN: 0,
  BRIDGE_SETTLE: 0,
};
export const energyCost = (type: string): number => ENERGY_COST[type] ?? 1;

/**
 * Formata o saldo de um token EAV20 usando as casas decimais DELE (não as 6 do EAV7).
 * Sem isto, um token de 6 casas aparece como o inteiro cru (1000000000000 em vez de 1.000.000).
 */
export function fmtToken(raw: string | bigint | number | null | undefined, decimals = 0): string {
  let v: bigint;
  try {
    v = BigInt(raw ?? 0);
  } catch {
    return "0";
  }
  if (decimals <= 0) return Number(v).toLocaleString(LOCALE);
  const unit = 10n ** BigInt(decimals);
  const whole = v / unit;
  const frac = (v % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return Number(whole).toLocaleString(LOCALE) + (frac ? "," + frac : "");
}

/**
 * Data/hora em UTC no formato ISO curto (2026-07-16 00:01:03), padrão dos exploradores
 * de bloco: o mesmo instante lido igual em qualquer fuso — importante para auditoria.
 */
export function whenUtc(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19);
}
