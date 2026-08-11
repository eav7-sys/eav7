"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import type { Account } from "@/lib/wallet-crypto";
import { getAddressTxs, requestFaucet, FAUCET_URL } from "@/lib/api";
import { useAccountInfo, useChainId } from "./use-account-info";
import { SendFlow } from "./send-flow";
import { StakePanel } from "./stake-panel";
import { AddNetworkButton } from "./add-network-button";
import { Copy } from "@/components/ui/copy";
import { TxBadge } from "@/components/tx-badge";
import { TxValue } from "@/components/tx-value";
import { Ago } from "@/components/ui/ago";
import { TxLink } from "@/components/hash-link";
import { fmt, fmtCompact, shortHash } from "@/lib/format";
import { IconValidator, IconAi, IconQuantumKey } from "@/components/icons";
import { IconSend, IconReceive, IconStakeLock } from "./wallet-icons";
import { PartnerTranchePanel } from "./partner-tranche-panel";
import { PARTNER_TRANCHE_ENABLED, isPartnerOwner } from "@/lib/partner-tranche";
import { useT } from "@/i18n/provider";
import "@/components/scan/tokens.css";

type Panel = "none" | "send" | "stake" | "receive" | "partner";
type Tab = "portfolio" | "activity" | "addresses" | "security";

const UNIT = 1_000_000n;

function tierOf(stakedEav7: number): { key: "validator" | "fee_zero" | "standard"; cls: string; next: number | null } {
  if (stakedEav7 >= 1000) return { key: "validator", cls: "badge-violet", next: null };
  if (stakedEav7 >= 100) return { key: "fee_zero", cls: "badge-green", next: 1000 };
  return { key: "standard", cls: "", next: 100 };
}

