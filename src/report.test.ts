/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { FIXTURES } from './fixtures';
import { parseStatement } from './parser';
import { cardLabel, daysBetween, formatDate, formatMoney, reminderAmount, scenarios, upcoming } from './report';

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
    expect(upcoming(list, '2026-10-18').map(s => s.fileName)).toEqual(['soon', 'later', 'past']);
  });
});
