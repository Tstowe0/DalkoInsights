import { getValue, safeFloat, monthKeyFromDateValue } from "../data/context.js";
import { analyzeAccessorialsByPosition } from "./accessorials.js";

const MIN_LOADS_FOR_Z_SCORE = 10;

/** @param {unknown} value */
function entityKey(value) {
  const s = String(value ?? "").trim();
  return s || "Unknown";
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 * @param {unknown[]} headers
 */
export function runAnalysis(rows, maps, headers) {
  const accessorials = analyzeAccessorialsByPosition(rows, headers, maps);
  return {
    executive: analyzeExecutive(rows, maps, accessorials.kpis),
    customers: analyzeCustomers(rows, maps),
    carriers: analyzeCarriers(rows, maps),
    salesReps: analyzeSalesReps(rows, maps),
    officeDivision: analyzeOfficeDivision(rows, maps),
    ltl: analyzeEquipment(rows, maps, true),
    truckload: analyzeEquipment(rows, maps, false),
    lanes: analyzeLanes(rows, maps),
    geographic: analyzeGeographic(rows, maps),
    financial: analyzeFinancial(rows, maps),
    accessorials,
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 * @param {{ totalSell: number, totalBuy: number, net: number, loadsWith: number, pct: number }} accKpis
 */
function analyzeExecutive(rows, maps, accKpis) {
  let totalRevenue = 0;
  let totalCost = 0;
  let totalProfit = 0;
  let invoicedCount = 0;
  let totalMiles = 0;
  const uniqueCustomers = new Set();
  const uniqueCarriers = new Set();
  const uniqueLanes = new Set();
  /** @type {Record<string, number>} */
  const statusCounts = {};
  let ltlLoads = 0;
  let truckloadLoads = 0;
  let otherLoads = 0;

  for (const row of rows) {
    const revenue = safeFloat(getValue(row, "TOTAL RECEIVABLE AMOUNT", maps));
    const cost = safeFloat(getValue(row, "TOTAL PAYABLE AMOUNT", maps));
    const profit = safeFloat(getValue(row, "PROFIT", maps));
    const miles = safeFloat(getValue(row, "Total Miles", maps));
    const status = String(getValue(row, "STATUS", maps) ?? "UNKNOWN");

    totalRevenue += revenue;
    totalCost += cost;
    totalProfit += profit;
    totalMiles += miles;
    if (status === "INVOICED") invoicedCount++;
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;

    const customer = getValue(row, "CLIENT NAME", maps);
    if (customer) uniqueCustomers.add(String(customer));
    const carrier = getValue(row, "CARRIER NAME1", maps);
    if (carrier) uniqueCarriers.add(String(carrier));

    const origin = getValue(row, "ORIGIN STATE", maps);
    const dest = getValue(row, "DESTINATION STATE", maps);
    if (origin && dest) {
      const lane = `${String(origin).trim().toUpperCase()} → ${String(dest).trim().toUpperCase()}`;
      uniqueLanes.add(lane);
    }

    const equip = entityKey(getValue(row, "EQUIPMENT", maps)).toUpperCase();
    if (equip.includes("LTL")) ltlLoads++;
    else if (equip !== "UNKNOWN") truckloadLoads++;
    else otherLoads++;
  }

  const totalLoads = rows.length;
  const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  const bestCarrier = computeBestCarrierZScore(rows, maps);

  const kpis = [
    { label: "Total revenue", value: totalRevenue, format: "money", sub: "Sell-side receivables", tone: "accent" },
    { label: "Gross profit", value: totalProfit, format: "money", sub: `${margin.toFixed(1)}% margin`, tone: "yellow" },
    { label: "Total cost", value: totalCost, format: "money", sub: "Buy-side payables", tone: "red" },
    { label: "Total loads", value: totalLoads, format: "int", sub: `${invoicedCount.toLocaleString()} invoiced`, tone: "blue" },
    {
      label: "Avg profit/load",
      value: totalLoads ? totalProfit / totalLoads : 0,
      format: "money",
      sub: "Per shipment",
      tone: "accent",
    },
    { label: "Profit margin", value: margin, format: "pct", sub: "Overall margin", tone: "yellow" },
    {
      label: "Total miles",
      value: totalMiles,
      format: "int",
      sub: totalLoads ? `Avg: ${Math.round(totalMiles / totalLoads)}/load` : "",
      tone: "blue",
    },
    { label: "Unique customers", value: uniqueCustomers.size, format: "int", sub: "Active customers", tone: "purple" },
    { label: "Unique carriers", value: uniqueCarriers.size, format: "int", sub: "Active carriers", tone: "blue" },
    {
      label: "Best performing carrier",
      value: bestCarrier.name ?? "—",
      format: "text",
      sub: bestCarrier.sub,
      tone: "accent",
      custom: true,
    },
    {
      label: "% LTLs",
      value: totalLoads ? (ltlLoads / totalLoads) * 100 : 0,
      format: "pct",
      sub: `${ltlLoads.toLocaleString()} loads`,
      tone: "purple",
    },
    {
      label: "% Truckloads",
      value: totalLoads ? (truckloadLoads / totalLoads) * 100 : 0,
      format: "pct",
      sub: `${truckloadLoads.toLocaleString()} loads`,
      tone: "blue",
    },
  ];

  const statusBreakdown = Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({
      status,
      count,
      pct: totalLoads ? (count / totalLoads) * 100 : 0,
    }));

  const monthly = buildMonthlyMetrics(rows, maps);
  const marginScore = Math.min(100, Math.max(0, Math.round(margin * 4)));
  const marginLabel =
    marginScore >= 80 ? "Excellent" : marginScore >= 60 ? "Strong" : marginScore >= 40 ? "Fair" : "Watch";

  const customerPreview = analyzeCustomers(rows, maps).rows.slice(0, 8);
  const carrierPreview = analyzeCarriers(rows, maps).profitability.rows.slice(0, 5);
  const lanePreview = analyzeLanes(rows, maps);

  const heroMetrics = [
    {
      label: "Total revenue",
      value: totalRevenue,
      format: "money",
      delta: monthly.revenueTrend,
      spark: monthly.revenueSeries,
    },
    {
      label: "Gross profit",
      value: totalProfit,
      format: "money",
      delta: monthly.profitTrend,
      spark: monthly.profitSeries,
    },
    {
      label: "Total loads",
      value: totalLoads,
      format: "int",
      delta: monthly.loadsTrend,
      spark: monthly.loadsSeries,
    },
    {
      label: "Profit margin",
      value: margin,
      format: "pct",
      delta: monthly.marginTrend,
      spark: monthly.marginSeries,
    },
    {
      label: "Margin score",
      value: marginScore,
      format: "score",
      sub: marginLabel,
      score: marginScore,
    },
  ];

  return {
    kpis,
    statusBreakdown,
    accessorialSummary: {
      net: accKpis.net,
      loadsPct: accKpis.pct,
    },
    bestCarrier,
    heroMetrics,
    monthlyChart: monthly.chart,
    topCustomers: customerPreview,
    topCarriers: carrierPreview,
    topLanes: lanePreview.table.rows.slice(0, 6),
    equipmentSplit: { ltl: ltlLoads, truckload: truckloadLoads, other: otherLoads },
    summary: {
      totalRevenue,
      totalProfit,
      totalLoads,
      avgProfitPerLoad: totalLoads ? totalProfit / totalLoads : 0,
      margin,
      totalMiles,
    },
    marginScore,
    marginLabel,
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 */
function buildMonthlyMetrics(rows, maps) {
  /** @type {Record<string, { revenue: number, profit: number, loads: number }>} */
  const byMonth = {};
  for (const row of rows) {
    const mk = monthKeyFromDateValue(getValue(row, "INVOICE DATE", maps));
    if (!mk) continue;
    if (!byMonth[mk]) byMonth[mk] = { revenue: 0, profit: 0, loads: 0 };
    byMonth[mk].revenue += safeFloat(getValue(row, "TOTAL RECEIVABLE AMOUNT", maps));
    byMonth[mk].profit += safeFloat(getValue(row, "PROFIT", maps));
    byMonth[mk].loads += 1;
  }
  const sorted = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]));
  const last12 = sorted.slice(-12);
  const labels = last12.map(([m]) => {
    const [y, mo] = m.split("-");
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[parseInt(mo, 10) - 1] ?? mo} '${y.slice(2)}`;
  });
  const revenue = last12.map(([, d]) => d.revenue);
  const profit = last12.map(([, d]) => d.profit);
  const loads = last12.map(([, d]) => d.loads);
  const margin = last12.map(([, d]) => (d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0));

  function trend(arr) {
    if (arr.length < 2) return 0;
    const a = arr[arr.length - 2];
    const b = arr[arr.length - 1];
    if (a === 0) return b > 0 ? 100 : 0;
    return ((b - a) / Math.abs(a)) * 100;
  }

  return {
    chart: { labels, revenue, profit },
    revenueSeries: revenue,
    profitSeries: profit,
    loadsSeries: loads,
    marginSeries: margin,
    revenueTrend: trend(revenue),
    profitTrend: trend(profit),
    loadsTrend: trend(loads),
    marginTrend: trend(margin),
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 */
function computeBestCarrierZScore(rows, maps) {
  /** @type {Record<string, { onTime: number, late: number, total: number }>} */
  const perf = {};

  for (const row of rows) {
    const carrier = entityKey(getValue(row, "CARRIER NAME1", maps));
    const actual = getValue(row, "ACTUAL TRANSIT DAYS", maps);
    const expected = getValue(row, "EXPECTED TRANSIT DAYS", maps);
    if (actual == null || expected == null) continue;
    const actualDays = safeFloat(actual);
    const expectedDays = safeFloat(expected);
    if (!perf[carrier]) perf[carrier] = { onTime: 0, late: 0, total: 0 };
    perf[carrier].total++;
    if (actualDays <= expectedDays) perf[carrier].onTime++;
    else perf[carrier].late++;
  }

  let totalOnTime = 0;
  let totalWithData = 0;
  for (const p of Object.values(perf)) {
    totalOnTime += p.onTime;
    totalWithData += p.total;
  }

  let bestName = null;
  let bestZ = null;
  let bestLoads = 0;
  let bestLate = 0;

  for (const [carrier, p] of Object.entries(perf)) {
    const loadCount = p.total;
    if (loadCount < MIN_LOADS_FOR_Z_SCORE || totalWithData <= loadCount) continue;

    const othersOnTime = totalOnTime - p.onTime;
    const othersTotal = totalWithData - loadCount;
    if (othersTotal <= 0 || loadCount <= 0) continue;

    const pOthers = othersOnTime / othersTotal;
    const pCarrier = p.onTime / loadCount;
    if (pOthers <= 0 || pOthers >= 1) continue;

    const stdError = Math.sqrt((pOthers * (1 - pOthers)) / loadCount);
    if (stdError <= 0) continue;

    const z = (pCarrier - pOthers) / stdError;
    if (bestZ == null || z > bestZ) {
      bestZ = z;
      bestName = carrier;
      bestLoads = loadCount;
      bestLate = p.late;
    }
  }

  if (bestName == null || bestZ == null) {
    return { name: null, sub: "Insufficient transit data", z: null, loads: 0, late: 0 };
  }
  const zFormatted = `${bestZ >= 0 ? "+" : ""}${bestZ.toFixed(2)}`;
  return {
    name: bestName,
    z: bestZ,
    loads: bestLoads,
    late: bestLate,
    sub: `Z ${zFormatted} · Loads ${bestLoads.toLocaleString()} · Late ${bestLate.toLocaleString()}`,
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 */
function analyzeCustomers(rows, maps) {
  /** @type {Record<string, { revenue: number, cost: number, profit: number, loads: number }>} */
  const data = {};
  for (const row of rows) {
    const client = entityKey(getValue(row, "CLIENT NAME", maps));
    if (!data[client]) data[client] = { revenue: 0, cost: 0, profit: 0, loads: 0 };
    data[client].revenue += safeFloat(getValue(row, "TOTAL RECEIVABLE AMOUNT", maps));
    data[client].cost += safeFloat(getValue(row, "TOTAL PAYABLE AMOUNT", maps));
    data[client].profit += safeFloat(getValue(row, "PROFIT", maps));
    data[client].loads++;
  }
  return {
    focusColumn: "CLIENT NAME",
    columns: ["Customer", "Revenue", "Cost", "Profit", "Margin %", "Loads", "Avg profit/load"],
    rows: Object.entries(data)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 50)
      .map(([name, d]) => ({
        focusValue: name,
        cells: [
          name.length > 40 ? `${name.slice(0, 37)}…` : name,
          d.revenue,
          d.cost,
          d.profit,
          d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0,
          d.loads,
          d.loads ? d.profit / d.loads : 0,
        ],
        formats: ["text", "money", "money", "money", "pct", "int", "money"],
      })),
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 */
function analyzeSalesReps(rows, maps) {
  /** @type {Record<string, { revenue: number, cost: number, profit: number, loads: number, customers: Set<string> }>} */
  const data = {};
  for (const row of rows) {
    const rep = entityKey(getValue(row, "SALES REP", maps));
    if (!data[rep]) data[rep] = { revenue: 0, cost: 0, profit: 0, loads: 0, customers: new Set() };
    data[rep].revenue += safeFloat(getValue(row, "TOTAL RECEIVABLE AMOUNT", maps));
    data[rep].cost += safeFloat(getValue(row, "TOTAL PAYABLE AMOUNT", maps));
    data[rep].profit += safeFloat(getValue(row, "PROFIT", maps));
    data[rep].loads++;
    const c = getValue(row, "CLIENT NAME", maps);
    if (c) data[rep].customers.add(String(c));
  }
  return {
    focusColumn: "SALES REP",
    columns: ["Sales rep", "Revenue", "Cost", "Profit", "Margin %", "Loads", "Customers", "Avg profit/load"],
    rows: Object.entries(data)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([name, d]) => ({
        focusValue: name,
        cells: [
          name.length > 35 ? `${name.slice(0, 32)}…` : name,
          d.revenue,
          d.cost,
          d.profit,
          d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0,
          d.loads,
          d.customers.size,
          d.loads ? d.profit / d.loads : 0,
        ],
        formats: ["text", "money", "money", "money", "pct", "int", "int", "money"],
      })),
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 */
function analyzeCarriers(rows, maps) {
  /** @type {Record<string, { revenue: number, cost: number, loads: number, miles: number }>} */
  const data = {};
  /** @type {Record<string, { onTime: number, late: number, total: number }>} */
  const perf = {};

  for (const row of rows) {
    const carrier = entityKey(getValue(row, "CARRIER NAME1", maps));
    if (!data[carrier]) data[carrier] = { revenue: 0, cost: 0, loads: 0, miles: 0 };
    data[carrier].revenue += safeFloat(getValue(row, "TOTAL RECEIVABLE AMOUNT", maps));
    data[carrier].cost += safeFloat(getValue(row, "TOTAL PAYABLE AMOUNT", maps));
    data[carrier].loads++;
    data[carrier].miles += safeFloat(getValue(row, "Total Miles", maps));

    const actual = getValue(row, "ACTUAL TRANSIT DAYS", maps);
    const expected = getValue(row, "EXPECTED TRANSIT DAYS", maps);
    if (actual != null && expected != null) {
      if (!perf[carrier]) perf[carrier] = { onTime: 0, late: 0, total: 0 };
      perf[carrier].total++;
      const a = safeFloat(actual);
      const e = safeFloat(expected);
      if (a <= e) perf[carrier].onTime++;
      else perf[carrier].late++;
    }
  }

  let totalOnTime = 0;
  let totalWithData = 0;
  for (const p of Object.values(perf)) {
    totalOnTime += p.onTime;
    totalWithData += p.total;
  }

  const profitability = {
    focusColumn: "CARRIER NAME1",
    columns: [
      "Carrier",
      "Revenue",
      "Cost",
      "Profit",
      "Margin %",
      "Loads",
      "Total miles",
      "Revenue/mile",
      "Cost/mile",
      "Profit/mile",
    ],
    rows: Object.entries(data)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 50)
      .map(([name, d]) => {
        const profit = d.revenue - d.cost;
        return {
          focusValue: name,
          cells: [
            name.length > 40 ? `${name.slice(0, 37)}…` : name,
            d.revenue,
            d.cost,
            profit,
            d.revenue > 0 ? (profit / d.revenue) * 100 : 0,
            d.loads,
            d.miles,
            d.miles > 0 ? d.revenue / d.miles : 0,
            d.miles > 0 ? d.cost / d.miles : 0,
            d.miles > 0 ? profit / d.miles : 0,
          ],
          formats: ["text", "money", "money", "money", "pct", "int", "int", "money2", "money2", "money2"],
        };
      }),
  };

  const performance = {
    focusColumn: "CARRIER NAME1",
    columns: ["Carrier", "On time %", "Z-score", "On time loads", "Late loads", "Loads w/ transit"],
    rows: Object.entries(perf)
      .map(([name, p]) => {
        const onTimePct = p.total ? (p.onTime / p.total) * 100 : 0;
        /** @type {number | null} */
        let zScore = null;
        const loadCount = p.total;
        if (loadCount >= MIN_LOADS_FOR_Z_SCORE && totalWithData > loadCount) {
          const othersOnTime = totalOnTime - p.onTime;
          const othersTotal = totalWithData - loadCount;
          if (othersTotal > 0 && loadCount > 0) {
            const pOthers = othersOnTime / othersTotal;
            const pCarrier = p.onTime / loadCount;
            if (pOthers > 0 && pOthers < 1) {
              const stdError = Math.sqrt((pOthers * (1 - pOthers)) / loadCount);
              if (stdError > 0) {
                zScore = (pCarrier - pOthers) / stdError;
              }
            }
          }
        }
        return {
          focusValue: name,
          cells: [name.length > 40 ? `${name.slice(0, 37)}…` : name, onTimePct, zScore, p.onTime, p.late, p.total],
          formats: ["text", "pct", "zscore", "int", "int", "int"],
        };
      })
      .sort((a, b) => {
        const za = /** @type {number | null} */ (a.cells[2]);
        const zb = /** @type {number | null} */ (b.cells[2]);
        if (za == null && zb == null) return Number(b.cells[1]) - Number(a.cells[1]);
        if (za == null) return 1;
        if (zb == null) return -1;
        return zb - za;
      }),
  };

  return { profitability, performance };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 */
function analyzeOfficeDivision(rows, maps) {
  const division = aggregateSimple(rows, maps, "DIVISION");
  const office = aggregateSimple(rows, maps, "OFFICE");
  return {
    division: tableFromAggregate(division, "DIVISION", "Division"),
    office: tableFromAggregate(office, "OFFICE", "Office"),
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 * @param {string} field
 */
function aggregateSimple(rows, maps, field) {
  /** @type {Record<string, { revenue: number, cost: number, profit: number, loads: number, miles: number }>} */
  const data = {};
  for (const row of rows) {
    const key = entityKey(getValue(row, field, maps));
    if (!data[key]) data[key] = { revenue: 0, cost: 0, profit: 0, loads: 0, miles: 0 };
    data[key].revenue += safeFloat(getValue(row, "TOTAL RECEIVABLE AMOUNT", maps));
    data[key].cost += safeFloat(getValue(row, "TOTAL PAYABLE AMOUNT", maps));
    data[key].profit += safeFloat(getValue(row, "PROFIT", maps));
    data[key].loads++;
    data[key].miles += safeFloat(getValue(row, "Total Miles", maps));
  }
  return data;
}

/**
 * @param {Record<string, { revenue: number, cost: number, profit: number, loads: number, miles: number }>} data
 * @param {string} focusColumn
 * @param {string} labelCol
 */
function tableFromAggregate(data, focusColumn, labelCol) {
  return {
    focusColumn,
    columns: [labelCol, "Revenue", "Cost", "Profit", "Margin %", "Loads", "Miles", "Avg profit/load"],
    rows: Object.entries(data)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([name, d]) => ({
        focusValue: name,
        cells: [
          name,
          d.revenue,
          d.cost,
          d.profit,
          d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0,
          d.loads,
          d.miles,
          d.loads ? d.profit / d.loads : 0,
        ],
        formats: ["text", "money", "money", "money", "pct", "int", "int", "money"],
      })),
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 * @param {boolean} ltlOnly
 */
function analyzeEquipment(rows, maps, ltlOnly) {
  /** @type {Record<string, { revenue: number, cost: number, profit: number, loads: number, miles: number }>} */
  const data = {};
  for (const row of rows) {
    const equip = entityKey(getValue(row, "EQUIPMENT", maps));
    const equipUpper = equip.toUpperCase();
    const isLtl = equipUpper.includes("LTL");
    if (ltlOnly) {
      if (!isLtl) continue;
    } else if (isLtl || equipUpper === "UNKNOWN") {
      continue;
    }
    if (!data[equip]) data[equip] = { revenue: 0, cost: 0, profit: 0, loads: 0, miles: 0 };
    data[equip].revenue += safeFloat(getValue(row, "TOTAL RECEIVABLE AMOUNT", maps));
    data[equip].cost += safeFloat(getValue(row, "TOTAL PAYABLE AMOUNT", maps));
    data[equip].profit += safeFloat(getValue(row, "PROFIT", maps));
    data[equip].loads++;
    data[equip].miles += safeFloat(getValue(row, "Total Miles", maps));
  }

  const totalRevenue = Object.values(data).reduce((s, d) => s + d.revenue, 0);
  const totalProfit = Object.values(data).reduce((s, d) => s + d.profit, 0);
  const totalLoads = Object.values(data).reduce((s, d) => s + d.loads, 0);
  const top = Object.entries(data).sort((a, b) => b[1].loads - a[1].loads)[0];

  return {
    kpis: [
      {
        label: ltlOnly ? "LTL types" : "Truckload types",
        value: Object.keys(data).length,
        format: "int",
        sub: "Unique equipment types",
      },
      { label: "Total revenue", value: totalRevenue, format: "money", sub: ltlOnly ? "LTL revenue" : "Truckload revenue" },
      {
        label: "Total profit",
        value: totalProfit,
        format: "money",
        sub: totalRevenue > 0 ? `${((totalProfit / totalRevenue) * 100).toFixed(1)}% margin` : "",
      },
      {
        label: "Total loads",
        value: totalLoads,
        format: "int",
        sub: top ? `Top: ${top[0]}`.slice(0, 25) : "",
      },
    ],
    table: {
      focusColumn: "EQUIPMENT",
      columns: ["Equipment", "Revenue", "Cost", "Profit", "Margin %", "Loads", "Miles", "Avg profit/load"],
      rows: Object.entries(data)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([name, d]) => ({
          focusValue: name,
          cells: [
            name,
            d.revenue,
            d.cost,
            d.profit,
            d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0,
            d.loads,
            d.miles,
            d.loads ? d.profit / d.loads : 0,
          ],
          formats: ["text", "money", "money", "money", "pct", "int", "int", "money"],
        })),
    },
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 */
function analyzeLanes(rows, maps) {
  /** @type {Record<string, { revenue: number, cost: number, profit: number, loads: number, miles: number }>} */
  const data = {};
  for (const row of rows) {
    const o = getValue(row, "ORIGIN STATE", maps);
    const d = getValue(row, "DESTINATION STATE", maps);
    if (!o || !d) continue;
    const lane = `${String(o).trim().toUpperCase()} → ${String(d).trim().toUpperCase()}`;
    if (!data[lane]) data[lane] = { revenue: 0, cost: 0, profit: 0, loads: 0, miles: 0 };
    data[lane].revenue += safeFloat(getValue(row, "TOTAL RECEIVABLE AMOUNT", maps));
    data[lane].cost += safeFloat(getValue(row, "TOTAL PAYABLE AMOUNT", maps));
    data[lane].profit += safeFloat(getValue(row, "PROFIT", maps));
    data[lane].loads++;
    data[lane].miles += safeFloat(getValue(row, "Total Miles", maps));
  }

  const entries = Object.entries(data);
  const totalRevenue = entries.reduce((s, [, d]) => s + d.revenue, 0);
  const totalProfit = entries.reduce((s, [, d]) => s + d.profit, 0);
  const topByLoads = entries.sort((a, b) => b[1].loads - a[1].loads)[0];

  return {
    kpis: [
      { label: "Total lanes", value: entries.length, format: "int", sub: "Unique state pairs" },
      { label: "Total lane revenue", value: totalRevenue, format: "money", sub: "Across all lanes" },
      { label: "Total lane profit", value: totalProfit, format: "money", sub: "Across all lanes" },
      {
        label: "Top lane by loads",
        value: topByLoads ? topByLoads[0] : "N/A",
        format: "text",
        sub: topByLoads ? `${topByLoads[1].loads.toLocaleString()} loads` : "",
      },
    ],
    table: {
      focusColumn: "LANE",
      columns: [
        "Lane",
        "Loads",
        "Revenue",
        "Cost",
        "Profit",
        "Margin %",
        "Avg miles",
        "Revenue/mile",
        "Cost/mile",
        "Profit/mile",
        "Avg profit/load",
      ],
      rows: entries
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([lane, d]) => ({
          focusValue: lane,
          cells: [
            lane,
            d.loads,
            d.revenue,
            d.cost,
            d.profit,
            d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0,
            d.loads ? d.miles / d.loads : 0,
            d.miles > 0 ? d.revenue / d.miles : 0,
            d.miles > 0 ? d.cost / d.miles : 0,
            d.miles > 0 ? d.profit / d.miles : 0,
            d.loads ? d.profit / d.loads : 0,
          ],
          formats: ["text", "int", "money", "money", "money", "pct", "int", "money2", "money2", "money2", "money"],
        })),
    },
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 */
function analyzeGeographic(rows, maps) {
  const origin = stateAggregate(rows, maps, "ORIGIN STATE");
  const dest = stateAggregate(rows, maps, "DESTINATION STATE");
  return { origin, dest };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 * @param {"ORIGIN STATE" | "DESTINATION STATE"} col
 */
function stateAggregate(rows, maps, col) {
  /** @type {Record<string, { loads: number, revenue: number, weight: number, miles: number }>} */
  const data = {};
  for (const row of rows) {
    const state = getValue(row, col, maps);
    if (!state || !String(state).trim()) continue;
    const s = String(state).trim().toUpperCase();
    if (!data[s]) data[s] = { loads: 0, revenue: 0, weight: 0, miles: 0 };
    data[s].loads++;
    data[s].revenue += safeFloat(getValue(row, "TOTAL RECEIVABLE AMOUNT", maps));
    data[s].weight += safeFloat(getValue(row, "Total Wt.", maps));
    data[s].miles += safeFloat(getValue(row, "Total Miles", maps));
  }
  const focusColumn = col;
  return {
    focusColumn,
    title: col === "ORIGIN STATE" ? "Origin states" : "Destination states",
    columns: ["State", "Loads", "Revenue", "Avg miles", "Total weight"],
    rows: Object.entries(data)
      .sort((a, b) => b[1].loads - a[1].loads)
      .map(([state, d]) => ({
        focusValue: state,
        cells: [state, d.loads, d.revenue, d.loads ? d.miles / d.loads : 0, d.weight],
        formats: ["text", "int", "money", "int", "weight"],
      })),
  };
}

/**
 * @param {unknown[][]} rows
 * @param {import("../data/context.js").HeaderMaps} maps
 */
function analyzeFinancial(rows, maps) {
  let totalOutstanding = 0;
  let totalReceived = 0;
  let paidCount = 0;
  let unpaidCount = 0;
  /** @type {number[]} */
  const daysToPay = [];
  /** @type {Record<string, { revenue: number, cost: number, profit: number, loads: number }>} */
  const monthly = {};

  for (const row of rows) {
    const balance = safeFloat(getValue(row, "BALANCE DUE", maps));
    const received = safeFloat(getValue(row, "RECEIVED AMOUNT", maps));
    totalOutstanding += balance;
    totalReceived += received;
    if (balance > 0) unpaidCount++;
    else paidCount++;

    const dtp = getValue(row, "DAYS TO PAY", maps);
    if (dtp != null && dtp !== "") {
      const n = parseInt(String(dtp), 10);
      if (!Number.isNaN(n)) daysToPay.push(n);
    }

    const mk = monthKeyFromDateValue(getValue(row, "INVOICE DATE", maps));
    if (mk) {
      if (!monthly[mk]) monthly[mk] = { revenue: 0, cost: 0, profit: 0, loads: 0 };
      monthly[mk].revenue += safeFloat(getValue(row, "TOTAL RECEIVABLE AMOUNT", maps));
      monthly[mk].cost += safeFloat(getValue(row, "TOTAL PAYABLE AMOUNT", maps));
      monthly[mk].profit += safeFloat(getValue(row, "PROFIT", maps));
      monthly[mk].loads++;
    }
  }

  const totalInvoices = paidCount + unpaidCount;
  const avgDays = daysToPay.length ? daysToPay.reduce((a, b) => a + b, 0) / daysToPay.length : 0;
  const paymentRate = totalInvoices ? (paidCount / totalInvoices) * 100 : 0;

  return {
    kpis: [
      { label: "Outstanding balance", value: totalOutstanding, format: "money", sub: "Unpaid receivables" },
      { label: "Total received", value: totalReceived, format: "money", sub: "Payments collected" },
      { label: "Paid invoices", value: paidCount, format: "int", sub: `${paymentRate.toFixed(1)}% payment rate` },
      { label: "Unpaid invoices", value: unpaidCount, format: "int", sub: "Outstanding" },
      { label: "Avg days to pay", value: avgDays, format: "int", sub: "Average payment time" },
      { label: "Total invoices", value: totalInvoices, format: "int", sub: "All invoices" },
    ],
    monthly: {
      columns: ["Month", "Revenue", "Cost", "Profit", "Margin %", "Loads"],
      rows: Object.entries(monthly)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([month, d]) => ({
          cells: [month, d.revenue, d.cost, d.profit, d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0, d.loads],
          formats: ["text", "money", "money", "money", "pct", "int"],
        })),
    },
  };
}
