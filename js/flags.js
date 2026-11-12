// Things an aid letter does that make it look better than it is. Each flag
// points at the line or sentence that triggered it.
import { RULES, LOAN_KIND } from './rules.js';

const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');

export function flagsFor(letter, r) {
  const out = [];
  const add = (level, title, detail, lineIds = []) => out.push({ level, title, detail, lineIds });
  const lines = letter.lines;

  if (r.loans > 0 && r.reportedAid > 0) {
    const pct = Math.round((r.loans / r.reportedAid) * 100);
    // "Covers 100% of your costs" only adds up with the loans counted in.
    const claim = (letter.claims || [])[0];
    const claimed = claim && r.coa > 0 ? ` The letter says "${claim}". That counts the loans${r.work ? ' and work-study' : ''}; gift aid alone covers ${Math.round((r.gift / r.coa) * 100)}% of the costs it lists.` : '';
    add('warn', `${pct}% of the "aid" is debt`, `${usd(r.loans)} of the ${usd(r.reportedAid)} listed as aid is loans that someone repays with interest. Only ${usd(r.gift)} is free money.${claimed}`, lines.filter((l) => l.category === 'loan').map((l) => l.id));
  }

  if (r.loansBy.plus > 0) {
    add('warn', 'A Parent PLUS loan is in the package', `${usd(r.loansBy.plus)} is a loan to your parent, not to you, at ${(RULES.rates.plus * 100).toFixed(2)}% with a ${(RULES.fees.plus * 100).toFixed(3)}% fee taken up front. Schools often add it to make the gap look closed. Your parent has to apply and can be turned down.`, lines.filter((l) => l.kind === 'plus').map((l) => l.id));
    if (r.loansBy.plus > RULES.parentPlusAnnualCap) add('warn', 'Parent PLUS above the yearly cap', `Parent PLUS is capped at ${usd(RULES.parentPlusAnnualCap)} a year for new loans from July 2026. This letter lists ${usd(r.loansBy.plus)}.`);
  }

  if (r.loansBy.private > 0) {
    add('warn', 'A private loan is in the package', `${usd(r.loansBy.private)} looks like a private or school loan. Those usually need a credit check or cosigner, and lack federal protections like income-driven repayment. The rate here is a placeholder: check the lender's real rate.`, lines.filter((l) => l.kind === 'private').map((l) => l.id));
  }

  const direct = r.loansBy.sub + r.loansBy.unsub;
  if (direct > RULES.directLimit[0]) add('warn', 'Federal loans above the first-year limit', `A dependent first-year student can borrow at most ${usd(RULES.directLimit[0])} in Direct Loans. This letter lists ${usd(direct)}. Ask the office what it assumes.`);
  if (r.loansBy.sub > RULES.subLimit[0]) add('warn', 'Subsidized loan above the first-year limit', `The first-year subsidized limit is ${usd(RULES.subLimit[0])}; this letter lists ${usd(r.loansBy.sub)}.`);

  if (r.work > 0) add('info', 'Work-study is a job, not a discount', `${usd(r.work)} is paid as paychecks for hours worked during the year, if you find a work-study job. It can't pay the first bill.`, lines.filter((l) => l.category === 'work').map((l) => l.id));

  if (r.counts.cost === 0) add('warn', 'No costs listed', 'The letter lists aid but no costs, so there is nothing to subtract it from. Add the cost of attendance from the school\'s website under Every line.');
  else if (r.indirect === 0 && !lines.some((l) => l.category === 'cost' && /cost of attendance|\bCOA\b/i.test(l.label))) add('warn', 'Only billed costs are listed', 'The letter shows tuition, fees or housing but no books, transportation or personal costs. Those are real and land on you. Add the school\'s published figures under Every line to see the full year.');

  const firstYear = lines.filter((l) => l.category === 'gift' && l.firstYearOnly);
  if (firstYear.length) add('warn', 'Some aid is first-year only', `${firstYear.map((l) => l.label).join(', ')} won't come back after year one. The 4-year totals already drop it.`, firstYear.map((l) => l.id));

  for (const c of letter.conditions || []) {
    if (/GPA|grade point|\d\.\d/.test(c) && !/first|one[-\s]time|non[-\s]?renew/i.test(c)) add('info', 'Renewal has conditions', `"${c.slice(0, 220)}" If you miss it, that award stops and the gap grows.`);
  }

  // A total has to equal something the lines add up to: the year, or one of
  // the usual subtotals (billed costs, federal loans, loans plus work-study...).
  const totals = lines.filter((l) => l.total);
  const candidates = [r.coa, r.direct, r.indirect, r.gift, r.reportedAid, r.netPrice, r.outOfPocket, r.loans, r.studentLoans, r.loansBy.sub + r.loansBy.unsub, r.work, r.loans + r.work, r.netPrice - r.work];
  for (const t of totals) {
    const close = candidates.some((c) => Math.abs(c - t.annual) <= 2);
    if (!close && t.annual > 0) add('info', 'A total on the letter doesn\'t match its lines', `"${t.label}" says ${usd(t.annual)}, but the lines add up differently. Check whether it counts loans as aid, or leaves costs out.`, [t.id]);
  }

  if (r.outOfPocket > 0) add('warn', `${usd(r.outOfPocket)} a year still isn't covered`, 'After gift aid, the loans offered and work-study, this is what the family still has to find each year.');
  else if (r.outOfPocket < -50 && r.loans > 0 && r.counts.cost > 0) add('info', 'The loans cover more than the bill', `Aid exceeds the listed costs by ${usd(-r.outOfPocket)}. You don't have to take every loan offered; borrowing less saves interest.`);

  const guessed = lines.filter((l) => l.guessed && l.category !== 'info');
  if (guessed.length) add('info', 'Some lines were guessed from their section', `Check: ${guessed.map((l) => `"${l.label}"`).join(', ')}.`, guessed.map((l) => l.id));

  const unread = lines.filter((l) => l.guessed && l.category === 'info' && !l.total);
  if (unread.length) add('info', unread.length === 1 ? 'One line isn\'t counted' : `${unread.length} lines aren't counted`, `The reader couldn't tell what ${unread.map((l) => `"${l.label}" (${usd(l.annual)})`).join(', ')} ${unread.length === 1 ? 'is' : 'are'}. If one is aid or a cost, set its category under Every line.`, unread.map((l) => l.id));

  return out;
}

export { LOAN_KIND };
