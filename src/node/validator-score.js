// Score de desempenho de validador — OBSERVACIONAL e OPERACIONAL, FORA do consenso.
//
// Deriva de dados já on-chain (produtor + timestamp de cada bloco) quem está cumprindo
// os slots do rodízio DPoS (`validadores[slot % N]`) e quem está lento/faltando. NÃO lê
// nem altera estado, stake ou blocos — é só leitura da cadeia. A camada de IA usa o score
// para duas coisas, respeitando a linha de segurança ([[eav7-ai-roadmap]]):
//   (a) OPERACIONAL/reversível — o gateway roteia as leituras públicas para o peer mais
//       saudável (GatewayHealth), então um validador degradado não sobrecarrega o serviço;
//   (b) PROPOSE-ONLY — a IA REDIGE uma recomendação de governança sobre um validador
//       cronicamente ruim; quem decide rotacionar/mexer em stake é a GOVERNANÇA (validadores
//       votam) ou um humano. A IA jamais remove validador nem toca stake sozinha.

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

// Pontua cada validador numa JANELA de blocos recentes. Função PURA (testável):
//   validators : [{address, staked}] na ORDEM do rodízio (a mesma de state.validators())
//   blocks     : [{height, producer, timestamp}] em ordem crescente de altura
//   blockTimeMs: CHAIN.BLOCK_TIME_MS (duração do slot)
export function scoreValidators({ validators, blocks, blockTimeMs, laggingBelow = 85, degradedBelow = 50 }) {
  const N = validators.length;
  const order = validators.map((v) => v.address);
  const stats = new Map();
  for (const v of validators) {
    stats.set(v.address, {
      address: v.address,
      staked: typeof v.staked === 'bigint' ? v.staked.toString() : String(v.staked ?? '0'),
      expected: 0, inTurn: 0, produced: 0, missed: 0, outOfTurn: 0,
      latencySum: 0, latencyCount: 0, lastProducedHeight: null, lastProducedAt: null,
    });
  }

  const finalize = () => {
    const list = [];
    for (const s of stats.values()) {
      const productivity = s.expected > 0 ? s.inTurn / s.expected : 1; // fração dos PRÓPRIOS slots cumpridos
      const avgLatencyMs = s.latencyCount > 0 ? Math.round(s.latencySum / s.latencyCount) : null;
      // Fator de latência: bloco no início do slot → 1.0; perto do fim → até -50%.
      const latFactor = avgLatencyMs == null ? 1 : clamp(1 - (avgLatencyMs / blockTimeMs) * 0.5, 0.5, 1);
      const score = s.expected > 0 ? Math.round(100 * productivity * latFactor) : 100;
      let status;
      if (s.expected > 0 && s.produced === 0) status = 'offline';
      else if (score < degradedBelow) status = 'degraded';
      else if (score < laggingBelow) status = 'lagging';
      else status = 'healthy';
      list.push({
        address: s.address, staked: s.staked,
        score, status, degraded: status === 'degraded' || status === 'offline',
        productivityPct: Math.round(productivity * 100),
        expected: s.expected, produced: s.produced, inTurn: s.inTurn,
        missed: s.missed, outOfTurn: s.outOfTurn,
        avgLatencyMs, lastProducedHeight: s.lastProducedHeight, lastProducedAt: s.lastProducedAt,
      });
    }
    return list;
  };

  if (N === 0 || blocks.length === 0) {
    const out = finalize();
    return { window: { blocks: 0, fromHeight: null, toHeight: null }, validators: out, summary: summarize(out) };
  }

  const slotOf = (ts) => Math.floor(ts / blockTimeMs);
  const bySlot = new Map();
  for (const b of blocks) bySlot.set(slotOf(b.timestamp), b); // 1 bloco por slot (regra de consenso)
  const firstSlot = slotOf(blocks[0].timestamp);
  const lastSlot = slotOf(blocks[blocks.length - 1].timestamp);

  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    const expected = order[((slot % N) + N) % N];
    const es = stats.get(expected);
    if (es) es.expected += 1;
    const b = bySlot.get(slot);
    if (!b) { if (es) es.missed += 1; continue; } // slot vazio = o produtor esperado faltou
    const ps = stats.get(b.producer);
    if (ps) {
      ps.produced += 1;
      ps.lastProducedHeight = b.height;
      ps.lastProducedAt = b.timestamp;
      const lat = b.timestamp - slot * blockTimeMs;
      if (lat >= 0) { ps.latencySum += lat; ps.latencyCount += 1; }
    }
    if (b.producer === expected) { if (es) es.inTurn += 1; }
    else if (ps) ps.outOfTurn += 1;
  }

  const out = finalize();
  return {
    window: { blocks: blocks.length, fromHeight: blocks[0].height, toHeight: blocks[blocks.length - 1].height },
    validators: out,
    summary: summarize(out),
  };
}

function summarize(list) {
  if (list.length === 0) return { count: 0, healthy: 0, degraded: 0, avgScore: null, worst: null, degradedAddresses: [] };
  const degraded = list.filter((v) => v.degraded);
  const avg = Math.round(list.reduce((a, v) => a + v.score, 0) / list.length);
  const worst = list.reduce((w, v) => (w == null || v.score < w.score ? v : w), null);
  return {
    count: list.length,
    healthy: list.filter((v) => v.status === 'healthy').length,
    degraded: degraded.length,
    degradedAddresses: degraded.map((v) => v.address),
    avgScore: avg,
    worst: worst ? { address: worst.address, score: worst.score, status: worst.status } : null,
  };
}

// Redige (NÃO submete) uma recomendação de governança para um validador cronicamente
// degradado. PROPOSE-ONLY: `autonomous:false`. Entrega o rascunho + a evidência on-chain;
// a decisão de rotacionar/mexer em stake é da GOVERNANÇA (validadores votam via GOV_PROPOSE)
// ou de um humano. A mitigação que a IA JÁ aplica sozinha é apenas operacional/reversível
// (rotear leitura do gateway para longe do degradado). Ver [[eav7-ai-roadmap]].
export function draftValidatorGovernanceProposal(v, { sustainedTicks = null } = {}) {
  return {
    kind: 'VALIDATOR_ROTATION_REVIEW',
    autonomous: false, // a IA NÃO executa — só recomenda
    target: v.address,
    evidence: {
      score: v.score, status: v.status, productivityPct: v.productivityPct,
      inTurn: v.inTurn, expected: v.expected, missed: v.missed,
      avgLatencyMs: v.avgLatencyMs, lastProducedHeight: v.lastProducedHeight, sustainedTicks,
    },
    recommendation:
      `Validador ${v.address} está ${v.status} (score ${v.score}/100, produtividade ${v.productivityPct}% ` +
      `em ${v.expected} slots atribuídos, ${v.missed} perdidos). Recomenda-se à GOVERNANÇA revisar: os ` +
      `delegadores podem redirecionar votos/stake para validadores saudáveis, ou abrir GOV_PROPOSE para ` +
      `reavaliação. A IA NÃO remove validador nem mexe em stake — apenas recomenda e roteia leitura pública ` +
      `para longe do nó degradado (operacional e reversível).`,
    operationalMitigation: 'gateway-read-routing-away-from-degraded',
  };
}
