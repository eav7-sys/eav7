"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { devPager, type DevRoute } from "./nav-data";
import { useT } from "@/i18n/provider";

function Card({ route, dir }: { route: DevRoute; dir: "prev" | "next" }) {
  const t = useT();
  return (
    <Link
      href={route.href}
      className={`group flex flex-col gap-1 rounded-xl border border-line px-5 py-4 transition-colors hover:border-line-2 hover:bg-panel/50 ${
        dir === "next" ? "items-end text-right sm:col-start-2" : "items-start"
      }`}
    >
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[1.4px] text-faint">
        {t(dir === "prev" ? "dev.pager.prev" : "dev.pager.next")}
      </span>
      <span className="font-display text-[15px] font-bold text-ink transition-colors group-hover:text-violet">
        {t(route.key)}
      </span>
    </Link>
  );
}

/** Anterior / próximo na ordem de leitura do portal. */
export function DevPager() {
  const pathname = usePathname();
  const { prev, next } = devPager(pathname);
  if (!prev && !next) return null;

  return (
    <nav className="mt-16 grid gap-3 border-t border-line pt-8 sm:grid-cols-2">
      {prev && <Card route={prev} dir="prev" />}
      {next && <Card route={next} dir="next" />}
    </nav>
  );
}
