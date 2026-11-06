import { buildText, wordCountForDuration } from "@/engine/generate";
import { loadPack, type Pack, type PackId } from "@/engine/packs";
import { seedFromHex, xoshiro128pp } from "@/engine/prng";
import { loadQuotes, type QuotePack, quoteWords } from "@/engine/quotes";
import type { Language } from "@/engine/packs";
import { packIdFor, type TestSettings, TIERS } from "./settings";

export interface RunText {
  words: string[];
  packId: PackId | null;
  quoteId: string | null;
}

const packs = new Map<PackId, Pack>();
const quotes = new Map<Language, QuotePack>();

/** The page's default list arrives with the page, so its first run never touches the network. */
export function seedPack(pack: Pack): void {
  packs.set(pack.id, pack);
}

export function randomSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** The text if everything it needs is already here. Null means ensureText first. */
export function textNow(settings: TestSettings, seed: string): RunText | null {
  const { mode } = settings;
  if (mode.kind === "custom") return { words: [...settings.customWords], packId: null, quoteId: null };
  if (mode.kind === "quote") {
    const pack = quotes.get(settings.language);
    if (!pack || pack.quotes.length === 0) return null;
    const quote = pack.quotes[xoshiro128pp(seedFromHex(seed)).int(pack.quotes.length)];
    return quote ? { words: quoteWords(quote.text), packId: null, quoteId: quote.id } : null;
  }
  const packId = packIdFor(settings);
  const pack = packs.get(packId);
  if (!pack) return null;
  const count = mode.kind === "time" ? wordCountForDuration(mode.seconds * 1000) : mode.count;
  const accentFree = settings.language === "pt" && settings.accentFree;
  return {
    words: buildText({ seed, count, punctuation: settings.punctuation, numbers: settings.numbers, accentFree }, pack.words),
    packId,
    quoteId: null,
  };
}

export async function ensureText(settings: TestSettings): Promise<void> {
  if (settings.mode.kind === "custom") return;
  if (settings.mode.kind === "quote") {
    if (!quotes.has(settings.language)) quotes.set(settings.language, await loadQuotes(settings.language));
    return;
  }
  const id = packIdFor(settings);
  if (!packs.has(id)) packs.set(id, await loadPack(id));
}

/** Loads what a change of list would need. Failures stay quiet: selecting that list reports its own. */
export function prefetchLists(language: Language): void {
  for (const tier of TIERS) {
    const id = packIdFor({ language, tier });
    if (!packs.has(id)) loadPack(id).then((pack) => packs.set(id, pack), () => undefined);
  }
  if (!quotes.has(language)) loadQuotes(language).then((pack) => quotes.set(language, pack), () => undefined);
}

export function newUuid(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  // RFC 9562 version 4. Not crypto.randomUUID: it only exists on secure origins, and LAN testing is plain http.
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  let hex = "";
  for (const byte of b) hex += byte.toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function localDay(epochMs: number): string {
  // en-CA formats as YYYY-MM-DD. The default time zone is the runtime's IANA zone.
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(epochMs);
}
