# Plano: melhorias do `eav7-sdk`

O SDK **já é Rust** (`rust/sdk/`). Depende só do consenso (`eav7`), nunca do nó.
Cliente HTTP síncrono (`ureq`) de propósito.

Este arquivo mapeia o backlog do SDK e **amarra cada item** às fases do Core /
carteira em [08-descentralizacao-core-carteira.md](08-descentralizacao-core-carteira.md).
Visão de conjunto: [10-mapa-integrado.md](10-mapa-integrado.md).

## O que já cobre bem

| Capacidade | Onde |
|---|---|
| Carteira híbrida compatível com JSON do Node | `wallet.rs` |
| `transferir` / `stake` / `unstake` / `votar` | `cliente.rs` |
| Nonce ciente do mempool (por chamada) | `executar` |
| Light client parcial: `saldo_provado` + Merkle | `cliente.rs` |
| Relayer da ponte com anti-pagamento-duplo | `bridge.rs` |
| Faucet de testnet | `faucet.rs` |
| `Debug` sem vazar chave; escape `get()` cru | `cliente.rs` |

O **web-next não usa este crate** — fala HTTP em TypeScript. Core, CLI, relayer
e (no futuro) bindings mobile é que consomem o SDK.

## Fase S — SDK primeiro (2–3 semanas)

Fazer **antes** de engordar o Core (A/B) e o app (C). Evita cada produto
reinventar confirmação, tipos e nonce.

### P0 — desbloqueia Core + carteira

| ID | Melhoria | Por quê | Desbloqueia | Esforço |
|---|---|---|---|---|
| S1 | `aguardar_confirmacao(id, timeout)` | Hoje só “aceitou no mempool” | UX Core/app; relayer também se beneficia | S |
| S2 | `Remetente` com reserva de nonce (extrair do relayer) | Rajada de txs sem colisão | Stake+voto+claim em sequência; faucet; scripts | M |
| S3 | Tipos: `Validador` (+ performance), `TxResumida`, `historico()` | API já tem rotas; SDK devolve JSON cru | Tela voto (C2), score do Core (B5), histórico | M |

### P1 — fecha fluxos do plano 08

| ID | Melhoria | Por quê | Desbloqueia | Esforço |
|---|---|---|---|---|
| S4 | `Conta` com unbonding + `reivindicar_recompensa()` | B1 e diagrama “reivindicar” | Fluxo stake completo | S |
| S5 | `raiz_confiavel_do_header()` (verifica bloco, lê `stateRoot`) | Fecha o light client | Core em modo ouvinte mais honesto; app que não confia cego no nó | M |
| S6 | Builder: timeout / URL / (opcional) só-HTTPS | 30s fixo é ruim no celular | App (C); Core quer timeout menor | S |
| S7 | `ErroCarteira` enum; saldo ausente ≠ 0 silencioso | DX e bug de carteira | Todos os consumidores | S |

### P2 — higiene / mobile depois

| ID | Melhoria | Por quê | Desbloqueia | Esforço |
|---|---|---|---|---|
| S8 | `gerar_em(path)` com permissão restrita (0o600 / ACL Win) | Cabeçalho cita 0o600 mas não grava | `eav7-core init` (A5) | S |
| S9 | Retry opcional só em GET | Rede instável | App celular | S |
| S10 | Crate `eav7-sdk-ffi` (uniffi) | Só **depois** de decidir stack do app | Expo nativo falando Rust | L |
| S11 | Zeroize de PEM intermediário | Defesa em profundidade | Hardening | S |

## O que não mexer no SDK

- Manter síncrono / sem tokio imposto.
- Não “limpar” serialização canônica da tx (byte a byte com a referência).
- Não alterar a semântica anti-pagamento-duplo do relayer ao extrair o nonce (S2).
- Não puxar o crate do nó para dentro do SDK.

## Critério de pronto da Fase S

1. Teste: duas `transferir` seguidas da mesma carteira → dois nonces, ambas
   confirmadas em bloco (S1+S2).
2. `validadores_tipados()` expõe `name` + campos de performance sem
   `serde_json::Value` na API pública (S3).
3. `historico(addr)` pagina com o cursor `before` da API (S3).
4. `unstake` + leitura de unbonding + `reivindicar_recompensa` cobertos por teste
   de integração contra nó de teste (S4).
5. `cargo test -p eav7-sdk` verde; exemplos `enviar` / `consulta` atualizados.

## Progresso (2026-08-09)

Entregue no código: `aguardar_confirmacao`, `Remetente`, `validadores_tipados`,
`historico`, `unbonding` em `Conta`, `reivindicar_recompensa`, `com_timeout`.
`cargo test -p eav7-sdk` — 16 ok. Integração contra nó vivo (critérios 1 e 4
end-to-end) ainda falta.

## Ligação com dual-client

Métodos novos do SDK só **leem/escrevem rotas que já existem** nos dois nós
(JS + Rust), ou exigem a rota nova nos **dois** enquanto o JS for produção —
mesma regra do plano de migração.
