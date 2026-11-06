import type { CDPSession, Page } from "@playwright/test";

export const SIZES = [
  [320, 568],
  [390, 844],
  [1440, 900],
  [2560, 1440],
] as const;

export async function ready(page: Page) {
  await page.waitForSelector(".tp-word");
  await page.waitForFunction(() => document.documentElement.dataset.pending === undefined);
}

/** Starts the page on a known text, stored the way the custom dialog stores it. */
export async function withText(page: Page, words: string[]) {
  await page.addInitScript((customWords) => {
    localStorage.setItem("fastypist:test", JSON.stringify({ mode: { kind: "custom" }, customWords, language: "en", tier: "1k" }));
  }, words);
}

export function keyName(ch: string): string {
  return ch === " " ? "Space" : ch;
}

export async function typeText(page: Page, text: string, delay = 0) {
  for (const ch of text) {
    // Playwright has no key for ã. insertText is what a keyboard's committed character looks like to the page.
    if (ch.charCodeAt(0) > 0x7f) await page.keyboard.insertText(ch);
    else await page.keyboard.press(keyName(ch));
    if (delay > 0) await page.waitForTimeout(delay);
  }
}

/** Every remaining word, from the screen reader's list. The rows only hold what fits, so at 320 readWords misses most of a text. */
export const upcoming = (page: Page) => page.evaluate(() => [...document.querySelectorAll(".tp > div[hidden]")].map((d) => d.textContent).at(-1) ?? "");

export async function typeAll(page: Page, delay = 5) {
  for (let guard = 0; guard < 400; guard++) {
    if (await page.getByTestId("result").count()) return;
    const next = (await upcoming(page)).split(" ")[0];
    if (!next) return;
    await typeText(page, next, delay);
    if (await page.getByTestId("result").count()) return;
    await page.keyboard.press("Space");
  }
}

/** Slow on one pair and even everywhere else, so the run has a slowest pair a test knows in advance. */
export async function typeSlowOn(page: Page, words: readonly string[], pair: string) {
  for (const [w, word] of words.entries()) {
    for (let i = 0; i < word.length; i++) {
      const slow = i > 0 && word.slice(i - 1, i + 1) === pair;
      await page.waitForTimeout(slow ? 220 : 45);
      await page.keyboard.press(word.charAt(i));
    }
    if (w < words.length - 1) await page.keyboard.press("Space");
  }
}

export const readWords = (page: Page) => page.$$eval(".tp-word", (els) => els.map((el) => el.textContent ?? ""));

export const letterClasses = (page: Page, word: number) =>
  page.$$eval(
    ".tp-word",
    (els, index) => Array.from(els[index]?.children ?? []).map((span) => span.className),
    word,
  );

/** Every keydown's own timestamp, recorded before the app sees it, so a test computes its numbers independently. */
export async function recordKeydowns(page: Page) {
  await page.addInitScript(() => {
    const stamps: number[] = [];
    (window as unknown as { __stamps: number[] }).__stamps = stamps;
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key.length === 1) stamps.push(e.timeStamp);
      },
      { capture: true },
    );
  });
}

export const stamps = (page: Page) => page.evaluate(() => (window as unknown as { __stamps: number[] }).__stamps);

export async function cdp(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}
