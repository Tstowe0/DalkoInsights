/** @typedef {{ id: string, label: string, script: string, subtitle?: string, disabled?: boolean, skipped?: boolean, skipReason?: string }} GlassTool */
/** @typedef {{ id: string, label: string, tools: GlassTool[] }} GlassSection */
/** @typedef {{ id: string, label: string, tools: GlassTool[] }} ReportBand */

/** Tools that cannot run as a pure website (desktop/native only). */
export const SKIPPED_TOOLS = {};

/** @type {Record<string, string>} */
export const TOOL_SUBTITLES = {
  "Guardian Shipment Upload": "Under Construction",
  "Miraclon and Bruss Monthly": "15th of the Month",
  "Maddox Monthly": "2nd Tuesday of the Month",
  "UTLXA Monthly": "1st of the Month",
  "Carrier On Time Merger": "2nd Wednesday of the Month",
};

/** Tools locked in the UI (visible but not launchable). */
export const LOCKED_TOOLS = {
  "Guardian Shipment Upload": "Under Construction",
};

/**
 * @param {string} scriptPath
 * @returns {GlassTool}
 */
function makeTool(scriptPath) {
  const label = scriptPath.split("/").pop()?.replace(/\.js$/i, "") ?? scriptPath;
  /** @type {GlassTool} */
  const tool = { id: label, label, script: scriptPath };
  const skipReason = SKIPPED_TOOLS[label];
  if (skipReason) {
    tool.skipped = true;
    tool.skipReason = skipReason;
    tool.subtitle = "Skipped — desktop only";
  } else {
    const subtitle = TOOL_SUBTITLES[label];
    if (subtitle) tool.subtitle = subtitle;
  }
  if (LOCKED_TOOLS[label]) {
    tool.disabled = true;
    tool.subtitle = LOCKED_TOOLS[label];
  }
  return tool;
}

/** @type {GlassSection[]} */
export const SECTIONS = [
  {
    id: "accounting",
    label: "Accounting",
    tools: [makeTool("Accounting/AP-AR Lookup.js")],
  },
  {
    id: "tracking",
    label: "Tracking Apps",
    tools: [
      makeTool("Tracking Apps/Tracking Report.js"),
      makeTool("Tracking Apps/Phinia Load Matcher.js"),
    ],
  },
  {
    id: "ops",
    label: "Ops Apps",
    tools: [
      makeTool("Data Dept. Apps/Ops Apps/Maddox Carrier Email.js"),
      makeTool("Data Dept. Apps/Ops Apps/A. Stucki Carrier Email.js"),
    ],
  },
  {
    id: "data-tools",
    label: "Data Tools",
    tools: [
      makeTool("Data Tools/Batch Mapper.js"),
      makeTool("Data Tools/Currency Converter.js"),
      makeTool("Data Tools/Value Standardizer.js"),
      makeTool("Data Tools/Data Dump Merger.js"),
      makeTool("Data Tools/Email Grouper.js"),
      makeTool("Data Tools/Excel Theme Painter.js"),
      makeTool("Data Tools/Excel Trimmer.js"),
      makeTool("Data Tools/RLCA Matrix Parser.js"),
      makeTool("Data Tools/Shipment Consolidator.js"),
      makeTool("Data Tools/Zip Calculator.js"),
    ],
  },
  {
    id: "client-uploads",
    label: "Client Uploads",
    tools: [
      makeTool("Client Uploads/Phinia Shipment Upload.js"),
      makeTool("Client Uploads/Phinia Operational Report.js"),
      makeTool("Client Uploads/Guardian Shipment Upload.js"),
    ],
  },
];

/** @type {ReportBand[]} */
export const CLIENT_REPORT_BANDS = [
  {
    id: "daily",
    label: "Daily",
    tools: [
      makeTool("Client Reports/McConway Daily Tracking Report.js"),
      makeTool("Client Reports/Vet-Pet Daily Shipment Report.js"),
    ],
  },
  {
    id: "monday",
    label: "Monday",
    tools: [
      makeTool("Client Reports/Phinia Weekly.js"),
      makeTool("Client Reports/Quality Turbocharger Weekly.js"),
    ],
  },
  {
    id: "thursday",
    label: "Thursday",
    tools: [makeTool("Client Reports/DATs Weekly.js")],
  },
  {
    id: "friday",
    label: "Friday",
    tools: [
      makeTool("Client Reports/Kansas Canadian Pacific Weekly.js"),
      makeTool("Client Reports/FCA Active Shipments.js"),
    ],
  },
  {
    id: "monthly",
    label: "Monthly",
    tools: [
      makeTool("Client Reports/UTLXA Monthly.js"),
      makeTool("Client Reports/Maddox Monthly.js"),
      makeTool("Client Reports/Miraclon and Bruss Monthly.js"),
      makeTool("Client Reports/Carrier On Time Merger.js"),
    ],
  },
];

/** @type {{ id: string, label: string, kind: "home" | "section" | "reports" | "changelog" | "themes" | "console" }[]} */
export const NAV_ITEMS = [
  { id: "home", label: "Home", kind: "home" },
  { id: "accounting", label: "Accounting", kind: "section" },
  { id: "tracking", label: "Tracking Apps", kind: "section" },
  { id: "ops", label: "Ops Apps", kind: "section" },
  { id: "data-tools", label: "Data Tools", kind: "section" },
  { id: "client-reports", label: "Client Reports", kind: "reports" },
  { id: "client-uploads", label: "Client Uploads", kind: "section" },
  { id: "changelog", label: "Change Log", kind: "changelog" },
  { id: "themes", label: "Themes", kind: "themes" },
  { id: "console", label: "Console", kind: "console" },
];

/** @param {string} sectionId */
export function getSection(sectionId) {
  return SECTIONS.find((s) => s.id === sectionId) ?? null;
}

/** @param {string} toolId */
export function findTool(toolId) {
  for (const section of SECTIONS) {
    const hit = section.tools.find((t) => t.id === toolId);
    if (hit) return hit;
  }
  for (const band of CLIENT_REPORT_BANDS) {
    const hit = band.tools.find((t) => t.id === toolId);
    if (hit) return hit;
  }
  return null;
}
