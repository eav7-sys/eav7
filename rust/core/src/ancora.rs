//! `eav7-core ancora-init` — gera owners frios + witness quente (plano 13 / T1.5).

use crate::config::CARTEIRA;
use crate::init::escrever_restrito;
use eav7_sdk::{ancora_preparar, AncoraPrep};
use std::path::PathBuf;

pub struct AncoraInitArgs {
    pub dir: PathBuf,
    pub owners: usize,
    pub threshold: u64,
    pub force: bool,
}

pub fn executar(args: AncoraInitArgs) -> Result<(), String> {
    let dir = args.dir;
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar {}: {e}", dir.display()))?;

    let witness_path = dir.join(CARTEIRA);
    let backup_dir = dir.join("ancora-owners-BACKUP");
    if !args.force && (witness_path.exists() || backup_dir.exists()) {
        return Err(format!(
            "já existe material Âncora em {} (use --force). NÃO sobrescreva sem backup offline.",
            dir.display()
        ));
    }

    let prep = ancora_preparar(args.owners, args.threshold)?;
    escrever_restrito(&witness_path, &prep.witness.1)?;

    if backup_dir.exists() {
        std::fs::remove_dir_all(&backup_dir)
            .map_err(|e| format!("limpar backup antigo: {e}"))?;
    }
    std::fs::create_dir_all(&backup_dir).map_err(|e| format!("criar backup: {e}"))?;
    for (i, (addr, json)) in prep.owners.iter().enumerate() {
        let path = backup_dir.join(format!("owner-{i}-{addr}.json"));
        escrever_restrito(&path, json)?;
    }
    let meta = format!(
        "endereco={}\nthreshold={}\nwitness={}\nowners={}\n",
        prep.endereco,
        prep.threshold,
        prep.witness.0,
        prep.owners.len()
    );
    escrever_restrito(&backup_dir.join("README.txt"), &meta)?;

    println!("Âncora preparada (material local — ainda NÃO está on-chain)");
    println!("  endereço conta : {}", prep.endereco);
    println!("  owner limiar   : {}-de-{}", prep.threshold, prep.owners.len());
    println!("  witness (nó)   : {} → {}", prep.witness.0, witness_path.display());
    println!("  owners BACKUP  : {}", backup_dir.display());
    println!();
    println!("REGRA DE OURO: copie `ancora-owners-BACKUP/` para papel/USB/HSM OFFLINE.");
    println!("Apague do VPS depois. Só a witness fica no keystore do nó.");
    println!();
    println!("On-chain (carteira = owner-0 / endereço da conta, com saldo):");
    println!("  1. Importe owner-0-*.json numa máquina segura");
    println!("  2. Envie PERMISSION_UPDATE (SDK: ancora_aplicar_permissoes) com o data abaixo");
    println!();
    imprimir_permission_json(&prep);
    Ok(())
}

fn imprimir_permission_json(prep: &AncoraPrep) {
    let dados = prep.dados_permission_update();
    if let Ok(s) = serde_json::to_string_pretty(&json_de_protocolo(&dados)) {
        println!("--- data PERMISSION_UPDATE ---");
        println!("{s}");
        println!("--- fim ---");
    }
}

fn json_de_protocolo(v: &eav7::transaction::JsonValue) -> serde_json::Value {
    use eav7::transaction::JsonValue::*;
    match v {
        Null => serde_json::Value::Null,
        Bool(b) => serde_json::Value::Bool(*b),
        Int(n) => serde_json::Value::Number((*n).into()),
        Str(s) => serde_json::Value::String(s.clone()),
        List(xs) => serde_json::Value::Array(xs.iter().map(json_de_protocolo).collect()),
        Map(m) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in m {
                obj.insert(k.clone(), json_de_protocolo(v));
            }
            serde_json::Value::Object(obj)
        }
    }
}
