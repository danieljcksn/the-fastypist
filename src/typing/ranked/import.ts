import { loadHistory } from "../history/summaries";
import type { HistoryRow } from "../history/rows";

// Below the server's IMPORT_CAP doubled, and the newest rows are what its cap keeps anyway.
const MAX_ROWS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Drills, quotes and custom text stay on the device: the server's rows are word-list runs. */
export function importableRows(rows: readonly HistoryRow[]) {
  return rows
    .filter((row) => row.kind === "free" && (row.mode === "time" || row.mode === "words") && row.mods === "" && UUID.test(row.id))
    .slice(-MAX_ROWS)
    .map((row) => ({
      id: row.id,
      pack: row.pack,
      mode: row.mode,
      amount: row.amount,
      wpmCx: row.wpmCx,
      rawCx: row.rawCx,
      accuracyBp: row.accuracyBp,
      consistencyBp: row.consistencyBp,
      elapsedMs: row.elapsedMs,
      finishedAt: new Date(row.finishedAt).toISOString(),
      localDay: row.localDay,
    }));
}

export function localRows() {
  return importableRows(loadHistory().rows);
}
