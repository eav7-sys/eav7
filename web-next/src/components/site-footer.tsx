"use client";

import Link from "next/link";
import { Brand } from "./brand";
import { SocialIcons } from "./ui/social-icons";
import { Reveal } from "./ui/reveal";
import { FooterBackgroundGradient } from "./ui/hover-footer";
import { useT } from "@/i18n/provider";

const COLS: { titleKey: string; links: { key: string; href: string }[] }[] = [
  {
    titleKey: "menu.explore",
    links: [
      { key: "terms.home", href: "/" },
      { key: "terms.blocks", href: "/blocks" },
      { key: "terms.txs", href: "/txs" },
      { key: "terms.tokensEav20", href: "/tokens" },
      { key: "terms.validators", href: "/validators" },
    ],
  },
  {
    titleKey: "menu.network",
    links: [
      { key: "terms.walletWeb", href: "/wallet" },
      { key: "terms.mining", href: "/mining" },
      { key: "terms.staking", href: "/docs/staking" },
      { key: "terms.consensusDpos", href: "/docs/consenso" },
    ],
  },
  {
    titleKey: "menu.protocol",
    links: [
      { key: "terms.aboutEav20", href: "/docs/sobre" },
      { key: "terms.tokenStandardFull", href: "/docs/token" },
      { key: "terms.bridge", href: "/docs/ponte" },
      { key: "terms.eavm", href: "/docs/eavm" },
    ],
  },
  {
    titleKey: "footer.securityDev",
    links: [
      { key: "terms.security24", href: "/docs/seguranca" },
      { key: "terms.apiRest", href: "/docs/api" },
      { key: "terms.privacyPolicy", href: "/privacy" },
    ],
  },
];

export function SiteFooter() {
  const t = useT();
  return (
    <footer className="relative overflow-hidden border-t border-line/60">
      <div className="footer-line absolute inset-x-0 top-0" />
      {/* textura tech (Pixabay) bem sutil, só no tema escuro */}
      <div aria-hidden className="footer-photo pointer-events-none absolute inset-0 -z-10" />
      <FooterBackgroundGradient />
      <div className="mx-auto grid max-w-[1180px] gap-x-8 gap-y-10 px-5 py-14 md:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
        <Reveal className="max-w-xs">
          <Brand logoSize={30} tone="solid" />
          <p className="mt-4 text-[13px] leading-relaxed text-muted">{t("footer.tagline")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="badge">Chain ID 72020</span>
            <span className="badge badge-green">
              <span className="livedot" style={{ width: 6, height: 6 }} /> {t("footer.networkActive")}
            </span>
          </div>
        </Reveal>
        {COLS.map((c, i) => (
          <Reveal key={c.titleKey} delay={80 + i * 60}>
            <h4 className="font-mono mb-4 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {t(c.titleKey)}
            </h4>
            <ul className="flex flex-col gap-2.5">
              {c.links.map((l) => (
                <li key={l.key}>
                  <Link
                    href={l.href}
                    className="inline-block text-[13px] text-muted transition-all hover:translate-x-0.5 hover:text-ink"
                  >
                    {t(l.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-5 py-5">
          <span className="text-[12px] text-faint">
            © 2026 EAV7 Labs · Todos os direitos reservados · protocolo eav20 ·{" "}
            <span className="font-mono">SHA3-256 · secp256k1 + ML-DSA-44</span>
            {" · "}
            <Link href="/privacy" className="underline-offset-2 hover:underline">
              {`Política de Privacidade`}
            </Link>
          </span>
          <SocialIcons />
        </div>
      </div>

    </footer>
  );
}
