// Fonctions pures (sans DOM ni Firebase) : statut de stock, CSV, reconnaissance des colonnes d'import.

export const num = (v) => {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
};

/** 'out' = rupture (quantité <= 0), 'low' = au seuil ou en dessous, 'ok' sinon. */
export function stockStatus(a) {
  const q = num(a.qty), m = num(a.min);
  if (q <= 0) return 'out';
  if (m > 0 && q <= m) return 'low';
  return 'ok';
}
export const statusLabel = { ok: 'En stock', low: 'Stock bas', out: 'Rupture' };

/** Quantité après un mouvement. type : 'in' (entrée), 'out' (sortie), 'adj' (inventaire : quantité comptée). */
export function applyMove(before, type, qty) {
  if (type === 'in') return num(before) + num(qty);
  if (type === 'out') return num(before) - num(qty);
  return num(qty);
}

/** Quantité conseillée à commander pour remonter à deux fois le seuil. */
export const toOrder = (a) => Math.max(0, 2 * num(a.min) - num(a.qty));

/* ---------- CSV ---------- */
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = "'" + s; // évite l'injection de formules dans Excel
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** CSV au format Excel français : séparateur « ; », BOM UTF-8. */
export const toCSV = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');

export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const d = [';', '\t', ','].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim()));
}

/* ---------- Import : reconnaissance des colonnes ---------- */
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const COLS = {
  name: ['designation', 'libelle', 'nom', 'description', 'article', 'intitule', 'produit', 'libelle article', 'designation article'],
  sku: ['reference', 'ref', 'code article', 'ref article', 'reference article', 'code', 'ref fournisseur', 'reference fournisseur', 'sku', 'code produit'],
  barcode: ['code barre', 'code barres', 'ean', 'ean13', 'gencod', 'gencode', 'code ean', 'ean 13'],
  category: ['categorie', 'famille', 'sous famille', 'rayon', 'groupe', 'gamme'],
  location: ['emplacement', 'localisation', 'casier', 'allee', 'rangement'],
  unit: ['unite', 'conditionnement', 'unite de vente', 'uv', 'cdt'],
  qty: ['quantite', 'stock', 'qte', 'qty', 'quantite en stock', 'stock actuel'],
  min: ['seuil', 'minimum', 'stock mini', 'stock minimum', 'seuil alerte', 'mini', 'seuil d alerte'],
  price: ['prix', 'prix unitaire', 'pu', 'prix ht', 'pu ht', 'tarif', 'prix achat', 'prix d achat', 'prix net', 'prix net ht'],
};
export const FIELD_LABELS = { name: 'Désignation', sku: 'Référence', barcode: 'Code-barres', category: 'Catégorie', location: 'Emplacement', unit: 'Unité', qty: 'Quantité', min: 'Seuil', price: 'Prix' };

export function mapHeaders(header) {
  const m = {};
  const nh = header.map(norm);
  for (const [k, alts] of Object.entries(COLS)) {
    let i = nh.findIndex((x, j) => alts.includes(x) && !Object.values(m).includes(j));
    if (i < 0) i = nh.findIndex((x, j) => alts.some((a) => a.length > 3 && x.startsWith(a)) && !Object.values(m).includes(j));
    if (i >= 0) m[k] = i;
  }
  return m;
}

export function findHeaderRow(rows) {
  let best = 0, score = -1;
  rows.slice(0, 15).forEach((r, i) => {
    const s = Object.keys(mapHeaders(r)).length;
    if (s > score) { score = s; best = i; }
  });
  return best;
}

/** Transforme un tableau (lignes de cellules) en articles à importer. */
export function rowsToItems(rows) {
  const hi = findHeaderRow(rows);
  const header = (rows[hi] || []).map((x) => String(x ?? ''));
  const map = mapHeaders(header);
  if (map.name === undefined && map.sku === undefined) return { error: 'no-columns', map, header, items: [] };
  const cell = (r, k) => (map[k] === undefined ? '' : String(r[map[k]] ?? '').trim());
  const number = (r, k) => (map[k] === undefined ? null : num(cell(r, k).replace(/[^\d,.\-]/g, '')));
  const items = rows.slice(hi + 1).map((r) => ({
    name: cell(r, 'name') || cell(r, 'sku'),
    sku: cell(r, 'sku'),
    barcode: cell(r, 'barcode').replace(/\s/g, ''),
    category: cell(r, 'category'),
    location: cell(r, 'location'),
    unit: cell(r, 'unit'),
    qty: number(r, 'qty'),
    min: number(r, 'min'),
    price: number(r, 'price'),
  })).filter((x) => x.name);
  return { map, header, items };
}

/** Trouve l'article existant correspondant (même référence ou même code-barres). */
export function findMatch(articles, it) {
  return articles.find((a) =>
    (it.sku && a.sku && String(a.sku).toLowerCase() === it.sku.toLowerCase()) ||
    (it.barcode && a.barcode && a.barcode === it.barcode));
}

/** Fusionne une ligne importée dans un article existant (ou neuf). Les champs vides du fichier ne remplacent rien. */
export function mergeImported(base, it, defaultCategory = '') {
  const a = {
    ...base,
    name: it.name || base.name,
    sku: it.sku || base.sku,
    barcode: it.barcode || base.barcode,
    category: it.category || base.category || defaultCategory,
    location: it.location || base.location,
    unit: it.unit || base.unit,
  };
  if (it.qty != null) a.qty = it.qty;
  if (it.min != null) a.min = it.min;
  if (it.price != null) a.price = it.price;
  return a;
}
