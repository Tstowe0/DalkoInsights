/**
 * Merged shell: live Insights engine + live Glass Box tools + freight home.
 */

import {
  applyInsightsDateFilter,
  clearInsightsData,
  getInsightsSnapshot,
  handleInsightsFile,
  initDalkoPortal,
  setInsightsView,
  setEmbeddedInsightHide,
} from "../../portals/dalko/js/app.js?v=20261001-loadsinside";
import { NAV_ITEMS as INSIGHT_NAV } from "../../portals/dalko/js/ui/nav.js?v=20260923-desk";
import { CHANGELOG_TEXT } from "../../portals/dalko/js/changelog.js?v=20260918-home";
import { THEMES, getThemeId, initTheme, setTheme } from "./theme.js?v=20261001-daybreak";
import { filterReleases, mergeChangelogs } from "./app-changelog.js?v=20261001-log185";
import { getValue, parseCellDate, safeFloat } from "../../portals/dalko/js/data/context.js";
import { getFilteredRows } from "../../portals/dalko/js/data/filters.js?v=20260916-bugsweep";
import { rowMatchesAccessorialType } from "../../portals/dalko/js/analytics/accessorials.js?v=20261001-accfocus";
import { fmtInt, fmtMoney, fmtPct } from "../../portals/dalko/js/ui/format.js";
import { NAV_ITEMS as GB_NAV, findTool } from "../../portals/glassbox/js/catalog.js?v=20260930-demo";
import { launchTool } from "../../portals/glassbox/js/tool-loader.js?v=20260819-fxsweep";
import { renderClientReports, renderSection, renderThemes } from "../../portals/glassbox/js/views.js?v=20260930-demo";
import { mountSidebarCalendar } from "../../portals/glassbox/js/calendar.js?v=20260923-holiday";
import { mountSidebarTodo } from "../../portals/glassbox/js/todo.js?v=20260923-sweep";
import {
  canRevealDatSecrets,
  getAccessToken,
  getAccount,
  getDisplayName,
  getEmail,
  getGreetingName,
  getInitials,
  consumeAuthError,
  initAuth,
  isAuthConfigured,
  signInPopup,
  signOut,
} from "./auth.js?v=20261001-splash";
import { AUTH_ALLOWED_DOMAIN, AUTH_CLIENT_ID, AUTH_TENANT_ID } from "./auth-config.js?v=20260915-app3";
import { fetchRack, RACK_ORIGIN } from "./ftp-rack.js?v=20261002-ftpback";
import {
  allowsMenu,
  allowsTool,
  bindPermissionsPage,
  hiddenInsightPages,
  loadDalkoDirectory,
  renderPermissionsPage,
} from "./permissions.js?v=20261001-permnames";

const DATE_COLS = ["INVOICE DATE", "ACTUAL SHIP DATE", "ACTUAL DELIVERY DATE", "EXPECTED SHIP DATE"];
const NEWS_FEEDS = [
  "freight+OR+trucking+OR+logistics+shipping",
  "%22ocean+freight%22+OR+%22container+shipping%22+OR+%22port+congestion%22",
  "%22supply+chain%22+OR+rail+OR+%22air+cargo%22+transportation",
];

const INSIGHT_IDS = new Set(
  INSIGHT_NAV.filter((n) => n.id !== "home" && n.id !== "changelog").map((n) => n.id)
);
const TOOL_IDS = new Set(
  GB_NAV.filter(
    (n) => n.kind !== "home" && n.kind !== "console" && n.id !== "changelog" && n.id !== "themes"
  ).map((n) => n.id)
);

const LOOKUP_TOOLS = {
  "carrier-search": "Carrier Search",
  "zip-calculator": "Zip Calculator",
  "currency-converter": "Currency Converter",
};

const GROUP_FOR = {
  home: null,
  insights: null,
  "client-reports": null,
};
for (const id of TOOL_IDS) GROUP_FOR[id] = "tools";
GROUP_FOR["client-reports"] = null;
GROUP_FOR["client-uploads"] = null;
GROUP_FOR["zip-calculator"] = "tools";
GROUP_FOR["currency-converter"] = "tools";
GROUP_FOR.changelog = "settings";
GROUP_FOR.integrations = "settings";
GROUP_FOR["integrations-dat"] = "settings";
GROUP_FOR["integrations-entra"] = "settings";
GROUP_FOR["integrations-currency"] = "settings";
GROUP_FOR["integrations-zip"] = "settings";
GROUP_FOR["integrations-fmcsa"] = "settings";
GROUP_FOR["integrations-ftp"] = "settings";
GROUP_FOR.themes = "settings";
GROUP_FOR.permissions = "settings";

const TITLES = {
  home: "Today",
  insights: "DALKO Insights",
  reports: "Executive analytics",
  "zip-calculator": "Zip Calculator",
  "currency-converter": "Currency Converter",
  changelog: "Change log",
  integrations: "Integrations",
  "integrations-dat": "DAT RateView API",
  "integrations-entra": "Microsoft Entra / Graph",
  "integrations-currency": "Currency Converter",
  "integrations-zip": "Zip Calculator",
  "integrations-fmcsa": "FMCSA QCMobile",
  "integrations-ftp": "FTP Rack",
  themes: "Themes",
  permissions: "Permissions",
};
for (const item of INSIGHT_NAV) {
  if (item.id === "home" || item.id === "changelog") continue;
  TITLES[item.id] = item.label;
}
for (const item of GB_NAV) {
  if (item.id === "home" || item.id === "console" || item.id === "changelog") continue;
  TITLES[item.id] = item.label;
}

/** @type {string} */
let shellView = "home";
/** Inner Insights page while the DALKO sidebar stays on Insights. */
let insightsPage = "home";
/** @type {string} */
let range = "all";
/** Active date window. Null ends mean the full file. */
let activeWindow = { start: /** @type {Date | null} */ (null), end: /** @type {Date | null} */ (null) };
/** @type {string} */
let toolReturn = "data-tools";
/** @type {object[]} */
let newsItems = [];
/** @type {string} */
let gbChangelog = "";
/** After Clear data, don't put the example dump back on the next Insights visit. */
let suppressExample = false;

