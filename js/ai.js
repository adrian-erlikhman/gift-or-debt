// Optional. With your own Anthropic API key, Claude reads letters the rules
// can't (photos, scanned PDFs, odd layouts) and polishes the email to the aid
// office. Claude never does the math, and anything it reads is checked against
// the letter before the page uses it. The key stays in this tab.
import { classify } from './parse.js';

const API = 'https://api.anthropic.com/v1/messages';
export const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];

async function call(key, model, system, content, maxTokens = 3000) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    if (res.status === 401) msg = 'That API key was rejected.';
    if (res.status === 429) msg = 'Rate limited by the API. Wait a minute and try again.';
    throw new Error(msg);
  }
  const data = await res.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

function jsonFrom(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The model did not return JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

const READ_SYSTEM = `You read US college financial aid offer letters and list every line item with a dollar amount. Return only JSON:
{"school": string or null,
 "lines": [{"label": the item's name as written, "amount_text": the amount exactly as printed, "amount": number, "period": "year"|"semester"|"quarter"|"month",
   "category": "cost_direct"|"cost_indirect"|"gift"|"loan_sub"|"loan_unsub"|"loan_parent_plus"|"loan_private"|"work_study"|"total"|"other",
   "first_year_only": boolean}],
 "conditions": [sentences about renewal, GPA, enrollment or first-year-only awards, copied as written]}
Rules: grants, scholarships and waivers are "gift". Any loan is a loan category; a loan to a parent is loan_parent_plus. Lines that sum other lines (total aid, net cost, remaining balance, cost of attendance total) are "total". Tuition, fees, housing and food are cost_direct; books, transportation and personal costs are cost_indirect. If a line shows fall, spring and total columns, use the total with period "year". Do not compute anything else and do not invent lines.`;

const CAT = {
  cost_direct: { category: 'cost', direct: true },
  cost_indirect: { category: 'cost', direct: false },
  gift: { category: 'gift' },
  loan_sub: { category: 'loan', kind: 'sub' },
  loan_unsub: { category: 'loan', kind: 'unsub' },
  loan_parent_plus: { category: 'loan', kind: 'plus' },
  loan_private: { category: 'loan', kind: 'private' },
  work_study: { category: 'work' },
  total: { category: 'info', total: true },
  other: { category: 'info' },
};
const TIMES = { year: 1, semester: 2, quarter: 3, month: 9 };

// Only keep a line if its amount is really printed in the letter. For a photo
// there is no text to check against, so every line is marked to be checked.
export function checkRead(raw, sourceText, fromImage) {
  const digits = (s) => String(s).replace(/[^\d.]/g, '').replace(/\.00$/, '');
  const haystack = sourceText ? ' ' + sourceText.replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/[^\d.]+/g, ' ') + ' ' : '';
  const lines = [];
  const dropped = [];
  for (const [i, l] of (raw.lines || []).entries()) {
    const amount = Number(l.amount);
    const cat = CAT[l.category] || classify(l.label || '');
    if (!Number.isFinite(amount) || amount <= 0) { dropped.push(l); continue; }
    if (!fromImage) {
      const d = digits(l.amount_text || amount);
      const token = d.replace(/\.$/, '');
      if (!token || !(haystack.includes(` ${token} `) || haystack.includes(` ${token}.`))) { dropped.push(l); continue; }
    }
    lines.push({
      id: `C${i + 1}`,
      source: `${l.label}: ${l.amount_text || amount}`,
      label: String(l.label || '(no label)').slice(0, 120),
      annual: Math.round(amount * (TIMES[l.period] || 1) * 100) / 100,
      how: TIMES[l.period] > 1 ? `per ${l.period}, annualized` : '',
      category: cat.category,
      kind: cat.kind || null,
      direct: cat.direct ?? null,
      total: !!cat.total,
      guessed: !!fromImage,
      firstYearOnly: !!l.first_year_only,
      readBy: 'claude',
    });
  }
  return { school: raw.school || null, lines, conditions: (raw.conditions || []).map(String), dropped };
}

export async function readWithClaude({ key, model, text, image }) {
  const content = image
    ? [{ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }, { type: 'text', text: 'Read this aid offer.' }]
    : [{ type: 'text', text: `Read this aid offer:\n\n${text}` }];
  const raw = jsonFrom(await call(key, model, READ_SYSTEM, content));
  return checkRead(raw, text, !!image);
}

const EMAIL_SYSTEM = `You polish a short, polite email from a student to a college financial aid office. Keep every question and every dollar amount from the draft exactly as written; do not add numbers, facts or demands. Plain text, under 220 words, no subject line, no placeholders other than the ones in the draft.`;

export async function polishEmail({ key, model, draft }) {
  const out = (await call(key, model, EMAIL_SYSTEM, [{ type: 'text', text: draft }], 800)).trim();
  // Every dollar figure in the polished version has to appear in the draft.
  const amounts = (s) => (s.match(/\$\d[\d,]*/g) || []).map((a) => a.replace(/,/g, ''));
  const allowed = new Set(amounts(draft));
  const extra = amounts(out).filter((a) => !allowed.has(a));
  if (extra.length) throw new Error(`The polished email added figures the draft didn't have (${extra.join(', ')}), so the original was kept.`);
  return out;
}
