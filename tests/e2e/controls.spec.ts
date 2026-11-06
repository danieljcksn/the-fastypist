import { expect, test } from "@playwright/test";
import { ready, readWords, typeText } from "./helpers";

test("the mode popover opens, keeps focus inside, closes on Esc and changes the test", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  const trigger = page.locator('[data-menu-trigger="mode"]');
  await trigger.focus();
  await page.keyboard.press("Enter");
  const pop = page.getByRole("dialog", { name: "Choose a test" });
  await expect(pop).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(pop.getByRole("button", { name: "60" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(pop).toBeVisible();
  await pop.getByRole("button", { name: "25" }).click();
  await expect(pop).toBeHidden();
  await expect(page.locator(".tp-n")).toHaveText("25");
  await expect(page.locator(".tp-input")).toBeFocused();
  await expect(page.locator(".tp-sentence")).toContainText("words of english");
  expect((await readWords(page)).length).toBe(25);

  await page.reload();
  await ready(page);
  await expect(page.locator(".tp-n")).toHaveText("25");
});

test("a click outside closes a popover, and typing is not stolen while it is open", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.locator('[data-menu-trigger="language"]').click();
  const pop = page.getByRole("dialog", { name: "Choose the words" });
  await expect(pop).toBeVisible();
  await page.keyboard.press("q");
  await expect(page.locator(".tp")).toHaveAttribute("data-phase", "idle");
  await expect(pop).toBeVisible();
  await page.mouse.click(700, 800);
  await expect(pop).toBeHidden();
  await expect(page.locator(".tp-input")).toBeFocused();
});

test("list and toggles change the words live, and Portuguese offers accent-free", async ({ page }) => {
  await page.goto("/pt-br");
  await ready(page);
  await page.locator('[data-menu-trigger="language"]').click();
  const pop = page.getByRole("dialog");
  const first = await readWords(page);
  await pop.getByRole("button", { name: "5k" }).click();
  await expect(page.locator(".tp-sentence")).toContainText("português 5k");
  await expect.poll(() => readWords(page)).not.toEqual(first);
  await pop.getByRole("button", { name: "sem acentos" }).click();
  await expect(page.locator(".tp-sentence")).toContainText("sem acentos");
  const words = await page.$$eval(".tp-word", (els) => els.map((el) => el.textContent).join(" "));
  expect(words).not.toMatch(/[áàâãéêíóôõúç]/);
});

test("quote mode shows a real passage and its word count", async ({ page }) => {
  await page.goto("/?mode=quote");
  await ready(page);
  await expect(page.locator(".tp-sentence")).toContainText("words of a quote in english");
  const count = Number(await page.locator(".tp-n").textContent());
  expect(count).toBeGreaterThan(5);
});

test("custom text validates through parseCustomText", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.locator('[data-menu-trigger="mode"]').click();
  await page.getByRole("button", { name: "custom" }).click();
  const dialog = page.getByRole("dialog", { name: "Your own text" });
  await expect(dialog).toBeVisible();
  const area = dialog.locator("textarea");
  await expect(area).toBeFocused();

  await dialog.getByRole("button", { name: "use this text" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Add some text first.");
  await area.fill("x".repeat(2100));
  await dialog.getByRole("button", { name: "use this text" }).click();
  await expect(dialog.getByRole("alert")).toContainText("2,100 characters");
  await area.fill("hi 😀");
  await dialog.getByRole("button", { name: "use this text" }).click();
  await expect(dialog.getByRole("alert")).toContainText("has no key");

  await area.fill("  um   dois\ntrês ");
  await dialog.getByRole("button", { name: "use this text" }).click();
  await expect(dialog).toBeHidden();
  expect(await readWords(page)).toEqual(["um", "dois", "três"]);
  await expect(page.locator(".tp-input")).toBeFocused();
  await expect(page.locator(".tp-n")).toHaveText("3");
});

test("settings: at most 12, each persists, and Esc returns", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "settings" }).click();
  const panel = page.getByRole("dialog", { name: "Settings" });
  await expect(panel).toBeVisible();
  expect(await panel.locator(".tp-setting").count()).toBeLessThanOrEqual(12);

  await panel.getByRole("button", { name: "light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await panel.getByRole("button", { name: "underline" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-caret", "underline");
  const before = await page.locator(".tp-probe").evaluate((el) => el.getBoundingClientRect().width);
  await panel.getByRole("button", { name: "large", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-size", "l");
  await expect.poll(() => page.locator(".tp-probe").evaluate((el) => el.getBoundingClientRect().width)).not.toBe(before);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.locator(".tp-input")).toBeFocused();

  // A cell change re-lays the text: the wrap must still leave its 4 columns.
  const { row, cols } = await page.evaluate(() => {
    const width = document.querySelector(".tp-rows")?.getBoundingClientRect().width ?? 0;
    const ch = (document.querySelector(".tp-probe")?.getBoundingClientRect().width ?? 1) / 100;
    const longest = Math.max(...Array.from(document.querySelectorAll(".tp-row")).map((r) => r.textContent?.length ?? 0));
    return { row: longest, cols: Math.floor(width / ch) };
  });
  expect(row).toBeLessThanOrEqual(cols - 4);

  await page.reload();
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-size", "l");
  await expect(page.locator("html")).toHaveAttribute("data-caret", "underline");
});

test("live speed appears once enabled, on the second axis", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fastypist:prefs", JSON.stringify({ liveSpeed: true })));
  await page.goto("/");
  await ready(page);
  const words = await readWords(page);
  await typeText(page, `${words[0]} ${words[1]} `);
  await expect(page.locator(".tp-live")).toHaveText(/\d+ wpm/, { timeout: 5000 });
});

test("sound off means no chunk, no AudioContext and no console warning; on loads it", async ({ page }) => {
  await page.addInitScript(() => {
    const Real = window.AudioContext;
    const counter = { made: 0 };
    (window as unknown as { __audio: typeof counter }).__audio = counter;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        counter.made++;
      }
    };
  });
  const scripts: string[] = [];
  const consoleLines: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(r.url());
  });
  page.on("console", (m) => {
    if (m.type() === "warning" || (m.type() === "error" && !m.text().includes("404"))) consoleLines.push(m.text());
  });

  await page.goto("/");
  await ready(page);
  const words = await readWords(page);
  await typeText(page, `${words[0]} ${words[1]} `);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Tab");

  const made = () => page.evaluate(() => (window as unknown as { __audio: { made: number } }).__audio.made);
  expect(await made()).toBe(0);
  expect(consoleLines).toEqual([]);
  const scriptsOff = [...scripts];

  await page.getByRole("button", { name: "sound off" }).click();
  await expect.poll(made, { timeout: 5000 }).toBe(1);
  const loaded = scripts.filter((url) => !scriptsOff.includes(url));
  console.log(`scripts with sound off: ${scriptsOff.length}, added by turning sound on: ${loaded.length}`);
  expect(loaded.length).toBeGreaterThan(0);

  const typedWords = await readWords(page);
  await typeText(page, `${typedWords[0]} `);
  expect(await page.$$eval(".tp-rows .c", (els) => els.length)).toBeGreaterThan(0);
});
