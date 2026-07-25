// IndexedDB-backed cache for extracted audio (base64) and transcription cues.
// Keyed by a stable fingerprint of the source file + segment range so relaunching
// a render on the same file skips both FFmpeg audio extraction and Gemini calls.

import type { Cue } from "./transcribe.functions";

const DB_NAME = "neoncut-cache";
const DB_VERSION = 1;
const STORE_AUDIO = "audio";
const STORE_CUES = "cues";
const MAX_ENTRIES_PER_STORE = 400;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_AUDIO)) {
          db.createObjectStore(STORE_AUDIO);
        }
        if (!db.objectStoreNames.contains(STORE_CUES)) {
          db.createObjectStore(STORE_CUES);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(store, "readonly");
          const req = tx.objectStore(store).get(key);
          req.onsuccess = () => resolve(req.result as T | undefined);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

function idbSet(store: string, key: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) return resolve();
        try {
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      }),
  );
}

async function trimStore(store: string) {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    const countReq = os.count();
    countReq.onsuccess = () => {
      const excess = countReq.result - MAX_ENTRIES_PER_STORE;
      if (excess <= 0) return;
      const cursorReq = os.openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || removed >= excess) return;
        cursor.delete();
        removed++;
        cursor.continue();
      };
    };
  } catch {
    /* ignore */
  }
}

// Build a stable key for a File without hashing its full contents.
export function sourceFingerprint(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function segmentKey(fingerprint: string, startSec: number, endSec: number): string {
  return `${fingerprint}#${startSec.toFixed(3)}-${endSec.toFixed(3)}`;
}

export async function getCachedAudio(
  fingerprint: string,
  startSec: number,
  endSec: number,
): Promise<string | undefined> {
  return idbGet<string>(STORE_AUDIO, segmentKey(fingerprint, startSec, endSec));
}

export async function setCachedAudio(
  fingerprint: string,
  startSec: number,
  endSec: number,
  audioBase64: string,
): Promise<void> {
  await idbSet(STORE_AUDIO, segmentKey(fingerprint, startSec, endSec), audioBase64);
  void trimStore(STORE_AUDIO);
}

export async function getCachedCues(
  fingerprint: string,
  startSec: number,
  endSec: number,
): Promise<Cue[] | undefined> {
  return idbGet<Cue[]>(STORE_CUES, segmentKey(fingerprint, startSec, endSec));
}

export async function setCachedCues(
  fingerprint: string,
  startSec: number,
  endSec: number,
  cues: Cue[],
): Promise<void> {
  await idbSet(STORE_CUES, segmentKey(fingerprint, startSec, endSec), cues);
  void trimStore(STORE_CUES);
}

export async function clearSegmentCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await Promise.all(
    [STORE_AUDIO, STORE_CUES].map(
      (store) =>
        new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(store, "readwrite");
            tx.objectStore(store).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          } catch {
            resolve();
          }
        }),
    ),
  );
}
