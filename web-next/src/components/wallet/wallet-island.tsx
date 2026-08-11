"use client";

import dynamic from "next/dynamic";
import "@/components/scan/tokens.css";

// Carrega a carteira SOMENTE no cliente — a cripto e a chave nunca tocam o servidor.
const WalletApp = dynamic(() => import("./wallet-app").then((m) => m.WalletApp), {
  ssr: false,
  loading: () => (
    <div
      className="scan flex min-h-[60vh] items-center justify-center px-6 py-16"
      style={{ background: "var(--scan-glow)" }}
    >
      <div className="scan-glass h-64 w-full max-w-[420px] animate-pulse rounded-[20px]" />
    </div>
  ),
});

export function WalletIsland() {
  return (
    <div className="scan relative isolate -mt-[72px] min-h-[calc(100vh-72px)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{ background: "var(--scan-glow)" }}
      />
      <div className="relative z-10 pt-[72px]">
        <WalletApp />
      </div>
    </div>
  );
}
