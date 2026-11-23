/**
 * Carrier Pricing register. Records live in dalkoinsights-carrier-pricing.
 * The rack on DELTA is the only reader. The page never sees the database.
 */

import { getAccount } from "../../../shared/js/auth.js?v=20261123-outlook-mail";
import { allowsAction, allowsMenu } from "../../../shared/js/permissions.js?v=20261123-outlook-mail";
import { RACK_ORIGIN, rackAuthHeaders } from "../../../shared/js/ftp-rack.js?v=20261123-outlook-mail";

const TYPES = ["New Carrier", "New Pricing Account", "Pricing Update", "Cancellation"];
const CATEGORIES = [
  "Blanket/NR",
  "Rail",
  "Dynamic",
  "Audit & Pay",
  "Collect",
  "Intermodal",
  "Military Baggage",
  "Pallet",
  "Volume/Spot",
  "Client Specific",
];

const PAGE_SIZE = 15;
const DAY = 86400000;

const COLUMNS = [
  ["carrier", "Carrier", false],
  ["type", "Activity", false],
  ["category", "Pricing Category", false],
  ["client", "Client", false],
  ["received", "Received", true],
  ["effective", "Effective", true],
  ["cancelled", "Cancellation", true],
  ["renewal", "Renewal", true],
];

/** @param {string} value */
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** @param {string[]} values @param {string} placeholder */
function options(values, placeholder) {
  return (
    `<option value="">${esc(placeholder)}</option>` +
    values.map((value) => `<option>${esc(value)}</option>`).join("")
  );
}

const isoDay = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const delta = (date, today) => Math.round((Date.parse(date) - Date.parse(today)) / DAY);

const activityDate = (row) => (row.type === "Cancellation" ? row.cancelled : row.effective);

const clientName = (row) => (row.category === "Client Specific" ? row.client : "");

