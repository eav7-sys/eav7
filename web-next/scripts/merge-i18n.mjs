// Mescla as contribuições de src/i18n/messages/_parts/*.json em generated.ts.
// Uso: node scripts/merge-i18n.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOCALES = ["pt", "en", "es", "zh", "fr", "de", "ja", "ru", "ar", "hi", "ko", "it"];
const partsDir = "src/i18n/messages/_parts";
const out = "src/i18n/messages/generated.ts";

const generated = Object.fromEntries(LOCALES.map((l) => [l, {}]));
let files = [];
try {
  files = readdirSync(partsDir).filter((f) => f.endsWith(".json"));
} catch {
  console.error("Sem _parts/ — nada a mesclar.");
}

let nsCount = 0;
for (const f of files.sort()) {
  let part;
  try {
    part = JSON.parse(readFileSync(join(partsDir, f), "utf8"));
  } catch (e) {
    console.warn(`! JSON inválido, pulando ${f}: ${e.message}`);
    continue;
  }
  const { namespace, translations } = part ?? {};
  if (!namespace || !translations) {
    console.warn(`! Sem namespace/translations em ${f}`);
    continue;
  }
  nsCount++;
  for (const l of LOCALES) {
    // fallback de idioma faltante: usa pt (ou en) para não perder chaves
    generated[l][namespace] = translations[l] ?? translations.pt ?? translations.en ?? {};
  }
}

const body = `import type { LocaleCode } from "../locales";

// Namespaces das telas internas, mesclados sobre o chrome em dictionary.ts.
// Gerado por scripts/merge-i18n.mjs a partir de _parts/. NÃO editar à mão.
export const generated: Record<LocaleCode, Record<string, unknown>> = ${JSON.stringify(generated, null, 2)};
`;
writeFileSync(out, body);
console.log(`OK: ${nsCount} namespaces de ${files.length} arquivos -> ${out}`);
