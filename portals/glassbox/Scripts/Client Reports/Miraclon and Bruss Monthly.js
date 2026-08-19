import { mountDumpFilterReport } from "../_shared/client-reports.js";
import { prevMonthNameYear } from "../_shared/mailto.js";
import { workbookToObjects, formatPyDateTime } from "../_shared/excel.js";
import { rowsToSheetWorkbook, applyClientReportStyle, XL } from "../_shared/report-format.js";
import { pickVal, prevMonthRange, normKey } from "../_shared/report-helpers.js";

export const meta = {
  id: "Miraclon and Bruss Monthly",
  title: "Miraclon and Bruss Monthly",
  category: "Client Reports",
  script: "Client Reports/Miraclon and Bruss Monthly.js",
};

const BASE_COLS = [
  "Actual Carrier", "Pro #", "Status", "Pick Up Date", "Delivery Date",
  "Shipper Name", "Shipper City", "Shipper State", "Shipper Zip",
  "Consignee Name", "Consignee City", "Consignee State", "Consignee Zip",
  "Service Level", "Actual Class", "Rated Class",
  "Handling", "Pieces", "Weight", "Description",
  "Base Charge", "Discount", "Net Freight", "FSC",
  "Accessorials", "Total Invoice",
];

/** Strip leading apostrophes and whitespace; blank stays blank. */
function textClean(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return formatPyDateTime(v);
  return String(v).replace(/^'+/, "").trim();
}

/** Parse a numeric-looking string (commas stripped); "" if not parseable. */
function toNumericOrBlank(v) {
  if (v == null || v === "") return "";
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? "" : n;
}

/** Handles discount formats like (1,234.00) or 1234 — always forced negative. */
function forceNegative(v) {
  if (v == null || v === "") return "";
  const raw = String(v).trim();
  if (!raw) return "";
  const paren = /^\(\s*([\d$,]*\.?\d+)\s*\)$/.exec(raw);
  if (paren) {
    const f = Number(paren[1].replace(/[$,]/g, ""));
    return Number.isNaN(f) ? "" : -Math.abs(f);
  }
  const f = Number(raw.replace(/[$,]/g, ""));
  if (!Number.isNaN(f)) return -Math.abs(f);
  return raw.startsWith("-") ? raw : `-${raw}`;
}

/** Normalize an Accessorial description column name for the "two-left" match rule. */
function normAccTwoLeft(name) {
  let s = String(name || "").replace(/\s+/g, "");
  s = s.replace(/\.\d+$/, "").replace(/_\d+$/, "");
  return s.toUpperCase();
}

/** Legacy two-left rule for Accessorial matching (mirrors _analyze_accessorials). */
function analyzeAccessorials(headers, limit = 10) {
  let maxI = 0;
  /** @type {Record<number, { sellCol: string | null, accCol: string | null }>} */
  const info = {};
  for (let i = 1; i <= limit; i++) {
    const sellName = `SELL ACCESSORIAL${i}`;
    const si = headers.findIndex((h) => normKey(h) === normKey(sellName));
    let sellCol = null;
    let accCol = null;
    if (si !== -1) {
      sellCol = headers[si];
      maxI = Math.max(maxI, i);
      const li = si - 2;
      if (li >= 0 && li < headers.length) {
        const left = headers[li];
        if (normAccTwoLeft(left) === `ACCESSORIAL${i}`.toUpperCase()) accCol = left;
      }
    }
    info[i] = { sellCol, accCol };
  }
  return { maxI, info };
}

/** @param {Record<string, unknown>} row */
function buildRow(row, info, maxI) {
  /** @type {Record<string, unknown>} */
  const rec = {
    "Actual Carrier": pickVal(row, ["CARRIER NAME1"]) ?? "",
    "Pro #": textClean(pickVal(row, ["LOAD NO"])),
    Status: pickVal(row, ["STATUS"]) ?? "",
    "Pick Up Date": textClean(pickVal(row, ["ACTUAL SHIP DATE"])),
    "Delivery Date": textClean(pickVal(row, ["ACTUAL DELIVERY DATE"])),
    "Shipper Name": pickVal(row, ["ORIGIN NAME"]) ?? "",
    "Shipper City": pickVal(row, ["ORIGIN CITY"]) ?? "",
    "Shipper State": pickVal(row, ["ORIGIN STATE"]) ?? "",
    "Shipper Zip": textClean(pickVal(row, ["ORIGIN POSTAL"])),
    "Consignee Name": pickVal(row, ["DESTINATION NAME"]) ?? "",
    "Consignee City": pickVal(row, ["DESTINATION CITY"]) ?? "",
    "Consignee State": pickVal(row, ["DESTINATION STATE"]) ?? "",
    "Consignee Zip": textClean(pickVal(row, ["DESTINATION POSTAL"])),
    "Service Level": "REGULAR",
    "Actual Class": textClean(pickVal(row, ["CLASS1"])),
    "Rated Class": "",
    Handling: toNumericOrBlank(pickVal(row, ["TOTAL HDLG UNITS"])),
    Pieces: toNumericOrBlank(pickVal(row, ["TOTAL PIECES"])),
    Weight: toNumericOrBlank(pickVal(row, ["TOTAL WEIGHT"])),
    Description: pickVal(row, ["PRODUCT1"]) ?? "",
    "Base Charge": toNumericOrBlank(pickVal(row, ["SELL GROSS FREIGHT1"])),
    Discount: forceNegative(pickVal(row, ["SELL DISCOUNT1"])),
    "Net Freight": "",
    FSC: toNumericOrBlank(pickVal(row, ["SELL FUEL1"])),
    Accessorials: "",
    "Total Invoice": "",
  };

  for (let i = 1; i <= maxI; i++) {
    const { sellCol, accCol } = info[i];
    rec[`Accessorial Description ${i}`] = accCol ? textClean(row[accCol]) : "";
    rec[`Accessorial Charge ${i}`] = sellCol ? toNumericOrBlank(row[sellCol]) : "";
  }
  return rec;
}

/**
 * Inject Net Freight / Accessorials / Total Invoice formulas (legacy Excel formulas),
 * mirroring style_and_inject_formulas from Miraclon and Bruss Monthly.py.
 */
function injectFormulas(workbook, sheetName, headers) {
  const XLSX = globalThis.XLSX;
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) return;
  const range = XLSX.utils.decode_range(sheet["!ref"]);

  const baseIdx = headers.indexOf("Base Charge");
  const discIdx = headers.indexOf("Discount");
  const netIdx = headers.indexOf("Net Freight");
  const fscIdx = headers.indexOf("FSC");
  const accIdx = headers.indexOf("Accessorials");
  const totalIdx = headers.indexOf("Total Invoice");
  const chargeIdxs = headers
    .map((h, i) => (/^Accessorial Charge \d+$/.test(h) ? i : -1))
    .filter((i) => i >= 0);

  const cellNum = (r, c) => Number(sheet[XLSX.utils.encode_cell({ r, c })]?.v) || 0;
  const setFormula = (r, c, formula, value) => {
    sheet[XLSX.utils.encode_cell({ r, c })] = { t: "n", v: value, f: formula };
  };

  for (let R = 1; R <= range.e.r; R++) {
    const excelRow = R + 1;

    if (netIdx >= 0 && baseIdx >= 0 && discIdx >= 0) {
      const netVal = cellNum(R, baseIdx) + cellNum(R, discIdx);
      setFormula(R, netIdx, `${XLSX.utils.encode_col(baseIdx)}${excelRow}+${XLSX.utils.encode_col(discIdx)}${excelRow}`, netVal);
    }

    let accVal = 0;
    if (accIdx >= 0 && chargeIdxs.length) {
      const refs = chargeIdxs.map((ci) => `${XLSX.utils.encode_col(ci)}${excelRow}`);
      accVal = chargeIdxs.reduce((sum, ci) => sum + cellNum(R, ci), 0);
      setFormula(R, accIdx, `SUM(${refs.join(",")})`, accVal);
    }

    if (totalIdx >= 0 && netIdx >= 0 && fscIdx >= 0 && accIdx >= 0) {
      const netVal = cellNum(R, netIdx);
      const fscVal = cellNum(R, fscIdx);
      const accValNow = cellNum(R, accIdx);
      setFormula(
        R,
        totalIdx,
        `${XLSX.utils.encode_col(netIdx)}${excelRow}+${XLSX.utils.encode_col(fscIdx)}${excelRow}+${XLSX.utils.encode_col(accIdx)}${excelRow}`,
        netVal + fscVal + accValNow
      );
    }
  }
}

