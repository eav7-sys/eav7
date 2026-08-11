//! O config gerado é a fonte única de parâmetros de consenso.
//!
//! Os módulos deste crate foram portados em paralelo e cada um declarou as
//! constantes de que precisava — 131 no total, 10 duplicadas entre arquivos.
//! Duas cópias de um valor de consenso divergem no dia em que alguém ajusta uma
//! e esquece a outra, e o nó passa a discordar de si mesmo conforme o caminho de
//! código. Este teste existe para que isso não volte a acontecer em silêncio.

use std::{fs, path::PathBuf};

fn raiz() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Constantes locais que REPETEM um nome já definido em `config.rs` são
/// suspeitas: ou o módulo deveria importar, ou o nome colide por acaso.
///
/// Falhar aqui não significa erro — significa "confira". A lista de exceções
/// abaixo é a decisão consciente de cada caso.
#[test]
fn nenhum_modulo_redeclara_constante_de_consenso() {
    // Nomes que legitimamente vivem fora do config: são detalhe de implementação
    // do módulo, não parâmetro de protocolo.
    const PERMITIDAS: &[&str] = &[
        "TIPOS",      // a lista de tipos que cada domínio atende
        "ZERO_ADDR",  // constante trivial, local à EAVM
        "BLAKE",      // prefixo de constantes internas do blake2f
    ];

    let cfg = fs::read_to_string(raiz().join("src/config.rs")).expect("config.rs gerado");
    let nomes_config: Vec<String> = cfg
        .lines()
        .filter_map(|l| l.trim().strip_prefix("pub const "))
        .filter_map(|l| l.split(':').next())
        .map(|s| s.trim().to_string())
        .collect();

    let mut suspeitas = Vec::new();
    for dir in ["src/state", "src/eavm"] {
        let Ok(entradas) = fs::read_dir(raiz().join(dir)) else { continue };
        for e in entradas.flatten() {
            let caminho = e.path();
            if caminho.extension().and_then(|s| s.to_str()) != Some("rs") {
                continue;
            }
            let arquivo = caminho.file_name().unwrap().to_string_lossy().to_string();
            let texto = fs::read_to_string(&caminho).unwrap_or_default();
            for linha in texto.lines() {
                let t = linha.trim();
                let Some(resto) = t.strip_prefix("const ").or_else(|| t.strip_prefix("pub const ")) else {
                    continue;
                };
                let Some(nome) = resto.split(':').next().map(str::trim) else { continue };
                if PERMITIDAS.iter().any(|p| nome.starts_with(p)) {
                    continue;
                }
                // O que se procura é uma CÓPIA DO VALOR, não o nome repetido.
                // `const X: u64 = crate::config::X as u64;` é o padrão desejado —
                // o nome fica local (usos não mudam) e o valor vem da fonte única.
                // Só literal cru é suspeito.
                let vem_do_config = resto.contains("crate::config::");
                if !vem_do_config && nomes_config.iter().any(|c| c == nome) {
                    suspeitas.push(format!("{arquivo}: {nome}"));
                }
            }
        }
    }

    assert!(
        suspeitas.is_empty(),
        "constantes de consenso redeclaradas fora de `config.rs`:\n  {}\n\n\
         Importe de `crate::config` em vez de manter cópia local. Se o nome só \
         colide por acaso, acrescente à lista PERMITIDAS com justificativa.",
        suspeitas.join("\n  "),
    );
}

