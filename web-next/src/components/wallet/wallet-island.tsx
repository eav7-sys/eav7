"use client";

import dynamic from "next/dynamic";
import { WalletVideoBg } from "./wallet-video-bg";

// Carrega a carteira SOMENTE no cliente — a cripto e a chave nunca tocam o servidor.
const WalletApp = dynamic(() => import("./wallet-app").then((m) => m.WalletApp), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-[600px] px-5 py-16">
      <div className="card h-64 animate-pulse" />
    </div>
  ),
});

export function WalletIsland() {
  return (
    // isolate = contexto próprio; -mt puxa o fundo pra trás do header (sem faixa preta no topo)
    <div className="relative isolate -mt-[72px]">
      {/* fundo temático da carteira — glow suave da marca, calmo (sem atrapalhar a leitura) */}
      <div aria-hidden className="wallet-bg pointer-events-none absolute inset-0 z-0" />
      {/* fundo animado (vídeo) — só no escuro/desktop/com movimento */}
      <WalletVideoBg />
      <div className="relative z-10 pt-[72px]">
        <WalletApp />
      </div>
    </div>
  );
}
