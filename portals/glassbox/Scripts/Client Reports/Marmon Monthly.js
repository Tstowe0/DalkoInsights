import { mountFileTool } from "../_shared/file-ui.js?v=20261027-titlebar";
import { ensureXlsx, readFileBuffer, readCellA1, downloadBlob } from "../_shared/excel.js";
import { prevMonthNameYear } from "../_shared/mailto.js";
import { prevMonthRange } from "../_shared/report-helpers.js";
import { closeProgress, updateProgress } from "../../../../shared/js/dialog.js?v=20261007-progress";
import { MARMON_TABS, applyUtlxDatFreight, buildMarmonPackage, fillDatRates, fillMissingMiles, ferroRowsToXml, readFerroRows, readUtlxLoads, utlxRateRows } from "./marmon-freight.js?v=20261029-ltlnodat";

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

/**
 * @param {HTMLElement} extra
 * @returns {string[]}
 */
export function selectedMarmonTabs(extra) {
  return [...extra.querySelectorAll("[data-marmon-tab]:checked")].map((input) =>
    /** @type {HTMLInputElement} */ (input).value
  );
}

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
      detail: "Include DAT Rates is off. Dat Freight, Dat Fuel, and market columns stay blank.",
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
        ? "Writing the selected tabs. Market Linehaul Spend uses the DAT freight for each UTLX shipment."
        : "Writing the selected tabs. Market Linehaul Spend stays blank."
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

export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Builds the Marmon Master Freight Analysis workbook from a TMS data dump. Master, TL Only, and LTL Only each keep a Carrier Market Index sheet and a Fuel Price Volatility sheet. Full Data Dump uses the Ferroworks columns, teal header, and alternating white and grey rows. Dat Freight and Dat Fuel are filled from the DAT rate lookup.

Workflow:
1. Run a TMS Data Dump for Marmon for the previous month (Invoice Date). Run on the 1st of the month or near that.
2. Check the tabs to include, upload the dump file, and run the tool.
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
      lead: "Builds the Marmon Master Freight Analysis workbook from a TMS data dump. Includes Carrier Market Index and Fuel Price Volatility. Full Data Dump adds Dat Freight and Dat Fuel from the DAT rate lookup.",
      upload: {
        title: "Upload TMS Data Dump",
        text: "Select the TMS data dump for the previous month (Invoice Date). Run on the 1st of the month or near that.",
      },
      reports: {
        title: "How To Run",
        text: "Choose which tabs to include in the workbook.",
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
            <small>Off keeps Dat Freight and Dat Fuel, and leaves them blank.</small>
          </span>
          <input type="checkbox" data-marmon-dat checked />
        </label>
        <div class="gb-board-checks">
          ${MARMON_TABS.map((name) => {
            const on = name.startsWith("Master ") || name === "Full Data Dump";
            return `<label class="gb-board-check"><input type="checkbox" data-marmon-tab value="${name}"${on ? " checked" : ""} /><span>${name}</span></label>`;
          }).join("")}
        </div>
      `;
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
          selectedMarmonTabs(ui.extra),
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
        ctx.log(`${meta.title}: ${built.rowCount.toLocaleString()} rows → ${built.name}`);
      } finally {
        closeProgress();
      }
    },
  });
}
