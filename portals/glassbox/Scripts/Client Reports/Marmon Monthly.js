import { mountFileTool } from "../_shared/file-ui.js?v=20261116-dathigh";
import { ensureXlsx, readFileBuffer, readCellA1, downloadBlob } from "../_shared/excel.js";
import { prevMonthNameYear } from "../_shared/mailto.js";
import { prevMonthRange } from "../_shared/report-helpers.js";
import { closeProgress, updateProgress } from "../../../../shared/js/dialog.js?v=20261007-progress";
import { MARMON_TABS, applyDumpMiles, applyLtlDumpFreight, applyMissingFuelShare, applyMissingLoadFuel, applyOtherEquipmentLoads, applyOtherEquipmentRates, applyTranscoEdmontonLoads, applyTranscoEdmontonRates, applyUtlxDatFreight, buildMarmonPackage, fillDatRates, fillMissingMiles, ferroRowsToXml, readFerroRows, readUtlxLoads, removeUnusedTruckRows, unusedTruckSheetRows, utlxRateRows } from "./marmon-freight.js?v=20261116-dathigh";
import { ltlMarkupCatalog, markupLabel } from "./marmon-ltl-markups.js?v=20261113-datfallback";

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
  /** @type {Set<number>} */
  let unusedTrucks = new Set();
  if (needsDump || needsUtlx || needsFuel) {
    await onProgress?.({
      step: "read",
      title: "Building Marmon report",
      detail: "Removing Truck Ordered Not Used lines before the report reads the dump.",
    });
    await ensureXlsx();
    const XLSX = globalThis.XLSX;
    const dumpWb = XLSX.read(buffer, { type: "array", cellDates: true });
    dumpSheet = dumpWb.Sheets[dumpWb.SheetNames[0]];
    if (!dumpSheet) throw new Error("The data dump has no worksheet.");
    const removed = removeUnusedTruckRows(dumpSheet, XLSX);
    unusedTrucks = unusedTruckSheetRows(dumpSheet, XLSX);
    await onProgress?.({
      step: "read",
      title: "Building Marmon report",
      detail: removed
        ? `Removed ${removed.toLocaleString()} Truck Ordered Not Used line${removed === 1 ? "" : "s"} before reading the dump.`
        : needsDump
          ? "Reading the TMS data dump and placing each shipment on the Full Data Dump layout."
          : "Reading the TMS data dump for the UTLX site section.",
    });
    if (needsUtlx || needsFuel || needsDump) utlxLoads = readUtlxLoads(dumpSheet, XLSX);
    if (utlxLoads) utlxLoads = utlxLoads.filter((load) => !unusedTrucks.has(load.sheetRow));
    if (utlxLoads) await fillMissingMiles(utlxLoads, onProgress);
  }
  /** @type {unknown[][] | undefined} */
  let rows;
  if (needsDump && dumpSheet) rows = readFerroRows(dumpSheet, globalThis.XLSX, { omitUnusedTrucks: true });
  else if ((needsUtlx || needsFuel) && includeDat && utlxLoads) rows = utlxRateRows(utlxLoads);
  if (rows && unusedTrucks.size) rows = rows.filter((row) => !unusedTrucks.has(row.sheetRow));
  if (rows) applyMissingFuelShare(rows);
  if (utlxLoads) applyMissingLoadFuel(utlxLoads);
  if (rows && includeDat) {
    await fillDatRates(rows, onProgress);
  } else if ((needsDump || needsUtlx || needsFuel) && !includeDat) {
    await onProgress?.({
      step: "rates",
      title: "Building Marmon report",
      detail: "Include DAT Rates is off. Dat Freight and Dat Fuel stay blank. LTL market linehaul still uses each carrier's markup.",
      done: 1,
      total: 1,
    });
  }
  if (rows) applyOtherEquipmentRates(rows);
  if (utlxLoads) applyOtherEquipmentLoads(utlxLoads);
  if (rows) applyTranscoEdmontonRates(rows);
  if (utlxLoads) applyTranscoEdmontonLoads(utlxLoads);
  if (needsDump && rows && utlxLoads) applyDumpMiles(rows, utlxLoads);
  if (needsDump && rows) applyLtlDumpFreight(rows);
  if (rows && includeDat && utlxLoads) applyUtlxDatFreight(utlxLoads, rows);
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
        ? "Writing the selected tabs. Truckload is priced in Dat Freight and Dat Fuel. LTL is priced in LTL Market Freight and LTL Market Fuel."
        : "Writing the selected tabs. Truckload Dat Freight stays blank. LTL is priced in LTL Market Freight and LTL Market Fuel.",
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
      <p class="marmon-markups-note">Freight and fuel each pass our amount through and add that carrier's percent. The fuel match is the carrier plus LTL equipment. An LTL carrier with no fuel percent uses the general 41.5%. Ground expedite and cargo van use these same percents, and the equipment name stays as written. Hotshot and Dedicated - Hotshot at 14,999 lb or less use these same percents. At 15,000 lb or more they go to DAT as a flatbed. Truckload still uses DAT.</p>
      <div class="marmon-markups-scroll">
        <table class="marmon-markups-table">
          <thead>
            <tr><th>Carrier</th><th>Equipment</th><th>Freight</th><th>Fuel</th></tr>
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

