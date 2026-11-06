import { readFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import ts from "typescript";
import { buildText } from "../../src/engine/generate";
import { cdp, ready, readWords } from "./helpers";

const KB = 1024;
const BUDGET_KB = 185;

/** Above half the cores busy, timing assertions loosen by the excess. The factor is printed, so a pass is never mistaken for more. */
function loadFactor(): number {
  const ratio = (loadavg()[0] ?? 0) / cpus().length;
  return Math.max(1, ratio / 0.5);
}

test("handler time and layouts per key at 400 WPM with jitter", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const samples: number[] = [];
    (window as unknown as { __handler: number[] }).__handler = samples;
    let downAt = 0;
    let downMs = 0;
    let beforeAt = 0;
    // Registered before the app's listeners, and the bubble phase after them, so these bracket everything the app does.
    window.addEventListener("keydown", () => (downAt = performance.now()), { capture: true });
    window.addEventListener("keydown", () => (downMs = performance.now() - downAt));
    window.addEventListener("beforeinput", () => (beforeAt = performance.now()), { capture: true });
    window.addEventListener("beforeinput", () => samples.push(downMs + performance.now() - beforeAt));
  });
  // Time mode, the one that matters, on a known text: a fixed random source gives a seed this test can generate from.
  await page.addInitScript(() => {
    crypto.getRandomValues = ((array: Uint8Array) => array.fill(0xab)) as typeof crypto.getRandomValues;
  });
  const list = JSON.parse(readFileSync("src/engine/packs/en-1k@1.json", "utf8")).words as string[];
  const words = buildText({ seed: "ab".repeat(16), count: 600 }, list);
  await page.goto("/");
  await ready(page);
  expect((await readWords(page)).slice(0, 5)).toEqual(words.slice(0, 5));

  const session = await cdp(page);
  await session.send("Performance.enable");
  const metrics = async () => {
    const { metrics: list } = await session.send("Performance.getMetrics");
    return Object.fromEntries(list.map((m) => [m.name, m.value]));
  };

  const press = async (key: string, code: string, text?: string) => {
    const windowsVirtualKeyCode = key === "Backspace" ? 8 : key.toUpperCase().charCodeAt(0);
    await session.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, text, windowsVirtualKeyCode });
    await session.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  };

  // 400 WPM is 30 ms a key. Awaiting the protocol costs part of each gap, so a run is at or below that rate, never above.
  const before = await metrics();
  let keys = 0;
  let seed = 12345;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const start = Date.now();
  outer: for (const word of words) {
    for (const ch of `${word} `) {
      if (random() < 0.04) {
        await press("z", "KeyZ", "z");
        await press("Backspace", "Backspace");
        keys += 2;
      }
      await press(ch, ch === " " ? "Space" : `Key${ch.toUpperCase()}`, ch);
      keys++;
      await new Promise((r) => setTimeout(r, 30 * (0.6 + random() * 0.8) - 6));
      if (keys >= 300) break outer;
    }
  }
  const seconds = (Date.now() - start) / 1000;
  const after = await metrics();

  const samples = await page.evaluate(() => (window as unknown as { __handler: number[] }).__handler);
  samples.sort((a, b) => a - b);
  const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? 0;
  const factor = loadFactor();
  const layouts = (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0);
  const perKey = layouts / keys;
  console.log(
    `latency: ${keys} keys in ${seconds.toFixed(1)} s (${((keys / seconds) * 12).toFixed(0)} WPM rate), handler p50 ${p(0.5).toFixed(2)} p95 ${p(0.95).toFixed(2)} p99 ${p(0.99).toFixed(2)} ms, ` +
      `layouts ${layouts} (${perKey.toFixed(3)} per key), load ${loadavg()[0]?.toFixed(1)} on ${cpus().length} cores, relax factor ${factor.toFixed(2)}`,
  );
  expect(samples.length).toBeGreaterThan(keys * 0.9);
  expect(p(0.95)).toBeLessThan(1 * factor);
  expect(perKey).toBeLessThan(0.1 * factor);
});

for (const route of ["/", "/pt-br"]) {
  test(`weight of ${route} against the ${BUDGET_KB} KB budget`, async ({ page }) => {
    const session = await cdp(page);
    await session.send("Network.enable");
    const requests = new Map<string, { type: string; url: string; status: number; bytes: number }>();
    session.on("Network.responseReceived", (e) => {
      requests.set(e.requestId, { type: e.type, url: e.response.url, status: e.response.status, bytes: 0 });
    });
    session.on("Network.loadingFinished", (e) => {
      const request = requests.get(e.requestId);
      if (request) request.bytes = e.encodedDataLength;
    });
    await page.goto(route);
    await ready(page);
    await page.waitForTimeout(3000);

    const all = [...requests.values()];
    const sum = (list: typeof all) => list.reduce((total, r) => total + r.bytes, 0);
    // The router's prefetches run at idle for pages not asked for yet. Real, so printed, but not this page's first load.
    const prefetches = all.filter((r) => r.type === "Fetch");
    const first = all.filter((r) => r.type !== "Fetch");
    const js = first.filter((r) => r.type === "Script");
    const totalKb = sum(first) / KB;
    const byType = Object.entries(Object.groupBy(first, (r) => r.type)).map(([type, list]) => `${type} ${(sum(list ?? []) / KB).toFixed(1)}`);
    console.log(
      `weight ${route}: first load ${totalKb.toFixed(1)} KB against ${BUDGET_KB}, JS ${(sum(js) / KB).toFixed(1)} KB in ${js.length} files (${byType.join(", ")}). ` +
        `Router prefetches at idle, not counted: ${prefetches.length} files, ${(sum(prefetches) / KB).toFixed(1)} KB`,
    );
    // The plan says about 185. The tolerance stops a regression without pretending the framework's 135 KB can shrink.
    expect(totalKb).toBeLessThanOrEqual(BUDGET_KB * 1.05);
  });
}

test("the frozen engine agrees with the golden file in this browser", async ({ page }) => {
  const engine = path.resolve("src/engine");
  // Served through the page's origin and transpiled alone, so what runs is the engine's own source with nothing bundled in.
  await page.route("**/__golden/**", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop() as string;
    const source = readFileSync(path.join(engine, `${name.replace(/\.js$/, "")}.ts`), "utf8");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
    return route.fulfill({ contentType: "text/javascript", body: outputText });
  });
  await page.goto("/");
  await ready(page);
  const golden = JSON.parse(readFileSync("tests/unit/engine/golden.json", "utf8"));
  const mismatches = await page.evaluate(async (expected) => {
    const url = "/__golden/golden-check.js";
    const { checkGolden } = await import(/* webpackIgnore: true */ url);
    return checkGolden(expected) as string[];
  }, golden);
  expect(mismatches).toEqual([]);
});
