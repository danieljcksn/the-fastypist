#!/usr/bin/env node
// Usage: node scripts/build-packs.mjs --inputs <dir> [--dump <dir>]
// Raw inputs stay out of the repo. Missing ones are downloaded to <dir> and
// every one is checked against the hash pinned in data/sources.json.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src/engine/packs");
const VERSION = 1;
const TIERS = [
  ["200", 200],
  ["1k", 1000],
  ["5k", 5000],
];
const LANGUAGES = {
  // en marks its profanity NOSUGGEST, so that flag rejects. VERO puts it on
  // "o", "e", "se" and "do" as well as on vulgar words, so hand review decides.
  en: { list: "en_50k.txt", letters: /^[a-z]{1,14}$/, rejectNoSuggest: true },
  pt: { list: "pt_br_50k.txt", letters: /^[a-záàâãéêíóôõúüç]{1,14}$/, rejectNoSuggest: false },
};

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

async function readInput(dir, name, source) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = readFileSync(path);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== source.sha256) throw new Error(`${name}: sha256 ${actual}, pinned ${source.sha256}`);
  return bytes.toString("utf8");
}

// Membership by reversing affix rules, because expanding VERO in full, or
// loading it in nspell, did not finish in 560 s. Covers what these two .aff
// files use: PFX, SFX, cross product, one level of continuation.
// Case stays exact: "Paulo" in the .dic does not admit "paulo", as in hunspell.
function loadSpeller(affText, dicText, rejectNoSuggest) {
  const directive = (name) => affText.match(new RegExp(`^${name} (\\S+)`, "m"))?.[1];
  const forbidden = directive("FORBIDDENWORD");
  const noSuggest = rejectNoSuggest ? directive("NOSUGGEST") : undefined;
  const stems = new Map();
  for (const line of dicText.split("\n").slice(1)) {
    const [entry] = line.split(/\s/);
    if (!entry) continue;
    const slash = entry.indexOf("/");
    const word = slash === -1 ? entry : entry.slice(0, slash);
    const flags = new Set(slash === -1 ? [] : Array.from(entry.slice(slash + 1)));
    stems.set(word, new Set([...(stems.get(word) ?? []), ...flags]));
  }

  const rules = { PFX: new Map(), SFX: new Map() };
  const crossFlags = new Set();
  for (const line of affText.split("\n")) {
    const parts = line.trim().split(/\s+/);
    const kind = parts[0];
    if (kind !== "PFX" && kind !== "SFX") continue;
    if (parts[2] === "Y" && parts.length === 4) crossFlags.add(`${kind}${parts[1]}`);
    if ((parts[2] === "Y" || parts[2] === "N") && parts.length === 4) continue;
    const [addRaw, contRaw = ""] = (parts[3] ?? "").split("/");
    const add = addRaw === "0" ? "" : (addRaw ?? "");
    const strip = parts[2] === "0" ? "" : (parts[2] ?? "");
    const cond = parts[4] ?? ".";
    const rule = {
      flag: parts[1],
      strip,
      cont: new Set(Array.from(contRaw)),
      cross: crossFlags.has(`${kind}${parts[1]}`),
      test: cond === "." ? null : new RegExp(kind === "PFX" ? `^${cond}` : `${cond}$`),
    };
    const bucket = rules[kind].get(add);
    if (bucket) bucket.push(rule);
    else rules[kind].set(add, [rule]);
  }

  const stemHas = (stem, flag) => {
    const flags = stems.get(stem);
    return flags !== undefined && flags.has(flag) && !flags.has(forbidden) && !flags.has(noSuggest);
  };
  function* undoSuffixes(word) {
    for (let cut = 0; cut <= word.length; cut++) {
      for (const rule of rules.SFX.get(word.slice(cut)) ?? []) {
        const stem = word.slice(0, cut) + rule.strip;
        if (!rule.test || rule.test.test(stem)) yield { stem, rule };
      }
    }
  }
  function* undoPrefixes(word) {
    for (let cut = 0; cut <= word.length; cut++) {
      for (const rule of rules.PFX.get(word.slice(0, cut)) ?? []) {
        const stem = rule.strip + word.slice(cut);
        if (!rule.test || rule.test.test(stem)) yield { stem, rule };
      }
    }
  }
  const viaSuffix = (word) => {
    for (const { stem, rule } of undoSuffixes(word)) {
      if (stemHas(stem, rule.flag)) return true;
      for (const inner of undoSuffixes(stem)) {
        if (inner.rule.cont.has(rule.flag) && stemHas(inner.stem, inner.rule.flag)) return true;
      }
    }
    return false;
  };
  return (word) => {
    const own = stems.get(word);
    if (own !== undefined && (own.has(forbidden) || own.has(noSuggest))) return false;
    if (own !== undefined) return true;
    if (viaSuffix(word)) return true;
    for (const { stem, rule } of undoPrefixes(word)) {
      if (stemHas(stem, rule.flag)) return true;
      if (!rule.cross) continue;
      for (const inner of undoSuffixes(stem)) {
        if (inner.rule.cross && stemHas(inner.stem, rule.flag) && stemHas(inner.stem, inner.rule.flag)) return true;
      }
    }
    return false;
  };
}

