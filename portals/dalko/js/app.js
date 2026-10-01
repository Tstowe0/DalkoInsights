import { buildHeaderMaps, validateExpectedColumns } from "./data/context.js";
import { parseExcelBuffer, readFileAsArrayBuffer } from "./data/excel.js";
import {
  createDefaultFilters,
  getFilteredRows,
  hasFocus,
  hasFocuses,
  listFocusLayerValues,
} from "./data/filters.js?v=20260916-bugsweep";
import { checkFileSize, checkRowCount, formatFileSize } from "./data/limits.js";
import { rowMatchesAccessorialType } from "./analytics/accessorials.js?v=20261001-accfocus";
import { runAnalysis } from "./analytics/engine.js?v=20261001-accfocus";
import { nextJobId, workerJob } from "./workers/client.js";
import { navTitle, renderNav } from "./ui/nav.js?v=20260923-desk";
import { renderView } from "./ui/render.js?v=20261001-focusbold";
import { RAIL_VIEWS, renderViewRail, teardownAllRails } from "./ui/page-rails.js?v=20260922-corp2";
import { alertDialog, confirmDialog } from "./ui/dialog.js";
import { runReport, teardownExecReport } from "./ui/report.js?v=20261001-nohier";
import { paintSidebarGreeting } from "../../../shared/js/auth.js?v=20260915-greet";

/** @type {import("./data/filters.js").FilterState} */
let filters = createDefaultFilters();

/** @type {{ fileName: string | null, headers: unknown[], rows: unknown[][], maps: ReturnType<typeof buildHeaderMaps> | null, results: object | null, activeView: string, analysisComplete: boolean }} */
const state = {
  fileName: null,
  headers: [],
  rows: [],
  maps: null,
  results: null,
  activeView: "home",
  analysisComplete: false,
};

/** Monotonic token — stale async work is ignored when this changes */
let workGeneration = 0;

/** @type {Worker | null} */
let parseWorker = null;
/** @type {Worker | null} */
let analyzeWorker = null;

/** @type {(() => void) | null} */
let homeHandler = null;

/** @type {(() => void) | null} */
let refreshHandler = null;

/** When true, skip portal chrome (nav / auto-jump to dashboard). */
let embedMode = false;

/** @type {AbortController | null} */
let portalAbort = null;

/** @type {Record<string, HTMLElement | null>} */
let el = {};

function bindElements() {
  el = {
    bootBanner: document.getElementById("boot-banner"),
    nav: document.getElementById("main-nav"),
    status: document.getElementById("status-text"),
    viewRoot: document.getElementById("view-root"),
    rightRail: document.getElementById("right-rail"),
    contentWorkspace: document.getElementById("content-workspace"),
    tableSearch: document.getElementById("table-search"),
    btnClearFocus: document.getElementById("btn-clear-focus"),
    btnUpload: document.getElementById("btn-upload"),
    btnBrandHome: document.getElementById("btn-brand-home"),
    btnBackHub: document.getElementById("btn-back-hub"),
    fileInput: document.getElementById("file-input"),
    loading: document.getElementById("loading-overlay"),
    loadingMsg: document.getElementById("loading-message"),
    loadingDetail: document.getElementById("loading-detail"),
    loadingProgress: document.getElementById("loading-progress"),
    loadingProgressFill: document.getElementById("loading-progress-fill"),
    loadingProgressPct: document.getElementById("loading-progress-pct"),
  };
}

function showBootBanner(message) {
  if (!el.bootBanner) return;
  el.bootBanner.innerHTML = message;
  el.bootBanner.classList.remove("hidden");
}

function checkEnvironment() {
  if (location.protocol === "file:") {
    showBootBanner(
      "This app must be opened through a local web server (ES modules do not run from a double-clicked file). " +
        "In the project folder run: <code>run-server.bat</code> then open " +
        "<code>http://localhost:8080</code>."
    );
    return false;
  }
  if (typeof XLSX === "undefined") {
    showBootBanner(
      "The Excel library did not load (network or firewall blocking CDN). Connect to the internet or allow " +
        "<code>cdn.sheetjs.com</code>, then refresh."
    );
    return false;
  }
  return true;
}

