import { expect, test } from "@playwright/test";
import { ready, readWords, SIZES, typeText } from "./helpers";

const BOXES = ["header", "header nav", "main", ".tp-slot", ".tp-n", ".tp-sentence", ".tp-settings", ".tp-viewport", ".tp-rows", ".tp-hint", "footer", "footer nav"];

test.describe("idle and running boxes match, with no shift", () => {
  for (const [width, height] of SIZES) {
    for (const path of ["/", "/pt-br"]) {
      test(`${path} at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.addInitScript(() => {
          const shifts: number[] = [];
          (window as unknown as { __shifts: number[] }).__shifts = shifts;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) shifts.push((entry as unknown as { value: number }).value);
          }).observe({ type: "layout-shift", buffered: true });
        });
        // Cold first, so the text font's swap is measured and printed. Warm, below, nothing may move at all.
        await page.goto(path);
        await ready(page);
        await page.waitForTimeout(500);
        const cold = await page.evaluate(() => (window as unknown as { __shifts: number[] }).__shifts.reduce((a, b) => a + b, 0));
        console.log(`CLS ${path} at ${width}: cold ${cold.toFixed(5)}`);
        expect(cold).toBeLessThan(0.01);
        await page.reload();
        await ready(page);
        await page.waitForTimeout(100);

        const measure = () =>
          page.evaluate((selectors) => {
            const out: Record<string, number[]> = {};
            for (const selector of selectors) {
              const r = document.querySelector(selector)?.getBoundingClientRect();
              if (r) out[selector] = [r.x, r.y, r.width, r.height];
            }
            return out;
          }, BOXES);

        const idle = await measure();
        expect(Object.keys(idle).length).toBe(BOXES.length);

        const words = await readWords(page);
        await typeText(page, `${words[0]} ${words[1]}`);
        await expect(page.locator(".tp")).toHaveAttribute("data-phase", "running");
        await page.waitForTimeout(200);
        const running = await measure();
        expect(running).toEqual(idle);

        await expect(page.locator("header")).toBeHidden();
        await expect(page.locator(".tp-n")).toBeVisible();

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);

        const shifts = await page.evaluate(() => (window as unknown as { __shifts: number[] }).__shifts);
        expect(shifts.reduce((a, b) => a + b, 0)).toBe(0);
      });
    }
  }
});

test("a saved type size is in place before hydration, with no shift", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("fastypist:prefs", JSON.stringify({ size: "xl", caret: "block" }));
    localStorage.setItem("fastypist:test", JSON.stringify({ mode: { kind: "time", seconds: 30 }, language: "en", tier: "1k" }));
  });
  await page.goto("/", { waitUntil: "commit" });
  await page.waitForSelector(".tp-viewport");
  await expect(page.locator("html")).toHaveAttribute("data-size", "xl");
  await ready(page);
  await expect(page.locator(".tp-n")).toHaveText("30");
  await expect(page.locator(".tp-probe")).toHaveCSS("font-size", /41\.\d+px/);
});

test("the URL query configures the test and doesn't overwrite saved settings", async ({ page }) => {
  await page.goto("/?mode=words&n=25&lang=pt&tier=200");
  await ready(page);
  await expect(page.locator(".tp-n")).toHaveText("25");
  await expect(page.locator(".tp-sentence")).toContainText("portuguese 200");
  expect(await page.evaluate(() => localStorage.getItem("fastypist:test"))).toBeNull();
  await page.goto("/");
  await ready(page);
  await expect(page.locator(".tp-n")).toHaveText("60");
});

test("the tokens this surface uses hold their contrast, dark and light", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  const pairs: [string, string, number][] = [
    ["--pending", "--ground", 4.5],
    ["--muted", "--ground", 4.5],
    ["--muted-on-surface", "--surface", 4.5],
    ["--secondary", "--ground", 4.5],
    ["--secondary", "--surface", 4.5],
    ["--text", "--ground", 4.5],
    ["--wrong", "--ground", 4.5],
    ["--extra", "--ground", 4.5],
    ["--caret", "--ground", 3],
  ];
  for (const theme of ["dark", "light"]) {
    await page.evaluate((t) => {
      if (t === "light") document.documentElement.dataset.theme = "light";
      else delete document.documentElement.dataset.theme;
    }, theme);
    const ratios = await page.evaluate((list) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      const luminance = (token: string) => {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(token);
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return list.map(([a, b]) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
        return (hi + 0.05) / (lo + 0.05);
      });
    }, pairs);
    pairs.forEach(([a, b, floor], i) => {
      expect.soft(ratios[i] as number, `${theme}: ${a} on ${b}`).toBeGreaterThanOrEqual(floor);
    });
  }
});
