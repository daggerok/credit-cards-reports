/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { FIXTURES } from './fixtures';
import { detectIssuer, parseDate, parseMoney, parseStatement, UnknownIssuerError, verify, type IssuerId } from './parser';

describe('parseMoney', () => {
  test('signs, spaces, thousands and parentheses', () => {
    expect(parseMoney('$1,485.82')).toBe(148582);
    expect(parseMoney('-$1.57')).toBe(-157);
    expect(parseMoney('- $340.00')).toBe(-34000);
    expect(parseMoney('+ $0.00')).toBe(0);
    expect(parseMoney('+$120.46')).toBe(12046);
    expect(parseMoney('($5.00)')).toBe(-500);
    expect(parseMoney('$12')).toBeNull();
  });
});

describe('parseDate', () => {
  test('numeric and month name dates', () => {
    expect(parseDate('11/01/26')).toBe('2026-11-01');
    expect(parseDate('07/16/2026')).toBe('2026-07-16');
    expect(parseDate('Nov 04, 2026')).toBe('2026-11-04');
    expect(parseDate('November 9, 2026')).toBe('2026-11-09');
    expect(parseDate('Feb 30, 2026')).toBeNull();
    expect(parseDate('13/01/26')).toBeNull();
  });
});

type Expected = { issuer: IssuerId; bank: string; card: string; last4: string; closing: string; due: string; values: number[] };

// values: previous, payments, purchases, fees, interest, new balance, minimum, statement balance (cents)
const EXPECTED: Record<keyof typeof FIXTURES, Expected> = {
  chase: { issuer: 'chase', bank: 'Chase', card: 'Freedom Unlimited', last4: '1234', closing: '2026-10-04', due: '2026-11-01', values: [1234, 10000, 25050, 0, 116, 16400, 4000, 16400] },
  capitalOne: { issuer: 'capital-one', bank: 'Capital One', card: 'Savor', last4: '1111', closing: '2026-10-10', due: '2026-11-04', values: [5000, 5500, 30500, 0, 0, 30000, 2500, 30000] },
  citi: { issuer: 'citi', bank: 'Citi', card: 'Citi Custom Cash Card', last4: '2222', closing: '2026-07-03', due: '2026-08-01', values: [10000, 10200, 12200, 0, 0, 12000, 4100, 12000] },
  bofa: { issuer: 'bofa', bank: 'Bank of America', card: 'Visa Signature', last4: '3333', closing: '2026-06-19', due: '2026-07-16', values: [-200, 3000, 4200, 0, 0, 1000, 1000, 1000] },
  bofaDateBelow: { issuer: 'bofa', bank: 'Bank of America', card: 'Visa Signature', last4: '3333', closing: '2026-06-19', due: '2026-07-16', values: [-200, 3000, 4200, 0, 0, 1000, 1000, 1000] },
  bofaPeriodOnly: { issuer: 'bofa', bank: 'Bank of America', card: 'Visa Signature', last4: '3333', closing: '2026-06-19', due: '2026-07-16', values: [-200, 3000, 4200, 0, 0, 1000, 1000, 1000] },
  amex: { issuer: 'amex', bank: 'American Express', card: 'Blue Cash Everyday', last4: '4444', closing: '2026-05-07', due: '2026-06-01', values: [0, 50000, 51500, 0, 0, 1500, 1500, 1500] },
  apple: { issuer: 'apple', bank: 'Apple', card: 'Apple Card', last4: '', closing: '2026-02-28', due: '2026-03-31', values: [10000, 20000, 100000, 0, 0, 90000, 2500, 90000] },
};

