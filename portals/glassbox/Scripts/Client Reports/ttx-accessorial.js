import { headerBase, normKey } from "../_shared/report-helpers.js";
import { ferroHeaders, readFerroRows } from "./marmon-freight.js?v=20261020-ttx";
import { applyClientReportStyle, XL } from "../_shared/report-format.js?v=20261020-ttx";

/** @typedef {{ name: string, amount: number }} TtxCharge */
/** @typedef {{ id: string, origin: string, dest: string, charges: TtxCharge[], chargeCount: number }} TtxLoad */
/** @typedef {{ name: string, spend: number, shipments: number }} TtxLine */

/** Scorecard tabs. Excel sheet names cannot contain a slash, so N/ Augusta is N Augusta. */
export const TTX_CITIES = [
  { sheet: "Jacksonville", title: "JACKSONVILLE", keys: ["JACKSONVILLE"] },
  { sheet: "Joliet", title: "JOLIET", keys: ["JOLIET"] },
  { sheet: "Mira Loma", title: "MIRA LOMA", keys: ["MIRALOMA"] },
  { sheet: "N Augusta", title: "N AUGUSTA", keys: ["NAUGUSTA", "NORTHAUGUSTA"] },
];

export const TTX_COMBINED_SHEET = "All Locations Combined";
export const TTX_LIFTGATE_SHEET = "Liftgate Loads";
export const TTX_RATIO_SHEET = "Accessorial Ratio";
export const TTX_DATA_SHEET = "Data Tab";

const MONEY = "$#,##0.00";
const THIN = { style: "thin", color: { rgb: "000000" } };
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

/**
 * Data Tab theme plus a thin border on every scorecard cell.
 * @param {"title" | "header" | "data" | "total" | "note"} role
 * @param {number} stripe 0 = white, 1 = grey
 */
function scorecardStyle(role, stripe) {
  const header = role === "title" || role === "header";
  const banded = role === "data" || role === "total";
  /** @type {Record<string, unknown>} */
  const style = {
    font: {
      name: "Calibri",
      sz: 11,
      bold: header || role === "total",
      color: { rgb: header ? XL.WHITE : XL.BLACK },
    },
    alignment: { horizontal: "center", vertical: "center" },
    border: BORDER,
  };
  if (header) style.fill = { patternType: "solid", fgColor: { rgb: XL.HEADER } };
  else if (banded || role === "note") {
    style.fill = {
      patternType: "solid",
      fgColor: { rgb: banded && stripe % 2 === 1 ? XL.ZEBRA_TRACK : XL.WHITE },
    };
  }
  return style;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function spendNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text);
  const number = Number(text.replace(/[$,\s]/g, "").replace(/[()]/g, ""));
  if (!Number.isFinite(number)) return null;
  return negative ? -Math.abs(number) : number;
}

/**
 * @param {string} name
 */
function cityKey(name) {
  return normKey(name);
}

/**
 * @param {string} name
 * @param {string[]} keys
 */
function cityMatches(name, keys) {
  const key = cityKey(name);
  return keys.includes(key);
}

/**
 * Footnote set: Over-Length, CA Compliance, and Cross Border.
 * @param {string} name
 */
export function isNonControllable(name) {
  const key = normKey(name);
  if (key.includes("OVERLENGTH") || key.includes("DIMENSIONAL")) return true;
  if (key.includes("CACOMPL") || key.includes("CALIFORNIACOMPLIANCE")) return true;
  if (key.includes("CROSSBORDER")) return true;
  return false;
}

/** Accessorial name contains Liftgate, including Liftgate Delivery and Lift Gate. */
export function isLiftgate(name) {
  return normKey(name).includes("LIFTGATE");
}

/**
 * Sheet rows whose buy or sell ACCESSORIALn description is a liftgate.
 * @param {object} sheet
 * @param {{ utils: { decode_range: Function, encode_cell: Function } }} XLSX
 * @returns {Set<number>}
 */
