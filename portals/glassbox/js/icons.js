const ICON_BASE = new URL("../images/", import.meta.url);

/**
 * @param {string} relativePath e.g. "menuicons/Home.png"
 */
export function iconUrl(relativePath) {
  return new URL(relativePath, ICON_BASE).href;
}

/**
 * Menu icon for a nav label (matches Python ico/menuicons/{Label}.png).
 * @param {string} label
 */
export function menuIconUrl(label) {
  return iconUrl(`menuicons/${label}.png`);
}

/**
 * Tile icon for a tool label (matches Python ico/tileicons/{Tool Name}.png).
 * Special-cases known filename mismatches.
 * @param {string} label
 */
export function tileIconUrl(label) {
  if (label === "Currency Converter") {
    return new URL("../../../shared/images/currencyconverter.png", import.meta.url).href;
  }
  /** @type {Record<string, string>} */
  const aliases = {
    "DATs Weekly": "DATS Weekly.png",
    "Data Dump Merger": "Data Dump Breakdown.png",
  };
  const file = aliases[label] ?? `${label}.png`;
  return iconUrl(`tileicons/${file}`);
}
