import { mountAboutSlide } from "../_shared/about-slide.js";
import { RACK_ORIGIN } from "../../../../shared/js/ftp-rack.js?v=20261001-rackapi";

export const meta = {
  id: "Carrier Search",
  title: "Carrier Search",
  category: "Data Tools",
  script: "Data Tools/Carrier Search.js",
};

const PROXY = RACK_ORIGIN;

const SEARCH_ICO = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="6.25" stroke="currentColor" stroke-width="1.8"/><path d="M16 16.5 20 20.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function dash(value) {
  const raw = String(value ?? "").trim();
  return raw || "—";
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

function address(carrier) {
  return (
    [carrier?.street, carrier?.city, carrier?.state, carrier?.zip]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(", ") || "—"
  );
}

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const content = payload.content ?? payload;
  if (Array.isArray(content)) return content;
  if (Array.isArray(content?.carrier)) return content.carrier;
  if (content && typeof content === "object") return [content];
  return [];
}

function labelize(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function ratingKind(value) {
  const raw = String(value ?? "").trim();
  if (/^sat/i.test(raw) && !/unsat/i.test(raw)) return "good";
  if (/unsat|cond/i.test(raw)) return "bad";
  return "none";
}

function authKind(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "n" || raw === "none" || raw === "not authorized") return "off";
  if (raw === "a" || raw === "y" || raw.includes("active") || raw.includes("authorized")) return "on";
  return "mid";
}

function authLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "None";
  if (/^a$/i.test(raw)) return "Active";
  if (/^n$/i.test(raw)) return "None";
  if (/^i$/i.test(raw)) return "Inactive";
  return raw;
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  parent.classList.add("cs-host");
  parent.innerHTML = `
    <section class="cs" data-cs>
      <header class="cs-titlebar">
        <h1>Carrier Search</h1>
        <div class="cs-about" data-about-slot></div>
      </header>
      <div class="cs-grid">
        <section class="cs-guide">
          <p class="cs-kicker">How to use</p>
          <ol class="cs-steps">
            <li><span class="cs-num">1</span><p>Look up a US motor carrier by name, USDOT, or MC number.</p></li>
            <li><span class="cs-num">2</span><p>Auto treats digits as a USDOT, MC123456 as a docket, and anything else as a name. Name, USDOT, or MC forces one mode.</p></li>
            <li><span class="cs-num">3</span><p>Click a match to open the snapshot: authority, insurance on file, BASICs, and out-of-service rates.</p></li>
          </ol>
        </section>
        <form class="cs-lane" data-form>
          <p class="cs-kicker">Search</p>
          <div class="cs-bar">
            <span class="cs-bar-ico">${SEARCH_ICO}</span>
            <input data-query type="text" placeholder="Schneider, 241829, or MC123456" autocomplete="off" spellcheck="false" aria-label="Carrier name, USDOT, or MC number" />
          </div>
          <div class="cs-modes" role="radiogroup" aria-label="Lookup type">
            <label class="is-on"><input type="radio" name="cs-mode" value="auto" checked /> Auto</label>
            <label><input type="radio" name="cs-mode" value="name" /> Name</label>
            <label><input type="radio" name="cs-mode" value="dot" /> USDOT</label>
            <label><input type="radio" name="cs-mode" value="mc" /> MC</label>
          </div>
          <div class="cs-actions">
            <button type="submit" class="btn btn-primary" data-search>Look up</button>
          </div>
        </form>
        <div class="cs-stage" data-stage>
          <aside class="cs-list" aria-label="Matches">
            <div class="cs-list-head">
              <p class="cs-kicker" data-count>Matches</p>
            </div>
            <div class="cs-list-body" data-results>
              <p class="cs-muted">Search a name, USDOT, or MC number.</p>
            </div>
          </aside>
          <article class="cs-dossier" aria-label="Carrier" data-detail>
            <div class="cs-empty"><p>Pick a match to open the snapshot.</p></div>
          </article>
        </div>
      </div>
      <footer class="cs-foot">
        <p class="live-status is-wait" data-status><i></i> Checking connection…</p>
      </footer>
    </section>
  `;

  const aboutSlot = /** @type {HTMLElement | null} */ (parent.querySelector("[data-about-slot]"));
  if (aboutSlot) {
    try {
      mountAboutSlide(aboutSlot, { title: meta.title });
    } catch (err) {
      ctx.log(`About control failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const root = /** @type {HTMLElement} */ (parent.querySelector("[data-cs]"));
  const form = /** @type {HTMLFormElement} */ (parent.querySelector("[data-form]"));
  const queryEl = /** @type {HTMLInputElement} */ (parent.querySelector("[data-query]"));
  const statusEl = /** @type {HTMLElement} */ (parent.querySelector("[data-status]"));
  const stageEl = /** @type {HTMLElement} */ (parent.querySelector("[data-stage]"));
  const countEl = /** @type {HTMLElement} */ (parent.querySelector("[data-count]"));
  const resultsEl = /** @type {HTMLElement} */ (parent.querySelector("[data-results]"));
  const detailEl = /** @type {HTMLElement} */ (parent.querySelector("[data-detail]"));
  const goBtn = /** @type {HTMLButtonElement} */ (parent.querySelector("[data-search]"));

  function mode() {
    const el = /** @type {HTMLInputElement | null} */ (parent.querySelector('input[name="cs-mode"]:checked'));
    return el?.value ?? "auto";
  }

  function setLive(kind, message) {
    const live = kind === "ok";
    statusEl.className = `live-status${live ? " is-on is-live" : kind === "wait" ? " is-wait" : " is-setup"}`;
    statusEl.innerHTML = `<i></i>${escapeHtml(message)}`;
  }

  function showStage() {
    root.classList.add("is-found");
    stageEl.hidden = false;
  }

  function emptyDossier(message) {
    detailEl.innerHTML = `<div class="cs-empty"><p>${escapeHtml(message)}</p></div>`;
  }

  async function ping() {
    try {
      const res = await fetch(`${PROXY}/api/fmcsa/status`);
      const data = await res.json();
      if (data.hasKey) {
        setLive("ok", "Connected");
        return;
      }
      setLive("setup", "The FMCSA web key is missing on the rack.");
    } catch {
      setLive("setup", "Could not reach the rack at 10.0.0.201:8090.");
    }
  }

  function renderResults(carriers, query) {
    countEl.textContent = carriers.length === 1 ? "1 match" : `${carriers.length} matches`;
    if (!carriers.length) {
      resultsEl.innerHTML = `<p class="cs-muted">No carriers named like “${escapeHtml(query)}”.</p>`;
      emptyDossier("Try another name, USDOT, or MC number.");
      return;
    }
    resultsEl.innerHTML = carriers
      .map((row) => {
        const title = row.dbaName && row.dbaName !== row.legalName ? row.dbaName : row.legalName;
        const loc = [row.city, row.state].filter(Boolean).join(", ") || "—";
        return `
          <button type="button" class="cs-hit" data-dot="${escapeHtml(row.dotNumber)}">
            <strong>${escapeHtml(dash(title))}</strong>
            <span>${escapeHtml(loc)}</span>
            <em>USDOT ${escapeHtml(dash(row.dotNumber))}</em>
          </button>`;
      })
      .join("");
  }

  function extraChips(payload, keys) {
    const items = [];
    for (const row of unwrapList(payload)) {
      if (!row || typeof row !== "object") continue;
      const label = labelize(
        row[keys.name] ||
          row.basicDesc ||
          row.basicsShortDesc ||
          row.cargoClassDesc ||
          row.docketNumber ||
          ""
      );
      if (!label) continue;
      const score = row[keys.score] ?? row.percentile;
      items.push({
        label,
        score: score == null || score === "" ? "" : String(score),
      });
    }
    return items;
  }

  function oosStats(payload) {
    for (const row of unwrapList(payload)) {
      if (!row || typeof row !== "object") continue;
      return [
        ["Vehicle", row.vehicleOosRate ?? row.vehicle_oos_rate],
        ["Driver", row.driverOosRate ?? row.driver_oos_rate],
        ["Hazmat", row.hazmatOosRate ?? row.hazmat_oos_rate],
      ].filter(([, value]) => value != null && value !== "");
    }
    return [];
  }

  function renderSnapshot(data) {
    const carrier = data.carrier || {};
    const extras = data.extras || {};
    const rating = String(carrier.safetyRating || "").trim();
    const kind = ratingKind(rating);
    const basics = extraChips(extras.basics, { name: "basicsShortDesc", score: "percentile" });
    const dockets = extraChips(extras.dockets, { name: "docketNumber" });
    const cargo = extraChips(extras.cargo, { name: "cargoClassDesc" });
    const oos = oosStats(extras.oos);
    const display = carrier.dbaName && carrier.dbaName !== carrier.legalName ? carrier.dbaName : carrier.legalName;

    detailEl.innerHTML = `
      <header class="cs-hero">
        <div>
          <p class="cs-kicker">USDOT ${escapeHtml(dash(carrier.dotNumber))}</p>
          <h2>${escapeHtml(dash(display))}</h2>
          <p class="cs-legal">${
            carrier.dbaName && carrier.dbaName !== carrier.legalName
              ? escapeHtml(carrier.legalName)
              : "Legal name on file"
          }</p>
          <p class="cs-where">${escapeHtml(address(carrier))}</p>
        </div>
        <span class="cs-badge is-${kind}">${escapeHtml(rating || "No rating")}</span>
      </header>

      <div class="cs-kpis">
        <div><strong>${escapeHtml(num(carrier.totalDrivers))}</strong><span>Drivers</span></div>
        <div><strong>${escapeHtml(num(carrier.totalPowerUnits))}</strong><span>Power units</span></div>
        <div><strong>${escapeHtml(dash(carrier.allowedToOperate))}</strong><span>May operate</span></div>
      </div>

      <div class="cs-auths">
        ${[
          ["Common", carrier.commonAuthority],
          ["Contract", carrier.contractAuthority],
          ["Broker", carrier.brokerAuthority],
        ]
          .map(
            ([label, value]) =>
              `<span class="cs-auth is-${authKind(value)}">${escapeHtml(label)} · ${escapeHtml(authLabel(value))}</span>`
          )
          .join("")}
      </div>

      <dl class="cs-facts">
        <div><dt>Phone</dt><dd>${escapeHtml(dash(carrier.phone))}</dd></div>
        <div><dt>BIPD</dt><dd>${escapeHtml(dash(carrier.bipdInsurance))}</dd></div>
        <div><dt>Cargo</dt><dd>${escapeHtml(dash(carrier.cargoInsurance))}</dd></div>
        <div><dt>Bond</dt><dd>${escapeHtml(dash(carrier.bondInsurance))}</dd></div>
      </dl>

      ${
        dockets.length
          ? `<section class="cs-block"><h3>MC / dockets</h3><div class="cs-chips">${dockets
              .map((item) => `<span>MC ${escapeHtml(item.label)}</span>`)
              .join("")}</div></section>`
          : ""
      }
      ${
        basics.length
          ? `<section class="cs-block"><h3>BASICs</h3><div class="cs-basics">${basics
              .map(
                (item) =>
                  `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.score || "—")}</strong></div>`
              )
              .join("")}</div></section>`
          : ""
      }
      ${
        oos.length
          ? `<section class="cs-block"><h3>Out of service</h3><div class="cs-kpis cs-kpis--slim">${oos
              .map(
                ([label, value]) =>
                  `<div><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`
              )
              .join("")}</div></section>`
          : ""
      }
      ${
        cargo.length
          ? `<section class="cs-block"><h3>Cargo</h3><div class="cs-chips">${cargo
              .map((item) => `<span>${escapeHtml(item.label)}</span>`)
              .join("")}</div></section>`
          : ""
      }
    `;
  }

  async function loadSnapshot(dot) {
    emptyDossier(`Loading USDOT ${dot}…`);
    try {
      const res = await fetch(`${PROXY}/api/fmcsa/carrier?dot=${encodeURIComponent(dot)}`);
      const data = await res.json();
      if (!data.ok) {
        emptyDossier(data.error || "Could not load that carrier.");
        return;
      }
      renderSnapshot(data);
      ctx.log(`FMCSA snapshot: USDOT ${dot}`);
    } catch {
      emptyDossier("Could not reach the rack at 10.0.0.201:8090.");
    }
  }

  parent.querySelector(".cs-modes")?.addEventListener("change", (event) => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.name !== "cs-mode") return;
    parent.querySelectorAll(".cs-modes label").forEach((label) => {
      label.classList.toggle("is-on", label.contains(input) && input.checked);
    });
  });

  resultsEl.addEventListener("click", (event) => {
    const btn = /** @type {HTMLElement} */ (event.target).closest("[data-dot]");
    if (!btn) return;
    resultsEl.querySelectorAll(".cs-hit").forEach((el) => el.classList.toggle("is-on", el === btn));
    void loadSnapshot(btn.getAttribute("data-dot") || "");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = queryEl.value.trim();
    if (!query) {
      queryEl.focus();
      return;
    }
    showStage();
    goBtn.disabled = true;
    countEl.textContent = "Searching…";
    resultsEl.innerHTML = `<p class="cs-muted">Asking FMCSA…</p>`;
    emptyDossier("Pick a match to open the snapshot.");
    try {
      const url = `${PROXY}/api/fmcsa/search?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode())}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.needKey) {
        setLive("setup", data.error);
        resultsEl.innerHTML = `<p class="cs-muted">${escapeHtml(data.error)}</p>`;
        return;
      }
      if (!data.ok && !data.carriers) {
        resultsEl.innerHTML = `<p class="cs-muted">${escapeHtml(data.error || "Search failed.")}</p>`;
        emptyDossier("Search failed.");
        return;
      }
      const carriers = Array.isArray(data.carriers) ? data.carriers : [];
      renderResults(carriers, query);
      ctx.log(`FMCSA search (${data.mode || mode()}): ${carriers.length} match(es) for ${query}`);
      if (carriers.length === 1 && carriers[0].dotNumber) {
        resultsEl.querySelector(".cs-hit")?.classList.add("is-on");
        void loadSnapshot(String(carriers[0].dotNumber));
      }
    } catch {
      setLive("setup", "Could not reach the rack at 10.0.0.201:8090.");
      resultsEl.innerHTML = `<p class="cs-muted">Could not reach the rack at 10.0.0.201:8090.</p>`;
    } finally {
      goBtn.disabled = false;
    }
  });

  void ping();
  requestAnimationFrame(() => queryEl.focus());
}
