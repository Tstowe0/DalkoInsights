import { mountFileTool } from "../_shared/file-ui.js?v=20261105-tabs";
import { ensureXlsx, readFileBuffer, readCellA1, downloadBlob } from "../_shared/excel.js";
import { prevMonthNameYear } from "../_shared/mailto.js";
import { prevMonthRange } from "../_shared/report-helpers.js";
import { closeProgress, updateProgress } from "../../../../shared/js/dialog.js?v=20261007-progress";
import { applyUtlxDatFreight, buildMarmonPackage, fillDatRates, fillMissingMiles, ferroRowsToXml, readFerroRows, readUtlxLoads, utlxRateRows } from "./marmon-freight.js?v=20261105-lookup";
import { ltlMarkupCatalog, markupLabel } from "./marmon-ltl-markups.js?v=20261105-lookup";

export const meta = {
  id: "Marmon Monthly",
  title: "Marmon Monthly Report",
  category: "Client Reports",
  script: "Client Reports/Marmon Monthly.js",
};

const TEMPLATE_URL = new URL("../../data/marmon-master-freight-template.xlsx", import.meta.url);

/** @type {Promise<Uint8Array> | null} */
let templatePromise = null;

function loadTemplate() {
  if (!templatePromise) {
    templatePromise = fetch(TEMPLATE_URL).then(async (res) => {
      if (!res.ok) throw new Error("Marmon report template could not be loaded.");
      return new Uint8Array(await res.arrayBuffer());
    });
    templatePromise.catch(() => {
      templatePromise = null;
    });
  }
  return templatePromise;
}

/** The report always writes these five sheets, in workbook order. Master sheets stay out. */
const OUTPUT_TABS = [
  "TL Only Carrier Market Index",
  "TL Only Fuel Price Volatility",
  "LTL Only Carrier Market Index",
  "LTL Only Fuel Price Volatility",
  "Full Data Dump",
];

/**
 * @param {HTMLElement} extra
 */
export function includeDatRates(extra) {
  const input = /** @type {HTMLInputElement | null} */ (extra.querySelector("[data-marmon-dat]"));
  return Boolean(input?.checked);
}

/**
 * Copy the dump onto Full Data Dump when that tab is included.
 * @param {ArrayBuffer} buffer
 * @param {string[]} include
 * @param {(update: { step?: string, title?: string, detail?: string, done?: number, total?: number }) => void | Promise<void>} [onProgress]
 * @param {boolean} [includeDat]
 */
