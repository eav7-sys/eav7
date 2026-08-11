//! Formatação monetária (e7 ↔ texto legível) — espelho de `formatEav7` em
//! `src/config.js`. Uma única implementação no crate de consenso evita as
//! cópias divergentes que já geraram bug de unidade (G17).

use crate::config::UNIT;

/// `e7` → texto decimal sem zeros à direita na fração (`16`, `2.5`, `0.000001`).
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
    fn espelha_o_js() {
        assert_eq!(format_eav7(0), "0");
        assert_eq!(format_eav7(16_000_000), "16");
        assert_eq!(format_eav7(2_500_000), "2.5");
        assert_eq!(format_eav7(1), "0.000001");
        assert_eq!(format_eav7(1_000_001), "1.000001");
    }
}
