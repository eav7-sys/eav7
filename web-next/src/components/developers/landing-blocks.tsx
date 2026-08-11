import Link from "next/link";
import { IconArrowUpRight } from "@/components/icons";

export interface PathRow {
  href: string;
  title: string;
  desc: string;
  meta: string;
}

/**
 * Os caminhos de entrada, em lista editorial. Não é uma grade de cartões de
 * propósito: são três decisões em sequência, e uma lista lê como sequência.
 */
export function PathList({ rows }: { rows: PathRow[] }) {
  return (
    <div className="border-t border-line">
      {rows.map((row, i) => (
        <Link
          key={row.href}
          href={row.href}
          className="group grid items-baseline gap-x-8 gap-y-2 border-b border-line py-7 transition-colors hover:bg-violet/[0.035] sm:grid-cols-[52px_minmax(0,1fr)_auto] sm:py-8"
        >
          <span className="font-mono text-[11px] font-semibold tracking-[1.5px] text-faint transition-colors group-hover:text-violet">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="min-w-0">
            <span className="font-display block text-[clamp(20px,2.6vw,27px)] font-extrabold tracking-[-0.02em] transition-colors group-hover:text-violet">
              {row.title}
            </span>
            <span className="mt-2 block max-w-[56ch] text-[14px] leading-relaxed text-muted">
              {row.desc}
            </span>
          </span>
          <span className="font-mono flex items-center gap-2 text-[11px] uppercase tracking-[1.2px] text-faint transition-all group-hover:translate-x-1 group-hover:text-ink">
            {row.meta}
            <IconArrowUpRight size={13} />
          </span>
        </Link>
      ))}
    </div>
  );
}

export interface IndexEntry {
  href: string;
  title: string;
  desc: string;
}

/** Índice do portal — o mapa completo, em duas colunas de leitura. */
export function PortalIndex({ entries }: { entries: IndexEntry[] }) {
  return (
    <div className="grid gap-x-12 sm:grid-cols-2">
      {entries.map((entry) => (
        <Link
          key={entry.href}
          href={entry.href}
          className="group flex flex-col gap-1.5 border-b border-line py-5 transition-colors hover:border-violet/40"
        >
          <span className="font-display flex items-center gap-2 text-[15.5px] font-bold text-ink transition-colors group-hover:text-violet">
            {entry.title}
            <IconArrowUpRight
              size={13}
              className="text-faint transition-transform group-hover:translate-x-0.5"
            />
          </span>
          <span className="text-[13.5px] leading-relaxed text-muted">{entry.desc}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * O índice em seções. Com mais de vinte páginas, uma lista corrida deixa de ser
 * um mapa: a divisão por grupo é a mesma da navegação lateral, de propósito.
 */
export function PortalIndexGroups({
  groups,
}: {
  groups: { title: string; entries: IndexEntry[] }[];
}) {
  return (
    <div className="space-y-11">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="font-mono mb-1.5 text-[10px] font-semibold uppercase tracking-[1.6px] text-violet">
            {group.title}
          </div>
          <PortalIndex entries={group.entries} />
        </div>
      ))}
    </div>
  );
}

/** Faixa final: uma frase, duas ações, o mesmo plano atmosférico da abertura. */
export function DevCtaBand({
  title,
  lede,
  primary,
  secondary,
}: {
  title: string;
  lede: string;
  primary: { href: string; label: string };
  secondary: { href: string; label: string };
}) {
  return (
    <section className="dev-band relative isolate overflow-hidden border-y border-line">
      <div className="mx-auto max-w-[1240px] px-5 py-20 text-center sm:py-24">
        <h2 className="font-display mx-auto max-w-[18ch] text-[clamp(28px,4.4vw,44px)] font-extrabold leading-[1.06] tracking-[-0.025em]">
          {title}
        </h2>
        <p className="mx-auto mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted">{lede}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={primary.href} className="btn-primary btn-lg">
            {primary.label}
          </Link>
          <Link href={secondary.href} className="btn-ghost btn-lg">
            {secondary.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
