import { fmtMoney, fmtPct, fmtInt, formatCell } from "./format.js";
import { attachTableSort, setSortValue } from "./table-sort.js";
import {
  sparklineSvg,
  renderMonthlyChart,
  renderEquipmentDonut,
  renderRailSummaryChart,
  renderRailCarriersChart,
  renderRailTransitChart,
  destroyChart,
} from "./charts.js";

/** @type {object | null} */
let monthlyChartInstance = null;
/** @type {object[]} */
let railChartInstances = [];
/** @type {number} */
let monthlyRaf = 0;
/** @type {number} */
let railRaf = 0;

/**
 * @param {{ name?: string | null, sub?: string, z?: number | null, loads?: number, late?: number }} bc
 * @param {number} netAccessorials
 */
function renderSpotlightSection(bc, netAccessorials) {
  const spotlight = document.createElement("div");
  spotlight.className = "rail-section rail-spotlight";

  const eyebrow = document.createElement("p");
  eyebrow.className = "spotlight-eyebrow";
  eyebrow.textContent = "Performance spotlight";
  spotlight.appendChild(eyebrow);

  if (!bc?.name || bc.z == null) {
    const empty = document.createElement("p");
    empty.className = "spotlight-empty";
    empty.textContent =
      bc?.sub ?? "Add ACTUAL and EXPECTED transit days on your rows to score carrier performance.";
    spotlight.appendChild(empty);
    return spotlight;
  }

  const name = document.createElement("h4");
  name.className = "spotlight-name";
  name.title = bc.name;
  name.textContent = bc.name;
  spotlight.appendChild(name);

  const zStr = `${bc.z >= 0 ? "+" : ""}${bc.z.toFixed(2)}`;
  const stats = document.createElement("dl");
  stats.className = "spotlight-stats";
  stats.innerHTML = `
    <div class="spotlight-stat spotlight-stat-featured">
      <dt>Transit Z-score</dt>
      <dd>${zStr}</dd>
    </div>
    <div class="spotlight-stat">
      <dt>Loads</dt>
      <dd>${fmtInt(bc.loads ?? 0)}</dd>
    </div>
    <div class="spotlight-stat">
      <dt>Late</dt>
      <dd>${fmtInt(bc.late ?? 0)}</dd>
    </div>`;
  spotlight.appendChild(stats);

  const loads = bc.loads ?? 0;
  const late = bc.late ?? 0;
  const onTime = Math.max(0, loads - late);
  if (loads > 0) {
    const chartWrap = document.createElement("div");
    chartWrap.className = "rail-chart-wrap rail-chart-wrap--spotlight";
    chartWrap.innerHTML = `<canvas id="rail-spotlight-transit" aria-label="On-time vs late loads"></canvas>`;
    spotlight.appendChild(chartWrap);
    spotlight.dataset.transitOnTime = String(onTime);
    spotlight.dataset.transitLate = String(late);
  }

  const foot = document.createElement("div");
  foot.className = "spotlight-foot";
  const footLabel = document.createElement("span");
  footLabel.className = "spotlight-foot-label";
  footLabel.textContent = "Net accessorials";
  const footVal = document.createElement("span");
  footVal.className = "spotlight-foot-val";
  footVal.textContent = fmtMoney(netAccessorials);
  foot.append(footLabel, footVal);
  spotlight.appendChild(foot);

  return spotlight;
}

/**
 * @param {HTMLElement} rail
 * @param {object} results
 */
