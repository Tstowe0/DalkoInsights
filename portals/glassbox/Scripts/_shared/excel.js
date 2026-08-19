/**
 * SheetJS helpers — loads xlsx-js-style (writes cell fills/fonts into .xlsx).
 */

const XLSX_SRC = new URL("../../../../shared/vendor/xlsx-js-style.min.js", import.meta.url).href;

/** @type {Promise<void> | null} */
let xlsxReady = null;

export function ensureXlsx() {
  if (typeof globalThis.XLSX !== "undefined") return Promise.resolve();
  if (xlsxReady) return xlsxReady;
  xlsxReady = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = XLSX_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Failed to load SheetJS (xlsx-js-style) from shared/vendor."));
    document.head.appendChild(el);
  });
  return xlsxReady;
}

/**
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
export function readFileBuffer(file) {
  return file.arrayBuffer();
}

/** Pad number to 2 digits. */
function p2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Format Date like pandas/openpyxl default str(Timestamp): YYYY-MM-DD HH:MM:SS
 * @param {Date} d
 */
export function formatPyDateTime(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/**
 * Deduplicate headers pandas-style: name, name.1, name.2…
 * Blank headers become Unnamed: N (0-based index).
 * @param {unknown[]} rawHeaders
 * @returns {string[]}
 */
export function pandasHeaders(rawHeaders) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return rawHeaders.map((h, idx) => {
    let base = String(h ?? "").trim();
    if (!base) base = `Unnamed: ${idx}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}.${count}`;
  });
}

/**
 * Convert a cell value for dtype=str style reads (tracking reports).
 * @param {unknown} v
 */
function asTextValue(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return formatPyDateTime(v);
  if (typeof v === "number" && Number.isNaN(v)) return "";
  return String(v);
}

/**
 * @typedef {{ sheetName?: string, asText?: boolean }} WorkbookReadOpts
 */

/**
 * Read a sheet into row objects.
 * - Keeps interior blank rows (pandas default)
 * - Dedupes duplicate headers with .1/.2 (pandas)
 * - Names blank headers Unnamed: N
 * - asText:true mirrors pd.read_excel(..., dtype=str)
 *
 * @param {ArrayBuffer} buffer
 * @param {string | WorkbookReadOpts} [sheetNameOrOpts]
 * @param {WorkbookReadOpts} [maybeOpts]
 * @returns {{ headers: string[], rows: Record<string, unknown>[], sheetNames: string[], workbook: object }}
 */
export function workbookToObjects(buffer, sheetNameOrOpts, maybeOpts) {
  /** @type {WorkbookReadOpts} */
  let opts = {};
  /** @type {string | undefined} */
  let sheetName;
  if (typeof sheetNameOrOpts === "string") {
    sheetName = sheetNameOrOpts;
    opts = maybeOpts || {};
  } else if (sheetNameOrOpts && typeof sheetNameOrOpts === "object") {
    opts = sheetNameOrOpts;
    sheetName = opts.sheetName;
  }

  const XLSX = globalThis.XLSX;
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  if (sheetName && !workbook.SheetNames.includes(sheetName)) {
    throw new Error(
      `Sheet "${sheetName}" not found. Available: ${workbook.SheetNames.join(", ") || "(none)"}`
    );
  }
  const name = sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];

  const aoa = /** @type {unknown[][]} */ (
    XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true, blankrows: true })
  );

  if (!aoa.length) {
    return { headers: [], rows: [], sheetNames: workbook.SheetNames, workbook };
  }

  const headers = pandasHeaders(aoa[0] || []);
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const line = aoa[i] || [];
    /** @type {Record<string, unknown>} */
    const row = {};
    headers.forEach((h, idx) => {
      const raw = line[idx] ?? "";
      row[h] = opts.asText ? asTextValue(raw) : raw;
    });
    rows.push(row);
  }

  return { headers, rows, sheetNames: workbook.SheetNames, workbook };
}

/**
 * First sheet cell A1 value.
 * @param {ArrayBuffer} buffer
 */
export function readCellA1(buffer) {
  const XLSX = globalThis.XLSX;
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const cell = sheet?.A1;
  if (!cell) return "";
  return String(cell.w ?? cell.v ?? "").trim();
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {string} sheetName
 */
export function objectsToWorkbook(rows, sheetName = "Sheet1") {
  const XLSX = globalThis.XLSX;
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  return workbook;
}

/**
 * @param {object} workbook
 * @param {string} filename
 */
export function downloadWorkbook(workbook, filename) {
  const XLSX = globalThis.XLSX;
  const data = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    cellStyles: true,
    cellDates: true,
  });
  downloadBlob(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

/**
 * @param {string} csv
 * @param {string} filename
 */
export function downloadCsv(csv, filename) {
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

/**
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** @returns {string} mmddyyHHmm */
export function stampName() {
  const d = new Date();
  return `${p2(d.getMonth() + 1)}${p2(d.getDate())}${String(d.getFullYear()).slice(-2)}${p2(d.getHours())}${p2(d.getMinutes())}`;
}

/**
 * Apply Glass Box Theme Painter look (header + E7E7E7 zebra).
 * Client reports should use applyClientReportStyle from report-format.js instead.
 * @param {object} workbook
 */
export function paintWorkbookTheme(workbook) {
  const XLSX = globalThis.XLSX;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!sheet[addr]) sheet[addr] = { t: "s", v: "" };
        const cell = sheet[addr];
        cell.s = cell.s || {};
        cell.s.alignment = { horizontal: "center", vertical: "center" };
        if (R === 0) {
          cell.s.fill = { patternType: "solid", fgColor: { rgb: "185074" } };
          cell.s.font = { bold: true, color: { rgb: "FFFFFF" } };
        } else if (R % 2 === 0) {
          cell.s.fill = { patternType: "solid", fgColor: { rgb: "E7E7E7" } };
        } else {
          cell.s.fill = { patternType: "solid", fgColor: { rgb: "FFFFFF" } };
        }
      }
    }
  }
  return workbook;
}
