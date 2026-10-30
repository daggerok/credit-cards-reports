/// <reference lib="esnext" />
// Statement text -> fields, with no AI: one table of label patterns per issuer and a shared engine.
// Money is kept in integer cents so the balance check is exact.
//
// How a field is found (first hit wins, lines top to bottom, so the page 1 summary beats later pages):
//   label(re)       the amount right after the label on the same line: "New Balance  $224.57", "Payments  - $340.00"
//                   (if no line has one, a label alone at the end of a line takes an amount that starts the line
//                   above or below: BofA prints "$31.96" one baseline off its "Purchases and Adjustments")
//   column(re, i)   the i-th value of the first line starting with "$" under a header line: Capital One and Apple
//                   print "New Balance  Minimum Payment Due" with "$331.05  $25.00" under it
//   constant(0)     a field the issuer does not print (Apple Card has no fees)
// A field can sum several parts (Capital One payments = Payments + Other Credits) and a part can be optional
// (Cash Advances, Balance Transfers: 0 when the statement has no such line).

export type Cents = number;
export type IssuerId = 'chase' | 'capital-one' | 'citi' | 'bofa' | 'amex' | 'apple';
export type FieldKey = 'previousBalance' | 'payments' | 'purchases' | 'fees' | 'interest' | 'newBalance' | 'minimumPayment' | 'statementBalance';
export type DateKey = 'closingDate' | 'dueDate';

/** One value found in the text, with the line it came from (shown on the Parsed raw data panel). */
export type Hit = { part: string; cents: Cents | null; text: string; line: number; note?: string };
export type DateHit = { iso: string | null; text: string; line: number };

export type Verification = {
  status: 'VALIDATED' | 'UNVERIFIED';
  calculated: Cents | null;
  diff: Cents | null;
  missing: string[];
  /** Values found but impossible, e.g. a Statement Balance above the New Balance (a wrong column). */
  problems: string[];
};

export type Statement = {
  fileName: string;
  issuer: IssuerId;
  bank: string;
  card: string;
  last4: string;
  closingDate: string | null;
  dueDate: string | null;
  previousBalance: Cents | null;
  payments: Cents | null;
  purchases: Cents | null;
  fees: Cents | null;
  interest: Cents | null;
  newBalance: Cents | null;
  minimumPayment: Cents | null;
  /** What to pay to avoid interest: the New Balance, or Apple's monthly balance (it leaves out installments). */
  statementBalance: Cents | null;
  hits: Record<FieldKey, Hit[]>;
  dateHits: Record<DateKey, DateHit | null>;
  verification: Verification;
};

// ---- money and dates -------------------------------------------------------------------------------

const MONEY = String.raw`[-+]?\s?\(?\$\s?-?\d[\d,]*\.\d{2}\)?`;
const DATE = String.raw`(?:\d{1,2}/\d{1,2}/\d{2,4}|[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4})`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "$1,234.56" -> 123456, "-$1.57" and "- $340.00" and "($5.00)" -> negative; null when it is not an amount. */
export function parseMoney(token: string): Cents | null {
  const m = /(\d[\d,]*)\.(\d{2})/.exec(token);
  if (!m) return null;
  const cents = Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]);
  const negative = /-/.test(token.slice(0, m.index)) || /^\s*\(.*\)\s*$/.test(token);
  return negative ? -cents : cents;
}

/** "11/01/26", "07/16/2026", "Nov 04, 2026", "November 9, 2026" -> "2026-11-01"; null otherwise. */
export function parseDate(token: string): string | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (y: number, mo: number, d: number) => {
    const date = new Date(Date.UTC(y, mo - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
  };
  let m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(token);
  if (m) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2]));
  m = /([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})/.exec(token);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return month < 0 ? null : iso(Number(m[3]), month + 1, Number(m[2]));
  }
  return null;
}

// ---- finders ----------------------------------------------------------------------------------------

type Ctx = { lines: string[] };
type Part = { name: string; optional?: boolean; find: (ctx: Ctx) => Hit | null };
type DateFinder = (ctx: Ctx) => DateHit | null;

