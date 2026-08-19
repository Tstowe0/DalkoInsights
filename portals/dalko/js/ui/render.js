import { formatCell, fmtMoney, fmtPct, fmtInt } from "./format.js";
import { attachTableSort, setSortValue } from "./table-sort.js";
import { CHANGELOG_TEXT } from "../changelog.js";
import { renderConceptDashboard, teardownDashboardCharts } from "./dashboard-view.js";
import { navTitle } from "./nav.js";
import { renderReportsView } from "./report.js";

/** @param {string | undefined} tone */
function toneClass(tone) {
  const map = {
    accent: "teal",
    teal: "teal",
    red: "red",
    yellow: "yellow",
    blue: "blue",
    purple: "purple",
  };
  const key = tone ?? "teal";
  return map[key] ? ` tone-${map[key]}` : " tone-teal";
}

/** @param {string} column @param {string | undefined} format */
function tableColumnClass(column, format) {
  if (format === "zscore") return "num";
  if (format && format !== "text") return "num";
  const lower = column.toLowerCase();
  if (/score|rating|rank/.test(lower)) return "col-center";
  if (
    /revenue|profit|margin|loads|miles|sell|buy|net|amount|count|qty|volume|yield|avg|total|cost|rate|pct|percent|%/.test(
      lower
    )
  ) {
    return "num";
  }
  return "col-text";
}

/**
 * @param {HTMLElement} container
 * @param {{ label: string, value: unknown, format?: string, sub?: string, tone?: string, custom?: boolean }[]} kpis
 * @param {{ primary?: boolean }} [opts]
 */
export function renderKpiGrid(container, kpis, opts = {}) {
  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = `kpi-grid${opts.primary ? " kpi-grid-primary" : ""}`;
  for (const kpi of kpis) {
    const card = document.createElement("div");
    card.className = `kpi-card${toneClass(kpi.tone)}`;
    const label = document.createElement("div");
    label.className = "kpi-label";
    label.textContent = kpi.label;
    const value = document.createElement("div");
    value.className = "kpi-value";
    if (kpi.format === "text" || kpi.custom) {
      value.classList.add("text-sm");
      value.textContent = String(kpi.value);
    } else if (kpi.format === "money") {
      value.textContent = fmtMoney(Number(kpi.value));
    } else if (kpi.format === "pct") {
      value.textContent = fmtPct(Number(kpi.value));
    } else if (kpi.format === "int") {
      value.textContent = fmtInt(Number(kpi.value));
    } else {
      value.textContent = String(kpi.value);
    }
    const sub = document.createElement("div");
    sub.className = "kpi-sub";
    sub.textContent = kpi.sub ?? "";
    card.append(label, value, sub);
    grid.appendChild(card);
  }
  container.appendChild(grid);
}

/**
 * @param {string} exportName
 * @param {string[]} columns
 * @param {{ cells: unknown[], formats?: string[] }[]} rows
 */
export function downloadCsv(exportName, columns, rows) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    const cells = row.cells.map((c, i) => {
      const formatted = formatCell(c, row.formats?.[i]);
      return `"${String(formatted).replace(/"/g, '""')}"`;
    });
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${exportName}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** @param {string} pageTitle @param {string | undefined} subtitle */
function tableHeading(pageTitle, subtitle) {
  const base = pageTitle.trim();
  const sub = subtitle?.trim();
  if (base && sub) return `${base} - ${sub}`;
  return base || sub || "";
}

/**
 * @param {HTMLElement} root
 * @param {import("../data/filters.js").FilterState} filters
 */
function prependFocusBanner(root, filters) {
  if (!filters.focusFilterEnabled || !filters.focusFilterColumn) return;
  const banner = document.createElement("div");
  banner.className = "focus-banner";
  banner.textContent = `Focus: ${filters.focusFilterColumn} = ${filters.focusFilterValue}`;
  root.insertBefore(banner, root.firstChild);
}

/**
 * @param {{
 *   pageTitle?: string,
 *   title?: string,
 *   exportName: string,
 *   columns: string[],
 *   rows: { cells: unknown[], formats?: string[], focusValue?: string }[],
 *   focusColumn?: string | null,
 *   onFocus?: (column: string, value: string) => void,
 * }} opts
 */
