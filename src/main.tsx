// =========================================================================
// Credit Cards Reports: credit card statements (PDF) -> what to pay and by when, built in the browser with no AI.
//
// - Load files (or drop PDF files on the page): pdfjs-dist reads every page, src/parser.ts finds the fields with
//   the label patterns of the issuer (Chase, Capital One, Citi, Bank of America, American Express, Apple Card)
// - Input tab: one sub tab per file with the text lines the parser saw; the lines a field came from are marked
// - Output tab: All (the upcoming due dates of every card, then every report) and one sub tab per statement.
//   A report: the two scenarios (minimum by the due date = no Late Fee, statement balance = no interest),
//   calendar reminders 3 days and 1 day before the due date, and the parsed raw data with the balance check
//   (Previous - Payments & Credits + Purchases & Charges + Fees + Interest = New Balance, to the cent)
// Same page as fidelity-reports (Stocks look, Tailwind 4, Input / Output tabs, the same file loading and
// localStorage for the view only); nothing is uploaded, the files are kept only until the page is reloaded.
// =========================================================================
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { addDays, buildIcs, googleUrl, outlookUrl, reminderFor, REMIND_DAYS_BEFORE } from './calendar';
import { DATE_LABELS, FIELD_LABELS, parseStatement, UnknownIssuerError, type DateKey, type FieldKey, type Statement } from './parser';
import { pdfText } from './pdf';
import { cardLabel, daysBetween, dueTotal, formatDate, formatMoney, isAhead, reminderMissing, scenarios, todayIso, upcoming, type RemindAmount } from './report';

// ---- 1. Storage (the view only, like fidelity-reports) -------------------------------------------------

const PREFIX = 'credit-cards-reports';
const THEME_KEY = `${PREFIX}-theme`;
const VIEW_KEY = `${PREFIX}-view`;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota or private mode */ }
}

