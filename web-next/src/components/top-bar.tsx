"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSwitcher } from "./language-switcher";
import { NetworkSwitcher } from "./network-switcher";
import { NetStatus } from "./net-status";
import { MegaMenu } from "./nav/mega-menu";
import { HeaderSearch } from "./nav/header-search";
import { useT } from "@/i18n/provider";

const NAV = [
  { href: "/", key: "terms.home" },
  { href: "/blocks", key: "terms.blocks" },
  { href: "/txs", key: "terms.txs" },
  { href: "/tokens", key: "terms.tokens" },
  { href: "/validators", key: "terms.validators" },
  { href: "/mining", key: "terms.mining" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function TopBar() {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const t = useT();

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5 sm:pt-4">
      <div className="nav-float mx-auto flex h-14 max-w-[1120px] items-center gap-3 px-3 sm:px-4">
        <Brand logoSize={32} tone="gradient" />

        <div className="ml-1">
          <MegaMenu />
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
          <HeaderSearch />

          {/* status só no desktop (pill largo) */}
          <div className="hidden lg:flex">
            <NetStatus />
          </div>

          {/* rede + carteira + idioma só a partir de tablet — no mobile vão pro drawer */}
          <div className="hidden items-center gap-2.5 sm:flex">
            <NetworkSwitcher />
            <Link href="/wallet" className="btn-primary !px-4 !py-2 text-[13px]">
              {t("terms.wallet")}
            </Link>
            <LanguageSwitcher />
          </div>

          <ThemeToggle />

          <button
            type="button"
            onClick={() => setDrawer((o) => !o)}
            aria-label={t("actions.menu")}
            aria-expanded={drawer}
            className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-panel text-ink lg:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {drawer ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {/* drawer mobile */}
      {drawer && (
        <div className="mx-auto mt-2 max-w-[1120px] lg:hidden">
          <div className="nav-float rounded-3xl px-4 py-4">
            <nav className="grid grid-cols-2 gap-1.5">
              {NAV.map((n) => {
                const active = isActive(pathname, n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setDrawer(false)}
                    className={`rounded-lg px-3 py-2.5 text-[14px] font-semibold ${
                      active ? "bg-violet/15 text-ink" : "text-muted hover:bg-line"
                    }`}
                  >
                    {t(n.key)}
                  </Link>
                );
              })}
              <Link
                href="/wallet"
                onClick={() => setDrawer(false)}
                className="col-span-2 rounded-lg bg-gradient-to-br from-violet to-violet-deep px-3 py-2.5 text-center text-[14px] font-bold text-white"
              >
                {t("actions.openWallet")}
              </Link>
            </nav>
            {/* rede + idioma dentro do drawer no mobile */}
            <div className="mt-3 flex items-center justify-center gap-2.5 border-t border-line pt-3 sm:hidden">
              <NetworkSwitcher />
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
