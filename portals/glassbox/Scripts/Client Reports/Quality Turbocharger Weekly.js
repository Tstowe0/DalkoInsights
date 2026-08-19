import { mountDumpFilterReport } from "../_shared/client-reports.js";
import { prevMondayFriday, fmtDotMDY } from "../_shared/mailto.js";
import { workbookToObjects } from "../_shared/excel.js";
import { multiSheetWorkbook, applyClientReportStyle, XL } from "../_shared/report-format.js";
import { pickVal, normKey } from "../_shared/report-helpers.js";

export const meta = {
  id: "Quality Turbocharger Weekly",
  title: "Quality Turbocharger Weekly",
  category: "Client Reports",
  script: "Client Reports/Quality Turbocharger Weekly.js",
};

const CLIENT_NAME = "QUALITY TURBO";
const MAX_ACCESSORIAL = 20;
const REPORT_TITLE = "Quality Turbocharger Inbound/Outbound Report";

// [outputColumn, sourceAliases] — exact OUTPUT_COLUMNS + RENAME_MAP from
// Quality Turbocharger Weekly.py (aliases cover both pre- and post-rename names).
const OUTPUT_COLUMN_ALIASES = [
  ["CLIENT NAME", ["CLIENT NAME"]],
  ["LOAD NO", ["LOAD NO"]],
  ["EQUIPMENT", ["EQUIPMENT"]],
  ["STATUS", ["STATUS"]],
  ["ORIGIN NAME", ["ORIGIN NAME"]],
  ["ORIGIN POSTAL", ["ORIGIN POSTAL"]],
  ["ORIGIN STATE", ["ORIGIN STATE"]],
  ["ORIGIN CITY", ["ORIGIN CITY"]],
  ["DESTINATION NAME", ["DESTINATION NAME"]],
  ["DESTINATION POSTAL", ["DESTINATION POSTAL"]],
  ["DESTINATION STATE", ["DESTINATION STATE"]],
  ["DESTINATION CITY", ["DESTINATION CITY"]],
  ["Total Miles", ["TOTAL MILES", "Total Miles"]],
  ["ACTUAL SHIP DATE", ["ACTUAL SHIP DATE"]],
  ["ACTUAL DELIVERY DATE", ["ACTUAL DELIVERY DATE"]],
  ["PRODUCT1", ["PRODUCT 1", "PRODUCT1"]],
  ["PO NO.1", ["PO NO.1"]],
  ["TOTAL HDLG UNITS", ["TOTAL HDLG UNITS"]],
  ["TOTAL PIECES", ["TOTAL PIECES"]],
  ["Class1", ["CLASS 1", "Class1"]],
  ["Total Wt.", ["Total Wt."]],
  ["CARRIER NAME1", ["CARRIER NAME1"]],
  ["PRELIM CHARGES", ["TOTAL RECEIVABLE AMOUNT", "PRELIM CHARGES"]],
  ["LOAD CREATED BY", ["LOAD CREATED BY"]],
];

/**
 * Build finalized rows for one partition (inbound/outbound), dropping any
 * ACCESSORIALn column that is entirely blank within this partition (legacy behavior).
 * @param {Record<string, unknown>[]} rows
 * @param {string[]} headers
 */
function finalizePartition(rows, headers) {
  const presentAcc = [];
  for (let i = 1; i <= MAX_ACCESSORIAL; i++) {
    const name = `ACCESSORIAL${i}`;
    if (headers.some((h) => normKey(h) === normKey(name))) presentAcc.push(name);
  }

  const built = rows.map((row) => {
    /** @type {Record<string, unknown>} */
    const rec = {};
    for (const [outCol, aliases] of OUTPUT_COLUMN_ALIASES) rec[outCol] = pickVal(row, aliases) ?? "";
    for (const acc of presentAcc) rec[acc] = pickVal(row, [acc]) ?? "";
    return rec;
  });

  const keepAcc = rows.length ? presentAcc : [];
  const outHeaders = [...OUTPUT_COLUMN_ALIASES.map(([c]) => c), ...keepAcc];
  const out = built.map((r) => {
    /** @type {Record<string, unknown>} */
    const ordered = {};
    for (const h of outHeaders) ordered[h] = r[h];
    return ordered;
  });
  return { rows: out, headers: outHeaders };
}

export async function loadGui(parent, ctx) {
  mountDumpFilterReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Customer-specific weekly report for Quality Turbocharger, run every Monday for the
previous week (Sunday through Saturday). Processes TMS Data Dump files to generate
formatted reports with proper styling and client-specific formatting.

Workflow:
1. Run a TMS Data Dump for Client: Quality Turbocharger.
2. Use Ship Dates covering the previous Sunday-Saturday.
3. Upload that report into the tool.
4. The tool will generate the final output, apply styling, and save it.
5. Use the Email button to automatically populate your email client with recipient details. Attach the generated report before sending.
6. All progress is reported in the launcher console.`,
    async buildWorkbook(buffer) {
      const { rows, headers } = workbookToObjects(buffer);

      const inboundRows = rows.filter((r) =>
        String(pickVal(r, ["DESTINATION NAME"]) ?? "")
          .toUpperCase()
          .includes(CLIENT_NAME)
      );
      const outboundRows = rows.filter(
        (r) =>
          !String(pickVal(r, ["DESTINATION NAME"]) ?? "")
            .toUpperCase()
            .includes(CLIENT_NAME)
      );

      const inbound = finalizePartition(inboundRows, headers);
      const outbound = finalizePartition(outboundRows, headers);

      const wb = multiSheetWorkbook([
        { name: "Inbound", rows: inbound.rows, headers: inbound.headers },
        { name: "Outbound", rows: outbound.rows, headers: outbound.headers },
      ]);
      applyClientReportStyle(wb, {
        hasTitleRow: true,
        title: REPORT_TITLE,
        freeze: "A3",
        zebraGrey: XL.ZEBRA_DUMP,
      });

      const { monday, friday } = prevMondayFriday();
      const name = `Quality Turbocharger ${fmtDotMDY(monday)}\u2013${fmtDotMDY(friday)}.xlsx`;

      return { workbook: wb, name, rowCount: inbound.rows.length + outbound.rows.length };
    },
    emailDraft: {
      to: "ship@qualityturbo.com;Larry@qualityturbo.com",
      cc: "alexis.johnson@shipdalko.com",
      subject: "Quality Turbo Weekly Report",
      body: "Attached is your report for last week!\n\nPlease let us know if you have any questions.",
    },
  });
}
