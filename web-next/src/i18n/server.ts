import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type LocaleCode } from "./locales";
import { makeT, type TFunc } from "./resolve";

// t() para Server Components e generateMetadata — lê o idioma do cookie.
export async function getLocale(): Promise<LocaleCode> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getT(): Promise<TFunc> {
  return makeT(await getLocale());
}
