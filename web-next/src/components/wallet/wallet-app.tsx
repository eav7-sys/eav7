"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createAccount, accountFromPrivate, type Account } from "@/lib/wallet-crypto";
import { saveVault, unlockVault, clearVault, hasVault } from "@/lib/wallet";
import { AccountView } from "./account-view";
import { Copy } from "@/components/ui/copy";
import { IconCreateWallet, IconImportKey } from "./wallet-icons";
import { useT } from "@/i18n/provider";
import "@/components/scan/tokens.css";

/* ---------- casca = Login do EAVScan.dc.html ---------- */
function WalletShell({
  title,
  subtitle,
  children,
  note,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div
      className="flex flex-1 items-center justify-center px-6 py-[60px]"
      style={{ background: "var(--scan-glow)" }}
    >
      <div className="scan-glass scan-in w-full max-w-[420px] rounded-[20px] p-9">
        <div
          className="mx-auto mb-[18px] grid h-11 w-11 place-items-center rounded-[13px] text-[20px] font-extrabold text-white"
          style={{
            background: "linear-gradient(135deg,#7242D4,#4B2694)",
            boxShadow: "0 6px 20px rgba(99,54,196,0.5)",
          }}
        >
          7
        </div>
        <h1 className="text-center font-display text-[22px] font-bold tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {subtitle && (
          <p className="mx-auto mt-2 mb-[26px] max-w-[36ch] text-center text-[13px] leading-relaxed text-muted">
            {subtitle}
          </p>
        )}
        {children}
        {note && (
          <div className="mt-[22px] flex items-center justify-center gap-[7px] text-[11.5px] text-faint">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            {note}
          </div>
        )}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const t = useT();
  const labels = [t("wallet_app.stepper.backup"), t("wallet_app.stepper.password"), t("wallet_app.stepper.ready")];
  return (
    <div className="mb-5 flex items-center gap-2">
      {labels.map((l, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <div key={l} className="flex flex-1 items-center gap-2">
            <div
              className={`grid h-6 w-6 flex-none place-items-center rounded-full border-2 text-[11px] font-bold transition-colors ${
                done
                  ? "border-[var(--ok)] text-[var(--ok)]"
                  : active
                    ? "border-[var(--scan-primary)] text-[var(--scan-link)]"
                    : "border-[var(--scan-border)] text-faint"
              }`}
            >
              {done ? "✓" : i + 1}
            </div>
            <span className={`text-[11.5px] font-semibold ${active || done ? "text-ink" : "text-faint"}`}>{l}</span>
            {i < labels.length - 1 && <span className="ml-auto h-px flex-1 bg-[var(--scan-border-soft)]" />}
          </div>
        );
      })}
    </div>
  );
}

const fieldCls =
  "w-full rounded-xl border border-[var(--scan-border)] bg-[var(--input-bg)] px-4 py-[13px] text-[14px] text-ink outline-none transition placeholder:text-faint focus:border-[var(--scan-primary)]";
const btnPrimary =
  "w-full rounded-xl bg-[var(--scan-primary)] px-4 py-3.5 text-center text-[14px] font-bold text-white transition hover:bg-[var(--scan-primary-h)] disabled:opacity-50";
const btnGhost =
  "w-full rounded-xl border border-[var(--scan-border)] px-4 py-[13px] text-center text-[13.5px] font-semibold text-ink transition hover:bg-[var(--scan-hover)]";

export function WalletApp() {
  const [account, setAccount] = useState<Account | null>(null);
  const [vaultExists, setVaultExists] = useState<boolean>(() => hasVault());

  if (account) {
    return (
      <AccountView
        account={account}
        onLock={() => setAccount(null)}
        onWipe={() => {
          clearVault();
          setVaultExists(false);
          setAccount(null);
        }}
      />
    );
  }

  if (vaultExists) {
    return (
      <UnlockView
        onUnlock={setAccount}
        onWipe={() => {
          clearVault();
          setVaultExists(false);
        }}
      />
    );
  }

  return (
    <OnboardingView
      onReady={(acc) => {
        setAccount(acc);
        setVaultExists(true);
      }}
    />
  );
}

