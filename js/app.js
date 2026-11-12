import { parseLetter } from './parse.js';
import { analyze, compare, trueCost, DEFAULTS } from './money.js';
import { flagsFor } from './flags.js';
import { draftEmail, officeName } from './email.js';
import { SAMPLES } from './samples.js';
import { LOAN_KIND, RULES } from './rules.js';
import { MODELS, readWithClaude, polishEmail } from './ai.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const usd = (n) => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

const state = {
  letters: [],
  current: null, // index, or 'compare'
  tab: 'flags',
  opts: structuredClone(DEFAULTS),
  key: '',
  model: MODELS[0],
};
let lastShown = null;

let nextId = 1;
function addLetter(parsed, text, via = 'rules') {
  const letter = { id: nextId++, text, via, ...parsed };
  state.letters.push(letter);
  state.current = state.letters.length - 1;
  return letter;
}
const resultFor = (l) => analyze(l, state.opts);

// ---------- numbers that count up ----------
function countUp(el, to, dur = 1000, delay = 0) {
  if (reduced) { el.textContent = usd(to); return; }
  const start = performance.now() + delay;
  el.textContent = usd(0);
  const tick = (now) => {
    const t = Math.min(1, Math.max(0, (now - start) / dur));
    el.textContent = usd(to * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function settleCounts(root, animate) {
  $$('[data-to]', root).forEach((el, i) => (animate ? countUp(el, +el.dataset.to, 950, +(el.dataset.delay || i * 40)) : (el.textContent = usd(+el.dataset.to))));
}

// ---------- the split ----------
function segments(r) {
  const gap = Math.max(0, r.outOfPocket);
  return [
    { cls: 'gift', short: 'gift', label: 'Gift aid (yours to keep)', v: r.gift, color: 'var(--gift)' },
    { cls: 'loan', short: 'loans', label: 'Student loans', v: r.studentLoans, color: 'var(--debt)' },
    { cls: 'plus', short: 'Parent PLUS', label: 'Parent PLUS loan', v: r.loansBy.plus, color: 'var(--plus)' },
    { cls: 'work', short: 'work-study', label: 'Work-study (a job)', v: r.work, color: 'var(--work)' },
    { cls: 'gap', short: 'not covered', label: 'Not covered', v: gap, color: '#c4c5bd' },
  ].filter((p) => p.v > 0);
}

// Builds the bar with every segment at zero, then lets the widths grow in.
async function drawSplit(bar, r, { animate = true, labels = true, fromAll = false } = {}) {
  const parts = segments(r);
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  bar.classList.add('sbar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `Cost of attendance ${usd(r.coa)}: ` + parts.map((p) => `${p.label} ${usd(p.v)}`).join(', '));
  const px = bar.clientWidth || 600;
  const fit = (t, w) => t.length * 7.9 + 26 < (w / 100) * px;
  bar.innerHTML = (fromAll ? `<span class="all" data-w="0"><b>${usd(r.reportedAid)} “aid”</b></span>` : '') + parts.map((p) => {
    const w = (p.v / total) * 100;
    const long = `${usd(p.v)} ${p.short}`, short = usd(p.v);
    const t = !labels ? '' : fit(long, w) ? long : fit(short, w) ? short : '';
    return `<span class="${p.cls}" data-w="${w}" title="${esc(p.label)}: ${usd(p.v)}">${t ? `<b>${esc(t)}</b>` : ''}</span>`;
  }).join('');
  const spans = $$(':scope > span', bar);
  const set = () => { spans.forEach((s) => s.style.setProperty('--w', s.dataset.w + '%')); bar.classList.add('on'); };
  if (!animate || reduced) return set();
  spans.forEach((s) => s.style.setProperty('--w', s.classList.contains('all') ? '100%' : '0%'));
  await nextFrame();
  set();
}
const legendHTML = (r) => segments(r).map((p) => `<li><i style="background:${p.color}"></i>${esc(p.label)} <b>${usd(p.v)}</b></li>`).join('') + `<li class="coa">Cost of attendance <b>${r.coa ? usd(r.coa) : 'not listed'}</b></li>`;
const miniBar = (r) => { const ps = segments(r); const t = ps.reduce((s, p) => s + p.v, 0) || 1; return ps.map((p) => `<i style="width:${(p.v / t) * 100}%;background:${p.color}"></i>`).join(''); };

// ---------- the hero: a letter, marked up ----------
const HERO = (() => {
  const sample = SAMPLES[1];
  const parsed = parseLetter(sample.text, sample.name);
  const r = analyze(parsed);
  const kindOf = (l) => (l.total ? 'total' : l.category === 'loan' ? (l.kind === 'plus' ? 'plus' : 'loan') : l.category);
  const TAG = { cost: 'cost', gift: 'gift', loan: 'loan', plus: 'parent loan', work: 'a job', total: 'total' };
  const row = (l) => `<div class="lt-row ${kindOf(l)}"><span>${esc(l.label.replace(/\s*\(.*\)\s*$/, ''))}</span><span class="ld"></span><span class="amt">${usd(l.annual)}</span><span class="tag">${TAG[kindOf(l)]}</span></div>`;
  const costs = parsed.lines.filter((l) => l.category === 'cost' && !l.total);
  const award = parsed.lines.filter((l) => l.category !== 'cost' && !l.total && l.category !== 'info');
  const total = parsed.lines.filter((l) => l.total);
  const letter = $('#heroLetter');
  const truth = $('#heroTruth');
  const stage = $('#stage');
  const timers = [];
  const strikePath = (w) => `M0 9 C ${w * 0.3} 5, ${w * 0.6} 12, ${w} 6`;

  letter.innerHTML = `
    <div class="lt-head"><div class="lt-crest">LC</div><div><div class="lt-name">Linden College</div><div class="lt-sub">Office of Financial Aid · 2026–27 award for Jordan</div></div></div>
    <p class="lt-p">Dear Jordan, we're proud to share a financial aid package that <span class="lt-claim">covers 100% of your direct costs!</span></p>
    <div class="lt-sec">Your direct costs</div>${costs.map(row).join('')}
    <div class="lt-sec">Your award</div>${award.map(row).join('')}${total.map(row).join('')}
    <div class="scan"></div>
    <svg class="lt-ink" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:2"></svg>
    <div class="pen-note" data-n="claim">${Math.round((r.loans / r.reportedAid) * 100)}% of this “aid” is debt</div>
    <div class="pen-note" data-n="total">only ${usd(r.gift)} is yours to keep</div>`;

  truth.innerHTML = `
    <p class="mono label">What the letter says</p>
    <div class="tr-say">
      <div><div class="tr-big">${usd(r.reportedAid)}<svg viewBox="0 0 100 18" preserveAspectRatio="none"><path pathLength="1" d="M2 11 C 30 6, 64 14, 98 7"/></svg></div><div class="dim" style="font-size:14px;margin-top:6px">Total financial aid</div></div>
      <span class="badge"><svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5 9.5 3.5"/></svg>Covers 100%</span>
    </div>
    <div class="tr-rule"></div>
    <p class="mono label">What it is</p>
    <div class="sbar" id="heroBar"><span class="all"><b>${usd(r.reportedAid)} “aid”</b></span></div>
    <ul class="tr-rows">
      <li class="gift"><i style="background:var(--gift)"></i><span class="k">A gift<span class="s">Grants and scholarships. Yours to keep.</span></span><span class="v" data-v="${r.gift}">$0</span></li>
      <li class="debt"><i style="background:var(--debt)"></i><span class="k">Debt<span class="s">${usd(r.loansBy.plus)} of it borrowed by a parent, at 9.07%</span></span><span class="v" data-v="${r.loans}">$0</span></li>
      <li class="work"><i style="background:var(--work)"></i><span class="k">A job<span class="s">Work-study, paid as paychecks. If you find one.</span></span><span class="v" data-v="${r.work}">$0</span></li>
    </ul>
    <div class="tr-four">
      <div><div class="k">Four years, true cost</div><div class="v" data-v="${Math.round(trueCost(r))}">$0</div></div>
      <div><div class="k">Parent owes at graduation</div><div class="v red" data-v="${Math.round(r.debt.parentAtRepayment)}">$0</div></div>
    </div>`;

  // Pen notes and arrows are placed from the real layout, so they survive any width.
  function layout() {
    const svg = $('.lt-ink', letter);
    const box = letter.getBoundingClientRect();
    const rel = (rc) => ({ x: rc.left - box.left, y: rc.top - box.top, w: rc.width, h: rc.height });
    let paths = '';
    // strike through the claim, one stroke per line it wraps onto
    for (const rc of $('.lt-claim', letter).getClientRects()) {
      const p = rel(rc);
      paths += `<path class="ink strike" pathLength="1" transform="translate(${p.x - 3} ${p.y + p.h / 2 - 9})" d="${strikePath(p.w + 6)}"/>`;
    }
    const claim = [...$('.lt-claim', letter).getClientRects()].pop();
    const sec = $('.lt-sec', letter);
    const n1 = $('[data-n=claim]', letter);
    const narrow = box.width < 480;
    n1.style.right = '34px';
    n1.style.top = sec.offsetTop - 4 + 'px';
    if (claim && !narrow) {
      const c = rel(claim);
      const nx = box.width - 34 - n1.offsetWidth - 8, ny = sec.offsetTop + 4;
      const tx = c.x + c.w + 10, ty = c.y + c.h - 2;
      paths += `<path class="ink arrow" pathLength="1" d="M${nx} ${ny} C ${nx - 40} ${ny}, ${tx + 18} ${ty + 14}, ${tx} ${ty}"/><path class="ink arrow" pathLength="1" d="M${tx + 2} ${ty + 11} L ${tx} ${ty} L ${tx + 11} ${ty + 3}"/>`;
    }
    const tot = $('.lt-row.total .amt', letter);
    const n2 = $('[data-n=total]', letter);
    if (tot && !narrow) {
      const t = rel(tot.getBoundingClientRect());
      n2.style.top = t.y + t.h + 26 + 'px';
      n2.style.left = Math.max(20, t.x - n2.offsetWidth - 26) + 'px';
      const sx = parseFloat(n2.style.left) + n2.offsetWidth + 6, sy = t.y + t.h + 34;
      const ex = t.x + t.w / 2, ey = t.y + t.h + 2;
      paths += `<path class="ink arrow2" pathLength="1" d="M${sx} ${sy} C ${sx + 18} ${sy - 2}, ${ex - 4} ${ey + 22}, ${ex} ${ey}"/><path class="ink arrow2" pathLength="1" d="M${ex - 8} ${ey + 8} L ${ex} ${ey} L ${ex + 7} ${ey + 9}"/>`;
    }
    svg.innerHTML = paths;
    letter.style.paddingBottom = tot && !narrow ? '70px' : '';
    svg.querySelectorAll('.ink').forEach((p) => { p.style.cssText = 'fill:none;stroke:var(--pen);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .55s cubic-bezier(.2,.8,.2,1)'; });
    if (stage.classList.contains('s-strike')) ink('.strike');
    if (stage.classList.contains('s-note')) ink('.arrow');
    if (stage.classList.contains('s-note2')) ink('.arrow2');
  }
  const ink = (sel) => $$(sel, letter).forEach((p) => (p.style.strokeDashoffset = 0));
  const at = (ms, fn) => timers.push(setTimeout(fn, reduced ? 0 : ms));

  function reset() {
    timers.splice(0).forEach(clearTimeout);
    stage.className = 'stage';
    $$('.lt-row', letter).forEach((r) => r.classList.remove('on'));
    $$('.pen-note', letter).forEach((n) => n.classList.remove('on'));
    $$('.tr-rows li', truth).forEach((li) => li.classList.remove('on'));
    $('.tr-four', truth).classList.remove('on');
    $$('[data-v]', truth).forEach((v) => (v.textContent = '$0'));
    const bar = $('#heroBar');
    bar.className = 'sbar';
    bar.innerHTML = `<span class="all"><b>${usd(r.reportedAid)} “aid”</b></span>`;
    $('.scan', letter).className = 'scan';
    layout();
  }

  function play() {
    reset();
    const rows = $$('.lt-row', letter);
    const scan = $('.scan', letter);
    const y0 = rows[0].offsetTop - 40, y1 = rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight - 40;
    const D = 2300;
    if (!reduced) {
      scan.style.setProperty('--y', y0 + 'px');
      scan.classList.add('go');
      const t0 = performance.now() + 250;
      const move = (now) => {
        const t = Math.min(1, Math.max(0, (now - t0) / D));
        scan.style.setProperty('--y', y0 + (y1 - y0) * t + 'px');
        if (t < 1) requestAnimationFrame(move); else setTimeout(() => scan.classList.remove('go'), 200);
      };
      requestAnimationFrame(move);
    }
    rows.forEach((row) => at(250 + D * Math.max(0, (row.offsetTop - 40 - y0) / (y1 - y0)) + 120, () => row.classList.add('on')));
    at(2900, () => { stage.classList.add('s-strike'); ink('.strike'); });
    at(3250, () => { stage.classList.add('s-note'); ink('.arrow'); $('[data-n=claim]', letter).classList.add('on'); });
    at(3300, () => drawSplit($('#heroBar'), r, { labels: true, fromAll: true }));
    $$('.tr-rows li', truth).forEach((li, i) => at(3550 + i * 220, () => { li.classList.add('on'); countUp($('.v', li), +$('.v', li).dataset.v, 900); }));
    at(4500, () => { stage.classList.add('s-note2'); ink('.arrow2'); $('[data-n=total]', letter).classList.add('on'); });
    at(4900, () => { $('.tr-four', truth).classList.add('on'); $$('.tr-four .v', truth).forEach((v) => countUp(v, +v.dataset.v, 1100)); });
    at(6000, () => stage.classList.add('done'));
  }

  let started = false;
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !started) { started = true; setTimeout(play, 350); } }, { threshold: 0.3 });
  // ?video holds the hero until the demo recording cues it.
  document.fonts.ready.then(() => { layout(); if (!new URLSearchParams(location.search).has('video')) io.observe(stage); });
  addEventListener('resize', () => requestAnimationFrame(layout));
  $('#replay').addEventListener('click', play);
  return { play };
})();

// ---------- offer list ----------
function renderList() {
  const names = displayNames();
  $('#letterList').innerHTML = state.letters
    .map((l, i) => {
      const r = resultFor(l);
      return `<li><button data-i="${i}" aria-current="${state.current === i}"><span class="o-name">${esc(names[i])}</span><span class="o-sub">${r.coa ? `${usd(r.netPrice)} net` : 'no costs listed'} · ${usd(r.loans)} loans</span><span class="o-bar" aria-hidden="true">${miniBar(r)}</span></button></li>`;
    })
    .join('');
  $('#showCompare').disabled = state.letters.length < 2;
  $('#showCompare').setAttribute('aria-pressed', state.current === 'compare');
}

// ---------- one offer ----------
const kpi = (cls, k, v, s = '') => `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v" data-to="${Math.round(v)}">${usd(v)}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
// A figure that needs the cost of attendance, on a letter that lists no costs.
const kpiNoCost = (cls, k) => `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">—</div><div class="s">needs the cost of attendance</div></div>`;

function verdictHTML(r) {
  const parts = [];
  if (r.reportedAid === 0) parts.push('The letter lists no aid.');
  else if (r.loans > 0 || r.work > 0) {
    parts.push(`The letter lists <b>${usd(r.reportedAid)}</b> in aid.`);
    parts.push(`<span class="g">${usd(r.gift)} is a gift.</span>`);
    if (r.loans > 0) parts.push(`<span class="r">${usd(r.loans)} is debt</span>${r.loansBy.plus ? `, and ${usd(r.loansBy.plus)} of that is borrowed by a parent.` : '.'}`);
    if (r.work > 0) parts.push(`<span class="a">${usd(r.work)} is a job.</span>`);
  } else parts.push(`All <span class="g">${usd(r.gift)}</span> of the aid listed is a gift.`);
  if (r.coa === 0) parts.push('It lists no costs, so there is no net price yet: add the cost of attendance under <b>Every line</b>.');
  else if (r.outOfPocket > 0) parts.push(`${usd(r.outOfPocket)} a year still isn't covered.`);
  return parts.join(' ');
}

function renderLetter(i, animate) {
  const letter = state.letters[i];
  const r = resultFor(letter);
  const panel = $('#panel');
  panel.innerHTML = '';
  panel.append($('#tplPanel').content.cloneNode(true));
  $('.school', panel).textContent = letter.school;
  $('[data-slot=meta]', panel).textContent = `Offer ${i + 1} of ${state.letters.length} · ${letter.lines.length} lines read by ${letter.via === 'claude' ? 'Claude, checked' : 'rules'}`;
  const verdict = $('[data-slot=verdict]', panel);
  verdict.innerHTML = verdictHTML(r);
  if (animate && !reduced) requestAnimationFrame(() => requestAnimationFrame(() => verdict.classList.add('on'))); else verdict.classList.add('on');

  const split = $('[data-slot=split]', panel);
  split.innerHTML = '<div></div><ul class="legend"></ul>';
  drawSplit(split.firstChild, r, { animate });
  $('.legend', split).innerHTML = legendHTML(r);

  const d = r.debt;
  const kp = $('[data-slot=kpis]', panel);
  kp.innerHTML = [
    kpi('gift', 'Free money this year', r.gift, r.reportedAid ? `${Math.round(r.giftShare * 100)}% of the ${usd(r.reportedAid)} called “aid”` : 'no aid listed'),
    kpi('debt', 'Loans offered this year', r.loans, r.loansBy.plus ? `${usd(r.loansBy.plus)} of it borrowed by a parent` : 'repaid with interest'),
    r.coa ? kpi('', 'Net price this year', r.netPrice, 'cost of attendance minus gift aid') : kpiNoCost('', 'Net price this year'),
    r.coa ? kpi('work', 'Still not covered', Math.max(0, r.outOfPocket), 'after grants, loans and work-study') : kpiNoCost('work', 'Still not covered'),
    r.coa ? kpi('dark', '4-year true cost', trueCost(r), 'net price plus loan fees and in-school interest') : kpiNoCost('dark', '4-year true cost'),
    kpi('debt', 'Borrowed over 4 years', r.fourYear.borrowed, `plus ${usd(d.interestInSchool)} interest before graduation`),
    kpi('debt', 'Student debt at graduation', d.studentAtRepayment, d.studentMonthly ? `about ${usd(d.studentMonthly)}/month for 10 years` : 'no student loans'),
    d.parentAtRepayment ? kpi('dark debt', 'Parent PLUS at graduation', d.parentAtRepayment, `about ${usd(d.parentMonthly)}/month for 10 years`) : kpi('', 'Loan fees over 4 years', r.fourYear.fees, 'taken out of each loan up front'),
  ].join('');
  if (animate) kp.classList.add('anim');
  settleCounts(kp, animate && !reduced);

  const flags = flagsFor(letter, r);
  const warns = flags.filter((f) => f.level === 'warn').length;
  const n = $('[data-slot=nflags]', panel);
  if (warns) n.textContent = warns; else n.remove();
  renderTab(letter, r, flags, animate);
}

function renderTab(letter, r, flags, animate) {
  const panel = $('#panel');
  const tabs = $$('.tabs [role=tab]', panel);
  tabs.forEach((t) => { const on = t.dataset.tab === state.tab; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
  const box = $('[data-slot=tab]', panel);
  box.setAttribute('aria-labelledby', `tab-${state.tab}`);
  box.classList.remove('anim');
  if (animate) { void box.offsetWidth; box.classList.add('anim'); }
  const T = { flags: tabFlags, years: tabYears, lines: tabLines, email: tabEmail }[state.tab];
  box.innerHTML = T(letter, r, flags);
  $$('.anim-on', box).forEach((el) => animate && !reduced && el.classList.add('anim'));
  settleCounts(box, animate && !reduced);
  const ta = $('.mail textarea', box);
  if (ta) ta.style.height = ta.scrollHeight + 4 + 'px';
  placeInk();
}

function placeInk() {
  const tabsEl = $('#panel .tabs');
  if (!tabsEl) return;
  const sel = $('[aria-selected=true]', tabsEl);
  const ink = $('.tab-ink', tabsEl);
  if (!sel || !ink) return;
  ink.style.setProperty('--x', sel.offsetLeft + 'px');
  ink.style.setProperty('--w', sel.offsetWidth + 'px');
}

// "under Every line" in a flag is a link to that tab.
const toLines = (s) => s.replace('Every line', '<button type="button" class="tablink" data-goto="lines">Every line</button>');

function tabFlags(letter, r, flags) {
  return flags.length
    ? `<ul class="flags anim-on">${flags.map((f, i) => `<li class="${f.level}" style="animation-delay:${i * 70}ms"><div><b>${esc(f.title)}</b><span>${toLines(esc(f.detail))}</span></div></li>`).join('')}</ul>`
    : '<ul class="flags"><li class="none"><div><b>Nothing tricky found</b><span>Still check the numbers against the letter.</span></div></li></ul>';
}

function tabYears(letter, r) {
  const ys = r.perYear;
  const W = 760, H = 300, L = 62, B = 34, T = 26;
  const top = Math.max(1000, ...ys.map((y) => Math.max(y.cost, y.gift + y.loans + y.work))) * 1.08;
  const yv = (v) => H - B - (v / top) * (H - B - T);
  const colW = 92, gap = (W - L - colW * 4) / 4;
  let step = top > 150000 ? 50000 : top > 60000 ? 25000 : 10000;
  if (top / step > 8 || top / step < 2) { // very large or very small offers: 3 to 6 gridlines
    const p = Math.pow(10, Math.floor(Math.log10(top / 4)));
    step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => top / s <= 6);
  }
  const tick = (v) => (!v ? '$0' : v >= 1e6 ? `$${+(v / 1e6).toFixed(2)}M` : v >= 1000 ? `$${+(v / 1000).toFixed(1)}k` : `$${v}`);
  let g = '';
  for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W}" y1="${yv(v)}" y2="${yv(v)}" stroke="#e4e4de"/><text x="${L - 10}" y="${yv(v) + 4}" text-anchor="end">${tick(v)}</text>`;
  ys.forEach((y, i) => {
    const x = L + gap / 2 + i * (colW + gap);
    let acc = 0;
    const segs = [['gift', y.gift, 'var(--gift)'], ['loans', y.loans, 'var(--debt)'], ['work', y.work, 'var(--work)'], ['gap', Math.max(0, y.outOfPocket), 'url(#hatch)']];
    segs.forEach(([k, v, fill], j) => {
      if (v <= 0) return;
      const y1 = yv(acc + v), h = yv(acc) - y1;
      g += `<rect class="bar" x="${x}" y="${y1}" width="${colW}" height="${Math.max(0, h - 1.5)}" rx="4" fill="${fill}" style="animation-delay:${i * 120 + j * 60}ms"><title>Year ${y.year} ${k}: ${usd(v)}</title></rect>`;
      acc += v;
    });
    g += `<text class="tv" x="${x + colW / 2}" y="${yv(Math.max(y.cost, acc)) - 9}" text-anchor="middle">${usd(y.cost)}</text><text x="${x + colW / 2}" y="${H - 12}" text-anchor="middle">Year ${y.year}</text>`;
  });
  const chart = `<svg class="chart anim-on" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cost of each year, split into gift aid, loans, work-study and the part not covered"><defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#dcddd6"/><rect width="4" height="8" fill="#c4c5bd"/></pattern></defs>${g}</svg>`;
  let cum = 0;
  const debtCells = ys.map((y) => { cum += y.loans; return cum; });
  const max = debtCells[3] || 1;
  const debtline = `<div class="debtline anim-on">${debtCells.map((c, i) => `<div><div class="k">Borrowed after year ${i + 1}</div><div class="v" data-to="${c}" data-delay="${i * 140}">${usd(c)}</div><div class="m"><i style="width:${(c / max) * 100}%;animation-delay:${i * 140}ms"></i></div></div>`).join('')}</div>`;
  const table = '<table><thead><tr><th>Year</th><th class="num">Cost</th><th class="num">Gift aid</th><th class="num">Net price</th><th class="num">Loans</th><th class="num">Work-study</th><th class="num">Not covered</th></tr></thead><tbody>' +
    ys.map((y) => `<tr><td>${y.year}</td><td class="num">${usd(y.cost)}</td><td class="num">${usd(y.gift)}</td><td class="num">${usd(y.net)}</td><td class="num">${usd(y.loans)}</td><td class="num">${usd(y.work)}</td><td class="num">${usd(Math.max(0, y.outOfPocket))}</td></tr>`).join('') +
    `<tr class="total"><td>Total</td><td class="num">${usd(r.fourYear.cost)}</td><td class="num">${usd(r.fourYear.gift)}</td><td class="num">${usd(r.fourYear.net)}</td><td class="num">${usd(r.fourYear.borrowed)}</td><td class="num">${usd(r.work * state.opts.years)}</td><td class="num">${usd(ys.reduce((s, y) => s + Math.max(0, y.outOfPocket), 0))}</td></tr></tbody></table>`;
  const key = [['var(--gift)', 'Gift aid'], ['var(--debt)', r.loansBy.plus ? 'Loans, student and Parent PLUS' : 'Loans'], ...(r.work ? [['var(--work)', 'Work-study']] : []), ...(ys.some((y) => y.outOfPocket > 0) ? [['repeating-linear-gradient(135deg,#c4c5bd 0 3px,#dcddd6 3px 6px)', 'Not covered']] : [])];
  return `<div class="yrs-wrap">${chart}<ul class="legend">${key.map(([c, t]) => `<li><i style="background:${c}"></i>${t}</li>`).join('')}</ul>${debtline}<details class="nums"><summary>Show the numbers</summary><div class="tablewrap">${table}</div></details><p class="fine" style="margin:0">Costs grow ${(state.opts.costGrowth * 100).toFixed(1)}% a year. First-year-only awards drop off after year one. Borrowing repeats each year. Change any of this under Assumptions.</p></div>`;
}

const LINE_OPTS = [['gift', 'Gift aid'], ['loan:sub', LOAN_KIND.sub], ['loan:unsub', LOAN_KIND.unsub], ['loan:plus', LOAN_KIND.plus], ['loan:private', LOAN_KIND.private], ['work', 'Work-study'], ['cost:direct', 'Cost (billed)'], ['cost:indirect', 'Cost (not billed)'], ['total', 'A total (not counted)'], ['info', 'Not counted']];
const optionsHTML = (selected) => LINE_OPTS.map(([v, t]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${t}</option>`).join('');
function setCategory(l, value) {
  const [cat, sub] = value.split(':');
  l.total = cat === 'total';
  l.category = l.total ? 'info' : cat;
  l.kind = cat === 'loan' ? sub : null;
  l.direct = cat === 'cost' ? sub === 'direct' : null;
  l.guessed = false;
}

function tabLines(letter, r, flags) {
  const flagged = new Set(flags.flatMap((f) => f.lineIds));
  const cur = (l) => (l.category === 'loan' ? `loan:${l.kind}` : l.category === 'cost' ? `cost:${l.direct === false ? 'indirect' : 'direct'}` : l.total ? 'total' : l.category);
  const cls = (l) => (l.total ? 'total' : l.category === 'loan' ? (l.kind === 'plus' ? 'plus' : 'loan') : l.category);
  // A letter that leaves out costs needs them added: suggest the missing kind.
  const next = r.counts.cost === 0 ? 'cost:direct' : r.indirect === 0 ? 'cost:indirect' : 'gift';
  const hint = r.counts.cost === 0 ? 'Cost of attendance, from the school’s website' : r.indirect === 0 ? 'Books, transportation, personal costs' : 'Label';
  return `<p class="hint" style="margin:0 0 14px">Every line keeps the words it came from. If the reader got one wrong, change it; everything updates.</p><div class="lines anim-on">${letter.lines
    .map((l, j) => `<div class="ln ${cls(l)}${flagged.has(l.id) ? ' flagged' : ''}" style="animation-delay:${j * 35}ms"><i></i><div><span class="lbl">${esc(l.label)}</span>${l.firstYearOnly ? '<span class="pill">first year only</span>' : ''}${l.readBy === 'claude' ? '<span class="pill claude">read by Claude</span>' : ''}<span class="src" title="${esc(l.source)}">${esc(l.source)}${l.how ? ' · ' + esc(l.how) : ''}</span></div><select data-j="${j}" aria-label="Category for ${esc(l.label)}">${optionsHTML(cur(l))}</select><input data-j="${j}" type="number" min="0" step="1" value="${l.annual}" aria-label="Amount per year for ${esc(l.label)}"></div>`)
    .join('')}</div>
    <form class="addline" novalidate><span class="mono label">Add a line the letter left out</span><input name="label" type="text" autocomplete="off" placeholder="${hint}" aria-label="Label for the new line"><select name="cat" aria-label="Category for the new line">${optionsHTML(next)}</select><input name="amt" type="number" min="0" step="1" inputmode="decimal" placeholder="Per year" aria-label="Amount per year for the new line"><button class="btn sm dark" type="submit">Add</button><span class="status" role="status"></span></form>`;
}

function tabEmail(letter, r) {
  const draft = draftEmail(letter, r);
  return `<div class="mail"><div class="mail-bar"><i></i><i></i><i></i><span>New message</span></div><div class="mail-f"><span>To</span><span>${esc(officeName(letter))}</span></div><div class="mail-f"><span>Subject</span><span>${esc(draft.subject)}</span></div><textarea aria-label="Email to the aid office">${esc(draft.body)}</textarea><div class="mail-foot"><button class="btn dark sm" data-act="copy">Copy email</button><button class="btn sm" data-act="polish" ${state.key ? '' : 'disabled title="Add an API key under “Use Claude” first"'}>Reword with Claude</button><span class="status" data-slot="emailStatus" role="status"></span></div></div><p class="fine">Built from what this letter does. Every question points at a line or a gap in it.</p>`;
}

// ---------- compare ----------
// Two offers from the same school (a first offer and a revised one) are told
// apart by their place in the list.
function displayNames() {
  return state.letters.map((l, i) => (state.letters.filter((x) => x.school === l.school).length > 1 ? `${l.school} (offer ${i + 1})` : l.school));
}

function renderCompare(animate) {
  const rs = state.letters.map(resultFor);
  const names = displayNames();
  const ranked = compare(rs);
  // Offers with no costs listed can't be ranked; they sit at the bottom.
  const costed = ranked.filter((x) => x.score !== null);
  const costedRs = rs.filter((r) => r.coa > 0);
  const max = Math.max(1, ...costedRs.map(trueCost));
  const best = costed[0], second = costed[1], last = costed[costed.length - 1];
  const min = (f) => Math.min(...costedRs.map(f));
  const cell = (r, f) => (r.coa > 0 ? `<td class="num${f(r) === min(f) ? ' best' : ''}">${usd(f(r))}</td>` : '<td class="num">—</td>');
  const panel = $('#panel');
  const missing = ranked.filter((x) => x.score === null).map((x) => esc(names[x.i]));
  const verdict = costed.length < 2
    ? `${costed.length ? `Only <b>${esc(names[best.i])}</b> lists its costs.` : 'None of these offers lists its costs.'} Add the cost of attendance to ${missing.join(' and ')} under Every line to compare them.`
    : (last.moreThanBest < 1
      ? `These offers cost the same over four years: ${usd(best.score)}.`
      : `<b>${esc(names[best.i])}</b> costs the least over four years: <span class="g">${usd(last.moreThanBest)} less</span> than ${esc(names[last.i])}${second && second !== last ? ` and ${usd(second.moreThanBest)} less than ${esc(names[second.i])}` : ''}.`)
      + (missing.length ? ` ${missing.join(' and ')} ${missing.length === 1 ? 'lists' : 'list'} no costs, so ${missing.length === 1 ? 'it is' : 'they are'} not ranked.` : '');
  panel.innerHTML = `<div class="cmp">
    <p class="mono dim meta">${rs.length} offers · ranked by four-year true cost</p>
    <h2>Compare offers</h2>
    <p class="verdict on">${verdict}</p>
    <div class="race${animate && !reduced ? ' anim' : ''}">${ranked.map(({ i: k, score }, i) => {
      const r = rs[k];
      if (score === null) return `<div class="race-row"><div class="nm">${esc(names[k])}<small>no costs listed</small></div><div class="tk"></div><div class="v">—</div></div>`;
      const tc = trueCost(r), extra = r.debt.interestInSchool + r.fourYear.fees;
      const w = Math.max(0, (tc / max) * 78);
      const top = i === 0 && costed.length > 1;
      return `<div class="race-row${top ? ' best' : ''}"><div class="nm">${esc(names[k])}<small>${usd(r.netPrice)} net price / year</small></div><div class="tk"><div class="fill" style="--w:${w}%;animation-delay:${i * 150}ms"><i class="np" style="width:${tc > 0 ? ((tc - extra) / tc) * 100 : 0}%"></i><i class="it" style="width:${tc > 0 ? (extra / tc) * 100 : 0}%"></i></div>${top ? `<span class="stamp" style="--w:${w}%">lowest true cost</span>` : ''}</div><div class="v" data-to="${Math.round(tc)}" data-delay="${i * 150}">${usd(tc)}</div></div>`;
    }).join('')}</div>
    <div class="race-key"><span><i style="background:var(--ink)"></i>Four years of net price</span><span><i style="background:var(--debt)"></i>Loan fees and interest while in school</span></div>
    <div class="tablewrap"><table><thead><tr><th>School</th><th class="num">4-year true cost</th><th class="num">Gift aid / year</th><th class="num">Net price / year</th><th class="num">Not covered / year</th><th class="num">Student debt at graduation</th><th class="num">Monthly payment</th><th class="num">Parent PLUS at graduation</th><th class="num">Flags</th></tr></thead><tbody>
    ${ranked.map(({ i: k }) => {
      const r = rs[k];
      const warns = flagsFor(state.letters[k], r).filter((f) => f.level === 'warn').length;
      const all = (f) => `<td class="num${f(r) === Math.min(...rs.map(f)) ? ' best' : ''}">${usd(f(r))}</td>`; // figures that don't need costs
      return `<tr><td>${esc(names[k])}</td>${cell(r, trueCost)}<td class="num${r.gift === Math.max(...rs.map((x) => x.gift)) ? ' best' : ''}">${usd(r.gift)}</td>${cell(r, (x) => x.netPrice)}${cell(r, (x) => Math.max(0, x.outOfPocket))}${all((x) => x.debt.studentAtRepayment)}${all((x) => x.debt.studentMonthly)}${all((x) => x.debt.parentAtRepayment)}<td class="num">${warns}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <p class="fine">“True cost” is four years of net price plus loan fees and the interest that builds while you're in school. The best figure in each column is green: the most gift aid, the lowest of everything else.</p>
    <div class="cmp-bars">${rs.map((r, i) => `<div><h3>${esc(names[i])}</h3><div data-bar="${i}"></div><ul class="legend">${legendHTML(r)}</ul></div>`).join('')}</div>
  </div>`;
  rs.forEach((r, i) => drawSplit($(`[data-bar="${i}"]`, panel), r, { animate }));
  settleCounts(panel, animate && !reduced);
}

function render({ animate } = {}) {
  $('#work').hidden = state.letters.length === 0;
  renderList();
  const key = `${state.current}|${state.letters.length}`;
  const anim = animate ?? key !== lastShown;
  lastShown = key;
  if (state.current === 'compare' && state.letters.length >= 2) renderCompare(anim);
  else if (state.letters.length) renderLetter(Math.min(state.current ?? 0, state.letters.length - 1), anim);
  announce();
  const p = new URLSearchParams(location.search);
  if (state.current === 'compare') p.set('view', 'compare'); else p.delete('view');
  history.replaceState(null, '', `${location.pathname}${p.toString() ? '?' + p : ''}${location.hash}`);
}
function show(fn) {
  if (document.startViewTransition && !reduced) document.startViewTransition(fn); else fn();
}

// Screen readers hear the verdict when an offer opens or its numbers change,
// not the whole panel.
function announce() {
  const v = $('#panel .verdict');
  const msg = state.letters.length ? `${$('#panel .school, #panel .cmp h2')?.textContent || ''}. ${v ? v.textContent : ''}` : '';
  if ($('#announce').textContent !== msg) $('#announce').textContent = msg;
}

// Editing a line re-renders the panel; keyboard focus goes back to the same
// control instead of falling to the top of the page.
function focusKey(el) {
  if (!el || !$('#panel').contains(el)) return null;
  for (const a of ['j', 'tab', 'act', 'goto']) if (el.dataset[a] !== undefined) return `${el.tagName.toLowerCase()}[data-${a}="${el.dataset[a]}"]`;
  if (el.name && el.closest('.addline')) return `.addline [name="${el.name}"]`;
  return null;
}
function rerender() {
  const k = focusKey(document.activeElement);
  render({ animate: false });
  if (k) $(k, $('#panel'))?.focus({ preventScroll: true });
}

let drawerFrom = null;
function openDrawer(from) {
  drawerFrom = from;
  $('#assumptions').innerHTML = assumptionsForm();
  $('#drawer').hidden = false;
  $('#assumptions input')?.focus();
}
function closeDrawer() {
  $('#drawer').hidden = true;
  (drawerFrom?.isConnected ? drawerFrom : $('#panel [data-act=assumptions]'))?.focus({ preventScroll: true });
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
    `<p class="fine" style="margin:0">Defaults are the federal terms for loans first disbursed in ${RULES.year}. The private rate is a placeholder; use your lender's.</p>`,
  ].join('');
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) { if (e.target === $('#drawer')) closeDrawer(); return; }
  if (b.dataset.i !== undefined) { state.current = +b.dataset.i; show(() => render()); return; }
  if (b.dataset.demo !== undefined) return loadDemo(0, true);
  if (b.dataset.sample !== undefined) return loadDemo(+b.dataset.sample, true);
  if (b.dataset.tab) {
    state.tab = b.dataset.tab;
    const l = state.letters[state.current];
    const r = resultFor(l);
    renderTab(l, r, flagsFor(l, r), true);
    return;
  }
  if (b.dataset.goto) { $(`#panel .tabs [data-tab="${b.dataset.goto}"]`)?.click(); $('#panel .addline input')?.focus(); return; }
  if (b.id === 'showCompare') { state.current = 'compare'; show(() => render()); $('#work').scrollIntoView({ behavior: 'smooth' }); return; }
  if (b.id === 'addLetter') { $('#paste').scrollIntoView({ behavior: 'smooth' }); $('#letterText').focus({ preventScroll: true }); return; }
  const act = b.dataset.act;
  if (act === 'assumptions') openDrawer(b);
  if (act === 'close-drawer') closeDrawer();
  if (act === 'print') window.print();
  if (act === 'remove') {
    state.letters.splice(state.current, 1);
    state.current = state.letters.length ? 0 : null;
    render({ animate: true });
    (state.letters.length ? $('#letterList button') : $('#letterText'))?.focus({ preventScroll: !state.letters.length });
  }
  if (act === 'copy') { const ta = $('.mail textarea'); ta.select(); try { await navigator.clipboard.writeText(ta.value); } catch { document.execCommand('copy'); } b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy email'), 1600); }
  if (act === 'polish') {
    const st = $('[data-slot=emailStatus]');
    st.textContent = 'Asking Claude…'; st.className = 'status';
    try { $('.mail textarea').value = await polishEmail({ key: state.key, model: state.model, draft: $('.mail textarea').value }); st.textContent = 'Reworded. Every dollar figure was checked against the draft.'; }
    catch (err) { st.textContent = err.message; st.className = 'status err'; }
  }
});

document.addEventListener('keydown', (e) => {
  const open = !$('#drawer').hidden;
  if (e.key === 'Escape' && open) return closeDrawer();
  if (e.key === 'Tab' && open) { // keep focus inside the open drawer
    const f = $$('#drawer button, #drawer input');
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    return;
  }
  const t = e.target;
  const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
  if (t.matches?.('.tabs [role=tab]') && e.key in keys) {
    e.preventDefault();
    const tabs = $$('.tabs [role=tab]');
    const k = keys[e.key];
    const n = k === 'first' ? tabs[0] : k === 'last' ? tabs[tabs.length - 1] : tabs[(tabs.indexOf(t) + k + tabs.length) % tabs.length];
    n.click(); $(`.tabs [data-tab="${n.dataset.tab}"]`).focus();
  }
});

// Add a line the letter left out (the cost of attendance, books, an award).
document.addEventListener('submit', (e) => {
  const f = e.target.closest('.addline');
  if (!f) return;
  e.preventDefault();
  const el = f.elements;
  const amt = Number(el.amt.value);
  const st = $('.status', f);
  if (!(amt > 0)) { st.textContent = 'Enter an amount per year.'; st.className = 'status err'; el.amt.focus(); return; }
  const letter = state.letters[state.current];
  const label = el.label.value.trim() || LINE_OPTS.find(([v]) => v === el.cat.value)[1];
  const line = { id: `U${letter.lines.length + 1}`, source: 'Added by you', label, annual: Math.round(amt * 100) / 100, how: '', firstYearOnly: false };
  setCategory(line, el.cat.value);
  letter.lines.push(line);
  render({ animate: false });
  const nf = $('#panel .addline');
  if (nf) { $('.status', nf).textContent = `Added ${label}, ${usd(line.annual)} a year.`; nf.elements.label.focus({ preventScroll: true }); }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  // Re-render after focus has moved (a Tab out of a field), so it can be restored.
  if (t.matches('.ln select')) {
    setCategory(state.letters[state.current].lines[+t.dataset.j], t.value);
    setTimeout(rerender);
  }
  if (t.matches('.ln input')) {
    state.letters[state.current].lines[+t.dataset.j].annual = Math.max(0, Number(t.value) || 0);
    setTimeout(rerender);
  }
  if (t.dataset.opt) {
    const v = Number(t.value) / 100;
    if (!Number.isFinite(v) || v < 0) return;
    const [a, b] = t.dataset.opt.split('.');
    if (b) { state.opts[a][b] = v; if (b === 'unsub') state.opts[a].sub = v; } else state.opts[a] = v;
    render({ animate: false });
  }
});

function status(msg, err = false) { const s = $('#readStatus'); s.textContent = msg; s.className = err ? 'status err' : 'status'; }

$('#readRules').addEventListener('click', () => {
  const text = $('#letterText').value.trim();
  if (!text) return status('Paste the letter text first.', true);
  const parsed = parseLetter(text, $('#schoolName').value.trim() || `School ${state.letters.length + 1}`);
  if ($('#schoolName').value.trim()) { parsed.school = $('#schoolName').value.trim(); parsed.named = true; }
  if (!parsed.lines.length) return status('No dollar amounts found. Is this the aid letter?', true);
  addLetter(parsed, text);
  status(`Read ${parsed.lines.length} lines from ${parsed.school}.`);
  $('#letterText').value = ''; $('#schoolName').value = '';
  state.tab = 'flags';
  render({ animate: true });
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
    const parsed = { school: $('#schoolName').value.trim() || out.school || `School ${state.letters.length + 1}`, named: !!($('#schoolName').value.trim() || out.school), lines: out.lines, conditions: out.conditions, claims: text ? parseLetter(text).claims : [], notes: [] };
    addLetter(parsed, text, 'claude');
    status(`Claude read ${out.lines.length} lines${out.dropped.length ? `; ${out.dropped.length} were dropped because their amounts aren't in the letter` : ''}${pendingImage ? '. From a photo, so check each one.' : '.'}`);
    pendingImage = null; $('#fileIn').value = ''; $('#letterText').value = ''; $('#schoolName').value = '';
    state.tab = 'flags';
    render({ animate: true });
    $('#work').scrollIntoView({ behavior: 'smooth' });
  } catch (err) { status(err.message, true); }
});

$('#apiKey').addEventListener('input', (e) => { state.key = e.target.value.trim(); $('#readClaude').disabled = !state.key; if (state.letters.length) render({ animate: false }); });
$('#model').innerHTML = MODELS.map((m) => `<option>${m}</option>`).join('');
$('#model').addEventListener('change', (e) => { state.model = e.target.value; });

async function takeFile(file) {
  pendingImage = null;
  if (!file) return;
  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      status('Reading the PDF…');
      const text = await pdfText(file);
      $('#letterText').value = text;
      status(text.trim() ? 'PDF text loaded. Check it, then press “Read it”.' : 'This PDF has no text layer (it is a scan). Use “Read it with Claude”.', !text.trim());
    } else if (file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name)) {
      // The API takes JPEG, PNG, GIF and WebP images up to 5 MB.
      if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return status('Claude reads JPEG, PNG, GIF and WebP photos. Save this one as a JPEG first.', true);
      if (file.size > 5 * 1024 * 1024) return status('That photo is over 5 MB. Crop it or save it smaller first.', true);
      const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(file); });
      pendingImage = { mediaType: file.type, data };
      status(state.key ? 'Photo loaded. Press “Read it with Claude”.' : 'Photos need Claude: add your API key under “Use Claude”.', !state.key);
      if (!state.key) $('details.claude-key').open = true;
    } else if (file.type.startsWith('text/') || /\.(txt|text|csv|tsv|md)$/i.test(file.name)) {
      $('#letterText').value = await file.text();
      status('Text loaded. Press “Read it”.');
    } else {
      status('That file type can’t be read here. Use a PDF, a photo or a text file; from a Word file, copy the text and paste it.', true);
    }
  } catch (err) { status(`Couldn't read that file: ${err.message}`, true); }
}
$('#fileIn').addEventListener('change', (e) => takeFile(e.target.files[0]));
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return; drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) takeFile(f);
  else { const t = e.dataTransfer.getData('text'); if (t) { $('#letterText').value = t; status('Text dropped in. Press “Read it”.'); } }
});
// A file dropped anywhere else on the page is read too, instead of the browser
// leaving the page to open it.
addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (!f || drop.contains(e.target)) return;
  e.preventDefault();
  $('#paste').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  takeFile(f);
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

