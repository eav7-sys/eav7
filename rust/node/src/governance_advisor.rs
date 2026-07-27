//! Conselheiro de governança — a IA REDIGE propostas, a GOVERNANÇA decide.
//!
//! Avalia regras de saúde DETERMINÍSTICAS sobre os parâmetros GOVERNÁVEIS e, quando um
//! parâmetro está fora de uma faixa saudável dada a condição atual da rede, redige um
//! rascunho de `GOV_PROPOSE` — com valor sugerido, motivo e evidência on-chain. É
//! PROPOSE-ONLY (`autonomous: false`): quem submete e aprova é um validador/humano via
//! governança on-chain (2/3+1). A IA nunca altera parâmetro sozinha. Mesma linha de
//! segurança do score de validador e do gateway (ver `eav7-ai-roadmap`).
//!
//! Função PURA (testável): recebe os valores efetivos dos governáveis + estatísticas
//! da cadeia e devolve a lista de advisories (vazia quando tudo está saudável). NÃO lê
//! estado, relógio nem rede.

use eav7::state::gov::governable_bounds;
use eav7::transaction::JsonValue;

/// Severidade de um advisory. `Info` é sugestão de melhoria; `Warning` sinaliza risco
/// (ex.: finalidade BFT ameaçada) e sempre acompanha ressalva de revisão humana.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Info,
    Warning,
}

impl Severity {
    pub fn as_str(&self) -> &'static str {
        match self {
            Severity::Info => "info",
            Severity::Warning => "warning",
        }
    }
}

/// Valores EFETIVOS dos parâmetros governáveis que o conselheiro observa. Vêm de
/// `state.params` (override) ou do default — a camada de nó os resolve por
/// `eav7::state::gov` antes de chamar aqui.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GovParams {
    pub max_validators: u64,
    /// Monetário: passa de 2⁶⁴, por isso `u128`.
    pub min_validator_stake: u128,
    pub bridge_breaker_bps: u64,
}

/// Estatísticas da ponte para a Regra 3 (só dispara com o breaker ATIVO).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BridgeStats {
    pub breaker_active: bool,
    pub breaker_trips_window: u64,
}

/// Estatísticas da cadeia. Os `Option` reproduzem o `Number.isFinite(...)` do JS:
/// `None` = a métrica não está disponível e a regra que a usa não dispara.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GovStats {
    pub eligible_validators: Option<u64>,
    pub active_validators: Option<u64>,
    pub finality_min_validators: Option<u64>,
    pub bridge: Option<BridgeStats>,
}

/// Um rascunho de proposta de governança. `autonomous` é SEMPRE `false` — o tipo não
/// deixa representável um advisory que a IA executaria sozinha.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Advisory {
    pub kind: &'static str,
    pub autonomous: bool,
    pub param: String,
    /// Valores como TEXTO decimal, como o JS os emite (`.toString()` no bigint).
    pub current_value: String,
    pub suggested_value: String,
    pub severity: Severity,
    pub reason: String,
    /// Evidência on-chain, pares chave→valor. `JsonValue` para o transporte serializar
    /// direto, sem uma struct por regra.
    pub evidence: Vec<(String, JsonValue)>,
    /// Rascunho pronto para um validador assinar/submeter (falta from/nonce/assinatura):
    /// `{ type: "GOV_PROPOSE", data: { param, value } }`.
    pub draft_tx: JsonValue,
}

fn draft(
    param: &str,
    current: String,
    suggested: String,
    reason: String,
    evidence: Vec<(String, JsonValue)>,
    severity: Severity,
) -> Advisory {
    let draft_tx = JsonValue::map([
        ("type".to_string(), JsonValue::str("GOV_PROPOSE")),
        (
            "data".to_string(),
            JsonValue::map([
                ("param".to_string(), JsonValue::str(param)),
                // O rascunho carrega o valor como TEXTO, como o JS (`.toString()`).
                ("value".to_string(), JsonValue::str(suggested.clone())),
            ]),
        ),
    ]);
    Advisory {
        kind: "GOVERNANCE_PARAM_ADVISORY",
        autonomous: false, // a IA NÃO submete — governança on-chain (validadores 2/3+1) decide
        param: param.to_string(),
        current_value: current,
        suggested_value: suggested,
        severity,
        reason,
        evidence,
        draft_tx,
    }
}

