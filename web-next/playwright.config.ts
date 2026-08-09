import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    headless: true,
  },
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        // `next dev` + mock opt-in: o build de produção recusa USE_MOCK=true.
        command: "npm run dev -- --port 3000",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          NEXT_PUBLIC_USE_MOCK: "true",
        },
      },
});
