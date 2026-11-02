'use strict';
/* TramaFeral — sin dependencias. */

const $ = (s) => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const SVGNS = 'http://www.w3.org/2000/svg';

const board = $('#board'), world = $('#world'), svg = $('#edges'), tempEdge = $('#temp-edge');
const plist = $('#plist'), statusEl = $('#status'), zoomEl = $('#zoom'), hint = $('#empty-hint');
const crumbsEl = $('#crumbs'), boxEl = $('#box');
const overlay = $('#overlay'), edTitle = $('#ed-title'), edBody = $('#ed-body'), colorsEl = $('#colors'), catName = $('#cat-name');

/* Categorías de nota: fondo discreto + color de la etiqueta. El gris no muestra etiqueta. */
const CATS = [
  { name: 'Sin clasificar', bg: '#222222', fg: '#8a8a8a' },
  { name: 'Conflicto',      bg: '#2e2121', fg: '#e5655d' },
  { name: 'Dato',           bg: '#1f2631', fg: '#5c9de6' },
  { name: 'Testimonio',     bg: '#1f2b22', fg: '#5cc078' },
  { name: 'Personaje',      bg: '#2a2131', fg: '#b47fdc' },
  { name: 'Rumor',          bg: '#2d2a1c', fg: '#e3c04f' },
];
const OLD_COLORS = ['#222222', '#2b2620', '#20272b', '#212a22', '#2a2128', '#2b2a1f']; // versión anterior
const catOf = (c) => CATS.find((k) => k.bg === c) || CATS[0];

const NOTE_W = 220, NOTE_H = 140, GROUP_W = 240, GROUP_H = 150, MIN_W = 140, MIN_H = 70, ZMIN = 0.1, ZMAX = 4, GAP = 80;

let projects = [];   // [{id, name, createdAt, updatedAt, subs: [{id, parent, name, count}]}]
let cur = null;      // tablero abierto: {pid, id, notes: Map, edges: Map, view: {x,y,z}}
const selected = new Set();  // notas seleccionadas
let selEdge = null;          // flecha seleccionada
let ed = null;               // editor abierto
const noteEls = new Map(), edgeEls = new Map();
let mouse = null;            // última posición del cursor sobre el lienzo

const projOf = (pid) => projects.find((p) => p.id === pid);
const subOf = (bid) => { const p = cur && projOf(cur.pid); return p && (p.subs || []).find((s) => s.id === bid); };

/* =================== Guardado automático =================== */
const pending = new Map();
let saveTimer = null;

function setStatus(t) { statusEl.textContent = t; }

function queueSave(key, getter) {
  pending.set(key, getter);
  setStatus('Guardando…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}

async function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!pending.size) return;
  const items = [...pending]; pending.clear();
  try {
    for (const [key, get] of items) await TFDB.set(key, get());
    if (!pending.size) setStatus('Guardado');
  } catch (e) {
    console.error(e);
    setStatus('Error al guardar');
    for (const [k, g] of items) if (!pending.has(k)) pending.set(k, g);
  }
}

function saveBoard() {
  if (!cur) return;
  const b = cur;
  const meta = projOf(b.pid);
  if (meta) meta.updatedAt = Date.now();
  queueSave('board:' + b.id, () => ({ notes: [...b.notes.values()], edges: [...b.edges.values()], view: b.view }));
  syncSubs();
}
function saveProjects() { queueSave('projects', () => projects); }

/* Mantiene la lista de super nodos (subcarpetas) del proyecto al día con el tablero abierto. */
function syncSubs() {
  const p = projOf(cur.pid);
  if (!p) return;
  const before = JSON.stringify(p.subs || []);
  const groups = [...cur.notes.values()].filter((n) => n.kind === 'group');
  const present = new Set(groups.map((g) => g.board));
  p.subs = p.subs || [];
  // Un super nodo borrado se oculta (no se pierde), para que Ctrl+Z pueda recuperarlo.
  for (const s of p.subs) if (s.parent === cur.id) s.gone = !present.has(s.id);
  for (const g of groups) {
    let s = p.subs.find((x) => x.id === g.board);
    if (!s) { s = { id: g.board, count: 0 }; p.subs.push(s); }
    s.parent = cur.id; s.name = g.title || 'Super nodo'; s.gone = false;
  }
  if (cur.id !== cur.pid) { const s = p.subs.find((x) => x.id === cur.id); if (s) s.count = cur.notes.size; }
  if (JSON.stringify(p.subs) !== before) { saveProjects(); renderProjects(); renderCrumbs(); }
}

window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

/* =================== Deshacer / rehacer (por tablero) =================== */
const hist = new Map();
const H = () => { let h = hist.get(cur.id); if (!h) hist.set(cur.id, (h = { u: [], r: [] })); return h; };
const snap = () => JSON.stringify({ n: [...cur.notes.values()], e: [...cur.edges.values()] });
function pushUndo(s) { const h = H(); h.u.push(s); if (h.u.length > 100) h.u.shift(); h.r.length = 0; }
function checkpoint() { pushUndo(snap()); }
function restore(s) {
  const d = JSON.parse(s);
  cur.notes = new Map(d.n.map((n) => [n.id, n]));
  cur.edges = new Map(d.e.map((e) => [e.id, e]));
  renderBoard();
  saveBoard();
}
function undo() { const h = H(); if (!h.u.length) return; h.r.push(snap()); restore(h.u.pop()); }
function redo() { const h = H(); if (!h.r.length) return; h.u.push(snap()); restore(h.r.pop()); }

/* =================== Proyectos y super nodos (panel lateral) =================== */
let plistSig = '';
function renderProjects() {
  // Si solo cambió cuál está abierto, no se redibuja (así el doble clic para renombrar no se pierde).
  const sig = JSON.stringify(projects.map((p) => [p.id, p.name, (p.subs || []).filter((s) => !s.gone).map((s) => [s.id, s.parent, s.name])]));
  if (sig === plistSig || plist.querySelector('input')) {   // nunca redibujar mientras se renombra
    for (const li of plist.children) li.classList.toggle('active', !!cur && li.dataset.bid === cur.id);
    return;
  }
  plistSig = sig;
  plist.textContent = '';
  for (const p of projects) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><button class="pren" title="Renombrar"></button><button class="pdel" title="Borrar proyecto"></button>';
    li.firstChild.textContent = p.name;
    li.dataset.pid = p.id; li.dataset.bid = p.id;
    li.title = p.name + ' (doble clic para renombrar)';
    if (cur && cur.id === p.id) li.className = 'active';
    plist.appendChild(li);
    const walk = (parent, depth) => {
      for (const s of (p.subs || []).filter((x) => x.parent === parent && !x.gone)) {
        const sl = document.createElement('li');
        sl.className = 'sub' + (cur && cur.id === s.id ? ' active' : '');
        sl.style.paddingLeft = (10 + depth * 14) + 'px';
        sl.innerHTML = '<span></span><button class="pren" title="Renombrar"></button>';
        sl.firstChild.textContent = '▣ ' + s.name;
        sl.dataset.pid = p.id; sl.dataset.bid = s.id;
        sl.title = s.name + ' (doble clic para renombrar)';
        plist.appendChild(sl);
        walk(s.id, depth + 1);
      }
    };
    walk(p.id, 1);
  }
}

