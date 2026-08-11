//! Faucet de TESTNET — o porte de `FaucetService` (`src/sdk/faucet.js`).
//!
//! Dispensa EAV7 de teste com intervalo mínimo por endereço. É ferramental de
//! rede de testes; num ambiente de produção não deveria existir, e por isso o
//! serviço que o expõe exige um opt-in explícito do operador.
//!
//! O relógio entra por parâmetro, e não é lido aqui: um serviço com relógio
//! implícito é um serviço que só dá para testar esperando de verdade.

use std::collections::BTreeMap;

/// Controle de intervalo entre saques.
#[derive(Debug)]
pub struct Faucet {
    quantia: u128,
    intervalo_ms: u64,
    /// endereço → instante do último saque.
    ultimo: BTreeMap<String, u64>,
}

impl Faucet {
    pub fn novo(quantia: u128, intervalo_ms: u64) -> Self {
        Faucet { quantia, intervalo_ms, ultimo: BTreeMap::new() }
    }

    pub fn quantia(&self) -> u128 {
        self.quantia
    }

    /// Quanto FALTA (ms) até o endereço poder sacar de novo. Zero = liberado.
    pub fn espera_restante(&self, endereco: &str, agora_ms: u64) -> u64 {
        let Some(&anterior) = self.ultimo.get(endereco) else {
            return 0;
        };
        // `saturating_sub` nos dois sentidos: um relógio que ande para trás (NTP,
        // suspensão da máquina) não pode virar uma espera gigante nem um pânico.
        self.intervalo_ms.saturating_sub(agora_ms.saturating_sub(anterior))
    }

    /// Registra um saque, se o intervalo permitir.
    ///
    /// Devolve `Err` com a espera restante — quem chama transforma isso na
    /// resposta HTTP. O registro acontece ANTES de o valor ser enviado: em caso de
    /// falha no envio, o pior desfecho é o usuário esperar um intervalo a mais, e
    /// não a torneira ser drenada por tentativas repetidas.
    pub fn sacar(&mut self, endereco: &str, agora_ms: u64) -> Result<u128, u64> {
        let falta = self.espera_restante(endereco, agora_ms);
        if falta > 0 {
            return Err(falta);
        }
        self.ultimo.insert(endereco.to_string(), agora_ms);
        Ok(self.quantia)
    }

    /// Remove os registros já vencidos.
    ///
    /// Sem isto o mapa cresce sem teto — um endereço novo por pedido é gratuito, e
    /// o faucet ficaria com uma entrada para cada um deles para sempre.
    pub fn podar(&mut self, agora_ms: u64) {
        self.ultimo
            .retain(|_, quando| agora_ms.saturating_sub(*quando) < self.intervalo_ms);
    }

    /// Quantos endereços em espera — para o `/status` do serviço.
    pub fn em_espera(&self) -> usize {
        self.ultimo.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HORA: u64 = 3_600_000;

    #[test]
    fn respeita_o_intervalo_por_endereco() {
        let mut f = Faucet::novo(100, HORA);
        assert_eq!(f.sacar("E7A", 0), Ok(100));
        assert_eq!(f.sacar("E7A", 1_000), Err(HORA - 1_000), "ainda em espera");
        // Outro endereço não é afetado.
        assert_eq!(f.sacar("E7B", 1_000), Ok(100));
        // Passado o intervalo, libera.
        assert_eq!(f.sacar("E7A", HORA), Ok(100));
    }

    /// Relógio que ANDA PARA TRÁS não pode virar espera gigante nem pânico.
    /// Acontece de verdade: ajuste de NTP, máquina suspensa.
    #[test]
    fn relogio_para_tras_nao_quebra() {
        let mut f = Faucet::novo(100, HORA);
        assert_eq!(f.sacar("E7A", 10_000), Ok(100));
        // Agora o relógio "volta" — a espera é no máximo o intervalo, nunca mais.
        assert_eq!(f.espera_restante("E7A", 0), HORA);
        assert!(f.sacar("E7A", 0).is_err());
    }

    /// A poda evita crescimento sem teto: endereço novo por pedido é de graça.
    #[test]
    fn poda_remove_os_vencidos_e_mantem_os_em_espera() {
        let mut f = Faucet::novo(100, HORA);
        f.sacar("E7VELHO", 0).expect("saque");
        f.sacar("E7NOVO", HORA).expect("saque");
        assert_eq!(f.em_espera(), 2);

        f.podar(HORA + 1);
        assert_eq!(f.em_espera(), 1, "o vencido sai, o em espera fica");
        assert_eq!(f.espera_restante("E7VELHO", HORA + 1), 0, "e volta a poder sacar");
    }
}
