import { mountFileTool } from "../_shared/file-ui.js";
import {
  ensureXlsx,
  readFileBuffer,
  downloadWorkbook,
  paintWorkbookTheme,
  stampName,
} from "../_shared/excel.js";

export const meta = {
  id: "Excel Theme Painter",
  title: "Excel Theme Painter",
  category: "Data Tools",
  script: "Data Tools/Excel Theme Painter.js",
};

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `1. Upload an existing Excel file.
2. Run to apply standardized theming across all sheets.
3. Export the newly formatted workbook.
4. Original data remains unchanged—only styling is applied.`,
    onBack: ctx.onBack,
    log: ctx.log,
    accept: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    async onRun(files, ui) {
      await ensureXlsx();
      const file = files[0];
      ctx.log(`Painting theme on ${file.name}…`);
      const buffer = await readFileBuffer(file);
      const XLSX = globalThis.XLSX;
      const workbook = XLSX.read(buffer, { type: "array" });
      paintWorkbookTheme(workbook);
      const outName = `ThemedReport_${stampName()}.xlsx`;
      downloadWorkbook(workbook, outName);
      ui.setStatus("Complete");
      ctx.log(`Saved ${outName}`);
    },
  });
}