const els = {
  home: () => document.getElementById("home-root"),
  insights: () => document.getElementById("insights-host"),
  tools: () => document.getElementById("tools-host"),
  settings: () => document.getElementById("settings-root"),
  workspace: () => document.getElementById("gb-workspace"),
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function snap() {
  return getInsightsSnapshot();
}

function pickColumn(maps) {
  if (!maps) return DATE_COLS[0];
  for (const name of DATE_COLS) {
    if (maps.index[name] != null || maps.upperMap[name.toUpperCase()] != null) return name;
  }
  return DATE_COLS[0];
}

function firstVal(row, maps, names) {
  if (!maps) return null;
  for (const name of names) {
    const v = getValue(row, name, maps);
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

function fmtWhen(value) {
  const d = parseCellDate(value);
  if (!d) return value ? String(value) : "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function latestDataDate() {
  const { rows, maps } = snap();
  if (!maps) return null;
  const col = pickColumn(maps);
  let max = /** @type {Date | null} */ (null);
  for (const row of rows) {
    const d = parseCellDate(getValue(row, col, maps));
    if (d && (!max || d > max)) max = d;
  }
  return max;
}

function applyRange() {
  const { maps } = snap();
  const column = pickColumn(maps);
  if (range === "all" || !maps) {
    activeWindow = { start: null, end: null };
    applyInsightsDateFilter({ enabled: false, start: null, end: null, column });
    return;
  }
  const end = latestDataDate() ?? new Date();
  const start = new Date(end);
  if (range === "7") start.setDate(end.getDate() - 6);
  else if (range === "30") start.setDate(end.getDate() - 29);
  else if (range === "90") start.setDate(end.getDate() - 89);
  else start.setMonth(0, 1);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  activeWindow = { start: new Date(start), end: new Date(end) };
  applyInsightsDateFilter({ enabled: true, start, end, column });
}

function formatWindowDay(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function analysisRows() {
  const { rows, maps, headers, filters } = snap();
  if (!maps) return [];
  return getFilteredRows(rows, maps, filters, (row, value) =>
    rowMatchesAccessorialType(row, headers, maps, value)
  );
}

const NEWS_FALLBACK = [
  { title: "Ocean rates, capacity, and port congestion", link: "https://www.freightwaves.com/", source: "FreightWaves", date: "" },
  { title: "Global freight and logistics coverage", link: "https://www.joc.com/", source: "Journal of Commerce", date: "" },
  { title: "Trucking, rail, and supply chain", link: "https://www.ttnews.com/", source: "Transport Topics", date: "" },
  { title: "International shipping and trade", link: "https://www.lloydslist.com/", source: "Lloyd’s List", date: "" },
  { title: "Air cargo and express networks", link: "https://www.aircargonews.net/", source: "Air Cargo News", date: "" },
  { title: "Ports, hinterland, and maritime operations", link: "https://www.joc.com/maritime-news", source: "JOC Maritime", date: "" },
];

function googleNewsRss(query) {
  return `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
}

async function fetchNewsFeed(query) {
  const rss = googleNewsRss(query);
  const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rss)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((item) => {
    const rawTitle = String(item.title ?? "").trim();
    const parts = rawTitle.split(" - ");
    const sourceFromTitle = parts.length > 1 ? parts.pop() : "";
    return {
      title: parts.join(" - ") || rawTitle,
      link: String(item.link ?? item.url ?? ""),
      source: String(item.author || item.source || sourceFromTitle || "Google News"),
      date: item.pubDate ? fmtWhen(item.pubDate) : "",
      stamp: item.pubDate ? Date.parse(item.pubDate) : 0,
    };
  }).filter((n) => n.title && n.link);
}

async function loadNews() {
  try {
    const batches = await Promise.allSettled(NEWS_FEEDS.map((q) => fetchNewsFeed(q)));
    const seen = new Set();
    const merged = [];
    for (const batch of batches) {
      if (batch.status !== "fulfilled") continue;
      for (const item of batch.value) {
        const key = item.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
    }
    merged.sort((a, b) => (b.stamp || 0) - (a.stamp || 0));
    newsItems = merged.slice(0, 12);
    if (!newsItems.length) newsItems = NEWS_FALLBACK;
  } catch {
    newsItems = NEWS_FALLBACK;
  }
  if (shellView === "home") paintHome();
}

function newsCard(query, dayLabel) {
  const rows = (newsItems.length ? newsItems : NEWS_FALLBACK).filter((n) => {
    if (!query) return true;
    return `${n.title} ${n.source}`.toLowerCase().includes(query);
  });
  const live = newsItems.length > 0 && newsItems[0].date;
  return `
    <section class="card news-card news-card--band">
      <div class="card-head">
        <div>
          <h2>${esc(dayLabel)}</h2>
          <p class="card-sub">${live ? "World freight desk — live headlines from shipping, trucking, rail, and trade." : "World freight desk — connect to load live headlines."}</p>
        </div>
        <a class="linkish" href="https://news.google.com/search?q=freight%20logistics%20shipping%20trucking" target="_blank" rel="noopener">More →</a>
      </div>
      <ul class="news-list">
        ${
          rows
            .map(
              (n) => `
          <li>
            <a href="${esc(n.link)}" target="_blank" rel="noopener">
              <strong>${esc(n.title)}</strong>
              <small>${esc([n.source, n.date].filter(Boolean).join(" · "))}</small>
            </a>
          </li>`
            )
            .join("") || `<li class="muted">No headlines match that search.</li>`
        }
      </ul>
    </section>`;
}

function mergedReleases(query) {
  return filterReleases(mergeChangelogs(CHANGELOG_TEXT, gbChangelog), query);
}

function logArticlesHtml(releases) {
  if (!releases.length) {
    return `<p class="muted">No change log entries match that search.</p>`;
  }
  return releases
    .map(
      (block) => `
        <article class="log-ver">
          <div class="log-ver-head">
            <h3>${esc(block.version)}</h3>
            <span class="log-product log-product-${esc(block.productId)}">${esc(block.product)}</span>
          </div>
          <ul>${block.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
        </article>`
    )
    .join("");
}

async function loadGbChangelog() {
  if (gbChangelog) return gbChangelog;
  try {
    const res = await fetch("portals/glassbox/ChangeLog.txt?v=20260922");
    gbChangelog = res.ok ? await res.text() : "Could not load ChangeLog.txt.";
  } catch {
    gbChangelog = "Could not load ChangeLog.txt.";
  }
  if (shellView === "home") paintHome();
  if (shellView === "changelog") paintSettings();
  return gbChangelog;
}

function changelogCard(query) {
  const body = logArticlesHtml(mergedReleases(query).slice(0, 1));
  return `
    <section class="card log-card">
      <div class="card-head">
        <div>
          <h2>Change log</h2>
        </div>
        <button type="button" class="linkish" data-view="changelog">View full log →</button>
      </div>
      <div class="log-scroll">${body}</div>
    </section>`;
}

function deskDay() {
  if (!selectedTodoDay) return new Date();
  const parts = selectedTodoDay.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return new Date();
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function renderHomeHtml() {
  const q = String(document.getElementById("table-search")?.value ?? "").trim().toLowerCase();
  const dayLabel = deskDay().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return `
    <div class="page-canvas today-desk">
      <div class="today-news-row">
        ${newsCard(q, dayLabel)}
        <section class="card today-cal-card" aria-label="Calendar">
          <div class="today-cal" id="today-calendar"></div>
        </section>
      </div>
      <div class="today-board">
        ${changelogCard(q)}
        <section class="card todo-card" aria-label="To do list">
          <div class="home-todo" id="home-todo"></div>
        </section>
      </div>
    </div>`;
}

function renderChangelogHtml() {
  return `
    <div class="page-canvas">
      <header class="hero">
        <h1>Change log</h1>
      </header>
      <section class="card log-card log-card-full">
        <div class="log-grid">${logArticlesHtml(mergedReleases())}</div>
      </section>
    </div>`;
}

const INTEG_LINK_ICO = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M14 10a5 5 0 0 0-7.07 0L4.81 12.12a5 5 0 0 0 7.07 7.07L13 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const EYE_ICO = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.7"/></svg>`;
const EYE_OFF_ICO = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9.9 5.6A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.1 3.5M6.6 7.7C4.2 9.4 2.5 12 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.6-.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9.6 9.8A2.6 2.6 0 0 0 12 14.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const DAT_SECRET_MASK = "••••••••";

function integStatusPill(id, label = "Checking", kind = "testing") {
  const cls =
    kind === "healthy" ? "is-on is-live" : kind === "failed" ? "is-err" : kind === "testing" ? "is-wait" : "is-setup";
  return `<span class="integ-pill ${cls}" data-integ-status="${id}"><i></i>${label}</span>`;
}

function integTile(id, title, blurb) {
  return `
    <button type="button" class="integ-tile" data-integ="${id}">
      <span class="integ-ico">${INTEG_LINK_ICO}</span>
      <span class="integ-tile-copy">
        <strong>${title}</strong>
        <small>${blurb}</small>
      </span>
      ${integStatusPill(id)}
      <span class="integ-chevron" aria-hidden="true">›</span>
    </button>`;
}

function renderIntegrationsHtml() {
  return `
    <div class="page-canvas integ-page">
      <header class="integ-head">
        <h1>Integrations</h1>
      </header>

      <section class="integ-section">
        <h2>Identity</h2>
        <div class="integ-grid">
          ${integTile("entra", "Microsoft Entra / Graph", "Dalko sign-in. Also confirms who may reveal DAT secrets.")}
        </div>
      </section>

      <section class="integ-section">
        <h2>Rating APIs</h2>
        <div class="integ-grid">
          ${integTile("dat", "DAT RateView API", "Partner ID, staging credentials, and authentication test")}
        </div>
      </section>

      <section class="integ-section">
        <h2>Carrier safety</h2>
        <div class="integ-grid">
          ${integTile("fmcsa", "FMCSA QCMobile", "USDOT / MC / name lookup. Web key stays on the office rack.")}
        </div>
      </section>

      ${
        allowsMenu("integrations-ftp")
          ? `<section class="integ-section">
        <h2>File transfer</h2>
        <div class="integ-grid">
          ${integTile("ftp", "FTP Rack", "DELTA takes a finished file and FTPs it into the TMS.")}
        </div>
      </section>`
          : ""
      }

      <section class="integ-section">
        <h2>Public data</h2>
        <div class="integ-grid">
          ${integTile("currency", "Currency Converter", "Live FX rates from open.er-api.com — no Dalko account")}
          ${integTile("zip", "Zip Calculator", "City / state lookup from Zippopotam — no Dalko account")}
        </div>
      </section>
    </div>`;
}

/**
 * @param {{ id: string, title: string, lead: string, pill: string, pillOn?: boolean, rows: { label: string, value: string }[], usedBy: string, note: string }} spec
 */
function renderIntegRefHtml(spec) {
  const rows = spec.rows
    .map((row) => `<div><dt>${esc(row.label)}</dt><dd>${esc(row.value)}</dd></div>`)
    .join("");
  return `
    <div class="page-canvas integ-page">
      <header class="integ-head">
        <button type="button" class="integ-back" id="integ-back">
          <span aria-hidden="true">←</span> Back
        </button>
        <div class="integ-detail-top">
          <div>
            <h1>${esc(spec.title)}</h1>
            <p>${esc(spec.lead)}</p>
          </div>
          ${integStatusPill(spec.id)}
        </div>
      </header>
      <div class="integ-bolts">
        <section class="integ-detail">
          <h2>Health</h2>
          <p id="${esc(spec.id)}-health">Checking this connection…</p>
        </section>
        <section class="integ-detail">
          <h2>Connection</h2>
          <dl class="integ-meta">${rows}</dl>
        </section>
        <section class="integ-detail">
          <h2>Used by</h2>
          <p>${esc(spec.usedBy)}</p>
        </section>
        <section class="integ-detail">
          <h2>Notes</h2>
          <p>${esc(spec.note)}</p>
        </section>
      </div>
    </div>`;
}

function renderEntraHtml() {
  const signedIn = Boolean(getAccount());
  return renderIntegRefHtml({
    id: "entra",
    title: "Microsoft Entra / Graph",
    lead: "DALKO Insights SPA sign-in. Graph User.Read confirms the signed-in @shipdalko.com account.",
    pill: signedIn ? "Connected" : "Sign in",
    pillOn: signedIn,
    rows: [
      { label: "App", value: "DALKO Insights" },
      { label: "Tenant", value: AUTH_TENANT_ID },
      { label: "Client ID", value: AUTH_CLIENT_ID },
      { label: "Allowed domain", value: `@${AUTH_ALLOWED_DOMAIN}` },
      { label: "Scopes", value: "openid, profile, email, User.Read" },
      { label: "Signed in", value: signedIn ? getEmail() : "No" },
    ],
    usedBy: "Hub sign-in, merged dashboard account menu, and the DAT secrets reveal (Terry Stowe only).",
    note: "Cataloged for reference. Credentials live in Entra, not in this page.",
  });
}

function renderCurrencyHtml() {
  return renderIntegRefHtml({
    id: "currency",
    title: "Currency Converter",
    lead: "Open Exchange Rates public feed. No Dalko account or API key.",
    pill: "Public",
    pillOn: true,
    rows: [
      { label: "Provider", value: "open.er-api.com" },
      { label: "Endpoint", value: "https://open.er-api.com/v6/latest/{base}" },
      { label: "Auth", value: "None" },
    ],
    usedBy: "Glass Box → Data Tools → Currency Converter.",
    note: "Cataloged for reference. If this feed ever needs a key or a replacement, this is the tile to update.",
  });
}

function renderFtpHtml() {
  return renderIntegRefHtml({
    id: "ftp",
    title: "FTP Rack",
    lead: "DELTA accepts a finished file from this office site and FTPs it into the TMS. The FTP password stays on the server.",
    rows: [
      { label: "Rack", value: "https://delta.shipdalko.com/" },
      { label: "Phinia send", value: "POST /api/connections/phinia/send → /PHINIA" },
      { label: "Demo send", value: "POST /api/connections/demo/send → /DALKO" },
    ],
    usedBy: "Client Uploads → Demo Upload and Phinia Shipment Upload → Send to TMS.",
    note: "The rack is https://delta.shipdalko.com. A computer on the office network can reach it.",
  });
}

function renderFmcsaHtml() {
  return renderIntegRefHtml({
    id: "fmcsa",
    title: "FMCSA QCMobile",
    lead: "Free USDOT safety lookup. The web key stays on the office rack.",
    pill: "Needs setup",
    pillOn: false,
    rows: [
      { label: "Provider", value: "mobile.fmcsa.dot.gov/qc/services" },
      { label: "Rack", value: "https://delta.shipdalko.com/" },
      { label: "Lookup", value: "Name, USDOT, or MC / docket" },
      { label: "Auth", value: "FMCSA web key on the rack" },
    ],
    usedBy: "Data & Tools → Carrier Search.",
    note: "The page asks the rack at https://delta.shipdalko.com. The key stays on that machine.",
  });
}

function renderZipHtml() {
  return renderIntegRefHtml({
    id: "zip",
    title: "Zip Calculator",
    lead: "Zippopotam postal lookup. No Dalko account or API key.",
    pill: "Public",
    pillOn: true,
    rows: [
      { label: "Provider", value: "api.zippopotam.us" },
      { label: "Endpoint", value: "https://api.zippopotam.us/{country}/{postal}" },
      { label: "Auth", value: "None" },
    ],
    usedBy: "Glass Box → Data Tools → Zip Calculator.",
    note: "Cataloged for reference. City, state, and country come back from the public lookup.",
  });
}

function renderDatNutsHtml() {
  return `
    <div class="page-canvas integ-page">
      <header class="integ-head">
        <button type="button" class="integ-back" id="integ-back">
          <span aria-hidden="true">←</span> Back
        </button>
        <div class="integ-detail-top">
          <div>
            <h1>DAT RateView API</h1>
            <p>Organization token, user token, then Rate Lookup. Staging credentials stay on the office rack.</p>
          </div>
          ${integStatusPill("dat")}
        </div>
      </header>

      <div class="integ-bolts">
        <section class="integ-detail">
          <h2>Health</h2>
          <p id="dat-health">Checking this connection…</p>
        </section>
        <section class="integ-detail">
          <h2>Connection</h2>
          <dl class="integ-meta">
            <div><dt>Environment</dt><dd>staging</dd></div>
            <div><dt>Partner ID</dt><dd>001f400001M339EAAR</dd></div>
            <div><dt>DAT user</dt><dd>sscarmack@dalkoresources.com</dd></div>
          </dl>
        </section>

        <section class="integ-detail" id="dat-secrets">
          <h2>Service account</h2>
          <p id="dat-secrets-note">Username and password stay hidden until Terry Stowe signs in and reveals them.</p>
          <dl class="integ-meta integ-secrets">
            <div>
              <dt>Username</dt>
              <dd class="integ-secret-row">
                <code id="dat-secret-user">${DAT_SECRET_MASK}</code>
                <button type="button" class="integ-eye" id="dat-eye-user" hidden aria-label="Show username">${EYE_ICO}</button>
              </dd>
            </div>
            <div>
              <dt>Password</dt>
              <dd class="integ-secret-row">
                <code id="dat-secret-pass">${DAT_SECRET_MASK}</code>
                <button type="button" class="integ-eye" id="dat-eye-pass" hidden aria-label="Show password">${EYE_ICO}</button>
              </dd>
            </div>
          </dl>
        </section>

        <section class="integ-detail">
          <h2>Authentication</h2>
          <ol class="integ-steps">
            <li>
              <strong>Organization token</strong>
              <span>POST identity.api.staging.dat.com/access/v1/token/organization</span>
            </li>
            <li>
              <strong>User token</strong>
              <span>POST identity.api.staging.dat.com/access/v1/token/user with the org bearer token</span>
            </li>
            <li>
              <strong>Rate Lookup</strong>
              <span>POST analytics.api.staging.dat.com/linehaulrates/v1/lookups as a JSON array</span>
            </li>
          </ol>
        </section>

        <section class="integ-detail">
          <div class="integ-detail-top">
            <div>
              <h2>Live test</h2>
              <p>Dallas → Pittsburgh van, shipper-to-broker spot. The result shows linehaul and the average fuel surcharge.</p>
            </div>
            <button type="button" class="chip-btn chip-primary" id="dat-test">Test connection</button>
          </div>
          <div id="dat-sample">
            <p>Testing the Dallas → Pittsburgh sample lane…</p>
          </div>
        </section>
      </div>
    </div>`;
}

const DAT_PROXY = RACK_ORIGIN;

function rackUnreachable() {
  if (location.protocol === "https:" && RACK_ORIGIN.startsWith("http:")) {
    return "This site is secure, so the browser blocks an office rack that is still on HTTP.";
  }
  return "Could not reach the rack at https://delta.shipdalko.com.";
}
/** @type {{ orgUsername?: string, orgPassword?: string } | null} */
let datSecrets = null;
/** @type {{ user: boolean, pass: boolean }} */
let datSecretShown = { user: false, pass: false };

function setSecretField(kind, shown) {
  datSecretShown[kind] = shown;
  const code = document.getElementById(kind === "user" ? "dat-secret-user" : "dat-secret-pass");
  const eye = document.getElementById(kind === "user" ? "dat-eye-user" : "dat-eye-pass");
  const value = kind === "user" ? datSecrets?.orgUsername : datSecrets?.orgPassword;
  if (code) code.textContent = shown && value ? String(value) : DAT_SECRET_MASK;
  if (eye) {
    eye.innerHTML = shown ? EYE_OFF_ICO : EYE_ICO;
    eye.setAttribute("aria-label", shown ? `Hide ${kind === "user" ? "username" : "password"}` : `Show ${kind === "user" ? "username" : "password"}`);
    eye.classList.toggle("is-on", shown);
  }
}

function maskDatSecrets() {
  datSecrets = null;
  setSecretField("user", false);
  setSecretField("pass", false);
}

function paintDatSecretsGate() {
  const note = document.getElementById("dat-secrets-note");
  const userEye = document.getElementById("dat-eye-user");
  const passEye = document.getElementById("dat-eye-pass");
  if (!note || !userEye || !passEye) return;
  const allowed = Boolean(getAccount() && canRevealDatSecrets());
  userEye.hidden = !allowed;
  passEye.hidden = !allowed;
  if (!getAccount()) {
    note.textContent = "Sign in with your Dalko Microsoft account. Only Terry Stowe can reveal the service-account username and password.";
    maskDatSecrets();
    return;
  }
  if (!allowed) {
    note.textContent = `Signed in as ${getEmail()}. Only Terry Stowe can reveal these credentials.`;
    maskDatSecrets();
    return;
  }
  note.textContent = "Use the eye next to a field to show it. Microsoft confirms your identity before the rack returns the secret.";
}

async function ensureDatSecrets() {
  if (datSecrets) return datSecrets;
  const note = document.getElementById("dat-secrets-note");
  const token = await getAccessToken();
  if (!token) {
    if (note) note.textContent = "Microsoft would not issue a token. Sign in again, then retry.";
    return null;
  }
  try {
    const res = await fetch(`${DAT_PROXY}/api/dat/secrets`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (note) note.textContent = String(data.error || "Could not reveal credentials.");
      return null;
    }
    datSecrets = { orgUsername: data.orgUsername, orgPassword: data.orgPassword };
    return datSecrets;
  } catch {
    if (note) note.textContent = rackUnreachable();
    return null;
  }
}

async function toggleDatSecret(kind) {
  if (!canRevealDatSecrets()) {
    paintDatSecretsGate();
    return;
  }
  if (datSecretShown[kind]) {
    setSecretField(kind, false);
    return;
  }
  const loaded = await ensureDatSecrets();
  if (!loaded) return;
  setSecretField(kind, true);
}

function lockApp() {
  document.body.classList.remove("is-authed");
  document.getElementById("splash")?.classList.remove("hidden");
  document.querySelector(".app")?.setAttribute("aria-hidden", "true");
}

function revealApp() {
  document.body.classList.add("is-authed");
  document.getElementById("splash")?.classList.add("hidden");
  document.querySelector(".app")?.removeAttribute("aria-hidden");
}

/**
 * @param {string | null} code
 * @param {unknown} [detail]
 */
function paintSplashError(code, detail) {
  const el = document.getElementById("splash-error");
  if (!el) return;
  if (!code && !detail) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  const raw = detail instanceof Error ? detail.message : "";
  el.textContent =
    code === "AccessDenied"
      ? "Use your Dalko Microsoft account (@shipdalko.com)."
      : !isAuthConfigured()
        ? "Sign-in is not configured yet."
        : raw && /50011|redirect uri/i.test(raw)
          ? "Redirect URI mismatch. Sign in from the address registered in Entra."
          : raw
            ? `Sign-in failed. ${raw}`
            : "Sign-in failed. Try again.";
  el.classList.remove("hidden");
}

function setSplashReady(ready) {
  const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById("btn-splash-signin"));
  if (btn) btn.disabled = !ready;
}

async function bootAuth() {
  lockApp();
  setSplashReady(false);
  /** @type {unknown} */
  let bootErr = null;
  try {
    await initAuth();
  } catch (err) {
    bootErr = err;
    console.error(err);
  }
  paintSplashError(consumeAuthError(), bootErr);
  paintUserChrome();
  paintNav();
  if (shellView === "integrations-dat") paintDatSecretsGate();
  if (shellView === "permissions") paintSettings();
  const authed = Boolean(getAccount());
  if (authed) revealApp();
  else lockApp();
  setSplashReady(!authed);
  return authed;
}

async function signInFromSplash() {
  setSplashReady(false);
  paintSplashError(null);
  try {
    await signInPopup();
  } catch (err) {
    paintSplashError(consumeAuthError(), err);
    setSplashReady(true);
    return;
  }
  paintUserChrome();
  paintNav();
  if (shellView === "integrations-dat") paintDatSecretsGate();
  if (shellView === "permissions") paintSettings();
  if (getAccount()) {
    paintSplashError(null);
    revealApp();
    void probeAllIntegrations();
    return;
  }
  paintSplashError(consumeAuthError());
  lockApp();
  setSplashReady(true);
}

async function onAuthAction() {
  try {
    if (getAccount()) {
      datSecrets = null;
      lockApp();
      setSplashReady(false);
      await signOut();
    } else {
      await signInPopup();
    }
  } catch {
    window.alert("Sign-in was cancelled or the popup was blocked.");
  }
  paintUserChrome();
  paintNav();
  if (shellView === "integrations-dat") paintDatSecretsGate();
  if (shellView === "permissions") paintSettings();
  if (getAccount()) {
    revealApp();
    void probeAllIntegrations();
  } else {
    lockApp();
    setSplashReady(true);
  }
}

function paintUserChrome() {
  const account = getAccount();
  const avatar = document.querySelector(".avatar");
  const nameEl = document.querySelector(".user-meta strong");
  const roleEl = document.querySelector(".user-meta small");
  const kicker = document.getElementById("user-kicker");
  const emailEl = document.getElementById("user-email");
  const action = document.getElementById("btn-auth-action");
  const hello = document.getElementById("brand-hello");
  const brandSignOut = document.getElementById("btn-brand-signout");
  if (avatar) avatar.textContent = account ? getInitials() : "TS";
  if (nameEl) nameEl.textContent = account ? getDisplayName() : "Sign in";
  if (roleEl) roleEl.textContent = account ? getEmail() : "Dalko Microsoft account";
  if (kicker) kicker.textContent = account ? "Signed in" : "Not signed in";
  if (emailEl) {
    emailEl.textContent = account ? getEmail() : "Sign in to manage API credentials.";
    emailEl.hidden = false;
  }
  if (action) action.textContent = account ? "Sign out" : "Sign in";
  if (hello) hello.textContent = account ? `Hello, ${getGreetingName()}!` : "Hello!";
  if (brandSignOut) brandSignOut.textContent = account ? "Sign out" : "Sign in";
}

function usd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const INTEG_NAMES = {
  entra: "Microsoft Entra / Graph",
  dat: "DAT RateView",
  fmcsa: "FMCSA QCMobile",
  ftp: "FTP Rack",
  currency: "Currency Converter",
  zip: "Zip Calculator",
};

/** @type {Record<string, { kind: string, label: string, detail: string }>} */
const integStatus = {};

/** @type {Promise<void> | null} */
let integProbe = null;
/** @type {Promise<boolean>} */
let authBoot = Promise.resolve(false);

function paintIntegHealth(id) {
  const rec = integStatus[id];
  if (!rec) return;
  const { kind, label, detail } = rec;
  document.querySelectorAll(`[data-integ-status="${id}"]`).forEach((el) => {
    el.classList.remove("is-on", "is-err", "is-wait", "is-setup", "is-live");
    el.classList.add(
      kind === "healthy" ? "is-on" : kind === "failed" ? "is-err" : kind === "testing" ? "is-wait" : "is-setup"
    );
    if (kind === "healthy") el.classList.add("is-live");
    el.innerHTML = `<i></i>${esc(label)}`;
  });
  document.querySelector(`[data-integ="${id}"]`)?.classList.toggle("is-warn", kind === "setup" || kind === "failed");
  const note = document.getElementById(`${id}-health`);
  if (note && detail) note.textContent = detail;
}

function setIntegHealth(id, kind, label, detail) {
  integStatus[id] = { kind, label, detail: detail || "" };
  paintIntegHealth(id);
  if (kind !== "testing") paintAlerts();
}

function integAlerts() {
  return Object.entries(integStatus)
    .filter(([id, status]) => {
      if (status.kind === "failed") return true;
      if (status.kind !== "setup") return false;
      if (id === "entra" && !getAccount()) return false;
      return true;
    })
    .map(([id, status]) => ({
      view: `integrations-${id}`,
      kind: "connection",
      title: INTEG_NAMES[id] ?? id,
      text: status.detail || status.label,
    }));
}

async function probeEntra() {
  setIntegHealth("entra", "testing", "Checking");
  if (!getAccount()) {
    setIntegHealth("entra", "setup", "Sign in", "No Microsoft session. Sign in from the account menu, then reopen Integrations.");
    return;
  }
  let token = await getAccessToken({ interactive: false });
  if (!token) token = await getAccessToken({ interactive: false });
  if (!token) {
    setIntegHealth(
      "entra",
      "setup",
      "Refresh",
      "You're signed in, but Microsoft did not issue a Graph token. Sign out and sign in again if this stays."
    );
    return;
  }
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      setIntegHealth("entra", "failed", "Failed", String(data.error?.message || `Graph returned ${res.status}.`));
      return;
    }
    const who = data.userPrincipalName || data.mail || getEmail();
    setIntegHealth("entra", "healthy", "Healthy", `Graph /me answered for ${who}.`);
  } catch {
    setIntegHealth("entra", "failed", "Failed", "Could not reach Microsoft Graph.");
  }
}

async function probeCurrency() {
  setIntegHealth("currency", "testing", "Checking");
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    const usdEur = Number(data.rates?.EUR);
    if (data.result !== "success" || !Number.isFinite(usdEur)) {
      setIntegHealth("currency", "failed", "Failed", "The FX feed answered, but the USD book was empty.");
      return;
    }
    setIntegHealth("currency", "healthy", "Healthy", `USD → EUR ${usdEur.toFixed(4)}. Provider ${data.provider || "open.er-api.com"}.`);
  } catch {
    setIntegHealth("currency", "failed", "Failed", "Could not reach open.er-api.com.");
  }
}

async function probeZip() {
  setIntegHealth("zip", "testing", "Checking");
  try {
    const res = await fetch("https://api.zippopotam.us/us/16150");
    const data = await res.json();
    const place = data.places?.[0];
    if (!res.ok || !place) {
      setIntegHealth("zip", "failed", "Failed", "Zippopotam did not return Sharpsville, PA (16150).");
      return;
    }
    setIntegHealth(
      "zip",
      "healthy",
      "Healthy",
      `16150 → ${place["place name"]}, ${place["state abbreviation"]}.`
    );
  } catch {
    setIntegHealth("zip", "failed", "Failed", "Could not reach api.zippopotam.us.");
  }
}

async function probeFmcsa() {
  setIntegHealth("fmcsa", "testing", "Checking");
  try {
    const res = await fetch(`${DAT_PROXY}/api/fmcsa/test`);
    const data = await res.json();
    if (data.needKey || !data.ok && /WEBKEY/i.test(String(data.error || ""))) {
      setIntegHealth(
        "fmcsa",
        "setup",
        "Needs setup",
        data.error || "The FMCSA web key is missing on the rack."
      );
      return;
    }
    if (!data.ok) {
      setIntegHealth("fmcsa", "failed", "Failed", String(data.error || "FMCSA lookup failed."));
      return;
    }
    setIntegHealth("fmcsa", "healthy", "Healthy", String(data.detail || "QCMobile answered for the Greyhound sample DOT."));
  } catch {
    setIntegHealth(
      "fmcsa",
      "setup",
      "Needs setup",
      rackUnreachable()
    );
  }
}

async function probeFtp() {
  setIntegHealth("ftp", "testing", "Checking");
  try {
    const rack = await fetchRack();
    const units = (rack.connections || [])
      .map((unit) => `${unit.name} ${unit.remoteDir} (${unit.phase})`)
      .join("; ");
    setIntegHealth(
      "ftp",
      "healthy",
      "Healthy",
      `${rack.hostname || "DELTA"} is listening at ${rack.listen}. ${units}`
    );
  } catch {
    setIntegHealth(
      "ftp",
      "failed",
      "Offline",
      "Could not reach the FTP rack at https://delta.shipdalko.com. Leave the server window open."
    );
  }
}

async function probeAllIntegrations() {
  await authBoot;
  if (!getAccount()) return;
  if (integProbe) return integProbe;
  integProbe = (async () => {
    setIntegHealth("entra", "testing", "Checking");
    setIntegHealth("dat", "testing", "Checking");
    setIntegHealth("fmcsa", "testing", "Checking");
    setIntegHealth("currency", "testing", "Checking");
    setIntegHealth("zip", "testing", "Checking");
    setIntegHealth("ftp", "testing", "Checking");
    await Promise.all([
      probeEntra(),
      testDatConnection(),
      probeFmcsa(),
      probeCurrency(),
      probeZip(),
      probeFtp(),
    ]);
  })().finally(() => {
    integProbe = null;
  });
  return integProbe;
}

function renderDatSampleHtml(payload) {
  const item = payload?.rateResponses?.[0];
  const rate = item?.response?.rate;
  const req = item?.request;
  const escalation = item?.response?.escalation;
  if (!rate || !req) {
    return `<p>Connected, but DAT did not return a rate for the sample lane.</p>`;
  }
  const origin = [req.origin?.city, req.origin?.stateOrProvince].filter(Boolean).join(", ");
  const dest = [req.destination?.city, req.destination?.stateOrProvince].filter(Boolean).join(", ");
  const market = escalation
    ? `${escalation.origin?.name ?? ""} → ${escalation.destination?.name ?? ""} · ${String(escalation.timeframe ?? "").replaceAll("_", " ").toLowerCase()}`
    : "";
  return `
    <p class="integ-lane">${esc(origin)} → ${esc(dest)}</p>
    <p class="integ-lane-sub">${esc(req.equipment ?? "VAN")} · ${esc(String(req.rateType ?? "").replaceAll("_", " ").toLowerCase())}</p>
    <div class="integ-kpis">
      <div><strong>${usd(rate.perMile?.rateUsd)}</strong><span>Linehaul / mile</span></div>
      <div><strong>${usd(rate.averageFuelSurchargePerMileUsd)}</strong><span>Fuel / mile</span></div>
      <div><strong>${usd(rate.perTrip?.rateUsd)}</strong><span>Linehaul / trip</span></div>
      <div><strong>${usd(rate.averageFuelSurchargePerTripUsd)}</strong><span>Fuel / trip</span></div>
      <div><strong>${usd(rate.perMile?.lowUsd)} – ${usd(rate.perMile?.highUsd)}</strong><span>Mile range</span></div>
      <div><strong>${Number(rate.mileage ?? 0).toLocaleString()}</strong><span>Miles</span></div>
    </div>
    <p class="integ-note">Linehaul does not include fuel. ${Number(rate.reports ?? 0)} reports · ${Number(rate.companies ?? 0)} companies · strength ${esc(String(rate.rateStrength ?? "—"))}${market ? ` · ${esc(market)}` : ""}</p>`;
}

async function testDatConnection() {
  const sample = document.getElementById("dat-sample");
  setIntegHealth("dat", "testing", "Checking");
  try {
    const res = await fetch(`${DAT_PROXY}/api/dat/test`, { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      const detail =
        data.error ||
        data.result?.errors?.[0]?.message ||
        "DAT lookup failed.";
      setIntegHealth("dat", "failed", "Failed", String(detail));
      if (sample) sample.innerHTML = `<p>${esc(String(detail))}</p>`;
      return;
    }
    setIntegHealth("dat", "healthy", "Healthy", "Staging Rate Lookup answered for Dallas → Pittsburgh van.");
    if (sample) sample.innerHTML = renderDatSampleHtml(data.result);
  } catch {
    setIntegHealth(
      "dat",
      "setup",
      "Needs setup",
      rackUnreachable()
    );
    if (sample) sample.innerHTML = `<p>${esc(rackUnreachable())}</p>`;
  }
}

/** @type {{ groupId: string | null }} */
let permFocus = { groupId: null };

function applyAccess() {
  document.querySelectorAll("#app-nav [data-view]").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const allowed = allowsMenu(el.dataset.view || "");
    el.hidden = !allowed;
    el.classList.toggle("hidden", !allowed);
  });
  document.querySelectorAll("#app-nav .nav-group").forEach((group) => {
    if (!(group instanceof HTMLElement)) return;
    const subs = [...group.querySelectorAll(".nav-sub-item")];
    const any = subs.some((sub) => sub instanceof HTMLElement && !sub.hidden);
    group.hidden = subs.length > 0 && !any;
    group.classList.toggle("hidden", subs.length > 0 && !any);
  });
  setEmbeddedInsightHide(hiddenInsightPages());
}

function hideDisallowedTools(root) {
  root.querySelectorAll("[data-tool-id]").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const allowed = allowsTool(el.dataset.toolId || "");
    el.hidden = !allowed;
    el.classList.toggle("hidden", !allowed);
  });
  root.querySelectorAll(".gb-report-band").forEach((band) => {
    if (!(band instanceof HTMLElement)) return;
    const tiles = [...band.querySelectorAll("[data-tool-id]")];
    const empty = tiles.length > 0 && tiles.every((tile) => tile instanceof HTMLElement && tile.hidden);
    band.hidden = empty;
    band.classList.toggle("hidden", empty);
  });
}