export function liftgateSheetRows(sheet, XLSX) {
  const ref = sheet?.["!ref"];
  if (!ref) return new Set();
  const range = XLSX.utils.decode_range(ref);
  /** @type {number[]} */
  const cols = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const header = headerBase(sheet[XLSX.utils.encode_cell({ r: range.s.r, c })]?.v ?? "");
    const key = header.replace(/\s+/g, "").toUpperCase();
    if (/^ACCESSORIAL\d+$/.test(key)) cols.push(c);
  }
  /** @type {Set<number>} */
  const rows = new Set();
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    for (const col of cols) {
      const value = sheet[XLSX.utils.encode_cell({ r, c: col })]?.v;
      if (!isLiftgate(value)) continue;
      rows.add(r);
      break;
    }
  }
  return rows;
}

/**
 * @param {object} sheet
 * @param {{ utils: { decode_range: Function, encode_cell: Function } }} XLSX
 * @returns {TtxLoad[]}
 */
export function readTtxLoads(sheet, XLSX) {
  const ref = sheet?.["!ref"];
  if (!ref) throw new Error("The data dump has no worksheet.");
  const range = XLSX.utils.decode_range(ref);
  /** @type {string[]} */
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(String(cell?.v ?? "").trim());
  }
  const find = (name) => headers.findIndex((header) => normKey(headerBase(header)) === normKey(name));
  const originCol = find("ORIGIN CITY");
  const destCol = find("DESTINATION CITY");
  const loadCol = find("LOAD NO");
  if (originCol < 0 || destCol < 0) {
    throw new Error("The data dump is missing Origin City or Destination City.");
  }
  const pairs = sellAccessorialPairs(headers);

  const textAt = (row, col) => {
    if (col < 0) return "";
    return String(sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v ?? "").trim();
  };

  /** @type {TtxLoad[]} */
  const loads = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const origin = textAt(r, originCol);
    const dest = textAt(r, destCol);
    if (!origin && !dest) continue;
    /** @type {Map<string, TtxCharge>} */
    const byName = new Map();
    let chargeCount = 0;
    for (const pair of pairs) {
      const name = textAt(r, pair.descIdx);
      const amount = spendNumber(sheet[XLSX.utils.encode_cell({ r, c: pair.sellIdx })]?.v);
      if (!name || amount == null || amount === 0) continue;
      chargeCount += 1;
      const key = normKey(name);
      const prev = byName.get(key);
      if (prev) prev.amount = Math.round((prev.amount + amount) * 100) / 100;
      else byName.set(key, { name, amount });
    }
    loads.push({
      id: textAt(r, loadCol) || `row:${r + 1}`,
      origin,
      dest,
      charges: [...byName.values()],
      chargeCount,
    });
  }
  return loads;
}

/**
 * @param {TtxLoad[]} loads
 * @param {"origin" | "dest"} role
 * @param {string[]} keys empty keys means any listed city
 */
export function tallyRole(loads, role, keys) {
  const listed = keys.length ? keys : TTX_CITIES.flatMap((city) => city.keys);
  /** @type {Map<string, { name: string, spend: number, loads: Set<string> }>} */
  const buckets = new Map();
  for (const load of loads) {
    const place = role === "origin" ? load.origin : load.dest;
    if (!cityMatches(place, listed)) continue;
    for (const charge of load.charges) {
      const key = normKey(charge.name);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.spend = Math.round((bucket.spend + charge.amount) * 100) / 100;
        bucket.loads.add(load.id);
      } else {
        buckets.set(key, { name: charge.name, spend: charge.amount, loads: new Set([load.id]) });
      }
    }
  }
  return [...buckets.values()]
    .map((bucket) => ({ name: bucket.name, spend: bucket.spend, shipments: bucket.loads.size }))
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
}

/**
 * @param {object} sheet
 * @param {number} row 0-based
 * @param {number} col
 * @param {string | number} value
 * @param {{ formula?: string, format?: string, role?: "title" | "header" | "data" | "total" | "note", stripe?: number }} [opts]
 * @param {any} XLSX
 */
function put(sheet, row, col, value, opts, XLSX) {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  /** @type {Record<string, unknown>} */
  const cell = {
    v: value,
    t: typeof value === "number" ? "n" : "s",
    s: scorecardStyle(opts?.role || "data", opts?.stripe || 0),
  };
  if (opts?.formula) cell.f = opts.formula;
  if (opts?.format) cell.z = opts.format;
  sheet[addr] = cell;
}

