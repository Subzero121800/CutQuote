/* ==================================================================
   CUTQUOTE — field pricing for lawn, snow & leaf work
   Operator mode: full cost build-up. Homeowner mode: fair-price check.
   Routing: Nominatim geocoding + OSRM public routing (no API keys).
   No frameworks, no build step. All state lives in this file + localStorage.
   ================================================================== */

// ---------------- data ----------------
const MOWERS = {
  push21: { label: '21" push mower', acHr: 0.22, galHr: 0.3 },
  walk30: { label: '30" walk-behind', acHr: 0.35, galHr: 0.4 },
  rider42: { label: '42" lawn tractor', acHr: 0.8, galHr: 0.9 },
  ztr48: { label: '48" zero-turn', acHr: 1.4, galHr: 1.2 },
  ztr60: { label: '60" zero-turn', acHr: 2.0, galHr: 1.5 },
};
const TERRAIN = { flat: { label: 'Flat', f: 1 }, rolling: { label: 'Rolling', f: 0.8 }, steep: { label: 'Steep / banks', f: 0.6 } };
const OBSTACLES = { open: { label: 'Wide open', f: 1 }, some: { label: 'Some trees & beds', f: 0.85 }, tight: { label: 'Tight / fenced', f: 0.7 } };
const FREQ = { weekly: { label: 'Weekly', f: 1, cuts: 26 }, biweekly: { label: 'Every 2 weeks', f: 1.15, cuts: 13 }, once: { label: 'One-time / overgrown', f: 1.5, cuts: 1 } };
const SNOWEQ = {
  shovel: { label: 'Shovel only', sfHr: 700, galHr: 0 },
  ss: { label: 'Single-stage blower', sfHr: 3000, galHr: 0.4 },
  ts: { label: 'Two-stage blower', sfHr: 5000, galHr: 0.7 },
  utv: { label: 'ATV / UTV plow', sfHr: 10000, galHr: 1.2 },
  plow: { label: 'Plow truck', sfHr: 20000, galHr: 2.5 },
};
const DEPTH = { d2: { label: '1–3"', f: 1 }, d4: { label: '3–6"', f: 1.4 }, d8: { label: '6–9"', f: 1.9 }, d12: { label: '9–12"', f: 2.5 }, d99: { label: '12"+', f: 3.2 } };
const DRIVEPRESET = { one: { label: '1-car (~200)', v: 200 }, two: { label: '2-car (~450)', v: 450 }, long: { label: 'Long rural (~1200)', v: 1200 } };
const TREE = { light: { label: 'Light', f: 1 }, mod: { label: 'Moderate', f: 1.5 }, heavy: { label: 'Heavy / wooded edge', f: 2.2 } };
const SALT_LB_PER_KSF = 15, APPLY_MIN_PER_KSF = 4, WALK_WIDTH = 4, LEAF_AC_HR = 0.4, SEASON_DISC = 0.9;
const STORE_KEY = 'cutquote.v1';

const BILLING = { visit: { label: 'Per visit' }, block: { label: 'Prepay a block' }, season: { label: 'Prepay the season' } };

// ---------------- state ----------------
const S = { mode: 'homeowner', svc: 'lawn', route: null, useManual: false, terrain: 'flat', obstacles: 'some', freq: 'weekly', depth: 'd4', tree: 'mod', billing: 'visit' };
let LAST = null; // last calc result, used by COPY QUOTE

const $ = (id) => document.getElementById(id);
const num = (id) => { const v = parseFloat($(id).value); return isNaN(v) ? 0 : v; };
const fmt = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt2 = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- persistence ----------------
const FIELD_IDS = ['baseAddr', 'jobAddr', 'manMiles', 'manMins', 'acres', 'mowablePct', 'trimMins', 'detailMins', 'loadMins', 'fuel', 'mpg', 'drivePct', 'crew', 'laborRate', 'margin', 'minCharge', 'driveSqft', 'walkFt', 'bagPrice', 'events', 'dumpFee', 'lacres', 'mower', 'snowEquip', 'regridToken', 'bizName', 'custName', 'custAddr', 'prepayN', 'prepayDisc'];
const CHECK_IDS = ['salting', 'priority', 'haul'];

function saveState() {
  try {
    const data = { S: { mode: S.mode, svc: S.svc, useManual: S.useManual, terrain: S.terrain, obstacles: S.obstacles, freq: S.freq, depth: S.depth, tree: S.tree, billing: S.billing }, f: {}, c: {} };
    FIELD_IDS.forEach((id) => (data.f[id] = $(id).value));
    CHECK_IDS.forEach((id) => (data.c[id] = $(id).checked));
    data.terms = $('contractTerms').textContent;
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) { /* private mode / storage full — app still works, just no persistence */ }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.S) ['mode', 'svc', 'terrain', 'obstacles', 'freq', 'depth', 'tree', 'billing'].forEach((k) => { if (d.S[k]) S[k] = d.S[k]; });
    if (d.S) S.useManual = !!d.S.useManual;
    if (d.f) Object.entries(d.f).forEach(([id, v]) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; });
    if (d.c) Object.entries(d.c).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.checked = !!v; });
    if (d.terms) $('contractTerms').textContent = d.terms;
  } catch (e) { /* corrupt store — fall through to defaults */ }
  // guard against stale keys from older versions
  if (!TERRAIN[S.terrain]) S.terrain = 'flat';
  if (!OBSTACLES[S.obstacles]) S.obstacles = 'some';
  if (!FREQ[S.freq]) S.freq = 'weekly';
  if (!DEPTH[S.depth]) S.depth = 'd4';
  if (!TREE[S.tree]) S.tree = 'mod';
  if (!BILLING[S.billing]) S.billing = 'visit';
  if (!MOWERS[$('mower').value]) $('mower').value = 'ztr48';
  if (!SNOWEQ[$('snowEquip').value]) $('snowEquip').value = 'ts';
}
function resetAll() {
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  location.reload();
}

