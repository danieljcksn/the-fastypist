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
  await expect(page.getByTestId("time-typed")).toHaveText("4 min");
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
  await expect(page.getByTestId("time-typed")).toHaveText("3 h 32 min");
  const dotted = await page.locator("[data-testid=pace-chart] .cx-dots").getAttribute("d");
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

test.describe("charts", () => {
  const boxesCollide = (page: Page, selector: string) =>
    page.evaluate((sel) => {
      const out: string[] = [];
      for (const chart of document.querySelectorAll(sel)) {
        const frame = chart.getBoundingClientRect();
        const texts = [...chart.querySelectorAll("svg text")].map((t) => ({ text: t.textContent, box: t.getBoundingClientRect() }));
        for (const t of texts) {
          if (t.box.left < frame.left - 0.5 || t.box.right > frame.right + 0.5) out.push(`${t.text} leaves the frame`);
        }
        for (let i = 0; i < texts.length; i++) {
          for (let j = i + 1; j < texts.length; j++) {
            const a = texts[i]?.box;
            const b = texts[j]?.box;
            if (a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(`${texts[i]?.text} hits ${texts[j]?.text}`);
          }
        }
      }
      return out;
    }, selector);

  test("plot edges land on the column, the measure and the two-thirds axis, and no label collides", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, history(212, 95, (i) => 64 + i * 0.05 + (i % 7) - 3));
    // Charts draw once their frame has a measured width, a frame after the page.
    await expect(page.locator("[data-testid=calendar] rect.cx-day").first()).toBeAttached();
    await expect(page.locator("[data-testid=accuracy-chart] .cx-line").first()).toBeAttached();
    const edges = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
      const column = box(".rs-top");
      const main = document.querySelector("[data-testid=pace-chart]") as HTMLElement;
      const pad = parseFloat(getComputedStyle(main).paddingInlineEnd);
      const cells = [...document.querySelectorAll("[data-testid=calendar] rect.cx-day")].map((r) => r.getBoundingClientRect());
      return {
        left: column?.left ?? 0,
        right: column?.right ?? 0,
        axis: (column?.left ?? 0) + ((column?.width ?? 0) * 2) / 3,
        pace: box("[data-testid=pace-chart] .cx"),
        measure: main.getBoundingClientRect().right - pad,
        accuracy: box("[data-testid=accuracy-chart] .cx"),
        calendar: box("[data-testid=calendar] .cx"),
        cellsLeft: Math.min(...cells.map((c) => c.left)),
        cellsRight: Math.max(...cells.map((c) => c.right)),
      };
    });
    expect(Math.abs((edges.pace?.left ?? 0) - edges.left)).toBeLessThan(0.5);
    expect(Math.abs((edges.pace?.right ?? 0) - edges.measure)).toBeLessThan(1);
    expect(Math.abs((edges.accuracy?.left ?? 0) - edges.axis)).toBeLessThan(1);
    expect(Math.abs((edges.accuracy?.right ?? 0) - edges.right)).toBeLessThan(0.5);
    expect(Math.abs(edges.cellsLeft - edges.left)).toBeLessThan(0.5);
    // Cells are whole pixels, so the map can fall short of a fractional measure by under one.
    expect(Math.abs(edges.cellsRight - (edges.calendar?.right ?? 0))).toBeLessThan(1);
    expect(await boxesCollide(page, ".cx")).toEqual([]);
  });

  test("the edge states draw on purpose: one run, a flat line, an outlier, a long gap, 500 runs", async ({ page }) => {
    const states: [string, Seeded, (p: Page) => Promise<void>][] = [
      ["one", history(1, 0, () => 71.4), async (p) => {
        // The one run is the latest, so it is drawn as the ring that carries its value.
        await expect(p.locator("[data-testid=pace-chart] circle.cx-ring")).toHaveCount(1);
        await expect(p.locator("[data-testid=pace-chart] text.cx-strong")).toHaveText("71.4");
        await expect(p.getByTestId("pace-chart")).toContainText("The Pace line starts at the tenth.");
      }],
      ["flat", history(40, 60, () => 72), async (p) => {
        await expect(p.locator("[data-testid=pace-chart] .cx-line")).toHaveCount(1);
        await expect(p.locator("[data-testid=pace-chart] .cx-dashed")).toHaveCount(1);
      }],
      ["outlier", history(212, 92, (i) => (i === 120 ? 171.2 : i === 90 ? 9.4 : 70 + (i % 5))), async (p) => {
        // The two strays sit on the plot's edges as rings, and the scale stays on everyone else.
        const beyond = await p.locator("[data-testid=pace-chart] .cx-beyond").getAttribute("d");
        expect(beyond?.match(/M/g)?.length).toBe(2);
        // The dashed rule's value is written once, as "the 80s" at the right, so it is read from there.
        const rules = await p.locator("[data-testid=pace-chart] svg text.cx-y").allTextContents();
        const decade = (await p.locator("[data-testid=pace-chart] svg text.cx-tag").allTextContents()).flatMap((t) => /^the (\d+)s$/.exec(t)?.[1] ?? []);
        const top = [...rules, ...decade];
        expect(top.length).toBeGreaterThan(1);
        expect(Math.max(...top.map(Number))).toBeLessThanOrEqual(100);
      }],
      ["gap", { rows: [...history(60, 40, () => 66).rows.map((r) => ({ ...r, finishedAt: (r.finishedAt as number) - 60 * DAY, localDay: new Date((r.finishedAt as number) - 60 * DAY).toISOString().slice(0, 10) })), ...history(30, 20, () => 72).rows.map((r, i) => ({ ...r, id: `late-${i}` }))] }, async (p) => {
        await expect(p.locator("[data-testid=pace-chart] .cx-bridge")).toHaveCount(1);
        await expect(p.locator("[data-testid=pace-chart] .cx-line")).toHaveCount(2);
      }],
      ["500", history(500, 300, (i) => 60 + i * 0.04), async (p) => {
        const dots = await p.locator("[data-testid=pace-chart] .cx-dots").getAttribute("d");
        expect(dots?.match(/M/g)?.length).toBe(500);
        await expect(p.locator("[data-testid=pace-chart] table tbody tr")).toHaveCount(500);
      }],
    ];
    for (const [, seeded, check] of states) {
      const fresh = await page.context().newPage();
      await fresh.setViewportSize({ width: 1440, height: 900 });
      await open(fresh, seeded);
      await check(fresh);
      expect(await boxesCollide(fresh, ".cx")).toEqual([]);
      expect(await fresh.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await fresh.close();
    }
  });

  test("hover, keys and taps read out what only the data knows", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, history(60, 30, (i) => 60 + i * 0.2));
    const hit = page.locator("[data-testid=pace-chart] .cx-hit");
    const box = await hit.boundingBox();
    if (!box) throw new Error("no pace chart");
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    const read = page.locator("[data-testid=pace-chart] .cx-read");
    await expect(read).toContainText("wpm pace");
    const last = await read.textContent();
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await expect(read).not.toHaveText(last ?? "");
    await page.mouse.move(box.x + box.width / 2, box.y - 200);
    await expect(read).toHaveCount(0);

    await hit.focus();
    await page.keyboard.press("End");
    await expect(read).toHaveText(last ?? "");
    await page.keyboard.press("ArrowLeft");
    await expect(read).not.toHaveText(last ?? "");
    await page.keyboard.press("Escape");
    await expect(read).toHaveCount(0);

    const days = page.locator("[data-testid=calendar] .cx-hit");
    await days.focus();
    await page.keyboard.press("End");
    await expect(page.getByTestId("calendar-read")).toHaveText(/: \d+ runs?, (\d+ min|under a minute)$/);
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("calendar-read")).not.toHaveText("");
  });

  test("beside the line, the read-out hides the labels it would cover", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, history(60, 30, (i) => 60 + i * 0.2));
    const strong = page.locator("[data-testid=pace-chart] text.cx-strong");
    await expect(strong).toBeVisible();
    const box = await page.locator("[data-testid=pace-chart] .cx-hit").boundingBox();
    if (!box) throw new Error("no pace chart");
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await expect(page.locator("[data-testid=pace-chart] .cx-read")).toBeVisible();
    await expect(strong).toBeHidden();
    await expect(page.locator("[data-testid=pace-chart] text.cx-tag")).toBeHidden();
  });

  test("the reveal runs once: not again on a return visit, and never under reduced motion", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, history(60, 30, () => 70));
    const frame = page.locator("[data-testid=pace-chart] .cx");
    // It runs as the chart scrolls into view and the attribute goes when the animation ends.
    await frame.scrollIntoViewIfNeeded();
    await expect(frame).not.toHaveAttribute("data-reveal");
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __reveals: string[] }).__reveals = seen;
      new MutationObserver((list) => {
        for (const m of list) {
          const target = m.target as HTMLElement;
          // Only the chart that was already revealed: one further down that was never scrolled to still has its first showing.
          if (target.closest("[data-testid=pace-chart]") && target.dataset.reveal) seen.push(target.dataset.reveal);
        }
      }).observe(document.body, { attributes: true, attributeFilter: ["data-reveal"], subtree: true });
    });
    // Any page link will do: with accounts off the header has no today link.
    await page.getByRole("link", { name: "about" }).click();
    await page.waitForURL(/about/);
    await page.goBack();
    await expect(page.getByTestId("pace-chart")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __reveals: string[] }).__reveals)).toEqual([]);

    const reduced = await page.context().newPage();
    await reduced.emulateMedia({ reducedMotion: "reduce" });
    await open(reduced, history(60, 30, () => 70));
    await expect(reduced.locator("[data-testid=pace-chart] .cx svg").first()).toBeVisible();
    await expect(reduced.locator("[data-testid=pace-chart] .cx")).not.toHaveAttribute("data-reveal");
    await reduced.close();
  });
});

test.describe("on a touch screen", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the read-out sits under the axis, on the latest point until a tap picks another", async ({ page }) => {
    await open(page, history(60, 30, (i) => 60 + i * 0.2));
    const chart = page.getByTestId("pace-chart");
    const read = chart.locator(".cx-read");
    await expect(read).toHaveClass(/cx-read-below/);
    await expect(read).toContainText("wpm pace");
    const latest = await read.textContent();
    // Below the plot, in the line its frame reserves, so a finger never covers it.
    const below = await chart.locator(".cx").evaluate((frame) => {
      const r = frame.querySelector(".cx-read") as HTMLElement;
      return r.offsetTop >= frame.clientHeight - parseFloat(getComputedStyle(frame).paddingBottom);
    });
    expect(below).toBe(true);
    const hit = chart.locator(".cx-hit");
    await hit.scrollIntoViewIfNeeded();
    const box = await hit.boundingBox();
    if (!box) throw new Error("no pace chart");
    await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height * 0.4);
    await expect(read).not.toHaveText(latest ?? "");
    await expect(chart.locator("text.cx-strong")).toBeVisible();
  });
});
