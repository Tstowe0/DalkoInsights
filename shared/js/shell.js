import { alertDialog } from "./dialog.js?v=20260804-todotitle";
import { openPortal, closePortal } from "./router.js?v=20260804-todotitle";
import { initTheme } from "./theme.js?v=20260804-todotitle";

/**
 * Top-level Dalko Insights shell: hub + portal chooser.
 */
export function initShell() {
  initTheme();
  const hub = document.getElementById("insights-hub");
  const menu = document.getElementById("portal-menu");
  const root = document.getElementById("portal-root");
  const btnOpen = document.getElementById("btn-open-portals");

  if (!hub || !menu || !root) return;

  /** @type {"hub" | string} */
  let layer = "hub";

  function openMenu() {
    menu.classList.remove("hidden");
    const first = /** @type {HTMLButtonElement | null} */ (
      menu.querySelector(".portal-menu-item")
    );
    first?.focus();
  }

  function closeMenu() {
    menu.classList.add("hidden");
    if (layer === "hub") btnOpen?.focus();
  }

  async function showHub() {
    layer = "hub";
    await closePortal(root);
    hub.classList.remove("hidden");
    closeMenu();
  }

  /**
   * @param {string} portalId
   */
  async function selectPortal(portalId) {
    closeMenu();
    try {
      hub.classList.add("hidden");
      await openPortal(/** @type {import("./router.js").PortalId} */ (portalId), root, {
        onHome: () => {
          void showHub();
        },
      });
      layer = portalId;
    } catch (err) {
      hub.classList.remove("hidden");
      layer = "hub";
      await alertDialog(
        err instanceof Error ? err.message : "Could not open that portal.",
        { title: "Portal error" }
      );
      openMenu();
    }
  }

  btnOpen?.addEventListener("click", () => openMenu());

  menu.querySelector(".portal-menu-backdrop")?.addEventListener("click", () => closeMenu());

  menu.querySelectorAll("[data-portal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.portal ?? "";
      void selectPortal(id);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (menu.classList.contains("hidden")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  });

  void showHub();
}

initShell();
