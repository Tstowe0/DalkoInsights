import { alertDialog } from "./dialog.js?v=20260915-brand";
import { openPortal, closePortal } from "./router.js?v=20260915-msauth";
import { initTheme } from "./theme.js?v=20260915-msauth";
import {
  consumeAuthError,
  getDisplayName,
  getEmail,
  getGreetingName,
  getInitials,
  initAuth,
  isAuthConfigured,
  signIn,
  signOut,
} from "./auth.js?v=20260915-greet";

/**
 * Top-level Dalko shell: one landing card that swaps sign-in for portal tiles.
 */
export async function initShell() {
  initTheme();
  const hub = document.getElementById("insights-hub");
  const root = document.getElementById("portal-root");
  const signinPanel = document.getElementById("landing-signin");
  const portalsPanel = document.getElementById("landing-portals");
  const landingTitle = document.getElementById("landing-title");
  const landingPrompt = document.getElementById("landing-prompt");
  const btnSignIn = document.getElementById("btn-signin-ms");
  const signinLabel = document.getElementById("signin-ms-label");
  const signinError = document.getElementById("signin-error");
  const hubUser = document.getElementById("hub-user");
  const btnHubUser = document.getElementById("btn-hub-user");
  const hubUserMenu = document.getElementById("hub-user-menu");
  const btnSignOut = document.getElementById("btn-sign-out");

  if (!hub || !root || !signinPanel || !portalsPanel) return;

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
          ? "Sign-in is not configured. Create the Dalko app in Entra ID and paste its client ID into auth-config.js."
          : raw && /50011|redirect uri/i.test(raw)
            ? "Redirect URI mismatch. Sign in from http://localhost:8080/ or the GitHub Pages URL registered in Entra."
            : raw
              ? `Sign-in failed. ${raw}`
              : "Sign-in failed. Try again.";
    signinError.classList.remove("hidden");
  }

  function paintHubUser() {
    const initialsEl = document.getElementById("hub-user-initials");
    const nameEl = document.getElementById("hub-user-name");
    const emailEl = document.getElementById("hub-user-email");
    if (initialsEl) initialsEl.textContent = getInitials();
    if (nameEl) nameEl.textContent = getDisplayName();
    if (emailEl) emailEl.textContent = getEmail();
    if (btnHubUser) btnHubUser.title = getDisplayName();
    const first = getGreetingName();
    if (landingTitle) {
      landingTitle.textContent =
        !first || first === "there" ? "Welcome!" : `Welcome ${first}!`;
    }
    if (landingPrompt) landingPrompt.textContent = "Choose a portal";
  }

  function closeUserMenu() {
    hubUserMenu?.classList.add("hidden");
    btnHubUser?.setAttribute("aria-expanded", "false");
  }

  function showSignIn() {
    layer = "signin";
    document.title = "DALKO";
    hub.classList.remove("hidden");
    hub.classList.remove("is-authed");
    hubUser?.classList.add("hidden");
    signinPanel.classList.remove("hidden");
    portalsPanel.classList.add("hidden");
    if (landingTitle) landingTitle.textContent = "DALKO";
    if (landingPrompt) landingPrompt.textContent = "Let's grow together";
    closeUserMenu();
    root.classList.remove("active");
  }

  async function showHub() {
    layer = "hub";
    document.title = "DALKO";
    await closePortal(root);
    hub.classList.remove("hidden");
    hub.classList.add("is-authed");
    hubUser?.classList.remove("hidden");
    signinPanel.classList.add("hidden");
    portalsPanel.classList.remove("hidden");
    paintHubUser();
    closeUserMenu();
  }

  /**
   * @param {string} portalId
   */
  async function selectPortal(portalId) {
    try {
      hub.classList.add("hidden");
      await openPortal(/** @type {import("./router.js").PortalId} */ (portalId), root, {
        onHome: () => {
          void showHub();
        },
      });
      layer = portalId;
      document.title =
        portalId === "dalko"
          ? "DALKO Insights"
          : portalId === "glassbox"
            ? "The Glass Box"
            : "DALKO";
    } catch (err) {
      await showHub();
      await alertDialog(
        err instanceof Error ? err.message : "Could not open that portal.",
        { title: "Portal error" }
      );
    }
  }

  portalsPanel.querySelectorAll("[data-portal]").forEach((btn) => {
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
    if (e.key !== "Escape") return;
    if (hubUserMenu && !hubUserMenu.classList.contains("hidden")) {
      e.preventDefault();
      closeUserMenu();
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
    const { account } = await initAuth();
    if (account) {
      await showHub();
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
