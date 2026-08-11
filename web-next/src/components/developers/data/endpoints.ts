// Superfície HTTP pública do nó (docs/api.md). `key` aponta para a descrição
// traduzida em `dev.api.ep.*` — o caminho e o método NÃO são traduzíveis.

export interface Endpoint {
  method: "GET" | "POST";
  path: string;
  key: string;
}

export interface EndpointGroup {
  /** chave do título do grupo em `dev.api.group.*` */
  key: string;
  items: Endpoint[];
}

export const API_READ: EndpointGroup[] = [
  {
    key: "chain",
    items: [
      { method: "GET", path: "/status", key: "status" },
      { method: "GET", path: "/blocks/latest", key: "blocksLatest" },
      { method: "GET", path: "/blocks?limit&from", key: "blocks" },
      { method: "GET", path: "/blocks/:ref", key: "blockByRef" },
      { method: "GET", path: "/chain?from&limit", key: "chain" },
      { method: "GET", path: "/mempool", key: "mempool" },
      { method: "GET", path: "/stats", key: "stats" },
    ],
  },
  {
    key: "accounts",
    items: [
      { method: "GET", path: "/address/:end", key: "address" },
      { method: "GET", path: "/address/:end/txs?limit&before", key: "addressTxs" },
      { method: "GET", path: "/address/:end/analysis", key: "addressAnalysis" },
      { method: "GET", path: "/proof/:end", key: "proof" },
      { method: "GET", path: "/internal?address&from&limit", key: "internal" },
    ],
  },
  {
    key: "txs",
    items: [
      { method: "GET", path: "/txs?limit", key: "txs" },
      { method: "GET", path: "/tx/:id", key: "tx" },
      { method: "GET", path: "/logs", key: "logs" },
      { method: "GET", path: "/search?q=", key: "search" },
    ],
  },
  {
    key: "assets",
    items: [
      { method: "GET", path: "/tokens", key: "tokens" },
      { method: "GET", path: "/tokens/:id", key: "token" },
      { method: "GET", path: "/tokens/:id/holders", key: "tokenHolders" },
      { method: "GET", path: "/tokens/:id/transfers?limit&before", key: "tokenTransfers" },
      { method: "GET", path: "/nfts", key: "nfts" },
      { method: "GET", path: "/nfts/:id", key: "nft" },
      { method: "GET", path: "/names", key: "names" },
      { method: "GET", path: "/name/:nome", key: "name" },
    ],
  },
  {
    key: "network",
    items: [
      { method: "GET", path: "/validators", key: "validators" },
      { method: "GET", path: "/governance", key: "governance" },
      { method: "GET", path: "/governance/proposals", key: "governanceProposals" },
      { method: "GET", path: "/treasury", key: "treasury" },
      { method: "GET", path: "/contract/:addr", key: "contract" },
      { method: "GET", path: "/bridge/transfers", key: "bridgeTransfers" },
      { method: "GET", path: "/bridge/transfers/:id", key: "bridgeTransfer" },
      { method: "GET", path: "/ai/tasks", key: "aiTasks" },
      { method: "GET", path: "/ai/oracles", key: "aiOracles" },
      { method: "GET", path: "/gateway", key: "gateway" },
      { method: "GET", path: "/guard", key: "guard" },
    ],
  },
];

export const API_WRITE: Endpoint[] = [
  { method: "POST", path: "/tx", key: "postTx" },
  { method: "POST", path: "/eavm/tx", key: "postEavmTx" },
  { method: "POST", path: "/contract/:addr/verify", key: "postVerify" },
  { method: "POST", path: "/blocks", key: "postBlock" },
];

export const API_ADMIN: Endpoint[] = [
  { method: "GET", path: "/peers", key: "peers" },
  { method: "GET", path: "/security/alerts", key: "securityAlerts" },
];