function renderSettingsHtml() {
  if (shellView === "integrations-dat") return renderDatNutsHtml();
  if (shellView === "integrations-entra") return renderEntraHtml();
  if (shellView === "integrations-currency") return renderCurrencyHtml();
  if (shellView === "integrations-zip") return renderZipHtml();
  if (shellView === "integrations-fmcsa") return renderFmcsaHtml();
  if (shellView === "integrations-ftp") return renderFtpHtml();
  if (shellView === "integrations") return renderIntegrationsHtml();
  return renderChangelogHtml();
}

function alertRowHtml(item) {
  const kind = item.kind === "connection" ? "Connection" : "Shipment";
  const kindClass = item.kind === "connection" ? "is-connection" : "is-shipment";
  return `
    <button type="button" class="alert-row ${kindClass}" data-view="${esc(item.view)}">
      <span class="alert-row-kind">${kind}</span>
      <strong>${esc(item.title || item.text)}</strong>
      ${item.title && item.text ? `<small>${esc(item.text)}</small>` : ""}
    </button>`;
}

function paintAlerts() {
  const list = document.getElementById("alert-list");
  const dot = document.getElementById("alert-dot");
  if (!list) return;
  const items = integAlerts();
  const emptyCopy = "No connection issues right now.";
  list.innerHTML = `
    <div class="alerts-head">
      <h2>Notifications</h2>
      <span class="alerts-count${items.length ? "" : " is-zero"}">${items.length}</span>
    </div>
    ${
      items.length
        ? `<div class="alerts-body">${items.map(alertRowHtml).join("")}</div>`
        : `<div class="alerts-empty">
            <span class="alerts-empty-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 18.5a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </span>
            <p><strong>All clear</strong></p>
            <p>${emptyCopy}</p>
          </div>`
    }`;
  list.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.view;
      if (id) setShellView(id);
    });
  });
  dot?.classList.toggle("hidden", !items.length);
}

