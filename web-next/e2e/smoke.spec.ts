import { test, expect } from "@playwright/test";

/**
 * Smoke com mock opt-in: garante que o redesenho scan não devolve tela branca.
 * Rodar: NEXT_PUBLIC_USE_MOCK=true npm run build && npm run start &
 *        NEXT_PUBLIC_USE_MOCK=true npx playwright test
 *
 * Em CI, o job web-next pode passar a subir o server após o build.
 */
const rotas = ["/", "/blocks", "/txs", "/validators", "/tokens"];

for (const rota of rotas) {
  test(`smoke ${rota}`, async ({ page }) => {
    const res = await page.goto(rota, { waitUntil: "domcontentloaded" });
    expect(res?.ok() || res?.status() === 304).toBeTruthy();
    await expect(page.locator("body")).not.toBeEmpty();
  });
}
