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
  title: "TTX On Time",
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
    <section class="gb-tool gb-tool--board" data-tool="${meta.title}">
      <header class="gb-board-head">
        <span class="gb-board-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 3.5h6.5L18 8V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M13.2 3.7V8H17.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M8.2 17v-2.4M11.1 17V12M14 17v-1.4M16.6 17v-3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </span>
        <div class="gb-board-titles">
          <h2 class="gb-tool-title">${meta.title}</h2>
          <p>Builds or updates On Time reports by merging carrier delay codes with a TMS Data Dump. Early shipments count as on time.</p>
        </div>
        <div data-about-slot></div>
      </header>
      <div class="gb-board-flow">
        <article class="gb-board-card">
          <span class="gb-board-num" aria-hidden="true">1</span>
          <h3>How to</h3>
          <ul class="gb-board-notes">
            <li>New report: upload a TMS Data Dump for the previous month using Ship Date.</li>
            <li>Update a report: upload an existing On Time file, then one carrier file.</li>
            <li>Reasons merge in this order: existing report, dump, then the carrier file.</li>
          </ul>
        </article>
        <span class="gb-board-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <article class="gb-board-card">
          <span class="gb-board-num" aria-hidden="true">2</span>
          <h3>Upload</h3>
          <p>Base file is required. Carrier file is optional.</p>
          <p class="gb-board-file-name">Base file</p>
          <div class="gb-board-drop gb-board-drop--stack" data-base-well>
            <svg class="gb-board-cloud" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5-1.6A3.5 3.5 0 0 0 7 18z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 16V11M9.6 13.2 12 10.8l2.4 2.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <p data-base-label>Drag &amp; drop an Excel file here</p>
            <span class="gb-board-or">or</span>
            <p class="gb-board-or" data-base-mode>TMS Data Dump or existing On Time output</p>
            <input type="file" hidden data-base-input accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
            <div class="gb-board-file-actions">
              <button type="button" class="gb-board-browse" data-base-browse>Browse File</button>
              <button type="button" class="gb-board-clear" data-base-clear>Clear</button>
            </div>
          </div>
          <p class="gb-board-file-name">Carrier file</p>
          <div class="gb-board-drop gb-board-drop--stack" data-carrier-well>
            <svg class="gb-board-cloud" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5-1.6A3.5 3.5 0 0 0 7 18z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 16V11M9.6 13.2 12 10.8l2.4 2.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <p data-carrier-label>Drag &amp; drop an Excel file here</p>
            <span class="gb-board-or">or</span>
            <p class="gb-board-or">RLCA / FedEx delay codes</p>
            <input type="file" hidden data-carrier-input accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
            <div class="gb-board-file-actions">
              <button type="button" class="gb-board-browse" data-carrier-browse>Browse File</button>
              <button type="button" class="gb-board-clear" data-carrier-clear>Clear</button>
            </div>
          </div>
        </article>
        <span class="gb-board-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <article class="gb-board-card">
          <span class="gb-board-num" aria-hidden="true">3</span>
          <h3>Run Report</h3>
          <p>Build or update the On Time workbook from the files above.</p>
          <div class="gb-board-run-wrap">
            <button type="button" class="btn btn-primary gb-board-run" data-run disabled>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.2 2.6v10.8L13.2 8 4.2 2.6z"/></svg>
              <span data-run-label>Run Report</span>
            </button>
          </div>
        </article>
      </div>
    </section>
  `;

  const aboutSlot = parent.querySelector("[data-about-slot]");
  if (aboutSlot instanceof HTMLElement) {
    try {
      mountAboutSlide(aboutSlot, { title: meta.title, toolId: meta.id });
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
  const carrierWell = /** @type {HTMLElement | null} */ (shellBody.querySelector("[data-carrier-well]"));
  const runBtn = /** @type {HTMLButtonElement} */ (shellBody.querySelector("[data-run]"));
  const runFace = runBtn.querySelector("[data-run-label]");
  const setRunText = (text) => {
    if (runFace) runFace.textContent = text;
    else runBtn.textContent = text;
  };

  /**
   * @param {HTMLElement | null} zone
   * @param {HTMLInputElement} input
   */
  const bindDrop = (zone, input) => {
    if (!zone) return;
    zone.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("button, a, input")) return;
      input.click();
    });
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("is-over");
    });
    zone.addEventListener("dragleave", (event) => {
      if (event.relatedTarget instanceof Node && zone.contains(event.relatedTarget)) return;
      zone.classList.remove("is-over");
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-over");
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  bindDrop(baseWell, baseInput);
  bindDrop(carrierWell, carrierInput);

  const syncRun = () => {
    runBtn.disabled = !base;
  };

  shellBody.querySelector("[data-base-browse]")?.addEventListener("click", () => baseInput.click());
  shellBody.querySelector("[data-carrier-browse]")?.addEventListener("click", () => carrierInput.click());

  shellBody.querySelector("[data-base-clear]")?.addEventListener("click", () => {
    base = null;
    baseInput.value = "";
    baseLabel.textContent = "Drag & drop an Excel file here";
    baseMode.textContent = "TMS Data Dump or existing On Time output";
    baseWell.classList.remove("is-ready");
    syncRun();
    ctx.log("Base file cleared.");
  });

  shellBody.querySelector("[data-carrier-clear]")?.addEventListener("click", () => {
    carrier = null;
    carrierInput.value = "";
    carrierLabel.textContent = "Drag & drop an Excel file here";
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
      baseLabel.textContent = "Drag & drop an Excel file here";
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
      carrierLabel.textContent = "Drag & drop an Excel file here";
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
    setRunText("Running");
    ctx.log("TTX On Time — Process Started");
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
      setRunText("Run Report");
      syncRun();
    }
  });

  ctx.log("Tool ready.");
}
