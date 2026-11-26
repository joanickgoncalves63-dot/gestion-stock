// Stockage des données. Deux modes :
//  - « firebase » : stock partagé entre les appareils (Firestore), avec connexion par e-mail. Fonctionne hors réseau,
//    les saisies partent dès que la connexion revient.
//  - « demo » : quand src/firebase-config.js n'est pas rempli. Données gardées sur l'appareil.
import { firebaseConfig } from './firebase-config.js';
import { applyMove, num } from './logic.js';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowIso = () => new Date().toISOString();

export const firebaseEnabled = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/* ===================== Mode démonstration (local) ===================== */
const LKEY = 'gestion-stock-demo-v1';

function exampleArticles() {
  const ex = [
    ['Vis inox 4x30 (boîte 200)', 'VIS-430', '3760012340012', 'Quincaillerie', 'A1-02', 'boîte', 14, 10, 8.9],
    ['Gants nitrile taille L', 'GAN-NL', '3760012340029', 'EPI', 'B2-01', 'boîte', 3, 8, 6.5],
    ['Ruban adhésif 50 mm', 'RUB-50', '3760012340036', 'Emballage', 'C1-04', 'rouleau', 42, 20, 2.1],
    ['Cartons 40x30x30', 'CAR-403', '3760012340043', 'Emballage', 'C2-01', 'unité', 0, 50, 1.2],
    ['Cartouche silicone blanc', 'SIL-BL', '3760012340050', 'Quincaillerie', 'A3-05', 'unité', 26, 12, 5.4],
  ];
  return ex.map((r) => ({ id: uid(), name: r[0] + ' (exemple)', sku: r[1], barcode: r[2], category: r[3], location: r[4], unit: r[5], qty: r[6], min: r[7], price: r[8], updatedAt: nowIso() }));
}

function createDemoStore() {
  let data = { articles: [], moves: [] };
  try { data = JSON.parse(localStorage.getItem(LKEY)) || data; } catch (e) { /* stockage indisponible */ }
  if (!data.articles.length && !data.seeded) { data.articles = exampleArticles(); data.seeded = true; }
  let listener = () => {};
  const save = () => {
    data.moves = data.moves.slice(0, 1000);
    try { localStorage.setItem(LKEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    listener({ articles: data.articles, moves: data.moves });
  };
  return {
    mode: 'demo',
    onAuth(cb) { cb({ email: 'demo', displayName: 'Démonstration' }); },
    async signIn() {}, async signOut() {}, async resetPassword() {},
    subscribe(cb) { listener = cb; cb({ articles: data.articles, moves: data.moves }); return () => {}; },
    async saveArticle(a) {
      a = { ...a, updatedAt: nowIso() };
      const i = data.articles.findIndex((x) => x.id === a.id);
      if (i >= 0) data.articles[i] = a; else data.articles.push(a);
      save();
    },
    async deleteArticle(id) { data.articles = data.articles.filter((a) => a.id !== id); save(); },
    async addMove(a, type, qty, note) {
      const before = num(a.qty), after = applyMove(before, type, qty);
      const m = { id: uid(), articleId: a.id, articleName: a.name, unit: a.unit || '', type, qty: type === 'adj' ? after - before : num(qty), before, after, note: note || '', at: nowIso(), by: 'Démonstration' };
      const i = data.articles.findIndex((x) => x.id === a.id);
      if (i >= 0) data.articles[i] = { ...data.articles[i], qty: after, updatedAt: m.at };
      data.moves.unshift(m);
      save();
      return m;
    },
    async importArticles(list, onProgress) {
      for (const a of list) {
        const i = data.articles.findIndex((x) => x.id === a.id);
        const v = { ...a, updatedAt: nowIso() };
        if (i >= 0) data.articles[i] = v; else data.articles.push(v);
      }
      onProgress?.(list.length);
      save();
      return { done: list.length, failed: 0 };
    },
  };
}

/* ===================== Mode Firebase (partagé) ===================== */
async function createFirebaseStore(onError) {
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('firebase/firestore'),
  ]);
  const app = initializeApp(firebaseConfig);
  // indexedDBLocalPersistence : la session reste ouverte dans l'application Android (WebView).
  const auth = authMod.initializeAuth(app, { persistence: authMod.indexedDBLocalPersistence });
  const db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  let currentUser = null;
  const who = () => (currentUser && (currentUser.displayName || currentUser.email)) || '';

  // Un commit Firestore ne se termine qu'une fois reçu par le serveur : hors réseau il reste en attente.
  // L'écran est mis à jour tout de suite par le cache local ; on ne remonte que les vraies erreurs.
  const fire = (p) => { p.catch((e) => onError?.(e)); };

  return {
    mode: 'firebase',
    onAuth(cb) { authMod.onAuthStateChanged(auth, (u) => { currentUser = u; cb(u ? { email: u.email, displayName: u.displayName } : null); }); },
    signIn: (email, pw) => authMod.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => authMod.signOut(auth),
    resetPassword: (email) => authMod.sendPasswordResetEmail(auth, email),
    subscribe(cb) {
      let articles = [], moves = [], gotA = false, gotM = false;
      const emit = () => { if (gotA && gotM) cb({ articles, moves }); };
      const u1 = fs.onSnapshot(fs.collection(db, 'articles'), (s) => { articles = s.docs.map((d) => ({ ...d.data(), id: d.id })); gotA = true; emit(); }, (e) => onError?.(e));
      const u2 = fs.onSnapshot(fs.query(fs.collection(db, 'mouvements'), fs.orderBy('at', 'desc'), fs.limit(500)), (s) => { moves = s.docs.map((d) => ({ ...d.data(), id: d.id })); gotM = true; emit(); }, (e) => onError?.(e));
      return () => { u1(); u2(); };
    },
    async saveArticle(a) {
      const { id, ...rest } = a;
      fire(fs.setDoc(fs.doc(db, 'articles', id), { ...rest, updatedAt: nowIso() }));
    },
    async deleteArticle(id) { fire(fs.deleteDoc(fs.doc(db, 'articles', id))); },
    async addMove(a, type, qty, note) {
      const before = num(a.qty), after = applyMove(before, type, qty);
      const m = { articleId: a.id, articleName: a.name, unit: a.unit || '', type, qty: type === 'adj' ? after - before : num(qty), before, after, note: note || '', at: nowIso(), by: who() };
      const batch = fs.writeBatch(db);
      // Entrées et sorties : incrément atomique, juste même si deux personnes saisissent en même temps.
      const qtyUpdate = type === 'adj' ? after : fs.increment(type === 'in' ? num(qty) : -num(qty));
      batch.update(fs.doc(db, 'articles', a.id), { qty: qtyUpdate, updatedAt: m.at });
      batch.set(fs.doc(fs.collection(db, 'mouvements')), m);
      fire(batch.commit());
      return m;
    },
    async importArticles(list, onProgress) {
      let done = 0;
      for (let i = 0; i < list.length; i += 400) {
        const batch = fs.writeBatch(db);
        for (const a of list.slice(i, i + 400)) {
          const { id, ...rest } = a;
          batch.set(fs.doc(db, 'articles', id), { ...rest, updatedAt: nowIso() });
        }
        fire(batch.commit());
        done = Math.min(list.length, i + 400);
        onProgress?.(done);
      }
      return { done, failed: 0 };
    },
  };
}

export async function createStore(onError) {
  if (!firebaseEnabled()) return createDemoStore();
  return createFirebaseStore(onError);
}
