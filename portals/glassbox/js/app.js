import { NAV_ITEMS } from "./catalog.js?v=20260804-todotitle";
import { launchTool } from "./tool-loader.js?v=20260804-todotitle";
import { mountSidebarCalendar } from "./calendar.js?v=20260804-todotitle";
import { mountSidebarTodo } from "./todo.js?v=20260804-todotitle";
import {
  renderGlassNav,
  renderHome,
  renderSection,
  renderClientReports,
  renderChangelog,
  renderThemes,
} from "./views.js?v=20260804-todotitle";

const LOGO = new URL("../images/logo.png", import.meta.url).href;

/** @type {AbortController | null} */
let abort = null;
/** @type {string} */
let activeView = "home";
/** @type {string} */
let returnView = "home";
/** @type {string} */
let changelogCache = "";

/**
 * @param {{ onHome: () => void }} ctx
 */
export function initGlassBox(ctx) {
  abort?.abort();
  abort = new AbortController();
  const { signal } = abort;

  const nav = document.getElementById("gb-nav");
  const workspace = document.getElementById("gb-workspace");
  const consoleEl = document.getElementById("gb-console");
  const consoleBody = document.getElementById("gb-console-body");
  const btnConsole = document.getElementById("gb-btn-console");
  const btnConsoleClose = document.getElementById("gb-console-close");
  const btnPortals = document.getElementById("gb-btn-portals");
  const calendarHost = document.getElementById("gb-calendar");
  const todoHost = document.getElementById("gb-todo");

  if (!nav || !workspace) return;

  if (todoHost) {
    mountSidebarTodo(todoHost, { signal });
  }
  if (calendarHost) {
    mountSidebarCalendar(calendarHost, { signal });
  }

  /**
   * @param {string} line
   */
  function appendConsole(line) {
    if (!consoleBody) return;
    const row = document.createElement("div");
    row.className = "gb-console-line";
    row.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
    consoleBody.appendChild(row);
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }

  /**
   * @param {import("./catalog.js").GlassTool} tool
   */
  const openTool = (tool) => {
    returnView = activeView.startsWith("tool:") ? returnView : activeView;
    activeView = `tool:${tool.id}`;
    renderGlassNav(nav, returnView, selectNav);
    void launchTool(tool.script, workspace, {
      onBack: () => selectNav(returnView || "home"),
      log: appendConsole,
    });
  };

  /**
   * @param {string} id
   */
  const selectNav = (id) => {
    const item = NAV_ITEMS.find((n) => n.id === id);
    if (!item || item.kind === "console") return;

    activeView = id;
    renderGlassNav(nav, id, selectNav);

    if (item.kind === "home") {
      renderHome(workspace, LOGO);
      return;
    }
    if (item.kind === "section") {
      renderSection(workspace, id, openTool);
      return;
    }
    if (item.kind === "reports") {
      renderClientReports(workspace, openTool);
      return;
    }
    if (item.kind === "changelog") {
      void showChangelog(workspace);
      return;
    }
    if (item.kind === "themes") {
      renderThemes(workspace);
    }
  };

  /**
   * @param {HTMLElement} workspaceEl
   */
  async function showChangelog(workspaceEl) {
    if (!changelogCache) {
      try {
        const res = await fetch(new URL("../ChangeLog.txt", import.meta.url));
        changelogCache = res.ok ? await res.text() : "Could not load ChangeLog.txt.";
      } catch {
        changelogCache = "Could not load ChangeLog.txt.";
      }
    }
    renderChangelog(workspaceEl, changelogCache);
  }

  /**
   * @param {boolean} [forceOpen]
   */
  function toggleConsole(forceOpen) {
    if (!consoleEl) return;
    const shouldOpen = forceOpen ?? consoleEl.classList.contains("hidden");
    consoleEl.classList.toggle("hidden", !shouldOpen);
    btnConsole?.classList.toggle("active", shouldOpen);
  }

  btnPortals?.addEventListener("click", () => ctx.onHome(), { signal });
  btnConsole?.addEventListener("click", () => toggleConsole(), { signal });
  btnConsoleClose?.addEventListener("click", () => toggleConsole(false), { signal });

  renderGlassNav(nav, "home", selectNav);
  renderHome(workspace, LOGO);
  appendConsole("Glass Box shell ready.");
  appendConsole("Scripts modules imported and ready to launch.");
}

export function destroyGlassBox() {
  abort?.abort();
  abort = null;
  activeView = "home";
  returnView = "home";
}
