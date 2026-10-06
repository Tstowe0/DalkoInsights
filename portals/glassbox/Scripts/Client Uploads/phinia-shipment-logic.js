/**
 * Phinia Shipment Upload transform.
 * Port of The Glass Box `Scripts/Client Uploads/Phinia Shipment Upload.py`.
 * Desktop VALIDATE_REQUIRED_FIELDS is False, so blank destination fields are written through.
 */

export const OUTPUT_COLUMNS = [
  "Equipment",
  "Ship Date",
  "Pickup Request Time",
  "Pickup Close Time",
  "Origin Location",
  "Origin Address",
  "Origin Country Code",
  "Origin State Code",
  "Origin City",
  "Origin Postal",
  "Origin Contact Name",
  "Origin Contact Email",
  "Origin Contact Phone",
  "Destination Location",
  "Destination Address",
  "Destination Country Code",
  "Destination State Code",
  "Destination City",
  "Destination Postal",
  "Destination Notes",
  "Product Description",
  "Hdlg Units",
  "Hdlg Unit Type",
  "Weight",
  "Class",
  "NMFC",
  "Length",
  "Width",
  "Height",
  "Stackable",
  "Insurance (Y)",
  "Commodity Category",
  "Commodity Type",
  "Shipment Value",
  "Accessorial Code1",
  "Accessorial Code2",
  "Accessorial Code3",
  "Accessorial Code4",
  "Accessorial Code5",
  "Accessorial Code6",
  "Accessorial Code7",
  "Reference1",
  "Reference2",
  "Reference3",
  "Reference4",
  "Reference5",
  "Reference6",
  "Reference7",
  "Reference8",
  "Reference9",
  "Reference10",
  "Carrier",
];

const DEFAULTS = {
  Equipment: "LTL",
  "Ship Date": "",
  "Hdlg Unit Type": "PALLET",
  "Origin Location": "PHINIA USA LLC",
  "Origin Address": "418 UNION PACIFIC BLVD",
  "Origin Country Code": "USA",
  "Origin State Code": "TX",
  "Origin City": "LAREDO",
  "Origin Postal": "78045",
  "Origin Contact Name": "IVAN JUAREZ",
  "Origin Contact Email": "IJUAREZ@PHINIA.COM",
  "Origin Contact Phone": "(956) 615-9274",
  "Product Description": "AUTOMOTIVE PARTS",
  Class: "70",
  NMFC: "62120-370",
  Length: "48",
  Width: "45",
  Height: "36",
  Stackable: "Do Not Stack",
  "Insurance (Y)": "N",
  "Destination Notes": "",
  "Pickup Request Time": "15:00",
  "Pickup Close Time": "17:00",
  "Commodity Category": "",
  "Commodity Type": "",
  "Shipment Value": "",
  Carrier: "",
};

const CAPS_COLUMNS = [
  "Origin Location",
  "Origin Address",
  "Origin City",
  "Origin Contact Name",
  "Origin Contact Email",
  "Product Description",
];

const PALLET_COLUMNS = [
  "Pallet",
  "Pallet Count",
  "Pallets",
  "Unit",
  "Units",
  "Handling Unit",
  "Handling Units",
];

const WEIGHT_COLUMNS = ["Gross Weight", "Gross Weight in LBs", "Total Weight in LBs"];

const REQUIRED_COLUMNS = [
  "Delivery",
  "Shipping Point/Receiving Pt",
  "Ship-To Party",
  "Name of the ship-to party",
  "House Number",
  "Street",
  "Location of the ship-to party",
  "Name",
  "Postal Code",
  "Total Weight in LBs",
];