function applyTableSearch() {
  if (state.activeView === "filters") return;
  const q = (el.tableSearch?.value ?? "").trim().toLowerCase();
  if (!el.viewRoot) return;
  const rows = el.viewRoot.querySelectorAll("table.data-table tbody tr");
  let visible = 0;
  rows.forEach((tr) => {
    const text = tr.textContent?.toLowerCase() ?? "";
    const hide = q.length > 0 && !text.includes(q);
    tr.classList.toggle("row-hidden", hide);
    if (!hide) visible++;
  });
  el.viewRoot.querySelectorAll("[data-search-empty]").forEach((node) => node.remove());
  if (q && rows.length > 0 && visible === 0) {
    el.viewRoot.querySelectorAll(".table-scroll").forEach((scroll) => {
      const note = document.createElement("p");
      note.className = "table-search-empty";
      note.dataset.searchEmpty = "1";
      note.textContent = `No rows match “${el.tableSearch?.value?.trim() ?? ""}”. Clear the search box to see all rows.`;
      scroll.appendChild(note);
    });
  }
}

function clearTableSearch() {
  if (el.tableSearch) el.tableSearch.value = "";
}

const handlers = {
  onListFocusValues: (layer) => {
    if (!state.maps || !layer?.column) return [];
    const accessorialMatch = (row, value) =>
      rowMatchesAccessorialType(row, state.headers, state.maps, value);
    const dateOnly = { ...filters, focuses: [] };
    const rows = getFilteredRows(state.rows, state.maps, dateOnly, accessorialMatch);
    return listFocusLayerValues(rows, state.maps, state.headers, layer.column, {
      equipmentMode: layer.equipmentMode,
    });
  },
  onAddFocuses: async (items) => {
    const additions = [];
    for (const item of items ?? []) {
      const column = String(item?.column ?? "");
      const value = String(item?.value ?? "").trim() || "Unknown";
      if (!column || hasFocus(filters, column, value)) continue;
      additions.push({ column, value });
    }
    if (!additions.length) return true;
    clearTableSearch();
    filters.focuses = [...(filters.focuses ?? []), ...additions];
    updateFocusButton();
    runAnalyze({ quiet: true });
    return true;
  },
  onRemoveFocus: (column, value) => {
    filters.focuses = (filters.focuses ?? []).filter(
      (f) => !(f.column === column && f.value === value)
    );
    updateFocusButton();
    if (state.analysisComplete || state.rows.length) runAnalyze({ quiet: true });
    else refreshView();
  },
  onRemoveFocuses: (items) => {
    const drop = new Set((items ?? []).map((item) => `${item.column}\0${item.value}`));
    if (!drop.size) return;
    filters.focuses = (filters.focuses ?? []).filter((f) => !drop.has(`${f.column}\0${f.value}`));
    updateFocusButton();
    if (state.analysisComplete || state.rows.length) runAnalyze({ quiet: true });
    else refreshView();
  },
  onRunReport: (reportId) => {
    void handleRunReport(reportId);
  },
};

/**
 * @param {boolean} on
 * @param {string} [message]
 * @param {string} [detail]
 * @param {number | null} [pct] 0–100 when known; hide bar when null
 */
function setLoading(on, message = "Working…", detail = "", pct = null) {
  el.loading?.classList.toggle("hidden", !on);
  if (el.loadingMsg) el.loadingMsg.textContent = message;
  if (el.loadingDetail) el.loadingDetail.textContent = detail;

  const showPct = on && pct != null && Number.isFinite(pct);
  el.loadingProgress?.classList.toggle("hidden", !showPct);
  if (showPct) {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    if (el.loadingProgressFill) el.loadingProgressFill.style.width = `${clamped}%`;
    if (el.loadingProgressPct) el.loadingProgressPct.textContent = `${clamped}%`;
    el.loadingProgress?.setAttribute("aria-valuenow", String(clamped));
  }
}

function updateFocusButton() {
  if (!el.btnClearFocus) return;
  const on = hasFocuses(filters);
  el.btnClearFocus.disabled = !on;
  el.btnClearFocus.hidden = embedMode ? !on : el.btnClearFocus.hidden;
  el.btnClearFocus.classList.toggle("hidden", embedMode && !on);
  if (embedMode && on) {
    el.btnClearFocus.textContent = `Clear focus (${filters.focuses.length})`;
  }
}

