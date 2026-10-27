import { mountFileTool } from "../_shared/file-ui.js?v=20261027-titlebar";
import {
  ensureXlsx,
  readFileBuffer,
  workbookToObjects,
  objectsToWorkbook,
  downloadWorkbook,
} from "../_shared/excel.js";
import { alertDialog, confirmDialog } from "../../../../shared/js/dialog.js";

export const meta = {
  id: "Excel Trimmer",
  title: "Excel Trimmer",
  category: "Data Tools",
  script: "Data Tools/Excel Trimmer.js",
};

const PRESET_URL = "portals/glassbox/data/trimmer-presets";
const LOCAL_KEY = "dalko-excel-trimmer-presets";
const HIDDEN_KEY = "dalko-excel-trimmer-hidden";

/** Shared Glass Box presets. Custom saves stay in this browser. */
const BUNDLED_NAMES = [
  "Basic Loads",
  "JT Usual Request",
  "Marmon Usual Request",
  "McConway Report",
  "Pricing Check",
  "Shipment Detail Example",
  "Stucki Default",
  "UTLXA Monthly",
];

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  /** @type {string[]} */
  let headers = [];
  /** @type {Record<string, unknown>[]} */
  let rows = [];
  /** @type {Record<string, string[]>} */
  const bundled = {};
  /** @type {Record<string, string[]>} */
  let local = readStore(LOCAL_KEY);
  /** @type {Set<string>} */
  let hidden = new Set(readList(HIDDEN_KEY));

  mountFileTool(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `Keep only the columns you need from an Excel file.

Workflow:
1. Browse and select an .xlsx file.
2. Columns appear in sheet order, none checked. Search, or load a preset.
3. Check the columns to keep.
4. Run → download the trimmed workbook.

If Total Receivable Amount is checked, you can rename it to FREIGHT SPEND.`,
    onBack: ctx.onBack,
    log: ctx.log,
    accept: ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    buildExtra(extra) {
      extra.innerHTML = `
        <div class="gb-trim-bar">
          <select data-preset aria-label="Preset">
            <option value="">Preset</option>
          </select>
          <input type="text" data-preset-name placeholder="Preset name" aria-label="Preset name" />
          <button type="button" class="btn btn-ghost" data-save-preset>Save Preset</button>
          <button type="button" class="btn btn-ghost" data-delete-preset>Delete Preset</button>
          <input type="search" class="gb-trim-search" data-search placeholder="Smart Search Columns..." aria-label="Search columns" />
          <button type="button" class="btn btn-ghost" data-reset>Reset View</button>
          <label class="gb-trim-check"><input type="checkbox" data-checked-only /> Show Checked Only</label>
          <button type="button" class="btn btn-ghost" data-check-visible>Check All</button>
          <button type="button" class="btn btn-ghost" data-uncheck>Uncheck All</button>
        </div>
        <p class="gb-trim-count" data-count>Load a file to see columns.</p>
        <div class="gb-trim-cols" data-cols></div>
      `;

      const preset = /** @type {HTMLSelectElement} */ (extra.querySelector("[data-preset]"));
      const presetName = /** @type {HTMLInputElement} */ (extra.querySelector("[data-preset-name]"));
      const search = /** @type {HTMLInputElement} */ (extra.querySelector("[data-search]"));
      const checkedOnly = /** @type {HTMLInputElement} */ (extra.querySelector("[data-checked-only]"));
      const count = /** @type {HTMLElement} */ (extra.querySelector("[data-count]"));
      const box = /** @type {HTMLElement} */ (extra.querySelector("[data-cols]"));

      const fillPresets = () => {
        const current = preset.value;
        const names = presetNames(bundled, local, hidden);
        preset.replaceChildren(new Option("Preset", ""));
        for (const name of names) preset.append(new Option(name, name));
        if (names.includes(current)) preset.value = current;
      };

      const updateCount = () => {
        if (!headers.length) {
          count.textContent = "Load a file to see columns.";
          return;
        }
        const selected = box.querySelectorAll("input[data-trim-col]:checked").length;
        count.textContent = `${headers.length} columns in sheet order · ${selected} selected`;
      };

      const applyFilter = () => {
        const term = search.value.trim().toLowerCase();
        const only = checkedOnly.checked;
        box.querySelectorAll("[data-col-row]").forEach((row) => {
          const label = /** @type {HTMLElement} */ (row);
          const input = /** @type {HTMLInputElement | null} */ (label.querySelector("input[data-trim-col]"));
          const name = (input?.value || "").toLowerCase();
          const match = !term || name.includes(term);
          const show = match && (!only || Boolean(input?.checked));
          label.hidden = !show;
        });
      };

      const renderCols = () => {
        box.replaceChildren();
        for (const header of headers) {
          const label = document.createElement("label");
          label.dataset.colRow = "";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.dataset.trimCol = "";
          input.value = header;
          label.append(input, document.createTextNode(header));
          box.append(label);
        }
        if (preset.value) applyPreset(preset.value);
        else applyFilter();
        updateCount();
      };

      const applyPreset = (name) => {
        const saved = local[name] || bundled[name];
        if (!saved) return;
        const wanted = new Set(saved.map((col) => col.trim().toUpperCase()));
        let matched = 0;
        box.querySelectorAll("input[data-trim-col]").forEach((node) => {
          const input = /** @type {HTMLInputElement} */ (node);
          const on = wanted.has(input.value.trim().toUpperCase());
          input.checked = on;
          if (on) matched += 1;
        });
        applyFilter();
        updateCount();
        ctx.log(`Preset '${name}' loaded (${matched} columns matched).`);
      };

      extra.querySelector("[data-save-preset]")?.addEventListener("click", async () => {
        const name = presetName.value.trim();
        if (!name) {
          await alertDialog("Enter a preset name.", { title: "Preset" });
          return;
        }
        const selected = checkedHeaders(box, headers);
        if (!selected.length) {
          await alertDialog("Check at least one column before saving a preset.", { title: "Preset" });
          return;
        }
        local[name] = selected;
        hidden.delete(name);
        writeStore(LOCAL_KEY, local);
        writeList(HIDDEN_KEY, hidden);
        presetName.value = "";
        fillPresets();
        preset.value = name;
        ctx.log(`Preset '${name}' saved in this browser.`);
      });

      extra.querySelector("[data-delete-preset]")?.addEventListener("click", async () => {
        const name = preset.value;
        if (!name) {
          await alertDialog("Choose a preset to delete.", { title: "Preset" });
          return;
        }
        const ok = await confirmDialog(`Delete preset "${name}"?`, {
          title: "Delete Preset",
          okLabel: "Delete",
          cancelLabel: "Cancel",
          tone: "danger",
        });
        if (!ok) return;
        delete local[name];
        hidden.add(name);
        writeStore(LOCAL_KEY, local);
        writeList(HIDDEN_KEY, hidden);
        fillPresets();
        ctx.log(`Preset '${name}' deleted.`);
      });

      preset.addEventListener("change", () => {
        if (!preset.value || !headers.length) return;
        applyPreset(preset.value);
      });

      search.addEventListener("input", applyFilter);
      checkedOnly.addEventListener("change", applyFilter);

      extra.querySelector("[data-reset]")?.addEventListener("click", () => {
        search.value = "";
        checkedOnly.checked = false;
        applyFilter();
        ctx.log("View reset.");
      });

      extra.querySelector("[data-check-visible]")?.addEventListener("click", () => {
        box.querySelectorAll("[data-col-row]").forEach((row) => {
          const label = /** @type {HTMLElement} */ (row);
          if (label.hidden) return;
          const input = /** @type {HTMLInputElement | null} */ (label.querySelector("input[data-trim-col]"));
          if (input) input.checked = true;
        });
        updateCount();
        ctx.log("All visible columns checked.");
      });

      extra.querySelector("[data-uncheck]")?.addEventListener("click", () => {
        box.querySelectorAll("input[data-trim-col]").forEach((node) => {
          /** @type {HTMLInputElement} */ (node).checked = false;
        });
        applyFilter();
        updateCount();
        ctx.log("All columns unchecked.");
      });

      box.addEventListener("change", () => {
        updateCount();
        if (checkedOnly.checked) applyFilter();
      });

      extra.dataset.trimReady = "1";
      void loadBundled(bundled).then(fillPresets);

      parent.addEventListener("dalko-trimmer-render", renderCols);
    },
    async onRun(_files, ui) {
      await ensureXlsx();
      if (!headers.length) {
        const buffer = await readFileBuffer(_files[0]);
        const parsed = workbookToObjects(buffer);
        headers = parsed.headers;
        rows = parsed.rows;
        parent.dispatchEvent(new CustomEvent("dalko-trimmer-render"));
        ctx.log(`Loaded ${rows.length.toLocaleString()} rows, ${headers.length} columns. Select columns and Run again.`);
        ui.setStatus("Select columns, then Run");
        return;
      }

      const box = /** @type {HTMLElement} */ (ui.extra.querySelector("[data-cols]"));
      const selected = checkedHeaders(box, headers);
      if (!selected.length) throw new Error("Select at least one column.");

      const freight = selected.find((col) => col.trim().toLowerCase() === "total receivable amount");
      let rename = false;
      if (freight) {
        rename = await confirmDialog(
          "Would you like to rename Total Receivable Amount to Freight Spend?",
          { title: "Rename Column", okLabel: "Rename", cancelLabel: "Keep" }
        );
      }

      const trimmed = rows.map((row) => {
        /** @type {Record<string, unknown>} */
        const out = {};
        for (const col of selected) {
          const key = rename && col === freight ? "FREIGHT SPEND" : col;
          out[key] = row[col] ?? "";
        }
        return out;
      });

      const outName = trimmedFileName();
      downloadWorkbook(objectsToWorkbook(trimmed, "Trimmed"), outName);
      ui.setStatus("Complete");
      ctx.log(`Saved ${outName} (${selected.length} columns, ${trimmed.length.toLocaleString()} rows)`);
    },
  });

  const input = parent.querySelector("[data-file-input]");
  input?.addEventListener("change", async () => {
    const file = /** @type {HTMLInputElement} */ (input).files?.[0];
    if (!file) return;
    try {
      await ensureXlsx();
      const buffer = await readFileBuffer(file);
      const parsed = workbookToObjects(buffer);
      headers = parsed.headers;
      rows = parsed.rows;
      parent.dispatchEvent(new CustomEvent("dalko-trimmer-render"));
      ctx.log(`Loaded columns from ${file.name} (${headers.length}), in sheet order.`);
    } catch (err) {
      headers = [];
      rows = [];
      parent.dispatchEvent(new CustomEvent("dalko-trimmer-render"));
      ctx.log(`Could not read columns: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  parent.querySelector("[data-clear]")?.addEventListener("click", () => {
    headers = [];
    rows = [];
    parent.dispatchEvent(new CustomEvent("dalko-trimmer-render"));
  });
}

/**
 * Checked columns in original sheet order, not the order they appear on screen.
 * @param {HTMLElement} box
 * @param {string[]} headers
 */
function checkedHeaders(box, headers) {
  /** @type {Set<string>} */
  const on = new Set();
  box.querySelectorAll("input[data-trim-col]:checked").forEach((node) => {
    on.add(/** @type {HTMLInputElement} */ (node).value);
  });
  return headers.filter((header) => on.has(header));
}

/**
 * @param {Record<string, string[]>} bundled
 * @param {Record<string, string[]>} local
 * @param {Set<string>} hidden
 */
function presetNames(bundled, local, hidden) {
  const names = new Set([
    ...Object.keys(bundled).filter((name) => !hidden.has(name)),
    ...Object.keys(local),
  ]);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {Record<string, string[]>} bundled
 */
async function loadBundled(bundled) {
  await Promise.all(
    BUNDLED_NAMES.map(async (name) => {
      try {
        const res = await fetch(`${PRESET_URL}/${encodeURIComponent(name)}.json`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) bundled[name] = data.map((col) => String(col));
      } catch {
        /* A missing preset file just stays off the list. */
      }
    })
  );
}

/** Python export name: TrimmedExcel_MddyyHmm.xlsx */
function trimmedFileName() {
  const d = new Date();
  const yy = String(d.getFullYear() % 100);
  const min = String(d.getMinutes()).padStart(2, "0");
  return `TrimmedExcel_${d.getMonth() + 1}${d.getDate()}${yy}${d.getHours()}${min}.xlsx`;
}

/**
 * @param {string} key
 * @returns {Record<string, string[]>}
 */
function readStore(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    /** @type {Record<string, string[]>} */
    const out = {};
    for (const [name, cols] of Object.entries(data)) {
      if (Array.isArray(cols)) out[name] = cols.map((col) => String(col));
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @param {string} key
 * @returns {string[]}
 */
function readList(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(data) ? data.map((name) => String(name)) : [];
  } catch {
    return [];
  }
}

/**
 * @param {string} key
 * @param {Record<string, string[]>} value
 */
function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * @param {string} key
 * @param {Set<string>} value
 */
function writeList(key, value) {
  localStorage.setItem(key, JSON.stringify([...value]));
}