/** Insertion order matches the desktop dict. */
const CITY_REPLACEMENTS = [
  ["FT. WORTH", "FORT WORTH"],
  ["FT WORTH", "FORT WORTH"],
  ["FORT ST. JOHN", "FORT ST JOHN"],
  ["ST-AUGUSTIN-DE-DESMAURES", "SAINT-AUGUSTIN-DE-DESMAURES"],
  ["SO. PLAINFIELD", "SOUTH PLAINFIELD"],
  ["SO PLAINFIELD", "SOUTH PLAINFIELD"],
  ["O'FALLON", "O FALLON"],
  ["DE FUNIAK SPRINGS", "DEFUNIAK SPRINGS"],
  ["N. LAS VEGAS", "NORTH LAS VEGAS"],
  ["FORT ST. JOHN", "FORT ST JOHN"],
  ["ST-FELICIEN", "SAINT-FELICIEN"],
  ["SAINT PRIME", "SAINT-PRIME"],
];

const DESTINATION_NOTES = {
  2024026:
    "DELIVERY APPOINTMENT REQUEST TO \n vsreceiving@fleetpride.com \n Phone number 559-651-2307",
  2024165: "DELIVERY APPOINTMENT REQUEST TO \n Phone number 817-722-0300",
  2034810:
    "DELIVERY APPOINTMENT REQUEST TO \n Kathy.cook@fleetpride.com \n David.palkin@fleetpride.com \n Phone number 847-892-4741",
  2035661:
    "DELIVERY APPOINTMENT REQUEST TO \n GROUP-ANAPTREQUESTS@FLEETPRIDE.COM \n Phone number (470) 260-7100",
  2022870:
    "if the shipment is under 10,000 lbs or 14 pallets or less they will receive at 6:30 a.m - 8:30 a.m, no appointments needed.\nIF over 10,000 lbs or more than 15 pallets they require an appointment. \n ReceivingApptSchedule@truckpro.com \n via phone at [901] 252-4226.",
};

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {unknown} value */
export function isBlank(value) {
  if (value == null) return true;
  if (typeof value === "number" && Number.isNaN(value)) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

/**
 * Python str() for the values SheetJS / openpyxl hand us.
 * Whole numbers stay without a trailing .0 (int64). "123.0" text is left intact
 * so the house-number and ship-to cleaners can strip it.
 * @param {unknown} value
 */
function pyStr(value) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value);
}

/** @param {unknown} value */
function formatHouseNumber(value) {
  if (isBlank(value)) return "";
  const text = pyStr(value).trim();
  if (/^\d+(\.0+)?$/.test(text)) return text.split(".", 1)[0];
  return text;
}

/** @param {unknown} value */
function normalizeShipToParty(value) {
  if (isBlank(value)) return "";
  const text = pyStr(value).trim();
  if (/^\d+(\.0+)?$/.test(text)) return text.split(".", 1)[0];
  return text;
}

/** @param {unknown} value */
function normalizeCityName(value) {
  if (isBlank(value)) return "";
  let text = pyStr(value).trim();
  for (const [needle, replacement] of CITY_REPLACEMENTS) {
    text = text.replace(new RegExp(escapeRegExp(needle), "gi"), replacement);
  }
  return text;
}

/**
 * @param {string[]} headers
 * @param {string[]} candidates
 */
function findFirstColumn(headers, candidates) {
  for (const name of candidates) {
    if (headers.includes(name)) return name;
  }
  return "";
}

/**
 * @param {unknown} postalCode
 */
export function processPostalCode(postalCode) {
  if (isBlank(postalCode)) return "";
  let postal = pyStr(postalCode).trim();
  if (postal.includes("-")) postal = postal.split("-")[0];
  const postalCleanForCheck = postal.replace(/ /g, "");
  const isCanadian = [...postalCleanForCheck].some((ch) => /[A-Za-z]/.test(ch));
  if (isCanadian) postal = postal.replace(/ /g, "");
  if (/^\d+$/.test(postal) && postal.length === 4) postal = `0${postal}`;
  return postal;
}

/**
 * @param {unknown} postalCode
 */
export function determineCountryCode(postalCode) {
  if (isBlank(postalCode)) return "USA";
  const postal = pyStr(postalCode).trim().toUpperCase();
  const postalClean = postal.replace(/-/g, "").replace(/ /g, "");
  if (postalClean.length === 6 && [...postalClean].some((ch) => /[A-Za-z]/.test(ch))) return "CAN";
  if (/^\d+$/.test(postalClean)) return "USA";
  return "USA";
}

