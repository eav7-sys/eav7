import { lookup } from 'node:dns/promises';
import { CHAIN } from '../config.js';

// P2P da EAV7 sobre HTTP: registro mútuo de peers, gossip de transações e
// blocos, e sincronização periódica pela cadeia válida mais longa.
export class P2P {
  constructor({ node, selfUrl, peers = [], syncMs = 5000, allowPrivatePeers = false, log = console.log }) {
    this.node = node;
    this.selfUrl = normalize(selfUrl);
    this.allowPrivatePeers = allowPrivatePeers;
    this.peers = new Set();
    this.syncMs = syncMs;
    this.log = log;
    this.timer = null;
    // Peers de arranque (passados pelo operador) são confiáveis — podem ser
    // loopback/privados para redes locais de desenvolvimento.
    for (const url of peers) this.addPeer(url, { trusted: true });
  }

  // trusted = seed do operador (bypassa o filtro de IP privado). Peers vindos de
  // fontes não confiáveis (POST /peers, listas de outros peers) são filtrados
  // contra SSRF: além do hostname literal, o DNS é resolvido e QUALQUER IP
  // privado/loopback/link-local rejeita o peer (bloqueia DNS rebinding). Async.
  async addPeer(url, { trusted = false } = {}) {
    const peer = normalize(url);
    if (!peer || peer === this.selfUrl || this.peers.has(peer)) return false;
    if (this.peers.size >= CHAIN.MAX_PEERS) return false;
    if (!trusted && !this.allowPrivatePeers) {
      if (isPrivateHost(peer)) return false;
      try {
        const host = new URL(peer).hostname;
        const addrs = await lookup(host, { all: true });
        if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) return false;
      } catch {
        return false; // não resolve => não conecta
      }
      if (this.peers.has(peer) || this.peers.size >= CHAIN.MAX_PEERS) return false;
    }
    this.peers.add(peer);
    this.log(`[p2p] novo peer: ${peer}`);
    return true;
  }

  list() {
    return [...this.peers];
  }

  async #post(peer, path, body) {
    await this.#guardPeer(peer); // anti-rebinding antes de enviar (H-3)
    return fetch(peer + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(3000),
    });
  }

  broadcastTx(tx) {
    const body = JSON.stringify(tx);
    for (const peer of this.peers) {
      this.#post(peer, '/tx', body).catch(() => {});
    }
  }

  broadcastBlock(block) {
    const body = JSON.stringify(block);
    for (const peer of this.peers) {
      this.#post(peer, '/blocks', body).catch(() => {});
    }
  }

  async #register(peer) {
    try {
      // POST /peers agora exige admin token (H-3). Nós da malha se autenticam com o
      // token compartilhado; peers sem token não conseguem se registrar (a malha
      // legítima vem por --peers de qualquer forma).
      const headers = { 'content-type': 'application/json' };
      if (this.node.adminToken) headers['x-admin-token'] = this.node.adminToken;
      await fetch(peer + '/peers', { method: 'POST', headers, body: JSON.stringify({ url: this.selfUrl }), signal: AbortSignal.timeout(3000) });
      const known = await this.#fetchJsonCapped(peer + '/peers', { maxBytes: 1_000_000, timeoutMs: 3000 });
      // peers DESCOBERTOS passam pela validação de IP privado (não são confiáveis)
      for (const url of known) this.addPeer(url);
    } catch {
      /* peer offline — tenta de novo no próximo sync */
    }
  }

  // Revalida, ANTES de cada fetch, que o hostname do peer não resolve para um IP
  // privado/loopback/metadata. Fecha a janela TOCTOU do DNS rebinding: o peer passa
  // no filtro do addPeer e depois reaponta o DNS para um alvo interno (achado H-3).
  async #guardPeer(peer) {
    // Escape hatch explícito do operador: com allowPrivatePeers (dev/testnet/nós
    // co-locados por localhost) o filtro anti-SSRF de host privado é dispensado —
    // caso contrário o gossip/sync entre nós na mesma máquina nunca funciona.
    // Na mainnet allowPrivatePeers é false (padrão), então o guard segue ativo.
    if (this.allowPrivatePeers) return;
    if (isPrivateHost(peer)) throw new Error('peer resolve para host privado');
    const host = new URL(peer).hostname;
    if (!/^[\d.]+$/.test(host) && !host.includes(':')) { // hostname (não literal IP)
      const addrs = await lookup(host, { all: true });
      if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('peer resolve para IP privado (possível rebinding)');
    }
  }

  // Lê JSON de um peer com TETO de bytes — sem isto, um peer malicioso responde um
  // corpo gigante e o .json() estoura a memória do nó (OOM, achado H-4).
  async #fetchJsonCapped(url, { maxBytes = CHAIN.MAX_SYNC_PAGE_BYTES, timeoutMs = 15_000 } = {}) {
    await this.#guardPeer(url);
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (Number(res.headers.get('content-length') || 0) > maxBytes) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      throw new Error('resposta do peer excede o limite de bytes');
    }
    const reader = res.body?.getReader?.();
    if (!reader) return res.json();
    let received = 0;
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error('resposta do peer excede o limite de bytes'); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  // Baixa blocos [from, from+limite] de um peer, em páginas.
  async #fetchRange(peer, from) {
    const out = [];
    let cursor = from;
    for (;;) {
      const page = await this.#fetchJsonCapped(`${peer}/chain?from=${cursor}&limit=${CHAIN.MAX_CHAIN_PAGE}`);
      if (!Array.isArray(page?.blocks) || page.blocks.length === 0) break;
      out.push(...page.blocks);
      cursor += page.blocks.length;
      if (page.blocks.length < CHAIN.MAX_CHAIN_PAGE || out.length >= CHAIN.MAX_SYNC_BLOCKS) break;
    }
    return out;
  }

  async syncOnce() {
    if (this.syncing) return; // não reentrar (o replay é O(blocos))
    this.syncing = true;
    try {
      // FASE 1 (rápida): coleta a altura de cada peer. A altura auto-reportada em
      // /status só serve para DECIDIR tentar sincronizar (baixar e validar blocos).
      // Nunca é usada para bloquear a produção — senão um peer mentindo altura enorme
      // congelaria a rede (achado H2 da auditoria).
      const ativos = [];
      for (const peer of this.peers) {
        try {
          const status = await this.#fetchJsonCapped(peer + '/status', { maxBytes: 1_000_000, timeoutMs: 3000 });
          if (Number.isFinite(status.height)) ativos.push([peer, status.height]);
        } catch { /* peer inacessível */ }
      }

      // FASE 2 (lenta): sincroniza de cada peer que esteja à frente.
      for (const [peer, peerHeight] of ativos) {
        try {
          const bc = this.node.blockchain;
          if (peerHeight <= bc.height) continue;

          if (bc.hasGenesis() && bc.height >= 0) {
            // 2a) EXTENSÃO INCREMENTAL: o peer continua a nossa cadeia — baixa só
            // os blocos acima do nosso topo e aplica direto (O(novos)).
            const novos = await this.#fetchRange(peer, bc.height + 1);
            if (novos.length && novos[0].previousHash === bc.head.hash) {
              let n = 0;
              for (const b of novos) { try { bc.addBlock(b); n += 1; } catch { break; } }
              if (n > 0) {
                this.node.mempool.prune(bc.state);
                this.log(`[p2p] +${n} blocos de ${peer} (altura ${bc.height})`);
                continue;
              }
            }

            // 2b) REORG DE TOPO DIVERGENTE: forkamos. Baixa a janela recente do peer
            // de uma vez (forks são recentes), acha o ancestral comum LOCALMENTE e
            // reorganiza a partir dele — O(janela), sem replay da cadeia inteira.
            if (novos.length) {
              const from = Math.max(0, bc.height - CHAIN.REORG_WINDOW);
              const janela = await this.#fetchRange(peer, from);
              let common = -1;
              for (let i = janela.length - 1; i >= 0; i--) {
                const h = from + i;
                if (bc.hashAt(h) && janela[i].hash === bc.hashAt(h)) { common = h; break; }
              }
              if (common >= 0 && common < bc.height) {
                const tail = janela.slice(common - from + 1);
                const orphans = bc.reorg(common, tail);
                if (orphans) {
                  this.node.mempool.prune(bc.state);
                  for (const tx of orphans) { try { this.node.submitTransaction(tx, { broadcast: false }); } catch { /* obsoleta */ } }
                  this.log(`[p2p] reorg com ${peer} a partir da altura ${common} (altura ${bc.height})`);
                }
                continue;
              }
            }
          }

          // 2c) FALLBACK (bootstrap sem cadeia): baixa desde a gênese.
          const all = await this.#fetchRange(peer, 0);
          const orphans = all.length ? bc.replaceChain(all) : false;
          if (orphans) {
            this.node.mempool.prune(bc.state);
            for (const tx of orphans) {
              try { this.node.submitTransaction(tx, { broadcast: false }); } catch { /* obsoleta */ }
            }
            this.log(`[p2p] cadeia sincronizada (reorg) com ${peer} (altura ${bc.height})`);
          }
        } catch {
          /* peer inacessível neste ciclo */
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  async start() {
    for (const peer of this.peers) await this.#register(peer);
    await this.syncOnce();
    this.timer = setInterval(() => this.syncOnce().catch(() => {}), this.syncMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function normalize(url) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
  try {
    // valida a URL; hosts malformados são rejeitados
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    return null;
  }
  return url.replace(/\/+$/, '');
}

// Classifica um octeto-quad (a.b.c.d) como privado/loopback/link-local.
function isPrivateV4(a, b) {
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / metadata cloud
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

// Normaliza formas NÃO-canônicas de IPv4 (inteiro `2130706433`, octal `0177.0.0.1`,
// hex `0x7f.0.0.1`, quads curtos) para [a,b,c,d]. Retorna null se não for IPv4.
// Sem isso, `http://2130706433/` (= 127.0.0.1) escaparia do filtro literal (achado L3).
function normalizeV4(host) {
  const parseNum = (s) => {
    if (/^0x[0-9a-f]+$/.test(s)) return parseInt(s, 16);
    if (/^0[0-7]+$/.test(s)) return parseInt(s, 8);
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return NaN;
  };
  const parts = host.split('.');
  if (parts.length === 1) {
    const n = parseNum(parts[0]);
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }
  if (parts.length === 4) {
    const nums = parts.map(parseNum);
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return nums;
  }
  return null;
}

// IP literal em faixa privada/loopback/link-local (inclui metadata cloud).
function isPrivateIp(ip) {
  const host = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = normalizeV4(host);
  if (v4) return isPrivateV4(v4[0], v4[1]);
  if (host === '::1' || host === '::') return true;
  // ULA fc00::/7 (fc,fd) e link-local fe80::/10 (fe8,fe9,fea,feb — não só fe8)
  if (host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host)) return true;
  // IPv4 mapeado/compatível em IPv6: ::ffff:a.b.c.d, ::ffff:7f00:1, ::a.b.c.d
  if (host.startsWith('::ffff:') || host.startsWith('::')) {
    const tail = host.replace(/^::(ffff:)?/, '');
    if (tail.includes('.')) return isPrivateIp(tail);
    const hexPair = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexPair) {
      const hi = parseInt(hexPair[1], 16); // dois octetos mais altos do IPv4 embutido
      return isPrivateV4((hi >>> 8) & 0xff, hi & 0xff);
    }
  }
  return false;
}

// Bloqueia hostnames locais e IPs literais privados antes da resolução DNS.
function isPrivateHost(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local')) return true;
  return isPrivateIp(host);
}
