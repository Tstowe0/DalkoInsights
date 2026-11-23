/**
 * Smart due dates for Glass Box Client Reports.
 * Weekend rule: if a fixed calendar due date falls on Sat/Sun, roll to next Monday.
 */

/**
 * @typedef {"daily" | "weekday" | "monthDay" | "nthWeekday"} ReportSchedule
 * @typedef {{ id: string, label: string, schedule: ReportSchedule, weekday?: number, day?: number, nth?: number }} ScheduledReport
 * @typedef {{ id: string, label: string, due: Date, dueKey: string, scheduleLabel: string }} DueReport
 */

/** JS getDay(): Sun=0 … Sat=6 */
const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const FRI = 5;

/**
 * Per-report schedule (mirrors Client Reports bands + monthly subtitles).
 * @type {ScheduledReport[]}
 */
/** @type {ScheduledReport[]} */
let activeReports = [];

/**
 * @param {ScheduledReport[]} list
 */
export function replaceScheduledReports(list) {
  if (!Array.isArray(list)) return;
  /** @type {ScheduledReport[]} */
  const next = [];
  for (const item of list) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.includes("|")) continue;
    const schedule = item.schedule;
    if (schedule !== "daily" && schedule !== "weekday" && schedule !== "monthDay" && schedule !== "nthWeekday") continue;
    next.push({
      id: item.id,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : item.id,
      schedule,
      weekday: Number.isInteger(item.weekday) ? item.weekday : undefined,
      day: Number.isInteger(item.day) ? item.day : undefined,
      nth: Number.isInteger(item.nth) ? item.nth : undefined,
    });
  }
  activeReports = next;
}

export const SCHEDULED_REPORTS = [
  { id: "McConway Daily Tracking Report", label: "McConway Daily Tracking Report", schedule: "daily" },
  { id: "Penn Machine Daily Tracking Report", label: "Penn Machine Daily Tracking Report", schedule: "daily" },
  { id: "Vet-Pet Daily Shipment Report", label: "Vet-Pet Daily Shipment Report", schedule: "daily" },
  { id: "Phinia Weekly", label: "Phinia Weekly", schedule: "weekday", weekday: MON },
  { id: "Quality Turbocharger Weekly", label: "Quality Turbocharger Weekly", schedule: "weekday", weekday: MON },
  { id: "DATs Weekly Upload", label: "DATs Weekly Upload", schedule: "weekday", weekday: THU },
  { id: "Kansas Canadian Pacific Weekly", label: "Kansas Canadian Pacific Weekly", schedule: "weekday", weekday: FRI },
  { id: "FCA Active Shipments", label: "FCA Active Shipments", schedule: "weekday", weekday: FRI },
  { id: "UTLXA Monthly", label: "UTLXA Monthly", schedule: "monthDay", day: 1 },
  { id: "Marmon Monthly", label: "Marmon Monthly", schedule: "monthDay", day: 1 },
  { id: "Maddox Monthly", label: "Maddox Monthly", schedule: "nthWeekday", nth: 2, weekday: TUE },
  { id: "Miraclon and Bruss Monthly", label: "Miraclon and Bruss Monthly", schedule: "monthDay", day: 15 },
  { id: "TTX Accessorial Report", label: "TTX Accessorial Report", schedule: "nthWeekday", nth: 2, weekday: WED },
  { id: "Carrier On Time Merger", label: "TTX On Time", schedule: "nthWeekday", nth: 2, weekday: WED },
];

activeReports = SCHEDULED_REPORTS.map((report) => ({ ...report }));

/** @param {Date} date */
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** @param {Date} date */
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** @param {Date} a @param {Date} b */
export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * If date is Sat/Sun, move to the following Monday.
 * @param {Date} date
 */
export function rollWeekendToMonday(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2); // Sat → Mon
  else if (day === 0) d.setDate(d.getDate() + 1); // Sun → Mon
  return d;
}

/**
 * Nth weekday of a month (e.g. 2nd Tuesday).
 * @param {number} year
 * @param {number} month 0-based
 * @param {number} weekday 0-6
 * @param {number} nth 1-based
 */
export function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = new Date(year, month, 1);
  const delta = (weekday - first.getDay() + 7) % 7;
  const day = 1 + delta + (nth - 1) * 7;
  return new Date(year, month, day);
}

/**
 * Due date for a report in the month of `ref` (for month-scoped schedules),
 * or the occurrence on/near `ref` for weekly/daily.
 * @param {ScheduledReport} report
 * @param {Date} [ref]
 */
