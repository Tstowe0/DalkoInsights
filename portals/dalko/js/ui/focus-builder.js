/** @typedef {{ id: string, label: string, column: string, equipmentMode?: "ltl" | "truckload" }} FocusLayer */
/** @typedef {{ id: string, label: string, icon: string, layers: FocusLayer[] }} FocusCategory */

/** @type {FocusCategory[]} */
export const FOCUS_CATEGORIES = [
  {
    id: "customers",
    label: "Customers",
    icon: "ðŸ‘¥",
    layers: [{ id: "customer", label: "Customer", column: "CLIENT NAME" }],
  },
  {
    id: "carriers",
    label: "Carriers",
    icon: "ðŸšš",
    layers: [{ id: "carrier", label: "Carrier", column: "CARRIER NAME1" }],
  },
  {
    id: "salesReps",
    label: "Sales reps",
    icon: "ðŸ‘¤",
    layers: [{ id: "salesRep", label: "Sales rep", column: "SALES REP" }],
  },
  {
    id: "officeDivision",
    label: "Office / division",
    icon: "ðŸ¢",
    layers: [
      { id: "division", label: "Division", column: "DIVISION" },
      { id: "office", label: "Office", column: "OFFICE" },
    ],
  },
  {
    id: "ltl",
    label: "LTL",
    icon: "ðŸ“¦",
    layers: [{ id: "ltlEquip", label: "LTL equipment", column: "EQUIPMENT", equipmentMode: "ltl" }],
  },
  {
    id: "truckload",
    label: "Truckload",
    icon: "ðŸš›",
    layers: [{ id: "tlEquip", label: "Truckload equipment", column: "EQUIPMENT", equipmentMode: "truckload" }],
  },
  {
    id: "lanes",
    label: "Lanes",
    icon: "ðŸ›£ï¸",
    layers: [{ id: "lane", label: "Lane", column: "LANE" }],
  },
  {
    id: "accessorials",
    label: "Accessorials",
    icon: "ðŸ’°",
    layers: [
      { id: "accType", label: "Accessorial type", column: "ACCESSORIAL_TYPE" },
      { id: "accCustomer", label: "Customer", column: "CLIENT NAME" },
    ],
  },
  {
    id: "geographic",
    label: "States",
    icon: "ðŸŒŽ",
    layers: [
      { id: "originState", label: "Origin states", column: "ORIGIN STATE" },
      { id: "destState", label: "Destination states", column: "DESTINATION STATE" },
    ],
  },
  {
    id: "cities",
    label: "Cities",
    icon: "ðŸ™ï¸",
    layers: [
      { id: "originCity", label: "Origin cities", column: "ORIGIN CITY" },
      { id: "destCity", label: "Destination cities", column: "DESTINATION CITY" },
    ],
  },
];

/** @param {string} column */
export function focusFieldIcon(column) {
  const col = String(column);
  for (const cat of FOCUS_CATEGORIES) {
    if (cat.layers.some((layer) => layer.column === col)) return cat.icon;
  }
  return "";
}

const VALUE_RENDER_CAP = 800;

/** @type {Set<string>} */
const openBranches = new Set();
/** @type {Map<string, string[]>} */
const valueCache = new Map();
let treeQuery = "";

/**
 * Permissions-style tree. Categories and layers expand. Value checkboxes are the focuses.
 * @param {{
 *   existingFocuses?: { column: string, value: string }[],
 *   listValues: (layer: FocusLayer) => string[],
 *   onApply: (items: { column: string, value: string }[]) => void | Promise<void>,
 *   onRemove?: (column: string, value: string) => void,
 *   onRemoveMany?: (items: { column: string, value: string }[]) => void,
 * }} opts
 */
