import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { decodeLog } from "../../src/engine/log";
import { ready, readWords, recordKeydowns, SIZES, stamps, typeAll, typeText, withText } from "./helpers";

// A centi-WPM gap in tenths, rounded half up on the integer, as the page does.
const tenths = (cx: number) => (Math.round(Math.abs(cx) / 10) / 10).toFixed(1);

const result = (page: Page) => page.getByTestId("result");
const rowsOf = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("fastypist:history") ?? '{"rows":[]}').rows as { id: string; kind: string; wpmCx: number; mode: string }[]);

const baselineOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const host = [...document.querySelectorAll(s)].at(-1) as HTMLElement;
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0";
    host.append(probe);
    const y = probe.getBoundingClientRect().bottom;
    probe.remove();
    return y;
  }, selector);

test.describe("the result", () => {
  test("hero, accuracy and raw match values computed from the keys in this test", async ({ page }) => {
    await recordKeydowns(page);
    await page.goto("/?mode=words&n=25");
    await ready(page);
    const words = await readWords(page);
    const text = words.join(" ");

    // One wrong letter, corrected: the score keeps it in accuracy and raw and nowhere else.
    await page.keyboard.press("z");
    await page.keyboard.press("Backspace");
    await typeText(page, text, 25);
    await expect(result(page)).toBeVisible();

    const times = await stamps(page);
    const elapsed = Math.round((times.at(-1) as number) - (times[0] as number));
    const credited = text.length - 1;
    const hero = Math.round((1_200_000 * credited) / elapsed);
    const keys = text.length + 1;
    const raw = Math.round((1_200_000 * keys) / elapsed);

    expect(Number(await result(page).getAttribute("data-wpm-cx"))).toBe(hero);
    await expect(page.locator(".rs-n")).toHaveText(String(Math.round(hero / 100)));
    await expect(page.locator('[data-stat="raw"]')).toHaveText(String(Math.round(raw / 100)));
    const accuracy = (100 * text.length) / (text.length + 1);
    await expect(page.locator('[data-stat="accuracy"]')).toHaveText(`${accuracy.toFixed(1)}%`);
    await expect(page.getByRole("heading", { name: "1 mistake" })).toBeVisible();
  });

  test("the number is there the moment the run ends, and doesn't count up", async ({ page }) => {
    await withText(page, ["ab", "cd"]);
    await page.addInitScript(() => {
      new MutationObserver(() => {
        const n = document.querySelector(".rs-n");
        if (!n) return;
        const seen = ((window as unknown as { __seen: string[] }).__seen ??= []);
        if (seen.at(-1) !== n.textContent) seen.push(n.textContent ?? "");
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.goto("/");
    await ready(page);
    await typeText(page, "ab cd", 40);
    await expect(result(page)).toBeVisible();
    const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
    expect(seen).toHaveLength(1);
  });

  test("a chunk that fails to load still leaves the number and a way on", async ({ page }) => {
    await withText(page, ["ab", "cd"]);
    await page.goto("/");
    await ready(page);
    await page.route("**/_next/static/**", (route) => route.abort());
    await typeText(page, "ab cd", 30);
    await expect(page.locator(".rs-n")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(result(page)).toHaveCount(0);
    await expect(page.locator(".tp")).toHaveAttribute("data-phase", "idle");
  });

  test("three digits run at 0.8 of the hero", async ({ page }) => {
    await withText(page, Array.from({ length: 12 }, () => "abcdefgh"));
    await page.goto("/");
    await ready(page);
    await typeText(page, Array.from({ length: 12 }, () => "abcdefgh").join(" "));
    await expect(result(page)).toBeVisible();
    const digits = await page.locator(".rs-n").getAttribute("data-digits");
    expect(Number(digits)).toBeGreaterThanOrEqual(3);
    if (digits !== "3") return;
    const size = await page.locator(".rs-n").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeCloseTo(320 * 0.8, 1);
  });
});

test.describe("runs with little to say", () => {
  test("a very short run: the number and nothing it can't support", async ({ page }) => {
    await withText(page, ["ab"]);
    await page.goto("/");
    await ready(page);
    await typeText(page, "ab", 30);
    await expect(page.locator(".rs-n")).toBeVisible();
    await expect(page.getByTestId("diagnosis")).toHaveCount(0);
    await expect(page.getByTestId("best-line")).toHaveCount(0);
    await expect(page.getByTestId("primary-action")).toHaveCount(0);
    await expect(page.locator(".rs-map")).toHaveCount(0);
    await expect(page.locator(".ch")).toHaveCount(0);
  });

  test("everything wrong scores 0, says why, and sets no best", async ({ page }) => {
    await withText(page, ["abc", "def", "ghi"]);
    await page.goto("/");
    await ready(page);
    await typeText(page, "xyz xyz xyz ", 30);
    await expect(page.locator(".rs-n")).toHaveText("0");
    await expect(page.getByTestId("diagnosis")).toContainText("No word came out right");
    // The 3 spaces went where a space belongs. The 9 letters all missed.
    await expect(page.locator('[data-stat="accuracy"]')).toHaveText("25.0%");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fastypist:bests") ?? '{"bests":{}}').bests)).toEqual({});
  });

  test("a run past the time limit leaves no trace and says so", async ({ page }) => {
    // keydown.timeStamp is the only timebase, so a jump in it is a typist still going after 22 minutes.
    await page.addInitScript(() => {
      const real = Object.getOwnPropertyDescriptor(Event.prototype, "timeStamp")?.get as () => number;
      Object.defineProperty(Event.prototype, "timeStamp", {
        get() {
          return real.call(this) + ((window as unknown as { __jump?: number }).__jump ?? 0);
        },
      });
    });
    await withText(page, ["ab", "cd"]);
    await page.goto("/");
    await ready(page);
    await typeText(page, "ab ", 10);
    await page.evaluate(() => ((window as unknown as { __jump: number }).__jump = 1_300_000));
    await typeText(page, "cd", 10);
    await expect(page.locator(".tp-note")).toContainText("too long");
    await expect(result(page)).toHaveCount(0);
    expect(await rowsOf(page)).toEqual([]);
  });
});

test.describe("local history", () => {
  test("a run survives a reload, with its raw log and no holds", async ({ page }) => {
    await page.goto("/?mode=words&n=10");
    await ready(page);
    const words = await readWords(page);
    await typeText(page, words.join(" "), 5);
    await expect(result(page)).toBeVisible();
    await page.waitForTimeout(300);
    await page.reload();
    await ready(page);
    const rows = await rowsOf(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "free", mode: "words", status: "unverified" });
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const bytes = await page.evaluate(
      () =>
        new Promise<number[]>((resolve, reject) => {
          const open = indexedDB.open("fastypist");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result.transaction("raw").objectStore("raw").getAll();
            all.onsuccess = () => resolve(Array.from(all.result[0].log as Uint8Array));
          };
        }),
    );
    const entries = decodeLog(Uint8Array.from(bytes));
    expect(entries?.length).toBeGreaterThan(10);
    expect(entries?.every((e) => e.h === undefined)).toBe(true);
  });

  test("a first run has no best line, a faster one shows the change, a slower one the gap", async ({ page }) => {
    await page.goto("/?mode=words&n=10");
    await ready(page);
    const run = async (delay: number) => {
      const words = await readWords(page);
      await typeText(page, words.join(" "), delay);
      await expect(result(page)).toBeVisible();
      return Number(await result(page).getAttribute("data-wpm-cx"));
    };
    const first = await run(40);
    await expect(page.getByTestId("best-line")).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(result(page)).toHaveCount(0);

    const second = await run(5);
    expect(second).toBeGreaterThan(first);
    const up = tenths(second - first);
    await expect(page.getByTestId("best-line")).toHaveText(`Up ${up} from your best.`);
    await page.keyboard.press("Tab");

    const third = await run(40);
    expect(third).toBeLessThan(second);
    const under = tenths(second - third);
    await expect(page.getByTestId("best-line")).toHaveText(`${under} under your best.`);

    const bests = await page.evaluate(() => JSON.parse(localStorage.getItem("fastypist:bests") ?? "{}").bests);
    expect(Object.values(bests).map((b) => (b as { wpmCx: number }).wpmCx)).toEqual([second]);
  });

  test("corrupt storage costs nothing", async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("fastypist:history", "{not json");
      localStorage.setItem("fastypist:bests", "[1,2");
    });
    await withText(page, ["ab"]);
    await page.goto("/");
    await ready(page);
    await typeText(page, "ab", 30);
    await expect(page.locator(".rs-n")).toBeVisible();
    await expect(page.getByTestId("best-line")).toHaveCount(0);
    expect((await rowsOf(page)).length).toBe(1);
  });

  test("blocked storage degrades quietly: results and bests still work in the tab", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const refuse = () => {
        throw new DOMException("denied", "SecurityError");
      };
      Storage.prototype.setItem = refuse;
      Storage.prototype.getItem = refuse;
      IDBFactory.prototype.open = refuse;
    });
    await page.goto("/?mode=words&n=10");
    await ready(page);
    let words = await readWords(page);
    await typeText(page, words.join(" "), 20);
    await expect(page.locator(".rs-n")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(result(page)).toHaveCount(0);
    words = await readWords(page);
    await typeText(page, words.join(" "), 2);
    await expect(page.getByTestId("best-line")).toContainText("from your best");
    expect(errors).toEqual([]);
  });
});