// ---------------- ui builders ----------------
function buildSeg(el, opts, key, onChange) {
  const box = $(el); box.innerHTML = '';
  Object.entries(opts).forEach(([k, o]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = o.label; b.className = S[key] === k ? 'on' : '';
    b.onclick = () => { S[key] = k; buildSeg(el, opts, key, onChange); (onChange || recalc)(); };
    box.appendChild(b);
  });
}
function buildPreset() {
  const box = $('segDrivePreset'); box.innerHTML = '';
  Object.values(DRIVEPRESET).forEach((o) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = o.label;
    b.onclick = () => { $('driveSqft').value = o.v; recalc(); };
    box.appendChild(b);
  });
}
function buildSel(id, opts, def) {
  const s = $(id); s.innerHTML = '';
  Object.entries(opts).forEach(([k, o]) => { const op = document.createElement('option'); op.value = k; op.textContent = o.label; s.appendChild(op); });
  s.value = def;
}

function setMode(m) {
  S.mode = m; document.body.dataset.mode = m;
  $('mHome').className = m === 'homeowner' ? 'on' : ''; $('mHome').setAttribute('aria-selected', m === 'homeowner');
  $('mOp').className = m === 'operator' ? 'on' : ''; $('mOp').setAttribute('aria-selected', m === 'operator');
  document.querySelectorAll('.mode-op').forEach((e) => e.classList.toggle('hidden', m !== 'operator'));
  $('routeLbl').textContent = m === 'operator' ? 'Route: shop to job' : 'Route: how far is the crew coming?';
  $('baseAddr').placeholder = m === 'operator' ? 'Your shop / home base address' : 'Contractor town or address (optional)';
  applyAccent(); recalc();
}
function setSvc(v) {
  S.svc = v; document.body.dataset.svc = v;
  ['Lawn', 'Snow', 'Leaf'].forEach((n) => {
    const on = v === n.toLowerCase();
    $('t' + n).className = on ? 'on' : ''; $('t' + n).setAttribute('aria-selected', on);
  });
  ['lawn', 'snow', 'leaf'].forEach((s) =>
    document.querySelectorAll('.svc-' + s).forEach((e) => e.classList.toggle('hidden', v !== s)));
  applyAccent(); recalc();
}
function applyAccent() {
  const c = S.svc === 'snow' ? 'var(--snow)' : S.svc === 'leaf' ? 'var(--leaf)' : S.mode === 'operator' ? 'var(--op)' : 'var(--home)';
  document.documentElement.style.setProperty('--accent', c);
  $('logoAx').textContent = S.svc === 'snow' ? 'QUOTE ❄' : S.svc === 'leaf' ? 'QUOTE 🍂' : 'QUOTE';
}
function syncManual() { $('manualRow').classList.toggle('hidden', !!S.route && !S.useManual); }
function syncAux() {
  $('bagFld').classList.toggle('hidden', !$('salting').checked);
  $('dumpFld').classList.toggle('hidden', !$('haul').checked);
}

// ---------------- routing ----------------
// Geocoding chain: Nominatim knows towns everywhere but misses many rural US
// house numbers; the US Census geocoder (TIGER data) is authoritative for US
// street addresses but sends no CORS headers, so it's called via JSONP.
// Street-looking queries try Census first, town-looking queries Nominatim first.
function jsonp(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const cb = '__cq' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('Address service timed out')); }, timeoutMs);
    function cleanup() { clearTimeout(timer); delete window[cb]; s.remove(); }
    window[cb] = (data) => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error('Address service unreachable')); };
    s.src = url + '&callback=' + cb;
    document.head.appendChild(s);
  });
}
async function censusGeocode(q) {
  const j = await jsonp('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=' + encodeURIComponent(q) + '&benchmark=Public_AR_Current&format=jsonp');
  const m = j && j.result && j.result.addressMatches && j.result.addressMatches[0];
  if (!m) throw new Error('no census match');
  return { lat: m.coordinates.y, lon: m.coordinates.x, name: m.matchedAddress };
}
async function nominatimGeocode(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('Address lookup failed');
  const j = await r.json();
  if (!j.length) throw new Error('not found');
  return { lat: +j[0].lat, lon: +j[0].lon, name: j[0].display_name };
}
async function geocode(q) {
  const looksStreet = /^\s*\d+\s+\S/.test(q);
  const tries = looksStreet ? [censusGeocode, nominatimGeocode] : [nominatimGeocode, censusGeocode];
  for (const fn of tries) {
    try { return await fn(q); } catch (e) { /* try next provider */ }
  }
  // approximate fallbacks: locate the street, then the town, and say so
  const stripped = q.replace(/^\s*[\d\-]+\s+/, '');
  if (stripped !== q) {
    try { return { ...(await nominatimGeocode(stripped)), approx: true }; } catch (e) { /* keep falling back */ }
  }
  const townPart = q.split(',').slice(1).join(',').trim();
  if (townPart) {
    try { return { ...(await nominatimGeocode(townPart)), approx: true }; } catch (e) { /* give up below */ }
  }
  throw new Error('Address not found: "' + q + '"');
}
async function osrm(a, b) {
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
  if (!r.ok) throw new Error('Routing service unavailable');
  const j = await r.json();
  if (!j.routes || !j.routes.length) throw new Error('No drivable route found');
  return { miles: j.routes[0].distance / 1609.34, minutes: j.routes[0].duration / 60 };
}
async function calcRoute() {
  const btn = $('routeBtn'), err = $('routeErr');
  err.classList.add('hidden'); btn.disabled = true; btn.textContent = 'ROUTING...';
  S.route = null; $('routeOut').textContent = '';
  try {
    const ja = $('jobAddr').value.trim(), ba = $('baseAddr').value.trim();
    if (!ja) throw new Error('Enter the job address first.');
    if (!ba) throw new Error(S.mode === 'operator' ? 'Enter your shop or home base address.' : "Enter the contractor's town or address, or use manual miles below.");
    const A = await geocode(ba), B = await geocode(ja), r = await osrm(A, B);
    S.route = { ...r, to: B.name.split(',').slice(0, 3).join(',') };
    S.useManual = false; $('useManual').checked = false;
    const approx = A.approx || B.approx;
    $('routeOut').textContent = (approx ? '≈ ' : '') + r.miles.toFixed(1) + ' mi · ' + Math.round(r.minutes) + ' min each way';
    if (approx) {
      err.textContent = 'Exact house number not in map data — distance measured from the nearest street or town center.';
      err.classList.remove('hidden');
    }
  } catch (e) {
    err.textContent = e.message + ' — you can enter miles and minutes manually below.';
    err.classList.remove('hidden');
    S.useManual = true; $('useManual').checked = true;
  } finally {
    btn.disabled = false; btn.textContent = 'CALCULATE ROUTE';
    syncManual(); recalc();
  }
}
function effRoute() { return (S.useManual || !S.route) ? { miles: num('manMiles'), minutes: num('manMins') } : S.route; }

