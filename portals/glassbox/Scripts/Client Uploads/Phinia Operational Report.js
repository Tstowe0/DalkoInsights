import { mountFileTool } from "../_shared/file-ui.js?v=20261015-ops";
import { readFileBuffer } from "../_shared/excel.js";
import { confirmDialog } from "../../../../shared/js/dialog.js?v=20261006-nobrand";

export const meta = {
  id: "Phinia Operational Report",
  title: "Phinia Operational Report",
  category: "Client Uploads",
  script: "Client Uploads/Phinia Operational Report.js",
};

const WEIGHT_HEADERS = ["Total Weight in LBs", "Total Weight", "Gross Weight", "Gross Weight in LBs"];
const PALLET_HEADERS = ["Pallet", "Pallets", "Pallet Count"];
const WEIGHT_ERROR =
  "Phinia Original file missing weight column ('Total Weight' / 'Total Weight in LBs' / 'Gross Weight' / 'Gross Weight in LBs')";
const SHEET_WEIGHT_ERROR =
  "Could not find weight column ('Total Weight' / 'Total Weight in LBs' / 'Gross Weight' / 'Gross Weight in LBs') in Phinia Original file";

/**
 * Desktop openpyxl delivery key. Text stays text (leading zeros survive). Floats truncate.
 * @param {unknown} raw
 */
export function normalizeDelivery(raw) {
  if (raw == null || raw === "") return "";
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return "";
    return String(Math.trunc(raw));
  }
  let delivery = String(raw).trim();
  if (delivery.includes("/")) delivery = delivery.split("/")[0].trim();
  if (!delivery || delivery.toLowerCase() === "nan") return "";
  return delivery;
}

/**
 * Pandas/openpyxl text cleanup used for Carrier and Quote ID.
 * Float columns keep the trailing .0 that str(555.0) produces.
 * @param {{ kind: string, n?: number, s?: string } | null | undefined} value
 */
function desktopText(value) {
  if (!value || value.kind === "empty") return "";
  let text = "";
  if (value.kind === "int") text = String(value.n);
  else if (value.kind === "float") text = pythonFloatStr(/** @type {number} */ (value.n));
  else text = String(value.s ?? "");
  text = text.trim();
  if (!text || text.toLowerCase() === "nan") return "";
  return text;
}

/** @param {number} n */
function pythonFloatStr(n) {
  if (!Number.isFinite(n)) return "nan";
  if (Object.is(n, -0)) return "-0.0";
  if (Number.isInteger(n)) return `${n}.0`;
  return String(n);
}

/**
 * Tracking keys follow pandas dtype coercion, then the desktop int/slash rules.
 * @param {{ kind: string, n?: number, s?: string } | null | undefined} value
 */
function trackingDeliveryKey(value) {
  if (!value || value.kind === "empty") return "";
  if (value.kind === "int") return String(value.n);
  if (value.kind === "float") return String(Math.trunc(/** @type {number} */ (value.n)));
  let text = String(value.s ?? "").trim();
  if (text.includes("/")) text = text.split("/")[0].trim();
  if (!text || text.toLowerCase() === "nan") return "";
  return text;
}

/** @param {unknown} value */
function safeInt(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.trunc(value);
  }
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "nan") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/** @param {string} text */
function escapeXml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** @param {string} text */
function decodeXml(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replaceAll("&amp;", "&");
}

