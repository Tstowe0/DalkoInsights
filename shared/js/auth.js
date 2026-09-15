import {
  AUTH_ALLOWED_DOMAIN,
  AUTH_CLIENT_ID,
  AUTH_ERROR_KEY,
  AUTH_SCOPES,
  AUTH_TENANT_ID,
} from "./auth-config.js?v=20260915-app2";

const MSAL_SOURCES = [
  "https://alcdn.msauth.net/browser/2.35.0/js/msal-browser.min.js",
  "https://alcdn.msftauth.net/browser/2.35.0/js/msal-browser.min.js",
];

/** @type {import("@azure/msal-browser").PublicClientApplication | null} */
let pca = null;
/** @type {import("@azure/msal-browser").AccountInfo | null} */
let activeAccount = null;

export function getRedirectUri() {
  const { origin, pathname } = window.location;
  const dir = pathname.replace(/\/index\.html$/i, "/");
  const withSlash = dir.endsWith("/") ? dir : `${dir}/`;
  return `${origin}${withSlash}`;
}

function configured() {
  return Boolean(AUTH_CLIENT_ID && AUTH_TENANT_ID);
}

/**
 * @param {import("@azure/msal-browser").AccountInfo | null | undefined} account
 */
function emailOf(account) {
  return String(account?.username ?? "").toLowerCase();
}

/**
 * @param {import("@azure/msal-browser").AccountInfo | null | undefined} account
 */
function isAllowed(account) {
  const email = emailOf(account);
  return email.endsWith(`@${AUTH_ALLOWED_DOMAIN}`);
}

function setAuthError(code) {
  try {
    sessionStorage.setItem(AUTH_ERROR_KEY, code);
  } catch {
    /* ignore */
  }
}

export function consumeAuthError() {
  try {
    const code = sessionStorage.getItem(AUTH_ERROR_KEY);
    if (code) sessionStorage.removeItem(AUTH_ERROR_KEY);
    return code;
  } catch {
    return null;
  }
}

function msalLib() {
  return /** @type {{ PublicClientApplication?: unknown } | undefined} */ (
    /** @type {{ msal?: { PublicClientApplication?: unknown } }} */ (window).msal
  );
}

/**
 * @param {string} src
 * @returns {Promise<{ PublicClientApplication: unknown }>}
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => {
      const lib = msalLib();
      if (!lib?.PublicClientApplication) {
        reject(new Error("Microsoft sign-in library did not load."));
        return;
      }
      resolve(/** @type {{ PublicClientApplication: unknown }} */ (lib));
    };
    el.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(el);
  });
}

async function loadMsal() {
  const existing = msalLib();
  if (existing?.PublicClientApplication) {
    return /** @type {{ PublicClientApplication: unknown }} */ (existing);
  }
  let lastErr = new Error("Could not load Microsoft sign-in.");
  for (const src of MSAL_SOURCES) {
    try {
      return await loadScript(src);
    } catch (err) {
      lastErr = err instanceof Error ? err : lastErr;
    }
  }
  throw lastErr;
}

function loginRequest() {
  return {
    scopes: AUTH_SCOPES,
    extraQueryParameters: { domain_hint: AUTH_ALLOWED_DOMAIN },
  };
}

/**
 * @param {import("@azure/msal-browser").AccountInfo} account
 */
async function rejectIfDisallowed(account) {
  if (isAllowed(account)) return account;
  setAuthError("AccessDenied");
  activeAccount = null;
  pca?.setActiveAccount(null);
  await pca?.logoutRedirect({
    account,
    postLogoutRedirectUri: getRedirectUri(),
  });
  return null;
}

export async function initAuth() {
  if (!configured()) return { account: null, justSignedIn: false };
  const msal = await loadMsal();
  const redirectUri = getRedirectUri();
  pca = new msal.PublicClientApplication({
    auth: {
      clientId: AUTH_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${AUTH_TENANT_ID}`,
      redirectUri,
      postLogoutRedirectUri: redirectUri,
      navigateToLoginRequestUrl: false,
    },
    cache: {
      cacheLocation: "localStorage",
      storeAuthStateInCookie: false,
    },
  });
  if (typeof pca.initialize === "function") await pca.initialize();

  const result = await pca.handleRedirectPromise();
  if (result?.account) {
    pca.setActiveAccount(result.account);
    activeAccount = await rejectIfDisallowed(result.account);
    return { account: activeAccount, justSignedIn: Boolean(activeAccount) };
  }

  const accounts = pca.getAllAccounts();
  if (!accounts.length) {
    activeAccount = null;
    return { account: null, justSignedIn: false };
  }

  const account = accounts[0];
  pca.setActiveAccount(account);
  activeAccount = await rejectIfDisallowed(account);
  return { account: activeAccount, justSignedIn: false };
}

export function isAuthConfigured() {
  return configured();
}

export function getAccount() {
  return activeAccount;
}

export function getEmail() {
  return emailOf(activeAccount);
}

export function getDisplayName() {
  return String(activeAccount?.name || getEmail() || "Signed in");
}

export function getInitials() {
  const name = getDisplayName();
  const parts = name.replace(/@.*$/, "").split(/[\s.]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return letters.toUpperCase() || "DI";
}

export async function signIn() {
  if (!pca) throw new Error("Sign-in is not ready.");
  await pca.loginRedirect(loginRequest());
}

export async function signOut() {
  const account = activeAccount;
  activeAccount = null;
  if (!pca) {
    window.location.assign(getRedirectUri());
    return;
  }
  await pca.logoutRedirect({
    account: account ?? undefined,
    postLogoutRedirectUri: getRedirectUri(),
  });
}