plist.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li || !li.dataset.pid) return;
  if (e.target.classList.contains('pdel')) { deleteProject(li.dataset.pid); return; }
  if (e.target.classList.contains('pren')) { renameItem(li); return; }
  document.body.classList.remove('drawer');
  if (!cur || cur.id !== li.dataset.bid) openBoard(li.dataset.pid, li.dataset.bid);
});
plist.addEventListener('dblclick', (e) => {
  if (e.target.tagName === 'BUTTON') return;
  const li = e.target.closest('li');
  if (li && li.dataset.pid) renameItem(li);
});

async function createProject() {
  const p = { id: uid(), name: 'Proyecto ' + (projects.length + 1), createdAt: Date.now(), updatedAt: Date.now(), subs: [] };
  projects.push(p);
  await TFDB.set('board:' + p.id, { notes: [], edges: [], view: { x: 0, y: 0, z: 1 } });
  saveProjects();
  await openBoard(p.id, p.id);
  return p;
}
$('#new-proj').addEventListener('click', async () => {
  const p = await createProject();
  renameItem(plist.querySelector(`li[data-bid="${p.id}"]`));
});

/* Renombrar en el panel: un proyecto, o un super nodo (cambia el título de su nota). */
function renameItem(li) {
  if (!li) return;
  const pid = li.dataset.pid, bid = li.dataset.bid, p = projOf(pid);
  const isSub = bid !== pid, s = isSub && (p.subs || []).find((x) => x.id === bid);
  const inp = document.createElement('input');
  inp.value = isSub ? s.name : p.name;
  li.textContent = '';
  li.appendChild(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = async (ok) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v) {
      if (!isSub) { p.name = v; saveProjects(); }
      else await renameGroup(pid, s, v);
    }
    inp.remove(); plistSig = ''; renderProjects(); renderCrumbs();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => finish(true));
}

async function renameGroup(pid, s, name) {
  s.name = name;
  saveProjects();
  if (cur && cur.pid === pid && cur.id === s.parent) {
    const g = [...cur.notes.values()].find((n) => n.board === s.id);
    if (g) { checkpoint(); g.title = name; paintNote(g); saveBoard(); }
    return;
  }
  await flush();
  const data = await TFDB.get('board:' + s.parent);
  const g = data && data.notes.find((n) => n.board === s.id);
  if (g) { g.title = name; await TFDB.set('board:' + s.parent, data); }
}

async function deleteProject(id) {
  const p = projOf(id);
  if (!p || !confirm(`¿Estás seguro de que quieres borrar el proyecto "${p.name}"?\n\nSe borrarán todas sus notas, conexiones y super nodos.`)) return;
  for (const k of [...pending.keys()]) if (k === 'board:' + id || k.startsWith('board:' + id + '/')) pending.delete(k);
  projects = projects.filter((x) => x.id !== id);
  saveProjects();
  for (const k of await TFDB.keys()) if (k === 'board:' + id || k.startsWith('board:' + id + '/')) await TFDB.del(k);
  if (cur && cur.pid === id) {
    cur = null;
    if (projects.length) await openBoard(projects[0].id, projects[0].id);
    else { await createProject(); projects[0].name = 'Mi primer proyecto'; saveProjects(); }
  }
  renderProjects();
}

/* =================== Abrir tableros =================== */
let openSeq = 0;
async function openBoard(pid, bid, focusNoteBoard) {
  const seq = ++openSeq;
  if (ed) closeEditor();
  await flush();
  const data = (await TFDB.get('board:' + bid)) || { notes: [], edges: [], view: { x: 0, y: 0, z: 1 } };
  if (seq !== openSeq) return;           // se pidió otro tablero mientras cargaba
  for (const n of data.notes) {          // colores de la versión anterior -> categorías
    const i = OLD_COLORS.indexOf(n.color);
    if (i > 0) n.color = CATS[i].bg;
  }
  cur = {
    pid, id: bid,
    notes: new Map(data.notes.map((n) => [n.id, n])),
    edges: new Map(data.edges.map((e) => [e.id, e])),
    view: data.view || { x: 0, y: 0, z: 1 },
  };
  renderBoard();
  applyView();
  renderProjects();
  renderCrumbs();
  if (focusNoteBoard) {                  // al volver de un super nodo, dejarlo seleccionado
    const g = [...cur.notes.values()].find((n) => n.board === focusNoteBoard);
    if (g) selectOnly(g.id);
  }
  queueSave('last', () => ({ pid, bid }));
  if (!isTyping()) board.focus();       // no quitarle el foco a un nombre que se está escribiendo
}
const openProject = (pid) => openBoard(pid, pid);

function renderBoard() {
  clearSel();
  for (const el of noteEls.values()) el.remove();
  for (const g of edgeEls.values()) g.remove();
  noteEls.clear(); edgeEls.clear();
  for (const n of cur.notes.values()) addNoteEl(n);
  for (const e of cur.edges.values()) addEdgeEl(e);
  updateHint();
}

/* Ruta: Proyecto › Super nodo › … */
function boardPath() {
  const p = projOf(cur.pid), path = [];
  let id = cur.id;
  while (id && id !== cur.pid) {
    const s = (p.subs || []).find((x) => x.id === id);
    if (!s) break;
    path.unshift({ id, name: s.name });
    id = s.parent;
  }
  path.unshift({ id: cur.pid, name: p.name });
  return path;
}
function renderCrumbs() {
  if (!cur) return;
  const path = boardPath();
  crumbsEl.textContent = '';
  crumbsEl.hidden = path.length < 2;
  path.forEach((c, i) => {
    if (i) crumbsEl.append(' › ');
    const b = document.createElement(i === path.length - 1 ? 'span' : 'button');
    b.textContent = c.name;
    if (i < path.length - 1) b.onclick = () => openBoard(cur.pid, c.id, path[i + 1].id);
    crumbsEl.appendChild(b);
  });
  if (path.length > 1) crumbsEl.append(Object.assign(document.createElement('em'), { textContent: 'Ctrl + Q para volver' }));
}

