/**
 * Local weather for the home page.
 * The browser location is the computer. If that is declined, zip 16150 is used.
 * A timeout or a missing location still uses the network location.
 * Open-Meteo needs no key.
 */

const HOME_ZIP = "16150";

const EMPTY = { status: "loading", place: "", temp: "", summary: "", days: [] };

/** @type {typeof EMPTY} */
let view = { ...EMPTY };
let started = false;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** @param {number} code */
function sky(code) {
  if (code === 0) return { kind: "clear", label: "Clear" };
  if (code === 1) return { kind: "clear", label: "Mainly clear" };
  if (code === 2) return { kind: "partly", label: "Partly cloudy" };
  if (code === 3) return { kind: "cloud", label: "Cloudy" };
  if (code === 45 || code === 48) return { kind: "fog", label: "Fog" };
  if (code === 56 || code === 57 || code === 66 || code === 67) return { kind: "rain", label: "Freezing rain" };
  if (code >= 51 && code <= 55) return { kind: "rain", label: "Drizzle" };
  if (code >= 80 && code <= 82) return { kind: "rain", label: "Showers" };
  if (code >= 61 && code <= 65) return { kind: "rain", label: "Rain" };
  if (code === 85 || code === 86) return { kind: "snow", label: "Snow showers" };
  if (code >= 71 && code <= 77) return { kind: "snow", label: "Snow" };
  if (code >= 95) return { kind: "storm", label: "Thunderstorm" };
  return { kind: "cloud", label: "Cloudy" };
}

