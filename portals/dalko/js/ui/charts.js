/** Theme colors — CSS variables with midnight-gold fallbacks. */
const GOLD = "#d9ae42";
const GOLD_BRIGHT = "#f0c14a";
const GOLD_DEEP = "#b8922a";
const GOLD_ORANGE = "#e8a045";
const NAVY_BLUE = "#5a7fc4";
const NAVY_DEEP = "#243656";
const TRIM_STROKE = "#030508";

/** @param {string} name @param {string} fallback */
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function isCorporate() {
  return cssVar("--chart-style", "") === "corporate";
}

/** @param {string} color @param {number} alpha */
function withAlpha(color, alpha) {
  const c = color.trim();
  const hex = c.startsWith("#") ? c.slice(1) : "";
  if (hex.length === 3 || hex.length === 6) {
    const n = hex.length === 3 ? hex.split("").map((ch) => ch + ch).join("") : hex;
    return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}, ${alpha})`;
  }
  const rgb = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  return color;
}

function palette() {
  const accent = cssVar("--accent", GOLD);
  const accentBright = cssVar("--accent-bright", GOLD_BRIGHT);
  const accentOrange = cssVar("--accent-orange", GOLD_ORANGE);
  const accentBlue = cssVar("--accent-blue", NAVY_BLUE);
  return {
    accent,
    accentBright,
    accentDeep: cssVar("--accent-deep", GOLD_DEEP),
    accentOrange,
    accentBlue,
    navyDeep: cssVar("--chart-navy-deep", NAVY_DEEP),
    trim: cssVar("--chart-label-stroke", TRIM_STROKE),
    tick: cssVar("--chart-tick", "#9aa3b8"),
    grid: cssVar("--chart-grid", "rgba(255,255,255,0.05)"),
    tooltipBg: cssVar("--chart-tooltip-bg", "#101a2e"),
    tooltipTitle: cssVar("--chart-tooltip-title", "#ffffff"),
    tooltipBody: cssVar("--chart-tooltip-body", "#8b9cb8"),
    tooltipBorder: cssVar("--chart-tooltip-border", "rgba(217, 174, 66, 0.28)"),
    pointBorder: cssVar("--chart-point-border", "#0c1322"),
    text: cssVar("--text", GOLD_BRIGHT),
    danger: cssVar("--accent-red", "#ef6b6b"),
    barTop: withAlpha(accentBright, isCorporate() ? 0.88 : 0.95),
    barMid: withAlpha(accent, isCorporate() ? 0.72 : 0.92),
    barBot: withAlpha(accentOrange, isCorporate() ? 0.55 : 0.78),
    fillBlue: withAlpha(accentBlue, 0.12),
  };
}

/** @param {CanvasRenderingContext2D} ctx @param {string} text @param {number} x @param {number} y @param {string} font */
function drawGoldTrimmedLabel(ctx, text, x, y, font) {
  const p = palette();
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (isCorporate()) {
    ctx.fillStyle = p.text;
    ctx.fillText(text, x, y);
    return;
  }
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.25;
  ctx.strokeStyle = p.trim;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = p.accentBright;
  ctx.fillText(text, x, y);
}

/** @param {number[]} values @param {string} [stroke] */
export function sparklineSvg(values, stroke) {
  const line = stroke || palette().accentBright;
  if (!values.length) {
    return `<svg class="sparkline" viewBox="0 0 80 28" preserveAspectRatio="none"><path d="M0 14 H80" stroke="${line}" stroke-opacity="0.2" fill="none"/></svg>`;
  }
  const w = 80;
  const h = 28;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  const area = `M ${pts[0]} L ${pts.slice(1).join(" L ")} L ${w - pad},${h} L ${pad},${h} Z`;
  const gradId = `spark-${Math.random().toString(36).slice(2, 9)}`;
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${line}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${line}" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    <path class="spark-area" d="${area}" fill="url(#${gradId})"/>
    <polyline class="spark-line" points="${pts.join(" ")}" fill="none" stroke="${line}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Shared compact options for right-rail charts */
function railBaseOptions(/** @type {object} */ extra = {}) {
  const p = palette();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 550, easing: "easeOutQuart" },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: p.tooltipBg,
        titleColor: p.tooltipTitle,
        bodyColor: p.tooltipBody,
        borderColor: p.tooltipBorder,
        borderWidth: 1,
        padding: 8,
        cornerRadius: 8,
      },
    },
    ...extra,
  };
}

/** @param {string} label @param {number} maxLen */
function truncateRailLabel(label, maxLen = 18) {
  const s = String(label);
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ labels: string[], revenue: number[], profit: number[] }} data
 */
export function renderRailSummaryChart(canvas, data) {
  if (typeof Chart === "undefined") return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const n = 6;
  const labels = data.labels.slice(-n);
  const revenue = data.revenue.slice(-n);
  const profit = data.profit.slice(-n);
  if (!labels.length) return null;

  const p = palette();
  const goldGrad = ctx.createLinearGradient(0, 0, 0, 120);
  goldGrad.addColorStop(0, p.barTop);
  goldGrad.addColorStop(1, p.barBot);

  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Revenue",
          data: revenue,
          backgroundColor: goldGrad,
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: isCorporate() ? 28 : undefined,
          order: 2,
        },
        {
          label: "Profit",
          data: profit,
          type: "line",
          borderColor: p.accentBlue,
          backgroundColor: p.fillBlue,
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 2,
          pointBackgroundColor: p.accentBright,
          fill: true,
          order: 1,
        },
      ],
    },
    options: {
      ...railBaseOptions(),
      interaction: { mode: "index", intersect: false },
      plugins: {
        ...railBaseOptions().plugins,
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: p.tick,
            boxWidth: 8,
            font: { size: 9 },
            padding: 8,
          },
        },
        tooltip: {
          ...railBaseOptions().plugins?.tooltip,
          callbacks: {
            label: (ctx) => {
              const v = Number(ctx.raw);
              const formatted =
                v >= 1_000_000
                  ? `$${(v / 1_000_000).toFixed(2)}M`
                  : v >= 1_000
                    ? `$${(v / 1_000).toFixed(0)}k`
                    : `$${v.toFixed(0)}`;
              return ` ${ctx.dataset.label}: ${formatted}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: p.tick, font: { size: 8 }, maxRotation: 0, autoSkipPadding: 4 },
        },
        y: {
          grid: { color: p.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: p.tick,
            font: { size: 8 },
            maxTicksLimit: 4,
            callback: (v) => {
              const n = Number(v);
              if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
              if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
              return `$${n}`;
            },
          },
        },
      },
    },
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ name: string, revenue: number }[]} carriers
 */
