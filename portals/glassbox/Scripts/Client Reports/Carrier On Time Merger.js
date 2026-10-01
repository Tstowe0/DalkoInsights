/**
 * Carrier On Time Merger — web port matching Python Glass Box v6.2.0 exactly.
 */

import { mountAboutSlide } from "../_shared/about-slide.js";
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
  parent.innerHTML = `
    <section class="gb-tool gb-tool--stage" data-tool="${meta.title}">
      <div class="gb-stage">
        <section class="gb-stage-guide" aria-label="How to use this tool">
          <header class="gb-stage-bar">
            <h2 class="gb-tool-title">${meta.title}</h2>
            <div class="gb-tool-header-actions">
              <div data-about-slot></div>
            </div>
          </header>
          <p class="gb-stage-lead">Builds or updates On Time reports by merging carrier delay codes with a TMS Data Dump. Early shipments count as on time.</p>
          <p class="gb-stage-kicker">How to use</p>
          <ol class="gb-stage-steps">
            <li><span class="gb-stage-num" aria-hidden="true">1</span><p>New report: upload a TMS Data Dump for the previous month using Ship Date.</p></li>
            <li><span class="gb-stage-num" aria-hidden="true">2</span><p>Update a report: upload an existing On Time file, then one carrier file.</p></li>
            <li><span class="gb-stage-num" aria-hidden="true">3</span><p>Reasons merge in this order: existing report, dump, then the carrier file.</p></li>
          </ol>
        </section>
        <div class="gb-stage-work">
          <div class="gb-stage-split">
            <div class="gb-stage-well" data-base-well>
              <p class="gb-stage-kicker">Base file</p>
              <p class="gb-stage-file" data-base-label>No file selected</p>
              <p class="gb-stage-hint" data-base-mode>TMS Data Dump or existing On Time output</p>
              <div class="gb-stage-file-actions">
                <input type="file" hidden data-base-input accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
                <button type="button" class="btn btn-secondary" data-base-browse>Browse</button>
                <button type="button" class="btn btn-ghost" data-base-clear>Clear</button>
                <button type="button" class="btn btn-primary" data-run disabled>Run</button>
              </div>
            </div>
            <div class="gb-stage-well">
              <p class="gb-stage-kicker">Carrier file</p>
              <p class="gb-stage-file" data-carrier-label>No carrier file selected</p>
              <p class="gb-stage-hint">Optional — RLCA / FedEx delay codes</p>
              <div class="gb-stage-file-actions">
                <input type="file" hidden data-carrier-input accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
                <button type="button" class="btn btn-secondary" data-carrier-browse>Browse</button>
                <button type="button" class="btn btn-ghost" data-carrier-clear>Clear</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  const aboutSlot = parent.querySelector("[data-about-slot]");
  if (aboutSlot instanceof HTMLElement) {
    try {
      mountAboutSlide(aboutSlot, { title: meta.title });
    } catch (err) {
      ctx.log(`About control failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const shellBody = parent;

  /** @type {{ headers: string[], rows: Record<string, unknown>[], mode: "dump" | "append", name: string } | null} */
  let base = null;
  /** @type {{ headers: string[], rows: Record<string, unknown>[], name: string } | null} */
  let carrier = null;

  const baseInput = /** @type {HTMLInputElement} */ (shellBody.querySelector("[data-base-input]"));
  const carrierInput = /** @type {HTMLInputElement} */ (shellBody.querySelector("[data-carrier-input]"));
  const baseLabel = /** @type {HTMLElement} */ (shellBody.querySelector("[data-base-label]"));
  const baseMode = /** @type {HTMLElement} */ (shellBody.querySelector("[data-base-mode]"));
  const baseWell = /** @type {HTMLElement} */ (shellBody.querySelector("[data-base-well]"));
  const carrierLabel = /** @type {HTMLElement} */ (shellBody.querySelector("[data-carrier-label]"));
  const carrierWell = carrierLabel.closest(".gb-stage-well");
  const runBtn = /** @type {HTMLButtonElement} */ (shellBody.querySelector("[data-run]"));

  const syncRun = () => {
    runBtn.disabled = !base;
  };

  shellBody.querySelector("[data-base-browse]")?.addEventListener("click", () => baseInput.click());
  shellBody.querySelector("[data-carrier-browse]")?.addEventListener("click", () => carrierInput.click());

  shellBody.querySelector("[data-base-clear]")?.addEventListener("click", () => {
    base = null;
    baseInput.value = "";
    baseLabel.textContent = "No file selected";
    baseMode.textContent = "TMS Data Dump or existing On Time output";
    baseWell.classList.remove("is-ready");
    syncRun();
    ctx.log("Base file cleared.");
  });

  shellBody.querySelector("[data-carrier-clear]")?.addEventListener("click", () => {
    carrier = null;
    carrierInput.value = "";
    carrierLabel.textContent = "No carrier file selected";
    carrierWell?.classList.remove("is-ready");
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
      baseLabel.textContent = file.name;
      baseMode.textContent = append
        ? "Append — existing On Time output"
        : "Dump — TMS Data Dump";
      baseWell.classList.add("is-ready");
      ctx.log(
        append
          ? `Loaded existing On Time output: ${file.name} (${rows.length.toLocaleString()} rows)`
          : `Loaded TMS Data Dump: ${file.name} (${rows.length.toLocaleString()} rows)`
      );
      syncRun();
    } catch (err) {
      base = null;
      baseLabel.textContent = "No file selected";
      baseMode.textContent = "TMS Data Dump or existing On Time output";
      baseWell.classList.remove("is-ready");
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
      carrierWell?.classList.add("is-ready");
      ctx.log(`Loaded carrier file: ${file.name} (sheet: ${sheetName}, ${rows.length.toLocaleString()} rows)`);
    } catch (err) {
      carrier = null;
      carrierLabel.textContent = "No carrier file selected";
      carrierWell?.classList.remove("is-ready");
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
    } catch (err) {
      ctx.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      runBtn.textContent = "Run";
      syncRun();
    }
  });

  ctx.log("Tool ready.");
}