// ---------------- engines ----------------
function baseCosts(siteHrs, equipFuelGal) {
  const e = effRoute(), crew = num('crew'), rate = num('laborRate');
  const labor = siteHrs * rate * crew;
  const driveHrs = (e.minutes * 2) / 60;
  const drive = driveHrs * rate * crew * (num('drivePct') / 100);
  const vehFuel = ((e.miles * 2) / Math.max(num('mpg'), 1)) * num('fuel');
  const eqFuel = equipFuelGal * num('fuel');
  return { labor, drive, vehFuel, eqFuel, driveHrs, e, cost: labor + drive + vehFuel + eqFuel };
}
function priceIt(cost) { const p = cost * (1 + num('margin') / 100); return Math.max(p, num('minCharge')); }

function calcLawn() {
  const ac = num('acres'), mowAc = (ac * num('mowablePct')) / 100;
  const mw = MOWERS[$('mower').value] || MOWERS.ztr48;
  const rate = mw.acHr * TERRAIN[S.terrain].f * OBSTACLES[S.obstacles].f;
  const mowHrs = (mowAc / Math.max(rate, 0.01)) * FREQ[S.freq].f;
  const siteHrs = mowHrs + (num('trimMins') + num('loadMins')) / 60;
  const b = baseCosts(siteHrs, mowHrs * mw.galHr);
  const per = priceIt(b.cost);
  return {
    ...b, per, siteHrs, cuts: FREQ[S.freq].cuts, marginUsd: Math.max(per - b.cost, 0),
    lines: [
      ['Mowable area', mowAc.toFixed(2) + ' ac', ac + ' ac × ' + num('mowablePct') + '%'],
      ['Deck time', (mowHrs * 60).toFixed(0) + ' min', mw.label],
      ['Trim / edge / load', (num('trimMins') + num('loadMins')) + ' min', ''],
    ],
  };
}

function calcSnow() {
  const area = num('driveSqft') + num('walkFt') * WALK_WIDTH;
  const eq = SNOWEQ[$('snowEquip').value] || SNOWEQ.ts, df = DEPTH[S.depth].f;
  let clearHrs = (area / Math.max(eq.sfHr, 1)) * df;
  // a plow truck can't do walkways — those get shoveled by hand
  const walkShovelHrs = $('snowEquip').value === 'plow' ? ((num('walkFt') * WALK_WIDTH) / 700) * df : 0;
  clearHrs += walkShovelHrs;
  const saltOn = $('salting').checked;
  const saltLbs = saltOn ? (area / 1000) * SALT_LB_PER_KSF : 0;
  const saltMat = (saltLbs / 50) * num('bagPrice');
  const saltHrs = saltOn ? ((area / 1000) * APPLY_MIN_PER_KSF) / 60 : 0;
  const siteHrs = clearHrs + saltHrs + (num('detailMins') + num('loadMins')) / 60;
  const b = baseCosts(siteHrs, clearHrs * eq.galHr);
  const cost = b.cost + saltMat;
  const basePer = priceIt(cost);
  const per = $('priority').checked ? basePer * 1.25 : basePer;
  const events = Math.max(num('events'), 1);
  return {
    ...b, per, cost, saltMat, siteHrs, cuts: events, marginUsd: Math.max(basePer - cost, 0),
    lines: [
      ['Cleared area', area.toFixed(0) + ' sq ft', num('driveSqft') + ' drive + ' + num('walkFt') + ' ft walk'],
      ['Clear time', (clearHrs * 60).toFixed(0) + ' min', eq.label + ' · ' + DEPTH[S.depth].label],
      saltOn ? ['Ice melt', saltLbs.toFixed(0) + ' lb', fmt2(saltMat) + ' material'] : null,
      ['Detail / load', (num('detailMins') + num('loadMins')) + ' min', ''],
    ].filter(Boolean),
  };
}

