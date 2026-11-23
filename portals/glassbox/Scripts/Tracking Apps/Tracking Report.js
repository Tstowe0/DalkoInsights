import { mountFileTool } from "../_shared/file-ui.js?v=20261027-titlebar";
import { ensureXlsx, readFileBuffer, readCellA1, workbookToObjects, downloadWorkbook } from "../_shared/excel.js?v=20260916-xlsxstyle";
import { applyClientReportStyle, rowsToSheetWorkbook } from "../_shared/report-format.js?v=20261123-tracking";
import { normKey } from "../_shared/report-helpers.js";
import { confirmDialog } from "../../../../shared/js/dialog.js?v=20261006-nobrand";

export const meta = {
  id: "Tracking Report",
  title: "Tracking Report",
  category: "Tracking Apps",
  script: "Tracking Apps/Tracking Report.js",
};

const FILE_CHECK_TITLE = "Tracking Report - File Check";
const FILE_CHECK_MESSAGE =
  "This report is looking for a Tracking Report. The file uploaded may be something else or may have been altered. Would you like to continue running this current file?";

const DROP_STATUS = new Set([
  "DELIVERED",
  "INVOICED",
  "PICKUP REQUESTED",
  "QUOTE MODIFIED",
  "BOOKED OPEN",
  "BOOKED",
  "SPOT QUOTED",
  "QUOTED",
  "ASSIGN CARRIER",
]);

const STATUS_ALIASES = ["Status", "STATUS"];
const EXP_ALIASES = [
  "Exp Delivery Date",
  "EXPECTED DELIVERY",
  "EXPECTED DELIVERY DATE",
  "DELIVERY DATE (EXPECT)",
];
const ZIP_ALIASES = [
  ["Origin Postal", "ORIGIN POSTAL", "ORIGIN ZIP", "ORIGIN ZIP CODE"],
  ["Destination Postal", "DESTINATION POSTAL", "DESTINATION ZIP", "DESTINATION ZIP CODE"],
];

const TODAY_FILL = "00B050";
const LATE_FILL = {
  1: "7030A0",
  2: "0070C0",
  3: "FFC000",
  4: "F79646",
};
const LATE_5_FILL = "FF0000";
const LATE_FONT = "FFFFFF";

/**
 * @param {string[]} headers
 * @param {string[]} aliases
 */
function findCol(headers, aliases) {
  for (const alias of aliases) {
    const want = normKey(alias);
    const hit = headers.find((header) => normKey(header) === want);
    if (hit) return hit;
  }
  return null;
}

/** Calendar date, without letting an ISO date slip to the previous local day. */
function calendarDate(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  if (!text || /^(nan|null|none)$/i.test(text)) return null;
  let year;
  let month;
  let day;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
    if (match) {
      month = Number(match[1]);
      day = Number(match[2]);
      year = Number(match[3]);
    } else {
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) return null;
      year = parsed.getFullYear();
      month = parsed.getMonth() + 1;
      day = parsed.getDate();
    }
  }
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function todayNy() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return new Date(Number(get("year")), Number(get("month")) - 1, Number(get("day")));
}

