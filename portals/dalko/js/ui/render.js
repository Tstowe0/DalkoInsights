import { formatCell, fmtMoney, fmtPct, fmtInt } from "./format.js";
import { attachTableSort, setSortValue } from "./table-sort.js";
import { CHANGELOG_TEXT } from "../changelog.js?v=20260916-sweep2";
import { renderConceptDashboard, teardownDashboardCharts } from "./dashboard-view.js?v=20260916-focusui";
import { navTitle } from "./nav.js?v=20260916-focusui";
import { renderReportsView } from "./report.js";
import { aggregateMonthRows } from "../analytics/accessorials.js?v=20260916-focusui";
import { focusFieldLabel, hasFocuses } from "../data/filters.js?v=20260916-bugsweep";
import { renderFocusBuilder } from "./focus-builder.js?v=20260916-bugsweep";

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
  if (!hasFocuses(filters)) return;
  const banner = document.createElement("div");
  banner.className = "focus-banner";
  banner.textContent = `Focus: ${filters.focuses
    .map((f) => `${focusFieldLabel(f.column)} = ${f.value}`)
    .join(" · ")}`;
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
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn-sm";
  exportBtn.textContent = "Export CSV";
  exportBtn.addEventListener("click", () => downloadCsv(opts.exportName, opts.columns, opts.rows));
  toolbar.appendChild(exportBtn);
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
    td.textContent = "No rows to display for the current focus.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const row of opts.rows) {
      const tr = document.createElement("tr");
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
 * @param {{ onRemoveFocus?: (col: string, val: string) => void, onListFocusValues?: (layer: object) => string[], onAddFocuses?: (items: { column: string, value: string }[]) => void, onRunReport?: (reportId: string) => void }} handlers
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
    root.appendChild(renderFocusesWorkspace(filters, handlers));
    return;
  }

  if (!results) {
    const surface = document.createElement("div");
    surface.className = "surface loaded-prompt";
    if (!hasData) {
      surface.innerHTML = "<p>Upload a TMS Excel file to see this view.</p>";
    } else if (filters.dateFilterEnabled || hasFocuses(filters)) {
      surface.innerHTML = `
        <h3 class="block-title">No matching rows</h3>
        <p>Nothing matches the current focus. Clear focus and try again.</p>`;
    } else if (analysisComplete) {
      surface.innerHTML = `
        <h3 class="block-title">No analysis results</h3>
        <p>Nothing to display. If the file has data, try re-uploading or clearing focus.</p>`;
    } else {
      surface.innerHTML = `
        <h3 class="block-title">${viewId === "dashboard" ? "Building dashboard" : "Preparing view"}</h3>
        <p>Running analysis on your upload…</p>`;
    }
    root.appendChild(surface);
    return;
  }

  if (viewId === "dashboard") {
    renderConceptDashboard(root, results);
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
      })
    );
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: "Performance",
        exportName: "Carrier_Performance",
        ...results.carriers.performance,
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
      })
    );
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: "By office",
        exportName: "Office",
        ...results.officeDivision.office,
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
      })
    );
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: results.geographic.dest.title,
        exportName: "Destination_States",
        ...results.geographic.dest,
      })
    );
    return;
  }
  if (viewId === "cities") {
    const cities = results.cities;
    if (!cities?.origin || !cities?.dest) {
      const surface = document.createElement("div");
      surface.className = "surface";
      surface.innerHTML = `<h3 class="block-title">Cities</h3><p>Re-upload the dump to build origin and destination city tables.</p>`;
      root.appendChild(surface);
      return;
    }
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: results.cities.origin.title,
        exportName: "Origin_Cities",
        ...results.cities.origin,
      })
    );
    root.appendChild(
      renderDataTable({
        pageTitle,
        title: results.cities.dest.title,
        exportName: "Destination_Cities",
        ...results.cities.dest,
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
    })
  );

  root.appendChild(renderAccessorialsByMonth(pageTitle, data));
}

/**
 * @param {string} pageTitle
 * @param {object} data
 */