function calcLeaf() {
  const ac = num('lacres'), tf = TREE[S.tree].f;
  const workHrs = (ac / LEAF_AC_HR) * tf;
  const siteHrs = workHrs + num('loadMins') / 60;
  const haul = $('haul').checked;
  const loads = haul ? Math.max(1, Math.ceil(ac * tf * 0.75)) : 0;
  const dump = loads * num('dumpFee');
  const b = baseCosts(siteHrs, workHrs * 0.5);
  const cost = b.cost + dump;
  const per = priceIt(cost);
  return {
    ...b, per, cost, siteHrs, dump, cuts: 1, marginUsd: Math.max(per - cost, 0),
    lines: [
      ['Cleanup time', (workHrs * 60).toFixed(0) + ' min', ac + ' ac · ' + TREE[S.tree].label + ' cover'],
      haul ? ['Haul-away', loads + ' load' + (loads > 1 ? 's' : ''), fmt2(dump) + ' dump fees'] : null,
      ['Load / unload', num('loadMins') + ' min', ''],
    ].filter(Boolean),
  };
}

// ---------------- render ----------------
function recalc() {
  const r = S.svc === 'lawn' ? calcLawn() : S.svc === 'snow' ? calcSnow() : calcLeaf();
  const op = S.mode === 'operator', e = r.e;
  r.lo = Math.max(r.per * 0.85, num('minCharge'));
  r.hi = r.per * 1.2;
  const perShown = op ? r.per : (r.lo + r.hi) / 2;
  r.seasonTotal = perShown * r.cuts;
  r.seasonalSnow = perShown * r.cuts * SEASON_DISC;

  const title = op ? 'WORK TICKET' : 'FAIR PRICE CHECK';
  const sub = S.svc === 'lawn' ? 'LAWN MOWING' : S.svc === 'snow' ? 'SNOW REMOVAL' : 'LEAF CLEANUP';
  const unitCap = S.svc === 'snow' ? 'PER EVENT' : S.svc === 'leaf' ? 'PER JOB' : 'PER CUT';
  let h = '';
  h += `<div class="thead"><span class="t">${title} · ${sub}</span><span class="no">NO. ${String(Math.round((r.per || 1) + e.miles)).padStart(4, '0')}</span></div>`;
  if (S.route && !S.useManual) h += `<div class="taddr">${esc(S.route.to)}</div>`;
  h += `<div class="trule"></div>`;
  r.lines.forEach(([l, v, s]) => h += `<div class="tline"><span class="l">${l}${s ? `<span class="s">${esc(s)}</span>` : ''}</span><span class="r">${v}</span></div>`);
  h += `<div class="tline"><span class="l">Drive (round trip)</span><span class="r">${(e.minutes * 2).toFixed(0)} min · ${(e.miles * 2).toFixed(1)} mi</span></div>`;

  if (op) {
    h += `<div class="tsec">COST BUILD-UP</div>`;
    h += `<div class="tline"><span class="l">On-site labor<span class="s">${r.siteHrs.toFixed(2)} hr × ${num('crew')} × $${num('laborRate')}</span></span><span class="r">${fmt2(r.labor)}</span></div>`;
    h += `<div class="tline"><span class="l">Windshield time<span class="s">${num('drivePct')}% of rate</span></span><span class="r">${fmt2(r.drive)}</span></div>`;
    h += `<div class="tline"><span class="l">Truck fuel</span><span class="r">${fmt2(r.vehFuel)}</span></div>`;
    h += `<div class="tline"><span class="l">Equipment fuel</span><span class="r">${fmt2(r.eqFuel)}</span></div>`;
    if (r.saltMat) h += `<div class="tline"><span class="l">Ice melt material</span><span class="r">${fmt2(r.saltMat)}</span></div>`;
    if (r.dump) h += `<div class="tline"><span class="l">Dump fees</span><span class="r">${fmt2(r.dump)}</span></div>`;
    h += `<div class="tline"><span class="l">Margin ${num('margin')}%</span><span class="r">${fmt2(r.marginUsd)}</span></div>`;
    h += `<div class="total"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="cap">QUOTE ${unitCap}</span><span class="amt">${fmt(r.per)}</span></div>`;
    if (Math.abs(r.per - num('minCharge')) < 0.01) h += `<div class="note">Held at your $${num('minCharge')} minimum.</div>`;
    if (S.svc === 'snow' && $('priority').checked) h += `<div class="note">Includes 25% priority surcharge.</div>`;
    h += `</div>`;
  } else {
    h += `<div class="total"><div class="cap">FAIR RANGE ${unitCap}</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-top:2px"><span class="amt">${fmt(r.lo)}</span><span style="color:#9aa093">to</span><span class="amt">${fmt(r.hi)}</span></div></div>`;
    h += `<div class="fairnote">Quotes under <b>${fmt(r.lo * 0.85)}</b> usually mean corners cut or a crew that won't finish the season. Quotes over <b>${fmt(r.hi * 1.15)}</b> are city pricing on this job.</div>`;
  }

  if (S.svc === 'lawn') h += `<div class="season"><span class="cap">${FREQ[S.freq].label} · ${r.cuts} cut${r.cuts > 1 ? 's' : ''}/season</span><span class="amt">${fmt(r.seasonTotal)} / season</span></div>`;
  if (S.svc === 'snow') h += `<div class="season"><span class="cap">Seasonal contract · ${r.cuts} events, 10% off</span><span class="amt">${fmt(r.seasonalSnow)} / winter</span></div>`;
  h += `<div class="fine">Prepared ${new Date().toLocaleDateString('en-US')} · Estimates only. Routing © OpenStreetMap contributors via OSRM. Verify lot size and driveway area against the county parcel record.</div>`;
  $('ticket').innerHTML = h;
  LAST = { r, op };
  saveState();
}