export function renderRailCarriersChart(canvas, carriers) {
  return renderRailRankChart(
    canvas,
    carriers.map((c) => ({ name: c.name, value: c.revenue })),
    { valueLabel: "Revenue", format: "money" }
  );
}

/**
 * Horizontal rank bars for the right rail.
 * @param {HTMLCanvasElement} canvas
 * @param {{ name: string, value: number }[]} items
 * @param {{ valueLabel?: string, format?: "money" | "number" | "pct" }} [opts]
 */
export function renderRailRankChart(canvas, items, opts = {}) {
  if (typeof Chart === "undefined" || !items.length) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const p = palette();
  const valueLabel = opts.valueLabel ?? "Value";
  const format = opts.format ?? "money";
  const labels = items.map((c) => truncateRailLabel(c.name, 22));
  const values = items.map((c) => c.value);

  /** @param {number} v */
  const formatTip = (v) => {
    if (format === "pct") return `${v.toFixed(1)}%`;
    if (format === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
    return `$${v.toFixed(0)}`;
  };

  /** @param {number} v */
  const formatTick = (v) => {
    if (format === "pct") return `${Math.round(v)}%`;
    if (format === "number") {
      if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
      return String(Math.round(v));
    }
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
    return `$${Math.round(v)}`;
  };

  return new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: values.map((v) =>
            v < 0 ? withAlpha(p.danger, 0.85) : withAlpha(p.accentBright, 0.88)
          ),
          borderColor: p.accentBright,
          borderWidth: 0,
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    },
    options: {
      ...railBaseOptions(),
      indexAxis: "y",
      plugins: {
        ...railBaseOptions().plugins,
        tooltip: {
          ...railBaseOptions().plugins?.tooltip,
          callbacks: {
            title: (tipItems) => items[tipItems[0]?.dataIndex ?? 0]?.name ?? "",
            label: (ctx) => ` ${valueLabel}: ${formatTip(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: p.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: p.tick,
            font: { size: 8 },
            maxTicksLimit: 4,
            callback: (v) => formatTick(Number(v)),
          },
        },
        y: {
          grid: { display: false },
          ticks: { color: p.tick, font: { size: 8 } },
        },
      },
    },
  });
}

/**
 * Grouped sell vs buy bars for accessorial types.
 * @param {HTMLCanvasElement} canvas
 * @param {{ name: string, sell: number, buy: number }[]} rows
 */
export function renderRailSellBuyChart(canvas, rows) {
  if (typeof Chart === "undefined" || !rows.length) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const p = palette();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map((r) => truncateRailLabel(r.name, 14)),
      datasets: [
        {
          label: "Sell",
          data: rows.map((r) => r.sell),
          backgroundColor: withAlpha(p.accentBright, 0.9),
          borderRadius: 3,
          borderSkipped: false,
        },
        {
          label: "Buy",
          data: rows.map((r) => r.buy),
          backgroundColor: withAlpha(p.danger, 0.75),
          borderRadius: 3,
          borderSkipped: false,
        },
      ],
    },
    options: {
      ...railBaseOptions(),
      indexAxis: "y",
      plugins: {
        ...railBaseOptions().plugins,
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: p.tick,
            boxWidth: 10,
            boxHeight: 10,
            font: { size: 9 },
            padding: 10,
          },
        },
        tooltip: {
          ...railBaseOptions().plugins?.tooltip,
          callbacks: {
            title: (tipItems) => rows[tipItems[0]?.dataIndex ?? 0]?.name ?? "",
            label: (ctx) => {
              const v = Number(ctx.raw);
              const formatted =
                v >= 1_000_000
                  ? `$${(v / 1_000_000).toFixed(2)}M`
                  : v >= 1_000
                    ? `$${(v / 1_000).toFixed(1)}k`
                    : `$${v.toFixed(0)}`;
              return ` ${ctx.dataset.label}: ${formatted}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: p.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: p.tick,
            font: { size: 8 },
            maxTicksLimit: 3,
            callback: (v) => {
              const n = Number(v);
              if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
              if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
              return `$${n}`;
            },
          },
        },
        y: {
          grid: { display: false },
          ticks: { color: p.tick, font: { size: 8 } },
        },
      },
    },
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ onTime: number, late: number }} transit
 */
