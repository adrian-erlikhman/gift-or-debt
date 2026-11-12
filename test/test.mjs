import assert from 'node:assert/strict';
import { parseLetter, classify, loanKind } from '../js/parse.js';
import { analyze, monthlyPayment, compare, trueCost } from '../js/money.js';
import { flagsFor } from '../js/flags.js';
import { SAMPLES } from '../js/samples.js';
import { checkRead } from '../js/ai.js';
import { draftEmail } from '../js/email.js';

let passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name); throw e; }
};
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const run = (i) => { const l = parseLetter(SAMPLES[i].text, SAMPLES[i].name); return { l, r: analyze(l), f: flagsFor(l, analyze(l)) }; };

t('classify basics', () => {
  assert.equal(classify('Federal Pell Grant').category, 'gift');
  assert.equal(classify('Federal Direct Unsubsidized Loan').kind, 'unsub');
  assert.equal(classify('Federal Direct Subsidized Loan').kind, 'sub');
  assert.equal(classify('Federal Direct Parent PLUS Loan').kind, 'plus');
  assert.equal(classify('Loan fees').category, 'cost');
  assert.equal(classify('Federal Work-Study').category, 'work');
  assert.equal(classify('Total Aid Offered').total, true);
  assert.equal(classify('Student Aid Index (SAI)').category, 'info');
  assert.equal(classify('Housing and food').direct, true);
  assert.equal(classify('Books and supplies').direct, false);
  assert.equal(loanKind('Mesa Ridge Partner Loan (private)'), 'private');
});

t('Harbor State: clean table', () => {
  const { l, r, f } = run(0);
  assert.equal(l.school, 'Harbor State University');
  near(r.coa, 36400);
  near(r.gift, 13800);
  near(r.loans, 5500);
  near(r.work, 2500);
  near(r.netPrice, 22600);
  near(r.outOfPocket, 14600);
  near(r.reportedAid, 21800);
  assert.ok(f.some((x) => /% of the "aid" is debt/.test(x.title)));
  assert.ok(!f.some((x) => /total on the letter/i.test(x.title)), 'Total Aid Offered matches the lines');
  assert.ok(!f.some((x) => /Only billed costs/.test(x.title)));
});

t('Linden: hides the Parent PLUS and the indirect costs', () => {
  const { l, r, f } = run(1);
  assert.equal(l.school, 'Linden College');
  near(r.coa, 80300);
  near(r.gift, 43000);
  near(r.loansBy.plus, 28800);
  near(r.loans, 34300);
  near(r.outOfPocket, 0);
  assert.ok(f.some((x) => /Parent PLUS loan is in/.test(x.title)));
  assert.ok(f.some((x) => /above the yearly cap/.test(x.title)));
  assert.ok(f.some((x) => /Only billed costs/.test(x.title)));
  assert.ok(f.some((x) => /Renewal has conditions/.test(x.title)));
  assert.ok(!l.lines.some((x) => x.annual === 100), 'the 100% is not money');
});

t('Mesa Ridge: fall/spring columns and footnotes', () => {
  const { l, r, f } = run(2);
  assert.equal(l.school, 'Mesa Ridge University');
  near(r.coa, 53130);
  near(r.gift, 21900);
  near(r.loansBy.private, 8000);
  near(r.loans, 13500);
  near(r.outOfPocket, 17730);
  const welcome = l.lines.find((x) => /Welcome/.test(x.label));
  assert.ok(welcome.firstYearOnly, 'Welcome Grant is first-year only');
  near(r.giftRenewing, 17900);
  assert.ok(f.some((x) => /first-year only/.test(x.title)));
  assert.ok(f.some((x) => /private loan/.test(x.title)));
  assert.ok(!f.some((x) => /total on the letter/i.test(x.title)), 'Total Aid and Remaining balance both match');
  near(r.perYear[1].gift, 17900);
});

t('semester amounts get annualized', () => {
  const l = parseLetter(`Pine University\nAll amounts shown are per semester.\nTuition $10,000\nPell Grant $3,000`);
  const r = analyze(l);
  near(r.coa, 20000);
  near(r.gift, 6000);
});

