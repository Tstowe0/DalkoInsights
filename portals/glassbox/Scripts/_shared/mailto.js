/**
 * Open a mailto draft — matches Glass Box Python webbrowser.open(mailto:?…).
 * Recipients stay semicolon-separated (Outlook-friendly), same as desktop tools.
 */

/**
 * @typedef {object} MailDraft
 * @property {string} [to]
 * @property {string} [cc]
 * @property {string} [bcc]
 * @property {string} [subject]
 * @property {string} [body]
 * @property {string} [label] button label (default "Email")
 */

/**
 * @param {MailDraft} draft
 */
export function openMailDraft(draft) {
  const parts = [];
  if (draft.to) parts.push(`to=${encodeURIComponent(draft.to)}`);
  if (draft.cc) parts.push(`cc=${encodeURIComponent(draft.cc)}`);
  if (draft.bcc) parts.push(`bcc=${encodeURIComponent(draft.bcc)}`);
  if (draft.subject) parts.push(`subject=${encodeURIComponent(draft.subject)}`);
  if (draft.body) parts.push(`body=${encodeURIComponent(draft.body)}`);
  const href = `mailto:?${parts.join("&")}`;
  // Prefer location.assign so default mail client handles it (same idea as webbrowser.open)
  window.location.href = href;
}

/** @param {number} n */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/** @param {Date} d @param {string} [sep] */
export function fmtSlashMDY(d, sep = "/") {
  return `${pad2(d.getMonth() + 1)}${sep}${pad2(d.getDate())}${sep}${d.getFullYear()}`;
}

/** @param {Date} d */
export function fmtDotMDY(d) {
  return fmtSlashMDY(d, ".");
}

/** Previous calendar month name + year (Maddox / UTLXA / Miraclon). */
export function prevMonthNameYear(ref = new Date()) {
  const firstThis = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const lastPrev = new Date(firstThis.getTime() - 86400000);
  return {
    monthName: lastPrev.toLocaleString("en-US", { month: "long" }),
    monthYear: String(lastPrev.getFullYear()),
  };
}

/** Last week's Monday–Friday (Phinia). */
export function prevMondayFriday(ref = new Date()) {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const thisMonday = new Date(d);
  thisMonday.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday of current week
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(thisMonday.getDate() - 7);
  const prevFriday = new Date(prevMonday);
  prevFriday.setDate(prevMonday.getDate() + 4);
  return { monday: prevMonday, friday: prevFriday };
}

/**
 * CPKC subject window: previous week's Friday → this week's Thursday
 * (ported from Kansas Canadian Pacific Weekly.py).
 */
export function cpkcFridayThursday(ref = new Date()) {
  const today = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const daysSinceThursday = (today.getDay() + 4) % 7; // JS: Sun=0 … Thu matches Python weekday+4 % 7 with Thu=3
  // Python: days_since_thursday = (today.weekday() + 4) % 7  where Mon=0 … Thu=3
  // JS getDay: Sun=0 Mon=1 … Thu=4. Map JS→Python weekday: (getDay()+6)%7
  const pyWeekday = (today.getDay() + 6) % 7;
  const sinceThu = (pyWeekday + 4) % 7;
  const thisWeeksThursday = new Date(today);
  if (sinceThu !== 0) thisWeeksThursday.setDate(today.getDate() - sinceThu);

  const daysFromMonday = (thisWeeksThursday.getDay() + 6) % 7; // Python weekday of Thursday = 3
  const thisWeeksMonday = new Date(thisWeeksThursday);
  thisWeeksMonday.setDate(thisWeeksThursday.getDate() - daysFromMonday);
  const thisWeeksFriday = new Date(thisWeeksMonday);
  thisWeeksFriday.setDate(thisWeeksMonday.getDate() + 4);
  const previousFriday = new Date(thisWeeksFriday);
  previousFriday.setDate(thisWeeksFriday.getDate() - 7);

  return { friday: previousFriday, thursday: thisWeeksThursday };
}
