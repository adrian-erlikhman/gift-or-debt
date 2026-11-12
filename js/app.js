import { parseLetter } from './parse.js';
import { analyze, compare, trueCost, DEFAULTS } from './money.js';
import { flagsFor } from './flags.js';
import { draftEmail } from './email.js';
import { SAMPLES } from './samples.js';
import { CATEGORY, LOAN_KIND, RULES } from './rules.js';
import { MODELS, readWithClaude, polishEmail } from './ai.js';

const $ = (s, el = document) => el.querySelector(s);
const usd = (n) => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const pct = (x) => (x * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  letters: [],
  current: null, // index, or 'compare'
  opts: structuredClone(DEFAULTS),
  showAssumptions: false,
  key: '',
  model: MODELS[0],
};

let nextId = 1;
function addLetter(parsed, text, via = 'rules') {
  const letter = { id: nextId++, text, via, ...parsed };
  state.letters.push(letter);
  state.current = state.letters.length - 1;
  return letter;
}

const resultFor = (l) => analyze(l, state.opts);

// ---------- the split bar ----------
function segments(r) {
  const student = r.loansBy.sub + r.loansBy.unsub + r.loansBy.private;
  const gap = Math.max(0, r.outOfPocket);
  const parts = [
    { cls: 'gift', label: 'Gift aid (yours to keep)', v: r.gift, color: 'var(--gift)' },
    { cls: 'loan', label: 'Student loans', v: student, color: 'var(--debt)' },
    { cls: 'plus', label: 'Parent PLUS loan', v: r.loansBy.plus, color: 'var(--parent)' },
    { cls: 'work', label: 'Work-study (a job)', v: r.work, color: 'var(--work)' },
    { cls: 'gap', label: 'Not covered', v: gap, color: '#b9bdba' },
  ];
  return parts.filter((p) => p.v > 0);
}

function drawBar(barEl, legendEl, r) {
  const parts = segments(r);
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  barEl.innerHTML = parts.map((p) => `<span class="${p.cls}" style="width:${(p.v / total) * 100}%" title="${esc(p.label)}: ${usd(p.v)}"></span>`).join('');
  barEl.setAttribute('role', 'img');
  barEl.setAttribute('aria-label', `Cost of attendance ${usd(r.coa)}: ` + parts.map((p) => `${p.label} ${usd(p.v)}`).join(', '));
  legendEl.innerHTML = parts.map((p) => `<li><i style="background:${p.color}"></i>${esc(p.label)} <b>${usd(p.v)}</b></li>`).join('') + `<li class="coa">Cost of attendance <b>${usd(r.coa)}</b></li>`;
}

// ---------- list ----------
function renderList() {
  const ol = $('#letterList');
  ol.innerHTML = state.letters
    .map((l, i) => {
      const r = resultFor(l);
      return `<li><button data-i="${i}" aria-current="${state.current === i}">${esc(l.school)}<small>${usd(r.netPrice)} net price · ${usd(r.loans)} in loans</small></button></li>`;
    })
    .join('');
  $('#showCompare').disabled = state.letters.length < 2;
  $('#showCompare').setAttribute('aria-pressed', state.current === 'compare');
}

