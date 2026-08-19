/**
 * Reusable single/multi-file tool workspace UI.
 */

import { openMailDraft } from "./mailto.js";
import { mountAboutSlide } from "./about-slide.js";

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
 * @typedef {object} FileToolOptions
 * @property {string} title
 * @property {string} [category]
 * @property {string} instructions
 * @property {() => void} onBack
 * @property {(msg: string) => void} [log]
 * @property {string} [accept]
 * @property {boolean} [multiple]
 * @property {boolean} [skipped]
 * @property {string} [skipReason]
 * @property {(files: File[], ui: { setStatus: (t: string) => void, setBusy: (b: boolean) => void, extra: HTMLElement }) => Promise<void>} [onRun]
 * @property {(extra: HTMLElement) => void} [buildExtra]
 * @property {import("./mailto.js").MailDraft | import("./mailto.js").MailDraft[] | (() => import("./mailto.js").MailDraft | import("./mailto.js").MailDraft[])} [emailDraft]
 */

/**
 * @param {HTMLElement} parent
 * @param {FileToolOptions} opts
 */
export function mountFileTool(parent, opts) {
  const {
    title,
    category = "",
    instructions,
    log,
    accept = ".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv",
    multiple = false,
    skipped = false,
    skipReason = "This tool cannot run in the browser.",
    onRun,
    buildExtra,
    emailDraft,
  } = opts;

  /** @type {File[]} */
  let files = [];

  parent.innerHTML = `
    <section class="gb-tool${skipped ? " gb-tool-skipped" : ""}" data-tool="${escapeHtml(title)}">
      <header class="gb-tool-header">
        <div class="gb-tool-heading">
          ${category ? `<p class="gb-tool-category">${escapeHtml(category)}</p>` : ""}
          <h2 class="gb-tool-title">${escapeHtml(title)}</h2>
        </div>
        <div class="gb-tool-header-actions">
          <div data-about-slot></div>
        </div>
      </header>

      <div class="gb-tool-panels">
        <article class="gb-tool-panel gb-tool-panel--instructions">
          <h3 class="gb-tool-panel-title">Instructions</h3>
          <pre class="gb-tool-instructions">${escapeHtml(instructions.trim())}</pre>
        </article>

        <article class="gb-tool-panel gb-tool-panel--workspace">
          <h3 class="gb-tool-panel-title">Workspace</h3>
          <div class="gb-tool-body" data-tool-body>
            ${
              skipped
                ? `<div class="gb-skip-banner"><strong>Skipped for web</strong><p>${escapeHtml(skipReason)}</p></div>`
                : `
              <div class="gb-ws">
                <section class="gb-ws-step">
                  <header class="gb-ws-step-head">
                    <span class="gb-ws-step-num" aria-hidden="true">1</span>
                    <div class="gb-ws-step-titles">
                      <h4 class="gb-ws-step-title">Source file</h4>
                      <p class="gb-ws-step-hint">${multiple ? "Select one or more Excel / CSV files" : "Select an Excel or CSV file"}</p>
                    </div>
                  </header>
                  <div class="gb-ws-step-body">
                    <div class="gb-ws-file">
                      <p class="gb-ws-file-name" data-file-label>No file selected</p>
                      <div class="gb-ws-file-actions">
                        <input type="file" hidden data-file-input accept="${escapeHtml(accept)}" ${multiple ? "multiple" : ""} />
                        <button type="button" class="btn btn-secondary" data-browse>Browse</button>
                        <button type="button" class="btn btn-ghost" data-clear>Clear</button>
                      </div>
                    </div>
                  </div>
                </section>

                <section class="gb-ws-step gb-ws-step--extra" data-extra-step hidden>
                  <header class="gb-ws-step-head">
                    <span class="gb-ws-step-num" aria-hidden="true">2</span>
                    <div class="gb-ws-step-titles">
                      <h4 class="gb-ws-step-title">Options</h4>
                    </div>
                  </header>
                  <div class="gb-ws-step-body">
                    <div class="gb-tool-extra" data-tool-extra></div>
                  </div>
                </section>

                <footer class="gb-ws-actions">
                  <span class="gb-email-slot" data-email-slot></span>
                  <button type="button" class="btn btn-primary" data-run disabled>Run</button>
                </footer>
              </div>
            `
            }
          </div>
        </article>
      </div>
    </section>
  `;

  const aboutSlot = /** @type {HTMLElement | null} */ (parent.querySelector("[data-about-slot]"));
  if (aboutSlot) {
    try {
      mountAboutSlide(aboutSlot, { title });
    } catch (err) {
      log?.(`About control failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const labelEl = /** @type {HTMLElement | null} */ (parent.querySelector("[data-file-label]"));
  const runBtn = /** @type {HTMLButtonElement | null} */ (parent.querySelector("[data-run]"));
  const input = /** @type {HTMLInputElement | null} */ (parent.querySelector("[data-file-input]"));
  const extra = /** @type {HTMLElement | null} */ (parent.querySelector("[data-tool-extra]"));

  /** @param {string} text */
  const setStatus = (text) => {
    if (text && text !== "Ready") log?.(text);
  };

  /** @param {boolean} busy */
  const setBusy = (busy) => {
    if (runBtn) runBtn.disabled = busy || files.length === 0;
    if (runBtn) runBtn.textContent = busy ? "Running…" : "Run";
  };

  const refreshLabel = () => {
    if (!labelEl) return;
    if (!files.length) labelEl.textContent = "No file selected";
    else if (files.length === 1) labelEl.textContent = files[0].name;
    else labelEl.textContent = `${files.length} files selected`;
    if (runBtn) runBtn.disabled = files.length === 0;
  };

  if (!skipped) {
    const extraEl = /** @type {HTMLElement} */ (extra);
    const extraStep = /** @type {HTMLElement | null} */ (parent.querySelector("[data-extra-step]"));
    if (buildExtra) {
      buildExtra(extraEl);
      if (extraStep && extraEl.childNodes.length) extraStep.hidden = false;
    }

    parent.querySelector("[data-browse]")?.addEventListener("click", () => input?.click());
    parent.querySelector("[data-clear]")?.addEventListener("click", () => {
      files = [];
      if (input) input.value = "";
      refreshLabel();
      setStatus("Ready");
      log?.("Cleared file selection.");
    });
    input?.addEventListener("change", () => {
      files = input.files ? [...input.files] : [];
      refreshLabel();
      if (files.length) log?.(`Selected: ${files.map((f) => f.name).join(", ")}`);
    });
    runBtn?.addEventListener("click", async () => {
      if (!files.length || !onRun) return;
      setBusy(true);
      setStatus("Running…");
      try {
        await onRun(files, { setStatus, setBusy, extra: extraEl });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("Error");
        log?.(`Error: ${msg}`);
      } finally {
        setBusy(false);
      }
    });

    mountEmailButtons(
      /** @type {HTMLElement | null} */ (parent.querySelector("[data-email-slot]")),
      emailDraft,
      log
    );
  }

  log?.(skipped ? `Skipped tool (web): ${title}` : `Loaded tool module: ${title}`);
  return { setStatus, setBusy };
}

/**
 * @param {HTMLElement | null} slot
 * @param {FileToolOptions["emailDraft"]} emailDraft
 * @param {(msg: string) => void} [log]
 */
function mountEmailButtons(slot, emailDraft, log) {
  if (!slot || !emailDraft) return;

  /** @returns {import("./mailto.js").MailDraft[]} */
  const resolveList = () => {
    const d = typeof emailDraft === "function" ? emailDraft() : emailDraft;
    return Array.isArray(d) ? d : d ? [d] : [];
  };

  // Build buttons from initial resolve (labels); click re-resolves for fresh dates
  const initial = resolveList();
  initial.forEach((draft, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = draft.label || "Email";
    btn.addEventListener("click", () => {
      const live = resolveList()[index] || resolveList()[0];
      if (!live) return;
      openMailDraft(live);
      log?.(`Opened email draft: ${live.subject || "(no subject)"}`);
    });
    slot.appendChild(btn);
  });
}
