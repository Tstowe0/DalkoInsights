/**
 * Zip helpers for splicing one worksheet into the Marmon template
 * without rewriting the styled sheets.
 */

const SIG_LOC = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} data
 */
export function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Uint8Array} bytes
 */
function findEocd(bytes) {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  throw new Error("The workbook is not a valid Excel file.");
}

/**
 * @typedef {object} ZipEntry
 * @property {string} name
 * @property {number} method
 * @property {number} flag
 * @property {number} time
 * @property {number} date
 * @property {number} crc
 * @property {number} compressedSize
 * @property {number} uncompressedSize
 * @property {number} externalAttr
 * @property {Uint8Array} compressed
 */

/**
 * @param {Uint8Array} bytes
 * @returns {ZipEntry[]}
 */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  if (pos === 0xffffffff) throw new Error("This Excel file is too large to update.");

  /** @type {ZipEntry[]} */
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== SIG_CD) throw new Error("The workbook archive is damaged.");
    const flag = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const time = view.getUint16(pos + 12, true);
    const date = view.getUint16(pos + 14, true);
    const crc = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const externalAttr = view.getUint32(pos + 38, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;

    if (view.getUint32(localOffset, true) !== SIG_LOC) {
      throw new Error("The workbook archive is damaged.");
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.push({
      name,
      method,
      flag: flag & ~0x8,
      time,
      date,
      crc,
      compressedSize,
      uncompressedSize,
      externalAttr,
      compressed,
    });
  }
  return entries;
}

/**
 * @param {Uint8Array} compressed
 * @param {number} method
 * @returns {Promise<Uint8Array>}
 */
async function inflate(compressed, method) {
  if (method === 0) return compressed;
  if (method !== 8) throw new Error("This Excel file uses an unsupported compression method.");
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {Uint8Array} data
 */
async function deflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  if (compressed.length >= data.length) {
    return { method: 0, compressed: data };
  }
  return { method: 8, compressed };
}

/**
 * @param {number} n
 * @param {number} len
 */
function uInt(n, len) {
  const out = new Uint8Array(len);
  const view = new DataView(out.buffer);
  if (len === 2) view.setUint16(0, n, true);
  else view.setUint32(0, n, true);
  return out;
}

/**
 * @param {Uint8Array[]} parts
 */
function concat(parts) {
  const len = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * @param {ZipEntry[]} entries
 */
function writeZip(entries) {
  /** @type {Uint8Array[]} */
  const parts = [];
  /** @type {number[]} */
  const offsets = [];
  let offset = 0;
  for (const entry of entries) {
    offsets.push(offset);
    const name = new TextEncoder().encode(entry.name);
    const local = concat([
      uInt(SIG_LOC, 4),
      uInt(entry.method === 0 ? 10 : 20, 2),
      uInt(entry.flag, 2),
      uInt(entry.method, 2),
      uInt(entry.time, 2),
      uInt(entry.date, 2),
      uInt(entry.crc, 4),
      uInt(entry.compressed.length, 4),
      uInt(entry.uncompressedSize, 4),
      uInt(name.length, 2),
      uInt(0, 2),
      name,
      entry.compressed,
    ]);
    parts.push(local);
    offset += local.length;
  }
  const cdStart = offset;
  entries.forEach((entry, index) => {
    const name = new TextEncoder().encode(entry.name);
    const cd = concat([
      uInt(SIG_CD, 4),
      uInt(20, 2),
      uInt(entry.method === 0 ? 10 : 20, 2),
      uInt(entry.flag, 2),
      uInt(entry.method, 2),
      uInt(entry.time, 2),
      uInt(entry.date, 2),
      uInt(entry.crc, 4),
      uInt(entry.compressed.length, 4),
      uInt(entry.uncompressedSize, 4),
      uInt(name.length, 2),
      uInt(0, 2),
      uInt(0, 2),
      uInt(0, 2),
      uInt(0, 2),
      uInt(entry.externalAttr, 4),
      uInt(offsets[index], 4),
      name,
    ]);
    parts.push(cd);
    offset += cd.length;
  });
  const cdSize = offset - cdStart;
  parts.push(
    concat([
      uInt(SIG_EOCD, 4),
      uInt(0, 2),
      uInt(0, 2),
      uInt(entries.length, 2),
      uInt(entries.length, 2),
      uInt(cdSize, 4),
      uInt(cdStart, 4),
      uInt(0, 2),
    ])
  );
  return concat(parts);
}

/**
 * @param {Uint8Array} bytes
 * @param {string} name
 */
export async function readZipText(bytes, name) {
  const entry = readZip(bytes).find((item) => item.name === name);
  if (!entry) throw new Error(`Missing ${name} in the workbook.`);
  const raw = await inflate(entry.compressed, entry.method);
  return new TextDecoder().decode(raw);
}

/** Ferroworks Daily Shipment Report columns, mapped from a TMS data dump. */
const FERRO_COLUMNS = [
  ["Client", ["CLIENT NAME"]],
  ["Load No.", ["LOAD NO"]],
  ["Carrier Pro Number", ["CARRIER PRO1"]],
  ["Carrier", ["CARRIER NAME1"]],
  ["Ship Date", ["ACTUAL SHIP DATE"]],
  ["Exp Delivery Date", ["EXPECTED DELIVERY", "EXPECTED DELIVERY DATE"]],
  ["Eqpt", ["EQUIPMENT"]],
  ["Status", ["STATUS"]],
  ["Origin Name", ["ORIGIN NAME"]],
  ["Origin Address 1", ["ORIGIN ADDRESS 1"]],
  ["Origin Address 2", ["ORGIN ADDRESS 2", "ORIGIN ADDRESS 2"]],
  ["Origin Country", ["ORIGIN COUNTRY"]],
  ["Origin City", ["ORIGIN CITY"]],
  ["Origin State", ["ORIGIN STATE"]],
  ["Origin Postal", ["ORIGIN POSTAL"]],
  ["Origin Contact", ["ORIGIN CONTACT"]],
  ["Origin Phone", ["ORIGIN PHONE #", "ORIGIN PHONE"]],
  ["Origin Email", ["ORIGIN EMAIL"]],
  ["Origin Fax", ["ORIGIN FAX"]],
  ["Origin Notes", ["ORIGIN NOTES"]],
  ["Destination Name", ["DESTINATION NAME"]],
  ["Destination Address 1", ["DESTINATION ADDRESS 1"]],
  ["Destination Address 2", ["DESTINATION ADDRESS 2"]],
  ["Destination Country", ["DESTINATION COUNTRY"]],
  ["Destination City", ["DESTINATION CITY"]],
  ["Destination State", ["DESTINATION STATE"]],
  ["Destination Postal", ["DESTINATION POSTAL"]],
  ["Destination Contact", ["DESTINATION CONTACT"]],
  ["Destination Phone", ["DESTINATION PHONE #", "DESTINATION PHONE"]],
  ["Destination Email", ["DESTINATION EMAIL"]],
  ["Destination Fax", ["DESTINATION FAX"]],
  ["Destination Notes", ["DESTINATION NOTES"]],
  ["Client Ref No", ["Addt'l Ref No.", "CLIENT REF NO"]],
  ["Pickup No", ["PICKUP NUMBER1"]],
  ["Carrier Quote No", ["CARRIER QUOTE NO"]],
  ["PO No.", ["PO No.", "PO NO."]],
  ...[1, 2, 3, 4, 5].flatMap((n) => [
    [`Product${n}`, [`PRODUCT${n}`]],
    [`PO No.${n}`, [`PO NO.${n}`]],
    [`Hdlg Units${n}`, [`Hdlg Units${n}`]],
    [`Type${n}`, [`Type${n}`]],
    [`Wgt${n}`, [`Weight${n}`, `Wgt${n}`]],
    [`Class${n}`, [`Class${n}`]],
  ]),
  ["Total Hdlg Units", ["TOTAL HDLG UNITS"]],
  ["Total Pcs", ["TOTAL PIECES"]],
  ["Total Wt.", ["Total Wt.", "TOTAL WT.", "TOTAL WEIGHT"]],
  ["Total Freight", []],
  ["Total Fuel", []],
  ["Dat Freight", []],
  ["Dat Fuel", []],
];

const FERRO_COL = Object.fromEntries(FERRO_COLUMNS.map(([name], index) => [name, index]));

/** Column titles on the Ferroworks Full Data Dump sheet, in order. */
export function ferroHeaders() {
  return FERRO_COLUMNS.map(([name]) => name);
}
const DAT_BATCH = 50;
const DAT_RATE_TYPE = "SHIPPER_TO_BROKER_SPOT";

const FERRO_HEADER = "__FERRO_H__";
const FERRO_WHITE = "__FERRO_W__";
const FERRO_GREY = "__FERRO_G__";
const FERRO_COL_WIDTH = "20.83203125";

const FERRO_HEADER_FONT =
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>';
const FERRO_BODY_FONT =
  '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>';
const FERRO_HEADER_FILL =
  '<fill><patternFill patternType="solid"><fgColor rgb="FF185074"/><bgColor indexed="64"/></patternFill></fill>';
const FERRO_WHITE_FILL =
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>';
const FERRO_GREY_FILL =
  '<fill><patternFill patternType="solid"><fgColor rgb="FFDDDDDD"/><bgColor indexed="64"/></patternFill></fill>';

/**
 * @param {number} index 0-based
 */
function columnName(index) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * @param {unknown} value
 */
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
 * Sum the sell amounts on one dump row. Blank parts are skipped.
 * An all-blank row stays blank.
 * @param {object} sheet
 * @param {{ utils: { encode_cell: Function } }} XLSX
 * @param {number} row
 * @param {number[]} cols
 */
function sumSpend(sheet, XLSX, row, cols) {
  let total = 0;
  let any = false;
  for (const col of cols) {
    if (col < 0) continue;
    const number = spendNumber(sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v);
    if (number == null) continue;
    any = true;
    total += number;
  }
  if (!any) return "";
  return Math.round(total * 100) / 100;
}

function formatDumpValue(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${month}/${day}/${value.getFullYear()}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Math.abs(value - Math.round(value)) < 1e-9) return Math.round(value);
    return value;
  }
  return value;
}

