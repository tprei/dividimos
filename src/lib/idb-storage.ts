"use client";

import type { StateStorage } from "zustand/middleware";

function openDatabase(dbName: string, storeName: string): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const request = indexedDB.open(dbName, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(storeName)) {
      request.result.createObjectStore(storeName);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  return promise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
  return promise;
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
  tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
  return promise;
}

const noopStorage: StateStorage = {
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
};

/**
 * Single-key object-store storage for zustand persist. The database is
 * opened once per store instance; without IndexedDB (SSR, tests) every
 * operation resolves without effect.
 */
export function createIdbStorage(dbName: string, storeName: string): StateStorage {
  if (typeof indexedDB === "undefined") return noopStorage;

  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () => {
    if (dbPromise === null) dbPromise = openDatabase(dbName, storeName);
    return dbPromise;
  };

  return {
    async getItem(name) {
      const database = await db();
      const result = await requestResult(
        database.transaction(storeName, "readonly").objectStore(storeName).get(name),
      );
      return typeof result === "string" ? result : null;
    },
    async setItem(name, value) {
      const database = await db();
      const tx = database.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value, name);
      await transactionDone(tx);
    },
    async removeItem(name) {
      const database = await db();
      const tx = database.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(name);
      await transactionDone(tx);
    },
  };
}