/** @param {number} col 1-based */
function colName(col) {
  let n = col;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** @param {string} letters */
function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} data */
function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {Uint8Array} compressed */
async function inflateRaw(compressed) {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {Promise<Map<string, Uint8Array>>}
 */
async function unzip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("not an xlsx workbook");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not an xlsx workbook");
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error("unreadable xlsx workbook");
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOff = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen)).replaceAll("\\", "/").replace(/^\/+/, "");
    const localNameLen = view.getUint16(localOff + 26, true);
    const localExtraLen = view.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(dataOff, dataOff + compSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = await inflateRaw(compressed);
    else throw new Error(`unsupported xlsx compression ${method}`);
    files.set(name, data);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** @param {{ name: string, data: Uint8Array }[]} entries */
function zipStore(entries) {
  const encoder = new TextEncoder();
  /** @type {Uint8Array[]} */
  const locals = [];
  /** @type {Uint8Array[]} */
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let pos = 0;
  for (const part of locals) {
    out.set(part, pos);
    pos += part.length;
  }
  for (const part of centrals) {
    out.set(part, pos);
    pos += part.length;
  }
  out.set(eocd, pos);
  return out;
}

/** @param {Uint8Array | undefined | null} data */
function xmlText(data) {
  if (!data) return "";
  return new TextDecoder("utf-8").decode(data);
}

/** @param {string} xml */
function encodeXml(xml) {
  return new TextEncoder().encode(xml);
}

/** @param {Map<string, Uint8Array>} files @param {string} wanted */
function zipKey(files, wanted) {
  const norm = wanted.replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
  for (const key of files.keys()) {
    if (key.toLowerCase() === norm) return key;
  }
  return "";
}

/** @param {Map<string, Uint8Array>} files @param {Map<string, Uint8Array>} changed */
function repack(files, changed) {
  /** @type {{ name: string, data: Uint8Array }[]} */
  const entries = [];
  const seen = new Set();
  for (const [name, data] of files) {
    entries.push({ name, data: changed.get(name) || data });
    seen.add(name);
  }
  for (const [name, data] of changed) {
    if (!seen.has(name)) entries.push({ name, data });
  }
  return zipStore(entries);
}

/** @param {string} xml */
function parseSharedStrings(xml) {
  if (!xml) return [];
  /** @type {string[]} */
  const out = [];
  const siRe = /<(?:[\w]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?si>/g;
  let match;
  while ((match = siRe.exec(xml))) {
    const inner = match[1].replace(/<(?:[\w]+:)?rPh\b[\s\S]*?<\/(?:[\w]+:)?rPh>/g, "");
    /** @type {string[]} */
    const parts = [];
    const tRe = /<(?:[\w]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?t>/g;
    let text;
    while ((text = tRe.exec(inner))) parts.push(decodeXml(text[1]));
    out.push(parts.join(""));
  }
  return out;
}

/** @param {string} relsXml */
function parseRels(relsXml) {
  /** @type {Map<string, string>} */
  const rels = new Map();
  const re = /<(?:[\w]+:)?Relationship\b[^>]*>/g;
  let match;
  while ((match = re.exec(relsXml))) {
    const id = (match[0].match(/\bId="([^"]+)"/) || [])[1];
    const target = (match[0].match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && target) rels.set(id, target);
  }
  return rels;
}

/** @param {string} target */
function sheetZipPath(target) {
  let path = decodeXml(target).replaceAll("\\", "/");
  if (path.startsWith("/")) path = path.slice(1);
  if (/^xl\//i.test(path)) return path;
  return `xl/${path.replace(/^\.\//, "")}`;
}

/**
 * @param {Map<string, Uint8Array>} files
 */
function workbookPaths(files) {
  const bookKey = zipKey(files, "xl/workbook.xml");
  const relKey = zipKey(files, "xl/_rels/workbook.xml.rels");
  if (!bookKey || !relKey) throw new Error("the workbook is missing its sheet list");
  const workbookXml = xmlText(files.get(bookKey));
  const rels = parseRels(xmlText(files.get(relKey)));
  /** @type {string[]} */
  const paths = [];
  const sheetRe = /<(?:[\w]+:)?sheet\b[^>]*>/g;
  let match;
  while ((match = sheetRe.exec(workbookXml))) {
    const rid = (match[0].match(/\br:id="([^"]+)"/) || [])[1];
    const target = rid ? rels.get(rid) : "";
    if (target) paths.push(sheetZipPath(target));
  }
  if (!paths.length) throw new Error("the workbook has no sheets");
  const active = Number((workbookXml.match(/<(?:[\w]+:)?workbookView\b[^>]*\bactiveTab="(\d+)"/) || [])[1] ?? 0);
  return { first: paths[0], active: paths[active] || paths[0] };
}

/**
 * @param {string} inner
 * @param {string[]} shared
 */
function parseCells(inner, shared) {
  /** @type {SheetCell[]} */
  const cells = [];
  const re = /<(?:[\w]+:)?c\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:[\w]+:)?c>)/g;
  let match;
  while ((match = re.exec(inner))) {
    const xml = match[0];
    const open = xml.match(/^<(?:[\w]+:)?c\b[^>]*>/)?.[0] || xml;
    const ref = open.match(/\br="([A-Z]+)(\d+)"/);
    if (!ref) continue;
    const col = colIndex(ref[1]);
    const row = Number(ref[2]);
    const type = (open.match(/\bt="([^"]+)"/) || [])[1] || "";
    const style = Number((open.match(/\bs="(\d+)"/) || [])[1] ?? 0);
    const selfClose = xml.endsWith("/>") && !xml.includes("</");
    const body = selfClose ? "" : xml.slice(open.length, xml.lastIndexOf("</"));
    const formula = body.match(/<(?:[\w]+:)?f\b([^>]*)>([\s\S]*?)<\/(?:[\w]+:)?f>/);
    const formulaEmpty = body.match(/<(?:[\w]+:)?f\b([^>]*)\/>/);
    const formulaAttrs = formula?.[1] || formulaEmpty?.[1] || "";
    const formulaText = formula ? decodeXml(formula[2]) : "";
    const sharedSlave = /t="shared"/.test(formulaAttrs) && !formula;
    const cachedMatch = body.match(/<(?:[\w]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?v>/);
    const cached = cachedMatch ? decodeXml(cachedMatch[1]) : null;
    /** @type {string | number | null} */
    let value = null;
    if (formulaText) value = `=${formulaText}`;
    else if (sharedSlave) value = "=";
    else if (type === "s") value = shared[Number(cached)] ?? "";
    else if (type === "inlineStr" || type === "str") {
      const parts = [...body.matchAll(/<(?:[\w]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?t>/g)].map((part) => decodeXml(part[1]));
      value = parts.length ? parts.join("") : cached ?? "";
    } else if (cached != null && cached !== "") {
      value = Number(cached);
    }
    cells.push({ row, col, style, xml, type, formulaText, sharedSlave, cached, value });
  }
  return cells;
}

/**
 * @param {string} sheetXml
 * @param {string[]} shared
 */
function parseSheet(sheetXml, shared) {
  /** @type {Map<number, ParsedRow>} */
  const rows = new Map();
  /** @type {Map<string, SheetCell>} */
  const cells = new Map();
  let maxRow = 0;
  let maxCol = 0;
  const rowRe = /<(?:[\w]+:)?row\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:[\w]+:)?row>)/g;
  let match;
  while ((match = rowRe.exec(sheetXml))) {
    const raw = match[0];
    const open = raw.match(/^<(?:[\w]+:)?row\b[^>]*>/)?.[0] || raw;
    const selfClose = raw.endsWith("/>") && !raw.includes("</");
    const inner = selfClose ? "" : raw.slice(open.length, raw.lastIndexOf("</"));
    const parsed = parseCells(inner, shared);
    const rowNum = Number((open.match(/\br="(\d+)"/) || [])[1] || parsed[0]?.row || 0);
    if (!rowNum) continue;
    rows.set(rowNum, { number: rowNum, open: selfClose ? open.replace(/\/>$/, ">") : open, cells: parsed, raw, selfClose });
    for (const cell of parsed) {
      cells.set(`${cell.row}:${cell.col}`, cell);
      maxRow = Math.max(maxRow, cell.row);
      maxCol = Math.max(maxCol, cell.col);
    }
  }
  return { rows, cells, maxRow, maxCol };
}

/** @param {Map<string, SheetCell>} cells @param {number} row @param {number} col */
function sheetCell(cells, row, col) {
  return cells.get(`${row}:${col}`) || null;
}

/** @param {SheetCell | null | undefined} cell */
function pandasValue(cell) {
  if (!cell) return { kind: "empty" };
  if (cell.formulaText || cell.sharedSlave) {
    if (cell.cached == null || cell.cached === "") return { kind: "empty" };
    if (cell.type === "s") return { kind: "str", s: cell.value == null ? "" : String(cell.value) };
    if (cell.type === "str" || cell.type === "inlineStr") return { kind: "str", s: cell.cached };
    return numberKind(cell.cached);
  }
  if (cell.type === "s" || cell.type === "inlineStr" || cell.type === "str") {
    if (cell.value == null || cell.value === "") return { kind: "empty" };
    return { kind: "str", s: String(cell.value) };
  }
  if (cell.cached != null && cell.cached !== "") return numberKind(cell.cached);
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) return numberKind(String(cell.value));
  if (cell.value == null || cell.value === "") return { kind: "empty" };
  return { kind: "str", s: String(cell.value) };
}

/**
 * Classify an Excel cached number the way pandas does: 10 stays int, 10.0 and 1e2 stay float.
 * @param {string} text
 */
function numberKind(text) {
  const n = Number(text);
  if (!Number.isFinite(n)) return { kind: "str", s: text };
  if (/[eE.]/.test(text)) return { kind: "float", n };
  return { kind: "int", n };
}

/** @param {string} text */
function isPlainIntString(text) {
  return /^[+-]?\d+$/.test(text.trim());
}

/** @param {string} text */
function isFloatString(text) {
  const trimmed = text.trim();
  if (!trimmed || isPlainIntString(trimmed)) return false;
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed);
}