export function renderDashboardRail(rail, results) {
  if (railRaf) {
    cancelAnimationFrame(railRaf);
    railRaf = 0;
  }
  for (const c of railChartInstances) destroyChart(c);
  railChartInstances = [];
  rail.innerHTML = "";

  const exec = results.executive;
  const s = exec.summary;

  const summary = document.createElement("div");
  summary.className = "rail-section";
  summary.innerHTML = `
    <h4 class="rail-title">Freight summary</h4>
    <div class="rail-stat"><span class="muted">Total revenue</span><strong>${fmtMoney(s.totalRevenue)}</strong></div>
    <div class="rail-stat"><span class="muted">Gross profit</span><strong>${fmtMoney(s.totalProfit)}</strong></div>
    <div class="rail-stat"><span class="muted">Avg profit / load</span><strong>${fmtMoney(s.avgProfitPerLoad)}</strong></div>
    <div class="rail-stat"><span class="muted">Total miles</span><strong>${fmtInt(s.totalMiles)}</strong></div>
    <p class="rail-chart-caption">Last 6 months · invoice date</p>
    <div class="rail-chart-wrap rail-chart-wrap--summary"><canvas id="rail-summary-chart"></canvas></div>`;
  rail.appendChild(summary);

  const health = document.createElement("div");
  health.className = "rail-section";
  health.innerHTML = `<h4 class="rail-title">Equipment mix</h4><div class="donut-wrap"><canvas id="rail-donut"></canvas></div>`;
  rail.appendChild(health);

  const carriers = document.createElement("div");
  carriers.className = "rail-section";
  carriers.innerHTML = `
    <h4 class="rail-title">Top carriers</h4>
    <p class="rail-chart-caption">By revenue</p>
    <div class="rail-chart-wrap rail-chart-wrap--carriers"><canvas id="rail-carriers-chart"></canvas></div>`;
  rail.appendChild(carriers);

  rail.appendChild(renderSpotlightSection(exec.bestCarrier, exec.accessorialSummary.net));

  railRaf = requestAnimationFrame(() => {
    railRaf = 0;
    const summaryCanvas = /** @type {HTMLCanvasElement | null} */ (
      document.getElementById("rail-summary-chart")
    );
    if (summaryCanvas && exec.monthlyChart?.labels?.length) {
      const chart = renderRailSummaryChart(summaryCanvas, exec.monthlyChart);
      if (chart) railChartInstances.push(chart);
    }

    const donutCanvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("rail-donut"));
    if (donutCanvas) {
      const chart = renderEquipmentDonut(donutCanvas, exec.equipmentSplit);
      if (chart) railChartInstances.push(chart);
    }

    const carrierCanvas = /** @type {HTMLCanvasElement | null} */ (
      document.getElementById("rail-carriers-chart")
    );
    if (carrierCanvas) {
      const carrierRows = exec.topCarriers.slice(0, 5).map((row) => ({
        name: String(row.focusValue ?? row.cells[0]),
        revenue: Number(row.cells[1]),
      }));
      carrierRows.reverse();
      const chart = renderRailCarriersChart(carrierCanvas, carrierRows);
      if (chart) railChartInstances.push(chart);
    }

    const transitCanvas = /** @type {HTMLCanvasElement | null} */ (
      document.getElementById("rail-spotlight-transit")
    );
    const spotlightEl = rail.querySelector(".rail-spotlight");
    if (transitCanvas && spotlightEl) {
      const onTime = Number(spotlightEl.dataset.transitOnTime ?? 0);
      const late = Number(spotlightEl.dataset.transitLate ?? 0);
      const chart = renderRailTransitChart(transitCanvas, { onTime, late });
      if (chart) railChartInstances.push(chart);
    }
  });
}

/**
 * @param {HTMLElement} root
 * @param {object} results
 * @param {{ onFocus: (col: string, val: string) => void }} handlers
 */
