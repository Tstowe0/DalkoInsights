/**
 * Shared Ops Apps carrier load-form + Email Carriers draft
 * (Maddox / A. Stucki — matches Python Glass Box).
 */

import { mountToolShell } from "./tool-shell.js";
import { ensureXlsx, readFileBuffer } from "./excel.js";
import { openMailDraft } from "./mailto.js";

/**
 * Parse carrier emails from an Excel buffer — same rules as Python:
 * prefer "Carrier Emails" column, else first column; keep rows with "@".
 * @param {ArrayBuffer} buffer
 * @returns {string[]}
 */
export function parseCarrierEmails(buffer) {
  const XLSX = globalThis.XLSX;
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = /** @type {Record<string, unknown>[]} */ (
    XLSX.utils.sheet_to_json(sheet, { defval: "" })
  );
  if (!rows.length) {
    // header-only or blank — try column A via AOA
    const aoa = /** @type {unknown[][]} */ (
      XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
    );
    /** @type {string[]} */
    const emails = [];
    for (let i = 0; i < aoa.length; i++) {
      const cell = aoa[i]?.[0];
      const email = String(cell ?? "").trim();
      if (email && email.includes("@") && !/^carrier\s*emails$/i.test(email)) {
        emails.push(email);
      }
    }
    return emails;
  }

  const keys = Object.keys(rows[0]);
  const col =
    keys.find((k) => String(k).trim().toLowerCase() === "carrier emails") || keys[0];
  /** @type {string[]} */
  const emails = [];
  for (const row of rows) {
    const email = String(row[col] ?? "").trim();
    if (email && email.includes("@")) emails.push(email);
  }
  return emails;
}

/**
 * Subject stamp: HHMMSSDDMMYY — matches Python strftime("%H%M%S%d%m%y").
 */