/**
 * Half-up, matching math.floor(n + 0.5) for the weights this tool sees.
 * @param {number} value
 */
function roundHalfUp(value) {
  return Math.floor(value + 0.5);
}

/**
 * @param {unknown} value
 */
function asFloat(value) {
  if (typeof value === "number") return value;
  const n = Number(pyStr(value).trim());
  if (Number.isNaN(n)) throw new TypeError("bad float");
  return n;
}

/** @param {number} n */
function p2(n) {
  return String(n).padStart(2, "0");
}

/** @param {Date} value */
function dateOnly(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** @param {Date} value @param {number} days */
function addDays(value, days) {
  const next = dateOnly(value);
  next.setDate(next.getDate() + days);
  return next;
}

/** @param {Date} a @param {Date} b */
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** @param {Date} day */
function isHoliday(day) {
  const year = day.getFullYear();
  /** @type {Date[]} */
  const holidays = [
    new Date(year, 0, 1),
    new Date(year, 6, 4),
    new Date(year, 11, 24),
    new Date(year, 11, 25),
  ];

  let memorial = new Date(year, 4, 31);
  while (memorial.getDay() !== 1) memorial = addDays(memorial, -1);
  holidays.push(memorial);

  let thanksgiving = new Date(year, 10, 1);
  while (thanksgiving.getDay() !== 4) thanksgiving = addDays(thanksgiving, 1);
  thanksgiving = addDays(thanksgiving, 21);
  holidays.push(thanksgiving);
  holidays.push(addDays(thanksgiving, 1));

  return holidays.some((holiday) => sameDay(holiday, day));
}

/**
 * Next business day, skipping weekends and the desktop holiday list.
 * @param {Date} [startDate]
 */
export function getNextBusinessDay(startDate = new Date()) {
  let next = addDays(dateOnly(startDate), 1);
  while (next.getDay() === 0 || next.getDay() === 6 || isHoliday(next)) {
    next = addDays(next, 1);
  }
  return next;
}

/** M/D/YYYY with no leading zeros. @param {Date} value */
export function formatShipDate(value) {
  const day = dateOnly(value);
  return `${day.getMonth() + 1}/${day.getDate()}/${day.getFullYear()}`;
}

/**
 * Parse M/D/YYYY or M/D/YY. Two-digit years follow Python strptime %y.
 * @param {string} dateStr
 * @returns {Date | null}
 */
export function parseShipDate(dateStr) {
  const cleaned = String(dateStr ?? "").trim();
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  let year = Number(match[3]);
  if (match[3].length === 2) year += year >= 69 ? 1900 : 2000;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

/** Desktop filename stamp: mmddyyyyHHMM. @param {Date} [when] */
export function phiniaStamp(when = new Date()) {
  return `${p2(when.getMonth() + 1)}${p2(when.getDate())}${when.getFullYear()}${p2(when.getHours())}${p2(when.getMinutes())}`;
}

/**
 * Openpyxl row height for one Destination Notes cell.
 * @param {unknown} content
 */
export function destinationNotesRowHeight(content) {
  const text = content == null ? "" : String(content);
  if (!text) return 15;
  const lines = text.split("\n");
  let rowHeight = 15;
  if (lines.length > 1) rowHeight = 15 + (lines.length - 1) * 12;
  else if (text.length > 7) {
    const estimated = Math.floor(text.length / 7) + 1;
    rowHeight = 15 + (estimated - 1) * 12;
  }
  return Math.min(rowHeight, 120);
}

/**
 * @param {Record<string, unknown>[]} inputRows
 * @param {string[]} headers
 * @param {string} shipDate
 */
export function buildPhiniaRows(inputRows, headers, shipDate) {
  const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missing.length) {
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  }

  const palletCol = findFirstColumn(headers, PALLET_COLUMNS);
  const weightCol = findFirstColumn(headers, WEIGHT_COLUMNS);
  /** @type {string[]} */
  const missingVariants = [];
  if (!palletCol) {
    missingVariants.push("Pallet, Pallet Count, Pallets, Unit, Units, Handling Unit, or Handling Units");
  }
  if (!weightCol) {
    missingVariants.push("Gross Weight, Gross Weight in LBs, or Total Weight in LBs");
  }
  if (missingVariants.length) {
    throw new Error(`Missing required columns: ${missingVariants.join(", ")}`);
  }

  return inputRows.map((row) => {
    /** @type {Record<string, unknown>} */
    const output = { ...DEFAULTS };
    output["Ship Date"] = shipDate;
    output["Hdlg Unit Type"] = String(output["Hdlg Unit Type"]).toUpperCase();
    for (const col of CAPS_COLUMNS) output[col] = String(output[col]).toUpperCase();

    const destNameRaw = row["Name of the ship-to party"];
    output["Destination Location"] = isBlank(destNameRaw) ? "" : pyStr(destNameRaw).trim();

    const houseNum = formatHouseNumber(row["House Number"]);
    const streetRaw = row.Street;
    const street = isBlank(streetRaw) ? "" : pyStr(streetRaw).trim();
    output["Destination Address"] = [houseNum, street].filter(Boolean).join(" ").trim();

    const destStateRaw = row.Name;
    output["Destination State Code"] = isBlank(destStateRaw) ? "" : pyStr(destStateRaw).trim();
    output["Destination City"] = normalizeCityName(row["Location of the ship-to party"]);

    const postalRaw = row["Postal Code"];
    output["Destination Postal"] = processPostalCode(postalRaw);
    output["Destination Country Code"] = determineCountryCode(postalRaw);

    const palletCount = row[palletCol];
    try {
      if (isBlank(palletCount)) output["Hdlg Units"] = "";
      else {
        const units = Math.trunc(asFloat(palletCount));
        output["Hdlg Units"] = units > 0 ? units : "";
      }
    } catch {
      output["Hdlg Units"] = "";
    }

    const grossWeight = weightCol ? row[weightCol] : 0;
    try {
      if (!isBlank(grossWeight)) output.Weight = roundHalfUp(asFloat(grossWeight));
      else output.Weight = 0;
    } catch {
      output.Weight = 0;
    }

    const deliveryRaw = row.Delivery;
    if (isBlank(deliveryRaw)) output.Reference1 = "";
    else {
      const deliveryValue = pyStr(deliveryRaw).trim();
      output.Reference1 = deliveryValue.includes("/")
        ? deliveryValue.split("/")[0].trim()
        : deliveryValue;
    }
    output.Reference2 = "";
    output.Reference3 = "";

    const shipToParty = normalizeShipToParty(row["Ship-To Party"]);
    if (Object.prototype.hasOwnProperty.call(DESTINATION_NOTES, shipToParty)) {
      output["Destination Notes"] = DESTINATION_NOTES[shipToParty];
    }

    /** @type {Record<string, unknown>} */
    const ordered = {};
    for (const col of OUTPUT_COLUMNS) ordered[col] = col in output ? output[col] : "";
    return ordered;
  });
}

/**
 * Windows pandas to_csv: utf-8, \\r\\n between records, minimal quoting.
 * A blank Hdlg Units value makes that column float64, so other units are written as 2.0.
 * @param {Record<string, unknown>[]} rows
 */
export function toPandasCsv(rows) {
  const hdlgBlank = rows.some((row) => row["Hdlg Units"] === "" || row["Hdlg Units"] == null);
  const lines = [OUTPUT_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(OUTPUT_COLUMNS.map((col) => csvField(col, row[col], hdlgBlank)).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * @param {string} col
 * @param {unknown} value
 * @param {boolean} hdlgBlank
 */
function csvField(col, value, hdlgBlank) {
  if (value == null || value === "") return "";
  if (col === "Hdlg Units" && hdlgBlank && typeof value === "number" && Number.isInteger(value)) {
    return `${value}.0`;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
