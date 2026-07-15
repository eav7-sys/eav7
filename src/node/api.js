import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHAIN, toJson, formatEav7 } from '../config.js';
import { isValidAddress } from '../crypto/keys.js';
import { tokenView, tokenBalanceOf, EAV20_STANDARD } from '../token/eav20.js';
import { eavmToE7, isEavmAddress, buildEavmEnvelope } from '../eavm/envelope.js';
import { createRateLimiter } from './ratelimit.js';
import { accountProof as stateProof } from '../core/stateroot.js';

const rateLimit = createRateLimiter();

const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Caches invalidados por ALTURA de bloco: o estado só muda quando entra um bloco,
// então /stats e /search recomputam no máximo UMA vez por bloco em vez de varrer
// todas as contas a cada request. Sob 240 req/s todas reusam o mesmo resultado —
// fecha o DoS assimético de varredura full-state por request (achado M2).
let statsCache = { height: -1, value: null };
let searchIndexCache = { height: -1, sorted: null };

function computeStats(blockchain, state) {
  if (statsCache.value && statsCache.height === blockchain.height) return statsCache.value;
  const accs = Object.keys(state.accounts);
  let staked = 0n;
  for (const a of accs) staked += (state.accounts[a].staked ?? 0n);
  const value = { accounts: accs.length, staked, transactions: blockchain.txIndex.size };
  statsCache = { height: blockchain.height, value };
  return value;
}

// Índice de busca ordenado por endereço minúsculo (candidatos = contas nativas +
// holders de token). Reconstruído no máximo uma vez por bloco; buscas por prefixo
// usam busca binária (O(log n + k)) e a varredura por substring é limitada.
const SEARCH_SUBSTR_SCAN_CAP = 50_000;
function searchIndex(blockchain, state) {
  if (searchIndexCache.sorted && searchIndexCache.height === blockchain.height) return searchIndexCache.sorted;
  const cand = new Set(Object.keys(state.accounts));
  for (const tok of Object.values(state.tokens)) for (const h of Object.keys(tok.balances ?? {})) cand.add(h);
  const sorted = [...cand].map((a) => [a.toLowerCase(), a]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  searchIndexCache = { height: blockchain.height, sorted };
  return sorted;
}
function lowerBound(sorted, ql) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid][0] < ql) lo = mid + 1; else hi = mid; }
  return lo;
}

// Estáticos servidos do disco com cache por mtime: relê o arquivo só quando ele muda.
// Assim uma atualização de frontend (rsync do public/) é servida SEM reiniciar o nó,
// mantendo o custo de uma stat por requisição (desprezível). `bin=true` para binários.
const P = (rel) => fileURLToPath(new URL('../../public/' + rel, import.meta.url));
const staticCache = new Map();
function staticFile(rel, bin = false) {
  const path = P(rel);
  let mtime = 0;
  try { mtime = statSync(path).mtimeMs; } catch { /* usa cache se existir */ }
  const hit = staticCache.get(rel);
  if (hit && hit.mtime === mtime) return hit.content;
  const content = readFileSync(path, bin ? undefined : 'utf8');
  staticCache.set(rel, { mtime, content });
  return content;
}
const APP_HTML = () => staticFile('app.html');
const EXPLORER_HTML = () => staticFile('explorer.html');
const WALLET_HTML = () => staticFile('wallet.html');
const WALLET_JS = () => staticFile('eav7-wallet.js');
const THEME_CSS = () => staticFile('eav7-theme.css');
const ICON_PNG = () => staticFile('icon.png', true);
const ICON_SVG = () => staticFile('icon.svg');

