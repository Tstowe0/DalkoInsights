/** @type {{ id: string, label: string, icon: string }[]} */
export const NAV_ITEMS = [
  { id: "filters", label: "Filters", icon: "🔍" },
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "customers", label: "Customers", icon: "👥" },
  { id: "carriers", label: "Carriers", icon: "🚚" },
  { id: "salesReps", label: "Sales reps", icon: "👤" },
  { id: "officeDivision", label: "Office / division", icon: "🏢" },
  { id: "ltl", label: "LTL", icon: "📦" },
  { id: "truckload", label: "Truckload", icon: "🚛" },
  { id: "lanes", label: "Lanes", icon: "🛣️" },
  { id: "accessorials", label: "Accessorials", icon: "💰" },
  { id: "geographic", label: "Geographic", icon: "🌎" },
  { id: "financial", label: "Financial", icon: "💵" },
  { id: "changelog", label: "Change log", icon: "📋" },
  { id: "reports", label: "Reports", icon: "📄" },
];

/** @param {string} id */
export function navTitle(id) {
  const item = NAV_ITEMS.find((n) => n.id === id);
  return item ? item.label : "Dashboard";
}

/**
 * @param {HTMLElement} container
 * @param {string} activeId
 * @param {(id: string) => void} onSelect
 */
export function renderNav(container, activeId, onSelect) {
  container.innerHTML = "";
  for (const item of NAV_ITEMS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `nav-btn${item.id === activeId ? " active" : ""}`;
    btn.innerHTML = `<span class="nav-icon" aria-hidden="true">${item.icon}</span><span class="nav-label">${item.label}</span>`;
    btn.addEventListener("click", () => onSelect(item.id));
    container.appendChild(btn);
  }
}
