/**
 * Reusable single/multi-file tool workspace UI.
 */

import { openMailDraft } from "./mailto.js";
import { mountAboutSlide } from "./about-slide.js?v=20261023-penn";
import { alertDialog } from "../../../../shared/js/dialog.js?v=20261006-nobrand";

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
 * @param {string} [opts.runLabel]
 */
function classicMarkup(opts) {
  const { title, instructions, skipped, skipReason, accept, multiple, sendLabel = "", runLabel = "Run" } = opts;
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

                <p class="gb-stage-status" data-tool-status hidden></p>
                <footer class="gb-ws-actions">
                  <span class="gb-email-slot" data-email-slot></span>
                  ${sendLabel ? `<button type="button" class="btn btn-secondary" data-send disabled>${escapeHtml(sendLabel)}</button>` : ""}
                  <button type="button" class="btn btn-primary" data-run disabled>${escapeHtml(runLabel)}</button>
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
  const { title, instructions, skipped, skipReason, accept, multiple, sendLabel = "", runLabel = "Run", stepStyle = "cards" } = opts;
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
              <p class="gb-stage-status" data-tool-status hidden></p>
              <div class="gb-stage-file-actions">
                <input type="file" hidden data-file-input accept="${escapeHtml(accept)}" ${multiple ? "multiple" : ""} />
                <button type="button" class="btn btn-secondary" data-browse>Browse</button>
                <button type="button" class="btn btn-ghost" data-clear>Clear</button>
                ${sendLabel ? `<button type="button" class="btn btn-secondary" data-send disabled>${escapeHtml(sendLabel)}</button>` : ""}
                <button type="button" class="btn btn-primary" data-run disabled>${escapeHtml(runLabel)}</button>
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
 * @param {string} instructions
 * @param {{ lead?: string, upload?: { title: string, text: string }, reports?: { title: string, text: string }, run?: { title: string, text: string }, email?: { title: string, text: string } }} [board]
 */
function deriveBoard(instructions, board = {}) {
  const { description, steps } = parseStageGuide(instructions || "");
  const emailStep = steps.find((step) => /email/i.test(step)) || "";
  const workSteps = steps.filter((step) => step !== emailStep);
  const blob = `${workSteps[0] || ""} ${description}`.toLowerCase();
  const uploadTitle = /tracking/.test(blob)
    ? "Upload Tracking Report"
    : /dump/.test(blob)
      ? "Upload TMS Data Dump"
      : "Upload File";
  return {
    lead: board.lead || description,
    upload: board.upload || {
      title: uploadTitle,
      text: "Select an Excel or CSV file.",
    },
    reports: board.reports || { title: "How to", text: "" },
    notes: board.reports
      ? []
      : workSteps.filter((step) => !/upload the .+ and run|run the tool/i.test(step)),
    run: board.run || {
      title: "Run Report",
      text: "Generate the report from the uploaded file.",
    },
    email: board.email || {
      title: "Email",
      text: emailStep || "After the report is generated, open an email draft and attach the file.",
    },
  };
}

/**
 * Three-step report board: upload, options or notes, run, then email.
 * @param {Parameters<typeof classicMarkup>[0] & { board?: { lead?: string, upload?: { title: string, text: string }, reports?: { title: string, text: string }, run?: { title: string, text: string }, email?: { title: string, text: string } }, hasExtra?: boolean, showEmail?: boolean }} opts
 */
function boardMarkup(opts) {
  const {
    title,
    instructions = "",
    skipped,
    skipReason,
    accept,
    multiple,
    runLabel = "Run Report",
    sendLabel = "",
    board,
    hasExtra = false,
    showEmail = true,
    plainActions = false,
  } = opts;
  const derived = deriveBoard(instructions, board);
  const lead = derived.lead;
  const upload = derived.upload;
  const reports = derived.reports;
  const run = derived.run;
  const email = derived.email;
  const fileHint = "Drag & drop an Excel or CSV file here";
  const notes = derived.notes
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("");

  const body = skipped
    ? `<div class="gb-skip-banner"><strong>Skipped for web</strong><p>${escapeHtml(skipReason)}</p></div>`
    : `
      <div class="gb-board-flow">
        <article class="gb-board-card">
          <span class="gb-board-num" aria-hidden="true">1</span>
          <h3>${escapeHtml(reports.title)}</h3>
          ${reports.text ? `<p>${escapeHtml(reports.text)}</p>` : ""}
          ${hasExtra ? `<div class="gb-tool-extra" data-tool-extra></div>` : `<ul class="gb-board-notes">${notes}</ul>`}
        </article>
        <span class="gb-board-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <article class="gb-board-card">
          <span class="gb-board-num" aria-hidden="true">2</span>
          <h3>${escapeHtml(upload.title)}</h3>
          <p>${escapeHtml(upload.text)}</p>
          <div class="gb-board-drop" data-drop>
            <svg class="gb-board-cloud" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5-1.6A3.5 3.5 0 0 0 7 18z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M12 16V11M9.6 13.2 12 10.8l2.4 2.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <p data-file-label>${fileHint}</p>
            <span class="gb-board-or">or</span>
            <input type="file" hidden data-file-input accept="${escapeHtml(accept)}" ${multiple ? "multiple" : ""} />
            <div class="gb-board-file-actions">
              <button type="button" class="gb-board-browse" data-browse>Browse File</button>
              <button type="button" class="gb-board-clear" data-clear>Clear</button>
            </div>
          </div>
        </article>
        <span class="gb-board-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <article class="gb-board-card">
          <span class="gb-board-num" aria-hidden="true">3</span>
          <h3>${escapeHtml(run.title)}</h3>
          <p>${escapeHtml(run.text)}</p>
          <div class="gb-board-run-wrap">
            <button type="button" class="btn btn-primary gb-board-run" data-run disabled>
              ${plainActions ? "" : `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.2 2.6v10.8L13.2 8 4.2 2.6z"/></svg>`}
              <span data-run-label>${escapeHtml(runLabel)}</span>
            </button>
            ${sendLabel ? `<button type="button" class="btn ${plainActions ? "btn-primary gb-board-run" : "btn-secondary"} gb-board-send" data-send disabled>${escapeHtml(sendLabel)}</button>` : ""}
            <p class="gb-board-status" data-tool-status hidden></p>
          </div>
        </article>
      </div>
      ${
        showEmail
          ? `<section class="gb-board-email" aria-label="Email">
        <span class="gb-board-mail-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </span>
        <div>
          <h3>${escapeHtml(email.title)}</h3>
          <p>${escapeHtml(email.text)}</p>
        </div>
        <span class="gb-email-slot" data-email-slot></span>
      </section>`
          : ""
      }
    `;

  return `
    <section class="gb-tool gb-tool--board${skipped ? " gb-tool-skipped" : ""}" data-tool="${escapeHtml(title)}">
      <header class="gb-board-head">
        <span class="gb-board-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M7 3.5h6.5L18 8V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M13.2 3.7V8H17.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M8.2 17v-2.4M11.1 17V12M14 17v-1.4M16.6 17v-3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </span>
        <div class="gb-board-titles">
          <h2 class="gb-tool-title">${escapeHtml(title)}</h2>
          ${lead ? `<p>${escapeHtml(lead)}</p>` : ""}
        </div>
        <div data-about-slot></div>
      </header>
      ${body}
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
 * @property {string} [runLabel]
 * @property {(files: File[], ui: { setStatus: (t: string) => void, setBusy: (b: boolean) => void, extra: HTMLElement }) => Promise<void>} [onSend]
 * @property {(extra: HTMLElement) => void} [buildExtra]
 * @property {import("./mailto.js").MailDraft | import("./mailto.js").MailDraft[] | (() => import("./mailto.js").MailDraft | import("./mailto.js").MailDraft[])} [emailDraft]
 * @property {"classic" | "stage" | "board"} [layout]
 * @property {boolean} [plainActions]
 * @property {"cards" | "prose"} [stepStyle]
 * @property {{ lead?: string, upload?: { title: string, text: string }, reports?: { title: string, text: string }, run?: { title: string, text: string }, email?: { title: string, text: string } }} [board]
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
    runLabel = "Run",
    onSend,
    buildExtra,
    emailDraft,
    layout = "classic",
    stepStyle = "cards",
    board,
    plainActions = false,
  } = opts;

  /** @type {File[]} */
  let files = [];

  const markup =
    layout === "board"
      ? boardMarkup({
          title,
          category,
          instructions,
          skipped,
          skipReason,
          accept,
          multiple,
          sendLabel,
          runLabel: runLabel === "Run" ? "Run Report" : runLabel,
          board,
          hasExtra: Boolean(buildExtra),
          showEmail: Boolean(emailDraft),
          plainActions,
        })
      : layout === "stage"
        ? stageMarkup({ title, category, instructions, skipped, skipReason, accept, multiple, sendLabel, runLabel, stepStyle })
        : classicMarkup({ title, category, instructions, skipped, skipReason, accept, multiple, sendLabel, runLabel });

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
  let notice = "";

  /** @param {string} text */
  const statusEl = /** @type {HTMLElement | null} */ (parent.querySelector("[data-tool-status]"));
  const setStatus = (text) => {
    const show = Boolean(text && text !== "Ready");
    if (statusEl) {
      statusEl.hidden = !show;
      statusEl.textContent = show ? text : "";
    }
    if (show && !isProgress(text)) notice = text;
    if (show) log?.(text);
  };

  /** @param {boolean} busy */
  const setBusy = (busy) => {
    const blocked = busy || files.length === 0;
    if (runBtn) {
      runBtn.disabled = blocked;
      const busyRun = runLabel === "Run" || runLabel === "Run Report" ? "Running…" : "Saving…";
      const idleRun = runLabel === "Run" && runBtn.querySelector("[data-run-label]") ? "Run Report" : runLabel;
      const next = busy && activeAction === "run" ? busyRun : idleRun;
      const face = runBtn.querySelector("[data-run-label]");
      if (face) face.textContent = next;
      else runBtn.textContent = next;
    }
    if (sendBtn) {
      sendBtn.disabled = blocked;
      sendBtn.textContent = busy && activeAction === "send" ? "Sending…" : sendLabel;
    }
  };

  const refreshLabel = () => {
    const drop = parent.querySelector("[data-drop]");
    if (labelEl) {
      const emptyLabel = drop ? "Drag & drop an Excel or CSV file here" : "No file selected";
      if (!files.length) labelEl.textContent = emptyLabel;
      else if (files.length === 1) labelEl.textContent = files[0].name;
      else labelEl.textContent = `${files.length} files selected`;
    }
    if (runBtn) runBtn.disabled = files.length === 0;
    if (sendBtn) sendBtn.disabled = files.length === 0;
    parent.querySelector(".gb-stage-well")?.classList.toggle("is-ready", files.length > 0);
    drop?.classList.toggle("is-ready", files.length > 0);
  };

  /**
   * @param {"run" | "send"} kind
   */
  const runAction = async (kind) => {
    const handler = kind === "send" ? onSend : onRun;
    if (!files.length || !handler) return;
    activeAction = kind;
    notice = "";
    setBusy(true);
    setStatus(kind === "send" ? "Sending…" : "Running…");
    try {
      await handler(files, { setStatus, setBusy, extra: /** @type {HTMLElement} */ (extra) });
      if (notice && !/^send cancelled\.?$/i.test(notice)) {
        const failed = /fail|error|refused|could not|unable|timed out/i.test(notice);
        await alertDialog(notice, { title: failed ? "Failed" : "Succeeded", okLabel: "OK" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg);
      await alertDialog(msg, { title: "Failed", okLabel: "OK" });
    } finally {
      activeAction = "";
      setBusy(false);
    }
  };

  if (!skipped) {
    const extraEl = /** @type {HTMLElement} */ (extra);
    const extraStep = /** @type {HTMLElement | null} */ (parent.querySelector("[data-extra-step]"));
    if (buildExtra && extraEl) {
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
    const drop = parent.querySelector("[data-drop]");
    if (drop && input) {
      drop.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest("button, a, input")) return;
        input.click();
      });
      drop.addEventListener("dragover", (event) => {
        event.preventDefault();
        drop.classList.add("is-over");
      });
      drop.addEventListener("dragleave", (event) => {
        if (event.relatedTarget instanceof Node && drop.contains(event.relatedTarget)) return;
        drop.classList.remove("is-over");
      });
      drop.addEventListener("drop", (event) => {
        event.preventDefault();
        drop.classList.remove("is-over");
        const picked = [...(event.dataTransfer?.files || [])];
        if (!picked.length) return;
        const dt = new DataTransfer();
        for (const file of multiple ? picked : picked.slice(0, 1)) dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
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

/** @param {string} text */
function isProgress(text) {
  return /^(Running…|Saving…|Sending…|Building the file…|Sending .+…)$/.test(text);
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
    const label =
      slot.closest(".gb-board-email") && (!draft.label || draft.label === "Email")
        ? "Open Email Draft"
        : draft.label || "Email";
    if (slot.closest(".gb-board-email")) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><span></span>`;
      const face = btn.querySelector("span");
      if (face) face.textContent = label;
    } else {
      btn.textContent = label;
    }
    btn.addEventListener("click", () => {
      const live = resolveList()[index] || resolveList()[0];
      if (!live) return;
      openMailDraft(live);
      log?.(`Opened email draft: ${live.subject || "(no subject)"}`);
    });
    slot.appendChild(btn);
  });
}