/**
 * @param {object} sheet
 * @param {number} start 0-based
 * @param {string} title
 * @param {TtxLine[]} lines
 * @param {any} XLSX
 */
function writeBlock(sheet, start, title, lines, XLSX) {
  const merges = sheet["!merges"];
  merges.push({ s: { r: start, c: 0 }, e: { r: start, c: 2 } });
  put(sheet, start, 0, title, { role: "title" }, XLSX);
  put(sheet, start, 1, "", { role: "title" }, XLSX);
  put(sheet, start, 2, "", { role: "title" }, XLSX);
  put(sheet, start + 1, 0, "Accessorial Type", { role: "header" }, XLSX);
  put(sheet, start + 1, 1, "Spend", { role: "header" }, XLSX);
  put(sheet, start + 1, 2, "Shipments", { role: "header" }, XLSX);

  /** @type {number[]} */
  const nonRows = [];
  lines.forEach((line, index) => {
    const row = start + 2 + index;
    const stripe = index;
    put(sheet, row, 0, line.name, { role: "data", stripe }, XLSX);
    put(sheet, row, 1, line.spend, { role: "data", stripe, format: MONEY }, XLSX);
    put(sheet, row, 2, line.shipments, { role: "data", stripe }, XLSX);
    if (isNonControllable(line.name)) nonRows.push(row + 1);
  });

  const totalRow = start + 2 + lines.length;
  const firstData = start + 3;
  const lastData = totalRow;
  const spendFormula = lines.length ? `SUM(B${firstData}:B${lastData})` : "";
  const countFormula = lines.length ? `SUM(C${firstData}:C${lastData})` : "";
  const spend = lines.reduce((sum, line) => sum + line.spend, 0);
  const shipments = lines.reduce((sum, line) => sum + line.shipments, 0);
  const totalStripe = lines.length;
  put(sheet, totalRow, 0, "Total", { role: "total", stripe: totalStripe }, XLSX);
  put(sheet, totalRow, 1, Math.round(spend * 100) / 100, {
    formula: spendFormula,
    format: MONEY,
    role: "total",
    stripe: totalStripe,
  }, XLSX);
  put(sheet, totalRow, 2, shipments, { formula: countFormula, role: "total", stripe: totalStripe }, XLSX);
  return { totalRow: totalRow + 1, nonRows, next: totalRow + 3 };
}

/**
 * @param {any} XLSX
 * @param {string} title
 * @param {TtxLine[]} shipper
 * @param {TtxLine[]} consignee
 */