function displayDate(value) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return esc(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function latestByAccount(rows, today) {
  const latest = new Map();
  for (const row of rows) {
    const when = activityDate(row);
    if (!when || when > today || row.review) continue;
    const current = latest.get(row.accountId);
    if (
      !current ||
      when > activityDate(current) ||
      (when === activityDate(current) &&
        (row.type === "Cancellation") - (current.type === "Cancellation") > 0)
    ) {
      latest.set(row.accountId, row);
    }
  }
  return latest;
}

function upcoming(rows, latest, today, window = 30) {
  return [...latest.values()]
    .filter(
      (row) =>
        row.type !== "Cancellation" &&
        row.renewal &&
        delta(row.renewal, today) <= window &&
        !rows.some(
          (change) =>
            change.accountId === row.accountId &&
            change.type === "Cancellation" &&
            !change.review &&
            change.cancelled > today &&
            change.cancelled <= row.renewal
        )
    )
    .sort((a, b) => a.renewal.localeCompare(b.renewal));
}

function rowStatus(row, latest, today) {
  if (row.review || !activityDate(row)) return "Needs review";
  if (activityDate(row) > today) return "Scheduled";
  if (row.type === "Cancellation") return "Cancelled";
  return latest.get(row.accountId)?.id === row.id ? "Active" : "History";
}

function workbookNoticeDate(notes = "") {
  return String(notes).match(/^Cancellation notice received: (\d{4}-\d{2}-\d{2})$/m)?.[1] || "";
}

/** @param {HTMLElement} host */
function paintAccess(host) {
  const add = host.querySelector("#cp-add");
  const exp = host.querySelector("#cp-export");
  if (add instanceof HTMLButtonElement) {
    add.hidden = !allowsAction("carrier-pricing:add");
    add.disabled = host.dataset.loaded !== "1";
  }
  if (exp instanceof HTMLElement) exp.hidden = !allowsAction("carrier-pricing:export");
}

/** @type {null | (() => Promise<void>)} */
let loadCurrent = null;

/** Load the register again once Microsoft sign-in has an account. */
export function reloadCarrierPricing() {
  if (loadCurrent && getAccount()) void loadCurrent();
}

/**
 * @param {HTMLElement} host
 * @param {(status: number) => void} onAccessDenied
 */
export function mountCarrierPricing(host, onAccessDenied) {
  if (!allowsMenu("carrier-pricing")) {
    onAccessDenied(403);
    return;
  }
  if (host.dataset.ready === "1") {
    paintAccess(host);
    return;
  }
  host.dataset.ready = "1";
  host.innerHTML = `
      <div class="cp-shell">
        <div class="cp-layout">
          <section class="cp-panel cp-register" aria-label="Agreement records">
            <div class="cp-filters">
              <label class="cp-search">
                <span aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.25" stroke="currentColor" stroke-width="1.8"/><path d="M16 16.5 20 20.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                </span>
                <input id="cp-q" type="search" placeholder="Search carrier, SCAC, account, or client" aria-label="Search carrier, SCAC, account, or client" />
              </label>
              <select id="cp-type-filter" aria-label="Activity type">${options(TYPES, "All activities")}</select>
              <select id="cp-category-filter" aria-label="Pricing Category">${options(["Null", ...CATEGORIES], "All categories")}</select>
              <label class="cp-mobile-sort" for="cp-mobile-sort">Sort by
                <select id="cp-mobile-sort" aria-label="Sort records">
                  <option value="effective:-1" selected>Effective, newest</option>
                  <option value="effective:1">Effective, oldest</option>
                  <option value="carrier:1">Carrier, A to Z</option>
                  <option value="renewal:1">Renewal, soonest</option>
                </select>
              </label>
              <button id="cp-clear" class="cp-text" type="button">Clear</button>
              <div class="cp-register-actions">
                <button id="cp-export" class="cp-secondary" type="button" disabled>Export CSV</button>
                <button id="cp-add" class="cp-gold" type="button">＋ Add record</button>
              </div>
            </div>
            <div id="cp-table" class="cp-table-wrap"></div>
            <div id="cp-pages" class="cp-pages">
              <span id="cp-page-label"></span>
              <p id="cp-count" aria-live="polite">Loading agreements…</p>
              <span id="cp-page-nav"></span>
            </div>
          </section>
          <aside class="cp-panel cp-renewals" aria-labelledby="cp-renewal-title">
            <div class="cp-panel-head">
              <div>
                <h2 id="cp-renewal-title">Renewal Alerts</h2>
                <p>Due within 30 days or overdue</p>
              </div>
              <span id="cp-renewal-count" class="cp-alert-count">0</span>
            </div>
            <div id="cp-renewals"><p class="cp-empty">No upcoming or overdue renewals.</p></div>
          </aside>
        </div>
        <div id="cp-detail-dialog" class="cp-dialog" hidden>
          <button type="button" class="cp-dialog-backdrop" data-cp-detail-close aria-label="Close"></button>
          <div class="cp-dialog-card cp-detail-card" role="dialog" aria-modal="true" aria-labelledby="cp-detail-title">
            <header class="cp-dialog-head"><h2 id="cp-detail-title">Agreement record</h2></header>
            <form id="cp-detail-form">
              <div class="cp-record-editor">
                <div class="cp-dialog-body">
                  <p id="cp-detail-error" class="cp-form-error" role="alert" hidden></p>
                  <div class="cp-fields">
                    <div class="cp-field-pair cp-wide">
                      <label class="cp-field" id="cp-edit-type">Activity Type
                        <select name="type">${options(TYPES, "Select activity type")}</select>
                      </label>
                    </div>
                    <div class="cp-field-pair cp-wide">
                      <label class="cp-field">Carrier Name
                        <input name="carrier" type="text" required maxlength="200" />
                      </label>
                      <label class="cp-field">SCAC
                        <input name="scac" type="text" maxlength="200" autocapitalize="characters" />
                      </label>
                    </div>
                    <div class="cp-field-pair cp-wide">
                      <label class="cp-field" id="cp-edit-category">Pricing Category
                        <select name="category">${options([...CATEGORIES].sort(), "Select pricing category")}</select>
                      </label>
                      <label class="cp-field" id="cp-edit-client" hidden>Client Name
                        <input name="client" type="text" maxlength="200" />
                      </label>
                    </div>
                    <div class="cp-field-pair cp-wide" id="cp-edit-received-sent">
                      <label class="cp-field">Agreement Received Date
                        <input name="received" type="date" />
                      </label>
                      <label class="cp-field">Agreement Sent By
                        <input name="sender" type="text" maxlength="200" />
                      </label>
                    </div>
                    <div class="cp-field-pair cp-wide" id="cp-edit-effective-renewal">
                      <label class="cp-field">Effective Date
                        <input name="effective" type="date" />
                      </label>
                      <label class="cp-field">Renewal Date
                        <input name="renewal" type="date" />
                      </label>
                    </div>
                    <label class="cp-field" id="cp-edit-cancelled" hidden>Cancellation Date
                      <input name="cancelled" type="date" />
                    </label>
                    <label class="cp-field" id="cp-edit-notice-received" hidden>Cancellation Notice Received Date
                      <input name="noticeReceived" type="date" />
                    </label>
                    <label class="cp-field cp-wide" id="cp-edit-notice" hidden>Cancellation Notice Given By
                      <input name="notice" type="text" maxlength="200" />
                    </label>
                    <label class="cp-field cp-wide">Pricing Account No. / Reference
                      <input name="account" type="text" maxlength="200" />
                    </label>
                    <label class="cp-field cp-wide" id="cp-edit-bill" hidden>Bill To Address
                      <textarea name="billToAddress" rows="4" maxlength="1200"></textarea>
                    </label>
                    <label class="cp-field cp-wide">Notes
                      <textarea name="notes" rows="8" maxlength="12000"></textarea>
                    </label>
                  </div>
                  <label class="cp-review"><input type="checkbox" name="review" /> Needs review</label>
                  <p id="cp-detail-meta" class="cp-fine"></p>
                  <section class="cp-files" aria-labelledby="cp-files-title">
                    <h3 id="cp-files-title">Agreement Files</h3>
                    <ul id="cp-file-list"></ul>
                    <div class="cp-file-attach" id="cp-file-attach">
                      <label class="cp-field" for="cp-file-input">Attach files
                        <span class="cp-fine">PDF, Office, CSV, text, or images · up to 15 MB each</span>
                        <input id="cp-file-input" name="files" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.tif,.tiff" />
                      </label>
                      <button type="button" class="cp-secondary" id="cp-upload-file">Upload</button>
                    </div>
                  </section>
                  <section class="cp-history" id="cp-history" hidden aria-labelledby="cp-history-title">
                    <h3 id="cp-history-title">Account Activity</h3>
                    <div id="cp-history-list"></div>
                    <div class="cp-follow">
                      <button type="button" class="cp-text" data-follow="Pricing Update">Log pricing update</button>
                      <button type="button" class="cp-text" data-follow="Cancellation">Log cancellation</button>
                    </div>
                  </section>
                </div>
                <aside class="cp-comments" aria-labelledby="cp-comments-title">
                  <h3 id="cp-comments-title">Comments</h3>
                  <ul id="cp-comment-list"></ul>
                  <div id="cp-comment-compose">
                    <label class="cp-field">New comment
                      <textarea id="cp-comment-draft" rows="3" maxlength="2000"></textarea>
                    </label>
                    <button type="button" class="cp-secondary" id="cp-add-comment">Add comment</button>
                  </div>
                </aside>
              </div>
              <div class="cp-form-actions">
                <button type="button" class="cp-secondary" data-cp-detail-close>Close</button>
                <button type="button" class="cp-gold" id="cp-edit" hidden>Edit record</button>
                <button class="cp-gold" type="submit" id="cp-save">Save record</button>
              </div>
            </form>
          </div>
        </div>
        <div id="cp-action-dialog" class="cp-dialog cp-action-layer" hidden>
          <button type="button" class="cp-dialog-backdrop" data-cp-action-close aria-label="Close"></button>
          <div class="cp-dialog-card cp-action-card" role="dialog" aria-modal="true" aria-labelledby="cp-action-title">
            <header class="cp-dialog-head"><h2 id="cp-action-title"></h2></header>
            <div class="cp-dialog-body" id="cp-action-body"></div>
            <div class="cp-form-actions">
              <button type="button" class="cp-secondary" data-cp-action-close>Close</button>
              <button type="button" class="cp-gold" id="cp-action-confirm" hidden></button>
            </div>
          </div>
        </div>
      </div>`;

  const table = host.querySelector("#cp-table");
  if (table instanceof HTMLElement) table.style.setProperty("--cp-page-rows", String(PAGE_SIZE));

  /** @type {Record<string, any>[]} */
  let records = [];
  let sort = { key: "effective", direction: -1 };
  let page = 1;
  let loaded = false;
  const today = isoDay(new Date());

  const byId = (id) => host.querySelector(`#${id}`);

  function filterRows() {
    const searchBox = byId("cp-q");
    const typeBox = byId("cp-type-filter");
    const categoryBox = byId("cp-category-filter");
    const query = (searchBox instanceof HTMLInputElement ? searchBox.value : "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const type = typeBox instanceof HTMLSelectElement ? typeBox.value : "";
    const category = categoryBox instanceof HTMLSelectElement ? categoryBox.value : "";
    const value = (row) => (sort.key === "client" ? clientName(row) : row[sort.key]);
    return records
      .filter((row) => {
        const search = [row.carrier, row.scac, row.account, row.client].join(" ").toLowerCase();
        const matchesCategory =
          category === "Null" ? !String(row.category ?? "").trim() : !category || row.category === category;
        return (!type || row.type === type) && matchesCategory && query.every((term) => search.includes(term));
      })
      .sort((a, b) => {
        const left = value(a);
        const right = value(b);
        if (!left || !right) return left ? -1 : right ? 1 : 0;
        return String(left).localeCompare(String(right), undefined, { numeric: true }) * sort.direction;
      });
  }

  function render() {
    if (!loaded) return;
    host.dataset.loaded = "1";
    const latest = latestByAccount(records, today);
    const rows = filterRows();
    const alerts = upcoming(records, latest, today);
    const count = byId("cp-renewal-count");
    const renewals = byId("cp-renewals");
    if (count) count.textContent = String(alerts.length);
    if (renewals) {
      renewals.innerHTML = alerts.length
        ? alerts
            .map((row) => {
              const days = delta(row.renewal, today);
              const label =
                days < 0
                  ? `${Math.abs(days)} days overdue`
                  : days
                    ? `Due in ${days} ${days === 1 ? "day" : "days"}`
                    : "Due today";
              return `<button type="button" class="cp-renewal" data-record="${esc(row.id)}"><strong>${esc(row.carrier || row.scac)}</strong><small>${esc(
                [row.account || row.category, displayDate(row.renewal)].filter(Boolean).join(" · ")
              )}</small><span class="cp-badge${days < 0 ? " is-overdue" : ""}">${esc(label)}</span></button>`;
            })
            .join("")
        : `<p class="cp-empty">No upcoming or overdue renewals.</p>`;
    }
    const result = byId("cp-count");
    if (result) {
      result.textContent =
        rows.length === records.length
          ? `${rows.length} ${rows.length === 1 ? "activity record" : "activity records"}`
          : `${rows.length} of ${records.length} activity records`;
    }
    const mobile = byId("cp-mobile-sort");
    if (mobile instanceof HTMLSelectElement) {
      const next = `${sort.key}:${sort.direction}`;
      if ([...mobile.options].some((option) => option.value === next)) mobile.value = next;
    }
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    page = Math.min(page, totalPages);
    const header = COLUMNS.map(([key, label]) => {
      const active = sort.key === key;
      const arrow = active ? (sort.direction === 1 ? " ↑" : " ↓") : "";
      const aria = active ? (sort.direction === 1 ? "ascending" : "descending") : "none";
      return `<th role="columnheader" scope="col" aria-sort="${aria}"><button type="button" data-sort="${key}">${label}${arrow}</button><span class="cp-mobile-label" aria-hidden="true">${label}</span></th>`;
    }).join("");
    const listing = rows
      .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      .map((row) => {
        const name = row.carrier || row.scac || row.sourceTitle || "Review imported task";
        const sub = [row.scac, row.account].filter(Boolean).join(" · ");
        return (
          `<tr role="row">` +
          COLUMNS.map(([key, label, date]) => {
            if (key === "carrier") {
              return `<td role="cell" class="cp-name-cell"><button type="button" class="cp-row-link" data-record="${esc(row.id)}">${esc(name)}</button>${
                sub ? `<span class="cp-sub">${esc(sub)}</span>` : ""
              }</td>`;
            }
            const value = key === "client" ? clientName(row) : row[key];
            const shown = date ? displayDate(value) : esc(value || (key === "type" ? "Unclassified" : "—"));
            return `<td role="cell"><span class="cp-mobile-label" aria-hidden="true">${label}</span>${shown}</td>`;
          }).join("") +
          `<td role="cell" class="cp-actions"><span class="cp-mobile-label" aria-hidden="true">Actions</span>${
            allowsAction("carrier-pricing:email")
              ? `<button type="button" class="cp-text cp-row-action" data-email="${esc(row.id)}">Email</button>`
              : ""
          }${
            allowsAction("carrier-pricing:delete")
              ? `<button type="button" class="cp-text cp-row-action cp-danger" data-delete="${esc(row.id)}" aria-label="Delete ${esc(name)}">Delete</button>`
              : ""
          }</td></tr>`
        );
      })
      .join("");
    if (table instanceof HTMLElement) {
      table.innerHTML = `<table role="table"><thead role="rowgroup"><tr role="row">${header}<th role="columnheader" scope="col">Actions</th></tr></thead><tbody role="rowgroup">${
        listing ||
        `<tr role="row"><td role="cell" class="cp-empty" colspan="${COLUMNS.length + 1}">${
          records.length ? "No records match these filters." : "No agreements yet. Use Add record to get started."
        }</td></tr>`
      }</tbody></table>`;
    }
    const label = byId("cp-page-label");
    if (label) label.textContent = `Page ${page} of ${totalPages}`;
    const nav = byId("cp-page-nav");
    if (nav) {
      nav.innerHTML = `<button class="cp-secondary" type="button" data-page="-1"${
        page === 1 ? " disabled" : ""
      }>Previous</button><button class="cp-secondary" type="button" data-page="1"${
        page === totalPages ? " disabled" : ""
      }>Next</button>`;
    }
    const exp = byId("cp-export");
    if (exp instanceof HTMLButtonElement) exp.disabled = !rows.length;
    paintAccess(host);
  }

  function showMessage(message, retry) {
    if (table instanceof HTMLElement) {
      table.innerHTML = `<table role="table"><tbody><tr><td class="cp-empty" colspan="${COLUMNS.length + 1}">${esc(
        message
      )}${retry ? ` <button type="button" class="cp-text" data-retry>Try again</button>` : ""}</td></tr></tbody></table>`;
    }
    const result = byId("cp-count");
    if (result) result.textContent = retry ? "0 activity records" : "Loading agreements…";
  }

  const MAX_BILL_TO_LINES = 4;

  function hasBillTo(type) {
    return type === "New Carrier" || type === "New Pricing Account";
  }

  function matchingAccount(row) {
    const normalize = (value) => String(value || "").trim().toLowerCase();
    if (!normalize(row.account)) return row.id;
    const keys = ["carrier", "category", "client", "account"];
    const matches = records.filter(
      (record) =>
        record.id === record.accountId &&
        keys.every((key) => normalize(record[key]) === normalize(row[key])) &&
        (!row.scac || !record.scac || normalize(record.scac) === normalize(row.scac))
    );
    return matches.length === 1 ? matches[0].id : row.id;
  }

  async function loadRecords() {
    if (!allowsMenu("carrier-pricing")) {
      onAccessDenied(403);
      return;
    }
    loaded = false;
    host.dataset.loaded = "";
    showMessage("Loading agreements…", false);
    try {
      const headers = await rackAuthHeaders();
      const res = await fetch(`${RACK_ORIGIN}/api/carrier-pricing`, { cache: "no-store", headers });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403 || !allowsMenu("carrier-pricing")) {
        records = [];
        delete host.dataset.ready;
        onAccessDenied(res.status === 401 ? 401 : 403);
        return;
      }
      if (res.status === 404) {
        showMessage("The rack needs a restart before Carrier Pricing can load.", true);
        return;
      }
      if (!res.ok || !Array.isArray(data.records)) {
        showMessage(data.error || "Carrier Pricing did not load.", true);
        return;
      }
      records = data.records;
      page = 1;
      loaded = true;
      render();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Carrier Pricing did not load.", true);
    }
  }

  function exportCsv() {
    const latest = latestByAccount(records, today);
    const header = [
      "Carrier Name",
      "SCAC",
      "Activity Type",
      "Pricing Category",
      "Client",
      "Pricing Account",
      "Agreement Received",
      "Effective Date",
      "Cancellation Date",
      "Renewal Date",
      "Agreement Sent By",
      "Cancellation Notice Given By",
      "Cancellation Notice Received Date",
      "Bill To Address",
      "Status",
      "Notes",
      "Source Task",
      "Last Updated By",
    ];
    const keys = [
      "carrier",
      "scac",
      "type",
      "category",
      "client",
      "account",
      "received",
      "effective",
      "cancelled",
      "renewal",
      "sender",
      "notice",
    ];
    const rows = filterRows().map((row) => [
      ...keys.map((key) => row[key]),
      row.type === "Cancellation" ? row.noticeReceived || workbookNoticeDate(row.notes) : "",
      row.billToAddress || "",
      rowStatus(row, latest, today),
      row.notes,
      row.sourceTitle,
      row.updatedBy,
    ]);
    const csv = (value) => {
      const text = String(value ?? "");
      return `"${/^[\s]*[=+@-]|^[\t\r]/.test(text) ? "'" : ""}${text.replaceAll('"', '""')}"`;
    };
    const url = URL.createObjectURL(
      new Blob(["\ufeff", [header, ...rows].map((row) => row.map(csv).join(",")).join("\r\n")], {
        type: "text/csv",
      })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `carrier-agreements-${today}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const MAX_FILE = 15 * 1024 * 1024;
  const FILE_EXT = /\.(pdf|docx?|xlsx?|csv|txt|png|jpe?g|tiff?)$/i;
  let detailId = "";
  let linkedAccount = "";
  let viewing = false;
  let detailBusy = false;
  let actionId = "";
  let actionMode = "";
  let actionBusy = false;
  /** @type {string[]} */
  let pendingComments = [];
  /** @type {File[]} */
  let pendingFiles = [];

  function showDetailError(message) {
    const error = byId("cp-detail-error");
    if (!(error instanceof HTMLElement)) return;
    error.textContent = message;
    error.hidden = !message;
  }

  function currentDetail() {
    return records.find((row) => row.id === detailId) || null;
  }

  function detailControl(name) {
    const form = byId("cp-detail-form");
    if (!(form instanceof HTMLFormElement)) return null;
    const control = form.elements.namedItem(name);
    return control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
      ? control
      : null;
  }

  function unlockRecord() {
    const form = byId("cp-detail-form");
    if (!(form instanceof HTMLFormElement)) return;
    for (const control of form.elements) {
      if (
        !(
          control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLTextAreaElement
        )
      ) {
        continue;
      }
      if (control.type === "button" || control.type === "submit") continue;
      control.disabled = false;
    }
  }

  function syncDetailForm() {
    if (!viewing) unlockRecord();
    const type = detailControl("type")?.value || "";
    const category = detailControl("category")?.value || "";
    const review = detailControl("review");
    const needsReview = review instanceof HTMLInputElement && review.checked;
    const isCancel = type === "Cancellation";
    const show = (id, visible) => {
      const node = byId(id);
      if (node instanceof HTMLElement) node.hidden = !visible;
    };
    show("cp-edit-received-sent", !isCancel);
    show("cp-edit-effective-renewal", !isCancel);
    show("cp-edit-client", category === "Client Specific");
    show("cp-edit-cancelled", isCancel);
    show("cp-edit-notice", isCancel);
    show("cp-edit-notice-received", isCancel);
    const showBill = hasBillTo(type);
    show("cp-edit-bill", showBill);
    const bill = detailControl("billToAddress");
    if (bill instanceof HTMLTextAreaElement) {
      bill.disabled = !showBill;
      const lines = bill.value.split("\n").length;
      bill.setCustomValidity(!bill.disabled && lines > MAX_BILL_TO_LINES ? "Enter a Bill To Address with up to four lines." : "");
    }
    const visible = {
      client: category === "Client Specific",
      cancelled: isCancel,
      notice: isCancel,
      noticeReceived: isCancel,
      received: !isCancel,
      effective: !isCancel,
      sender: !isCancel,
      renewal: !isCancel,
    };
    for (const [key, on] of Object.entries(visible)) {
      const input = detailControl(key);
      if (input instanceof HTMLInputElement) input.disabled = !on;
    }
    const required = {
      type: true,
      category: true,
      client: category === "Client Specific",
      effective: !isCancel,
      cancelled: isCancel,
    };
    for (const [key, on] of Object.entries(required)) {
      const input = detailControl(key);
      if (input instanceof HTMLSelectElement || input instanceof HTMLInputElement) input.required = !needsReview && on;
    }
    const stored = currentDetail();
    const typeBox = detailControl("type");
    if (typeBox instanceof HTMLSelectElement && stored?.type) typeBox.disabled = true;
    if (viewing && stored) lockRecord();
    paintRecordChrome();
  }

  function lockRecord() {
    const form = byId("cp-detail-form");
    if (!(form instanceof HTMLFormElement)) return;
    for (const control of form.elements) {
      if (
        !(
          control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLTextAreaElement
        )
      ) {
        continue;
      }
      if (control.type === "button" || control.type === "submit") continue;
      control.disabled = true;
      control.required = false;
    }
  }

  function paintRecordChrome() {
    const existing = Boolean(currentDetail());
    const showView = existing && viewing;
    const title = byId("cp-detail-title");
    if (title) {
      title.textContent = existing
        ? `Agreement record (${showView ? "View Mode" : "Editing"})`
        : "Add agreement record";
    }
    const edit = byId("cp-edit");
    const save = byId("cp-save");
    const canEdit = allowsAction("carrier-pricing:edit");
    if (edit instanceof HTMLButtonElement) {
      edit.hidden = !showView || !canEdit;
      edit.disabled = detailBusy;
    }
    if (save instanceof HTMLButtonElement) {
      save.hidden = showView;
      save.disabled = showView || detailBusy;
    }
    const compose = byId("cp-comment-compose");
    if (compose instanceof HTMLElement) compose.hidden = showView;
    const attach = byId("cp-file-attach");
    if (attach instanceof HTMLElement) attach.hidden = showView;
    const upload = byId("cp-upload-file");
    if (upload instanceof HTMLButtonElement) upload.disabled = detailBusy;
    const form = byId("cp-detail-form");
    if (form instanceof HTMLElement) form.classList.toggle("cp-is-view", showView);
  }

  function beginEdit() {
    if (detailBusy || !currentDetail() || !allowsAction("carrier-pricing:edit")) return;
    viewing = false;
    syncDetailForm();
    const focus = detailControl("type")?.disabled ? detailControl("carrier") : detailControl("type");
    if (focus instanceof HTMLElement) focus.focus();
  }

  function renderHistory(row) {
    const section = byId("cp-history");
    const list = byId("cp-history-list");
    if (!(section instanceof HTMLElement) || !(list instanceof HTMLElement)) return;
    if (!row) {
      section.hidden = true;
      list.innerHTML = "";
      return;
    }
    section.hidden = false;
    const canFollow = allowsAction("carrier-pricing:add");
    section.querySelectorAll("[data-follow]").forEach((button) => {
      if (button instanceof HTMLElement) button.hidden = !canFollow;
    });
    const history = records
      .filter((item) => item.accountId && item.accountId === row.accountId && item.id !== row.id)
      .sort((a, b) => String(activityDate(b)).localeCompare(String(activityDate(a))));
    list.innerHTML = history.length
      ? `<ul>${history
          .map(
            (item) =>
              `<li><button type="button" class="cp-row-link" data-record="${esc(item.id)}">${esc(item.type || "Unclassified")} · ${displayDate(activityDate(item))}</button></li>`
          )
          .join("")}</ul>`
      : `<p class="cp-fine">No other activity for this account.</p>`;
  }

  function renderDetailLists(row) {
    const files = Array.isArray(row?.files) ? row.files : [];
    const fileList = byId("cp-file-list");
    if (fileList) {
      const waiting = pendingFiles.map(
        (file) => `<li><span>${esc(file.name)}</span> <span class="cp-fine">Pending save</span></li>`
      );
      const saved = files.map(
        (file) =>
          `<li><button type="button" class="cp-row-link" data-file="${esc(file.id)}">${esc(file.name)}</button></li>`
      );
      const items = waiting.concat(saved);
      fileList.innerHTML = items.length ? items.join("") : `<li class="cp-fine">No files yet.</li>`;
    }
    const comments = Array.isArray(row?.comments) ? row.comments : [];
    const saved = comments.map((comment) => {
      const when = comment.at ? new Date(comment.at).toLocaleString() : "";
      return `<li><div class="cp-comment-meta"><strong>${esc(comment.author || "")}</strong> <time datetime="${esc(
        comment.at || ""
      )}">${esc(when)}</time></div><p>${esc(comment.text || "")}</p></li>`;
    });
    const pending = pendingComments.map(
      (text) => `<li><div class="cp-comment-meta">Pending save</div><p>${esc(text)}</p></li>`
    );
    const commentList = byId("cp-comment-list");
    if (commentList) {
      const items = saved.concat(pending);
      const empty = viewing && row ? "No comments yet. Edit record to add a comment." : "No comments yet.";
      commentList.innerHTML = items.length ? items.join("") : `<li class="cp-fine">${empty}</li>`;
    }
    const meta = byId("cp-detail-meta");
    if (meta) {
      const bits = [];
      if (row?.sourceTitle || row?.sourceId) bits.push(`Source task · ${row.sourceTitle || row.sourceId}`);
      if (row?.updatedBy) bits.push(`Last updated by ${row.updatedBy}`);
      meta.textContent = bits.join(" · ");
      meta.hidden = !bits.length;
    }
    renderHistory(row);
  }

  function fillDetail(row) {
    const set = (name, value) => {
      const control = detailControl(name);
      if (control && !(control instanceof HTMLInputElement && control.type === "checkbox")) control.value = value || "";
    };
    set("type", row.type);
    set("carrier", row.carrier);
    set("scac", row.scac);
    set("category", row.category);
    set("client", row.client);
    set("account", row.account);
    set("received", row.received);
    set("sender", row.sender);
    set("effective", row.effective);
    set("renewal", row.renewal);
    set("cancelled", row.cancelled);
    set("notice", row.notice);
    set("noticeReceived", row.noticeReceived);
    set("billToAddress", row.billToAddress);
    set("notes", row.notes);
    const review = detailControl("review");
    if (review instanceof HTMLInputElement) review.checked = Boolean(row.review);
    const type = detailControl("type");
    if (type instanceof HTMLSelectElement) type.disabled = Boolean(row.type);
    pendingComments = [];
    pendingFiles = [];
    const draft = byId("cp-comment-draft");
    if (draft instanceof HTMLTextAreaElement) draft.value = "";
    const input = byId("cp-file-input");
    if (input instanceof HTMLInputElement) input.value = "";
    renderDetailLists(row);
    syncDetailForm();
  }

  function closeDetail() {
    if (detailBusy) return;
    const dialog = byId("cp-detail-dialog");
    if (dialog instanceof HTMLElement) dialog.hidden = true;
    detailId = "";
    linkedAccount = "";
    viewing = false;
  }

  function fillFromAccount(id) {
    const parent = latestByAccount(records, today).get(id) || records.find((row) => row.id === id);
    if (!parent) return;
    for (const key of ["carrier", "scac", "category", "client", "account", "renewal"]) {
      const control = detailControl(key);
      if (control && !(control instanceof HTMLInputElement && control.type === "checkbox")) control.value = parent[key] || "";
    }
  }

  function openAgreement(options = {}) {
    if (detailBusy || host.dataset.loaded !== "1") return;
    const row = options.id ? records.find((item) => item.id === options.id) : null;
    if (options.id && !row) return;
    detailId = row ? row.id : "";
    linkedAccount = row ? "" : options.accountId || "";
    viewing = Boolean(row);
    showDetailError("");
    const title = byId("cp-detail-title");
    if (title) title.textContent = row ? "Agreement record" : "Add agreement record";
    if (row) fillDetail(row);
    else {
      const form = byId("cp-detail-form");
      if (form instanceof HTMLFormElement) form.reset();
      const type = detailControl("type");
      if (type instanceof HTMLSelectElement) {
        type.disabled = false;
        if (options.startType) type.value = options.startType;
      }
      pendingComments = [];
      pendingFiles = [];
      const draft = byId("cp-comment-draft");
      if (draft instanceof HTMLTextAreaElement) draft.value = "";
      const input = byId("cp-file-input");
      if (input instanceof HTMLInputElement) input.value = "";
      if (linkedAccount) fillFromAccount(linkedAccount);
      renderDetailLists(null);
      syncDetailForm();
    }
    const dialog = byId("cp-detail-dialog");
    if (dialog instanceof HTMLElement) dialog.hidden = false;
    if (row && viewing) {
      const edit = byId("cp-edit");
      if (edit instanceof HTMLElement && !edit.hidden) edit.focus();
      return;
    }
    const focus = detailControl("type")?.disabled ? detailControl("carrier") : detailControl("type");
    if (focus instanceof HTMLElement) focus.focus();
  }

  function rackMessage(status, data, unknown, fallback) {
    if (status === 404 && (!data.error || data.error === "Unknown request")) return unknown;
    return data.error || fallback;
  }

  function addComment() {
    const draft = byId("cp-comment-draft");
    if (!(draft instanceof HTMLTextAreaElement) || detailBusy || (viewing && currentDetail())) return;
    const text = draft.value.trim();
    if (!text) return;
    if (pendingComments.length >= 50) {
      showDetailError("Save up to 50 new comments at a time.");
      return;
    }
    pendingComments.push(text);
    draft.value = "";
    showDetailError("");
    renderDetailLists(currentDetail());
    draft.focus();
  }

  function chosenFiles() {
    const input = byId("cp-file-input");
    return input instanceof HTMLInputElement ? [...input.files] : [];
  }

  function stageFiles() {
    if (detailBusy || (viewing && currentDetail())) return;
    const input = byId("cp-file-input");
    if (!(input instanceof HTMLInputElement)) return;
    const picked = [...input.files];
    if (!picked.length) {
      showDetailError("Choose a file, then Upload.");
      return;
    }
    if (picked.some((file) => !file.size || file.size > MAX_FILE || !FILE_EXT.test(file.name))) {
      input.value = "";
      showDetailError("Select supported files of 15 MB or less.");
      return;
    }
    if (pendingFiles.length + picked.length > 20) {
      showDetailError("Upload up to 20 files before saving.");
      return;
    }
    pendingFiles = picked.concat(pendingFiles);
    input.value = "";
    showDetailError("");
    renderDetailLists(currentDetail());
  }

  function remember(record) {
    const known = records.some((item) => item.id === record.id);
    records = known ? records.map((item) => (item.id === record.id ? record : item)) : [record, ...records];
  }

  async function saveDetail(event) {
    event.preventDefault();
    const existing = currentDetail();
    const form = byId("cp-detail-form");
    if (detailBusy || !(form instanceof HTMLFormElement) || (existing && viewing)) return;
    if (existing && !allowsAction("carrier-pricing:edit")) {
      showDetailError("Your group cannot edit a Carrier Pricing record.");
      return;
    }
    if (!existing && !allowsAction("carrier-pricing:add")) {
      showDetailError("Your group cannot add a Carrier Pricing record.");
      return;
    }
    if (!form.reportValidity()) return;
    const type = detailControl("type");
    const category = detailControl("category");
    const carrier = detailControl("carrier");
    const scac = detailControl("scac");
    if (!(type instanceof HTMLSelectElement) || !(category instanceof HTMLSelectElement)) return;
    if (!(carrier instanceof HTMLInputElement) || !(scac instanceof HTMLInputElement)) return;
    const activity = type.value;
    const isCancel = activity === "Cancellation";
    const value = (name) => detailControl(name)?.value.trim() || "";
    const scacText = scac.value.trim().toUpperCase();
    if (scacText && scacText !== "SAI1" && !/^[A-Z]{2,4}(?:\s*[/,]\s*[A-Z]{2,4})*$/.test(scacText)) {
      showDetailError("Enter two to four letters per SCAC. Use / between multiple codes.");
      return;
    }
    const draft = byId("cp-comment-draft");
    const newComments = [...pendingComments, draft instanceof HTMLTextAreaElement ? draft.value.trim() : ""].filter(Boolean);
    if (newComments.length > 50) {
      showDetailError("Save up to 50 new comments at a time.");
      return;
    }
    if (chosenFiles().length) {
      showDetailError("Click Upload to add the selected files before saving.");
      return;
    }
    const files = [...pendingFiles];
    const id = existing ? existing.id : crypto.randomUUID();
    const draftRow = {
      id,
      carrier: carrier.value.trim(),
      scac: scacText,
      category: category.value,
      client: category.value === "Client Specific" ? value("client") : "",
      account: value("account"),
    };
    const accountId = existing
      ? existing.accountId || existing.id
      : activity === "Pricing Update" || activity === "Cancellation"
        ? linkedAccount || matchingAccount(draftRow)
        : id;
    const body = {
      id,
      updatedAt: existing?.updatedAt || "",
      accountId,
      type: activity,
      carrier: carrier.value.trim(),
      scac: scacText,
      category: category.value,
      client: category.value === "Client Specific" ? value("client") : "",
      account: value("account"),
      received: isCancel ? "" : value("received"),
      sender: isCancel ? "" : value("sender"),
      effective: isCancel ? "" : value("effective"),
      renewal: isCancel ? "" : value("renewal"),
      cancelled: isCancel ? value("cancelled") : "",
      notice: isCancel ? value("notice") : "",
      noticeReceived: isCancel ? value("noticeReceived") : "",
      billToAddress: hasBillTo(activity) ? value("billToAddress") : "",
      notes: value("notes"),
      review: detailControl("review") instanceof HTMLInputElement && detailControl("review").checked,
      newComments,
    };
    const submit = form.querySelector('[type="submit"]');
    detailBusy = true;
    if (submit instanceof HTMLButtonElement) {
      submit.disabled = true;
      submit.textContent = "Saving…";
    }
    showDetailError("");
    let savedRecord = null;
    let completed = 0;
    try {
      const headers = await rackAuthHeaders({ "Content-Type": "application/json" });
      const res = await fetch(`${RACK_ORIGIN}/api/carrier-pricing`, {
        method: existing ? "PUT" : "POST",
        cache: "no-store",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.record) {
        showDetailError(
          rackMessage(
            res.status,
            data,
            existing
              ? "The rack needs a restart before this agreement can be saved."
              : "The rack needs a restart before a new record can be saved.",
            "The record did not save."
          )
        );
        return;
      }
      savedRecord = data.record;
      savedRecord.files = Array.isArray(savedRecord.files) ? savedRecord.files : [];
      linkedAccount = "";
      for (const file of files) {
        const fileHeaders = await rackAuthHeaders({ "X-Filename": encodeURIComponent(file.name) });
        const uploaded = await fetch(`${RACK_ORIGIN}/api/carrier-pricing/files?record=${encodeURIComponent(id)}`, {
          method: "POST",
          cache: "no-store",
          headers: fileHeaders,
          body: file,
        });
        const stored = await uploaded.json().catch(() => ({}));
        if (!uploaded.ok || !stored.file) {
          const leftover = files.slice(completed);
          remember(savedRecord);
          detailId = savedRecord.id;
          fillDetail(savedRecord);
          pendingFiles = leftover;
          renderDetailLists(savedRecord);
          showDetailError(
            `Record saved. ${completed} of ${files.length} selected files uploaded. ${rackMessage(uploaded.status, stored, "The rack needs a restart before this file can be uploaded.", "The file did not upload.")}`
          );
          render();
          return;
        }
        savedRecord.files = [...savedRecord.files, stored.file];
        completed += 1;
      }
      remember(savedRecord);
      pendingFiles = [];
      const index = filterRows().findIndex((item) => item.id === savedRecord.id);
      if (index >= 0) page = Math.floor(index / PAGE_SIZE) + 1;
      detailBusy = false;
      closeDetail();
      render();
    } catch (error) {
      if (savedRecord) {
        const leftover = files.slice(completed);
        remember(savedRecord);
        detailId = savedRecord.id;
        fillDetail(savedRecord);
        pendingFiles = leftover;
        renderDetailLists(savedRecord);
        render();
        showDetailError(
          `Record saved. ${completed} of ${files.length} selected files uploaded. ${
            error instanceof Error ? error.message : "The file did not upload."
          }`
        );
      } else {
        showDetailError(error instanceof Error ? error.message : "The record did not save.");
      }
    } finally {
      detailBusy = false;
      if (submit instanceof HTMLButtonElement) {
        submit.disabled = false;
        submit.textContent = "Save record";
      }
    }
  }

  async function downloadFile(id) {
    const row = currentDetail();
    const file = (Array.isArray(row?.files) ? row.files : []).find((item) => item.id === id);
    if (!file || detailBusy) return;
    showDetailError("");
    try {
      const headers = await rackAuthHeaders();
      const res = await fetch(`${RACK_ORIGIN}/api/carrier-pricing/files/${encodeURIComponent(file.id)}`, {
        cache: "no-store",
        headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showDetailError(data.error || "The file did not download.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name || "agreement";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showDetailError(error instanceof Error ? error.message : "The file did not download.");
    }
  }

  function emailDetails(row) {
    const dates = (value) => (value ? displayDate(value) : "");
    const fields = [
      ["Carrier Name", row.carrier],
      ["SCAC", row.scac],
      ["Activity", row.type],
      ["Pricing Category", row.category],
      ["Client", clientName(row)],
      ["Pricing Account No. / Reference", row.account],
      ["Agreement Received Date", dates(row.received)],
      ["Effective Date", dates(row.effective)],
      ["Cancellation Date", dates(row.cancelled)],
      ["Renewal Date", dates(row.renewal)],
      ["Agreement Sent By", row.sender],
      ["Cancellation Notice Given By", row.notice],
      ["Cancellation Notice Received Date", dates(row.noticeReceived || workbookNoticeDate(row.notes))],
      ["Needs Review", row.review ? "Yes" : "No"],
      ["Source Task", row.sourceTitle],
      ["Last Updated By", row.updatedBy],
      ["Last Updated", row.updatedAt ? new Date(row.updatedAt).toLocaleString() : ""],
    ];
    const lines = fields.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
    if (row.billToAddress) lines.push("", "Bill To Address", row.billToAddress);
    lines.push("", "Notes", row.notes || "None", "", "Comments");
    const comments = Array.isArray(row.comments) ? row.comments : [];
    lines.push(
      ...(comments.length
        ? comments.map((comment) => `${comment.author || ""} · ${comment.at ? new Date(comment.at).toLocaleString() : ""}\n${comment.text || ""}`)
        : ["None"])
    );
    const files = Array.isArray(row.files) ? row.files : [];
    lines.push("", "Agreement Files", ...(files.length ? files.map((file) => file.name) : ["None"]));
    return {
      subject: [row.carrier || "Carrier record", row.type, clientName(row)].filter(Boolean).join(" - "),
      body: lines.join("\n"),
    };
  }

  function emailHtml(row) {
    const dates = (value) => (value ? displayDate(value) : "");
    const fields = [
      ["Carrier Name", row.carrier],
      ["SCAC", row.scac],
      ["Activity", row.type],
      ["Pricing Category", row.category],
      ["Client", clientName(row)],
      ["Pricing Account No. / Reference", row.account],
      ["Agreement Received Date", dates(row.received)],
      ["Effective Date", dates(row.effective)],
      ["Cancellation Date", dates(row.cancelled)],
      ["Renewal Date", dates(row.renewal)],
      ["Agreement Sent By", row.sender],
      ["Cancellation Notice Given By", row.notice],
      ["Cancellation Notice Received Date", dates(row.noticeReceived || workbookNoticeDate(row.notes))],
      ["Needs Review", row.review ? "Yes" : "No"],
      ["Source Task", row.sourceTitle],
      ["Last Updated By", row.updatedBy],
      ["Last Updated", row.updatedAt ? new Date(row.updatedAt).toLocaleString() : ""],
    ];
    const rows = fields
      .filter(([, value]) => value)
      .map(
        ([label, value]) =>
          `<tr><td style="padding:2px 18px 2px 0;color:#666666;vertical-align:top;">${esc(label)}</td><td style="padding:2px 0;vertical-align:top;">${esc(value)}</td></tr>`
      )
      .join("");
    const files = Array.isArray(row.files) ? row.files : [];
    const attached = files.length
      ? `<p style="margin:0 0 14px;">The agreement ${files.length === 1 ? "file is" : "files are"} attached to this message.</p>`
      : "";
    const bill = row.billToAddress
      ? `<p style="margin:16px 0 4px;"><strong>Bill To Address</strong></p><p style="margin:0;white-space:pre-wrap;">${esc(row.billToAddress)}</p>`
      : "";
    const notes = `<p style="margin:16px 0 4px;"><strong>Notes</strong></p><p style="margin:0;white-space:pre-wrap;">${esc(row.notes || "None")}</p>`;
    const comments = Array.isArray(row.comments) ? row.comments : [];
    const commentHtml = comments.length
      ? comments
          .map((comment) => {
            const when = comment.at ? new Date(comment.at).toLocaleString() : "";
            return `<p style="margin:8px 0 0;"><strong>${esc(comment.author || "")}</strong> ${esc(when)}</p><p style="margin:0;white-space:pre-wrap;">${esc(comment.text || "")}</p>`;
          })
          .join("")
      : `<p style="margin:8px 0 0;">None</p>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Aptos,Calibri,sans-serif;font-size:11pt;color:#212121;margin:0;">${attached}<table style="border-collapse:collapse;font-family:Aptos,Calibri,sans-serif;font-size:11pt;">${rows}</table>${bill}${notes}<p style="margin:16px 0 4px;"><strong>Comments</strong></p>${commentHtml}</body></html>`;
  }

  function base64Lines(bytes) {
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += 57 * 256) {
      const encoded = btoa(String.fromCharCode(...bytes.subarray(offset, offset + 57 * 256)));
      parts.push(...(encoded.match(/.{1,76}/g) || []));
    }
    return parts;
  }

  function emlFile(subject, plain, html, attachments) {
    const encode = (value) => new TextEncoder().encode(value);
    const subjectWords = [];
    let chunk = "";
    for (const character of subject.replace(/[\r\n]+/g, " ")) {
      if (encode(chunk + character).length > 42) {
        subjectWords.push(chunk);
        chunk = "";
      }
      chunk += character;
    }
    if (chunk) subjectWords.push(chunk);
    const subjectHeader = subjectWords.map((word) => `=?UTF-8?B?${base64Lines(encode(word)).join("")}?=`).join("\r\n ");
    const token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const mixed = `mix-${token}`;
    const alt = `alt-${token}`;
    const lines = [
      "X-Unsent: 1",
      `Subject: ${subjectHeader}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      "",
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      `--${alt}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      ...base64Lines(encode(String(plain || "").replace(/\r?\n/g, "\r\n"))),
      "",
      `--${alt}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      ...base64Lines(encode(html)),
      "",
      `--${alt}--`,
    ];
    for (const file of attachments) {
      const name = String(file.name || "agreement").replace(/[\u0000-\u001f\u007f/\\]/g, "_");
      const fallback = name.replace(/[^\x20-\x7e]|[";]/g, "_");
      lines.push(
        "",
        `--${mixed}`,
        `Content-Type: application/octet-stream; name="${fallback}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${fallback}"`,
        "",
        ...base64Lines(new Uint8Array(file.data))
      );
    }
    lines.push("", `--${mixed}--`, "");
    return new Blob([lines.join("\r\n")], { type: "message/rfc822" });
  }

  function showActionError(message) {
    const error = byId("cp-action-error");
    if (!(error instanceof HTMLElement)) return;
    error.textContent = message;
    error.hidden = !message;
  }

  function closeAction() {
    if (actionBusy) return;
    const dialog = byId("cp-action-dialog");
    if (dialog instanceof HTMLElement) dialog.hidden = true;
    actionId = "";
    actionMode = "";
  }

  function openAction(mode, title, body, confirmLabel, danger) {
    actionMode = mode;
    const heading = byId("cp-action-title");
    const box = byId("cp-action-body");
    const confirm = byId("cp-action-confirm");
    if (heading) heading.textContent = title;
    if (box) box.innerHTML = body;
    if (confirm instanceof HTMLButtonElement) {
      confirm.hidden = !confirmLabel;
      confirm.textContent = confirmLabel || "";
      confirm.className = danger ? "cp-danger" : "cp-gold";
      confirm.disabled = false;
    }
    const dialog = byId("cp-action-dialog");
    if (dialog instanceof HTMLElement) dialog.hidden = false;
  }

  async function downloadEmail(row) {
    const button = byId("cp-action-confirm");
    const progress = byId("cp-email-progress");
    if (!row || actionBusy || !(button instanceof HTMLButtonElement)) return;
    actionBusy = true;
    button.disabled = true;
    if (progress) progress.textContent = "Preparing your email draft…";
    showActionError("");
    try {
      const files = [];
      for (const file of row.files || []) {
        const headers = await rackAuthHeaders();
        const res = await fetch(`${RACK_ORIGIN}/api/carrier-pricing/files/${encodeURIComponent(file.id)}`, {
          cache: "no-store",
          headers,
        });
        if (!res.ok) throw new Error(`Could not load ${file.name}. Try again before emailing the record.`);
        files.push({ name: file.name, data: await res.arrayBuffer() });
      }
      const { subject, body } = emailDetails(row);
      handToOutlook(emlFile(subject, body, emailHtml(row), files), "Carrier Pricing.eml");
      if (progress) progress.textContent = "Open the message file. Outlook on this computer opens it.";
    } catch (error) {
      if (progress) progress.textContent = "The email draft could not be downloaded.";
      showActionError(error instanceof Error ? error.message : "The email draft could not be downloaded.");
      button.textContent = "Try again";
    } finally {
      actionBusy = false;
      button.disabled = false;
    }
  }

  async function loadAgreementFiles(row) {
    const files = [];
    for (const file of row.files || []) {
      const headers = await rackAuthHeaders();
      const res = await fetch(`${RACK_ORIGIN}/api/carrier-pricing/files/${encodeURIComponent(file.id)}`, {
        cache: "no-store",
        headers,
      });
      if (!res.ok) throw new Error(`Could not load ${file.name}. Try again before emailing the record.`);
      files.push({
        name: String(file.name || "agreement").replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 200),
        data: await res.arrayBuffer(),
      });
    }
    return files;
  }

  function showEmailError(message) {
    openAction(
      "email",
      "Email record",
      `<p id="cp-action-error" class="cp-form-error" role="alert">${esc(message)}</p>`,
      "",
      false
    );
  }

  function handToOutlook(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function openDesktopEmail(row) {
    const files = await loadAgreementFiles(row);
    const { subject, body } = emailDetails(row);
    const carrier = String(row.carrier || "Carrier").replace(/[^\w .()-]+/g, "").trim().slice(0, 60);
    handToOutlook(emlFile(subject, body, emailHtml(row), files), `${carrier || "Carrier"} Pricing.eml`);
  }

  function openEmail(id) {
    if (!allowsAction("carrier-pricing:email") || actionBusy) return;
    const row = records.find((item) => item.id === id);
    if (!row) return;
    const { subject, body } = emailDetails(row);
    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, "\r\n"))}`;
    const files = Array.isArray(row.files) ? row.files : [];
    if (!files.length && mailto.length <= 1800) {
      location.href = mailto;
      return;
    }
    if (files.length) {
      actionBusy = true;
      void openDesktopEmail(row)
        .catch((error) => {
          showEmailError(error instanceof Error ? error.message : "Outlook did not open the message.");
        })
        .finally(() => {
          actionBusy = false;
        });
      return;
    }
    actionId = id;
    openAction(
      "email",
      "Email record",
      `<p id="cp-email-progress" role="status">Preparing your email draft…</p><p id="cp-action-error" class="cp-form-error" role="alert" hidden></p>`,
      "Download again",
      false
    );
    void downloadEmail(row);
  }

  function confirmDelete(id) {
    if (!allowsAction("carrier-pricing:delete") || detailBusy || actionBusy) return;
    const row = records.find((item) => item.id === id);
    if (!row) return;
    actionId = id;
    const name = row.carrier || row.sourceTitle || "this record";
    openAction(
      "delete",
      "Delete record",
      `<p>Remove <strong>${esc(name)}</strong> from the dashboard?</p><p id="cp-action-error" class="cp-form-error" role="alert" hidden></p>`,
      "Delete record",
      true
    );
  }

  async function deleteRecord() {
    const row = records.find((item) => item.id === actionId);
    const button = byId("cp-action-confirm");
    if (!row || actionBusy || !(button instanceof HTMLButtonElement) || !allowsAction("carrier-pricing:delete")) return;
    actionBusy = true;
    button.disabled = true;
    showActionError("");
    try {
      const headers = await rackAuthHeaders({ "Content-Type": "application/json" });
      const res = await fetch(`${RACK_ORIGIN}/api/carrier-pricing`, {
        method: "DELETE",
        cache: "no-store",
        headers,
        body: JSON.stringify({ id: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showActionError(
          rackMessage(
            res.status,
            data,
            "The rack needs a restart before this agreement can be deleted.",
            "The record did not delete."
          )
        );
        return;
      }
      records = records.filter((item) => item.id !== row.id);
      if (detailId === row.id) {
        detailBusy = false;
        closeDetail();
      }
      actionBusy = false;
      closeAction();
      render();
    } catch (error) {
      showActionError(error instanceof Error ? error.message : "The record did not delete.");
    } finally {
      actionBusy = false;
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
  }

  host.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "cp-q") {
      page = 1;
      render();
    }
  });
  host.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "cp-type-filter" || target.id === "cp-category-filter") {
      page = 1;
      render();
    }
    if (target.id === "cp-mobile-sort" && target instanceof HTMLSelectElement) {
      const [key, direction] = target.value.split(":");
      sort = { key, direction: Number(direction) || 1 };
      page = 1;
      render();
    }
    if (target.id === "cp-file-input" && target instanceof HTMLInputElement) {
      const picked = [...(target.files || [])];
      if (picked.some((file) => !file.size || file.size > MAX_FILE || !FILE_EXT.test(file.name))) {
        target.value = "";
        showDetailError("Select supported files of 15 MB or less.");
      } else {
        showDetailError("");
      }
    }
  });
  host.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    if (target.id === "cp-clear") {
      const search = byId("cp-q");
      const type = byId("cp-type-filter");
      const category = byId("cp-category-filter");
      if (search instanceof HTMLInputElement) search.value = "";
      if (type instanceof HTMLSelectElement) type.value = "";
      if (category instanceof HTMLSelectElement) category.value = "";
      page = 1;
      render();
      if (search instanceof HTMLElement) search.focus();
    }
    if (target.id === "cp-add") openAgreement();
    if (target.dataset.email) openEmail(target.dataset.email);
    if (target.dataset.delete) confirmDelete(target.dataset.delete);
    if (target.dataset.follow) {
      const current = currentDetail();
      if (current) openAgreement({ startType: target.dataset.follow, accountId: current.accountId || current.id });
    }
    if (target.dataset.record) openAgreement({ id: target.dataset.record });
    if (target.dataset.file) void downloadFile(target.dataset.file);
    if (target.id === "cp-add-comment") addComment();
    if (target.id === "cp-upload-file") stageFiles();
    if (target.id === "cp-edit") beginEdit();
    if (target.dataset.cpDetailClose != null) closeDetail();
    if (target.dataset.cpActionClose != null) closeAction();
    if (target.id === "cp-action-confirm") {
      if (actionMode === "delete") void deleteRecord();
      if (actionMode === "email") {
        const row = records.find((item) => item.id === actionId);
        if (row) void downloadEmail(row);
      }
    }
    if (target.id === "cp-export") exportCsv();
    if (target.dataset.retry != null) void loadRecords();
    if (target.dataset.sort) {
      const key = target.dataset.sort;
      sort = { key, direction: sort.key === key ? -sort.direction : 1 };
      page = 1;
      render();
      table?.querySelector(`[data-sort="${key}"]`)?.focus();
    }
    if (target.dataset.page) {
      page += Number(target.dataset.page);
      render();
    }
  });

  byId("cp-detail-form")?.addEventListener("submit", (event) => {
    void saveDetail(event);
  });
  byId("cp-detail-form")?.addEventListener("input", () => {
    showDetailError("");
    syncDetailForm();
  });
  byId("cp-detail-form")?.addEventListener("change", syncDetailForm);
  host.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const action = byId("cp-action-dialog");
    if (action instanceof HTMLElement && !action.hidden) {
      closeAction();
      return;
    }
    const detail = byId("cp-detail-dialog");
    if (detail instanceof HTMLElement && !detail.hidden) closeDetail();
  });
  paintAccess(host);
  loadCurrent = loadRecords;
  if (getAccount()) void loadRecords();
  else showMessage("Loading agreements…", false);
}
