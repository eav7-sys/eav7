/** Custódia pública do gênese (whitepaper §12 / boot). */
export const CUSTODY = [
  {
    id: "public",
    label: "Público · 45%",
    labelEn: "Public · 45%",
    address: "E7AADB9206205894E8C8D7A9B6FE6C8320",
    sharePct: 45,
    role: "PublicVault implantado · LBP preparado (marketing condicionado)",
    roleEn: "PublicVault deployed · LBP prepared (marketing gated)",
  },
  {
    id: "private",
    label: "Venda privada · 14,75%",
    labelEn: "Private sale · 14.75%",
    address: "E7C66510442208FEA89FAFC30BE666CCB0",
    sharePct: 14.75,
    role: "Custódia até SaleVault · cliff 12m + linear 24m",
    roleEn: "Custody until SaleVault · 12m cliff + 24m linear",
  },
  {
    id: "partner",
    label: "Parceiro · 10%",
    labelEn: "Partner · 10%",
    address: "E72F728E69D24CFB91C167A805C6472D40",
    sharePct: 10,
    role: "4 tranches · cooldown 12m",
    roleEn: "4 tranches · 12m cooldown",
  },
  {
    id: "treasury",
    label: "Fundação / Tesouraria · 30,25%",
    labelEn: "Foundation / Treasury · 30.25%",
    address: "E7F2906EA4B2CD23D20180C8E813F2D126",
    sharePct: 30.25,
    role: "Stake âncoras + vesting 12 partes",
    roleEn: "Anchor stake + 12-part vesting",
  },
] as const;

export type CustodyId = (typeof CUSTODY)[number]["id"];

/** Plano do bucket público (Opção A · LBP → TimelockLpSeeder → AMM). */
export const PUBLIC_MARKET_PLAN = {
  source: "contracts/sale/public-distribution.json",
  pricing: "contracts/sale/public-lbp-delivery.json",
  ops: "docs/listing/FASE2-OPS.md",
  status: "chosen-option-a" as const,
  partition: [
    { id: "lbp", sharePct: 30, tokens: "13.500.000.000", note: "LBP / dutch · 72h · $0.008→$0.015" },
    { id: "lp", sharePct: 50, tokens: "22.500.000.000", note: "Seed AMM EAV7/USDT · LP lock 18m" },
    { id: "cex", sharePct: 15, tokens: "6.750.000.000", note: "Buffer CEX · multisig" },
    { id: "incentives", sharePct: 5, tokens: "2.250.000.000", note: "Incentives / drip" },
  ],
};