function renderAccessorialsByMonth(pageTitle, data) {
  const columns = ["Month", "Sell amount", "Buy amount", "Net", "Buy frequency", "Sell frequency"];
  /** @type {string[]} */
  const typeOptions = Array.isArray(data.typeOptions)
    ? data.typeOptions
    : (data.typeRows || []).map((/** @type {{ type: string }} */ r) => r.type);
  /** @type {string[]} */
  const customerOptions = Array.isArray(data.customerOptions)
    ? data.customerOptions
    : (data.customerRows || []).map((/** @type {{ customer: string }} */ r) => r.customer);
  /** @type {{ invoiceMonth?: string | null, shipMonth?: string | null, month?: string, type: string, customer: string, sell: number, buy: number, buyCount: number, sellCount: number }[]} */
  const facts = Array.isArray(data.monthFacts) ? data.monthFacts : [];

  const selectedTypes = new Set(typeOptions);
  const selectedCustomers = new Set(customerOptions);
  /** @type {"invoice" | "ship"} */
  let dateBasis = "invoice";

  /** @type {{ cells: unknown[], formats?: string[] }[]} */
  let currentRows = monthRowsToTableRows(data.monthRows || []);

  const surface = document.createElement("div");
  surface.className = "surface table-section";

  const head = document.createElement("div");
  head.className = "block-head";

  const heading = tableHeading(pageTitle, "By month");
  if (heading) {
    const h = document.createElement("h3");
    h.className = "block-title";
    h.textContent = heading;
    head.appendChild(h);
  }

  const toolbar = document.createElement("div");
  toolbar.className = "table-toolbar";

  const filters = document.createElement("div");
  filters.className = "acc-month-filters";

  const dateField = document.createElement("label");
  dateField.className = "acc-month-date-field";
  dateField.innerHTML = `<span>Calculate by</span>`;
  const dateSelect = document.createElement("select");
  dateSelect.className = "acc-month-date-select";
  dateSelect.innerHTML = `
    <option value="invoice">Invoice Date</option>
    <option value="ship">Ship Date</option>
  `;
  dateSelect.value = dateBasis;
  dateSelect.addEventListener("change", () => {
    dateBasis = /** @type {"invoice" | "ship"} */ (dateSelect.value === "ship" ? "ship" : "invoice");
    refresh();
  });
  dateField.appendChild(dateSelect);

  const typeDd = mountCheckDropdown({
    label: "Accessorial types",
    options: typeOptions,
    selected: selectedTypes,
    onChange: () => refresh(),
  });
  const customerDd = mountCheckDropdown({
    label: "Customers",
    options: customerOptions,
    selected: selectedCustomers,
    onChange: () => refresh(),
  });
  filters.append(dateField, typeDd.root, customerDd.root);

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn-sm";
  exportBtn.textContent = "Export CSV";
  exportBtn.addEventListener("click", () => downloadCsv("Accessorial_Monthly", columns, currentRows));

  toolbar.append(filters, exportBtn);
  head.appendChild(toolbar);
  surface.appendChild(head);

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col;
    th.className = "num";
    if (col === "Month") th.className = "col-text";
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  scroll.appendChild(table);
  surface.appendChild(scroll);

  const status = document.createElement("p");
  status.className = "acc-month-status";
  surface.appendChild(status);

  function refresh() {
    typeDd.refreshLabel();
    customerDd.refreshLabel();
    const allTypes = selectedTypes.size === typeOptions.length;
    const allCustomers = selectedCustomers.size === customerOptions.length;
    const monthRows =
      facts.length > 0
        ? aggregateMonthRows(
            facts,
            allTypes ? null : selectedTypes,
            allCustomers ? null : selectedCustomers,
            dateBasis
          )
        : data.monthRows || [];
    currentRows = monthRowsToTableRows(monthRows);
    fillMonthTbody(tbody, currentRows);
    const typePart =
      selectedTypes.size === 0
        ? "no types"
        : allTypes
          ? "all types"
          : `${selectedTypes.size} of ${typeOptions.length} types`;
    const custPart =
      selectedCustomers.size === 0
        ? "no customers"
        : allCustomers
          ? "all customers"
          : `${selectedCustomers.size} of ${customerOptions.length} customers`;
    const datePart = dateBasis === "ship" ? "Ship Date (ACTUAL SHIP DATE)" : "Invoice Date";
    status.textContent = `By ${datePart} · ${monthRows.length} month(s) · ${typePart} · ${custPart}`;
  }

  fillMonthTbody(tbody, currentRows);
  attachTableSort(table, {
    columnFormats: ["text", "money", "money", "money", "int", "int"],
  });
  refresh();
  return surface;
}

