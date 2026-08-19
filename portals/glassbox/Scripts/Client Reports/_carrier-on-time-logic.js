/**
 * Carrier On Time Merger — logic ported 1:1 from Python Glass Box v6.2.0.
 */

export const ON_TIME_BASE_COLUMNS = [
  "CLIENT NAME",
  "LOAD NO",
  "EQUIPMENT",
  "ORIGIN NAME",
  "ORIGIN ADDRESS 1",
  "ORIGIN COUNTRY",
  "ORIGIN POSTAL",
  "ORIGIN CITY",
  "DESTINATION NAME",
  "DESTINATION ADDRESS 1",
  "DESTINATION COUNTRY",
  "DESTINATION POSTAL",
  "DESTINATION CITY",
  "EXPECTED SHIP DATE",
  "ACTUAL SHIP DATE",
  "EXPECTED DELIVERY",
  "ACTUAL DELIVERY DATE",
  "EXPECTED TRANSIT DAYS",
  "ACTUAL TRANSIT DAYS",
  "CARRIER NAME1",
  "CARRIER PRO1",
];

/** @param {unknown} val */
export function normalizeKey(val) {
  if (val == null || val === "") return "";
  if (typeof val === "number" && Number.isNaN(val)) return "";
  let s = String(val).trim();
  if (s.toLowerCase() === "nan") return "";
  if (/^\d+\.0$/.test(s)) s = s.split(".")[0];
  return s.replace(/\D/g, "");
}

/**
 * Excel serial / Date / string → Date (matches pandas to_datetime coerce).
 * @param {unknown} value
 * @returns {Date | null}
 */
function toDate(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isNaN(value)) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial day (SheetJS / Excel 1900 system)
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + value * 86400000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (!s || s.toLowerCase() === "nan") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Pickup logic — ACTUAL SHIP DATE vs EXPECTED SHIP DATE.
 * @param {unknown} actual
 * @param {unknown} expected
 */
export function compareDates(actual, expected) {
  const a = toDate(actual);
  const e = toDate(expected);
  if (!a || !e) return "";
  if (a.getTime() < e.getTime()) return "EARLY";
  if (a.getTime() === e.getTime()) return "ON TIME";
  return "LATE";
}

/**
 * Delivery logic — ACTUAL TRANSIT DAYS vs EXPECTED TRANSIT DAYS.
 * @param {unknown} actualDays
 * @param {unknown} expectedDays
 */
export function compareTransit(actualDays, expectedDays) {
  try {
    if (actualDays == null || expectedDays == null || actualDays === "" || expectedDays === "") {
      return "";
    }
    if (typeof actualDays === "number" && Number.isNaN(actualDays)) return "";
    if (typeof expectedDays === "number" && Number.isNaN(expectedDays)) return "";
    const aStr = String(actualDays).trim();
    const eStr = String(expectedDays).trim();
    if (!aStr || !eStr) return "";
    const a = Number(aStr);
    const e = Number(eStr);
    if (Number.isNaN(a) || Number.isNaN(e)) return "";
    if (a < e) return "EARLY";
    if (a === e) return "ON TIME";
    return "LATE";
  } catch {
    return "";
  }
}

/**
 * Ordered unique join — mirrors Python dict.fromkeys(...).
 * @param {string[]} parts
 */
function uniqueJoin(parts) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const p of parts) {
    const t = String(p).trim();
    if (!t || t.toLowerCase() === "nan") continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join("; ");
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} headers
 */
function upperRow(row, headers) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const h of headers) {
    out[String(h).toUpperCase().trim()] = row[h];
  }
  // Also map any extra keys
  for (const [k, v] of Object.entries(row)) {
    const uk = String(k).toUpperCase().trim();
    if (!(uk in out)) out[uk] = v;
  }
  return out;
}

/**
 * Resolve On-Time output column list from dump headers (even with zero rows).
 * @param {string[]} headers
 */
export function resolveOnTimeColumns(headers) {
  const upperHeaders = headers.map((c) => String(c).toUpperCase().trim());
  const colSet = new Set(upperHeaders);

  const accessorials = [];
  for (let i = 1; i <= 10; i++) {
    const name = `ACCESSORIAL${i}`;
    if (colSet.has(name)) accessorials.push(name);
  }

  /** @type {string[]} */
  let cols = ON_TIME_BASE_COLUMNS.filter((c) => colSet.has(c)).concat(accessorials);

  const hasShip =
    cols.includes("ACTUAL SHIP DATE") && colSet.has("EXPECTED SHIP DATE");
  if (hasShip) {
    const idx = cols.indexOf("ACTUAL SHIP DATE") + 1;
    cols = [...cols.slice(0, idx), "Shipped On Time", ...cols.slice(idx)];
  }

  const hasTransit =
    cols.includes("ACTUAL TRANSIT DAYS") && cols.includes("EXPECTED TRANSIT DAYS");
  if (hasTransit) {
    const after = cols.includes("ACTUAL DELIVERY DATE")
      ? cols.indexOf("ACTUAL DELIVERY DATE") + 1
      : cols.length;
    cols = [...cols.slice(0, after), "Delivered On Time", ...cols.slice(after)];
  } else {
    cols = [...cols, "Delivered On Time"];
  }

  const delIdx = cols.indexOf("Delivered On Time");
  if (delIdx >= 0) {
    cols = [...cols.slice(0, delIdx + 1), "Carrier Reason", ...cols.slice(delIdx + 1)];
  } else {
    cols = [...cols, "Carrier Reason"];
  }

  return { cols, hasShip, hasTransit };
}

