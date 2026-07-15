import { CHAIN } from '../config.js';

// Rate limit por IP (janela fixa, em memória). Atrás da Cloudflare o IP real do
// cliente vem em CF-Connecting-IP; senão usa o IP do socket. Defesa em camadas
// junto com as regras de WAF da própria Cloudflare.
export function createRateLimiter({ max = CHAIN.RATE_LIMIT_MAX, windowMs = CHAIN.RATE_LIMIT_WINDOW_MS } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }

  function clientIp(req) {
    const socketIp = req.socket?.remoteAddress ?? 'unknown';
    // Só confia nos headers de proxy (CF-Connecting-IP / X-Forwarded-For) quando a
    // conexão vem do LOOPBACK — que é por onde o túnel cloudflared entrega o tráfego
    // público. Acesso DIRETO ao nó usa o IP real do socket, impedindo que um atacante
    // forje o header para escapar do rate limit (achado H-5).
    if (socketIp === '127.0.0.1' || socketIp === '::1' || socketIp === '::ffff:127.0.0.1') {
      const cf = req.headers['cf-connecting-ip'];
      if (typeof cf === 'string' && cf) return cf;
      const xff = req.headers['x-forwarded-for'];
      // ÚLTIMO hop, não o primeiro: cada proxy confiável APENDA o IP do peer de
      // quem recebeu, então o último item é o IP que o nosso proxy loopback viu.
      // O primeiro item é fornecido pelo cliente e seria trivialmente forjável
      // para trocar de bucket a cada request e furar o rate limit (achado L2).
      if (typeof xff === 'string' && xff) {
        const hops = xff.split(',');
        return hops[hops.length - 1].trim();
      }
    }
    return socketIp;
  }

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