describe('parseStatement: one layout per issuer', () => {
  for (const [name, text] of Object.entries(FIXTURES) as [keyof typeof FIXTURES, string][]) {
    test(`${name}: every field and VALIDATED`, () => {
      const s = parseStatement(`${name}.pdf`, text);
      const e = EXPECTED[name];
      expect({ issuer: s.issuer, bank: s.bank, card: s.card, last4: s.last4, closing: s.closingDate, due: s.dueDate })
        .toEqual({ issuer: e.issuer, bank: e.bank, card: e.card, last4: e.last4, closing: e.closing, due: e.due });
      expect<unknown[]>([s.previousBalance, s.payments, s.purchases, s.fees, s.interest, s.newBalance, s.minimumPayment, s.statementBalance]).toEqual(e.values);
      expect(s.verification).toEqual({ status: 'VALIDATED', calculated: e.values[5], diff: 0, missing: [], problems: [] });
    });
  }

  test('every hit points at the line it came from', () => {
    const s = parseStatement('chase.pdf', FIXTURES.chase);
    const lines = FIXTURES.chase.split('\n');
    for (const hits of Object.values(s.hits)) for (const h of hits) if (h.line) expect(lines[h.line - 1]).toContain(h.text.split(' | ').pop() as string);
    expect(lines[(s.dateHits.dueDate?.line ?? 0) - 1]).toContain('11/01/26');
  });

  test('BofA: the purchases amount one line above its label', () => {
    const hit = parseStatement('bofa.pdf', FIXTURES.bofa).hits.purchases[0];
    expect(hit).toMatchObject({ part: 'Purchases and Adjustments', cents: 4200 });
    expect(hit.text).toBe('Purchases and Adjustments | $42.00  Payment Due Date  07/16/2026');
  });

  test('BofA closing date: the label line first, then the date on the line below, then the end of the period', () => {
    const lineOf = (text: string, n: number) => text.split('\n')[n - 1];
    const same = parseStatement('bofa.pdf', FIXTURES.bofa).dateHits.closingDate;
    expect(same).toMatchObject({ iso: '2026-06-19', text: 'Statement Closing Date  06/19/2026' });
    expect(lineOf(FIXTURES.bofa, same?.line ?? 0)).toBe('Statement Closing Date  06/19/2026');
    const below = parseStatement('bofa.pdf', FIXTURES.bofaDateBelow).dateHits.closingDate;
    expect(below).toMatchObject({ iso: '2026-06-19', text: 'Statement Closing Date  If you make no additional  You will payoff the  And you will end up | 06/19/2026' });
    expect(lineOf(FIXTURES.bofaDateBelow, below?.line ?? 0)).toBe('06/19/2026');
    const period = parseStatement('bofa.pdf', FIXTURES.bofaPeriodOnly).dateHits.closingDate;
    expect(period).toMatchObject({ iso: '2026-06-19', text: 'May 20 - June 19, 2026' });
    expect(lineOf(FIXTURES.bofaPeriodOnly, period?.line ?? 0)).toBe('May 20 - June 19, 2026');
  });

  test('BofA: a line under the label that does not start with a date is never taken', () => {
    const text = FIXTURES.bofaDateBelow.replace('\n06/19/2026\n', '\nsee 06/19/2026\n').replace('May 20 - June 19, 2026', 'Billing cycle');
    const s = parseStatement('bofa.pdf', text);
    expect(s.closingDate).toBeNull();
    expect(s.verification.status).toBe('UNVERIFIED');
  });

  test('optional parts missing from the statement count as 0', () => {
    const s = parseStatement('bofa.pdf', FIXTURES.bofa);
    expect(s.hits.purchases.slice(1).map(h => [h.part, h.cents, h.note])).toEqual([
      ['Balance Transfers', 0, 'not on the statement: 0'],
      ['Cash Advances', 0, 'not on the statement: 0'],
    ]);
  });

  test('the page 1 summary wins over later pages (Capital One rewards "Previous Balance")', () => {
    expect(parseStatement('c1.pdf', FIXTURES.capitalOne).previousBalance).toBe(5000);
  });
});

