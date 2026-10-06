import { mountFileTool } from "../_shared/file-ui.js?v=20261006-phinia";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  downloadWorkbook,
  downloadBlob,
} from "../_shared/excel.js";
import { sendToRack } from "../../../../shared/js/ftp-rack.js?v=20261002-ftpback";
import { confirmDialog } from "../../../../shared/js/dialog.js?v=20261006-nobrand";
import {
  OUTPUT_COLUMNS,
  buildPhiniaRows,
  toPandasCsv,
  formatShipDate,
  parseShipDate,
  getNextBusinessDay,
  phiniaStamp,
  destinationNotesRowHeight,
} from "./phinia-shipment-logic.js?v=20261006-phinia";

export const meta = {
  id: "Phinia Shipment Upload",
  title: "Phinia Shipment Upload",
  category: "Client Uploads",
  script: "Client Uploads/Phinia Shipment Upload.js",
};

const officeSite = true;

const INSTRUCTIONS = `Concept:
Transform Phinia shipment data files into standardized output format for further processing.

Workflow:
1. Select the Phinia input Excel file.
2. Select a Ship Date option (required):
   - Today: Uses the current date as the ship date
   - Next Business Day: Calculates the next business day, skipping weekends and select US federal holidays as listed below.
   - Custom Date: Pick any date using the calendar or type M/D/YYYY manually.
3. Option A: Click 'Run & Save' to process the file and choose XLSX or CSV. Useful for looking at the data before uploading.
4. Option B: Click 'Send to TMS' to process the file and automatically upload it to TMS via FTP.
5. The tool will transform all rows according to mapping rules and apply the selected ship date.
6. All progress is reported in the launcher console.
7. Once in TMS the loads will begin creation every 15 minutes. TMS checks at every quarter hour for a file drop.

US Federal Holidays (skipped for Next Business Day):
• New Year's Day (January 1)
• Memorial Day (last Monday in May)
• Independence Day (July 4)
• Thanksgiving Day (4th Thursday in November)
• Day After Thanksgiving (Friday after Thanksgiving)
• Christmas Eve (December 24)
• Christmas Day (December 25)`;

const PUBLIC_INSTRUCTIONS = `Concept:
Transform Phinia shipment data files into standardized output format for further processing.

Workflow:
1. Select the Phinia input Excel file.
2. Select a Ship Date option (required): Today, Next Business Day, or Custom Date (M/D/YYYY).
3. Click 'Run & Save' to process the file and choose XLSX or CSV.
Send to TMS is available on the office site. This public site cannot reach the FTP rack.`;

/**
 * @param {HTMLElement} extra
 * @returns {{ date: string } | { error: string }}
 */
function readShipDate(extra) {
  const selected = /** @type {HTMLInputElement | null} */ (
    extra.querySelector('input[name="phinia-ship"]:checked')
  );
  if (!selected) return { error: "Please select a Ship Date option" };
  if (selected.value === "today") return { date: formatShipDate(new Date()) };
  if (selected.value === "next_business") return { date: formatShipDate(getNextBusinessDay(new Date())) };
  const raw = /** @type {HTMLInputElement} */ (extra.querySelector("[data-custom-date]")).value;
  const parsed = parseShipDate(raw);
  if (!parsed) return { error: "Enter a valid custom ship date (M/D/YYYY)" };
  return { date: formatShipDate(parsed) };
}

/** @returns {Promise<"xlsx" | "csv" | null>} */
function chooseFileFormat() {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "app-dialog";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.innerHTML = `
      <div class="app-dialog-backdrop" data-format-dismiss></div>
      <div class="app-dialog-card">
        <h2 class="app-dialog-title">Choose File Format</h2>
        <p class="app-dialog-message">Choose file format:</p>
        <div class="app-dialog-actions">
          <button type="button" class="btn btn-primary" data-format="xlsx">XLSX</button>
          <button type="button" class="btn btn-secondary" data-format="csv">CSV</button>
        </div>
      </div>
    `;

    /** @param {"xlsx" | "csv" | null} value */
    const finish = (value) => {
      document.removeEventListener("keydown", onKey);
      root.remove();
      resolve(value);
    };

    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    };

    root.querySelector("[data-format-dismiss]")?.addEventListener("click", () => finish(null));
    root.querySelector('[data-format="xlsx"]')?.addEventListener("click", () => finish("xlsx"));
    root.querySelector('[data-format="csv"]')?.addEventListener("click", () => finish("csv"));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(root);
    /** @type {HTMLButtonElement | null} */ (root.querySelector('[data-format="xlsx"]'))?.focus();
  });
}

/**
 * @param {HTMLElement} extra
 */
