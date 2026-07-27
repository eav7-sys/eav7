import {
  buildSignedTx,
  encryptKey,
  decryptKey,
  type Account,
  type EncryptedVault,
} from "./wallet-crypto";
import { getAddress, postEavmTx } from "./api";

const VAULT_KEY = "eav7-wallet-vault";
// EAVM usa 18 casas; nativo usa 6. wei = e7 * 10^12.
const WEI_PER_E7 = 10n ** 12n;

export function hasVault(): boolean {
  try {
    return Boolean(localStorage.getItem(VAULT_KEY));
  } catch {
    return false;
  }
}

export function readVault(): EncryptedVault | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? (JSON.parse(raw) as EncryptedVault) : null;
  } catch {
    return null;
  }
}

export async function saveVault(privateKey: string, password: string): Promise<void> {
  const blob = await encryptKey(privateKey, password);
  localStorage.setItem(VAULT_KEY, JSON.stringify(blob));
}

export async function unlockVault(password: string): Promise<string> {
  const blob = readVault();
  if (!blob) throw new Error("nenhuma carteira neste dispositivo");
  return decryptKey(blob, password);
}

export function clearVault(): void {
  localStorage.removeItem(VAULT_KEY);
}

/** "12,5" ou "12.5" → wei (18 casas). Aceita até 6 casas decimais. */
export function parseEav7ToWei(input: string): bigint {
  const m = String(input).trim().replace(",", ".").match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) throw new Error("valor inválido (até 6 casas decimais)");
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "0").padEnd(6, "0"));
  return (whole * 1_000_000n + frac) * WEI_PER_E7;
}

export const isEvmAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
export const isE7Address = (a: string) => /^E7[0-9A-F]{32}$/.test(a);

export interface SendResult {
  id: string;
}

/** Assina no navegador e envia via /eavm/tx. `to` deve ser 0x (conta EAVM). */
export async function signAndSend(
  account: Account,
  params: { to: string; valueWei: bigint; chainId: number }
): Promise<SendResult> {
  if (params.valueWei <= 0n) throw new Error("informe um valor positivo");
  if (!isEvmAddress(params.to)) throw new Error("destino deve ser um endereço 0x (EAVM)");

  const acc = await getAddress(account.evm);
  const nonce = acc.nextNonce ?? acc.nonce ?? 0;
  const raw = buildSignedTx({
    privateKey: account.privateKey,
    nonce,
    to: params.to,
    valueWei: params.valueWei,
    chainId: params.chainId,
  });
  const res = await postEavmTx(raw);
  return { id: res.id ?? "" };
}
