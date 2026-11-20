/**
 * One change log and one version series for the merged dashboard.
 * Insights and Glass Box stay the source files; this module weaves them
 * and renumbers every release as 1.0, 1.1, 1.2, …
 */

/** @typedef {{ product: string, productId: "shell" | "insights" | "tools", version: string, sourceVersion?: string, items: string[] }} LogRelease */

export const SHELL_RELEASES = [
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Report and tool tiles are square. They wrap onto the next line instead of stretching wide.",
      "Oceanic Night draws a neon trim around each report and tool tile, and the title uses that same color. Opening the board again picks new colors.",
      "The left navigation item for the dump analyzer is named Data Dump Analyzer.",
      "The console moved out of the sidebar into Settings, under Troubleshooting. Theme scenes sit in that sidebar spot.",
      "Hallowed Night is a harvest moon over a hillside manor. A ghost rises from the graves and looks toward the pointer.",
      "Yule Night is a snowbound village under a teal sky. A sleigh pulled by four reindeer crosses about once an hour.",
      "Dropping a file on a report stays on that report. The page no longer also opens the file in DALKO Insights, which was showing a missing-columns error.",
      "Permissions is a user list. Edit a person to choose their group, then the pages and functions they can open.",
      "Each section has Pop ups and buttons. A person can open a page with Run, Send, Export, or Delete left off.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Oceanic Night is a new dynamic theme. Above the console, the shore runs a day and night cycle: daylight gives way to a dark sky and city lights. Palms stand on the skyline, and a bird soars past now and then.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Integrations checks DALKO CRM at mycrm.shipdalko.com/api/health every 60 seconds. The tile shows Running only when that check returns ok, and Offline when the CRM does not.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Phinia Shipment Upload has a Default Carrier dropdown. It starts blank, which leaves the output Carrier column blank. Choosing R&L CARRIERS fills every row for Run and Save Locally and Run and Send To TMS.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Marmon Monthly prices LTL freight and fuel from each carrier's percent. Dynamic carriers (XPO, ABF, Averitt, and SAIA) pass our charge through, so those dollars are in our cost and in the market and their exposure is 0. Truckload still uses DAT.",
      "Each Full Data Dump line is priced in one place. Truckload uses Dat Freight and Dat Fuel. LTL uses LTL Market Freight and LTL Market Fuel.",
      "The About popup lists every freight and fuel percent and explains the comparison. A blank fuel percent stays blank.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Marmon Monthly writes both TL sheets, both LTL sheets, and Full Data Dump. LTL shipments stay off DAT. The markup list shows each carrier's freight and fuel percent.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Sandy Shore is a dashboard theme with a sand and lagoon palette.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Client reports share one How To and a tighter three-tile board. Excel Trimmer lists columns in sheet order and can search them.",
      "How To is Report Type, Report Date, Time Frame, and Clients. The tiles read 1) How To Run, 2) Upload, and 3) Run Report. The title bar is a short row.",
      "Run stays in place and reads Running. Customer drafts say Email External. DALKO-only drafts say Email Internal.",
      "Report CC drafts leave out Alexis Johnson. The Vet-Pet file is named Vet-Pet Daily Shipments with the report date.",
      "McConway Email External leaves out William Flemming and Janet Kastan.",
      "Excel Trimmer starts with nothing checked, filters with search and Show Checked Only, and loads the Glass Box presets. Total Receivable Amount can be renamed to FREIGHT SPEND.",
      "Signal Green is a theme. Client report tiles sit five across. TTX On Time is due the 2nd Wednesday.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Client Reports: TTX Accessorial Report builds Jacksonville, Joliet, Mira Loma, N Augusta, All Locations Combined, Liftgate Loads, Accessorial Ratio, and a Data Tab from a TMS dump. The Data Tab includes each sell accessorial name and cost.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Phinia Weekly fills Earliest Requested Delivery Date from the expected delivery columns. When those are blank, it uses Actual Delivery Date.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "TMS data dumps can now include OPERATING CARRIER in front of each sell charge. Old dumps and the new layout both still run.",
      "Phinia Weekly, Maddox Monthly, UTLXA Monthly, and Miraclon and Bruss Monthly read the accessorial description from the ACCESSORIALn column beside SELL ACCESSORIAL. The extra carrier column no longer shifts that description.",
      "Insights accessorials still pair each description with its buy or sell charge. Sell amounts are counted on the new dump instead of being skipped.",
      "Reports that already match dump columns by header name are unchanged.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "File transfer lists each FTP service on its own. The health check logs in to that service instead of marking the whole rack healthy.",
      "Run and Save downloads the weekly DAT workbook. Run and Send hands that same file to the DATs FTP connection on the rack.",
      "With Send to DAT off, the rack keeps the file in client uploads/dat. With it on, the rack uploads the file.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Insights and Glass Box stay one dashboard. Microsoft sign-in (@shipdalko.com) opens the desk on Today.",
      "Permissions lists groups and people from the Dalko directory, with first and last names. New people start in Everything no FTP. Admin can always open Permissions.",
      "Themes: Harbor and Daybreak for daylight, night palettes (Midnight Gold, Ocean Steel, Night Void, Forest Pine, Ember Forge, Graphite Lime, Slate Coral), plus Hallowed Night and Yule Night.",
      "Integrations covers Microsoft Entra / Graph, DAT RateView, and FMCSA QCMobile, each with a live health check.",
      "FTP Rack stays its own office service on DELTA. A local build can open it from Integrations, and Client Uploads can hand a finished file to the rack.",
      "Focuses is a check tree. A parent checks every value under it, the name goes bold when something there is selected, and a combination that matches nothing stays on and shows 0.",
      "Today shows the latest change log note, news, a calendar, and the to-do. The bright calendar draws a light grid around each day.",
    ],
  },
  {
    product: "Dashboard",
    productId: "shell",
    version: "",
    items: [
      "Combined Insights and Glass Box into one corporate dashboard.",
      "Settings is a parent with Change log, Integrations, and Themes, on a single 1.x version series.",
      "Harbor is the light dashboard default. Night palettes restyle this shell, not only the live hub.",
      "DAT RateView is the first Rating API on Integrations, with a sister-style connection catalog.",
      "Integrations also catalogs Microsoft Entra / Graph, Currency Converter, and Zip Calculator for later.",
      "Every Integrations connection shows a live health pill and is tested when the page loads.",
      "Carrier Search is a left-menu tool for FMCSA QCMobile (name, USDOT, or MC). The web key stays on the site server.",
      "The site, DAT RateView, and FMCSA QCMobile run from one local server on port 8080.",
      "Zip Calculator is a full-canvas lane: origin and destination, then straight-line and truck miles.",
      "Carrier Search uses the same full-canvas bands: how to use, the lookup, then matches and the snapshot.",
      "A live connection shows one pulsing status, including the Carrier Search footer and Integrations health.",
      "Carrier Search is a full-canvas lookup — centered search, then match list and dossier.",
      "The merged dashboard opens on Today: due reports, then Look up or Insights.",
      "Insights is one sidebar item. The main canvas becomes Insights, including the dump upload. The example dump is not auto-loaded.",
    ],
  },
];