function paintChrome() {
  const { fileName, rows, results } = snap();
  const status = document.getElementById("status-text");
  if (status) status.textContent = "";
  const insightStatus = document.getElementById("insights-status");
  if (insightStatus) {
    if (!fileName) {
      insightStatus.textContent = "";
      insightStatus.hidden = true;
      insightStatus.removeAttribute("title");
    } else {
      const n = results ? analysisRows().length : rows.length;
      insightStatus.textContent = `${n.toLocaleString()} loads`;
      const windowText =
        activeWindow.start && activeWindow.end
          ? `${formatWindowDay(activeWindow.start)} – ${formatWindowDay(activeWindow.end)}`
          : "";
      insightStatus.title = windowText ? `${fileName} · ${windowText}` : fileName;
      insightStatus.hidden = false;
    }
  }
  const clearData = document.getElementById("btn-clear-data");
  if (clearData) {
    clearData.hidden = !fileName;
    clearData.classList.toggle("hidden", !fileName);
  }
  paintAlerts();
}

/** @type {string | null} */
let selectedTodoDay = null;

window.addEventListener("glassbox:date-selected", (e) => {
  const day = /** @type {CustomEvent} */ (e).detail?.day;
  if (typeof day === "string") selectedTodoDay = day;
  if (shellView === "home") paintHome();
});

