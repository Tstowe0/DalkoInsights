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
import { filterReleases, mergeChangelogs } from "./app-changelog.js?v=20261005-ftpsplit";
import { getValue, parseCellDate, safeFloat } from "../../portals/dalko/js/data/context.js";
import { getFilteredRows } from "../../portals/dalko/js/data/filters.js?v=20260916-bugsweep";
import { rowMatchesAccessorialType } from "../../portals/dalko/js/analytics/accessorials.js?v=20261005-opcarrier";
import { fmtInt, fmtMoney, fmtPct } from "../../portals/dalko/js/ui/format.js";
import { NAV_ITEMS as GB_NAV, findTool } from "../../portals/glassbox/js/catalog.js?v=20261005-datsname";
import { launchTool } from "../../portals/glassbox/js/tool-loader.js?v=20260819-fxsweep";
import { renderClientReports, renderSection, renderThemes } from "../../portals/glassbox/js/views.js?v=20261005-datsname";
import { mountSidebarCalendar } from "../../portals/glassbox/js/calendar.js?v=20260923-holiday";
import { mountSidebarTodo } from "../../portals/glassbox/js/todo.js?v=20261005-datsname";
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
import { fetchRack, testRackConnection, RACK_ORIGIN } from "./ftp-rack.js?v=20261005-demoname";
import {
  allowsMenu,
  allowsTool,
  bindPermissionsPage,
  hiddenInsightPages,
  loadDalkoDirectory,
  pullPermissions,
  renderPermissionsPage,
  resetPermissions,
} from "./permissions.js?v=20261005-ftpsplit";

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
  "integrations-ftp": "File transfer",
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
        <div class="integ-grid" id="ftp-service-grid"></div>
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

function integCred(label, value, extra = "") {
  return `<article class="integ-cred">
    <strong>${esc(label)}</strong>
    <span>${esc(value)}</span>
    <span>${esc(extra)}</span>
  </article>`;
}

function integBlock(title, rows) {
  return `<section class="integ-access">
    <h2>${esc(title)}</h2>
    <div class="integ-creds">${rows}</div>
  </section>`;
}

function integLab(id, subtitle) {
  return `<section class="integ-lab">
    <div class="integ-lab-top">
      <div>
        <h2>Testing</h2>
        <p>${esc(subtitle)}</p>
      </div>
      <button type="button" class="chip-btn chip-primary" id="${esc(id)}-test">Test</button>
    </div>
    <div class="integ-lab-body" id="${esc(id)}-sample"></div>
  </section>`;
}

function integHead(title, host, id) {
  return `<header class="integ-head">
    <button type="button" class="integ-back" id="integ-back">
      <span aria-hidden="true">←</span> Back
    </button>
    <div class="integ-detail-top">
      <div>
        <h1>${esc(title)}</h1>
        <p class="integ-host">${esc(host)}</p>
      </div>
      ${integStatusPill(id)}
    </div>
  </header>`;
}

function renderEntraHtml() {
  const tenant = `https://login.microsoftonline.com/${AUTH_TENANT_ID}`;
  return `
    <div class="page-canvas integ-page">
      ${integHead("Microsoft Entra", "shipdalko.com", "entra")}
      <section class="integ-access">
        <h2>Info</h2>
        <div class="integ-creds" id="entra-info"></div>
      </section>
      ${integBlock(
        "Environment",
        integCred("Sign-in", tenant) +
          integCred("Graph", "https://graph.microsoft.com/v1.0/me") +
          integCred("Scopes", "openid, profile, email, User.Read")
      )}
      ${integBlock("Credentials", integCred("Client ID", AUTH_CLIENT_ID))}
      ${integLab("entra", "Graph /me")}
    </div>`;
}

let entraWho = "";

function paintEntraBoard() {
  const host = document.getElementById("entra-info");
  if (host) {
    const signed = Boolean(getAccount());
    const who = entraWho || (signed ? getEmail() : "");
    host.innerHTML = [
      integCred("App", "DALKO Insights"),
      integCred("Domain", `@${AUTH_ALLOWED_DOMAIN}`),
      integCred("Signed in", who || "No"),
    ].join("");
  }
  paintIntegLab("entra");
}