test.describe("copy summary", () => {
  test("gives one line of text with no word of the test in it", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/?mode=words&n=10");
    await ready(page);
    const words = await readWords(page);
    await typeText(page, words.join(" "), 5);
    await expect(result(page)).toBeVisible();
    const wpm = await page.locator(".rs-n").textContent();
    await page.getByTestId("copy-summary").click();
    await expect(page.getByTestId("copy-summary")).toHaveText("copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`${wpm} wpm, 100.0% accuracy, 10 words of english. thefastypist`);
    await expect(page.locator(".tp-input")).toBeFocused();
  });
});

test.describe("the keyboard on a result", () => {
  test("arrows scroll, Shift Tab reaches the actions, and Tab there doesn't start a test", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.goto("/?mode=words&n=25");
    await ready(page);
    const words = await readWords(page);
    await typeText(page, words.join(" "), 20);
    await expect(page.locator(".rs-grid")).toBeVisible();
    await expect(page.locator(".tp-input")).toBeFocused();
    await page.keyboard.press("PageDown");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".rs :focus")).toHaveCount(1);
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".rs :focus")).toHaveCount(1);
    await expect(result(page)).toBeVisible();
  });

  test("Tab after clicking the result's blank space still gives new words", async ({ page }) => {
    await withText(page, ["ab"]);
    await page.goto("/");
    await ready(page);
    await typeText(page, "ab", 20);
    await expect(result(page)).toBeVisible();
    await page.mouse.click(5, 5);
    await page.keyboard.press("Tab");
    await expect(result(page)).toHaveCount(0);
  });
});