export async function buildMarmonWorkbook(buffer, include, onProgress, includeDat = true) {
  const tabs = MARMON_TABS.filter((name) => include.includes(name));
  if (!tabs.length) throw new Error("Select at least one tab to include.");

  const needsDump = tabs.includes("Full Data Dump");
  const needsUtlx = tabs.some((name) => name.endsWith("Carrier Market Index"));
  const needsFuel = tabs.some((name) => name.endsWith("Fuel Price Volatility"));
  /** @type {string | undefined} */
  let sheetXml;
  let rowCount = 0;
  /** @type {ReturnType<typeof readUtlxLoads> | undefined} */
  let utlxLoads;
  /** @type {object | undefined} */
  let dumpSheet;
  if (needsDump || needsUtlx || needsFuel) {
    await onProgress?.({
      step: "read",
      title: "Building Marmon report",
      detail: needsDump
        ? "Reading the TMS data dump and placing each shipment on the Full Data Dump layout."
        : "Reading the TMS data dump for the UTLX site section.",
    });
    await ensureXlsx();
    const XLSX = globalThis.XLSX;
    const dumpWb = XLSX.read(buffer, { type: "array", cellDates: true });
    dumpSheet = dumpWb.Sheets[dumpWb.SheetNames[0]];
    if (!dumpSheet) throw new Error("The data dump has no worksheet.");
    if (needsUtlx || needsFuel) utlxLoads = readUtlxLoads(dumpSheet, XLSX);
    if (utlxLoads) await fillMissingMiles(utlxLoads, onProgress);
  }
  /** @type {unknown[][] | undefined} */
  let rows;
  if (needsDump && dumpSheet) rows = readFerroRows(dumpSheet, globalThis.XLSX);
  else if ((needsUtlx || needsFuel) && includeDat && utlxLoads) rows = utlxRateRows(utlxLoads);
  if (rows && includeDat) {
    await fillDatRates(rows, onProgress);
    if (utlxLoads) applyUtlxDatFreight(utlxLoads, rows);
  } else if ((needsDump || needsUtlx || needsFuel) && !includeDat) {
    await onProgress?.({
      step: "rates",
      title: "Building Marmon report",
      detail: "Include DAT Rates is off. Dat Freight and Dat Fuel stay blank. LTL market linehaul still uses each carrier's markup.",
      done: 1,
      total: 1,
    });
  }
  if (needsDump && rows) {
    const dump = ferroRowsToXml(rows);
    sheetXml = dump.xml;
    rowCount = dump.rowCount;
  }

  await onProgress?.({
    step: "build",
    title: "Building Marmon report",
    detail: !needsDump
      ? includeDat && needsUtlx
        ? "Writing the selected tabs. Truckload market linehaul uses DAT. LTL market linehaul uses the carrier markup."
        : "Writing the selected tabs. Truckload market linehaul stays blank. LTL market linehaul uses the carrier markup."
      : includeDat
        ? "Writing the selected tabs into the workbook, including Dat Freight and Dat Fuel."
        : "Writing the selected tabs. Dat Freight and Dat Fuel stay blank.",
    done: 1,
    total: 1,
  });

  const bytes = await buildMarmonPackage(await loadTemplate(), { sheetXml, include: tabs, utlxLoads });
  const { label } = prevMonthRange();
  return {
    bytes,
    name: `Marmon Master Freight Analysis - ${label}.xlsx`,
    rowCount,
  };
}

/**
 * @param {unknown} value
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @type {HTMLElement | null} */
let markupPopup = null;
/** @type {HTMLElement | null} */
let markupReturnFocus = null;

function ensureMarkupPopup() {
  if (markupPopup) return markupPopup;
  markupPopup = document.createElement("div");
  markupPopup.className = "marmon-markups hidden";
  markupPopup.setAttribute("role", "dialog");
  markupPopup.setAttribute("aria-modal", "true");
  markupPopup.setAttribute("aria-labelledby", "marmon-markups-title");
  markupPopup.innerHTML = `
    <div class="marmon-markups-backdrop" data-markup-close></div>
    <div class="marmon-markups-card">
      <header class="marmon-markups-head">
        <h2 id="marmon-markups-title">LTL carrier markups</h2>
        <button type="button" class="marmon-markups-close" data-markup-close aria-label="Close">Close</button>
      </header>
      <p class="marmon-markups-note">Market linehaul is that shipment's linehaul plus the percent below. A carrier that is not listed uses the general markup. Truckload still uses DAT.</p>
      <div class="marmon-markups-scroll">
        <table class="marmon-markups-table">
          <thead>
            <tr><th>Carrier</th><th>Markup</th></tr>
          </thead>
          <tbody data-markup-rows></tbody>
        </table>
      </div>
    </div>
  `;
  markupPopup.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest("[data-markup-close]")) closeMarkupPopup();
  });
  document.addEventListener("keydown", (event) => {
    if (!markupPopup || markupPopup.classList.contains("hidden")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMarkupPopup();
    }
  });
  document.body.appendChild(markupPopup);
  return markupPopup;
}

function closeMarkupPopup() {
  markupPopup?.classList.add("hidden");
  markupReturnFocus?.focus();
  markupReturnFocus = null;
}

/**
 * @param {HTMLElement | null} opener
 */
function openMarkupPopup(opener) {
  const popup = ensureMarkupPopup();
  const body = popup.querySelector("[data-markup-rows]");
  if (body) {
    body.innerHTML = ltlMarkupCatalog()
      .map(
        (row) => `
          <tr${row.general ? ' class="is-general"' : ""}>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(markupLabel(row.percent))}</td>
          </tr>`
      )
      .join("");
  }
  markupReturnFocus = opener;
  popup.classList.remove("hidden");
  popup.querySelector(".marmon-markups-close")?.focus();
}

