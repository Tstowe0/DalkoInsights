/**
 * Theme registry + apply/persist.
 * Add themes in shared/css/theme.css, then list them here.
 */

/** @typedef {{ id: string, name: string, description: string, swatches: string[], group?: "day" | "night" | "seasonal" }} ThemeInfo */

const LIVE_STORAGE_KEY = "dalko-insights-theme";
const SHELL_STORAGE_KEY = "dalko-shell-theme";

/** @type {ThemeInfo[]} */
export const THEMES = [
  {
    id: "harbor",
    name: "Harbor",
    group: "day",
    description: "Light canvas, navy sidebar, blue signals — the merged dashboard default.",
    swatches: ["#10182a", "#f4f6fb", "#2e90fa", "#53b1fd"],
  },
  {
    id: "daybreak",
    name: "Daybreak",
    group: "day",
    description: "Warm daylight canvas and a cream sidebar, with sunrise orange signals.",
    swatches: ["#ffe7c2", "#fff8ee", "#c2410c", "#f5b942"],
  },
  {
    id: "midnight-gold",
    name: "Midnight Gold",
    group: "night",
    description: "Navy shell with warm gold accents — classic Dalko Insights look.",
    swatches: ["#030508", "#0c1322", "#d9ae42", "#f0c14a"],
  },
  {
    id: "ocean-steel",
    name: "Ocean Steel",
    group: "night",
    description: "Cool steel blues for a calmer ops console feel.",
    swatches: ["#041018", "#0b1c28", "#5eb8d2", "#8fd4e8"],
  },
  {
    id: "night-void",
    name: "Night Void",
    group: "night",
    description: "True black night mode with silver accents for low-light focus.",
    swatches: ["#000000", "#121212", "#c8c8c8", "#f0f0f0"],
  },
  {
    id: "forest-pine",
    name: "Forest Pine",
    group: "night",
    description: "Deep woodland greens with mint highlights.",
    swatches: ["#06140c", "#0d2418", "#4caf7a", "#8fd4a8"],
  },
  {
    id: "ember-forge",
    name: "Ember Forge",
    group: "night",
    description: "Charcoal workshop tones with copper ember accents.",
    swatches: ["#120a06", "#241610", "#e08a45", "#f0b078"],
  },
  {
    id: "graphite-lime",
    name: "Graphite Lime",
    group: "night",
    description: "Industrial graphite with sharp lime signals.",
    swatches: ["#0b0d0a", "#171a14", "#a8d84a", "#c8f06a"],
  },
  {
    id: "slate-coral",
    name: "Slate Coral",
    group: "night",
    description: "Cool slate surfaces with soft coral accents.",
    swatches: ["#0c1014", "#171e26", "#e8897a", "#f0b0a4"],
  },
  {
    id: "hallowed-night",
    name: "Hallowed Night",
    group: "seasonal",
    description: "Graveyard black, jack-o’-lantern orange, and witch-purple — seasonal spooky mode.",
    swatches: ["#09060e", "#1a1024", "#ff7a18", "#b57bff"],
  },
  {
    id: "yule-night",
    name: "Yule Night",
    group: "seasonal",
    description: "Deep pine, holly red, and candle gold — a dark Christmas console.",
    swatches: ["#050e0a", "#122018", "#e23d3d", "#e8c56a"],
  },
];

export const DEFAULT_THEME = "midnight-gold";
export const SHELL_DEFAULT_THEME = "harbor";

function isMergedShell() {
  return document.documentElement.dataset.shell === "merged";
}

function storageKey() {
  return isMergedShell() ? SHELL_STORAGE_KEY : LIVE_STORAGE_KEY;
}

function fallbackTheme() {
  return isMergedShell() ? SHELL_DEFAULT_THEME : DEFAULT_THEME;
}

/** @returns {string} */
export function getThemeId() {
  try {
    const stored = localStorage.getItem(storageKey());
    if (stored && THEMES.some((t) => t.id === stored)) return stored;
  } catch {
    /* ignore */
  }
  return fallbackTheme();
}

/**
 * @param {string} id
 */
export function setTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === fallbackTheme()) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.group === "day" ? "light" : "dark";
  try {
    localStorage.setItem(storageKey(), theme.id);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("dalko-theme", { detail: { id: theme.id } }));
  syncHalloweenGhosts(theme.id);
  return theme.id;
}

/** Apply stored (or default) theme on boot. */
export function initTheme() {
  return setTheme(getThemeId());
}

const HALLOWEEN_THEME = "hallowed-night";
const GHOST_SVG = `<svg viewBox="0 0 40 48" aria-hidden="true">
  <path fill="currentColor" d="M20 3.5C11.4 3.5 4.5 10.6 4.5 20.2V41c0 1.9 2.2 2.2 3.2.6 1.3-2.1 3.4-2.1 4.8 0 1.3 2.1 3.4 2.1 4.8 0 1.3-2.1 3.4-2.1 4.8 0 1.3 2.1 3.4 2.1 4.8 0 1-1.6 3.2-1.3 3.2-.6V20.2C35.5 10.6 28.6 3.5 20 3.5Z"/>
  <g class="hallow-ghost-eye"><circle cx="14.2" cy="20" r="2.15" fill="#1a1024"/></g>
  <g class="hallow-ghost-eye"><circle cx="24.6" cy="20" r="2.15" fill="#1a1024"/></g>
  <ellipse cx="19.4" cy="27.2" rx="2.6" ry="1.5" fill="#1a1024" opacity=".32"/>
</svg>`;

