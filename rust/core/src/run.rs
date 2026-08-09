//! `eav7-core run` — sobe o eav7-node com flags derivadas do core.json.

use crate::config::{CoreConfig, Modo};
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct RunArgs {
    pub dir: PathBuf,
    /// Sobrescreve o modo do core.json, se presente.
    pub mode: Option<Modo>,
}

pub fn executar(args: RunArgs) -> Result<(), String> {
    let mut cfg = CoreConfig::carregar(&args.dir)?;
    if let Some(m) = args.mode {
        cfg.mode = m;
    }

    let bin = achar_eav7_node()?;
    let mut cmd = Command::new(&bin);
    cmd.arg("--port").arg(cfg.port.to_string());
    cmd.arg("--host").arg(&cfg.host);
    cmd.arg("--data").arg(&cfg.data_dir);

    if cfg.allow_private_peers {
        cmd.arg("--allow-private-peers");
    }
    if let Some(h) = &cfg.genesis_hash {
        cmd.arg("--genesis-hash").arg(h);
    }
    if let Some(g) = &cfg.genesis_file {
        cmd.arg("--genesis").arg(g);
    }
    if !cfg.peers.is_empty() {
        cmd.arg("--peers").arg(cfg.peers.join(","));
    }

    match cfg.mode {
        Modo::Listen => {
            println!(
                "[core] modo listen — sync/verificar sem produzir (bin={})",
                bin.display()
            );
        }
        Modo::Candidate | Modo::Validator => {
            let w = cfg.caminho_carteira();
            if !w.exists() {
                return Err(format!(
                    "carteira ausente: {} — rode eav7-core init",
                    w.display()
                ));
            }
            cmd.arg("--validator").arg(&w);
            println!(
                "[core] modo {} — carteira {} (produz se no top-27)",
                cfg.mode.as_str(),
                w.display()
            );
        }
    }

    println!("[core] arrancando {} …", bin.display());
    // Sinais e código de saída do nó passam ao operador.
    let status = cmd
        .status()
        .map_err(|e| format!("falha ao executar {}: {e}", bin.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("eav7-node saiu com {status}"))
    }
}

/// Procura o binário do nó: EAV7_NODE_BIN → ao lado deste executável → PATH.
pub fn achar_eav7_node() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("EAV7_NODE_BIN") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
        return Err(format!("EAV7_NODE_BIN não é arquivo: {}", p.display()));
    }

    if let Ok(me) = std::env::current_exe() {
        if let Some(dir) = me.parent() {
            for nome in ["eav7-node", "eav7-node.exe"] {
                let cand = dir.join(nome);
                if cand.is_file() {
                    return Ok(cand);
                }
            }
            // cargo run: target/debug/eav7-core → target/debug/eav7-node
            let cargo_hint = dir.join("eav7-node");
            if cargo_hint.is_file() {
                return Ok(cargo_hint);
            }
        }
    }

    // PATH
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let cand = dir.join("eav7-node");
            if cand.is_file() {
                return Ok(cand);
            }
            #[cfg(windows)]
            {
                let cand = dir.join("eav7-node.exe");
                if cand.is_file() {
                    return Ok(cand);
                }
            }
        }
    }

    // Fallback: árvore do workspace em desenvolvimento.
    if let Ok(man) = std::env::var("CARGO_MANIFEST_DIR") {
        let debug = Path::new(&man).join("../target/debug/eav7-node");
        if debug.is_file() {
            return Ok(debug.canonicalize().unwrap_or(debug));
        }
        let release = Path::new(&man).join("../target/release/eav7-node");
        if release.is_file() {
            return Ok(release.canonicalize().unwrap_or(release));
        }
    }

    Err(
        "eav7-node não encontrado. Compile com `cargo build -p eav7-node` \
         ou defina EAV7_NODE_BIN."
            .into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn achar_respeita_env() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("eav7-node");
        std::fs::write(&fake, b"#!/bin/true\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut p = std::fs::metadata(&fake).unwrap().permissions();
            p.set_mode(0o755);
            std::fs::set_permissions(&fake, p).unwrap();
        }
        unsafe { std::env::set_var("EAV7_NODE_BIN", &fake) };
        let achado = achar_eav7_node().unwrap();
        assert_eq!(achado, fake);
        unsafe { std::env::remove_var("EAV7_NODE_BIN") };
    }
}
