//! Conversão EAV7 legível ↔ e7 (6 casas), espelho de `eav7-cli` / config.js.

use eav7::config::UNIT;

/// "12.5" → 12_500_000. Aceita `.` ou `,`.
pub fn eav7_to_e7(text: &str, campo: &str) -> Result<u128, String> {
    let t = text.trim();
    let (inteiro, fracao) = match t.split_once(['.', ',']) {
        Some((i, f)) => (i, Some(f)),
        None => (t, None),
    };
    if inteiro.is_empty() || !inteiro.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("{campo} inválido: {text} (use até 6 casas decimais)"));
    }
    let fracao = match fracao {
        Some(f) if f.is_empty() || f.len() > 6 || !f.bytes().all(|b| b.is_ascii_digit()) => {
            return Err(format!("{campo} inválido: {text} (use até 6 casas decimais)"));
        }
        Some(f) => f.to_string(),
        None => String::new(),
    };
    let base: u128 = inteiro
        .parse()
        .map_err(|_| format!("{campo} inválido (grande demais): {text}"))?;
    let mut valor = base
        .checked_mul(UNIT)
        .ok_or_else(|| format!("{campo}: valor grande demais"))?;
    if !fracao.is_empty() {
        let mut casas = fracao;
        while casas.len() < 6 {
            casas.push('0');
        }
        let frac_val: u128 = casas
            .parse()
            .map_err(|_| format!("{campo} inválido: {text}"))?;
        valor = valor
            .checked_add(frac_val)
            .ok_or_else(|| format!("{campo}: valor grande demais"))?;
    }
    Ok(valor)
}

pub fn format_eav7(e7: u128) -> String {
    let whole = e7 / UNIT;
    let frac = e7 % UNIT;
    if frac == 0 {
        return whole.to_string();
    }
    let mut casas = format!("{frac:06}");
    while casas.ends_with('0') {
        casas.pop();
    }
    format!("{whole}.{casas}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eav7_to_e7_basico() {
        assert_eq!(eav7_to_e7("12.5", "v").unwrap(), 12_500_000);
        assert_eq!(eav7_to_e7("1", "v").unwrap(), 1_000_000);
        assert_eq!(eav7_to_e7("0.000001", "v").unwrap(), 1);
        assert_eq!(eav7_to_e7("3,25", "v").unwrap(), 3_250_000);
        assert!(eav7_to_e7("1.2345678", "v").is_err());
    }

    #[test]
    fn format_tira_zeros() {
        assert_eq!(format_eav7(1_000_000), "1");
        assert_eq!(format_eav7(12_500_000), "12.5");
        assert_eq!(format_eav7(1), "0.000001");
    }
}
