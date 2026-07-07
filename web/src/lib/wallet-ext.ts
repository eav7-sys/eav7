// Integração com carteiras injetadas (MetaMask/Trust) via EIP-6963 — resolve o
// conflito quando as duas extensões disputam o window.ethereum.

interface Eip1193 { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; isMetaMask?: boolean; isTrust?: boolean; isTrustWallet?: boolean }
interface Announce { info?: { rdns?: string; name?: string }; provider: Eip1193 }

const WALLETS: Announce[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = (e as CustomEvent).detail as Announce;
    if (d?.provider) WALLETS.push(d);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function pickProvider(prefer?: 'metamask' | 'trust'): Eip1193 | null {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('eip6963:requestProvider'));
  const byRdns = (m: string) => WALLETS.find((w) => (w.info?.rdns ?? '').includes(m))?.provider;
  const byName = (m: string) => WALLETS.find((w) => (w.info?.name ?? '').toLowerCase().includes(m))?.provider;
  const mm = byRdns('io.metamask') ?? byName('metamask');
  const tw = byRdns('com.trustwallet') ?? byName('trust');
  if (prefer === 'metamask' && mm) return mm;
  if (prefer === 'trust' && tw) return tw;
  if (mm) return mm;
  if (tw) return tw;
  const eth = (window as unknown as { ethereum?: Eip1193 & { providers?: Eip1193[] } }).ethereum;
  if (!eth) return null;
  const list = Array.isArray(eth.providers) ? eth.providers : [eth];
  return list.find((p) => p?.isMetaMask) ?? list.find((p) => p?.isTrust || p?.isTrustWallet) ?? eth;
}

export interface EavmCfg { chainId?: number; rpcPort?: number; rpcUrl?: string }

export function networkParams(cfg: EavmCfg) {
  const rpcUrl = cfg.rpcUrl ?? `${location.protocol}//${location.hostname}:${cfg.rpcPort ?? 7075}`;
  return [{
    chainId: '0x' + Number(cfg.chainId ?? 72020).toString(16),
    chainName: 'EAV7',
    nativeCurrency: { name: 'EAV7', symbol: 'EAV7', decimals: 18 },
    rpcUrls: [rpcUrl],
    blockExplorerUrls: [location.origin + '/explorer'],
    iconUrls: [location.origin + '/icon.png'],
  }];
}

export async function addNetwork(cfg: EavmCfg, prefer?: 'metamask' | 'trust'): Promise<{ ok: boolean; code: 'added' | 'nowallet' | 'unsupported' | 'cancelled' | 'error'; message?: string }> {
  const provider = pickProvider(prefer);
  if (!provider) return { ok: false, code: 'nowallet' };
  try {
    await provider.request({ method: 'wallet_addEthereumChain', params: networkParams(cfg) });
    return { ok: true, code: 'added' };
  } catch (e) {
    const err = e as { code?: number; message?: string };
    if (err.code === -32601 || /does not exist|not available|not supported/i.test(err.message ?? '')) return { ok: false, code: 'unsupported' };
    if (err.code === 4001) return { ok: false, code: 'cancelled' };
    return { ok: false, code: 'error', message: err.message };
  }
}

export async function readAccount(prefer?: 'metamask' | 'trust'): Promise<string | null> {
  const provider = pickProvider(prefer);
  if (!provider) return null;
  const accts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  return accts?.[0] ?? null;
}
