import { mountDumpFilterReport } from "../_shared/client-reports.js?v=20261006-sendstatus";
import { workbookToObjects, workbookBlob } from "../_shared/excel.js?v=20261005-dats";
import { rowsToSheetWorkbook, applyClientReportStyle } from "../_shared/report-format.js";
import { pickVal, pickCol, fmtMDY } from "../_shared/report-helpers.js";
import { sendToRack } from "../../../../shared/js/ftp-rack.js?v=20261005-dats";

export const meta = {
  id: "DATs Weekly Upload",
  title: "DATs Weekly Upload",
  category: "Client Uploads",
  script: "Client Uploads/DATs Weekly Upload.js",
};

const RACK_ID = "dats";

// Exact EXCLUDE_EQUIPMENT list from DATs Weekly.py.
const EXCLUDE_EQUIPMENT = [
  "INT", "Truck Order Not Used", "Ocean", "Air Freight", "Air Freight INT",
  "Guaranteed LTL", "Master Bill", "Rail", "Storage", "Warehouse",
];

/** @param {Record<string, unknown>} row */
function getLinehaul(row) {
  for (let i = 1; i <= 10; i++) {
    const accCol = pickCol(row, [`ACCESSORIAL${i}`]);
    const buyCol = pickCol(row, [`BUY ACCESSORIAL${i}`]);
    if (accCol.key && buyCol.key) {
      const desc = String(accCol.value ?? "").toUpperCase();
      if (
        desc.includes("LINEHAUL \u2013 MEXICAN") ||
        desc.includes("LINEHAUL - U.S.") ||
        desc.includes("LINEHAUL CHARGE")
      ) {
        return buyCol.value;
      }
    }
  }
  return "";
}

/** @param {Record<string, unknown>} row */
function getFuel(row) {
  for (let i = 1; i <= 10; i++) {
    const col = pickCol(row, [`BUY FUEL${i}`]);
    if (col.key && col.value !== "" && col.value != null) return col.value;
  }
  return "";
}

/** @param {Record<string, unknown>} row */
function getAccessorials(row) {
  let total = 0;
  for (let i = 1; i <= 10; i++) {
    const buyCol = pickCol(row, [`BUY ACCESSORIAL${i}`]);
    if (!buyCol.key || buyCol.value === "" || buyCol.value == null) continue;
    const accCol = pickCol(row, [`ACCESSORIAL${i}`]);
    const desc = String(accCol.value ?? "").toUpperCase();
    if (desc.includes("FUEL") || desc.includes("LINEHAUL")) continue;
    const n = Number(String(buyCol.value).replace(/[,$]/g, ""));
    if (!Number.isNaN(n)) total += n;
  }
  return total > 0 ? total : "";
}

export async function loadGui(parent, ctx) {
  mountDumpFilterReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Builds the weekly DAT contribution file from a TMS Data Dump. Keeps truckload rows, drops INT, Ocean, Air, and the other excluded equipment, and writes the DAT column layout.

Workflow:
1. Run a TMS Data Dump for all clients, TL only, covering the previous calendar week (Sun–Sat). Use Ship Date.
2. Upload the dump.
3. Run and Save downloads the contribution workbook.
4. Run and Send hands that same file to the DATs FTP connection. If Send to DAT is off on the rack, the file is saved in client uploads\\dat.`,
    sheetName: "Data",
    runLabel: "Run and Save",
    sendLabel: "Run and Send",
    confirmSend: () => window.confirm("Send this DAT file to the rack? It will be saved in client uploads\\dat."),
    async buildWorkbook(buffer, bctx) {
      const { rows } = workbookToObjects(buffer, "DataDump");

      const filtered = rows.filter((row) => {
        const equip = String(pickVal(row, ["EQUIPMENT"]) ?? "").toUpperCase();
        return !EXCLUDE_EQUIPMENT.some((word) => equip.includes(word.toUpperCase()));
      });

      const out = filtered.map((row) => {
        const equip = String(pickVal(row, ["EQUIPMENT"]) ?? "");
        const milesRaw = pickVal(row, ["Total Miles"]);
        const miles = Number(String(milesRaw ?? "").replace(/[,$]/g, ""));
        const distance = !Number.isNaN(miles) && miles > 0 ? miles : "";

        return {
          "Load ID": pickVal(row, ["LOAD NO"]),
          "Actual Pickup Date/Time": pickVal(row, ["ACTUAL SHIP DATE"]),
          "Origin City": pickVal(row, ["ORIGIN CITY"]),
          "Origin State": pickVal(row, ["ORIGIN STATE"]),
          "Origin Zip": pickVal(row, ["ORIGIN POSTAL"]),
          "Origin Country": pickVal(row, ["ORIGIN COUNTRY"]),
          "Destination City": pickVal(row, ["DESTINATION CITY"]),
          "Destination State": pickVal(row, ["DESTINATION STATE"]),
          "Destination Zip": pickVal(row, ["DESTINATION POSTAL"]),
          "Destination Country": pickVal(row, ["DESTINATION COUNTRY"]),
          Distance: distance,
          Mode: equip,
          "Equipment Type": equip,
          "Temp Control Type": "",
          "Total Number of Pickups": 1,
          "Total Number of Drops": 1,
          "Service Level": pickVal(row, ["SERVICE LEVEL"]),
          Hazmat: /HAZMAT/i.test(equip) ? "YES" : "",
          "Linehaul Amount Paid to Carrier": getLinehaul(row),
          "Fuel Surcharge Amount Paid to Carrier": getFuel(row),
          "Total Accessorals Paid to Carrier (NOT INCLUDING FUEL)": getAccessorials(row),
          "Total Amount Paid to Carrier": pickVal(row, ["TOTAL PAYABLE AMOUNT"]),
          "Contract or Spot Rate Flag to Carrier": "Spot Rate",
        };
      });

      const headers = [
        "Load ID",
        "Actual Pickup Date/Time",
        "Origin City",
        "Origin State",
        "Origin Zip",
        "Origin Country",
        "Destination City",
        "Destination State",
        "Destination Zip",
        "Destination Country",
        "Distance",
        "Mode",
        "Equipment Type",
        "Temp Control Type",
        "Total Number of Pickups",
        "Total Number of Drops",
        "Service Level",
        "Hazmat",
        "Linehaul Amount Paid to Carrier",
        "Fuel Surcharge Amount Paid to Carrier",
        "Total Accessorals Paid to Carrier (NOT INCLUDING FUEL)",
        "Total Amount Paid to Carrier",
        "Contract or Spot Rate Flag to Carrier",
      ];
      const wb = rowsToSheetWorkbook(out, "Data", headers);
      applyClientReportStyle(wb);

      const name = `rates-783793-200409_${fmtMDY(bctx.sun, ".")}_${fmtMDY(bctx.sat, ".")}.xlsx`;
      return { workbook: wb, name, rowCount: out.length };
    },
    async onSend(built, ui) {
      ui.setStatus(`Sending ${built.name}…`);
      const message = await sendToRack(RACK_ID, built.name, workbookBlob(built.workbook));
      ui.setStatus(message);
    },
  });
}
