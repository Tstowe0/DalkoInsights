import { mountFileTool } from "../_shared/file-ui.js";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  objectsToWorkbook,
  downloadWorkbook,
  stampName,
} from "../_shared/excel.js";
import { pickVal } from "../_shared/report-helpers.js";

export const meta = {
  id: "Phinia Operational Report",
  title: "Phinia Operational Report",
  category: "Client Uploads",
  script: "Client Uploads/Phinia Operational Report.js",
};

/** @param {unknown} v */
function normDelivery(v) {
  let s = String(v ?? "").trim();
  if (s.includes("/")) s = s.split("/")[0].trim();
  if (/^\d+\.0$/.test(s)) s = s.slice(0, -2);
  return s;
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  /** @type {File | null} */
  let phiniaFile = null;
  /** @type {File | null} */
  let trackingFile = null;

  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Append Carrier + Quote ID from a TMS Tracking Report onto the Phinia workbook.

Workflow:
1. Select Phinia file, then Tracking Report (or both: Phinia first).
2. Run → download Phinia_Operational_Report_*.xlsx`,
    onBack: ctx.onBack,
    log: ctx.log,
    multiple: true,
    async onRun(files, ui) {
      await ensureXlsx();
      if (files.length >= 2) {
        phiniaFile = files[0];
        trackingFile = files[1];
      } else if (files.length === 1) {
        if (!phiniaFile) {
          phiniaFile = files[0];
          ctx.log(`Phinia set: ${phiniaFile.name}. Select Tracking Report and Run again.`);
          ui.setStatus("Select Tracking Report");
          return;
        }
        trackingFile = files[0];
      }
      if (!phiniaFile || !trackingFile) throw new Error("Need Phinia file and Tracking Report.");

      const phinia = workbookToObjects(await readFileBuffer(phiniaFile));
      const tracking = workbookToObjects(await readFileBuffer(trackingFile));

      /** @type {Map<string, { carrier: string, quote: string }>} */
      const lookup = new Map();
      for (const row of tracking.rows) {
        const d = normDelivery(pickVal(row, ["Delivery No.", "Delivery", "DELIVERY NO."]));
        if (!d) continue;
        lookup.set(d, {
          carrier: String(pickVal(row, ["Carrier", "CARRIER"]) ?? ""),
          quote: String(pickVal(row, ["Carrier Quote No", "Quote ID", "CARRIER QUOTE NO"]) ?? ""),
        });
      }

      let hit = 0;
      const out = phinia.rows.map((row) => {
        const d = normDelivery(pickVal(row, ["Delivery"]));
        const info = lookup.get(d);
        if (info) hit++;
        return {
          ...row,
          Carrier: info?.carrier ?? "",
          "Quote ID": info?.quote ?? "",
        };
      });

      const outName = `Phinia_Operational_Report_${stampName()}.xlsx`;
      downloadWorkbook(objectsToWorkbook(out, "Phinia"), outName);
      ui.setStatus("Complete");
      ctx.log(`Operational report: matched ${hit.toLocaleString()} / ${out.length.toLocaleString()} → ${outName}`);
      phiniaFile = null;
      trackingFile = null;
    },
  });
}
