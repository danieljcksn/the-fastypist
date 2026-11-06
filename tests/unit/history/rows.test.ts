import { beforeEach, describe, expect, it, vi } from "vitest";
import { pairsFromQuery } from "@/typing/history/drill";
import { KEEP_RAW_RUNS, rawToDrop } from "@/typing/history/raw";
import {
  BESTS_KEY,
  bestKey,
  bestKeyOf,
  countsForPace,
  HISTORY_KEY,
  type HistoryRow,
  importRow,
  MAX_ROWS,
  parseBests,
  parseRow,
  parseRows,
  raiseBests,
} from "@/typing/history/rows";
import { appendRow, loadHistory, resetHistoryCache } from "@/typing/history/summaries";

const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  id: "a",
  kind: "free",
  status: "unverified",
  mode: "time",
  amount: 60,
  language: "en",
  pack: "en-1k@1",
  mods: "",
  wpmCx: 8000,
  rawCx: 8200,
  accuracyBp: 9700,
  consistencyBp: 8100,
  elapsedMs: 60000,
  afkMs: 0,
  finishedAt: 1_800_000_000_000,
  localDay: "2027-01-15",
  device: "keyboard",
  ...over,
});

function fakeStorage(fail: (key: string) => boolean = () => false) {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem(key: string, value: string) {
      if (fail(key)) throw new DOMException("full", "QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key: string) => void map.delete(key),
    map,
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

describe("parsing what was stored", () => {
  it("survives corrupt, foreign and future stores", () => {
    expect(parseRows(null)).toEqual([]);
    expect(parseRows("not json")).toEqual([]);
    expect(parseRows("[]")).toEqual([]);
    expect(parseRows('{"v":99,"rows":[]}')).toEqual([]);
    expect(parseBests("{")).toEqual({});
    expect(parseBests('{"v":1,"bests":null}')).toEqual({});
  });

  it("drops bad rows and keeps the good ones", () => {
    const stored = JSON.stringify({ v: 1, rows: [row({ id: "good" }), { id: "bad" }, null, { ...row(), wpmCx: "fast" }, { ...row(), pack: "xx" }] });
    expect(parseRows(stored).map((r) => r.id)).toEqual(["good"]);
  });

  it("sorts oldest first, one row per id, capped at 500", () => {
    const rows = Array.from({ length: MAX_ROWS + 5 }, (_, i) => row({ id: `r${i}`, finishedAt: 1000 + MAX_ROWS - i }));
    const parsed = parseRows(JSON.stringify({ v: 1, rows: [...rows, rows[0]] }));
    expect(parsed).toHaveLength(MAX_ROWS);
    expect(parsed.at(-1)?.id).toBe("r0");
    expect(parsed[0]?.finishedAt).toBeLessThan(parsed[1]?.finishedAt ?? 0);
  });

  it("forces the status: a stored row is never anything but unverified", () => {
    expect(parseRow({ ...row(), status: "passed" })?.status).toBe("unverified");
  });
});

describe("personal bests", () => {
  it("are per mode, language and list", () => {
    const keys = [
      row(),
      row({ amount: 30 }),
      row({ language: "pt", pack: "pt-1k@1" }),
      row({ pack: "en-5k@1" }),
      row({ mods: "p" }),
      row({ mode: "words", amount: 60 }),
    ].map(bestKeyOf);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("share one key per language across quotes, and your own text has none", () => {
    expect(bestKey({ mode: "quote", amount: 12, language: "en", pack: null, mods: "" })).toBe(bestKey({ mode: "quote", amount: 40, language: "en", pack: null, mods: "" }));
    expect(bestKey({ mode: "custom", amount: 12, language: "en", pack: null, mods: "" })).toBeNull();
  });

  it("are never set by a drill or a 0 wpm run", () => {
    expect(bestKeyOf(row({ kind: "drill" }))).toBeNull();
    expect(bestKeyOf(row({ wpmCx: 0 }))).toBeNull();
  });

  it("heal from the rows and outlive an evicted row", () => {
    const evicted = { [bestKeyOf(row()) as string]: { id: "old", wpmCx: 9000, accuracyBp: 9000, finishedAt: 1 } };
    expect(raiseBests(evicted, [row({ wpmCx: 8000 })])[bestKeyOf(row()) as string]?.id).toBe("old");
    expect(raiseBests({}, [row({ id: "x" })])[bestKeyOf(row()) as string]?.id).toBe("x");
  });
});

describe("Pace's runs", () => {
  it("takes only 60 s on the 1k list, unmodified, at 85% or better", () => {
    expect(countsForPace(row())).toBe(true);
    expect(countsForPace(row({ accuracyBp: 8499 }))).toBe(false);
    expect(countsForPace(row({ accuracyBp: 8500 }))).toBe(true);
    expect(countsForPace(row({ amount: 30 }))).toBe(false);
    expect(countsForPace(row({ pack: "en-5k@1" }))).toBe(false);
    expect(countsForPace(row({ mods: "n" }))).toBe(false);
    expect(countsForPace(row({ kind: "drill" }))).toBe(false);
    expect(countsForPace(row({ mode: "words" }))).toBe(false);
    expect(countsForPace(row({ wpmCx: 0 }))).toBe(false);
  });
});

describe("the account import", () => {
  it("shapes a run the way the server's schema takes it", () => {
    expect(importRow(row())).toEqual({
      id: "a",
      pack: "en-1k@1",
      mode: "time",
      amount: 60,
      wpmCx: 8000,
      rawCx: 8200,
      accuracyBp: 9700,
      consistencyBp: 8100,
      elapsedMs: 60000,
      finishedAt: new Date(row().finishedAt).toISOString(),
      localDay: "2027-01-15",
    });
    expect(importRow(row({ mode: "quote", pack: null }))?.mode).toBe("words");
  });

  it("leaves drills on the device", () => {
    expect(importRow(row({ kind: "drill" }))).toBeNull();
  });
});

describe("the stored history", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetHistoryCache();
  });

  it("reports no best on a first run, then the change", () => {
    fakeStorage();
    expect(appendRow(row({ id: "1", wpmCx: 8000 }))).toEqual({ previous: null, isBest: true });
    const second = appendRow(row({ id: "2", wpmCx: 8320, finishedAt: 2e12 }));
    expect(second.previous?.wpmCx).toBe(8000);
    expect(second.isBest).toBe(true);
    const third = appendRow(row({ id: "3", wpmCx: 7000, finishedAt: 3e12 }));
    expect(third.previous?.wpmCx).toBe(8320);
    expect(third.isBest).toBe(false);
  });

  it("gives a drill no best to compare with, and keeps the real best", () => {
    fakeStorage();
    appendRow(row({ id: "1", wpmCx: 8000 }));
    expect(appendRow(row({ id: "2", kind: "drill", wpmCx: 12000, finishedAt: 2e12 }))).toEqual({ previous: null, isBest: false });
    expect(Object.values(loadHistory().bests).map((b) => b.wpmCx)).toEqual([8000]);
  });

  it("writes through and reads back", () => {
    const storage = fakeStorage();
    appendRow(row());
    expect(JSON.parse(storage.map.get(HISTORY_KEY) as string).v).toBe(1);
    resetHistoryCache();
    expect(loadHistory().rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("is idempotent per id", () => {
    fakeStorage();
    appendRow(row());
    appendRow(row());
    expect(loadHistory().rows).toHaveLength(1);
  });

  it("keeps at most 500 rows, dropping the oldest", () => {
    const storage = fakeStorage();
    storage.setItem(HISTORY_KEY, JSON.stringify({ v: 1, rows: Array.from({ length: MAX_ROWS }, (_, i) => row({ id: `r${i}`, finishedAt: i + 1 })) }));
    appendRow(row({ id: "new", finishedAt: 1e12 }));
    const rows = loadHistory().rows;
    expect(rows).toHaveLength(MAX_ROWS);
    expect(rows[0]?.id).toBe("r1");
    expect(rows.at(-1)?.id).toBe("new");
  });

  it("recovers from a corrupt store on the next write", () => {
    const storage = fakeStorage();
    storage.setItem(HISTORY_KEY, "{{{");
    storage.setItem(BESTS_KEY, "nope");
    expect(appendRow(row())).toEqual({ previous: null, isBest: true });
    expect(loadHistory().rows).toHaveLength(1);
  });

  it("keeps working in memory when writes are refused", () => {
    fakeStorage(() => true);
    expect(appendRow(row({ id: "1", wpmCx: 8000 })).isBest).toBe(true);
    const second = appendRow(row({ id: "2", wpmCx: 9000, finishedAt: 2e12 }));
    expect(second.previous?.wpmCx).toBe(8000);
    expect(loadHistory().rows.map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("keeps working in memory when storage can't even be read", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new DOMException("denied", "SecurityError");
      },
      setItem() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(loadHistory().rows).toEqual([]);
    expect(appendRow(row()).isBest).toBe(true);
    expect(loadHistory().rows).toHaveLength(1);
  });

  it("gives room back when storage is full, so the newest run lands", () => {
    let full = true;
    const storage = fakeStorage((key) => key === HISTORY_KEY && full);
    full = false;
    storage.setItem(HISTORY_KEY, JSON.stringify({ v: 1, rows: Array.from({ length: 300 }, (_, i) => row({ id: `r${i}`, finishedAt: i + 1 })) }));
    full = true;
    const original = storage.setItem;
    let attempts = 0;
    storage.setItem = (key: string, value: string) => {
      if (key === HISTORY_KEY && attempts++ === 0) throw new DOMException("full", "QuotaExceededError");
      storage.map.set(key, value);
    };
    appendRow(row({ id: "new", finishedAt: 1e12 }));
    storage.setItem = original;
    const stored = parseRows(storage.map.get(HISTORY_KEY) as string);
    expect(stored).toHaveLength(201);
    expect(stored.at(-1)?.id).toBe("new");
  });
});

describe("which raw logs stay", () => {
  const held = Array.from({ length: KEEP_RAW_RUNS + 3 }, (_, i) => ({ id: `r${i}`, finishedAt: i }));

  it("drops all but the newest 50", () => {
    expect(rawToDrop(held, new Set()).sort()).toEqual(["r0", "r1", "r2"]);
  });

  it("never drops a personal best", () => {
    expect(rawToDrop(held, new Set(["r0"])).sort()).toEqual(["r1", "r2"]);
  });

  it("has nothing to drop at or under the limit", () => {
    expect(rawToDrop(held.slice(0, KEEP_RAW_RUNS), new Set())).toEqual([]);
  });
});

describe("a drill link", () => {
  it("takes up to 3 distinct letter pairs", () => {
    expect(pairsFromQuery("?drill=th,qu,%C3%A3o,ck")).toEqual(["th", "qu", "ão"]);
    expect(pairsFromQuery("?drill=th,th")).toEqual(["th"]);
  });

  it("ignores anything else", () => {
    expect(pairsFromQuery("")).toEqual([]);
    expect(pairsFromQuery("?drill=")).toEqual([]);
    expect(pairsFromQuery("?drill=abc,1a,<b")).toEqual([]);
  });
});