export function renderDataTable(opts) {
  const surface = document.createElement("div");
  surface.className = "surface table-section";

  const head = document.createElement("div");
  head.className = "block-head";

  const heading = tableHeading(opts.pageTitle ?? "", opts.title);
  if (heading) {
    const h = document.createElement("h3");
    h.className = "block-title";
    h.textContent = heading;
    head.appendChild(h);
  }

  const toolbar = document.createElement("div");
  toolbar.className = "table-toolbar";
  const hint = document.createElement("span");
  hint.className = "table-hint";
  hint.textContent = opts.focusColumn ? "Click a row to focus the full dashboard on that value." : "";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn-sm";
  exportBtn.textContent = "Export CSV";
  exportBtn.addEventListener("click", () => downloadCsv(opts.exportName, opts.columns, opts.rows));
  toolbar.append(hint, exportBtn);
  head.appendChild(toolbar);
  surface.appendChild(head);

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  const sampleFormats = opts.rows[0]?.formats;
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (let i = 0; i < opts.columns.length; i++) {
    const col = opts.columns[i];
    const th = document.createElement("th");
    th.textContent = col;
    th.className = tableColumnClass(col, sampleFormats?.[i]);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (!opts.rows?.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = Math.max(opts.columns.length, 1);
    td.className = "table-empty-cell";
    td.textContent = "No rows to display for the current filters/focus.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const row of opts.rows) {
      const tr = document.createElement("tr");
      if (opts.focusColumn && row.focusValue != null && opts.onFocus) {
        tr.classList.add("focusable");
        tr.addEventListener("click", () => opts.onFocus?.(opts.focusColumn, String(row.focusValue)));
      }
      row.cells.forEach((cell, i) => {
        const td = document.createElement("td");
        const fmt = row.formats?.[i];
        td.textContent = formatCell(cell, fmt);
        setSortValue(td, cell);
        const align = fmt ? tableColumnClass(opts.columns[i], fmt) : tableColumnClass(opts.columns[i], undefined);
        if (align === "num") td.classList.add("num");
        else if (align === "col-center") td.classList.add("col-center");
        else td.classList.add("col-text");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  attachTableSort(table, {
    columnFormats: opts.columns.map((_, i) => sampleFormats?.[i]),
  });
  scroll.appendChild(table);
  surface.appendChild(scroll);
  return surface;
}

/**
 * @param {HTMLElement} root
 * @param {string} viewId
 * @param {object | null} results
 * @param {import("../data/filters.js").FilterState} filters
 * @param {{ onApplyFilters: (payload: object) => void, onClearDate: () => void, onFocus: (col: string, val: string) => void, onRunReport?: (reportId: string) => void }} handlers
 * @param {boolean} [hasData=false]
 * @param {boolean} [analysisComplete=false]
 */
export function renderView(
  root,
  viewId,
  results,
  filters,
  handlers,
  hasData = false,
  analysisComplete = false
) {
  teardownDashboardCharts();
  root.innerHTML = "";

  if (viewId === "changelog") {
    const surface = document.createElement("div");
    surface.className = "surface";
    const title = document.createElement("h3");
    title.className = "block-title";
    title.textContent = navTitle("changelog");
    const pre = document.createElement("pre");
    pre.className = "changelog-pre";
    pre.textContent = CHANGELOG_TEXT;
    surface.append(title, pre);
    root.appendChild(surface);
    return;
  }

  if (viewId === "reports") {
    renderReportsView(root, !!results, (reportId) => handlers.onRunReport?.(reportId));
    return;
  }

  if (viewId === "filters" && hasData) {
    root.appendChild(renderFiltersPanel(filters, handlers));
    return;
  }

  if (!results) {
    const surface = document.createElement("div");
    surface.className = "surface loaded-prompt";
    if (!hasData) {
      surface.innerHTML = "<p>Upload a TMS Excel file to see this view.</p>";
    } else if (filters.dateFilterEnabled || filters.focusFilterEnabled) {
      surface.innerHTML = `
        <h3 class="block-title">No matching rows</h3>
        <p>Nothing matches the current date filter and/or focus. Clear filters or focus and try again.</p>`;
    } else if (analysisComplete) {
      surface.innerHTML = `
        <h3 class="block-title">No analysis results</h3>
        <p>Nothing to display. If the file has data, try re-uploading or clearing filters.</p>`;
    } else {
      surface.innerHTML = `
        <h3 class="block-title">${viewId === "dashboard" ? "Building dashboard" : "Preparing view"}</h3>
        <p>Running analysis on your upload…</p>`;
    }
    root.appendChild(surface);
    return;
  }

  if (viewId === "dashboard") {
    renderConceptDashboard(root, results, handlers);
    prependFocusBanner(root, filters);
    return;
  }

  prependFocusBanner(root, filters);

  const pageTitle = navTitle(viewId);

  if (viewId === "customers") {
    root.appendChild(
      renderDataTable({
        pageTitle,
        exportName: "Customers",
        ...results.customers,
        onFocus: handlers.onFocus,
      })
    );
    return;
  }
  if (viewId === "salesReps") {
    root.appendChild(
      renderDataTable({
        pageTitle,
        exportName: "Sales_Reps",
        ...results.salesReps,
        onFocus: handlers.onFocus,
      })
    );
    return;
  }
  if (viewId === "carriers") {
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: "Profitability",
        exportName: "Carriers",
        ...results.carriers.profitability,
        onFocus: handlers.onFocus,
      })
    );
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: "Performance",
        exportName: "Carrier_Performance",
        ...results.carriers.performance,
        onFocus: handlers.onFocus,
      })
    );
    return;
  }
  if (viewId === "officeDivision") {
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: "By division",
        exportName: "Division",
        ...results.officeDivision.division,
        onFocus: handlers.onFocus,
      })
    );
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: "By office",
        exportName: "Office",
        ...results.officeDivision.office,
        onFocus: handlers.onFocus,
      })
    );
    return;
  }
  if (viewId === "ltl") {
    const kpiHost = document.createElement("div");
    renderKpiGrid(kpiHost, results.ltl.kpis);
    root.appendChild(kpiHost);
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: "LTL equipment",
        exportName: "LTL",
        ...results.ltl.table,
        onFocus: handlers.onFocus,
      })
    );
    return;
  }
  if (viewId === "truckload") {
    const kpiHost = document.createElement("div");
    renderKpiGrid(kpiHost, results.truckload.kpis);
    root.appendChild(kpiHost);
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: "Truckload equipment",
        exportName: "Truckload",
        ...results.truckload.table,
        onFocus: handlers.onFocus,
      })
    );
    return;
  }
  if (viewId === "lanes") {
    const kpiHost = document.createElement("div");
    renderKpiGrid(kpiHost, results.lanes.kpis);
    root.appendChild(kpiHost);
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: "Lane performance",
        exportName: "Lanes",
        ...results.lanes.table,
        onFocus: handlers.onFocus,
      })
    );
    return;
  }
  if (viewId === "geographic") {
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: results.geographic.origin.title,
        exportName: "Origin_States",
        ...results.geographic.origin,
        onFocus: handlers.onFocus,
      })
    );
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: results.geographic.dest.title,
        exportName: "Destination_States",
        ...results.geographic.dest,
        onFocus: handlers.onFocus,
      })
    );
    return;
  }
  if (viewId === "financial") {
    const kpiHost = document.createElement("div");
    renderKpiGrid(kpiHost, results.financial.kpis);
    root.appendChild(kpiHost);
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: "Monthly performance (invoice date)",
        exportName: "Financial",
        columns: results.financial.monthly.columns,
        rows: results.financial.monthly.rows,
      })
    );
    return;
  }
  if (viewId === "accessorials") {
    renderAccessorials(root, results.accessorials, handlers, pageTitle);
    return;
  }

  root.innerHTML = '<div class="surface">View not implemented.</div>';
}

