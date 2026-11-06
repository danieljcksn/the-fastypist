import { expect, test } from "@playwright/test";
import { cdp, letterClasses, ready, readWords, recordKeydowns, stamps, typeText, withText } from "./helpers";

test.describe("a run from first key to result", () => {
  test("words 10: the WPM on screen equals one computed from the keydown stamps", async ({ page }) => {
    await recordKeydowns(page);
    await page.goto("/?mode=words&n=10");
    await ready(page);
    const words = await readWords(page);
    expect(words.length).toBe(10);

    await typeText(page, words.join(" "), 15);
    const result = page.getByTestId("result");
    await expect(result).toBeVisible();

    const times = await stamps(page);
    const elapsed = Math.round((times.at(-1) as number) - (times[0] as number));
    // MacKenzie's n-1 intervals, and no space after the last word.
    const credited = words.join(" ").length - 1;
    const expected = Math.round((1_200_000 * credited) / elapsed);
    expect(Number(await result.getAttribute("data-wpm-cx"))).toBe(expected);
    await expect(page.locator(".rs-n")).toHaveText(String(Math.round(expected / 100)));
    await expect(page.locator('[data-stat="accuracy"]')).toContainText("100");
    await expect(result).toHaveAttribute("data-device", "keyboard");
  });

  test("time 15: ends on time, and no key after the buzzer changes the result", async ({ page }) => {
    await recordKeydowns(page);
    await page.goto("/?mode=time&t=15");
    await ready(page);
    await expect(page.locator(".tp-n")).toHaveText("15");
    const words = await readWords(page);
    const typed = words.slice(0, 6).join(" ") + " ";
    const t0 = Date.now();
    await typeText(page, typed, 10);
    await expect(page.locator(".tp-n")).not.toHaveText("15");

    const result = page.getByTestId("result");
    await expect(result).toBeVisible({ timeout: 20_000 });
    const firstKeyMs = (await stamps(page))[0] as number;
    const finished = await page.evaluate(() => performance.now());
    expect(finished - firstKeyMs).toBeGreaterThanOrEqual(14_950);
    expect(Date.now() - t0).toBeLessThan(17_000);

    const expected = Math.round((1_200_000 * typed.length) / 15_000);
    expect(Number(await result.getAttribute("data-wpm-cx"))).toBe(expected);

    await typeText(page, "abcdef ghi");
    expect(Number(await result.getAttribute("data-wpm-cx"))).toBe(expected);
    await expect(page.locator(".rs-n")).toHaveText(String(Math.round(expected / 100)));
  });

  test("the number counts down and words mode counts words left", async ({ page }) => {
    await page.goto("/?mode=words&n=10");
    await ready(page);
    await expect(page.locator(".tp-n")).toHaveText("10");
    const words = await readWords(page);
    await typeText(page, `${words[0]} `);
    await expect(page.locator(".tp-n")).toHaveText("9");
  });

  test("restart keys on the result give a fresh test", async ({ page }) => {
    await withText(page, ["ab"]);
    await page.goto("/");
    await ready(page);
    await typeText(page, "ab");
    await expect(page.getByTestId("result")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("result")).toHaveCount(0);
    await expect(page.locator(".tp")).toHaveAttribute("data-phase", "idle");
    await typeText(page, "ab");
    await expect(page.getByTestId("result")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("result")).toHaveCount(0);
  });
});