function renderCurrencyHtml() {
  return `
    <div class="page-canvas integ-page">
      ${integHead("Currency Converter", "open.er-api.com", "currency")}
      ${integBlock(
        "Info",
        integCred("Tool", "Currency Converter") + integCred("Used by", "Glass Box · Data Tools")
      )}
      ${integBlock("Environment", integCred("Endpoint", "https://open.er-api.com/v6/latest/USD"))}
      ${integBlock("Credentials", integCred("Auth", "None"))}
      ${integLab("currency", "USD book")}
    </div>`;
}

const FTP_USED_BY = {
  phinia: "Phinia Shipment Upload",
  dats: "DATs Weekly Upload",
  demo: "Demo Upload",
};

/** @type {Array<{ id: string, name?: string, remoteDir?: string, phase?: string, host?: string, port?: number, protocol?: string, username?: string, passwordSet?: boolean, sendToTms?: boolean, sendLabel?: string, detail?: string, enabled?: boolean }> | null} */
let ftpUnits = null;
let ftpDown = false;

/** @param {{ protocol?: string, id?: string }} unit */
function isFtpService(unit) {
  const protocol = String(unit?.protocol || "").toLowerCase();
  return protocol === "ftp" || protocol === "ftps";
}

/** @param {{ id: string }} unit */
function ftpStatusId(unit) {
  return `ftp-${unit.id}`;
}

/** @param {string} view */
function isFtpServiceView(view) {
  return String(view).startsWith("integrations-ftp-");
}

/** @param {string} view */
function ftpUnitFromView(view) {
  const id = String(view).replace(/^integrations-ftp-/, "");
  return ftpUnits?.find((unit) => unit.id === id) ?? null;
}

function renderFtpServiceHtml() {
  const unit = ftpUnitFromView(shellView);
  if (!unit) {
    return `
      <div class="page-canvas integ-page">
        ${integHead("File transfer", "delta.shipdalko.com", "ftp")}
        <p class="integ-unit-empty">${ftpDown ? "The rack did not answer." : "Checking this service…"}</p>
      </div>`;
  }
  const id = ftpStatusId(unit);
  const url = serviceUrl(unit);
  const login = credentialLabel(unit);
  const used = FTP_USED_BY[unit.id] || "Glass Box · Client Uploads";
  const send = unit.sendToTms ? unit.sendLabel || "On" : "Off";
  return `
    <div class="page-canvas integ-page">
      ${integHead(unit.name || "File transfer", url || "delta.shipdalko.com", id)}
      ${integBlock(
        "Info",
        integCred("Used by", used) +
          integCred("Folder", unit.remoteDir || "/") +
          integCred("Send", send)
      )}
      ${integBlock(
        "Environment",
        integCred("Service", url || "No host yet") + integCred("Rack", "https://delta.shipdalko.com")
      )}
      ${integBlock("Credentials", integCred("Login", login || "Not saved"))}
      ${integLab(id, "FTP login")}
    </div>`;
}

function serviceUrl(unit) {
  const host = String(unit.host || "").trim();
  if (!host) return "";
  const ftp = unit.protocol === "ftp" || unit.protocol === "ftps";
  const scheme = ftp ? unit.protocol : "https";
  const port = Number(unit.port) || 0;
  const skipPort = ftp ? port === 21 || port === 0 : port === 443 || port === 0;
  const dir = String(unit.remoteDir || "");
  const path = ftp && dir && dir !== "/" ? (dir.startsWith("/") ? dir : `/${dir}`) : "";
  return `${scheme}://${host}${skipPort ? "" : `:${port}`}${path}`;
}

function credentialLabel(unit) {
  const user = String(unit.username || "").trim();
  if (user && unit.passwordSet) return `${user} · saved`;
  if (user) return user;
  if (unit.passwordSet) return "Saved";
  return "";
}

