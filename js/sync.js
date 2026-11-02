'use strict';
/*
 * Sincronización entre dispositivos (Firebase). Es opcional: sin iniciar sesión la app funciona
 * igual, solo con el guardado local. Con sesión iniciada:
 *   - cada cambio guardado en el dispositivo se sube a la nube (solo las notas que cambiaron);
 *   - los cambios hechos en otro dispositivo llegan en segundos y se combinan con los locales.
 *
 * Para combinar sin pisar cambios ajenos se recuerda, por tablero, el último estado en que la nube
 * y este dispositivo coincidían ("acordado"). Si una nota cambió solo en la nube, se trae; si cambió
 * aquí, se sube; si cambió en los dos sitios, gana la de este dispositivo (se sube y queda la última).
 *
 * En la nube:  users/{uid}/meta/projects  -> { p: { idProyecto: proyecto } }
 *              users/{uid}/boards/{idTablero} -> { notes: { id: nota }, edges: { id: flecha } }
 */
const TFSync = (() => {
  const CONFIG = {
    apiKey: 'AIzaSyASyTrhiaCSSa3DrIaMXkfz28vILwFDaDU',
    authDomain: 'tramaferal-3bc4d.firebaseapp.com',
    projectId: 'tramaferal-3bc4d',
    storageBucket: 'tramaferal-3bc4d.firebasestorage.app',
    messagingSenderId: '539477051272',
    appId: '1:539477051272:web:a18fa53a9b573e300d5c3d',
  };
  const raw = { get: TFDB.get, set: TFDB.set, del: TFDB.del, keys: TFDB.keys };
  let fb = null, auth = null, db = null, user = null, live = false, unsubs = [];
  const known = new Map();                 // tablero -> estado acordado {notes:{}, edges:{}}
  let knownProjects = null;                // estado acordado de la lista de proyectos {id: proyecto}
  let dirty = new Set();                   // claves con cambios locales aún sin subir
  let pushTimer = null, statusText = '';
  const listeners = new Set();

  /* ---------- utilidades ---------- */
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x));
  const same = (a, b) => canon(a) === canon(b);
  const toMap = (arr) => Object.fromEntries((arr || []).map((x) => [x.id, x]));
  const enc = (bid) => bid.replace(/\//g, '~');
  const dec = (id) => id.replace(/~/g, '/');
  const EMPTY = () => ({ notes: {}, edges: {} });

  /* Combinación a tres bandas de dos mapas {id: objeto} respecto al estado acordado. */
  function merge3(L, R, K) {
    const out = {};
    for (const id of new Set([...Object.keys(L), ...Object.keys(R), ...Object.keys(K)])) {
      const localChanged = !same(L[id], K[id]), remoteChanged = !same(R[id], K[id]);
      const v = localChanged ? L[id] : remoteChanged ? R[id] : L[id];
      if (v !== undefined) out[id] = v;
    }
    return out;
  }

  function setStatus(t) { statusText = t; for (const f of listeners) f(); }
  const saveDirty = () => localStorage.setItem('tf:dirty', JSON.stringify([...dirty]));
  function markDirty(k) { dirty.add(k); saveDirty(); schedulePush(); }

  async function getKnown(bid) {
    if (known.has(bid)) return known.get(bid);
    const k = (await raw.get('sync:' + bid)) || null;
    if (k) known.set(bid, k);
    return k;
  }
  function setKnown(bid, k) { known.set(bid, k); return raw.set('sync:' + bid, k); }

  /* ---------- lo que escribe la app pasa por aquí ---------- */
  TFDB.set = async (key, value) => {
    await raw.set(key, value);
    if (user && (key === 'projects' || key.startsWith('board:'))) markDirty(key);
  };
  TFDB.del = async (key) => {
    await raw.del(key);
    if (user && key.startsWith('board:')) { dirty.delete(key); markDirty('del:' + key.slice(6)); }
  };

  /* ---------- subir ---------- */
  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(push, 400); }

  async function push() {
    if (!live) return;
    const keys = [...dirty];
    if (!keys.length) return;
    setStatus('Sincronizando…');
    for (const k of keys) {
      dirty.delete(k);
      try {
        if (k === 'projects') await pushProjects();
        else if (k.startsWith('board:')) await pushBoard(k.slice(6));
        else if (k.startsWith('del:')) await pushDelete(k.slice(4));
      } catch (e) { console.error('sync', k, e); dirty.add(k); }
    }
    saveDirty();
    waitSynced();
  }

  async function pushProjects() {
    if (!knownProjects) knownProjects = (await raw.get('sync:projects')) || null;
    const L = toMap(await raw.get('projects'));
    const K = knownProjects || {};
    const ref = fb.doc(db, 'users', user.uid, 'meta', 'projects');
    const upd = {};
    for (const id of Object.keys(L)) if (!same(L[id], K[id])) upd['p.' + id] = L[id];
    for (const id of Object.keys(K)) if (!(id in L)) upd['p.' + id] = fb.deleteField();
    if (!Object.keys(upd).length) return;
    if (!knownProjects) fb.setDoc(ref, { p: L }, { merge: true }).catch(fail);
    else fb.updateDoc(ref, upd).catch((e) => (e.code === 'not-found' ? fb.setDoc(ref, { p: L }) : fail(e)));
    knownProjects = L;
    await raw.set('sync:projects', L);
  }

  async function pushBoard(bid) {
    const local = await raw.get('board:' + bid);
    if (!local) return;
    const L = { notes: toMap(local.notes), edges: toMap(local.edges) };
    if (canon(L).length > 900000) setStatus('Tablero demasiado grande para sincronizar: divídelo en super nodos');
    const K = await getKnown(bid);
    const ref = fb.doc(db, 'users', user.uid, 'boards', enc(bid));
    if (!K) {
      fb.setDoc(ref, L).catch(fail);
    } else {
      const upd = {};
      for (const f of ['notes', 'edges']) {
        for (const id of Object.keys(L[f])) if (!same(L[f][id], K[f][id])) upd[f + '.' + id] = L[f][id];
        for (const id of Object.keys(K[f])) if (!(id in L[f])) upd[f + '.' + id] = fb.deleteField();
      }
      if (!Object.keys(upd).length) return;
      fb.updateDoc(ref, upd).catch((e) => (e.code === 'not-found' ? fb.setDoc(ref, L) : fail(e)));
    }
    await setKnown(bid, L);
  }

  async function pushDelete(bid) {
    fb.deleteDoc(fb.doc(db, 'users', user.uid, 'boards', enc(bid))).catch(fail);
    known.delete(bid);
    await raw.del('sync:' + bid);
  }

  function fail(e) {
    console.error('sync', e);
    setStatus(e && e.code === 'permission-denied' ? 'Sin permiso en la nube (revisa las reglas)' : 'Error al sincronizar');
  }

  function waitSynced() {
    if (!navigator.onLine) { setStatus('Sin conexión · se subirá al volver'); return; }
    fb.waitForPendingWrites(db).then(() => { if (!dirty.size) setStatus('Sincronizado'); }).catch(() => {});
  }
  window.addEventListener('online', () => { if (live) { setStatus('Sincronizando…'); schedulePush(); waitSynced(); } });
  window.addEventListener('offline', () => { if (live) setStatus('Sin conexión · se subirá al volver'); });

  /* ---------- recibir ---------- */
  async function onProjects(snap) {
    if (snap.metadata.hasPendingWrites) return;          // es nuestro propio cambio
    const R = (snap.exists() && snap.data().p) || {};
    const K = knownProjects || (await raw.get('sync:projects')) || {};
    const L = toMap(window.TF ? window.TF.getProjects() : await raw.get('projects'));
    const M = merge3(L, R, K);
    knownProjects = R;
    await raw.set('sync:projects', R);
    if (!same(M, L)) {
      const list = Object.values(M).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      await raw.set('projects', list);
      if (window.TF) window.TF.setProjects(list);
    }
    if (!same(M, R)) markDirty('projects');
  }

  async function onBoards(snap) {
    for (const ch of snap.docChanges()) {
      const bid = dec(ch.doc.id);
      if (ch.doc.metadata.hasPendingWrites) continue;    // es nuestro propio cambio
      if (ch.type === 'removed') {
        if (dirty.has('board:' + bid)) continue;
        known.delete(bid);
        await raw.del('sync:' + bid);
        await raw.del('board:' + bid);
        continue;
      }
      const d = ch.doc.data();
      const R = { notes: d.notes || {}, edges: d.edges || {} };
      const K = (await getKnown(bid)) || EMPTY();
      const cur = window.TF && window.TF.getBoard(bid);   // el tablero abierto se combina en memoria
      const local = cur || (await raw.get('board:' + bid));
      const L = local ? { notes: toMap(local.notes), edges: toMap(local.edges) } : EMPTY();
      const M = { notes: merge3(L.notes, R.notes, K.notes), edges: merge3(L.edges, R.edges, K.edges) };
      // Una flecha cuyas notas ya no existen se descarta.
      for (const [id, e] of Object.entries(M.edges)) if (!M.notes[e.from] || !M.notes[e.to]) delete M.edges[id];
      await setKnown(bid, R);
      if (!same(M, L)) {
        const data = { notes: Object.values(M.notes), edges: Object.values(M.edges),
          view: (local && local.view) || { x: 0, y: 0, z: 1 } };
        await raw.set('board:' + bid, data);
        if (cur) window.TF.setBoard(bid, data);
      }
      if (!same(M, R)) markDirty('board:' + bid);
    }
  }

  /* ---------- sesión ---------- */
  async function load() {
    if (fb) return;
    fb = await import(new URL('vendor/firebase.js', document.baseURI).href);
    const app = fb.initializeApp(CONFIG);
    auth = fb.getAuth(app);
    await fb.setPersistence(auth, fb.indexedDBLocalPersistence);
    db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
    fb.onAuthStateChanged(auth, (u) => { if (u) begin(u); else end(); });
  }

  async function begin(u) {
    if (user && user.uid === u.uid) return;
    user = u;
    dirty = new Set(JSON.parse(localStorage.getItem('tf:dirty') || '[]'));
    // Primera vez en este dispositivo con esta cuenta: todo lo local se combina con la nube.
    if (localStorage.getItem('tf:uid') !== u.uid) {
      known.clear(); knownProjects = null;
      for (const k of await raw.keys()) if (k.startsWith('sync:')) await raw.del(k);
      localStorage.setItem('tf:uid', u.uid);
    }
    live = true;
    setStatus(navigator.onLine ? 'Sincronizando…' : 'Sin conexión · se subirá al volver');
    unsubs.push(fb.onSnapshot(fb.doc(db, 'users', u.uid, 'meta', 'projects'), (s) => onProjects(s).catch(fail), fail));
    unsubs.push(fb.onSnapshot(fb.collection(db, 'users', u.uid, 'boards'), (s) => onBoards(s).catch(fail), fail));
    // Tableros locales que la nube aún no tiene: se suben.
    for (const k of await raw.keys()) if (k.startsWith('board:') && !(await getKnown(k.slice(6)))) dirty.add(k);
    dirty.add('projects');
    saveDirty();
    schedulePush();
  }

  function end() {
    for (const f of unsubs) f();
    unsubs = []; user = null; live = false;
    setStatus('');
  }

  return {
    get user() { return user; },
    get status() { return statusText; },
    onChange(f) { listeners.add(f); },
    /* Arranca solo si ya se había iniciado sesión antes en este dispositivo. */
    autoStart() { if (localStorage.getItem('tf:sync') === '1') load().catch(fail); },
    async signIn(email, pass) { await load(); await fb.signInWithEmailAndPassword(auth, email, pass); localStorage.setItem('tf:sync', '1'); },
    async signUp(email, pass) { await load(); await fb.createUserWithEmailAndPassword(auth, email, pass); localStorage.setItem('tf:sync', '1'); },
    async reset(email) { await load(); await fb.sendPasswordResetEmail(auth, email); },
    async signOut() {
      if (!fb) return;
      await fb.signOut(auth);
      localStorage.removeItem('tf:sync');
    },
  };
})();