/**
 * Match pandas.read_excel column dtypes: all-numeric columns become int64 or float64.
 * A single non-numeric text value keeps every cell's original type, including leading zeros.
 * @param {{ kind: string, n?: number, s?: string }[]} values
 */
function coerceColumn(values) {
  const present = values.filter((value) => value.kind !== "empty");
  if (!present.length) return values;
  const numeric = present.every((value) => {
    if (value.kind === "int" || value.kind === "float") return true;
    if (value.kind === "str") return isPlainIntString(value.s || "") || isFloatString(value.s || "");
    return false;
  });
  if (!numeric) return values;
  const forceFloat =
    values.some((value) => value.kind === "empty") ||
    present.some((value) => value.kind === "float" || (value.kind === "str" && isFloatString(value.s || "")));
  return values.map((value) => {
    if (value.kind === "empty") return value;
    const n = value.kind === "str" ? Number((value.s || "").trim()) : /** @type {number} */ (value.n);
    if (forceFloat) return { kind: "float", n };
    return { kind: "int", n: Math.trunc(n) };
  });
}

/**
 * @param {ReturnType<typeof parseSheet>} sheet
 */
function pandasTable(sheet) {
  const width = Math.max(sheet.maxCol, 1);
  /** @type {string[]} */
  const headers = [];
  const seen = new Map();
  for (let col = 1; col <= width; col++) {
    const raw = sheetCell(sheet.cells, 1, col)?.value;
    let base = raw == null || String(raw).trim() === "" ? `Unnamed: ${col - 1}` : String(raw);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    headers.push(count === 0 ? base : `${base}.${count}`);
  }
  /** @type {{ kind: string, n?: number, s?: string }[][]} */
  const columns = Array.from({ length: width }, () => []);
  const height = Math.max(sheet.maxRow - 1, 0);
  for (let row = 2; row <= sheet.maxRow; row++) {
    for (let col = 1; col <= width; col++) columns[col - 1].push(pandasValue(sheetCell(sheet.cells, row, col)));
  }
  const coerced = columns.map((column) => coerceColumn(column));
  /** @type {unknown[][]} */
  const records = [];
  for (let i = 0; i < height; i++) {
    records.push(coerced.map((column) => plainValue(column[i])));
  }
  /** @type {{ kind: string, n?: number, s?: string }[][]} */
  const kindRows = [];
  for (let i = 0; i < height; i++) kindRows.push(coerced.map((column) => column[i] || { kind: "empty" }));
  return { headers, records, kindRows };
}

