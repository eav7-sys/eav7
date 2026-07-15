// Servidor RPC do protocolo EAVM — o endpoint que você adiciona na MetaMask ou
// na Trust Wallet como "rede customizada" (Chain ID 72020).
//
// Implementação 100% própria (nenhuma dependência, nenhum código da Ethereum).
// Os NOMES dos métodos ("eth_*") são apenas o dialeto de comunicação que essas
// carteiras falam — sem responder nesse dialeto, nenhuma carteira universal
// conseguiria conectar (é por isso que a Tron, com a TVM própria mas sem esse
// dialeto, não funciona na MetaMask).
import { createServer } from 'node:http';
import { CHAIN } from '../config.js';
import { buildEavmEnvelope, eavmToE7, isEavmAddress } from './envelope.js';
import { createRateLimiter } from '../node/ratelimit.js';

const rateLimit = createRateLimiter();

// 21000 gas * GAS_PRICE ≈ taxa de protocolo (0,01 EAV7) exibida pela carteira
const GAS_PRICE = (CHAIN.FEES.EAVM_TRANSFER * CHAIN.EAVM_WEI_PER_E7) / 21000n;
const ZERO_BLOOM = '0x' + '0'.repeat(512);

const toHex = (value) => '0x' + BigInt(value).toString(16);

