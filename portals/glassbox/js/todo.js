/**
 * To-do tile. Every board is the same shared list.
 * The Reports board also shows the repeating client-report rows.
 */

import {
  getReportsDueToday,
  occursOnTodo as occursOn,
  replaceTodoItems,
  toDateKey,
  SCHEDULED_REPORTS,
} from "./report-schedule.js?v=20261123-builtin";
import { confirmDialog } from "../../../shared/js/dialog.js?v=20261006-nobrand";
import { RACK_ORIGIN, rackAuthHeaders } from "../../../shared/js/ftp-rack.js?v=20261123-todos";

const SCHEDULED_DONE_KEY = "glassbox.todo.scheduled.v1";
const DAILY_DONE_KEY = "glassbox.todo.daily.v1";
const BOARD_KEY = "dalko.todo.board.v1";

const DAILY_IDS = new Set(
  SCHEDULED_REPORTS.filter((r) => r.schedule === "daily").map((r) => r.id)
);

/** @param {string} reportId */
function cadenceFor(reportId) {
  const report = SCHEDULED_REPORTS.find((item) => item.id === reportId);
  if (!report) return "Report";
  if (report.schedule === "daily") return "Daily";
  if (report.schedule === "weekday") return "Weekly";
  return "Monthly";
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

/** @param {string} key */
function weekdayOf(key) {
  return parseDateKey(key).getDay();
}

/** @param {string} key @param {number} days */
function shiftDay(key, days) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/**
 * @param {{ due?: string, repeat?: string, done?: boolean, doneDates?: string[] }} item
 * @param {string} day
 */
function doneOn(item, day) {
  const dates = Array.isArray(item.doneDates) ? item.doneDates : [];
  if (dates.includes(day)) return true;
  return (item.repeat || "none") === "none" && Boolean(item.done) && (!item.due || item.due === day);
}

/**
 * Latest occurrence before today that is still open.
 * @param {{ due?: string, repeat?: string, done?: boolean, doneDates?: string[] }} item
 * @param {string} today
 */
function overdueDay(item, today) {
  const due = item.due || "";
  if (!due || due >= today) return "";
  const repeat = item.repeat || "none";
  let candidate = "";
  if (repeat === "none") candidate = due;
  else if (repeat === "daily") candidate = shiftDay(today, -1);
  else if (repeat === "weekly") {
  const date = parseDateKey(today);
  let back = (date.getDay() - weekdayOf(due) + 7) % 7;
  if (back === 0) back = 7;
  date.setDate(date.getDate() - back);
  candidate = toDateKey(date);
  } else if (repeat === "monthly") {
    const date = parseDateKey(today);
    const want = Number(due.slice(8, 10));
    const probe = new Date(date.getFullYear(), date.getMonth(), 1);
    probe.setDate(0);
    const last = probe.getDate();
    probe.setDate(Math.min(want, last));
    candidate = toDateKey(probe);
  } else if (repeat === "nthweekday") {
    const date = parseDateKey(today);
    const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const weekday = Number.isInteger(item.weekday) ? item.weekday : weekdayOf(due);
    const nth = Number.isInteger(item.nth) ? item.nth : 1;
    const delta = (weekday - prev.getDay() + 7) % 7;
    const dom = 1 + delta + (nth - 1) * 7;
    const last = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
    if (dom <= last) candidate = toDateKey(new Date(prev.getFullYear(), prev.getMonth(), dom));
  }
  if (!candidate || candidate < due || candidate >= today) return "";
  return doneOn(item, candidate) ? "" : candidate;
}

/** @param {string} repeat */
function repeatWord(repeat) {
  if (repeat === "daily") return "Daily";
  if (repeat === "weekly") return "Weekly";
  if (repeat === "monthly" || repeat === "nthweekday") return "Monthly";
  return "";
}

/** @typedef {{ text: string, due: string, repeat: string, note: string, weekday?: number, nth?: number }} TaskDraft */

/**
 * @param {Partial<TaskDraft> | null} current
 * @param {string} day
 * @param {string} boardTitle
 * @param {(draft: TaskDraft) => Promise<void>} save
 */
function openTodoForm(current, day, boardTitle, save) {
  if (document.getElementById("todo-form-dialog")) return;
  const returnFocus = document.activeElement;
  const action = current ? "Save changes" : "Add task";
  const root = document.createElement("div");
  root.id = "todo-form-dialog";
  root.className = "gb-todo-dialog";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "todo-form-title");
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    .map((name, index) => `<option value="${index}">${name}</option>`)
    .join("");
  root.innerHTML = `
    <div class="gb-todo-dialog-backdrop" data-todo-cancel></div>
    <form class="gb-todo-dialog-card" tabindex="-1">
      <header>
        <h2 id="todo-form-title">To do: ${escapeHtml(boardTitle)}</h2>
      </header>
      <fieldset class="gb-todo-form-fields">
        <label>Task name
          <input name="text" maxlength="240" required placeholder="What needs to get done?" value="${escapeAttr(current?.text || "")}" />
        </label>
        <details class="gb-todo-form-details" open>
          <summary><span>Schedule and notes</span><span data-todo-due-summary></span></summary>
          <div class="gb-todo-dialog-schedule">
            <label>Due date
              <input name="due" type="date" required value="${escapeAttr(current?.due || day)}" />
            </label>
            <label>Repeat
              <select name="repeat">
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="nthweekday">Monthly, on a weekday</option>
              </select>
            </label>
            <label data-todo-nth>Week of the month
              <select name="nth">
                <option value="1">1st</option>
                <option value="2">2nd</option>
                <option value="3">3rd</option>
                <option value="4">4th</option>
                <option value="5">5th</option>
              </select>
            </label>
            <label data-todo-weekday>Weekday
              <select name="weekday">${weekdays}</select>
            </label>
          </div>
          <label><span>Note <span class="gb-todo-optional">(optional)</span></span>
            <textarea name="note" maxlength="1000" rows="3" placeholder="Add context for this task">${escapeHtml(current?.note || "")}</textarea>
          </label>
        </details>
      </fieldset>
      <p class="gb-todo-form-error" role="alert" hidden></p>
      <div class="gb-todo-dialog-actions">
        <button type="button" class="gb-todo-dialog-cancel" data-todo-cancel>Cancel</button>
        <button type="submit" class="gb-todo-dialog-save">${action}</button>
      </div>
    </form>`;
  document.body.appendChild(root);
  const form = /** @type {HTMLFormElement} */ (root.querySelector("form"));
  const repeat = /** @type {HTMLSelectElement} */ (form.querySelector("[name=repeat]"));
  const nth = /** @type {HTMLSelectElement} */ (form.querySelector("[name=nth]"));
  const weekday = /** @type {HTMLSelectElement} */ (form.querySelector("[name=weekday]"));
  const dueInput = /** @type {HTMLInputElement} */ (form.querySelector("[name=due]"));
  const details = /** @type {HTMLDetailsElement} */ (form.querySelector("details"));
  const dueSummary = /** @type {HTMLElement} */ (form.querySelector("[data-todo-due-summary]"));
  const fields = /** @type {HTMLFieldSetElement} */ (form.querySelector("fieldset"));
  const saveButton = /** @type {HTMLButtonElement} */ (form.querySelector("[type=submit]"));
  const cancelButton = /** @type {HTMLButtonElement} */ (form.querySelector("button[data-todo-cancel]"));
  const errorBox = /** @type {HTMLElement} */ (form.querySelector("[role=alert]"));
  repeat.value = current?.repeat || "none";
  nth.value = String(current?.nth ?? 2);
  weekday.value = String(current?.weekday ?? 1);
  const showRepeat = () => {
    const special = repeat.value === "nthweekday";
    form.querySelector("[data-todo-nth]")?.classList.toggle("hidden", !special);
    form.querySelector("[data-todo-weekday]")?.classList.toggle("hidden", !special);
  };
  repeat.addEventListener("change", showRepeat);
  showRepeat();
  const updateSummary = () => {
    dueSummary.textContent = dueInput.value ? `Due ${formatDayLabel(dueInput.value)}` : "Choose date";
  };
  dueInput.addEventListener("input", updateSummary);
  dueInput.addEventListener("invalid", () => { details.open = true; });
  updateSummary();
  const text = /** @type {HTMLInputElement} */ (form.querySelector("[name=text]"));
  text.focus();
  let saving = false;
  const finish = () => {
    root.remove();
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
  };
  root.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!saving && target.closest("[data-todo-cancel]")) finish();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(form);
    const next = String(data.get("text") || "").trim();
    const due = String(data.get("due") || "").trim();
    const kind = String(data.get("repeat") || "none");
    if (!next) {
      text.setCustomValidity("Enter a task name.");
      text.reportValidity();
      return;
    }
    if (!due) return;
    /** @type {TaskDraft} */
    const draft = {
      text: next,
      due,
      repeat: kind,
      note: String(data.get("note") || "").trim(),
    };
    if (kind === "nthweekday") {
      draft.weekday = Number(data.get("weekday"));
      draft.nth = Number(data.get("nth"));
    }
    saving = true;
    errorBox.hidden = true;
    fields.disabled = true;
    saveButton.disabled = true;
    cancelButton.disabled = true;
    saveButton.textContent = "Saving…";
    form.focus();
    try {
      await save(draft);
      finish();
    } catch (error) {
      errorBox.textContent = error instanceof Error ? error.message : "The task could not be saved.";
      errorBox.hidden = false;
      saving = false;
      fields.disabled = false;
      saveButton.disabled = false;
      cancelButton.disabled = false;
      saveButton.textContent = action;
      saveButton.focus();
    }
  });
  text.addEventListener("input", () => text.setCustomValidity(""));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!saving) finish();
    }
    if (event.key !== "Tab") return;
    if (saving) {
      event.preventDefault();
      return;
    }
    const controls = [...form.querySelectorAll("input, select, textarea, button, summary")]
      .filter((control) => !control.matches(":disabled") && control.getClientRects().length);
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement !== edge) return;
    event.preventDefault();
    const next = event.shiftKey ? controls.at(-1) : controls[0];
    if (next instanceof HTMLElement) next.focus();
  });
}

