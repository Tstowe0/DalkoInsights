import { fmtMoney, fmtPct, fmtInt } from "./format.js";
import {
  renderRailRankChart,
  renderRailSellBuyChart,
  renderRailSplitDonut,
  destroyChart,
} from "./charts.js";
import { renderDashboardRail, teardownDashboardCharts } from "./dashboard-view.js";

const GOLD_BRIGHT = "#f0c14a";

/** Views that show the right-hand insight rail */
export const RAIL_VIEWS = new Set([
  "dashboard",
  "customers",
  "carriers",
  "salesReps",
  "lanes",
  "accessorials",
  "financial",
]);

/** @type {object[]} */
let pageRailCharts = [];
/** @type {number} */
let pageRailRaf = 0;

export function teardownPageRails() {
  if (pageRailRaf) {
    cancelAnimationFrame(pageRailRaf);
    pageRailRaf = 0;
  }
  for (const c of pageRailCharts) destroyChart(c);
  pageRailCharts = [];
}

/** Tear down page rails and dashboard rail/monthly charts */
export function teardownAllRails() {
  teardownPageRails();
  teardownDashboardCharts();
}

/**
 * @param {HTMLElement} rail
 * @param {string} viewId
 * @param {object} results
 */
export function renderViewRail(rail, viewId, results) {
  teardownPageRails();
  if (viewId === "dashboard") {
    renderDashboardRail(rail, results);
    return;
  }
  // Leaving dashboard rail charts behind if we navigated from dashboard
  // renderDashboardRail owns those; clear them without touching monthly (already gone)
  teardownDashboardCharts();

  if (viewId === "customers") renderCustomersRail(rail, results);
  else if (viewId === "carriers") renderCarriersRail(rail, results);
  else if (viewId === "salesReps") renderSalesRepsRail(rail, results);
  else if (viewId === "lanes") renderLanesRail(rail, results);
  else if (viewId === "accessorials") renderAccessorialsRail(rail, results);
  else if (viewId === "financial") renderFinancialRail(rail, results);
}

/**
 * @param {string} title
 * @param {{ label: string, value: string }[]} stats
 * @param {{ caption?: string, canvasId: string, heightClass?: string }} [chart]
 */
function buildRailShell(title, stats, chart) {
  const section = document.createElement("div");
  section.className = "rail-section";

  const h = document.createElement("h4");
  h.className = "rail-title";
  h.textContent = title;
  section.appendChild(h);

  for (const s of stats) {
    const row = document.createElement("div");
    row.className = "rail-stat";
    const muted = document.createElement("span");
    muted.className = "muted";
    muted.textContent = s.label;
    const strong = document.createElement("strong");
    strong.textContent = s.value;
    row.append(muted, strong);
    section.appendChild(row);
  }

  if (chart) {
    if (chart.caption) {
      const cap = document.createElement("p");
      cap.className = "rail-chart-caption";
      cap.textContent = chart.caption;
      section.appendChild(cap);
    }
    const wrap = document.createElement("div");
    wrap.className = `rail-chart-wrap ${chart.heightClass ?? "rail-chart-wrap--carriers"}`;
    const canvas = document.createElement("canvas");
    canvas.id = chart.canvasId;
    wrap.appendChild(canvas);
    section.appendChild(wrap);
  }

  return section;
}

/** @param {() => (object | null | undefined)} paint */
function scheduleChart(paint) {
  pageRailRaf = requestAnimationFrame(() => {
    pageRailRaf = 0;
    const chart = paint();
    if (chart) pageRailCharts.push(chart);
  });
}

/** @param {HTMLElement} rail @param {object} results */
function renderCustomersRail(rail, results) {
  rail.innerHTML = "";
  const rows = results.customers?.rows ?? [];
  const totalRevenue = Number(results.executive?.summary?.totalRevenue ?? 0);
  const totalProfit = Number(results.executive?.summary?.totalProfit ?? 0);
  const portfolioMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const top5 = rows.slice(0, 5);
  const top5Rev = top5.reduce((s, r) => s + Number(r.cells[1] ?? 0), 0);
  const share = totalRevenue > 0 ? (top5Rev / totalRevenue) * 100 : 0;
  const leaderMargin = Number(top5[0]?.cells[4] ?? 0);
  const marginDelta = leaderMargin - portfolioMargin;

  const stats = [
    { label: "Top 5 revenue share", value: fmtPct(share) },
    { label: "Leader margin", value: top5[0] ? fmtPct(leaderMargin) : "—" },
    {
      label: "vs portfolio margin",
      value: top5[0]
        ? `${marginDelta >= 0 ? "+" : ""}${marginDelta.toFixed(1)} pts`
        : "—",
    },
    { label: "Customers in view", value: fmtInt(rows.length) },
  ];

  rail.appendChild(
    buildRailShell("Customer concentration", stats, {
      caption: "Top 5 by revenue",
      canvasId: "rail-page-chart",
    })
  );

  scheduleChart(() => {
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("rail-page-chart"));
    if (!canvas || !top5.length) return null;
    return renderRailRankChart(
      canvas,
      top5.map((r) => ({
        name: String(r.focusValue ?? r.cells[0]),
        value: Number(r.cells[1]),
      })),
      { valueLabel: "Revenue", format: "money" }
    );
  });
}

