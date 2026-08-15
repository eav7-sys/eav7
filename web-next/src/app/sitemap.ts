import type { MetadataRoute } from "next";

const BASE = "https://eavscan.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "",
    "/blocks",
    "/txs",
    "/validators",
    "/tokens",
    "/nfts",
    "/names",
    "/governance",
    "/wallet",
    "/mining",
    "/market",
    "/whitepaper",
    "/sale/public",
  ];
  // O portal do desenvolvedor é conteúdo estático: muda por release, não por bloco.
  const developers = [
    "/developers",
    "/developers/quickstart",
    "/developers/networks",
    "/developers/concepts/accounts",
    "/developers/concepts/resources",
    "/developers/concepts/transactions",
    "/developers/concepts/finality",
    "/developers/guides",
    "/developers/guides/sign-broadcast",
    "/developers/guides/transfer",
    "/developers/guides/stake-vote",
    "/developers/guides/token-eav20",
    "/developers/guides/light-client",
    "/developers/guides/metamask",
    "/developers/guides/run-node",
    "/developers/api",
    "/developers/api/json-rpc",
    "/developers/transactions",
    "/developers/eavm",
    "/developers/errors",
    "/developers/sdk",
    "/developers/core",
    "/developers/integrations",
    "/developers/troubleshooting",
  ];
  return [
    ...routes.map((path) => ({
      url: `${BASE}${path}`,
      changeFrequency:
        path === "" || path === "/blocks" || path === "/txs" ? ("always" as const) : ("daily" as const),
      priority: path === "" ? 1 : 0.7,
    })),
    ...developers.map((path) => ({
      url: `${BASE}${path}`,
      changeFrequency: "weekly" as const,
      priority: path === "/developers" ? 0.8 : 0.6,
    })),
  ];
}
