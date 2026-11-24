// Forme — nutrition & musculation tracker (local-only PWA)
// Data stays on the device (localStorage). Food data: ANSES Ciqual 2020 + Open Food Facts.

/* ---------------------------------------------------------------- utils */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const dayKey = (d = new Date()) => d.toLocaleDateString('sv-SE');
const addDays = (key, n) => { const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + n); return dayKey(d); };
const fmtDay = (key) => {
  const t = dayKey();
  if (key === t) return "Aujourd'hui";
  if (key === addDays(t, -1)) return 'Hier';
  return new Date(key + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};
const fmtShort = (key) => new Date(key + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const r0 = (x) => Math.round(x || 0);
const r1 = (x) => Math.round((x || 0) * 10) / 10;
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? n : null; };
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------------------------------------------------------- store */
const STORE_KEY = 'forme.v1';
const defaults = () => ({
  profile: { sex: 'h', age: 30, height: 178, weight: 75, activity: 1.55, goal: 'maintien', protPerKg: 2, fatPct: 27, adaptive: false },
  days: {}, customFoods: [], recent: [], favorites: [], workouts: [], exercises: [], weights: [],
});
let db = (() => { try { return { ...defaults(), ...JSON.parse(localStorage.getItem(STORE_KEY)) }; } catch { return defaults(); } })();
const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(db));
navigator.storage?.persist?.();

const getDay = (key) => (db.days[key] ||= { items: [], health: {}, sent: {} });

/* ---------------------------------------------------------------- foods */
let FOODS = { keys: [], rows: [], byCode: new Map(), idx: {} };
const foodsReady = fetch('foods.json').then((r) => r.json()).then((j) => {
  const idx = Object.fromEntries(j.keys.map((k, i) => [k, i + 3]));
  FOODS = { keys: j.keys, rows: j.foods, byCode: new Map(j.foods.map((r) => [r[0], r])), idx, search: j.foods.map((r) => norm(r[1])) };
});

const per100Of = (ref) => {
  if (ref.src === 'c') {
    const row = FOODS.byCode.get(ref.code); if (!row) return {};
    const o = {}; for (const k of FOODS.keys) { const v = row[FOODS.idx[k]]; if (v !== null) o[k] = v; } return o;
  }
  return ref.per100 || {};
};
const nameOf = (ref) => (ref.src === 'c' ? FOODS.byCode.get(ref.code)?.[1] ?? 'Aliment' : ref.name);
const sumItems = (items) => {
  const t = {};
  for (const it of items) {
    const p = per100Of(it.food); const f = it.g / 100;
    for (const [k, v] of Object.entries(p)) t[k] = (t[k] || 0) + v * f;
  }
  t.vitA = (t.vitA || 0) + (t.betacar || 0) / 6; // retinol equivalents
  t.omega3 = (t.epa || 0) + (t.dha || 0);
  return t;
};

/* ---------------------------------------------------------------- targets */
function targets(key) {
  const p = db.profile; const w = latestWeight() ?? p.weight;
  const bmr = 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'h' ? 5 : -161);
  const adj = { seche: -400, maintien: 0, masse: 250 }[p.goal] ?? 0;
  const active = getDay(key).health.active;
  const tdee = p.adaptive && active ? bmr * 1.2 + active : bmr * p.activity;
  const kcal = Math.max(1200, tdee + adj);
  const prot = p.protPerKg * w; const fat = (kcal * p.fatPct / 100) / 9;
  const carb = Math.max(0, (kcal - prot * 4 - fat * 9) / 4);
  return { bmr, tdee, kcal, prot, fat, carb };
}
// ANSES adult references (RNP / AS). [label, key, unit, men, women, kind]
const MICROS = [
  ['Vitamine B12', 'b12', 'µg', 4, 4], ['Fer', 'fe', 'mg', 11, 16], ['Zinc', 'zn', 'mg', 11, 8],
  ['Oméga-3 EPA+DHA', 'omega3', 'g', 0.5, 0.5], ['Vitamine D', 'vitD', 'µg', 15, 15], ['Iode', 'i', 'µg', 150, 150],
  ['Calcium', 'ca', 'mg', 950, 950], ['Fibres', 'fiber', 'g', 30, 30], ['Oméga-3 ALA', 'ala', 'g', 2.5, 2],
  ['Magnésium', 'mg', 'mg', 420, 360], ['Sélénium', 'se', 'µg', 70, 70], ['Potassium', 'k', 'mg', 3500, 3500],
  ['Vitamine C', 'vitC', 'mg', 110, 110], ['Folates (B9)', 'b9', 'µg', 330, 330], ['Vitamine A', 'vitA', 'µg', 750, 650],
  ['Vitamine E', 'vitE', 'mg', 10.5, 9.9], ['Vitamine K', 'vitK', 'µg', 79, 79], ['Vitamine B6', 'b6', 'mg', 1.8, 1.5],
  ['Vitamine B1', 'b1', 'mg', 1.5, 1.2], ['Vitamine B2', 'b2', 'mg', 1.6, 1.5], ['Phosphore', 'p', 'mg', 700, 700],
  ['Cuivre', 'cu', 'mg', 1.9, 1.5], ['Sodium (max)', 'na', 'mg', 2300, 2300, 'max'],
];

/* ---------------------------------------------------------------- weights */
const latestWeight = () => { const w = [...db.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1); return w?.kg ?? null; };
function setWeight(date, kg) {
  const i = db.weights.findIndex((w) => w.date === date);
  if (i >= 0) db.weights[i].kg = kg; else db.weights.push({ date, kg });
  db.weights.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------------------------------------------------------------- state */
const initialTab = new URLSearchParams(location.search).get('tab');
const state = { tab: ['today', 'workout', 'progress', 'settings'].includes(initialTab) ? initialTab : 'today', day: dayKey(), microAll: false, progressEx: null };
const MEALS = [['pdj', 'Petit-déjeuner'], ['dej', 'Déjeuner'], ['col', 'Collation'], ['din', 'Dîner']];
const DEFAULT_EX = ['Développé couché', 'Développé incliné haltères', 'Développé militaire', 'Squat', 'Soulevé de terre',
  'Soulevé de terre roumain', 'Presse à cuisses', 'Fentes', 'Hip thrust', 'Tractions', 'Rowing barre', 'Rowing haltère',
  'Tirage vertical', 'Tirage horizontal', 'Dips', 'Pompes', 'Curl biceps', 'Curl marteau', 'Extension triceps poulie',
  'Barre au front', 'Élévations latérales', 'Oiseau', 'Face pull', 'Leg curl', 'Leg extension', 'Mollets debout', 'Crunch', 'Gainage (s)'];
const allExercises = () => [...new Set([...DEFAULT_EX, ...db.exercises, ...db.workouts.flatMap((w) => w.exercises.map((e) => e.name))])].sort((a, b) => a.localeCompare(b, 'fr'));

/* ---------------------------------------------------------------- render */
const view = $('#view');
function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.tab === state.tab));
  document.querySelectorAll('.tabbar button[aria-current]').forEach((b) => b.setAttribute('aria-current', 'page'));
  view.innerHTML = { today: renderToday, workout: renderWorkout, progress: renderProgress, settings: renderSettings }[state.tab]();
  view.querySelectorAll('[data-chart]').forEach(mountChart);
}