export function renderConceptDashboard(root, results, handlers) {
  if (monthlyRaf) {
    cancelAnimationFrame(monthlyRaf);
    monthlyRaf = 0;
  }
  destroyChart(monthlyChartInstance);
  monthlyChartInstance = null;
  root.innerHTML = "";

  const exec = results.executive;

  const heroRow = document.createElement("div");
  heroRow.className = "hero-metrics";
  for (const m of exec.heroMetrics) {
    const card = document.createElement("div");
    card.className = "hero-card";
    if (m.format === "score") {
      const score = m.score ?? 0;
      card.innerHTML = `
        <div class="hero-label">${m.label}</div>
        <div class="hero-score-ring" style="--score:${score}">
          <span class="hero-score-val">${score}</span>
        </div>
        <div class="hero-sub">${m.sub ?? ""}</div>`;
    } else {
      const delta = m.delta ?? 0;
      const up = delta >= 0;
      const val =
        m.format === "money"
          ? fmtMoney(Number(m.value))
          : m.format === "pct"
            ? fmtPct(Number(m.value))
            : fmtInt(Number(m.value));
      card.innerHTML = `
        <div class="hero-label">${m.label}</div>
        <div class="hero-value-row">
          <span class="hero-value">${val}</span>
          <span class="hero-delta ${up ? "up" : "down"}">${up ? "+" : ""}${delta.toFixed(1)}%</span>
        </div>
        <div class="hero-spark">${sparklineSvg(m.spark ?? [])}</div>
        <div class="hero-delta-note">vs prior month</div>`;
    }
    heroRow.appendChild(card);
  }
  root.appendChild(heroRow);

  const mid = document.createElement("div");
  mid.className = "dashboard-mid";
  const chartPanel = document.createElement("div");
  chartPanel.className = "surface chart-panel";
  chartPanel.innerHTML = `
    <div class="block-head">
      <h3 class="block-title">Monthly performance</h3>
      <span class="block-meta">Invoice date · Revenue & profit</span>
    </div>
    <div class="chart-canvas-wrap"><canvas id="monthly-chart"></canvas></div>`;
  mid.appendChild(chartPanel);

  const lanesPanel = document.createElement("div");
  lanesPanel.className = "surface lanes-panel";
  lanesPanel.innerHTML = `<h3 class="block-title">Top lanes</h3>`;
  const laneList = document.createElement("ul");
  laneList.className = "lane-list";
  for (const row of exec.topLanes) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "lane-name";
    name.textContent = String(row.cells[0] ?? "");
    const loads = document.createElement("span");
    loads.className = "lane-loads";
    loads.textContent = `${formatCell(row.cells[1], "int")} loads`;
    li.append(name, loads);
    laneList.appendChild(li);
  }
  lanesPanel.appendChild(laneList);
  mid.appendChild(lanesPanel);
  root.appendChild(mid);

  const tablePanel = document.createElement("div");
  tablePanel.className = "surface table-section holdings-panel";
  tablePanel.innerHTML = `<div class="block-head"><h3 class="block-title">Dashboard - Top customers</h3><span class="block-meta">Click a row to focus</span></div>`;
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table holdings-table";
  table.innerHTML = `
    <thead><tr>
      <th class="col-text">Customer</th>
      <th class="num">Revenue</th>
      <th class="num">Profit</th>
      <th class="num">Margin</th>
      <th class="num">Loads</th>
    </tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  for (const row of exec.topCustomers) {
    const tr = document.createElement("tr");
    tr.className = "focusable";
    tr.addEventListener("click", () => handlers.onFocus("CLIENT NAME", String(row.focusValue)));

    const nameTd = document.createElement("td");
    nameTd.className = "hold-name col-text";
    nameTd.textContent = String(row.cells[0] ?? "");

    const revTd = document.createElement("td");
    revTd.className = "num";
    revTd.textContent = formatCell(row.cells[1], "money");

    const profitTd = document.createElement("td");
    profitTd.className = "num";
    profitTd.textContent = formatCell(row.cells[3], "money");

    const marginTd = document.createElement("td");
    marginTd.className = "num";
    marginTd.textContent = formatCell(row.cells[4], "pct");

    const loadsTd = document.createElement("td");
    loadsTd.className = "num";
    loadsTd.textContent = formatCell(row.cells[5], "int");

    tr.append(nameTd, revTd, profitTd, marginTd, loadsTd);
    setSortValue(nameTd, row.cells[0]);
    setSortValue(revTd, row.cells[1]);
    setSortValue(profitTd, row.cells[3]);
    setSortValue(marginTd, row.cells[4]);
    setSortValue(loadsTd, row.cells[5]);
    tbody?.appendChild(tr);
  }
  attachTableSort(table, {
    columnFormats: ["text", "money", "money", "pct", "int"],
  });
  scroll.appendChild(table);
  tablePanel.appendChild(scroll);
  root.appendChild(tablePanel);

  monthlyRaf = requestAnimationFrame(() => {
    monthlyRaf = 0;
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("monthly-chart"));
    if (canvas && exec.monthlyChart.labels.length) {
      monthlyChartInstance = renderMonthlyChart(canvas, exec.monthlyChart);
    } else if (chartPanel) {
      const wrap = chartPanel.querySelector(".chart-canvas-wrap");
      if (wrap) {
        wrap.innerHTML =
          '<p class="chart-empty">No invoice dates found — monthly chart needs INVOICE DATE on rows.</p>';
      }
    }
  });
}

export function teardownDashboardCharts() {
  if (monthlyRaf) {
    cancelAnimationFrame(monthlyRaf);
    monthlyRaf = 0;
  }
  if (railRaf) {
    cancelAnimationFrame(railRaf);
    railRaf = 0;
  }
  destroyChart(monthlyChartInstance);
  monthlyChartInstance = null;
  for (const c of railChartInstances) destroyChart(c);
  railChartInstances = [];
}
