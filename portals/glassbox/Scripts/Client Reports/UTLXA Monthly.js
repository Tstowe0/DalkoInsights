import { mountDumpFilterReport } from "../_shared/client-reports.js";
import { prevMonthNameYear } from "../_shared/mailto.js";
import { workbookToObjects } from "../_shared/excel.js";
import { rowsToSheetWorkbook, applyClientReportStyle, XL } from "../_shared/report-format.js";
import { pickVal, normKey } from "../_shared/report-helpers.js";

export const meta = {
  id: "UTLXA Monthly",
  title: "UTLXA Monthly Report",
  category: "Client Reports",
  script: "Client Reports/UTLXA Monthly.js",
};

// Exact BASELINE_COLS from UTLXA Monthly.py (order matters).
const BASELINE_COLS = [
  "CLIENT NAME", "LOAD NO", "EQUIPMENT", "STATUS",
  "ORIGIN NAME", "ORIGIN POSTAL", "ORIGIN STATE", "ORIGIN CITY",
  "DESTINATION NAME", "DESTINATION POSTAL", "DESTINATION STATE", "DESTINATION CITY",
  "Total Miles", "ACTUAL SHIP DATE", "ACTUAL DELIVERY DATE",
  "PRODUCT1", "PO NO.1", "Hdlg Units1", "Pcs1", "Type1", "Weight1", "Class1",
  "NMFC1", "Length1", "Width1", "Height1", "Stack.Units1", "PCF1", "LFT1", "G / L Code1",
  "PRODUCT2", "PO NO.2", "Hdlg Units2", "Pcs2", "Type2", "Weight2", "Class2",
  "NMFC2", "Length2", "Width2", "Height2", "Stack.Units2", "PCF2", "LFT2", "G / L Code2",
  "TOTAL HDLG UNITS", "TOTAL PIECES", "Total Wt.", "CARRIER NAME1",
];

export async function loadGui(parent, ctx) {
  mountDumpFilterReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Processes UTLXA monthly data dumps to create formatted reports with baseline
and dynamic accessorial columns, renamed fields, and standardized styling.

Workflow:
1. Run a TMS Data Dump for client UTLXA-UNION TANK CAR for the previous month (Invoice Date). Run on the 1st of the month or near that.
2. Upload the dump file and run the tool.
3. Use the Email button to automatically populate your email client with recipient details. Attach the generated report before sending.`,
    // Python does not filter client/date in-tool — dump is assumed pre-scoped.
    dateMode: "none",
    sheetName: "Data",
    async buildWorkbook(buffer, bctx) {
      const { rows, headers } = workbookToObjects(buffer);

      // Baseline columns present in the dump (exact names — mirrors Python `c in df.columns`).
      const outputCols = BASELINE_COLS.filter((c) => headers.includes(c));

      // Dynamic Accessorial/Sell pairs (up to 10): column two-left of SELL ACCESSORIALi.
      for (let i = 1; i <= 10; i++) {
        const sellName = `SELL ACCESSORIAL${i}`;
        const sellIdx = headers.findIndex((h) => normKey(h) === normKey(sellName));
        if (sellIdx === -1) continue;
        const accIdx = sellIdx - 2;
        if (accIdx < 0) continue;
        outputCols.push(headers[accIdx], headers[sellIdx]);
      }

      // Rename TOTAL RECEIVABLE AMOUNT -> FREIGHT SPEND (appended at the end).
      const hasFreight = headers.some((h) => normKey(h) === normKey("TOTAL RECEIVABLE AMOUNT"));

      const finalHeaders = [...outputCols];
      if (hasFreight) finalHeaders.push("FREIGHT SPEND");

      const rowsOut = rows.map((row) => {
        /** @type {Record<string, unknown>} */
        const next = {};
        for (const col of outputCols) next[col] = pickVal(row, [col]);
        if (hasFreight) next["FREIGHT SPEND"] = pickVal(row, ["TOTAL RECEIVABLE AMOUNT"]);
        return next;
      });

      const wb = rowsToSheetWorkbook(rowsOut, "Data", finalHeaders);
      applyClientReportStyle(wb, {
        hasTitleRow: true,
        title: `UTLXA Monthly Report – ${bctx.monthLabel}`,
        freeze: "A2",
        zebraGrey: XL.ZEBRA_DUMP,
      });

      return {
        workbook: wb,
        name: `UTLXA - ${bctx.monthLabel}.xlsx`,
        rowCount: rowsOut.length,
      };
    },
    emailDraft: () => {
      const { monthName, monthYear } = prevMonthNameYear();
      return {
        to: "david.crane@utlx.com",
        cc: "alexis.johnson@shipdalko.com",
        subject: `UTLXA Monthly Report ${monthName} ${monthYear}`,
        body: `Attached is the UTLXA Report for the month of ${monthName} ${monthYear}.\n\nPlease let us know if you have any questions.`,
      };
    },
  });
}
