// Agregados e índice de busca (G21) — extraídos de api.js.

const NATIVE_VOLUME_TYPES = new Set(['TRANSFER', 'EAVM_TRANSFER']);
const STATS_BUCKETS = 24;
const STATS_SCAN_CAP = 5_000;
const SEARCH_SUBSTR_SCAN_CAP = 50_000;

let statsCache = { height: -1, value: null };
let searchIndexCache = { height: -1, sorted: null };

export function computeStats(blockchain, state) {
  if (statsCache.value && statsCache.height === blockchain.height) return statsCache.value;
  const accs = Object.keys(state.accounts);
  let staked = 0n;
  for (const a of accs) staked += (state.accounts[a].staked ?? 0n);

  const now = blockchain.head?.timestamp ?? 0;
  const dayMs = 86_400_000;
  const from = now - dayMs;
  const bucketMs = dayMs / STATS_BUCKETS;
  const txSeries = new Array(STATS_BUCKETS).fill(0);
  const volSeries = new Array(STATS_BUCKETS).fill(0n);
  let volume24h = 0n;
  let txCount24h = 0;
  let oldest = null;
  const bwt = blockchain.blocksWithTxs ?? [];
  let scanned = 0;
  for (let i = bwt.length - 1; i >= 0 && scanned < STATS_SCAN_CAP; i--) {
    const b = blockchain.getBlock(bwt[i]);
    if (!b) continue;
    scanned++;
    if (b.timestamp < from) break;
    const bucket = Math.min(STATS_BUCKETS - 1, Math.max(0, Math.floor((b.timestamp - from) / bucketMs)));
    oldest = b.timestamp;
    for (const t of (b.transactions ?? [])) {
      txCount24h++;
      txSeries[bucket]++;
      if (NATIVE_VOLUME_TYPES.has(t.type)) {
        const amt = BigInt(t.amount ?? '0');
        volume24h += amt;
        volSeries[bucket] += amt;
      }
    }
  }

  const value = {
    accounts: accs.length,
    staked,
    transactions: blockchain.txIndex.size,
    volume24h,
    txCount24h,
    tps: oldest !== null && now > oldest ? txCount24h / ((now - oldest) / 1000) : 0,
    txSeries,
    volSeries,
  };
  statsCache = { height: blockchain.height, value };
  return value;
}

export function searchIndex(blockchain, state) {
  if (searchIndexCache.sorted && searchIndexCache.height === blockchain.height) {
    return searchIndexCache.sorted;
  }
  const cand = new Set(Object.keys(state.accounts));
  for (const tok of Object.values(state.tokens)) {
    for (const h of Object.keys(tok.balances ?? {})) cand.add(h);
  }
  const sorted = [...cand]
    .map((a) => [a.toLowerCase(), a])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  searchIndexCache = { height: blockchain.height, sorted };
  return sorted;
}

export function lowerBound(sorted, ql) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid][0] < ql) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export { SEARCH_SUBSTR_SCAN_CAP };
