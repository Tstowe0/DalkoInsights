import { mountFileTool } from "../_shared/file-ui.js";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  objectsToWorkbook,
  downloadWorkbook,
  paintWorkbookTheme,
} from "../_shared/excel.js";

export const meta = {
  id: "Tracking Report",
  title: "Tracking Report",
  category: "Tracking Apps",
  script: "Tracking Apps/Tracking Report.js",
};

const DROP_STATUS = new Set([
  "DELIVERED",
  "INVOICED",
  "PICKUP REQUESTED",
  "QUOTE MODIFIED",
  "BOOKED OPEN",
  "BOOKED",
  "SPOT QUOTED",
  "QUOTED",
  "ASSIGN CARRIER",
]);

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} aliases
 */
function pick(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const hit = keys.find((k) => k.trim().toUpperCase() === alias.toUpperCase());
    if (hit) return { key: hit, value: row[hit] };
  }
  return { key: null, value: "" };
}

/** @param {unknown} value */
function parseDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** @param {Date} a @param {Date} b */
function dayDiff(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const a0 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const b0 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((a0 - b0) / ms);
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Filter an active tracking report: drop closed statuses, highlight expected delivery lateness, and export.

Workflow:
1. Upload a Tracking Report (.xlsx / .csv).
2. Run → download filtered workbook.`,
    onBack: ctx.onBack,
    log: ctx.log,
    async onRun(files, ui) {
      await ensureXlsx();
      const buffer = await readFileBuffer(files[0]);
      const { rows } = workbookToObjects(buffer);
      const today = new Date();

      const out = rows
        .filter((row) => {
          const status = String(pick(row, ["Status", "STATUS"]).value ?? "")
            .trim()
            .toUpperCase();
          return !DROP_STATUS.has(status);
        })
        .map((row) => {
          /** @type {Record<string, unknown>} */
          const clean = {};
          for (const [k, v] of Object.entries(row)) {
            if (/^Total Cost$/i.test(k)) continue;
            const s = v == null ? "" : String(v);
            clean[k] = ["nan", "null", "none"].includes(s.trim().toLowerCase()) ? "" : v;
          }
          for (const alias of [
            "Origin Postal",
            "ORIGIN POSTAL",
            "ORIGIN ZIP",
            "Destination Postal",
            "DESTINATION POSTAL",
            "DESTINATION ZIP",
          ]) {
            const p = pick(clean, [alias]);
            if (p.key) clean[p.key] = String(p.value ?? "").replace(/\.0$/, "");
          }
          return clean;
        });

      out.sort((a, b) => {
        const da = parseDate(pick(a, ["Exp Delivery Date", "EXPECTED DELIVERY", "EXPECTED DELIVERY DATE", "DELIVERY DATE (EXPECT)"]).value);
        const db = parseDate(pick(b, ["Exp Delivery Date", "EXPECTED DELIVERY", "EXPECTED DELIVERY DATE", "DELIVERY DATE (EXPECT)"]).value);
        const lateA = da ? dayDiff(today, da) : -9999;
        const lateB = db ? dayDiff(today, db) : -9999;
        if (lateB !== lateA) return lateB - lateA;
        if (da && db) return da.getTime() - db.getTime();
        return 0;
      });

      const sheetName = `Tracking Report ${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}-${today.getFullYear()}`;
      const wb = objectsToWorkbook(out, sheetName);
      paintWorkbookTheme(wb);
      const outName = `${sheetName}.xlsx`;
      downloadWorkbook(wb, outName);
      ui.setStatus("Complete");
      ctx.log(`Tracking Report: kept ${out.length.toLocaleString()} of ${rows.length.toLocaleString()} rows → ${outName}`);
    },
  });
}
