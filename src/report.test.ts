/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { FIXTURES } from './fixtures';
import { parseStatement } from './parser';
import { cardLabel, daysBetween, dueTotal, formatDate, formatMoney, reminderAmount, reminderMissing, scenarios, upcoming } from './report';

const chase = parseStatement('chase.pdf', FIXTURES.chase);

describe('formatting', () => {
  test('money and dates', () => {
    expect(formatMoney(148582)).toBe('$1,485.82');
    expect(formatMoney(-157)).toBe('-$1.57');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(null)).toBe('-');
    expect(formatDate('2026-11-04')).toBe('Nov 04, 2026');
    expect(daysBetween('2026-10-18', '2026-11-01')).toBe(14);
    expect(daysBetween('2026-10-18', '2026-10-17')).toBe(-1);
  });

  test('card labels', () => {
    expect(cardLabel(chase)).toBe('Chase Freedom Unlimited ·1234');
    expect(cardLabel(parseStatement('citi.pdf', FIXTURES.citi))).toBe('Citi Custom Cash Card ·2222');
    expect(cardLabel(parseStatement('apple.pdf', FIXTURES.apple))).toBe('Apple Card');
  });
});

describe('scenarios', () => {
  test('scenario 1 (minimum) and scenario 2 (statement balance)', () => {
    expect(scenarios(chase)).toEqual({
      lateFee: 'Чтобы избежать Late Fee, внеси минимум $40.00 до Nov 01, 2026.',
      interest: 'Чтобы не платить проценты, внеси полный Statement Balance $164.00 до Nov 01, 2026.',
      nextPeriod: 'Покупки, сделанные после Oct 04, 2026, входят в следующий период и гасить их сейчас не нужно.',
    });
  });

  test('a $0.00 minimum: no payment needed', () => {
    const s = { ...chase, minimumPayment: 0, statementBalance: -500 };
    expect(scenarios(s).lateFee).toBe('Платеж не требуется, Late Fee не грозит.');
    expect(scenarios(s).interest).toBe('Statement Balance -$5.00: гасить нечего, проценты не начисляются.');
  });

  test('a minimum or a balance not found in the PDF: a warning to check it, never "nothing to pay"', () => {
    const s = { ...chase, minimumPayment: null, statementBalance: null };
    expect(scenarios(s).lateFee).toBe('⚠ Minimum Payment Due не найден в PDF: проверь его в выписке и внеси до Nov 01, 2026.');
    expect(scenarios(s).interest).toBe('⚠ Statement Balance не найден в PDF: проверь его в выписке и внеси полностью до Nov 01, 2026.');
    expect(scenarios({ ...chase, minimumPayment: null }).interest).toBe('Чтобы не платить проценты, внеси полный Statement Balance $164.00 до Nov 01, 2026.');
  });

  test('a due date not found in the PDF: the scenarios say so instead of "до -"', () => {
    const s = { ...chase, dueDate: null };
    expect(scenarios(s).lateFee).toBe('Чтобы избежать Late Fee, внеси минимум $40.00 до Payment Due Date (дата не найдена в PDF).');
    expect(scenarios({ ...s, minimumPayment: null }).lateFee).toBe('⚠ Minimum Payment Due не найден в PDF: проверь его в выписке и внеси до Payment Due Date (дата не найдена в PDF).');
  });
});

describe('reminders and the upcoming list', () => {
  test('the reminder amount follows the chosen mode, null when nothing is due', () => {
    expect(reminderAmount(chase, 'balance')).toBe(16400);
    expect(reminderAmount(chase, 'minimum')).toBe(4000);
    expect(reminderAmount({ ...chase, minimumPayment: 0 }, 'minimum')).toBe(16400);
    expect(reminderAmount({ ...chase, statementBalance: 0, minimumPayment: 0 }, 'balance')).toBeNull();
  });

  test('nearest due date first, past ones last', () => {
    const list = [
      { ...chase, fileName: 'past', dueDate: '2026-10-01' },
      { ...chase, fileName: 'later', dueDate: '2026-11-20' },
      { ...chase, fileName: 'soon', dueDate: '2026-10-20' },
      { ...chase, fileName: 'none', dueDate: null },
    ];
    expect(upcoming(list, '2026-10-18').map(s => s.fileName)).toEqual(['none', 'soon', 'later', 'past']);
  });

  test('why a statement gets no reminder: the due date or the amount not found', () => {
    expect(reminderMissing(chase, 'balance')).toEqual([]);
    expect(reminderMissing({ ...chase, statementBalance: 0 }, 'balance')).toEqual([]);
    expect(reminderMissing({ ...chase, dueDate: null }, 'balance')).toEqual(['Payment Due Date']);
    expect(reminderMissing({ ...chase, statementBalance: null }, 'balance')).toEqual(['Statement Balance']);
    expect(reminderMissing({ ...chase, statementBalance: null }, 'minimum')).toEqual([]);
    expect(reminderMissing({ ...chase, statementBalance: null, minimumPayment: null, dueDate: null }, 'minimum')).toEqual(['Payment Due Date', 'Statement Balance']);
  });

  test('totals due ahead: an amount or a due date not found makes them incomplete', () => {
    const today = '2026-10-18';
    const list = [
      { ...chase, dueDate: '2026-11-01', statementBalance: 16400, minimumPayment: 4000 },
      { ...chase, dueDate: '2026-11-05', statementBalance: 10000, minimumPayment: null },
      { ...chase, dueDate: '2026-10-01', statementBalance: null, minimumPayment: null },
      { ...chase, dueDate: null, statementBalance: 500, minimumPayment: 0 },
    ];
    expect(dueTotal(list, 'statementBalance', today)).toEqual({ cents: 26400, unknown: 1 });
    expect(dueTotal(list, 'minimumPayment', today)).toEqual({ cents: 4000, unknown: 1 });
    expect(dueTotal(list.slice(0, 1), 'minimumPayment', today)).toEqual({ cents: 4000, unknown: 0 });
    expect(dueTotal([{ ...chase, dueDate: null, statementBalance: -100 }], 'statementBalance', today)).toEqual({ cents: 0, unknown: 0 });
  });
});
