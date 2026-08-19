/**
 * Compact month calendar for the Glass Box right rail.
 * Click a day to preview reports due that date in the To Do list.
 */

import { getDueDaySetForMonth, toDateKey } from "./report-schedule.js?v=20260804-calclick";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * @param {HTMLElement} host
 * @param {{ signal?: AbortSignal }} [opts]
 */
export function mountSidebarCalendar(host, opts = {}) {
  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth(); // 0-based
  /** Selected date key (drives To Do). */
  let selectedKey = toDateKey(now);
  /** Last known real calendar day (for midnight rollover). */
  let realDayKey = selectedKey;

  host.innerHTML = `
    <div class="gb-cal" aria-label="Calendar">
      <header class="gb-cal-bar">
        <button type="button" class="gb-cal-nav" data-cal-prev aria-label="Previous month">‹</button>
        <span class="gb-cal-title" data-cal-title></span>
        <button type="button" class="gb-cal-nav" data-cal-next aria-label="Next month">›</button>
      </header>
      <div class="gb-cal-weekdays" data-cal-weekdays></div>
      <div class="gb-cal-grid" data-cal-grid role="grid"></div>
    </div>
  `;

  const titleEl = /** @type {HTMLElement} */ (host.querySelector("[data-cal-title]"));
  const weekdaysEl = /** @type {HTMLElement} */ (host.querySelector("[data-cal-weekdays]"));
  const gridEl = /** @type {HTMLElement} */ (host.querySelector("[data-cal-grid]"));

  weekdaysEl.innerHTML = WEEKDAYS.map((d) => `<span>${d}</span>`).join("");

  /** @param {string} key */
  function emitSelection(key) {
    window.dispatchEvent(
      new CustomEvent("glassbox:date-selected", {
        detail: { day: key, date: parseDateKey(key) },
      })
    );
  }

  /** @param {string} key */
  function selectDay(key) {
    if (selectedKey === key) {
      paint();
      emitSelection(key);
      return;
    }
    selectedKey = key;
    paint();
    emitSelection(key);
  }

  const paint = () => {
    titleEl.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
    const first = new Date(viewYear, viewMonth, 1);
    const startPad = first.getDay(); // Sun=0
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const today = new Date();
    const isThisMonth =
      today.getFullYear() === viewYear && today.getMonth() === viewMonth;
    const dueDays = getDueDaySetForMonth(viewYear, viewMonth);

    /** @type {string[]} */
    const cells = [];
    for (let i = 0; i < startPad; i++) {
      cells.push(`<span class="gb-cal-day is-empty" aria-hidden="true"></span>`);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const key = toDateKey(new Date(viewYear, viewMonth, day));
      const isToday = isThisMonth && day === today.getDate();
      const isSelected = selectedKey === key;
      const isDue = dueDays.has(day);
      const classes = ["gb-cal-day"];
      if (isToday) classes.push("is-today");
      if (isSelected) classes.push("is-selected");
      if (isDue) classes.push("is-due");
      const label = isDue ? `Reports due ${MONTHS[viewMonth]} ${day}` : `${MONTHS[viewMonth]} ${day}`;
      cells.push(
        `<button type="button" class="${classes.join(" ")}" data-cal-day="${day}" data-cal-key="${key}" aria-pressed="${isSelected ? "true" : "false"}" aria-current="${isToday ? "date" : "false"}" aria-label="${label}" title="${label}">${day}</button>`
      );
    }
    while (cells.length % 7 !== 0) {
      cells.push(`<span class="gb-cal-day is-empty" aria-hidden="true"></span>`);
    }
    gridEl.innerHTML = cells.join("");
  };

  /** Real-world day change: refresh “today” and optionally follow to the new day. */
  function syncRealDay() {
    const today = new Date();
    const key = toDateKey(today);
    const changed = key !== realDayKey;
    if (changed) {
      const followSelection = selectedKey === realDayKey;
      realDayKey = key;
      if (followSelection) {
        selectedKey = key;
        viewYear = today.getFullYear();
        viewMonth = today.getMonth();
        paint();
        emitSelection(key);
        return true;
      }
    }
    paint();
    return changed;
  }

  host.querySelector("[data-cal-prev]")?.addEventListener(
    "click",
    () => {
      viewMonth -= 1;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear -= 1;
      }
      paint();
    },
    { signal: opts.signal }
  );

  host.querySelector("[data-cal-next]")?.addEventListener(
    "click",
    () => {
      viewMonth += 1;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear += 1;
      }
      paint();
    },
    { signal: opts.signal }
  );

  gridEl.addEventListener(
    "click",
    (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest("[data-cal-key]");
      if (!btn || !(btn instanceof HTMLElement)) return;
      const key = btn.dataset.calKey;
      if (!key) return;
      selectDay(key);
    },
    { signal: opts.signal }
  );

  // Refresh due markers when To Do re-paints — do not steal the selected day.
  window.addEventListener("glassbox:todo-updated", () => paint(), { signal: opts.signal });

  window.addEventListener("focus", syncRealDay, { signal: opts.signal });
  document.addEventListener("visibilitychange", syncRealDay, { signal: opts.signal });
  const dayTimer = window.setInterval(syncRealDay, 60_000);
  opts.signal?.addEventListener("abort", () => window.clearInterval(dayTimer));

  paint();
  emitSelection(selectedKey);
}

/** @param {string} key YYYY-MM-DD */
function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
