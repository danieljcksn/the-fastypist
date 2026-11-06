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
