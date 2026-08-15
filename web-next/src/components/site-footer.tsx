"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getStatus } from "@/lib/api";
import { fmtCompact, num } from "@/lib/format";
import { useT } from "@/i18n/provider";
import "@/components/scan/tokens.css";

/** Footer fiel ao EAVScan.dc.html. */
export function SiteFooter() {
  const t = useT();
  const statusQ = useQuery({ queryKey: ["status"], queryFn: getStatus, refetchInterval: 8_000 });
  const height = statusQ.data?.height ?? 0;
  const burned = statusQ.data?.burned ?? "0";

  return (
    <footer className="scan relative mt-16">
      <div className="h-px bg-gradient-to-r from-transparent via-[rgba(159,123,255,0.55)] to-transparent" />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[210px] w-[860px] -translate-x-1/2"
        style={{
          background: "radial-gradient(ellipse at center top, rgba(99,54,196,0.15), transparent 68%)",
        }}
      />

      <div className="relative mx-auto grid max-w-[1280px] gap-8 px-6 pb-5 pt-11 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-[26px] w-[26px] place-items-center rounded-lg text-[13px] font-extrabold text-white"
              style={{ background: "linear-gradient(135deg,#7242D4,#4B2694)" }}
            >
              7
            </span>
            <span className="font-display text-[15.5px] font-bold tracking-[0.05em]">EAVSCAN</span>
          </div>
          <p className="mt-3 max-w-[320px] text-[12.5px] leading-[1.65] text-muted">{t("scan_footer.desc")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-[var(--input-bg)] px-2.5 py-1.5 font-mono text-[10px] text-muted">
              <span className="scan-live !h-1.5 !w-1.5" aria-hidden />
              {t("scan_chrome.mainnet")} · #{num(height)}
            </span>
            <span className="inline-flex items-center rounded-lg border border-line bg-[var(--input-bg)] px-2.5 py-1.5 font-mono text-[10px] text-muted">
              ID 72020
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(231,76,60,0.3)] bg-[rgba(231,76,60,0.08)] px-2.5 py-1.5 font-mono text-[10px] text-[var(--red)]">
              <FlameIcon />
              {fmtCompact(burned)} EAV7
            </span>
          </div>
        </div>

        <FooterCol title={t("scan_footer.products")}>
          <FLink href="/">{t("scan_footer.explorer")}</FLink>
          <FLink href="/wallet">{t("scan_footer.wallet")}</FLink>
          <FLink href="/docs/ponte">{t("scan_footer.bridge")}</FLink>
          <FLink href="/mining">{t("scan_footer.mining")}</FLink>
          <FLink href="/market">{t("scan_footer.market")}</FLink>
          <FLink href="/whitepaper">{t("scan_footer.whitepaper")}</FLink>
        </FooterCol>

        <FooterCol title={t("scan_footer.dev")}>
          <FLink href="/developers">{t("scan_footer.api")}</FLink>
          <FLink href="/developers/api">{t("scan_footer.endpoints")}</FLink>
          <FLink href="/developers/eavm">{t("scan_footer.verify")}</FLink>
        </FooterCol>

        <FooterCol title={t("scan_footer.network")}>
          <FLink href="/validators">{t("scan_footer.status")}</FLink>
          <FLink href="/validators">{t("scan_footer.peers")}</FLink>
          <FLink href="/governance">{t("scan_footer.gov")}</FLink>
        </FooterCol>
      </div>

      <div className="relative mx-auto max-w-[1280px] px-6 pb-5">
        <div className="flex flex-wrap items-center justify-center gap-x-[26px] gap-y-2.5 rounded-xl border border-[var(--scan-border-soft,var(--line-2))] bg-[var(--input-bg)] px-[18px] py-2.5 font-mono text-[10px] tracking-[0.09em] text-faint">
          <span>eav20</span>
          <span>1 BLOCO/S</span>
          <span>DPoS 51</span>
          <span>SHA3-256</span>
          <span>secp256k1 + ML-DSA-44</span>
          <span>CHAIN ID 72020</span>
          <span className="text-[var(--red)]">{t("scan_footer.feesBurned")}</span>
        </div>
      </div>

      <div className="relative mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 border-t border-[var(--scan-border-soft,var(--line-2))] px-6 py-4 text-[12px] text-faint">
        <div>© 2026 {t("scan_footer.rights")}</div>
        <div className="flex gap-2.5">
          <Soc href="https://x.com/eav7" label="X">
            <path d="M4 4l16 16" />
            <path d="M20 4 4 20" />
          </Soc>
          <Soc href="https://t.me/eav7" label="Telegram">
            <path d="M22 2 11 13" />
            <path d="M22 2l-7 20-4-9-9-4z" />
          </Soc>
          <Soc href="https://github.com/eav7-sys/eav7" label="GitHub">
            <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
          </Soc>
          <Soc href="https://eavscan.com" label="Web">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18" />
            <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
          </Soc>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-[var(--scan-link,#9f7bff)]">
        {title}
      </div>
      <div className="flex flex-col gap-2.5 text-[13px] text-muted">{children}</div>
    </div>
  );
}

function FLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="transition-colors hover:text-[var(--scan-link,#9f7bff)]">
      {children}
    </Link>
  );
}

function Soc({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-line text-muted transition-colors hover:border-[rgba(159,123,255,0.5)] hover:text-[var(--scan-link)]"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </a>
  );
}

function FlameIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
