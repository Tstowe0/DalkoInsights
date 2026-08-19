import { mountDumpFilterReport } from "../_shared/client-reports.js";
import { prevMondayFriday, fmtSlashMDY } from "../_shared/mailto.js";
import { workbookToObjects, formatPyDateTime } from "../_shared/excel.js";
import { multiSheetWorkbook, applyClientReportStyle } from "../_shared/report-format.js";
import { pickVal, pickCol, parseDate, startOfDay, sumMatching } from "../_shared/report-helpers.js";

export const meta = {
  id: "Phinia Weekly",
  title: "Phinia Weekly",
  category: "Client Reports",
  script: "Client Reports/Phinia Weekly.js",
};

// Exact OUTPUT_COLUMNS order from Phinia Weekly.py.
const OUTPUT_COLUMNS = [
  "Origin Pickup Name", "Origin Pickup City", "Origin Pickup State", "Origin Postal code", "Origin Country",
  "Destination Delivery Name", "Destination Delivery City", "Destination Country", "Destination Delivery State", "Destination Postal code",
  "IN/OUT", "Month", "Earliest Requested Pick-up Date", "Earliest Requested Delivery Date",
  "Reference Number", "TMC Order Number", "Actual Pallets", "Actual Weight",
  "Total Charges", "Linehaul", " 405 - Fuel Surcharge", "Accesorials",
  "Carrier", "Mode", "SB/NB/Corereturn", "Invoice", "Usbank Status", "Borgwarner unit", "Premium/ Regular", "Accessorial Notes",
];

/** Non-padded m.d.yyyy, matching Python's `{d.month}.{d.day}.{d.year}` (no strftime padding). */
function mdyNoPad(d) {
  return `${d.getMonth() + 1}.${d.getDate()}.${d.getFullYear()}`;
}

/** Stringify like Python str(Timestamp) / str(cell). */
function pyStr(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return formatPyDateTime(v);
  return String(v).trim();
}

/** @param {Record<string, unknown>} row @param {string[]} headers */
function findExpectedDelivery(row, headers) {
  for (const name of ["EXPECTED DELIVERY DATE", "EXPECTED DELIVERY", "Exp Delivery Date", "DELIVERY DATE (EXPECT)"]) {
    const col = pickCol(row, [name]);
    if (col.key && pyStr(col.value)) return pyStr(col.value);
  }
  for (const h of headers) {
    const up = String(h).trim().toUpperCase();
    if (up.includes("EXPECTED DELIVERY") || up === "DELIVERY DATE (EXPECT)") {
      const s = pyStr(row[h]);
      if (s) return s;
    }
  }
  return "";
}

/** @param {Record<string, unknown>} row */
function findCarrier1(row) {
  for (const alias of ["CARRIER NAME1", "CARRIER1"]) {
    const col = pickCol(row, [alias]);
    if (col.key && String(col.value ?? "").trim()) return String(col.value).trim();
  }
  return "";
}

/** @param {Record<string, unknown>} row @param {string[]} headers */
function accessorialsAndNotes(row, headers) {
  let total = 0;
  const names = [];
  headers.forEach((h, idx) => {
    if (!String(h).toUpperCase().includes("SELL ACCESSORIAL")) return;
    const raw = row[h];
    if (raw == null || raw === "") return;
    const val = Number(String(raw).replace(/[,$]/g, ""));
    if (Number.isNaN(val) || val === 0) return;
    total += val;
    if (idx >= 2) {
      const nameCol = headers[idx - 2];
      const nameVal = row[nameCol];
      if (nameVal != null && String(nameVal).trim()) names.push(String(nameVal).trim());
    }
  });
  return { total, notes: names.join(", ") };
}

