import { mountDumpFilterReport } from "../_shared/client-reports.js";
import { prevMonthNameYear } from "../_shared/mailto.js";
import { workbookToObjects } from "../_shared/excel.js";
import { multiSheetWorkbook, applyClientReportStyle, XL } from "../_shared/report-format.js";
import { normKey } from "../_shared/report-helpers.js";

export const meta = {
  id: "Maddox Monthly",
  title: "Maddox Monthly Report",
  category: "Client Reports",
  script: "Client Reports/Maddox Monthly.js",
};

/** Baseline DATA columns (kept if present). Order matches MADDOX JULY/JUNE REPORT examples. */
const BASELINE_COLS = [
  "CLIENT NAME",
  "LOAD NO",
  "DIVISION",
  "EQUIPMENT",
  "STATUS",
  "ORIGIN NAME",
  "ORIGIN POSTAL",
  "ORIGIN STATE",
  "ORIGIN CITY",
  "DESTINATION NAME",
  "DESTINATION POSTAL",
  "DESTINATION STATE",
  "DESTINATION CITY",
  "Total Miles",
  "PRIORITY",
  "Addt'l Ref No.",
  "Client PO No",
  "Commercial Inv No.",
  "Container No.",
  "Entry Date",
  "Entry No",
  "Load No.",
  "Master BOL",
  "Material No.",
  "MT No",
  "Quoted Amt",
  "Sales Order No",
  "Sales Order No.",
  "Trans. G/L Code",
  "PAYMENT TERM",
  "COST RATE",
  "PO No.",
  "ACTUAL SHIP DATE",
  "EXPECTED SHIP DATE",
  "EXPECTED DELIVERY",
  "ACTUAL DELIVERY DATE",
];

const PRODUCT_FIELDS = [
  "PRODUCT",
  "PO NO.",
  "Hdlg Units",
  "Pcs",
  "Type",
  "Weight",
  "Class",
  "NMFC",
  "Length",
  "Width",
  "Height",
  "Stack.Units",
  "PCF",
  "LFT",
  "G / L Code",
];

const AFTER_PRODUCT_COLS = ["TOTAL HDLG UNITS", "TOTAL PIECES", "Total Wt.", "CARRIER NAME1"];

/**
 * Exact dump header only. Do not fuzzy-match — "Load No." must not collapse into "LOAD NO".
 * @param {string[]} headers
 * @param {string} name
 */
function findHeader(headers, name) {
  return headers.includes(name) ? name : null;
}

/** @param {unknown} v */
function toNumber(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  const n = Number(String(v).replace(/[$,]/g, "").trim());
  return Number.isNaN(n) ? 0 : n;
}

