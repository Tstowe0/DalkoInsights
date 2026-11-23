import { CLIENT_REPORT_BANDS, getSection, NAV_ITEMS } from "./catalog.js?v=20261023-ttx";
import { menuIconUrl, tileIconUrl } from "./icons.js?v=20261023-ttx";
import { THEME_GROUPS, THEMES, getThemeId, setTheme } from "../../../shared/js/theme.js?v=20261123-slate-linen";

/**
 * @param {HTMLElement} container
 * @param {string} activeId
 * @param {(id: string) => void} onSelect
 */
export function renderGlassNav(container, activeId, onSelect) {
  container.innerHTML = "";
  for (const item of NAV_ITEMS) {
    if (item.kind === "console") continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `gb-nav-btn${item.id === activeId ? " active" : ""}`;
    btn.dataset.navId = item.id;
    btn.innerHTML = `
      <img class="gb-nav-icon" src="${menuIconUrl(item.label)}" width="20" height="20" alt="" />
      <span class="gb-nav-label">${escapeHtml(item.label)}</span>
    `;
    const icon = btn.querySelector(".gb-nav-icon");
    icon?.addEventListener("error", () => icon.classList.add("missing"));
    btn.addEventListener("click", () => onSelect(item.id));
    container.appendChild(btn);
  }
}

/**
 * @param {HTMLElement} workspace
 * @param {string} logoUrl
 */
export function renderHome(workspace, logoUrl) {
  workspace.innerHTML = `
    <section class="gb-home" aria-label="Glass Box home">
      <div class="gb-home-glow" aria-hidden="true"></div>
      <img class="gb-home-logo" src="${logoUrl}" width="220" height="220" alt="" />
      <h1 class="gb-home-title">The Glass Box</h1>
    </section>
  `;
}

/**
 * @param {HTMLElement} workspace
 * @param {string} sectionId
 * @param {(tool: import("./catalog.js").GlassTool) => void} onTool
 */
export function renderSection(workspace, sectionId, onTool) {
  const section = getSection(sectionId);
  if (!section) {
    workspace.innerHTML = `<p class="gb-empty">Section not found.</p>`;
    return;
  }
  workspace.innerHTML = `
    <section class="gb-section">
      <header class="ui-page-header">
        <h1>${escapeHtml(section.label)}</h1>
      </header>
      <div class="gb-tile-grid" id="gb-tile-grid"></div>
    </section>
  `;
  fillTileGrid(workspace.querySelector("#gb-tile-grid"), section.tools, onTool);
}

/**
 * @param {HTMLElement} workspace
 * @param {(tool: import("./catalog.js").GlassTool) => void} onTool
 */
export function renderClientReports(workspace, onTool) {
  workspace.innerHTML = `
    <section class="gb-section">
      <header class="ui-page-header">
        <h1>Reports</h1>
      </header>
      <div class="gb-report-bands" id="gb-report-bands"></div>
    </section>
  `;
  const bandsEl = workspace.querySelector("#gb-report-bands");
  if (!bandsEl) return;

  for (const band of CLIENT_REPORT_BANDS) {
    if (!band.tools.length) continue;
    const block = document.createElement("div");
    block.className = "gb-report-band";
    block.innerHTML = `
      <div class="gb-report-band-label">
        <span>${escapeHtml(band.label)}</span>
      </div>
      <div class="gb-tile-grid" data-band="${escapeHtml(band.id)}"></div>
    `;
    bandsEl.appendChild(block);
    fillTileGrid(block.querySelector(".gb-tile-grid"), band.tools, onTool);
  }
}

/**
 * @param {HTMLElement} workspace
 * @param {string} changelogText
 */
export function renderChangelog(workspace, changelogText) {
  workspace.innerHTML = `
    <section class="gb-section gb-section-scroll">
      <header class="gb-section-header">
        <h2 class="gb-section-title">Change Log</h2>
      </header>
      <pre class="gb-changelog">${escapeHtml(changelogText.trim() || "No changelog available.")}</pre>
    </section>
  `;
}

/**
 * @param {HTMLElement} workspace
 */
