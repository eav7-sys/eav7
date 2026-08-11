//! Exemplo de ESCRITA: monta, assina e envia uma transferência.
//!
//! `cargo run -p eav7-sdk --example enviar -- <url> <carteira.json> <destino> <valor>`

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let [url, carteira, destino, valor] = a.as_slice() else {
        eprintln!("uso: enviar <url> <carteira.json> <destino E7> <valor em e7>");
        std::process::exit(2);
    };

    let carteira = match eav7_sdk::ProductionWallet::from_file(carteira) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("carteira: {e}");
            std::process::exit(1);
        }
    };
    println!("de: {}", carteira.address());

    let cliente = eav7_sdk::Eav7Client::com_carteira(url, Box::new(carteira));
    match cliente.transferir(destino, valor.parse().unwrap_or(0)) {
        Ok(r) if r.accepted => println!("aceita: {}", r.id),
        Ok(r) => println!("recusada: {}", r.reason.unwrap_or_default()),
        Err(e) => eprintln!("falhou: {e}"),
    }
}
