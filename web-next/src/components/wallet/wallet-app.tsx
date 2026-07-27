"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { createAccount, accountFromPrivate, type Account } from "@/lib/wallet-crypto";
import { saveVault, unlockVault, clearVault, hasVault } from "@/lib/wallet";
import { AccountView } from "./account-view";
import { Copy } from "@/components/ui/copy";
import { IconCreateWallet, IconImportKey } from "./wallet-icons";
import { useT } from "@/i18n/provider";

/* ---------- casca compartilhada ---------- */
function WalletShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[520px] px-5 py-12">
      <div className="mb-7 text-center">
        <div className="relative mx-auto mb-4 h-16 w-16">
          <div className="absolute inset-0 rounded-full blur-[26px]" style={{ background: "radial-gradient(circle, rgba(154,108,255,.6), transparent 70%)" }} />
          <Image src="/brand/eav7-coin.png" alt="EAV7" fill priority className="relative object-contain" />
        </div>
        <h1 className="font-display text-[24px] font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mx-auto mt-2 max-w-[42ch] text-[13.5px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {children}
      <TrustBadges />
    </div>
  );
}

function TrustBadges() {
  const t = useT();
  const items = [
    [t("wallet_app.trust.self_custody_title"), t("wallet_app.trust.self_custody_desc")],
    [t("wallet_app.trust.on_device_title"), t("wallet_app.trust.on_device_desc")],
    [t("wallet_app.trust.quantum_title"), t("wallet_app.trust.quantum_desc")],
  ];
  return (
    <div className="mt-6 grid grid-cols-3 gap-2">
      {items.map(([a, b]) => (
        <div key={a} className="rounded-xl border border-line bg-panel/50 px-3 py-2.5 text-center">
          <div className="text-[11.5px] font-bold text-ink">{a}</div>
          <div className="mt-0.5 text-[10px] leading-tight text-faint">{b}</div>
        </div>
      ))}
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
                done ? "border-teal text-teal" : active ? "border-violet text-violet" : "border-line text-faint"
              }`}
            >
              {done ? "✓" : i + 1}
            </div>
            <span className={`text-[11.5px] font-semibold ${active || done ? "text-ink" : "text-faint"}`}>{l}</span>
            {i < labels.length - 1 && <span className="ml-auto h-px flex-1 bg-line" />}
          </div>
        );
      })}
    </div>
  );
}

const fieldCls =
  "font-mono w-full rounded-xl border border-line bg-[var(--input-bg)] px-3.5 py-3 text-[13px] text-ink outline-none transition placeholder:text-faint focus:border-violet/70 focus:ring-4 focus:ring-violet/20";
const btnCls = "btn-primary justify-center";
const ghostCls = "btn-ghost justify-center";

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
      onUnlock(accountFromPrivate(priv));
    } catch {
      setErr(t("wallet_app.unlock.error_wrong_password"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WalletShell title={t("wallet_app.unlock.title")} subtitle={t("wallet_app.unlock.subtitle")}>
      <form onSubmit={unlock} className="card card-glow flex flex-col gap-3 p-6">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t("wallet_app.unlock.password_placeholder")}
          className={fieldCls}
          autoFocus
        />
        {err && <div className="text-[12.5px] font-semibold text-pink">{err}</div>}
        <button type="submit" disabled={busy || !pw} className={btnCls}>
          {busy ? t("wallet_app.unlock.unlocking") : t("wallet_app.unlock.unlock_button")}
        </button>
        <button
          type="button"
          className="font-mono mt-1 text-center text-[12px] font-semibold text-muted transition hover:text-pink"
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

  function startCreate() {
    setDraft(createAccount());
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

  function submitImport(e: React.FormEvent) {
    e.preventDefault();
    try {
      const acc = accountFromPrivate(priv.trim());
      finalize(acc);
    } catch {
      setErr(t("wallet_app.import.error_invalid_key"));
    }
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

  /* ---- escolher ---- */
  if (stage === "choose") {
    return (
      <WalletShell
        title={t("wallet_app.choose.title")}
        subtitle={t("wallet_app.choose.subtitle")}
      >
        <div className="grid gap-3">
          <button onClick={startCreate} className="group flex items-center gap-4 rounded-2xl border border-line bg-panel p-5 text-left transition hover:-translate-y-0.5 hover:border-violet/50">
            <span className="icon-chip icon-chip-lg chip-violet flex-none">
              <IconCreateWallet size={24} />
            </span>
            <span className="min-w-0">
              <span className="font-display block text-[16px] font-bold text-ink">{t("wallet_app.choose.create_title")}</span>
              <span className="block text-[12.5px] text-muted">{t("wallet_app.choose.create_desc")}</span>
            </span>
            <svg className="ml-auto text-faint transition-transform group-hover:translate-x-1" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
          <button onClick={() => setStage("import")} className="group flex items-center gap-4 rounded-2xl border border-line bg-panel p-5 text-left transition hover:-translate-y-0.5 hover:border-violet/50">
            <span className="icon-chip icon-chip-lg chip-teal flex-none">
              <IconImportKey size={23} />
            </span>
            <span className="min-w-0">
              <span className="font-display block text-[16px] font-bold text-ink">{t("wallet_app.choose.import_title")}</span>
              <span className="block text-[12.5px] text-muted">{t("wallet_app.choose.import_desc")}</span>
            </span>
            <svg className="ml-auto text-faint transition-transform group-hover:translate-x-1" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
      </WalletShell>
    );
  }

  /* ---- importar ---- */
  if (stage === "import") {
    return (
      <WalletShell title={t("wallet_app.import.title")} subtitle={t("wallet_app.import.subtitle")}>
        <form onSubmit={submitImport} className="card card-glow flex flex-col gap-3 p-6">
          <label className="text-[12px] font-semibold text-muted">{t("wallet_app.import.label")}</label>
          <input value={priv} onChange={(e) => setPriv(e.target.value)} placeholder="0x…" className={fieldCls} autoFocus />
          <PasswordFields pw={pw} pw2={pw2} setPw={setPw} setPw2={setPw2} />
          {err && <div className="text-[12.5px] font-semibold text-pink">{err}</div>}
          <div className="flex gap-2.5">
            <button type="submit" disabled={busy} className={btnCls}>
              {busy ? t("wallet_app.import.importing") : t("wallet_app.import.button")}
            </button>
            <button type="button" onClick={() => setStage("choose")} className={ghostCls}>
              {t("wallet_app.import.back")}
            </button>
          </div>
        </form>
      </WalletShell>
    );
  }

  /* ---- criar: backup + senha ---- */
  const pwStep = saved;
  return (
    <WalletShell title={t("wallet_app.create.title")} subtitle={t("wallet_app.create.subtitle")}>
      <div className="card card-glow p-6">
        <Stepper step={pwStep ? 1 : 0} />

        {/* aviso */}
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-gold/30 bg-gold/[0.07] px-3.5 py-3 text-[12.5px] text-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" className="mt-0.5 flex-none">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          <span>
            {t("wallet_app.create.warning_prefix")}<b>{t("wallet_app.create.warning_bold")}</b>{t("wallet_app.create.warning_suffix")}
          </span>
        </div>

        {draft && (
          <>
            <div className="mb-3 rounded-xl border border-line bg-[var(--input-bg)] p-3.5">
              <div className="font-mono text-[10.5px] uppercase tracking-wider text-faint">{t("wallet_app.create.address_label")}</div>
              <div className="font-mono mt-1 flex items-center gap-2 break-all text-[12px] text-ink">
                {draft.eav7}
                <Copy text={draft.eav7} />
              </div>
            </div>
            <div className="mb-3 rounded-xl border border-line bg-[var(--input-bg)] p-3.5">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[10.5px] uppercase tracking-wider text-faint">{t("wallet_app.create.private_key_label")}</div>
                <div className="flex items-center gap-3">
                  {revealed && <Copy text={draft.privateKey} />}
                  <button type="button" onClick={() => setRevealed((r) => !r)} className="font-mono text-[11px] font-semibold text-violet hover:text-teal">
                    {revealed ? t("wallet_app.create.hide") : t("wallet_app.create.reveal")}
                  </button>
                </div>
              </div>
              <div className="font-mono mt-1 break-all text-[12px] text-ink">
                {revealed ? draft.privateKey : "•".repeat(66)}
              </div>
            </div>

            <div className="mb-5 flex flex-col gap-3">
              <button type="button" onClick={() => downloadBackup(draft)} className={ghostCls}>
                {t("wallet_app.create.download_backup")}
              </button>
              <ConfirmSaved saved={saved} onToggle={() => setSaved((s) => !s)} />
            </div>

            <div className={saved ? "" : "pointer-events-none select-none opacity-40"}>
              <PasswordFields pw={pw} pw2={pw2} setPw={setPw} setPw2={setPw2} />
            </div>
            {err && <div className="mt-2 text-[12.5px] font-semibold text-pink">{err}</div>}
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                disabled={!saved || busy}
                onClick={() => finalize(draft)}
                className={btnCls}
                title={!saved ? t("wallet_app.create.confirm_hint") : undefined}
              >
                {busy ? t("wallet_app.create.creating") : t("wallet_app.create.create_button")}
              </button>
              <button type="button" onClick={() => setStage("choose")} className={ghostCls}>
                {t("wallet_app.create.back")}
              </button>
            </div>
          </>
        )}
      </div>
    </WalletShell>
  );
}

/* ---------- confirmação animada do backup ---------- */
function ConfirmSaved({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={saved}
      className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border px-3.5 py-3.5 text-left transition-all duration-300 ${
        saved ? "border-ok/50 bg-ok/[0.09]" : "border-line bg-panel/50 hover:border-line-2"
      }`}
    >
      {/* brilho ao confirmar */}
      <AnimatePresence>
        {saved && (
          <motion.span
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(120px 60px at 12% 50%, color-mix(in srgb, var(--ok) 22%, transparent), transparent 70%)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      {/* checkbox custom */}
      <motion.span
        animate={saved ? { scale: [1, 1.18, 1] } : { scale: 1 }}
        transition={{ duration: 0.35 }}
        className={`relative grid h-6 w-6 flex-none place-items-center rounded-md border-2 transition-colors duration-200 ${
          saved ? "border-ok bg-ok" : "border-line-2 bg-transparent"
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

      {/* escudo que aparece ao confirmar */}
      <AnimatePresence>
        {saved && (
          <motion.span
            className="relative ml-auto text-ok"
            initial={{ opacity: 0, scale: 0.5, rotate: -20 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

/* ---------- senha + medidor de força ---------- */
function pwScore(pw: string): number {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
const PW_COLOR = ["var(--pink)", "var(--pink)", "var(--gold)", "var(--teal)", "var(--ok)"];

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
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t("wallet_app.password.placeholder")} className={fieldCls} />
      {pw.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex h-1.5 flex-1 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="h-full flex-1 rounded-full transition-colors"
                style={{ background: i < score ? PW_COLOR[score] : "var(--line-2)" }}
              />
            ))}
          </div>
          <span className="font-mono text-[10.5px]" style={{ color: PW_COLOR[score] }}>
            {pwLabels[score]}
          </span>
        </div>
      )}
      <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder={t("wallet_app.password.confirm_placeholder")} className={fieldCls} />
      {pw2.length > 0 && pw !== pw2 && (
        <span className="text-[11px] font-semibold text-pink">{t("wallet_app.password.mismatch")}</span>
      )}
    </div>
  );
}
