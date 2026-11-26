import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import './style.css';
import { createStore, uid } from './store.js';
import { num, stockStatus as status, statusLabel, toCSV, toOrder, rowsToItems, findMatch, mergeImported, FIELD_LABELS } from './logic.js';
import { readTable, shareFile } from './io.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR');
const eur = (n, d = 0) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: d });
const when = (iso) => {
  const d = new Date(iso); if (isNaN(d)) return '';
  const t = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? 'Aujourd’hui ' + t : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' + t;
};

const S = { articles: new Map(), moves: [], ready: false, user: null, q: '', cat: '', stat: '', mvType: '' };
let store = null, unsub = null;

const cats = () => [...new Set([...S.articles.values()].map((a) => a.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
const alerts = () => [...S.articles.values()].filter((a) => status(a) !== 'ok').sort((a, b) => num(a.qty) - num(b.qty));

const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-dash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></symbol>
  <symbol id="i-box" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></symbol>
  <symbol id="i-moves" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></symbol>
  <symbol id="i-out" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></symbol>
</svg>`;

/* ===================== Démarrage ===================== */
async function boot() {
  $('#root').innerHTML = ICONS + '<div class="login"><p class="hint">Chargement…</p></div>';
  try {
    store = await createStore(onStoreError);
  } catch (e) {
    $('#root').innerHTML = ICONS + '<div class="login"><div class="banner">Impossible de démarrer l’application. Vérifiez la connexion internet puis relancez-la.</div></div>';
    return;
  }
  store.onAuth((u) => {
    S.user = u;
    if (unsub) { unsub(); unsub = null; }
    S.loadError = null;
    if (!u) { S.ready = false; S.articles = new Map(); S.moves = []; renderLogin(); return; }
    renderShell();
    unsub = store.subscribe(({ articles, moves }) => {
      S.articles = new Map(articles.map((a) => [a.id, a]));
      S.moves = moves;
      S.ready = true;
      render();
    });
  });
}

function onStoreError(e) {
  const code = e && e.code;
  if (!S.ready && S.user) {
    // Erreur pendant le chargement : on l'affiche à la place de « Chargement du stock… ».
    S.loadError = code === 'permission-denied' ? 'denied' : 'other';
    render();
    console.error(e);
    return;
  }
  if (code === 'permission-denied') toast('Accès refusé : ce compte n’est pas autorisé. Voyez avec la personne qui gère l’application.');
  else toast('Erreur de synchronisation. Les données seront renvoyées dès que possible.');
  console.error(e);
}

/* ===================== Connexion ===================== */
function renderLogin() {
  $('#root').innerHTML = ICONS + `<div class="login"><form id="lf" novalidate>
    <div class="brand"><i></i>Stock PME</div>
    <p class="hint" style="margin:0">Connectez-vous avec le compte que l’on vous a créé.</p>
    <label class="fl">E-mail<input id="le" type="email" autocomplete="username" inputmode="email" required></label>
    <label class="fl">Mot de passe<input id="lp" type="password" autocomplete="current-password" required></label>
    <div class="err" id="lerr" role="alert"></div>
    <button class="btn primary" id="lgo">Se connecter</button>
    <button type="button" class="linkbtn" id="lreset">Mot de passe oublié</button>
  </form></div>`;
  const err = $('#lerr');
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#le').value.trim(), pw = $('#lp').value;
    if (!email || !pw) { err.textContent = 'Indiquez votre e-mail et votre mot de passe.'; return; }
    $('#lgo').disabled = true; err.textContent = '';
    try { await store.signIn(email, pw); }
    catch (ex) {
      $('#lgo').disabled = false;
      const c = ex && ex.code || '';
      err.textContent = /invalid-credential|wrong-password|user-not-found|invalid-email/.test(c) ? 'E-mail ou mot de passe incorrect.'
        : /network/.test(c) ? 'Pas de connexion internet. La première connexion demande du réseau.'
        : /too-many-requests/.test(c) ? 'Trop d’essais. Attendez quelques minutes puis réessayez.'
        : /configuration-not-found|operation-not-allowed/.test(c) ? 'La connexion par e-mail n’est pas encore activée dans Firebase (Authentication > Adresse e-mail/Mot de passe).'
        : 'Connexion impossible. Réessayez.';
    }
  });
  $('#lreset').addEventListener('click', async () => {
    const email = $('#le').value.trim();
    if (!email) { err.textContent = 'Tapez d’abord votre e-mail, puis touchez « Mot de passe oublié ».'; return; }
    try { await store.resetPassword(email); err.textContent = ''; toast('Un e-mail pour choisir un nouveau mot de passe a été envoyé.'); }
    catch (ex) { err.textContent = 'Envoi impossible. Vérifiez l’adresse e-mail.'; }
  });
}

/* ===================== Coque de l'application ===================== */
function renderShell() {
  const demo = store.mode === 'demo';
  $('#root').innerHTML = ICONS + `<div class="app">
  <nav class="side" aria-label="Navigation">
    <div class="brand"><i></i>Stock PME</div>
    <button class="navbtn" data-view="tableau"><svg><use href="#i-dash"/></svg>Tableau de bord</button>
    <button class="navbtn" data-view="articles"><svg><use href="#i-box"/></svg>Articles</button>
    <button class="navbtn" data-view="alertes"><svg><use href="#i-bell"/></svg>Alertes <span class="count" data-alertcount hidden></span></button>
    <button class="navbtn" data-view="mouvements"><svg><use href="#i-moves"/></svg>Mouvements</button>
    <div class="foot">
      <div class="who">${esc(demo ? 'Mode démonstration' : (S.user?.displayName || S.user?.email || ''))}</div>
      ${demo ? '' : '<button class="navbtn small" data-logout><svg><use href="#i-out"/></svg>Se déconnecter</button>'}
    </div>
  </nav>
  <main><div class="wrap" id="view"></div></main>
  <nav class="tabs" aria-label="Navigation">
    <button class="navbtn" data-view="tableau"><svg><use href="#i-dash"/></svg>Accueil</button>
    <button class="navbtn" data-view="articles"><svg><use href="#i-box"/></svg>Articles</button>
    <button class="navbtn" data-view="alertes"><svg><use href="#i-bell"/></svg>Alertes<span class="count" data-alertcount hidden></span></button>
    <button class="navbtn" data-view="mouvements"><svg><use href="#i-moves"/></svg>Journal</button>
  </nav>
</div><div id="overlay"></div>`;
  render();
}

/* ===================== Navigation ===================== */
const VIEWS = ['tableau', 'articles', 'alertes', 'mouvements'];
const cur = () => { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : 'tableau'; };
function go(v) { if (location.hash.slice(1) !== v) location.hash = v; else render(); }
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

/* ===================== Rendu ===================== */
function render() {
  const el = $('#view'); if (!el) return;
  const v = cur();
  document.querySelectorAll('[data-view]').forEach((b) => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const n = alerts().length;
  document.querySelectorAll('[data-alertcount]').forEach((e) => { e.hidden = !n; e.textContent = n; });
  if (!S.ready && S.loadError === 'denied') {
    el.innerHTML = `<h1>Accès refusé</h1><div class="panel"><div class="empty">
      <p style="margin:0">Vous êtes connecté avec <b>${esc(S.user?.email || '')}</b>, mais cette adresse n’est pas dans la liste des personnes autorisées.</p>
      <p class="hint" style="margin:0">Dans la console Firebase, Firestore Database &gt; Règles : ajoutez exactement cette adresse, en minuscules, puis « Publier ». Rouvrez ensuite l’application.</p>
      <button class="btn" data-logout>Changer de compte</button></div></div>`;
    return;
  }
  if (!S.ready && S.loadError === 'other') {
    el.innerHTML = `<h1>Gestion de stock</h1><div class="panel"><div class="empty">
      <p style="margin:0">Le stock ne peut pas être chargé pour l’instant. Vérifiez la connexion internet.</p>
      <button class="btn" onclick="location.reload()">Réessayer</button></div></div>`;
    return;
  }
  if (!S.ready) { el.innerHTML = '<h1>Gestion de stock</h1><div class="panel"><div class="empty">Chargement du stock…</div></div>'; return; }
  const keepFocus = document.activeElement && document.activeElement.id === 'q';
  const caret = keepFocus ? document.activeElement.selectionStart : 0;
  el.innerHTML = ({ tableau: vDash, articles: vArticles, alertes: vAlerts, mouvements: vMoves })[v]();
  if (keepFocus) { const q = $('#q'); if (q) { q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } } }
}
const banner = () => store.mode === 'demo'
  ? '<div class="banner info">Mode démonstration : les données restent sur cet appareil. Le partage entre appareils s’active une fois Firebase configuré.</div>' : '';

function articleRow(a) {
  const s = status(a);
  return `<li class="row st-${s}">
    <span class="stripe"></span>
    <div class="info" data-open="${esc(a.id)}" role="button" tabindex="0">
      <div class="name">${esc(a.name)}</div>
      <div class="meta">${a.sku ? `<span class="mono">${esc(a.sku)}</span>` : ''}${a.location ? `<span>Empl. ${esc(a.location)}</span>` : ''}${a.category ? `<span>${esc(a.category)}</span>` : ''}<span class="pill ${s}">${statusLabel[s]}</span></div>
    </div>
    <div class="qty"><b>${fmt(num(a.qty))}</b><small>${esc(a.unit || '')}${num(a.min) ? ` · seuil ${fmt(num(a.min))}` : ''}</small></div>
    <div class="quick"><button class="qb out" data-mv="out" data-id="${esc(a.id)}" aria-label="Sortie de stock">−</button><button class="qb in" data-mv="in" data-id="${esc(a.id)}" aria-label="Entrée de stock">+</button></div>
  </li>`;
}
function moveRow(m) {
  const sign = m.type === 'in' ? 'in' : m.type === 'out' ? 'out' : 'adj';
  const d = m.type === 'in' ? '+' + fmt(num(m.qty)) : m.type === 'out' ? '−' + fmt(num(m.qty)) : (num(m.qty) >= 0 ? '+' : '−') + fmt(Math.abs(num(m.qty)));
  return `<li class="mv"><span class="sign ${sign}">${sign === 'in' ? '↓' : sign === 'out' ? '↑' : '='}</span>
   <div class="t"><div>${esc(m.articleName)}</div><div>${esc(when(m.at))}${m.by ? ' · ' + esc(m.by) : ''} · ${m.type === 'adj' ? 'Inventaire' : m.type === 'in' ? 'Entrée' : 'Sortie'} · stock ${fmt(num(m.before))} → ${fmt(num(m.after))}${m.note ? ' · ' + esc(m.note) : ''}</div></div>
   <span class="d" style="color:var(--${sign === 'in' ? 'ok' : sign === 'out' ? 'bad' : 'muted'})">${d}</span></li>`;
}

function vDash() {
  const all = [...S.articles.values()], al = alerts();
  const value = all.reduce((s, a) => s + Math.max(0, num(a.qty)) * num(a.price), 0);
  const today = new Date().toDateString();
  const mt = S.moves.filter((m) => new Date(m.at).toDateString() === today).length;
  return `<div class="head"><h1 class="grow">Tableau de bord</h1><button class="btn primary" data-new>+ Nouvel article</button></div>
  ${banner()}
  <div class="kpis">
    <button class="kpi" data-go="articles"><span>Articles</span><b>${all.length}</b></button>
    <button class="kpi alert" data-go="alertes"><span>Ruptures</span><b>${al.filter((a) => status(a) === 'out').length}</b></button>
    <button class="kpi low" data-go="alertes"><span>Stock bas</span><b>${al.filter((a) => status(a) === 'low').length}</b></button>
    <div class="kpi"><span>Valeur du stock</span><b>${eur(value)}</b></div>
  </div>
  <div class="tools"><label class="search"><svg><use href="#i-search"/></svg><input id="scan" placeholder="Scanner ou taper un code-barres / une référence, puis Entrée" autocomplete="off" inputmode="search" aria-label="Recherche rapide par code"></label></div>
  <div class="grid2">
    <section class="panel"><header><h2>À réapprovisionner</h2><button class="btn ghost" data-go="alertes">Tout voir</button></header>
      ${al.length ? `<ul class="rows">${al.slice(0, 6).map(articleRow).join('')}</ul>` : '<div class="empty">Aucun article sous son seuil. Tout est en ordre.</div>'}
    </section>
    <section class="panel"><header><h2>Derniers mouvements</h2><span class="hint">${mt} aujourd’hui</span></header>
      ${S.moves.length ? `<ul class="rows">${S.moves.slice(0, 8).map(moveRow).join('')}</ul>` : '<div class="empty">Aucun mouvement pour l’instant. Touchez + ou − sur un article pour enregistrer une entrée ou une sortie.</div>'}
    </section>
  </div>`;
}
function filtered() {
  const q = S.q.trim().toLowerCase();
  return [...S.articles.values()].filter((a) => {
    if (S.cat && a.category !== S.cat) return false;
    if (S.stat && status(a) !== S.stat) return false;
    if (!q) return true;
    return [a.name, a.sku, a.barcode, a.location, a.category].some((f) => String(f || '').toLowerCase().includes(q));
  }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
}
function vArticles() {
  const list = filtered(), cs = cats();
  const shown = list.slice(0, 300);
  return `<div class="head"><h1 class="grow">Articles</h1><button class="btn" data-import>Importer</button><button class="btn" data-export="articles">Exporter CSV</button><button class="btn primary" data-new>+ Nouvel article</button></div>
  ${banner()}
  <div class="tools">
    <label class="search"><svg><use href="#i-search"/></svg><input id="q" value="${esc(S.q)}" placeholder="Nom, référence, code-barres, emplacement…" autocomplete="off" inputmode="search" aria-label="Rechercher un article"></label>
    <select class="f" id="cat" aria-label="Catégorie"><option value="">Toutes catégories</option>${cs.map((c) => `<option ${c === S.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  </div>
  <div class="chips">${[['', 'Tous'], ['ok', 'En stock'], ['low', 'Stock bas'], ['out', 'Rupture']].map(([k, l]) => `<button class="chip" data-stat="${k}" aria-pressed="${S.stat === k}">${l}</button>`).join('')}</div>
  <section class="panel">${shown.length ? `<ul class="rows">${shown.map(articleRow).join('')}</ul>`
    : (S.articles.size ? '<div class="empty">Aucun article ne correspond à cette recherche.</div>'
      : '<div class="empty">Le catalogue est vide.<button class="btn primary" data-new>Ajouter le premier article</button><button class="btn" data-import>Importer un fichier Excel ou CSV</button></div>')}</section>
  <p class="hint">${list.length} article${list.length > 1 ? 's' : ''}${list.length > shown.length ? `, les ${shown.length} premiers affichés : affinez la recherche` : ''}. Une douchette code-barres USB ou Bluetooth fonctionne directement dans le champ de recherche.</p>`;
}
function vAlerts() {
  const al = alerts();
  return `<div class="head"><h1 class="grow">Alertes de stock</h1><button class="btn" data-export="alertes">Liste de commande CSV</button></div>
  ${banner()}
  <section class="panel">${al.length ? `<ul class="rows">${al.map(articleRow).join('')}</ul>` : '<div class="empty">Aucune alerte. Chaque article est au-dessus de son seuil minimum.</div>'}</section>
  <p class="hint">Un article passe en « Stock bas » quand sa quantité atteint son seuil minimum, et en « Rupture » à zéro.</p>`;
}
function vMoves() {
  const list = S.moves.filter((m) => !S.mvType || m.type === S.mvType);
  return `<div class="head"><h1 class="grow">Journal des mouvements</h1><button class="btn" data-export="mouvements">Exporter CSV</button></div>
  ${banner()}
  <div class="chips">${[['', 'Tous'], ['in', 'Entrées'], ['out', 'Sorties'], ['adj', 'Inventaires']].map(([k, l]) => `<button class="chip" data-mvt="${k}" aria-pressed="${S.mvType === k}">${l}</button>`).join('')}</div>
  <section class="panel">${list.length ? `<ul class="rows">${list.map(moveRow).join('')}</ul>` : '<div class="empty">Aucun mouvement enregistré.</div>'}</section>`;
}

/* ===================== Événements ===================== */
document.addEventListener('click', (e) => {
  const t = e.target.closest('button,[data-open]'); if (!t) return;
  if (t.dataset.view) { go(t.dataset.view); return; }
  if (t.dataset.go) { go(t.dataset.go); return; }
  if (t.hasAttribute('data-logout')) { logoutSheet(); return; }
  if (t.hasAttribute('data-new')) { editSheet(); return; }
  if (t.hasAttribute('data-import')) { importSheet(); return; }
  if (t.dataset.open) { detailSheet(S.articles.get(t.dataset.open)); return; }
  if (t.dataset.mv) { moveSheet(S.articles.get(t.dataset.id), t.dataset.mv); return; }
  if (t.dataset.stat !== undefined && t.classList.contains('chip')) { S.stat = t.dataset.stat; render(); return; }
  if (t.dataset.mvt !== undefined) { S.mvType = t.dataset.mvt; render(); return; }
  if (t.dataset.export) { exportCSV(t.dataset.export); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-open]')) detailSheet(S.articles.get(e.target.dataset.open));
  if (e.key === 'Enter' && (e.target.id === 'scan' || e.target.id === 'q')) {
    const code = e.target.value.trim().toLowerCase(); if (!code) return;
    const hit = [...S.articles.values()].find((a) => String(a.barcode || '').toLowerCase() === code || String(a.sku || '').toLowerCase() === code);
    if (hit) { e.preventDefault(); e.target.value = ''; if (e.target.id === 'q') S.q = ''; detailSheet(hit); }
    else if (e.target.id === 'scan') { S.q = e.target.value; go('articles'); }
  }
  if (e.key === 'Escape') close();
});
document.addEventListener('input', (e) => { if (e.target.id === 'q') { S.q = e.target.value; render(); } });
document.addEventListener('change', (e) => { if (e.target.id === 'cat') { S.cat = e.target.value; render(); } });

/* ===================== Fenêtres ===================== */
function open(html) {
  $('#overlay').innerHTML = `<div class="scrim" data-scrim><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  $('#overlay [data-scrim]').addEventListener('click', (e) => { if (e.target.hasAttribute('data-scrim')) close(); });
  const x = $('#overlay [data-x]'); if (x) x.addEventListener('click', close);
  const f = $('#overlay [autofocus]'); if (f) setTimeout(() => f.focus(), 30);
}
function close() { const o = $('#overlay'); if (o) o.innerHTML = ''; }

function logoutSheet() {
  open(`<h3>Se déconnecter ?</h3><p class="hint">Il faudra retaper l’e-mail et le mot de passe pour revenir.</p>
   <div class="actions"><button class="btn" data-x>Annuler</button><button class="btn primary" id="lo">Se déconnecter</button></div>`);
  $('#lo').addEventListener('click', async () => { close(); await store.signOut(); });
}

function detailSheet(a) {
  if (!a) return;
  const s = status(a);
  const hist = S.moves.filter((m) => m.articleId === a.id).slice(0, 6);
  open(`<div class="head"><h3 class="grow">${esc(a.name)}</h3><span class="pill ${s}">${statusLabel[s]}</span></div>
   <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
     <div class="kpi"><span>En stock</span><b>${fmt(num(a.qty))}</b></div>
     <div class="kpi"><span>Seuil mini</span><b>${fmt(num(a.min))}</b></div>
     <div class="kpi"><span>Valeur</span><b>${eur(Math.max(0, num(a.qty)) * num(a.price))}</b></div>
   </div>
   <div class="hint">${[a.sku && 'Réf. ' + esc(a.sku), a.barcode && 'Code ' + esc(a.barcode), a.location && 'Emplacement ' + esc(a.location), a.category && esc(a.category), a.unit && 'Unité : ' + esc(a.unit), num(a.price) && 'Prix unitaire ' + eur(num(a.price), 2)].filter(Boolean).join(' · ')}</div>
   <div class="actions" style="justify-content:stretch">
     <button class="btn" style="flex:1" data-act="out">− Sortie</button>
     <button class="btn primary" style="flex:1" data-act="in">+ Entrée</button>
     <button class="btn" style="flex:1" data-act="adj">Inventaire</button>
   </div>
   <div><h2 style="margin-bottom:6px">Historique</h2>${hist.length ? `<ul class="rows panel">${hist.map(moveRow).join('')}</ul>` : '<p class="hint">Aucun mouvement pour cet article.</p>'}</div>
   <div class="actions"><button class="btn ghost" data-act="edit">Modifier la fiche</button><button class="btn" data-x>Fermer</button></div>`);
  $('#overlay').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.act; if (k === 'edit') editSheet(a); else moveSheet(a, k);
  }));
}

function moveSheet(a, type) {
  if (!a) return;
  let t = type;
  open(`<h3>${esc(a.name)}</h3>
   <div class="seg" role="group" aria-label="Type de mouvement"><button data-t="in">Entrée</button><button data-t="out">Sortie</button><button data-t="adj">Inventaire</button></div>
   <label class="fl"><span id="qlab">Quantité</span>
     <div class="stepper"><button type="button" data-step="-1" aria-label="Moins">−</button><input id="mvq" type="number" inputmode="decimal" min="0" step="any" value="1"><button type="button" data-step="1" aria-label="Plus">+</button></div></label>
   <div class="preview" id="pv"></div>
   <label class="fl">Note (facultatif)<input id="mvn" placeholder="Ex. bon de livraison 2291, chantier Dupont…" autocomplete="off"></label>
   <div class="actions"><button class="btn" data-x>Annuler</button><button class="btn primary" id="mvok">Enregistrer</button></div>`);
  const q = $('#mvq'), pv = $('#pv');
  const upd = () => {
    $('#overlay').querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.t === t));
    $('#qlab').textContent = t === 'adj' ? 'Quantité comptée' : 'Quantité';
    const v = num(q.value), b = num(a.qty), af = t === 'in' ? b + v : t === 'out' ? b - v : v;
    pv.innerHTML = `Stock : <b>${fmt(b)}</b> → <b style="color:var(--${af < 0 ? 'bad' : af <= num(a.min) ? 'warn' : 'ok'})">${fmt(af)}</b> ${esc(a.unit || '')}${af < 0 ? ' · le stock deviendrait négatif' : ''}`;
  };
  if (t === 'adj') q.value = num(a.qty);
  $('#overlay').querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { t = b.dataset.t; if (t === 'adj') q.value = num(a.qty); upd(); }));
  $('#overlay').querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => { q.value = Math.max(0, num(q.value) + num(b.dataset.step)); upd(); }));
  q.addEventListener('input', upd); q.select(); upd();
  const ok = $('#mvok');
  const submit = async () => {
    const v = num(q.value);
    if (t !== 'adj' && v <= 0) { toast('Indiquez une quantité supérieure à zéro.'); return; }
    ok.disabled = true;
    try {
      const fresh = S.articles.get(a.id) || a;
      await store.addMove(fresh, t, v, $('#mvn').value.trim());
      close();
      toast(t === 'in' ? `Entrée de ${fmt(v)} enregistrée` : t === 'out' ? `Sortie de ${fmt(v)} enregistrée` : 'Inventaire enregistré');
    } catch (e) { ok.disabled = false; toast('Enregistrement impossible. Réessayez.'); }
  };
  ok.addEventListener('click', submit);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

function editSheet(a) {
  const isNew = !a;
  a = a || { id: uid(), name: '', sku: '', barcode: '', category: '', location: '', unit: 'unité', qty: 0, min: 0, price: 0 };
  open(`<h3>${isNew ? 'Nouvel article' : 'Modifier la fiche'}</h3>
   <form id="af" class="fields">
     <label class="fl full">Désignation<input id="f-name" required value="${esc(a.name)}" autofocus placeholder="Ex. Vis inox 4x30"></label>
     <label class="fl">Référence<input id="f-sku" value="${esc(a.sku)}" placeholder="VIS-430" autocomplete="off"></label>
     <label class="fl">Code-barres (EAN)<input id="f-barcode" value="${esc(a.barcode)}" inputmode="numeric" placeholder="Scanner ou saisir" autocomplete="off"></label>
     <label class="fl">Catégorie<input id="f-category" list="catlist" value="${esc(a.category)}" placeholder="Quincaillerie"><datalist id="catlist">${cats().map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
     <label class="fl">Emplacement<input id="f-location" value="${esc(a.location)}" placeholder="Allée A, étagère 2"></label>
     <label class="fl">Unité<input id="f-unit" value="${esc(a.unit)}" placeholder="unité, boîte, kg…"></label>
     <label class="fl">Prix unitaire (€)<input id="f-price" type="number" inputmode="decimal" step="any" min="0" value="${num(a.price)}"></label>
     ${isNew ? `<label class="fl">Stock initial<input id="f-qty" type="number" inputmode="decimal" step="any" min="0" value="${num(a.qty)}"></label>` : ''}
     <label class="fl">Seuil d’alerte<input id="f-min" type="number" inputmode="decimal" step="any" min="0" value="${num(a.min)}"></label>
     <div class="actions full">${isNew ? '' : '<button type="button" class="btn danger left" id="del">Supprimer</button>'}<button type="button" class="btn" data-x>Annuler</button><button class="btn primary" id="save">Enregistrer</button></div>
   </form>`);
  const del = $('#del');
  if (del) del.addEventListener('click', async () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Confirmer la suppression'; return; }
    await store.deleteArticle(a.id); close(); toast('Article supprimé');
  });
  $('#af').addEventListener('submit', async (e) => {
    e.preventDefault();
    const g = (k) => $('#f-' + k).value.trim();
    if (!g('name')) { toast('Indiquez la désignation de l’article.'); return; }
    const dup = [...S.articles.values()].find((x) => x.id !== a.id && g('barcode') && x.barcode === g('barcode'));
    if (dup) { toast('Ce code-barres est déjà utilisé par « ' + dup.name + ' ».'); return; }
    const na = { ...a, name: g('name'), sku: g('sku'), barcode: g('barcode'), category: g('category'), location: g('location'), unit: g('unit'), price: num(g('price')), min: num(g('min')) };
    if (isNew) na.qty = num(g('qty'));
    $('#save').disabled = true;
    try { await store.saveArticle(na); close(); toast(isNew ? 'Article ajouté' : 'Fiche enregistrée'); }
    catch (err) { $('#save').disabled = false; toast('Enregistrement impossible. Réessayez.'); }
  });
}

/* ===================== Import Excel / CSV ===================== */
function importSheet() {
  open(`<h3>Importer des références</h3>
   <p class="hint">Choisissez un fichier Excel (.xlsx) ou CSV, par exemple un export de votre compte fournisseur ou votre propre liste. Une ligne doit contenir les titres de colonnes : désignation, référence, code-barres, famille, prix, quantité, seuil… Les colonnes sont reconnues automatiquement.</p>
   <label class="fl">Fichier<input id="impf" type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
   <label class="fl">Catégorie à appliquer si le fichier n’en a pas (facultatif)<input id="impcat" placeholder="Ex. RECA" autocomplete="off"></label>
   <div id="imppv"></div>
   <div class="actions"><button class="btn" data-x>Annuler</button><button class="btn primary" id="impok" disabled>Importer</button></div>`);
  let parsed = null;
  $('#impf').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const pv = $('#imppv');
    pv.innerHTML = '<p class="hint">Lecture du fichier…</p>';
    $('#impok').disabled = true;
    try {
      const rows = await readTable(f);
      const r = rowsToItems(rows);
      if (r.error) { pv.innerHTML = '<div class="banner">Je ne trouve ni colonne « Désignation » ni colonne « Référence ». Vérifiez que le fichier contient une ligne de titres de colonnes.</div>'; return; }
      const existing = [...S.articles.values()];
      const upd = r.items.filter((it) => findMatch(existing, it)).length;
      parsed = r;
      const n = r.items.length;
      pv.innerHTML = `<div class="banner info"><b>${n}</b> article${n > 1 ? 's' : ''} trouvé${n > 1 ? 's' : ''} : ${n - upd} nouveau${n - upd > 1 ? 'x' : ''}, ${upd} déjà présent${upd > 1 ? 's' : ''} (mis à jour par référence ou code-barres).<br>Colonnes reconnues : ${Object.keys(r.map).map((k) => esc(FIELD_LABELS[k]) + ' ← « ' + esc(r.header[r.map[k]]) + ' »').join(', ')}.${r.map.qty === undefined ? '<br>Pas de colonne quantité : les nouveaux articles démarrent à 0 et les stocks existants ne changent pas.' : ''}</div>
       <ul class="rows panel" style="margin-top:8px">${r.items.slice(0, 4).map((it) => `<li class="mv"><span class="sign adj">•</span><div class="t"><div>${esc(it.name)}</div><div>${esc([it.sku, it.barcode, it.category, it.price ? eur(it.price, 2) : ''].filter(Boolean).join(' · '))}</div></div><span></span></li>`).join('')}</ul>${n > 4 ? `<p class="hint">… et ${n - 4} autre${n - 4 > 1 ? 's' : ''}.</p>` : ''}`;
      $('#impok').disabled = !n;
    } catch (err) {
      pv.innerHTML = err && err.code === 'old-format'
        ? '<div class="banner">Ce format n’est pas lu. Dans Excel, faites « Enregistrer sous » au format .xlsx ou CSV, puis réessayez.</div>'
        : '<div class="banner">Impossible de lire ce fichier. Essayez de l’enregistrer en .xlsx ou en CSV depuis Excel.</div>';
    }
  });
  $('#impok').addEventListener('click', async () => {
    if (!parsed) return;
    const btn = $('#impok'); btn.disabled = true;
    const dc = $('#impcat').value.trim();
    const existing = [...S.articles.values()];
    const blank = () => ({ id: uid(), name: '', sku: '', barcode: '', category: '', location: '', unit: 'unité', qty: 0, min: 0, price: 0 });
    const list = parsed.items.map((it) => mergeImported(findMatch(existing, it) || blank(), it, dc));
    try {
      const r = await store.importArticles(list, (n) => { btn.textContent = `Import… ${n}/${list.length}`; });
      close(); toast(`${r.done} articles importés.`);
    } catch (e) { btn.disabled = false; btn.textContent = 'Importer'; toast('Import interrompu. Réessayez.'); }
  });
}

/* ===================== Export CSV ===================== */
async function exportCSV(kind) {
  const d = new Date().toISOString().slice(0, 10);
  const dec = (n) => String(Math.round(num(n) * 100) / 100).replace('.', ',');
  let rows, name;
  if (kind === 'mouvements') {
    rows = [['Date', 'Article', 'Type', 'Quantité', 'Stock avant', 'Stock après', 'Note', 'Par']]
      .concat(S.moves.map((m) => [new Date(m.at).toLocaleString('fr-FR'), m.articleName, m.type === 'in' ? 'Entrée' : m.type === 'out' ? 'Sortie' : 'Inventaire', dec(m.qty), dec(m.before), dec(m.after), m.note, m.by]));
    name = `mouvements-${d}.csv`;
  } else {
    const isAlert = kind === 'alertes';
    const list = isAlert ? alerts() : [...S.articles.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
    rows = [['Désignation', 'Référence', 'Code-barres', 'Catégorie', 'Emplacement', 'Unité', 'Quantité', 'Seuil', 'Statut', 'Prix unitaire', 'Valeur'].concat(isAlert ? ['À commander (2× seuil)'] : [])]
      .concat(list.map((a) => [a.name, a.sku, a.barcode, a.category, a.location, a.unit, dec(a.qty), dec(a.min), statusLabel[status(a)], dec(a.price), dec(Math.max(0, num(a.qty)) * num(a.price))].concat(isAlert ? [dec(toOrder(a))] : [])));
    name = isAlert ? `commande-${d}.csv` : `stock-${d}.csv`;
  }
  try { await shareFile(name, toCSV(rows)); }
  catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('Export impossible. Réessayez.'); }
}

let tt;
function toast(msg) {
  clearTimeout(tt);
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  tt = setTimeout(() => el.remove(), 3200);
}

boot();
