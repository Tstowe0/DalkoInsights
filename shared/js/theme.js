/**
 * Theme registry + apply/persist.
 * Add styles in shared/css/themes, then list the theme here.
 */

/** @typedef {{ id: string, name: string, description: string, swatches: string[], group: "day" | "night" | "dynamic" | "seasonal" }} ThemeInfo */

import { syncHalloweenGhosts } from "./themes/hallowed-night.js?v=20261121-seasonal";
import { syncOceanicNight } from "./themes/oceanic-night.js";
import { syncYuleSleigh } from "./themes/yule-night.js?v=20261120-hourly-sleigh";

const LIVE_STORAGE_KEY = "dalko-insights-theme";
const SHELL_STORAGE_KEY = "dalko-shell-theme";
const THEME_ALIASES = new Map([
  ["gta-6", "oceanic-night"],
  ["hallowed-night-v2", "hallowed-night"],
  ["yule-night-v2", "yule-night"],
  ["rainy-yard", "rainy-drive"],
]);

export const THEME_GROUPS = [
  { id: "day", label: "Light Static (Tradition)" },
  { id: "night", label: "Dark Static (Tradition)" },
  { id: "dynamic", label: "Dynamic (Slight Animation)" },
  { id: "seasonal", label: "Holiday (Slight Animation)" },
];

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
    id: "sandy-shore",
    name: "Sandy Shore",
    group: "day",
    description: "Sand canvas, lagoon sidebar, and coral-and-seafoam signals — a bright beach day.",
    swatches: ["#08343a", "#fff4e6", "#0c6b70", "#e07a4c"],
  },
  {
    id: "slate-linen",
    name: "Slate & Linen",
    group: "day",
    description: "Slate-blue navigation, a warm linen canvas, and soft blush accents.",
    swatches: ["#2e4357", "#f7e8da", "#dbb4ad", "#bd9478"],
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
    id: "signal-green",
    name: "Signal Green",
    group: "night",
    description: "Black canvas and white type, with green signals. Cancel and no stay red.",
    swatches: ["#000000", "#141414", "#22c55e", "#ffffff"],
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
    id: "oceanic-night",
    name: "Oceanic Night",
    group: "dynamic",
    description: "Hot pink and neon cyan on a purple shore after dark.",
    swatches: ["#07040e", "#170c24", "#ff2d8a", "#2ee6ff"],
  },
  {
    id: "rainy-drive",
    name: "Rainy Drive",
    group: "dynamic",
    description: "An endless rain-slick highway under a synthwave sunset, with pink and cyan reflected in the pavement.",
    swatches: ["#100d1a", "#221a31", "#ff99ca", "#7be5ef"],
  },
  {
    id: "hallowed-night",
    name: "Hallowed Night",
    group: "seasonal",
    description: "A harvest moon over a hillside manor, with amber windows and deep plum panels.",
    swatches: ["#0e0b17", "#21182d", "#ffa453", "#cbb5ed"],
  },
  {
    id: "yule-night",
    name: "Yule Night",
    group: "seasonal",
    description: "A snowbound village under a teal winter sky, with candlelit windows and cranberry accents.",
    swatches: ["#0a151e", "#183137", "#ff9eaa", "#ffdc99"],
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
    const saved = localStorage.getItem(storageKey());
    const stored = THEME_ALIASES.get(saved) ?? saved;
    if (stored !== saved) localStorage.setItem(storageKey(), stored);
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
  id = THEME_ALIASES.get(id) ?? id;
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
  syncOceanicNight(theme.id);
  syncYuleSleigh(theme.id);
  return theme.id;
}

/** Apply stored (or default) theme on boot. */
export function initTheme() {
  return setTheme(getThemeId());
}
