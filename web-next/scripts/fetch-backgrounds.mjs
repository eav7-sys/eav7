// Baixa os backgrounds do site via API do Pixabay para /public/bg.
// Os termos do Pixabay NÃO permitem hotlink — por isso baixamos e servimos localmente.
// A key vem de PIXABAY_API_KEY (.env.local) — nunca é embutida no código do cliente.
//
//   node scripts/fetch-backgrounds.mjs        (ou: npm run bg:fetch)
//
// Cada item usa um id fixo do Pixabay para o resultado ser sempre o mesmo.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "bg");

// curados à mão (ver o painel de candidatos): cósmico p/ hero, névoa lilás p/ claro, mosaico tech p/ rodapé
const BACKGROUNDS = [
  { id: 1867616, out: "hero-dark.jpg", note: "via láctea violeta/teal — hero escuro" },
  { id: 7258997, out: "hero-light.jpg", note: "fluido holográfico 3D pastel — hero/CTA claro" },
  { id: 11107, out: "cta-dark.jpg", note: "nebulosa de Órion — CTA escuro" },
  { id: 3320522, out: "band-dark.jpg", note: "mosaico tech violeta/azul — faixa do rodapé" },
];

function loadApiKey() {
  if (process.env.PIXABAY_API_KEY) return process.env.PIXABAY_API_KEY;
  try {
    const env = readFileSync(join(ROOT, ".env.local"), "utf8");
    const m = env.match(/^PIXABAY_API_KEY\s*=\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    /* sem .env.local */
  }
  return null;
}

async function main() {
  const key = loadApiKey();
  if (!key) {
    console.error("PIXABAY_API_KEY ausente. Defina em web/.env.local ou no ambiente.");
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  for (const bg of BACKGROUNDS) {
    const api = `https://pixabay.com/api/?key=${key}&id=${bg.id}&image_type=photo`;
    const res = await fetch(api);
    if (!res.ok) throw new Error(`Pixabay API ${res.status} para id ${bg.id}`);
    const data = await res.json();
    const hit = data.hits?.[0];
    if (!hit) throw new Error(`id ${bg.id} não retornou imagem`);

    const img = await fetch(hit.largeImageURL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!img.ok) throw new Error(`download falhou (${img.status}) para ${bg.out}`);
    const buf = Buffer.from(await img.arrayBuffer());
    writeFileSync(join(OUT_DIR, bg.out), buf);
    console.log(`✓ ${bg.out}  (${(buf.length / 1024) | 0} KB)  — ${bg.note}`);
  }
  console.log("\nBackgrounds atualizados em public/bg.");
  console.log("Dica: reotimize com um passe de compressão se quiser arquivos menores.");
}

main().catch((e) => {
  console.error("Falhou:", e.message);
  process.exit(1);
});