function mountShipDate(extra) {
  extra.innerHTML = `
    <div class="phinia-ship">
      <p class="phinia-ship-label">Ship Date</p>
      <div class="phinia-ship-options" role="radiogroup" aria-label="Ship Date">
        <label class="phinia-ship-option"><input type="radio" name="phinia-ship" value="today" /> Today</label>
        <label class="phinia-ship-option"><input type="radio" name="phinia-ship" value="next_business" /> Next Business Day</label>
        <label class="phinia-ship-option"><input type="radio" name="phinia-ship" value="custom" /> Custom Date</label>
      </div>
      <div class="phinia-ship-custom" data-custom-row hidden>
        <input type="text" data-custom-date placeholder="M/D/YYYY" autocomplete="off" spellcheck="false" />
        <button type="button" class="btn btn-secondary" data-cal>Calendar</button>
      </div>
      <input type="date" class="phinia-ship-picker" data-cal-input tabindex="-1" aria-hidden="true" />
    </div>
  `;

  const customRow = /** @type {HTMLElement} */ (extra.querySelector("[data-custom-row]"));
  const customDate = /** @type {HTMLInputElement} */ (extra.querySelector("[data-custom-date]"));
  const calInput = /** @type {HTMLInputElement} */ (extra.querySelector("[data-cal-input]"));

  extra.querySelectorAll('input[name="phinia-ship"]').forEach((input) => {
    input.addEventListener("change", () => {
      const custom = /** @type {HTMLInputElement} */ (input).value === "custom" && /** @type {HTMLInputElement} */ (input).checked;
      customRow.hidden = !custom;
      if (custom && !customDate.value.trim()) customDate.value = formatShipDate(new Date());
    });
  });

  extra.querySelector("[data-cal]")?.addEventListener("click", () => {
    const current = parseShipDate(customDate.value) || new Date();
    const month = String(current.getMonth() + 1).padStart(2, "0");
    const day = String(current.getDate()).padStart(2, "0");
    calInput.value = `${current.getFullYear()}-${month}-${day}`;
    if (typeof calInput.showPicker === "function") calInput.showPicker();
    else calInput.click();
  });

  calInput.addEventListener("change", () => {
    if (!calInput.value) return;
    const [year, month, day] = calInput.value.split("-").map(Number);
    customDate.value = formatShipDate(new Date(year, month - 1, day));
  });
}

/**
 * @param {Record<string, unknown>[]} rows
 */
function rowsToPhiniaWorkbook(rows) {
  const XLSX = globalThis.XLSX;
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, { header: OUTPUT_COLUMNS });
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  let notesCol = -1;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const header = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    if (header && String(header.v).trim() === "Destination Notes") notesCol = c;
  }
  if (notesCol >= 0) {
    /** @type {{ wch?: number }[]} */
    const cols = sheet["!cols"] || [];
    cols[notesCol] = { wch: 7.14 };
    sheet["!cols"] = cols;
    /** @type {{ hpt?: number }[]} */
    const heights = sheet["!rows"] || [];
    for (let r = 1; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: notesCol });
      if (!sheet[addr]) sheet[addr] = { t: "s", v: "" };
      const cell = sheet[addr];
      cell.s = cell.s || {};
      cell.s.alignment = { wrapText: true, vertical: "top" };
      heights[r] = { hpt: destinationNotesRowHeight(cell.v) };
    }
    sheet["!rows"] = heights;
  }
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return workbook;
}

/**
 * @param {File} file
 * @param {string} shipDate
 */
async function mapFile(file, shipDate) {
  await ensureXlsx();
  const { headers, rows } = workbookToObjects(await readFileBuffer(file));
  return buildPhiniaRows(rows, headers, shipDate);
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: officeSite ? INSTRUCTIONS : PUBLIC_INSTRUCTIONS,
    onBack: ctx.onBack,
    log: ctx.log,
    accept: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    runLabel: "Run & Save",
    sendLabel: officeSite ? "Send to TMS" : "",
    buildExtra: mountShipDate,
    async onRun(files, ui) {
      const ship = readShipDate(ui.extra);
      if ("error" in ship) throw new Error(ship.error);
      const format = await chooseFileFormat();
      if (!format) {
        ui.setStatus("Ready");
        ctx.log("File format selection cancelled.");
        return;
      }
      const mapped = await mapFile(files[0], ship.date);
      const outName = `Phinia_${phiniaStamp()}.${format}`;
      if (format === "csv") {
        downloadBlob(new Blob([toPandasCsv(mapped)], { type: "text/csv;charset=utf-8" }), outName);
      } else {
        downloadWorkbook(rowsToPhiniaWorkbook(mapped), outName);
      }
      ui.setStatus(`File saved: ${outName}`);
      ctx.log(`Phinia upload mapped ${mapped.length.toLocaleString()} rows → ${outName}`);
    },
    async onSend(files, ui) {
      const ship = readShipDate(ui.extra);
      if ("error" in ship) throw new Error(ship.error);
      const ok = await confirmDialog(
        "Are you sure you want to upload this file into TMS?\n\nThis is live and this process cannot be undone!",
        { title: "Confirm Upload", okLabel: "Upload", cancelLabel: "Cancel" }
      );
      if (!ok) {
        ui.setStatus("Send cancelled.");
        ctx.log("Upload cancelled by user.");
        return;
      }
      const mapped = await mapFile(files[0], ship.date);
      const outName = `Phinia_${phiniaStamp()}.csv`;
      const message = await sendToRack("phinia", outName, toPandasCsv(mapped));
      ui.setStatus("File processed and uploaded successfully");
      ctx.log(`Sent ${mapped.length.toLocaleString()} rows to TMS as ${outName}. ${message}`);
    },
  });
}
