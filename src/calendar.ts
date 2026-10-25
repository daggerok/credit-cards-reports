// Payment reminders: an .ics file (RFC 5545, one all-day event on the Payment Due Date with alarms at 09:00
// 3 days and 1 day before it) and links for Google Calendar and Outlook.com. A link cannot carry alarms, so
// each link creates the reminder itself: an event at 09:00 on the day 3 days (or 1 day) before the due date.
import type { Statement } from './parser';
import { cardLabel, formatDate, formatMoney, reminderAmount, scenarios, type RemindAmount } from './report';

export const REMIND_DAYS_BEFORE = [3, 1] as const;
const REMIND_HOUR = 9;

export type Reminder = { uid: string; dueDate: string; title: string; details: string };

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Starts the title (and the notes) of a reminder built from an UNVERIFIED statement. */
export const UNVERIFIED_MARK = '⚠ ';

/** What a reminder of an unverified statement says first: the amounts may be wrong, check the PDF. */
function unverifiedNote(s: Statement): string[] {
  const v = s.verification;
  if (v.status === 'VALIDATED') return [];
  return [
    `${UNVERIFIED_MARK}PARSING ERROR / UNVERIFIED: check the amounts and dates in the statement`,
    ...(v.missing.length ? [`Not found: ${v.missing.join(', ')}`] : []),
    ...v.problems,
    ...(v.diff !== null && v.diff !== 0 ? [`Difference (PDF - calculated): ${formatMoney(v.diff)}`] : []),
    '',
  ];
}

/**
 * "Оплатить $224.57 по карте Chase Freedom Unlimited ·1715 (Due Date: Nov 01, 2026)", with "⚠ " in front and the
 * missing fields or the difference in the notes when the statement is UNVERIFIED; null when nothing is due.
 */
export function reminderFor(s: Statement, mode: RemindAmount): Reminder | null {
  const amount = reminderAmount(s, mode);
  if (amount === null || !s.dueDate) return null;
  const sc = scenarios(s);
  const mark = s.verification.status === 'VALIDATED' ? '' : UNVERIFIED_MARK;
  const title = `${mark}Оплатить ${formatMoney(amount)} по карте ${cardLabel(s)} (Due Date: ${formatDate(s.dueDate)})`;
  const details = [
    ...unverifiedNote(s),
    `Statement Balance: ${formatMoney(s.statementBalance)}`,
    `Minimum Payment Due: ${formatMoney(s.minimumPayment)}`,
    `Statement Closing Date: ${formatDate(s.closingDate)}`,
    `Payment Due Date: ${formatDate(s.dueDate)}`,
    '',
    sc.lateFee,
    sc.interest,
    sc.nextPeriod,
  ].join('\n');
  const uid = `${s.issuer}-${s.last4 || 'card'}-${s.dueDate}@credit-cards-reports`;
  return { uid, dueDate: s.dueDate, title, details };
}

// ---- .ics -------------------------------------------------------------------------------------------

const escapeText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets continue on the next line after a space (RFC 5545 3.1), never splitting a character. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

const compact = (iso: string) => iso.replace(/-/g, '');

function utcStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** "-P2DT15H": 09:00 three days before an all-day event that starts at 00:00. */
function alarmTrigger(daysBefore: number): string {
  const hours = 24 - REMIND_HOUR;
  return daysBefore > 1 ? `-P${daysBefore - 1}DT${hours}H` : `-PT${hours}H`;
}

export function buildIcs(reminders: Reminder[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//daggerok//credit-cards-reports//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const r of reminders) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.uid}`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART;VALUE=DATE:${compact(r.dueDate)}`,
      `DTEND;VALUE=DATE:${compact(addDays(r.dueDate, 1))}`,
      `SUMMARY:${escapeText(r.title)}`,
      `DESCRIPTION:${escapeText(r.details)}`,
      'TRANSP:TRANSPARENT',
    );
    for (const days of REMIND_DAYS_BEFORE) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(r.title)}`, `TRIGGER:${alarmTrigger(days)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---- links ------------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

function reminderDetails(r: Reminder, daysBefore: number): string {
  return `Напоминание за ${daysBefore} ${daysBefore === 1 ? 'день' : 'дня'} до Payment Due Date (${formatDate(r.dueDate)}).\n\n${r.details}`;
}

/** Google Calendar: a 30 minute event at 09:00 (the viewer's time zone) `daysBefore` days before the due date. */
export function googleUrl(r: Reminder, daysBefore: number): string {
  const day = compact(addDays(r.dueDate, -daysBefore));
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: r.title,
    dates: `${day}T${pad(REMIND_HOUR)}0000/${day}T${pad(REMIND_HOUR)}3000`,
    details: reminderDetails(r, daysBefore),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Outlook.com: the same event through the compose deep link. */
export function outlookUrl(r: Reminder, daysBefore: number): string {
  const day = addDays(r.dueDate, -daysBefore);
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: r.title,
    startdt: `${day}T${pad(REMIND_HOUR)}:00:00`,
    enddt: `${day}T${pad(REMIND_HOUR)}:30:00`,
    body: reminderDetails(r, daysBefore),
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}