// ---------- one letter ----------
function stat(cls, k, v, s = '') {
  return `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
}

function renderLetter(i) {
  const letter = state.letters[i];
  const r = resultFor(letter);
  const panel = $('#panel');
  panel.innerHTML = '';
  panel.append($('#tplPanel').content.cloneNode(true));
  $('.school', panel).textContent = letter.school;
  drawBar($('[data-slot=bar]', panel), $('[data-slot=legend]', panel), r);

  const d = r.debt;
  $('[data-slot=stats]', panel).innerHTML = [
    stat('gift', 'Free money this year', usd(r.gift), `${Math.round(r.giftShare * 100)}% of the ${usd(r.reportedAid)} called “aid”`),
    stat('debt', 'Loans offered this year', usd(r.loans), r.loansBy.plus ? `${usd(r.loansBy.plus)} of it is borrowed by a parent` : 'repaid with interest'),
    stat('key', 'Net price this year', usd(r.netPrice), 'cost of attendance minus gift aid'),
    stat('gap', 'Still not covered', usd(Math.max(0, r.outOfPocket)), 'after grants, loans and work-study'),
    stat('key', '4-year true cost', usd(trueCost(r)), 'net price plus loan fees and in-school interest'),
    stat('debt', 'Student debt at graduation', usd(d.studentAtRepayment), d.studentMonthly ? `about ${usd(d.studentMonthly)}/month for 10 years` : 'no student loans'),
    ...(d.parentAtRepayment ? [stat('debt', 'Parent PLUS at graduation', usd(d.parentAtRepayment), `about ${usd(d.parentMonthly)}/month for 10 years`)] : []),
  ].join('');

  const as = $('[data-slot=assumptions]', panel);
  as.hidden = !state.showAssumptions;
  as.innerHTML = assumptionsForm();

  const flags = flagsFor(letter, r);
  $('[data-slot=flags]', panel).innerHTML = flags.length
    ? flags.map((f) => `<li class="${f.level}"><b>${esc(f.title)}</b><span>${esc(f.detail)}</span></li>`).join('')
    : '<li class="none"><b>Nothing tricky found</b><span>Still check the numbers against the letter.</span></li>';

  $('[data-slot=years]', panel).innerHTML =
    '<thead><tr><th>Year</th><th class="num">Cost</th><th class="num">Gift aid</th><th class="num">Net price</th><th class="num">Loans</th><th class="num">Work-study</th><th class="num">Not covered</th></tr></thead><tbody>' +
    r.perYear.map((y) => `<tr><td>${y.year}</td><td class="num">${usd(y.cost)}</td><td class="num">${usd(y.gift)}</td><td class="num">${usd(y.net)}</td><td class="num">${usd(y.loans)}</td><td class="num">${usd(y.work)}</td><td class="num">${usd(Math.max(0, y.outOfPocket))}</td></tr>`).join('') +
    `<tr class="total"><td>Total</td><td class="num">${usd(r.fourYear.cost)}</td><td class="num">${usd(r.fourYear.gift)}</td><td class="num">${usd(r.fourYear.net)}</td><td class="num">${usd(r.fourYear.borrowed)}</td><td class="num">${usd(r.work * state.opts.years)}</td><td class="num">${usd(r.perYear.reduce((s, y) => s + Math.max(0, y.outOfPocket), 0))}</td></tr></tbody>`;

  const flagged = new Set(flags.flatMap((f) => f.lineIds));
  const catOptions = (l) => {
    const cur = l.category === 'loan' ? `loan:${l.kind}` : l.category === 'cost' ? `cost:${l.direct === false ? 'indirect' : 'direct'}` : l.total ? 'total' : l.category;
    const opts = [['gift', 'Gift aid'], ['loan:sub', LOAN_KIND.sub], ['loan:unsub', LOAN_KIND.unsub], ['loan:plus', LOAN_KIND.plus], ['loan:private', LOAN_KIND.private], ['work', 'Work-study'], ['cost:direct', 'Cost (billed)'], ['cost:indirect', 'Cost (not billed)'], ['total', 'A total (not counted)'], ['info', 'Not counted']];
    return opts.map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`).join('');
  };
  $('[data-slot=lines]', panel).innerHTML =
    '<thead><tr><th>Line</th><th>What it is</th><th class="num">Per year</th></tr></thead><tbody>' +
    letter.lines
      .map((l, j) => `<tr class="${flagged.has(l.id) ? 'flagged' : ''}${l.total ? ' total' : ''}"><td>${esc(l.label)}${l.firstYearOnly ? '<span class="pill">first year only</span>' : ''}${l.readBy === 'claude' ? '<span class="pill claude">read by Claude</span>' : ''}<span class="src" title="${esc(l.source)}">${esc(l.source)}${l.how ? ' · ' + esc(l.how) : ''}</span></td><td><select data-j="${j}" aria-label="Category for ${esc(l.label)}">${catOptions(l)}</select></td><td class="num"><input data-j="${j}" type="number" min="0" step="1" value="${l.annual}" aria-label="Amount per year for ${esc(l.label)}"></td></tr>`)
      .join('') +
    '</tbody>';

  const draft = draftEmail(letter, r);
  $('[data-slot=email]', panel).innerHTML = `<p class="hint">Subject: ${esc(draft.subject)}</p><textarea aria-label="Email to the aid office">${esc(draft.body)}</textarea><div class="row"><button class="btn small" data-act="copy">Copy</button><button class="btn small" data-act="polish" ${state.key ? '' : 'disabled title="Add an API key under “Use Claude” first"'}>Reword with Claude</button><span class="status" data-slot="emailStatus" role="status"></span></div>`;
}

function assumptionsForm() {
  const o = state.opts;
  const f = (k, label, v, step = 0.01) => `<label>${label}<input data-opt="${k}" type="number" step="${step}" value="${v}"></label>`;
  return [
    f('costGrowth', 'Yearly cost increase (%)', +(o.costGrowth * 100).toFixed(2), 0.1),
    f('rates.unsub', 'Direct Loan rate (%)', +(o.rates.unsub * 100).toFixed(3)),
    f('rates.plus', 'Parent PLUS rate (%)', +(o.rates.plus * 100).toFixed(3)),
    f('rates.private', 'Private loan rate (%)', +(o.rates.private * 100).toFixed(3)),
    f('fees.unsub', 'Direct Loan fee (%)', +(o.fees.unsub * 100).toFixed(3), 0.001),
    f('fees.plus', 'Parent PLUS fee (%)', +(o.fees.plus * 100).toFixed(3), 0.001),
    `<p class="fine" style="grid-column:1/-1;margin:0">Defaults are the federal terms for loans first disbursed in ${RULES.year}. The private rate is a placeholder; use your lender's.</p>`,
  ].join('');
}

