import { mountToolShell } from "../_shared/tool-shell.js";

export const meta = {
  id: "Zip Calculator",
  title: "Zip Calculator",
  category: "Data Tools",
  script: "Data Tools/Zip Calculator.js",
};

const CACHE_URL = new URL("../../data/zip_mileage_cache.json", import.meta.url).href;
const LOCAL_CACHE_KEY = "glassbox.zipMileageCache.v1";
const R_MILES = 3958.8;

/**
 * Match Python get_zip_key: sorted "{zip.zfill(5)}_{country}" pairs joined by "_".
 * @param {string} zip1
 * @param {string} zip2
 * @param {string} c1
 * @param {string} c2
 */
function getZipKey(zip1, zip2, c1, c2) {
  const parts = [
    `${normalizeZipToken(zip1)}_${c1}`,
    `${normalizeZipToken(zip2)}_${c2}`,
  ].sort();
  return parts.join("_");
}

/** @param {string} zip */
function normalizeZipToken(zip) {
  const z = String(zip ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (/[A-Z]/.test(z)) return z;
  // Python uses str(zip).zfill(5) for numeric codes
  return z.padStart(5, "0");
}

/** @param {string} code */
function detectCountry(code) {
  const compact = code.trim().toUpperCase().replace(/\s+/g, "");
  if (/[A-Z]/.test(compact)) return "ca";
  const numeric = Number.parseInt(compact, 10);
  if (!Number.isFinite(numeric)) return "us";
  // Mirror Python's MX heuristic for numeric ranges that aren't typical US ZIPs
  if (numeric >= 1000 && numeric < 99999 && !(numeric >= 501 && numeric <= 99950)) {
    return "mx";
  }
  return "us";
}

/**
 * @param {string} postal
 * @param {string} overrideCountry
 */
function resolveCountry(postal, overrideCountry) {
  return overrideCountry === "auto" ? detectCountry(postal) : overrideCountry;
}

/**
 * Format postal for geocoders (CA FSA spacing when needed).
 * @param {string} postal
 * @param {string} country
 */
function formatPostal(postal, country) {
  let code = postal.trim().toUpperCase().replace(/\s+/g, "");
  if (country === "ca" && code.length === 6) {
    code = `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  if (country === "us" || country === "mx") {
    code = code.padStart(5, "0");
  }
  return code;
}

/**
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 */
function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(a));
}

/**
 * @param {string} zip1
 * @param {string} zip2
 * @param {string} c1
 * @param {string} c2
 * @param {Record<string, any>} cache
 */
function cacheLookup(zip1, zip2, c1, c2, cache) {
  const primary = getZipKey(zip1, zip2, c1, c2);
  const legacy = [normalizeZipToken(zip1), normalizeZipToken(zip2)].sort().join("_");
  const detected = getZipKey(
    zip1,
    zip2,
    resolveCountry(zip1, c1),
    resolveCountry(zip2, c2)
  );

  for (const key of [primary, detected, legacy]) {
    if (cache[key]) {
      return { key, entry: { ...cache[key] } };
    }
  }
  return null;
}

/**
 * Match Python: if stored zip1/country1 don't match request order, swap ends.
 * @param {Record<string, any>} result
 * @param {string} zip1
 * @param {string} c1
 */
function orientResult(result, zip1, c1) {
  const want = `${normalizeZipToken(zip1)}_${c1}`;
  const have = `${normalizeZipToken(result.zip1)}_${result.country1 ?? c1}`;
  if (want === have) return result;
  const swapped = { ...result };
  for (const [a, b] of [
    ["city1", "city2"],
    ["state1", "state2"],
    ["zip1", "zip2"],
    ["country1", "country2"],
  ]) {
    const tmp = swapped[a];
    swapped[a] = swapped[b];
    swapped[b] = tmp;
  }
  return swapped;
}

/**
 * Geocode via Zippopotam (US / CA / MX).
 * @param {string} postal
 * @param {string} overrideCountry
 */
async function geocode(postal, overrideCountry) {
  const country = resolveCountry(postal, overrideCountry);
  const formatted = formatPostal(postal, country);
  const query =
    country === "ca" ? formatted.replace(/\s+/g, "").slice(0, 3) : formatted.replace(/\s+/g, "");

  const url = `https://api.zippopotam.us/${country}/${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not look up ${postal} (${country.toUpperCase()}).`);
  }
  const data = await res.json();
  const place = data.places?.[0];
  if (!place) throw new Error(`No location found for ${postal}.`);

  const lat = Number(place.latitude);
  const lon = Number(place.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`Invalid coordinates for ${postal}.`);
  }

  return {
    lat,
    lon,
    city: place["place name"] || "",
    state: place["state abbreviation"] || place.state || place["state name"] || country.toUpperCase(),
    country,
    zip: country === "ca" ? formatted.replace(/\s+/g, "") : formatted.replace(/\s+/g, "").padStart(5, "0"),
  };
}