function ring(value, max, color, size = 132, stroke = 12) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r; const f = clamp(max ? value / max : 0, 0, 1);
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="rgba(255,255,255,.10)" stroke-width="${stroke}"/>
    ${f > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${c * f} ${c}" />` : ''}
  </svg>`;
}
const bar = (f, color) => `<div class="bar"><span style="width:${clamp(f, 0, 1) * 100}%;background:${color}"></span></div>`;

function renderToday() {
  const key = state.day; const day = getDay(key); const t = targets(key); const tot = sumItems(day.items);
  const left = t.kcal - (tot.kcal || 0); const h = day.health;
  const over = left < 0;
  const macros = [['Protéines', 'prot', 'var(--prot)'], ['Glucides', 'carb', 'var(--carb)'], ['Lipides', 'fat', 'var(--fat)']];
  const sex = db.profile.sex === 'h' ? 3 : 4;
  const micros = MICROS.map((m) => ({ m, v: tot[m[1]] || 0, target: m[sex] }));
  const shown = state.microAll ? micros : micros.slice(0, 8);

  return `
  <header class="head">
    <div><h1>${esc(fmtDay(key))}</h1><div class="sub">${new Date(key + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
    <div class="daynav">
      <button class="pill icon" data-act="day" data-n="-1" aria-label="Jour précédent"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button class="pill icon" data-act="day" data-n="1" aria-label="Jour suivant" ${key >= dayKey() ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
  </header>

  <section class="card glass">
    <div class="energy">
      <div class="ring">${ring(tot.kcal || 0, t.kcal, over ? 'var(--bad)' : 'var(--accent)')}
        <div class="label"><div class="big num">${r0(Math.abs(left))}</div><div class="small">${over ? 'kcal en trop' : 'kcal restantes'}</div></div>
      </div>
      <dl class="kv num">
        <dt>Consommé</dt><dd>${r0(tot.kcal)} kcal</dd>
        <dt>Objectif</dt><dd>${r0(t.kcal)} kcal</dd>
        <dt>Brûlé (actif)</dt><dd>${h.active != null ? r0(h.active) + ' kcal' : '<span class="faint">—</span>'}</dd>
        <dt>Pas</dt><dd>${h.steps != null ? r0(h.steps).toLocaleString('fr-FR') : '<span class="faint">—</span>'}</dd>
      </dl>
    </div>
    ${macros.map(([label, k, color]) => `
      <div class="macro">
        <div class="top"><span class="name"><span class="dot" style="background:${color}"></span>${label}</span>
        <span class="num">${r0(tot[k])} / ${r0(t[k])} g</span></div>
        ${bar((tot[k] || 0) / t[k], color)}
      </div>`).join('')}
    <div class="row" style="margin-top:16px;gap:8px">
      <button class="pill grow" data-act="health-import">Sync Santé</button>
      <button class="pill grow" data-act="health-export">Envoyer à Santé</button>
    </div>
  </section>

  <section class="card glass">
    <h2>Repas <span class="row" style="gap:8px">
      <button class="pill small" data-act="scan" data-meal="${defaultMeal()}" aria-label="Scanner un code-barres"><svg viewBox="0 0 24 24" width="18" height="18" style="vertical-align:-4px"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 9v6M11 9v6M14 9v6M17 9v6"/></svg> Scanner</button>
      <button class="pill primary small" data-act="add-food" data-meal="${defaultMeal()}">+ Ajouter</button></span></h2>
    ${MEALS.map(([id, label]) => {
      const items = day.items.filter((i) => i.meal === id); const k = sumItems(items).kcal || 0;
      return `<div class="meal-head"><span>${label}</span><span class="row" style="gap:8px"><span class="muted num">${r0(k)} kcal</span>
        <button class="pill small" data-act="add-food" data-meal="${id}" aria-label="Ajouter au ${label}">+</button></span></div>
        ${items.length ? `<ul class="list">${items.map((it) => {
          const n = sumItems([it]);
          return `<li><div class="grow"><div class="t">${esc(nameOf(it.food))}</div>
            <div class="s num">${r0(it.g)} g · ${r0(n.kcal)} kcal · P ${r1(n.prot)} · G ${r1(n.carb)} · L ${r1(n.fat)}</div></div>
            <button class="x" data-act="edit-item" data-id="${it.id}" aria-label="Modifier"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></button></li>`;
        }).join('')}</ul>` : ''}`;
    }).join('')}
  </section>

  <section class="card glass">
    <h2>Micronutriments <span class="meta">% des apports conseillés</span></h2>
    <div class="micro">
      ${shown.map(({ m, v, target }) => {
        const f = v / target; const isMax = m[5] === 'max';
        const color = isMax ? (f > 1 ? 'var(--bad)' : 'rgba(255,255,255,.55)') : (f >= 1 ? 'var(--good)' : 'var(--accent)');
        const flag = !isMax && day.items.length ? (f >= 1 ? '<span class="flag ok">OK</span>' : f < 0.5 ? '<span class="flag low">bas</span>' : '') : '';
        return `<div class="item"><div class="top"><b>${m[0]}${flag}</b><span class="num muted">${r1(v)} / ${target} ${m[2]}</span></div>${bar(f, color)}</div>`;
      }).join('')}
    </div>
    <button class="pill small" style="margin-top:14px" data-act="micro-all">${state.microAll ? 'Réduire' : `Voir les ${MICROS.length}`}</button>
    <p class="faint" style="font-size:12px;margin:12px 2px 0">Les valeurs manquantes dans Ciqual comptent pour 0 : un total « bas » peut être sous-estimé. Les besoins à surveiller en pesco-végétarien sont en haut.</p>
  </section>`;
}
const defaultMeal = () => { const h = new Date().getHours(); return h < 11 ? 'pdj' : h < 15 ? 'dej' : h < 18 ? 'col' : 'din'; };

/* ---------------------------------------------------------------- workouts */
const e1rm = (kg, reps) => (reps > 0 && kg > 0 ? (reps === 1 ? kg : kg * (1 + reps / 30)) : 0);
function bestByExercise(beforeDate) {
  const best = {};
  for (const w of db.workouts) {
    if (beforeDate && w.date >= beforeDate) continue;
    for (const e of w.exercises) for (const s of e.sets) best[e.name] = Math.max(best[e.name] || 0, e1rm(s.kg, s.reps));
  }
  return best;
}
function renderWorkout() {
  const ws = [...db.workouts].sort((a, b) => b.date.localeCompare(a.date));
  const week = ws.filter((w) => w.date > addDays(dayKey(), -7));
  const vol = (w) => w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.kg || 0) * (s.reps || 0), 0), 0);
  return `
  <header class="head"><div><h1>Muscu</h1><div class="sub">${week.length} séance${week.length > 1 ? 's' : ''} ces 7 derniers jours</div></div>
    <button class="pill primary" data-act="new-workout">+ Séance</button></header>
  ${ws.length ? ws.map((w) => {
    const prevBest = bestByExercise(w.date); let prs = 0;
    for (const e of w.exercises) { const b = Math.max(0, ...e.sets.map((s) => e1rm(s.kg, s.reps))); if (b > (prevBest[e.name] || 0) && prevBest[e.name]) prs++; }
    return `<section class="card glass" data-act="open-workout" data-id="${w.id}" role="button" tabindex="0">
      <h2>${esc(w.name || 'Séance')} <span class="meta">${esc(fmtShort(w.date))}</span></h2>
      <div class="muted num" style="font-size:14px">${w.exercises.length} exercice${w.exercises.length > 1 ? 's' : ''} · ${w.exercises.reduce((a, e) => a + e.sets.length, 0)} séries · ${r0(vol(w)).toLocaleString('fr-FR')} kg soulevés${prs ? ` · <span class="pr">${prs} record${prs > 1 ? 's' : ''}</span>` : ''}</div>
      <div class="faint" style="font-size:13px;margin-top:6px">${esc(w.exercises.map((e) => e.name).join(' · '))}</div>
    </section>`;
  }).join('') : `<section class="card glass"><p class="muted" style="margin:0">Aucune séance pour l'instant. Appuie sur « + Séance » pour noter ta première.</p></section>`}`;
}

function workoutSheet(existing) {
  const w = existing ? structuredClone(existing) : { id: uid(), date: dayKey(), name: '', exercises: [] };
  const last = [...db.workouts].sort((a, b) => b.date.localeCompare(a.date));
  const lastSets = (name) => { for (const x of last) { if (x.id === w.id) continue; const e = x.exercises.find((e) => e.name === name); if (e) return e.sets; } return null; };
  const templates = [...new Map(last.filter((x) => x.name).map((x) => [x.name, x])).values()].slice(0, 6);

  const body = () => `
    <h2>${existing ? 'Modifier la séance' : 'Nouvelle séance'}</h2>
    <div class="grid2">
      <label class="field"><span>Nom</span><input class="input" data-f="name" value="${esc(w.name)}" placeholder="Push, Jambes…" list="wnames"></label>
      <label class="field"><span>Date</span><input class="input" type="date" data-f="date" value="${w.date}"></label>
    </div>
    <datalist id="wnames">${templates.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>
    ${!existing && templates.length && !w.exercises.length ? `<div class="muted" style="font-size:13px;margin:0 4px 8px">Reprendre une séance :</div>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">${templates.map((x) => `<button class="pill small" data-w="tpl" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}
    ${w.exercises.map((e, ei) => {
      const prev = lastSets(e.name);
      return `<div class="ex"><div class="row between"><span class="name">${esc(e.name)}</span>
        <button class="x pill small danger" data-w="del-ex" data-i="${ei}">Retirer</button></div>
        ${prev ? `<div class="faint" style="font-size:12px;margin-top:2px">Dernière fois : ${prev.map((s) => `${s.reps}×${s.kg} kg`).join(', ')}</div>` : ''}
        <div class="sets"><span class="n">#</span><span class="faint" style="font-size:12px;text-align:center">Reps</span><span class="faint" style="font-size:12px;text-align:center">Kg</span><span></span>
        ${e.sets.map((s, si) => `<span class="n">${si + 1}</span>
          <input class="input num" inputmode="numeric" data-s="reps" data-e="${ei}" data-i="${si}" value="${s.reps ?? ''}" placeholder="${prev?.[si]?.reps ?? ''}">
          <input class="input num" inputmode="decimal" data-s="kg" data-e="${ei}" data-i="${si}" value="${s.kg ?? ''}" placeholder="${prev?.[si]?.kg ?? ''}">
          <button class="x" data-w="del-set" data-e="${ei}" data-i="${si}" aria-label="Supprimer la série"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`).join('')}
        </div>
        <button class="pill small" style="margin-top:10px" data-w="add-set" data-e="${ei}">+ Série</button></div>`;
    }).join('')}
    <label class="field" style="margin-top:16px"><span>Ajouter un exercice</span>
      <input class="input" data-w-input="ex" list="exlist" placeholder="Choisir ou taper un nom"></label>
    <datalist id="exlist">${allExercises().map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="actions">
      ${existing ? '<button class="pill danger" data-w="delete">Supprimer</button>' : ''}
      <button class="pill" data-w="cancel">Annuler</button>
      <button class="pill primary" data-w="save">Enregistrer</button>
    </div>`;

  const sheet = openSheet(body());
  const rerender = () => { const y = sheet.scrollTop; sheet.innerHTML = '<div class="grab"></div>' + body(); sheet.scrollTop = y; };
  const sync = () => sheet.querySelectorAll('[data-s]').forEach((i) => { w.exercises[i.dataset.e].sets[i.dataset.i][i.dataset.s] = num(i.value); });
  sheet.addEventListener('input', (ev) => {
    const f = ev.target.dataset.f; if (f) w[f] = ev.target.value;
  });
  sheet.addEventListener('change', (ev) => {
    if (ev.target.dataset.wInput === 'ex' && ev.target.value.trim()) {
      sync(); const name = ev.target.value.trim(); const prev = lastSets(name);
      w.exercises.push({ name, sets: prev ? prev.map(() => ({ reps: null, kg: null })) : [{ reps: null, kg: null }, { reps: null, kg: null }, { reps: null, kg: null }] });
      if (!allExercises().includes(name)) db.exercises.push(name);
      rerender();
    }
  });
  sheet.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-w]'); if (!b) return; const a = b.dataset.w;
    sync();
    if (a === 'add-set') { const sets = w.exercises[b.dataset.e].sets; sets.push({ ...(sets.at(-1) || {}) }); }
    if (a === 'del-set') w.exercises[b.dataset.e].sets.splice(b.dataset.i, 1);
    if (a === 'del-ex') w.exercises.splice(b.dataset.i, 1);
    if (a === 'tpl') { const t = db.workouts.find((x) => x.id === b.dataset.id); w.name = t.name; w.exercises = t.exercises.map((e) => ({ name: e.name, sets: e.sets.map(() => ({ reps: null, kg: null })) })); }
    if (a === 'cancel') return closeSheet();
    if (a === 'delete') { if (confirm('Supprimer cette séance ?')) { db.workouts = db.workouts.filter((x) => x.id !== w.id); save(); closeSheet(); render(); } return; }
    if (a === 'save') {
      // fill blanks from placeholders (= last time) when the user left them empty
      w.exercises.forEach((e) => { const prev = lastSets(e.name); e.sets.forEach((s, i) => { s.reps ??= prev?.[i]?.reps ?? null; s.kg ??= prev?.[i]?.kg ?? null; }); e.sets = e.sets.filter((s) => s.reps); });
      w.exercises = w.exercises.filter((e) => e.sets.length);
      if (!w.exercises.length) return toast('Ajoute au moins une série');
      const before = bestByExercise(w.date); const prs = w.exercises.filter((e) => before[e.name] && Math.max(...e.sets.map((s) => e1rm(s.kg, s.reps))) > before[e.name]).map((e) => e.name);
      const i = db.workouts.findIndex((x) => x.id === w.id); if (i >= 0) db.workouts[i] = w; else db.workouts.push(w);
      save(); closeSheet(); render(); toast(prs.length ? `Nouveau record : ${prs.join(', ')} 💪` : 'Séance enregistrée'); return;
    }
    rerender();
  });
}

/* ---------------------------------------------------------------- progress */
function renderProgress() {
  const exNames = [...new Set(db.workouts.flatMap((w) => w.exercises.map((e) => e.name)))].sort((a, b) => a.localeCompare(b, 'fr'));
  if (!exNames.includes(state.progressEx)) state.progressEx = exNames[0] ?? null;
  const exPts = state.progressEx ? [...db.workouts].sort((a, b) => a.date.localeCompare(b.date)).flatMap((w) => {
    const e = w.exercises.find((e) => e.name === state.progressEx); if (!e) return [];
    const best = e.sets.reduce((m, s) => (e1rm(s.kg, s.reps) > m.v ? { v: e1rm(s.kg, s.reps), s } : m), { v: 0 });
    return best.v ? [{ x: w.date, y: r1(best.v), note: `${best.s.reps} × ${best.s.kg} kg` }] : [];
  }) : [];
  const wPts = db.weights.map((w) => ({ x: w.date, y: w.kg }));
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(dayKey(), i - 13));
  const t = targets(dayKey()).kcal;
  const maxK = Math.max(t * 1.25, ...days14.map((d) => sumItems(db.days[d]?.items || []).kcal || 0));

  return `
  <header class="head"><div><h1>Progrès</h1><div class="sub">Poids, force et calories</div></div></header>

  <section class="card glass">
    <h2>Poids <button class="pill small" data-act="add-weight">+ Pesée</button></h2>
    ${wPts.length >= 2 ? `<div class="chart" data-chart='${esc(JSON.stringify({ pts: wPts, unit: 'kg', label: 'Poids' }))}'></div>`
      : `<p class="muted" style="margin:0">Ajoute au moins deux pesées (ou synchronise Santé) pour voir la courbe.</p>`}
    ${wPts.length ? `<ul class="list" style="margin-top:10px">${[...wPts].reverse().slice(0, 5).map((p) => `<li><span class="grow">${esc(fmtShort(p.x))}</span><b class="num">${p.y} kg</b></li>`).join('')}</ul>` : ''}
  </section>

  <section class="card glass">
    <h2>Force <span class="meta">1RM estimé (Epley)</span></h2>
    ${exNames.length ? `<select class="input" data-act-change="progress-ex" aria-label="Exercice">${exNames.map((n) => `<option ${n === state.progressEx ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      ${exPts.length >= 2 ? `<div class="chart" style="margin-top:12px" data-chart='${esc(JSON.stringify({ pts: exPts, unit: 'kg', label: '1RM estimé' }))}'></div>`
        : '<p class="muted">Encore une séance avec cet exercice pour voir la progression.</p>'}
      ${exPts.length ? `<ul class="list" style="margin-top:10px">${[...exPts].reverse().slice(0, 5).map((p) => `<li><span class="grow">${esc(fmtShort(p.x))} <span class="faint">· ${esc(p.note)}</span></span><b class="num">${p.y} kg</b></li>`).join('')}</ul>` : ''}`
      : '<p class="muted" style="margin:0">Note des séances dans l’onglet Muscu pour suivre ta force.</p>'}
  </section>

  <section class="card glass">
    <h2>Calories <span class="meta">14 derniers jours · objectif ${r0(t)}</span></h2>
    <div style="display:grid;grid-template-columns:repeat(14,1fr);gap:4px;align-items:end;height:120px;position:relative" role="img" aria-label="Calories consommées par jour">
      <div style="position:absolute;left:0;right:0;bottom:${(t / maxK) * 100}%;border-top:1px dashed rgba(255,255,255,.35)"></div>
      ${days14.map((d) => { const k = sumItems(db.days[d]?.items || []).kcal || 0;
        return `<div title="${esc(fmtShort(d))} : ${r0(k)} kcal" style="height:${Math.max(2, (k / maxK) * 100)}%;border-radius:4px 4px 0 0;background:${k > t * 1.05 ? 'var(--fat)' : 'var(--accent)'};opacity:${k ? 1 : .25}"></div>`; }).join('')}
    </div>
    <div class="row between faint" style="font-size:11px;margin-top:6px"><span>${esc(fmtShort(days14[0]))}</span><span>Aujourd'hui</span></div>
    <ul class="list" style="margin-top:8px">${days14.slice(-7).reverse().map((d) => { const k = sumItems(db.days[d]?.items || []).kcal || 0; return `<li><span class="grow">${esc(fmtShort(d))}</span><span class="num ${k ? '' : 'faint'}">${k ? r0(k) + ' kcal' : '—'}</span></li>`; }).join('')}</ul>
  </section>`;
}

function mountChart(el) {
  const { pts, unit, label } = JSON.parse(el.dataset.chart);
  const W = 340, H = 170, L = 36, R = 10, T = 12, B = 22;
  const xs = pts.map((p) => new Date(p.x + 'T12:00:00').getTime());
  const ys = pts.map((p) => p.y);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = Math.max(0.5, (y1 - y0) * 0.15); y0 -= pad; y1 += pad;
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  const X = (t) => L + ((t - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const ticks = [0, 0.5, 1].map((f) => y0 + (y1 - y0) * f);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} : ${pts.length} mesures, de ${ys[0]} à ${ys.at(-1)} ${unit}">
    <g class="grid">${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('')}</g>
    <g class="axis">${ticks.map((v) => `<text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${r1(v)}</text>`).join('')}
      <text x="${L}" y="${H - 4}">${esc(fmtShort(pts[0].x))}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">${esc(fmtShort(pts.at(-1).x))}</text></g>
    <path class="series" d="${d}"/>
    ${pts.length <= 40 ? pts.map((p, i) => `<circle class="pt" cx="${X(xs[i])}" cy="${Y(p.y)}" r="4"/>`).join('') : ''}
    <line class="cross" y1="${T}" y2="${H - B}" style="display:none"/>
    <circle class="pt hl" r="6" style="display:none"/>
    <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" stroke="none" class="hit"/>
  </svg><div class="tip" style="display:none"></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cross = el.querySelector('.cross'), hl = el.querySelector('.hl');
  const move = (ev) => {
    const r = svg.getBoundingClientRect(); const sx = ((ev.clientX - r.left) / r.width) * W;
    let bi = 0; xs.forEach((t, i) => { if (Math.abs(X(t) - sx) < Math.abs(X(xs[bi]) - sx)) bi = i; });
    const cx = X(xs[bi]), cy = Y(pts[bi].y);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
    hl.setAttribute('cx', cx); hl.setAttribute('cy', cy); hl.style.display = '';
    tip.innerHTML = `<b class="num">${pts[bi].y} ${unit}</b>${esc(fmtShort(pts[bi].x))}${pts[bi].note ? ' · ' + esc(pts[bi].note) : ''}`;
    tip.style.left = `${(cx / W) * 100}%`; tip.style.top = `${(cy / H) * r.height - 10}px`; tip.style.display = '';
  };
  const leave = () => { tip.style.display = cross.style.display = hl.style.display = 'none'; };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', leave);
}

/* ---------------------------------------------------------------- settings */
function renderSettings() {
  const p = db.profile; const t = targets(dayKey());
  const seg = (field, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-act="seg" data-f="${field}" data-v="${v}" aria-pressed="${String(p[field]) === String(v)}">${l}</button>`).join('')}</div>`;
  return `
  <header class="head"><div><h1>Profil</h1><div class="sub">Objectifs et réglages</div></div></header>
  <section class="card glass">
    <h2>Moi</h2>
    <label class="field"><span>Sexe</span>${seg('sex', [['h', 'Homme'], ['f', 'Femme']])}</label>
    <div class="grid3">
      <label class="field"><span>Âge</span><input class="input num" inputmode="numeric" data-pf="age" value="${p.age}"></label>
      <label class="field"><span>Taille (cm)</span><input class="input num" inputmode="numeric" data-pf="height" value="${p.height}"></label>
      <label class="field"><span>Poids (kg)</span><input class="input num" inputmode="decimal" data-pf="weight" value="${latestWeight() ?? p.weight}"></label>
    </div>
    <label class="field"><span>Activité (hors Santé)</span>
      <select class="input" data-pf="activity">${[[1.2, 'Sédentaire'], [1.375, 'Légère (1-3 séances/sem.)'], [1.55, 'Modérée (3-5 séances/sem.)'], [1.725, 'Élevée (6-7 séances/sem.)'], [1.9, 'Très élevée (physique + sport)']].map(([v, l]) => `<option value="${v}" ${p.activity == v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span>Objectif</span>${seg('goal', [['seche', 'Sèche'], ['maintien', 'Maintien'], ['masse', 'Prise de masse']])}</label>
    <div class="grid2">
      <label class="field"><span>Protéines (g/kg)</span><input class="input num" inputmode="decimal" data-pf="protPerKg" value="${p.protPerKg}"></label>
      <label class="field"><span>Lipides (% kcal)</span><input class="input num" inputmode="numeric" data-pf="fatPct" value="${p.fatPct}"></label>
    </div>
    <label class="row between" style="margin:4px 4px 0"><span>Ajuster l'objectif avec l'énergie active de Santé</span>
      <input type="checkbox" data-pf="adaptive" ${p.adaptive ? 'checked' : ''} style="width:22px;height:22px"></label>
    <dl class="kv num" style="margin-top:16px">
      <dt>Métabolisme de base</dt><dd>${r0(t.bmr)} kcal</dd><dt>Dépense estimée</dt><dd>${r0(t.tdee)} kcal</dd>
      <dt>Objectif calories</dt><dd>${r0(t.kcal)} kcal</dd><dt>Protéines · Glucides · Lipides</dt><dd>${r0(t.prot)} · ${r0(t.carb)} · ${r0(t.fat)} g</dd>
    </dl>
  </section>

  <section class="card glass help">
    <h2>Lier à Santé</h2>
    <p class="muted" style="margin-top:0">Une appli web n'a pas accès à Santé : on passe par l'app <b>Raccourcis</b> (gratuite, déjà sur l'iPhone). À faire une seule fois :</p>
    <h3 style="font-size:16px;margin-top:14px">1. Raccourci « Forme Import » (Santé → Forme)</h3>
    <ol>
      <li>Raccourcis → <b>+</b> → nomme-le <code>Forme Import</code>.</li>
      <li>Ajoute <b>Rechercher des échantillons Santé</b> : type <i>Énergie active</i>, date <i>aujourd'hui</i>, regrouper par <i>jour</i>.</li>
      <li>Ajoute <b>Calculer les statistiques</b> → <i>Somme</i> de ces échantillons.</li>
      <li>Refais les étapes 2-3 pour <i>Nombre de pas</i>. Pour <i>Poids</i>, prends seulement le plus récent (limite 1, trier par date).</li>
      <li>Ajoute <b>Texte</b> : <code>forme active=[Somme énergie] steps=[Somme pas] weight=[Poids]</code> (insère les variables).</li>
      <li>Ajoute <b>Copier dans le presse-papiers</b>. Terminé.</li>
    </ol>
    <p class="muted">Ensuite : « Sync Santé » lance le raccourci ; reviens dans Forme et touche <b>Coller</b>.</p>
    <h3 style="font-size:16px;margin-top:14px">2. Raccourci « Forme Export » (Forme → Santé)</h3>
    <ol>
      <li>Nouveau raccourci <code>Forme Export</code>, qui reçoit du <b>Texte</b> en entrée.</li>
      <li>Ajoute <b>Obtenir le dictionnaire à partir de</b> l'entrée du raccourci.</li>
      <li>Ajoute <b>Enregistrer un échantillon Santé</b> : <i>Énergie alimentaire</i> = valeur <code>kcal</code> du dictionnaire.</li>
      <li>Refais l'étape 3 pour <i>Protéines</i> (<code>prot</code>), <i>Glucides</i> (<code>carb</code>), <i>Lipides</i> (<code>fat</code>) et <i>Fibres</i> (<code>fiber</code>).</li>
    </ol>
    <p class="muted" style="margin-bottom:0">« Envoyer à Santé » n'envoie que ce qui a été ajouté depuis le dernier envoi : pas de doublons.</p>
  </section>

  <section class="card glass">
    <h2>Mes données</h2>
    <p class="muted" style="margin-top:0">Tout reste sur ton iPhone. Fais une sauvegarde de temps en temps (Fichiers / iCloud Drive).</p>
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="pill" data-act="export">Sauvegarder</button>
      <label class="pill" style="display:inline-block">Restaurer<input type="file" accept="application/json" data-act-change="import" class="sr"></label>
      <button class="pill" data-act="custom-foods">Mes aliments (${db.customFoods.length})</button>
    </div>
    <p class="faint" style="font-size:12px;margin:14px 2px 0">Aliments : table Ciqual 2020 de l'ANSES (Licence Ouverte) et Open Food Facts (ODbL).</p>
  </section>`;
}

/* ---------------------------------------------------------------- food sheet */
async function foodSheet(meal, editItem) {
  await foodsReady;
  if (editItem) return amountSheet(editItem.food, editItem.meal, editItem);
  const sheet = openSheet(`
    <h2>Ajouter un aliment</h2>
    <div class="seg" role="group" style="margin-bottom:12px">${MEALS.map(([id, l]) => `<button data-meal="${id}" aria-pressed="${id === meal}">${l.replace('Petit-déjeuner', 'P.-déj.')}</button>`).join('')}</div>
    <input class="input" type="search" placeholder="Rechercher (ex. saumon, skyr, lentilles)" data-q autofocus autocomplete="off">
    <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="pill small primary" data-f="scan">Scanner</button>
      <button class="pill small" data-f="off">Produits de marque</button>
      <button class="pill small" data-f="custom">Créer un aliment</button>
    </div>
    <ul class="list results" data-res></ul>`);
  const res = $('[data-res]', sheet); const q = $('[data-q]', sheet);
  const item = (ref, tag) => `<li data-ref='${esc(JSON.stringify(ref))}'><div class="grow"><div class="t">${esc(nameOf(ref))}</div>
    <div class="s num">${r0(per100Of(ref).kcal)} kcal · P ${r1(per100Of(ref).prot)} g / 100 g</div></div>${tag ? `<span class="tag">${tag}</span>` : ''}</li>`;
  const showDefault = () => {
    const recent = db.recent.slice(0, 12);
    res.innerHTML = (db.customFoods.length ? db.customFoods.slice(-5).reverse().map((f) => item({ src: 'x', id: f.id, name: f.name, per100: f.per100 }, 'Perso')).join('') : '')
      + (recent.length ? recent.map((r) => item(r, 'Récent')).join('') : '<li class="empty">Tape le nom d’un aliment.</li>');
  };
  const search = () => {
    const words = norm(q.value).split(/\s+/).filter(Boolean); if (!words.length) return showDefault();
    const hits = [];
    db.customFoods.forEach((f) => { if (words.every((w) => norm(f.name).includes(w))) hits.push({ s: -1, ref: { src: 'x', id: f.id, name: f.name, per100: f.per100 }, tag: 'Perso' }); });
    FOODS.search.forEach((n, i) => {
      if (!words.every((w) => n.includes(w))) return;
      const score = (n.startsWith(words[0]) ? 0 : 1) + n.length / 200 + (/cru|crue/.test(n) && !words.includes('cru') ? 0.2 : 0);
      hits.push({ s: score, ref: { src: 'c', code: FOODS.rows[i][0] } });
    });
    hits.sort((a, b) => a.s - b.s);
    res.innerHTML = hits.length ? hits.slice(0, 60).map((h) => item(h.ref, h.tag)).join('') : '<li class="empty">Rien dans Ciqual. Essaie « Produits de marque ».</li>';
  };
  showDefault();
  q.addEventListener('input', search);
  sheet.addEventListener('click', async (ev) => {
    const m = ev.target.closest('[data-meal]'); if (m) { meal = m.dataset.meal; sheet.querySelectorAll('[data-meal]').forEach((b) => b.setAttribute('aria-pressed', b === m)); return; }
    const li = ev.target.closest('li[data-ref]'); if (li) return amountSheet(JSON.parse(li.dataset.ref), meal);
    const f = ev.target.closest('[data-f]')?.dataset.f;
    if (f === 'custom') return customFoodSheet(meal, q.value);
    if (f === 'off') {
      if (!q.value.trim()) return toast('Tape d’abord un nom de produit');
      res.innerHTML = '<li class="empty">Recherche dans Open Food Facts…</li>';
      try {
        const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q.value)}&search_simple=1&json=1&page_size=25&fields=code,product_name,brands,nutriments`);
        const j = await r.json();
        const refs = (j.products || []).map(offToRef).filter(Boolean);
        res.innerHTML = refs.length ? refs.map((r) => item(r, 'OFF')).join('') : '<li class="empty">Aucun produit trouvé.</li>';
      } catch { res.innerHTML = '<li class="empty">Pas de connexion internet.</li>'; }
    }
    if (f === 'scan') scannerSheet(meal);
  });
}

// Open Food Facts product -> food ref (values per 100 g, converted to the app's units)
const OFF_FIELDS = 'code,product_name,product_name_fr,brands,quantity,serving_quantity,nutriments';
function offToRef(p) {
  const n = p?.nutriments; if (!n) return null;
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n['energy_100g'] != null) kcal = n['energy_100g'] / 4.184; // kJ -> kcal
  if (kcal == null) return null;
  const g = (k, mult = 1) => (n[k + '_100g'] != null && n[k + '_100g'] !== '' ? Number(n[k + '_100g']) * mult : undefined);
  const MG = 1e3, UG = 1e6; // OFF stores minerals and vitamins in grams
  const per100 = {
    kcal: Number(kcal), prot: g('proteins'), carb: g('carbohydrates'), sugar: g('sugars'), fiber: g('fiber'),
    fat: g('fat'), sat: g('saturated-fat'), mono: g('monounsaturated-fat'), poly: g('polyunsaturated-fat'),
    ala: g('alpha-linolenic-acid'), epa: g('eicosapentaenoic-acid'), dha: g('docosahexaenoic-acid'),
    na: g('sodium', MG), k: g('potassium', MG), ca: g('calcium', MG), mg: g('magnesium', MG), p: g('phosphorus', MG),
    fe: g('iron', MG), zn: g('zinc', MG), cu: g('copper', MG), se: g('selenium', UG), i: g('iodine', UG),
    vitA: g('vitamin-a', UG), vitD: g('vitamin-d', UG), vitE: g('vitamin-e', MG), vitK: g('vitamin-k', UG), vitC: g('vitamin-c', MG),
    b1: g('vitamin-b1', MG), b2: g('vitamin-b2', MG), b3: g('vitamin-pp', MG), b5: g('pantothenic-acid', MG),
    b6: g('vitamin-b6', MG), b9: g('vitamin-b9', UG) ?? g('folates', UG), b12: g('vitamin-b12', UG),
  };
  Object.keys(per100).forEach((k) => (per100[k] === undefined || !Number.isFinite(per100[k])) && delete per100[k]);
  const name = [p.product_name_fr || p.product_name, p.brands?.split(',')[0]?.trim()].filter(Boolean).join(' · ') || 'Produit';
  const serving = Number(p.serving_quantity) > 0 ? Math.round(Number(p.serving_quantity)) : undefined;
  return { src: 'x', id: 'off' + p.code, name, per100, serving, barcode: p.code };
}
async function lookupBarcode(code) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('network');
  const j = await r.json();
  return j.status === 1 || j.product ? offToRef(j.product) : null;
}

/* ---------------------------------------------------------------- barcode scanner */
let camStream = null, scanTimer = null;
let zxingReady = null;
const loadZXing = () => (zxingReady ||= new Promise((resolve, reject) => {
  const s = document.createElement('script'); s.src = 'vendor/zxing-reader.js';
  s.onload = () => {
    ZXingWASM.prepareZXingModule({
      overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? new URL('vendor/' + path, location.href).href : prefix + path) },
      fireImmediately: true,
    });
    resolve(ZXingWASM);
  };
  s.onerror = () => { zxingReady = null; reject(new Error('load')); };
  document.head.append(s);
}));
function stopCamera() {
  clearTimeout(scanTimer); scanTimer = null;
  camStream?.getTracks().forEach((t) => t.stop()); camStream = null;
}
// Product codes are EAN/UPC; a QR code is accepted when it contains such a number (GS1 Digital Link or plain digits)
const codeFromText = (t) => { const m = String(t).match(/(?:\/01\/|^)0*(\d{8,14})(?:\D|$)/) || String(t).match(/\b(\d{8,14})\b/); return m ? m[1] : null; };

async function scannerSheet(meal) {
  const sheet = openSheet(`
    <h2>Scanner un produit</h2>
    <div class="scanner"><video playsinline muted autoplay></video><div class="frame" aria-hidden="true"></div>
      <div class="scan-msg" data-msg>Ouverture de la caméra…</div></div>
    <p class="muted" style="font-size:14px;margin:12px 4px">Vise le code-barres du paquet : l'aliment s'ajoute tout seul avec ses valeurs nutritionnelles.</p>
    <div class="row" style="gap:8px">
      <input class="input num grow" inputmode="numeric" placeholder="Ou tape le numéro" data-manual>
      <button class="pill" data-a="manual">OK</button>
    </div>
    <div class="actions"><button class="pill" data-a="cancel">Annuler</button></div>`);
  const video = $('video', sheet), msg = $('[data-msg]', sheet);
  let busy = false;

  const found = async (code) => {
    if (busy) return; busy = true; stopCamera();
    msg.textContent = `Code ${code} : recherche du produit…`;
    try {
      const ref = await lookupBarcode(code);
      if (ref) {
        if (!db.customFoods.some((f) => f.id === ref.id)) { db.customFoods.push({ id: ref.id, name: ref.name, per100: ref.per100, serving: ref.serving, barcode: code }); save(); }
        amountSheet(ref, meal);
      } else {
        toast('Produit absent d’Open Food Facts : crée-le à partir de l’étiquette');
        customFoodSheet(meal, `Produit ${code}`);
      }
    } catch { msg.textContent = 'Pas de connexion internet. Réessaie plus tard.'; busy = false; }
  };

  sheet.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') closeSheet();
    if (a === 'manual') { const c = codeFromText($('[data-manual]', sheet).value.replace(/\s/g, '')); c ? found(c) : toast('Numéro invalide (8 à 14 chiffres)'); }
  });

  // Already scanned once? use the saved product without network
  const offline = (code) => db.customFoods.find((f) => f.barcode === code);

  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch {
    msg.textContent = 'Caméra refusée. Autorise-la dans Réglages → Safari → Caméra, ou tape le numéro.'; return;
  }
  if (!document.body.contains(sheet)) return stopCamera();
  video.srcObject = camStream; await video.play().catch(() => {});
  msg.textContent = 'Vise le code-barres';

  const native = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'] }) : null;
  let zx = null;
  if (!native) { try { zx = await loadZXing(); } catch { msg.textContent = 'Lecteur indisponible : tape le numéro.'; return; } }
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const tick = async () => {
    if (!camStream || busy) return;
    try {
      if (video.videoWidth) {
        let text = null;
        if (native) {
          text = (await native.detect(video))[0]?.rawValue;
        } else {
          // centre band of the frame, where the guide is drawn
          const vw = video.videoWidth, vh = video.videoHeight, cw = Math.round(vw * 0.9), ch = Math.round(vh * 0.6);
          canvas.width = cw; canvas.height = ch;
          ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch);
          const res = await zx.readBarcodes(ctx.getImageData(0, 0, cw, ch), { formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
          text = res.find((r) => r.isValid)?.text;
        }
        const code = text && codeFromText(text);
        if (code) {
          const saved = offline(code);
          if (saved) { busy = true; stopCamera(); return amountSheet({ src: 'x', id: saved.id, name: saved.name, per100: saved.per100, serving: saved.serving }, meal); }
          return found(code);
        }
        if (text) msg.textContent = 'QR code sans code produit : vise le code-barres';
      }
    } catch { /* frame not ready */ }
    scanTimer = setTimeout(tick, 120);
  };
  tick();
}

function amountSheet(ref, meal, editItem) {
  const p = per100Of(ref);
  const sheet = openSheet(`
    <h2>${esc(nameOf(ref))}</h2>
    <label class="field"><span>Quantité (g ou ml)</span><input class="input num" inputmode="decimal" data-g value="${editItem ? editItem.g : ref.serving || 100}" autofocus></label>
    <div class="row" style="gap:8px;flex-wrap:wrap">${ref.serving ? `<button class="pill small primary" data-quick="${ref.serving}">1 portion (${ref.serving} g)</button>` : ''}${[30, 50, 100, 150, 200, 250].map((g) => `<button class="pill small" data-quick="${g}">${g} g</button>`).join('')}</div>
    <dl class="kv num" style="margin-top:16px" data-preview></dl>
    <div class="actions">
      ${editItem ? '<button class="pill danger" data-a="del">Supprimer</button>' : '<button class="pill" data-a="cancel">Annuler</button>'}
      <button class="pill primary" data-a="ok">${editItem ? 'Enregistrer' : 'Ajouter'}</button>
    </div>`);
  const gIn = $('[data-g]', sheet);
  const preview = () => { const f = (num(gIn.value) || 0) / 100;
    $('[data-preview]', sheet).innerHTML = `<dt>Calories</dt><dd>${r0((p.kcal || 0) * f)} kcal</dd><dt>Protéines</dt><dd>${r1((p.prot || 0) * f)} g</dd>
      <dt>Glucides</dt><dd>${r1((p.carb || 0) * f)} g</dd><dt>Lipides</dt><dd>${r1((p.fat || 0) * f)} g</dd><dt>Fibres</dt><dd>${r1((p.fiber || 0) * f)} g</dd>`; };
  preview(); gIn.addEventListener('input', preview);
  sheet.addEventListener('click', (ev) => {
    const q = ev.target.closest('[data-quick]'); if (q) { gIn.value = q.dataset.quick; preview(); return; }
    const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return;
    const day = getDay(state.day);
    if (a === 'cancel') return closeSheet();
    if (a === 'del') { day.items = day.items.filter((i) => i.id !== editItem.id); save(); closeSheet(); render(); return; }
    const g = num(gIn.value); if (!g || g <= 0) return toast('Quantité invalide');
    if (editItem) Object.assign(day.items.find((i) => i.id === editItem.id), { g });
    else {
      day.items.push({ id: uid(), meal, g, food: ref });
      const key = JSON.stringify(ref.src === 'c' ? { src: 'c', code: ref.code } : { id: ref.id });
      db.recent = [ref, ...db.recent.filter((r) => JSON.stringify(r.src === 'c' ? { src: 'c', code: r.code } : { id: r.id }) !== key)].slice(0, 30);
      if (ref.src === 'x' && ref.id?.startsWith('off') && !db.customFoods.some((f) => f.id === ref.id)) db.customFoods.push({ id: ref.id, name: ref.name, per100: ref.per100 });
    }
    save(); closeSheet(); render(); toast(editItem ? 'Modifié' : `Ajouté : ${r0((p.kcal || 0) * g / 100)} kcal`);
  });
}

function customFoodSheet(meal, name = '') {
  const fields = [['kcal', 'Calories (kcal)'], ['prot', 'Protéines (g)'], ['carb', 'Glucides (g)'], ['sugar', 'dont sucres (g)'], ['fat', 'Lipides (g)'], ['sat', 'dont saturés (g)'], ['fiber', 'Fibres (g)'], ['na', 'Sodium (mg)']];
  const sheet = openSheet(`
    <h2>Créer un aliment</h2>
    <label class="field"><span>Nom</span><input class="input" data-n value="${esc(name)}" placeholder="Ex. Skyr nature marque X"></label>
    <p class="muted" style="margin:0 4px 10px;font-size:14px">Valeurs pour 100 g (sur l'étiquette).</p>
    <div class="grid2">${fields.map(([k, l]) => `<label class="field"><span>${l}</span><input class="input num" inputmode="decimal" data-k="${k}"></label>`).join('')}</div>
    <div class="actions"><button class="pill" data-a="cancel">Annuler</button><button class="pill primary" data-a="ok">Créer</button></div>`);
  sheet.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'cancel') return closeSheet();
    const n = $('[data-n]', sheet).value.trim(); if (!n) return toast('Donne un nom');
    const per100 = {}; sheet.querySelectorAll('[data-k]').forEach((i) => { const v = num(i.value); if (v !== null) per100[i.dataset.k] = v; });
    if (per100.kcal == null) return toast('Indique au moins les calories');
    const f = { id: 'cus' + uid(), name: n, per100 }; db.customFoods.push(f); save();
    amountSheet({ src: 'x', id: f.id, name: f.name, per100 }, meal);
  });
}

