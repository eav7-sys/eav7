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

// Tipos que viajam pelo esquema EAVM e portanto têm hash EVM própria.
const EAVM_TYPES = new Set(['EAVM_TRANSFER', 'EAVM_DEPLOY', 'EAVM_CALL']);
const isEavmTx = (tx) => EAVM_TYPES.has(tx?.type) && typeof tx?.data?.eavmHash === 'string';

// Normaliza um topic/endereço vindo do filtro: comparação é sempre em minúscula.
const lc = (v) => (typeof v === 'string' ? v.toLowerCase() : v);

// Casamento de tópicos no padrão do Ethereum: posicional, `null` casa qualquer
// coisa, e um ARRAY na posição é OU entre as alternativas. Filtro mais curto que
// os tópicos do log ainda casa — só as posições informadas são exigidas.
function topicsMatch(logTopics, filter) {
  if (!Array.isArray(filter) || filter.length === 0) return true;
  if (filter.length > logTopics.length) return false;
  for (let i = 0; i < filter.length; i++) {
    const want = filter[i];
    if (want == null) continue;
    const have = lc(logTopics[i]);
    if (Array.isArray(want)) {
      if (!want.some((w) => lc(w) === have)) return false;
    } else if (lc(want) !== have) return false;
  }
  return true;
}

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
        // Toda tx do esquema EAVM tem hash EVM, não só a transferência: deploy e
        // chamada de contrato também precisam ser encontráveis por hash, senão a
        // ferramenta que acabou de enviar a tx nunca acha o recibo dela.
        if (isEavmTx(tx)) eavmIndex.set(tx.data.eavmHash, tx.id);
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
      to: tx.data.eavmTo ?? null, // deploy não tem destino
      value: toHex(BigInt(tx.amount) * CHAIN.EAVM_WEI_PER_E7),
      nonce: toHex(BigInt(tx.data.eavmNonce)),
      gas: '0x5208',
      gasPrice: toHex(GAS_PRICE),
      // Calldata real: bytecode no deploy, input na chamada, vazio na transferência.
      input: tx.data.code ?? tx.data.input ?? '0x',
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
    const eavmTxs = block.transactions.filter(isEavmTx);
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

  // Logs de um bloco no formato do Ethereum. `logIndex` é POSICIONAL dentro do
  // bloco (não global), como manda o padrão — por isso é numerado aqui, sobre a
  // ordem em que o índice recebeu os eventos daquele bloco.
  function blockLogObjects(height) {
    const bc = node.blockchain;
    const block = bc.getBlock(height);
    const out = [];
    let i = 0;
    for (const lg of bc.logIndex) {
      if (lg.blockHeight !== height) continue;
      const found = bc.getTransaction(lg.txId);
      const tx = found?.tx;
      out.push({
        address: String(lg.address).toLowerCase(),
        topics: (lg.topics ?? []).map((t) => String(t).toLowerCase()),
        data: lg.data ?? '0x',
        blockNumber: toHex(BigInt(height)),
        blockHash: block ? '0x' + block.hash.toLowerCase() : null,
        transactionHash: tx?.data?.eavmHash ?? null,
        transactionIndex: '0x0',
        logIndex: toHex(BigInt(i++)),
        removed: false, // sem logs de cadeia reorganizada: o índice é reconstruído no reorg
      });
    }
    return out;
  }

  function findEavmTx(eavmHash) {
    ensureIndexed();
    const txId = eavmIndex.get(eavmHash);
    if (txId) {
      const found = node.blockchain.getTransaction(txId);
      if (found) return { tx: found.tx, block: node.blockchain.getBlock(found.blockHeight) };
    }
    const pending = node.mempool.all().find((tx) => isEavmTx(tx) && tx.data.eavmHash === eavmHash);
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
      // Executa de verdade contra o estado atual e desfaz tudo (State.callEavm).
      // Antes devolvia '0x' constante — nenhuma biblioteca conseguia ler contrato.
      case 'eth_call': {
        const [call] = params;
        const out = blockchain.state.callEavm({
          from: call?.from, to: call?.to, data: call?.data ?? call?.input ?? '0x',
          value: call?.value ? BigInt(call.value) : 0n,
          height: blockchain.height, blockTs: blockchain.head?.timestamp ?? 0,
        });
        // Revert devolve o motivo no returnData; propagar como erro é o que faz
        // ethers.js conseguir decodificar a razão em vez de ver sucesso vazio.
        if (!out.success) throw rpcError('execução revertida', -32000, out.returnData);
        return out.returnData;
      }

      case 'eth_estimateGas': {
        const [call] = params;
        if (!call?.to) return toHex(BigInt(CHAIN.ENERGY.COST.EAVM_DEPLOY * CHAIN.GAS_PER_ENERGY));
        const out = blockchain.state.callEavm({
          from: call?.from, to: call.to, data: call?.data ?? call?.input ?? '0x',
          value: call?.value ? BigInt(call.value) : 0n,
          height: blockchain.height, blockTs: blockchain.head?.timestamp ?? 0,
        });
        if (!out.success) throw rpcError('execução revertida', -32000, out.returnData);
        // Margem de 25%: o custo real depende do estado no momento da inclusão
        // (slot que vira não-zero, ramo diferente) e subestimar reverte a tx.
        return toHex(BigInt(Math.ceil(out.gasUsed * 1.25) + 21000));
      }

      case 'eth_getCode': {
        const [address] = params;
        if (!isEavmAddress(address)) throw rpcError('endereço inválido');
        return blockchain.state.codeOf(address);
      }

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
        // Recibo REAL. Antes devolvia gasUsed fixo e status sempre 1 — uma chamada
        // revertida aparecia como sucesso, que é o pior tipo de mentira num recibo.
        // Tx sem recibo registrado é transferência simples: sucesso, custo de 21000.
        const rc = blockchain.receipts.get(found.tx.id) ?? null;
        const gas = rc?.gasUsed != null ? BigInt(rc.gasUsed) : 21000n;
        const ok = rc ? rc.success !== false : true;
        const logs = ok ? blockLogObjects(found.block.height).filter((l) => l.transactionHash === found.tx.data.eavmHash) : [];
        return {
          transactionHash: found.tx.data.eavmHash,
          transactionIndex: '0x0',
          blockHash: '0x' + found.block.hash.toLowerCase(),
          blockNumber: toHex(BigInt(found.block.height)),
          from: found.tx.data.eavmFrom,
          to: found.tx.data.eavmTo ?? null,
          gasUsed: toHex(gas),
          cumulativeGasUsed: toHex(gas),
          effectiveGasPrice: toHex(GAS_PRICE),
          contractAddress: rc?.contract ?? null,
          logs,
          logsBloom: ZERO_BLOOM,
          status: ok ? '0x1' : '0x0',
          type: '0x0',
        };
      }

      // Consulta de eventos — o método que faltava para existir indexador, subgraph
      // ou histórico de transferência de token. Serve do índice node-local de logs.
      case 'eth_getLogs': {
        const f = params[0] ?? {};
        const head = blockchain.height;
        const tag = (v, fallback) => {
          if (v == null || v === 'latest' || v === 'pending' || v === 'safe' || v === 'finalized') return fallback;
          if (v === 'earliest') return 0;
          try { return Number(BigInt(v)); } catch { return fallback; }
        };
        let from = tag(f.fromBlock, head);
        let to = tag(f.toBlock, head);
        if (f.blockHash) {
          const b = blockchain.getBlock(String(f.blockHash).replace(/^0x/, ''));
          if (!b) throw rpcError('bloco não encontrado');
          from = to = b.height;
        }
        if (from > to) throw rpcError('fromBlock maior que toBlock');
        // Teto de faixa: sem ele, uma consulta de 0 até o topo varre a cadeia inteira
        // a cada chamada — o vetor de DoS clássico de eth_getLogs.
        if (to - from > CHAIN.MAX_LOG_RANGE) {
          throw rpcError(`faixa de blocos acima do máximo (${CHAIN.MAX_LOG_RANGE})`);
        }
        const wantAddr = f.address == null ? null
          : new Set((Array.isArray(f.address) ? f.address : [f.address]).map((a) => lc(String(a))));
        const out = [];
        for (let h = from; h <= to; h++) {
          for (const lg of blockLogObjects(h)) {
            if (wantAddr && !wantAddr.has(lg.address)) continue;
            if (!topicsMatch(lg.topics, f.topics)) continue;
            out.push(lg);
            if (out.length >= CHAIN.MAX_LOG_RESULTS) return out;
          }
        }
        return out;
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

  function rpcError(message, code = -32000, data = undefined) {
    const err = new Error(message);
    err.rpcCode = code;
    // `data` carrega o returnData de um revert — é dele que ethers.js decodifica
    // a razão do erro (Error(string) / erro customizado do contrato).
    if (data !== undefined) err.rpcData = data;
    return err;
  }

  async function handleOne(request) {
    const id = request?.id ?? null;
    try {
      if (!request || typeof request.method !== 'string') throw rpcError('requisição inválida', -32600);
      const result = await call(request.method, request.params);
      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return { jsonrpc: '2.0', id, error: { code: err.rpcCode ?? -32000, message: err.message, ...(err.rpcData !== undefined ? { data: err.rpcData } : {}) } };
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