function lsJson(key: string, fallback: any): any {
  try { const raw = lsGet(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

type MainTab = 'input' | 'output';
type Entry = { name: string; status: 'parsing' | 'done' | 'error'; text: string; statement?: Statement; error?: string };

const ALL = '__all__';
const STATUS_TEXT = { VALIDATED: 'VALIDATED', UNVERIFIED: 'PARSING ERROR / UNVERIFIED' } as const;

// ---- 2. Reading a file -------------------------------------------------------------------------------

async function readEntry(file: File): Promise<Entry> {
  let text = '';
  try {
    text = await pdfText(file);
    return { name: file.name, status: 'done', text, statement: parseStatement(file.name, text) };
  } catch (e) {
    const message = e instanceof UnknownIssuerError ? e.message
      : (e as { name?: string })?.name === 'PasswordException' ? 'The PDF is password protected: save it without a password and load it again'
      : `Could not read the PDF: ${e instanceof Error ? e.message : String(e)}`;
    return { name: file.name, status: 'error', text, error: message };
  }
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|·]+/g, '').replace(/\s+/g, '-');

// ---- 3. Small pieces -----------------------------------------------------------------------------------

const PILL_ACTIVE = 'bg-blue-600 text-white font-medium border-blue-500 shadow-xs';
const PILL_IDLE = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700';
const BTN_SLATE = 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-lg text-sm font-medium transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-200 dark:hover:bg-slate-700 disabled:hover:bg-slate-100 dark:disabled:hover:bg-slate-800';
const BTN_SMALL = 'inline-flex items-center gap-1.5 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-lg text-xs font-medium transition hover:bg-slate-100 dark:hover:bg-slate-800 aria-disabled:opacity-50 aria-disabled:pointer-events-none';
const PANEL = 'bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs backdrop-blur-sm';

type Tab = { id: string; label: string; sub?: string; title?: string; busy?: boolean; warn?: boolean };

function Pills({ tabs, active, onPick, big = false, label }: { tabs: Tab[]; active: string; onPick: (id: string) => void; big?: boolean; label: string }) {
  return (
    <>
      {tabs.map(tab => (
        <button key={tab.id} type="button" role="tab" aria-selected={tab.id === active} title={tab.title} aria-label={`${label} ${tab.label}`} onClick={() => onPick(tab.id)}
          className={`${big ? 'px-4 py-1.5 text-sm' : 'px-3.5 py-1.5 text-xs'} rounded-full transition border whitespace-nowrap ${tab.id === active ? PILL_ACTIVE : PILL_IDLE}`}>
          {tab.warn ? '⚠ ' : ''}<span className="tab-num">{tab.label}</span>{tab.sub ? <span className="tab-sub">{tab.sub}</span> : null}{tab.busy ? <span className="tab-spin" aria-label="reading" /> : null}
        </button>
      ))}
    </>
  );
}

function StatusBadge({ s }: { s: Statement }) {
  const ok = s.verification.status === 'VALIDATED';
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold tracking-wide px-2 py-0.5 rounded-full border ${ok ? 'status-ok' : 'status-bad'}`}>{ok ? '✓' : '⚠'} {STATUS_TEXT[s.verification.status]}</span>;
}

function daysText(due: string | null, today: string): string {
  if (!due) return '';
  const days = daysBetween(today, due);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return days > 0 ? `in ${days} days` : `${-days} day${days === -1 ? '' : 's'} ago`;
}

const NOT_FOUND = 'not found in the PDF';

/** A fact of the report; null = the PDF did not give it, shown in red so it is never read as $0 or "nothing due". */
function Fact({ label, value, sub, strong = false }: { label: string; value: string | null; sub?: string; strong?: boolean }) {
  const color = value === null ? 'text-rose-600 dark:text-rose-400' : strong ? 'text-slate-900 dark:text-white' : 'text-slate-800 dark:text-slate-100';
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">{label}</div>
      <div className={`tabular-nums ${strong ? 'text-lg font-bold' : 'text-base font-semibold'} ${color}`}>{value ?? `⚠ ${NOT_FOUND}`}</div>
      {sub ? <div className="text-xs text-slate-500 dark:text-slate-400">{sub}</div> : null}
    </div>
  );
}

// ---- 4. A report: actionable summary + parsed raw data ------------------------------------------------

function CalendarButtons({ s, remind, today }: { s: Statement; remind: RemindAmount; today: string }) {
  const past = !!s.dueDate && s.dueDate < today;
  const reminder = past ? null : reminderFor(s, remind);
  const off = !reminder;
  const missing = reminder || past ? [] : reminderMissing(s, remind);
  const link = (href: string, text: string, title: string) => (
    <a className={BTN_SMALL} href={off ? undefined : href} target="_blank" rel="noopener noreferrer" aria-disabled={off} title={title}>{text}</a>
  );
  const note = reminder ? <>Reminder 3 days and 1 day before the due date: <span className="font-medium text-slate-700 dark:text-slate-200">{reminder.title}</span></>
    : past ? 'The Payment Due Date has passed: no reminder'
    : missing.length ? <span className="font-semibold text-rose-600 dark:text-rose-400">⚠ {missing.join(' and ')} {NOT_FOUND}: no reminder, look it up in the statement and add the payment to your calendar yourself</span>
    : 'Nothing to pay: no reminder';
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-slate-500 dark:text-slate-400">{note}</div>
      <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={BTN_SMALL} disabled={off} aria-disabled={off}
        title="One all-day event on the Payment Due Date with alarms at 09:00 3 days and 1 day before (Apple Calendar, Outlook, any iCal app)"
        onClick={() => reminder && download(`${safeName(cardLabel(s))}-${s.dueDate}.ics`, buildIcs([reminder]), 'text/calendar')}>
        Apple Calendar / Outlook / iCal (.ics)
      </button>
      {reminder ? REMIND_DAYS_BEFORE.map(days => (
        <span key={days} className="contents">
          {link(googleUrl(reminder, days), `Google · ${days}d before`, `Google Calendar: an event at 09:00 on ${formatDate(addDays(reminder.dueDate, -days))}`)}
          {link(outlookUrl(reminder, days), `Outlook.com · ${days}d before`, `Outlook.com: an event at 09:00 on ${formatDate(addDays(reminder.dueDate, -days))}`)}
        </span>
      )) : null}
      </div>
    </div>
  );
}

const FIELD_ORDER: FieldKey[] = ['previousBalance', 'payments', 'purchases', 'fees', 'interest', 'newBalance', 'minimumPayment', 'statementBalance'];
const DATE_ORDER: DateKey[] = ['closingDate', 'dueDate'];

function RawData({ s }: { s: Statement }) {
  const v = s.verification;
  const ok = v.status === 'VALIDATED';
  const source = (line: number, text: string, note?: string) => (
    <span className="text-slate-500 dark:text-slate-400">{note ? <em>{note}</em> : null}{line ? <> line {line}: <code className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{text}</code></> : null}</span>
  );
  return (
    <details className="raw rounded-lg border border-slate-200 dark:border-slate-700" open={!ok}>
      <summary className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        <span className="raw-chev text-slate-400">▸</span> Parsed raw data & math check <StatusBadge s={s} />
      </summary>
      <div className="px-3 pb-3 space-y-3">
        <div className="overflow-x-auto themed-scroll">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              <tr><th className="py-1.5 pr-3">Field</th><th className="py-1.5 pr-3 text-right">Value</th><th className="py-1.5">Parts and where they were found</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {DATE_ORDER.map(key => {
                const hit = s.dateHits[key];
                return (
                  <tr key={key}>
                    <td className="py-1.5 pr-3 whitespace-nowrap font-medium">{DATE_LABELS[key]}</td>
                    <td className={`py-1.5 pr-3 text-right tabular-nums whitespace-nowrap ${s[key] ? '' : 'text-rose-600 dark:text-rose-400'}`}>{s[key] ? formatDate(s[key]) : 'not found'}</td>
                    <td className="py-1.5">{hit ? source(hit.line, hit.text) : null}</td>
                  </tr>
                );
              })}
              {FIELD_ORDER.map(key => (
                <tr key={key}>
                  <td className="py-1.5 pr-3 whitespace-nowrap font-medium align-top">{FIELD_LABELS[key]}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums whitespace-nowrap align-top ${s[key] === null ? 'text-rose-600 dark:text-rose-400' : ''}`}>{s[key] === null ? 'not found' : formatMoney(s[key])}</td>
                  <td className="py-1.5 space-y-0.5">
                    {s.hits[key].map((h, i) => (
                      <div key={i} className={h.cents === null ? 'text-rose-600 dark:text-rose-400' : ''}>
                        <span className="font-medium">{h.part}</span>{h.cents !== null ? ` ${formatMoney(h.cents)}` : ''}{key === 'payments' && h.cents !== null && h.cents < 0 ? ' (subtracted)' : ''} {source(h.line, h.text, h.note)}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-sm ${ok ? 'status-ok' : 'status-bad'}`}>
          <div className="font-semibold">Math verification: {STATUS_TEXT[v.status]}</div>
          <div className="font-mono text-xs mt-1 break-words">
            Calculated New Balance = {formatMoney(s.previousBalance)} − {formatMoney(s.payments)} + {formatMoney(s.purchases)} + {formatMoney(s.fees)} + {formatMoney(s.interest)} = {formatMoney(v.calculated)}
          </div>
          <div className="font-mono text-xs">New Balance from the PDF = {formatMoney(s.newBalance)}</div>
          {v.diff !== null && v.diff !== 0 ? <div className="text-xs font-semibold mt-1">Difference (PDF − calculated): {formatMoney(v.diff)}: a line was missed or a sign is wrong</div> : null}
          {v.missing.length ? <div className="text-xs font-semibold mt-1">Not found: {v.missing.join(', ')}</div> : null}
          {v.problems.map(p => <div key={p} className="text-xs font-semibold mt-1">{p}: a wrong line or column was read</div>)}
        </div>
      </div>
    </details>
  );
}

function ReportCard({ entry, remind, today }: { entry: Entry; remind: RemindAmount; today: string }) {
  if (entry.status === 'parsing') {
    return <div className={`${PANEL} p-4 text-sm text-slate-500 dark:text-slate-400`}><span className="tab-spin" /> Reading {entry.name}…</div>;
  }
  if (!entry.statement) {
    return (
      <div className={`${PANEL} p-4 space-y-1`}>
        <div className="font-semibold text-slate-900 dark:text-white">⚠ {entry.name}</div>
        <div className="text-sm text-rose-600 dark:text-rose-400">{entry.error}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">The Input tab shows the text that was read from the file</div>
      </div>
    );
  }
  const s = entry.statement;
  const sc = scenarios(s);
  const past = !!s.dueDate && s.dueDate < today;
  return (
    <article className={`${PANEL} p-4 space-y-4`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{cardLabel(s)}</h2>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate" title={entry.name}>{s.bank} · {entry.name}</div>
        </div>
        <StatusBadge s={s} />
      </header>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Fact label="Statement Closing Date" value={s.closingDate ? formatDate(s.closingDate) : null} />
        <Fact label="Payment Due Date" value={s.dueDate ? formatDate(s.dueDate) : null} sub={daysText(s.dueDate, today)} strong />
        <Fact label="Statement Balance" value={s.statementBalance === null ? null : formatMoney(s.statementBalance)} strong />
        <Fact label="Minimum Payment Due" value={s.minimumPayment === null ? null : formatMoney(s.minimumPayment)} />
      </div>
      {past ? <div className="text-xs text-amber-700 dark:text-amber-300">The Payment Due Date has passed: this statement is history, load the newest one for current dates</div> : null}
      <div className="grid gap-2 md:grid-cols-2">
        <section className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300">Сценарий 1 · избежать Late Fee</div>
          <div className="text-sm text-slate-800 dark:text-slate-100 mt-1">{sc.lateFee}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Payment Due Date {formatDate(s.dueDate)} · Minimum Payment Due {formatMoney(s.minimumPayment)}</div>
        </section>
        <section className="rounded-lg border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300">Сценарий 2 · избежать Interest Charges</div>
          <div className="text-sm text-slate-800 dark:text-slate-100 mt-1">{sc.interest}</div>
          <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{sc.nextPeriod}</div>
        </section>
      </div>
      <CalendarButtons s={s} remind={remind} today={today} />
      <RawData s={s} />
    </article>
  );
}

function Upcoming({ statements, today, onPick }: { statements: Statement[]; today: string; onPick: (fileName: string) => void }) {
  const list = upcoming(statements, today);
  // a value or a due date not found in a PDF makes the total "+ ?": the sum leaves that statement out
  const total = (key: 'statementBalance' | 'minimumPayment') => {
    const t = dueTotal(statements, key, today);
    return t.unknown
      ? <b className="text-rose-600 dark:text-rose-400" title={`Incomplete: ${t.unknown} statement${t.unknown === 1 ? '' : 's'} without this amount or a Payment Due Date in the PDF ${t.unknown === 1 ? 'is' : 'are'} not counted`}>{formatMoney(t.cents)} + ?</b>
      : <b>{formatMoney(t.cents)}</b>;
  };
  const amount = (cents: number | null) => (cents === null ? <span className="text-rose-600 dark:text-rose-400 font-semibold" title={NOT_FOUND}>?</span> : formatMoney(cents));
  if (!list.length) return null;
  return (
    <section className={`${PANEL} p-4 space-y-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Upcoming payments</h2>
        <div className="text-sm text-slate-600 dark:text-slate-300 tabular-nums">
          Due ahead: statement balances {total('statementBalance')} · minimums {total('minimumPayment')}
        </div>
      </div>
      <div className="overflow-x-auto themed-scroll">
        <table className="w-full text-left whitespace-nowrap text-sm">
          <thead className="text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
            <tr><th className="py-2 pr-4">Payment Due Date</th><th className="py-2 pr-4">When</th><th className="py-2 pr-4">Card</th><th className="py-2 pr-4 text-right">Statement Balance</th><th className="py-2 pr-4 text-right">Minimum</th><th className="py-2">Check</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {list.map(s => {
              const past = !!s.dueDate && s.dueDate < today;
              const soon = isAhead(s, today) && daysBetween(today, s.dueDate as string) <= 3;
              return (
                <tr key={s.fileName} className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer ${past ? 'opacity-55' : ''}`} onClick={() => onPick(s.fileName)} title="Open this report">
                  <td className="py-2 pr-4 tabular-nums font-semibold">{s.dueDate ? formatDate(s.dueDate)
                    : <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold tracking-wide px-2 py-0.5 rounded-full border status-bad" title="Look up the Payment Due Date in the statement">⚠ Due date not found</span>}</td>
                  <td className={`py-2 pr-4 ${soon || !s.dueDate ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>{s.dueDate ? daysText(s.dueDate, today) : 'unknown'}{past ? ' (past)' : ''}</td>
                  <td className="py-2 pr-4 font-medium text-slate-900 dark:text-white">{cardLabel(s)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{amount(s.statementBalance)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{amount(s.minimumPayment)}</td>
                  <td className="py-2"><StatusBadge s={s} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- 5. Input: the lines the parser saw ----------------------------------------------------------------

function usedLines(s: Statement | undefined): Map<number, string[]> {
  const used = new Map<number, string[]>();
  if (!s) return used;
  const mark = (line: number, label: string) => { if (line) used.set(line, [...(used.get(line) ?? []), label]); };
  for (const key of FIELD_ORDER) for (const h of s.hits[key]) mark(h.line, h.part === FIELD_LABELS[key] ? h.part : `${FIELD_LABELS[key]}: ${h.part}`);
  for (const key of DATE_ORDER) mark(s.dateHits[key]?.line ?? 0, DATE_LABELS[key]);
  return used;
}

function InputView({ entry, search }: { entry: Entry; search: string }) {
  const used = useMemo(() => usedLines(entry.statement), [entry.statement]);
  const rows = useMemo(() => {
    let page = 1;
    return entry.text.split('\n').map((text, i) => {
      if (text === '\f') { page += 1; return null; }
      return { n: i + 1, page, text };
    }).filter((r): r is { n: number; page: number; text: string } => !!r && !!r.text.trim());
  }, [entry.text]);
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = terms.length ? rows.filter(r => terms.every(t => `${r.text} ${(used.get(r.n) ?? []).join(' ')}`.toLowerCase().includes(t))) : rows;
  if (entry.status === 'parsing') return <Message>Reading {entry.name}…</Message>;
  if (!rows.length) return <Message>{entry.error ?? 'No text in this PDF (a scanned image?)'}</Message>;
  return (
    <table className="w-full text-left whitespace-nowrap">
      <thead className="bg-slate-50 dark:bg-slate-900/95 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700 sticky top-0 z-20 backdrop-blur-sm">
        <tr><th className="py-3.5 px-4 w-12 text-center">Line</th><th className="py-3.5 px-4 w-12 text-center">Page</th><th className="py-3.5 px-4 w-px">Used for</th><th className="py-3.5 px-4">Text</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-sm">
        {shown.length ? shown.map(r => {
          const labels = used.get(r.n);
          return (
            <tr key={r.n} className={`transition-colors ${labels ? 'selected-row' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}>
              <td className="py-1.5 px-4 text-center text-xs text-slate-400 dark:text-slate-500 tabular-nums">{r.n}</td>
              <td className="py-1.5 px-4 text-center text-xs text-slate-400 dark:text-slate-500 tabular-nums">{r.page}</td>
              <td className="py-1.5 px-4 text-xs font-semibold text-blue-700 dark:text-blue-300">{labels?.join(', ') ?? ''}</td>
              <td className="py-1.5 px-4 font-mono text-xs text-slate-700 dark:text-slate-300">{r.text}</td>
            </tr>
          );
        }) : <tr><td colSpan={4} className="py-12 text-center text-slate-400 dark:text-slate-500">No lines match the search</td></tr>}
      </tbody>
    </table>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <div className="py-12 px-4 text-center text-sm text-slate-400 dark:text-slate-500">{children}</div>;
}

function EmptyState({ onLoad }: { onLoad: () => void }) {
  return (
    <div className="p-6 sm:p-10">
      <button type="button" onClick={onLoad} className="w-full rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-slate-800 transition px-6 py-12 text-center">
        <div className="dz-label text-lg font-semibold text-slate-700 dark:text-slate-200">Drop credit card statements (PDF) here or click to load them</div>
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">Chase (Freedom, Amazon Prime Visa), Capital One (Savor, Quicksilver), Citi, Bank of America, American Express, Apple Card</div>
        <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">Read in your browser with pdf.js and fixed patterns, no AI: nothing is uploaded or kept after a reload</div>
      </button>
    </div>
  );
}

// ---- 6. The page ---------------------------------------------------------------------------------------

function App() {
  const saved = lsJson(VIEW_KEY, {});
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mainTab, setMainTab] = useState<MainTab>(saved.mainTab === 'input' ? 'input' : 'output');
  const [remind, setRemind] = useState<RemindAmount>(saved.remind === 'minimum' ? 'minimum' : 'balance');
  const [inputFile, setInputFile] = useState('');
  const [outputSheet, setOutputSheet] = useState(ALL);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dragging, setDragging] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const fileInput = useRef<HTMLInputElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const topPanels = useRef<HTMLDivElement>(null);
  const today = todayIso();

  useEffect(() => { lsSet(VIEW_KEY, JSON.stringify({ mainTab, remind })); }, [mainTab, remind]);

  const sorted = useMemo(() => [...entries].sort((a, b) => collator.compare(a.name, b.name)), [entries]);
  const statements = sorted.flatMap(e => (e.statement ? [e.statement] : []));
  const reading = entries.some(e => e.status === 'parsing');
  const selectedInput = sorted.find(e => e.name === inputFile) ?? sorted[0];
  const sheet = outputSheet === ALL || sorted.some(e => e.name === outputSheet) ? outputSheet : ALL;

  const loadFiles = useCallback(async (list: FileList | File[]) => {
    const picked = [...list].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!picked.length) { setStatus('Only .pdf files can be loaded'); return; }
    const names = new Set(picked.map(f => f.name));
    // more loads add files; a file with the same name is replaced
    setEntries(prev => [...prev.filter(e => !names.has(e.name)), ...picked.map(f => ({ name: f.name, status: 'parsing' as const, text: '' }))]);
    setInputFile(picked[0].name);
    setStatus(`Reading ${picked.length} file${picked.length === 1 ? '' : 's'}…`);
    const done = await Promise.all(picked.map(async f => {
      const entry = await readEntry(f);
      setEntries(prev => prev.map(e => (e.name === entry.name ? entry : e)));
      return entry;
    }));
    const failed = done.filter(e => !e.statement).length;
    const unverified = done.filter(e => e.statement?.verification.status === 'UNVERIFIED').length;
    setStatus(`${done.length} file${done.length === 1 ? '' : 's'} read${unverified ? `, ${unverified} unverified` : ''}${failed ? `, ${failed} not recognized` : ''}`);
  }, []);

  // statements whose due date or amount was not found get no reminder: say so instead of leaving them out silently
  const leftOut = statements.filter(s => (!s.dueDate || isAhead(s, today)) && reminderMissing(s, remind).length).length;
  const leftOutText = leftOut ? `${leftOut} statement${leftOut === 1 ? '' : 's'} left out: Payment Due Date or amount not found in the PDF` : '';
  const addAllToCalendar = () => {
    const reminders = statements.filter(s => isAhead(s, today)).map(s => reminderFor(s, remind)).filter(r => r !== null);
    if (!reminders.length) return;
    download(`credit-cards-payments-${today}.ics`, buildIcs(reminders), 'text/calendar');
    setStatus(`${reminders.length} payment${reminders.length === 1 ? '' : 's'} in credit-cards-payments-${today}.ics${leftOutText ? `; ${leftOutText}` : ''}`);
  };
  const upcomingReminders = statements.filter(s => isAhead(s, today) && reminderFor(s, remind)).length;

  // drag and drop on the whole page, same as fidelity-reports
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { depth += 1; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) void loadFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [loadFiles]);

  // only the content scrolls: it ends one gutter above the footer (fitTableHeight of fidelity-reports)
  useEffect(() => {
    const fit = () => {
      const el = scroll.current;
      if (!el) return;
      const card = el.parentElement;
      const main = document.querySelector('main');
      const footer = document.querySelector('footer');
      const below = (card ? parseFloat(getComputedStyle(card).borderBottomWidth) : 0) + (main ? parseFloat(getComputedStyle(main).paddingBottom) : 0) + (footer ? footer.getBoundingClientRect().height : 0);
      el.style.maxHeight = `${Math.max(240, window.innerHeight - el.getBoundingClientRect().top - below)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    const observer = new ResizeObserver(fit);
    if (topPanels.current) observer.observe(topPanels.current);
    return () => { window.removeEventListener('resize', fit); observer.disconnect(); };
  });

  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    document.documentElement.style.backgroundColor = next ? '#020617' : '#f8fafc';
    lsSet(THEME_KEY, next ? 'dark' : 'light');
    setDark(next);
  };

  const validated = statements.filter(s => s.verification.status === 'VALIDATED').length;
  const next = upcoming(statements, today).find(s => isAhead(s, today));
  const undated = statements.filter(s => !s.dueDate).length;
  const subtitle = entries.length
    ? `${statements.length} statement${statements.length === 1 ? '' : 's'}, ${validated} validated${next ? ` · next due ${formatDate(next.dueDate)} (${cardLabel(next)})` : ''}${undated ? ` · ⚠ ${undated} without a due date` : ''}${reading ? ' · reading…' : ''}`
    : 'Credit card statements (PDF) read in the browser, no AI';

  const inputTabs: Tab[] = sorted.map((e, i) => ({ id: e.name, label: String(i + 1), sub: e.name, busy: e.status === 'parsing', warn: e.status === 'error', title: e.error ?? e.name }));
  const outputTabs: Tab[] = [
    { id: ALL, label: 'All', sub: String(statements.length), title: 'Upcoming payments and every report', busy: reading },
    ...sorted.map((e, i) => ({
      id: e.name,
      label: String(i + 1),
      sub: e.statement ? cardLabel(e.statement) : e.name,
      busy: e.status === 'parsing',
      warn: e.status === 'error' || e.statement?.verification.status === 'UNVERIFIED',
      title: e.statement ? `${e.name}: ${STATUS_TEXT[e.statement.verification.status]}` : e.error ?? e.name,
    })),
  ];
  const openReport = (name: string) => { setMainTab('output'); setOutputSheet(name); };

  let content: ReactNode;
  if (!entries.length) content = <EmptyState onLoad={() => fileInput.current?.click()} />;
  else if (mainTab === 'input') content = selectedInput ? <InputView entry={selectedInput} search={search} /> : null;
  else if (sheet === ALL) {
    content = (
      <div className="p-3 sm:p-4 space-y-4">
        <Upcoming statements={statements} today={today} onPick={openReport} />
        {sorted.map(e => <ReportCard key={e.name} entry={e} remind={remind} today={today} />)}
      </div>
    );
  } else {
    const entry = sorted.find(e => e.name === sheet);
    content = entry ? <div className="p-3 sm:p-4"><ReportCard entry={entry} remind={remind} today={today} /></div> : null;
  }

  return (
    <>
      <div className="min-h-screen flex flex-col animate-fade-in">
        <main className="flex-1 w-full max-w-full p-4 sm:p-8 pb-0 sm:pb-0 lg:pt-0 space-y-6">
          <div ref={topPanels} id="top-panels" className="max-lg:contents lg:sticky lg:top-0 lg:z-40 lg:space-y-6 lg:pt-8 lg:bg-slate-50 lg:dark:bg-slate-900">
            {/* Top panel: brand, the Input / Output tabs, file count and theme */}
            <nav id="selected-tabs-panel" className={`${PANEL} max-lg:dark:bg-slate-800 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 lg:grid lg:grid-cols-[minmax(11rem,1fr)_minmax(0,auto)_minmax(min-content,1fr)] max-lg:sticky max-lg:top-0 max-lg:z-40 max-lg:mb-6`} aria-label="Input and output">
              <div className="order-1 lg:min-w-0 flex flex-1 flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 min-w-0">
                <div className="flex items-start gap-3 min-w-0 sm:shrink-0">
                  <svg className="w-6 h-6 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h2m4 0h2M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
                  </svg>
                  <h1 className="min-w-0 text-xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">Credit Cards Reports</h1>
                </div>
                <span className="hidden xl:block xl:flex-1 sm:min-w-0 truncate text-sm text-slate-500 dark:text-slate-400">{subtitle}</span>
              </div>
              <div role="tablist" aria-label="Input or output" className="flex flex-nowrap items-center [justify-content:safe_center] [&>*]:shrink-0 [&>*]:whitespace-nowrap gap-1.5 overflow-x-auto py-0.5 order-3 lg:order-2 basis-full lg:basis-auto max-w-full themed-scroll">
                <Pills big label="Show" active={mainTab} onPick={id => { setMainTab(id === 'input' ? 'input' : 'output'); setSearch(''); }}
                  tabs={[{ id: 'input', label: 'Input', sub: String(entries.length) }, { id: 'output', label: 'Output', busy: reading }]} />
              </div>
              <div className="order-2 lg:order-3 flex items-center gap-3 shrink-0 ml-auto lg:ml-0 lg:justify-self-end">
                <span className="whitespace-nowrap bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-sm font-semibold px-3.5 py-1.5 rounded-full border border-blue-200 dark:border-blue-500/30" title={`${validated} of ${statements.length} statements validated`}>
                  {entries.length} file{entries.length === 1 ? '' : 's'}
                </span>
                <button type="button" onClick={toggleTheme} className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition text-base leading-none" title="Toggle Theme">{dark ? '☀️' : '🌙'}</button>
              </div>
            </nav>

            {/* Toolbar: search (input), reminder amount and the actions */}
            <div className="max-lg:mb-6 relative z-30 flex flex-wrap items-center gap-x-2.5 gap-y-2.5 bg-white dark:bg-slate-800/80 px-3 py-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs backdrop-blur-sm">
              {mainTab === 'input' ? (
                <div className="relative flex items-center w-full lg:w-auto lg:flex-1 lg:min-w-[8rem] lg:max-w-sm">
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search lines..." title="Show the lines that contain every word"
                    className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg pl-4 pr-8 py-2 w-full focus:outline-hidden focus:border-blue-500 text-sm placeholder-slate-400 dark:placeholder-slate-500 transition" />
                  {search ? <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-sm leading-none" title="Clear search" aria-label="Clear search">✕</button> : null}
                </div>
              ) : null}
              <button type="button" className="dd-trigger" onClick={() => setRemind(remind === 'balance' ? 'minimum' : 'balance')}
                title="The amount in the calendar reminders: the statement balance (no interest) or the minimum payment (no Late Fee)">
                <span className="dd-label">Remind to pay:</span><span className="dd-value">{remind === 'balance' ? 'statement balance' : 'minimum'}</span>
              </button>
              <span className="empty:hidden text-xs text-slate-500 dark:text-slate-400" aria-live="polite">{status}</span>

              <div className="flex flex-wrap items-center gap-1.5 w-full lg:w-auto lg:ml-auto justify-end shrink-0">
                <input ref={fileInput} type="file" accept=".pdf,application/pdf" multiple hidden onChange={e => { if (e.target.files?.length) void loadFiles(e.target.files); e.target.value = ''; }} />
                <button type="button" onClick={() => fileInput.current?.click()} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition active:scale-95" title="Load credit card statements (PDF), or drop them on the page; more loads add files">Load files</button>
                <button type="button" disabled={!entries.length} onClick={() => { setEntries([]); setStatus('Files cleared'); }} className={BTN_SLATE} title="Forget the loaded files">Clear</button>
                <button type="button" disabled={!upcomingReminders} onClick={addAllToCalendar}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-sm font-medium transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
                  title={`One .ics file with every upcoming payment: an all-day event on each Payment Due Date with alarms 3 days and 1 day before${leftOutText ? ` (${leftOutText})` : ''}`}>
                  Add all payments to calendar{upcomingReminders ? ` (${upcomingReminders})` : ''}
                </button>
              </div>
            </div>
          </div>

          {/* Sub tabs: one per input file, or All + one per report */}
          {entries.length ? (
            <div className={`${PANEL} px-3 py-2.5 flex flex-col items-center gap-2`}>
              <div role="tablist" className="flex flex-nowrap items-center [justify-content:safe_center] gap-1.5 overflow-x-auto py-0.5 max-w-full min-w-0 themed-scroll">
                {mainTab === 'input'
                  ? <Pills label="File" tabs={inputTabs} active={selectedInput?.name ?? ''} onPick={setInputFile} />
                  : <Pills label="Report" tabs={outputTabs} active={sheet} onPick={setOutputSheet} />}
              </div>
            </div>
          ) : null}

          <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs backdrop-blur-sm overflow-hidden relative">
            <div ref={scroll} id="content-scroll" className="overflow-x-auto overflow-y-auto themed-scroll">{content}</div>
          </div>
        </main>

        <footer className="px-4 sm:px-8 h-4 sm:h-8 flex items-center justify-center text-center text-xs leading-none text-slate-500 dark:text-slate-400">
          <a href="https://github.com/daggerok/credit-cards-reports" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-slate-800 dark:hover:text-slate-100">daggerok &copy; {new Date().getFullYear()}</a>
        </footer>
      </div>

      {dragging ? <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-blue-600/20 backdrop-blur-sm text-2xl font-semibold text-blue-700 dark:text-blue-300 pointer-events-none">Drop PDF statements to load them</div> : null}
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><App /></StrictMode>);