export function dueDateFor(report, ref = new Date()) {
  const today = startOfDay(ref);
  const y = today.getFullYear();
  const m = today.getMonth();

  switch (report.schedule) {
    case "daily": {
      // Weekdays only; weekend work rolls to Monday
      return rollWeekendToMonday(today);
    }
    case "weekday": {
      const target = report.weekday ?? MON;
      const due = new Date(today);
      const delta = (target - due.getDay() + 7) % 7;
      due.setDate(due.getDate() + delta);
      return due; // already a weekday
    }
    case "monthDay": {
      const day = report.day ?? 1;
      return rollWeekendToMonday(new Date(y, m, day));
    }
    case "nthWeekday": {
      return nthWeekdayOfMonth(y, m, report.weekday ?? TUE, report.nth ?? 2);
    }
    default:
      return today;
  }
}

/** @param {ScheduledReport} report */
export function scheduleLabel(report) {
  switch (report.schedule) {
    case "daily":
      return "Daily";
    case "weekday": {
      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return names[report.weekday ?? MON] ?? "Weekly";
    }
    case "monthDay":
      return report.day === 1 ? "1st of the month" : `${report.day}th of the month`;
    case "nthWeekday": {
      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const nth = report.nth ?? 2;
      const ordinal = nth === 1 ? "1st" : nth === 2 ? "2nd" : nth === 3 ? "3rd" : `${nth}th`;
      const dayName = names[report.weekday ?? TUE] ?? "weekday";
      return `${ordinal} ${dayName}`;
    }
    default:
      return "Scheduled";
  }
}

/**
 * Reports whose smart due date is today.
 * @param {Date} [ref]
 * @returns {DueReport[]}
 */
export function getReportsDueToday(ref = new Date()) {
  const today = startOfDay(ref);
  /** @type {DueReport[]} */
  const due = [];

  for (const report of activeReports) {
    // Daily reports run Mon–Fri only (weekends are not work days).
    if (report.schedule === "daily") {
      const dow = today.getDay();
      if (dow === 0 || dow === 6) continue;
    }

    const dueDate = dueDateFor(report, today);
    if (!sameDay(dueDate, today)) continue;

    due.push({
      id: report.id,
      label: report.label,
      due: dueDate,
      dueKey: `${report.id}|${toDateKey(dueDate)}`,
      scheduleLabel: scheduleLabel(report),
    });
  }

  return due;
}

/**
 * Day-of-month numbers in a given month that have at least one to-do due.
 * Before the shared list loads, the built-in report schedule is used.
 * @param {number} year
 * @param {number} month 0-based
 * @returns {Set<number>}
 */
export function getDueDaySetForMonth(year, month) {
  /** @type {Set<number>} */
  const days = new Set();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (liveItems) {
    for (let day = 1; day <= daysInMonth; day++) {
      const key = toDateKey(new Date(year, month, day));
      if (liveItems.some((item) => occursOnTodo(item, key))) days.add(day);
    }
    return days;
  }
  for (let day = 1; day <= daysInMonth; day++) {
    if (getReportsDueToday(new Date(year, month, day)).length) days.add(day);
  }
  return days;
}

/** @param {string} key */
function weekdayOfKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

/**
 * @param {{ due?: string, repeat?: string, weekday?: number, nth?: number }} item
 * @param {string} day
 */
export function occursOnTodo(item, day) {
  const due = item && item.due ? String(item.due) : "";
  if (!due || day < due) return false;
  const repeat = item.repeat || "none";
  if (repeat === "daily") return true;
  if (repeat === "weekly") return weekdayOfKey(day) === weekdayOfKey(due);
  if (repeat === "monthly") {
    const [year, month, date] = day.split("-").map(Number);
    const last = new Date(year, month, 0).getDate();
    return date === Math.min(Number(due.slice(8, 10)), last);
  }
  if (repeat === "nthweekday") {
    const [year, month, date] = day.split("-").map(Number);
    const weekday = Number.isInteger(item.weekday) ? item.weekday : weekdayOfKey(due);
    const nth = Number.isInteger(item.nth) ? item.nth : 1;
    const first = new Date(year, month - 1, 1);
    const delta = (weekday - first.getDay() + 7) % 7;
    const dom = 1 + delta + (nth - 1) * 7;
    const last = new Date(year, month, 0).getDate();
    return dom <= last && date === dom;
  }
  return day === due;
}

/** @type {Array<{ due?: string, repeat?: string, weekday?: number, nth?: number }> | null} */
let liveItems = null;

/** @param {Array<{ due?: string, repeat?: string, weekday?: number, nth?: number }> | null} items */
export function replaceTodoItems(items) {
  liveItems = Array.isArray(items) ? items : null;
}
