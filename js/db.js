/* ===== IndexedDB 轻封装 ===== */
const DB_NAME = 'moneybook';
const DB_VERSION = 1;
const STORES = ['transactions', 'budgets', 'categories'];

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
      const txStore = req.transaction.objectStore('transactions');
      if (!txStore.indexNames.contains('date')) {
        txStore.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(db, store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async put(store, value) {
    const db = await openDB();
    return promisify(tx(db, store, 'readwrite').put(value));
  },
  async bulkPut(store, values) {
    const db = await openDB();
    const storeObj = tx(db, store, 'readwrite');
    return new Promise((resolve, reject) => {
      values.forEach((v) => storeObj.put(v));
      storeObj.transaction.oncomplete = () => resolve();
      storeObj.transaction.onerror = () => reject(storeObj.transaction.error);
    });
  },
  async get(store, key) {
    const db = await openDB();
    return promisify(tx(db, store).get(key));
  },
  async getAll(store) {
    const db = await openDB();
    return promisify(tx(db, store).getAll());
  },
  async getAllByIndex(store, index, key) {
    const db = await openDB();
    return promisify(tx(db, store).index(index).getAll(key));
  },
  async del(store, key) {
    const db = await openDB();
    return promisify(tx(db, store, 'readwrite').delete(key));
  },
  async clear(store) {
    const db = await openDB();
    return promisify(tx(db, store, 'readwrite').clear());
  }
};
