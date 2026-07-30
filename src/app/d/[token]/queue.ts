/**
 * The offline queue, as an external store.
 *
 * Deliberately NOT React state seeded from an effect. localStorage and
 * `navigator.onLine` are external mutable sources, and reading them into state
 * inside `useEffect` is the pattern `react-hooks/set-state-in-effect` exists to
 * stop — it renders once with a wrong value, then again with the right one, and
 * on this page that means a "not synced" badge flashing on every load.
 *
 * `useSyncExternalStore` reads them directly, gives a stable server snapshot
 * for SSR, and re-renders only when the underlying value actually changes.
 */

export type QueuedAction = {
  clientActionId: string;
  action: "on_my_way" | "setup_complete" | "job_complete";
  queuedAt: number;
};

/**
 * A completion photo waiting to go up, carrying the `clientActionId` of the tap
 * it belongs to.
 *
 * Queued SEPARATELY from the action. The status update is a few bytes and must
 * not be lost; the photo is a few hundred kilobytes and is optional. Sharing
 * one queue would mean a photo that keeps failing on a weak connection holds
 * "job complete" behind it, which is exactly backwards.
 */
export type QueuedPhoto = {
  clientActionId: string;
  mimeType: string;
  /** Base64, no data: prefix — a string survives localStorage, a Blob does not. */
  data: string;
  queuedAt: number;
};

const ACTION_PREFIX = "yw_dispatch_queue";
const PHOTO_PREFIX = "yw_dispatch_photos";

const listeners = new Set<() => void>();

/**
 * Snapshots must be referentially stable or useSyncExternalStore loops
 * forever, so each key's parsed array is cached and only replaced when its raw
 * string changes.
 */
const cache = new Map<string, { raw: string | null; value: unknown[] }>();

const EMPTY: never[] = [];

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.value as T[];
    const value = raw ? (JSON.parse(raw) as T[]) : EMPTY;
    cache.set(key, { raw, value });
    return value;
  } catch {
    // Private mode, quota, or corrupt JSON. The buttons must still work.
    return EMPTY;
  }
}

function write(key: string, value: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Non-fatal: this session keeps working, it just cannot survive a reload.
    // For a photo this is the likely case — localStorage is ~5MB — and it is
    // why the photo is best-effort while the status update is not.
  }
  cache.delete(key);
  for (const listener of listeners) listener();
}

function storageKey(token: string): string {
  return `${ACTION_PREFIX}:${token}`;
}

function photoKey(token: string): string {
  return `${PHOTO_PREFIX}:${token}`;
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab flushing the queue should update this one.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function readQueue(token: string): QueuedAction[] {
  return read<QueuedAction>(storageKey(token));
}

/** The SSR snapshot. Nothing is queued on a server render, by definition. */
export function serverQueue(): QueuedAction[] {
  return EMPTY;
}

export function writeQueue(token: string, queue: QueuedAction[]): void {
  write(storageKey(token), queue);
}

export function readPhotoQueue(token: string): QueuedPhoto[] {
  return read<QueuedPhoto>(photoKey(token));
}

export function serverPhotoQueue(): QueuedPhoto[] {
  return EMPTY;
}

export function writePhotoQueue(token: string, queue: QueuedPhoto[]): void {
  write(photoKey(token), queue);
}

export function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function readOnline(): boolean {
  return navigator.onLine;
}

/** Optimistic on the server: never render "no connection" in the HTML. */
export function serverOnline(): boolean {
  return true;
}
