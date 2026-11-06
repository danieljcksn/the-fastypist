#!/usr/bin/env node
// Usage: node scripts/check-quotes.mjs <raw-dir> [--record]
// Re-runs the verbatim check of src/engine/quotes against the downloaded sources.
// Raw texts stay out of the repo. <raw-dir>/manifest.json maps each source URL to a
// file under <raw-dir>. --record rewrites src/engine/quotes/verification@1.json.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const QUOTES = join(ROOT, "src/engine/quotes");
const LANGUAGES = ["en", "pt"];
const TOKEN = /[\p{L}\d]+(?:['-][\p{L}\d]+)*/gu;

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function stripBoilerplate(text) {
  const unix = text.replace(/\r\n/g, "\n");
  const start = unix.search(/\*\*\* ?START OF TH[EI]S? PROJECT GUTENBERG[^\n]*\n/);
  if (start < 0) return unix;
  const end = unix.search(/\*\*\* ?END OF TH[EI]S? PROJECT GUTENBERG/);
  return unix.slice(unix.indexOf("\n", start) + 1, end >= 0 ? end : undefined);
}

export function normalizeSource(raw) {
  return stripBoilerplate(raw)
    .normalize("NFC")
    .replace(/­/g, "")
    .replace(/[‘’ʼ‚‛`´]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‐-―−]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/…/g, "...")
    .replace(/_/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Whole tokens only, so an edit for "ha" can never touch "chave".
export function applyEdits(text, edits) {
  const map = new Map(edits);
  return text.replace(TOKEN, (word) => map.get(word) ?? word);
}

function fold(word) {
  return word.normalize("NFD").replace(/\p{M}/gu, "").replace(/['\- ]/g, "").toLowerCase();
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length];
}

// Under half the letters, or any short word could become any other: "não" -> "sim" is three edits of three.
// The furthest real respelling in the log is symphonia -> sinfonia, four of nine.
// It cannot tell "mar" from "mas", so the edit log still gets read.
export function isRespelling([from, to]) {
  const letters = fold(from);
  return editDistance(letters, fold(to)) * 2 < letters.length;
}

export function checkQuote(quote, edits, source) {
  if (quote.modernized !== edits.length > 0) return { ok: false, reason: "modernized flag disagrees with the edit log" };
  const unedited = source.indexOf(quote.text);
  if (!quote.modernized) {
    return unedited >= 0 ? { ok: true, offset: unedited } : { ok: false, reason: "not in source" };
  }
  if (unedited >= 0) return { ok: false, reason: "marked modernized but verbatim in source" };
  const stray = edits.find((edit) => !isRespelling(edit));
  if (stray) return { ok: false, reason: `edit is not a respelling: ${stray.join(" -> ")}` };
  const offset = applyEdits(source, edits).indexOf(quote.text);
  return offset >= 0 ? { ok: true, offset } : { ok: false, reason: "not in source after logged edits" };
}

function main() {
  const [rawDir, flag] = process.argv.slice(2);
  if (!rawDir) {
    console.error("usage: node scripts/check-quotes.mjs <raw-dir> [--record]");
    process.exit(2);
  }
  const manifest = readJson(join(rawDir, "manifest.json"));
  const provenance = readJson(join(QUOTES, "provenance@1.json"));
  const sources = new Map();
  const record = { sources: {}, packs: {}, results: {} };
  const failures = [];

  for (const language of LANGUAGES) {
    const pack = readJson(join(QUOTES, `${language}@1.json`));
    record.packs[pack.id] = pack.sha256;
    for (const quote of pack.quotes) {
      const file = manifest[quote.source];
      let source = sources.get(quote.source);
      if (file && !source) {
        const raw = readFileSync(join(rawDir, file));
        source = normalizeSource(raw.toString("utf8"));
        sources.set(quote.source, source);
        record.sources[quote.source] = { file, sha256: sha256(raw) };
      }
      const result = source
        ? checkQuote(quote, provenance.edits[quote.id] ?? [], source)
        : { ok: false, reason: "source missing from manifest" };
      record.results[quote.id] = result;
      if (!result.ok) failures.push(`${quote.id}: ${result.reason}`);
    }
  }

  const total = Object.keys(record.results).length;
  console.log(`${total - failures.length}/${total} passages verified against ${sources.size} sources`);
  for (const failure of failures) console.error(failure);
  if (flag === "--record") {
    writeFileSync(join(QUOTES, "verification@1.json"), `${JSON.stringify(record, null, 1)}\n`);
  }
  process.exit(failures.length ? 1 : 0);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