export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Builds the Marmon Master Freight Analysis workbook from a TMS data dump. The workbook includes both TL sheets, both LTL sheets, and Full Data Dump. Full Data Dump uses the Ferroworks columns, teal header, and alternating white and grey rows. Dat Freight and Dat Fuel are filled from the DAT rate lookup.

Workflow:
1. Run a TMS Data Dump for Marmon for the previous month (Invoice Date). Run on the 1st of the month or near that.
2. Upload the dump file and run the tool.
3. Use the Email button to open a draft for the previous month. Attach the generated report before sending.`,
    howto: {
      type: "Data Dump",
      date: "Invoice Date",
      time: "Previous Month",
      clients: "Marmon",
    },
    onBack: ctx.onBack,
    log: ctx.log,
    layout: "board",
    runLabel: "Run Report",
    board: {
      lead: "Builds the Marmon Master Freight Analysis workbook from a TMS data dump. The workbook includes both TL sheets, both LTL sheets, and Full Data Dump.",
      upload: {
        title: "Upload TMS Data Dump",
        text: "Select the TMS data dump for the previous month (Invoice Date). Run on the 1st of the month or near that.",
      },
      reports: {
        title: "How To Run",
        text: "The workbook includes both TL sheets, both LTL sheets, and the Full Data Dump.",
      },
      run: {
        title: "Run & Email",
        text: "Generate the report and open an email draft with the previous month's report attached.",
      },
      email: {
        title: "Email",
        text: "After the report is generated, open an email draft with the previous month's report attached.",
      },
    },
    buildExtra(extra) {
      extra.innerHTML = `
        <label class="gb-board-switch">
          <span>
            <strong>Include DAT Rates</strong>
            <small>Off keeps Dat Freight and Dat Fuel, and leaves them blank. LTL market linehaul still uses the carrier markup.</small>
          </span>
          <input type="checkbox" data-marmon-dat checked />
        </label>
        <div class="gb-board-switch marmon-markup-row">
          <span>
            <strong>LTL carrier markups</strong>
            <small>Market linehaul for an LTL shipment is its linehaul plus that carrier's percent.</small>
          </span>
          <button type="button" class="marmon-markup-look" data-marmon-markups aria-label="View LTL carrier markups">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10.5" cy="10.5" r="6.25" fill="none" stroke="currentColor" stroke-width="1.8"/>
              <path d="m15.2 15.2 4.3 4.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      `;
      extra.querySelector("[data-marmon-markups]")?.addEventListener("click", () => {
        openMarkupPopup(/** @type {HTMLButtonElement} */ (extra.querySelector("[data-marmon-markups]")));
      });
    },
    emailDraft: () => {
      const { monthName, monthYear } = prevMonthNameYear();
      return {
        label: "Open Email Draft",
        subject: `Marmon Monthly Report ${monthName} ${monthYear}`,
        body: `Attached is the Marmon Report for the month of ${monthName} ${monthYear}.\n\nPlease let us know if you have any questions.`,
      };
    },
    async onRun(files, ui) {
      await ensureXlsx();
      const buffer = await readFileBuffer(files[0]);
      if (readCellA1(buffer).toUpperCase() !== "CLIENT NAME") {
        const ok = window.confirm(
          "Cell A1 is not CLIENT NAME — this may not be a TMS Data Dump.\n\nClick OK to run anyway, or Cancel to abort."
        );
        if (!ok) {
          ui.setStatus("Ready");
          ctx.log(`${meta.title}: aborted (A1 check).`);
          return;
        }
        ctx.log("Warning: A1 may not be CLIENT NAME — continuing after confirm.");
      }
      try {
        const built = await buildMarmonWorkbook(
          buffer,
          OUTPUT_TABS,
          async (update) => {
            updateProgress(update);
            await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          },
          includeDatRates(ui.extra)
        );
        downloadBlob(
          new Blob([built.bytes], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
          built.name
        );
        ui.setStatus(`Saved ${built.name}`);
        ctx.log(`${meta.title}: ${built.rowCount.toLocaleString()} rows -> ${built.name}`);
      } finally {
        closeProgress();
      }
    },
  });
}