export function buildScorecardSheet(XLSX, title, shipper, consignee) {
  const sheet = { "!merges": /** @type {object[]} */ ([]), "!cols": [{ wch: 36 }, { wch: 16 }, { wch: 14 }, { wch: 14 }] };
  const ship = writeBlock(sheet, 0, "TTX is Shipper", shipper, XLSX);
  const cons = writeBlock(sheet, ship.next, "TTX is Consignee", consignee, XLSX);
  const summary = cons.next;
  sheet["!merges"].push({ s: { r: summary, c: 0 }, e: { r: summary, c: 3 } });
  put(sheet, summary, 0, `Total Accessorial Spend - ${title}`, { role: "title" }, XLSX);
  put(sheet, summary, 1, "", { role: "title" }, XLSX);
  put(sheet, summary, 2, "", { role: "title" }, XLSX);
  put(sheet, summary, 3, "", { role: "title" }, XLSX);

  const head = summary + 1;
  put(sheet, head, 0, "", { role: "header" }, XLSX);
  put(sheet, head, 1, "Spend", { role: "header" }, XLSX);
  put(sheet, head, 2, "Shipments", { role: "header" }, XLSX);
  put(sheet, head, 3, "Spend %", { role: "header" }, XLSX);

  const nonRow = head + 1;
  const ctrlRow = head + 2;
  const grandRow = head + 3;
  const nonExcel = nonRow + 1;
  const ctrlExcel = ctrlRow + 1;
  const grandExcel = grandRow + 1;
  const shipExcel = ship.totalRow;
  const consExcel = cons.totalRow;
  const nonCells = [...ship.nonRows, ...cons.nonRows];
  const nonSpendFormula = nonCells.length ? nonCells.map((row) => `B${row}`).join("+") : "";
  const nonCountFormula = nonCells.length ? nonCells.map((row) => `C${row}`).join("+") : "";
  const sumLines = (lines, pick) => lines.reduce((sum, line) => sum + line[pick], 0);
  const nonLines = [...shipper, ...consignee].filter((line) => isNonControllable(line.name));
  const nonSpend = Math.round(sumLines(nonLines, "spend") * 100) / 100;
  const nonCount = sumLines(nonLines, "shipments");
  const grandSpend = Math.round((sumLines(shipper, "spend") + sumLines(consignee, "spend")) * 100) / 100;
  const grandCount = sumLines(shipper, "shipments") + sumLines(consignee, "shipments");
  const ctrlSpend = Math.round((grandSpend - nonSpend) * 100) / 100;
  const ctrlCount = grandCount - nonCount;
  const share = (part) => (grandSpend ? part / grandSpend : 0);

  put(sheet, nonRow, 0, "Non-Controllable*", { role: "data", stripe: 0 }, XLSX);
  put(sheet, nonRow, 1, nonSpend, { formula: nonSpendFormula, format: MONEY, role: "data", stripe: 0 }, XLSX);
  put(sheet, nonRow, 2, nonCount, { formula: nonCountFormula, role: "data", stripe: 0 }, XLSX);
  put(sheet, nonRow, 3, share(nonSpend), { formula: `IF(B${grandExcel}=0,0,B${nonExcel}/B${grandExcel})`, format: "0%", role: "data", stripe: 0 }, XLSX);

  put(sheet, ctrlRow, 0, "Controllable", { role: "data", stripe: 1 }, XLSX);
  put(sheet, ctrlRow, 1, ctrlSpend, { formula: `B${grandExcel}-B${nonExcel}`, format: MONEY, role: "data", stripe: 1 }, XLSX);
  put(sheet, ctrlRow, 2, ctrlCount, { formula: `C${grandExcel}-C${nonExcel}`, role: "data", stripe: 1 }, XLSX);
  put(sheet, ctrlRow, 3, share(ctrlSpend), { formula: `IF(B${grandExcel}=0,0,B${ctrlExcel}/B${grandExcel})`, format: "0%", role: "data", stripe: 1 }, XLSX);

  put(sheet, grandRow, 0, "Grand Total", { role: "total", stripe: 2 }, XLSX);
  put(sheet, grandRow, 1, grandSpend, { formula: `B${shipExcel}+B${consExcel}`, format: MONEY, role: "total", stripe: 2 }, XLSX);
  put(sheet, grandRow, 2, grandCount, { formula: `C${shipExcel}+C${consExcel}`, role: "total", stripe: 2 }, XLSX);
  put(sheet, grandRow, 3, "", { format: "0%", role: "total", stripe: 2 }, XLSX);

  const note = grandRow + 1;
  sheet["!merges"].push({ s: { r: note, c: 0 }, e: { r: note, c: 3 } });
  const footnote = "*Over-Length, CA Compliance, & Cross Border";
  put(sheet, note, 0, footnote, { role: "note" }, XLSX);
  put(sheet, note, 1, "", { role: "note" }, XLSX);
  put(sheet, note, 2, "", { role: "note" }, XLSX);
  put(sheet, note, 3, "", { role: "note" }, XLSX);

  const last = XLSX.utils.encode_cell({ r: note, c: 3 });
  sheet["!ref"] = `A1:${last}`;
  return sheet;
}

/**
 * SELL ACCESSORIALn pairs with ACCESSORIALn three columns to its left.
 * On the current dump, SELL ACCESSORIAL1 is EJ and ACCESSORIAL1 is EG.
 * @param {string[]} headers
 * @returns {{ n: number, descIdx: number, sellIdx: number }[]}
 */
function sellAccessorialPairs(headers) {
  /** @type {{ n: number, descIdx: number, sellIdx: number }[]} */
  const pairs = [];
  headers.forEach((header, sellIdx) => {
    const sell = headerBase(header).replace(/\s+/g, "").toUpperCase();
    const match = /^SELLACCESSORIAL(\d+)$/.exec(sell);
    if (!match) return;
    const descIdx = sellIdx - 3;
    if (descIdx < 0) return;
    const desc = headerBase(headers[descIdx]).replace(/\s+/g, "").toUpperCase();
    if (desc !== `ACCESSORIAL${match[1]}`) return;
    pairs.push({ n: Number(match[1]), descIdx, sellIdx });
  });
  pairs.sort((a, b) => a.n - b.n);
  return pairs;
}

