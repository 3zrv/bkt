/**
 * Browser-side AES-256-GCM encryption for sandbox credentials.
 *
 * Device key: a 256-bit random key generated once per browser profile and
 * stored in localStorage. It protects credentials from casual inspection
 * but does not defend against an attacker who can open DevTools.
 * The primary goal is origin isolation: credentials never leave the browser.
 */

const DEVICE_KEY_STORAGE = "s3admin-sandbox:deviceKey"

function buf2hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function hex2buf(hex: string): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(hex.length / 2) as Uint8Array<ArrayBuffer>
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return result
}

async function importRawKey(rawHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    hex2buf(rawHex),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem(DEVICE_KEY_STORAGE)
  if (stored) {
    return importRawKey(stored)
  }

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  )
  const exported = await crypto.subtle.exportKey("raw", key)
  localStorage.setItem(DEVICE_KEY_STORAGE, buf2hex(exported))
  return key
}

export async function encryptField(
  key: CryptoKey,
  value: string
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Uint8Array<ArrayBuffer>
  const encoded = new TextEncoder().encode(value)
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded)
  return {
    ciphertext: buf2hex(encrypted),
    iv: buf2hex(iv.buffer),
  }
}

export async function decryptField(
  key: CryptoKey,
  ciphertext: string,
  iv: string
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hex2buf(iv) },
    key,
    hex2buf(ciphertext)
  )
  return new TextDecoder().decode(decrypted)
}
