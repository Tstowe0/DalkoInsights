import { mountFileTool } from "../_shared/file-ui.js";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  objectsToWorkbook,
  downloadWorkbook,
  paintWorkbookTheme,
  stampName,
} from "../_shared/excel.js";
import { pickVal, parseDate, daysBetween, normKey } from "../_shared/report-helpers.js";

export const meta = {
  id: "Shipment Consolidator",
  title: "Shipment Consolidator",
  category: "Data Tools",
  script: "Data Tools/Shipment Consolidator.js",
};

const MATCH_KEYS = [
  "CLIENT NAME",
  "ORIGIN POSTAL",
  "DESTINATION POSTAL",
  "ACTUAL SHIP DATE",
  "ORIGIN NAME",
  "DESTINATION NAME",
];

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Consolidate matching shipment rows within a day window.

Workflow:
1. Upload a TMS-style dump.
2. Set day window (default 1 = same day).
3. Run → download consolidated loads (groups with 2+ matching rows).`,
    onBack: ctx.onBack,
    log: ctx.log,
    buildExtra(extra) {
      extra.innerHTML = `
        <label class="gb-check ui-field-inline">
          <span>Day window</span>
          <input class="ui-input ui-input--sm" type="number" data-window min="1" max="30" value="1" />
        </label>
      `;
    },
    async onRun(files, ui) {
      await ensureXlsx();
      const windowDays =
        Number(/** @type {HTMLInputElement} */ (ui.extra.querySelector("[data-window]")).value) || 1;
      const { rows } = workbookToObjects(await readFileBuffer(files[0]));

      const sorted = [...rows].sort((a, b) => {
        for (const key of MATCH_KEYS) {
          const av = String(pickVal(a, [key]) ?? "");
          const bv = String(pickVal(b, [key]) ?? "");
          if (av !== bv) return av < bv ? -1 : 1;
        }
        return 0;
      });

      /** @type {Record<string, unknown>[]} */
      const consolidated = [];
      let i = 0;
      while (i < sorted.length) {
        const group = [sorted[i]];
        const startDate = parseDate(pickVal(sorted[i], ["ACTUAL SHIP DATE"]));
        let j = i + 1;
        while (j < sorted.length) {
          const candidate = sorted[j];
          let same = true;
          for (const key of MATCH_KEYS) {
            if (key === "ACTUAL SHIP DATE") continue;
            if (normKey(pickVal(sorted[i], [key])) !== normKey(pickVal(candidate, [key]))) {
              same = false;
              break;
            }
          }
          if (!same) break;
          const d = parseDate(pickVal(candidate, ["ACTUAL SHIP DATE"]));
          if (startDate && d && daysBetween(d, startDate) > windowDays - 1) break;
          if (startDate && d && daysBetween(d, startDate) < 0) break;
          group.push(candidate);
          j++;
        }
        if (group.length > 1) {
          const first = { ...group[0] };
          const weight = group.reduce(
            (s, r) => s + (Number(String(pickVal(r, ["Total Wt.", "TOTAL WT.", "WEIGHT"]) ?? "").replace(/[,$]/g, "")) || 0),
            0
          );
          const recv = group.reduce(
            (s, r) =>
              s +
              (Number(String(pickVal(r, ["TOTAL RECEIVABLE AMOUNT"]) ?? "").replace(/[,$]/g, "")) || 0),
            0
          );
          first["New Total Weight"] = Math.round(weight * 100) / 100;
          first["New Total Receivable"] = Math.round(recv * 100) / 100;
          first["Loads In Group"] = group.length;
          consolidated.push(first);
          for (let k = 1; k < group.length; k++) consolidated.push({ ...group[k] });
        }
        i = j;
      }

      const outName = `ConsolidatedLoads_${stampName()}.xlsx`;
      const wb = objectsToWorkbook(consolidated, "Consolidated");
      paintWorkbookTheme(wb);
      downloadWorkbook(wb, outName);
      ui.setStatus("Complete");
      ctx.log(`Consolidated ${consolidated.length.toLocaleString()} rows → ${outName}`);
    },
  });
}