export function renderThemes(workspace, { settings = false } = {}) {
  const active = getThemeId();
  const groups = THEME_GROUPS.map(({ id, label }) => `
    <section class="theme-group">
      <h2 class="theme-group-label">${label}</h2>
      <div class="gb-theme-grid" role="list">
        ${THEMES.filter((theme) => theme.group === id).map((theme) => {
          const swatches = theme.swatches
            .map((c) => `<span style="background:${c}"></span>`)
            .join("");
          return `
          <button type="button" class="gb-theme-card${theme.id === active ? " is-active" : ""}" data-theme-id="${theme.id}" role="listitem">
            <div class="gb-theme-swatches" aria-hidden="true">${swatches}</div>
            <p class="gb-theme-name">${theme.name}</p>
            <p class="gb-theme-desc">${theme.description}</p>
            <p class="gb-theme-state">${theme.id === active ? "Active" : "Apply"}</p>
          </button>`;
        }).join("")}
      </div>
    </section>
  `).join("");
  workspace.innerHTML = settings
    ? `<div class="page-canvas">
        <header class="ui-page-header">
          <h1>Themes</h1>
        </header>
        ${groups}
      </div>`
    : `<section class="gb-section">
        <header class="gb-section-header"><h1 class="gb-section-title">Themes</h1></header>
        ${groups}
      </section>`;

  workspace.querySelectorAll("[data-theme-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.themeId;
      if (!id) return;
      setTheme(id);
      renderThemes(workspace, { settings });
    });
  });
}

/**
 * @param {HTMLElement} workspace
 * @param {string} toolId
 * @param {string} label
 * @param {() => void} onBack
 */
export function renderToolPlaceholder(workspace, toolId, label, _onBack) {
  workspace.innerHTML = `
    <section class="gb-section">
      <header class="gb-section-header gb-section-header-row">
        <div>
          <h2 class="gb-section-title">${escapeHtml(label)}</h2>
        </div>
      </header>
      <div class="gb-tool-placeholder">
        <p>This tool will be ported into the Glass Box web module.</p>
        <p class="gb-tool-id"><code>${escapeHtml(toolId)}</code></p>
      </div>
    </section>
  `;
}

/**
 * @param {HTMLElement | null} grid
 * @param {import("./catalog.js").GlassTool[]} tools
 * @param {(tool: import("./catalog.js").GlassTool) => void} onTool
 */
function fillTileGrid(grid, tools, onTool) {
  if (!grid) return;
  grid.innerHTML = "";
  for (const tool of tools) {
    if (tool.hideTile) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `gb-tile${tool.disabled ? " disabled" : ""}${tool.skipped ? " gb-tile-skipped" : ""}`;
    btn.disabled = Boolean(tool.disabled);
    btn.dataset.toolId = tool.id;
    btn.style.setProperty("--tile-neon", randomNeon());
    btn.innerHTML = `
      <span class="gb-tile-title">${escapeHtml(tool.label)}</span>
      <img class="gb-tile-icon" src="${tileIconUrl(tool.label)}" width="56" height="56" alt="" />
      ${tool.subtitle ? `<span class="gb-tile-sub">${escapeHtml(tool.subtitle)}</span>` : ""}
    `;
    const icon = btn.querySelector(".gb-tile-icon");
    icon?.addEventListener("error", () => icon.classList.add("missing"));
    if (!tool.disabled) {
      btn.addEventListener("click", () => onTool(tool));
    }
    grid.appendChild(btn);
  }
}

const TILE_NEONS = ["#ff2d8a", "#2ee6ff", "#c084fc", "#3dffb0", "#ffb15a", "#ff4dff", "#7af4ff", "#ff5a7a"];

/** Last color dealt, so the next tile on the page gets a different one. */
let lastNeon = "";

/** A new neon each time the board is built. */
function randomNeon() {
  const pool = TILE_NEONS.filter((color) => color !== lastNeon);
  const choices = pool.length ? pool : TILE_NEONS;
  lastNeon = choices[Math.floor(Math.random() * choices.length)];
  return lastNeon;
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