window.addEventListener("glassbox:open-tool", (e) => {
  const toolId = /** @type {CustomEvent} */ (e).detail?.toolId;
  if (typeof toolId === "string") openScheduledReport(toolId);
});

/** @type {AbortController | null} */
let homeTodoAbort = null;

function mountHomeTodo() {
  homeTodoAbort?.abort();
  homeTodoAbort = new AbortController();
  const host = document.getElementById("home-todo");
  if (!host) return;
  mountSidebarTodo(host, { signal: homeTodoAbort.signal });
  if (!selectedTodoDay) return;
  window.dispatchEvent(
    new CustomEvent("glassbox:date-selected", { detail: { day: selectedTodoDay } })
  );
}

function mountHomeCalendar() {
  const host = document.getElementById("today-calendar");
  if (host) mountSidebarCalendar(host);
}

function paintHome() {
  const host = els.home();
  if (!host) return;
  const existingTodo = document.getElementById("home-todo");
  const existingCal = document.getElementById("today-calendar");
  existingTodo?.remove();
  existingCal?.remove();
  host.innerHTML = renderHomeHtml();
  host.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.view;
      if (id) setShellView(id);
    });
  });
  const calSlot = document.getElementById("today-calendar");
  if (existingCal && calSlot) calSlot.replaceWith(existingCal);
  else mountHomeCalendar();
  const slot = document.getElementById("home-todo");
  if (existingTodo && slot) slot.replaceWith(existingTodo);
  else mountHomeTodo();
}

