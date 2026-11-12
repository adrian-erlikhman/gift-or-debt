// Writes the questions a family should ask the aid office, from the flags.
// Deterministic, so it works with no key; Claude can only reword it.
import { RULES } from './rules.js';

const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

export function draftEmail(letter, r) {
  const qs = [];
  if (r.loans > 0) qs.push(`My offer lists ${usd(r.reportedAid)} in aid, of which ${usd(r.loans)} is loans. Could you confirm which awards are grants or scholarships I don't repay?`);
  if (r.loansBy.plus > 0) qs.push(`The offer includes a ${usd(r.loansBy.plus)} Parent PLUS loan. If my parent can't borrow that amount, what other aid could fill that part?`);
  if (r.loansBy.private > 0) qs.push(`One loan of ${usd(r.loansBy.private)} looks like a private or institutional loan. What is its interest rate, and does it need a cosigner?`);
  if (r.indirect === 0 && r.counts.cost > 0) qs.push('The letter lists billed costs only. What does the school estimate for books, transportation and personal expenses?');
  const firstYear = letter.lines.filter((l) => l.category === 'gift' && l.firstYearOnly);
  for (const l of firstYear) qs.push(`Is the ${l.label.replace(/\*$/, '')} (${usd(l.annual)}) for my first year only? If so, what replaces it after that?`);
  const gpa = (letter.conditions || []).find((c) => /GPA|grade point|\d\.\d/.test(c));
  if (gpa) qs.push('What happens to my scholarship if my GPA falls below the renewal requirement for one term? Is there a probation period?');
  if (r.work > 0) qs.push(`If I can't find a work-study job, can the ${usd(r.work)} in work-study be replaced with other aid?`);
  if (r.outOfPocket > 0) qs.push(`After grants, loans and work-study there is still ${usd(r.outOfPocket)} a year left to pay. Is there a payment plan, or can you review my aid?`);
  if (r.loansBy.sub + r.loansBy.unsub > RULES.directLimit[0]) qs.push('The federal loans listed are above the first-year Direct Loan limit I found. Could you check that amount?');
  qs.push('Do these amounts stay the same each year if my family\'s finances stay the same?');

  const body = [
    `Dear ${letter.school} Financial Aid Office,`,
    '',
    `Thank you for my financial aid offer. Before I decide, I want to make sure I understand it. I have a few questions:`,
    '',
    ...qs.map((q, i) => `${i + 1}. ${q}`),
    '',
    'Thank you for your help.',
    '',
    '[Your name]',
    '[Student ID]',
  ].join('\n');
  return { subject: `Questions about my 2026–27 financial aid offer`, body };
}
