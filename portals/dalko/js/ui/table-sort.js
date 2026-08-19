/** @param {string | undefined} format */
function formatToSortType(format) {
  if (!format || format === "text") return "text";
  if (
    format === "money" ||
    format === "money2" ||
    format === "pct" ||
    format === "int" ||
    format === "weight" ||
    format === "zscore"
  ) {
    return "number";
  }
  return "text";
}

/** @param {HTMLTableCellElement} th */
function inferSortTypeFromHeader(th) {
  if (th.classList.contains("num") || th.classList.contains("col-center")) return "number";
  return "text";
}

/**
 * @param {HTMLTableCellElement} td
 * @param {string} sortType
 */
function cellSortKey(td, sortType) {
  const raw = td.dataset.sortValue ?? td.textContent?.trim() ?? "";
  if (sortType === "number") {
    if (raw === "" || raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return String(raw).toLowerCase();
}

/**
 * @param {HTMLTableElement} table
 * @param {number} colIndex
 * @param {string} sortType
 * @param {"asc" | "desc"} dir
 */
function sortTableByColumn(table, colIndex, sortType, dir) {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const mult = dir === "asc" ? 1 : -1;
  const rows = [...tbody.rows];
  rows.sort((rowA, rowB) => {
    const a = cellSortKey(rowA.cells[colIndex], sortType);
    const b = cellSortKey(rowB.cells[colIndex], sortType);
    if (sortType === "number") {
      const na = /** @type {number | null} */ (a);
      const nb = /** @type {number | null} */ (b);
      // Missing / insufficient values always stay at the bottom
      if (na == null && nb == null) return 0;
      if (na == null) return 1;
      if (nb == null) return -1;
      return (na - nb) * mult;
    }
    return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true }) * mult;
  });
  for (const row of rows) tbody.appendChild(row);
}

/**
 * @param {HTMLTableElement} table
 * @param {{ columnFormats?: (string | undefined)[] }} [options]
 */
export function attachTableSort(table, options = {}) {
  const headerRow = table.tHead?.rows[0];
  if (!headerRow) return;

  const ths = [...headerRow.cells];
  ths.forEach((th, colIndex) => {
    const sortType = formatToSortType(options.columnFormats?.[colIndex]) || inferSortTypeFromHeader(th);
    th.classList.add("sortable");
    th.dataset.sortType = sortType;
    th.setAttribute("role", "columnheader");
    th.setAttribute("aria-sort", "none");
    th.tabIndex = 0;

    const activate = () => {
      const nextDir = th.dataset.sortDir === "asc" ? "desc" : "asc";
      for (const other of ths) {
        delete other.dataset.sortDir;
        other.setAttribute("aria-sort", "none");
      }
      th.dataset.sortDir = nextDir;
      th.setAttribute("aria-sort", nextDir === "asc" ? "ascending" : "descending");
      sortTableByColumn(table, colIndex, sortType, nextDir);
    };

    th.addEventListener("click", activate);
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });
  });
}

/** @param {HTMLTableCellElement} td @param {unknown} value */
export function setSortValue(td, value) {
  if (value == null || value === "") {
    td.dataset.sortValue = "";
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    td.dataset.sortValue = String(value);
    return;
  }
  td.dataset.sortValue = String(value);
}