/** @param {{ kind: string, n?: number, s?: string } | undefined} value */
function plainValue(value) {
  if (!value || value.kind === "empty") return null;
  if (value.kind === "int" || value.kind === "float") return value.n;
  return value.s ?? "";
}

/** @param {unknown} raw */
function headerLabel(raw) {
  if (raw == null) return "";
  return String(raw).trim();
}

/** @param {unknown} raw */
function truthyCell(raw) {
  if (raw == null || raw === "") return false;
  if (typeof raw === "number") return Number.isFinite(raw) && raw !== 0;
  return String(raw).length > 0;
}

/**
 * openpyxl checks range(1, min(10, max_row + 1)), so row 10 is not included.
 * @param {Map<string, SheetCell>} cells
 * @param {number} maxRow
 */
function findHeaderRowNumber(cells, maxRow) {
  const last = Math.min(9, maxRow);
  for (let row = 1; row <= last; row++) {
    if (truthyCell(sheetCell(cells, row, 1)?.value)) return row;
  }
  return 1;
}

/**
 * @param {Map<string, SheetCell>} cells
 * @param {number} headerRow
 * @param {number} maxCol
 * @param {string[]} names
 */
function findSheetColumn(cells, headerRow, maxCol, names) {
  const wanted = new Set(names);
  for (let col = 1; col <= maxCol; col++) {
    if (wanted.has(headerLabel(sheetCell(cells, headerRow, col)?.value))) return col;
  }
  return 0;
}

/** @param {Map<string, SheetCell>} cells @param {number} headerRow @param {number} maxCol */
function lastHeaderColumn(cells, headerRow, maxCol) {
  for (let col = maxCol; col >= 1; col--) {
    if (headerLabel(sheetCell(cells, headerRow, col)?.value)) return col;
  }
  return maxCol;
}

/** @param {string} inner */
function extractXfs(inner) {
  /** @type {string[]} */
  const xfs = [];
  const re = /<(?:[\w]+:)?xf\b/g;
  let match;
  while ((match = re.exec(inner))) {
    const start = match.index;
    const openEnd = inner.indexOf(">", start);
    if (openEnd < 0) break;
    const open = inner.slice(start, openEnd + 1);
    if (open.endsWith("/>")) {
      xfs.push(open);
      re.lastIndex = openEnd + 1;
      continue;
    }
    const closeRe = /<\/(?:[\w]+:)?xf>/g;
    closeRe.lastIndex = openEnd;
    const close = closeRe.exec(inner);
    if (!close) break;
    xfs.push(inner.slice(start, close.index + close[0].length));
    re.lastIndex = close.index + close[0].length;
  }
  return xfs;
}

/** @param {string} xf */
function toGeneralXf(xf) {
  let out = /\bnumFmtId=/.test(xf) ? xf.replace(/\bnumFmtId="[^"]*"/, 'numFmtId="0"') : xf.replace(/<((?:[\w]+:)?xf\b)/, '<$1 numFmtId="0"');
  return out.replace(/\s*\bapplyNumberFormat="[^"]*"/, "");
}

/**
 * Clone source styles without their number format, matching openpyxl's fill/font/alignment/border copy.
 * @param {string} stylesXml
 * @param {number[]} sources
 */
