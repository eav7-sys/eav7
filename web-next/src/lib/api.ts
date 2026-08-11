import * as mock from "./mock";

// Cliente da API REST do nó EAV7.
// Em produção o front é servido no mesmo domínio (same-origin, base = "").
// Em development o default é /api (rewrite Next → EAV7_API_ORIGIN), não produção.
// Sobrescreva com NEXT_PUBLIC_API_BASE se precisar.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ??
  (process.env.NODE_ENV === "development" ? "/api" : "");

// Mock SÓ com opt-in explícito. Default antigo (`!== "false"`) publicava dados
// fabricados se a env faltasse no build — inaceitável num explorador.
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true";
if (process.env.NODE_ENV === "production" && USE_MOCK) {
  throw new Error(
    "NEXT_PUBLIC_USE_MOCK=true em production — recusado. Remova a env ou use development.",
  );
}

// Base efetiva por contexto: no servidor (SSR/Server Components) usa a origem INTERNA
// do nó (EAV7_API_ORIGIN, ex.: http://127.0.0.1:6070) — rápido e sem sair pela internet;
// no navegador usa a base pública (NEXT_PUBLIC_API_BASE, ex.: https://api.eavscan.com).
function resolveBase(): string {
  if (typeof window === "undefined" && process.env.EAV7_API_ORIGIN) {
    return process.env.EAV7_API_ORIGIN;
  }
  return API_BASE;
}

export type TxType =
  // nativo
  | "TRANSFER"
  | "EAVM_TRANSFER"
  // staking / consenso
  | "STAKE"
  | "UNSTAKE"
  | "VOTE"
  | "SET_COMMISSION"
  | "CLAIM_VOTER_REWARD"
  | "SLASH_DOUBLE_SIGN"
  // recursos (energia + bandwidth)
  | "DELEGATE_RESOURCE"
  | "UNDELEGATE_RESOURCE"
  // permissões / multisig
  | "PERMISSION_UPDATE"
  | "MULTISIG_PROPOSE"
  | "MULTISIG_APPROVE"
  // governança
  | "GOV_PROPOSE"
  | "GOV_VOTE"
  // vesting / meta-tx
  | "VESTING_CREATE"
  | "VESTING_CLAIM"
  | "META_TX"
  // token EAV20
  | "TOKEN_CREATE"
  | "TOKEN_TRANSFER"
  | "TOKEN_APPROVE"
  | "TOKEN_TRANSFER_FROM"
  | "TOKEN_MINT"
  | "TOKEN_BURN"
  | "TOKEN_PAUSE"
  | "TOKEN_UNPAUSE"
  | "TOKEN_BLACKLIST"
  | "TOKEN_FREEZE"
  | "TOKEN_UNFREEZE"
  // NFT EAV721
  | "NFT_CREATE"
  | "NFT_MINT"
  | "NFT_TRANSFER"
  | "NFT_APPROVE"
  | "NFT_BURN"
  // serviço de nomes EAV-NS
  | "NAME_REGISTER"
  | "NAME_UPDATE"
  | "NAME_TRANSFER"
  | "NAME_RELEASE"
  // IA (camada de oráculos em 6 fases)
  | "AI_TASK"
  | "AI_RESULT"
  | "AI_COMMIT"
  | "AI_REVEAL"
  | "AI_CLAIM"
  | "AI_CHALLENGE"
  | "AI_VERDICT"
  | "AI_BID"
  | "AI_AWARD"
  | "AI_REFUND"
  | "ORACLE_REGISTER"
  // ponte trustless
  | "BRIDGE_OUT"
  | "BRIDGE_IN"
  | "BRIDGE_SETTLE"
  | "BRIDGE_COMMITTEE_UPDATE"
  // EAVM
  | "EAVM_DEPLOY"
  | "EAVM_CALL";