/**
 * @param {string} path
 * @param {RequestInit} [options]
 */
async function rackJson(path, options = {}) {
  const headers = await rackAuthHeaders(options.body ? { "Content-Type": "application/json" } : {});
  const res = await fetch(`${RACK_ORIGIN}${path}`, {
    ...options,
    cache: "no-store",
    headers: { ...headers, ...(options.headers || {}) },
  });
  let payload = {};
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }
  if (!res.ok || payload.ok === false) {
    throw Object.assign(new Error(payload.error || "Insights did not answer."), { status: res.status });
  }
  return payload;
}

function taskActions(title, toolId) {
  return `<div class="gb-todo-task-actions">
    ${toolId ? `<button type="button" class="gb-todo-goto" data-todo-goto="${escapeAttr(toolId)}">Open</button>` : ""}
    <button type="button" class="gb-todo-row-menu" data-todo-more aria-expanded="false" aria-label="More actions for ${escapeAttr(title)}" title="More actions">⋯</button>
    <div class="gb-todo-row-options" popover>
      <button type="button" class="gb-todo-goto" data-todo-edit autofocus>Edit</button>
      <button type="button" class="gb-todo-goto" data-todo-delete>Delete</button>
    </div>
  </div>`;
}

function openBoardForm(board, save) {
  const dialog = document.createElement("dialog");
  dialog.className = "gb-todo-board-dialog";
  dialog.setAttribute("aria-labelledby", "todo-board-form-title");
  dialog.innerHTML = `
    <form class="gb-todo-dialog-card">
      <h2 id="todo-board-form-title">Edit to-do list</h2>
      <label>List name
        <input name="title" maxlength="60" required value="${escapeAttr(board.title)}" />
      </label>
      <label>Members
        <textarea name="members" rows="4" placeholder="name@shipdalko.com" aria-describedby="todo-board-members-hint">${escapeHtml((board.members || []).join("\n"))}</textarea>
      </label>
      <p class="gb-todo-board-hint" id="todo-board-members-hint">Enter one Dalko email per line. Members can view and edit tasks. Remove an email to revoke access.</p>
      <p class="gb-todo-form-error" role="alert" hidden></p>
      <div class="gb-todo-dialog-actions">
        <button type="button" class="gb-todo-dialog-cancel">Cancel</button>
        <button type="submit" class="gb-todo-dialog-save">Save changes</button>
      </div>
    </form>`;
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector("form"));
  const cancel = /** @type {HTMLButtonElement} */ (form.querySelector("[type=button]"));
  const submit = /** @type {HTMLButtonElement} */ (form.querySelector("[type=submit]"));
  const errorBox = /** @type {HTMLElement} */ (form.querySelector("[role=alert]"));
  let saving = false;
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(form);
    const title = String(data.get("title") || "").trim();
    const members = String(data.get("members") || "").split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
    saving = true;
    cancel.disabled = submit.disabled = true;
    errorBox.hidden = true;
    submit.textContent = "Saving…";
    try {
      await save({ id: board.id, title, members, previousTitle: board.title, previousMembers: board.members || [] });
      dialog.close();
    } catch (error) {
      errorBox.textContent = error instanceof Error ? error.message : "The list could not be saved.";
      errorBox.hidden = false;
      saving = false;
      cancel.disabled = submit.disabled = false;
      submit.textContent = "Save changes";
    }
  });
  document.body.appendChild(dialog);
  dialog.showModal();
}