export function renderFocusBuilder(opts) {
  /** @type {{ column: string, value: string }[]} */
  let selected = (opts.existingFocuses ?? []).map((item) => ({ column: item.column, value: item.value }));
  /** @type {WeakMap<HTMLInputElement, FocusLayer[]>} */
  const branchBoxes = new WeakMap();
  const root = document.createElement("div");
  root.className = "focus-tree-root";
  let loadSeq = 0;

  /** @param {string} column @param {string} value */
  const alreadyOn = (column, value) => selected.some((f) => f.column === column && f.value === value);

  /** @param {{ column: string, value: string }[]} items */
  function remember(items) {
    for (const item of items) {
      if (!alreadyOn(item.column, item.value)) selected.push({ column: item.column, value: item.value });
    }
  }

  /** @param {{ column: string, value: string }[]} items */
  function forget(items) {
    const drop = new Set(items.map((item) => `${item.column}\0${item.value}`));
    selected = selected.filter((item) => !drop.has(`${item.column}\0${item.value}`));
  }

  /** @param {FocusLayer} layer */
  function countLayer(layer) {
    const cached = valueCache.get(layer.id);
    return selected.filter(
      (item) => item.column === layer.column && (!cached || cached.includes(item.value))
    ).length;
  }

  function syncChecks() {
    root.querySelectorAll("input.focus-branch-check").forEach((node) => {
      if (!(node instanceof HTMLInputElement)) return;
      const layers = branchBoxes.get(node);
      if (!layers) return;
      const on = branchComplete(layers);
      if (node.checked !== on) node.checked = on;
    });
    root.querySelectorAll("input.focus-value-check").forEach((node) => {
      if (!(node instanceof HTMLInputElement)) return;
      const on = alreadyOn(node.dataset.column || "", node.dataset.value || "");
      if (node.checked !== on) node.checked = on;
    });
    root.querySelectorAll(".focus-branch-row").forEach((row) => {
      const box = row.querySelector("input.focus-branch-check");
      const layers = box instanceof HTMLInputElement ? branchBoxes.get(box) : undefined;
      if (!layers) return;
      const count = layers.reduce((sum, layer) => sum + countLayer(layer), 0);
      row.classList.toggle("is-picked", count > 0);
      let badge = row.querySelector(".focus-count");
      if (!count) {
        badge?.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement("em");
        badge.className = "focus-count";
        row.appendChild(badge);
      }
      if (badge.textContent !== String(count)) badge.textContent = String(count);
    });
  }

  function paint() {
    const q = treeQuery.trim().toLowerCase();
    root.innerHTML = "";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "focus-tree-search";
    search.placeholder = "Search focuses";
    search.value = treeQuery;
    search.autocomplete = "off";
    search.addEventListener("input", () => {
      treeQuery = search.value;
      paint();
      const next = root.querySelector(".focus-tree-search");
      if (next instanceof HTMLInputElement) {
        next.focus();
        const end = next.value.length;
        next.setSelectionRange(end, end);
      }
    });
    root.appendChild(search);

    const scroll = document.createElement("div");
    scroll.className = "focus-tree-scroll perm-tree-wrap";
    const tree = document.createElement("ul");
    tree.className = "perm-tree focus-tree";

    let any = false;
    for (const cat of FOCUS_CATEGORIES) {
      const layers = cat.layers.filter((layer) => branchMatches(cat, layer, q));
      if (!layers.length) continue;
      any = true;
      tree.appendChild(renderCategory(cat, layers, q));
    }
    if (!any) {
      const empty = document.createElement("p");
      empty.className = "focus-tree-empty";
      empty.textContent = q ? "Nothing matches that search." : "No focus categories.";
      scroll.appendChild(empty);
    } else {
      scroll.appendChild(tree);
    }
    root.appendChild(scroll);
  }

  /**
   * @param {FocusCategory} cat
   * @param {FocusLayer} layer
   * @param {string} q
   */
  function branchMatches(cat, layer, q) {
    if (!q) return true;
    if (cat.label.toLowerCase().includes(q) || layer.label.toLowerCase().includes(q)) return true;
    const cached = valueCache.get(layer.id) ?? [];
    if (cached.some((value) => value.toLowerCase().includes(q))) return true;
    return selected.some(
      (item) =>
        item.column === layer.column &&
        (!valueCache.has(layer.id) || cached.includes(item.value)) &&
        (`${layer.label} ${item.value}`.toLowerCase().includes(q))
    );
  }

  /**
   * @param {FocusCategory} cat
   * @param {FocusLayer[]} layers
   * @param {string} q
   */
  function renderCategory(cat, layers, q) {
    if (cat.layers.length === 1) return renderLayer(cat, layers[0], q, cat.label);
    const id = cat.id;
    const open = openBranches.has(id) || Boolean(q);
    const li = document.createElement("li");
    li.className = `focus-branch${open ? " is-open" : ""}`;
    const count = layers.reduce((sum, layer) => sum + countLayer(layer), 0);
    li.appendChild(
      branchRow(cat.label, open, count, () => {
        if (openBranches.has(id)) openBranches.delete(id);
        else openBranches.add(id);
        paint();
      }, layers)
    );
    if (open) {
      const ul = document.createElement("ul");
      for (const layer of layers) ul.appendChild(renderLayer(cat, layer, q));
      li.appendChild(ul);
    }
    return li;
  }

  /**
   * @param {FocusCategory} cat
   * @param {FocusLayer} layer
   * @param {string} q
   */
  function renderLayer(cat, layer, q, label = layer.label) {
    const id = `${cat.id}/${layer.id}`;
    const open = openBranches.has(id) || (Boolean(q) && valueCache.has(layer.id));
    const li = document.createElement("li");
    li.className = `focus-branch${open ? " is-open" : ""}`;
    li.appendChild(
      branchRow(label, open, countLayer(layer), () => {
        if (openBranches.has(id)) {
          openBranches.delete(id);
          paint();
          return;
        }
        openBranches.add(id);
        ensureValues(layer);
      }, [layer])
    );
    if (open) li.appendChild(renderValues(layer, q));
    return li;
  }

  /**
   * @param {string} label
   * @param {boolean} open
   * @param {number} count
   * @param {() => void} onToggle
   * @param {FocusLayer[]} layers
   */
  function branchRow(label, open, count, onToggle, layers) {
    const row = document.createElement("div");
    row.className = "perm-node focus-branch-row";
    const twist = document.createElement("button");
    twist.type = "button";
    twist.className = "focus-twist";
    twist.setAttribute("aria-expanded", open ? "true" : "false");
    twist.setAttribute("aria-label", open ? `Collapse ${label}` : `Expand ${label}`);
    twist.addEventListener("click", onToggle);
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "focus-branch-check";
    const knownEmpty = layers.every(
      (layer) => valueCache.has(layer.id) && (valueCache.get(layer.id) ?? []).length === 0
    );
    box.checked = branchComplete(layers);
    box.disabled = knownEmpty;
    branchBoxes.set(box, layers);
    box.setAttribute("aria-label", `Focus every ${label} value`);
    box.addEventListener("click", (event) => event.stopPropagation());
    box.addEventListener("change", () => {
      if (box.checked) {
        void applyLayers(layers);
        return;
      }
      clearLayers(layers);
    });
    const name = document.createElement("span");
    name.className = "focus-branch-name";
    name.textContent = label;
    name.addEventListener("click", onToggle);
    row.append(twist, box, name);
    if (count) row.classList.add("is-picked");
    if (count) {
      const badge = document.createElement("em");
      badge.className = "focus-count";
      badge.textContent = String(count);
      row.appendChild(badge);
    }
    return row;
  }

  /** @param {FocusLayer[]} layers */
  function branchComplete(layers) {
    if (!layers.length) return false;
    for (const layer of layers) {
      const values = valueCache.get(layer.id);
      if (!values?.length) return false;
      for (const value of values) {
        if (!alreadyOn(layer.column, value)) return false;
      }
    }
    return true;
  }

  /** @param {FocusLayer} layer */
  function valuesFor(layer) {
    if (valueCache.has(layer.id)) return valueCache.get(layer.id) ?? [];
    let values = [];
    try {
      values = opts.listValues(layer) ?? [];
    } catch {
      values = [];
    }
    valueCache.set(layer.id, values);
    return values;
  }

  /** @param {FocusLayer[]} layers */
  function applyLayers(layers) {
    /** @type {{ column: string, value: string }[]} */
    const missing = [];
    for (const layer of layers) {
      for (const value of valuesFor(layer)) {
        if (!alreadyOn(layer.column, value)) missing.push({ column: layer.column, value });
      }
    }
    if (!missing.length) return undefined;
    remember(missing);
    syncChecks();
    return Promise.resolve(opts.onApply(missing)).then((ok) => {
      if (ok === false) {
        forget(missing);
        syncChecks();
      }
    });
  }

  /** @param {FocusLayer[]} layers */
  function clearLayers(layers) {
    /** @type {{ column: string, value: string }[]} */
    const present = [];
    for (const layer of layers) {
      for (const value of valuesFor(layer)) {
        if (alreadyOn(layer.column, value)) present.push({ column: layer.column, value });
      }
    }
    if (!present.length) return;
    forget(present);
    syncChecks();
    if (opts.onRemoveMany) {
      opts.onRemoveMany(present);
      return;
    }
    for (const item of present) opts.onRemove?.(item.column, item.value);
  }

  /** @param {FocusLayer} layer */
  function ensureValues(layer) {
    if (valueCache.has(layer.id)) {
      paint();
      return;
    }
    const seq = ++loadSeq;
    paint();
    requestAnimationFrame(() => {
      if (seq !== loadSeq) return;
      let values = [];
      try {
        values = opts.listValues(layer) ?? [];
      } catch {
        values = [];
      }
      if (seq !== loadSeq) return;
      valueCache.set(layer.id, values);
      paint();
    });
  }

  /**
   * @param {FocusLayer} layer
   * @param {string} q
   */
  function renderValues(layer, q) {
    const ul = document.createElement("ul");
    if (!valueCache.has(layer.id)) {
      const li = document.createElement("li");
      li.className = "focus-tree-note";
      li.textContent = "Loading values...";
      ul.appendChild(li);
      return ul;
    }
    const values = valueCache.get(layer.id) ?? [];
    const shown = (q && !layer.label.toLowerCase().includes(q) ? values.filter((value) => value.toLowerCase().includes(q)) : values).slice(0, VALUE_RENDER_CAP);
    if (!shown.length) {
      const li = document.createElement("li");
      li.className = "focus-tree-note";
      li.textContent = values.length ? "Nothing matches that search." : "No values in this dump.";
      ul.appendChild(li);
      return ul;
    }
    for (const value of shown) {
      const li = document.createElement("li");
      const label = document.createElement("label");
      label.className = "perm-node";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "focus-value-check";
      box.dataset.column = layer.column;
      box.dataset.value = value;
      box.checked = alreadyOn(layer.column, value);
      box.addEventListener("change", () => {
        const item = { column: layer.column, value };
        if (box.checked) {
          remember([item]);
          syncChecks();
          void Promise.resolve(opts.onApply([item])).then((ok) => {
            if (ok === false) {
              forget([item]);
              syncChecks();
            }
          });
          return;
        }
        forget([item]);
        syncChecks();
        opts.onRemove?.(layer.column, value);
      });
      const text = document.createElement("span");
      text.textContent = value;
      label.append(box, text);
      li.appendChild(label);
      ul.appendChild(li);
    }
    if (values.length > VALUE_RENDER_CAP && !q) {
      const more = document.createElement("li");
      more.className = "focus-tree-note";
      more.textContent = `Showing ${VALUE_RENDER_CAP.toLocaleString()} of ${values.length.toLocaleString()}. Search to narrow the list.`;
      ul.appendChild(more);
    }
    return ul;
  }

  paint();
  return root;
}
