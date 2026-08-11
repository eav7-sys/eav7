// Dados de exemplo gerados 100% no front-end — nenhuma chamada ao backend.
// Determinístico por altura/seed, com "altura" avançando pelo relógio para dar
// sensação de tempo real. Mesmos formatos da API para religar o backend depois.
import type {
  Status,
  Block,
  Tx,
  TxPage,
  TxType,
  Validators,
  BlockDetail,
  TxDetail,
  AddressInfo,
  TokenSummary,
  TokenDetail,
  TokenHolders,
  NetworkStats,
  EavmTxResult,
  NftCollectionSummary,
  NftCollectionDetail,
  NameEntry,
  GovernanceState,
  Treasury,
  SecurityAlert,
  AiTask,
  AiOracle,
} from "./api";

const BASE_HEIGHT = 4_218_530;
const BLOCK_MS = 1000;

// Determinístico no SERVIDOR (sempre BASE_HEIGHT) para casar com a hidratação;
// "vivo" só no CLIENTE, avançando a partir da época capturada no navegador.
// Assim o primeiro render (via initialData) bate server/client e o número só
// sobe depois da hidratação, via polling. Sem hydration mismatch.
const IS_CLIENT = typeof window !== "undefined";
const CLIENT_EPOCH = IS_CLIENT ? Date.now() : 0;

function currentHeight(): number {
  return BASE_HEIGHT + (IS_CLIENT ? Math.floor((Date.now() - CLIENT_EPOCH) / BLOCK_MS) : 0);
}
// Timestamps ancorados no "agora" real (aparecem só via <Ago> suprimido ou
// em HTML estático de páginas server) — seguros para hidratação.
const tsOf = (h: number): number => Date.now() - (currentHeight() - h) * BLOCK_MS;

// PRNG determinístico (mulberry32) a partir de um número.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const HEXU = "0123456789ABCDEF";
function hexFrom(seed: number, len: number): string {
  const r = rng(seed);
  let s = "";
  for (let i = 0; i < len; i++) s += HEXU[Math.floor(r() * 16)];
  return s;
}
const e7hash = (seed: number) => "E7" + hexFrom(seed * 2 + 1, 62);
const e7addr = (seed: number) => "E7" + hexFrom(seed * 7 + 3, 32);
const intIn = (r: () => number, min: number, max: number) =>
  min + Math.floor(r() * (max - min + 1));

const VALIDATORS = [
  { address: "E79F4F604DDBCDD5BEB6E4D1FDD193F0ED", staked: "10000000000", votes: "4200000000" },
  { address: "E745706CC4F0604ABF251F55EC9C65DEA2", staked: "1000000000", votes: "2600000000" },
  { address: "E7EA592A0E54BF561DEA632805B8A5B881", staked: "1000000000", votes: "900000000" },
];

const TX_TYPES: [TxType, number][] = [
  ["EAVM_TRANSFER", 0.24],
  ["TRANSFER", 0.18],
  ["TOKEN_TRANSFER", 0.1],
  ["STAKE", 0.07],
  ["VOTE", 0.06],
  ["AI_TASK", 0.05],
  ["TOKEN_MINT", 0.04],
  ["NFT_MINT", 0.04],
  ["NFT_TRANSFER", 0.03],
  ["NAME_REGISTER", 0.03],
  ["GOV_VOTE", 0.03],
  ["CLAIM_VOTER_REWARD", 0.03],
  ["META_TX", 0.03],
  ["DELEGATE_RESOURCE", 0.02],
  ["UNSTAKE", 0.02],
  ["BRIDGE_OUT", 0.02],
  ["VESTING_CLAIM", 0.02],
  ["MULTISIG_APPROVE", 0.02],
  ["ORACLE_REGISTER", 0.02],
];
// Tipos sem destinatário (`to = null`) no explorer.
const NO_RECIPIENT = new Set<TxType>([
  "STAKE",
  "UNSTAKE",
  "ORACLE_REGISTER",
  "VOTE",
  "CLAIM_VOTER_REWARD",
  "GOV_VOTE",
  "VESTING_CLAIM",
  "MULTISIG_APPROVE",
  "SET_COMMISSION",
]);

