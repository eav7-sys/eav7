//! `core.json` — configuração gravada por `eav7-core init`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const ARQUIVO: &str = "core.json";
pub const CARTEIRA: &str = "validator-wallet.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Modo {
    Listen,
    Candidate,
    Validator,
}

impl Modo {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.to_ascii_lowercase().as_str() {
            "listen" | "ouvinte" => Ok(Self::Listen),
            "candidate" | "candidato" => Ok(Self::Candidate),
            "validator" | "validador" => Ok(Self::Validator),
            outro => Err(format!(
                "modo desconhecido: {outro} (use listen|candidate|validator)"
            )),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Listen => "listen",
            Self::Candidate => "candidate",
            Self::Validator => "validator",
        }
    }

    /// Modos que passam `--validator` ao eav7-node (podem produzir se eleitos).
    pub fn usa_carteira(&self) -> bool {
        !matches!(self, Self::Listen)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreConfig {
    pub mode: Modo,
    pub data_dir: PathBuf,
    pub port: u16,
    pub host: String,
    pub peers: Vec<String>,
    /// Relativo a `data_dir` ou absoluto.
    pub validator_wallet: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genesis_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub genesis_file: Option<PathBuf>,
    #[serde(default)]
    pub allow_private_peers: bool,
    /// URL pública deste nó na malha P2P (ex. http://10.10.10.11:6070).
    /// Sem isto o nó anuncia 127.0.0.1 e os peers divergem.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub self_url: Option<String>,
}

impl CoreConfig {
    pub fn caminho(dir: &Path) -> PathBuf {
        dir.join(ARQUIVO)
    }

    pub fn carregar(dir: &Path) -> Result<Self, String> {
        let path = Self::caminho(dir);
        let cru = std::fs::read_to_string(&path)
            .map_err(|e| format!("não li {}: {e} — rode `eav7-core init` primeiro", path.display()))?;
        let mut cfg: Self = serde_json::from_str(&cru)
            .map_err(|e| format!("core.json inválido: {e}"))?;
        // data_dir canônico = diretório onde está o arquivo (permite mover a pasta).
        cfg.data_dir = dir.to_path_buf();
        Ok(cfg)
    }

    pub fn gravar(&self, dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(dir).map_err(|e| format!("criar {}: {e}", dir.display()))?;
        let path = Self::caminho(dir);
        let mut clone = self.clone();
        clone.data_dir = dir.to_path_buf();
        let json = serde_json::to_string_pretty(&clone)
            .map_err(|e| format!("serializar core.json: {e}"))?;
        std::fs::write(&path, format!("{json}\n"))
            .map_err(|e| format!("gravar {}: {e}", path.display()))?;
        Ok(())
    }

    pub fn caminho_carteira(&self) -> PathBuf {
        if self.validator_wallet.is_absolute() {
            self.validator_wallet.clone()
        } else {
            self.data_dir.join(&self.validator_wallet)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_json() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = CoreConfig {
            mode: Modo::Listen,
            data_dir: dir.path().to_path_buf(),
            port: 6070,
            host: "127.0.0.1".into(),
            peers: vec!["http://127.0.0.1:6071".into()],
            validator_wallet: PathBuf::from(CARTEIRA),
            genesis_hash: None,
            genesis_file: None,
            allow_private_peers: true,
            self_url: None,
        };
        cfg.gravar(dir.path()).unwrap();
        let lido = CoreConfig::carregar(dir.path()).unwrap();
        assert_eq!(lido.mode, Modo::Listen);
        assert_eq!(lido.port, 6070);
        assert_eq!(lido.peers.len(), 1);
        assert!(lido.allow_private_peers);
    }
}
