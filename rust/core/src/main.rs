//! EAV7 Core — CLI de operador (plano 08 Fase A + B).
//!
//! Não reimplementa consenso: config/carteira, status, sobe `eav7-node`, e
//! opera stake/score via `eav7-sdk`.

mod amounts;
mod config;
mod init;
mod ops;
mod paths;
mod run;
mod status;

use config::Modo;
use std::path::PathBuf;
use std::process::ExitCode;

const USO: &str = "\
EAV7 Core — operador de nó (Win/Linux/macOS)

Nó:
  eav7-core init  [--dir PATH] [--mode listen|candidate|validator]
                  [--port N] [--host ADDR] [--peers url,url]
                  [--allow-private-peers] [--force]
                  [--genesis-hash H] [--genesis FILE]
  eav7-core status [--dir PATH] [--url URL]
  eav7-core health [--dir PATH] [--url URL]
  eav7-core run    [--dir PATH] [--mode listen|candidate|validator]
  eav7-core listen | candidate | validator   (atalhos de run)
  eav7-core set-mode <listen|candidate|validator> [--dir PATH]

Carteira / candidatura (Fase B):
  eav7-core account [--dir PATH] [--url URL]
  eav7-core stake   --amount N [--dir PATH] [--url URL] [--wait] [--timeout S]
  eav7-core unstake --amount N [--dir PATH] [--url URL] [--wait] [--timeout S]
  eav7-core claim   --validator ADDR [--dir PATH] [--url URL] [--wait]
  eav7-core score   [--dir PATH] [--url URL]

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
        "init" => init::executar(parse_init(args)?),
        "status" => status::executar(parse_status(args)?),
        "health" => {
            let (dir, url) = parse_dir_url(args)?;
            ops::health(ops::OpsCtx {
                dir: ops::dir_padrao(dir),
                url,
                wait: false,
                timeout_secs: 60,
            })
        }
        "run" => run::executar(parse_run(args, None)?),
        "listen" => run::executar(parse_run(args, Some(Modo::Listen))?),
        "candidate" => run::executar(parse_run(args, Some(Modo::Candidate))?),
        "validator" => run::executar(parse_run(args, Some(Modo::Validator))?),
        "set-mode" => {
            let modo = args
                .next()
                .ok_or("uso: eav7-core set-mode <listen|candidate|validator>")?;
            let mode = Modo::parse(&modo)?;
            let (dir, url) = parse_dir_url(args)?;
            ops::set_mode(ops::dir_padrao(dir), mode, url)
        }
        "account" | "conta" => {
            let (dir, url) = parse_dir_url(args)?;
            ops::account(ops::OpsCtx {
                dir: ops::dir_padrao(dir),
                url,
                wait: false,
                timeout_secs: 60,
            })
        }
        "stake" => {
            let a = parse_amount_ops(args)?;
            ops::stake(a.ctx, &a.amount)
        }
        "unstake" => {
            let a = parse_amount_ops(args)?;
            ops::unstake(a.ctx, &a.amount)
        }
        "claim" => {
            let a = parse_claim(args)?;
            ops::claim(a.ctx, &a.validator)
        }
        "score" => {
            let (dir, url) = parse_dir_url(args)?;
            ops::score(ops::OpsCtx {
                dir: ops::dir_padrao(dir),
                url,
                wait: false,
                timeout_secs: 60,
            })
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

fn parse_dir_url(
    mut args: impl Iterator<Item = String>,
) -> Result<(Option<PathBuf>, Option<String>), String> {
    let mut dir = None;
    let mut url = None;
    while let Some(flag) = args.next() {
        let mut valor = || args.next().ok_or_else(|| format!("{flag} exige valor"));
        match flag.as_str() {
            "--dir" => dir = Some(PathBuf::from(valor()?)),
            "--url" => url = Some(valor()?),
            outro => return Err(format!("flag desconhecida: {outro}")),
        }
    }
    Ok((dir, url))
}

struct AmountOps {
    ctx: ops::OpsCtx,
    amount: String,
}

fn parse_amount_ops(mut args: impl Iterator<Item = String>) -> Result<AmountOps, String> {
    let mut dir = None;
    let mut url = None;
    let mut amount = None;
    let mut wait = false;
    let mut timeout_secs = 90u64;
    while let Some(flag) = args.next() {
        let mut valor = || args.next().ok_or_else(|| format!("{flag} exige valor"));
        match flag.as_str() {
            "--dir" => dir = Some(PathBuf::from(valor()?)),
            "--url" => url = Some(valor()?),
            "--amount" => amount = Some(valor()?),
            "--wait" => wait = true,
            "--timeout" => {
                timeout_secs = valor()?
                    .parse()
                    .map_err(|_| "--timeout inválido".to_string())?;
            }
            outro => return Err(format!("flag desconhecida: {outro}")),
        }
    }
    Ok(AmountOps {
        ctx: ops::OpsCtx {
            dir: ops::dir_padrao(dir),
            url,
            wait,
            timeout_secs,
        },
        amount: amount.ok_or("--amount é obrigatório")?,
    })
}

struct ClaimOps {
    ctx: ops::OpsCtx,
    validator: String,
}

fn parse_claim(mut args: impl Iterator<Item = String>) -> Result<ClaimOps, String> {
    let mut dir = None;
    let mut url = None;
    let mut validator = None;
    let mut wait = false;
    let mut timeout_secs = 90u64;
    while let Some(flag) = args.next() {
        let mut valor = || args.next().ok_or_else(|| format!("{flag} exige valor"));
        match flag.as_str() {
            "--dir" => dir = Some(PathBuf::from(valor()?)),
            "--url" => url = Some(valor()?),
            "--validator" => validator = Some(valor()?),
            "--wait" => wait = true,
            "--timeout" => {
                timeout_secs = valor()?
                    .parse()
                    .map_err(|_| "--timeout inválido".to_string())?;
            }
            outro => return Err(format!("flag desconhecida: {outro}")),
        }
    }
    Ok(ClaimOps {
        ctx: ops::OpsCtx {
            dir: ops::dir_padrao(dir),
            url,
            wait,
            timeout_secs,
        },
        validator: validator.ok_or("--validator é obrigatório")?,
    })
}
