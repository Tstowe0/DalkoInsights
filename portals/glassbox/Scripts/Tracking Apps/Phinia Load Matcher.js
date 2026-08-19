/**
 * Phinia Load Matcher — dual inputs matching Python Glass Box.
 * 1) Phinia file  2) TMS Data Dump → Phinia output with "Dalko Load No." after Quote ID
 */

import { mountToolShell } from "../_shared/tool-shell.js";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  downloadWorkbook,
  readCellA1,
  stampName,
} from "../_shared/excel.js";
import { applyClientReportStyle, rowsToSheetWorkbook, XL } from "../_shared/report-format.js";
import { pickVal, normKey } from "../_shared/report-helpers.js";

export const meta = {
  id: "Phinia Load Matcher",
  title: "Phinia Load Matcher",
  category: "Tracking Apps",
  script: "Tracking Apps/Phinia Load Matcher.js",
};

const INSTRUCTIONS = `
Concept:
Match Delivery numbers from the Phinia file with the Data Dump file
to find corresponding Load Numbers and add them to the Phinia file.

Workflow:
1. Upload the Phinia file (contains Delivery numbers).
2. Upload the Data Dump file for Phinia (contains Delivery numbers and LOAD NO).
3. Click Run to process and match the data.
4. The output will be the Phinia file with a new "Dalko Load No." column
   added after "Quote ID" containing the matched Load Numbers.
5. All progress is reported in the launcher console.
`.trim();

/** @param {unknown} v */
function normDelivery(v) {
  let s = String(v ?? "").trim();
  if (s.includes("/")) s = s.split("/")[0].trim();
  if (/^\d+\.0$/.test(s)) s = s.slice(0, -2);
  return s;
}

/**
 * @param {Record<string, unknown>[]} dumpRows
 * @param {string[]} dumpHeaders
 */
