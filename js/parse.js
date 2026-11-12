// Reads the text of a financial aid offer into line items. Rules only, no
// model: every amount it reports was found in the text, and every line keeps
// the words it came from so a person can check it.

const MONEY = /\$\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\$\s*\d+(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b|\b\d{3,6}(?:\.\d{2})?\b/g;

const TOTAL = /\b(total|subtotal|net (price|cost)|estimated (net|cost|balance)|remaining|balance due|amount due|you (will )?owe|cost after|after aid|out[-\s]of[-\s]pocket|gap(?! year))/i;
// "Cost of Attendance", "Cost of Attendance (COA)", "Total COA": the sum of the costs.
const COA = /^(estimated\s+|total\s+|annual\s+|your\s+)*(cost of attendance|COA|student budget)(\s*\([^)]*\))?(\s*(\/\s*yr|per year|for the year))?$/i;
// Figures a letter shows that are neither aid nor a cost: what the family is
// expected to pay, the need left over, a payment plan.
const INFO = /\b(student aid index|SAI|expected family contribution|EFC|(family|parents?|parent's|parents'|student|student's|expected) contributions?|household|adjusted gross|AGI|payment plans?|summer earnings)\b/i;
const NEED = /\b((unmet|remaining|demonstrated|financial|calculated) need|need met)\b/i;
const GIFT_NAME = /\b(grants?|scholarships?|awards?)\b/i;

const LOAN = /\b(loans?|stafford|perkins|direct sub(sidized)?|direct unsub(sidized)?|subsidized|unsubsidized|alternative financing|private (education )?financing)\b/i;
// "Parent PLUS", "PLUS loan", "Direct PLUS". A plain "Plus" can be part of a
// grant's name ("Opportunity Plus Grant"), so lowercase needs a loan word next to it.
const PLUS_LOAN = /\bparents?'?\s+plus\b|\bplus\s+loans?\b|\b(direct|federal)\s+(parent\s+)?plus\b/i;
const WORK = /\b(work[-\s]?study|FWS|federal work|(student|campus|on[-\s]campus|part[-\s]time) (employment|jobs?|work)|work (program|award))\b/i;
const GIFT = /\b(grants?|scholarships?|pell|SEOG|FSEOG|cal grant|waivers?|fellowships?|awards?|bursar(y|ies)|gift aid|tuition (discount|remission|exchange)|promise)\b/i;
const GIFT_NOUN = /\b(grants?|scholarships?|awards?|waivers?|fellowships?|bursar(y|ies))\b/gi;
const LOAN_NOUN = /\b(loans?|plus|stafford|perkins)\b/gi;
const DIRECT_COST = /\b(tuition|fees?|housing|rooms?|board|meals?|dining|food|residence|on[-\s]campus living)\b/i;
const INDIRECT_COST = /\b(books?|supplies|course materials|transportation|travel|personal|miscellaneous|misc\.?|computer|laptop|health insurance|loan fees?|living expenses|off[-\s]campus|other (education(al)? )?(costs?|expenses))\b/i;

const PER_TERM = /\b(per|each|a|every)\s+(semester|term)\b|\/\s?semester|\bsemester(ly)?\b/i;
const PER_QUARTER = /\b(per|each|a|every)\s+quarter\b|\/\s?quarter|\bquarterly\b/i;
const PER_MONTH = /\b(per|a|each)\s+month\b|\/\s?mo(nth)?\b|\bmonthly\b/i;

// Term columns: a header row like "Fall  Spring  Total", or a line that names
// its own terms ("Fall 2026 $9,000 / Spring 2027 $9,000").
const TERMS = /\b(fall|autumn|winter|spring|summer)\b/gi;
const TOTAL_COLUMN = /\b(total|annual|yearly|full year|academic year)\b/i;
const termsIn = (s) => (s.match(TERMS) || []).length;

const COST_HEADER = /\b(cost|costs|expenses|cost of attendance|budget|charges)\b/i;
const AID_HEADER = /\b(aid|awards?|offer|package|financial aid|scholarships?|grants?)\b/i;
const SCHOOL = /\b(university|college|institute|school|academy|polytechnic)\b/i;

const RENEW_BAD = /\b(first[-\s]year only|freshman year only|first year only|one[-\s]time|non[-\s]?renewable|not renewable|entering (year|students?) only|year one only)\b/i;
const RENEW_GPA = /\b(renew\w*|maintain\w*|keep)\b[^.\n]{0,80}\b(GPA|grade point|\d\.\d{1,2})\b|\b(GPA|grade point average)\b[^.\n]{0,60}\b(renew|maintain|keep|required)/i;

// "MESA RIDGE UNIVERSITY" reads as shouting; keep "of", "and" small.
export function tidyName(name) {
  if (!name) return name;
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (m, a, b) => (/^(of|and|the|at|for|in)$/.test(m) ? m : a.toUpperCase() + b)).replace(/^./, (c) => c.toUpperCase());
}

export function toNumber(s) {
  return Number(String(s).replace(/[$,\s]/g, ''));
}

// A bare number is only money when it looks like money: not a year, not a
// GPA, not part of a percentage, an ID or a phone number.
function amountsIn(line) {
  const found = [];
  MONEY.lastIndex = 0;
  let m;
  while ((m = MONEY.exec(line))) {
    const raw = m[0];
    const hasDollar = raw.includes('$');
    const value = toNumber(raw);
    const after = line.slice(m.index + raw.length, m.index + raw.length + 2);
    const before = line.slice(Math.max(0, m.index - 1), m.index);
    if (/^\s?%/.test(after)) continue;
    if (/^[-–/]\d/.test(after) || /[-–/]$/.test(before)) continue; // 2026-27, 3/15
    if (!hasDollar) {
      if (!raw.includes(',') && value >= 1900 && value <= 2099) continue; // a year
      if (!raw.includes(',') && value < 100) continue;
      if (/\d{7,}/.test(line.replace(/[,\s]/g, '').slice(m.index, m.index + 8))) continue;
    }
    if (value <= 0) continue;
    found.push({ value, raw, hasDollar });
  }
  // On a line that uses dollar signs, trust only the dollar amounts.
  if (found.some((a) => a.hasDollar)) return found.filter((a) => a.hasDollar);
  return found;
}

function labelOf(line) {
  return line
    .replace(MONEY, ' ')
    .replace(/[.·…_]{2,}/g, ' ')
    .replace(/[|:\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+[-–]\s*$/, '')
    .trim();
}

const lastAt = (re, s) => { let at = -1; for (const m of s.matchAll(re)) at = m.index; return at; };

export function classify(label, section) {
  if (INFO.test(label) || (NEED.test(label) && !GIFT_NAME.test(label))) return { category: 'info' };
  if (TOTAL.test(label) || COA.test(label.trim())) return { category: 'info', total: true };
  if (/\bloan (origination )?fees?\b/i.test(label)) return { category: 'cost', direct: false };
  const loan = LOAN.test(label) || PLUS_LOAN.test(label) || /\bPLUS\b/.test(label);
  // Whichever noun comes last names the thing: "Loan Replacement Grant" is a
  // grant, "Scholarship Loan" is a loan.
  if (loan && !(GIFT.test(label) && lastAt(GIFT_NOUN, label) > lastAt(LOAN_NOUN, label))) return { category: 'loan', kind: loanKind(label) };
  if (WORK.test(label)) return { category: 'work' };
  if (GIFT.test(label)) return { category: 'gift' };
  if (DIRECT_COST.test(label)) return { category: 'cost', direct: true };
  if (INDIRECT_COST.test(label)) return { category: 'cost', direct: false };
  if (section === 'cost') return { category: 'cost', direct: false, guessed: true };
  if (section === 'aid') return { category: 'gift', guessed: true };
  return { category: 'info', guessed: true };
}

export function loanKind(label) {
  if (/\bparents?\b|\bPLUS\b/i.test(label)) return 'plus';
  if (/\bunsub/i.test(label)) return 'unsub';
  if (/\bsub(sidized)?\b|direct sub/i.test(label)) return 'sub';
  if (/\b(private|alternative|bank|institutional|college loan|university loan)\b/i.test(label)) return 'private';
  if (/\bdirect\b|stafford|federal/i.test(label)) return 'unsub';
  return 'private';
}

function periodOf(text) {
  if (PER_MONTH.test(text)) return { times: 9, note: 'per month, times 9 months' };
  if (PER_QUARTER.test(text)) return { times: 3, note: 'per quarter, times 3' };
  if (PER_TERM.test(text)) return { times: 2, note: 'per semester, times 2' };
  return { times: 1, note: '' };
}

export function parseLetter(text, fallbackName = 'School') {
  const rows = String(text || '').split(/\r?\n/);
  const lines = [];
  const notes = [];
  let section = null;
  let termColumns = 0; // how many term columns (Fall, Spring...) the last header row had
  let totalColumn = false; // and whether it also had a Total column
  let school = null;
  let letterPeriod = periodOf(
    (text.match(/(amounts?|figures?|costs?|aid)[^.\n]{0,40}(are|shown)[^.\n]{0,40}(per|each)\s+(semester|term|quarter)/i) || [''])[0],
  );

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].trim();
    if (!row) continue;
    const amounts = amountsIn(row);

    if (!amounts.length) {
      if (!school && SCHOOL.test(row) && row.length < 90 && !/^dear\b/i.test(row)) {
        const m = row.match(/((?:[A-Z][\w'&.-]*\s+){0,5}(?:University|UNIVERSITY|College|COLLEGE|Institute|INSTITUTE|Academy|ACADEMY|Polytechnic)(?:\s+of(?:\s+[A-Z][\w'&.-]*)+)?)/);
        if (m && !/^(Office|Dear|Welcome)\b/i.test(m[1])) school = m[1].trim();
      }
      if (termsIn(row) >= 2) { termColumns = termsIn(row); totalColumn = TOTAL_COLUMN.test(row); }
      if (row.length < 60) {
        if (COST_HEADER.test(row) && !AID_HEADER.test(row)) section = 'cost';
        else if (AID_HEADER.test(row)) section = 'aid';
        else if (/\bcost of attendance\b/i.test(row)) section = 'cost';
      }
      continue;
    }

    const rowTerms = termsIn(row);
    let label = labelOf(row) || '(no label)';
    if (rowTerms >= 2) label = label.replace(TERMS, ' ').replace(/(^|\s)[/,;]+(?=\s|$)/g, ' ').replace(/\s{2,}/g, ' ').trim() || label;
    const kind = classify(label, section);
    const values = amounts.map((a) => a.value);
    let annual = values[0];
    let how = '';

    const last = values[values.length - 1];
    const rest = values.slice(0, -1).reduce((s, v) => s + v, 0);
    const all = values.reduce((s, v) => s + v, 0);
    const termsNote = (n) => (n === 2 ? 'fall plus spring' : `${n} terms added`);
    if (rowTerms >= 2 && values.length === rowTerms) {
      annual = all;
      how = termsNote(rowTerms);
    } else if (termColumns >= 2 && !totalColumn && values.length === termColumns) {
      // Fall and Spring columns with no Total column: equal terms are not a total.
      annual = all;
      how = termsNote(termColumns);
    } else if (values.length >= 2 && Math.abs(last - rest) <= 2) {
      annual = last;
      how = 'last column is the year total';
    } else if (termColumns >= 2 && values.length === termColumns) {
      annual = all;
      how = termsNote(termColumns);
    } else {
      const p = periodOf(row);
      const period = p.times > 1 ? p : letterPeriod;
      if (period.times > 1) {
        annual = values[0] * period.times;
        how = period.note;
      }
    }

    lines.push({
      id: `L${lines.length + 1}`,
      source: row,
      label,
      annual: Math.round(annual * 100) / 100,
      how,
      category: kind.category,
      kind: kind.kind || null,
      direct: kind.direct ?? null,
      total: !!kind.total,
      guessed: !!kind.guessed,
      firstYearOnly: RENEW_BAD.test(row),
    });
  }

  // Renewal language often sits in a footnote, not on the award's own line.
  const sentences = String(text).split(/(?<=[.!?])\s+|\n/);
  const conditions = sentences.map((s) => s.trim()).filter((s) => RENEW_GPA.test(s) || RENEW_BAD.test(s));
  for (const s of sentences) {
    if (!RENEW_BAD.test(s)) continue;
    for (const line of lines) {
      if (line.category !== 'gift' || line.firstYearOnly) continue;
      const words = line.label.toLowerCase().split(/\s+/).filter((w) => w.length > 4 && !/grant|scholarship|award/.test(w));
      if (words.some((w) => s.toLowerCase().includes(w))) line.firstYearOnly = true;
    }
  }
  if (letterPeriod.times > 1) notes.push(`The letter says its amounts are ${letterPeriod.note.split(',')[0]}; they were annualized.`);

  return { school: tidyName(school) || fallbackName, lines, conditions, notes };
}