/**
 * @param {{ month?: string, monthLabel?: string, sell: number, buy: number, net: number, buyCount: number, sellCount: number }[]} monthRows
 */
function monthRowsToTableRows(monthRows) {
  return monthRows.map((r) => ({
    cells: [r.monthLabel ?? r.month, r.sell, r.buy, r.net, r.buyCount, r.sellCount],
    formats: ["text", "money", "money", "money", "int", "int"],
  }));
}

/**
 * @param {HTMLElement} tbody
 * @param {{ cells: unknown[], formats?: string[] }[]} rows
 */
function fillMonthTbody(tbody, rows) {
  tbody.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "table-empty-cell";
    td.textContent = "No months match the selected accessorial types / customers.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    row.cells.forEach((cell, i) => {
      const td = document.createElement("td");
      const fmt = row.formats?.[i];
      td.textContent = formatCell(cell, fmt);
      setSortValue(td, cell);
      if (fmt && fmt !== "text") td.classList.add("num");
      else td.classList.add("col-text");
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

/**
 * Checkbox multi-select dropdown.
 * @param {{
 *   label: string,
 *   options: string[],
 *   selected: Set<string>,
 *   onChange: () => void,
 * }} opts
 */
function mountCheckDropdown(opts) {
  const root = document.createElement("div");
  root.className = "check-dd";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "check-dd-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "check-dd-panel";
  panel.hidden = true;

  const actions = document.createElement("div");
  actions.className = "check-dd-actions";
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "btn-sm";
  allBtn.textContent = "All";
  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.className = "btn-sm";
  noneBtn.textContent = "None";
  actions.append(allBtn, noneBtn);

  const search = document.createElement("input");
  search.type = "search";
  search.className = "check-dd-search";
  search.placeholder = "Filter…";
  search.autocomplete = "off";

  const list = document.createElement("div");
  list.className = "check-dd-list";
  list.setAttribute("role", "listbox");

  /** @type {Map<string, HTMLLabelElement>} */
  const labels = new Map();
  for (const option of opts.options) {
    const label = document.createElement("label");
    label.className = "check-dd-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = opts.selected.has(option);
    cb.addEventListener("change", () => {
      if (cb.checked) opts.selected.add(option);
      else opts.selected.delete(option);
      opts.onChange();
    });
    const span = document.createElement("span");
    span.textContent = option;
    label.append(cb, span);
    labels.set(option, label);
    list.appendChild(label);
  }

  if (!opts.options.length) {
    const empty = document.createElement("p");
    empty.className = "check-dd-empty";
    empty.textContent = "No options";
    list.appendChild(empty);
  }

  panel.append(actions, search, list);
  root.append(btn, panel);

  function refreshLabel() {
    const n = opts.selected.size;
    const total = opts.options.length;
    let summary = "None";
    if (total === 0) summary = "None";
    else if (n === 0) summary = "None";
    else if (n === total) summary = "All";
    else if (n === 1) summary = [...opts.selected][0];
    else summary = `${n} selected`;
    btn.textContent = `${opts.label}: ${summary}`;
  }

  function setOpen(open) {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    root.classList.toggle("open", open);
    if (open) {
      search.value = "";
      filterList("");
      search.focus();
    }
  }

  /** @param {string} q */
  function filterList(q) {
    const needle = q.trim().toLowerCase();
    for (const [option, label] of labels) {
      label.hidden = Boolean(needle) && !option.toLowerCase().includes(needle);
    }
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });
  allBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    for (const option of opts.options) opts.selected.add(option);
    for (const label of labels.values()) {
      const cb = label.querySelector("input");
      if (cb) /** @type {HTMLInputElement} */ (cb).checked = true;
    }
    opts.onChange();
  });
  noneBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.selected.clear();
    for (const label of labels.values()) {
      const cb = label.querySelector("input");
      if (cb) /** @type {HTMLInputElement} */ (cb).checked = false;
    }
    opts.onChange();
  });
  search.addEventListener("input", () => filterList(search.value));
  search.addEventListener("click", (e) => e.stopPropagation());
  panel.addEventListener("click", (e) => e.stopPropagation());

  if (!mountCheckDropdown._docBound) {
    document.addEventListener("click", () => {
      document.querySelectorAll(".check-dd.open").forEach((el) => {
        el.classList.remove("open");
        const p = el.querySelector(".check-dd-panel");
        const b = el.querySelector(".check-dd-btn");
        if (p) /** @type {HTMLElement} */ (p).hidden = true;
        if (b) b.setAttribute("aria-expanded", "false");
      });
    });
    mountCheckDropdown._docBound = true;
  }

  refreshLabel();
  return { root, refreshLabel };
}

