/** @typedef {{ id: string, label: string, column: string, equipmentMode?: "ltl" | "truckload" }} FocusLayer */
/** @typedef {{ id: string, label: string, icon: string, layers: FocusLayer[] }} FocusCategory */

/** @type {FocusCategory[]} */
export const FOCUS_CATEGORIES = [
  {
    id: "customers",
    label: "Customers",
    icon: "👥",
    layers: [{ id: "customer", label: "Customer", column: "CLIENT NAME" }],
  },
  {
    id: "carriers",
    label: "Carriers",
    icon: "🚚",
    layers: [{ id: "carrier", label: "Carrier", column: "CARRIER NAME1" }],
  },
  {
    id: "salesReps",
    label: "Sales reps",
    icon: "👤",
    layers: [{ id: "salesRep", label: "Sales rep", column: "SALES REP" }],
  },
  {
    id: "officeDivision",
    label: "Office / division",
    icon: "🏢",
    layers: [
      { id: "division", label: "Division", column: "DIVISION" },
      { id: "office", label: "Office", column: "OFFICE" },
    ],
  },
  {
    id: "ltl",
    label: "LTL",
    icon: "📦",
    layers: [{ id: "ltlEquip", label: "LTL equipment", column: "EQUIPMENT", equipmentMode: "ltl" }],
  },
  {
    id: "truckload",
    label: "Truckload",
    icon: "🚛",
    layers: [{ id: "tlEquip", label: "Truckload equipment", column: "EQUIPMENT", equipmentMode: "truckload" }],
  },
  {
    id: "lanes",
    label: "Lanes",
    icon: "🛣️",
    layers: [{ id: "lane", label: "Lane", column: "LANE" }],
  },
  {
    id: "accessorials",
    label: "Accessorials",
    icon: "💰",
    layers: [
      { id: "accType", label: "Accessorial type", column: "ACCESSORIAL_TYPE" },
      { id: "accCustomer", label: "Customer", column: "CLIENT NAME" },
    ],
  },
  {
    id: "geographic",
    label: "States",
    icon: "🌎",
    layers: [
      { id: "originState", label: "Origin states", column: "ORIGIN STATE" },
      { id: "destState", label: "Destination states", column: "DESTINATION STATE" },
    ],
  },
  {
    id: "cities",
    label: "Cities",
    icon: "🏙️",
    layers: [
      { id: "originCity", label: "Origin cities", column: "ORIGIN CITY" },
      { id: "destCity", label: "Destination cities", column: "DESTINATION CITY" },
    ],
  },
];

const VALUE_RENDER_CAP = 800;

/**
 * @param {{
 *   existingFocuses?: { column: string, value: string }[],
 *   listValues: (layer: FocusLayer) => string[],
 *   onApply: (items: { column: string, value: string }[]) => void,
 * }} opts
 */
