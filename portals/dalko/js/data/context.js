/** @typedef {{ index: Record<string, number>, upperMap: Record<string, number> }} HeaderMaps */

/**
 * @param {unknown[]} headers
 * @returns {HeaderMaps}
 */
export function buildHeaderMaps(headers) {
  /** @type {Record<string, number>} */
  const index = {};
  /** @type {Record<string, number>} */
  const upperMap = {};
  headers.forEach((h, i) => {
    if (h == null || h === "") return;
    const s = String(h).trim();
    index[s] = i;
    upperMap[s.toUpperCase()] = i;
  });
  return { index, upperMap };
}

/**
 * @param {unknown[]} row
 * @param {string} column
 * @param {HeaderMaps} maps
 */
export function getValue(row, column, maps) {
  let idx = maps.index[column];
  if (idx === undefined) idx = maps.upperMap[column.toUpperCase()];
  if (idx === undefined || idx >= row.length) return null;
  const v = row[idx];
  if (v === "" || v === undefined) return null;
  return v;
}

/**
 * @param {unknown} value
 * @param {number} [defaultVal=0]
 */
export function safeFloat(value, defaultVal = 0) {
  if (value == null || value === "") return defaultVal;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultVal;
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseCellDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Normalize Excel Date cells to local calendar midnight (avoid UTC day shift)
    const isUtcMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;
    if (isUtcMidnight) {
      return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
    }
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === "number" && typeof XLSX !== "undefined") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  const s = String(value).trim();
  const formats = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/,
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
  ];
  for (const re of formats) {
    const m = s.match(re);
    if (!m) continue;
    if (re === formats[0] || re === formats[2]) {
      const month = parseInt(m[1], 10);
      const day = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      const d = new Date(year, month - 1, day);
      if (!Number.isNaN(d.getTime())) return d;
    } else {
      // YYYY-MM-DD — parse as local calendar date (avoid UTC midnight shift)
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[3], 10);
      const d = new Date(year, month - 1, day);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function monthKeyFromDateValue(value) {
  const d = parseCellDate(value);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * @param {unknown[]} headers
 * @returns {string[]}
 */
export function validateExpectedColumns(headers) {
  const expected = [
    "CLIENT NAME",
    "TOTAL RECEIVABLE AMOUNT",
    "TOTAL PAYABLE AMOUNT",
    "PROFIT",
    "STATUS",
    "Total Miles",
    "CARRIER NAME1",
    "SALES REP",
    "DIVISION",
    "OFFICE",
    "EQUIPMENT",
    "ORIGIN STATE",
    "DESTINATION STATE",
    "BALANCE DUE",
    "RECEIVED AMOUNT",
    "INVOICE DATE",
  ];
  const headerSet = new Set(
    headers.filter(Boolean).map((h) => String(h).trim().toUpperCase())
  );
  return expected.filter((col) => !headerSet.has(col.toUpperCase()));
}
