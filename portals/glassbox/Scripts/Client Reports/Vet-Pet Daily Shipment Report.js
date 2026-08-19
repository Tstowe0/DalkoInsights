import { mountTrackingDailyReport } from "../_shared/client-reports.js";
import { VETPET_EXCLUDE } from "../_shared/tracking-layout.js";
import { fmtSlashMDY } from "../_shared/mailto.js";

export const meta = {
  id: "Vet-Pet Daily Shipment Report",
  title: "Vet-Pet Daily Shipment Report",
  category: "Client Reports",
  script: "Client Reports/Vet-Pet Daily Shipment Report.js",
};

export async function loadGui(parent, ctx) {
  mountTrackingDailyReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Customer-specific daily shipment tracking report for Vet-Pet (Custom Vet and Complete Pet).
Processes daily tracking reports from TMS, filters and formats the data to highlight
today's expected deliveries and late shipments, then generates a formatted Excel report
ready for email distribution.

Workflow:
1. Download a daily Tracking Report for your client in TMS.
2. Run by today's date for Exp Delivery Date in both from and to and download.
3. Run for both Custom Vet and Complete Pet clients.
4. Use the Email button to automatically populate your email client with all recipients.
   The report will be sent to the Complete Pet team and CC'd to the appropriate Dalko sales team.
5. Attach the generated Excel report before sending.`,
    excludeStatuses: VETPET_EXCLUDE,
    highlight: true,
    filename: ({ today, fmtMDY }) => `Daily Shipments for ${fmtMDY(today)}.xlsx`,
    sheetName: ({ today, fmtMDY }) => `Daily Shipments for ${fmtMDY(today)}`,
    emailDraft: () => {
      const today = fmtSlashMDY(new Date(), "-");
      return {
        to: "Carlosbencomo@complete-pet.com;xiomaragonzalez@complete-pet.com;josmargaleano@complete-pet.com;anzulymarquez@complete-pet.com;NelsonLopez@complete-pet.com;doraliaacosta@complete-pet.com;salomongonzalez@complete-pet.com",
        cc: "Raul.Pacheco@shipdalko.com;Joseph.Pacheco@shipdalko.com;Alexis.Johnson@shipdalko.com",
        subject: `Daily Shipment Report for ${today}`,
        body: "Attached is today's Daily Shipment Report.\n\nPlease let us know if you have any questions.",
      };
    },
  });
}
