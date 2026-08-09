//! EAV7 Core — CLI de operador (plano 08 Fase A).
//!
//! Não reimplementa consenso: gera config/carteira, consulta status e sobe
//! `eav7-node` nos modos listen | candidate | validator.

mod config;
mod init;
mod paths;
mod run;
mod status;

use config::Modo;
use std::path::PathBuf;
use std::process::ExitCode;

const USO: &str = "\
EAV7 Core — operador de nó (Win/Linux/macOS)

uso:
  eav7-core init  [--dir PATH] [--mode listen|candidate|validator]
                  [--port N] [--host ADDR] [--peers url,url]
                  [--allow-private-peers] [--force]
                  [--genesis-hash H] [--genesis FILE]
  eav7-core status [--dir PATH] [--url URL]
  eav7-core run    [--dir PATH] [--mode listen|candidate|validator]
  eav7-core listen | candidate | validator   (atalhos de run)

padrão de --dir:
  Linux  ~/.eav7
  macOS  ~/Library/Application Support/EAV7
  Win    %APPDATA%\\EAV7
  (ou EAV7_HOME)

documentação: docs/core.md
";

fn main() -> ExitCode {
    match despacha() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("erro: {e}");
            ExitCode::from(1)
        }
    }
}

fn despacha() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let Some(cmd) = args.next() else {
        print!("{USO}");
        return Ok(());
    };
    match cmd.as_str() {
        "help" | "--help" | "-h" => {
            print!("{USO}");
            Ok(())
        }
        "init" => {
            let a = parse_init(args)?;
            init::executar(a)
        }
        "status" => {
            let a = parse_status(args)?;
            status::executar(a)
        }
        "run" => {
            let a = parse_run(args, None)?;
            run::executar(a)
        }
        "listen" => {
            let a = parse_run(args, Some(Modo::Listen))?;
            run::executar(a)
        }
        "candidate" => {
            let a = parse_run(args, Some(Modo::Candidate))?;
            run::executar(a)
        }
        "validator" => {
            let a = parse_run(args, Some(Modo::Validator))?;
            run::executar(a)
        }
        outro => Err(format!("comando desconhecido: {outro}\n\n{USO}")),
    }
}

fn parse_init(mut args: impl Iterator<Item = String>) -> Result<init::InitArgs, String> {
    let mut dir = None;
    let mut mode = Modo::Listen;
    let mut port = 6070u16;
    let mut host = "0.0.0.0".to_string();
    let mut peers = Vec::new();
    let mut force = false;
    let mut allow_private_peers = false;
    let mut genesis_hash = None;
    let mut genesis_file = None;

    while let Some(flag) = args.next() {
        let mut valor = || args.next().ok_or_else(|| format!("{flag} exige valor"));
        match flag.as_str() {
            "--dir" => dir = Some(PathBuf::from(valor()?)),
            "--mode" => mode = Modo::parse(&valor()?)?,
            "--port" => {
                port = valor()?
                    .parse()
                    .map_err(|_| "porta inválida".to_string())?;
            }
            "--host" => host = valor()?,
            "--peers" => {
                peers.extend(
                    valor()?
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty()),
                );
            }
            "--force" => force = true,
            "--allow-private-peers" => allow_private_peers = true,
            "--genesis-hash" => genesis_hash = Some(valor()?),
            "--genesis" => genesis_file = Some(PathBuf::from(valor()?)),
            outro => return Err(format!("flag desconhecida em init: {outro}")),
        }
    }

    Ok(init::InitArgs {
        dir: dir.unwrap_or_else(paths::diretorio_padrao),
        mode,
        port,
        host,
        peers,
        force,
        allow_private_peers,
        genesis_hash,
        genesis_file,
    })
}

fn parse_status(mut args: impl Iterator<Item = String>) -> Result<status::StatusArgs, String> {
    let mut dir = None;
    let mut url = None;
    while let Some(flag) = args.next() {
        let mut valor = || args.next().ok_or_else(|| format!("{flag} exige valor"));
        match flag.as_str() {
            "--dir" => dir = Some(PathBuf::from(valor()?)),
            "--url" => url = Some(valor()?),
            outro => return Err(format!("flag desconhecida em status: {outro}")),
        }
    }
    Ok(status::StatusArgs { dir, url })
}

fn parse_run(
    mut args: impl Iterator<Item = String>,
    mode: Option<Modo>,
) -> Result<run::RunArgs, String> {
    let mut dir = None;
    let mut mode = mode;
    while let Some(flag) = args.next() {
        let mut valor = || args.next().ok_or_else(|| format!("{flag} exige valor"));
        match flag.as_str() {
            "--dir" => dir = Some(PathBuf::from(valor()?)),
            "--mode" => mode = Some(Modo::parse(&valor()?)?),
            outro => return Err(format!("flag desconhecida em run: {outro}")),
        }
    }
    Ok(run::RunArgs {
        dir: dir.unwrap_or_else(paths::diretorio_padrao),
        mode,
    })
}
