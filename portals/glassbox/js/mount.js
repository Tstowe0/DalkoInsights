import { loadPortalCss } from "../../../shared/js/router.js?v=20260804-todotitle";
import { initGlassBox, destroyGlassBox } from "./app.js?v=20260804-todotitle";

const LOGO = new URL("../images/logo.png", import.meta.url).href;

const TEMPLATE = `
  <div class="gb-app" data-layer="glassbox">
    <aside class="gb-sidebar">
      <button type="button" class="gb-brand" id="gb-btn-portals" title="Back to hub" aria-label="Back to Dalko Insights hub">
        <img class="gb-brand-logo" src="${LOGO}" width="52" height="52" alt="" />
        <div>
          <div class="gb-brand-title">The Glass Box</div>
        </div>
      </button>

      <p class="gb-nav-heading">Menu</p>
      <nav class="gb-nav" id="gb-nav" aria-label="Glass Box"></nav>

      <div class="gb-sidebar-foot">
        <button type="button" class="gb-nav-btn gb-console-toggle" id="gb-btn-console">
          <img class="gb-nav-icon" src="${new URL("../images/menuicons/Console.png", import.meta.url).href}" width="20" height="20" alt="" />
          <span class="gb-nav-label">Console</span>
        </button>
        <p class="gb-credit">Created by Terry Stowe</p>
      </div>
    </aside>

    <div class="gb-main">
      <div class="gb-workspace" id="gb-workspace" tabindex="-1"></div>

      <section class="gb-console hidden" id="gb-console" aria-label="Console">
        <header class="gb-console-bar">
          <span>Console</span>
          <button type="button" class="gb-console-x" id="gb-console-close" aria-label="Close console">✕</button>
        </header>
        <div class="gb-console-body" id="gb-console-body"></div>
      </section>
    </div>

    <aside class="gb-rail" aria-label="Calendar and to-do">
      <div class="gb-calendar-host" id="gb-calendar"></div>
      <div class="gb-rail-divider" role="separator" aria-hidden="true"></div>
      <div class="gb-todo-host" id="gb-todo"></div>
    </aside>
  </div>
`;

/**
 * @param {HTMLElement} root
 * @param {{ onHome: () => void }} ctx
 */
export async function mount(root, ctx) {
  await loadPortalCss("portals/glassbox/css/portal.css?v=20260804-todotitle");
  root.innerHTML = TEMPLATE;
  initGlassBox({ onHome: ctx.onHome });
}

export async function unmount() {
  destroyGlassBox();
}
