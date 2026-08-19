/**
 * Tracking-report layout pipeline — mirrors Vet-Pet Python build_preserving_layout.
 */
import { parseDate, startOfDay, pickCol, pickVal } from "./report-helpers.js";
import { XL } from "./report-format.js";

export const VETPET_EXCLUDE = new Set([
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

export const FCA_EXCLUDE = new Set([
  "DELIVERED",
  "INVOICED",
  "PICKUP REQUESTED",
  "QUOTE MODIFIED",
  "BOOKED OPEN",
  "SPOT QUOTED",
  "QUOTED",
  "ASSIGN CARRIER",
  // BOOKED kept
]);

/** McConway = Vet-Pet exclude minus these (they stay) */
export const MCCONWAY_KEEP = new Set([
  "BOOKED OPEN",
  "BOOKED",
  "IN TRANSIT",
  "PICKUP REQUESTED",
  "OUT FOR DELIVERY",
]);

const STATUS_ALIASES = ["Status", "STATUS"];
const EXP_ALIASES = [
  "Exp Delivery Date",
  "EXPECTED DELIVERY",
  "EXPECTED DELIVERY DATE",
  "DELIVERY DATE (EXPECT)",
];
const ZIP_ALIASES = {
  Origin: ["Origin Postal", "ORIGIN POSTAL", "ORIGIN ZIP", "ORIGIN ZIP CODE"],
  Destination: ["Destination Postal", "DESTINATION POSTAL", "DESTINATION ZIP", "DESTINATION ZIP CODE"],
};
const EQUIPMENT_ALIASES = [
  "Eqpt",
  "EQPT",
  "Equipment",
  "EQUIPMENT",
  "Equipment Type",
  "EQUIPMENT TYPE",
  "Mode",
  "MODE",
];
const PICKUP_ALIASES = [
  "Pickup #",
  "PICKUP #",
  "Pickup",
  "PICKUP",
  "Pickup Number",
  "PICKUP NUMBER",
];
const CLIENT_ALIASES = [
  "Client Name",
  "CLIENT NAME",
  "Client",
  "CLIENT",
  "Customer Name",
  "CUSTOMER NAME",
];

/** NY calendar date as Date at local midnight approximation via locale parts. */
export function todayNy() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return new Date(Number(get("year")), Number(get("month")) - 1, Number(get("day")));
}

/** @param {unknown} v */
function blankify(v) {
  if (v == null) return "";
  if (typeof v === "string") {
    const s = v.trim();
    // Mirror pandas default na_values when reading dtype=str dumps
    if (
      !s ||
      /^(nan|null|none|na|n\/a|<na>|#n\/a|#n\/a n\/a|#na|-nan|1\.#ind|-1\.#ind|1\.#qnan|-1\.#qnan)$/i.test(
        s
      )
    ) {
      return "";
    }
    return v;
  }
  return v;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{
 *   excludeStatuses?: Set<string>,
 *   ltlExact?: boolean,
 *   dropPickupAndClient?: boolean,
 *   highlight?: boolean,
 *   sourceHeaders?: string[],
 * }} opts
 * @returns {{
 *   rows: Record<string, unknown>[],
 *   headers: string[],
 *   expCol: string | null,
 *   todayRows: Set<number>,
 *   lateRows: Set<number>,
 * }}
 * todayRows/lateRows are 0-based indices into returned rows
 */
export function buildTrackingLayout(rows, opts = {}) {
  const {
    excludeStatuses = VETPET_EXCLUDE,
    ltlExact = false,
    dropPickupAndClient = false,
    highlight = true,
    sourceHeaders = [],
  } = opts;

  let work = rows.map((r) => {
    /** @type {Record<string, unknown>} */
    const next = {};
    for (const [k, v] of Object.entries(r)) next[k] = blankify(v);
    return next;
  });

  // Normalize ZIPs
  for (const aliases of Object.values(ZIP_ALIASES)) {
    for (const row of work) {
      const { key, value } = pickCol(row, aliases);
      if (key) row[key] = String(value ?? "").replace(/\.0$/, "");
    }
  }

  // Status filter
  work = work.filter((row) => {
    const status = String(pickVal(row, STATUS_ALIASES) ?? "")
      .trim()
      .toUpperCase();
    return !excludeStatuses.has(status);
  });

  // Exact LTL — only when an equipment column exists (Python guards on equipment_col)
  if (ltlExact) {
    const sample = work[0] || Object.fromEntries((sourceHeaders || []).map((h) => [h, ""]));
    const { key: eqKey } = pickCol(sample, EQUIPMENT_ALIASES);
    if (eqKey) {
      work = work.filter((row) => {
        const eq = String(row[eqKey] ?? "")
          .trim()
          .toUpperCase();
        return eq === "LTL";
      });
    }
  }

  // Sort by Exp Delivery
  const expKeySample = work.length ? pickCol(work[0], EXP_ALIASES).key : null;
  const expCol =
    expKeySample ||
    (work.length
      ? Object.keys(work[0]).find((k) => EXP_ALIASES.some((a) => a.toUpperCase() === k.toUpperCase()))
      : null) ||
    null;

  if (expCol) {
    work = [...work].sort((a, b) => {
      const da = parseDate(a[expCol]);
      const db = parseDate(b[expCol]);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.getTime() - db.getTime();
    });
  }

  // Drop empty Product{n} groups for n>=2 (Python: re.match Product(\d+) prefix)
  let maxSlot = 1;
  const headerKeys =
    work.length > 0
      ? Object.keys(work[0])
      : sourceHeaders.length
        ? sourceHeaders
        : [];
  for (const k of headerKeys) {
    const m = /^Product(\d+)/.exec(k);
    if (m) maxSlot = Math.max(maxSlot, Number(m[1]));
  }
  for (let n = 2; n <= maxSlot; n++) {
    const productCol = `Product${n}`;
    const group = [
      `Product${n}`,
      `PO No.${n}`,
      `Hdlg Units${n}`,
      `Type${n}`,
      `Wgt${n}`,
      `Class${n}`,
    ];
    const hasProductCol = work.length
      ? productCol in work[0]
      : headerKeys.includes(productCol);
    if (!hasProductCol) {
      for (const g of group) {
        if (work.length) {
          if (g in work[0]) for (const row of work) delete row[g];
        }
      }
      continue;
    }
    const hasData = work.some((row) => {
      const s = String(row[productCol] ?? "").trim();
      return s !== "" && s !== "nan";
    });
    if (!hasData) {
      for (const g of group) {
        for (const row of work) {
          if (g in row) delete row[g];
        }
      }
    }
  }

  // Drop Total Cost (exact name, Python) + optional Pickup# / Client Name
  for (const row of work) {
    if ("Total Cost" in row) delete row["Total Cost"];
    if (dropPickupAndClient) {
      for (const aliases of [PICKUP_ALIASES, CLIENT_ALIASES]) {
        const { key } = pickCol(row, aliases);
        if (key) delete row[key];
      }
    }
  }

  /** @type {Set<number>} */
  const todayRows = new Set();
  /** @type {Set<number>} */
  const lateRows = new Set();
  if (highlight && expCol) {
    const today = startOfDay(todayNy()).getTime();
    work.forEach((row, i) => {
      const d = parseDate(row[expCol]);
      if (!d) return;
      const t = startOfDay(d).getTime();
      if (t === today) todayRows.add(i);
      else if (t < today) lateRows.add(i);
    });
  }

  // Resolve actual exp column name after mutations
  const expFinal = work.length ? pickCol(work[0], EXP_ALIASES).key : null;

  /** @type {string[]} */
  let outHeaders;
  if (work.length) {
    outHeaders = Object.keys(work[0]);
  } else {
    /** @type {Set<string>} */
    const drop = new Set(["Total Cost"]);
    for (let n = 2; n <= maxSlot; n++) {
      for (const g of [
        `Product${n}`,
        `PO No.${n}`,
        `Hdlg Units${n}`,
        `Type${n}`,
        `Wgt${n}`,
        `Class${n}`,
      ]) {
        drop.add(g);
      }
    }
    outHeaders = headerKeys.filter((h) => {
      if (drop.has(h)) return false;
      if (!dropPickupAndClient) return true;
      const up = h.toUpperCase();
      return ![...PICKUP_ALIASES, ...CLIENT_ALIASES].some((a) => a.toUpperCase() === up);
    });
  }

  return { rows: work, headers: outHeaders, expCol: expFinal, todayRows, lateRows };
}

/**
 * Build highlight map for applyClientReportStyle (Excel 1-based row → fill).
 * Header is row 1, data starts row 2 → excelRow = index + 2
 * @param {Set<number>} todayRows
 * @param {Set<number>} lateRows
 */
export function highlightMap(todayRows, lateRows) {
  /** @type {Map<number, string>} */
  const map = new Map();
  for (const i of todayRows) map.set(i + 2, XL.TODAY);
  for (const i of lateRows) map.set(i + 2, XL.LATE);
  return map;
}

export { EXP_ALIASES, EQUIPMENT_ALIASES };