// Opens the sample offers next to any letters already added, so a family can
// compare its own offer with them; a sample already open is not added twice.
function loadDemo(open = 0, scroll = false) {
  open = Math.max(0, Math.min(SAMPLES.length - 1, Math.trunc(+open) || 0));
  SAMPLES.forEach((s, i) => { if (!state.letters.some((l) => l.sample === i)) addLetter(parseLetter(s.text, s.name), s.text).sample = i; });
  const p = new URLSearchParams(location.search);
  state.current = p.get('view') === 'compare' && !scroll ? 'compare' : state.letters.findIndex((l) => l.sample === open);
  state.tab = 'flags';
  render({ animate: true });
  if (scroll) $('#work').scrollIntoView({ behavior: 'smooth' });
}

// ---------- page touches ----------
SAMPLES.forEach((s, i) => { const el = $(`[data-mini="${i}"]`); if (el) el.innerHTML = miniBar(analyze(parseLetter(s.text, s.name))); });
const ro = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in', 'seen'); ro.unobserve(e.target); } }), { threshold: 0.2 });
$$('.rv, .env-bar').forEach((el) => ro.observe(el));
const nav = $('.nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 8), { passive: true });
addEventListener('resize', placeInk);

const q = new URLSearchParams(location.search);
if (q.get('demo') === '1') {
  loadDemo(q.get('offer') || 0, false);
  if (q.get('tab') && ['flags', 'years', 'lines', 'email'].includes(q.get('tab'))) { state.tab = q.get('tab'); render({ animate: true }); }
}
window.GOD = { HERO, loadDemo, state, render };
