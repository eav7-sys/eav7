//! Fase B — stake / unstake / conta / score / claim sobre o SDK.

use crate::amounts::{eav7_to_e7, format_eav7};
use crate::config::{CoreConfig, Modo};
use crate::paths;
use eav7::config::MIN_VALIDATOR_STAKE;
use eav7_sdk::{Eav7Client, ProductionWallet};
use std::path::PathBuf;
use std::time::Duration;

pub struct OpsCtx {
    pub dir: PathBuf,
    pub url: Option<String>,
    pub wait: bool,
    pub timeout_secs: u64,
}

fn carregar_cfg(dir: &PathBuf) -> Result<CoreConfig, String> {
    CoreConfig::carregar(dir)
}

fn url_do_ctx(ctx: &OpsCtx) -> Result<String, String> {
    if let Some(u) = &ctx.url {
        return Ok(u.trim_end_matches('/').to_string());
    }
    let cfg = carregar_cfg(&ctx.dir)?;
    Ok(format!("http://127.0.0.1:{}", cfg.port))
}

fn cliente_com_carteira(ctx: &OpsCtx) -> Result<(Eav7Client, String, CoreConfig), String> {
    let cfg = carregar_cfg(&ctx.dir)?;
    let w = ProductionWallet::from_file(cfg.caminho_carteira())?;
    let addr = w.address().to_string();
    let url = url_do_ctx(ctx)?;
    let cliente = Eav7Client::com_carteira(url, Box::new(w));
    Ok((cliente, addr, cfg))
}

fn cliente_leitura(ctx: &OpsCtx) -> Result<Eav7Client, String> {
    Ok(Eav7Client::novo(url_do_ctx(ctx)?))
}

fn aguardar(cliente: &Eav7Client, id: &str, secs: u64) -> Result<(), String> {
    let conf = cliente
        .aguardar_confirmacao(id, Duration::from_secs(secs))
        .map_err(|e| e.to_string())?;
    println!(
        "  confirmada @ altura {} ({})",
        conf.block_height, conf.block_hash
    );
    Ok(())
}

fn reportar_submissao(
    cliente: &Eav7Client,
    sub: eav7_sdk::Submissao,
    wait: bool,
    timeout: u64,
) -> Result<(), String> {
    if !sub.accepted {
        return Err(format!(
            "recusada: {}",
            sub.reason.unwrap_or_else(|| "(sem motivo)".into())
        ));
    }
    println!("aceita id={}", sub.id);
    if wait {
        aguardar(cliente, &sub.id, timeout)?;
    } else {
        println!("  (use --wait para esperar confirmação em bloco)");
    }
    Ok(())
}

pub fn account(ctx: OpsCtx) -> Result<(), String> {
    let (cliente, addr, cfg) = cliente_com_carteira(&ctx)?;
    let conta = cliente.conta(&addr).map_err(|e| e.to_string())?;
    let min = MIN_VALIDATOR_STAKE;
    println!("conta {}", conta.address);
    println!("  modo (core)   : {}", cfg.mode.as_str());
    println!("  saldo         : {} EAV7", format_eav7(conta.balance));
    println!("  staked        : {} EAV7", format_eav7(conta.staked));
    println!("  fee exempt    : {}", conta.fee_exempt);
    println!(
        "  claimable     : {} EAV7",
        format_eav7(conta.claimable_voter_reward)
    );
    println!(
        "  min validador : {} EAV7",
        format_eav7(min)
    );
    if conta.staked >= min {
        println!("  candidatura   : stake OK — use `eav7-core set-mode candidate` + `run`");
    } else {
        let falta = min.saturating_sub(conta.staked);
        println!(
            "  candidatura   : falta stakear {} EAV7",
            format_eav7(falta)
        );
    }
    if conta.unbonding.is_empty() {
        println!("  unbonding     : (vazio)");
    } else {
        println!("  unbonding:");
        for u in &conta.unbonding {
            println!(
                "    {} EAV7  mature@{}  ({} blocos)",
                format_eav7(u.amount),
                u.mature_at,
                u.blocks_left
            );
        }
    }
    Ok(())
}

pub fn stake(ctx: OpsCtx, amount: &str) -> Result<(), String> {
    let e7 = eav7_to_e7(amount, "--amount")?;
    let (cliente, _, _) = cliente_com_carteira(&ctx)?;
    let sub = cliente.stake(e7).map_err(|e| e.to_string())?;
    reportar_submissao(&cliente, sub, ctx.wait, ctx.timeout_secs)?;
    Ok(())
}

pub fn unstake(ctx: OpsCtx, amount: &str) -> Result<(), String> {
    let e7 = eav7_to_e7(amount, "--amount")?;
    let (cliente, _, _) = cliente_com_carteira(&ctx)?;
    let sub = cliente.unstake(e7).map_err(|e| e.to_string())?;
    reportar_submissao(&cliente, sub, ctx.wait, ctx.timeout_secs)?;
    Ok(())
}

