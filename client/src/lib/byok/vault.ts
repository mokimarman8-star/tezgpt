/**
 * TezGPT BYOK — Local Encrypted Vault
 *
 * AI keys & GitHub tokens are encrypted with AES-GCM (WebCrypto) using a
 * device-generated 256-bit key (non-extractable CryptoKey) that itself lives
 * in IndexedDB. Secrets NEVER leave the browser: no server call, no log,
 * no analytics, no localStorage plaintext.
 */

import type { DetectedSecret, SecretKind, SecretProvider } from './detector';

const DB_NAME = 'tezgpt-byok-vault';
const DB_VERSION = 1;
const STORE = 'secrets';
const KEY_STORE = 'key';
const KEY_ALIAS = 'vault-master-key';

export interface SecretMeta {
  kind: SecretKind;
  provider?: SecretProvider;
  masked: string;
  updatedAt: number;
}

interface SecretRecord {
  id: SecretKind;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  meta: SecretMeta;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { keyPath: 'alias' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error ?? new Error('idb get failed'));
      }),
  );
}

function idbPut(store: string, value: unknown): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('idb put failed'));
      }),
  );
}

function idbDelete(store: string, key: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'));
      }),
  );
}

/** Get (or create) the non-extractable AES-GCM master key. */
async function getMasterKey(): Promise<CryptoKey> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto not available');
  }
  const stored = await idbGet<CryptoKey>(KEY_STORE, KEY_ALIAS);
  if (stored) {
    return stored;
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await idbPut(KEY_STORE, { alias: KEY_ALIAS, key });
  return key;
}

function maskSecret(value: string): string {
  const head = value.slice(0, 6);
  const tail = value.slice(-4);
  return `${head}…${tail}`;
}

/** Encrypt + store a secret. Meta (masked form) is stored alongside. */
export async function saveSecret(
  kind: SecretKind,
  value: string,
  provider?: SecretProvider,
): Promise<void> {
  const key = await getMasterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(value));
  const record: SecretRecord = {
    id: kind,
    iv: iv.buffer,
    ciphertext,
    meta: { kind, provider, masked: maskSecret(value), updatedAt: Date.now() },
  };
  await idbPut(STORE, record);
}

/** Decrypt + read a secret. */
export async function getSecret(kind: SecretKind): Promise<string | null> {
  const key = await getMasterKey();
  const record = await idbGet<SecretRecord>(STORE, kind);
  if (!record) {
    return null;
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv },
      key,
      record.ciphertext,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function getSecretMeta(kind: SecretKind): Promise<SecretMeta | null> {
  const record = await idbGet<SecretRecord>(STORE, kind);
  return record?.meta ?? null;
}

export async function listSecretMeta(): Promise<SecretMeta[]> {
  return openDb().then(
    (db) =>
      new Promise<SecretMeta[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () =>
          resolve((req.result as SecretRecord[]).map((r) => r.meta).filter(Boolean));
        req.onerror = () => reject(req.error ?? new Error('idb getAll failed'));
      }),
  );
}

export async function hasSecret(kind: SecretKind): Promise<boolean> {
  return (await getSecret(kind)) != null;
}

export async function deleteSecret(kind: SecretKind): Promise<void> {
  await idbDelete(STORE, kind);
}

/** Save a detected secret into the right slot automatically. */
export async function saveDetectedSecret(d: DetectedSecret): Promise<SecretKind> {
  await saveSecret(d.kind, d.value, d.provider);
  return d.kind;
}
