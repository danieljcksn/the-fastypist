import { expect, test, type Page } from "@playwright/test";
import { paceOf, percentileOf } from "../../src/engine/analysis";
import { ready, SIZES, typeSlowOn, withText } from "./helpers";

const DAY = 86_400_000;

interface Seeded {
  rows: Record<string, unknown>[];
}

function history(count: number, days: number, wpm: (i: number) => number): Seeded {
  const now = Date.now();
  const rows = Array.from({ length: count }, (_, i) => {
    const t = now - 60_000 - ((count - 1 - i) / Math.max(1, count - 1)) * days * DAY;
    return {
      id: `seed-${i}`,
      kind: "free",
      status: "unverified",
      mode: "time",
      amount: 60,
      language: "en",
      pack: "en-1k@1",
      mods: "",
      wpmCx: Math.round(wpm(i) * 100),
      rawCx: Math.round(wpm(i) * 103),
      accuracyBp: 9700,
      consistencyBp: 8000,
      elapsedMs: 60_000,
      afkMs: 0,
      finishedAt: Math.round(t),
      localDay: new Date(t - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10),
      device: "keyboard",
    };
  });
  return { rows };
}

async function open(page: Page, seeded: Seeded | null, path = "/progress") {
  if (seeded) await page.addInitScript((rows) => localStorage.setItem("fastypist:history", JSON.stringify({ v: 1, rows })), seeded.rows);
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.dataset.history === undefined);
}

test("zero runs: says so, offers the test, and invents nothing", async ({ page }) => {
  await open(page, null);
  await expect(page.getByTestId("progress-empty")).toBeVisible();
  await expect(page.getByTestId("progress")).toHaveCount(0);
  await page.getByRole("link", { name: "start typing" }).click();
  await expect(page).toHaveURL(/\/$/);
  await ready(page);
});

test("a few runs: counts up to Pace rather than claiming one", async ({ page }) => {
  await open(page, history(4, 3, (i) => 60 + i));
  await expect(page.getByTestId("pace-few")).toHaveText("4 of 10 runs");
  await expect(page.getByTestId("pace")).toHaveCount(0);
  await expect(page.getByTestId("percentile")).toHaveCount(0);
  await expect(page.getByTestId("pace-finding")).toHaveCount(0);
  await expect(page.getByTestId("run-count")).toHaveText("4");
  await expect(page.getByTestId("time-typed")).toHaveText("4 m");
  await expect(page.getByTestId("bests")).toContainText("60 seconds");
  await expect(page.getByText("6 more runs")).toBeVisible();
});

test("runs that don't count toward Pace: no Pace chart, and the page still reads", async ({ page }) => {
  const words = history(3, 2, () => 70).rows.map((row) => ({ ...row, mode: "words", amount: 25 }));
  await open(page, { rows: words });
  await expect(page.getByTestId("pace-few")).toHaveText("0 of 10 runs");
  await expect(page.getByTestId("pace-chart")).toHaveCount(0);
  await expect(page.getByTestId("accuracy-chart")).toBeVisible();
  await expect(page.getByTestId("bests")).toContainText("25 words");
});

test("exactly 10 runs: Pace appears, computed independently here", async ({ page }) => {
  const speeds = Array.from({ length: 10 }, (_, i) => 60 + i);
  await open(page, history(10, 9, (i) => speeds[i] ?? 0));
  const want = (paceOf(speeds.map((s) => s * 100)) as number) / 100;
  await expect(page.getByTestId("pace")).toHaveText(want.toFixed(1));
  await expect(page.getByTestId("percentile")).toHaveText(`Faster than about ${percentileOf(want)}% of typists.`);
  await expect(page.getByTestId("decade")).toHaveText(`${(70 - want).toFixed(1)} wpm to the 70s.`);
});

test("many runs: the insight's rule holds, and the page reads the last 25 only", async ({ page }) => {
  const count = 212;
  const speed = (i: number) => (i < count / 2 ? 60 : 72) + (i % 2 ? 0.5 : -0.5);
  await open(page, history(count, 58, speed));
  const lastRuns = Array.from({ length: 25 }, (_, i) => Math.round(speed(count - 25 + i) * 100));
  await expect(page.getByTestId("pace")).toHaveText(((paceOf(lastRuns) as number) / 100).toFixed(1));
  await expect(page.getByTestId("pace-finding")).toHaveText(/^Up 1[12]\.\d wpm on the month before\.$/);
  await expect(page.getByTestId("run-count")).toHaveText("212");
  await expect(page.getByTestId("time-typed")).toHaveText("3 h 32 m");
  await expect(page.locator(".pg-cal i")).toHaveCount(await page.locator(".pg-cal i").count());
  const dotted = await page.locator(".ch-dots").first().getAttribute("d");
  expect(dotted?.match(/M/g)?.length).toBe(count);
});