test.describe("letters", () => {
  test("wrong, extra and missed each get their class", async ({ page }) => {
    await withText(page, ["abc", "def", "ghi", "jkl"]);
    await page.goto("/");
    await ready(page);

    await typeText(page, "abx");
    expect(await letterClasses(page, 0)).toEqual(["c", "c", "w"]);
    await page.keyboard.press("Space");

    await typeText(page, "defzz");
    expect(await letterClasses(page, 1)).toEqual(["c", "c", "c", "x", "x"]);
    await page.keyboard.press("Space");

    await typeText(page, "g ");
    expect(await letterClasses(page, 2)).toEqual(["c", "m", "m"]);
    expect(await letterClasses(page, 3)).toEqual(["", "", ""]);
  });

  test("extras cap at 4, so a row can't overflow", async ({ page }) => {
    await withText(page, ["ab", "cd"]);
    await page.goto("/");
    await ready(page);
    await typeText(page, "abzzzzzzzz");
    expect(await letterClasses(page, 0)).toEqual(["c", "c", "x", "x", "x", "x"]);
  });

  test("backspace across a row boundary, deep enough that the row was recycled", async ({ page }) => {
    // 10 columns a word, and 56 columns at 1280 leave 5 words a row.
    const words = Array.from({ length: 60 }, (_, i) => `${"abcdefghij"[i % 10]}bbbbbbbb`);
    await withText(page, words);
    await page.goto("/");
    await ready(page);
    const lastOnRow = await page.$eval(".tp-row", (row) => row.querySelectorAll(".tp-word").length - 1);
    const perRow = lastOnRow + 1;

    // Type four rows right except the last word of the fourth, which forces a window move on the way back.
    const target = perRow * 4 - 1;
    for (let w = 0; w < target; w++) await typeText(page, `${words[w]} `);
    await typeText(page, "zzzzzzzzz ");
    const rowsEl = page.locator(".tp-rows");
    const lh = await page.locator(".tp-probe").evaluate((el) => el.getBoundingClientRect().height);
    await expect(rowsEl).toHaveAttribute("style", new RegExp(`translate3d\\(0(px)?, ?${-3 * lh}px`));

    await page.keyboard.press("Backspace");
    await expect(rowsEl).toHaveAttribute("style", new RegExp(`translate3d\\(0(px)?, ?${-2 * lh}px`));
    // The row now on top was out of the pool's forward window. It has to come back derived from the state.
    await page.waitForFunction(
      ([y, text]) =>
        Array.from(document.querySelectorAll<HTMLElement>(".tp-row")).some(
          (row) => row.style.transform.includes(`${y}px`) && row.textContent?.startsWith(text as string),
        ),
      [2 * lh, words[perRow * 2]] as const,
    );
    const letterStates = await page.$$eval(".tp-row .w", (els) => els.length);
    expect(letterStates).toBe(9);

    await page.keyboard.press("Backspace");
    expect(await page.$$eval(".tp-row .w", (els) => els.length)).toBe(8);
    for (let i = 0; i < 8; i++) await page.keyboard.press("Backspace");
    expect(await page.$$eval(".tp-row .w", (els) => els.length)).toBe(0);
    await typeText(page, `${words[target]} `);
    await expect(rowsEl).toHaveAttribute("style", new RegExp(`translate3d\\(0(px)?, ?${-3 * lh}px`));
  });

  test("a correct word stays locked", async ({ page }) => {
    await withText(page, ["ab", "cd", "ef"]);
    await page.goto("/");
    await ready(page);
    await typeText(page, "ab ");
    await page.keyboard.press("Backspace");
    await typeText(page, "c");
    expect(await letterClasses(page, 0)).toEqual(["c", "c"]);
    expect(await letterClasses(page, 1)).toEqual(["c", ""]);
  });
});