function paintFileTransferGrid() {
  const host = document.getElementById("ftp-service-grid");
  if (!host) return;
  if (ftpDown) {
    host.innerHTML = `<p class="integ-unit-empty">The rack did not answer.</p>`;
    return;
  }
  if (!ftpUnits) {
    host.innerHTML = `<p class="integ-unit-empty">${getAccount() ? "Checking file transfer…" : "Sign in to check file transfer."}</p>`;
    return;
  }
  if (!ftpUnits.length) {
    host.innerHTML = `<p class="integ-unit-empty">No file transfer services on the rack.</p>`;
    return;
  }
  host.innerHTML = ftpUnits
    .map((unit) => {
      const url = serviceUrl(unit);
      const blurb = url || unit.detail || "FTP login";
      return integTile(ftpStatusId(unit), esc(unit.name || "Service"), esc(blurb));
    })
    .join("");
  host.querySelectorAll("[data-integ]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.integ;
      if (id) setShellView(`integrations-${id}`);
    });
  });
  ftpUnits.forEach((unit) => paintIntegHealth(ftpStatusId(unit)));
}

function renderFmcsaHtml() {
  return `
    <div class="page-canvas integ-page">
      ${integHead("FMCSA QCMobile", "mobile.fmcsa.dot.gov", "fmcsa")}
      ${integBlock(
        "Info",
        integCred("Tool", "Carrier Search") + integCred("Lookup", "Name, USDOT, or MC")
      )}
      ${integBlock(
        "Environment",
        integCred("Provider", "https://mobile.fmcsa.dot.gov/qc/services") +
          integCred("Rack", "https://delta.shipdalko.com/api/fmcsa/test")
      )}
      ${integBlock("Credentials", integCred("Web key", "On the rack"))}
      ${integLab("fmcsa", "USDOT 44110")}
    </div>`;
}

function renderZipHtml() {
  return `
    <div class="page-canvas integ-page">
      ${integHead("Zip Calculator", "api.zippopotam.us", "zip")}
      ${integBlock(
        "Info",
        integCred("Tool", "Zip Calculator") + integCred("Used by", "Glass Box · Data Tools")
      )}
      ${integBlock("Environment", integCred("Endpoint", "https://api.zippopotam.us/us/{postal}"))}
      ${integBlock("Credentials", integCred("Auth", "None"))}
      ${integLab("zip", "16150")}
    </div>`;
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
            <h1>DAT RateView</h1>
            <p class="integ-host">identity.api.staging.dat.com</p>
          </div>
          ${integStatusPill("dat")}
        </div>
      </header>

      <section class="integ-access">
        <h2>Info</h2>
        <div class="integ-creds">
          <article class="integ-cred">
            <strong>Partner ID</strong>
            <span>001f400001M339EAAR</span>
            <span></span>
          </article>
          <article class="integ-cred">
            <strong>DAT user</strong>
            <span>sscarmack@dalkoresources.com</span>
            <span></span>
          </article>
        </div>
      </section>

      <section class="integ-access">
        <h2>Environment</h2>
        <div class="integ-creds">
          <article class="integ-cred">
            <strong>Environment</strong>
            <span>staging</span>
            <span></span>
          </article>
          <article class="integ-cred">
            <strong>Organization</strong>
            <span>https://identity.api.staging.dat.com/access/v1/token/organization</span>
            <span></span>
          </article>
          <article class="integ-cred">
            <strong>User token</strong>
            <span>https://identity.api.staging.dat.com/access/v1/token/user</span>
            <span></span>
          </article>
          <article class="integ-cred">
            <strong>Rate lookup</strong>
            <span>https://analytics.api.staging.dat.com/linehaulrates/v1/lookups</span>
            <span></span>
          </article>
          <article class="integ-cred">
            <strong>Rack</strong>
            <span>https://delta.shipdalko.com/api/dat/test</span>
            <span></span>
          </article>
        </div>
      </section>

      <section class="integ-access" id="dat-secrets">
        <h2>Credentials</h2>
        <p class="integ-cred-note" id="dat-secrets-note" hidden></p>
        <div class="integ-creds">
          <article class="integ-cred">
            <strong>Username</strong>
            <code id="dat-secret-user">${DAT_SECRET_MASK}</code>
            <button type="button" class="integ-eye" id="dat-eye-user" hidden aria-label="Show username">${EYE_ICO}</button>
          </article>
          <article class="integ-cred">
            <strong>Password</strong>
            <code id="dat-secret-pass">${DAT_SECRET_MASK}</code>
            <button type="button" class="integ-eye" id="dat-eye-pass" hidden aria-label="Show password">${EYE_ICO}</button>
          </article>
        </div>
      </section>

      <section class="integ-lab">
        <div class="integ-lab-top">
          <div>
            <h2>Testing</h2>
            <p>Dallas → Pittsburgh · van</p>
          </div>
          <button type="button" class="chip-btn chip-primary" id="dat-test">Test</button>
        </div>
        <div class="integ-lab-body" id="dat-sample"></div>
      </section>
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
    note.hidden = false;
    note.textContent = "Sign in to reveal the service account.";
    maskDatSecrets();
    return;
  }
  if (!allowed) {
    note.hidden = false;
    note.textContent = "Only Terry Stowe can reveal these.";
    maskDatSecrets();
    return;
  }
  note.hidden = true;
  note.textContent = "";
}

