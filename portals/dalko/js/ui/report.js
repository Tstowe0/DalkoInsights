import { fmtMoney, fmtPct, fmtInt, formatCell } from "./format.js";
import { sparklineSvg, renderMonthlyChart, destroyChart } from "./charts.js?v=20260922-corp2";
import { hasFocuses } from "../data/filters.js?v=20260916-bugsweep";

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
      ${heroCard("Total revenue", fmtMoney(s.totalRevenue ?? 0))}
      ${heroCard("Gross profit", fmtMoney(s.totalProfit ?? 0))}
      ${heroCard("Total loads", fmtInt(s.totalLoads ?? 0))}
      ${heroCard("Profit margin", fmtPct(s.margin ?? 0))}
      ${heroCard("Avg profit / load", fmtMoney(s.avgProfitPerLoad ?? 0))}
      ${heroCard("Total miles", fmtInt(s.totalMiles ?? 0))}
    </section>

    <section class="split-row">
      <div class="panel">
        <h2>Equipment mix</h2>
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
               <p class="muted">${escapeHtml(best.sub ?? "")}</p>`
            : `<p class="muted">${escapeHtml(best?.sub ?? "Insufficient transit data for carrier scoring.")}</p>`
        }
        ${
          acc
            ? `<div class="acc-foot"><span>Net accessorials</span><strong>${escapeHtml(fmtMoney(acc.net))}</strong></div>`
            : ""
        }
      </div>
    </section>

    ${sectionFromResultTable("Top customers", results.customers, 12, COL_PNL)}
    ${sectionFromResultTable("Carrier profitability", results.carriers?.profitability, 10, COL_PNL)}
    ${sectionCarrierPerformance(results.carriers?.performance)}
    ${sectionFromResultTable("Sales reps", results.salesReps, 10, COL_PNL)}
    ${sectionFromResultTable("Top lanes", results.lanes?.table, 12, COL_LANE)}
    ${sectionAccessorials(results.accessorials)}
    ${sectionFinancial(fin)}
    ${sectionFromResultTable("Office", results.officeDivision?.office, 8, COL_PNL)}
    ${sectionFromResultTable("Division", results.officeDivision?.division, 8, COL_PNL)}

    <footer class="foot">
      <span>DALKO Insights · Confidential</span>
      <span>Processed locally in your browser</span>
    </footer>
  </main>
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

  wrap.querySelector("[data-exec-print]")?.addEventListener("click", () => onPrint?.());
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
    .page { max-width: 1040px; margin: 0 auto; padding: 1.5rem 1.35rem 2.5rem; }
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
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem;
      margin-bottom: 1.15rem;
    }
    .hero-card {
      background: ${card};
      border: 1px solid ${border};
      border-radius: 12px;
      padding: 0.85rem 0.95rem;
      border-top: 2px solid ${accent};
    }
    .hero-card span {
      display: block; color: ${muted}; font-size: 0.68rem;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .hero-card strong {
      display: block; margin-top: 0.35rem; font-size: 1.15rem; color: ${ink};
      font-variant-numeric: tabular-nums;
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
    .section { margin-bottom: 1.25rem; break-inside: avoid; }
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
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
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
    @media print {
      .no-print { display: none !important; }
      body { background: ${bg}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { max-width: none; padding: 0; }
      .cover, .panel, .hero-card, table, .section { break-inside: avoid; }
      tr { break-inside: avoid; }
    }
    @media (max-width: 800px) {
      .hero, .split-row, .meta { grid-template-columns: 1fr; }
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
 * @param {string} title
 * @param {string[]} headers
 * @param {(string|number)[][]} rows
 * @param {boolean[]} [numFlags]
 */
function sectionTable(title, headers, rows, numFlags = []) {
  if (!rows.length) {
    return `<section class="section"><h2>${escapeHtml(title)}</h2><p class="muted">No data for this section.</p></section>`;
  }
  const head = headers
    .map((h, i) => `<th class="${numFlags[i] ? "num" : ""}">${escapeHtml(h)}</th>`)
    .join("");
  const body = rows
    .map((r) => {
      const cells = r
        .map((c, i) => `<td class="${numFlags[i] ? "num" : ""}">${escapeHtml(String(c ?? ""))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<section class="section">
    <h2>${escapeHtml(title)}</h2>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </section>`;
}

/**
 * @param {string} title
 * @param {{ columns?: string[], rows?: { cells: unknown[], formats?: string[] }[] } | null | undefined} table
 * @param {number} limit
 * @param {number[]} colIndexes
 */
function sectionFromResultTable(title, table, limit, colIndexes) {
  if (!table?.rows?.length || !table.columns?.length) {
    return `<section class="section"><h2>${escapeHtml(title)}</h2><p class="muted">No data for this section.</p></section>`;
  }
  const headers = colIndexes.map((i) => table.columns[i] ?? `Col ${i}`);
  const numFlags = colIndexes.map((i) => {
    const fmt = table.rows[0]?.formats?.[i];
    return Boolean(fmt && fmt !== "text");
  });
  const rows = table.rows.slice(0, limit).map((r) =>
    colIndexes.map((i) => formatCell(r.cells[i], r.formats?.[i]))
  );
  return sectionTable(title, headers, rows, numFlags);
}

/** @param {{ columns?: string[], rows?: { cells: unknown[], formats?: string[] }[] } | null | undefined} perf */
function sectionCarrierPerformance(perf) {
  if (!perf?.rows?.length) {
    return `<section class="section"><h2>Carrier performance</h2><p class="muted">No transit performance data.</p></section>`;
  }
  const scored = [...perf.rows]
    .filter((r) => r.cells[2] != null && Number.isFinite(Number(r.cells[2])))
    .sort((a, b) => Number(b.cells[2]) - Number(a.cells[2]))
    .slice(0, 12);
  const rows = (scored.length ? scored : perf.rows.slice(0, 12)).map((r) => [
    String(r.focusValue ?? r.cells[0] ?? ""),
    formatCell(r.cells[1], "pct"),
    formatCell(r.cells[2], "zscore"),
    formatCell(r.cells[3], "int"),
    formatCell(r.cells[4], "int"),
    formatCell(r.cells[5], "int"),
  ]);
  return sectionTable(
    "Carrier performance (Z-score)",
    ["Carrier", "On time %", "Z-score", "On time", "Late", "Loads w/ transit"],
    rows,
    [false, true, true, true, true, true]
  );
}

/** @param {object | null | undefined} acc */
function sectionAccessorials(acc) {
  if (!acc?.hasAccessorialColumns) {
    return `<section class="section"><h2>Accessorials</h2><p class="muted">No ACCESSORIAL columns in this file.</p></section>`;
  }
  const k = acc.kpis;
  const summary = sectionTable(
    "Accessorial summary",
    ["Metric", "Value"],
    [
      ["Sell-side", fmtMoney(k.totalSell)],
      ["Buy-side", fmtMoney(k.totalBuy)],
      ["Net", fmtMoney(k.net)],
      ["Loads with accessorials", `${fmtInt(k.loadsWith)} (${fmtPct(k.pct)})`],
    ],
    [false, true]
  );
  const types = (acc.typeRows ?? []).slice(0, 12).map((t) => [
    t.type,
    fmtMoney(t.sell),
    fmtMoney(t.buy),
    fmtMoney(t.net),
  ]);
  const typeTable = sectionTable(
    "Accessorial types",
    ["Type", "Sell", "Buy", "Net"],
    types,
    [false, true, true, true]
  );
  return summary + typeTable;
}

/** @param {{ label: string, value: unknown, format?: string, sub?: string }[]} kpis */
function sectionFinancial(kpis) {
  if (!kpis?.length) {
    return `<section class="section"><h2>Financial</h2><p class="muted">No financial metrics.</p></section>`;
  }
  return sectionTable(
    "Financial",
    ["Metric", "Value", "Notes"],
    kpis.map((k) => [k.label, formatCell(k.value, k.format), k.sub ?? ""]),
    [false, true, false]
  );
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
