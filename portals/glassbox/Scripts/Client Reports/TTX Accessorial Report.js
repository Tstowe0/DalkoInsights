import { mountFileTool } from "../_shared/file-ui.js?v=20261020-ttx14";
import { downloadWorkbook, ensureXlsx, readCellA1, readFileBuffer } from "../_shared/excel.js";
import { prevMonthNameYear } from "../_shared/mailto.js";
import { prevMonthRange } from "../_shared/report-helpers.js";
import { closeProgress, updateProgress } from "../../../../shared/js/dialog.js?v=20261020-ttx15";
import { buildTtxWorkbook } from "./ttx-accessorial.js?v=20261020-ttx14";

export const meta = {
  id: "TTX Accessorial Report",
  title: "TTX Accessorial Report",
  category: "Client Reports",
  script: "Client Reports/TTX Accessorial Report.js",
};

export async function loadGui(parent, ctx) {
  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Monthly TTX accessorial scorecard from a TMS data dump. One tab per city, a combined tab, a liftgate load list, an accessorial ratio, and a data tab in the Marmon Ferroworks layout.

Workflow:
1. Run a TMS Data Dump for TTX for the previous month.
2. Upload the dump file and run the tool.
3. Use the Email button to open a draft for the previous month. Attach the generated report before sending.`,
    onBack: ctx.onBack,
    log: ctx.log,
    layout: "board",
    runLabel: "Run Report",
    board: {
      lead: "Builds an eight-tab TTX accessorial scorecard from a TMS data dump. Jacksonville, Joliet, Mira Loma, and N Augusta each split shipper and consignee. All Locations Combined rolls those cities together. Liftgate Loads lists every shipment with a liftgate accessorial. Accessorial Ratio compares shipment count with accessorial charge count. Data Tab matches the Marmon Ferroworks dump.",
      reports: {
        title: "Eight Tabs",
        text: "Jacksonville, Joliet, Mira Loma, N Augusta, All Locations Combined, Liftgate Loads, Accessorial Ratio, and Data Tab.",
      },
      upload: {
        title: "Upload TMS Data Dump",
        text: "Select the TMS data dump for the previous month.",
      },
      run: {
        title: "Run Report",
        text: "Download the scorecard workbook. Liftgate Loads and Data Tab use the Marmon dump columns without Dat Freight and Dat Fuel, plus each sell accessorial name and cost.",
      },
      email: {
        title: "Email",
        text: "Opens a draft for the previous month. Recipients are not set yet.",
      },
    },
    emailDraft: () => {
      const { monthName, monthYear } = prevMonthNameYear();
      return {
        label: "Open Email Draft",
        subject: `TTX Accessorial Report ${monthName} ${monthYear}`,
        body: `Attached is the TTX Accessorial Report for the month of ${monthName} ${monthYear}.\n\nPlease let us know if you have any questions.`,
      };
    },
    async onRun(files, ui) {
      await ensureXlsx();
      const buffer = await readFileBuffer(files[0]);
      if (readCellA1(buffer).toUpperCase() !== "CLIENT NAME") {
        const ok = window.confirm(
          "Cell A1 is not CLIENT NAME — this may not be a TMS Data Dump.\n\nClick OK to run anyway, or Cancel to abort."
        );
        if (!ok) {
          ui.setStatus("Ready");
          ctx.log(`${meta.title}: aborted (A1 check).`);
          return;
        }
        ctx.log("Warning: A1 may not be CLIENT NAME — continuing after confirm.");
      }
      try {
        updateProgress({
          step: "read",
          title: "Building TTX report",
          detail: "Reading the TMS data dump and building the city scorecards.",
        });
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const built = await buildTtxWorkbook(buffer);
        const { label } = prevMonthRange();
        const name = `TTX ACCESSORIALS BY CITY ${label}.xlsx`;
        downloadWorkbook(built.workbook, name);
        ui.setStatus(`Saved ${name}`);
        ctx.log(`${meta.title}: ${built.loadCount.toLocaleString()} loads, ${built.accessorialCount.toLocaleString()} accessorials, ${built.liftCount.toLocaleString()} liftgate loads, ${built.rowCount.toLocaleString()} data rows → ${name}`);
      } finally {
        closeProgress();
      }
    },
  });
}
