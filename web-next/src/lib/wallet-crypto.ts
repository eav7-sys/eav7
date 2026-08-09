/**
 * Carteira EAV7 — camada FINA sobre `eav7-wasm` (rust/wasm): a mesma
 * implementação de consenso que o nó usa para validar, compilada para o
 * navegador. A cópia TS de keccak/secp256k1/RLP/derivação E7 que vivia aqui
 * foi eliminada (plano G2) — regra de endereço tem UMA implementação.
 *
 * Regenerar o pacote wasm: `npm run wasm:build` (usa wasm-pack; saída em
 * `src/lib/eav7-wasm/`).
 *
 * O que continua em TS: o cofre AES-GCM (WebCrypto) e as constantes de
 * endereços de sistema — nada disso é regra de consenso.
 *
 * Carregar apenas em contexto client: o wasm é importado sob demanda dentro
 * das funções, então o SSR nunca o carrega. A chave é gerada e assinada
 * SOMENTE no navegador — nunca sai do dispositivo.
 */

export interface Account {
  privateKey: string;
  evm: string;
  eav7: string;
}

export interface EncryptedVault {
  v: number;
  salt: string;
  iv: string;
  ct: string;
}

type Eav7Wasm = typeof import("./eav7-wasm/eav7_wasm");
type Conta = import("./eav7-wasm/eav7_wasm").Conta;

let wasmPromise: Promise<Eav7Wasm> | null = null;
const eav7Wasm = (): Promise<Eav7Wasm> =>
  (wasmPromise ??= import("./eav7-wasm/eav7_wasm"));

/** Copia a `Conta` wasm para um objeto JS puro e libera a memória linear. */
function toAccount(conta: Conta): Account {
  try {
    return { privateKey: conta.privateKey, evm: conta.eavm, eav7: conta.e7 };
  } finally {
    conta.free();
  }
}

export async function createAccount(): Promise<Account> {
  const w = await eav7Wasm();
  return toAccount(w.criarConta());
}

export async function accountFromPrivate(privHex: string): Promise<Account> {
  const w = await eav7Wasm();
  return toAccount(w.contaDeChavePrivada(privHex.trim()));
}

interface BuildTxArgs {
  privateKey: string;
  nonce: number;
  to: string;
  valueWei: bigint;
  chainId: number;
  gasPriceWei?: bigint;
  gasLimit?: bigint;
}

/** Monta e assina uma transação EAVM (EIP-155) e devolve o raw `0x…`. */
export async function buildSignedTx({
  privateKey,
  nonce,
  to,
  valueWei,
  chainId,
  gasPriceWei,
  gasLimit,
}: BuildTxArgs): Promise<string> {
  const w = await eav7Wasm();
  return w.assinarTransacao(
    privateKey,
    BigInt(nonce),
    to,
    valueWei.toString(),
    BigInt(chainId),
    gasPriceWei?.toString() ?? null,
    gasLimit?.toString() ?? null,
    null
  );
}

export const EAVM_STAKE_ADDRESS = "0x0000000000000000000000000000000000007001";
export const EAVM_UNSTAKE_ADDRESS = "0x0000000000000000000000000000000000007002";

/* ------------------------------------------------------------------ */
/* Cofre local: AES-GCM via WebCrypto. Não é regra de consenso — só a  */
/* cifra do backup da chave neste dispositivo. Permanece em TS.        */
/* ------------------------------------------------------------------ */

const b64 = (u8: Uint8Array): string => btoa(String.fromCharCode(...u8));
const ub64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const subtle = (): SubtleCrypto | null => (globalThis.crypto && globalThis.crypto.subtle) || null;
// Uint8Array é um BufferSource válido em runtime; a lib do TS 5.9 é estrita
// quanto ao generic do buffer — este cast reconcilia sem copiar bytes.
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  usage: KeyUsage[]
): Promise<CryptoKey> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto indisponível (use https ou localhost)");
  const base = await s.importKey("raw", bs(new TextEncoder().encode(password)), "PBKDF2", false, [
    "deriveKey",
  ]);
  return s.deriveKey(
    { name: "PBKDF2", salt: bs(salt), iterations: 210000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usage
  );
}

export async function encryptKey(privHex: string, password: string): Promise<EncryptedVault> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto indisponível (use https ou localhost)");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, ["encrypt"]);
  const ct = await s.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(new TextEncoder().encode(privHex)));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function decryptKey(blob: EncryptedVault, password: string): Promise<string> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto indisponível (use https ou localhost)");
  const key = await deriveAesKey(password, ub64(blob.salt), ["decrypt"]);
  const pt = await s.decrypt({ name: "AES-GCM", iv: bs(ub64(blob.iv)) }, key, bs(ub64(blob.ct)));
  return new TextDecoder().decode(pt);
}
