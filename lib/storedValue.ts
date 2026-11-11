"use client";

import { useCallback, useSyncExternalStore } from "react";

type Store<T> = {
  get: () => T | null;
  set: (value: T | null) => void;
  subscribe: (listener: () => void) => () => void;
};

const stores = new Map<string, Store<unknown>>();

/**
 * A tiny JSON value kept in localStorage or sessionStorage, shared by every component
 * that uses the same key. Storage failures (private mode, blocked site data) fall back
 * to memory, so the app still works for the current page.
 */
function storeFor<T>(area: "local" | "session", key: string): Store<T> {
  const id = `${area}:${key}`;
  const existing = stores.get(id);
  if (existing) return existing as Store<T>;

  let cache: T | null | undefined;
  const listeners = new Set<() => void>();
  const storage = () => (area === "local" ? window.localStorage : window.sessionStorage);

  const store: Store<T> = {
    get() {
      if (cache !== undefined) return cache;
      try {
        const raw = storage().getItem(key);
        cache = raw ? (JSON.parse(raw) as T) : null;
      } catch {
        cache = null;
      }
      return cache;
    },
    set(value) {
      cache = value;
      try {
        if (value === null) storage().removeItem(key);
        else storage().setItem(key, JSON.stringify(value));
      } catch {
        // Keep the in-memory value.
      }
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  stores.set(id, store as Store<unknown>);
  return store;
}

const serverSnapshot = () => null;

/** Read and write a stored JSON value. Returns null on the server and when nothing is stored. */
export function useStoredValue<T>(
  area: "local" | "session",
  key: string,
): [T | null, (value: T | null) => void] {
  const store = storeFor<T>(area, key);
  const value = useSyncExternalStore(store.subscribe, store.get, serverSnapshot);
  const set = useCallback((next: T | null) => store.set(next), [store]);
  return [value, set];
}

/** Read a stored value outside React (event handlers). */
export function readStoredValue<T>(area: "local" | "session", key: string): T | null {
  return storeFor<T>(area, key).get();
}

export function writeStoredValue<T>(area: "local" | "session", key: string, value: T | null): void {
  storeFor<T>(area, key).set(value);
}
