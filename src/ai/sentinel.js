// Sentinela de segurança da EAV7 — vigilância 24h da rede por IA.
//
// Processo off-chain que monitora blocos, mempool e validadores em tempo real:
//   • heurísticas determinísticas rodam a cada ciclo (reorg, transferências
//     gigantes, rajadas de transações, concentração de produtores, flood)
//   • com ANTHROPIC_API_KEY definida, um analista LLM (Claude) recebe
//     periodicamente um dossiê da atividade recente e publica um parecer
// Os alertas são enviados ao nó (POST /security/alerts) e ficam visíveis na
// plataforma de mineração e via GET /security/alerts.
import { CHAIN, formatEav7 } from '../config.js';

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';

export class SecuritySentinel {
  constructor({ nodeUrl, pollMs = 5000, aiDigestMs = 10 * 60_000, log = console.log }) {
    this.nodeUrl = nodeUrl.replace(/\/$/, '');
    this.pollMs = pollMs;
    this.aiDigestMs = aiDigestMs;
    this.log = log;
    this.lastHeight = -1;
    this.hashesByHeight = new Map(); // altura -> hash (janela recente)
    this.producerHistory = []; // produtores dos últimos blocos
    this.recentActivity = []; // resumo por bloco para o dossiê da IA
    this.lastAiDigestAt = 0;
    this.timer = null;
  }

  async #getJson(path) {
    const response = await fetch(this.nodeUrl + path, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${path} respondeu ${response.status}`);
    return response.json();
  }

  async alert(kind, severity, message, context = {}) {
    this.log(`[sentinela][${severity.toUpperCase()}] ${kind}: ${message}`);
    try {
      await fetch(this.nodeUrl + '/security/alerts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // escrita de alertas exige token de admin (EAV7_ADMIN_TOKEN)
          ...(process.env.EAV7_ADMIN_TOKEN ? { 'x-admin-token': process.env.EAV7_ADMIN_TOKEN } : {}),
        },
        body: JSON.stringify({ source: 'ai-sentinel', kind, severity, message, context }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.log(`[sentinela] falha ao publicar alerta: ${err.message}`);
    }
  }

  #inspectBlock(block, validatorCount) {
    const known = this.hashesByHeight.get(block.height);
    if (known && known !== block.hash) {
      this.alert('REORG', 'critical', `bloco na altura ${block.height} foi substituído (fork/reorganização)`, {
        height: block.height, antes: known, depois: block.hash,
      });
    }
    this.hashesByHeight.set(block.height, block.hash);
    if (this.hashesByHeight.size > 500) {
      this.hashesByHeight.delete(Math.min(...this.hashesByHeight.keys()));
    }

    const perSender = {};
    for (const tx of block.transactions) {
      perSender[tx.from] = (perSender[tx.from] ?? 0) + 1;
      if (tx.type === 'TRANSFER' && BigInt(tx.amount) > CHAIN.GENESIS_SUPPLY / 100n) {
        this.alert('LARGE_TRANSFER', 'warning',
          `transferência de ${formatEav7(BigInt(tx.amount))} ${CHAIN.SYMBOL} (>1% do supply) no bloco ${block.height}`,
          { tx: tx.id, from: tx.from, to: tx.to });
      }
    }
    for (const [sender, count] of Object.entries(perSender)) {
      if (count > 20) {
        this.alert('TX_BURST', 'warning', `${sender} enviou ${count} transações num único bloco`, {
          height: block.height, sender, count,
        });
      }
    }

    this.producerHistory.push(block.producer);
    if (this.producerHistory.length > 100) this.producerHistory.shift();
    if (validatorCount > 1 && this.producerHistory.length >= 50) {
      const counts = {};
      for (const p of this.producerHistory) counts[p] = (counts[p] ?? 0) + 1;
      const [topProducer, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (topCount / this.producerHistory.length > 0.8) {
        this.alert('PRODUCER_CONCENTRATION', 'warning',
          `${topProducer} produziu ${topCount} dos últimos ${this.producerHistory.length} blocos com ${validatorCount} validadores ativos`,
          { producer: topProducer });
        this.producerHistory = []; // evita repetir o alerta a cada bloco
      }
    }

    this.recentActivity.push({
      height: block.height,
      producer: block.producer,
      txCount: block.txCount,
      types: block.transactions.map((tx) => tx.type),
    });
    if (this.recentActivity.length > 200) this.recentActivity.shift();
  }

  async tick() {
    const status = await this.#getJson('/status');

    if (status.height < this.lastHeight) {
      await this.alert('CHAIN_ROLLBACK', 'critical',
        `altura da cadeia regrediu de ${this.lastHeight} para ${status.height}`, {});
    }
    if (status.mempool > 1000) {
      await this.alert('MEMPOOL_FLOOD', 'warning', `mempool com ${status.mempool} transações pendentes`, {});
    }

    if (status.height > this.lastHeight) {
      const from = this.lastHeight + 1;
      const blocks = await this.#getJson(`/blocks?from=${Math.max(0, from)}&limit=100`);
      for (const block of blocks) this.#inspectBlock(block, status.validators);
      this.lastHeight = blocks.at(-1)?.height ?? status.height;
    }

    if (process.env.ANTHROPIC_API_KEY && Date.now() - this.lastAiDigestAt > this.aiDigestMs) {
      this.lastAiDigestAt = Date.now();
      await this.#aiDigest(status).catch((err) =>
        this.log(`[sentinela] análise por IA falhou: ${err.message}`),
      );
    }
  }

  async #aiDigest(status) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: DEFAULT_CLAUDE_MODEL,
        max_tokens: 600,
        messages: [{
          role: 'user',
          content:
            'Você é o analista de segurança 24h da blockchain EAV7 (protocolo eav20, DPoS). '
            + 'Avalie a atividade recente e responda em português com um parecer curto: '
            + 'nível de risco (baixo/médio/alto), anomalias observadas e recomendações.\n\n'
            + `Status: ${JSON.stringify(status)}\n`
            + `Últimos blocos: ${JSON.stringify(this.recentActivity.slice(-50))}`,
        }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`API da Anthropic respondeu ${response.status}`);
    const body = await response.json();
    const text = body.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
    await this.alert('AI_ANALYSIS', 'info', text, { model: DEFAULT_CLAUDE_MODEL });
  }

  async start() {
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.log(`[sentinela] erro no ciclo: ${err.message}`));
    }, this.pollMs);
    this.log(`[sentinela] vigilância 24h ativa em ${this.nodeUrl}`
      + (process.env.ANTHROPIC_API_KEY ? ' (análise por Claude habilitada)' : ' (heurísticas locais; defina ANTHROPIC_API_KEY para análise por LLM)'));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
