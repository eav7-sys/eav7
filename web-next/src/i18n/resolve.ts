import type { LocaleCode } from "./locales";
import { dictionaries } from "./dictionary";

type Vars = Record<string, string | number>;

// Assinatura da função de tradução — compartilhada por client (useT) e server (getT).
export type TFunc = (key: string, vars?: Vars) => string;

function walk(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

// Fallback em cadeia: idioma atual → inglês → português → a própria chave.
export function resolve(locale: LocaleCode, key: string, vars?: Vars): string {
  const candidates = [dictionaries[locale], dictionaries.en, dictionaries.pt];
  let value: unknown;
  for (const dict of candidates) {
    value = walk(dict, key);
    if (typeof value === "string") break;
  }
  if (typeof value !== "string") return key;
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = (value as string).replaceAll(`{${name}}`, String(replacement));
    }
  }
  return value as string;
}

export function makeT(locale: LocaleCode): TFunc {
  return (key, vars) => resolve(locale, key, vars);
}