// ---------------- quote actions ----------------
function buildQuoteText() {
  if (!LAST) return '';
  const { r, op } = LAST;
  const svcName = S.svc === 'lawn' ? 'Lawn mowing' : S.svc === 'snow' ? 'Snow removal' : 'Leaf cleanup';
  const unit = S.svc === 'snow' ? 'per event' : S.svc === 'leaf' ? 'per job' : 'per cut';
  const L = [];
  L.push(`CUTQUOTE — ${svcName} ${op ? 'work ticket' : 'fair price check'}`);
  if (S.route && !S.useManual && S.route.to) L.push(`Job: ${S.route.to}`);
  L.push(`Date: ${new Date().toLocaleDateString('en-US')}`);
  L.push('');
  r.lines.forEach(([l, v, s]) => L.push(`${l}: ${v}${s ? ` (${s})` : ''}`));
  L.push(`Drive (round trip): ${(r.e.minutes * 2).toFixed(0)} min · ${(r.e.miles * 2).toFixed(1)} mi`);
  L.push('');
  if (op) L.push(`Quote ${unit}: ${fmt(r.per)}`);
  else L.push(`Fair range ${unit}: ${fmt(r.lo)} to ${fmt(r.hi)}`);
  if (S.svc === 'lawn') L.push(`Season (${FREQ[S.freq].label}, ${r.cuts} cut${r.cuts > 1 ? 's' : ''}): ${fmt(r.seasonTotal)}`);
  if (S.svc === 'snow') L.push(`Seasonal contract (${r.cuts} events, 10% off): ${fmt(r.seasonalSnow)} / winter`);
  L.push('');
  L.push('Estimates only — generated with CutQuote');
  return L.join('\n');
}
async function copyQuote() {
  const t = buildQuoteText(), btn = $('copyBtn'), orig = 'COPY QUOTE';
  try {
    await navigator.clipboard.writeText(t);
    btn.textContent = 'COPIED ✓';
  } catch (e) {
    window.prompt('Copy the quote below:', t);
    btn.textContent = orig;
    return;
  }
  setTimeout(() => { btn.textContent = orig; }, 1400);
}

// ---------------- measure from the sky ----------------
// Mini slippy map: Esri World Imagery tiles (z up to 20 most of the US),
// USGS as fallback. Tap corners to outline an area; shoelace formula on
// Web-Mercator meters gives the acreage. No map library needed.
const MEAS = { z: 19, center: null, pts: [] };
const TILE_SRC = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const TILE_FALLBACK = (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`;
const AC_PER_M2 = 1 / 4046.8564224, SQFT_PER_M2 = 10.763910417;

function ll2w(lat, lon, z) {
  const n = 2 ** z * 256;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n };
}
function w2ll(x, y, z) {
  const n = 2 ** z * 256;
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, lon: (x / n) * 360 - 180 };
}
function polyAreaM2(pts) {
  if (!pts || pts.length < 3) return 0;
  const z = 19, mpp = (156543.03392 * Math.cos((pts[0].lat * Math.PI) / 180)) / 2 ** z;
  const P = pts.map((p) => ll2w(p.lat, p.lon, z));
  let a = 0;
  for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; a += P[i].x * P[j].y - P[j].x * P[i].y; }
  return Math.abs(a / 2) * mpp * mpp;
}

function measRender() {
  const map = $('measMap');
  if (!MEAS.center) return;
  $('measEmpty').classList.add('hidden');
  const W = map.clientWidth, H = map.clientHeight;
  const c = ll2w(MEAS.center.lat, MEAS.center.lon, MEAS.z);
  const x0 = c.x - W / 2, y0 = c.y - H / 2;
  const maxT = 2 ** MEAS.z;
  const want = new Map();
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + W) / 256); tx++) {
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + H) / 256); ty++) {
      if (ty < 0 || ty >= maxT) continue;
      want.set(`${MEAS.z}/${tx}/${ty}`, { tx, ty });
    }
  }
  map.querySelectorAll('img').forEach((img) => {
    if (want.has(img.dataset.key)) {
      const { tx, ty } = want.get(img.dataset.key);
      img.style.left = tx * 256 - x0 + 'px';
      img.style.top = ty * 256 - y0 + 'px';
      want.delete(img.dataset.key);
    } else img.remove();
  });
  want.forEach(({ tx, ty }, key) => {
    const img = document.createElement('img');
    img.alt = ''; img.dataset.key = key;
    img.style.left = tx * 256 - x0 + 'px';
    img.style.top = ty * 256 - y0 + 'px';
    const wx = ((tx % maxT) + maxT) % maxT;
    img.src = TILE_SRC(MEAS.z, wx, ty);
    img.onerror = () => { if (!img.dataset.fb) { img.dataset.fb = '1'; img.src = TILE_FALLBACK(MEAS.z, wx, ty); } else img.remove(); };
    map.appendChild(img);
  });
  measOverlay();
}
function measOverlay() {
  const map = $('measMap');
  let svg = map.querySelector('svg');
  if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); map.appendChild(svg); }
  const W = map.clientWidth, H = map.clientHeight;
  const c = MEAS.center ? ll2w(MEAS.center.lat, MEAS.center.lon, MEAS.z) : { x: 0, y: 0 };
  const px = MEAS.pts.map((p) => { const w = ll2w(p.lat, p.lon, MEAS.z); return { x: w.x - (c.x - W / 2), y: w.y - (c.y - H / 2) }; });
  let inner = '';
  if (px.length >= 2) inner += `<polygon points="${px.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}" fill="rgba(232,100,28,.22)" stroke="#E8641C" stroke-width="2.5"/>`;
  inner += px.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="#fff" stroke="#E8641C" stroke-width="2.5"/>`).join('');
  svg.innerHTML = inner;
  const m2 = polyAreaM2(MEAS.pts);
  $('measReadout').innerHTML = `<span class="mono">${(m2 * AC_PER_M2).toFixed(2)}</span> ac · <span class="mono">${Math.round(m2 * SQFT_PER_M2).toLocaleString('en-US')}</span> sq ft`;
}