export function AccountView({
  account,
  onLock,
  onWipe,
}: {
  account: Account;
  onLock: () => void;
  onWipe: () => void;
}) {
  const t = useT();
  const { data: info, refetch } = useAccountInfo(account.evm);
  const chainId = useChainId();
  const [panel, setPanel] = useState<Panel>("none");
  const [tab, setTab] = useState<Tab>("portfolio");
  const [showWipe, setShowWipe] = useState(false);
  const [faucet, setFaucet] = useState<{ s: "idle" | "loading" | "ok" | "error"; msg?: string }>({ s: "idle" });

  async function claimFaucet() {
    setFaucet({ s: "loading" });
    try {
      await requestFaucet(account.eav7);
      setFaucet({ s: "ok" });
      setTimeout(() => refetch(), 1500);
    } catch (e) {
      setFaucet({ s: "error", msg: e instanceof Error ? e.message : t("wallet_account.faucet.error") });
    }
  }

  const { data: txsData } = useQuery({
    queryKey: ["addrtxs", account.evm],
    queryFn: () => getAddressTxs(account.evm, 6),
    refetchInterval: 5000,
  });
  const txs = txsData?.txs ?? [];

  const balance = BigInt(info?.balance ?? "0");
  const staked = BigInt(info?.staked ?? "0");
  const total = balance + staked;
  const stakedEav7 = Number(staked / UNIT);
  const tier = tierOf(stakedEav7);
  const tierLabel = t(`wallet_account.tier.${tier.key}`);
  const role = info?.isValidator
    ? t("wallet_account.role.validator")
    : info?.oracle
      ? t("wallet_account.role.oracle")
      : t("wallet_account.role.account");

  const balPct = total > 0n ? Number((balance * 10000n) / total) / 100 : 100;
  const stkPct = total > 0n ? Number((staked * 10000n) / total) / 100 : 0;

  const initial = (account.eav7.replace(/^E7/i, "").charAt(0) || "7").toUpperCase();
  const displayName = shortHash(account.eav7, 6, 4);

  function downloadBackup() {
    const blob = new Blob([JSON.stringify({ chain: "EAV7", ...account }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `eav7-${account.eav7.slice(0, 10)}.json`;
    a.click();
  }

  const menu: { id: Tab; label: string }[] = [
    { id: "portfolio", label: t("wallet_account.nav.portfolio") },
    { id: "activity", label: t("wallet_account.nav.activity") },
    { id: "addresses", label: t("wallet_account.nav.addresses") },
    { id: "security", label: t("wallet_account.nav.security") },
  ];

  return (
    <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-6 px-6 py-9 lg:grid-cols-[250px_1fr] lg:items-start">
      {/* sidebar — Área restrita */}
      <aside className="scan-glass sticky top-[88px] rounded-2xl p-3.5">
        <div className="mb-2.5 flex items-center gap-3 border-b border-[var(--scan-border-soft)] px-2.5 pb-4 pt-2.5">
          <div
            className="grid h-10 w-10 flex-none place-items-center rounded-xl text-[16px] font-bold text-white"
            style={{ background: "linear-gradient(135deg,#7242D4,#4B2694)" }}
          >
            {initial}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-bold text-ink">{displayName}</div>
            <div className="truncate text-[11.5px] text-faint">{role}</div>
          </div>
        </div>

        {menu.map((m) => {
          const active = tab === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setTab(m.id)}
              className={`mb-0.5 w-full rounded-[9px] px-3 py-2.5 text-left text-[13px] font-semibold transition ${
                active
                  ? "bg-[var(--scan-chip)] text-[var(--scan-link)]"
                  : "text-ink hover:bg-[var(--scan-hover)]"
              }`}
            >
              {m.label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onLock}
          className="mt-2 w-full border-t border-[var(--scan-border-soft)] px-3 pb-2.5 pt-3.5 text-left text-[13px] font-semibold text-muted transition hover:bg-[var(--scan-hover)] hover:text-ink"
        >
          {t("wallet_account.lock.button")}
        </button>
        <button
          type="button"
          onClick={() => setShowWipe(true)}
          className="w-full rounded-[9px] px-3 py-2.5 text-left text-[13px] font-semibold text-[var(--red)] transition hover:bg-[var(--scan-hover)]"
        >
          {t("wallet_account.nav.logout")}
        </button>
      </aside>

      {/* main */}
      <div className="min-w-0">
        {tab === "portfolio" && (
          <div className="scan-in">
            <h1 className="mb-[18px] font-display text-[23px] font-bold tracking-[-0.02em] text-ink">
              {t("wallet_account.portfolio.title")}
            </h1>

            {/* total value — gradient card */}
            <div
              className="mb-4 rounded-2xl border px-[24px] py-[22px]"
              style={{
                background:
                  "linear-gradient(135deg,rgba(99,54,196,0.25),rgba(99,54,196,0.05)), var(--scan-card)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
                borderColor: "rgba(99,54,196,0.4)",
              }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">
                {t("wallet_account.portfolio.totalValue")}
              </div>
              <div className="mt-1.5 font-display text-[32px] font-bold tracking-[-0.01em] text-ink">
                {info ? fmt(String(total)) : "—"}{" "}
                <span className="text-[16px] font-semibold text-muted">EAV7</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`badge ${tier.cls}`}>
                  {info?.isValidator ? <IconValidator size={12} /> : info?.oracle ? <IconAi size={12} /> : null}
                  {tierLabel}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--scan-chip)] px-2.5 py-1 text-[11px] font-semibold text-[var(--scan-link)]">
                  <span className="scan-live" aria-hidden />
                  {t("wallet_account.badge.secure")}
                </span>
              </div>
            </div>

            {/* wallet card + composition */}
            <div className="scan-glass mb-3.5 rounded-2xl px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[14px] font-bold text-ink">
                    {t("wallet_account.portfolio.walletLabel")} · {displayName}
                  </div>
                  <Link
                    href={`/address/${account.eav7}`}
                    className="mt-1 block font-mono text-[12px] font-semibold text-[var(--scan-link)] hover:underline"
                  >
                    {shortHash(account.eav7, 10, 8)}
                  </Link>
                </div>
                <div className="shrink-0 text-[18px] font-bold text-ink">
                  {info ? fmtCompact(info.balance) : "—"}{" "}
                  <span className="text-[12px] font-semibold text-faint">EAV7</span>
                </div>
              </div>

              <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                {t("wallet_account.portfolio.composition")}
              </div>
              <div className="flex h-[9px] overflow-hidden rounded-[5px] bg-[var(--input-bg)]">
                <div style={{ width: `${balPct}%`, background: "#6336C4" }} />
                <div style={{ width: `${stkPct}%`, background: "#9F7BFF" }} />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-4">
                <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  <span className="inline-block h-[9px] w-[9px] rounded-[3px]" style={{ background: "#6336C4" }} />
                  {t("wallet_account.portfolio.available")} · {balPct.toFixed(0)}%
                </div>
                <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  <span className="inline-block h-[9px] w-[9px] rounded-[3px]" style={{ background: "#9F7BFF" }} />
                  {t("wallet_account.portfolio.staked")} · {stkPct.toFixed(0)}%
                </div>
              </div>

              {/* ações */}
              <div className="mt-5 grid grid-cols-3 gap-2.5">
                <ActionButton label={t("wallet_account.actions.send")} onClick={() => setPanel("send")} icon={<IconSend size={18} />} />
                <ActionButton label={t("wallet_account.actions.receive")} onClick={() => setPanel("receive")} icon={<IconReceive size={18} />} />
                <ActionButton label={t("wallet_account.actions.stake")} onClick={() => setPanel("stake")} icon={<IconStakeLock size={18} />} />
              </div>
              {PARTNER_TRANCHE_ENABLED && isPartnerOwner(account.evm) && (
                <button
                  type="button"
                  onClick={() => setPanel("partner")}
                  className="mt-2.5 w-full rounded-[10px] border border-[var(--scan-border)] py-2.5 text-[12.5px] font-semibold text-[var(--scan-link)] transition hover:bg-[var(--scan-hover)]"
                >
                  Parceiro
                </button>
              )}
            </div>

            {/* stats overview */}
            <div className="mb-4 grid gap-3.5 sm:grid-cols-3">
              <StatCard label={t("wallet_account.stats.staked")} value={info ? fmtCompact(info.staked) : "—"} suffix="EAV7" />
              <StatCard label={t("wallet_account.stats.nonce")} value={info ? String(info.nonce) : "—"} />
              <StatCard
                label={t("wallet_account.stats.fee")}
                value={info?.feeExempt ? t("wallet_account.stats.fee_zero") : t("wallet_account.stats.fee_standard")}
                accent={info?.feeExempt}
              />
            </div>

            {tier.next && (
              <div className="scan-glass mb-4 rounded-2xl px-5 py-4">
                <div className="mb-1.5 flex items-center justify-between font-mono text-[11px]">
                  <span className="text-muted">{t("wallet_account.tier_progress.label")}</span>
                  <span className="text-ink">
                    {stakedEav7.toLocaleString("pt-BR")} / {tier.next.toLocaleString("pt-BR")}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--input-bg)]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(100, (stakedEav7 / tier.next) * 100)}%`,
                      background: "linear-gradient(90deg,#6336C4,#9F7BFF)",
                    }}
                  />
                </div>
                <div className="mt-1.5 font-mono text-[11px] text-muted">
                  {t("wallet_account.tier_progress.remaining_prefix")}{" "}
                  <b className="text-ink">{Math.max(0, tier.next - stakedEav7).toLocaleString("pt-BR")} EAV7</b>{" "}
                  {t("wallet_account.tier_progress.remaining_suffix", {
                    tier: tier.next === 100 ? t("wallet_account.tier.fee_zero") : t("wallet_account.tier.validator"),
                  })}
                </div>
              </div>
            )}

            {FAUCET_URL && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[rgba(243,156,18,0.35)] bg-[rgba(243,156,18,0.08)] px-4 py-3">
                <span className="font-mono text-[11.5px] font-semibold uppercase tracking-wide text-[var(--gold)]">
                  Testnet faucet
                </span>
                <div className="flex items-center gap-2">
                  {faucet.s === "ok" && <span className="text-[12.5px] font-semibold text-ok">{t("wallet_account.faucet.ok")}</span>}
                  {faucet.s === "error" && <span className="text-[12px] text-[var(--red)]">{faucet.msg}</span>}
                  <button
                    type="button"
                    onClick={claimFaucet}
                    disabled={faucet.s === "loading"}
                    className="rounded-[10px] bg-[var(--scan-primary)] px-4 py-1.5 text-[12.5px] font-bold text-white transition hover:bg-[var(--scan-primary-h)] disabled:opacity-60"
                  >
                    {faucet.s === "loading" ? t("wallet_account.faucet.loading") : t("wallet_account.faucet.button")}
                  </button>
                </div>
              </div>
            )}

            <AddNetworkButton />
          </div>
        )}

        {tab === "activity" && (
          <div className="scan-in">
            <h1 className="mb-[18px] font-display text-[23px] font-bold tracking-[-0.02em] text-ink">
              {t("wallet_account.activity.title")}
            </h1>
            <div className="scan-glass overflow-hidden rounded-2xl">
              {txs.length === 0 ? (
                <div className="px-5 py-10 text-center text-[13px] text-muted">{t("wallet_account.activity.empty")}</div>
              ) : (
                txs.map((tx) => {
                  const out = tx.from?.toUpperCase() === account.eav7.toUpperCase();
                  return (
                    <div
                      key={tx.id}
                      className="scan-row flex items-center gap-3.5 px-5 py-3.5"
                    >
                      <span
                        className="grid h-9 w-9 flex-none place-items-center rounded-[11px]"
                        style={{
                          background: out ? "rgba(231,76,60,0.14)" : "rgba(46,204,113,0.14)",
                          color: out ? "var(--red)" : "var(--ok)",
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {out ? <path d="M7 17 17 7M8 7h9v9" /> : <path d="M17 7 7 17M16 17H7V8" />}
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-ink">
                            {out ? t("wallet_account.activity.sent") : t("wallet_account.activity.received")}
                          </span>
                          <TxBadge type={tx.type} />
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-faint">
                          <Ago ts={tx.timestamp} /> · <TxLink id={tx.id} len={8} />
                        </div>
                      </div>
                      <TxValue tx={tx} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {tab === "addresses" && (
          <div className="scan-in">
            <h1 className="mb-[18px] font-display text-[23px] font-bold tracking-[-0.02em] text-ink">
              {t("wallet_account.nav.addresses")}
            </h1>
            <div className="scan-glass overflow-hidden rounded-2xl">
              <div className="grid grid-cols-[72px_1fr_40px] gap-3 border-b border-[var(--scan-border-soft)] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
                <div>{t("wallet_account.addresses.colFormat")}</div>
                <div>{t("wallet_account.addresses.colAddress")}</div>
                <div />
              </div>
              <AddrRow label="E7" value={account.eav7} />
              <AddrRow label="0x" value={account.evm} hint={t("wallet_account.addresses.hint")} />
            </div>

            {info && Object.keys(info.tokens ?? {}).length > 0 && (
              <div className="scan-glass mt-4 overflow-hidden rounded-2xl">
                <div className="border-b border-[var(--scan-border-soft)] px-5 py-3.5 text-[14px] font-bold">
                  {t("wallet_account.tokens.title")}
                </div>
                {Object.entries(info.tokens).map(([id, tk]) => (
                  <div key={id} className="scan-row flex items-center justify-between px-5 py-3 text-[13px]">
                    <span className="font-bold text-ink">{tk.symbol ?? "—"}</span>
                    <span className="tnum font-mono text-muted">{tk.balance ?? "0"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "security" && (
          <div className="scan-in">
            <h1 className="mb-[18px] font-display text-[23px] font-bold tracking-[-0.02em] text-ink">
              {t("wallet_account.nav.security")}
            </h1>
            <div className="mb-3.5 grid gap-3.5 sm:grid-cols-2">
              <div className="scan-glass rounded-2xl px-6 py-5">
                <div className="flex items-center justify-between">
                  <div className="text-[14px] font-bold text-ink">{t("wallet_account.security.lockTitle")}</div>
                  <button
                    type="button"
                    onClick={onLock}
                    className="text-[12px] font-semibold text-[var(--scan-link)] hover:underline"
                  >
                    {t("wallet_account.lock.button")}
                  </button>
                </div>
                <div className="mt-2 text-[12.5px] text-muted">{t("wallet_account.security.lockDesc")}</div>
              </div>
              <div className="scan-glass rounded-2xl px-6 py-5">
                <div className="flex items-center justify-between">
                  <div className="text-[14px] font-bold text-ink">{t("wallet_account.security.quantumTitle")}</div>
                  <span className="rounded-md bg-[rgba(46,204,113,0.14)] px-2.5 py-1 text-[10.5px] font-bold text-[var(--ok)]">
                    ON
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted">
                  <IconQuantumKey size={13} />
                  {t("wallet_account.security.quantumDesc")}
                </div>
              </div>
            </div>
            <div className="scan-glass rounded-2xl px-6 py-5">
              <div className="text-[14px] font-bold text-ink">{t("wallet_account.wipe.title")}</div>
              <p className="mt-2 max-w-[52ch] text-[12.5px] leading-relaxed text-muted">
                {t("wallet_account.wipe.description_before")}{" "}
                <b className="text-ink">{t("wallet_account.wipe.description_bold")}</b>
                {t("wallet_account.wipe.description_after")}
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={downloadBackup}
                  className="rounded-[10px] bg-[var(--scan-primary)] px-[18px] py-2.5 text-[12.5px] font-semibold text-white transition hover:bg-[var(--scan-primary-h)]"
                >
                  {t("wallet_account.wipe.download_backup")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowWipe(true)}
                  className="rounded-[10px] border border-[rgba(231,76,60,0.45)] px-[18px] py-2.5 text-[12.5px] font-semibold text-[var(--red)] transition hover:bg-[var(--scan-hover)]"
                >
                  {t("wallet_account.wipe.confirm")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* painéis flutuantes */}
      <AnimatePresence>
        {panel !== "none" && (
          <motion.div
            className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPanel("none")}
          >
            <motion.div
              className="mx-auto w-full max-w-[460px] pt-[8vh]"
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              {panel === "send" && (
                <SendFlow
                  account={account}
                  chainId={chainId}
                  balanceE7={info?.balance ?? "0"}
                  onClose={() => setPanel("none")}
                  onDone={() => refetch()}
                />
              )}
              {panel === "stake" && (
                <StakePanel
                  account={account}
                  chainId={chainId}
                  stakedEav7={stakedEav7}
                  onClose={() => setPanel("none")}
                  onDone={() => refetch()}
                />
              )}
              {panel === "partner" && (
                <PartnerTranchePanel
                  account={account}
                  chainId={chainId}
                  onClose={() => setPanel("none")}
                  onDone={() => refetch()}
                />
              )}
              {panel === "receive" && (
                <div className="scan-glass rounded-[20px] p-6 text-center">
                  <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-[13px] bg-[var(--scan-chip)] text-[var(--scan-link)]">
                    <IconReceive size={22} />
                  </div>
                  <h3 className="font-display text-[17px] font-bold">{t("wallet_account.receive.title")}</h3>
                  <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted">
                    {t("wallet_account.receive.description_before")} <b>0x</b> {t("wallet_account.receive.description_after")}
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2 break-all rounded-xl border border-[var(--scan-border)] bg-[var(--input-bg)] p-3.5 font-mono text-[12px] text-ink">
                    {account.evm}
                    <Copy text={account.evm} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setPanel("none")}
                    className="mt-4 w-full rounded-xl border border-[var(--scan-border)] py-3 text-[13.5px] font-semibold transition hover:bg-[var(--scan-hover)]"
                  >
                    {t("wallet_account.receive.close")}
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* modal wipe */}
      <AnimatePresence>
        {showWipe && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowWipe(false)}
          >
            <motion.div
              className="scan-glass w-full max-w-[420px] rounded-[20px] p-7 text-center"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[rgba(231,76,60,0.12)] text-[var(--red)]">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              </div>
              <h3 className="mt-4 font-display text-[19px] font-bold">{t("wallet_account.wipe.title")}</h3>
              <p className="mx-auto mt-2 max-w-[36ch] text-[13px] leading-relaxed text-muted">
                {t("wallet_account.wipe.description_before")}{" "}
                <b className="text-ink">{t("wallet_account.wipe.description_bold")}</b>
                {t("wallet_account.wipe.description_after")}
              </p>

              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[rgba(243,156,18,0.35)] bg-[rgba(243,156,18,0.08)] px-3.5 py-3 text-left text-[12.5px] text-ink">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" className="mt-0.5 flex-none">
                  <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                </svg>
                <span>
                  {t("wallet_account.wipe.warning_before")} <b>{t("wallet_account.wipe.warning_bold")}</b>{" "}
                  {t("wallet_account.wipe.warning_after")}
                </span>
              </div>

              <button
                type="button"
                onClick={downloadBackup}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[rgba(99,54,196,0.4)] bg-[rgba(99,54,196,0.12)] px-4 py-3 text-[13px] font-bold text-ink transition hover:bg-[rgba(99,54,196,0.2)]"
              >
                {t("wallet_account.wipe.download_backup")}
              </button>

              <div className="mt-3 flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowWipe(false)}
                  className="flex-1 rounded-xl border border-[var(--scan-border)] py-2.5 text-[14px] font-bold transition hover:bg-[var(--scan-hover)]"
                >
                  {t("wallet_account.wipe.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowWipe(false);
                    onWipe();
                  }}
                  className="flex-1 rounded-xl border border-[rgba(231,76,60,0.5)] bg-[rgba(231,76,60,0.15)] py-2.5 text-[14px] font-bold text-[var(--red)] transition hover:bg-[rgba(231,76,60,0.25)]"
                >
                  {t("wallet_account.wipe.confirm")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div className="scan-glass rounded-2xl px-[18px] py-4 transition hover:-translate-y-0.5 hover:border-[rgba(159,123,255,0.45)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-faint">{label}</div>
      <div className={`mt-1.5 text-[22px] font-bold ${accent ? "text-[var(--scan-link)]" : "text-ink"}`}>
        {value}
        {suffix && <span className="ml-1 text-[12px] font-semibold text-faint">{suffix}</span>}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 rounded-[12px] border border-[var(--scan-border)] py-3.5 text-[12.5px] font-semibold text-ink transition hover:-translate-y-0.5 hover:border-[rgba(159,123,255,0.45)] hover:bg-[var(--scan-hover)]"
    >
      <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-[var(--scan-chip)] text-[var(--scan-link)] transition group-hover:scale-110">
        {icon}
      </span>
      {label}
    </button>
  );
}

function AddrRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="scan-row px-5 py-3.5">
      <div className="grid grid-cols-[72px_1fr_40px] items-center gap-3">
        <span className="inline-flex w-fit rounded-md bg-[var(--scan-chip)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--scan-link)]">
          {label}
        </span>
        <span className="break-all font-mono text-[12.5px] text-[var(--scan-link)]">{value}</span>
        <Copy text={value} />
      </div>
      {hint && <div className="mt-1 pl-[84px] text-[11px] text-faint">{hint}</div>}
    </div>
  );
}