test("a small move inside the noise reads as about the same", async ({ page }) => {
  const speed = (i: number) => 70 + 25 * Math.sin(i * 1.7) + (i < 100 ? 0 : 1);
  await open(page, history(200, 58, speed));
  await expect(page.getByTestId("pace-finding")).toHaveText("About the same as a month ago.");
});

test("no streak counter anywhere", async ({ page }) => {
  await open(page, history(60, 30, () => 70));
  await expect(page.getByText(/streak/i)).toHaveCount(0);
});

test("Portuguese reads in Portuguese, with decimal commas", async ({ page }) => {
  await open(page, history(10, 9, (i) => 60.5 + i), "/pt-br/progress");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.getByTestId("pace")).toContainText(",");
  await expect(page.getByTestId("percentile")).toContainText("Mais rápido que cerca de");
  await expect(page.getByRole("heading", { name: "Dias digitados" })).toBeVisible();
});

test("two word languages: the switch scopes everything below", async ({ page }) => {
  const seeded = history(4, 3, () => 70);
  const pt = history(3, 2, () => 50).rows.map((row, i) => ({ ...row, id: `pt-${i}`, language: "pt", pack: "pt-1k@1" }));
  await open(page, { rows: [...seeded.rows, ...pt] });
  await expect(page.getByTestId("run-count")).toHaveText("4");
  await page.getByTestId("language-pt").click();
  await expect(page.getByTestId("run-count")).toHaveText("3");
  await expect(page.getByTestId("pace-few")).toHaveText("3 of 10 runs");
});

test("corrupt history falls back to the zero state", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("fastypist:history", "{{{"));
  await page.goto("/progress");
  await expect(page.getByTestId("progress-empty")).toBeVisible();
});

test("a real run feeds the page: a row and the slowest pairs with a drill", async ({ page }) => {
  test.setTimeout(60_000);
  const words = Array.from({ length: 36 }, (_, i) => ["the", "then", "they", "than", "that", "with", "other", "think", "about"][i % 9] as string);
  await withText(page, words);
  await page.goto("/");
  await ready(page);
  await typeSlowOn(page, words, "th");
  await expect(page.getByTestId("result")).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole("link", { name: "progress" }).click();
  await expect(page.getByTestId("progress")).toBeVisible();
  await expect(page.getByTestId("run-count")).toHaveText("1");
  await expect(page.getByTestId("bests")).toHaveCount(0);
  await expect(page.getByTestId("progress-pairs")).toContainText("th");
  const link = page.getByTestId("drill-these");
  const href = await link.getAttribute("href");
  expect(href).toMatch(/\?drill=[^&]+&lang=en$/);
  await link.click();
  await expect(page.getByTestId("drill-pairs")).toContainText("th");
  await expect(page.locator(".tp-n")).toHaveText("30");
});

test.describe("layout", () => {
  const states = { zero: null, few: () => history(4, 3, () => 70), many: () => history(212, 95, (i) => 64 + i * 0.05) } as const;
  for (const [name, seed] of Object.entries(states)) {
    for (const [width, height] of SIZES) {
      for (const theme of ["dark", "light"]) {
        test(`${name} at ${width} in ${theme}`, async ({ page }) => {
          await page.addInitScript((t) => localStorage.setItem("fastypist:theme", t), theme);
          await page.setViewportSize({ width, height });
          await open(page, seed ? seed() : null);
          await page.waitForTimeout(100);
          expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
          if (name === "many" && width >= 720) {
            const axis = await page.evaluate(() => {
              const column = document.querySelector(".rs-top")?.getBoundingClientRect();
              const stats = document.querySelector(".rs-stats")?.getBoundingClientRect();
              return { want: (column?.left ?? 0) + ((column?.width ?? 0) * 2) / 3, got: stats?.left ?? 0 };
            });
            expect(Math.abs(axis.want - axis.got)).toBeLessThan(1);
          }
        });
      }
    }
  }
});

test("no layout shift when a returning typist's page fills in", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as unknown as { __cls: number }).__cls += (e as unknown as { value: number }).value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  // Warm, as a returning typist always is: they got their history on the test page, which already fetched the fonts.
  await open(page, history(60, 30, () => 70));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.history === undefined);
  await page.waitForTimeout(500);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  console.log(`CLS /progress with history: ${cls.toFixed(4)}`);
  expect(cls).toBeLessThan(0.01);
});
