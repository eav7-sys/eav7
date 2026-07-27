import { isLoopbackIp } from './ratelimit.js';

// Auto-mitigação OPERACIONAL: bloqueio temporário de IPs abusivos.
//
// NÃO é consenso — afeta apenas quem pode BATER neste nó (a API pública), jamais a
// validade de transações/blocos ou o estado. É 100% REVERSÍVEL: todo bloqueio tem TTL
// e expira sozinho; o admin pode limpar manualmente. Guardrails rígidos: só bloqueia
// depois de acumular faltas graves numa janela curta (flood de rate-limit, transações
// inválidas em série); NUNCA bloqueia o loopback (por onde entra o túnel Cloudflare),
// senão um IP forjado derrubaria todo o tráfego público. Reincidentes têm o bloqueio
// dobrado (backoff exponencial) até um teto. A IA age sozinha aqui porque é operacional
// e reversível — a mesma linha do balanceador de gateway ([[eav7-ai-roadmap]]).
export class AbuseGuard {
  constructor({
    windowMs = Number(process.env.EAV7_GUARD_WINDOW_MS || 60_000),
    threshold = Number(process.env.EAV7_GUARD_STRIKES || 40), // pontos de falta na janela p/ bloquear
    blockMs = Number(process.env.EAV7_GUARD_BLOCK_MS || 10 * 60_000),
    maxBlockMs = Number(process.env.EAV7_GUARD_MAX_BLOCK_MS || 6 * 60 * 60_000),
    enabled = process.env.EAV7_GUARD !== '0', // ligado por padrão (opt-out)
    log = () => {},
  } = {}) {
    this.windowMs = windowMs;
    this.threshold = threshold;
    this.blockMs = blockMs;
    this.maxBlockMs = maxBlockMs;
    this.enabled = enabled;
    this.log = log;
    this.entries = new Map(); // ip -> { windowStart, score, blockedUntil, offenses, lastStrike }
    this.totalBlocks = 0;
  }

  // Registra uma falta (weight: rate-limit=1, tx inválida=3, etc). Retorna true se ESTE
  // strike acabou de disparar o bloqueio. Pura o suficiente p/ testar (recebe `now`).
  strike(ip, weight = 1, now = Date.now()) {
    if (!this.enabled || !ip || isLoopbackIp(ip)) return false;
    if (this.entries.size > 10_000) this.prune(now); // poda oportunista (sem timer extra)
    let e = this.entries.get(ip);
    if (!e) { e = { windowStart: now, score: 0, blockedUntil: 0, offenses: 0, lastStrike: now }; this.entries.set(ip, e); }
    if (now < e.blockedUntil) return false; // já bloqueado — não re-conta
    if (now - e.windowStart > this.windowMs) { e.windowStart = now; e.score = 0; } // nova janela
    e.score += weight;
    e.lastStrike = now;
    if (e.score >= this.threshold) {
      const dur = Math.min(this.blockMs * 2 ** e.offenses, this.maxBlockMs); // backoff p/ reincidente
      e.blockedUntil = now + dur;
      e.offenses += 1;
      e.score = 0;
      this.totalBlocks += 1;
      this.log(`[guard] IP ${ip} bloqueado por ${Math.round(dur / 1000)}s (reincidência ${e.offenses})`);
      return true;
    }
    return false;
  }

  // true se o IP está bloqueado AGORA (a resposta deve ser 429/403). Loopback nunca bloqueia.
  blocked(ip, now = Date.now()) {
    if (!this.enabled || !ip || isLoopbackIp(ip)) return false;
    const e = this.entries.get(ip);
    return !!e && now < e.blockedUntil;
  }

  clear(ip) { return this.entries.delete(ip); } // admin: desbloqueio manual

  // Poda entradas sem bloqueio ativo e antigas (mantém o Map enxuto).
  prune(now = Date.now()) {
    for (const [ip, e] of this.entries) {
      if (now >= e.blockedUntil && now - e.lastStrike > this.windowMs) this.entries.delete(ip);
    }
  }

  // Observabilidade (GET /guard): lista de bloqueios ativos + contadores.
  snapshot(now = Date.now()) {
    const active = [];
    for (const [ip, e] of this.entries) {
      if (now < e.blockedUntil) active.push({ ip, until: e.blockedUntil, remainingMs: e.blockedUntil - now, offenses: e.offenses });
    }
    active.sort((a, b) => b.until - a.until);
    return { enabled: this.enabled, threshold: this.threshold, windowMs: this.windowMs, blockMs: this.blockMs, totalBlocks: this.totalBlocks, activeBlocks: active.length, blocked: active, at: now };
  }
}
