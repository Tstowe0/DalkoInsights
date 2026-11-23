import { fmtMoney, fmtPct, fmtInt, formatCell } from "./format.js";
import {
  sparklineSvg,
  renderMonthlyChart,
  renderEquipmentDonut,
  destroyChart,
} from "./charts.js?v=20260922-corp2";
import { hasFocuses } from "../data/filters.js?v=20260916-bugsweep";
import { allowsAction } from "../../../../shared/js/permissions.js?v=20261123-carrier-access";

/** Name, revenue, cost, profit, margin, loads */
const COL_PNL = [0, 1, 2, 3, 4, 5];
/** Lane, loads, revenue, cost, profit, margin */
const COL_LANE = [0, 1, 2, 3, 4, 5];

/** @type {object | null} */
let execMonthlyChart = null;
/** @type {number} */
let execChartRaf = 0;

/**
 * Catalog of available reports. Add new entries here later.
 * @type {{ id: string, title: string, description: string, requiresResults: boolean }[]}
 */
export const REPORT_CATALOG = [
  {
    id: "executive-analytics",
    title: "Executive analytics",
    description:
      "Live snapshot of revenue, margin, mix, carriers, customers, and lanes from the current upload and focus.",
    requiresResults: true,
  },
];

/**
 * @param {string} reportId
 * @param {{
 *   results: object | null,
 *   fileName?: string | null,
 *   focus?: { enabled: boolean, column?: string | null, value?: string | null },
 *   dateFilter?: { enabled: boolean, column?: string, start?: Date | null, end?: Date | null },
 * }} ctx
 */
export function runReport(reportId, ctx) {
  if (reportId === "executive-analytics") {
    openExecutiveReport(ctx);
    return;
  }
  throw new Error(`Unknown report: ${reportId}`);
}

/**
 * @param {{
 *   results: object | null,
 *   fileName?: string | null,
 *   focus?: { enabled: boolean, column?: string | null, value?: string | null },
 *   dateFilter?: { enabled: boolean, column?: string, start?: Date | null, end?: Date | null },
 * }} opts
 */
export function openExecutiveReport(opts) {
  const { results, fileName, focus, dateFilter } = opts;
  const exec = results?.executive;
  if (!exec) throw new Error("No analysis results available.");

  const s = exec.summary ?? {};
  const generated = new Date().toLocaleString();
  const focusLine =
    focus?.enabled && focus.column ? `${focus.column} = ${focus.value ?? ""}` : "All loads";
  const dateLine = dateFilter?.enabled
    ? `${dateFilter.column ?? "Date"} · ${formatShortDate(dateFilter.start)} – ${formatShortDate(dateFilter.end)}`
    : "All dates";

  const logoUrl = new URL("../../../shared/images/earth.png", import.meta.url).href;
  const split = exec.equipmentSplit ?? { ltl: 0, truckload: 0, other: 0 };
  const splitTotal = (split.ltl ?? 0) + (split.truckload ?? 0) + (split.other ?? 0) || 1;
  const best = exec.bestCarrier;
  const acc = results.accessorials?.kpis;
  const fin = results.financial?.kpis ?? [];
  const accent = themeColor("--accent", "#2e90fa");
  const accentBlue = themeColor("--accent-blue", "#5a7fc4");
  const mutedFill = themeColor("--text-muted", "#6b778c");
  const charts = overviewCharts(exec);
  const ranks = reportRankHtml(results);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>DALKO · Executive analytics</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>${reportStyles()}</style>
</head>
<body>
  <div class="toolbar no-print">
    <div class="toolbar-brand">
      <img src="${escapeHtml(logoUrl)}" width="28" height="28" alt="" />
      <span>Executive analytics</span>
    </div>
    <div class="toolbar-actions">
      <button type="button" class="btn-ghost" onclick="window.close()">Close</button>
      <button type="button" class="btn-gold" onclick="window.print()">Print / PDF</button>
    </div>
  </div>

  <main class="page">
    <header class="cover">
      <div class="cover-brand">
        <img class="cover-logo" src="${escapeHtml(logoUrl)}" width="44" height="44" alt="" />
        <div>
          <p class="kicker">DALKO Insights</p>
          <h1>Executive analytics</h1>
        </div>
      </div>
      <div class="meta">
        <div><span>Generated</span><strong>${escapeHtml(generated)}</strong></div>
        <div><span>Source</span><strong>${escapeHtml(fileName || "—")}</strong></div>
        <div><span>Focus</span><strong>${escapeHtml(focusLine)}</strong></div>
        <div><span>Date range</span><strong>${escapeHtml(dateLine)}</strong></div>
      </div>
    </header>

    <section class="hero">
      ${heroCard("Total revenue", compactMoney(s.totalRevenue ?? 0))}
      ${heroCard("Gross profit", compactMoney(s.totalProfit ?? 0))}
      ${heroCard("Total loads", fmtInt(s.totalLoads ?? 0))}
      ${heroCard("Profit margin", fmtPct(s.margin ?? 0))}
      ${heroCard("Avg profit / load", compactMoney(s.avgProfitPerLoad ?? 0))}
      ${heroCard("Total miles", fmtInt(s.totalMiles ?? 0))}
    </section>

    ${
      charts.monthly
        ? `<section class="chart-shot chart-wide">
            <h2>Monthly performance</h2>
            <p class="rank-note">Invoice date · revenue and profit</p>
            <img src="${charts.monthly}" alt="Monthly revenue and profit" />
          </section>`
        : ""
    }

    <section class="split-row">
      <div class="panel">
        <h2>Equipment mix</h2>
        ${charts.donut ? `<img class="donut-img" src="${charts.donut}" alt="Equipment mix" />` : ""}
        <div class="mix">
          ${mixBar("LTL", split.ltl ?? 0, splitTotal, accent)}
          ${mixBar("Truckload", split.truckload ?? 0, splitTotal, accentBlue)}
          ${mixBar("Other / unknown", split.other ?? 0, splitTotal, mutedFill)}
        </div>
      </div>
      <div class="panel">
        <h2>Performance spotlight</h2>
        ${
          best?.name && best.z != null
            ? `<p class="spotlight-name">${escapeHtml(best.name)}</p>
               <dl class="spotlight-dl">
                 <div><dt>Transit Z-score</dt><dd>${best.z >= 0 ? "+" : ""}${best.z.toFixed(2)}</dd></div>
                 <div><dt>Loads</dt><dd>${fmtInt(best.loads ?? 0)}</dd></div>
                 <div><dt>Late</dt><dd>${fmtInt(best.late ?? 0)}</dd></div>
               </dl>
               `
            : `<p class="muted">${escapeHtml(best?.sub ?? "Insufficient transit data for carrier scoring.")}</p>`
        }
        ${
          acc
            ? `<div class="acc-foot"><span>Net accessorials</span><strong>${escapeHtml(compactMoney(acc.net))}</strong></div>`
            : ""
        }
      </div>
    </section>

    ${sectionFinancial(fin)}
    ${ranks}

    <footer class="foot">
      <span>DALKO Insights · Confidential</span>
      <span>Processed locally in your browser</span>
    </footer>
  </main>
  <script>
    window.addEventListener("load", function () {
      var start = function () { setTimeout(function () { window.print(); }, 200); };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(start).catch(start);
      else start();
    });
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error("Pop-up blocked. Allow pop-ups for this site to print the report.");
  }
  win.focus();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Destroy the executive monthly chart when leaving the reports view.
 */