/** Row count where a section switch is slow enough to show a loading state first. */
const HEAVY_VIEW_ROWS = 8000;
let viewPaintToken = 0;
let lastRenderedView = null;

/** @param {string} viewId */
function sectionLabel(viewId) {
  if (viewId === "reports") return "Reports";
  return navTitle(viewId);
}

function viewLoadingHost() {
  return el.contentWorkspace || document.getElementById("content-workspace");
}

function ensureViewLoading() {
  const host = viewLoadingHost();
  if (!host) return null;
  let node = host.querySelector(".view-loading");
  if (node) return /** @type {HTMLElement} */ (node);
  node = document.createElement("div");
  node.className = "view-loading hidden";
  node.hidden = true;
  node.setAttribute("role", "status");
  node.innerHTML = `<div class="view-loading-mark"><span class="view-loading-spin" aria-hidden="true"></span><span class="view-loading-label"></span></div>`;
  host.appendChild(node);
  return /** @type {HTMLElement} */ (node);
}

/** @param {string} viewId */
function showViewLoading(viewId) {
  const node = ensureViewLoading();
  if (!node) return;
  const label = node.querySelector(".view-loading-label");
  if (label) label.textContent = `Loading ${sectionLabel(viewId)}`;
  node.hidden = false;
  node.classList.remove("hidden");
  viewLoadingHost()?.setAttribute("aria-busy", "true");
}

function hideViewLoading() {
  const node = viewLoadingHost()?.querySelector(".view-loading");
  if (!(node instanceof HTMLElement)) return;
  node.hidden = true;
  node.classList.add("hidden");
  viewLoadingHost()?.removeAttribute("aria-busy");
}

let embeddedInsightHide = /** @type {string[]} */ ([]);

/** @param {string[]} ids */
export function setEmbeddedInsightHide(ids) {
  embeddedInsightHide = Array.isArray(ids) ? ids.map(String) : [];
  if (el.nav) paintInsightNav();
}

function insightNavOpts() {
  const hide = embedMode ? ["changelog", ...embeddedInsightHide] : [...embeddedInsightHide];
  return { hide };
}

function paintInsightNav(activeId = state.activeView) {
  if (el.nav) renderNav(/** @type {HTMLElement} */ (el.nav), activeId, setView, insightNavOpts());
}

function setView(viewId) {
  const changing = viewId !== state.activeView;
  if (changing) clearTableSearch();
  state.activeView = viewId;
  paintInsightNav(viewId);

  viewPaintToken += 1;
  const token = viewPaintToken;
  const busy = el.loading && !el.loading.classList.contains("hidden");
  const heavy = changing && state.analysisComplete && state.rows.length >= HEAVY_VIEW_ROWS && !busy;
  if (!heavy) {
    hideViewLoading();
    refreshView();
    return;
  }

  showViewLoading(viewId);
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      if (token !== viewPaintToken) return;
      try {
        refreshView();
      } finally {
        if (token === viewPaintToken) hideViewLoading();
      }
    }, 48);
  });
}

function refreshView() {
  if (!el.viewRoot) return;
  const content = el.viewRoot.closest(".content");
  const treeScroll = el.viewRoot.querySelector(".focus-tree-scroll");
  const stayOnFocuses = state.activeView === "filters" && lastRenderedView === "filters";
  const contentTop = stayOnFocuses ? content?.scrollTop ?? 0 : 0;
  const treeTop = stayOnFocuses ? treeScroll?.scrollTop ?? 0 : 0;
  document.getElementById("app")?.classList.toggle("is-home", state.activeView === "home");
  const showRail = RAIL_VIEWS.has(state.activeView) && !!state.results;
  el.contentWorkspace?.classList.toggle("with-rail", showRail);
  el.rightRail?.classList.toggle("hidden", !showRail);
  if (!showRail) teardownAllRails();

  const viewHandlers = { ...handlers };
  const hasData = !!state.maps;
  renderView(
    el.viewRoot,
    state.activeView,
    state.results,
    filters,
    viewHandlers,
    hasData,
    state.analysisComplete,
    state.fileName
  );
  if (showRail && el.rightRail && state.results) {
    renderViewRail(el.rightRail, state.activeView, state.results);
  }
  applyTableSearch();
  refreshHandler?.();
  if (stayOnFocuses) {
    el.viewRoot.classList.add("is-quiet");
    if (content) content.scrollTop = contentTop;
    const nextTree = el.viewRoot.querySelector(".focus-tree-scroll");
    if (nextTree) nextTree.scrollTop = treeTop;
    requestAnimationFrame(() => {
      if (content) content.scrollTop = contentTop;
      const again = el.viewRoot?.querySelector(".focus-tree-scroll");
      if (again) again.scrollTop = treeTop;
    });
  } else {
    el.viewRoot.classList.remove("is-quiet");
  }
  lastRenderedView = state.activeView;
}