test.describe("input that isn't plain keys", () => {
  test("a dead key sequence through composition gives ã, with a ghost mark while it waits", async ({ page }) => {
    await withText(page, ["não", "ok"]);
    await page.goto("/");
    await ready(page);
    const session = await cdp(page);
    await typeText(page, "n");

    const down = { type: "rawKeyDown", key: "Process", code: "Quote", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 } as const;
    await session.send("Input.dispatchKeyEvent", down);
    await session.send("Input.imeSetComposition", { text: "~", selectionStart: 1, selectionEnd: 1 });
    await expect(page.locator(".tp-ghost")).toHaveText("~");
    expect(await letterClasses(page, 0)).toEqual(["c", "", ""]);
    await session.send("Input.dispatchKeyEvent", { ...down, type: "keyUp" });

    await session.send("Input.dispatchKeyEvent", { ...down, code: "KeyA" });
    await session.send("Input.imeSetComposition", { text: "ã", selectionStart: 1, selectionEnd: 1 });
    await session.send("Input.insertText", { text: "ã" });
    await session.send("Input.dispatchKeyEvent", { ...down, code: "KeyA", type: "keyUp" });

    expect(await letterClasses(page, 0)).toEqual(["c", "c", ""]);
    await expect(page.locator(".tp-ghost")).toBeHidden();
    await typeText(page, "o ok");
    await expect(page.getByTestId("result")).toBeVisible();
    await expect(page.locator('[data-stat="accuracy"]')).toContainText("100");
  });

  test("Ctrl+A, paste and drop do nothing", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await withText(page, ["hello", "world"]);
    await page.goto("/");
    await ready(page);
    await typeText(page, "he");
    const before = await letterClasses(page, 0);

    await page.evaluate(() => navigator.clipboard.writeText("zzzzzz"));
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Control+V");
    expect(await letterClasses(page, 0)).toEqual(before);
    expect(await page.locator(".tp-input").evaluate((el: HTMLInputElement) => el.value)).toBe("​");

    const session = await cdp(page);
    const box = await page.locator(".tp-input").boundingBox();
    const at = { x: (box?.x ?? 0) + 0.5, y: (box?.y ?? 0) + 0.5 };
    const data = { items: [{ mimeType: "text/plain", data: "zzzzzz" }], dragOperationsMask: 1 };
    await session.send("Input.dispatchDragEvent", { type: "dragEnter", ...at, data });
    await session.send("Input.dispatchDragEvent", { type: "drop", ...at, data });
    expect(await letterClasses(page, 0)).toEqual(before);
    expect(await page.locator(".tp-input").evaluate((el: HTMLInputElement) => el.value)).toBe("​");

    await typeText(page, "l");
    expect(await letterClasses(page, 0)).toEqual(["c", "c", "c", "", ""]);
  });

  test("Caps Lock warning takes the sentence's slot (forged event: CDP cannot set Caps Lock)", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    const fire = (on: boolean) =>
      page.evaluate((caps) => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", modifierCapsLock: caps })), on);
    await expect(page.locator(".tp-caps")).toBeHidden();
    await fire(true);
    await expect(page.locator(".tp-caps")).toBeVisible();
    await expect(page.locator(".tp-sentence")).toBeHidden();
    await fire(false);
    await expect(page.locator(".tp-caps")).toBeHidden();
    await expect(page.locator(".tp-sentence")).toBeVisible();
  });
});

test.describe("keys and focus", () => {
  test("Tab gives new words at once, idle or running, and Shift+Tab moves out", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    const first = await readWords(page);
    await page.keyboard.press("Tab");
    const second = await readWords(page);
    expect(second).not.toEqual(first);
    await expect(page.locator(".tp-input")).toBeFocused();

    await typeText(page, second[0] as string);
    await expect(page.locator("html")).toHaveAttribute("data-typing", "");
    await page.keyboard.press("Tab");
    expect(await readWords(page)).not.toEqual(second);
    await expect(page.locator("html")).not.toHaveAttribute("data-typing", "");

    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".tp-input")).not.toBeFocused();
  });

  test("Esc: with keys typed gives new words, and idle moves to the chrome", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    const first = await readWords(page);
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-first-control]")).toBeFocused();
    expect(await readWords(page)).toEqual(first);
    await page.keyboard.press("Escape");
    await expect(page.locator(".tp-input")).toBeFocused();

    await typeText(page, first[0] as string);
    await page.keyboard.press("Escape");
    await expect(page.locator(".tp")).toHaveAttribute("data-phase", "idle");
    expect(await readWords(page)).not.toEqual(first);
  });

  test("a letter from a focused control starts typing and keeps that letter", async ({ page }) => {
    await withText(page, ["hello"]);
    await page.goto("/");
    await ready(page);
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(".tp-input")).not.toBeFocused();
    await page.keyboard.press("h");
    await expect(page.locator(".tp-input")).toBeFocused();
    expect(await letterClasses(page, 0)).toEqual(["c", "", "", "", ""]);
  });

  test("a mouse click on sound leaves focus on the input, so Space can't press it again", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: "sound off" }).click();
    await expect(page.getByRole("button", { name: "sound on" })).toBeVisible();
    await expect(page.locator(".tp-input")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "sound on" })).toBeVisible();
  });

  test("Alt+M toggles sound and types nothing", async ({ page }) => {
    await withText(page, ["hello"]);
    await page.goto("/");
    await ready(page);
    await page.keyboard.press("Alt+KeyM");
    await expect(page.getByRole("button", { name: "sound on" })).toBeVisible();
    expect(await letterClasses(page, 0)).toEqual(["", "", "", "", ""]);
    await expect(page.locator(".tp")).toHaveAttribute("data-phase", "idle");
  });

  test("blur during a run shows the message and the clock keeps running (focus moved by script)", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    const words = await readWords(page);
    await typeText(page, words[0] as string);
    await expect(page.locator(".tp-blurred")).toBeHidden();
    await page.locator(".tp-input").evaluate((el: HTMLInputElement) => el.blur());
    await expect(page.locator(".tp-blurred")).toBeVisible();
    await expect(page.locator(".tp-n")).not.toHaveText("60", { timeout: 2000 });
    await page.keyboard.press("x");
    await expect(page.locator(".tp-input")).toBeFocused();
    await expect(page.locator(".tp-blurred")).toBeHidden();
  });

  test("a hidden tab aborts, unsaved, with new words (simulated with a visibilitychange)", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    const words = await readWords(page);
    await typeText(page, `${words[0]} `);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator(".tp")).toHaveAttribute("data-phase", "idle");
    await expect(page.getByTestId("result")).toHaveCount(0);
    expect(await readWords(page)).not.toEqual(words);
    await expect(page.locator(".tp-n")).toHaveText("60");
  });
});

