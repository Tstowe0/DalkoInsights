/**
 * Carrier On Time Merger — web port matching Python Glass Box v6.2.0 exactly.
 */

import { mountToolShell } from "../_shared/tool-shell.js";
import {
  ensureXlsx,
  readFileBuffer,
  downloadWorkbook,
  stampName,
  pandasHeaders,
} from "../_shared/excel.js";
import {
  buildOnTimeTableFromDump,
  normalizeExistingOnTimeOutput,
  collectReasonMap,
  mergeReasonsIntoOnTime,
  isAppendMode,
  styleOnTimeExcel,
  resolveOnTimeColumns,
} from "./_carrier-on-time-logic.js";

export const meta = {
  id: "Carrier On Time Merger",
  title: "Carrier On Time Merger",
  category: "Client Reports",
  script: "Client Reports/Carrier On Time Merger.js",
};

const INSTRUCTIONS = `
Concept:
Builds or updates On Time reports by merging carrier-provided delay/service codes
with TMS Data Dump data. Uses transit-based on-time logic (ACTUAL TRANSIT DAYS vs
EXPECTED TRANSIT DAYS) and treats EARLY shipments as ON-TIME for percentage calculations.
Supports two modes: creating new reports from data dumps or updating existing reports
with carrier-provided delay codes.

Workflow:
1. NEW REPORT (Dump Mode)
   - Upload a TMS Data Dump for the previous month using the Ship Date. (Using Invoice date will not match carrier reports)
   - Tool generates a new 'On Time' dataset with Early/Late results.

2. UPDATE EXISTING REPORT (Append Mode)
   - Upload an existing On Time report (with Carrier Reason column).
   - Upload one carrier file (RLCA, FedEx, etc.).
   - Tool merges new reasons into the existing report.

Carrier Merge Hierarchy:
1. Existing reasons from prior report
2. Dump-derived reasons (if present)
3. Carrier file reasons (most recent)
`.trim();

/**
 * Read first usable sheet to rows + header order.
 * Uses raw values (numbers/Dates) to match pandas read_excel.
 * @param {ArrayBuffer} buffer
 * @param {{ skipSummary?: boolean }} [opts]
 */
