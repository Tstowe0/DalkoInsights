import { mountFileTool } from "../_shared/file-ui.js";
import {
  ensureXlsx,
  readFileBuffer,
  objectsToWorkbook,
  downloadWorkbook,
  stampName,
} from "../_shared/excel.js";

export const meta = {
  id: "RLCA Matrix Parser",
  title: "RLCA Matrix Parser",
  category: "Data Tools",
  script: "Data Tools/RLCA Matrix Parser.js",
};

/** @param {string} text */
function parseStateList(text) {
  const m = String(text).match(/\(([^)]*)\)/);
  const raw = (m ? m[1] : text).replace(/\s+/g, " ");
  return raw
    .split(/[,&]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {unknown[][]} aoa
 */
function parseSheet(aoa) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  let i = 0;
  while (i < aoa.length) {
    const cell = String(aoa[i]?.[0] ?? "");
    if (!/DEBTOR REGION/i.test(cell)) {
      i++;
      continue;
    }
    const origins = parseStateList(cell);
    // find destination header nearby
    let headerIdx = -1;
    let discountCol = -1;
    let floorCol = -1;
    for (let j = i + 1; j < Math.min(i + 8, aoa.length); j++) {
      const row = aoa[j] || [];
      const labels = row.map((c) => String(c ?? "").trim().toLowerCase());
      const d = labels.findIndex((x) => x === "3rd" || x.includes("discount"));
      const f = labels.findIndex((x) => x === "floor" || x.includes("minimum") || x.includes("min"));
      if (d >= 0 && f >= 0) {
        headerIdx = j;
        discountCol = d;
        floorCol = f;
        break;
      }
    }
    if (headerIdx < 0) {
      i++;
      continue;
    }
    for (let r = headerIdx + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const a0 = String(row[0] ?? "");
      if (/DEBTOR REGION/i.test(a0)) {
        i = r - 1;
        break;
      }
      if (!a0.trim()) continue;
      if (/destination region/i.test(a0)) continue;
      const dests = parseStateList(a0);
      const discount = row[discountCol] ?? "";
      const minimum = row[floorCol] ?? "";
      for (const origin of origins) {
        for (const destination of dests) {
          out.push({ Origin: origin, Destination: destination, Discount: discount, Minimum: minimum });
        }
      }
      i = r;
    }
    i++;
  }
  return out;
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Parse RLCA tariff matrix sheets into Origin / Destination / Discount / Minimum rows.

Workflow:
1. Upload RLCA matrix workbook.
2. Run → download ParsedMatrix_*.xlsx (all sheets processed).`,
    onBack: ctx.onBack,
    log: ctx.log,
    async onRun(files, ui) {
      await ensureXlsx();
      const XLSX = globalThis.XLSX;
      const wb = XLSX.read(await readFileBuffer(files[0]), { type: "array" });
      /** @type {Record<string, unknown>[]} */
      let all = [];
      for (const name of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
        const rows = parseSheet(aoa);
        ctx.log(`Sheet “${name}”: ${rows.length} pairs`);
        all = all.concat(rows);
      }
      const outName = `ParsedMatrix_${stampName()}.xlsx`;
      downloadWorkbook(objectsToWorkbook(all, "Parsed"), outName);
      ui.setStatus("Complete");
      ctx.log(`Parsed ${all.length.toLocaleString()} rows → ${outName}`);
    },
  });
}
