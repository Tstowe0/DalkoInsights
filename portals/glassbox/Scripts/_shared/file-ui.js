/**
 * Reusable single/multi-file tool workspace UI.
 */

import { openMailDraft } from "./mailto.js";
import { mountAboutSlide } from "./about-slide.js?v=20261001-aboutswap";

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
 * Split a tool's instructions into a short description and numbered steps.
 * Continuation lines stay with the step they follow. Section labels are dropped.
 * @param {string} instructions
 * @returns {{ description: string, steps: string[] }}
 */
function parseStageGuide(instructions) {
  /** @type {string[]} */
  const prose = [];
  /** @type {string[]} */
  const steps = [];
  let started = false;
  for (const raw of instructions.trim().split(/\n/)) {
    const line = raw.trim();
    if (!line || /^(instructions|concept|workflow):?$/i.test(line)) continue;
    const numbered = line.match(/^\d+\.\s*(.+)$/);
    if (numbered) {
      started = true;
      steps.push(numbered[1]);
      continue;
    }
    if (started && steps.length) steps[steps.length - 1] += ` ${line}`;
    else prose.push(line);
  }
  return { description: prose.join(" "), steps };
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.category
 * @param {string} opts.instructions
 * @param {boolean} opts.skipped
 * @param {string} opts.skipReason
 * @param {string} opts.accept
 * @param {boolean} opts.multiple
 * @param {string} [opts.sendLabel]
 */
function classicMarkup(opts) {
  const { title, instructions, skipped, skipReason, accept, multiple, sendLabel = "" } = opts;
  return `
    <section class="gb-tool${skipped ? " gb-tool-skipped" : ""}" data-tool="${escapeHtml(title)}">
      <header class="gb-tool-header">
        <div class="gb-tool-heading">
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
                  ${sendLabel ? `<button type="button" class="btn btn-secondary" data-send disabled>${escapeHtml(sendLabel)}</button>` : ""}
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
}

/**
 * Full-workspace tiles: how to use, then the file and Run, then email.
 * @param {Parameters<typeof classicMarkup>[0]} opts
 */
function stageMarkup(opts) {
  const { title, instructions, skipped, skipReason, accept, multiple, sendLabel = "", stepStyle = "cards" } = opts;
  const { description, steps } = parseStageGuide(instructions);
  const prose = stepStyle === "prose";
  const guide = steps.length
    ? `<ol class="gb-stage-steps${prose ? " gb-stage-steps--prose" : ""}">${steps
        .map(
          (step, index) =>
            `<li><span class="gb-stage-num" aria-hidden="true">${index + 1}</span><p>${escapeHtml(step)}</p></li>`
        )
        .join("")}</ol>`
    : `<pre class="gb-tool-instructions">${escapeHtml(instructions.trim())}</pre>`;
  const lead = description
    ? `<p class="gb-stage-lead">${escapeHtml(description)}</p>`
    : "";
  const fileHint = multiple ? "Select one or more Excel / CSV files" : "Select an Excel or CSV file";

  const body = `
        <section class="gb-stage-guide" aria-label="How to use this tool">
          <header class="gb-stage-bar">
            <h2 class="gb-tool-title">${escapeHtml(title)}</h2>
            <div class="gb-tool-header-actions">
              <div data-about-slot></div>
            </div>
          </header>
          ${lead}
          <p class="gb-stage-kicker">How to use</p>
          ${guide}
        </section>

        <div class="gb-stage-work" data-tool-body>
          ${
            skipped
              ? `<div class="gb-skip-banner"><strong>Skipped for web</strong><p>${escapeHtml(skipReason)}</p></div>`
              : `
            <div class="gb-stage-well">
              <p class="gb-stage-kicker">Source file</p>
              <p class="gb-stage-file" data-file-label>No file selected</p>
              <p class="gb-stage-hint">${fileHint}</p>
              <div class="gb-stage-file-actions">
                <input type="file" hidden data-file-input accept="${escapeHtml(accept)}" ${multiple ? "multiple" : ""} />
                <button type="button" class="btn btn-secondary" data-browse>Browse</button>
                <button type="button" class="btn btn-ghost" data-clear>Clear</button>
                ${sendLabel ? `<button type="button" class="btn btn-secondary" data-send disabled>${escapeHtml(sendLabel)}</button>` : ""}
                <button type="button" class="btn btn-primary" data-run disabled>Run</button>
              </div>
            </div>
            <div class="gb-stage-extra" data-extra-step hidden>
              <div class="gb-tool-extra" data-tool-extra></div>
            </div>
          `
          }
        </div>

        ${
          skipped
            ? ""
            : `<section class="gb-stage-send" aria-label="Email">
          <p class="gb-stage-kicker">After you run</p>
          <span class="gb-email-slot" data-email-slot></span>
        </section>`
        }
  `;

  const aboutPanel = prose
    ? `<section class="gb-stage-about" data-about-panel hidden></section>`
    : "";

  return `
    <section class="gb-tool gb-tool--stage${prose ? " gb-tool--prose" : ""}${skipped ? " gb-tool-skipped" : ""}" data-tool="${escapeHtml(title)}">
      <div class="gb-stage">
        ${prose ? `<div class="gb-stage-view">${body}${aboutPanel}</div>` : body}
      </div>
    </section>
  `;
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
 * @property {string} [sendLabel]
 * @property {(files: File[], ui: { setStatus: (t: string) => void, setBusy: (b: boolean) => void, extra: HTMLElement }) => Promise<void>} [onSend]
 * @property {(extra: HTMLElement) => void} [buildExtra]
 * @property {import("./mailto.js").MailDraft | import("./mailto.js").MailDraft[] | (() => import("./mailto.js").MailDraft | import("./mailto.js").MailDraft[])} [emailDraft]
 * @property {"classic" | "stage"} [layout]
 * @property {"cards" | "prose"} [stepStyle]
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
    sendLabel = "",
    onSend,
    buildExtra,
    emailDraft,
    layout = "classic",
    stepStyle = "cards",
  } = opts;

  /** @type {File[]} */
  let files = [];

  const markup =
    layout === "stage"
      ? stageMarkup({ title, category, instructions, skipped, skipReason, accept, multiple, sendLabel, stepStyle })
      : classicMarkup({ title, category, instructions, skipped, skipReason, accept, multiple, sendLabel });

  parent.innerHTML = markup;

  const aboutSlot = /** @type {HTMLElement | null} */ (parent.querySelector("[data-about-slot]"));
  if (aboutSlot) {
    try {
      mountAboutSlide(aboutSlot, { title, present: stepStyle === "prose" ? "swap" : "modal" });
    } catch (err) {
      log?.(`About control failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const labelEl = /** @type {HTMLElement | null} */ (parent.querySelector("[data-file-label]"));
  const runBtn = /** @type {HTMLButtonElement | null} */ (parent.querySelector("[data-run]"));
  const sendBtn = /** @type {HTMLButtonElement | null} */ (parent.querySelector("[data-send]"));
  const input = /** @type {HTMLInputElement | null} */ (parent.querySelector("[data-file-input]"));
  const extra = /** @type {HTMLElement | null} */ (parent.querySelector("[data-tool-extra]"));
  /** @type {"" | "run" | "send"} */
  let activeAction = "";

  /** @param {string} text */
  const setStatus = (text) => {
    if (text && text !== "Ready") log?.(text);
  };

  /** @param {boolean} busy */
  const setBusy = (busy) => {
    const blocked = busy || files.length === 0;
    if (runBtn) {
      runBtn.disabled = blocked;
      runBtn.textContent = busy && activeAction === "run" ? "Running…" : "Run";
    }
    if (sendBtn) {
      sendBtn.disabled = blocked;
      sendBtn.textContent = busy && activeAction === "send" ? "Sending…" : sendLabel;
    }
  };

  const refreshLabel = () => {
    if (!labelEl) return;
    if (!files.length) labelEl.textContent = "No file selected";
    else if (files.length === 1) labelEl.textContent = files[0].name;
    else labelEl.textContent = `${files.length} files selected`;
    if (runBtn) runBtn.disabled = files.length === 0;
    if (sendBtn) sendBtn.disabled = files.length === 0;
    parent.querySelector(".gb-stage-well")?.classList.toggle("is-ready", files.length > 0);
  };

  /**
   * @param {"run" | "send"} kind
   */
  const runAction = async (kind) => {
    const handler = kind === "send" ? onSend : onRun;
    if (!files.length || !handler) return;
    activeAction = kind;
    setBusy(true);
    setStatus(kind === "send" ? "Sending…" : "Running…");
    try {
      await handler(files, { setStatus, setBusy, extra: /** @type {HTMLElement} */ (extra) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus("Error");
      log?.(`Error: ${msg}`);
    } finally {
      activeAction = "";
      setBusy(false);
    }
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
    runBtn?.addEventListener("click", () => void runAction("run"));
    sendBtn?.addEventListener("click", () => void runAction("send"));

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