/** @type {{ _docBound?: boolean }} */
mountCheckDropdown._docBound = false;

/** @param {import("../data/filters.js").FilterState} filters @param {object} handlers */
function renderFocusesWorkspace(filters, handlers) {
  const page = document.createElement("div");
  page.className = "focuses-page";

  const selector = document.createElement("div");
  selector.className = "surface focuses-selector-tile";
  const selectorHead = document.createElement("div");
  selectorHead.className = "block-head";
  const selectorTitle = document.createElement("h3");
  selectorTitle.className = "block-title";
  selectorTitle.textContent = "Focus selector";
  selectorHead.appendChild(selectorTitle);
  selector.append(
    selectorHead,
    renderFocusBuilder({
      existingFocuses: filters.focuses ?? [],
      listValues: (layer) => handlers.onListFocusValues?.(layer) ?? [],
      onApply: (items) => handlers.onAddFocuses?.(items),
    })
  );

  page.append(selector, renderActiveFocusesTable(filters, handlers));
  return page;
}

/** @param {import("../data/filters.js").FilterState} filters @param {object} handlers */
function renderActiveFocusesTable(filters, handlers) {
  const panel = document.createElement("div");
  panel.className = "surface table-section focuses-table-tile";

  const head = document.createElement("div");
  head.className = "block-head";
  const title = document.createElement("h3");
  title.className = "block-title";
  title.textContent = "Active focuses";
  head.appendChild(title);
  panel.appendChild(head);

  const scroll = document.createElement("div");
  scroll.className = "table-scroll focuses-table-scroll";
  const table = document.createElement("table");
  table.className = "data-table focuses-table";
  table.innerHTML = `<thead><tr><th class="col-text">Field</th><th class="col-text">Value</th><th class="col-center">Action</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  const focuses = filters.focuses ?? [];
  if (!focuses.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.className = "table-empty-cell";
    td.textContent = "No active focuses. Use the selector above to add one.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const item of focuses) {
      const tr = document.createElement("tr");
      const fieldTd = document.createElement("td");
      fieldTd.className = "col-text";
      fieldTd.textContent = focusFieldLabel(item.column);
      const valueTd = document.createElement("td");
      valueTd.className = "col-text";
      valueTd.textContent = item.value;
      const actionTd = document.createElement("td");
      actionTd.className = "col-center";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-sm focuses-remove";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => handlers.onRemoveFocus?.(item.column, item.value));
      actionTd.appendChild(remove);
      tr.append(fieldTd, valueTd, actionTd);
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  panel.appendChild(scroll);
  return panel;
}