/**
 * Driving miles via public OSRM (browser-safe stand-in for Google Distance Matrix).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 */
async function truckMilesOsrm(lat1, lon1, lat2, lon2) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${lon1},${lat1};${lon2},${lat2}?overview=false`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const meters = data?.routes?.[0]?.distance;
  if (!Number.isFinite(meters)) return null;
  return meters * 0.000621371;
}

/** @returns {Record<string, any>} */
function loadLocalCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, any>} cache */
function saveLocalCache(cache) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

/**
 * @param {HTMLElement} parent
 * @param {{ onBack: () => void, log: (msg: string) => void }} ctx
 */
export async function loadGui(parent, ctx) {
  const shell = mountToolShell(parent, {
    title: meta.title,
    category: meta.category,
    instructions: `1. Enter two postal codes (US, Canada, or Mexico) to calculate straight-line and truck mileage.
2. Results are displayed below, and cached for faster lookups.
3. Use country overrides if automatic detection is incorrect. If a Zip Code is shared between countries this forces which country to use.`,
    onBack: ctx.onBack,
    log: ctx.log,
  });

  shell.body.innerHTML = `
    <div class="gb-zip-panel">
      <div class="gb-zip-block">
        <p class="gb-zip-block-title">Origin Postal Code</p>
        <label class="gb-zip-field">Postal Code 1
          <input data-z1 placeholder="16150" autocomplete="off" />
        </label>
        <fieldset class="gb-zip-countries">
          <legend>Origin Country</legend>
          <label><input type="radio" name="c1" value="auto" checked tabindex="-1" /> Auto</label>
          <label><input type="radio" name="c1" value="us" tabindex="-1" /> US</label>
          <label><input type="radio" name="c1" value="ca" tabindex="-1" /> CA</label>
          <label><input type="radio" name="c1" value="mx" tabindex="-1" /> MX</label>
        </fieldset>
      </div>

      <div class="gb-zip-block">
        <p class="gb-zip-block-title">Destination Postal Code</p>
        <label class="gb-zip-field">Postal Code 2
          <input data-z2 placeholder="60606" autocomplete="off" />
        </label>
        <fieldset class="gb-zip-countries">
          <legend>Destination Country</legend>
          <label><input type="radio" name="c2" value="auto" checked tabindex="-1" /> Auto</label>
          <label><input type="radio" name="c2" value="us" tabindex="-1" /> US</label>
          <label><input type="radio" name="c2" value="ca" tabindex="-1" /> CA</label>
          <label><input type="radio" name="c2" value="mx" tabindex="-1" /> MX</label>
        </fieldset>
      </div>

      <div class="gb-zip-actions">
        <button type="button" class="btn btn-primary" data-calc>Calculate</button>
        <button type="button" class="btn btn-ghost" data-clear>Clear</button>
      </div>

      <pre class="gb-zip-result" data-result>Enter postal codes and click Calculate.</pre>
    </div>
  `;

  /** @type {Record<string, any>} */
  let cache = { ...loadLocalCache() };
  try {
    const res = await fetch(CACHE_URL);
    if (res.ok) {
      const bundled = await res.json();
      cache = { ...bundled, ...cache };
      ctx.log(`Mileage cache loaded (${Object.keys(cache).length} entries).`);
    }
  } catch {
    ctx.log("Bundled mileage cache not found — will geocode when needed.");
  }

  const z1Input = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-z1]"));
  const z2Input = /** @type {HTMLInputElement} */ (shell.body.querySelector("[data-z2]"));
  const resultEl = /** @type {HTMLElement} */ (shell.body.querySelector("[data-result]"));
  const calcBtn = /** @type {HTMLButtonElement} */ (shell.body.querySelector("[data-calc]"));
  const clearBtn = /** @type {HTMLButtonElement} */ (shell.body.querySelector("[data-clear]"));

  // Country radios are clickable but skipped in Tab order: Postal 1 → Postal 2 → Calculate.
  // Enter/Space on Calculate uses native button activation (fires click).
  requestAnimationFrame(() => z1Input.focus());

  /** @param {string} name */
  function selectedCountry(name) {
    const el = /** @type {HTMLInputElement | null} */ (
      shell.body.querySelector(`input[name="${name}"]:checked`)
    );
    return el?.value ?? "auto";
  }

  clearBtn?.addEventListener("click", () => {
    z1Input.value = "";
    z2Input.value = "";
    for (const name of ["c1", "c2"]) {
      const auto = /** @type {HTMLInputElement | null} */ (
        shell.body.querySelector(`input[name="${name}"][value="auto"]`)
      );
      if (auto) auto.checked = true;
    }
    resultEl.textContent = "Fields cleared. Enter postal codes and click Calculate again.";
    shell.setStatus("Ready");
    ctx.log("Fields cleared.");
    z1Input.focus();
  });

  calcBtn?.addEventListener("click", async () => {
    const z1 = z1Input.value.trim();
    const z2 = z2Input.value.trim();
    const c1 = selectedCountry("c1");
    const c2 = selectedCountry("c2");

    if (!z1 || !z2) {
      resultEl.textContent = "Please enter both postal codes before calculating.";
      ctx.log("Both postal codes are required.");
      return;
    }

    calcBtn.disabled = true;
    clearBtn.disabled = true;
    shell.setStatus("Calculating…");
    ctx.log(`Starting distance lookup: ${z1} (${c1}) → ${z2} (${c2})`);

    try {
      const hit = cacheLookup(z1, z2, c1, c2, cache);
      if (hit) {
        const distances = orientResult(hit.entry, z1, c1);
        const straight = Number(distances.straight_distance);
        const truck = distances.truck_distance == null ? null : Number(distances.truck_distance);
        resultEl.textContent = [
          `Straight Distance: ${straight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} miles`,
          `Truck Distance: ${
            truck == null
              ? "Unavailable"
              : `${truck.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} miles`
          }`,
          `Source: Cache`,
          "",
          `Origin: ${distances.city1 || ""}, ${distances.state1 || ""} (${distances.zip1})`,
          `Destination: ${distances.city2 || ""}, ${distances.state2 || ""} (${distances.zip2})`,
        ].join("\n");
        shell.setStatus("Complete");
        ctx.log(
          `Cache hit — straight ${straight.toFixed(2)} mi | truck ${truck == null ? "n/a" : truck.toFixed(2)} mi`
        );
        return;
      }

      const g1 = await geocode(z1, c1);
      const g2 = await geocode(z2, c2);
      const straight = haversineMiles(g1.lat, g1.lon, g2.lat, g2.lon);
      let truck = null;
      try {
        truck = await truckMilesOsrm(g1.lat, g1.lon, g2.lat, g2.lon);
      } catch {
        truck = null;
      }

      const entry = {
        zip1: g1.zip,
        zip2: g2.zip,
        country1: c1,
        country2: c2,
        straight_distance: straight,
        truck_distance: truck,
        city1: g1.city,
        state1: g1.state,
        city2: g2.city,
        state2: g2.state,
      };

      const key = getZipKey(z1, z2, c1, c2);
      cache[key] = entry;
      const local = loadLocalCache();
      local[key] = entry;
      saveLocalCache(local);

      resultEl.textContent = [
        `Straight Distance: ${straight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} miles`,
        `Truck Distance: ${
          truck == null
            ? "Unavailable"
            : `${truck.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} miles`
        }`,
        `Source: Live lookup`,
        "",
        `Origin: ${g1.city}, ${g1.state} (${g1.zip})`,
        `Destination: ${g2.city}, ${g2.state} (${g2.zip})`,
      ].join("\n");
      shell.setStatus("Complete");
      ctx.log(
        `Live — straight ${straight.toFixed(2)} mi | truck ${truck == null ? "n/a" : truck.toFixed(2)} mi`
      );
    } catch (err) {
      shell.setStatus("Error");
      const msg = err instanceof Error ? err.message : String(err);
      resultEl.textContent = `Lookup failed — ${msg}`;
      ctx.log(msg);
    } finally {
      calcBtn.disabled = false;
      clearBtn.disabled = false;
    }
  });
}
