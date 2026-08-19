import { loadPortalCss } from "../../../shared/js/router.js";

const LOGO = new URL("../../../shared/images/earth.png", import.meta.url).href;

/**
 * @param {HTMLElement} root
 * @param {{ onHome: () => void }} ctx
 */
export async function mount(root, ctx) {
  await loadPortalCss("portals/customer/css/portal.css");
  root.innerHTML = `
    <div class="portal-placeholder" data-portal="customer">
      <div class="portal-placeholder-card">
        <img src="${LOGO}" width="48" height="48" alt="" style="border-radius:50%;margin-bottom:0.85rem" />
        <h1 class="portal-placeholder-title">Customer Portal</h1>
        <p class="portal-placeholder-desc">Customer-facing insights will live in this module.</p>
        <button type="button" class="btn btn-secondary" id="btn-customer-home">Back to hub</button>
      </div>
    </div>
  `;
  root.querySelector("#btn-customer-home")?.addEventListener("click", () => ctx.onHome());
}

export async function unmount() {}
