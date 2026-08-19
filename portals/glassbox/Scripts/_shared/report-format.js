/**
 * Client-report Excel styling — mirrors The Glass Box openpyxl theme.
 * Requires xlsx-js-style (community SheetJS does not write fills).
 */

/** @typedef {object} ReportStyleOpts
 * @property {boolean} [hasTitleRow]
 * @property {string} [title]
 * @property {number} [titleFontSize]
 * @property {string} [headerFill]
 * @property {string} [zebraGrey]  data zebra (odd data rows) — D9D9D9 dumps, DDDDDD tracking
 * @property {string} [zebraWhite]
 * @property {boolean} [zebra]     default true; Phinia = false
 * @property {string} [freeze]     e.g. "A2" | "A3"
 * @property {number} [fixedColWidth]  character width (tracking uses 20)
 * @property {number} [autosizePad]    default 2
 * @property {number} [autosizeMax]    e.g. 50 / 60
 * @property {boolean} [wrap]
 * @property {boolean} [centerData]  default true; Phinia headers-only → false
 * @property {{ col: number, rows: Map<number, string> }} [cellHighlights]
 *   sheet row (1-based) → fill rgb for a single column
 * @property {string[]} [currencyCols] header names to format $#,##0.00
 * @property {string[]} [textCols] header names forced as text
 */

export const XL = {
  HEADER: "185074",
  WHITE: "FFFFFF",
  ZEBRA_DUMP: "D9D9D9",
  ZEBRA_TRACK: "DDDDDD",
  TODAY: "00B050",
  LATE: "F79646",
  BLACK: "000000",
};

/**
 * @param {object} workbook SheetJS workbook
 * @param {ReportStyleOpts} [opts]
 * @param {string} [sheetName] if omitted, style every sheet
 */
export function applyClientReportStyle(workbook, opts = {}, sheetName) {
  const XLSX = globalThis.XLSX;
  const {
    hasTitleRow = false,
    title = "",
    titleFontSize = 14,
    headerFill = XL.HEADER,
    zebraGrey = XL.ZEBRA_DUMP,
    zebraWhite = XL.WHITE,
    zebra = true,
    freeze = "",
    fixedColWidth = 0,
    autosizePad = 2,
    autosizeMax = 0,
    wrap = false,
    centerData = true,
    cellHighlights = null,
    currencyCols = [],
    textCols = [],
  } = opts;

  const names = sheetName ? [sheetName] : workbook.SheetNames;
  for (const name of names) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    // Insert title row if requested and not already present as row 0 merge pattern
    if (hasTitleRow && title) {
      insertTitleRow(sheet, title, XLSX);
    }

    if (!sheet["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const headerRow = hasTitleRow ? 1 : 0;
    const headers = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: headerRow, c: C });
      headers[C] = String(sheet[addr]?.v ?? sheet[addr]?.w ?? "");
    }

    const currencySet = new Set(currencyCols.map((c) => c.toUpperCase()));
    const textSet = new Set(textCols.map((c) => c.toUpperCase()));

    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!sheet[addr]) sheet[addr] = { t: "s", v: "" };
        const cell = sheet[addr];
        cell.s = cell.s || {};
        if (R === headerRow || (hasTitleRow && R === 0) || centerData) {
          cell.s.alignment = {
            horizontal: "center",
            vertical: "center",
            wrapText: wrap,
          };
        } else {
          cell.s.alignment = cell.s.alignment || {};
          if (wrap) cell.s.alignment.wrapText = true;
        }

        if (hasTitleRow && R === 0) {
          cell.s.fill = { patternType: "solid", fgColor: { rgb: headerFill } };
          cell.s.font = { bold: true, sz: titleFontSize, color: { rgb: XL.WHITE } };
          continue;
        }

        if (R === headerRow) {
          cell.s.fill = { patternType: "solid", fgColor: { rgb: headerFill } };
          cell.s.font = { bold: true, color: { rgb: XL.WHITE } };
          continue;
        }

        // Data rows
        const dataIdx = R - headerRow - 1; // 0-based within data
        if (zebra) {
          const fill = dataIdx % 2 === 0 ? zebraWhite : zebraGrey;
          cell.s.fill = { patternType: "solid", fgColor: { rgb: fill } };
        }
        cell.s.font = cell.s.font || {};

        // Match openpyxl default date display (not SheetJS m/d/yy)
        if (cell.t === "d" || cell.z === "m/d/yy" || cell.v instanceof Date) {
          cell.z = "yyyy-mm-dd hh:mm:ss";
          if (cell.v instanceof Date) cell.t = "d";
        }

        const header = String(headers[C] || "").toUpperCase();
        if (currencySet.has(header) && cell.t === "n") {
          cell.z = "$#,##0.00";
        }
        if (textSet.has(header)) {
          cell.t = "s";
          cell.v = cell.v == null ? "" : String(cell.v).replace(/^'+/, "").trim();
          cell.z = "@";
        }

        // Conditional cell highlight (1-based Excel row = R+1)
        if (cellHighlights && C === cellHighlights.col) {
          const fillRgb = cellHighlights.rows.get(R + 1);
          if (fillRgb) {
            cell.s.fill = { patternType: "solid", fgColor: { rgb: fillRgb } };
            cell.s.font = { bold: true, color: { rgb: XL.BLACK } };
          }
        }
      }
    }

    // Column widths
    const cols = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      if (fixedColWidth > 0) {
        cols.push({ wch: fixedColWidth });
        continue;
      }
      let max = 0;
      for (let R = range.s.r; R <= range.e.r; R++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const v = sheet[addr]?.v;
        let len = 0;
        if (v instanceof Date && !Number.isNaN(v.getTime())) len = 19; // yyyy-mm-dd hh:mm:ss
        else if (v != null) len = String(v).length;
        if (len > max) max = len;
      }
      let w = max + autosizePad;
      if (autosizeMax > 0) w = Math.min(w, autosizeMax);
      cols.push({ wch: Math.max(w, 1) });
    }
    sheet["!cols"] = cols;

    if (freeze) {
      // SheetJS freeze: e.g. A2 → row freeze below row 1
      const m = /^A(\d+)$/i.exec(freeze);
      if (m) {
        sheet["!freeze"] = { xSplit: 0, ySplit: Number(m[1]) - 1, topLeftCell: freeze, activePane: "bottomLeft", state: "frozen" };
        // xlsx-js-style also respects !rows / workbook views via sheetViews in some builds —
        // set both common keys
        if (!workbook.Workbook) workbook.Workbook = {};
        if (!workbook.Workbook.Views) workbook.Workbook.Views = [{ activeTab: 0 }];
        sheet["!views"] = [{ state: "frozen", ySplit: Number(m[1]) - 1, topLeftCell: freeze }];
      }
    }
  }
  return workbook;
}

