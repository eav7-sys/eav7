//! Diretórios padrão do Core por SO (plano 08-A5).

use std::path::PathBuf;

/// Raiz de dados do operador quando `--dir` não é passado.
///
/// - Windows: `%APPDATA%\EAV7`
/// - macOS: `~/Library/Application Support/EAV7`
/// - demais (Linux/BSD): `~/.eav7`
pub fn diretorio_padrao() -> PathBuf {
    if let Ok(p) = std::env::var("EAV7_HOME") {
        let p = PathBuf::from(p);
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("EAV7");
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("EAV7");
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join(".eav7");
    }
    PathBuf::from(".eav7")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eav7_home_tem_prioridade() {
        // SAFETY: teste serial local; variável só deste processo de teste.
        unsafe { std::env::set_var("EAV7_HOME", "/tmp/eav7-core-test-home") };
        assert_eq!(diretorio_padrao(), PathBuf::from("/tmp/eav7-core-test-home"));
        unsafe { std::env::remove_var("EAV7_HOME") };
    }
}
