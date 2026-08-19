/**
 * Batch Mapper — web port of Glass Box Batch Mapper.py + profile transforms.
 */

import { mountToolShell } from "../_shared/tool-shell.js";
import {
  ensureXlsx,
  readFileBuffer,
  downloadWorkbook,
} from "../_shared/excel.js";
import { PROFILES, getProfile } from "./batch-profiles/index.js?v=20260804-profiles";

export const meta = {
  id: "Batch Mapper",
  title: "Batch Mapper",
  category: "Data Tools",
  script: "Data Tools/Batch Mapper.js",
};

const OUTPUT_FILENAME = "BatchRateSampleFile.xlsx";
const TEMPLATE_URL = new URL("../../data/BatchRateSampleFile_template.xlsx", import.meta.url).href;
const SKIP_LABEL = "— Skip —";

/** Same carrier list / codes as Python SCAC_OPTIONS */
const SCAC_OPTIONS = [
  ["FEDEX PRIORITY", "FXFE"],
  ["FEDEX ECONOMY", "FXNL"],
  ["AAA COOPER", "AACT"],
  ["AVERITT", "AVRT"],
  ["R&L CARRIER", "RLCA"],
  ["TFORCE", "TFIN"],
  ["ARCBEST", "ABFS"],
  ["ROADRUNNER", "RDFS"],
  ["CENTRAL TRANSPORT", "CTII"],
  ["SAIA", "SAIA"],
  ["SOUTHWESTERN MOTOR FREIGHT", "SMTL"],
  ["WARD", "WARD"],
  ["XPO", "CNWY"],
  ["DOHRN", "DHRN"],
  ["OLD DOMINON", "ODFL"],
  ["PITTSBURGH FAYETTE EXPRESS", "PFEP"],
  ["PITT OHIO", "PITD"],
];

const INSTRUCTIONS = `
Concept:
Map any incoming customer data file into the BatchRateSampleFile format.

Workflow:
1. Upload — choose your Excel or CSV file.
2. Profile — leave as Manual to map columns yourself, or pick a saved format (e.g. Boxlight Freight RFP).
3. Manual — shown only when Profile is Manual; hidden when a saved profile is selected.
4. Export — follows the selected profile rules, or Manual mapping when Manual is selected.
`.trim();

