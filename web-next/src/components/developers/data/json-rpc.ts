// Métodos JSON-RPC atendidos por rust/node/src/eavm_rpc.rs. Qualquer método fora
// desta lista responde -32601. `params` e `returns` não são traduzíveis — são a
// assinatura; a descrição vem de `dev.jsonrpc.m.*`.

export interface RpcMethod {
  name: string;
  params: string;
  returns: string;
}

export interface RpcGroup {
  /** chave do título em `dev.jsonrpc.group.*` */
  key: string;
  methods: RpcMethod[];
}

export const RPC_METHODS: RpcGroup[] = [
  {
    key: "node",
    methods: [
      { name: "web3_clientVersion", params: "[]", returns: "string" },
      { name: "net_version", params: "[]", returns: "string · \"72020\"" },
      { name: "net_listening", params: "[]", returns: "bool" },
      { name: "eth_chainId", params: "[]", returns: "hex · 0x11954" },
      { name: "eth_syncing", params: "[]", returns: "false" },
      { name: "eth_accounts", params: "[]", returns: "[]" },
    ],
  },
  {
    key: "state",
    methods: [
      { name: "eth_blockNumber", params: "[]", returns: "hex" },
      { name: "eth_getBalance", params: "[address, block?]", returns: "hex · wei" },
      { name: "eth_getCode", params: "[address, block?]", returns: "hex" },
      { name: "eth_getTransactionCount", params: "[address, block?]", returns: "hex" },
    ],
  },
  {
    key: "fees",
    methods: [
      { name: "eth_gasPrice", params: "[]", returns: "hex · 0x1b1ae4d6e2ef4" },
      { name: "eth_maxPriorityFeePerGas", params: "[]", returns: "0x0" },
      { name: "eth_feeHistory", params: "[count, block, reward?]", returns: "object" },
      { name: "eth_estimateGas", params: "[callObject]", returns: "hex" },
    ],
  },
  {
    key: "blocks",
    methods: [
      { name: "eth_getBlockByNumber", params: "[block, fullTxs]", returns: "object | null" },
      { name: "eth_getBlockByHash", params: "[hash, fullTxs]", returns: "object | null" },
      { name: "eth_getTransactionByHash", params: "[hash]", returns: "object | null" },
      { name: "eth_getTransactionReceipt", params: "[hash]", returns: "object | null" },
      { name: "eth_getLogs", params: "[filter]", returns: "array" },
    ],
  },
  {
    key: "exec",
    methods: [
      { name: "eth_call", params: "[callObject, block?]", returns: "hex" },
      { name: "eth_sendRawTransaction", params: "[rawTx]", returns: "hex · txHash" },
    ],
  },
];

/** Erros que o despachante emite, com o código do padrão JSON-RPC. */
export const RPC_ERRORS: { code: string; key: string }[] = [
  { code: "-32600", key: "invalidRequest" },
  { code: "-32601", key: "methodNotFound" },
  { code: "-32602", key: "invalidParams" },
  { code: "-32603", key: "internal" },
  { code: "-32700", key: "parse" },
  { code: "-32000", key: "generic" },
];

/** Métodos que a superfície NÃO atende — pedir por eles devolve -32601. */
export const RPC_MISSING: string[] = [
  "eth_sendTransaction",
  "eth_sign",
  "eth_signTransaction",
  "eth_getStorageAt",
  "eth_subscribe",
  "eth_unsubscribe",
  "eth_newFilter",
  "eth_getFilterChanges",
];
