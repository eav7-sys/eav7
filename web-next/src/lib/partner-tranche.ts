/**
 * PartnerTrancheVault — 10% privado, 4 partes, só o owner da carteira nativa.
 *
 * Configure no deploy:
 *   NEXT_PUBLIC_PARTNER_TRANCHE_VAULT=0x…
 *   NEXT_PUBLIC_PARTNER_OWNER_EVM=0x…   (mesmo 0x da carteira owner no construtor)
 */

export const PARTNER_TRANCHE_VAULT = (process.env.NEXT_PUBLIC_PARTNER_TRANCHE_VAULT ?? "").trim();
export const PARTNER_OWNER_EVM = (process.env.NEXT_PUBLIC_PARTNER_OWNER_EVM ?? "").trim().toLowerCase();

export const PARTNER_TRANCHE_ENABLED = Boolean(
  PARTNER_TRANCHE_VAULT && /^0x[0-9a-fA-F]{40}$/.test(PARTNER_TRANCHE_VAULT)
);

/** e7 atômicos do bucket 10% (100B × 10⁶ × 10%). */
export const PARTNER_BUCKET_E7 = 10_000_000_000_000_000n;
export const PARTNER_TRANCHE_E7 = PARTNER_BUCKET_E7 / 4n;

/** Selectors keccak (PartnerTrancheVault.sol). */
export const PARTNER_SELECTORS = {
  releaseTo: "d1fb5646", // releaseTo(address)
  arm: "fb90b4ea", // arm(uint128)
} as const;

function padAddress(addr: string): string {
  const h = addr.trim().toLowerCase().replace(/^0x/, "");
  return h.padStart(64, "0");
}

function padUint(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

export function encodeReleaseTo(to0x: string): string {
  return `0x${PARTNER_SELECTORS.releaseTo}${padAddress(to0x)}`;
}

export function encodeArm(totalE7: bigint = PARTNER_BUCKET_E7): string {
  return `0x${PARTNER_SELECTORS.arm}${padUint(totalE7)}`;
}

export function isPartnerOwner(evm: string): boolean {
  if (!PARTNER_OWNER_EVM) return false;
  return evm.trim().toLowerCase() === PARTNER_OWNER_EVM;
}

/** Destino proibido: owner (e derivado 0x da mesma chave) ou o próprio vault. */
export function isForbiddenPartnerRecipient(to0x: string, ownerEvm = PARTNER_OWNER_EVM): boolean {
  const to = to0x.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(to)) return false;
  if (ownerEvm && to === ownerEvm.trim().toLowerCase()) return true;
  if (PARTNER_TRANCHE_VAULT && to === PARTNER_TRANCHE_VAULT.toLowerCase()) return true;
  return false;
}
