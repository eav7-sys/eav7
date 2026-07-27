//! Relayer da ponte cross-chain — o processo que efetivamente move valor.
//!
//! Sem ele a ponte não funciona: `BRIDGE_OUT` trava valor na EAV7 e fica
//! esperando alguém pagar do outro lado. Esse alguém é este binário.
//!
//! ```sh
//! eav7-relayer --node http://127.0.0.1:6070 --wallet relayer.json --loopback
//! ```
//!
//! O adaptador de laço é de DEMONSTRAÇÃO: simula a cadeia externa em memória e
//! devolve cada pagamento como depósito, fechando o ciclo sem depender de TRON ou
//! Ethereum. Cadeias de verdade entram implementando `AdaptadorDeCadeia`.

use std::sync::Arc;
use std::time::Duration;

use eav7_sdk::bridge::{AdaptadorDeCadeia, AdaptadorDeLaco, Relayer};

const USO: &str = "\
uso: eav7-relayer --wallet <arquivo.json> [--node <url>] [--intervalo <ms>] [--loopback]

  --wallet     carteira do relayer (precisa estar autorizada on-chain)
  --node       nó a consultar (padrão http://127.0.0.1:6070)
  --intervalo  espera entre ciclos, em ms (padrão 3000)
  --loopback   pluga o adaptador de demonstração, com eco
";

fn main() {
    let mut node = "http://127.0.0.1:6070".to_string();
    let mut wallet: Option<String> = None;
    let mut intervalo = 3_000u64;
    let mut loopback = false;

    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--node" => node = args.next().unwrap_or_default(),
            "--wallet" => wallet = args.next(),
            "--intervalo" => intervalo = args.next().and_then(|v| v.parse().ok()).unwrap_or(3_000),
            "--loopback" => loopback = true,
            "-h" | "--help" => {
                println!("{USO}");
                return;
            }
            outro => {
                eprintln!("argumento desconhecido: {outro}\n\n{USO}");
                std::process::exit(2);
            }
        }
    }

    let Some(wallet) = wallet else {
        eprintln!("{USO}");
        std::process::exit(2);
    };

    let carteira = match eav7_sdk::ProductionWallet::from_file(&wallet) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("carteira: {e}");
            std::process::exit(1);
        }
    };

    let mut adaptadores: Vec<Arc<dyn AdaptadorDeCadeia>> = Vec::new();
    if loopback {
        adaptadores.push(Arc::new(AdaptadorDeLaco::novo("LOOPBACK", true)));
    }
    if adaptadores.is_empty() {
        eprintln!(
            "nenhum adaptador de cadeia plugado — o relayer não teria o que pagar.\n\
             Use --loopback para a demonstração, ou compile com um adaptador real."
        );
        std::process::exit(2);
    }

    let mut relayer = match Relayer::novo(&node, Box::new(carteira), adaptadores) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("relayer: {e}");
            std::process::exit(1);
        }
    };
    relayer.observar_depositos();
    println!("[ponte] relayer {} ativo em {node} (ciclo a cada {intervalo} ms)", relayer.endereco());

    // Laço síncrono: um ciclo por vez, sem reentrância possível. O `ticking` da
    // referência existe porque lá o ciclo é assíncrono e podia se sobrepor.
    loop {
        match relayer.ciclo() {
            Ok(0) => {}
            Ok(n) => println!("[ponte] {n} BRIDGE_SETTLE submetido(s)"),
            // Erro de ciclo não derruba o processo: o nó pode estar reiniciando, a
            // rede oscilando. Um relayer que morre no primeiro timeout é pior que
            // um que insiste.
            Err(e) => eprintln!("[ponte] erro no ciclo: {e}"),
        }
        std::thread::sleep(Duration::from_millis(intervalo));
    }
}