export function renderFocusBuilder(opts) {
  const existing = opts.existingFocuses ?? [];
  const root = document.createElement("div");
  root.className = "focus-builder";

  /** @type {"parent" | "layer" | "values"} */
  let step = "parent";
  /** @type {FocusCategory | null} */
  let parent = null;
  /** @type {FocusLayer | null} */
  let layer = null;
  /** @type {string[]} */
  let values = [];
  /** @type {Set<string>} */
  let selected = new Set();
  let query = "";
  let loadingValues = false;
  let loadSeq = 0;

  /** @param {string} column @param {string} value */
  const alreadyOn = (column, value) => existing.some((f) => f.column === column && f.value === value);

  function resetToParent() {
    loadSeq += 1;
    step = "parent";
    parent = null;
    layer = null;
    values = [];
    selected = new Set();
    query = "";
    loadingValues = false;
  }

  function paint() {
    root.innerHTML = "";
    root.append(renderStepper(), renderBody());
  }

  function renderStepper() {
    const rail = document.createElement("ol");
    rail.className = "focus-builder-steps";
    rail.setAttribute("aria-label", "Focus builder");
    const items = [
      { id: "parent", label: "Add Focus", done: true, current: false },
      {
        id: "category",
        label: "Select Parent Category",
        done: step === "layer" || step === "values",
        current: step === "parent",
      },
      {
        id: "layer",
        label: "Select Child Layer",
        done: step === "values",
        current: step === "layer" || step === "values",
      },
    ];
    for (const item of items) {
      const li = document.createElement("li");
      li.className = `focus-builder-step${item.current ? " is-current" : ""}${item.done ? " is-done" : ""}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "focus-builder-step-btn";
      btn.textContent = item.label;
      const canJump =
        item.id === "parent" ||
        item.id === "category" ||
        (item.id === "layer" && (step === "layer" || step === "values") && parent);
      btn.disabled = !canJump;
      btn.addEventListener("click", () => {
        if (item.id === "parent" || item.id === "category") {
          resetToParent();
        } else if (item.id === "layer" && parent) {
          loadSeq += 1;
          step = "layer";
          layer = null;
          values = [];
          selected = new Set();
          query = "";
          loadingValues = false;
        }
        paint();
      });
      li.appendChild(btn);
      rail.appendChild(li);
    }
    return rail;
  }

  function renderBody() {
    const body = document.createElement("div");
    body.className = "focus-builder-body";

    if (step === "parent") {
      const title = document.createElement("h4");
      title.className = "focus-builder-heading";
      title.textContent = "Select parent category";
      body.append(
        title,
        renderChoiceGrid(
          FOCUS_CATEGORIES.map((cat) => ({
            icon: cat.icon,
            label: cat.label,
            meta: cat.layers.length === 1 ? cat.layers[0].label : `${cat.layers.length} layers`,
            onClick: () => {
              parent = cat;
              step = "layer";
              paint();
            },
          }))
        )
      );
      return body;
    }

    if (step === "layer" && parent) {
      const title = document.createElement("h4");
      title.className = "focus-builder-heading";
      title.textContent = `Select child layer · ${parent.label}`;
      body.append(
        title,
        renderChoiceGrid(
          parent.layers.map((item) => ({
            icon: parent.icon,
            label: item.label,
            onClick: () => openLayer(item),
          }))
        )
      );
      return body;
    }

    if (step === "values" && parent && layer) {
      body.append(renderValuesStep());
    }

    return body;
  }

  /** @param {FocusLayer} item */
  function openLayer(item) {
    const seq = ++loadSeq;
    layer = item;
    query = "";
    values = [];
    selected = new Set();
    loadingValues = true;
    step = "values";
    paint();
    requestAnimationFrame(() => {
      if (seq !== loadSeq) return;
      try {
        values = opts.listValues(item) ?? [];
      } catch {
        values = [];
      }
      if (seq !== loadSeq) return;
      selected = new Set(values.filter((v) => alreadyOn(item.column, v)));
      loadingValues = false;
      paint();
    });
  }

  function renderValuesStep() {
    const wrap = document.createElement("div");
    wrap.className = "focus-builder-values-wrap";

    const title = document.createElement("h4");
    title.className = "focus-builder-heading";
    title.textContent = `${parent?.label} · ${layer?.label}`;
    wrap.appendChild(title);

    if (loadingValues) {
      const wait = document.createElement("p");
      wait.className = "focus-builder-hint";
      wait.textContent = "Loading values…";
      wrap.appendChild(wait);
      return wrap;
    }

    if (!values.length) {
      const empty = document.createElement("p");
      empty.className = "focus-builder-hint";
      empty.textContent = "No values in this dump for that layer.";
      wrap.appendChild(empty);
      wrap.appendChild(renderValueActions());
      return wrap;
    }

    const search = document.createElement("input");
    search.type = "search";
    search.className = "focus-builder-search";
    search.placeholder = `Search ${values.length.toLocaleString()} values…`;
    search.value = query;
    search.autocomplete = "off";
    wrap.appendChild(search);

    const list = document.createElement("div");
    list.className = "focus-builder-values";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", layer?.label ?? "Values");
    wrap.appendChild(list);

    const meta = document.createElement("p");
    meta.className = "focus-builder-meta";
    wrap.appendChild(meta);
    wrap.appendChild(renderValueActions());

    const fillList = () => {
      const column = layer?.column ?? "";
      const q = query.trim().toLowerCase();
      const filtered = q ? values.filter((v) => v.toLowerCase().includes(q)) : values;
      const shown = filtered.slice(0, VALUE_RENDER_CAP);
      list.innerHTML = "";
      for (const value of shown) {
        const locked = alreadyOn(column, value);
        const row = document.createElement("label");
        row.className = `focus-builder-value${locked ? " is-locked" : ""}`;
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = selected.has(value);
        box.disabled = locked;
        box.addEventListener("change", () => {
          if (box.checked) selected.add(value);
          else selected.delete(value);
          syncApplyButton(wrap);
        });
        const text = document.createElement("span");
        text.textContent = value;
        row.append(box, text);
        if (locked) {
          const badge = document.createElement("em");
          badge.textContent = "Active";
          row.appendChild(badge);
        }
        list.appendChild(row);
      }
      if (filtered.length > shown.length) {
        meta.textContent = `Showing ${shown.length.toLocaleString()} of ${filtered.length.toLocaleString()} matches. Refine the search to narrow the list.`;
      } else if (q) {
        meta.textContent = `${filtered.length.toLocaleString()} match${filtered.length === 1 ? "" : "es"}`;
      } else {
        meta.textContent = `${values.length.toLocaleString()} value${values.length === 1 ? "" : "s"}`;
      }
    };

    search.addEventListener("input", () => {
      query = search.value;
      fillList();
    });
    fillList();
    return wrap;
  }

  function newCount() {
    if (!layer) return 0;
    let n = 0;
    for (const value of selected) {
      if (!alreadyOn(layer.column, value)) n += 1;
    }
    return n;
  }

  /** @param {HTMLElement} wrap */
  function syncApplyButton(wrap) {
    const apply = wrap.querySelector(".focus-builder-apply");
    if (!(apply instanceof HTMLButtonElement)) return;
    const fresh = newCount();
    apply.disabled = fresh < 1;
    apply.textContent = fresh ? `Apply ${fresh} focus${fresh === 1 ? "" : "es"}` : "Apply focuses";
  }

  function renderValueActions() {
    const actions = document.createElement("div");
    actions.className = "focus-builder-actions";

    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "btn btn-primary focus-builder-apply";
    const fresh = newCount();
    apply.textContent = fresh ? `Apply ${fresh} focus${fresh === 1 ? "" : "es"}` : "Apply focuses";
    apply.disabled = fresh < 1;
    apply.addEventListener("click", () => {
      if (!layer) return;
      const items = [...selected]
        .filter((value) => !alreadyOn(layer.column, value))
        .map((value) => ({ column: layer.column, value }));
      if (!items.length) return;
      opts.onApply(items);
    });

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-ghost";
    cancel.textContent = "Start over";
    cancel.addEventListener("click", () => {
      resetToParent();
      paint();
    });

    actions.append(apply, cancel);
    return actions;
  }

  /**
   * @param {{ icon: string, label: string, meta?: string, onClick: () => void }[]} choices
   */
  function renderChoiceGrid(choices) {
    const grid = document.createElement("div");
    grid.className = "focus-builder-grid";
    for (const choice of choices) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "focus-builder-choice";
      const icon = document.createElement("span");
      icon.className = "focus-builder-choice-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = choice.icon;
      const copy = document.createElement("span");
      copy.className = "focus-builder-choice-copy";
      const label = document.createElement("span");
      label.className = "focus-builder-choice-label";
      label.textContent = choice.label;
      copy.appendChild(label);
      if (choice.meta) {
        const meta = document.createElement("span");
        meta.className = "focus-builder-choice-meta";
        meta.textContent = choice.meta;
        copy.appendChild(meta);
      }
      btn.append(icon, copy);
      btn.addEventListener("click", choice.onClick);
      grid.appendChild(btn);
    }
    return grid;
  }

  paint();
  return root;
}
