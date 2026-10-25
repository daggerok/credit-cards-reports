/// <reference lib="esnext" />
// A parsed statement -> what to pay and by when: the two scenarios of every report and the upcoming due dates.
import type { Cents, Statement } from './parser';

export function formatMoney(cents: Cents | null): string {
  if (cents === null) return '-';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${cents < 0 ? '-' : ''}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** "2026-11-04" -> "Nov 04, 2026" (the way the statements print it). */
export function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

/** Today in the viewer's time zone as yyyy-mm-dd. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from `from` to `to` (both yyyy-mm-dd); negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "Chase Freedom Unlimited ·1715" (Apple Card prints no card number). */
export function cardLabel(s: Pick<Statement, 'bank' | 'card' | 'last4'>): string {
  const name = s.card.toLowerCase().startsWith(s.bank.toLowerCase()) ? s.card : `${s.bank} ${s.card}`;
  return s.last4 ? `${name} ·${s.last4}` : name;
}

export type Scenarios = { lateFee: string; interest: string; nextPeriod: string };

/**
 * Scenario 1: the minimum by the due date (no Late Fee). Scenario 2: the statement balance by the due date (no interest).
 * A field the PDF did not give is a warning to check the statement, never "nothing to pay".
 */
export function scenarios(s: Statement): Scenarios {
  const due = s.dueDate ? formatDate(s.dueDate) : 'Payment Due Date (дата не найдена в PDF)';
  const lateFee = s.minimumPayment === null
    ? `⚠ Minimum Payment Due не найден в PDF: проверь его в выписке и внеси до ${due}.`
    : s.minimumPayment > 0
      ? `Чтобы избежать Late Fee, внеси минимум ${formatMoney(s.minimumPayment)} до ${due}.`
      : 'Платеж не требуется, Late Fee не грозит.';
  const interest = s.statementBalance === null
    ? `⚠ Statement Balance не найден в PDF: проверь его в выписке и внеси полностью до ${due}.`
    : s.statementBalance > 0
      ? `Чтобы не платить проценты, внеси полный Statement Balance ${formatMoney(s.statementBalance)} до ${due}.`
      : `Statement Balance ${formatMoney(s.statementBalance)}: гасить нечего, проценты не начисляются.`;
  const nextPeriod = `Покупки, сделанные после ${formatDate(s.closingDate)}, входят в следующий период и гасить их сейчас не нужно.`;
  return { lateFee, interest, nextPeriod };
}

export type RemindAmount = 'balance' | 'minimum';

/** The amount a reminder asks for: the statement balance, or the minimum when chosen and above 0; null = nothing to pay. */
export function reminderAmount(s: Statement, mode: RemindAmount): Cents | null {
  const amount = mode === 'minimum' && (s.minimumPayment ?? 0) > 0 ? s.minimumPayment : s.statementBalance;
  return amount !== null && amount > 0 && s.dueDate ? amount : null;
}

/** The fields not found in the PDF that keep a statement out of the reminders (empty when nothing is missing). */
export function reminderMissing(s: Statement, mode: RemindAmount): string[] {
  const missing: string[] = [];
  if (!s.dueDate) missing.push('Payment Due Date');
  const fromMinimum = mode === 'minimum' && (s.minimumPayment ?? 0) > 0;
  if (!fromMinimum && s.statementBalance === null) missing.push('Statement Balance');
  return missing;
}

/** Due today or later; false for a statement whose due date was not found. */
export const isAhead = (s: Statement, today: string): boolean => !!s.dueDate && s.dueDate >= today;

/**
 * Statements whose due date was not found first (the date is unknown, so they may be due soon), then the due
 * dates ahead, nearest first, then the past ones, most recent first.
 */
export function upcoming(statements: Statement[], today: string): Statement[] {
  const undated = statements.filter(s => !s.dueDate);
  const ahead = statements.filter(s => isAhead(s, today)).sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string));
  const past = statements.filter(s => !!s.dueDate && s.dueDate < today).sort((a, b) => (b.dueDate as string).localeCompare(a.dueDate as string));
  return [...undated, ...ahead, ...past];
}

/**
 * The sum of a field over the statements due today or later. `unknown` counts the statements the sum cannot
 * include: due ahead with the field not found, or with no due date and the field not found or above 0.
 */
export function dueTotal(statements: Statement[], key: 'statementBalance' | 'minimumPayment', today: string): { cents: Cents; unknown: number } {
  let cents = 0;
  let unknown = 0;
  for (const s of statements) {
    const value = s[key];
    if (!s.dueDate) { if (value === null || value > 0) unknown += 1; }
    else if (s.dueDate < today) continue;
    else if (value === null) unknown += 1;
    else cents += Math.max(0, value);
  }
  return { cents, unknown };
}
