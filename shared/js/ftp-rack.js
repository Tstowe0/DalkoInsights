/**
 * Bridge to the FTP rack on DELTA at https://delta.shipdalko.com.
 * The name resolves to the office network, so a computer off that network cannot reach it.
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
 * Ask DELTA to log in to one service and report that result.
 * A 4xx with `{ ok: false, error }` is the service's answer, not a transport failure.
 * @param {string} connectionId
 * @returns {Promise<{ ok?: boolean, error?: string, detail?: string, message?: string }>}
 */
export async function testRackConnection(connectionId) {
  const res = await fetch(`${RACK_ORIGIN}/api/connections/${encodeURIComponent(connectionId)}/test`, {
    method: "POST",
    cache: "no-store",
  });
  /** @type {{ ok?: boolean, error?: string, detail?: string, message?: string }} */
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok && data.ok == null && !data.error) {
    throw new Error(`The rack answered ${res.status}.`);
  }
  if (typeof data.ok === "boolean" || data.error) return data;

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const rack = await fetchRack();
    const unit = (rack.connections || []).find((item) => item.id === connectionId);
    if (!unit) throw new Error("That connection is no longer on the rack.");
    if (unit.phase === "busy") continue;
    if (unit.phase === "ok") return { ok: true, detail: unit.detail || "Logged in." };
    if (unit.phase === "fault" || unit.phase === "off") {
      return { ok: false, error: unit.detail || "The login failed." };
    }
  }
  throw new Error("The rack started the login check, but did not finish in time.");
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