// ---- SPA React (build Vite em web/dist) — servido do disco com cache por mtime ----
const DIST = (rel) => fileURLToPath(new URL('../../web/dist/' + rel, import.meta.url));
const distCache = new Map();
function distFile(rel, bin = false) {
  const path = DIST(rel);
  const mtime = statSync(path).mtimeMs; // lança se não existir → tratado pelo chamador
  const hit = distCache.get(rel);
  if (hit && hit.mtime === mtime) return hit.content;
  const content = readFileSync(path, bin ? undefined : 'utf8');
  distCache.set(rel, { mtime, content });
  return content;
}
function spaAvailable() { try { statSync(DIST('index.html')); return true; } catch { return false; } }
const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json' };
// rotas do frontend (React Router) — navegação do browser cai no index.html do SPA
const wantsHtml = (req) => (req.headers.accept ?? '').includes('text/html');
function isFrontendRoute(parts) {
  if (parts.length === 0) return true;
  return ['explorer', 'blocks', 'block', 'tx', 'address', 'wallet', 'app', 'scan', 'mining'].includes(parts[0]);
}

// ---- Frontend Next.js (serviço eav7-web em 127.0.0.1:3000) --------------------
// O nó continua na frente do domínio; navegação do browser, payloads RSC e assets
// do app são encaminhados ao Next. A API (accept: application/json), o P2P (sem
// accept text/html) e o RPC seguem sendo servidos pelo próprio nó.
const WEB_HOST = '127.0.0.1';
const WEB_PORT = 3000;
// Prefixos de diretório do app (proxy por startsWith — inclui /_next/image, sem extensão).
const WEB_PREFIXES = ['/_next/', '/bg/', '/brand/'];
const WEB_FILES_RE = /^\/(?:favicon\.ico|icon\.svg|icon\.png|apple-icon|opengraph-image|twitter-image|robots\.txt|sitemap\.xml|manifest|sw\.js)/i;
const WEB_EXT_RE = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|ogg|wasm)$/i;
function isWebRequest(req, pathname) {
  const accept = req.headers.accept ?? '';
  if (accept.includes('text/html') || accept.includes('text/x-component')) return true;
  if ('rsc' in req.headers || 'next-router-prefetch' in req.headers || 'next-router-state-tree' in req.headers) return true;
  if (WEB_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return WEB_FILES_RE.test(pathname) || WEB_EXT_RE.test(pathname);
}
function proxyToWeb(req, res, node) {
  const upstream = httpRequest({ host: WEB_HOST, port: WEB_PORT, method: req.method, path: req.url, headers: req.headers }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (e) => {
    node.log?.(`[web] proxy indisponível: ${e.message}`);
    if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('EAV7 Web temporariamente indisponível'); }
  });
  req.pipe(upstream);
}

export function createApiServer(node) {
  return createServer((req, res) => {
    handle(node, req, res).catch((err) => {
      // Erros esperados (validação) são Error com mensagem limpa e vão ao cliente.
      // Erros inesperados (bugs: TypeError/RangeError/…) NÃO expõem detalhes internos
      // — respondem genérico e são logados no servidor (achado L).
      const expected = err instanceof Error && err.constructor === Error;
      if (!expected) node.log?.(`[api] erro inesperado: ${err?.stack || err}`);
      if (!res.headersSent) send(res, 400, { error: expected ? err.message : 'erro interno ao processar a requisição' });
    });
  });
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(toJson(body));
}

// Parseia um inteiro não-negativo de query string; usa o default se inválido.
function intParam(value, dflt) {
  if (value === null || value === undefined) return dflt;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : dflt;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('corpo da requisição excede 2 MB');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('JSON inválido');
  }
}