/** @param {HTMLElement} rail @param {object} results */
function renderCarriersRail(rail, results) {
  rail.innerHTML = "";
  const perfRows = results.carriers?.performance?.rows ?? [];
  const scored = perfRows
    .map((r) => ({
      name: String(r.focusValue ?? r.cells[0]),
      z: r.cells[2] == null ? null : Number(r.cells[2]),
      onTimePct: Number(r.cells[1] ?? 0),
      late: Number(r.cells[4] ?? 0),
      loads: Number(r.cells[5] ?? 0),
    }))
    .filter((r) => r.z != null && Number.isFinite(r.z));

  const byZ = [...scored].sort((a, b) => /** @type {number} */ (b.z) - /** @type {number} */ (a.z));
  const best = byZ[0];
  const worst = byZ[byZ.length - 1];
  const top5 = byZ.slice(0, 5);

  const stats = [
    {
      label: "Best Z-score",
      value: best ? `${best.z >= 0 ? "+" : ""}${best.z.toFixed(2)}` : "—",
    },
    { label: "Best on-time", value: best ? fmtPct(best.onTimePct) : "—" },
    { label: "Watch list late loads", value: worst ? fmtInt(worst.late) : "—" },
    { label: "Scored carriers", value: fmtInt(scored.length) },
  ];

  if (!scored.length) {
    const empty = buildRailShell("Carrier performance", stats);
    const note = document.createElement("p");
    note.className = "rail-chart-caption";
    note.textContent = "Need ≥10 loads with transit days to score carriers.";
    empty.appendChild(note);
    rail.appendChild(empty);
    return;
  }

  rail.appendChild(
    buildRailShell("Carrier performance", stats, {
      caption: "Top 5 by Z-score",
      canvasId: "rail-page-chart",
    })
  );

  scheduleChart(() => {
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("rail-page-chart"));
    if (!canvas || !top5.length) return null;
    return renderRailRankChart(
      canvas,
      top5.map((r) => ({ name: r.name, value: /** @type {number} */ (r.z) })),
      { valueLabel: "Z-score", format: "number" }
    );
  });
}

/** @param {HTMLElement} rail @param {object} results */
function renderSalesRepsRail(rail, results) {
  rail.innerHTML = "";
  const rows = [...(results.salesReps?.rows ?? [])].sort(
    (a, b) => Number(b.cells[3] ?? 0) - Number(a.cells[3] ?? 0)
  );
  const top5 = rows.slice(0, 5);
  const leader = top5[0];
  const leaderLoads = Number(leader?.cells[5] ?? 0);
  const leaderCustomers = Number(leader?.cells[6] ?? 0);
  const depth = leaderCustomers > 0 ? leaderLoads / leaderCustomers : 0;

  const stats = [
    { label: "Leader profit", value: leader ? fmtMoney(Number(leader.cells[3])) : "—" },
    { label: "Leader loads", value: leader ? fmtInt(leaderLoads) : "—" },
    { label: "Leader customers", value: leader ? fmtInt(leaderCustomers) : "—" },
    { label: "Loads / customer", value: leader ? depth.toFixed(1) : "—" },
  ];

  rail.appendChild(
    buildRailShell("Sales book mix", stats, {
      caption: "Top 5 by profit",
      canvasId: "rail-page-chart",
    })
  );

  scheduleChart(() => {
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("rail-page-chart"));
    if (!canvas || !top5.length) return null;
    return renderRailRankChart(
      canvas,
      top5.map((r) => ({
        name: String(r.focusValue ?? r.cells[0]),
        value: Number(r.cells[3]),
      })),
      { valueLabel: "Profit", format: "money" }
    );
  });
}