function goUp() {
  if (!cur || cur.id === cur.pid) return;
  const s = subOf(cur.id);
  openBoard(cur.pid, s ? s.parent : cur.pid, cur.id);
}

function enterGroup(g) { openBoard(cur.pid, g.board); }

/* =================== Vista: zoom, desplazamiento, cuadrícula =================== */
function applyView() {
  const v = cur.view;
  world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
  let s = 24 * v.z;
  while (s < 12) s *= 5;               // la cuadrícula se adapta al zoom
  const S = s * 5, pos = `${v.x}px ${v.y}px`;
  board.style.backgroundSize = `${S}px ${S}px, ${S}px ${S}px, ${s}px ${s}px, ${s}px ${s}px`;
  board.style.backgroundPosition = `${pos}, ${pos}, ${pos}, ${pos}`;
  zoomEl.textContent = Math.round(v.z * 100) + '%';
  board.classList.toggle('far', v.z < 0.35);
}

function viewChanged() {
  applyView();
  queueSave('board:' + cur.id, ((b) => () => ({ notes: [...b.notes.values()], edges: [...b.edges.values()], view: b.view }))(cur));
}

function toWorld(sx, sy) {
  const v = cur.view;
  return { x: (sx - v.x) / v.z, y: (sy - v.y) / v.z };
}
function boardPoint(e) {
  const r = board.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function zoomAt(sx, sy, z) {
  const v = cur.view;
  z = Math.min(ZMAX, Math.max(ZMIN, z));
  const w = toWorld(sx, sy);
  v.z = z; v.x = sx - w.x * z; v.y = sy - w.y * z;
  viewChanged();
}

board.addEventListener('wheel', (e) => {
  if (!cur) return;
  e.preventDefault();
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  const p = boardPoint(e);
  zoomAt(p.x, p.y, cur.view.z * Math.exp(-dy * 0.0015));
}, { passive: false });

function bbox(list) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of list) {
    x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
    x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h);
  }
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

function fitAll() {
  if (!cur || !cur.notes.size) return;
  const b = bbox(cur.notes.values());
  const pad = 60, W = board.clientWidth, H = board.clientHeight;
  const z = Math.min(ZMAX, Math.max(ZMIN, Math.min(W / (b.x2 - b.x1 + pad * 2), H / (b.y2 - b.y1 + pad * 2), 1.5)));
  const v = cur.view;
  v.z = z; v.x = W / 2 - b.cx * z; v.y = H / 2 - b.cy * z;
  viewChanged();
}
$('#fit').addEventListener('click', fitAll);

/* =================== Notas =================== */
function addNoteEl(n) {
  const el = document.createElement('div');
  el.className = 'note' + (n.kind === 'group' ? ' group' : '');
  el.dataset.id = n.id;
  el.innerHTML = '<div class="n-head"><div class="n-title"></div><span class="n-cat"></span></div><div class="n-body"></div>' +
    (n.kind === 'group' ? '<button class="g-open" title="Entrar (doble clic)">Abrir ›</button>' : '') +
    '<i class="port" data-side="t"></i><i class="port" data-side="r"></i>' +
    '<i class="port" data-side="b"></i><i class="port" data-side="l"></i>' +
    '<i class="rs rs-r" data-rs="r"></i><i class="rs rs-b" data-rs="b"></i><i class="rs rs-br" data-rs="br"></i>';
  el._t = el.querySelector('.n-title'); el._c = el.querySelector('.n-cat'); el._b = el.querySelector('.n-body');
  world.appendChild(el);
  noteEls.set(n.id, el);
  paintNote(n);
  placeNote(n);
}

function paintNote(n) {
  const el = noteEls.get(n.id), cat = catOf(n.color);
  el._t.textContent = n.title || (n.kind === 'group' ? 'Super nodo' : 'Sin título');
  el._b.textContent = n.body;
  if (n.kind === 'group') {
    const s = subOf(n.board), c = s ? s.count : 0;
    el._c.textContent = 'Super nodo · ' + c + (c === 1 ? ' nota' : ' notas');
  } else el._c.textContent = cat === CATS[0] ? '' : cat.name;
  el.style.setProperty('--nc', cat.bg);
  el.style.setProperty('--cc', cat.fg);
}
function placeNote(n) {
  const el = noteEls.get(n.id);
  el.style.transform = `translate(${n.x}px,${n.y}px)`;
  el.style.width = n.w + 'px';
  el.style.height = n.h + 'px';
}

function createNote(pos, color) {
  const n = { id: uid(), x: Math.round(pos.x), y: Math.round(pos.y), w: NOTE_W, h: NOTE_H, title: '', body: '', color: color || CATS[0].bg };
  cur.notes.set(n.id, n);
  addNoteEl(n);
  updateHint();
  saveBoard();
  return n;
}

/* Quita la nota sin tocar las flechas de otras notas. */
function removeNoteRaw(id) {
  for (const e of [...cur.edges.values()]) if (e.from === id || e.to === id) deleteEdge(e.id, true);
  cur.notes.delete(id);
  noteEls.get(id).remove();
  noteEls.delete(id);
  selected.delete(id);
}

/* Borra la nota; si estaba en medio de una cadena, une lo anterior con lo siguiente (como Resolve). */
function deleteNote(id) {
  if (!cur.notes.has(id)) return;
  extractNote(id);
  removeNoteRaw(id);
  updateHint();
  saveBoard();
}

function updateHint() { hint.hidden = !!(cur && cur.notes.size); }

/* ---- Selección ---- */
function clearSel() {
  for (const id of selected) { const el = noteEls.get(id); if (el) el.classList.remove('sel'); }
  selected.clear();
  if (selEdge && edgeEls.get(selEdge)) edgeEls.get(selEdge).classList.remove('sel');
  selEdge = null;
}
function selectOnly(id) { clearSel(); addSel(id); }
function addSel(id) { selected.add(id); const el = noteEls.get(id); if (el) el.classList.add('sel'); }
function toggleSel(id) {
  if (selEdge) { if (edgeEls.get(selEdge)) edgeEls.get(selEdge).classList.remove('sel'); selEdge = null; }
  if (selected.has(id)) { selected.delete(id); noteEls.get(id).classList.remove('sel'); } else addSel(id);
}
function selectEdge(id) { clearSel(); selEdge = id; edgeEls.get(id).classList.add('sel'); }
const selOne = () => (selected.size === 1 ? [...selected][0] : null);
/* Compatibilidad: select('note', id) | select('edge', id) | select(null) */
function select(type, id) { if (!id) clearSel(); else if (type === 'edge') selectEdge(id); else selectOnly(id); }