function mapGeneralStyles(stylesXml, sources) {
  const block = stylesXml.match(/<(?:[\w]+:)?cellXfs\b[^>]*>[\s\S]*?<\/(?:[\w]+:)?cellXfs>/);
  /** @type {Map<number, number>} */
  const map = new Map();
  if (!block) {
    for (const source of sources) map.set(source, source);
    return { xml: stylesXml, map };
  }
  const open = block[0].match(/^<(?:[\w]+:)?cellXfs\b[^>]*>/)?.[0] || "<cellXfs>";
  const close = block[0].match(/<\/(?:[\w]+:)?cellXfs>$/)?.[0] || "</cellXfs>";
  const inner = block[0].slice(open.length, block[0].length - close.length);
  const xfs = extractXfs(inner);
  /** @type {string[]} */
  const extras = [];
  for (const source of sources) {
    const original = xfs[source] || xfs[0] || "";
    const general = original ? toGeneralXf(original) : "";
    let index = general ? xfs.indexOf(general) : 0;
    if (index < 0) {
      const extraIndex = extras.indexOf(general);
      index = extraIndex < 0 ? -1 : xfs.length + extraIndex;
    }
    if (index < 0) {
      extras.push(general);
      index = xfs.length + extras.length - 1;
    }
    map.set(source, index);
  }
  if (!extras.length) return { xml: stylesXml, map };
  const count = xfs.length + extras.length;
  const openUpdated = /\bcount="\d+"/.test(open) ? open.replace(/\bcount="\d+"/, `count="${count}"`) : open.replace(">", ` count="${count}">`);
  const next = `${openUpdated}${inner}${extras.join("")}${close}`;
  return { xml: stylesXml.replace(block[0], next), map };
}

/** @param {number} row @param {number} col @param {string} text @param {number} styleIndex */
function inlineStringCell(row, col, text, styleIndex) {
  const ref = `${colName(col)}${row}`;
  if (!text) return `<c r="${ref}" s="${styleIndex}" t="inlineStr"></c>`;
  return `<c r="${ref}" s="${styleIndex}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`;
}

/** @param {string} cellXml @param {number} col @param {number} row */
function withRef(cellXml, col, row) {
  const ref = `${colName(col)}${row}`;
  if (/\br="[A-Z]+\d+"/.test(cellXml)) return cellXml.replace(/\br="[A-Z]+\d+"/, `r="${ref}"`);
  return cellXml.replace(/<(?:[\w]+:)?c\b/, (tag) => `${tag} r="${ref}"`);
}

/** @param {string} open @param {number} maxCol */
function updateSpans(open, maxCol) {
  if (/spans="\d+:\d+"/.test(open)) return open.replace(/spans="(\d+):\d+"/, (_, start) => `spans="${start}:${maxCol}"`);
  return open;
}

/** @param {string} sheetXml @param {string} sheetData */
function replaceSheetData(sheetXml, sheetData) {
  const block = sheetXml.match(/<(?:[\w]+:)?sheetData\b[^>]*>[\s\S]*?<\/(?:[\w]+:)?sheetData>/);
  if (!block) throw new Error("the sheet is empty");
  const open = block[0].match(/^<(?:[\w]+:)?sheetData\b[^>]*>/)?.[0] || "<sheetData>";
  const close = block[0].match(/<\/(?:[\w]+:)?sheetData>$/)?.[0] || "</sheetData>";
  return sheetXml.replace(block[0], `${open}${sheetData}${close}`);
}

/** @param {string} sheetXml @param {number} maxRow @param {number} maxCol */
function replaceDimension(sheetXml, maxRow, maxCol) {
  const ref = `A1:${colName(Math.max(maxCol, 1))}${Math.max(maxRow, 1)}`;
  if (/<(?:[\w]+:)?dimension\b/.test(sheetXml)) {
    return sheetXml.replace(/<(?:[\w]+:)?dimension\b[^>]*(?:\/>|><\/(?:[\w]+:)?dimension>)/, `<dimension ref="${ref}"/>`);
  }
  return sheetXml.replace(/<(?:[\w]+:)?sheetData\b/, `<dimension ref="${ref}"/><sheetData`);
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} label
 */