async function ensureDatSecrets() {
  if (datSecrets) return datSecrets;
  const note = document.getElementById("dat-secrets-note");
  const token = await getAccessToken();
  if (!token) {
    if (note) {
      note.hidden = false;
      note.textContent = "Microsoft would not issue a token. Sign in again, then retry.";
    }
    return null;
  }
  try {
    const res = await fetch(`${DAT_PROXY}/api/dat/secrets`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (note) {
        note.hidden = false;
        note.textContent = String(data.error || "Could not reveal credentials.");
      }
      return null;
    }
    datSecrets = { orgUsername: data.orgUsername, orgPassword: data.orgPassword };
    return datSecrets;
  } catch {
    if (note) {
      note.hidden = false;
      note.textContent = rackUnreachable();
    }
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
  const authed = Boolean(getAccount());
  if (authed) await pullPermissions();
  paintNav();
  if (shellView === "integrations-dat") paintDatSecretsGate();
  if (shellView === "permissions") paintSettings();
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
  if (getAccount()) await pullPermissions();
  else resetPermissions();
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
  if (getAccount()) await pullPermissions();
  else resetPermissions();
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
  ftp: "File transfer",
  currency: "Currency Converter",
  zip: "Zip Calculator",
};

/** @type {Record<string, { kind: string, label: string, detail: string }>} */
const integStatus = {};

/** @type {Record<string, { idle: string, busy: string, html: string }>} */
const integLabs = {
  entra: { idle: "Check the signed-in account.", busy: "Checking Graph…", html: "" },
  ftp: { idle: "Check the rack.", busy: "Checking DELTA…", html: "" },
  fmcsa: { idle: "Look up USDOT 44110.", busy: "Checking USDOT 44110…", html: "" },
  currency: { idle: "Load the USD book.", busy: "Checking USD…", html: "" },
  zip: { idle: "Look up 16150.", busy: "Checking 16150…", html: "" },
};

function labLine(text) {
  return `<p class="integ-lab-empty">${esc(text)}</p>`;
}

function labLane(title, sub) {
  return `<p class="integ-lane">${esc(title)}</p><p class="integ-lane-sub">${esc(sub)}</p>`;
}

function paintIntegLab(id) {
  const lab = integLabs[id];
  if (!lab) return;
  const button = document.getElementById(`${id}-test`);
  const testing = integStatus[id]?.kind === "testing";
  if (button instanceof HTMLButtonElement) {
    button.disabled = testing;
    button.textContent = testing ? "Testing…" : "Test";
  }
  const sample = document.getElementById(`${id}-sample`);
  if (!sample) return;
  if (lab.html) {
    sample.innerHTML = lab.html;
    return;
  }
  sample.innerHTML = labLine(testing ? lab.busy : lab.idle);
}

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
  paintIntegLab(id);
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
    integLabs.entra.html = labLine("Sign in to check Graph.");
    setIntegHealth("entra", "setup", "Sign in", "No Microsoft session.");
    return;
  }
  let token = await getAccessToken({ interactive: false });
  if (!token) token = await getAccessToken({ interactive: false });
  if (!token) {
    integLabs.entra.html = labLine("Microsoft did not issue a Graph token.");
    setIntegHealth("entra", "setup", "Refresh", "Microsoft did not issue a Graph token.");
    return;
  }
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      const detail = String(data.error?.message || `Graph returned ${res.status}.`);
      integLabs.entra.html = labLine(detail);
      setIntegHealth("entra", "failed", "Failed", detail);
      return;
    }
    const who = data.userPrincipalName || data.mail || getEmail();
    entraWho = String(who || "");
    integLabs.entra.html = labLane(entraWho || "Microsoft account", `@${AUTH_ALLOWED_DOMAIN}`);
    paintEntraBoard();
    setIntegHealth("entra", "healthy", "Healthy", entraWho || "Graph answered.");
  } catch {
    integLabs.entra.html = labLine("Could not reach Microsoft Graph.");
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
      integLabs.currency.html = labLine("The USD book was empty.");
      setIntegHealth("currency", "failed", "Failed", "The FX feed answered, but the USD book was empty.");
      return;
    }
    const keys = ["EUR", "GBP", "CAD", "MXN"];
    integLabs.currency.html = `<div class="integ-kpis">${keys
      .map((code) => {
        const rate = Number(data.rates?.[code]);
        const shown = Number.isFinite(rate) ? rate.toFixed(4) : "—";
        return `<div><strong>${esc(shown)}</strong><span>USD → ${esc(code)}</span></div>`;
      })
      .join("")}</div>`;
    setIntegHealth("currency", "healthy", "Healthy", `USD → EUR ${usdEur.toFixed(4)}`);
  } catch {
    integLabs.currency.html = labLine("Could not reach open.er-api.com.");
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
      integLabs.zip.html = labLine("Zippopotam did not return 16150.");
      setIntegHealth("zip", "failed", "Failed", "Zippopotam did not return 16150.");
      return;
    }
    const city = String(place["place name"] || "");
    const state = String(place["state abbreviation"] || "");
    integLabs.zip.html = labLane("16150", [city, state].filter(Boolean).join(", "));
    setIntegHealth("zip", "healthy", "Healthy", `16150 → ${city}, ${state}`);
  } catch {
    integLabs.zip.html = labLine("Could not reach api.zippopotam.us.");
    setIntegHealth("zip", "failed", "Failed", "Could not reach api.zippopotam.us.");
  }
}

