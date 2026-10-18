// Statement text the way src/pdf-text.ts prints it, one per issuer, with made-up amounts, dates and card numbers
// (the layouts of real statements: columns of two panels merged into one line, amounts under header lines,
// BofA's purchases amount one baseline off its label). Real statements never go into the repo.
export const FIXTURES = {
  chase: `Manage your account online:  Customer Service:  Mobile:
www.chase.com/cardhelp  1-800-000-0000
New Balance
November 2026  CHASE FREEDOM UNLIMITED
$164.00
Minimum Payment Due
1  2  3  4  5  6  7  Previous points balance  1,000
$40.00
Payment Due Date  + 1.5%(1.5 Pts)/$1 addl on Dining purchases  600
11/01/26
ACCOUNT SUMMARY
Account Number: XXXX XXXX XXXX 1234
Previous Balance  $12.34
Payment, Credits  -$100.00
Purchases  +$250.50
Cash Advances  $0.00
Balance Transfers  $0.00
Fees Charged  $0.00
Interest Charged  $1.16
New Balance  $164.00
Opening/Closing Date  09/05/26 - 10/04/26
Credit Limit  $1,500
P.O. BOX 00000  Payment Due Date:  11/01/26
chase.com/paycard  New Balance:  $164.00
Minimum Payment Due:  $40.00
\f
Page 2 of 2
PURCHASE
10/01  AMAZON MKTPLACE  50.50`,

  capitalOne: `Page 1 of 4
Savor Credit Card | World Elite Mastercard ending in 1111
Sep 10, 2026 - Oct 10, 2026 | 31 days in Billing Cycle
Payment Information  Account Summary
Payment Due Date  For online and phone payments, the  Previous Balance  $50.00
deadline is 12 midnight ET, except
Nov 04, 2026  on the statement closing date when  Payments  - $50.00
Other Credits  - $5.00
Upcoming statement closing date:
Transactions  + $305.00
November 9, 2026
New Balance  Minimum Payment Due  Cash Advances  + $0.00
$300.00  $25.00  Fees Charged  + $0.00
Interest Charged  + $0.00
New Balance  = $300.00
Previous Balance  Earned This Period  Redeemed this period
$0.44  $19.87  -$5.00
Pay or manage your account at capitalone.com  Customer Service: 800-000-0000
Payment Due Date: Nov 04, 2026  Account ending in 1111`,

  citi: `Billing Inquiries and Customer Service
Citi Custom Cash® Card
www.citicards.com  Member Since 2020. Account number ending in: 2222
JULY STATEMENT
Billing Period: 06/04/26-07/03/26
New balance as of 07/03/26:  $120.00  Total Available ThankYou® Points
Minimum payment due:  $41.00
Payment due date:  08/01/26
Account Summary
Previous balance  $100.00
Late Payment Warning: If we do not receive your Minimum Payment  Payments  -$100.00
by the date listed above, you may have to pay a late fee of up to $41  Credits  -$2.00
and your APRs may be increased up to the Penalty APR of 29.99%.
Purchases  +$122.00
New York residents may contact the New York State Department of Financial  Cash advances  +$0.00
comparative credit card rates, fees and grace periods.  Fees  +$0.00
Interest  +$0.00
New balance  $120.00
Credit limit  $9,000`,

  bofa: `Customer Service Information:
www.bankofamerica.com
Visa Signature®
Account# XXXX XXXX XXXX 3333
May 20 - June 19, 2026
Account Summary/Payment Information  New Balance Total  $10.00
Current Payment Due  $10.00
Previous Balance  -$2.00
Payments and Other Credits  -$30.00  Total Minimum Payment Due  $10.00
$42.00  Payment Due Date  07/16/2026
Purchases and Adjustments
Fees Charged  $0.00
Interest Charged  $0.00
New Balance Total  $10.00  Late Payment Warning: If we do not receive your Total Minimum
Statement Closing Date  06/19/2026
Days in Billing Cycle  31`,

  amex: `Blue Cash Everyday® from American Express  p. 1/6
Closing Date 05/07/26  TTY:  Use Relay 711
Account Ending 0-04444  Website:  americanexpress.com
New Balance  $15.00  as of 04/07/2026
Minimum Payment Due  $15.00  0.48
Payment Due Date  06/01/26  Account Summary
Previous Balance  $0.00
Late Payment Warning: If we do not receive your Minimum Payment Due by  Payments/Credits  -$500.00
the Payment Due Date of 06/01/26, you may have to pay a late fee of up to  New Charges  +$515.00
$40.00 and your APRs may be increased to the Penalty APR of 29.99%.  Fees  +$0.00
Interest Charged  +$0.00
New Balance  $15.00`,

  apple: `Statement
Apple Card Co-Owners
Feb 1 — Feb 28, 2026
Your February Balance  Minimum  Payment
as of Feb 28, 2026  Payment Due  Due By
$900.00  $25.00  Mar 31, 2026
Previous Monthly Balance  $100.00
as of Jan 31, 2026
Previous Total Balance  $100.00
as of Jan 31, 2026
Total Balance  $900.00
as of Feb 28, 2026
Apple Card is issued by Goldman Sachs Bank USA, Salt Lake City Branch.
Page 1 /6
\f
Account Activity
Total payments for this period  -$200.00
Total charges, credits, and returns for this period  $1,000.00
Interest Charged
Total interest for this month  $0.00`,
};