/**
 * Prepend a merged title row above existing sheet content.
 * @param {object} sheet
 * @param {string} title
 * @param {any} XLSX
 */
function insertTitleRow(sheet, title, XLSX) {
  if (!sheet["!ref"]) {
    sheet.A1 = { t: "s", v: title };
    sheet["!ref"] = "A1";
    return;
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  // Shift all cells down by 1
  for (let R = range.e.r; R >= range.s.r; R--) {
    for (let C = range.e.c; C >= range.s.c; C--) {
      const from = XLSX.utils.encode_cell({ r: R, c: C });
      const to = XLSX.utils.encode_cell({ r: R + 1, c: C });
      if (sheet[from]) {
        sheet[to] = sheet[from];
        delete sheet[from];
      } else if (sheet[to]) {
        delete sheet[to];
      }
    }
  }
  range.e.r += 1;
  sheet["!ref"] = XLSX.utils.encode_range(range);

  // Title across columns
  for (let C = range.s.c; C <= range.e.c; C++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    sheet[addr] = { t: "s", v: C === range.s.c ? title : "" };
  }
  sheet["!merges"] = sheet["!merges"] || [];
  sheet["!merges"].push({
    s: { r: 0, c: range.s.c },
    e: { r: 0, c: range.e.c },
  });
}

/**
 * Build a workbook from row objects with optional ordered headers.
 * @param {Record<string, unknown>[]} rows
 * @param {string} sheetName
 * @param {string[]} [headers]
 */
export function rowsToSheetWorkbook(rows, sheetName, headers) {
  const XLSX = globalThis.XLSX;
  const workbook = XLSX.utils.book_new();
  let sheet;
  if (headers && headers.length) {
    const aoa = [headers, ...rows.map((r) => headers.map((h) => (r[h] == null ? "" : r[h])))];
    sheet = XLSX.utils.aoa_to_sheet(aoa);
  } else {
    sheet = XLSX.utils.json_to_sheet(rows);
  }
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  return workbook;
}

/**
 * Multi-sheet workbook from { name, rows, headers? }[].
 * @param {{ name: string, rows: Record<string, unknown>[], headers?: string[] }[]} sheets
 */
export function multiSheetWorkbook(sheets) {
  const XLSX = globalThis.XLSX;
  const workbook = XLSX.utils.book_new();
  for (const s of sheets) {
    let sheet;
    if (s.headers?.length) {
      const aoa = [
        s.headers,
        ...s.rows.map((r) => s.headers.map((h) => (r[h] == null ? "" : r[h]))),
      ];
      sheet = XLSX.utils.aoa_to_sheet(aoa);
    } else {
      sheet = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{}]);
    }
    XLSX.utils.book_append_sheet(workbook, sheet, s.name.slice(0, 31));
  }
  return workbook;
}
