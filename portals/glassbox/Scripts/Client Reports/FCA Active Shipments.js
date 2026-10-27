import { mountTrackingDailyReport } from "../_shared/client-reports.js?v=20261027-titlebar";
import { FCA_EXCLUDE } from "../_shared/tracking-layout.js";
import { fmtSlashMDY } from "../_shared/mailto.js";

export const meta = {
  id: "FCA Active Shipments",
  title: "FCA Active Shipments",
  category: "Client Reports",
  script: "Client Reports/FCA Active Shipments.js",
};

export async function loadGui(parent, ctx) {
  mountTrackingDailyReport(parent, ctx, {
    title: meta.title,
    category: meta.category,
    instructions: `Concept:
Creates an FCA Active Shipments report from the TMS daily Tracking Report. It keeps
only active LTL shipments (non-LTL and completed/quote statuses are removed) and
outputs a formatted Excel file for emailing.

Workflow:
1. Download a daily Tracking Report for Freightcar America Inc in TMS.
2. Run by today's date for Exp Delivery Date going back 1 month exactly. If today is January 23, 2026, run for Dec 23, 2025.
3. Use Email External to automatically populate your email client with all recipients.
4. Attach the generated Excel report before sending.`,
    howto: {
      type: "Tracking Report",
      date: "Exp Delivery Date",
      time: "Today back 1 month",
      clients: "Freightcar America Inc",
    },
    excludeStatuses: FCA_EXCLUDE,
    ltlExact: true,
    dropPickupAndClient: true,
    highlight: false,
    filename: ({ today, fmtMDY }) => `FCA Active Shipments as of ${fmtMDY(today)}.xlsx`,
    sheetName: ({ today, fmtMDY }) => `FCA Active ${fmtMDY(today)}`,
    emailDraft: () => {
      const today = fmtSlashMDY(new Date(), "-");
      return {
        label: "Email External",
        to: "TKillinger@freightcar.net",
        cc: "Mike.Nicula@shipdalko.com",
        subject: `FCA Active Shipments as of ${today}`,
        body: "Attached is the FCA Active Shipments Report.\n\nPlease let us know if you have any questions.",
      };
    },
  });
}