describe('math verification', () => {
  test('a wrong New Balance: PARSING ERROR / UNVERIFIED with the difference', () => {
    const s = parseStatement('chase.pdf', FIXTURES.chase.replace('New Balance  $164.00', 'New Balance  $174.00').replace('New Balance:  $164.00', 'New Balance:  $174.00'));
    expect(s.verification).toEqual({ status: 'UNVERIFIED', calculated: 16400, diff: 1000, missing: [], problems: [] });
  });

  test('a missing line: UNVERIFIED with the field named', () => {
    const s = parseStatement('amex.pdf', FIXTURES.amex.replace(/New Charges\s+\+\$515\.00/, ''));
    expect(s.purchases).toBeNull();
    expect(s.verification.status).toBe('UNVERIFIED');
    expect(s.verification.missing).toEqual(['Purchases & Charges']);
    expect(s.hits.purchases[0]).toMatchObject({ part: 'New Charges', cents: null, note: 'not found' });
  });

  test('a missing due date makes the statement unverified even when the math holds', () => {
    const s = parseStatement('amex.pdf', FIXTURES.amex.replace(/Payment Due Date\s+06\/01\/26/, 'Payment Due Date'));
    expect(s.dueDate).toBeNull();
    expect(s.verification).toEqual({ status: 'UNVERIFIED', calculated: 1500, diff: 0, missing: ['Payment Due Date'], problems: [] });
  });

  test('Apple: a monthly balance not found or above the Total Balance is UNVERIFIED although the math holds', () => {
    const missing = parseStatement('apple.pdf', FIXTURES.apple.replace('$900.00  $25.00  Mar 31, 2026', 'n/a  $25.00  Mar 31, 2026'));
    expect(missing.statementBalance).toBeNull();
    expect(missing.verification).toMatchObject({ status: 'UNVERIFIED', diff: 0, missing: ['Minimum Payment Due', 'Statement Balance', 'Payment Due Date'] });
    const above = parseStatement('apple.pdf', FIXTURES.apple.replace('$900.00  $25.00', '$950.00  $25.00'));
    expect(above.statementBalance).toBe(95000);
    expect(above.verification).toEqual({ status: 'UNVERIFIED', calculated: 90000, diff: 0, missing: [], problems: ['Statement Balance is outside $0.00 to the New Balance'] });
    const below = verify({ ...above, statementBalance: -100 });
    expect(below).toMatchObject({ status: 'UNVERIFIED', problems: ['Statement Balance is outside $0.00 to the New Balance'] });
    const lower = parseStatement('apple.pdf', FIXTURES.apple.replace('$900.00  $25.00', '$850.00  $25.00'));
    expect(lower.verification).toMatchObject({ status: 'VALIDATED', problems: [] });
  });

  test('Statement Balance bounds apply only to a New Balance above 0 (a credit balance stays VALIDATED)', () => {
    const base = { previousBalance: 0, payments: 500, purchases: 0, fees: 0, interest: 0, newBalance: -500, minimumPayment: 0, statementBalance: -500, closingDate: '2026-01-01', dueDate: '2026-01-25' };
    expect(verify(base)).toEqual({ status: 'VALIDATED', calculated: -500, diff: 0, missing: [], problems: [] });
    expect(verify({ ...base, statementBalance: null })).toMatchObject({ status: 'UNVERIFIED', missing: ['Statement Balance'] });
  });

  test('payments: each part counts as a payment whatever its sign (Capital One credits printed without a minus)', () => {
    const s = parseStatement('c1.pdf', FIXTURES.capitalOne.replace('Other Credits  - $5.00', 'Other Credits  $5.00'));
    expect(s.hits.payments.map(h => h.cents)).toEqual([-5000, 500]);
    expect(s.payments).toBe(5500);
    expect(s.verification.status).toBe('VALIDATED');
  });

  test('formula: previous - payments + purchases + fees + interest', () => {
    const base = { previousBalance: 1000, payments: 500, purchases: 300, fees: 25, interest: 10, newBalance: 835, minimumPayment: 100, statementBalance: 835, closingDate: '2026-01-01', dueDate: '2026-01-25' };
    expect(verify(base).status).toBe('VALIDATED');
    expect(verify({ ...base, newBalance: 834 })).toMatchObject({ status: 'UNVERIFIED', diff: -1 });
  });
});

describe('issuer detection', () => {
  test('page 1 decides: a later page naming another bank does not', () => {
    expect(detectIssuer(`${FIXTURES.chase}\nPAYMENT FROM BANK OF AMERICA AMERICAN EXPRESS`)?.id).toBe('chase');
  });

  test('an unknown statement throws UnknownIssuerError', () => {
    expect(() => parseStatement('x.pdf', 'Some Bank\nNew Balance  $1.00')).toThrow(UnknownIssuerError);
  });
});