let measPtr = null;
function measWirePointer() {
  const map = $('measMap');
  map.addEventListener('pointerdown', (ev) => {
    if (!MEAS.center) return;
    measPtr = { x: ev.clientX, y: ev.clientY, moved: false };
    try { map.setPointerCapture(ev.pointerId); } catch (e) { /* not critical */ }
  });
  map.addEventListener('pointermove', (ev) => {
    if (!measPtr) return;
    const dx = ev.clientX - measPtr.x, dy = ev.clientY - measPtr.y;
    if (!measPtr.moved && Math.hypot(dx, dy) < 6) return;
    measPtr.moved = true;
    const c = ll2w(MEAS.center.lat, MEAS.center.lon, MEAS.z);
    MEAS.center = w2ll(c.x - dx, c.y - dy, MEAS.z);
    measPtr.x = ev.clientX; measPtr.y = ev.clientY;
    measRender();
  });
  map.addEventListener('pointerup', (ev) => {
    if (!measPtr) return;
    if (!measPtr.moved) {
      const rect = map.getBoundingClientRect();
      const c = ll2w(MEAS.center.lat, MEAS.center.lon, MEAS.z);
      const wx = c.x - map.clientWidth / 2 + (ev.clientX - rect.left);
      const wy = c.y - map.clientHeight / 2 + (ev.clientY - rect.top);
      MEAS.pts.push(w2ll(wx, wy, MEAS.z));
      measOverlay();
    }
    measPtr = null;
  });
  map.addEventListener('pointercancel', () => { measPtr = null; });
}

function measOpen() {
  $('measMask').classList.remove('hidden');
  if (!$('measAddr').value) $('measAddr').value = $('jobAddr').value;
  if (!MEAS.center && $('measAddr').value.trim()) measLocate();
}
function measHide() { $('measMask').classList.add('hidden'); }
async function measLocate() {
  const st = $('measStatus'); st.classList.add('hidden');
  const q = $('measAddr').value.trim();
  if (!q) { st.textContent = 'Enter the job address first.'; st.classList.remove('hidden'); return; }
  const btn = $('measLocate'); btn.disabled = true; btn.textContent = 'FLYING…';
  try {
    const g = await geocode(q);
    MEAS.center = { lat: g.lat, lon: g.lon }; MEAS.z = 19; MEAS.pts = [];
    if (g.approx) { st.textContent = 'Exact house number not in map data — showing the nearest street/town. Drag the map to find the property.'; st.classList.remove('hidden'); }
    measRender();
  } catch (e) {
    st.textContent = e.message; st.classList.remove('hidden');
  } finally { btn.disabled = false; btn.textContent = 'LOCATE'; }
}
function measApply(kind) {
  const m2 = polyAreaM2(MEAS.pts);
  if (!m2) { const st = $('measStatus'); st.textContent = 'Tap at least 3 corners to outline the area first.'; st.classList.remove('hidden'); return; }
  if (kind === 'drive') { $('driveSqft').value = Math.round(m2 * SQFT_PER_M2); setSvc('snow'); }
  else if (kind === 'leaf') { $('lacres').value = (m2 * AC_PER_M2).toFixed(2); $('lacresR').value = $('lacres').value; setSvc('leaf'); }
  else { $('acres').value = (m2 * AC_PER_M2).toFixed(2); $('acresR').value = $('acres').value; setSvc('lawn'); }
  measHide(); recalc();
}