/** @param {unknown} v */
function sortKey(v) {
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Sell-side accessorial pairs: description is two columns left of SELL ACCESSORIALi.
 * Output names stay ACCESSORIALi / SELL ACCESSORIALi (not pandas .1 suffixes).
 * @param {string[]} headers
 * @returns {{ out: string, src: string }[]}
 */
function sellAccessorialMaps(headers) {
  /** @type {{ out: string, src: string }[]} */
  const maps = [];
  for (let i = 1; i <= 10; i++) {
    const sellName = `SELL ACCESSORIAL${i}`;
    const sellIdx = headers.findIndex((h) => normKey(h) === normKey(sellName));
    if (sellIdx === -1) continue;
    const accIdx = sellIdx - 2;
    if (accIdx < 0) continue;
    maps.push({ out: `ACCESSORIAL${i}`, src: headers[accIdx] });
    maps.push({ out: sellName, src: headers[sellIdx] });
  }
  return maps;
}

/**
 * @param {string[]} headers
 * @returns {{ out: string, src: string }[]}
 */
function dataColumnMaps(headers) {
  /** @type {{ out: string, src: string }[]} */
  const maps = [];
  for (const col of BASELINE_COLS) {
    const src = findHeader(headers, col);
    if (src) maps.push({ out: col, src });
  }
  for (let n = 1; n <= 6; n++) {
    const productSrc = findHeader(headers, `PRODUCT${n}`);
    if (!productSrc) continue;
    for (const field of PRODUCT_FIELDS) {
      const name = `${field}${n}`;
      const src = findHeader(headers, name);
      if (src) maps.push({ out: name, src });
    }
  }
  for (const col of AFTER_PRODUCT_COLS) {
    const src = findHeader(headers, col);
    if (src) maps.push({ out: col, src });
  }
  maps.push(...sellAccessorialMaps(headers));
  const freightSrc = findHeader(headers, "TOTAL RECEIVABLE AMOUNT");
  if (freightSrc) maps.push({ out: "FREIGHT SPEND", src: freightSrc });
  return maps;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {(row: Record<string, unknown>) => string} keyFn
 * @param {string} keyHeader
 */
function summarize(rows, keyFn, keyHeader) {
  /** @type {Map<string, { count: number, spend: number }>} */
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const spend = toNumber(row["FREIGHT SPEND"]);
    const prev = map.get(key) || { count: 0, spend: 0 };
    prev.count += 1;
    prev.spend += spend;
    map.set(key, prev);
  }
  const body = [...map.entries()]
    .map(([key, v]) => ({
      [keyHeader]: key,
      "SHIPMENT COUNT": v.count,
      "FREIGHT SPEND": v.spend,
    }))
    .sort((a, b) => toNumber(b["FREIGHT SPEND"]) - toNumber(a["FREIGHT SPEND"]));
  const totalCount = body.reduce((s, r) => s + toNumber(r["SHIPMENT COUNT"]), 0);
  const totalSpend = body.reduce((s, r) => s + toNumber(r["FREIGHT SPEND"]), 0);
  body.push({
    [keyHeader]: "Grand Total",
    "SHIPMENT COUNT": totalCount,
    "FREIGHT SPEND": totalSpend,
  });
  return body;
}

/**
 * Build the five-tab Maddox workbook from a TMS dump buffer.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @param {string} monthLabel
 */
export function buildMaddoxWorkbook(buffer, monthLabel) {
  const { rows, headers } = workbookToObjects(buffer);
  const maps = dataColumnMaps(headers);

  const dataRows = rows.map((row) => {
    /** @type {Record<string, unknown>} */
    const next = {};
    for (const { out, src } of maps) {
      let val = row[src];
      if (val == null) val = "";
      if (out === "FREIGHT SPEND") val = toNumber(val);
      next[out] = val;
    }
    return next;
  });

  dataRows.sort((a, b) => {
    const originA = sortKey(a["ORIGIN CITY"]);
    const originB = sortKey(b["ORIGIN CITY"]);
    if (originA < originB) return -1;
    if (originA > originB) return 1;
    const destA = sortKey(a["DESTINATION CITY"]);
    const destB = sortKey(b["DESTINATION CITY"]);
    if (destA < destB) return -1;
    if (destA > destB) return 1;
    return 0;
  });

  const dataHeaders = maps.map((m) => m.out);
  const allShipments = summarize(dataRows, (r) => String(r["EQUIPMENT"] ?? ""), "EQUIPMENT TYPE");
  const fedexRows = dataRows.filter((r) =>
    String(r["CARRIER NAME1"] ?? "")
      .toUpperCase()
      .includes("FEDEX")
  );
  const fedex = summarize(fedexRows, (r) => String(r["CARRIER NAME1"] ?? ""), "CARRIER");
  const flatbedRows = dataRows.filter((r) =>
    String(r["EQUIPMENT"] ?? "")
      .toUpperCase()
      .includes("FLATBED")
  );
  const flatbed = summarize(flatbedRows, (r) => String(r["EQUIPMENT"] ?? ""), "EQUIPMENT TYPE");
  const intlRows = dataRows.filter(
    (r) =>
      String(r["DIVISION"] ?? "")
        .trim()
        .toUpperCase() === "INTERNATIONAL"
  );
  const international = summarize(intlRows, (r) => String(r["EQUIPMENT"] ?? ""), "EQUIPMENT TYPE");

  const wb = multiSheetWorkbook([
    { name: "ALL SHIPMENTS", rows: allShipments, headers: ["EQUIPMENT TYPE", "SHIPMENT COUNT", "FREIGHT SPEND"] },
    { name: "FEDEX", rows: fedex, headers: ["CARRIER", "SHIPMENT COUNT", "FREIGHT SPEND"] },
    { name: "FLATBED", rows: flatbed, headers: ["EQUIPMENT TYPE", "SHIPMENT COUNT", "FREIGHT SPEND"] },
    { name: "INTERNATIONAL", rows: international, headers: ["EQUIPMENT TYPE", "SHIPMENT COUNT", "FREIGHT SPEND"] },
    { name: "DATA", rows: dataRows, headers: dataHeaders },
  ]);

  const currencyCols = ["FREIGHT SPEND", ...dataHeaders.filter((h) => /^SELL ACCESSORIAL\d+$/i.test(h))];
  applyClientReportStyle(wb, {
    hasTitleRow: false,
    freeze: "A2",
    zebraGrey: XL.ZEBRA_DUMP,
    currencyCols,
  });

  return {
    workbook: wb,
    name: `Maddox - ${monthLabel}.xlsx`,
    rowCount: dataRows.length,
    dataHeaders,
    dataRows,
    allShipments,
    fedex,
    flatbed,
    international,
  };
}

export async function loadGui(parent, ctx) {
  mountDumpFilterReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Processes Maddox monthly data dumps into a five-tab client report:
ALL SHIPMENTS, FEDEX, FLATBED, INTERNATIONAL, and DATA.

Workflow:
1. Run a TMS Data Dump for client Maddox for the previous month (Invoice Date). Run on the 2nd Tuesday of the month.
2. Upload the dump file and run the tool.
3. Use the Email button to automatically populate your email client with recipient details. Attach the generated report before sending.`,
    dateMode: "none",
    sheetName: "DATA",
    filename: ({ monthLabel }) => `Maddox - ${monthLabel}.xlsx`,
    async buildWorkbook(buffer, bctx) {
      const built = buildMaddoxWorkbook(buffer, bctx.monthLabel);
      return {
        workbook: built.workbook,
        name: built.name,
        rowCount: built.rowCount,
      };
    },
    emailDraft: () => {
      const { monthName, monthYear } = prevMonthNameYear();
      return {
        cc: "Alexis.Johnson@shipdalko.com",
        subject: `Maddox Monthly Report ${monthName} ${monthYear}`,
        body: `Attached is the Maddox Monthly Report for the month of ${monthName} ${monthYear}.\n\nPlease let us know if you have any questions.`,
      };
    },
  });
}
