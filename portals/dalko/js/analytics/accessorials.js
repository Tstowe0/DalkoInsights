import { getValue, safeFloat, monthKeyFromDateValue } from "../data/context.js";

/**
 * Index-based accessorial pairs (handles duplicate ACCESSORIALN headers).
 * Each type column pairs only with its nearest matching buy/sell amount column.
 * Each amount column is used at most once.
 * @param {unknown[]} headers
 * @returns {{ buyPairs: [number, number][], sellPairs: [number, number][] }}
 */
export function getAccessorialColumnPairs(headers) {
  /** @type {[number, string][]} */
  const typeIndices = [];
  /** @type {[number, string][]} */
  const buyAmountIndices = [];
  /** @type {[number, string][]} */
  const sellAmountIndices = [];

  headers.forEach((header, i) => {
    if (!header) return;
    const upper = String(header).trim().toUpperCase();

    let m = upper.match(/^ACCESSORIAL(\d+)$/);
    if (m && !upper.includes("BUY") && !upper.includes("SELL")) {
      typeIndices.push([i, m[1]]);
    } else if (upper.includes("BUY") && upper.includes("ACCESSORIAL")) {
      m = upper.match(/ACCESSORIAL(\d+)/);
      if (m) buyAmountIndices.push([i, m[1]]);
    } else if (upper.includes("SELL") && upper.includes("ACCESSORIAL")) {
      m = upper.match(/ACCESSORIAL(\d+)/);
      if (m) sellAmountIndices.push([i, m[1]]);
    }
  });

  /** @type {[number, number][]} */
  const buyPairs = [];
  /** @type {[number, number][]} */
  const sellPairs = [];
  const usedBuyAmt = new Set();
  const usedSellAmt = new Set();

  for (const [typeIdx, typeNum] of typeIndices) {
    let bestBuy = -1;
    let bestBuyDist = Infinity;
    for (const [amtIdx, amtNum] of buyAmountIndices) {
      if (amtNum !== typeNum || usedBuyAmt.has(amtIdx)) continue;
      const dist = Math.abs(typeIdx - amtIdx);
      if (dist < bestBuyDist && dist < 20) {
        bestBuyDist = dist;
        bestBuy = amtIdx;
      }
    }
    if (bestBuy >= 0) {
      buyPairs.push([typeIdx, bestBuy]);
      usedBuyAmt.add(bestBuy);
    }

    let bestSell = -1;
    let bestSellDist = Infinity;
    for (const [amtIdx, amtNum] of sellAmountIndices) {
      if (amtNum !== typeNum || usedSellAmt.has(amtIdx)) continue;
      const dist = Math.abs(typeIdx - amtIdx);
      if (dist < bestSellDist && dist < 20) {
        bestSellDist = dist;
        bestSell = amtIdx;
      }
    }
    if (bestSell >= 0) {
      sellPairs.push([typeIdx, bestSell]);
      usedSellAmt.add(bestSell);
    }
  }

  return { buyPairs, sellPairs };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} _maps
 * @param {unknown[]} headers
 */
export function calculateAccessorialTotals(rows, _maps, headers) {
  const { buyPairs, sellPairs } = getAccessorialColumnPairs(headers);
  let totalSell = 0;
  let totalBuy = 0;
  const loadsWith = new Set();

  for (const row of rows) {
    let rowHas = false;

    for (const [typeIdx, amtIdx] of sellPairs) {
      const type = row[typeIdx];
      if (type == null || type === "") continue;
      const s = String(type).trim();
      if (!s || s.toUpperCase() === "NONE" || s.toUpperCase() === "NULL") continue;
      const amountVal = row[amtIdx];
      if (amountVal == null) continue;
      const amount = safeFloat(amountVal);
      totalSell += amount;
      rowHas = true;
    }

    for (const [typeIdx, amtIdx] of buyPairs) {
      const type = row[typeIdx];
      if (type == null || type === "") continue;
      const s = String(type).trim();
      if (!s || s.toUpperCase() === "NONE" || s.toUpperCase() === "NULL") continue;
      const amountVal = row[amtIdx];
      if (amountVal == null) continue;
      const amount = safeFloat(amountVal);
      totalBuy += amount;
      rowHas = true;
    }

    if (rowHas) loadsWith.add(row);
  }

  return {
    totalSell,
    totalBuy,
    loadsWithAccessorials: loadsWith.size,
  };
}