function label(name: string, re: RegExp, optional = false): Part {
  const sameLine = new RegExp(String.raw`${re.source}\s*[:=]?\s*(${MONEY})`);
  const alone = new RegExp(String.raw`${re.source}\s*:?\s*$`);
  const leading = new RegExp(String.raw`^(${MONEY})(?:\s|$)`);
  return {
    name,
    optional,
    find: ({ lines }) => {
      for (let i = 0; i < lines.length; i += 1) {
        const m = sameLine.exec(lines[i]);
        if (m) return { part: name, cents: parseMoney(m[1]), text: lines[i], line: i + 1 };
      }
      for (let i = 0; i < lines.length; i += 1) {
        if (!alone.test(lines[i])) continue;
        for (const j of [i - 1, i + 1]) {
          const m = leading.exec(lines[j] ?? '');
          if (m) return { part: name, cents: parseMoney(m[1]), text: `${lines[i]} | ${lines[j]}`, line: j + 1 };
        }
      }
      return null;
    },
  };
}

/** The tokens (split on 2+ spaces) of the first line that starts with "$" within 4 lines under the header. */
function columnTokens(lines: string[], header: RegExp): { tokens: string[]; text: string; line: number } | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (!header.test(lines[i])) continue;
    for (let j = i + 1; j <= i + 4 && j < lines.length; j += 1) {
      if (/^\$/.test(lines[j])) return { tokens: lines[j].split(/\s{2,}/), text: `${lines[i]} | ${lines[j]}`, line: j + 1 };
    }
  }
  return null;
}

function column(name: string, header: RegExp, index: number): Part {
  return {
    name,
    find: ({ lines }) => {
      const c = columnTokens(lines, header);
      const cents = c ? parseMoney(c.tokens[index] ?? '') : null;
      return c && cents !== null ? { part: name, cents, text: c.text, line: c.line } : null;
    },
  };
}

function constant(name: string, cents: Cents, note: string): Part {
  return { name, find: () => ({ part: name, cents, text: '', line: 0, note }) };
}

/** The first of the finders that finds something (e.g. Capital One's minimum: the column, else a label). */
function either(...parts: Part[]): Part {
  return { name: parts[0].name, find: ctx => parts.map(p => p.find(ctx)).find(Boolean) ?? null };
}

/** A date captured by group 1 of a pattern (the pattern holds DATE where the date goes). */
function dateAt(re: RegExp): DateFinder {
  return ({ lines }) => {
    for (let i = 0; i < lines.length; i += 1) {
      const m = re.exec(lines[i]);
      if (m) return { iso: parseDate(m[1]), text: lines[i], line: i + 1 };
    }
    return null;
  };
}

/** A label that starts a line with nothing usable after it and a date that starts the next line (BofA merges the label with the table beside it). */
function dateBelow(labelSource: string): DateFinder {
  const label = new RegExp(String.raw`^${labelSource}\b`);
  const leading = new RegExp(String.raw`^(${DATE})(?!\d)`);
  return ({ lines }) => {
    for (let i = 0; i + 1 < lines.length; i += 1) {
      if (!label.test(lines[i])) continue;
      const m = leading.exec(lines[i + 1]);
      if (m) return { iso: parseDate(m[1]), text: `${lines[i]} | ${lines[i + 1]}`, line: i + 2 };
    }
    return null;
  };
}

/** The first of the date finders that finds something. */
function firstDate(...finders: DateFinder[]): DateFinder {
  return ctx => {
    for (const find of finders) {
      const hit = find(ctx);
      if (hit) return hit;
    }
    return null;
  };
}

function dateColumn(header: RegExp, index: number): DateFinder {
  return ({ lines }) => {
    const c = columnTokens(lines, header);
    const iso = c ? parseDate(c.tokens[index] ?? '') : null;
    return c && iso ? { iso, text: c.text, line: c.line } : null;
  };
}

const after = (labelSource: string) => new RegExp(String.raw`${labelSource}\s*:?\s*(${DATE})`);
const rangeEnd = (prefix: string) => new RegExp(String.raw`${prefix}\s*${DATE}\s*[-–—]\s*(${DATE})`);
/** The end of a statement period printed as "May 20 - June 19, 2026" (Apple, BofA). */
const PERIOD_END = /[A-Z][a-z]{2,8} \d{1,2}\s*[-–—]\s*([A-Z][a-z]{2,8} \d{1,2}, \d{4})/;