function stamp(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day}-${date.getFullYear()}`;
}

function dayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function blankify(value) {
  if (value == null) return "";
  if (typeof value === "string" && ["nan", "null", "none"].includes(value.trim().toLowerCase())) return "";
  return value;
}

/**
 * @param {Record<string, unknown>[]} sourceRows
 * @param {string[]} sourceHeaders
 * @param {Date} today
 */
function buildLayout(sourceRows, sourceHeaders, today) {
  let headers = sourceHeaders.slice();
  let rows = sourceRows.map((row) => ({ ...row }));

  for (const aliases of ZIP_ALIASES) {
    const col = findCol(headers, aliases);
    if (!col) continue;
    for (const row of rows) row[col] = String(row[col] ?? "").replace(/\.0$/, "");
  }

  const statusCol = findCol(headers, STATUS_ALIASES);
  if (statusCol) {
    rows = rows.filter((row) => !DROP_STATUS.has(String(row[statusCol] ?? "").trim().toUpperCase()));
  }

  const expCol = findCol(headers, EXP_ALIASES);
  const todayNum = dayNumber(today);
  const ranked = rows.map((row, index) => {
    const exp = expCol ? calendarDate(row[expCol]) : null;
    return {
      row,
      index,
      late: exp ? Math.round((todayNum - dayNumber(exp)) / 86400000) : null,
      time: exp ? exp.getTime() : null,
    };
  });
  if (expCol) {
    ranked.sort((a, b) => {
      if (a.late == null && b.late == null) return a.index - b.index;
      if (a.late == null) return 1;
      if (b.late == null) return -1;
      if (a.late !== b.late) return b.late - a.late;
      if (a.time !== b.time) return a.time - b.time;
      return a.index - b.index;
    });
  }
  rows = ranked.map((item) => item.row);

  let maxSlot = 1;
  for (const header of headers) {
    const match = /^Product(\d+)/.exec(header);
    if (match) maxSlot = Math.max(maxSlot, Number(match[1]));
  }
  for (let n = 2; n <= maxSlot; n += 1) {
    const productCol = `Product${n}`;
    const group = [`Product${n}`, `PO No.${n}`, `Hdlg Units${n}`, `Type${n}`, `Wgt${n}`, `Class${n}`];
    const drop = !headers.includes(productCol)
      || !rows.some((row) => {
        const text = String(row[productCol] ?? "").trim();
        return text !== "" && text !== "nan";
      });
    if (!drop) continue;
    const remove = new Set(group);
    headers = headers.filter((header) => !remove.has(header));
  }

  headers = headers.filter((header) => header !== "Total Cost");

  rows = rows.map((row) => {
    /** @type {Record<string, unknown>} */
    const next = {};
    for (const header of headers) next[header] = blankify(row[header]);
    return next;
  });

  /** @type {Map<number, { fill: string, color: string }>} */
  const highlights = new Map();
  if (expCol && headers.includes(expCol)) {
    rows.forEach((row, index) => {
      const exp = calendarDate(row[expCol]);
      if (!exp) return;
      const late = Math.round((todayNum - dayNumber(exp)) / 86400000);
      const excelRow = index + 2;
      if (late === 0) highlights.set(excelRow, { fill: TODAY_FILL, color: "000000" });
      else if (late > 0) {
        highlights.set(excelRow, {
          fill: LATE_FILL[late] || LATE_5_FILL,
          color: LATE_FONT,
        });
      }
    });
  }

  return {
    headers,
    rows,
    expIndex: expCol ? headers.indexOf(expCol) : -1,
    highlights,
  };
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Processes tracking data to create a formatted report with highlighted deliveries (today's date and late shipments) and filtered statuses.

Workflow:
1. Download a Tracking Report from TMS.
2. Upload the downloaded file (Excel or CSV format).
3. Click run and save the report.

Color legend:
- Green: Today's deliveries
- Purple: 1 day late
- Blue: 2 days late
- Yellow: 3 days late
- Orange: 4 days late
- Red: 5+ days late`,
    onBack: ctx.onBack,
    log: ctx.log,
    async onRun(files, ui) {
      await ensureXlsx();
      const buffer = await readFileBuffer(files[0]);
      if (readCellA1(buffer).trim().toLowerCase() !== "client") {
        ctx.log("Cell A1 is not Client — file may not be a Tracking Report.");
        const ok = await confirmDialog(FILE_CHECK_MESSAGE, {
          title: FILE_CHECK_TITLE,
          okLabel: "Run",
          cancelLabel: "Abort",
        });
        if (!ok) {
          ui.setStatus("Ready");
          ctx.log("Process cancelled — Tracking Report check not passed.");
          return;
        }
      }

      const { rows, headers } = workbookToObjects(buffer, { asText: true });
      const today = todayNy();
      const built = buildLayout(rows, headers, today);
      const base = `Tracking Report ${stamp(today)}`;
      const workbook = rowsToSheetWorkbook(built.rows, base, built.headers);
      applyClientReportStyle(workbook, {
        zebraGrey: "DDDDDD",
        zebraWhite: "FFFFFF",
        wrap: true,
        fixedColWidth: 20,
        cellHighlights: built.expIndex >= 0
          ? { col: built.expIndex, rows: built.highlights }
          : null,
      }, base);
      downloadWorkbook(workbook, `${base}.xlsx`);
      ui.setStatus("Complete");
      ctx.log(`Tracking Report: kept ${built.rows.length.toLocaleString()} of ${rows.length.toLocaleString()} rows → ${base}.xlsx`);
    },
  });
}
