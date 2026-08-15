# Comunicação TGE / LBP pública

Rascunho para post manual (X / site) **quando** o TGE público for anunciado.

**Estado (12 ago 2026):** vault já teve `openLbp` on-chain (`lbpSold=0`), mas marketing e `/price` estão em **private-first** (`status: lbp-prepared` → Launch **$0.005**). Só poste o texto abaixo depois de voltar `status` para `lbp-open` no JSON + redeploy do front.

A LBP on-chain tem deadline altura **262603**.

## Links canónicos

| Uso | URL |
|---|---|
| Comprar (público) | https://eavscan.com/sale/public |
| Whitepaper | https://eavscan.com/whitepaper |
| Market / free float | https://eavscan.com/market |
| Add network | https://eavscan.com/developers/networks#add-network |
| RPC | https://rpc.eavscan.com |
| Chainlist | https://chainlist.org/chain/72020 |
| Explorer | https://eavscan.com |
| Privacidade RPC | https://eavscan.com/privacy#rpc |

## X — PT (curto)

```
EAV7 — janela pública (LBP) aberta.

~72h · preço $0.008 → $0.015 (tiers por USD levantado)
Entrega líquida via PublicVault
Compra: https://eavscan.com/sale/public
Whitepaper: https://eavscan.com/whitepaper
Rede: Chain ID 72020 · RPC https://rpc.eavscan.com

Riscos: mercado novo, volatilidade, sem pool AMM anunciado ainda.
Após a janela: seed LP → DEX canónica. CG/CMC só com mercado real.
```

## X — EN (short)

```
EAV7 — public LBP window is open.

~72h · $0.008 → $0.015 (raised-USD tiers)
Liquid delivery via PublicVault
Buy: https://eavscan.com/sale/public
Whitepaper: https://eavscan.com/whitepaper
Network: Chain ID 72020 · RPC https://rpc.eavscan.com

Risks: new market, volatility; no AMM pool announced yet.
After the window: LP seed → canonical DEX. CG/CMC only with real market.
```

## Site / Discord (1 parágrafo)

**PT:** A distribuição pública da EAV7 está aberta por cerca de 72 horas. O preço sobe em tiers de $0.008 a $0.015 conforme o USD confirmado. Tokens saem líquidos do PublicVault após pagamento nas rails. Ainda não há pool AMM nem listing em CoinGecko/CMC — isso vem depois do fim da janela e do seed de liquidez. Detalhes: [sale/public](https://eavscan.com/sale/public) · [whitepaper](https://eavscan.com/whitepaper) · [market](https://eavscan.com/market).

**EN:** EAV7’s public distribution window is open for about 72 hours. Price steps from $0.008 to $0.015 by confirmed USD raised. Tokens are liquid from PublicVault after payment on the published rails. There is no AMM pool or CoinGecko/CMC listing yet — those follow window end and LP seed. Details: [sale/public](https://eavscan.com/sale/public) · [whitepaper](https://eavscan.com/whitepaper) · [market](https://eavscan.com/market).

## Não overclaim

- [ ] Não dizer “listado na Trust” nativo — só custom network / Chainlist
- [ ] Não anunciar pool DEX / Trade live até router + seed existirem
- [ ] Não anunciar CoinGecko / CoinMarketCap
- [ ] Não prometer APY, listing CEX ou preço-alvo
- [ ] Deixar claro: risco de perda · software experimental · L1 nova

## Após post

1. Colar links nos canais (X, Telegram, Discord)
2. Monitorar relayer (`raisedUsd` no `/quote`) e `lbpSold` on-chain
3. No deadline / sold-out: keeper `finalizeToLp` (ver [`FASE2-OPS.md`](./FASE2-OPS.md))