async function handle(node, req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!rateLimit(req)) {
    res.writeHead(429, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '10' });
    res.end(JSON.stringify({ error: 'muitas requisições — tente novamente em instantes' }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const { blockchain, mempool } = node;
  const state = blockchain.state;
  const GET = req.method === 'GET';
  const POST = req.method === 'POST';

  // Encaminha ao frontend Next (navegação/RSC/assets). A API e o P2P seguem abaixo.
  if ((GET || req.method === 'HEAD') && isWebRequest(req, url.pathname)) {
    proxyToWeb(req, res, node);
    return;
  }

  // ---- SPA React (web/dist) — legado (fallback quando o Next está fora) -----
  // Assets do build (hash no nome → cache longo).
  if (GET && parts[0] === 'assets') {
    try {
      const rel = 'assets/' + parts.slice(1).join('/').replace(/\.\./g, '');
      const ext = rel.slice(rel.lastIndexOf('.'));
      const bin = ext === '.png' || ext === '.woff2';
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' });
      res.end(distFile(rel, bin));
    } catch { send(res, 404, { error: 'asset não encontrado' }); }
    return;
  }
  // Navegação do browser (Accept text/html) numa rota do frontend → serve o app React.
  // Chamadas fetch da API mandam Accept: application/json e caem nos handlers abaixo.
  if (GET && wantsHtml(req) && isFrontendRoute(parts) && spaAvailable()) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(distFile('index.html'));
    return;
  }

  // ---- informações gerais / plataforma -------------------------------------
  if (GET && parts.length === 0) {
    // Navegador na raiz do domínio (ex.: eavscan.com) abre o explorador; clientes
    // de API (Accept: application/json) recebem o índice de endpoints.
    if ((req.headers.accept ?? '').includes('text/html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(EXPLORER_HTML());
      return;
    }
    send(res, 200, {
      chain: CHAIN.NAME,
      protocol: CHAIN.PROTOCOL,
      version: CHAIN.PROTOCOL_VERSION,
      symbol: CHAIN.SYMBOL,
      decimals: CHAIN.DECIMALS,
      tokenStandard: EAV20_STANDARD.name,
      miningPlatform: '/app',
      endpoints: [
        'GET /status', 'GET /blocks', 'GET /blocks/latest', 'GET /blocks/:alturaOuHash',
        'GET /chain', 'POST /blocks', 'GET /tx/:id', 'POST /tx', 'GET /address/:endereco',
        'GET /mempool', 'GET /validators', 'GET /tokens', 'GET /tokens/:id',
        'GET /ai/tasks', 'GET /ai/tasks/:id', 'GET /ai/oracles',
        'GET /bridge/transfers', 'GET /bridge/transfers/:id',
        'GET /security/alerts', 'POST /security/alerts',
        'GET /peers', 'POST /peers',
      ],
    });
    return;
  }

  if (GET && parts[0] === 'app') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(APP_HTML());
    return;
  }

  // Explorador de blocos (estilo TronScan) — SPA que consome a própria API.
  if (GET && (parts[0] === 'explorer' || parts[0] === 'scan')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(EXPLORER_HTML());
    return;
  }

  // Carteira web própria da EAV7 (self-custodial, assina no navegador).
  if (GET && parts[0] === 'wallet' && parts.length === 1) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(WALLET_HTML());
    return;
  }
  if (GET && parts[0] === 'js' && parts[1] === 'eav7-wallet.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    res.end(WALLET_JS());
    return;
  }
  if (GET && parts[0] === 'css' && parts[1] === 'eav7.css') {
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=3600' });
    res.end(THEME_CSS());
    return;
  }
  // Ícone do EAV7 (para o favicon das páginas e o iconUrls do add-network).
  if (GET && parts[0] === 'icon.png') {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
    res.end(ICON_PNG());
    return;
  }
  if (GET && parts[0] === 'icon.svg') {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
    res.end(ICON_SVG());
    return;
  }

  // Envia uma transação EAVM assinada (raw da carteira web / MetaMask) sem
  // precisar do endpoint JSON-RPC — embrulha em EAVM_TRANSFER e submete.
  if (POST && parts[0] === 'eavm' && parts[1] === 'tx') {
    const { raw } = await readBody(req);
    if (typeof raw !== 'string') return send(res, 400, { error: 'campo raw (0x…) obrigatório' });
    const envelope = buildEavmEnvelope(raw, { state });
    send(res, 200, node.submitTransaction(envelope));
    return;
  }

  if (GET && parts[0] === 'status') {
    const head = blockchain.head;
    send(res, 200, {
      chain: CHAIN.NAME,
      protocol: CHAIN.PROTOCOL,
      symbol: CHAIN.SYMBOL,
      blockTimeMs: CHAIN.BLOCK_TIME_MS,
      height: blockchain.height,
      finalizedHeight: blockchain.finalizedHeight(), // #2: última altura finalizada por BFT (-1 = sem finalidade)
      headHash: head?.hash ?? null,
      headTime: head?.timestamp ?? null,
      supply: CHAIN.GENESIS_SUPPLY + state.totalMinted - state.totalBurned, // supply REAL (gênese + emissão − queima)
      genesisSupply: CHAIN.GENESIS_SUPPLY,
      minted: state.totalMinted,
      burned: state.totalBurned,
      treasury: state.treasury ?? 0n, // cofre governável (evolução)
      circulating: CHAIN.GENESIS_SUPPLY + state.totalMinted - state.totalBurned,
      blockReward: blockchain.blockReward(Math.max(blockchain.height + 1, 0)),
      energy: { free: CHAIN.ENERGY.FREE, perStakedEav7: CHAIN.ENERGY.PER_STAKED_EAV7, regenBlocks: CHAIN.ENERGY.REGEN_BLOCKS },
      mempool: mempool.size,
      validators: state.validators().length,
      peers: node.p2p.list().length,
      producer: node.validatorAddress,
      ai: {
        pendingTasks: state.pendingAiTasks().length,
        oracles: Object.keys(state.oracles).length,
      },
      bridge: {
        transfers: Object.keys(state.bridge.transfers).length,
        lockedNative: state.bridge.lockedNative,
      },
      security: { alerts: node.securityAlerts.length },
      eavm: node.eavmEnabled
        ? { chainId: CHAIN.EAVM_CHAIN_ID, rpcPort: node.eavmPort, decimals: 18, rpcUrl: node.publicRpcUrl }
        : null,
    });
    return;
  }

  // mapeamento de conta EAVM (MetaMask/Trust Wallet) -> endereço E7
  if (GET && parts[0] === 'eavm' && parts[1] === 'address' && parts.length === 3) {
    if (!isEavmAddress(parts[2])) return send(res, 400, { error: 'endereço EAVM inválido (use 0x + 40 hex)' });
    send(res, 200, { eavm: parts[2].toLowerCase(), eav7: eavmToE7(parts[2]) });
    return;
  }

  // ---- blocos e cadeia ------------------------------------------------------
  if (GET && parts[0] === 'blocks' && parts.length === 1) {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 200);
    const fromParam = url.searchParams.get('from');
    if (fromParam !== null) {
      const from = Math.max(Number(fromParam), 0);
      send(res, 200, blockchain.getRange(from, limit));
    } else {
      send(res, 200, blockchain.getRange(Math.max(0, blockchain.height - limit + 1), limit).reverse());
    }
    return;
  }

  if (GET && parts[0] === 'blocks' && parts[1] === 'latest') {
    send(res, 200, blockchain.head);
    return;
  }

  if (GET && parts[0] === 'blocks' && parts.length === 2) {
    const block = blockchain.getBlock(parts[1]);
    if (!block) return send(res, 404, { error: 'bloco não encontrado' });
    send(res, 200, block);
    return;
  }

  // Paginado (from/limit) para não serializar a cadeia inteira por requisição.
  if (GET && parts[0] === 'chain') {
    const from = Math.max(Number(url.searchParams.get('from') ?? 0), 0);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? CHAIN.MAX_CHAIN_PAGE), 1), CHAIN.MAX_CHAIN_PAGE);
    send(res, 200, {
      height: blockchain.height,
      from,
      blocks: blockchain.getRange(from, limit),
    });
    return;
  }

  if (POST && parts[0] === 'blocks') {
    const block = await readBody(req);
    send(res, 200, node.receiveBlock(block));
    return;
  }

  // ---- transações -----------------------------------------------------------
  if (POST && parts[0] === 'tx') {
    const tx = await readBody(req);
    send(res, 200, node.submitTransaction(tx));
    return;
  }

  // #8: verificação de contratos EAVM (metadados, fora do consenso).
  if (POST && parts[0] === 'contract' && parts[2] === 'verify' && parts.length === 3) {
    const body = await readBody(req);
    try {
      send(res, 200, node.verifyContract(parts[1], body));
    } catch (err) {
      send(res, 400, { error: String(err.message || err) });
    }
    return;
  }
  // Prova de estado de uma conta (light client): folha + caminho de Merkle até o
  // stateRoot do header. O cliente verifica com o SDK sem baixar o estado inteiro.
  if (GET && parts[0] === 'proof' && parts.length === 2) {
    let address = parts[1];
    if (isEavmAddress(address)) address = eavmToE7(address);
    else if (!isValidAddress(address)) return send(res, 400, { error: 'endereço inválido' });
    const head = blockchain.head;
    if (!head?.stateRoot) return send(res, 501, { error: 'stateRoot indisponível nesta altura (fork não ativo)' });
    const proof = stateProof(state, address);
    if (!proof) return send(res, 404, { error: 'conta inexistente' });
    send(res, 200, { address, height: blockchain.height, stateRoot: head.stateRoot, encodedAccount: proof.encodedAccount, path: proof.path });
    return;
  }
  // #33: consulta de eventos/logs do EAVM (filtro por address e topic), mais novos primeiro.
  if (GET && parts[0] === 'logs' && parts.length === 1) {
    const addr = url.searchParams.get('address')?.toLowerCase();
    const topic = url.searchParams.get('topic')?.toLowerCase();
    const from = intParam(url.searchParams.get('from'), 0);
    const limit = Math.min(Math.max(intParam(url.searchParams.get('limit'), 100), 1), 1000);
    const out = [];
    for (let i = blockchain.logIndex.length - 1; i >= 0 && out.length < limit; i--) {
      const lg = blockchain.logIndex[i];
      if (lg.blockHeight < from) continue;
      if (addr && String(lg.address).toLowerCase() !== addr) continue;
      if (topic && !(lg.topics ?? []).some((t) => String(t).toLowerCase() === topic)) continue;
      out.push(lg);
    }
    send(res, 200, { logs: out });
    return;
  }

  // EAV-NS: resolve um nome legível para o endereço-alvo.
  if (GET && parts[0] === 'name' && parts.length === 2) {
    const rec = state.names?.[String(parts[1]).toLowerCase()];
    if (!rec) return send(res, 404, { error: 'nome não registrado' });
    send(res, 200, { name: String(parts[1]).toLowerCase(), target: rec.target, owner: rec.owner });
    return;
  }
  if (GET && parts[0] === 'contract' && parts.length === 2) {
    const rec = node.getVerifiedContract(parts[1]);
    if (!rec) return send(res, 404, { verified: false, error: 'contrato não verificado' });
    send(res, 200, { verified: true, ...rec });
    return;
  }

  if (GET && parts[0] === 'tx' && parts.length === 2) {
    const found = blockchain.getTransaction(parts[1]);
    if (found) return send(res, 200, { status: 'CONFIRMED', ...found });
    const pending = mempool.all().find((tx) => tx.id === parts[1]);
    if (pending) return send(res, 200, { status: 'PENDING', tx: pending });
    send(res, 404, { error: 'transação não encontrada' });
    return;
  }

  if (GET && parts[0] === 'mempool') {
    send(res, 200, mempool.all());
    return;
  }

  // Transações recentes de toda a cadeia — varredura server-side (rápida, sem
  // um fetch HTTP por bloco). Pula blocos vazios. Pagina via ?before=altura.
  if (GET && parts[0] === 'txs' && parts.length === 1) {
    const limit = Math.min(Math.max(intParam(url.searchParams.get('limit'), 25), 1), 100);
    const before = intParam(url.searchParams.get('before'), Number.MAX_SAFE_INTEGER);
    // Usa o índice global de blocos-com-tx → sempre carrega as últimas transações
    // REAIS, mesmo que os últimos milhares de blocos estejam vazios (sem varrer a cadeia).
    const bwt = blockchain.blocksWithTxs;
    const txs = [];
    let nextBefore = null;
    for (let i = bwt.length - 1; i >= 0 && txs.length < limit; i--) {
      const h = bwt[i];
      if (h >= before) continue;
      const b = blockchain.getBlock(h);
      if (!b) continue;
      for (let j = b.transactions.length - 1; j >= 0; j--) {
        const t = b.transactions[j];
        txs.push({ ...t, blockHeight: h, blockHash: b.hash, blockTime: b.timestamp });
      }
      if (txs.length >= limit && i > 0) nextBefore = h;
    }
    send(res, 200, { txs, nextBefore, height: blockchain.height });
    return;
  }

  // Busca universal (estilo TronScan): token por nome/símbolo/id, conta, tx, bloco,
  // validador. Tudo por lookup O(1) ou sobre o registro de tokens/validadores (sem
  // varredura de cadeia por tecla) — rápido e seguro para o autocomplete.
  if (GET && parts[0] === 'search' && parts.length === 1) {
    const q = (url.searchParams.get('q') ?? '').trim();
    const results = [];
    const push = (r) => { if (results.length < 25 && !results.some((x) => x.to === r.to)) results.push(r); };
    if (q) {
      const ql = q.toLowerCase();
      if (isValidAddress(q)) { const a = state.accounts[q]; push({ kind: 'Endereço', label: q, to: `/address/${q}`, detail: a ? `${formatEav7(a.balance)} EAV7` : 'conta' }); }
      else if (isEavmAddress(q)) { const a = state.accounts[eavmToE7(q)]; push({ kind: 'MetaMask', label: q, to: `/address/${q}`, detail: a ? `${formatEav7(a.balance)} EAV7` : 'conta EAVM' }); }
      if (/^E7[0-9A-Fa-f]{20,}$/.test(q) && blockchain.getTransaction(q)) push({ kind: 'Transação', label: q, to: `/tx/${q}` });
      if (/^\d+$/.test(q) && Number(q) >= 0 && Number(q) <= blockchain.height) push({ kind: 'Bloco', label: `#${q}`, to: `/block/${q}` });
      for (const [id, tok] of Object.entries(state.tokens)) {
        const sym = String(tok.symbol ?? ''); const nm = String(tok.name ?? '');
        if (sym.toLowerCase().includes(ql) || nm.toLowerCase().includes(ql) || id.toLowerCase().includes(ql)) push({ kind: 'Token', label: `${sym} · ${nm}`, sub: id, to: `/address/${id}` });
      }
      // contas por endereço PARCIAL — candidatos = contas nativas + holders de token
      // (assim uma conta que só tem token, sem EAV7 nativo, também aparece). Índice
      // ordenado cacheado por altura (achado M2): prefixo por busca binária primeiro,
      // depois substring com varredura LIMITADA. Prefixo primeiro; ≥2 chars.
      if (ql.length >= 2) {
        const sorted = searchIndex(blockchain, state);
        const found = []; // [addr, isPrefix]
        const seen = new Set();
        // prefixo (startsWith) via busca binária: faixa contígua no array ordenado
        for (let i = lowerBound(sorted, ql); i < sorted.length && sorted[i][0].startsWith(ql) && found.length < 20; i++) {
          found.push([sorted[i][1], true]); seen.add(sorted[i][1]);
        }
        // substring (não-prefixo) para completar, com teto de varredura anti-DoS
        const scan = Math.min(sorted.length, SEARCH_SUBSTR_SCAN_CAP);
        for (let i = 0; i < scan && found.length < 20; i++) {
          if (!seen.has(sorted[i][1]) && sorted[i][0].includes(ql)) found.push([sorted[i][1], false]);
        }
        for (const [addr] of found.slice(0, 20)) {
          const acc = state.accounts[addr] ?? {};
          const isVal = (acc.staked ?? 0n) >= CHAIN.MIN_VALIDATOR_STAKE;
          push({ kind: isVal ? 'Validador' : 'Conta', label: addr, to: `/address/${addr}`, detail: `${formatEav7(acc.balance ?? 0n)} EAV7` });
        }
      }
    }
    send(res, 200, { query: q, results });
    return;
  }

  // Estatísticas da rede para o novo frontend (cards do explorer).
  if (GET && parts[0] === 'stats' && parts.length === 1) {
    const s = computeStats(blockchain, state);
    send(res, 200, {
      accounts: s.accounts,
      accountsDelta: 0,
      transactions: s.transactions,
      transactionsDelta: 0,
      volume: 0,
      volumeDelta: 0,
      staked: Number(s.staked / CHAIN.UNIT),
      stakedDelta: 0,
    });
    return;
  }

  // ---- contas e validadores ---------------------------------------------------
  if (GET && parts[0] === 'address' && parts.length === 2) {
    // Aceita tanto endereço nativo E7… quanto endereço EAVM 0x… (MetaMask/Trust
    // Wallet): o 0x é convertido para o E7 mapeado correspondente.
    let address = parts[1];
    let eavmAddress = null;
    if (isEavmAddress(address)) {
      eavmAddress = address.toLowerCase();
      address = eavmToE7(address);
    } else if (!isValidAddress(address)) {
      return send(res, 400, { error: 'endereço EAV7 (E7…) ou EAVM (0x…) inválido' });
    }
    const acc = state.accounts[address];
    const balance = acc?.balance ?? 0n;
    const staked = acc?.staked ?? 0n;
    send(res, 200, {
      address,
      eavmAddress, // endereço 0x da MetaMask, quando a consulta veio de um 0x
      balance,
      balanceFormatted: `${formatEav7(balance)} ${CHAIN.SYMBOL}`,
      staked,
      stakedFormatted: `${formatEav7(staked)} ${CHAIN.SYMBOL}`,
      nonce: acc?.nonce ?? 0,
      nextNonce: node.nextNonceFor(address), // ciente do mempool (para relayers/workers)
      energy: state.energyOf(address, blockchain.height), // { max, available }
      feeExempt: state.isFeeExempt(address),
      isValidator: state.validators().some((v) => v.address === address),
      tokens: state.tokenBalancesOf(address),
      oracle: state.oracles[address] ?? null,
    });
    return;
  }

  // Transações de um endereço (envio ou recebimento) — varredura server-side,
  // paginada por ?before= e com teto de blocos varridos por requisição (anti-DoS).
  if (GET && parts[0] === 'address' && parts[2] === 'txs' && parts.length === 3) {
    let addr = parts[1];
    if (isEavmAddress(addr)) addr = eavmToE7(addr);
    else if (!isValidAddress(addr)) return send(res, 400, { error: 'endereço inválido' });
    // Usa o índice por endereço → TODAS as transações da carteira, da mais nova para a
    // mais antiga, sem varrer a cadeia inteira e sem o teto de 20k blocos.
    const HARD_CAP = 2000;
    const limit = Math.min(Math.max(intParam(url.searchParams.get('limit'), HARD_CAP), 1), HARD_CAP);
    const before = intParam(url.searchParams.get('before'), Number.MAX_SAFE_INTEGER);
    const heights = blockchain.addressTxIndex.get(addr) ?? [];
    const txs = [];
    let nextBefore = null;
    for (let i = heights.length - 1; i >= 0 && txs.length < limit; i--) {
      const h = heights[i];
      if (h >= before) continue;
      const b = blockchain.getBlock(h);
      if (!b) continue;
      const inBlock = [];
      for (const t of b.transactions) {
        if (t.from === addr || t.to === addr) inBlock.push({ ...t, blockHeight: h, blockTime: b.timestamp });
      }
      for (let j = inBlock.length - 1; j >= 0; j--) txs.push(inBlock[j]);
      if (txs.length >= limit && i > 0) nextBefore = h;
    }
    send(res, 200, { address: addr, txs, nextBefore });
    return;
  }

  if (GET && parts[0] === 'validators') {
    send(res, 200, {
      maxValidators: CHAIN.MAX_VALIDATORS,
      minStake: CHAIN.MIN_VALIDATOR_STAKE,
      blockReward: blockchain.blockReward(Math.max(blockchain.height + 1, 0)),
      current: state.validators(),
      slotProducer: blockchain.expectedProducer(Date.now()),
    });
    return;
  }

  // ---- tokens EAV20 -----------------------------------------------------------
  if (GET && parts[0] === 'tokens' && parts.length === 1) {
    send(res, 200, Object.values(state.tokens).map(tokenView));
    return;
  }

  if (GET && parts[0] === 'tokens' && parts.length === 2) {
    const token = state.tokens[parts[1]];
    if (!token) return send(res, 404, { error: 'token EAV20 não encontrado' });
    const view = tokenView(token);
    const address = url.searchParams.get('address');
    if (address) view.balanceOf = { address, balance: tokenBalanceOf(token, address) };
    send(res, 200, view);
    return;
  }

  // ---- camada de IA -------------------------------------------------------------
  if (GET && parts[0] === 'ai' && parts[1] === 'tasks' && parts.length === 2) {
    const status = url.searchParams.get('status');
    let tasks = Object.values(state.aiTasks);
    if (status) tasks = tasks.filter((task) => task.status === status.toUpperCase());
    send(res, 200, tasks);
    return;
  }

  if (GET && parts[0] === 'ai' && parts[1] === 'tasks' && parts.length === 3) {
    const task = state.aiTasks[parts[2]];
    if (!task) return send(res, 404, { error: 'tarefa de IA não encontrada' });
    send(res, 200, task);
    return;
  }

  if (GET && parts[0] === 'ai' && parts[1] === 'oracles') {
    send(res, 200, Object.values(state.oracles));
    return;
  }

  // ---- ponte cross-chain ---------------------------------------------------------
  if (GET && parts[0] === 'bridge' && parts[1] === 'transfers' && parts.length === 2) {
    const direction = url.searchParams.get('direction');
    const status = url.searchParams.get('status');
    let transfers = Object.values(state.bridge.transfers);
    if (direction) transfers = transfers.filter((t) => t.direction === direction.toUpperCase());
    if (status) transfers = transfers.filter((t) => t.status === status.toUpperCase());
    send(res, 200, transfers);
    return;
  }

  if (GET && parts[0] === 'bridge' && parts[1] === 'transfers' && parts.length === 3) {
    const transfer = state.bridge.transfers[parts[2]];
    if (!transfer) return send(res, 404, { error: 'transferência de ponte não encontrada' });
    send(res, 200, transfer);
    return;
  }

  // ---- segurança (sentinela de IA) --------------------------------------------------
  if (GET && parts[0] === 'security' && parts[1] === 'alerts') {
    send(res, 200, node.securityAlerts.slice(-100).reverse());
    return;
  }

  // Escrita de alertas exige token de admin (evita flood que evicta/suprime
  // alertas reais). O token vem de EAV7_ADMIN_TOKEN; sem ele, a escrita é negada.
  if (POST && parts[0] === 'security' && parts[1] === 'alerts') {
    if (!node.checkAdmin(req)) return send(res, 403, { error: 'requer token de admin (x-admin-token)' });
    const alert = node.addSecurityAlert(await readBody(req));
    send(res, 200, alert);
    return;
  }

  // ---- peers ----------------------------------------------------------------------
  if (GET && parts[0] === 'peers') {
    send(res, 200, node.p2p.list());
    return;
  }

  if (POST && parts[0] === 'peers') {
    // Registro de peers exige admin (a malha vem por --peers). Endpoint aberto era
    // um vetor de SSRF por DNS rebinding com peer não confiável (achado H-3).
    if (!node.checkAdmin(req)) return send(res, 403, { error: 'requer token de admin (x-admin-token)' });
    const { url: peerUrl } = await readBody(req);
    send(res, 200, { added: await node.p2p.addPeer(peerUrl, { trusted: true }) });
    return;
  }



  send(res, 404, { error: `rota não encontrada: ${req.method} ${url.pathname}` });
}