/**
 * @param {object} sheet
 * @param {{ utils: { decode_range: Function, encode_cell: Function } }} XLSX
 */
function dumpHeaders(sheet, XLSX) {
  const ref = sheet?.["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  /** @type {string[]} */
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(String(cell?.v ?? "").trim());
  }
  return headers;
}

/**
 * Ferroworks columns, plus each sell accessorial name and cost.
 * @param {unknown[][]} rows
 * @param {object} dumpSheet
 * @param {any} XLSX
 */
function buildDataSheet(rows, dumpSheet, XLSX) {
  const headers = ferroHeaders();
  const keep = headers
    .map((name, index) => ({ name, index }))
    .filter((column) => column.name !== "Dat Freight" && column.name !== "Dat Fuel");
  const pairs = sellAccessorialPairs(dumpHeaders(dumpSheet, XLSX));
  const extraHeaders = pairs.flatMap((pair) => [`Accessorial ${pair.n}`, `Accessorial ${pair.n} Cost`]);
  const aoa = [
    [...keep.map((column) => column.name), ...extraHeaders],
    ...rows.map((row) => {
      const base = keep.map((column) => row[column.index] ?? "");
      const sheetRow = row.sheetRow;
      const extras = pairs.flatMap((pair) => {
        if (sheetRow == null) return ["", ""];
        const name = String(dumpSheet[XLSX.utils.encode_cell({ r: sheetRow, c: pair.descIdx })]?.v ?? "").trim();
        const amount = spendNumber(dumpSheet[XLSX.utils.encode_cell({ r: sheetRow, c: pair.sellIdx })]?.v);
        return [name, amount == null ? "" : amount];
      });
      return [...base, ...extras];
    }),
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

/**
 * Sell cost column titles for the data-tab currency format.
 * @param {object} dumpSheet
 * @param {any} XLSX
 */
function sellCostHeaders(dumpSheet, XLSX) {
  return sellAccessorialPairs(dumpHeaders(dumpSheet, XLSX)).map((pair) => `Accessorial ${pair.n} Cost`);
}

/**
 * Shipments are loads. Each sell accessorial charge counts on its own,
 * so one load with three charges is 1 shipment and 3 accessorials.
 * @param {any} XLSX
 * @param {TtxLoad[]} loads
 */
function buildRatioSheet(XLSX, loads) {
  const shipments = loads.length;
  const accessorials = loads.reduce((sum, load) => sum + load.chargeCount, 0);
  const ratio = shipments ? accessorials / shipments : 0;
  const sheet = {
    "!merges": /** @type {object[]} */ ([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } },
    ]),
    "!cols": [{ wch: 36 }, { wch: 16 }],
    "!rows": [, , , , , { hpt: 32 }],
  };
  put(sheet, 0, 0, "Accessorial Ratio", { role: "title" }, XLSX);
  put(sheet, 0, 1, "", { role: "title" }, XLSX);
  put(sheet, 1, 0, "", { role: "header" }, XLSX);
  put(sheet, 1, 1, "Count", { role: "header" }, XLSX);
  put(sheet, 2, 0, "Shipments", { role: "data", stripe: 0 }, XLSX);
  put(sheet, 2, 1, shipments, { role: "data", stripe: 0 }, XLSX);
  put(sheet, 3, 0, "Accessorials", { role: "data", stripe: 1 }, XLSX);
  put(sheet, 3, 1, accessorials, { role: "data", stripe: 1 }, XLSX);
  put(sheet, 4, 0, "Accessorials per Shipment", { role: "total", stripe: 2 }, XLSX);
  put(sheet, 4, 1, Math.round(ratio * 100) / 100, {
    role: "total",
    stripe: 2,
    format: "0.00",
    formula: "IF(B3=0,0,B4/B3)",
  }, XLSX);
  const note = "A shipment with 3 accessorial charges counts as 1 shipment and 3 accessorials.";
  put(sheet, 5, 0, note, { role: "note" }, XLSX);
  put(sheet, 5, 1, "", { role: "note" }, XLSX);
  sheet.A6.s.alignment.wrapText = true;

  const buckets = [0, 0, 0, 0, 0];
  for (const load of loads) {
    const count = load.chargeCount;
    if (count >= 4) buckets[4] += 1;
    else buckets[count] += 1;
  }
  const labels = ["Loads with 0", "Loads with 1", "Loads with 2", "Loads with 3", "Loads with 4+"];
  const start = 8;
  sheet["!merges"].push({ s: { r: start, c: 0 }, e: { r: start, c: 1 } });
  put(sheet, start, 0, "Loads by Accessorial Count", { role: "title" }, XLSX);
  put(sheet, start, 1, "", { role: "title" }, XLSX);
  put(sheet, start + 1, 0, "", { role: "header" }, XLSX);
  put(sheet, start + 1, 1, "Count", { role: "header" }, XLSX);
  labels.forEach((label, index) => {
    const row = start + 2 + index;
    put(sheet, row, 0, label, { role: "data", stripe: index }, XLSX);
    put(sheet, row, 1, buckets[index], { role: "data", stripe: index }, XLSX);
  });
  const totalRow = start + 2 + labels.length;
  const firstExcel = start + 3;
  const lastExcel = totalRow;
  put(sheet, totalRow, 0, "Total", { role: "total", stripe: labels.length }, XLSX);
  put(sheet, totalRow, 1, shipments, {
    role: "total",
    stripe: labels.length,
    formula: `SUM(B${firstExcel}:B${lastExcel})`,
  }, XLSX);

  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: 1 } });
  return sheet;
}