function updateStatus(text) {
  const insightStatus = document.getElementById("insights-status");
  if (insightStatus) {
    insightStatus.textContent = text;
    insightStatus.hidden = !text;
    return;
  }
  if (el.status) el.status.textContent = text;
}

function resetSession() {
  filters = createDefaultFilters();
  state.fileName = null;
  state.headers = [];
  state.rows = [];
  state.maps = null;
  state.results = null;
  state.activeView = "home";
  state.analysisComplete = false;
}

function showDataUi(show) {
  el.viewRoot?.classList.toggle("hidden", !show);
}

function bumpGeneration() {
  workGeneration += 1;
  return workGeneration;
}

function resetWorkers() {
  try {
    parseWorker?.terminate();
  } catch {
    /* ignore */
  }
  try {
    analyzeWorker?.terminate();
  } catch {
    /* ignore */
  }
  parseWorker = null;
  analyzeWorker = null;
}

function getParseWorker() {
  if (!parseWorker) {
    parseWorker = new Worker(new URL("./workers/parse-worker.js", import.meta.url));
  }
  return parseWorker;
}

function getAnalyzeWorker() {
  if (!analyzeWorker) {
    analyzeWorker = new Worker(new URL("./workers/analyze-worker.js?v=20261001-accfocus", import.meta.url), {
      type: "module",
    });
  }
  return analyzeWorker;
}

/**
 * @param {File} file
 * @param {ArrayBuffer} buffer
 * @param {number} generation
 * @returns {Promise<{ headers: unknown[], rows: unknown[][] }>}
 */
async function parseWorkbook(file, buffer, generation) {
  const jobId = nextJobId();
  try {
    const worker = getParseWorker();
    const result = await workerJob(
      worker,
      jobId,
      { buffer },
      [buffer],
      (msg) => {
        if (generation !== workGeneration) return;
        const parsePct = typeof msg.pct === "number" ? msg.pct : 0;
        // File load was 0–25%; parse fills 25–100%
        const overall = 25 + parsePct * 0.75;
        setLoading(
          true,
          "Parsing Excel file…",
          `${msg.message || "Parsing workbook…"} · ${Math.round(overall)}% complete`,
          overall
        );
      }
    );
    if (generation !== workGeneration) throw new Error("Cancelled");
    return { headers: result.headers, rows: result.rows };
  } catch (err) {
    if (generation !== workGeneration) throw new Error("Cancelled");
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Cancelled") throw err;
    setLoading(true, "Parsing Excel file…", "Worker unavailable — parsing on main thread…", 30);
    const again = await readFileAsArrayBuffer(file, (ratio) => {
      if (generation !== workGeneration) return;
      const overall = 25 + ratio * 10;
      setLoading(
        true,
        "Parsing Excel file…",
        `Re-loading… ${Math.round(ratio * 100)}% · ${Math.round(overall)}% complete`,
        overall
      );
    });
    if (generation !== workGeneration) throw new Error("Cancelled");
    setLoading(true, "Parsing Excel file…", "Parsing on main thread… · 40% complete", 40);
    const parsed = await parseExcelBuffer(again);
    if (generation !== workGeneration) throw new Error("Cancelled");
    setLoading(true, "Parsing Excel file…", "Parse complete · 100%", 100);
    return parsed;
  }
}

