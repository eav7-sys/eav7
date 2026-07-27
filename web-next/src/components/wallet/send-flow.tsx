"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import type { Account } from "@/lib/wallet-crypto";
import { parseEav7ToWei, isEvmAddress, isE7Address, signAndSend } from "@/lib/wallet";
import { fmt, shortHash } from "@/lib/format";
import { IconQuantumKey } from "@/components/icons";
import { IconSend } from "./wallet-icons";
import { useT } from "@/i18n/provider";

const WEI_PER_E7 = 10n ** 12n;
const FEE_WEI = 476190476190n * 21000n;

function weiToEav7Str(wei: bigint): string {
  const e7 = wei / WEI_PER_E7;
  const whole = e7 / 1_000_000n;
  const frac = (e7 % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
const fmtWei = (wei: bigint) => fmt(wei / WEI_PER_E7);

type Step = 1 | 2 | 3;

const fieldCls =
  "font-mono w-full rounded-xl border border-line bg-[var(--input-bg)] px-3.5 py-3 text-[13px] text-ink outline-none transition placeholder:text-faint focus:border-violet/70 focus:ring-4 focus:ring-violet/20";
const btnCls = "btn-primary flex-1 justify-center";
const ghostCls = "btn-ghost justify-center";

export function SendFlow({
  account,
  chainId,
  balanceE7,
  onClose,
  onDone,
}: {
  account: Account;
  chainId: number;
  balanceE7: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const STEP_LABELS = [t("wallet_send.steps.destination"), t("wallet_send.steps.value"), t("wallet_send.steps.review")];
  const [step, setStep] = useState<Step>(1);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);

  const balanceWei = BigInt(balanceE7) * WEI_PER_E7;
  const toValid = isEvmAddress(to.trim());

  let valueWei = 0n;
  try {
    if (amount) valueWei = parseEav7ToWei(amount);
  } catch {
    /* validado no passo */
  }
  const afterWei = balanceWei - valueWei - FEE_WEI;

  function nextFromRecipient() {
    setErr("");
    const trimmedTo = to.trim();
    if (isE7Address(trimmedTo)) return setErr(t("wallet_send.errors.needEvmAddress"));
    if (!isEvmAddress(trimmedTo)) return setErr(t("wallet_send.errors.invalidAddress"));
    setStep(2);
  }

  function nextFromAmount() {
    setErr("");
    try {
      const v = parseEav7ToWei(amount);
      if (v <= 0n) return setErr(t("wallet_send.errors.needPositiveAmount"));
      if (v + FEE_WEI > balanceWei) return setErr(t("wallet_send.errors.insufficientBalance"));
      setStep(3);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("wallet_send.errors.invalidAmount"));
    }
  }

  function setPercent(p: number) {
    const usable = balanceWei - FEE_WEI;
    if (usable <= 0n) return setAmount("0");
    const v = (usable * BigInt(p)) / 100n;
    setAmount(weiToEav7Str(v));
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setTo(t.trim());
    } catch {
      /* clipboard indisponível */
    }
  }

  async function confirm() {
    setBusy(true);
    setErr("");
    try {
      const res = await signAndSend(account, { to: to.trim(), valueWei, chainId });
      setSentId(res.id);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("wallet_send.errors.sendFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (sentId) {
    return (
      <div className="card card-glow mt-4 p-7 text-center">
        <motion.div
          className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ok/15 text-ok"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <motion.path d="M5 12.5l4 4 10-10" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.15 }} />
          </svg>
        </motion.div>
        <h3 className="font-display mt-4 text-[18px] font-bold">{t("wallet_send.transactionSent.title")}</h3>
        <p className="mt-1 text-[13px] text-muted">{t("wallet_send.transactionSent.subtitle")}</p>
        <Link href={`/tx/${sentId}`} className="link-mono mt-3 inline-block text-[12px]">
          {shortHash(sentId, 12, 8)} →
        </Link>
        <div className="mt-5">
          <button onClick={onClose} className={ghostCls}>
            {t("wallet_send.close")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card card-glow mt-4 p-5">
      {/* cabeçalho + passos */}
      <div className="mb-5 flex items-center justify-between">
        <h3 className="font-display flex items-center gap-2 text-[15px] font-bold">
          <span className="icon-chip icon-chip-sm chip-violet">
            <IconSend size={16} />
          </span>
          {t("wallet_send.title")}
        </h3>
        <div className="flex items-center gap-2">
          {STEP_LABELS.map((l, i) => {
            const s = (i + 1) as Step;
            return (
              <span
                key={l}
                className={`font-mono text-[10.5px] font-semibold uppercase tracking-wide transition-colors ${
                  s === step ? "text-violet" : s < step ? "text-ink" : "text-faint"
                }`}
              >
                {s < step ? "✓" : s}·{l}
              </span>
            );
          })}
        </div>
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-[12px] font-semibold text-muted">{t("wallet_send.recipient.label")}</label>
            <button onClick={paste} className="font-mono text-[11px] font-bold text-violet hover:text-teal">
              {t("wallet_send.recipient.paste")}
            </button>
          </div>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" className={fieldCls} autoFocus />
          {to && (
            <div className={`flex items-center gap-1.5 text-[12px] font-semibold ${toValid ? "text-ok" : "text-pink"}`}>
              {toValid ? t("wallet_send.recipient.valid") : t("wallet_send.recipient.invalid")}
            </div>
          )}
          {err && <div className="text-[12.5px] font-semibold text-pink">{err}</div>}
          <div className="mt-1 flex gap-2.5">
            <button onClick={nextFromRecipient} className={btnCls}>
              {t("wallet_send.continue")}
            </button>
            <button onClick={onClose} className={ghostCls}>
              {t("wallet_send.cancel")}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          {/* valor grande */}
          <div className="rounded-2xl border border-line bg-[var(--input-bg)] p-5 text-center">
            <div className="flex items-baseline justify-center gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                className="font-display tnum w-full max-w-[220px] bg-transparent text-center text-[40px] font-black text-ink outline-none placeholder:text-line-2"
                autoFocus
              />
              <span className="font-display flex-none text-[18px] font-bold text-muted">EAV7</span>
            </div>
            <div className="font-mono mt-1 text-[11.5px] text-muted">{t("wallet_send.available", { amount: fmt(balanceE7) })}</div>
          </div>

          {/* chips de % */}
          <div className="grid grid-cols-4 gap-2">
            {[
              ["25%", 25],
              ["50%", 50],
              ["75%", 75],
              [t("wallet_send.percent.max"), 100],
            ].map(([label, p]) => (
              <button
                key={label}
                onClick={() => setPercent(p as number)}
                className="rounded-lg border border-line bg-panel px-2 py-2 font-mono text-[11.5px] font-bold text-muted transition hover:border-violet/50 hover:text-ink"
              >
                {label}
              </button>
            ))}
          </div>

          {err && <div className="text-[12.5px] font-semibold text-pink">{err}</div>}
          <div className="flex gap-2.5">
            <button onClick={nextFromAmount} className={btnCls}>
              {t("wallet_send.steps.review")}
            </button>
            <button onClick={() => setStep(1)} className={ghostCls}>
              {t("wallet_send.back")}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          {/* valor em destaque */}
          <div className="rounded-2xl border border-line bg-[var(--input-bg)] p-5 text-center">
            <div className="font-mono text-[10.5px] uppercase tracking-[2px] text-faint">{t("wallet_send.sendingLabel")}</div>
            <div className="font-display tnum mt-1 text-[32px] font-black text-ink">
              {fmt(valueWei / WEI_PER_E7)} <span className="text-[16px] text-muted">EAV7</span>
            </div>
            <div className="font-mono mt-1 text-[12px] text-muted">{t("wallet_send.sendingTo", { addr: shortHash(to.trim(), 10, 8) })}</div>
          </div>

          <div className="rounded-xl border border-line bg-panel/40 p-4">
            <Review label={t("wallet_send.networkFee")} value={<span className="tnum">{fmtWei(FEE_WEI)} EAV7</span>} />
            <div className="my-2.5 border-t border-line" />
            <Review
              label={t("wallet_send.balanceAfter")}
              value={<span className="tnum font-bold text-ink">{afterWei >= 0n ? fmtWei(afterWei) : "—"} EAV7</span>}
            />
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-teal/25 bg-teal/5 px-3 py-2 text-[11.5px] text-muted">
            <IconQuantumKey size={13} /> {t("wallet_send.quantumNote")}
          </div>
          {err && <div className="text-[12.5px] font-semibold text-pink">{err}</div>}
          <div className="flex gap-2.5">
            <button onClick={confirm} disabled={busy} className={btnCls}>
              {busy ? t("wallet_send.signing") : t("wallet_send.confirmAndSign")}
            </button>
            <button onClick={() => setStep(2)} disabled={busy} className={ghostCls}>
              {t("wallet_send.back")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Review({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}
