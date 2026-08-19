import { mountFileTool } from "../_shared/file-ui.js";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  objectsToWorkbook,
  downloadWorkbook,
  stampName,
} from "../_shared/excel.js";

export const meta = {
  id: "Excel Trimmer",
  title: "Excel Trimmer",
  category: "Data Tools",
  script: "Data Tools/Excel Trimmer.js",
};

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  /** @type {string[]} */
  let headers = [];
  /** @type {Record<string, unknown>[]} */
  let rows = [];

  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Keep only the columns you need from an Excel file.

Workflow:
1. Browse and select an .xlsx file (columns appear below).
2. Check the columns to keep.
3. Run → download trimmed workbook.`,
    onBack: ctx.onBack,
    log: ctx.log,
    accept: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    buildExtra(extra) {
      extra.innerHTML = `
        <div class="ui-row">
          <button type="button" class="btn btn-ghost" data-all>Select all</button>
          <button type="button" class="btn btn-ghost" data-none>Select none</button>
        </div>
        <div class="gb-col-list" data-cols><p class="gb-tool-note">Load a file to see columns.</p></div>
      `;
      extra.querySelector("[data-all]")?.addEventListener("click", () => {
        extra.querySelectorAll('input[type="checkbox"]').forEach((el) => {
          /** @type {HTMLInputElement} */ (el).checked = true;
        });
      });
      extra.querySelector("[data-none]")?.addEventListener("click", () => {
        extra.querySelectorAll('input[type="checkbox"]').forEach((el) => {
          /** @type {HTMLInputElement} */ (el).checked = false;
        });
      });
    },
    async onRun(files, ui) {
      await ensureXlsx();

      // If columns not loaded yet, parse first
      if (!rows.length) {
        const buffer = await readFileBuffer(files[0]);
        const parsed = workbookToObjects(buffer);
        headers = parsed.headers;
        rows = parsed.rows;
        renderCols(ui.extra, headers);
        ctx.log(`Loaded ${rows.length.toLocaleString()} rows, ${headers.length} columns. Select columns and Run again.`);
        ui.setStatus("Select columns, then Run");
        return;
      }

      const selected = [...ui.extra.querySelectorAll('input[type="checkbox"]:checked')].map(
        (el) => /** @type {HTMLInputElement} */ (el).value
      );
      if (!selected.length) throw new Error("Select at least one column.");

      const trimmed = rows.map((row) => {
        /** @type {Record<string, unknown>} */
        const out = {};
        for (const col of selected) out[col] = row[col] ?? "";
        return out;
      });

      const outName = `TrimmedExcel_${stampName()}.xlsx`;
      downloadWorkbook(objectsToWorkbook(trimmed, "Trimmed"), outName);
      ui.setStatus("Complete");
      ctx.log(`Saved ${outName} (${selected.length} columns, ${trimmed.length.toLocaleString()} rows)`);
    },
  });

  // After browse, parse columns automatically
  const input = parent.querySelector("[data-file-input]");
  input?.addEventListener("change", async () => {
    const file = /** @type {HTMLInputElement} */ (input).files?.[0];
    if (!file) return;
    try {
      await ensureXlsx();
      const buffer = await readFileBuffer(file);
      const parsed = workbookToObjects(buffer);
      headers = parsed.headers;
      rows = parsed.rows;
      const extra = parent.querySelector("[data-tool-extra]");
      if (extra) renderCols(/** @type {HTMLElement} */ (extra), headers);
      ctx.log(`Loaded columns from ${file.name} (${headers.length}).`);
    } catch (err) {
      ctx.log(`Could not read columns: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/**
 * @param {HTMLElement} extra
 * @param {string[]} headers
 */
function renderCols(extra, headers) {
  const box = extra.querySelector("[data-cols]");
  if (!box) return;
  box.innerHTML = headers
    .map(
      (h) =>
        `<label><input type="checkbox" value="${h.replaceAll('"', "&quot;")}" checked /> ${h
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")}</label>`
    )
    .join("");
}
