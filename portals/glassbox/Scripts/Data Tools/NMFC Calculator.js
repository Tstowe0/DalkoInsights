/**
 * NMFC Calculator — density shell.
 * Cube and the standard density class are calculated here.
 * NMFC item and sub stay pending until ClassIT is connected.
 */

import { mountAboutSlide } from "../_shared/about-slide.js?v=20261015-nmfc";

const TOOL_ID = "NMFC Calculator";
const TOOL_NAME = "NMFC Calculator (WIP)";

/**
 * Full density scale, highest density first.
 * A step applies when pounds per cubic foot are at least `min`.
 */
const DENSITY_SCALE = [
  { min: 50, freightClass: "50" },
  { min: 35, freightClass: "55" },
  { min: 30, freightClass: "60" },
  { min: 22.5, freightClass: "65" },
  { min: 15, freightClass: "70" },
  { min: 12, freightClass: "85" },
  { min: 10, freightClass: "92.5" },
  { min: 8, freightClass: "100" },
  { min: 6, freightClass: "125" },
  { min: 4, freightClass: "175" },
  { min: 2, freightClass: "250" },
  { min: 1, freightClass: "300" },
  { min: 0, freightClass: "400" },
];

/**
 * @param {number} pcf
 */
function densityClass(pcf) {
  for (const step of DENSITY_SCALE) {
    if (pcf >= step.min) return step.freightClass;
  }
  return "400";
}

/**
 * @param {HTMLInputElement} input
 * @returns {number | null}
 */
