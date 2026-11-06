import { expect, test } from "@playwright/test";

test("each language declares itself and links to the other", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("link", { name: "português" }).click();
  await expect(page).toHaveURL(/\/pt-br$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
});