function paintThemes(host) {
  const active = getThemeId();
  const groups = [
    { id: "day", label: "Dashboard light" },
    { id: "night", label: "Night palettes" },
    { id: "seasonal", label: "Seasonal" },
  ];
  const cards = (groupId) =>
    THEMES.filter((theme) => (theme.group || "night") === groupId)
      .map((theme) => {
        const swatches = theme.swatches.map((c) => `<span style="background:${c}"></span>`).join("");
        return `
          <button type="button" class="gb-theme-card${theme.id === active ? " is-active" : ""}" data-theme-id="${esc(theme.id)}" role="listitem">
            <div class="gb-theme-swatches" aria-hidden="true">${swatches}</div>
            <p class="gb-theme-name">${esc(theme.name)}</p>
            <p class="gb-theme-desc">${esc(theme.description)}</p>
            <p class="gb-theme-state">${theme.id === active ? "Active" : "Apply"}</p>
          </button>`;
      })
      .join("");
  host.innerHTML = `
    <div class="page-canvas">
      <header class="hero">
        <h1>Themes</h1>
        <p>These palettes restyle this dashboard — sidebar, canvas, cards, charts, and tools.</p>
      </header>
      ${groups
        .map(
          (group) => `
        <section class="theme-group">
          <h2 class="theme-group-label">${group.label}</h2>
          <div class="gb-theme-grid" role="list">${cards(group.id)}</div>
        </section>`
        )
        .join("")}
    </div>`;
  host.querySelectorAll("[data-theme-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.themeId;
      if (!id) return;
      setTheme(id);
      paintThemes(host);
    });
  });
}