/**
 * @param {unknown} value
 */
function xmlEscape(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {string} ref
 * @param {unknown} value
 * @param {string} style
 */
function cellXml(ref, value, style) {
  if (value == null || value === "") return `<c r="${ref}" s="${style}"/>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  const text = String(value);
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${space}>${xmlEscape(text)}</t></is></c>`;
}

/**
 * DAT linehaul equipment. A name containing van is VAN. A name containing
 * flatbed is FLATBED. Reefer stays REEFER. Anything else is not sent.
 * @param {unknown} raw
 * @returns {"VAN" | "FLATBED" | "REEFER" | ""}
 */
export function datEquipment(raw) {
  const text = String(raw ?? "").toUpperCase();
  if (text.includes("VAN")) return "VAN";
  if (text.includes("FLATBED")) return "FLATBED";
  if (/REEFER|REFRIG/.test(text)) return "REEFER";
  return "";
}

/**
 * @param {unknown} value
 */
function postalCode(value) {
  let text = String(value ?? "").trim().replace(/\.0$/, "");
  if (!text) return "";
  if (/[A-Za-z]/.test(text)) return text.replace(/\s+/g, " ").toUpperCase();
  const digits = text.replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : digits;
}

/**
 * @param {unknown[][]} rows
 * @param {number} index
 * @param {string} cityName
 * @param {string} stateName
 * @param {string} postalName
 */
function ratePlace(row, cityName, stateName, postalName) {
  /** @type {Record<string, string>} */
  const place = {};
  const city = String(row[FERRO_COL[cityName]] ?? "").trim();
  const state = String(row[FERRO_COL[stateName]] ?? "").trim();
  const postal = postalCode(row[FERRO_COL[postalName]]);
  if (city) place.city = city;
  if (state) place.stateOrProvince = state;
  if (postal) place.postalCode = postal;
  return place;
}

/**
 * @param {Record<string, string>} place
 */
function placeUsable(place) {
  return Boolean(place.postalCode || (place.city && place.stateOrProvince));
}

/** DAT prices a historic month only for the prior 13 completed months. */
const DAT_HISTORIC_MONTHS = 13;

/**
 * Month and year from a dump ship date. DAT historic rates are a month, not a day.
 * @param {unknown} value
 * @returns {{ month: number, year: number } | null}
 */
function shipMonth(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { month: value.getMonth() + 1, year: value.getFullYear() };
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  let match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) {
    const month = Number(match[1]);
    const year = Number(match[3]);
    if (month >= 1 && month <= 12) return { month, year };
    return null;
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const month = Number(match[2]);
    const year = Number(match[1]);
    if (month >= 1 && month <= 12) return { month, year };
  }
  return null;
}

/**
 * Historic period for a ship date inside DAT's 13-month window.
 * The current month, a future month, a missing date, and anything older stay unset
 * so the lookup uses today's spot rate.
 * @param {unknown} value
 * @param {Date} [now]
 * @returns {{ rateTense: "HISTORIC", month: number, year: number } | null}
 */
function historicRatePeriod(value, now = new Date()) {
  const ship = shipMonth(value);
  if (!ship) return null;
  const age = now.getFullYear() * 12 + now.getMonth() - (ship.year * 12 + (ship.month - 1));
  if (age < 1 || age > DAT_HISTORIC_MONTHS) return null;
  return { rateTense: "HISTORIC", month: ship.month, year: ship.year };
}

/**
 * @param {unknown[]} row
 * @returns {{ key: string, request: object } | null}
 */
export function datLane(row) {
  const equipment = datEquipment(row[FERRO_COL.Eqpt]);
  if (!equipment) return null;
  const origin = ratePlace(row, "Origin City", "Origin State", "Origin Postal");
  const destination = ratePlace(row, "Destination City", "Destination State", "Destination Postal");
  if (!placeUsable(origin) || !placeUsable(destination)) return null;
  const request = {
    equipment,
    rateType: DAT_RATE_TYPE,
    origin,
    destination,
  };
  const period = historicRatePeriod(row[FERRO_COL["Ship Date"]]);
  if (period) request.rateTimePeriod = period;
  return { key: JSON.stringify(request), request };
}

/**
 * @param {unknown} value
 */
function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Math.round(number * 100) / 100;
}

/**
 * Trip linehaul and trip fuel from one DAT rateResponses item.
 * @param {object | undefined} item
 */
export function datMoney(item) {
  const rate = item?.response?.rate;
  return {
    freight: money(rate?.perTrip?.rateUsd),
    fuel: money(rate?.averageFuelSurchargePerTripUsd),
  };
}

/**
 * @param {Error} err
 */
function datFatal(err) {
  return /token|unavailable|failed to fetch|network|required key|timed out|sign in|delta rack/i.test(
    err.message || ""
  );
}

/**
 * @param {object[]} requests
 */
async function postDatLookup(requests) {
  let res;
  try {
    const { RACK_ORIGIN, rackAuthHeaders } = await import("../../../../shared/js/ftp-rack.js?v=20261023-rack");
    res = await fetch(`${RACK_ORIGIN}/api/dat/test`, {
      method: "POST",
      cache: "no-store",
      headers: await rackAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(requests),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/sign in/i.test(message)) throw err instanceof Error ? err : new Error(message);
    throw new Error("DAT rate lookup is unavailable. The Delta rack could not be reached.");
  }
  /** @type {{ ok?: boolean, error?: string, result?: { rateResponses?: object[], errors?: { message?: string }[] } }} */
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || data.ok === false) {
    const message =
      data.error ||
      data.result?.errors?.[0]?.message ||
      "DAT rate lookup failed.";
    throw new Error(message);
  }
  return data.result?.rateResponses || [];
}

/**
 * @param {object[]} requests
 * @returns {Promise<(object | null)[]>}
 */
async function lookupDatBatch(requests) {
  try {
    const items = await postDatLookup(requests);
    return requests.map((_, index) => items[index] || null);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (datFatal(error)) throw error;
    if (requests.length === 1) return [null];
    const mid = Math.ceil(requests.length / 2);
    const left = await lookupDatBatch(requests.slice(0, mid));
    const right = await lookupDatBatch(requests.slice(mid));
    return [...left, ...right];
  }
}

/**
 * Fill Dat Freight and Dat Fuel. Identical lanes share one lookup.
 * @param {unknown[][]} rows
 * @param {((update: { step?: string, title?: string, detail?: string, done?: number, total?: number }) => void | Promise<void>) | undefined} onProgress
 */
export async function fillDatRates(rows, onProgress) {
  /** @type {Map<string, { request: object, indexes: number[] }>} */
  const groups = new Map();
  rows.forEach((row, index) => {
    const lane = datLane(row);
    if (!lane) return;
    const group = groups.get(lane.key);
    if (group) group.indexes.push(index);
    else groups.set(lane.key, { request: lane.request, indexes: [index] });
  });
  const unique = [...groups.values()];
  if (!unique.length) {
    await onProgress?.({
      step: "rates",
      title: "Building Marmon report",
      detail: "None of the shipments have both an origin and a destination, so DAT rates were skipped.",
      done: 1,
      total: 1,
    });
    return;
  }
  const freightCol = FERRO_COL["Dat Freight"];
  const fuelCol = FERRO_COL["Dat Fuel"];
  for (let start = 0; start < unique.length; start += DAT_BATCH) {
    const batch = unique.slice(start, start + DAT_BATCH);
    await onProgress?.({
      step: "rates",
      title: "Building Marmon report",
      detail:
        "Asking DAT for the spot linehaul and fuel surcharge in each shipment's ship month. The same lane in the same month is only looked up once.",
      done: start,
      total: unique.length,
    });
    const items = await lookupDatBatch(batch.map((item) => item.request));
    const done = Math.min(start + batch.length, unique.length);
    await onProgress?.({
      step: "rates",
      title: "Building Marmon report",
      detail:
        "Asking DAT for the spot linehaul and fuel surcharge in each shipment's ship month. The same lane in the same month is only looked up once.",
      done,
      total: unique.length,
    });
    batch.forEach((group, index) => {
      const priced = datMoney(items[index] || undefined);
      for (const rowIndex of group.indexes) {
        rows[rowIndex][freightCol] = priced.freight;
        rows[rowIndex][fuelCol] = priced.fuel;
      }
    });
  }
}

