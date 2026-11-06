import { expect, test, type Page } from "@playwright/test";
import { ready, typeAll, typeSlowOn, typeText, upcoming, withText } from "./helpers";

const HEAVY = ["the", "then", "they", "than", "that", "with", "other", "think", "rather", "about", "where", "would", "could", "their", "those", "three", "through", "which"];

test("drill round trip: result to drill to the measured change, never a best", async ({ page }) => {
  test.setTimeout(90_000);
  const words = Array.from({ length: 36 }, (_, i) => HEAVY[i % HEAVY.length] as string);
  await withText(page, words);
  await page.goto("/");
  await ready(page);
  await typeSlowOn(page, words, "th");
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("diagnosis")).toContainText("th");
  await expect(page.getByTestId("primary-action")).toContainText("drill th");

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("drill-pairs")).toHaveText("th");
  await expect(page.locator(".tp")).toHaveAttribute("data-phase", "idle");
  await expect(page.locator(".tp-n")).toHaveText("30");
  const text = await upcoming(page);
  expect(text.split(" ").filter((word) => word.includes("th")).length).toBe(text.split(" ").length);

  await typeAll(page);
  await expect(page.getByTestId("drill-table")).toBeVisible();
  const row = page.getByTestId("drill-table").locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-verdict", "faster");
  await expect(page.getByTestId("diagnosis")).toContainText("ms faster");
  await expect(page.getByTestId("best-line")).toHaveCount(0);
  await expect(page.getByTestId("primary-action")).toContainText("drill again");

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("fastypist:history") ?? "{}").rows as { kind: string; id: string }[]);
  expect(stored.map((r) => r.kind)).toEqual(["free", "drill"]);
  const bests = await page.evaluate(() => JSON.parse(localStorage.getItem("fastypist:bests") ?? "{}").bests);
  expect(Object.values(bests)).toHaveLength(0);

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("drill-pairs")).toHaveText("th");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("drill-pairs")).toHaveText("th");
  await page.getByRole("button", { name: "stop drilling" }).click();
  await expect(page.getByTestId("drill-pairs")).toHaveCount(0);
  await expect(page.locator(".tp-input")).toBeFocused();
});

test("a drill never touches a real best on the same mode", async ({ page }) => {
  await page.goto("/?mode=words&n=10");
  await ready(page);
  await typeAll(page, 0);
  await expect(page.getByTestId("result")).toBeVisible();
  await page.waitForTimeout(200);
  const before = await readBests(page);
  expect(Object.keys(before)).toHaveLength(1);
  await page.goto("/?drill=th,qu&lang=en");
  await ready(page);
  await expect(page.getByTestId("drill-pairs")).toHaveText("th and qu");
  await typeAll(page, 0);
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("drill-table")).toBeVisible();
  expect(await readBests(page)).toEqual(before);
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("drill-pairs")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

const readBests = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("fastypist:bests") ?? "{}").bests as Record<string, unknown>);

test("a bad drill link just gives a normal test", async ({ page }) => {
  await page.goto("/?drill=%3Cscript%3E");
  await ready(page);
  await expect(page.getByTestId("drill-pairs")).toHaveCount(0);
  await expect(page.locator(".tp-sentence")).toContainText("english");
});

test("a pair with no word on the list says so and stays on the result", async ({ page }) => {
  const words = Array.from({ length: 30 }, () => "zxqv");
  await withText(page, words);
  await page.goto("/");
  await ready(page);
  await typeSlowOn(page, words, "xq");
  await expect(page.getByTestId("primary-action")).toContainText("xq");
  await page.keyboard.press("Enter");
  await expect(page.getByText("No word on the list holds those pairs.")).toBeVisible();
  await expect(page.getByTestId("result")).toBeVisible();
});

test("the pace caret follows the best run, by the clock, when it's on", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?mode=words&n=25");
  await ready(page);
  const run = async (delay: number) => {
    await typeAll(page, delay);
    await expect(page.getByTestId("result")).toBeVisible();
    await page.waitForTimeout(300);
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("result")).toHaveCount(0);
  };
  await run(15);

  await expect(page.locator(".tp-pace")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "settings" }).click();
  await page.getByRole("switch", { name: "pace caret" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.locator(".tp-viewport").click();
  await expect(page.locator(".tp-pace")).toBeHidden();

  const first = (await upcoming(page)).split(" ")[0] ?? "";
  await typeText(page, first.charAt(0));
  await expect(page.locator(".tp-pace")).toBeVisible();
  const at = async () => page.locator(".tp-pace").evaluate((el) => (el as HTMLElement).style.transform);
  const start = await at();
  // No keys pressed from here: only the clock can be moving it.
  await expect.poll(at, { timeout: 8_000 }).not.toBe(start);

  await page.keyboard.press("Escape");
  await expect(page.locator(".tp-pace")).toBeHidden();
});
