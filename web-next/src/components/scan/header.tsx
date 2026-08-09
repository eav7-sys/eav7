"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ExplorerSearch } from "@/components/ui/explorer-search";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { useT } from "@/i18n/provider";
import "./header.css";

interface NavItem {
  href: string;
  key: string;
}

// Itens do menu "Blockchain" (desenho: Blocos · Transações · Contratos).
// "Contratos" ficou de fora porque a rota /contracts ainda não existe no app —
// link morto no menu principal é pior que item ausente. Basta reinserir aqui
// quando a página nascer (a chave scan_chrome.navContracts já está traduzida).
const BLOCKCHAIN: NavItem[] = [
  { href: "/blocks", key: "scan_chrome.navBlocks" },
  { href: "/txs", key: "scan_chrome.navTxs" },
];

const TOP_LEVEL: NavItem[] = [
  { href: "/tokens", key: "scan_chrome.navTokens" },
  { href: "/validators", key: "scan_chrome.navValidators" },
  { href: "/governance", key: "scan_chrome.navGovernance" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

const LINK_BASE =
  "rounded-[9px] px-3 py-2 text-[13.5px] font-medium transition-colors hover:bg-line/60 hover:text-ink";

/** Marca da barra: quadrado com gradiente + "7", wordmark e selo da rede. */
function BrandMark({ label }: { label: string }) {
  return (
    <Link href="/" aria-label={label} className="flex flex-none items-center gap-2.5">
      <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-gradient-to-br from-violet to-violet-deep text-[15px] font-extrabold text-white shadow-[0_4px_14px_rgba(99,54,196,0.45)]">
        7
      </span>
      <span className="font-display text-[17px] font-extrabold tracking-[0.04em] text-ink">EAVSCAN</span>
    </Link>
  );
}

/** Menu "Blockchain": abre por clique/seta, fecha no Esc e devolve o foco ao gatilho. */
function BlockchainMenu({ pathname }: { pathname: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function items(): HTMLAnchorElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ?? []);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
      // o menu só existe no DOM depois do render, daí o adiamento
      requestAnimationFrame(() => items()[0]?.focus());
    } else if (e.key === "Escape") {
      close(false);
    }
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[i <= 0 ? list.length - 1 : i - 1]?.focus();
    } else if (e.key === "Tab") {
      // sair do menu com Tab fecha, mas deixa o foco seguir o fluxo natural
      setOpen(false);
    }
  }

  const anyActive = BLOCKCHAIN.some((n) => isActive(pathname, n.href));

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 ${LINK_BASE} ${
          open || anyActive ? "bg-line/60 text-ink" : "text-muted"
        }`}
      >
        {t("scan_chrome.navBlockchain")}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t("scan_chrome.navBlockchain")}
          onKeyDown={onMenuKey}
          className="eav-pop absolute left-0 top-[calc(100%+8px)] z-50 min-w-[190px] rounded-xl border border-line-2 bg-panel p-1.5 shadow-[var(--shadow)]"
        >
          {BLOCKCHAIN.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-2.5 text-[13.5px] transition-colors hover:bg-line/60 hover:text-ink ${
                isActive(pathname, n.href) ? "text-ink" : "text-muted"
              }`}
            >
              {t(n.key)}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScanHeader() {
  const t = useT();
  const pathname = usePathname();
  // A home tem a própria busca, em destaque. O desenho esconde a do cabeçalho
  // exatamente nessa tela (`showHeaderSearch: view !== 'home'`).
  const mostrarBusca = pathname !== "/";
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!drawer) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawer(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  const allLinks: NavItem[] = [{ href: "/", key: "scan_chrome.navHome" }, ...BLOCKCHAIN, ...TOP_LEVEL];

  return (
    <header className="eav-header sticky top-0 z-50 border-b border-line backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-4 px-4 sm:px-6">
        <BrandMark label={t("scan_chrome.brandAria")} />
        {/* selo da rede some em telas estreitas (desenho: media query em 1000px) */}
        <span className="rounded-md border border-violet/35 bg-violet/12 px-1.5 py-0.5 text-[9.5px] font-bold tracking-[0.08em] text-violet max-[1000px]:hidden">
          {t("scan_chrome.mainnet")}
        </span>

        <nav className="hidden items-center gap-1 min-[900px]:flex">
          <Link
            href="/"
            className={`${LINK_BASE} ${isActive(pathname, "/") ? "bg-line/60 text-ink" : "text-muted"}`}
          >
            {t("scan_chrome.navHome")}
          </Link>
          <BlockchainMenu pathname={pathname} />
          {TOP_LEVEL.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`${LINK_BASE} ${isActive(pathname, n.href) ? "bg-line/60 text-ink" : "text-muted"}`}
            >
              {t(n.key)}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        {/* Busca do cabeçalho. Some em ≤1120px (fica no painel móvel) e some
            TAMBÉM na home — lá a busca é o elemento central da página, e duas
            caixas de busca na mesma tela deixam o usuário escolhendo entre
            campos idênticos sem saber a diferença. É a regra `showHeaderSearch`
            do desenho: `view !== 'home'`. */}
        {mostrarBusca ? (
          <div className="w-[300px] max-w-[300px] flex-none max-[1120px]:hidden">
            <ExplorerSearch placeholder={t("scan_chrome.searchPh")} />
          </div>
        ) : null}

        <div className="hidden flex-none items-center gap-2 min-[900px]:flex">
          <LanguageSwitcher />
          <ThemeToggle />
          {/* O desenho tem login por e-mail/senha (maquete); aqui a ação real é a carteira. */}
          <Link href="/wallet" className="btn-primary !px-4 !py-2 text-[13px]">
            {t("scan_chrome.wallet")}
          </Link>
        </div>

        <div className="flex flex-none items-center gap-2 min-[900px]:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setDrawer((o) => !o)}
            aria-label={drawer ? t("scan_chrome.closeMenu") : t("scan_chrome.openMenu")}
            aria-expanded={drawer}
            aria-controls="eav-hdr-drawer"
            className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-panel text-muted transition hover:border-line-2 hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {drawer ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {drawer && (
        <div id="eav-hdr-drawer" className="eav-pop border-t border-line bg-panel px-4 py-4 min-[900px]:hidden">
          <ExplorerSearch placeholder={t("scan_chrome.searchPh")} onSubmitted={() => setDrawer(false)} />
          <nav className="mt-3 grid grid-cols-2 gap-1.5">
            {allLinks.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setDrawer(false)}
                className={`rounded-lg px-3 py-2.5 text-[14px] font-semibold ${
                  isActive(pathname, n.href) ? "bg-violet/15 text-ink" : "text-muted hover:bg-line/60"
                }`}
              >
                {t(n.key)}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
            <LanguageSwitcher />
            <Link href="/wallet" onClick={() => setDrawer(false)} className="btn-primary !px-4 !py-2 text-[13px]">
              {t("scan_chrome.wallet")}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