/* Posición para una nota nueva: bajo el cursor si está en el lienzo; si no, en el centro. */
function newNotePos() {
  const p = mouse || { x: board.clientWidth / 2, y: board.clientHeight / 2 };
  const w = toWorld(p.x, p.y);
  return { x: w.x - NOTE_W / 2, y: w.y - NOTE_H / 2 };
}

/* =================== Conexiones =================== */
function edgeGeom(a, b) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  let s, t, ds, dt;
  if (b.x >= a.x + a.w + 16)      { s = { x: a.x + a.w, y: ac.y }; t = { x: b.x, y: bc.y };       ds = [1, 0];  dt = [-1, 0]; }
  else if (b.x + b.w <= a.x - 16) { s = { x: a.x, y: ac.y };       t = { x: b.x + b.w, y: bc.y }; ds = [-1, 0]; dt = [1, 0]; }
  else if (bc.y >= ac.y)          { s = { x: ac.x, y: a.y + a.h }; t = { x: bc.x, y: b.y };       ds = [0, 1];  dt = [0, -1]; }
  else                            { s = { x: ac.x, y: a.y };       t = { x: bc.x, y: b.y + b.h }; ds = [0, -1]; dt = [0, 1]; }
  const k = Math.min(160, Math.max(30, Math.hypot(t.x - s.x, t.y - s.y) * 0.45));
  return { s, c1: { x: s.x + ds[0] * k, y: s.y + ds[1] * k }, c2: { x: t.x + dt[0] * k, y: t.y + dt[1] * k }, t };
}
function edgePath(a, b) {
  const g = edgeGeom(a, b);
  return `M${g.s.x},${g.s.y} C${g.c1.x},${g.c1.y} ${g.c2.x},${g.c2.y} ${g.t.x},${g.t.y}`;
}
const ptBox = (p) => ({ x: p.x, y: p.y, w: 0, h: 0 });

/* ¿La curva de la conexión pasa por dentro de la nota n? Devuelve la distancia al centro, o Infinity. */
function edgeCrossesNote(e, n) {
  const a = cur.notes.get(e.from), b = cur.notes.get(e.to);
  if (!a || !b) return Infinity;
  const { s, c1, c2, t } = edgeGeom(a, b);
  const mx = n.w * 0.15, my = n.h * 0.15, cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  let best = Infinity;
  for (let i = 1; i < 24; i++) {
    const u = i / 24, v = 1 - u;
    const x = v * v * v * s.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u * u * u * t.x;
    const y = v * v * v * s.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u * u * u * t.y;
    if (x > n.x + mx && x < n.x + n.w - mx && y > n.y + my && y < n.y + n.h - my)
      best = Math.min(best, Math.hypot(x - cx, y - cy));
  }
  return best;
}

function addEdgeEl(e) {
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', 'edge');
  g.dataset.id = e.id;
  const hit = document.createElementNS(SVGNS, 'path'); hit.setAttribute('class', 'hit');
  const ln = document.createElementNS(SVGNS, 'path');  ln.setAttribute('class', 'ln');
  g.append(hit, ln);
  svg.insertBefore(g, tempEdge);
  edgeEls.set(e.id, g);
  routeEdge(e);
}

function routeEdge(e) {
  const g = edgeEls.get(e.id), a = cur.notes.get(e.from), b = cur.notes.get(e.to);
  if (!g || !a || !b) return;
  const d = edgePath(a, b);
  g.children[0].setAttribute('d', d);
  g.children[1].setAttribute('d', d);
}

function routeEdgesOf(ids) {
  if (typeof ids === 'string') ids = new Set([ids]);
  for (const e of cur.edges.values()) if (ids.has(e.from) || ids.has(e.to)) routeEdge(e);
}
const hasEdges = (id) => { for (const e of cur.edges.values()) if (e.from === id || e.to === id) return true; return false; };

function connect(from, to, silent) {
  if (!from || !to || from === to) return;
  for (const e of cur.edges.values()) if (e.from === from && e.to === to) return;
  const e = { id: uid(), from, to };
  cur.edges.set(e.id, e);
  addEdgeEl(e);
  if (!silent) saveBoard();
}

function deleteEdge(id, silent) {
  if (!cur.edges.delete(id)) return;
  edgeEls.get(id).remove();
  edgeEls.delete(id);
  if (selEdge === id) selEdge = null;
  if (!silent) saveBoard();
}

/* Inserta la nota n en la conexión A→B: A→n→B, y la centra entre A y B. */
function insertIntoEdge(n, e) {
  const a = cur.notes.get(e.from), b = cur.notes.get(e.to);
  deleteEdge(e.id, true);
  n.x = Math.round((a.x + a.w / 2 + b.x + b.w / 2) / 2 - n.w / 2);
  n.y = Math.round((a.y + a.h / 2 + b.y + b.h / 2) / 2 - n.h / 2);
  placeNote(n);
  connect(a.id, n.id, true);
  connect(n.id, b.id, true);
  saveBoard();
}

/* Saca la nota de la cadena y une lo anterior con lo siguiente (como Shift+arrastrar en Resolve). */
function extractNote(id) {
  const ins = [], outs = [];
  for (const e of [...cur.edges.values()]) {
    if (e.to === id) { ins.push(e.from); deleteEdge(e.id, true); }
    else if (e.from === id) { outs.push(e.to); deleteEdge(e.id, true); }
  }
  for (const a of ins) for (const b of outs) connect(a, b, true);
}

/* Como "Añadir nodo en serie" (Alt+S) de Resolve: la nota nueva va a la derecha de a,
   conectada a→n; si a ya iba hacia otras notas, n queda en medio y lo de después se aparta. */
function addAfter(a, n) {
  n.x = a.x + a.w + GAP;
  n.y = Math.round(a.y + a.h / 2 - n.h / 2);
  const outs = [...cur.edges.values()].filter((e) => e.from === a.id);
  if (outs.length) {
    const minX = Math.min(...outs.map((e) => cur.notes.get(e.to).x));
    const shift = n.x + n.w + GAP - minX;
    if (shift > 0 && minX > a.x) {
      const seen = new Set([a.id, n.id]), stack = outs.map((e) => e.to);
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        const m = cur.notes.get(id);
        m.x += shift; placeNote(m);
        for (const e of cur.edges.values()) if (e.from === id) stack.push(e.to);
      }
    }
    for (const e of outs) { deleteEdge(e.id, true); connect(n.id, e.to, true); }
  }
  placeNote(n);
  connect(a.id, n.id, true);
  for (const e of cur.edges.values()) routeEdge(e);
  saveBoard();
}

