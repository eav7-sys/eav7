//! `eav7-core status` — consulta o nó local (ou URL) e resume saúde.

use crate::config::CoreConfig;
use crate::paths;
use serde_json::Value;
use std::path::PathBuf;

pub struct StatusArgs {
    pub dir: Option<PathBuf>,
    pub url: Option<String>,
}

pub fn executar(args: StatusArgs) -> Result<(), String> {
    let (url, modo_local) = resolver_url(&args)?;
    let resp = ureq::get(&format!("{url}/status"))
        .set("accept", "application/json")
        .timeout(std::time::Duration::from_secs(8))
        .call()
        .map_err(|e| format!("não falei com {url}/status: {e}"))?;
    let body: Value = resp
        .into_json()
        .map_err(|e| format!("status não é JSON: {e}"))?;

    let height = body.get("height").and_then(|v| v.as_i64()).unwrap_or(-1);
    let finalized = body
        .get("finalizedHeight")
        .and_then(|v| v.as_i64())
        .unwrap_or(-1);
    let head = body
        .get("headHash")
        .and_then(|v| v.as_str())
        .unwrap_or("?");
    let validators = body
        .get("validators")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let peers = body
        .get("peers")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let producer = body
        .get("producer")
        .and_then(|v| v.as_str())
        .unwrap_or("(nenhum)");

    println!("EAV7 Core — status");
    println!("  url            : {url}");
    if let Some(m) = modo_local {
        println!("  modo (config)  : {m}");
    }
    println!("  altura         : {height}");
    println!("  finalizado     : {finalized}");
    println!("  head           : {head}");
    println!("  validadores    : {validators}");
    println!("  peers (API)    : {peers}");
    println!("  producer local : {producer}");

    let dir_dados = args.dir.clone().or_else(|| {
        let d = paths::diretorio_padrao();
        d.exists().then_some(d)
    });

    if let Some(dir) = &dir_dados {
        let bytes = tamanho_dir(dir).unwrap_or(0);
        println!(
            "  disco (data)   : {} ({})",
            dir.display(),
            formatar_bytes(bytes)
        );
    }

    // Top-27: se temos carteira local, confere /validators.
    if let Some(dir) = dir_dados.or_else(|| {
        let d = paths::diretorio_padrao();
        CoreConfig::caminho(&d).exists().then_some(d)
    }) {
        if let Ok(cfg) = CoreConfig::carregar(&dir) {
            if cfg.mode.usa_carteira() {
                if let Ok(w) = eav7_sdk::ProductionWallet::from_file(cfg.caminho_carteira()) {
                    let addr = w.address().to_string();
                    let no_top = esta_no_top(&url, &addr)?;
                    println!(
                        "  no top-27?     : {} ({addr})",
                        if no_top { "sim" } else { "não" }
                    );
                }
            }
        }
    }
    Ok(())
}

fn resolver_url(args: &StatusArgs) -> Result<(String, Option<String>), String> {
    if let Some(u) = &args.url {
        return Ok((u.trim_end_matches('/').to_string(), None));
    }
    let dir = args
        .dir
        .clone()
        .unwrap_or_else(paths::diretorio_padrao);
    if CoreConfig::caminho(&dir).exists() {
        let cfg = CoreConfig::carregar(&dir)?;
        let url = format!("http://127.0.0.1:{}", cfg.port);
        return Ok((url, Some(cfg.mode.as_str().to_string())));
    }
    Ok(("http://127.0.0.1:6070".into(), None))
}

fn esta_no_top(url: &str, addr: &str) -> Result<bool, String> {
    let resp = ureq::get(&format!("{url}/validators"))
        .set("accept", "application/json")
        .timeout(std::time::Duration::from_secs(8))
        .call()
        .map_err(|e| format!("/validators: {e}"))?;
    let body: Value = resp.into_json().map_err(|e| format!("/validators JSON: {e}"))?;
    let lista = body
        .as_array()
        .or_else(|| body.get("validators").and_then(|v| v.as_array()))
        .cloned()
        .unwrap_or_default();
    Ok(lista.iter().any(|v| {
        v.get("address")
            .or_else(|| v.get("addr"))
            .and_then(|a| a.as_str())
            == Some(addr)
    }))
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

fn formatar_bytes(n: u64) -> String {
    const K: f64 = 1024.0;
    let n = n as f64;
    if n < K {
        format!("{n:.0} B")
    } else if n < K * K {
        format!("{:.1} KiB", n / K)
    } else if n < K * K * K {
        format!("{:.1} MiB", n / (K * K))
    } else {
        format!("{:.2} GiB", n / (K * K * K))
    }
}