// ---- issuers ----------------------------------------------------------------------------------------

type Issuer = {
  id: IssuerId;
  bank: string;
  /** Matched against page 1 only: later pages hold transactions that can name other banks. */
  detect: RegExp;
  card: (text: string) => string;
  last4: (text: string) => string;
  dates: Record<DateKey, DateFinder>;
  fields: Record<Exclude<FieldKey, 'statementBalance'>, Part[]> & { statementBalance?: Part[] };
};

const clean = (s: string) => s.replace(/[®™`]/g, '').replace(/\s+/g, ' ').trim();
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
const lastDigits = (s: string | undefined) => (s ?? '').replace(/\D/g, '').slice(-4);

const CHASE_CARDS = /\b(CHASE FREEDOM(?: UNLIMITED| FLEX)?|SAPPHIRE (?:PREFERRED|RESERVE)|PRIME VISA|AMAZON(?: PRIME)? VISA|INK BUSINESS (?:CASH|UNLIMITED|PREFERRED)|CHASE SLATE(?: EDGE)?)\b/i;

export const ISSUERS: Issuer[] = [
  {
    id: 'apple',
    bank: 'Apple',
    detect: /Apple Card[\s\S]*Goldman Sachs|Goldman Sachs[\s\S]*Apple Card/,
    card: () => 'Apple Card',
    last4: () => '',
    dates: {
      closingDate: dateAt(PERIOD_END),
      dueDate: dateColumn(/Your \w+ Balance\s+Minimum\s+Payment/, 2),
    },
    fields: {
      previousBalance: [label('Previous Total Balance', /Previous Total Balance/)],
      payments: [label('Total payments for this period', /Total payments for this period/)],
      purchases: [label('Total charges, credits, and returns for this period', /Total charges, credits,? and returns for this period/)],
      fees: [constant('Fees', 0, 'Apple Card charges no fees: not on the statement')],
      interest: [label('Total interest for this month', /Total interest for this month/)],
      newBalance: [label('Total Balance', /(?<!Previous )Total Balance/)],
      minimumPayment: [column('Minimum Payment Due', /Your \w+ Balance\s+Minimum\s+Payment/, 1)],
      statementBalance: [column('Monthly Balance', /Your \w+ Balance\s+Minimum\s+Payment/, 0)],
    },
  },
  {
    id: 'amex',
    bank: 'American Express',
    detect: /American Express/,
    card: text => clean(/^(.+?) from American Express/m.exec(text)?.[1] ?? 'Card'),
    last4: text => lastDigits(/Account Ending\s+([\d-]+)/.exec(text)?.[1]),
    dates: {
      closingDate: dateAt(after('Closing Date')),
      dueDate: dateAt(after('Payment Due Date')),
    },
    fields: {
      previousBalance: [label('Previous Balance', /Previous Balance/)],
      payments: [label('Payments/Credits', /Payments\/Credits/)],
      purchases: [label('New Charges', /New Charges/)],
      fees: [label('Fees', /\bFees/)],
      interest: [label('Interest Charged', /Interest Charged/)],
      newBalance: [label('New Balance', /New Balance/)],
      minimumPayment: [label('Minimum Payment Due', /Minimum Payment Due/)],
    },
  },
  {
    id: 'capital-one',
    bank: 'Capital One',
    detect: /capitalone\.com|Capital One/,
    card: text => clean(/^(.+?) Credit Card \|/m.exec(text)?.[1] ?? 'Card'),
    last4: text => /ending in (\d{4})/.exec(text)?.[1] ?? '',
    dates: {
      closingDate: dateAt(rangeEnd('^')),
      dueDate: dateAt(after('Payment Due Date')),
    },
    fields: {
      previousBalance: [label('Previous Balance', /Previous Balance/)],
      payments: [label('Payments', /\bPayments/), label('Other Credits', /Other Credits/, true)],
      purchases: [label('Transactions', /\bTransactions/), label('Cash Advances', /Cash Advances/, true)],
      fees: [label('Fees Charged', /Fees Charged/)],
      interest: [label('Interest Charged', /Interest Charged/)],
      newBalance: [label('New Balance', /New Balance/)],
      minimumPayment: [either(column('Minimum Payment Due', /New Balance\s+Minimum Payment Due/, 1), label('Minimum Payment Due', /Minimum Payment Due/))],
    },
  },
  {
    id: 'citi',
    bank: 'Citi',
    detect: /citicards\.com|\bCiti\b.*Card/,
    card: text => clean(/^(Citi\b.*?Card)\b/m.exec(text)?.[1] ?? 'Card'),
    last4: text => /Account number ending in:?\s*(\d{4})/.exec(text)?.[1] ?? '',
    dates: {
      closingDate: dateAt(rangeEnd('Billing Period:')),
      dueDate: dateAt(after('Payment due date')),
    },
    fields: {
      previousBalance: [label('Previous balance', /Previous balance/)],
      payments: [label('Payments', /\bPayments/), label('Credits', /\bCredits/, true)],
      purchases: [label('Purchases', /\bPurchases/), label('Cash advances', /Cash advances/, true)],
      fees: [label('Fees', /\bFees/)],
      interest: [label('Interest', /\bInterest/)],
      newBalance: [label('New balance', /New balance/)],
      minimumPayment: [label('Minimum payment due', /Minimum payment due/)],
    },
  },
  {
    id: 'bofa',
    bank: 'Bank of America',
    detect: /bankofamerica\.com|Bank of America/,
    card: text => clean(/^(.+)\n\s*Account#/m.exec(text)?.[1] ?? 'Card'),
    last4: text => lastDigits(/Account#\s*([\dX ]+)/.exec(text)?.[1]),
    dates: {
      // the label with its date, else the date alone on the next line, else the end of the statement period
      closingDate: firstDate(dateAt(after('Statement Closing Date')), dateBelow('Statement Closing Date'), dateAt(PERIOD_END)),
      dueDate: dateAt(after('Payment Due Date')),
    },
    fields: {
      previousBalance: [label('Previous Balance', /Previous Balance/)],
      payments: [label('Payments and Other Credits', /Payments and Other Credits/)],
      purchases: [
        label('Purchases and Adjustments', /Purchases and Adjustments/),
        label('Balance Transfers', /^Balance Transfers/, true),
        label('Cash Advances', /^Cash Advances/, true),
      ],
      fees: [label('Fees Charged', /Fees Charged/)],
      interest: [label('Interest Charged', /Interest Charged/)],
      newBalance: [label('New Balance Total', /New Balance Total/)],
      minimumPayment: [label('Total Minimum Payment Due', /Total Minimum Payment Due/)],
    },
  },
  {
    id: 'chase',
    bank: 'Chase',
    detect: /chase\.com/i,
    card: text => {
      const m = CHASE_CARDS.exec(text);
      return m ? titleCase(m[1]).replace(/^Chase /, '') : 'Card';
    },
    last4: text => lastDigits(/Account Number:\s*([\dX ]+)/i.exec(text)?.[1]),
    dates: {
      closingDate: dateAt(rangeEnd('Opening/Closing Date')),
      dueDate: dateAt(after('Payment Due Date')),
    },
    fields: {
      previousBalance: [label('Previous Balance', /Previous Balance/)],
      payments: [label('Payment, Credits', /Payment, Credits/)],
      purchases: [
        label('Purchases', /^Purchases/),
        label('Cash Advances', /^Cash Advances/, true),
        label('Balance Transfers', /^Balance Transfers`?/, true),
      ],
      fees: [label('Fees Charged', /Fees Charged/)],
      interest: [label('Interest Charged', /Interest Charged/)],
      newBalance: [label('New Balance', /New Balance/)],
      minimumPayment: [label('Minimum Payment Due', /Minimum Payment Due/)],
    },
  },
];

