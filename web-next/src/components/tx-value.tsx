import type { Tx } from "@/lib/api";
import { fmt } from "@/lib/format";

// Tipos cujo `amount` é valor NATIVO em EAV7.
const VALUE_TYPES = new Set([
  "TRANSFER",
  "EAVM_TRANSFER",
  "STAKE",
  "UNSTAKE",
  "AI_TASK",
  "BRIDGE_OUT",
  "BRIDGE_IN",
  "VESTING_CREATE",
  "VESTING_CLAIM",
  "CLAIM_VOTER_REWARD",
  "META_TX",
  "DELEGATE_RESOURCE",
  "UNDELEGATE_RESOURCE",
]);

// Tipos cujo `amount` é quantidade de TOKEN EAV20 (não-nativo).
const TOKEN_AMOUNT_TYPES = new Set([
  "TOKEN_TRANSFER",
  "TOKEN_TRANSFER_FROM",
  "TOKEN_MINT",
  "TOKEN_BURN",
]);

export function TxValue({ tx }: { tx: Tx }) {
  if (VALUE_TYPES.has(tx.type) && BigInt(tx.amount || "0") > 0n)
    return <span className="tnum font-semibold text-ok">{fmt(tx.amount)} EAV7</span>;

  if (TOKEN_AMOUNT_TYPES.has(tx.type))
    return (
      <span className="tnum">
        {tx.amount} <span className="text-muted">token</span>
      </span>
    );

  // NFT: mostra o #tokenId quando disponível no data.
  if (tx.type.startsWith("NFT_")) {
    const id = (tx.data as { tokenId?: string | number } | undefined)?.tokenId;
    return id != null ? (
      <span className="tnum">
        #{String(id)} <span className="text-muted">nft</span>
      </span>
    ) : (
      <span className="text-muted">nft</span>
    );
  }

  // Nome (EAV-NS): mostra o próprio nome quando disponível.
  if (tx.type.startsWith("NAME_")) {
    const name = (tx.data as { name?: string } | undefined)?.name;
    return name ? <span className="font-mono text-ink">{name}</span> : <span className="text-muted">—</span>;
  }

  return <span className="text-muted">—</span>;
}