/**
 * @param {unknown[][]} rows
 * @param {ReturnType<typeof buildHeaderMaps>} maps
 * @param {unknown[]} headers
 * @param {number} generation
 * @param {string[] | null} accessorialTypes
 */
async function analyzeInBackground(rows, maps, headers, generation, accessorialTypes) {
  const jobId = nextJobId();
  try {
    const worker = getAnalyzeWorker();
    const result = await workerJob(
      worker,
      jobId,
      { rows, maps, headers, accessorialTypes },
      [],
      (msg) => {
        if (generation !== workGeneration) return;
        setLoading(
          true,
          "Analyzing…",
          msg.message || `Working through ${rows.length.toLocaleString()} rows…`,
          null
        );
      }
    );
    if (generation !== workGeneration) throw new Error("Cancelled");
    return result.results;
  } catch (err) {
    if (generation !== workGeneration) throw new Error("Cancelled");
    const message = err instanceof Error ? err.message : String(err);
    if (message === "Cancelled") throw err;
    // Worker crash / module fail — analyze on main thread so the app stays usable
    setLoading(true, "Analyzing…", "Worker unavailable — analyzing on main thread…");
    await new Promise((r) => setTimeout(r, 0));
    if (generation !== workGeneration) throw new Error("Cancelled");
    return runAnalysis(rows, maps, headers, accessorialTypes);
  }
}

/**
 * @param {File} file
 */
