'use strict';
/*
 * Almacenamiento persistente clave-valor.
 * Usa IndexedDB (persistente entre reinicios). Si el navegador no lo permite,
 * recurre a localStorage. La interfaz (get/set) es la que podrá reemplazarse
 * en el futuro por un adaptador de escritorio o de sincronización.
 *
 * Claves:  "projects"        -> lista de proyectos [{id, name, createdAt, updatedAt}]
 *          "board:<id>"      -> {notes:[], edges:[], view:{x,y,z}}
 *          "last"            -> id del último proyecto abierto
 */
const TFDB = (() => {
  let db = null;

  function init() {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open('tramaferal', 1); } catch (e) { resolve(false); return; }
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { db = req.result; resolve(true); };
      req.onerror = () => resolve(false);
    });
  }

  function get(key) {
    if (!db) {
      const v = localStorage.getItem('tf:' + key);
      return Promise.resolve(v == null ? undefined : JSON.parse(v));
    }
    return new Promise((resolve, reject) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function set(key, value) {
    if (!db) {
      localStorage.setItem('tf:' + key, JSON.stringify(value));
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }

  function del(key) {
    if (!db) { localStorage.removeItem('tf:' + key); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }

  function keys() {
    if (!db) {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('tf:')) out.push(k.slice(3));
      }
      return Promise.resolve(out);
    }
    return new Promise((resolve, reject) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  return { init, get, set, del, keys };
})();
