import Link from "next/link";
import type { Metadata } from "next";
import { MarkdownLite } from "@/lib/markdown-lite";
import {
  loadWhitepaperMarkdown,
  resolveWhitepaperLang,
  whitepaperToc,
  type WhitepaperLang,
} from "@/lib/whitepaper";
import { getLocale, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const locale = await getLocale();
  const lang = resolveWhitepaperLang(locale);
  return {
    title: t("page_whitepaper.metaTitle"),
    description: t("page_whitepaper.metaDesc"),
    alternates: {
      languages: {
        pt: "/whitepaper?lang=pt",
        en: "/whitepaper?lang=en",
      },
    },
    openGraph: {
      title: lang === "en" ? "EAV7 Technical Whitepaper v1.0" : "Whitepaper técnico EAV7 v1.0",
      description: t("page_whitepaper.metaDesc"),
      url: "https://eavscan.com/whitepaper",
    },
  };
}

function pickLang(searchLang: string | undefined, locale: string): WhitepaperLang {
  if (searchLang === "en" || searchLang === "pt") return searchLang;
  return resolveWhitepaperLang(locale);
}

export default async function WhitepaperPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const t = await getT();
  const locale = await getLocale();
  const sp = await searchParams;
  const lang = pickLang(sp.lang, locale);
  const source = loadWhitepaperMarkdown(lang);
  const toc = whitepaperToc(source);
  const rawHref = lang === "en" ? "/docs/whitepaper.en.md" : "/docs/whitepaper.md";
  const other: WhitepaperLang = lang === "en" ? "pt" : "en";

  return (
    <main className="scan mx-auto max-w-[1120px] px-5 pb-20 pt-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
            {t("page_whitepaper.kicker")}
          </p>
          <h1 className="font-display mt-2 text-[clamp(26px,4vw,40px)] font-extrabold tracking-tight text-ink">
            {t("page_whitepaper.title")}
          </h1>
          <p className="mt-2 max-w-[62ch] text-[14.5px] leading-relaxed text-muted">
            {t("page_whitepaper.lead")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/whitepaper?lang=${other}`}
            className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-muted transition hover:border-violet/40 hover:text-ink"
          >
            {other === "en" ? t("page_whitepaper.switchEn") : t("page_whitepaper.switchPt")}
          </Link>
          <a
            href={rawHref}
            download
            className="rounded-lg border border-line bg-[var(--input-bg)] px-3 py-1.5 text-[12.5px] font-semibold text-ink transition hover:border-teal/40"
          >
            {t("page_whitepaper.downloadMd")}
          </a>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_210px]">
        <article className="min-w-0 rounded-2xl border border-line bg-panel/30 p-5 sm:p-8">
          <MarkdownLite source={source} />
        </article>

        {toc.length > 0 && (
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <div className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[1.5px] text-faint">
                {t("page_whitepaper.onThisPage")}
              </div>
              <nav className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto border-l border-line pr-1">
                {toc.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="-ml-px border-l-2 border-transparent px-3 py-1.5 text-[12px] leading-snug text-muted transition hover:border-violet hover:text-ink"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