async function probeFmcsa() {
  setIntegHealth("fmcsa", "testing", "Checking");
  try {
    const res = await fetch(`${DAT_PROXY}/api/fmcsa/test`);
    const data = await res.json();
    if (data.needKey || (!data.ok && /WEBKEY/i.test(String(data.error || "")))) {
      const detail = String(data.error || "The FMCSA web key is missing on the rack.");
      integLabs.fmcsa.html = labLine(detail);
      setIntegHealth("fmcsa", "setup", "Needs setup", detail);
      return;
    }
    if (!data.ok) {
      const detail = String(data.error || "FMCSA lookup failed.");
      integLabs.fmcsa.html = labLine(detail);
      setIntegHealth("fmcsa", "failed", "Failed", detail);
      return;
    }
    const detail = String(data.detail || "QCMobile answered for USDOT 44110.");
    const named = detail.match(/\(([^)]+)\)/);
    integLabs.fmcsa.html = labLane("USDOT 44110", named ? named[1] : detail);
    setIntegHealth("fmcsa", "healthy", "Healthy", named ? named[1] : "USDOT 44110");
  } catch {
    integLabs.fmcsa.html = labLine(rackUnreachable());
    setIntegHealth("fmcsa", "setup", "Needs setup", rackUnreachable());
  }
}

