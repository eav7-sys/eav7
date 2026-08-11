//! Exemplo mínimo: consultar um nó e provar um saldo.
//!
//! `cargo run -p eav7-sdk --example consulta -- http://127.0.0.1:6070 E7…`
//!
//! Existe para ser a resposta a "como eu programo contra a EAV7 em Rust?" — e
//! para que a pergunta não seja respondida com "copie a assinatura de algum
//! lugar", que é como nasce a segunda implementação de uma regra de consenso.

fn main() {
    let mut args = std::env::args().skip(1);
    let url = args.next().unwrap_or_else(|| "http://127.0.0.1:6070".into());
    let endereco = args.next();

    let cliente = eav7_sdk::Eav7Client::novo(&url);

    match cliente.status() {
        Ok(s) => println!(
            "rede {} · altura {} · {} validador(es)",
            s.get("chain").and_then(|v| v.as_str()).unwrap_or("?"),
            s.get("height").and_then(serde_json::Value::as_i64).unwrap_or(-1),
            s.get("validators").and_then(serde_json::Value::as_u64).unwrap_or(0),
        ),
        Err(e) => {
            eprintln!("não consegui falar com {url}: {e}");
            std::process::exit(1);
        }
    }

    let Some(endereco) = endereco else {
        println!("(passe um endereço E7 para consultar um saldo)");
        return;
    };

    match cliente.conta(&endereco) {
        Ok(c) => println!("saldo {} e7 · stake {} · próximo nonce {}", c.balance, c.staked, c.next_nonce),
        Err(e) => eprintln!("conta: {e}"),
    }

    // Raiz a partir do header verificado (S5), depois saldo com Merkle.
    let raiz = match cliente.raiz_confiavel_do_header("latest") {
        Ok(r) => {
            println!("stateRoot confiável (header): {r}");
            Some(r)
        }
        Err(e) => {
            eprintln!("header/stateRoot: {e} (prova usará a raiz do /proof)");
            None
        }
    };
    match cliente.saldo_provado(&endereco, raiz.as_deref()) {
        Ok(saldo) => println!("saldo PROVADO contra o stateRoot: {saldo} e7"),
        Err(e) => eprintln!("prova: {e}"),
    }
}
