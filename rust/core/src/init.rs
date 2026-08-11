//! `eav7-core init` — gera carteira híbrida + core.json.

use crate::config::{CoreConfig, Modo, CARTEIRA};
use eav7_sdk::ProductionWallet;
use std::path::{Path, PathBuf};

pub struct InitArgs {
    pub dir: PathBuf,
    pub mode: Modo,
    pub port: u16,
    pub host: String,
    pub peers: Vec<String>,
    pub force: bool,
    pub allow_private_peers: bool,
    pub genesis_hash: Option<String>,
    pub genesis_file: Option<PathBuf>,
}

pub fn executar(args: InitArgs) -> Result<(), String> {
    let dir = args.dir;
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar {}: {e}", dir.display()))?;

    let cfg_path = CoreConfig::caminho(&dir);
    let wallet_path = dir.join(CARTEIRA);
    if !args.force && (cfg_path.exists() || wallet_path.exists()) {
        return Err(format!(
            "{} já inicializado (core.json ou carteira existem). Use --force para sobrescrever.",
            dir.display()
        ));
    }

    let (endereco, json) = ProductionWallet::gerar()?;
    escrever_restrito(&wallet_path, &json)?;

    let cfg = CoreConfig {
        mode: args.mode,
        data_dir: dir.clone(),
        port: args.port,
        host: args.host,
        peers: args.peers,
        validator_wallet: PathBuf::from(CARTEIRA),
        genesis_hash: args.genesis_hash,
        genesis_file: args.genesis_file,
        allow_private_peers: args.allow_private_peers,
        self_url: None,
    };
    cfg.gravar(&dir)?;

    println!("EAV7 Core inicializado em {}", dir.display());
    println!("  modo     : {}", cfg.mode.as_str());
    println!("  endereço : {endereco}");
    println!("  carteira : {}", wallet_path.display());
    println!("  config   : {}", cfg_path.display());
    println!();
    println!("Próximos passos:");
    println!("  eav7-core status --dir {}", dir.display());
    println!("  eav7-core run --dir {}", dir.display());
    println!();
    println!("Modo listen = só sincroniza (sem --validator).");
    println!("candidate/validator = usa a carteira e produz se estiver no top-51 (+banco).");
    println!("Âncora (owners frios): eav7-core ancora-init --dir …");
    Ok(())
}

pub(crate) fn escrever_restrito(path: &Path, conteudo: &str) -> Result<(), String> {
    std::fs::write(path, conteudo).map_err(|e| format!("gravar {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(path, perms)
            .map_err(|e| format!("chmod 600 {}: {e}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_cria_carteira_e_config() {
        let dir = tempfile::tempdir().unwrap();
        executar(InitArgs {
            dir: dir.path().to_path_buf(),
            mode: Modo::Listen,
            port: 6070,
            host: "127.0.0.1".into(),
            peers: vec![],
            force: false,
            allow_private_peers: true,
            genesis_hash: None,
            genesis_file: None,
        })
        .unwrap();
        assert!(dir.path().join("core.json").exists());
        assert!(dir.path().join(CARTEIRA).exists());
        let cfg = CoreConfig::carregar(dir.path()).unwrap();
        assert_eq!(cfg.mode, Modo::Listen);
        // Segunda vez sem --force falha.
        let err = executar(InitArgs {
            dir: dir.path().to_path_buf(),
            mode: Modo::Listen,
            port: 6070,
            host: "127.0.0.1".into(),
            peers: vec![],
            force: false,
            allow_private_peers: true,
            genesis_hash: None,
            genesis_file: None,
        })
        .unwrap_err();
        assert!(err.contains("--force"));
    }
}
