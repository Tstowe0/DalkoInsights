import { mountFileTool } from "../_shared/file-ui.js";
import {
  ensureXlsx,
  readFileBuffer,
  downloadWorkbook,
  paintWorkbookTheme,
  stampName,
} from "../_shared/excel.js";

export const meta = {
  id: "Carrier Performance",
  title: "Carrier Performance",
  category: "Data Tools",
  script: "Data Tools/Carrier Performance.js",
};

const MIN_LOADS_DEFAULT = 10;
const YIELD_EVERY = 25_000;

const COL_CARRIER = "CARRIER NAME1";
const COL_ACTUAL = "ACTUAL TRANSIT DAYS";
const COL_EXPECTED = "EXPECTED TRANSIT DAYS";

/**
 * @param {unknown} value
 */
function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/**
 * @param {unknown} value
 */
function entityKey(value) {
  const s = String(value ?? "").trim();
  return s || "Unknown";
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 */
function safeFloat(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {string[]} headers
 * @param {string} wanted
 */
function findColIndex(headers, wanted) {
  const target = normalizeHeader(wanted);
  return headers.findIndex((h) => normalizeHeader(h) === target);
}

/** Yield so the UI can update during large scans. */
function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function splitCsvLine(line) {
  /** @type {string[]} */
  const cells = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

/**
 * @typedef {{ onTime: number, late: number, total: number }} CarrierCounts
 * @typedef {{ carrier: string, onTimePct: number, zScore: number | null, onTime: number, late: number, total: number }} CarrierRow
 */

/**
 * @param {Record<string, CarrierCounts>} perf
 * @param {number} minLoads
 * @returns {CarrierRow[]}
 */
function scoreCarriers(perf, minLoads) {
  let totalOnTime = 0;
  let totalWithData = 0;
  for (const p of Object.values(perf)) {
    totalOnTime += p.onTime;
    totalWithData += p.total;
  }

  return Object.entries(perf)
    .map(([carrier, p]) => {
      const onTimePct = p.total ? (p.onTime / p.total) * 100 : 0;
      /** @type {number | null} */
      let zScore = null;
      const loadCount = p.total;
      if (loadCount >= minLoads && totalWithData > loadCount) {
        const othersOnTime = totalOnTime - p.onTime;
        const othersTotal = totalWithData - loadCount;
        if (othersTotal > 0 && loadCount > 0) {
          const pOthers = othersOnTime / othersTotal;
          const pCarrier = p.onTime / loadCount;
          if (pOthers > 0 && pOthers < 1) {
            const stdError = Math.sqrt((pOthers * (1 - pOthers)) / loadCount);
            if (stdError > 0) zScore = (pCarrier - pOthers) / stdError;
          }
        }
      }
      return {
        carrier,
        onTimePct,
        zScore,
        onTime: p.onTime,
        late: p.late,
        total: p.total,
      };
    })
    .sort((a, b) => {
      if (a.zScore == null && b.zScore == null) return b.onTimePct - a.onTimePct;
      if (a.zScore == null) return 1;
      if (b.zScore == null) return -1;
      return b.zScore - a.zScore;
    });
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {Record<string, CarrierCounts>} perf
 * @param {string} carrierRaw
 */
function tallyRow(actual, expected, perf, carrierRaw) {
  if (actual == null || actual === "" || expected == null || expected === "") return false;
  const actualDays = safeFloat(actual);
  const expectedDays = safeFloat(expected);
  const carrier = entityKey(carrierRaw);
  if (!perf[carrier]) perf[carrier] = { onTime: 0, late: 0, total: 0 };
  perf[carrier].total++;
  if (actualDays <= expectedDays) perf[carrier].onTime++;
  else perf[carrier].late++;
  return true;
}

/**
 * @param {string} text
 * @param {(msg: string) => void} log
 * @returns {Promise<{ perf: Record<string, CarrierCounts>, scanned: number, used: number }>}
 */
async function aggregateCsv(text, log) {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  if (!lines.length) throw new Error("CSV is empty.");

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const iCarrier = findColIndex(headers, COL_CARRIER);
  const iActual = findColIndex(headers, COL_ACTUAL);
  const iExpected = findColIndex(headers, COL_EXPECTED);
  if (iCarrier < 0 || iActual < 0 || iExpected < 0) {
    throw new Error(
      `Missing required columns. Need ${COL_CARRIER}, ${COL_ACTUAL}, ${COL_EXPECTED}.`
    );
  }

  /** @type {Record<string, CarrierCounts>} */
  const perf = {};
  let scanned = 0;
  let used = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cells = splitCsvLine(line);
    scanned++;
    if (tallyRow(cells[iActual], cells[iExpected], perf, cells[iCarrier])) used++;
    if (scanned % YIELD_EVERY === 0) {
      log(`Scanning CSV… ${scanned.toLocaleString()} rows`);
      await yieldToUi();
    }
  }

  return { perf, scanned, used };
}

/**
 * @param {ArrayBuffer} buffer
 * @param {(msg: string) => void} log
 * @returns {Promise<{ perf: Record<string, CarrierCounts>, scanned: number, used: number }>}
 */
async function aggregateExcel(buffer, log) {
  const XLSX = globalThis.XLSX;
  log("Parsing workbook…");
  await yieldToUi();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Workbook has no sheets.");

  const aoa = /** @type {unknown[][]} */ (
    XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true, blankrows: false })
  );
  if (!aoa.length) throw new Error("Sheet is empty.");

  const headers = (aoa[0] || []).map((h) => String(h ?? "").trim());
  const iCarrier = findColIndex(headers, COL_CARRIER);
  const iActual = findColIndex(headers, COL_ACTUAL);
  const iExpected = findColIndex(headers, COL_EXPECTED);
  if (iCarrier < 0 || iActual < 0 || iExpected < 0) {
    throw new Error(
      `Missing required columns. Need ${COL_CARRIER}, ${COL_ACTUAL}, ${COL_EXPECTED}.`
    );
  }

  /** @type {Record<string, CarrierCounts>} */
  const perf = {};
  let scanned = 0;
  let used = 0;

  for (let i = 1; i < aoa.length; i++) {
    const line = aoa[i] || [];
    scanned++;
    if (tallyRow(line[iActual], line[iExpected], perf, line[iCarrier])) used++;
    if (scanned % YIELD_EVERY === 0) {
      log(`Scanning sheet… ${scanned.toLocaleString()} rows`);
      await yieldToUi();
    }
  }

  return { perf, scanned, used };
}

/**
 * @param {number | null} z
 */
function fmtZ(z) {
  if (z == null || !Number.isFinite(z)) return "Insufficient sample";
  return `${z >= 0 ? "+" : ""}${z.toFixed(2)}`;
}

/**
 * @param {CarrierRow[]} rows
 * @param {HTMLElement} host
 * @param {{ scanned: number, used: number, carriers: number, minLoads: number }} metaInfo
 */
function renderResults(rows, host, metaInfo) {
  const scored = rows.filter((r) => r.zScore != null).length;
  const best = rows.find((r) => r.zScore != null);

  host.innerHTML = `
    <div class="gb-cp-summary">
      <div class="gb-cp-stat">
        <span class="gb-cp-stat-label">Rows scanned</span>
        <strong>${metaInfo.scanned.toLocaleString()}</strong>
      </div>
      <div class="gb-cp-stat">
        <span class="gb-cp-stat-label">With transit data</span>
        <strong>${metaInfo.used.toLocaleString()}</strong>
      </div>
      <div class="gb-cp-stat">
        <span class="gb-cp-stat-label">Carriers</span>
        <strong>${metaInfo.carriers.toLocaleString()}</strong>
      </div>
      <div class="gb-cp-stat">
        <span class="gb-cp-stat-label">Scored (min ${metaInfo.minLoads})</span>
        <strong>${scored.toLocaleString()}</strong>
      </div>
      <div class="gb-cp-stat gb-cp-stat--wide">
        <span class="gb-cp-stat-label">Best Z-score</span>
        <strong>${best ? `${escapeHtml(best.carrier)} (${fmtZ(best.zScore)})` : "—"}</strong>
      </div>
    </div>
    <div class="gb-cp-table-wrap">
      <table class="gb-cp-table">
        <thead>
          <tr>
            <th>Carrier</th>
            <th>On time %</th>
            <th>Z-score</th>
            <th>On time</th>
            <th>Late</th>
            <th>Loads w/ transit</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((r) => {
              const zClass =
                r.zScore == null ? "" : r.zScore >= 0 ? "gb-cp-pos" : "gb-cp-neg";
              return `<tr>
                <td>${escapeHtml(r.carrier)}</td>
                <td class="num">${r.onTimePct.toFixed(1)}%</td>
                <td class="num ${zClass}">${fmtZ(r.zScore)}</td>
                <td class="num">${r.onTime.toLocaleString()}</td>
                <td class="num">${r.late.toLocaleString()}</td>
                <td class="num">${r.total.toLocaleString()}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  /** @type {CarrierRow[]} */
  let lastRows = [];

  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Carrier on-time % and Z-score from a TMS Data Dump — same math as Dalko Analysis, without the full dashboard.

Required columns:
• ${COL_CARRIER}
• ${COL_ACTUAL}
• ${COL_EXPECTED}

On time = actual transit days ≤ expected. Z-score compares each carrier’s on-time rate to all other carriers (min loads default: ${MIN_LOADS_DEFAULT}).

Large files:
• Prefer CSV for dumps over ~100k rows (lighter than Excel).
• Only three columns are tallied — full dump rows are not kept in memory.
• No Analysis Dashboard size/row hard cap.

Workflow:
1. Browse → TMS dump (.xlsx / .csv).
2. Optionally change Min loads for Z-score.
3. Run → review ranked table.
4. Export Excel for the ranked results.`,
    onBack: ctx.onBack,
    log: ctx.log,
    buildExtra(extra) {
      extra.innerHTML = `
        <label class="gb-check ui-field-inline">
          <span>Min loads for Z-score</span>
          <input class="ui-input" type="number" min="1" step="1" value="${MIN_LOADS_DEFAULT}" data-min-loads style="width:5.5rem" />
        </label>
        <div class="ui-row" style="margin-top:0.75rem">
          <button type="button" class="btn btn-secondary" data-export disabled>Export Excel</button>
        </div>
        <div class="gb-cp-results" data-results></div>
      `;

      extra.querySelector("[data-export]")?.addEventListener("click", async () => {
        if (!lastRows.length) return;
        await ensureXlsx();
        const XLSX = globalThis.XLSX;
        const out = lastRows.map((r) => ({
          Carrier: r.carrier,
          "On time %": Number(r.onTimePct.toFixed(2)),
          "Z-score": r.zScore == null ? null : Number(r.zScore.toFixed(4)),
          "On time loads": r.onTime,
          "Late loads": r.late,
          "Loads w/ transit": r.total,
        }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), "Carrier Performance");
        paintWorkbookTheme(wb);
        const name = `carrier_performance_${stampName()}.xlsx`;
        downloadWorkbook(wb, name);
        ctx.log(`Exported ${name}`);
      });
    },
    async onRun(files, ui) {
      const file = files[0];
      if (!file) return;

      const minRaw = /** @type {HTMLInputElement | null} */ (ui.extra.querySelector("[data-min-loads]"));
      const minLoads = Math.max(1, Math.floor(Number(minRaw?.value) || MIN_LOADS_DEFAULT));
      if (minRaw) minRaw.value = String(minLoads);

      const exportBtn = /** @type {HTMLButtonElement | null} */ (ui.extra.querySelector("[data-export]"));
      const resultsHost = /** @type {HTMLElement | null} */ (ui.extra.querySelector("[data-results]"));
      if (exportBtn) exportBtn.disabled = true;
      if (resultsHost) resultsHost.innerHTML = "";

      const sizeMb = file.size / (1024 * 1024);
      if (sizeMb > 80) {
        ctx.log(
          `Large file (${sizeMb.toFixed(1)} MB). Prefer CSV if this is Excel — scanning only transit columns.`
        );
      }

      const nameLower = file.name.toLowerCase();
      const isCsv = nameLower.endsWith(".csv") || file.type === "text/csv";

      ui.setStatus("Reading file…");
      ctx.log(`Reading ${file.name} (${sizeMb.toFixed(1)} MB)…`);

      /** @type {{ perf: Record<string, CarrierCounts>, scanned: number, used: number }} */
      let agg;
      if (isCsv) {
        const text = await file.text();
        agg = await aggregateCsv(text, ctx.log);
      } else {
        await ensureXlsx();
        const buffer = await readFileBuffer(file);
        agg = await aggregateExcel(buffer, ctx.log);
      }

      ui.setStatus("Scoring carriers…");
      lastRows = scoreCarriers(agg.perf, minLoads);

      if (resultsHost) {
        renderResults(lastRows, resultsHost, {
          scanned: agg.scanned,
          used: agg.used,
          carriers: Object.keys(agg.perf).length,
          minLoads,
        });
      }
      if (exportBtn) exportBtn.disabled = !lastRows.length;

      ui.setStatus("Done");
      ctx.log(
        `Done — ${agg.scanned.toLocaleString()} rows scanned, ${agg.used.toLocaleString()} with transit data, ${lastRows.length.toLocaleString()} carriers ranked.`
      );
    },
  });
}