/**
 * @param {ArrayBuffer} buffer
 */
export async function buildTtxWorkbook(buffer) {
  const XLSX = globalThis.XLSX;
  const dump = XLSX.read(buffer, { type: "array", cellDates: true });
  const dumpSheet = dump.Sheets[dump.SheetNames[0]];
  if (!dumpSheet) throw new Error("The data dump has no worksheet.");

  const loads = readTtxLoads(dumpSheet, XLSX);
  const workbook = XLSX.utils.book_new();
  for (const city of TTX_CITIES) {
    const sheet = buildScorecardSheet(
      XLSX,
      city.title,
      tallyRole(loads, "origin", city.keys),
      tallyRole(loads, "dest", city.keys)
    );
    XLSX.utils.book_append_sheet(workbook, sheet, city.sheet);
  }
  const combined = buildScorecardSheet(
    XLSX,
    "ALL LOCATIONS COMBINED",
    tallyRole(loads, "origin", []),
    tallyRole(loads, "dest", [])
  );
  XLSX.utils.book_append_sheet(workbook, combined, TTX_COMBINED_SHEET);

  const dataRows = readFerroRows(dumpSheet, XLSX);
  const liftRows = liftgateSheetRows(dumpSheet, XLSX);
  const liftgateRows = dataRows.filter((row) => liftRows.has(row.sheetRow));
  const liftSheet = buildDataSheet(liftgateRows, dumpSheet, XLSX);
  XLSX.utils.book_append_sheet(workbook, liftSheet, TTX_LIFTGATE_SHEET);
  const ratioSheet = buildRatioSheet(XLSX, loads);
  XLSX.utils.book_append_sheet(workbook, ratioSheet, TTX_RATIO_SHEET);
  const dataSheet = buildDataSheet(dataRows, dumpSheet, XLSX);
  XLSX.utils.book_append_sheet(workbook, dataSheet, TTX_DATA_SHEET);
  const dataStyle = {
    headerFill: XL.HEADER,
    zebraGrey: XL.ZEBRA_TRACK,
    zebraWhite: XL.WHITE,
    fixedColWidth: 21,
    freeze: "",
    currencyCols: sellCostHeaders(dumpSheet, XLSX),
  };
  applyClientReportStyle(workbook, dataStyle, TTX_LIFTGATE_SHEET);
  applyClientReportStyle(workbook, dataStyle, TTX_DATA_SHEET);
  return {
    workbook,
    loadCount: loads.length,
    rowCount: dataRows.length,
    liftCount: liftgateRows.length,
    accessorialCount: loads.reduce((sum, load) => sum + load.chargeCount, 0),
  };
}