// Amostra de `data` por tipo, para o painel de dados da tx no explorer (mock).
function mockTxData(type: TxType, seed: number): Record<string, unknown> | undefined {
  switch (type) {
    case "EAVM_TRANSFER":
      return {
        eavmFrom: "0x" + hexFrom(seed + 10, 40).toLowerCase(),
        eavmTo: "0x" + hexFrom(seed + 20, 40).toLowerCase(),
        eavmHash: "0x" + hexFrom(seed + 30, 64).toLowerCase(),
      };
    case "VOTE":
      return { votes: { [e7addr(seed + 5)]: (BigInt(500 + (seed % 900)) * 1_000_000n).toString() } };
    case "GOV_VOTE":
      return { proposalId: e7hash(seed + 7), approve: seed % 2 === 0 };
    case "TOKEN_MINT":
    case "TOKEN_BURN":
      return { tokenId: e7hash(seed + 9), symbol: "QBIT" };
    case "NFT_MINT":
    case "NFT_TRANSFER":
      return { collection: e7hash(seed + 11), tokenId: seed % 10000, uri: "ipfs://Qm" + hexFrom(seed + 12, 20) };
    case "NAME_REGISTER":
    case "NAME_UPDATE":
      return { name: "eav" + (seed % 1000) + ".e7", target: e7addr(seed + 2) };
    case "VESTING_CLAIM":
      return { vestingId: e7hash(seed + 13) };
    case "META_TX":
      return { relayer: e7addr(seed + 3), inner: "TRANSFER" };
    case "DELEGATE_RESOURCE":
    case "UNDELEGATE_RESOURCE":
      return { resource: seed % 2 === 0 ? "energy" : "bandwidth" };
    default:
      return undefined;
  }
}

function pickType(r: () => number): TxType {
  let x = r();
  for (const [t, w] of TX_TYPES) {
    if ((x -= w) <= 0) return t;
  }
  return "TRANSFER";
}

function txCountFor(h: number): number {
  return intIn(rng(h * 13 + 5), 0, 8);
}

export function mockBlock(h: number): Block {
  return {
    height: h,
    timestamp: tsOf(h),
    previousHash: e7hash(h - 1),
    txRoot: e7hash(h * 3 + 99),
    txCount: txCountFor(h),
    producer: VALIDATORS[h % VALIDATORS.length].address,
    protocol: "eav20",
    scheme: "eav7-hybrid-1",
    // Cabeçalho assinado (~640 B com as duas assinaturas) + o peso das txs. Não é
    // uma medida — é uma ordem de grandeza plausível, para a tela não mostrar
    // travessão onde o nó real mostra bytes.
    size: 640 + txCountFor(h) * 420,
  };
}

function mockTxAt(h: number, i: number): Tx {
  const seed = h * 100 + i;
  const r = rng(seed);
  const type = pickType(r);
  const noRecipient = NO_RECIPIENT.has(type);
  const amount = (BigInt(intIn(r, 1, 9000)) * 1_000_000n).toString();
  return {
    id: e7hash(seed),
    type,
    from: e7addr(seed + 1),
    to: noRecipient ? null : e7addr(seed + 2),
    amount,
    fee: "10000",
    nonce: intIn(r, 0, 40),
    timestamp: tsOf(h),
    blockHeight: h,
    scheme: type === "EAVM_TRANSFER" ? "eav7-eavm-1" : "eav7-hybrid-1",
    data: mockTxData(type, seed),
  };
}

export function mockStatus(): Status {
  const h = currentHeight();
  return {
    chain: "EAV7",
    protocol: "eav20",
    symbol: "EAV7",
    blockTimeMs: BLOCK_MS,
    height: h,
    finalizedHeight: h - 2, // finalidade BFT segue ~2 blocos atrás do head
    headHash: e7hash(h),
    headTime: tsOf(h),
    supply: "100001299216000000",
    genesisSupply: "100000000000000000",
    minted: "1299216000000",
    burned: "1728400000",
    treasury: "3120000000",
    circulating: "100001299216000000",
    blockReward: "16000000",
    energy: { free: 10, perStakedEav7: 1, regenBlocks: 86400 },
    mempool: intIn(rng(h * 3 + 7), 0, 38),
    validators: VALIDATORS.length,
    peers: 4,
    producer: VALIDATORS[h % VALIDATORS.length].address,
    ai: { pendingTasks: intIn(rng(h + 1), 0, 3), oracles: 2 },
    bridge: { transfers: 3, lockedNative: "0" },
    security: { alerts: 18 },
    eavm: { chainId: 72020, rpcPort: 7075, decimals: 18, rpcUrl: "https://rpc.eavscan.com" },
  };
}

