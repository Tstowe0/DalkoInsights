import { mountTrackingDailyReport } from "../_shared/client-reports.js?v=20261023-penn";
import { fmtSlashMDY } from "../_shared/mailto.js";

export const meta = {
  id: "Penn Machine Daily Tracking Report",
  title: "Penn Machine Daily Tracking Report",
  category: "Client Reports",
  script: "Client Reports/Penn Machine Daily Tracking Report.js",
};

/** Copied from McConway: Vet-Pet excludes, with booked and pickup statuses kept. */
const EXCLUDE = new Set([
  "DELIVERED",
  "INVOICED",
  "QUOTE MODIFIED",
  "SPOT QUOTED",
  "QUOTED",
  "ASSIGN CARRIER",
]);

const INTERNAL_TO = [
  "Gerry.Marra@shipdalko.com",
  "Shannon.Kizima@shipdalko.com",
].join(";");

export async function loadGui(parent, ctx) {
  mountTrackingDailyReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Instructions:
1. Run a TMS Tracking Report.
2. Use Today's date and go back 1 Month.
3. Use the customers: Penn Machine.`,
    excludeStatuses: EXCLUDE,
    highlight: false,
    filename: ({ today, fmtMDY }) => `Penn Machine Daily Shipment Report ${fmtMDY(today)}.xlsx`,
    sheetName: ({ today, fmtMDY }) => `Daily Shipments for ${fmtMDY(today)}`,
    emailDraft: () => {
      const today = fmtSlashMDY(new Date(), "/");
      return {
        label: "Email Internal",
        to: INTERNAL_TO,
        subject: `Penn Machine Daily Shipment Report ${today}`,
        body: "Attached is today's tracking report.",
      };
    },
  });
}