/** @type {number} */
let ghostTimer = 0;
/** @type {number} */
let lookTimer = 0;
/** @type {HTMLElement | null} */
let ghostEl = null;
let ghostWatching = false;
let glanceCool = false;
/** @type {{ x: number, y: number } | null} */
let ghostPointer = null;

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function restLook(wrap) {
  wrap.style.setProperty("--look-x", "0px");
  wrap.style.setProperty("--look-y", "0px");
}

function lookToward(wrap, x, y) {
  const box = wrap.getBoundingClientRect();
  const dx = x - (box.left + box.width * 0.5);
  const dy = y - (box.top + box.height * 0.4);
  const dist = Math.hypot(dx, dy) || 1;
  wrap.style.setProperty("--look-x", `${((dx / dist) * 2.8).toFixed(2)}px`);
  wrap.style.setProperty("--look-y", `${((dy / dist) * 2).toFixed(2)}px`);
}

function stopGhostLook() {
  ghostWatching = false;
  glanceCool = false;
  ghostPointer = null;
  if (lookTimer) {
    window.clearTimeout(lookTimer);
    lookTimer = 0;
  }
  if (ghostEl) restLook(ghostEl);
  window.removeEventListener("pointermove", onGhostPointer);
}

function endGlance(wrap) {
  ghostWatching = false;
  glanceCool = true;
  restLook(wrap);
  lookTimer = window.setTimeout(() => {
    glanceCool = false;
    if (wrap.isConnected && !wrap.classList.contains("is-pop")) scheduleGlance(wrap);
  }, 1400 + Math.random() * 1800);
}

function beginGlance(wrap) {
  if (ghostWatching || glanceCool || !wrap.isConnected || wrap.classList.contains("is-pop")) return;
  window.clearTimeout(lookTimer);
  ghostWatching = true;
  if (ghostPointer) lookToward(wrap, ghostPointer.x, ghostPointer.y);
  lookTimer = window.setTimeout(() => {
    if (wrap.isConnected) endGlance(wrap);
  }, 1100 + Math.random() * 1500);
}

function scheduleGlance(wrap) {
  lookTimer = window.setTimeout(() => beginGlance(wrap), 2400 + Math.random() * 4600);
}

function onGhostPointer(event) {
  ghostPointer = { x: event.clientX, y: event.clientY };
  const wrap = ghostEl;
  if (!wrap || wrap.classList.contains("is-pop")) return;
  if (ghostWatching) {
    lookToward(wrap, event.clientX, event.clientY);
    return;
  }
  if (glanceCool) return;
  const box = wrap.getBoundingClientRect();
  const near = Math.hypot(
    event.clientX - (box.left + box.width * 0.5),
    event.clientY - (box.top + box.height * 0.4)
  );
  if (near < 130) beginGlance(wrap);
}

function startGhostLook(wrap) {
  window.addEventListener("pointermove", onGhostPointer, { passive: true });
  scheduleGlance(wrap);
}

function clearHalloweenGhosts() {
  stopGhostLook();
  if (ghostTimer) {
    window.clearTimeout(ghostTimer);
    ghostTimer = 0;
  }
  ghostEl?.remove();
  ghostEl = null;
}

/** @param {boolean} soon */
function scheduleHalloweenGhost(soon) {
  if (prefersReducedMotion()) return;
  const wait = soon ? 2800 + Math.random() * 5000 : 18000 + Math.random() * 36000;
  ghostTimer = window.setTimeout(spawnHalloweenGhost, wait);
}

function tombAnchor() {
  const stones = document.querySelectorAll(".hallow-tombs .hallow-tomb");
  if (!stones.length) return null;
  const stone = stones[Math.floor(Math.random() * stones.length)];
  const r = stone.getBoundingClientRect();
  return {
    x: r.left + r.width / 2,
    y: r.top,
  };
}

function finishGhost(wrap) {
  stopGhostLook();
  wrap.remove();
  if (ghostEl === wrap) ghostEl = null;
  if (document.documentElement.dataset.theme === HALLOWEEN_THEME) {
    scheduleHalloweenGhost(false);
  }
}

/** @param {HTMLElement} wrap */
function popGhost(wrap) {
  if (wrap.classList.contains("is-pop")) return;
  stopGhostLook();
  const cs = getComputedStyle(wrap);
  wrap.style.setProperty("--pop-from", cs.transform === "none" ? "translate(0, 0)" : cs.transform);
  wrap.classList.add("is-pop");
  wrap.setAttribute("aria-hidden", "true");
  wrap.removeAttribute("tabindex");
  for (let i = 0; i < 6; i += 1) {
    const speck = document.createElement("span");
    speck.className = "hallow-pop-speck";
    speck.style.setProperty("--a", `${i * 60}deg`);
    wrap.appendChild(speck);
  }
}

