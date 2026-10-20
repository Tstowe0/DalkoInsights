/**
 * Shared themed dialogs (navy / gold).
 */

/** @type {HTMLElement | null} */
let root = null;
/** @type {((value: boolean) => void) | null} */
let pendingResolve = null;

function ensureDialog() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "app-dialog";
  root.className = "app-dialog hidden";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.innerHTML = `
    <div class="app-dialog-backdrop" data-dialog-dismiss="true"></div>
    <div class="app-dialog-card">
      <div class="app-dialog-mark" aria-hidden="true">
        <svg class="mark-ok" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 9.2 17 19 7"/></svg>
        <svg class="mark-bad" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>
      </div>
      <h2 class="app-dialog-title" id="app-dialog-title"></h2>
      <p class="app-dialog-message" id="app-dialog-message"></p>
      <div class="app-dialog-actions">
        <button type="button" class="btn btn-ghost" id="app-dialog-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="app-dialog-ok">Continue</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  root.querySelector("#app-dialog-ok")?.addEventListener("click", () => closeDialog(true));
  root.querySelector("#app-dialog-cancel")?.addEventListener("click", () => closeDialog(false));
  root.querySelector(".app-dialog-backdrop")?.addEventListener("click", () => {
    if (root?.dataset.mode === "confirm") closeDialog(false);
    else closeDialog(true);
  });
  document.addEventListener("keydown", (e) => {
    if (!root || root.classList.contains("hidden")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeDialog(root.dataset.mode === "confirm" ? false : true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      closeDialog(true);
    }
  });
  return root;
}

/** @param {boolean} result */
function closeDialog(result) {
  if (!root || root.classList.contains("hidden")) return;
  root.classList.add("hidden");
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(result);
}

/**
 * @param {HTMLElement} el
 * @param {string} [tone]
 */
function setTone(el, tone) {
  if (tone === "success" || tone === "danger") el.dataset.tone = tone;
  else delete el.dataset.tone;
}

/**
 * @param {string} [title]
 * @returns {"success" | "danger" | ""}
 */
function toneFromTitle(title) {
  if (title === "Succeeded") return "success";
  if (title && /fail/i.test(title)) return "danger";
  return "";
}

/**
 * @param {string} message
 * @param {{ title?: string, okLabel?: string, cancelLabel?: string, tone?: "success" | "danger" | "" }} [opts]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, opts = {}) {
  const el = ensureDialog();
  if (pendingResolve) closeDialog(false);

  el.dataset.mode = "confirm";
  setTone(el, opts.tone || "");
  const title = el.querySelector("#app-dialog-title");
  const msg = el.querySelector("#app-dialog-message");
  const ok = /** @type {HTMLButtonElement | null} */ (el.querySelector("#app-dialog-ok"));
  const cancel = /** @type {HTMLButtonElement | null} */ (el.querySelector("#app-dialog-cancel"));

  if (title) title.textContent = opts.title ?? "Large file";
  if (msg) msg.textContent = message;
  if (ok) ok.textContent = opts.okLabel ?? "Continue";
  if (cancel) {
    cancel.textContent = opts.cancelLabel ?? "Cancel";
    cancel.classList.remove("hidden");
  }

  el.classList.remove("hidden");
  ok?.focus();

  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}

/**
 * @param {string} message
 * @param {{ title?: string, okLabel?: string, tone?: "success" | "danger" | "" }} [opts]
 * @returns {Promise<void>}
 */
export function alertDialog(message, opts = {}) {
  const el = ensureDialog();
  if (pendingResolve) closeDialog(false);

  el.dataset.mode = "alert";
  const titleText = opts.title ?? "Notice";
  setTone(el, opts.tone || toneFromTitle(titleText));
  const title = el.querySelector("#app-dialog-title");
  const msg = el.querySelector("#app-dialog-message");
  const ok = /** @type {HTMLButtonElement | null} */ (el.querySelector("#app-dialog-ok"));
  const cancel = /** @type {HTMLButtonElement | null} */ (el.querySelector("#app-dialog-cancel"));

  if (title) title.textContent = titleText;
  if (msg) msg.textContent = message;
  if (ok) ok.textContent = opts.okLabel ?? "OK";
  cancel?.classList.add("hidden");

  el.classList.remove("hidden");
  ok?.focus();

  return new Promise((resolve) => {
    pendingResolve = () => {
      resolve();
    };
  });
}

/** @type {HTMLElement | null} */
let progressRoot = null;

const PROGRESS_STEPS = [
  ["read", "Read the data dump"],
  ["rates", "Look up DAT freight and fuel"],
  ["build", "Build the workbook"],
];

function ensureProgress() {
  if (progressRoot) return progressRoot;
  progressRoot = document.createElement("div");
  progressRoot.id = "app-progress";
  progressRoot.className = "app-dialog app-progress hidden";
  progressRoot.setAttribute("role", "dialog");
  progressRoot.setAttribute("aria-modal", "true");
  progressRoot.setAttribute("aria-labelledby", "app-progress-title");
  progressRoot.innerHTML = `
    <div class="app-dialog-backdrop"></div>
    <div class="app-dialog-card app-progress-card">
      <h2 class="app-dialog-title" id="app-progress-title">Building report</h2>
      <ol class="app-progress-steps">
        ${PROGRESS_STEPS.map(
          ([id, label]) => `<li data-progress-step="${id}"><span>${label}</span></li>`
        ).join("")}
      </ol>
      <p class="app-dialog-message" id="app-progress-detail"></p>
      <div class="app-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="app-progress-fill" data-progress-fill></div>
      </div>
      <p class="app-progress-meta" data-progress-meta></p>
    </div>`;
  document.body.appendChild(progressRoot);
  document.addEventListener("keydown", (event) => {
    if (!progressRoot || progressRoot.classList.contains("hidden")) return;
    if (event.key === "Escape" || event.key === "Enter") event.preventDefault();
  });
  return progressRoot;
}

/**
 * @param {{ step?: string, title?: string, detail?: string, done?: number, total?: number }} update
 */
export function updateProgress(update) {
  const el = ensureProgress();
  const title = el.querySelector("#app-progress-title");
  const detail = el.querySelector("#app-progress-detail");
  const fill = /** @type {HTMLElement | null} */ (el.querySelector("[data-progress-fill]"));
  const meta = el.querySelector("[data-progress-meta]");
  const bar = /** @type {HTMLElement | null} */ (el.querySelector("[role='progressbar']"));
  if (title && update.title) title.textContent = update.title;
  if (detail) detail.textContent = update.detail || "";

  const stepIndex = PROGRESS_STEPS.findIndex(([id]) => id === update.step);
  el.querySelectorAll("[data-progress-step]").forEach((item, index) => {
    item.classList.toggle("is-done", stepIndex > index);
    item.classList.toggle("is-active", stepIndex === index);
  });

  const total = Number(update.total) || 0;
  const done = Math.max(0, Number(update.done) || 0);
  const known = total > 0;
  const percent = known ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
  if (fill) {
    fill.classList.toggle("is-wait", !known);
    fill.style.width = known ? `${percent}%` : "";
  }
  if (bar) bar.setAttribute("aria-valuenow", known ? String(percent) : "0");
  if (meta) {
    meta.textContent = known
      ? `${done.toLocaleString()} of ${total.toLocaleString()} · ${percent}%`
      : "Working…";
  }
  el.classList.remove("hidden");
}

export function closeProgress() {
  progressRoot?.classList.add("hidden");
}
