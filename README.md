# Credit Cards Reports

Credit card statements (PDF) read in the browser with no AI: fixed label patterns per issuer, a balance check to the cent, what to pay by when and calendar reminders. Chase (Freedom, Amazon Prime Visa), Capital One (Savor, Quicksilver), Citi, Bank of America, American Express and Apple Card (Goldman Sachs)

Live: https://daggerok.github.io/credit-cards-reports/

## Using the app

- **Load files** (or drop PDF files on the page): every file is read with pdf.js and parsed right away; more loads add files, a file with the same name is replaced, **Clear** forgets them
- **Input** tab: one sub tab per file with the text lines the parser saw (line, page, text); the lines a field came from are marked with the field name, **Search lines** filters them
- **Output** tab: **All** shows the upcoming payments (nearest due date first, past ones greyed, totals of the statement balances and minimums still due) and every report; `1`, `2`, ... show one report each
- A report (one per file):
  - Statement Closing Date, Payment Due Date (and how many days are left), Statement Balance, Minimum Payment Due
  - Сценарий 1, избежать Late Fee: "Чтобы избежать Late Fee, внеси минимум $X.XX до [Due Date]." ("Платеж не требуется, Late Fee не грозит." when the minimum is $0.00)
  - Сценарий 2, избежать Interest Charges: "Чтобы не платить проценты, внеси полный Statement Balance $Y.YY до [Due Date]." and "Покупки, сделанные после [Statement Closing Date], входят в следующий период и гасить их сейчас не нужно."
  - Calendar: **Apple Calendar / Outlook / iCal (.ics)** is one all-day event on the due date with alarms at 09:00 3 days and 1 day before; **Google** and **Outlook.com** links cannot carry alarms, so each link is the reminder itself: an event at 09:00 3 days (or 1 day) before the due date. Title: "Оплатить $[amount] по карте [Bank Card ·Last 4] (Due Date: [Date])"
  - **Parsed raw data & math check**: every field, the parts it sums and the line each one came from, and the check (open by default when it fails)
- **Remind to pay**: the amount in the reminders, the statement balance (no interest) or the minimum (no Late Fee)
- **Add all payments to calendar**: one `.ics` with every upcoming payment (due dates already past are left out)
- Nothing leaves the browser and nothing is stored: the files are gone after a reload; only the theme, the main tab and the reminder amount are kept in localStorage

## Math verification

`Calculated New Balance = Previous Balance - Payments & Credits + Purchases & Charges + Fees + Interest`, in integer cents. Equal to the New Balance of the PDF and every field found: `VALIDATED`; otherwise `PARSING ERROR / UNVERIFIED` with the difference (a missed line or a wrong sign) or the fields not found

| Issuer | Payments & Credits | Purchases & Charges | Fees, Interest | Notes |
|---|---|---|---|---|
| Chase | Payment, Credits | Purchases + Cash Advances + Balance Transfers | Fees Charged, Interest Charged | due date and minimum from the payment coupon |
| Capital One | Payments + Other Credits | Transactions + Cash Advances | Fees Charged, Interest Charged | minimum from the `New Balance  Minimum Payment Due` columns |
| Citi | Payments + Credits | Purchases + Cash advances | Fees, Interest | closing date = end of the Billing Period |
| Bank of America | Payments and Other Credits | Purchases and Adjustments (+ Balance Transfers, Cash Advances) | Fees Charged, Interest Charged | the purchases amount sits one line off its label |
| American Express | Payments/Credits | New Charges | Fees, Interest Charged | last 4 of the 5 digits Amex prints |
| Apple Card | Total payments for this period | Total charges, credits, and returns for this period | no fees, Total interest for this month | totals over every co-owner; Statement Balance = the monthly balance; no card number on the statement |

## How the parser works

`src/pdf-text.ts` turns each page into lines (text items grouped by baseline, a wide gap becomes two spaces). `src/parser.ts` detects the issuer on page 1 and runs its table of finders, first hit wins (lines top to bottom, so the page 1 summary beats later pages):

- `label`: the amount right after the label on the same line (`New Balance  $224.57`, `Payments  - $340.00`, `New Balance  = $331.05`); when no line has one, a label alone at the end of a line takes an amount that starts the line above or below
- `column`: the n-th value of the first line starting with `$` under a header line (Capital One and Apple print amounts under their labels)
- `constant`: a field the issuer does not print (Apple Card has no fees)
- optional parts (Cash Advances, Balance Transfers) count as 0 when the statement has no such line

A new issuer or layout: `bun scripts/extract-text.ts statement.pdf --out /some/dir/outside/the/repo` prints the lines the browser sees; add an entry to `ISSUERS` and a made-up fixture to `src/fixtures.ts`

## Statements stay private

The repo is public. A statement or a card number never gets into a commit or the site:

- `*.pdf` and `statements/` are ignored; tests use made-up text in `src/fixtures.ts`
- `bun run check`: exit 1 while any file git would commit is a PDF or holds a card-number-like value (4 groups of digits or 15-16 digits, Luhn-valid); `check-history` does the same over every commit, `check-dist` over the built site
- git hooks in `.githooks/` (set by `bun install` through `prepare`): `pre-commit` refuses a staged PDF or card number, `pre-push` re-checks the tree and the history; both fail closed without bun. Build, serve and `bun test` stop when the hooks are off (`check-hooks`); CI runs `check` and `check-history` before the tests and the build

## Development

```bash
bun install -E
bun test                                                # parser, math check, scenarios, .ics and links, guard
STATEMENTS_DIR=/path/to/pdfs bun test src/statements.test.ts   # your real statements, local only: every one must be VALIDATED
bun run serve                                           # http://localhost:1234
bun run build                                           # Parcel build into dist/
```

Layout (same shape as fidelity-reports):

- `src/index.html`, `src/index.css`, `src/main.tsx`, `src/favicon.ico`: the page, React and Tailwind 4 in the fidelity-reports look (Input / Output tabs, file loading, drop on the page)
- `src/parser.ts`: the issuers and the engine, pure; `src/report.ts`: scenarios and the upcoming list; `src/calendar.ts`: `.ics` and the Google and Outlook links
- `src/pdf.ts`: pdf.js in the browser; `scripts/copy-worker.ts` copies the prebuilt pdf.js worker into `dist/` (bundled by Parcel it breaks)
- `scripts/check-private.ts`: the guard; `scripts/extract-text.ts`: the text of a PDF for writing a parser

## License

MIT
