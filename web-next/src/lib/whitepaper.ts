import fs from "fs";
import path from "path";

export type WhitepaperLang = "pt" | "en";

const FILES: Record<WhitepaperLang, string> = {
  pt: "pt.md",
  en: "en.md",
};

export function resolveWhitepaperLang(locale: string): WhitepaperLang {
  return locale === "en" ? "en" : "pt";
}

export function loadWhitepaperMarkdown(lang: WhitepaperLang): string {
  const file = path.join(process.cwd(), "content", "whitepaper", FILES[lang]);
  return fs.readFileSync(file, "utf8");
}

export function whitepaperToc(source: string): { id: string; label: string }[] {
  const toc: { id: string; label: string }[] = [];
  for (const line of source.split("\n")) {
    const m = /^##\s+(.+)$/.exec(line);
    if (!m) continue;
    const label = m[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
    const id = label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    toc.push({ id, label });
  }
  return toc;
}
