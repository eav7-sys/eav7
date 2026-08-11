"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { DEV_NAV } from "./nav-data";
import { useT } from "@/i18n/provider";

function isActive(pathname: string, href: string): boolean {
  return pathname === href;
}

/** Navegação lateral fixa — o trilho ativo desliza entre os itens ao trocar de rota. */
export function DevSidebar() {
  const t = useT();
  const pathname = usePathname();
  const reduced = useReducedMotion();

  return (
    <aside className="hidden lg:block">
      {/* O índice cresceu além de uma dobra: role dentro da própria coluna em vez
          de arrastar a página inteira atrás dele. */}
      <nav
        aria-label={t("dev.nav.aria")}
        className="dev-chips sticky top-24 max-h-[calc(100svh-8rem)] overflow-y-auto pb-8 pt-8"
      >
        <Link
          href="/developers"
          className="font-mono mb-5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[2px] text-faint transition-colors hover:text-teal"
        >
          <span className="h-px w-5 bg-gradient-to-r from-violet to-teal" />
          {t("dev.nav.eyebrow")}
        </Link>

        {DEV_NAV.map((group) => (
          <div key={group.key} className="mb-6">
            <div className="font-mono mb-2 px-3 text-[10px] font-semibold uppercase tracking-[1.4px] text-faint">
              {t(group.key)}
            </div>
            <div className="relative flex flex-col">
              {group.routes.map((route) => {
                const active = isActive(pathname, route.href);
                return (
                  <Link
                    key={route.href}
                    href={route.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                      active ? "font-semibold text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="dev-rail"
                        aria-hidden
                        transition={
                          reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }
                        }
                        className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-gradient-to-b from-violet to-teal"
                      />
                    )}
                    {t(route.key)}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-8 border-t border-line pt-4">
          <Link
            href="/docs/sobre"
            className="block px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:text-ink"
          >
            {t("dev.nav.protocolDocs")}
          </Link>
          <Link
            href="/wallet"
            className="block px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:text-ink"
          >
            {t("dev.nav.wallet")}
          </Link>
        </div>
      </nav>
    </aside>
  );
}

/** Mesma navegação em telas estreitas: fita de chips rolável, colada abaixo do cabeçalho. */
export function DevMobileNav() {
  const t = useT();
  const pathname = usePathname();

  return (
    <div className="sticky top-16 z-30 -mx-5 mb-2 border-b border-line bg-ground/85 px-5 backdrop-blur-xl lg:hidden">
      <nav
        aria-label={t("dev.nav.aria")}
        className="dev-chips flex gap-1.5 overflow-x-auto py-2.5"
      >
        {DEV_NAV.flatMap((group) => group.routes).map((route) => {
          const active = isActive(pathname, route.href);
          return (
            <Link
              key={route.href}
              href={route.href}
              aria-current={active ? "page" : undefined}
              className={`flex-none rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                active
                  ? "border-violet/50 bg-violet/12 text-ink"
                  : "border-line text-muted hover:border-line-2 hover:text-ink"
              }`}
            >
              {t(route.key)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
