const PREFIX = 'pdftk:';
const MAX_HISTORY = 40;

export const settings = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

let dbPromise;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('pdftk', 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore('history', { keyPath: 'id' });
      store.createIndex('date', 'date');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction('history', mode);
    const result = fn(t.objectStore('history'));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const listeners = new Set();
export const onHistoryChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn());

function withBlob(item) {
  return { ...item, blob: item.blob || new Blob([item.data], { type: item.type }) };
}

export const history = {
  enabled: () => settings.get('keepHistory', true),
  setEnabled: (v) => settings.set('keepHistory', !!v),

  async list() {
    const items = await tx('readonly', (s) => s.getAll());
    return items.map(withBlob).sort((a, b) => b.date - a.date);
  },

  async add({ name, blob, tool }) {
    if (!history.enabled()) return null;
    const item = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name, tool, size: blob.size, type: blob.type, date: Date.now(),
      // Safari cannot store Blob objects in IndexedDB for file:// pages, but ArrayBuffers work everywhere.
      data: await blob.arrayBuffer(),
    };
    await tx('readwrite', (s) => s.put(item));
    const all = await history.list();
    if (all.length > MAX_HISTORY) {
      await tx('readwrite', (s) => all.slice(MAX_HISTORY).forEach((old) => s.delete(old.id)));
    }
    emit();
    return withBlob(item);
  },

  async get(id) {
    const item = await tx('readonly', (s) => s.get(id));
    return item && withBlob(item);
  },

  async remove(id) {
    await tx('readwrite', (s) => s.delete(id));
    emit();
  },

  async clear() {
    await tx('readwrite', (s) => s.clear());
    emit();
  },
};