function buildDeliveryLookup(dumpRows, dumpHeaders) {
  const deliveryCols = dumpHeaders.filter((h) => {
    const n = String(h).toLowerCase();
    return n.includes("delivery") && !n.includes("expected") && !n.includes("actual");
  });
  const loadCandidates = dumpHeaders.filter((h) => {
    const n = String(h).toLowerCase();
    return n.includes("load") && n.includes("no") && !n.includes("status");
  });
  let loadCol = loadCandidates.find((h) => String(h).trim().toUpperCase() === "LOAD NO") || loadCandidates[0];
  if (!deliveryCols.length) throw new Error("Data Dump file must contain a Delivery column.");
  if (!loadCol) throw new Error("Data Dump file must contain a LOAD NO column.");

  /** @type {Map<string, string>} */
  const lookup = new Map();
  for (const row of dumpRows) {
    const load = String(row[loadCol] ?? "").trim();
    if (!load) continue;
    for (const col of deliveryCols) {
      const d = normDelivery(row[col]);
      if (d) lookup.set(d, load);
    }
  }
  return { lookup, deliveryCols, loadCol };
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

  shell.body.innerHTML = `
    <div class="gb-ws">
      <section class="gb-ws-step">
        <header class="gb-ws-step-head">
          <span class="gb-ws-step-num" aria-hidden="true">1</span>
          <div class="gb-ws-step-titles">
            <h4 class="gb-ws-step-title">Phinia file</h4>
            <p class="gb-ws-step-hint">Delivery numbers to match</p>
          </div>
        </header>
        <div class="gb-ws-step-body">
          <div class="gb-ws-file">
            <p class="gb-ws-file-name" data-phinia-label>No file selected</p>
            <div class="gb-ws-file-actions">
              <input type="file" hidden data-phinia-input accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" />
              <button type="button" class="btn btn-secondary" data-phinia-browse>Browse</button>
              <button type="button" class="btn btn-ghost" data-phinia-clear>Clear</button>
            </div>
          </div>
        </div>
      </section>

      <section class="gb-ws-step">
        <header class="gb-ws-step-head">
          <span class="gb-ws-step-num" aria-hidden="true">2</span>
          <div class="gb-ws-step-titles">
            <h4 class="gb-ws-step-title">Data Dump</h4>
            <p class="gb-ws-step-hint">TMS dump with Delivery No and LOAD NO</p>
          </div>
        </header>
        <div class="gb-ws-step-body">
          <div class="gb-ws-file">
            <p class="gb-ws-file-name" data-dump-label>No file selected</p>
            <div class="gb-ws-file-actions">
              <input type="file" hidden data-dump-input accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" />
              <button type="button" class="btn btn-secondary" data-dump-browse>Browse</button>
              <button type="button" class="btn btn-ghost" data-dump-clear>Clear</button>
            </div>
          </div>
        </div>
      </section>

      <footer class="gb-ws-actions">
        <button type="button" class="btn btn-primary" data-run disabled>Run</button>
      </footer>
    </div>
  `;

  /** @type {File | null} */
  let phiniaFile = null;
  /** @type {File | null} */
  let dumpFile = null;

  const phiniaInput = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-phinia-input]"));
  const dumpInput = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-dump-input]"));
  const phiniaLabel = /** @type {HTMLElement} */ (shell.body.querySelector("[data-phinia-label]"));
  const dumpLabel = /** @type {HTMLElement} */ (shell.body.querySelector("[data-dump-label]"));
  const runBtn = /** @type {HTMLButtonElement} */ (shell.body.querySelector("[data-run]"));

  const refreshRun = () => {
    runBtn.disabled = !(phiniaFile && dumpFile);
  };

  shell.body.querySelector("[data-phinia-browse]")?.addEventListener("click", () => phiniaInput.click());
  shell.body.querySelector("[data-dump-browse]")?.addEventListener("click", () => dumpInput.click());

  shell.body.querySelector("[data-phinia-clear]")?.addEventListener("click", () => {
    phiniaFile = null;
    phiniaInput.value = "";
    phiniaLabel.textContent = "No file selected";
    refreshRun();
    ctx.log("Phinia file selection cleared.");
  });

  shell.body.querySelector("[data-dump-clear]")?.addEventListener("click", () => {
    dumpFile = null;
    dumpInput.value = "";
    dumpLabel.textContent = "No file selected";
    refreshRun();
    ctx.log("Data Dump file selection cleared.");
  });

  phiniaInput.addEventListener("change", () => {
    phiniaFile = phiniaInput.files?.[0] || null;
    phiniaLabel.textContent = phiniaFile ? phiniaFile.name : "No file selected";
    if (phiniaFile) ctx.log(`Phinia file loaded: ${phiniaFile.name}`);
    refreshRun();
  });

  dumpInput.addEventListener("change", async () => {
    dumpFile = dumpInput.files?.[0] || null;
    dumpLabel.textContent = dumpFile ? dumpFile.name : "No file selected";
    if (dumpFile) {
      try {
        await ensureXlsx();
        const a1 = readCellA1(await readFileBuffer(dumpFile)).toUpperCase();
        if (a1 !== "CLIENT NAME") {
          ctx.log("Warning: A1 may not be CLIENT NAME — file may not be a TMS Data Dump.");
        }
      } catch {
        /* ignore preview check errors */
      }
      ctx.log(`Data Dump file loaded: ${dumpFile.name}`);
    }
    refreshRun();
  });

  runBtn.addEventListener("click", async () => {
    if (!phiniaFile || !dumpFile) return;
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    shell.setStatus("Running…");
    try {
      await ensureXlsx();
      const phinia = workbookToObjects(await readFileBuffer(phiniaFile));
      const dump = workbookToObjects(await readFileBuffer(dumpFile));

      const deliveryHeader = phinia.headers.find((h) => String(h).toLowerCase().includes("delivery"));
      if (!deliveryHeader) throw new Error("Phinia file must contain a Delivery column.");

      const { lookup, deliveryCols, loadCol } = buildDeliveryLookup(dump.rows, dump.headers);
      ctx.log(`Dump delivery cols: ${deliveryCols.join(", ")}; load col: ${loadCol}`);

      let matched = 0;
      const out = phinia.rows.map((row) => {
        const delivery = normDelivery(row[deliveryHeader] ?? pickVal(row, ["Delivery"]));
        const load = lookup.get(delivery) || "";
        if (load) matched++;

        const keys = Object.keys(row);
        const quoteIdx = keys.findIndex((k) => normKey(k) === "QUOTEID");
        if (quoteIdx >= 0) {
          /** @type {Record<string, unknown>} */
          const rebuilt = {};
          keys.forEach((k, i) => {
            rebuilt[k] = row[k];
            if (i === quoteIdx) rebuilt["Dalko Load No."] = load;
          });
          return rebuilt;
        }
        return { ...row, "Dalko Load No.": load };
      });

      const headers = out[0] ? Object.keys(out[0]) : [...phinia.headers, "Dalko Load No."];
      const wb = rowsToSheetWorkbook(out, "Phinia", headers);
      applyClientReportStyle(wb, {
        headerFill: XL.HEADER,
        zebraGrey: XL.ZEBRA_DUMP,
        zebra: true,
        autosizePad: 2,
      });

      const outName = `Phinia_With_Load_No_${stampName()}.xlsx`;
      downloadWorkbook(wb, outName);
      shell.setStatus("Complete");
      ctx.log(`Matched ${matched.toLocaleString()} / ${out.length.toLocaleString()} → ${outName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      shell.setStatus("Error");
      ctx.log(`Error: ${msg}`);
    } finally {
      runBtn.disabled = !(phiniaFile && dumpFile);
      runBtn.textContent = "Run";
    }
  });

  ctx.log("Loaded tool module: Phinia Load Matcher");
}
