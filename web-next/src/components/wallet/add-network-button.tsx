"use client";

import { useState } from "react";
import { useT } from "@/i18n/provider";
import { EAVM_CHAIN_PARAMS } from "@/lib/eavm-chain";

const CHAIN_PARAMS = { ...EAVM_CHAIN_PARAMS };

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export function AddNetworkButton() {
  const t = useT();
  const [state, setState] = useState<"idle" | "loading" | "ok" | "nowallet" | "error">("idle");

  async function add() {
    const eth = (window as unknown as { ethereum?: EthProvider }).ethereum;
    if (!eth) {
      setState("nowallet");
      return;
    }
    setState("loading");
    try {
      await eth.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS] });
      setState("ok");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="card mt-4 flex flex-wrap items-center gap-3 p-4">
      <span className="icon-chip icon-chip-sm chip-gold flex-none">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a2 2 0 0 1 2 2v1.5" />
          <path d="M4 7.5V17a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5" />
          <path d="M21 11h-3a2 2 0 0 0 0 4h3z" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold text-ink">{t("wallet_addNet.title")}</div>
        <div className="text-[11.5px] text-muted">{t("wallet_addNet.description")}</div>
      </div>
      <button onClick={add} disabled={state === "loading"} className="btn-ghost btn-sm flex-none">
        {state === "loading" ? t("wallet_addNet.adding") : state === "ok" ? t("wallet_addNet.added") : t("wallet_addNet.addButton")}
      </button>
      {state === "nowallet" && <div className="w-full text-[11.5px] text-muted">{t("wallet_addNet.noWallet")}</div>}
      {state === "error" && <div className="w-full text-[11.5px] text-pink">{t("wallet_addNet.error")}</div>}
    </div>
  );
}
