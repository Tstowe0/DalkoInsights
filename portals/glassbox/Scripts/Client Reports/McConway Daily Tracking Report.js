import { mountTrackingDailyReport } from "../_shared/client-reports.js";
import { VETPET_EXCLUDE, MCCONWAY_KEEP } from "../_shared/tracking-layout.js";
import { fmtSlashMDY } from "../_shared/mailto.js";

export const meta = {
  id: "McConway Daily Tracking Report",
  title: "McConway Daily Tracking Report",
  category: "Client Reports",
  script: "Client Reports/McConway Daily Tracking Report.js",
};

const EXCLUDE = new Set([...VETPET_EXCLUDE].filter((s) => !MCCONWAY_KEEP.has(s)));

const INTERNAL_TO = [
  "Michael.Bochert@shipdalko.com",
  "Jared.Grandy@shipdalko.com",
  "Mike.Nicula@shipdalko.com",
  "Tracking@shipdalko.com",
  "James.Kosior@shipdalko.com",
  "Shannon.Kizima@shipdalko.com",
].join(";");

const EXTERNAL_TO = [
  "DENISE.PINTER@FERROWORKS.COM",
  "JOE.BOWMAN@FERROWORKS.COM",
  "KIMBERLY.JOHNSON@FERROWORKS.COM",
  "MARYGAY.GRAZULIS@FERROWORKS.COM",
  "PHILIP.BOCKA@FERROWORKS.COM",
  "TERRENCE.MCMANUS@FERROWORKS.COM",
  "WILLIAM.FLEMMING@FERROWORKS.COM",
  "ALESSANDRA.APICELLA@FERROWORKS.COM",
  "CYNTHIA.KORBERT@FERROWORKS.COM",
  "DONNIE.HICKIE@FERROWORKS.COM",
  "JANET.KASTAN@FERROWORKS.COM",
  "MATTHEW.STANLEY@FERROWORKS.COM",
  "SHANNON.HAUBER@FERROWORKS.COM",
  "TROY.SMITH@FERROWORKS.COM",
  "VITTORIO.FALBELLI@FERROWORKS.COM",
].join(";");

export async function loadGui(parent, ctx) {
  mountTrackingDailyReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Instructions:
1. Tracking Report
2. Ship Date: 1 Month Out
3. Customers: McConway and Torely Pittsburgh and Kutztown, Standard Forged Products`,
    excludeStatuses: EXCLUDE,
    highlight: false,
    filename: ({ today, fmtMDY }) => `Ferroworks Daily Shipment Report ${fmtMDY(today)}.xlsx`,
    sheetName: ({ today, fmtMDY }) => `Daily Shipments for ${fmtMDY(today)}`,
    emailDraft: () => {
      const today = fmtSlashMDY(new Date(), "/");
      const subject = `Ferroworks Daily Shipment Report ${today}`;
      return [
        {
          label: "Email Internal",
          to: INTERNAL_TO,
          subject,
          body: "Attached is today's tracking report.",
        },
        {
          label: "Email External",
          to: EXTERNAL_TO,
          cc: INTERNAL_TO,
          subject,
          body: "Attached is your tracking report for today.",
        },
      ];
    },
  });
}
