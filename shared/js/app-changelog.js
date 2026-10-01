/**
 * One change log and one version series for the merged dashboard.
 * Insights and Glass Box stay the source files; this module weaves them
 * and renumbers every release as 1.0.0, 1.1.0, 1.2.0, …
 */

/** @typedef {{ product: string, productId: "shell" | "insights" | "tools", version: string, sourceVersion?: string, items: string[] }} LogRelease */

export const SHELL_RELEASES = [
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
 * Newest-first zip, then one 1.x.0 number from oldest → newest.
 * @param {LogRelease[]} newestFirst
 * @returns {LogRelease[]}
 */
function assignSeries(newestFirst) {
  const oldestFirst = [...newestFirst].reverse();
  return oldestFirst
    .map((block, index) => ({
      ...block,
      sourceVersion: block.version || undefined,
      version: `1.${index}.0`,
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