function readExclusions(language) {
  const text = readFileSync(join(ROOT, `data/review/${language}.exclude.txt`), "utf8");
  return new Set(text.split("\n").map((line) => line.trim().normalize("NFC")).filter(Boolean));
}

function candidates(listText, language, spell) {
  const { letters } = LANGUAGES[language];
  const seen = new Set();
  const kept = [];
  const rejected = [];
  for (const line of listText.split("\n")) {
    const raw = line.split(" ")[0];
    if (!raw) continue;
    const word = raw.normalize("NFC").toLowerCase();
    if (seen.has(word) || !letters.test(word)) continue;
    seen.add(word);
    (spell(word) ? kept : rejected).push(word);
  }
  return { kept, rejected };
}

function writeImmutable(path, content) {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") === content) return "unchanged";
    throw new Error(`${path} differs and pack files are immutable: raise VERSION instead`);
  }
  writeFileSync(path, content);
  return "written";
}

const inputs = arg("inputs");
if (!inputs) {
  console.error("usage: node scripts/build-packs.mjs --inputs <dir> [--dump <dir>]");
  process.exit(2);
}
mkdirSync(inputs, { recursive: true });
const dump = arg("dump");
if (dump) mkdirSync(dump, { recursive: true });
const sources = JSON.parse(readFileSync(join(ROOT, "data/sources.json"), "utf8"));

for (const [language, { list, rejectNoSuggest }] of Object.entries(LANGUAGES)) {
  const spell = loadSpeller(
    await readInput(inputs, `${language}.aff`, sources[`${language}.aff`]),
    await readInput(inputs, `${language}.dic`, sources[`${language}.dic`]),
    rejectNoSuggest,
  );
  const { kept, rejected } = candidates(await readInput(inputs, list, sources[list]), language, spell);
  const excluded = readExclusions(language);
  const words = kept.filter((word) => !excluded.has(word));
  if (dump) {
    writeFileSync(join(dump, `${language}.accepted.txt`), `${words.join("\n")}\n`);
    writeFileSync(join(dump, `${language}.rejected.txt`), `${rejected.join("\n")}\n`);
  }
  for (const [tier, size] of TIERS) {
    if (words.length < size) throw new Error(`${language}-${tier}: only ${words.length} words`);
    const list = words.slice(0, size);
    const sha256 = createHash("sha256").update(list.join(" "), "utf8").digest("hex");
    const id = `${language}-${tier}@${VERSION}`;
    const json = `${JSON.stringify({ id, language, version: VERSION, license: "CC-BY-SA-4.0", sha256, words: list })}\n`;
    const state = dump ? "dumped" : writeImmutable(join(OUT, `${id}.json`), json);
    const letters = list.reduce((sum, word) => sum + word.length, 0);
    const accented = list.filter((word) => /[^a-z]/.test(word)).length;
    console.log(
      [
        id.padEnd(10),
        `count ${list.length}`,
        `mean ${(letters / size).toFixed(3)}`,
        `accented ${((100 * accented) / size).toFixed(1)}%`,
        `gzip ${gzipSync(json, { level: 9 }).length} B`,
        state,
      ].join("  "),
    );
  }
}
