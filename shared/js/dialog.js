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