// ---------- compare ----------
function renderCompare() {
  const rs = state.letters.map(resultFor);
  const ranked = compare(rs);
  const by = Object.fromEntries(rs.map((r) => [r.school, r]));
  const min = (f) => Math.min(...rs.map(f));
  const cell = (r, f, fmt = usd) => `<td class="num${f(r) === min(f) ? ' best' : ''}">${fmt(f(r))}</td>`;
  const best = ranked[0];
  const second = ranked[1];
  $('#panel').innerHTML = `<div class="compare"><h2>Compare offers</h2>
    <p class="verdict">${esc(best.school)} costs the least over four years${second ? `: ${usd(second.moreThanBest)} less than ${esc(second.school)}` : ''}.</p>
    <p class="hint">“True cost” is the four-year net price plus loan fees and the interest that builds while you're in school. Lowest in each column is green.</p>
    <div class="tablewrap"><table><thead><tr><th>School</th><th class="num">4-year true cost</th><th class="num">Gift aid / year</th><th class="num">Net price / year</th><th class="num">Not covered / year</th><th class="num">Student debt at graduation</th><th class="num">Monthly payment</th><th class="num">Parent PLUS at graduation</th><th class="num">Flags</th></tr></thead><tbody>
    ${ranked
      .map(({ school }) => {
        const r = by[school];
        const l = state.letters.find((x) => x.school === school);
        const warns = flagsFor(l, r).filter((f) => f.level === 'warn').length;
        return `<tr><td>${esc(school)}</td>${cell(r, trueCost)}<td class="num${r.gift === Math.max(...rs.map((x) => x.gift)) ? ' best' : ''}">${usd(r.gift)}</td>${cell(r, (x) => x.netPrice)}${cell(r, (x) => Math.max(0, x.outOfPocket))}${cell(r, (x) => x.debt.studentAtRepayment)}${cell(r, (x) => x.debt.studentMonthly)}${cell(r, (x) => x.debt.parentAtRepayment)}<td class="num">${warns}</td></tr>`;
      })
      .join('')}
    </tbody></table></div>
    ${rs.map((r) => `<h3>${esc(r.school)}</h3><div class="bar" data-school="${esc(r.school)}"></div><ul class="legend" data-legend="${esc(r.school)}"></ul>`).join('')}
  </div>`;
  for (const r of rs) drawBar($(`.bar[data-school="${CSS.escape(r.school)}"]`), $(`[data-legend="${CSS.escape(r.school)}"]`), r);
}

function render() {
  $('#work').hidden = state.letters.length === 0;
  renderList();
  if (state.current === 'compare' && state.letters.length >= 2) renderCompare();
  else if (state.letters.length) renderLetter(Math.min(state.current ?? 0, state.letters.length - 1));
  const p = new URLSearchParams(location.search);
  if (state.current === 'compare') p.set('view', 'compare'); else p.delete('view');
  history.replaceState(null, '', `${location.pathname}${p.toString() ? '?' + p : ''}${location.hash}`);
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.i !== undefined) { state.current = +b.dataset.i; render(); return; }
  const act = b.dataset.act;
  if (b.id === 'showCompare') { state.current = 'compare'; render(); $('#work').scrollIntoView({ behavior: 'smooth' }); }
  if (b.id === 'addLetter') { $('#paste').scrollIntoView({ behavior: 'smooth' }); $('#letterText').focus(); }
  if (b.id === 'tryDemo') loadDemo(true);
  if (act === 'assumptions') { state.showAssumptions = !state.showAssumptions; render(); }
  if (act === 'print') window.print();
  if (act === 'remove') { state.letters.splice(state.current, 1); state.current = state.letters.length ? 0 : null; render(); }
  if (act === 'copy') { const ta = $('.email textarea'); ta.select(); try { await navigator.clipboard.writeText(ta.value); b.textContent = 'Copied'; } catch { document.execCommand('copy'); } }
  if (act === 'polish') {
    const st = $('[data-slot=emailStatus]');
    st.textContent = 'Asking Claude…'; st.className = 'status';
    try { $('.email textarea').value = await polishEmail({ key: state.key, model: state.model, draft: $('.email textarea').value }); st.textContent = 'Reworded. Every dollar figure was checked against the draft.'; }
    catch (err) { st.textContent = err.message; st.className = 'status err'; }
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('table.lines select')) {
    const l = state.letters[state.current].lines[+t.dataset.j];
    const [cat, sub] = t.value.split(':');
    l.total = cat === 'total';
    l.category = l.total ? 'info' : cat;
    l.kind = cat === 'loan' ? sub : null;
    l.direct = cat === 'cost' ? sub === 'direct' : null;
    l.guessed = false;
    render();
  }
  if (t.matches('table.lines input')) {
    state.letters[state.current].lines[+t.dataset.j].annual = Math.max(0, Number(t.value) || 0);
    render();
  }
  if (t.dataset.opt) {
    const v = Number(t.value) / 100;
    if (!Number.isFinite(v) || v < 0) return;
    const [a, b] = t.dataset.opt.split('.');
    if (b) { state.opts[a][b] = v; if (b === 'unsub') state.opts[a].sub = v; } else state.opts[a] = v;
    render();
  }
});

