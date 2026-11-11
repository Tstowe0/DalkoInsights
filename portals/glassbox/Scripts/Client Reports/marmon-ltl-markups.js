/**
 * LTL market markup, as a percent of that shipment's linehaul
 * (SELL FREIGHT1 + SELL FREIGHT2).
 *
 * 15 means Market Linehaul Spend = linehaul × 1.15.
 * Names match CARRIER NAME1. Matching ignores case and extra spaces.
 * A carrier with no percent here uses LTL_GENERAL_MARKUP.
 * Leave the general markup null until that percent is set. Those loads stay blank.
 * TL loads do not use this list.
 */

/** @type {number | null} */
export const LTL_GENERAL_MARKUP = null;

/** @type {Record<string, number | null>} */
export const LTL_CARRIER_MARKUPS = {
  "R&L CARRIERS": null,
  "FEDEX FREIGHT - PRIORITY": null,
  "XPO LOGISTICS FREIGHT INC": null,
  "ABF FREIGHT SYSTEM INC": null,
  "AVERITT EXPRESS": null,
  "MANITOULIN TRANSPORT": null,
  "SAIA LTL FREIGHT": null,
  "CENTRAL TRANSPORT INTERNATIONAL": null,
  "DAYTON FREIGHT LINES": null,
  "SOUTHWESTERN MOTOR TRANSPORT INC": null,
  "PITT OHIO EXPRESS": null,
  "WARD TRUCKING": null,
  "POLARIS TRANSPORT CARRIERS INC": null,
  "MAGNUM LTL INC": null,
  "PITTSBURGH-FAYETTE EXPRESS INC": null,
  "TFORCE FREIGHT": null,
  "OLD DOMINION FREIGHT LINE, INC": null,
};

/**
 * @param {unknown} name
 */
export function carrierKey(name) {
  return String(name ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

const LTL_MARKUP_INDEX = new Map(
  Object.entries(LTL_CARRIER_MARKUPS).map(([name, percent]) => [carrierKey(name), percent])
);

/**
 * Percent added to an LTL shipment's linehaul.
 * A listed percent wins. Any other carrier uses the general markup.
 * @param {unknown} carrier
 * @returns {number | null}
 */
export function ltlMarkupPercent(carrier) {
  const listed = LTL_MARKUP_INDEX.get(carrierKey(carrier));
  if (listed != null && Number.isFinite(listed)) return listed;
  return LTL_GENERAL_MARKUP != null && Number.isFinite(LTL_GENERAL_MARKUP) ? LTL_GENERAL_MARKUP : null;
}

/**
 * LTL market linehaul. Null when the shipment has no linehaul or no markup is set.
 * @param {number | null} freight
 * @param {unknown} carrier
 * @returns {number | null}
 */
export function ltlMarketLinehaul(freight, carrier) {
  const percent = ltlMarkupPercent(carrier);
  if (percent == null || freight == null || !Number.isFinite(freight)) return null;
  return Math.round(freight * (1 + percent / 100) * 100) / 100;
}

/**
 * @param {number | null} percent
 */
export function markupLabel(percent) {
  if (percent == null || !Number.isFinite(percent)) return "Not set";
  return `${percent}%`;
}

/**
 * General markup, then each carrier in list order.
 * @returns {{ name: string, percent: number | null, general?: boolean }[]}
 */
export function ltlMarkupCatalog() {
  return [
    { name: "General", percent: LTL_GENERAL_MARKUP, general: true },
    ...Object.entries(LTL_CARRIER_MARKUPS).map(([name, percent]) => ({ name, percent })),
  ];
}