export async function loadGui(parent, ctx) {
  mountDumpFilterReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Processes monthly data dumps for Miraclon or Bruss North America and builds a
separate formatted report for each client. The tool detects which client the data
belongs to and applies the correct formatting, columns, and styling.

Workflow:
1. Run a Data Dump for Miraclon or Bruss North America for the previous month - 1st through the last day of the month (Ship Date).
2. You will run two data dumps - one for Miraclon and one for Bruss North America.
3. Miraclon: DO NOT include the "Cromer…" location.
4. Bruss NA: Run client Bruss North America only.
5. One file at a time — customer wants separate reports.
6. Use the Email button to automatically populate your email client with recipient details. Attach the generated report before sending.`,
    sheetName: "LTL",
    async buildWorkbook(buffer) {
      const { rows, headers } = workbookToObjects(buffer);
      const { maxI, info } = analyzeAccessorials(headers);

      const built = rows.map((row) => buildRow(row, info, maxI));
      const filtered = built.filter((r) => String(r.Status ?? "").toUpperCase() !== "PICKUP REQUESTED");

      const dynCols = [];
      for (let i = 1; i <= maxI; i++) dynCols.push(`Accessorial Description ${i}`, `Accessorial Charge ${i}`);
      const allHeaders = [...BASE_COLS, ...dynCols];

      const wb = rowsToSheetWorkbook(filtered, "LTL", allHeaders);
      injectFormulas(wb, "LTL", allHeaders);

      const chargeHeaders = dynCols.filter((c) => c.startsWith("Accessorial Charge"));
      applyClientReportStyle(wb, {
        freeze: "A2",
        zebraGrey: XL.ZEBRA_DUMP,
        currencyCols: ["Base Charge", "Discount", "Net Freight", "FSC", "Accessorials", "Total Invoice", ...chargeHeaders],
        textCols: ["Pro #", "Shipper Zip", "Consignee Zip"],
        autosizeMax: 60,
      });

      const sampleRows = rows.slice(0, 100);
      const clientCols = headers.filter((h) => String(h).toLowerCase().includes("client"));
      let isBruss = false;
      // Python uses only the first matching client column.
      if (clientCols[0]) {
        const blob = sampleRows.map((r) => String(r[clientCols[0]] ?? "")).join(" ").toLowerCase();
        if (blob.includes("bruss")) isBruss = true;
      }
      const clientTitle = isBruss ? "Bruss NA Monthly Report" : "Miraclon Monthly Report";
      const { label } = prevMonthRange();
      const name = `${clientTitle} ${label}.xlsx`;

      return { workbook: wb, name, rowCount: filtered.length };
    },
    emailDraft: () => {
      const { monthName, monthYear } = prevMonthNameYear();
      return {
        to: "tmalarkey@expensereduction.com",
        cc: "James.Kosior@shipdalko.com; Lee.Bowdish@shipdalko.com; alexis.johnson@shipdalko.com",
        subject: `Miraclon & Bruss NA ${monthName} ${monthYear}`,
        body: "Attached are the Miraclon and Bruss reports for last month!\n\nPlease let us know if you have any questions.",
      };
    },
  });
}
