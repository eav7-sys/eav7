import type { MetadataRoute } from "next";

const BASE = "https://eavscan.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/blocks", "/txs", "/validators", "/tokens", "/nfts", "/names", "/governance", "/wallet", "/mining"];
  return routes.map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: path === "" || path === "/blocks" || path === "/txs" ? "always" : "daily",
    priority: path === "" ? 1 : 0.7,
  }));
}