export function mockBlocks(limit: number, from?: number): Block[] {
  const h = currentHeight();
  if (from != null) {
    const out: Block[] = [];
    for (let i = 0; i < limit && from + i <= h; i++) out.push(mockBlock(from + i));
    return out;
  }
  const out: Block[] = [];
  for (let i = 0; i < limit; i++) out.push(mockBlock(h - i));
  return out;
}

export function mockTxs(limit: number, before?: number): TxPage {
  const top = before ?? currentHeight();
  const txs: Tx[] = [];
  let h = top;
  let guard = 0;
  while (txs.length < limit && guard < limit * 6) {
    const c = txCountFor(h);
    for (let i = 0; i < c && txs.length < limit; i++) txs.push(mockTxAt(h, i));
    h--;
    guard++;
  }
  return { txs, nextBefore: h > BASE_HEIGHT ? h : null, height: top };
}

export function mockValidators(): Validators {
  return {
    maxValidators: 51,
    bankSize: 50,
    minStake: "1000000000",
    blockReward: "16000000",
    current: VALIDATORS.map((v) => ({ ...v })),
    bank: [],
    slotProducer: VALIDATORS[currentHeight() % VALIDATORS.length].address,
  };
}

export function mockBlockDetail(ref: string | number): BlockDetail {
  const h = typeof ref === "number" ? ref : /^\d+$/.test(ref) ? Number(ref) : currentHeight();
  const base = mockBlock(h);
  const transactions: Tx[] = [];
  for (let i = 0; i < base.txCount; i++) transactions.push(mockTxAt(h, i));
  return { ...base, version: 1, transactions };
}

export function mockTxDetail(id: string): TxDetail {
  const seed = strSeed(id);
  const r = rng(seed);
  const type = pickType(r);
  const h = currentHeight() - intIn(r, 1, 400);
  const noRecipient = NO_RECIPIENT.has(type);
  const tx: Tx = {
    id,
    type,
    from: e7addr(seed + 1),
    to: noRecipient ? null : e7addr(seed + 2),
    amount: (BigInt(intIn(r, 1, 9000)) * 1_000_000n).toString(),
    fee: "10000",
    nonce: intIn(r, 0, 40),
    timestamp: tsOf(h),
    blockHeight: h,
    scheme: type === "EAVM_TRANSFER" ? "eav7-eavm-1" : "eav7-hybrid-1",
    data: mockTxData(type, seed),
  };
  return { status: "CONFIRMED", tx, blockHeight: h, blockHash: e7hash(h) };
}

export function mockAddress(addr: string): AddressInfo {
  const known = VALIDATORS.find((v) => v.address === addr);
  const seed = strSeed(addr);
  const r = rng(seed);
  const isValidator = !!known;
  const balance = (BigInt(intIn(r, 10, 90000)) * 1_000_000n).toString();
  const staked = known ? known.staked : intIn(r, 0, 3) === 0 ? (BigInt(intIn(r, 1, 500)) * 1_000_000n).toString() : "0";
  // Energia = 10 grátis + 1 por EAV7 em stake (o "gas" da EAV7).
  const stakedEav7 = Number(BigInt(staked) / 1_000_000n);
  const energyMax = 10 + stakedEav7;
  return {
    address: addr,
    eavmAddress: addr.startsWith("0x") ? addr : null,
    balance,
    staked,
    nonce: intIn(r, 0, 30),
    nextNonce: intIn(r, 0, 30) + 1,
    energy: { max: energyMax, available: intIn(r, Math.floor(energyMax * 0.4), energyMax) },
    feeExempt: BigInt(staked) >= 100_000_000n,
    isValidator,
    votes: known ? known.votes : "0",
    commission: isValidator ? 20 : undefined,
    tokens: {},
    nfts:
      intIn(r, 0, 2) === 0
        ? [{ collection: e7hash(2001), symbol: "PUNK", tokenId: String(intIn(r, 1, 512)), uri: "ipfs://Qm" + hexFrom(seed, 20) }]
        : [],
    names: intIn(r, 0, 3) === 0 ? [{ name: `user${seed % 1000}.e7`, target: addr }] : [],
    oracle: null,
  };
}

export function mockAddressTxs(addr: string, limit: number): { txs: Tx[] } {
  const seed = strSeed(addr);
  const h = currentHeight();
  const txs: Tx[] = [];
  const n = intIn(rng(seed), 0, limit);
  for (let i = 0; i < n; i++) {
    const t = mockTxAt(h - i * 3 - 1, i % 5);
    // liga metade das txs ao endereço consultado
    txs.push(i % 2 === 0 ? { ...t, from: addr } : { ...t, to: addr });
  }
  return { txs };
}

