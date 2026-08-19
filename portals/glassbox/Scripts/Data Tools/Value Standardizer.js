import { mountFileTool } from "../_shared/file-ui.js";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  downloadWorkbook,
  stampName,
} from "../_shared/excel.js";

export const meta = {
  id: "Value Standardizer",
  title: "Value Standardizer",
  category: "Data Tools",
  script: "Data Tools/Value Standardizer.js",
};

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  /** @type {Record<string, unknown>[]} */
  let rows = [];
  /** @type {string[]} */
  let headers = [];

  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Standardize values in a chosen column.

Workflow:
1. Upload Excel/CSV.
2. Pick a column — unique values appear.
3. Enter a master value and check variants to rename.
4. Apply mapping, then Export.`,
    onBack: ctx.onBack,
    log: ctx.log,
    buildExtra(extra) {
      extra.innerHTML = `
        <label class="gb-check ui-field-inline">
          <span>Column</span>
          <select class="ui-select ui-select--solid" data-col style="min-width:14rem"></select>
        </label>
        <label class="gb-check ui-field-inline">
          <span>Master value</span>
          <input class="ui-input" data-master style="min-width:14rem" />
        </label>
        <div class="gb-col-list" data-vals style="max-height:200px"></div>
        <div class="ui-row">
          <button type="button" class="btn btn-secondary" data-apply>Apply mapping</button>
          <button type="button" class="btn btn-primary" data-export>Export</button>
        </div>
        <p class="gb-tool-note" data-mapcount>No mappings yet.</p>
      `;
      /** @type {Record<string, Record<string, string>>} */
      const maps = {};

      extra.querySelector("[data-col]")?.addEventListener("change", () => refreshVals(extra, rows));
      extra.querySelector("[data-apply]")?.addEventListener("click", () => {
        const col = /** @type {HTMLSelectElement} */ (extra.querySelector("[data-col]")).value;
        const master = /** @type {HTMLInputElement} */ (extra.querySelector("[data-master]")).value.trim();
        if (!col || !master) {
          ctx.log("Pick a column and master value.");
          return;
        }
        maps[col] = maps[col] || {};
        let n = 0;
        extra.querySelectorAll("[data-vals] input:checked").forEach((el) => {
          const v = /** @type {HTMLInputElement} */ (el).value;
          maps[col][v] = master;
          n++;
        });
        const countEl = extra.querySelector("[data-mapcount]");
        if (countEl) countEl.textContent = `Mappings stored for ${Object.keys(maps).length} column(s). Last apply: ${n} value(s) → “${master}”.`;
        ctx.log(`Mapped ${n} values in ${col} → ${master}`);
      });
      extra.querySelector("[data-export]")?.addEventListener("click", async () => {
        if (!rows.length) return;
        await ensureXlsx();
        const outRows = rows.map((row) => {
          /** @type {Record<string, unknown>} */
          const next = { ...row };
          for (const [col, map] of Object.entries(maps)) {
            const raw = String(next[col] ?? "").trim();
            if (raw in map) next[col] = map[raw];
          }
          return next;
        });
        /** @type {Record<string, unknown>[]} */
        const logRows = [];
        for (const [col, map] of Object.entries(maps)) {
          for (const [original, master] of Object.entries(map)) {
            const count = rows.filter((r) => String(r[col] ?? "").trim() === original).length;
            logRows.push({ Column: col, "Original Value": original, "Master Value": master, "Row Count": count });
          }
        }
        const XLSX = globalThis.XLSX;
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(outRows), "Standardized Data");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(logRows), "Mapping Log");
        const name = `standardized_${stampName()}.xlsx`;
        downloadWorkbook(wb, name);
        ctx.log(`Exported ${name}`);
      });
      // stash maps on element for file load refresh
      /** @type {any} */ (extra)._maps = maps;
    },
    async onRun(files, ui) {
      await ensureXlsx();
      const parsed = workbookToObjects(await readFileBuffer(files[0]));
      rows = parsed.rows;
      headers = parsed.headers;
      const colSel = /** @type {HTMLSelectElement} */ (ui.extra.querySelector("[data-col]"));
      colSel.innerHTML = headers.map((h) => `<option value="${h.replaceAll('"', "&quot;")}">${h}</option>`).join("");
      refreshVals(ui.extra, rows);
      ui.setStatus("Map values, then Export");
      ctx.log(`Loaded ${rows.length.toLocaleString()} rows. Use Apply mapping + Export (Run reloads file).`);
    },
  });
}

/** @param {HTMLElement} extra @param {Record<string, unknown>[]} rows */
function refreshVals(extra, rows) {
  const col = /** @type {HTMLSelectElement} */ (extra.querySelector("[data-col]")).value;
  const box = extra.querySelector("[data-vals]");
  if (!box || !col) return;
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const row of rows) {
    const v = String(row[col] ?? "").trim();
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  box.innerHTML = sorted
    .slice(0, 200)
    .map(
      ([v, n]) =>
        `<label><input type="checkbox" value="${String(v).replaceAll('"', "&quot;")}" /> ${
          v === "" ? "(blank)" : v.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        } <span style="opacity:.6">(${n})</span></label>`
    )
    .join("");
}
