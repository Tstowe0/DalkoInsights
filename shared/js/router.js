/** @typedef {"dalko" | "customer" | "glassbox"} PortalId */

/**
 * @typedef {object} PortalModule
 * @property {(root: HTMLElement, ctx: { onHome: () => void }) => Promise<void> | void} mount
 * @property {() => Promise<void> | void} [unmount]
 */

/** Cache-bust so portal edits pick up without a hard refresh. */
const bust = () => `?v=${Date.now()}`;

/** @type {Record<PortalId, () => Promise<PortalModule>>} */
const PORTAL_LOADERS = {
  dalko: () => import(`../../portals/dalko/js/mount.js${bust()}`),
  customer: () => import(`../../portals/customer/js/mount.js${bust()}`),
  glassbox: () => import(`../../portals/glassbox/js/mount.js${bust()}`),
};

/** @type {PortalId | null} */
let activeId = null;
/** @type {PortalModule | null} */
let activeModule = null;
/** @type {HTMLLinkElement | null} */
let activeStylesheet = null;

/**
 * Load portal CSS and wait until it applies (avoids white FOUC on open).
 * @param {string} href
 * @returns {Promise<void>}
 */
function ensureStylesheet(href) {
  return new Promise((resolve) => {
    const prev = activeStylesheet;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    const sep = href.includes("?") ? "&" : "?";
    link.href = `${href}${sep}v=${Date.now()}`;
    link.dataset.portalCss = href;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      activeStylesheet = link;
      if (prev && prev !== link) prev.remove();
      resolve();
    };

    link.addEventListener("load", finish);
    link.addEventListener("error", finish);
    document.head.appendChild(link);

    // Already-cached sheets can fire before listeners attach in some browsers.
    if (link.sheet) {
      finish();
      return;
    }

    // Safety: never block portal open indefinitely.
    window.setTimeout(finish, 2500);
  });
}

/**
 * @param {PortalId} id
 * @param {HTMLElement} root
 * @param {{ onHome: () => void }} ctx
 */
export async function openPortal(id, root, ctx) {
  await closePortal(root);

  const loader = PORTAL_LOADERS[id];
  if (!loader) throw new Error(`Unknown portal: ${id}`);

  const mod = await loader();
  activeModule = mod;
  activeId = id;
  root.dataset.portal = id;
  // Mount waits for CSS, then paints — only then show the root (no white flash).
  await mod.mount(root, ctx);
  root.classList.add("active");
}

/**
 * @param {HTMLElement} root
 */
export async function closePortal(root) {
  if (activeModule?.unmount) {
    await activeModule.unmount();
  }
  activeModule = null;
  activeId = null;
  root.classList.remove("active");
  delete root.dataset.portal;
  root.innerHTML = "";
  if (activeStylesheet) {
    activeStylesheet.remove();
    activeStylesheet = null;
  }
}

export function getActivePortalId() {
  return activeId;
}

/**
 * @param {string} href
 * @returns {Promise<void>}
 */
export function loadPortalCss(href) {
  return ensureStylesheet(href);
}