/**
 * Reference table from the LTL markup workbook. Shown under Email.
 * Green rows are the larger-volume carriers called out on that sheet.
 * @type {Array<{ carrier: string, shipments: string, tariff: string, increase: string, gri: string, griDate: string, markup: string, fuel: string, highlight?: boolean, general?: boolean }>}
 */
const LTL_REFERENCE_ROWS = [
  { carrier: "R&L CARRIERS", shipments: "783", tariff: "2/5/2025", increase: "0%", gri: "9.80% 4.9% on 8/4/25 & 4.9% 10/5/26", griDate: "", markup: "9.80%", fuel: "44.70%", highlight: true },
  { carrier: "FEDEX FREIGHT - PRIORITY", shipments: "532", tariff: "10/1/2026", increase: "4.00%", gri: "5.90%", griDate: "1/5/2026", markup: "1.90%", fuel: "46.60%", highlight: true },
  { carrier: "MANITOULIN TRANSPORT", shipments: "137", tariff: "3/28/2026", increase: "3.00%", gri: "4.90%", griDate: "3/1/2026", markup: "1.90%", fuel: "Pass Thru", highlight: true },
  { carrier: "AVERITT EXPRESS", shipments: "102", tariff: "3/1/2026", increase: "Straight Pass Thru", gri: "5.90%", griDate: "3/1/2026", markup: "0%", fuel: "Pass Thru", highlight: true },
  { carrier: "DAYTON FREIGHT LINES", shipments: "78", tariff: "5/15/2026", increase: "3.50%", gri: "5.80%", griDate: "1/2/2026", markup: "2.30%", fuel: "41.40%", highlight: true },
  { carrier: "XPO LOGISTICS FREIGHT INC", shipments: "74", tariff: "8/1/2026", increase: "Straight Pass Thru", gri: "6.90%", griDate: "Unknown", markup: "4%", fuel: "", highlight: true },
  { carrier: "SAIA LTL FREIGHT", shipments: "63", tariff: "4/1/2026", increase: "Straight Pass Thru", gri: "7.90%", griDate: "7/6/2026", markup: "0%", fuel: "Pass Thru" },
  { carrier: "CENTRAL TRANSPORT INTERNATIONAL", shipments: "46", tariff: "9/7/2026", increase: "3.50%", gri: "5.90%", griDate: "", markup: "2.40%", fuel: "40.00%", highlight: true },
  { carrier: "SOUTHWESTERN MOTOR TRANSPORT INC", shipments: "39", tariff: "3/6/2026", increase: "2.50%", gri: "5.80%", griDate: "", markup: "3.30%", fuel: "29.70%", highlight: true },
  { carrier: "OLD DOMINION FREIGHT LINE, INC", shipments: "36", tariff: "4/16/2025", increase: "4.90%", gri: "4.90%", griDate: "10/5/2026", markup: "0%", fuel: "Pass Thru" },
  { carrier: "FEDEX FREIGHT - ECONOMY", shipments: "24", tariff: "10/1/2026", increase: "4%", gri: "5.90%", griDate: "1/5/2026", markup: "1.90%", fuel: "46.60%" },
  { carrier: "ABF FREIGHT SYSTEM INC", shipments: "18", tariff: "", increase: "Straight Pass Thru", gri: "5.90%", griDate: "6/22/2026", markup: "0%", fuel: "NA" },
  { carrier: "AAA COOPER TRANSPORTATION", shipments: "16", tariff: "", increase: "3.18%", gri: "5.90%", griDate: "1/0/1900", markup: "2.72%", fuel: "41.50%" },
  { carrier: "PITT OHIO EXPRESS", shipments: "14", tariff: "", increase: "3.18%", gri: "5.90%", griDate: "", markup: "2.72%", fuel: "41.50%" },
  { carrier: "MAGNUM LTL INC", shipments: "7", tariff: "", increase: "3.18%", gri: "5.90%", griDate: "", markup: "2.72%", fuel: "41.50%" },
  { carrier: "POLARIS TRANSPORT CARRIERS INC", shipments: "7", tariff: "", increase: "3.18%", gri: "5.90%", griDate: "", markup: "2.72%", fuel: "41.50%" },
  { carrier: "WARD TRUCKING", shipments: "7", tariff: "", increase: "3.18%", gri: "5.90%", griDate: "", markup: "2.72%", fuel: "41.50%" },
  { carrier: "TFORCE FREIGHT", shipments: "6", tariff: "", increase: "3.18%", gri: "5.90%", griDate: "1/5/2026", markup: "2.72%", fuel: "41.50%" },
  { carrier: "DOHRN TRANSFER COMPANY", shipments: "4", tariff: "", increase: "3.18%", gri: "5.90%", griDate: "", markup: "2.72%", fuel: "41.50%" },
  { carrier: "ESTES EXPRESS LINE", shipments: "3", tariff: "", increase: "3.18%", gri: "4.90%", griDate: "", markup: "1.72%", fuel: "41.50%" },
  { carrier: "FEDEX FREIGHT - VOLUME", shipments: "1", tariff: "", increase: "Straight Pass Thru", gri: "5.90%", griDate: "", markup: "0.00%", fuel: "Pass Thru" },
  { carrier: "GENERAL", shipments: "", tariff: "", increase: "3.18%", gri: "5.90%", griDate: "", markup: "", fuel: "Pass Thru", general: true },
];

