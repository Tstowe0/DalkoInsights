import { mountToolShell } from "../_shared/tool-shell.js";

export const meta = {
  id: "Currency Converter",
  title: "Currency Converter",
  category: "Data Tools",
  script: "Data Tools/Currency Converter.js",
};

const RATES_URL = (base) => `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
const CACHE_KEY = "glassbox.fx.rates.v1";
const CACHE_MS = 6 * 60 * 60 * 1000;

const CURRENCIES = [
  ["CAD", "Canadian Dollar"],
  ["USD", "US Dollar"],
  ["MXN", "Mexican Peso"],
  ["EUR", "Euro"],
  ["GBP", "British Pound"],
  ["CNY", "Chinese Yuan"],
  ["JPY", "Japanese Yen"],
  ["BRL", "Brazilian Real"],
  ["CHF", "Swiss Franc"],
  ["AUD", "Australian Dollar"],
];

const CORE_LINES = [
  { id: "freight", label: "Freight", apply: "markup" },
  { id: "fuel", label: "Fuel", apply: "fuel" },
  { id: "tax", label: "GST/HST", apply: "none" },
];

function formatMoney(n) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRate(n) {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseAmount(raw) {
  const cleaned = String(raw ?? "").trim().replace(/,/g, "");
  if (!cleaned) return 0;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function parseRate(raw) {
  const n = parseAmount(raw);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function parsePct(raw) {
  const n = parseAmount(raw);
  return Number.isFinite(n) ? n : 0;
}

/** @returns {Record<string, { fetchedAt: number, date: string, rates: Record<string, number> }>} */
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, { fetchedAt: number, date: string, rates: Record<string, number> }>} cache */
function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} base
 * @returns {Promise<{ date: string, rates: Record<string, number>, source: string }>}
 */
async function fetchRates(base) {
  const cache = loadCache();
  const hit = cache[base];
  if (hit && Date.now() - hit.fetchedAt < CACHE_MS && hit.rates) {
    return { date: hit.date, rates: hit.rates, source: "Cache" };
  }

  const res = await fetch(RATES_URL(base));
  if (!res.ok) throw new Error(`Rate service returned ${res.status}.`);
  const data = await res.json();
  if (data.result !== "success" || !data.rates) {
    throw new Error(data["error-type"] || "Rate service did not return usable rates.");
  }

  const rates = /** @type {Record<string, number>} */ (data.rates);
  rates[base] = 1;
  const date = String(data.time_last_update_utc || "").trim() || "Unknown";
  cache[base] = { fetchedAt: Date.now(), date, rates };
  saveCache(cache);
  return { date, rates, source: "Live" };
}

/**
 * @param {number} amount
 * @param {"markup" | "fuel" | "none"} apply
 * @param {number} markupPct
 * @param {number} fuelPct
 * @param {number} rate
 */
function convertLine(amount, apply, markupPct, fuelPct, rate) {
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return NaN;
  let factor = 1;
  if (apply === "markup") factor = 1 + markupPct / 100;
  if (apply === "fuel") factor = 1 + fuelPct / 100;
  return amount * factor * rate;
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  const shell = mountToolShell(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Enter invoice amounts on the left. Middle settings apply markup, fuel surcharge, and FX. The right column is the converted result.

How values are modified:
• Freight and Additional lines: × (1 + Markup %) × exchange rate
• Fuel: × (1 + Fuel Surcharge %) × exchange rate
• GST/HST: exchange rate only (no markup)

Workflow:
1. Type Freight, Fuel, and GST/HST from the invoice (From currency).
2. Set Markup % and Fuel Surcharge %. Add extra lines if needed.
3. From defaults to CAD, To to USD. The rate loads automatically and can be overridden.
4. Copy any converted line from the right column.`,
    onBack: ctx.onBack,
    log: ctx.log,
  });

  const options = CURRENCIES.map(
    ([code, name]) => `<option value="${code}" data-name="${escapeHtml(name)}">${code}</option>`
  ).join("");

  /** @type {{ id: string, name: string, value: string }[]} */
  let extras = [];
  let extraSeq = 0;
  let rateRequestId = 0;

  shell.body.innerHTML = `
    <div class="gb-fx-board">
      <section class="gb-fx-col" aria-label="Invoice input">
        <p class="gb-zip-block-title">Invoice</p>
        <div class="gb-fx-lines gb-fx-scroll" data-input-lines>
          <label class="gb-fx-line">
            <span class="gb-fx-label">Freight</span>
            <input data-core="freight" type="text" inputmode="decimal" placeholder="0.00" autocomplete="off" />
            <span class="gb-fx-action-slot" aria-hidden="true"></span>
          </label>
          <label class="gb-fx-line">
            <span class="gb-fx-label">Fuel</span>
            <input data-core="fuel" type="text" inputmode="decimal" placeholder="0.00" autocomplete="off" />
            <span class="gb-fx-action-slot" aria-hidden="true"></span>
          </label>
          <label class="gb-fx-line">
            <span class="gb-fx-label">GST/HST</span>
            <input data-core="tax" type="text" inputmode="decimal" placeholder="0.00" autocomplete="off" />
            <span class="gb-fx-action-slot" aria-hidden="true"></span>
          </label>
          <div data-extra-lines></div>
        </div>
        <div class="gb-fx-col-actions">
          <button type="button" class="btn btn-secondary" data-add>+ Add Charge</button>
        </div>
      </section>

      <section class="gb-fx-col gb-fx-col--mid" aria-label="Markup and exchange">
        <p class="gb-zip-block-title">Settings</p>
        <div class="gb-fx-settings-body">
          <label class="gb-zip-field">Markup %
            <input data-markup type="text" inputmode="decimal" placeholder="0" autocomplete="off" />
          </label>
          <label class="gb-zip-field">Fuel Surcharge %
            <input data-fuelpct type="text" inputmode="decimal" placeholder="0" autocomplete="off" />
          </label>
          <div class="gb-fx-pair">
            <label class="gb-zip-field">From
              <select data-from>${options}</select>
            </label>
            <span class="gb-fx-arrow" aria-hidden="true">→</span>
            <label class="gb-zip-field">To
              <select data-to>${options}</select>
            </label>
          </div>
          <label class="gb-zip-field">Exchange rate
            <input data-rate type="text" inputmode="decimal" placeholder="Loading…" autocomplete="off" />
          </label>
          <p class="gb-fx-rate-meta" data-rate-meta>Loading rate…</p>
        </div>
        <div class="gb-fx-col-actions">
          <button type="button" class="btn btn-ghost" data-refresh>Refresh rate</button>
        </div>
      </section>

      <section class="gb-fx-col" aria-label="Converted output">
        <p class="gb-zip-block-title">Converted</p>
        <div class="gb-fx-lines gb-fx-scroll" data-output-lines></div>
        <div class="gb-fx-col-actions">
          <button type="button" class="btn btn-danger" data-clear>Clear Invoice</button>
        </div>
      </section>
    </div>
  `;

  const inputLinesEl = /** @type {HTMLElement} */ (shell.body.querySelector("[data-input-lines]"));
  const extraLinesEl = /** @type {HTMLElement} */ (shell.body.querySelector("[data-extra-lines]"));
  const outputLinesEl = /** @type {HTMLElement} */ (shell.body.querySelector("[data-output-lines]"));
  const markupEl = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-markup]"));
  const fuelPctEl = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-fuelpct]"));
  const fromEl = /** @type {HTMLSelectElement} */ (shell.body.querySelector("[data-from]"));
  const toEl = /** @type {HTMLSelectElement} */ (shell.body.querySelector("[data-to]"));
  const rateEl = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-rate]"));
  const rateMetaEl = /** @type {HTMLElement} */ (shell.body.querySelector("[data-rate-meta]"));
  const addBtn = /** @type {HTMLButtonElement} */ (shell.body.querySelector("[data-add]"));
  const clearBtn = /** @type {HTMLButtonElement} */ (shell.body.querySelector("[data-clear]"));
  const refreshBtn = /** @type {HTMLButtonElement} */ (shell.body.querySelector("[data-refresh]"));

  fromEl.value = "CAD";
  toEl.value = "USD";

  /** @param {HTMLSelectElement} select @param {boolean} showNames */
  function paintCurrencyOptions(select, showNames) {
    for (const option of select.options) {
      const code = option.value;
      const name = option.getAttribute("data-name") || "";
      option.textContent = showNames && name ? `${code} — ${name}` : code;
    }
  }

  /** @param {HTMLSelectElement} select */
  function wireCurrencySelect(select) {
    paintCurrencyOptions(select, false);
    select.addEventListener("focus", () => paintCurrencyOptions(select, true));
    select.addEventListener("mousedown", () => paintCurrencyOptions(select, true));
    select.addEventListener("blur", () => paintCurrencyOptions(select, false));
    select.addEventListener("change", () => paintCurrencyOptions(select, false));
  }

  wireCurrencySelect(fromEl);
  wireCurrencySelect(toEl);

  function coreValue(id) {
    const input = /** @type {HTMLInputElement | null} */ (
      inputLinesEl.querySelector(`[data-core="${id}"]`)
    );
    return parseAmount(input?.value ?? "");
  }

  function paintExtras() {
    extraLinesEl.innerHTML = extras
      .map(
        (row) => `
      <div class="gb-fx-line gb-fx-line--extra" data-extra-id="${escapeHtml(row.id)}">
        <input class="gb-fx-name" data-extra-name type="text" placeholder="Fee name" value="${escapeHtml(row.name)}" autocomplete="off" />
        <input data-extra-value type="text" inputmode="decimal" placeholder="0.00" value="${escapeHtml(row.value)}" autocomplete="off" />
        <button type="button" class="btn btn-ghost gb-fx-remove" data-remove title="Remove line" aria-label="Remove line">×</button>
      </div>`
      )
      .join("");
  }

  function collectLines() {
    /** @type {{ id: string, label: string, amount: number, apply: "markup" | "fuel" | "none" }[]} */
    const lines = CORE_LINES.map((line) => ({
      id: line.id,
      label: line.label,
      amount: coreValue(line.id),
      apply: line.apply,
    }));
    for (const extra of extras) {
      const nameInput = /** @type {HTMLInputElement | null} */ (
        extraLinesEl.querySelector(`[data-extra-id="${extra.id}"] [data-extra-name]`)
      );
      const valueInput = /** @type {HTMLInputElement | null} */ (
        extraLinesEl.querySelector(`[data-extra-id="${extra.id}"] [data-extra-value]`)
      );
      extra.name = nameInput?.value ?? extra.name;
      extra.value = valueInput?.value ?? extra.value;
      lines.push({
        id: extra.id,
        label: extra.name.trim() || "Additional",
        amount: parseAmount(extra.value),
        apply: "markup",
      });
    }
    return lines;
  }

  function paintOutputs() {
    const markupPct = parsePct(markupEl.value);
    const fuelPct = parsePct(fuelPctEl.value);
    const rate = parseRate(rateEl.value);
    const to = toEl.value;
    const lines = collectLines();
    const convertedLines = lines.map((line) => ({
      ...line,
      converted: convertLine(line.amount, line.apply, markupPct, fuelPct, rate),
    }));

    const rows = convertedLines.map((line) => {
      const display = Number.isFinite(line.converted) ? formatMoney(line.converted) : "—";
      const copyValue = Number.isFinite(line.converted) ? line.converted.toFixed(2) : "";
      return `
        <div class="gb-fx-line gb-fx-line--out">
          <span class="gb-fx-label">${escapeHtml(line.label)}</span>
          <span class="gb-fx-out-value" data-copy-value="${escapeHtml(copyValue)}">${display} <small>${escapeHtml(to)}</small></span>
          <button type="button" class="btn btn-ghost gb-fx-copy" data-copy ${copyValue ? "" : "disabled"}>Copy</button>
        </div>`;
    });

    const total = convertedLines.reduce((sum, line) => {
      if (!Number.isFinite(rate)) return NaN;
      if (!Number.isFinite(line.converted)) return sum;
      return sum + line.converted;
    }, Number.isFinite(rate) ? 0 : NaN);
    const totalOk = Number.isFinite(total);
    const totalCopy = totalOk ? total.toFixed(2) : "";

    rows.push(`
      <div class="gb-fx-line gb-fx-line--out gb-fx-line--total">
        <span class="gb-fx-label">Total</span>
        <span class="gb-fx-out-value" data-copy-value="${escapeHtml(totalCopy)}">${totalOk ? formatMoney(total) : "—"} <small>${escapeHtml(to)}</small></span>
        <button type="button" class="btn btn-ghost gb-fx-copy" data-copy ${totalOk ? "" : "disabled"}>Copy</button>
      </div>`);

    outputLinesEl.innerHTML = rows.join("");
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const prev = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = prev || "Copy";
    }, 900);
    ctx.log(`Copied ${text}`);
  }

  async function loadRate(force = false) {
    const from = fromEl.value;
    const to = toEl.value;
    const requestId = ++rateRequestId;
    const stillCurrent = () => requestId === rateRequestId && fromEl.value === from && toEl.value === to;

    if (from === to) {
      rateEl.value = "1";
      rateMetaEl.textContent = "Same currency — rate is 1.";
      paintOutputs();
      return;
    }
    if (force) {
      const cache = loadCache();
      delete cache[from];
      saveCache(cache);
    }
    rateMetaEl.textContent = "Fetching rate…";
    shell.setStatus("Fetching rate…");
    try {
      const { date, rates, source } = await fetchRates(from);
      if (!stillCurrent()) return;
      const rate = rates[to];
      if (typeof rate !== "number") throw new Error(`No rate for ${from} → ${to}.`);
      rateEl.value = String(rate);
      rateMetaEl.textContent = `${source}: 1 ${from} = ${formatRate(rate)} ${to}${date ? ` · ${date}` : ""}`;
      shell.setStatus("Ready");
      ctx.log(`Rate ${from}→${to}: ${formatRate(rate)} (${source})`);
    } catch (err) {
      if (!stillCurrent()) return;
      const msg = err instanceof Error ? err.message : String(err);
      rateMetaEl.textContent = `Could not load rate — ${msg}. Enter one manually.`;
      shell.setStatus("Rate unavailable");
      ctx.log(msg);
    }
    if (stillCurrent()) paintOutputs();
  }

  paintExtras();
  paintOutputs();
  void loadRate();

  inputLinesEl.addEventListener("input", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const extraRow = target.closest("[data-extra-id]");
    if (extraRow) {
      const id = extraRow.getAttribute("data-extra-id");
      const extra = extras.find((row) => row.id === id);
      if (extra) {
        const nameInput = /** @type {HTMLInputElement | null} */ (extraRow.querySelector("[data-extra-name]"));
        const valueInput = /** @type {HTMLInputElement | null} */ (extraRow.querySelector("[data-extra-value]"));
        extra.name = nameInput?.value ?? "";
        extra.value = valueInput?.value ?? "";
      }
    }
    paintOutputs();
  });

  extraLinesEl.addEventListener("click", (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest("[data-remove]");
    if (!btn) return;
    const row = btn.closest("[data-extra-id]");
    const id = row?.getAttribute("data-extra-id");
    extras = extras.filter((item) => item.id !== id);
    paintExtras();
    paintOutputs();
  });

  addBtn.addEventListener("click", () => {
    extraSeq += 1;
    extras.push({ id: `extra-${extraSeq}`, name: "", value: "" });
    paintExtras();
    paintOutputs();
    const nameInput = /** @type {HTMLInputElement | null} */ (
      extraLinesEl.querySelector(`[data-extra-id="extra-${extraSeq}"] [data-extra-name]`)
    );
    nameInput?.focus();
    inputLinesEl.scrollTop = inputLinesEl.scrollHeight;
  });

  clearBtn.addEventListener("click", () => {
    for (const id of CORE_LINES.map((line) => line.id)) {
      const input = /** @type {HTMLInputElement | null} */ (
        inputLinesEl.querySelector(`[data-core="${id}"]`)
      );
      if (input) input.value = "";
    }
    extras = [];
    paintExtras();
    paintOutputs();
    ctx.log("Invoice cleared.");
    const freight = /** @type {HTMLInputElement | null} */ (
      inputLinesEl.querySelector('[data-core="freight"]')
    );
    freight?.focus();
  });

  for (const el of [markupEl, fuelPctEl, rateEl]) {
    el.addEventListener("input", () => paintOutputs());
  }

  fromEl.addEventListener("change", () => void loadRate());
  toEl.addEventListener("change", () => void loadRate());
  refreshBtn.addEventListener("click", () => void loadRate(true));

  outputLinesEl.addEventListener("click", (e) => {
    const btn = /** @type {HTMLButtonElement | null} */ (
      /** @type {HTMLElement} */ (e.target).closest("[data-copy]")
    );
    if (!btn || btn.disabled) return;
    const value = btn.closest(".gb-fx-line")?.querySelector("[data-copy-value]")?.getAttribute("data-copy-value");
    if (!value) return;
    void copyText(value, btn);
  });
}
