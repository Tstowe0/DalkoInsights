/**
 * Shared themed dialogs (navy / gold).
 */

/** @type {HTMLElement | null} */
let root = null;
/** @type {((value: boolean) => void) | null} */
let pendingResolve = null;

const LOGO_SRC = new URL("../images/earth.png", import.meta.url).href;

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
      <div class="app-dialog-brand">
        <img class="app-dialog-logo" src="${LOGO_SRC}" width="28" height="28" alt="" />
        <span class="app-dialog-brand-name">Dalko Insights</span>
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
 * @param {string} message
 * @param {{ title?: string, okLabel?: string, cancelLabel?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, opts = {}) {
  const el = ensureDialog();
  if (pendingResolve) closeDialog(false);

  el.dataset.mode = "confirm";
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
 * @param {{ title?: string, okLabel?: string }} [opts]
 * @returns {Promise<void>}
 */
export function alertDialog(message, opts = {}) {
  const el = ensureDialog();
  if (pendingResolve) closeDialog(false);

  el.dataset.mode = "alert";
  const title = el.querySelector("#app-dialog-title");
  const msg = el.querySelector("#app-dialog-message");
  const ok = /** @type {HTMLButtonElement | null} */ (el.querySelector("#app-dialog-ok"));
  const cancel = /** @type {HTMLButtonElement | null} */ (el.querySelector("#app-dialog-cancel"));

  if (title) title.textContent = opts.title ?? "Notice";
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