/* =================== Super nodos =================== */
/* Ctrl+A con 2 o más notas seleccionadas: las mete en un tablero nuevo, con sus conexiones. */
async function groupSelected() {
  if (selected.size < 2) return;
  checkpoint();
  const ids = new Set(selected);
  const inner = [...ids].map((id) => cur.notes.get(id));
  const innerEdges = [], outside = [];
  for (const e of cur.edges.values()) {
    const a = ids.has(e.from), b = ids.has(e.to);
    if (a && b) innerEdges.push(e); else if (a || b) outside.push(e);
  }
  const bid = cur.pid + '/' + uid();
  const bb = bbox(inner), W = board.clientWidth, Hh = board.clientHeight;
  const view = { x: Math.round(W / 2 - bb.cx), y: Math.round(Hh / 2 - bb.cy), z: 1 };
  await TFDB.set('board:' + bid, JSON.parse(JSON.stringify({ notes: inner, edges: innerEdges, view })));
  // Los super nodos que entran en el nuevo pasan a colgar de él.
  const p = projOf(cur.pid);
  for (const n of inner) if (n.kind === 'group') { const s = (p.subs || []).find((x) => x.id === n.board); if (s) s.parent = bid; }
  p.subs = p.subs || [];
  p.subs.push({ id: bid, parent: cur.id, name: 'Super nodo', count: inner.length });
  const g = { id: uid(), kind: 'group', board: bid, title: 'Super nodo', body: '', color: CATS[0].bg,
    x: Math.round(bb.cx - GROUP_W / 2), y: Math.round(bb.cy - GROUP_H / 2), w: GROUP_W, h: GROUP_H };
  for (const id of ids) removeNoteRaw(id);
  cur.notes.set(g.id, g);
  addNoteEl(g);
  for (const e of outside) {
    if (ids.has(e.from)) connect(g.id, e.to, true); else connect(e.from, g.id, true);
  }
  selectOnly(g.id);
  saveBoard();
  openEditor(g, true);   // para ponerle nombre enseguida
}

/* Copia profunda de un tablero y de todos los super nodos que contiene. */
async function loadTree(bid) {
  const data = (await TFDB.get('board:' + bid)) || { notes: [], edges: [], view: { x: 0, y: 0, z: 1 } };
  const kids = {};
  for (const n of data.notes) if (n.kind === 'group') kids[n.board] = await loadTree(n.board);
  return { data, kids };
}
async function writeTree(tree, bid, p) {
  const data = JSON.parse(JSON.stringify(tree.data));
  for (const n of data.notes) {
    if (n.kind !== 'group') continue;
    const nb = p.id + '/' + uid();
    const kid = tree.kids[n.board] || { data: { notes: [], edges: [], view: { x: 0, y: 0, z: 1 } }, kids: {} };
    await writeTree(kid, nb, p);
    p.subs.push({ id: nb, parent: bid, name: n.title || 'Super nodo', count: kid.data.notes.length });
    n.board = nb;
  }
  await TFDB.set('board:' + bid, data);
}

/* =================== Portapapeles =================== */
let clip = null;
function copySelection() {
  if (!selected.size) return;
  const ids = new Set(selected);
  const notes = [...ids].map((id) => JSON.parse(JSON.stringify(cur.notes.get(id))));
  const edges = [...cur.edges.values()].filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ ...e }));
  const c = { notes, edges, trees: {} };
  c.ready = (async () => {
    await flush();
    for (const n of notes) if (n.kind === 'group') c.trees[n.board] = await loadTree(n.board);
  })();
  clip = c;
  const text = notes.map((n) => n.title + (n.body ? '\n\n' + n.body : '')).join('\n\n---\n\n');
  try { navigator.clipboard.writeText(text).catch(() => {}); } catch (e) {}
}

async function pasteClip() {
  const c = clip;
  await c.ready;
  checkpoint();
  const p = projOf(cur.pid);
  p.subs = p.subs || [];
  const idMap = new Map(), made = [];
  const bb = bbox(c.notes), m = newNotePos(), dx = m.x + NOTE_W / 2 - bb.cx, dy = m.y + NOTE_H / 2 - bb.cy;
  for (const src of c.notes) {
    const n = { ...src, id: uid(), x: Math.round(src.x + dx), y: Math.round(src.y + dy) };
    if (n.kind === 'group') {
      n.board = cur.pid + '/' + uid();
      const tree = c.trees[src.board] || { data: { notes: [], edges: [], view: { x: 0, y: 0, z: 1 } }, kids: {} };
      await writeTree(tree, n.board, p);
      p.subs.push({ id: n.board, parent: cur.id, name: n.title || 'Super nodo', count: tree.data.notes.length });
    }
    idMap.set(src.id, n.id);
    cur.notes.set(n.id, n);
    addNoteEl(n);
    made.push(n);
  }
  for (const e of c.edges) connect(idMap.get(e.from), idMap.get(e.to), true);
  // Una sola nota: igual que Ctrl+S (a la derecha de la seleccionada, o en medio de la flecha seleccionada).
  if (made.length === 1) {
    const one = selOne();
    if (one && cur.notes.has(one)) addAfter(cur.notes.get(one), made[0]);
    else if (selEdge && cur.edges.has(selEdge)) insertIntoEdge(made[0], cur.edges.get(selEdge));
  }
  clearSel();
  for (const n of made) addSel(n.id);
  updateHint();
  saveBoard();
  saveProjects();
}

function deleteSelection(ask) {
  if (!selected.size) return;
  const list = [...selected].map((id) => cur.notes.get(id));
  if (ask) {
    const groups = list.filter((n) => n.kind === 'group').length;
    const msg = list.length === 1
      ? `¿Eliminar ${groups ? 'el super nodo' : 'la nota'} "${list[0].title || 'Sin título'}"?` + (groups ? '\n\nSe eliminará con todas las notas que contiene.' : '')
      : `¿Eliminar ${list.length} notas?` + (groups ? `\n\nIncluye ${groups} super nodo(s) con todo su contenido.` : '');
    if (!confirm(msg)) return;
  }
  checkpoint();
  for (const n of list) deleteNote(n.id);
}

/* =================== Ratón =================== */
let drag = null; // {mode: 'pan'|'box'|'move'|'resize'|'connect'|'edge', ...}

board.addEventListener('pointermove', (e) => { mouse = boardPoint(e); });
board.addEventListener('pointerleave', () => { mouse = null; });
board.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---- Táctil: dedos activos, pellizco, doble toque, mantener pulsado ---- */
const touches = new Map();
let multi = false;          // modo "Varios" (equivale a mantener Ctrl)
let lastTap = null, pressTimer = null;
const isTouch = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';

function setMulti(on) {
  multi = on;
  $('#multi-btn').classList.toggle('on', on);
  $('#multi-btn').firstChild.textContent = on ? '☑' : '☐';
}