// Optional county parcel record via the user's own Regrid API token
async function regridLookup() {
  const out = $('regridOut'); out.textContent = '';
  const tok = $('regridToken').value.trim();
  const q = $('measAddr').value.trim() || $('jobAddr').value.trim();
  if (!tok) { out.textContent = 'Paste your Regrid API token first — free trial tokens at regrid.com.'; return; }
  if (!q) { out.textContent = 'Enter the job address above first.'; return; }
  const btn = $('regridGo'); btn.disabled = true; btn.textContent = '…';
  try {
    const r = await fetch('https://app.regrid.com/api/v2/parcels/address?query=' + encodeURIComponent(q) + '&limit=1&token=' + encodeURIComponent(tok));
    if (!r.ok) throw new Error('Parcel service replied ' + r.status + ' — check your token.');
    const j = await r.json();
    const f = j && j.parcels && j.parcels.features && j.parcels.features[0];
    const fields = f && f.properties && f.properties.fields;
    const ac = fields && (fields.ll_gisacre || fields.gisacre || (fields.ll_gissqft ? fields.ll_gissqft / 43560 : 0));
    if (!ac) throw new Error('No parcel record found for that address.');
    out.innerHTML = `County record: <b>${(+ac).toFixed(2)} ac</b> — ${esc(fields.address || q)} · <button class="sigclear" id="regridUse" type="button">use as lot size</button>`;
    $('regridUse').onclick = () => {
      $('acres').value = (+ac).toFixed(2); $('acresR').value = $('acres').value;
      $('lacres').value = (+ac).toFixed(2); $('lacresR').value = $('lacres').value;
      measHide(); recalc();
    };
  } catch (e) { out.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'LOOKUP'; }
}

// ---------------- contract & signatures ----------------
const DEFAULT_TERMS = 'Service as described above, at the address listed. Price is per service visit unless noted. Payment is due on completion unless agreed otherwise in writing. Weather may shift service dates; missed visits are made up or not billed. Lot and driveway measurements are estimates verified on the first visit. Either party may cancel future visits with 7 days’ notice.';

function sigPadInit(canvas) {
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return { clear() {}, resize() {}, isEmpty: () => true };
  const state = { drawing: false, last: null, empty: true };
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1E241C';
    state.empty = true;
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
  canvas.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* not critical */ }
    const r = canvas.getBoundingClientRect();
    state.drawing = true; state.last = { x: ev.clientX - r.left, y: ev.clientY - r.top };
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!state.drawing) return;
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    const p = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    ctx.beginPath(); ctx.moveTo(state.last.x, state.last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    state.last = p; state.empty = false;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => canvas.addEventListener(t, () => { state.drawing = false; }));
  return {
    resize,
    clear() { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore(); state.empty = true; },
    isEmpty: () => state.empty,
  };
}

function contractSummaryHTML() {
  if (!LAST) return '';
  const { r } = LAST;
  const svcName = S.svc === 'lawn' ? 'Lawn mowing' : S.svc === 'snow' ? 'Snow removal' : 'Leaf cleanup';
  const unit = S.svc === 'snow' ? 'per event' : S.svc === 'leaf' ? 'per job' : 'per cut';
  let h = `<div class="tline"><span class="l">Service</span><span class="r">${svcName}</span></div>`;
  r.lines.forEach(([l, v, s]) => h += `<div class="tline"><span class="l">${l}${s ? `<span class="s">${esc(s)}</span>` : ''}</span><span class="r">${v}</span></div>`);
  h += `<div class="tline"><span class="l"><b>Price ${unit}</b></span><span class="r"><b>${fmt(r.per)}</b></span></div>`;
  if (S.svc === 'lawn') h += `<div class="tline"><span class="l">Schedule</span><span class="r">${FREQ[S.freq].label} · ${r.cuts} cuts (${fmt(r.seasonTotal)}/season)</span></div>`;
  if (S.svc === 'snow') h += `<div class="tline"><span class="l">Seasonal option</span><span class="r">${r.cuts} events · ${fmt(r.seasonalSnow)}/winter (10% off)</span></div>`;
  h += billingLineHTML(r);
  return h;
}
// Billing terms: pay per visit, or prepay a block of visits / the whole
// season in advance at an operator-set discount.
function billingLineHTML(r) {
  const noun = S.svc === 'snow' ? 'event' : S.svc === 'leaf' ? 'job' : 'cut';
  if (S.svc === 'leaf' || S.billing === 'visit')
    return `<div class="tline"><span class="l">Billing</span><span class="r">Per ${noun}, due on completion</span></div>`;
  const n = S.billing === 'season' ? r.cuts : Math.max(2, Math.round(num('prepayN')));
  const disc = Math.min(50, Math.max(0, num('prepayDisc')));
  const total = r.per * n * (1 - disc / 100);
  const label = S.billing === 'season' ? `Prepaid season — ${n} ${noun}s` : `Prepaid in advance — ${n} ${noun}s`;
  const math = `${n} × ${fmt(r.per)}${disc ? ` − ${disc}%` : ''}`;
  return `<div class="tline"><span class="l">${label}<span class="s">${math}</span></span><span class="r"><b>${fmt(total)} due at signing</b></span></div>`;
}
function sigRefresh() {
  $('contractBody').innerHTML = contractSummaryHTML();
  $('segBilling').parentElement.classList.toggle('hidden', S.svc === 'leaf');
  $('prepayOpts').classList.toggle('hidden', S.billing === 'visit' || S.svc === 'leaf');
  $('prepayNFld').classList.toggle('hidden', S.billing === 'season');
}
function sigSyncNames() {
  const biz = $('bizName').value.trim() || 'Your Business Name';
  $('cBizOut').textContent = biz;
  $('cBizLine').textContent = biz;
  $('cCustLine').textContent = $('custName').value.trim() || 'Customer';
  const cust = $('custName').value.trim(), addr = $('custAddr').value.trim();
  $('cAddrOut').textContent = (cust || addr) ? 'Prepared for ' + (cust || 'customer') + (addr ? ' · ' + addr : '') : '';
}
let padOp, padCust;
function sigOpen() {
  if (S.mode !== 'operator') setMode('operator'); // contracts come from the work ticket
  const now = new Date(), dt = now.toLocaleDateString('en-US');
  $('cDate').textContent = dt; $('cDate2').textContent = dt;
  const ymd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const seq = LAST ? String(Math.round((LAST.r.per || 1) + LAST.r.e.miles)).padStart(4, '0') : '0001';
  $('cNo').textContent = ymd + '-' + seq;
  $('cSigD1').textContent = 'Date: ' + dt;
  $('cSigD2').textContent = 'Date: ' + dt;
  if (!$('custAddr').value) $('custAddr').value = (S.route && S.route.to) || $('jobAddr').value;
  if (!$('contractTerms').textContent.trim()) $('contractTerms').textContent = DEFAULT_TERMS;
  sigSyncNames();
  sigRefresh();
  $('sigMask').classList.remove('hidden');
  document.body.classList.add('sig-open');
  requestAnimationFrame(() => { padOp.resize(); padCust.resize(); });
}
function sigHide() { $('sigMask').classList.add('hidden'); document.body.classList.remove('sig-open'); }

