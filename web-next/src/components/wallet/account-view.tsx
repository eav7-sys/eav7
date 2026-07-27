"use client";

import { useState } from "react";
import { useT } from "@/i18n/provider";
import Image from "next/image";
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

type Panel = "none" | "send" | "stake" | "receive";

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

  const stakedEav7 = info ? Number(BigInt(info.staked) / UNIT) : 0;
  const tier = tierOf(stakedEav7);
  const tierLabel = t(`wallet_account.tier.${tier.key}`);
  const role = info?.isValidator
    ? t("wallet_account.role.validator")
    : info?.oracle
      ? t("wallet_account.role.oracle")
      : t("wallet_account.role.account");

  function downloadBackup() {
    const blob = new Blob([JSON.stringify({ chain: "EAV7", ...account }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `eav7-${account.eav7.slice(0, 10)}.json`;
    a.click();
  }

  return (
    <div className="mx-auto max-w-[560px] px-5 py-10">
      {/* topo: identidade + lock */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-teal/30 bg-teal/10 px-2.5 py-1 text-[11px] font-semibold text-teal">
            <span className="livedot" style={{ width: 6, height: 6, background: "var(--teal)" }} /> {t("wallet_account.badge.secure")}
          </span>
          <span className="font-mono text-[11px] text-muted">{role}</span>
        </div>
        <button
          onClick={onLock}
          className="font-mono flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] font-semibold text-muted transition hover:text-ink"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          {t("wallet_account.lock.button")}
        </button>
      </div>

      {/* card de saldo — wallet normal, limpo */}
      <div className="card card-glow relative overflow-hidden p-6 text-center">
        <div
          className="pointer-events-none absolute -top-20 left-1/2 h-52 w-52 -translate-x-1/2 rounded-full blur-[70px]"
          style={{ background: "radial-gradient(circle, rgba(154,108,255,.4), transparent 70%)" }}
        />
        <div className="relative mx-auto mb-3 h-12 w-12">
          <div className="absolute inset-0 rounded-full blur-[18px]" style={{ background: "radial-gradient(circle, rgba(154,108,255,.6), transparent 70%)" }} />
          <Image src="/brand/eav7-coin.png" alt="EAV7" fill className="relative object-contain" />
        </div>
        <div className="relative font-mono text-[10.5px] uppercase tracking-[2px] text-muted">{t("wallet_account.balance.label")}</div>
        <div className="relative font-display tnum mt-1 text-[clamp(38px,12vw,54px)] font-black leading-none text-ink">
          {info ? fmt(info.balance) : "—"} <span className="text-[19px] font-bold text-muted">EAV7</span>
        </div>
        <div className="relative mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="font-mono flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-[12px] text-ink">
            {shortHash(account.eav7, 6, 5)}
            <Copy text={account.eav7} />
          </span>
          <span className={`badge ${tier.cls}`}>
            {info?.isValidator ? <IconValidator size={12} /> : info?.oracle ? <IconAi size={12} /> : null}
            {tierLabel}
          </span>
        </div>
      </div>

      {/* ações rápidas */}
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <ActionButton label={t("wallet_account.actions.send")} chip="chip-violet" icon={<IconSend size={20} />} onClick={() => setPanel("send")} />
        <ActionButton label={t("wallet_account.actions.receive")} chip="chip-teal" icon={<IconReceive size={20} />} onClick={() => setPanel("receive")} />
        <ActionButton label={t("wallet_account.actions.stake")} chip="chip-gold" icon={<IconStakeLock size={20} />} onClick={() => setPanel("stake")} />
      </div>

      {/* faucet — SÓ na testnet (FAUCET_URL definido só na build de testnet) */}
      {FAUCET_URL && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gold/30 bg-gold/[0.07] px-4 py-3">
          <span className="font-mono text-[11.5px] font-semibold uppercase tracking-wide text-gold">Testnet faucet</span>
          <div className="flex items-center gap-2">
            {faucet.s === "ok" && <span className="text-[12.5px] font-semibold text-ok">{t("wallet_account.faucet.ok")}</span>}
            {faucet.s === "error" && <span className="text-[12px] text-pink">{faucet.msg}</span>}
            <button
              onClick={claimFaucet}
              disabled={faucet.s === "loading"}
              className="rounded-full border border-gold/50 bg-gold/15 px-4 py-1.5 text-[12.5px] font-bold text-ink transition hover:bg-gold/25 disabled:opacity-60"
            >
              {faucet.s === "loading" ? t("wallet_account.faucet.loading") : t("wallet_account.faucet.button")}
            </button>
          </div>
        </div>
      )}

      {/* stats + tier */}
      <div className="card mt-4 p-5">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label={t("wallet_account.stats.staked")} value={info ? fmtCompact(info.staked) : "—"} suffix={t("wallet_account.stats.staked_suffix")} />
          <Stat label={t("wallet_account.stats.nonce")} value={info ? String(info.nonce) : "—"} />
          <Stat
            label={t("wallet_account.stats.fee")}
            value={info?.feeExempt ? t("wallet_account.stats.fee_zero") : t("wallet_account.stats.fee_standard")}
            highlight={info?.feeExempt}
          />
        </div>

        {tier.next && (
          <div className="mt-5 border-t border-line pt-4">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[11px]">
              <span className="text-muted">{t("wallet_account.tier_progress.label")}</span>
              <span className="text-ink">
                {stakedEav7.toLocaleString("pt-BR")} / {tier.next.toLocaleString("pt-BR")}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--line-2)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, (stakedEav7 / tier.next) * 100)}%`,
                  background: "linear-gradient(90deg,var(--teal),var(--violet))",
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
      </div>

      {/* painel ativo — como tela sobreposta */}
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
              {panel === "receive" && (
                <div className="card card-glow p-6 text-center">
                  <div className="mx-auto mb-3 h-11 w-11">
                    <IconReceive size={44} className="text-teal" />
                  </div>
                  <h3 className="font-display text-[17px] font-bold">{t("wallet_account.receive.title")}</h3>
                  <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted">
                    {t("wallet_account.receive.description_before")} <b>0x</b> {t("wallet_account.receive.description_after")}
                  </p>
                  <div className="font-mono mt-4 flex items-center justify-center gap-2 break-all rounded-xl border border-line bg-[var(--input-bg)] p-3.5 text-[12px] text-ink">
                    {account.evm}
                    <Copy text={account.evm} />
                  </div>
                  <button onClick={() => setPanel("none")} className="btn-ghost btn-sm mt-4">
                    {t("wallet_account.receive.close")}
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* atividade recente */}
      {txs.length > 0 && (
        <div className="card mt-4 p-5">
          <h3 className="font-display mb-3 text-[15px] font-bold">{t("wallet_account.activity.title")}</h3>
          <div className="flex flex-col">
            {txs.map((tx) => {
              const out = tx.from?.toUpperCase() === account.eav7.toUpperCase();
              return (
                <div key={tx.id} className="flex items-center gap-3 border-b border-line/40 py-2.5 last:border-0">
                  <span className={`icon-chip icon-chip-sm ${out ? "chip-pink" : "chip-green"}`}>
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
                    <div className="font-mono mt-0.5 text-[11px] text-faint">
                      <Ago ts={tx.timestamp} /> · <TxLink id={tx.id} len={8} />
                    </div>
                  </div>
                  <TxValue tx={tx} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* usar na MetaMask / Trust */}
      <AddNetworkButton />

      {/* endereços */}
      <div className="card mt-4 p-5">
        <AddrRow label="E7" value={account.eav7} />
        <div className="my-3 border-t border-line" />
        <AddrRow label="0x" value={account.evm} hint={t("wallet_account.addresses.hint")} />
      </div>

      {/* tokens */}
      {info && Object.keys(info.tokens ?? {}).length > 0 && (
        <div className="card mt-4 p-5">
          <h3 className="font-display mb-3 text-[15px] font-bold">{t("wallet_account.tokens.title")}</h3>
          <div className="flex flex-col gap-2">
            {Object.entries(info.tokens).map(([id, tk]) => (
              <div key={id} className="flex items-center justify-between text-[13px]">
                <span className="font-bold text-ink">{tk.symbol ?? "—"}</span>
                <span className="tnum">{tk.balance ?? "0"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* rodapé */}
      <div className="mt-5 flex items-center justify-between">
        <span className="font-mono flex items-center gap-1.5 text-[11px] text-faint">
          <IconQuantumKey size={13} /> {t("wallet_account.footer.quantum")}
        </span>
        <button
          onClick={() => setShowWipe(true)}
          className="font-mono text-[12px] font-semibold text-muted transition hover:text-pink"
        >
          {t("wallet_account.footer.logout")}
        </button>
      </div>

      {/* modal de aviso: apagar carteira */}
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
              className="card card-glow w-full max-w-[420px] p-7 text-center"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-pink/12 text-pink">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              </div>
              <h3 className="font-display mt-4 text-[19px] font-extrabold">{t("wallet_account.wipe.title")}</h3>
              <p className="mx-auto mt-2 max-w-[36ch] text-[13px] leading-relaxed text-muted">
                {t("wallet_account.wipe.description_before")}{" "}
                <b className="text-ink">{t("wallet_account.wipe.description_bold")}</b>
                {t("wallet_account.wipe.description_after")}
              </p>

              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-gold/30 bg-gold/[0.07] px-3.5 py-3 text-left text-[12.5px] text-ink">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" className="mt-0.5 flex-none">
                  <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                </svg>
                <span>
                  {t("wallet_account.wipe.warning_before")} <b>{t("wallet_account.wipe.warning_bold")}</b>{" "}
                  {t("wallet_account.wipe.warning_after")}
                </span>
              </div>

              <button
                onClick={downloadBackup}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-violet/40 bg-violet/10 px-4 py-3 text-[13px] font-bold text-ink transition hover:bg-violet/20"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
                </svg>
                {t("wallet_account.wipe.download_backup")}
              </button>

              <div className="mt-3 flex gap-2.5">
                <button onClick={() => setShowWipe(false)} className="btn-ghost flex-1 justify-center">
                  {t("wallet_account.wipe.cancel")}
                </button>
                <button
                  onClick={() => {
                    setShowWipe(false);
                    onWipe();
                  }}
                  className="flex-1 justify-center rounded-full border border-pink/50 bg-pink/15 px-5 py-2.5 text-[14px] font-bold text-pink transition hover:bg-pink/25"
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

function Stat({ label, value, suffix, highlight }: { label: string; value: string; suffix?: string; highlight?: boolean }) {
  return (
    <div>
      <div className={`font-display tnum text-[17px] font-bold ${highlight ? "text-ok" : "text-ink"}`}>
        {value}
        {suffix && <span className="ml-1 text-[11px] font-semibold text-faint">{suffix}</span>}
      </div>
      <div className="font-mono mt-1 text-[10px] uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
}

function ActionButton({
  label,
  chip,
  icon,
  onClick,
}: {
  label: string;
  chip: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-panel py-4 text-[12.5px] font-semibold text-ink transition hover:-translate-y-0.5 hover:border-violet/50 hover:bg-line/40"
    >
      <span className={`icon-chip transition-transform group-hover:scale-110 ${chip}`}>{icon}</span>
      {label}
    </button>
  );
}

function AddrRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-mono flex-none rounded-md border border-line px-1.5 py-0.5 text-[10.5px] font-bold text-muted">
          {label}
        </span>
        <span className="font-mono flex-1 break-all text-[12px] text-ink">{value}</span>
        <Copy text={value} />
      </div>
      {hint && <div className="mt-1 pl-9 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}