/** @param {HTMLElement} root @param {object} data @param {object} handlers @param {string} pageTitle */
function renderAccessorials(root, data, handlers, pageTitle) {
  if (!data.hasAccessorialColumns) {
    const surface = document.createElement("div");
    surface.className = "surface";
    surface.innerHTML =
      '<h3 class="block-title">No accessorial columns detected</h3><p class="kpi-sub">Expected ACCESSORIAL1… columns with matching BUY/SELL amount columns.</p>';
    root.appendChild(surface);
    return;
  }
  const kpiHost = document.createElement("div");
  renderKpiGrid(kpiHost, [
    { label: "Sell-side accessorials", value: data.kpis.totalSell, format: "money", sub: "Customer charges", tone: "teal" },
    { label: "Buy-side accessorials", value: data.kpis.totalBuy, format: "money", sub: "Carrier costs", tone: "red" },
    { label: "Net accessorials", value: data.kpis.net, format: "money", sub: "Profit from accessorials", tone: "yellow" },
    {
      label: "Loads w/ accessorials",
      value: data.kpis.loadsWith,
      format: "int",
      sub: `${data.kpis.pct.toFixed(1)}% of total`,
      tone: "blue",
    },
  ]);
  root.appendChild(kpiHost);

  root.appendChild(
    renderDataTable({
      pageTitle,
      title: "By accessorial type",
      exportName: "Accessorial_Types",
      columns: ["Accessorial type", "Sell amount", "Buy amount", "Net", "Buy frequency", "Sell frequency"],
      rows: data.typeRows.map((r) => ({
        focusValue: r.type,
        cells: [r.type, r.sell, r.buy, r.net, r.buyCount, r.sellCount],
        formats: ["text", "money", "money", "money", "int", "int"],
      })),
      focusColumn: "ACCESSORIAL_TYPE",
      onFocus: handlers.onFocus,
    })
  );

  root.appendChild(
    renderDataTable({
      pageTitle,
      title: "By customer",
      exportName: "Accessorial_Customers",
      columns: ["Customer", "Sell accessorials", "Buy accessorials", "Net", "Loads", "Avg profit / load"],
      rows: data.customerRows.map((r) => ({
        focusValue: r.customer,
        cells: [r.customer, r.sell, r.buy, r.net, r.loads, r.avgPerLoad],
        formats: ["text", "money", "money", "money", "int", "money"],
      })),
      focusColumn: "CLIENT NAME",
      onFocus: handlers.onFocus,
    })
  );

  root.appendChild(
    renderDataTable({
      pageTitle,
      title: "By month",
      exportName: "Accessorial_Monthly",
      columns: ["Month", "Sell amount", "Buy amount", "Net", "Buy frequency", "Sell frequency"],
      rows: data.monthRows.map((r) => ({
        cells: [r.monthLabel ?? r.month, r.sell, r.buy, r.net, r.buyCount, r.sellCount],
        formats: ["text", "money", "money", "money", "int", "int"],
      })),
    })
  );
}