/**
 * Dump Mode — build On-Time table from TMS Data Dump.
 * @param {Record<string, unknown>[]} rows
 * @param {string[]} [headers]
 */
export function buildOnTimeTableFromDump(rows, headers) {
  const hdrs = headers?.length ? headers : rows[0] ? Object.keys(rows[0]) : [];
  if (!hdrs.length) return [];

  const { cols, hasTransit } = resolveOnTimeColumns(hdrs);
  if (!rows.length) return [];

  const upperRows = rows.map((r) => upperRow(r, hdrs));

  return upperRows.map((src) => {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const c of cols) {
      if (c === "Shipped On Time") {
        out[c] = compareDates(src["ACTUAL SHIP DATE"], src["EXPECTED SHIP DATE"]);
      } else if (c === "Delivered On Time") {
        out[c] = hasTransit
          ? compareTransit(src["ACTUAL TRANSIT DAYS"], src["EXPECTED TRANSIT DAYS"])
          : "";
      } else if (c === "Carrier Reason") {
        out[c] = "";
      } else {
        out[c] = src[c] ?? "";
      }
    }
    return out;
  });
}

/**
 * Append Mode — normalize existing On-Time output (statuses preserved).
 * @param {Record<string, unknown>[]} rows
 * @param {string[]} [headers]
 */
export function normalizeExistingOnTimeOutput(rows, headers) {
  if (!rows.length) return [];
  const hdrs = (headers?.length ? headers : Object.keys(rows[0])).map((c) => String(c).trim());

  const cleaned = rows.map((row) => {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const h of hdrs) {
      // Find original key matching trimmed header
      const orig = Object.keys(row).find((k) => String(k).trim() === h) || h;
      out[h] = row[orig];
    }
    return out;
  });

  if (cleaned[0] && "Carrier Reason" in cleaned[0]) {
    return cleaned.map((r) => ({ ...r }));
  }

  return cleaned.map((row) => {
    /** @type {Record<string, unknown>} */
    const out = {};
    const keys = Object.keys(row);
    const delIdx = keys.indexOf("Delivered On Time");
    if (delIdx >= 0) {
      keys.forEach((k, i) => {
        out[k] = row[k];
        if (i === delIdx) out["Carrier Reason"] = "";
      });
      return out;
    }
    return { ...row, "Carrier Reason": "" };
  });
}

/**
 * @param {Record<string, unknown>[]} carrierRows
 * @param {string[]} headers original header order (PRO = index 1)
 */
export function collectReasonMap(carrierRows, headers) {
  if (!carrierRows.length || !headers || headers.length < 2) return {};

  const cols = headers.map((c) => String(c).trim());
  /** @type {Record<string, string>} */
  const lowerToOrig = {};
  for (const c of cols) lowerToOrig[c.toLowerCase()] = c;

  const reasonCol = lowerToOrig.delay || lowerToOrig["service code"];
  if (!reasonCol) return {};

  const proCol = cols[1];
  /** @type {Record<string, string>} */
  const out = {};

  for (const r of carrierRows) {
    const pro = normalizeKey(r[proCol]);
    const reason = String(r[reasonCol] ?? "").trim();
    if (!pro || !reason || reason.toLowerCase() === "nan") continue;
    if (out[pro]) {
      out[pro] = uniqueJoin(out[pro].split("; ").concat([reason]));
    } else {
      out[pro] = reason;
    }
  }
  return out;
}

/**
 * Merge hierarchy: prior report → current base → new carrier file(s).
 * @param {Record<string, unknown>[]} baseRows
 * @param {Record<string, string>[]} reasonMaps
 * @param {Record<string, unknown>[] | null} priorRows
 */