pub fn claim(ctx: OpsCtx, validator: &str) -> Result<(), String> {
    if !eav7::is_valid_address(validator) {
        return Err(format!("endereço de validador inválido: {validator}"));
    }
    let (cliente, _, _) = cliente_com_carteira(&ctx)?;
    let sub = cliente
        .reivindicar_recompensa(validator)
        .map_err(|e| e.to_string())?;
    reportar_submissao(&cliente, sub, ctx.wait, ctx.timeout_secs)?;
    Ok(())
}

pub fn score(ctx: OpsCtx) -> Result<(), String> {
    let cfg = carregar_cfg(&ctx.dir).ok();
    let meu = cfg.as_ref().and_then(|c| {
        ProductionWallet::from_file(c.caminho_carteira())
            .ok()
            .map(|w| w.address().to_string())
    });
    let cliente = cliente_leitura(&ctx)?;
    let lista = cliente.validadores_tipados().map_err(|e| e.to_string())?;
    println!("validadores ({})", lista.len());
    for v in &lista {
        let marca = if meu.as_deref() == Some(v.address.as_str()) {
            " ◀ você"
        } else {
            ""
        };
        let nome = v.name.as_deref().unwrap_or("-");
        let perf = v
            .performance
            .as_ref()
            .map(|p| {
                format!(
                    "score={:.1} {} prod={:.1}%",
                    p.score, p.status, p.productivity_pct
                )
            })
            .unwrap_or_else(|| "perf=n/a".into());
        println!(
            "  {}  stake={}  votes={}  name={nome}  {perf}{marca}",
            v.address,
            format_eav7(v.staked),
            format_eav7(v.votes),
        );
    }
    if let Some(addr) = &meu {
        if !lista.iter().any(|v| v.address == *addr) {
            println!("  (sua carteira {addr} ainda não está na lista /validators)");
        }
    }
    Ok(())
}

pub fn set_mode(dir: PathBuf, mode: Modo) -> Result<(), String> {
    let mut cfg = CoreConfig::carregar(&dir)?;
    let old = cfg.mode.as_str().to_string();
    if mode.usa_carteira() {
        let w = cfg.caminho_carteira();
        if !w.exists() {
            return Err(format!("carteira ausente: {}", w.display()));
        }
        let wallet = ProductionWallet::from_file(&w)?;
        let url = format!("http://127.0.0.1:{}", cfg.port);
        if let Ok(conta) = Eav7Client::novo(&url).conta(wallet.address()) {
            if conta.staked < MIN_VALIDATOR_STAKE && matches!(mode, Modo::Candidate | Modo::Validator)
            {
                eprintln!(
                    "aviso: stake {} < mínimo {} — modo gravado, mas a rede ainda não te elege",
                    format_eav7(conta.staked),
                    format_eav7(MIN_VALIDATOR_STAKE)
                );
            }
        }
    }
    cfg.mode = mode;
    cfg.gravar(&dir)?;
    println!(
        "modo {} → {} em {}",
        old,
        cfg.mode.as_str(),
        CoreConfig::caminho(&dir).display()
    );
    Ok(())
}

pub fn health(ctx: OpsCtx) -> Result<(), String> {
    let cliente = cliente_leitura(&ctx)?;
    let st = cliente.status().map_err(|e| e.to_string())?;
    let height = st.get("height").and_then(|v| v.as_i64()).unwrap_or(-1);
    let peers = st
        .get("peers")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let mut avisos = Vec::new();
    if peers == 0 {
        avisos.push("0 peers — sync parado se você depende da rede");
    }
    if height < 0 {
        avisos.push("altura inválida");
    }
    let dir = &ctx.dir;
    if dir.exists() {
        // Disco: aviso se data dir > 50 GiB (operador barato).
        if let Ok(bytes) = tamanho_dir(dir) {
            if bytes > 50 * 1024 * 1024 * 1024 {
                avisos.push("data dir > 50 GiB — considere snapshot/compactação (plano D)");
            }
        }
    }
    println!("saúde @ {}", url_do_ctx(&ctx)?);
    println!("  altura : {height}");
    println!("  peers  : {peers}");
    if avisos.is_empty() {
        println!("  ok");
    } else {
        for a in avisos {
            println!("  aviso: {a}");
        }
    }
    Ok(())
}

fn tamanho_dir(path: &std::path::Path) -> std::io::Result<u64> {
    let mut total = 0u64;
    if path.is_file() {
        return Ok(path.metadata()?.len());
    }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_dir() {
            total += tamanho_dir(&entry.path())?;
        } else {
            total += meta.len();
        }
    }
    Ok(total)
}

/// Defaults de --dir para comandos ops.
pub fn dir_padrao(dir: Option<PathBuf>) -> PathBuf {
    dir.unwrap_or_else(paths::diretorio_padrao)
}
