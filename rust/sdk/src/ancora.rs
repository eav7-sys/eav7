//! Helpers de Âncora (planos 13/14 / T1.4).
//!
//! Não inventam tipos de consenso: só montam `PERMISSION_UPDATE` v2
//! (owner M-of-N + witness) e o payload de rotação de witness.

use eav7::config::PERM_DELAY_DEFAULT_BLOCKS;
use eav7::transaction::JsonValue;

use crate::wallet::ProductionWallet;

/// Material gerado offline para virar Âncora — owners frios + witness quente.
#[derive(Debug)]
pub struct AncoraPrep {
    /// Endereço da conta Âncora (= `owners[0]` no onboarding padrão).
    pub endereco: String,
    /// `(endereço, JSON da carteira)` — copiar OFFLINE; não vão ao VPS.
    pub owners: Vec<(String, String)>,
    /// Limiar owner (ex.: 2 num 2-de-3).
    pub threshold: u64,
    /// `(endereço, JSON)` — única chave que deve ficar no keystore do nó.
    pub witness: (String, String),
}

impl AncoraPrep {
    /// `data` de `PERMISSION_UPDATE` (v2) pronto para `Eav7Client::executar`.
    pub fn dados_permission_update(&self) -> JsonValue {
        dados_permission_update(
            &self
                .owners
                .iter()
                .map(|(a, _)| (a.as_str(), 1u64))
                .collect::<Vec<_>>(),
            self.threshold,
            &self.witness.0,
            None,
            PERM_DELAY_DEFAULT_BLOCKS,
        )
    }
}

/// Gera N owners + 1 witness. A conta Âncora é `owners[0]` (ainda single-sig
/// até aplicar `PERMISSION_UPDATE` assinado por ela).
pub fn ancora_preparar(n_owners: usize, threshold: u64) -> Result<AncoraPrep, String> {
    if n_owners < 2 {
        return Err("Âncora exige pelo menos 2 owners".into());
    }
    if threshold == 0 || threshold as usize > n_owners {
        return Err(format!("threshold inválido: {threshold} (owners={n_owners})"));
    }
    let mut owners = Vec::with_capacity(n_owners);
    for _ in 0..n_owners {
        owners.push(ProductionWallet::gerar()?);
    }
    let witness = ProductionWallet::gerar()?;
    Ok(AncoraPrep {
        endereco: owners[0].0.clone(),
        owners,
        threshold,
        witness,
    })
}

/// Monta o mapa `permission` de `PERMISSION_UPDATE` v2.
pub fn dados_permission_update(
    owners: &[(&str, u64)],
    owner_threshold: u64,
    witness: &str,
    recovery: Option<&str>,
    delay_blocks: u64,
) -> JsonValue {
    let keys = JsonValue::map(
        owners
            .iter()
            .map(|(a, w)| ((*a).to_string(), JsonValue::Int(*w as i64))),
    );
    let owner = JsonValue::map([
        ("threshold".into(), JsonValue::Int(owner_threshold as i64)),
        ("keys".into(), keys),
    ]);
    // Active mínima: a própria conta (ou primeira owner) com limiar 1 — uso cotidiano.
    let active_addr = owners[0].0;
    let active = JsonValue::map([
        ("threshold".into(), JsonValue::Int(1)),
        (
            "keys".into(),
            JsonValue::map([(active_addr.to_string(), JsonValue::Int(1))]),
        ),
    ]);
    let mut campos = vec![
        ("owner".to_string(), owner),
        ("active".to_string(), active),
        ("witness".to_string(), JsonValue::str(witness)),
        ("delayBlocks".to_string(), JsonValue::Int(delay_blocks as i64)),
    ];
    if let Some(r) = recovery {
        campos.push(("recovery".to_string(), JsonValue::str(r)));
    }
    JsonValue::map([("permission".to_string(), JsonValue::map(campos))])
}

/// Payload de `PERMISSION_PROPOSE` para trocar a witness (timelock owner).
///
/// `conta` = endereço Âncora (multisig); o `from` da tx é uma chave owner.
pub fn ancora_dados_rotate_witness(conta: &str, novo_witness: &str) -> JsonValue {
    JsonValue::map([
        ("account".to_string(), JsonValue::str(conta)),
        (
            "change".to_string(),
            JsonValue::map([
                ("level".to_string(), JsonValue::str("witness")),
                ("value".to_string(), JsonValue::str(novo_witness)),
            ]),
        ),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preparar_2_de_3_tem_witness_e_tres_owners() {
        let p = ancora_preparar(3, 2).expect("prep");
        assert_eq!(p.owners.len(), 3);
        assert_eq!(p.endereco, p.owners[0].0);
        assert_ne!(p.witness.0, p.endereco);
        let d = p.dados_permission_update();
        let JsonValue::Map(m) = d else { panic!("map") };
        assert!(m.contains_key("permission"));
    }

    #[test]
    fn threshold_invalido_e_recusado() {
        assert!(ancora_preparar(3, 0).is_err());
        assert!(ancora_preparar(3, 4).is_err());
        assert!(ancora_preparar(1, 1).is_err());
    }
}