/* ---------------------------------------------------------------- health (Raccourcis) */
function healthImportSheet() {
  const sheet = openSheet(`
    <h2>Sync Santé</h2>
    <p class="muted" style="margin-top:0">1. Lance le raccourci <b>Forme Import</b>. 2. Reviens ici et touche <b>Coller</b>.</p>
    <div class="row" style="gap:8px"><button class="pill grow" data-a="run">Lancer le raccourci</button><button class="pill primary grow" data-a="paste">Coller</button></div>
    <label class="field" style="margin-top:14px"><span>Ou colle le texte ici</span><textarea class="input" rows="2" data-t placeholder="forme active=520 steps=8400 weight=77,4"></textarea></label>
    <div class="actions"><button class="pill" data-a="cancel">Fermer</button><button class="pill primary" data-a="ok">Importer</button></div>`);
  const apply = (txt) => {
    const get = (k) => num((txt.match(new RegExp(k + '\\s*[=:]\\s*([\\d\\s.,]+)', 'i')) || [])[1]);
    const active = get('active'), steps = get('steps'), weight = get('weight'), basal = get('basal');
    if (active == null && steps == null && weight == null) return toast('Texte non reconnu');
    const h = getDay(state.day).health;
    if (active != null) h.active = active; if (steps != null) h.steps = steps; if (basal != null) h.basal = basal;
    if (weight != null && weight > 20 && weight < 400) setWeight(state.day, r1(weight));
    save(); closeSheet(); render(); toast('Données Santé importées');
  };
  sheet.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'cancel') return closeSheet();
    if (a === 'run') location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent('Forme Import');
    if (a === 'paste') { try { apply(await navigator.clipboard.readText()); } catch { toast('Colle le texte dans le champ'); } }
    if (a === 'ok') apply($('[data-t]', sheet).value);
  });
}
function healthExport() {
  const day = getDay(state.day); const tot = sumItems(day.items); const sent = day.sent || {};
  const delta = Object.fromEntries(['kcal', 'prot', 'carb', 'fat', 'fiber'].map((k) => [k, r1((tot[k] || 0) - (sent[k] || 0))]));
  if (delta.kcal <= 0 && delta.prot <= 0) return toast('Rien de nouveau à envoyer');
  const payload = JSON.stringify({ date: state.day, ...delta });
  day.sent = Object.fromEntries(['kcal', 'prot', 'carb', 'fat', 'fiber'].map((k) => [k, tot[k] || 0])); save();
  location.href = `shortcuts://run-shortcut?name=${encodeURIComponent('Forme Export')}&input=text&text=${encodeURIComponent(payload)}`;
}