async function probeFtpService(unit) {
  const id = ftpStatusId(unit);
  INTEG_NAMES[id] = unit.name || unit.id;
  TITLES[`integrations-${id}`] = unit.name || "File transfer";
  if (!integLabs[id]) integLabs[id] = { idle: "Check the FTP login.", busy: "Checking the login…", html: "" };
  setIntegHealth(id, "testing", "Checking");
  try {
    const data = await testRackConnection(unit.id);
    if (data.ok) {
      const detail = String(data.detail || data.message || "Logged in.");
      integLabs[id].html = labLane(serviceUrl(unit) || unit.name || "FTP", detail);
      setIntegHealth(id, "healthy", "Healthy", detail);
      return;
    }
    const detail = String(data.error || "The login failed.");
    integLabs[id].html = labLine(detail);
    const needsSetup = /host|password|username|credential|turned off|disabled/i.test(detail);
    setIntegHealth(id, needsSetup ? "setup" : "failed", needsSetup ? "Needs setup" : "Failed", detail);
  } catch {
    integLabs[id].html = labLine(rackUnreachable());
    setIntegHealth(id, "failed", "Offline", rackUnreachable());
  }
}

async function probeFtpServices() {
  delete integStatus.ftp;
  try {
    const rack = await fetchRack();
    ftpDown = false;
    ftpUnits = Array.isArray(rack.connections) ? rack.connections.filter(isFtpService) : [];
  } catch {
    ftpUnits = [];
    ftpDown = true;
    INTEG_NAMES.ftp = "File transfer";
    integLabs.ftp.html = labLine(rackUnreachable());
    setIntegHealth("ftp", "failed", "Offline", rackUnreachable());
    refreshFtpSurface();
    return;
  }
  for (const unit of ftpUnits) {
    INTEG_NAMES[ftpStatusId(unit)] = unit.name || unit.id;
    TITLES[`integrations-${ftpStatusId(unit)}`] = unit.name || "File transfer";
  }
  refreshFtpSurface();
  await Promise.all(ftpUnits.map((unit) => probeFtpService(unit)));
}

function refreshFtpSurface() {
  if (document.getElementById("ftp-service-grid")) {
    paintFileTransferGrid();
    return;
  }
  if (isFtpServiceView(shellView)) paintSettings();
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
    await Promise.all([
      probeEntra(),
      testDatConnection(),
      probeFmcsa(),
      probeCurrency(),
      probeZip(),
      allowsMenu("integrations-ftp") ? probeFtpServices() : Promise.resolve(),
    ]);
  })().finally(() => {
    integProbe = null;
  });
  return integProbe;
}

/** @type {string} */
let datSampleHtml = "";

function paintDatSample() {
  const sample = document.getElementById("dat-sample");
  const button = /** @type {HTMLButtonElement | null} */ (document.getElementById("dat-test"));
  if (button) {
    button.disabled = integStatus.dat?.state === "testing";
    button.textContent = integStatus.dat?.state === "testing" ? "Testing…" : "Test";
  }
  if (!sample) return;
  if (datSampleHtml) {
    sample.innerHTML = datSampleHtml;
    return;
  }
  sample.innerHTML = integStatus.dat?.state === "testing"
    ? `<p class="integ-lab-empty">Checking Dallas → Pittsburgh…</p>`
    : `<p class="integ-lab-empty">Run the sample lane.</p>`;
}

