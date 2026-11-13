/**
 * LTL market markup, as a percent of that shipment's linehaul
 * (SELL FREIGHT1 + SELL FREIGHT2).
 *
 * 9.8 means Market Linehaul Spend = linehaul × 1.098.
 * Names match CARRIER NAME1. Matching ignores case and extra spaces.
 * A carrier with no percent here uses LTL_GENERAL_MARKUP.
 * A Dynamic carrier passes our charge through unchanged and does not use the general markup.
 * TL loads do not use this list.
 */

/** @type {number | null} */
export const LTL_GENERAL_MARKUP = 2.72;

/**
 * @typedef {{ name: string, percent: number | null, dynamic?: boolean }} LtlMarkupRow
 */

/** @type {LtlMarkupRow[]} */
const LTL_CARRIER_ROWS = [
  { name: "R&L CARRIERS", percent: 9.8 },
  { name: "FEDEX FREIGHT - PRIORITY", percent: 1.9 },
  { name: "XPO LOGISTICS FREIGHT INC", percent: null, dynamic: true },
  { name: "ABF FREIGHT SYSTEM INC", percent: null, dynamic: true },
  { name: "AVERITT EXPRESS", percent: null, dynamic: true },
  { name: "MANITOULIN TRANSPORT", percent: 1.9 },
  { name: "SAIA LTL FREIGHT", percent: null, dynamic: true },
  { name: "CENTRAL TRANSPORT INTERNATIONAL", percent: 2.4 },
  { name: "DAYTON FREIGHT LINES", percent: 2.3 },
  { name: "SOUTHWESTERN MOTOR TRANSPORT INC", percent: 3.3 },
  { name: "PITT OHIO EXPRESS", percent: 2.72 },
  { name: "WARD TRUCKING", percent: 2.72 },
  { name: "POLARIS TRANSPORT CARRIERS INC", percent: 2.72 },
  { name: "MAGNUM LTL INC", percent: 2.72 },
  { name: "PITTSBURGH-FAYETTE EXPRESS INC", percent: 2.72 },
  { name: "TFORCE FREIGHT", percent: 2.72 },
  { name: "OLD DOMINION FREIGHT LINE, INC", percent: 0 }, // pass our linehaul through as the market rate
];

/** @type {Record<string, number | null>} */
export const LTL_CARRIER_MARKUPS = Object.fromEntries(
  LTL_CARRIER_ROWS.filter((row) => !row.dynamic).map((row) => [row.name, row.percent])
);

/**
 * @param {unknown} name
 */