/**
 * @param {string} value
 */
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {string} text
 */
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { headers: /** @type {string[]} */ ([]), rows: /** @type {Record<string, unknown>[]} */ ([]) };
  /** @param {string} line */
  const split = (line) => {
    /** @type {string[]} */
    const cells = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const headers = split(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = split(line);
    /** @type {Record<string, unknown>} */
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
  return { headers, rows };
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function parseShipDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const d = new Date(String(value).trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  const shell = mountToolShell(parent, {
    title: meta.title,
    category: meta.category,
    instructions: INSTRUCTIONS,
    onBack: ctx.onBack,
    log: ctx.log,
  });

  const profileOptions = PROFILES.map(
    (p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`
  ).join("");

  shell.setStatus("Ready");
  shell.body.innerHTML = `
    <div class="gb-ws">
      <section class="gb-ws-step">
        <header class="gb-ws-step-head">
          <span class="gb-ws-step-num" aria-hidden="true">1</span>
          <div class="gb-ws-step-titles">
            <h4 class="gb-ws-step-title">Upload</h4>
            <p class="gb-ws-step-hint">Excel or CSV with column headers</p>
          </div>
        </header>
        <div class="gb-ws-step-body">
          <div class="gb-ws-file">
            <p class="gb-ws-file-name" data-file-label>No file selected</p>
            <div class="gb-ws-file-actions">
              <input type="file" hidden data-file-input accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
              <button type="button" class="btn btn-secondary" data-browse>Browse</button>
              <button type="button" class="btn btn-ghost" data-clear-file>Clear</button>
            </div>
          </div>
        </div>
      </section>

      <section class="gb-ws-step" data-profile-section>
        <header class="gb-ws-step-head">
          <span class="gb-ws-step-num" aria-hidden="true">2</span>
          <div class="gb-ws-step-titles">
            <h4 class="gb-ws-step-title">Profile</h4>
            <p class="gb-ws-step-hint">Manual unlocks column mapping; other options use saved rules</p>
          </div>
        </header>
        <div class="gb-ws-step-body">
          <div class="gb-batch-profile">
            <label class="gb-batch-profile-label" for="gb-batch-profile-select">Format</label>
            <select id="gb-batch-profile-select" class="gb-batch-profile-select" data-profile-select>
              ${profileOptions}
            </select>
          </div>
          <p class="gb-batch-profile-desc" data-profile-desc></p>
        </div>
      </section>

      <section class="gb-ws-step" data-manual-section>
        <header class="gb-ws-step-head">
          <span class="gb-ws-step-num" aria-hidden="true">3</span>
          <div class="gb-ws-step-titles">
            <h4 class="gb-ws-step-title">Manual</h4>
            <p class="gb-ws-step-hint">Map each template field to an input column</p>
          </div>
          <div class="gb-ws-step-tools">
            <button type="button" class="btn btn-secondary" data-automap>Auto-Map</button>
            <button type="button" class="btn btn-ghost" data-clear-map>Clear Map</button>
          </div>
        </header>
        <div class="gb-ws-step-body">
          <div class="gb-batch-rows" data-map-rows>
            <p class="gb-ws-empty">Upload a file to start mapping columns.</p>
          </div>
        </div>
      </section>

      <footer class="gb-ws-actions">
        <button type="button" class="btn btn-primary" data-export>Export</button>
      </footer>
    </div>
  `;

  /** @type {string[]} */
  let templateHeaders = [];
  /** @type {ArrayBuffer | null} */
  let templateBuffer = null;
  /** @type {string[]} */
  let inputColumns = [];
  /** @type {Record<string, unknown>[]} */
  let inputRows = [];
  /** @type {ArrayBuffer | null} */
  let sourceBuffer = null;
  /** @type {string} */
  let sourceName = "";
  /** @type {string} */
  let selectedProfileId = "manual";

  const fileInput = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-file-input]"));
  const fileLabel = /** @type {HTMLElement} */ (shell.body.querySelector("[data-file-label]"));
  const mapRows = /** @type {HTMLElement} */ (shell.body.querySelector("[data-map-rows]"));
  const profileSelect = /** @type {HTMLSelectElement} */ (shell.body.querySelector("[data-profile-select]"));
  const profileDesc = /** @type {HTMLElement} */ (shell.body.querySelector("[data-profile-desc]"));
  const manualSection = /** @type {HTMLElement} */ (shell.body.querySelector("[data-manual-section]"));

  const selectedProfile = () => getProfile(selectedProfileId);

  const syncModeUi = () => {
    const profile = selectedProfile();
    const usingProfile = !!(profile && profile.transform);
    profileSelect.value = selectedProfileId;
    manualSection.hidden = usingProfile;
    manualSection.classList.remove("is-disabled");
    profileDesc.textContent = profile?.description || "";
  };

  await ensureXlsx();
  try {
    const res = await fetch(TEMPLATE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    templateBuffer = await res.arrayBuffer();
    const XLSX = globalThis.XLSX;
    const wb = XLSX.read(templateBuffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = /** @type {unknown[][]} */ (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }));
    templateHeaders = (aoa[0] || []).map((h) => String(h ?? "").trim()).filter(Boolean);
    ctx.log(`Template loaded (${templateHeaders.length} columns).`);
  } catch (err) {
    ctx.log(`Template failed to load: ${err instanceof Error ? err.message : String(err)}`);
    mapRows.innerHTML = `<p class="gb-ws-empty text-danger">Template headers could not be loaded.</p>`;
  }

  const renderMappingRows = () => {
    if (!templateHeaders.length) {
      mapRows.innerHTML = `<p class="gb-ws-empty text-danger">Template headers could not be loaded.</p>`;
      return;
    }
    if (!inputColumns.length) {
      mapRows.innerHTML = `<p class="gb-ws-empty">Upload a file to start mapping columns.</p>`;
      return;
    }

    const opts = [`<option value="">${SKIP_LABEL}</option>`]
      .concat(inputColumns.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`))
      .join("");

    mapRows.innerHTML = templateHeaders
      .map((col, idx) => {
        const alt = idx % 2 ? " is-alt" : "";
        const isScac = col.trim().toLowerCase() === "scac";
        const display = isScac ? "SCAC" : col;

        if (col === "Shipdate") {
          return `<div class="gb-batch-row${alt}">
            <span class="gb-batch-col">${escapeHtml(display)}</span>
            <input type="text" class="gb-batch-shipdate" data-shipdate placeholder="MM/DD/YYYY" />
          </div>`;
        }

        if (isScac) {
          const boxes = [
            `<label class="gb-batch-scac-item"><input type="checkbox" data-scac-none checked /> None</label>`,
            ...SCAC_OPTIONS.map(
              ([label, code]) =>
                `<label class="gb-batch-scac-item"><input type="checkbox" data-scac-code="${escapeHtml(code)}" /> ${escapeHtml(label)}</label>`
            ),
          ].join("");
          return `<div class="gb-batch-row${alt} gb-batch-row-scac">
            <span class="gb-batch-col">${escapeHtml(display)}</span>
            <div class="gb-batch-scac" data-scac-box>${boxes}</div>
          </div>`;
        }

        return `<div class="gb-batch-row${alt}">
          <span class="gb-batch-col">${escapeHtml(display)}</span>
          <select class="gb-batch-select" data-map="${escapeHtml(col)}">${opts}</select>
        </div>`;
      })
      .join("");

    wireScacToggles();
  };

  const wireScacToggles = () => {
    const none = /** @type {HTMLInputElement | null} */ (mapRows.querySelector("[data-scac-none]"));
    const codes = /** @type {NodeListOf<HTMLInputElement>} */ (mapRows.querySelectorAll("[data-scac-code]"));
    none?.addEventListener("change", () => {
      if (none.checked) codes.forEach((c) => (c.checked = false));
      else if (![...codes].some((c) => c.checked)) none.checked = true;
    });
    codes.forEach((c) => {
      c.addEventListener("change", () => {
        if ([...codes].some((x) => x.checked)) {
          if (none) none.checked = false;
        } else if (none) none.checked = true;
      });
    });
  };

  const autoMap = () => {
    if (selectedProfile()?.transform) {
      ctx.log("Switch Profile to Manual to use Auto-Map.");
      return;
    }
    const lookup = Object.fromEntries(inputColumns.map((c) => [c.toLowerCase(), c]));
    mapRows.querySelectorAll("[data-map]").forEach((sel) => {
      const el = /** @type {HTMLSelectElement} */ (sel);
      const match = lookup[(el.dataset.map || "").toLowerCase()];
      el.value = match || "";
    });
    ctx.log("Auto-mapped columns by name.");
  };

  const clearMapping = () => {
    mapRows.querySelectorAll("[data-map]").forEach((sel) => {
      /** @type {HTMLSelectElement} */ (sel).value = "";
    });
    const ship = /** @type {HTMLInputElement | null} */ (mapRows.querySelector("[data-shipdate]"));
    if (ship) ship.value = "";
    mapRows.querySelectorAll("[data-scac-code]").forEach((el) => {
      /** @type {HTMLInputElement} */ (el).checked = false;
    });
    const none = /** @type {HTMLInputElement | null} */ (mapRows.querySelector("[data-scac-none]"));
    if (none) none.checked = true;
    ctx.log("Mapping cleared.");
  };

  /**
   * @returns {Record<string, unknown>[]}
   */
  const buildManualOutputRows = () => {
    const shipdate = /** @type {HTMLInputElement | null} */ (mapRows.querySelector("[data-shipdate]"))?.value.trim() || "";
    const scacCodes = [...mapRows.querySelectorAll("[data-scac-code]:checked")].map(
      (el) => /** @type {HTMLInputElement} */ (el).dataset.scacCode || ""
    );
    const scacValue = scacCodes.length ? scacCodes.join("/") : null;

    /** @type {Record<string, string>} */
    const mapping = {};
    mapRows.querySelectorAll("[data-map]").forEach((sel) => {
      const el = /** @type {HTMLSelectElement} */ (sel);
      if (el.value) mapping[el.dataset.map || ""] = el.value;
    });

    const weightCols = new Set(Array.from({ length: 9 }, (_, i) => `Weight${i + 1}`));

    return inputRows.map((row) => {
      /** @type {Record<string, unknown>} */
      const dest = {};
      for (const col of templateHeaders) {
        if (col === "Shipdate") {
          dest[col] = shipdate || null;
          continue;
        }
        if (col.trim().toLowerCase() === "scac") {
          dest[col] = scacValue;
          continue;
        }
        const src = mapping[col];
        if (!src) {
          dest[col] = null;
          continue;
        }
        let val = row[src];
        if (val === "" || val == null) {
          dest[col] = null;
          continue;
        }
        if (col === "OriginZip" || col === "DestinationZip") {
          dest[col] = String(val).replace(/ /g, "");
          continue;
        }
        if (weightCols.has(col)) {
          const n = Number(String(val).replace(/[,$]/g, ""));
          dest[col] = Number.isNaN(n) ? null : Math.round(n);
          continue;
        }
        dest[col] = val;
      }
      return dest;
    });
  };

  /**
   * @param {Record<string, unknown>[]} outRows
   */
  const writeTemplateWorkbook = (outRows) => {
    const XLSX = globalThis.XLSX;
    const wb = XLSX.read(templateBuffer.slice(0), { type: "array", cellStyles: true });
    const sheetName = wb.SheetNames[0];
    /** @type {unknown[][]} */
    const aoa = [templateHeaders];
    for (const row of outRows) {
      aoa.push(
        templateHeaders.map((h) => {
          const v = row[h];
          if (v == null || v === "") return "";
          if (h === "Shipdate") {
            const d = parseShipDate(v);
            return d || String(v);
          }
          if (h === "OriginZip" || h === "DestinationZip") return String(v);
          return v;
        })
      );
    }
    const newSheet = XLSX.utils.aoa_to_sheet(aoa);
    const zipIdx = templateHeaders
      .map((h, i) => (h === "OriginZip" || h === "DestinationZip" ? i : -1))
      .filter((i) => i >= 0);
    for (let R = 1; R < aoa.length; R++) {
      for (const C of zipIdx) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = newSheet[addr];
        if (cell && cell.v != null && cell.v !== "") {
          cell.t = "s";
          cell.v = String(cell.v);
        }
      }
      const shipC = templateHeaders.indexOf("Shipdate");
      if (shipC >= 0) {
        const addr = XLSX.utils.encode_cell({ r: R, c: shipC });
        const cell = newSheet[addr];
        if (cell?.v instanceof Date) {
          cell.t = "d";
          cell.z = "m/d/yyyy";
        }
      }
    }
    wb.Sheets[sheetName] = newSheet;
    downloadWorkbook(wb, OUTPUT_FILENAME);
  };

  const exportFile = async () => {
    if (!templateHeaders.length || !templateBuffer) {
      ctx.log("Template headers were not found.");
      shell.setStatus("No template");
      return;
    }

    const profile = selectedProfile();
    await ensureXlsx();

    try {
      /** @type {Record<string, unknown>[]} */
      let outRows;
      let modeLabel = "Manual";

      if (profile?.transform) {
        if (!sourceBuffer) {
          ctx.log("Please upload a file first.");
          shell.setStatus("Need file");
          return;
        }
        modeLabel = profile.label;
        const result = await profile.transform(sourceBuffer, {
          templateHeaders,
          log: ctx.log,
        });
        outRows = result.rows;
        if (!outRows.length) {
          ctx.log("Profile produced 0 rows — check the file matches this format.");
          shell.setStatus("No rows");
          return;
        }
      } else {
        if (!inputRows.length || !inputColumns.length) {
          ctx.log("Please upload a file first.");
          shell.setStatus("Need file");
          return;
        }
        outRows = buildManualOutputRows();
      }

      writeTemplateWorkbook(outRows);
      shell.setStatus("Complete");
      ctx.log(`Export complete (${modeLabel}): ${outRows.length.toLocaleString()} rows → ${OUTPUT_FILENAME}`);
    } catch (err) {
      ctx.log(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      shell.setStatus("Error");
    }
  };

  profileSelect.addEventListener("change", () => {
    selectedProfileId = profileSelect.value || "manual";
    syncModeUi();
    const p = selectedProfile();
    ctx.log(
      p?.transform
        ? `Profile selected: ${p.label} — Manual mapping hidden.`
        : "Profile: Manual — column mapping shown."
    );
  });
  syncModeUi();

  shell.body.querySelector("[data-browse]")?.addEventListener("click", () => fileInput.click());
  shell.body.querySelector("[data-clear-file]")?.addEventListener("click", () => {
    inputColumns = [];
    inputRows = [];
    sourceBuffer = null;
    sourceName = "";
    fileInput.value = "";
    fileLabel.textContent = "No file selected";
    renderMappingRows();
    shell.setStatus("Ready");
    ctx.log("File cleared.");
  });
  shell.body.querySelector("[data-automap]")?.addEventListener("click", () => autoMap());
  shell.body.querySelector("[data-clear-map]")?.addEventListener("click", () => clearMapping());
  shell.body.querySelector("[data-export]")?.addEventListener("click", () => {
    void exportFile();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      await ensureXlsx();
      sourceBuffer = await readFileBuffer(file);
      sourceName = file.name;
      const name = file.name.toLowerCase();

      if (name.endsWith(".csv")) {
        const text = await file.text();
        const parsed = parseCsv(text);
        inputColumns = parsed.headers;
        inputRows = parsed.rows;
      } else {
        const XLSX = globalThis.XLSX;
        const wb = XLSX.read(sourceBuffer, { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const aoa = /** @type {unknown[][]} */ (
          XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true })
        );
        if (!aoa.length) throw new Error("File has no rows.");
        inputColumns = aoa[0].map((h) => String(h ?? "").trim()).filter(Boolean);
        inputRows = [];
        for (let i = 1; i < aoa.length; i++) {
          const line = aoa[i] || [];
          if (line.every((c) => c === "" || c == null)) continue;
          /** @type {Record<string, unknown>} */
          const row = {};
          inputColumns.forEach((h, idx) => {
            row[h] = line[idx] ?? "";
          });
          inputRows.push(row);
        }
      }
      fileLabel.textContent = file.name;
      renderMappingRows();
      shell.setStatus(sourceName);
      const p = selectedProfile();
      ctx.log(
        `Loaded ${file.name}` +
          (p?.transform
            ? " (profile will parse on Export)."
            : ` (${inputRows.length.toLocaleString()} rows, ${inputColumns.length} columns).`)
      );
    } catch (err) {
      sourceBuffer = null;
      ctx.log(`Failed to load file: ${err instanceof Error ? err.message : String(err)}`);
      shell.setStatus("Error");
    }
  });

  renderMappingRows();
  ctx.log("Tool ready.");
}