/**
 * @param {string} text
 * @returns {{ version: string, items: string[] }[]}
 */
export function parseChangelog(text) {
  /** @type {{ version: string, items: string[] }[]} */
  const blocks = [];
  let current = /** @type {{ version: string, items: string[] } | null} */ (null);
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const ver = line.match(/^Version\s+(.+)\s*$/i);
    if (ver) {
      current = { version: ver[1].trim(), items: [] };
      blocks.push(current);
      continue;
    }
    const item = line.match(/^\s*[-•]\s+(.*)$/);
    if (item && current) current.items.push(item[1].trim());
  }
  return blocks;
}

/**
 * @param {string} product
 * @param {"shell" | "insights" | "tools"} productId
 * @param {string} text
 * @returns {LogRelease[]}
 */
function tagged(product, productId, text) {
  return parseChangelog(text).map((block) => ({
    product,
    productId,
    version: block.version,
    items: block.items,
  }));
}

/**
 * Newest-first zip, then one 1.x number from oldest → newest.
 * @param {LogRelease[]} newestFirst
 * @returns {LogRelease[]}
 */
function assignSeries(newestFirst) {
  const oldestFirst = [...newestFirst].reverse();
  return oldestFirst
    .map((block, index) => ({
      ...block,
      sourceVersion: block.version || undefined,
      version: `1.${index}`,
    }))
    .reverse();
}

/**
 * @param {string} insightsText
 * @param {string} toolsText
 * @returns {LogRelease[]}
 */
export function mergeChangelogs(insightsText, toolsText) {
  const insights = tagged("Insights", "insights", insightsText);
  const tools = tagged("Glass Box", "tools", toolsText);
  /** @type {LogRelease[]} */
  const merged = [...SHELL_RELEASES];
  const max = Math.max(insights.length, tools.length);
  for (let i = 0; i < max; i += 1) {
    if (insights[i]) merged.push(insights[i]);
    if (tools[i]) merged.push(tools[i]);
  }
  return assignSeries(merged);
}

/**
 * @param {LogRelease[]} releases
 * @param {string} query
 * @returns {LogRelease[]}
 */
export function filterReleases(releases, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return releases;
  return releases
    .map((block) => ({
      ...block,
      items: block.items.filter((item) =>
        `${block.product} ${block.version} ${block.sourceVersion ?? ""} ${item}`.toLowerCase().includes(q)
      ),
    }))
    .filter(
      (block) =>
        block.product.toLowerCase().includes(q) ||
        block.version.toLowerCase().includes(q) ||
        String(block.sourceVersion ?? "").toLowerCase().includes(q) ||
        block.items.length
    );
}