function status(msg, err = false) { const s = $('#readStatus'); s.textContent = msg; s.className = err ? 'status err' : 'status'; }

$('#readRules').addEventListener('click', () => {
  const text = $('#letterText').value.trim();
  if (!text) return status('Paste the letter text first.', true);
  const parsed = parseLetter(text, $('#schoolName').value.trim() || `School ${state.letters.length + 1}`);
  if ($('#schoolName').value.trim()) parsed.school = $('#schoolName').value.trim();
  if (!parsed.lines.length) return status('No dollar amounts found. Is this the aid letter?', true);
  addLetter(parsed, text);
  status(`Read ${parsed.lines.length} lines from ${parsed.school}.`);
  $('#letterText').value = ''; $('#schoolName').value = '';
  render();
  $('#work').scrollIntoView({ behavior: 'smooth' });
});

let pendingImage = null;
$('#readClaude').addEventListener('click', async () => {
  const text = $('#letterText').value.trim();
  if (!text && !pendingImage) return status('Paste the letter text or choose a file first.', true);
  status('Claude is reading the letter…');
  try {
    const out = await readWithClaude({ key: state.key, model: state.model, text, image: pendingImage });
    if (!out.lines.length) return status('Claude found no amounts it could match to the letter.', true);
    const parsed = { school: $('#schoolName').value.trim() || out.school || `School ${state.letters.length + 1}`, lines: out.lines, conditions: out.conditions, notes: [] };
    addLetter(parsed, text, 'claude');
    status(`Claude read ${out.lines.length} lines${out.dropped.length ? `; ${out.dropped.length} were dropped because their amounts aren't in the letter` : ''}${pendingImage ? '. From a photo, so check each one.' : '.'}`);
    pendingImage = null; $('#fileIn').value = ''; $('#letterText').value = ''; $('#schoolName').value = '';
    render();
    $('#work').scrollIntoView({ behavior: 'smooth' });
  } catch (err) { status(err.message, true); }
});

$('#apiKey').addEventListener('input', (e) => { state.key = e.target.value.trim(); $('#readClaude').disabled = !state.key; if (state.letters.length) render(); });
$('#model').innerHTML = MODELS.map((m) => `<option>${m}</option>`).join('');
$('#model').addEventListener('change', (e) => { state.model = e.target.value; });

$('#fileIn').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  pendingImage = null;
  if (!file) return;
  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      status('Reading the PDF…');
      const text = await pdfText(file);
      $('#letterText').value = text;
      status(text.trim() ? 'PDF text loaded. Check it, then press “Read it”.' : 'This PDF has no text layer (it is a scan). Use “Read it with Claude”.', !text.trim());
    } else if (file.type.startsWith('image/')) {
      const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(file); });
      pendingImage = { mediaType: file.type, data };
      status(state.key ? 'Photo loaded. Press “Read it with Claude”.' : 'Photos need Claude: add your API key under “Use Claude”.', !state.key);
    } else {
      $('#letterText').value = await file.text();
      status('Text loaded. Press “Read it”.');
    }
  } catch (err) { status(`Couldn't read that file: ${err.message}`, true); }
});

async function pdfText(file) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const rows = new Map();
    for (const it of items) {
      const y = Math.round(it.transform[5] / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(it);
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) out.push(rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join('   ').replace(/\s{4,}/g, '   '));
  }
  return out.join('\n');
}

function loadDemo(scroll) {
  state.letters = [];
  for (const s of SAMPLES) addLetter(parseLetter(s.text, s.name), s.text);
  state.current = new URLSearchParams(location.search).get('view') === 'compare' ? 'compare' : 0;
  render();
  if (scroll) $('#work').scrollIntoView({ behavior: 'smooth' });
}

// Hero: the Mesa Ridge sample, split.
(function hero() {
  const r = analyze(parseLetter(SAMPLES[2].text, SAMPLES[2].name));
  drawBar($('#heroBar'), $('#heroLegend'), r);
})();

if (new URLSearchParams(location.search).get('demo') === '1') loadDemo(false);
