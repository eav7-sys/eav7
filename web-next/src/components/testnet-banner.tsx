// Faixa fina exibida SOMENTE no deploy da testnet (NEXT_PUBLIC_NETWORK=testnet).
// Server component — sem custo no cliente; a mainnet nem renderiza nada.
export function TestnetBanner() {
  if (process.env.NEXT_PUBLIC_NETWORK !== "testnet") return null;
  return (
    <div className="w-full border-b border-gold/30 bg-gold/[0.12] px-3 py-1.5 text-center text-[12.5px] text-ink">
      <span className="font-mono font-semibold uppercase tracking-wide text-gold">Testnet</span>
      {" — "}
      <span className="text-muted">these are test coins with no real value.</span>{" "}
      <a href="/wallet" className="font-semibold underline decoration-gold/50 underline-offset-2 hover:text-gold">
        Get test EAV7
      </a>
    </div>
  );
}
