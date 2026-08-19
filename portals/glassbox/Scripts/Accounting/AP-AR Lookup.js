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
  id: "AP-AR Lookup",
  title: "AP-AR Lookup",
  category: "Accounting",
  script: "Accounting/AP-AR Lookup.js",
};

/** @param {unknown} v */
function normLoad(v) {
  return String(v ?? "")
    .trim()
    .replace(/\.0$/, "");
}

/**
 * Letter columns are 0-based: A=0 … H=7, K=10
 * @param {unknown[][]} aoa
 * @param {{ load: number, date: number, extra: number, amount: number }} cols
 */
function aggregateByLoad(aoa, cols) {
  /** @type {Map<string, { date: string, extra: string, amount: number }>} */
  const map = new Map();
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const load = normLoad(row[cols.load]);
    if (!load) continue;
    const amount = Number(String(row[cols.amount] ?? "").replace(/[,$]/g, "")) || 0;
    const date = String(row[cols.date] ?? "");
    const extra = String(row[cols.extra] ?? "");
    const cur = map.get(load);
    if (!cur) {
      map.set(load, { date, extra, amount });
    } else {
      cur.amount += amount;
      if (date && (!cur.date || date < cur.date)) cur.date = date;
      if (!cur.extra && extra) cur.extra = extra;
    }
  }
  return map;
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  /** @type {File | null} */
  let apFile = null;
  /** @type {File | null} */
  let arFile = null;

  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Compare AP and AR by Load Number.

Workflow:
1. Browse to select the AP file, then again for the AR file (or select both at once).
2. Run → download Missing Pairs + Mismatched Years sheets.

Column layout (by letter): AP Load=K Date=C Doc=D Amount=H · AR Load=D Date=C Customer=E Amount=H`,
    onBack: ctx.onBack,
    log: ctx.log,
    multiple: true,
    accept: ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv",
    async onRun(files, ui) {
      await ensureXlsx();
      if (files.length >= 2) {
        apFile = files[0];
        arFile = files[1];
      } else if (files.length === 1) {
        if (!apFile) {
          apFile = files[0];
          ctx.log(`AP file set: ${apFile.name}. Select AR file and Run again.`);
          ui.setStatus("Select AR file");
          return;
        }
        arFile = files[0];
      }
      if (!apFile || !arFile) throw new Error("Need both AP and AR files.");

      const XLSX = globalThis.XLSX;
      const apWb = XLSX.read(await readFileBuffer(apFile), { type: "array" });
      const arWb = XLSX.read(await readFileBuffer(arFile), { type: "array" });
      const apAoa = XLSX.utils.sheet_to_json(apWb.Sheets[apWb.SheetNames[0]], { header: 1, defval: "" });
      const arAoa = XLSX.utils.sheet_to_json(arWb.Sheets[arWb.SheetNames[0]], { header: 1, defval: "" });

      const ap = aggregateByLoad(apAoa, { load: 10, date: 2, extra: 3, amount: 7 });
      const ar = aggregateByLoad(arAoa, { load: 3, date: 2, extra: 4, amount: 7 });

      /** @type {Record<string, unknown>[]} */
      const missing = [];
      /** @type {Record<string, unknown>[]} */
      const mismatched = [];

      const allLoads = new Set([...ap.keys(), ...ar.keys()]);
      for (const load of allLoads) {
        const a = ap.get(load);
        const r = ar.get(load);
        if (!a || !r) {
          missing.push({
            "Load Number": load,
            "AR Date": r?.date ?? "",
            "AR Customer": r?.extra ?? "",
            "AR Amount": r?.amount ?? "",
            "AP Date": a?.date ?? "",
            "AP Amount": a?.amount ?? "",
            "AP Doc. No.": a?.extra ?? "",
          });
          continue;
        }
        const ay = String(a.date).match(/\d{4}/)?.[0];
        const ry = String(r.date).match(/\d{4}/)?.[0];
        if (ay && ry && ay !== ry) {
          mismatched.push({
            "Load Number": load,
            "AR Date": r.date,
            "AR Year": ry,
            "AR Customer": r.extra,
            "AR Amount": r.amount,
            "AP Date": a.date,
            "AP Year": ay,
            "AP Amount": a.amount,
            "AP Doc. No.": a.extra,
          });
        }
      }

      const outWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(outWb, XLSX.utils.json_to_sheet(missing), "Missing Pairs");
      XLSX.utils.book_append_sheet(outWb, XLSX.utils.json_to_sheet(mismatched), "Mismatched Years");
      const outName = `AP-AR Lookup Output - ${stampName()}.xlsx`;
      downloadWorkbook(outWb, outName);
      ui.setStatus("Complete");
      ctx.log(`AP-AR: ${missing.length} missing, ${mismatched.length} year mismatches → ${outName}`);
      apFile = null;
      arFile = null;
      void workbookToObjects;
      void objectsToWorkbook;
    },
  });
}
