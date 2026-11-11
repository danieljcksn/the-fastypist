import { expect, test } from "@playwright/test";

// These run against the build e2e uses, which has accounts off until a Clerk secret exists.
const RANKING_PAGES = [
  ["/today", "Rankings aren't open yet.", "take the test", "/"],
  ["/pt-br/today", "O ranking ainda não abriu.", "fazer o teste", "/pt-br"],
  ["/u/someone", "Rankings aren't open yet.", "take the test", "/"],
  ["/pt-br/u/someone", "O ranking ainda não abriu.", "fazer o teste", "/pt-br"],
  ["/r/2f1c3a52-8d7e-4f61-9a0b-7c5d4e3f2a1b", "Rankings aren't open yet.", "take the test", "/"],
] as const;

test.describe("with accounts off", () => {
  test("the header links no board, in either language", async ({ page }) => {
    for (const path of ["/", "/pt-br", "/about", "/progress"]) {
      await page.goto(path);
      await expect(page.locator("header nav a").first()).toBeVisible();
      await expect(page.locator("header").getByRole("link", { name: /^(today|hoje)$/ })).toHaveCount(0);
      await expect(page.locator('header a[href$="/today"]')).toHaveCount(0);
    }
  });

  for (const [path, line, action, home] of RANKING_PAGES) {
    test(`${path} says in one line it isn't open yet, and offers the test`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(line);
      await expect(page.getByTestId("today-board")).toHaveCount(0);
      // The same line at every address, so none of them may stand in a search result.
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[rel="canonical"], link[rel="alternate"][hreflang]')).toHaveCount(0);
      await page.getByRole("link", { name: action }).click();
      await page.waitForURL((url) => url.pathname === home);
      await expect(page.locator(".tp-word").first()).toBeVisible();
    });
  }

  test("the share images say what the site is, and nothing about anyone", async ({ request }) => {
    const images: Buffer[] = [];
    for (const path of ["/today/opengraph-image", "/u/someone/opengraph-image", "/r/2f1c3a52-8d7e-4f61-9a0b-7c5d4e3f2a1b/opengraph-image"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["content-type"], path).toBe("image/png");
      images.push(await response.body());
    }
    // One image for all three is the proof that none of them read a profile or a run.
    expect(images[1]?.equals(images[0] ?? Buffer.alloc(0))).toBe(true);
    expect(images[2]?.equals(images[0] ?? Buffer.alloc(0))).toBe(true);
  });

  test("the sitemap leaves the boards out", async ({ request }) => {
    const body = await (await request.get("/sitemap.xml")).text();
    expect(body).toContain("/about");
    expect(body).not.toContain("/today");
    expect(body).not.toContain("/standings");
  });

  test("the closed page fits a phone with no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/today");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
});

test.describe("with a signed-in session", () => {
  test.skip(true, "Needs a real Clerk session, and CLERK_SECRET_KEY is empty, so accounts are off in this build.");

  test("revealing today's text warns first, then starts a 60 second run on it", async () => {});
  test("a board row and a profile each report in one click", async () => {});
  test("a held run offers retype to confirm and request review", async () => {});
  test("/admin answers 404 to anyone without the admin role", async () => {});
});