export const FIELD_LABELS: Record<FieldKey, string> = {
  previousBalance: 'Previous Balance',
  payments: 'Payments & Credits',
  purchases: 'Purchases & Charges',
  fees: 'Fees Charged',
  interest: 'Interest Charged',
  newBalance: 'New Balance',
  minimumPayment: 'Minimum Payment Due',
  statementBalance: 'Statement Balance',
};

export const DATE_LABELS: Record<DateKey, string> = { closingDate: 'Statement Closing Date', dueDate: 'Payment Due Date' };

export function detectIssuer(text: string): Issuer | null {
  const page1 = text.split('\f')[0];
  return ISSUERS.find(i => i.detect.test(page1)) ?? ISSUERS.find(i => i.detect.test(text)) ?? null;
}

// ---- the engine -------------------------------------------------------------------------------------

/**
 * Previous Balance - Payments & Credits + Purchases & Charges + Fees + Interest, compared with the New Balance to the cent.
 * The Statement Balance (what to pay for no interest) is required too and, with a New Balance above 0, must lie between
 * $0.00 and the New Balance: Apple's comes from its own column, which the balance check does not cover.
 */
export function verify(s: Pick<Statement, FieldKey | DateKey>): Verification {
  const required: (FieldKey | DateKey)[] = ['previousBalance', 'payments', 'purchases', 'fees', 'interest', 'newBalance', 'minimumPayment', 'statementBalance', 'closingDate', 'dueDate'];
  const missing = required.filter(k => s[k] === null).map(k => (k in FIELD_LABELS ? FIELD_LABELS[k as FieldKey] : DATE_LABELS[k as DateKey]));
  const { previousBalance: p, payments: pay, purchases: buy, fees, interest, newBalance, statementBalance } = s;
  const problems: string[] = [];
  if (newBalance !== null && newBalance > 0 && statementBalance !== null && (statementBalance < 0 || statementBalance > newBalance)) {
    problems.push('Statement Balance is outside $0.00 to the New Balance');
  }
  if (p === null || pay === null || buy === null || fees === null || interest === null) return { status: 'UNVERIFIED', calculated: null, diff: null, missing, problems };
  const calculated = p - pay + buy + fees + interest;
  const diff = newBalance === null ? null : newBalance - calculated;
  return { status: diff === 0 && !missing.length && !problems.length ? 'VALIDATED' : 'UNVERIFIED', calculated, diff, missing, problems };
}