function readSheetObjects(buffer, opts = {}) {
  const XLSX = globalThis.XLSX;
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  let names = workbook.SheetNames;
  if (opts.skipSummary) {
    names = names.filter((s) => String(s).trim().toLowerCase() !== "summary");
  }
  if (!names.length) throw new Error("No usable sheets found.");
  const sheet = workbook.Sheets[names[0]];
  const aoa = /** @type {unknown[][]} */ (
    XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true })
  );
  if (!aoa.length) return { headers: /** @type {string[]} */ ([]), rows: /** @type {Record<string, unknown>[]} */ ([]) };

  const headers = pandasHeaders(aoa[0] || []);
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const line = aoa[i] || [];
    /** @type {Record<string, unknown>} */
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = line[idx] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows, sheetName: names[0] };
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  const shell = mountToolShell(parent, {
    title: meta.title,
    category: meta.category,
    instructions: INSTRUCTIONS,
    onBack: ctx.onBack,
    log: ctx.log,
  });

  shell.setStatus("Ready");
  shell.body.innerHTML = `
    <div class="gb-ws">
      <section class="gb-ws-step">
        <header class="gb-ws-step-head">
          <span class="gb-ws-step-num" aria-hidden="true">1</span>
          <div class="gb-ws-step-titles">
            <h4 class="gb-ws-step-title">Base file</h4>
            <p class="gb-ws-step-hint">TMS Data Dump or existing On Time output</p>
          </div>
        </header>
        <div class="gb-ws-step-body">
          <div class="gb-ws-file">
            <p class="gb-ws-file-name" data-base-label>No file selected</p>
            <div class="gb-ws-file-actions">
              <input type="file" hidden data-base-input accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
              <button type="button" class="btn btn-secondary" data-base-browse>Browse</button>
              <button type="button" class="btn btn-ghost" data-base-clear>Clear</button>
            </div>
          </div>
          <p class="gb-cot-mode" data-base-mode></p>
        </div>
      </section>

      <section class="gb-ws-step">
        <header class="gb-ws-step-head">
          <span class="gb-ws-step-num" aria-hidden="true">2</span>
          <div class="gb-ws-step-titles">
            <h4 class="gb-ws-step-title">Carrier file</h4>
            <p class="gb-ws-step-hint">Optional — RLCA / FedEx delay codes</p>
          </div>
        </header>
        <div class="gb-ws-step-body">
          <div class="gb-ws-file">
            <p class="gb-ws-file-name" data-carrier-label>No carrier file selected</p>
            <div class="gb-ws-file-actions">
              <input type="file" hidden data-carrier-input accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
              <button type="button" class="btn btn-secondary" data-carrier-browse>Browse</button>
              <button type="button" class="btn btn-ghost" data-carrier-clear>Clear</button>
            </div>
          </div>
        </div>
      </section>

      <footer class="gb-ws-actions">
        <button type="button" class="btn btn-primary" data-run disabled>Run</button>
      </footer>
    </div>
  `;

  /** @type {{ headers: string[], rows: Record<string, unknown>[], mode: "dump" | "append", name: string } | null} */
  let base = null;
  /** @type {{ headers: string[], rows: Record<string, unknown>[], name: string } | null} */
  let carrier = null;

  const baseInput = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-base-input]"));
  const carrierInput = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-carrier-input]"));
  const baseLabel = /** @type {HTMLElement} */ (shell.body.querySelector("[data-base-label]"));
  const baseMode = /** @type {HTMLElement} */ (shell.body.querySelector("[data-base-mode]"));
  const carrierLabel = /** @type {HTMLElement} */ (shell.body.querySelector("[data-carrier-label]"));
  const runBtn = /** @type {HTMLButtonElement} */ (shell.body.querySelector("[data-run]"));

  const syncRun = () => {
    runBtn.disabled = !base;
  };

  shell.body.querySelector("[data-base-browse]")?.addEventListener("click", () => baseInput.click());
  shell.body.querySelector("[data-carrier-browse]")?.addEventListener("click", () => carrierInput.click());

  shell.body.querySelector("[data-base-clear]")?.addEventListener("click", () => {
    base = null;
    baseInput.value = "";
    baseLabel.textContent = "No file selected";
    baseMode.textContent = "";
    syncRun();
    ctx.log("Base file cleared.");
  });

  shell.body.querySelector("[data-carrier-clear]")?.addEventListener("click", () => {
    carrier = null;
    carrierInput.value = "";
    carrierLabel.textContent = "No carrier file selected";
    ctx.log("Carrier file cleared.");
  });

  baseInput.addEventListener("change", async () => {
    const file = baseInput.files?.[0];
    if (!file) return;
    try {
      await ensureXlsx();
      const buffer = await readFileBuffer(file);
      const { headers, rows } = readSheetObjects(buffer);
      if (!headers.length) throw new Error("Base file has no headers.");
      const append = isAppendMode(headers);
      base = {
        headers,
        rows,
        mode: append ? "append" : "dump",
        name: file.name,
      };
      baseLabel.textContent = `Loaded: ${file.name}`;
      baseMode.textContent = append
        ? "Mode: Append (existing On Time output)"
        : "Mode: Dump (TMS Data Dump)";
      ctx.log(
        append
          ? `Loaded existing On Time output: ${file.name} (${rows.length.toLocaleString()} rows)`
          : `Loaded TMS Data Dump: ${file.name} (${rows.length.toLocaleString()} rows)`
      );
      syncRun();
    } catch (err) {
      base = null;
      baseLabel.textContent = "No file selected";
      baseMode.textContent = "";
      syncRun();
      ctx.log(`Error loading base file: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  carrierInput.addEventListener("change", async () => {
    const file = carrierInput.files?.[0];
    if (!file) return;
    try {
      await ensureXlsx();
      const buffer = await readFileBuffer(file);
      const { headers, rows, sheetName } = readSheetObjects(buffer, { skipSummary: true });
      if (!headers.length) throw new Error("Carrier file has no headers.");
      carrier = { headers, rows, name: file.name };
      carrierLabel.textContent = file.name;
      ctx.log(`Loaded carrier file: ${file.name} (sheet: ${sheetName}, ${rows.length.toLocaleString()} rows)`);
    } catch (err) {
      carrier = null;
      carrierLabel.textContent = "No carrier file selected";
      ctx.log(`Failed to load carrier file: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  runBtn.addEventListener("click", async () => {
    if (!base) {
      ctx.log("No base file selected.");
      return;
    }

    runBtn.disabled = true;
    runBtn.textContent = "Processing…";
    shell.setStatus("Processing…");
    ctx.log("Carrier On Time Merger — Process Started");
    ctx.log("----------------------------------------------");

    try {
      await ensureXlsx();
      const start = performance.now();
      const total = 5;
      const status = (step, msg) => {
        const pct = Math.round((step / total) * 100);
        const bar = "█".repeat(Math.floor(pct / 10)) + "-".repeat(10 - Math.floor(pct / 10));
        const elapsed = (performance.now() - start) / 1000;
        const eta = step > 0 && step < total ? ((elapsed / step) * total - elapsed).toFixed(1) : "0.0";
        ctx.log(`[${bar}] ${String(pct).padStart(3)}% | ${msg} | ETA: ${eta}s`);
      };

      status(1, "Building On Time table...");
      /** @type {Record<string, unknown>[]} */
      let baseRows;
      /** @type {Record<string, unknown>[] | null} */
      let priorRows = null;

      if (base.mode === "dump") {
        baseRows = buildOnTimeTableFromDump(base.rows, base.headers);
        priorRows = null;
      } else {
        priorRows = base.rows;
        baseRows = normalizeExistingOnTimeOutput(base.rows, base.headers);
      }

      status(2, "Collecting carrier reasons...");
      /** @type {Record<string, string>[]} */
      const reasonMaps = [];
      if (carrier) {
        reasonMaps.push(collectReasonMap(carrier.rows, carrier.headers));
      }

      status(3, "Merging carrier reasons...");
      const finalRows = mergeReasonsIntoOnTime(baseRows, reasonMaps, priorRows);

      status(4, "Styling workbook...");
      const emptyHeaders =
        base.mode === "dump"
          ? resolveOnTimeColumns(base.headers).cols
          : base.headers;
      const wb = styleOnTimeExcel(finalRows, emptyHeaders);

      const name = `OnTime_${stampName()}.xlsx`;
      status(5, `Export complete: ${name}`);
      downloadWorkbook(wb, name);

      ctx.log("----------------------------------------------");
      ctx.log(`Process complete. ${finalRows.length.toLocaleString()} rows → ${name}`);
      shell.setStatus("Complete");
    } catch (err) {
      ctx.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      shell.setStatus("Error");
    } finally {
      runBtn.textContent = "Run";
      syncRun();
    }
  });

  ctx.log("Tool ready.");
}