async function readWorkbook(buffer, label) {
  try {
    const files = await unzip(buffer);
    const paths = workbookPaths(files);
    const sharedKey = zipKey(files, "xl/sharedStrings.xml");
    const shared = parseSharedStrings(xmlText(sharedKey ? files.get(sharedKey) : null));
    const load = (path) => {
      const key = zipKey(files, path);
      if (!key) throw new Error("the worksheet is missing");
      return { key, xml: xmlText(files.get(key)), sheet: parseSheet(xmlText(files.get(key)), shared) };
    };
    return { files, shared, first: load(paths.first), active: load(paths.active) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Error reading ${label} file: ${message}`);
  }
}

/**
 * Merge Phinia Original with Tracking Report the way the desktop Glass Box tool does.
 * The original workbook is edited in place so fonts, fills, borders, formulas, and column widths stay.
 * @param {ArrayBuffer} phiniaBuffer
 * @param {ArrayBuffer} trackingBuffer
 */
export async function mergePhiniaOperationalReport(phiniaBuffer, trackingBuffer) {
  const phinia = await readWorkbook(phiniaBuffer, "Phinia Original");
  const tracking = await readWorkbook(trackingBuffer, "Tracking Report");
  const phiniaTable = pandasTable(phinia.first.sheet);
  const trackingTable = pandasTable(tracking.first.sheet);

  if (!phiniaTable.headers.includes("Delivery")) throw new Error("Phinia Original file missing 'Delivery' column");
  if (!WEIGHT_HEADERS.some((name) => phiniaTable.headers.includes(name))) throw new Error(WEIGHT_ERROR);
  if (!trackingTable.headers.includes("Delivery No.")) throw new Error("Tracking Report file missing 'Delivery No.' column");
  if (!trackingTable.headers.includes("Carrier")) throw new Error("Tracking Report file missing 'Carrier' column");
  if (!trackingTable.headers.includes("Carrier Quote No")) throw new Error("Tracking Report file missing 'Carrier Quote No' column");

  const deliveryIndex = trackingTable.headers.indexOf("Delivery No.");
  const carrierIndex = trackingTable.headers.indexOf("Carrier");
  const quoteIndex = trackingTable.headers.indexOf("Carrier Quote No");
  /** @type {Map<string, { carrier: string, quote: string }>} */
  const lookup = new Map();
  for (const row of trackingTable.kindRows) {
    const delivery = trackingDeliveryKey(row[deliveryIndex]);
    if (!delivery) continue;
    lookup.set(delivery, {
      carrier: desktopText(row[carrierIndex]),
      quote: desktopText(row[quoteIndex]),
    });
  }

  const sheet = phinia.active.sheet;
  const headerRow = findHeaderRowNumber(sheet.cells, sheet.maxRow);
  const weightCol = findSheetColumn(sheet.cells, headerRow, sheet.maxCol, WEIGHT_HEADERS);
  if (!weightCol) throw new Error(SHEET_WEIGHT_ERROR);
  const palletCol = findSheetColumn(sheet.cells, headerRow, sheet.maxCol, PALLET_HEADERS);
  const deliveryCol = findSheetColumn(sheet.cells, headerRow, sheet.maxCol, ["Delivery"]);
  const lastHeader = lastHeaderColumn(sheet.cells, headerRow, sheet.maxCol);
  const insertAt = lastHeader + 1;
  const carrierCol = lastHeader + 1;
  const quoteCol = lastHeader + 2;
  const headerStyle = sheetCell(sheet.cells, headerRow, lastHeader)?.style ?? 0;

  /** @type {Map<number, { col: number, text: string, style: number }[]>} */
  const additions = new Map();
  additions.set(headerRow, [
    { col: carrierCol, text: "Carrier", style: headerStyle },
    { col: quoteCol, text: "Quote ID", style: headerStyle },
  ]);

  let matched = 0;
  let seenRnl = false;
  /** @type {{ row: number, delivery: string, carrier: string, pallets: number }[]} */
  const palletExceptions = [];
  /** @type {number[]} */
  const exceptionIndexes = [];

  for (let row = headerRow + 1; row <= sheet.maxRow; row++) {
    let delivery = "";
    if (deliveryCol) delivery = normalizeDelivery(sheetCell(sheet.cells, row, deliveryCol)?.value);
    /** @type {string} */
    let carrierText = "";
    if (delivery && lookup.has(delivery)) {
      const info = lookup.get(delivery);
      carrierText = info?.carrier || "";
      const style = sheetCell(sheet.cells, row, weightCol)?.style ?? 0;
      additions.set(row, [
        { col: carrierCol, text: carrierText, style },
        { col: quoteCol, text: info?.quote || "", style },
      ]);
      matched += 1;
    }
    if (carrierText.toLowerCase().includes("r&l")) seenRnl = true;
    const palletCount = palletCol ? safeInt(sheetCell(sheet.cells, row, palletCol)?.value) : null;
    if (palletCount != null && palletCount > 6 && !carrierText.toLowerCase().includes("r&l")) {
      palletExceptions.push({
        row,
        delivery: delivery || "(blank)",
        carrier: carrierText || "(blank)",
        pallets: palletCount,
      });
      const dfIndex = row - headerRow - 1;
      if (dfIndex >= 0 && dfIndex < phiniaTable.records.length) exceptionIndexes.push(dfIndex);
    }
  }

  const styleSources = [...new Set([...additions.values()].flatMap((items) => items.map((item) => item.style)))];
  const stylesKey = zipKey(phinia.files, "xl/styles.xml");
  const stylesXml = stylesKey ? xmlText(phinia.files.get(stylesKey)) : "";
  const styled = stylesXml ? mapGeneralStyles(stylesXml, styleSources) : { xml: stylesXml, map: new Map(styleSources.map((source) => [source, source])) };

  let finalMaxCol = quoteCol;
  /** @type {string[]} */
  const rowXml = [];
  const ordered = [...sheet.rows.values()].sort((a, b) => a.number - b.number);
  for (const parsed of ordered) {
    const adds = additions.get(parsed.number) || [];
    const moved = parsed.cells.some((cell) => cell.col >= insertAt);
    if (!moved && !adds.length) {
      rowXml.push(parsed.raw);
      for (const cell of parsed.cells) finalMaxCol = Math.max(finalMaxCol, cell.col);
      continue;
    }
    /** @type {{ col: number, xml: string }[]} */
    const next = parsed.cells.map((cell) => {
      const col = cell.col >= insertAt ? cell.col + 2 : cell.col;
      finalMaxCol = Math.max(finalMaxCol, col);
      return { col, xml: cell.col >= insertAt ? withRef(cell.xml, col, cell.row) : cell.xml };
    });
    for (const add of adds) {
      finalMaxCol = Math.max(finalMaxCol, add.col);
      next.push({
        col: add.col,
        xml: inlineStringCell(parsed.number, add.col, add.text, styled.map.get(add.style) ?? add.style),
      });
    }
    next.sort((a, b) => a.col - b.col);
    const maxCol = next.reduce((max, cell) => Math.max(max, cell.col), 1);
    rowXml.push(`${updateSpans(parsed.open, maxCol)}${next.map((cell) => cell.xml).join("")}</row>`);
  }

  let sheetXml = replaceSheetData(phinia.active.xml, rowXml.join(""));
  sheetXml = replaceDimension(sheetXml, Math.max(sheet.maxRow, headerRow), finalMaxCol);
  /** @type {Map<string, Uint8Array>} */
  const changed = new Map();
  changed.set(phinia.active.key, encodeXml(sheetXml));
  if (stylesKey && styled.xml !== stylesXml) changed.set(stylesKey, encodeXml(styled.xml));

  return {
    bytes: repack(phinia.files, changed),
    matched,
    dataRows: Math.max(sheet.maxRow - headerRow, 0),
    noRnl: !seenRnl,
    palletExceptions,
    exceptionHeaders: phiniaTable.headers,
    exceptionRows: exceptionIndexes.map((index) => phiniaTable.records[index]),
  };
}

/**
 * @param {{ noRnl: boolean, palletExceptions: { row: number, delivery: string, carrier: string, pallets: number }[] }} payload
 */
export function buildExceptionMessage(payload) {
  /** @type {string[]} */
  const lines = [];
  if (payload.noRnl) lines.push('No R&L Carriers found in Carrier column.');
  if (payload.palletExceptions.length) {
    lines.push("");
    lines.push("Pallet count over 6 with non-R&L carrier:");
    for (const item of payload.palletExceptions) {
      lines.push(`Row ${item.row} | Delivery ${item.delivery} | Pallets ${item.pallets} | Carrier ${item.carrier}`);
    }
  }
  if (!lines.length) lines.push("No issues found.");
  lines.push("");
  lines.push("Select Okay to continue, or Get Report to save an exception report.");
  return lines.join("\n");
}

/** @returns {string} MMDDYYYYHHMM */
function reportStamp() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(now.getMonth() + 1)}${p(now.getDate())}${now.getFullYear()}${p(now.getHours())}${p(now.getMinutes())}`;
}

/** @param {number} row @param {number} col @param {unknown} value */
function plainCell(row, col, value) {
  const ref = `${colName(col)}${row}`;
  if (value == null || value === "") return `<c r="${ref}"/>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

/**
 * Pandas to_excel layout: headers on row 1, values keep int/float/text, blanks stay blank.
 * @param {string[]} headers
 * @param {unknown[][]} rows
 */
function exceptionWorkbook(headers, rows) {
  const width = Math.max(headers.length, 1);
  const lines = [
    `<row r="1">${headers.map((header, index) => plainCell(1, index + 1, header ?? "")).join("")}</row>`,
  ];
  rows.forEach((row, index) => {
    const excelRow = index + 2;
    const cells = [];
    for (let col = 0; col < width; col++) cells.push(plainCell(excelRow, col + 1, row?.[col] ?? null));
    lines.push(`<row r="${excelRow}">${cells.join("")}</row>`);
  });
  const ref = `A1:${colName(width)}${Math.max(rows.length + 1, 1)}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${ref}"/><sheetData>${lines.join("")}</sheetData></worksheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const bookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: encodeXml(contentTypes) },
    { name: "_rels/.rels", data: encodeXml(rels) },
    { name: "xl/workbook.xml", data: encodeXml(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encodeXml(bookRels) },
    { name: "xl/worksheets/sheet1.xml", data: encodeXml(sheet) },
  ]);
}

/** @param {Uint8Array} data @param {string} filename */
function downloadBytes(data, filename) {
  const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * @param {HTMLElement} extra
 * @param {{ phinia: File | null, tracking: File | null }} selected
 */
function mountFilePickers(extra, selected) {
  const step = extra.closest("[data-extra-step]");
  const stepTitle = step?.querySelector(".gb-ws-step-title");
  if (stepTitle) stepTitle.textContent = "Attach Files";
  step?.querySelector(".gb-ws-step-num")?.remove();
  extra.innerHTML = `
    <div class="phinia-ops-file">
      <span class="phinia-ops-file-label">Phinia Original:</span>
      <p class="phinia-ops-file-name" data-phinia-name>No file provided</p>
      <input type="file" hidden data-phinia-file accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
      <button type="button" class="btn btn-secondary" data-phinia-browse>Browse</button>
      <button type="button" class="btn btn-ghost" data-phinia-clear>Clear</button>
    </div>
    <div class="phinia-ops-file">
      <span class="phinia-ops-file-label">Tracking Report:</span>
      <p class="phinia-ops-file-name" data-tracking-name>No file provided</p>
      <input type="file" hidden data-tracking-file accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
      <button type="button" class="btn btn-secondary" data-tracking-browse>Browse</button>
      <button type="button" class="btn btn-ghost" data-tracking-clear>Clear</button>
    </div>
  `;

  const phiniaName = /** @type {HTMLElement} */ (extra.querySelector("[data-phinia-name]"));
  const trackingName = /** @type {HTMLElement} */ (extra.querySelector("[data-tracking-name]"));
  const phiniaInput = /** @type {HTMLInputElement} */ (extra.querySelector("[data-phinia-file]"));
  const trackingInput = /** @type {HTMLInputElement} */ (extra.querySelector("[data-tracking-file]"));

  const syncRunButton = () => {
    const main = extra.closest(".gb-tool")?.querySelector("[data-file-input]");
    if (!(main instanceof HTMLInputElement)) return;
    const bag = new DataTransfer();
    if (selected.phinia && selected.tracking) {
      bag.items.add(selected.phinia);
      bag.items.add(selected.tracking);
    }
    main.files = bag.files;
    main.dispatchEvent(new Event("change", { bubbles: true }));
  };

  extra.querySelector("[data-phinia-browse]")?.addEventListener("click", () => phiniaInput.click());
  extra.querySelector("[data-tracking-browse]")?.addEventListener("click", () => trackingInput.click());
  phiniaInput.addEventListener("change", () => {
    selected.phinia = phiniaInput.files?.[0] || null;
    phiniaName.textContent = selected.phinia?.name || "No file provided";
    syncRunButton();
  });
  trackingInput.addEventListener("change", () => {
    selected.tracking = trackingInput.files?.[0] || null;
    trackingName.textContent = selected.tracking?.name || "No file provided";
    syncRunButton();
  });
  extra.querySelector("[data-phinia-clear]")?.addEventListener("click", () => {
    selected.phinia = null;
    phiniaInput.value = "";
    phiniaName.textContent = "No file provided";
    syncRunButton();
  });
  extra.querySelector("[data-tracking-clear]")?.addEventListener("click", () => {
    selected.tracking = null;
    trackingInput.value = "";
    trackingName.textContent = "No file provided";
    syncRunButton();
  });
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  /** @type {{ phinia: File | null, tracking: File | null }} */
  const selected = { phinia: null, tracking: null };

  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Merge the Phinia Original shipment list with Tracking Report data. The tracking report flies the correct carrier into each line item.

Workflow:
1. Download the original shipment list from your email. This is what Phinia sends us.
2. In TMS, run a Dispatch Tracking Report for client Phinia, using the same date range as the original shipment list.
3. Download that Tracking Report from TMS or your email.
4. Attach the original shipment list and the tracking report here.
5. Click Run Report. The file downloads as Phinia_Operational_Report_*.xlsx.
6. Reply to the original shipment-list email and attach the operational report.

If no carrier contains R&L, or a row has more than 6 pallets and the carrier is not R&L, you can save OpsExceptions.xlsx.`,
    onBack: ctx.onBack,
    log: ctx.log,
    accept: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    runLabel: "Run Report",
    buildExtra: (extra) => mountFilePickers(extra, selected),
    async onRun(_files, ui) {
      if (!selected.phinia || !selected.tracking) throw new Error("Both files are required");
      const merged = await mergePhiniaOperationalReport(
        await readFileBuffer(selected.phinia),
        await readFileBuffer(selected.tracking)
      );
      const outName = `Phinia_Operational_Report_${reportStamp()}.xlsx`;
      downloadBytes(merged.bytes, outName);
      ctx.log(`Matched ${merged.matched.toLocaleString()} out of ${merged.dataRows.toLocaleString()} rows with Tracking Report data.`);

      const hasIssues = merged.noRnl || merged.palletExceptions.length > 0;
      if (hasIssues) {
        const getReport = await confirmDialog(buildExceptionMessage(merged), {
          title: "Operational Report Alert",
          okLabel: "Get Report",
          cancelLabel: "Okay",
        });
        if (getReport) {
          downloadBytes(exceptionWorkbook(merged.exceptionHeaders, merged.exceptionRows), "OpsExceptions.xlsx");
          ctx.log("Exception report saved: OpsExceptions.xlsx");
        }
      }
      ui.setStatus(`Report saved: ${outName}`);
    },
  });
}