export function teardownExecReport() {
  if (execChartRaf) {
    cancelAnimationFrame(execChartRaf);
    execChartRaf = 0;
  }
  destroyChart(execMonthlyChart);
  execMonthlyChart = null;
}

/**
 * Executive analytics page in the Insights workspace.
 * @param {HTMLElement} root
 * @param {{
 *   results: object | null,
 *   filters?: import("../data/filters.js").FilterState | null,
 *   fileName?: string | null,
 *   analysisComplete?: boolean,
 *   hasData?: boolean,
 * }} ctx
 * @param {() => void} [onPrint]
 */
export function renderReportsView(root, ctx, onPrint) {
  teardownExecReport();
  const results = ctx?.results ?? null;
  const hasResults = Boolean(results?.executive);
  if (!hasResults) {
    renderReportsEmpty(root, Boolean(ctx?.hasData), Boolean(ctx?.analysisComplete));
    return;
  }
  renderExecutiveInApp(root, ctx, onPrint);
}

function renderReportsEmpty(root, hasData, analysisComplete) {
  const surface = document.createElement("div");
  surface.className = "surface exec-empty";
  if (!hasData) {
    surface.innerHTML = `
      <h3 class="block-title">Executive analytics</h3>
      <p class="filters-lead">Upload a TMS Excel file to build this report from live Insights data — revenue, mix, carriers, and lanes.</p>`;
  } else if (!analysisComplete) {
    surface.innerHTML = `
      <h3 class="block-title">Building the report</h3>
      <p class="filters-lead">Analysis is still running on the current upload.</p>`;
  } else {
    surface.innerHTML = `
      <h3 class="block-title">No matching rows</h3>
      <p class="filters-lead">Nothing matches the current focus or date range. Clear focus and try again.</p>`;
  }
  root.appendChild(surface);
}

/**
 * @param {HTMLElement} root
 * @param {{ results: object, filters?: object | null, fileName?: string | null }} ctx
 * @param {() => void} [onPrint]
 */
