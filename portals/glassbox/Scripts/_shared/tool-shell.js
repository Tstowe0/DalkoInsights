/**
 * Shared Glass Box tool chrome — used by every Scripts/* module.
 */

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
 * @typedef {object} ToolShellOptions
 * @property {string} title
 * @property {string} [category]
 * @property {string} [instructions]
 * @property {boolean} [underConstruction]
 * @property {() => void} onBack
 * @property {(msg: string) => void} [log]
 */

/**
 * Mount a standard tool workspace panel (title, instructions, body slot).
 * @param {HTMLElement} parent
 * @param {ToolShellOptions} opts
 * @returns {{ body: HTMLElement, setStatus: (text: string) => void }}
 */
export function mountToolShell(parent, opts) {
  const {
    title,
    category = "",
    instructions = "This tool module is ready for web logic to be ported in.",
    underConstruction = false,
    log,
  } = opts;

  parent.innerHTML = `
    <section class="gb-tool" data-tool="${escapeHtml(title)}">
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
        <article class="gb-tool-panel gb-tool-panel--instructions" data-instructions-panel>
          <h3 class="gb-tool-panel-title">Instructions</h3>
          <pre class="gb-tool-instructions">${escapeHtml(instructions.trim())}</pre>
        </article>

        <article class="gb-tool-panel gb-tool-panel--workspace gb-tool-panel-body">
          <h3 class="gb-tool-panel-title">Workspace</h3>
          <div class="gb-tool-body" data-tool-body>
            ${
              underConstruction
                ? `<p class="gb-tool-note">This tool is marked under construction in Glass Box.</p>`
                : `<p class="gb-tool-note">Tool shell is live. Processing logic will be added in this module.</p>
                   <div class="gb-tool-drop" data-tool-drop>
                     <p>Drop a file here or choose one to begin (coming next).</p>
                     <button type="button" class="btn btn-secondary" data-tool-browse disabled>Choose file</button>
                   </div>`
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

  const body = /** @type {HTMLElement} */ (parent.querySelector("[data-tool-body]"));

  log?.(`Loaded tool module: ${title}`);

  return {
    body,
    setStatus(text) {
      if (text && text !== "Ready") log?.(text);
    },
  };
}
