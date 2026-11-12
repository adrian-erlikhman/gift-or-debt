// All of the arithmetic. Deterministic, no model, and every figure on the page
// comes from here.
import { RULES } from './rules.js';

const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const r2 = (x) => Math.round(x * 100) / 100;

export function monthlyPayment(balance, rate, months = RULES.repaymentMonths) {
  if (balance <= 0) return 0;
  const i = rate / 12;
  if (i === 0) return balance / months;
  return (balance * i) / (1 - Math.pow(1 + i, -months));
}

// Months from a loan's disbursement (August of year y, counting from 0) to the
// first payment: graduation in May of the last year, then the grace period.
export function monthsToRepayment(y, years = 4, grace = RULES.graceMonths) {
  return (years - y) * 12 - 3 + grace;
}

export const DEFAULTS = {
  years: 4,
  costGrowth: 0.03,
  rates: { ...RULES.rates },
  fees: { ...RULES.fees },
  repaymentMonths: RULES.repaymentMonths,
};

export function analyze(letter, opts = {}) {
  const o = { ...DEFAULTS, ...opts, rates: { ...DEFAULTS.rates, ...(opts.rates || {}) }, fees: { ...DEFAULTS.fees, ...(opts.fees || {}) } };
  const lines = letter.lines.filter((l) => !l.total && l.category !== 'info' && l.annual > 0);
  const of = (cat) => lines.filter((l) => l.category === cat);

  const costLines = of('cost');
  const giftLines = of('gift');
  const loanLines = of('loan');
  const workLines = of('work');

  const direct = sum(costLines.filter((l) => l.direct !== false).map((l) => l.annual));
  const indirect = sum(costLines.filter((l) => l.direct === false).map((l) => l.annual));
  const coa = direct + indirect;
  const gift = sum(giftLines.map((l) => l.annual));
  const giftRenewing = sum(giftLines.filter((l) => !l.firstYearOnly).map((l) => l.annual));
  const work = sum(workLines.map((l) => l.annual));
  const loansBy = { sub: 0, unsub: 0, plus: 0, private: 0 };
  for (const l of loanLines) loansBy[l.kind || 'private'] += l.annual;
  const loans = sum(Object.values(loansBy));
  const studentLoans = loansBy.sub + loansBy.unsub + loansBy.private;
  const reportedAid = gift + loans + work;

  const netPrice = coa - gift; // what the year costs after free money
  const outOfPocket = netPrice - loans - work; // still unpaid after loans and the job

  // Four years. Costs grow by the assumed rate; gift aid stays flat in dollars
  // (most awards do) and first-year-only awards drop off; borrowing repeats.
  const perYear = [];
  const debt = { sub: 0, unsub: 0, plus: 0, private: 0 };
  const interest = { sub: 0, unsub: 0, plus: 0, private: 0 };
  for (let y = 0; y < o.years; y++) {
    const cost = coa * Math.pow(1 + o.costGrowth, y);
    const g = y === 0 ? gift : giftRenewing;
    const borrowed = { ...loansBy };
    for (const k of Object.keys(borrowed)) {
      debt[k] += borrowed[k];
      if (k !== 'sub') interest[k] += borrowed[k] * o.rates[k] * (monthsToRepayment(y, o.years) / 12);
    }
    const yl = sum(Object.values(borrowed));
    perYear.push({ year: y + 1, cost: r2(cost), gift: r2(g), net: r2(cost - g), loans: r2(yl), work: r2(work), outOfPocket: r2(cost - g - yl - work) });
  }

  const studentKinds = ['sub', 'unsub', 'private'];
  const atRepayment = (kinds) => sum(kinds.map((k) => debt[k] + interest[k]));
  const payment = (kinds) => sum(kinds.map((k) => monthlyPayment(debt[k] + interest[k], o.rates[k], o.repaymentMonths)));
  const studentBalance = atRepayment(studentKinds);
  const parentBalance = atRepayment(['plus']);
  const studentMonthly = payment(studentKinds);
  const parentMonthly = payment(['plus']);
  const feesTaken = sum(Object.keys(loansBy).map((k) => loansBy[k] * o.fees[k]));

  return {
    school: letter.school,
    coa: r2(coa),
    direct: r2(direct),
    indirect: r2(indirect),
    gift: r2(gift),
    giftRenewing: r2(giftRenewing),
    loans: r2(loans),
    loansBy: Object.fromEntries(Object.entries(loansBy).map(([k, v]) => [k, r2(v)])),
    studentLoans: r2(studentLoans),
    work: r2(work),
    reportedAid: r2(reportedAid),
    giftShare: reportedAid ? gift / reportedAid : 0,
    netPrice: r2(netPrice),
    outOfPocket: r2(outOfPocket),
    perYear,
    fourYear: {
      cost: r2(sum(perYear.map((p) => p.cost))),
      gift: r2(sum(perYear.map((p) => p.gift))),
      net: r2(sum(perYear.map((p) => p.net))),
      borrowed: r2(sum(Object.values(debt))),
      outOfPocket: r2(sum(perYear.map((p) => p.outOfPocket))),
      fees: r2(feesTaken * o.years),
    },
    debt: {
      studentPrincipal: r2(sum(studentKinds.map((k) => debt[k]))),
      studentAtRepayment: r2(studentBalance),
      studentMonthly: r2(studentMonthly),
      studentTotalRepaid: r2(studentMonthly * o.repaymentMonths),
      parentPrincipal: r2(debt.plus),
      parentAtRepayment: r2(parentBalance),
      parentMonthly: r2(parentMonthly),
      parentTotalRepaid: r2(parentMonthly * o.repaymentMonths),
      interestInSchool: r2(sum(Object.values(interest))),
    },
    feesTaken: r2(feesTaken),
    assumptions: o,
    counts: { cost: costLines.length, gift: giftLines.length, loan: loanLines.length, work: workLines.length },
  };
}

// Rank offers by what four years cost the family: the net price, plus the
// loan fees and the interest that borrowing adds before anyone has paid a cent
// of it back.
export function trueCost(r) {
  return r.fourYear.net + r.debt.interestInSchool + r.fourYear.fees;
}

export function compare(results) {
  const score = trueCost;
  const ranked = [...results].sort((a, b) => score(a) - score(b));
  const best = ranked[0];
  return ranked.map((r) => ({ school: r.school, score: r2(score(r)), moreThanBest: r2(score(r) - score(best)) }));
}