export function renderRailTransitChart(canvas, transit) {
  const p = palette();
  return renderRailSplitDonut(canvas, {
    a: transit.onTime,
    b: transit.late,
    labelA: "On time",
    labelB: "Late",
    centerCaption: "on time",
    colorA: p.accentBright,
    colorB: withAlpha(p.danger, 0.85),
  });
}

/**
 * Two-slice donut with center % of slice A.
 * @param {HTMLCanvasElement} canvas
 * @param {{ a: number, b: number, labelA: string, labelB: string, centerCaption: string, colorA?: string, colorB?: string }} split
 */
export function renderRailSplitDonut(canvas, split) {
  if (typeof Chart === "undefined") return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const total = split.a + split.b;
  if (total <= 0) return null;

  const aPct = Math.round((split.a / total) * 100);
  const p = palette();

  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: [split.labelA, split.labelB],
      datasets: [
        {
          data: [split.a, split.b],
          backgroundColor: [split.colorA ?? p.accentBright, split.colorB ?? p.accentBlue],
          borderWidth: isCorporate() ? 3 : 0,
          borderColor: "#ffffff",
          hoverOffset: 4,
        },
      ],
    },
    options: {
      ...railBaseOptions(),
      cutout: "68%",
      plugins: {
        ...railBaseOptions().plugins,
        tooltip: {
          ...railBaseOptions().plugins?.tooltip,
          callbacks: {
            label: (ctx) => {
              const v = Number(ctx.raw);
              const pct = ((v / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${v.toLocaleString()} (${pct}%)`;
            },
          },
        },
      },
    },
    plugins: [
      {
        id: "splitCenter",
        beforeDraw(chart) {
          const { width, height } = chart;
          const c = chart.ctx;
          c.save();
          drawGoldTrimmedLabel(c, `${aPct}%`, width / 2, height / 2 - 5, "bold 0.95rem Inter, sans-serif");
          c.font = "0.6rem Inter, sans-serif";
          c.fillStyle = palette().tick;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText(split.centerCaption, width / 2, height / 2 + 10);
          c.restore();
        },
      },
    ],
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ labels: string[], revenue: number[], profit: number[] }} data
 */
export function renderMonthlyChart(canvas, data) {
  if (typeof Chart === "undefined") return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const p = palette();
  const goldGrad = ctx.createLinearGradient(0, 0, 0, 260);
  goldGrad.addColorStop(0, p.barTop);
  goldGrad.addColorStop(0.5, p.barMid);
  goldGrad.addColorStop(1, p.barBot);

  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.labels,
      datasets: [
        {
          label: "Revenue",
          data: data.revenue,
          backgroundColor: goldGrad,
          borderColor: p.accentBright,
          borderWidth: 0,
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: isCorporate() ? 52 : undefined,
        },
        {
          label: "Profit",
          data: data.profit,
          type: "line",
          borderColor: p.accentBlue,
          backgroundColor: p.fillBlue,
          borderWidth: 2.5,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: p.accentBright,
          pointBorderColor: p.pointBorder,
          pointBorderWidth: 2,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 650,
        easing: "easeOutQuart",
      },
      interaction: { mode: "index", intersect: false },
      layout: {
        padding: { top: 4, right: 8, bottom: 8, left: 4 },
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
          align: "end",
          labels: { color: p.tick, boxWidth: 10, font: { size: 11, weight: "500" } },
        },
        tooltip: {
          backgroundColor: p.tooltipBg,
          titleColor: p.tooltipTitle,
          bodyColor: p.tooltipBody,
          borderColor: p.tooltipBorder,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
        },
      },
      datasets: isCorporate()
        ? { bar: { categoryPercentage: 0.42, barPercentage: 0.72 } }
        : undefined,
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: p.tick, font: { size: 10 }, padding: 6 },
        },
        y: {
          grid: { color: p.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: p.tick,
            font: { size: 10 },
            padding: 6,
            callback: (v) => {
              const n = Number(v);
              if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
              if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
              return `$${n}`;
            },
          },
        },
      },
    },
  });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ ltl: number, truckload: number, other?: number }} split
 */
export function renderEquipmentDonut(canvas, split) {
  if (typeof Chart === "undefined") return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const other = split.other ?? 0;
  const total = split.ltl + split.truckload + other || 1;
  const ltlPct = Math.round((split.ltl / total) * 100);

  const p = palette();
  const labels = ["LTL", "Truckload"];
  const data = [split.ltl, split.truckload];
  const colors = [p.accentBright, p.navyDeep];
  if (other > 0) {
    labels.push("Other / unknown");
    data.push(other);
    colors.push(p.tick);
  }

  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderWidth: isCorporate() ? 3 : 0,
          borderColor: "#ffffff",
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      animation: {
        animateRotate: true,
        duration: 600,
        easing: "easeOutQuart",
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: p.tooltipBg,
          titleColor: p.tooltipTitle,
          bodyColor: p.tooltipBody,
          borderColor: p.tooltipBorder,
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw;
              const pct = ((Number(v) / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${pct}%`;
            },
          },
        },
      },
    },
    plugins: [
      {
        id: "centerText",
        beforeDraw(chart) {
          const { width, height } = chart;
          const ctx2 = chart.ctx;
          ctx2.save();
          drawGoldTrimmedLabel(ctx2, `${ltlPct}%`, width / 2, height / 2 - 6, "bold 1.1rem Inter, sans-serif");
          ctx2.font = "0.65rem Inter, sans-serif";
          ctx2.fillStyle = palette().tick;
          ctx2.textAlign = "center";
          ctx2.textBaseline = "middle";
          ctx2.fillText("LTL mix", width / 2, height / 2 + 12);
          ctx2.restore();
        },
      },
    ],
  });
}

/** @param {Chart | null} chart */
export function destroyChart(chart) {
  if (chart) chart.destroy();
}