export class UnknownIssuerError extends Error {}

/** The text of a statement (pages joined by form feeds, see pdf-text.ts) -> the fields and their check. */
export function parseStatement(fileName: string, text: string): Statement {
  const issuer = detectIssuer(text);
  if (!issuer) throw new UnknownIssuerError('Unknown issuer: not a Chase, Capital One, Citi, Bank of America, American Express or Apple Card statement');
  const ctx: Ctx = { lines: text.split('\n').map(l => l.trim()) };
  const hits = {} as Record<FieldKey, Hit[]>;
  const values = {} as Record<FieldKey, Cents | null>;
  const keys = Object.keys(FIELD_LABELS) as FieldKey[];
  for (const key of keys) {
    const parts = issuer.fields[key as keyof Issuer['fields']];
    if (!parts) continue;
    hits[key] = [];
    let sum: Cents | null = 0;
    for (const part of parts) {
      const hit = part.find(ctx);
      if (hit && hit.cents !== null) {
        hits[key].push(hit);
        // payments are printed with a minus (or none), each part on its own: the formula subtracts the amount
        if (sum !== null) sum += key === 'payments' ? Math.abs(hit.cents) : hit.cents;
      } else if (part.optional) {
        hits[key].push({ part: part.name, cents: 0, text: '', line: 0, note: 'not on the statement: 0' });
      } else {
        hits[key].push({ part: part.name, cents: null, text: '', line: 0, note: 'not found' });
        sum = null;
      }
    }
    values[key] = sum;
  }
  if (!hits.statementBalance) {
    hits.statementBalance = [{ part: 'New Balance', cents: values.newBalance, text: '', line: 0, note: 'same as the New Balance' }];
    values.statementBalance = values.newBalance;
  }
  const dateHits = { closingDate: issuer.dates.closingDate(ctx), dueDate: issuer.dates.dueDate(ctx) };
  const dates = { closingDate: dateHits.closingDate?.iso ?? null, dueDate: dateHits.dueDate?.iso ?? null };
  return {
    fileName,
    issuer: issuer.id,
    bank: issuer.bank,
    card: issuer.card(text),
    last4: issuer.last4(text),
    ...dates,
    ...values,
    hits,
    dateHits,
    verification: verify({ ...values, ...dates }),
  };
}