/** @param {Record<string, unknown>} row @param {string[]} headers */
function mapPhiniaRow(row, headers) {
  const shipRaw = (() => {
    // Mirror pandas: blank ACTUAL SHIP DATE is NaN (truthy under `or`), so do not
    // fall through to EXPECTED when the ACTUAL column exists.
    const actual = pickCol(row, ["ACTUAL SHIP DATE"]);
    if (actual.key) return actual.value;
    return pickVal(row, ["EXPECTED SHIP DATE"]);
  })();
  const shipDt = parseDate(shipRaw);
  const month = shipDt ? shipDt.toLocaleString("en-US", { month: "long" }) : "";

  const totalChargesCol = pickCol(row, ["TOTAL RECEIVABLE AMOUNT"]);
  const totalCharges = totalChargesCol.key ? totalChargesCol.value : 0;

  const carrier1 = findCarrier1(row);
  const paidDate = pickVal(row, ["Paid Date"]);
  const { total: accessorials, notes } = accessorialsAndNotes(row, headers);

  const out = {
    "Origin Pickup Name": String(pickVal(row, ["ORIGIN NAME"]) ?? "").trim(),
    "Origin Pickup City": String(pickVal(row, ["ORIGIN CITY"]) ?? "").trim(),
    "Origin Pickup State": String(pickVal(row, ["ORIGIN STATE"]) ?? "").trim(),
    "Origin Postal code": String(pickVal(row, ["ORIGIN POSTAL"]) ?? "").trim(),
    "Origin Country": String(pickVal(row, ["ORIGIN COUNTRY"]) ?? "").trim(),
    "Destination Delivery Name": String(pickVal(row, ["DESTINATION NAME"]) ?? "").trim(),
    "Destination Delivery City": String(pickVal(row, ["DESTINATION CITY"]) ?? "").trim(),
    "Destination Country": String(pickVal(row, ["DESTINATION COUNTRY"]) ?? "").trim(),
    "Destination Delivery State": String(pickVal(row, ["DESTINATION STATE"]) ?? "").trim(),
    "Destination Postal code": String(pickVal(row, ["DESTINATION POSTAL"]) ?? "").trim(),
    "IN/OUT": "OUT",
    Month: month,
    "Earliest Requested Pick-up Date": pyStr(pickVal(row, ["EXPECTED SHIP DATE"])),
    "Earliest Requested Delivery Date": findExpectedDelivery(row, headers),
    "Reference Number": String(pickVal(row, ["Delivery No."]) ?? "").trim(),
    "TMC Order Number": String(pickVal(row, ["LOAD NO"]) ?? "").trim(),
    "Actual Pallets": sumMatching(row, /HDLG UNITS/i),
    "Actual Weight": sumMatching(row, /^WEIGHT/i),
    "Total Charges": totalCharges,
    Linehaul: (() => {
      const c = pickCol(row, ["SELL FREIGHT1"]);
      return c.key ? c.value : 0;
    })(),
    " 405 - Fuel Surcharge": (() => {
      const c = pickCol(row, ["SELL FUEL1"]);
      return c.key ? c.value : 0;
    })(),
    Accesorials: accessorials,
    Carrier: carrier1 ? `DALKO RES/${carrier1}` : "DALKO RES/",
    Mode: "LTL",
    "SB/NB/Corereturn": "NB",
    Invoice: String(pickVal(row, ["LOAD NO"]) ?? "").trim(),
    "Usbank Status": String(paidDate ?? "").trim() ? "PAID" : "UNPAID",
    "Borgwarner unit": "712",
    "Premium/ Regular": "Regular",
    "Accessorial Notes": notes,
  };

  /** @type {Record<string, unknown>} */
  const ordered = {};
  for (const col of OUTPUT_COLUMNS) ordered[col] = out[col] ?? "";
  return { row: ordered, shipDt };
}

export async function loadGui(parent, ctx) {
  mountDumpFilterReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Weekly report for Phinia that generates two tabs in the output:
1) Year to Date (current year through today)
2) Previous calendar week (Sunday through Saturday, by Ship Date)
Processes TMS Data Dump files to generate formatted reports.

Workflow:
1. Run a TMS Data Dump for Client: Phinia.
2. Use Ship Dates covering the beginning of the year through last Saturday. (This gives us a YTD and previous week tabs in one process.)
3. Upload that report into the tool.
4. The tool will generate the final output with Year to Date and Previous Week tabs.
5. Use the Email button to prefill your email client with recipients and subject.
6. All progress is reported in the launcher console.`,
    sheetName: "Year to Date",
    async buildWorkbook(buffer) {
      const { rows, headers } = workbookToObjects(buffer);
      const mapped = rows.map((row) => mapPhiniaRow(row, headers));

      const today = startOfDay(new Date());
      const ytdStart = new Date(today.getFullYear(), 0, 1);

      const daysSinceSunday = (today.getDay() + 0) % 7; // JS getDay: Sun=0
      const currentWeekSunday = new Date(today);
      currentWeekSunday.setDate(today.getDate() - daysSinceSunday);
      const prevWeekSunday = new Date(currentWeekSunday);
      prevWeekSunday.setDate(currentWeekSunday.getDate() - 7);
      const prevWeekSaturday = new Date(prevWeekSunday);
      prevWeekSaturday.setDate(prevWeekSunday.getDate() + 6);

      const ytd = mapped
        .filter(({ shipDt }) => !shipDt || (startOfDay(shipDt).getTime() >= ytdStart.getTime() && startOfDay(shipDt).getTime() <= today.getTime()))
        .map((x) => x.row);
      const week = mapped
        .filter(({ shipDt }) => {
          if (!shipDt) return false;
          const t = startOfDay(shipDt).getTime();
          return t >= prevWeekSunday.getTime() && t <= prevWeekSaturday.getTime();
        })
        .map((x) => x.row);

      const weekTabLabel = `${mdyNoPad(prevWeekSunday)} - ${mdyNoPad(prevWeekSaturday)}`.slice(0, 31);

      const wb = multiSheetWorkbook([
        { name: "Year to Date", rows: ytd, headers: OUTPUT_COLUMNS },
        { name: weekTabLabel, rows: week, headers: OUTPUT_COLUMNS },
      ]);
      applyClientReportStyle(wb, { zebra: false, autosizeMax: 50, centerData: false });
      if (!wb.Workbook) wb.Workbook = {};
      wb.Workbook.Views = [{ activeTab: 1 }];

      const dateRange = `${mdyNoPad(prevWeekSunday)} - ${mdyNoPad(prevWeekSaturday)}`;
      const name = `Phinia Shipments ${dateRange}.xlsx`;

      return { workbook: wb, name, rowCount: ytd.length + week.length };
    },
    emailDraft: () => {
      const { monday, friday } = prevMondayFriday();
      const dateRange = `${fmtSlashMDY(monday, "/")} - ${fmtSlashMDY(friday, "/")}`;
      return {
        to: "rgaribay@phinia.com;ebecerra@phinia.com;logistics.slp1@phinia.com",
        cc: "Alexis.Johnson@shipdalko.com;Jared.Grandy@shipdalko.com;Ramon.Villegas@shipdalko.com",
        subject: `Weekly Report for ${dateRange}`,
        body: "Attached is your weekly report for last week's loads.",
      };
    },
  });
}
