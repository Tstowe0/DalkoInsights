import { getValue, parseCellDate } from "./context.js";

/**
 * @typedef {{
 *   dateFilterEnabled: boolean,
 *   dateFilterColumn: string,
 *   dateFilterStart: Date | null,
 *   dateFilterEnd: Date | null,
 *   focusFilterEnabled: boolean,
 *   focusFilterColumn: string | null,
 *   focusFilterValue: string | null,
 * }} FilterState
 */

/** @returns {FilterState} */
export function createDefaultFilters() {
  return {
    dateFilterEnabled: false,
    dateFilterColumn: "INVOICE DATE",
    dateFilterStart: null,
    dateFilterEnd: null,
    focusFilterEnabled: false,
    focusFilterColumn: null,
    focusFilterValue: null,
  };
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
 * @param {unknown[][]} rows
 * @param {import("./context.js").HeaderMaps} maps
 * @param {FilterState} filters
 * @param {(row: unknown[]) => boolean} [accessorialRowMatch]
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

  if (filters.focusFilterEnabled && filters.focusFilterColumn && filters.focusFilterValue != null) {
    const col = filters.focusFilterColumn;
    const val = String(filters.focusFilterValue).trim();
    filtered = filtered.filter((row) => {
      if (col === "LANE") {
        const origin = String(getValue(row, "ORIGIN STATE", maps) ?? "")
          .trim()
          .toUpperCase();
        const dest = String(getValue(row, "DESTINATION STATE", maps) ?? "")
          .trim()
          .toUpperCase();
        return `${origin} → ${dest}` === val;
      }
      if (col === "ACCESSORIAL_TYPE" && accessorialRowMatch) {
        return accessorialRowMatch(row);
      }
      if (col === "ORIGIN STATE" || col === "DESTINATION STATE") {
        const rowVal = String(getValue(row, col, maps) ?? "")
          .trim()
          .toUpperCase();
        return rowVal === val.toUpperCase();
      }
      const rowVal = String(getValue(row, col, maps) ?? "").trim();
      // Aggregations map blank/missing names to "Unknown"
      if (val === "Unknown") return !rowVal || rowVal === "Unknown";
      return rowVal === val;
    });
  }

  return filtered;
}
