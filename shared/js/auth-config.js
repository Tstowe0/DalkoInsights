/**
 * DALKO Insights Entra ID app (its own registration, not MyCRM).
 * Paste AUTH_CLIENT_ID from Azure after you create the "DALKO Insights" app.
 *
 * Azure: Authentication → Single-page application redirect URIs:
 *   http://localhost:8080/
 *   http://localhost:8080/index.html
 *   https://tstowe0.github.io/DalkoInsights/
 *   https://tstowe0.github.io/DalkoInsights/index.html
 */
export const AUTH_CLIENT_ID = "bd5e8f2e-64e3-4d59-ac0c-c0052e42c842";
export const AUTH_TENANT_ID = "5ee09e0c-7917-4a06-9090-62ecb16a2927";
export const AUTH_ALLOWED_DOMAIN = "shipdalko.com";

export const AUTH_SCOPES = ["openid", "profile", "email", "User.Read"];
export const AUTH_ERROR_KEY = "dalko.insights.authError";
