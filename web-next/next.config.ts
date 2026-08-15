import type { NextConfig } from "next";

// Origem do backend REST do nó EAV7 (interno). Usado para o proxy /api/* em produção.
const API_ORIGIN = process.env.EAV7_API_ORIGIN;

// `npm run build` roda em web-next/; process.cwd() evita import.meta (quebra o loader ESM do Next).
const webRoot = process.cwd();

const nextConfig: NextConfig = {
  // Self-hosting: gera um servidor Node autocontido (não obriga Vercel).
  output: "standalone",
  // Monorepo: sem isto o file tracer sobe até a raiz do git e puxa rust/ (~68GB).
  // Não use outputFileTracingExcludes com "../…" — Turbopack 16 panica nesses globs.
  outputFileTracingRoot: webRoot,
  // Garante que o JSON de preço/venda vá no standalone (GET /price).
  outputFileTracingIncludes: {
    "/price": ["./data/**/*"],
    "/price/history": ["./data/**/*"],
    "/price/convert": ["./data/**/*"],
    "/sale-api/quote": ["./data/**/*"],
    "/whitepaper": ["./content/whitepaper/**/*"],
  },

  // Playwright / CI falam com o dev server em 127.0.0.1 (não localhost).
  allowedDevOrigins: ["127.0.0.1"],

  // Self-host sem 'sharp': serve as imagens diretas (sem passar por /_next/image).
  // As imagens ficam em public/ e são servidas pelo próprio servidor.
  images: { unoptimized: true },

  // Same-origin sem colisão de rotas: a UI ocupa a raiz (/blocks, /tx, …) e a
  // API do nó é servida sob /api/* (a UI chama NEXT_PUBLIC_API_BASE=/api).
  async rewrites() {
    const base = [
      { source: "/privacy", destination: "/privacy.html" },
      { source: "/rpc-privacy", destination: "/rpc-privacy.html" },
    ];
    if (!API_ORIGIN) return base;
    return [...base, { source: "/api/:path*", destination: `${API_ORIGIN}/:path*` }];
  },

  // G10: aliases dos fronts legados (`public/app.html`, `/explorer`, SPA Vite).
  async redirects() {
    return [
      { source: "/app", destination: "/mining", permanent: true },
      { source: "/explorer", destination: "/", permanent: true },
      { source: "/scan", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
