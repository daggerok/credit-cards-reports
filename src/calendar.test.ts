/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { addDays, buildIcs, googleUrl, outlookUrl, reminderFor } from './calendar';
import { FIXTURES } from './fixtures';
import { parseStatement, verify } from './parser';

const chase = parseStatement('chase.pdf', FIXTURES.chase);
const reminder = reminderFor(chase, 'balance');
if (!reminder) throw new Error('the Chase fixture has a balance to pay');

describe('reminder text', () => {
  test('the event title of the spec', () => {
    expect(reminder.title).toBe('Оплатить $164.00 по карте Chase Freedom Unlimited ·1234 (Due Date: Nov 01, 2026)');
    expect(reminderFor(chase, 'minimum')?.title).toBe('Оплатить $40.00 по карте Chase Freedom Unlimited ·1234 (Due Date: Nov 01, 2026)');
    expect(reminderFor({ ...chase, statementBalance: 0 }, 'balance')).toBeNull();
  });

  test('an UNVERIFIED statement: a warning in the title and what is wrong in the notes', () => {
    expect(reminder.details).not.toContain('UNVERIFIED');
    const diff = parseStatement('chase.pdf', FIXTURES.chase.replace('New Balance  $164.00', 'New Balance  $174.00').replace('New Balance:  $164.00', 'New Balance:  $174.00'));
    const r1 = reminderFor(diff, 'balance');
    expect(r1?.title).toBe('⚠ Оплатить $174.00 по карте Chase Freedom Unlimited ·1234 (Due Date: Nov 01, 2026)');
    expect(r1?.details).toStartWith('⚠ PARSING ERROR / UNVERIFIED: check the amounts and dates in the statement\nDifference (PDF - calculated): $10.00\n\nStatement Balance: $174.00');
    const noMinimum = { ...chase, minimumPayment: null, verification: verify({ ...chase, minimumPayment: null }) };
    expect(noMinimum.verification.status).toBe('UNVERIFIED');
    const r2 = reminderFor(noMinimum, 'minimum');
    expect(r2?.title).toStartWith('⚠ Оплатить $164.00 по карте');
    expect(r2?.details).toContain('Not found: Minimum Payment Due\n');
    expect(r2?.details).toContain('⚠ Minimum Payment Due не найден в PDF');
    const apple = parseStatement('apple.pdf', FIXTURES.apple.replace('$900.00  $25.00', '$950.00  $25.00'));
    expect(reminderFor(apple, 'balance')?.details).toStartWith('⚠ PARSING ERROR / UNVERIFIED: check the amounts and dates in the statement\nStatement Balance is outside $0.00 to the New Balance\n\n');
  });

  test('addDays crosses months and years', () => {
    expect(addDays('2026-11-01', -3)).toBe('2026-10-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('.ics', () => {
  const ics = buildIcs([reminder], new Date('2026-10-18T12:00:00Z'));
  const unfolded = ics.replace(/\r\n /g, '');

  test('an all-day event on the due date with alarms at 09:00 3 days and 1 day before', () => {
    expect(unfolded).toContain('DTSTART;VALUE=DATE:20261101\r\n');
    expect(unfolded).toContain('DTEND;VALUE=DATE:20261102\r\n');
    expect(unfolded.match(/TRIGGER:[^\r]+/g)).toEqual(['TRIGGER:-P2DT15H', 'TRIGGER:-PT15H']);
    expect(unfolded).toContain('DTSTAMP:20261018T120000Z\r\n');
    expect(unfolded).toContain('UID:chase-1234-2026-11-01@credit-cards-reports\r\n');
  });

  test('text is escaped and lines are folded at 75 octets', () => {
    expect(unfolded).toContain('SUMMARY:Оплатить $164.00 по карте Chase Freedom Unlimited ·1234 (Due Date: Nov 01\\, 2026)');
    expect(unfolded).toContain('Minimum Payment Due: $40.00\\n');
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  test('one file holds every reminder', () => {
    const other = reminderFor(parseStatement('amex.pdf', FIXTURES.amex), 'balance');
    if (!other) throw new Error('the Amex fixture has a balance to pay');
    expect(buildIcs([reminder, other]).match(/BEGIN:VEVENT/g)?.length).toBe(2);
  });
});

describe('links', () => {
  test('Google: an event at 09:00 on the reminder day', () => {
    const url = new URL(googleUrl(reminder, 3));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20261029T090000/20261029T093000');
    expect(url.searchParams.get('text')).toBe(reminder.title);
    expect(url.searchParams.get('details')).toStartWith('Напоминание за 3 дня до Payment Due Date (Nov 01, 2026).');
  });

  test('Outlook.com: the same day, 1 day before', () => {
    const url = new URL(outlookUrl(reminder, 1));
    expect(url.searchParams.get('startdt')).toBe('2026-10-31T09:00:00');
    expect(url.searchParams.get('enddt')).toBe('2026-10-31T09:30:00');
    expect(url.searchParams.get('subject')).toBe(reminder.title);
    expect(url.searchParams.get('body')).toStartWith('Напоминание за 1 день');
  });
});