export interface Status {
  chain: string;
  protocol: string;
  symbol: string;
  blockTimeMs: number;
  height: number;
  finalizedHeight: number; // #2 finalidade BFT (-1 = sem finalidade ainda)
  headHash: string;
  headTime: number;
  supply: string;
  genesisSupply?: string;
  minted: string;
  burned: string;
  treasury: string; // cofre governável on-chain
  circulating: string;
  blockReward: string;
  energy: { free: number; perStakedEav7: number; regenBlocks: number };
  mempool: number;
  validators: number;
  peers: number;
  producer: string;
  ai: { pendingTasks: number; oracles: number };
  bridge: { transfers: number; lockedNative: string };
  security: { alerts: number };
  // Alturas dos forks de consenso (0 = já ativo; grande = dormente até rollout coordenado).
  forkHeights?: { bridgeBreaker: number; aiTee: number; bridgeQuorum: number; canonicalHash: number };
  eavm: { chainId: number; rpcPort: number; decimals: number; rpcUrl: string };
}

export interface Block {
  height: number;
  timestamp: number;
  previousHash: string;
  txRoot: string;
  txCount: number;
  producer: string;
  hash?: string;
  protocol?: string;
  scheme?: string;
  /** Bytes da serialização do bloco — a mesma linha que o nó grava em disco e
   *  envia aos peers. `null` só se o bloco não serializar. */
  size?: number | null;
}

export interface Tx {
  id: string;
  type: TxType;
  from: string;
  to: string | null;
  amount: string;
  fee: string;
  nonce: number;
  timestamp: number;
  blockHeight: number;
  blockHash?: string;
  scheme?: string;
  data?: Record<string, unknown>;
  /** Recibo de execução — só presente em tx EAVM. Ausente = aplicada com sucesso. */
  receipt?: { success: boolean; gasUsed?: string | null; contract?: string | null } | null;
  /** Ativo movido quando NÃO é o EAV7 nativo (token EAV20 ou NFT EAV721). */
  asset?: {
    kind: "EAV20" | "EAV721";
    id: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    tokenId?: string;
  } | null;
}

export interface TxPage {
  txs: Tx[];
  nextBefore: number | null;
  height: number;
}

export interface Validator {
  address: string;
  staked: string;
  votes?: string; // #4 votos recebidos (peso = staked + votes)
  /** Nome EAV-NS apontando para o validador; `null` quando não há. Resolvido no
   *  nó — antes o cliente baixava `/names` e invertia o mapa, mas `/names` corta
   *  em 200 registros e deixava anônimo quem estivesse fora da fatia. */
  name?: string | null;
}
// Score de desempenho de validador (derivado da cadeia; observacional, sem consenso).
export type ValidatorHealth = "healthy" | "lagging" | "degraded" | "offline";
export interface ValidatorPerf {
  address: string;
  score: number; // 0..100
  status: ValidatorHealth;
  degraded: boolean;
  productivityPct: number;
  expected: number;
  produced: number;
  inTurn: number;
  missed: number;
  outOfTurn: number;
  avgLatencyMs: number | null;
  lastProducedHeight: number | null;
}
export interface ValidatorPerfSummary {
  count: number;
  healthy: number;
  degraded: number;
  degradedAddresses: string[];
  avgScore: number | null;
  worst: { address: string; score: number; status: ValidatorHealth } | null;
}
export interface Validators {
  maxValidators: number;
  minStake: string;
  blockReward: string;
  current: Validator[];
  /** Standby (plano 17): posições logo abaixo do conjunto ativo. */
  bank?: Validator[];
  bankSize?: number;
  slotProducer: string;
  performance?: ValidatorPerf[];
  performanceSummary?: ValidatorPerfSummary;
  performanceWindow?: { blocks: number; fromHeight: number | null; toHeight: number | null };
}

