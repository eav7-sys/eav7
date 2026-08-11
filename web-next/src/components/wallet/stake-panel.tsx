"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import type { Account } from "@/lib/wallet-crypto";
import { EAVM_STAKE_ADDRESS, EAVM_UNSTAKE_ADDRESS } from "@/lib/wallet-crypto";
import { parseEav7ToWei, signAndSend } from "@/lib/wallet";
import { shortHash } from "@/lib/format";
import { IconStakeLock } from "./wallet-icons";
import { useT } from "@/i18n/provider";

const btnCls = "btn-primary flex-1 justify-center";
const ghostCls = "btn-ghost flex-1 justify-center";

export function StakePanel({
  account,
  chainId,
  stakedEav7,
  onClose,
  onDone,
}: {
  account: Account;
  chainId: number;
  stakedEav7: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const amt = Number(amount.replace(",", ".")) || 0;

  async function submit(kind: "stake" | "unstake") {
    setErr("");
    let valueWei: bigint;
    try {
      valueWei = parseEav7ToWei(amount);
      if (valueWei <= 0n) throw new Error(t("wallet_stake.errInvalidAmount"));
    } catch (e) {
      return setErr(e instanceof Error ? e.message : t("wallet_stake.errInvalidValue"));
    }

    // aviso de perda de tier ANTES de assinar
    if (kind === "unstake" && !warn) {
      const after = stakedEav7 - amt;
      if (stakedEav7 >= 1000 && after < 1000)
        return setWarn(t("wallet_stake.warnValidator"));
      if (stakedEav7 >= 100 && after < 100)
        return setWarn(t("wallet_stake.warnFeeReset"));
    }

    setBusy(true);
    setWarn(null);
    try {
      const to = kind === "stake" ? EAVM_STAKE_ADDRESS : EAVM_UNSTAKE_ADDRESS;
      const res = await signAndSend(account, { to, valueWei, chainId });
      setSentId(res.id);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("wallet_stake.errFailedOp"));
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
        <h3 className="font-display mt-4 text-[18px] font-bold">{t("wallet_stake.sentTitle")}</h3>
        <Link href={`/tx/${sentId}`} className="link-mono mt-2 inline-block text-[12px]">
          {shortHash(sentId, 12, 8)} →
        </Link>
        <div className="mt-5">
          <button onClick={onClose} className={ghostCls}>
            {t("wallet_stake.close")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card card-glow mt-4 p-5">
      <h3 className="font-display flex items-center gap-2 text-[15px] font-bold">
        <span className="icon-chip icon-chip-sm chip-gold">
          <IconStakeLock size={16} />
        </span>
        {t("wallet_stake.title")}
      </h3>
      <p className="mt-1 text-[12px] text-muted">
        {t("wallet_stake.subtitle")}
      </p>

      {/* tiers */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Tier active={stakedEav7 >= 100} label={t("wallet_stake.tierZeroFee.label")} sub={t("wallet_stake.tierZeroFee.sub")} color="var(--teal)" />
        <Tier active={stakedEav7 >= 1000} label={t("wallet_stake.tierValidator.label")} sub={t("wallet_stake.tierValidator.sub")} color="var(--violet)" />
      </div>

      {/* valor grande */}
      <div className="mt-4 rounded-2xl border border-line bg-[var(--input-bg)] p-5 text-center">
        <div className="flex items-baseline justify-center gap-2">
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setWarn(null);
            }}
            placeholder={t("wallet_stake.amountPlaceholder")}
            inputMode="decimal"
            className="font-display tnum w-full max-w-[200px] bg-transparent text-center text-[36px] font-black text-ink outline-none placeholder:text-line-2"
            autoFocus
          />
          <span className="font-display flex-none text-[16px] font-bold text-muted">EAV7</span>
        </div>
        <div className="font-mono mt-1 text-[11.5px] text-muted">
          {t("wallet_stake.currentStake")} <b className="text-ink">{stakedEav7.toLocaleString("pt-BR")} EAV7</b>
        </div>
      </div>

      {warn && (
        <div className="mt-3 rounded-xl border border-gold/40 bg-gold/[0.08] px-3.5 py-3 text-[12.5px] text-ink">
          <div className="flex items-start gap-2">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" className="mt-0.5 flex-none">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
            <span>{warn}</span>
          </div>
          <button
            onClick={() => submit("unstake")}
            className="font-mono mt-2 pl-6 text-[12px] font-bold text-gold hover:brightness-110"
          >
            {t("wallet_stake.warnConfirm")}
          </button>
        </div>
      )}
      {err && <div className="mt-3 text-[12.5px] font-semibold text-pink">{err}</div>}

      <div className="mt-4 flex gap-2.5">
        <button onClick={() => submit("stake")} disabled={busy} className={btnCls}>
          {busy ? "…" : t("wallet_stake.stakeBtn")}
        </button>
        <button onClick={() => submit("unstake")} disabled={busy} className={ghostCls}>
          {t("wallet_stake.removeBtn")}
        </button>
      </div>
      <button onClick={onClose} className="font-mono mt-3 w-full text-center text-[12px] font-semibold text-muted transition hover:text-ink">
        {t("wallet_stake.close")}
      </button>
    </div>
  );
}

function Tier({ active, label, sub, color }: { active: boolean; label: string; sub: string; color: string }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border px-3.5 py-3 transition-colors"
      style={{
        borderColor: active ? `color-mix(in srgb, ${color} 50%, transparent)` : "var(--line)",
        background: active ? `color-mix(in srgb, ${color} 9%, transparent)` : "var(--panel)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className={`text-[13px] font-bold ${active ? "text-ink" : "text-muted"}`}>{label}</div>
        {active && (
          <span style={{ color }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4 4 10-10" />
            </svg>
          </span>
        )}
      </div>
      <div className="font-mono mt-0.5 text-[10.5px] text-faint">{sub}</div>
    </div>
  );
}
