/**
 * Boxlight Freight RFP — App B1 LTL Pricing → BatchRateSampleFile
 * Other tabs (B2/B3/C/D) are ignored.
 */

const SHEET_CANDIDATES = ["App B1 - LTL Pricing", "App B1", "LTL Pricing"];

/** @param {string} s */
function normHeader(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/\n/g, " ")
    .trim()
    .toLowerCase();
}

/** @param {unknown} v */
function padZip(v) {
  if (v == null || v === "") return null;
  let s = String(v).replace(/\s+/g, "").trim();
  if (!s) return null;
  if (/^\d+\.0$/.test(s)) s = s.replace(/\.0$/, "");
  // Numeric ZIPs from Excel (1851 → 01851); keep ZIP+4 / CA postal as-is after strip
  if (/^\d+$/.test(s) && s.length < 5) s = s.padStart(5, "0");
  return s;
}

/** @param {unknown} v */
function toWeight(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,$]/g, ""));
  return Number.isNaN(n) ? null : Math.round(n);
}

/** @param {unknown} v */
function toClass(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,$]/g, ""));
  return Number.isNaN(n) ? String(v).trim() || null : n;
}

/** @param {unknown} v */
function toUnits(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,$]/g, ""));
  return Number.isNaN(n) ? null : n;
}

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function splitAccessorials(v) {
  if (v == null || v === "") return [];
  return String(v)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * @param {unknown[][]} aoa
 * @returns {number} header row index
 */
function findHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const norms = (aoa[i] || []).map(normHeader);
    const hasOrigin = norms.some((h) => h === "origin zip" || h.includes("origin zip"));
    const hasDest = norms.some(
      (h) => h === "dest zip" || h.includes("dest zip") || h === "destination zip"
    );
    if (hasOrigin && hasDest) return i;
  }
  throw new Error("Could not find App B1 header row (expected Origin ZIP + Dest ZIP).");
}

/**
 * @param {string[]} headers
 * @param {string[]} aliases
 */
function findCol(headers, aliases) {
  const norms = headers.map(normHeader);
  for (const alias of aliases) {
    const a = normHeader(alias);
    const idx = norms.findIndex((h) => h === a);
    if (idx >= 0) return headers[idx];
  }
  for (const alias of aliases) {
    const a = normHeader(alias);
    const idx = norms.findIndex((h) => h.includes(a) || a.includes(h));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

/**
 * @param {object} workbook SheetJS workbook
 */
function pickB1Sheet(workbook) {
  const names = workbook.SheetNames || [];
  for (const want of SHEET_CANDIDATES) {
    const hit = names.find((n) => normHeader(n) === normHeader(want));
    if (hit) return hit;
  }
  const fuzzy = names.find(
    (n) => /app\s*b1/i.test(n) || (/ltl/i.test(n) && /pricing/i.test(n))
  );
  if (fuzzy) return fuzzy;
  throw new Error(
    `Sheet "App B1 - LTL Pricing" not found. Available: ${names.join(", ") || "(none)"}`
  );
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ templateHeaders: string[], log?: (msg: string) => void }} ctx
 */
export async function transformBoxlight(buffer, ctx) {
  const XLSX = globalThis.XLSX;
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = pickB1Sheet(workbook);
  const sheet = workbook.Sheets[sheetName];
  const aoa = /** @type {unknown[][]} */ (
    XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true, blankrows: true })
  );
  if (!aoa.length) throw new Error("App B1 sheet is empty.");

  const headerIdx = findHeaderRow(aoa);
  const rawHeaders = (aoa[headerIdx] || []).map((h) => String(h ?? "").replace(/\s+/g, " ").trim());
  const headers = rawHeaders.map((h, i) => h || `Unnamed: ${i}`);

  const col = {
    era: findCol(headers, ["ERA ID #", "ERA ID", "ERA"]),
    ship: findCol(headers, ["Ship Date", "Shipdate"]),
    oZip: findCol(headers, ["Origin ZIP", "Origin Zip"]),
    dZip: findCol(headers, ["Dest ZIP", "Destination ZIP", "Dest Zip"]),
    units: findCol(headers, ["Handling Units", "Hdlg Units"]),
    klass: findCol(headers, ["Actual Class", "Class"]),
    weight: findCol(headers, ["Actual Weight", "Weight"]),
    acc: findCol(headers, [
      "Additional Charges Description",
      "Additional Charge Descriptions",
      "Add'l Charges Description",
    ]),
  };

  if (!col.oZip || !col.dZip) {
    throw new Error("App B1 is missing Origin ZIP and/or Dest ZIP columns.");
  }

  const templateHeaders = ctx.templateHeaders || [];
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  let skippedExample = 0;

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const line = aoa[i] || [];
    /** @type {Record<string, unknown>} */
    const src = {};
    headers.forEach((h, idx) => {
      src[h] = line[idx] ?? "";
    });

    const eraRaw = col.era ? src[col.era] : "";
    const era = String(eraRaw ?? "").trim();
    if (!era || /^example$/i.test(era)) {
      skippedExample++;
      continue;
    }

    const oZip = padZip(src[col.oZip]);
    const dZip = padZip(src[col.dZip]);
    if (!oZip && !dZip) continue;

    /** @type {Record<string, unknown>} */
    const dest = {};
    for (const h of templateHeaders) dest[h] = null;

    if ("OriginZip" in dest) dest.OriginZip = oZip;
    if ("DestinationZip" in dest) dest.DestinationZip = dZip;
    if ("Shipdate" in dest) dest.Shipdate = col.ship ? src[col.ship] || null : null;
    if ("Hdlg Units1" in dest) dest["Hdlg Units1"] = col.units ? toUnits(src[col.units]) : null;
    if ("Class1" in dest) dest.Class1 = col.klass ? toClass(src[col.klass]) : null;
    if ("Weight1" in dest) dest.Weight1 = col.weight ? toWeight(src[col.weight]) : null;
    if ("ClientData" in dest) dest.ClientData = era || null;

    const accParts = col.acc ? splitAccessorials(src[col.acc]) : [];
    for (let a = 0; a < Math.min(accParts.length, 30); a++) {
      const key = `Accessorial${a + 1}`;
      if (key in dest) dest[key] = accParts[a];
    }

    rows.push(dest);
  }

  ctx.log?.(
    `Boxlight: sheet "${sheetName}", header row ${headerIdx + 1}, ${rows.length.toLocaleString()} shipments` +
      (skippedExample ? ` (${skippedExample} example/blank skipped)` : "")
  );

  return {
    rows,
    headers: templateHeaders,
    meta: { sheetName, headerRow: headerIdx + 1, skippedExample },
  };
}

export const boxlightFreightRfpProfile = {
  id: "boxlight-freight-rfp",
  label: "Boxlight Freight RFP",
  description:
    "Uses App B1 – LTL Pricing only. Auto-maps ZIPs, ship date, class, weight, handling units, and accessorials.",
  transform: transformBoxlight,
};