/**
 * @param {HTMLElement} parent
 */
function mountLtlReference(parent) {
  const email = parent.querySelector(".gb-board-email");
  if (!email || parent.querySelector(".marmon-gri")) return;
  const section = document.createElement("section");
  section.className = "marmon-gri";
  section.setAttribute("aria-label", "LTL carrier reference");
  const body = LTL_REFERENCE_ROWS.map((row) => {
    const cls = row.general ? "is-general" : row.highlight ? "is-highlight" : "";
    const cells = [row.carrier, row.shipments, row.tariff, row.increase, row.gri, row.griDate, row.markup, row.fuel];
    return `<tr class="${cls}">${cells.map((value, index) => `<td${index === 4 && row.carrier === "R&L CARRIERS" ? ' class="is-note"' : ""}>${escapeHtml(value)}</td>`).join("")}</tr>`;
  }).join("");
  section.innerHTML = `
    <div class="marmon-gri-scroll">
      <table>
        <thead>
          <tr>
            <th>Carrier</th>
            <th>Shipments</th>
            <th>Current Tariff Effective Date</th>
            <th>DALKO Increase %</th>
            <th>Carrier GRI %</th>
            <th>Carrier GRI % Effective Date</th>
            <th>LTL Markup</th>
            <th>Fuel Surcharge % Diff</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="marmon-gri-notes">*For carriers who didn't handle many bills, we averaged the numbers for the larger volume carriers (re: AAA Cooper on down), which had JT's approval.</p>
    <p class="marmon-gri-notes">**Per JT, remove the Dynamic Pricing carriers from the mix. Don't include their freight bills or revenue in the report.</p>
  `;
  email.insertAdjacentElement("afterend", section);
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
          <tr class="${row.general ? "is-general" : ""}">
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.equipment || "")}</td>
            <td>${escapeHtml(markupLabel(row.percent, row.dynamic))}</td>
            <td>${escapeHtml(markupLabel(row.fuelPercent, row.dynamic))}</td>
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
Builds the Marmon Master Freight Analysis workbook from a TMS data dump. The workbook includes both TL sheets, both LTL sheets, and Full Data Dump. Full Data Dump uses the Ferroworks columns, teal header, and alternating white and grey rows. Column A is Record #, the sheet row, so a sort can be undone. A truckload line is priced in Dat Freight and Dat Fuel. An LTL line is priced in LTL Market Freight and LTL Market Fuel, columns BW and BX.

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
  mountLtlReference(parent);
}