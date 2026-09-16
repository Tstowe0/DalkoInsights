import { loadPortalCss } from "../../../shared/js/router.js";
import { initDalkoPortal, destroyDalkoPortal } from "./app.js?v=20260916-xlsxstyle";
import { paintSidebarGreeting } from "../../../shared/js/auth.js?v=20260915-greet";

const LOGO = new URL("../../../shared/images/earth.png", import.meta.url).href;

const TEMPLATE = `
  <div class="app" id="app" data-layer="dalko-portal">
    <aside class="sidebar">
      <button type="button" class="brand brand-btn" id="btn-brand-home" title="Back to hub" aria-label="Back to Dalko hub">
        <div class="brand-mark">
          <img class="brand-logo" src="${LOGO}" width="40" height="40" alt="" />
        </div>
        <div>
          <div class="brand-title">DALKO Insights</div>
          <div class="brand-tagline">Let's grow together</div>
        </div>
      </button>
      <button type="button" class="nav-back-hub" id="btn-back-hub">
        <span class="nav-back-hub-arrow" aria-hidden="true">←</span>
        Back to hub
      </button>
      <p class="nav-heading">Menu</p>
      <nav class="nav" id="main-nav" aria-label="Main"></nav>
      <div class="sidebar-foot">
        <p class="sidebar-greeting-hello" data-sidebar-hello>Good Morning</p>
        <p class="sidebar-greeting-name" data-sidebar-name></p>
      </div>
    </aside>

    <div class="main-wrap">
      <header class="topbar topbar-concept">
        <div class="topbar-search-row">
          <label class="search-wrap search-wrap-lg">
            <span class="search-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </span>
            <input type="search" id="table-search" class="search-input" placeholder="Search customers, carriers, lanes, cities in this view…" autocomplete="off" />
          </label>
          <div class="topbar-actions">
            <p class="topbar-status" id="status-text" aria-live="polite"></p>
            <button type="button" class="btn btn-clear-focus" id="btn-clear-focus" disabled>Clear focus</button>
            <button type="button" class="btn btn-primary" id="btn-upload">Upload file</button>
            <input type="file" id="file-input" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden />
          </div>
        </div>
      </header>

      <div class="content-workspace" id="content-workspace">
        <main class="content" id="main-content">
          <div class="view-root" id="view-root"></div>
        </main>
        <aside class="right-rail hidden" id="right-rail" aria-label="Summary"></aside>
      </div>
    </div>
  </div>
`;

/**
 * @param {string} src
 * @returns {Promise<void>}
 */
function loadScript(src) {
  if ([...document.scripts].some((s) => s.src.includes(src.split("/").pop() ?? src))) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

/**
 * @param {HTMLElement} root
 * @param {{ onHome: () => void }} ctx
 */
export async function mount(root, ctx) {
  await loadPortalCss("portals/dalko/css/portal.css?v=20260916-bugsweep");

  await Promise.all([
    loadScript("shared/vendor/xlsx-js-style.min.js"),
    loadScript("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"),
  ]);
  globalThis.__DALKO_XLSX_STYLE__ = true;

  root.innerHTML = TEMPLATE;
  paintSidebarGreeting(root);
  initDalkoPortal({ onHome: ctx.onHome });
}

export async function unmount() {
  destroyDalkoPortal();
}
