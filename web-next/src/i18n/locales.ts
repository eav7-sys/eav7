// Idiomas suportados pelo EAV7 Scan. `dir` controla LTR/RTL (árabe = rtl).
export const LOCALES = [
  { code: "pt", name: "Português", english: "Portuguese", flag: "🇧🇷", dir: "ltr" },
  { code: "en", name: "English", english: "English", flag: "🇺🇸", dir: "ltr" },
  { code: "es", name: "Español", english: "Spanish", flag: "🇪🇸", dir: "ltr" },
  { code: "zh", name: "中文", english: "Chinese", flag: "🇨🇳", dir: "ltr" },
  { code: "fr", name: "Français", english: "French", flag: "🇫🇷", dir: "ltr" },
  { code: "de", name: "Deutsch", english: "German", flag: "🇩🇪", dir: "ltr" },
  { code: "ja", name: "日本語", english: "Japanese", flag: "🇯🇵", dir: "ltr" },
  { code: "ru", name: "Русский", english: "Russian", flag: "🇷🇺", dir: "ltr" },
  { code: "ar", name: "العربية", english: "Arabic", flag: "🇸🇦", dir: "rtl" },
  { code: "hi", name: "हिन्दी", english: "Hindi", flag: "🇮🇳", dir: "ltr" },
  { code: "ko", name: "한국어", english: "Korean", flag: "🇰🇷", dir: "ltr" },
  { code: "it", name: "Italiano", english: "Italian", flag: "🇮🇹", dir: "ltr" },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];
export type Dir = "ltr" | "rtl";

export const DEFAULT_LOCALE: LocaleCode = "en";
export const LOCALE_COOKIE = "eav7-locale";

export function isLocale(value: unknown): value is LocaleCode {
  return typeof value === "string" && LOCALES.some((l) => l.code === value);
}

export function dirOf(code: LocaleCode): Dir {
  return (LOCALES.find((l) => l.code === code)?.dir as Dir) ?? "ltr";
}