test.describe("the Activity trap", () => {
  const dirty = (page: import("@playwright/test").Page) => page.$$eval(".tp-rows .c, .tp-rows .w, .tp-rows .x, .tp-rows .m", (els) => els.length);

  test("browser back and a Link both return to a fresh idle test", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    const words = await readWords(page);
    await typeText(page, `${words[0]} ${words[1]}`);
    expect(await dirty(page)).toBeGreaterThan(0);

    // Chrome is hidden during a run, so the real click has to be dispatched on the hidden link.
    await page.locator('footer a[hreflang="pt-BR"]').dispatchEvent("click");
    await expect(page).toHaveURL(/\/pt-br$/);
    await ready(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.locator("html")).not.toHaveAttribute("data-typing", "");

    await page.goBack();
    // Both pages stay mounted, one of them hidden. That is the trap, so assert it is really what happened here.
    await expect(page.locator(".tp")).toHaveCount(2);
    await expect(page).toHaveURL(/\/$/);
    await ready(page);
    await expect(page.locator(".tp:visible")).toHaveAttribute("data-phase", "idle");
    await expect(page.locator(".tp:visible .tp-n")).toHaveText("60");
    expect(await dirty(page)).toBe(0);
    expect(await readWords(page)).not.toEqual(words);
    await expect(page.locator("html")).not.toHaveAttribute("data-typing", "");

    const again = await readWords(page);
    await typeText(page, again[0] as string);
    expect(await dirty(page)).toBeGreaterThan(0);

    await page.locator('footer a[hreflang="pt-BR"]').dispatchEvent("click");
    await expect(page).toHaveURL(/\/pt-br$/);
    await ready(page);
    await page.locator('footer a[hreflang="en"]').click();
    await expect(page).toHaveURL(/\/$/);
    await ready(page);
    expect(await dirty(page)).toBe(0);
    await expect(page.locator(".tp:visible")).toHaveAttribute("data-phase", "idle");
    const fresh = await readWords(page);
    await typeText(page, fresh[0] as string);
    await expect(page.locator(".tp:visible")).toHaveAttribute("data-phase", "running");
  });
});

test.describe("touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("tapping the words focuses the input in the gesture, and a virtual keyboard makes the run casual", async ({ page }) => {
    await withText(page, ["hello", "world"]);
    await page.goto("/");
    await ready(page);
    await expect(page.locator(".tp-hint-touch")).toBeVisible();
    await expect(page.locator(".tp-hint-keys")).toBeHidden();
    await expect(page.locator(".tp-input")).not.toBeFocused();
    await page.locator(".tp-viewport").tap();
    await expect(page.locator(".tp-input")).toBeFocused();

    const session = await cdp(page);
    await session.send("Input.insertText", { text: "hello " });
    await session.send("Input.insertText", { text: "world" });
    await expect(page.getByTestId("result")).toBeVisible();
    await expect(page.getByTestId("result")).toHaveAttribute("data-device", "touch");
  });

  test("the test lifts above an on-screen keyboard (simulated visual viewport)", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.evaluate(() => {
      const vv = window.visualViewport as VisualViewport;
      Object.defineProperty(vv, "height", { configurable: true, get: () => 300 });
      vv.dispatchEvent(new Event("resize"));
    });
    const bottom = await page.locator(".tp-viewport").evaluate((el) => el.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(300);
    await page.evaluate(() => {
      const vv = window.visualViewport as VisualViewport;
      delete (vv as unknown as { height?: number }).height;
      vv.dispatchEvent(new Event("resize"));
    });
    await expect(page.locator(".tp-block")).not.toHaveAttribute("style", /translate/);
  });
});
