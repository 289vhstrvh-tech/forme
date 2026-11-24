// Converts the official ANSES Ciqual 2020 XML tables into a compact foods.json.
// Usage: node tools/build-foods.mjs <dir containing alim_*.xml and compo_*.xml> <out.json>
import fs from 'node:fs';
import path from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('usage: build-foods.mjs <ciqual-dir> <out.json>'); process.exit(1); }
const read = (f) => new TextDecoder('windows-1252').decode(fs.readFileSync(path.join(dir, f)));

// Nutrient key -> Ciqual constituent code(s) (first available wins)
const NUTRIENTS = {
  kcal: [328, 333], prot: [25000, 25003], carb: [31000], sugar: [32000], fiber: [34100],
  fat: [40000], sat: [40302], mono: [40303], poly: [40304],
  ala: [41833], epa: [42053], dha: [42263],
  na: [10110], k: [10190], ca: [10200], mg: [10120], p: [10150], fe: [10260],
  zn: [10300], cu: [10290], se: [10340], i: [10530],
  vitA: [51200], betacar: [51330], vitD: [52100], vitE: [53100], vitK: [54101],
  vitC: [55100], b1: [56100], b2: [56200], b3: [56310], b5: [56400], b6: [56500],
  b9: [56700], b12: [56600], chol: [75100], alcohol: [60000],
};
const KEYS = Object.keys(NUTRIENTS);

// Excluded: meat subgroups (pesco-vegetarian) and infant foods
const EXCLUDED_SUBGROUPS = new Set(['0401', '0402', '0403', '0404', '0603']); // meat + alcoholic drinks
const EXCLUDED_GROUPS = new Set(['11']);
const MEAT_WORDS = /\b(poulet|boeuf|bœuf|porc|jambon|lardons?|viande|veau|agneau|mouton|canard|dinde|saucisses?|saucisson|bacon|chorizo|merguez|lapin|foie gras|pâté|rillettes|andouille|boudin|chipolata|cordon bleu|steak haché|hachis|kebab|gibier|cheval|poule|volaille|magret|confit de|nuggets?|bolognaise|carbonara|cassoulet|choucroute|tartiflette|burger|hamburger|cheeseburger|hot[- ]dog|croque[- ]monsieur|lasagnes? (?!.*(saumon|thon|légumes|végétarien|epinard|épinard|chèvre)))\b/i;

const tag = (block, name) => (block.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i')) || [])[1]?.trim() ?? '';

const foods = new Map();
for (const m of read(fs.readdirSync(dir).find((f) => /^alim_\d/.test(f))).matchAll(/<ALIM>([\s\S]*?)<\/ALIM>/g)) {
  const b = m[1];
  const code = Number(tag(b, 'alim_code'));
  const name = tag(b, 'alim_nom_fr');
  const grp = tag(b, 'alim_grp_code');
  const sub = tag(b, 'alim_ssgrp_code');
  if (EXCLUDED_GROUPS.has(grp) || EXCLUDED_SUBGROUPS.has(sub)) continue;
  if (MEAT_WORDS.test(name) && !/végétarien|vegan|végétal|soja|tofu|seitan|substitut/i.test(name)) continue;
  foods.set(code, { code, name, grp, sub, v: {} });
}

const parseValue = (raw) => {
  const s = raw.replace(',', '.').trim();
  if (!s || s === '-') return null;
  if (/^traces$/i.test(s)) return 0;
  const lt = s.match(/^<\s*([\d.]+)/);
  if (lt) return Number(lt[1]) / 2; // "< x" -> half the detection limit
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const wanted = new Map();
for (const [key, codes] of Object.entries(NUTRIENTS)) codes.forEach((c, i) => wanted.set(c, { key, prio: i }));

const compo = read(fs.readdirSync(dir).find((f) => /^compo_\d/.test(f)));
for (const m of compo.matchAll(/<COMPO>([\s\S]*?)<\/COMPO>/g)) {
  const b = m[1];
  const food = foods.get(Number(tag(b, 'alim_code')));
  if (!food) continue;
  const w = wanted.get(Number(tag(b, 'const_code')));
  if (!w) continue;
  const val = parseValue(tag(b, 'teneur'));
  if (val === null) continue;
  const cur = food.v[w.key];
  if (!cur || w.prio < cur.prio) food.v[w.key] = { val, prio: w.prio };
}

// When Ciqual has no energy value, derive it from macros (EU 1169/2011 factors)
let derived = 0;
for (const f of foods.values()) {
  if (f.v.kcal !== undefined) continue;
  const g = (k) => f.v[k]?.val;
  if (g('prot') === undefined || g('carb') === undefined || g('fat') === undefined) continue; // need all three
  const kcal = 4 * (g('prot') ?? 0) + 4 * (g('carb') ?? 0) + 9 * (g('fat') ?? 0) + 2 * (g('fiber') ?? 0) + 7 * (g('alcohol') ?? 0);
  f.v.kcal = { val: Math.round(kcal), prio: 9 };
  derived++;
}
console.log(`${derived} energy values derived from macros`);

const round = (x) => (x === undefined ? null : Math.round(x * 1000) / 1000);
const rows = [...foods.values()]
  .filter((f) => f.v.kcal !== undefined)
  .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  .map((f) => [f.code, f.name, f.sub, ...KEYS.map((k) => round(f.v[k]?.val))]);

fs.writeFileSync(out, JSON.stringify({ source: 'ANSES Ciqual 2020 (Licence Ouverte Etalab)', keys: KEYS, foods: rows }));
console.log(`${rows.length} foods written to ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
