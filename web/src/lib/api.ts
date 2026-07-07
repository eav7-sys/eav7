// Client da API REST do nó EAV7. Mesmo domínio (o nó serve o SPA), então caminhos relativos.

export interface Status {
  chain: string;
  protocol: string;
  symbol: string;
  blockTimeMs: number;
  height: number;
  headHash: string | null;
  headTime: number | null;
  supply: string;
  genesisSupply: string;
  minted: string;
  burned: string;
  circulating: string;
  blockReward: string;
  validators: number;
  mempool: number;
  energy?: { free: number; perStakedEav7: number; regenBlocks: number };
  ai?: { oracles: number; pendingTasks: number };
  security?: { alerts: number };
  eavm?: { chainId: number; rpcPort: number; rpcUrl?: string; decimals: number };
}

export interface Tx {
  id: string;
  type: string;
  from: string;
  to: string | null;
  amount: string;
  fee: string;
  nonce: number;
  timestamp: number;
  scheme?: string;
  data?: Record<string, unknown>;
  _h?: number;
  blockHeight?: number;
}

export interface Block {
  height: number;
  hash: string;
  previousHash: string;
  txRoot: string;
  txCount: number;
  producer: string;
  timestamp: number;
  protocol: string;
  scheme: string;
  transactions?: Tx[];
}

export interface AddressInfo {
  address: string;
  eavmAddress: string | null;
  balance: string;
  balanceFormatted: string;
  staked: string;
  stakedFormatted: string;
  nonce: number;
  nextNonce: number;
  energy: { max: number; available: number };
  feeExempt: boolean;
  isValidator: boolean;
  tokens: Record<string, { symbol: string; balance: string }>;
  oracle: unknown;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => get<Status>('/status'),
  blocks: (limit = 15) => get<Block[]>(`/blocks?limit=${limit}`),
  block: (hashOrHeight: string | number) => get<{ block?: Block } & Block>(`/blocks/${hashOrHeight}`),
  chainPage: (from: number, limit = 25) => get<{ blocks: Block[] }>(`/chain?from=${from}&limit=${limit}`),
  recentTxs: (limit = 12) => get<{ txs: Tx[]; nextBefore: number | null; height: number }>(`/txs?limit=${limit}`),
  tx: (id: string) => get<{ tx: Tx; status: string; blockHeight: number | null; blockHash?: string }>(`/tx/${id}`),
  address: (addr: string) => get<AddressInfo>(`/address/${addr}`),
  addressTxs: (addr: string, limit = 50, before?: number) =>
    get<{ txs: Tx[]; nextBefore: number | null }>(`/address/${addr}/txs?limit=${limit}${before != null ? `&before=${before}` : ''}`),
  validators: () => get<{ current: { address: string; staked: string }[] }>('/validators'),
  tokens: () => get<{ id: string; symbol: string; name: string; holders: number }[]>('/tokens'),
  eavmToE7: (addr0x: string) => get<{ eavm: string; eav7: string }>(`/eavm/address/${addr0x}`),
  search: (q: string) => get<{ query: string; results: { kind: string; label: string; sub?: string; detail?: string; to: string }[] }>(`/search?q=${encodeURIComponent(q)}`),
  postTx: async (body: unknown) => {
    const res = await fetch('/tx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
  },
  postEavmTx: async (raw: string) => {
    const res = await fetch('/eavm/tx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }) });
    const j = await res.json();
    if (!res.ok || j.accepted === false) throw new Error(j.error ?? j.reason ?? 'recusada');
    return j;
  },
};