function readNumber(input) {
  const raw = String(input.value || "").trim().replace(/,/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * @param {number} n
 */
function formatQty(n) {
  return (Math.round(n * 100) / 100).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

/**
 * @param {HTMLElement} parent
 * @param {{ log?: (msg: string) => void }} [ctx]
 */
export async function loadGui(parent, ctx) {
  parent.classList.add("zx-host", "nmfc-host");
  parent.innerHTML = `
    <div class="zx">
      <header class="zx-bar">
        <h2>${TOOL_NAME}</h2>
        <div class="zx-about" data-about-slot></div>
      </header>
      <section class="zx-guide" aria-label="How to use ${TOOL_NAME}">
        <p class="zx-kicker">How to use</p>
        <ol class="zx-steps">
          <li><span>1</span><p>Enter the commodity and an item number if you already have one.</p></li>
          <li><span>2</span><p>Enter length, width, and height in inches, total weight, and handling units.</p></li>
          <li><span>3</span><p>Calculate cube, density, and an estimated class. Item and sub stay blank until ClassIT is connected.</p></li>
        </ol>
      </section>
      <form class="nmfc-form" id="nmfc-form">
        <label class="nmfc-field nmfc-span">
          <span>Commodity</span>
          <input id="nmfc-commodity" type="text" autocomplete="off" placeholder="What is shipping" />
        </label>
        <label class="nmfc-field">
          <span>Item number</span>
          <input id="nmfc-item" type="text" inputmode="numeric" autocomplete="off" placeholder="Optional" />
        </label>
        <label class="nmfc-field">
          <span>Length (in)</span>
          <input id="nmfc-length" type="text" inputmode="decimal" autocomplete="off" />
        </label>
        <label class="nmfc-field">
          <span>Width (in)</span>
          <input id="nmfc-width" type="text" inputmode="decimal" autocomplete="off" />
        </label>
        <label class="nmfc-field">
          <span>Height (in)</span>
          <input id="nmfc-height" type="text" inputmode="decimal" autocomplete="off" />
        </label>
        <label class="nmfc-field">
          <span>Weight (lb)</span>
          <input id="nmfc-weight" type="text" inputmode="decimal" autocomplete="off" />
        </label>
        <label class="nmfc-field">
          <span>Handling units</span>
          <input id="nmfc-units" type="text" inputmode="decimal" autocomplete="off" value="1" />
        </label>
        <div class="zx-actions">
          <button type="submit" class="btn btn-primary">Calculate</button>
          <button type="button" class="btn" id="nmfc-clear">Clear</button>
        </div>
      </form>
      <section class="zx-result" id="nmfc-result" hidden>
        <div class="nmfc-metrics">
          <div><strong id="nmfc-cube">—</strong><span>Cubic feet</span></div>
          <div><strong id="nmfc-pcf">—</strong><span>Pounds / cu ft</span></div>
          <div><strong id="nmfc-class">—</strong><span>Density class</span></div>
          <div><strong id="nmfc-nmfc" class="is-pending">—</strong><span>NMFC item</span></div>
          <div><strong id="nmfc-sub" class="is-pending">—</strong><span>Sub</span></div>
        </div>
        <p class="zx-places" id="nmfc-summary"></p>
        <p class="zx-source" id="nmfc-source">Density scale estimate. ClassIT is not connected.</p>
      </section>
    </div>
  `;

  const aboutSlot = parent.querySelector("[data-about-slot]");
  if (aboutSlot) {
    try {
      mountAboutSlide(aboutSlot, { title: TOOL_NAME, toolId: TOOL_ID });
    } catch (err) {
      ctx?.log?.(`About control failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const form = parent.querySelector("#nmfc-form");
  const result = parent.querySelector("#nmfc-result");
  const commodity = parent.querySelector("#nmfc-commodity");
  const item = parent.querySelector("#nmfc-item");
  const length = parent.querySelector("#nmfc-length");
  const width = parent.querySelector("#nmfc-width");
  const height = parent.querySelector("#nmfc-height");
  const weight = parent.querySelector("#nmfc-weight");
  const units = parent.querySelector("#nmfc-units");

  const show = (id, text, pending) => {
    const node = parent.querySelector(id);
    node.textContent = text;
    node.classList.toggle("is-pending", Boolean(pending));
  };

  const fail = (message) => {
    result.hidden = false;
    result.classList.add("is-error");
    show("#nmfc-cube", "—", true);
    show("#nmfc-pcf", "—", true);
    show("#nmfc-class", "—", true);
    show("#nmfc-nmfc", "—", true);
    show("#nmfc-sub", "—", true);
    parent.querySelector("#nmfc-summary").textContent = message;
    parent.querySelector("#nmfc-source").textContent = "Check the dimensions and weight, then calculate again.";
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const dims = [
      ["Length", readNumber(length)],
      ["Width", readNumber(width)],
      ["Height", readNumber(height)],
      ["Weight", readNumber(weight)],
    ];
    for (const [label, value] of dims) {
      if (value == null || Number.isNaN(value) || value <= 0) {
        fail(`${label} needs a number greater than zero.`);
        return;
      }
    }
    const unitCount = readNumber(units);
    if (unitCount == null || Number.isNaN(unitCount) || unitCount <= 0) {
      fail("Handling units needs a number greater than zero.");
      return;
    }

    const cubicFeet = (dims[0][1] * dims[1][1] * dims[2][1] * unitCount) / 1728;
    const pcf = dims[3][1] / cubicFeet;
    const freightClass = densityClass(pcf);
    const itemText = item.value.trim();
    const commodityText = commodity.value.trim();

    result.hidden = false;
    result.classList.remove("is-error");
    show("#nmfc-cube", formatQty(cubicFeet), false);
    show("#nmfc-pcf", formatQty(pcf), false);
    show("#nmfc-class", freightClass, false);
    show("#nmfc-nmfc", itemText || "—", true);
    show("#nmfc-sub", "—", true);
    parent.querySelector("#nmfc-summary").textContent = commodityText
      ? `${commodityText}. Class ${freightClass} is the density-scale estimate.`
      : `Class ${freightClass} is the density-scale estimate.`;
    parent.querySelector("#nmfc-source").textContent =
      "Density scale estimate. NMFC item and sub are not looked up until ClassIT is connected.";
    ctx?.log?.(`NMFC shell: ${formatQty(pcf)} pcf, density class ${freightClass}`);
  });

  parent.querySelector("#nmfc-clear").addEventListener("click", () => {
    form.reset();
    units.value = "1";
    result.hidden = true;
    result.classList.remove("is-error");
  });
}
