"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import type { Account } from "@/lib/wallet-crypto";
import { isEvmAddress, signAndSend } from "@/lib/wallet";
import { shortHash } from "@/lib/format";
import {
  PARTNER_BUCKET_E7,
  PARTNER_OWNER_EVM,
  PARTNER_TRANCHE_E7,
  PARTNER_TRANCHE_VAULT,
  encodeArm,
  encodeReleaseTo,
  isForbiddenPartnerRecipient,
  isPartnerOwner,
} from "@/lib/partner-tranche";

const fieldCls =
  "font-mono w-full rounded-xl border border-line bg-[var(--input-bg)] px-3.5 py-3 text-[13px] text-ink outline-none transition placeholder:text-faint focus:border-violet/70 focus:ring-4 focus:ring-violet/20";
const btnCls = "btn-primary flex-1 justify-center";
const ghostCls = "btn-ghost flex-1 justify-center";

function fmtE7(e7: bigint): string {
  return new Intl.NumberFormat("en-US").format(Number(e7 / 1_000_000n));
}

export function PartnerTranchePanel({
  account,
  chainId,
  onClose,
  onDone,
}: {
  account: Account;
  chainId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const ownerOk = isPartnerOwner(account.evm);
  const [to, setTo] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [mode, setMode] = useState<"release" | "arm">("release");

  async function submit() {
    setErr("");
    if (!ownerOk) {
      return setErr("Desbloqueie a carteira do dono (owner) para assinar.");
    }
    if (!PARTNER_TRANCHE_VAULT) {
      return setErr("Vault não configurado (NEXT_PUBLIC_PARTNER_TRANCHE_VAULT).");
    }

    setBusy(true);
    try {
      if (mode === "arm") {
        const res = await signAndSend(account, {
          to: PARTNER_TRANCHE_VAULT,
          valueWei: 0n,
          chainId,
          data: encodeArm(PARTNER_BUCKET_E7),
        });
        setSentId(res.id);
        onDone();
        return;
      }

      const dest = to.trim();
      if (!isEvmAddress(dest)) {
        setBusy(false);
        return setErr("Parceiro deve ser endereço 0x (EAVM).");
      }
      if (isForbiddenPartnerRecipient(dest, account.evm) || isForbiddenPartnerRecipient(dest)) {
        setBusy(false);
        return setErr("Proteção de rede: o dono (e o vault) não podem receber a tranche.");
      }
      const res = await signAndSend(account, {
        to: PARTNER_TRANCHE_VAULT,
        valueWei: 0n,
        chainId,
        data: encodeReleaseTo(dest),
      });
      setSentId(res.id);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "falha ao assinar/enviar");
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
        <h3 className="font-display mt-4 text-[18px] font-bold">Assinado pelo dono</h3>
        <p className="mt-1 text-[12.5px] text-muted">Tx enviada com a chave desta carteira nativa.</p>
        <Link href={`/tx/${sentId}`} className="link-mono mt-2 inline-block text-[12px]">
          {shortHash(sentId, 12, 8)} →
        </Link>
        <div className="mt-5">
          <button type="button" onClick={onClose} className={ghostCls}>
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card card-glow mt-4 p-5">
      <h3 className="font-display text-[15px] font-bold">Parceiro · 4 partes</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        Só a carteira <b className="text-ink">owner</b> desbloqueada neste device pode liberar.
        Cada liberação envia {fmtE7(PARTNER_TRANCHE_E7)} EAV7; próxima em ~12 meses.
      </p>

      <div className="mt-4 rounded-xl border border-line bg-[var(--input-bg)]/60 px-3.5 py-3 text-[12px]">
        <div className="flex justify-between gap-2">
          <span className="text-faint">Carteira ativa</span>
          <span className="font-mono text-ink">{shortHash(account.evm, 8, 6)}</span>
        </div>
        <div className="mt-1.5 flex justify-between gap-2">
          <span className="text-faint">Owner esperado</span>
          <span className="font-mono text-ink">
            {PARTNER_OWNER_EVM ? shortHash(PARTNER_OWNER_EVM, 8, 6) : "— configure env"}
          </span>
        </div>
        <div className="mt-2 text-[12px] font-semibold">
          {ownerOk ? (
            <span className="text-ok">Validado · você é o dono</span>
          ) : (
            <span className="text-pink">Bloqueado · desbloqueie a carteira owner</span>
          )}
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className={`btn-ghost flex-1 justify-center text-[12px] ${mode === "release" ? "border-violet/50" : ""}`}
          onClick={() => setMode("release")}
        >
          Liberar parte
        </button>
        <button
          type="button"
          className={`btn-ghost flex-1 justify-center text-[12px] ${mode === "arm" ? "border-violet/50" : ""}`}
          onClick={() => setMode("arm")}
        >
          Armar (1×)
        </button>
      </div>

      {mode === "release" ? (
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wide text-faint">
            Endereço do parceiro (0x)
          </span>
          <input
            className={fieldCls}
            placeholder="0x…"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={!ownerOk || busy}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ) : (
        <p className="mt-4 text-[12.5px] text-muted">
          `arm` divide o saldo em 4 × {fmtE7(PARTNER_TRANCHE_E7)} EAV7. Só uma vez, com a carteira owner.
        </p>
      )}

      {err && <p className="mt-3 text-[12.5px] font-semibold text-pink">{err}</p>}

      <div className="mt-5 flex gap-2">
        <button type="button" className={ghostCls} onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className={btnCls} onClick={submit} disabled={!ownerOk || busy}>
          {busy ? "Assinando…" : mode === "arm" ? "Armar vault" : "Liberar com minha chave"}
        </button>
      </div>
    </div>
  );
}