// O catálogo do nó sai de `tokenView`: mesmos campos do detalhe. O mock precisa
// entregar a mesma forma, senão a tela funciona no mock e quebra no nó real.
function tokenMock(
  n: number, symbol: string, name: string, totalSupply: string, holders: number, v: number,
): TokenSummary {
  return {
    id: e7hash(n), symbol, name, totalSupply, holders,
    standard: "EAV20", decimals: 6, mintable: true, paused: false,
    creator: VALIDATORS[v].address, owner: VALIDATORS[v].address,
    createdAt: 1_700_000_000_000 + n * 86_400_000,
  };
}

export function mockTokens(): TokenSummary[] {
  return [
    tokenMock(1001, "USDE", "USD EAV", "50000000", 1284, 0),
    tokenMock(1002, "QBIT", "QuantumBit", "21000000", 642, 1),
    tokenMock(1003, "AIX", "AI Oracle Token", "100000000", 318, 2),
  ];
}

// Detalhe do token: mesma lista do catálogo, enriquecida com o estado administrativo.
// O primeiro token é `mintable`, o segundo tem supply fixo — os dois casos aparecem na tela.
export function mockToken(id: string): TokenDetail | null {
  const i = mockTokens().findIndex((t) => t.id === id);
  if (i < 0) return null;
  const base = mockTokens()[i];
  return {
    ...base,
    standard: "eav20",
    decimals: 6,
    owner: base.creator,
    mintable: i === 0,
    paused: false,
    createdAt: Date.now() - (i + 1) * 86_400_000 * 30,
  };
}

// Distribuição sintética com cauda decrescente: o topo concentra, a cauda pulveriza —
// é o formato real de um token e o que torna a barra de participação legível.
export function mockTokenHolders(id: string, limit: number): TokenHolders | null {
  const token = mockToken(id);
  if (!token) return null;
  const supply = Number(token.totalSupply);
  const r = rng(strSeed(id));
  const n = Math.min(limit, token.holders);
  const weights = Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, 1.35) * (0.85 + r() * 0.3));
  const total = weights.reduce((a, b) => a + b, 0);
  return {
    token: id,
    decimals: token.decimals,
    totalSupply: token.totalSupply,
    holders: token.holders,
    list: weights.map((w, i) => {
      const share = w / total;
      const balance = Math.floor(supply * share);
      return {
        rank: i + 1,
        address: i === 0 ? token.creator : e7addr(strSeed(id) + i * 13),
        balance: String(balance * 10 ** token.decimals),
        shareBps: Math.round(share * 10_000),
        frozen: "0",
        blacklisted: false,
      };
    }),
  };
}

// Transferências do token: TOKEN_TRANSFER com `asset` já resolvido, exatamente como o
// nó devolve — a tabela não precisa consultar o catálogo por linha.
export function mockTokenTransfers(id: string, limit: number): { txs: Tx[] } {
  const token = mockToken(id);
  if (!token) return { txs: [] };
  const h = currentHeight();
  const txs: Tx[] = [];
  for (let i = 0; i < limit; i++) {
    const seed = strSeed(id) + i * 31;
    const r = rng(seed);
    txs.push({
      id: e7hash(seed),
      type: "TOKEN_TRANSFER",
      from: e7addr(seed + 1),
      to: e7addr(seed + 2),
      amount: String(BigInt(intIn(r, 1, 250_000)) * 10n ** BigInt(token.decimals)),
      fee: "10000",
      nonce: intIn(r, 0, 40),
      timestamp: tsOf(h - i * 4 - 1),
      blockHeight: h - i * 4 - 1,
      scheme: "eav7-hybrid-1",
      data: { token: id },
      asset: { kind: "EAV20", id, symbol: token.symbol, name: token.name, decimals: token.decimals },
    });
  }
  return { txs };
}

export function mockPostEavmTx(raw: string): EavmTxResult {
  return { accepted: true, id: e7hash(strSeed(raw)) };
}

const NFT_COLLECTIONS = [
  { id: e7hash(2001), name: "EAV7 Genesis Punks", symbol: "PUNK", supply: 512, nextId: 512 },
  { id: e7hash(2002), name: "Quantum Artifacts", symbol: "QART", supply: 128, nextId: 128 },
  { id: e7hash(2003), name: "Validator Crests", symbol: "CREST", supply: 27, nextId: 27 },
];