/* ---------- desbloquear ---------- */
function UnlockView({ onUnlock, onWipe }: { onUnlock: (a: Account) => void; onWipe: () => void }) {
  const t = useT();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const priv = await unlockVault(pw);
      onUnlock(await accountFromPrivate(priv));
    } catch {
      setErr(t("wallet_app.unlock.error_wrong_password"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WalletShell
      title={t("wallet_app.unlock.title")}
      subtitle={t("wallet_app.unlock.subtitle")}
      note={t("wallet_app.unlock.note")}
    >
      <form onSubmit={unlock}>
        <div className="mb-1.5 text-[12px] font-semibold text-muted">{t("wallet_app.unlock.password_label")}</div>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="••••••••"
          className={fieldCls}
          autoFocus
        />
        {err && <div className="mt-2 text-[12.5px] font-semibold text-[var(--red)]">{err}</div>}
        <button type="submit" disabled={busy || !pw} className={`${btnPrimary} mt-5`}>
          {busy ? t("wallet_app.unlock.unlocking") : t("wallet_app.unlock.unlock_button")}
        </button>
        <button
          type="button"
          className={`${btnGhost} mt-3`}
          onClick={() => {
            if (confirm(t("wallet_app.unlock.wipe_confirm"))) onWipe();
          }}
        >
          {t("wallet_app.unlock.wipe_button")}
        </button>
      </form>
    </WalletShell>
  );
}

type Stage = "choose" | "create" | "import";

function OnboardingView({ onReady }: { onReady: (a: Account) => void }) {
  const t = useT();
  const [stage, setStage] = useState<Stage>("choose");
  const [draft, setDraft] = useState<Account | null>(null);
  const [priv, setPriv] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saved, setSaved] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function startCreate() {
    setDraft(await createAccount());
    setErr("");
    setStage("create");
  }

  async function finalize(acc: Account) {
    if (pw.length < 6) return setErr(t("wallet_app.errors.password_min"));
    if (pw !== pw2) return setErr(t("wallet_app.errors.password_mismatch"));
    setBusy(true);
    setErr("");
    try {
      await saveVault(acc.privateKey, pw);
      onReady(acc);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("wallet_app.errors.save_error"));
      setBusy(false);
    }
  }

  async function submitImport(e: React.FormEvent) {
    e.preventDefault();
    let acc: Account;
    try {
      acc = await accountFromPrivate(priv.trim());
    } catch {
      setErr(t("wallet_app.import.error_invalid_key"));
      return;
    }
    finalize(acc);
  }

  function downloadBackup(acc: Account) {
    const blob = new Blob([JSON.stringify({ chain: "EAV7", ...acc }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `eav7-${acc.eav7.slice(0, 10)}.json`;
    a.click();
    setSaved(true);
  }

  if (stage === "choose") {
    return (
      <WalletShell
        title={t("wallet_app.choose.title")}
        subtitle={t("wallet_app.choose.subtitle")}
        note={t("wallet_app.unlock.note")}
      >
        <button
          type="button"
          onClick={startCreate}
          className="group mb-3 flex w-full items-center gap-3.5 rounded-xl border border-[var(--scan-border)] px-4 py-3.5 text-left transition hover:bg-[var(--scan-hover)]"
        >
          <span className="grid h-10 w-10 flex-none place-items-center rounded-[11px] bg-[var(--scan-chip)] text-[var(--scan-link)]">
            <IconCreateWallet size={20} />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold text-ink">{t("wallet_app.choose.create_title")}</span>
            <span className="block text-[12px] text-muted">{t("wallet_app.choose.create_desc")}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setStage("import")}
          className="group flex w-full items-center gap-3.5 rounded-xl border border-[var(--scan-border)] px-4 py-3.5 text-left transition hover:bg-[var(--scan-hover)]"
        >
          <span className="grid h-10 w-10 flex-none place-items-center rounded-[11px] bg-[var(--scan-chip)] text-[var(--scan-link)]">
            <IconImportKey size={20} />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold text-ink">{t("wallet_app.choose.import_title")}</span>
            <span className="block text-[12px] text-muted">{t("wallet_app.choose.import_desc")}</span>
          </span>
        </button>
      </WalletShell>
    );
  }

  if (stage === "import") {
    return (
      <WalletShell title={t("wallet_app.import.title")} subtitle={t("wallet_app.import.subtitle")}>
        <form onSubmit={submitImport}>
          <div className="mb-1.5 text-[12px] font-semibold text-muted">{t("wallet_app.import.label")}</div>
          <input
            value={priv}
            onChange={(e) => setPriv(e.target.value)}
            placeholder="0x…"
            className={`${fieldCls} mb-4 font-mono text-[13px]`}
            autoFocus
          />
          <PasswordFields pw={pw} pw2={pw2} setPw={setPw} setPw2={setPw2} />
          {err && <div className="mt-2 text-[12.5px] font-semibold text-[var(--red)]">{err}</div>}
          <button type="submit" disabled={busy} className={`${btnPrimary} mt-5`}>
            {busy ? t("wallet_app.import.importing") : t("wallet_app.import.button")}
          </button>
          <button type="button" onClick={() => setStage("choose")} className={`${btnGhost} mt-3`}>
            {t("wallet_app.import.back")}
          </button>
        </form>
      </WalletShell>
    );
  }

  const pwStep = saved;
  return (
    <WalletShell title={t("wallet_app.create.title")} subtitle={t("wallet_app.create.subtitle")}>
      <Stepper step={pwStep ? 1 : 0} />

      <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[rgba(243,156,18,0.35)] bg-[rgba(243,156,18,0.08)] px-3.5 py-3 text-[12.5px] text-ink">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" className="mt-0.5 flex-none">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        <span>
          {t("wallet_app.create.warning_prefix")}
          <b>{t("wallet_app.create.warning_bold")}</b>
          {t("wallet_app.create.warning_suffix")}
        </span>
      </div>

      {draft && (
        <>
          <div className="mb-3 rounded-xl border border-[var(--scan-border)] bg-[var(--input-bg)] p-3.5">
            <div className="font-mono text-[10.5px] uppercase tracking-wider text-faint">
              {t("wallet_app.create.address_label")}
            </div>
            <div className="mt-1 flex items-center gap-2 break-all font-mono text-[12px] text-ink">
              {draft.eav7}
              <Copy text={draft.eav7} />
            </div>
          </div>
          <div className="mb-3 rounded-xl border border-[var(--scan-border)] bg-[var(--input-bg)] p-3.5">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[10.5px] uppercase tracking-wider text-faint">
                {t("wallet_app.create.private_key_label")}
              </div>
              <div className="flex items-center gap-3">
                {revealed && <Copy text={draft.privateKey} />}
                <button
                  type="button"
                  onClick={() => setRevealed((r) => !r)}
                  className="font-mono text-[11px] font-semibold text-[var(--scan-link)] hover:underline"
                >
                  {revealed ? t("wallet_app.create.hide") : t("wallet_app.create.reveal")}
                </button>
              </div>
            </div>
            <div className="mt-1 break-all font-mono text-[12px] text-ink">
              {revealed ? draft.privateKey : "•".repeat(66)}
            </div>
          </div>

          <div className="mb-5 flex flex-col gap-3">
            <button type="button" onClick={() => downloadBackup(draft)} className={btnGhost}>
              {t("wallet_app.create.download_backup")}
            </button>
            <ConfirmSaved saved={saved} onToggle={() => setSaved((s) => !s)} />
          </div>

          <div className={saved ? "" : "pointer-events-none select-none opacity-40"}>
            <PasswordFields pw={pw} pw2={pw2} setPw={setPw} setPw2={setPw2} />
          </div>
          {err && <div className="mt-2 text-[12.5px] font-semibold text-[var(--red)]">{err}</div>}
          <button
            type="button"
            disabled={!saved || busy}
            onClick={() => finalize(draft)}
            className={`${btnPrimary} mt-4`}
            title={!saved ? t("wallet_app.create.confirm_hint") : undefined}
          >
            {busy ? t("wallet_app.create.creating") : t("wallet_app.create.create_button")}
          </button>
          <button type="button" onClick={() => setStage("choose")} className={`${btnGhost} mt-3`}>
            {t("wallet_app.create.back")}
          </button>
        </>
      )}
    </WalletShell>
  );
}

function ConfirmSaved({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={saved}
      className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border px-3.5 py-3.5 text-left transition-all duration-300 ${
        saved
          ? "border-[rgba(46,204,113,0.5)] bg-[rgba(46,204,113,0.09)]"
          : "border-[var(--scan-border)] bg-transparent hover:border-[var(--scan-border)]"
      }`}
    >
      <AnimatePresence>
        {saved && (
          <motion.span
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(120px 60px at 12% 50%, color-mix(in srgb, var(--ok) 22%, transparent), transparent 70%)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      <motion.span
        animate={saved ? { scale: [1, 1.18, 1] } : { scale: 1 }}
        transition={{ duration: 0.35 }}
        className={`relative grid h-6 w-6 flex-none place-items-center rounded-md border-2 transition-colors duration-200 ${
          saved ? "border-[var(--ok)] bg-[var(--ok)]" : "border-[var(--scan-border)] bg-transparent"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <motion.path
            d="M5 12.5l4 4 10-10"
            initial={false}
            animate={{ pathLength: saved ? 1 : 0, opacity: saved ? 1 : 0 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
          />
        </svg>
      </motion.span>

      <span className={`relative text-[13px] font-semibold transition-colors ${saved ? "text-ink" : "text-muted"}`}>
        {t("wallet_app.create.confirm_saved")}
      </span>
    </button>
  );
}

function pwScore(pw: string): number {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const PW_COLOR = ["var(--red)", "var(--red)", "var(--gold)", "var(--teal)", "var(--ok)"];

function PasswordFields({
  pw,
  pw2,
  setPw,
  setPw2,
}: {
  pw: string;
  pw2: string;
  setPw: (v: string) => void;
  setPw2: (v: string) => void;
}) {
  const t = useT();
  const score = pwScore(pw);
  const pwLabels = [
    t("wallet_app.password.strength.very_weak"),
    t("wallet_app.password.strength.weak"),
    t("wallet_app.password.strength.fair"),
    t("wallet_app.password.strength.good"),
    t("wallet_app.password.strength.strong"),
  ];
  return (
    <div className="flex flex-col gap-2.5">
      <label className="text-[12px] font-semibold text-muted">{t("wallet_app.password.label")}</label>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder={t("wallet_app.password.placeholder")}
        className={fieldCls}
      />
      {pw.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex h-1.5 flex-1 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="h-full flex-1 rounded-full transition-colors"
                style={{ background: i < score ? PW_COLOR[score] : "var(--scan-border)" }}
              />
            ))}
          </div>
          <span className="font-mono text-[10.5px]" style={{ color: PW_COLOR[score] }}>
            {pwLabels[score]}
          </span>
        </div>
      )}
      <input
        type="password"
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        placeholder={t("wallet_app.password.confirm_placeholder")}
        className={fieldCls}
      />
      {pw2.length > 0 && pw !== pw2 && (
        <span className="text-[11px] font-semibold text-[var(--red)]">{t("wallet_app.password.mismatch")}</span>
      )}
    </div>
  );
}