async function handleFile(file) {
  if (!file) return;
  if (typeof XLSX === "undefined") {
    await alertDialog(
      "Excel library not loaded. Use http://localhost (see red banner) and check your network.",
      { title: "Upload" }
    );
    return;
  }

  const sizeCheck = checkFileSize(file);
  if (sizeCheck.ok === false) {
    await alertDialog(sizeCheck.reason, { title: "File too large" });
    return;
  }
  if (sizeCheck.ok === "confirm") {
    const ok = await confirmDialog(sizeCheck.message, {
      title: "Large file",
      okLabel: "Continue",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
  }

  const generation = bumpGeneration();
  resetWorkers();

  setLoading(
    true,
    "Reading Excel file…",
    `${file.name} · ${formatFileSize(file.size)} · 0% complete`,
    0
  );

  try {
    const buffer = await readFileAsArrayBuffer(file, (ratio) => {
      if (generation !== workGeneration) return;
      const overall = ratio * 25;
      setLoading(
        true,
        "Reading Excel file…",
        `Loading into memory… ${Math.round(ratio * 100)}% · ${Math.round(overall)}% complete`,
        overall
      );
    });
    if (generation !== workGeneration) return;

    setLoading(true, "Parsing Excel file…", "Starting workbook parse… · 25% complete", 25);
    const { headers, rows } = await parseWorkbook(file, buffer, generation);
    if (generation !== workGeneration) return;

    const rowCheck = checkRowCount(rows.length);
    if (rowCheck.ok === false) {
      setLoading(false);
      await alertDialog(rowCheck.reason, { title: "Too many rows" });
      return;
    }
    if (rowCheck.ok === "confirm") {
      setLoading(false);
      const ok = await confirmDialog(rowCheck.message, {
        title: "Large dataset",
        okLabel: "Continue",
        cancelLabel: "Cancel",
      });
      if (!ok) return;
      if (generation !== workGeneration) return;
      setLoading(true, "Analyzing…", "Preparing analysis…");
    }
    if (generation !== workGeneration) return;

    state.headers = headers;
    state.rows = rows;
    state.fileName = file.name;
    state.maps = buildHeaderMaps(headers);
    state.results = null;
    state.analysisComplete = false;
    filters = createDefaultFilters();
    updateFocusButton();

    const missing = validateExpectedColumns(headers);
    if (missing.length) {
      const preview = missing.slice(0, 8).join(", ");
      await alertDialog(
        `Some expected columns are missing (${preview}${missing.length > 8 ? "…" : ""}). Some analyses may be incomplete.`,
        { title: "Missing columns" }
      );
    }
    if (generation !== workGeneration) return;

    showDataUi(true);
    updateStatus(
      `✓ ${file.name} — ${rows.length.toLocaleString()} records — analyzing…`
    );
    state.activeView = "dashboard";
    paintInsightNav();
    refreshView();

    setLoading(
      true,
      "Analyzing…",
      `${rows.length.toLocaleString()} rows · keeping the UI responsive`
    );
    await runAnalyzeAsync(generation);
  } catch (err) {
    if (generation !== workGeneration) return;
    console.error(err);
    const msg = err instanceof Error ? err.message : "Failed to load file.";
    if (msg !== "Cancelled") {
      await alertDialog(msg, { title: "Upload failed" });
      updateStatus("Error loading file.");
    }
    setLoading(false);
  }
}

function getAnalysisRows() {
  if (!state.maps) return [];
  const accessorialMatch = (row, value) =>
    rowMatchesAccessorialType(row, state.headers, state.maps, value);
  return getFilteredRows(state.rows, state.maps, filters, accessorialMatch);
}

/** Accessorial-type focuses limit which charges are counted, not only which loads stay. */
function focusedAccessorialTypes() {
  const types = (filters.focuses ?? [])
    .filter((f) => f.column === "ACCESSORIAL_TYPE")
    .map((f) => f.value);
  return types.length ? types : null;
}

function runAnalyze(opts = {}) {
  const quiet = opts.quiet === true;
  const generation = bumpGeneration();
  // Keep parse worker; only drop analyze worker so an in-flight analyze is cancelled
  try {
    analyzeWorker?.terminate();
  } catch {
    /* ignore */
  }
  analyzeWorker = null;
  void runAnalyzeAsync(generation, quiet);
}

/**
 * @param {number} generation
 */
async function runAnalyzeAsync(generation, quiet = false) {
  if (!state.maps || !state.rows.length) {
    if (generation !== workGeneration) return;
    setLoading(false);
    if (state.maps && !state.rows.length) {
      state.results = null;
      state.analysisComplete = true;
      updateStatus("File has no data rows.");
      refreshView();
    }
    return;
  }

  if (!quiet) {
    setLoading(
      true,
      "Analyzing…",
      `${state.rows.length.toLocaleString()} rows in file`
    );
  }

  try {
    const rows = getAnalysisRows();
    if (generation !== workGeneration) return;

    /** @type {Awaited<ReturnType<typeof analyzeInBackground>>} */
    let results;
    if (!rows.length) {
      results = runAnalysis([], state.maps, state.headers, focusedAccessorialTypes());
    } else {
      if (!quiet) {
        setLoading(
          true,
          "Analyzing…",
          `${rows.length.toLocaleString()} rows · background worker`
        );
      }
      results = await analyzeInBackground(
        rows,
        state.maps,
        state.headers,
        generation,
        focusedAccessorialTypes()
      );
    }
    if (generation !== workGeneration) return;

    state.results = results;
    state.analysisComplete = true;
    const total = state.rows.length;
    const filtered = rows.length;
    let status = `✓ Analysis complete — ${filtered.toLocaleString()} records`;
    if (filtered !== total) status += ` (${total.toLocaleString()} total in file)`;
    if (hasFocuses(filters)) {
      const n = filters.focuses.length;
      status += n === 1 ? " · focus active" : ` · ${n} focuses active`;
    }
    if (filters.dateFilterEnabled) status += " · date filter active";
    updateStatus(status);
    if (!(quiet && state.activeView === "filters")) refreshView();
  } catch (err) {
    if (generation !== workGeneration) return;
    console.error(err);
    const msg = err instanceof Error ? err.message : "Analysis failed.";
    if (msg !== "Cancelled") {
      state.results = null;
      state.analysisComplete = true;
      updateStatus("Analysis failed.");
      refreshView();
      await alertDialog(msg, { title: "Analysis failed" });
    }
  } finally {
    if (generation === workGeneration) setLoading(false);
  }
}

async function handleRunReport(reportId) {
  if (!state.results) {
    await alertDialog("Upload and analyze a TMS file before generating a report.", {
      title: "Reports",
    });
    return;
  }
  try {
    runReport(reportId, {
      results: state.results,
      fileName: state.fileName,
      focus: {
        enabled: hasFocuses(filters),
        column: filters.focuses.map((f) => f.column).join(" · "),
        value: filters.focuses.map((f) => f.value).join(" · "),
      },
      dateFilter: {
        enabled: filters.dateFilterEnabled,
        column: filters.dateFilterColumn,
        start: filters.dateFilterStart,
        end: filters.dateFilterEnd,
      },
    });
  } catch (err) {
    await alertDialog(
      err instanceof Error
        ? err.message
        : "Could not open report. Allow pop-ups, then use Save as PDF in the print dialog.",
      { title: "Reports" }
    );
  }
}

function clearFocus() {
  if (!hasFocuses(filters)) return;
  filters.focuses = [];
  updateFocusButton();
  runAnalyze();
}

function bindFileInput(input, signal) {
  if (!input) return;
  input.addEventListener(
    "change",
    () => {
      const file = input.files?.[0];
      input.value = "";
      if (file) handleFile(file);
    },
    { signal }
  );
}

function bindUploadButton(button, input, signal) {
  button?.addEventListener(
    "click",
    async () => {
      if (location.protocol === "file:") {
        await alertDialog(
          "Open this app at http://localhost:8080 (run run-server.bat in the project folder).",
          { title: "Local server required" }
        );
        return;
      }
      input?.click();
    },
    { signal }
  );
}

/**
 * @param {{ onHome?: () => void, onRefresh?: () => void, embedMode?: boolean }} [opts]
 */
export function initDalkoPortal(opts = {}) {
  homeHandler = opts.onHome ?? null;
  refreshHandler = opts.onRefresh ?? null;
  embedMode = Boolean(opts.embedMode);
  portalAbort?.abort();
  portalAbort = new AbortController();
  const { signal } = portalAbort;

  resetSession();
  bindElements();

  if (!checkEnvironment()) {
    // Still bind upload to explain file:// issue
  }

  bindFileInput(el.fileInput, signal);
  bindUploadButton(el.btnUpload, el.fileInput, signal);

  el.btnClearFocus?.addEventListener("click", () => clearFocus(), { signal });
  el.tableSearch?.addEventListener("input", () => applyTableSearch(), { signal });
  const goHome = () => {
    homeHandler?.();
  };
  el.btnBrandHome?.addEventListener("click", goHome, { signal });
  el.btnBackHub?.addEventListener("click", goHome, { signal });

  showDataUi(true);
  paintInsightNav();
  if (!embedMode) paintSidebarGreeting();
  updateFocusButton();
  refreshView();
}

export function destroyDalkoPortal() {
  workGeneration += 1;
  portalAbort?.abort();
  portalAbort = null;
  homeHandler = null;
  refreshHandler = null;
  embedMode = false;
  parseWorker?.terminate();
  analyzeWorker?.terminate();
  parseWorker = null;
  analyzeWorker = null;
  teardownAllRails();
  teardownExecReport();
  setLoading(false);
  resetSession();
  el = {};
}

export function clearInsightsData() {
  bumpGeneration();
  resetWorkers();
  teardownAllRails();
  teardownExecReport();
  setLoading(false);
  hideViewLoading();
  filters = createDefaultFilters();
  state.fileName = null;
  state.headers = [];
  state.rows = [];
  state.maps = null;
  state.results = null;
  state.analysisComplete = false;
  clearTableSearch();
  updateFocusButton();
  refreshView();
}

export function setInsightsView(viewId) {
  setView(viewId);
}

export function getInsightsSnapshot() {
  return {
    fileName: state.fileName,
    headers: state.headers,
    rows: state.rows,
    maps: state.maps,
    results: state.results,
    filters,
    analysisComplete: state.analysisComplete,
    activeView: state.activeView,
  };
}

/**
 * @param {{ enabled: boolean, start?: Date | null, end?: Date | null, column?: string }} opts
 */
export function applyInsightsDateFilter(opts) {
  filters.dateFilterEnabled = Boolean(opts.enabled);
  filters.dateFilterStart = opts.start ?? null;
  filters.dateFilterEnd = opts.end ?? null;
  if (opts.column) filters.dateFilterColumn = opts.column;
  if (state.maps && state.rows.length) runAnalyze();
  else refreshView();
}

export { handleFile as handleInsightsFile };

window.addEventListener("error", (event) => {
  console.error(event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  void alertDialog(
    event.reason instanceof Error ? event.reason.message : String(event.reason),
    { title: "Unexpected error" }
  );
});