function renderExecutiveInApp(root, ctx, onPrint) {
  const { results, filters, fileName } = ctx;
  const exec = results.executive;
  const s = exec.summary ?? {};
  const split = exec.equipmentSplit ?? { ltl: 0, truckload: 0, other: 0 };
  const splitTotal = (split.ltl ?? 0) + (split.truckload ?? 0) + (split.other ?? 0) || 1;
  const best = exec.bestCarrier;
  const acc = results.accessorials?.kpis;
  const statuses = exec.statusBreakdown ?? [];

  const wrap = document.createElement("div");
  wrap.className = "exec-report";

  const focusText =
    filters && hasFocuses(filters)
      ? filters.focuses.map((f) => `${f.column}: ${f.value}`).join(" · ")
      : "All loads";
  const dateText =
    filters?.dateFilterEnabled
      ? `${filters.dateFilterColumn || "Date"} · ${formatShortDate(filters.dateFilterStart)} – ${formatShortDate(filters.dateFilterEnd)}`
      : "All dates";

  wrap.innerHTML = `
    <header class="exec-head">
      <div>
        <h2 class="exec-title">Executive analytics</h2>
        <p class="exec-lead">Live snapshot of the current upload, date range, and focus.</p>
      </div>
      <button type="button" class="btn btn-primary" data-exec-print>Print / PDF</button>
    </header>
    <div class="exec-meta">
      <div><span>Source</span><strong>${escapeHtml(fileName || "—")}</strong></div>
      <div><span>Focus</span><strong>${escapeHtml(focusText)}</strong></div>
      <div><span>Date range</span><strong>${escapeHtml(dateText)}</strong></div>
      <div><span>Loads in view</span><strong>${escapeHtml(fmtInt(s.totalLoads ?? 0))}</strong></div>
    </div>
    <div class="hero-metrics exec-heroes">
      ${(exec.heroMetrics ?? []).map((m) => heroMetricHtml(m)).join("")}
    </div>
    <div class="exec-split">
      <section class="surface exec-panel">
        <h3 class="block-title">Equipment mix</h3>
        <div class="exec-mix">
          ${inAppMix("LTL", split.ltl ?? 0, splitTotal, "var(--accent)")}
          ${inAppMix("Truckload", split.truckload ?? 0, splitTotal, "var(--accent-blue)")}
          ${inAppMix("Other / unknown", split.other ?? 0, splitTotal, "var(--text-muted)")}
        </div>
      </section>
      <section class="surface exec-panel">
        <h3 class="block-title">Performance spotlight</h3>
        ${spotlightHtml(best, acc)}
      </section>
    </div>
    <section class="surface exec-panel exec-chart">
      <div class="block-head">
        <h3 class="block-title">Monthly performance</h3>
        <span class="block-meta">Invoice date · Revenue &amp; profit</span>
      </div>
      <div class="chart-canvas-wrap"><canvas id="exec-monthly-chart" aria-label="Monthly revenue and profit"></canvas></div>
    </section>
    ${
      statuses.length
        ? `<section class="surface exec-panel">
            <h3 class="block-title">Load status</h3>
            <div class="exec-mix">${statuses
              .slice(0, 8)
              .map((row) => inAppMix(row.status, row.count, s.totalLoads || 1, "var(--accent)"))
              .join("")}</div>
          </section>`
        : ""
    }
    ${inAppFinancial(results.financial?.kpis)}
    <div class="exec-grid">
      ${inAppTable("Top customers", results.customers, 8, COL_PNL)}
      ${inAppTable("Carrier profitability", results.carriers?.profitability, 8, COL_PNL)}
      ${inAppTable("Top lanes", results.lanes?.table, 8, COL_LANE)}
      ${inAppTable("Sales reps", results.salesReps, 8, COL_PNL)}
    </div>
  `;

  const printBtn = wrap.querySelector("[data-exec-print]");
  if (!allowsAction("insights:print") && printBtn instanceof HTMLElement) printBtn.hidden = true;
  printBtn?.addEventListener("click", () => onPrint?.());
  root.appendChild(wrap);
  mountExecMonthlyChart(wrap, exec.monthlyChart);
}

/** @param {object} m */
function heroMetricHtml(m) {
  if (m.format === "score") {
    const score = m.score ?? 0;
    return `<div class="hero-card">
      <div class="hero-label">${escapeHtml(m.label)}</div>
      <div class="hero-score-ring" style="--score:${score}"><span class="hero-score-val">${score}</span></div>
      <div class="hero-sub">${escapeHtml(m.sub ?? "")}</div>
    </div>`;
  }
  const delta = Number(m.delta ?? 0);
  const up = delta >= 0;
  const val =
    m.format === "money"
      ? fmtMoney(Number(m.value))
      : m.format === "pct"
        ? fmtPct(Number(m.value))
        : fmtInt(Number(m.value));
  return `<div class="hero-card">
    <div class="hero-label">${escapeHtml(m.label)}</div>
    <div class="hero-value-row">
      <span class="hero-value">${escapeHtml(val)}</span>
      <span class="hero-delta ${up ? "up" : "down"}">${up ? "+" : ""}${delta.toFixed(1)}%</span>
    </div>
    <div class="hero-spark">${sparklineSvg(m.spark ?? [])}</div>
    <div class="hero-delta-note">vs prior month</div>
  </div>`;
}

function spotlightHtml(best, acc) {
  if (!best?.name || best.z == null) {
    return `<p class="muted">${escapeHtml(best?.sub ?? "Add actual and expected transit days to score carriers.")}</p>`;
  }
  const zStr = `${best.z >= 0 ? "+" : ""}${best.z.toFixed(2)}`;
  return `
    <p class="exec-spot-name">${escapeHtml(best.name)}</p>
    <dl class="exec-spot-stats">
      <div><dt>Transit Z-score</dt><dd>${escapeHtml(zStr)}</dd></div>
      <div><dt>Loads</dt><dd>${escapeHtml(fmtInt(best.loads ?? 0))}</dd></div>
      <div><dt>Late</dt><dd>${escapeHtml(fmtInt(best.late ?? 0))}</dd></div>
    </dl>
    <p class="muted">${escapeHtml(best.sub ?? "")}</p>
    ${
      acc
        ? `<div class="exec-spot-foot"><span>Net accessorials</span><strong>${escapeHtml(fmtMoney(acc.net))}</strong></div>`
        : ""
    }`;
}

