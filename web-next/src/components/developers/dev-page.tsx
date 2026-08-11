import type { ReactNode } from "react";
import Link from "next/link";

/** Cabeçalho editorial de uma página do portal. */
export function DevPageHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="rise mb-12">
      <div className="font-mono flex items-center gap-2.5 text-[10.5px] font-semibold uppercase tracking-[2px] text-teal">
        <span className="h-px w-6 bg-gradient-to-r from-teal to-transparent" />
        {eyebrow}
      </div>
      <h1 className="font-display mt-4 text-[clamp(30px,5vw,48px)] font-extrabold leading-[1.04] tracking-[-0.025em]">
        {title}
      </h1>
      <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-muted">{lede}</p>
    </header>
  );
}

/** Seção com regra superior e título — uma seção, um assunto. */
export function DevSection({
  id,
  kicker,
  title,
  intro,
  children,
}: {
  id: string;
  kicker?: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-line pt-9 first:border-t-0 first:pt-0">
      {kicker && (
        <div className="font-mono mb-2 text-[10px] font-semibold uppercase tracking-[1.6px] text-faint">
          {kicker}
        </div>
      )}
      <h2 className="font-display text-[clamp(20px,2.6vw,26px)] font-extrabold tracking-[-0.015em]">
        {title}
      </h2>
      {intro && <p className="mt-3 max-w-[68ch] text-[14.5px] leading-relaxed text-muted">{intro}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** Empilha as seções com o respiro editorial do portal. */
export function DevSections({ children }: { children: ReactNode }) {
  return <div className="space-y-14">{children}</div>;
}

const CALLOUT_TONE = {
  note: { bar: "bg-violet", label: "text-violet" },
  warn: { bar: "bg-gold", label: "text-gold" },
  ok: { bar: "bg-teal", label: "text-teal" },
} as const;

export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: keyof typeof CALLOUT_TONE;
  title: string;
  children: ReactNode;
}) {
  const style = CALLOUT_TONE[tone];
  return (
    <div className="relative overflow-hidden rounded-r-xl border-y border-r border-line bg-panel/40 py-4 pl-5 pr-5">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${style.bar}`} />
      <div className={`font-mono text-[10.5px] font-semibold uppercase tracking-[1.4px] ${style.label}`}>
        {title}
      </div>
      <div className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

export interface SpecRow {
  k: string;
  v: ReactNode;
  note?: string;
}

/** Lista de definição densa — parâmetros, caminhos, constantes. */
export function SpecList({ rows }: { rows: SpecRow[] }) {
  return (
    <dl className="divide-y divide-line/60 border-y border-line">
      {rows.map((row) => (
        <div key={row.k} className="grid gap-1 py-3.5 sm:grid-cols-[220px_1fr] sm:gap-6">
          <dt className="font-mono text-[12px] uppercase tracking-[0.8px] text-faint">{row.k}</dt>
          <dd className="min-w-0 break-words text-[13.5px] leading-relaxed text-ink">
            {row.v}
            {row.note && <span className="mt-0.5 block text-[12.5px] text-muted">{row.note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface TableColumn {
  label: string;
  /** largura fixa opcional, em classe tailwind */
  width?: string;
}

/** Tabela de referência — cabeçalho mono, linhas com hairline, rolagem no mobile. */
export function DevTable({
  columns,
  children,
}: {
  columns: TableColumn[];
  children: ReactNode;
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[540px] border-collapse text-left">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.label}
                className={`font-mono border-b border-line-2 pb-2.5 text-[10px] font-semibold uppercase tracking-[1.2px] text-faint ${
                  col.width ?? ""
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[12.5px] text-ink">{children}</code>;
}

/**
 * Corpo de uma [`DevTable`]. As colunas em `monoCols` saem em mono e sem quebra —
 * é onde moram nomes de método, rotas e códigos, que não são prosa.
 */
export function DevRows({
  rows,
  monoCols = [0],
}: {
  rows: { k: string; cells: ReactNode[] }[];
  monoCols?: number[];
}) {
  return (
    <>
      {rows.map((row) => (
        <tr key={row.k} className="border-b border-line/50 transition-colors hover:bg-violet/[0.04]">
          {row.cells.map((cell, i) =>
            monoCols.includes(i) ? (
              <td key={i} className="py-2.5 pr-6 align-top">
                <code className="font-mono whitespace-nowrap text-[12.5px] font-semibold text-ink">
                  {cell}
                </code>
              </td>
            ) : (
              <td key={i} className="py-2.5 pr-6 align-top text-[13px] leading-relaxed text-muted">
                {cell}
              </td>
            ),
          )}
        </tr>
      ))}
    </>
  );
}

/** Cabeçalho de seção DENTRO de uma tabela — agrupa linhas sem quebrar a grade. */
export function DevRowGroup({ title, span }: { title: string; span: number }) {
  return (
    <tr>
      <th
        colSpan={span}
        className="font-mono pb-1.5 pt-6 text-left text-[10px] font-semibold uppercase tracking-[1.6px] text-violet"
      >
        {title}
      </th>
    </tr>
  );
}

/** O que precisa estar de pé ANTES do primeiro passo de um guia. */
export function Prereqs({ title, items }: { title: string; items: ReactNode[] }) {
  return (
    <div className="rounded-xl border border-line bg-panel/40 px-5 py-4">
      <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[1.4px] text-teal">
        {title}
      </div>
      <ul className="mt-2.5 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-muted">
            <span aria-hidden className="mt-[8px] h-1 w-1 flex-none rounded-full bg-violet" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface DevStep {
  title: string;
  body?: ReactNode;
  children?: ReactNode;
}

/**
 * Os passos de uma receita, numerados sobre um trilho. Um guia é uma sequência:
 * a numeração é o conteúdo, não decoração — quem pula um passo quer saber qual.
 */
export function DevSteps({ steps }: { steps: DevStep[] }) {
  return (
    <ol className="ml-[14px] space-y-9 border-l border-line pl-8">
      {steps.map((step, i) => (
        <li key={step.title} className="relative">
          <span className="font-mono absolute -left-[46px] top-px grid h-7 w-7 place-items-center rounded-full border border-line-2 bg-ground text-[11px] font-bold text-violet">
            {i + 1}
          </span>
          <h3 className="font-display text-[15.5px] font-bold leading-snug text-ink">{step.title}</h3>
          {step.body && (
            <p className="mt-2 max-w-[66ch] text-[13.5px] leading-relaxed text-muted">{step.body}</p>
          )}
          {step.children && <div className="mt-4">{step.children}</div>}
        </li>
      ))}
    </ol>
  );
}

/** Lista de saídas da página: para onde ir depois, e por quê. */
export function DevLinkList({
  items,
}: {
  items: { href: string; label: string; desc: string; mono?: boolean }[];
}) {
  return (
    <ul className="divide-y divide-line/60 border-y border-line">
      {items.map((item) => (
        <li key={item.href + item.label}>
          <Link
            href={item.href}
            className="group flex flex-col gap-1 py-3.5 transition-colors sm:flex-row sm:items-baseline sm:gap-6"
          >
            <span
              className={`w-[200px] flex-none font-bold text-ink transition-colors group-hover:text-violet ${
                item.mono ? "font-mono text-[13px]" : "font-display text-[14px]"
              }`}
            >
              {item.label}
            </span>
            <span className="text-[13.5px] leading-relaxed text-muted">{item.desc}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
