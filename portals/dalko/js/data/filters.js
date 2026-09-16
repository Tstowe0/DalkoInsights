import { getValue, parseCellDate } from "./context.js";

/**
 * @typedef {{ column: string, value: string }} FocusItem
 * @typedef {{
 *   dateFilterEnabled: boolean,
 *   dateFilterColumn: string,
 *   dateFilterStart: Date | null,
 *   dateFilterEnd: Date | null,
 *   focuses: FocusItem[],
 * }} FilterState
 */

/** @returns {FilterState} */
export function createDefaultFilters() {
  return {
    dateFilterEnabled: false,
    dateFilterColumn: "INVOICE DATE",
    dateFilterStart: null,
    dateFilterEnd: null,
    focuses: [],
  };
}

/** @param {FilterState} filters */
export function hasFocuses(filters) {
  return (filters.focuses?.length ?? 0) > 0;
}

/**
 * @param {FilterState} filters
 * @param {string} column
 * @param {string} value
 */
export function hasFocus(filters, column, value) {
  const col = String(column);
  const val = String(value);
  return (filters.focuses ?? []).some((f) => f.column === col && f.value === val);
}

const FOCUS_LABELS = {
  "CLIENT NAME": "Customer",
  "CARRIER NAME1": "Carrier",
  "SALES REP": "Sales rep",
  DIVISION: "Division",
  OFFICE: "Office",
  EQUIPMENT: "Equipment",
  LANE: "Lane",
  "ORIGIN STATE": "Origin state",
  "DESTINATION STATE": "Destination state",
  "ORIGIN CITY": "Origin city",
  "DESTINATION CITY": "Destination city",
  ACCESSORIAL_TYPE: "Accessorial type",
};

/** @param {string} column */
export function focusFieldLabel(column) {
  return FOCUS_LABELS[column] ?? column;
}

/**
 * Match a focused origin/destination city. Values are "CITY, ST" from the Cities
 * tables; a city-only value still matches that city in any state.
 * @param {unknown[]} row
 * @param {import("./context.js").HeaderMaps} maps
 * @param {string} cityCol
 * @param {string} stateCol
 * @param {string} val
 */
function cityFocusMatch(row, maps, cityCol, stateCol, val) {
  const city = String(getValue(row, cityCol, maps) ?? "")
    .trim()
    .toUpperCase();
  const state = String(getValue(row, stateCol, maps) ?? "")
    .trim()
    .toUpperCase();
  const needle = String(val).trim().toUpperCase();
  const comma = needle.lastIndexOf(",");
  if (comma === -1) return city === needle;
  const wantCity = needle.slice(0, comma).trim();
  const wantState = needle.slice(comma + 1).trim();
  return city === wantCity && (!wantState || state === wantState);
}

/**
 * @param {unknown[]} row
 * @param {import("./context.js").HeaderMaps} maps
 * @param {string} col
 * @param {string} val
 * @param {(row: unknown[], value: string) => boolean} [accessorialRowMatch]
 */
export function rowMatchesFocus(row, maps, col, val, accessorialRowMatch) {
  if (col === "LANE") {
    const origin = String(getValue(row, "ORIGIN STATE", maps) ?? "")
      .trim()
      .toUpperCase();
    const dest = String(getValue(row, "DESTINATION STATE", maps) ?? "")
      .trim()
      .toUpperCase();
    return `${origin} → ${dest}` === val;
  }
  if (col === "ACCESSORIAL_TYPE") {
    return accessorialRowMatch ? accessorialRowMatch(row, val) : false;
  }
  if (col === "ORIGIN STATE" || col === "DESTINATION STATE") {
    const rowVal = String(getValue(row, col, maps) ?? "")
      .trim()
      .toUpperCase();
    return rowVal === val.toUpperCase();
  }
  if (col === "ORIGIN CITY" || col === "DESTINATION CITY") {
    const stateCol = col === "ORIGIN CITY" ? "ORIGIN STATE" : "DESTINATION STATE";
    return cityFocusMatch(row, maps, col, stateCol, val);
  }
  const rowVal = String(getValue(row, col, maps) ?? "").trim();
  if (val === "Unknown") return !rowVal || rowVal === "Unknown";
  return rowVal === val;
}

/**
 * @param {string} str
 * @returns {Date | null}
 */
export function parseFilterDateInput(str) {
  const s = str.trim();
  if (!s || s === "MM/DD/YYYY") return null;
  return parseCellDate(s);
}

/**
 * Unique values for a focus layer, from date-filtered rows (ignores other focuses).
 * @param {unknown[][]} rows
 * @param {import("./context.js").HeaderMaps} maps
 * @param {unknown[]} headers
 * @param {string} column
 * @param {{ equipmentMode?: "ltl" | "truckload" }} [opts]
 * @returns {string[]}
 */