/** @param {string} kind */
function icon(kind) {
  const common = `viewBox="0 0 24 24" fill="none" aria-hidden="true"`;
  if (kind === "clear") {
    return `<svg ${common}><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  }
  if (kind === "partly") {
    return `<svg ${common}><path d="M12.2 4.2v1.6M16.8 6.2l-1.1 1.1M8.5 6.2l1.1 1.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="9" r="2.3" stroke="currentColor" stroke-width="1.7"/><path d="M8.2 16.2h8.4a3.1 3.1 0 0 0 .4-6.2 4.2 4.2 0 0 0-8-1 3.1 3.1 0 0 0-.8 7.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
  }
  if (kind === "fog") {
    return `<svg ${common}><path d="M5 9.5h14M4 13h16M6 16.5h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  }
  if (kind === "rain") {
    return `<svg ${common}><path d="M7.5 15.5h8.2a3.2 3.2 0 0 0 .5-6.3 4.3 4.3 0 0 0-8.2-1 3.2 3.2 0 0 0-.5 7.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 18.2v1.6M12 18.2v1.6M15 18.2v1.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  }
  if (kind === "snow") {
    return `<svg ${common}><path d="M7.5 14.2h8.2a3.2 3.2 0 0 0 .5-6.3 4.3 4.3 0 0 0-8.2-1 3.2 3.2 0 0 0-.5 7.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 17.4v2.2M12 17.4v2.2M15 17.4v2.2M7.8 18.6h2.4M10.8 18.6h2.4M13.8 18.6h2.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  }
  if (kind === "storm") {
    return `<svg ${common}><path d="M7.5 14.2h8.2a3.2 3.2 0 0 0 .5-6.3 4.3 4.3 0 0 0-8.2-1 3.2 3.2 0 0 0-.5 7.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12.2 14.6 10.4 18h2.2l-1.2 3.2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  return `<svg ${common}><path d="M7 16.5h10a3.6 3.6 0 0 0 .6-7.1A4.8 4.8 0 0 0 8.2 8a3.6 3.6 0 0 0-1.2 8.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
}

/** @param {string} iso */
function weekday(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { weekday: "short" });
}

function degrees(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}°`;
}

/**
 * @param {number} lat
 * @param {number} lon
 */
async function forecast(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "4");
  const res = await fetch(url);
  if (!res.ok) throw new Error("forecast");
  const data = await res.json();
  const now = sky(Number(data.current?.weather_code));
  const daily = data.daily || {};
  const days = [];
  const dates = Array.isArray(daily.time) ? daily.time : [];
  for (let i = 1; i < dates.length && days.length < 3; i += 1) {
    const daySky = sky(Number(daily.weather_code?.[i]));
    days.push({
      name: weekday(dates[i]),
      kind: daySky.kind,
      summary: daySky.label,
      high: degrees(daily.temperature_2m_max?.[i]),
      low: degrees(daily.temperature_2m_min?.[i]),
    });
  }
  return {
    status: "ready",
    temp: degrees(data.current?.temperature_2m),
    summary: now.label,
    kind: now.kind,
    days,
  };
}

/**
 * @param {number} lat
 * @param {number} lon
 */
async function placeName(lat, lon) {
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("localityLanguage", "en");
  const res = await fetch(url);
  if (!res.ok) return "";
  const data = await res.json();
  const city = String(data.city || data.locality || "").trim();
  const code = String(data.principalSubdivisionCode || "").split("-").pop() || "";
  const region = /^[A-Z]{2}$/.test(code) ? code : String(data.principalSubdivision || "").trim();
  return [city, region].filter(Boolean).join(", ");
}

function deviceLocation() {
  if (!navigator.geolocation) return Promise.reject(new Error("unavailable"));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), 8000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, place: "" });
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 30 * 60 * 1000 }
    );
  });
}

async function zipLocation(zip) {
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (!res.ok) throw new Error("zip");
  const data = await res.json();
  const place = data.places?.[0];
  const lat = Number(place?.latitude);
  const lon = Number(place?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("zip");
  const city = String(place["place name"] || "").trim();
  const state = String(place["state abbreviation"] || "").trim();
  return { lat, lon, place: [city, state].filter(Boolean).join(", ") || zip };
}

async function networkLocation() {
  const res = await fetch("https://get.geojs.io/v1/ip/geo.json");
  if (!res.ok) throw new Error("network");
  const data = await res.json();
  const lat = Number(data.latitude);
  const lon = Number(data.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("network");
  const place = [data.city, data.region].filter(Boolean).join(", ");
  return { lat, lon, place };
}

async function locate() {
  try {
    const here = await deviceLocation();
    const place = await placeName(here.lat, here.lon).catch(() => "");
    return { ...here, place };
  } catch (err) {
    if (Number(err?.code) === 1) return zipLocation(HOME_ZIP);
    return networkLocation();
  }
}

async function resolveWeather() {
  const here = await locate();
  const report = await forecast(here.lat, here.lon);
  return { ...report, place: here.place || "Local" };
}

export function weatherCardHtml() {
  if (view.status === "loading") {
    return `<section class="card weather-card" aria-live="polite" aria-label="Local weather"><div class="card-head"><h2>Local Weather</h2></div><p class="weather-status">Checking this computer's location…</p></section>`;
  }
  if (view.status !== "ready") {
    return `<section class="card weather-card" aria-live="polite" aria-label="Local weather"><div class="card-head"><h2>Local Weather</h2></div><p class="weather-status">Local weather is unavailable.</p></section>`;
  }
  const days = view.days
    .map(
      (day) => `
        <li>
          <span class="weather-day-name">${esc(day.name)}</span>
          <span class="weather-ico" data-sky="${esc(day.kind)}" role="img" aria-label="${esc(day.summary)}">${icon(day.kind)}</span>
          <strong aria-label="High ${esc(day.high)}, low ${esc(day.low)}">${esc(day.high)} <span>${esc(day.low)}</span></strong>
        </li>`
    )
    .join("");
  return `
    <section class="card weather-card" data-sky="${esc(view.kind)}" aria-live="polite" aria-label="Local weather">
      <span class="weather-art" aria-hidden="true"></span>
      <div class="card-head">
        <div>
          <h2>Local Weather</h2>
          <p class="card-sub">${esc(view.place || "This computer")}</p>
        </div>
      </div>
      <div class="weather-now">
        <div class="weather-reading">
          <p class="weather-temp">${esc(view.temp)}${view.temp !== "—" ? "<span>F</span>" : ""}</p>
          <p class="weather-summary">${esc(view.summary)}</p>
        </div>
      </div>
      ${days ? `<ol class="weather-days" aria-label="Upcoming forecast">${days}</ol>` : ""}
    </section>`;
}

/** @param {() => void} onReady */
export function loadLocalWeather(onReady) {
  if (started) return;
  started = true;
  void resolveWeather()
    .then((next) => {
      view = next;
    })
    .catch(() => {
      view = { status: "error", place: "", temp: "", summary: "", days: [] };
    })
    .finally(() => onReady());
}