/**
 * Project a TMS dump sheet onto the Ferroworks column list.
 * Dat Freight and Dat Fuel are blank until fillDatRates runs.
 * @param {object} sheet SheetJS worksheet
 * @param {{ utils: { decode_range: Function, encode_cell: Function } }} XLSX
 * @returns {unknown[][]}
 */
export function readFerroRows(sheet, XLSX) {
  const ref = sheet?.["!ref"];
  if (!ref) throw new Error("The data dump has no worksheet.");
  const range = XLSX.utils.decode_range(ref);
  /** @type {string[]} */
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(String(cell?.v ?? "").trim());
  }
  /** @type {Map<string, number>} */
  const exact = new Map();
  /** @type {Map<string, number>} */
  const upper = new Map();
  headers.forEach((name, index) => {
    if (!name) return;
    if (!exact.has(name)) exact.set(name, range.s.c + index);
    const key = name.toUpperCase();
    if (!upper.has(key)) upper.set(key, range.s.c + index);
  });
  const locate = (aliases) => {
    for (const alias of aliases) {
      if (exact.has(alias)) return exact.get(alias);
    }
    for (const alias of aliases) {
      const hit = upper.get(alias.toUpperCase());
      if (hit != null) return hit;
    }
    return -1;
  };
  const sources = FERRO_COLUMNS.map(([, aliases]) => locate(aliases));
  const freightCols = ["SELL FREIGHT1", "SELL FREIGHT2"].map((name) => locate([name]));
  const fuelCols = ["SELL FUEL1", "SELL FUEL2"].map((name) => locate([name]));
  const totalFreight = FERRO_COL["Total Freight"];
  const totalFuel = FERRO_COL["Total Fuel"];

  /** @type {unknown[][]} */
  const data = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row = sources.map((col) => {
      if (col < 0) return "";
      const cell = sheet[XLSX.utils.encode_cell({ r, c: col })];
      return formatDumpValue(cell?.v);
    });
    row[totalFreight] = sumSpend(sheet, XLSX, r, freightCols);
    row[totalFuel] = sumSpend(sheet, XLSX, r, fuelCols);
    if (row.some((value) => value !== "" && value != null)) {
      row.sheetRow = r;
      data.push(row);
    }
  }
  return data;
}

/** Report title, plus the TMS client name used on the data dump. */
const SITE_SECTIONS = [
  {
    title: "UTLX - UNION TANK CAR COMPANY",
    clients: new Set(["UTLX - UNION TANK CAR COMPANY", "UNION TANK CAR MAIN REPAIR SHOPS"]),
  },
  {
    title: "UTLXA - UTLX ALEXANDRIA",
    clients: new Set(["UTLXA - UTLX ALEXANDRIA", "UTLXA-UNION TANK CAR"]),
  },
  {
    title: "MCKENZIE VALVE & MACHINING",
    clients: new Set(["MCKENZIE VALVE & MACHINING", "MCKENZIE VALVE AND MACHINING"]),
  },
  {
    title: "PROX - PROCOR LIMITED",
    clients: new Set(["PROX - PROCOR LIMITED", "PROCOR LIMITED"]),
  },
  {
    title: "TRANSCO RAIL SERVICES US & CANADA",
    clients: new Set(["TRANSCO RAIL SERVICES US & CANADA"]),
  },
];

/**
 * @param {string} client
 */
function sectionForClient(client) {
  const key = client.toUpperCase();
  return SITE_SECTIONS.find((section) => section.clients.has(key)) || null;
}

/**
 * UTLX shipments used by the carrier-index site table.
 * @param {object} sheet SheetJS worksheet
 * @param {{ utils: { decode_range: Function, encode_cell: Function } }} XLSX
 */
export function readUtlxLoads(sheet, XLSX) {
  const ref = sheet?.["!ref"];
  if (!ref) throw new Error("The data dump has no worksheet.");
  const range = XLSX.utils.decode_range(ref);
  /** @type {string[]} */
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(String(cell?.v ?? "").trim().toUpperCase());
  }
  const find = (name) => headers.indexOf(name);
  const clientCol = find("CLIENT NAME");
  const originCol = find("ORIGIN CITY");
  const destCol = find("DESTINATION CITY");
  const milesCol = find("TOTAL MILES");
  const equipCol = find("EQUIPMENT");
  const shipCol = find("ACTUAL SHIP DATE");
  const originStateCol = find("ORIGIN STATE");
  const originPostalCol = find("ORIGIN POSTAL");
  const destStateCol = find("DESTINATION STATE");
  const destPostalCol = find("DESTINATION POSTAL");
  const freightCols = ["SELL FREIGHT1", "SELL FREIGHT2"].map(find);
  const fuelCols = ["SELL FUEL1", "SELL FUEL2"].map(find);
  if (clientCol < 0 || originCol < 0 || destCol < 0 || milesCol < 0) {
    throw new Error("The data dump is missing client, city, or Total Miles columns.");
  }
  const textAt = (row, col) =>
    col < 0 ? "" : String(sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v ?? "").trim();
  /** @type {UtlxLoad[]} */
  const loads = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const client = textAt(r, clientCol);
    const section = sectionForClient(client);
    if (!section) continue;
    const freight = sumSpend(sheet, XLSX, r, freightCols);
    const fuel = sumSpend(sheet, XLSX, r, fuelCols);
    loads.push({
      section: section.title,
      sheetRow: r,
      origin: textAt(r, originCol),
      dest: textAt(r, destCol),
      originState: textAt(r, originStateCol),
      originPostal: textAt(r, originPostalCol),
      destState: textAt(r, destStateCol),
      destPostal: textAt(r, destPostalCol),
      miles: spendNumber(sheet[XLSX.utils.encode_cell({ r, c: milesCol })]?.v),
      equipment: textAt(r, equipCol),
      shipDate: formatDumpValue(shipCol < 0 ? "" : sheet[XLSX.utils.encode_cell({ r, c: shipCol })]?.v),
      freight: freight === "" ? null : freight,
      fuel: fuel === "" ? null : fuel,
      datFreight: null,
      datFuel: null,
    });
  }
  return loads;
}

/**
 * Replace 0 or negative mileage with the Zip Calculator truck miles.
 * The same postal pair is looked up once. A failed lookup keeps the original miles.
 * @param {UtlxLoad[]} loads
 * @param {((update: { step?: string, title?: string, detail?: string, done?: number, total?: number }) => void | Promise<void>) | undefined} onProgress
 */
export async function fillMissingMiles(loads, onProgress) {
  /** @type {Map<string, { z1: string, z2: string, loads: UtlxLoad[] }>} */
  const groups = new Map();
  for (const load of loads) {
    if (load.miles == null || load.miles > 0) continue;
    const z1 = String(load.originPostal || "").trim();
    const z2 = String(load.destPostal || "").trim();
    if (!z1 || !z2) continue;
    const key = [z1, z2]
      .map((code) => code.toUpperCase().replace(/\s+/g, ""))
      .sort()
      .join("|");
    const group = groups.get(key);
    if (group) group.loads.push(load);
    else groups.set(key, { z1, z2, loads: [load] });
  }
  const unique = [...groups.values()];
  if (!unique.length) return 0;
  let filled = 0;
  for (let index = 0; index < unique.length; index++) {
    const group = unique[index];
    await onProgress?.({
      step: "miles",
      title: "Building Marmon report",
      detail: "Looking up mileage for shipments with 0 or negative miles.",
      done: index,
      total: unique.length,
    });
    let miles = null;
    try {
      const { calculateZipPair } = await import("../Data Tools/Zip Calculator.js?v=20261007-miles");
      const hit = await calculateZipPair(group.z1, group.z2);
      miles = hit.miles;
    } catch {
      miles = null;
    }
    if (miles == null) continue;
    for (const load of group.loads) {
      load.miles = miles;
      filled += 1;
    }
  }
  await onProgress?.({
    step: "miles",
    title: "Building Marmon report",
    detail: "Looking up mileage for shipments with 0 or negative miles.",
    done: unique.length,
    total: unique.length,
  });
  return filled;
}