// ---------------- init ----------------
buildSel('mower', MOWERS, 'ztr48');
buildSel('snowEquip', SNOWEQ, 'ts');
loadState();
buildSeg('segTerrain', TERRAIN, 'terrain');
buildSeg('segObstacles', OBSTACLES, 'obstacles');
buildSeg('segFreq', FREQ, 'freq');
buildSeg('segDepth', DEPTH, 'depth');
buildSeg('segTree', TREE, 'tree');
buildPreset();
$('acresR').value = $('acres').value;
$('lacresR').value = $('lacres').value;
$('useManual').checked = S.useManual;

$('acresR').addEventListener('input', (e) => { $('acres').value = e.target.value; recalc(); });
$('acres').addEventListener('input', (e) => { $('acresR').value = e.target.value; recalc(); });
$('lacresR').addEventListener('input', (e) => { $('lacres').value = e.target.value; recalc(); });
$('lacres').addEventListener('input', (e) => { $('lacresR').value = e.target.value; recalc(); });
['mowablePct', 'trimMins', 'detailMins', 'loadMins', 'fuel', 'mpg', 'drivePct', 'crew', 'laborRate', 'margin', 'minCharge', 'manMiles', 'manMins', 'driveSqft', 'walkFt', 'bagPrice', 'events', 'dumpFee'].forEach((id) => $(id).addEventListener('input', recalc));
['mower', 'snowEquip'].forEach((id) => $(id).addEventListener('change', recalc));
['baseAddr', 'jobAddr'].forEach((id) => $(id).addEventListener('input', saveState));

$('mHome').addEventListener('click', () => setMode('homeowner'));
$('mOp').addEventListener('click', () => setMode('operator'));
$('tLawn').addEventListener('click', () => setSvc('lawn'));
$('tSnow').addEventListener('click', () => setSvc('snow'));
$('tLeaf').addEventListener('click', () => setSvc('leaf'));
$('routeBtn').addEventListener('click', calcRoute);
$('useManual').addEventListener('change', (e) => { S.useManual = e.target.checked; syncManual(); recalc(); });
['salting', 'haul'].forEach((id) => $(id).addEventListener('change', () => { syncAux(); recalc(); }));
$('priority').addEventListener('change', recalc);
$('printBtn').addEventListener('click', () => window.print());
$('copyBtn').addEventListener('click', copyQuote);
$('resetBtn').addEventListener('click', resetAll);

// measure tool
['measOpenLawn', 'measOpenSnow', 'measOpenLeaf'].forEach((id) => $(id).addEventListener('click', measOpen));
$('measClose').addEventListener('click', measHide);
$('measLocate').addEventListener('click', measLocate);
$('measAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') measLocate(); });
$('measZin').addEventListener('click', () => { if (MEAS.center && MEAS.z < 20) { MEAS.z++; measRender(); } });
$('measZout').addEventListener('click', () => { if (MEAS.center && MEAS.z > 14) { MEAS.z--; measRender(); } });
$('measUndo').addEventListener('click', () => { MEAS.pts.pop(); measOverlay(); });
$('measClear').addEventListener('click', () => { MEAS.pts = []; measOverlay(); });
$('measUseLawn').addEventListener('click', () => measApply('lawn'));
$('measUseLeaf').addEventListener('click', () => measApply('leaf'));
$('measUseDrive').addEventListener('click', () => measApply('drive'));
$('regridGo').addEventListener('click', regridLookup);
$('regridToken').addEventListener('input', saveState);
measWirePointer();

// contract & signatures
padOp = sigPadInit($('padOp'));
padCust = sigPadInit($('padCust'));
$('signBtn').addEventListener('click', sigOpen);
$('sigClose').addEventListener('click', sigHide);
$('sigPrint').addEventListener('click', () => window.print());
$('clearOp').addEventListener('click', () => padOp.clear());
$('clearCust').addEventListener('click', () => padCust.clear());
['bizName', 'custName', 'custAddr'].forEach((id) => $(id).addEventListener('input', () => { sigSyncNames(); saveState(); }));
$('contractTerms').addEventListener('input', saveState);
buildSeg('segBilling', BILLING, 'billing', () => { saveState(); sigRefresh(); });
['prepayN', 'prepayDisc'].forEach((id) => $(id).addEventListener('input', () => { saveState(); sigRefresh(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { measHide(); sigHide(); } });

setMode(S.mode);
setSvc(S.svc);
syncAux();
syncManual();
recalc();
