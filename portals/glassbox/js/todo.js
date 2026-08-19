/**
 * Glass Box sidebar to-do — scheduled Client Reports for the selected calendar day.
 */

import {
  getReportsDueToday,
  toDateKey,
  SCHEDULED_REPORTS,
} from "./report-schedule.js?v=20260804-calclick";

const SCHEDULED_DONE_KEY = "glassbox.todo.scheduled.v1";
const DAILY_DONE_KEY = "glassbox.todo.daily.v1";

const DAILY_IDS = new Set(
  SCHEDULED_REPORTS.filter((r) => r.schedule === "daily").map((r) => r.id)
);

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * @typedef {{ kind: "scheduled", id: string, text: string, done: boolean, dueKey: string, meta: string, reportId: string }} TodoRow
 */

/** @returns {Record<string, boolean>} */
function loadScheduledDone() {
  try {
    const raw = localStorage.getItem(SCHEDULED_DONE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, boolean>} map */
function saveScheduledDone(map) {
  try {
    localStorage.setItem(SCHEDULED_DONE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Daily checkoffs only count for the calendar day they were saved.
 * @returns {{ day: string, done: Record<string, boolean> }}
 */
function loadDailyDone() {
  const today = toDateKey(new Date());
  try {
    const raw = localStorage.getItem(DAILY_DONE_KEY);
    if (!raw) return { day: today, done: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { day: today, done: {} };
    if (parsed.day !== today) return { day: today, done: {} };
    const done =
      parsed.done && typeof parsed.done === "object" ? /** @type {Record<string, boolean>} */ (parsed.done) : {};
    return { day: today, done };
  } catch {
    return { day: today, done: {} };
  }
}

/** @param {{ day: string, done: Record<string, boolean> }} state */
function saveDailyDone(state) {
  try {
    localStorage.setItem(DAILY_DONE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** @param {string} dueKey */
function reportIdFromDueKey(dueKey) {
  const idx = dueKey.lastIndexOf("|");
  return idx === -1 ? dueKey : dueKey.slice(0, idx);
}

/** @param {string} key */
function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** @param {string} key */
function formatDayLabel(key) {
  const today = toDateKey(new Date());
  if (key === today) return "Today";
  const date = parseDateKey(key);
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/**
 * @param {HTMLElement} host
 * @param {{ signal?: AbortSignal }} [opts]
 */
export function mountSidebarTodo(host, opts = {}) {
  /** @type {Record<string, boolean>} */
  let scheduledDone = loadScheduledDone();
  let dailyState = loadDailyDone();
  /** Real calendar day for daily reset. */
  let realDay = dailyState.day;
  /** Day shown in the list (from calendar selection). */
  let viewDay = realDay;

  host.innerHTML = `
    <div class="gb-todo" aria-label="To do list">
      <header class="gb-todo-bar">
        <h2 class="gb-todo-title" data-todo-title>Today's To Do</h2>
      </header>
      <ul class="gb-todo-list" data-todo-list></ul>
      <p class="gb-todo-empty hidden" data-todo-empty>Nothing due</p>
    </div>
  `;

  const listEl = /** @type {HTMLElement} */ (host.querySelector("[data-todo-list]"));
  const emptyEl = /** @type {HTMLElement} */ (host.querySelector("[data-todo-empty]"));
  const titleEl = /** @type {HTMLElement} */ (host.querySelector("[data-todo-title]"));

  function refreshDailyBucket() {
    const today = toDateKey(new Date());
    if (today === realDay) return false;
    realDay = today;
    dailyState = { day: today, done: {} };
    saveDailyDone(dailyState);
    return true;
  }

  /** @returns {TodoRow[]} */
  function buildRows() {
    refreshDailyBucket();
    const viewDate = parseDateKey(viewDay);

    /** @type {TodoRow[]} */
    const rows = getReportsDueToday(viewDate).map((report) => {
      const isDaily = DAILY_IDS.has(report.id);
      const done =
        isDaily && viewDay === realDay
          ? Boolean(dailyState.done[report.id])
          : Boolean(scheduledDone[report.dueKey]);
      return {
        kind: "scheduled",
        id: `sched:${report.dueKey}`,
        text: report.label,
        done,
        dueKey: report.dueKey,
        meta: report.scheduleLabel,
        reportId: report.id,
      };
    });

    rows.sort((a, b) => Number(a.done) - Number(b.done));
    return rows;
  }

  const paint = () => {
    const rows = buildRows();
    titleEl.textContent =
      viewDay === realDay ? "Today's To Do" : `${formatDayLabel(viewDay)} To Do`;
    emptyEl.textContent = viewDay === realDay ? "Nothing due today" : "Nothing due this day";
    emptyEl.classList.toggle("hidden", rows.length > 0);
    listEl.innerHTML = rows
      .map(
        (row) => `
      <li class="gb-todo-item${row.done ? " is-done" : ""} is-scheduled" data-id="${escapeAttr(row.id)}">
        <label class="gb-todo-check">
          <input type="checkbox" data-todo-toggle ${row.done ? "checked" : ""} />
          <span class="gb-todo-text-wrap">
            <span class="gb-todo-text">${escapeHtml(row.text)}</span>
            <span class="gb-todo-meta">${escapeHtml(row.meta)}</span>
          </span>
        </label>
        <span class="gb-todo-badge" title="Client report">Report</span>
      </li>`
      )
      .join("");

    window.dispatchEvent(
      new CustomEvent("glassbox:todo-updated", { detail: { day: viewDay } })
    );
  };

  listEl.addEventListener(
    "change",
    (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (!(target instanceof HTMLInputElement) || !target.matches("[data-todo-toggle]")) return;
      const row = target.closest(".gb-todo-item");
      const id = row?.getAttribute("data-id");
      if (!id) return;

      refreshDailyBucket();
      const dueKey = id.replace(/^sched:/, "");
      const reportId = reportIdFromDueKey(dueKey);
      if (DAILY_IDS.has(reportId) && viewDay === realDay) {
        dailyState = {
          day: realDay,
          done: { ...dailyState.done, [reportId]: target.checked },
        };
        saveDailyDone(dailyState);
      } else {
        scheduledDone = { ...scheduledDone, [dueKey]: target.checked };
        saveScheduledDone(scheduledDone);
      }
      paint();
    },
    { signal: opts.signal }
  );

  window.addEventListener(
    "glassbox:date-selected",
    (e) => {
      const detail = /** @type {CustomEvent} */ (e).detail;
      const day = detail && typeof detail.day === "string" ? detail.day : null;
      if (!day) return;
      viewDay = day;
      paint();
    },
    { signal: opts.signal }
  );

  const onMaybeNewDay = () => {
    if (!refreshDailyBucket()) {
      window.dispatchEvent(
        new CustomEvent("glassbox:todo-updated", { detail: { day: viewDay } })
      );
      return;
    }
    // Real day flipped — if we were viewing the previous "today", follow along.
    viewDay = realDay;
    paint();
  };
  window.addEventListener("focus", onMaybeNewDay, { signal: opts.signal });
  document.addEventListener("visibilitychange", onMaybeNewDay, { signal: opts.signal });
  const dayTimer = window.setInterval(onMaybeNewDay, 60_000);
  opts.signal?.addEventListener("abort", () => window.clearInterval(dayTimer));

  scheduledDone = Object.fromEntries(
    Object.entries(scheduledDone).filter(([key]) => !DAILY_IDS.has(reportIdFromDueKey(key)))
  );
  saveScheduledDone(scheduledDone);

  // Initial paint; calendar will emit date-selected shortly after mount.
  paint();
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string} value */
function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