function startPinch() {
  const [a, b] = [...touches.values()];
  if (drag && drag.mode !== 'pinch') endDrag(null, true);
  clearTimeout(pressTimer);
  drag = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { ...cur.view } };
}

board.addEventListener('pointerdown', (e) => {
  if (!cur || e.target.closest('#mbar, #toolbar, #crumbs')) return;   // botones encima del lienzo
  if (isTouch(e)) {
    touches.set(e.pointerId, boardPoint(e));
    if (touches.size === 2) { startPinch(); return; }
    if (touches.size > 2) return;
  }
  if (drag) return;
  board.focus({ preventScroll: true });
  const p = boardPoint(e), mod = e.ctrlKey || e.metaKey || multi;
  const onNote = e.target.closest('.note'), onEdge = e.target.closest('.edge');

  if (e.button === 0 && !onNote && !onEdge && mod) {   // Ctrl + arrastrar en vacío: selección por área
    e.preventDefault();
    drag = { mode: 'box', sx: p.x, sy: p.y, base: new Set(selected) };
    return;
  }
  if (e.button === 1 || (e.button === 0 && !onNote && !onEdge)) {
    e.preventDefault();
    if (e.button === 0) clearSel();
    drag = { mode: 'pan', sx: p.x, sy: p.y, vx: cur.view.x, vy: cur.view.y };
    board.classList.add('panning');
    return;
  }
  if (e.button !== 0) return;

  if (onEdge) {
    selectEdge(onEdge.dataset.id);
    drag = { mode: 'edge', id: onEdge.dataset.id, sx: p.x, sy: p.y, snap: snap() };
    return;
  }

  const n = cur.notes.get(onNote.dataset.id);
  if (e.target.classList.contains('g-open')) { enterGroup(n); return; }
  if (mod && n.kind === 'group' && !multi) { e.preventDefault(); selectOnly(n.id); setTimeout(() => openEditor(n)); return; } // Ctrl + clic en super nodo: editar nombre y texto
  if (mod) { toggleSel(n.id); return; }                // Ctrl + clic: sumar / quitar de la selección
  if (!selected.has(n.id)) selectOnly(n.id);

  if (e.target.classList.contains('port')) {
    selectOnly(n.id);
    startConnect(n.id, 'from', null, p);
    drag.snap = snap();
  } else if (e.target.dataset.rs) {
    selectOnly(n.id);
    drag = { mode: 'resize', n, rs: e.target.dataset.rs, sx: p.x, sy: p.y, w: n.w, h: n.h, moved: false, snap: snap() };
  } else {
    const items = [...selected].map((id) => { const m = cur.notes.get(id); return { n: m, x: m.x, y: m.y }; });
    drag = { mode: 'move', n, items, ids: new Set(selected), sx: p.x, sy: p.y, moved: false, dropEdge: null, snap: snap(),
      touch: isTouch(e), t0: Date.now() };
    if (isTouch(e)) {                                   // mantener pulsado: modo "Varios" y seleccionar
      const d = drag;
      pressTimer = setTimeout(() => {
        if (drag !== d || d.moved) return;
        drag = null;
        setMulti(true);
        addSel(n.id);
      }, 550);
    }
  }
});

/* Conexión en curso: 'fixed' es la nota que queda anclada; role indica si es el origen o el destino. */
function startConnect(fixed, role, orig, p) {
  const s = drag && drag.snap;
  drag = { mode: 'connect', fixed, role, orig, target: null, snap: s };
  board.classList.add('connecting');
  updateTemp(p);
}

function updateTemp(p) {
  const f = cur.notes.get(drag.fixed);
  const other = drag.target ? cur.notes.get(drag.target) : ptBox(toWorld(p.x, p.y));
  tempEdge.setAttribute('d', drag.role === 'from' ? edgePath(f, other) : edgePath(other, f));
}

function setDropEdge(id) {
  if (drag.dropEdge === id) return;
  if (drag.dropEdge && edgeEls.get(drag.dropEdge)) edgeEls.get(drag.dropEdge).classList.remove('drop');
  if (id) edgeEls.get(id).classList.add('drop');
  drag.dropEdge = id;
}

window.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, boardPoint(e));
  if (!drag) return;
  const p = boardPoint(e), z = cur.view.z;
  if (drag.mode === 'pinch') {
    if (touches.size < 2) return;
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const nz = Math.min(ZMAX, Math.max(ZMIN, drag.v0.z * d / drag.d0));
    const w = { x: (drag.m0.x - drag.v0.x) / drag.v0.z, y: (drag.m0.y - drag.v0.y) / drag.v0.z };
    cur.view.z = nz; cur.view.x = m.x - w.x * nz; cur.view.y = m.y - w.y * nz;
    applyView();
    return;
  }
  if (drag.mode === 'move' && !drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 6) clearTimeout(pressTimer);
  if (drag.mode === 'pan') {
    cur.view.x = drag.vx + p.x - drag.sx;
    cur.view.y = drag.vy + p.y - drag.sy;
    applyView();
    drag.moved = true;
  } else if (drag.mode === 'box') {
    const x1 = Math.min(p.x, drag.sx), y1 = Math.min(p.y, drag.sy), x2 = Math.max(p.x, drag.sx), y2 = Math.max(p.y, drag.sy);
    Object.assign(boxEl.style, { left: x1 + 'px', top: y1 + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
    boxEl.hidden = false;
    const a = toWorld(x1, y1), b = toWorld(x2, y2);
    clearSel();
    for (const id of drag.base) addSel(id);
    for (const n of cur.notes.values())
      if (n.x < b.x && n.x + n.w > a.x && n.y < b.y && n.y + n.h > a.y) addSel(n.id);
  } else if (drag.mode === 'move') {
    const dx = (p.x - drag.sx) / z, dy = (p.y - drag.sy) / z;
    if (!drag.moved) {
      if (Math.abs(dx) * z < 3 && Math.abs(dy) * z < 3) return; // evita mover por un clic
      drag.moved = true;
      if (drag.items.length === 1) {
        if (e.shiftKey && hasEdges(drag.n.id)) extractNote(drag.n.id);
        drag.free = !hasEdges(drag.n.id);  // solo una nota suelta se puede insertar en una conexión
      }
    }
    for (const it of drag.items) { it.n.x = Math.round(it.x + dx); it.n.y = Math.round(it.y + dy); placeNote(it.n); }
    routeEdgesOf(drag.ids);
    if (drag.free) {
      let best = null, bd = Infinity;
      for (const ed of cur.edges.values()) {
        const d = edgeCrossesNote(ed, drag.n);
        if (d < bd) { bd = d; best = ed.id; }
      }
      setDropEdge(best);
    }
  } else if (drag.mode === 'resize') {
    const dx = (p.x - drag.sx) / z, dy = (p.y - drag.sy) / z;
    if (drag.rs !== 'b') drag.n.w = Math.max(MIN_W, Math.round(drag.w + dx));
    if (drag.rs !== 'r') drag.n.h = Math.max(MIN_H, Math.round(drag.h + dy));
    drag.moved = true;
    placeNote(drag.n);
    routeEdgesOf(drag.n.id);
  } else if (drag.mode === 'edge') {
    // Arrastrar una flecha la suelta por el extremo más cercano al punto donde se agarró.
    if (Math.hypot(p.x - drag.sx, p.y - drag.sy) < 4) return;
    const e0 = cur.edges.get(drag.id);
    const g = edgeGeom(cur.notes.get(e0.from), cur.notes.get(e0.to));
    const w = toWorld(drag.sx, drag.sy);
    const nearEnd = Math.hypot(w.x - g.t.x, w.y - g.t.y) <= Math.hypot(w.x - g.s.x, w.y - g.s.y);
    deleteEdge(e0.id, true);
    if (nearEnd) startConnect(e0.from, 'from', e0, p);
    else startConnect(e0.to, 'to', e0, p);
  } else if (drag.mode === 'connect') {
    const hitEl = document.elementFromPoint(e.clientX, e.clientY);
    const tEl = hitEl && hitEl.closest('.note');
    const tid = tEl && tEl.dataset.id !== drag.fixed ? tEl.dataset.id : null;
    if (tid !== drag.target) {
      if (drag.target && noteEls.get(drag.target)) noteEls.get(drag.target).classList.remove('target');
      if (tid) tEl.classList.add('target');
      drag.target = tid;
    }
    updateTemp(p);
  }
});

