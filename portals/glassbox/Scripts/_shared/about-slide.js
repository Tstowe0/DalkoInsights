/**
 * Glass Box "?" → sliding "About" control + About modal.
 * Matches desktop hover-slide / click-to-open behavior.
 */

import { getToolAbout } from "./tool-abouts.js";

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
 * @param {HTMLElement} host  container to append the help control into
 * @param {{ title: string, toolId?: string }} opts
 */
export function mountAboutSlide(host, opts) {
  const { title, toolId = title } = opts;
  let info = null;
  try {
    info = getToolAbout(toolId) || getToolAbout(title);
  } catch {
    info = null;
  }

  const wrap = document.createElement("div");
  wrap.className = "gb-about-row";
  wrap.innerHTML = `
    <div class="gb-about-slide-host" data-about-host title="About this tool">
      <button type="button" class="gb-about-slide" data-about-slide tabindex="-1">About</button>
      <button type="button" class="gb-about-help" data-about-help aria-label="About ${escapeHtml(title)}">?</button>
    </div>
  `;
  host.appendChild(wrap);

  const hostEl = /** @type {HTMLElement} */ (wrap.querySelector("[data-about-host]"));
  const helpBtn = /** @type {HTMLButtonElement} */ (wrap.querySelector("[data-about-help]"));
  const slideBtn = /** @type {HTMLButtonElement} */ (wrap.querySelector("[data-about-slide]"));

  const open = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    openAboutModal(title, info);
  };
  helpBtn.addEventListener("click", open);
  slideBtn.addEventListener("click", open);

  hostEl.addEventListener("mouseenter", () => hostEl.classList.add("is-open"));
  hostEl.addEventListener("mouseleave", () => hostEl.classList.remove("is-open"));
  hostEl.addEventListener("focusin", () => hostEl.classList.add("is-open"));
  hostEl.addEventListener("focusout", (e) => {
    if (!hostEl.contains(/** @type {Node} */ (e.relatedTarget))) {
      hostEl.classList.remove("is-open");
    }
  });
}

/**
 * @param {string} title
 * @param {{ about: string, technical: string } | null} info
 */
function openAboutModal(title, info) {
  document.querySelector(".gb-about-modal")?.remove();

  const about = info?.about?.trim() || "No about text is available for this tool yet.";
  const technical =
    info?.technical?.trim() || "No technical details are available for this tool yet.";

  const modal = document.createElement("div");
  modal.className = "gb-about-modal";
  modal.innerHTML = `
    <div class="gb-about-dialog" role="dialog" aria-modal="true" aria-label="About ${escapeHtml(title)}">
      <header class="gb-about-dialog-bar">
        <h3>About — ${escapeHtml(title)}</h3>
        <button type="button" class="gb-about-dialog-x" data-about-close aria-label="Close">✕</button>
      </header>
      <div class="gb-about-dialog-body">
        <p class="gb-fly-heading">About</p>
        <p class="gb-fly-about">${escapeHtml(about)}</p>
        <p class="gb-fly-heading">Technical details / Mapping &amp; Logic</p>
        <pre class="gb-fly-tech">${escapeHtml(technical)}</pre>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector("[data-about-close]")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  const onKey = (e) => {
    if (e.key === "Escape") {
      close();
      window.removeEventListener("keydown", onKey);
    }
  };
  window.addEventListener("keydown", onKey);
}
