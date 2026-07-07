export interface Account { privateKey: string; evm: string; eav7: string; }
export function createAccount(): Account;
export function accountFromPrivate(hex: string): Account;
export function buildSignedTx(p: { privateKey: string; nonce: number; to: string; valueWei: bigint; chainId: number }): string;
export function evmToE7(addr0x: string): string;
export function encryptKey(privHex: string, password: string): Promise<string>;
export function decryptKey(blob: string, password: string): Promise<string>;
export const EAVM_STAKE_ADDRESS: string;
export const EAVM_UNSTAKE_ADDRESS: string;
