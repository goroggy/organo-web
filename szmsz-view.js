// SZMSZ task layer of cofog-organo.html: organisation -> SZMSZ (period) -> unit -> tasks, with plain-text search.
// Loaded on first use of the tab; data: data/szmsz-poc.js (scripts/szmsz_poc_build.py).
window.SzmszView = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const MIN_QUERY = 3, MAX_GROUPS = 250, MAX_THREADS = 200;
  const LABEL = /^\s*(?:\(?\d{1,3}(?:\.\d{1,3})*[a-z]?[.)]|\(?[a-z]{1,3}\)|[-–•])\s+/;
  const STATUS = ['egyetértés', 'egyetértés (definíciókkal)', 'vitatott'];
  // scripts/szmsz_poc_build.py MECHANISMS, in that order
  const MECH = [['kiválás', 'az átvevő első SZMSZ-e, az átadó működik tovább'], ['portfólió-áthelyezés', 'mindkét szervezet működik tovább'],
    ['beolvadás', 'az átadó megszűnik, az átvevő már működött'], ['megszűnés új szervbe', 'az átadó megszűnik, az átvevő új'],
    ['folytatás?', 'az átvevő az átadó új azonosítója lehet']];
  let D, docs, units, tasks, threads, packages, folded, query = '', selected = null, hitSet = null;
  const open = new Set();

  function init() {
    D = window.SZMSZ_POC;
    docs = D.docs.map(([org, title, from, until, njt, issuer], i) =>
      ({ id: 'd' + i, i, org, title, from, until, njt, issuer, units: [], roots: [], taskCount: 0 }));
    units = D.units.map(([doc, number, name, parent], i) => ({ id: 'u' + i, i, doc, number, name, parent, children: [], tasks: [] }));
    tasks = [];
    for (let k = 0; k < D.tasks.length; k += 3) tasks.push({ i: k / 3, unit: D.tasks[k], text: D.str[D.tasks[k + 1]], ctx: D.tasks[k + 2] < 0 ? null : D.str[D.tasks[k + 2]] });
    for (const u of units) {
      docs[u.doc].units.push(u);
      (u.parent >= 0 ? units[u.parent].children : docs[u.doc].roots).push(u);
    }
    for (const t of tasks) { units[t.unit].tasks.push(t); docs[units[t.unit].doc].taskCount++; }
    // a unit's count includes the tasks of the units below it
    const total = u => (u.total ??= u.tasks.length + u.children.reduce((s, c) => s + total(c), 0));
    units.forEach(total);
    // every task keeps its unit's function code; a thread is never voted onto one code
    units.forEach((u, i) => {
      u.code = D.ucode && D.ucode[i] >= 0 ? D.codes[D.ucode[i]] : null;
      u.status = D.ustat && D.ustat[i] >= 0 ? STATUS[D.ustat[i]] : null;
    });
    // task threads (scripts/szmsz_threads.py): one task followed across SZMSZ versions and organisations
    let nThreads = 0;
    for (const x of D.thr || []) if (x >= nThreads) nThreads = x + 1;
    threads = Array.from({ length: nThreads }, (_, i) => ({ id: 'f' + i, i, occ: [], transfers: [] }));
    if (D.thr) tasks.forEach((t, k) => { t.thread = threads[D.thr[k]]; t.link = D.link ? D.link[k] : 0; t.thread.occ.push(t); });
    packages = (D.packages || []).map(([from, to, fromDoc, toDoc, lost, gained, tier, mech, n, statute], i) =>
      ({ id: 'p' + i, i, from, to, fromDoc: docs[fromDoc], toDoc: docs[toDoc], lost, gained, weak: tier === 1, corroborated: tier === 2, mech: MECH[mech], n, statute, transfers: [] }));
    for (const [th, pk, a, b] of D.transfers || []) {
      const x = { thread: threads[th], pkg: packages[pk], a: tasks[a], b: tasks[b] };
      threads[th].transfers.push(x);
      packages[pk].transfers.push(x);
    }
    // weak-tier candidates: listed on their package page only, the two organisations' threads stay apart
    for (const [pk, a, b] of D.candidates || []) packages[pk].transfers.push({ pkg: packages[pk], a: tasks[a], b: tasks[b] });
    // the task-level function (scripts/szmsz_task_codes.py): one reading of the task against the code definitions
    for (const [th, code, label, alt, note, hu] of D.tcode || []) threads[th].tcode = { code, label, alt, note, hu };
    const fromOf = t => docs[units[t.unit].doc].from;
    for (const th of threads) {
      th.occ.sort((a, b) => fromOf(a).localeCompare(fromOf(b)));
      th.docs = [...new Set(th.occ.map(t => units[t.unit].doc))].map(i => docs[i]);
      th.orgs = [...new Set(th.docs.map(d => d.org))];
      th.text = th.occ.length ? th.occ[th.occ.length - 1].text.replace(LABEL, '') : '';
      th.codes = [...new Set(th.occ.map(t => units[t.unit].code).filter(Boolean))];
    }
    folded = null;
  }
  // folding 74k texts takes a moment; done once, on the first search
  function ensureFolded() {
    if (folded) return;
    const strFold = D.str.map(fold);
    folded = tasks.map((t, k) => strFold[D.tasks[3 * k + 1]] + ' ' + (D.tasks[3 * k + 2] < 0 ? '' : strFold[D.tasks[3 * k + 2]]) + ' ' + fold(units[t.unit].name));
  }
  const orgName = o => D.orgs[o] || o;
  const yr = s => (s ? s.slice(0, 4) : '');
  const period = d => `${d.from} – ${d.until || 'máig'}`;
  const docsOf = org => docs.filter(d => d.org === org).sort((a, b) => a.from.localeCompare(b.from));
  function hl(text) {
    if (!query) return esc(text);
    const q = fold(query), f = fold(text), i = f.indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }

  // ---- search -------------------------------------------------------------------------------------------
  function runSearch() {
    hitSet = null;
    if (query.length < MIN_QUERY) return;
    ensureFolded();
    const q = fold(query);
    hitSet = new Set();
    for (let k = 0; k < folded.length; k++) if (folded[k].includes(q)) hitSet.add(k);
  }
  const hitsIn = u => (u.hits ??= u.tasks.filter(t => hitSet.has(t.i)).length + u.children.reduce((s, c) => s + hitsIn(c), 0));
  function clearHitCache() { for (const u of units) delete u.hits; }

  // ---- tree ---------------------------------------------------------------------------------------------
  function renderTree() {
    clearHitCache();
    const orgs = Object.keys(D.orgs).sort((a, b) => orgName(a).localeCompare(orgName(b), 'hu'));
    let html = '<ul>', shown = 0;
    if (packages.length && !hitSet)
      html += `<li><div class="node${selected === 'P' || (selected || '').startsWith('p') ? ' sel' : ''}" data-key="P"><span class="tog"></span>` +
        `<span class="lbl">Feladatátadások szervezetek között</span><span class="cnt" title="csomag">${packages.length}</span></div></li>`;
    for (const org of orgs) {
      const ds = docsOf(org);
      const orgHits = hitSet ? ds.reduce((s, d) => s + d.roots.reduce((x, u) => x + hitsIn(u), 0), 0) : 0;
      if (hitSet && !orgHits) continue;
      shown++;
      const key = 'o:' + org, expanded = open.has(key) || !!hitSet;
      const cnt = hitSet ? orgHits : ds.reduce((s, d) => s + d.taskCount, 0);
      html += `<li><div class="node${selected === key ? ' sel' : ''}" data-key="${esc(key)}"><span class="tog">${expanded ? '▾' : '▸'}</span>` +
        `<span class="lbl">${esc(orgName(org))}</span><span class="cnt" title="${hitSet ? 'találat' : 'feladat'}">${cnt}</span></div>`;
      if (expanded) html += '<ul>' + ds.map(renderDoc).join('') + '</ul>';
      html += '</li>';
    }
    html += '</ul>';
    $('tree').innerHTML = html;
    $('hits').textContent = query.length && query.length < MIN_QUERY ? `Legalább ${MIN_QUERY} karakter` :
      hitSet ? (hitSet.size ? `${hitSet.size} feladat, ${shown} szervezet` : 'Nincs találat') : `${tasks.length} feladat · ${docs.length} SZMSZ`;
  }
  function renderDoc(d) {
    const hits = hitSet ? d.roots.reduce((s, u) => s + hitsIn(u), 0) : 0;
    if (hitSet && !hits) return '';
    const key = d.id, expanded = open.has(key);
    return `<li><div class="node${selected === key ? ' sel' : ''}" data-key="${key}"><span class="tog">${d.roots.length ? (expanded ? '▾' : '▸') : ''}</span>` +
      `<span class="code">${yr(d.from)}–${yr(d.until)}</span><span class="lbl">${esc(d.title)}</span>` +
      `<span class="cnt">${hitSet ? hits : d.taskCount}</span></div>` +
      (expanded ? '<ul>' + d.roots.map(renderUnit).join('') + '</ul>' : '') + '</li>';
  }
  function renderUnit(u) {
    const hits = hitSet ? hitsIn(u) : 0;
    if (hitSet && !hits) return '';
    const key = u.id, expanded = open.has(key);
    return `<li><div class="node${selected === key ? ' sel' : ''}${u.total ? '' : ' empty'}" data-key="${key}"><span class="tog">${u.children.length ? (expanded ? '▾' : '▸') : ''}</span>` +
      `<span class="code">${esc(u.number)}</span><span class="lbl">${hl(u.name)}</span><span class="cnt">${hitSet ? hits : u.total}</span></div>` +
      (expanded && u.children.length ? '<ul>' + u.children.map(renderUnit).join('') + '</ul>' : '') + '</li>';
  }

  // ---- right panel ---------------------------------------------------------------------------------------
  function timeline(rows) {
    // rows: [{org, from, until, label}] -> axis + one bar per org
    const t = s => new Date((s || new Date().toISOString().slice(0, 10)) + 'T00:00:00').getTime();
    const minT = Math.min(...rows.map(r => t(r.from))), maxT = Math.max(Date.now(), ...rows.map(r => t(r.until)));
    const span = maxT - minT || 1, y0 = new Date(minT).getFullYear(), y1 = new Date(maxT).getFullYear(), step = Math.max(1, Math.ceil((y1 - y0) / 8));
    let axis = '';
    for (let y = y0; y <= y1; y += step) axis += `<span style="left:${((new Date(y, 0, 1) - minT) / span * 100).toFixed(2)}%">${y}</span>`;
    const seg = (r, k) => `<div class="seg${k % 2 ? ' alt' : ''}" style="left:${((t(r.from) - minT) / span * 100).toFixed(2)}%;width:${Math.max((t(r.until) - t(r.from)) / span * 100, .5).toFixed(2)}%" title="${esc(r.label)}"></div>`;
    return { axis: `<div class="axis">${axis}</div>`, seg };
  }
  const span = th => `${yr(th.docs[0].from)}–${yr(th.docs[th.docs.length - 1].until)}`;
  // the thread chip after a task: shown when the task lives in more than this one SZMSZ
  function threadChip(th) {
    if (!th || (th.docs.length < 2 && !th.transfers.length)) return '';
    const parts = [span(th), `${th.docs.length} SZMSZ`];
    if (th.orgs.length > 1) parts.push(`${th.orgs.length} szervezet`);
    return ` <a href="#" class="chip${th.transfers.length ? ' disp' : ''}" data-szmsz="${th.id}" title="A feladat ugyanígy (vagy szinte ugyanígy) szerepel más SZMSZ-ekben is">fonal · ${parts.join(' · ')}${th.transfers.length ? ' · átadás' : ''}</a>`;
  }
  function taskLine(t) {
    return `<li>${t.ctx ? `<div class="sub-holder">${hl(t.ctx)}</div>` : ''}${hl(t.text)}${threadChip(t.thread)}</li>`;
  }
  function unitPath(u) { const p = []; for (let x = u; x; x = x.parent >= 0 ? units[x.parent] : null) p.unshift(x); return p; }
  const unitKey = name => fold(name).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  function showSearch() {
    if (!hitSet) {
      $('right').innerHTML = window.organoStartPage ? window.organoStartPage('szmsz')
        : '<p class="empty-msg">Írj be legalább 3 karaktert a feladatok közti kereséshez, vagy válassz szervezetet, SZMSZ-t, egységet a fában.</p>';
      return;
    }
    // one row per task thread: the same task across SZMSZ versions, renamed units and organisations is one line
    // with all its periods (without thread data: one row per organisation + unit name + text, as before)
    const groups = new Map();
    for (const k of hitSet) {
      const t = tasks[k], u = units[t.unit], d = docs[u.doc];
      const key = t.thread ? t.thread.id : `${d.org}|${unitKey(u.name)}|${fold(t.text)}`;
      const g = groups.get(key) ?? groups.set(key, { org: d.org, unit: u, text: t, docs: [], thread: t.thread }).get(key);
      g.docs.push(d);
      if (d.from >= docs[g.unit.doc].from) { g.unit = u; g.text = t; g.org = d.org; }
    }
    const byOrg = new Map();
    for (const k of hitSet) { const d = docs[units[tasks[k].unit].doc]; (byOrg.get(d.org) ?? byOrg.set(d.org, new Map()).get(d.org)).set(d.i, (byOrg.get(d.org).get(d.i) || 0) + 1); }
    const rows = [...byOrg.entries()].flatMap(([org, m]) => [...m.keys()].map(i => ({ org, from: docs[i].from, until: docs[i].until, label: `${docs[i].title} · ${period(docs[i])} · ${m.get(i)} találat` })));
    const { axis, seg } = timeline(rows);
    const orgHtml = [...byOrg.entries()].sort((a, b) => orgName(a[0]).localeCompare(orgName(b[0]), 'hu')).map(([org, m]) => {
      const ds = [...m.keys()].map(i => docs[i]).sort((a, b) => a.from.localeCompare(b.from));
      const years = ds.map(d => `${yr(d.from)}–${yr(d.until)}`).join(', ');
      return `<div class="org"><div class="osum"><div><div class="name">${esc(orgName(org))}</div><div class="years">${esc(years)} · ${[...m.values()].reduce((a, b) => a + b, 0)} találat ${ds.length} SZMSZ-ben</div></div>` +
        `<div class="bar">${ds.map((d, k) => seg({ from: d.from, until: d.until, label: `${d.title} · ${period(d)} · ${m.get(d.i)} találat` }, k)).join('')}</div></div></div>`;
    }).join('');
    const list = [...groups.values()].sort((a, b) => orgName(a.org).localeCompare(orgName(b.org), 'hu') || b.docs.length - a.docs.length);
    const items = list.slice(0, MAX_GROUPS).map(g => {
      const ds = [...new Set(g.docs)].sort((a, b) => a.from.localeCompare(b.from));
      const years = `${yr(ds[0].from)}–${yr(ds[ds.length - 1].until)}`;
      const orgsOf = g.thread && g.thread.orgs.length > 1 ? g.thread.orgs.map(orgName).join(' → ') : orgName(g.org);
      return `<tr><td style="white-space:nowrap">${esc(years)}<div class="sub-holder">${ds.length} SZMSZ</div></td><td><b>${esc(orgsOf)}</b><div class="sub-holder"><a href="#" data-szmsz="${g.unit.id}">${esc(g.unit.number)} ${hl(g.unit.name)}</a></div></td>` +
        `<td>${g.text.ctx ? `<div class="sub-holder">${hl(g.text.ctx)}</div>` : ''}${hl(g.text.text)}${threadChip(g.thread)}</td></tr>`;
    }).join('');
    $('right').innerHTML = `<h1>„${esc(query)}” a feladatok között</h1>` +
      `<div class="crumbs">${hitSet.size} feladat-előfordulás, ${groups.size} különböző feladat${threads.length ? ' (feladatfonal: ugyanaz a feladat az SZMSZ-változatokon és szervezeteken át)' : ' (szervezet + egység + szöveg)'}, ${byOrg.size} szervezet. A szöveg az SZMSZ kiadáskori változata; a módosításai nincsenek benne.</div>` +
      `<h2 class="sec"><span>Szervezetek és időszakok</span></h2>${axis}${orgHtml}` +
      `<h2 class="sec"><span>Feladatok${list.length > MAX_GROUPS ? ` (az első ${MAX_GROUPS} a ${list.length}-ből)` : ''}</span></h2>` +
      `<table class="det"><tr><th>Évek</th><th>Szervezet / egység</th><th>Feladat</th></tr>${items}</table>`;
  }
  function showOrg(org) {
    const ds = docsOf(org);
    const { axis, seg } = timeline(ds.map(d => ({ org, from: d.from, until: d.until })));
    $('right').innerHTML = `<div class="crumbs">Szervezet</div><h1>${esc(orgName(org))}</h1>` +
      `<div class="crumbs">${ds.length} SZMSZ a HLex-ben · ${ds.reduce((s, d) => s + d.taskCount, 0)} feladat-előfordulás · az utolsó SZMSZ hatálya „máig”, amíg a HLex nem ismer újabbat</div>` +
      `${axis}<div class="org"><div class="osum"><div class="name">SZMSZ-ek</div><div class="bar">${ds.map((d, k) => seg({ from: d.from, until: d.until, label: `${d.title} · ${period(d)}` }, k)).join('')}</div></div></div>` +
      `<table class="det"><tr><th>SZMSZ</th><th>Hatály</th><th>Kibocsátó</th><th>Egység</th><th>Feladat</th></tr>` +
      ds.map(d => `<tr><td><a href="#" data-szmsz="${d.id}">${esc(d.title)}</a></td><td style="white-space:nowrap">${esc(period(d))}</td><td>${esc(d.issuer)}</td><td>${d.units.length}</td><td>${d.taskCount}</td></tr>`).join('') + '</table>';
  }
  function showDoc(d) {
    $('right').innerHTML = `<div class="crumbs">${esc(orgName(d.org))}</div><h1>${esc(d.title)}</h1>` +
      `<div class="crumbs">Hatály: ${esc(period(d))} · kibocsátó: ${esc(d.issuer)} · HLex: ${esc(d.njt)}</div>` +
      `<h2 class="sec"><span>Szervezeti egységek (${d.units.length}) és feladataik (${d.taskCount})</span></h2>` +
      `<table class="det"><tr><th>Szám</th><th>Egység</th><th>Feladat (alatta lévőkkel)</th></tr>` +
      d.units.map(u => `<tr><td>${esc(u.number)}</td><td style="padding-left:${14 + 14 * (unitPath(u).length - 1)}px"><a href="#" data-szmsz="${u.id}">${esc(u.name)}</a></td><td>${u.total}</td></tr>`).join('') + '</table>';
  }
  function showUnit(u) {
    const d = docs[u.doc], path = unitPath(u);
    // the same unit in the organisation's other SZMSZ versions, by its name: what the unit did before and after
    // A SZMSZ may name a unit twice (in its structure list and above its tasks): one chip per SZMSZ, the one with
    // the most tasks, or the selected one.
    const same = docs.filter(x => x.org === d.org).map(x => x.units.filter(v => unitKey(v.name) === unitKey(u.name))
      .sort((a, b) => (b === u) - (a === u) || b.total - a.total)[0]).filter(Boolean)
      .sort((a, b) => docs[a.doc].from.localeCompare(docs[b.doc].from));
    const own = u.tasks;
    $('right').innerHTML = `<div class="crumbs">${esc(orgName(d.org))} › <a href="#" data-szmsz="${d.id}">${esc(d.title)}</a> (${esc(period(d))})${path.slice(0, -1).map(p => ` › <a href="#" data-szmsz="${p.id}">${esc(p.name)}</a>`).join('')}</div>` +
      `<h1>${esc(u.number)} ${esc(u.name)}</h1>` +
      (same.length > 1 ? `<div class="bridge-bar"><span class="bridge-lbl">Ugyanez az egység más SZMSZ-ekben:</span>${same.map(v => `<a href="#" class="chip${v === u ? ' disp' : ''}" data-szmsz="${v.id}">${esc(period(docs[v.doc]))} · ${v.total}</a>`).join('')}</div>` : '') +
      `<h2 class="sec"><span>Saját feladatok (${own.length})</span></h2>` +
      (own.length ? `<ol class="tasks">${own.map(taskLine).join('')}</ol>` : '<p class="empty-msg">Az egységnek nincs saját feladat-tétele; az alárendelt egységeké lent.</p>') +
      (u.children.length ? `<h2 class="sec"><span>Alárendelt egységek (${u.children.length})</span></h2><ul>${u.children.map(c => `<li><a href="#" data-szmsz="${c.id}">${esc(c.number)} ${esc(c.name)}</a> · ${c.total}</li>`).join('')}</ul>` : '');
  }
  // ---- a task thread: holders over time, transfers, wording variants --------------------------------------------
  const cofogLabel = code => {
    const C = window.COFOG_POC;
    if (!C || !code) return '';
    cofogLabel.map ??= new Map((C.cofog || []).map(n => [n.code, n.label]));
    return cofogLabel.map.get(code) || '';
  };
  const codeLink = code => (code ? `<a href="#" data-goto="${esc(code)}">${esc(code)} ${esc(cofogLabel(code))}</a>` : 'nincs besorolva');
  const CODE_CHANGES = '<span class="flag" title="A feladat a változatai során más-más kódú egységek alatt áll. Szavazással nem dől el, melyik a helyes: ellenőrizendő.">besorolás változik</span>';
  const TCODE_LABEL = { I: 'a feladat nem változott, csak az őt tartó egység kódja', J: 'a feladat tartalma változott, a korábbi változatokhoz más kód illik',
    M: 'két kód nagyjából egyformán védhető', N: 'a változatok nem ugyanaz a feladat (a fonal hibás)' };
  const TCODE_SOURCE = 'Ezt a kódot nyelvi modell (LLM) adta a feladat szövege alapján, fonalanként egyszer, a 15/2019. (XII. 7.) PM rendelet definíciói szerint ' +
    '(a minisztérium saját működése 011120, egy szakterület munkája a szakterület levele, mint az egységeknél). Az egységkód marad, ez mellette áll. ' +
    'Ellenőrzés: 60 fonalat egy másik, független LLM-futás is besorolt; 53-nál ugyanazt a kódot adta, mind a 60-nál ugyanazt a két jelöltet, az eltérés mindig a két jelölt sorrendje.';
  const taskCodeHtml = tc => !tc ? '' : `<div class="note"><b>A feladat szövege szerint:</b> ${codeLink(tc.code)}` +
    (tc.alt ? ` · ${tc.label === 'J' ? 'a korábbi változatokhoz' : 'második'}: ${codeLink(tc.alt)}` : '') +
    ` — ${esc(TCODE_LABEL[tc.label] || tc.label)}<details class="more"><summary>Miért ez a kód?</summary>` +
    `${tc.hu ? 'Indoklás' : 'Indoklás (az LLM angolul írta, magyar fordítása még nincs)'}: ${esc(tc.note)}<p>${TCODE_SOURCE}</p></details></div>`;
  function showThread(th) {
    const rows = th.docs.map(d => ({ org: d.org, from: d.from, until: d.until, label: `${d.title} · ${period(d)}` }));
    const { axis, seg } = timeline(rows);
    const byOrg = new Map();
    for (const d of th.docs) (byOrg.get(d.org) ?? byOrg.set(d.org, []).get(d.org)).push(d);
    const orgHtml = [...byOrg.entries()].map(([org, ds]) => `<div class="org"><div class="osum"><div><div class="name">${esc(orgName(org))}</div>` +
      `<div class="years">${esc(ds.map(d => `${yr(d.from)}–${yr(d.until)}`).join(', '))} · ${ds.length} SZMSZ</div></div>` +
      `<div class="bar">${ds.map((d, k) => seg({ from: d.from, until: d.until, label: `${d.title} · ${period(d)}` }, k)).join('')}</div></div></div>`).join('');
    // the function by period: every version keeps its unit's code; consecutive versions with one code are one run
    const runs = [];
    for (const t of th.occ) {
      const u = units[t.unit], d = docs[u.doc], last = runs[runs.length - 1];
      if (last && last.code === u.code && last.org === d.org) { last.until = d.until; last.disputed ||= u.status === 'vitatott'; continue; }
      runs.push({ code: u.code, org: d.org, from: d.from, until: d.until, disputed: u.status === 'vitatott' });
    }
    const funcHtml = runs.map(r => `${codeLink(r.code)}${r.disputed ? ' <span class="flag">vitatott</span>' : ''} <span class="sub-holder">(${esc(yr(r.from))}–${esc(yr(r.until))}, ${esc(orgName(r.org))})</span>`).join(' → ');
    const transfers = th.transfers.length ? `<h2 class="sec"><span>Átadás (${th.transfers.length})</span><span class="sub-hint">az átadónál a szöveg kikerül az SZMSZ-ből, az átvevőnél ugyanekkor megjelenik</span></h2>` +
      `<div class="tiles"><a class="tile main" href="szmsz-transfer-overview.html?thread=${th.id.slice(1)}&name=${encodeURIComponent('„' + (th.text.length > 70 ? th.text.slice(0, 70) + '…' : th.text) + '”')}"><b>Ennek a feladatnak az útja az ábrán →</b><span>Az átadások ábrája csak erre a feladatra szűrve; onnan egy kattintással az összkép.</span></a></div>` +
      `<table class="det"><tr><th>Mikor</th><th>Honnan</th><th>Hová</th><th>Csomag</th></tr>${th.transfers.map(x => {
        const p = x.pkg, ua = units[x.a.unit], ub = units[x.b.unit];
        return `<tr><td style="white-space:nowrap">${esc(p.gained)}</td>` +
          `<td><b>${esc(orgName(p.from))}</b><div class="sub-holder"><a href="#" data-szmsz="${ua.id}">${esc(ua.name)}</a> · ${esc(p.fromDoc.title)}</div></td>` +
          `<td><b>${esc(orgName(p.to))}</b><div class="sub-holder"><a href="#" data-szmsz="${ub.id}">${esc(ub.name)}</a> · ${esc(p.toDoc.title)}</div></td>` +
          `<td style="white-space:nowrap"><a href="#" data-szmsz="${p.id}">${p.n} feladat</a>${tierFlag(p)}</td></tr>`;
      }).join('')}</table>` : '';
    // one row per SZMSZ version: the unit it stands in (renames show here), the text only where it changed
    let previous = null;
    const versionRows = th.occ.map(t => {
      const u = units[t.unit], d = docs[u.doc], wording = t.text.replace(LABEL, '');
      const mark = t.link === 3 ? '<span class="flag">átadás</span> ' : t.link === 2 ? '<span class="badge-var" title="A szöveg szűkült, bővült vagy átfogalmazódott: ugyanaz a feladat, módosult körrel">módosult</span> ' : '';
      const cell = wording === previous ? '<span class="sub-holder">változatlan szöveg</span>' : hl(wording);
      previous = wording;
      return `<tr><td style="white-space:nowrap">${esc(yr(d.from))}–${esc(yr(d.until))}</td><td><b>${esc(orgName(d.org))}</b><div class="sub-holder"><a href="#" data-szmsz="${u.id}">${esc(u.number)} ${esc(u.name)}</a>${u.code ? ` · ${esc(u.code)}` : ''}</div></td><td>${mark}${cell}</td></tr>`;
    }).join('');
    $('right').innerHTML = `<div class="crumbs">Feladatfonal · ${esc(span(th))} · ${th.docs.length} SZMSZ · ${th.orgs.length} szervezet</div>` +
      `<h1>${hl(th.text)}</h1>` +
      `<div class="crumbs">Funkció változatonként, az egység besorolása szerint: ${funcHtml}${th.codes.length > 1 ? ' ' + CODE_CHANGES : ''}</div>` +
      taskCodeHtml(th.tcode) +
      `<h2 class="sec"><span>Szervezetek és időszakok</span><span class="sub-hint">ahol az SZMSZ ezt a feladatot tartalmazza</span></h2>${axis}${orgHtml}` + transfers +
      `<h2 class="sec"><span>Változatok (${th.occ.length} SZMSZ)</span><span class="sub-hint">a szöveg csak ott, ahol változott</span></h2>` +
      `<table class="det"><tr><th>Évek</th><th>Szervezet / egység · kód</th><th>Szöveg</th></tr>${versionRows}</table>` +
      `<details class="more"><summary>Hogyan épül a fonal?</summary>A fonal a szöveg azonosságából épül: pontos, majdnem azonos vagy tartalmazó szöveg az egység leszármazási vonalán, más szervezethez csak átadásként. A jogi feladatfolytonosságot nem a szöveg dönti el.</details>`;
  }

  // ---- task transfers between organisations, in packages (one SZMSZ version of A -> one of B) ---------------
  const sum = list => list.reduce((s, p) => s + p.n, 0);
  const tierFlag = p => p.weak ? ' <span class="flag">gyenge jelölt</span>'
    : p.corroborated ? ' <span class="flag" title="Gyenge jelölt, de a rendeleti tárgykör is ugyanezt az átadást mutatja">rendelet megerősíti</span>' : '';
  function showPackages() {
    const strong = packages.filter(p => !p.weak && !p.corroborated), corroborated = packages.filter(p => p.corroborated),
      weak = packages.filter(p => p.weak);
    const list = packages.slice().sort((a, b) => b.gained.localeCompare(a.gained) || b.n - a.n);
    $('right').innerHTML = `<div class="crumbs">SZMSZ-feladatok</div><h1>Feladatátadások</h1>` +
      `<div class="tiles"><a class="tile main" href="szmsz-transfer-overview.html"><b>Az átadások ábrája →</b><span>Ugyanez idővonalon: minisztériumok oszloponként, az átadások szalagként, lejátszható.</span></a></div>` +
      `<div class="crumbs">${strong.length} csomag (${sum(strong)} feladat), ${corroborated.length} rendeletileg megerősített jelölt (${sum(corroborated)} feladat) ` +
      `és ${weak.length} gyenge jelölt (${sum(weak)} feladat, nincs bekötve).</div>` +
      `<details class="more"><summary>Mi számít átadásnak, és mennyire megbízható?</summary>` +
      `Egy feladat akkor átadott, ha a szövege egy szervezet SZMSZ-éből kikerül, és legfeljebb 400 nap eltéréssel egy másik szervezet SZMSZ-ében megjelenik. ` +
      `Kiesik, amit több szervezet egyszerre tart, amit az átadó más szöveggel vagy ugyanazzal az egységgel megtart, és ami belső támogató egység (személyügy, kabinet, parlament, jog) szövege. ` +
      `Ellenőrzés (a 2026-10-30-i adatokon, LLM-értékelőkkel, egyenként átnézett mintán): a csomagok feladatainak 98,7%-a valódi átadás (egy másik, független értékelő 30 mintából 30-at talált valódinak). ` +
      `A gyenge jelöltek (kevesebb mint 3 feladat, vagy egyik egységpár sem visz 3-at) akkor mind a 29 feladatát egy független LLM-értékelő nézte át: 15 valódi átadás, 14 minisztériumok között másolt sablonmondat. ` +
      `Valódi volt mind a 8, amelyet a rendeleti tárgykör is megerősít, a többi 21-ből 7; ezért csak a megerősítettek kötik össze a két szervezet fonalát.</details>` +
      `<table class="det"><tr><th>Mikor</th><th>Honnan → hová</th><th>Mód</th><th>Feladat</th></tr>${list.map(p =>
        `<tr><td style="white-space:nowrap">${esc(p.gained)}</td><td><a href="#" data-szmsz="${p.id}"><b>${esc(orgName(p.from))}</b> → <b>${esc(orgName(p.to))}</b></a>${tierFlag(p)}` +
        `<div class="sub-holder" title="A szervezet a mai nevén áll; az akkori nevét a kibocsátott SZMSZ mutatja">${esc(p.fromDoc.title)} → ${esc(p.toDoc.title)}</div></td>` +
        `<td>${esc(p.mech[0])}</td><td style="white-space:nowrap">${p.n}${p.statute.length ? ' · rendelet is' : ''}</td></tr>`).join('')}</table>`;
  }
  function showPackage(p) {
    const scope = new Map(((window.COFOG_POC && window.COFOG_POC.threads) || []).map(t => [t.id, t]));
    const pairs = new Map();
    for (const x of p.transfers) {
      const key = `${units[x.a.unit].name} → ${units[x.b.unit].name}`;
      (pairs.get(key) ?? pairs.set(key, []).get(key)).push(x);
    }
    $('right').innerHTML = `<div class="crumbs"><a href="#" data-szmsz="P">Feladatátadások</a> · ${esc(p.mech[0])}: ${esc(p.mech[1])}</div>` +
      `<h1>${esc(orgName(p.from))} → ${esc(orgName(p.to))}</h1>` +
      `<div class="crumbs">${p.n} feladat · az átadónál utoljára: <a href="#" data-szmsz="${p.fromDoc.id}">${esc(p.fromDoc.title)}</a> (hatálya ${esc(p.lost)}-ig) · az átvevőnél először: <a href="#" data-szmsz="${p.toDoc.id}">${esc(p.toDoc.title)}</a> (${esc(p.gained)}-tól)</div>` +
      (p.weak ? '<div class="note">Gyenge jelölt, nincs bekötve: kevesebb mint 3 feladat, vagy egyik egységpár sem visz legalább 3-at, ' +
        'és a rendeleti tárgykör sem erősíti meg. A 2026-10-30-i adatok 29 gyenge feladatát egy független LLM-értékelő egyenként átnézte: 15 valódi átadás, 14 minisztériumok ' +
        'között másolt sablonmondat (irányító hatósági, stratégiai, védelmi igazgatási, személyügyi); megerősítés nélkül 21-ből 7 volt valódi. ' +
        'A két szervezet fonala ezért külön marad: ellenőrizendő.</div>'
        : p.corroborated ? '<div class="note">Gyenge jelölt (kevesebb mint 3 feladat, vagy egyik egységpár sem visz legalább 3-at), de a rendeleti tárgykör ' +
          'is ugyanezt az átadást mutatja, ezért bekötve. A 2026-10-30-i adatokon egy független LLM-értékelő a 2 akkori ilyen csomag mind a 8 feladatát valódi átadásnak találta.</div>' : '') +
      (p.statute.length ? `<div class="bridge-bar"><span class="bridge-lbl">A rendeleti tárgykör is ezt mutatja:</span>${p.statute.map(id => `<span class="chip">${esc(scope.get(id) ? scope.get(id).canonical : id)}</span>`).join('')}</div>`
        : '<div class="crumbs">A rendeleti tárgykör-fonalak ezt nem mutatják; ez a rendeleti réteg hiánya is lehet, nem ellenbizonyíték.</div>') +
      `<h2 class="sec"><span>Egységek (${pairs.size})</span><span class="sub-hint">honnan hová került a feladat</span></h2><table class="det"><tr><th>Átadó egység → átvevő egység</th><th>Feladat</th></tr>` +
      [...pairs.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, xs]) => `<tr><td>${esc(key)}</td><td>${xs.length}</td></tr>`).join('') + '</table>' +
      `<h2 class="sec"><span>Feladatok (${p.transfers.length})</span></h2><table class="det"><tr><th>Átvevő egység</th><th>Feladat</th></tr>` +
      p.transfers.map(x => `<tr><td><a href="#" data-szmsz="${units[x.b.unit].id}">${esc(units[x.b.unit].name)}</a></td><td>${hl(x.b.text.replace(LABEL, ''))} ` +
        (x.thread ? `<a href="#" class="chip" data-szmsz="${x.thread.id}">fonal</a>`
          : `<a href="#" class="chip" data-szmsz="${x.a.thread.id}">átadó fonala</a> <a href="#" class="chip" data-szmsz="${x.b.thread.id}">átvevő fonala</a>`) +
        '</td></tr>').join('') + '</table>';
  }

  // threads under a set of function codes (a COFOG leaf, or every leaf below a collector node), each with the years it
  // stood under one of these codes: a thread can sit under several leaves over time
  // the codes a thread's text points to: the best one, and for M (two about equally defensible: an independent second
  // reading swapped them in 7 of 60) and J (the earlier versions') the other one too; N is a wrong thread, no code
  const taskCodes = tc => !tc || tc.label === 'N' ? [] : (tc.label === 'M' || tc.label === 'J') && tc.alt ? [tc.code, tc.alt] : [tc.code];
  function threadSection(codes) {
    const list = [];
    for (const th of threads) {
      const here = th.occ.filter(t => codes.has(units[t.unit].code));
      const byTask = taskCodes(th.tcode).some(c => codes.has(c));
      if (here.length || byTask) list.push({ th, here, byTask });
    }
    if (!list.length) return '<p class="empty-msg">Ide egy SZMSZ-feladat sincs sorolva.</p>';
    list.sort((a, b) => b.th.orgs.length - a.th.orgs.length || b.th.docs.length - a.th.docs.length || a.th.text.localeCompare(b.th.text, 'hu'));
    const moved = list.filter(x => x.th.transfers.length).length, changing = list.filter(x => x.th.codes.length > 1).length;
    const taskOnly = list.filter(x => !x.here.length).length, taskElsewhere = list.filter(x => taskCodes(x.th.tcode).length && !x.byTask).length;
    const rows = list.slice(0, MAX_THREADS).map(({ th, here, byTask }) => {
      const years = here.length ? here : th.occ, first = docs[units[years[0].unit].doc], last = docs[units[years[years.length - 1].unit].doc];
      const tc = th.tcode, viaAlt = byTask && !codes.has(tc.code);
      const taskMark = !tc ? '' : tc.label === 'N' ? ' <span class="flag" title="A feladat szövege szerint a változatok nem ugyanaz a feladat">a fonal hibás</span>'
        : !here.length ? ` <span class="badge-var" title="Az egységei más kódon álltak; a feladat szövege szerint ide tartozik">a feladat szerint ide${viaAlt ? (tc.label === 'J' ? ' (korábbi változatai)' : ' (második lehetőség)') : ''}</span>`
        : !byTask ? ` <span class="badge-var" title="A feladat szövege szerint más kódhoz tartozik">a feladat szerint: ${esc(taskCodes(tc).join(' / '))}</span>` : '';
      return `<tr><td style="white-space:nowrap">${esc(yr(first.from))}–${esc(yr(last.until))}<div class="sub-holder">${here.length ? `${here.length} SZMSZ` : 'a feladat szerint'}</div></td>` +
        `<td>${hl(th.text)}${th.codes.length > 1 ? ' ' + CODE_CHANGES : ''}${taskMark}<div class="sub-holder">${esc(th.orgs.map(orgName).join(' → '))}${th.transfers.length ? ' · átadás' : ''}</div></td>` +
        `<td style="white-space:nowrap"><a href="#" data-szmsz-thread="${th.i}">fonal →</a></td></tr>`;
    }).join('');
    return `<div class="crumbs">${list.length} feladatfonal${moved ? `, ebből ${moved} szervezetek között átadott` : ''}${changing ? `, ${changing}-nél a besorolás változik` : ''}` +
      `${taskOnly ? `; ${taskOnly} csak a feladat szövege szerint tartozik ide` : ''}${taskElsewhere ? `, ${taskElsewhere} a szövege szerint máshová` : ''}` +
      `${list.length > MAX_THREADS ? ` · az első ${MAX_THREADS} látszik (szervezetszám, majd SZMSZ-szám szerint)` : ''}</div>` +
      `<table class="det"><tr><th>Ezen a kódon</th><th>Feladat (legutóbbi szöveg) · szervezetek</th><th></th></tr>${rows}</table>`;
  }

  function show(key) {
    if (!key) return showSearch();
    if (key.startsWith('o:')) return showOrg(key.slice(2));
    if (key === 'P') return showPackages();
    if (key.startsWith('p')) return showPackage(packages[+key.slice(1)]);
    if (key.startsWith('d')) return showDoc(docs[+key.slice(1)]);
    if (key.startsWith('f')) return showThread(threads[+key.slice(1)]);
    return showUnit(units[+key.slice(1)]);
  }
  function select(key) {
    selected = key;
    if (key.startsWith('u')) {
      const u = units[+key.slice(1)];
      open.add('o:' + docs[u.doc].org); open.add(docs[u.doc].id);
      for (let p = u.parent >= 0 ? units[u.parent] : null; p; p = p.parent >= 0 ? units[p.parent] : null) open.add(p.id);
    } else if (key.startsWith('d')) open.add('o:' + docs[+key.slice(1)].org);
    show(key); renderTree();
    $('right').scrollTop = 0;
    // the header's chart link follows the selection: a task thread filters the chart to its transfers
    if (window.organoChartFilter) {
      const th = key.startsWith('f') ? threads[+key.slice(1)] : null;
      window.organoChartFilter(th && th.transfers.length ? { thread: key.slice(1), name: '„' + (th.text.length > 70 ? th.text.slice(0, 70) + '…' : th.text) + '”' } : null);
    }
  }

  return {
    // quiet: loading for another page (the COFOG leaf's thread section), which keeps its own right panel
    load(done, quiet) {
      if (window.SZMSZ_POC) { if (!D) init(); return done(); }
      (this.waiting ??= []).push(done);
      if (!quiet) $('right').innerHTML = '<p class="empty-msg">Az SZMSZ-feladatok betöltése…</p>';
      if (this.waiting.length > 1) return;
      const s = document.createElement('script');
      s.src = 'data/szmsz-poc.js';
      s.onload = () => { init(); const ws = this.waiting; this.waiting = []; ws.forEach(w => w()); };
      s.onerror = () => { this.waiting = []; if (!quiet) $('right').innerHTML = '<p class="empty-msg">A data/szmsz-poc.js nincs meg; építsd: scripts/szmsz_tasks_export.py, majd scripts/szmsz_poc_build.py.</p>'; };
      document.head.appendChild(s);
    },
    openUnit(index, q) { this.load(() => { query = q || ''; runSearch(); select('u' + index); }); },
    openThread(index) { this.load(() => { query = ''; runSearch(); select('f' + index); }); },
    openKey(key) { this.load(() => { query = ''; runSearch(); select(key); }); },
    // HTML of the task threads classified under any of the given function codes (loads the task layer first)
    threadsFor(codes, done) { this.load(() => done(threadSection(codes), threads.length > 0), true); },
    activate(q) { query = q; selected = null; runSearch(); renderTree(); showSearch(); },
    // typed while the data is still loading: kept, and run by activate() once it is in
    query(q) { query = q; if (!D) return; runSearch(); renderTree(); if (!selected || hitSet) { selected = null; showSearch(); } },
    treeClick(e) {
      const el = e.target.closest('.node'); if (!el) return;
      const key = el.dataset.key;
      if (e.target.classList.contains('tog')) { open.has(key) ? open.delete(key) : open.add(key); renderTree(); return; }
      open.add(key); select(key);
    },
    rightClick(e) {
      const a = e.target.closest('a[data-szmsz]'); if (!a) return false;
      e.preventDefault(); select(a.dataset.szmsz); return true;
    },
  };
})();