/** @param {Date | null} d */
function formatFilterDateDisplay(d) {
  if (!d || Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/** @param {import("../data/filters.js").FilterState} filters @param {object} handlers */
function renderFiltersPanel(filters, handlers) {
  const panel = document.createElement("div");
  panel.className = "surface filters-panel";

  const head = document.createElement("div");
  head.className = "filters-head";
  head.innerHTML = `
    <h3 class="block-title">${navTitle("filters")}</h3>
    <p class="filters-lead">Choose a TMS date column and range. Every tab re-analyzes on the filtered rows.</p>`;
  panel.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "filters-grid";

  const colField = document.createElement("div");
  colField.className = "field";
  colField.innerHTML = `<label for="date-col">Date column</label>`;
  const colSelect = document.createElement("select");
  colSelect.id = "date-col";
  for (const opt of [
    "INVOICE DATE",
    "ACTUAL SHIP DATE",
    "EXPECTED SHIP DATE",
    "ACTUAL DELIVERY DATE",
    "EXPECTED DELIVERY",
    "PAID DATE",
  ]) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if (opt === filters.dateFilterColumn) o.selected = true;
    colSelect.appendChild(o);
  }
  colField.appendChild(colSelect);

  const startField = document.createElement("div");
  startField.className = "field";
  startField.innerHTML = `<label for="date-start">Start date</label>`;
  const startInput = document.createElement("input");
  startInput.id = "date-start";
  startInput.type = "text";
  startInput.inputMode = "numeric";
  startInput.autocomplete = "off";
  startInput.placeholder = "MM/DD/YYYY";
  startInput.value = formatFilterDateDisplay(filters.dateFilterStart);
  startField.appendChild(startInput);

  const endField = document.createElement("div");
  endField.className = "field";
  endField.innerHTML = `<label for="date-end">End date</label>`;
  const endInput = document.createElement("input");
  endInput.id = "date-end";
  endInput.type = "text";
  endInput.inputMode = "numeric";
  endInput.autocomplete = "off";
  endInput.placeholder = "MM/DD/YYYY";
  endInput.value = formatFilterDateDisplay(filters.dateFilterEnd);
  endField.appendChild(endInput);

  grid.append(colField, startField, endField);
  panel.appendChild(grid);

  const actions = document.createElement("div");
  actions.className = "filters-actions";

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "btn btn-primary";
  apply.textContent = "Apply filter";
  apply.addEventListener("click", () => {
    handlers.onApplyFilters({
      dateColumn: colSelect.value,
      start: startInput.value,
      end: endInput.value,
    });
  });

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn btn-ghost";
  clear.textContent = "Clear date filter";
  clear.addEventListener("click", () => handlers.onClearDate());

  actions.append(apply, clear);

  if (filters.dateFilterEnabled) {
    const startStr = formatFilterDateDisplay(filters.dateFilterStart) || "…";
    const endStr = formatFilterDateDisplay(filters.dateFilterEnd) || "…";
    const status = document.createElement("p");
    status.className = "filters-status";
    status.innerHTML = `<span class="filters-status-dot" aria-hidden="true"></span>
      <span>Active · <strong>${filters.dateFilterColumn}</strong> · ${startStr} – ${endStr}</span>`;
    actions.appendChild(status);
  }

  panel.appendChild(actions);
  return panel;
}