/**
 * @typedef {{
 *   section: string,
 *   sheetRow: number,
 *   origin: string,
 *   dest: string,
 *   originState: string,
 *   originPostal: string,
 *   destState: string,
 *   destPostal: string,
 *   miles: number | null,
 *   equipment: string,
 *   shipDate: string,
 *   freight: number | null,
 *   fuel: number | null,
 *   datFreight: number | null,
 *   datFuel: number | null
 * }} UtlxLoad
 */

/**
 * Lane rows for a DAT lookup when Full Data Dump is not being built.
 * @param {UtlxLoad[]} loads
 */
export function utlxRateRows(loads) {
  return loads.map((load) => {
    const row = [];
    row[FERRO_COL["Origin City"]] = load.origin;
    row[FERRO_COL["Origin State"]] = load.originState;
    row[FERRO_COL["Origin Postal"]] = load.originPostal;
    row[FERRO_COL["Destination City"]] = load.dest;
    row[FERRO_COL["Destination State"]] = load.destState;
    row[FERRO_COL["Destination Postal"]] = load.destPostal;
    row[FERRO_COL.Eqpt] = load.equipment;
    row[FERRO_COL["Ship Date"]] = load.shipDate;
    row.sheetRow = load.sheetRow;
    return row;
  });
}

/**
 * Copy Dat Freight and Dat Fuel from priced dump rows onto the matching shipments.
 * @param {UtlxLoad[]} loads
 * @param {unknown[][]} rows
 */
export function applyUtlxDatFreight(loads, rows) {
  /** @type {Map<number, { freight?: number, fuel?: number }>} */
  const byRow = new Map();
  for (const row of rows) {
    if (row.sheetRow == null) continue;
    const freight = row[FERRO_COL["Dat Freight"]];
    const fuel = row[FERRO_COL["Dat Fuel"]];
    /** @type {{ freight?: number, fuel?: number }} */
    const priced = {};
    if (freight !== "" && freight != null) priced.freight = /** @type {number} */ (freight);
    if (fuel !== "" && fuel != null) priced.fuel = /** @type {number} */ (fuel);
    if (priced.freight == null && priced.fuel == null) continue;
    byRow.set(row.sheetRow, priced);
  }
  for (const load of loads) {
    const priced = byRow.get(load.sheetRow);
    if (!priced) continue;
    if (priced.freight != null) load.datFreight = priced.freight;
    if (priced.fuel != null) load.datFuel = priced.fuel;
  }
}

/**
 * @param {unknown[][]} data
 * @returns {{ xml: string, rowCount: number }}
 */
export function ferroRowsToXml(data) {
  const lastCol = columnName(FERRO_COLUMNS.length - 1);
  const lastRow = data.length + 1;
  const rows = [];
  const headerCells = FERRO_COLUMNS.map(([name], index) =>
    cellXml(`${columnName(index)}1`, name, FERRO_HEADER)
  );
  rows.push(`<row r="1">${headerCells.join("")}</row>`);
  data.forEach((row, index) => {
    const excelRow = index + 2;
    const style = excelRow % 2 === 0 ? FERRO_WHITE : FERRO_GREY;
    const cells = row.map((value, col) => cellXml(`${columnName(col)}${excelRow}`, value, style));
    rows.push(`<row r="${excelRow}">${cells.join("")}</row>`);
  });

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><tabColor theme="1"/></sheetPr><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="${FERRO_COLUMNS.length}" width="${FERRO_COL_WIDTH}" customWidth="1"/></cols><sheetData>${rows.join("")}</sheetData></worksheet>`;
  return { xml, rowCount: data.length };
}

/**
 * @param {string} xml
 * @param {string} tag
 * @param {string} item
 */
function appendStyleItem(xml, tag, item) {
  const start = xml.indexOf(`<${tag}`);
  const end = xml.indexOf(`</${tag}>`);
  if (start === -1 || end === -1) throw new Error(`The Marmon template is missing ${tag}.`);
  const block = xml.slice(start, end);
  const count = Number(block.match(/\bcount="(\d+)"/)?.[1]);
  if (!Number.isFinite(count)) throw new Error(`The Marmon template is missing a ${tag} count.`);
  const at = block.indexOf(item);
  if (at !== -1) {
    const child = tag === "cellXfs" ? "xf" : tag.slice(0, -1);
    const index = [...block.slice(0, at).matchAll(new RegExp(`<${child}\\b`, "g"))].length;
    return { xml, index };
  }
  const next = xml.replace(new RegExp(`(<${tag}\\b[^>]*?\\bcount=")${count}(")`), `$1${count + 1}$2`);
  return {
    xml: next.replace(`</${tag}>`, `${item}</${tag}>`.replaceAll("$", "$$$$")),
    index: count,
  };
}

/**
 * Add the Ferroworks header, white, and grey styles without moving existing style indexes.
 * @param {string} stylesXml
 * @param {string} sheetXml
 */
export function applyFerroDumpStyles(stylesXml, sheetXml) {
  const headerFont = appendStyleItem(stylesXml, "fonts", FERRO_HEADER_FONT);
  const bodyFont = appendStyleItem(headerFont.xml, "fonts", FERRO_BODY_FONT);
  const headerFill = appendStyleItem(bodyFont.xml, "fills", FERRO_HEADER_FILL);
  const whiteFill = appendStyleItem(headerFill.xml, "fills", FERRO_WHITE_FILL);
  const greyFill = appendStyleItem(whiteFill.xml, "fills", FERRO_GREY_FILL);

  const xf = (fontId, fillId) =>
    `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`;
  const headerXf = appendStyleItem(greyFill.xml, "cellXfs", xf(headerFont.index, headerFill.index));
  const whiteXf = appendStyleItem(headerXf.xml, "cellXfs", xf(bodyFont.index, whiteFill.index));
  const greyXf = appendStyleItem(whiteXf.xml, "cellXfs", xf(bodyFont.index, greyFill.index));
  const painted = sheetXml
    .replaceAll(`s="${FERRO_HEADER}"`, `s="${headerXf.index}"`)
    .replaceAll(`s="${FERRO_WHITE}"`, `s="${whiteXf.index}"`)
    .replaceAll(`s="${FERRO_GREY}"`, `s="${greyXf.index}"`);
  return { stylesXml: greyXf.xml, sheetXml: painted };
}

/**
 * @param {ZipEntry[]} entries
 * @param {string} name
 * @param {Uint8Array} data
 */
async function putZipText(entries, name, data) {
  const index = entries.findIndex((entry) => entry.name === name);
  if (index === -1) throw new Error(`The Marmon template is missing ${name}.`);
  const packed = await deflate(data);
  const prev = entries[index];
  entries[index] = {
    ...prev,
    method: packed.method,
    flag: 0,
    crc: crc32(data),
    compressedSize: packed.compressed.length,
    uncompressedSize: data.length,
    compressed: packed.compressed,
  };
}

/** Output tabs, in workbook order. */
export const MARMON_TABS = [
  "Master Carrier Market Index",
  "Master Fuel Price Volatility",
  "TL Only Carrier Market Index",
  "TL Only Fuel Price Volatility",
  "LTL Only Carrier Market Index",
  "LTL Only Fuel Price Volatility",
  "Full Data Dump",
];

/** Carrier index sheets share one printer-settings part. */
const PRINTER_PART = "xl/printerSettings/printerSettings1.bin";
const PRINTER_TABS = [
  "Master Carrier Market Index",
  "TL Only Carrier Market Index",
  "LTL Only Carrier Market Index",
];

/** @type {Record<string, { part: string, relId: string, extras: string[] }>} */
const TAB_PARTS = {
  "Master Carrier Market Index": {
    part: "xl/worksheets/sheet1.xml",
    relId: "rId1",
    extras: ["xl/worksheets/_rels/sheet1.xml.rels"],
  },
  "Master Fuel Price Volatility": {
    part: "xl/worksheets/sheet2.xml",
    relId: "rId2",
    extras: [],
  },
  "TL Only Carrier Market Index": {
    part: "xl/worksheets/sheet4.xml",
    relId: "rId7",
    extras: ["xl/worksheets/_rels/sheet4.xml.rels"],
  },
  "TL Only Fuel Price Volatility": {
    part: "xl/worksheets/sheet5.xml",
    relId: "rId8",
    extras: [],
  },
  "LTL Only Carrier Market Index": {
    part: "xl/worksheets/sheet6.xml",
    relId: "rId9",
    extras: ["xl/worksheets/_rels/sheet6.xml.rels"],
  },
  "LTL Only Fuel Price Volatility": {
    part: "xl/worksheets/sheet7.xml",
    relId: "rId10",
    extras: [],
  },
  "Full Data Dump": {
    part: "xl/worksheets/sheet3.xml",
    relId: "rId3",
    extras: [],
  },
};

/**
 * @param {string} xml
 * @param {string[]} included
 */
function filterWorkbookXml(xml, included) {
  const keep = new Set(included);
  const sheets = xml.replace(/<sheet\b[^>]*\/>/g, (tag) => {
    const name = tag.match(/\bname="([^"]+)"/)?.[1] ?? "";
    return keep.has(name) ? tag : "";
  });
  const active = Math.max(0, included.indexOf("Full Data Dump"));
  return sheets.replace(/activeTab="\d+"/, `activeTab="${active}"`);
}

/**
 * @param {string} xml
 * @param {string[]} included
 */
function filterRelsXml(xml, included) {
  const drop = new Set(
    MARMON_TABS.filter((name) => !included.includes(name)).map((name) => TAB_PARTS[name].relId)
  );
  return xml.replace(/<Relationship\b[^>]*\/>/g, (tag) => {
    const id = tag.match(/\bId="([^"]+)"/)?.[1] ?? "";
    return drop.has(id) ? "" : tag;
  });
}

/**
 * @param {string} xml
 * @param {string[]} included
 */
function filterContentTypes(xml, included) {
  const drop = new Set(
    MARMON_TABS.filter((name) => !included.includes(name)).map((name) => `/${TAB_PARTS[name].part}`)
  );
  return xml.replace(/<Override\b[^>]*\/>/g, (tag) => {
    const part = tag.match(/\bPartName="([^"]+)"/)?.[1] ?? "";
    return drop.has(part) ? "" : tag;
  });
}

/**
 * @param {string} xml
 * @param {string[]} included
 */
function filterAppXml(xml, included) {
  const titles = included.map((name) => `<vt:lpstr>${name}</vt:lpstr>`).join("");
  return xml
    .replace(/<vt:i4>\d+<\/vt:i4>/, `<vt:i4>${included.length}</vt:i4>`)
    .replace(
      /<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/,
      `<TitlesOfParts><vt:vector size="${included.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts>`
    );
}

