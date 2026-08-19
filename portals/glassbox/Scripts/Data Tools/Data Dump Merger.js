import { mountFileTool } from "../_shared/file-ui.js";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  objectsToWorkbook,
  downloadWorkbook,
  readCellA1,
  stampName,
} from "../_shared/excel.js";

export const meta = {
  id: "Data Dump Merger",
  title: "Data Dump Merger",
  category: "Data Tools",
  script: "Data Tools/Data Dump Merger.js",
};

/** @param {unknown} col */
function normalizeKey(col) {
  return String(col ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {Map<string, string>} headerRegistry
 */
function normalizeFrame(rows, headerRegistry) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const row of rows) {
    /** @type {Record<string, unknown>} */
    const next = {};
    for (const [raw, val] of Object.entries(row)) {
      const key = normalizeKey(raw);
      if (!key) continue;
      if (!headerRegistry.has(key)) headerRegistry.set(key, String(raw).trim());
      const cur = next[key];
      const empty = cur == null || String(cur).trim() === "";
      if (!(key in next) || empty) next[key] = val;
    }
    out.push(next);
  }
  return out;
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Combine two or more TMS Data Dump Excel files into a single merged file.

Workflow:
1. Browse → select one or more TMS Data Dump .xlsx files.
2. Optionally enable "Remove duplicate LOAD NO".
3. Run → download the merged output.`,
    onBack: ctx.onBack,
    log: ctx.log,
    multiple: true,
    buildExtra(extra) {
      extra.innerHTML = `
        <label class="gb-check">
          <input type="checkbox" data-dedupe />
          Remove duplicate LOAD NO (keep first)
        </label>
      `;
    },
    async onRun(files, ui) {
      await ensureXlsx();
      const dedupe = Boolean(
        /** @type {HTMLInputElement | null} */ (ui.extra.querySelector("[data-dedupe]"))?.checked
      );

      /** @type {Record<string, unknown>[][]} */
      const frames = [];
      /** @type {Map<string, string>} */
      const headerRegistry = new Map();

      for (const file of files) {
        ctx.log(`Loading ${file.name}…`);
        const buffer = await readFileBuffer(file);
        if (readCellA1(buffer).toUpperCase() !== "CLIENT NAME") {
          ctx.log(`Warning: ${file.name} may not be a TMS Data Dump (A1 ≠ CLIENT NAME). Including anyway.`);
        }
        const wb = globalThis.XLSX.read(buffer, { type: "array" });
        const sheetName = wb.SheetNames.includes("DataDump") ? "DataDump" : undefined;
        const { rows } = workbookToObjects(buffer, sheetName);
        const normalized = normalizeFrame(rows, headerRegistry);
        frames.push(normalized);
        ctx.log(`  → ${normalized.length.toLocaleString()} rows`);
      }

      /** @type {string[]} */
      const columnOrder = [];
      const seen = new Set();
      for (const frame of frames) {
        for (const row of frame) {
          for (const key of Object.keys(row)) {
            if (!seen.has(key)) {
              seen.add(key);
              columnOrder.push(key);
            }
          }
        }
      }

      let merged = frames.flatMap((frame) =>
        frame.map((row) => {
          /** @type {Record<string, unknown>} */
          const out = {};
          for (const key of columnOrder) {
            out[headerRegistry.get(key) ?? key] = row[key] ?? "";
          }
          return out;
        })
      );

      if (dedupe && headerRegistry.has("LOAD NO")) {
        const loadCol = headerRegistry.get("LOAD NO");
        const before = merged.length;
        const seenLoads = new Set();
        merged = merged.filter((row) => {
          const v = String(row[/** @type {string} */ (loadCol)] ?? "");
          if (seenLoads.has(v)) return false;
          seenLoads.add(v);
          return true;
        });
        const removed = before - merged.length;
        if (removed) ctx.log(`Removed ${removed.toLocaleString()} duplicate LOAD NO row(s).`);
      }

      const outName = `Merged_DataDump_${stampName()}.xlsx`;
      downloadWorkbook(objectsToWorkbook(merged, "DataDump"), outName);
      ui.setStatus("Complete");
      ctx.log(`Merge complete — ${files.length} files, ${merged.length.toLocaleString()} rows → ${outName}`);
    },
  });
}
