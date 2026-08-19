/**
 * Theme registry + apply/persist.
 * Add themes in shared/css/theme.css, then list them here.
 */

/** @typedef {{ id: string, name: string, description: string, swatches: string[] }} ThemeInfo */

/** @type {ThemeInfo[]} */
export const THEMES = [
  {
    id: "midnight-gold",
    name: "Midnight Gold",
    description: "Navy shell with warm gold accents — default Dalko Insights look.",
    swatches: ["#030508", "#0c1322", "#d9ae42", "#f0c14a"],
  },
  {
    id: "ocean-steel",
    name: "Ocean Steel",
    description: "Cool steel blues for a calmer ops console feel.",
    swatches: ["#041018", "#0b1c28", "#5eb8d2", "#8fd4e8"],
  },
  {
    id: "night-void",
    name: "Night Void",
    description: "True black night mode with silver accents for low-light focus.",
    swatches: ["#000000", "#121212", "#c8c8c8", "#f0f0f0"],
  },
  {
    id: "forest-pine",
    name: "Forest Pine",
    description: "Deep woodland greens with mint highlights.",
    swatches: ["#06140c", "#0d2418", "#4caf7a", "#8fd4a8"],
  },
  {
    id: "ember-forge",
    name: "Ember Forge",
    description: "Charcoal workshop tones with copper ember accents.",
    swatches: ["#120a06", "#241610", "#e08a45", "#f0b078"],
  },
  {
    id: "graphite-lime",
    name: "Graphite Lime",
    description: "Industrial graphite with sharp lime signals.",
    swatches: ["#0b0d0a", "#171a14", "#a8d84a", "#c8f06a"],
  },
  {
    id: "slate-coral",
    name: "Slate Coral",
    description: "Cool slate surfaces with soft coral accents.",
    swatches: ["#0c1014", "#171e26", "#e8897a", "#f0b0a4"],
  },
];

export const DEFAULT_THEME = "midnight-gold";
const STORAGE_KEY = "dalko-insights-theme";

/** @returns {string} */
export function getThemeId() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.some((t) => t.id === stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME;
}

/**
 * @param {string} id
 */
export function setTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    /* ignore */
  }
  return theme.id;
}

/** Apply stored (or default) theme on boot. */
export function initTheme() {
  return setTheme(getThemeId());
}