/* ---------------------------------------------------------------- sheets */
function openSheet(html) {
  closeSheet();
  const wrap = document.createElement('div'); wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet glass" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
  $('#sheet-root').append(wrap); document.body.style.overflow = 'hidden';
  setTimeout(() => wrap.querySelector('[autofocus]')?.focus(), 250);
  return wrap.firstElementChild;
}
function closeSheet() { stopCamera(); $('#sheet-root').innerHTML = ''; document.body.style.overflow = ''; }

/* ---------------------------------------------------------------- events */
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (!b) return; state.tab = b.dataset.tab; render(); scrollTo(0, 0);
});
view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return; const a = el.dataset.act;
  if (a === 'day') { state.day = addDays(state.day, +el.dataset.n); if (state.day > dayKey()) state.day = dayKey(); render(); }
  if (a === 'add-food') foodSheet(el.dataset.meal);
  if (a === 'scan') foodsReady.then(() => scannerSheet(el.dataset.meal));
  if (a === 'edit-item') { const it = getDay(state.day).items.find((i) => i.id === el.dataset.id); foodSheet(it.meal, it); }
  if (a === 'micro-all') { state.microAll = !state.microAll; render(); }
  if (a === 'new-workout') workoutSheet();
  if (a === 'open-workout') workoutSheet(db.workouts.find((w) => w.id === el.dataset.id));
  if (a === 'add-weight') {
    const v = num(prompt('Poids du jour (kg) :', latestWeight() ?? db.profile.weight));
    if (v && v > 20 && v < 400) { setWeight(dayKey(), r1(v)); save(); render(); }
  }
  if (a === 'seg') { db.profile[el.dataset.f] = el.dataset.v; save(); render(); }
  if (a === 'health-import') healthImportSheet();
  if (a === 'health-export') healthExport();
  if (a === 'export') {
    const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
    const aEl = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `forme-sauvegarde-${dayKey()}.json` });
    aEl.click(); setTimeout(() => URL.revokeObjectURL(aEl.href), 5000);
  }
  if (a === 'custom-foods') {
    const s = openSheet(`<h2>Mes aliments</h2><ul class="list">${db.customFoods.map((f) => `<li><div class="grow"><div class="t">${esc(f.name)}</div><div class="s num">${r0(f.per100.kcal)} kcal / 100 g</div></div><button class="pill small danger" data-del="${f.id}">Supprimer</button></li>`).join('') || '<li class="empty">Aucun aliment perso.</li>'}</ul>`);
    s.addEventListener('click', (ev) => { const d = ev.target.closest('[data-del]'); if (d) { db.customFoods = db.customFoods.filter((f) => f.id !== d.dataset.del); save(); d.closest('li').remove(); } });
  }
});
view.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[role=button]')) e.target.click(); });
view.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.pf) {
    const f = el.dataset.pf;
    if (f === 'adaptive') db.profile.adaptive = el.checked;
    else if (f === 'weight') { const v = num(el.value); if (v) { db.profile.weight = v; setWeight(dayKey(), r1(v)); } }
    else { const v = num(el.value); if (v !== null) db.profile[f] = v; }
    save(); render();
  }
  if (el.dataset.actChange === 'progress-ex') { state.progressEx = el.value; render(); }
  if (el.dataset.actChange === 'import') {
    try {
      const data = JSON.parse(await el.files[0].text());
      if (!data.profile || !data.days) throw new Error();
      if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
      db = { ...defaults(), ...data }; save(); render(); toast('Sauvegarde restaurée');
    } catch { toast('Fichier de sauvegarde invalide'); }
  }
});

render();
foodsReady.then(render);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
