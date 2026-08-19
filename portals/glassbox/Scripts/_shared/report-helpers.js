/**
 * Shared helpers for Glass Box report/tools ports.
 */

/** @param {unknown} v */
export function normKey(v) {
  return String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} aliases
 */
export function pickCol(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const hit = keys.find((k) => normKey(k) === normKey(alias));
    if (hit) return { key: hit, value: row[hit] };
  }
  return { key: null, value: "" };
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} aliases
 */
export function pickVal(row, aliases) {
  return pickCol(row, aliases).value;
}

/** @param {unknown} value */
export function parseDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** @param {Date} d */
export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** @param {Date} a @param {Date} b */
export function daysBetween(a, b) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
}

/** Previous complete Sun–Sat week ending last Saturday. */
export function prevSunSat(ref = new Date()) {
  const d = startOfDay(ref);
  const day = d.getDay(); // 0 Sun
  const lastSat = new Date(d);
  lastSat.setDate(d.getDate() - ((day + 1) % 7 || 7));
  const sun = new Date(lastSat);
  sun.setDate(lastSat.getDate() - 6);
  return { sun, sat: lastSat };
}

/** Previous calendar month range. */
export function prevMonthRange(ref = new Date()) {
  const firstThis = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const lastPrev = new Date(firstThis.getTime() - 86400000);
  const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
  return { first: firstPrev, last: lastPrev, label: lastPrev.toLocaleString("en-US", { month: "long", year: "numeric" }) };
}

/**
 * @param {Date} d
 * @param {string} [sep]
 */
export function fmtMDY(d, sep = "-") {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}${sep}${p(d.getDate())}${sep}${d.getFullYear()}`;
}

/**
 * @param {Date} d
 */
export function fmtShort(d) {
  return `${d.getMonth() + 1}.${d.getDate()}.${String(d.getFullYear()).slice(-2)}`;
}

export const TRACKING_DROP_STATUS = new Set([
  "DELIVERED",
  "INVOICED",
  "PICKUP REQUESTED",
  "QUOTE MODIFIED",
  "BOOKED OPEN",
  "BOOKED",
  "SPOT QUOTED",
  "QUOTED",
  "ASSIGN CARRIER",
]);

/**
 * @param {Record<string, unknown>[]} rows
 * @param {string} col
 */
export function groupSum(rows, col, valueCol) {
  /** @type {Map<string, { count: number, spend: number }>} */
  const map = new Map();
  for (const row of rows) {
    const key = String(pickVal(row, [col]) ?? "").trim() || "(blank)";
    const spend = Number(String(pickVal(row, [valueCol, "TOTAL RECEIVABLE AMOUNT"]) ?? "").replace(/[,$]/g, "")) || 0;
    const cur = map.get(key) || { count: 0, spend: 0 };
    cur.count += 1;
    cur.spend += spend;
    map.set(key, cur);
  }
  return [...map.entries()]
    .map(([name, v]) => ({ [col]: name, Shipments: v.count, Spend: Math.round(v.spend * 100) / 100 }))
    .sort((a, b) => b.Spend - a.Spend);
}

/**
 * @param {Record<string, unknown>} row
 * @param {RegExp} re
 */
export function sumMatching(row, re) {
  let total = 0;
  for (const [k, v] of Object.entries(row)) {
    if (!re.test(k)) continue;
    const n = Number(String(v ?? "").replace(/[,$]/g, ""));
    if (!Number.isNaN(n)) total += n;
  }
  return total;
}