fn cap(param: &str) -> Option<i128> {
    governable_bounds(param).map(|(_, max)| max)
}
fn floor(param: &str) -> Option<i128> {
    governable_bounds(param).map(|(min, _)| min)
}

/// Avalia as regras de saúde e devolve os advisories (vazio = tudo saudável).
pub fn advise_governance(params: &GovParams, stats: &GovStats) -> Vec<Advisory> {
    let mut advisories = Vec::new();

    // Regra 1 — slots de validador sub-provisionados: há mais candidatos ELEGÍVEIS do
    // que slots. Elevar MAX_VALIDATORS admite os que estão de fora → mais
    // descentralização/BFT.
    if let (Some(eligiveis), Some(teto)) = (stats.eligible_validators, cap("MAX_VALIDATORS")) {
        let teto = teto.max(0) as u64;
        if eligiveis > params.max_validators && params.max_validators < teto {
            let sugerido = eligiveis.min(teto);
            advisories.push(draft(
                "MAX_VALIDATORS",
                params.max_validators.to_string(),
                sugerido.to_string(),
                format!(
                    "Há {eligiveis} candidatos elegíveis (self-stake ≥ mínimo) para apenas \
                     {} slots. Elevar MAX_VALIDATORS para {sugerido} admite mais validadores \
                     — mais descentralização e segurança BFT.",
                    params.max_validators
                ),
                vec![
                    ("eligibleValidators".into(), JsonValue::Int(eligiveis as i64)),
                    ("slots".into(), JsonValue::Int(params.max_validators as i64)),
                    ("cap".into(), JsonValue::Int(teto as i64)),
                ],
                Severity::Info,
            ));
        }
    }

    // Regra 2 — finalidade BFT em risco: validadores ativos abaixo do mínimo de
    // finalidade. Sinaliza (a rede não finaliza) e, se o stake mínimo dá margem, sugere
    // reduzi-lo para onboarding — SEMPRE com ressalva de revisão humana (reduzir stake
    // afeta segurança).
    if let (Some(ativos), Some(min_final)) = (stats.active_validators, stats.finality_min_validators)
        && ativos < min_final
    {
        let cur = params.min_validator_stake;
        // `cur / 2n > floor ? cur / 2n : cur` — só reduz se a metade ainda respeita
        // o piso governável; senão mantém (não sugere abaixo do permitido).
        let piso = floor("MIN_VALIDATOR_STAKE").unwrap_or(1).max(0) as u128;
        let reduzido = if cur / 2 > piso { cur / 2 } else { cur };
        advisories.push(draft(
            "MIN_VALIDATOR_STAKE",
            cur.to_string(),
            reduzido.to_string(),
            format!(
                "Apenas {ativos} validadores ativos; a finalidade BFT exige {min_final}. A \
                 rede pode não estar finalizando. Reduzir o stake mínimo pode admitir mais \
                 validadores. REVISAR com cuidado — reduzir stake mínimo baixa a barreira de \
                 Sybil; considere também incentivar mais operadores."
            ),
            vec![
                ("activeValidators".into(), JsonValue::Int(ativos as i64)),
                ("finalityMinValidators".into(), JsonValue::Int(min_final as i64)),
            ],
            Severity::Warning,
        ));
    }

    // Regra 3 — circuit breaker da ponte bloqueando volume (SÓ quando ativo). Enquanto o
    // breaker está dormente (fork distante), não dispara. Pronto para quando ativar.
    if let (Some(bridge), Some(teto)) = (stats.bridge.as_ref(), cap("BRIDGE_BREAKER_BPS")) {
        let teto = teto.max(0) as u64;
        if bridge.breaker_active
            && bridge.breaker_trips_window >= 3
            && params.bridge_breaker_bps < teto
        {
            let sugerido = (params.bridge_breaker_bps + 1000).min(teto);
            advisories.push(draft(
                "BRIDGE_BREAKER_BPS",
                params.bridge_breaker_bps.to_string(),
                sugerido.to_string(),
                format!(
                    "O circuit breaker da ponte disparou {}x na janela recente, o que pode estar \
                     bloqueando volume legítimo. Elevar BRIDGE_BREAKER_BPS para {sugerido} afrouxa \
                     o limite. REVISAR: só se o volume for legítimo — se for ataque, mantenha o \
                     limite.",
                    bridge.breaker_trips_window
                ),
                vec![(
                    "breakerTripsWindow".into(),
                    JsonValue::Int(bridge.breaker_trips_window as i64),
                )],
                Severity::Info,
            ));
        }
    }

    advisories
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> GovParams {
        GovParams { max_validators: 21, min_validator_stake: 1_000_000_000, bridge_breaker_bps: 500 }
    }

    #[test]
    fn tudo_saudavel_nao_gera_advisory() {
        let p = params();
        let s = GovStats {
            eligible_validators: Some(10), // menos que os 21 slots
            active_validators: Some(5),
            finality_min_validators: Some(3), // 5 >= 3, ok
            bridge: None,
        };
        assert!(advise_governance(&p, &s).is_empty());
    }

    #[test]
    fn regra1_slots_subprovisionados() {
        let p = params();
        let s = GovStats { eligible_validators: Some(30), ..Default::default() };
        let a = advise_governance(&p, &s);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].param, "MAX_VALIDATORS");
        // O teto governável de MAX_VALIDATORS é 101; 30 < 101, então sugere 30.
        assert_eq!(a[0].suggested_value, "30");
        assert_eq!(a[0].severity, Severity::Info);
    }

    #[test]
    fn regra1_respeita_o_teto_governavel() {
        let p = params();
        // Mais elegíveis que o teto (101) → sugere o teto, não o número de elegíveis.
        let s = GovStats { eligible_validators: Some(500), ..Default::default() };
        let a = advise_governance(&p, &s);
        assert_eq!(a[0].suggested_value, "101");
    }

    #[test]
    fn regra1_nao_dispara_quando_ja_no_teto() {
        let mut p = params();
        p.max_validators = 101; // já no teto
        let s = GovStats { eligible_validators: Some(500), ..Default::default() };
        assert!(advise_governance(&p, &s).is_empty());
    }

    #[test]
    fn regra1_metrica_indisponivel_nao_dispara() {
        let p = params();
        let s = GovStats { eligible_validators: None, ..Default::default() };
        assert!(advise_governance(&p, &s).is_empty());
    }

    #[test]
    fn regra2_finalidade_em_risco_sugere_metade() {
        let p = params(); // min_validator_stake = 1_000_000_000
        let s = GovStats {
            active_validators: Some(2),
            finality_min_validators: Some(3),
            ..Default::default()
        };
        let a = advise_governance(&p, &s);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].param, "MIN_VALIDATOR_STAKE");
        assert_eq!(a[0].suggested_value, "500000000"); // metade
        assert_eq!(a[0].severity, Severity::Warning);
    }

    #[test]
    fn regra2_nao_sugere_abaixo_do_piso() {
        let mut p = params();
        // Piso governável de MIN_VALIDATOR_STAKE é 1. Com stake = 1, metade (0) não
        // supera o piso → mantém o valor atual em vez de sugerir abaixo do permitido.
        p.min_validator_stake = 1;
        let s = GovStats {
            active_validators: Some(1),
            finality_min_validators: Some(3),
            ..Default::default()
        };
        let a = advise_governance(&p, &s);
        assert_eq!(a[0].suggested_value, "1", "não desce abaixo do piso");
    }

    #[test]
    fn regra3_breaker_dispara_so_ativo() {
        let p = params();
        // Ativo e disparou 3x → advisory.
        let s = GovStats {
            bridge: Some(BridgeStats { breaker_active: true, breaker_trips_window: 3 }),
            ..Default::default()
        };
        let a = advise_governance(&p, &s);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].param, "BRIDGE_BREAKER_BPS");
        assert_eq!(a[0].suggested_value, "1500"); // 500 + 1000

        // Dormente → nada, mesmo com trips altos.
        let s = GovStats {
            bridge: Some(BridgeStats { breaker_active: false, breaker_trips_window: 10 }),
            ..Default::default()
        };
        assert!(advise_governance(&p, &s).is_empty());
    }

    #[test]
    fn draft_tx_e_propose_only() {
        let p = params();
        let s = GovStats { eligible_validators: Some(30), ..Default::default() };
        let a = advise_governance(&p, &s);
        assert!(!a[0].autonomous, "advisory nunca é autônomo");
        // O rascunho tem o formato { type: GOV_PROPOSE, data: { param, value } }.
        let JsonValue::Map(m) = &a[0].draft_tx else { panic!("draft_tx deve ser mapa") };
        assert_eq!(m.get("type"), Some(&JsonValue::str("GOV_PROPOSE")));
    }
}
