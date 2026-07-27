import { CHAIN } from '../config.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export function isLoopbackIp(ip) { return LOOPBACK.has(ip); }

// Resolve o IP real do cliente. Atrás da Cloudflare vem em CF-Connecting-IP; senão o
// IP do socket. Só confia nos headers de proxy quando a conexão vem do LOOPBACK — que
// é por onde o túnel cloudflared entrega o tráfego público. Acesso DIRETO usa o IP do
// socket, impedindo forja do header para furar o rate limit (achado H-5). ÚLTIMO hop do
// XFF (não o primeiro, forjável pelo cliente — achado L2).
export function clientIp(req) {
  const socketIp = req.socket?.remoteAddress ?? 'unknown';
  if (LOOPBACK.has(socketIp)) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf;
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) {
      const hops = xff.split(',');
      return hops[hops.length - 1].trim();
    }
  }
  return socketIp;
}

// Rate limit por IP (janela fixa, em memória). Defesa em camadas junto com as regras
// de WAF da própria Cloudflare.
export function createRateLimiter({ max = CHAIN.RATE_LIMIT_MAX, windowMs = CHAIN.RATE_LIMIT_WINDOW_MS } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }

  // Retorna true se DENTRO do limite; false se excedeu (deve responder 429).
  return function allow(req) {
    const now = Date.now();
    const ip = clientIp(req);
    let e = hits.get(ip);
    if (!e || now >= e.resetAt) {
      e = { count: 0, resetAt: now + windowMs };
      hits.set(ip, e);
    }
    e.count += 1;
    // poda ocasional para o Map não crescer sem limite
    if (hits.size > 50_000) {
      for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    }
    return e.count <= max;
  };
}
