# Gift or Debt

College financial aid letters call loans "aid." Gift or Debt reads an offer, separates the money you keep from the money you repay, works out what four years really cost, and drafts the questions to ask the aid office.

**Live: https://adrian-erlikhman.github.io/gift-or-debt/** · [three sample offers](https://adrian-erlikhman.github.io/gift-or-debt/?demo=1) · [compared](https://adrian-erlikhman.github.io/gift-or-debt/?demo=1&view=compare)

Everything runs in the browser. There is no server and no account. Nothing you paste leaves the page unless you turn on Claude with your own API key.

## Why

A typical offer lists grants, scholarships, federal loans, a Parent PLUS loan and work-study in one column under "Your Financial Aid," adds them up, and sometimes announces that 100% of your costs are covered. Some of that money is a gift. Much of it is debt, and some of it is a job you may not get. Letters also leave out books and transportation, label first-year-only awards the same as renewable ones, and show fall and spring columns that are easy to misread.

## What it does

- **Reads the letter.** Paste text, or drop in a PDF. Rules find every dollar amount and what it is: cost (billed or not), gift aid, a loan (subsidized, unsubsidized, Parent PLUS, private) or work-study. Totals are set aside and checked against the lines. Fall/spring/total columns and "per semester" amounts become a year. Each line keeps the text it came from, and you can change any category or amount.
- **Splits the offer.** One bar: gift aid, student loans, Parent PLUS, work-study, and what's still not covered.
- **Does four years.** Net price is cost of attendance minus gift aid. Costs grow by an assumed rate you can change. First-year-only awards drop off after year one. Borrowing repeats. Interest builds on unsubsidized, private and Parent PLUS loans while you're in school. Debt at graduation and the 10-year monthly payment follow.
- **Flags the tricks.** Loans counted as aid; a Parent PLUS loan closing the gap (and above the $20,000 yearly cap for new loans from July 2026); private loans; federal loans above the first-year limit; missing books, transportation and personal costs; first-year-only awards; GPA renewal conditions; totals that don't match their lines; work-study counted like a discount; a gap still left to pay.
- **Compares offers.** Ranked by four-year true cost: net price plus loan fees plus in-school interest.
- **Drafts the email.** Polite, specific questions for the aid office, built from what this letter actually does.

## Where Claude fits

Optional, with your own key, held only in the tab:

1. **Reading what the rules can't:** a photo of a paper letter, a scanned PDF, an unusual layout. Claude returns line items as JSON. Before the page uses a line, its amount has to appear in the letter's text, so a number the model invents or misreads is dropped (`checkRead` in `js/ai.js`, tested). Lines read from a photo can't be checked that way, so each one is marked for you to confirm.
2. **Rewording the email.** Claude can rewrite the draft more naturally. Every dollar figure in its version has to appear in the draft, or the draft is kept.

Claude never does the math. Every number on the page comes from `js/money.js`.

## Loan terms

For loans first disbursed July 1, 2026 to June 30, 2027 (Federal Student Aid electronic announcement GENERAL-26-33): 6.52% for undergraduate Direct Subsidized and Unsubsidized Loans with a 1.057% origination fee, 9.07% for Parent PLUS with a 4.228% fee. Dependent first-year Direct Loan limit $5,500 ($3,500 subsidized). Payments use the standard 10-year plan. All of these are editable under Assumptions.

These are estimates to check with the school, not financial advice.

## Run it

No build step.

```
npx http-server . -p 4173 -c-1
npm test
```

## Layout

```
index.html        the page
css/style.css
js/rules.js       federal rates, fees and limits
js/parse.js       letter text -> line items, rules only
js/money.js       net price, four years, interest, payments, ranking
js/flags.js       what the letter does that makes it look better than it is
js/email.js       questions for the aid office
js/ai.js          optional Claude reading and rewording, with checks
js/samples.js     three fictional offers in three common layouts
js/app.js         interface
vendor/pdfjs      Mozilla pdf.js (Apache 2.0) for reading PDFs in the browser
test/test.mjs     parser, math, flags, Claude-output checks
```

## Limits

- The rules reader handles the layouts in `js/samples.js` and ones like them. Unusual letters may need a category fixed by hand, or Claude.
- Four-year figures assume the same aid and borrowing each year, flat gift aid in dollars and a constant cost increase. Real offers change with each year's FAFSA.
- Interest during school is simple interest from disbursement to the end of the grace period; it ignores payments made in school.
- The private-loan rate is a placeholder. Use your lender's.

## Credits

Built by Adrian Erlikhman and Michael Tarekegn in November 2026. Built with Claude Code as a coding assistant. PDF reading by [pdf.js](https://mozilla.github.io/pdf.js/). The sample schools are fictional. MIT licensed.
