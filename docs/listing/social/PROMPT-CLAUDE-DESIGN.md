# Prompt — Claude Design · artes EAV7 para divulgação

Copia o bloco entre `<<<PROMPT` e `PROMPT>>>` para o Claude Design.  
Anexa como referência visual:

- `docs/listing/social/eav7-private-sale-ig.png` (arte atual Private Sale)
- `web-next/public/icon-512.png` (ícone da marca)

---

<<<PROMPT

You are art director for **EAV7**, an L1 blockchain (protocol eav20). Produce a cohesive set of **promotional stills** for Instagram, X, and Stories. Match the existing brand frame — do **not** invent a new logo.

## Brand lockup (canonical)

- Mark: large bold white **“7”** inside a **double heptagon** (7-sided polygon).
  - Outer stroke: neon purple `#9F7BFF` / `#7242D4`
  - Inner stroke: thin cyan `#2EE6D6`
  - Small glowing nodes at vertices (mostly purple; one cyan accent at the top vertex)
- Under the 7, inside the mark: spaced caps **E A V** in white
- Product names when needed: **EAV7** (token/network) · **EAVSCAN** (explorer)
- Never use generic crypto clichés: Bitcoin/ETH logos, rockets, moons, dollar rain, glossy 3D coins, stock-photo people

## Color & atmosphere

- Base: deep charcoal / near-black `#0B0B10`–`#121218`
- Accents: violet `#6336C4` → `#9F7BFF`, cyan `#2EE6D6`
- Gold `#F39C12` **only** on Testnet pieces
- Soft nebula glow in corners (purple top-left, cyan bottom-right) + faint dark square grid
- Style: neon-noir Web3, minimal, high contrast, generous negative space
- Type: geometric sans (Space Grotesk / Inter). URLs in monospace
- Keep ~8% safe margin from edges; readable on mobile

## Compliance (hard)

Private Sale pieces must show:

- Launch **$0.005**
- Vesting **14.75% · 12m cliff + 24m linear**
- URL **eavscan.com/sale**

Do **not** claim: AMM pool, CEX listing, CoinGecko/CMC, “Trust Wallet native”, APY, price targets, guarantees.

Do **not** announce public LBP / TGE unless the piece is clearly marked **DRAFT — not for publish**.

Testnet: gold accent OK · say **test coins · no value** · Chain ID **72021** · `testnet.eavscan.com`  
Mainnet explorer: Chain ID **72020** · `eavscan.com` · RPC `rpc.eavscan.com`

## Deliverables (one image each)

### A — Instagram square 1080×1080

1. **Private Sale hero (PT layout)**  
   Heptagon mark centered top.  
   `PRIVATE SALE`  
   `Launch · $0.005`  
   Cyan line: `14.75% · vesting 12m cliff + 24m linear`  
   Mono footer: `eavscan.com/sale`

2. **Private Sale hero (EN)** — same composition; English support line if needed; numbers identical.

3. **EAVSCAN Mainnet**  
   `EAVSCAN`  
   `Mainnet · Chain ID 72020`  
   `rpc.eavscan.com`  
   Footer: `eavscan.com`

4. **Testnet live** (gold accent)  
   `TESTNET`  
   `Chain ID 72021 · test coins · no value`  
   `Faucet · 100 EAV7 / hour`  
   Footer: `testnet.eavscan.com`

5. **Whitepaper** (quieter neon)  
   Headline: `Whitepaper`  
   Sub: `Protocol eav20 · L1`  
   Footer: `eavscan.com/whitepaper`

6. **Add network / MetaMask**  
   `ADD NETWORK`  
   `Chain ID 72020`  
   `RPC rpc.eavscan.com`  
   Footer: `eavscan.com/developers/networks`

### B — Stories / Reels cover 1080×1920 (same 6 themes)

Vertical crop of each theme. Mark in upper third; text stacked in lower half; large tap-safe margin at bottom.

### C — X / LinkedIn landscape 1600×900

1. Private Sale banner (PT)  
2. Private Sale banner (EN)  
3. Testnet banner (gold)  
4. EAVSCAN / RPC banner  

Same lockup, more horizontal breathing room; mark left or center-left; copy on the right.

### D — Avatar / profile pack

1. App icon 1024×1024 — heptagon + 7 only, no text  
2. Round-crop safe version (keep critical content inside the center 80%)

## Output format

For each piece return:

1. The image  
2. Filename suggestion (e.g. `eav7-private-sale-ig-pt.png`)  
3. One-line usage note (IG feed / Story / X header)

Prefer flat vector-like lighting over photoreal CGI. Match the attached Private Sale reference as closely as possible for mark geometry and glow.

PROMPT>>>

---

## Checklist rápido depois de gerar

- [ ] Heptágono + “7” + E A V iguais à referência  
- [ ] Private Sale: $0.005 e vesting corretos  
- [ ] Sem overclaim (AMM / CEX / CG / APY)  
- [ ] Testnet só com dourado + “no value”  
- [ ] Versões PT e EN da sale  
- [ ] Stories 9:16 + feed 1:1 + banner 16:9  

Salvar entregas em `docs/listing/social/`.
