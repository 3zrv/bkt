/**
 * IndexedDB store for the S3 sandbox.
 *
 * Two object stores:
 *   - credentials: AES-encrypted S3 credentials, keyPath "id"
 *   - preferences: key/value pairs (device key hint, UI prefs), keyPath "key"
 *
 * Pattern follows src/lib/thumbnail-db.ts — raw IDBDatabase wrapped in Promises.
 */

const DB_NAME = "s3admin-sandbox"
const DB_VERSION = 1

export interface SandboxCredential {
  id: string
  label: string
  provider: string
  endpoint: string
  region: string
  accessKeyEnc: string
  ivAccessKey: string
  secretKeyEnc: string
  ivSecretKey: string
  isDefault: boolean
  createdAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains("credentials")) {
        const store = db.createObjectStore("credentials", { keyPath: "id" })
        store.createIndex("isDefault", "isDefault")
      }
      if (!db.objectStoreNames.contains("preferences")) {
        db.createObjectStore("preferences", { keyPath: "key" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export async function saveCredential(cred: SandboxCredential): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("credentials", "readwrite")
    tx.objectStore("credentials").put(cred)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getCredential(id: string): Promise<SandboxCredential | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("credentials", "readonly")
    const req = tx.objectStore("credentials").get(id)
    req.onsuccess = () => resolve((req.result as SandboxCredential) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function listCredentials(): Promise<SandboxCredential[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("credentials", "readonly")
    const req = tx.objectStore("credentials").getAll()
    req.onsuccess = () => resolve(req.result as SandboxCredential[])
    req.onerror = () => reject(req.error)
  })
}

export async function deleteCredential(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("credentials", "readwrite")
    tx.objectStore("credentials").delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function setDefaultCredential(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("credentials", "readwrite")
    const store = tx.objectStore("credentials")
    const getAllReq = store.getAll()
    getAllReq.onsuccess = () => {
      const all = getAllReq.result as SandboxCredential[]
      for (const cred of all) {
        store.put({ ...cred, isDefault: cred.id === id })
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function getPref<T = unknown>(key: string): Promise<T | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("preferences", "readonly")
    const req = tx.objectStore("preferences").get(key)
    req.onsuccess = () => {
      const record = req.result as { key: string; value: T } | undefined
      resolve(record?.value ?? null)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function setPref(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction("preferences", "readwrite")
    tx.objectStore("preferences").put({ key, value })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