export function listFocusLayerValues(rows, maps, headers, column, opts = {}) {
  const seen = new Set();
  /** @type {string[]} */
  const values = [];

  /** @param {string} raw */
  const add = (raw) => {
    const s = String(raw ?? "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    values.push(s);
  };

  if (column === "ACCESSORIAL_TYPE") {
    /** @type {number[]} */
    const typeIdx = [];
    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      const header = headers[colIdx];
      if (!header) continue;
      const headerUpper = String(header).trim().toUpperCase();
      if (!headerUpper.match(/^ACCESSORIAL\d+$/) || headerUpper.includes("BUY") || headerUpper.includes("SELL")) {
        continue;
      }
      typeIdx.push(colIdx);
    }
    for (const row of rows) {
      for (const colIdx of typeIdx) {
        const typeVal = row[colIdx];
        if (typeVal == null || typeVal === "") continue;
        const typeStr = String(typeVal).trim();
        if (!typeStr || ["NONE", "NULL"].includes(typeStr.toUpperCase())) continue;
        add(typeStr);
      }
    }
    values.sort((a, b) => a.localeCompare(b));
    return values;
  }

  for (const row of rows) {
    if (column === "LANE") {
      const origin = String(getValue(row, "ORIGIN STATE", maps) ?? "")
        .trim()
        .toUpperCase();
      const dest = String(getValue(row, "DESTINATION STATE", maps) ?? "")
        .trim()
        .toUpperCase();
      if (!origin || !dest) continue;
      add(`${origin} → ${dest}`);
      continue;
    }
    if (column === "ORIGIN CITY" || column === "DESTINATION CITY") {
      const cityRaw = getValue(row, column, maps);
      if (!cityRaw || !String(cityRaw).trim()) continue;
      const city = String(cityRaw).trim().toUpperCase();
      const stateCol = column === "ORIGIN CITY" ? "ORIGIN STATE" : "DESTINATION STATE";
      const stateRaw = getValue(row, stateCol, maps);
      const state = stateRaw ? String(stateRaw).trim().toUpperCase() : "";
      add(state ? `${city}, ${state}` : city);
      continue;
    }
    if (column === "ORIGIN STATE" || column === "DESTINATION STATE") {
      const state = getValue(row, column, maps);
      if (!state || !String(state).trim()) continue;
      add(String(state).trim().toUpperCase());
      continue;
    }

    const raw = getValue(row, column, maps);
    const key = String(raw ?? "").trim() || "Unknown";
    if (column === "EQUIPMENT") {
      const upper = key.toUpperCase();
      if (opts.equipmentMode === "ltl") {
        if (!upper.includes("LTL")) continue;
      } else if (opts.equipmentMode === "truckload") {
        if (upper.includes("LTL") || upper === "UNKNOWN") continue;
      }
    }
    add(key);
  }

  values.sort((a, b) => a.localeCompare(b));
  return values;
}

/**
 * @param {unknown[][]} rows
 * @param {import("./context.js").HeaderMaps} maps
 * @param {FilterState} filters
 * @param {(row: unknown[], value: string) => boolean} [accessorialRowMatch]
 */
export function getFilteredRows(rows, maps, filters, accessorialRowMatch) {
  let filtered = rows;

  if (filters.dateFilterEnabled && (filters.dateFilterStart || filters.dateFilterEnd)) {
    filtered = filtered.filter((row) => {
      const raw = getValue(row, filters.dateFilterColumn, maps);
      const rowDate = parseCellDate(raw);
      if (!rowDate) return false;
      if (filters.dateFilterStart) {
        const start = new Date(filters.dateFilterStart);
        start.setHours(0, 0, 0, 0);
        if (rowDate < start) return false;
      }
      if (filters.dateFilterEnd) {
        const end = new Date(filters.dateFilterEnd);
        end.setHours(23, 59, 59, 999);
        if (rowDate > end) return false;
      }
      return true;
    });
  }

  const focuses = filters.focuses ?? [];
  if (!focuses.length) return filtered;

  /** @type {Map<string, string[]>} */
  const byColumn = new Map();
  for (const item of focuses) {
    const col = String(item.column ?? "");
    const val = String(item.value ?? "").trim();
    if (!col || !val) continue;
    const list = byColumn.get(col) ?? [];
    list.push(val);
    byColumn.set(col, list);
  }

  if (!byColumn.size) return filtered;

  return filtered.filter((row) => {
    for (const [col, vals] of byColumn) {
      const hit = vals.some((val) => rowMatchesFocus(row, maps, col, val, accessorialRowMatch));
      if (!hit) return false;
    }
    return true;
  });
}
