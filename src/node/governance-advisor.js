import { CHAIN } from '../config.js';

// Conselheiro de governança — a IA REDIGE propostas, a GOVERNANÇA decide.
//
// Avalia regras de saúde DETERMINÍSTICAS sobre os parâmetros GOVERNÁVEIS e, quando um
// parâmetro está fora de uma faixa saudável dada a condição atual da rede, redige um
// rascunho de `GOV_PROPOSE` — com valor sugerido, motivo e evidência on-chain. É
// PROPOSE-ONLY (`autonomous:false`): quem submete e aprova é um validador/humano via
// governança on-chain (2/3+1). A IA nunca altera parâmetro sozinha. Mesma linha de
// segurança do score de validador e do gateway ([[eav7-ai-roadmap]]).
//
// Função PURA (testável): recebe os valores efetivos dos governáveis + estatísticas da
// cadeia e devolve a lista de advisories (vazia quando tudo está saudável).
export function adviseGovernance({ params, stats }) {
  const advisories = [];
  const P = params;
  const cap = (name) => CHAIN.GOVERNABLE[name]?.max;
  const floor = (name) => CHAIN.GOVERNABLE[name]?.min;

  // Regra 1 — slots de validador sub-provisionados: há mais candidatos ELEGÍVEIS do que
  // slots. Elevar MAX_VALIDATORS admite os que estão de fora → mais descentralização/BFT.
  if (Number.isFinite(stats.eligibleValidators)
      && stats.eligibleValidators > P.MAX_VALIDATORS
      && P.MAX_VALIDATORS < cap('MAX_VALIDATORS')) {
    const suggested = Math.min(stats.eligibleValidators, cap('MAX_VALIDATORS'));
    advisories.push(draft('MAX_VALIDATORS', P.MAX_VALIDATORS, suggested,
      `Há ${stats.eligibleValidators} candidatos elegíveis (self-stake ≥ mínimo) para apenas `
      + `${P.MAX_VALIDATORS} slots. Elevar MAX_VALIDATORS para ${suggested} admite mais validadores `
      + `— mais descentralização e segurança BFT.`,
      { eligibleValidators: stats.eligibleValidators, slots: P.MAX_VALIDATORS, cap: cap('MAX_VALIDATORS') }));
  }

  // Regra 2 — finalidade BFT em risco: validadores ativos abaixo do mínimo de finalidade.
  // Sinaliza (a rede não finaliza) e, se o stake mínimo dá margem, sugere reduzi-lo para
  // onboarding — SEMPRE com ressalva de revisão humana (reduzir stake afeta segurança).
  if (Number.isFinite(stats.activeValidators)
      && Number.isFinite(stats.finalityMinValidators)
      && stats.activeValidators < stats.finalityMinValidators) {
    const cur = P.MIN_VALIDATOR_STAKE;
    const lowered = cur / 2n > BigInt(floor('MIN_VALIDATOR_STAKE') ?? 1n) ? cur / 2n : cur;
    advisories.push(draft('MIN_VALIDATOR_STAKE', cur, lowered,
      `Apenas ${stats.activeValidators} validadores ativos; a finalidade BFT exige `
      + `${stats.finalityMinValidators}. A rede pode não estar finalizando. Reduzir o stake mínimo `
      + `pode admitir mais validadores. REVISAR com cuidado — reduzir stake mínimo baixa a barreira `
      + `de Sybil; considere também incentivar mais operadores.`,
      { activeValidators: stats.activeValidators, finalityMinValidators: stats.finalityMinValidators },
      'warning'));
  }

  // Regra 3 — circuit breaker da ponte bloqueando volume (SÓ quando ativo). Enquanto o
  // breaker está dormente (fork distante), não dispara. Pronto para quando ativar.
  if (stats.bridge?.breakerActive && Number(stats.bridge.breakerTripsWindow) >= 3
      && P.BRIDGE_BREAKER_BPS < cap('BRIDGE_BREAKER_BPS')) {
    const suggested = Math.min(P.BRIDGE_BREAKER_BPS + 1000, cap('BRIDGE_BREAKER_BPS'));
    advisories.push(draft('BRIDGE_BREAKER_BPS', P.BRIDGE_BREAKER_BPS, suggested,
      `O circuit breaker da ponte disparou ${stats.bridge.breakerTripsWindow}x na janela recente, o que `
      + `pode estar bloqueando volume legítimo. Elevar BRIDGE_BREAKER_BPS para ${suggested} afrouxa o `
      + `limite. REVISAR: só se o volume for legítimo — se for ataque, mantenha o limite.`,
      { breakerTripsWindow: stats.bridge.breakerTripsWindow }));
  }

  return advisories;
}

function draft(param, current, suggested, reason, evidence, severity = 'info') {
  return {
    kind: 'GOVERNANCE_PARAM_ADVISORY',
    autonomous: false, // a IA NÃO submete — governança on-chain (validadores 2/3+1) decide
    param,
    currentValue: typeof current === 'bigint' ? current.toString() : current,
    suggestedValue: typeof suggested === 'bigint' ? suggested.toString() : suggested,
    severity,
    reason,
    evidence,
    // Rascunho pronto para um validador assinar/submeter (falta from/nonce/assinatura).
    draftTx: { type: 'GOV_PROPOSE', data: { param, value: typeof suggested === 'bigint' ? suggested.toString() : suggested } },
  };
}