const GHOST_W = 21;
const GHOST_H = 25;

function yardBounds() {
  const yard = document.querySelector(".hallow-tombs");
  const side = document.querySelector(".sidebar");
  if (!yard || !side) return null;
  const stones = yard.getBoundingClientRect();
  const bar = side.getBoundingClientRect();
  const minX = bar.left + 8;
  const maxX = Math.max(minX, bar.right - GHOST_W - 8);
  const maxY = stones.top - GHOST_H + 9;
  const minY = maxY - 22;
  return { minX, maxX, minY, maxY };
}

function clampYard(point, yard) {
  return {
    x: Math.min(yard.maxX, Math.max(yard.minX, point.x)),
    y: Math.min(yard.maxY, Math.max(yard.minY, point.y)),
  };
}

/** Gentle curve through the yard so each turn eases instead of snapping. */
function driftPath(stops) {
  const samples = [];
  const legs = stops.length - 1;
  const steps = 6;
  for (let i = 0; i < legs; i += 1) {
    const p0 = stops[Math.max(0, i - 1)];
    const p1 = stops[i];
    const p2 = stops[i + 1];
    const p3 = stops[Math.min(stops.length - 1, i + 2)];
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      samples.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  samples.push(stops[stops.length - 1]);
  return samples;
}

/** @param {HTMLElement} wrap */
function roamGhost(wrap) {
  const yard = yardBounds();
  if (!yard) return null;
  const gx = Number.parseFloat(wrap.style.getPropertyValue("--gx")) || yard.minX;
  const gy = Number.parseFloat(wrap.style.getPropertyValue("--gy")) || yard.maxY;
  const spot = () => ({
    x: yard.minX + Math.random() * (yard.maxX - yard.minX),
    y: yard.minY + Math.random() * (yard.maxY - yard.minY),
  });
  const home = clampYard({ x: gx, y: gy - 4 }, yard);
  const stops = [home, spot(), spot(), spot(), home];
  const samples = driftPath(stops).map((point) => clampYard(point, yard));
  samples[0] = home;
  samples[samples.length - 1] = home;
  const frames = samples.map((point, index) => {
    const dx = Math.round((point.x - gx) * 10) / 10;
    const dy = Math.round((point.y - gy) * 10) / 10;
    return {
      offset: index / (samples.length - 1),
      opacity: 0.92,
      transform: `translate(${dx}px, ${dy}px) scale(0.94)`,
    };
  });
  const emerge = wrap.animate(
    [
      { opacity: 0, transform: "translate(0px, 8px) scale(0.16)" },
      { opacity: 0.92, transform: `translate(${home.x - gx}px, ${home.y - gy}px) scale(0.94)` },
    ],
    { duration: 1600, easing: "cubic-bezier(0.22, 0.8, 0.3, 1)", fill: "forwards" }
  );
  emerge.onfinish = () => {
    if (!wrap.isConnected || wrap.classList.contains("is-pop")) return;
    wrap.animate(frames, {
      duration: 32000 + Math.random() * 8000,
      easing: "linear",
      iterations: Infinity,
    });
  };
  wrap.dataset.roam = "1";
  return emerge;
}

function spawnHalloweenGhost() {
  ghostTimer = 0;
  if (document.documentElement.dataset.theme !== HALLOWEEN_THEME || prefersReducedMotion()) {
    return;
  }
  const tomb = tombAnchor();
  if (!tomb) {
    scheduleHalloweenGhost(false);
    return;
  }
  stopGhostLook();
  ghostEl?.remove();

  const wrap = document.createElement("button");
  wrap.type = "button";
  wrap.className = "hallow-ghost";
  wrap.setAttribute("aria-label", "Pop ghost");
  wrap.title = "Pop";
  wrap.style.setProperty("--gx", `${Math.round(tomb.x - GHOST_W / 2)}px`);
  wrap.style.setProperty("--gy", `${Math.round(tomb.y - GHOST_H + 6)}px`);
  wrap.innerHTML = `<span class="hallow-ghost-bob">${GHOST_SVG}</span>`;
  wrap.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    wrap.getAnimations().forEach((anim) => {
      if (anim.effect?.target === wrap) anim.cancel();
    });
    popGhost(wrap);
  });
  wrap.addEventListener("animationend", (event) => {
    if (event.animationName === "hallow-ghost-pop") finishGhost(wrap);
  });
  ghostEl = wrap;
  document.body.appendChild(wrap);
  roamGhost(wrap);
  startGhostLook(wrap);
}

/** @param {string} themeId */
function syncHalloweenGhosts(themeId) {
  clearHalloweenGhosts();
  if (themeId === HALLOWEEN_THEME) scheduleHalloweenGhost(true);
}