/**
 * @param {HTMLElement} root
 * @param {{ labels?: string[] } | null | undefined} monthly
 */
function mountExecMonthlyChart(root, monthly) {
  const canvas = /** @type {HTMLCanvasElement | null} */ (root.querySelector("#exec-monthly-chart"));
  if (!canvas) return;
  execChartRaf = requestAnimationFrame(() => {
    execChartRaf = 0;
    if (monthly?.labels?.length) {
      execMonthlyChart = renderMonthlyChart(canvas, monthly);
      return;
    }
    const wrap = canvas.closest(".chart-canvas-wrap");
    if (wrap) {
      wrap.innerHTML =
        '<p class="chart-empty">No invoice dates found — monthly chart needs INVOICE DATE on rows.</p>';
    }
  });
}

/** @param {{ label: string, value: unknown, format?: string, sub?: string }[] | null | undefined} kpis */
function inAppFinancial(kpis) {
  if (!kpis?.length) return "";
  const cards = kpis
    .slice(0, 4)
    .map((k) => {
      const val = formatCell(k.value, k.format);
      return `<div class="exec-fin-card">
        <span>${escapeHtml(k.label)}</span>
        <strong>${escapeHtml(val)}</strong>
        <em>${escapeHtml(k.sub ?? "")}</em>
      </div>`;
    })
    .join("");
  return `<section class="surface exec-panel">
    <h3 class="block-title">Collections</h3>
    <div class="exec-fin">${cards}</div>
  </section>`;
}

function inAppMix(label, value, total, color) {
  const pct = total ? (value / total) * 100 : 0;
  return `<div class="exec-mix-row">
    <span>${escapeHtml(label)}</span>
    <div class="exec-mix-track"><div class="exec-mix-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
    <strong>${pct.toFixed(0)}%</strong>
  </div>`;
}

/**
 * @param {string} title
 * @param {{ columns?: string[], rows?: { cells: unknown[], formats?: string[] }[] } | null | undefined} table
 * @param {number} limit
 * @param {number[]} colIndexes
 */
