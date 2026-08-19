/** @param {number} n */
export function fmtMoney(n) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** @param {number} n */
export function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}

/** @param {number} n */
export function fmtPct(n) {
  return `${n.toFixed(1)}%`;
}

/** @param {number} n */
export function fmtWeight(n) {
  return `${Math.round(n).toLocaleString("en-US")} lbs`;
}

/** @param {number} n */
export function fmtZscore(n) {
  const z = Number(n);
  if (!Number.isFinite(z)) return "Insufficient sample size";
  return `${z >= 0 ? "+" : ""}${z.toFixed(2)}`;
}

/**
 * @param {unknown} value
 * @param {string} [format]
 */
export function formatCell(value, format) {
  if (format === "money" || format === "money2") return fmtMoney(Number(value));
  if (format === "pct") return fmtPct(Number(value));
  if (format === "int") return fmtInt(Number(value));
  if (format === "weight") return fmtWeight(Number(value));
  if (format === "zscore") {
    if (value == null || value === "") return "Insufficient sample size";
    return fmtZscore(Number(value));
  }
  return String(value ?? "");
}