export function mergeReasonsIntoOnTime(baseRows, reasonMaps, priorRows) {
  if (!baseRows.length) return baseRows;

  // Python requires exact column name "CARRIER PRO1"
  if (!("CARRIER PRO1" in baseRows[0])) return baseRows;

  let rows = baseRows.map((r) => ({ ...r }));

  if (!("Carrier Reason" in rows[0])) {
    rows = rows.map((row) => {
      /** @type {Record<string, unknown>} */
      const out = {};
      const keys = Object.keys(row);
      const delIdx = keys.indexOf("Delivered On Time");
      if (delIdx >= 0) {
        keys.forEach((k, i) => {
          out[k] = row[k];
          if (i === delIdx) out["Carrier Reason"] = "";
        });
        return out;
      }
      return { ...row, "Carrier Reason": "" };
    });
  }

  /** @type {Record<string, string>} */
  const existing = {};
  if (priorRows?.length && "CARRIER PRO1" in priorRows[0]) {
    const crCol = Object.keys(priorRows[0]).find(
      (c) => String(c).trim().toLowerCase() === "carrier reason"
    );
    if (crCol) {
      for (const r of priorRows) {
        const key = normalizeKey(r["CARRIER PRO1"]);
        const val = String(r[crCol] ?? "").trim();
        if (key && val && val.toLowerCase() !== "nan") existing[key] = val;
      }
    }
  }

  /** @type {Record<string, string>} */
  const combined = {};
  for (const m of reasonMaps) {
    for (const [k, v] of Object.entries(m)) {
      if (combined[k]) {
        combined[k] = uniqueJoin(combined[k].split("; ").concat(v.split("; ")));
      } else {
        combined[k] = v;
      }
    }
  }

  /**
   * @param {unknown} proRaw
   * @param {unknown} current
   */
  function finalReason(proRaw, current) {
    const key = normalizeKey(proRaw);
    /** @type {string[]} */
    const parts = [];
    if (key in existing) parts.push(...existing[key].split("; "));
    if (current) parts.push(...String(current).split("; "));
    if (key in combined) parts.push(...combined[key].split("; "));
    return uniqueJoin(parts);
  }

  return rows.map((r) => ({
    ...r,
    "Carrier Reason": finalReason(r["CARRIER PRO1"], r["Carrier Reason"]),
  }));
}

/**
 * @param {string[]} headers
 * @returns {boolean}
 */
export function isAppendMode(headers) {
  return headers.some((c) => String(c).trim().toLowerCase() === "carrier reason");
}

/**
 * Style On Time workbook exactly like Python style_on_time_excel.
 * @param {Record<string, unknown>[]} rows
 * @param {string[]} [fallbackHeaders] used when rows is empty (prefer resolveOnTimeColumns result)
 * @returns {object} SheetJS workbook
 */
export function styleOnTimeExcel(rows, fallbackHeaders = []) {
  const XLSX = globalThis.XLSX;
  const wb = XLSX.utils.book_new();

  const headers = rows.length ? Object.keys(rows[0]) : fallbackHeaders;
  if (!headers.length) {
    const sheet = XLSX.utils.aoa_to_sheet([[]]);
    XLSX.utils.book_append_sheet(wb, sheet, "On Time");
    return wb;
  }

  const aoa = [headers, ...rows.map((r) => headers.map((h) => (r[h] == null ? "" : r[h])))];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  const BLUE = "185074";
  const WHITE = "FFFFFF";
  const GREY = "D9D9D9";
  const LATE_RED = "FF9999";
  const EARLY_GREEN = "C6EFCE";

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  /** @type {{ wch: number }[]} */
  const cols = [];

  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!sheet[addr]) sheet[addr] = { t: "s", v: "" };
      const cell = sheet[addr];
      cell.s = cell.s || {};
      cell.s.alignment = { horizontal: "center", vertical: "center" };

      if (cell.v instanceof Date || cell.t === "d") {
        cell.t = "d";
        cell.z = "yyyy-mm-dd h:mm:ss";
      }

      const display =
        cell.v instanceof Date && !Number.isNaN(cell.v.getTime())
          ? `${cell.v.getFullYear()}-${String(cell.v.getMonth() + 1).padStart(2, "0")}-${String(cell.v.getDate()).padStart(2, "0")} ${String(cell.v.getHours()).padStart(2, "0")}:${String(cell.v.getMinutes()).padStart(2, "0")}:${String(cell.v.getSeconds()).padStart(2, "0")}`
          : cell.v;
      const len = String(display ?? "").length + 2;
      cols[C] = { wch: Math.max(cols[C]?.wch || 0, len) };

      const val = cell.v;
      const rIdx = R + 1;
      if (rIdx === 1) {
        cell.s.fill = { patternType: "solid", fgColor: { rgb: BLUE } };
        cell.s.font = { bold: true, color: { rgb: WHITE } };
        continue;
      }

      let fill = rIdx % 2 === 0 ? WHITE : GREY;
      if (val === "LATE") fill = LATE_RED;
      else if (val === "EARLY") fill = EARLY_GREEN;
      cell.s.fill = { patternType: "solid", fgColor: { rgb: fill } };
    }
  }

  sheet["!cols"] = cols;
  sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  sheet["!views"] = [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2" }];

  XLSX.utils.book_append_sheet(wb, sheet, "On Time");
  return wb;
}