function paintSettings() {
  const host = els.settings();
  if (!host) return;
  if (shellView !== "integrations-dat") datSecrets = null;
  if (shellView === "themes") {
    paintThemes(host);
    return;
  }
  if (shellView === "permissions") {
    const directoryJob = loadDalkoDirectory(false);
    host.innerHTML = renderPermissionsPage(permFocus);
    bindPermissionsPage(host, {
      focus: permFocus,
      onFocus: (next) => {
        permFocus = next;
        paintSettings();
        paintNav();
      },
    });
    if (directoryJob) {
      void directoryJob.then(() => {
        if (shellView !== "permissions") return;
        paintSettings();
      });
    }
    return;
  }
  host.innerHTML = renderSettingsHtml();
  host.querySelectorAll("[data-integ]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.integ;
      if (id) setShellView(`integrations-${id}`);
    });
  });
  document.getElementById("integ-back")?.addEventListener("click", () => setShellView("integrations"));
  document.getElementById("dat-test")?.addEventListener("click", () => void testDatConnection());
  document.getElementById("dat-eye-user")?.addEventListener("click", () => void toggleDatSecret("user"));
  document.getElementById("dat-eye-pass")?.addEventListener("click", () => void toggleDatSecret("pass"));
  Object.keys(integStatus).forEach((id) => paintIntegHealth(id));
  if (String(shellView).startsWith("integrations")) void probeAllIntegrations();
  if (shellView === "integrations-dat") paintDatSecretsGate();
}

function appendConsole(line) {
  const body = document.getElementById("gb-console-body");
  if (!body) return;
  const row = document.createElement("div");
  row.className = "gb-console-line";
  row.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
  body.appendChild(row);
  body.scrollTop = body.scrollHeight;
}

function openTool(tool) {
  if (!allowsTool(tool?.id)) return;
  const workspace = els.workspace();
  if (!workspace) return;
  const fromNav = GB_NAV.find((n) => n.id === shellView);
  toolReturn = fromNav?.kind === "tool" ? "data-tools" : TOOL_IDS.has(shellView) ? shellView : "client-reports";
  void launchTool(tool.script, workspace, {
    onBack: () => showToolSection(toolReturn),
    log: appendConsole,
  });
}

function openScheduledReport(toolId) {
  const tool = findTool(toolId);
  shellView = "client-reports";
  document.title = `${TITLES["client-reports"] ?? "Client Reports"} · DALKO Insights`;
  const next = new URL(location.href);
  next.searchParams.set("view", "client-reports");
  history.replaceState(null, "", next);
  showLayer("tools");
  paintNav();
  paintChrome();
  if (!tool || tool.disabled || tool.skipped) {
    showToolSection("client-reports");
    return;
  }
  toolReturn = "client-reports";
  openTool(tool);
}