export function carrierKey(name) {
  return String(name ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

const LTL_MARKUP_INDEX = new Map(
  LTL_CARRIER_ROWS.filter((row) => !row.dynamic && row.percent != null).map((row) => [
    carrierKey(row.name),
    row.percent,
  ])
);

const LTL_DYNAMIC_INDEX = new Set(
  LTL_CARRIER_ROWS.filter((row) => row.dynamic).map((row) => carrierKey(row.name))
);

/**
 * @param {unknown} carrier
 */
export function isDynamicLtlCarrier(carrier) {
  return LTL_DYNAMIC_INDEX.has(carrierKey(carrier));
}

/**
 * Percent added to an LTL shipment's linehaul.
 * A listed percent wins. A Dynamic carrier returns null here so it does not use the general markup.
 * Market freight for a Dynamic carrier passes our linehaul through in ltlMarketLinehaul.
 * Any other carrier uses the general markup.
 * @param {unknown} carrier
 * @returns {number | null}
 */
export function ltlMarkupPercent(carrier) {
  if (isDynamicLtlCarrier(carrier)) return null;
  const listed = LTL_MARKUP_INDEX.get(carrierKey(carrier));
  if (listed != null && Number.isFinite(listed)) return listed;
  return LTL_GENERAL_MARKUP != null && Number.isFinite(LTL_GENERAL_MARKUP) ? LTL_GENERAL_MARKUP : null;
}

/**
 * LTL market linehaul. A Dynamic carrier passes our linehaul through.
 * Null for a missing linehaul or no markup.
 * @param {number | null} freight
 * @param {unknown} carrier
 * @returns {number | null}
 */
export function ltlMarketLinehaul(freight, carrier) {
  if (freight == null || !Number.isFinite(freight)) return null;
  if (isDynamicLtlCarrier(carrier)) return Math.round(freight * 100) / 100;
  const percent = ltlMarkupPercent(carrier);
  if (percent == null) return null;
  return Math.round(freight * (1 + percent / 100) * 100) / 100;
}

/**
 * LTL market fuel, as a percent added to that shipment's own fuel
 * (SELL FUEL1 + SELL FUEL2).
 *
 * 10 means market fuel = our fuel × 1.10.
 * The match is CARRIER NAME1 plus equipment type LTL.
 * A listed percent wins, including 0. A Dynamic carrier passes our fuel through and does not use the general fuel markup.
 * Any other LTL carrier uses LTL_GENERAL_FUEL_MARKUP.
 * Truckload fuel does not use this list.
 */

/** @type {number | null} */
export const LTL_GENERAL_FUEL_MARKUP = 41.5;

/**
 * @typedef {{ carrier: string, equipment: string, percent: number | null }} LtlFuelRow
 */

/** @type {LtlFuelRow[]} */
const LTL_FUEL_ROWS = [
  { carrier: "R&L CARRIERS", equipment: "LTL", percent: 44.7 },
  { carrier: "FEDEX FREIGHT - PRIORITY", equipment: "LTL", percent: 46.6 },
  { carrier: "FEDEX FREIGHT - ECONOMY", equipment: "LTL", percent: 46.6 },
  { carrier: "FEDEX FREIGHT - VOLUME", equipment: "LTL", percent: 0 },
  { carrier: "MANITOULIN TRANSPORT", equipment: "LTL", percent: 0 },
  { carrier: "DAYTON FREIGHT LINES", equipment: "LTL", percent: 41.4 },
  { carrier: "CENTRAL TRANSPORT INTERNATIONAL", equipment: "LTL", percent: 40 },
  { carrier: "SOUTHWESTERN MOTOR TRANSPORT INC", equipment: "LTL", percent: 29.7 },
  { carrier: "OLD DOMINION FREIGHT LINE, INC", equipment: "LTL", percent: 0 },
  { carrier: "AAA COOPER TRANSPORTATION", equipment: "LTL", percent: 41.5 },
  { carrier: "PITT OHIO EXPRESS", equipment: "LTL", percent: 41.5 },
  { carrier: "MAGNUM LTL INC", equipment: "LTL", percent: 41.5 },
  { carrier: "POLARIS TRANSPORT CARRIERS INC", equipment: "LTL", percent: 41.5 },
  { carrier: "WARD TRUCKING", equipment: "LTL", percent: 41.5 },
  { carrier: "TFORCE FREIGHT", equipment: "LTL", percent: 41.5 },
  { carrier: "DOHRN TRANSFER COMPANY", equipment: "LTL", percent: 41.5 },
  { carrier: "ESTES EXPRESS LINE", equipment: "LTL", percent: 41.5 },
];

const LTL_FUEL_INDEX = new Map(
  LTL_FUEL_ROWS.map((row) => [`${carrierKey(row.carrier)}|${equipmentKey(row.equipment)}`, row.percent])
);

/**
 * Equipment that uses the LTL carrier percents.
 * Ground expedite and cargo van are included. The equipment name on the line stays as written.
 * @param {unknown} raw
 */
export function isLtlMarketEquipment(raw) {
  const text = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  return (
    /\bLTL\b/.test(text) ||
    text.includes("LESS THAN TRUCKLOAD") ||
    text.includes("LESS-THAN-TRUCKLOAD") ||
    text.includes("GROUND EXPEDITE") ||
    text.includes("CARGO VAN")
  );
}

/**
 * @param {unknown} equipment
 */
function equipmentKey(equipment) {
  return String(equipment ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * LTL equipment shares one fuel type, however the dump spells it.
 * @param {unknown} equipment
 */
function fuelEquipmentKey(equipment) {
  if (isLtlMarketEquipment(equipment)) return "LTL";
  return "";
}

/**
 * Percent added to an LTL shipment's own fuel.
 * @param {unknown} carrier
 * @param {unknown} equipment
 * @returns {number | null}
 */
export function ltlFuelMarkupPercent(carrier, equipment) {
  if (isDynamicLtlCarrier(carrier)) return null;
  const type = fuelEquipmentKey(equipment);
  if (!type) return null;
  const key = `${carrierKey(carrier)}|${type}`;
  if (LTL_FUEL_INDEX.has(key)) {
    const listed = LTL_FUEL_INDEX.get(key);
    return listed != null && Number.isFinite(listed) ? listed : null;
  }
  return LTL_GENERAL_FUEL_MARKUP != null && Number.isFinite(LTL_GENERAL_FUEL_MARKUP)
    ? LTL_GENERAL_FUEL_MARKUP
    : null;
}

/**
 * Market fuel for one LTL shipment. A Dynamic carrier passes our fuel through.
 * Null until that carrier and equipment have a percent.
 * @param {number | null} fuel
 * @param {unknown} carrier
 * @param {unknown} equipment
 * @returns {number | null}
 */
export function ltlMarketFuel(fuel, carrier, equipment) {
  if (fuel == null || !Number.isFinite(fuel)) return null;
  if (isDynamicLtlCarrier(carrier)) {
    if (!fuelEquipmentKey(equipment)) return null;
    return Math.round(fuel * 100) / 100;
  }
  const percent = ltlFuelMarkupPercent(carrier, equipment);
  if (percent == null) return null;
  return Math.round(fuel * (1 + percent / 100) * 100) / 100;
}

/**
 * @param {number | null} percent
 * @param {boolean} [dynamic]
 */
export function markupLabel(percent, dynamic = false) {
  if (dynamic) return "Pass through";
  if (percent == null || !Number.isFinite(percent)) return "Not set";
  if (percent === 0) return "Pass through";
  return `${percent}%`;
}

/**
 * General markup, then each carrier in list order.
 * @returns {(LtlMarkupRow & { general?: boolean })[]}
 */
export function ltlMarkupCatalog() {
  const fuelByCarrier = new Map(LTL_FUEL_ROWS.map((row) => [carrierKey(row.carrier), row.percent]));
  const freightNames = new Set(LTL_CARRIER_ROWS.map((row) => carrierKey(row.name)));
  return [
    {
      name: "General",
      percent: LTL_GENERAL_MARKUP,
      fuelPercent: LTL_GENERAL_FUEL_MARKUP,
      equipment: "LTL",
      general: true,
    },
    ...LTL_CARRIER_ROWS.map((row) => ({
      ...row,
      equipment: "LTL",
      fuelPercent: row.dynamic
        ? null
        : fuelByCarrier.has(carrierKey(row.name))
          ? fuelByCarrier.get(carrierKey(row.name))
          : LTL_GENERAL_FUEL_MARKUP,
    })),
    ...LTL_FUEL_ROWS.filter((row) => !freightNames.has(carrierKey(row.carrier))).map((row) => ({
      name: row.carrier,
      percent: LTL_GENERAL_MARKUP,
      fuelPercent: row.percent,
      equipment: "LTL",
    })),
  ];
}
