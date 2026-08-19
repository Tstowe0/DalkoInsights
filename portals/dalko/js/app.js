import { buildHeaderMaps, validateExpectedColumns } from "./data/context.js";
import { parseExcelBuffer, readFileAsArrayBuffer } from "./data/excel.js";
import {
  createDefaultFilters,
  getFilteredRows,
  parseFilterDateInput,
} from "./data/filters.js";
import { checkFileSize, checkRowCount, formatFileSize } from "./data/limits.js";
import { rowMatchesAccessorialType } from "./analytics/accessorials.js";
import { runAnalysis } from "./analytics/engine.js";
import { nextJobId, workerJob } from "./workers/client.js";
import { renderNav } from "./ui/nav.js";
import { renderView } from "./ui/render.js";
import { RAIL_VIEWS, renderViewRail, teardownAllRails } from "./ui/page-rails.js";
import { alertDialog, confirmDialog } from "./ui/dialog.js";
import { runReport } from "./ui/report.js";

/** @type {import("./data/filters.js").FilterState} */
let filters = createDefaultFilters();

/** @type {{ fileName: string | null, headers: unknown[], rows: unknown[][], maps: ReturnType<typeof buildHeaderMaps> | null, results: object | null, activeView: string, analysisComplete: boolean }} */
const state = {
  fileName: null,
  headers: [],
  rows: [],
  maps: null,
  results: null,
  activeView: "dashboard",
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
        "In the <code>HTML Version</code> folder run: <code>python -m http.server 8080</code> then open " +
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

/** @param {string} column */
function dateColumnExists(column) {
  if (!state.maps) return false;
  return (
    state.maps.index[column] !== undefined ||
    state.maps.upperMap[column.toUpperCase()] !== undefined
  );
}

/**
 * @param {import("./data/filters.js").FilterState} trial
 */
function countRowsForFilters(trial) {
  if (!state.maps) return 0;
  const accessorialMatch =
    trial.focusFilterColumn === "ACCESSORIAL_TYPE" && trial.focusFilterValue
      ? (row) => rowMatchesAccessorialType(row, state.headers, state.maps, trial.focusFilterValue)
      : undefined;
  return getFilteredRows(state.rows, state.maps, trial, accessorialMatch).length;
}

const handlers = {
  onApplyFilters: async (payload) => {
    const start = parseFilterDateInput(payload.start);
    const end = parseFilterDateInput(payload.end);
    if (!start && !end) {
      await alertDialog("Enter a valid start and/or end date (MM/DD/YYYY).", {
        title: "Date filter",
      });
      return;
    }
    if (!dateColumnExists(payload.dateColumn)) {
      await alertDialog(`Date column "${payload.dateColumn}" was not found in this file.`, {
        title: "Date filter",
      });
      return;
    }
    const trial = {
      ...filters,
      dateFilterColumn: payload.dateColumn,
      dateFilterStart: start,
      dateFilterEnd: end,
      dateFilterEnabled: true,
    };
    if (!countRowsForFilters(trial)) {
      await alertDialog("No rows match the current filters.", { title: "Date filter" });
      return;
    }
    filters.dateFilterColumn = payload.dateColumn;
    filters.dateFilterStart = start;
    filters.dateFilterEnd = end;
    filters.dateFilterEnabled = true;
    runAnalyze();
  },
  onClearDate: () => {
    filters.dateFilterEnabled = false;
    filters.dateFilterStart = null;
    filters.dateFilterEnd = null;
    if (state.analysisComplete || state.rows.length) runAnalyze();
    else refreshView();
  },
  onFocus: async (column, value) => {
    const focusValue = String(value ?? "").trim() || "Unknown";
    const trial = {
      ...filters,
      focusFilterEnabled: true,
      focusFilterColumn: column,
      focusFilterValue: focusValue,
    };
    if (!countRowsForFilters(trial)) {
      await alertDialog("No rows match that focus.", { title: "Focus" });
      return;
    }
    clearTableSearch();
    filters.focusFilterEnabled = true;
    filters.focusFilterColumn = column;
    filters.focusFilterValue = focusValue;
    updateFocusButton();
    state.activeView = "dashboard";
    renderNav(/** @type {HTMLElement} */ (el.nav), state.activeView, setView);
    runAnalyze();
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
  el.btnClearFocus.disabled = !filters.focusFilterEnabled;
}

function setView(viewId) {
  if (viewId !== state.activeView) clearTableSearch();
  state.activeView = viewId;
  renderNav(/** @type {HTMLElement} */ (el.nav), viewId, setView);
  refreshView();
}

function refreshView() {
  if (!el.viewRoot) return;
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
    state.analysisComplete
  );
  if (showRail && el.rightRail && state.results) {
    renderViewRail(el.rightRail, state.activeView, state.results);
  }
  applyTableSearch();
}

function updateStatus(text) {
  if (el.status) el.status.textContent = text;
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
    analyzeWorker = new Worker(new URL("./workers/analyze-worker.js", import.meta.url), {
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
 */
async function analyzeInBackground(rows, maps, headers, generation) {
  const jobId = nextJobId();
  try {
    const worker = getAnalyzeWorker();
    const result = await workerJob(
      worker,
      jobId,
      { rows, maps, headers },
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
    return runAnalysis(rows, maps, headers);
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
    renderNav(/** @type {HTMLElement} */ (el.nav), state.activeView, setView);
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
  const accessorialMatch =
    filters.focusFilterColumn === "ACCESSORIAL_TYPE" && filters.focusFilterValue
      ? (row) => rowMatchesAccessorialType(row, state.headers, state.maps, filters.focusFilterValue)
      : undefined;
  return getFilteredRows(state.rows, state.maps, filters, accessorialMatch);
}

function runAnalyze() {
  const generation = bumpGeneration();
  // Keep parse worker; only drop analyze worker so an in-flight analyze is cancelled
  try {
    analyzeWorker?.terminate();
  } catch {
    /* ignore */
  }
  analyzeWorker = null;
  void runAnalyzeAsync(generation);
}

/**
 * @param {number} generation
 */
async function runAnalyzeAsync(generation) {
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

  setLoading(
    true,
    "Analyzing…",
    `${state.rows.length.toLocaleString()} rows in file`
  );

  try {
    const rows = getAnalysisRows();
    if (generation !== workGeneration) return;

    if (!rows.length) {
      setLoading(false);
      await alertDialog("No rows match the current filters.", { title: "Filters" });
      state.results = null;
      state.analysisComplete = true;
      refreshView();
      updateStatus("No rows matched the current filters.");
      return;
    }

    setLoading(
      true,
      "Analyzing…",
      `${rows.length.toLocaleString()} rows · background worker`
    );

    const results = await analyzeInBackground(rows, state.maps, state.headers, generation);
    if (generation !== workGeneration) return;

    state.results = results;
    state.analysisComplete = true;
    const total = state.rows.length;
    const filtered = rows.length;
    let status = `✓ Analysis complete — ${filtered.toLocaleString()} records`;
    if (filtered !== total) status += ` (${total.toLocaleString()} total in file)`;
    if (filters.focusFilterEnabled) status += " · focus active";
    if (filters.dateFilterEnabled) status += " · date filter active";
    updateStatus(status);
    refreshView();
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
        enabled: filters.focusFilterEnabled,
        column: filters.focusFilterColumn,
        value: filters.focusFilterValue,
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
  if (!filters.focusFilterEnabled) return;
  filters.focusFilterEnabled = false;
  filters.focusFilterColumn = null;
  filters.focusFilterValue = null;
  updateFocusButton();
  runAnalyze();
}

function bindFileInput(input) {
  if (!input) return;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) handleFile(file);
  });
}

function bindUploadButton(button, input) {
  button?.addEventListener("click", async () => {
    if (location.protocol === "file:") {
      await alertDialog(
        "Open this app at http://localhost:8080 (run python -m http.server in the HTML Version folder).",
        { title: "Local server required" }
      );
      return;
    }
    input?.click();
  });
}

/**
 * @param {{ onHome?: () => void }} [opts]
 */
export function initDalkoPortal(opts = {}) {
  homeHandler = opts.onHome ?? null;
  portalAbort?.abort();
  portalAbort = new AbortController();
  const { signal } = portalAbort;

  bindElements();

  if (!checkEnvironment()) {
    // Still bind upload to explain file:// issue
  }

  bindFileInput(el.fileInput);
  bindUploadButton(el.btnUpload, el.fileInput);

  el.btnClearFocus?.addEventListener("click", () => clearFocus(), { signal });
  el.tableSearch?.addEventListener("input", () => applyTableSearch(), { signal });
  const goHome = () => {
    homeHandler?.();
  };
  el.btnBrandHome?.addEventListener("click", goHome, { signal });
  el.btnBackHub?.addEventListener("click", goHome, { signal });

  renderNav(/** @type {HTMLElement} */ (el.nav), state.activeView, setView);
  updateFocusButton();

  void alertDialog(
    "Dalko Portal runs on a TMS data dump. Upload an Excel export from your TMS to analyze customers, carriers, lanes, financials, and more — all locally in your browser.",
    { title: "TMS data dump", okLabel: "Upload" }
  ).then(() => {
    el.fileInput?.click();
  });
}

export function destroyDalkoPortal() {
  workGeneration += 1;
  portalAbort?.abort();
  portalAbort = null;
  homeHandler = null;
  parseWorker?.terminate();
  analyzeWorker?.terminate();
  parseWorker = null;
  analyzeWorker = null;
  teardownAllRails();
  setLoading(false);
  el = {};
}

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