function showToolSection(id) {
  const workspace = els.workspace();
  if (!workspace) return;
  const item = GB_NAV.find((n) => n.id === id);
  if (!item || item.kind === "console" || item.kind === "changelog") return;
  if (item.kind === "tool") {
    const tool = findTool(item.toolId || item.label);
    if (!tool || tool.disabled || tool.skipped) {
      renderSection(workspace, "data-tools", openTool);
      return;
    }
    openTool(tool);
    return;
  }
  if (item.kind === "section") {
    renderSection(workspace, id, openTool);
    hideDisallowedTools(workspace);
    return;
  }
  if (item.kind === "reports") {
    renderClientReports(workspace, openTool);
    hideDisallowedTools(workspace);
    return;
  }
  if (item.kind === "themes") {
    renderThemes(workspace);
    return;
  }
}

function paintNav() {
  document.querySelectorAll(".nav-item[data-view], .nav-sub-item[data-view]").forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    el.classList.toggle(
      "is-active",
      el.dataset.view === shellView ||
        (el.dataset.view === "insights" && (shellView === "insights" || INSIGHT_IDS.has(shellView))) ||
        (el.dataset.view === "integrations" && String(shellView).startsWith("integrations-"))
    );
  });
  const groupId = GROUP_FOR[shellView];
  document.querySelectorAll(".nav-group").forEach((group) => {
    if (!(group instanceof HTMLElement)) return;
    const open = group.dataset.group === groupId;
    group.classList.toggle("is-open", open);
    document.querySelector(`[data-toggle="${group.dataset.group}"]`)?.setAttribute("aria-expanded", open ? "true" : "false");
  });
  applyAccess();
}

function showLayer(layer) {
  els.home()?.classList.toggle("hidden", layer !== "home");
  els.insights()?.classList.toggle("hidden", layer !== "insights");
  els.tools()?.classList.toggle("hidden", layer !== "tools");
  els.settings()?.classList.toggle("hidden", layer !== "settings");
}

function isSettingsView(id) {
  return (
    id === "changelog" ||
    id === "integrations" ||
    id === "integrations-dat" ||
    id === "integrations-entra" ||
    id === "integrations-currency" ||
    id === "integrations-zip" ||
    id === "integrations-fmcsa" ||
    id === "integrations-ftp" ||
    id === "themes" ||
    id === "permissions"
  );
}

function normalizeView(id) {
  if (id === "settings" || id === "gb-changelog") return "changelog";
  if (id === "analyze") return "insights";
  if (INSIGHT_IDS.has(id) || id === "reports") {
    insightsPage = id;
    return "insights";
  }
  return TITLES[id] ? id : "home";
}

function openInsightsSpace(page) {
  if (page) insightsPage = page;
  else if (!snap().fileName) insightsPage = "home";
  else insightsPage = snap().activeView || insightsPage || "home";
  showLayer("insights");
  setInsightsView(insightsPage);
}

function setShellView(id) {
  if (id === "insights") insightsPage = snap().fileName ? snap().activeView || "home" : "home";
  const view = normalizeView(id);
  if (!allowsMenu(view)) {
    const fallback = [
      "home",
      "client-reports",
      "carrier-search",
      "zip-calculator",
      "currency-converter",
      "insights",
      "accounting",
      "tracking",
      "ops",
      "data-tools",
      "client-uploads",
      "changelog",
      "integrations",
      "permissions",
      "themes",
    ].find((item) => item !== view && allowsMenu(item));
    if (fallback) {
      setShellView(fallback);
      return;
    }
  }
  shellView = view;
  document.title = view === "home" || TITLES[view] === "DALKO Insights" ? "DALKO Insights" : `${TITLES[view] ?? "DALKO Insights"} · DALKO Insights`;
  const next = new URL(location.href);
  if (view === "home") next.searchParams.delete("view");
  else next.searchParams.set("view", view);
  history.replaceState(null, "", next);

  if (view === "home") {
    showLayer("home");
    paintHome();
  } else if (isSettingsView(view)) {
    showLayer("settings");
    paintSettings();
  } else if (view === "insights") {
    openInsightsSpace();
  } else if (LOOKUP_TOOLS[view] && view !== "carrier-search") {
    showLayer("tools");
    const tool = findTool(LOOKUP_TOOLS[view]);
    if (tool) openTool(tool);
  } else if (TOOL_IDS.has(view)) {
    showLayer("tools");
    showToolSection(view);
  } else {
    showLayer("home");
    paintHome();
  }
  paintNav();
  paintChrome();
}

function onInsightsRefresh() {
  paintChrome();
  if (snap().fileName && shellView === "home") setShellView("insights");
}

function clearHeldData() {
  suppressExample = true;
  clearInsightsData();
  if (shellView === "changelog") paintSettings();
}

function closeMenus() {
  document.querySelectorAll(".menu-pop").forEach((el) => {
    el.hidden = true;
  });
  document.querySelectorAll("[aria-expanded]").forEach((el) => {
    if (el instanceof HTMLElement && (el.id === "alert-btn" || el.id === "user-btn")) {
      el.setAttribute("aria-expanded", "false");
    }
  });
}

function init() {
  globalThis.__DALKO_XLSX_STYLE__ = true;
  initTheme();
  window.addEventListener("dalko-theme", () => {
    if (shellView === "insights") setInsightsView(snap().activeView || insightsPage);
  });

  initDalkoPortal({
    embedMode: true,
    onHome: () => setShellView("home"),
    onRefresh: onInsightsRefresh,
  });

  document.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.toggle;
      const group = document.querySelector(`[data-group="${id}"]`);
      const open = group?.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  document.getElementById("app-nav")?.addEventListener("click", (e) => {
    const t = /** @type {HTMLElement} */ (e.target).closest("[data-view]");
    if (!t || !document.getElementById("app-nav")?.contains(t)) return;
    const id = t.dataset.view;
    if (id) setShellView(id);
  });

  document.querySelectorAll(".menu").forEach((menu) => {
    const btn = menu.querySelector(":scope > button");
    const pop = menu.querySelector(".menu-pop");
    btn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const was = pop && !pop.hidden;
      closeMenus();
      if (pop && !was) {
        pop.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });

  const consoleEl = document.getElementById("gb-console");
  const consoleBtn = document.getElementById("gb-btn-console");
  const setConsoleOpen = (open) => {
    consoleEl?.classList.toggle("hidden", !open);
    consoleBtn?.classList.toggle("is-on", open);
    consoleBtn?.setAttribute("aria-pressed", open ? "true" : "false");
  };
  consoleBtn?.addEventListener("click", () => {
    setConsoleOpen(consoleEl?.classList.contains("hidden") ?? true);
  });
  document.getElementById("gb-console-close")?.addEventListener("click", () => {
    setConsoleOpen(false);
  });

  document.addEventListener("click", () => closeMenus());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenus();
  });
  document.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    void handleInsightsFile(file).then(() => {
      if (shellView !== "insights") setShellView("insights");
    });
  });

  document.getElementById("btn-clear-data")?.addEventListener("click", () => {
    clearHeldData();
  });

  document.getElementById("btn-auth-action")?.addEventListener("click", (e) => {
    e.stopPropagation();
    void onAuthAction();
  });
  document.getElementById("btn-brand-signout")?.addEventListener("click", () => {
    void onAuthAction();
  });
  document.getElementById("btn-splash-signin")?.addEventListener("click", () => {
    void signInFromSplash();
  });

  authBoot = bootAuth();

  const requested = new URLSearchParams(location.search).get("view");
  shellView = requested ? normalizeView(requested) : "home";
  paintNav();
  if (shellView === "home") {
    document.title = "DALKO Insights";
    showLayer("home");
    paintHome();
  } else {
    setShellView(shellView);
  }

  void loadNews();
  void loadGbChangelog();
  appendConsole("Glass Box tools ready.");
  void authBoot.then((authed) => {
    if (authed) void probeAllIntegrations();
  });

}

init();
