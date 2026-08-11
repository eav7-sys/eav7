/** Public treasury rails for the private sale UI. Mirrors contracts/sale/payment-rails.json */
export type SaleRail = {
  id: string;
  chain: string;
  asset: string;
  standard: string;
  receive: string;
  explorer: string;
  token?: string;
  decimals?: number;
};

export const SALE_PRICE_USD_PER_EAV7 = 0.008;

/** Fallback display — preço ao vivo vem de /sale-api/quote (tiers). */

export const SALE_RAILS: SaleRail[] = [
  {
    id: "eth-usdt",
    chain: "ethereum",
    asset: "USDT",
    standard: "ERC-20",
    receive: "0x2ddd408bbd8c84fb64ac950f578e9297e7002a35",
    explorer: "https://etherscan.io/address/0x2ddd408bbd8c84fb64ac950f578e9297e7002a35",
    token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
  },
  {
    id: "eth-usdc",
    chain: "ethereum",
    asset: "USDC",
    standard: "ERC-20",
    receive: "0x2ddd408bbd8c84fb64ac950f578e9297e7002a35",
    explorer: "https://etherscan.io/address/0x2ddd408bbd8c84fb64ac950f578e9297e7002a35",
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
  },
  {
    id: "bsc-usdt",
    chain: "bsc",
    asset: "USDT",
    standard: "BEP-20",
    receive: "0x2ddd408bbd8c84fb64ac950f578e9297e7002a35",
    explorer: "https://bscscan.com/address/0x2ddd408bbd8c84fb64ac950f578e9297e7002a35",
    token: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
  },
  {
    id: "bsc-usdc",
    chain: "bsc",
    asset: "USDC",
    standard: "BEP-20",
    receive: "0x2ddd408bbd8c84fb64ac950f578e9297e7002a35",
    explorer: "https://bscscan.com/address/0x2ddd408bbd8c84fb64ac950f578e9297e7002a35",
    token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
  },
  {
    id: "tron-usdt",
    chain: "tron",
    asset: "USDT",
    standard: "TRC-20",
    receive: "TMymUyjrF1aumbr7FYGnfJdca1dkndg6qj",
    explorer: "https://tronscan.org/#/address/TMymUyjrF1aumbr7FYGnfJdca1dkndg6qj",
    token: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    decimals: 6,
  },
  {
    id: "tron-usdc",
    chain: "tron",
    asset: "USDC",
    standard: "TRC-20",
    receive: "TMymUyjrF1aumbr7FYGnfJdca1dkndg6qj",
    explorer: "https://tronscan.org/#/address/TMymUyjrF1aumbr7FYGnfJdca1dkndg6qj",
    token: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
    decimals: 6,
  },
  {
    id: "btc",
    chain: "bitcoin",
    asset: "BTC",
    standard: "native",
    receive: "bc1q0h3d69d03c7wwaul97xq322l64c0lag2nddy3j",
    explorer: "https://mempool.space/address/bc1q0h3d69d03c7wwaul97xq322l64c0lag2nddy3j",
  },
  {
    id: "sol-usdt",
    chain: "solana",
    asset: "USDT",
    standard: "SPL",
    receive: "E1fuh28E9nFkvWEpUYujvnWChB7modBhitBP4fqTyedt",
    explorer: "https://solscan.io/account/E1fuh28E9nFkvWEpUYujvnWChB7modBhitBP4fqTyedt",
    token: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
  },
  {
    id: "sol-usdc",
    chain: "solana",
    asset: "USDC",
    standard: "SPL",
    receive: "E1fuh28E9nFkvWEpUYujvnWChB7modBhitBP4fqTyedt",
    explorer: "https://solscan.io/account/E1fuh28E9nFkvWEpUYujvnWChB7modBhitBP4fqTyedt",
    token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
  },
];

export const CHAIN_LABEL: Record<string, string> = {
  ethereum: "Ethereum",
  bsc: "BNB Chain",
  tron: "TRON",
  bitcoin: "Bitcoin",
  solana: "Solana",
};

/** Demo quote — unique suffix among intents (matches relayer). */
export function quotePayAmount(usd: number, decimals: number, nonce: number): string {
  let amount: bigint;
  if (decimals === 18) {
    amount = BigInt(Math.round(usd * 1e6)) * 10n ** 12n;
  } else if (decimals === 6) {
    amount = BigInt(Math.round(usd * 1e6));
  } else {
    amount = BigInt(Math.round(usd * 10 ** decimals));
  }
  const mod = amount >= 1_000_000n ? 1_000_000n : 10_000n;
  const suffix = BigInt(nonce) % mod;
  amount = amount - (amount % mod) + suffix;
  return amount.toString();
}

export function formatTokenAmount(raw: string, decimals: number): string {
  const n = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