function pointerEnd(e, cancel) {
  clearTimeout(pressTimer);
  const wasPinch = drag && drag.mode === 'pinch';
  touches.delete(e.pointerId);
  if (wasPinch) { if (touches.size < 2) { drag = null; viewChanged(); } return; }
  endDrag(e, cancel);
}
window.addEventListener('pointerup', (e) => pointerEnd(e, false));
window.addEventListener('pointercancel', (e) => pointerEnd(e, true));
window.addEventListener('blur', () => endDrag(null, true));

function endDrag(e, cancel) {
  if (!drag) return;
  const d = drag; drag = null;
  board.classList.remove('panning', 'connecting');
  boxEl.hidden = true;
  if (d.mode === 'pan' && d.moved) viewChanged();
  else if (d.mode === 'resize' && d.moved) saveBoard();
  else if (d.mode === 'move' && !d.moved && !cancel && d.n.kind === 'group' && e && e.button === 0) {
    enterGroup(d.n);                                   // clic (sin arrastrar) en un super nodo: entrar
  } else if (d.mode === 'move' && !d.moved && !cancel && d.touch && Date.now() - d.t0 < 300) {
    const now = Date.now();                            // doble toque en una nota: editar
    if (lastTap && lastTap.id === d.n.id && now - lastTap.t < 400) { lastTap = null; selectOnly(d.n.id); openEditor(d.n); }
    else lastTap = { id: d.n.id, t: now };
  } else if (d.mode === 'move' && d.moved) {
    if (d.dropEdge && edgeEls.get(d.dropEdge)) {
      edgeEls.get(d.dropEdge).classList.remove('drop');
      if (!cancel) insertIntoEdge(d.n, cur.edges.get(d.dropEdge));
    }
    saveBoard();
  } else if (d.mode === 'connect') {
    tempEdge.setAttribute('d', '');
    if (d.target && noteEls.get(d.target)) noteEls.get(d.target).classList.remove('target');
    if (cancel && d.orig) connect(d.orig.from, d.orig.to);           // Esc: se restaura la flecha original
    else if (!cancel && d.target) {
      if (d.role === 'from') connect(d.fixed, d.target); else connect(d.target, d.fixed);
    } else if (d.orig) saveBoard();                                  // soltada en vacío: queda desconectada
  }
  if (d.snap && snap() !== d.snap) pushUndo(d.snap);
}

board.addEventListener('dblclick', (e) => {
  const el = e.target.closest('.note');
  if (!el || e.target.classList.contains('port') || e.ctrlKey || e.metaKey) return;
  const n = cur.notes.get(el.dataset.id);
  if (n.kind === 'group') enterGroup(n); else openEditor(n);
});

/* =================== Editor =================== */
CATS.forEach((c) => {
  const b = document.createElement('button');
  b.style.background = c.bg; b.style.borderColor = c.fg; b.dataset.c = c.bg; b.tabIndex = -1; b.title = c.name;
  colorsEl.appendChild(b);
});
colorsEl.addEventListener('mousedown', (e) => e.preventDefault()); // no robar el foco del texto
colorsEl.addEventListener('click', (e) => {
  const c = e.target.dataset.c;
  if (!c || !ed) return;
  ed.color = c;
  markColor(c);
  if (ed.id) { const n = cur.notes.get(ed.id); n.color = c; paintNote(n); saveBoard(); }
});
function markColor(c) {
  for (const b of colorsEl.children) b.classList.toggle('on', b.dataset.c === c);
  const k = catOf(c);
  catName.textContent = k.name;
  catName.style.color = k.fg;
}

function openEditor(note, selectTitle) {
  if (ed) return;
  ed = note
    ? { id: note.id, isNew: false, color: note.color || CATS[0].bg, snap: snap() }
    : { id: null, isNew: true, pos: newNotePos(), color: CATS[0].bg, snap: snap(),
        after: selOne(),     // nota seleccionada: la nueva va después
        onEdge: selEdge };   // flecha seleccionada: la nueva va en medio
  edTitle.value = note ? note.title : '';
  edBody.value = note ? note.body : '';
  edTitle.placeholder = note && note.kind === 'group' ? 'Nombre del super nodo' : 'Título';
  markColor(ed.color);
  overlay.hidden = false;
  if (selectTitle || (note && note.kind === 'group')) { edTitle.focus(); edTitle.select(); return; }
  (note && note.title ? edBody : edTitle).focus();
  if (note) edBody.setSelectionRange(edBody.value.length, edBody.value.length);
}

function editorInput() {
  if (!ed) return;
  if (!ed.id) {
    if (!edTitle.value && !edBody.value) return;
    const n = createNote(ed.pos, ed.color);    // la nota existe y se guarda desde la primera tecla
    ed.id = n.id;
    if (ed.after && cur.notes.has(ed.after)) addAfter(cur.notes.get(ed.after), n);
    else if (ed.onEdge && cur.edges.has(ed.onEdge)) insertIntoEdge(n, cur.edges.get(ed.onEdge));
  }
  const n = cur.notes.get(ed.id);
  n.title = edTitle.value;
  n.body = edBody.value;
  paintNote(n);
  saveBoard();
}
edTitle.addEventListener('input', editorInput);
edBody.addEventListener('input', editorInput);