t('Fall and Spring columns with no Total column are added, even when equal', () => {
  const l = parseLetter('Pine University\n                 Fall      Spring\nTuition          $10,000   $10,000\nPell Grant       $1,450    $1,300\nDirect Subsidized Loan $1,750 $1,750');
  const r = analyze(l);
  near(r.coa, 20000);
  near(r.gift, 2750);
  near(r.loansBy.sub, 3500);
});

t('three quarter columns are added; a line can name its own terms', () => {
  const q = analyze(parseLetter('Coast University\nCost              Fall     Winter   Spring\nTuition           $5,000   $5,000   $5,000\nUniversity Grant  $2,000   $2,000   $2,000'));
  near(q.coa, 15000);
  near(q.gift, 6000);
  const l = parseLetter('Oak College\nTuition: Fall 2026 $9,000 / Spring 2027 $9,000\nMerit Scholarship: Fall 2026 $3,000, Spring 2027 $3,000');
  near(analyze(l).coa, 18000);
  near(analyze(l).gift, 6000);
  assert.equal(l.lines[0].label, 'Tuition');
});

t('years, GPAs and percentages are not money', () => {
  const l = parseLetter('Oak College\n2026-27 award, renew with GPA 3.0 and 12 credits\nTuition $40,000\n100% of need met');
  assert.equal(l.lines.length, 1);
  near(l.lines[0].annual, 40000);
});

t('amortization matches the standard formula', () => {
  near(monthlyPayment(10000, 0.0652), 113.6, 0.2);
  near(monthlyPayment(0, 0.05), 0);
  near(monthlyPayment(1200, 0, 120), 10);
});

t('subsidized loans accrue nothing in school; unsubsidized do', () => {
  const sub = analyze({ school: 'A', lines: [{ category: 'loan', kind: 'sub', annual: 3500 }] });
  const unsub = analyze({ school: 'B', lines: [{ category: 'loan', kind: 'unsub', annual: 3500 }] });
  near(sub.debt.interestInSchool, 0);
  assert.ok(unsub.debt.interestInSchool > 1500 && unsub.debt.interestInSchool < 3000, String(unsub.debt.interestInSchool));
  near(sub.debt.studentPrincipal, 14000);
});

t('compare ranks by four-year true cost', () => {
  const rs = SAMPLES.map((s) => analyze(parseLetter(s.text, s.name)));
  const c = compare(rs);
  assert.equal(c[0].moreThanBest, 0);
  for (let i = 1; i < c.length; i++) assert.ok(c[i].score >= c[i - 1].score);
  assert.equal(c[0].score, Math.round(trueCost(rs.find((r) => r.school === c[0].school)) * 100) / 100);
});

t('Claude output is only kept when its amount is in the letter', () => {
  const src = 'Federal Pell Grant $4,600.00\nDirect Unsubsidized Loan $2,000';
  const out = checkRead({ lines: [
    { label: 'Pell', amount_text: '$4,600', amount: 4600, period: 'year', category: 'gift' },
    { label: 'Invented', amount_text: '$9,999', amount: 9999, period: 'year', category: 'gift' },
    { label: 'Partial', amount_text: '600', amount: 600, category: 'gift' },
    { label: 'Unsub', amount_text: '$2,000', amount: 2000, period: 'semester', category: 'loan_unsub' },
  ] }, src, false);
  assert.deepEqual(out.lines.map((l) => l.label), ['Pell', 'Unsub']);
  near(out.lines[1].annual, 4000);
  assert.equal(out.lines[1].kind, 'unsub');
  assert.equal(out.dropped.length, 2);
});

t('the email asks about what the letter actually does', () => {
  const l = parseLetter(SAMPLES[1].text, SAMPLES[1].name);
  const { body } = draftEmail(l, analyze(l));
  assert.match(body, /Parent PLUS loan/);
  assert.match(body, /books, transportation/);
  assert.match(body, /\$28,800/);
  assert.doesNotMatch(body, /private or institutional/);
});

console.log(`${passed} tests passed`);