/** @param {HTMLElement} rail @param {object} results */
function renderLanesRail(rail, results) {
  rail.innerHTML = "";
  const rows = [...(results.lanes?.table?.rows ?? [])].sort(
    (a, b) => Number(b.cells[9] ?? 0) - Number(a.cells[9] ?? 0)
  );
  const top5 = rows.slice(0, 5);
  const busiest = [...(results.lanes?.table?.rows ?? [])].sort(
    (a, b) => Number(b.cells[1] ?? 0) - Number(a.cells[1] ?? 0)
  )[0];
  const leader = top5[0];

  const stats = [
    { label: "Best profit / mile", value: leader ? fmtMoney(Number(leader.cells[9])) : "—" },
    { label: "Best lane margin", value: leader ? fmtPct(Number(leader.cells[5])) : "—" },
    {
      label: "Busiest lane loads",
      value: busiest ? fmtInt(Number(busiest.cells[1])) : "—",
    },
    {
      label: "Avg miles (top $/mi)",
      value: leader ? fmtInt(Number(leader.cells[6])) : "—",
    },
  ];

  rail.appendChild(
    buildRailShell("Lane economics", stats, {
      caption: "Top 5 by profit / mile",
      canvasId: "rail-page-chart",
    })
  );

  scheduleChart(() => {
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("rail-page-chart"));
    if (!canvas || !top5.length) return null;
    return renderRailRankChart(
      canvas,
      top5.map((r) => ({
        name: String(r.focusValue ?? r.cells[0]),
        value: Number(r.cells[9]),
      })),
      { valueLabel: "Profit / mile", format: "money" }
    );
  });
}

/** @param {HTMLElement} rail @param {object} results */
function renderAccessorialsRail(rail, results) {
  rail.innerHTML = "";
  const acc = results.accessorials;
  if (!acc?.hasAccessorialColumns) {
    const empty = buildRailShell("Accessorial P&L", [
      { label: "Status", value: "No ACCESSORIAL columns" },
    ]);
    rail.appendChild(empty);
    return;
  }

  const k = acc.kpis;
  const topTypes = [...(acc.typeRows ?? [])]
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 5);

  const stats = [
    { label: "Net accessorials", value: fmtMoney(k.net) },
    { label: "Loads with fees", value: `${fmtInt(k.loadsWith)} (${fmtPct(k.pct)})` },
    { label: "Sell-side total", value: fmtMoney(k.totalSell) },
    { label: "Buy-side total", value: fmtMoney(k.totalBuy) },
  ];

  rail.appendChild(
    buildRailShell("Accessorial P&L", stats, {
      caption: "Top types · sell vs buy",
      canvasId: "rail-page-chart",
      heightClass: "rail-chart-wrap--carriers",
    })
  );

  scheduleChart(() => {
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("rail-page-chart"));
    if (!canvas || !topTypes.length) return null;
    return renderRailSellBuyChart(
      canvas,
      topTypes.map((t) => ({ name: t.type, sell: t.sell, buy: t.buy }))
    );
  });
}

/** @param {HTMLElement} rail @param {object} results */
function renderFinancialRail(rail, results) {
  rail.innerHTML = "";
  const kpis = results.financial?.kpis ?? [];
  /** @param {string} label */
  const kpiVal = (label) => kpis.find((k) => k.label === label)?.value;

  const outstanding = Number(kpiVal("Outstanding balance") ?? 0);
  const received = Number(kpiVal("Total received") ?? 0);
  const paid = Number(kpiVal("Paid invoices") ?? 0);
  const unpaid = Number(kpiVal("Unpaid invoices") ?? 0);
  const avgDays = Number(kpiVal("Avg days to pay") ?? 0);
  const total = paid + unpaid;
  const paymentRate = total ? (paid / total) * 100 : 0;

  const stats = [
    { label: "Outstanding", value: fmtMoney(outstanding) },
    { label: "Received", value: fmtMoney(received) },
    { label: "Payment rate", value: fmtPct(paymentRate) },
    { label: "Avg days to pay", value: fmtInt(avgDays) },
  ];

  rail.appendChild(
    buildRailShell("Cash health", stats, {
      caption: "Paid vs unpaid invoices",
      canvasId: "rail-page-chart",
      heightClass: "rail-chart-wrap--spotlight",
    })
  );

  const wrap = rail.querySelector(".rail-chart-wrap");
  if (wrap) wrap.classList.add("donut-wrap");

  scheduleChart(() => {
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("rail-page-chart"));
    if (!canvas || total <= 0) return null;
    return renderRailSplitDonut(canvas, {
      a: paid,
      b: unpaid,
      labelA: "Paid",
      labelB: "Unpaid",
      centerCaption: "paid",
      colorA: GOLD_BRIGHT,
      colorB: "rgba(239, 107, 107, 0.8)",
    });
  });
}
