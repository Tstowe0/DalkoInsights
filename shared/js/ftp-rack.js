/**
 * Office-only bridge to the FTP rack on DELTA.
 * The public GitHub Pages site cannot call a private address.
 */

export const RACK_ORIGIN = "https://delta.shipdalko.com";

export function isLocalBuild() {
  const host = location.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)
  );
}

export async function fetchRack() {
  const res = await fetch(`${RACK_ORIGIN}/api/rack`, { cache: "no-store" });
  if (!res.ok) throw new Error(`The rack answered ${res.status}.`);
  return res.json();
}

/**
 * Post a finished file to one rack unit and wait until that unit finishes the FTP.
 * @param {string} connectionId
 * @param {string} filename
 * @param {string | Blob} body
 * @returns {Promise<string>}
 */
export async function sendToRack(connectionId, filename, body) {
  const res = await fetch(`${RACK_ORIGIN}/api/connections/${encodeURIComponent(connectionId)}/send`, {
    method: "POST",
    headers: { "X-Filename": filename },
    body,
  });
  /** @type {{ error?: string }} */
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || `The rack refused the file (${res.status}).`);
  return waitForSend(connectionId, filename);
}

/**
 * @param {string} connectionId
 * @param {string} filename
 */
async function waitForSend(connectionId, filename) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const rack = await fetchRack();
    const unit = (rack.connections || []).find((item) => item.id === connectionId);
    if (!unit) throw new Error("That connection is no longer on the rack.");
    if (unit.phase === "busy") continue;
    if (unit.lastFile !== filename) continue;
    if (unit.phase === "ok") return unit.detail || `Sent ${filename}`;
    throw new Error(unit.detail || "TMS did not accept the file.");
  }
  throw new Error("The rack accepted the file, but did not finish in time. Check the rack log on DELTA.");
}