/**
 * @param {string} letters
 */
function columnNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/**
 * @param {string} xml
 */
function parseSharedStrings(xml) {
  /** @type {string[]} */
  const strings = [];
  for (const item of xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || []) {
    const text = [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((match) =>
        match[1]
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&quot;", '"')
          .replaceAll("&apos;", "'")
          .replaceAll("&amp;", "&")
      )
      .join("");
    strings.push(text);
  }
  return strings;
}

/**
 * @param {string} sheetXml
 * @param {number} colNumber 1-based
 */
function columnStyle(sheetXml, colNumber) {
  for (const match of sheetXml.matchAll(/<col\b([^>]*)\/?>/g)) {
    const attrs = match[1];
    const min = Number(attrs.match(/\bmin="(\d+)"/)?.[1]);
    const max = Number(attrs.match(/\bmax="(\d+)"/)?.[1] ?? min);
    const style = attrs.match(/\bstyle="(\d+)"/)?.[1];
    if (colNumber >= min && colNumber <= max && style) return style;
  }
  return "0";
}

/**
 * @param {string} rowXml
 * @param {string} ref
 * @param {string[]} strings
 */
function sharedCellText(rowXml, ref, strings) {
  const match = rowXml.match(new RegExp(`<c r="${ref}"([^>]*)>([\\s\\S]*?)</c>`));
  if (!match || !/\bt="s"/.test(match[1])) return "";
  const index = Number(match[2].match(/<v>(\d+)<\/v>/)?.[1]);
  return Number.isFinite(index) ? strings[index] || "" : "";
}

/**
 * @param {number} value
 */
function xmlNumber(value) {
  const rounded = Math.round(value * 10000) / 10000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** Thousands separator, not the column's currency format. Built-in format #,##0. */
const MILES_NUMBER_XF =
  '<xf numFmtId="3" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';
const MILES_TOTAL_XF =
  '<xf numFmtId="3" fontId="3" fillId="2" borderId="7" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';
const SPEND_FMT = '<numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00;\\(&quot;$&quot;#,##0.00\\)"/>';
const SPEND_XF =
  '<xf numFmtId="165" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';
const SPEND_TOTAL_XF =
  '<xf numFmtId="165" fontId="3" fillId="2" borderId="7" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';
const EXPOSURE_XF =
  '<xf numFmtId="165" fontId="2" fillId="2" borderId="5" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';
const EXPOSURE_TOTAL_XF =
  '<xf numFmtId="165" fontId="3" fillId="2" borderId="8" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';
const FUEL_RPM_FMT = '<numFmt numFmtId="166" formatCode="&quot;$&quot;#,##0.0000;\\(&quot;$&quot;#,##0.0000\\)"/>';
const FUEL_RPM_XF =
  '<xf numFmtId="166" fontId="2" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';
const FUEL_RPM_TOTAL_XF =
  '<xf numFmtId="166" fontId="3" fillId="2" borderId="7" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>';

/**
 * @param {string} attrs
 * @param {string} style
 * @param {boolean} forceStyle
 */
function styleAttrs(attrs, style, forceStyle) {
  if (!forceStyle) return attrs;
  if (/\bs="\d+"/.test(attrs)) return attrs.replace(/\bs="\d+"/, `s="${style}"`);
  return `${attrs} s="${style}"`;
}

/**
 * Writes linehaul, market, and exposure. An empty row is 0 in each column.
 * @param {string} rowXml
 * @param {number} row
 * @param {{ linehaul: string, market: string, exposure: string }} cols
 * @param {{ linehaul: string, market: string, exposure: string }} styles
 * @param {{ count: number, linehaul: number, linehaulAny: boolean, market: number, marketAny: boolean }} bucket
 * @param {boolean} [forceStyle]
 */
function writeSpendCells(rowXml, row, cols, styles, bucket, forceStyle = false) {
  const empty = bucket.count === 0;
  const force = forceStyle || empty;
  let next = rowXml;
  if (bucket.linehaulAny || empty) {
    next = upsertNumberCell(next, `${cols.linehaul}${row}`, styles.linehaul, bucket.linehaulAny ? bucket.linehaul : 0, force);
  }
  if (bucket.marketAny || empty) {
    next = upsertNumberCell(next, `${cols.market}${row}`, styles.market, bucket.marketAny ? bucket.market : 0, force);
  }
  if (empty || (bucket.marketAny && bucket.linehaulAny)) {
    const exposure = empty ? 0 : Math.round((bucket.market - bucket.linehaul) * 100) / 100;
    next = upsertNumberCell(next, `${cols.exposure}${row}`, styles.exposure, exposure, true);
  }
  return next;
}

function upsertNumberCell(rowXml, ref, style, value, forceStyle = false) {
  const inner = `<v>${xmlNumber(value)}</v>`;
  const selfClose = new RegExp(`<c r="${ref}"([^>]*)/>`);
  if (selfClose.test(rowXml)) {
    return rowXml.replace(selfClose, (_, attrs) => `<c r="${ref}"${styleAttrs(attrs, style, forceStyle)}>${inner}</c>`);
  }
  const full = new RegExp(`<c r="${ref}"([^>]*)>[\\s\\S]*?</c>`);
  if (full.test(rowXml)) {
    return rowXml.replace(full, (_, attrs) => `<c r="${ref}"${styleAttrs(attrs, style, forceStyle)}>${inner}</c>`);
  }
  const cell = `<c r="${ref}" s="${style}">${inner}</c>`;
  const targetCol = columnNumber(ref.replace(/\d+/g, ""));
  const cellRe = /<c r="([A-Z]+)\d+"/g;
  let insertAt = rowXml.lastIndexOf("</row>");
  let match;
  while ((match = cellRe.exec(rowXml))) {
    if (columnNumber(match[1]) > targetCol) {
      insertAt = match.index;
      break;
    }
  }
  return rowXml.slice(0, insertAt) + cell + rowXml.slice(insertAt);
}

/**
 * @param {string} city
 */
function cityKey(city) {
  const key = String(city || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (key === "MC KENZIE") return "MCKENZIE";
  return key;
}

/**
 * @param {string} equipment
 * @param {"all" | "tl" | "ltl"} mode
 */
function keepEquipment(equipment, mode) {
  const ltl = /\bLTL\b/i.test(equipment);
  if (mode === "ltl") return ltl;
  if (mode === "tl") return !ltl;
  return true;
}

/**
 * @param {UtlxLoad[]} loads
 * @param {string} label
 */
function siteBucket(loads, label) {
  const key = cityKey(label);
  let count = 0;
  let miles = 0;
  let linehaul = 0;
  let linehaulAny = false;
  let market = 0;
  let marketAny = false;
  for (const load of loads) {
    if (cityKey(load.origin) !== key && cityKey(load.dest) !== key) continue;
    count += 1;
    if (load.miles != null) miles += load.miles;
    if (load.freight != null) {
      linehaul += load.freight;
      linehaulAny = true;
    }
    if (load.datFreight != null) {
      market += load.datFreight;
      marketAny = true;
    }
  }
  return {
    count,
    miles: Math.round(miles * 100) / 100,
    linehaul: Math.round(linehaul * 100) / 100,
    linehaulAny,
    market: Math.round(market * 100) / 100,
    marketAny,
  };
}

/**
 * Shipments for this customer that do not touch any listed site.
 * @param {UtlxLoad[]} loads
 * @param {string[]} sites
 */
function vendorBucket(loads, sites) {
  const keys = new Set(sites.map((site) => cityKey(site)));
  let count = 0;
  let miles = 0;
  let linehaul = 0;
  let linehaulAny = false;
  let market = 0;
  let marketAny = false;
  for (const load of loads) {
    if (keys.has(cityKey(load.origin)) || keys.has(cityKey(load.dest))) continue;
    count += 1;
    if (load.miles != null) miles += load.miles;
    if (load.freight != null) {
      linehaul += load.freight;
      linehaulAny = true;
    }
    if (load.datFreight != null) {
      market += load.datFreight;
      marketAny = true;
    }
  }
  return {
    count,
    miles: Math.round(miles * 100) / 100,
    linehaul: Math.round(linehaul * 100) / 100,
    linehaulAny,
    market: Math.round(market * 100) / 100,
    marketAny,
  };
}

/**
 * Write UTLX site rows. A shipment counts when that city is the origin or the destination.
 * Vendor to Vendor is the customer's shipments that miss every listed site.
 * TOTAL is the sum of the site rows and Vendor to Vendor.
 * @param {string} sheetXml
 * @param {string[]} strings
 * @param {UtlxLoad[]} loads
 * @param {{ miles?: string, total?: string, spend?: string, spendTotal?: string, exposure?: string, exposureTotal?: string }} [numberStyles]
 */
export function fillUtlxBlock(sheetXml, strings, loads, numberStyles = {}) {
  const titles = [];
  const cellRe = /<c r="([A-Z]+)(\d+)"([^>/]*)>([\s\S]*?)<\/c>/g;
  let match;
  while ((match = cellRe.exec(sheetXml))) {
    if (!/\bt="s"/.test(match[3])) continue;
    const index = Number(match[4].match(/<v>(\d+)<\/v>/)?.[1]);
    const section = (strings[index] || "").trim().toUpperCase();
    if (!SITE_SECTIONS.some((item) => item.title === section)) continue;
    titles.push({ col: match[1], row: Number(match[2]), section });
  }

  let xml = sheetXml;
  const grand = { count: 0, miles: 0, linehaul: 0, linehaulAny: false, market: 0, marketAny: false };
  for (const title of titles) {
    const sectionLoads = loads.filter((load) => load.section === title.section);
    const milesColNum = columnNumber(title.col) + 1;
    const countColNum = columnNumber(title.col) + 2;
    const milesCol = columnName(milesColNum - 1);
    const countCol = columnName(countColNum - 1);
    const milesStyle = numberStyles.miles || columnStyle(xml, milesColNum);
    const milesTotalStyle = numberStyles.total || milesStyle;
    const countStyle = columnStyle(xml, countColNum);
    const linehaulCol = columnName(milesColNum + 1);
    const marketCol = columnName(milesColNum + 2);
    const linehaulStyle = numberStyles.spend || columnStyle(xml, milesColNum + 2);
    const linehaulTotalStyle = numberStyles.spendTotal || linehaulStyle;
    const marketStyle = numberStyles.spend || columnStyle(xml, milesColNum + 3);
    const marketTotalStyle = numberStyles.spendTotal || marketStyle;
    const exposureCol = columnName(milesColNum + 3);
    const exposureStyle = numberStyles.exposure || marketStyle;
    const exposureTotalStyle = numberStyles.exposureTotal || exposureStyle;
    let totalCount = 0;
    let totalMiles = 0;
    let totalLinehaul = 0;
    let totalLinehaulAny = false;
    let totalMarket = 0;
    let totalMarketAny = false;
    /** @type {string[]} */
    const siteNames = [];
    for (let row = title.row + 1; row < title.row + 40; row++) {
      const current = xml.match(new RegExp(`<row r="${row}"[^>]*>[\\s\\S]*?</row>`));
      if (!current) break;
      const label = sharedCellText(current[0], `${title.col}${row}`, strings).trim();
      const key = label.toUpperCase();
      if (!label || key === "SITE") continue;
      if (key === "VENDOR TO VENDOR") {
        const bucket = vendorBucket(sectionLoads, siteNames);
        totalCount += bucket.count;
        totalMiles += bucket.miles;
        if (bucket.linehaulAny) {
          totalLinehaul += bucket.linehaul;
          totalLinehaulAny = true;
        }
        if (bucket.marketAny) {
          totalMarket += bucket.market;
          totalMarketAny = true;
        }
        let next = upsertNumberCell(current[0], `${milesCol}${row}`, milesStyle, bucket.miles);
        next = upsertNumberCell(next, `${countCol}${row}`, countStyle, bucket.count);
        next = writeSpendCells(
          next,
          row,
          { linehaul: linehaulCol, market: marketCol, exposure: exposureCol },
          { linehaul: linehaulStyle, market: marketStyle, exposure: exposureStyle },
          bucket
        );
        xml = xml.replace(current[0], next);
        continue;
      }
      if (key === "TOTAL") {
        let next = upsertNumberCell(current[0], `${milesCol}${row}`, milesTotalStyle, totalMiles, true);
        next = upsertNumberCell(next, `${countCol}${row}`, countStyle, totalCount);
        next = writeSpendCells(
          next,
          row,
          { linehaul: linehaulCol, market: marketCol, exposure: exposureCol },
          { linehaul: linehaulTotalStyle, market: marketTotalStyle, exposure: exposureTotalStyle },
          {
            count: totalCount,
            linehaul: Math.round(totalLinehaul * 100) / 100,
            linehaulAny: totalLinehaulAny,
            market: Math.round(totalMarket * 100) / 100,
            marketAny: totalMarketAny,
          },
          true
        );
        grand.count += totalCount;
        grand.miles += totalMiles;
        if (totalLinehaulAny) {
          grand.linehaul += Math.round(totalLinehaul * 100) / 100;
          grand.linehaulAny = true;
        }
        if (totalMarketAny) {
          grand.market += Math.round(totalMarket * 100) / 100;
          grand.marketAny = true;
        }
        xml = xml.replace(current[0], next);
        break;
      }
      siteNames.push(label);
      const bucket = siteBucket(sectionLoads, label);
      totalCount += bucket.count;
      totalMiles += bucket.miles;
      if (bucket.linehaulAny) {
        totalLinehaul += bucket.linehaul;
        totalLinehaulAny = true;
      }
      if (bucket.marketAny) {
        totalMarket += bucket.market;
        totalMarketAny = true;
      }
      let next = upsertNumberCell(current[0], `${milesCol}${row}`, milesStyle, bucket.miles);
      next = upsertNumberCell(next, `${countCol}${row}`, countStyle, bucket.count);
      next = writeSpendCells(
        next,
        row,
        { linehaul: linehaulCol, market: marketCol, exposure: exposureCol },
        { linehaul: linehaulStyle, market: marketStyle, exposure: exposureStyle },
        bucket
      );
      xml = xml.replace(current[0], next);
    }
  }
  return writeAggregatedTotal(xml, strings, grand, numberStyles);
}

/**
 * @param {string} rowXml
 * @param {string[]} strings
 */
function sharedColumns(rowXml, strings) {
  /** @type {Map<string, string>} */
  const columns = new Map();
  const re = /<c r="([A-Z]+)\d+"([^>/]*)>([\s\S]*?)<\/c>/g;
  let match;
  while ((match = re.exec(rowXml))) {
    if (!/\bt="s"/.test(match[2])) continue;
    const index = Number(match[3].match(/<v>(\d+)<\/v>/)?.[1]);
    const text = (strings[index] || "").trim().toUpperCase();
    if (text) columns.set(text, match[1]);
  }
  return columns;
}

/**
 * Sum of the company TOTAL rows. Market Exposure is market linehaul minus linehaul spend.
 * @param {string} xml
 * @param {string[]} strings
 * @param {{ count: number, miles: number, linehaul: number, linehaulAny: boolean, market: number, marketAny: boolean }} grand
 * @param {{ total?: string, spendTotal?: string, exposureTotal?: string }} numberStyles
 */
function writeAggregatedTotal(xml, strings, grand, numberStyles) {
  /** @type {{ col: string, row: number }[]} */
  const targets = [];
  const cellRe = /<c r="([A-Z]+)(\d+)"([^>/]*)>([\s\S]*?)<\/c>/g;
  let match;
  while ((match = cellRe.exec(xml))) {
    if (!/\bt="s"/.test(match[3])) continue;
    const index = Number(match[4].match(/<v>(\d+)<\/v>/)?.[1]);
    if ((strings[index] || "").trim().toUpperCase() !== "AGGREGATED TOTAL") continue;
    targets.push({ col: match[1], row: Number(match[2]) });
  }
  for (const target of targets) {
    /** @type {Map<string, string>} */
    let headers = new Map();
    for (let row = target.row - 1; row >= target.row - 3 && row > 0; row--) {
      const headerRow = xml.match(new RegExp(`<row r="${row}"[^>]*>[\\s\\S]*?</row>`));
      if (!headerRow) continue;
      const columns = sharedColumns(headerRow[0], strings);
      if (columns.has("TOTAL MILES")) {
        headers = columns;
        break;
      }
    }
    const milesCol = headers.get("TOTAL MILES");
    const countCol = headers.get("NUMBER OF SHIPMENTS");
    const linehaulCol = headers.get("TOTAL LINEHAUL SPEND");
    const marketCol = headers.get("MARKET LINEHAUL SPEND");
    const exposureCol = headers.get("MARKET EXPOSURE");
    const current = xml.match(new RegExp(`<row r="${target.row}"[^>]*>[\\s\\S]*?</row>`));
    if (!current || !milesCol || !countCol) continue;
    let next = upsertNumberCell(
      current[0],
      `${milesCol}${target.row}`,
      numberStyles.total || "0",
      Math.round(grand.miles * 100) / 100,
      true
    );
    next = upsertNumberCell(next, `${countCol}${target.row}`, "0", grand.count);
    const linehaul = Math.round(grand.linehaul * 100) / 100;
    const market = Math.round(grand.market * 100) / 100;
    if (linehaulCol && marketCol && exposureCol) {
      next = writeSpendCells(
        next,
        target.row,
        { linehaul: linehaulCol, market: marketCol, exposure: exposureCol },
        {
          linehaul: numberStyles.spendTotal || "0",
          market: numberStyles.spendTotal || "0",
          exposure: numberStyles.exposureTotal || "0",
        },
        {
          count: grand.count,
          linehaul,
          linehaulAny: grand.linehaulAny,
          market,
          marketAny: grand.marketAny,
        },
        true
      );
    }
    xml = xml.replace(current[0], next);
  }
  return xml;
}

const FUEL_TABS = [
  "Master Fuel Price Volatility",
  "TL Only Fuel Price Volatility",
  "LTL Only Fuel Price Volatility",
];

/**
 * Total fuel and DAT fuel for loads that match. No shipments is 0.
 * @param {UtlxLoad[]} loads
 * @param {(load: UtlxLoad) => boolean} pred
 */
function fuelBucket(loads, pred) {
  let count = 0;
  let miles = 0;
  let fuel = 0;
  let dat = 0;
  let datAny = false;
  for (const load of loads) {
    if (!pred(load)) continue;
    count += 1;
    if (load.miles != null) miles += load.miles;
    if (load.fuel != null) fuel += load.fuel;
    if (load.datFuel != null) {
      dat += load.datFuel;
      datAny = true;
    }
  }
  return {
    count,
    miles: Math.round(miles * 100) / 100,
    fuel: Math.round(fuel * 100) / 100,
    dat: Math.round(dat * 100) / 100,
    datAny,
  };
}

/**
 * @param {number} fuel
 * @param {number} miles
 */
function fuelPerMile(fuel, miles) {
  if (!miles) return 0;
  return Math.round((fuel / miles) * 10000) / 10000;
}

/**
 * Total Fuel Surcharge for the same client, site, and Vendor to Vendor rows.
 * @param {string} sheetXml
 * @param {string[]} strings
 * @param {UtlxLoad[]} loads
 * @param {{ spend?: string, spendTotal?: string, exposure?: string, exposureTotal?: string }} numberStyles
 */
function fillFuelBlock(sheetXml, strings, loads, numberStyles) {
  const titles = [];
  const cellRe = /<c r="([A-Z]+)(\d+)"([^>/]*)>([\s\S]*?)<\/c>/g;
  let match;
  while ((match = cellRe.exec(sheetXml))) {
    if (!/\bt="s"/.test(match[3])) continue;
    const index = Number(match[4].match(/<v>(\d+)<\/v>/)?.[1]);
    const section = (strings[index] || "").trim().toUpperCase();
    if (!SITE_SECTIONS.some((item) => item.title === section)) continue;
    titles.push({ col: match[1], row: Number(match[2]), section });
  }

  let xml = sheetXml;
  let grandFuel = 0;
  let grandMiles = 0;
  let grandDat = 0;
  let grandDatAny = false;
  const dataStyle = numberStyles.spend || "0";
  const totalStyle = numberStyles.spendTotal || dataStyle;
  const milesStyle = numberStyles.miles || "0";
  const milesTotalStyle = numberStyles.total || milesStyle;
  const rpmStyle = numberStyles.rpm || dataStyle;
  const rpmTotalStyle = numberStyles.rpmTotal || rpmStyle;
  const exposureStyle = numberStyles.exposure || dataStyle;
  const exposureTotalStyle = numberStyles.exposureTotal || exposureStyle;
  for (const title of titles) {
    const sectionLoads = loads.filter((load) => load.section === title.section);
    const origin = columnNumber(title.col);
    const cols = {
      fuel: columnName(origin),
      miles: columnName(origin + 1),
      avg: columnName(origin + 2),
      dat: columnName(origin + 3),
      exposure: columnName(origin + 4),
    };
    let totalFuel = 0;
    let totalMiles = 0;
    let totalDat = 0;
    let totalDatAny = false;
    let totalCount = 0;
    /** @type {string[]} */
    const siteNames = [];
    for (let row = title.row + 1; row < title.row + 40; row++) {
      const current = xml.match(new RegExp(`<row r="${row}"[^>]*>[\\s\\S]*?</row>`));
      if (!current) break;
      const label = sharedCellText(current[0], `${title.col}${row}`, strings).trim();
      const key = label.toUpperCase();
      if (!label || key === "SITE") continue;
      /** @type {(load: UtlxLoad) => boolean} */
      let pred;
      let totalRow = false;
      if (key === "VENDOR TO VENDOR") {
        const keys = new Set(siteNames.map((site) => cityKey(site)));
        pred = (load) => !keys.has(cityKey(load.origin)) && !keys.has(cityKey(load.dest));
      } else if (key === "TOTAL") {
        totalRow = true;
        pred = () => false;
      } else {
        siteNames.push(label);
        const site = cityKey(label);
        pred = (load) => cityKey(load.origin) === site || cityKey(load.dest) === site;
      }
      const bucket = totalRow
        ? {
            count: totalCount,
            miles: Math.round(totalMiles * 100) / 100,
            fuel: Math.round(totalFuel * 100) / 100,
            dat: Math.round(totalDat * 100) / 100,
            datAny: totalDatAny,
          }
        : fuelBucket(sectionLoads, pred);
      if (!totalRow) {
        totalCount += bucket.count;
        totalMiles += bucket.miles;
        totalFuel += bucket.fuel;
        if (bucket.datAny) {
          totalDat += bucket.dat;
          totalDatAny = true;
        }
      } else {
        grandMiles += bucket.miles;
        grandFuel += bucket.fuel;
        if (bucket.datAny) {
          grandDat += bucket.dat;
          grandDatAny = true;
        }
      }
      const styles = totalRow
        ? {
            data: totalStyle,
            total: totalStyle,
            miles: milesTotalStyle,
            milesTotal: milesTotalStyle,
            rpm: rpmTotalStyle,
            rpmTotal: rpmTotalStyle,
            exposure: exposureTotalStyle,
            exposureTotal: exposureTotalStyle,
          }
        : {
            data: dataStyle,
            total: dataStyle,
            miles: milesStyle,
            milesTotal: milesStyle,
            rpm: rpmStyle,
            rpmTotal: rpmStyle,
            exposure: exposureStyle,
            exposureTotal: exposureStyle,
          };
      xml = xml.replace(current[0], writeFuelAmounts(current[0], row, cols, styles, bucket, totalRow));
      if (totalRow) break;
    }
  }
  return writeAggregatedFuel(
    xml,
    strings,
    {
      fuel: Math.round(grandFuel * 100) / 100,
      miles: Math.round(grandMiles * 100) / 100,
      dat: Math.round(grandDat * 100) / 100,
      datAny: grandDatAny,
    },
    { total: totalStyle, miles: milesTotalStyle, exposure: exposureTotalStyle }
  );
}

/**
 * @param {string} rowXml
 * @param {number} row
 * @param {{ fuel: string, miles: string, avg: string, dat: string, exposure: string }} cols
 * @param {{ data: string, total: string, miles: string, milesTotal: string, rpm: string, rpmTotal: string, exposure: string, exposureTotal: string }} styles
 * @param {{ count: number, miles: number, fuel: number, dat: number, datAny: boolean }} bucket
 * @param {boolean} totalRow
 */
function writeFuelAmounts(rowXml, row, cols, styles, bucket, totalRow) {
  const empty = bucket.count === 0;
  const moneyStyle = totalRow ? styles.total : styles.data;
  const milesStyle = totalRow ? styles.milesTotal : styles.miles;
  const rpmStyle = totalRow ? styles.rpmTotal : styles.rpm;
  const exposureStyle = totalRow ? styles.exposureTotal : styles.exposure;
  let next = upsertNumberCell(rowXml, `${cols.fuel}${row}`, moneyStyle, bucket.fuel, true);
  next = upsertNumberCell(next, `${cols.miles}${row}`, milesStyle, bucket.miles, true);
  next = upsertNumberCell(next, `${cols.avg}${row}`, rpmStyle, fuelPerMile(bucket.fuel, bucket.miles), true);
  if (bucket.datAny || empty) {
    const dat = bucket.datAny ? bucket.dat : 0;
    next = upsertNumberCell(next, `${cols.dat}${row}`, moneyStyle, dat, true);
    const exposure = (Math.round(dat * 100) - Math.round(bucket.fuel * 100)) / 100;
    next = upsertNumberCell(next, `${cols.exposure}${row}`, exposureStyle, exposure, true);
  }
  return next;
}

/**
 * @param {string} xml
 * @param {string[]} strings
 * @param {{ fuel: number, miles: number, dat: number, datAny: boolean }} grand
 * @param {{ total: string, miles: string, exposure: string }} styles
 */
function writeAggregatedFuel(xml, strings, grand, styles) {
  /** @type {{ col: string, row: number }[]} */
  const targets = [];
  const cellRe = /<c r="([A-Z]+)(\d+)"([^>/]*)>([\s\S]*?)<\/c>/g;
  let match;
  while ((match = cellRe.exec(xml))) {
    if (!/\bt="s"/.test(match[3])) continue;
    const index = Number(match[4].match(/<v>(\d+)<\/v>/)?.[1]);
    if ((strings[index] || "").trim().toUpperCase() !== "AGGREGATED TOTAL") continue;
    targets.push({ col: match[1], row: Number(match[2]) });
  }
  for (const target of targets) {
    /** @type {Map<string, string>} */
    let columns = new Map();
    for (let headerRow = target.row - 1; headerRow >= target.row - 3 && headerRow > 0; headerRow--) {
      const header = xml.match(new RegExp(`<row r="${headerRow}"[^>]*>[\\s\\S]*?</row>`));
      if (!header) continue;
      const found = sharedColumns(header[0], strings);
      if (found.has("TOTAL FUEL SURCHARGE")) {
        columns = found;
        break;
      }
    }
    const fuelCol = columns.get("TOTAL FUEL SURCHARGE");
    const milesCol = columns.get("TOTAL MILES");
    const datCol = columns.get("DAT - TOTAL FUEL SURCHARGE");
    const exposureCol = columns.get("MARKET EXPOSURE");
    if (!fuelCol) continue;
    const current = xml.match(new RegExp(`<row r="${target.row}"[^>]*>[\\s\\S]*?</row>`));
    if (!current) continue;
    let next = upsertNumberCell(current[0], `${fuelCol}${target.row}`, styles.total, grand.fuel, true);
    if (milesCol) next = upsertNumberCell(next, `${milesCol}${target.row}`, styles.miles, grand.miles, true);
    if (grand.datAny && datCol && exposureCol) {
      next = upsertNumberCell(next, `${datCol}${target.row}`, styles.total, grand.dat, true);
      const exposure = (Math.round(grand.dat * 100) - Math.round(grand.fuel * 100)) / 100;
      next = upsertNumberCell(next, `${exposureCol}${target.row}`, styles.exposure, exposure, true);
    }
    xml = xml.replace(current[0], next);
  }
  return xml;
}

/**
 * @param {Uint8Array} templateBytes
 * @param {{ sheetXml?: string, include: string[], utlxLoads?: UtlxLoad[] }} opts
 * @returns {Promise<Uint8Array>}
 */
export async function buildMarmonPackage(templateBytes, opts) {
  const included = MARMON_TABS.filter((name) => opts.include.includes(name));
  if (!included.length) throw new Error("Select at least one tab to include.");

  const entries = readZip(templateBytes);
  if (opts.utlxLoads) {
    const strings = parseSharedStrings(await readEntryText(entries, "xl/sharedStrings.xml"));
    const stylesEntry = entries.find((entry) => entry.name === "xl/styles.xml");
    if (!stylesEntry) throw new Error("The Marmon template is missing styles.");
    const stylesText = new TextDecoder().decode(await inflate(stylesEntry.compressed, stylesEntry.method));
    const spendFmt = appendStyleItem(stylesText, "numFmts", SPEND_FMT);
    const miles = appendStyleItem(spendFmt.xml, "cellXfs", MILES_NUMBER_XF);
    const milesTotal = appendStyleItem(miles.xml, "cellXfs", MILES_TOTAL_XF);
    const spend = appendStyleItem(milesTotal.xml, "cellXfs", SPEND_XF);
    const spendTotal = appendStyleItem(spend.xml, "cellXfs", SPEND_TOTAL_XF);
    const exposure = appendStyleItem(spendTotal.xml, "cellXfs", EXPOSURE_XF);
    const exposureTotal = appendStyleItem(exposure.xml, "cellXfs", EXPOSURE_TOTAL_XF);
    const rpmFmt = appendStyleItem(exposureTotal.xml, "numFmts", FUEL_RPM_FMT);
    const rpm = appendStyleItem(rpmFmt.xml, "cellXfs", FUEL_RPM_XF);
    const rpmTotal = appendStyleItem(rpm.xml, "cellXfs", FUEL_RPM_TOTAL_XF);
    await putZipText(entries, "xl/styles.xml", new TextEncoder().encode(rpmTotal.xml));
    const numberStyles = {
      miles: String(miles.index),
      total: String(milesTotal.index),
      spend: String(spend.index),
      spendTotal: String(spendTotal.index),
      exposure: String(exposure.index),
      exposureTotal: String(exposureTotal.index),
      rpm: String(rpm.index),
      rpmTotal: String(rpmTotal.index),
    };
    for (const name of PRINTER_TABS) {
      if (!included.includes(name)) continue;
      const mode = name.startsWith("LTL Only") ? "ltl" : name.startsWith("TL Only") ? "tl" : "all";
      const loads = opts.utlxLoads.filter((load) => keepEquipment(load.equipment, mode));
      const part = TAB_PARTS[name].part;
      const xml = await readEntryText(entries, part);
      await putZipText(entries, part, new TextEncoder().encode(fillUtlxBlock(xml, strings, loads, numberStyles)));
    }
    for (const name of FUEL_TABS) {
      if (!included.includes(name)) continue;
      const mode = name.startsWith("LTL Only") ? "ltl" : name.startsWith("TL Only") ? "tl" : "all";
      const loads = opts.utlxLoads.filter((load) => keepEquipment(load.equipment, mode));
      const part = TAB_PARTS[name].part;
      const xml = await readEntryText(entries, part);
      await putZipText(entries, part, new TextEncoder().encode(fillFuelBlock(xml, strings, loads, numberStyles)));
    }
  }
  if (included.includes("Full Data Dump")) {
    if (!opts.sheetXml) throw new Error("The data dump sheet is missing.");
    const stylesEntry = entries.find((entry) => entry.name === "xl/styles.xml");
    if (!stylesEntry) throw new Error("The Marmon template is missing styles.");
    const stylesText = new TextDecoder().decode(await inflate(stylesEntry.compressed, stylesEntry.method));
    const styled = applyFerroDumpStyles(stylesText, opts.sheetXml);
    await putZipText(entries, "xl/styles.xml", new TextEncoder().encode(styled.stylesXml));
    await putZipText(entries, "xl/worksheets/sheet3.xml", new TextEncoder().encode(styled.sheetXml));
  }

  const drop = new Set();
  for (const name of MARMON_TABS) {
    if (included.includes(name)) continue;
    drop.add(TAB_PARTS[name].part);
    for (const extra of TAB_PARTS[name].extras) drop.add(extra);
  }
  if (!PRINTER_TABS.some((name) => included.includes(name))) drop.add(PRINTER_PART);
  const kept = entries.filter((entry) => !drop.has(entry.name));

  const workbook = await readEntryText(kept, "xl/workbook.xml");
  const rels = await readEntryText(kept, "xl/_rels/workbook.xml.rels");
  const types = await readEntryText(kept, "[Content_Types].xml");
  const app = await readEntryText(kept, "docProps/app.xml");
  await putZipText(kept, "xl/workbook.xml", new TextEncoder().encode(filterWorkbookXml(workbook, included)));
  await putZipText(kept, "xl/_rels/workbook.xml.rels", new TextEncoder().encode(filterRelsXml(rels, included)));
  await putZipText(kept, "[Content_Types].xml", new TextEncoder().encode(filterContentTypes(types, included)));
  await putZipText(kept, "docProps/app.xml", new TextEncoder().encode(filterAppXml(app, included)));
  return writeZip(kept);
}

/**
 * @param {ZipEntry[]} entries
 * @param {string} name
 */
async function readEntryText(entries, name) {
  const entry = entries.find((item) => item.name === name);
  if (!entry) throw new Error(`The Marmon template is missing ${name}.`);
  return new TextDecoder().decode(await inflate(entry.compressed, entry.method));
}