/**
 * @typedef {{
 *   invoiceMonth: string | null,
 *   shipMonth: string | null,
 *   type: string,
 *   customer: string,
 *   sell: number,
 *   buy: number,
 *   buyCount: number,
 *   sellCount: number,
 * }} AccMonthFact
 */

/**
 * Aggregate month-level accessorial rows from type×customer facts.
 * @param {AccMonthFact[]} facts
 * @param {Set<string> | null} selectedTypes null = all types
 * @param {Set<string> | null} selectedCustomers null = all customers
 * @param {"invoice" | "ship"} [dateBasis="invoice"]
 */
export function aggregateMonthRows(
  facts,
  selectedTypes = null,
  selectedCustomers = null,
  dateBasis = "invoice"
) {
  /** @type {Record<string, { sell: number, buy: number, buyCount: number, sellCount: number }>} */
  const byMonth = {};
  for (const f of facts) {
    if (selectedTypes && !selectedTypes.has(f.type)) continue;
    if (selectedCustomers && !selectedCustomers.has(f.customer)) continue;
    const month =
      dateBasis === "ship"
        ? f.shipMonth
        : f.invoiceMonth ?? /** @type {{ month?: string }} */ (f).month ?? null;
    if (!month) continue;
    if (!byMonth[month]) byMonth[month] = { sell: 0, buy: 0, buyCount: 0, sellCount: 0 };
    const bucket = byMonth[month];
    bucket.sell += f.sell;
    bucket.buy += f.buy;
    bucket.buyCount += f.buyCount;
    bucket.sellCount += f.sellCount;
  }
  return Object.entries(byMonth)
    .map(([month, d]) => ({
      month,
      monthLabel: formatMonthLabel(month),
      sell: d.sell,
      buy: d.buy,
      net: d.sell - d.buy,
      buyCount: d.buyCount,
      sellCount: d.sellCount,
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * Position-based accessorial analysis (matches Python accessorials tab).
 * @param {unknown[][]} rows
 * @param {unknown[]} headers
 * @param {import("../data/context.js").HeaderMaps} maps
 */
export function analyzeAccessorialsByPosition(rows, headers, maps) {
  /** @type {Record<string, { sell: number, buy: number, buyCount: number, sellCount: number }>} */
  const byType = {};
  /** @type {Record<string, AccMonthFact>} */
  const monthFactMap = {};
  /** @type {Record<string, { sell: number, buy: number, loads: Set<unknown> }>} */
  const byCustomer = {};
  let totalSell = 0;
  let totalBuy = 0;
  const loadsWith = new Set();

  headers.forEach((header, colIdx) => {
    if (!header) return;
    const headerUpper = String(header).trim().toUpperCase();
    const match = headerUpper.match(/^ACCESSORIAL(\d+)$/);
    if (!match || headerUpper.includes("BUY") || headerUpper.includes("SELL")) return;

    const accNum = match[1];
    const amountColIdx = colIdx + 2;
    if (amountColIdx >= headers.length) return;
    const amountHeader = headers[amountColIdx];
    if (!amountHeader) return;
    const amountUpper = String(amountHeader).trim().toUpperCase();
    const isBuy = amountUpper.includes(`BUY ACCESSORIAL${accNum}`);
    const isSell = amountUpper.includes(`SELL ACCESSORIAL${accNum}`);
    if (!isBuy && !isSell) return;

    for (const row of rows) {
      const typeVal = row[colIdx];
      if (typeVal == null || typeVal === "") continue;
      const typeStr = String(typeVal).trim();
      if (!typeStr || ["NONE", "NULL"].includes(typeStr.toUpperCase())) continue;

      const amountVal = row[amountColIdx];
      if (amountVal == null) continue;
      const amount = safeFloat(amountVal);

      if (!byType[typeStr]) byType[typeStr] = { sell: 0, buy: 0, buyCount: 0, sellCount: 0 };

      const invoiceMonth = monthKeyFromDateValue(getValue(row, "INVOICE DATE", maps));
      const shipMonth = monthKeyFromDateValue(getValue(row, "ACTUAL SHIP DATE", maps));
      const client = String(getValue(row, "CLIENT NAME", maps) ?? "").trim() || "Unknown";
      if (!byCustomer[client]) byCustomer[client] = { sell: 0, buy: 0, loads: new Set() };

      /** @param {"buy" | "sell"} side */
      const bumpMonthFact = (side) => {
        if (!invoiceMonth && !shipMonth) return;
        const key = `${invoiceMonth ?? ""}\0${shipMonth ?? ""}\0${typeStr}\0${client}`;
        if (!monthFactMap[key]) {
          monthFactMap[key] = {
            invoiceMonth,
            shipMonth,
            type: typeStr,
            customer: client,
            sell: 0,
            buy: 0,
            buyCount: 0,
            sellCount: 0,
          };
        }
        const fact = monthFactMap[key];
        if (side === "buy") {
          fact.buy += amount;
          fact.buyCount += 1;
        } else {
          fact.sell += amount;
          fact.sellCount += 1;
        }
      };

      if (isBuy) {
        byType[typeStr].buy += amount;
        byType[typeStr].buyCount += 1;
        totalBuy += amount;
        loadsWith.add(row);
        byCustomer[client].buy += amount;
        byCustomer[client].loads.add(row);
        bumpMonthFact("buy");
      } else if (isSell) {
        byType[typeStr].sell += amount;
        byType[typeStr].sellCount += 1;
        totalSell += amount;
        loadsWith.add(row);
        byCustomer[client].sell += amount;
        byCustomer[client].loads.add(row);
        bumpMonthFact("sell");
      }
    }
  });

  const typeRows = Object.entries(byType)
    .map(([type, d]) => ({
      type,
      sell: d.sell,
      buy: d.buy,
      net: d.sell - d.buy,
      buyCount: d.buyCount,
      sellCount: d.sellCount,
    }))
    .sort((a, b) => b.sell + b.buy - (a.sell + a.buy));

  const customerRows = Object.entries(byCustomer)
    .map(([customer, d]) => {
      const loads = d.loads.size;
      const net = d.sell - d.buy;
      return {
        customer,
        sell: d.sell,
        buy: d.buy,
        net,
        loads,
        avgPerLoad: loads > 0 ? net / loads : 0,
      };
    })
    .sort((a, b) => b.sell + b.buy - (a.sell + a.buy))
    .slice(0, 30);

  /** @type {AccMonthFact[]} */
  const monthFacts = Object.values(monthFactMap);
  const monthRows = aggregateMonthRows(monthFacts, null, null, "invoice");
  const typeOptions = typeRows.map((r) => r.type);
  const customerOptions = Object.keys(byCustomer).sort((a, b) => a.localeCompare(b));

  return {
    hasAccessorialColumns: headers.some((h) =>
      String(h ?? "")
        .trim()
        .toUpperCase()
        .match(/^ACCESSORIAL\d+$/)
    ),
    kpis: {
      totalSell,
      totalBuy,
      net: totalSell - totalBuy,
      loadsWith: loadsWith.size,
      pct: rows.length ? (loadsWith.size / rows.length) * 100 : 0,
    },
    typeRows,
    customerRows,
    monthRows,
    monthFacts,
    typeOptions,
    customerOptions,
  };
}

/** @param {string} yyyyMm */
export function formatMonthLabel(yyyyMm) {
  const [y, m] = yyyyMm.split("-");
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const mi = Number(m) - 1;
  if (!y || mi < 0 || mi > 11) return yyyyMm;
  return `${names[mi]} ${y}`;
}

/**
 * @param {unknown[]} row
 * @param {unknown[]} headers
 * @param {import("../data/context.js").HeaderMaps} _maps
 * @param {string} focusValue
 */
export function rowMatchesAccessorialType(row, headers, _maps, focusValue) {
  const focus = String(focusValue ?? "").trim();
  if (!focus) return false;
  for (let colIdx = 0; colIdx < headers.length; colIdx++) {
    const header = headers[colIdx];
    if (!header) continue;
    const headerUpper = String(header).trim().toUpperCase();
    if (!headerUpper.match(/^ACCESSORIAL\d+$/) || headerUpper.includes("BUY") || headerUpper.includes("SELL")) {
      continue;
    }
    const typeVal = row[colIdx];
    if (typeVal == null || typeVal === "") continue;
    const typeStr = String(typeVal).trim();
    if (typeStr === focus) return true;
    // Truncated display names (≤35 chars with ellipsis in some exports)
    if (focus.length >= 35 && typeStr.startsWith(focus.slice(0, 35))) return true;
  }
  return false;
}