export function createEavmRpcServer(node) {
  const eavmIndex = new Map(); // hash EAVM -> id da transação eav20
  let indexedHeight = -1;

  function ensureIndexed() {
    const bc = node.blockchain;
    if (indexedHeight > bc.height) indexedHeight = -1; // reorg: reindexa
    if (indexedHeight >= bc.height) return;
    // Visita só os blocos que TÊM transações (índice global) — sem varrer a cadeia.
    for (const h of bc.blocksWithTxs) {
      if (h <= indexedHeight) continue;
      const block = bc.getBlock(h);
      for (const tx of block?.transactions ?? []) {
        if (tx.type === 'EAVM_TRANSFER') eavmIndex.set(tx.data.eavmHash, tx.id);
      }
    }
    indexedHeight = bc.height;
  }

  function blockByTag(tag) {
    const { blockchain } = node;
    if (tag === 'latest' || tag === 'pending' || tag === 'safe' || tag === 'finalized' || tag === undefined) {
      return blockchain.head;
    }
    if (tag === 'earliest') return blockchain.getBlock(0);
    return blockchain.getBlock(Number(BigInt(tag)));
  }

  function eavmTxObject(tx, block) {
    return {
      hash: tx.data.eavmHash,
      from: tx.data.eavmFrom,
      to: tx.data.eavmTo,
      value: toHex(BigInt(tx.amount) * CHAIN.EAVM_WEI_PER_E7),
      nonce: toHex(BigInt(tx.data.eavmNonce)),
      gas: '0x5208',
      gasPrice: toHex(GAS_PRICE),
      input: '0x',
      blockHash: block ? '0x' + block.hash.toLowerCase() : null,
      blockNumber: block ? toHex(BigInt(block.height)) : null,
      transactionIndex: block ? '0x0' : null,
      type: '0x0',
      chainId: toHex(BigInt(CHAIN.EAVM_CHAIN_ID)),
      v: '0x0', r: '0x0', s: '0x0',
    };
  }

  function eavmBlock(block, includeTxs) {
    if (!block) return null;
    const eavmTxs = block.transactions.filter((tx) => tx.type === 'EAVM_TRANSFER');
    return {
      number: toHex(BigInt(block.height)),
      hash: '0x' + block.hash.toLowerCase(),
      parentHash: '0x' + block.previousHash.toLowerCase(),
      timestamp: toHex(BigInt(Math.floor(block.timestamp / 1000))),
      miner: '0x' + '0'.repeat(40),
      gasLimit: toHex(30_000_000n),
      gasUsed: toHex(BigInt(eavmTxs.length) * 21000n),
      baseFeePerGas: toHex(GAS_PRICE),
      difficulty: '0x0',
      totalDifficulty: '0x0',
      extraData: '0x',
      nonce: '0x0000000000000000',
      logsBloom: ZERO_BLOOM,
      sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347',
      transactionsRoot: '0x' + block.txRoot.toLowerCase(),
      stateRoot: '0x' + '0'.repeat(64),
      receiptsRoot: '0x' + '0'.repeat(64),
      size: '0x400',
      uncles: [],
      transactions: eavmTxs.map((tx) => (includeTxs ? eavmTxObject(tx, block) : tx.data.eavmHash)),
    };
  }

  function findEavmTx(eavmHash) {
    ensureIndexed();
    const txId = eavmIndex.get(eavmHash);
    if (txId) {
      const found = node.blockchain.getTransaction(txId);
      if (found) return { tx: found.tx, block: node.blockchain.blocks[found.blockHeight] };
    }
    const pending = node.mempool.all().find((tx) => tx.type === 'EAVM_TRANSFER' && tx.data.eavmHash === eavmHash);
    return pending ? { tx: pending, block: null } : null;
  }

  async function call(method, params = []) {
    const { blockchain } = node;
    switch (method) {
      case 'web3_clientVersion': return `EAV7/eavm/v${CHAIN.PROTOCOL_VERSION}`;
      case 'eth_chainId': return toHex(BigInt(CHAIN.EAVM_CHAIN_ID));
      case 'net_version': return String(CHAIN.EAVM_CHAIN_ID);
      case 'net_listening': return true;
      case 'eth_syncing': return false;
      case 'eth_accounts': return [];
      case 'eth_blockNumber': return toHex(BigInt(Math.max(blockchain.height, 0)));
      case 'eth_gasPrice': return toHex(GAS_PRICE);
      case 'eth_maxPriorityFeePerGas': return '0x0';
      case 'eth_estimateGas': return '0x5208';
      case 'eth_call': return '0x';
      case 'eth_getCode': return '0x';

      case 'eth_getBalance': {
        const [address] = params;
        if (!isEavmAddress(address)) throw rpcError('endereço inválido');
        const balance = blockchain.state.balanceOf(eavmToE7(address));
        return toHex(balance * CHAIN.EAVM_WEI_PER_E7);
      }

      case 'eth_getTransactionCount': {
        const [address] = params;
        if (!isEavmAddress(address)) throw rpcError('endereço inválido');
        // nonce EAVM esperado = nonce do protocolo (inclui pendentes no mempool)
        return toHex(BigInt(node.nextNonceFor(eavmToE7(address)) - 1));
      }

      case 'eth_feeHistory': {
        let raw = 1;
        try { raw = Number(BigInt(params[0] ?? '0x1')); } catch { raw = 1; }
        const count = Math.max(1, Math.min(32, Number.isFinite(raw) ? Math.floor(raw) : 1));
        const percentiles = Array.isArray(params[2]) ? params[2] : [];
        return {
          oldestBlock: toHex(BigInt(Math.max(blockchain.height - count + 1, 0))),
          baseFeePerGas: Array(count + 1).fill(toHex(GAS_PRICE)),
          gasUsedRatio: Array(count).fill(0.05),
          reward: Array(count).fill(percentiles.map(() => '0x0')),
        };
      }

      case 'eth_sendRawTransaction': {
        const [raw] = params;
        const envelope = buildEavmEnvelope(raw, { state: blockchain.state });
        const result = node.submitTransaction(envelope);
        if (!result.accepted && result.reason !== 'transação já conhecida') {
          throw rpcError(result.reason ?? 'transação rejeitada');
        }
        eavmIndex.set(envelope.data.eavmHash, envelope.id);
        return envelope.data.eavmHash;
      }

      case 'eth_getTransactionReceipt': {
        const found = findEavmTx(params[0]);
        if (!found || !found.block) return null;
        return {
          transactionHash: found.tx.data.eavmHash,
          transactionIndex: '0x0',
          blockHash: '0x' + found.block.hash.toLowerCase(),
          blockNumber: toHex(BigInt(found.block.height)),
          from: found.tx.data.eavmFrom,
          to: found.tx.data.eavmTo,
          gasUsed: '0x5208',
          cumulativeGasUsed: '0x5208',
          effectiveGasPrice: toHex(GAS_PRICE),
          contractAddress: null,
          logs: [],
          logsBloom: ZERO_BLOOM,
          status: '0x1',
          type: '0x0',
        };
      }

      case 'eth_getTransactionByHash': {
        const found = findEavmTx(params[0]);
        return found ? eavmTxObject(found.tx, found.block) : null;
      }

      case 'eth_getBlockByNumber': return eavmBlock(blockByTag(params[0]), params[1] === true);

      case 'eth_getBlockByHash': {
        const hash = String(params[0] ?? '').slice(2).toUpperCase();
        return eavmBlock(blockchain.getBlock(hash), params[1] === true);
      }

      default:
        throw rpcError(`método não suportado: ${method}`, -32601);
    }
  }

  function rpcError(message, code = -32000) {
    const err = new Error(message);
    err.rpcCode = code;
    return err;
  }

  async function handleOne(request) {
    const id = request?.id ?? null;
    try {
      if (!request || typeof request.method !== 'string') throw rpcError('requisição inválida', -32600);
      const result = await call(request.method, request.params);
      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return { jsonrpc: '2.0', id, error: { code: err.rpcCode ?? -32000, message: err.message } };
    }
  }

  return createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!rateLimit(req)) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '10' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'rate limit' } }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        chain: CHAIN.NAME,
        protocolo: 'EAVM (protocolo próprio da EAV7)',
        chainId: CHAIN.EAVM_CHAIN_ID,
        currency: { symbol: CHAIN.SYMBOL, decimals: 18 },
        dica: 'adicione esta URL como RPC de rede customizada na MetaMask ou Trust Wallet',
      }));
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) throw new Error('corpo excede 1 MB');
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (Array.isArray(body) && body.length > CHAIN.MAX_RPC_BATCH) {
        throw new Error(`lote JSON-RPC excede ${CHAIN.MAX_RPC_BATCH} chamadas`);
      }
      const response = Array.isArray(body)
        ? await Promise.all(body.map(handleOne))
        : await handleOne(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: err.message } }));
    }
  });
}