function closeEditor() {
  if (!ed) return;
  const { id, isNew, snap: before } = ed;
  ed = null;
  overlay.hidden = true;
  if (id) {
    const n = cur.notes.get(id);
    if (isNew && n && !n.title.trim() && !n.body.trim()) deleteNote(id);
    else selectOnly(id);
  }
  if (snap() !== before) pushUndo(before);
  flush();
  board.focus({ preventScroll: true });
}

edTitle.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault(); e.stopPropagation();
  if (e.ctrlKey || e.metaKey) {           // Ctrl+Enter: pasar al cuerpo
    edBody.focus();
    edBody.setSelectionRange(edBody.value.length, edBody.value.length);
  } else closeEditor();                   // Enter: guardar y cerrar
});
edBody.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); closeEditor(); }
});
overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeEditor(); });

/* =================== Teclado =================== */
const isTyping = () => {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
};

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === 's') {
    e.preventDefault();                 // evita el "Guardar página" del navegador
    if (ed) { flush(); return; }        // en el editor: solo fuerza el guardado
    if (isTyping() || !cur) return;     // nunca interceptar mientras se escribe
    openEditor(null);
    return;
  }
  if (e.key === 'Escape') {
    if (ed) { e.preventDefault(); closeEditor(); }
    else if (drag && drag.mode === 'connect') endDrag(null, true);
    else if (!isTyping()) clearSel();
    return;
  }
  if (ed || isTyping() || !cur || (drag && drag.mode !== 'pan')) return;

  if ((e.key === 'Delete' || e.key === 'Backspace') && (selected.size || selEdge)) {
    e.preventDefault();
    if (selEdge) { checkpoint(); deleteEdge(selEdge); }
    else deleteSelection(true);
  } else if (mod && (key === 'z' || key === 'y')) {
    e.preventDefault();
    if (key === 'y' || e.shiftKey) redo(); else undo();
  } else if (mod && (key === 'x' || key === 'c') && selected.size) {
    e.preventDefault();
    copySelection();
    if (key === 'x') deleteSelection(false);
  } else if (mod && key === 'v' && clip) {
    e.preventDefault();
    pasteClip();
  } else if (mod && key === 'a') {
    e.preventDefault();
    groupSelected();
  } else if (mod && key === 'q') {
    e.preventDefault();
    goUp();
  } else if (e.key === 'Enter' && selOne()) {
    e.preventDefault();
    openEditor(cur.notes.get(selOne()));
  } else if (key === 'f' && !mod) {
    fitAll();
  }
});

/* =================== Barra táctil =================== */
/* Se actúa al levantar el dedo (más fiable que "click" en táctil); si el dedo se desliza, es para desplazar la barra. */
let mbarDown = null;
$('#mbar').addEventListener('pointerdown', (e) => { mbarDown = { b: e.target.closest('button'), x: e.clientX, y: e.clientY }; });
$('#mbar').addEventListener('pointerup', (e) => {
  const d = mbarDown; mbarDown = null;
  const b = e.target.closest('button');
  if (!d || d.b !== b || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
  mbarAction(b);
});
function mbarAction(b) {
  if (!b || !cur || ed) return;
  const one = selOne();
  switch (b.dataset.a) {
    case 'menu': document.body.classList.toggle('drawer'); break;
    case 'note': openEditor(null); break;
    case 'edit': if (one) openEditor(cur.notes.get(one)); break;
    case 'multi': setMulti(!multi); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'cut': if (selected.size) { copySelection(); deleteSelection(false); } break;
    case 'copy': copySelection(); break;
    case 'paste': if (clip) pasteClip(); break;
    case 'group': groupSelected(); setMulti(false); break;
    case 'up': goUp(); break;
    case 'del': if (selEdge) { checkpoint(); deleteEdge(selEdge); } else deleteSelection(true); break;
    case 'fit': fitAll(); break;
  }
}
$('#scrim').addEventListener('click', () => document.body.classList.remove('drawer'));
$('#ed-done').addEventListener('click', () => closeEditor());

/* =================== Exportar / importar =================== */
async function exportAll() {
  await flush();
  const boards = {};
  for (const k of await TFDB.keys()) if (k.startsWith('board:')) boards[k] = await TFDB.get(k);
  const data = { app: 'TramaFeral', version: 1, exportedAt: new Date().toISOString(), projects, boards };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'TramaFeral-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* Añade los proyectos del archivo como proyectos nuevos (nunca reemplaza los existentes). */
async function importFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { data = null; }
  if (!data || data.app !== 'TramaFeral' || !Array.isArray(data.projects)) { alert('Ese archivo no es una copia de TramaFeral.'); return; }
  await flush();
  let n = 0;
  for (const p of data.projects) {
    const oldId = p.id, newId = uid();
    // Todos los ids de tableros de un proyecto empiezan por su id: se cambian de una vez.
    const remap = (obj) => JSON.parse(JSON.stringify(obj).split(oldId).join(newId));
    for (const [k, v] of Object.entries(data.boards || {})) {
      if (k === 'board:' + oldId || k.startsWith('board:' + oldId + '/')) await TFDB.set(remap(k), remap(v));
    }
    const np = remap(p);
    np.subs = np.subs || [];
    if (projects.some((x) => x.name === np.name)) np.name += ' (importado)';
    projects.push(np);
    n++;
  }
  saveProjects(); await flush();
  plistSig = ''; renderProjects();
  alert(n === 1 ? 'Se importó 1 proyecto.' : `Se importaron ${n} proyectos.`);
}
$('#export').addEventListener('click', exportAll);
$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

/* =================== Inicio =================== */
(async function start() {
  const idb = await TFDB.init();
  if (!idb) console.warn('IndexedDB no disponible: usando localStorage');
  projects = (await TFDB.get('projects')) || [];
  for (const p of projects) p.subs = p.subs || [];
  if (!projects.length) {
    await createProject();
    projects[0].name = 'Mi primer proyecto';
    saveProjects();
    renderProjects();
  } else {
    let last = await TFDB.get('last');
    if (typeof last === 'string') last = { pid: last, bid: last };    // formato anterior
    const p = last && projOf(last.pid);
    if (p && (last.bid === p.id || p.subs.some((s) => s.id === last.bid))) await openBoard(p.id, last.bid);
    else await openBoard(projects[0].id, projects[0].id);
  }
  setStatus('Guardado');
})();