async function get<T>(path: string, revalidate = 0): Promise<T> {
  const res = await fetch(resolveBase() + path, {
    headers: { accept: "application/json" },
    // dados de cadeia mudam a cada bloco (1s) — nunca cachear no server
    cache: revalidate ? "force-cache" : "no-store",
    ...(revalidate ? { next: { revalidate } } : {}),
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface BlockDetail extends Block {
  version?: number;
  publicKey?: string;
  pqPublicKey?: string;
  transactions?: Tx[];
  error?: string;
}

export interface TxDetail {
  status: "CONFIRMED" | "PENDING" | "FAILED" | string;
  tx: Tx;
  blockHeight?: number;
  blockHash?: string;
  blockTime?: number;
  error?: string;
}

export interface AddressInfo {
  address: string;
  eavmAddress: string | null;
  balance: string;
  balanceFormatted?: string;
  staked: string;
  stakedFormatted?: string;
  nonce: number;
  nextNonce: number;
  energy: { max: number; available: number };
  /** GB · Assinatura Livre (plano 12): bytes ponderados / dia. */
  gb?: { max: number; available: number; used?: number; unit?: string };
  feeExempt: boolean;
  isValidator: boolean;
  votes?: string; // #4 votos recebidos como candidato
  commission?: number; // % de comissão (se validador)
  tokens: Record<string, { symbol?: string; balance?: string; name?: string; decimals?: number }>;
  nfts?: { collection: string; symbol: string; tokenId: string; uri?: string }[];
  names?: { name: string; target: string }[];
  oracle: unknown | null;
  error?: string;
  // --- Fase 2.3 / paridade de abas ---
  activity?: {
    firstSeen: number | null;
    lastSeen: number | null;
    txCount: number;
    transfers: number;
    transfersIn: number;
    transfersOut: number;
    blocks: number;
    truncated: boolean;
  };
  claimableVoterReward?: string;
  approvals?: { token: string; symbol?: string; spender: string; amount: string }[];
  bandwidth?: { max: number; available: number };
  resources?: {
    resourceStake: string;
    delegatedOut: string;
    delegatedIn: string;
    delegations: { from: string; to: string; amount: string }[];
  };
  votesCast?: { to: string; amount: string }[];
  votedTotal?: string;
  unbonding?: { amount: string; matureAt: number; blocksLeft: number }[];
  permissions?: {
    /** true = a conta não configurou multisig; é a autorização efetiva sintetizada. */
    default?: boolean;
    version?: 1 | 2;
    threshold?: number;
    keys?: { address: string; weight: number }[];
    owner?: { threshold: number; keys: { address: string; weight: number }[] };
    actives?: {
      id: number;
      name: string | null;
      threshold: number;
      keys: { address: string; weight: number }[];
      operations: string[] | null;
    }[];
    witness?: string | null;
    recovery?: string | null;
    delayBlocks?: number;
  } | null;
  pendingPermission?: {
    level?: string;
    approvals: string[];
    vetoes: string[];
    executeAt: number | null;
    blocksLeft: number | null;
  } | null;
  vesting?: { id: string; total: string; claimed: string; cliff: number; duration: number }[];
  contract?: { address: string; codeSize: number; verified: boolean; nonce: number } | null;
}

// O que `GET /tokens` devolve por item. Não é um resumo: o catálogo e o detalhe
// saem da MESMA função no nó (`tokenView`, eav20.js:39 / tokens.rs:119), então a
// lista já traz tudo isto. Este tipo declarava menos campos do que a rota
// entrega, e a tela de tokens passou a buscar o detalhe de cada item para ler
// `decimals` — 61 requisições onde uma bastava.
export interface TokenSummary {
  id: string;
  symbol: string;
  name: string;
  standard: string;
  decimals: number;
  totalSupply: string;
  holders: number;
  creator: string;
  owner: string;
  mintable: boolean;
  paused: boolean;
  createdAt: number;
}

// `GET /tokens/:id` — o mesmo `tokenView`, mais os mapas administrativos e o
// `balanceOf` opcional de `?address=`.
export interface TokenDetail extends TokenSummary {
  /** Endereços impedidos de transacionar pelo administrador. */
  blacklist?: Record<string, boolean>;
  /** Saldo travado até `unlockAt` — não transferível mesmo pertencendo ao dono. */
  frozen?: Record<string, { amount: string; unlockAt: number }>;
}

// Contrato EAVM verificado. A verificação compara o bytecode enviado com o código
// de runtime on-chain; só bate se for o mesmo código. Fica no nó, não na cadeia.
export interface VerifiedContract {
  verified: boolean;
  address: string;
  language: string;
  compiler: string;
  source: string;
  codeHash: string;
  verifiedAt: number;
}

export interface TokenHolder {
  rank: number;
  address: string;
  balance: string;
  /** Participação em pontos-base (10000 = 100%) — inteiro, calculado no nó sem float. */
  shareBps: number;
  frozen: string;
  blacklisted: boolean;
}

export interface TokenHolders {
  token: string;
  decimals: number;
  totalSupply: string;
  holders: number;
  list: TokenHolder[];
}

export const getStatus = () =>
  USE_MOCK ? Promise.resolve(mock.mockStatus()) : get<Status>("/status");

/** `from` = altura inicial (API devolve faixa ascendente). Sem `from` = tip, mais novos primeiro. */
export const getBlocks = (limit = 12, from?: number) =>
  USE_MOCK
    ? Promise.resolve(mock.mockBlocks(limit, from))
    : get<Block[]>(
        `/blocks?limit=${limit}${from != null ? `&from=${from}` : ""}`,
      );

export const getTxs = (limit = 12, before?: number) =>
  USE_MOCK
    ? Promise.resolve(mock.mockTxs(limit, before))
    : get<TxPage>(`/txs?limit=${limit}${before != null ? `&before=${before}` : ""}`);

export const getValidators = () =>
  USE_MOCK ? Promise.resolve(mock.mockValidators()) : get<Validators>("/validators");

export const getBlock = (ref: string | number) =>
  USE_MOCK ? Promise.resolve(mock.mockBlockDetail(ref)) : get<BlockDetail>(`/blocks/${ref}`);

export const getTx = (id: string) =>
  USE_MOCK ? Promise.resolve(mock.mockTxDetail(id)) : get<TxDetail>(`/tx/${id}`);

export const getAddress = (id: string) =>
  USE_MOCK ? Promise.resolve(mock.mockAddress(id)) : get<AddressInfo>(`/address/${id}`);

export const getAddressTxs = (id: string, limit = 50) =>
  USE_MOCK
    ? Promise.resolve(mock.mockAddressTxs(id, limit))
    : get<{ txs: Tx[] }>(`/address/${id}/txs?limit=${limit}`);

export const getTokens = () =>
  USE_MOCK ? Promise.resolve(mock.mockTokens()) : get<TokenSummary[]>("/tokens");

// Detalhe de um token. 404 → null, para a página decidir entre notFound() e erro.
export const getToken = (id: string): Promise<TokenDetail | null> =>
  USE_MOCK
    ? Promise.resolve(mock.mockToken(id))
    : get<TokenDetail>(`/tokens/${id}`).catch(() => null);

export const getTokenHolders = (id: string, limit = 100): Promise<TokenHolders | null> =>
  USE_MOCK
    ? Promise.resolve(mock.mockTokenHolders(id, limit))
    : get<TokenHolders>(`/tokens/${id}/holders?limit=${limit}`).catch(() => null);

// Código verificado de um contrato EAVM. 404 = não verificado → null.
export const getContract = (addr: string): Promise<VerifiedContract | null> =>
  USE_MOCK
    ? Promise.resolve(null)
    : get<VerifiedContract>(`/contract/${addr}`).catch(() => null);

// Transferências do token. Nunca rejeita: a aba renderiza vazia em vez de derrubar a página.
export const getTokenTransfers = (id: string, limit = 50): Promise<{ txs: Tx[] }> =>
  USE_MOCK
    ? Promise.resolve(mock.mockTokenTransfers(id, limit))
    : get<{ txs: Tx[] }>(`/tokens/${id}/transfers?limit=${limit}`).catch(() => ({ txs: [] }));

// --- funções L1 novas: EAV-NS, prova de conta, logs EAVM ---

export interface NameRecord {
  name: string;
  target: string;
  owner: string;
}
// EAV-NS: resolve um nome legível → endereço E7 (404 → null).
export const getName = (name: string) =>
  USE_MOCK
    ? Promise.resolve<NameRecord | null>(null)
    : get<NameRecord>(`/name/${encodeURIComponent(name)}`).catch(() => null);

export interface AccountProof {
  address: string;
  height: number;
  stateRoot: string;
  encodedAccount: string;
  path: string[];
}
// Prova de conta (Merkle) contra o stateRoot do head — light clients (#1).
export const getProof = (address: string) =>
  USE_MOCK
    ? Promise.resolve<AccountProof | null>(null)
    : get<AccountProof>(`/proof/${address}`).catch(() => null);

export interface LogEntry {
  address: string;
  topics: string[];
  data?: string;
  blockHeight: number;
  txId?: string;
}
// Eventos/logs do EAVM (ring buffer node-local), mais novos primeiro (#33).
export const getLogs = (params: { address?: string; topic?: string; limit?: number } = {}) => {
  if (USE_MOCK) return Promise.resolve<{ logs: LogEntry[] }>({ logs: [] });
  const q = new URLSearchParams();
  if (params.address) q.set("address", params.address);
  if (params.topic) q.set("topic", params.topic);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return get<{ logs: LogEntry[] }>(`/logs${qs ? `?${qs}` : ""}`);
};

// --- Fase 2.3: transferências internas (valor movido pela execução de contrato) ---
export interface InternalTransfer {
  txId: string;
  kind: "call" | "create";
  from: string; // endereço do mundo 0x
  to: string;
  fromE7: string; // conta nativa correspondente (ledger unificado)
  toE7: string;
  amount: string;
  blockHeight: number;
  blockTime?: number;
}
// Índice node-local, derivável e fora do consenso — como /logs.
export const getInternal = (params: { address?: string; limit?: number } = {}) => {
  if (USE_MOCK) return Promise.resolve<{ internal: InternalTransfer[] }>({ internal: [] });
  const q = new URLSearchParams();
  if (params.address) q.set("address", params.address);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return get<{ internal: InternalTransfer[] }>(`/internal${qs ? `?${qs}` : ""}`).catch(
    () => ({ internal: [] as InternalTransfer[] }),
  );
};

export interface AddressAnalysis {
  address: string;
  txCount: number;
  truncated: boolean;
  firstSeen: number | null;
  lastSeen: number | null;
  sent: string;
  received: string;
  feesPaid: string;
  byType: Record<string, number>;
  topCounterparties: { address: string; count: number }[];
  daily: { date: string; count: number }[];
}
export const getAddressAnalysis = (id: string) =>
  USE_MOCK
    ? Promise.resolve<AddressAnalysis | null>(null)
    : get<AddressAnalysis>(`/address/${id}/analysis`).catch(() => null);

// --- NFTs EAV721 ---
export interface NftCollectionSummary {
  id: string;
  name: string;
  symbol: string;
  owner: string;
  supply: number;
  nextId: number | string;
}
export interface NftToken {
  tokenId: string;
  owner: string;
  uri?: string;
}
export interface NftCollectionDetail extends NftCollectionSummary {
  tokens: NftToken[];
}
export const getNfts = () =>
  USE_MOCK ? Promise.resolve(mock.mockNfts()) : get<NftCollectionSummary[]>("/nfts");
export const getNftCollection = (id: string) =>
  USE_MOCK
    ? Promise.resolve(mock.mockNftCollection(id))
    : get<NftCollectionDetail>(`/nfts/${id}`).catch(() => null);

// --- serviço de nomes EAV-NS ---
export interface NameEntry {
  name: string;
  target: string;
  owner: string;
  registeredAt?: number;
}
export const getNames = () =>
  USE_MOCK ? Promise.resolve(mock.mockNames()) : get<NameEntry[]>("/names");

// --- governança on-chain (#9) ---
export interface GovProposal {
  id: string;
  param: string;
  value: unknown;
  proposer: string;
  status: string;
  deadline: number;
  voteCount: number;
  createdAt?: number;
  appliesAt?: number;
}
export interface Governable {
  param: string;
  kind: string;
  value: unknown;
  min: unknown;
  max: unknown;
  overridden: boolean;
}
export interface GovernanceState {
  params: Record<string, unknown>;
  governable?: Governable[];
  proposals: GovProposal[];
  validators: number;
  quorum?: number;
  governanceActive?: boolean;
}
export const getGovernance = () =>
  USE_MOCK ? Promise.resolve(mock.mockGovernance()) : get<GovernanceState>("/governance");

// --- tesouraria ---
export interface Treasury {
  balance: string;
  treasuryPct: number;
}
export const getTreasury = () =>
  USE_MOCK ? Promise.resolve(mock.mockTreasury()) : get<Treasury>("/treasury");

// --- camada de IA: sentinela (reports), tarefas e oráculos ---
export interface SecurityAlert {
  at: number;
  source?: string;
  kind: string;
  severity: "info" | "warning" | "critical" | string;
  message: string;
  context?: Record<string, unknown>;
}
export const getSecurityAlerts = () =>
  USE_MOCK ? Promise.resolve(mock.mockSecurityAlerts()) : get<SecurityAlert[]>("/security/alerts");

export interface AiTask {
  id: string;
  status: string; // PENDING | BIDDING | CHALLENGE_PERIOD | DISPUTED | DONE | REFUNDED
  requester?: string;
  oracle?: string;
  reward?: string;
  prompt?: string;
  resultHash?: string; // Fase 5: compromisso do resultado (output off-chain)
  resultUri?: string; // Fase 5: ponteiro opcional (ex.: ipfs://)
  verified?: "TEE" | "ZK"; // Fase 6: resultado atestado (liquida na hora)
  createdAt?: number;
}
export const getAiTasks = () =>
  USE_MOCK ? Promise.resolve<AiTask[]>(mock.mockAiTasks()) : get<AiTask[]>("/ai/tasks");

export interface AiOracle {
  address: string;
  stake?: string;
  reputation?: number; // 0..100 (evolui a cada tarefa — Fase 1)
  completed?: number;
  registeredAt?: number;
}
export const getAiOracles = () =>
  USE_MOCK ? Promise.resolve<AiOracle[]>(mock.mockAiOracles()) : get<AiOracle[]>("/ai/oracles");

// Conselheiro de governança: rascunhos de GOV_PROPOSE que a IA redige (propose-only).
export interface GovernanceAdvisory {
  kind: string;
  param: string;
  currentValue: string | number;
  suggestedValue: string | number;
  severity: "info" | "warning";
  reason: string;
  autonomous: false;
}
export const getGovernanceAdvisories = () =>
  USE_MOCK
    ? Promise.resolve<{ advisories: GovernanceAdvisory[]; count: number }>({ advisories: [], count: 0 })
    : get<{ advisories: GovernanceAdvisory[]; count: number }>("/governance/advisories");

// --- faucet (somente testnet) ---
// Disponível só quando a build é de testnet; a URL do faucet é um subdomínio próprio.
export const FAUCET_URL =
  process.env.NEXT_PUBLIC_NETWORK === "testnet" ? "https://faucet-testnet.eavscan.com" : null;

export async function requestFaucet(address: string): Promise<{ ok: boolean; amount?: string; id?: string }> {
  if (!FAUCET_URL) throw new Error("faucet indisponível nesta rede");
  const res = await fetch(`${FAUCET_URL}/faucet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; amount?: string; id?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? "faucet falhou");
  return { ok: true, amount: body.amount, id: body.id };
}

export interface NetworkStats {
  accounts: number;
  accountsDelta: number;
  transactions: number;
  transactionsDelta: number;
  // Montantes em e7 CRU, string decimal — a mesma regra do resto da API. Antes
  // vinham já divididos por UNIT: `fmtCompact` dividia de novo e 7.900 EAV7
  // aparecia como 0,0079 na tela. Formate com `fmt`/`fmtCompact`, nunca com
  // `num`/`numCompact` (esses são para CONTAGENS, não para montantes).
  volume: string;
  volumeDelta: string;
  staked: string;
  stakedDelta: string;
  tps: number; // medido no nó sobre o intervalo real dos blocos varridos
  txSeries?: number[]; // série horária real (24 baldes) de nº de transações (24h)
  volSeries?: string[]; // série horária real de volume, em e7 (24h)
}

export const getNetworkStats = () =>
  USE_MOCK ? Promise.resolve(mock.mockNetworkStats()) : get<NetworkStats>("/stats");

export interface EavmTxResult {
  accepted?: boolean;
  id?: string;
  error?: string;
  reason?: string;
}

export async function postEavmTx(raw: string): Promise<EavmTxResult> {
  if (USE_MOCK) {
    // simula latência de rede + confirmação
    await new Promise((r) => setTimeout(r, 600));
    return mock.mockPostEavmTx(raw);
  }
  const res = await fetch(resolveBase() + "/eavm/tx", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const body = (await res.json()) as EavmTxResult;
  if (!res.ok || body.accepted === false) {
    throw new Error(body.error ?? body.reason ?? "transação recusada");
  }
  return body;
}