/**
 * @param {HTMLElement} host
 * @param {{ signal?: AbortSignal }} [opts]
 */
export function mountSidebarTodo(host, opts = {}) {
  /** @type {Record<string, boolean>} */
  let scheduledDone = loadScheduledDone();
  let dailyState = loadDailyDone();
  let realDay = dailyState.day;
  let viewDay = realDay;
  /** @type {{ id: string, title: string, kind: string, owner: string, members: string[], mine: boolean }[]} */
  let boards = [];
  let boardId = sessionStorage.getItem(BOARD_KEY) || "";
  let rev = 0;
  /** @type {{ id: string, text: string, done: boolean }[]} */
  let sharedItems = [];
  /** @type {Record<string, { done?: boolean, doneBy?: string }>} */
  let serverChecks = {};
  let serverReady = false;
  let itemsLoaded = false;
  let note = "";
  let making = false;
  let opened = false;
  /** @type {AbortController | null} */
  let watchAbort = null;

  host.innerHTML = `
    <div class="gb-todo" aria-label="To do list">
      <div class="gb-todo-heading">
        <h2 class="gb-todo-title">To Do</h2>
        <label class="gb-todo-picker">
          <span class="sr-only">Board</span>
          <select class="gb-todo-board" data-todo-board></select>
        </label>
        <button type="button" class="gb-todo-add hidden" data-todo-open><span aria-hidden="true">+</span> New task</button>
        <button type="button" class="gb-todo-mini gb-todo-edit-list" data-todo-edit-list hidden>Edit list</button>
      </div>
      <div class="gb-todo-bar">
        <button type="button" class="gb-todo-mini" data-todo-drop hidden>Delete board</button>
      </div>
      <form class="gb-todo-compose hidden" data-todo-make>
        <input class="gb-todo-input" name="title" maxlength="60" placeholder="Board name" aria-label="Board name" />
        <button type="submit" class="gb-todo-mini">Add</button>
        <button type="button" class="gb-todo-mini" data-todo-make-cancel>Cancel</button>
      </form>
      <div class="gb-todo-progress" data-todo-progress hidden>
        <span data-todo-count></span>
        <progress aria-label="Tasks completed" value="0" max="1"></progress>
      </div>
      <ul class="gb-todo-list" data-todo-list></ul>
      <p class="gb-todo-empty hidden" data-todo-empty>Nothing due</p>
      <p class="gb-todo-note hidden" data-todo-note role="status"></p>
    </div>
  `;

  const listEl = /** @type {HTMLElement} */ (host.querySelector("[data-todo-list]"));
  const emptyEl = /** @type {HTMLElement} */ (host.querySelector("[data-todo-empty]"));
  const noteEl = /** @type {HTMLElement} */ (host.querySelector("[data-todo-note]"));
  const selectEl = /** @type {HTMLSelectElement} */ (host.querySelector("[data-todo-board]"));
  const editListBtn = /** @type {HTMLButtonElement} */ (host.querySelector("[data-todo-edit-list]"));
  const dropBtn = /** @type {HTMLButtonElement} */ (host.querySelector("[data-todo-drop]"));
  const makeForm = /** @type {HTMLFormElement} */ (host.querySelector("[data-todo-make]"));
  const openBtn = /** @type {HTMLButtonElement} */ (host.querySelector("[data-todo-open]"));
  const progressEl = /** @type {HTMLElement} */ (host.querySelector("[data-todo-progress]"));
  const progressBar = /** @type {HTMLProgressElement} */ (progressEl.querySelector("progress"));
  const countEl = /** @type {HTMLElement} */ (progressEl.querySelector("[data-todo-count]"));

  function currentBoard() {
    return boards.find((board) => board.id === boardId) || null;
  }

  function isReports() {
    return currentBoard()?.kind === "reports";
  }

  function refreshDailyBucket() {
    const today = toDateKey(new Date());
    if (today === realDay) return false;
    realDay = today;
    dailyState = { day: today, done: {} };
    saveDailyDone(dailyState);
    return true;
  }

  function localDone(reportId, dueKey) {
    if (DAILY_IDS.has(reportId) && viewDay === realDay) return Boolean(dailyState.done[reportId]);
    return Boolean(scheduledDone[dueKey]);
  }

  function rememberLocal(reportId, dueKey, done) {
    if (DAILY_IDS.has(reportId) && viewDay === realDay) {
      dailyState = { day: realDay, done: { ...dailyState.done, [reportId]: done } };
      saveDailyDone(dailyState);
      return;
    }
    scheduledDone = { ...scheduledDone, [dueKey]: done };
    saveScheduledDone(scheduledDone);
  }

  function fillBoards() {
    const previous = boardId;
    const options = boards.map((board) => `<option value="${escapeAttr(board.id)}">${escapeHtml(board.title)}</option>`);
    options.push(`<option value="__new__">New board…</option>`);
    if (!boards.length) options.unshift(`<option value="" disabled>No lists available</option>`);
    selectEl.innerHTML = options.join("");
    const known = boards.some((board) => board.id === previous);
    if (making) selectEl.value = "__new__";
    else if (known) selectEl.value = previous;
    else if (boards[0]) {
      boardId = boards[0].id;
      selectEl.value = boardId;
    } else {
      boardId = "";
      selectEl.value = "";
    }
  }

  function showChrome() {
    const board = currentBoard();
    const editable = Boolean(board) && !making;
    editListBtn.hidden = !editable || !board?.mine;
    dropBtn.hidden = !(board && board.kind === "custom" && board.mine);
    openBtn.classList.toggle("hidden", !editable);
    makeForm.classList.toggle("hidden", !making);
    noteEl.textContent = note;
    noteEl.classList.toggle("hidden", !note);
    if (boardId) sessionStorage.setItem(BOARD_KEY, boardId);
  }

  function itemForReport(reportId) {
    const report = SCHEDULED_REPORTS.find((entry) => entry.id === reportId);
    return (
      sharedItems.find((entry) => entry.toolId === reportId || (report && entry.text === report.label)) || null
    );
  }

  function starterForReport(reportId) {
    const report = SCHEDULED_REPORTS.find((entry) => entry.id === reportId);
    const text = report?.label || reportId;
    if (!report || report.schedule === "daily") return { text, due: realDay, repeat: "daily", note: "" };
    if (report.schedule === "weekday") {
      const date = parseDateKey(realDay);
      const want = report.weekday ?? 1;
      date.setDate(date.getDate() - ((date.getDay() - want + 7) % 7));
      return { text, due: toDateKey(date), repeat: "weekly", note: "" };
    }
    if (report.schedule === "monthDay") {
      const date = parseDateKey(realDay);
      return { text, due: toDateKey(new Date(date.getFullYear(), date.getMonth(), report.day || 1)), repeat: "monthly", note: "" };
    }
    return { text, due: realDay, repeat: "nthweekday", weekday: report.weekday ?? 1, nth: report.nth ?? 2, note: "" };
  }

  function rowsHtml(rows) {
    return rows
      .map(({ item, occur, overdue, reportId }) => {
        const done = doneOn(item, occur);
        const badge = overdue ? "Overdue" : repeatWord(item.repeat || "none");
        return `
      <li class="gb-todo-item${done ? " is-done" : ""}${overdue ? " is-overdue" : ""}" data-id="${escapeAttr(item.id)}" data-occur="${escapeAttr(occur)}"${reportId ? ` data-report="${escapeAttr(reportId)}"` : ""}>
        <div class="gb-todo-row">
          <label class="gb-todo-check">
            <input type="checkbox" data-todo-toggle ${done ? "checked" : ""} />
            <span class="gb-todo-text-wrap">
              <span class="gb-todo-text">${escapeHtml(item.text)}</span>
              ${badge ? `<span class="gb-todo-badge">${escapeHtml(badge)}</span>` : ""}
              ${item.note ? `<span class="gb-todo-meta">${escapeHtml(item.note)}</span>` : ""}
            </span>
          </label>
          ${taskActions(item.text, item.toolId)}
        </div>
      </li>`;
      })
      .join("");
  }

  function paintReports() {
    refreshDailyBucket();
    const viewDate = parseDateKey(viewDay);
    const rows = getReportsDueToday(viewDate)
      .filter((report) => !itemForReport(report.id))
      .map((report) => {
        const fromServer = serverReady ? serverChecks[report.dueKey] : null;
        const done = fromServer ? Boolean(fromServer.done) : localDone(report.id, report.dueKey);
        const starter = starterForReport(report.id);
        const occur = toDateKey(report.due);
        return {
          item: {
            id: report.dueKey,
            text: report.label,
            due: starter.due,
            repeat: starter.repeat,
            weekday: starter.weekday,
            nth: starter.nth,
            note: "",
            done,
            doneDates: done ? [occur] : [],
            toolId: report.id,
          },
          occur,
          overdue: false,
          reportId: report.id,
        };
      });
    rows.sort((a, b) => Number(doneOn(a.item, a.occur)) - Number(doneOn(b.item, b.occur)));
    return rowsHtml(rows);
  }

  function paintItems() {
    const today = realDay;
    /** @type {{ item: { id: string, text: string, due?: string, repeat?: string, note?: string, done?: boolean, doneDates?: string[], toolId?: string }, occur: string, overdue: boolean }[]} */
    const rows = [];
    for (const item of sharedItems) {
      const overdue = viewDay === today ? overdueDay(item, today) : "";
      if (overdue) rows.push({ item, occur: overdue, overdue: true });
      if (item.due) {
        if (occursOn(item, viewDay)) rows.push({ item, occur: viewDay, overdue: false });
      } else if (viewDay === today) {
        rows.push({ item, occur: today, overdue: false });
      }
    }
    rows.sort((a, b) => Number(doneOn(a.item, a.occur)) - Number(doneOn(b.item, b.occur)) || Number(b.overdue) - Number(a.overdue));
    return rowsHtml(rows);
  }

  function paint() {
    showChrome();
    progressEl.hidden = true;
    if (!opened) {
      listEl.innerHTML = "";
      emptyEl.textContent = "Loading to-dos";
      emptyEl.classList.remove("hidden");
      return;
    }
    if (making) {
      listEl.innerHTML = "";
      emptyEl.classList.add("hidden");
      return;
    }
    if (boardId && boardId !== "reports" && !currentBoard()) {
      listEl.innerHTML = "";
      emptyEl.textContent = "Loading to-dos";
      emptyEl.classList.remove("hidden");
      return;
    }
    const dayLabel = viewDay === realDay ? "today" : formatDayLabel(viewDay);
    const html = `${isReports() && !itemsLoaded ? paintReports() : ""}${paintItems()}`;
    emptyEl.textContent = `Nothing due ${dayLabel}`;
    emptyEl.classList.toggle("hidden", html.trim().length > 0);
    listEl.innerHTML = html;
    const total = listEl.children.length;
    if (total) {
      const completed = listEl.querySelectorAll(".is-done").length;
      countEl.textContent = `${completed} of ${total} done`;
      progressBar.max = total;
      progressBar.value = completed;
      progressEl.hidden = false;
    }
  }

  function applySnapshot(payload) {
    if (!payload || payload.board?.id !== boardId) return;
    if (typeof payload.rev === "number" && payload.rev < rev) return;
    rev = Number(payload.rev || 0);
    serverReady = true;
    note = "";
    if (payload.board) {
      const idx = boards.findIndex((board) => board.id === payload.board.id);
      if (idx >= 0) {
        const titleChanged = boards[idx].title !== payload.board.title;
        boards[idx] = { ...boards[idx], ...payload.board };
        if (titleChanged) fillBoards();
      }
      else boards.push(payload.board);
    }
    if (Array.isArray(payload.items)) {
      sharedItems = payload.items;
      itemsLoaded = true;
      replaceTodoItems(sharedItems);
      window.dispatchEvent(new CustomEvent("glassbox:todo-updated"));
    }
    if (payload.checks && typeof payload.checks === "object") serverChecks = payload.checks;
    paint();
  }

  function stopWatch() {
    watchAbort?.abort();
    watchAbort = null;
  }

  async function follow(id) {
    stopWatch();
    const controller = new AbortController();
    watchAbort = controller;
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let seen = -1;
    while (!controller.signal.aborted && !opts.signal?.aborted && boardId === id) {
      try {
        const payload = await rackJson(`/api/todos/watch?id=${encodeURIComponent(id)}&rev=${seen}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || boardId !== id) return;
        if (typeof payload.rev === "number") seen = payload.rev;
        applySnapshot(payload);
        const listed = await rackJson("/api/todos", { signal: controller.signal });
        if (controller.signal.aborted || boardId !== id) return;
        const editing = host.querySelector(".gb-todo-item .gb-todo-input");
        if (!editing && Array.isArray(listed.boards) && listed.boards.length) {
          const changed = listed.boards.length !== boards.length || listed.boards.some(
            (board, index) => board.id !== boards[index]?.id || board.title !== boards[index]?.title
          );
          boards = listed.boards;
          if (changed) {
            fillBoards();
            paint();
          } else {
            showChrome();
          }
        }
      } catch (error) {
        if (controller.signal.aborted || opts.signal?.aborted) return;
        if (error?.status === 404 && currentBoard()) {
          boards = boards.filter((board) => board.id !== id);
          sharedItems = [];
          itemsLoaded = false;
          rev = 0;
          fillBoards();
          paint();
          void loadBoards();
          return;
        }
        if (isReports()) {
          serverReady = false;
          note = "Shared checks are offline. This list is on this computer until Insights answers.";
          paint();
        } else {
          note = error instanceof Error ? error.message : "Insights did not answer.";
          paint();
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  async function loadBoards() {
    try {
      const payload = await rackJson("/api/todos", { signal: opts.signal });
      if (opts.signal?.aborted) return;
      boards = Array.isArray(payload.boards) ? payload.boards : [];
      opened = true;
      const saved = sessionStorage.getItem(BOARD_KEY) || "";
      if (boards.some((board) => board.id === saved)) boardId = saved;
      else boardId = payload.personalId || boards[0]?.id || "";
      serverReady = true;
      note = "";
      fillBoards();
      paint();
      if (boardId) void follow(boardId);
    } catch (error) {
      if (opts.signal?.aborted) return;
      boards = [];
      opened = true;
      boardId = "";
      serverReady = false;
      note = error instanceof Error ? error.message : "Could not load to-do lists.";
      fillBoards();
      paint();
    }
  }

  selectEl.addEventListener("change", () => {
    const value = selectEl.value;
    if (value === "__new__") {
      making = true;
      paint();
      makeForm.querySelector("input")?.focus();
      return;
    }
    making = false;
    boardId = value;
    rev = 0;
    sharedItems = [];
    itemsLoaded = false;
    note = "";
    sessionStorage.setItem(BOARD_KEY, boardId);
    paint();
    if (serverReady || boardId) void follow(boardId);
  });

  editListBtn.addEventListener("click", () => {
    const board = currentBoard();
    if (!board?.mine) return;
    openBoardForm(board, async (draft) => {
      const payload = await rackJson("/api/todos/boards", {
        method: "PUT",
        body: JSON.stringify(draft),
        signal: opts.signal,
      });
      const index = boards.findIndex((item) => item.id === board.id);
      if (index >= 0 && payload.board) {
        boards[index] = { ...boards[index], ...payload.board };
        fillBoards();
        showChrome();
      }
    });
  });

  makeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = /** @type {HTMLInputElement | null} */ (makeForm.querySelector("input"));
    const title = input?.value.trim() || "";
    if (!title) return;
    try {
      const payload = await rackJson("/api/todos/boards", {
        method: "POST",
        body: JSON.stringify({ title }),
        signal: opts.signal,
      });
      making = false;
      if (input) input.value = "";
      if (payload.board?.id) {
        boards.push(payload.board);
        boardId = payload.board.id;
      }
      fillBoards();
      note = "";
      paint();
      void follow(boardId);
    } catch (error) {
      note = error instanceof Error ? error.message : "That board was not added.";
      paint();
    }
  });

  host.querySelector("[data-todo-make-cancel]")?.addEventListener("click", () => {
    making = false;
    fillBoards();
    paint();
  });


  function editTask(current, { itemId = "", toolId = "" } = {}) {
    const targetBoard = boardId;
    const boardTitle = currentBoard()?.title || "Reports";
    openTodoForm(current, current?.due || viewDay || realDay, boardTitle, async (draft) => {
      const payload = await rackJson("/api/todos/items", {
        method: itemId ? "PUT" : "POST",
        body: JSON.stringify({
          ...(itemId ? { itemId } : { id: targetBoard, ...(toolId ? { toolId } : {}) }),
          ...draft,
        }),
        signal: opts.signal,
      });
      if (boardId !== targetBoard || (typeof payload.rev === "number" && payload.rev < rev)) return;
      if (typeof payload.rev === "number") rev = payload.rev;
      if (Array.isArray(payload.items)) {
        sharedItems = payload.items;
        if (current) {
          itemsLoaded = true;
          replaceTodoItems(sharedItems);
          window.dispatchEvent(new CustomEvent("glassbox:todo-updated"));
        }
      }
      note = "";
      paint();
    });
  }

  openBtn.addEventListener("click", () => editTask(null));

  dropBtn.addEventListener("click", async () => {
    const board = currentBoard();
    if (!board || board.kind !== "custom") return;
    const ok = await confirmDialog(`Delete the board “${board.title}”?`, {
      title: "Delete board",
      okLabel: "Delete",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await rackJson(`/api/todos/boards?id=${encodeURIComponent(board.id)}`, {
        method: "DELETE",
        signal: opts.signal,
      });
      boards = boards.filter((item) => item.id !== board.id);
      boardId = boards.find((item) => item.kind === "personal" && item.mine)?.id || boards[0]?.id || "";
      fillBoards();
      note = "";
      paint();
      if (boardId) void follow(boardId);
    } catch (error) {
      note = error instanceof Error ? error.message : "That board was not deleted.";
      paint();
    }
  });

  listEl.addEventListener("change", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!(target instanceof HTMLInputElement) || !target.matches("[data-todo-toggle]")) return;
    const row = target.closest(".gb-todo-item");
    const id = row?.getAttribute("data-id") || "";
    if (!id) return;
    if (row?.hasAttribute("data-report")) {
      refreshDailyBucket();
      const reportId = row?.getAttribute("data-report") || reportIdFromDueKey(id);
      rememberLocal(reportId, id, target.checked);
      serverChecks = { ...serverChecks, [id]: { done: target.checked } };
      serverReady = serverReady || false;
      paint();
      void rackJson("/api/todos/checks", {
        method: "POST",
        body: JSON.stringify({ dueKey: id, done: target.checked }),
        signal: opts.signal,
      })
        .then((payload) => {
          if (typeof payload.rev === "number") rev = payload.rev;
          if (payload.checks) {
            serverChecks = payload.checks;
            serverReady = true;
            note = "";
          }
          paint();
        })
        .catch(() => {
          note = "This check is on this computer. Insights did not save it for anyone else.";
          paint();
        });
      return;
    }
    const occur = row?.getAttribute("data-occur") || "";
    const item = sharedItems.find((entry) => entry.id === id);
    if (item && occur) {
      item.doneDates = (item.doneDates || []).filter((day) => day !== occur);
      if (target.checked) item.doneDates.push(occur);
      if ((item.repeat || "none") === "none") item.done = target.checked;
    }
    paint();
    void rackJson("/api/todos/items", {
      method: "PUT",
      body: JSON.stringify({ itemId: id, occurDate: occur, done: target.checked }),
      signal: opts.signal,
    })
      .then((payload) => {
        if (typeof payload.rev === "number") rev = payload.rev;
        if (Array.isArray(payload.items)) sharedItems = payload.items;
        note = "";
        paint();
      })
      .catch((error) => {
      if (item) {
        item.doneDates = (item.doneDates || []).filter((day) => day !== occur);
        if (!target.checked) item.doneDates.push(occur);
        if ((item.repeat || "none") === "none") item.done = !target.checked;
      }
        note = error instanceof Error ? error.message : "That check was not saved.";
        paint();
      });
  });

  listEl.addEventListener("toggle", (event) => {
    const menu = event.target;
    if (!(menu instanceof HTMLElement) || !menu.matches(".gb-todo-row-options")) return;
    menu.previousElementSibling?.setAttribute("aria-expanded", String(menu.matches(":popover-open")));
  }, true);

  listEl.addEventListener("scroll", () => {
    listEl.querySelector(".gb-todo-row-options:popover-open")?.hidePopover();
  }, { passive: true });

  listEl.addEventListener("click", async (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const more = /** @type {HTMLElement | null} */ (target.closest("[data-todo-more]"));
    if (more) {
      const menu = /** @type {HTMLElement | null} */ (more.nextElementSibling);
      if (menu?.matches(":popover-open")) {
        menu.hidePopover();
        return;
      }
      if (menu) {
        menu.showPopover({ source: more });
        const anchor = more.getBoundingClientRect();
        const { width, height } = menu.getBoundingClientRect();
        const roomBelow = window.innerHeight - anchor.bottom;
        menu.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`;
        menu.style.top = `${roomBelow >= height + 12 ? anchor.bottom + 4 : Math.max(8, anchor.top - height - 4)}px`;
      }
      return;
    }
    const menu = /** @type {HTMLElement | null} */ (target.closest(".gb-todo-row-options:popover-open"));
    menu?.hidePopover();
    const goto = target.closest("[data-todo-goto]");
    if (goto) {
      event.preventDefault();
      const toolId = goto.getAttribute("data-todo-goto");
      if (toolId) window.dispatchEvent(new CustomEvent("glassbox:open-tool", { detail: { toolId } }));
      return;
    }
    const edit = target.closest("[data-todo-edit]");
    if (edit) {
      const row = edit.closest(".gb-todo-item");
      const id = row?.getAttribute("data-id") || "";
      const reportId = row?.getAttribute("data-report") || "";
      const item = sharedItems.find((entry) => entry.id === id) || (reportId ? itemForReport(reportId) : null);
      const current = item || (reportId ? starterForReport(reportId) : null);
      if (!current) return;
      editTask(current, { itemId: item?.id, toolId: reportId });
      return;
    }
    const remove = target.closest("[data-todo-delete]");
    if (!remove) return;
    const row = remove.closest(".gb-todo-item");
    const id = row?.getAttribute("data-id") || "";
    const reportId = row?.getAttribute("data-report") || "";
    const item = sharedItems.find((entry) => entry.id === id) || (reportId ? itemForReport(reportId) : null);
    if (!item) {
      note = "Open Edit and save that report once. Then Delete removes it for everyone.";
      paint();
      return;
    }
    const ok = await confirmDialog(`Delete “${item.text}”?`, {
      title: "Delete to-do",
      okLabel: "Delete",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const payload = await rackJson(`/api/todos/items?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        signal: opts.signal,
      });
      if (typeof payload.rev === "number") rev = payload.rev;
      if (Array.isArray(payload.items)) sharedItems = payload.items;
      else sharedItems = sharedItems.filter((entry) => entry.id !== item.id);
      note = "";
    } catch (error) {
      note = error instanceof Error ? error.message : "That to-do was not deleted.";
    }
    paint();
  });

  window.addEventListener(
    "glassbox:date-selected",
    (event) => {
      const detail = /** @type {CustomEvent} */ (event).detail;
      const day = detail && typeof detail.day === "string" ? detail.day : null;
      if (!day) return;
      viewDay = day;
      paint();
    },
    { signal: opts.signal }
  );

  const onMaybeNewDay = () => {
    const wasViewingToday = viewDay === realDay;
    if (!refreshDailyBucket()) return;
    if (wasViewingToday) viewDay = realDay;
    paint();
  };
  window.addEventListener("focus", onMaybeNewDay, { signal: opts.signal });
  document.addEventListener("visibilitychange", onMaybeNewDay, { signal: opts.signal });
  const dayTimer = window.setInterval(onMaybeNewDay, 60_000);
  opts.signal?.addEventListener("abort", () => {
    window.clearInterval(dayTimer);
    stopWatch();
  });

  scheduledDone = Object.fromEntries(
    Object.entries(scheduledDone).filter(([key]) => !DAILY_IDS.has(reportIdFromDueKey(key)))
  );
  saveScheduledDone(scheduledDone);

  paint();
  void loadBoards();
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