function inAppTable(title, table, limit, colIndexes) {
  if (!table?.rows?.length || !table.columns?.length) {
    return `<section class="surface exec-panel"><h3 class="block-title">${escapeHtml(title)}</h3><p class="muted">No data for this section.</p></section>`;
  }
  const headers = colIndexes.map((i) => table.columns[i] ?? `Col ${i}`);
  const numFlags = colIndexes.map((i) => {
    const fmt = table.rows[0]?.formats?.[i];
    return Boolean(fmt && fmt !== "text");
  });
  const rows = table.rows.slice(0, limit);
  const head = headers
    .map((h, i) => `<th class="${numFlags[i] ? "num" : "col-text"}">${escapeHtml(h)}</th>`)
    .join("");
  const body = rows
    .map((r) => {
      const cells = colIndexes
        .map((i, idx) => {
          const text = formatCell(r.cells[i], r.formats?.[i]);
          return `<td class="${numFlags[idx] ? "num" : "col-text"}">${escapeHtml(text)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<section class="surface exec-panel">
    <h3 class="block-title">${escapeHtml(title)}</h3>
    <div class="table-scroll">
      <table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>
  </section>`;
}

/** @param {string} name @param {string} fallback */
function themeColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function bakedTheme() {
  const keys = [
    "--bg",
    "--bg-main",
    "--card",
    "--text",
    "--text-muted",
    "--accent",
    "--accent-bright",
    "--accent-blue",
    "--ink",
    "--border",
    "--on-accent",
    "--toolbar-bg",
    "--color-scheme",
  ];
  /** @type {Record<string, string>} */
  const vars = {};
  for (const key of keys) vars[key] = themeColor(key, "");
  return vars;
}

function reportStyles() {
  const t = bakedTheme();
  const light = (t["--color-scheme"] || "").trim() === "light" || themeColor("--chart-style", "") === "corporate";
  const bg = t["--bg-main"] || t["--bg"] || (light ? "#f4f6fb" : "#030508");
  const card = t["--card"] || (light ? "#ffffff" : "#0c1322");
  const text = t["--text"] || (light ? "#1c2434" : "#ffffff");
  const muted = t["--text-muted"] || (light ? "#6b778c" : "#8b9cb8");
  const accent = t["--accent"] || (light ? "#2e90fa" : "#d9ae42");
  const ink = t["--ink"] || (light ? "#152033" : accent);
  const border = t["--border"] || (light ? "#e8edf5" : "rgba(255,255,255,0.08)");
  const onAccent = t["--on-accent"] || (light ? "#ffffff" : "#0a1018");
  const toolbar = t["--toolbar-bg"] || card;

  return `
    :root { color-scheme: ${light ? "light" : "dark"}; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: ${bg};
      color: ${text};
      font-family: Inter, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.45;
    }
    .toolbar {
      position: sticky; top: 0; z-index: 20;
      display: flex; align-items: center; justify-content: space-between;
      gap: 1rem; padding: 0.75rem 1.25rem;
      background: ${toolbar};
      border-bottom: 1px solid ${border};
    }
    .toolbar-brand { display: flex; align-items: center; gap: 0.6rem; color: ${ink}; font-weight: 650; }
    .toolbar-brand img { border-radius: 50%; }
    .toolbar-actions { display: flex; gap: 0.5rem; }
    .btn-gold, .btn-ghost {
      border: none; border-radius: 8px; padding: 0.55rem 0.95rem;
      font: inherit; font-weight: 600; cursor: pointer;
    }
    .btn-gold { background: ${ink}; color: ${onAccent}; }
    .btn-ghost { background: transparent; color: ${text}; border: 1px solid ${border}; }
    .page { max-width: 900px; margin: 0 auto; padding: 1.15rem 1.15rem 2rem; }
    .cover {
      border: 1px solid ${border};
      border-radius: 16px;
      background: ${card};
      padding: 1.35rem 1.4rem 1.15rem;
      margin-bottom: 1.15rem;
    }
    .cover-brand { display: flex; align-items: center; gap: 0.85rem; }
    .cover-logo { border-radius: 50%; }
    .kicker {
      margin: 0; font-size: 0.68rem; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase; color: ${muted};
    }
    h1 {
      margin: 0.12rem 0 0; font-size: 1.65rem; font-weight: 800;
      letter-spacing: -0.03em; color: ${ink};
    }
    .meta {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem 1.25rem;
      margin-top: 1rem; font-size: 0.8rem;
    }
    .meta span { display: block; color: ${muted}; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .meta strong { color: ${text}; font-weight: 600; }
    .hero {
      display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem;
      margin-bottom: 0.85rem;
    }
    .hero-card {
      background: ${card};
      border: 1px solid ${border};
      border-radius: 10px;
      padding: 0.55rem 0.6rem 0.6rem;
      border-top: 2px solid ${accent};
    }
    .hero-card span {
      display: block; color: ${muted}; font-size: 0.68rem;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .hero-card strong {
      display: block; margin-top: 0.2rem; font-size: 0.92rem; color: ${ink};
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .split-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem;
      margin-bottom: 1.15rem;
    }
    .panel {
      background: ${card};
      border: 1px solid ${border};
      border-radius: 12px;
      padding: 0.95rem 1rem 1rem;
    }
    h2 {
      margin: 0 0 0.75rem;
      font-size: 0.95rem; font-weight: 700;
      color: ${ink};
      border-bottom: 1px solid ${border};
      padding-bottom: 0.4rem;
    }
    h3 {
      margin: 0 0 0.5rem;
      font-size: 0.8rem;
      font-weight: 700;
      color: ${ink};
    }
    .section { margin-bottom: 1.25rem; break-inside: avoid; }
    .rank-note { margin: -0.25rem 0 0.75rem; color: ${muted}; font-size: 0.75rem; }
    .rank-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.6rem;
      margin-bottom: 0.75rem;
    }
    .rank-card {
      background: ${card};
      border: 1px solid ${border};
      border-radius: 12px;
      padding: 0.65rem 0.7rem 0.5rem;
      break-inside: avoid;
    }
    .rank-card.wide { grid-column: 1 / -1; }
    .rank-head {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 0.5rem; margin-bottom: 0.35rem;
    }
    .rank-head h2 { margin: 0; border: none; padding: 0; font-size: 0.84rem; }
    .rank-head span { color: ${muted}; font-size: 0.66rem; white-space: nowrap; }
    .mini-stats {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem;
      margin-bottom: 0.5rem;
    }
    .mini-stats div {
      border: 1px solid ${border}; border-radius: 8px; padding: 0.35rem 0.45rem;
    }
    .mini-stats span {
      display: block; color: ${muted}; font-size: 0.6rem;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .mini-stats strong { font-size: 0.82rem; color: ${ink}; font-variant-numeric: tabular-nums; }
    .chart-shot {
      background: ${card};
      border: 1px solid ${border};
      border-radius: 12px;
      padding: 0.85rem 0.95rem 0.75rem;
      break-inside: avoid;
    }
    .chart-wide { margin-bottom: 1.15rem; }
    .chart-shot h2, .chart-shot h3 { border-bottom: none; margin-bottom: 0.35rem; padding-bottom: 0; }
    .chart-shot img, .donut-img { width: 100%; height: auto; display: block; }
    .donut-img { width: 180px; margin: 0 auto 0.75rem; }
    table {
      width: 100%; border-collapse: collapse; font-size: 0.78rem;
      background: ${card};
      border: 1px solid ${border};
      border-radius: 10px; overflow: hidden;
    }
    th, td {
      padding: 0.45rem 0.65rem;
      border-bottom: 1px solid ${border};
      text-align: left; vertical-align: middle;
    }
    th {
      background: ${toolbar};
      color: ${muted};
      font-size: 0.65rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    tr:nth-child(even) td { background: ${light ? toolbar : "rgba(255,255,255,0.03)"}; }
    tr:last-child td { border-bottom: none; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.fit { table-layout: fixed; font-size: 0.68rem; border-radius: 8px; }
    table.fit th, table.fit td { padding: 0.22rem 0.34rem; }
    table.fit th { font-size: 0.58rem; letter-spacing: 0.04em; }
    table.fit th.name { width: 46%; }
    table.fit td.name {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    table.fit tr.band td {
      padding: 0.38rem 0.34rem 0.08rem;
      border-bottom: none;
      background: transparent;
      color: ${muted};
      font-size: 0.58rem; font-weight: 700;
      letter-spacing: 0.08em; text-transform: uppercase;
    }
    table.fit tbody tr:nth-child(even):not(.band) td { background: ${light ? toolbar : "rgba(255,255,255,0.03)"}; }
    .stat-strip { margin-bottom: 0.75rem; }
    .stat-strip h2 { margin-bottom: 0.45rem; }
    .stat-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.4rem; }
    .stat-row div {
      background: ${card}; border: 1px solid ${border}; border-radius: 10px;
      padding: 0.4rem 0.45rem 0.45rem;
    }
    .stat-row span {
      display: block; color: ${muted}; font-size: 0.58rem;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .stat-row strong {
      display: block; margin-top: 0.15rem; color: ${ink};
      font-size: 0.82rem; font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .muted { color: ${muted}; }
    .mix { display: flex; flex-direction: column; gap: 0.65rem; }
    .mix-row { display: grid; grid-template-columns: 7rem 1fr 3.2rem; gap: 0.5rem; align-items: center; }
    .mix-row span { color: ${muted}; font-size: 0.75rem; }
    .mix-track { height: 8px; border-radius: 999px; background: ${border}; overflow: hidden; }
    .mix-fill { height: 100%; border-radius: inherit; }
    .mix-row strong { text-align: right; font-size: 0.78rem; }
    .spotlight-name { margin: 0 0 0.65rem; font-size: 1rem; font-weight: 650; color: ${ink}; }
    .spotlight-dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin: 0 0 0.5rem; }
    .spotlight-dl dt { color: ${muted}; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .spotlight-dl dd { margin: 0.15rem 0 0; font-weight: 700; color: ${accent}; font-size: 1rem; }
    .acc-foot {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-top: 0.75rem; padding-top: 0.65rem;
      border-top: 1px solid ${border};
      color: ${muted}; font-size: 0.78rem;
    }
    .acc-foot strong { color: ${ink}; font-size: 0.95rem; }
    .foot {
      display: flex; justify-content: space-between; gap: 1rem;
      margin-top: 1.5rem; padding-top: 0.85rem;
      border-top: 1px solid ${border};
      color: ${muted}; font-size: 0.72rem;
    }
    @page { margin: 0.5in; }
    @media print {
      .no-print { display: none !important; }
      body { background: ${bg}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { max-width: none; padding: 0; }
      .cover, .panel, .hero-card, .rank-card, .chart-shot, .stat-row div { break-inside: avoid; }
      tr { break-inside: avoid; }
      .hero { grid-template-columns: repeat(3, 1fr); }
      .stat-row { grid-template-columns: repeat(3, 1fr); }
    }
    @media (max-width: 800px) {
      .hero, .split-row, .meta, .rank-grid, .stat-row, .mini-stats { grid-template-columns: 1fr; }
    }
  `;
}

/** @param {string} label @param {string} value */
function heroCard(label, value) {
  return `<div class="hero-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

/**
 * @param {string} label
 * @param {number} value
 * @param {number} total
 * @param {string} color
 */
function mixBar(label, value, total, color) {
  const pct = total ? (value / total) * 100 : 0;
  return `<div class="mix-row">
    <span>${escapeHtml(label)}</span>
    <div class="mix-track"><div class="mix-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
    <strong>${pct.toFixed(0)}%</strong>
  </div>`;
}

/**
 * Draw a chart off-screen and return a PNG data URL with the card color behind it.
 * @param {number} width
 * @param {number} height
 * @param {(canvas: HTMLCanvasElement) => object | null} render
 */
function snapshotChart(width, height, render) {
  if (typeof Chart === "undefined") return "";
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-12000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  host.appendChild(canvas);
  document.body.appendChild(host);
  /** @type {object | null} */
  let chart = null;
  try {
    chart = render(canvas);
    if (!chart?.canvas) return "";
    chart.options.animation = false;
    chart.options.devicePixelRatio = 2;
    chart.resize(width, height);
    chart.stop?.();
    chart.update("none");
    const src = /** @type {HTMLCanvasElement} */ (chart.canvas);
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle = themeColor("--card", "#ffffff");
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    return out.toDataURL("image/png");
  } catch (err) {
    console.error(err);
    return "";
  } finally {
    destroyChart(chart);
    host.remove();
  }
}

/**
 * @param {object} exec
 */
function overviewCharts(exec) {
  const monthly = exec?.monthlyChart?.labels?.length
    ? snapshotChart(760, 210, (canvas) => renderMonthlyChart(canvas, exec.monthlyChart))
    : "";
  const donut = exec?.equipmentSplit
    ? snapshotChart(240, 180, (canvas) => renderEquipmentDonut(canvas, exec.equipmentSplit))
    : "";
  return { monthly, donut };
}

/**
 * Highest rows stay in `top`. `bottom` is the lowest rows that are not already in `top`, worst first.
 * @param {object[]} rows
 * @param {number} n
 */
function splitTopBottom(rows, n) {
  const list = rows ?? [];
  const top = list.slice(0, Math.min(n, list.length));
  const topSet = new Set(top);
  /** @type {object[]} */
  const bottom = [];
  for (let i = list.length - 1; i >= 0 && bottom.length < n; i--) {
    if (topSet.has(list[i])) continue;
    bottom.push(list[i]);
  }
  return { top, bottom };
}

/** @param {unknown} value */
function compactMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  const trim = (s) => s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (a >= 999_500) return `${sign}$${trim((a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2))}M`;
  if (a >= 1_000) return `${sign}$${trim((a / 1_000).toFixed(a >= 100_000 ? 0 : 1))}k`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

/** @param {string} value @param {number} max */
function clipLabel(value, max = 32) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @param {object} row
 * @param {{ kind: string, index?: number, indexes?: number[] }} field
 */
function rankFieldText(row, field) {
  if (field.kind === "place") {
    const city = String(row.cells?.[field.indexes?.[0] ?? 0] ?? "");
    const state = String(row.cells?.[field.indexes?.[1] ?? 1] ?? "");
    const place = state && state !== "—" ? `${city}, ${state}` : city;
    return place;
  }
  if (field.kind === "name") return String(row.focusValue ?? row.cells?.[field.index ?? 0] ?? "");
  const raw = row.cells?.[field.index ?? 0];
  if (field.kind === "money") return compactMoney(raw);
  if (field.kind === "pct") return fmtPct(Number(raw) || 0);
  if (field.kind === "int") return fmtInt(Number(raw) || 0);
  if (field.kind === "z") return formatCell(raw, "zscore");
  return String(raw ?? "");
}

/**
 * @param {{ label: string, kind: string, index?: number, indexes?: number[] }[]} fields
 * @param {object[]} top
 * @param {object[]} bottom
 */
function fitRankTable(fields, top, bottom) {
  const head = fields
    .map((field, i) => `<th class="${i ? "num" : "name"}">${escapeHtml(field.label)}</th>`)
    .join("");
  const renderRows = (list) =>
    list
      .map((row) => {
        const cells = fields
          .map((field, i) => {
            const full = rankFieldText(row, field);
            if (i === 0) {
              return `<td class="name" title="${escapeHtml(full)}">${escapeHtml(clipLabel(full))}</td>`;
            }
            return `<td class="num">${escapeHtml(full)}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
  const span = fields.length;
  const body = bottom.length
    ? `<tr class="band"><td colspan="${span}">Top</td></tr>${renderRows(top)}<tr class="band band-low"><td colspan="${span}">Bottom</td></tr>${renderRows(bottom)}`
    : renderRows(top);
  return `<table class="fit"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * @param {{
 *   title: string,
 *   metric: string,
 *   note?: string,
 *   table: { columns?: string[], rows?: object[], ranked?: object[] } | null | undefined,
 *   fields: { label: string, kind: string, index?: number, indexes?: number[] }[],
 * }} spec
 */
function rankCard(spec) {
  const table = spec.table;
  const source = table?.ranked?.length ? table.ranked : (table?.rows ?? []);
  if (!source.length || !table?.columns?.length) return "";
  const { top, bottom } = splitTopBottom(source, 5);
  const note = spec.note ?? `By ${spec.metric}`;
  return `<article class="rank-card">
    <div class="rank-head"><h2>${escapeHtml(spec.title)}</h2><span>${escapeHtml(note)}</span></div>
    ${fitRankTable(spec.fields, top, bottom)}
  </article>`;
}

/** @param {string} label */
function pnlFields(label) {
  return [
    { label, kind: "name" },
    { label: "Revenue", kind: "money", index: 1 },
    { label: "Margin", kind: "pct", index: 4 },
    { label: "Loads", kind: "int", index: 5 },
  ];
}

/**
 * @param {{ columns?: string[], rows?: { cells: unknown[] }[] } | null | undefined} perf
 */
function scoredPerformance(perf) {
  if (!perf?.rows?.length || !perf.columns?.length) return null;
  const rows = perf.rows.filter((r) => r.cells[2] != null && Number.isFinite(Number(r.cells[2])));
  if (!rows.length) return null;
  return { columns: perf.columns, rows };
}

/** @param {object} results */
function reportRankHtml(results) {
  const cards = [
    rankCard({
      title: "Lanes",
      metric: "revenue",
      table: results.lanes?.table,
      fields: [
        { label: "Lane", kind: "name" },
        { label: "Loads", kind: "int", index: 1 },
        { label: "Revenue", kind: "money", index: 2 },
        { label: "Margin", kind: "pct", index: 5 },
      ],
    }),
    rankCard({
      title: "Customers",
      metric: "revenue",
      table: results.customers,
      fields: pnlFields("Customer"),
    }),
    rankCard({
      title: "Carriers",
      metric: "revenue",
      table: results.carriers?.profitability,
      fields: pnlFields("Carrier"),
    }),
    rankCard({
      title: "Carrier performance",
      metric: "Z-score",
      note: "10+ loads with transit days",
      table: scoredPerformance(results.carriers?.performance),
      fields: [
        { label: "Carrier", kind: "name" },
        { label: "On time", kind: "pct", index: 1 },
        { label: "Z", kind: "z", index: 2 },
        { label: "Loads", kind: "int", index: 5 },
      ],
    }),
    rankCard({
      title: "Sales reps",
      metric: "revenue",
      table: results.salesReps,
      fields: pnlFields("Rep"),
    }),
    rankCard({
      title: "Origin states",
      metric: "loads",
      table: results.geographic?.origin,
      fields: [
        { label: "State", kind: "name" },
        { label: "Loads", kind: "int", index: 1 },
        { label: "Revenue", kind: "money", index: 2 },
      ],
    }),
    rankCard({
      title: "Destination states",
      metric: "loads",
      table: results.geographic?.dest,
      fields: [
        { label: "State", kind: "name" },
        { label: "Loads", kind: "int", index: 1 },
        { label: "Revenue", kind: "money", index: 2 },
      ],
    }),
    rankCard({
      title: "Origin cities",
      metric: "loads",
      table: results.cities?.origin,
      fields: [
        { label: "City", kind: "place", indexes: [0, 1] },
        { label: "Loads", kind: "int", index: 2 },
        { label: "Revenue", kind: "money", index: 3 },
      ],
    }),
    rankCard({
      title: "Destination cities",
      metric: "loads",
      table: results.cities?.dest,
      fields: [
        { label: "City", kind: "place", indexes: [0, 1] },
        { label: "Loads", kind: "int", index: 2 },
        { label: "Revenue", kind: "money", index: 3 },
      ],
    }),
    rankCard({
      title: "Division",
      metric: "revenue",
      table: results.officeDivision?.division,
      fields: pnlFields("Division"),
    }),
    rankCard({
      title: "Office",
      metric: "revenue",
      table: results.officeDivision?.office,
      fields: pnlFields("Office"),
    }),
    rankCard({
      title: "LTL equipment",
      metric: "revenue",
      table: results.ltl?.table,
      fields: pnlFields("Equipment"),
    }),
    rankCard({
      title: "Truckload equipment",
      metric: "revenue",
      table: results.truckload?.table,
      fields: pnlFields("Equipment"),
    }),
    sectionAccessorials(results.accessorials),
  ].filter(Boolean);
  if (!cards.length) return "";
  return `<div class="rank-grid">${cards.join("")}</div>`;
}

/** @param {object | null | undefined} acc */
function sectionAccessorials(acc) {
  if (!acc?.hasAccessorialColumns) return "";
  const k = acc.kpis ?? {};
  const types = (acc.typeRows ?? []).slice(0, 5);
  const rows = types
    .map((t) => {
      const name = String(t.type ?? "");
      return `<tr><td class="name" title="${escapeHtml(name)}">${escapeHtml(clipLabel(name))}</td><td class="num">${escapeHtml(compactMoney(t.sell))}</td><td class="num">${escapeHtml(compactMoney(t.net))}</td></tr>`;
    })
    .join("");
  const table = rows
    ? `<table class="fit"><thead><tr><th class="name">Type</th><th class="num">Sell</th><th class="num">Net</th></tr></thead><tbody>${rows}</tbody></table>`
    : "";
  return `<article class="rank-card wide">
    <div class="rank-head"><h2>Accessorials</h2><span>Top types by volume</span></div>
    <div class="mini-stats">
      <div><span>Sell</span><strong>${escapeHtml(compactMoney(k.totalSell))}</strong></div>
      <div><span>Buy</span><strong>${escapeHtml(compactMoney(k.totalBuy))}</strong></div>
      <div><span>Net</span><strong>${escapeHtml(compactMoney(k.net))}</strong></div>
      <div><span>Loads</span><strong>${escapeHtml(fmtInt(k.loadsWith ?? 0))}</strong></div>
    </div>
    ${table}
  </article>`;
}

/** @param {{ label: string, value: unknown, format?: string }[]} kpis */
function sectionFinancial(kpis) {
  if (!kpis?.length) return "";
  const tiles = kpis
    .map((k) => {
      const val =
        k.format === "money"
          ? compactMoney(k.value)
          : k.format === "pct"
            ? fmtPct(Number(k.value))
            : fmtInt(Number(k.value));
      return `<div><span>${escapeHtml(k.label)}</span><strong>${escapeHtml(val)}</strong></div>`;
    })
    .join("");
  return `<section class="stat-strip"><h2>Collections</h2><div class="stat-row">${tiles}</div></section>`;
}

/** @param {Date | null | undefined} d */
function formatShortDate(d) {
  if (!d || Number.isNaN(d.getTime?.() ? d.getTime() : NaN)) return "…";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
