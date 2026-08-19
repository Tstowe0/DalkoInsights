import { fmtMoney, fmtPct, fmtInt, formatCell } from "./format.js";

/**
 * Catalog of available reports. Add new entries here later.
 * @type {{ id: string, title: string, description: string, requiresResults: boolean }[]}
 */
export const REPORT_CATALOG = [
  {
    id: "executive-analytics",
    title: "Executive analytics",
    description:
      "Themed PDF-ready report with hero KPIs, equipment mix, carrier spotlight, and tables for customers, carriers, sales reps, lanes, accessorials, financial, office, and division.",
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
    focus?.enabled && focus.column
      ? `${focus.column} = ${focus.value ?? ""}`
      : "None";
  const dateLine = dateFilter?.enabled
    ? `${dateFilter.column ?? "Date"} · ${formatShortDate(dateFilter.start)} – ${formatShortDate(dateFilter.end)}`
    : "None";

  const logoUrl = new URL("../../../shared/images/earth.png", import.meta.url).href;
  const split = exec.equipmentSplit ?? { ltl: 0, truckload: 0, other: 0 };
  const splitTotal = (split.ltl ?? 0) + (split.truckload ?? 0) + (split.other ?? 0) || 1;
  const best = exec.bestCarrier;
  const acc = results.accessorials?.kpis;
  const fin = results.financial?.kpis ?? [];

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Dalko Insights · Analytics Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>${reportStyles()}</style>
</head>
<body>
  <div class="toolbar no-print">
    <div class="toolbar-brand">
      <img src="${escapeHtml(logoUrl)}" width="28" height="28" alt="" />
      <span>Dalko Insights report</span>
    </div>
    <div class="toolbar-actions">
      <button type="button" class="btn-ghost" onclick="window.close()">Close</button>
      <button type="button" class="btn-gold" onclick="window.print()">Save as PDF / Print</button>
    </div>
  </div>

  <main class="page">
    <header class="cover">
      <div class="cover-glow" aria-hidden="true"></div>
      <div class="cover-brand">
        <img class="cover-logo" src="${escapeHtml(logoUrl)}" width="52" height="52" alt="" />
        <div>
          <h1>Dalko Insights</h1>
          <p class="tagline">Let's grow together</p>
        </div>
      </div>
      <p class="cover-title">Executive analytics report</p>
      <div class="meta">
        <div><span>Generated</span><strong>${escapeHtml(generated)}</strong></div>
        <div><span>Source file</span><strong>${escapeHtml(fileName || "—")}</strong></div>
        <div><span>Focus</span><strong>${escapeHtml(focusLine)}</strong></div>
        <div><span>Date filter</span><strong>${escapeHtml(dateLine)}</strong></div>
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
          ${mixBar("LTL", split.ltl ?? 0, splitTotal, "#f0c14a")}
          ${mixBar("Truckload", split.truckload ?? 0, splitTotal, "#5a7fc4")}
          ${mixBar("Other / unknown", split.other ?? 0, splitTotal, "#6b7280")}
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

    ${sectionTable("Executive KPIs", ["Metric", "Value", "Notes"], (exec.kpis ?? []).map((k) => [
      k.label,
      formatCell(k.value, k.format),
      k.sub ?? "",
    ]), [false, true, false])}

    ${sectionFromResultTable("Customers", results.customers, 15, [0, 1, 3, 4, 5])}
    ${sectionFromResultTable("Carrier profitability", results.carriers?.profitability, 12, [0, 1, 3, 4, 5])}
    ${sectionCarrierPerformance(results.carriers?.performance)}
    ${sectionFromResultTable("Sales reps", results.salesReps, 12, [0, 1, 3, 4, 5, 6])}
    ${sectionFromResultTable("Lanes", results.lanes?.table, 12, [0, 1, 2, 4, 5, 9])}
    ${sectionAccessorials(results.accessorials)}
    ${sectionFinancial(fin)}
    ${sectionFromResultTable("Office", results.officeDivision?.office, 10, [0, 1, 3, 4, 5])}
    ${sectionFromResultTable("Division", results.officeDivision?.division, 10, [0, 1, 3, 4, 5])}

    <footer class="foot">
      <span>Dalko Insights · Confidential</span>
      <span>Data processed locally in your browser</span>
    </footer>
  </main>
  <script>
    window.addEventListener("load", () => {
      setTimeout(() => { try { window.print(); } catch (e) {} }, 400);
    });
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error("Pop-up blocked. Allow pop-ups for this site to open the report.");
  }
  win.focus();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Reports landing page — pick a report to generate.
 * @param {HTMLElement} root
 * @param {boolean} hasResults
 * @param {(reportId: string) => void} onRunReport
 */
export function renderReportsView(root, hasResults, onRunReport) {
  const surface = document.createElement("div");
  surface.className = "surface reports-panel";

  const head = document.createElement("div");
  head.className = "filters-head";
  head.innerHTML = `
    <h3 class="block-title">Reports</h3>
    <p class="filters-lead">Choose a report to generate from the current upload, filters, and focus.</p>`;
  surface.appendChild(head);

  const list = document.createElement("div");
  list.className = "reports-list";

  for (const report of REPORT_CATALOG) {
    const card = document.createElement("article");
    card.className = "report-card";

    const body = document.createElement("div");
    body.className = "report-card-body";
    const title = document.createElement("h4");
    title.className = "report-card-title";
    title.textContent = report.title;
    const desc = document.createElement("p");
    desc.className = "report-card-desc";
    desc.textContent = report.description;
    body.append(title, desc);

    const actions = document.createElement("div");
    actions.className = "report-card-actions";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary";
    btn.textContent = "Generate";
    const needsData = report.requiresResults && !hasResults;
    btn.disabled = needsData;
    btn.title = needsData ? "Upload and analyze a file first" : `Generate ${report.title}`;
    btn.addEventListener("click", () => onRunReport(report.id));
    actions.appendChild(btn);

    card.append(body, actions);
    list.appendChild(card);
  }

  surface.appendChild(list);
  if (!hasResults) {
    const hint = document.createElement("p");
    hint.className = "reports-hint";
    hint.textContent = "Upload a TMS Excel file to unlock report generation.";
    surface.appendChild(hint);
  }
  root.appendChild(surface);
}

function reportStyles() {
  return `
    :root {
      color-scheme: dark;
      --bg: #030508;
      --bg-elevated: #080e1a;
      --card: #0c1322;
      --card-border: rgba(255,255,255,0.08);
      --card-border-gold: rgba(217,174,66,0.28);
      --accent: #d9ae42;
      --accent-bright: #f0c14a;
      --text: #ffffff;
      --muted: #8b9cb8;
      --on-accent: #0a1018;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.45;
    }
    .toolbar {
      position: sticky; top: 0; z-index: 20;
      display: flex; align-items: center; justify-content: space-between;
      gap: 1rem; padding: 0.75rem 1.25rem;
      background: rgba(8,14,26,0.94);
      border-bottom: 1px solid var(--card-border-gold);
      backdrop-filter: blur(8px);
    }
    .toolbar-brand { display: flex; align-items: center; gap: 0.6rem; color: var(--accent-bright); font-weight: 600; }
    .toolbar-brand img { border-radius: 50%; }
    .toolbar-actions { display: flex; gap: 0.5rem; }
    .btn-gold, .btn-ghost {
      border: none; border-radius: 8px; padding: 0.55rem 0.95rem;
      font: inherit; font-weight: 600; cursor: pointer;
    }
    .btn-gold { background: linear-gradient(180deg, #f0c14a, #b8922a); color: var(--on-accent); }
    .btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--card-border); }
    .page { max-width: 980px; margin: 0 auto; padding: 1.5rem 1.35rem 2.5rem; }
    .cover {
      position: relative; overflow: hidden;
      border: 1px solid var(--card-border-gold);
      border-radius: 16px;
      background: linear-gradient(165deg, #101a2e 0%, #0c1322 55%, #080e1a 100%);
      padding: 1.5rem 1.5rem 1.25rem;
      margin-bottom: 1.25rem;
      box-shadow: 0 0 40px rgba(240,193,74,0.08);
    }
    .cover-glow {
      position: absolute; inset: -20% auto auto -10%; width: 280px; height: 180px;
      background: radial-gradient(circle, rgba(240,193,74,0.28), transparent 70%);
      filter: blur(12px); pointer-events: none;
    }
    .cover-brand { position: relative; display: flex; align-items: center; gap: 0.85rem; }
    .cover-logo {
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(240,193,74,0.35), 0 0 18px rgba(240,193,74,0.4);
    }
    h1 {
      margin: 0; font-family: "Cormorant Garamond", Georgia, serif;
      font-size: 2rem; font-weight: 700; color: var(--accent-bright);
      text-shadow: 0 0 18px rgba(240,193,74,0.35);
    }
    .tagline { margin: 0.15rem 0 0; color: var(--accent); font-size: 0.85rem; }
    .cover-title {
      position: relative; margin: 1.1rem 0 0.85rem;
      font-size: 1.15rem; font-weight: 650; letter-spacing: 0.02em;
    }
    .meta {
      position: relative;
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.55rem 1.25rem;
      font-size: 0.8rem;
    }
    .meta span { display: block; color: var(--muted); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .meta strong { color: var(--text); font-weight: 600; }
    .hero {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem;
      margin-bottom: 1.15rem;
    }
    .hero-card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 0.85rem 0.95rem;
      border-top: 2px solid rgba(217,174,66,0.65);
    }
    .hero-card span {
      display: block; color: var(--muted); font-size: 0.68rem;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .hero-card strong {
      display: block; margin-top: 0.35rem; font-size: 1.15rem; color: #fff;
      font-variant-numeric: tabular-nums;
    }
    .split-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem;
      margin-bottom: 1.15rem;
    }
    .panel {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 0.95rem 1rem 1rem;
    }
    h2 {
      margin: 0 0 0.75rem;
      font-size: 0.95rem; font-weight: 650;
      color: var(--accent-bright);
      border-bottom: 1px solid var(--card-border-gold);
      padding-bottom: 0.4rem;
    }
    .section { margin-bottom: 1.25rem; break-inside: avoid; }
    .section h2 { margin-bottom: 0.55rem; }
    table {
      width: 100%; border-collapse: collapse; font-size: 0.78rem;
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 10px; overflow: hidden;
    }
    th, td {
      padding: 0.45rem 0.65rem;
      border-bottom: 1px solid var(--card-border);
      text-align: left; vertical-align: middle;
    }
    th {
      background: rgba(8,14,26,0.95);
      color: var(--muted);
      font-size: 0.65rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
    tr:last-child td { border-bottom: none; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: var(--muted); }
    .mix { display: flex; flex-direction: column; gap: 0.65rem; }
    .mix-row { display: grid; grid-template-columns: 7rem 1fr 3.2rem; gap: 0.5rem; align-items: center; }
    .mix-row span { color: var(--muted); font-size: 0.75rem; }
    .mix-track { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.06); overflow: hidden; }
    .mix-fill { height: 100%; border-radius: inherit; }
    .mix-row strong { text-align: right; font-size: 0.78rem; }
    .spotlight-name { margin: 0 0 0.65rem; font-size: 1rem; font-weight: 650; color: #fff; }
    .spotlight-dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin: 0 0 0.5rem; }
    .spotlight-dl dt { color: var(--muted); font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .spotlight-dl dd { margin: 0.15rem 0 0; font-weight: 700; color: var(--accent-bright); font-size: 1rem; }
    .acc-foot {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-top: 0.75rem; padding-top: 0.65rem;
      border-top: 1px solid var(--card-border);
      color: var(--muted); font-size: 0.78rem;
    }
    .acc-foot strong { color: var(--accent-bright); font-size: 0.95rem; }
    .foot {
      display: flex; justify-content: space-between; gap: 1rem;
      margin-top: 1.5rem; padding-top: 0.85rem;
      border-top: 1px solid var(--card-border);
      color: var(--muted); font-size: 0.72rem;
    }
    @media print {
      .no-print { display: none !important; }
      body { background: #030508; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