function renderDatSampleHtml(payload) {
  const item = payload?.rateResponses?.[0];
  const rate = item?.response?.rate;
  const req = item?.request;
  const escalation = item?.response?.escalation;
  if (!rate || !req) {
    return `<p class="integ-lab-empty">Connected. DAT did not return a rate for this lane.</p>`;
  }
  const origin = [req.origin?.city, req.origin?.stateOrProvince].filter(Boolean).join(", ");
  const dest = [req.destination?.city, req.destination?.stateOrProvince].filter(Boolean).join(", ");
  const market = escalation
    ? `${escalation.origin?.name ?? ""} → ${escalation.destination?.name ?? ""}`
    : "";
  return `
    <p class="integ-lane">${esc(origin)} → ${esc(dest)}</p>
    <p class="integ-lane-sub">${esc(req.equipment ?? "VAN")} · ${esc(String(req.rateType ?? "").replaceAll("_", " ").toLowerCase())}${market ? ` · ${esc(market)}` : ""}</p>
    <div class="integ-kpis">
      <div><strong>${usd(rate.perMile?.rateUsd)}</strong><span>Linehaul / mile</span></div>
      <div><strong>${usd(rate.averageFuelSurchargePerMileUsd)}</strong><span>Fuel / mile</span></div>
      <div><strong>${usd(rate.perTrip?.rateUsd)}</strong><span>Linehaul / trip</span></div>
      <div><strong>${usd(rate.averageFuelSurchargePerTripUsd)}</strong><span>Fuel / trip</span></div>
      <div><strong>${usd(rate.perMile?.lowUsd)} – ${usd(rate.perMile?.highUsd)}</strong><span>Mile range</span></div>
      <div><strong>${Number(rate.mileage ?? 0).toLocaleString()}</strong><span>Miles</span></div>
    </div>
    <p class="integ-lab-meta">${Number(rate.reports ?? 0)} reports · ${Number(rate.companies ?? 0)} companies · strength ${esc(String(rate.rateStrength ?? "—"))}</p>`;
}

async function testDatConnection() {
  setIntegHealth("dat", "testing", "Checking");
  paintDatSample();
  try {
    const res = await fetch(`${DAT_PROXY}/api/dat/test`, { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      const detail =
        data.error ||
        data.result?.errors?.[0]?.message ||
        "DAT lookup failed.";
      datSampleHtml = `<p class="integ-lab-empty">${esc(String(detail))}</p>`;
      setIntegHealth("dat", "failed", "Failed", String(detail));
      paintDatSample();
      return;
    }
    datSampleHtml = renderDatSampleHtml(data.result);
    setIntegHealth("dat", "healthy", "Healthy", "Dallas → Pittsburgh van");
    paintDatSample();
  } catch {
    datSampleHtml = `<p class="integ-lab-empty">${esc(rackUnreachable())}</p>`;
    setIntegHealth("dat", "setup", "Needs setup", rackUnreachable());
    paintDatSample();
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
  if (isFtpServiceView(shellView)) return renderFtpServiceHtml();
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
  document.getElementById("entra-test")?.addEventListener("click", () => void probeEntra());
  ftpUnits?.forEach((unit) => {
    const id = ftpStatusId(unit);
    document.getElementById(`${id}-test`)?.addEventListener("click", () => void probeFtpService(unit));
  });
  document.getElementById("fmcsa-test")?.addEventListener("click", () => void probeFmcsa());
  document.getElementById("currency-test")?.addEventListener("click", () => void probeCurrency());
  document.getElementById("zip-test")?.addEventListener("click", () => void probeZip());
  Object.keys(integStatus).forEach((id) => paintIntegHealth(id));
  if (shellView === "integrations") paintFileTransferGrid();
  if (shellView === "integrations-entra") paintEntraBoard();
  if (shellView === "integrations-fmcsa") paintIntegLab("fmcsa");
  if (shellView === "integrations-currency") paintIntegLab("currency");
  if (shellView === "integrations-zip") paintIntegLab("zip");
  if (isFtpServiceView(shellView)) {
    const unit = ftpUnitFromView(shellView);
    if (unit) paintIntegLab(ftpStatusId(unit));
  }
  if (String(shellView).startsWith("integrations")) void probeAllIntegrations();
  if (shellView === "integrations-dat") {
    paintDatSecretsGate();
    paintDatSample();
  }
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
  const groupId = GROUP_FOR[shellView] || (String(shellView).startsWith("integrations-ftp-") ? "settings" : undefined);
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
    isFtpServiceView(id) ||
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
  if (isFtpServiceView(id)) return id;
  if (id === "integrations-ftp") return "integrations";
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
