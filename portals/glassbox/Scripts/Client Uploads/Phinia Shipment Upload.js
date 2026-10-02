import { mountFileTool } from "../_shared/file-ui.js?v=20260930-ftprack";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  objectsToWorkbook,
  downloadWorkbook,
  stampName,
} from "../_shared/excel.js";
import { pickVal, normKey } from "../_shared/report-helpers.js";
import { sendToRack } from "../../../../shared/js/ftp-rack.js?v=20261002-ftpback";

export const meta = {
  id: "Phinia Shipment Upload",
  title: "Phinia Shipment Upload",
  category: "Client Uploads",
  script: "Client Uploads/Phinia Shipment Upload.js",
};

const OUTPUT_COLUMNS = [
  "Equipment",
  "Ship Date",
  "Pickup Request Time",
  "Pickup Close Time",
  "Origin Name",
  "Origin Address",
  "Origin City",
  "Origin State",
  "Origin Postal",
  "Origin Country",
  "Origin Contact Phone",
  "Destination Name",
  "Destination Address",
  "Destination City",
  "Destination State",
  "Destination Postal",
  "Destination Country",
  "Product",
  "Hdlg Units",
  "Hdlg Unit Type",
  "Weight",
  "Class",
  "NMFC",
  "Length",
  "Width",
  "Height",
  "Stackable",
  "Insurance Amount",
  "Commodity Category",
  "Commodity Type",
  "Shipment Value",
  "Accessorial Code1",
  "Accessorial Code2",
  "Accessorial Code3",
  "Accessorial Code4",
  "Accessorial Code5",
  "Accessorial Code6",
  "Accessorial Code7",
  "Reference1",
  "Reference2",
  "Reference3",
  "Reference4",
  "Reference5",
  "Reference6",
  "Reference7",
  "Reference8",
  "Reference9",
  "Reference10",
  "Carrier",
];

const officeSite = true;

/**
 * @param {Record<string, unknown>[]} rows
 */
function rowsToCsv(rows) {
  const XLSX = globalThis.XLSX;
  const sheet = XLSX.utils.json_to_sheet(rows, { header: OUTPUT_COLUMNS });
  return XLSX.utils.sheet_to_csv(sheet);
}

/**
 * @param {File[]} files
 * @param {{ extra: HTMLElement }} ui
 */
async function mapPhinia(files, ui) {
  await ensureXlsx();
  const shipDate = /** @type {HTMLInputElement} */ (ui.extra.querySelector("[data-shipdate]")).value.trim();
  if (!shipDate) throw new Error("Enter a Ship Date.");
  const { rows } = workbookToObjects(await readFileBuffer(files[0]));
  return rows.map((row) => {
    const delivery = String(pickVal(row, ["Delivery"]) ?? "").split("/")[0].trim();
    let postal = String(pickVal(row, ["Postal Code"]) ?? "").trim();
    if (/^\d{4}$/.test(postal)) postal = postal.padStart(5, "0");
    const pallets = Number(String(pickVal(row, ["Pallet", "Pallets", "Number of Pallets"]) ?? "").replace(/[,$]/g, "")) || "";
    const weightRaw = Number(String(pickVal(row, ["Gross Weight", "Weight", "Total Weight"]) ?? "").replace(/[,$]/g, ""));
    const weight = Number.isNaN(weightRaw) ? "" : Math.round(weightRaw);

    /** @type {Record<string, unknown>} */
    const out = {};
    for (const col of OUTPUT_COLUMNS) out[col] = "";
    out.Equipment = "LTL";
    out["Ship Date"] = shipDate;
    out["Pickup Request Time"] = "08:00";
    out["Pickup Close Time"] = "16:00";
    out["Origin Name"] = "LAREDO CROSSING";
    out["Origin City"] = "Laredo";
    out["Origin State"] = "TX";
    out["Origin Postal"] = "78045";
    out["Origin Country"] = "US";
    out["Destination Name"] = pickVal(row, ["Name of the ship-to party", "Name"]) || "";
    out["Destination Address"] = [pickVal(row, ["House Number"]), pickVal(row, ["Street"])]
      .filter(Boolean)
      .join(" ")
      .trim();
    out["Destination City"] = pickVal(row, ["Location of the ship-to party"]) || "";
    out["Destination State"] = pickVal(row, ["Region"]) || "";
    out["Destination Postal"] = postal;
    out["Destination Country"] = /[A-Za-z]/.test(postal) ? "CA" : "US";
    out.Product = pickVal(row, ["Material Description", "Product"]) || "";
    out["Hdlg Units"] = pallets;
    out["Hdlg Unit Type"] = "PLT";
    out.Weight = weight;
    out.Class = "70";
    out.Reference1 = delivery;
    out.Reference2 = pickVal(row, ["Ship-To Party"]) || "";
    return out;
  });
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: officeSite
      ? `Map Phinia tender rows into the standard TMS upload layout.

Workflow:
1. Upload Phinia Excel.
2. Enter Ship Date (applied to all rows).
3. Run downloads Phinia_*.xlsx.
4. Send to TMS hands the same rows to the FTP rack as a CSV. The rack places the file in /PHINIA.`
      : `Map Phinia tender rows into the standard TMS upload layout.

Workflow:
1. Upload Phinia Excel.
2. Enter Ship Date (applied to all rows).
3. Run → download Phinia_*.xlsx
Send to TMS is available on the office site. This public site cannot reach the FTP rack.`,
    onBack: ctx.onBack,
    log: ctx.log,
    sendLabel: officeSite ? "Send to TMS" : "",
    buildExtra(extra) {
      extra.innerHTML = `
        <label class="gb-check ui-field-inline">
          <span>Ship Date</span>
          <input class="ui-input" data-shipdate placeholder="MM/DD/YYYY" style="width:12rem" />
        </label>
      `;
    },
    async onRun(files, ui) {
      const mapped = await mapPhinia(files, ui);
      const outName = `Phinia_${stampName()}.xlsx`;
      downloadWorkbook(objectsToWorkbook(mapped, "Upload"), outName);
      ui.setStatus("Complete");
      ctx.log(`Phinia upload mapped ${mapped.length.toLocaleString()} rows → ${outName}`);
      void normKey;
    },
    async onSend(files, ui) {
      const mapped = await mapPhinia(files, ui);
      const outName = `Phinia_${stampName()}${String(new Date().getSeconds()).padStart(2, "0")}.csv`;
      const message = await sendToRack("phinia", outName, rowsToCsv(mapped));
      ui.setStatus("Sent");
      ctx.log(`Sent ${mapped.length.toLocaleString()} rows to TMS as ${outName}. ${message}`);
    },
  });
}
