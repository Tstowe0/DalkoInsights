import { mountFileTool } from "../_shared/file-ui.js";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  objectsToWorkbook,
  downloadWorkbook,
  stampName,
} from "../_shared/excel.js";

export const meta = {
  id: "Guardian Shipment Upload",
  title: "Guardian Shipment Upload",
  category: "Client Uploads",
  script: "Client Uploads/Guardian Shipment Upload.js",
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

const ALIASES = {
  "Comoddity Type": "Commodity Type",
};

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Map a Guardian load tender into the standard shipment upload layout.

Workflow:
1. Upload the Guardian tender Excel.
2. Run → download Guardian_{timestamp}.xlsx
(FTP send is desktop-only and not included in the web port.)`,
    onBack: ctx.onBack,
    log: ctx.log,
    async onRun(files, ui) {
      await ensureXlsx();
      const { rows } = workbookToObjects(await readFileBuffer(files[0]));
      const mapped = rows.map((row) => {
        /** @type {Record<string, unknown>} */
        const normalized = {};
        for (const [k, v] of Object.entries(row)) {
          const key = ALIASES[k] || k;
          normalized[key] = v;
        }
        /** @type {Record<string, unknown>} */
        const out = {};
        for (const col of OUTPUT_COLUMNS) {
          let val = normalized[col] ?? "";
          if (col === "Hdlg Unit Type" && val) val = String(val).toUpperCase();
          out[col] = val;
        }
        return out;
      });

      const outName = `Guardian_${stampName()}.xlsx`;
      downloadWorkbook(objectsToWorkbook(mapped, "Upload"), outName);
      ui.setStatus("Complete");
      ctx.log(`Guardian mapped ${mapped.length.toLocaleString()} rows → ${outName}`);
    },
  });
}