export function quoteRequestSubject() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getDate())}${p(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}`;
  return `Dalko Quote Request ${stamp}`;
}

/**
 * @param {Record<string, string>} vals
 * @param {string} notes
 */
export function buildLoadEmailBody(vals, notes) {
  const lines = [
    "Origin",
    `Location Name: ${vals.origin_name || ""}`,
    `Street Address: ${vals.origin_street || ""}`,
    `City: ${vals.origin_city || ""}`,
    `State: ${vals.origin_state || ""}`,
    `Postal Code: ${vals.origin_zip || ""}`,
    "",
    "Destination",
    `Location Name: ${vals.dest_name || ""}`,
    `Street Address: ${vals.dest_street || ""}`,
    `City: ${vals.dest_city || ""}`,
    `State: ${vals.dest_state || ""}`,
    `Postal Code: ${vals.dest_zip || ""}`,
    "",
    "Shipment Information",
    `Load ID / Reference: ${vals.load_ref || ""}`,
    `Pickup Date: ${vals.pickup_date || ""}`,
    `Delivery Date: ${vals.delivery_date || ""}`,
    `Weight (lbs): ${vals.weight || ""}`,
    `Pieces: ${vals.pieces || ""}`,
  ];
  const notesTrim = (notes || "").trim();
  if (notesTrim && notesTrim !== "Special instructions") {
    lines.push("", "Notes", notesTrim);
  }
  return lines.join("\n");
}

/**
 * @typedef {object} CarrierEmailToolOpts
 * @property {string} title
 * @property {string} category
 * @property {string} formTitle  e.g. "Maddox Load Form"
 * @property {string} customerKey  Excel basename without .xlsx, e.g. "Maddox Carriers"
 * @property {() => void} onBack
 * @property {(msg: string) => void} [log]
 */

/**
 * @param {HTMLElement} parent
 * @param {CarrierEmailToolOpts} opts
 */
export async function mountCarrierEmailTool(parent, opts) {
  const { title, category, formTitle, customerKey, onBack, log } = opts;

  const bundledUrl = new URL(
    `../../data/CarrierEmails/${encodeURIComponent(customerKey)}.xlsx`,
    import.meta.url
  ).href;

  const shell = mountToolShell(parent, {
    title,
    category,
    instructions: `${formTitle}

Fill origin, destination, and shipment fields, then Email Carriers.
Carrier BCC list loads from:
• Bundled file data/CarrierEmails/${customerKey}.xlsx (if present), or
• An uploaded Excel list (column "Carrier Emails", or first column).

Same workflow as desktop Glass Box — attach nothing; carriers go in BCC.`,
    onBack,
    log,
  });

  shell.setStatus("Ready");
  shell.body.innerHTML = `
    <div class="gb-carrier-email">
      <div class="gb-carrier-list-bar">
        <div class="gb-file-row">
          <input type="file" hidden data-carrier-list accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" />
          <button type="button" class="btn btn-secondary" data-browse-list>Upload carrier list</button>
          <button type="button" class="btn btn-ghost" data-clear-list>Clear list</button>
        </div>
        <p class="gb-file-label" data-list-status>No carrier emails loaded</p>
      </div>

      <div class="gb-carrier-od">
        <section class="gb-carrier-tile">
          <h4>Origin</h4>
          <label>Location Name<input data-field="origin_name" placeholder="Origin facility or shipper" /></label>
          <label>Street Address<input data-field="origin_street" placeholder="123 Main St" /></label>
          <label>City<input data-field="origin_city" placeholder="City" /></label>
          <label>State<input data-field="origin_state" placeholder="State" /></label>
          <label>Postal Code<input data-field="origin_zip" placeholder="Zip" /></label>
        </section>
        <section class="gb-carrier-tile">
          <h4>Destination</h4>
          <label>Location Name<input data-field="dest_name" placeholder="Destination facility or consignee" /></label>
          <label>Street Address<input data-field="dest_street" placeholder="456 Market St" /></label>
          <label>City<input data-field="dest_city" placeholder="City" /></label>
          <label>State<input data-field="dest_state" placeholder="State" /></label>
          <label>Postal Code<input data-field="dest_zip" placeholder="Zip" /></label>
        </section>
      </div>

      <section class="gb-carrier-tile">
        <h4>Shipment Information</h4>
        <label>Load ID / Reference<input data-field="load_ref" placeholder="Load or reference number" /></label>
        <label>Pickup Date<input data-field="pickup_date" placeholder="MM/DD/YYYY" /></label>
        <label>Delivery Date<input data-field="delivery_date" placeholder="MM/DD/YYYY" /></label>
        <label>Weight (lbs)<input data-field="weight" placeholder="Weight" /></label>
        <label>Pieces<input data-field="pieces" placeholder="Quantity" /></label>
        <label class="gb-carrier-notes">Notes<textarea data-notes placeholder="Special instructions" rows="4"></textarea></label>
      </section>

      <div class="gb-carrier-actions">
        <button type="button" class="btn btn-primary" data-email-carriers>Email Carriers</button>
      </div>
    </div>
  `;

  /** @type {string[]} */
  let carrierEmails = [];

  const listStatus = /** @type {HTMLElement} */ (shell.body.querySelector("[data-list-status]"));
  const listInput = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-carrier-list]"));

  /** @param {string[]} emails @param {string} source */
  const setEmails = (emails, source) => {
    carrierEmails = emails;
    if (!emails.length) {
      listStatus.textContent = "No carrier emails loaded";
      shell.setStatus("Ready");
      return;
    }
    listStatus.textContent = `${emails.length.toLocaleString()} carrier email(s) loaded (${source})`;
    shell.setStatus(`${emails.length} carriers ready`);
    log?.(`Loaded ${emails.length} carrier emails from ${source}.`);
  };

  // Try bundled list first
  try {
    await ensureXlsx();
    const res = await fetch(bundledUrl);
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      setEmails(parseCarrierEmails(buffer), `${customerKey}.xlsx`);
    } else {
      log?.(`No bundled list at data/CarrierEmails/${customerKey}.xlsx — upload one to continue.`);
    }
  } catch {
    log?.(`Could not load bundled carrier list — upload ${customerKey}.xlsx if needed.`);
  }

  shell.body.querySelector("[data-browse-list]")?.addEventListener("click", () => listInput.click());
  shell.body.querySelector("[data-clear-list]")?.addEventListener("click", () => {
    carrierEmails = [];
    listInput.value = "";
    setEmails([], "");
    log?.("Carrier list cleared.");
  });

  listInput.addEventListener("change", async () => {
    const file = listInput.files?.[0];
    if (!file) return;
    try {
      await ensureXlsx();
      const buffer = await readFileBuffer(file);
      const emails = parseCarrierEmails(buffer);
      if (!emails.length) {
        log?.(`No valid emails found in ${file.name}.`);
        setEmails([], "");
        return;
      }
      setEmails(emails, file.name);
    } catch (err) {
      log?.(`Failed to read carrier list: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  shell.body.querySelector("[data-email-carriers]")?.addEventListener("click", () => {
    if (!carrierEmails.length) {
      log?.("No carrier emails found. Upload CarrierEmails list first.");
      shell.setStatus("Missing carrier list");
      return;
    }

    /** @type {Record<string, string>} */
    const vals = {};
    shell.body.querySelectorAll("[data-field]").forEach((el) => {
      const input = /** @type {HTMLInputElement} */ (el);
      vals[input.dataset.field || ""] = input.value.trim();
    });
    const notes = /** @type {HTMLTextAreaElement} */ (shell.body.querySelector("[data-notes]")).value;

    const subject = quoteRequestSubject();
    const body = buildLoadEmailBody(vals, notes);
    openMailDraft({
      bcc: carrierEmails.join(";"),
      subject,
      body,
    });
    log?.(`Opened carrier draft (${carrierEmails.length} BCC) — ${subject}`);
    shell.setStatus("Email draft opened");
  });

  log?.("Tool ready.");
}
