import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DOCS, DOC_SLUGS } from "@/lib/docs";
import { Reveal } from "@/components/ui/reveal";
import { Copy } from "@/components/ui/copy";
import { DocHero } from "@/components/docs/doc-hero";
import { SecuritySentinel } from "@/components/docs/security-sentinel";
import { getT } from "@/i18n/server";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const t = await getT();
  const { slug } = await params;
  const doc = DOCS[slug];
  return { title: doc ? `${doc.title} · EAV7 Scan` : t("page_docs.metaTitleFallback") };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const t = await getT();
  const { slug } = await params;
  const doc = DOCS[slug];
  if (!doc) notFound();

  const toc = doc.sections
    .filter((s) => s.h)
    .map((s) => ({ id: slugify(s.h as string), label: s.h as string }));

  return (
    <div className="mx-auto max-w-[1120px] px-5 py-8">
      {/* cabeçalho */}
      <div className="rise mb-8">
        <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[2px] text-teal">
          <Link href="/docs/sobre" className="text-faint transition hover:text-teal">
            {t("page_docs.breadcrumb")}
          </Link>
          <span className="text-faint">/</span>
          <span>{slug}</span>
        </div>
        <h1 className="font-display mt-2 text-[clamp(26px,4vw,40px)] font-extrabold leading-tight tracking-tight">
          {doc.title}
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-muted">{doc.sub}</p>
      </div>

      <DocHero slug={slug} />

      {/* Reports ao vivo da sentinela de IA — funcional na página de segurança */}
      {slug === "seguranca" && <SecuritySentinel />}

      <div className="grid gap-8 lg:grid-cols-[1fr_210px]">
        {/* conteúdo */}
        <div className="min-w-0 space-y-4">
          {doc.sections.map((s, i) => {
            const id = s.h ? slugify(s.h) : undefined;
            return (
              <Reveal key={i} delay={i * 40}>
                <section id={id} className="card scroll-mt-24 p-6 sm:p-7">
                  {s.h && (
                    <h2 className="font-display mb-3 flex items-center gap-2.5 text-[17px] font-bold">
                      <span className="h-4 w-1 rounded-full bg-gradient-to-b from-violet to-teal" />
                      {s.h}
                    </h2>
                  )}
                  {s.p && <p className="text-[14px] leading-relaxed text-muted">{s.p}</p>}
                  {s.kv && (
                    <dl className="mt-1 divide-y divide-line/60">
                      {s.kv.map(([label, value], j) => (
                        <div key={j} className="grid gap-1 py-3 sm:grid-cols-[240px_1fr] sm:gap-5">
                          <dt className="text-[13px] font-semibold text-ink">{label}</dt>
                          <dd className="break-words text-[13px] leading-relaxed text-muted">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {s.code && (
                    <div className="code-term mt-1 overflow-hidden rounded-xl">
                      <div className="code-term-bar flex items-center justify-between px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                          <span className="ml-2 font-mono text-[10.5px] uppercase tracking-wide">
                            {t("page_docs.terminal")}
                          </span>
                        </div>
                        <Copy text={s.code} />
                      </div>
                      <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed">
                        {s.code}
                      </pre>
                    </div>
                  )}
                </section>
              </Reveal>
            );
          })}
        </div>

        {/* índice fixo */}
        {toc.length > 0 && (
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <div className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[1.5px] text-faint">
                {t("page_docs.onThisPage")}
              </div>
              <nav className="flex flex-col gap-1 border-l border-line">
                {toc.map((t) => (
                  <a
                    key={t.id}
                    href={`#${t.id}`}
                    className="-ml-px border-l-2 border-transparent px-3 py-1.5 text-[12.5px] text-muted transition hover:border-violet hover:text-ink"
                  >
                    {t.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