export function mockNfts(): NftCollectionSummary[] {
  return NFT_COLLECTIONS.map((c, i) => ({
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    owner: VALIDATORS[i % VALIDATORS.length].address,
    supply: c.supply,
    nextId: c.nextId,
  }));
}

export function mockNftCollection(id: string): NftCollectionDetail | null {
  const c = NFT_COLLECTIONS.find((x) => x.id === id) ?? NFT_COLLECTIONS[0];
  const shown = Math.min(24, c.supply);
  const tokens = Array.from({ length: shown }, (_, i) => ({
    tokenId: String(i + 1),
    owner: e7addr(strSeed(c.id) + i * 7),
    uri: "ipfs://Qm" + hexFrom(strSeed(c.id) + i, 20),
  }));
  return {
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    owner: VALIDATORS[0].address,
    supply: c.supply,
    nextId: c.nextId,
    tokens,
  };
}

export function mockNames(): NameEntry[] {
  const base = ["eav7", "satoshi", "tesouraria", "oracle", "ponte", "genesis", "wope", "validator"];
  return base.map((n, i) => ({
    name: `${n}.e7`,
    target: e7addr(strSeed(n)),
    owner: e7addr(strSeed(n) + 1),
    registeredAt: Date.now() - i * 86400000,
  }));
}

export function mockGovernance(): GovernanceState {
  const h = currentHeight();
  return {
    params: { TREASURY_PCT: 5, BLOCK_REWARD: "16000000" },
    proposals: [
      { id: e7hash(3001), param: "TREASURY_PCT", value: 5, proposer: VALIDATORS[0].address, status: "PASSED", deadline: h - 1000, voteCount: 3, createdAt: Date.now() - 6 * 86400000, appliesAt: h - 200 },
      { id: e7hash(3002), param: "BLOCK_REWARD", value: "16000000", proposer: VALIDATORS[1].address, status: "VOTING", deadline: h + 40000, voteCount: 1, createdAt: Date.now() - 3600000 },
    ],
    validators: VALIDATORS.length,
  };
}

export function mockTreasury(): Treasury {
  return { balance: "3120000000", treasuryPct: 5 };
}

export function mockSecurityAlerts(): SecurityAlert[] {
  const now = Date.now();
  const samples: [SecurityAlert["severity"], string, string][] = [
    ["info", "SENTINEL_REPORT", "Rede estável: produção em ritmo, sem forks nem concentração de produtores."],
    ["warning", "LARGE_TRANSFER", "Transferência acima de 1% do supply detectada no bloco recente."],
    ["info", "MEMPOOL", "Fluxo de mempool normal; sem rajadas anômalas de transações."],
    ["warning", "PRODUCER_CONCENTRATION", "Um produtor concentrou 40% dos últimos blocos — monitorando."],
    ["info", "SENTINEL_REPORT", "Parecer horário do analista de IA: nenhum comportamento suspeito."],
    ["critical", "REORG", "Reorganização de cadeia observada (profundidade 2) — dentro do esperado."],
  ];
  return Array.from({ length: 24 }, (_, i) => {
    const [severity, kind, message] = samples[i % samples.length];
    return { at: now - i * 900_000, source: "sentinel", kind, severity, message };
  });
}

export function mockAiTasks(): AiTask[] {
  return [];
}

export function mockAiOracles(): AiOracle[] {
  return [];
}

export function mockNetworkStats(): NetworkStats {
  const h = currentHeight();
  // séries horárias determinísticas (24 buckets)
  const txSeries = Array.from({ length: 24 }, (_, i) => intIn(rng(h + i * 31), 2, 40));
  // volume em e7 CRU, como o nó publica (UNIT = 1e6)
  const volSeries = txSeries.map((n, i) => BigInt(n * intIn(rng(h + i * 7), 20, 900)) * 1_000_000n);
  const txCount24h = txSeries.reduce((a, b) => a + b, 0);
  const vol24h = volSeries.reduce((a, b) => a + b, 0n);
  const t0 = txSeries.length * 3600; // a série cobre 24 h
  return {
    accounts: Math.floor(902_400 + 0.12 * h),
    accountsDelta: 0, // sem histórico → sem delta (como no real)
    transactions: Math.floor(3.7 * h),
    transactionsDelta: txCount24h, // real: nº de txs em 24h
    volume: vol24h.toString(), // volume 24h, em e7
    volumeDelta: vol24h.toString(),
    staked: (41_280_000n * 1_000_000n).toString(),
    stakedDelta: "0",
    tps: txCount24h / t0,
    txSeries,
    volSeries: volSeries.map((v) => v.toString()),
  };
}
