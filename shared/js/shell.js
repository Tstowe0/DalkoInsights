import { alertDialog } from "./dialog.js?v=20260915-msauth";
import { openPortal, closePortal } from "./router.js?v=20260915-msauth";
import { initTheme } from "./theme.js?v=20260915-msauth";
import {
  consumeAuthError,
  getDisplayName,
  getEmail,
  getInitials,
  initAuth,
  isAuthConfigured,
  signIn,
  signOut,
} from "./auth.js?v=20260915-app3";

/**
 * Top-level Dalko Insights shell: sign-in → hub + portal chooser.
 */
export async function initShell() {
  initTheme();
  const signin = document.getElementById("signin-screen");
  const hub = document.getElementById("insights-hub");
  const menu = document.getElementById("portal-menu");
  const root = document.getElementById("portal-root");
  const btnOpen = document.getElementById("btn-open-portals");
  const btnSignIn = document.getElementById("btn-signin-ms");
  const signinLabel = document.getElementById("signin-ms-label");
  const signinError = document.getElementById("signin-error");
  const btnHubUser = document.getElementById("btn-hub-user");
  const hubUserMenu = document.getElementById("hub-user-menu");
  const btnSignOut = document.getElementById("btn-sign-out");

  if (!hub || !menu || !root || !signin) return;

  /** @type {"signin" | "hub" | string} */
  let layer = "signin";

  /**
   * @param {string | null} code
   * @param {unknown} [detail]
   */
  function showSigninError(code, detail) {
    if (!signinError) return;
    if (!code) {
      signinError.classList.add("hidden");
      signinError.textContent = "";
      return;
    }
    const raw = detail instanceof Error ? detail.message : "";
    signinError.textContent =
      code === "AccessDenied"
        ? "Use your Dalko Microsoft account (@shipdalko.com)."
        : code === "Configuration" || !isAuthConfigured()
          ? "Sign-in is not configured. Create the DALKO Insights app in Entra ID and paste its client ID into auth-config.js."
          : raw && /50011|redirect uri/i.test(raw)
            ? "Redirect URI mismatch. Sign in from http://localhost:8080/ or the GitHub Pages URL registered in Entra."
            : raw
              ? `Sign-in failed. ${raw}`
              : "Sign-in failed. Try again.";
    signinError.classList.remove("hidden");
  }

  function showSignIn() {
    layer = "signin";
    signin.classList.remove("hidden");
    hub.classList.add("hidden");
    menu.classList.add("hidden");
    root.classList.remove("active");
  }

  function paintHubUser() {
    const initialsEl = document.getElementById("hub-user-initials");
    const nameEl = document.getElementById("hub-user-name");
    const emailEl = document.getElementById("hub-user-email");
    if (initialsEl) initialsEl.textContent = getInitials();
    if (nameEl) nameEl.textContent = getDisplayName();
    if (emailEl) emailEl.textContent = getEmail();
    if (btnHubUser) btnHubUser.title = getDisplayName();
  }

  function closeUserMenu() {
    hubUserMenu?.classList.add("hidden");
    btnHubUser?.setAttribute("aria-expanded", "false");
  }

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
    signin.classList.add("hidden");
    hub.classList.remove("hidden");
    paintHubUser();
    closeUserMenu();
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

  btnSignIn?.addEventListener("click", async () => {
    if (!isAuthConfigured()) {
      showSigninError("Configuration");
      return;
    }
    btnSignIn.disabled = true;
    if (signinLabel) signinLabel.textContent = "Continuing to Microsoft…";
    try {
      await signIn();
    } catch (err) {
      btnSignIn.disabled = false;
      if (signinLabel) signinLabel.textContent = "Sign in with Microsoft";
      showSigninError("failed", err);
      console.error(err);
    }
  });

  btnHubUser?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = hubUserMenu?.classList.toggle("hidden") === false;
    btnHubUser.setAttribute("aria-expanded", open ? "true" : "false");
  });

  btnSignOut?.addEventListener("click", () => {
    void signOut();
  });

  document.addEventListener("click", (e) => {
    const user = document.getElementById("hub-user");
    if (user && !user.contains(/** @type {Node} */ (e.target))) closeUserMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (hubUserMenu && !hubUserMenu.classList.contains("hidden")) {
        e.preventDefault();
        closeUserMenu();
        return;
      }
      if (menu.classList.contains("hidden")) return;
      e.preventDefault();
      closeMenu();
    }
  });

  showSigninError(consumeAuthError());
  if (!isAuthConfigured()) {
    showSigninError("Configuration");
    btnSignIn && (btnSignIn.disabled = true);
    return;
  }

  if (signinLabel) signinLabel.textContent = "Checking session…";
  btnSignIn && (btnSignIn.disabled = true);
  try {
    const { account, justSignedIn } = await initAuth();
    if (account) {
      await showHub();
      if (justSignedIn) openMenu();
    } else {
      showSignIn();
      if (signinLabel) signinLabel.textContent = "Sign in with Microsoft";
      btnSignIn && (btnSignIn.disabled = false);
    }
  } catch (err) {
    console.error(err);
    showSignIn();
    showSigninError("failed", err);
    if (signinLabel) signinLabel.textContent = "Sign in with Microsoft";
    btnSignIn && (btnSignIn.disabled = false);
  }
}

void initShell();
