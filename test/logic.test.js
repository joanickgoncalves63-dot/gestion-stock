import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockStatus, applyMove, toCSV, parseCSV, rowsToItems, findMatch, mergeImported, toOrder, num } from '../src/logic.js';

test('statut de stock', () => {
  assert.equal(stockStatus({ qty: 0, min: 5 }), 'out');
  assert.equal(stockStatus({ qty: 5, min: 5 }), 'low');
  assert.equal(stockStatus({ qty: 6, min: 5 }), 'ok');
  assert.equal(stockStatus({ qty: 3, min: 0 }), 'ok');
});

test('mouvements', () => {
  assert.equal(applyMove(10, 'in', 5), 15);
  assert.equal(applyMove(10, 'out', 3), 7);
  assert.equal(applyMove(10, 'adj', 4), 4);
  assert.equal(toOrder({ qty: 3, min: 8 }), 13);
  assert.equal(num('12,5'), 12.5);
});

test('CSV aller-retour avec ; et guillemets, sans injection de formule', () => {
  const csv = toCSV([['a', 'b;c', 'd"e'], ['=SOMME(A1)', '1', '']]);
  assert.ok(csv.startsWith('﻿'));
  const back = parseCSV(csv);
  assert.deepEqual(back[0], ['a', 'b;c', 'd"e']);
  assert.equal(back[1][0], "'=SOMME(A1)");
});

test('import : colonnes reconnues, ligne de titre décalée, fusion par référence', () => {
  const rows = [
    ['Tarif fournisseur 2026'],
    ['Référence', 'Désignation', 'Famille', 'Code EAN', 'Prix net HT', 'Conditionnement'],
    ['RC-1001', 'Cheville nylon 8x40', 'Fixation', '3700000000017', '12,50 €', 'boîte 100'],
    ['VIS-430', 'Vis inox 4x30', 'Quincaillerie', '', '9,10', 'boîte'],
  ];
  const r = rowsToItems(rows);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].price, 12.5);
  assert.equal(r.items[0].barcode, '3700000000017');
  assert.equal(r.items[0].qty, null);
  const existing = [{ id: 'x', sku: 'vis-430', name: 'Ancien', qty: 14, location: 'A1', barcode: '', category: '', unit: '' }];
  const m = findMatch(existing, r.items[1]);
  assert.equal(m.id, 'x');
  const merged = mergeImported(m, r.items[1]);
  assert.equal(merged.qty, 14);
  assert.equal(merged.location, 'A1');
  assert.equal(merged.price, 9.1);
  assert.equal(merged.name, 'Vis inox 4x30');
});

test('import : fichier sans colonnes reconnues', () => {
  assert.equal(rowsToItems([['foo', 'bar'], ['1', '2']]).error, 'no-columns');
});
