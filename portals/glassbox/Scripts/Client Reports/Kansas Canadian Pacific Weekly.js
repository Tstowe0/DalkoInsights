import { mountDumpFilterReport } from "../_shared/client-reports.js";
import { cpkcFridayThursday, fmtDotMDY } from "../_shared/mailto.js";
import { workbookToObjects } from "../_shared/excel.js";
import { rowsToSheetWorkbook, applyClientReportStyle } from "../_shared/report-format.js";
import { pickVal, fmtMDY } from "../_shared/report-helpers.js";

export const meta = {
  id: "Kansas Canadian Pacific Weekly",
  title: "Kansas Canadian Pacific Weekly",
  category: "Client Reports",
  script: "Client Reports/Kansas Canadian Pacific Weekly.js",
};

// Exact legacy column order from Kansas Canadian Pacific Weekly.py (target_columns,
// pre-rename). Field names map onto ALL CAPS TMS dump headers case-insensitively.
const TARGET_COLUMNS = [
  "Client Name", "Load No.", "Equipment",
  "Origin Name", "Origin Country", "Origin City",
  "Origin State", "Origin Postal",
  "Destination Name", "Destination Country",
  "Destination City", "Destination State", "Destination Postal",
  "Actual Ship Date", "Actual Delivery Date",
  "Product1", "Po No1", "Class1",
  "Total Hdlg Units", "Total Pieces", "Total Weight",
  "Receivable Amount", "CARRIER1",
];

export async function loadGui(parent, ctx) {
  mountDumpFilterReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Customer-specific weekly report for CPKC (Canadian Pacific Kansas City) that processes
Mini Data Dump files covering the previous Friday through Thursday. Formats the data
into a standardized expedite report with proper styling and date-based filename generation.

Workflow:
1. Run a Mini Data Dump for the previous Friday to this Thursday by Ship Date.
2. Run for: Canadian Pacific Kansas City LTD, Kansas City Southern DE ME, and Kansas City Southern Railroad.
3. Run the Mini Data Dump through the program.
4. Use the Email button to automatically populate your email client with all recipients. Attach the generated report before sending.`,
    sheetName: "CPKC Expedite",
    requireClientNameA1: false,
    async buildWorkbook(buffer) {
      const { rows } = workbookToObjects(buffer);

      const filtered = rows
        .map((row) => ({
          row,
          equipment: String(pickVal(row, ["Equipment", "EQUIPMENT"]) ?? "")
            .replace(/\s+/g, " ")
            .trim(),
        }))
        .filter((x) => x.equipment.toLowerCase().includes("expedite"));

      const out = filtered.map(({ row, equipment }) => {
        const get = (...aliases) => pickVal(row, aliases) ?? "";
        return {
          "Client Name": get("Client Name", "CLIENT NAME"),
          "Load No.": get("Load No.", "LOAD NO", "Load No"),
          Equipment: equipment,
          "Origin Name": get("Origin Name", "ORIGIN NAME"),
          "Origin Country": get("Origin Country", "ORIGIN COUNTRY"),
          "Origin City": get("Origin City", "ORIGIN CITY"),
          "Origin State": get("Origin State", "ORIGIN STATE"),
          "Origin Postal": get("Origin Postal", "ORIGIN POSTAL"),
          "Destination Name": get("Destination Name", "DESTINATION NAME"),
          "Destination Country": get("Destination Country", "DESTINATION COUNTRY"),
          "Destination City": get("Destination City", "DESTINATION CITY"),
          "Destination State": get("Destination State", "DESTINATION STATE"),
          "Destination Postal": get("Destination Postal", "DESTINATION POSTAL"),
          "Actual Ship Date": get("Actual Ship Date", "ACTUAL SHIP DATE"),
          "Actual Delivery Date": get("Actual Delivery Date", "ACTUAL DELIVERY DATE"),
          Product1: get("Product1", "PRODUCT1", "PRODUCT 1"),
          "Po No1": get("Po No1", "PO NO.1", "PO NO1", "Po No.1"),
          Class1: get("Class1", "CLASS1", "CLASS 1"),
          "Total Hdlg Units": get("Total Hdlg Units", "TOTAL HDLG UNITS"),
          "Total Pieces": get("Total Pieces", "TOTAL PIECES"),
          "Total Weight": get("Total Weight", "TOTAL WEIGHT"),
          "PRELIM CHARGES": get("Receivable Amount"),
          CARRIER: get("CARRIER1"),
          NOTES: "",
        };
      });

      const headers = [
        "Client Name", "Load No.", "Equipment",
        "Origin Name", "Origin Country", "Origin City",
        "Origin State", "Origin Postal",
        "Destination Name", "Destination Country",
        "Destination City", "Destination State", "Destination Postal",
        "Actual Ship Date", "Actual Delivery Date",
        "Product1", "Po No1", "Class1",
        "Total Hdlg Units", "Total Pieces", "Total Weight",
        "PRELIM CHARGES", "CARRIER", "NOTES",
      ];

      const wb = rowsToSheetWorkbook(out, "CPKC Expedite", headers);
      applyClientReportStyle(wb, {
        hasTitleRow: true,
        title: "CPKC Expedite Report",
      });

      // Python save-dialog default: previous_friday = today-7, most_recent_thursday = today-1.
      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - 7);
      const end = new Date(today);
      end.setDate(today.getDate() - 1);
      const name = `CPKC Expedite ${fmtMDY(start, ".")}\u2013${fmtMDY(end, ".")}.xlsx`;

      return { workbook: wb, name, rowCount: out.length };
    },
    emailDraft: () => {
      const { friday, thursday } = cpkcFridayThursday();
      return {
        to: "dlengyel@kcsouthern.com; dbird@kcsouthern.com; mjackson@kcsouthern.com; mmoya@kcsms.com.mx; barbara.mcclendon@cpkcr.com",
        cc: "Alexis.Johnson@shipdalko.com",
        subject: `CPKC Expedite Report ${fmtDotMDY(friday)} - ${fmtDotMDY(thursday)}`,
        body: "Attached is your CPKC Expedite Report.\n\nPlease let us know if you have any questions.",
      };
    },
  });
}
