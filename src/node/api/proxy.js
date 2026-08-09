// Proxies Next / buy / peer (G21) — extraídos de api.js.
import { request as httpRequest } from 'node:http';

const WEB_HOST = '127.0.0.1';
const WEB_PORT = Number(process.env.EAV7_WEB_PORT) || 3000;
const WEB_PREFIXES = ['/_next/', '/bg/', '/brand/'];
const WEB_FILES_RE = /^\/(?:favicon\.ico|icon\.svg|icon\.png|apple-icon|opengraph-image|twitter-image|robots\.txt|sitemap\.xml|manifest|sw\.js)/i;
const WEB_EXT_RE = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|ogg|wasm)$/i;

export function isWebRequest(req, pathname) {
  const accept = req.headers.accept ?? '';
  if (accept.includes('text/html') || accept.includes('text/x-component')) return true;
  if ('rsc' in req.headers || 'next-router-prefetch' in req.headers || 'next-router-state-tree' in req.headers) return true;
  if (WEB_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return WEB_FILES_RE.test(pathname) || WEB_EXT_RE.test(pathname);
}

export function proxyToWeb(req, res, node) {
  const upstream = httpRequest({
    host: WEB_HOST, port: WEB_PORT, method: req.method, path: req.url, headers: req.headers,
  }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (e) => {
    node.log?.(`[web] proxy indisponível: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('EAV7 Web temporariamente indisponível');
    }
  });
  req.pipe(upstream);
}

const BUY_HOST = process.env.EAV7_BUY_HOST || '127.0.0.1';
const BUY_PORT = Number(process.env.EAV7_BUY_PORT || 8790);

export function proxyToBuy(req, res, node) {
  const upstream = httpRequest({
    host: BUY_HOST, port: BUY_PORT, method: req.method, path: req.url,
    headers: { ...req.headers, host: `${BUY_HOST}:${BUY_PORT}` },
  }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (e) => {
    node.log?.(`[buy] proxy indisponível: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'serviço de compra indisponível' }));
    }
  });
  req.pipe(upstream);
}

export async function proxyToPeer(req, res, target, node) {
  try {
    const up = await fetch(target + req.url, {
      headers: { accept: 'application/json', 'x-eav7-proxied': '1' },
      signal: AbortSignal.timeout(8000),
    });
    const body = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, {
      'content-type': up.headers.get('content-type') || 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'x-eav7-served-by': target,
    });
    res.end(body);
    return true;
  } catch (e) {
    node.log?.(`[gateway] proxy de leitura falhou (${target}): ${e.message}`);
    return false;
  }
}
