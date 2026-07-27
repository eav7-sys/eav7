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
import { draftValidatorGovernanceProposal } from '../node/validator-score.js';

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
    // Saúde de validador: exige degradação SUSTENTADA (evita flap durante replay/restart).
    this.degradedTicks = Number(process.env.EAV7_DEGRADED_TICKS || 6); // ciclos consecutivos p/ alertar
    this.degradedStreak = new Map(); // address -> ciclos consecutivos degradado
    this.alertedDegraded = new Set(); // já alertado nesta ocorrência (não repetir)
    // Conselheiro de governança (propose-only): publica advisories NOVOS como alerta.
    this.advisoryMs = Number(process.env.EAV7_ADVISORY_MS || 10 * 60_000);
    this.lastAdvisoryAt = 0;
    this.advisedKeys = new Set(); // param:valor já alertado (dedup até voltar ao saudável)
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
      // Queda além de qualquer reorg plausível (> 50k blocos) = troca de gênese /
      // relaunch da rede, não um rollback real. Re-baseline em silêncio em vez de
      // alertar para sempre (senão a sentinela cospe CHAIN_ROLLBACK a cada tick).
      if (this.lastHeight - status.height > 50_000) {
        this.lastHeight = status.height;
      } else {
        await this.alert('CHAIN_ROLLBACK', 'critical',
          `altura da cadeia regrediu de ${this.lastHeight} para ${status.height}`, {});
      }
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

    await this.#checkValidatorHealth().catch((err) =>
      this.log(`[sentinela] checagem de validadores falhou: ${err.message}`));

    if (Date.now() - this.lastAdvisoryAt > this.advisoryMs) {
      this.lastAdvisoryAt = Date.now();
      await this.#checkGovernanceAdvisories().catch((err) =>
        this.log(`[sentinela] conselheiro de governança falhou: ${err.message}`));
    }

    if (process.env.ANTHROPIC_API_KEY && Date.now() - this.lastAiDigestAt > this.aiDigestMs) {
      this.lastAiDigestAt = Date.now();
      await this.#aiDigest(status).catch((err) =>
        this.log(`[sentinela] análise por IA falhou: ${err.message}`),
      );
    }
  }

  // Vigia a saúde/desempenho dos validadores via /validators (score derivado da cadeia).
  // Quando um validador fica degradado de forma SUSTENTADA, publica um alerta e anexa uma
  // recomendação de governança REDIGIDA pela IA (propose-only: NÃO é executada — quem decide
  // rotacionar/mexer em stake é a governança/humano). A única mitigação automática é
  // operacional/reversível (roteamento de leitura do gateway). Ver [[eav7-ai-roadmap]].
  async #checkValidatorHealth() {
    let data;
    try { data = await this.#getJson('/validators'); } catch { return; }
    const perf = data.performance;
    const summary = data.performanceSummary;
    if (!Array.isArray(perf) || !summary || summary.count < 2) return; // sem garantia com <2 validadores

    const currentlyDegraded = new Set();
    for (const v of perf) {
      if (!v.degraded) continue;
      currentlyDegraded.add(v.address);
      const streak = (this.degradedStreak.get(v.address) ?? 0) + 1;
      this.degradedStreak.set(v.address, streak);
      if (streak >= this.degradedTicks && !this.alertedDegraded.has(v.address)) {
        this.alertedDegraded.add(v.address);
        const draft = draftValidatorGovernanceProposal(v, { sustainedTicks: streak });
        await this.alert('VALIDATOR_DEGRADED', 'warning',
          `validador ${v.address} degradado de forma sustentada (score ${v.score}/100, `
          + `produtividade ${v.productivityPct}%, ${v.missed} slots perdidos). `
          + `IA redigiu recomendação de governança (NÃO executada).`,
          { validator: v.address, score: v.score, status: v.status, draftProposal: draft });
      }
    }
    // Quem recuperou: zera o streak e, se havíamos alertado, publica a recuperação.
    for (const addr of [...this.degradedStreak.keys()]) {
      if (currentlyDegraded.has(addr)) continue;
      this.degradedStreak.delete(addr);
      if (this.alertedDegraded.delete(addr)) {
        await this.alert('VALIDATOR_RECOVERED', 'info',
          `validador ${addr} voltou a operar de forma saudável`, { validator: addr });
      }
    }
  }

  // Conselheiro de governança: o nó avalia parâmetros governáveis e redige rascunhos de
  // GOV_PROPOSE (propose-only). Publica cada advisory NOVO como alerta com o rascunho —
  // a IA propõe, os validadores votam. Dedup por param:valor; esquece quando o parâmetro
  // volta ao saudável (pode re-alertar depois). Ver [[eav7-ai-roadmap]].
  async #checkGovernanceAdvisories() {
    let data;
    try { data = await this.#getJson('/governance/advisories'); } catch { return; }
    const list = data.advisories;
    if (!Array.isArray(list)) return;
    const seen = new Set();
    for (const a of list) {
      const key = `${a.param}:${a.suggestedValue}`;
      seen.add(key);
      if (this.advisedKeys.has(key)) continue;
      this.advisedKeys.add(key);
      await this.alert('GOVERNANCE_ADVISORY', a.severity === 'warning' ? 'warning' : 'info',
        `IA redigiu proposta de governança: ${a.param} ${a.currentValue} → ${a.suggestedValue}. ${a.reason}`,
        { advisory: a });
    }
    for (const key of [...this.advisedKeys]) if (!seen.has(key)) this.advisedKeys.delete(key);
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
