// Roteamento consciente de saúde — balanceador + failover do GATEWAY público.
//
// É OPERACIONAL e 100% REVERSÍVEL: NÃO toca consenso, estado nem blocos. Quando o
// nó-gateway (o que fica na frente de eavscan.com) fica ATRÁS dos peers (stale —
// típico durante replay/restart ou queda de ritmo), as LEITURAS públicas (GET) passam
// a ser servidas do peer mais saudável, dando dados frescos e sem ponto único. Escrita
// (POST /tx) segue local (o mempool faz gossip). A decisão tem histerese (anti-flap) e
// só liga com EAV7_GATEWAY_FAILOVER=1. Desligar o flag reverte para "servir local".
//
// A "IA de saúde" (a sentinela/monitor) toma a decisão de roteamento — autônoma porque
// é reversível e não-consensual; jamais decide validador, stake ou código.
export class GatewayHealth {
  constructor({ node, log = () => {}, lag = 12, checkMs = 4000, flips = 2 } = {}) {
    this.node = node;
    this.log = log;
    this.lag = Number(process.env.EAV7_GATEWAY_LAG || lag); // quantos blocos atrás = stale
    this.checkMs = checkMs;
    this.flips = flips; // checagens consecutivas p/ trocar (histerese)
    this.target = null; // null = servir local; url = servir deste peer
    this.snapshot = { self: -1, peers: [], at: 0 }; // p/ observabilidade (/gateway)
    this.unhealthy = 0;
    this.healthy = 0;
    this.timer = null;
  }

  start() {
    if (process.env.EAV7_GATEWAY_FAILOVER !== '1') return; // opt-in explícito
    this.timer = setInterval(() => this.tick().catch(() => {}), this.checkMs);
    this.timer.unref?.();
    this.log('[gateway] failover de leitura ATIVO (histerese anti-flap)');
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async #status(url) {
    const t0 = Date.now();
    try {
      const res = await fetch(url + '/status', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
      const s = await res.json();
      return { url, height: Number.isFinite(s.height) ? s.height : -1, ok: true, latency: Date.now() - t0 };
    } catch {
      return { url, height: -1, ok: false, latency: Infinity };
    }
  }

  async tick() {
    const selfHeight = this.node.blockchain.height;
    const peers = [];
    for (const url of this.node.p2p.peers) peers.push(await this.#status(url));
    this.snapshot = { self: selfHeight, peers, at: Date.now() };
    this.decide(selfHeight, peers);
  }

  // Decisão PURA (testável): dado a própria altura e a saúde dos peers, escolhe servir
  // local (null) ou do peer mais saudável (url), com histerese para não oscilar.
  decide(selfHeight, peers) {
    const best = peers
      .filter((p) => p.ok && p.height >= 0)
      .sort((a, b) => b.height - a.height || a.latency - b.latency)[0];
    const stale = !!best && best.height - selfHeight > this.lag;
    if (stale) {
      this.unhealthy += 1; this.healthy = 0;
      if (this.unhealthy >= this.flips && this.target !== best.url) {
        this.target = best.url;
        this.log(`[gateway] failover → servindo leituras de ${best.url} (self ${selfHeight} atrás de ${best.height})`);
      }
    } else {
      this.healthy += 1; this.unhealthy = 0;
      if (this.healthy >= this.flips && this.target !== null) {
        this.log(`[gateway] recuperado → voltando a servir local (altura ${selfHeight})`);
        this.target = null;
      }
    }
    return this.target;
  }
}
