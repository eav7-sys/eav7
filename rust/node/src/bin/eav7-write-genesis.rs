//! Write a launch genesis block JSON (§12.2 buckets + 5..=7 Anchors).
//!
//! Usage:
//!   eav7-write-genesis \
//!     --public-vault E7… --sale-vault E7… --partner-vault E7… \
//!     --anchors-file contracts/sale/foundation-ancoras.json \
//!     --out genesis.json \
//!     --timestamp-ms 1700000000000

use eav7::block::{block_to_json_line, build_genesis_block};
use eav7_node::boot::{alocacoes_buckets_whitepaper, GENESIS_FOUNDATION_TREASURY};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

fn usage() -> ! {
    eprintln!(
        "usage: eav7-write-genesis --public-vault E7… --sale-vault E7… --partner-vault E7… \
         --anchors-file PATH --out PATH [--foundation E7…] [--timestamp-ms N]"
    );
    std::process::exit(2);
}

fn arg(flag: &str) -> Option<String> {
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        if a == flag {
            return args.next();
        }
        if let Some(v) = a.strip_prefix(&format!("{flag}=")) {
            return Some(v.to_string());
        }
    }
    None
}

fn main() -> ExitCode {
    let public = arg("--public-vault").unwrap_or_else(|| usage());
    let sale = arg("--sale-vault").unwrap_or_else(|| usage());
    let partner = arg("--partner-vault").unwrap_or_else(|| usage());
    let anchors_file = PathBuf::from(arg("--anchors-file").unwrap_or_else(|| usage()));
    let out = PathBuf::from(arg("--out").unwrap_or_else(|| usage()));
    let foundation = arg("--foundation").unwrap_or_else(|| GENESIS_FOUNDATION_TREASURY.to_string());
    let ts: i64 = arg("--timestamp-ms")
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0)
        });

    let reg: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&anchors_file).expect("read anchors-file"),
    )
    .expect("parse anchors-file");
    let anchors: Vec<String> = reg["anchors"]
        .as_array()
        .expect("anchors array")
        .iter()
        .filter_map(|a| a["e7"].as_str().map(|s| s.to_string()))
        .collect();
    let refs: Vec<&str> = anchors.iter().map(|s| s.as_str()).collect();

    let aloc = match alocacoes_buckets_whitepaper(&public, &sale, &foundation, &partner, &refs) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("alocacoes: {e}");
            return ExitCode::FAILURE;
        }
    };
    let block = build_genesis_block(ts, aloc);
    let line = match block_to_json_line(&block) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("serialize: {e}");
            return ExitCode::FAILURE;
        }
    };
    let pretty = {
        let v: serde_json::Value = serde_json::from_str(&line).expect("genesis json");
        serde_json::to_string_pretty(&v).expect("pretty")
    };
    if let Some(parent) = out.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&out, pretty + "\n").expect("write genesis");
    println!("wrote {} hash={}", out.display(), block.hash);
    ExitCode::SUCCESS
}