test.describe("layout", () => {
  for (const [width, height] of SIZES) {
    for (const theme of ["dark", "light"]) {
      test(`result at ${width} in ${theme}`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("fastypist:theme", t), theme);
        await page.setViewportSize({ width, height });
        await page.goto("/?mode=words&n=25");
        await ready(page);
        await typeAll(page, 8);
        await expect(result(page)).toBeVisible();
        await page.waitForTimeout(100);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        await expect(page.locator(".rs-map")).toBeVisible();
        if (width >= 720) {
          const axis = await page.evaluate(() => {
            const column = document.querySelector(".rs-top")?.getBoundingClientRect();
            const stats = document.querySelector(".rs-stats")?.getBoundingClientRect();
            return { want: (column?.left ?? 0) + ((column?.width ?? 0) * 2) / 3, got: stats?.left ?? 0 };
          });
          expect(Math.abs(axis.want - axis.got)).toBeLessThan(1);
          const unit = await baselineOf(page, ".rs-unit");
          const stat = await baselineOf(page, ".rs-stats dd");
          expect(Math.abs(unit - stat)).toBeLessThan(1.5);
        }
      });
    }
  }
});

test("the results chunk is not in the first load, and arrives once a run starts", async ({ page }) => {
  const bodies: { url: string; text: Promise<string> }[] = [];
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (type === "script" || type === "stylesheet") bodies.push({ url: response.url(), text: response.text().catch(() => "") });
  });
  await page.goto("/");
  await ready(page);
  await page.waitForTimeout(3000);
  const holds = async (marker: string) => (await Promise.all(bodies.map((b) => b.text))).filter((text) => text.includes(marker)).length;
  expect(await holds("rs-map")).toBe(0);
  expect(await holds("Each word, by speed")).toBe(0);

  const words = await readWords(page);
  await typeText(page, words[0] ?? "", 10);
  await expect.poll(() => holds("Each word, by speed"), { timeout: 5_000 }).toBeGreaterThan(0);
  expect(await holds("rs-map")).toBeGreaterThan(0);
  // Guards the marker itself: if the class were renamed, the zero above would prove nothing.
  expect(readFileSync("src/components/charts/report.css", "utf8")).toContain(".rs-map");
});
